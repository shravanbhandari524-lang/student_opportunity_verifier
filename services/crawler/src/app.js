import express from 'express';
import { rateLimit } from 'express-rate-limit';
import crawlRouter from './routes/crawl.js';
import { CONFIG } from './config.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Strict API Key authorization on every route
  app.use((req, res, next) => {
    const configuredKey = process.env.CRAWLER_API_KEY || CONFIG.CRAWLER_API_KEY;
    if (!configuredKey) {
      // If no key is configured in env, refuse external requests for safety
      return res.status(500).json({ error: 'CRAWLER_API_KEY not configured on service' });
    }

    const clientKey = req.header('x-api-key') || (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!clientKey || clientKey !== configuredKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing x-api-key' });
    }

    return next();
  });

  // Rate limiter: 30 requests/min per IP
  const limiter = rateLimit({
    windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
    max: CONFIG.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  });

  app.use('/api', limiter);

  // Mount API endpoints
  app.use('/api', crawlRouter);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('[Crawler API Error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
