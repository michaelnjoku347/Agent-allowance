import assert from 'node:assert/strict';
import test from 'node:test';
import { allowanceView, parseMicro } from './allowance.js';

const samples = {
  budget: '20',
  spent: '7.5',
  remaining: '12.5',
  rules: { budget: '20' },
  payments: [
    { id: 'a', sample: true, status: 'paid', amount: '4', createdAt: '2026-10-24T15:40:00.000Z' },
    { id: 'b', sample: true, status: 'paid', amount: '2.5', createdAt: '2026-10-24T14:15:00.000Z' },
    { id: 'c', sample: true, status: 'paid', amount: '1', createdAt: '2026-10-24T13:05:00.000Z' },
  ],
  pending: [
    { id: 'p', sample: true, status: 'pending', amount: '8', createdAt: '2026-10-24T15:52:00.000Z' },
  ],
};

test('sample preview totals are not spent, so left matches the budget', () => {
  const view = allowanceView(samples);
  assert.equal(view.budget, '20');
  assert.equal(view.spent, '0');
  assert.equal(view.left, '20');
  assert.equal(view.ratio, 0);
  assert.equal(view.activity.length, 0);
  assert.equal(view.held, '0');
  assert.equal(view.lost, '0');
  assert.equal(view.payments.length, 0);
  assert.equal(view.pending.length, 0);
  assert.equal(parseMicro(view.left) + parseMicro(view.spent), parseMicro(view.budget));
});

test('real payments keep spent, left, and budget in agreement', () => {
  const view = allowanceView({
    spent: '7.5',
    remaining: '12.5',
    rules: { budget: '20' },
    payments: [
      { id: 'paid', sample: false, status: 'paid', amount: '1', createdAt: '2026-10-24T16:00:00.000Z' },
      { id: 'approved', sample: false, status: 'approved', amount: '8', createdAt: '2026-10-24T16:05:00.000Z' },
    ],
    pending: [
      { id: 'wait', amount: '2', createdAt: '2026-10-24T16:06:00.000Z' },
    ],
  });
  assert.equal(view.spent, '1');
  assert.equal(view.left, '19');
  assert.equal(view.budget, '20');
  assert.equal(view.pending.length, 1);
  assert.equal(view.pending[0].status, 'pending');
  assert.equal(view.held, '2');
  assert.equal(view.lost, '0');
  assert.equal(view.activity[0].id, 'wait');
  assert.equal(parseMicro(view.left) + parseMicro(view.spent), parseMicro(view.budget));
});

test('decimal strings do not drift and left stays at zero when spent passes the budget', () => {
  const drift = allowanceView({
    rules: { budget: '20' },
    payments: [
      { id: 'a', status: 'paid', amount: '0.1', createdAt: '2026-10-24T16:00:00.000Z' },
      { id: 'b', status: 'paid', amount: '0.2', createdAt: '2026-10-24T16:01:00.000Z' },
    ],
    pending: [],
  });
  assert.equal(drift.spent, '0.3');
  assert.equal(drift.left, '19.7');

  const over = allowanceView({
    rules: { budget: '20' },
    payments: [
      { id: 'a', status: 'paid', amount: '25', createdAt: '2026-10-24T16:00:00.000Z' },
      { id: 'b', status: 'declined', amount: '8', createdAt: '2026-10-24T16:01:00.000Z' },
    ],
    pending: [],
  });
  assert.equal(over.spent, '25');
  assert.equal(over.left, '0');
  assert.equal(over.ratio, 1);
});

test('offline preview lists the sample rows and does not spend them', () => {
  const view = allowanceView({ ...samples, offlinePreview: true, chain: null });
  assert.equal(view.offlinePreview, true);
  assert.equal(view.spent, '0');
  assert.equal(view.localSpent, '0');
  assert.equal(view.left, '20');
  assert.equal(view.activity.length, 4);
  assert.equal(view.chainRedeemed, null);
  assert.equal(view.chainWarning, null);
});

test('on-chain redeemed raises spent above the local ledger', () => {
  const view = allowanceView({
    rules: { budget: '20' },
    payments: [
      { id: 'paid', status: 'paid', amount: '1', createdAt: '2026-10-24T16:00:00.000Z' },
    ],
    pending: [],
    chain: { cap: '5', redeemed: '8' },
  });
  assert.equal(view.localSpent, '1');
  assert.equal(view.chainRedeemed, '8');
  assert.equal(view.chainCap, '5');
  assert.equal(view.spent, '8');
  assert.equal(view.left, '12');
  assert.match(view.chainWarning, /disagree/);
  assert.match(view.chainWarning, /channel cap is 5/);
});

test('an empty snapshot still has a consistent zero balance', () => {
  const view = allowanceView(null);
  assert.equal(view.budget, '0');
  assert.equal(view.spent, '0');
  assert.equal(view.left, '0');
  assert.deepEqual(view.activity, []);
});
