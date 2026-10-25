import { useEffect, useRef, useState } from 'react';
import { requestApprovalChallenge, simulateLedgerApproval, submitLedgerApproval } from './api.js';
import { when } from './format.js';
import { prepareLedger, signOnLedger } from './ledger.js';
import { webHidSupported } from '../../shared/ledger-device.js';

/**
 * Approval sheet. The values in the dark panel are the EIP-712 fields the
 * Ethereum app shows. Connecting uses a Ledger over WebHID.
 */
export default function LedgerApproval({ item, onPaid, simulated = false }) {
  const [phase, setPhase] = useState('loading');
  const [challenge, setChallenge] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const cancelRef = useRef(null);
  const supported = webHidSupported();

  useEffect(() => () => {
    cancelRef.current?.();
  }, []);

  useEffect(() => {
    let stop = false;
    prepareLedger();
    requestApprovalChallenge(item.id)
      .then((body) => {
        if (stop) return;
        setChallenge(body);
        setPhase('ready');
      })
      .catch((err) => {
        if (stop) return;
        setError(err.message || 'Could not prepare that approval.');
        setPhase('error');
      });
    return () => {
      stop = true;
    };
  }, [item.id]);

  async function simulate() {
    setError('');
    setPhase('paying');
    setStatus('simulated Ledger signature');
    try {
      const body = await simulateLedgerApproval(item.id);
      setResult(body);
      setPhase('done');
      await onPaid?.();
    } catch (err) {
      setError(err.message || 'Could not approve that purchase.');
      setPhase('error');
    }
  }

  async function connect() {
    setError('');
    setPhase('device');
    setStatus('Choose the Ledger in the browser prompt.');
    try {
      const signature = await signOnLedger(challenge.typedData, {
        expectedAddress: challenge.approverAddress,
        onState: (next) => setStatus(next.message),
        setCancel: (fn) => { cancelRef.current = fn; },
      });
      cancelRef.current = null;
      setPhase('paying');
      setStatus('The Ledger signed it. Paying this quote…');
      const body = await submitLedgerApproval(item.id, {
        signature,
        message: challenge.typedData.message,
      });
      setResult(body);
      setPhase('done');
      await onPaid?.();
    } catch (err) {
      cancelRef.current = null;
      setError(err.message || 'The Ledger did not approve this purchase.');
      setPhase('error');
    }
  }

  const display = challenge?.display;
  const deviceFields = display ? [
    ['purchaseId', display.purchaseId],
    ['merchant', display.merchant],
    ['amount', display.amount],
    ['expiry', String(display.expiry)],
  ] : [];

  return (
    <div className="approval">
      {simulated ? (
        <p className="sim-banner" role="status">simulated Ledger signature</p>
      ) : (
        <p>
          Confirm on the Ledger only if the device shows the same purchase, merchant, amount, and expiry.
        </p>
      )}
      {display ? (
        <>
          <div className="device" aria-label="What the Ledger will display">
            <p className="device-kicker">{simulated ? 'simulated Ledger signature' : 'On the Ledger'}</p>
            <p className="device-domain">{display.domain}</p>
            <dl>
              {deviceFields.map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="meta">
            {display.amountLabel}
            {display.merchantLabel ? ` to ${display.merchantLabel}` : ''}. Expires {when(display.expiryIso)}. The device shows the expiry as {display.expiry}.
          </p>
          {simulated ? (
            <p className="meta">Backup demo key <code>{challenge.approverAddress}</code>. Not a hardware account.</p>
          ) : (
            <p className="meta">
              Account {challenge.derivationPath}. Registered approver <code>{challenge.approverAddress}</code>.
            </p>
          )}
        </>
      ) : null}

      {phase === 'loading' ? <p className="device-status" role="status">Preparing the approval…</p> : null}
      {phase === 'device' || phase === 'paying' ? <p className="device-status" role="status">{status}</p> : null}
      {phase === 'done' ? (
        <p className="note" role="status">{result?.note || (simulated ? 'simulated Ledger signature' : 'Approved on the Ledger.')}</p>
      ) : null}
      {error ? <p className="note warn" role="alert">{error}</p> : null}

      {simulated && (phase === 'ready' || phase === 'error') ? (
        <div className="pair">
          <button
            type="button"
            className="btn primary"
            disabled={!challenge || phase === 'loading'}
            onClick={simulate}
          >
            simulated Ledger signature
          </button>
        </div>
      ) : null}
      {!simulated && (phase === 'ready' || phase === 'error') ? (
        <div className="pair">
          <button
            type="button"
            className="btn primary"
            disabled={!supported || !challenge || phase === 'loading'}
            onClick={connect}
          >
            {phase === 'error' && challenge ? 'Try again' : 'Connect Ledger'}
          </button>
        </div>
      ) : null}
      {!simulated && phase === 'ready' && !supported ? (
        <p className="note warn" role="alert">
          Connect a Ledger from Chrome, Edge, or Brave. This browser has no WebHID support.
        </p>
      ) : null}
      {!simulated && phase === 'ready' && supported ? (
        <p className="meta">
          Unlock the Ledger, open the Ethereum app if it asks, and confirm there. If the app says blind signing, the fields above are still the message — allow it only when they match.
        </p>
      ) : null}
    </div>
  );
}
