import { createApp } from './app.js';
import { CONFIG } from './config.js';

const port = process.env.CRAWLER_PORT || process.env.PORT || CONFIG.PORT;
const host = CONFIG.HOST || '127.0.0.1';
const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`Crawler API server listening on http://${host}:${port}`);
  console.log(`Bound to ${host} only`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

export default server;
