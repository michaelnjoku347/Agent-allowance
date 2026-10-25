import { IconLock, IconUnlock } from './icons.jsx';

/** The reason a purchase waits, the numbers, and what a signature would do. */
export default function ApprovalWhy({ why, headingLevel = 3, compact = false }) {
  const Heading = `h${headingLevel}`;
  return (
    <section className={compact ? 'why is-compact' : 'why'} aria-label="Why this needs you">
      <p className="why-kicker">Why this needs you</p>
      <Heading className="why-rule">
        <span className={why.canApprove ? 'why-icon is-soft' : 'why-icon'} aria-hidden="true">
          {why.canApprove ? <IconUnlock size={16} /> : <IconLock size={16} />}
        </span>
        {why.rule}
      </Heading>
      <p className="why-summary">{why.summary}</p>
      <dl className="why-facts">
        {why.facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {!compact && why.signs ? (
        <div className="why-signs">
          <p><strong>What you sign.</strong> {why.signs}</p>
          <p><strong>Then.</strong> {why.after}</p>
        </div>
      ) : null}
      {!compact && !why.signs ? <p className="why-after">{why.after}</p> : null}
    </section>
  );
}
