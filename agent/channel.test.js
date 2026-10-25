import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectOpenChannel } from './channel.js';

const open = { channel_id: '0x' + 'ab'.repeat(32), channel_status: 'open', payout: '0x' + '11'.repeat(20) };
const closed = { channel_id: '0x' + 'cd'.repeat(32), channel_status: 'closed', payout: '0x' + '22'.repeat(20) };

test('reuses an open channel instead of asking for a new one', () => {
  assert.equal(selectOpenChannel([closed, open], ''), open);
});

test('uses the open CHANNEL_ID from the environment', () => {
  assert.equal(selectOpenChannel([open, closed], open.channel_id.toUpperCase()), open);
});

test('refuses a CHANNEL_ID that is not open', () => {
  assert.throws(() => selectOpenChannel([closed, open], closed.channel_id), /not open/);
});

test('returns null when every channel is closed and none was requested', () => {
  assert.equal(selectOpenChannel([closed], ''), null);
});

const budgetWei = (20n * 10n ** 18n).toString();
const smallWei = (5n * 10n ** 18n).toString();

test('does not reuse a channel for a different payout or a cap below the budget', () => {
  const low = { ...open, cap_wei: smallWei };
  const enough = { ...open, channel_id: '0x' + 'ef'.repeat(32), cap_wei: budgetWei };
  const other = { ...open, channel_id: '0x' + '99'.repeat(32), payout: '0x' + '33'.repeat(20), cap_wei: budgetWei };
  const payout = open.payout;
  assert.equal(selectOpenChannel([low, other], '', { payout, minCapWei: BigInt(budgetWei) }), null);
  assert.equal(selectOpenChannel([other, enough], '', { payout, minCapWei: BigInt(budgetWei) }), enough);
});

test('an explicit channel must pay this merchant and still have enough cap', () => {
  const low = { ...open, cap_wei: smallWei };
  assert.throws(
    () => selectOpenChannel([low], low.channel_id, { minCapWei: BigInt(budgetWei) }),
    /enough remaining/,
  );
  assert.throws(
    () => selectOpenChannel([open], open.channel_id, { payout: '0x' + '44'.repeat(20) }),
    /different merchant/,
  );
});
