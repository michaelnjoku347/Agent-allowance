/** One dark card for a blocked demo. Rows arrive 300ms apart. */
export default function AttackCard({ title, rows, scripted = false, lost = '0.00' }) {
  return (
    <article className="attack-card" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {rows.map((row, index) => (
          <li key={row.id} style={{ animationDelay: `${index * 300}ms` }}>
            <p className="attack-request">{row.request}</p>
            <p className="blocked-stamp">Blocked</p>
            <p className="attack-rule">{row.rule}</p>
          </li>
        ))}
      </ul>
      {scripted ? <p className="attack-note">Scripted preview. Nothing was signed.</p> : null}
      <p className="attack-lost">{lost} RLUSD lost</p>
    </article>
  );
}
