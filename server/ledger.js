/**
 * Ledger approval gate.
 *
 * A quote saved as needs_approval stays unpaid until a signature over
 * ApprovePurchase recovers to the registered approver, matches that quote,
 * and has not expired or been used. Hard rules (budget, allowance expiry)
 * still apply. Jev cannot take this path.
 */

import { payExactQuote } from '../agent/agent.js';
import {
  channelCoversQuote,
  higherSpent,
  paymentBlockedByChain,
  readOpenChannel,
  requireSpendChannel,
  walletConfigured,
} from '../agent/chain-spend.js';
import { activeApprover, checkApprovalHardRules, declineReason, formatRlusd, loadRules } from '../agent/rules.js';
import { plainReason } from '../shared/words.js';
import {
  CHALLENGE_TTL_SECONDS,
  LEDGER_ACCOUNT_PATH,
  approvalDisplay,
  buildApprovalTypedData,
  judgeApproval,
  normalizeSignature,
} from '../shared/approval.js';
import network from '../shared/network.json' with { type: 'json' };
import {
  claimApprovalSignature,
  completeApprovedPurchase,
  readFrozen,
  readPendingRecord,
  readUsedApprovalSignatures,
  releaseApprovalPayment,
  saveApprovalChallenge,
  setPaymentPhase,
  spentRlusd,
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

function missingPurchase() {
  return httpError(404, 'missing', 'That purchase is not waiting for approval.');
}

export async function createApprovalChallenge(id, options = {}) {
  const nowMs = (options.now ?? (() => Date.now()))();
  const ttl = options.challengeTtlSeconds ?? CHALLENGE_TTL_SECONDS;
  const env = options.env ?? process.env;
  const rules = options.rules ?? loadRules();
  const approver = approverOrError(rules, env);
  if (approver.error) return approver;
  if (!approver.approver) {
    return httpError(409, 'no_approver', 'Set APPROVER_ADDRESS to the Ledger account that may approve a purchase.');
  }
  const found = await readPendingRecord(id);
  if (found.error === 'invalid') return httpError(400, 'invalid', 'That approval id is not valid.');
  if (found.missing || found.pending.sample) return missingPurchase();
  if (found.pending.status !== 'pending' && found.pending.status !== 'paying') return missingPurchase();
  const denied = declineReason(found.pending.merchant, rules);
  if (denied) return httpError(409, 'decline_only', denied);
  const channelBlock = await channelBlockFor(found.pending, env, options);
  if (channelBlock) return channelBlock;

  // A retry in the same second must not rebuild the signature that already failed.
  let expiry = Math.floor(nowMs / 1000) + ttl;
  const previousExpiry = Number(found.pending.approvalChallenge?.expiry ?? found.pending.lastChallengeExpiry);
  if (Number.isFinite(previousExpiry) && expiry <= previousExpiry) expiry = previousExpiry + 1;
  let typedData;
  try {
    typedData = buildApprovalTypedData({
      purchaseId: found.pending.id,
      merchant: found.pending.merchant,
      merchantLabel: found.pending.merchantLabel,
      amount: found.pending.amount,
      expiry,
    }, network.chainId);
  } catch {
    return httpError(400, 'invalid', 'That quote cannot be approved.');
  }
  const saved = await saveApprovalChallenge(id, {
    expiry,
    issuedAt: new Date(nowMs).toISOString(),
  }, nowMs);
  if (saved.error === 'in_progress') {
    return httpError(409, 'in_progress', 'A payment for this quote is already in progress.');
  }
  if (saved.missing || saved.error) return missingPurchase();
  return {
    status: 200,
    body: {
      purchaseId: found.pending.id,
      approverAddress: approver.approver,
      derivationPath: LEDGER_ACCOUNT_PATH,
      typedData,
      display: approvalDisplay(found.pending, typedData.message),
    },
  };
}

async function readSpendChannel(env, options) {
  if (options.channelState) return options.channelState();
  if (!walletConfigured(env)) return null;
  return readOpenChannel(env, { fresh: true });
}

/** Fail closed when a configured wallet cannot show a channel that covers the quote. */
async function channelBlockFor(pending, env, options) {
  if (options.spent !== undefined && !options.channelState && !walletConfigured(env)) return null;
  if (!walletConfigured(env) && !options.channelState) return null;
  let chain = null;
  try {
    chain = await readSpendChannel(env, options);
  } catch {
    return httpError(409, 'channel_unread', 'The payment channel could not be read. Nothing was paid.');
  }
  if (!chain) return httpError(409, 'channel_unread', 'The payment channel could not be read. Nothing was paid.');
  const rules = options.rules ?? loadRules();
  const blocked = paymentBlockedByChain({ budget: formatRlusd(rules.budget), chain });
  if (blocked) return httpError(409, 'chain_over_budget', blocked);
  const cover = channelCoversQuote({ chain, amount: pending.amount });
  if (!cover.ok) return httpError(409, 'channel_short', cover.message);
  return null;
}

async function spentForApproval(pending, options) {
  if (options.spent !== undefined) return options.spent;
  const local = await spentRlusd();
  if (!walletConfigured(options.env ?? process.env) && !options.channelState) return local;
  const chain = await readSpendChannel(options.env ?? process.env, options);
  if (!chain) {
    const error = new Error('The payment channel could not be read. Nothing was paid.');
    error.code = 'CHANNEL_UNREAD';
    throw error;
  }
  return higherSpent(local, chain.redeemed);
}

function publicPaymentError(error) {
  if (error?.code === 'OVER_CHANNEL_CAP') return 'The channel cannot cover this payment.';
  const text = String(error?.message ?? 'The payment did not go through.');
  if (/private key/i.test(text)) return 'The payment did not go through.';
  return text.slice(0, 240);
}

async function paySavedQuote(pending, options = {}) {
  const env = options.env ?? process.env;
  const chain = options.chain ?? await requireSpendChannel(env);
  const rules = options.rules ?? loadRules();
  const blocked = paymentBlockedByChain({ budget: formatRlusd(rules.budget), chain });
  if (blocked) {
    const error = new Error(blocked);
    error.code = 'CHAIN_OVER_BUDGET';
    throw error;
  }
  const cover = channelCoversQuote({ chain, amount: pending.amount });
  if (!cover.ok) {
    const error = new Error(cover.message);
    error.code = 'CHANNEL_SHORT';
    throw error;
  }
  const spent = higherSpent(pending.spentBasis ?? '0', chain.redeemed);
  return payExactQuote({
    task: pending.task,
    resourceUrl: pending.resourceUrl,
    merchant: pending.merchant,
    amount: pending.amount,
    merchantLabel: pending.merchantLabel,
    jev: pending.jev,
    approver: pending.approver,
    plan: pending.plan,
    purchaseId: pending.id,
    spent,
    reservationId: pending.reservationId,
    onPhase: async (phase) => {
      await setPaymentPhase(pending.id, phase);
    },
  });
}

/**
 * Verify a device signature and pay that exact quote once.
 * `payApproved` is a test double. Production uses the AP4M x402 payer.
 */
export async function acceptLedgerApproval(id, body = {}, options = {}) {
  const nowMs = (options.now ?? (() => Date.now()))();
  const env = options.env ?? process.env;
  const rules = options.rules ?? loadRules();
  const approver = approverOrError(rules, env);
  if (approver.error) return approver;
  if (!body?.signature || !body?.message) {
    return httpError(400, 'invalid_signature', 'A Ledger signature is required. Nothing was paid.');
  }

  const found = await readPendingRecord(id);
  if (found.error === 'invalid') return httpError(400, 'invalid', 'That approval id is not valid.');
  if (!found.missing && !found.pending.sample && found.pending.status === 'paying') {
    return {
      status: 202,
      body: {
        ok: true,
        inFlight: true,
        phase: found.pending.paymentPhase || 'broadcasting',
        note: 'This approval is already being paid. Nothing else was started.',
      },
    };
  }

  const used = await readUsedApprovalSignatures();
  let presented;
  try {
    presented = normalizeSignature(body.signature).toLowerCase();
  } catch {
    return httpError(400, 'invalid_signature', 'The Ledger signature could not be verified.');
  }
  if (used.some((item) => String(item).toLowerCase() === presented)) {
    return httpError(409, 'replay', 'That Ledger approval was already used.');
  }
  if (found.missing || found.pending.sample) return missingPurchase();
  const denied = declineReason(found.pending.merchant, rules);
  if (denied) return httpError(409, 'decline_only', denied);
  const channelBlock = await channelBlockFor(found.pending, env, options);
  if (channelBlock) return channelBlock;

  const verdict = judgeApproval({
    pending: found.pending,
    challenge: found.pending.approvalChallenge,
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

  let spent;
  try {
    spent = await spentForApproval(found.pending, options);
  } catch (error) {
    return httpError(409, 'channel_unread', error.message || 'The payment channel could not be read. Nothing was paid.');
  }
  const hard = checkApprovalHardRules({
    merchant: found.pending.merchant,
    amount: found.pending.amount,
    spent,
    at: new Date(nowMs).toISOString(),
  }, rules);
  if (hard.decision !== 'allow') {
    return httpError(409, hard.reason, `${plainReason(hard.reason)} A Ledger signature cannot override that.`);
  }
  if ((await readFrozen()).frozen) {
    return httpError(409, 'agent frozen', 'The agent is frozen. Unfreeze it before this quote can be paid. Nothing was signed.');
  }

  const payer = options.payApproved ?? paySavedQuote;
  if (payer === paySavedQuote && (!env.AGENT_PRIVATE_KEY?.trim() || !env.TEAM_NAME?.trim())) {
    return httpError(
      409,
      'not_configured',
      'Add AGENT_PRIVATE_KEY and TEAM_NAME to .env before an approved purchase can be paid.',
    );
  }

  const claim = await claimApprovalSignature(id, verdict.signature, nowMs, { amount: found.pending.amount });
  if (claim.inFlight) {
    return {
      status: 202,
      body: {
        ok: true,
        inFlight: true,
        phase: claim.phase || 'broadcasting',
        note: 'This approval is already being paid. Nothing else was started.',
      },
    };
  }
  if (claim.error === 'replay') return httpError(409, 'replay', 'That Ledger approval was already used.');
  if (claim.error === 'over_budget') {
    return httpError(409, 'over budget', `${plainReason('over budget')} A Ledger signature cannot override that.`);
  }
  if (claim.missing || claim.error) return missingPurchase();

  let chain = null;
  if (walletConfigured(env) || options.channelState) {
    try {
      chain = await readSpendChannel(env, options);
    } catch {
      chain = null;
    }
  }
  const spentBasis = chain ? higherSpent(claim.spent, chain.redeemed) : claim.spent;

  try {
    const payment = await payer({
      ...found.pending,
      approver: verdict.signer,
      reservationId: claim.reservationId,
      spentBasis,
    }, { env, rules, chain });
    await completeApprovedPurchase(id);
    return {
      status: 200,
      body: {
        ok: true,
        payment,
        note: 'Approved on a Ledger and paid once through AP4M x402.',
      },
    };
  } catch (error) {
    if (error?.payment) {
      await completeApprovedPurchase(id);
      return {
        status: 200,
        body: {
          ok: true,
          payment: error.payment,
          note: 'Approved on a Ledger. Settlement is still processing.',
        },
      };
    }
    await releaseApprovalPayment(id);
    let challenge = null;
    try {
      const fresh = await createApprovalChallenge(id, options);
      if (fresh.status === 200) challenge = fresh.body;
    } catch {
      challenge = null;
    }
    return {
      status: 502,
      error: 'payment_failed',
      message: publicPaymentError(error),
      challenge,
    };
  }
}
