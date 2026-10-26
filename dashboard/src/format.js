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

/**
 * Short relative time. The exact timestamp belongs in a title attribute.
 * A server clock a few minutes ahead still reads "Just now", never "-3 min ago".
 */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const date = new Date(iso);
  const then = date.getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1 && minutes > -5) return 'Just now';
  const ahead = minutes < 0;
  const span = Math.abs(minutes);
  const say = (text) => (ahead ? `in ${text}` : `${text} ago`);
  if (span < 60) return say(`${span} min`);
  const hours = Math.round(span / 60);
  if (hours < 24) return say(`${hours} hour${hours === 1 ? '' : 's'}`);
  const days = Math.round(hours / 24);
  return say(`${days} day${days === 1 ? '' : 's'}`);
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
