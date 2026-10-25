import assert from 'node:assert/strict';
import test from 'node:test';
import { explainApproval } from './approvalWhy.js';

const context = { cap: '5', budget: '20', spent: '7.5', expiresAt: '2026-12-31T23:59:59.000Z' };

test('an over-cap purchase says how far over, what is left, and what the Ledger signs', () => {
  const why = explainApproval({ amount: '8', merchantLabel: 'Field Weather Co', reason: 'over per-purchase cap' }, context);
  assert.equal(why.canApprove, true);
  assert.equal(why.rule, 'Over your per-purchase cap');
  assert.equal(why.summary, 'Field Weather Co asked for 8.00 RLUSD. Your cap is 5.00 RLUSD per purchase, so the agent stopped and asked you.');
  assert.deepEqual(why.facts, [
    ['Price', '8.00 RLUSD'],
    ['Your cap', '5.00 RLUSD'],
    ['Over by', '3.00 RLUSD'],
    ['Left after this', '4.50 RLUSD'],
  ]);
  assert.match(why.signs, /exactly this: 8\.00 RLUSD to Field Weather Co, valid until Dec 31, 2026/);
  assert.match(why.signs, /cannot be reused/);
  assert.match(why.after, /cap, budget, and merchant list stay as they are/);
});

test('a merchant off the list is decline-only and says how to fix it', () => {
  for (const item of [
    { amount: '2', merchantLabel: 'Unlisted Research API', declineOnly: true },
    { amount: '2', merchantLabel: 'Unlisted Research API', reason: 'merchant not allowed' },
  ]) {
    const why = explainApproval(item, context);
    assert.equal(why.canApprove, false);
    assert.equal(why.signs, null);
    assert.match(why.summary, /not on your allowlist/);
    assert.match(why.after, /Nothing is signed or paid/);
  }
});

test('hard rules cannot be approved past', () => {
  const budget = explainApproval({ amount: '15', merchantLabel: 'Market Desk', reason: 'over budget' }, context);
  assert.equal(budget.canApprove, false);
  assert.match(budget.summary, /only 12\.50 RLUSD is left/);
  assert.equal(explainApproval({ amount: '1', reason: 'expired' }, context).canApprove, false);
  const channel = explainApproval({ amount: '3', reason: 'over channel cap' }, context);
  assert.equal(channel.canApprove, false);
  assert.match(channel.summary, /cannot add room/);
});

test('soft reviews explain themselves and can be approved', () => {
  const jev = explainApproval({ amount: '2', merchantLabel: 'Market Desk', reason: 'Jev flagged for review' }, context);
  assert.equal(jev.canApprove, true);
  assert.match(jev.summary, /Jev's risk check flagged Market Desk/);
  const rate = explainApproval({ amount: '2', reason: 'over spend rate' }, context);
  assert.equal(rate.rule, 'Spending too fast');
  const unknown = explainApproval({ amount: '2' }, {});
  assert.equal(unknown.rule, 'Needs a person');
  assert.deepEqual(unknown.facts, [['Price', '2.00 RLUSD']]);
  assert.doesNotMatch(unknown.signs, /valid until/);
});
