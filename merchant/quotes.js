/**
 * HTTP 402 challenges that the agent can read and the rules can reject.
 * These quotes are not redeemed. The paid sale is the x402 merchant at GET /resource.
 */

import { buildX402PaymentRequired, encodeX402PaymentRequired } from '@ap4m/sdk';

export const UNLISTED_MERCHANT = '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad';

const TESTNET = 'eip155:1449000';
const RLUSD_ASSET = '0x27b57a9D0b8d24EB97259c4E2279e45255e016f3';
const LEDGER = '0xcAB42800A5ECF0D253Fa2581Bb3334B4DAEfaE91';
const PLACEHOLDER_CHANNEL = `0x${'11'.repeat(32)}`;

export function paymentRequiredHeader({ url, description, amount, payTo, channelId }) {
  const id = /^0x[0-9a-f]{64}$/.test(channelId ?? '') ? channelId : PLACEHOLDER_CHANNEL;
  return encodeX402PaymentRequired(buildX402PaymentRequired(
    { url, description },
    [{
      scheme: 'batch-settlement',
      network: TESTNET,
      amount,
      asset: RLUSD_ASSET,
      payTo,
      maxTimeoutSeconds: 60,
      extra: {
        bindingVersion: '1',
        ledger: LEDGER,
        pricingMode: 'fixed',
        channelId: id,
        acceptedCumulativeAmount: '0',
      },
    }],
  ));
}

/** Reply 402 with a payment challenge. A signature on these routes is ignored. */
export function sendPaymentRequired(res, fields) {
  res.status(402);
  res.set('Cache-Control', 'no-store, private');
  res.set('PAYMENT-REQUIRED', paymentRequiredHeader(fields));
  res.json({ x402Version: 2, error: 'payment_required' });
}
