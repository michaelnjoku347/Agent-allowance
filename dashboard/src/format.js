export { money } from '../../shared/money.js';

export function when(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/** Short relative time. The exact timestamp belongs in a title attribute. */
export function relativeTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const then = date.getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (Math.abs(minutes) < 1) return 'Just now';
  if (Math.abs(minutes) < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours} hour${Math.abs(hours) === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${Math.abs(days) === 1 ? '' : 's'} ago`;
}

export function clock(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/** Readable expiry for the approval sheet, for example "Dec 31, 2026, 11:59 PM". */
export function ceremonyDate(iso) {
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

export function shortAddress(address) {
  if (!address || address.length < 12) return address || '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
