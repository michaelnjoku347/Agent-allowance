import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { ethers } from 'ethers';
import { describeLedgerError, webHidSupported } from '../shared/ledger-device.js';

const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
process.env.APPROVER_ADDRESS = '';

const { createApp } = await import('./index.js');
const { recordAgentPayment, recordPending, listPayments, listPending, spentRlusd } = await import('./store.js');
const { signApprovalForTest } = await import('./dev-signer.js');
const { payExactQuote } = await import('../agent/agent.js');
const { loadRules } = await import('../agent/rules.js');

const rules = loadRules();
const allowed = rules.allowedMerchants[0];
const other = rules.allowedMerchants[1];

function resetStore() {
  rmSync(process.env.ALLOWANCE_STORE, { force: true });
}

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

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.js') || path.endsWith('.jsx') ? [path] : [];
  });
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, body: payload };
}

describe('Ledger approval', { concurrency: false }, () => {
  test('a valid signature pays once, a replay does not, and a failed payment cannot be reused', async () => {
    resetStore();
    const approver = ethers.Wallet.createRandom();
    process.env.APPROVER_ADDRESS = approver.address;
    const pending = await recordPending({
      task: 'Buy the extended market history',
      merchant: allowed,
      merchantLabel: 'Field Weather Co',
      amount: '8',
      reason: 'over per-purchase cap',
      resourceUrl: 'http://127.0.0.1:4308/demo/over-cap',
    });
    let calls = 0;
    const paidHash = `0x${'11'.repeat(32)}`;
    const app = createApp({
      payApproved: async (quote) => {
        calls += 1;
        if (calls === 1) throw new Error('merchant down');
        return recordAgentPayment({
          task: quote.task,
          merchant: quote.merchant,
          merchantLabel: quote.merchantLabel,
          amount: quote.amount,
          txHash: paidHash,
          resourceUrl: quote.resourceUrl,
          approver: quote.approver,
          note: 'Approved on a Ledger. Paid through AP4M x402.',
        });
      },
    });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const challenge = await post(base, `/api/approve/${pending.id}/challenge`);
      assert.equal(challenge.status, 200);
      assert.equal(challenge.body.typedData.primaryType, 'ApprovePurchase');
      assert.equal(challenge.body.typedData.domain.chainId, 1449000);
      assert.equal(challenge.body.typedData.message.amount, '8 RLUSD');
      assert.match(challenge.body.typedData.message.merchant, /Field Weather Co \(0x/);
      assert.match(challenge.body.typedData.message.expiry, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
      assert.equal(challenge.body.display.amount, '8 RLUSD');
      assert.match(challenge.body.display.merchant, /Field Weather Co/);
      assert.equal(challenge.body.approverAddress, approver.address.toLowerCase());

      const signed = await signApprovalForTest(challenge.body.typedData, approver.privateKey);
      const payload = { signature: signed.signature, message: challenge.body.typedData.message };
      const failed = await post(base, `/api/approve/${pending.id}`, payload);
      assert.equal(failed.status, 502);
      assert.match(failed.body.message, /merchant down/);
      assert.equal(calls, 1);
      assert.equal((await listPending()).some((item) => item.id === pending.id), true);

      const replay = await post(base, `/api/approve/${pending.id}`, payload);
      assert.equal(replay.status, 409);
      assert.equal(replay.body.error, 'replay');
      assert.equal(calls, 1);

      const again = await post(base, `/api/approve/${pending.id}/challenge`);
      assert.equal(again.status, 200);
      assert.ok(again.body.typedData.message.expiry > challenge.body.typedData.message.expiry);
      const signedAgain = await signApprovalForTest(again.body.typedData, approver.privateKey);
      assert.notEqual(signedAgain.signature, signed.signature);
      const paid = await post(base, `/api/approve/${pending.id}`, {
        signature: signedAgain.signature,
        message: again.body.typedData.message,
      });
      assert.equal(paid.status, 200);
      assert.equal(paid.body.payment.status, 'paid');
      assert.equal(paid.body.payment.txHash, paidHash);
      assert.equal(paid.body.payment.approver, approver.address.toLowerCase());
      assert.match(paid.body.note, /paid once/i);
      assert.equal(calls, 2);
      assert.equal(await spentRlusd(), '8');
      assert.equal((await listPending()).some((item) => item.id === pending.id), false);

      const third = await post(base, `/api/approve/${pending.id}`, {
        signature: signedAgain.signature,
        message: again.body.typedData.message,
      });
      assert.equal(third.status, 409);
      assert.equal(third.body.error, 'replay');
      assert.equal(calls, 2);
      assert.equal((await listPayments()).length, 1);
    } finally {
      await close(server);
    }
  });

  test('a mismatched amount or merchant is refused and nothing is paid', async () => {
    resetStore();
    const approver = ethers.Wallet.createRandom();
    process.env.APPROVER_ADDRESS = approver.address;
    const pending = await recordPending({
      task: 'Buy the extended market history',
      merchant: allowed,
      merchantLabel: 'Field Weather Co',
      amount: '8',
      reason: 'over per-purchase cap',
      resourceUrl: 'http://127.0.0.1:4308/demo/over-cap',
    });
    let calls = 0;
    const app = createApp({
      payApproved: async () => {
        calls += 1;
        throw new Error('must not pay');
      },
    });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const challenge = await post(base, `/api/approve/${pending.id}/challenge`);
      const wrongAmount = structuredClone(challenge.body.typedData);
      wrongAmount.message = { ...wrongAmount.message, amount: '1' };
      const amountSig = await signApprovalForTest(wrongAmount, approver.privateKey);
      const amount = await post(base, `/api/approve/${pending.id}`, {
        signature: amountSig.signature,
        message: wrongAmount.message,
      });
      assert.equal(amount.status, 400);
      assert.equal(amount.body.error, 'mismatch_amount');

      const wrongMerchant = structuredClone(challenge.body.typedData);
      wrongMerchant.message = { ...wrongMerchant.message, merchant: other };
      const merchantSig = await signApprovalForTest(wrongMerchant, approver.privateKey);
      const merchant = await post(base, `/api/approve/${pending.id}`, {
        signature: merchantSig.signature,
        message: wrongMerchant.message,
      });
      assert.equal(merchant.status, 400);
      assert.equal(merchant.body.error, 'mismatch_merchant');
      assert.equal(calls, 0);
      assert.equal((await listPending()).some((item) => item.id === pending.id), true);
      assert.equal(await spentRlusd(), '0');
    } finally {
      await close(server);
    }
  });

  test('a different signer is refused, and the unlisted desk is decline-only', async () => {
    resetStore();
    const approver = ethers.Wallet.createRandom();
    const stranger = ethers.Wallet.createRandom();
    process.env.APPROVER_ADDRESS = approver.address;
    const unlisted = await recordPending({
      task: 'Buy from an outside desk',
      merchant: '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad',
      merchantLabel: 'Outside',
      amount: '1',
      reason: 'merchant not allowed',
      resourceUrl: 'http://127.0.0.1:4308/demo/unlisted',
    });
    const pending = await recordPending({
      task: 'Buy the extended market history',
      merchant: allowed,
      merchantLabel: 'Field Weather Co',
      amount: '8',
      reason: 'over per-purchase cap',
      resourceUrl: 'http://127.0.0.1:4309/resource',
    });
    let calls = 0;
    const app = createApp({
      payApproved: async () => {
        calls += 1;
        throw new Error('must not pay');
      },
    });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const blocked = await post(base, `/api/approve/${unlisted.id}/challenge`);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.error, 'decline_only');
      const challenge = await post(base, `/api/approve/${pending.id}/challenge`);
      const signed = await signApprovalForTest(challenge.body.typedData, stranger.privateKey);
      const response = await post(base, `/api/approve/${pending.id}`, {
        signature: signed.signature,
        message: challenge.body.typedData.message,
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'wrong_signer');
      assert.equal(calls, 0);
      assert.equal((await listPending()).length, 2);
    } finally {
      await close(server);
    }
  });

  test('an expired approval and a hard rule both stop payment', async () => {
    resetStore();
    const approver = ethers.Wallet.createRandom();
    process.env.APPROVER_ADDRESS = approver.address;
    const pending = await recordPending({
      task: 'Buy the extended market history',
      merchant: allowed,
      amount: '8',
      reason: 'over per-purchase cap',
      resourceUrl: 'http://127.0.0.1:4308/demo/over-cap',
    });
    await recordAgentPayment({
      task: 'Already spent',
      merchant: allowed,
      amount: '16',
      txHash: `0x${'22'.repeat(32)}`,
    });
    const clock = { now: Date.parse('2026-10-24T12:00:00.000Z') };
    let calls = 0;
    const app = createApp({
      now: () => clock.now,
      challengeTtlSeconds: 30,
      payApproved: async () => {
        calls += 1;
        throw new Error('must not pay');
      },
    });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const challenge = await post(base, `/api/approve/${pending.id}/challenge`);
      const signed = await signApprovalForTest(challenge.body.typedData, approver.privateKey);
      const overBudget = await post(base, `/api/approve/${pending.id}`, {
        signature: signed.signature,
        message: challenge.body.typedData.message,
      });
      assert.equal(overBudget.status, 409);
      assert.equal(overBudget.body.error, 'over budget');
      assert.match(overBudget.body.message, /cannot override/i);
      assert.equal(calls, 0);

      clock.now += 31_000;
      const expired = await post(base, `/api/approve/${pending.id}`, {
        signature: signed.signature,
        message: challenge.body.typedData.message,
      });
      assert.equal(expired.status, 409);
      assert.equal(expired.body.error, 'expired');
      assert.equal((await listPending()).some((item) => item.id === pending.id), true);
      assert.equal(await spentRlusd(), '16');
    } finally {
      await close(server);
    }
  });

  test('allowance expiry blocks a valid signature, and the cap does not block the payer', async () => {
    const savedKey = process.env.AGENT_PRIVATE_KEY;
    const savedTeam = process.env.TEAM_NAME;
    delete process.env.AGENT_PRIVATE_KEY;
    delete process.env.TEAM_NAME;
    try {
      await assert.rejects(() => payExactQuote({
        task: 'Too late',
        resourceUrl: 'http://127.0.0.1:4308/resource',
        merchant: allowed,
        amount: '1',
        at: '2027-01-02T00:00:00.000Z',
        purchaseId: 'pend_expired',
      }), (error) => error.code === 'HARD_RULE' && error.reason === 'expired');

      await assert.rejects(() => payExactQuote({
        task: 'Over the cap',
        resourceUrl: 'http://127.0.0.1:4308/resource',
        merchant: allowed,
        amount: '8',
        at: '2026-10-24T00:00:00.000Z',
        purchaseId: 'pend_cap',
      }), (error) => error.code === 'NOT_CONFIGURED');
    } finally {
      if (savedKey === undefined) delete process.env.AGENT_PRIVATE_KEY;
      else process.env.AGENT_PRIVATE_KEY = savedKey;
      if (savedTeam === undefined) delete process.env.TEAM_NAME;
      else process.env.TEAM_NAME = savedTeam;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a raise without a signature is refused, and a SetAllowance signature applies once', async () => {
    const rulesDir = mkdtempSync(join(tmpdir(), 'allowance-rules-'));
    const rulesPath = join(rulesDir, 'rules.json');
    copyFileSync(new URL('../agent/rules.json', import.meta.url), rulesPath);
    const previousRules = process.env.ALLOWANCE_RULES;
    process.env.ALLOWANCE_RULES = rulesPath;
    const approver = ethers.Wallet.createRandom();
    process.env.APPROVER_ADDRESS = approver.address;
    const server = await listen(createApp());
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const bare = await post(base, '/api/allowance', { maxPerPurchase: '8' });
      assert.equal(bare.status, 400);
      assert.match(bare.body.message, /Ledger signature/);
      assert.equal(JSON.parse(readFileSync(rulesPath, 'utf8')).maxPerPurchase, '5');

      const challenge = await post(base, '/api/allowance/challenge', { maxPerPurchase: '8' });
      assert.equal(challenge.status, 200);
      assert.equal(challenge.body.typedData.primaryType, 'SetAllowance');
      assert.equal(challenge.body.typedData.domain.chainId, 1449000);
      assert.equal(challenge.body.typedData.message.cap, '8 RLUSD');
      assert.match(challenge.body.typedData.message.expiry, / UTC$/);
      assert.match(challenge.body.typedData.message.validUntil, / UTC$/);

      const signed = await signApprovalForTest(challenge.body.typedData, approver.privateKey);
      const raised = await post(base, '/api/allowance', {
        signature: signed.signature,
        message: challenge.body.typedData.message,
      });
      assert.equal(raised.status, 200);
      assert.equal(JSON.parse(readFileSync(rulesPath, 'utf8')).maxPerPurchase, '8');
      assert.equal(JSON.parse(readFileSync(rulesPath, 'utf8')).budget, '20');

      const replay = await post(base, '/api/allowance', {
        signature: signed.signature,
        message: challenge.body.typedData.message,
      });
      assert.equal(replay.status, 409);
      assert.equal(replay.body.error, 'replay');

      const lower = await post(base, '/api/allowance/challenge', { maxPerPurchase: '4' });
      assert.equal(lower.status, 400);
      assert.equal(lower.body.error, 'not_a_raise');
    } finally {
      await close(server);
      if (previousRules === undefined) delete process.env.ALLOWANCE_RULES;
      else process.env.ALLOWANCE_RULES = previousRules;
      rmSync(rulesDir, { recursive: true, force: true });
    }
  });

  test('device errors name a locked device, the wrong app, and a rejection', () => {
    assert.equal(describeLedgerError({ _tag: 'DeviceLockedError', errorCode: '5515' }).code, 'locked');
    assert.equal(describeLedgerError({ errorCode: '6e00', message: 'CLA not supported' }).code, 'wrong_app');
    assert.equal(describeLedgerError({ _tag: 'EthAppCommandError', errorCode: '6985', message: 'Condition not satisfied' }).code, 'rejected');
    assert.match(describeLedgerError({ message: 'WebHID is unavailable' }).message, /Chrome/);
    assert.match(
      describeLedgerError({ _tag: 'NoAccessibleDeviceError', originalError: new Error('No selected device') }).message,
      /No Ledger was selected/,
    );
    assert.equal(webHidSupported({}), false);
    const root = join(import.meta.dirname, '..', 'dashboard', 'src');
    const source = walk(root).map((file) => readFileSync(file, 'utf8')).join('\n');
    assert.equal(source.includes('dev-signer'), false);
    assert.equal(source.includes('signApprovalForTest'), false);
    assert.equal(source.includes('software signer'), false);
  });
});
