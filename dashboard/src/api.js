/**
 * Same shape as the API, used only when the server cannot be reached.
 * While the server is up and the agent has not run, the API serves this
 * same sample set from shared/sample-data.json.
 */

import rules from '../../agent/rules.json';
import network from '../../shared/network.json';
import sample from '../../shared/sample-data.json';
import { presentUseCase } from '../../shared/use-cases.js';
import { createReconnectingStream } from './connection.js';

const UNREACHABLE = 'Can’t reach the allowance server. Check that npm start is still running, then try again.';

/**
 * fetch with a timeout and a sentence a person can act on. A dropped
 * connection becomes kind "unreachable"; a 429 carries the server's wait.
 */
export async function call(path, { method = 'GET', body, timeoutMs = 15_000, fetchImpl = fetch } = {}) {
  const init = { method, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetchImpl(path, init);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const wrapped = new Error(timedOut ? 'The allowance server took too long to answer. Try again.' : UNREACHABLE);
    wrapped.kind = timedOut ? 'timeout' : 'unreachable';
    throw wrapped;
  }
  const parsed = await response.json().catch(() => ({}));
  return { response, body: parsed && typeof parsed === 'object' ? parsed : {} };
}

function failure(response, body, fallback) {
  const error = new Error(body.message || body.error || fallback);
  error.status = response.status;
  error.code = body.error;
  if (response.status === 429) error.kind = 'busy';
  return error;
}

async function postJson(path, payload, fallback, timeoutMs = 15_000) {
  const { response, body } = await call(path, { method: 'POST', body: payload, timeoutMs });
  if (!response.ok) throw failure(response, body, fallback);
  return body;
}

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
    deniedMerchants: (rules.deniedMerchants ?? []).map((item) => ({
      address: String(item.address ?? item).toLowerCase(),
      label: item.label ?? null,
      reason: item.reason ?? 'This merchant is decline-only. A Ledger signature cannot pay it.',
    })),
    approverAddress: rules.approverAddress ?? null,
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
  frozen: false,
  frozenAt: null,
  useCase: presentUseCase('research'),
  audit: [],
};

export async function fetchSnapshot(fetchImpl = fetch) {
  const [status, payments, pending] = await Promise.all([
    call('/api/status', { timeoutMs: 10_000, fetchImpl }),
    call('/api/payments', { timeoutMs: 10_000, fetchImpl }),
    call('/api/pending', { timeoutMs: 10_000, fetchImpl }),
  ]);
  for (const part of [status, payments, pending]) {
    if (!part.response.ok) throw failure(part.response, part.body, 'The allowance server did not answer.');
  }
  const rows = payments.body;
  if (!Array.isArray(rows) || !Array.isArray(pending.body)) {
    const error = new Error('The allowance server sent something unexpected.');
    error.kind = 'server';
    throw error;
  }
  return { ...status.body, payments: rows, pending: pending.body };
}

/** API, rules, and merchant reachability. Never throws; a silent API reads as down. */
export async function fetchHealth(fetchImpl = fetch) {
  try {
    const { body } = await call('/api/health', { timeoutMs: 5_000, fetchImpl });
    return body;
  } catch {
    return { ok: false, api: 'down' };
  }
}

/** One injected catalog row. The planner runs. The rules block it. Nothing is signed. */
export async function runHeist() {
  const body = await postJson('/api/demo/heist', undefined, 'The heist did not run.', 60_000);
  if (!body.ok) throw new Error(body.error || 'The heist did not run.');
  return body;
}

/** Three scripted attacks. The server runs the rules. Nothing is signed. */
export async function runRogueDemo() {
  const body = await postJson('/api/demo/rogue', undefined, 'The rogue demo did not run.', 60_000);
  if (!body.ok) throw new Error(body.error || 'The rogue demo did not run.');
  return body;
}

/** Read a 0.06 RLUSD quote and let the rules reject it before anything is signed. */
export async function runOverCap() {
  return postJson('/api/demo/over-cap', undefined, 'The over-cap demo did not run.', 60_000);
}

export async function requestAllowanceChallenge(proposal) {
  return postJson('/api/allowance/challenge', proposal ?? {}, 'Could not prepare that allowance change.');
}

export async function submitAllowance(payload) {
  return postJson('/api/allowance', payload, 'Could not change the allowance.', 60_000);
}

export async function requestMandateChallenge() {
  return postJson('/api/mandate/challenge', undefined, 'Could not prepare the agent mandate.');
}

export async function submitMandate(payload) {
  return postJson('/api/mandate', payload, 'The agent mandate was not accepted.');
}

export async function anchorDecisions() {
  return postJson('/api/anchor', undefined, 'The decision was not anchored.', 120_000);
}

/** Kill switch. Frozen refuses new payments until the dashboard unfreezes it. */
export async function setAgentFrozen(frozen) {
  // Freezing closes the payment channel on-chain, which can take a minute on testnet.
  return postJson('/api/freeze', { frozen }, frozen ? 'Could not freeze the agent.' : 'Could not unfreeze the agent.', 180_000);
}

/** Name the job. The server does not rewrite the allowance file. */
export async function selectUseCase(id) {
  return postJson('/api/use-case', { id }, 'Could not select that job.');
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

export async function requestApprovalChallenge(id) {
  return postJson(`/api/approve/${encodeURIComponent(id)}/challenge`, undefined, 'Could not prepare that approval.');
}

export async function fetchApprovalProgress(id) {
  const response = await fetch(`/api/approve/${encodeURIComponent(id)}/progress`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { inFlight: false, missing: true, phase: null };
  return body;
}

/** Backup demo only. The server rejects this unless ALLOWANCE_DEV_SIGNER=1. */
export async function simulateLedgerApproval(id) {
  return postJson(`/api/demo/simulated-ledger/${encodeURIComponent(id)}`, undefined, 'Could not approve that purchase.');
}

export async function submitLedgerApproval(id, payload) {
  const response = await fetch(`/api/approve/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 202 && body.inFlight) return body;
  if (!response.ok) throw new Error(body.message || body.error || 'Could not approve that purchase.');
  return body;
}

export async function declinePurchase(id) {
  return postJson(`/api/decline/${encodeURIComponent(id)}`, undefined, 'Could not decline that purchase.');
}

export async function askEve(message) {
  return postJson('/api/eve', { message }, 'Eve could not answer.', 180_000);
}

export async function confirmEve(token) {
  return postJson('/api/eve/confirm', { token }, 'That confirmation did not go through.', 120_000);
}

/** The agent's display name, and the moment setup finished. */
export async function saveProfile(profile) {
  return postJson('/api/profile', profile, 'Could not save the agent name.');
}

/** First run only: the server refuses once an approver is set. */
export async function setApprover(address) {
  return postJson('/api/approver', { address }, 'Could not save the approver.');
}

/** What an allowance change would do, and whether the Ledger must sign it. Writes nothing. */
export async function previewAllowance(patch) {
  return postJson('/api/allowance/preview', patch, 'Could not check that change.');
}

/** Apply a change that only lowers limits. The server refuses any raise with 403. */
export async function lowerAllowance(patch) {
  return postJson('/api/allowance/lower', patch, 'Could not save that change.');
}

/**
 * Live store changes and payment stages from GET /api/events. Returns a
 * function that closes the stream. onOpen and onDown tell the caller when to
 * lean on the stream and when to fall back to polling. A dropped stream
 * reconnects with exponential backoff; `reconnect` on the returned function
 * skips the wait, for example when the browser comes back online.
 */
export function subscribeEvents({ onChange, onStage, onOpen, onDown } = {}) {
  const stream = createReconnectingStream({
    url: '/api/events',
    onOpen,
    onDown,
    handlers: {
      change: (data) => onChange?.(data),
      stage: (data) => onStage?.(data),
    },
  });
  const close = () => stream.close();
  close.reconnect = () => stream.reconnectNow();
  return close;
}
