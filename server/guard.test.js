import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'guard-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');

const { createApp } = await import('./index.js');

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

function raw({ port, method, path, host, origin, body = '' }) {
  return new Promise((resolve, reject) => {
    const headers = {
      Host: host,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    if (origin) headers.Origin = origin;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('state-changing posts need a localhost host and the dashboard origin', async () => {
  const server = await listen(createApp());
  const { port } = server.address();
  try {
    const status = await raw({
      port,
      method: 'GET',
      path: '/api/status',
      host: `127.0.0.1:${port}`,
    });
    assert.equal(status.status, 200);

    const noOrigin = await raw({
      port,
      method: 'POST',
      path: '/api/decline/missing',
      host: `127.0.0.1:${port}`,
      body: '{}',
    });
    assert.equal(noOrigin.status, 403);

    const rebinding = await raw({
      port,
      method: 'POST',
      path: '/api/decline/missing',
      host: 'evil.example',
      origin: 'http://127.0.0.1:5173',
      body: '{}',
    });
    assert.equal(rebinding.status, 403);
    assert.match(rebinding.body.error, /localhost/);

    const allowed = await raw({
      port,
      method: 'POST',
      path: '/api/decline/missing',
      host: `127.0.0.1:${port}`,
      origin: 'http://127.0.0.1:5173',
      body: '{}',
    });
    assert.equal(allowed.status, 404);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
