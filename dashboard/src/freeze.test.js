import assert from 'node:assert/strict';
import test from 'node:test';
import { NEXT_CHANNEL, freezeControl, freezeNotice, freezeResult } from './freeze.js';

test('the top control says Unfreeze when frozen and shows progress while busy', () => {
  assert.deepEqual(freezeControl({ frozen: false }), { label: 'Freeze', next: true, busy: false });
  assert.deepEqual(freezeControl({ frozen: true }), { label: 'Unfreeze', next: false, busy: false });
  assert.equal(freezeControl({ frozen: false, phase: 'freezing' }).busy, true);
  assert.equal(freezeControl({ frozen: true, phase: 'unfreezing' }).label, 'Unfreezing…');
});

test('the frozen banner explains the channel and offers Unfreeze', () => {
  assert.equal(freezeNotice({ frozen: false }), null);
  const closed = freezeNotice({ frozen: true, channelClosed: true });
  assert.equal(closed.action, 'Unfreeze agent');
  assert.match(closed.body, /payment channel is closed/);
  assert.match(closed.body, new RegExp(NEXT_CHANNEL));
  const detail = freezeNotice({ frozen: true, channelClosed: false, freezeDetail: 'No agent wallet is configured, so no channel was closed' });
  assert.match(detail.body, /^No agent wallet is configured, so no channel was closed\. Unfreeze/);
  assert.equal(freezeNotice({ frozen: true }).body.startsWith('No payment channel was open.'), true);
});

test('busy and failed states still say something', () => {
  assert.match(freezeNotice({ frozen: false }, { phase: 'freezing' }).body, /up to a minute/);
  assert.equal(freezeNotice({ frozen: true }, { phase: 'unfreezing' }).action, null);
  const failed = freezeNotice({ frozen: false }, { error: 'Could not unfreeze the agent.' });
  assert.equal(failed.tone, 'error');
  assert.equal(freezeNotice({ frozen: true }, { error: 'x' }).error, 'x');
});

test('results name what happened to the channel', () => {
  assert.match(freezeResult(false), /unfrozen/);
  assert.match(freezeResult(false), /new payment channel/);
  assert.match(freezeResult(true, { channelClosed: true }), /channel is closed/);
  assert.equal(freezeResult(true, {}), 'Agent frozen. Signing stopped.');
});
