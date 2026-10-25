/**
 * EIP-712 ApprovePurchase, the message a Ledger signs before one
 * out-of-rule quote can be paid. Verification only — no private keys.
 */

import { ethers } from 'ethers';
import { canonicalAddress, formatRlusd, toUnits } from '../agent/rules.js';
import { LEDGER_ACCOUNT_PATH } from './ledger-device.js';
import network from './network.json' with { type: 'json' };

export { LEDGER_ACCOUNT_PATH };

export const APPROVAL_DOMAIN_NAME = 'Agent Allowance';
export const APPROVAL_DOMAIN_VERSION = '1';
export const APPROVAL_PRIMARY_TYPE = 'ApprovePurchase';
export const CHALLENGE_TTL_SECONDS = 10 * 60;

const APPROVE_FIELDS = [
  { name: 'purchaseId', type: 'string' },
  { name: 'merchant', type: 'address' },
  { name: 'amount', type: 'string' },
  { name: 'expiry', type: 'uint256' },
];

export function approvalDomain(chainId = network.chainId) {
  return {
    name: APPROVAL_DOMAIN_NAME,
    version: APPROVAL_DOMAIN_VERSION,
    chainId: Number(chainId),
  };
}

export function approvalTypes() {
  return {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    ApprovePurchase: APPROVE_FIELDS.map((field) => ({ ...field })),
  };
}

/** ethers rejects an EIP712Domain entry inside `types`. The device payload keeps it. */
export function ethersApprovalTypes(types = approvalTypes()) {
  const copy = { ...types };
  delete copy.EIP712Domain;
  return copy;
}

function normalizeExpiry(expiry) {
  const text = typeof expiry === 'bigint' ? expiry.toString() : String(expiry ?? '').trim();
  if (!/^\d+$/.test(text)) throw new Error('Invalid expiry.');
  const value = BigInt(text);
  if (value <= 0n || value > 4_000_000_000n) throw new Error('Invalid expiry.');
  return Number(value);
}

/** Canonical message. Amount is the RLUSD string the ledger already stores. */
export function buildApprovalMessage({ purchaseId, merchant, amount, expiry }) {
  const id = String(purchaseId ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Invalid purchase id.');
  return {
    purchaseId: id,
    merchant: ethers.getAddress(canonicalAddress(merchant)),
    amount: formatRlusd(toUnits(amount)),
    expiry: normalizeExpiry(expiry),
  };
}

export function buildApprovalTypedData(message, chainId = network.chainId) {
  return {
    domain: approvalDomain(chainId),
    types: approvalTypes(),
    primaryType: APPROVAL_PRIMARY_TYPE,
    message: buildApprovalMessage(message),
  };
}

export function normalizeSignature(signature) {
  if (signature && typeof signature === 'object' && signature.r && signature.s && signature.v != null) {
    let v = Number(signature.v);
    if (!Number.isInteger(v)) throw new Error('Invalid signature.');
    if (v === 0 || v === 1) v += 27;
    if (v !== 27 && v !== 28) throw new Error('Invalid signature.');
    return ethers.Signature.from({ r: signature.r, s: signature.s, v }).serialized;
  }
  const raw = String(signature ?? '').trim();
  if (!/^0x[0-9a-fA-F]{130}$/.test(raw)) throw new Error('Invalid signature.');
  return ethers.Signature.from(raw).serialized;
}

export function recoverApprovalSigner(typedData, signature) {
  const serialized = normalizeSignature(signature);
  const address = ethers.verifyTypedData(
    typedData.domain,
    ethersApprovalTypes(typedData.types),
    typedData.message,
    serialized,
  );
  return { signature: serialized.toLowerCase(), address: address.toLowerCase() };
}

function fail(error, message) {
  return { ok: false, error, message };
}

/**
 * Decide whether this signature may authorize `pending`.
 * The typed data is rebuilt here. A client-supplied domain is ignored.
 */
export function judgeApproval({
  pending,
  challenge,
  approver,
  message,
  signature,
  usedSignatures = [],
  nowMs = Date.now(),
  chainId = network.chainId,
}) {
  if (!approver) {
    return fail('no_approver', 'Set APPROVER_ADDRESS to the Ledger account that may approve a purchase.');
  }
  if (!pending || pending.sample || pending.status === 'declined') {
    return fail('missing', 'That purchase is not waiting for approval.');
  }
  let typedData;
  try {
    typedData = buildApprovalTypedData({
      purchaseId: message?.purchaseId,
      merchant: message?.merchant,
      amount: message?.amount,
      expiry: message?.expiry,
    }, chainId);
  } catch {
    return fail('invalid', 'That approval does not match this quote.');
  }
  const signed = typedData.message;
  if (signed.purchaseId !== pending.id) {
    return fail('mismatch_purchase', 'The signed purchase does not match this quote.');
  }
  if (canonicalAddress(signed.merchant) !== canonicalAddress(pending.merchant)) {
    return fail('mismatch_merchant', 'The signed merchant does not match this quote.');
  }
  if (signed.amount !== pending.amount) {
    return fail('mismatch_amount', 'The signed amount does not match this quote.');
  }
  if (!challenge || Number(challenge.expiry) !== signed.expiry) {
    return fail('mismatch_expiry', 'That approval does not match the quote waiting on screen.');
  }
  let recovered;
  try {
    recovered = recoverApprovalSigner(typedData, signature);
  } catch {
    return fail('invalid_signature', 'The Ledger signature could not be verified.');
  }
  const sig = recovered.signature;
  if (usedSignatures.some((item) => String(item).toLowerCase() === sig)) {
    return fail('replay', 'That Ledger approval was already used.');
  }
  if (recovered.address !== canonicalAddress(approver)) {
    return fail('wrong_signer', 'The signature is not from the registered Ledger approver.');
  }
  if (signed.expiry * 1000 <= nowMs) {
    return fail('expired', 'That approval has expired. Connect the Ledger again.');
  }
  return { ok: true, signer: recovered.address, signature: sig, typedData };
}

export function approvalDisplay(pending, message) {
  return {
    domain: APPROVAL_DOMAIN_NAME,
    version: APPROVAL_DOMAIN_VERSION,
    chainId: network.chainId,
    purchaseId: message.purchaseId,
    merchant: canonicalAddress(message.merchant),
    merchantLabel: pending.merchantLabel ?? null,
    amount: message.amount,
    amountLabel: `${message.amount} RLUSD`,
    expiry: message.expiry,
    expiryIso: new Date(message.expiry * 1000).toISOString(),
  };
}
