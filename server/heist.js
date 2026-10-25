/**
 * One-click prompt-injection demo.
 * The catalog row is fed to the same planner the agent uses.
 * The rules and the Ledger gate then block the 0.50 RLUSD quote.
 * Nothing is signed, and no payable quote is saved.
 */

import { readFileSync } from 'node:fs';
import { planHeist } from '../agent/planner.js';
import { quoteFromPaymentRequired } from '../agent/quote.js';
import {
  checkApprovalHardRules,
  checkRules,
  declineReason,
  loadRules,
  rulesFile,
  toUnits,
} from '../agent/rules.js';
import {
  HEIST_INJECTION,
  HEIST_PRICE,
  heistCatalog,
  heistResourceUrl,
} from '../shared/catalog.js';
import { plainReason } from '../shared/words.js';
import { recordBlockedDecision } from './store.js';

const CHANNEL = `0x${'11'.repeat(32)}`;

function catalogQuote(env) {
  const pack = heistCatalog(env).find((item) => item.id === 'premium-pack');
  return {
    amount: pack?.price ?? HEIST_PRICE,
    merchant: pack?.merchant,
    description: pack?.description ?? HEIST_INJECTION,
    resourceUrl: pack?.url ?? heistResourceUrl(env),
    quoteLoaded: false,
  };
}

async function readHeistQuote(env, fetchImpl) {
  const fallback = catalogQuote(env);
  try {
    const response = await fetchImpl(heistResourceUrl(env), {
      method: 'GET',
      headers: { 'X-AP4M-CHANNEL-ID': CHANNEL },
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    });
    if (response.status !== 402) return fallback;
    const quote = quoteFromPaymentRequired(response.headers.get('payment-required'));
    return { ...quote, quoteLoaded: true };
  } catch {
    return fallback;
  }
}

function spokenFor(planner, ruleText) {
  const moved = '0.00 RLUSD moved.';
  if (!planner.tookBait) {
    return `Attack blocked. The planner did not choose the premium pack. The rules still block that quote. ${ruleText} ${moved}`;
  }
  if (planner.live) {
    return `Attack blocked. Amazon Bedrock chose the premium pack. ${ruleText} ${moved}`;
  }
  return `Attack blocked. The fallback planner followed the catalog text and chose the premium pack. This was not a live model. ${ruleText} ${moved}`;
}

/**
 * Run the heist. A thrown error means the demo itself failed, not that a payment happened.
 */
export async function runHeist({
  env = process.env,
  fetchImpl = fetch,
  plan = planHeist,
  rules = loadRules(),
  check = checkRules,
  hard = checkApprovalHardRules,
  decline = declineReason,
  record = recordBlockedDecision,
  readText = () => readFileSync(rulesFile(), 'utf8'),
} = {}) {
  const before = readText();
  const quote = await readHeistQuote(env, fetchImpl);
  const planner = await plan({
    task: 'Choose the next research pack.',
    catalog: heistCatalog(env),
    env,
    rules,
  });
  const purchase = { merchant: quote.merchant, amount: quote.amount, spent: '0' };
  const decision = check(purchase, rules);
  const ledger = hard(purchase, rules);
  if (decision.decision === 'allow' || ledger.decision === 'allow') {
    throw new Error('The premium pack was inside the allowance. Nothing was signed.');
  }
  const block = decline(quote.merchant, rules);
  if (!block) throw new Error('A Ledger signature could still pay this merchant. Nothing was signed.');
  if (readText() !== before) throw new Error('The allowance file changed. The heist must not write rules.');

  const price = toUnits(quote.amount);
  const also = [];
  if (price > rules.maxPerPurchase) also.push('over per-purchase cap');
  if (toUnits(quote.spent ?? 0) + price > rules.budget) also.push('over budget');
  const ruleText = plainReason(decision.reason);
  const spoken = spokenFor(planner, ruleText);
  try {
    await record({
      rule: decision.reason,
      reason: spoken,
      merchantLabel: 'Premium pack',
      task: 'The heist catalog asked for the premium pack.',
      amount: quote.amount,
    });
  } catch (error) {
    console.error(error.message ?? error);
  }
  return {
    ok: true,
    signed: false,
    paid: false,
    lost: '0',
    moved: '0.00',
    injection: HEIST_INJECTION,
    planner: {
      source: planner.source,
      live: Boolean(planner.live),
      tookBait: Boolean(planner.tookBait),
      resourceId: planner.resourceId ?? null,
      reason: planner.reason,
    },
    rule: decision.reason,
    ruleText,
    also,
    ledgerCanPay: false,
    ledgerRule: ledger.reason,
    quoteLoaded: Boolean(quote.quoteLoaded),
    spoken,
  };
}
