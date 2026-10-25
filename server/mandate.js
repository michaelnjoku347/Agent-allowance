/**
 * Prepare and accept a Ledger signature on the agent mandate.
 * The signature is checked against the current allowance. Nothing is paid.
 */

import { ethers } from 'ethers';
import { activeApprover, loadRules } from '../agent/rules.js';
import {
  CHALLENGE_TTL_SECONDS,
  LEDGER_ACCOUNT_PATH,
} from '../shared/approval.js';
import {
  buildMandateMessage,
  buildMandateTypedData,
  encodeMandateHeader,
  judgeMandate,
} from '../shared/mandate.js';
import network from '../shared/network.json' with { type: 'json' };
import { saveMandate } from './store.js';

function httpError(status, error, message) {
  return { status, error, message };
}

function agentAddress(env) {
  const named = String(env.AGENT_ADDRESS ?? '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(named)) return ethers.getAddress(named);
  const key = String(env.AGENT_PRIVATE_KEY ?? '').trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(key)) return new ethers.Wallet(key).address;
  return null;
}

export async function createMandateChallenge(options = {}) {
  const env = options.env ?? process.env;
  const rules = options.rules ?? loadRules();
  const nowMs = (options.now ?? (() => Date.now()))();
  let approver;
  try {
    approver = activeApprover(rules, env);
  } catch {
    return httpError(400, 'no_approver', 'APPROVER_ADDRESS is not a valid Ethereum address.');
  }
  if (!approver) {
    return httpError(409, 'no_approver', 'Set APPROVER_ADDRESS to the Ledger account that signs the agent mandate.');
  }
  const agent = options.agent ?? agentAddress(env);
  if (!agent) {
    return httpError(409, 'no_agent', 'Set AGENT_ADDRESS or AGENT_PRIVATE_KEY so the mandate names the agent.');
  }
  const validUntil = Math.floor(nowMs / 1000) + (options.challengeTtlSeconds ?? CHALLENGE_TTL_SECONDS);
  let message;
  try {
    message = buildMandateMessage({ agent, rules, validUntil });
  } catch (error) {
    return httpError(400, 'invalid', error.message ?? 'That allowance cannot be signed as a mandate.');
  }
  const typedData = buildMandateTypedData(message, network.chainId);
  return {
    status: 200,
    body: {
      typedData,
      approver,
      accountPath: LEDGER_ACCOUNT_PATH,
      note: 'Sign the agent mandate on the Ledger. This does not pay a merchant.',
    },
  };
}

export async function acceptMandate(body = {}, options = {}) {
  const env = options.env ?? process.env;
  const rules = options.rules ?? loadRules();
  const nowMs = (options.now ?? (() => Date.now()))();
  let approver;
  try {
    approver = activeApprover(rules, env);
  } catch {
    return httpError(400, 'no_approver', 'APPROVER_ADDRESS is not a valid Ethereum address.');
  }
  const message = body.typedData?.message ?? body.message;
  const signature = body.signature;
  const verdict = judgeMandate({
    message,
    signature,
    approver,
    rules,
    nowMs,
    chainId: network.chainId,
  });
  if (!verdict.ok) return httpError(400, 'invalid', verdict.reason);
  const header = encodeMandateHeader(verdict.message, signature);
  const saved = await saveMandate({
    message: verdict.message,
    signature,
    approver: verdict.signer,
    header,
  });
  return { status: 200, body: { ok: true, mandate: saved } };
}
