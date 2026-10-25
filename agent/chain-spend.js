/**
 * Spend the allowance sees is the higher of the local ledger and the
 * channel's redeemed balance. A missing or failed read does not invent a number.
 * /api/status only peeks this cache. A payment asks for a fresh read.
 */

import { ethers } from 'ethers';
import { createRequire } from 'node:module';
import { selectOpenChannel } from './channel.js';
import { formatRlusd, toUnits } from './rules.js';

const require = createRequire(import.meta.url);
const { signIn, listChannels, getChannelState } = require('./ap4m-hackathon-sdk.cjs');

const CACHE_MS = 15_000;
const READ_TIMEOUT_MS = 3_000;

let memory = { key: '', at: 0, state: 'empty', value: null, error: '' };
let inflight = null;

export function walletConfigured(env = process.env) {
  const key = env.AGENT_PRIVATE_KEY?.trim() ?? '';
  const team = env.TEAM_NAME?.trim() ?? '';
  return Boolean(team && /^0x[0-9a-fA-F]{64}$/.test(key));
}

function cacheKey(env = process.env) {
  return [
    env.AGENT_PRIVATE_KEY?.trim() ?? '',
    env.TEAM_NAME?.trim() ?? '',
    env.CHANNEL_ID?.trim() ?? '',
    env.MERCHANT_PAYOUT_ADDRESS?.trim() ?? '',
  ].join('|');
}

export function clearChannelCache() {
  memory = { key: '', at: 0, state: 'empty', value: null, error: '' };
  inflight = null;
}

function recall(env, { allowStale = false } = {}) {
  if (!memory.key || memory.key !== cacheKey(env) || memory.state === 'empty') return null;
  if (!allowStale && Date.now() - memory.at >= CACHE_MS) return null;
  return memory;
}

export function peekChannel(env = process.env) {
  const hit = recall(env, { allowStale: true });
  if (!hit) return { chain: null, unavailable: false };
  if (hit.state === 'error') return { chain: null, unavailable: true };
  return { chain: hit.value, unavailable: false };
}

function remember(env, state, value, error = '') {
  memory = { key: cacheKey(env), at: Date.now(), state, value, error };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The channel read timed out.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readChain(env, timeoutMs) {
  const key = env.AGENT_PRIVATE_KEY.trim();
  const team = env.TEAM_NAME.trim();
  const apiUrl = (env.AP4M_API_URL?.trim() || 'https://hackathon.ap4m.build').replace(/\/$/, '');
  const configResponse = await fetch(`${apiUrl}/public/config`, { signal: AbortSignal.timeout(timeoutMs) });
  const config = await configResponse.json();
  if (!configResponse.ok) throw new Error('Could not read AP4M network config.');
  const provider = new ethers.JsonRpcProvider(env.AP4M_RPC_URL || config.network.rpcUrl);
  try {
    const wallet = new ethers.Wallet(key, provider);
    const { token } = await signIn(apiUrl, team, wallet);
    const channel = selectOpenChannel(await listChannels(apiUrl, token), env.CHANNEL_ID?.trim() ?? '', {
      payout: env.MERCHANT_PAYOUT_ADDRESS?.trim() ?? '',
    });
    if (!channel) return null;
    const state = await getChannelState(provider, config.contracts.paymentLedger, channel.channel_id);
    return {
      channelId: String(channel.channel_id).toLowerCase(),
      cap: formatRlusd(state.cap),
      redeemed: formatRlusd(state.redeemed),
    };
  } finally {
    provider.destroy?.();
  }
}

/**
 * Read cap and redeemed. Cached successes, failures, and "no channel" are reused
 * until the background refresh asks for a fresh read. Throws when a fresh read fails.
 */
export async function readOpenChannel(env = process.env, options = {}) {
  if (!walletConfigured(env)) {
    remember(env, 'missing', null);
    return null;
  }
  if (!options.fresh) {
    const hit = recall(env);
    if (hit?.state === 'error') throw new Error(hit.error || 'The payment channel could not be read.');
    if (hit && (hit.state === 'ready' || hit.state === 'missing')) return hit.value;
  }
  const key = cacheKey(env);
  if (inflight?.key === key) return inflight.promise;
  const timeoutMs = options.timeoutMs ?? READ_TIMEOUT_MS;
  const promise = (async () => {
    try {
      const value = await withTimeout(
        options.read ? options.read(env) : readChain(env, timeoutMs),
        timeoutMs,
      );
      if (!value) {
        remember(env, 'missing', null);
        return null;
      }
      remember(env, 'ready', value);
      return value;
    } catch (error) {
      const message = error?.message || 'The payment channel could not be read.';
      remember(env, 'error', null, message);
      throw error;
    }
  })().finally(() => {
    if (inflight?.key === key) inflight = null;
  });
  inflight = { key, promise };
  return promise;
}

export function startChannelRefresh(env = process.env, intervalMs = CACHE_MS) {
  const tick = () => {
    readOpenChannel(env, { fresh: true }).catch(() => {});
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

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

/** Block a payment when the channel has already redeemed more than the local budget. */
export function paymentBlockedByChain({ budget, chain }) {
  if (!chain || chain.redeemed == null) return null;
  if (toUnits(chain.redeemed) > toUnits(budget)) {
    return `On-chain redeemed ${formatRlusd(toUnits(chain.redeemed))} RLUSD is above the local budget of ${formatRlusd(toUnits(budget))} RLUSD. Nothing was paid.`;
  }
  return null;
}

export function channelCoversQuote({ chain, amount }) {
  if (!chain || chain.cap == null || chain.redeemed == null) {
    return { ok: false, message: 'The payment channel could not be read. Nothing was signed.' };
  }
  const left = toUnits(chain.cap) - toUnits(chain.redeemed);
  const price = toUnits(amount);
  const remaining = left > 0n ? left : 0n;
  if (left < price) {
    return {
      ok: false,
      message: `This channel has ${formatRlusd(remaining)} RLUSD left and the quote is ${formatRlusd(price)} RLUSD. Open a channel at the budget before connecting the Ledger. Nothing was signed.`,
    };
  }
  return { ok: true, remaining: formatRlusd(remaining) };
}

/** A configured wallet must produce a channel. Otherwise nothing is paid. */
export async function requireSpendChannel(env = process.env, read = null) {
  if (!walletConfigured(env)) {
    const error = new Error('Add AGENT_PRIVATE_KEY and TEAM_NAME to .env before an approved purchase can be paid.');
    error.code = 'NOT_CONFIGURED';
    throw error;
  }
  try {
    const chain = read ? await read(env) : await readOpenChannel(env, { fresh: true });
    if (!chain || chain.redeemed == null || chain.cap == null) {
      const error = new Error('The payment channel could not be read. Nothing was paid.');
      error.code = 'CHANNEL_UNREAD';
      throw error;
    }
    return chain;
  } catch (error) {
    if (error?.code === 'NOT_CONFIGURED' || error?.code === 'CHANNEL_UNREAD') throw error;
    const wrapped = new Error('The payment channel could not be read. Nothing was paid.');
    wrapped.code = 'CHANNEL_UNREAD';
    throw wrapped;
  }
}
