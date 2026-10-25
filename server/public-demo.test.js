import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { after, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'public-demo-'));
process.env.ALLOWANCE_STORE = join(dir, 'base-store.json');
process.env.ALLOWANCE_DEV_SIGNER = '1';
delete process.env.APPROVER_ADDRESS;
delete process.env.AGENT_PRIVATE_KEY;

const { createApp, allowedHost, dashboardOrigins, publicHosts } = await import('./index.js');
const { createSandboxes, paymentsMode, publicDemoEnabled } = await import('./public-demo.js');
const { closeOpenChannels } = await import('./freeze-channel.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const ENV = { ...process.env, PUBLIC_DEMO: '1', RENDER_EXTERNAL_HOSTNAME: 'allowance-demo.onrender.com' };
const ORIGIN = 'https://allowance-demo.onrender.com';

async function serve(fn, sandboxes) {
  const app = createApp({ env: ENV, sandboxes });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function client(base) {
  let cookie = '';
  const request = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Host: 'allowance-demo.onrender.com',
        Origin: ORIGIN,
        'X-Forwarded-Proto': 'https',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
  };
  return { request, cookie: () => cookie };
}

describe('hosted public demo', { concurrency: false }, () => {
  test('modes and hosts come from the environment', () => {
    assert.equal(publicDemoEnabled({ PUBLIC_DEMO: '1' }), true);
    assert.equal(publicDemoEnabled({}), false);
    assert.equal(paymentsMode({ PUBLIC_DEMO: '1' }), 'simulated');
    assert.equal(paymentsMode({ PUBLIC_DEMO: '1', PUBLIC_DEMO_PAYMENTS: 'testnet' }), 'simulated', 'testnet needs the agent keys too');
    assert.equal(paymentsMode({ PUBLIC_DEMO: '1', PUBLIC_DEMO_PAYMENTS: 'testnet', AGENT_PRIVATE_KEY: '0x1', TEAM_NAME: 't', RESOURCE_URL: 'https://m/resource' }), 'testnet');
    assert.deepEqual(publicHosts({ PUBLIC_HOSTNAME: 'Demo.Example.com, bad host', FLY_APP_NAME: 'allowance' }), ['demo.example.com', 'allowance.fly.dev']);
    assert.equal(allowedHost('allowance-demo.onrender.com', ENV), true);
    assert.equal(allowedHost('evil.example', ENV), false);
    assert.equal(allowedHost('localhost:8787', {}), true);
    assert.ok(dashboardOrigins(ENV).includes(ORIGIN));
  });

  test('each visitor gets a private sandbox with the simulated approver', async () => {
    const sandboxes = createSandboxes({ root: join(dir, 'boxes'), approver: () => `0x${'ab'.repeat(20)}` });
    await serve(async (base) => {
      const alice = client(base);
      const bob = client(base);
      const status = await alice.request('/api/status');
      assert.equal(status.status, 200);
      assert.equal(status.body.publicDemo, true);
      assert.equal(status.body.paymentsMode, 'simulated');
      assert.equal(status.body.simulatedLedger, true);
      assert.equal(status.body.rules.approverAddress, `0x${'ab'.repeat(20)}`);
      assert.match(alice.cookie(), /^aa_demo=[a-f0-9]{32}$/);
      assert.match(status.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
      await bob.request('/api/status');
      assert.notEqual(alice.cookie(), bob.cookie());

      // Alice freezes; Bob's sandbox stays live.
      const frozen = await alice.request('/api/freeze', { method: 'POST', body: { frozen: true } });
      assert.equal(frozen.body.frozen, true);
      assert.match(frozen.body.channelReason, /shared demo channel stays open/);
      assert.equal((await alice.request('/api/status')).body.frozen, true);
      assert.equal((await bob.request('/api/status')).body.frozen, false);

      // Bob lowers his cap; Alice's rules do not move.
      const lowered = await bob.request('/api/allowance/lower', { method: 'POST', body: { maxPerPurchase: '0.03' } });
      assert.equal(lowered.status, 200);
      assert.equal((await bob.request('/api/status')).body.rules.maxPerPurchase, '0.03');
      assert.equal((await alice.request('/api/status')).body.rules.maxPerPurchase, '0.05');
      assert.equal(JSON.parse(readFileSync(new URL('../agent/rules.json', import.meta.url), 'utf8')).maxPerPurchase, '0.05', 'the repo rules never change');
    }, sandboxes);
  });

  test('Run agent walks the story with simulated payments, and reset starts over', async () => {
    const sandboxes = createSandboxes({ root: join(dir, 'story'), approver: () => `0x${'ab'.repeat(20)}` });
    await serve(async (base) => {
      const visitor = client(base);
      await visitor.request('/api/status');
      const first = await visitor.request('/api/run-agent', { method: 'POST', body: {} });
      assert.equal(first.body.simulated, true);
      assert.equal(first.body.paid, true);
      assert.match(first.body.line, /Paid 0\.01 RLUSD/);
      const second = await visitor.request('/api/run-agent', { method: 'POST', body: {} });
      assert.equal(second.body.paid, false);
      assert.match(second.body.line, /0\.08 RLUSD .*over per-purchase cap/);
      const third = await visitor.request('/api/run-agent', { method: 'POST', body: {} });
      assert.match(third.body.line, /merchant not allowed/);

      const payments = (await visitor.request('/api/payments')).body;
      assert.equal(payments.length, 1);
      assert.equal(payments[0].txHash, null, 'nothing was broadcast');
      assert.match(payments[0].note, /simulated payment/);
      const pending = (await visitor.request('/api/pending')).body;
      assert.equal(pending.length, 2);

      // The held 0.08 quote is approved with the labeled simulated signer.
      const held = pending.find((item) => item.reason === 'over per-purchase cap');
      const approved = await visitor.request(`/api/demo/simulated-ledger/${held.id}`, { method: 'POST' });
      assert.equal(approved.status, 200);
      assert.equal(approved.body.simulated, true);

      // A raise is signed by the simulated signer, never silently.
      const raise = await visitor.request('/api/demo/simulated-allowance', { method: 'POST', body: { budget: '0.5' } });
      assert.equal(raise.status, 200);
      assert.match(raise.body.note, /simulated Ledger signature\. This is not a Ledger device/);
      assert.equal((await visitor.request('/api/status')).body.rules.budget, '0.5');

      const reset = await visitor.request('/api/demo/reset', { method: 'POST' });
      assert.equal(reset.status, 200);
      const fresh = await visitor.request('/api/status');
      assert.equal(fresh.body.rules.budget, '0.2');
      assert.equal(fresh.body.agentConnected, false, 'back to the sample rows');
    }, sandboxes);
  });

  test('a foreign host is refused and a freeze never closes the shared channel', async () => {
    await serve(async (base) => {
      // fetch() will not send a custom Host header, so use node:http for the rebinding case.
      const status = (host) => new Promise((resolve, reject) => {
        const req = httpRequest(`${base}/api/status`, { headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(await status('evil.example'), 403);
      const health = await fetch(`${base}/api/health`);
      assert.equal(health.headers.get('set-cookie'), null, 'a health check does not open a sandbox');
      assert.equal(await status('allowance-demo.onrender.com'), 200);
    }, createSandboxes({ root: join(dir, 'host') }));
    const result = await closeOpenChannels({ PUBLIC_DEMO: '1', AGENT_PRIVATE_KEY: `0x${'11'.repeat(32)}`, TEAM_NAME: 'team' }, {
      signIn: async () => { throw new Error('must not sign in'); },
    });
    assert.equal(result.attempted, false);
  });

  test('old sandboxes are swept', () => {
    let now = Date.parse('2026-10-25T00:00:00Z');
    const sandboxes = createSandboxes({ root: join(dir, 'sweep'), ttlMs: 1000, max: 2, now: () => now });
    for (const id of ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)]) sandboxes.ensure(id);
    now += 120_000;
    sandboxes.sweep();
    for (const id of ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)]) {
      assert.equal(existsSync(join(dir, 'sweep', id)), false, id);
    }
  });
});
