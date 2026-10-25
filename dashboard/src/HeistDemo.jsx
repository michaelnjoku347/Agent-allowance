import { useState } from 'react';
import { runHeist } from './api.js';
import { HEIST_INJECTION } from '../../shared/catalog.js';
import { plainReason } from '../../shared/words.js';
import AttackCard from './AttackCard.jsx';

export function scriptedHeistReport() {
  return {
    ok: true,
    paid: false,
    signed: false,
    lost: '0',
    moved: '0.00',
    scripted: true,
    injection: HEIST_INJECTION,
    rule: 'merchant not allowed',
    ruleText: plainReason('merchant not allowed'),
    quoteLoaded: false,
    spoken: 'Scripted preview. The server did not answer. Attack blocked. 0.00 RLUSD moved.',
    planner: {
      source: 'fallback',
      live: false,
      tookBait: true,
      resourceId: 'premium-pack',
      reason: 'Scripted preview. The server did not answer, so this is not a live model.',
    },
  };
}

function plannerLabel(planner) {
  if (planner?.live && planner.source === 'bedrock') return 'Amazon Bedrock';
  return 'Fallback (Bedrock not configured)';
}

function HeistCard({ report }) {
  const planner = report.planner;
  const choice = planner?.tookBait
    ? `chose ${planner.resourceId || 'the premium pack'}`
    : 'did not choose the premium pack';
  return (
    <AttackCard
      title="A prompt tried to raise the cap"
      scripted={Boolean(report.scripted)}
      rows={[{
        id: 'heist',
        request: `${plannerLabel(planner)} ${choice}. ${report.injection}`,
        rule: report.ruleText,
      }]}
    />
  );
}

function HeistError({ message, onRetry }) {
  return (
    <div className="state-error" role="alert">
      <p className="state-error-title">Could not show the blocked prompt</p>
      <p>{message}</p>
      <button type="button" className="btn" onClick={onRetry}>Retry</button>
    </div>
  );
}

export default function HeistDemo({ onDone, onResult, children }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const body = await runHeist();
      if (!body?.ok || body.paid || body.signed || body.lost !== '0' || body.moved !== '0.00') {
        const failure = new Error('The blocked prompt did not stay blocked.');
        failure.live = true;
        throw failure;
      }
      setReport(body);
      onResult?.(body);
      onDone?.();
    } catch (err) {
      if (err.live) {
        setError(err.message || 'The blocked prompt did not stay blocked.');
      } else {
        const scripted = scriptedHeistReport();
        setReport(scripted);
        onResult?.(scripted);
      }
    } finally {
      setBusy(false);
    }
  }

  const planner = report?.planner;
  const choice = planner?.tookBait
    ? `chose ${planner.resourceId || 'the premium pack'}`
    : 'did not choose the premium pack';
  const live = report
    ? `${report.scripted ? 'Scripted preview. ' : ''}Attack blocked. ${report.injection}. The planner ${choice}. ${report.ruleText}. 0.00 RLUSD moved.`
    : '';

  const stage = (
    <>
      {error ? <HeistError message={error} onRetry={run} /> : null}
      {report ? <HeistCard report={report} /> : null}
    </>
  );

  if (typeof children === 'function') return children({ trigger: null, stage, run, busy, live });

  return (
    <section className="heist" aria-labelledby="heist-title">
      <h2 id="heist-title">Blocked prompt</h2>
      <button type="button" className="btn" onClick={run} disabled={busy}>
        {busy ? 'Showing the blocked prompt…' : 'Show a blocked prompt'}
      </button>
      {stage}
    </section>
  );
}
