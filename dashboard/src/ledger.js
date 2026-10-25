/**
 * Chrome WebHID connection to a Ledger running the Ethereum app.
 *
 * The device signs the EIP-712 ApprovePurchase payload from the allowance API.
 * This module only talks to a hardware wallet over WebHID.
 *
 * The Ledger kit is most of the dashboard's JavaScript, so it is downloaded
 * only when a Ledger screen opens: prepareLedger() starts the download, and
 * the Connect click then finds the kit ready and opens WebHID at once.
 */

import {
  LEDGER_ACCOUNT_PATH,
  describeLedgerError,
  describeLedgerInteraction,
  webHidSupported,
} from '../../shared/ledger-device.js';
import { ledgerClearSign } from '../../shared/ledger-clear-sign.js';

const CHAIN_ID = 1449000;
let dmk;
let kitLoad;
let DeviceActionStatus;
let SignerEthBuilder;

function userError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.ledgerMessage = true;
  return error;
}

function wrap(error) {
  if (error?.ledgerMessage) return error;
  const described = describeLedgerError(error);
  return userError(described.message, described.code);
}

/**
 * Load the local ERC-7730 descriptor, then refuse clear-signing.
 * Chain 1449000 is not in Ledger's registry, and a success filter without a
 * Ledger PKI certificate can make signTypedData fail.
 */
function fieldContextModule() {
  const decision = ledgerClearSign(CHAIN_ID);
  const skip = { type: 'error', error: new Error(decision.reason) };
  return {
    async getTypedDataFilters() {
      return skip;
    },
    async getContexts() {
      return [];
    },
    async getFieldContext() {
      return skip;
    },
    async getWeb3Checks() {
      return skip;
    },
    async getSolanaContext() {
      return skip;
    },
    async report() {},
    async signReport() {},
  };
}

/** Download and build the kit once. A failed download can be tried again. */
function loadKit() {
  kitLoad ??= Promise.all([
    import('@ledgerhq/device-management-kit'),
    import('@ledgerhq/device-signer-kit-ethereum'),
    import('@ledgerhq/device-transport-kit-web-hid'),
  ]).then(([management, signer, transport]) => {
    DeviceActionStatus = management.DeviceActionStatus;
    SignerEthBuilder = signer.SignerEthBuilder;
    dmk = new management.DeviceManagementKitBuilder().addTransport(transport.webHidTransportFactory).build();
    return dmk;
  }).catch((error) => {
    kitLoad = undefined;
    throw error;
  });
  return kitLoad;
}

/** The built kit, without waiting when it is already there, so the click keeps its user gesture. */
async function ledgerKit() {
  if (dmk) return dmk;
  try {
    return await loadKit();
  } catch {
    throw userError('The Ledger connection could not load. Check your connection and try again. Nothing was signed.', 'unavailable');
  }
}

/**
 * Start downloading the kit before the Connect click, so that click can open
 * WebHID immediately. Resolves true when the kit is ready; never rejects.
 */
export function prepareLedger() {
  if (dmk) return Promise.resolve(true);
  if (!webHidSupported()) return Promise.resolve(false);
  return loadKit().then(() => true, () => false);
}

const MESSAGE_SHAPES = {
  ApprovePurchase: 'purchaseId:string,merchant:string,amount:string,expiry:string',
  SetAllowance: 'cap:string,budget:string,expiry:string,merchants:string,validUntil:string',
  AgentMandate: 'agent:string,budget:string,cap:string,expiry:string,merchants:string,validUntil:string',
};

function assertTypedData(typedData) {
  const domain = typedData?.domain ?? {};
  const primary = typedData?.primaryType;
  const shape = (typedData?.types?.[primary] ?? []).map((field) => `${field.name}:${field.type}`).join(',');
  if (domain.name !== 'Agent Allowance' || domain.version !== '1' || Number(domain.chainId) !== CHAIN_ID) {
    throw userError('This approval is not for the XRPL EVM Testnet allowance.', 'invalid');
  }
  if (!MESSAGE_SHAPES[primary] || shape !== MESSAGE_SHAPES[primary]) {
    throw userError('This approval is not an allowance message.', 'invalid');
  }
}

function signatureHex(signature) {
  const clean = (value) => String(value ?? '').replace(/^0x/i, '').padStart(64, '0');
  let recovery = Number(signature?.v);
  if (!Number.isInteger(recovery)) throw userError('The Ledger did not return a signature.', 'device');
  if (recovery === 0 || recovery === 1) recovery += 27;
  if (recovery !== 27 && recovery !== 28) throw userError('The Ledger did not return a signature.', 'device');
  return `0x${clean(signature.r)}${clean(signature.s)}${recovery.toString(16).padStart(2, '0')}`;
}

function watch(observable, onState) {
  return new Promise((resolve, reject) => {
    const sub = observable.subscribe({
      next(state) {
        if (state.status === DeviceActionStatus.Pending) {
          const interaction = state.intermediateValue?.requiredUserInteraction;
          const prompt = describeLedgerInteraction(interaction);
          if (prompt) onState?.(prompt);
          return;
        }
        if (state.status === DeviceActionStatus.Completed) {
          sub.unsubscribe();
          resolve(state.output);
          return;
        }
        if (state.status === DeviceActionStatus.Error) {
          sub.unsubscribe();
          reject(state.error ?? userError('The Ledger could not sign this approval.', 'device'));
          return;
        }
        if (state.status === DeviceActionStatus.Stopped) {
          sub.unsubscribe();
          reject(userError('The Ledger approval was cancelled. Nothing was paid.', 'rejected'));
        }
      },
      error(error) {
        reject(error);
      },
    });
  });
}

/** Open the browser's device picker and resolve with the chosen Ledger. */
function discoverLedger(kit, setCancel) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const sub = kit.startDiscovering({}).subscribe({
      next(device) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(device);
      },
      error(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sub.unsubscribe();
      kit.stopDiscovering().catch(() => {});
      reject(userError('No Ledger appeared. Unlock it, plug it in, and pick it in the browser prompt.', 'disconnected'));
    }, 60_000);
    setCancel?.(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.unsubscribe();
      kit.stopDiscovering().catch(() => {});
      reject(userError('The Ledger request was cancelled. Nothing was signed.', 'rejected'));
    });
  });
}

/**
 * Read the Ethereum address of the Ledger's approval account, for setting
 * up the approver. Nothing is signed. Call it from a click.
 */
export async function readLedgerAddress({ onState, setCancel } = {}) {
  if (!webHidSupported()) {
    throw userError('Connect a Ledger from Chrome, Edge, or Brave. This browser has no WebHID support.', 'unsupported');
  }
  const kit = dmk ?? (await ledgerKit());
  onState?.({ code: 'connecting', message: 'Choose the Ledger in the browser prompt.' });
  let sessionId = '';
  try {
    const device = await discoverLedger(kit, setCancel);
    onState?.({ code: 'connecting', message: 'Connecting to the Ledger…' });
    sessionId = await kit.connect({ device });
    const signer = new SignerEthBuilder({ dmk: kit, sessionId }).withContextModule(fieldContextModule()).build();
    const addressAction = signer.getAddress(LEDGER_ACCOUNT_PATH, { checkOnDevice: false });
    setCancel?.(() => addressAction.cancel());
    const address = await watch(addressAction.observable, onState);
    const connected = String(address?.address ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(connected)) throw userError('The Ledger did not return an Ethereum address.', 'device');
    return connected;
  } catch (error) {
    throw wrap(error);
  } finally {
    if (sessionId) await kit.disconnect({ sessionId }).catch(() => {});
  }
}

/**
 * Call this from the Connect click. Discovery starts immediately so the
 * browser still treats it as the user gesture.
 */
export async function signOnLedger(typedData, { expectedAddress, onState, setCancel } = {}) {
  if (!webHidSupported()) {
    throw userError(
      'Connect a Ledger from Chrome, Edge, or Brave. This browser has no WebHID support.',
      'unsupported',
    );
  }
  assertTypedData(typedData);
  const kit = dmk ?? (await ledgerKit());
  onState?.({ code: 'connecting', message: 'Choose the Ledger in the browser prompt.' });

  let sessionId = '';
  const discovery = discoverLedger(kit, setCancel);

  try {
    const device = await discovery;
    onState?.({ code: 'connecting', message: 'Connecting to the Ledger…' });
    sessionId = await kit.connect({ device });
    const signer = new SignerEthBuilder({ dmk: kit, sessionId })
      .withContextModule(fieldContextModule())
      .build();
    const addressAction = signer.getAddress(LEDGER_ACCOUNT_PATH, { checkOnDevice: false });
    setCancel?.(() => addressAction.cancel());
    const address = await watch(addressAction.observable, onState);
    const connected = String(address?.address ?? '').toLowerCase();
    const expected = String(expectedAddress ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(connected)) {
      throw userError('The Ledger did not return an Ethereum address.', 'device');
    }
    if (connected !== expected) {
      throw userError(
        `This Ledger account is ${connected.slice(0, 6)}…${connected.slice(-4)}, but the allowance expects ${expected.slice(0, 6)}…${expected.slice(-4)}. Nothing was signed.`,
        'wrong_signer',
      );
    }
    onState?.({ code: 'confirm', message: 'Confirm the purchase on the Ledger.' });
    const signAction = signer.signTypedData(LEDGER_ACCOUNT_PATH, typedData);
    setCancel?.(() => signAction.cancel());
    const signed = await watch(signAction.observable, onState);
    return signatureHex(signed);
  } catch (error) {
    throw wrap(error);
  } finally {
    if (sessionId) {
      await kit.disconnect({ sessionId }).catch(() => {});
    }
  }
}
