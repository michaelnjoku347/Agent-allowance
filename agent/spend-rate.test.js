import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spendRateDecision } from './spend-rate.js';

const dir = mkdtempSync(join(tmpdir(), 'rate-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
delete process.env.AGENT_PRIVATE_KEY;

const { finishQuote } = await import('./agent.js');
const { recordAgentPayment } = await import('../server/store.js');
const { loadRules } = await import('./rules.js');

const now = Date.parse('2026-10-25T12:00:00.000Z');

function paid(amount, createdAt) {
  return { status: 'paid', sample: false, amount, createdAt };
}

test('three purchases or more than 0.05 RLUSD in an hour needs a person', () => {
  const hour = new Date(now).toISOString();
  assert.equal(spendRateDecision({ payments: [], amount: '0.01', now }).decision, 'allow');
  const three = [paid('0.01', hour), paid('0.01', hour), paid('0.01', hour)];
  assert.equal(spendRateDecision({ payments: three, amount: '0.01', now }).reason, 'over spend rate');
  const wide = [paid('0.05', hour)];
  assert.equal(spendRateDecision({ payments: wide, amount: '0.01', now }).reason, 'over spend rate');
  assert.equal(spendRateDecision({ payments: [paid('0.01', hour)], amount: '0.01', now }).decision, 'allow');
  const old = paid('0.05', new Date(now - 2 * 60 * 60 * 1000).toISOString());
  assert.equal(spendRateDecision({ payments: [old], amount: '0.01', now }).decision, 'allow');
});

test('the agent does not pay a fourth purchase inside the hour', async () => {
  const rules = loadRules();
  const merchant = rules.allowedMerchants[0];
  for (let i = 0; i < 3; i += 1) {
    await recordAgentPayment({
      merchant,
      merchantLabel: 'Field Weather Co',
      amount: '0.01',
      txHash: `0x${String(i + 1).repeat(64).slice(0, 64)}`,
      task: `Buy ${i}`,
    });
  }
  let paidCall = false;
  const result = await finishQuote({
    task: 'Buy another brief',
    resourceUrl: 'http://127.0.0.1:9/resource',
    quote: {
      merchant,
      amount: '0.01',
      description: 'Another brief',
      resourceUrl: 'http://127.0.0.1:9/resource',
    },
    rules,
    spent: '0.03',
    pay: async () => {
      paidCall = true;
    },
    plan: async () => null,
    review: async () => {
      throw new Error('Jev should not run after the rate limit');
    },
  });
  assert.equal(paidCall, false);
  assert.equal(result.reason, 'over spend rate');
  rmSync(dir, { recursive: true, force: true });
});
