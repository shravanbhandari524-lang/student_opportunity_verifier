try {
  process.loadEnvFile?.();
} catch {
  // Ignore if .env is missing or invalid
}

export const CONFIG = {
  HOST: '127.0.0.1',
  PORT: parseInt(process.env.CRAWLER_PORT || process.env.PORT, 10) || 3001,
  CRAWLER_API_KEY: process.env.CRAWLER_API_KEY || process.env.API_KEY || '',
  JOB_TTL_MINUTES: parseFloat(process.env.CRAWLER_JOB_TTL_MINUTES || process.env.JOB_TTL_MINUTES) || 10,
  MAX_DEPTH: parseInt(process.env.CRAWLER_MAX_DEPTH, 10) || 2,
  MAX_DEPTH_LIMIT: 5,
  MAX_PAGES: parseInt(process.env.CRAWLER_MAX_PAGES, 10) || 10,
  MAX_PAGES_LIMIT: 50,
  DEFAULT_CONCURRENCY: 2,
  MAX_CONCURRENCY_LIMIT: 3,
  TOTAL_TIME_SEC: parseInt(process.env.CRAWLER_TOTAL_TIME_SEC, 10) || 60,
  MAX_TOTAL_BYTES: parseInt(process.env.CRAWLER_MAX_BYTES, 10) || 10 * 1024 * 1024, // 10 MB
  SAME_HOST_ONLY: process.env.CRAWLER_SAME_HOST_ONLY !== 'false', // default true
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: 30,
  MAX_JOBS_IN_MEMORY: 100
};
