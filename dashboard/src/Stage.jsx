import { money } from './format.js';

const STATE_WORD = {
  off: 'not reached',
  on: 'reached',
  wait: 'waiting',
  stop: 'stopped here',
};

export function MoneyFlow({ flow }) {
  const steps = flow?.steps ?? [];
  return (
    <section className="card flow" aria-labelledby="flow-title">
      <h2 id="flow-title" className="eyebrow">Payment path</h2>
      <ol className="flow-track">
        {steps.map((step, index) => {
          const previous = steps[index - 1];
          const lineOn = previous?.state === 'on';
          return (
            <li key={step.id} className="flow-item">
              {index > 0 ? <span className={lineOn ? 'flow-line is-on' : 'flow-line'} aria-hidden="true" /> : null}
              <span className={`flow-step is-${step.state}`} aria-label={`${step.label}, ${STATE_WORD[step.state] || step.state}`}>
                <span className="flow-dot" />
                <span className="flow-label">{step.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {flow?.caption ? <p className="flow-caption">{flow.caption}</p> : null}
    </section>
  );
}

export function TxFeed({ rows }) {
  return (
    <section className="card tx-feed" aria-labelledby="tx-title">
      <h2 id="tx-title">On XRPL</h2>
      {rows?.length ? (
        <ul className="tx-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="tx-name">{row.label}</span>
              <span className="amount">{row.amount ? `${money(row.amount)} RLUSD` : ''}</span>
              <a href={row.href} target="_blank" rel="noreferrer noopener">View on explorer</a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">Explorer links appear when a transaction hash is recorded.</p>
      )}
    </section>
  );
}
