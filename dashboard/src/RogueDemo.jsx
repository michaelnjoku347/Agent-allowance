import { useEffect, useMemo, useRef, useState } from 'react';
import { runRogueDemo } from './api.js';
import { rogueFrames, scriptedRogueReport } from './rogue.js';

const BEAT_MS = 900;

function reduceMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function RogueDemo({ onDone, onBeat }) {
  const [report, setReport] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(0);

  const frames = useMemo(() => (report ? rogueFrames(report.attempts) : []), [report]);
  const frame = frames[cursor] ?? null;

  useEffect(() => () => window.clearInterval(timer.current), []);

  useEffect(() => {
    if (!frame || !report) return;
    if (frame.summary) onBeat?.({ id: 'summary', phase: 'summary', attempt: report.summary?.line || '' });
    else onBeat?.(frame.shown.at(-1));
  }, [cursor, frame, onBeat, report]);

  async function run() {
    window.clearInterval(timer.current);
    setBusy(true);
    setError('');
    setReport(null);
    setCursor(0);
    try {
      const body = await runRogueDemo();
      if (!body?.ok || body.paid || body.signed || body.summary?.lost !== '0') {
        const failure = new Error('The rogue demo did not stay blocked.');
        failure.live = true;
        throw failure;
      }
      const next = rogueFrames(body.attempts);
      setReport(body);
      if (reduceMotion() || next.length <= 1) {
        setCursor(Math.max(0, next.length - 1));
      } else {
        setCursor(0);
        let step = 0;
        timer.current = window.setInterval(() => {
          step += 1;
          if (step >= next.length - 1) window.clearInterval(timer.current);
          setCursor(Math.min(step, next.length - 1));
        }, BEAT_MS);
      }
      onDone?.();
    } catch (err) {
      if (err.live) {
        setError(err.message || 'The rogue demo did not stay blocked.');
      } else {
        const scripted = scriptedRogueReport();
        const next = rogueFrames(scripted.attempts);
        setReport(scripted);
        setCursor(Math.max(0, next.length - 1));
      }
    } finally {
      setBusy(false);
    }
  }

  const live = !frame
    ? ''
    : frame.summary
      ? report.summary.line
      : frame.phase === 'attempt'
        ? frame.shown.at(-1)?.attempt
        : frame.phase === 'rule'
          ? frame.shown.at(-1)?.ruleText
          : `Blocked. ${frame.shown.at(-1)?.note || ''}`.trim();

  return (
    <section className="card rogue" aria-labelledby="rogue-title">
      <div className="section-head">
        <h2 id="rogue-title">Three blocks</h2>
        <p>Three tries to spend outside the allowance. Nothing is signed.</p>
      </div>
      <button type="button" className="btn" onClick={run} disabled={busy}>
        <span>{busy ? 'Running the three blocks…' : 'Run the three blocks'}</span>
      </button>
      <p className="visually-hidden" aria-live="polite">{live}</p>
      {error ? (
        <div className="state-error" role="alert">
          <p className="state-error-title">Could not run the three blocks</p>
          <p>{error}</p>
          <button type="button" className="btn" onClick={run}>Retry</button>
        </div>
      ) : null}
      {report?.scripted ? (
        <p className="heist-note">Scripted preview. The server did not answer. This is not a live rules run.</p>
      ) : null}
      {frame ? (
        <ol className="rogue-cards">
          {frame.shown.map((card) => (
            <li key={card.id} className={`rogue-card is-${card.phase}`}>
              <p className="rogue-kicker">{card.title}</p>
              <p className="rogue-attempt">{card.attempt}</p>
              {card.phase === 'rule' || card.phase === 'blocked' ? (
                <p className="rogue-rule" key={`${card.id}-rule`}>{card.ruleText}</p>
              ) : null}
              {card.phase === 'blocked' ? (
                <p className="rogue-stamp" key={`${card.id}-blocked`}>{card.outcome}</p>
              ) : null}
              {card.phase === 'blocked' && card.note ? <p className="rogue-note">{card.note}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {frame?.summary ? <p className="rogue-summary" role="status">{report.summary.line}</p> : null}
    </section>
  );
}
