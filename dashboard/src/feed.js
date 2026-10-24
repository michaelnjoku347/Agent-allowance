/** Steps the live feed plays, in order. Times are for display only. */

export const DEMO_TASK = 'Buy the morning weather brief';
export const STEP_MS = 360;

export const STEP_DEFS = [
  { key: 'requested', label: 'Requested resource' },
  { key: 'challenge', label: '402 received' },
  { key: 'rules', label: 'Rules checked' },
  { key: 'voucher', label: 'Voucher signed' },
  { key: 'released', label: 'Resource released' },
  { key: 'settled', label: 'Settled on XRPL' },
];

const OFFSETS_MS = [12000, 10000, 8000, 5000, 3000, 0];

function at(base, index) {
  return new Date(base - OFFSETS_MS[index]).toISOString();
}

export function feedForPayment(payment) {
  const parsed = Date.parse(payment.createdAt);
  const base = Number.isNaN(parsed) ? Date.now() : parsed;
  return {
    id: payment.id,
    title: payment.task || 'Payment',
    blocked: false,
    sample: Boolean(payment.sample),
    steps: STEP_DEFS.map((step, index) => ({
      key: step.key,
      label: step.label,
      at: at(base, index),
      detail: step.key === 'rules'
        ? 'allow'
        : step.key === 'settled' && !payment.explorerUrl
          ? (payment.sample ? 'Sample. Not on-chain.' : 'Recorded locally.')
          : null,
      href: step.key === 'settled' ? (payment.explorerUrl || null) : null,
    })),
  };
}

export function feedForPending(item) {
  const parsed = Date.parse(item.createdAt);
  const base = Number.isNaN(parsed) ? Date.now() : parsed;
  return {
    id: item.id,
    title: item.task || 'Blocked purchase',
    blocked: true,
    reason: item.reason,
    sample: Boolean(item.sample),
    steps: STEP_DEFS.slice(0, 3).map((step, index) => ({
      key: step.key,
      label: step.label,
      at: at(base, index),
      detail: step.key === 'rules' ? item.reason : null,
      href: null,
      blocked: step.key === 'rules',
    })),
  };
}

/** Newest decision wins. A newer block stops the feed at the rules check. */
export function selectFeed(view) {
  if (!view) return null;
  const newestPaid = (view.payments ?? []).find((payment) => payment.status === 'paid');
  const newestPending = view.pending?.[0];
  const paidAt = newestPaid ? Date.parse(newestPaid.createdAt) || 0 : -1;
  const pendingAt = newestPending ? Date.parse(newestPending.createdAt) || 0 : -1;
  if (newestPending && pendingAt >= paidAt) return feedForPending(newestPending);
  if (newestPaid) return feedForPayment(newestPaid);
  return null;
}

export function liveSteps(startedAt, count) {
  return STEP_DEFS.slice(0, count).map((step, index) => ({
    key: step.key,
    label: step.label,
    at: new Date(startedAt + index * STEP_MS).toISOString(),
    detail: step.key === 'rules'
      ? 'allow'
      : step.key === 'settled'
        ? 'Waiting for the transaction.'
        : null,
    href: null,
  }));
}
