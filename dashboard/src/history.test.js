import assert from 'node:assert/strict';
import test from 'node:test';
import {
  csvCell,
  csvFilename,
  filterHistory,
  historyTotals,
  isFiltered,
  merchantOptions,
  normalizeFilters,
  outcomeOf,
  periodStart,
  toCsv,
} from './history.js';

const A = '0xa11cea11cea11cea11cea11cea11cea11cea11ce';
const B = '0xbee0bee0bee0bee0bee0bee0bee0bee0bee0bee0';
const NOW = Date.parse('2026-10-25T15:00:00');

const rows = [
  { id: 'p1', status: 'paid', merchant: A, merchantLabel: 'Field Weather Co', task: 'Route weather', amount: '1', createdAt: '2026-10-25T09:00:00', txHash: `0x${'1'.repeat(64)}` },
  { id: 'p2', status: 'paid', merchant: B, merchantLabel: 'Market Desk', task: 'Morning market brief', amount: '2.5', createdAt: '2026-10-20T09:00:00', approvedBy: 'ledger' },
  { id: 'w1', status: 'pending', merchant: A, merchantLabel: 'Field Weather Co', task: 'Satellite imagery pack', amount: '8', reason: 'over per-purchase cap', createdAt: '2026-10-24T09:00:00' },
  { id: 'b1', status: 'pending', declineOnly: true, merchant: '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad', merchantLabel: 'Unlisted Research API', task: 'Query', amount: '2', reason: 'merchant not allowed', createdAt: '2026-09-01T09:00:00' },
  { id: 'd1', status: 'declined', merchant: B, merchantLabel: 'Market Desk', task: 'Old desk call', amount: '3', createdAt: '2026-10-10T09:00:00' },
];

test('outcomes match the status pills', () => {
  assert.deepEqual(rows.map(outcomeOf), ['paid', 'paid', 'waiting', 'blocked', 'blocked']);
  assert.equal(outcomeOf(null), 'blocked');
});

test('filters combine status, merchant, words, and period', () => {
  const ids = (list) => list.map((item) => item.id);
  assert.deepEqual(ids(filterHistory(rows, {}, NOW)), ['p1', 'p2', 'w1', 'b1', 'd1']);
  assert.deepEqual(ids(filterHistory(rows, { status: 'paid' }, NOW)), ['p1', 'p2']);
  assert.deepEqual(ids(filterHistory(rows, { status: 'blocked' }, NOW)), ['b1', 'd1']);
  assert.deepEqual(ids(filterHistory(rows, { merchant: A.toUpperCase().replace('0X', '0x') }, NOW)), ['p1', 'w1']);
  assert.deepEqual(ids(filterHistory(rows, { query: 'market brief' }, NOW)), ['p2']);
  assert.deepEqual(ids(filterHistory(rows, { query: 'CAP' }, NOW)), ['w1'], 'matches the reason, any case');
  assert.deepEqual(ids(filterHistory(rows, { query: '1111' }, NOW)), ['p1'], 'matches a tx hash');
  assert.deepEqual(ids(filterHistory(rows, { period: 'today' }, NOW)), ['p1']);
  assert.deepEqual(ids(filterHistory(rows, { period: '7d' }, NOW)), ['p1', 'p2', 'w1']);
  assert.deepEqual(ids(filterHistory(rows, { period: '30d', status: 'blocked' }, NOW)), ['d1']);
  assert.deepEqual(ids(filterHistory([...rows, null, { id: 'x', status: 'paid', createdAt: 'nope' }], { period: '7d' }, NOW)), ['p1', 'p2', 'w1']);
});

test('unknown filter values fall back to all, and long queries are cut', () => {
  assert.deepEqual(normalizeFilters({ status: 'evil', period: 'year', merchant: 42, query: 'x'.repeat(500) }), {
    status: 'all', merchant: 'all', query: 'x'.repeat(120), period: 'all',
  });
  assert.equal(isFiltered({}), false);
  assert.equal(isFiltered({ query: '  ' }), false);
  assert.equal(isFiltered({ status: 'paid' }), true);
  assert.equal(periodStart('all', NOW), null);
});

test('merchant options are the merchants in the history, busiest first', () => {
  const options = merchantOptions(rows);
  assert.deepEqual(options.map((row) => [row.label, row.count]), [
    ['Field Weather Co', 2],
    ['Market Desk', 2],
    ['Unlisted Research API', 1],
  ]);
  assert.equal(options[0].value, A);
});

test('totals are exact per outcome', () => {
  const totals = historyTotals([...rows, { status: 'paid', amount: '0.1' }, { status: 'paid', amount: '0.2' }]);
  assert.equal(totals.count, 7);
  assert.deepEqual(totals.counts, { paid: 4, waiting: 1, blocked: 2 });
  assert.equal(totals.paid, '3.8');
  assert.equal(totals.waiting, '8');
  assert.equal(totals.blocked, '5');
});

test('CSV quotes, escapes, and defuses formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1 call'), "'+1 call");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('-5'), '-5', 'a plain negative number stays a number');
  assert.equal(csvCell(null), '');

  const csv = toCsv(rows.slice(0, 2));
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'date,merchant,merchant_address,task,amount_rlusd,status,reason,approved_by,tx_hash,receipt_url,example_row');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^2026-10-25T09:00:00,Field Weather Co,0xa11ce.*,Route weather,1,paid,,rules,0x1{64},,no$/);
  assert.match(lines[2], /,ledger,/);
  assert.equal(toCsv([]), 'date,merchant,merchant_address,task,amount_rlusd,status,reason,approved_by,tx_hash,receipt_url,example_row\r\n');
});

test('the export file is named for the day', () => {
  assert.equal(csvFilename(new Date('2026-10-25T15:00:00Z')), 'agent-allowance-history-2026-10-25.csv');
  assert.equal(csvFilename('nope'), 'agent-allowance-history-export.csv');
});
