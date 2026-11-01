import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getRuntime } from "../../../lib/api/runtime.js";
import { parseMultipart } from "../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../lib/api/errors.js";
import { getClientKey } from "../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../lib/api/headers.js";
import { createRequestLogger } from "../../../lib/api/log.js";
import { CheckSubmissionSchema } from "../../../lib/contracts/submission.js";
import { createCheck, saveInputs, deleteCheck } from "../../../lib/db/index.js";
import { validateImageBuffer } from "../../../lib/uploads.js";
import { runExtraction } from "../../../lib/extract.js";
import { buildDefaultDeps } from "../../../lib/coordinator.js";
import { env } from "../../../lib/env.js";
import { getAuthSession } from "../../../lib/auth.js";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checks
 *
 * Initiates check creation with multipart/form-data upload.
 * Enforces rate limiting, daily quota, body limits, image validation,
 * atomic database writes, and background extraction dispatch.
 */
export async function POST(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, jobRunner, db, logger, createSemaphore } = runtimeDeps;

  let semaphoreAcquired = false;

  try {
    // 1. Rate Limiting per IP & Global Daily Cap before reading body
    const clientKey = getClientKey(request, {
      trustProxy: Boolean(env.TRUST_PROXY),
      trustedHops: Number(env.TRUSTED_PROXY_HOPS) || 1,
    });
    rateLimiters.createCheck.assertAllowed(clientKey);
    rateLimiters.globalDaily.assertAllowed("global");

    // Acquire concurrency semaphore for body buffering
    if (createSemaphore && !createSemaphore.acquire()) {
      throw apiError(
        "SERVICE_UNAVAILABLE",
        "Server is busy processing other check creations. Please retry shortly.",
        503
      );
    }
    semaphoreAcquired = true;

    // 2. Parse Multipart request
    const { fields, files } = await parseMultipart(request, {
      maxFileSize: 5 * 1024 * 1024,
      maxFiles: 5,
      maxTotalSize: 26 * 1024 * 1024,
    });

    // 3. Normalize & validate input fields against CheckSubmissionSchema
    const rawConsent = fields.consent;
    const consent = rawConsent === true || rawConsent === "true" || rawConsent === "1";

    const candidateSubmission = {
      text: fields.text || fields.messageText || undefined,
      userNotes: fields.userNotes || undefined,
      url: fields.url || fields.shareLink || undefined,
      upiId: fields.upiId || undefined,
      company: fields.company || undefined,
      handle: fields.handle || undefined,
      handlePlatform: fields.handlePlatform || undefined,
      phone: fields.phone || undefined,
      youtubeUrl: fields.youtubeUrl || undefined,
      language: fields.language || "en",
      consent,
      images: files.map((f) => ({
        filename: f.filename,
        mimeType: f.mimeType === "image/jpeg" || f.mimeType === "image/jpg" ? "image/jpeg" : "image/png",
        sizeBytes: f.size,
      })),
    };

    const parseResult = CheckSubmissionSchema.safeParse(candidateSubmission);
    if (!parseResult.success) {
      throw apiError("BAD_REQUEST", "Check submission validation failed", 400, {
        issues: parseResult.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    const validated = parseResult.data;

    // 4. Validate image magic bytes and dimensions using validateImageBuffer
    // Write valid images to UPLOAD_DIR under random UUID filenames with mode 0o600
    const uploadDir = path.resolve(env.UPLOAD_DIR || "./uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const writtenFiles = [];
    const imageInputRows = [];

    try {
      for (const file of files) {
        const valRes = await validateImageBuffer(file.buffer);
        if (!valRes.ok) {
          throw apiError(
            "BAD_REQUEST",
            "Invalid image upload: unsupported format or corrupted data",
            400
          );
        }

        const ext = valRes.mimeType === "image/jpeg" ? "jpg" : "png";
        const randomName = `${crypto.randomUUID()}.${ext}`;
        const targetPath = path.join(uploadDir, randomName);

        // Security check: ensure path resolves strictly inside uploadDir
        if (!path.resolve(targetPath).startsWith(uploadDir + path.sep)) {
          throw apiError("BAD_REQUEST", "Invalid file destination", 400);
        }

        fs.writeFileSync(targetPath, valRes.buffer, { mode: 0o600 });
        writtenFiles.push(targetPath);

        imageInputRows.push({
          type: "image",
          mimeType: valRes.mimeType,
          sizeBytes: valRes.sizeBytes,
          filePath: targetPath,
        });
      }
    } catch (err) {
      // Clean up any files written during this request on failure
      for (const f of writtenFiles) {
        if (fs.existsSync(f)) {
          try {
            fs.unlinkSync(f);
          } catch (_e) {}
        }
      }
      throw err;
    }

    // 5. Create Check and save inputs in database
    const checkId = crypto.randomUUID();
    reqLogger.setCheckId(checkId);

    const auth = await getAuthSession(request, db, env);
    const userId = auth?.user?.id || null;

    createCheck(
      {
        id: checkId,
        userId,
        language: validated.language,
        status: "created",
      },
      db
    );

    const inputRows = [...imageInputRows];
    if (validated.text) inputRows.push({ type: "text", value: validated.text });
    if (validated.userNotes) inputRows.push({ type: "user_notes", value: validated.userNotes });
    if (validated.url) inputRows.push({ type: "url", value: validated.url });
    if (validated.upiId) inputRows.push({ type: "upi", value: validated.upiId });
    if (validated.company) inputRows.push({ type: "company", value: validated.company });
    if (validated.handle) inputRows.push({ type: "handle", value: validated.handle });
    if (validated.phone) inputRows.push({ type: "phone", value: validated.phone });
    if (validated.youtubeUrl) inputRows.push({ type: "youtube_url", value: validated.youtubeUrl });

    saveInputs(checkId, inputRows, db);

    // 6. Launch background extraction via jobRunner
    try {
      await jobRunner.run(checkId, async () => {
        try {
          const sharedGenerate =
            runtimeDeps.pipelineDeps?.generate ||
            buildDefaultDeps(undefined, db).generate;
          const extractDeps = context.extractDeps || {
            db,
            logger,
            uploadDir,
            generate: sharedGenerate,
            handlePlatform: validated.handlePlatform,
          };

          await runExtraction(checkId, extractDeps);

        } catch (err) {
          if (logger?.error) {
            logger.error({ checkId, err: err?.message }, "Background extraction job failed");
          }
        } finally {
          if (runtimeDeps.eventBus) {
            runtimeDeps.eventBus.notify(checkId);
          }
        }
      });
    } catch (runnerErr) {
      if (runnerErr && runnerErr.code === "SERVICE_UNAVAILABLE") {
        // Concurrency cap reached. Clean up written files and database check
        for (const f of writtenFiles) {
          if (fs.existsSync(f)) {
            try {
              fs.unlinkSync(f);
            } catch (_e) {}
          }
        }
        try {
          deleteCheck(checkId, db);
        } catch (_e) {}

        throw apiError(
          "SERVICE_UNAVAILABLE",
          "Server capacity exceeded. Please retry in 10 seconds.",
          503
        );
      }
      throw runnerErr;
    }

    const res = Response.json(
      { checkId, status: "created" },
      {
        status: 201,
        headers: noStoreHeaders(),
      }
    );

    reqLogger.logResponse(201, { activeJobs: jobRunner.activeCount() });
    return applySecurityHeaders(res);
  } catch (err) {
    const errorRes = toResponse(err, noStoreHeaders());
    if (errorRes.status === 503) {
      errorRes.headers.set("Retry-After", "10");
    }
    reqLogger.logError(err, errorRes.status);
    return applySecurityHeaders(errorRes);
  } finally {
    if (semaphoreAcquired && createSemaphore) {
      createSemaphore.release();
    }
  }
}
