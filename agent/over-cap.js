/**
 * Over-cap demo.
 *
 * The rules half reads a real HTTP 402 for 6 RLUSD and runs finishQuote.
 * pay() is not called, so nothing is signed.
 *
 * The contract half only reports a simulation that already happened:
 * scripts/test-channel-cap.js writes that evidence. This module never
 * invents a revert, a block number, or a redeemed balance.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finishQuote } from './agent.js';
import { requestQuote } from './quote.js';
import { formatRlusd, loadRules } from './rules.js';

export const OVER_CAP_RLUSD = '6';

export async function demonstrateOverCap({
  resourceUrl,
  readQuote = requestQuote,
  rules = loadRules(),
  spent = '0',
  finish = finishQuote,
  channelId = `0x${'11'.repeat(32)}`,
} = {}) {
  if (!resourceUrl) throw new Error('Over-cap demo needs the quote URL.');
  let signed = false;
  const quote = await readQuote(resourceUrl, channelId);
  const result = await finish({
    task: 'Try an over-cap purchase',
    resourceUrl,
    quote,
    channelId,
    rules,
    spent,
    pay: async () => {
      signed = true;
      throw new Error('The over-cap demo must not sign a voucher.');
    },
  });
  const cap = formatRlusd(rules.maxPerPurchase);
  if (signed || result.decision === 'allow' || result.txHash) {
    throw new Error('Over-cap demo signed a voucher. That result is not a rules rejection.');
  }
  if (quote.amount !== OVER_CAP_RLUSD || result.reason !== 'over per-purchase cap') {
    throw new Error(`Expected a ${OVER_CAP_RLUSD} RLUSD quote to fail the ${cap} RLUSD cap before signing.`);
  }
  return {
    ok: true,
    signed: false,
    amount: result.amount,
    cap,
    reason: result.reason,
    merchant: result.merchant,
    line: result.line,
    decision: result.decision,
  };
}

function evidenceFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith('cap-test-') && name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

/** Validate one saved simulation. Incomplete files are not shown as a pass. */
export function describeContractCap(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return {
      ran: false,
      reason: 'The contract cap check has not been run. No on-chain result is shown.',
    };
  }
  const revert = typeof evidence.rejectionData === 'string' && /^0x[0-9a-f]{8,}$/i.test(evidence.rejectionData);
  const same = evidence.redeemedBefore != null
    && String(evidence.redeemedBefore) === String(evidence.redeemedAfter);
  const simulated = String(evidence.method || '').includes('eth_call');
  const balances = evidence.merchantBalanceBefore != null
    && String(evidence.merchantBalanceBefore) === String(evidence.merchantBalanceAfter);
  if (!revert || !same || !simulated || !balances) {
    return {
      ran: false,
      reason: 'Saved cap evidence is not a clean simulation, so it is not shown as a contract rejection.',
    };
  }
  return {
    ran: true,
    method: evidence.method,
    channelId: evidence.channelId,
    blockNumber: evidence.blockNumber,
    rejectionData: evidence.rejectionData,
    redeemedBefore: String(evidence.redeemedBefore),
    redeemedAfter: String(evidence.redeemedAfter),
    capRlusd: evidence.capRlusd ?? null,
    rejectedCumulativeRlusd: evidence.rejectedCumulativeRlusd ?? null,
  };
}

export function latestContractCap(dir = join(fileURLToPath(new URL('.', import.meta.url)), 'receipts')) {
  const names = evidenceFiles(dir);
  if (!names.length) return describeContractCap(null);
  try {
    const evidence = JSON.parse(readFileSync(join(dir, names.at(-1)), 'utf8'));
    return describeContractCap(evidence);
  } catch {
    return {
      ran: false,
      reason: 'Saved cap evidence could not be read, so no contract result is shown.',
    };
  }
}
