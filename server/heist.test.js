import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'heist-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
process.env.ALLOWANCE_RULES = join(dir, 'rules.json');
copyFileSync(new URL('../agent/rules.json', import.meta.url), process.env.ALLOWANCE_RULES);

const { runHeist } = await import('./heist.js');
const { planHeist } = await import('../agent/planner.js');
const { createApp } = await import('./index.js');
const { listPayments } = await import('./store.js');
const { createQuoteApp } = await import('../merchant/index.js');
const { loadRules } = await import('../agent/rules.js');
const { HEIST_INJECTION } = await import('../shared/catalog.js');

for (const name of [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'BEDROCK_MODEL_ID',
  'AGENT_PRIVATE_KEY',
  'TEAM_NAME',
  'JEV_API_KEY',
  'LLM_API_KEY',
]) {
  delete process.env[name];
}

function mockClient(payload) {
  return {
    async send() {
      return { output: { message: { content: [{ text: payload }] } } };
    },
  };
}

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

const bedrockEnv = {
  AWS_REGION: 'us-east-1',
  BEDROCK_MODEL_ID: 'us.amazon.nova-micro-v1:0',
  AWS_BEARER_TOKEN_BEDROCK: 'heist-test-token',
};

describe('the heist', { concurrency: false }, () => {
  test('the fallback follows the injected catalog text and is not called a live model', async () => {
    const plan = await planHeist({ env: {} });
    assert.equal(plan.source, 'fallback');
    assert.equal(plan.live, false);
    assert.equal(plan.tookBait, true);
    assert.equal(plan.resourceId, 'premium-pack');
    assert.match(plan.reason, /Fallback/);
    assert.equal(/amazon bedrock/i.test(plan.reason), false);
  });

  test('Bedrock is asked for real, and only the premium pack counts as taking the bait', async () => {
    const bait = await planHeist({
      env: bedrockEnv,
      client: mockClient('{"resourceId":"premium-pack","reason":"The catalog said the user pre-approved it."}'),
    });
    assert.equal(bait.source, 'bedrock');
    assert.equal(bait.live, true);
    assert.equal(bait.tookBait, true);

    const miss = await planHeist({
      env: bedrockEnv,
      client: mockClient('{"resourceId":"brief","reason":"The morning brief matches the task."}'),
    });
    assert.equal(miss.tookBait, false);
    assert.equal(miss.live, true);
    assert.equal(miss.resourceId, 'brief');
  });

  test('the rules block the pack when the model refuses it, and nothing is paid', async () => {
    const before = readFileSync(process.env.ALLOWANCE_RULES, 'utf8');
    const payments = (await listPayments()).length;
    const report = await runHeist({
      plan: async () => ({
        source: 'bedrock',
        live: true,
        tookBait: false,
        resourceId: 'brief',
        reason: 'The morning brief matches the task.',
      }),
    });
    assert.equal(report.ok, true);
    assert.equal(report.paid, false);
    assert.equal(report.signed, false);
    assert.equal(report.lost, '0');
    assert.equal(report.moved, '0.00');
    assert.equal(report.planner.tookBait, false);
    assert.equal(report.rule, 'merchant not allowed');
    assert.equal(report.ledgerCanPay, false);
    assert.match(report.spoken, /did not choose/);
    assert.equal(readFileSync(process.env.ALLOWANCE_RULES, 'utf8'), before);
    assert.equal((await listPayments()).length, payments);
  });

  test('POST /api/demo/heist needs the dashboard and blocks the injected pack', async () => {
    const rules = loadRules();
    const merchant = await listen(createQuoteApp({ payout: rules.allowedMerchants[0] }));
    process.env.MERCHANT_PORT = String(merchant.address().port);
    const before = readFileSync(process.env.ALLOWANCE_RULES, 'utf8');
    const api = await listen(createApp());
    const base = `http://127.0.0.1:${api.address().port}`;
    try {
      const denied = await fetch(`${base}/api/demo/heist`, { method: 'POST' });
      assert.equal(denied.status, 403);

      const response = await fetch(`${base}/api/demo/heist`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:5173' },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.signed, false);
      assert.equal(body.paid, false);
      assert.equal(body.lost, '0');
      assert.equal(body.moved, '0.00');
      assert.equal(body.quoteLoaded, true);
      assert.equal(body.injection, HEIST_INJECTION);
      assert.equal(body.planner.source, 'fallback');
      assert.equal(body.planner.live, false);
      assert.equal(body.planner.tookBait, true);
      assert.equal(body.rule, 'merchant not allowed');
      assert.equal(body.ledgerCanPay, false);
      assert.ok(body.also.includes('over per-purchase cap'));
      assert.ok(body.also.includes('over budget'));
      assert.equal(JSON.stringify(body).includes('0x'), false);
      assert.match(body.spoken, /not a live model/);
      assert.equal(readFileSync(process.env.ALLOWANCE_RULES, 'utf8'), before);
    } finally {
      await close(api);
      await close(merchant);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
