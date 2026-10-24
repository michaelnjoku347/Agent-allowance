import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { buildX402PaymentRequired, encodeX402PaymentRequired } from '@ap4m/sdk';
import { checkRules, loadRules } from './rules.js';
import { operationName, quoteFromPaymentRequired, requestQuote } from './quote.js';

const rules = loadRules();
const channelId = `0x${'ab'.repeat(32)}`;

function challenge({ amount, payTo }) {
  return encodeX402PaymentRequired(buildX402PaymentRequired(
    {
      url: 'http://127.0.0.1:4308/resource',
      description: 'Morning weather brief',
    },
    [{
      scheme: 'batch-settlement',
      network: 'eip155:1449000',
      amount,
      asset: '0x27b57a9D0b8d24EB97259c4E2279e45255e016f3',
      payTo,
      maxTimeoutSeconds: 60,
      extra: {
        bindingVersion: '1',
        ledger: '0xcAB42800A5ECF0D253Fa2581Bb3334B4DAEfaE91',
        pricingMode: 'fixed',
        channelId,
        acceptedCumulativeAmount: '0',
      },
    }],
  ));
}

test('reads the price and payout out of a 402 PAYMENT-REQUIRED header', () => {
  const header = challenge({
    amount: '2500000000000000000',
    payTo: rules.allowedMerchants[0],
  });
  const quote = quoteFromPaymentRequired(header);
  assert.equal(quote.amount, '2.5');
  assert.equal(quote.merchant.toLowerCase(), rules.allowedMerchants[0]);
  assert.equal(quote.network, 'eip155:1449000');
  assert.equal(quote.description, 'Morning weather brief');
  assert.equal(checkRules({
    merchant: quote.merchant,
    amount: quote.amount,
    spent: '0',
  }, rules).decision, 'allow');
});

test('requestQuote stops at HTTP 402 and does not send a payment signature', async () => {
  const header = challenge({
    amount: '1000000000000000000',
    payTo: rules.allowedMerchants[0],
  });
  let sawPayment = false;
  const server = createServer((req, res) => {
    sawPayment = Boolean(req.headers['payment-signature']);
    assert.equal(req.headers['x-ap4m-channel-id'], channelId);
    res.writeHead(402, {
      'Content-Type': 'application/json',
      'PAYMENT-REQUIRED': header,
    });
    res.end(JSON.stringify({ x402Version: 2, error: 'payment_required' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const quote = await requestQuote(`http://127.0.0.1:${port}/resource`, channelId);
    assert.equal(quote.amount, '1');
    assert.equal(sawPayment, false);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('operation names fit the AP4M purchase format', () => {
  const name = operationName('Buy the morning weather brief!', 1_700_000_000_000);
  assert.match(name, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.match(name, /^buy-the-morning-weather-brief-/);
});
