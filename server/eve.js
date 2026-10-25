/**
 * Eve, the account owner's assistant.
 *
 * Eve can READ everything the dashboard shows: the rules, the balance, every
 * payment, block, and approval, the audit log, the merchants, the payment
 * channel, the freeze state, spending trends, and planner decisions. She
 * answers with real numbers from the ledger, handles several questions in one
 * message, and suggests what to do next.
 *
 * Eve can also take safe UI actions in the dashboard: open a page, filter the
 * history, highlight a payment, export a CSV, open the allowance editor with a
 * draft, or open a purchase's approval sheet. Each of those only changes what
 * the person sees. The person still saves, signs, or approves.
 *
 * Hard boundary. Eve never signs, spends, moves funds, changes the rules or
 * the keys, or unfreezes the agent. Freeze and decline are only proposed:
 * nothing happens until the person presses Confirm, and the server runs the
 * confirmed action itself. A model, when one is configured, may only reword
 * an answer the rules engine already computed. It cannot add an action.
 */

import { randomBytes } from 'node:crypto';
import { formatRlusd, loadRules, presentRules, toUnits } from '../agent/rules.js';
import { peekChannel } from '../agent/chain-spend.js';
import { explainApproval } from '../shared/approval-why.js';
import { money } from '../shared/money.js';
import { explainJev, jevSourceLabel, plainReason } from '../shared/words.js';
import { converse, parseModelJson, readBedrockSettings } from './bedrock.js';
import { freezeAgent } from './freeze-channel.js';
import { declinePending, hasRealData, readStore, summarize } from './store.js';

const CONFIRM_MS = 120_000;
const DAY_MS = 86_400_000;

export { explainJev, plainReason, jevSourceLabel };

/* ------------------------------------------------------------------ */
/* Confirmations: a proposal becomes an action only after a person     */
/* ------------------------------------------------------------------ */

const CONFIRMABLE = new Set(['freeze', 'decline']);

/**
 * Single-use tokens for proposals. Each token belongs to the scope that asked
 * (a hosted demo visitor's sandbox; '' on a local install), so one visitor can
 * never confirm another's proposal. Expired tokens are dropped, and at most
 * `max` are kept, oldest first out, so unconfirmed proposals cannot pile up.
 */
export function createConfirmations(now = () => Date.now(), { max = 1000 } = {}) {
  const tokens = new Map();
  function prune() {
    const at = now();
    for (const [key, row] of tokens) if (row.exp <= at) tokens.delete(key);
    while (tokens.size >= max) tokens.delete(tokens.keys().next().value);
  }
  return {
    issue(action, scope = '') {
      if (!action || !CONFIRMABLE.has(action.type)) throw new Error('Eve can only propose a freeze or a decline.');
      prune();
      const token = randomBytes(16).toString('hex');
      tokens.set(token, { action, scope: String(scope ?? ''), exp: now() + CONFIRM_MS });
      return token;
    },
    take(token, scope = '') {
      const key = String(token ?? '');
      const row = tokens.get(key);
      if (!row || row.scope !== String(scope ?? '')) return null;
      tokens.delete(key);
      if (row.exp <= now()) return null;
      return row.action;
    },
    get size() {
      return tokens.size;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Context: everything Eve may read                                    */
/* ------------------------------------------------------------------ */

export async function loadEveContext({ channel = peekChannel } = {}) {
  const store = await readStore();
  const rules = loadRules();
  const summary = summarize(store, rules);
  // The dashboard lists sample rows until a real agent decision replaces them.
  const showSamples = !hasRealData(store);
  const payments = (store.payments ?? []).filter((item) => showSamples || !item.sample);
  const pending = (store.pending ?? []).filter((item) => (
    (showSamples || !item.sample) && (item.status === 'pending' || item.status === 'paying')
  ));
  let chain = null;
  try {
    const peeked = channel();
    chain = peeked?.chain ? { ...peeked.chain, unavailable: Boolean(peeked.unavailable) } : (peeked?.unavailable ? { unavailable: true } : null);
  } catch {
    chain = { unavailable: true };
  }
  const paid = sumRows(payments.filter((item) => item.status === 'paid'));
  return {
    rules: presentRules(rules),
    payments,
    pending,
    audit: summary.audit ?? [],
    spent: formatRlusd(paid),
    demo: showSamples,
    frozen: Boolean(summary.frozen),
    frozenAt: summary.frozenAt ?? null,
    channelClosed: Boolean(summary.channelClosed),
    freezeDetail: summary.freezeDetail ?? null,
    chain,
    mandate: summary.mandate ?? null,
    useCase: summary.useCase ?? null,
    simulatedLedger: process.env.ALLOWANCE_DEV_SIGNER === '1',
    bedrockConfigured: readBedrockSettings().configured,
  };
}

/* ------------------------------------------------------------------ */
/* Arithmetic and words                                                */
/* ------------------------------------------------------------------ */

function units(value) {
  try {
    return toUnits(String(value ?? '0').trim() || '0');
  } catch {
    return 0n;
  }
}

function sumRows(rows) {
  return rows.reduce((sum, item) => sum + units(item?.amount), 0n);
}

function rl(value) {
  const text = typeof value === 'bigint' ? formatRlusd(value) : value;
  return `${money(text)} RLUSD`;
}

function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

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

function shortDate(iso) {
  const ms = Date.parse(iso ?? '');
  if (Number.isNaN(ms)) return 'no date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms));
}

function ago(iso, now = Date.now()) {
  const ms = Date.parse(iso ?? '');
  if (Number.isNaN(ms)) return '';
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, 'hour')} ago`;
  return `${plural(Math.round(hours / 24), 'day')} ago`;
}

function daysUntil(iso, now = Date.now()) {
  const ms = Date.parse(iso ?? '');
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil((ms - now) / DAY_MS));
}

function isBlocked(item) {
  return Boolean(item?.declineOnly) || item?.reason === 'merchant not allowed' || item?.status === 'declined' || item?.status === 'skipped';
}

function waiting(context) {
  return (context.pending ?? []).filter((item) => !isBlocked(item));
}

function blockedRows(context) {
  return [...(context.payments ?? []), ...(context.pending ?? [])].filter(isBlocked);
}

function paidRows(context) {
  return (context.payments ?? []).filter((item) => item?.status === 'paid');
}

function activity(context) {
  return [...(context.payments ?? []), ...(context.pending ?? [])]
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

export function totalsOf(context) {
  const budget = units(context.rules?.budget);
  const spent = context.spent != null ? units(context.spent) : sumRows(paidRows(context));
  const left = budget > spent ? budget - spent : 0n;
  const held = sumRows(waiting(context));
  const ratio = budget === 0n ? 0 : Number((spent * 10_000n) / budget) / 10_000;
  return { budget, spent, left, held, ratio };
}

/* ------------------------------------------------------------------ */
/* Reading the question                                                */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  'what', 'whats', 'why', 'did', 'the', 'agent', 'need', 'needed', 'needs', 'approval', 'approve',
  'decline', 'reject', 'this', 'that', 'today', 'buy', 'bought', 'spend', 'spent', 'still', 'left',
  'your', 'have', 'with', 'from', 'pack', 'please', 'pending', 'purchase', 'payment', 'payments',
  'every', 'ignore', 'previous', 'instructions', 'show', 'blocked', 'much', 'many', 'last', 'week',
  'month', 'only', 'were', 'which', 'when', 'where', 'there', 'their', 'about', 'tell', 'list',
  'merchant', 'merchants', 'desk', 'allowed', 'paid', 'open', 'export',
]);

/** A merchant the message names, by label word or by address. */
export function merchantIn(text, context) {
  const lower = String(text ?? '').toLowerCase();
  const known = new Map();
  const add = (address, label) => {
    if (!address && !label) return;
    const key = String(address || label).toLowerCase();
    if (!known.has(key)) known.set(key, { address: String(address ?? '').toLowerCase(), label: label || null });
  };
  for (const item of context.rules?.allowedMerchants ?? []) add(item.address ?? item, item.label);
  for (const item of context.rules?.deniedMerchants ?? []) add(item.address, item.label);
  for (const item of activity(context)) add(item.merchant, item.merchantLabel);
  const words = lower.split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  let best = null;
  let bestHits = 0;
  for (const row of known.values()) {
    if (row.address && row.address.length >= 10 && lower.includes(row.address.slice(0, 10))) return row;
    const label = String(row.label ?? '').toLowerCase();
    if (!label) continue;
    if (lower.includes(label)) return row;
    const hits = words.filter((word) => label.split(/[^a-z0-9]+/).includes(word)).length;
    if (hits > bestHits) {
      best = row;
      bestHits = hits;
    }
  }
  return bestHits > 0 ? best : null;
}

function rowsFor(context, merchant) {
  if (!merchant) return activity(context);
  return activity(context).filter((item) => (
    (merchant.address && String(item.merchant ?? '').toLowerCase() === merchant.address)
    || (merchant.label && item.merchantLabel === merchant.label)
  ));
}

/** today | yesterday | 7d | 30d | all, from words in the question. */
export function periodIn(lower) {
  if (/\byesterday\b/.test(lower)) return 'yesterday';
  if (/\btoday\b|\bthis morning\b|\btonight\b/.test(lower)) return 'today';
  if (/\b(this|past|last) week\b|\b7 days\b|\bweekly\b/.test(lower)) return '7d';
  if (/\b(this|past|last) month\b|\b30 days\b|\bmonthly\b/.test(lower)) return '30d';
  if (/\b(all time|ever|in total|total|so far|overall|altogether)\b/.test(lower)) return 'all';
  return '';
}

function inPeriod(item, period, now = Date.now()) {
  if (!period || period === 'all') return true;
  const at = Date.parse(item?.createdAt ?? '');
  if (Number.isNaN(at)) return false;
  if (period === 'today') return dayKey(item.createdAt) === dayKey(null, new Date(now));
  if (period === 'yesterday') return dayKey(item.createdAt) === dayKey(null, new Date(now - DAY_MS));
  if (period === '7d') return now - at <= 7 * DAY_MS;
  if (period === '30d') return now - at <= 30 * DAY_MS;
  return true;
}

const PERIOD_WORDS = { today: 'today', yesterday: 'yesterday', '7d': 'in the last 7 days', '30d': 'in the last 30 days', all: 'in total', '': 'in total' };

function amountIn(lower) {
  const match = lower.match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

const QUESTION = /^(what|whats|what's|how|why|which|who|when|where|is|are|was|were|do|does|did|can|could|will|would|should|tell me|explain)\b/;

function isQuestion(lower) {
  return QUESTION.test(lower) || lower.endsWith('?');
}

/* ------------------------------------------------------------------ */
/* Multi-part questions                                                */
/* ------------------------------------------------------------------ */

// A joining word starts a new question only when a question word or a command follows it,
// so a merchant called "Smith and Co" stays one part.
const NEXT_QUESTION = String.raw`(?:what|what's|how|why|which|who|when|where|is|are|was|were|do|does|did|can|could|will|should|show|tell|list|give|freeze|pause|stop|halt|decline|reject|approve|set|lower|raise|open|export|filter|highlight|go)\b`;
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

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

const OFF_TOPIC = "That's outside what I can do. I handle your allowance.";

const BOUNDARY = 'I can read everything in your allowance, but I never sign, spend, move funds, change the rules, or unfreeze the agent.';

function statusLine(context) {
  const t = totalsOf(context);
  const parts = [`${rl(t.left)} left of ${rl(t.budget)}`];
  const count = waiting(context).length;
  if (count) parts.push(`${plural(count, 'purchase')} waiting for you`);
  if (context.frozen) parts.push('the agent is frozen');
  return `${parts.join(', ')}.`;
}

function whyFor(item, context) {
  const t = totalsOf(context);
  return explainApproval(item, {
    cap: context.rules?.maxPerPurchase,
    budget: context.rules?.budget,
    spent: formatRlusd(t.spent),
    expiresAt: context.rules?.expiresAt,
  });
}

function nextSteps(context, now = Date.now()) {
  const steps = [];
  const t = totalsOf(context);
  const open = waiting(context);
  if (context.frozen) steps.push('The agent is frozen. If that was a test, unfreeze it from the banner or Security. I cannot do that for you.');
  if (open.length) {
    const first = open[0];
    steps.push(`Review ${rl(first.amount)} to ${merchantName(first)} in Approvals${open.length > 1 ? `, and ${plural(open.length - 1, 'more purchase')}` : ''}.`);
  }
  if (t.budget > 0n && t.left * 5n < t.budget) steps.push(`Only ${rl(t.left)} is left. Raise the budget on the Rules page if the agent needs more; your Ledger signs a raise.`);
  const days = daysUntil(context.rules?.expiresAt, now);
  if (days != null && days <= 7) steps.push(days === 0 ? 'The allowance ends today. Extend it on the Rules page with your Ledger.' : `The allowance ends in ${plural(days, 'day')}. Extend it on the Rules page if the agent should keep paying.`);
  if (context.chain?.unavailable) steps.push('The payment channel could not be read. Approvals are refused until it can be.');
  const blocked = blockedRows(context).filter((item) => item.status === 'pending');
  if (blocked.length) steps.push(`Decline ${plural(blocked.length, 'decline-only purchase')} to clear the list.`);
  if (!steps.length) steps.push('Nothing needs you. The agent is paying inside your rules.');
  return steps;
}

function suggestionsFor(kind, context = {}) {
  const open = waiting(context);
  const base = {
    status: ['What is waiting for me?', 'Show this week’s spending', 'What should I do next?'],
    spend: ['Which merchant did I spend most with?', 'Export this as CSV', 'How much is left?'],
    waiting: open.length ? [`Why does ${merchantName(open[0])} need approval?`, 'Open approvals', 'Decline the unlisted one'] : ['What did the agent buy today?', 'Show blocked purchases'],
    rules: ['How do approvals work?', 'Open the rules', 'When does the allowance end?'],
    blocked: ['Why was it blocked?', 'Show blocked purchases', 'Which merchants are allowed?'],
    help: ['How much can my agent still spend?', 'What is waiting for me?', 'Show blocked purchases from this week'],
  };
  return base[kind] ?? base.status;
}

function answer(reply, extra = {}) {
  return { reply, ...extra };
}

/* Each intent: test(lower, text, context) → answer or null. First match wins. */

function intentEmpty(lower) {
  if (lower) return null;
  return answer('Ask me anything about your allowance: what was spent, why something was blocked, what is waiting, or what to do next.', { kind: 'help', suggestions: suggestionsFor('help') });
}

function intentInjection(lower, text, context) {
  if (!/\bignore (all |any )?(previous|prior|above|your) (instructions|rules)\b|\bsystem prompt\b|\bpre-?approved\b/.test(lower)) return null;
  return answer(`${OFF_TOPIC} I only follow your questions here, and a message cannot change my limits. ${BOUNDARY} Right now: ${statusLine(context)}`, { boundary: 'injection', kind: 'status' });
}

function intentGreeting(lower, text, context) {
  if (/^(thanks|thank you|thx|cheers|great|perfect|nice|ok(ay)?|got it|cool)\b/.test(lower) && lower.split(/\s+/).length <= 6) {
    return answer(`You're welcome. ${statusLine(context)}`, { kind: 'status', suggestions: suggestionsFor('status', context) });
  }
  if (!/^(hi|hello|hey|hiya|good (morning|afternoon|evening)|yo|howdy)\b/.test(lower) || lower.split(/\s+/).length > 6) return null;
  return answer(`Hi. Here is where things stand: ${statusLine(context)} What would you like to know?`, { kind: 'status', suggestions: suggestionsFor('status', context) });
}

function intentHelp(lower) {
  if (!/\b(help|what can you( do)?|what do you do|who are you|how do i use you|capabilities)\b/.test(lower)) return null;
  return answer([
    'I can answer anything about your allowance with real numbers: what is left, what was spent and where, what is waiting and why, what was blocked, the rules, the merchants, the payment channel, the audit log, and spending trends.',
    'I can also open pages, filter your history, highlight a payment, export a CSV, and open the allowance editor or an approval for you to review.',
    `I can propose freezing the agent or declining a purchase; nothing happens until you confirm. ${BOUNDARY}`,
  ].join(' '), { kind: 'help', suggestions: suggestionsFor('help') });
}

function intentJev(lower) {
  if (!/\bjev\b/.test(lower)) return null;
  return answer(explainJev(), { kind: 'rules' });
}

function intentUnfreeze(lower) {
  if (!/\b(unfreeze|un-freeze|unpause|resume|turn (it|the agent) back on|start (it|the agent) again|re-?enable)\b/.test(lower)) return null;
  return answer('I cannot unfreeze the agent. Only you can: press Unfreeze agent on the banner, or use the kill switch on Security. The next run opens a new payment channel.', {
    boundary: 'unfreeze',
    ui: { type: 'navigate', route: 'security' },
    kind: 'status',
  });
}

const POLITE = /\b(can you|could you|would you|will you|please)\b/;

function intentFreezeInfo(lower, text, context) {
  if (!/\b(freeze|frozen|kill switch|paused|halt)\b/.test(lower) || !isQuestion(lower) || POLITE.test(lower)) return null;
  if (/\b(is|are)\b.*\b(frozen|paused|stopped|running|live)\b|\bfrozen\b/.test(lower) && !/\bwhat (does|would|happens)\b|\bhow does\b/.test(lower)) {
    if (!context.frozen) return answer('No. The agent is live and can pay inside your rules. You can freeze it at any time, and I can propose that if you ask.', { kind: 'status' });
    const since = context.frozenAt ? ` since ${ago(context.frozenAt)}` : '';
    const channel = context.channelClosed ? ' The payment channel was closed.' : context.freezeDetail ? ` ${String(context.freezeDetail).replace(/\.?$/, '.')}` : '';
    return answer(`Yes. The agent has been frozen${since}. Nothing can be signed.${channel} Only you can unfreeze it.`, { kind: 'status' });
  }
  return answer('Freeze stops every new signature at once, then closes the payment channel so nothing already signed can be spent further. Unfreezing lets the agent pay inside the rules again, and its next run opens a new channel. I can propose a freeze; you confirm it. Only you can unfreeze.', { kind: 'rules' });
}

function intentFreeze(lower, text, context) {
  const bare = lower.replace(/[.!?]+$/g, '').trim();
  const command = ['freeze', 'stop', 'halt', 'pause', 'kill switch'].includes(bare)
    || /\b(freeze|halt|pause)\b/.test(lower)
    || /\bkill switch\b/.test(lower)
    || /\bstop\b/.test(lower);
  if (!command) return null;
  if (context.frozen) {
    return answer('The agent is already frozen. Nothing can be signed. Only you can unfreeze it.', { kind: 'status' });
  }
  return answer('I can freeze the agent now. Signing stops at once and the payment channel closes. Press Confirm to freeze, or Cancel to keep it running.', {
    action: { type: 'freeze' },
    kind: 'status',
  });
}

function intentApprove(lower, text, context) {
  if (!/\b(approve|approval for|pay (it|this|that|them)|sign (it|this|that))\b/.test(lower) || /\bhow (do|does|can)\b|\bwhat does\b/.test(lower)) return null;
  const named = merchantIn(text, context);
  const list = waiting(context);
  const item = (named && list.find((row) => rowsFor(context, named).includes(row))) ?? list[0];
  if (!item) {
    const blocked = blockedRows(context).find((row) => row.status === 'pending');
    if (blocked) return answer(`${merchantName(blocked)} is not on your merchant list, so no one can approve it, not even with a Ledger. You can decline it.`, { boundary: 'approve', kind: 'blocked' });
    return answer('Nothing is waiting for approval.', { kind: 'waiting' });
  }
  const why = whyFor(item, context);
  if (!why.canApprove) {
    return answer(`I cannot approve purchases, and this one cannot be approved by anyone: ${why.summary}`, { boundary: 'approve', ui: { type: 'navigate', route: 'approvals' }, kind: 'waiting' });
  }
  return answer(`I cannot approve or sign. Your Ledger does that. I opened ${merchantName(item)}'s approval so you can review it: ${why.summary} ${why.signs}`, {
    boundary: 'approve',
    ui: { type: 'review', id: item.id },
    kind: 'waiting',
  });
}

function intentDecline(lower, text, context) {
  if (!/\b(decline|reject|refuse|deny)\b/.test(lower) || (isQuestion(lower) && !POLITE.test(lower))) return null;
  const pending = context.pending ?? [];
  if (!pending.length) return answer('Nothing is waiting to decline.', { kind: 'waiting' });
  const named = merchantIn(text, context);
  const byId = pending.find((item) => item.id && lower.includes(String(item.id).toLowerCase()));
  const unlisted = /\b(unlisted|outside|unknown|not allowed|blocked one)\b/.test(lower) ? pending.find(isBlocked) : null;
  const item = byId ?? (named ? pending.find((row) => rowsFor(context, named).includes(row)) : null) ?? unlisted ?? pending[0];
  return answer(`I can decline ${rl(item.amount)} to ${merchantName(item)}. Nothing is signed or paid either way. Press Confirm to decline it.`, {
    action: { type: 'decline', id: item.id },
    kind: 'waiting',
  });
}

const CHANGE_VERB = /\b(set|raise|lower|increase|decrease|change|make|bump|reduce|cut|double|halve|extend|shorten|add|remove|drop|update|adjust|edit|up)\b/;

function intentChangeRules(lower, text, context) {
  const field = /\b(cap|limit|per[- ]purchase)\b/.test(lower) ? 'cap'
    : /\bbudget\b/.test(lower) ? 'budget'
      : /\b(expiry|expire|expiration|end date|deadline)\b/.test(lower) ? 'expiry'
        : /\bmerchant|allowlist|whitelist\b/.test(lower) ? 'merchant'
          : '';
  if (!field || !CHANGE_VERB.test(lower) || (isQuestion(lower) && !POLITE.test(lower))) return null;
  const amount = amountIn(lower);
  const t = totalsOf(context);
  const seed = {};
  let note = '';
  if (field === 'cap' && amount) {
    const cap = units(amount);
    if (cap <= 0n || cap > t.budget) {
      note = ` The cap has to be greater than 0 and no more than the budget of ${rl(t.budget)}.`;
    } else {
      seed.maxPerPurchase = amount;
      note = cap > units(context.rules?.maxPerPurchase)
        ? ` I put ${rl(amount)} in the editor. That is a raise, so your Ledger signs it when you save.`
        : ` I put ${rl(amount)} in the editor. That only lowers the cap, so it applies as soon as you save.`;
    }
  } else if (field === 'budget' && amount) {
    const budget = units(amount);
    if (budget <= 0n || budget < units(context.rules?.maxPerPurchase)) {
      note = ` The budget has to be greater than 0 and at least the per-purchase cap of ${rl(context.rules?.maxPerPurchase)}.`;
    } else {
      seed.budget = amount;
      note = budget > t.budget
        ? ` I put ${rl(amount)} in the editor. That is a raise, so your Ledger signs it when you save.`
        : ` I put ${rl(amount)} in the editor. That lowers the budget, so it applies as soon as you save.`;
    }
  } else if (field === 'merchant') {
    note = ' Adding a merchant is a raise, so your Ledger signs it. Removing one applies when you save.';
  } else if (field === 'expiry') {
    note = ' A later end date is a raise, so your Ledger signs it. An earlier one applies when you save.';
  }
  return answer(`I cannot change the allowance. Only you can, on the Rules page.${note}`, {
    boundary: 'rules',
    ui: Object.keys(seed).length ? { type: 'edit', seed } : { type: 'navigate', route: 'rules' },
    kind: 'rules',
    suggestions: suggestionsFor('rules'),
  });
}

const ROUTES = {
  home: /\b(home|dashboard|overview page|main page)\b/,
  activity: /\b(activity|history|transactions)\b/,
  approvals: /\b(approvals?|needs you)\b/,
  rules: /\b(rules|limits|allowance editor|editor)\b/,
  merchants: /\b(merchants?|allowlist)\b/,
  agents: /\b(agents?|planner)\b/,
  security: /\b(security|kill switch|audit log)\b/,
  settings: /\b(settings|appearance|theme)\b/,
  help: /\b(help page|faq)\b/,
};

function historyFilters(lower, text, context) {
  const filters = {};
  if (/\b(blocked|declined|refused|denied)\b/.test(lower)) filters.status = 'blocked';
  else if (/\b(waiting|pending|needs you|need approval|held)\b/.test(lower)) filters.status = 'waiting';
  else if (/\b(paid|payments that went through|successful|settled)\b/.test(lower)) filters.status = 'paid';
  const merchant = merchantIn(text, context);
  if (merchant) filters.merchant = merchant.address || merchant.label;
  const period = periodIn(lower);
  if (period === 'today') filters.period = 'today';
  else if (period === '7d' || period === 'yesterday') filters.period = '7d';
  else if (period === '30d') filters.period = '30d';
  return filters;
}

function filteredRows(context, filters, now = Date.now()) {
  return activity(context).filter((item) => {
    if (filters.status === 'blocked' && !isBlocked(item)) return false;
    if (filters.status === 'paid' && item.status !== 'paid') return false;
    if (filters.status === 'waiting' && (item.status === 'paid' || isBlocked(item))) return false;
    if (filters.merchant) {
      const key = String(filters.merchant).toLowerCase();
      if (String(item.merchant ?? '').toLowerCase() !== key && String(item.merchantLabel ?? '').toLowerCase() !== key) return false;
    }
    if (filters.period) return inPeriod(item, filters.period, now);
    return true;
  });
}

/** "blocked purchases from Market Desk in the last 7 days", with a singular form for one row. */
function describeFilter(filters, context, count = 2) {
  const one = count === 1;
  const noun = one ? 'purchase' : 'purchases';
  const what = filters.status === 'blocked' ? `blocked ${noun}`
    : filters.status === 'waiting' ? `${noun} waiting for you`
      : filters.status === 'paid' ? `paid ${noun}` : noun;
  const merchant = filters.merchant ? (merchantIn(filters.merchant, context)?.label ?? filters.merchant) : '';
  const when = filters.period === 'today' ? ' today' : filters.period === '7d' ? ' in the last 7 days' : filters.period === '30d' ? ' in the last 30 days' : '';
  return `${what}${merchant ? ` from ${merchant}` : ''}${when}`;
}

function intentExport(lower, text, context) {
  // "Export this as CSV" or "download my payments", but not "how big is the dashboard download?".
  const file = /\b(csv|spreadsheet|excel)\b/.test(lower);
  const verb = /\b(export|download)\b/.test(lower);
  const rowsAsked = /\b(payments?|purchases?|transactions?|activity|history|rows?|spending|spend|receipts?|records?|table|data)\b/.test(lower)
    || /^(please )?(export|download)\b/.test(lower)
    || /\b(export|download) (this|these|them|it|that|those|everything|all)\b/.test(lower);
  if (!file && !(verb && rowsAsked)) return null;
  const filters = historyFilters(lower, text, context);
  const rows = filteredRows(context, filters);
  return answer(`Exporting ${plural(rows.length, 'row')} of ${describeFilter(filters, context, rows.length)} as a CSV file.`, {
    ui: { type: 'export', filters },
    kind: 'spend',
  });
}

function intentShow(lower, text, context) {
  const showVerb = /^(show|list|filter|find|display|give me|pull up|let me see|see)\b|\b(show me|filter (to|by|for)|only show)\b/.test(lower);
  if (!showVerb) return null;
  if (!/\b(payments?|purchases?|transactions?|activity|history|blocked|paid|declined|spending|spend|waiting|pending|ones)\b/.test(lower)) return null;
  const filters = historyFilters(lower, text, context);
  const rows = filteredRows(context, filters);
  const total = sumRows(rows.filter((item) => item.status === 'paid'));
  const reply = rows.length
    ? `Showing ${rows.length} ${describeFilter(filters, context, rows.length)}.${total > 0n ? (filters.status === 'paid' ? ` Together they come to ${rl(total)}.` : ` ${rl(total)} of it was paid.`) : ''}`
    : `There are no ${describeFilter(filters, context)}. I opened the history so you can widen the filter.`;
  return answer(reply, { ui: { type: 'filter', filters }, kind: 'spend' });
}

function intentNavigate(lower) {
  if (!/\b(open|go to|take me to|navigate to|bring up|switch to|show me the)\b/.test(lower)) return null;
  for (const [route, test] of Object.entries(ROUTES)) {
    if (test.test(lower)) {
      const label = route === 'home' ? 'Home' : route[0].toUpperCase() + route.slice(1);
      return answer(`Opening ${label}.`, { ui: { type: 'navigate', route }, kind: 'status' });
    }
  }
  return null;
}

function intentHighlight(lower, text, context) {
  if (!/\b(highlight|point (me )?to|which one|show me the (last|latest|newest|biggest|largest)|where is the (last|latest))\b/.test(lower)) return null;
  const rows = /\b(biggest|largest|most expensive)\b/.test(lower)
    ? [...activity(context)].sort((a, b) => (units(b.amount) > units(a.amount) ? 1 : -1))
    : activity(context);
  const named = merchantIn(text, context);
  const pool = named ? rows.filter((item) => rowsFor(context, named).includes(item)) : rows;
  const item = /\bpaid|payment\b/.test(lower) ? pool.find((row) => row.status === 'paid') ?? pool[0] : pool[0];
  if (!item) return answer('There is nothing in the history yet.', { kind: 'spend' });
  return answer(`Here it is: ${rl(item.amount)} to ${merchantName(item)}${item.task ? ` for "${item.task}"` : ''}, ${ago(item.createdAt)}. ${item.status === 'paid' ? 'It was paid.' : isBlocked(item) ? 'It was blocked.' : 'It is waiting for you.'}`, {
    ui: { type: 'highlight', id: item.id },
    kind: 'spend',
  });
}

function intentRemaining(lower, text, context) {
  if (!(/\bstill spend\b|\b(remaining|balance|available)\b|\bleft\b|\bhow much (more )?can\b/.test(lower))) return null;
  if (/\bleft\b/.test(lower) && !/\b(spend|budget|rlusd|allowance|much|money|funds?)\b/.test(lower)) return null;
  const t = totalsOf(context);
  const held = t.held > 0n ? ` ${rl(t.held)} more is waiting for your approval and is not spent.` : '';
  const percent = Math.round((1 - t.ratio) * 100);
  return answer(`${rl(t.left)} is left to spend. The budget is ${rl(t.budget)} and ${rl(t.spent)} is already spent, so ${percent}% is left.${held}`, { kind: 'spend', suggestions: suggestionsFor('spend', context) });
}

function intentSpent(lower, text, context, now = Date.now()) {
  if (!/\b(spend|spent|spending|cost|costs|paid out|outgoing|how much did)\b/.test(lower)) return null;
  const asked = periodIn(lower);
  const period = asked || 'all';
  const merchant = merchantIn(text, context);
  const rows = rowsFor(context, merchant).filter((item) => item.status === 'paid' && inPeriod(item, period, now));
  const total = sumRows(rows);
  const where = merchant ? ` with ${merchant.label || merchant.address}` : '';
  const when = PERIOD_WORDS[period];
  const t = totalsOf(context);
  if (!rows.length) {
    return answer(`The agent has not spent any RLUSD${where} ${when}.${period === 'all' ? '' : ` ${rl(t.spent)} is spent in total.`}`, { kind: 'spend', suggestions: suggestionsFor('spend', context) });
  }
  if (!asked) {
    const today = sumRows(rows.filter((item) => inPeriod(item, 'today', now)));
    const share = merchant && t.spent > 0n ? ` That is ${Math.round(Number((total * 1000n) / t.spent) / 10)}% of everything spent.` : '';
    return answer(`The agent has spent ${rl(total)}${where} in total across ${plural(rows.length, 'payment')}. ${today > 0n ? `${rl(today)} of it was today.` : 'None of it was today.'}${share}`, { kind: 'spend', suggestions: suggestionsFor('spend', context) });
  }
  const lead = period === 'today' ? `Today the agent spent ${rl(total)}${where}` : `The agent spent ${rl(total)}${where} ${when}`;
  const tail = period === 'all' ? '' : ` ${rl(t.spent)} is spent in total.`;
  return answer(`${lead} across ${plural(rows.length, 'payment')}.${tail}`, { kind: 'spend', suggestions: suggestionsFor('spend', context) });
}

function intentBought(lower, text, context, now = Date.now()) {
  if (!/\b(buy|bought|purchases?|purchased|paid for|what did (it|the agent) get|recent|latest|last payment|last purchase)\b/.test(lower)) return null;
  if (/\b(per[- ]purchase|cap|limit)\b/.test(lower)) return null;
  const period = periodIn(lower) || (/\b(recent|latest|last)\b/.test(lower) ? 'all' : 'today');
  const merchant = merchantIn(text, context);
  const rows = rowsFor(context, merchant).filter((item) => item.status === 'paid' && inPeriod(item, period, now));
  const when = period === 'today' ? 'today' : PERIOD_WORDS[period];
  if (!rows.length) return answer(`The agent has not bought anything ${when}.`, { kind: 'spend' });
  if (/\b(last|latest)\b/.test(lower) && !/\bweek|month\b/.test(lower)) {
    const item = rows[0];
    return answer(`The last purchase was ${rl(item.amount)} at ${merchantName(item)}${item.task ? ` for "${item.task}"` : ''}, ${ago(item.createdAt)}.`, { ui: { type: 'highlight', id: item.id }, kind: 'spend' });
  }
  const lines = rows.slice(0, 8).map((item) => `${rl(item.amount)} at ${merchantName(item)}${item.task ? ` — ${item.task}` : ''}`);
  const more = rows.length > 8 ? `\nand ${plural(rows.length - 8, 'more')}.` : '';
  return answer(`${period === 'today' ? 'Today the agent bought' : `The agent bought ${when}`}:\n${lines.join('\n')}${more}`, { kind: 'spend' });
}

function intentWhy(lower, text, context) {
  if (!/\b(why|how come|reason|explain)\b/.test(lower) || /\b(approve|decline|reject)\b/.test(lower) && !/\bneed/.test(lower)) return null;
  if (!/\b(block|blocked|stopped|wait|waiting|held|need|needs|needed|approval|refused|declined|last one|that one|it)\b/.test(lower)) return null;
  const named = merchantIn(text, context);
  const candidates = [...(context.pending ?? []), ...blockedRows(context)];
  const item = (named ? candidates.find((row) => rowsFor(context, named).includes(row)) : null) ?? (context.pending ?? [])[0] ?? blockedRows(context)[0];
  if (!item) return answer('Nothing is blocked or waiting right now. Every purchase so far was inside your rules.', { kind: 'blocked' });
  const why = whyFor(item, context);
  const lead = named ? `${merchantName(item)} needed a person.` : `The last blocked purchase was ${rl(item.amount)} to ${merchantName(item)}.`;
  const numbers = why.facts.slice(1).map(([label, value]) => `${label.toLowerCase()} ${value}`).join(', ');
  const cap = context.rules?.maxPerPurchase ? ` The quote was ${rl(item.amount)} and the per-purchase cap is ${rl(context.rules.maxPerPurchase)}.` : '';
  return answer(`${lead} ${plainReason(item.reason || (isBlocked(item) ? 'merchant not allowed' : ''))}${item.reason === 'over per-purchase cap' ? cap : ''}${numbers && item.reason !== 'over per-purchase cap' ? ` (${numbers})` : ''} ${why.canApprove ? 'You can approve it on your Ledger or decline it.' : 'It cannot be approved by anyone; you can decline it.'}`, {
    kind: 'blocked',
    ui: why.canApprove ? { type: 'highlight', id: item.id } : undefined,
  });
}

function intentBlockedList(lower, text, context) {
  if (!/\b(blocked|declined|refused|rejected|denied)\b/.test(lower)) return null;
  const rows = blockedRows(context);
  if (!rows.length) return answer('Nothing has been blocked. Every purchase so far was inside your rules or is waiting for you.', { kind: 'blocked' });
  const lines = rows.slice(0, 8).map((item) => `${rl(item.amount)} to ${merchantName(item)} — ${plainReason(item.reason || 'merchant not allowed')}`);
  return answer(`${plural(rows.length, 'purchase was', 'purchases were')} blocked:\n${lines.join('\n')}`, { kind: 'blocked', suggestions: suggestionsFor('blocked', context) });
}

function intentWaiting(lower, text, context) {
  if (!/\b(pending|waiting|approvals?|needs? (me|you|my attention)|on hold|held)\b/.test(lower)) return null;
  const pending = context.pending ?? [];
  if (!pending.length) return answer('Nothing is waiting for approval.', { kind: 'waiting' });
  const lines = pending.map((item) => `${rl(item.amount)} to ${merchantName(item)} — ${plainReason(item.reason || (isBlocked(item) ? 'merchant not allowed' : ''))}`);
  const approvable = waiting(context).length;
  const tail = approvable
    ? 'Approve one on your Ledger in the dashboard. I cannot sign it.'
    : 'None of these can be approved; you can decline them.';
  return answer(`Waiting for you:\n${lines.join('\n')}\n${tail}`, { kind: 'waiting', suggestions: suggestionsFor('waiting', context) });
}

function intentRules(lower, text, context, now = Date.now()) {
  if (!/\b(rules?|cap|limit|budget|expire|expires|expiry|expiration|end date|deadline|how long|allowance|how many days|days (are )?(left|remain\w*))\b/.test(lower)) return null;
  const r = context.rules ?? {};
  const days = daysUntil(r.expiresAt, now);
  const ends = `${shortDate(r.expiresAt)}${days != null ? ` (${days === 0 ? 'today' : `${plural(days, 'day')} from now`})` : ''}`;
  if (/\b(expire|expires|expiry|expiration|end date|deadline|how long|how many days|days (are )?(left|remain\w*))\b/.test(lower)) {
    return answer(`The allowance ends ${ends}. After that, nothing is paid until you extend it with your Ledger.`, { kind: 'rules' });
  }
  if (/\bcap|per[- ]purchase|limit\b/.test(lower) && !/\bbudget\b/.test(lower)) {
    return answer(`The per-purchase cap is ${rl(r.maxPerPurchase)}. Anything above it waits for you, and your Ledger can approve that one purchase.`, { kind: 'rules' });
  }
  if (/\bbudget\b/.test(lower) && !/\brules?\b/.test(lower)) {
    const t = totalsOf(context);
    return answer(`The budget is ${rl(t.budget)}. ${rl(t.spent)} is spent and ${rl(t.left)} is left. A purchase that would go over it is refused, even with a signature.`, { kind: 'rules' });
  }
  const merchants = (r.allowedMerchants ?? []).map((item) => item.label || item.address);
  return answer(`Your rules: a ${rl(r.budget)} budget, a ${rl(r.maxPerPurchase)} cap per purchase, ending ${ends}, and ${plural(merchants.length, 'merchant')} on the list (${merchants.join(', ') || 'none'}). Inside all of them the agent pays alone. Over the cap it asks you. Off the list, after the end date, or over the budget, nothing pays.`, { kind: 'rules', suggestions: suggestionsFor('rules') });
}

function intentMerchants(lower, text, context) {
  if (!/\b(merchants?|allowlist|whitelist|who can (it|the agent) pay|allowed|vendors?|sellers?)\b/.test(lower)) return null;
  const r = context.rules ?? {};
  const named = merchantIn(text, context);
  const allowed = r.allowedMerchants ?? [];
  const denied = r.deniedMerchants ?? [];
  if (named && /\b(is|are|can)\b/.test(lower)) {
    const ok = allowed.some((item) => String(item.address ?? item).toLowerCase() === named.address);
    const no = denied.find((item) => String(item.address).toLowerCase() === named.address);
    if (ok) return answer(`Yes. ${named.label || named.address} is on your list, so the agent can pay it within the cap and the budget.`, { kind: 'rules' });
    return answer(`No. ${named.label || named.address} is not on your list${no ? ' and is decline-only' : ''}. No signature can pay it.`, { kind: 'rules' });
  }
  const spentBy = (item) => sumRows(paidRows(context).filter((row) => String(row.merchant ?? '').toLowerCase() === String(item.address ?? item).toLowerCase()));
  const lines = allowed.map((item) => `${item.label || item.address}: ${rl(spentBy(item))} paid`);
  const deniedLine = denied.length ? `\nDecline-only: ${denied.map((item) => item.label || item.address).join(', ')}.` : '';
  return answer(`The agent may pay ${plural(allowed.length, 'merchant')}:\n${lines.join('\n')}${deniedLine}`, { kind: 'rules', ui: /\b(open|show)\b/.test(lower) ? { type: 'navigate', route: 'merchants' } : undefined });
}

function intentChannel(lower, text, context) {
  if (!/\b(channel|on-?chain|xrpl|reconcil\w*|redeemed|explorer|settle\w*|testnet)\b/.test(lower)) return null;
  const chain = context.chain;
  const t = totalsOf(context);
  if (context.frozen && context.channelClosed) return answer('The payment channel was closed when the agent was frozen. The next run after you unfreeze opens a new one.', { kind: 'status' });
  if (!chain || chain.unavailable) {
    return answer(`I cannot read the payment channel right now${chain?.unavailable ? ' (the testnet RPC did not answer)' : ', because no agent wallet is configured on this machine'}. The ledger here shows ${rl(t.spent)} spent. Approvals are refused while a configured channel cannot be read.`, { kind: 'status' });
  }
  const redeemed = chain.redeemed != null ? rl(chain.redeemed) : 'unknown';
  const cap = chain.cap != null ? rl(chain.cap) : 'unknown';
  const match = chain.redeemed != null && units(chain.redeemed) === t.spent;
  return answer(`The open payment channel has a ${cap} cap and ${redeemed} redeemed. ${match ? 'That matches the local ledger.' : `The local ledger shows ${rl(t.spent)}; the higher figure counts as spent.`}`, { kind: 'status' });
}

function intentStatus(lower, text, context) {
  if (!/\b(status|state|how (is|are) (it|things|we) (doing|going)|everything ok|all good|summary|overview|update me|catch me up)\b/.test(lower)) return null;
  const t = totalsOf(context);
  const paid = paidRows(context);
  const blocked = blockedRows(context);
  return answer([
    `The agent is ${context.frozen ? 'frozen; nothing can be signed' : 'live and paying inside your rules'}.`,
    `${rl(t.spent)} of ${rl(t.budget)} is spent across ${plural(paid.length, 'payment')}; ${rl(t.left)} is left.`,
    `${plural(waiting(context).length, 'purchase')} ${waiting(context).length === 1 ? 'is' : 'are'} waiting for you and ${plural(blocked.length, 'was', 'were')} blocked.`,
    context.demo ? 'These are example rows until the agent pays for real.' : '',
  ].filter(Boolean).join(' '), { kind: 'status', suggestions: suggestionsFor('status', context) });
}

function intentTrends(lower, text, context, now = Date.now()) {
  if (!/\b(trends?|pattern|average|avg|typical|biggest|largest|most|top|breakdown|by merchant|per merchant|where (did|does) (it|the money) go|compare|how fast|rate|burn)\b/.test(lower)) return null;
  const paid = paidRows(context);
  if (!paid.length) return answer('There is no spending yet, so there is no trend to show.', { kind: 'spend' });
  const total = sumRows(paid);
  const byMerchant = new Map();
  for (const item of paid) {
    const key = merchantName(item);
    byMerchant.set(key, (byMerchant.get(key) ?? 0n) + units(item.amount));
  }
  const ranked = [...byMerchant.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1));
  const share = (value) => (total === 0n ? 0 : Math.round(Number((value * 100_000n) / total) / 100) / 10);
  const biggest = [...paid].sort((a, b) => (units(b.amount) > units(a.amount) ? 1 : -1))[0];
  const average = total / BigInt(paid.length);
  const week = sumRows(paid.filter((item) => inPeriod(item, '7d', now)));
  const t = totalsOf(context);
  const days = daysUntil(context.rules?.expiresAt, now);
  const pace = week > 0n && days != null ? (week * BigInt(Math.max(days, 1))) / 7n : 0n;
  const runway = pace > t.left ? ' At this week’s pace the budget runs out before the end date.' : week > 0n ? ' At this week’s pace the budget lasts until the end date.' : '';
  return answer([
    `Across ${plural(paid.length, 'payment')} the agent spent ${rl(total)}, ${rl(average)} on average.`,
    `By merchant: ${ranked.map(([name, value]) => `${name} ${rl(value)} (${share(value)}%)`).join(', ')}.`,
    `The biggest single purchase was ${rl(biggest.amount)} at ${merchantName(biggest)}.`,
    `In the last 7 days: ${rl(week)}.${runway}`,
  ].join(' '), { kind: 'spend', suggestions: suggestionsFor('spend', context) });
}

function intentPlanner(lower, text, context) {
  if (!/\b(planner|bedrock|model|ai|who (chose|decided|picked)|why did (it|the agent) (buy|choose|pick)|decid\w*|chose)\b/.test(lower)) return null;
  const rows = activity(context).filter((item) => item.plan?.source || item.task).slice(0, 5);
  const source = context.bedrockConfigured ? 'Amazon Bedrock chooses what to buy' : 'Bedrock is not configured, so the built-in rules planner chooses what to buy';
  const planner = (item) => (item.plan?.source === 'bedrock' ? 'Amazon Bedrock' : item.plan?.source === 'fallback' ? 'the fallback planner' : 'the task you gave it');
  const words = lower.split(/[^a-z0-9]+/).filter((word) => word.length > 4 && !STOP_WORDS.has(word));
  const named = activity(context).find((item) => {
    const task = String(item.task ?? '').toLowerCase();
    return task && words.some((word) => task.includes(word.replace(/ion$/, '')));
  });
  if (named) {
    const outcome = named.status === 'paid' ? 'The rules allowed it, so it was paid.' : isBlocked(named) ? `It was blocked: ${plainReason(named.reason || 'merchant not allowed')}` : `It is waiting for you: ${plainReason(named.reason)}`;
    const reason = String(named.plan?.reason ?? '').trim();
    return answer(`"${named.task}" came from ${planner(named)}${reason ? ` (${reason.replace(/\.?$/, '')})` : ''}. It quoted ${rl(named.amount)} at ${merchantName(named)}. ${outcome}`, { kind: 'status', ui: { type: 'highlight', id: named.id } });
  }
  if (!rows.length) return answer(`${source}. It has not planned a purchase yet. Either way, the planner only chooses; the rules decide what may be paid.`, { kind: 'status' });
  const lines = rows.map((item) => `${item.task || 'Purchase'} → ${merchantName(item)}, ${rl(item.amount)} (from ${planner(item)})`);
  return answer(`${source}. Recent decisions:\n${lines.join('\n')}\nThe planner only chooses; the rules decide what may be paid.`, { kind: 'status' });
}

function intentAudit(lower, text, context) {
  if (!/\b(audit|log|who signed|signer|signatures?|trail)\b/.test(lower)) return null;
  const rows = (context.audit ?? []).slice(0, 6);
  if (!rows.length) return answer('The audit log is empty. Allows, blocks, approvals, and freezes are recorded there with the rule, the reason, and the signer.', { kind: 'status', ui: { type: 'navigate', route: 'security' } });
  const lines = rows.map((row) => `${row.outcome || row.rule}: ${String(row.reason ?? '').replace(/\.$/, '')}${row.signer ? ` (signed by ${row.signer})` : ''}${row.at ? `, ${ago(row.at)}` : ''}`);
  return answer(`The latest audit entries:\n${lines.join('\n')}`, { kind: 'status', ui: { type: 'navigate', route: 'security' } });
}

const APPROVER_ASKED = /\b(approver|who (approves|can approve|signs)|ledger (account|address)|(is|are) (my |the )?ledger (connected|plugged in|set up|linked|paired|ready)|connect (my |a |the )?ledger|(set|name|change|replace) (up )?(my |the |an )?(approver|ledger))\b/;

function shortAddress(address) {
  const text = String(address ?? '');
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

function intentApprover(lower, text, context) {
  if (!APPROVER_ASKED.test(lower)) return null;
  const address = context.rules?.approverAddress;
  if (!address) {
    return answer('No approver is set yet, so a purchase over the cap can only be declined and no limit can be raised. Open Security and name your Ledger account under Approver: read it from the device, or paste its address. You can name it once.', {
      kind: 'rules',
      ui: { type: 'navigate', route: 'security' },
    });
  }
  const who = context.simulatedLedger
    ? `a simulated Ledger signer (${shortAddress(address)}), not a hardware device`
    : `the Ledger account ${shortAddress(address)}`;
  const change = /\b(set|name|change|replace)\b/.test(lower)
    ? ' It is already set, and the dashboard cannot replace it. Only an edit on the server (APPROVER_ADDRESS or agent/rules.json) changes it.'
    : '';
  const device = /\b(connected|plugged|ready|paired|linked|connect)\b/.test(lower)
    ? ' I cannot see your device from here. The approval sheet checks it when you press Approve.'
    : '';
  return answer(`Your approver is ${who}. It approves a purchase over your cap, one at a time, and signs any raise to the budget, the cap, the end date, or the merchant list. It cannot pay a merchant off the list or go over the budget.${change}${device}`, { kind: 'rules' });
}

/*
 * How the product works, for an owner who asks. Each answer is a fact about
 * this build; a few add the owner's own numbers or open the page to act on it.
 */
const EXPLAINERS = [
  {
    test: /\bx402\b|\bhttp 402\b|\bhow (do|does) (the )?(payments?|paying) work\b/,
    reply: () => 'x402 is how the agent pays. It asks the merchant for the data, the merchant answers HTTP 402 with a price and a payee, your rules check that quote, and only then does the agent sign one voucher on its AP4M payment channel. The merchant redeems the voucher on XRPL EVM Testnet and sends the data. Each voucher carries the running total on the channel.',
  },
  {
    test: /\b(what|which) (network|chain|blockchain)\b|\bchain id\b|\b(testnet|mainnet)\b/,
    reply: () => 'Everything here runs on XRPL EVM Testnet, chain 1449000. Payments are testnet RLUSD and gas is testnet XRP. Nothing touches a mainnet.',
  },
  {
    test: /\bwhat('s| is) rlusd\b|\bwhat does rlusd\b/,
    reply: () => 'RLUSD is Ripple’s US dollar stablecoin. Here it is testnet RLUSD on XRPL EVM Testnet, so 0.01 RLUSD is a cent-sized test payment, not real money.',
  },
  {
    test: /\brefunds?\b|\bmoney back\b|\b(undo|reverse|cancel) (a |the |that |my )?(paid )?(payment|purchase)\b/,
    reply: () => 'A paid purchase is final: the merchant redeemed the voucher on XRPL, and no one here can undo it. A blocked or declined purchase was never paid. To stop it happening again, lower the cap or the budget on the Rules page, or freeze the agent.',
  },
  {
    test: /\b(is|are) (my |the )?(private )?(keys?|wallets?|seed) (safe|secure)\b|\bwhere (is|are) (my |the )?(private )?keys?\b/,
    reply: () => 'The agent’s key stays in .env on the computer that runs it. It is never committed, never logged, and never sent to the AP4M service or any API, and it can only sign what your rules allow, up to the channel cap. Your approver key never leaves your Ledger; the server only checks its signatures. I never see a key.',
  },
  {
    test: /\b(lost|lose|stolen|broken|forgot)\b.*\bledger\b|\bledger\b.*\b(lost|stolen|broken)\b|\bwithout (my |a |the )?ledger\b/,
    reply: () => 'If your Ledger is lost, freeze the agent if anything worries you; signing stops at once. Until you have an approver again, the agent still pays inside the rules, but nothing over the cap can be approved and no limit can be raised. Restore the same account from its recovery phrase to keep your approver. To use a different one, change APPROVER_ADDRESS or agent/rules.json on the server; the dashboard cannot replace it.',
    ui: { type: 'navigate', route: 'security' },
  },
  {
    test: /\b(can|could|will|would|might) (the |my )?agent (ever )?(spend|go|pay) (more than|over|past|beyond|above) (the |my )?(budget|limit|allowance)\b|\b(overspend|go over (the |my )?budget)\b/,
    reply: (context) => `No. The budget is ${rl(totalsOf(context).budget)} and the payment channel's cap is the budget, so the agent cannot sign past it, and a purchase that would go over is refused even with your Ledger's signature. Above the ${rl(context.rules?.maxPerPurchase)} cap on one purchase, it stops and asks you.`,
  },
  {
    test: /\bhow (do|can|should) i (add|allow|remove|delete) (a |another |the )?merchants?\b/,
    reply: () => 'Open Rules and use the allowance editor: paste the merchant’s payout address under Merchants. Adding a merchant is a raise, so your Ledger signs it. Removing one applies as soon as you save.',
    ui: { type: 'navigate', route: 'rules' },
  },
  {
    test: /\bhow (do|can|should) i (raise|increase|change|lower|reduce|extend|edit) (my |the )?(budget|cap|limit|end date|expiry|allowance)\b/,
    reply: () => 'Open Rules and change it in the allowance editor. Lowering the budget or the cap applies as soon as you save. Raising either, extending the end date, or adding a merchant needs your Ledger to sign the new allowance. You can also tell me a number, like “set my cap to 0.04”, and I will put it in the editor for you to check.',
    ui: { type: 'navigate', route: 'rules' },
  },
  {
    // "What is the channel?" is a concept; "what is the channel status?" is the live channel answer.
    test: /\bwhat (is|'s) (a |the |my )?(payment )?channel\s*\??$|\bhow (does|do) (the |a )?(payment )?channels? work\b/,
    reply: () => 'The payment channel is a prepaid AP4M channel the agent pays from. Each purchase is a voucher on it, and the merchant redeems vouchers on XRPL. Its cap is your budget, so the agent can never sign past it. Freeze closes the channel; the next run after you unfreeze opens a new one.',
  },
];

function intentExplain(lower, text, context) {
  const found = EXPLAINERS.find((item) => item.test.test(lower));
  if (!found) return null;
  return answer(found.reply(context), { kind: 'rules', ui: found.ui });
}

function intentAgentRole(lower, text, context) {
  if (!/\bwhat (does|is) (the |my )?agent (do|doing|for)\b|\b(the agent'?s|its) (job|task|purpose)\b|\bwhat (job|task) (is|does) (it|the agent)\b/.test(lower)) return null;
  const job = context.useCase;
  const planner = context.bedrockConfigured ? 'Amazon Bedrock chooses what to buy' : 'the built-in planner chooses what to buy (Bedrock is not configured)';
  return answer(`${job?.title ? `Its job: ${job.title}. ` : ''}${job?.summary ? `${job.summary} ` : ''}For each task, ${planner}, the merchant quotes a price over x402, and your rules decide before anything is signed. It holds no other key and cannot change its own limits.`, { kind: 'rules' });
}

function intentLastApprover(lower, text, context, now = Date.now()) {
  if (!/\bwho (approved|signed|ok'?d|okayed)\b/.test(lower)) return null;
  const row = (context.audit ?? []).find((item) => item.outcome === 'ledger-approved');
  if (!row) return answer('No exception has been approved yet. A purchase over the cap waits under Approvals until your Ledger signs it.', { kind: 'waiting' });
  const what = row.amount ? `${rl(row.amount)}${row.merchantLabel ? ` to ${row.merchantLabel}` : ''}` : 'the last exception';
  return answer(`${row.signer ? `The approver ${shortAddress(row.signer)}` : 'Your approver'} signed ${what}${row.at ? `, ${ago(row.at, now)}` : ''}. It was paid once through x402.`, { kind: 'waiting', ui: { type: 'navigate', route: 'security' } });
}

function intentHealth(lower, text, context, now = Date.now()) {
  if (!/\b(is (anything|something) (wrong|broken|off)|any (problems?|issues?|errors?)|anything (wrong|broken)|is everything (ok|okay|fine|alright|good|working)|everything ok|all good|health ?check)\b/.test(lower)) return null;
  const t = totalsOf(context);
  const issues = [];
  if (context.frozen) issues.push('The agent is frozen, so nothing can be signed.');
  const days = daysUntil(context.rules?.expiresAt, now);
  if (days === 0) issues.push('The allowance has ended. Extend it on the Rules page with your Ledger.');
  else if (days != null && days <= 7) issues.push(`The allowance ends in ${plural(days, 'day')}.`);
  if (t.budget > 0n && t.left * 5n < t.budget) issues.push(`Only ${rl(t.left)} of ${rl(t.budget)} is left.`);
  if (!context.rules?.approverAddress) issues.push('No approver is set, so a purchase over the cap can only be declined. Name one on Security.');
  if (context.chain?.unavailable) issues.push('The payment channel cannot be read, so approvals are refused until it can.');
  const open = waiting(context);
  const clearable = blockedRows(context).filter((item) => item.status === 'pending');
  const notes = [];
  if (open.length) notes.push(`${plural(open.length, 'purchase')} ${open.length === 1 ? 'waits' : 'wait'} for your approval.`);
  if (clearable.length) notes.push(`${plural(clearable.length, 'decline-only purchase')} can be cleared.`);
  if (!issues.length) {
    return answer(`Nothing looks wrong. The agent is live, ${rl(t.left)} is left${days != null ? `, and the allowance runs ${plural(days, 'more day')}` : ''}. ${notes.join(' ')}`.trim(), { kind: 'status', suggestions: suggestionsFor('status', context) });
  }
  return answer(`${plural(issues.length, 'thing needs', 'things need')} a look:\n${issues.map((line) => `• ${line}`).join('\n')}${notes.length ? `\n${notes.join(' ')}` : ''}`, { kind: 'status', suggestions: suggestionsFor('status', context) });
}

function intentRecap(lower, text, context, now = Date.now()) {
  if (!/\b(while i was (away|gone|out)|what happened|what did i miss|recap|anything new|what'?s new|since (yesterday|this morning|last time|i left)|catch me up|lately)\b/.test(lower)) return null;
  const events = [
    ...paidRows(context).map((item) => ({ at: item.createdAt, line: `Paid ${rl(item.amount)} to ${merchantName(item)}${item.task ? ` for “${item.task}”` : ''}` })),
    ...(context.pending ?? []).map((item) => ({ at: item.createdAt, line: `${isBlocked(item) ? 'Blocked' : 'Held for you'}: ${rl(item.amount)} to ${merchantName(item)} (${plainReason(item.reason || (isBlocked(item) ? 'merchant not allowed' : '')).replace(/\.$/, '').toLowerCase()})` })),
    ...(context.audit ?? []).filter((row) => row.rule === 'freeze' || row.rule === 'unfreeze' || row.outcome === 'ledger-approved')
      .map((row) => ({ at: row.at, line: row.rule === 'freeze' ? 'You froze the agent' : row.rule === 'unfreeze' ? 'You unfroze the agent' : `Your Ledger approved ${row.amount ? rl(row.amount) : 'an exception'}` })),
  ].filter((item) => item.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  if (!events.length) return answer(`Nothing has happened yet. ${statusLine(context)}`, { kind: 'status' });
  return answer(`Lately:\n${events.map((item) => `• ${item.line}, ${ago(item.at, now)}.`).join('\n')}\nNow: ${statusLine(context)}`, { kind: 'status', suggestions: suggestionsFor('status', context) });
}

function intentLedger(lower) {
  if (!/\b(ledger|hardware wallet|how (do|does) (i )?approv\w*|how approvals? work|what does the ledger sign|signing)\b/.test(lower)) return null;
  return answer('When a purchase is over your cap, it waits under Approvals. Approving it asks your Ledger to sign one message for exactly that merchant, that amount, and a short validity window. The server checks the signature came from your approver, then pays that purchase once. A signature can pass the cap, but never an unlisted merchant, an expired allowance, or the budget. Raising a limit is signed the same way.', { kind: 'rules' });
}

function intentNext(lower, text, context, now = Date.now()) {
  if (!/\b(what should i do|what now|next steps?|suggest\w*|recommend\w*|advice|anything i should|to-?do|action items?|what do you think)\b/.test(lower)) return null;
  const steps = nextSteps(context, now);
  return answer(steps.length === 1 ? steps[0] : `Here is what I would do next:\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`, { kind: 'waiting' });
}

const INTENTS = [
  intentEmpty,
  intentInjection,
  intentGreeting,
  intentHelp,
  intentJev,
  intentUnfreeze,
  intentFreezeInfo,
  intentFreeze,
  intentApprover,
  intentExplain,
  intentAgentRole,
  intentLastApprover,
  intentExport,
  intentChangeRules,
  intentApprove,
  intentDecline,
  intentHighlight,
  intentShow,
  intentAudit,
  intentNavigate,
  intentNext,
  intentHealth,
  intentRecap,
  intentLedger,
  intentWhy,
  intentPlanner,
  intentRemaining,
  intentTrends,
  intentSpent,
  intentBought,
  intentWaiting,
  intentBlockedList,
  intentChannel,
  intentMerchants,
  intentRules,
  intentStatus,
];

function ruleAnswerOne(message, context, now = Date.now()) {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  for (const intent of INTENTS) {
    const result = intent(lower, text, context, now);
    if (result) return result;
  }
  // Not a question about the allowance. Say so, and still show where things stand.
  return answer(`${OFF_TOPIC} Right now: ${statusLine(context)}`, { kind: 'status', offTopic: true, suggestions: suggestionsFor('help') });
}

const UI_PRIORITY = ['review', 'edit', 'export', 'filter', 'highlight', 'navigate'];

/**
 * Answer every part of a multi-part question. Off-topic parts are left out;
 * if fewer than two parts get an answer, the whole message is answered as
 * one question. At most one action and one UI step: freeze wins over decline,
 * and an approval or the editor wins over plain navigation.
 */
export function ruleAnswer(message, context, now = Date.now()) {
  const parts = splitQuestions(message);
  if (parts.length < 2 || intentInjection(String(message ?? '').toLowerCase(), message, context)) {
    return clean(ruleAnswerOne(message, context, now));
  }
  const answers = [];
  for (const part of parts) {
    const result = ruleAnswerOne(part, context, now);
    if (result.offTopic) continue;
    if (answers.some((seen) => seen.reply === result.reply)) continue;
    answers.push(result);
  }
  if (answers.length < 2) return clean(ruleAnswerOne(message, context, now));
  const action = answers.find((item) => item.action?.type === 'freeze')?.action
    ?? answers.find((item) => item.action)?.action;
  const ui = UI_PRIORITY.map((type) => answers.find((item) => item.ui?.type === type)?.ui).find(Boolean);
  const boundary = answers.find((item) => item.boundary)?.boundary;
  const suggestions = answers.find((item) => item.suggestions)?.suggestions;
  return clean({
    reply: answers.map((item) => item.reply).join('\n\n'),
    action,
    ui,
    boundary,
    suggestions,
    parts: answers.length,
  });
}

function clean(result) {
  const out = { reply: result.reply };
  if (result.action) out.action = result.action;
  if (result.ui) out.ui = result.ui;
  if (result.boundary) out.boundary = result.boundary;
  if (result.suggestions) out.suggestions = result.suggestions;
  if (result.parts) out.parts = result.parts;
  if (result.offTopic) out.offTopic = true;
  return out;
}

/* ------------------------------------------------------------------ */
/* UI steps the dashboard may take for Eve                             */
/* ------------------------------------------------------------------ */

const UI_ROUTES = new Set(['home', 'activity', 'approvals', 'rules', 'merchants', 'agents', 'security', 'settings', 'help']);
const UI_STATUS = new Set(['all', 'paid', 'waiting', 'blocked']);
const UI_PERIOD = new Set(['all', 'today', '7d', '30d']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_AMOUNT = /^\d{1,12}(\.\d{1,18})?$/;

function safeFilters(filters = {}) {
  const out = {};
  if (UI_STATUS.has(filters.status)) out.status = filters.status;
  if (UI_PERIOD.has(filters.period)) out.period = filters.period;
  if (typeof filters.merchant === 'string' && filters.merchant.length <= 80) out.merchant = filters.merchant.toLowerCase();
  if (typeof filters.query === 'string') out.query = filters.query.slice(0, 120);
  return out;
}

/**
 * The only UI steps Eve can ask for. Each changes what the person sees, never
 * what is allowed. Anything else is dropped.
 */
export function safeUi(ui) {
  if (!ui || typeof ui !== 'object') return null;
  if (ui.type === 'navigate' && UI_ROUTES.has(ui.route)) return { type: 'navigate', route: ui.route };
  if (ui.type === 'filter') return { type: 'filter', filters: safeFilters(ui.filters) };
  if (ui.type === 'export') return { type: 'export', filters: safeFilters(ui.filters) };
  if ((ui.type === 'highlight' || ui.type === 'review') && SAFE_ID.test(String(ui.id ?? ''))) return { type: ui.type, id: ui.id };
  if (ui.type === 'edit') {
    const seed = {};
    for (const key of ['budget', 'maxPerPurchase']) {
      if (SAFE_AMOUNT.test(String(ui.seed?.[key] ?? ''))) seed[key] = String(ui.seed[key]);
    }
    return { type: 'edit', seed };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Confirmation text and the confirmed action                          */
/* ------------------------------------------------------------------ */

export function confirmationSummary(action, context) {
  if (action.type === 'freeze') return 'Freeze the agent now? Signing stops and the payment channel closes. Only you can unfreeze it.';
  const item = (context.pending ?? []).find((row) => row.id === action.id) ?? (context.pending ?? [])[0];
  return `Decline ${rl(item?.amount ?? '0')} to ${merchantName(item)}? Nothing is signed or paid.`;
}

/** Runs only after a person pressed Confirm on a proposal Eve made. */
export async function executeConfirmed(action) {
  if (!action || typeof action !== 'object') return { error: 'That confirmation is not valid.' };
  if (action.type === 'freeze') {
    const frozen = await freezeAgent();
    const detail = frozen.channelClosed ? 'The payment channel is closed.' : frozen.channelReason;
    return { reply: `The agent is frozen. Signing has stopped. ${detail} Only you can unfreeze it.`, frozen: true };
  }
  if (action.type === 'decline') {
    const result = await declinePending(action.id);
    if (result.error === 'invalid') return { error: 'That decline id is not valid.' };
    if (result.missing) return { error: 'missing' };
    return {
      reply: `Declined ${rl(result.declined.amount)} to ${merchantName(result.declined)}. Nothing was signed or paid.`,
      payment: result.declined,
    };
  }
  if (action.type === 'approve') {
    return { error: 'Eve cannot approve a purchase. Approve it on your Ledger in the dashboard.' };
  }
  if (['set_cap', 'set_budget', 'set_expiry', 'add_merchant', 'remove_merchant', 'unfreeze'].includes(action.type)) {
    return { error: 'Eve cannot change the allowance or unfreeze the agent. Nothing was changed. Use the Rules page; a raise needs your Ledger signature.' };
  }
  return { error: 'That confirmation is not valid.' };
}

/* ------------------------------------------------------------------ */
/* Optional model: rewords a computed answer, never adds an action     */
/* ------------------------------------------------------------------ */

const EVE_SYSTEM = [
  'You are Eve, the account owner\'s allowance assistant.',
  'Reply in plain, warm, short sentences. Use only numbers that appear in the facts or the context.',
  'The draft answer was computed from the ledger and is correct. Reword it if it helps, add useful context from the JSON, but never change a number.',
  'Never say you approved, signed, paid, changed a rule, or unfroze anything. You cannot.',
  'Return JSON {"reply":"..."} only.',
];

function modelContext(context) {
  const t = totalsOf(context);
  return {
    rules: {
      budget: context.rules?.budget,
      maxPerPurchase: context.rules?.maxPerPurchase,
      expiresAt: context.rules?.expiresAt,
      merchants: (context.rules?.allowedMerchants ?? []).map((item) => item.label || item.address),
    },
    totals: { spent: formatRlusd(t.spent), left: formatRlusd(t.left), held: formatRlusd(t.held) },
    frozen: Boolean(context.frozen),
    pending: (context.pending ?? []).map((item) => ({ amount: item.amount, merchant: merchantName(item), reason: item.reason })),
    payments: (context.payments ?? []).slice(0, 12).map((item) => ({ amount: item.amount, status: item.status, merchant: merchantName(item), task: item.task, createdAt: item.createdAt })),
  };
}

function modelMessage(message, draft) {
  return `Question: ${message}\nDraft answer from the ledger: ${draft.reply}`;
}

async function answerWithLlm(message, draft, context, env, fetchImpl) {
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
        { role: 'system', content: [...EVE_SYSTEM, `Context: ${JSON.stringify(modelContext(context))}`].join(' ') },
        { role: 'user', content: modelMessage(message, draft) },
      ],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error('LLM request failed.');
  const content = payload?.choices?.[0]?.message?.content ?? '';
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) throw new Error('LLM reply was empty.');
  return { ...draft, reply: parsed.reply.trim(), source: 'llm' };
}

async function answerWithBedrock(message, draft, context, env, client) {
  const result = await converse({
    env,
    client,
    maxTokens: 512,
    system: [...EVE_SYSTEM, `Context: ${JSON.stringify(modelContext(context))}`].join(' '),
    user: modelMessage(message, draft),
  });
  const parsed = parseModelJson(result.text);
  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) throw new Error('Bedrock reply was empty.');
  // Whatever else the model returned (an "action", a "ui" step) is ignored.
  return { ...draft, reply: parsed.reply.trim(), source: 'bedrock' };
}

/**
 * The rules engine answers first. Anything with a side effect, a boundary,
 * a UI step, or several parts stays exactly as computed. A plain read answer
 * may be reworded by Bedrock or LLM_* when configured.
 */
export async function answerEve(message, context, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const local = ruleAnswer(message, context, options.now);
  const fixed = local.action || local.boundary || local.ui || local.parts > 1;
  if (fixed) return { ...local, source: 'rules' };
  if (readBedrockSettings(env).configured) {
    try {
      return await answerWithBedrock(message, local, context, env, options.bedrockClient);
    } catch {
      // Bedrock is optional at runtime. LLM_*, or the rules answer, still replies.
    }
  }
  if (env.LLM_API_KEY?.trim()) {
    try {
      return await answerWithLlm(message, local, context, env, fetchImpl);
    } catch {
      return { ...local, source: 'rules' };
    }
  }
  return { ...local, source: 'rules' };
}
