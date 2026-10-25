/**
 * Figures for the allowance hero.
 *
 * A live allowance counts only real payments, the same rule as
 * `spentRlusd()` in the ledger. The offline preview lists the sample rows,
 * so those paid samples are the spend the hero, the ring, and the caption
 * describe: 7.5 of 20, 12.5 left.
 */

import { formatMicro, parseMicro } from '../../shared/micro.js';

export { formatMicro, parseMicro };

const SCALE = 1_000_000n;

function asNumber(micro) {
  return Number(micro) / 1_000_000;
}

function sameMoney(left, right) {
  const a = parseMicro(left);
  const b = parseMicro(right);
  if (a === null || b === null) return false;
  return a === b;
}

/** Warn when the local ledger and the open channel do not show the same figures. */
export function channelWarning({ localSpent, budget, chain }) {
  if (!chain || chain.redeemed == null || chain.cap == null) return null;
  const notes = [];
  if (!sameMoney(localSpent, chain.redeemed)) {
    notes.push(`the local ledger shows ${localSpent} RLUSD spent and the channel shows ${chain.redeemed} RLUSD redeemed`);
  }
  if (!sameMoney(budget, chain.cap)) {
    notes.push(`the local budget is ${budget} RLUSD and the channel cap is ${chain.cap} RLUSD`);
  }
  if (!notes.length) return null;
  return `These figures disagree: ${notes.join('; ')}.`;
}

export function allowanceView(snapshot) {
  const offlinePreview = Boolean(snapshot?.offlinePreview);
  // Sample rows stay on screen until a real agent decision replaces them.
  const showSamples = offlinePreview || snapshot?.agentConnected === false;
  const payments = (snapshot?.payments ?? []).filter((item) => item && (showSamples || !item.sample));
  const pending = (snapshot?.pending ?? [])
    .filter((item) => item && (showSamples || !item.sample))
    .map((item) => ({ ...item, status: item.status || 'pending' }));
  const parsedBudget = parseMicro(snapshot?.rules?.budget ?? snapshot?.budget ?? 0);
  const budgetMicro = parsedBudget !== null && parsedBudget > 0n ? parsedBudget : 0n;
  const localSpentMicro = payments.reduce((sum, item) => {
    if ((!showSamples && item.sample) || item.status !== 'paid') return sum;
    const amount = parseMicro(item.amount);
    if (amount === null || amount <= 0n) return sum;
    return sum + amount;
  }, 0n);
  const chainRedeemed = snapshot?.chain?.redeemed;
  const chainMicro = chainRedeemed == null || chainRedeemed === '' ? null : parseMicro(chainRedeemed);
  const spentMicro = chainMicro !== null && chainMicro > localSpentMicro ? chainMicro : localSpentMicro;
  const leftMicro = budgetMicro > spentMicro ? budgetMicro - spentMicro : 0n;
  const heldMicro = pending.reduce((sum, item) => {
    const amount = parseMicro(item.amount);
    if (amount === null || amount <= 0n) return sum;
    return sum + amount;
  }, 0n);
  const activity = [...payments, ...pending].sort((a, b) => (
    Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
  ));
  const ratio = budgetMicro === 0n
    ? 0
    : Math.min(1, asNumber(spentMicro) / asNumber(budgetMicro));
  const localSpent = formatMicro(localSpentMicro);
  const budget = formatMicro(budgetMicro);
  return {
    payments,
    pending,
    activity,
    budget,
    localSpent,
    chainRedeemed: chainMicro === null ? null : formatMicro(chainMicro),
    chainCap: snapshot?.chain?.cap ?? null,
    chainWarning: channelWarning({ localSpent, budget, chain: snapshot?.chain }),
    offlinePreview,
    demo: showSamples && (
      (snapshot?.payments ?? []).some((item) => item?.sample)
      || (snapshot?.pending ?? []).some((item) => item?.sample)
    ),
    spent: formatMicro(spentMicro),
    left: formatMicro(leftMicro),
    held: formatMicro(heldMicro),
    lost: '0',
    budgetNumber: asNumber(budgetMicro),
    spentNumber: asNumber(spentMicro),
    leftNumber: asNumber(leftMicro),
    ratio,
  };
}
