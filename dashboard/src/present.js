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
