import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { ethers } from 'ethers';
import { checkApprovalHardRules, checkRules, loadRules } from '../agent/rules.js';
import { HEIST_INJECTION } from '../shared/catalog.js';
import { requestQuote } from '../agent/quote.js';
import { createQuoteApp } from './index.js';
import { paymentRequiredHeader, UNLISTED_MERCHANT } from './quotes.js';

const rules = loadRules();
const payout = rules.allowedMerchants[0];
const channelId = `0x${'ab'.repeat(32)}`;

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

test('demo quotes are 402s the rules block before any payment', async () => {
  const server = await listen(createQuoteApp({ payout }));
  const { port } = server.address();
  try {
    const overUrl = `http://127.0.0.1:${port}/demo/over-cap`;
    const over = await requestQuote(overUrl, channelId);
    assert.equal(over.amount, '8');
    assert.equal(over.merchant.toLowerCase(), payout);
    assert.equal(over.resourceUrl, overUrl);
    assert.equal(checkRules({ merchant: over.merchant, amount: over.amount, spent: '0' }, rules).reason, 'over per-purchase cap');

    const sixUrl = `http://127.0.0.1:${port}/demo/over-cap-6`;
    const six = await requestQuote(sixUrl, channelId);
    assert.equal(six.amount, '6');
    assert.equal(checkRules({ merchant: six.merchant, amount: six.amount, spent: '0' }, rules).reason, 'over per-purchase cap');

    const outsideUrl = `http://127.0.0.1:${port}/demo/unlisted`;
    const outside = await requestQuote(outsideUrl, channelId);
    assert.equal(outside.amount, '1');
    assert.equal(outside.merchant.toLowerCase(), UNLISTED_MERCHANT);
    assert.equal(checkRules({ merchant: outside.merchant, amount: outside.amount, spent: '0' }, rules).reason, 'merchant not allowed');

    const heistUrl = `http://127.0.0.1:${port}/demo/heist`;
    const heist = await requestQuote(heistUrl, channelId);
    assert.equal(heist.amount, '50');
    assert.equal(heist.merchant.toLowerCase(), UNLISTED_MERCHANT);
    assert.match(heist.description, new RegExp(HEIST_INJECTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(checkRules({ merchant: heist.merchant, amount: heist.amount, spent: '0' }, rules).reason, 'merchant not allowed');
    assert.equal(checkApprovalHardRules({ merchant: heist.merchant, amount: heist.amount, spent: '0' }, rules).reason, 'merchant not allowed');

    const signed = await fetch(overUrl, {
      headers: {
        'X-AP4M-CHANNEL-ID': channelId,
        'PAYMENT-SIGNATURE': 'not-a-voucher',
      },
    });
    assert.equal(signed.status, 402);
    const body = await signed.json();
    assert.equal(body.error, 'payment_required');
    assert.equal(body.resource, undefined);
  } finally {
    await close(server);
  }
});

test('GET /resource is forwarded to the x402 merchant', async () => {
  const resourceUrl = 'http://127.0.0.1:9/resource';
  const header = paymentRequiredHeader({
    url: resourceUrl,
    description: 'Morning market brief',
    amount: ethers.parseUnits('1', 18).toString(),
    payTo: payout,
    channelId,
  });
  let seenUrl = '';
  let sawPayment = false;
  const resourceServer = createServer((req, res) => {
    seenUrl = req.url;
    sawPayment = Boolean(req.headers['payment-signature']);
    res.writeHead(402, {
      'Content-Type': 'application/json',
      'PAYMENT-REQUIRED': header,
    });
    res.end(JSON.stringify({ x402Version: 2, error: 'payment_required' }));
  });
  const server = await listen(createQuoteApp({ payout, resourceServer }));
  const { port } = server.address();
  try {
    const quote = await requestQuote(`http://127.0.0.1:${port}/resource`, channelId);
    assert.equal(seenUrl, '/resource');
    assert.equal(sawPayment, false);
    assert.equal(quote.amount, '1');
    assert.equal(checkRules({ merchant: quote.merchant, amount: quote.amount, spent: '0' }, rules).decision, 'allow');
  } finally {
    await close(server);
  }
});

test('a resource without a valid agent mandate is 403 and is not forwarded', async () => {
  let forwarded = false;
  const resourceServer = createServer((req, res) => {
    forwarded = true;
    res.writeHead(402);
    res.end();
  });
  const server = await listen(createQuoteApp({
    payout,
    resourceServer,
    enforceMandate: async () => ({ ok: false, reason: 'The merchant requires a Ledger-signed agent mandate.' }),
  }));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/resource`);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, 'mandate_required');
    assert.equal(forwarded, false);
  } finally {
    await close(server);
  }
});
