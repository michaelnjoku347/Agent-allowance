/**
 * Why a purchase is waiting for a person, in numbers. The approval sheet, the
 * Approvals page, and Eve read this; nothing here can approve anything.
 *
 * Rules a Ledger can approve past: the per-purchase cap, a Jev review, and
 * the hourly spend rate. Rules it cannot: an expired allowance, a merchant
 * off the allowlist, a purchase that would go over the budget
 * (agent/rules.js checkApprovalHardRules), or a payment channel without room
 * for the quote (server/ledger.js refuses it with channel_short).
 */

import { formatMicro, parseMicro } from './micro.js';
import { money } from './money.js';

/** "Dec 31, 2026, 11:59 PM" in UTC, the expiry the approval message carries. */
function ceremonyDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

const HARD = new Set(['expired', 'merchant not allowed', 'over budget', 'amount must be positive', 'over channel cap']);

function m(value) {
  const parsed = parseMicro(value);
  return parsed === null ? null : parsed;
}

function rl(micro) {
  return `${money(formatMicro(micro))} RLUSD`;
}

/**
 * item     the pending row: amount, merchantLabel, reason, declineOnly, jev
 * context  { cap, budget, spent, expiresAt }
 */
export function explainApproval(item = {}, { cap, budget, spent, expiresAt } = {}) {
  const merchant = item.merchantLabel || 'This merchant';
  const amount = m(item.amount) ?? 0n;
  const capMicro = m(cap);
  const budgetMicro = m(budget);
  const spentMicro = m(spent) ?? 0n;
  const leftMicro = budgetMicro !== null && budgetMicro > spentMicro ? budgetMicro - spentMicro : 0n;
  const afterMicro = leftMicro > amount ? leftMicro - amount : 0n;
  const reason = item.reason || '';
  const until = ceremonyDate(expiresAt);
  const facts = [['Price', rl(amount)]];
  let rule = 'Needs a person';
  let summary = `${merchant} asked for ${rl(amount)}. The rules did not let the agent pay it on its own.`;

  if (item.declineOnly || reason === 'merchant not allowed') {
    return {
      canApprove: false,
      rule: 'Merchant is not on your list',
      summary: `${merchant} is not on your allowlist, so no signature can pay it. Decline it, or add the merchant to the allowance first with your Ledger.`,
      facts,
      signs: null,
      after: 'Declining records the block. Nothing is signed or paid.',
    };
  }

  if (reason === 'over per-purchase cap' && capMicro !== null) {
    rule = 'Over your per-purchase cap';
    const over = amount > capMicro ? amount - capMicro : 0n;
    summary = `${merchant} asked for ${rl(amount)}. Your cap is ${rl(capMicro)} per purchase, so the agent stopped and asked you.`;
    facts.push(['Your cap', rl(capMicro)], ['Over by', rl(over)]);
  } else if (reason === 'Jev flagged for review') {
    rule = 'Jev asked for a review';
    summary = `The price is inside your limits, but Jev's risk check flagged ${merchant} for a person to look at first.`;
  } else if (reason === 'over spend rate') {
    rule = 'Spending too fast';
    summary = `The agent has spent quickly in the last hour. ${merchant} waits until you confirm this is expected.`;
  } else if (reason === 'over channel cap') {
    rule = 'Payment channel is full';
    summary = `The open payment channel does not have room for ${rl(amount)}. A signature cannot add room, so an approval would be refused. Decline it.`;
  } else if (reason === 'over budget') {
    rule = 'Over your budget';
    summary = `${merchant} asked for ${rl(amount)}, but only ${rl(leftMicro)} is left. A signature cannot spend past the budget. Raise the budget first, or decline.`;
  } else if (reason === 'expired') {
    rule = 'Allowance has expired';
    summary = 'The allowance date has passed, so nothing can be paid from it. Extend the expiry with your Ledger, or decline.';
  } else if (reason) {
    rule = 'Needs a person';
  }

  if (budgetMicro !== null) facts.push(['Left after this', rl(afterMicro)]);

  const canApprove = !HARD.has(reason);
  return {
    canApprove,
    rule,
    summary,
    facts,
    signs: canApprove
      ? `Your Ledger signs one approval for exactly this: ${rl(amount)} to ${merchant}${until ? `, valid until ${until}` : ''}. It cannot be reused or changed.`
      : null,
    after: canApprove
      ? 'The agent then pays once through AP4M on XRPL. Your cap, budget, and merchant list stay as they are.'
      : 'Declining records the block. Nothing is signed or paid.',
  };
}
