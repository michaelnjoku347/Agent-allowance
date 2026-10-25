/**
 * JSON ledger shared by the API and the agent.
 *
 * The file is created on first read and seeded with sample purchases so the
 * dashboard has something to show. The first real agent action clears those
 * samples and marks the allowance as connected.
 */

import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import sampleData from '../shared/sample-data.json' with { type: 'json' };
import network from '../shared/network.json' with { type: 'json' };
import { canonicalAddress, declineReason, formatRlusd, loadRules, presentRules, toUnits } from '../agent/rules.js';
import { plainReason } from '../shared/words.js';
import { presentUseCase, useCaseById } from '../shared/use-cases.js';

const defaultStorePath = join(dirname(fileURLToPath(import.meta.url)), 'data', 'store.json');

function storePath() {
  return process.env.ALLOWANCE_STORE || defaultStorePath;
}

/** The store file, for the live event stream that watches it. */
export function storeFile() {
  return storePath();
}

/** Drop the ledger file so the next write starts clean. Used by the backup demo. */
export function discardStoreFile() {
  try {
    unlinkSync(storePath());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function lockPath() {
  return `${storePath()}.lock`;
}

function freshStore() {
  return {
    agentConnected: false,
    payments: structuredClone(sampleData.payments),
    pending: structuredClone(sampleData.pending),
    usedApprovalSignatures: [],
  };
}

function writeStore(store) {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(temporary, path);
}

async function withLock(fn) {
  mkdirSync(dirname(storePath()), { recursive: true });
  const lock = lockPath();
  const started = Date.now();
  for (;;) {
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 5_000) unlinkSync(lock);
      } catch {
        // Another process removed or replaced the lock.
      }
      if (Date.now() - started > 8_000) {
        throw new Error('Timed out waiting for the allowance data file.');
      }
      await delay(20);
      continue;
    }
    try {
      return await fn();
    } finally {
      closeSync(fd);
      try { unlinkSync(lock); } catch { /* already released */ }
    }
  }
}

export async function readStore() {
  return withLock(() => {
    try {
      return JSON.parse(readFileSync(storePath(), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const store = freshStore();
      writeStore(store);
      return store;
    }
  });
}

async function updateStore(mutator) {
  return withLock(async () => {
    let store;
    try {
      store = JSON.parse(readFileSync(storePath(), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      store = freshStore();
    }
    const result = await mutator(store);
    writeStore(store);
    return result === undefined ? store : result;
  });
}

function newId(prefix) {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

const AUDIT_CAP = 200;
const AUDIT_OUTCOMES = new Set(['allowed', 'blocked', 'ledger-approved']);

function pushAudit(store, input) {
  const outcome = input.outcome;
  if (!AUDIT_OUTCOMES.has(outcome)) throw new Error(`Unknown audit outcome: ${outcome}`);
  store.audit ??= [];
  const paymentId = input.paymentId ?? null;
  if (paymentId && store.audit.some((row) => row.paymentId === paymentId && row.outcome === outcome)) {
    return store.audit.find((row) => row.paymentId === paymentId && row.outcome === outcome);
  }
  const row = {
    id: newId('audit'),
    at: new Date().toISOString(),
    outcome,
    rule: String(input.rule || 'decision').slice(0, 80),
    reason: String(input.reason || '').slice(0, 500),
    signer: input.signer ? String(input.signer).slice(0, 120) : null,
    amount: input.amount ?? null,
    merchantLabel: input.merchantLabel ? String(input.merchantLabel).slice(0, 80) : null,
    task: input.task ? String(input.task).slice(0, 180) : null,
    paymentId,
  };
  store.audit.unshift(row);
  if (store.audit.length > AUDIT_CAP) store.audit.length = AUDIT_CAP;
  return row;
}

function presentAudit(store) {
  return (store.audit ?? []).map((row) => ({
    id: row.id,
    at: row.at,
    outcome: row.outcome,
    rule: row.rule,
    reason: row.reason,
    signer: row.signer ?? null,
    amount: row.amount ?? null,
    merchantLabel: row.merchantLabel ?? null,
    task: row.task ?? null,
    paymentId: row.paymentId ?? null,
  }));
}

/** A rules decision for the export. Does not create a payment or mark the agent connected. */
export async function recordBlockedDecision(input) {
  return updateStore((store) => pushAudit(store, {
    outcome: 'blocked',
    rule: input.rule,
    reason: input.reason,
    signer: null,
    amount: input.amount ?? null,
    merchantLabel: input.merchantLabel ?? null,
    task: input.task ?? null,
    paymentId: null,
  }));
}

/** Drop the demo rows the first time the agent records a real decision. */
function activateAgent(store) {
  if (store.agentConnected) return;
  store.agentConnected = true;
  store.payments = store.payments.filter((item) => !item.sample);
  store.pending = store.pending.filter((item) => !item.sample);
}

function presentPlan(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.source !== 'bedrock' && value.source !== 'fallback') return null;
  const reason = typeof value.reason === 'string' ? value.reason.trim().slice(0, 500) : '';
  if (!reason) return null;
  const resourceId = typeof value.resourceId === 'string' && value.resourceId.trim()
    ? value.resourceId.trim().slice(0, 80)
    : null;
  return {
    source: value.source,
    resourceId,
    reason,
    fallback: value.source === 'fallback',
  };
}

function presentJev(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    source: value.source ?? null,
    needed: value.needed ?? null,
    risk: value.risk ?? null,
    review: value.review ?? null,
    confidence: value.confidence ?? null,
    reason: value.reason ?? null,
  };
}

function presentPayment(payment) {
  const explorerUrl = !payment.sample && payment.txHash
    ? `${network.explorerUrl}/tx/${payment.txHash}`
    : null;
  return {
    id: payment.id,
    txHash: payment.txHash ?? null,
    merchant: payment.merchant,
    merchantLabel: payment.merchantLabel ?? null,
    amount: payment.amount,
    status: payment.status,
    task: payment.task,
    createdAt: payment.createdAt,
    sample: Boolean(payment.sample),
    explorerUrl,
    reason: payment.reason ?? null,
    note: payment.note ?? null,
    channelId: payment.channelId ?? null,
    claimId: payment.claimId ?? null,
    payoutTx: payment.payoutTx ?? null,
    receiptUrl: payment.receiptUrl ?? null,
    settlementStatus: payment.payoutTx ? 'settled' : (payment.status === 'paid' ? 'processing' : null),
    resourceUrl: payment.resourceUrl ?? null,
    approver: payment.approver ?? null,
    jev: presentJev(payment.jev),
    plan: presentPlan(payment.plan),
    simulatedLedger: Boolean(payment.simulatedLedger),
  };
}

function presentPending(item) {
  return {
    id: item.id,
    status: item.status || 'pending',
    task: item.task,
    merchant: item.merchant,
    merchantLabel: item.merchantLabel ?? null,
    amount: item.amount,
    reason: item.reason,
    description: item.description ?? '',
    resourceUrl: item.resourceUrl ?? null,
    createdAt: item.createdAt,
    sample: Boolean(item.sample),
    jev: presentJev(item.jev),
    plan: presentPlan(item.plan),
    declineOnly: Boolean(declineReason(item.merchant)),
    declineReason: declineReason(item.merchant),
    paymentPhase: item.paymentPhase ?? null,
  };
}

/**
 * Real data replaces the samples. A decision the agent recorded sets
 * agentConnected, but a real row can also arrive another way (a decline, a
 * Ledger approval, an imported store), so any non-sample row counts too.
 */
export function hasRealData(store) {
  if (store.agentConnected) return true;
  const real = (rows) => (rows ?? []).some((item) => item && !item.sample);
  return real(store.payments) || real(store.pending);
}

function liveRows(store, rows) {
  if (!hasRealData(store)) return rows;
  return rows.filter((item) => !item.sample);
}

export function summarize(store, rules = loadRules()) {
  const spent = liveRows(store, store.payments)
    .filter((payment) => payment.status === 'paid')
    .reduce((sum, payment) => sum + toUnits(payment.amount), 0n);
  const remaining = rules.budget > spent ? rules.budget - spent : 0n;
  const spentRatio = rules.budget === 0n ? 0 : Number((spent * 10_000n) / rules.budget) / 10_000;
  return {
    budget: formatRlusd(rules.budget),
    spent: formatRlusd(spent),
    remaining: formatRlusd(remaining),
    spentRatio,
    currency: 'RLUSD',
    agentConnected: hasRealData(store),
    frozen: Boolean(store.frozen),
    frozenAt: store.frozenAt ?? null,
    channelClosed: Boolean(store.channelClosed),
    freezeDetail: typeof store.freezeDetail === 'string' ? store.freezeDetail : null,
    mandate: presentMandate(store.mandate),
    anchor: presentAnchor(store.anchor),
    useCase: presentUseCase(store.useCase),
    audit: presentAudit(store),
    rules: presentRules(rules),
    network: {
      name: network.name,
      chainId: network.chainId,
      explorerUrl: network.explorerUrl,
      currency: network.currency,
    },
  };
}

function paidUnits(store) {
  return (store.payments ?? [])
    .filter((payment) => payment.status === 'paid' && !payment.sample)
    .reduce((sum, payment) => sum + toUnits(payment.amount), 0n);
}

function reservedUnits(store) {
  return (store.reservations ?? [])
    .reduce((sum, row) => sum + toUnits(row.amount), 0n);
}

/** RLUSD already paid, plus amounts reserved for a payment still in flight. */
export async function spentRlusd() {
  const store = await readStore();
  return formatRlusd(paidUnits(store) + reservedUnits(store));
}

/**
 * Hold this amount inside the store lock before a payment starts.
 * The returned spent figure does not include this hold, so the budget check
 * adds the price once. Another payer sees the hold.
 */
export async function reserveSpend(amount) {
  const price = toUnits(amount);
  return updateStore((store) => {
    const rules = loadRules();
    const spent = paidUnits(store) + reservedUnits(store);
    if (store.frozen) {
      return { ok: false, reason: 'agent frozen', spent: formatRlusd(spent) };
    }
    if (spent + price > rules.budget) {
      return { ok: false, reason: 'over budget', spent: formatRlusd(spent) };
    }
    const id = newId('rsv');
    store.reservations ??= [];
    store.reservations.push({
      id,
      purchaseId: null,
      amount: formatRlusd(price),
      createdAt: new Date().toISOString(),
    });
    return { ok: true, id, spent: formatRlusd(spent) };
  });
}

export async function releaseReservation(id) {
  if (!id) return { ok: true };
  return updateStore((store) => {
    store.reservations = (store.reservations ?? []).filter((row) => row.id !== id);
    return { ok: true };
  });
}

function dropReservation(store, { id = '', purchaseId = '' } = {}) {
  store.reservations = (store.reservations ?? []).filter((row) => row.id !== id && row.purchaseId !== purchaseId);
}

export async function listPayments() {
  const store = await readStore();
  return liveRows(store, store.payments).map(presentPayment);
}

export async function listPending() {
  const store = await readStore();
  return liveRows(store, store.pending)
    .filter((item) => item.status === 'pending' || item.status === 'paying')
    .map(presentPending);
}

export async function listAudit() {
  const store = await readStore();
  return presentAudit(store);
}

export async function readFrozen() {
  const store = await readStore();
  return { frozen: Boolean(store.frozen), frozenAt: store.frozenAt ?? null };
}

/** Instant kill switch. Frozen refuses new payments. Unfreeze lets the rules decide again. */
export async function setFreeze(frozen) {
  const on = Boolean(frozen);
  return updateStore((store) => {
    store.frozen = on;
    store.frozenAt = on ? new Date().toISOString() : null;
    pushAudit(store, {
      outcome: on ? 'blocked' : 'allowed',
      rule: on ? 'freeze' : 'unfreeze',
      reason: plainReason(on ? 'freeze' : 'unfreeze'),
      signer: 'person',
      amount: null,
      merchantLabel: null,
      task: null,
      paymentId: null,
    });
    return { frozen: store.frozen, frozenAt: store.frozenAt };
  });
}

function presentMandate(mandate) {
  if (!mandate?.signature || !mandate.message) return { signed: false };
  return {
    signed: true,
    agent: mandate.message.agent ?? null,
    budget: mandate.message.budget ?? null,
    cap: mandate.message.cap ?? null,
    expiry: mandate.message.expiry ?? null,
    merchants: mandate.message.merchants ?? null,
    validUntil: mandate.message.validUntil ?? null,
    approver: mandate.approver ?? null,
  };
}

function presentAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') return null;
  const txHash = /^0x[0-9a-fA-F]{64}$/.test(anchor.txHash ?? '') ? anchor.txHash : null;
  return {
    anchored: Boolean(anchor.anchored && txHash),
    hash: typeof anchor.hash === 'string' ? anchor.hash : null,
    txHash,
    reason: typeof anchor.reason === 'string' ? anchor.reason : null,
  };
}

export async function readMandate() {
  const store = await readStore();
  if (!store.mandate?.signature || !store.mandate.message) return null;
  return store.mandate;
}

export async function saveMandate({ message, signature, approver, header }) {
  return updateStore((store) => {
    store.mandate = {
      message,
      signature,
      approver,
      header,
      signedAt: new Date().toISOString(),
    };
    return presentMandate(store.mandate);
  });
}

export async function readAnchor() {
  const store = await readStore();
  return presentAnchor(store.anchor);
}

export async function saveAnchor(anchor) {
  return updateStore((store) => {
    store.anchor = {
      anchored: Boolean(anchor.anchored),
      hash: anchor.hash ?? null,
      txHash: anchor.txHash ?? null,
      reason: anchor.reason ?? null,
      at: new Date().toISOString(),
    };
    return presentAnchor(store.anchor);
  });
}

/** What the freeze did to the payment channel. Unfreeze does not reopen it. */
export async function noteChannelClose({ closed, detail }) {
  return updateStore((store) => {
    store.channelClosed = Boolean(closed);
    store.freezeDetail = typeof detail === 'string' ? detail.slice(0, 240) : null;
    return { channelClosed: store.channelClosed, freezeDetail: store.freezeDetail };
  });
}

/** Remember which job this allowance is demonstrating. The rules file stays as it is. */
export async function setUseCase(id) {
  if (!useCaseById(id)) return { error: 'unknown' };
  return updateStore((store) => {
    store.useCase = id;
    return { useCase: presentUseCase(id) };
  });
}

export async function recordAgentPayment(input) {
  const amount = formatRlusd(toUnits(input.amount));
  const merchant = canonicalAddress(input.merchant);
  if (!input.txHash || !/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
    throw new Error('A paid purchase needs a transaction hash.');
  }
  return updateStore((store) => {
    activateAgent(store);
    if (input.reservationId) dropReservation(store, { id: input.reservationId, purchaseId: input.purchaseId });
    const existing = store.payments.find((row) => !row.sample && row.txHash?.toLowerCase() === input.txHash.toLowerCase());
    if (existing) {
      if (existing.merchant !== merchant || existing.amount !== amount || (input.channelId && existing.channelId && input.channelId !== existing.channelId)) {
        throw new Error('Conflicting details for an already-recorded payment.');
      }
      for (const field of ['channelId', 'claimId', 'receiptUrl', 'payoutTx', 'resourceUrl']) {
        if (input[field] != null) existing[field] = input[field];
      }
      if (input.jev != null) existing.jev = presentJev(input.jev);
      if (input.note != null) existing.note = input.note;
      if (input.approver != null) existing.approver = input.approver;
      if (input.plan != null) existing.plan = presentPlan(input.plan);
      return existing;
    }
    const payment = {
      id: newId('pay'),
      sample: false,
      status: 'paid',
      task: String(input.task ?? ''),
      merchant,
      merchantLabel: input.merchantLabel ?? null,
      amount,
      txHash: input.txHash,
      explorerUrl: `${network.explorerUrl}/tx/${input.txHash}`,
      resourceUrl: input.resourceUrl ?? null,
      receiptUrl: input.receiptUrl ?? null,
      claimId: input.claimId ?? null,
      channelId: input.channelId ?? null,
      payoutTx: input.payoutTx ?? null,
      note: input.note ?? null,
      approver: input.approver ?? null,
      jev: presentJev(input.jev),
      plan: presentPlan(input.plan),
      createdAt: new Date().toISOString(),
    };
    store.payments.unshift(payment);
    pushAudit(store, {
      outcome: input.approver ? 'ledger-approved' : 'allowed',
      rule: input.rule || (input.approver ? 'ledger approved' : 'within allowance'),
      reason: input.note || plainReason(input.approver ? 'ledger approved' : 'within allowance'),
      signer: input.approver || 'agent',
      amount,
      merchantLabel: input.merchantLabel ?? null,
      task: payment.task,
      paymentId: payment.id,
    });
    return payment;
  });
}

/**
 * A rules-allowed purchase recorded when this process did not broadcast a voucher.
 * There is no transaction hash, so the dashboard does not link an explorer.
 */
export async function recordUnbroadcastPayment(input) {
  const amount = formatRlusd(toUnits(input.amount));
  const merchant = canonicalAddress(input.merchant);
  return updateStore((store) => {
    activateAgent(store);
    const payment = {
      id: newId('pay'),
      sample: false,
      status: 'paid',
      task: String(input.task ?? ''),
      merchant,
      merchantLabel: input.merchantLabel ?? null,
      amount,
      txHash: null,
      resourceUrl: input.resourceUrl ?? null,
      receiptUrl: null,
      claimId: null,
      channelId: null,
      payoutTx: null,
      note: input.note ?? null,
      approver: input.approver ?? null,
      jev: presentJev(input.jev),
      plan: presentPlan(input.plan),
      simulatedLedger: Boolean(input.simulatedLedger),
      createdAt: new Date().toISOString(),
    };
    store.payments.unshift(payment);
    pushAudit(store, {
      outcome: input.approver || input.simulatedLedger ? 'ledger-approved' : 'allowed',
      rule: input.simulatedLedger ? 'simulated Ledger signature' : (input.approver ? 'ledger approved' : 'within allowance'),
      reason: input.note || (input.simulatedLedger
        ? 'Backup demo only. simulated Ledger signature. Nothing was broadcast.'
        : plainReason('within allowance')),
      signer: input.approver || (input.simulatedLedger ? 'simulated Ledger' : 'agent'),
      amount,
      merchantLabel: input.merchantLabel ?? null,
      task: payment.task,
      paymentId: payment.id,
    });
    return payment;
  });
}

export async function recordPending(input) {
  const amount = formatRlusd(toUnits(input.amount));
  const merchant = canonicalAddress(input.merchant);
  return updateStore((store) => {
    activateAgent(store);
    const pending = {
      id: newId('pend'),
      sample: false,
      status: 'pending',
      task: String(input.task ?? ''),
      merchant,
      merchantLabel: input.merchantLabel ?? null,
      amount,
      reason: String(input.reason ?? 'needs approval'),
      description: String(input.description ?? ''),
      resourceUrl: input.resourceUrl ?? null,
      jev: presentJev(input.jev),
      plan: presentPlan(input.plan),
      createdAt: new Date().toISOString(),
    };
    store.pending.unshift(pending);
    const known = plainReason(pending.reason);
    pushAudit(store, {
      outcome: 'blocked',
      rule: known === pending.reason && pending.reason.length > 40 ? 'needs approval' : pending.reason,
      reason: pending.description || known,
      signer: null,
      amount,
      merchantLabel: input.merchantLabel ?? null,
      task: pending.task,
      paymentId: pending.id,
    });
    return pending;
  });
}

const PENDING_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAYMENT_LOCK_MS = 180_000;

function validPendingId(id) {
  return PENDING_ID.test(id ?? '');
}

export async function readPendingRecord(id) {
  if (!validPendingId(id)) return { error: 'invalid' };
  const store = await readStore();
  const item = (store.pending ?? []).find((row) => row.id === id);
  if (!item) return { missing: true };
  return { pending: item };
}

export async function readUsedApprovalSignatures() {
  const store = await readStore();
  return Array.isArray(store.usedApprovalSignatures) ? store.usedApprovalSignatures : [];
}

/** Remember the expiry the device is asked to sign. Replaces an older challenge. */
export async function saveApprovalChallenge(id, challenge, nowMs = Date.now()) {
  if (!validPendingId(id)) return { error: 'invalid' };
  return updateStore((store) => {
    const item = store.pending.find((row) => row.id === id);
    if (!item || item.sample) return { missing: true };
    if (item.status !== 'pending' && item.status !== 'paying') return { missing: true };
    if (item.status === 'paying' && nowMs - Date.parse(item.paymentStartedAt || 0) < PAYMENT_LOCK_MS) {
      return { error: 'in_progress' };
    }
    item.status = 'pending';
    delete item.paymentStartedAt;
    item.approvalChallenge = { expiry: challenge.expiry, issuedAt: challenge.issuedAt };
    return { pending: structuredClone(item) };
  });
}

/**
 * Mark this signature used and take the quote for payment.
 * A second use of the same signature is a replay, even if payment later fails.
 */
export async function claimApprovalSignature(id, signature, nowMs = Date.now(), options = {}) {
  if (!validPendingId(id)) return { error: 'invalid' };
  const sig = String(signature ?? '').toLowerCase();
  return updateStore((store) => {
    store.usedApprovalSignatures ??= [];
    const item = store.pending.find((row) => row.id === id && !row.sample);
    if (!item || (item.status !== 'pending' && item.status !== 'paying')) return { missing: true };
    if (item.status === 'paying' && nowMs - Date.parse(item.paymentStartedAt || 0) < PAYMENT_LOCK_MS) {
      return { inFlight: true, phase: item.paymentPhase || 'broadcasting' };
    }
    if (store.usedApprovalSignatures.some((row) => String(row).toLowerCase() === sig)) {
      return { error: 'replay' };
    }
    const rules = loadRules();
    const price = toUnits(options.amount ?? item.amount);
    const spent = paidUnits(store) + reservedUnits(store);
    if (spent + price > rules.budget) return { error: 'over_budget', spent: formatRlusd(spent) };
    const reservationId = newId('rsv');
    store.reservations ??= [];
    store.reservations.push({
      id: reservationId,
      purchaseId: id,
      amount: formatRlusd(price),
      createdAt: new Date(nowMs).toISOString(),
    });
    store.usedApprovalSignatures.push(sig);
    item.status = 'paying';
    item.paymentStartedAt = new Date(nowMs).toISOString();
    item.paymentPhase = 'signed';
    item.approvalSignature = sig;
    item.reservationId = reservationId;
    return { ok: true, reservationId, spent: formatRlusd(spent), phase: 'signed' };
  });
}

export async function setPaymentPhase(id, phase) {
  if (!validPendingId(id)) return { error: 'invalid' };
  return updateStore((store) => {
    const item = store.pending.find((row) => row.id === id);
    if (!item) return { missing: true };
    item.paymentPhase = phase;
    return { phase };
  });
}

const LIVE_STAGES = new Set(['agent', 'rules', 'xrpl']);

/**
 * Where the agent's current purchase is, for the live payment path. The agent
 * runs in its own process, so this goes through the store file. Pass null to
 * clear it. It never decides anything; the activity row that follows does.
 */
export async function setLiveStage(input) {
  return updateStore((store) => {
    if (!input || !LIVE_STAGES.has(input.stage)) {
      delete store.live;
      return { live: null };
    }
    store.live = {
      stage: input.stage,
      task: typeof input.task === 'string' ? input.task.slice(0, 200) : null,
      amount: input.amount ?? null,
      merchantLabel: input.merchantLabel ?? null,
      at: new Date(input.nowMs ?? Date.now()).toISOString(),
    };
    return { live: store.live };
  });
}

/** A choice that signed nothing, so the dashboard can show why. */
export async function recordSkipped(input) {
  return updateStore((store) => {
    activateAgent(store);
    const row = {
      id: newId('skip'),
      sample: false,
      status: 'skipped',
      task: String(input.task ?? ''),
      merchant: input.merchant ?? '',
      merchantLabel: input.merchantLabel ?? 'No purchase',
      amount: input.amount ?? '0',
      reason: String(input.reason ?? 'Nothing was signed.'),
      note: input.note ?? null,
      plan: presentPlan(input.plan),
      txHash: null,
      createdAt: new Date().toISOString(),
    };
    store.payments.unshift(row);
    pushAudit(store, {
      outcome: 'blocked',
      rule: 'nothing signed',
      reason: row.reason,
      signer: null,
      amount: row.amount,
      merchantLabel: row.merchantLabel,
      task: row.task,
      paymentId: row.id,
    });
    return presentPayment(row);
  });
}

/**
 * Return a quote to Needs you after a broadcast that did not land.
 * The used signature stays used. The old challenge is dropped so the next
 * one is a new message.
 */
export async function releaseApprovalPayment(id) {
  if (!validPendingId(id)) return { error: 'invalid' };
  return updateStore((store) => {
    const item = store.pending.find((row) => row.id === id);
    if (!item) return { missing: true };
    item.status = 'pending';
    delete item.paymentStartedAt;
    delete item.paymentPhase;
    dropReservation(store, { id: item.reservationId, purchaseId: id });
    delete item.reservationId;
    if (item.approvalChallenge?.expiry) item.lastChallengeExpiry = item.approvalChallenge.expiry;
    delete item.approvalChallenge;
    delete item.approvalSignature;
    return { ok: true };
  });
}

/** Drop the quote once its payment is on the ledger. The signature stays used. */
export async function completeApprovedPurchase(id) {
  if (!validPendingId(id)) return { error: 'invalid' };
  return updateStore((store) => {
    dropReservation(store, { purchaseId: id });
    const index = store.pending.findIndex((row) => row.id === id);
    if (index !== -1) store.pending.splice(index, 1);
    return { ok: true };
  });
}

/** Record a decline. Nothing is signed or paid. */
export async function declinePending(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return { error: 'invalid' };
  }
  return updateStore((store) => {
    const index = store.pending.findIndex((item) => item.id === id && item.status === 'pending');
    if (index === -1) return { missing: true };
    const [item] = store.pending.splice(index, 1);
    const declined = {
      ...item,
      status: 'declined',
      txHash: null,
      declinedAt: new Date().toISOString(),
      note: 'Declined. Nothing was signed or paid.',
    };
    store.payments.unshift(declined);
    pushAudit(store, {
      outcome: 'blocked',
      rule: item.reason || 'declined',
      reason: 'Declined. Nothing was signed or paid.',
      signer: null,
      amount: item.amount ?? null,
      merchantLabel: item.merchantLabel ?? null,
      task: item.task ?? null,
      paymentId: declined.id,
    });
    return { declined: presentPayment(declined) };
  });
}

export async function readAllowanceChange() {
  const store = await readStore();
  return store.allowanceChange ?? null;
}

/** Remember the SetAllowance message the device is asked to sign. */
export async function saveAllowanceChallenge(proposal, challenge) {
  return updateStore((store) => {
    const previous = Number(store.allowanceChange?.approvalChallenge?.expiry ?? store.allowanceChange?.lastChallengeExpiry);
    store.allowanceChange = {
      proposal,
      approvalChallenge: { expiry: challenge.expiry, issuedAt: challenge.issuedAt },
      lastChallengeExpiry: Number.isFinite(previous) ? previous : null,
    };
    return { change: structuredClone(store.allowanceChange) };
  });
}

export async function claimAllowanceSignature(signature, nowMs = Date.now()) {
  const sig = String(signature ?? '').toLowerCase();
  return updateStore((store) => {
    store.usedApprovalSignatures ??= [];
    const change = store.allowanceChange;
    if (!change?.proposal || !change.approvalChallenge) return { missing: true };
    if (change.status === 'applying' && nowMs - Date.parse(change.startedAt || 0) < PAYMENT_LOCK_MS) {
      return { error: 'in_progress' };
    }
    if (store.usedApprovalSignatures.some((row) => String(row).toLowerCase() === sig)) {
      return { error: 'replay' };
    }
    store.usedApprovalSignatures.push(sig);
    change.status = 'applying';
    change.startedAt = new Date(nowMs).toISOString();
    change.approvalSignature = sig;
    return { ok: true, proposal: structuredClone(change.proposal) };
  });
}

export async function releaseAllowanceChange() {
  return updateStore((store) => {
    const change = store.allowanceChange;
    if (!change) return { missing: true };
    if (change.approvalChallenge?.expiry) change.lastChallengeExpiry = change.approvalChallenge.expiry;
    delete change.approvalChallenge;
    delete change.approvalSignature;
    delete change.status;
    delete change.startedAt;
    return { ok: true };
  });
}

export async function completeAllowanceChange() {
  return updateStore((store) => {
    delete store.allowanceChange;
    return { ok: true };
  });
}

/** Attach a settlement payout hash after the redemption is already recorded. */
export async function attachPayout(id, payoutTx) {
  if (!id || !/^0x[0-9a-fA-F]{64}$/.test(payoutTx ?? '')) return null;
  return updateStore((store) => {
    const payment = store.payments.find((item) => item.id === id);
    if (!payment) return null;
    payment.payoutTx = payoutTx;
    return presentPayment(payment);
  });
}
