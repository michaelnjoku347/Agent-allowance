import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'over-cap-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');

const { demonstrateOverCap, describeContractCap } = await import('./over-cap.js');
const { createQuoteApp } = await import('../merchant/index.js');
const { createApp } = await import('../server/index.js');
const { listPending } = await import('../server/store.js');
const { loadRules } = await import('./rules.js');

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

describe('over-cap demo', { concurrency: false }, () => {
test('a 6 RLUSD quote is rejected by the rules and nothing is signed', async () => {
  const rules = loadRules();
  const quoteServer = await listen(createQuoteApp({ payout: rules.allowedMerchants[0] }));
  const { port } = quoteServer.address();
  try {
    const result = await demonstrateOverCap({
      resourceUrl: `http://127.0.0.1:${port}/demo/over-cap-6`,
      rules,
    });
    assert.equal(result.signed, false);
    assert.equal(result.amount, '6');
    assert.equal(result.cap, '5');
    assert.equal(result.reason, 'over per-purchase cap');
    assert.equal(result.decision, 'needs_approval');
    assert.equal(result.txHash ?? null, null);
    const pending = await listPending();
    assert.equal(pending.some((item) => item.amount === '6' && item.reason === 'over per-purchase cap' && !item.sample), true);
  } finally {
    await close(quoteServer);
  }
});

test('contract cap evidence is shown only when the simulation left redeemed state unchanged', () => {
  const missing = describeContractCap(null);
  assert.equal(missing.ran, false);
  assert.equal(missing.rejectionData, undefined);

  const dirty = describeContractCap({
    method: 'eth_call (simulation, no payment broadcast)',
    rejectionData: '0x12345678',
    redeemedBefore: '1',
    redeemedAfter: '2',
    merchantBalanceBefore: '0',
    merchantBalanceAfter: '0',
  });
  assert.equal(dirty.ran, false);
  assert.equal(dirty.rejectionData, undefined);

  const clean = describeContractCap({
    method: 'eth_call (simulation, no payment broadcast)',
    rejectionData: '0x12345678',
    redeemedBefore: '10',
    redeemedAfter: '10',
    merchantBalanceBefore: '4',
    merchantBalanceAfter: '4',
    channelId: `0x${'ab'.repeat(32)}`,
    blockNumber: 12,
    capRlusd: '5',
    rejectedCumulativeRlusd: '6',
  });
  assert.equal(clean.ran, true);
  assert.equal(clean.redeemedBefore, clean.redeemedAfter);
  assert.equal(clean.rejectionData, '0x12345678');
});

test('POST /api/demo/over-cap records the rules rejection and does not invent a contract result', async () => {
  const server = await listen(createApp());
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/demo/over-cap`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.signed, false);
    assert.equal(body.amount, '6');
    assert.equal(body.cap, '5');
    assert.equal(body.reason, 'over per-purchase cap');
    assert.equal(body.contract.ran, false);
    assert.equal(body.contract.rejectionData, undefined);
    const pending = await (await fetch(`http://127.0.0.1:${port}/api/pending`)).json();
    assert.equal(pending.some((item) => item.amount === '6' && item.reason === 'over per-purchase cap'), true);
  } finally {
    await close(server);
    rmSync(dir, { recursive: true, force: true });
  }
});
});
