/**
 * Pick a Channel to spend from.
 * An explicit CHANNEL_ID must already be open. Otherwise reuse the first open
 * Channel so a new run does not open another one.
 */

export function selectOpenChannel(channels, channelId = '') {
  const list = Array.isArray(channels) ? channels : [];
  const wanted = String(channelId ?? '').trim().toLowerCase();
  if (wanted) {
    const match = list.find((channel) => String(channel.channel_id ?? '').toLowerCase() === wanted);
    if (!match) throw new Error('CHANNEL_ID was not found for this team.');
    if (match.channel_status !== 'open') {
      throw new Error(`CHANNEL_ID is ${match.channel_status}, not open.`);
    }
    return match;
  }
  return list.find((channel) => channel.channel_status === 'open') ?? null;
}
