import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'eve-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
process.env.ALLOWANCE_RULES = join(dir, 'rules.json');
copyFileSync(new URL('../agent/rules.json', import.meta.url), process.env.ALLOWANCE_RULES);
delete process.env.LLM_API_KEY;
delete process.env.JEV_API_KEY;

const { createApp } = await import('./index.js');
const { recordAgentPayment, recordPending, listPending } = await import('./store.js');
const { answerEve } = await import('./eve.js');
const { updateAllowance } = await import('../agent/rules.js');

for (const name of [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'BEDROCK_MODEL_ID',
]) {
  delete process.env[name];
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

const rules = JSON.parse(readFileSync(process.env.ALLOWANCE_RULES, 'utf8'));
const context = {
  spent: '1',
  rules: {
    budget: rules.budget,
    maxPerPurchase: rules.maxPerPurchase,
    expiresAt: rules.expiresAt,
    allowedMerchants: [],
  },
  payments: [{
    id: 'pay_today',
    sample: false,
    status: 'paid',
    amount: '1',
    merchant: '0xa11cea11cea11cea11cea11cea11cea11cea11ce',
    merchantLabel: 'Field Weather Co',
    createdAt: new Date().toISOString(),
  }],
  pending: [{
    id: 'pend_cap',
    sample: false,
    status: 'pending',
    amount: '8',
    merchant: '0xa11cea11cea11cea11cea11cea11cea11cea11ce',
    merchantLabel: 'Field Weather Co',
    reason: 'over per-purchase cap',
  }],
};

describe('Eve', { concurrency: false }, () => {
  test('no LLM key answers from the rules and does not call the network', async () => {
    let called = false;
    const spent = await answerEve('What did my agent spend today?', context, {
      env: {},
      fetchImpl: () => { called = true; },
    });
    assert.equal(called, false);
    assert.equal(spent.source, 'rules');
    assert.match(spent.reply, /1\.00 RLUSD/);
    const why = await answerEve('Why was the last one blocked?', context, { env: {} });
    assert.match(why.reply, /per-purchase cap/);
    const failed = await answerEve('What did my agent spend today?', context, {
      env: { LLM_API_KEY: 'secret', LLM_BASE_URL: 'https://llm.example/v1' },
      fetchImpl: async () => { throw new Error('down'); },
    });
    assert.match(failed.reply, /spent/i);
  });

  test('approve stays on the Ledger, then a cap change updates the rules', async () => {
    await recordAgentPayment({
      task: 'Buy the morning market brief',
      merchant: '0xa11cea11cea11cea11cea11cea11cea11cea11ce',
      merchantLabel: 'Field Weather Co',
      amount: '1',
      txHash: `0x${'ab'.repeat(32)}`,
    });
    const pending = await recordPending({
      task: 'Buy the extended market history',
      merchant: '0xa11cea11cea11cea11cea11cea11cea11cea11ce',
      merchantLabel: 'Field Weather Co',
      amount: '8',
      reason: 'over per-purchase cap',
    });

    const server = await listen(createApp());
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const ask = (message) => fetch(`${base}/api/eve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({ message }),
    });
    try {
      const spent = await (await ask('What did my agent spend today?')).json();
      assert.match(spent.reply, /spent/i);
      assert.equal(spent.bedrock, false);
      assert.equal(spent.confirmation, null);

      const why = await (await ask('Why was the last one blocked?')).json();
      assert.match(why.reply, /per-purchase cap/);

      const approve = await (await ask('Approve the pending purchase')).json();
      assert.equal(approve.confirmation, null);
      assert.match(approve.reply, /Ledger/);
      assert.equal((await listPending()).some((item) => item.id === pending.id), true);

      const tooHigh = await (await ask('Set my cap to 100')).json();
      assert.equal(tooHigh.confirmation, null);
      assert.match(tooHigh.reply, /no more than the budget/);
      const zero = await (await ask('Set my cap to 0')).json();
      assert.equal(zero.confirmation, null);

      const cap = await (await ask('Set my cap to 3')).json();
      assert.ok(cap.confirmation?.token);
      assert.match(cap.confirmation.summary, /cap to 3 RLUSD/);
      const saved = await fetch(`${base}/api/eve/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
        body: JSON.stringify({ token: cap.confirmation.token }),
      });
      assert.equal(saved.status, 200);
      const file = JSON.parse(readFileSync(process.env.ALLOWANCE_RULES, 'utf8'));
      assert.equal(file.maxPerPurchase, '3');
      assert.equal(file.budget, '20');

      const raise = await (await ask('Set my cap to 8')).json();
      assert.equal(raise.confirmation.ledger, true);
      assert.match(raise.confirmation.summary, /Ledger/);
      const refused = await fetch(`${base}/api/eve/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
        body: JSON.stringify({ token: raise.confirmation.token }),
      });
      assert.equal(refused.status, 400);
      const refusedBody = await refused.json();
      assert.match(refusedBody.error, /Ledger signature/);
      assert.equal(JSON.parse(readFileSync(process.env.ALLOWANCE_RULES, 'utf8')).maxPerPurchase, '3');

      assert.equal(updateAllowance({ maxPerPurchase: '8' }).code, 'needs_ledger');
      assert.equal(updateAllowance({ budget: '30' }).code, 'needs_ledger');
      assert.equal(updateAllowance({ expiresAt: '2027-06-01T00:00:00.000Z' }).code, 'needs_ledger');
      assert.equal(updateAllowance({
        allowedMerchants: [...file.allowedMerchants, '0x1212121212121212121212121212121212121212'],
      }).code, 'needs_ledger');
      const unchanged = JSON.parse(readFileSync(process.env.ALLOWANCE_RULES, 'utf8'));
      assert.equal(unchanged.maxPerPurchase, '3');
      assert.equal(unchanged.budget, '20');
      assert.equal(unchanged.expiresAt, file.expiresAt);
      assert.deepEqual(unchanged.allowedMerchants, file.allowedMerchants);

      const shorter = updateAllowance({ expiresAt: '2026-11-01T00:00:00.000Z' });
      assert.equal(shorter.ok, true);
      assert.equal(JSON.parse(readFileSync(process.env.ALLOWANCE_RULES, 'utf8')).expiresAt, '2026-11-01T00:00:00.000Z');
    } finally {
      await close(server);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
