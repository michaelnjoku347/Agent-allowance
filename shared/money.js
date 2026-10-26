/**
 * RLUSD for people, shared by the API (Eve's replies) and the dashboard:
 * two to four decimals, so 20 reads "20.00", a cent reads "0.01", and a
 * quarter cent reads "0.0025". A value that four decimals would round away
 * (0.00005) keeps up to six, so a screen never shows a different amount from
 * the one that is paid.
 */
export function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value ?? '');
  const four = Number(amount.toFixed(4));
  const digits = Math.abs(four - amount) < 1e-12 ? 4 : 6;
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}
