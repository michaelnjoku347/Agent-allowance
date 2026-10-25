/**
 * RLUSD in millionths, as BigInt, so sums of display amounts stay exact
 * (0.1 + 0.2 is 0.3). Shared by the API's Eve and the dashboard.
 */

const SCALE = 1_000_000n;

/** RLUSD display amount → millionths. Null when the value is not a number. */
export function parseMicro(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return BigInt(Math.round(value * 1_000_000));
  }
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const digits = match[3] ?? '';
  let frac = BigInt(digits.slice(0, 6).padEnd(6, '0'));
  if (digits[6] >= '5') frac += 1n;
  return sign * (whole * SCALE + frac);
}

export function formatMicro(micro) {
  const sign = micro < 0n ? '-' : '';
  const abs = micro < 0n ? -micro : micro;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}
