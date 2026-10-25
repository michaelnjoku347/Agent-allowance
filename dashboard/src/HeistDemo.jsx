import { useState } from 'react';
import { runHeist } from './api.js';
import { IconAlert } from './icons.jsx';

function plannerLabel(planner) {
  if (planner?.live && planner.source === 'bedrock') return 'Amazon Bedrock';
  return 'Fallback (Bedrock not configured)';
}

export default function HeistDemo({ onDone, onResult }) {
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
        throw new Error('The heist did not stay blocked.');
      }
      setReport(body);
      onResult?.(body);
      onDone?.();
    } catch (err) {
      setError(err.message || 'The heist did not run.');
    } finally {
      setBusy(false);
    }
  }

  const planner = report?.planner;
  const choice = planner?.tookBait
    ? `chose ${planner.resourceId || 'the premium pack'}`
    : 'did not choose the premium pack';
  const live = report
    ? `Attack blocked. ${report.injection}. The planner ${choice}. ${report.ruleText}. 0.00 RLUSD moved.`
    : '';

  return (
    <section className="card heist" aria-labelledby="heist-title">
      <div className="section-head">
        <h2 id="heist-title">The Heist</h2>
        <p>A catalog row tries to talk the planner into a 50 RLUSD pack. The rules still decide. Nothing is signed.</p>
      </div>
      <button type="button" className="btn danger" onClick={run} disabled={busy}>
        <IconAlert />
        <span>{busy ? 'Running the heist…' : 'Run the heist'}</span>
      </button>
      <p className="visually-hidden" aria-live="polite">{live}</p>
      {error ? <p className="note warn" role="alert">{error}</p> : null}
      {report ? (
        <article className="rogue-card is-blocked" aria-label="Attack blocked">
          <p className="rogue-kicker">Attack blocked</p>
          <p className="heist-injection">Injected text: {report.injection}</p>
          <p className="rogue-attempt">
            {plannerLabel(planner)} {choice}.
            {planner?.live ? '' : ' This was not a live model.'}
          </p>
          {planner?.reason ? <p className="rogue-note">{planner.reason}</p> : null}
          <p className="rogue-rule">{report.ruleText}</p>
          {report.quoteLoaded ? null : (
            <p className="rogue-note">The merchant did not answer, so the catalog price was checked. This is not a live payment.</p>
          )}
          <p className="rogue-stamp">0.00 RLUSD moved</p>
        </article>
      ) : null}
    </section>
  );
}
