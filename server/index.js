/**
 * Local API for the Agent Allowance dashboard.
 *
 *   GET  /api/status          budget, spent, remaining, rules
 *   GET  /api/payments        tx hash, merchant, amount, status
 *   GET  /api/pending         purchases the agent refused to pay
 *   POST /api/approve/:id/challenge   EIP-712 payload for the Ledger
 *   POST /api/approve/:id             verify the device signature and pay once
 *   POST /api/run-agent       start agent/agent.js for the live demo
 *
 * Data lives in server/data/store.json. Bind to localhost only.
 */

import dotenv from 'dotenv';
import express from 'express';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { channelWarning, higherSpent, peekChannel, startChannelRefresh } from '../agent/chain-spend.js';
import { demonstrateOverCap, latestContractCap } from '../agent/over-cap.js';
import { formatRlusd, loadRules, toUnits } from '../agent/rules.js';
import { createQuoteApp } from '../merchant/index.js';
import { acceptAllowanceChange, createAllowanceChallenge } from './allowance.js';
import { allowanceProposal, answerEve, confirmationSummary, createConfirmations, executeConfirmed, loadEveContext } from './eve.js';
import { backupChallengeEnv, devSignerEnabled, simulateLedgerApproval } from './backup-demo.js';
import { acceptLedgerApproval, createApprovalChallenge } from './ledger.js';
import { declinePending, listPayments, listPending, readPendingRecord, readStore, spentRlusd, summarize } from './store.js';
import { readBedrockSettings } from './bedrock.js';
import { optionalKeyNotices } from '../scripts/start-lib.js';

export function dashboardOrigins(env = process.env) {
  const origins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
  const extra = String(env.DASHBOARD_ORIGIN ?? '').trim();
  if (extra && !origins.includes(extra)) origins.push(extra);
  return origins;
}

export function fromDashboard(req, env = process.env) {
  return dashboardOrigins(env).includes(String(req.get('origin') ?? ''));
}

/** DNS rebinding sends a foreign Host with a localhost Origin. Only these hosts are answered. */
export function allowedHost(host) {
  return /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i.test(String(host ?? '').trim());
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(rootDir, '.env') });

let agentChild = null;
const confirmations = createConfirmations();

export function createApp(options = {}) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    if (!allowedHost(req.headers.host)) {
      return res.status(403).json({ error: 'This API only answers on localhost.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !fromDashboard(req)) {
      return res.status(403).json({ error: 'Open the dashboard to change the allowance.' });
    }
    next();
  });

  app.get('/api/status', async (req, res, next) => {
    try {
      const rules = loadRules();
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

  app.post('/api/approve/:id/challenge', async (req, res, next) => {
    try {
      const env = backupChallengeEnv(ledgerOptions.env ?? process.env);
      sendLedger(res, await createApprovalChallenge(req.params.id, { ...ledgerOptions, env }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/approve/:id', async (req, res, next) => {
    try {
      sendLedger(res, await acceptLedgerApproval(req.params.id, req.body ?? {}, ledgerOptions));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/approve/:id/progress', async (req, res, next) => {
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
  app.post('/api/demo/simulated-ledger/:id', async (req, res, next) => {
    try {
      if (!devSignerEnabled()) return res.status(404).json({ error: 'Not found' });
      sendLedger(res, await simulateLedgerApproval(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/allowance/challenge', async (req, res, next) => {
    try {
      const env = backupChallengeEnv(ledgerOptions.env ?? process.env);
      sendLedger(res, await createAllowanceChallenge(req.body ?? {}, { ...ledgerOptions, env }));
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

  app.post('/api/decline/:id', async (req, res, next) => {
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

  app.post('/api/eve', async (req, res, next) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 2000) : '';
      const context = await loadEveContext();
      const result = await answerEve(message, context);
      const payload = {
        reply: result.reply,
        bedrock: result.source === 'bedrock',
        confirmation: null,
      };
      if (!result.action) return res.json(payload);
      const token = confirmations.issue(result.action);
      payload.confirmation = {
        token,
        summary: confirmationSummary(result.action, context),
        action: result.action,
        ledger: Boolean(result.action.ledger),
        proposal: result.action.ledger ? allowanceProposal(result.action, context.rules) : null,
      };
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/eve/confirm', async (req, res, next) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      const action = confirmations.take(token);
      if (!action) {
        return res.status(400).json({ error: 'That confirmation expired. Ask Eve again.' });
      }
      const result = await executeConfirmed(action);
      if (result.error === 'missing') {
        return res.status(404).json({ error: 'That purchase is not waiting for approval.' });
      }
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({ ok: true, reply: result.reply, payment: result.payment ?? null });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/demo/over-cap', async (req, res, next) => {
    const rules = loadRules();
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

  app.post('/api/run-agent', (req, res) => {
    if (!fromDashboard(req)) {
      return res.status(403).json({ ok: false, error: 'Open the dashboard to run the agent.' });
    }
    const raw = typeof req.body?.task === 'string' ? req.body.task : '';
    const task = raw.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Buy the morning weather brief';
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
      env: process.env,
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

  app.use((error, req, res, next) => {
    console.error(error.message ?? error);
    res.status(500).json({ error: 'The allowance server hit an unexpected error.' });
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  startChannelRefresh();
  const server = createApp().listen(port, '127.0.0.1', async () => {
    const status = summarize(await readStore(), loadRules());
    const mode = status.agentConnected
      ? 'Serving live agent payments.'
      : 'Serving sample payments until the agent runs.';
    console.log(`Agent Allowance API at http://127.0.0.1:${port}`);
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
