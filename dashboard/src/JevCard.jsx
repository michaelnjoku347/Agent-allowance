import { jevSourceLabel, plainReason } from '../../shared/words.js';

function percent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

/** Risk scores are 0–4. The card shows them as 1–5. */
export function riskDisplay(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.max(1, Math.min(5, Math.round(score) + 1));
}

export default function JevCard({ jev, merchant = '' }) {
  if (!jev || jev.source !== 'jev') {
    return <p className="jev-line">Rules decided. Jev not consulted.</p>;
  }
  const source = jevSourceLabel(jev?.source);
  const needed = percent(jev?.needed);
  const review = percent(jev?.review);
  const risk = riskDisplay(jev?.risk);
  const summary = jev?.reason
    ? plainReason(jev.reason)
    : 'No Jev decision was recorded for this purchase.';
  return (
    <section className="jev" aria-label={merchant ? `Jev decision for ${merchant}` : 'Jev decision'}>
      <header className="jev-head">
        <h3>Jev decision</h3>
        <p className="source">{source}</p>
      </header>
      <JevRow label="Needed" text={needed === null ? '—' : `${needed}%`} width={needed} />
      <JevRow label="Risk" text={risk === null ? '—' : `${risk}/5`} width={risk === null ? null : (risk / 5) * 100} />
      <JevRow label="Human review" text={review === null ? '—' : `${review}%`} width={review} />
      <p className="jev-summary">{summary}</p>
    </section>
  );
}

function JevRow({ label, text, width }) {
  return (
    <div className="jev-row">
      <div className="jev-label">
        <span>{label}</span>
        <span>{text}</span>
      </div>
      <div className="bar" aria-hidden="true">
        <span style={{ width: `${width ?? 0}%` }} />
      </div>
    </div>
  );
}
