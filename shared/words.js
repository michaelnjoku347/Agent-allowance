/** Plain words for a rule or Jev reason. Shared by the API and the dashboard. */

export function plainReason(reason) {
  const words = {
    expired: 'The allowance date has passed.',
    'merchant not allowed': 'This merchant is not on the allowlist.',
    'over per-purchase cap': 'This is over the per-purchase cap.',
    'over budget': 'This would go over the budget.',
    'over channel cap': 'The channel cannot cover this payment.',
    'over spend rate': 'The hourly spend rate stopped this purchase.',
    'Jev flagged for review': 'Jev asked for a person to review this before it is paid.',
    'amount must be positive': 'The price is not a positive amount.',
    'within allowance': 'Inside the allowance. The agent paid.',
    'ledger approved': 'Approved on a Ledger and paid once.',
    'agent frozen': 'The agent is frozen. Nothing was signed.',
    freeze: 'The agent is frozen. New payments are refused.',
    unfreeze: 'The agent can pay inside the allowance again.',
    'Jev unavailable — rules only': 'Jev was not available, so only the rules were used.',
    'Jev would pay this.': 'Jev would pay this.',
  };
  return words[reason] || reason || 'The rules did not allow this purchase.';
}

export function jevSourceLabel(source) {
  if (source === 'jev') return 'Jev';
  if (source === 'kev') return 'Kev';
  return 'rules only';
}

/** One explanation of Jev, shared by Eve and the dashboard. */
export function explainJev() {
  return 'Jev is the risk review. It runs only after the rules allow a purchase. It can hold a payment for a person. It cannot spend past a rule. If Jev is down, the rules still decide.';
}
