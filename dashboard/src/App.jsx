import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { allowanceView } from './allowance.js';
import { approvePurchase, declinePurchase, fetchSnapshot, runAgent, runOverCap } from './api.js';
import BedrockMark from './BedrockMark.jsx';
import CountUp from './CountUp.jsx';
import { EveDock } from './EvePanel.jsx';
import {
  IconActivity,
  IconAlert,
  IconCheck,
  IconHome,
  IconReceipt,
  IconSettings,
  LogoMark,
} from './icons.jsx';
import JevCard from './JevCard.jsx';
import { money, shortAddress, when } from './format.js';
import { useTheme } from './theme.js';
import { plainReason } from '../../shared/words.js';

const TABS = [
  ['home', 'Home', IconHome],
  ['activity', 'Activity', IconActivity],
];

const EXPLORER = 'https://explorer.testnet.xrplevm.org';

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

function initial(label) {
  const text = (label || 'M').trim();
  return text.slice(0, 1).toUpperCase();
}

function txUrl(explorer, hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) return null;
  return `${String(explorer || EXPLORER).replace(/\/$/, '')}/tx/${hash}`;
}

function receiptHref(url) {
  return /^https?:\/\//i.test(url || '') ? url : null;
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [tab, setTab] = useState('home');
  const [eveSeed, setEveSeed] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState('loading');
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [runNote, setRunNote] = useState('');
  const [overCap, setOverCap] = useState(null);
  const [overCapBusy, setOverCapBusy] = useState(false);
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

  const view = useMemo(() => allowanceView(snapshot), [snapshot]);

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

  async function onOverCap() {
    setOverCapBusy(true);
    setOverCap(null);
    try {
      const body = await runOverCap();
      setOverCap(body);
      await load();
    } catch (error) {
      setOverCap({ error: error.message || 'The over-cap demo did not run.' });
    } finally {
      setOverCapBusy(false);
    }
  }

  function askEvePrompt(text) {
    setEveSeed({ id: `${Date.now()}-${text}`, text });
  }

  const shown = view.activity.filter((item) => matchesFilter(item, filter));
  const latest = view.activity.slice(0, 5);
  const merchantCount = snapshot?.rules?.allowedMerchants?.length ?? 0;
  const balanceLabel = `${money(view.spent)} of ${money(view.budget)} RLUSD spent. ${money(view.left)} RLUSD left.`;

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <div className="sr-only" aria-live="polite">{announce}</div>
      <aside className="sidenav">
        <div className="sidenav-brand" aria-hidden="true">
          <LogoMark size={32} />
          <p>Agent Allowance</p>
        </div>
        <nav className="sidenav-nav" aria-label="Sections">
          {TABS.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <p className="sidenav-foot">
          <span>{snapshot?.network?.name || 'XRPL EVM Testnet'}</span>
          <span>Chain {snapshot?.network?.chainId || '1449000'}</span>
        </p>
      </aside>

      <div className="frame">
        <div className="shell">
          <header className="top">
            <div className="brand">
              <LogoMark size={40} />
              <div>
                <p className="eyebrow">Mastercard × XRPL Hackathon</p>
                <h1>Agent Allowance</h1>
              </div>
            </div>
            <ThemeControl theme={theme} setTheme={setTheme} />
          </header>
          <p className="lede">Each purchase is checked against your rules before it is paid.</p>

          <main id="main" tabIndex={-1}>
            {connection === 'loading' && !snapshot ? <Skeletons /> : null}
            {connection === 'error' && !snapshot ? (
              <div className="card" role="alert">
                <EmptyState
                  icon={<IconAlert />}
                  title="The allowance server is not responding"
                  action={<button type="button" className="btn primary" onClick={load}>Retry</button>}
                >
                  Start it with npm run server, then try again.
                </EmptyState>
              </div>
            ) : null}
            {snapshot && tab === 'home' ? (
              <div className="stack">
                {connection === 'error' ? (
                  <p className="note warn" role="alert">
                    <IconAlert />
                    <span>Could not refresh. Showing the last numbers.</span>
                    <button type="button" className="btn" onClick={load}>Retry</button>
                  </p>
                ) : null}
                <section className="card hero" aria-labelledby="allowance-title">
                  <div className="hero-main">
                    <div className="hero-copy">
                      <h2 id="allowance-title" className="eyebrow">RLUSD left</h2>
                      <p className="figure">
                        <CountUp value={view.leftNumber} />
                        <span className="unit">RLUSD</span>
                      </p>
                      <p className="meter-caption">
                        {money(view.spent)} of {money(view.budget)} RLUSD spent
                      </p>
                    </div>
                    <SpendRing ratio={view.ratio} label={balanceLabel} />
                  </div>
                  <dl className="rule-grid">
                    <div>
                      <dt>Per purchase</dt>
                      <dd>{money(snapshot.rules.maxPerPurchase)} RLUSD</dd>
                    </div>
                    <div>
                      <dt>Expires</dt>
                      <dd>{expiresOn(snapshot.rules.expiresAt) || 'No date'}</dd>
                    </div>
                    <div>
                      <dt>Merchants</dt>
                      <dd>{merchantCount} allowed</dd>
                    </div>
                  </dl>
                  <div className="hero-actions">
                    <button type="button" className="btn primary" onClick={onRun}>Run agent</button>
                    <button type="button" className="btn" onClick={onOverCap} disabled={overCapBusy}>
                      {overCapBusy ? 'Checking the cap…' : 'Try an over-cap purchase'}
                    </button>
                    {runNote ? <p className="note" role="status">{runNote}</p> : null}
                  </div>
                </section>

                {overCap ? (
                  <section className="card rejection" role="alert" aria-labelledby="over-cap-title">
                    <div className="rejection-top">
                      <span className="empty-icon" aria-hidden="true"><IconAlert /></span>
                      <div>
                        <h2 id="over-cap-title">{overCap.error ? 'The over-cap demo did not finish' : 'Rejected before signing'}</h2>
                        {overCap.error ? <p>{overCap.error}</p> : (
                          <p>
                            The agent requested a {money(overCap.amount)} RLUSD quote. The {money(overCap.cap)} RLUSD per-purchase cap stopped it. No voucher was signed.
                          </p>
                        )}
                      </div>
                    </div>
                    {overCap.reason ? <p className="rejection-reason">{plainReason(overCap.reason)}</p> : null}
                    {overCap.contract ? (
                      <div className="contract-note">
                        {overCap.contract.ran ? (
                          <>
                            <p>The ledger rejected a {overCap.contract.rejectedCumulativeRlusd || '6'} RLUSD cumulative voucher in simulation. Redeemed balance stayed {overCap.contract.redeemedBefore}.</p>
                            <p className="meta">Block {overCap.contract.blockNumber}. Revert <code>{overCap.contract.rejectionData}</code></p>
                          </>
                        ) : <p>{overCap.contract.reason}</p>}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <div className="split">
                  <section className="card" aria-labelledby="needs-title">
                    <div className="section-head">
                      <h2 id="needs-title">Needs you</h2>
                      <p>An approval is recorded here. It does not sign a voucher or move RLUSD.</p>
                    </div>
                    {view.pending.length === 0 ? (
                      <EmptyState
                        icon={<IconCheck />}
                        title="Nothing is waiting"
                        action={<button type="button" className="btn" onClick={() => askEvePrompt('What is waiting for approval?')}>Ask Eve</button>}
                      >
                        A quote outside the rules will land here.
                      </EmptyState>
                    ) : (
                      <ul className="needs">
                        {view.pending.map((item) => (
                          <li key={item.id} className="need">
                            <div className="need-top">
                              <span className="avatar" aria-hidden="true">{initial(item.merchantLabel)}</span>
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
                    <ActivityList
                      items={latest}
                      explorer={snapshot.network?.explorerUrl}
                      onOpen={setDetail}
                      empty={(
                        <EmptyState
                          icon={<IconReceipt />}
                          title="No payments yet"
                          action={<button type="button" className="btn" onClick={onRun}>Run agent</button>}
                        >
                          Paid and blocked quotes will show up here.
                        </EmptyState>
                      )}
                    />
                  </section>
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
                  explorer={snapshot.network?.explorerUrl}
                  onOpen={setDetail}
                  empty={filter === 'all' ? (
                    <EmptyState
                      icon={<IconReceipt />}
                      title="No payments yet"
                      action={<button type="button" className="btn" onClick={() => askEvePrompt('What should the agent do next?')}>Ask Eve</button>}
                    >
                      Run the agent, or ask Eve what to do next.
                    </EmptyState>
                  ) : (
                    <EmptyState icon={<IconActivity />} title={`Nothing is ${filter} right now`}>
                      Try another filter, or come back after the agent runs.
                    </EmptyState>
                  )}
                />
              </section>
            ) : null}

          </main>
        </div>

        <nav className="tabbar" aria-label="Sections">
          <div className="tabbar-inner">
            {TABS.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => setTab(id)}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      <EveDock seed={eveSeed} onSeedHandled={() => setEveSeed(null)} />
      {detail ? (
        <Sheet title={detail.task || 'Purchase'} onClose={() => setDetail(null)}>
          <Detail item={detail} currency={snapshot?.currency || 'RLUSD'} />
        </Sheet>
      ) : null}
    </div>
  );
}

function ThemeControl({ theme, setTheme }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const menu = document.getElementById(menuId);
    menu?.querySelector('input:checked')?.focus();
    function onKey(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, menuId]);

  return (
    <div className="settings" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Display settings"
        onClick={() => setOpen((value) => !value)}
      >
        <IconSettings />
      </button>
      {open ? (
        <fieldset className="theme-menu" id={menuId}>
          <legend>Color theme</legend>
          {['light', 'dark', 'system'].map((choice) => (
            <label key={choice} className={theme === choice ? 'is-on' : ''}>
              <input
                type="radio"
                name="theme"
                value={choice}
                checked={theme === choice}
                onChange={() => setTheme(choice)}
              />
              <span>{choice[0].toUpperCase() + choice.slice(1)}</span>
              {theme === choice ? <IconCheck /> : null}
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

function SpendRing({ ratio, label }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, ratio));
  const percent = Math.round(clamped * 100);
  return (
    <div
      className="ring"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="ring-track" cx="60" cy="60" r={radius} />
        {clamped > 0 ? (
          <circle
            className="ring-value"
            cx="60"
            cy="60"
            r={radius}
            strokeDasharray={`${circumference * clamped} ${circumference}`}
          />
        ) : null}
      </svg>
      <div className="ring-label" aria-hidden="true">
        <strong>{percent}%</strong>
        <span>spent</span>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <div className="empty-copy">
        <p className="empty-title">{title}</p>
        {children ? <p>{children}</p> : null}
      </div>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

function ReceiptCard({ item, explorer }) {
  const voucher = txUrl(explorer, item.txHash);
  const payout = txUrl(explorer, item.payoutTx);
  const receipt = receiptHref(item.receiptUrl);
  const kitReceipt = /^https?:\/\/.+\/public\/evidence\/claims\/0x[0-9a-f]{64}\/0x[0-9a-f]{64}\.json$/i.test(receipt || '');
  const settled = item.settlementStatus === 'settled';
  return (
    <article className="receipt">
      <div className="receipt-top">
        <span className="avatar" aria-hidden="true">{initial(item.merchantLabel)}</span>
        <div className="receipt-id">
          <p className="receipt-merchant">{item.merchantLabel || 'Merchant'}</p>
          <p className="meta">{when(item.createdAt)}</p>
        </div>
        <p className="amount">{money(item.amount)} RLUSD</p>
        {settled ? (
          <span className="settled-check" role="img" aria-label="Settled"><IconCheck /></span>
        ) : (
          <span className="pill warn">Processing</span>
        )}
      </div>
      <dl className="receipt-facts">
        <div>
          <dt>Voucher</dt>
          <dd>{voucher ? <a href={voucher} target="_blank" rel="noreferrer noopener">View on explorer</a> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Payout</dt>
          <dd>{payout ? <a href={payout} target="_blank" rel="noreferrer noopener">View on explorer</a> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Settlement</dt>
          <dd>{receipt ? <a href={receipt} target="_blank" rel="noreferrer noopener">Settlement receipt</a> : 'Not recorded'}</dd>
        </div>
      </dl>
      {kitReceipt ? (
        <a className="explorer" href={receipt} target="_blank" rel="noreferrer noopener">Verify receipt</a>
      ) : null}
    </article>
  );
}

function RowSkeleton() {
  return (
    <div className="sk-row">
      <span className="sk sk-avatar" />
      <span className="sk-lines">
        <span className="sk sk-line" />
        <span className="sk sk-line sk-short" />
      </span>
    </div>
  );
}

function ActivityList({ items, onOpen, empty, explorer }) {
  if (!items.length) return empty;
  return (
    <ul className="activity">
      {items.map((item) => {
        const status = pill(item);
        return (
          <li key={item.id}>
            <button type="button" className="row" onClick={() => onOpen(item)}>
              <span className="avatar" aria-hidden="true">{initial(item.merchantLabel)}</span>
              <span className="row-main">
                <span className="row-title">{item.merchantLabel || 'Merchant'}</span>
                <span className="meta">
                  <span className={`pill ${status.tone}`}>{status.label}</span>
                  <span>{item.task || 'Purchase'} · {when(item.createdAt)}</span>
                </span>
              </span>
              <span className="amount">{money(item.amount)} RLUSD</span>
            </button>
            {item.status === 'paid' ? <ReceiptCard item={item} explorer={explorer} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function settlementLabel(status) {
  if (status === 'settled') return 'Settled';
  if (status === 'processing') return 'Processing';
  return 'Not recorded';
}

function Detail({ item, currency }) {
  const status = pill(item);
  const name = item.merchantLabel || 'Merchant';
  return (
    <div className="detail">
      <p className={`pill ${status.tone}`}>{status.label}</p>
      {item.status === 'paid' ? <ReceiptCard item={item} explorer={EXPLORER} /> : (
        <p className="figure">{money(item.amount)} <span className="unit">{currency}</span></p>
      )}
      <p className="detail-name">{name}</p>
      <p className="meta"><code>{item.merchant}</code></p>
      <p className="meta">{when(item.createdAt)}</p>
      {item.reason ? <p>{plainReason(item.reason)}</p> : null}
      {item.plan?.source === 'bedrock' && item.plan.reason ? (
        <div className="plan">
          <h3>Purchase plan</h3>
          <p>{item.plan.reason}</p>
          <BedrockMark />
        </div>
      ) : null}
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
          <dt>Merchant payout transaction</dt>
          <dd>{item.payoutTx ? <code>{item.payoutTx}</code> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Channel</dt>
          <dd>{item.channelId ? <code>{item.channelId}</code> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Settlement</dt>
          <dd>{settlementLabel(item.settlementStatus)}</dd>
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
        <div className="sheet-handle" aria-hidden="true" />
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
      <div className="card hero-skeleton" aria-hidden="true">
        <div className="sk-copy">
          <span className="sk sk-label" />
          <span className="sk sk-figure" />
          <span className="sk sk-line" />
        </div>
        <span className="sk sk-ring" />
      </div>
      <div className="split">
        <div className="card sk-card" aria-hidden="true">
          <span className="sk sk-title" />
          <RowSkeleton />
          <RowSkeleton />
        </div>
        <div className="card sk-card" aria-hidden="true">
          <span className="sk sk-title" />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      </div>
    </div>
  );
}
