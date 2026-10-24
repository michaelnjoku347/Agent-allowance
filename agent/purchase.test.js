import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'allowance-purchase-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');

const { finishQuote, resultLine } = await import('./agent.js');
const { listPayments, listPending } = await import('../server/store.js');
const { loadRules } = await import('./rules.js');

const rules = loadRules();
const allowed = rules.allowedMerchants[0];
const unlisted = '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad';
const txHash = `0x${'ab'.repeat(32)}`;
const receiptUrl = 'https://hackathon.ap4m.build/public/evidence/claims/claim-1.json';

function quote(amount, merchant) {
  return {
    amount,
    amountWei: `${BigInt(amount) * 10n ** 18n}`,
    merchant,
    description: `Quoted ${amount} RLUSD.`,
    resourceUrl: 'http://127.0.0.1:4308/resource',
  };
}

test('a paid result names the tx, claim, receipt, and explorer', () => {
  const line = resultLine({
    decision: 'allow',
    amount: '1',
    txHash,
    claimId: 'claim-1',
    receiptUrl,
    explorerUrl: `https://explorer.testnet.xrplevm.org/tx/${txHash}`,
  });
  assert.match(line, /^paid 1 RLUSD — tx 0xab/);
  assert.match(line, /claim claim-1/);
  assert.match(line, new RegExp(`receipt ${receiptUrl.replace(/[.]/g, '\\.')}`));
  assert.match(line, /https:\/\/explorer\.testnet\.xrplevm\.org\/tx\/0xab/);
});

test('an allowed 1 RLUSD quote is paid and replaces the sample rows', async () => {
  let calls = 0;
  const result = await finishQuote({
    task: 'Buy the morning market brief',
    resourceUrl: 'http://127.0.0.1:4308/resource',
    quote: quote('1', allowed),
    channelId: `0x${'cd'.repeat(32)}`,
    rules,
    spent: '0',
    pay: async () => {
      calls += 1;
      return {
        transactionHash: txHash,
        claimId: 'claim-1',
        resource: { type: 'market-data', message: 'Morning market brief' },
      };
    },
    report: async () => ({
      claimId: 'claim-1',
      payoutTx: `0x${'ef'.repeat(32)}`,
      receiptUrl,
    }),
  });

  assert.equal(calls, 1);
  assert.equal(result.decision, 'allow');
  assert.equal(result.amount, '1');
  assert.equal(result.txHash, txHash);
  assert.equal(result.claimId, 'claim-1');
  assert.equal(result.receiptUrl, receiptUrl);
  assert.equal(result.explorerUrl, `https://explorer.testnet.xrplevm.org/tx/${txHash}`);
  assert.match(result.line, /^paid 1 RLUSD /);

  const payments = await listPayments();
  assert.equal(payments.length, 1);
  assert.equal(payments.every((payment) => payment.sample === false), true);
  assert.equal(payments[0].receiptUrl, receiptUrl);
  assert.equal(payments[0].claimId, 'claim-1');
  assert.equal(payments[0].explorerUrl, result.explorerUrl);
  const pending = await listPending();
  assert.equal(pending.every((item) => item.sample === false), true);
});

test('8 RLUSD is blocked for the per-purchase cap and nothing is paid', async () => {
  let calls = 0;
  const result = await finishQuote({
    task: 'Buy the extended market history',
    resourceUrl: 'http://127.0.0.1:4308/demo/over-cap',
    quote: quote('8', allowed),
    rules,
    spent: '1',
    pay: async () => {
      calls += 1;
      throw new Error('must not pay');
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.decision, 'needs_approval');
  assert.equal(result.reason, 'over per-purchase cap');
  assert.equal(result.txHash, null);
  assert.equal(result.line, 'blocked over per-purchase cap — saved for approval');
  const pending = await listPending();
  assert.equal(pending.some((item) => item.reason === 'over per-purchase cap' && item.amount === '8' && !item.sample), true);
});

test('a merchant outside the allowlist is blocked and nothing is paid', async () => {
  let calls = 0;
  const result = await finishQuote({
    task: 'Buy a quote from an outside desk',
    resourceUrl: 'http://127.0.0.1:4308/demo/unlisted',
    quote: quote('1', unlisted),
    rules,
    spent: '1',
    pay: async () => {
      calls += 1;
      throw new Error('must not pay');
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.reason, 'merchant not allowed');
  assert.equal(result.line, 'blocked merchant not allowed — saved for approval');
  const pending = await listPending();
  assert.equal(pending.some((item) => item.reason === 'merchant not allowed' && item.merchant === unlisted), true);
  const payments = await listPayments();
  assert.equal(payments.some((payment) => payment.sample), false);
  rmSync(dir, { recursive: true, force: true });
});
