import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PATH_IDLE,
  flowForHeist,
  flowForStage,
  pathReducer,
  flowForItem,
  flowForRogue,
  narrationFor,
  narrationForHeist,
  narrationForRogue,
  toneFor,
  toneKind,
  txFeed,
  validTxHash,
} from './present.js';

const hash = `0x${'ab'.repeat(32)}`;

test('narration names an approval, a Ledger wait, and a hard block', () => {
  assert.equal(narrationFor({ sample: true, status: 'paid', amount: '1' }), null);
  assert.equal(
    narrationFor({ status: 'paid', amount: '1', merchantLabel: 'Market Desk', txHash: hash }),
    'Purchase approved. 1 RLUSD paid to Market Desk.',
  );
  assert.match(narrationFor({ status: 'paid', amount: '1', merchantLabel: 'Market Desk' }), /Purchase approved/);
  assert.equal(
    narrationFor({ status: 'pending', amount: '8', merchantLabel: 'Field Weather Co' }),
    'Waiting for Ledger. 8 RLUSD to Field Weather Co.',
  );
  assert.match(narrationFor({ status: 'pending', declineOnly: true, merchantLabel: 'Unlisted Research API' }), /^Blocked/);
  assert.equal(narrationFor({ status: 'skipped' }), 'Blocked. Nothing was signed.');
  assert.equal(narrationForRogue({ phase: 'attempt', route: 'ledger' }), null);
  assert.equal(narrationForRogue({ phase: 'blocked', route: 'ledger' }), 'Waiting for Ledger. Nothing was signed.');
  assert.match(narrationForRogue({ phase: 'blocked', route: 'hard' }), /^Blocked/);
  assert.match(narrationForRogue({ phase: 'blocked', route: 'allowance' }), /SetAllowance|Ledger signature/);
});

test('the payment path stops at the rule that caught the quote', () => {
  const idle = flowForItem(null);
  assert.deepEqual(idle.steps.map((step) => step.state), ['off', 'off', 'off', 'off', 'off']);

  const paid = flowForItem({ status: 'paid', txHash: hash });
  assert.deepEqual(paid.steps.map((step) => step.state), ['on', 'on', 'off', 'on', 'on']);
  assert.match(paid.caption, /explorer/i);

  const ledgerPaid = flowForItem({ status: 'paid', txHash: hash, approver: '0xabc' });
  assert.equal(ledgerPaid.steps[2].state, 'on');

  const waiting = flowForItem({ status: 'paid' });
  assert.equal(waiting.steps.find((step) => step.id === 'xrpl').state, 'wait');
  assert.equal(waiting.steps.find((step) => step.id === 'merchant').state, 'off');

  const hold = flowForItem({ status: 'pending' });
  assert.deepEqual(hold.steps.map((step) => step.state), ['on', 'stop', 'wait', 'off', 'off']);

  const hard = flowForItem({ status: 'pending', declineOnly: true });
  assert.equal(hard.steps.find((step) => step.id === 'ledger').state, 'off');
  assert.equal(hard.steps.find((step) => step.id === 'rules').state, 'stop');
});

test('a rogue attack lights Ledger only when a signature could still pay', () => {
  const over = flowForRogue({ id: 'over-cap', phase: 'blocked' });
  assert.equal(over.steps.find((step) => step.id === 'ledger').state, 'wait');
  assert.equal(over.steps.find((step) => step.id === 'xrpl').state, 'off');

  const outside = flowForRogue({ id: 'unlisted', phase: 'blocked' });
  assert.equal(outside.steps.find((step) => step.id === 'ledger').state, 'off');
  assert.match(outside.caption, /cannot pay/);

  const raise = flowForRogue({ id: 'raise', phase: 'blocked' });
  assert.equal(raise.steps.find((step) => step.id === 'ledger').state, 'wait');
  assert.match(raise.caption, /SetAllowance/);

  const summary = flowForRogue({ phase: 'summary', attempt: '3 attempts, 3 blocked, 0 RLUSD lost' });
  assert.equal(summary.caption, '3 attempts, 3 blocked, 0 RLUSD lost');
  assert.equal(flowForRogue(null), null);

  const heist = flowForHeist({
    paid: false,
    signed: false,
    lost: '0',
    ruleText: 'This merchant is not on the allowlist.',
    spoken: 'Attack blocked. 0.00 RLUSD moved.',
  });
  assert.deepEqual(heist.steps.map((step) => step.state), ['on', 'stop', 'off', 'off', 'off']);
  assert.match(narrationForHeist({ paid: false, signed: false, lost: '0', spoken: 'Attack blocked. 0.00 RLUSD moved.' }), /0\.00 RLUSD/);
  assert.equal(narrationForHeist({ paid: true, signed: false, lost: '0', spoken: 'nope' }), null);
  assert.equal(flowForHeist(null), null);
});

test('the explorer feed keeps only real transaction hashes', () => {
  assert.equal(validTxHash('0x1234'), null);
  assert.equal(validTxHash(hash), hash);
  const rows = txFeed([
    { id: 'sample', sample: true, status: 'paid', txHash: hash, amount: '4' },
    { id: 'short', status: 'paid', txHash: '0x1234', amount: '1' },
    { id: 'live', status: 'paid', merchantLabel: 'Market Desk', amount: '1', txHash: hash },
    { id: 'payout', status: 'paid', merchantLabel: 'Field Weather Co', amount: '8', payoutTx: `0x${'cd'.repeat(32)}` },
  ], 'https://explorer.testnet.xrplevm.org/');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, 'Market Desk');
  assert.equal(rows[0].href, `https://explorer.testnet.xrplevm.org/tx/${hash}`);
  assert.match(rows[1].href, /\/tx\/0xcd/);
  assert.equal(toneKind({ status: 'paid' }), 'approve');
  assert.equal(toneKind({ status: 'pending', declineOnly: true }), 'block');
  assert.equal(toneKind({ status: 'pending' }), 'wait');
  assert.equal(toneKind({ sample: true, status: 'paid' }), null);
  assert.equal(toneFor('approve').frequency, 660);
  assert.equal(toneFor('nope'), null);
});

test('a live stage steps through the payment path', () => {
  const states = (flow) => flow.steps.map((step) => step.state).join(',');
  assert.equal(flowForStage(null), null);
  assert.equal(flowForStage({ source: 'agent', stage: 'unknown' }), null);
  assert.equal(states(flowForStage({ source: 'agent', stage: 'rules' })), 'on,wait,off,off,off');
  const paying = flowForStage({ source: 'agent', stage: 'xrpl', amount: '1', merchantLabel: 'Market Desk' });
  assert.equal(states(paying), 'on,on,off,wait,off');
  assert.match(paying.caption, /^1 RLUSD to Market Desk\. Inside the rules/);
  assert.equal(paying.live, true);
  assert.equal(states(flowForStage({ source: 'ledger', phase: 'signed' })), 'on,on,on,wait,off');
  assert.equal(states(flowForStage({ source: 'ledger', phase: 'broadcasting' })), 'on,on,on,wait,off');
  assert.equal(states(flowForStage({ source: 'ledger', phase: 'settling' })), 'on,on,on,on,wait');
});

test('a new activity row clears what a demo left on the payment path', () => {
  const heist = flowForHeist({ ruleText: 'Not on the merchant list.', lost: '0' });
  let path = pathReducer(PATH_IDLE, { type: 'demo', flow: heist });
  assert.equal(path.flow, heist);
  assert.equal(path.alert, true);
  path = pathReducer(path, { type: 'alert' });
  assert.equal(path.alert, true);
  // A stage that ends does not wipe a demo it did not set.
  assert.equal(pathReducer(path, { type: 'stage', stage: null }), path);
  path = pathReducer(path, { type: 'activity' });
  assert.deepEqual(path, PATH_IDLE);

  const rogue = pathReducer(PATH_IDLE, { type: 'alert' });
  assert.deepEqual(pathReducer(rogue, { type: 'activity' }), PATH_IDLE);
});

test('a live stage replaces the path and clears itself when the purchase lands', () => {
  let path = pathReducer(PATH_IDLE, { type: 'stage', stage: { source: 'agent', stage: 'rules' } });
  assert.equal(path.source, 'stage');
  assert.equal(path.alert, false);
  path = pathReducer(path, { type: 'stage', stage: { source: 'agent', stage: 'xrpl' } });
  assert.equal(path.flow.steps[3].state, 'wait');
  assert.deepEqual(pathReducer(path, { type: 'stage', stage: null }), PATH_IDLE);
  assert.deepEqual(pathReducer(path, { type: 'activity' }), PATH_IDLE);
});
