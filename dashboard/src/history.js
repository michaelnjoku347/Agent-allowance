/**
 * Spending history: filters, totals, and CSV export. Pure, so the same rules
 * drive the Activity page, Eve's "show me" actions, and the tests.
 */

import { formatMicro, parseMicro } from './allowance.js';

export const STATUS_FILTERS = [
  ['all', 'All'],
  ['paid', 'Paid'],
  ['waiting', 'Needs you'],
  ['blocked', 'Blocked'],
];

export const PERIODS = [
  ['all', 'Any time'],
  ['today', 'Today'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
];

export const EMPTY_FILTERS = Object.freeze({ status: 'all', merchant: 'all', query: '', period: 'all' });

/** paid · waiting · blocked, the same words the status pills use. */
export function outcomeOf(item) {
  if (!item) return 'blocked';
  if (item.status === 'paid') return 'paid';
  if (item.declineOnly || item.reason === 'merchant not allowed' || item.status === 'declined' || item.status === 'skipped') {
    return 'blocked';
  }
  return 'waiting';
}

function merchantKey(item) {
  return String(item?.merchant || item?.merchantLabel || 'unknown').toLowerCase();
}

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Earliest createdAt a period allows, or null for any time. */
export function periodStart(period, now = Date.now()) {
  if (period === 'today') return startOfDay(now);
  if (period === '7d') return startOfDay(now) - 6 * 86_400_000;
  if (period === '30d') return startOfDay(now) - 29 * 86_400_000;
  return null;
}

/** Normalize anything a URL, Eve, or a form hands us into a known filter set. */
export function normalizeFilters(input = {}) {
  const statusIds = STATUS_FILTERS.map(([id]) => id);
  const periodIds = PERIODS.map(([id]) => id);
  return {
    status: statusIds.includes(input.status) ? input.status : 'all',
    merchant: typeof input.merchant === 'string' && input.merchant ? input.merchant.toLowerCase() : 'all',
    query: typeof input.query === 'string' ? input.query.slice(0, 120) : '',
    period: periodIds.includes(input.period) ? input.period : 'all',
  };
}

export function isFiltered(filters) {
  const f = normalizeFilters(filters);
  return f.status !== 'all' || f.merchant !== 'all' || f.query.trim() !== '' || f.period !== 'all';
}

export function filterHistory(items = [], filters = {}, now = Date.now()) {
  const f = normalizeFilters(filters);
  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const since = periodStart(f.period, now);
  return items.filter((item) => {
    if (!item) return false;
    if (f.status !== 'all' && outcomeOf(item) !== f.status) return false;
    if (f.merchant !== 'all' && merchantKey(item) !== f.merchant) return false;
    if (since != null) {
      const at = Date.parse(item.createdAt ?? '');
      if (Number.isNaN(at) || at < since) return false;
    }
    if (words.length) {
      const haystack = [
        item.merchantLabel,
        item.merchant,
        item.task,
        item.reason,
        item.amount,
        item.txHash,
        item.id,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  });
}

/** One option per merchant that appears in the history, busiest first. */
export function merchantOptions(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = merchantKey(item);
    const row = map.get(key) ?? { value: key, label: item.merchantLabel || 'Merchant', count: 0 };
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Count and RLUSD per outcome, exact to the millionth. */
export function historyTotals(items = []) {
  const sums = { paid: 0n, waiting: 0n, blocked: 0n };
  const counts = { paid: 0, waiting: 0, blocked: 0 };
  for (const item of items) {
    if (!item) continue;
    const kind = outcomeOf(item);
    counts[kind] += 1;
    const amount = parseMicro(item.amount);
    if (amount !== null && amount > 0n) sums[kind] += amount;
  }
  return {
    count: items.filter(Boolean).length,
    counts,
    paid: formatMicro(sums.paid),
    waiting: formatMicro(sums.waiting),
    blocked: formatMicro(sums.blocked),
  };
}

const CSV_COLUMNS = [
  ['date', (item) => item.createdAt ?? ''],
  ['merchant', (item) => item.merchantLabel ?? ''],
  ['merchant_address', (item) => item.merchant ?? ''],
  ['task', (item) => item.task ?? ''],
  ['amount_rlusd', (item) => item.amount ?? ''],
  ['status', (item) => outcomeOf(item)],
  ['reason', (item) => item.reason ?? ''],
  ['approved_by', (item) => item.approvedBy ?? (item.status === 'paid' ? 'rules' : '')],
  ['tx_hash', (item) => item.txHash ?? ''],
  ['receipt_url', (item) => item.receiptUrl ?? ''],
  ['example_row', (item) => (item.sample ? 'yes' : 'no')],
];

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * One CSV cell. Quotes when needed, and defuses spreadsheet formulas: a cell
 * that starts with = + - @ tab or CR gets a leading apostrophe, so a merchant
 * label like "=HYPERLINK(...)" opens as text, not as a live formula.
 */
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(items = []) {
  const head = CSV_COLUMNS.map(([name]) => name).join(',');
  const body = items.filter(Boolean).map((item) => CSV_COLUMNS.map(([, get]) => csvCell(get(item))).join(','));
  return `${[head, ...body].join('\r\n')}\r\n`;
}

export function csvFilename(now = new Date()) {
  const date = new Date(now);
  const day = Number.isNaN(date.getTime()) ? 'export' : date.toISOString().slice(0, 10);
  return `agent-allowance-history-${day}.csv`;
}

/** Browser only: save the rows as a CSV file. Returns the file name. */
export function downloadCsv(items, now = new Date()) {
  const name = csvFilename(now);
  // A byte-order mark makes Excel read the file as UTF-8.
  const blob = new Blob(['﻿', toCsv(items)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}
