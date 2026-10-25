import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'setup-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
process.env.ALLOWANCE_RULES = join(dir, 'rules.json');
copyFileSync(new URL('../agent/rules.json', import.meta.url), process.env.ALLOWANCE_RULES);
delete process.env.APPROVER_ADDRESS;

const { createApp } = await import('./index.js');
const { parseAgentName } = await import('./guardrails.js');
const { setApproverAddress, loadRules } = await import('../agent/rules.js');

after(() => rmSync(dir, { recursive: true, force: true }));

async function serve(fn, options = {}) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
  body: JSON.stringify(body),
});

describe('setup', { concurrency: false }, () => {
  test('agent names are short, plain text', () => {
    assert.deepEqual(parseAgentName('  Research   Bot  '), { value: 'Research Bot' });
    assert.deepEqual(parseAgentName('Café Scout (EU)'), { value: 'Café Scout (EU)' });
    assert.match(parseAgentName('').error, /Give the agent a name/);
    assert.match(parseAgentName('<script>').error, /Use up to 40/);
    assert.match(parseAgentName('x'.repeat(41)).error, /Use up to 40/);
    assert.match(parseAgentName(42).error, /text/);
  });

  test('the profile saves a name and the setup time, and status reports it', async () => {
    await serve(async (base) => {
      const saved = await (await post(base, '/api/profile', { agentName: 'Research Bot', onboarded: true })).json();
      assert.equal(saved.profile.agentName, 'Research Bot');
      assert.ok(saved.profile.onboardedAt);
      const status = await (await fetch(`${base}/api/status`)).json();
      assert.equal(status.profile.agentName, 'Research Bot');
      assert.equal((await post(base, '/api/profile', { agentName: '<b>' })).status, 400);
      assert.equal((await post(base, '/api/profile', { approverAddress: '0x1' })).status, 400);
      assert.equal((await post(base, '/api/profile', { onboarded: 'yes' })).status, 400);
    });
  });

  test('the approver can be named once, and never replaced from the dashboard', async () => {
    const first = `0x${'ab'.repeat(20)}`;
    const second = `0x${'cd'.repeat(20)}`;
    await serve(async (base) => {
      assert.equal((await post(base, '/api/approver', { address: 'not-an-address' })).status, 400);
      const saved = await post(base, '/api/approver', { address: first.toUpperCase().replace('0X', '0x') });
      assert.equal(saved.status, 200);
      assert.equal((await saved.json()).approverAddress, first);
      assert.equal(JSON.parse(readFileSync(process.env.ALLOWANCE_RULES, 'utf8')).approverAddress, first);

      const replaced = await post(base, '/api/approver', { address: second });
      assert.equal(replaced.status, 409);
      assert.equal((await replaced.json()).error, 'approver_set');
      assert.equal(loadRules().approverAddress, first);

      const audit = await (await fetch(`${base}/api/audit`)).json();
      assert.ok(audit.some((row) => row.rule === 'approver' && row.reason.includes(first)));
    });
  });

  test('an approver in the environment also blocks a dashboard change', () => {
    const file = join(dir, 'env-rules.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(new URL('../agent/rules.json', import.meta.url), 'utf8')), approverAddress: null }));
    const result = setApproverAddress(`0x${'ef'.repeat(20)}`, file, { APPROVER_ADDRESS: `0x${'12'.repeat(20)}` });
    assert.equal(result.code, 'approver_set');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).approverAddress, null);
    assert.equal(setApproverAddress('0x12', file, {}).code, 'invalid');
  });

  test('the approver route needs the dashboard origin', async () => {
    await serve(async (base) => {
      const response = await fetch(`${base}/api/approver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: `0x${'ab'.repeat(20)}` }),
      });
      assert.equal(response.status, 403);
    });
  });
});
