import { Router } from 'express';
import { chromium } from 'playwright';
import { createJob, getJob, cancelJob, getJobStatusResponse } from '../jobs.js';
import { isSafeUrlAsync, isBasicSafeUrl } from '../urlGuard.js';
import { CONFIG } from '../config.js';

const router = Router();
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Health check: verify service up and Chromium can launch.
 */
router.get('/health', async (req, res) => {
  let chromiumOk = false;
  let chromiumError = null;

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    await browser.close();
    chromiumOk = true;
  } catch (err) {
    chromiumError = err.message;
  }

  res.status(chromiumOk ? 200 : 503).json({
    status: chromiumOk ? 'ok' : 'degraded',
    service: 'crawler',
    chromium: chromiumOk,
    ...(chromiumError && { error: chromiumError }),
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/crawl
 * Start a new read-only crawl job.
 */
router.post('/crawl', async (req, res) => {
  const {
    url,
    maxDepth,
    maxPages,
    concurrency,
    maxScrolls,
    scrollPage,
    sameHostOnly,
    timeoutMs
  } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Valid "url" string is required' });
  }

  // Pre-validate safety
  const basic = isBasicSafeUrl(url);
  if (!basic.safe) {
    return res.status(400).json({ error: basic.reason });
  }

  const asyncCheck = await isSafeUrlAsync(url);
  if (!asyncCheck.safe) {
    return res.status(400).json({ error: asyncCheck.reason });
  }

  // Validate caps
  let parsedDepth = CONFIG.MAX_DEPTH;
  if (maxDepth !== undefined) {
    const d = parseInt(maxDepth, 10);
    if (Number.isNaN(d) || d < 0) {
      return res.status(400).json({ error: '"maxDepth" must be a non-negative integer' });
    }
    if (d > CONFIG.MAX_DEPTH_LIMIT) {
      return res.status(400).json({
        error: `"maxDepth" exceeds maximum allowed limit of ${CONFIG.MAX_DEPTH_LIMIT}`
      });
    }
    parsedDepth = d;
  }

  let parsedPages = CONFIG.MAX_PAGES;
  if (maxPages !== undefined) {
    const p = parseInt(maxPages, 10);
    if (Number.isNaN(p) || p <= 0) {
      return res.status(400).json({ error: '"maxPages" must be a positive integer' });
    }
    if (p > CONFIG.MAX_PAGES_LIMIT) {
      return res.status(400).json({
        error: `"maxPages" exceeds maximum allowed limit of ${CONFIG.MAX_PAGES_LIMIT}`
      });
    }
    parsedPages = p;
  }

  let parsedConcurrency = CONFIG.DEFAULT_CONCURRENCY;
  if (concurrency !== undefined) {
    const c = parseInt(concurrency, 10);
    if (!Number.isNaN(c) && c > 0) {
      parsedConcurrency = Math.min(c, CONFIG.MAX_CONCURRENCY_LIMIT);
    }
  }

  const job = createJob({
    url,
    maxDepth: parsedDepth,
    maxPages: parsedPages,
    concurrency: parsedConcurrency,
    maxScrolls,
    scrollPage,
    sameHostOnly: sameHostOnly !== false,
    timeoutMs
  });

  return res.status(202).json({
    message: 'Crawl job queued',
    jobId: job.jobId,
    status: job.status
  });
});

/**
 * GET /api/crawl/:jobId
 * Check job status and progress.
 */
router.get('/crawl/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!SAFE_ID_REGEX.test(jobId)) {
    return res.status(400).json({ error: 'Invalid jobId format' });
  }

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.json(getJobStatusResponse(job));
});

/**
 * GET /api/crawl/:jobId/result
 * Get completed crawl result.
 */
router.get('/crawl/:jobId/result', (req, res) => {
  const { jobId } = req.params;
  if (!SAFE_ID_REGEX.test(jobId)) {
    return res.status(400).json({ error: 'Invalid jobId format' });
  }

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status === 'queued' || job.status === 'running') {
    return res.status(409).json({
      error: 'Job not finished yet',
      status: job.status,
      pagesVisited: job.pagesVisited
    });
  }

  if (job.status === 'completed' && job.result) {
    return res.json(job.result);
  }

  return res.status(500).json({
    error: 'Job failed without result',
    status: job.status,
    errors: job.errors
  });
});

/**
 * DELETE /api/crawl/:jobId
 * Cancel running or queued job.
 */
router.delete('/crawl/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!SAFE_ID_REGEX.test(jobId)) {
    return res.status(400).json({ error: 'Invalid jobId format' });
  }

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const cancelled = cancelJob(jobId);
  return res.json({
    message: 'Job cancellation requested',
    jobId,
    status: cancelled.status
  });
});

export default router;
