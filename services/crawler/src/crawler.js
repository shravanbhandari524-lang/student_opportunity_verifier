import { chromium } from 'playwright';
import {
  normalizeUrl,
  isSafeUrlAsync,
  isAllowedByRobotsTxt,
  isCrawlTrap
} from './urlGuard.js';
import { scrollPage, extractPageData } from './extract.js';
import { isSameDomain } from './urlUtils.js';
import { CONFIG } from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reconstructs the crawl hierarchy into a tree rooted at startUrl.
 */
export function buildTree(pages, startUrl) {
  if (!pages || pages.length === 0) {
    return { url: startUrl, children: [] };
  }

  const rootUrl = pages[0].url;
  const root = { url: rootUrl, children: [] };
  const nodeMap = new Map();
  nodeMap.set(rootUrl, root);

  for (let i = 1; i < pages.length; i++) {
    const page = pages[i];
    const node = { url: page.url, children: [] };
    nodeMap.set(page.url, node);

    const parentNode = page.parentUrl ? nodeMap.get(page.parentUrl) : null;
    if (parentNode) {
      parentNode.children.push(node);
    } else {
      root.children.push(node);
    }
  }

  return root;
}

/**
 * Core reusable crawl function.
 * Strictly read-only: never fills forms, never submits forms, never takes screenshots,
 * rejects downloads, enforces hard caps and SSRF guards.
 */
export async function crawl(options = {}, { onProgress, signal } = {}) {
  const startRaw = options.url || options.startUrl;
  if (!startRaw) {
    throw new Error('Start URL is required');
  }

  const normalizedStart = normalizeUrl(startRaw);
  if (!normalizedStart) {
    throw new Error(`Invalid start URL: "${startRaw}"`);
  }

  const startCheck = await isSafeUrlAsync(normalizedStart);
  if (!startCheck.safe) {
    throw new Error(`Cannot crawl URL: ${startCheck.reason}`);
  }

  // Hard limits from env / config with safe defaults
  const maxDepth = Math.min(
    typeof options.maxDepth === 'number' ? options.maxDepth : CONFIG.MAX_DEPTH,
    CONFIG.MAX_DEPTH_LIMIT
  );
  const maxPages = Math.min(
    typeof options.maxPages === 'number' ? options.maxPages : CONFIG.MAX_PAGES,
    CONFIG.MAX_PAGES_LIMIT
  );
  const concurrency = Math.min(
    typeof options.concurrency === 'number' ? options.concurrency : CONFIG.DEFAULT_CONCURRENCY,
    CONFIG.MAX_CONCURRENCY_LIMIT
  );
  const totalTimeLimitMs = (options.totalTimeSec || CONFIG.TOTAL_TIME_SEC) * 1000;
  const maxTotalBytes = options.maxTotalBytes || CONFIG.MAX_TOTAL_BYTES;
  const sameHostOnly = options.sameHostOnly !== undefined ? options.sameHostOnly : CONFIG.SAME_HOST_ONLY;
  const enableScroll = options.scrollPage !== false;
  const maxScrolls = typeof options.maxScrolls === 'number' ? options.maxScrolls : 3;
  const navTimeout = options.navigationTimeoutMs || 15000;

  const jobErrors = [];
  let blockedRequestsCount = 0;
  let totalBytesReceived = 0;
  let truncated = false;

  const startTime = Date.now();

  let browser = null;
  let context = null;

  async function setupBrowserContext() {
    if (browser) {
      await browser.close().catch(() => {});
    }
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions'
      ]
    });

    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false, // Disallow all downloads
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 deepcrawl/1.0'
    });

    // Revalidate every request (main frame, subframes, redirects, xhr/fetch) against SSRF
    await context.route('**/*', async (route) => {
      try {
        const req = route.request();
        const reqUrl = req.url();

        // Check protocol
        if (!reqUrl.startsWith('http://') && !reqUrl.startsWith('https://')) {
          blockedRequestsCount++;
          jobErrors.push(`Blocked request: ${reqUrl} (Disallowed protocol)`);
          return route.abort('blockedbyclient');
        }

        // Validate SSRF
        const safe = await isSafeUrlAsync(reqUrl);
        if (!safe.safe) {
          blockedRequestsCount++;
          jobErrors.push(`Blocked request: ${reqUrl} (${safe.reason})`);
          return route.abort('blockedbyclient');
        }

        return route.continue();
      } catch {
        blockedRequestsCount++;
        return route.abort('blockedbyclient');
      }
    });
  }

  await setupBrowserContext();

  const patternCounts = new Map();
  const queue = [{ url: normalizedStart, depth: 0, parentUrl: null, isPagination: false }];
  const enqueuedUrls = new Set([normalizedStart]);

  const initPatternCheck = isCrawlTrap(normalizedStart, patternCounts, 50);
  if (!initPatternCheck.trap && initPatternCheck.pattern) {
    patternCounts.set(initPatternCheck.pattern, 1);
  }

  const pages = [];
  const allForms = [];
  const externalDomainsSet = new Set();
  let failedCount = 0;
  let maxDepthReached = 0;
  let stopReason = 'queueEmpty';
  let activeWorkers = 0;

  const wakeWaiters = [];
  function notifyWaiters() {
    while (wakeWaiters.length > 0) {
      const resolve = wakeWaiters.shift();
      resolve();
    }
  }

  async function processUrl(current) {
    if (signal?.aborted) {
      stopReason = 'aborted';
      return;
    }

    if (Date.now() - startTime >= totalTimeLimitMs) {
      stopReason = 'timeLimit';
      truncated = true;
      return;
    }

    if (pages.length >= maxPages) {
      stopReason = 'maxPages';
      truncated = true;
      return;
    }

    if (totalBytesReceived >= maxTotalBytes) {
      stopReason = 'byteLimit';
      truncated = true;
      return;
    }

    if (current.depth > maxDepthReached) {
      maxDepthReached = current.depth;
    }

    let finalUrl = current.url;
    let statusCode = null;
    let title = '';
    let description = '';
    let headings = { h1: [], h2: [], h3: [] };
    let text = '';
    let links = { internal: [], external: [] };
    const pageErrors = [];

    // Pre-navigation safety check
    const safetyCheck = await isSafeUrlAsync(current.url);
    if (!safetyCheck.safe) {
      blockedRequestsCount++;
      const reasonMsg = `Blocked request: ${current.url} (${safetyCheck.reason})`;
      pageErrors.push(safetyCheck.reason);
      jobErrors.push(reasonMsg);
      failedCount++;
      pages.push({
        url: current.url,
        finalUrl,
        statusCode,
        title,
        description,
        headings,
        text,
        links,
        depth: current.depth,
        parentUrl: current.parentUrl,
        errors: pageErrors
      });
      return;
    }

    // Robots.txt check
    const robotsAllowed = await isAllowedByRobotsTxt(current.url);
    if (!robotsAllowed) {
      blockedRequestsCount++;
      const reasonMsg = `Robots.txt skip: ${current.url} (Disallowed by robots.txt)`;
      pageErrors.push('Disallowed by robots.txt');
      jobErrors.push(reasonMsg);
      failedCount++;
      pages.push({
        url: current.url,
        finalUrl,
        statusCode,
        title,
        description,
        headings,
        text,
        links,
        depth: current.depth,
        parentUrl: current.parentUrl,
        errors: pageErrors
      });
      return;
    }

    let page = null;
    try {
      if (!browser || !browser.isConnected() || !context) {
        await setupBrowserContext();
      }
      page = await context.newPage();
    } catch (launchErr) {
      pageErrors.push(`Browser launch error: ${launchErr.message}`);
      await setupBrowserContext().catch(() => {});
    }

    if (page) {
      try {
        const response = await page.goto(current.url, {
          waitUntil: 'domcontentloaded',
          timeout: navTimeout
        });

        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

        finalUrl = normalizeUrl(page.url()) || page.url();
        statusCode = response ? response.status() : null;

        if (response) {
          const bodyBuf = await response.body().catch(() => null);
          if (bodyBuf) {
            totalBytesReceived += bodyBuf.length;
          }
        }

        if (statusCode && statusCode >= 400) {
          pageErrors.push(`HTTP status ${statusCode}`);
        }

        const finalSafety = await isSafeUrlAsync(finalUrl);
        if (!finalSafety.safe) {
          blockedRequestsCount++;
          pageErrors.push(`Redirected to unsafe URL: ${finalSafety.reason}`);
          jobErrors.push(`Blocked request: ${finalUrl} (${finalSafety.reason})`);
        } else {
          if (enableScroll) {
            await scrollPage(page, maxScrolls, 150);
          }

          let extracted = null;
          try {
            extracted = await extractPageData(page, finalUrl, normalizedStart);
            title = extracted.title;
            description = extracted.description;
            headings = extracted.headings;
            text = extracted.text;
            links = extracted.links;

            if (extracted.forms && extracted.forms.length > 0) {
              allForms.push(...extracted.forms);
            }

            for (const extLink of links.external) {
              try {
                externalDomainsSet.add(new URL(extLink).hostname);
              } catch {
                // Ignore invalid external URLs
              }
            }
          } catch (extErr) {
            pageErrors.push(`Extraction failed: ${extErr.message}`);
          }

          // Queue internal links
          if (extracted && !signal?.aborted) {
            for (const nextUrl of links.internal) {
              if (enqueuedUrls.has(nextUrl)) continue;

              if (sameHostOnly && !isSameDomain(nextUrl, normalizedStart)) {
                continue;
              }

              const isPagination = extracted.paginationLinks.has(nextUrl);
              const nextDepth = isPagination ? current.depth : current.depth + 1;

              if (nextDepth <= maxDepth) {
                const trapCheck = isCrawlTrap(nextUrl, patternCounts, 50);
                if (trapCheck.trap) {
                  jobErrors.push(`Crawl-trap skip: ${nextUrl} (${trapCheck.reason})`);
                  continue;
                }
                patternCounts.set(trapCheck.pattern, (patternCounts.get(trapCheck.pattern) || 0) + 1);
                enqueuedUrls.add(nextUrl);
                queue.push({
                  url: nextUrl,
                  depth: nextDepth,
                  parentUrl: current.url,
                  isPagination
                });
              }
            }
          }
        }
      } catch (navErr) {
        pageErrors.push(navErr.message);
        failedCount++;
      } finally {
        await page.close().catch(() => {});
      }
    }

    pages.push({
      url: current.url,
      finalUrl,
      statusCode,
      title,
      description,
      headings,
      text,
      links,
      depth: current.depth,
      parentUrl: current.parentUrl,
      errors: pageErrors
    });

    onProgress?.({
      pagesVisited: pages.length,
      pending: queue.length,
      failed: failedCount,
      currentUrl: current.url,
      depth: current.depth
    });
  }

  async function worker() {
    while (true) {
      if (signal?.aborted) {
        stopReason = 'aborted';
        break;
      }
      if (Date.now() - startTime >= totalTimeLimitMs) {
        stopReason = 'timeLimit';
        truncated = true;
        break;
      }
      if (pages.length >= maxPages) {
        stopReason = 'maxPages';
        truncated = true;
        break;
      }
      if (totalBytesReceived >= maxTotalBytes) {
        stopReason = 'byteLimit';
        truncated = true;
        break;
      }

      if (queue.length === 0) {
        if (activeWorkers === 0) {
          break;
        }
        await new Promise((resolve) => {
          wakeWaiters.push(resolve);
          setTimeout(resolve, 50);
        });
        continue;
      }

      const item = queue.shift();
      if (!item) continue;

      activeWorkers++;
      try {
        await processUrl(item);
      } finally {
        activeWorkers--;
        notifyWaiters();
      }
    }
  }

  const workerPromises = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workerPromises);

  if (browser) {
    await browser.close().catch(() => {});
  }

  const durationMs = Date.now() - startTime;
  const tree = buildTree(pages, normalizedStart);

  return {
    startUrl: normalizedStart,
    tree,
    pages,
    forms: allForms,
    externalDomains: Array.from(externalDomainsSet),
    truncated,
    limitsUsed: {
      maxPages,
      maxDepth,
      totalTimeSec: Math.round(durationMs / 1000),
      totalBytesReceived,
      sameHostOnly
    },
    summary: {
      pagesVisited: pages.length,
      maxDepthReached,
      failed: failedCount,
      blockedRequests: blockedRequestsCount,
      durationMs,
      stopReason
    },
    errors: jobErrors
  };
}
