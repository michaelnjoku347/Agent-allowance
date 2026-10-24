import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRules, loadRules } from './rules.js';

const rules = loadRules();
const merchant = rules.allowedMerchants[0];

function decide(purchase) {
  return checkRules({ merchant, amount: '1', spent: '0', ...purchase }, rules);
}

test('allows a purchase inside the allowance', () => {
  const result = decide({});
  assert.deepEqual(result, { decision: 'allow', reason: 'within allowance' });
});

test('allows a purchase that lands exactly on the cap and the budget', () => {
  assert.equal(decide({ amount: rules.maxPerPurchase === 0n ? '0' : '5', spent: '15' }).decision, 'allow');
  assert.equal(decide({ amount: '5.000', spent: '15.000' }).reason, 'within allowance');
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

test('needs approval over the per-purchase cap', () => {
  assert.equal(decide({ amount: '5.01' }).reason, 'over per-purchase cap');
  assert.equal(decide({ amount: '8' }).reason, 'over per-purchase cap');
});

test('needs approval when the quote would exceed the budget', () => {
  // 3 RLUSD is under the 5 RLUSD cap, but 18 + 3 is over the 20 RLUSD budget.
  assert.equal(decide({ amount: '3', spent: '18' }).reason, 'over budget');
  assert.equal(decide({ amount: '2', spent: '18' }).decision, 'allow');
});

test('expired wins when several rules fail at once', () => {
  const result = decide({
    merchant: '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad',
    amount: '9',
    spent: '19',
    at: rules.expiresAt,
  });
  assert.equal(result.reason, 'expired');
});

test('rejects a non-positive amount instead of paying it', () => {
  assert.equal(decide({ amount: '0' }).reason, 'amount must be positive');
});
