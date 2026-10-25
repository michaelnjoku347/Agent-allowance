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

function sameMoney(left, right) {
  const a = parseMicro(left);
  const b = parseMicro(right);
  if (a === null || b === null) return false;
  return a === b;
}

/** Warn when the local ledger and the open channel do not show the same figures. */
export function channelWarning({ localSpent, budget, chain }) {
  if (!chain || chain.redeemed == null || chain.cap == null) return null;
  const notes = [];
  if (!sameMoney(localSpent, chain.redeemed)) {
    notes.push(`the local ledger shows ${localSpent} RLUSD spent and the channel shows ${chain.redeemed} RLUSD redeemed`);
  }
  if (!sameMoney(budget, chain.cap)) {
    notes.push(`the local budget is ${budget} RLUSD and the channel cap is ${chain.cap} RLUSD`);
  }
  if (!notes.length) return null;
  return `These figures disagree: ${notes.join('; ')}.`;
}

export function allowanceView(snapshot) {
  const offlinePreview = Boolean(snapshot?.offlinePreview);
  const payments = (snapshot?.payments ?? []).filter((item) => item && (offlinePreview || !item.sample));
  const pending = (snapshot?.pending ?? [])
    .filter((item) => item && (offlinePreview || !item.sample))
    .map((item) => ({ ...item, status: item.status || 'pending' }));
  const parsedBudget = parseMicro(snapshot?.rules?.budget ?? snapshot?.budget ?? 0);
  const budgetMicro = parsedBudget !== null && parsedBudget > 0n ? parsedBudget : 0n;
  const localSpentMicro = payments.reduce((sum, item) => {
    if (item.sample || item.status !== 'paid') return sum;
    const amount = parseMicro(item.amount);
    if (amount === null || amount <= 0n) return sum;
    return sum + amount;
  }, 0n);
  const chainRedeemed = snapshot?.chain?.redeemed;
  const chainMicro = chainRedeemed == null || chainRedeemed === '' ? null : parseMicro(chainRedeemed);
  const spentMicro = chainMicro !== null && chainMicro > localSpentMicro ? chainMicro : localSpentMicro;
  const leftMicro = budgetMicro > spentMicro ? budgetMicro - spentMicro : 0n;
  const activity = [...payments, ...pending].sort((a, b) => (
    Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
  ));
  const ratio = budgetMicro === 0n
    ? 0
    : Math.min(1, asNumber(spentMicro) / asNumber(budgetMicro));
  const localSpent = formatMicro(localSpentMicro);
  const budget = formatMicro(budgetMicro);
  return {
    payments,
    pending,
    activity,
    budget,
    localSpent,
    chainRedeemed: chainMicro === null ? null : formatMicro(chainMicro),
    chainCap: snapshot?.chain?.cap ?? null,
    chainWarning: channelWarning({ localSpent, budget, chain: snapshot?.chain }),
    offlinePreview,
    spent: formatMicro(spentMicro),
    left: formatMicro(leftMicro),
    budgetNumber: asNumber(budgetMicro),
    spentNumber: asNumber(spentMicro),
    leftNumber: asNumber(leftMicro),
    ratio,
  };
}
