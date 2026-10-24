/**
 * RLUSD has 18 decimals. Amounts are added up as base units (BigInt) so the
 * balance, the amount spent and the budget always agree to the last digit,
 * and every figure on the page goes through the same formatter.
 */
const SCALE = 10n ** 18n;

/** "7.5" → 7500000000000000000n. Returns null for anything that is not a plain decimal. */
export function toUnits(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [whole, frac = ''] = raw.split('.');
  return BigInt(whole) * SCALE + BigInt(frac.slice(0, 18).padEnd(18, '0'));
}

/** Base units → "1,234.50". Always two decimals, more only when the amount needs them (up to six). */
export function formatUnits(units) {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = (abs / SCALE).toLocaleString('en-US');
  let frac = (abs % SCALE).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  frac = frac.padEnd(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

export function money(value) {
  if (typeof value === 'bigint') return formatUnits(value);
  const units = toUnits(value);
  return units === null ? String(value ?? '') : formatUnits(units);
}

/** Base units → Number, only for drawing (rings, bars, count-up). Never for totals. */
export function unitsToNumber(units) {
  return Number(units / 10n ** 12n) / 1e6;
}

const ZONE = 'America/New_York';

export function when(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function clock(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function day(iso) {
  if (!iso) return 'Earlier';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const key = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(d);
  const today = key(new Date());
  const yesterday = key(new Date(Date.now() - 86_400_000));
  if (key(date) === today) return 'Today';
  if (key(date) === yesterday) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'long', month: 'short', day: 'numeric' }).format(date);
}

export function dateOnly(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function daysUntil(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export function shortAddress(address) {
  if (!address || address.length < 12) return address || '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
