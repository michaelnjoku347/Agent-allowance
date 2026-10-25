import assert from 'node:assert/strict';
import test from 'node:test';
import { backoffDelay, createReconnectingStream, describeConnection, failureKind } from './connection.js';

test('backoff doubles from 1s, stays inside its step, and caps at 30s', () => {
  assert.equal(backoffDelay(0, { random: () => 0 }), 500);
  assert.equal(backoffDelay(0, { random: () => 1 }), 1000);
  assert.equal(backoffDelay(3, { random: () => 1 }), 8000);
  assert.equal(backoffDelay(20, { random: () => 1 }), 30_000);
  assert.equal(backoffDelay(20, { random: () => 0 }), 15_000);
  assert.equal(backoffDelay(-4, { random: () => 1 }), 1000);
  assert.equal(backoffDelay('x', { random: () => 1 }), 1000);
});

test('failures are sorted into kinds a person can act on', () => {
  assert.equal(failureKind(new TypeError('Failed to fetch')), 'unreachable');
  assert.equal(failureKind(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(failureKind(Object.assign(new Error('x'), { status: 429 })), 'busy');
  assert.equal(failureKind(Object.assign(new Error('x'), { status: 503, code: 'rules_unavailable' })), 'rules');
  assert.equal(failureKind(Object.assign(new Error('x'), { status: 500 })), 'server');
  assert.equal(failureKind(Object.assign(new Error('x'), { kind: 'unreachable' })), 'unreachable');
  assert.equal(failureKind(null), 'unknown');
});

test('the banner says what is down, what still works, and when it retries', () => {
  assert.equal(describeConnection({ connection: 'loading' }), null);
  assert.equal(describeConnection({ connection: 'online', health: { rules: 'ok', merchant: 'up', merchantConfigured: true } }), null);

  const preview = describeConnection({ connection: 'offline', preview: true, kind: 'unreachable', retryInMs: 8000 });
  assert.equal(preview.title, 'Can’t reach the allowance server');
  assert.match(preview.body, /example rows/);
  assert.match(preview.body, /npm start/);
  assert.match(preview.body, /Trying again in 8 seconds/);

  const stale = describeConnection({ connection: 'offline', kind: 'unreachable', lastOkAt: 0 + 1, now: 1 + 3 * 60_000 });
  assert.equal(stale.title, 'Connection lost');
  assert.match(stale.body, /3 minutes ago/);

  assert.equal(describeConnection({ connection: 'offline', kind: 'server' }).title, 'The allowance server hit an error');
  assert.equal(describeConnection({ connection: 'offline', kind: 'rules' }).tone, 'danger');
  assert.equal(describeConnection({ connection: 'offline', kind: 'busy', retryInMs: 1000 }).body, 'The allowance server asked the page to wait. Trying again in 1 second.');

  const merchant = describeConnection({ connection: 'online', health: { rules: 'ok', merchant: 'down', merchantConfigured: true } });
  assert.equal(merchant.title, 'Merchant offline');
  assert.match(merchant.body, /npm run merchant/);
  assert.match(merchant.body, /allowance is safe/);
  assert.equal(describeConnection({ connection: 'online', health: { rules: 'ok', merchant: 'down', merchantConfigured: false } }), null);
  assert.equal(describeConnection({ connection: 'online', health: { rules: 'unreadable', message: 'Fix it.' } }).body, 'Fix it.');
});

class FakeSource {
  static made = [];
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    FakeSource.made.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type, data) {
    for (const fn of this.listeners[type] ?? []) fn({ data });
  }
  close() {
    this.closed = true;
  }
}

test('the stream reopens with backoff, resets on open, and parses events', () => {
  FakeSource.made = [];
  const timers = [];
  const downs = [];
  let opens = 0;
  const changes = [];
  const stream = createReconnectingStream({
    url: '/api/events',
    EventSourceImpl: FakeSource,
    random: () => 1,
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    cancel: () => {},
    onOpen: () => { opens += 1; },
    onDown: (info) => downs.push(info),
    handlers: { change: (data) => changes.push(data) },
  });
  assert.equal(FakeSource.made.length, 1);
  FakeSource.made[0].emit('change', '{"a":1}');
  FakeSource.made[0].emit('change', 'not json');
  assert.deepEqual(changes, [{ a: 1 }, null]);

  FakeSource.made[0].emit('error');
  assert.equal(FakeSource.made[0].closed, true);
  assert.deepEqual(downs[0], { attempt: 1, retryInMs: 1000, supported: true });
  timers.shift().fn();
  assert.equal(FakeSource.made.length, 2);
  FakeSource.made[1].emit('error');
  assert.equal(downs[1].retryInMs, 2000);
  timers.shift().fn();
  FakeSource.made[2].emit('open');
  assert.equal(opens, 1);
  FakeSource.made[2].emit('error');
  assert.equal(downs[2].retryInMs, 1000, 'an open resets the backoff');

  stream.reconnectNow();
  assert.equal(FakeSource.made.length, 4, 'reconnectNow skips the wait');
  stream.close();
  assert.equal(FakeSource.made[3].closed, true);
  FakeSource.made[3].emit('error');
  assert.equal(downs.length, 3, 'a closed stream stays closed');
});

test('a browser without EventSource reports down once and polls instead', () => {
  const downs = [];
  const stream = createReconnectingStream({ url: '/x', EventSourceImpl: null, onDown: (info) => downs.push(info) });
  assert.deepEqual(downs, [{ attempt: 0, retryInMs: 0, supported: false }]);
  stream.close();
  stream.reconnectNow();
});
