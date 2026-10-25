/**
 * Hosted public demo (PUBLIC_DEMO=1): a link judges can open with no install.
 *
 * Every visitor gets a private sandbox, chosen by a cookie: a copy of the
 * rules and a store seeded with the sample rows. Approvals and allowance
 * raises use a simulated Ledger signature from a throwaway in-memory key, and
 * every screen says so. Run agent records a simulated purchase that walks the
 * same story as the local demo: a 0.01 brief paid inside the rules, a 0.08
 * history quote held for approval, and an unlisted desk that is decline-only.
 * Nothing is broadcast, and no real key is needed or read.
 *
 * PUBLIC_DEMO_PAYMENTS=testnet hands Run agent to the real agent instead, with
 * the server-held AGENT_PRIVATE_KEY on XRPL EVM Testnet. Use that only for a
 * supervised demo: the channel is shared by every visitor.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseRulesFile, checkRules, loadRules, merchantLabel } from '../agent/rules.js';
import { DEMO_AMOUNTS } from '../shared/demo-amounts.js';
import { sandboxContext } from '../shared/sandbox-context.js';
import { acceptAllowanceChange, createAllowanceChallenge } from './allowance.js';
import { backupApproverWallet } from './backup-demo.js';
import { signApprovalForTest } from './dev-signer.js';
import { readStore, recordPending, recordUnbroadcastPayment, spentRlusd } from './store.js';

export const COOKIE = 'aa_demo';
const ID = /^[a-f0-9]{32}$/;
export const SIMULATED_PAYMENT_NOTE = 'Public demo: simulated payment. Nothing was broadcast.';
export const SIMULATED_SIGNATURE_NOTE = 'simulated Ledger signature';

export function publicDemoEnabled(env = process.env) {
  return env.PUBLIC_DEMO === '1';
}

/** 'testnet' only when the operator asked for it and gave the agent its keys. */
export function paymentsMode(env = process.env) {
  if (!publicDemoEnabled(env)) return 'live';
  const wantsTestnet = String(env.PUBLIC_DEMO_PAYMENTS ?? '').trim() === 'testnet';
  const ready = Boolean(env.AGENT_PRIVATE_KEY?.trim() && env.TEAM_NAME?.trim() && env.RESOURCE_URL?.trim());
  return wantsTestnet && ready ? 'testnet' : 'simulated';
}

function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function secureRequest(req) {
  return req.secure || String(req.get?.('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';
}

/**
 * Seed a sandbox: the base rules with the simulated approver named, so the
 * approval and raise screens work without a device. The store seeds itself
 * with the sample rows on first read.
 */
function seed(dir, baseRules, approver) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const raw = JSON.parse(readFileSync(baseRules, 'utf8'));
  raw.approverAddress = approver;
  writeFileSync(join(dir, 'rules.json'), `${JSON.stringify(raw, null, 2)}\n`);
}

/**
 * Express middleware that runs each request inside the visitor's sandbox.
 * Mount it after express.json: body parsing finishes on stream events, which
 * would otherwise run outside the async context.
 */
export function createSandboxes({
  root = join(tmpdir(), 'agent-allowance-demo'),
  ttlMs = 6 * 60 * 60 * 1000,
  max = 500,
  baseRules = baseRulesFile(),
  approver = () => backupApproverWallet().address.toLowerCase(),
  now = () => Date.now(),
} = {}) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let sweptAt = 0;

  function paths(id) {
    const dir = join(root, id);
    return { id, dir, storePath: join(dir, 'store.json'), rulesPath: join(dir, 'rules.json') };
  }

  /** Drop sandboxes idle past the TTL, and the oldest beyond the cap. */
  function sweep() {
    const at = now();
    if (at - sweptAt < 60_000) return;
    sweptAt = at;
    let rows = [];
    try {
      rows = readdirSync(root).filter((name) => ID.test(name)).map((name) => {
        try {
          return { name, mtime: statSync(join(root, name)).mtimeMs };
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return;
    }
    rows.sort((a, b) => b.mtime - a.mtime);
    rows.forEach((row, index) => {
      if (index >= max || at - row.mtime > ttlMs) rmSync(join(root, row.name), { recursive: true, force: true });
    });
  }

  function ensure(id) {
    const box = paths(id);
    if (!existsSync(box.rulesPath)) seed(box.dir, baseRules, approver());
    try {
      const stamp = new Date(now());
      utimesSync(box.dir, stamp, stamp);
    } catch {
      /* A touch only keeps the sandbox from being swept early. */
    }
    return box;
  }

  function reset(id) {
    const box = paths(id);
    rmSync(box.dir, { recursive: true, force: true });
    return ensure(id);
  }

  function middleware(req, res, next) {
    // Health checks come from the host every few seconds. They read the base files, not a sandbox.
    if (req.path === '/health') return next();
    let id = readCookie(req.headers.cookie, COOKIE);
    if (!ID.test(id)) {
      id = randomBytes(16).toString('hex');
      const parts = [`${COOKIE}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(ttlMs / 1000)}`];
      if (secureRequest(req)) parts.push('Secure');
      res.append('Set-Cookie', parts.join('; '));
      sweep();
    }
    const box = ensure(id);
    req.sandbox = box;
    sandboxContext.run(box, next);
  }

  return { middleware, ensure, reset, paths, sweep, root };
}

/** The three simulated purchases Run agent cycles through, in story order. */
export function demoScenarios(rules) {
  const listed = rules.allowedMerchants[1] || rules.allowedMerchants[0];
  const weather = rules.allowedMerchants[0];
  const unlisted = rules.deniedMerchants?.[0]?.address || '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad';
  return [
    { task: 'Buy the morning market brief', merchant: listed, amount: DEMO_AMOUNTS.brief },
    { task: 'Buy the extended market history', merchant: weather, amount: DEMO_AMOUNTS.history },
    { task: 'Buy a quote from an outside desk', merchant: unlisted, amount: DEMO_AMOUNTS.unlisted, label: 'Unlisted Research API' },
  ];
}

/**
 * One simulated agent purchase. The real rules decide; nothing is signed.
 * An allowed quote is recorded as paid with a "simulated payment" note, and
 * anything else waits under Needs you exactly as the live agent would leave it.
 */
export async function simulatedRun({ task } = {}) {
  const rules = loadRules();
  const store = await readStore();
  const done = [...(store.payments ?? []), ...(store.pending ?? [])].filter((item) => item && !item.sample).length;
  const scenarios = demoScenarios(rules);
  const pick = scenarios[done % scenarios.length];
  const spent = await spentRlusd();
  const decision = checkRules({ merchant: pick.merchant, amount: pick.amount, spent }, rules);
  const label = merchantLabel(rules, pick.merchant) || pick.label || 'Outside desk';
  const plan = { source: 'fallback', reason: 'Public demo. The built-in planner picked the next step of the story.' };
  if (decision.decision === 'allow') {
    const payment = await recordUnbroadcastPayment({
      task: task || pick.task,
      merchant: pick.merchant,
      merchantLabel: label,
      amount: pick.amount,
      note: SIMULATED_PAYMENT_NOTE,
      plan,
    });
    return { ok: true, simulated: true, paid: true, payment, line: `Paid ${pick.amount} RLUSD to ${label}. Simulated, nothing was broadcast.` };
  }
  const pending = await recordPending({
    task: pick.task,
    merchant: pick.merchant,
    merchantLabel: label,
    amount: pick.amount,
    reason: decision.reason,
    plan,
  });
  return { ok: true, simulated: true, paid: false, pending, line: `Held ${pick.amount} RLUSD to ${label}: ${decision.reason}. Nothing was signed.` };
}

/**
 * Raise the allowance with the simulated signer instead of a Ledger. The same
 * SetAllowance challenge, signature check, and replay guard run as for a device.
 */
export async function simulatedAllowanceRaise(proposal, { env = process.env } = {}) {
  const wallet = backupApproverWallet();
  const signerEnv = { ...env, APPROVER_ADDRESS: wallet.address };
  const challenge = await createAllowanceChallenge(proposal, { env: signerEnv });
  if (challenge.status !== 200) return challenge;
  const signed = await signApprovalForTest(challenge.body.typedData, wallet.privateKey);
  const result = await acceptAllowanceChange({ signature: signed.signature, message: challenge.body.typedData.message }, { env: signerEnv });
  if (result.status === 200 && result.body) {
    result.body.note = `Allowance raised with a ${SIMULATED_SIGNATURE_NOTE}. This is not a Ledger device. Nothing was paid.`;
    result.body.simulated = true;
  }
  return result;
}
