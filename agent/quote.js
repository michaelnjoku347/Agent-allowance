/**
 * Read a merchant's HTTP 402 challenge without paying it.
 *
 * The price and payout live in the PAYMENT-REQUIRED header (base64 JSON).
 * The body only says that payment is required. Nothing here signs a voucher.
 */

import { decodeX402PaymentRequired } from '@ap4m/sdk';
import { ethers } from 'ethers';
import { canonicalAddress, formatRlusd, toUnits } from './rules.js';

const TESTNET = 'eip155:1449000';

/**
 * @param {string} header  PAYMENT-REQUIRED header value
 * @returns {{
 *   amount: string,
 *   amountWei: string,
 *   merchant: string,
 *   asset: string,
 *   network: string,
 *   resourceUrl: string,
 *   description: string,
 * }}
 */
export function quoteFromPaymentRequired(header) {
  if (!header || typeof header !== 'string') {
    throw new Error('Merchant 402 response is missing the PAYMENT-REQUIRED header.');
  }
  const required = decodeX402PaymentRequired(header);
  const accepted = required.accepts[0];
  if (accepted.network !== TESTNET) {
    throw new Error(`Refusing a quote that is not XRPL EVM Testnet (${TESTNET}). Got ${accepted.network}.`);
  }
  // The header amount is wei. Format with ethers, then back through the same
  // 18-decimal helper the rules use, so the price the rules see is the price
  // we later store.
  const amount = formatRlusd(toUnits(ethers.formatUnits(accepted.amount, 18)));
  return {
    amount,
    amountWei: accepted.amount,
    merchant: accepted.payTo,
    asset: accepted.asset,
    network: accepted.network,
    resourceUrl: required.resource.url,
    description: required.resource.description ?? '',
  };
}

/**
 * Ask the merchant for the resource and stop at the 402.
 * Pass the open Channel id; the merchant prices that Channel.
 */
export async function requestQuote(resourceUrl, channelId, fetchImpl = fetch) {
  if (!/^0x[0-9a-f]{64}$/.test(channelId)) {
    throw new Error('A Channel id (0x and 64 hex characters) is required to read a quote.');
  }
  const response = await fetchImpl(resourceUrl, {
    method: 'GET',
    headers: { 'X-AP4M-CHANNEL-ID': channelId },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (response.status !== 402) {
    const detail = text.slice(0, 180);
    throw new Error(`Merchant must return HTTP 402 before a payment (got ${response.status}). ${detail}`);
  }
  return quoteFromPaymentRequired(response.headers.get('payment-required'));
}

/**
 * A direct-payment quote. The amount is RLUSD, and the merchant is the
 * Channel payout the voucher would settle to. Nothing here signs or pays.
 */
export function buildPurchaseQuote({ amount = '1', merchant, task = '' } = {}) {
  const units = toUnits(amount);
  const price = formatRlusd(units);
  return {
    amount: price,
    amountWei: units.toString(),
    merchant: canonicalAddress(merchant),
    task: String(task ?? ''),
    description: `Direct AP4M payment of ${price} RLUSD.`,
  };
}

/** Operation names are how the SDK tells two purchases apart. */
export function operationName(task, now = Date.now()) {
  const slug = String(task ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'purchase'}-${now.toString(36)}`.slice(0, 64);
}
