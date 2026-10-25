/**
 * Freeze stops signing, then asks the payment service to close open channels.
 * Closing is best-effort. A missing wallet or a failed close still leaves signing stopped.
 * The private key is never logged.
 */

import { createRequire } from 'node:module';
import { ethers } from 'ethers';
import { noteChannelClose, setFreeze } from './store.js';

const require = createRequire(import.meta.url);
const sdk = require('../agent/ap4m-hackathon-sdk.cjs');

const NO_WALLET = 'No agent wallet is configured, so no channel was closed. Signing is stopped.';
const CLOSED = 'The payment channel is closed. The agent cannot sign another voucher on it.';
const NONE = 'No open payment channel was found. Signing is stopped.';
const FAILED = 'The channel could not be closed. Signing is stopped.';

function safeReason(error, key) {
  const message = String(error?.message ?? FAILED);
  if (key && message.includes(key)) return FAILED;
  return message.slice(0, 240);
}

/**
 * Close every open channel for this team.
 * Pass signIn, listChannels, and closeChannel in tests. The default is the AP4M SDK.
 */
export async function closeOpenChannels(env = process.env, deps = {}) {
  const key = String(env.AGENT_PRIVATE_KEY ?? '').trim();
  const team = String(env.TEAM_NAME ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key) || !team) {
    return { closed: false, attempted: false, txHashes: [], reason: NO_WALLET };
  }
  const signIn = deps.signIn ?? sdk.signIn;
  const listChannels = deps.listChannels ?? sdk.listChannels;
  const closeChannel = deps.closeChannel ?? sdk.closeChannel;
  const apiUrl = String(env.AP4M_API_URL || 'https://hackathon.ap4m.build').replace(/\/$/, '');
  const timeoutMs = deps.timeoutMs ?? 8000;
  const work = (async () => {
    const rpc = env.AP4M_RPC_URL || 'https://rpc.testnet.xrplevm.org';
    const wallet = new ethers.Wallet(key, new ethers.JsonRpcProvider(rpc));
    const session = await signIn(apiUrl, team, wallet);
    const token = session?.token;
    if (!token) throw new Error(FAILED);
    const channels = await listChannels(apiUrl, token);
    const open = (Array.isArray(channels) ? channels : []).filter((row) => row?.channel_status === 'open' && row.channel_id);
    if (!open.length) return { closed: false, attempted: true, txHashes: [], reason: NONE };
    const txHashes = [];
    for (const row of open) {
      const result = await closeChannel(apiUrl, token, wallet, row.channel_id);
      if (result?.tx_hash && /^0x[0-9a-fA-F]{64}$/.test(result.tx_hash)) txHashes.push(result.tx_hash);
    }
    return { closed: true, attempted: true, txHashes, reason: CLOSED };
  })();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Closing the channel timed out. Signing is stopped.')), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    return { closed: false, attempted: true, txHashes: [], reason: safeReason(error, key) };
  } finally {
    clearTimeout(timer);
  }
}

/** Stop signing first. Then try to close the channel. Unfreeze is a separate call. */
export async function freezeAgent({ env = process.env, close = closeOpenChannels } = {}) {
  const state = await setFreeze(true);
  let result;
  try {
    result = await close(env);
  } catch {
    result = { closed: false, attempted: true, txHashes: [], reason: FAILED };
  }
  if (!result || typeof result !== 'object') {
    result = { closed: false, attempted: true, txHashes: [], reason: FAILED };
  }
  await noteChannelClose({ closed: result.closed, detail: result.reason || FAILED });
  return {
    ok: true,
    frozen: true,
    signing: false,
    channelClosed: Boolean(result.closed),
    channelReason: result.reason || FAILED,
    frozenAt: state.frozenAt,
    txHashes: Array.isArray(result.txHashes) ? result.txHashes : [],
  };
}
