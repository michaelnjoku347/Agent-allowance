import assert from 'node:assert/strict';
import test from 'node:test';
import { UNREACHABLE, approvalProgress, call, postJson } from './http.js';

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const refused = async () => { throw new TypeError('Failed to fetch'); };

test('a dropped connection is a sentence, never "Failed to fetch"', async () => {
  await assert.rejects(call('/api/run-agent', { fetchImpl: refused }), (error) => {
    assert.equal(error.message, UNREACHABLE);
    assert.equal(error.kind, 'unreachable');
    return true;
  });
  const slow = async (path, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  // AbortSignal.timeout does not hold the event loop open, so this test does.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(call('/api/status', { fetchImpl: slow, timeoutMs: 20 }), (error) => {
      assert.equal(error.kind, 'timeout');
      assert.match(error.message, /took too long/);
      return true;
    });
  } finally {
    clearTimeout(keepAlive);
  }
});

test('a refused request carries the server message, status, and code', async () => {
  await assert.rejects(postJson('/api/x', {}, 'fallback', 1000, reply(429, { error: 'rate_limited', message: 'Wait 3 seconds.' })), (error) => {
    assert.equal(error.message, 'Wait 3 seconds.');
    assert.equal(error.status, 429);
    assert.equal(error.kind, 'busy');
    return true;
  });
  await assert.rejects(postJson('/api/x', {}, 'Could not do that.', 1000, reply(500, {})), /Could not do that\./);
  assert.deepEqual(await postJson('/api/x', {}, 'f', 1000, reply(200, { ok: true })), { ok: true });
});

test('a paying approval reads as paid only when the server says the row is gone', async () => {
  assert.deepEqual(await approvalProgress('pend_1', { fetchImpl: reply(404, { error: 'missing' }) }), { inFlight: false, missing: true, phase: null });
  assert.deepEqual(await approvalProgress('pend_1', { fetchImpl: reply(200, { inFlight: true, phase: 'broadcasting' }) }), { inFlight: true, phase: 'broadcasting' });
  // A network blip or a server error must keep waiting, not claim the payment went through.
  for (const fetchImpl of [refused, reply(500, {}), reply(502, {}), reply(429, {})]) {
    const progress = await approvalProgress('pend_1', { fetchImpl });
    assert.equal(progress.inFlight, true);
    assert.equal(progress.missing, false);
  }
});
