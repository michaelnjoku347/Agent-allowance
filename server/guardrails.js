/**
 * Request guardrails for the allowance API: response headers, rate limits,
 * input shapes, and log redaction. Nothing here signs or pays. Every check
 * refuses when it is unsure.
 */

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const AMOUNT = /^\d{1,12}(\.\d{1,18})?$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SECRET_ENV = [
  'AGENT_PRIVATE_KEY',
  'MERCHANT_SUBMITTER_KEY',
  'JEV_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
];

export const LIMITS = Object.freeze({
  taskChars: 180,
  eveChars: 2000,
  merchants: 50,
  tokenChars: 128,
});

/** Same-origin, no sniffing, no framing. WebHID stays on for the Ledger. */
export function securityHeaders({ dashboard = false } = {}) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'hid=(self), camera=(), geolocation=(), microphone=(self), payment=()');
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
    } else if (dashboard) {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
      ].join('; '));
    }
    next();
  };
}

/**
 * Fixed-window counter per client and bucket. The API binds to localhost, so
 * this is a brake on a runaway script or a hostile page, not a DDoS shield.
 * `now` is injectable for tests. max <= 0 turns a bucket off.
 */
export function createRateLimiter({ windowMs = 60_000, max = 120, bucket = 'api', now = () => Date.now() } = {}) {
  const hits = new Map();
  let sweptAt = now();
  const limiter = (req, res, next) => {
    if (!(max > 0)) return next();
    const at = now();
    if (at - sweptAt > windowMs) {
      for (const [key, entry] of hits) if (at >= entry.reset) hits.delete(key);
      sweptAt = at;
    }
    const key = `${bucket}:${req.ip || req.socket?.remoteAddress || 'local'}`;
    let entry = hits.get(key);
    if (!entry || at >= entry.reset) {
      entry = { count: 0, reset: at + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retry = Math.max(1, Math.ceil((entry.reset - at) / 1000));
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({
        error: 'rate_limited',
        message: `Too many requests. Wait ${retry} second${retry === 1 ? '' : 's'} and try again. Nothing was paid.`,
        retryAfter: retry,
      });
    }
    return next();
  };
  limiter.reset = () => hits.clear();
  return limiter;
}

/** Limits from the environment. ALLOWANCE_RATE_LIMIT=0 turns them off for local load tests. */
export function rateLimitSettings(env = process.env) {
  const raw = String(env.ALLOWANCE_RATE_LIMIT ?? '').trim();
  const scale = raw === '' ? 1 : Number(raw);
  const factor = Number.isFinite(scale) && scale >= 0 ? scale : 1;
  return {
    reads: Math.round(1200 * factor),
    writes: Math.round(120 * factor),
    eve: Math.round(40 * factor),
  };
}

/** 400 for any :id that is not a short, plain identifier. */
export function validId(value) {
  return typeof value === 'string' && ID.test(value);
}

export function requireId(req, res, next) {
  if (validId(req.params.id)) return next();
  return res.status(400).json({ error: 'invalid', message: 'That id is not valid.' });
}

/** A write with a body must say it is JSON. A text/plain form cannot smuggle one in. */
export function requireJsonBody(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const length = Number(req.headers['content-length'] ?? 0);
  const chunked = /chunked/i.test(String(req.headers['transfer-encoding'] ?? ''));
  if ((length > 0 || chunked) && !req.is('application/json')) {
    return res.status(415).json({ error: 'unsupported_media_type', message: 'Send the request body as JSON.' });
  }
  return next();
}

/** express.json errors become a clear 400 or 413 instead of a stack trace. */
export function bodyErrors(error, req, res, next) {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'The request body is not valid JSON.' });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'too_large', message: 'The request body is too large.' });
  }
  return next(error);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Shape check for an allowance patch: budget, maxPerPurchase, expiresAt,
 * allowedMerchants. Unknown keys are refused so a typo never reads as "no change".
 * Returns { patch } or { error }.
 */
export function parseAllowancePatch(body) {
  if (!isPlainObject(body)) return { error: 'Send the allowance change as a JSON object.' };
  const allowed = new Set(['budget', 'maxPerPurchase', 'expiresAt', 'allowedMerchants']);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown field: ${unknown[0]}.` };
  const patch = {};
  for (const key of ['budget', 'maxPerPurchase']) {
    if (body[key] === undefined) continue;
    const text = typeof body[key] === 'number' && Number.isFinite(body[key]) ? String(body[key]) : body[key];
    if (typeof text !== 'string' || !AMOUNT.test(text.trim())) {
      return { error: `${key === 'budget' ? 'Budget' : 'Per-purchase cap'} must be a positive RLUSD amount.` };
    }
    patch[key] = text.trim();
  }
  if (body.expiresAt !== undefined) {
    if (typeof body.expiresAt !== 'string' || body.expiresAt.length > 40 || Number.isNaN(Date.parse(body.expiresAt))) {
      return { error: 'Expiry must be a date.' };
    }
    patch.expiresAt = body.expiresAt;
  }
  if (body.allowedMerchants !== undefined) {
    const list = body.allowedMerchants;
    if (!Array.isArray(list) || list.length === 0) return { error: 'Keep at least one merchant.' };
    if (list.length > LIMITS.merchants) return { error: `Keep the list to ${LIMITS.merchants} merchants or fewer.` };
    if (!list.every((item) => typeof item === 'string' && ADDRESS.test(item.trim()))) {
      return { error: 'Each merchant must be an 0x address with 40 hex characters.' };
    }
    patch.allowedMerchants = list.map((item) => item.trim());
  }
  if (Object.keys(patch).length === 0) return { error: 'Nothing to change.' };
  return { patch };
}

const AGENT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'’&()_-]{0,39}$/u;

/** An agent's display name: 1 to 40 letters, numbers, spaces, and simple punctuation. */
export function parseAgentName(value) {
  if (typeof value !== 'string') return { error: 'Name the agent with text.' };
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Give the agent a name.' };
  if (!AGENT_NAME.test(name)) return { error: 'Use up to 40 letters, numbers, spaces, or . , \' & ( ) - _.' };
  return { value: name };
}

/** Optional string field: undefined stays undefined, anything else must be a string. */
export function optionalString(value, max) {
  if (value === undefined || value === null) return { value: '' };
  if (typeof value !== 'string') return { error: 'Expected text.' };
  return { value: value.slice(0, max) };
}

/** Remove anything that could be a key or a credential before a line reaches the console. */
export function redact(text, env = process.env) {
  let out = String(text ?? '');
  for (const name of SECRET_ENV) {
    const secret = String(env[name] ?? '').trim();
    if (secret.length >= 8) out = out.split(secret).join(`[${name}]`);
  }
  // A 32-byte hex string may be a private key. Transaction hashes lose nothing useful in a log.
  out = out.replace(/\b(0x)?[0-9a-fA-F]{64}\b/g, '[redacted-hex]');
  out = out.replace(/(authorization|x-api-key|bearer)(["':=\s]+)[^\s"',}]+/gi, '$1$2[redacted]');
  return out;
}

export function logError(error, env = process.env) {
  console.error(redact(error?.message ?? error, env));
}
