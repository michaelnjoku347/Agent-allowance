import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { approvePurchase, declinePurchase, fetchSnapshot, runAgent } from './api.js';
import CountUp from './CountUp.jsx';
import EvePanel from './EvePanel.jsx';
import JevCard from './JevCard.jsx';
import { money, shortAddress, when } from './format.js';
import { useTheme } from './theme.js';
import { plainReason } from '../../shared/words.js';

const TABS = [
  ['home', 'Home'],
  ['activity', 'Activity'],
  ['eve', 'Eve'],
];

const FILTERS = [
  ['all', 'All'],
  ['paid', 'Paid'],
  ['blocked', 'Blocked'],
  ['waiting', 'Waiting'],
];

function expiresOn(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function pill(item) {
  if (item.status === 'paid') return { label: 'Paid', tone: 'ok' };
  if (item.status === 'approved') return { label: 'Waiting', tone: 'warn' };
  if (item.status === 'declined' || item.status === 'pending') return { label: 'Blocked', tone: 'danger' };
  return { label: item.status || 'Waiting', tone: 'warn' };
}

function matchesFilter(item, filter) {
  if (filter === 'paid') return item.status === 'paid';
  if (filter === 'waiting') return item.status === 'approved';
  if (filter === 'blocked') return item.status === 'pending' || item.status === 'declined';
  return true;
}

function ruleRows(item) {
  const rows = [
    ['amount must be positive', 'Amount is positive'],
    ['expired', 'Allowance has not expired'],
    ['merchant not allowed', 'Merchant is allowed'],
    ['over per-purchase cap', 'Within the per-purchase cap'],
    ['over budget', 'Within the budget'],
  ];
  if (item.reason === 'over channel cap') rows.push(['over channel cap', 'Channel can cover this payment']);
  if (item.jev || item.reason === 'Jev flagged for review') rows.push(['Jev flagged for review', 'Jev did not ask for a review']);
  const settled = item.status === 'paid' || item.status === 'approved';
  const fail = settled ? -1 : rows.findIndex(([reason]) => reason === item.reason);
  return rows.map(([reason, label], index) => {
    let state = 'pass';
    if (fail !== -1 && index === fail) state = 'fail';
    else if (fail !== -1 && index > fail) state = 'skip';
    const text = state === 'pass' ? 'Pass' : state === 'fail' ? 'Fail' : 'Not checked';
    return { reason, label, state, text };
  });
}

function realRows(snapshot) {
  const payments = (snapshot?.payments ?? []).filter((item) => !item.sample);
  const pending = (snapshot?.pending ?? [])
    .filter((item) => !item.sample)
    .map((item) => ({ ...item, status: item.status || 'pending' }));
  const budget = Number(snapshot?.rules?.budget ?? snapshot?.budget ?? 0);
  const spent = payments
    .filter((item) => item.status === 'paid')
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const activity = [...payments, ...pending].sort((a, b) => (
    Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
  ));
  return { payments, pending, budget, spent, activity };
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [tab, setTab] = useState('home');
  const [eveOpen, setEveOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState('loading');
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [runNote, setRunNote] = useState('');
  const [announce, setAnnounce] = useState('');
  const seen = useRef(null);

  async function load() {
    try {
      const next = await fetchSnapshot();
      setSnapshot(next);
      setConnection('online');
    } catch {
      setConnection('error');
    }
  }

  useEffect(() => {
    let stop = false;
    const tick = () => {
      if (!stop) load();
    };
    tick();
    const timer = window.setInterval(tick, 3000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const view = useMemo(() => realRows(snapshot), [snapshot]);

  useEffect(() => {
    const ids = view.activity.map((item) => item.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = view.activity.filter((item) => !seen.current.has(item.id));
    for (const id of ids) seen.current.add(id);
    if (!added.length) return;
    const newest = added[0];
    const status = pill(newest).label;
    setAnnounce(`${status}. ${newest.task || 'Purchase'} for ${money(newest.amount)} RLUSD.`);
  }, [view.activity]);

  async function decide(id, kind) {
    setBusyId(id);
    setActionError('');
    try {
      if (kind === 'approve') await approvePurchase(id);
      else await declinePurchase(id);
      await load();
    } catch (error) {
      setActionError(error.message || 'That did not save.');
    } finally {
      setBusyId('');
    }
  }

  async function onRun() {
    setRunNote('');
    try {
      const body = await runAgent('Buy the morning market brief');
      setRunNote(body.ok ? 'Agent started.' : (body.error || 'Add the wallet in .env to pay a merchant.'));
    } catch (error) {
      setRunNote(error.message || 'Could not start the agent.');
    }
  }

  const shown = view.activity.filter((item) => matchesFilter(item, filter));
  const latest = view.activity.slice(0, 5);
  const ratio = view.budget > 0 ? Math.max(0, Math.min(1, view.spent / view.budget)) : 0;
  const left = Math.max(0, view.budget - view.spent);
  const merchantCount = snapshot?.rules?.allowedMerchants?.length ?? 0;

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <div className="sr-only" aria-live="polite">{announce}</div>
      <div className="shell">
        <header className="top">
          <p className="kicker">Mastercard × XRPL Hackathon</p>
          <div className="top-row">
            <h1>Agent Allowance</h1>
            <fieldset className="theme">
              <legend className="sr-only">Color theme</legend>
              {['light', 'dark', 'system'].map((choice) => (
                <label key={choice} className={theme === choice ? 'is-on' : ''}>
                  <input
                    type="radio"
                    name="theme"
                    value={choice}
                    checked={theme === choice}
                    onChange={() => setTheme(choice)}
                  />
                  {choice[0].toUpperCase() + choice.slice(1)}
                </label>
              ))}
            </fieldset>
          </div>
          <p className="lede">Every quote is checked before a voucher is signed.</p>
        </header>

        <main id="main" tabIndex={-1}>
          {connection === 'loading' && !snapshot ? <Skeletons /> : null}
          {connection === 'error' && !snapshot ? (
            <div className="card empty" role="alert">
              <h2>The allowance server is not responding</h2>
              <p>Start it with npm run server, then try again.</p>
              <button type="button" className="btn primary" onClick={load}>Retry</button>
            </div>
          ) : null}
          {snapshot && tab === 'home' ? (
            <div className="stack">
              {connection === 'error' ? (
                <p className="note warn" role="alert">
                  Could not refresh. Showing the last numbers.
                  <button type="button" className="btn" onClick={load}>Retry</button>
                </p>
              ) : null}
              <section className="card allowance" aria-labelledby="allowance-title">
                <h2 id="allowance-title">RLUSD left</h2>
                <p className="figure"><CountUp value={left} /> <span>RLUSD</span></p>
                <div
                  className="meter"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(ratio * 100)}
                  aria-label={`${money(view.spent)} of ${money(view.budget)} RLUSD spent`}
                >
                  <span style={{ width: `${ratio * 100}%` }} />
                </div>
                <p className="meter-caption">{money(view.spent)} of {money(view.budget)} RLUSD spent</p>
                <ul className="chips" aria-label="Allowance rules">
                  <li>{snapshot.rules.maxPerPurchase} per purchase cap</li>
                  <li>expires {expiresOn(snapshot.rules.expiresAt)}</li>
                  <li>{merchantCount} merchant{merchantCount === 1 ? '' : 's'} allowed</li>
                </ul>
              </section>

              <section className="card" aria-labelledby="needs-title">
                <div className="section-head">
                  <h2 id="needs-title">Needs you</h2>
                  <p>Approving records the decision. It does not sign a voucher or move RLUSD.</p>
                </div>
                {view.pending.length === 0 ? (
                  <p className="empty-copy">Nothing needs you. A quote outside the rules shows up here.</p>
                ) : (
                  <ul className="needs">
                    {view.pending.map((item) => (
                      <li key={item.id} className="need">
                        <div className="need-top">
                          <h3>{item.merchantLabel || 'Merchant'}</h3>
                          <p className="amount">{money(item.amount)} RLUSD</p>
                        </div>
                        <p>{plainReason(item.reason)}</p>
                        <p className="meta"><code>{shortAddress(item.merchant)}</code> · {when(item.createdAt)}</p>
                        <JevCard jev={item.jev} />
                        <div className="pair">
                          <button type="button" className="btn primary" disabled={busyId === item.id} onClick={() => decide(item.id, 'approve')}>
                            {busyId === item.id ? 'Saving…' : 'Approve'}
                          </button>
                          <button type="button" className="btn" disabled={busyId === item.id} onClick={() => decide(item.id, 'decline')}>
                            Decline
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {actionError ? <p className="note warn" role="alert">{actionError}</p> : null}
              </section>

              <section className="card" aria-labelledby="latest-title">
                <h2 id="latest-title">Latest activity</h2>
                <ActivityList items={latest} onOpen={setDetail} empty="Run the agent to record a purchase. Paid and blocked quotes will show up here." />
              </section>

              <div className="run">
                <button type="button" className="btn primary wide" onClick={onRun}>Run agent</button>
                {runNote ? <p className="note" role="status">{runNote}</p> : null}
              </div>
            </div>
          ) : null}

          {snapshot && tab === 'activity' ? (
            <section className="card" aria-labelledby="activity-title">
              <h2 id="activity-title">Activity</h2>
              <div className="filters" role="toolbar" aria-label="Filter activity">
                {FILTERS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={filter === id ? 'chip is-on' : 'chip'}
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ActivityList
                items={shown}
                onOpen={setDetail}
                empty={filter === 'all'
                  ? 'No purchases yet. Run the agent, or ask Eve what to do next.'
                  : `Nothing is ${filter} right now.`}
              />
            </section>
          ) : null}

          {tab === 'eve' ? <EvePanel active /> : null}
        </main>
      </div>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'is-on' : ''}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <button type="button" className="fab" aria-label="Open Eve" onClick={() => setEveOpen(true)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.1A5 5 0 0 0 17 11z" />
        </svg>
      </button>

      {eveOpen ? (
        <Sheet title="Eve" onClose={() => setEveOpen(false)}>
          <EvePanel active />
        </Sheet>
      ) : null}
      {detail ? (
        <Sheet title={detail.task || 'Purchase'} onClose={() => setDetail(null)}>
          <Detail item={detail} currency={snapshot?.currency || 'RLUSD'} />
        </Sheet>
      ) : null}
    </div>
  );
}

function ActivityList({ items, onOpen, empty }) {
  if (!items.length) return <p className="empty-copy">{empty}</p>;
  return (
    <ul className="activity">
      {items.map((item) => {
        const status = pill(item);
        return (
          <li key={item.id}>
            <button type="button" className="row" onClick={() => onOpen(item)}>
              <span className={`pill ${status.tone}`}>{status.label}</span>
              <span className="row-main">
                <span className="row-title">{item.merchantLabel || 'Merchant'}</span>
                <span className="meta">{item.task || 'Purchase'} · {when(item.createdAt)}</span>
              </span>
              <span className="amount">{money(item.amount)} RLUSD</span>
            </button>
            {item.explorerUrl ? (
              <a className="explorer" href={item.explorerUrl} target="_blank" rel="noreferrer noopener">
                View on explorer
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Detail({ item, currency }) {
  const status = pill(item);
  const name = item.merchantLabel || 'Merchant';
  return (
    <div className="detail">
      <p className={`pill ${status.tone}`}>{status.label}</p>
      <p className="figure">{money(item.amount)} <span>{currency}</span></p>
      <p>{name}</p>
      <p className="meta"><code>{item.merchant}</code></p>
      <p className="meta">{when(item.createdAt)}</p>
      {item.reason ? <p>{plainReason(item.reason)}</p> : null}
      <h3>Rule checks</h3>
      <ul className="checks">
        {ruleRows(item).map((row) => (
          <li key={row.label} className={row.state}>
            <span aria-hidden="true">{row.state === 'pass' ? '✓' : row.state === 'fail' ? '✗' : '–'}</span>
            <span>{row.text}</span>
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
      <JevCard jev={item.jev} />
      <dl className="facts">
        <div>
          <dt>Transaction</dt>
          <dd>{item.txHash ? <code>{item.txHash}</code> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Claim ID</dt>
          <dd>{item.claimId ? <code>{item.claimId}</code> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Receipt</dt>
          <dd>{item.receiptUrl ? <a href={item.receiptUrl} target="_blank" rel="noreferrer noopener">View receipt</a> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Explorer</dt>
          <dd>{item.explorerUrl ? <a href={item.explorerUrl} target="_blank" rel="noreferrer noopener">View on explorer</a> : 'Not recorded'}</dd>
        </div>
      </dl>
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  const titleId = useId();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const root = ref.current;
    const previous = document.activeElement;
    const focusable = () => [...root.querySelectorAll('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.disabled);
    focusable()[0]?.focus();
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div className="sheet-back" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
      >
        <div className="sheet-top">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Skeletons() {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading the allowance</p>
      <div className="card skeleton" />
      <div className="card skeleton short" />
      <div className="card skeleton" />
    </div>
  );
}
