import { useState } from 'react';
import { runHeist } from './api.js';
import { HEIST_INJECTION } from '../../shared/catalog.js';
import { plainReason } from '../../shared/words.js';

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
    <article className="heist-card" aria-label="Attack blocked">
      <p className="heist-outcome">Blocked</p>
      <p className="heist-attempt">
        {plannerLabel(planner)} {choice}.
      </p>
      <p className="heist-injection">Injected text: {report.injection}</p>
      <p className="heist-rule">{report.ruleText}</p>
      {report.scripted ? (
        <p className="heist-note">Scripted preview. The server did not answer. This is not a live model, and nothing was signed.</p>
      ) : (
        <p className="heist-note">
          {planner?.live ? 'The planner ran.' : 'This was not a live model.'}
          {planner?.reason ? ` ${planner.reason}` : ''}
        </p>
      )}
      {report.quoteLoaded ? null : (
        <p className="heist-note">The merchant did not answer, so the catalog price was checked. This is not a live payment.</p>
      )}
      <p className="heist-summary">0.00 RLUSD moved</p>
    </article>
  );
}

function HeistError({ message, onRetry }) {
  return (
    <div className="state-error" role="alert">
      <p className="state-error-title">Could not run the heist</p>
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
        const failure = new Error('The heist did not stay blocked.');
        failure.live = true;
        throw failure;
      }
      setReport(body);
      onResult?.(body);
      onDone?.();
    } catch (err) {
      if (err.live) {
        setError(err.message || 'The heist did not stay blocked.');
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

  const trigger = (
    <button type="button" className="btn heist-trigger" onClick={run} disabled={busy}>
      <span>{busy ? 'Running the heist…' : 'Run the heist'}</span>
    </button>
  );
  const stage = (
    <>
      <p className="visually-hidden" aria-live="polite">{live}</p>
      {error ? <HeistError message={error} onRetry={run} /> : null}
      {report ? <HeistCard report={report} /> : null}
    </>
  );

  if (typeof children === 'function') return children({ trigger, stage });

  return (
    <section className="heist" aria-labelledby="heist-title">
      <h2 id="heist-title">The Heist</h2>
      {trigger}
      {stage}
    </section>
  );
}
