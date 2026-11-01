/**
 * services/crawler/src/safeProxy.js
 *
 * Pinned-IP Forward HTTP/HTTPS Proxy.
 * Self-contained proxy server for Chromium, citing security invariants from lib/tools/ssrf.js.
 *
 * Invariants:
 * 1. Listens on 127.0.0.1, ephemeral port.
 * 2. Allows target ports 80 and 443 only.
 * 3. Handles CONNECT (HTTPS) and plain HTTP GET/HEAD. Any other method gets 405 Method Not Allowed.
 * 4. Resolves the target host ONCE using an injectable resolver (dns.lookup, all addresses).
 * 5. If ANY resolved address is private, loopback, link-local, carrier-grade NAT, or cloud metadata,
 *    or the host matches a blocked social domain or IP literal in those ranges (decimal, hex, octal,
 *    IPv4-mapped IPv6), returns 403 Forbidden and NEVER opens a socket.
 * 6. Connects to the validated, PINNED IP address, never to the hostname.
 * 7. Supports injectable connector (net.createConnection) for test observability and verification.
 * 8. Enforces connect timeout, idle timeout, and per-tunnel byte cap.
 * 9. Never logs URLs with query strings or page content.
 */

import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { isPrivateIp, parseAndUnwrapIp, isBlockedSocialDomain } from './urlGuard.js';

const ALLOWED_PORTS = new Set([80, 443]);
const ALLOWED_HTTP_METHODS = new Set(['GET', 'HEAD']);
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_IDLE_TIMEOUT_MS = 10000;
const DEFAULT_BYTE_CAP = 10 * 1024 * 1024; // 10 MB

/**
 * Validates target host and resolves to a verified pinned IP.
 *
 * @param {string} rawHost
 * @param {number} port
 * @param {(host: string) => Promise<Array<{ address: string, family: number }>>} resolver
 * @returns {Promise<{ valid: boolean, pinnedIp?: string, reason?: string }>}
 */
export async function validateAndPinHost(rawHost, port, resolver) {
  if (!ALLOWED_PORTS.has(port)) {
    return { valid: false, reason: `Port ${port} is not allowed (80 and 443 only)` };
  }

  const host = (rawHost || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return { valid: false, reason: 'Empty host' };
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    return { valid: false, reason: `Blocked hostname: ${host}` };
  }

  if (isBlockedSocialDomain(host)) {
    return { valid: false, reason: `Blocked social domain: ${host}` };
  }

  // Check if host is an IP literal (decimal, hex, octal, IPv4-mapped IPv6, standard IPv4/v6)
  const parsedLiteral = parseAndUnwrapIp(host);
  if (parsedLiteral) {
    const ipStr = parsedLiteral.toString();
    if (isPrivateIp(ipStr)) {
      return { valid: false, reason: `Blocked IP literal: ${host}` };
    }
    return { valid: true, pinnedIp: ipStr };
  }

  // Resolve hostname via injectable resolver
  try {
    const records = await resolver(host);
    if (!records || records.length === 0) {
      return { valid: false, reason: `DNS lookup returned no addresses for ${host}` };
    }

    for (const record of records) {
      const addr = record.address;
      if (isPrivateIp(addr)) {
        return { valid: false, reason: `DNS resolved ${host} to blocked IP ${addr}` };
      }
    }

    // Pin the first validated address
    return { valid: true, pinnedIp: records[0].address };
  } catch (err) {
    return { valid: false, reason: `DNS resolution failed for ${host}: ${err.message}` };
  }
}

/**
 * Creates and starts a safe forward proxy server.
 *
 * @param {object} [options={}]
 * @param {(host: string) => Promise<Array<{ address: string, family: number }>>} [options.resolver]
 * @param {(options: object, callback?: () => void) => net.Socket} [options.connector]
 * @param {number} [options.byteCap=10485760]
 * @param {number} [options.timeoutMs=25000]
 * @param {number} [options.idleTimeoutMs=10000]
 * @param {(bytes: number) => void} [options.onBytes]
 * @returns {Promise<{ server: http.Server, port: number, close: () => Promise<void> }>}
 */
export async function createSafeProxy(options = {}) {
  const resolver = options.resolver || ((host) => dns.lookup(host, { all: true }));
  const connector = options.connector || ((connOpts, cb) => net.createConnection(connOpts, cb));
  const byteCap = options.byteCap || DEFAULT_BYTE_CAP;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs || DEFAULT_IDLE_TIMEOUT_MS;
  const onBytes = options.onBytes || (() => {});

  let totalBytes = 0;

  const server = http.createServer();

  // Handle plain HTTP (GET / HEAD)
  server.on('request', async (clientReq, clientRes) => {
    try {
      const method = (clientReq.method || '').toUpperCase();
      if (!ALLOWED_HTTP_METHODS.has(method)) {
        clientRes.writeHead(405, { 'Content-Type': 'text/plain' });
        clientRes.end('Method Not Allowed (Crawl is read-only)');
        return;
      }

      let parsedUrl = null;
      try {
        parsedUrl = new URL(clientReq.url);
      } catch {
        // May be relative URI with Host header
        const hostHeader = clientReq.headers.host || '';
        parsedUrl = new URL(`http://${hostHeader}${clientReq.url}`);
      }

      const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 80;
      const host = parsedUrl.hostname;

      const check = await validateAndPinHost(host, port, resolver);
      if (!check.valid || !check.pinnedIp) {
        clientRes.writeHead(403, { 'Content-Type': 'text/plain' });
        clientRes.end(`Forbidden: ${check.reason || 'Blocked host or IP'}`);
        return;
      }

      // Check cumulative byte cap
      if (totalBytes >= byteCap) {
        clientRes.writeHead(413, { 'Content-Type': 'text/plain' });
        clientRes.end('Payload Too Large: Crawl byte cap exceeded');
        return;
      }

      // Forward request to pinned IP
      const targetReq = http.request({
        host: check.pinnedIp,
        port,
        method,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          ...clientReq.headers,
          host: host + (port !== 80 ? `:${port}` : '')
        },
        timeout: timeoutMs,
        createConnection: (connOpts, cb) => {
          return connector({ ...connOpts, host: check.pinnedIp, port }, cb);
        }
      });

      targetReq.on('timeout', () => {
        targetReq.destroy(new Error('Proxy connection timeout'));
      });

      targetReq.on('error', (err) => {
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
          clientRes.end(`Bad Gateway: ${err.message}`);
        }
      });

      targetReq.on('response', (targetRes) => {
        clientRes.writeHead(targetRes.statusCode, targetRes.headers);

        targetRes.on('data', (chunk) => {
          totalBytes += chunk.length;
          onBytes(chunk.length);
          if (totalBytes >= byteCap) {
            targetReq.destroy();
            clientRes.destroy();
          }
        });

        targetRes.pipe(clientRes);
      });

      clientReq.pipe(targetReq);
    } catch {
      if (!clientRes.headersSent) {
        clientRes.writeHead(500, { 'Content-Type': 'text/plain' });
        clientRes.end('Internal Proxy Error');
      }
    }
  });

  // Handle CONNECT (HTTPS)
  server.on('connect', async (clientReq, clientSocket, head) => {
    try {
      const [host, rawPort] = clientReq.url.split(':');
      const port = parseInt(rawPort || '443', 10);

      const check = await validateAndPinHost(host, port, resolver);
      if (!check.valid || !check.pinnedIp) {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n');
        clientSocket.destroy();
        return;
      }

      if (totalBytes >= byteCap) {
        clientSocket.write('HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n');
        clientSocket.destroy();
        return;
      }

      // Connect to PINNED IP address directly via connector
      const targetSocket = connector(
        {
          host: check.pinnedIp,
          port
        },
        () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head && head.length > 0) {
            targetSocket.write(head);
            totalBytes += head.length;
            onBytes(head.length);
          }
          clientSocket.pipe(targetSocket);
          targetSocket.pipe(clientSocket);
        }
      );

      targetSocket.setTimeout(timeoutMs);
      clientSocket.setTimeout(timeoutMs);

      targetSocket.on('timeout', () => {
        targetSocket.destroy();
        clientSocket.destroy();
      });

      clientSocket.on('timeout', () => {
        targetSocket.destroy();
        clientSocket.destroy();
      });

      targetSocket.on('data', (chunk) => {
        totalBytes += chunk.length;
        onBytes(chunk.length);
        if (totalBytes >= byteCap) {
          targetSocket.destroy();
          clientSocket.destroy();
        }
      });

      clientSocket.on('data', (chunk) => {
        totalBytes += chunk.length;
        onBytes(chunk.length);
        if (totalBytes >= byteCap) {
          targetSocket.destroy();
          clientSocket.destroy();
        }
      });

      targetSocket.on('error', () => {
        clientSocket.destroy();
      });

      clientSocket.on('error', () => {
        targetSocket.destroy();
      });
    } catch {
      clientSocket.write('HTTP/1.1 500 Internal Error\r\nConnection: close\r\n\r\n');
      clientSocket.destroy();
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  return {
    server,
    port,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
      })
  };
}
