/**
 * Backup demo for the out-of-rule Ledger step.
 *
 * ALLOWANCE_DEV_SIGNER=1 lets the API sign one ApprovePurchase message with
 * server/dev-signer.js and an in-memory throwaway key. The dashboard never
 * imports that signer. It only shows a button when this flag is on, and the
 * label is "simulated Ledger signature". Nothing here broadcasts a voucher.
 */

import { ethers } from 'ethers';
import express from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { finishQuote } from '../agent/agent.js';
import { fallbackJev } from '../agent/jev.js';
import { requestQuote } from '../agent/quote.js';
import { checkRules, loadRules, merchantLabel } from '../agent/rules.js';
import { sendPaymentRequired, UNLISTED_MERCHANT } from '../merchant/quotes.js';
import { acceptLedgerApproval, createApprovalChallenge } from './ledger.js';
import { signApprovalForTest } from './dev-signer.js';
import {
  discardStoreFile,
  listPending,
  recordPending,
  recordUnbroadcastPayment,
  spentRlusd,
} from './store.js';

const CHANNEL_ID = `0x${'ab'.repeat(32)}`;
export const SIMULATED_LEDGER_NOTE = 'simulated Ledger signature';

let throwaway = null;

export function devSignerEnabled(env = process.env) {
  return env.ALLOWANCE_DEV_SIGNER === '1';
}

function ephemeralApprover() {
  if (!throwaway) throwaway = ethers.Wallet.createRandom();
  return throwaway;
}

/** The same throwaway key the backup challenge and the backup verification both use. */
export function backupApproverWallet() {
  return ephemeralApprover();
}

/** Use the throwaway approver when the backup flag is on and no Ledger address is set. */
export function backupChallengeEnv(env = process.env) {
  if (!devSignerEnabled(env) || String(env.APPROVER_ADDRESS ?? '').trim()) return env;
  return { ...env, APPROVER_ADDRESS: ephemeralApprover().address };
}

function quoteApp(payee) {
  const app = express();
  const quote = (amount, payTo, description) => (req, res) => {
    const host = req.headers.host;
    if (!host || /[\s/]/.test(host)) {
      res.status(500).json({ error: 'Missing host.' });
      return;
    }
    sendPaymentRequired(res, {
      url: `http://${host}${req.path}`,
      description,
      amount: ethers.parseUnits(amount, 18).toString(),
      payTo,
      channelId: req.get('x-ap4m-channel-id'),
    });
  };
  app.get('/in-rule', quote('1', payee, 'Morning market brief'));
  app.get('/over-cap', quote('8', payee, 'Extended market history'));
  app.get('/unlisted', quote('1', UNLISTED_MERCHANT, 'Quote from a desk outside the allowance'));
  return app;
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

/**
 * Three local decisions: 1 RLUSD allowed, 8 RLUSD over the cap, 1 RLUSD unlisted.
 * Replaces the ledger file. Does not sign a voucher.
 */
export async function rehearseBackupDemo() {
  if (!devSignerEnabled()) {
    const error = new Error('The backup demo signer is off.');
    error.status = 404;
    throw error;
  }
  const rules = loadRules();
  const payee = rules.allowedMerchants[1] || rules.allowedMerchants[0];
  if (!payee) throw new Error('The allowance has no merchant to quote.');
  discardStoreFile();
  const server = await listen(quoteApp(payee));
  try {
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;
    const inRuleUrl = `${origin}/in-rule`;
    const inQuote = await requestQuote(inRuleUrl, CHANNEL_ID);
    const allowed = checkRules({
      merchant: inQuote.merchant,
      amount: inQuote.amount,
      spent: '0',
    }, rules);
    if (allowed.decision !== 'allow' || inQuote.amount !== '1') {
      throw new Error('The 1 RLUSD quote was not inside the allowance.');
    }
    const paid = await recordUnbroadcastPayment({
      task: 'Buy the morning market brief',
      merchant: inQuote.merchant,
      merchantLabel: merchantLabel(rules, inQuote.merchant),
      amount: inQuote.amount,
      resourceUrl: inRuleUrl,
      jev: fallbackJev().jev,
    });
    await delay(5);

    const hold = async (input) => recordPending({
      ...input,
      merchantLabel: input.merchantLabel || 'Outside desk',
    });
    let signed = false;
    const pay = async () => {
      signed = true;
      throw new Error('The backup demo must not sign a voucher.');
    };
    const over = await finishQuote({
      task: 'Buy the extended market history',
      resourceUrl: `${origin}/over-cap`,
      quote: await requestQuote(`${origin}/over-cap`, CHANNEL_ID),
      channelId: CHANNEL_ID,
      rules,
      spent: await spentRlusd(),
      pay,
      plan: async () => null,
      recordHold: hold,
    });
    await delay(5);
    const outside = await finishQuote({
      task: 'Buy a quote from an outside desk',
      resourceUrl: `${origin}/unlisted`,
      quote: await requestQuote(`${origin}/unlisted`, CHANNEL_ID),
      channelId: CHANNEL_ID,
      rules,
      spent: await spentRlusd(),
      pay,
      plan: async () => null,
      recordHold: hold,
    });
    if (signed || over.reason !== 'over per-purchase cap' || outside.reason !== 'merchant not allowed') {
      throw new Error('The backup demo did not block the two out-of-rule quotes.');
    }
    const pending = await listPending();
    return {
      paid: {
        id: paid.id,
        amount: paid.amount,
        task: paid.task,
        txHash: paid.txHash ?? null,
      },
      pending: pending.map((item) => ({
        id: item.id,
        amount: item.amount,
        reason: item.reason,
        task: item.task,
      })),
    };
  } finally {
    await close(server);
  }
}

/**
 * Sign the pending quote with the dev signer and record it once.
 * The returned note is the on-screen label. No voucher is broadcast.
 */
export async function simulateLedgerApproval(id) {
  if (!devSignerEnabled()) {
    return { status: 404, error: 'Not found', message: 'Not found' };
  }
  const env = backupChallengeEnv();
  const wallet = ephemeralApprover();
  const challenge = await createApprovalChallenge(id, { env });
  if (challenge.status !== 200) return challenge;
  const signed = await signApprovalForTest(challenge.body.typedData, wallet.privateKey);
  const result = await acceptLedgerApproval(id, {
    signature: signed.signature,
    message: challenge.body.typedData.message,
  }, {
    env,
    payApproved: async (quote) => recordUnbroadcastPayment({
      task: quote.task,
      merchant: quote.merchant,
      merchantLabel: quote.merchantLabel,
      amount: quote.amount,
      resourceUrl: quote.resourceUrl,
      jev: quote.jev,
      approver: quote.approver,
      note: SIMULATED_LEDGER_NOTE,
      simulatedLedger: true,
    }),
  });
  if (result.status === 200 && result.body) {
    result.body.note = SIMULATED_LEDGER_NOTE;
    result.body.simulated = true;
    if (result.body.payment) delete result.body.payment.approvalSignature;
  }
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (!devSignerEnabled()) {
    console.error('Set ALLOWANCE_DEV_SIGNER=1 to prepare the backup demo ledger. No voucher is signed.');
    process.exit(1);
  }
  rehearseBackupDemo()
    .then((result) => {
      console.log(`In-rule payment recorded locally: ${result.paid.amount} RLUSD (${result.paid.task}). No transaction hash.`);
      for (const item of result.pending) {
        console.log(`Waiting: ${item.amount} RLUSD — ${item.reason}`);
      }
    })
    .catch((error) => {
      console.error(error.message ?? error);
      process.exit(1);
    });
}
