import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { ethers } from 'ethers';

const dir = mkdtempSync(join(tmpdir(), 'fail-closed-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
process.env.AGENT_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
process.env.TEAM_NAME = 'Fail Closed';
process.env.APPROVER_ADDRESS = '';

const { createApp } = await import('./index.js');
const { loadRules } = await import('../agent/rules.js');
const { recordAgentPayment, recordPending, spentRlusd } = await import('./store.js');
const { signApprovalForTest } = await import('./dev-signer.js');

const merchant = loadRules().allowedMerchants[0];
const approver = ethers.Wallet.createRandom();
process.env.APPROVER_ADDRESS = approver.address;

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function hold(amount = '8') {
  return recordPending({
    task: 'Buy the extended market history',
    merchant,
    merchantLabel: 'Field Weather Co',
    amount,
    reason: 'over per-purchase cap',
    resourceUrl: 'http://127.0.0.1:4318/resource',
  });
}

describe('fail closed', { concurrency: false }, () => {
test('a channel that cannot be read or cannot cover the quote is not paid', async () => {
  process.env.ALLOWANCE_STORE = join(dir, 'unread.json');
  let paid = 0;
  const unread = await listen(createApp({
    channelState: async () => { throw new Error('rpc down'); },
    payApproved: async () => { paid += 1; },
  }));
  try {
    const pending = await hold();
    const blocked = await post(`http://127.0.0.1:${unread.address().port}`, `/api/approve/${pending.id}/challenge`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'channel_unread');
    assert.match(blocked.body.message, /Nothing was paid/);
    assert.equal(paid, 0);
  } finally {
    await close(unread);
  }

  const short = await listen(createApp({
    channelState: async () => ({ cap: '5', redeemed: '0' }),
    payApproved: async () => { paid += 1; },
  }));
  try {
    const pending = await hold();
    const blocked = await post(`http://127.0.0.1:${short.address().port}`, `/api/approve/${pending.id}/challenge`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'channel_short');
    assert.match(blocked.body.message, /5 RLUSD left/);
    assert.match(blocked.body.message, /quote is 8 RLUSD/);
    assert.match(blocked.body.message, /Nothing was signed/);
    assert.equal(paid, 0);
  } finally {
    await close(short);
  }

  const over = await listen(createApp({
    channelState: async () => ({ cap: '30', redeemed: '21' }),
    payApproved: async () => { paid += 1; },
  }));
  try {
    const pending = await hold('1');
    const blocked = await post(`http://127.0.0.1:${over.address().port}`, `/api/approve/${pending.id}/challenge`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'chain_over_budget');
    assert.match(blocked.body.message, /Nothing was paid/);
    assert.equal(paid, 0);
  } finally {
    await close(over);
  }
});

test('a signature is not paid when the channel read fails after the challenge, and spend uses the higher figure', async () => {
  process.env.ALLOWANCE_STORE = join(dir, 'basis.json');
  let reads = 0;
  let seen = '';
  let paid = 0;
  await recordAgentPayment({
    task: 'Morning brief',
    merchant,
    amount: '1',
    txHash: `0x${'11'.repeat(32)}`,
  });
  const pending = await hold();
  const server = await listen(createApp({
    channelState: async () => {
      reads += 1;
      if (reads > 1) throw new Error('rpc down');
      return { cap: '20', redeemed: '4' };
    },
    payApproved: async (quote) => {
      paid += 1;
      seen = quote.spentBasis;
      return recordAgentPayment({
        task: quote.task,
        merchant: quote.merchant,
        amount: quote.amount,
        txHash: `0x${'22'.repeat(32)}`,
      });
    },
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const challenge = await post(base, `/api/approve/${pending.id}/challenge`);
    assert.equal(challenge.status, 200);
    const signed = await signApprovalForTest(challenge.body.typedData, approver.privateKey);
    const failed = await post(base, `/api/approve/${pending.id}`, {
      signature: signed.signature,
      message: challenge.body.typedData.message,
    });
    assert.equal(failed.status, 409);
    assert.equal(failed.body.error, 'channel_unread');
    assert.equal(paid, 0);
  } finally {
    await close(server);
  }

  reads = 0;
  const covered = await listen(createApp({
    channelState: async () => ({ cap: '20', redeemed: '4' }),
    payApproved: async (quote) => {
      paid += 1;
      seen = quote.spentBasis;
      return recordAgentPayment({
        task: quote.task,
        merchant: quote.merchant,
        amount: quote.amount,
        txHash: `0x${'33'.repeat(32)}`,
      });
    },
  }));
  try {
    const next = await hold();
    const base = `http://127.0.0.1:${covered.address().port}`;
    const challenge = await post(base, `/api/approve/${next.id}/challenge`);
    const signed = await signApprovalForTest(challenge.body.typedData, approver.privateKey);
    const ok = await post(base, `/api/approve/${next.id}`, {
      signature: signed.signature,
      message: challenge.body.typedData.message,
    });
    assert.equal(ok.status, 200);
    assert.equal(seen, '4');
    assert.equal(paid, 1);
  } finally {
    await close(covered);
  }
});

test('a second approval while one is paying returns that attempt', async () => {
  process.env.ALLOWANCE_STORE = join(dir, 'flight.json');
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const startedGate = new Promise((resolve) => { started = resolve; });
  const pending = await hold();
  const server = await listen(createApp({
    channelState: async () => ({ cap: '20', redeemed: '0' }),
    payApproved: async (quote) => {
      calls += 1;
      started();
      await gate;
      return recordAgentPayment({
        task: quote.task,
        merchant: quote.merchant,
        amount: quote.amount,
        txHash: `0x${'44'.repeat(32)}`,
      });
    },
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const challenge = await post(base, `/api/approve/${pending.id}/challenge`);
    assert.equal(challenge.status, 200);
    const signed = await signApprovalForTest(challenge.body.typedData, approver.privateKey);
    const payload = { signature: signed.signature, message: challenge.body.typedData.message };
    const first = post(base, `/api/approve/${pending.id}`, payload);
    await startedGate;
    const second = await post(base, `/api/approve/${pending.id}`, payload);
    assert.equal(second.status, 202);
    assert.equal(second.body.inFlight, true);
    assert.equal(calls, 1);
    assert.equal(await spentRlusd(), '8');
    const progress = await fetch(`${base}/api/approve/${pending.id}/progress`);
    assert.equal(progress.status, 200);
    const body = await progress.json();
    assert.equal(body.inFlight, true);
    release();
    const done = await first;
    assert.equal(done.status, 200);
    assert.equal(calls, 1);
  } finally {
    release();
    await close(server);
    rmSync(dir, { recursive: true, force: true });
  }
});
});
