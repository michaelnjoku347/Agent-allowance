/**
 * Same shape as the API, used only when the server cannot be reached.
 * While the server is up and the agent has not run, the API serves this
 * same sample set from shared/sample-data.json.
 */

import rules from '../../agent/rules.json';
import network from '../../shared/network.json';
import sample from '../../shared/sample-data.json';

const budget = Number(rules.budget);
const spent = sample.payments
  .filter((payment) => payment.status === 'paid')
  .reduce((sum, payment) => sum + Number(payment.amount), 0);
const remaining = Math.max(0, budget - spent);

export const sampleSnapshot = {
  budget: String(rules.budget),
  spent: String(spent),
  remaining: String(remaining),
  spentRatio: budget === 0 ? 0 : spent / budget,
  currency: 'RLUSD',
  agentConnected: false,
  rules: {
    summary: rules.summary ?? '',
    budget: String(rules.budget),
    maxPerPurchase: String(rules.maxPerPurchase),
    expiresAt: rules.expiresAt,
    currency: 'RLUSD',
    allowedMerchants: rules.allowedMerchants.map((address) => ({
      address,
      label: rules.merchantLabels?.[address] ?? null,
    })),
  },
  network: {
    name: network.name,
    chainId: network.chainId,
    explorerUrl: network.explorerUrl,
    currency: network.currency,
  },
  payments: sample.payments.map((payment) => ({
    ...payment,
    explorerUrl: null,
    reason: null,
    note: null,
  })),
  pending: sample.pending,
};

export async function fetchSnapshot() {
  const [statusRes, paymentsRes, pendingRes] = await Promise.all([
    fetch('/api/status', { cache: 'no-store' }),
    fetch('/api/payments', { cache: 'no-store' }),
    fetch('/api/pending', { cache: 'no-store' }),
  ]);
  if (!statusRes.ok || !paymentsRes.ok || !pendingRes.ok) {
    throw new Error('Allowance API did not answer.');
  }
  const status = await statusRes.json();
  const payments = await paymentsRes.json();
  const pending = await pendingRes.json();
  if (!Array.isArray(payments) || !Array.isArray(pending)) {
    throw new Error('Allowance API returned an unexpected payload.');
  }
  return { ...status, payments, pending };
}

/** Read a 6 RLUSD quote and let the rules reject it before anything is signed. */
export async function runOverCap() {
  const response = await fetch('/api/demo/over-cap', { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The over-cap demo did not run.');
  return body;
}

/** Ask the API to start the agent. A missing wallet still returns 200 with an error the page can show. */
export async function runAgent(task) {
  const response = await fetch('/api/run-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status >= 500) {
    throw new Error(body.error || 'Could not start the agent.');
  }
  return body;
}

export async function approvePurchase(id) {
  const response = await fetch(`/api/approve/${encodeURIComponent(id)}`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not approve that purchase.');
  return body;
}

export async function declinePurchase(id) {
  const response = await fetch(`/api/decline/${encodeURIComponent(id)}`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not decline that purchase.');
  return body;
}

export async function askEve(message) {
  const response = await fetch('/api/eve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Eve could not answer.');
  return body;
}

export async function confirmEve(token) {
  const response = await fetch('/api/eve/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'That confirmation did not go through.');
  return body;
}
