import { useEffect, useRef, useState } from 'react';
import { fetchApprovalProgress, requestApprovalChallenge, simulateLedgerApproval, submitLedgerApproval } from './api.js';
import { ceremonyDate, money } from './format.js';
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
export default function LedgerApproval({ item, onPaid, simulated = false, preview = false, expiresAt = '' }) {
  const [phase, setPhase] = useState(preview ? 'ready' : 'loading');
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
    if (preview) {
      setPhase('ready');
      return undefined;
    }
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
  }, [item.id, preview]);

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
  const amountText = `${money(item.amount)} RLUSD`;
  const merchantName = item.merchantLabel || display?.merchantLabel || 'Merchant';
  const expiryText = ceremonyDate(display?.expiryIso || expiresAt);
  const approveLabel = `Approve ${money(item.amount)} RLUSD`;

  function approve() {
    if (preview) {
      setError('This is a preview. Nothing was signed.');
      setPhase('error');
      return;
    }
    if (simulated) simulate();
    else connect();
  }

  const canApprove = preview || ((phase === 'ready' || phase === 'error') && (simulated ? Boolean(challenge) : supported && Boolean(challenge)));

  const step = ceremonyStep(phase, payStage, preview);
  const paid = phase === 'done' && !preview && !simulated;
  const explorer = result?.explorerUrl
    || (typeof result?.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(result.txHash)
      ? `https://explorer.testnet.xrplevm.org/tx/${result.txHash}`
      : '');

  return (
    <div className="approval ceremony-body">
      {paid ? (
        <div className="ceremony-success" role="status">
          <span className="spring-check" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="64" height="64">
              <circle cx="32" cy="32" r="30" fill="#E3F2EA" />
              <path d="M18 33.5 27.5 43 46 22" fill="none" stroke="#0F5C3D" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="ceremony-signed">Signed by Ledger · Settled on XRPL</p>
          <p className="ceremony-paid">{amountText}</p>
          {explorer ? <a className="btn explorer" href={explorer} target="_blank" rel="noreferrer noopener">Explorer</a> : null}
        </div>
      ) : (
        <>
          <DeviceScreen amount={amountText} merchant={merchantName} expiry={expiryText} />
          <ol className="ceremony-steps" aria-label="Approval progress">
            {CEREMONY_STEPS.map((label, index) => (
              <li key={label} className={index < step ? 'is-done' : index === step ? 'is-now' : ''}>{label}</li>
            ))}
          </ol>
          {step < 2 ? <p className="device-status" role="status">Waiting for your Ledger…</p> : null}
          {phase === 'paying' ? <p className="device-status" role="status">{status}</p> : null}
          {simulated && !preview ? (
            <p className="sim-banner" role="status">simulated Ledger signature. This is not a Ledger device.</p>
          ) : null}
          {phase === 'done' && simulated ? (
            <p className="note" role="status">simulated Ledger signature. Nothing was broadcast.</p>
          ) : null}
          {error ? (
            <div className="state-error" role="alert">
              <p className="state-error-title">{preview ? 'Preview only' : 'The Ledger did not finish'}</p>
              <p>{error}</p>
            </div>
          ) : null}
          {phase === 'ready' || phase === 'error' || preview ? (
            <button
              type="button"
              className="btn primary ceremony-approve"
              disabled={!canApprove || phase === 'loading' || phase === 'device' || phase === 'paying'}
              onClick={approve}
            >
              {approveLabel}
            </button>
          ) : null}
        </>
      )}
      <details className="device-more">
        <summary>Technical details</summary>
        <p>Chain 1449000 has no registered clear-signing descriptor. The device may show raw fields, or it may ask for blind signing.</p>
        {preview || !challenge ? <p>No device is connected for this preview.</p> : null}
        {!preview && simulated && challenge ? <p>Backup demo key <code>{challenge.approverAddress}</code>. Not a hardware account.</p> : null}
        {!preview && !simulated && challenge ? (
          <p>Account {challenge.derivationPath}. Registered approver <code>{challenge.approverAddress}</code>.</p>
        ) : null}
      </details>
    </div>
  );
}

const CEREMONY_STEPS = ['Connect', 'Review on device', 'Signed', 'Paid on XRPL'];

function ceremonyStep(phase, payStage, preview) {
  if (phase === 'done') return 3;
  if (phase === 'paying') return payStage === 'settling' || payStage === 'paid' ? 3 : 2;
  if (phase === 'device' || preview) return 1;
  return 0;
}

function DeviceScreen({ amount, merchant, expiry }) {
  const label = `Approve purchase. ${amount}. ${merchant}.${expiry ? ` Expires ${expiry}.` : ''}`;
  return (
    <svg className="device-svg" viewBox="0 0 300 130" role="img" aria-label={label}>
      <rect x="1" y="1" width="298" height="128" rx="14" fill="#000000" stroke="#3A3A3A" strokeWidth="2" />
      <text x="150" y="42" textAnchor="middle" fill="#F7F4EC" fontSize="15" fontFamily="Inter, sans-serif">Approve purchase</text>
      <text x="150" y="68" textAnchor="middle" fill="#F7F4EC" fontSize="16" fontWeight="600" fontFamily="Inter, sans-serif">{amount} · {merchant}</text>
      {expiry ? <text x="150" y="94" textAnchor="middle" fill="#C9C2B4" fontSize="13" fontFamily="Inter, sans-serif">Expires {expiry}</text> : null}
    </svg>
  );
}
