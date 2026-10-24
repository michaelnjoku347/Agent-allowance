/**
 * Figures for the allowance hero.
 *
 * Sample rows are a preview. `/api/status` counts them until the agent
 * connects (seeded ledger: 7.5 spent, 12.5 remaining) while this screen
 * lists only real payments, the same rule as `spentRlusd()` in the ledger.
 * Left, spent, and budget all come from those real rows, so the hero, the
 * ring, and the caption describe one total.
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

function asNumber(micro) {
  return Number(micro) / 1_000_000;
}

export function allowanceView(snapshot) {
  const payments = (snapshot?.payments ?? []).filter((item) => item && !item.sample);
  const pending = (snapshot?.pending ?? [])
    .filter((item) => item && !item.sample)
    .map((item) => ({ ...item, status: item.status || 'pending' }));
  const parsedBudget = parseMicro(snapshot?.rules?.budget ?? snapshot?.budget ?? 0);
  const budgetMicro = parsedBudget !== null && parsedBudget > 0n ? parsedBudget : 0n;
  const spentMicro = payments.reduce((sum, item) => {
    if (item.status !== 'paid') return sum;
    const amount = parseMicro(item.amount);
    if (amount === null || amount <= 0n) return sum;
    return sum + amount;
  }, 0n);
  const leftMicro = budgetMicro > spentMicro ? budgetMicro - spentMicro : 0n;
  const activity = [...payments, ...pending].sort((a, b) => (
    Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
  ));
  const ratio = budgetMicro === 0n
    ? 0
    : Math.min(1, asNumber(spentMicro) / asNumber(budgetMicro));
  return {
    payments,
    pending,
    activity,
    budget: formatMicro(budgetMicro),
    spent: formatMicro(spentMicro),
    left: formatMicro(leftMicro),
    budgetNumber: asNumber(budgetMicro),
    spentNumber: asNumber(spentMicro),
    leftNumber: asNumber(leftMicro),
    ratio,
  };
}
