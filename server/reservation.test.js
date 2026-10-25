import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'reserve-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');

const { loadRules } = await import('../agent/rules.js');
const {
  claimApprovalSignature,
  recordPending,
  releaseReservation,
  reserveSpend,
  spentRlusd,
} = await import('./store.js');

const merchant = loadRules().allowedMerchants[0];

async function quote(amount = '0.08') {
  return recordPending({
    task: 'Hold a quote',
    merchant,
    merchantLabel: 'Field Weather Co',
    amount,
    reason: 'over per-purchase cap',
  });
}

describe('reservations', { concurrency: false }, () => {
test('two spends that together pass the budget cannot both reserve', async () => {
  const [first, second] = await Promise.all([reserveSpend('0.15'), reserveSpend('0.15')]);
  const held = [first, second].filter((row) => row.ok);
  const refused = [first, second].filter((row) => row.ok === false);
  assert.equal(held.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].reason, 'over budget');
  assert.equal(await spentRlusd(), '0.15');
  await releaseReservation(held[0].id);
  const again = await reserveSpend('0.15');
  assert.equal(again.ok, true);
  assert.equal(await spentRlusd(), '0.15');
  await releaseReservation(again.id);
});

test('a signature claim reserves in the same lock and does not keep a refused signature', async () => {
  const held = await reserveSpend('0.15');
  assert.equal(held.ok, true);
  const pending = await quote('0.08');
  const signature = `0x${'ab'.repeat(65)}`;
  const blocked = await claimApprovalSignature(pending.id, signature, Date.now(), { amount: '0.08' });
  assert.equal(blocked.error, 'over_budget');
  assert.equal(await spentRlusd(), '0.15');
  await releaseReservation(held.id);

  const [claimed, raced] = await Promise.all([
    claimApprovalSignature(pending.id, signature, Date.now(), { amount: '0.08' }),
    reserveSpend('0.15'),
  ]);
  const claimWon = claimed.ok === true;
  const raceWon = raced.ok === true;
  assert.equal(Number(claimWon) + Number(raceWon), 1);
  if (claimWon) {
    assert.equal(await spentRlusd(), '0.08');
    const again = await claimApprovalSignature(pending.id, signature, Date.now(), { amount: '0.08' });
    assert.equal(again.inFlight, true);
    assert.equal(await spentRlusd(), '0.08');
  }
  rmSync(dir, { recursive: true, force: true });
});
});
