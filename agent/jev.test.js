import assert from 'node:assert/strict';
import test from 'node:test';
import { applyJevPolicy, askJev, readJevAnswers } from './jev.js';

const allowed = { decision: 'allow', reason: 'within allowance' };
const blocked = { decision: 'needs_approval', reason: 'merchant not allowed' };

function answers(overrides = {}) {
  return {
    answers: {
      needed: { noul: 0.82 },
      review: { noul: 0.12 },
      risk: { score: 1, confidence: 0.7 },
      ...overrides,
    },
  };
}

test('reads answers from the nested object or the top level', () => {
  const nested = readJevAnswers(answers());
  assert.equal(nested.needed, 0.82);
  assert.equal(nested.review, 0.12);
  assert.equal(nested.risk, 1);
  assert.equal(nested.confidence, 0.7);
  const flat = readJevAnswers(answers().answers);
  assert.deepEqual(flat, nested);
  assert.equal(readJevAnswers({ answers: { needed: { noul: 0.2 } } }), null);
});

test('no key uses the rules and does not call Jev', async () => {
  let called = false;
  const result = await askJev({ rulesDecision: allowed }, {
    env: {},
    fetchImpl: () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(result.decision, 'allow');
  assert.equal(result.jev.source, 'fallback');
  assert.equal(result.jev.reason, 'Jev unavailable — rules only');
});

test('a timeout falls back to the rules and still allows the purchase', async () => {
  const result = await askJev({ rulesDecision: allowed }, {
    env: { JEV_API_KEY: 'test-key', JEV_API_URL: 'https://thejevai.com' },
    timeoutMs: 15,
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      assert.equal(url, 'https://thejevai.com/v1/systemone');
      options.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }),
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.jev.source, 'fallback');
});

test('a rules block is not sent to Jev and cannot be overridden', async () => {
  let called = false;
  const result = await askJev({ rulesDecision: blocked }, {
    env: { JEV_API_KEY: 'test-key' },
    fetchImpl: () => { called = true; return { ok: true, json: async () => answers() }; },
  });
  assert.equal(called, false);
  assert.equal(result.decision, 'needs_approval');
  assert.equal(result.jev.reason, 'merchant not allowed');
  const forced = applyJevPolicy(blocked, { source: 'jev', needed: 0.99, review: 0, risk: 0, confidence: 1 });
  assert.equal(forced.decision, 'needs_approval');
  assert.equal(forced.jev.reason, 'merchant not allowed');
});

test('high risk, low need, or a review flag holds the purchase', async () => {
  const env = { JEV_API_KEY: 'test-key', JEV_API_URL: 'https://thejevai.com/' };
  async function respond(body) {
    return askJev({ rulesDecision: allowed, amount: '1' }, {
      env,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://thejevai.com/v1/systemone');
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        const sent = JSON.parse(options.body);
        assert.equal(sent.questions.risk.type, 'score');
        assert.equal(sent.model, 'typesafe/jev-1.13');
        return { ok: true, json: async () => body };
      },
    });
  }

  const risky = await respond(answers({ risk: { score: 3, confidence: 0.66 } }));
  assert.equal(risky.decision, 'needs_approval');
  assert.equal(risky.jev.reason, 'Jev flagged for review');
  assert.equal(risky.jev.source, 'jev');
  assert.equal(risky.jev.risk, 3);

  const unneeded = await respond(answers({ needed: { noul: 0.39 } }));
  assert.equal(unneeded.decision, 'needs_approval');

  const review = await respond(answers({ review: { noul: 0.5 } }));
  assert.equal(review.decision, 'needs_approval');

  const fine = await respond(answers());
  assert.equal(fine.decision, 'allow');
  assert.equal(fine.jev.source, 'jev');

  const kev = await askJev({ rulesDecision: allowed }, {
    env: { JEV_API_KEY: 'test-key', JEV_API_URL: 'https://kev.example' },
    fetchImpl: async () => ({ ok: true, json: async () => answers() }),
  });
  assert.equal(kev.jev.source, 'kev');
  assert.equal(kev.decision, 'allow');
});

test('an error response falls back instead of blocking', async () => {
  const result = await askJev({ rulesDecision: allowed }, {
    env: { JEV_API_KEY: 'test-key' },
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: 'nope' }) }),
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.jev.source, 'fallback');
});
