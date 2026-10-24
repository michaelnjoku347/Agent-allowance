import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'allowance-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');

const { createApp } = await import('./index.js');
const { recordAgentPayment, recordPending } = await import('./store.js');

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
  test('serves sample budget data and a placeholder approval', async () => {
    resetStore();
    const server = await listen(createApp());
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
      const status = await (await fetch(`${base}/api/status`)).json();
      assert.equal(status.budget, '20');
      assert.equal(status.spent, '7.5');
      assert.equal(status.remaining, '12.5');
      assert.equal(status.currency, 'RLUSD');
      assert.equal(status.agentConnected, false);
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

      const approved = await fetch(`${base}/api/approve/${imagery.id}`, { method: 'POST' });
      assert.equal(approved.status, 200);
      const body = await approved.json();
      assert.equal(body.payment.status, 'approved');
      assert.equal(body.payment.txHash, null);
      assert.match(body.note, /nothing was signed or paid/i);

      const pendingAfter = await (await fetch(`${base}/api/pending`)).json();
      assert.equal(pendingAfter.some((item) => item.id === imagery.id), false);
      const paymentsAfter = await (await fetch(`${base}/api/payments`)).json();
      assert.equal(paymentsAfter[0].status, 'approved');

      // Approving a sample does not spend the allowance or pretend the agent ran.
      const statusAfter = await (await fetch(`${base}/api/status`)).json();
      assert.equal(statusAfter.spent, '7.5');
      assert.equal(statusAfter.agentConnected, false);

      const again = await fetch(`${base}/api/approve/${imagery.id}`, { method: 'POST' });
      assert.equal(again.status, 404);
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
      const response = await fetch(`http://127.0.0.1:${port}/api/run-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'Buy the morning weather brief; rm -rf /' }),
      });
      assert.equal(response.status, 200);
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
