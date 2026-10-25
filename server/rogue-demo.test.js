import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'rogue-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
process.env.ALLOWANCE_RULES = join(dir, 'rules.json');
copyFileSync(new URL('../agent/rules.json', import.meta.url), process.env.ALLOWANCE_RULES);
for (const name of [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'BEDROCK_MODEL_ID',
  'LLM_API_KEY',
  'JEV_API_KEY',
  'AGENT_PRIVATE_KEY',
  'TEAM_NAME',
]) {
  delete process.env[name];
}

const { runRogueDemo } = await import('./rogue-demo.js');
const { createApp } = await import('./index.js');
const { listPayments, listPending } = await import('./store.js');
const { loadRules } = await import('../agent/rules.js');

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

describe('rogue agent demo', { concurrency: false }, () => {
test('three attacks are blocked by the real rules and nothing is paid or written', async () => {
  const before = readFileSync(process.env.ALLOWANCE_RULES, 'utf8');
  const pendingBefore = JSON.stringify(await listPending());
  const paidBefore = (await listPayments()).filter((item) => item.status === 'paid' && !item.sample).length;
  const rules = loadRules();
  const result = await runRogueDemo({ rules });

  assert.equal(result.ok, true);
  assert.equal(result.signed, false);
  assert.equal(result.paid, false);
  assert.deepEqual(result.attempts.map((item) => item.id), ['over-cap', 'unlisted', 'raise']);
  assert.equal(result.attempts[0].rule, 'over per-purchase cap');
  assert.equal(result.attempts[0].route, 'ledger');
  assert.equal(result.attempts[0].paid, false);
  assert.match(result.attempts[0].note, /Ledger approval/);
  assert.equal(result.attempts[1].rule, 'merchant not allowed');
  assert.equal(result.attempts[1].route, 'hard');
  assert.match(result.attempts[1].note, /Ledger signature cannot pay/);
  assert.equal(result.attempts[2].rule, 'needs_ledger');
  assert.match(result.attempts[2].ruleText, /SetAllowance/);
  assert.match(result.attempts[2].note, /Ledger signature/);
  assert.equal(result.summary.line, '3 attempts, 3 blocked, 0 RLUSD lost');
  assert.equal(result.summary.lost, '0');
  assert.equal(readFileSync(process.env.ALLOWANCE_RULES, 'utf8'), before);
  assert.equal(JSON.stringify(await listPending()), pendingBefore);
  assert.equal((await listPayments()).filter((item) => item.status === 'paid' && !item.sample).length, paidBefore);
  assert.equal(loadRules().maxPerPurchase, rules.maxPerPurchase);
});

test('an attack the rules allow is not reported as blocked', async () => {
  await assert.rejects(
    () => runRogueDemo({
      check: () => ({ decision: 'allow', reason: 'within allowance' }),
    }),
    /Nothing was signed/,
  );
});

test('a raise the engine accepts is refused by the demo', async () => {
  await assert.rejects(
    () => runRogueDemo({
      apply: () => ({ ok: true }),
    }),
    /Ledger signature/,
  );
  const rules = readFileSync(process.env.ALLOWANCE_RULES, 'utf8');
  assert.match(rules, /"maxPerPurchase": "5"/);
});

test('POST /api/demo/rogue returns the three blocks and does not pay', async () => {
  const server = await listen(createApp());
  const { port } = server.address();
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/api/demo/rogue`, { method: 'POST' });
    assert.equal(denied.status, 403);

    const response = await fetch(`http://127.0.0.1:${port}/api/demo/rogue`, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.signed, false);
    assert.equal(body.paid, false);
    assert.equal(body.attempts.length, 3);
    assert.equal(body.attempts.every((item) => item.outcome === 'Blocked' && item.paid === false), true);
    assert.equal(body.summary.line, '3 attempts, 3 blocked, 0 RLUSD lost');
    assert.equal(JSON.stringify(body).includes('0x'), false);
  } finally {
    await close(server);
    rmSync(dir, { recursive: true, force: true });
  }
});
});
