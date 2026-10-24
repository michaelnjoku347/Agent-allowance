/**
 * Local API for the Agent Allowance dashboard.
 *
 *   GET  /api/status          budget, spent, remaining, rules
 *   GET  /api/payments        tx hash, merchant, amount, status
 *   GET  /api/pending         purchases the agent refused to pay
 *   POST /api/approve/:id     placeholder for Ledger approval
 *   POST /api/run-agent       start agent/agent.js for the live demo
 *
 * Data lives in server/data/store.json. Bind to localhost only.
 */

import dotenv from 'dotenv';
import express from 'express';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRules } from '../agent/rules.js';
import { answerEve, confirmationSummary, createConfirmations, executeConfirmed, loadEveContext } from './eve.js';
import { approvePending, declinePending, listPayments, listPending, readStore, summarize } from './store.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(rootDir, '.env') });

let agentChild = null;
const confirmations = createConfirmations();

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/status', async (req, res, next) => {
    try {
      res.json(summarize(await readStore(), loadRules()));
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

  app.post('/api/approve/:id', async (req, res, next) => {
    try {
      const result = await approvePending(req.params.id);
      if (result.error === 'invalid') {
        return res.status(400).json({ error: 'That approval id is not valid.' });
      }
      if (result.missing) {
        return res.status(404).json({ error: 'That purchase is not waiting for approval.' });
      }
      res.json({
        ok: true,
        payment: result.approved,
        note: 'Recorded locally. Ledger approval is not wired yet, so nothing was signed or paid.',
      });
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
      if (!result.action) return res.json({ reply: result.reply, confirmation: null });
      const token = confirmations.issue(result.action);
      res.json({
        reply: result.reply,
        confirmation: {
          token,
          summary: confirmationSummary(result.action, context),
          action: result.action,
        },
      });
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

  app.post('/api/run-agent', (req, res) => {
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
  const server = createApp().listen(port, '127.0.0.1', async () => {
    const status = summarize(await readStore(), loadRules());
    const mode = status.agentConnected
      ? 'Serving live agent payments.'
      : 'Serving sample payments until the agent runs.';
    console.log(`Agent Allowance API at http://127.0.0.1:${port}`);
    console.log(mode);
  });
  server.on('error', (error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
