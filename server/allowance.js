/**
 * Ledger gate for raising the allowance.
 * Lowering a limit does not come through here. Eve applies that directly.
 * A raise is written only after SetAllowance recovers to the approver.
 */

import {
  activeApprover,
  describeAllowanceChange,
  formatRlusd,
  loadRules,
  updateAllowance,
} from '../agent/rules.js';
import {
  CHALLENGE_TTL_SECONDS,
  LEDGER_ACCOUNT_PATH,
  buildSetAllowanceTypedData,
  judgeSetAllowance,
  normalizeSignature,
} from '../shared/approval.js';
import network from '../shared/network.json' with { type: 'json' };
import {
  claimAllowanceSignature,
  completeAllowanceChange,
  readAllowanceChange,
  readUsedApprovalSignatures,
  releaseAllowanceChange,
  saveAllowanceChallenge,
} from './store.js';

function httpError(status, error, message) {
  return { status, error, message };
}

function approverOrError(rules, env) {
  try {
    return { approver: activeApprover(rules, env) };
  } catch {
    return httpError(400, 'no_approver', 'APPROVER_ADDRESS is not a valid Ethereum address.');
  }
}

function proposalFrom(described) {
  return {
    maxPerPurchase: formatRlusd(described.next.maxPerPurchase),
    budget: formatRlusd(described.next.budget),
    expiresAt: described.next.expiresAt,
    allowedMerchants: described.next.allowedMerchants,
  };
}

export async function createAllowanceChallenge(patch = {}, options = {}) {
  const nowMs = (options.now ?? (() => Date.now()))();
  const ttl = options.challengeTtlSeconds ?? CHALLENGE_TTL_SECONDS;
  const env = options.env ?? process.env;
  const rules = options.rules ?? loadRules();
  const approver = approverOrError(rules, env);
  if (approver.error) return approver;
  if (!approver.approver) {
    return httpError(409, 'no_approver', 'Set APPROVER_ADDRESS to the Ledger account that may change the allowance.');
  }
  const described = describeAllowanceChange(patch);
  if (described.error) return httpError(400, 'invalid', described.error);
  if (!described.raises) {
    return httpError(400, 'not_a_raise', 'Lowering a limit does not need a Ledger signature.');
  }
  const proposal = proposalFrom(described);
  const existing = await readAllowanceChange();
  let expiry = Math.floor(nowMs / 1000) + ttl;
  const previousExpiry = Number(existing?.approvalChallenge?.expiry ?? existing?.lastChallengeExpiry);
  if (Number.isFinite(previousExpiry) && expiry <= previousExpiry) expiry = previousExpiry + 1;
  let typedData;
  try {
    typedData = buildSetAllowanceTypedData({
      cap: proposal.maxPerPurchase,
      budget: proposal.budget,
      expiresAt: proposal.expiresAt,
      merchants: proposal.allowedMerchants,
      validUntil: expiry,
    }, network.chainId);
  } catch {
    return httpError(400, 'invalid', 'That allowance change cannot be signed.');
  }
  await saveAllowanceChallenge(proposal, { expiry, issuedAt: new Date(nowMs).toISOString() });
  return {
    status: 200,
    body: {
      approverAddress: approver.approver,
      derivationPath: LEDGER_ACCOUNT_PATH,
      typedData,
      display: {
        domain: typedData.domain.name,
        chainId: typedData.domain.chainId,
        cap: typedData.message.cap,
        budget: typedData.message.budget,
        expiry: typedData.message.expiry,
        merchants: typedData.message.merchants,
        validUntil: typedData.message.validUntil,
      },
    },
  };
}

/**
 * Verify a SetAllowance signature and write the raise once.
 * Refuses when the body has no signature.
 */
export async function acceptAllowanceChange(body = {}, options = {}) {
  const nowMs = (options.now ?? (() => Date.now()))();
  const env = options.env ?? process.env;
  const rules = options.rules ?? loadRules();
  const approver = approverOrError(rules, env);
  if (approver.error) return approver;
  if (!body?.signature || !body?.message) {
    return httpError(400, 'invalid_signature', 'A Ledger signature is required. The allowance was not changed.');
  }
  const used = await readUsedApprovalSignatures();
  try {
    const presented = normalizeSignature(body.signature).toLowerCase();
    if (used.some((item) => String(item).toLowerCase() === presented)) {
      return httpError(409, 'replay', 'That Ledger approval was already used.');
    }
  } catch {
    return httpError(400, 'invalid_signature', 'The Ledger signature could not be verified.');
  }
  const change = await readAllowanceChange();
  const verdict = judgeSetAllowance({
    proposal: change?.proposal,
    challenge: change?.approvalChallenge,
    approver: approver.approver,
    message: body.message,
    signature: body.signature,
    usedSignatures: used,
    nowMs,
    chainId: network.chainId,
  });
  if (!verdict.ok) {
    const status = verdict.error === 'missing' ? 404 : verdict.error === 'expired' ? 409 : 400;
    return httpError(status, verdict.error, verdict.message);
  }
  const claim = await claimAllowanceSignature(verdict.signature, nowMs);
  if (claim.error === 'replay') return httpError(409, 'replay', 'That Ledger approval was already used.');
  if (claim.error === 'in_progress') {
    return httpError(409, 'in_progress', 'That allowance change is already being applied.');
  }
  if (claim.missing || claim.error) return httpError(404, 'missing', 'Nothing is waiting for a Ledger signature.');
  const applied = updateAllowance({
    maxPerPurchase: claim.proposal.maxPerPurchase,
    budget: claim.proposal.budget,
    expiresAt: claim.proposal.expiresAt,
    allowedMerchants: claim.proposal.allowedMerchants,
  }, undefined, { ledger: true });
  if (applied.error) {
    await releaseAllowanceChange();
    return httpError(409, applied.code || 'invalid', applied.error);
  }
  await completeAllowanceChange();
  return {
    status: 200,
    body: {
      ok: true,
      rules: applied.rules,
      note: 'Allowance raised after a Ledger signature. Nothing was paid.',
    },
  };
}
