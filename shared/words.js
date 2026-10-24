/** Plain words for a rule or Jev reason. Shared by the API and the dashboard. */

export function plainReason(reason) {
  const words = {
    expired: 'The allowance date has passed.',
    'merchant not allowed': 'This merchant is not on the allowlist.',
    'over per-purchase cap': 'This is over the per-purchase cap.',
    'over budget': 'This would go over the budget.',
    'over channel cap': 'The channel cannot cover this payment.',
    'Jev flagged for review': 'Jev asked for a person to review this before it is paid.',
    'amount must be positive': 'The price is not a positive amount.',
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
