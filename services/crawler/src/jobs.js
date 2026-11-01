import crypto from 'node:crypto';
import { crawl } from './crawler.js';
import { CONFIG } from './config.js';
import { adaptCrawlResult } from './adapter.js';

const jobs = new Map();
const pendingQueue = [];
const MAX_CONCURRENT = 2;
let activeCount = 0;

/**
 * Periodically cleans up expired finished jobs (TTL) and enforces max in-memory limit.
 * Zero disk I/O: jobs live in memory only.
 */
export function cleanupExpiredJobs() {
  const ttlMs = (CONFIG.JOB_TTL_MINUTES || 10) * 60 * 1000;
  const now = Date.now();

  // 1. Evict by TTL
  for (const [jobId, job] of jobs.entries()) {
    if (job.finishedAt) {
      const age = now - new Date(job.finishedAt).getTime();
      if (age >= ttlMs) {
        jobs.delete(jobId);
      }
    }
  }

  // 2. Evict oldest finished jobs if over capacity
  if (jobs.size > CONFIG.MAX_JOBS_IN_MEMORY) {
    const finishedJobs = [];
    for (const job of jobs.values()) {
      if (job.finishedAt && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
        finishedJobs.push(job);
      }
    }
    finishedJobs.sort((a, b) => new Date(a.finishedAt).getTime() - new Date(b.finishedAt).getTime());

    while (jobs.size > CONFIG.MAX_JOBS_IN_MEMORY && finishedJobs.length > 0) {
      const oldest = finishedJobs.shift();
      jobs.delete(oldest.jobId);
    }
  }
}

// Background cleanup timer every 30s
setInterval(cleanupExpiredJobs, 30 * 1000).unref();

/**
 * Creates and queues a new crawl job.
 */
export function createJob(options) {
  cleanupExpiredJobs();

  const jobId = crypto.randomBytes(8).toString('hex');
  const timeoutMs = (CONFIG.TOTAL_TIME_SEC || 60) * 1000;

  const job = {
    jobId,
    options: {
      url: options.url,
      maxDepth: options.maxDepth,
      maxPages: options.maxPages,
      concurrency: options.concurrency,
      maxScrolls: options.maxScrolls,
      scrollPage: options.scrollPage !== false,
      sameHostOnly: options.sameHostOnly !== false,
      navigationTimeoutMs: options.navigationTimeoutMs || 15000
    },
    status: 'queued', // queued | running | completed | failed | cancelled
    stopReason: null,
    partial: false,
    pagesVisited: 0,
    pending: 0,
    failed: 0,
    errors: [],
    startedAt: null,
    finishedAt: null,
    result: null,
    timeoutMs,
    timeoutId: null,
    abortController: new AbortController()
  };

  jobs.set(jobId, job);
  pendingQueue.push(job);

  processNextJob();

  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    job.stopReason = 'cancelledByClient';
    const idx = pendingQueue.indexOf(job);
    if (idx !== -1) pendingQueue.splice(idx, 1);
    return job;
  }

  if (job.status === 'running') {
    job.abortController.abort();
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    job.stopReason = 'cancelledByClient';
    if (job.timeoutId) clearTimeout(job.timeoutId);
    return job;
  }

  return job;
}

async function processNextJob() {
  if (activeCount >= MAX_CONCURRENT || pendingQueue.length === 0) {
    return;
  }

  const job = pendingQueue.shift();
  if (!job || job.status === 'cancelled') {
    return processNextJob();
  }

  activeCount++;
  job.status = 'running';
  job.startedAt = new Date().toISOString();

  job.timeoutId = setTimeout(() => {
    if (job.status === 'running') {
      job.abortController.abort();
      job.stopReason = 'hardTimeout';
      job.errors.push('Job exceeded hard timeout limit');
    }
  }, job.timeoutMs);

  try {
    const result = await crawl(job.options, {
      signal: job.abortController.signal,
      onProgress: (p) => {
        job.pagesVisited = p.pagesVisited;
        job.pending = p.pending;
        job.failed = p.failed;
      }
    });

    if (job.status !== 'cancelled') {
      job.status = 'completed';
      job.result = adaptCrawlResult(result);
      job.stopReason = result.summary.stopReason;
      job.errors = result.errors;
    }
  } catch (err) {
    if (job.status !== 'cancelled') {
      job.status = 'failed';
      job.errors.push(err.message);
      job.stopReason = 'exception';
    }
  } finally {
    if (job.timeoutId) clearTimeout(job.timeoutId);
    job.finishedAt = new Date().toISOString();
    activeCount--;
    processNextJob();
  }
}

export function getJobStatusResponse(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    status: job.status,
    pagesVisited: job.pagesVisited,
    pending: job.pending,
    failed: job.failed,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errors: job.errors,
    result: job.status === 'completed' ? job.result : null
  };
}
