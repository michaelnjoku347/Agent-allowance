import { lstatSync, readFileSync } from 'node:fs';

/** Return only a pending intent, never the retained signed voucher header. */
export function pendingPurchase(file) {
  let text;
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 131072) throw new Error('Invalid retained purchase file.');
    text = readFileSync(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let retained;
  try { retained = JSON.parse(text); } catch { throw new Error('Retained purchase file is invalid; preserve it for recovery.'); }
  if (retained.complete === true) return null;
  const intent = retained.intent;
  if (retained.complete !== false || !intent || !/^0x[0-9a-f]{64}$/.test(intent.channelId)
      || !/^0x[0-9a-f]{40}$/i.test(intent.agent) || typeof intent.resourceUrl !== 'string'
      || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(intent.operation)
      || !/^[1-9][0-9]{0,77}$/.test(intent.maximumAmount)) {
    throw new Error('Retained purchase intent is invalid; preserve it for recovery.');
  }
  return { agent: intent.agent, channelId: intent.channelId, resourceUrl: intent.resourceUrl,
    operation: intent.operation, maximumAmount: intent.maximumAmount };
}

export function validateRecovery(pending, { agent, resourceUrl, channelId = '' }) {
  if (!pending) return;
  if (pending.agent.toLowerCase() !== agent.toLowerCase() || pending.resourceUrl !== resourceUrl
      || (channelId && pending.channelId !== channelId.toLowerCase())) {
    throw new Error('Resume the unresolved purchase with its original wallet, resource and channel before starting another.');
  }
}
