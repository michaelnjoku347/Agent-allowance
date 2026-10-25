import { useEffect, useRef, useState } from 'react';
import { fetchApprovalProgress, requestApprovalChallenge, simulateLedgerApproval, submitLedgerApproval } from './api.js';
import { when } from './format.js';
import { prepareLedger, signOnLedger } from './ledger.js';
import { webHidSupported } from '../../shared/ledger-device.js';

const PAY_STAGES = [
  ['signed', 'Signed'],
  ['broadcasting', 'Broadcasting'],
  ['settling', 'Settling'],
  ['paid', 'Paid'],
];

function stageClass(current, id) {
  const at = PAY_STAGES.findIndex(([key]) => key === current);
  const index = PAY_STAGES.findIndex(([key]) => key === id);
  if (at < 0 || index > at) return 'wait';
  if (index === at) return 'active';
  return 'done';
}

/**
 * Approval sheet. The dark panel is the readable message. The device may show
 * raw fields or a blind-signing prompt on chain 1449000.
 */
export default function LedgerApproval({ item, onPaid, simulated = false }) {
  const [phase, setPhase] = useState('loading');
  const [challenge, setChallenge] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [payStage, setPayStage] = useState('signed');
  const cancelRef = useRef(null);
  const pollRef = useRef(null);
  const supported = webHidSupported();

  function stopPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function rememberStage(progress) {
    if (progress?.phase && PAY_STAGES.some(([key]) => key === progress.phase)) setPayStage(progress.phase);
  }

  function trackStages() {
    stopPoll();
    pollRef.current = setInterval(async () => {
      rememberStage(await fetchApprovalProgress(item.id));
    }, 1000);
  }

  function watchUntilQuiet() {
    stopPoll();
    pollRef.current = setInterval(async () => {
      const progress = await fetchApprovalProgress(item.id);
      rememberStage(progress);
      if (progress?.inFlight) return;
      stopPoll();
      if (progress?.missing) {
        setPayStage('paid');
        setPhase('done');
        setResult((current) => current ?? { note: 'Approved on a Ledger and paid once through AP4M x402.' });
        onPaid?.();
        return;
      }
      setError('That payment did not finish. Check Needs you before trying again.');
      setPhase('error');
      onPaid?.();
    }, 1000);
  }

  useEffect(() => () => {
    cancelRef.current?.();
    stopPoll();
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
        if (err.code === 'in_progress') {
          setPhase('paying');
          setPayStage('broadcasting');
          setStatus('This approval is already being paid.');
          watchUntilQuiet();
          return;
        }
        setError(err.message || 'Could not prepare that approval.');
        setChallenge(null);
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
      setPayStage('signed');
      setStatus('The Ledger signed it. Paying this quote…');
      trackStages();
      const body = await submitLedgerApproval(item.id, {
        signature,
        message: challenge.typedData.message,
      });
      stopPoll();
      if (body.inFlight) {
        setPayStage(body.phase || 'broadcasting');
        setStatus('This approval is already being paid.');
        watchUntilQuiet();
        return;
      }
      setPayStage('paid');
      setResult(body);
      setPhase('done');
      await onPaid?.();
    } catch (err) {
      cancelRef.current = null;
      stopPoll();
      setError(err.message || 'The Ledger did not approve this purchase.');
      setChallenge(null);
      setPhase('loading');
      try {
        const fresh = await requestApprovalChallenge(item.id);
        setChallenge(fresh);
        setPhase('error');
      } catch (refreshErr) {
        setError(refreshErr.message || err.message || 'The Ledger did not approve this purchase.');
        setPhase('error');
      }
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
          The panel shows the readable purchase, merchant, amount, and expiry. The Ledger may show raw fields, or it may ask for blind signing, because chain 1449000 has no registered ERC-7730 descriptor.
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
            {display.merchantLabel ? ` to ${display.merchantLabel}` : ''}. Expires {when(display.expiryIso)}. The panel shows the expiry as {display.expiry}.
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
      {phase === 'paying' ? (
        <ol className="pay-stages" aria-label="Payment progress">
          {PAY_STAGES.map(([id, label]) => (
            <li key={id} className={stageClass(payStage, id)}>{label}</li>
          ))}
        </ol>
      ) : null}
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
          Unlock the Ledger, open the Ethereum app if it asks, and confirm there. If the app asks for blind signing, compare the panel with the quote before you allow it. The device is not clear-signing this testnet message.
        </p>
      ) : null}
    </div>
  );
}
