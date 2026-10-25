import { useEffect, useRef, useState } from 'react';
import { runRogueDemo } from './api.js';
import { scriptedRogueReport } from './rogue.js';
import AttackCard from './AttackCard.jsx';

const ROW_MS = 300;

function reduceMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function RogueDemo({ onDone, onBeat, children }) {
  const [report, setReport] = useState(null);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(0);

  useEffect(() => () => window.clearInterval(timer.current), []);

  useEffect(() => {
    if (!report) return undefined;
    const last = report.attempts?.[shown - 1];
    if (last) onBeat?.(last);
    if (shown >= (report.attempts?.length || 0)) onBeat?.({ id: 'summary', phase: 'summary', attempt: report.summary?.line || '' });
    return undefined;
  }, [shown, onBeat, report]);

  function play(body) {
    const count = body.attempts?.length || 0;
    setReport(body);
    if (reduceMotion()) {
      setShown(count);
      return;
    }
    setShown(1);
    let step = 1;
    timer.current = window.setInterval(() => {
      step += 1;
      setShown(Math.min(step, count));
      if (step >= count) window.clearInterval(timer.current);
    }, ROW_MS);
  }

  async function run() {
    window.clearInterval(timer.current);
    setBusy(true);
    setError('');
    setReport(null);
    setShown(0);
    try {
      const body = await runRogueDemo();
      if (!body?.ok || body.paid || body.signed || body.summary?.lost !== '0') {
        const failure = new Error('The rogue demo did not stay blocked.');
        failure.live = true;
        throw failure;
      }
      play(body);
      onDone?.();
    } catch (err) {
      if (err.live) {
        setError(err.message || 'The rogue demo did not stay blocked.');
      } else {
        play(scriptedRogueReport());
      }
    } finally {
      setBusy(false);
    }
  }

  const rows = (report?.attempts || []).slice(0, shown).map((card) => ({
    id: card.id,
    request: card.attempt,
    rule: card.ruleText,
  }));
  const live = report && shown >= (report.attempts?.length || 0)
    ? report.summary?.line || '3 attempts, 3 blocked, 0 RLUSD lost'
    : '';
  const stage = (
    <>
      {error ? (
        <div className="state-error" role="alert">
          <p className="state-error-title">Could not run the three blocks</p>
          <p>{error}</p>
          <button type="button" className="btn" onClick={run}>Retry</button>
        </div>
      ) : null}
      {rows.length ? (
        <AttackCard
          title="Rogue agent tried 3 payments"
          rows={rows}
          scripted={Boolean(report?.scripted)}
          lost="0.00"
        />
      ) : null}
    </>
  );

  if (typeof children === 'function') return children({ stage, run, busy, live });

  return (
    <section className="card rogue" aria-labelledby="rogue-title">
      <h2 id="rogue-title">Three blocks</h2>
      <button type="button" className="btn" onClick={run} disabled={busy}>
        {busy ? 'Running the three blocks…' : 'Run the three blocks'}
      </button>
      {stage}
    </section>
  );
}
