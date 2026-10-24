import { toUnits, unitsToNumber } from './format.js';

/**
 * One view of the allowance, derived from the rows the page shows.
 *
 * The API's own spent/remaining fields count sample rows until the agent
 * runs, while the rules engine and Eve do not, so the page used to show a
 * balance that did not add up with its own list. Everything here comes from
 * the same rows, added up in base units: left + spent === budget, always.
 */
export function deriveLedger(snapshot) {
  const payments = snapshot?.payments ?? [];
  const pending = (snapshot?.pending ?? [])
    .map((item) => ({ ...item, status: item.status || 'pending' }))
    .filter((item) => item.status === 'pending');
  const budget = toUnits(snapshot?.rules?.budget ?? snapshot?.budget) ?? 0n;
  const cap = toUnits(snapshot?.rules?.maxPerPurchase) ?? 0n;
  const paid = payments.filter((item) => item.status === 'paid');
  const spent = paid.reduce((sum, item) => sum + (toUnits(item.amount) ?? 0n), 0n);
  const left = budget > spent ? budget - spent : 0n;
  const over = spent > budget ? spent - budget : 0n;
  const activity = [...pending, ...payments].sort((a, b) => (
    Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
  ));
  const ratioLeft = budget === 0n ? 0 : Math.max(0, Math.min(1, unitsToNumber(left) / unitsToNumber(budget)));
  return {
    budget,
    cap,
    spent,
    left,
    over,
    ratioLeft,
    paidCount: paid.length,
    pending,
    activity,
    preview: activity.some((item) => item.sample),
  };
}

export function status(item) {
  if (item.status === 'paid') return { key: 'paid', label: 'Paid', tone: 'ok' };
  if (item.status === 'pending') return { key: 'waiting', label: 'Waiting', tone: 'warn' };
  if (item.status === 'approved') return { key: 'approved', label: 'Approved', tone: 'info' };
  if (item.status === 'declined') return { key: 'blocked', label: 'Blocked', tone: 'danger' };
  return { key: 'waiting', label: item.status || 'Waiting', tone: 'warn' };
}
