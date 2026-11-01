import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createSafeProxy, validateAndPinHost } from '../src/safeProxy.js';

test('safeProxy: DNS Rebinding defense pins first validated IP and keeps canary hit count at 0', async () => {
  let canaryHits = 0;
  const canaryServer = http.createServer((req, res) => {
    canaryHits++;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('CANARY_HIT');
  });
  await new Promise((resolve) => canaryServer.listen(0, '127.0.0.1', resolve));
  const canaryPort = canaryServer.address().port;

  // Real backend server representing the pinned target
  const targetServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('PINNED_TARGET_OK');
  });
  await new Promise((resolve) => targetServer.listen(0, '127.0.0.1', resolve));
  const targetPort = targetServer.address().port;

  let resolveCount = 0;
  // Injected resolver: returns benign public IP on first lookup, loopback on subsequent
  const injectedResolver = async (host) => {
    resolveCount++;
    if (resolveCount === 1) {
      return [{ address: '93.184.216.34', family: 4 }];
    }
    return [{ address: '127.0.0.1', family: 4 }];
  };

  const connectorCalls = [];
  const injectedConnector = (connOpts, cb) => {
    connectorCalls.push({ ...connOpts });
    if (connOpts.host === '93.184.216.34') {
      return net.createConnection({ host: '127.0.0.1', port: targetPort }, cb);
    }
    return net.createConnection(connOpts, cb);
  };

  const proxy = await createSafeProxy({
    resolver: injectedResolver,
    connector: injectedConnector
  });

  try {
    // Send request through proxy to rebind.test
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxy.port,
          method: 'GET',
          path: 'http://rebind.test/index.html',
          headers: { Host: 'rebind.test' }
        },
        resolve
      );
      req.on('error', reject);
      req.end();
    });

    assert.equal(res.statusCode, 200);
    assert.equal(connectorCalls.length, 1);
    assert.equal(connectorCalls[0].host, '93.184.216.34', 'Must connect to pinned IP');
    assert.equal(canaryHits, 0, 'Canary server on 127.0.0.1 must NEVER be reached');
  } finally {
    await proxy.close();
    await new Promise((resolve) => targetServer.close(resolve));
    await new Promise((resolve) => canaryServer.close(resolve));
  }
});

test('safeProxy: blocks metadata, decimal/hex/octal literals, IPv4-mapped IPv6, CGNAT, and social hosts', async () => {
  const connectorCalls = [];
  const injectedConnector = (connOpts, cb) => {
    connectorCalls.push(connOpts);
    return new net.Socket();
  };

  const proxy = await createSafeProxy({ connector: injectedConnector });

  const testTargets = [
    { name: 'Metadata IP', url: 'http://169.254.169.254/' },
    { name: 'Alibaba Metadata', url: 'http://100.100.100.200/' },
    { name: 'Decimal IP (127.0.0.1)', url: 'http://2130706433/' },
    { name: 'Hex IP (127.0.0.1)', url: 'http://0x7f000001/' },
    { name: 'Octal IP (127.0.0.1)', url: 'http://0177.0.0.1/' },
    { name: 'IPv4-mapped IPv6', url: 'http://[::ffff:127.0.0.1]/' },
    { name: 'Carrier-grade NAT', url: 'http://100.64.0.1/' },
    { name: 'Instagram', url: 'http://instagram.com/' },
    { name: 'Facebook', url: 'http://facebook.com/' },
    { name: 'LinkedIn', url: 'http://linkedin.com/' }
  ];

  try {
    for (const target of testTargets) {
      const res = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxy.port,
            method: 'GET',
            path: target.url
          },
          resolve
        );
        req.on('error', reject);
        req.end();
      });

      assert.equal(
        res.statusCode,
        403,
        `${target.name} (${target.url}) must return 403 Forbidden`
      );
    }

    assert.equal(connectorCalls.length, 0, 'Connector must NEVER be called for blocked targets');
  } finally {
    await proxy.close();
  }
});

test('safeProxy: refuses port 8080 and non-GET/HEAD methods on plain HTTP', async () => {
  const connectorCalls = [];
  const proxy = await createSafeProxy({
    connector: (opts) => {
      connectorCalls.push(opts);
      return new net.Socket();
    }
  });

  try {
    // 1. Port 8080 refused with 403
    const resPort = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxy.port,
          method: 'GET',
          path: 'http://example.com:8080/'
        },
        resolve
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(resPort.statusCode, 403);

    // 2. POST method refused with 405 Method Not Allowed
    const resPost = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxy.port,
          method: 'POST',
          path: 'http://example.com/'
        },
        resolve
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(resPost.statusCode, 405);

    assert.equal(connectorCalls.length, 0, 'Connector must never be called for invalid port or method');
  } finally {
    await proxy.close();
  }
});

test('safeProxy: byte cap terminates connection and counts bytes accurately', async () => {
  const content = 'X'.repeat(5000);
  const dataServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(content);
  });
  await new Promise((resolve) => dataServer.listen(0, '127.0.0.1', resolve));
  const dataPort = dataServer.address().port;

  let trackedBytes = 0;
  const proxy = await createSafeProxy({
    byteCap: 1000,
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    connector: (connOpts, cb) => net.createConnection({ host: '127.0.0.1', port: dataPort }, cb),
    onBytes: (b) => {
      trackedBytes += b;
    }
  });

  try {
    // Stream request through proxy
    await new Promise((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxy.port,
          method: 'GET',
          path: 'http://data.test/'
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
          res.on('error', resolve);
        }
      );
      req.on('error', resolve);
      req.end();
    });

    assert.ok(trackedBytes >= 1000, 'Tracked bytes must register streamed chunks up to/exceeding cap');

    // Subsequent request is refused with 413 Payload Too Large
    const resBlocked = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxy.port,
          method: 'GET',
          path: 'http://data.test/'
        },
        resolve
      );
      req.on('error', reject);
      req.end();
    });

    assert.equal(resBlocked.statusCode, 413, 'Subsequent request must return 413 Payload Too Large');
  } finally {
    await proxy.close();
    await new Promise((resolve) => dataServer.close(resolve));
  }
});
