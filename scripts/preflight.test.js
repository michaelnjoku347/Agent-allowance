import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePreflight } from './preflight.js';

const ready = {
  approverSet: true,
  devSigner: false,
  walletConfigured: true,
  channelRead: true,
  channelCap: '20',
  budget: '20',
  redeemed: '1',
  localSpent: '1',
  briefUp: true,
  historyUp: true,
  briefUrl: 'http://127.0.0.1:4308/resource',
  historyUrl: 'http://127.0.0.1:4318/resource',
  bedrockConfigured: false,
};

test('preflight names the run-agent mode and does not fail only because Bedrock is off', () => {
  const result = evaluatePreflight(ready);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'Fallback (Bedrock not configured)');
  assert.equal(evaluatePreflight({ ...ready, bedrockConfigured: true }).mode, 'Amazon Bedrock');
});

test('preflight fails when the channel cap is below the budget or the merchants are down', () => {
  const short = evaluatePreflight({ ...ready, channelCap: '5' });
  assert.equal(short.ok, false);
  assert.match(short.problems.join('\n'), /below the budget/);
  const down = evaluatePreflight({ ...ready, historyUp: false, devSigner: true });
  assert.match(down.problems.join('\n'), /history merchant/);
  assert.match(down.problems.join('\n'), /ALLOWANCE_DEV_SIGNER/);
});
