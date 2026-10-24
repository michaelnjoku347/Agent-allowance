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
