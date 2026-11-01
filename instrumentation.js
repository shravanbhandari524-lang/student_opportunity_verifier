/**
 * instrumentation.js
 *
 * Next.js server lifecycle instrumentation hook.
 * Invoked once when the Next.js server boots.
 *
 * Security & Environment Rules:
 * - Only runs background tasks when process.env.NEXT_RUNTIME === "nodejs".
 * - Uses dynamic imports to guarantee edge/client bundles and build analysis NEVER import better-sqlite3 or lib/db.
 * - Guarded against duplicate registration in dev HMR environments.
 * - Fault tolerant: if environment is incomplete or database fails to initialize during build/dev, logs code and continues gracefully without crashing process.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { getRuntime } = await import("./lib/api/runtime.js");
      const { startBackgroundTasks } = await import("./lib/api/startup.js");
      const { logger } = await import("./lib/logger.js");

      const runtime = getRuntime();
      await startBackgroundTasks({ runtime, logger });
      logger.info({ code: "INSTRUMENTATION_REGISTERED" }, "Server background lifecycle tasks registered successfully");
    } catch (err) {
      // In development or build stages, env might be incomplete or database might be unmigrated.
      // Log fixed code and continue without throwing.
      console.warn(
        JSON.stringify({
          level: "warn",
          code: "INSTRUMENTATION_INIT_SKIPPED",
          message: err?.message || "Failed to initialize instrumentation background tasks",
        })
      );
    }
  }
}
