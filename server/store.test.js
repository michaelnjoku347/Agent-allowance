import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'allowance-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');

const { createApp } = await import('./index.js');
const { recordAgentPayment, recordPending, spentRlusd } = await import('./store.js');

function resetStore() {
  rmSync(process.env.ALLOWANCE_STORE, { force: true });
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

describe('allowance API', { concurrency: false }, () => {
  test('serves sample budget data and refuses an unsigned approval', async () => {
    resetStore();
    const server = await listen(createApp());
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
      const status = await (await fetch(`${base}/api/status`)).json();
      assert.equal(status.budget, '20');
      assert.equal(status.localSpent, '0');
      assert.equal(status.spent, '0');
      assert.equal(status.remaining, '20');
      assert.equal(status.chain, null);
      assert.equal(status.currency, 'RLUSD');
      assert.equal(status.agentConnected, false);
      assert.equal(await spentRlusd(), '0');
      assert.equal(status.network.chainId, 1449000);
      assert.equal(status.rules.maxPerPurchase, '5');
      assert.equal(status.rules.allowedMerchants.length, 2);

      const payments = await (await fetch(`${base}/api/payments`)).json();
      assert.equal(payments.length, 3);
      assert.equal(payments.every((payment) => payment.sample && payment.explorerUrl === null), true);
      assert.match(payments[0].txHash, /^0x[0-9a-f]{64}$/);
      assert.match(payments[0].channelId, /^0x[0-9a-f]{64}$/);
      assert.match(payments[0].claimId, /^0x[0-9a-f]{64}$/);
      assert.match(payments[0].payoutTx, /^0x[0-9a-f]{64}$/);

      const pending = await (await fetch(`${base}/api/pending`)).json();
      const imagery = pending.find((item) => item.reason === 'over per-purchase cap');
      assert.ok(imagery);

      const approved = await fetch(`${base}/api/approve/${imagery.id}`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:5173' },
      });
      assert.equal(approved.status, 400);
      const body = await approved.json();
      assert.match(body.message, /Ledger signature is required/i);

      const pendingAfter = await (await fetch(`${base}/api/pending`)).json();
      assert.equal(pendingAfter.some((item) => item.id === imagery.id), true);
      const paymentsAfter = await (await fetch(`${base}/api/payments`)).json();
      assert.equal(paymentsAfter.some((payment) => payment.status === 'approved'), false);

      // An unsigned approval does not spend the allowance or pretend the agent ran.
      const statusAfter = await (await fetch(`${base}/api/status`)).json();
      assert.equal(statusAfter.spent, '0');
      assert.equal(statusAfter.localSpent, '0');
      assert.equal(statusAfter.agentConnected, false);

      const again = await fetch(`${base}/api/approve/${imagery.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
        body: JSON.stringify({ signature: '0x1234', message: { purchaseId: imagery.id } }),
      });
      assert.equal(again.status, 400);
    } finally {
      await close(server);
    }
  });

  test('a real agent decision replaces the sample rows', async () => {
    resetStore();
    const pending = await recordPending({
      task: 'Buy a dataset that is too expensive',
      merchant: '0xa11cea11cea11cea11cea11cea11cea11cea11ce',
      merchantLabel: 'Field Weather Co',
      amount: '8',
      reason: 'over per-purchase cap',
      description: 'Quoted 8 RLUSD.',
      resourceUrl: 'http://127.0.0.1:4308/resource',
    });
    assert.equal(pending.sample, false);

    const server = await listen(createApp());
    const { port } = server.address();
    try {
      const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
      assert.equal(status.agentConnected, true);
      assert.equal(status.spent, '0');
      const waiting = await (await fetch(`http://127.0.0.1:${port}/api/pending`)).json();
      assert.deepEqual(waiting.map((item) => item.id), [pending.id]);
      const payments = await (await fetch(`http://127.0.0.1:${port}/api/payments`)).json();
      assert.equal(payments.length, 0);
    } finally {
      await close(server);
    }

    const paid = await recordAgentPayment({
      task: 'Morning weather brief',
      merchant: '0xA11CEA11CEA11CEA11CEA11CEA11CEA11CEA11CE',
      merchantLabel: 'Field Weather Co',
      amount: '1',
      txHash: `0x${'ab'.repeat(32)}`,
      claimId: 'claim-demo',
      receiptUrl: 'https://hackathon.ap4m.build/public/evidence/claims/claim-demo.json',
    });
    assert.equal(paid.status, 'paid');
    assert.equal(paid.amount, '1');

    const server2 = await listen(createApp());
    const port2 = server2.address().port;
    try {
      const payments = await (await fetch(`http://127.0.0.1:${port2}/api/payments`)).json();
      const live = payments.find((payment) => payment.id === paid.id);
      assert.equal(live.explorerUrl, `https://explorer.testnet.xrplevm.org/tx/${paid.txHash}`);
      assert.equal(live.receiptUrl, 'https://hackathon.ap4m.build/public/evidence/claims/claim-demo.json');
      assert.equal(live.claimId, 'claim-demo');
      const status = await (await fetch(`http://127.0.0.1:${port2}/api/status`)).json();
      assert.equal(status.spent, '1');
      assert.equal(status.remaining, '19');
    } finally {
      await close(server2);
    }
  });

  test('run-agent does not spawn when the wallet is not configured', async () => {
    const saved = {
      AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY,
      TEAM_NAME: process.env.TEAM_NAME,
      RESOURCE_URL: process.env.RESOURCE_URL,
    };
    delete process.env.AGENT_PRIVATE_KEY;
    delete process.env.TEAM_NAME;
    delete process.env.RESOURCE_URL;
    resetStore();
    const server = await listen(createApp());
    const { port } = server.address();
    try {
      const blocked = await fetch(`http://127.0.0.1:${port}/api/run-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'Buy the morning weather brief' }),
      });
      assert.equal(blocked.status, 403);
      const foreign = await fetch(`http://127.0.0.1:${port}/api/run-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' },
        body: JSON.stringify({ task: 'Buy the morning weather brief' }),
      });
      assert.equal(foreign.status, 403);
      const response = await fetch(`http://127.0.0.1:${port}/api/run-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
        body: JSON.stringify({ task: 'Buy the morning weather brief; rm -rf /' }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.demo, true);
      assert.equal(body.task, 'Buy the morning weather brief; rm -rf /');
      assert.match(body.error, /AGENT_PRIVATE_KEY/);
    } finally {
      await close(server);
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('repeated redemption recording updates settlement without double-counting the budget', async () => {
  resetStore();
  const input = { task: 'Recovery', amount: '1', merchant: '0x' + '11'.repeat(20), txHash: '0x' + 'aa'.repeat(32) };
  const first = await recordAgentPayment(input);
  const settled = await recordAgentPayment({ ...input, payoutTx: '0x' + 'bb'.repeat(32), receiptUrl: 'https://hackathon.ap4m.build/public/evidence/example.json' });
  assert.equal(first.id, settled.id);
  assert.equal(await spentRlusd(), '1');
  const { listPayments } = await import('./store.js');
  let rows = await listPayments();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].settlementStatus, 'settled');
  await recordAgentPayment({ ...input, receiptUrl: null, payoutTx: null });
  rows = await listPayments();
  assert.equal(rows[0].payoutTx, settled.payoutTx);
  await assert.rejects(recordAgentPayment({ ...input, amount: '2' }), /Conflicting/);
  assert.equal(await spentRlusd(), '1');
  rmSync(dir, { recursive: true, force: true });
});

test('sample rows stay out of /api/pending once real data exists, even without agentConnected', async () => {
  const { writeFileSync } = await import('node:fs');
  const { listPayments, listPending, readStore } = await import('./store.js');
  resetStore();
  const seeded = await readStore();
  assert.ok((await listPending()).some((row) => row.id === 'pend_sample_research'), 'samples show on a fresh store');
  writeFileSync(process.env.ALLOWANCE_STORE, JSON.stringify({
    ...seeded,
    agentConnected: false,
    pending: [
      ...seeded.pending,
      {
        id: 'pend_real',
        sample: false,
        status: 'pending',
        task: 'Buy the satellite pack',
        merchant: '0xa11cea11cea11cea11cea11cea11cea11cea11ce',
        merchantLabel: 'Field Weather Co',
        amount: '8',
        reason: 'over per-purchase cap',
        createdAt: new Date().toISOString(),
      },
    ],
  }));
  const pending = await listPending();
  assert.deepEqual(pending.map((row) => row.id), ['pend_real']);
  assert.ok((await listPayments()).every((row) => !row.sample));
  const server = await listen(createApp({ channelState: async () => null }));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const rows = await (await fetch(`${url}/api/pending`)).json();
    assert.equal(rows.some((row) => row.id === 'pend_sample_research'), false);
    const status = await (await fetch(`${url}/api/status`)).json();
    assert.equal(status.agentConnected, true, 'the dashboard stops treating it as a demo');
  } finally {
    await close(server);
    resetStore();
  }
});
