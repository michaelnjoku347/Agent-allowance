import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildConfiguration } from './configure-payments.js';
import { loadRules } from '../agent/rules.js';

const key = '0x' + '11'.repeat(32); // Synthetic test key; never funded or used for network calls.
const payout = '0x' + '22'.repeat(20);
const rules = { budget: '20', maxPerPurchase: '5', expiresAt: '2026-12-31T23:59:59Z', allowedMerchants: ['0x' + '33'.repeat(20)] };
const source = { AGENT_PRIVATE_KEY: key, TEAM_NAME: 'AMD', CHANNEL_CAP: '5' };
const settings = { merchantId: '0x' + '44'.repeat(32), payout };

test('tested starter config connects the team merchant to local rules', () => {
  const configured = buildConfiguration({ source, settings, rules, useAgentAsSubmitter: true });
  assert.equal(configured.env.MERCHANT_ID, settings.merchantId);
  assert.equal(configured.env.MERCHANT_PAYOUT_ADDRESS, payout);
  assert.equal(configured.env.MERCHANT_SUBMITTER_KEY, key);
  assert.equal(configured.env.CHANNEL_CAP, '5');
  assert.deepEqual(configured.rules.allowedMerchants, [payout]);
  assert.notDeepEqual(rules.allowedMerchants, [payout]);
});

test('setup requires an explicit same-key submitter choice and refuses stale channel IDs', () => {
  assert.throws(() => buildConfiguration({ source, settings, rules }), /Missing MERCHANT_SUBMITTER_KEY/);
  assert.throws(() => buildConfiguration({ source: { ...source, CHANNEL_ID: '0x' + '55'.repeat(32) }, settings, rules, useAgentAsSubmitter: true }), /Clear CHANNEL_ID/);
});

test('key validation errors do not expose key values', () => {
  const secret = 'not-a-valid-secret-wallet';
  assert.throws(() => buildConfiguration({ source: { ...source, AGENT_PRIVATE_KEY: secret }, settings, rules, useAgentAsSubmitter: true }), error => {
    assert.equal(error.message.includes(secret), false);
    return /invalid/.test(error.message);
  });
});

test('server and payer load the same local allowance override', () => {
  const dir = mkdtempSync(join(tmpdir(), 'allowance-local-rules-'));
  const file = join(dir, 'rules.json');
  const previous = process.env.ALLOWANCE_RULES;
  try {
    writeFileSync(file, JSON.stringify({ ...rules, allowedMerchants: [payout] }));
    process.env.ALLOWANCE_RULES = file;
    assert.deepEqual(loadRules().allowedMerchants, [payout]);
  } finally {
    if (previous === undefined) delete process.env.ALLOWANCE_RULES;
    else process.env.ALLOWANCE_RULES = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
