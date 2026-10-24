/**
 * Agent Allowance payer.
 *
 * The agent asks RESOURCE_URL for the resource, reads the HTTP 402 quote,
 * and runs checkRules before anything is signed.
 *   allow          → buyResource pays with an x402 voucher and the merchant
 *                    returns the resource. The tx hash, claim, receipt, and
 *                    explorer link are saved.
 *   needs_approval → the quote is saved and nothing is paid.
 *
 * The private key is read from AGENT_PRIVATE_KEY and is never printed.
 *
 * Usage (from the repo root, with the merchant already running):
 *   npm run agent -- "Buy the morning market brief"
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectOpenChannel } from './channel.js';
import { retryingFetch } from './net.js';
import { operationName, requestQuote } from './quote.js';
import { buyResource, loadX402Context } from './ap4m-x402.mjs';
import { canonicalAddress, checkRules, formatRlusd, loadRules, merchantLabel, toUnits } from './rules.js';
import { recordAgentPayment, recordPending, spentRlusd } from '../server/store.js';

const require = createRequire(import.meta.url);
const {
  signIn,
  requestChannel,
  listChannels,
  getChannelState,
  settle,
} = require('./ap4m-hackathon-sdk.cjs');

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(rootDir, '.env') });

const TESTNET_CHAIN_ID = 1449000n;
const EXPLORER = 'https://explorer.testnet.xrplevm.org';

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

/** Task text. A trailing RLUSD amount is not part of the task. The price comes from the 402. */
export function taskText(argv = process.argv.slice(2)) {
  if (argv.length >= 2 && /^\d+(\.\d+)?$/.test(argv.at(-1) ?? '')) {
    return argv.slice(0, -1).join(' ').trim();
  }
  return argv.join(' ').trim();
}

export function canonicalResourceUrl(value) {
  const raw = String(value ?? '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('RESOURCE_URL must be an http(s) URL.');
  }
  if (url.href !== raw || url.username || url.password || url.hash || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('RESOURCE_URL must be a canonical credential-free URL with no fragment.');
  }
  return raw;
}

function absoluteReceipt(apiUrl, receiptUrl) {
  if (!receiptUrl) return null;
  if (/^https?:\/\//i.test(receiptUrl)) return receiptUrl;
  const path = receiptUrl.startsWith('/') ? receiptUrl : `/${receiptUrl}`;
  return `${apiUrl.replace(/\/$/, '')}${path}`;
}

/** One-line outcome for the log and the demo. */
export function resultLine({ decision, reason, amount, txHash, claimId, receiptUrl, explorerUrl }) {
  if (decision !== 'allow') return `blocked ${reason} — saved for approval`;
  const parts = [`paid ${amount} RLUSD`, `tx ${txHash}`];
  if (claimId) parts.push(`claim ${claimId}`);
  if (receiptUrl) parts.push(`receipt ${receiptUrl}`);
  if (explorerUrl) parts.push(explorerUrl);
  return parts.join(' — ');
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

async function hold({ recordHold, task, quote, label, resourceUrl, reason, description }) {
  await recordHold({
    task,
    merchant: quote.merchant,
    merchantLabel: label,
    amount: quote.amount,
    reason,
    description,
    resourceUrl,
  });
  console.log('Not paying. Saved for approval.');
  return {
    decision: 'needs_approval',
    reason,
    amount: quote.amount,
    merchant: canonicalAddress(quote.merchant),
    txHash: null,
    claimId: null,
    receiptUrl: null,
    explorerUrl: null,
    line: resultLine({ decision: 'needs_approval', reason }),
  };
}

/**
 * Apply the rules to a quote the agent already read.
 * pay() is called only when the quote is inside the allowance.
 */
export async function finishQuote({
  task,
  resourceUrl,
  quote,
  channelId = null,
  rules = loadRules(),
  spent = '0',
  pay,
  report = async () => ({ claimId: null, payoutTx: null, receiptUrl: null }),
  recordPayment = recordAgentPayment,
  recordHold = recordPending,
}) {
  const label = merchantLabel(rules, quote.merchant);
  const merchant = canonicalAddress(quote.merchant);
  const decision = checkRules({
    merchant,
    amount: quote.amount,
    spent,
  }, rules);
  console.log(`Quote: ${quote.amount} RLUSD to ${shortAddress(merchant)}${label ? ` (${label})` : ''}`);
  console.log(`Rules: ${decision.decision} — ${decision.reason}`);
  if (decision.decision !== 'allow') {
    return hold({
      recordHold,
      task,
      quote,
      label,
      resourceUrl,
      reason: decision.reason,
      description: quote.description,
    });
  }

  let purchase;
  try {
    console.log('Within the allowance. Paying over x402…');
    purchase = await pay({ quote, resourceUrl, task, channelId });
  } catch (error) {
    if (error?.code === 'OVER_CHANNEL_CAP') {
      return hold({
        recordHold,
        task,
        quote,
        label,
        resourceUrl,
        reason: 'over channel cap',
        description: 'The Channel cannot cover this payment on top of what it has already redeemed.',
      });
    }
    throw error;
  }

  const txHash = purchase?.transactionHash;
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error('The merchant did not return a redemption transaction hash.');
  }
  console.log('Redemption tx:', txHash);
  console.log('Resource received.');
  const settled = await report(purchase);
  const claimId = settled?.claimId ?? purchase.claimId ?? null;
  const receiptUrl = settled?.receiptUrl ?? null;
  const payoutTx = settled?.payoutTx ?? null;
  let saved;
  try {
    saved = await recordPayment({
      task,
      merchant,
      merchantLabel: label,
      amount: quote.amount,
      txHash,
      claimId,
      channelId,
      payoutTx,
      receiptUrl,
      resourceUrl,
    });
  } catch (error) {
    console.error('Payment is on-chain but the local ledger was not updated.');
    console.error('Redemption tx:', txHash);
    throw error;
  }
  const explorerUrl = saved.explorerUrl ?? `${EXPLORER}/tx/${txHash}`;
  if (receiptUrl) console.log('Receipt:', receiptUrl);
  return {
    decision: 'allow',
    reason: decision.reason,
    amount: quote.amount,
    merchant,
    txHash,
    claimId,
    receiptUrl,
    explorerUrl,
    resource: purchase.resource ?? null,
    line: resultLine({
      decision: 'allow',
      amount: quote.amount,
      txHash,
      claimId,
      receiptUrl,
      explorerUrl,
    }),
  };
}

async function openSession(apiUrl, rules) {
  const teamName = requiredEnv('TEAM_NAME');
  const privateKey = readPrivateKey();
  const requestedChannel = process.env.CHANNEL_ID?.trim().toLowerCase() ?? '';
  if (requestedChannel && !/^0x[0-9a-f]{64}$/.test(requestedChannel)) {
    throw new Error('CHANNEL_ID must be 0x followed by 64 hex characters.');
  }

  const config = await serviceConfig(apiUrl);
  const provider = new ethers.JsonRpcProvider(config.network.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log('Agent wallet:', wallet.address);
  console.log('Signing in…');
  const { token } = await signIn(apiUrl, teamName, wallet);
  let channel = selectOpenChannel(await listChannels(apiUrl, token), requestedChannel);
  if (!channel) {
    const capRlusd = process.env.CHANNEL_CAP?.trim() || formatRlusd(rules.budget);
    console.log(`No open Channel. Opening one with a ${capRlusd} RLUSD cap…`);
    channel = await requestChannel(apiUrl, token, wallet, { capRlusd });
    console.log('Channel open', channel.channel_id);
  } else {
    console.log('Reusing open Channel', channel.channel_id);
  }
  const context = await loadX402Context(apiUrl);
  return { config, provider, wallet, token, channel, context };
}

async function payWithX402({ session, quote, resourceUrl, task }) {
  const ledgerAddress = session.config.contracts.paymentLedger;
  const state = await getChannelState(session.provider, ledgerAddress, session.channel.channel_id);
  if (!/^[1-9][0-9]{0,77}$/.test(quote.amountWei ?? '')) {
    throw new Error('Merchant quote amount is not a positive wei integer.');
  }
  const thisPayment = BigInt(quote.amountWei);
  if (toUnits(quote.amount) !== thisPayment) {
    throw new Error('Merchant quote amount does not match its wei price.');
  }
  if (BigInt(state.redeemed) + thisPayment > BigInt(state.cap)) {
    const error = new Error('over channel cap');
    error.code = 'OVER_CHANNEL_CAP';
    throw error;
  }
  return buyResource({
    context: session.context,
    provider: session.provider,
    wallet: session.wallet,
    stateDirectory: join(rootDir, 'agent/state'),
    resourceUrl,
    channelId: session.channel.channel_id.toLowerCase(),
    maximumAmount: quote.amountWei,
    operation: operationName(task),
  });
}

async function reportSettlement(apiUrl, token, channelId, purchase) {
  let claimId = purchase.claimId ?? null;
  try {
    const recorded = await fetch(`${apiUrl}/public/participant/record-redemption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tx_hash: purchase.transactionHash }),
    });
    const recordedBody = await recorded.json().catch(() => ({}));
    if (!recorded.ok) {
      throw new Error(recordedBody.error ?? `record-redemption HTTP ${recorded.status}`);
    }
    claimId = recordedBody.claim_id ?? claimId;
    const settled = await settle(apiUrl, token, channelId);
    const payoutTx = settled?.payout_tx ?? null;
    const receiptUrl = absoluteReceipt(apiUrl, settled?.receipt_url);
    if (payoutTx) console.log('RLUSD payout tx:', payoutTx);
    return { claimId, payoutTx, receiptUrl };
  } catch (error) {
    console.log('Settlement is still processing:', error.message ?? error);
    return { claimId, payoutTx: null, receiptUrl: null };
  }
}

/**
 * Request one resource, judge the 402, and pay only when the rules allow it.
 * A dropped connection ("fetch failed") is retried up to 3 times. HTTP errors
 * are not retried, so a payment is not sent twice.
 */
export async function runOnce({
  task = taskText(),
  resourceUrl = process.env.RESOURCE_URL,
  requestQuote: readQuote = requestQuote,
  rules = loadRules(),
  spent,
  session = null,
} = {}) {
  if (!task) {
    throw new Error('Pass a task. Example: npm run agent -- "Buy the morning market brief"');
  }
  const url = canonicalResourceUrl(resourceUrl);
  const apiUrl = (process.env.AP4M_API_URL?.trim() || 'https://hackathon.ap4m.build').replace(/\/$/, '');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = retryingFetch(previousFetch.bind(globalThis));
  try {
    console.log('Task:', task);
    const active = session ?? await openSession(apiUrl, rules);
    const channelId = String(active.channel.channel_id).toLowerCase();
    const quote = await readQuote(url, channelId);
    if (new URL(quote.resourceUrl).href !== url) {
      throw new Error('Merchant quote is for a different resource than the one requested.');
    }
    const spentNow = spent ?? await spentRlusd();
    return finishQuote({
      task,
      resourceUrl: url,
      quote,
      channelId,
      rules,
      spent: spentNow,
      pay: (args) => payWithX402({ session: active, ...args }),
      report: (purchase) => reportSettlement(apiUrl, active.token, active.channel.channel_id, purchase),
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
}

export async function main() {
  const result = await runOnce();
  console.log(`→ ${result.line}`);
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
