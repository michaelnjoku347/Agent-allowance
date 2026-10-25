import assert from 'node:assert/strict';
import test from 'node:test';
import { ceremonyDate, clock, money, relativeTime, shortAddress, when } from './format.js';

const NOW = Date.parse('2026-10-25T16:00:00Z');
const before = (ms) => new Date(NOW - ms).toISOString();

test('relative times read naturally, and a skewed clock never says "-3 min ago"', () => {
  assert.equal(relativeTime(before(20_000), NOW), 'Just now');
  assert.equal(relativeTime(before(5 * 60_000), NOW), '5 min ago');
  assert.equal(relativeTime(before(60 * 60_000), NOW), '1 hour ago');
  assert.equal(relativeTime(before(5 * 3_600_000), NOW), '5 hours ago');
  assert.equal(relativeTime(before(24 * 3_600_000), NOW), '1 day ago');
  assert.equal(relativeTime(before(3 * 86_400_000), NOW), '3 days ago');
  assert.equal(relativeTime(before(-3 * 60_000), NOW), 'Just now', 'a server clock 3 minutes ahead');
  assert.equal(relativeTime(before(-30 * 60_000), NOW), 'in 30 min');
  assert.equal(relativeTime(before(-2 * 86_400_000), NOW), 'in 2 days');
  assert.equal(relativeTime('', NOW), '');
  assert.equal(relativeTime('not a date', NOW), '');
});

test('dates show in one place and one form', () => {
  assert.equal(when('2026-10-25T16:00:00Z'), 'Oct 25, 12:00 PM EDT');
  assert.equal(when('2026-12-25T17:30:00Z'), 'Dec 25, 12:30 PM EST');
  assert.equal(when(null), '');
  assert.equal(when('nope'), '');
  assert.equal(clock('2026-10-25T16:00:05Z'), '12:00:05 PM');
  assert.equal(clock(''), '');
  assert.equal(ceremonyDate('2026-12-31T23:59:59Z'), 'Dec 31, 2026, 11:59 PM');
  assert.equal(ceremonyDate('bad'), '');
});

test('addresses shorten to the first six and last four, and money keeps its decimals', () => {
  assert.equal(shortAddress('0x1234567890abcdef1234567890abcdef12345678'), '0x1234…5678');
  assert.equal(shortAddress('0x1234'), '0x1234');
  assert.equal(shortAddress(''), '');
  assert.equal(shortAddress(undefined), '');
  assert.equal(money('0.08'), '0.08');
  assert.equal(money('0.125'), '0.125');
});
