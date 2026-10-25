/**
 * Allowance rules for Agent Allowance.
 *
 * checkRules(purchase) is the only gate in front of a payment. It never signs
 * anything. Amounts are RLUSD, compared at 18 decimals so "5" and "5.0" match
 * and a price one wei over the cap does not slip through.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCALE = 10n ** 18n;
const RULES_PATH = join(dirname(fileURLToPath(import.meta.url)), 'rules.json');

/** Rules file. Tests point ALLOWANCE_RULES at a copy so the repo file stays put. */
export function rulesFile() {
  return process.env.ALLOWANCE_RULES || RULES_PATH;
}

/** RLUSD display amount or integer string → 18-decimal base units. */
export function toUnits(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid RLUSD amount: ${value}`);
  }
  const [whole, frac = ''] = raw.split('.');
  if (frac.length > 18) {
    throw new Error(`RLUSD amount has more than 18 decimals: ${value}`);
  }
  const padded = frac.padEnd(18, '0');
  return BigInt(whole) * SCALE + BigInt(padded);
}

/** Trimmed decimal, e.g. 7.5 RLUSD → "7.5", 20 RLUSD → "20". */
export function formatRlusd(units) {
  const whole = units / SCALE;
  const frac = (units % SCALE).toString().padStart(18, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function canonicalAddress(value) {
  const address = String(value ?? '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/i.test(address)) {
    throw new Error(`Invalid merchant address: ${value}`);
  }
  return address.toLowerCase();
}

export function loadRules(file = rulesFile()) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const budget = toUnits(raw.budget);
  const maxPerPurchase = toUnits(raw.maxPerPurchase);
  if (budget <= 0n) throw new Error('budget must be a positive RLUSD amount');
  if (maxPerPurchase <= 0n) throw new Error('maxPerPurchase must be a positive RLUSD amount');
  if (maxPerPurchase > budget) throw new Error('maxPerPurchase cannot be larger than the budget');

  const expiresAtMs = Date.parse(raw.expiresAt);
  if (Number.isNaN(expiresAtMs)) throw new Error('expiresAt must be an ISO date');
  if (!Array.isArray(raw.allowedMerchants)) throw new Error('allowedMerchants must be a list of addresses');

  const allowedMerchants = [];
  for (const merchant of raw.allowedMerchants) {
    const address = canonicalAddress(merchant);
    if (!allowedMerchants.includes(address)) allowedMerchants.push(address);
  }

  const merchantLabels = {};
  for (const [address, label] of Object.entries(raw.merchantLabels ?? {})) {
    merchantLabels[canonicalAddress(address)] = String(label);
  }

  let approverAddress = null;
  if (raw.approverAddress != null && String(raw.approverAddress).trim() !== '') {
    approverAddress = canonicalAddress(raw.approverAddress);
  }

  return {
    budget,
    maxPerPurchase,
    expiresAt: new Date(expiresAtMs).toISOString(),
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    allowedMerchants,
    merchantLabels,
    approverAddress,
    currency: 'RLUSD',
  };
}

/**
 * The Ledger account that may approve one out-of-rule purchase.
 * APPROVER_ADDRESS in the environment wins over rules.json. A public address
 * only — this never reads a private key.
 */
export function activeApprover(rules = loadRules(), env = process.env) {
  const raw = String(env.APPROVER_ADDRESS ?? '').trim() || rules.approverAddress || '';
  if (!raw) return null;
  return canonicalAddress(raw);
}

export function merchantLabel(rules, address) {
  try {
    return rules.merchantLabels[canonicalAddress(address)] ?? null;
  } catch {
    return null;
  }
}

/** JSON-safe view of the rules for the API and the dashboard. */
export function presentRules(rules) {
  return {
    summary: rules.summary,
    budget: formatRlusd(rules.budget),
    maxPerPurchase: formatRlusd(rules.maxPerPurchase),
    expiresAt: rules.expiresAt,
    currency: rules.currency,
    allowedMerchants: rules.allowedMerchants.map((address) => ({
      address,
      label: rules.merchantLabels[address] ?? null,
    })),
    approverAddress: readApprover(rules),
  };
}

function readApprover(rules) {
  try {
    return activeApprover(rules);
  } catch {
    return null;
  }
}

/**
 * The allowance that `patch` would write. A raise is a higher cap, a higher
 * budget, a later expiry, or a merchant that was not already listed.
 * Nothing here writes the file or signs a payment.
 */
export function describeAllowanceChange(patch = {}, file = rulesFile()) {
  const current = loadRules(file);
  let nextBudget = current.budget;
  let nextCap = current.maxPerPurchase;
  let nextExpiry = current.expiresAt;
  let nextMerchants = [...current.allowedMerchants];
  try {
    if (patch.budget !== undefined) nextBudget = toUnits(patch.budget);
    if (patch.maxPerPurchase !== undefined) nextCap = toUnits(patch.maxPerPurchase);
  } catch (error) {
    return { error: error.message ?? 'That amount is not valid.' };
  }
  if (patch.expiresAt !== undefined) {
    const ms = Date.parse(patch.expiresAt);
    if (Number.isNaN(ms)) return { error: 'expiresAt must be an ISO date.' };
    nextExpiry = new Date(ms).toISOString();
  }
  if (patch.allowedMerchants !== undefined) {
    if (!Array.isArray(patch.allowedMerchants) || patch.allowedMerchants.length === 0) {
      return { error: 'Keep at least one merchant.' };
    }
    try {
      const list = [];
      for (const merchant of patch.allowedMerchants) {
        const address = canonicalAddress(merchant);
        if (!list.includes(address)) list.push(address);
      }
      nextMerchants = list;
    } catch (error) {
      return { error: error.message ?? 'That merchant is not valid.' };
    }
  }
  if (nextBudget <= 0n || nextCap <= 0n) return { error: 'Amount must be greater than 0.' };
  if (nextCap > nextBudget) return { error: 'The per-purchase cap cannot be larger than the budget.' };
  const added = nextMerchants.some((address) => !current.allowedMerchants.includes(address));
  const raises = nextCap > current.maxPerPurchase
    || nextBudget > current.budget
    || Date.parse(nextExpiry) > Date.parse(current.expiresAt)
    || added;
  return {
    current,
    next: {
      budget: nextBudget,
      maxPerPurchase: nextCap,
      expiresAt: nextExpiry,
      allowedMerchants: nextMerchants,
    },
    raises,
  };
}

/**
 * Change the allowance. Lowering a limit is applied here.
 * Raising the cap, the budget, or the expiry, or adding a merchant, is refused
 * unless `ledger` is true — that flag is set only after a SetAllowance signature.
 * Nothing here signs a payment.
 */
export function updateAllowance(patch = {}, file = rulesFile(), options = {}) {
  const described = describeAllowanceChange(patch, file);
  if (described.error) return described;
  if (described.raises && !options.ledger) {
    return {
      error: 'Raising the cap, budget, or expiry, or adding a merchant, needs a Ledger signature.',
      code: 'needs_ledger',
    };
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.budget = formatRlusd(described.next.budget);
  raw.maxPerPurchase = formatRlusd(described.next.maxPerPurchase);
  raw.expiresAt = described.next.expiresAt;
  raw.allowedMerchants = described.next.allowedMerchants;
  writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
  return { ok: true, rules: presentRules(loadRules(file)) };
}

/**
 * Decide whether the agent may pay for this quote.
 *
 * purchase.merchant  payout address from the 402 challenge
 * purchase.amount    price in RLUSD (not wei)
 * purchase.spent     RLUSD already paid from this allowance (optional, default 0)
 * purchase.at        ISO time to judge expiry (optional, default now)
 *
 * The first failing rule wins, in this order: expired, merchant not allowed,
 * over per-purchase cap, over budget. A purchase on the cap or on the budget
 * is still allowed.
 *
 * @returns {{ decision: 'allow' | 'needs_approval', reason: string }}
 */
export function checkRules(purchase, rules = loadRules()) {
  if (!purchase || typeof purchase !== 'object') {
    throw new Error('purchase must describe the merchant quote');
  }
  const amount = toUnits(purchase.amount);
  const spent = toUnits(purchase.spent ?? 0);
  const at = purchase.at === undefined ? Date.now() : Date.parse(purchase.at);
  if (Number.isNaN(at)) throw new Error('purchase.at must be an ISO date');
  const merchant = canonicalAddress(purchase.merchant);

  if (amount <= 0n) {
    return { decision: 'needs_approval', reason: 'amount must be positive' };
  }
  // An allowance that has reached expiresAt no longer pays on its own,
  // even when the merchant and the price would otherwise pass.
  if (at >= Date.parse(rules.expiresAt)) {
    return { decision: 'needs_approval', reason: 'expired' };
  }
  if (!rules.allowedMerchants.includes(merchant)) {
    return { decision: 'needs_approval', reason: 'merchant not allowed' };
  }
  if (amount > rules.maxPerPurchase) {
    return { decision: 'needs_approval', reason: 'over per-purchase cap' };
  }
  if (spent + amount > rules.budget) {
    return { decision: 'needs_approval', reason: 'over budget' };
  }
  return { decision: 'allow', reason: 'within allowance' };
}

/**
 * Rules a Ledger approval cannot override: a positive price, an allowance
 * that has not expired, and room in the budget. The merchant allowlist and
 * the per-purchase cap are the rules a person can approve past. Jev is not
 * consulted here and cannot allow a purchase on its own.
 */
export function checkApprovalHardRules(purchase, rules = loadRules()) {
  if (!purchase || typeof purchase !== 'object') {
    throw new Error('purchase must describe the merchant quote');
  }
  const amount = toUnits(purchase.amount);
  const spent = toUnits(purchase.spent ?? 0);
  const at = purchase.at === undefined ? Date.now() : Date.parse(purchase.at);
  if (Number.isNaN(at)) throw new Error('purchase.at must be an ISO date');
  canonicalAddress(purchase.merchant);
  if (amount <= 0n) {
    return { decision: 'needs_approval', reason: 'amount must be positive' };
  }
  if (at >= Date.parse(rules.expiresAt)) {
    return { decision: 'needs_approval', reason: 'expired' };
  }
  if (spent + amount > rules.budget) {
    return { decision: 'needs_approval', reason: 'over budget' };
  }
  return { decision: 'allow', reason: 'ledger approved' };
}
