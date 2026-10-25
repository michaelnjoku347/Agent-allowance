/**
 * Three scripted attacks for the dashboard.
 * Each one goes through the real allowance engine. None of them sign or pay.
 */

import { readFileSync } from 'node:fs';
import {
  checkApprovalHardRules,
  checkRules,
  declineReason,
  formatRlusd,
  loadRules,
  merchantLabel,
  presentRules,
  rulesFile,
  toUnits,
  updateAllowance,
} from '../agent/rules.js';
import { executeConfirmed, ruleAnswer } from './eve.js';
import { recordBlockedDecision } from './store.js';
import { plainReason } from '../shared/words.js';
import { DEMO_AMOUNTS } from '../shared/demo-amounts.js';

function overCapAmount(rules) {
  const history = toUnits(DEMO_AMOUNTS.history);
  if (history > rules.maxPerPurchase && history <= rules.budget) return formatRlusd(history);
  const step = rules.maxPerPurchase + toUnits(DEMO_AMOUNTS.step);
  if (step <= rules.budget) return formatRlusd(step);
  throw new Error('The per-purchase cap already fills the budget, so an over-cap attack cannot be shown.');
}

function raiseRequest(rules) {
  const cap = formatRlusd(rules.maxPerPurchase);
  const budget = formatRlusd(rules.budget);
  if (rules.maxPerPurchase < rules.budget) {
    const amount = overCapAmount(rules);
    return {
      message: `Set my cap to ${amount}`,
      patch: { maxPerPurchase: amount },
      attempt: `The agent asks Eve to raise its own per-purchase cap from ${cap} RLUSD to ${amount} RLUSD.`,
    };
  }
  const higher = formatRlusd(rules.budget + rules.budget);
  return {
    message: `Set my budget to ${higher}`,
    patch: { budget: higher },
    attempt: `The agent asks Eve to raise its own budget from ${budget} RLUSD to ${higher} RLUSD.`,
  };
}

/**
 * Run the three attacks and return the cards the dashboard animates.
 * A passing rule throws. The caller must not treat a throw as a blocked win.
 */
export async function runRogueDemo({
  rules = loadRules(),
  check = checkRules,
  hard = checkApprovalHardRules,
  decline = declineReason,
  answer = ruleAnswer,
  confirm = executeConfirmed,
  apply = updateAllowance,
  readText = () => readFileSync(rulesFile(), 'utf8'),
} = {}) {
  const before = readText();
  const allowed = rules.allowedMerchants[0];
  if (!allowed) throw new Error('The allowance has no merchant for the over-cap attack.');
  const denied = rules.deniedMerchants?.[0];
  if (!denied) throw new Error('The allowance has no denylisted merchant for the hard block.');

  const capAmount = overCapAmount(rules);
  const over = { merchant: allowed, amount: capAmount, spent: '0' };
  const overDecision = check(over, rules);
  if (overDecision.decision === 'allow') {
    throw new Error('The over-cap attack was inside the allowance. Nothing was signed.');
  }
  if (overDecision.reason !== 'over per-purchase cap') {
    throw new Error(`The over-cap attack was caught by “${overDecision.reason}”, so it is not the cap demo.`);
  }
  const overHard = hard(over, rules);
  if (overHard.decision !== 'allow') {
    throw new Error('The over-cap quote cannot be routed to Ledger approval.');
  }

  const outside = { merchant: denied.address, amount: DEMO_AMOUNTS.unlisted, spent: '0' };
  const outsideDecision = check(outside, rules);
  if (outsideDecision.decision === 'allow') {
    throw new Error('The unlisted merchant was inside the allowance. Nothing was signed.');
  }
  if (outsideDecision.reason !== 'merchant not allowed') {
    throw new Error(`The unlisted attack was caught by “${outsideDecision.reason}”, so it is not the allowlist demo.`);
  }
  const hardBlock = decline(denied.address, rules);
  const hardDecision = hard(outside, rules);
  if (!hardBlock && hardDecision.decision === 'allow') {
    throw new Error('That merchant is off the allowlist, and a Ledger signature could still pay it.');
  }

  const raise = raiseRequest(rules);
  const eve = answer(raise.message, {
    rules: presentRules(rules),
    spent: '0',
    pending: [],
    payments: [],
  });
  if (!eve.action || eve.action.ledger !== true) {
    throw new Error('Eve did not treat that request as a raise.');
  }
  const refused = apply(raise.patch);
  if (refused?.code !== 'needs_ledger') {
    throw new Error('The allowance engine did not require a Ledger signature. Nothing was changed.');
  }
  const confirmed = await confirm(eve.action);
  if (!confirmed?.error) {
    throw new Error('Eve applied a raise without a Ledger signature.');
  }
  if (readText() !== before) {
    throw new Error('The allowance file changed. The rogue demo must not write rules.');
  }

  const name = merchantLabel(rules, allowed) || 'an allowed merchant';
  const attempts = [
    {
      id: 'over-cap',
      title: 'Over the cap',
      attempt: `The agent tries to buy ${capAmount} RLUSD from ${name}. The cap is ${formatRlusd(rules.maxPerPurchase)} RLUSD.`,
      rule: overDecision.reason,
      ruleText: plainReason(overDecision.reason),
      outcome: 'Blocked',
      route: 'ledger',
      note: 'Routed to Ledger approval. Nothing was signed.',
      paid: false,
    },
    {
      id: 'unlisted',
      title: 'Off the allowlist',
      attempt: `The agent tries to pay ${DEMO_AMOUNTS.unlisted} RLUSD to ${denied.label || 'an unlisted merchant'}. That merchant is not on the allowlist.`,
      rule: outsideDecision.reason,
      ruleText: plainReason(outsideDecision.reason),
      outcome: 'Blocked',
      route: 'hard',
      note: hardBlock,
      paid: false,
    },
    {
      id: 'raise',
      title: 'Raise its own allowance',
      attempt: raise.attempt,
      rule: 'needs_ledger',
      ruleText: 'Raising the allowance needs a Ledger SetAllowance signature.',
      outcome: 'Blocked',
      route: 'allowance',
      note: confirmed.error,
      paid: false,
    },
  ];

  const blocked = attempts.filter((item) => item.outcome === 'Blocked' && item.paid === false).length;
  if (blocked !== attempts.length) {
    throw new Error('An attack was not blocked. Nothing was signed.');
  }
  try {
    for (const item of attempts) {
      await recordBlockedDecision({
        rule: item.rule,
        reason: item.note,
        merchantLabel: item.title,
        task: item.attempt,
        amount: item.id === 'unlisted' ? DEMO_AMOUNTS.unlisted : (item.id === 'over-cap' ? capAmount : null),
      });
    }
  } catch (error) {
    console.error(error.message ?? error);
  }
  return {
    ok: true,
    signed: false,
    paid: false,
    attempts,
    summary: {
      attempts: attempts.length,
      blocked,
      lost: '0',
      line: `${attempts.length} attempts, ${blocked} blocked, 0 RLUSD lost`,
    },
  };
}
