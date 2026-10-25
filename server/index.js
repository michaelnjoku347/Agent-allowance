/**
 * Local API for the Agent Allowance dashboard.
 *
 *   GET  /api/status          budget, spent, remaining, rules
 *   GET  /api/payments        tx hash, merchant, amount, status
 *   GET  /api/pending         purchases the agent refused to pay
 *   GET  /api/events          Server-Sent Events: store changes and the live payment stage
 *   POST /api/approve/:id/challenge   EIP-712 payload for the Ledger
 *   POST /api/approve/:id             verify the device signature and pay once
 *   POST /api/run-agent       start agent/agent.js for the live demo
 *   GET  /api/health          API, rules, and merchant reachability in plain words
 *   POST /api/allowance/preview   what a change would do, and whether it needs the Ledger
 *   POST /api/allowance/lower     apply a change that only lowers limits
 *
 * Data lives in server/data/store.json. Bind to localhost only. Every route
 * is rate limited, every :id and body is shape-checked, and an unreadable
 * rules file refuses to report or pay rather than guessing.
 */

import dotenv from 'dotenv';
import express from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { channelWarning, higherSpent, peekChannel, startChannelRefresh } from '../agent/chain-spend.js';
import { demonstrateOverCap, latestContractCap } from '../agent/over-cap.js';
import { describeAllowanceChange, formatRlusd, loadRules, presentRules, setApproverAddress, toUnits, updateAllowance } from '../agent/rules.js';
import { createSandboxes, paymentsMode, publicDemoEnabled, simulatedAllowanceRaise, simulatedRun } from './public-demo.js';
import { createQuoteApp } from '../merchant/index.js';
import { acceptAllowanceChange, createAllowanceChallenge } from './allowance.js';
import { answerEve, confirmationSummary, createConfirmations, executeConfirmed, loadEveContext, safeUi } from './eve.js';
import { backupChallengeEnv, devSignerEnabled, simulateLedgerApproval } from './backup-demo.js';
import { anchorDecision } from '../agent/anchor.js';
import { acceptLedgerApproval, createApprovalChallenge } from './ledger.js';
import { acceptMandate, createMandateChallenge } from './mandate.js';
import { declinePending, listAudit, listPayments, listPending, readFrozen, readPendingRecord, readStore, recordSetupDecision, saveAnchor, saveProfile, setFreeze, setUseCase, spentRlusd, summarize } from './store.js';
import { readBedrockSettings } from './bedrock.js';
import { optionalKeyNotices } from '../scripts/start-lib.js';
import { freezeAgent } from './freeze-channel.js';
import { runHeist } from './heist.js';
import { runRogueDemo } from './rogue-demo.js';
import { createStoreEvents } from './events.js';
import {
  LIMITS,
  bodyErrors,
  createRateLimiter,
  logError,
  optionalString,
  parseAgentName,
  parseAllowancePatch,
  rateLimitSettings,
  requireId,
  requireJsonBody,
  securityHeaders,
} from './guardrails.js';
import { merchantOrigin } from '../shared/catalog.js';

/**
 * Public hostnames a hosted deploy answers on: PUBLIC_HOSTNAME (comma list),
 * Render's RENDER_EXTERNAL_HOSTNAME, or Fly's <app>.fly.dev. Empty locally.
 */
export function publicHosts(env = process.env) {
  const hosts = String(env.PUBLIC_HOSTNAME ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (env.RENDER_EXTERNAL_HOSTNAME) hosts.push(String(env.RENDER_EXTERNAL_HOSTNAME).trim().toLowerCase());
  if (env.FLY_APP_NAME) hosts.push(`${String(env.FLY_APP_NAME).trim().toLowerCase()}.fly.dev`);
  return [...new Set(hosts.filter((host) => /^[a-z0-9.-]{1,253}$/.test(host)))];
}

export function dashboardOrigins(env = process.env) {
  const origins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
  for (const host of publicHosts(env)) origins.push(`https://${host}`);
  const port = String(env.PORT || '8787').replace(/[^\d]/g, '') || '8787';
  for (const host of ['127.0.0.1', 'localhost']) {
    const origin = `http://${host}:${port}`;
    if (!origins.includes(origin)) origins.push(origin);
  }
  const extra = String(env.DASHBOARD_ORIGIN ?? '');
  for (const origin of extra.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

export function fromDashboard(req, env = process.env) {
  return dashboardOrigins(env).includes(String(req.get('origin') ?? ''));
}

/** DNS rebinding sends a foreign Host with a localhost Origin. Only these hosts are answered. */
export function allowedHost(host, env = process.env) {
  const text = String(host ?? '').trim().toLowerCase();
  if (/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(text)) return true;
  const name = text.replace(/:\d{1,5}$/, '');
  return publicHosts(env).includes(name);
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(rootDir, '.env') });

let agentChild = null;
const confirmations = createConfirmations();

function stopAgentProcess() {
  if (agentChild && agentChild.exitCode === null && !agentChild.killed) {
    agentChild.kill('SIGTERM');
  }
}

/** Rules that cannot be read mean nothing may be reported as safe to spend. */
function rulesOrRefuse(res) {
  try {
    return loadRules();
  } catch (error) {
    logError(error);
    res.status(503).json({
      error: 'rules_unavailable',
      message: 'The allowance rules could not be read, so the agent cannot pay. Check agent/rules.json.',
    });
    return null;
  }
}

async function probe(url, timeoutMs = 1500, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.status < 500 ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export function createApp(options = {}) {
  const app = express();
  const limits = options.rateLimits ?? rateLimitSettings(options.env ?? process.env);
  const readLimiter = createRateLimiter({ bucket: 'read', max: limits.reads, now: options.clock });
  const writeLimiter = createRateLimiter({ bucket: 'write', max: limits.writes, now: options.clock });
  const eveLimiter = createRateLimiter({ bucket: 'eve', max: limits.eve, now: options.clock });
  const env0 = options.env ?? process.env;
  const publicDemo = publicDemoEnabled(env0);
  app.disable('x-powered-by');
  // Behind a hosting proxy the client address arrives in X-Forwarded-For; rate limits need it.
  app.set('trust proxy', publicDemo || env0.TRUST_PROXY === '1' ? 1 : false);
  app.use(securityHeaders({ dashboard: process.env.SERVE_DASHBOARD === '1' }));
  app.use('/api', (req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? readLimiter : writeLimiter)(req, res, next));
  app.use('/api', requireJsonBody);
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use(bodyErrors);
  app.use('/api', (req, res, next) => {
    if (!allowedHost(req.headers.host, env0)) {
      return res.status(403).json({ error: 'This API only answers on localhost or its configured public hostname.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !fromDashboard(req, env0)) {
      return res.status(403).json({ error: 'Open the dashboard to change the allowance.' });
    }
    next();
  });

  // Hosted demo: every visitor works in a private copy of the rules and the store.
  const sandboxes = options.sandboxes ?? (publicDemo ? createSandboxes() : null);
  if (sandboxes) app.use('/api', sandboxes.middleware);

  app.get('/api/health', async (req, res) => {
    let rules = 'ok';
    try {
      loadRules();
    } catch {
      rules = 'unreadable';
    }
    const merchantConfigured = Boolean(process.env.RESOURCE_URL?.trim());
    const merchantUrl = options.merchantHealthUrl
      ?? `${merchantConfigured ? new URL(process.env.RESOURCE_URL).origin : merchantOrigin(process.env)}/health`;
    const merchant = await probe(merchantUrl, 1500, options.fetch);
    const ready = rules === 'ok';
    res.status(ready ? 200 : 503).json({
      ok: ready,
      api: 'up',
      rules,
      merchant,
      merchantConfigured,
      agentReady: Boolean(process.env.AGENT_PRIVATE_KEY?.trim() && process.env.TEAM_NAME?.trim() && merchantConfigured),
      message: rules !== 'ok'
        ? 'The allowance rules could not be read. Payments are refused until agent/rules.json is fixed.'
        : merchant === 'down' && merchantConfigured
          ? 'The merchant is not answering. The agent cannot buy until it is running (npm run merchant).'
          : merchantConfigured
            ? 'Everything is answering.'
            : 'The allowance is up. No merchant is configured yet, so the dashboard shows example rows.',
    });
  });

  app.get('/api/status', async (req, res, next) => {
    try {
      const rules = rulesOrRefuse(res);
      if (!rules) return;
      const summary = summarize(await readStore(), rules);
      const localSpent = await spentRlusd();
      let chain = null;
      let chainUnavailable = false;
      if (options.channelState) {
        try {
          chain = await options.channelState();
        } catch {
          chain = null;
          chainUnavailable = true;
        }
      } else {
        const peeked = peekChannel();
        chain = peeked.chain;
        chainUnavailable = peeked.unavailable;
      }
      const spent = higherSpent(localSpent, chain?.redeemed);
      const budget = toUnits(summary.budget);
      const spentUnits = toUnits(spent);
      const remaining = budget > spentUnits ? budget - spentUnits : 0n;
      res.json({
        ...summary,
        localSpent,
        spent,
        remaining: formatRlusd(remaining),
        spentRatio: budget === 0n ? 0 : Number((spentUnits * 10_000n) / budget) / 10_000,
        chain,
        chainWarning: channelWarning({ localSpent, budget: summary.budget, chain }),
        chainUnavailable,
        simulatedLedger: devSignerEnabled(),
        bedrockConfigured: readBedrockSettings().configured,
        publicDemo,
        paymentsMode: paymentsMode(env0),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/payments', async (req, res, next) => {
    try {
      res.json(await listPayments());
    } catch (error) {
      next(error);
    }
  });

  const storeEvents = options.storeEvents ?? createStoreEvents();
  // One watcher per sandbox that has an open stream, dropped when its last tab closes.
  const sandboxEvents = new Map();
  function eventsFor(req) {
    if (!req.sandbox) return { events: storeEvents, release: () => {} };
    const id = req.sandbox.id;
    let row = sandboxEvents.get(id);
    if (!row) {
      const storePath = req.sandbox.storePath;
      row = { events: createStoreEvents({ path: () => storePath }), count: 0 };
      sandboxEvents.set(id, row);
    }
    row.count += 1;
    return {
      events: row.events,
      release: () => {
        row.count -= 1;
        if (row.count <= 0) sandboxEvents.delete(id);
      },
    };
  }

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const send = ({ type, data }) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
    };
    const stream = eventsFor(req);
    const unsubscribeEvents = stream.events.subscribe(send);
    const unsubscribe = () => {
      unsubscribeEvents();
      stream.release();
    };
    const heartbeat = setInterval(() => res.write(': ping\n\n'), options.heartbeatMs ?? 15_000);
    heartbeat.unref?.();
    let closed = false;
    const end = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', end);
    res.on('close', end);
  });

  app.get('/api/pending', async (req, res, next) => {
    try {
      res.json(await listPending());
    } catch (error) {
      next(error);
    }
  });

  const ledgerOptions = {
    now: options.now,
    challengeTtlSeconds: options.challengeTtlSeconds,
    payApproved: options.payApproved,
    env: options.env,
    rules: options.rules,
    spent: options.spent,
    channelState: options.channelState,
  };

  function sendLedger(res, result) {
    if (result.body) return res.status(result.status).json(result.body);
    const payload = { error: result.error, message: result.message };
    if (result.challenge) payload.challenge = result.challenge;
    return res.status(result.status).json(payload);
  }

  app.post('/api/approve/:id/challenge', requireId, async (req, res, next) => {
    try {
      const env = backupChallengeEnv(ledgerOptions.env ?? process.env);
      sendLedger(res, await createApprovalChallenge(req.params.id, { ...ledgerOptions, env }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/approve/:id', requireId, async (req, res, next) => {
    try {
      sendLedger(res, await acceptLedgerApproval(req.params.id, req.body ?? {}, ledgerOptions));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/approve/:id/progress', requireId, async (req, res, next) => {
    try {
      const found = await readPendingRecord(req.params.id);
      if (found.error === 'invalid') return res.status(400).json({ error: 'invalid' });
      if (found.missing) return res.status(404).json({ error: 'missing', inFlight: false });
      const paying = found.pending.status === 'paying';
      res.json({
        ok: true,
        inFlight: paying,
        phase: paying ? (found.pending.paymentPhase || 'signed') : found.pending.status,
        status: found.pending.status,
      });
    } catch (error) {
      next(error);
    }
  });

  // Backup demo only. Off unless ALLOWANCE_DEV_SIGNER=1. Does not broadcast a voucher.
  app.post('/api/demo/simulated-ledger/:id', requireId, async (req, res, next) => {
    try {
      if (!devSignerEnabled()) return res.status(404).json({ error: 'Not found' });
      sendLedger(res, await simulateLedgerApproval(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/mandate/challenge', async (req, res, next) => {
    try {
      const result = await createMandateChallenge({ env: ledgerOptions.env });
      if (result.body) return res.status(result.status).json(result.body);
      return res.status(result.status).json({ error: result.error, message: result.message });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/mandate', async (req, res, next) => {
    try {
      const result = await acceptMandate(req.body ?? {}, { env: ledgerOptions.env });
      if (result.body) return res.status(result.status).json(result.body);
      return res.status(result.status).json({ error: result.error, message: result.message });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/anchor', async (req, res, next) => {
    try {
      const audit = await listAudit();
      const result = await anchorDecision({ row: audit[0], env: ledgerOptions.env ?? process.env });
      const saved = await saveAnchor(result);
      res.json({ ok: true, ...saved });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/allowance/preview', async (req, res, next) => {
    try {
      const parsed = parseAllowancePatch(req.body);
      if (parsed.error) return res.status(400).json({ error: 'invalid', message: parsed.error });
      if (!rulesOrRefuse(res)) return;
      const described = describeAllowanceChange(parsed.patch);
      if (described.error) return res.status(400).json({ error: 'invalid', message: described.error });
      const current = presentRules(described.current);
      const next = {
        budget: formatRlusd(described.next.budget),
        maxPerPurchase: formatRlusd(described.next.maxPerPurchase),
        expiresAt: described.next.expiresAt,
        allowedMerchants: described.next.allowedMerchants,
      };
      res.json({
        ok: true,
        raises: described.raises,
        needsLedger: described.raises,
        current: {
          budget: current.budget,
          maxPerPurchase: current.maxPerPurchase,
          expiresAt: current.expiresAt,
          allowedMerchants: current.allowedMerchants.map((item) => item.address),
        },
        next,
        message: described.raises
          ? 'This raises a limit or adds a merchant. Your Ledger must sign it.'
          : 'This only lowers limits. It applies as soon as you save.',
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/allowance/lower', async (req, res, next) => {
    try {
      const parsed = parseAllowancePatch(req.body);
      if (parsed.error) return res.status(400).json({ error: 'invalid', message: parsed.error });
      if (!rulesOrRefuse(res)) return;
      // updateAllowance refuses any raise without a Ledger flag, and this route never sets it.
      const applied = updateAllowance(parsed.patch);
      if (applied.error) {
        const status = applied.code === 'needs_ledger' ? 403 : 400;
        return res.status(status).json({ error: applied.code || 'invalid', message: applied.error });
      }
      res.json({ ok: true, rules: applied.rules, note: 'Allowance lowered. Nothing was signed or paid.' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/profile', async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const unknown = Object.keys(body).filter((key) => key !== 'agentName' && key !== 'onboarded');
      if (unknown.length) return res.status(400).json({ error: 'invalid', message: `Unknown field: ${unknown[0]}.` });
      let agentName;
      if (body.agentName !== undefined) {
        const parsed = parseAgentName(body.agentName);
        if (parsed.error) return res.status(400).json({ error: 'invalid', message: parsed.error });
        agentName = parsed.value;
      }
      if (body.onboarded !== undefined && typeof body.onboarded !== 'boolean') {
        return res.status(400).json({ error: 'invalid', message: 'onboarded must be true or false.' });
      }
      res.json({ ok: true, profile: await saveProfile({ agentName, onboarded: body.onboarded === true }) });
    } catch (error) {
      next(error);
    }
  });

  // First run only: name the Ledger account that approves exceptions. Once one
  // is set (here or in APPROVER_ADDRESS) this refuses; changing it is a server edit.
  app.post('/api/approver', async (req, res, next) => {
    try {
      const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return res.status(400).json({ error: 'invalid', message: 'That is not an 0x address with 40 hex characters.' });
      }
      if (!rulesOrRefuse(res)) return;
      const result = setApproverAddress(address, undefined, ledgerOptions.env ?? process.env);
      if (result.error) {
        const status = result.code === 'approver_set' ? 409 : 400;
        return res.status(status).json({ error: result.code, message: result.error });
      }
      await recordSetupDecision({ rule: 'approver', reason: `Approver set to ${result.approverAddress}.` });
      res.json({ ok: true, approverAddress: result.approverAddress, note: 'Approver saved. Purchases over the cap and raises now need this Ledger.' });
    } catch (error) {
      next(error);
    }
  });

  // Backup and hosted demos: raise the allowance with the simulated signer, labeled as such.
  app.post('/api/demo/simulated-allowance', async (req, res, next) => {
    try {
      if (!devSignerEnabled()) return res.status(404).json({ error: 'Not found' });
      const parsed = parseAllowancePatch(req.body);
      if (parsed.error) return res.status(400).json({ error: 'invalid', message: parsed.error });
      if (!rulesOrRefuse(res)) return;
      sendLedger(res, await simulatedAllowanceRaise(parsed.patch, { env: ledgerOptions.env ?? process.env }));
    } catch (error) {
      next(error);
    }
  });

  // Hosted demo: start this visitor's sandbox over from the sample rows.
  app.post('/api/demo/reset', (req, res) => {
    if (!sandboxes || !req.sandbox) return res.status(404).json({ error: 'Not found' });
    sandboxes.reset(req.sandbox.id);
    res.json({ ok: true, note: 'Your demo was reset to the sample rows.' });
  });

  app.post('/api/allowance/challenge', async (req, res, next) => {
    try {
      const parsed = parseAllowancePatch(req.body);
      if (parsed.error) return res.status(400).json({ error: 'invalid', message: parsed.error });
      const env = backupChallengeEnv(ledgerOptions.env ?? process.env);
      sendLedger(res, await createAllowanceChallenge(parsed.patch, { ...ledgerOptions, env }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/allowance', async (req, res, next) => {
    try {
      const env = backupChallengeEnv(ledgerOptions.env ?? process.env);
      sendLedger(res, await acceptAllowanceChange(req.body ?? {}, { ...ledgerOptions, env }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/decline/:id', requireId, async (req, res, next) => {
    try {
      const result = await declinePending(req.params.id);
      if (result.error === 'invalid') {
        return res.status(400).json({ error: 'That decline id is not valid.' });
      }
      if (result.missing) {
        return res.status(404).json({ error: 'That purchase is not waiting for approval.' });
      }
      res.json({
        ok: true,
        payment: result.declined,
        note: 'Declined. Nothing was signed or paid.',
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/eve', eveLimiter, async (req, res, next) => {
    try {
      const parsed = optionalString(req.body?.message, LIMITS.eveChars);
      if (parsed.error) return res.status(400).json({ error: 'Send Eve a question as text.' });
      const message = parsed.value;
      const context = await loadEveContext();
      const result = await answerEve(message, context);
      const payload = {
        reply: result.reply,
        bedrock: result.source === 'bedrock',
        source: result.source,
        confirmation: null,
        ui: safeUi(result.ui),
        suggestions: Array.isArray(result.suggestions) ? result.suggestions.slice(0, 4) : [],
      };
      // Freeze and decline are proposals. Nothing runs until the person confirms.
      if (result.action?.type === 'freeze' || result.action?.type === 'decline') {
        const token = confirmations.issue(result.action);
        payload.confirmation = {
          token,
          summary: confirmationSummary(result.action, context),
          action: result.action,
        };
      }
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/eve/confirm', async (req, res, next) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token.slice(0, LIMITS.tokenChars) : '';
      const action = confirmations.take(token);
      if (!action) {
        return res.status(400).json({ error: 'That confirmation expired. Ask Eve again.' });
      }
      const result = await executeConfirmed(action);
      if (result.frozen) stopAgentProcess();
      if (result.error === 'missing') {
        return res.status(404).json({ error: 'That purchase is not waiting for approval.' });
      }
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({ ok: true, reply: result.reply, payment: result.payment ?? null, frozen: Boolean(result.frozen) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/demo/heist', async (req, res) => {
    try {
      const body = await runHeist();
      const packed = JSON.stringify(body);
      if (body.paid || body.signed || body.lost !== '0' || packed.includes('0x')) {
        return res.status(409).json({ ok: false, signed: false, paid: false, error: 'The heist did not stay blocked.' });
      }
      res.json(body);
    } catch (error) {
      res.status(409).json({ ok: false, signed: false, paid: false, error: error.message ?? 'The heist stopped.' });
    }
  });

  app.post('/api/demo/rogue', async (req, res) => {
    try {
      res.json(await runRogueDemo());
    } catch (error) {
      res.status(409).json({ ok: false, signed: false, paid: false, error: error.message ?? 'The rogue demo stopped.' });
    }
  });

  app.post('/api/demo/over-cap', async (req, res, next) => {
    const rules = rulesOrRefuse(res);
    if (!rules) return;
    const payout = rules.allowedMerchants[0];
    if (!payout) return res.status(500).json({ error: 'The allowance has no merchant to quote.' });
    const quoteServer = createQuoteApp({ payout }).listen(0, '127.0.0.1');
    try {
      await new Promise((resolve, reject) => {
        quoteServer.once('listening', resolve);
        quoteServer.once('error', reject);
      });
      const { port } = quoteServer.address();
      const result = await demonstrateOverCap({
        resourceUrl: `http://127.0.0.1:${port}/demo/over-cap-6`,
        rules,
      });
      res.json({ ...result, contract: latestContractCap() });
    } catch (error) {
      next(error);
    } finally {
      quoteServer.closeAllConnections?.();
      quoteServer.close();
    }
  });

  app.get('/api/audit', async (req, res, next) => {
    try {
      res.json(await listAudit());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/freeze', async (req, res, next) => {
    try {
      if (req.body?.frozen !== undefined && typeof req.body.frozen !== 'boolean') {
        return res.status(400).json({ error: 'frozen must be true or false.' });
      }
      // Anything other than an explicit false freezes. Unsure means stop.
      const frozen = req.body?.frozen !== false;
      if (!frozen) {
        const state = await setFreeze(false);
        return res.json({ ok: true, signing: true, ...state });
      }
      const state = await freezeAgent({ env: env0 });
      stopAgentProcess();
      res.json(state);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/use-case', async (req, res, next) => {
    try {
      const id = typeof req.body?.id === 'string' ? req.body.id.slice(0, 64) : '';
      const result = await setUseCase(id);
      if (result.error) return res.status(400).json({ error: 'That use case is not one of the presets.' });
      res.json({ ok: true, useCase: result.useCase });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/run-agent', async (req, res, next) => {
    if (!fromDashboard(req, env0)) {
      return res.status(403).json({ ok: false, error: 'Open the dashboard to run the agent.' });
    }
    try {
      if ((await readFrozen()).frozen) {
        return res.status(409).json({ ok: false, error: 'The agent is frozen. Unfreeze it before it can pay.' });
      }
    } catch (error) {
      return next(error);
    }
    // Hosted demo: the real rules decide a simulated purchase. Nothing is signed or broadcast.
    if (publicDemo && paymentsMode(env0) !== 'testnet') {
      try {
        if (!rulesOrRefuse(res)) return;
        return res.json(await simulatedRun({}));
      } catch (error) {
        return next(error);
      }
    }
    const parsed = optionalString(req.body?.task, 2000);
    if (parsed.error) return res.status(400).json({ ok: false, error: 'The task must be text.' });
    // Control characters never reach the agent's prompt or the console.
    const task = parsed.value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.taskChars)
      || 'Buy the morning weather brief';
    const ready = Boolean(
      process.env.AGENT_PRIVATE_KEY?.trim()
      && process.env.TEAM_NAME?.trim()
      && process.env.RESOURCE_URL?.trim(),
    );
    if (!ready) {
      return res.status(200).json({
        ok: false,
        demo: true,
        task,
        error: 'Add AGENT_PRIVATE_KEY, TEAM_NAME, and RESOURCE_URL to .env to pay a merchant.',
      });
    }
    if (agentChild && agentChild.exitCode === null && !agentChild.killed) {
      return res.status(409).json({ ok: false, error: 'The agent is already running.' });
    }
    const child = spawn(process.execPath, ['agent/agent.js', task], {
      cwd: rootDir,
      // A hosted testnet demo points the agent at this visitor's sandbox files.
      env: req.sandbox
        ? { ...process.env, ALLOWANCE_STORE: req.sandbox.storePath, ALLOWANCE_RULES: req.sandbox.rulesPath }
        : process.env,
      stdio: 'inherit',
    });
    agentChild = child;
    child.on('exit', () => {
      if (agentChild === child) agentChild = null;
    });
    res.status(202).json({ ok: true, pid: child.pid, task });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (process.env.SERVE_DASHBOARD === '1') {
    const dist = join(rootDir, 'dashboard', 'dist');
    if (existsSync(join(dist, 'index.html'))) {
      app.use(express.static(dist));
      app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (req.path.startsWith('/api')) return next();
        res.sendFile(join(dist, 'index.html'));
      });
    } else {
      console.error('SERVE_DASHBOARD=1 but dashboard/dist is missing. Build the dashboard first.');
    }
  }

  app.use((error, req, res, next) => {
    logError(error);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'The allowance server hit an unexpected error. Try again in a moment.' });
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  const publicDemo = publicDemoEnabled();
  if (publicDemo) {
    // The hosted demo signs only with the labeled, in-memory simulated signer.
    process.env.ALLOWANCE_DEV_SIGNER = '1';
    process.env.SERVE_DASHBOARD ||= '1';
  }
  if (!publicDemo || paymentsMode() === 'testnet') startChannelRefresh();
  const host = process.env.HOST || (publicDemo ? '0.0.0.0' : '127.0.0.1');
  const server = createApp().listen(port, host, async () => {
    const status = summarize(await readStore(), loadRules());
    const mode = status.agentConnected
      ? 'Serving live agent payments.'
      : 'Serving sample payments until the agent runs.';
    console.log(`Agent Allowance API at http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}${host === '0.0.0.0' ? ' (listening on every interface)' : ''}`);
    if (publicDemo) console.log(`Public demo: per-visitor sandboxes, simulated Ledger signatures, payments ${paymentsMode()}.`);
    console.log(mode);
    if (process.env.ALLOWANCE_NOTICES_SHOWN !== '1') {
      for (const line of optionalKeyNotices({
        jevKey: process.env.JEV_API_KEY,
        bedrockConfigured: readBedrockSettings().configured,
      })) {
        console.log(line);
      }
    }
  });
  server.on('error', (error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
