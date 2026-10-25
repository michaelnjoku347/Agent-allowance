/**
 * The allowance editor's arithmetic: a draft from the current rules, field
 * checks, and a diff that says which changes lower a limit (applied at once)
 * and which raise one (your Ledger signs). The server re-checks all of it.
 */

import { formatMicro, parseMicro } from './allowance.js';
import { money } from './format.js';

const AMOUNT = /^\d{1,12}(\.\d{1,18})?$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const MAX_MERCHANTS = 50;

/** YYYY-MM-DD of an ISO time, in UTC, for a date input. */
export function dateInput(iso) {
  const ms = Date.parse(iso ?? '');
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString().slice(0, 10);
}

/** A picked day ends at 23:59:59 UTC, the same shape agent/rules.json uses. */
export function endOfDayIso(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return null;
  const ms = Date.parse(`${day}T23:59:59.000Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function addressOf(item) {
  return String(typeof item === 'string' ? item : item?.address ?? '').toLowerCase();
}

export function draftFrom(rules = {}) {
  return {
    budget: String(rules.budget ?? ''),
    maxPerPurchase: String(rules.maxPerPurchase ?? ''),
    expiresOn: dateInput(rules.expiresAt),
    merchants: (rules.allowedMerchants ?? []).map(addressOf).filter(Boolean),
  };
}

/** Field errors in plain words. An empty object means the draft can be previewed. */
export function validateDraft(draft = {}, now = Date.now()) {
  const errors = {};
  const budget = String(draft.budget ?? '').trim();
  const cap = String(draft.maxPerPurchase ?? '').trim();
  if (!AMOUNT.test(budget) || (parseMicro(budget) ?? 0n) <= 0n) errors.budget = 'Enter a budget above 0, like 20 or 12.50.';
  if (!AMOUNT.test(cap) || (parseMicro(cap) ?? 0n) <= 0n) errors.maxPerPurchase = 'Enter a cap above 0, like 5.';
  if (!errors.budget && !errors.maxPerPurchase && parseMicro(cap) > parseMicro(budget)) {
    errors.maxPerPurchase = 'The per-purchase cap cannot be larger than the budget.';
  }
  const expiry = endOfDayIso(draft.expiresOn);
  if (!expiry) errors.expiresOn = 'Pick the last day the agent may spend.';
  else if (Date.parse(expiry) <= now) errors.expiresOn = 'Pick a day after today, or the agent cannot pay at all.';
  const merchants = draft.merchants ?? [];
  if (merchants.length === 0) errors.merchants = 'Keep at least one merchant.';
  else if (merchants.length > MAX_MERCHANTS) errors.merchants = `Keep the list to ${MAX_MERCHANTS} merchants or fewer.`;
  else if (merchants.some((address) => !ADDRESS.test(address))) errors.merchants = 'Each merchant must be an 0x address with 40 hex characters.';
  return errors;
}

/** Checks one address typed into "Add merchant". Returns an error sentence or ''. */
export function merchantInputError(text, existing = []) {
  const address = String(text ?? '').trim();
  if (!address) return 'Paste the merchant payout address.';
  if (!ADDRESS.test(address)) return 'That is not an 0x address with 40 hex characters.';
  if (existing.map(addressOf).includes(address.toLowerCase())) return 'That merchant is already on the list.';
  return '';
}

function compareMicro(a, b) {
  const left = parseMicro(a);
  const right = parseMicro(b);
  if (left === null || right === null) return 0;
  return left === right ? 0 : left > right ? 1 : -1;
}

/**
 * What saving the draft would change. direction is 'lower' or 'raise'.
 * patch holds only changed fields, in the API's names.
 */
export function diffAllowance(rules = {}, draft = {}, labels = {}) {
  const current = draftFrom(rules);
  const changes = [];
  const patch = {};

  for (const [field, label] of [['budget', 'Budget'], ['maxPerPurchase', 'Per-purchase cap']]) {
    const next = String(draft[field] ?? '').trim();
    const order = compareMicro(next, current[field]);
    if (order === 0) continue;
    changes.push({
      field,
      label,
      from: `${money(current[field])} RLUSD`,
      to: `${money(formatMicro(parseMicro(next)))} RLUSD`,
      direction: order > 0 ? 'raise' : 'lower',
    });
    patch[field] = next;
  }

  if (draft.expiresOn && draft.expiresOn !== current.expiresOn) {
    const iso = endOfDayIso(draft.expiresOn);
    if (iso) {
      changes.push({
        field: 'expiresAt',
        label: 'Expires',
        from: current.expiresOn || 'No date',
        to: draft.expiresOn,
        direction: Date.parse(iso) > Date.parse(rules.expiresAt ?? 0) ? 'raise' : 'lower',
      });
      patch.expiresAt = iso;
    }
  }

  const before = new Set(current.merchants);
  const after = (draft.merchants ?? []).map(addressOf);
  const added = after.filter((address) => !before.has(address));
  const removed = current.merchants.filter((address) => !after.includes(address));
  const name = (address) => labels[address] || `${address.slice(0, 6)}…${address.slice(-4)}`;
  for (const address of removed) {
    changes.push({ field: 'allowedMerchants', label: 'Remove merchant', from: name(address), to: 'Removed', direction: 'lower' });
  }
  for (const address of added) {
    changes.push({ field: 'allowedMerchants', label: 'Add merchant', from: 'Not allowed', to: name(address), direction: 'raise' });
  }
  if (added.length || removed.length) patch.allowedMerchants = after;

  const raises = changes.some((change) => change.direction === 'raise');
  return { changes, raises, patch, empty: changes.length === 0 };
}

/** The full proposal the Ledger signs for a raise: every field, changed or not. */
export function ledgerProposal(rules = {}, draft = {}) {
  return {
    maxPerPurchase: String(draft.maxPerPurchase ?? rules.maxPerPurchase).trim(),
    budget: String(draft.budget ?? rules.budget).trim(),
    expiresAt: endOfDayIso(draft.expiresOn) ?? rules.expiresAt,
    allowedMerchants: (draft.merchants ?? draftFrom(rules).merchants).map(addressOf),
  };
}
