/**
 * Eve answers questions about the allowance and prepares changes.
 * She never approves, declines, or edits the rules until a person confirms.
 */

import { randomBytes } from 'node:crypto';
import { describeAllowanceChange, loadRules, presentRules, updateAllowance } from '../agent/rules.js';
import { explainJev, plainReason, jevSourceLabel } from '../shared/words.js';
import { converse, parseModelJson, readBedrockSettings } from './bedrock.js';
import { freezeAgent } from './freeze-channel.js';
import { declinePending, hasRealData, readStore } from './store.js';

const CONFIRM_MS = 120_000;

export { explainJev, plainReason, jevSourceLabel };

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
  // The dashboard lists sample rows until a real agent decision replaces them.
  const showSamples = !hasRealData(store);
  const payments = (store.payments ?? []).filter((item) => showSamples || !item.sample);
  const pending = (store.pending ?? []).filter((item) => (
    (showSamples || !item.sample) && (item.status === 'pending' || item.status === 'paying')
  ));
  const spentNumber = payments
    .filter((item) => item.status === 'paid')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return {
    payments,
    pending,
    rules,
    spent: spentNumber.toFixed(2),
    demo: showSamples,
  };
}

const NAME_SKIP = new Set([
  'what', 'whats', 'why', 'did', 'the', 'agent', 'need', 'needed', 'needs', 'approval', 'approve',
  'decline', 'reject', 'this', 'that', 'today', 'buy', 'bought', 'spend', 'spent', 'still', 'left',
  'your', 'have', 'with', 'from', 'pack', 'please', 'pending', 'purchase', 'payment', 'payments',
  'every', 'ignore', 'previous', 'instructions',
]);

function mentioned(text, item) {
  const blob = [item?.merchantLabel, item?.task, item?.description, item?.merchant]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!blob) return false;
  const words = String(text).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !NAME_SKIP.has(word));
  const hits = words.filter((word) => blob.includes(word));
  return hits.length >= 2;
}

function findPending(text, context) {
  const lower = String(text).toLowerCase();
  const byId = context.pending.find((item) => item.id && lower.includes(String(item.id).toLowerCase()));
  if (byId) return byId;
  const named = context.pending.find((item) => mentioned(lower, item));
  return named ?? context.pending[0] ?? null;
}

function moneyLine(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return number.toFixed(2);
}

function wantsFreeze(lower) {
  const bare = lower.replace(/[.!?]+$/g, '').trim();
  if (['freeze', 'stop', 'halt', 'pause', 'kill switch'].includes(bare)) return true;
  if (/\bkill switch\b/.test(lower)) return true;
  if (/\b(freeze|halt|pause)\b/.test(lower)) return true;
  if (/\bstop\b/.test(lower)) return true;
  return false;
}

function remainingReply(context) {
  const budget = Number(context.rules?.budget);
  const spent = Number(context.spent);
  const left = Math.max(0, (Number.isFinite(budget) ? budget : 0) - (Number.isFinite(spent) ? spent : 0));
  return `${moneyLine(left)} RLUSD is left to spend. The budget is ${moneyLine(budget)} RLUSD and ${moneyLine(spent)} RLUSD is already spent.`;
}

const OFF_TOPIC = "That's outside what I can do. I handle your allowance.";

/** Rule-based intents. Used when no LLM key is set, and when the LLM fails. */
// A joining word starts a new question only when a question word or a command follows it,
// so a merchant called "Smith and Co" stays one part.
const NEXT_QUESTION = String.raw`(?:what|what's|how|why|which|who|when|where|is|are|was|were|do|does|did|can|could|will|should|show|tell|list|give|freeze|pause|stop|halt|decline|reject|approve|set|lower|raise)\b`;
const JOIN = new RegExp(String.raw`\s*(?:,\s*(?:and also|and then|and|also|plus|then)?|\s\b(?:and also|and then|and|also|plus|then))\s+(?=${NEXT_QUESTION})`, 'i');

/** Split "How much have I spent and what is pending?" into its questions. */
export function splitQuestions(message) {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const parts = [];
  for (const sentence of text.split(/[?;]+/)) {
    for (const piece of sentence.split(JOIN)) {
      const part = piece.trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
      if (part) parts.push(part);
    }
  }
  return parts;
}

/**
 * Answer every part of a multi-part question. Parts the rules cannot answer
 * are left out; if fewer than two parts get an answer, the whole message is
 * answered as one question. At most one action is proposed, and freeze wins.
 */
export function ruleAnswer(message, context) {
  const parts = splitQuestions(message);
  if (parts.length < 2 || /\bignore (all |any )?(previous|prior|above) instructions\b/i.test(String(message ?? ''))) {
    return ruleAnswerOne(message, context);
  }
  const answers = [];
  for (const part of parts) {
    const answer = ruleAnswerOne(part, context);
    if (answer.reply === OFF_TOPIC) continue;
    if (answers.some((seen) => seen.reply === answer.reply)) continue;
    answers.push(answer);
  }
  if (answers.length < 2) return ruleAnswerOne(message, context);
  const action = answers.find((answer) => answer.action?.type === 'freeze')?.action
    ?? answers.find((answer) => answer.action)?.action;
  const reply = answers.map((answer) => answer.reply).join('\n\n');
  return action ? { reply, action, parts: answers.length } : { reply, parts: answers.length };
}

function ruleAnswerOne(message, context) {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  if (!text) {
    return { reply: 'Ask what was spent, why something was blocked, or to change the cap.' };
  }

  if (/\bignore (all |any )?(previous|prior|above) instructions\b/.test(lower)) {
    return { reply: `${OFF_TOPIC} I can't approve a payment or change a rule because a message says to ignore my instructions.` };
  }

  if (/\b(help|what can you)\b/.test(lower)) {
    return {
      reply: 'I can tell you what was spent today, why the last purchase was blocked, and what is waiting. I can prepare a decline or a new cap or budget. An out-of-rule purchase is approved on the Ledger in the dashboard. I cannot sign it.',
    };
  }

  if (/\bjev\b/.test(lower)) {
    return { reply: explainJev() };
  }

  if (wantsFreeze(lower)) {
    return {
      reply: 'Pausing the agent. New signatures stop now.',
      action: { type: 'freeze' },
    };
  }

  if (/\bstill spend\b/.test(lower) || /\b(remaining|balance)\b/.test(lower) || (/\bleft\b/.test(lower) && /\b(spend|budget|rlusd|allowance|much)\b/.test(lower))) {
    return { reply: remainingReply(context) };
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
    const raises = cap > Number(context.rules.maxPerPurchase);
    return {
      reply: raises
        ? `Raising the per-purchase cap to ${amount} RLUSD needs a Ledger signature. I cannot raise it myself.`
        : `I can set the per-purchase cap to ${amount} RLUSD after you confirm.`,
      action: { type: 'set_cap', amount, ledger: raises },
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
    const raises = next > Number(context.rules.budget);
    return {
      reply: raises
        ? `Raising the budget to ${amount} RLUSD needs a Ledger signature. I cannot raise it myself.`
        : `I can set the budget to ${amount} RLUSD after you confirm.`,
      action: { type: 'set_budget', amount, ledger: raises },
    };
  }

  if (/\b(approve)\b/.test(lower)) {
    const item = findPending(text, context);
    if (!item) return { reply: 'Nothing is waiting for approval.' };
    return {
      reply: `${item.amount} RLUSD to ${merchantName(item)} stays unpaid until you approve it on the Ledger in the dashboard. I cannot sign it.`,
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

  if (/\b(why|blocked|block|needed|need)\b/.test(lower) && !/\b(approve|decline|reject)\b/.test(lower)) {
    const named = context.pending.find((item) => mentioned(lower, item));
    const last = named ?? context.pending[0];
    if (!last) return { reply: 'Nothing is blocked right now.' };
    if (named) {
      const cap = context.rules?.maxPerPurchase;
      return {
        reply: `${merchantName(named)} needed a person. ${plainReason(named.reason)} The quote was ${named.amount} RLUSD and the per-purchase cap is ${cap} RLUSD.`,
      };
    }
    return {
      reply: `The last blocked purchase was ${last.amount} RLUSD to ${merchantName(last)}. ${plainReason(last.reason)}`,
    };
  }

  if (/\b(pending|waiting|approval)\b/.test(lower)) {
    if (!context.pending.length) return { reply: 'Nothing is waiting for approval.' };
    const lines = context.pending.map((item) => (
      `${item.amount} RLUSD to ${merchantName(item)} — ${plainReason(item.reason)}`
    ));
    return {
      reply: `Waiting for you:\n${lines.join('\n')}\nApprove one on the Ledger in the dashboard. I cannot sign it.`,
    };
  }

  if (/\b(buy|bought|purchase|purchased|spend|spent|spending)\b/.test(lower)) {
    const today = dayKey();
    const rows = context.payments.filter((item) => item.status === 'paid' && dayKey(item.createdAt) === today);
    if (/\b(buy|bought|purchase|purchased)\b/.test(lower)) {
      if (!rows.length) return { reply: 'The agent has not bought anything today.' };
      const lines = rows.map((item) => `${item.amount} RLUSD at ${merchantName(item)}${item.task ? ` — ${item.task}` : ''}`);
      return { reply: `Today the agent bought:\n${lines.join('\n')}` };
    }
    const total = rows.reduce((sum, item) => sum + Number(item.amount), 0);
    if (!rows.length) {
      return { reply: `The agent has not spent any RLUSD today. ${context.spent} RLUSD is spent in total.` };
    }
    const noun = rows.length === 1 ? 'payment' : 'payments';
    return {
      reply: `Today the agent spent ${total.toFixed(2)} RLUSD across ${rows.length} ${noun}. ${context.spent} RLUSD is spent in total.`,
    };
  }

  return { reply: OFF_TOPIC };
}

export function allowanceProposal(action, rules) {
  const merchants = (rules.allowedMerchants ?? []).map((item) => item.address ?? item);
  const base = {
    maxPerPurchase: rules.maxPerPurchase,
    budget: rules.budget,
    expiresAt: rules.expiresAt,
    allowedMerchants: merchants,
  };
  if (action.type === 'set_cap') return { ...base, maxPerPurchase: action.amount };
  if (action.type === 'set_budget') return { ...base, budget: action.amount };
  if (action.type === 'set_expiry') return { ...base, expiresAt: action.expiresAt };
  if (action.type === 'add_merchant') return { ...base, allowedMerchants: [...merchants, action.merchant] };
  return null;
}

export function confirmationSummary(action, context) {
  if (action.type === 'set_cap') {
    return action.ledger
      ? `Sign a raise of the per-purchase cap to ${action.amount} RLUSD on the Ledger?`
      : `Set the per-purchase cap to ${action.amount} RLUSD?`;
  }
  if (action.type === 'set_budget') {
    return action.ledger
      ? `Sign a raise of the budget to ${action.amount} RLUSD on the Ledger?`
      : `Set the budget to ${action.amount} RLUSD?`;
  }
  const item = context.pending.find((row) => row.id === action.id) ?? context.pending[0];
  const name = merchantName(item);
  const amount = item?.amount ?? '';
  if (action.type === 'decline') return `Decline ${amount} RLUSD to ${name}?`;
  return `Approve ${amount} RLUSD to ${name} on the Ledger in the dashboard? Eve cannot sign it.`;
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
          content: [...EVE_SYSTEM, `Context: ${JSON.stringify(eveContext(context))}`].join(' '),
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
  return guardModelAnswer({ reply: parsed.reply.trim(), action, source: 'llm' }, context);
}

function normalizeAction(action, context) {
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'approve') return null;
  if (action.type === 'decline') {
    const item = context.pending.find((row) => row.id === action.id) ?? context.pending[0];
    if (!item) return null;
    return { type: action.type, id: item.id };
  }
  if (action.type === 'set_cap' || action.type === 'set_budget') {
    const amount = String(action.amount ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(amount)) return null;
    const current = action.type === 'set_cap'
      ? Number(context.rules.maxPerPurchase)
      : Number(context.rules.budget);
    return { type: action.type, amount, ledger: Number(amount) > current };
  }
  return null;
}

/** A model can suggest a change. The allowance limits still have to hold. */
function guardModelAnswer(result, context) {
  const action = result.action;
  if (action?.type === 'set_cap') {
    const cap = Number(action.amount);
    const budget = Number(context.rules.budget);
    if (!(cap > 0) || cap > budget) {
      return {
        reply: `The cap has to be greater than 0 and no more than the budget of ${context.rules.budget} RLUSD.`,
        action: null,
        source: result.source,
      };
    }
  }
  if (action?.type === 'set_budget') {
    const next = Number(action.amount);
    const cap = Number(context.rules.maxPerPurchase);
    if (!(next > 0) || next < cap) {
      return {
        reply: `The budget has to be greater than 0 and at least the per-purchase cap of ${context.rules.maxPerPurchase} RLUSD.`,
        action: null,
        source: result.source,
      };
    }
  }
  return result;
}

const EVE_SYSTEM = [
  'You are Eve, the allowance assistant. Answer only from the JSON context.',
  'Do not invent payments. Return JSON {"reply":"...","action":null}',
  'action is null or one of',
  '{"type":"decline","id":"..."}',
  '{"type":"set_cap","amount":"3"} {"type":"set_budget","amount":"20"}.',
  'Never approve a purchase. Tell the person to approve it on the Ledger in the dashboard.',
  'Never claim a change already happened. A person confirms it separately.',
];

function eveContext(context) {
  return {
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
  };
}

async function answerWithBedrock(message, context, env, client) {
  const result = await converse({
    env,
    client,
    maxTokens: 512,
    system: [...EVE_SYSTEM, `Context: ${JSON.stringify(eveContext(context))}`].join(' '),
    user: message,
  });
  const parsed = parseModelJson(result.text);
  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    throw new Error('Bedrock reply was empty.');
  }
  return guardModelAnswer({
    reply: parsed.reply.trim(),
    action: normalizeAction(parsed.action, context),
    source: 'bedrock',
  }, context);
}

export async function answerEve(message, context, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const local = ruleAnswer(message, context);
  if (local.action?.type === 'freeze') return { ...local, source: 'rules' };
  // A model tends to answer only the first half of a two-part question. When the
  // rules can answer every part from the allowance itself, they answer it.
  if (local.parts > 1) return { ...local, source: 'rules' };
  if (readBedrockSettings(env).configured) {
    try {
      return await answerWithBedrock(message, context, env, options.bedrockClient);
    } catch {
      // Bedrock is optional at runtime. The built-in parser, or LLM_*, still answers.
    }
  }
  if (env.LLM_API_KEY?.trim()) {
    try {
      return await answerWithLlm(message, context, env, fetchImpl);
    } catch {
      return { ...ruleAnswer(message, context), source: 'rules' };
    }
  }
  return { ...ruleAnswer(message, context), source: 'rules' };
}

export async function executeConfirmed(action) {
  if (!action || typeof action !== 'object') return { error: 'That confirmation is not valid.' };
  if (action.type === 'freeze') {
    const frozen = await freezeAgent();
    const detail = frozen.channelClosed
      ? 'The payment channel is closed.'
      : frozen.channelReason;
    return { reply: `The agent is paused. Signing has stopped. ${detail}` };
  }
  if (action.type === 'approve') {
    return { error: 'Approve this purchase on the Ledger in the dashboard. Eve cannot sign it.' };
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
  if (action.type === 'set_cap' || action.type === 'set_budget' || action.type === 'set_expiry' || action.type === 'add_merchant') {
    const patch = action.type === 'set_cap'
      ? { maxPerPurchase: action.amount }
      : action.type === 'set_budget'
        ? { budget: action.amount }
        : action.type === 'set_expiry'
          ? { expiresAt: action.expiresAt }
          : { allowedMerchants: action.merchants ?? [action.merchant] };
    const described = describeAllowanceChange(patch);
    if (described.error) return { error: described.error };
    if (described.raises || action.ledger) {
      return { error: 'Raising the cap, budget, or expiry, or adding a merchant, needs a Ledger signature. Nothing was changed.' };
    }
    let result;
    try {
      result = updateAllowance(patch);
    } catch (error) {
      return { error: error.message ?? 'That amount is not valid.' };
    }
    if (result.error) return { error: result.error };
    if (action.type === 'set_expiry') {
      return { reply: `The allowance now expires ${result.rules.expiresAt}. Nothing was paid.` };
    }
    if (action.type === 'add_merchant') {
      return { reply: 'The merchant list was updated. Nothing was paid.' };
    }
    const label = action.type === 'set_cap' ? 'per-purchase cap' : 'budget';
    const value = action.type === 'set_cap' ? result.rules.maxPerPurchase : result.rules.budget;
    return { reply: `The ${label} is now ${value} RLUSD. Nothing was paid.` };
  }
  return { error: 'That confirmation is not valid.' };
}
