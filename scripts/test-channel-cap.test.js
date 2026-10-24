import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVouchers } from './test-channel-cap.js';

test('cap proof requires a successful in-cap control and a contract revert for the excessive amount', async () => {
  const data = '0x12345678';
  assert.equal(await compareVouchers({ acceptedCall: async () => {}, rejectedCall: async () => { throw Object.assign(new Error('reverted'), { code: 'CALL_EXCEPTION', data }); } }), data);
  await assert.rejects(compareVouchers({ acceptedCall: async () => { throw new Error('channel closed'); }, rejectedCall: async () => {} }), /channel closed/);
  await assert.rejects(compareVouchers({ acceptedCall: async () => {}, rejectedCall: async () => { throw new Error('fetch failed'); } }), /without contract revert/);
  await assert.rejects(compareVouchers({ acceptedCall: async () => {}, rejectedCall: async () => {} }), /was accepted/);
});
