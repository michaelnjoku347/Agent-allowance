import assert from 'node:assert/strict';
import test from 'node:test';
import { channelWarning, clearChannelCache, higherSpent, readOpenChannel } from './chain-spend.js';

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
  clearChannelCache();
  assert.equal(await readOpenChannel({}), null);
});

const funded = { AGENT_PRIVATE_KEY: `0x${'ab'.repeat(32)}`, TEAM_NAME: 'Cache Team' };

test('a failed channel read is cached and not paid around', async () => {
  clearChannelCache();
  let calls = 0;
  await assert.rejects(
    () => readOpenChannel(funded, {
      timeoutMs: 50,
      read: async () => {
        calls += 1;
        throw new Error('rpc down');
      },
    }),
    /rpc down/,
  );
  await assert.rejects(() => readOpenChannel(funded, { timeoutMs: 50, read: async () => { calls += 1; return null; } }), /rpc down/);
  assert.equal(calls, 1);
});

test('no channel is cached until a fresh read', async () => {
  clearChannelCache();
  let calls = 0;
  const read = async () => {
    calls += 1;
    return null;
  };
  assert.equal(await readOpenChannel(funded, { read, timeoutMs: 50 }), null);
  assert.equal(await readOpenChannel(funded, { read, timeoutMs: 50 }), null);
  assert.equal(calls, 1);
});

test('a channel read that hangs is cut off and cached', async () => {
  clearChannelCache();
  await assert.rejects(
    () => readOpenChannel(funded, { timeoutMs: 30, read: () => new Promise(() => {}) }),
    /timed out/,
  );
  let calls = 0;
  await assert.rejects(
    () => readOpenChannel(funded, { timeoutMs: 30, read: async () => { calls += 1; return { cap: '20', redeemed: '0' }; } }),
    /timed out/,
  );
  assert.equal(calls, 0);
});
