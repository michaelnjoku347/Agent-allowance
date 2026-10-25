/**
 * EIP-712 messages a Ledger signs.
 * ApprovePurchase pays one saved quote. SetAllowance raises a limit.
 * Verification only — no private keys.
 */

import { ethers } from 'ethers';
import { canonicalAddress, formatRlusd, toUnits } from '../agent/rules.js';
import { LEDGER_ACCOUNT_PATH } from './ledger-device.js';
import network from './network.json' with { type: 'json' };

export { LEDGER_ACCOUNT_PATH };

export const APPROVAL_DOMAIN_NAME = 'Agent Allowance';
export const APPROVAL_DOMAIN_VERSION = '1';
export const APPROVAL_PRIMARY_TYPE = 'ApprovePurchase';
export const SET_ALLOWANCE_PRIMARY_TYPE = 'SetAllowance';
export const CHALLENGE_TTL_SECONDS = 10 * 60;

const APPROVE_FIELDS = [
  { name: 'purchaseId', type: 'string' },
  { name: 'merchant', type: 'string' },
  { name: 'amount', type: 'string' },
  { name: 'expiry', type: 'string' },
];

const SET_ALLOWANCE_FIELDS = [
  { name: 'cap', type: 'string' },
  { name: 'budget', type: 'string' },
  { name: 'expiry', type: 'string' },
  { name: 'merchants', type: 'string' },
  { name: 'validUntil', type: 'string' },
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

export function setAllowanceTypes() {
  return {
    EIP712Domain: approvalTypes().EIP712Domain.map((field) => ({ ...field })),
    SetAllowance: SET_ALLOWANCE_FIELDS.map((field) => ({ ...field })),
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

/** Date string the Ethereum app can show as text. Seconds are kept so it round-trips. */
export function formatDeviceDate(expiry) {
  const seconds = normalizeExpiry(expiry);
  const iso = new Date(seconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export function parseDeviceDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/);
  if (!match) throw new Error('Invalid expiry.');
  const ms = Date.parse(`${match[1]}T${match[2]}.000Z`);
  if (!Number.isFinite(ms)) throw new Error('Invalid expiry.');
  return Math.floor(ms / 1000);
}

/** "8 RLUSD". A bare number is accepted so a mismatched signature still compares. */
export function humanAmount(amount) {
  const stripped = String(amount ?? '').trim().replace(/\s*RLUSD$/i, '').trim();
  return `${formatRlusd(toUnits(stripped))} RLUSD`;
}

/** Merchant label plus the checksum address, so the device shows who is paid. */
export function merchantLine(merchant, label) {
  const address = ethers.getAddress(canonicalAddress(merchant));
  const name = String(label ?? '').replace(/\s+/g, ' ').trim();
  return name ? `${name} (${address})` : address;
}

export function merchantListLine(merchants) {
  return merchants.map((merchant) => ethers.getAddress(canonicalAddress(merchant))).join(', ');
}

/** Canonical message. The device shows these strings, not raw wei or a unix time. */
export function buildApprovalMessage({ purchaseId, merchant, merchantLabel: label, amount, expiry }) {
  const id = String(purchaseId ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Invalid purchase id.');
  return {
    purchaseId: id,
    merchant: merchantLine(merchant, label),
    amount: humanAmount(amount),
    expiry: formatDeviceDate(expiry),
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

export function buildSetAllowanceMessage({ cap, budget, expiresAt, merchants, validUntil }) {
  return {
    cap: humanAmount(cap),
    budget: humanAmount(budget),
    expiry: formatDeviceDate(Math.floor(Date.parse(expiresAt) / 1000)),
    merchants: merchantListLine(merchants),
    validUntil: formatDeviceDate(validUntil),
  };
}

export function buildSetAllowanceTypedData(message, chainId = network.chainId) {
  return {
    domain: approvalDomain(chainId),
    types: setAllowanceTypes(),
    primaryType: SET_ALLOWANCE_PRIMARY_TYPE,
    message: buildSetAllowanceMessage(message),
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

function presentedPurchase(message) {
  return {
    purchaseId: String(message?.purchaseId ?? ''),
    merchant: String(message?.merchant ?? ''),
    amount: String(message?.amount ?? ''),
    expiry: String(message?.expiry ?? ''),
  };
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
  const signed = presentedPurchase(message);
  let typedData;
  try {
    typedData = {
      domain: approvalDomain(chainId),
      types: approvalTypes(),
      primaryType: APPROVAL_PRIMARY_TYPE,
      message: signed,
    };
    humanAmount(signed.amount);
    parseDeviceDate(signed.expiry);
  } catch {
    return fail('invalid', 'That approval does not match this quote.');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(signed.merchant) && !/\(0x[0-9a-fA-F]{40}\)$/.test(signed.merchant)) {
    return fail('invalid', 'That approval does not match this quote.');
  }
  let expected;
  try {
    expected = buildApprovalMessage({
      purchaseId: pending.id,
      merchant: pending.merchant,
      merchantLabel: pending.merchantLabel,
      amount: pending.amount,
      expiry: challenge?.expiry,
    });
  } catch {
    return fail('invalid', 'That approval does not match this quote.');
  }
  if (signed.purchaseId !== expected.purchaseId) {
    return fail('mismatch_purchase', 'The signed purchase does not match this quote.');
  }
  if (signed.merchant !== expected.merchant) {
    return fail('mismatch_merchant', 'The signed merchant does not match this quote.');
  }
  if (humanAmount(signed.amount) !== expected.amount) {
    return fail('mismatch_amount', 'The signed amount does not match this quote.');
  }
  if (!challenge || signed.expiry !== expected.expiry) {
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
  if (parseDeviceDate(signed.expiry) * 1000 <= nowMs) {
    return fail('expired', 'That approval has expired. Connect the Ledger again.');
  }
  return { ok: true, signer: recovered.address, signature: sig, typedData };
}

export function judgeSetAllowance({
  proposal,
  challenge,
  approver,
  message,
  signature,
  usedSignatures = [],
  nowMs = Date.now(),
  chainId = network.chainId,
}) {
  if (!approver) {
    return fail('no_approver', 'Set APPROVER_ADDRESS to the Ledger account that may change the allowance.');
  }
  if (!proposal || !challenge) {
    return fail('missing', 'Nothing is waiting for a Ledger signature.');
  }
  const signed = {
    cap: String(message?.cap ?? ''),
    budget: String(message?.budget ?? ''),
    expiry: String(message?.expiry ?? ''),
    merchants: String(message?.merchants ?? ''),
    validUntil: String(message?.validUntil ?? ''),
  };
  let expected;
  try {
    expected = buildSetAllowanceMessage({
      cap: proposal.maxPerPurchase,
      budget: proposal.budget,
      expiresAt: proposal.expiresAt,
      merchants: proposal.allowedMerchants,
      validUntil: challenge.expiry,
    });
    humanAmount(signed.cap);
    humanAmount(signed.budget);
    parseDeviceDate(signed.expiry);
    parseDeviceDate(signed.validUntil);
  } catch {
    return fail('invalid', 'That allowance change does not match the request.');
  }
  if (humanAmount(signed.cap) !== expected.cap) {
    return fail('mismatch_cap', 'The signed cap does not match this change.');
  }
  if (humanAmount(signed.budget) !== expected.budget) {
    return fail('mismatch_budget', 'The signed budget does not match this change.');
  }
  if (signed.expiry !== expected.expiry) {
    return fail('mismatch_expiry', 'The signed expiry does not match this change.');
  }
  if (signed.merchants !== expected.merchants) {
    return fail('mismatch_merchants', 'The signed merchant list does not match this change.');
  }
  if (signed.validUntil !== expected.validUntil) {
    return fail('mismatch_expiry', 'That signature does not match the allowance waiting on screen.');
  }
  const typedData = {
    domain: approvalDomain(chainId),
    types: setAllowanceTypes(),
    primaryType: SET_ALLOWANCE_PRIMARY_TYPE,
    message: signed,
  };
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
  if (parseDeviceDate(signed.validUntil) * 1000 <= nowMs) {
    return fail('expired', 'That approval has expired. Connect the Ledger again.');
  }
  return { ok: true, signer: recovered.address, signature: sig, typedData };
}

export function approvalDisplay(pending, message) {
  let expiryIso = null;
  try {
    expiryIso = new Date(parseDeviceDate(message.expiry) * 1000).toISOString();
  } catch {
    expiryIso = null;
  }
  return {
    domain: APPROVAL_DOMAIN_NAME,
    version: APPROVAL_DOMAIN_VERSION,
    chainId: network.chainId,
    purchaseId: message.purchaseId,
    merchant: message.merchant,
    merchantLabel: pending.merchantLabel ?? null,
    amount: message.amount,
    amountLabel: message.amount,
    expiry: message.expiry,
    expiryIso,
  };
}
