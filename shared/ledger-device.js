/**
 * Pure helpers for the Ledger approval sheet.
 * No device I/O and no private keys live here.
 */

/** Ethereum account the dashboard asks the device to confirm with. */
export const LEDGER_ACCOUNT_PATH = "44'/60'/0'/0/0";

export function webHidSupported(scope = globalThis) {
  const hid = scope.navigator?.hid;
  return Boolean(hid && typeof hid.requestDevice === 'function');
}

/**
 * Turn a Device Management Kit error into copy for the approval sheet.
 * `interaction` is the in-progress device prompt, when there is one.
 */
export function describeLedgerError(error, interaction = '') {
  const prompt = describeLedgerInteraction(interaction);
  if (prompt && !error) return prompt;

  const tag = String(error?._tag ?? error?.name ?? '');
  const code = String(error?.errorCode ?? error?.statusCode ?? error?.code ?? '');
  const blob = `${tag} ${code} ${error?.message ?? error ?? ''}`.toLowerCase();

  // Chrome shows the device prompt only within a few seconds of a click.
  if (/user gesture|user activation/.test(blob)) {
    return { code: 'gesture', message: 'Click Connect again. The browser needs a fresh click to show the Ledger prompt. Nothing was signed.' };
  }
  if (/6985|6982|5501|userrefused|refusedbyuser|actionrefused|condition not satisfied|canceled by user|cancelled by user|action refused|rejected the/.test(blob)) {
    return { code: 'rejected', message: 'The Ledger rejected the approval. Nothing was paid.' };
  }
  if (/5515|devicelocked|device is locked|device locked/.test(blob)) {
    return { code: 'locked', message: 'Unlock the Ledger and try again.' };
  }
  if (/6d00|6e00|6511|6a83|wrong app|ethereum app|app is not open|unsupportedapplication|cla not supported|ins not supported/.test(blob)) {
    return { code: 'wrong_app', message: 'Open the Ethereum app on the Ledger and try again.' };
  }
  if (/webhid|no hid|hid is undefined|not supported/.test(blob)) {
    return {
      code: 'unsupported',
      message: 'Connect a Ledger from Chrome, Edge, or Brave. This browser has no WebHID support.',
    };
  }
  if (/noaccessibledevice|no selected device|no device selected/.test(blob)) {
    return { code: 'disconnected', message: 'No Ledger was selected. Nothing was paid.' };
  }
  if (/timed out|no ledger|no device|device not found|disconnected/.test(blob)) {
    return { code: 'disconnected', message: 'The Ledger disconnected. Unlock it, plug it in, and try again.' };
  }
  if (prompt?.code === 'locked' || prompt?.code === 'wrong_app') return prompt;
  return { code: 'device', message: 'The Ledger could not sign this approval. Nothing was paid.' };
}

/** In-progress prompt while the device action is still open. */
export function describeLedgerInteraction(interaction) {
  const name = String(interaction ?? '').toLowerCase();
  if (!name || name === 'none') return null;
  if (name.includes('unlock')) return { code: 'locked', message: 'Unlock the Ledger to continue.' };
  if (name.includes('open-app') || name.includes('openapp') || name.includes('confirm-open')) {
    return { code: 'wrong_app', message: 'Confirm opening the Ethereum app on the Ledger.' };
  }
  if (name.includes('web3-checks') || name.includes('web3checks')) {
    return { code: 'checks', message: 'Accept or skip Web3 checks on the Ledger. The purchase confirmation comes next.' };
  }
  if (name.includes('sign-typed-data') || name.includes('signtypeddata') || name === 'confirm') {
    return { code: 'confirm', message: 'Confirm the purchase on the Ledger.' };
  }
  return null;
}
