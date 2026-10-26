/**
 * Hourly ceiling for the agent.
 * A person on a Ledger is not checked here. This only stops the agent
 * from paying the next quote in a loop.
 */

import { formatRlusd, toUnits } from './rules.js';
import { DEMO_AMOUNTS } from '../shared/demo-amounts.js';

export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const RATE_MAX_PURCHASES = 3;
export const RATE_MAX_RLUSD = DEMO_AMOUNTS.hourly;

export function spendRateDecision({ payments = [], amount = '0', now = Date.now() } = {}) {
  const price = toUnits(amount);
  const recent = payments.filter((item) => {
    if (!item || item.sample || item.status !== 'paid') return false;
    const at = Date.parse(item.createdAt || 0);
    return Number.isFinite(at) && now - at < RATE_WINDOW_MS && now - at >= 0;
  });
  let spent = 0n;
  for (const item of recent) {
    try {
      spent += toUnits(item.amount);
    } catch {
      // A bad row does not raise the ceiling.
    }
  }
  const cap = toUnits(RATE_MAX_RLUSD);
  if (recent.length >= RATE_MAX_PURCHASES || spent + price > cap) {
    return {
      decision: 'needs_approval',
      reason: 'over spend rate',
      detail: `The agent may pay at most ${RATE_MAX_PURCHASES} purchases or ${formatRlusd(cap)} RLUSD an hour. This hour already has ${recent.length} payment${recent.length === 1 ? '' : 's'} and ${formatRlusd(spent)} RLUSD.`,
    };
  }
  return { decision: 'allow', reason: 'within spend rate' };
}
