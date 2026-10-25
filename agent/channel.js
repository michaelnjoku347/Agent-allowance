/**
 * Pick a Channel to spend from.
 * An explicit CHANNEL_ID must already be open, pay this merchant, and have
 * enough cap. Otherwise reuse the first open channel that does. A channel
 * that fails those checks is not reused; the caller opens one at the budget.
 */

function asWei(value) {
  if (typeof value === 'bigint') return value;
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

function channelCap(channel) {
  return asWei(channel?.cap ?? channel?.cap_wei);
}

function channelRemaining(channel) {
  const cap = channelCap(channel);
  if (cap == null) return null;
  const redeemed = asWei(channel?.redeemed ?? channel?.redeemed_wei) ?? 0n;
  return cap - redeemed;
}

function fits(channel, { payout, minCapWei, remainingWei }) {
  if (payout && String(channel?.payout ?? '').toLowerCase() !== payout) return 'payout';
  const cap = channelCap(channel);
  if (minCapWei != null && (cap == null || cap < minCapWei)) return 'cap';
  const left = channelRemaining(channel);
  if (remainingWei != null && (left == null || left < remainingWei)) return 'remaining';
  return '';
}

export function selectOpenChannel(channels, channelId = '', options = {}) {
  const list = Array.isArray(channels) ? channels : [];
  const payout = String(options.payout ?? '').trim().toLowerCase();
  const minCapWei = options.minCapWei ?? null;
  const remainingWei = options.remainingWei ?? null;
  const wanted = String(channelId ?? '').trim().toLowerCase();
  if (wanted) {
    const match = list.find((channel) => String(channel.channel_id ?? '').toLowerCase() === wanted);
    if (!match) throw new Error('CHANNEL_ID was not found for this team.');
    if (match.channel_status !== 'open') {
      throw new Error(`CHANNEL_ID is ${match.channel_status}, not open.`);
    }
    const reason = fits(match, { payout, minCapWei, remainingWei });
    if (reason === 'payout') {
      throw new Error('CHANNEL_ID pays a different merchant. Clear CHANNEL_ID to open a channel for this payout.');
    }
    if (reason === 'cap' || reason === 'remaining') {
      throw new Error('CHANNEL_ID does not have enough remaining cap. Clear CHANNEL_ID to open a channel at the budget.');
    }
    return match;
  }
  return list.find((channel) => channel.channel_status === 'open' && !fits(channel, { payout, minCapWei, remainingWei })) ?? null;
}
