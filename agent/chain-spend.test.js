import assert from 'node:assert/strict';
import test from 'node:test';
import { channelWarning, higherSpent, readOpenChannel } from './chain-spend.js';

test('spent is the higher of the local ledger and the channel redeemed balance', () => {
  assert.equal(higherSpent('1', '8'), '8');
  assert.equal(higherSpent('8', '1'), '8');
  assert.equal(higherSpent('1.5', '1.5'), '1.5');
  assert.equal(higherSpent('2', null), '2');
  assert.equal(higherSpent('0', '0'), '0');
});

test('a warning names a local and channel pair that does not match', () => {
  assert.equal(channelWarning({
    localSpent: '1',
    budget: '20',
    chain: { cap: '20', redeemed: '1' },
  }), null);
  const warning = channelWarning({
    localSpent: '1',
    budget: '20',
    chain: { cap: '5', redeemed: '8' },
  });
  assert.match(warning, /1 RLUSD spent/);
  assert.match(warning, /8 RLUSD redeemed/);
  assert.match(warning, /budget is 20 RLUSD/);
  assert.match(warning, /channel cap is 5 RLUSD/);
  assert.equal(channelWarning({ localSpent: '1', budget: '20', chain: null }), null);
});

test('a missing wallet does not pretend to read a channel', async () => {
  assert.equal(await readOpenChannel({}), null);
});
