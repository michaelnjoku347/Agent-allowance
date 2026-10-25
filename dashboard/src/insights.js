/**
 * Small, honest summaries for the home board. Amounts are RLUSD display
 * strings; sums go through millionths so 0.1 + 0.2 stays 0.3.
 */

import { formatMicro, parseMicro } from './allowance.js';

function micro(value) {
  const parsed = parseMicro(value);
  return parsed !== null && parsed > 0n ? parsed : 0n;
}

/** Paid spend per merchant, largest first. share is of all paid spend, 0..1. */
export function spendByMerchant(payments = [], limit = 5) {
  const totals = new Map();
  let all = 0n;
  for (const item of payments) {
    if (!item || item.status !== 'paid') continue;
    const amount = micro(item.amount);
    if (amount === 0n) continue;
    const key = String(item.merchant || item.merchantLabel || 'unknown').toLowerCase();
    const row = totals.get(key) ?? { label: item.merchantLabel || 'Merchant', amount: 0n, count: 0 };
    row.amount += amount;
    row.count += 1;
    totals.set(key, row);
    all += amount;
  }
  const rows = [...totals.values()].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  const top = rows.slice(0, limit);
  const rest = rows.slice(limit);
  if (rest.length) {
    top.push({
      label: `${rest.length} more`,
      amount: rest.reduce((sum, row) => sum + row.amount, 0n),
      count: rest.reduce((sum, row) => sum + row.count, 0),
    });
  }
  return top.map((row) => ({
    label: row.label,
    amount: formatMicro(row.amount),
    count: row.count,
    share: all === 0n ? 0 : Number((row.amount * 10_000n) / all) / 10_000,
  }));
}

/** Counts by outcome for the activity list: paid, needs you, blocked. */
export function outcomeCounts(activity = []) {
  const counts = { paid: 0, waiting: 0, blocked: 0 };
  for (const item of activity) {
    if (!item) continue;
    if (item.status === 'paid') counts.paid += 1;
    else if (item.declineOnly || item.reason === 'merchant not allowed' || item.status === 'declined' || item.status === 'skipped') counts.blocked += 1;
    else counts.waiting += 1;
  }
  return counts;
}

/** Whole days until an ISO time, never negative. null when the date is unreadable. */
export function daysLeft(iso, now = Date.now()) {
  const at = Date.parse(iso ?? '');
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 86_400_000));
}

export function daysLabel(days) {
  if (days == null) return 'No date';
  if (days === 0) return 'Ends today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}
