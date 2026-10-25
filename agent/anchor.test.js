import assert from 'node:assert/strict';
import test from 'node:test';
import { anchorDecision, decisionHash } from './anchor.js';

const row = {
  id: 'aud_1',
  at: '2026-10-25T00:00:00.000Z',
  outcome: 'blocked',
  rule: 'merchant not allowed',
  amount: '50',
};

test('a missing wallet returns the decision hash and does not invent a transaction', async () => {
  const hash = decisionHash(row);
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  let called = false;
  const result = await anchorDecision({
    row,
    env: { AGENT_PRIVATE_KEY: '' },
    send: async () => {
      called = true;
      return `0x${'ab'.repeat(32)}`;
    },
  });
  assert.equal(called, false);
  assert.equal(result.anchored, false);
  assert.equal(result.hash, hash);
  assert.equal(result.txHash, null);
  assert.match(result.reason, /not anchored/);
});

test('a broadcast hash is kept only when it is a real transaction hash', async () => {
  const txHash = `0x${'cd'.repeat(32)}`;
  const result = await anchorDecision({
    row,
    env: { AGENT_PRIVATE_KEY: `0x${'ab'.repeat(32)}` },
    send: async () => txHash,
  });
  assert.equal(result.anchored, true);
  assert.equal(result.txHash, txHash);
  assert.match(result.reason, /XRPL EVM/);
});
