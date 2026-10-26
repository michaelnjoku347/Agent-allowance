import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'audit-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
process.env.ALLOWANCE_RULES = join(dir, 'rules.json');
copyFileSync(new URL('../agent/rules.json', import.meta.url), process.env.ALLOWANCE_RULES);
delete process.env.AGENT_PRIVATE_KEY;
delete process.env.SERVE_DASHBOARD;

const { createApp } = await import('./index.js');
const { listAudit, recordAgentPayment, recordPending, setFreeze } = await import('./store.js');
const { finishQuote } = await import('../agent/agent.js');
const { loadRules } = await import('../agent/rules.js');

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

describe('audit, freeze, and use cases', { concurrency: false }, () => {
  test('allowed, blocked, and Ledger-approved decisions export with rule, reason, and signer', async () => {
    rmSync(process.env.ALLOWANCE_STORE, { force: true });
    const rules = loadRules();
    const merchant = rules.allowedMerchants[0];
    const hash = `0x${'ab'.repeat(32)}`;
    await recordAgentPayment({
      merchant,
      merchantLabel: 'Field Weather Co',
      amount: '0.01',
      txHash: hash,
      task: 'Buy the brief',
    });
    await recordAgentPayment({
      merchant,
      amount: '0.01',
      txHash: hash,
      task: 'Buy the brief',
      note: 'settled',
    });
    await recordPending({
      merchant,
      merchantLabel: 'Field Weather Co',
      amount: '0.08',
      reason: 'over per-purchase cap',
      task: 'Buy history',
    });
    const approver = `0x${'12'.repeat(20)}`;
    await recordAgentPayment({
      merchant,
      merchantLabel: 'Field Weather Co',
      amount: '0.08',
      txHash: `0x${'cd'.repeat(32)}`,
      task: 'Buy history',
      approver,
      note: 'Approved on a Ledger and paid once.',
    });

    const audit = await listAudit();
    assert.equal(audit.filter((row) => row.outcome === 'allowed' && row.signer === 'agent').length, 1);
    const blocked = audit.find((row) => row.rule === 'over per-purchase cap');
    assert.ok(blocked);
    assert.equal(blocked.outcome, 'blocked');
    assert.equal(blocked.signer, null);
    assert.match(blocked.reason, /per-purchase cap/);
    const ledger = audit.find((row) => row.outcome === 'ledger-approved');
    assert.equal(ledger.signer, approver);
    assert.equal(ledger.rule, 'ledger approved');

    const server = await listen(createApp());
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const origin = { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' };
    try {
      const exported = await (await fetch(`${base}/api/audit`)).json();
      assert.equal(exported.length, audit.length);
      assert.equal(JSON.stringify(exported).includes('PRIVATE'), false);

      delete process.env.AGENT_PRIVATE_KEY;
      delete process.env.TEAM_NAME;
      const noFreeze = await fetch(`${base}/api/freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"frozen":true}',
      });
      assert.equal(noFreeze.status, 403);
      const frozen = await fetch(`${base}/api/freeze`, {
        method: 'POST',
        headers: origin,
        body: '{"frozen":true}',
      });
      assert.equal(frozen.status, 200);
      assert.equal((await frozen.json()).frozen, true);

      const noOrigin = await fetch(`${base}/api/use-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"id":"travel"}',
      });
      assert.equal(noOrigin.status, 403);

      const before = readFileSync(process.env.ALLOWANCE_RULES, 'utf8');
      const selected = await fetch(`${base}/api/use-case`, {
        method: 'POST',
        headers: origin,
        body: '{"id":"travel"}',
      });
      assert.equal(selected.status, 200);
      assert.equal((await selected.json()).useCase.id, 'travel');
      assert.equal(readFileSync(process.env.ALLOWANCE_RULES, 'utf8'), before);
      const status = await (await fetch(`${base}/api/status`)).json();
      assert.equal(status.frozen, true);
      assert.equal(status.useCase.id, 'travel');
      assert.equal(status.rules.budget, '0.2');

      const unknown = await fetch(`${base}/api/use-case`, {
        method: 'POST',
        headers: origin,
        body: '{"id":"nope"}',
      });
      assert.equal(unknown.status, 400);

      const run = await fetch(`${base}/api/run-agent`, { method: 'POST', headers: origin, body: '{}' });
      assert.equal(run.status, 409);
      assert.match((await run.json()).error, /frozen/);

      const opened = await fetch(`${base}/api/freeze`, {
        method: 'POST',
        headers: origin,
        body: '{"frozen":false}',
      });
      assert.equal((await opened.json()).frozen, false);
    } finally {
      await close(server);
    }
  });

  test('a frozen agent does not call pay', async () => {
    await setFreeze(true);
    let paid = false;
    const rules = loadRules();
    const result = await finishQuote({
      task: 'Buy the brief',
      resourceUrl: 'http://127.0.0.1:9/resource',
      quote: {
        merchant: rules.allowedMerchants[0],
        amount: '0.01',
        description: 'brief',
        resourceUrl: 'http://127.0.0.1:9/resource',
      },
      rules,
      spent: '0',
      pay: async () => {
        paid = true;
      },
      plan: async () => null,
      review: async () => {
        throw new Error('review should not run');
      },
    });
    assert.equal(paid, false);
    assert.equal(result.reason, 'agent frozen');
    await setFreeze(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
