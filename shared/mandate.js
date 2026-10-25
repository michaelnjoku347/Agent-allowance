/**
 * EIP-712 AgentMandate.
 * A Ledger signs the allowance the agent may spend.
 * The merchant checks that signature and returns 403 when it does not hold.
 * This file never reads a private key.
 */

import { ethers } from 'ethers';
import {
  approvalDomain,
  ethersApprovalTypes,
  formatDeviceDate,
  humanAmount,
  merchantListLine,
  parseDeviceDate,
} from './approval.js';
import { canonicalAddress, formatRlusd } from '../agent/rules.js';
import network from './network.json' with { type: 'json' };

export const MANDATE_PRIMARY_TYPE = 'AgentMandate';

const MANDATE_FIELDS = [
  { name: 'agent', type: 'string' },
  { name: 'budget', type: 'string' },
  { name: 'cap', type: 'string' },
  { name: 'expiry', type: 'string' },
  { name: 'merchants', type: 'string' },
  { name: 'validUntil', type: 'string' },
];

export function mandateTypes() {
  return {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    AgentMandate: MANDATE_FIELDS.map((field) => ({ ...field })),
  };
}

function displayAmount(value) {
  if (typeof value === 'bigint') return humanAmount(formatRlusd(value));
  return humanAmount(value);
}

function merchantAddresses(merchants) {
  return (merchants ?? []).map((item) => (typeof item === 'string' ? item : item?.address)).filter(Boolean);
}

export function buildMandateMessage({ agent, rules, validUntil }) {
  const address = ethers.getAddress(canonicalAddress(agent));
  const expirySeconds = Number.isFinite(Number(rules.expiresAt)) && !String(rules.expiresAt).includes('-')
    ? Number(rules.expiresAt)
    : Math.floor(Date.parse(rules.expiresAt) / 1000);
  return {
    agent: address,
    budget: displayAmount(rules.budget),
    cap: displayAmount(rules.maxPerPurchase),
    expiry: formatDeviceDate(expirySeconds),
    merchants: merchantListLine(merchantAddresses(rules.allowedMerchants)),
    validUntil: formatDeviceDate(validUntil),
  };
}

export function buildMandateTypedData(message, chainId = network.chainId) {
  return {
    domain: approvalDomain(chainId),
    types: mandateTypes(),
    primaryType: MANDATE_PRIMARY_TYPE,
    message: {
      agent: String(message?.agent ?? ''),
      budget: String(message?.budget ?? ''),
      cap: String(message?.cap ?? ''),
      expiry: String(message?.expiry ?? ''),
      merchants: String(message?.merchants ?? ''),
      validUntil: String(message?.validUntil ?? ''),
    },
  };
}

export function recoverMandateSigner(message, signature, chainId = network.chainId) {
  const typed = buildMandateTypedData(message, chainId);
  return ethers.verifyTypedData(
    typed.domain,
    ethersApprovalTypes(typed.types),
    typed.message,
    signature,
  );
}

/** Header the agent sends. The signature is public. No private key is included. */
export function encodeMandateHeader(message, signature) {
  return Buffer.from(JSON.stringify({ message, signature }), 'utf8').toString('base64url');
}

export function decodeMandateHeader(header) {
  if (!header || typeof header !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (!parsed?.message || typeof parsed.signature !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function sameList(left, right) {
  const a = String(left ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean).sort();
  const b = String(right ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean).sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Whether this signature still authorizes the agent.
 * payTo, when set, must be one of the merchants named in the mandate.
 */
export function judgeMandate({
  message,
  signature,
  approver,
  rules,
  payTo = null,
  nowMs = Date.now(),
  chainId = network.chainId,
} = {}) {
  if (!approver) return { ok: false, reason: 'Set APPROVER_ADDRESS before a mandate can be checked.' };
  let expected;
  try {
    expected = buildMandateMessage({
      agent: message?.agent,
      rules,
      validUntil: parseDeviceDate(message?.validUntil),
    });
  } catch {
    return { ok: false, reason: 'That agent mandate does not match this allowance.' };
  }
  const signed = buildMandateTypedData(message, chainId).message;
  if (signed.agent !== expected.agent || signed.budget !== expected.budget || signed.cap !== expected.cap || signed.expiry !== expected.expiry || !sameList(signed.merchants, expected.merchants)) {
    return { ok: false, reason: 'That agent mandate does not match this allowance.' };
  }
  let validUntil;
  try {
    validUntil = parseDeviceDate(signed.validUntil);
  } catch {
    return { ok: false, reason: 'That agent mandate has expired.' };
  }
  if (nowMs >= validUntil * 1000) return { ok: false, reason: 'That agent mandate has expired.' };
  let signer;
  try {
    signer = recoverMandateSigner(signed, signature, chainId);
  } catch {
    return { ok: false, reason: 'That agent mandate signature could not be checked.' };
  }
  if (canonicalAddress(signer) !== canonicalAddress(approver)) {
    return { ok: false, reason: 'That agent mandate was not signed by the Ledger approver.' };
  }
  if (payTo) {
    let payout;
    try {
      payout = ethers.getAddress(canonicalAddress(payTo));
    } catch {
      return { ok: false, reason: 'That payout is not on the agent mandate.' };
    }
    const listed = signed.merchants.split(',').map((item) => item.trim().toLowerCase());
    if (!listed.includes(payout.toLowerCase())) {
      return { ok: false, reason: 'That payout is not on the agent mandate.' };
    }
  }
  return { ok: true, signer: ethers.getAddress(signer), message: signed };
}
