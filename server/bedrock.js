/**
 * Amazon Bedrock Runtime, Converse API.
 *
 * Eve and the purchase planner call this. It never signs a voucher and it
 * never decides that a quote may be paid. Credentials stay in the environment:
 * a Bedrock API key (AWS_BEARER_TOKEN_BEDROCK, the same variable the Python
 * planner uses) or standard AWS access keys, plus a region and a model id.
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const REQUEST_TIMEOUT_MS = 12_000;

export function readBedrockSettings(env = process.env) {
  const region = String(env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? '').trim();
  const modelId = String(env.BEDROCK_MODEL_ID ?? '').trim();
  const bearer = String(env.AWS_BEARER_TOKEN_BEDROCK ?? '').trim();
  const accessKeyId = String(env.AWS_ACCESS_KEY_ID ?? '').trim();
  const secretAccessKey = String(env.AWS_SECRET_ACCESS_KEY ?? '').trim();
  const sessionToken = String(env.AWS_SESSION_TOKEN ?? '').trim();
  const mode = bearer ? 'bearer' : (accessKeyId && secretAccessKey ? 'keys' : 'none');
  return {
    region,
    modelId,
    bearer,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    mode,
    configured: Boolean(region && modelId && mode !== 'none'),
  };
}

/** Client options for the two auth modes. Bearer wins when both are set. */
export function bedrockClientConfig(settings) {
  const config = { region: settings.region };
  if (settings.mode === 'bearer') {
    config.authSchemePreference = ['httpBearerAuth'];
    config.token = async () => ({ token: settings.bearer });
    return config;
  }
  config.authSchemePreference = ['sigv4'];
  config.credentials = {
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
  };
  if (settings.sessionToken) config.credentials.sessionToken = settings.sessionToken;
  return config;
}

export function createBedrockClient(settings) {
  return new BedrockRuntimeClient(bedrockClientConfig(settings));
}

/** Parse a model JSON object. A surrounding ```json fence is removed first. */
export function parseModelJson(text) {
  let raw = String(text ?? '').trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) raw = fenced[1].trim();
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new TypeError('Expected an object');
    error.code = 'BEDROCK_INVALID';
    throw error;
  }
  return parsed;
}

function safeFailure(error) {
  const name = error?.name || 'Error';
  const wrapped = new Error(`Bedrock request failed (${name}).`);
  wrapped.code = 'BEDROCK_REQUEST_FAILED';
  wrapped.causeName = name;
  return wrapped;
}

/**
 * Send one Converse turn.
 * Pass `client` in tests. A missing configuration throws BEDROCK_UNCONFIGURED
 * and does not open a connection.
 */
export async function converse({ system, user, env, client, maxTokens = 512 } = {}) {
  const settings = readBedrockSettings(env);
  if (!settings.configured) {
    const error = new Error('Bedrock is not configured.');
    error.code = 'BEDROCK_UNCONFIGURED';
    throw error;
  }
  const input = {
    modelId: settings.modelId,
    messages: [{ role: 'user', content: [{ text: String(user ?? '') }] }],
    inferenceConfig: { maxTokens, temperature: 0 },
  };
  if (system) input.system = [{ text: system }];
  const owned = client == null;
  const runtime = client ?? createBedrockClient(settings);
  let response;
  try {
    response = await runtime.send(new ConverseCommand(input), {
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw safeFailure(error);
  } finally {
    if (owned) runtime.destroy?.();
  }
  const blocks = response?.output?.message?.content;
  const text = Array.isArray(blocks)
    ? blocks.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('')
    : '';
  if (!text.trim()) {
    const error = new Error('Bedrock returned an empty reply.');
    error.code = 'BEDROCK_EMPTY';
    throw error;
  }
  return { text: text.trim(), modelId: settings.modelId };
}
