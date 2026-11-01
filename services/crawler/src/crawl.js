#!/usr/bin/env node
import { crawl } from './crawler.js';

function parseCliArgs(argv) {
  const args = argv.slice(2);
  let url = null;
  let depth = 2;
  let maxPages = 10;
  let concurrency = 2;
  let maxScrolls = 3;
  let sameHostOnly = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--depth') {
      const next = args[++i];
      if (next !== undefined) depth = parseInt(next, 10);
    } else if (arg.startsWith('--depth=')) {
      depth = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--max-pages') {
      const next = args[++i];
      if (next !== undefined) maxPages = parseInt(next, 10);
    } else if (arg.startsWith('--max-pages=')) {
      maxPages = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--concurrency') {
      const next = args[++i];
      if (next !== undefined) concurrency = parseInt(next, 10);
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--allow-cross-host') {
      sameHostOnly = false;
    } else if (arg === '--help' || arg === '-h') {
      return { showHelp: true };
    } else if (!arg.startsWith('-') && !url) {
      url = arg;
    }
  }

  if (Number.isNaN(depth) || depth < 0) depth = 2;
  if (Number.isNaN(maxPages) || maxPages <= 0) maxPages = 10;
  if (Number.isNaN(concurrency) || concurrency < 1) concurrency = 2;

  return { url, depth, maxPages, concurrency, maxScrolls, sameHostOnly, showHelp: false };
}

function printUsage() {
  console.log(`
Crawler - Read-only Security Web Crawler CLI

Usage:
  node src/crawl.js <url> [--depth 2] [--max-pages 10] [--concurrency 2]

Options:
  --depth <number>         Maximum link recursion depth (default: 2)
  --max-pages <number>     Maximum pages to crawl (default: 10)
  --concurrency <number>   Concurrent browser workers (default: 2)
  --help, -h               Show this help message
`);
}

async function main() {
  const options = parseCliArgs(process.argv);

  if (options.showHelp || !options.url) {
    printUsage();
    process.exit(options.showHelp ? 0 : 1);
  }

  try {
    const result = await crawl(
      {
        url: options.url,
        maxDepth: options.depth,
        maxPages: options.maxPages,
        concurrency: options.concurrency,
        maxScrolls: options.maxScrolls,
        sameHostOnly: options.sameHostOnly
      },
      {
        onProgress: (p) => {
          console.error(`[Crawl Progress] Visited: ${p.pagesVisited}, Pending: ${p.pending}, Failed: ${p.failed}`);
        }
      }
    );

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(`[Crawl Error] ${err.message}`);
    process.exit(1);
  }
}

main();
