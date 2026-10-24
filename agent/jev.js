/**
 * Jev reviews a purchase only after the allowance rules allow it.
 * A blocked rule is never overturned. If Jev cannot be reached, the rules decide
 * and the purchase is not held up.
 */

const DEFAULT_URL = 'https://thejevai.com';
const DEFAULT_MODEL = 'typesafe/jev-1.13';

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Pull needed, review, and risk out of a System One response. */
export function readJevAnswers(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : payload;
  const needed = numberOrNull(answers.needed?.noul);
  const review = numberOrNull(answers.review?.noul);
  const risk = numberOrNull(answers.risk?.score);
  const confidence = numberOrNull(answers.risk?.confidence);
  if (needed === null || review === null || risk === null) return null;
  return { needed, review, risk, confidence };
}

export function fallbackJev() {
  return {
    decision: 'allow',
    jev: {
      source: 'fallback',
      needed: null,
      risk: null,
      review: null,
      confidence: null,
      reason: 'Jev unavailable — rules only',
    },
  };
}

export function rulesOnlyJev(reason) {
  return {
    decision: 'needs_approval',
    jev: {
      source: 'rules',
      needed: null,
      risk: null,
      review: null,
      confidence: null,
      reason,
    },
  };
}

/** Hard rules win. Jev can only hold an allowed purchase for a person. */
export function applyJevPolicy(rulesDecision, jev) {
  if (!rulesDecision || rulesDecision.decision !== 'allow') {
    return rulesOnlyJev(rulesDecision?.reason || 'needs approval');
  }
  if (!jev || jev.source === 'fallback') return fallbackJev();
  const review = Number(jev.review);
  const needed = Number(jev.needed);
  const risk = Number(jev.risk);
  const flagged = review >= 0.5 || needed < 0.4 || risk >= 3;
  if (flagged) {
    return {
      decision: 'needs_approval',
      jev: {
        source: jev.source,
        needed: jev.needed,
        risk: jev.risk,
        review: jev.review,
        confidence: jev.confidence ?? null,
        reason: 'Jev flagged for review',
      },
    };
  }
  return {
    decision: 'allow',
    jev: {
      source: jev.source,
      needed: jev.needed,
      risk: jev.risk,
      review: jev.review,
      confidence: jev.confidence ?? null,
      reason: 'Jev would pay this.',
    },
  };
}

function sourceFor(apiUrl) {
  return /thejevai\.com/i.test(apiUrl) ? 'jev' : 'kev';
}

/**
 * Ask Jev (or a self-hosted Kev endpoint with the same API).
 * No key, a timeout, or a bad response becomes a rules-only fallback.
 */
export async function askJev(input, options = {}) {
  const rulesDecision = input?.rulesDecision ?? { decision: 'allow', reason: 'within allowance' };
  if (rulesDecision.decision !== 'allow') return rulesOnlyJev(rulesDecision.reason);

  const env = options.env ?? process.env;
  const key = env.JEV_API_KEY?.trim() ?? '';
  if (!key) return fallbackJev();

  const apiUrl = (env.JEV_API_URL?.trim() || DEFAULT_URL).replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${apiUrl}/v1/systemone`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: env.JEV_MODEL?.trim() || DEFAULT_MODEL,
        state: {
          purchase: input.purchase ?? null,
          task: input.task ?? '',
          merchant: input.merchant ?? '',
          amount: input.amount ?? '',
          rulesSummary: input.rulesSummary ?? null,
          recentPayments: input.recentPayments ?? [],
        },
        questions: {
          needed: { type: 'noul', instructions: 'Is this purchase necessary for the agent task?' },
          risk: {
            type: 'score',
            instructions: 'How risky is this purchase?',
            criteria: ['Very low', 'Low', 'Medium', 'High', 'Very high'],
          },
          review: { type: 'noul', instructions: 'Should a human review this purchase before payment?' },
        },
      }),
      signal: options.signal ?? controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return fallbackJev();
    const answers = readJevAnswers(payload);
    if (!answers) return fallbackJev();
    return applyJevPolicy(rulesDecision, { source: sourceFor(apiUrl), ...answers });
  } catch {
    return fallbackJev();
  } finally {
    clearTimeout(timer);
  }
}
