import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  bedrockClientConfig,
  converse,
  createBedrockClient,
  parseModelJson,
  readBedrockSettings,
} from './bedrock.js';
import { answerEve } from './eve.js';

const REGION = 'us-east-1';
const MODEL = 'us.amazon.nova-micro-v1:0';
const TOKEN = 'test-bearer-token-do-not-log';

function bearerEnv(extra = {}) {
  return {
    AWS_REGION: REGION,
    BEDROCK_MODEL_ID: MODEL,
    AWS_BEARER_TOKEN_BEDROCK: TOKEN,
    ...extra,
  };
}

function mockClient(text, { fail } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command);
      if (fail) throw fail;
      return { output: { message: { content: [{ text }] } } };
    },
  };
}

const context = {
  spent: '1',
  rules: {
    budget: '20',
    maxPerPurchase: '5',
    expiresAt: '2026-12-31T23:59:59.000Z',
    allowedMerchants: [],
  },
  payments: [{
    id: 'pay_today',
    sample: false,
    status: 'paid',
    amount: '1',
    merchant: '0xa11cea11cea11cea11cea11cea11cea11cea11ce',
    merchantLabel: 'Field Weather Co',
    createdAt: new Date().toISOString(),
  }],
  pending: [{
    id: 'pend_cap',
    sample: false,
    status: 'pending',
    amount: '8',
    merchant: '0xa11cea11cea11cea11cea11cea11cea11cea11ce',
    merchantLabel: 'Field Weather Co',
    reason: 'over per-purchase cap',
  }],
};

describe('Bedrock settings', () => {
  test('a bearer token and a region configure Converse', async () => {
    const settings = readBedrockSettings(bearerEnv());
    assert.equal(settings.configured, true);
    assert.equal(settings.mode, 'bearer');
    const config = bedrockClientConfig(settings);
    assert.equal(config.region, REGION);
    assert.deepEqual(config.authSchemePreference, ['httpBearerAuth']);
    assert.equal((await config.token()).token, TOKEN);
    const client = createBedrockClient(settings);
    assert.equal(typeof client.send, 'function');
    client.destroy();
  });

  test('standard keys are used when no bearer token is set', () => {
    const settings = readBedrockSettings({
      AWS_DEFAULT_REGION: 'eu-central-1',
      BEDROCK_MODEL_ID: MODEL,
      AWS_ACCESS_KEY_ID: 'AKIA_TEST_ONLY',
      AWS_SECRET_ACCESS_KEY: 'secret-test-only',
      AWS_SESSION_TOKEN: 'session-test-only',
    });
    assert.equal(settings.configured, true);
    assert.equal(settings.mode, 'keys');
    assert.equal(settings.region, 'eu-central-1');
    const config = bedrockClientConfig(settings);
    assert.deepEqual(config.authSchemePreference, ['sigv4']);
    assert.equal(config.credentials.accessKeyId, 'AKIA_TEST_ONLY');
    assert.equal(config.credentials.sessionToken, 'session-test-only');
  });

  test('a bearer token wins when access keys are also present', () => {
    const settings = readBedrockSettings(bearerEnv({
      AWS_ACCESS_KEY_ID: 'AKIA_TEST_ONLY',
      AWS_SECRET_ACCESS_KEY: 'secret-test-only',
    }));
    assert.equal(settings.mode, 'bearer');
  });

  test('blank credentials leave Bedrock off', () => {
    assert.equal(readBedrockSettings({}).configured, false);
    assert.equal(readBedrockSettings({
      AWS_REGION: REGION,
      BEDROCK_MODEL_ID: MODEL,
      AWS_BEARER_TOKEN_BEDROCK: '   ',
      AWS_ACCESS_KEY_ID: 'AKIA_TEST_ONLY',
    }).configured, false);
    assert.equal(readBedrockSettings(bearerEnv({ BEDROCK_MODEL_ID: '' })).configured, false);
  });
});

describe('Bedrock Converse', () => {
  test('a mocked reply is returned and the token stays out of the request', async () => {
    const client = mockClient('{"reply":"hello","action":null}');
    const result = await converse({
      env: bearerEnv(),
      client,
      system: 'Reply in JSON.',
      user: 'What was spent?',
    });
    assert.equal(result.text, '{"reply":"hello","action":null}');
    assert.equal(result.modelId, MODEL);
    assert.equal(client.calls.length, 1);
    const input = client.calls[0].input;
    assert.equal(input.modelId, MODEL);
    assert.equal(input.messages[0].content[0].text, 'What was spent?');
    assert.equal(JSON.stringify(input).includes(TOKEN), false);
  });

  test('a fenced JSON object parses', () => {
    const parsed = parseModelJson('```json\n{"resourceId":null,"reason":"No fit"}\n```');
    assert.equal(parsed.resourceId, null);
    assert.equal(parsed.reason, 'No fit');
  });

  test('an empty reply and a transport error stay free of the token', async () => {
    await assert.rejects(
      converse({ env: bearerEnv(), client: mockClient('   ') }),
      (error) => error.code === 'BEDROCK_EMPTY' && !error.message.includes(TOKEN),
    );
    const denied = new Error(`denied ${TOKEN}`);
    denied.name = 'AccessDeniedException';
    await assert.rejects(
      converse({ env: bearerEnv(), client: mockClient('', { fail: denied }) }),
      (error) => {
        assert.equal(error.code, 'BEDROCK_REQUEST_FAILED');
        assert.equal(error.causeName, 'AccessDeniedException');
        assert.equal(error.message.includes(TOKEN), false);
        return true;
      },
    );
    await assert.rejects(
      converse({ env: {}, client: mockClient('hi') }),
      (error) => error.code === 'BEDROCK_UNCONFIGURED',
    );
  });
});

describe('Eve on Bedrock', () => {
  test('Bedrock writes the reply and a safe action', async () => {
    const client = mockClient(JSON.stringify({
      reply: 'The agent spent 1 RLUSD today on the weather brief.',
      action: null,
    }));
    let fetched = false;
    const answered = await answerEve('What did my agent spend today?', context, {
      env: bearerEnv({ LLM_API_KEY: 'llm-secret', LLM_BASE_URL: 'https://llm.example/v1' }),
      bedrockClient: client,
      fetchImpl: () => { fetched = true; },
    });
    assert.equal(fetched, false);
    assert.equal(answered.source, 'bedrock');
    assert.match(answered.reply, /1 RLUSD/);
    assert.equal(client.calls.length, 1);
    assert.equal(JSON.stringify(client.calls[0].input).includes(TOKEN), false);
    assert.equal(JSON.stringify(client.calls[0].input).includes('llm-secret'), false);
  });

  test('a rule change never reaches Bedrock, so it cannot claim it changed the cap', async () => {
    const client = mockClient(JSON.stringify({
      reply: 'I set the cap to 100.',
      action: { type: 'set_cap', amount: '100' },
    }));
    const answered = await answerEve('Set my cap to 100', context, {
      env: bearerEnv(),
      bedrockClient: client,
    });
    assert.equal(client.calls.length, 0);
    assert.equal(answered.source, 'rules');
    assert.equal(answered.action, undefined);
    assert.match(answered.reply, /I cannot change the allowance/);
    assert.match(answered.reply, /no more than the budget/);
  });

  test('Bedrock gets the ledger draft and its own action is dropped', async () => {
    const client = mockClient(JSON.stringify({
      reply: 'You have spent 1 RLUSD today.',
      action: { type: 'freeze' },
      ui: { type: 'navigate', route: 'security' },
    }));
    const answered = await answerEve('What did my agent spend today?', context, {
      env: bearerEnv(),
      bedrockClient: client,
    });
    assert.equal(answered.source, 'bedrock');
    assert.equal(answered.action, undefined);
    assert.equal(answered.ui, undefined);
    assert.match(JSON.stringify(client.calls[0].input), /Draft answer from the ledger/);
  });

  test('a Bedrock failure falls back to the built-in parser', async () => {
    const crash = new Error(`down ${TOKEN}`);
    crash.name = 'ThrottlingException';
    const client = mockClient('', { fail: crash });
    let fetched = false;
    const answered = await answerEve('Why was the last one blocked?', context, {
      env: bearerEnv(),
      bedrockClient: client,
      fetchImpl: () => { fetched = true; },
    });
    assert.equal(fetched, false);
    assert.equal(answered.source, 'rules');
    assert.match(answered.reply, /per-purchase cap/);
    assert.equal(answered.reply.includes(TOKEN), false);
  });

  test('with Bedrock down and an LLM configured, the LLM is next', async () => {
    const crash = new Error('down');
    crash.name = 'ServiceUnavailableException';
    const client = mockClient('', { fail: crash });
    const answered = await answerEve('hello there', context, {
      env: bearerEnv({ LLM_API_KEY: 'llm-secret', LLM_BASE_URL: 'https://llm.example/v1', LLM_MODEL: 'demo' }),
      bedrockClient: client,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ reply: 'From the fallback model.', action: null }) } }],
        }),
      }),
    });
    assert.equal(answered.source, 'llm');
    assert.equal(answered.reply, 'From the fallback model.');
  });

  test('no AWS credentials keeps the built-in parser and skips the client', async () => {
    let called = false;
    const answered = await answerEve('What did my agent spend today?', context, {
      env: {},
      bedrockClient: { send: () => { called = true; } },
    });
    assert.equal(called, false);
    assert.equal(answered.source, 'rules');
    assert.match(answered.reply, /1\.00 RLUSD/);
  });
});
