import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'backup-demo-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
delete process.env.APPROVER_ADDRESS;
process.env.ALLOWANCE_DEV_SIGNER = '1';

const { rehearseBackupDemo, simulateLedgerApproval, SIMULATED_LEDGER_NOTE } = await import('./backup-demo.js');
const { createApp } = await import('./index.js');
const { listPayments, listPending } = await import('./store.js');

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

describe('backup demo signer', { concurrency: false }, () => {
  test('the simulated route is absent unless the backup flag is on', async () => {
    delete process.env.ALLOWANCE_DEV_SIGNER;
    const server = await listen(createApp());
    try {
      const { port } = server.address();
      const missing = await fetch(`http://127.0.0.1:${port}/api/demo/simulated-ledger/pend_x`, { method: 'POST' });
      assert.equal(missing.status, 404);
      const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
      assert.equal(status.simulatedLedger, false);
    } finally {
      await close(server);
      process.env.ALLOWANCE_DEV_SIGNER = '1';
    }
  });

  test('rehearse records an in-rule payment and two blocks, with no transaction hash', async () => {
    const seeded = await rehearseBackupDemo();
    assert.equal(seeded.paid.amount, '1');
    assert.equal(seeded.paid.task, 'Buy the morning market brief');
    assert.equal(seeded.paid.txHash, null);
    const payments = await listPayments();
    assert.equal(payments.length, 1);
    assert.equal(payments[0].sample, false);
    assert.equal(payments[0].status, 'paid');
    assert.equal(payments[0].txHash, null);
    assert.equal(payments[0].explorerUrl, null);
    assert.equal(payments[0].simulatedLedger, false);
    const pending = await listPending();
    assert.equal(pending.length, 2);
    assert.ok(pending.some((item) => item.reason === 'over per-purchase cap' && item.amount === '8'));
    assert.ok(pending.some((item) => item.reason === 'merchant not allowed' && item.amount === '1'));
  });

  test('a simulated Ledger signature pays the unlisted quote once and leaves the cap blocked', async () => {
    const pending = await listPending();
    const unlisted = pending.find((item) => item.reason === 'merchant not allowed');
    const first = await simulateLedgerApproval(unlisted.id);
    assert.equal(first.status, 200);
    assert.equal(first.body.note, SIMULATED_LEDGER_NOTE);
    assert.equal(first.body.simulated, true);
    assert.equal(first.body.payment.txHash, null);
    assert.equal(first.body.payment.simulatedLedger, true);
    const dumped = JSON.stringify(first);
    assert.equal(dumped.includes('privateKey'), false);
    assert.equal(dumped.includes(SIMULATED_LEDGER_NOTE), true);
    const payments = await listPayments();
    const approved = payments.find((item) => item.task === 'Buy a quote from an outside desk');
    assert.equal(approved.note, SIMULATED_LEDGER_NOTE);
    assert.equal(approved.simulatedLedger, true);
    assert.equal(approved.explorerUrl, null);
    const second = await simulateLedgerApproval(unlisted.id);
    assert.equal(second.status, 404);
    const still = await listPending();
    assert.equal(still.some((item) => item.reason === 'over per-purchase cap'), true);
    assert.equal(still.some((item) => item.reason === 'merchant not allowed'), false);
  });

  test('the challenge uses the backup approver when no Ledger address is set', async () => {
    await rehearseBackupDemo();
    const unlisted = (await listPending()).find((item) => item.reason === 'merchant not allowed');
    const server = await listen(createApp());
    try {
      const { port } = server.address();
      const challenge = await fetch(`http://127.0.0.1:${port}/api/approve/${unlisted.id}/challenge`, { method: 'POST' });
      const body = await challenge.json();
      assert.equal(challenge.status, 200);
      assert.match(body.approverAddress, /^0x[0-9a-fA-F]{40}$/);
      assert.equal(body.display.amount, '1');
      const signed = await fetch(`http://127.0.0.1:${port}/api/demo/simulated-ledger/${unlisted.id}`, { method: 'POST' });
      const paid = await signed.json();
      assert.equal(signed.status, 200);
      assert.equal(paid.note, SIMULATED_LEDGER_NOTE);
      assert.equal(paid.payment.approver, body.approverAddress.toLowerCase());
    } finally {
      await close(server);
    }
  });

  test('the route uses the same label when the flag is on', async () => {
    await rehearseBackupDemo();
    const unlisted = (await listPending()).find((item) => item.reason === 'merchant not allowed');
    const server = await listen(createApp());
    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/api/demo/simulated-ledger/${unlisted.id}`, { method: 'POST' });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.note, SIMULATED_LEDGER_NOTE);
      assert.equal(body.payment.note, SIMULATED_LEDGER_NOTE);
      assert.equal(JSON.stringify(body).includes('privateKey'), false);
      const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
      assert.equal(status.simulatedLedger, true);
      assert.equal(status.spent, '2');
    } finally {
      await close(server);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
