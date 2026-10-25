import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'freeze-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
delete process.env.SERVE_DASHBOARD;

const { closeOpenChannels, freezeAgent } = await import('./freeze-channel.js');
const { createApp } = await import('./index.js');
const { setFreeze } = await import('./store.js');

delete process.env.AGENT_PRIVATE_KEY;
delete process.env.TEAM_NAME;

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

describe('freeze closes the channel only when one is open', { concurrency: false }, () => {
  test('a missing wallet does not call the payment service', async () => {
    let called = false;
    const result = await closeOpenChannels({ AGENT_PRIVATE_KEY: '', TEAM_NAME: 'team' }, {
      signIn: async () => {
        called = true;
        return { token: 'nope' };
      },
    });
    assert.equal(called, false);
    assert.equal(result.attempted, false);
    assert.equal(result.closed, false);
    assert.match(result.reason, /no channel was closed/i);
    assert.match(result.reason, /Signing is stopped/);
  });

  test('an injected close reports the channel closed and keeps the key out of the reason', async () => {
    const key = `0x${'ab'.repeat(32)}`;
    const hash = `0x${'ef'.repeat(32)}`;
    const result = await closeOpenChannels({
      AGENT_PRIVATE_KEY: key,
      TEAM_NAME: 'Demo Team',
      AP4M_API_URL: 'https://hackathon.ap4m.build',
    }, {
      timeoutMs: 1000,
      signIn: async () => ({ token: 'session' }),
      listChannels: async () => [{ channel_id: `0x${'cd'.repeat(32)}`, channel_status: 'open' }],
      closeChannel: async () => ({ tx_hash: hash }),
    });
    assert.equal(result.closed, true);
    assert.equal(result.attempted, true);
    assert.deepEqual(result.txHashes, [hash]);
    assert.equal(result.reason.includes(key), false);

    const stopped = await freezeAgent({
      env: {},
      close: async () => result,
    });
    assert.equal(stopped.frozen, true);
    assert.equal(stopped.signing, false);
    assert.equal(stopped.channelClosed, true);
    await setFreeze(false);
  });

  test('Eve only proposes a pause; the confirm freezes signing and does not claim a channel closed', async () => {
    const server = await listen(createApp());
    const base = `http://127.0.0.1:${server.address().port}`;
    const origin = { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' };
    try {
      const paused = await fetch(`${base}/api/eve`, {
        method: 'POST',
        headers: origin,
        body: JSON.stringify({ message: 'pause agent' }),
      });
      assert.equal(paused.status, 200);
      const body = await paused.json();
      assert.equal(body.confirmation.action.type, 'freeze');
      assert.match(body.confirmation.summary, /Freeze the agent now/);
      const before = await (await fetch(`${base}/api/status`)).json();
      assert.equal(before.frozen, false, 'nothing is frozen until the person confirms');

      const confirmed = await fetch(`${base}/api/eve/confirm`, {
        method: 'POST',
        headers: origin,
        body: JSON.stringify({ token: body.confirmation.token }),
      });
      assert.equal(confirmed.status, 200);
      const done = await confirmed.json();
      assert.equal(done.frozen, true);
      assert.match(done.reply, /Signing has stopped/);
      assert.equal(/the payment channel is closed/i.test(done.reply), false);
      assert.equal((await (await fetch(`${base}/api/status`)).json()).frozen, true);

      const unfreeze = await (await fetch(`${base}/api/eve`, {
        method: 'POST',
        headers: origin,
        body: JSON.stringify({ message: 'unfreeze the agent' }),
      })).json();
      assert.equal(unfreeze.confirmation, null, 'Eve never offers to unfreeze');
      assert.match(unfreeze.reply, /cannot unfreeze/);
      assert.deepEqual(unfreeze.ui, { type: 'navigate', route: 'security' });

      const opened = await fetch(`${base}/api/freeze`, {
        method: 'POST',
        headers: origin,
        body: JSON.stringify({ frozen: false }),
      });
      assert.equal((await opened.json()).frozen, false);

      const frozen = await fetch(`${base}/api/freeze`, {
        method: 'POST',
        headers: origin,
        body: JSON.stringify({ frozen: true }),
      });
      const state = await frozen.json();
      assert.equal(state.frozen, true);
      assert.equal(state.signing, false);
      assert.equal(state.channelClosed, false);
      assert.match(state.channelReason, /Signing is stopped/);
    } finally {
      await close(server);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
