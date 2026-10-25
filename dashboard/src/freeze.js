/**
 * Words and state for the kill switch. Freeze stops new signatures first,
 * then tries to close the AP4M payment channel. Unfreeze only lets the agent
 * sign again; its next run opens a fresh channel.
 */

export const NEXT_CHANNEL = 'Its next run opens a new payment channel.';

/** What the top-bar control says and does. */
export function freezeControl({ frozen = false, phase = '' } = {}) {
  if (phase === 'freezing') return { label: 'Freezing…', next: true, busy: true };
  if (phase === 'unfreezing') return { label: 'Unfreezing…', next: false, busy: true };
  return frozen
    ? { label: 'Unfreeze', next: false, busy: false }
    : { label: 'Freeze', next: true, busy: false };
}

/**
 * The banner shown on every page while the agent is frozen or changing state.
 * snapshot fields: frozen, frozenAt, channelClosed, freezeDetail.
 */
export function freezeNotice(snapshot, { phase = '', error = '' } = {}) {
  if (phase === 'freezing') {
    return {
      tone: 'frozen',
      title: 'Freezing the agent…',
      body: 'Signing has stopped. Closing the payment channel can take up to a minute on testnet.',
      action: null,
      error,
    };
  }
  if (phase === 'unfreezing') {
    return { tone: 'frozen', title: 'Unfreezing…', body: 'Letting the agent pay inside the rules again.', action: null, error };
  }
  if (!snapshot?.frozen) {
    return error ? { tone: 'error', title: 'That did not go through', body: error, action: null, error: '' } : null;
  }
  const channel = snapshot.channelClosed
    ? 'The payment channel is closed, so nothing it signed before can be spent further.'
    : snapshot.freezeDetail
      ? `${snapshot.freezeDetail.replace(/\.?$/, '.')}`
      : 'No payment channel was open.';
  return {
    tone: 'frozen',
    title: 'Agent frozen. Nothing can be signed.',
    body: `${channel} Unfreeze lets the agent pay inside the rules again. ${NEXT_CHANNEL}`,
    action: 'Unfreeze agent',
    error,
  };
}

/** The line a toast and the screen reader hear once the server answers. */
export function freezeResult(frozen, body = {}) {
  if (!frozen) return `Agent unfrozen. It can pay inside the rules again. ${NEXT_CHANNEL}`;
  if (body.channelClosed) return 'Agent frozen. Signing stopped and the payment channel is closed.';
  return 'Agent frozen. Signing stopped.';
}
