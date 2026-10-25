import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'guardrails-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
const rulesCopy = join(dir, 'rules.json');
copyFileSync(new URL('../agent/rules.json', import.meta.url), rulesCopy);
process.env.ALLOWANCE_RULES = rulesCopy;

const {
  createRateLimiter,
  parseAllowancePatch,
  rateLimitSettings,
  redact,
  validId,
} = await import('./guardrails.js');
const { createApp } = await import('./index.js');

const ORIGIN = 'http://127.0.0.1:5173';

after(() => rmSync(dir, { recursive: true, force: true }));

async function serve(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(base, path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('guardrail helpers', () => {
  test('ids are short and plain', () => {
    assert.equal(validId('pend_123-ab'), true);
    assert.equal(validId('../etc/passwd'), false);
    assert.equal(validId('x'.repeat(65)), false);
    assert.equal(validId(''), false);
    assert.equal(validId(42), false);
  });

  test('an allowance patch accepts amounts, dates, and addresses and refuses the rest', () => {
    assert.deepEqual(parseAllowancePatch({ budget: '10', maxPerPurchase: 2.5 }).patch, { budget: '10', maxPerPurchase: '2.5' });
    assert.match(parseAllowancePatch({ budget: '-1' }).error, /Budget must be a positive/);
    assert.match(parseAllowancePatch({ maxPerPurchase: '1e9' }).error, /cap must be/);
    assert.match(parseAllowancePatch({ budget: '1.0000000000000000001' }).error, /Budget/);
    assert.match(parseAllowancePatch({ expiresAt: 'soon' }).error, /date/);
    assert.match(parseAllowancePatch({ allowedMerchants: [] }).error, /at least one/);
    assert.match(parseAllowancePatch({ allowedMerchants: ['0x123'] }).error, /0x address/);
    assert.match(parseAllowancePatch({ allowedMerchants: Array(51).fill(`0x${'a'.repeat(40)}`) }).error, /50 merchants/);
    assert.match(parseAllowancePatch({ approverAddress: `0x${'a'.repeat(40)}` }).error, /Unknown field: approverAddress/);
    assert.match(parseAllowancePatch({}).error, /Nothing to change/);
    assert.match(parseAllowancePatch(['budget']).error, /JSON object/);
    assert.match(parseAllowancePatch(null).error, /JSON object/);
  });

  test('redaction removes keys from env and anything shaped like a private key', () => {
    const env = { AGENT_PRIVATE_KEY: 'supersecretvalue', JEV_API_KEY: 'jev-key-123456' };
    const line = redact(`boom supersecretvalue jev-key-123456 0x${'ab'.repeat(32)} Authorization: abc.def`, env);
    assert.doesNotMatch(line, /supersecretvalue|jev-key-123456|abab/);
    assert.match(line, /\[AGENT_PRIVATE_KEY\]/);
    assert.match(line, /\[redacted-hex\]/);
    assert.match(line, /Authorization: \[redacted\]/);
  });

  test('the rate limiter counts per window and resets', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => now });
    const results = [];
    const res = () => {
      const out = { headers: {}, code: 200 };
      return Object.assign(out, {
        setHeader: (key, value) => { out.headers[key] = value; },
        status(code) { out.code = code; return this; },
        json(body) { out.body = body; results.push(out); return this; },
      });
    };
    const req = { ip: '127.0.0.1' };
    let passed = 0;
    for (let i = 0; i < 3; i += 1) limiter(req, res(), () => { passed += 1; });
    assert.equal(passed, 2);
    assert.equal(results[0].code, 429);
    assert.equal(results[0].headers['Retry-After'], '1');
    assert.match(results[0].body.message, /Nothing was paid/);
    now = 1001;
    limiter(req, res(), () => { passed += 1; });
    assert.equal(passed, 3);
  });

  test('ALLOWANCE_RATE_LIMIT scales or disables the limits', () => {
    assert.deepEqual(rateLimitSettings({}), { reads: 1200, writes: 120, eve: 40 });
    assert.deepEqual(rateLimitSettings({ ALLOWANCE_RATE_LIMIT: '0' }), { reads: 0, writes: 0, eve: 0 });
    assert.deepEqual(rateLimitSettings({ ALLOWANCE_RATE_LIMIT: 'junk' }), { reads: 1200, writes: 120, eve: 40 });
  });
});

describe('API guardrails', { concurrency: false }, () => {
  test('responses carry safe headers and no Express banner', async () => {
    await serve(createApp(), async (base) => {
      const response = await fetch(`${base}/api/pending`);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-powered-by'), null);
    });
  });

  test('a bad id, a non-JSON body, or broken JSON is refused before any handler runs', async () => {
    await serve(createApp(), async (base) => {
      const badId = await post(base, '/api/decline/..%2F..%2Fsecret');
      assert.equal(badId.status, 400);
      const text = await post(base, '/api/freeze', 'frozen=false', { 'Content-Type': 'text/plain' });
      assert.equal(text.status, 415);
      const broken = await post(base, '/api/freeze', '{"frozen":');
      assert.equal(broken.status, 400);
      assert.equal((await broken.json()).error, 'invalid_json');
      const wrongType = await post(base, '/api/freeze', { frozen: 'no' });
      assert.equal(wrongType.status, 400);
      const eve = await post(base, '/api/eve', { message: { evil: true } });
      assert.equal(eve.status, 400);
      const task = await post(base, '/api/run-agent', { task: ['x'] });
      assert.equal(task.status, 400);
    });
  });

  test('writes past the limit get a 429 with a human message', async () => {
    await serve(createApp({ rateLimits: { reads: 100, writes: 2, eve: 1 } }), async (base) => {
      assert.notEqual((await post(base, '/api/use-case', { id: 'nope' })).status, 429);
      assert.notEqual((await post(base, '/api/use-case', { id: 'nope' })).status, 429);
      const limited = await post(base, '/api/use-case', { id: 'nope' });
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) >= 1);
      assert.match((await limited.json()).message, /Too many requests/);
    });
  });

  test('preview says whether a change needs the Ledger, and lower refuses any raise', async () => {
    await serve(createApp(), async (base) => {
      const lowerPreview = await (await post(base, '/api/allowance/preview', { maxPerPurchase: '3' })).json();
      assert.equal(lowerPreview.needsLedger, false);
      assert.equal(lowerPreview.next.maxPerPurchase, '3');
      assert.equal(lowerPreview.current.maxPerPurchase, '5');

      const raisePreview = await (await post(base, '/api/allowance/preview', { budget: '500' })).json();
      assert.equal(raisePreview.needsLedger, true);
      assert.match(raisePreview.message, /Ledger must sign/);

      const refused = await post(base, '/api/allowance/lower', { budget: '500' });
      assert.equal(refused.status, 403);
      assert.equal((await refused.json()).error, 'needs_ledger');
      assert.equal(JSON.parse(readFileSync(rulesCopy, 'utf8')).budget, '20');

      const capOverBudget = await post(base, '/api/allowance/lower', { maxPerPurchase: '19', budget: '10' });
      assert.equal(capOverBudget.status, 400);

      const lowered = await post(base, '/api/allowance/lower', { maxPerPurchase: '3' });
      assert.equal(lowered.status, 200);
      assert.equal((await lowered.json()).rules.maxPerPurchase, '3');
      assert.equal(JSON.parse(readFileSync(rulesCopy, 'utf8')).maxPerPurchase, '3');

      const noOrigin = await fetch(`${base}/api/allowance/lower`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPerPurchase: '1' }),
      });
      assert.equal(noOrigin.status, 403);
    });
  });

  test('health reports a silent merchant in plain words', async () => {
    await serve(createApp({ merchantHealthUrl: 'http://127.0.0.1:9/health' }), async (base) => {
      const body = await (await fetch(`${base}/api/health`)).json();
      assert.equal(body.api, 'up');
      assert.equal(body.rules, 'ok');
      assert.equal(body.merchant, 'down');
      assert.match(body.message, /merchant is not answering/);
    });
  });

  test('unreadable rules fail closed: status refuses and health says why', async () => {
    const good = readFileSync(rulesCopy, 'utf8');
    writeFileSync(rulesCopy, '{ "budget": ');
    try {
      await serve(createApp({ merchantHealthUrl: 'http://127.0.0.1:9/health' }), async (base) => {
        const status = await fetch(`${base}/api/status`);
        assert.equal(status.status, 503);
        assert.equal((await status.json()).error, 'rules_unavailable');
        const health = await fetch(`${base}/api/health`);
        assert.equal(health.status, 503);
        assert.equal((await health.json()).rules, 'unreadable');
        const overCap = await post(base, '/api/demo/over-cap');
        assert.equal(overCap.status, 503);
      });
    } finally {
      writeFileSync(rulesCopy, good);
    }
  });
});
