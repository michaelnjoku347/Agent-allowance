/**
 * Spend the allowance sees is the higher of the local ledger and the
 * channel's redeemed balance. A missing channel does not invent a number.
 */

import { ethers } from 'ethers';
import { createRequire } from 'node:module';
import { selectOpenChannel } from './channel.js';
import { formatRlusd, toUnits } from './rules.js';

const require = createRequire(import.meta.url);
const { signIn, listChannels, getChannelState } = require('./ap4m-hackathon-sdk.cjs');

const CACHE_MS = 15_000;
let cached = null;

export function higherSpent(localAmount, chainAmount) {
  const local = toUnits(localAmount ?? 0);
  if (chainAmount == null || chainAmount === '') return formatRlusd(local);
  const chain = typeof chainAmount === 'bigint' ? chainAmount : toUnits(chainAmount);
  return formatRlusd(chain > local ? chain : local);
}

export function channelWarning({ localSpent, budget, chain }) {
  if (!chain || chain.redeemed == null || chain.cap == null) return null;
  const notes = [];
  const localText = formatRlusd(toUnits(localSpent ?? 0));
  const redeemedText = formatRlusd(toUnits(chain.redeemed));
  const budgetText = formatRlusd(toUnits(budget));
  const capText = formatRlusd(toUnits(chain.cap));
  if (localText !== redeemedText) {
    notes.push(`the local ledger shows ${localText} RLUSD spent and the channel shows ${redeemedText} RLUSD redeemed`);
  }
  if (budgetText !== capText) {
    notes.push(`the local budget is ${budgetText} RLUSD and the channel cap is ${capText} RLUSD`);
  }
  if (!notes.length) return null;
  return `These figures disagree: ${notes.join('; ')}.`;
}

/**
 * Read cap and redeemed from the open payment channel.
 * Returns null when the wallet is not configured. Throws when a configured
 * read fails, so the caller can say the chain was not loaded.
 */
export async function readOpenChannel(env = process.env) {
  const key = env.AGENT_PRIVATE_KEY?.trim() ?? '';
  const team = env.TEAM_NAME?.trim() ?? '';
  if (!key || !team || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  const now = Date.now();
  if (cached && cached.key === key && now - cached.at < CACHE_MS) return cached.value;

  const apiUrl = (env.AP4M_API_URL?.trim() || 'https://hackathon.ap4m.build').replace(/\/$/, '');
  const configResponse = await fetch(`${apiUrl}/public/config`, { signal: AbortSignal.timeout(20_000) });
  const config = await configResponse.json();
  if (!configResponse.ok) throw new Error('Could not read AP4M network config.');
  const provider = new ethers.JsonRpcProvider(env.AP4M_RPC_URL || config.network.rpcUrl);
  const wallet = new ethers.Wallet(key, provider);
  const { token } = await signIn(apiUrl, team, wallet);
  const channel = selectOpenChannel(await listChannels(apiUrl, token), env.CHANNEL_ID?.trim() ?? '');
  if (!channel) return null;
  const state = await getChannelState(provider, config.contracts.paymentLedger, channel.channel_id);
  const value = {
    channelId: String(channel.channel_id).toLowerCase(),
    cap: formatRlusd(state.cap),
    redeemed: formatRlusd(state.redeemed),
  };
  cached = { key, at: now, value };
  return value;
}
