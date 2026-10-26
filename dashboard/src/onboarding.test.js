import assert from 'node:assert/strict';
import test from 'node:test';
import { SETUP_STEPS, SLIDES, keyAction, lowerOnlyDraft, setupDraft, setupPlan, slideReducer, stepErrors, swipeDirection } from './onboarding.js';
import { draftFrom, validateDraft } from './allowanceEdit.js';

const A = '0xa11cea11cea11cea11cea11cea11cea11cea11ce';
const B = '0xbee0bee0bee0bee0bee0bee0bee0bee0bee0bee0';
const C = '0xc0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';
const rules = {
  budget: '0.2',
  maxPerPurchase: '0.05',
  expiresAt: '2026-12-31T23:59:59.000Z',
  allowedMerchants: [{ address: A, label: 'Field Weather Co' }, { address: B, label: 'Market Desk' }],
  approverAddress: null,
};
const NOW = Date.parse('2026-10-25T12:00:00Z');

test('four slides explain the allowance, the rules, the Ledger, and control', () => {
  assert.deepEqual(SLIDES.map((slide) => slide.id), ['allowance', 'rules', 'ledger', 'control']);
  for (const slide of SLIDES) {
    assert.ok(slide.title.length < 60, slide.id);
    assert.ok(slide.body.length < 260, slide.id);
  }
  assert.deepEqual(SETUP_STEPS.map((step) => step.id), ['name', 'limits', 'merchants', 'expiry', 'approver', 'review']);
});

test('slides move forward, back, jump, and finish', () => {
  let state = { index: 0 };
  state = slideReducer(state, { type: 'back' });
  assert.deepEqual(state, { index: 0, done: false });
  state = slideReducer(state, { type: 'next' });
  assert.equal(state.index, 1);
  state = slideReducer(state, { type: 'go', index: 99 });
  assert.equal(state.index, 3);
  state = slideReducer(state, { type: 'next' });
  assert.equal(state.done, true, 'next on the last slide ends the intro');
  assert.equal(slideReducer({ index: 2 }, { type: 'skip' }).done, true);
  assert.equal(slideReducer({ index: -5 }, { type: 'noop' }).index, 0);
});

test('swipes must be mostly sideways and long enough', () => {
  assert.equal(swipeDirection(-80, 10), 'next');
  assert.equal(swipeDirection(90, -20), 'back');
  assert.equal(swipeDirection(-30, 0), null, 'too short');
  assert.equal(swipeDirection(-60, 70), null, 'a scroll, not a swipe');
  assert.equal(swipeDirection(NaN, 0), null);
});

test('keys map to slide moves', () => {
  assert.deepEqual(keyAction('ArrowRight'), { type: 'next' });
  assert.deepEqual(keyAction('ArrowLeft'), { type: 'back' });
  assert.deepEqual(keyAction('End'), { type: 'go', index: 3 });
  assert.equal(keyAction('a'), null);
});

test('each step says what is missing', () => {
  const draft = { ...setupDraft({ rules }), agentName: '' };
  assert.match(stepErrors('name', draft, NOW).agentName, /Give the agent a name/);
  assert.deepEqual(stepErrors('name', { ...draft, agentName: 'Scout' }, NOW), {});
  assert.match(stepErrors('limits', { ...draft, maxPerPurchase: '0.5' }, NOW).maxPerPurchase, /larger than the budget/);
  assert.match(stepErrors('merchants', { ...draft, merchants: [] }, NOW).merchants, /at least one/);
  assert.match(stepErrors('expiry', { ...draft, expiresOn: '2026-01-01' }, NOW).expiresOn, /after today/);
  assert.match(stepErrors('approver', { ...draft, approver: '0x12' }, NOW).approver, /40 hex/);
  assert.deepEqual(stepErrors('approver', { ...draft, approver: '' }, NOW), {}, 'the approver can be left for later');
});

test('the plan says what saves now and what needs the Ledger', () => {
  const lower = setupPlan(rules, { ...draftFrom(rules), maxPerPurchase: '0.03' }, { ledgerReady: false });
  assert.equal(lower.raises, false);
  assert.equal(lower.canSaveAll, true);

  const raise = setupPlan(rules, { ...draftFrom(rules), budget: '1' }, { ledgerReady: true });
  assert.equal(raise.raises, true);
  assert.equal(raise.canSaveAll, false);
  assert.match(raise.blockers[0], /needs an approver/);

  const withApprover = setupPlan(rules, { ...draftFrom(rules), budget: '1', approver: `0x${'ab'.repeat(20)}` }, { ledgerReady: true });
  assert.equal(withApprover.canSaveAll, true);
  assert.equal(withApprover.newApprover, `0x${'ab'.repeat(20)}`);
  const noHid = setupPlan(rules, { ...draftFrom(rules), budget: '1' }, { approverSet: true, ledgerReady: false });
  assert.match(noHid.blockers[0], /Chrome or Edge/);
  assert.equal(setupPlan(rules, draftFrom(rules), { approverSet: true }).newApprover, '', 'an existing approver is never replaced');
});

test('the lowering half can be saved alone', () => {
  const draft = { ...draftFrom(rules), budget: '1', maxPerPurchase: '0.03', expiresOn: '2027-06-30', merchants: [A, C] };
  const lowered = lowerOnlyDraft(rules, draft);
  assert.equal(lowered.budget, '0.2');
  assert.equal(lowered.maxPerPurchase, '0.03');
  assert.equal(lowered.expiresOn, '2026-12-31');
  assert.deepEqual(lowered.merchants, [A], 'the new merchant is dropped, the removed one stays removed');
  assert.deepEqual(validateDraft(lowered, NOW), {});
});
