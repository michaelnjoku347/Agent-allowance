/**
 * Eve answers questions about the allowance and prepares changes.
 * She never approves, declines, or edits the rules until a person confirms.
 */

import { randomBytes } from 'node:crypto';
import { loadRules, presentRules, updateAllowance } from '../agent/rules.js';
import { plainReason, jevSourceLabel } from '../shared/words.js';
import { approvePending, declinePending, readStore, spentRlusd } from './store.js';

const CONFIRM_MS = 120_000;

export { plainReason, jevSourceLabel };

function merchantName(item) {
  return item?.merchantLabel || item?.merchant || 'the merchant';
}

function dayKey(iso, now = new Date()) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const date = iso ? new Date(iso) : now;
  if (Number.isNaN(date.getTime())) return '';
  return format.format(date);
}

export function createConfirmations(now = () => Date.now()) {
  const tokens = new Map();
  return {
    issue(action) {
      const token = randomBytes(16).toString('hex');
      tokens.set(token, { action, exp: now() + CONFIRM_MS });
      return token;
    },
    take(token) {
      const row = tokens.get(String(token ?? ''));
      if (!row) return null;
      tokens.delete(String(token));
      if (row.exp <= now()) return null;
      return row.action;
    },
  };
}

export async function loadEveContext() {
  const store = await readStore();
  const rules = presentRules(loadRules());
  const payments = (store.payments ?? []).filter((item) => !item.sample);
  const pending = (store.pending ?? []).filter((item) => item.status === 'pending' && !item.sample);
  return {
    payments,
    pending,
    rules,
    spent: await spentRlusd(),
  };
}

function findPending(text, context) {
  const id = context.pending.find((item) => text.includes(item.id));
  return id ?? context.pending[0] ?? null;
}

/** Rule-based intents. Used when no LLM key is set, and when the LLM fails. */
export function ruleAnswer(message, context) {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  if (!text) {
    return { reply: 'Ask what was spent, why something was blocked, or to change the cap.' };
  }

  if (/\b(help|what can you)\b/.test(lower)) {
    return {
      reply: 'I can tell you what was spent today, why the last purchase was blocked, and what is waiting. I can prepare an approval, a decline, or a new cap or budget. I ask you to confirm before anything changes.',
    };
  }

  const capMatch = lower.match(/\bcap\b[^0-9]{0,16}(\d+(?:\.\d+)?)/);
  if (capMatch) {
    const amount = capMatch[1];
    const cap = Number(amount);
    const budget = Number(context.rules.budget);
    if (!(cap > 0) || cap > budget) {
      return {
        reply: `The cap has to be greater than 0 and no more than the budget of ${context.rules.budget} RLUSD.`,
      };
    }
    return {
      reply: `I can set the per-purchase cap to ${amount} RLUSD after you confirm.`,
      action: { type: 'set_cap', amount },
    };
  }

  const budgetMatch = lower.match(/\bbudget\b[^0-9]{0,16}(\d+(?:\.\d+)?)/);
  if (budgetMatch) {
    const amount = budgetMatch[1];
    const next = Number(amount);
    const cap = Number(context.rules.maxPerPurchase);
    if (!(next > 0) || next < cap) {
      return {
        reply: `The budget has to be greater than 0 and at least the per-purchase cap of ${context.rules.maxPerPurchase} RLUSD.`,
      };
    }
    return {
      reply: `I can set the budget to ${amount} RLUSD after you confirm.`,
      action: { type: 'set_budget', amount },
    };
  }

  if (/\b(approve)\b/.test(lower)) {
    const item = findPending(text, context);
    if (!item) return { reply: 'Nothing is waiting for approval.' };
    return {
      reply: `I can approve ${item.amount} RLUSD to ${merchantName(item)} after you confirm. Nothing is signed until you do.`,
      action: { type: 'approve', id: item.id },
    };
  }

  if (/\b(decline|reject)\b/.test(lower)) {
    const item = findPending(text, context);
    if (!item) return { reply: 'Nothing is waiting to decline.' };
    return {
      reply: `I can decline ${item.amount} RLUSD to ${merchantName(item)} after you confirm.`,
      action: { type: 'decline', id: item.id },
    };
  }

  if (/\b(why|blocked|block)\b/.test(lower)) {
    const last = context.pending[0];
    if (!last) return { reply: 'Nothing is blocked right now.' };
    return {
      reply: `The last blocked purchase was ${last.amount} RLUSD to ${merchantName(last)}. ${plainReason(last.reason)}`,
    };
  }

  if (/\b(pending|waiting|approval)\b/.test(lower)) {
    if (!context.pending.length) return { reply: 'Nothing is waiting for approval.' };
    const lines = context.pending.map((item) => (
      `${item.amount} RLUSD to ${merchantName(item)} — ${plainReason(item.reason)}`
    ));
    return { reply: `Waiting for you:\n${lines.join('\n')}` };
  }

  if (/\b(spend|spent|spending)\b/.test(lower)) {
    const today = dayKey();
    const rows = context.payments.filter((item) => item.status === 'paid' && dayKey(item.createdAt) === today);
    const total = rows.reduce((sum, item) => sum + Number(item.amount), 0);
    if (!rows.length) {
      return { reply: `The agent has not spent any RLUSD today. ${context.spent} RLUSD is spent in total.` };
    }
    const noun = rows.length === 1 ? 'payment' : 'payments';
    return {
      reply: `Today the agent spent ${total.toFixed(2)} RLUSD across ${rows.length} ${noun}. ${context.spent} RLUSD is spent in total.`,
    };
  }

  return {
    reply: 'I can tell you what was spent today, why the last purchase was blocked, and what is waiting. Say "set my cap to 3" or "approve the pending purchase" and I will ask you to confirm.',
  };
}

export function confirmationSummary(action, context) {
  if (action.type === 'set_cap') return `Set the per-purchase cap to ${action.amount} RLUSD?`;
  if (action.type === 'set_budget') return `Set the budget to ${action.amount} RLUSD?`;
  const item = context.pending.find((row) => row.id === action.id) ?? context.pending[0];
  const name = merchantName(item);
  const amount = item?.amount ?? '';
  if (action.type === 'decline') return `Decline ${amount} RLUSD to ${name}?`;
  return `Approve ${amount} RLUSD to ${name}?`;
}

async function answerWithLlm(message, context, env, fetchImpl) {
  const base = (env.LLM_BASE_URL || '').trim().replace(/\/$/, '');
  if (!base) throw new Error('LLM_BASE_URL is not set.');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const model = env.LLM_MODEL?.trim() || 'gpt-4o-mini';
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${env.LLM_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'You are Eve, the allowance assistant. Answer only from the JSON context.',
            'Do not invent payments. Return JSON {"reply":"...","action":null}',
            'action is null or one of',
            '{"type":"approve","id":"..."} {"type":"decline","id":"..."}',
            '{"type":"set_cap","amount":"3"} {"type":"set_budget","amount":"20"}.',
            'Never claim a change already happened. A person confirms it separately.',
            `Context: ${JSON.stringify({
              rules: context.rules,
              spent: context.spent,
              pending: context.pending.map((item) => ({
                id: item.id,
                amount: item.amount,
                merchant: item.merchantLabel || item.merchant,
                reason: item.reason,
              })),
              payments: context.payments.slice(0, 12).map((item) => ({
                id: item.id,
                amount: item.amount,
                status: item.status,
                merchant: item.merchantLabel || item.merchant,
                createdAt: item.createdAt,
              })),
            })}`,
          ].join(' '),
        },
        { role: 'user', content: message },
      ],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('LLM request failed.');
  const content = payload?.choices?.[0]?.message?.content ?? '';
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    throw new Error('LLM reply was empty.');
  }
  const action = normalizeAction(parsed.action, context);
  return { reply: parsed.reply.trim(), action };
}

function normalizeAction(action, context) {
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'approve' || action.type === 'decline') {
    const item = context.pending.find((row) => row.id === action.id) ?? context.pending[0];
    if (!item) return null;
    return { type: action.type, id: item.id };
  }
  if (action.type === 'set_cap' || action.type === 'set_budget') {
    const amount = String(action.amount ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(amount)) return null;
    return { type: action.type, amount };
  }
  return null;
}

export async function answerEve(message, context, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (env.LLM_API_KEY?.trim()) {
    try {
      return await answerWithLlm(message, context, env, fetchImpl);
    } catch {
      return ruleAnswer(message, context);
    }
  }
  return ruleAnswer(message, context);
}

export async function executeConfirmed(action) {
  if (!action || typeof action !== 'object') return { error: 'That confirmation is not valid.' };
  if (action.type === 'approve') {
    const result = await approvePending(action.id);
    if (result.error === 'invalid') return { error: 'That approval id is not valid.' };
    if (result.missing) return { error: 'missing' };
    return {
      reply: `Approved ${result.approved.amount} RLUSD to ${merchantName(result.approved)}. Nothing was signed or paid.`,
      payment: result.approved,
    };
  }
  if (action.type === 'decline') {
    const result = await declinePending(action.id);
    if (result.error === 'invalid') return { error: 'That decline id is not valid.' };
    if (result.missing) return { error: 'missing' };
    return {
      reply: `Declined ${result.declined.amount} RLUSD to ${merchantName(result.declined)}. Nothing was signed or paid.`,
      payment: result.declined,
    };
  }
  if (action.type === 'set_cap' || action.type === 'set_budget') {
    const patch = action.type === 'set_cap'
      ? { maxPerPurchase: action.amount }
      : { budget: action.amount };
    let result;
    try {
      result = updateAllowance(patch);
    } catch (error) {
      return { error: error.message ?? 'That amount is not valid.' };
    }
    if (result.error) return { error: result.error };
    const label = action.type === 'set_cap' ? 'per-purchase cap' : 'budget';
    const value = action.type === 'set_cap' ? result.rules.maxPerPurchase : result.rules.budget;
    return { reply: `The ${label} is now ${value} RLUSD. Nothing was paid.` };
  }
  return { error: 'That confirmation is not valid.' };
}
