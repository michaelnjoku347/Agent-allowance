import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchWithRetry } from './net.js';

test('retries a dropped connection and stops at three attempts', async () => {
  let calls = 0;
  const result = await fetchWithRetry(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('fetch failed');
    return { ok: true };
  }, 'https://hackathon.ap4m.build/public/config');
  assert.equal(result.ok, true);
  assert.equal(calls, 3);
});

test('does not retry an HTTP error or a different failure', async () => {
  let calls = 0;
  await assert.rejects(
    () => fetchWithRetry(async () => {
      calls += 1;
      throw new Error('sign-in failed (401)');
    }, 'https://hackathon.ap4m.build/public/participant/session'),
    /sign-in failed/,
  );
  assert.equal(calls, 1);
});
