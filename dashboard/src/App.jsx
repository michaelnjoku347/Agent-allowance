import { useEffect, useState } from 'react';
import { fetchSnapshot, sampleSnapshot } from './api.js';
import { money, shortAddress, when } from './format.js';

const POLL_MS = 3000;

function bannerCopy(connection, agentConnected) {
  if (connection === 'loading') return 'Loading the allowance…';
  if (connection === 'offline') return 'Server offline. Showing sample data until it is back.';
  if (connection === 'stale') return 'Server not responding. Showing the last update.';
  if (agentConnected) return 'Live. Checking for new payments every 3 seconds.';
  return 'Sample data. These purchases are not on-chain. They clear when the agent runs.';
}

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState('loading');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [approveError, setApproveError] = useState(null);

  useEffect(() => {
    let stopped = false;
    let timer;

    async function tick() {
      try {
        const next = await fetchSnapshot();
        if (stopped) return;
        setSnapshot(next);
        setConnection('online');
        setUpdatedAt(new Date().toISOString());
      } catch {
        if (stopped) return;
        setConnection((current) => (current === 'online' || current === 'stale' ? 'stale' : 'offline'));
      } finally {
        if (!stopped) timer = setTimeout(tick, POLL_MS);
      }
    }

    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  async function approve(id) {
    setBusyId(id);
    setApproveError(null);
    try {
      const response = await fetch(`/api/approve/${id}`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Approval failed.');
      const next = await fetchSnapshot();
      setSnapshot(next);
      setConnection('online');
      setUpdatedAt(new Date().toISOString());
    } catch (error) {
      setApproveError({ id, message: error.message });
    } finally {
      setBusyId(null);
    }
  }

  const view = snapshot ?? sampleSnapshot;
  const showSample = connection === 'offline' || !view.agentConnected;
  const ratio = Math.max(0, Math.min(1, Number(view.spentRatio) || 0));
  const canApprove = connection === 'online' || connection === 'stale';

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="kicker">Mastercard × XRPL Hackathon</p>
          <h1>Agent Allowance</h1>
          <p className="lede">
            A spending account for an AI agent. Every quote is checked against the rules before a voucher is signed.
          </p>
        </div>
        <div className="topbar-meta">
          <p className="network">
            {view.network.name}
            <span>Chain ID {view.network.chainId}</span>
          </p>
          <p className={showSample ? 'tag' : 'tag tag-live'}>{showSample ? 'Sample' : 'Live'}</p>
        </div>
      </header>

      <p className="banner" role="status">
        {bannerCopy(connection, view.agentConnected)}
        {updatedAt && connection !== 'offline' ? <span> Updated {when(updatedAt)}.</span> : null}
      </p>

      <section className="layout">
        <article className="card budget">
          <div className="card-head">
            <h2>Budget</h2>
            <p>{view.currency} on {view.network.name}</p>
          </div>
          <div className="stats">
            <p>
              <span>Total</span>
              <strong>{money(view.budget)}</strong>
            </p>
            <p>
              <span>Spent</span>
              <strong>{money(view.spent)}</strong>
            </p>
            <p className="remain">
              <span>Remaining</span>
              <strong>{money(view.remaining)}</strong>
            </p>
          </div>
          <div
            className="bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Number(view.budget) || 0}
            aria-valuenow={Number(view.spent) || 0}
            aria-label="Budget spent"
          >
            <span className={ratio >= 1 ? 'is-full' : undefined} style={{ width: `${ratio * 100}%` }} />
          </div>
          <p className="bar-label">
            {money(view.spent)} of {money(view.budget)} {view.currency} spent
          </p>
        </article>

        <article className="card rules">
          <div className="card-head">
            <h2>Rules</h2>
            <p>{view.rules.summary}</p>
          </div>
          <dl>
            <div>
              <dt>Budget</dt>
              <dd>{money(view.rules.budget)} {view.currency}</dd>
            </div>
            <div>
              <dt>Per purchase</dt>
              <dd>{money(view.rules.maxPerPurchase)} {view.currency}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{when(view.rules.expiresAt)}</dd>
            </div>
          </dl>
          <h3>Allowed merchants</h3>
          {view.rules.allowedMerchants.length === 0 ? (
            <p className="muted">Add payout addresses to <code>agent/rules.json</code>.</p>
          ) : (
            <ul className="merchants">
              {view.rules.allowedMerchants.map((merchant) => (
                <li key={merchant.address}>
                  <span>{merchant.label || 'Merchant'}</span>
                  <code title={merchant.address}>{shortAddress(merchant.address)}</code>
                </li>
              ))}
            </ul>
          )}
          <ul className="checks">
            <li>An expired allowance needs approval.</li>
            <li>The merchant has to be on the list.</li>
            <li>Over {money(view.rules.maxPerPurchase)} {view.currency} in one purchase needs approval.</li>
            <li>Going past {money(view.rules.budget)} {view.currency} needs approval.</li>
          </ul>
        </article>
      </section>

      <section className="card table-card">
        <div className="card-head">
          <h2>Payments</h2>
          <p>Live payments link to the XRPL EVM Testnet explorer.</p>
        </div>
        {view.payments.length === 0 ? (
          <p className="empty">No payments yet. Run the agent on a quote inside the allowance.</p>
        ) : (
          <div className="table-wrap">
            <table className="pay-table">
              <caption className="sr-only">Agent payments</caption>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Task</th>
                  <th>Merchant</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Explorer</th>
                </tr>
              </thead>
              <tbody>
                {view.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="When">{when(payment.createdAt)}</td>
                    <td data-label="Task">
                      <span className="task">{payment.task}</span>
                      {payment.note ? <span className="sub">{payment.note}</span> : null}
                    </td>
                    <td data-label="Merchant">
                      <span className="task">{payment.merchantLabel || 'Merchant'}</span>
                      <code title={payment.merchant}>{shortAddress(payment.merchant)}</code>
                    </td>
                    <td data-label="Amount" className="num">{money(payment.amount)} {view.currency}</td>
                    <td data-label="Status">
                      <span className={`pill pill-${payment.status}`}>{payment.status}</span>
                    </td>
                    <td data-label="Explorer">
                      {payment.explorerUrl ? (
                        <a
                          href={payment.explorerUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {shortAddress(payment.txHash)}
                          <span className="sr-only"> on the XRPL EVM Testnet explorer</span>
                        </a>
                      ) : (
                        <span className="muted">{payment.sample ? 'Sample' : '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card approvals" id="approvals">
        <div className="card-head">
          <h2>Approval needed</h2>
          <p>
            The agent refused to pay. Approve records a placeholder for a Ledger check.
            No voucher is signed and no RLUSD moves.
          </p>
        </div>
        {view.pending.length === 0 ? (
          <p className="empty">Nothing is waiting. A quote that breaks the rules shows up here.</p>
        ) : (
          <ul className="queue">
            {view.pending.map((item) => (
              <li key={item.id}>
                <div className="queue-top">
                  <span className="pill pill-pending">{item.reason}</span>
                  <strong>{money(item.amount)} {view.currency}</strong>
                </div>
                <h3>{item.task}</h3>
                <p className="merchant-line">
                  {item.merchantLabel || 'Merchant'}
                  <code title={item.merchant}>{shortAddress(item.merchant)}</code>
                </p>
                {item.description ? <p className="sub">{item.description}</p> : null}
                <p className="sub">{when(item.createdAt)}</p>
                <button
                  type="button"
                  onClick={() => approve(item.id)}
                  disabled={!canApprove || busyId === item.id}
                >
                  {busyId === item.id ? 'Approving…' : 'Approve'}
                </button>
                {approveError?.id === item.id ? <p className="form-error">{approveError.message}</p> : null}
                {connection === 'offline' ? <p className="sub">Start the server to record an approval.</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer>
        <p>
          {view.network.name} · chain ID {view.network.chainId} · {view.currency} uses 18 decimals · hackathon testnet only
        </p>
      </footer>
    </div>
  );
}
