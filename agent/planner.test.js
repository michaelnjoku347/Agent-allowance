import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'allowance-plan-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');

const { finishQuote } = await import('./agent.js');
const { loadRules } = await import('./rules.js');
const { listPayments, listPending } = await import('../server/store.js');
const { planPurchase, selectResource } = await import('./planner.js');

for (const name of [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'BEDROCK_MODEL_ID',
]) {
  delete process.env[name];
}

const rules = loadRules();
const allowed = rules.allowedMerchants[0];
const env = {
  AWS_REGION: 'us-east-1',
  BEDROCK_MODEL_ID: 'us.amazon.nova-micro-v1:0',
  AWS_BEARER_TOKEN_BEDROCK: 'planner-test-token',
};
const catalog = [
  {
    id: 'weather-basic',
    description: 'Morning weather brief',
    price: '3',
    merchant: allowed,
  },
  {
    id: 'market-basic',
    description: 'Market pricing report',
    price: '8',
    merchant: '0xbee0bee0bee0bee0bee0bee0bee0bee0bee0bee0',
  },
];

function mockClient(payload) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command);
      const text = typeof payload === 'function' ? payload(command) : payload;
      return { output: { message: { content: [{ text }] } } };
    },
  };
}

function userPayload(command) {
  return JSON.parse(command.input.messages[0].content[0].text);
}

test('selectResource keeps prices and merchants in code and returns the catalog row', async () => {
  const client = mockClient('{"resourceId":"weather-basic","reason":"The task asks for the morning weather."}');
  const result = await selectResource('Buy the morning weather brief', catalog, { env, client });
  assert.equal(result.answered, true);
  assert.equal(result.resource.id, 'weather-basic');
  assert.equal(result.resource.price, '3');
  assert.equal(result.resource.merchant, allowed);
  const sent = userPayload(client.calls[0]);
  assert.deepEqual(sent.catalog, [
    { id: 'weather-basic', description: 'Morning weather brief' },
    { id: 'market-basic', description: 'Market pricing report' },
  ]);
  assert.equal(JSON.stringify(sent).includes('"price"'), false);
  assert.equal(JSON.stringify(sent).includes(allowed), false);
  assert.equal(JSON.stringify(client.calls[0].input).includes('planner-test-token'), false);
  assert.match(client.calls[0].input.system[0].text, /Never invent resources/);
});

test('a null selection is an answer and an unknown id is not', async () => {
  const none = await selectResource('Buy something unclear', catalog, {
    env,
    client: mockClient('{"resourceId":null,"reason":"Which brief do you want?"}'),
  });
  assert.equal(none.answered, true);
  assert.equal(none.resource, null);
  assert.match(none.reason, /Which brief/);

  const unknown = await selectResource('Buy the weather', catalog, {
    env,
    client: mockClient('{"resourceId":"made-up","reason":"Invented."}'),
  });
  assert.equal(unknown.answered, false);
  assert.equal(unknown.resource, null);
  assert.match(unknown.reason, /Invalid AI response/);

  const fenced = await selectResource('Buy the weather', catalog, {
    env,
    client: mockClient('```json\n{"resourceId":"weather-basic","reason":"Weather fits."}\n```'),
  });
  assert.equal(fenced.answered, true);
  assert.equal(fenced.resource.id, 'weather-basic');
});

test('a Bedrock transport error does not echo the token or authorize a purchase', async () => {
  const crash = new Error('planner-test-token leaked');
  crash.name = 'AccessDeniedException';
  const client = {
    async send() {
      throw crash;
    },
  };
  const result = await selectResource('Buy the weather', catalog, { env, client });
  assert.equal(result.answered, false);
  assert.equal(result.resource, null);
  assert.match(result.reason, /AccessDeniedException/);
  assert.equal(result.reason.includes('planner-test-token'), false);
});

test('planPurchase sends allowance figures and keeps the merchant address local', async () => {
  const client = mockClient('{"resourceId":"quoted-resource","reason":"The brief matches the task."}');
  const plan = await planPurchase({
    task: 'Buy the morning weather brief',
    quote: { description: 'Morning weather brief', amount: '1', merchant: allowed },
    rules,
  }, { env, client });
  assert.equal(plan.source, 'bedrock');
  assert.equal(plan.resourceId, 'quoted-resource');
  const sent = userPayload(client.calls[0]);
  assert.equal(sent.rules.budget, '20');
  assert.equal(sent.rules.maxPerPurchase, '5');
  assert.equal(sent.catalog[0].description, 'Morning weather brief');
  assert.equal(JSON.stringify(sent).includes(allowed), false);
  assert.equal(JSON.stringify(sent).includes('"price"'), false);
});

test('missing credentials skip the model', async () => {
  let called = false;
  const result = await selectResource('Buy the weather', catalog, {
    env: {},
    client: { send() { called = true; } },
  });
  assert.equal(called, false);
  assert.equal(result.answered, false);
  assert.match(result.reason, /missing/);
  assert.equal(await planPurchase({ task: 'Buy the weather', quote: { description: 'Brief', amount: '1' } }, { env: {} }), null);
});

function quote(amount, merchant) {
  return {
    amount,
    amountWei: `${BigInt(amount) * 10n ** 18n}`,
    merchant,
    description: 'Morning weather brief',
    resourceUrl: 'http://127.0.0.1:4308/resource',
  };
}

test('a Bedrock plan is saved and cannot block a quote the rules allow', async () => {
  let paid = 0;
  const result = await finishQuote({
    task: 'Buy the morning weather brief',
    resourceUrl: 'http://127.0.0.1:4308/resource',
    quote: quote('1', allowed),
    rules,
    spent: '0',
    plan: async () => ({
      source: 'bedrock',
      resourceId: 'quoted-resource',
      reason: 'The quoted brief matches the task.',
    }),
    pay: async () => {
      paid += 1;
      return { transactionHash: `0x${'ab'.repeat(32)}`, claimId: 'claim-plan' };
    },
    report: async () => ({ claimId: 'claim-plan', payoutTx: null, receiptUrl: null }),
  });
  assert.equal(paid, 1);
  assert.equal(result.decision, 'allow');
  const payments = await listPayments();
  const row = payments.find((item) => item.claimId === 'claim-plan');
  assert.equal(row.plan.source, 'bedrock');
  assert.equal(row.plan.reason, 'The quoted brief matches the task.');
});

test('rules still block an 8 RLUSD quote after Bedrock says to buy it', async () => {
  let reviewed = false;
  let paid = 0;
  const result = await finishQuote({
    task: 'Buy the extended market history',
    resourceUrl: 'http://127.0.0.1:4308/demo/over-cap',
    quote: quote('8', allowed),
    rules,
    spent: '0',
    plan: async () => ({ source: 'bedrock', resourceId: 'quoted-resource', reason: 'Buy it.' }),
    review: async () => { reviewed = true; },
    pay: async () => { paid += 1; },
  });
  assert.equal(reviewed, false);
  assert.equal(paid, 0);
  assert.equal(result.decision, 'needs_approval');
  assert.equal(result.reason, 'over per-purchase cap');
  const pending = await listPending();
  const row = pending.find((item) => item.amount === '8' && item.task === 'Buy the extended market history');
  assert.equal(row.plan.reason, 'Buy it.');
  assert.equal(row.plan.source, 'bedrock');
});

test('Jev can still hold an allowed quote that Bedrock planned', async () => {
  let paid = 0;
  const result = await finishQuote({
    task: 'Buy the morning weather brief',
    resourceUrl: 'http://127.0.0.1:4308/resource',
    quote: quote('1', allowed),
    rules,
    spent: '0',
    plan: async () => ({ source: 'bedrock', resourceId: 'quoted-resource', reason: 'It fits.' }),
    review: async () => ({
      decision: 'needs_approval',
      jev: {
        source: 'jev',
        needed: 0.2,
        risk: 5,
        review: 0.9,
        confidence: 0.8,
        reason: 'Jev flagged for review',
      },
    }),
    pay: async () => { paid += 1; },
  });
  assert.equal(paid, 0);
  assert.equal(result.decision, 'needs_approval');
  assert.equal(result.reason, 'Jev flagged for review');
  const pending = await listPending();
  assert.equal(pending.some((item) => item.reason === 'Jev flagged for review' && item.plan?.reason === 'It fits.'), true);
});

test('a plan failure leaves the rules decision unchanged', async () => {
  let paid = 0;
  const result = await finishQuote({
    task: 'Buy the morning weather brief',
    resourceUrl: 'http://127.0.0.1:4308/resource',
    quote: quote('1', allowed),
    rules,
    spent: '0',
    plan: async () => { throw new Error('planner-test-token'); },
    pay: async () => {
      paid += 1;
      return { transactionHash: `0x${'cd'.repeat(32)}` };
    },
    report: async () => ({ claimId: null, payoutTx: null, receiptUrl: null }),
  });
  assert.equal(paid, 1);
  assert.equal(result.decision, 'allow');
  assert.equal(result.plan, null);
  rmSync(dir, { recursive: true, force: true });
});
