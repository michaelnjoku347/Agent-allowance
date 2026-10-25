/**
 * Market-data merchant.
 *
 * GET /resource is a fixed-price AP4M x402 sale (the kit's createX402Merchant).
 * It answers HTTP 402 with payment requirements. When the agent pays with a
 * signed voucher, the kit redeems it and this process returns the market data.
 * The payout address is MERCHANT_PAYOUT_ADDRESS.
 *
 * GET /demo/over-cap, GET /demo/unlisted, and GET /demo/heist only quote a price.
 * They never redeem a voucher. The unlisted and heist quotes pay the decline-only desk.
 * The 8 RLUSD history sale is a second createX402Merchant on HISTORY_PORT.
 * Approving that pending row redeems it.
 *
 * Listens on MERCHANT_PORT (default 4308), not PORT. PORT is the allowance API.
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createX402Merchant, loadX402Context } from '../agent/ap4m-x402.mjs';
import { HEIST_INJECTION, historyPort, historyResourceUrl } from '../shared/catalog.js';
import { sendPaymentRequired, UNLISTED_MERCHANT } from './quotes.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(rootDir, '.env') });

export { UNLISTED_MERCHANT };

function requestedUrl(req) {
  const host = req.headers.host;
  if (!host || /[\s/]/.test(host)) return null;
  return `http://${host}${req.path}`;
}

/**
 * Express front door. resourceServer is the kit merchant's HTTP server.
 * Requests for /resource are handed to it unchanged so the voucher flow stays
 * the kit's. Pass no server to serve the demo quotes alone.
 */
export function createQuoteApp({ payout, resourceServer = null } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      selling: '/resource',
      payout: payout ?? null,
      quotes: ['/demo/over-cap', '/demo/over-cap-6', '/demo/unlisted', '/demo/heist'],
    });
  });

  app.get('/resource', (req, res) => {
    if (!resourceServer) {
      res.status(503).json({ error: 'market_data_unavailable' });
      return;
    }
    resourceServer.emit('request', req, res);
  });

  function quoteOverCap(req, res, amount, description) {
    const url = requestedUrl(req);
    if (!payout || !url) {
      res.status(500).json({ error: 'Set MERCHANT_PAYOUT_ADDRESS before quoting the over-cap purchase.' });
      return;
    }
    sendPaymentRequired(res, {
      url,
      description,
      amount,
      payTo: payout,
      channelId: req.get('x-ap4m-channel-id'),
    });
  }

  app.get('/demo/over-cap', (req, res) => {
    quoteOverCap(req, res, ethers.parseUnits('8', 18).toString(), 'Extended market history');
  });

  app.get('/demo/over-cap-6', (req, res) => {
    quoteOverCap(req, res, ethers.parseUnits('6', 18).toString(), 'Quote above the 5 RLUSD per-purchase cap');
  });

  app.get('/demo/heist', (req, res) => {
    const url = requestedUrl(req);
    if (!url) {
      res.status(500).json({ error: 'Missing host.' });
      return;
    }
    sendPaymentRequired(res, {
      url,
      description: `Premium data pack. ${HEIST_INJECTION}`,
      amount: ethers.parseUnits('50', 18).toString(),
      payTo: UNLISTED_MERCHANT,
      channelId: req.get('x-ap4m-channel-id'),
    });
  });

  app.get('/demo/unlisted', (req, res) => {
    const url = requestedUrl(req);
    if (!url) {
      res.status(500).json({ error: 'Missing host.' });
      return;
    }
    sendPaymentRequired(res, {
      url,
      description: 'Quote from a desk outside the allowance',
      amount: ethers.parseUnits('1', 18).toString(),
      payTo: UNLISTED_MERCHANT,
      channelId: req.get('x-ap4m-channel-id'),
    });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const payout = process.env.MERCHANT_PAYOUT_ADDRESS?.trim() ?? '';
  const merchantId = process.env.MERCHANT_ID?.trim() ?? '';
  const submitterKey = process.env.MERCHANT_SUBMITTER_KEY?.trim() ?? '';
  if (!payout || !merchantId || !submitterKey) {
    fail('Set MERCHANT_PAYOUT_ADDRESS, MERCHANT_ID, and MERCHANT_SUBMITTER_KEY in .env.');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(payout)) fail('MERCHANT_PAYOUT_ADDRESS must be an 0x address.');
  if (!/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(merchantId)) {
    fail('MERCHANT_ID must be the 0x id from the participant portal.');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(submitterKey)) {
    fail('MERCHANT_SUBMITTER_KEY must be a 32-byte hex key starting with 0x.');
  }

  const port = Number(process.env.MERCHANT_PORT || 4308);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('MERCHANT_PORT must be a port number.');
  const resourceUrl = process.env.RESOURCE_URL?.trim() || `http://127.0.0.1:${port}/resource`;
  let published;
  try {
    published = new URL(resourceUrl);
  } catch {
    fail('RESOURCE_URL must be the merchant /resource URL.');
  }
  if (published.pathname !== '/resource' || published.search || published.username || published.password) {
    fail('RESOURCE_URL must be a canonical /resource URL with no query or password.');
  }
  if (['127.0.0.1', 'localhost'].includes(published.hostname)) {
    const publishedPort = Number(published.port || (published.protocol === 'https:' ? 443 : 80));
    if (publishedPort !== port) {
      fail(`RESOURCE_URL uses port ${publishedPort}, but the merchant listens on MERCHANT_PORT ${port}.`);
    }
  }

  const price = process.env.PRICE_RLUSD?.trim() || '1';
  const apiUrl = (process.env.AP4M_API_URL?.trim() || 'https://hackathon.ap4m.build').replace(/\/$/, '');
  const context = await loadX402Context(apiUrl);
  const configResponse = await fetch(`${apiUrl}/public/config`, { signal: AbortSignal.timeout(30_000) });
  const config = await configResponse.json();
  if (!configResponse.ok) fail(`Could not read AP4M network config (${configResponse.status}).`);
  const provider = new ethers.JsonRpcProvider(process.env.AP4M_RPC_URL || config.network.rpcUrl);
  const submitter = new ethers.Wallet(submitterKey, provider);
  const merchant = createX402Merchant({
    context,
    provider,
    submitter,
    stateDirectory: process.env.MERCHANT_STATE_DIRECTORY || join(rootDir, 'merchant/state'),
    resourceUrl,
    merchantParticipantId: merchantId,
    payout,
    amount: ethers.parseUnits(price, 18).toString(),
    content: {
      type: 'market-data',
      pair: 'XRP/RLUSD',
      message: 'Morning market brief',
      servedAt: 'purchase',
    },
  });

  const historyUrl = historyResourceUrl();
  const historyListenPort = historyPort();
  if (historyListenPort === port) fail('HISTORY_PORT must be different from MERCHANT_PORT.');
  let historyPublished;
  try {
    historyPublished = new URL(historyUrl);
  } catch {
    fail('HISTORY_RESOURCE_URL must be the history merchant /resource URL.');
  }
  if (historyPublished.pathname !== '/resource') fail('HISTORY_RESOURCE_URL must end in /resource.');
  const history = createX402Merchant({
    context,
    provider,
    submitter,
    stateDirectory: process.env.HISTORY_STATE_DIRECTORY || join(rootDir, 'merchant/state-history'),
    resourceUrl: historyUrl,
    merchantParticipantId: merchantId,
    payout,
    amount: ethers.parseUnits('8', 18).toString(),
    content: {
      type: 'market-data',
      pair: 'XRP/RLUSD',
      message: 'Extended market history',
      servedAt: 'purchase',
    },
  });

  const app = createQuoteApp({ payout, resourceServer: merchant.server });
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Merchant selling ${resourceUrl} for ${price} RLUSD`);
    console.log(`History resource ${historyUrl} for 8 RLUSD`);
    console.log(`Payout ${payout}`);
    console.log(`Decline-only quote at http://127.0.0.1:${port}/demo/unlisted`);
    console.log(`Heist quote at http://127.0.0.1:${port}/demo/heist`);
  });
  const historyServer = history.server.listen(historyListenPort, '127.0.0.1');

  server.on('error', (error) => {
    console.error(error.message);
    history.close().finally(() => merchant.close().finally(() => process.exit(1)));
  });
  historyServer.on('error', (error) => {
    console.error(error.message);
    server.close();
    history.close().finally(() => merchant.close().finally(() => process.exit(1)));
  });

  const shutdown = () => {
    server.close();
    historyServer.close();
    history.close().finally(() => merchant.close().finally(() => process.exit(0)));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
