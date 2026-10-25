import assert from 'node:assert/strict';
import test from 'node:test';
import { checkApprovalHardRules, checkRules, loadRules } from './rules.js';

const rules = loadRules();
const merchant = rules.allowedMerchants[0];

function decide(purchase) {
  return checkRules({ merchant, amount: '0.01', spent: '0', ...purchase }, rules);
}

test('allows a purchase inside the allowance', () => {
  const result = decide({});
  assert.deepEqual(result, { decision: 'allow', reason: 'within allowance' });
});

test('allows a purchase that lands exactly on the cap and the budget', () => {
  assert.equal(decide({ amount: rules.maxPerPurchase === 0n ? '0' : '0.05', spent: '0.15' }).decision, 'allow');
  assert.equal(decide({ amount: '0.05000', spent: '0.15000' }).reason, 'within allowance');
});

test('needs approval when the allowance is expired', () => {
  const result = decide({ at: rules.expiresAt });
  assert.equal(result.decision, 'needs_approval');
  assert.equal(result.reason, 'expired');
  const justBefore = new Date(Date.parse(rules.expiresAt) - 1).toISOString();
  assert.equal(decide({ at: justBefore }).decision, 'allow');
});

test('needs approval when the merchant is not on the list', () => {
  const result = decide({ merchant: '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad' });
  assert.equal(result.reason, 'merchant not allowed');
  assert.equal(decide({ merchant: merchant.toUpperCase() }).decision, 'allow');
});

test('a Ledger approval still stops at expiry and the budget', () => {
  const overCap = checkApprovalHardRules({ merchant, amount: '0.08', spent: '0' }, rules);
  assert.equal(overCap.decision, 'allow');
  const unlisted = checkApprovalHardRules({
    merchant: '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad',
    amount: '0.01',
    spent: '0',
  }, rules);
  assert.equal(unlisted.reason, 'merchant not allowed');
  const other = checkApprovalHardRules({
    merchant: '0x2222222222222222222222222222222222222222',
    amount: '0.01',
    spent: '0',
  }, rules);
  assert.equal(other.reason, 'merchant not allowed');
  assert.equal(checkApprovalHardRules({ merchant, amount: '0.08', spent: '0.16' }, rules).reason, 'over budget');
  assert.equal(checkApprovalHardRules({ merchant, amount: '0.01', spent: '0', at: rules.expiresAt }, rules).reason, 'expired');
});

test('needs approval over the per-purchase cap', () => {
  assert.equal(decide({ amount: '0.0501' }).reason, 'over per-purchase cap');
  assert.equal(decide({ amount: '0.08' }).reason, 'over per-purchase cap');
});

test('needs approval when the quote would exceed the budget', () => {
  // 0.03 RLUSD is under the 0.05 RLUSD cap, but 18 + 3 is over the 0.2 RLUSD budget.
  assert.equal(decide({ amount: '0.03', spent: '0.18' }).reason, 'over budget');
  assert.equal(decide({ amount: '0.02', spent: '0.18' }).decision, 'allow');
});

test('expired wins when several rules fail at once', () => {
  const result = decide({
    merchant: '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad',
    amount: '0.09',
    spent: '0.19',
    at: rules.expiresAt,
  });
  assert.equal(result.reason, 'expired');
});

test('rejects a non-positive amount instead of paying it', () => {
  assert.equal(decide({ amount: '0' }).reason, 'amount must be positive');
});
