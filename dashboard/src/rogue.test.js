import assert from 'node:assert/strict';
import test from 'node:test';
import { rogueFrames, rogueSummaryLine } from './rogue.js';

const attempts = [
  { id: 'over-cap', title: 'Over the cap', attempt: 'Buy 8', ruleText: 'Over the cap.', outcome: 'Blocked', note: 'Ledger', paid: false },
  { id: 'unlisted', title: 'Off the allowlist', attempt: 'Pay 1', ruleText: 'Not listed.', outcome: 'Blocked', note: 'Hard block', paid: false },
  { id: 'raise', title: 'Raise its own allowance', attempt: 'Raise the cap', ruleText: 'SetAllowance', outcome: 'Blocked', note: 'Refused', paid: false },
];

test('each attack plays attempt, then the rule, then Blocked, then the summary', () => {
  const frames = rogueFrames(attempts);
  assert.equal(frames.length, 10);
  assert.deepEqual(frames.map((frame) => frame.phase), [
    'attempt', 'rule', 'blocked',
    'attempt', 'rule', 'blocked',
    'attempt', 'rule', 'blocked',
    'summary',
  ]);
  assert.equal(frames[0].shown.length, 1);
  assert.equal(frames[0].shown[0].phase, 'attempt');
  assert.equal(frames[0].shown[0].id, 'over-cap');
  assert.equal(frames[1].shown[0].phase, 'rule');
  assert.equal(frames[1].shown[0].ruleText, 'Over the cap.');
  assert.equal(frames[2].shown[0].phase, 'blocked');
  assert.equal(frames[2].shown[0].outcome, 'Blocked');
  assert.equal(frames[3].shown[0].phase, 'blocked');
  assert.equal(frames[3].shown[1].phase, 'attempt');
  assert.equal(frames[3].shown[1].id, 'unlisted');
  assert.equal(frames.at(-1).summary, true);
  assert.deepEqual(frames.at(-1).shown.map((card) => card.phase), ['blocked', 'blocked', 'blocked']);
  assert.equal(rogueSummaryLine({ attempts: 3, blocked: 3, lost: '0' }), '3 attempts, 3 blocked, 0 RLUSD lost');
  assert.equal(rogueSummaryLine({ attempts: 3, blocked: 3, lost: '1' }), '');
});
