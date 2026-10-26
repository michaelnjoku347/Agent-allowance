/**
 * First run: four intro slides, then a guided setup. Pure state and checks,
 * so the component stays thin and the flow is tested without a browser.
 */

import { diffAllowance, draftFrom, endOfDayIso, validateDraft } from './allowanceEdit.js';

export const INTRO_KEY = 'allowance-intro-done';

export const SLIDES = [
  {
    id: 'allowance',
    kicker: 'What it is',
    title: 'An allowance for your AI agent',
    body: 'You fund a small budget. Your agent pays for data and services on its own, but only from merchants you list, up to a cap per purchase, and only until the end date you pick.',
  },
  {
    id: 'rules',
    kicker: 'The rules',
    title: 'Rules it cannot talk its way past',
    body: 'Every quote is checked before anything is signed: a real price, a listed merchant, under the cap, inside the budget, before the end date. A clever prompt cannot change them. Neither can the agent.',
  },
  {
    id: 'ledger',
    kicker: 'Your key',
    title: 'Exceptions wait for your Ledger',
    body: 'When a price is over the cap, the agent stops and asks you. You approve that one purchase on your Ledger, and it pays once. Raising a limit is signed the same way.',
  },
  {
    id: 'control',
    kicker: 'Always in control',
    title: 'Freeze in one tap. Ask Eve anything.',
    body: 'Freeze stops every signature at once. Eve, your assistant, explains every payment and block with real numbers, but she can never sign, spend, or change your rules.',
  },
];

export const SETUP_STEPS = [
  { id: 'name', title: 'Name your agent', hint: 'This is how it appears on your dashboard and in Eve’s answers.' },
  { id: 'limits', title: 'Set the budget and the cap', hint: 'The budget is the most it can ever spend. The cap is the most for one purchase.' },
  { id: 'merchants', title: 'Choose who it can pay', hint: 'Anyone not on this list is decline-only. No signature can pay them.' },
  { id: 'expiry', title: 'Pick an end date', hint: 'After this day the agent cannot pay at all until you extend it.' },
  { id: 'approver', title: 'Connect your approver', hint: 'The Ledger account that approves exceptions and signs raises.' },
  { id: 'review', title: 'Review and finish', hint: 'Lowering applies now. Anything that raises a limit is signed on your Ledger.' },
];

/** Slide position. Clamped; "skip" ends the intro. */
export function slideReducer(state, action) {
  const last = SLIDES.length - 1;
  const index = Math.max(0, Math.min(last, state.index ?? 0));
  if (action.type === 'next') return index >= last ? { index, done: true } : { index: index + 1, done: false };
  if (action.type === 'back') return { index: Math.max(0, index - 1), done: false };
  if (action.type === 'go') return { index: Math.max(0, Math.min(last, Number(action.index) || 0)), done: false };
  if (action.type === 'skip') return { index, done: true };
  return { index, done: Boolean(state.done) };
}

/** A horizontal swipe of at least `threshold` pixels that is more sideways than up or down. */
export function swipeDirection(dx, dy, threshold = 48) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy) * 1.2) return null;
  return dx < 0 ? 'next' : 'back';
}

/** Arrow keys move between slides; Home and End jump. Returns an action or null. */
export function keyAction(key) {
  if (key === 'ArrowRight' || key === 'PageDown') return { type: 'next' };
  if (key === 'ArrowLeft' || key === 'PageUp') return { type: 'back' };
  if (key === 'Home') return { type: 'go', index: 0 };
  if (key === 'End') return { type: 'go', index: SLIDES.length - 1 };
  return null;
}

/** The draft the setup starts from: today's rules plus the saved agent name. */
export function setupDraft(snapshot) {
  return {
    ...draftFrom(snapshot?.rules ?? {}),
    agentName: snapshot?.profile?.agentName || '',
    approver: snapshot?.rules?.approverAddress || '',
  };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Problems that keep a step from moving on, in plain words. */
export function stepErrors(stepId, draft, now = Date.now()) {
  const errors = {};
  if (stepId === 'name') {
    const name = String(draft.agentName ?? '').trim();
    if (!name) errors.agentName = 'Give the agent a name.';
    else if (name.length > 40) errors.agentName = 'Keep the name to 40 characters.';
  }
  const all = validateDraft(draft, now);
  if (stepId === 'limits') {
    if (all.budget) errors.budget = all.budget;
    if (all.maxPerPurchase) errors.maxPerPurchase = all.maxPerPurchase;
  }
  if (stepId === 'merchants' && all.merchants) errors.merchants = all.merchants;
  if (stepId === 'expiry' && all.expiresOn) errors.expiresOn = all.expiresOn;
  if (stepId === 'approver' && draft.approver && !ADDRESS.test(String(draft.approver).trim())) {
    errors.approver = 'That is not an 0x address with 40 hex characters.';
  }
  return errors;
}

/**
 * What finishing would do, and what stands in the way.
 *   approverSet   an approver already exists on the server
 *   ledgerReady   this browser can talk to a Ledger
 */
export function setupPlan(rules, draft, { approverSet = false, ledgerReady = false, labels = {} } = {}) {
  const diff = diffAllowance(rules, draft, labels);
  const approver = String(draft.approver ?? '').trim().toLowerCase();
  const newApprover = !approverSet && ADDRESS.test(approver) ? approver : '';
  const blockers = [];
  if (diff.raises && !approverSet && !newApprover) blockers.push('Raising a limit needs an approver. Connect your Ledger on the previous step, or keep the current limits.');
  if (diff.raises && !ledgerReady) blockers.push('Raising a limit is signed on a Ledger, which needs Chrome or Edge on a computer.');
  return {
    ...diff,
    newApprover,
    blockers,
    canSaveAll: blockers.length === 0,
  };
}

/** The same draft with every raise put back, so the lowering half can be saved alone. */
export function lowerOnlyDraft(rules, draft) {
  const current = draftFrom(rules);
  const next = { ...draft };
  const diff = diffAllowance(rules, draft);
  for (const change of diff.changes) {
    if (change.direction !== 'raise') continue;
    if (change.field === 'budget') next.budget = current.budget;
    if (change.field === 'maxPerPurchase') next.maxPerPurchase = current.maxPerPurchase;
    if (change.field === 'expiresAt') next.expiresOn = current.expiresOn;
  }
  // Added merchants are raises; removed ones stay removed.
  next.merchants = (draft.merchants ?? []).filter((address) => current.merchants.includes(address.toLowerCase()));
  if (next.merchants.length === 0) next.merchants = current.merchants;
  if (endOfDayIso(next.expiresOn) == null) next.expiresOn = current.expiresOn;
  // The caller still runs validateDraft: a raised cap put back can be larger than a lowered budget.
  return next;
}
