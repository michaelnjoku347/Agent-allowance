import assert from 'node:assert/strict';
import test from 'node:test';
import { rogueFrames, rogueSummaryLine, scriptedRogueReport } from './rogue.js';

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

test('a failed request can still show the three blocked frames', () => {
  const report = scriptedRogueReport();
  assert.equal(report.scripted, true);
  assert.equal(report.paid, false);
  assert.equal(report.summary.line, '3 attempts, 3 blocked, 0 RLUSD lost');
  const frames = rogueFrames(report.attempts);
  const last = frames.at(-1);
  assert.equal(last.summary, true);
  assert.equal(last.shown.length, 3);
  assert.deepEqual(last.shown.map((card) => card.phase), ['blocked', 'blocked', 'blocked']);
});
