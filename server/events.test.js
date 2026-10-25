import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'events-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');

const { createApp } = await import('./index.js');
const { createStoreEvents, stageFromStore } = await import('./events.js');
const { readStore, recordPending, setLiveStage } = await import('./store.js');

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

/** Read Server-Sent Events from a fetch body until `done` returns true. */
async function readEvents(response, done, ms = 5000) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline && !done(events)) {
      const { value, done: ended } = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ value: null, done: false }), 200)),
      ]);
      if (ended) break;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const type = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (type) events.push({ type, data: JSON.parse(data) });
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return events;
}

describe('live events', { concurrency: false }, () => {
  test('stageFromStore reports a Ledger phase, an agent stage, or nothing', () => {
    const now = Date.parse('2026-10-25T12:00:30.000Z');
    assert.equal(stageFromStore({}, now), null);
    const ledger = stageFromStore({ pending: [{ id: 'pend_1', status: 'paying', paymentPhase: 'settling', amount: '8' }] }, now);
    assert.deepEqual([ledger.source, ledger.phase, ledger.amount], ['ledger', 'settling', '8']);
    assert.equal(stageFromStore({ pending: [{ id: 'pend_1', status: 'paying', paymentPhase: 'odd' }] }, now).phase, 'signed');
    assert.equal(stageFromStore({ pending: [{ id: 's', sample: true, status: 'paying' }] }, now), null);

    const live = { stage: 'rules', task: 'Brief', amount: '1', at: '2026-10-25T12:00:00.000Z' };
    assert.deepEqual(stageFromStore({ live }, now).stage, 'rules');
    // A newer real row means the decision landed; a stale stage does not linger.
    assert.equal(stageFromStore({ live, payments: [{ id: 'p', createdAt: '2026-10-25T12:00:10.000Z' }] }, now), null);
    assert.equal(stageFromStore({ live }, now + 120_000), null);
  });

  test('the watcher sends change and stage when the agent writes the store', async () => {
    rmSync(process.env.ALLOWANCE_STORE, { force: true });
    await readStore();
    const events = createStoreEvents({ intervalMs: 20 });
    const seen = [];
    const stop = events.subscribe((event) => seen.push(event));
    try {
      await setLiveStage({ stage: 'rules', task: 'Morning brief', amount: '1', merchantLabel: 'Market Desk' });
      events.check();
      assert.ok(seen.some((event) => event.type === 'change'));
      assert.deepEqual(seen.filter((event) => event.type === 'stage').at(-1).data.stage, 'rules');
      await setLiveStage(null);
      events.check();
      assert.equal(seen.filter((event) => event.type === 'stage').at(-1).data, null);
      assert.equal(events.listening, 1);
    } finally {
      stop();
    }
    assert.equal(events.listening, 0);
  });

  test('GET /api/events streams the stage and a change for a new row', async () => {
    rmSync(process.env.ALLOWANCE_STORE, { force: true });
    await readStore();
    const storeEvents = createStoreEvents({ intervalMs: 25 });
    const server = await listen(createApp({ channelState: async () => null, storeEvents }));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      const response = await fetch(`${url}/api/events`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const writes = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        await setLiveStage({ stage: 'xrpl', task: 'Morning brief', amount: '1', merchantLabel: 'Market Desk' });
        await new Promise((resolve) => setTimeout(resolve, 120));
        await recordPending({
          task: 'Buy the satellite pack',
          merchant: '0xa11cea11cea11cea11cea11cea11cea11cea11ce',
          merchantLabel: 'Field Weather Co',
          amount: '8',
          reason: 'over per-purchase cap',
        });
      })();
      const events = await readEvents(response, (list) => (
        list.some((event) => event.type === 'stage' && event.data?.stage === 'xrpl')
        && list.filter((event) => event.type === 'change').length >= 2
      ));
      await writes;
      assert.ok(events.some((event) => event.type === 'stage' && event.data?.stage === 'xrpl' && event.data.merchantLabel === 'Market Desk'));
      assert.ok(events.filter((event) => event.type === 'change').length >= 2);
    } finally {
      await close(server);
    }
    for (let i = 0; i < 20 && storeEvents.listening; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(storeEvents.listening, 0, 'a closed stream stops watching');
    rmSync(dir, { recursive: true, force: true });
  });
});
