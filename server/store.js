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
import { canonicalAddress, formatRlusd, loadRules, presentRules, toUnits } from '../agent/rules.js';

const defaultStorePath = join(dirname(fileURLToPath(import.meta.url)), 'data', 'store.json');

function storePath() {
  return process.env.ALLOWANCE_STORE || defaultStorePath;
}

function lockPath() {
  return `${storePath()}.lock`;
}

function freshStore() {
  return {
    agentConnected: false,
    payments: structuredClone(sampleData.payments),
    pending: structuredClone(sampleData.pending),
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

/** Drop the demo rows the first time the agent records a real decision. */
function activateAgent(store) {
  if (store.agentConnected) return;
  store.agentConnected = true;
  store.payments = store.payments.filter((item) => !item.sample);
  store.pending = store.pending.filter((item) => !item.sample);
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
    resourceUrl: payment.resourceUrl ?? null,
    jev: presentJev(payment.jev),
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
  };
}

function liveRows(store, rows) {
  if (!store.agentConnected) return rows;
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
    agentConnected: Boolean(store.agentConnected),
    rules: presentRules(rules),
    network: {
      name: network.name,
      chainId: network.chainId,
      explorerUrl: network.explorerUrl,
      currency: network.currency,
    },
  };
}

/** RLUSD already paid by the agent. Sample rows are a preview and are not spent. */
export async function spentRlusd() {
  const store = await readStore();
  const spent = store.payments
    .filter((payment) => payment.status === 'paid' && !payment.sample)
    .reduce((sum, payment) => sum + toUnits(payment.amount), 0n);
  return formatRlusd(spent);
}

export async function listPayments() {
  const store = await readStore();
  return liveRows(store, store.payments).map(presentPayment);
}

export async function listPending() {
  const store = await readStore();
  return liveRows(store, store.pending)
    .filter((item) => item.status === 'pending')
    .map(presentPending);
}

export async function recordAgentPayment(input) {
  const amount = formatRlusd(toUnits(input.amount));
  const merchant = canonicalAddress(input.merchant);
  if (!input.txHash || !/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
    throw new Error('A paid purchase needs a transaction hash.');
  }
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
      txHash: input.txHash,
      explorerUrl: `${network.explorerUrl}/tx/${input.txHash}`,
      resourceUrl: input.resourceUrl ?? null,
      receiptUrl: input.receiptUrl ?? null,
      claimId: input.claimId ?? null,
      channelId: input.channelId ?? null,
      payoutTx: input.payoutTx ?? null,
      jev: presentJev(input.jev),
      createdAt: new Date().toISOString(),
    };
    store.payments.unshift(payment);
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
      createdAt: new Date().toISOString(),
    };
    store.pending.unshift(pending);
    return pending;
  });
}

/**
 * Placeholder for a Ledger approval. Records the person's decision and does
 * not sign a voucher or send RLUSD.
 */
export async function approvePending(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return { error: 'invalid' };
  }
  return updateStore((store) => {
    const index = store.pending.findIndex((item) => item.id === id && item.status === 'pending');
    if (index === -1) return { missing: true };
    const [item] = store.pending.splice(index, 1);
    const approved = {
      ...item,
      status: 'approved',
      txHash: null,
      approvedAt: new Date().toISOString(),
      note: 'Placeholder for Ledger approval. Nothing was signed or paid.',
    };
    store.payments.unshift(approved);
    return { approved: presentPayment(approved) };
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
    return { declined: presentPayment(declined) };
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
