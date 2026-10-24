/**
 * Agent Allowance runner.
 *
 * Direct AP4M payment, same order as the portal starter kit:
 *   signIn → reuse or requestChannel → redeemVoucher → record-redemption → settle
 *
 * checkRules runs before a voucher is signed. Outside the allowance, the quote
 * is saved as needs_approval and nothing is paid. The private key is read from
 * AGENT_PRIVATE_KEY and is never printed.
 *
 * Usage (from the repo root):
 *   npm run agent -- "Buy the morning weather brief"
 *   npm run agent -- "Buy the morning weather brief" 1.5
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectOpenChannel } from './channel.js';
import { retryingFetch } from './net.js';
import { buildPurchaseQuote } from './quote.js';
import { canonicalAddress, checkRules, formatRlusd, loadRules, merchantLabel, toUnits } from './rules.js';
import { recordAgentPayment, recordPending, spentRlusd } from '../server/store.js';

const require = createRequire(import.meta.url);
const {
  signIn,
  requestChannel,
  listChannels,
  getChannelState,
  redeemVoucher,
  settle,
} = require('./ap4m-hackathon-sdk.cjs');

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(rootDir, '.env') });

const TESTNET_CHAIN_ID = 1449000n;

function requiredEnv(name) {
  const value = process.env[name]?.trim() ?? '';
  if (!value) throw new Error(`Set ${name} in .env (see .env.example).`);
  return value;
}

function readPrivateKey() {
  const key = requiredEnv('AGENT_PRIVATE_KEY');
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('AGENT_PRIVATE_KEY must be a 32-byte hex key starting with 0x.');
  }
  return key;
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Last CLI argument is the RLUSD amount when it is a plain number. Otherwise PAYMENT_RLUSD, or 1. */
export function paymentAmount(argv = process.argv.slice(2), envAmount = process.env.PAYMENT_RLUSD) {
  const last = argv.at(-1);
  if (argv.length >= 2 && /^\d+(\.\d+)?$/.test(last ?? '')) return last;
  const fromEnv = envAmount?.trim();
  return fromEnv || '1';
}

export function taskText(argv = process.argv.slice(2)) {
  if (argv.length >= 2 && /^\d+(\.\d+)?$/.test(argv.at(-1) ?? '')) {
    return argv.slice(0, -1).join(' ').trim();
  }
  return argv.join(' ').trim();
}

function absoluteReceipt(apiUrl, receiptUrl) {
  if (!receiptUrl) return null;
  if (/^https?:\/\//i.test(receiptUrl)) return receiptUrl;
  const path = receiptUrl.startsWith('/') ? receiptUrl : `/${receiptUrl}`;
  return `${apiUrl.replace(/\/$/, '')}${path}`;
}

async function serviceConfig(apiUrl) {
  const response = await fetch(`${apiUrl}/public/config`, { signal: AbortSignal.timeout(30_000) });
  const config = await response.json();
  if (!response.ok) {
    throw new Error(`Could not read AP4M network config (${response.status}).`);
  }
  if (BigInt(config.network.chainId) !== TESTNET_CHAIN_ID) {
    throw new Error(`Refusing to run off XRPL EVM Testnet. Service reported chain ${config.network.chainId}.`);
  }
  return config;
}

async function refuse(quote, rules, decision) {
  const label = merchantLabel(rules, quote.merchant);
  await recordPending({
    task: quote.task,
    merchant: quote.merchant,
    merchantLabel: label,
    amount: quote.amount,
    reason: decision.reason,
    description: quote.description,
  });
  console.log(`Rules: needs_approval — ${decision.reason}`);
  console.log('Not paying. Saved for approval. Open the dashboard to approve it.');
}

export async function main() {
  const task = taskText();
  if (!task) {
    throw new Error('Pass a task. Example: npm run agent -- "Buy the morning weather brief"');
  }
  const amount = paymentAmount();
  toUnits(amount);

  const apiUrl = (process.env.AP4M_API_URL?.trim() || 'https://hackathon.ap4m.build').replace(/\/$/, '');
  const teamName = requiredEnv('TEAM_NAME');
  const privateKey = readPrivateKey();
  const requestedChannel = process.env.CHANNEL_ID?.trim().toLowerCase() ?? '';
  if (requestedChannel && !/^0x[0-9a-f]{64}$/.test(requestedChannel)) {
    throw new Error('CHANNEL_ID must be 0x followed by 64 hex characters.');
  }

  const rules = loadRules();
  const configuredPayout = process.env.MERCHANT_PAYOUT_ADDRESS?.trim() ?? '';
  if (configuredPayout) canonicalAddress(configuredPayout);

  const previousFetch = globalThis.fetch;
  globalThis.fetch = retryingFetch(previousFetch.bind(globalThis));
  try {
    const config = await serviceConfig(apiUrl);
    const rpcUrl = config.network.rpcUrl;
    const ledgerAddress = config.contracts.paymentLedger;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log('Task:', task);
    console.log('Agent wallet:', wallet.address);

    console.log('Signing in…');
    const { token } = await signIn(apiUrl, teamName, wallet);

    const spent = await spentRlusd();
    let channel = selectOpenChannel(await listChannels(apiUrl, token), requestedChannel);
    if (!channel && configuredPayout) {
      const earlyQuote = buildPurchaseQuote({ amount, merchant: configuredPayout, task });
      const early = checkRules({ merchant: earlyQuote.merchant, amount: earlyQuote.amount, spent }, rules);
      if (early.decision !== 'allow') {
        await refuse(earlyQuote, rules, early);
        return;
      }
    }
    if (!channel) {
      const capRlusd = process.env.CHANNEL_CAP?.trim() || formatRlusd(rules.budget);
      console.log(`No open Channel. Opening one with a ${capRlusd} RLUSD cap…`);
      channel = await requestChannel(apiUrl, token, wallet, { capRlusd });
      console.log('Channel open', channel.channel_id);
    } else {
      console.log('Reusing open Channel', channel.channel_id);
    }

    if (!channel.payout) throw new Error('The Channel has no merchant payout address.');
    const quote = buildPurchaseQuote({ amount, merchant: channel.payout, task });
    const label = merchantLabel(rules, quote.merchant);
    const decision = checkRules({
      merchant: quote.merchant,
      amount: quote.amount,
      spent,
    }, rules);
    console.log(`Quote: ${quote.amount} RLUSD to ${shortAddress(quote.merchant)}${label ? ` (${label})` : ''}`);
    console.log(`Rules: ${decision.decision} — ${decision.reason}`);
    if (decision.decision !== 'allow') {
      await recordPending({
        task,
        merchant: quote.merchant,
        merchantLabel: label,
        amount: quote.amount,
        reason: decision.reason,
        description: quote.description,
      });
      console.log('Not paying. Saved for approval. Open the dashboard to approve it.');
      return;
    }

    const state = await getChannelState(provider, ledgerAddress, channel.channel_id);
    const thisPayment = toUnits(quote.amount);
    if (state.redeemed + thisPayment > state.cap) {
      await recordPending({
        task,
        merchant: quote.merchant,
        merchantLabel: label,
        amount: quote.amount,
        reason: 'over channel cap',
        description: 'The Channel cannot cover this payment on top of what it has already redeemed.',
      });
      console.log('Not paying. The Channel cap would be exceeded.');
      return;
    }

    console.log('Within the allowance. Redeeming the voucher…');
    const redeemed = await redeemVoucher(
      wallet,
      ledgerAddress,
      rpcUrl,
      channel.channel_id,
      state.redeemed + thisPayment,
    );
    console.log('Redemption tx:', redeemed.txHash);

    let claimId = redeemed.claimId ?? null;
    let receiptUrl = null;
    let payoutTx = null;
    try {
      const recorded = await fetch(`${apiUrl}/public/participant/record-redemption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tx_hash: redeemed.txHash }),
      });
      const recordedBody = await recorded.json().catch(() => ({}));
      if (!recorded.ok) {
        throw new Error(recordedBody.error ?? `record-redemption HTTP ${recorded.status}`);
      }
      claimId = recordedBody.claim_id ?? claimId;
      const settled = await settle(apiUrl, token, channel.channel_id);
      payoutTx = settled?.payout_tx ?? null;
      receiptUrl = absoluteReceipt(apiUrl, settled?.receipt_url);
      if (payoutTx) console.log('RLUSD payout tx:', payoutTx);
      if (receiptUrl) console.log('Receipt:', receiptUrl);
    } catch (error) {
      console.log('Settlement is still processing:', error.message ?? error);
    }

    try {
      await recordAgentPayment({
        task,
        merchant: quote.merchant,
        merchantLabel: label,
        amount: quote.amount,
        txHash: redeemed.txHash,
        claimId,
        channelId: channel.channel_id,
        payoutTx,
        receiptUrl,
      });
    } catch (error) {
      console.error('Payment is on-chain but the local ledger was not updated.');
      console.error('Redemption tx:', redeemed.txHash);
      throw error;
    }
    console.log('Explorer:', `https://explorer.testnet.xrplevm.org/tx/${redeemed.txHash}`);
    console.log('Saved. The dashboard picks it up on the next refresh.');
  } finally {
    globalThis.fetch = previousFetch;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
