/**
 * Agent Allowance runner.
 *
 * 1. Read the task from the command line.
 * 2. Ask the merchant for the resource. Do not send a payment.
 * 3. Read the HTTP 402 challenge (price and payout address).
 * 4. checkRules. Outside the allowance, save "pending approval" and stop.
 *    Nothing is signed.
 * 5. Inside the allowance, pay with the AP4M x402 SDK (buyResource).
 *
 * The private key is read from AGENT_PRIVATE_KEY. It is never printed.
 *
 * Usage (from the repo root):
 *   node agent/agent.js "Buy the morning weather brief"
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import hackathonSdk from './ap4m-hackathon-sdk.cjs';
import { buyResource, loadX402Context } from './ap4m-x402.mjs';
import { operationName, requestQuote } from './quote.js';
import { checkRules, formatRlusd, loadRules, merchantLabel } from './rules.js';
import { attachPayout, recordAgentPayment, recordPending, spentRlusd } from '../server/store.js';

const { signIn, requestChannel, listChannels, settle } = hackathonSdk;

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(rootDir, '.env') });

const TESTNET_CHAIN_ID = 1449000n;
const OPERATION_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

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

/**
 * A 402 quote is per Channel, so a Channel has to exist before the rules can
 * see the price. Opening one sends a vault transaction (XRP for gas). Set
 * CHANNEL_ID to reuse a Channel you already opened and skip that step.
 */
async function ensureChannel({ apiUrl, token, wallet, channelId, merchantId, capRlusd }) {
  if (channelId) {
    console.log('Using Channel', channelId);
    return channelId;
  }
  const channels = await listChannels(apiUrl, token);
  const open = channels.find((channel) => {
    if (channel.channel_status !== 'open') return false;
    if (merchantId && channel.merchant_id?.toLowerCase() !== merchantId.toLowerCase()) return false;
    return true;
  });
  if (open) {
    console.log('Reusing open Channel', open.channel_id);
    return open.channel_id;
  }
  console.log(`Opening a Channel with a ${capRlusd} RLUSD cap…`);
  const channel = await requestChannel(apiUrl, token, wallet, {
    capRlusd,
    merchantId: merchantId || undefined,
  });
  console.log('Channel open', channel.channel_id);
  return channel.channel_id;
}

async function reportSettlement(apiUrl, token, channelId, txHash) {
  try {
    const recorded = await fetch(`${apiUrl}/public/participant/record-redemption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tx_hash: txHash }),
    });
    if (!recorded.ok) {
      const body = await recorded.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${recorded.status}`);
    }
    const settled = await settle(apiUrl, token, channelId);
    if (settled?.payout_tx) console.log('RLUSD payout tx:', settled.payout_tx);
    if (settled?.receipt_url) console.log('Receipt:', apiUrl + settled.receipt_url);
    return settled?.payout_tx ?? null;
  } catch (error) {
    // The redemption is already on-chain. Settlement usually finishes on its
    // own; a slow receipt should not hide the payment from the dashboard.
    console.log('Settlement is still processing:', error.message ?? error);
    return null;
  }
}

export async function main() {
  const task = process.argv.slice(2).join(' ').trim();
  if (!task) {
    throw new Error('Pass a task. Example: node agent/agent.js "Buy the morning weather brief"');
  }

  const apiUrl = (process.env.AP4M_API_URL?.trim() || 'https://hackathon.ap4m.build').replace(/\/$/, '');
  const teamName = requiredEnv('TEAM_NAME');
  const resourceUrl = requiredEnv('RESOURCE_URL');
  const privateKey = readPrivateKey();
  const requestedChannel = process.env.CHANNEL_ID?.trim().toLowerCase() ?? '';
  if (requestedChannel && !/^0x[0-9a-f]{64}$/.test(requestedChannel)) {
    throw new Error('CHANNEL_ID must be 0x followed by 64 hex characters.');
  }
  const merchantId = process.env.MERCHANT_ID?.trim() || '';
  const operation = process.env.OPERATION?.trim() || operationName(task);
  if (!OPERATION_PATTERN.test(operation)) {
    throw new Error('OPERATION must be 1–64 characters: lowercase letters, numbers, and hyphens.');
  }

  const rules = loadRules();
  const configuredPayout = process.env.MERCHANT_PAYOUT_ADDRESS?.trim() ?? '';
  if (configuredPayout && !rules.allowedMerchants.includes(configuredPayout.toLowerCase())) {
    console.log('Note: MERCHANT_PAYOUT_ADDRESS is not in agent/rules.json allowedMerchants.');
    console.log('A quote to that payout will be saved for approval instead of paid.');
  }

  const config = await serviceConfig(apiUrl);
  const provider = new ethers.JsonRpcProvider(config.network.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log('Task:', task);
  console.log('Agent wallet:', wallet.address);

  const context = await loadX402Context(apiUrl);
  console.log('Signing in…');
  const { token } = await signIn(apiUrl, teamName, wallet);

  const capRlusd = process.env.CHANNEL_CAP?.trim() || formatRlusd(rules.budget);
  const channelId = (await ensureChannel({
    apiUrl,
    token,
    wallet,
    channelId: requestedChannel,
    merchantId,
    capRlusd,
  })).toLowerCase();

  console.log('Requesting the resource (no payment yet)…');
  const quote = await requestQuote(resourceUrl, channelId);
  const label = merchantLabel(rules, quote.merchant);
  const spent = await spentRlusd();
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
      description: quote.description || `Quoted ${quote.amount} RLUSD for “${task}”.`,
      resourceUrl: quote.resourceUrl,
    });
    console.log('Not paying. Saved for approval. Open the dashboard to approve it.');
    return;
  }

  // The SDK repeats the 402 exchange and signs one voucher. maximumAmount is
  // the quote we just accepted, so a higher price between the check and the
  // payment is refused by the SDK instead of paid.
  console.log('Within the allowance. Paying with the AP4M SDK…');
  const purchase = await buyResource({
    context,
    provider,
    wallet,
    stateDirectory: join(rootDir, 'agent/state'),
    resourceUrl,
    channelId,
    maximumAmount: quote.amountWei,
    operation,
  });
  console.log('Paid. Redemption tx:', purchase.transactionHash);

  let saved;
  try {
    saved = await recordAgentPayment({
      task,
      merchant: quote.merchant,
      merchantLabel: label,
      amount: quote.amount,
      txHash: purchase.transactionHash,
      resourceUrl: quote.resourceUrl,
      claimId: purchase.claimId,
      channelId,
    });
  } catch (error) {
    console.error('Payment is on-chain but the local ledger was not updated.');
    console.error('Redemption tx:', purchase.transactionHash);
    throw error;
  }

  const payoutTx = await reportSettlement(apiUrl, token, channelId, purchase.transactionHash);
  if (payoutTx && saved?.id) await attachPayout(saved.id, payoutTx);
  console.log('Saved. The dashboard picks it up on the next refresh.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
