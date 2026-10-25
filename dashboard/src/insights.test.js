import assert from 'node:assert/strict';
import test from 'node:test';
import { daysLabel, daysLeft, outcomeCounts, spendByMerchant } from './insights.js';

const A = '0xa11cea11cea11cea11cea11cea11cea11cea11ce';
const B = '0xbee0bee0bee0bee0bee0bee0bee0bee0bee0bee0';

test('paid spend groups by merchant, largest first, with exact decimals', () => {
  const rows = spendByMerchant([
    { status: 'paid', merchant: A, merchantLabel: 'Field Weather Co', amount: '0.1' },
    { status: 'paid', merchant: A.toUpperCase().replace('0X', '0x'), merchantLabel: 'Field Weather Co', amount: '0.2' },
    { status: 'paid', merchant: B, merchantLabel: 'Market Desk', amount: '4' },
    { status: 'pending', merchant: B, merchantLabel: 'Market Desk', amount: '8' },
    { status: 'paid', merchant: B, amount: 'junk' },
    null,
  ]);
  assert.deepEqual(rows.map((row) => [row.label, row.amount, row.count]), [
    ['Market Desk', '4', 1],
    ['Field Weather Co', '0.3', 2],
  ]);
  assert.ok(Math.abs(rows[0].share + rows[1].share - 1) < 0.001);
  assert.deepEqual(spendByMerchant([]), []);
});

test('merchants past the limit fold into one row', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ status: 'paid', merchant: `m${i}`, merchantLabel: `M${i}`, amount: String(i + 1) }));
  const rows = spendByMerchant(many, 3);
  assert.equal(rows.length, 4);
  assert.equal(rows[3].label, '4 more');
  assert.equal(rows[3].amount, '10');
  assert.equal(rows[3].count, 4);
});

test('outcomes count paid, waiting, and blocked rows', () => {
  assert.deepEqual(outcomeCounts([
    { status: 'paid' },
    { status: 'pending' },
    { status: 'pending', declineOnly: true },
    { status: 'declined' },
    { status: 'pending', reason: 'merchant not allowed' },
  ]), { paid: 1, waiting: 1, blocked: 3 });
});

test('days left rounds up and never goes negative', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(daysLeft('2026-10-26T11:00:00Z', now), 1);
  assert.equal(daysLeft('2026-10-01T00:00:00Z', now), 0);
  assert.equal(daysLeft('nope', now), null);
  assert.equal(daysLabel(null), 'No date');
  assert.equal(daysLabel(0), 'Ends today');
  assert.equal(daysLabel(1), '1 day left');
  assert.equal(daysLabel(67), '67 days left');
});
