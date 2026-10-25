/**
 * Pitch visuals for the dashboard.
 * Every line is derived from a real purchase or a rogue-demo result.
 * A missing hash, a sample row, or an unknown status stays quiet.
 */

const HASH = /^0x[0-9a-fA-F]{64}$/;
const EXPLORER = 'https://explorer.testnet.xrplevm.org';

const LABELS = {
  agent: 'Agent',
  rules: 'Rules',
  ledger: 'Ledger',
  xrpl: 'XRPL',
  merchant: 'Merchant',
};

export function validTxHash(hash) {
  return HASH.test(String(hash || '')) ? String(hash) : null;
}

function steps(states) {
  return ['agent', 'rules', 'ledger', 'xrpl', 'merchant'].map((id, index) => ({
    id,
    label: LABELS[id],
    state: states[index],
  }));
}

export function narrationFor(item) {
  if (!item || item.sample) return null;
  const amount = item.amount ? `${item.amount} RLUSD` : 'A purchase';
  const who = item.merchantLabel || 'the merchant';
  if (item.status === 'paid') {
    return validTxHash(item.txHash)
      ? `Purchase approved. ${amount} paid to ${who}.`
      : `Purchase approved. ${amount} to ${who}.`;
  }
  if (item.status === 'pending' || item.status === 'approved') {
    if (item.declineOnly) return `Blocked. ${who} cannot be paid. Nothing was signed.`;
    return `Waiting for Ledger. ${amount} to ${who}.`;
  }
  if (item.status === 'declined' || item.status === 'skipped') return 'Blocked. Nothing was signed.';
  return null;
}

export function narrationForHeist(report) {
  if (!report || report.paid || report.signed || report.lost !== '0') return null;
  const line = String(report.spoken ?? '').trim();
  return line || null;
}

export function narrationForRogue(card) {
  if (!card || card.phase !== 'blocked') return null;
  if (card.route === 'ledger') return 'Waiting for Ledger. Nothing was signed.';
  if (card.route === 'allowance') return 'Blocked. Raising the allowance needs a Ledger signature.';
  return 'Blocked. Nothing was signed.';
}

export function toneKind(item) {
  if (!item || item.sample) return null;
  if (item.status === 'paid') return 'approve';
  if (item.declineOnly || item.status === 'declined' || item.status === 'skipped') return 'block';
  if (item.status === 'pending' || item.status === 'approved') return 'wait';
  return null;
}

export function toneFor(kind) {
  if (kind === 'approve') return { frequency: 660, duration: 0.12, gain: 0.03 };
  if (kind === 'block') return { frequency: 220, duration: 0.14, gain: 0.03 };
  if (kind === 'wait') return { frequency: 440, duration: 0.08, gain: 0.02 };
  return null;
}

export function flowForItem(item) {
  if (!item || item.sample) {
    return { steps: steps(['off', 'off', 'off', 'off', 'off']), caption: 'The path lights up when a purchase is decided.' };
  }
  const hash = validTxHash(item.txHash) || validTxHash(item.payoutTx);
  if (item.status === 'paid') {
    const ledger = item.approver || item.simulatedLedger ? 'on' : 'off';
    return {
      steps: steps(['on', 'on', ledger, hash ? 'on' : 'wait', hash ? 'on' : 'off']),
      caption: hash
        ? 'Paid on XRPL. The explorer link is in the feed.'
        : 'Approved. The explorer link appears when the transaction hash is recorded.',
    };
  }
  if (item.declineOnly || item.status === 'declined' || item.status === 'skipped') {
    return {
      steps: steps(['on', 'stop', 'off', 'off', 'off']),
      caption: 'Blocked by the rules. Nothing was signed.',
    };
  }
  if (item.status === 'pending' || item.status === 'approved') {
    return {
      steps: steps(['on', 'stop', 'wait', 'off', 'off']),
      caption: 'Waiting for a Ledger signature. Nothing has been paid.',
    };
  }
  return { steps: steps(['off', 'off', 'off', 'off', 'off']), caption: 'The path lights up when a purchase is decided.' };
}

const AGENT_STAGES = {
  agent: { states: ['on', 'wait', 'off', 'off', 'off'], caption: 'The agent has a quote. The rules are next.' },
  rules: { states: ['on', 'wait', 'off', 'off', 'off'], caption: 'Checking the rules.' },
  xrpl: { states: ['on', 'on', 'off', 'wait', 'off'], caption: 'Inside the rules. Paying on XRPL.' },
};

const LEDGER_STAGES = {
  signed: { states: ['on', 'on', 'on', 'wait', 'off'], caption: 'Signed on the Ledger. Sending to XRPL.' },
  broadcasting: { states: ['on', 'on', 'on', 'wait', 'off'], caption: 'Signed on the Ledger. Broadcasting on XRPL.' },
  settling: { states: ['on', 'on', 'on', 'on', 'wait'], caption: 'On XRPL. Settling with the merchant.' },
};

/**
 * The payment path for a purchase still in flight, from GET /api/events.
 * Null when nothing is in flight, so the latest activity row shows instead.
 */
export function flowForStage(stage) {
  if (!stage || typeof stage !== 'object') return null;
  const table = stage.source === 'ledger' ? LEDGER_STAGES : stage.source === 'agent' ? AGENT_STAGES : null;
  const row = table?.[stage.source === 'ledger' ? stage.phase : stage.stage];
  if (!row) return null;
  const amount = stage.amount ? `${stage.amount} RLUSD` : '';
  const who = stage.merchantLabel ? ` to ${stage.merchantLabel}` : '';
  const lead = amount ? `${amount}${who}. ` : '';
  return { steps: steps(row.states), caption: `${lead}${row.caption}`, live: true };
}

export function flowForHeist(report) {
  if (!report || report.paid || report.signed) return null;
  return {
    steps: steps(['on', 'stop', 'off', 'off', 'off']),
    caption: report.ruleText || 'Blocked by the rules. Nothing was signed.',
  };
}

export function flowForRogue(card) {
  if (!card) return null;
  if (card.phase === 'summary') {
    const rested = flowForRogue({ id: 'raise', phase: 'blocked' });
    return { ...rested, caption: card.attempt || rested.caption };
  }
  if (card.id === 'over-cap') {
    if (card.phase === 'attempt') return { steps: steps(['on', 'wait', 'off', 'off', 'off']), caption: 'The agent is asking for a quote over the cap.' };
    if (card.phase === 'rule') return { steps: steps(['on', 'stop', 'off', 'off', 'off']), caption: card.ruleText || 'The cap caught this quote.' };
    return { steps: steps(['on', 'stop', 'wait', 'off', 'off']), caption: 'Waiting for Ledger. Nothing was signed.' };
  }
  if (card.id === 'unlisted') {
    if (card.phase === 'attempt') return { steps: steps(['on', 'wait', 'off', 'off', 'off']), caption: card.attempt || 'The agent is asking an unlisted merchant.' };
    return { steps: steps(['on', 'stop', 'off', 'off', 'off']), caption: 'Blocked. A Ledger signature cannot pay this merchant.' };
  }
  if (card.id === 'raise') {
    if (card.phase === 'attempt') return { steps: steps(['on', 'wait', 'off', 'off', 'off']), caption: card.attempt || 'The agent is asking Eve to raise the allowance.' };
    return { steps: steps(['on', 'stop', 'wait', 'off', 'off']), caption: 'Refused. A Ledger SetAllowance signature is required.' };
  }
  return null;
}

export function txFeed(items, explorer = EXPLORER) {
  const base = String(explorer || EXPLORER).replace(/\/$/, '');
  const rows = [];
  for (const item of items || []) {
    if (!item || item.sample) continue;
    const hash = validTxHash(item.txHash) || validTxHash(item.payoutTx);
    if (!hash) continue;
    rows.push({
      id: item.id || hash,
      label: item.merchantLabel || 'Merchant',
      amount: item.amount ?? '',
      hash,
      href: `${base}/tx/${hash}`,
    });
  }
  return rows.slice(0, 4);
}

/**
 * What the payment path shows on top of the latest activity row.
 *   demo      a Heist or Rogue result: its flow, with the alert on
 *   alert     a demo beat with no flow of its own
 *   stage     a live stage from GET /api/events; null clears a stage it set
 *   activity  a new real decision arrived: clear everything, so the row shows
 */
export const PATH_IDLE = { flow: null, source: '', alert: false };

export function pathReducer(state, action) {
  switch (action?.type) {
    case 'demo':
      return action.flow ? { flow: action.flow, source: 'demo', alert: true } : { ...state, alert: true };
    case 'alert':
      return { ...state, alert: true };
    case 'stage': {
      const flow = flowForStage(action.stage);
      if (flow) return { flow, source: 'stage', alert: false };
      return state.source === 'stage' ? PATH_IDLE : state;
    }
    case 'activity':
      return PATH_IDLE;
    default:
      return state;
  }
}
