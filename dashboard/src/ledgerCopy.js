/**
 * Words for the Ledger screens, kept apart from the components so they can be
 * tested: the approval sheet's status line and error titles, and the check on
 * an approver address typed into the Security page.
 */

/** Where an error happened decides its title: nothing was signed before the device step. */
export const APPROVAL_ERROR_TITLES = Object.freeze({
  prepare: 'This approval cannot start yet',
  device: 'The Ledger did not finish',
  simulated: 'The approval did not finish',
  pay: 'The payment did not finish',
});

/** The one status line under the approval steps, so it never says "waiting" while nothing is. */
export function deviceStatusLine({ phase, status = '', preview = false, simulated = false, supported = true, error = '' } = {}) {
  if (preview || error) return '';
  if (phase === 'loading') return 'Preparing the approval…';
  if (phase === 'device' || phase === 'paying') return status || 'Waiting for your Ledger…';
  if (phase === 'ready' && !simulated) {
    return supported
      ? 'Plug in your Ledger and open the Ethereum app, then press Approve.'
      : 'Approving needs a Ledger connected to Chrome, Edge, or Brave on a computer.';
  }
  return '';
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Why the approver address cannot be saved yet, or '' when it can. */
export function approverInputError(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Enter the address of your Ledger account, or read it from the device.';
  if (!ADDRESS.test(text)) return 'That is not an account address. It starts with 0x and has 40 more characters, 0 to 9 and a to f.';
  return '';
}
