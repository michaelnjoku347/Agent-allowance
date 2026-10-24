import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { approvePurchase, declinePurchase, fetchSnapshot, runAgent, sampleSnapshot } from './api.js';
import CountUp from './CountUp.jsx';
import EvePanel from './EvePanel.jsx';
import JevCard, { riskDisplay } from './JevCard.jsx';
import Ring from './Ring.jsx';
import { deriveLedger, status } from './ledger.js';
import { clock, dateOnly, day, daysUntil, money, shortAddress, unitsToNumber, when } from './format.js';
import { useTheme } from './theme.js';
import {
  AutoIcon, BlockIcon, CalendarIcon, CapIcon, CheckIcon, ChevronIcon, ClockIcon, ExternalIcon,
  HomeIcon, ListIcon, Logo, MicIcon, MoonIcon, PauseIcon, PlayIcon, ShieldIcon, SparkIcon, StoreIcon, SunIcon, XIcon,
} from './icons.jsx';
import { plainReason } from '../../shared/words.js';

const TABS = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'activity', label: 'Activity', Icon: ListIcon },
  { id: 'eve', label: 'Eve', Icon: SparkIcon },
];

const FILTERS = [
  ['all', 'All'],
  ['paid', 'Paid'],
  ['waiting', 'Waiting'],
  ['blocked', 'Blocked'],
];

const THEMES = [
  { id: 'light', label: 'Light', Icon: SunIcon },
  { id: 'dark', label: 'Dark', Icon: MoonIcon },
  { id: 'system', label: 'System', Icon: AutoIcon },
];

const PAUSE_KEY = 'allowance-paused';

function usePaused() {
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem(PAUSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PAUSE_KEY, paused ? '1' : '0');
    } catch {
      /* Storage can be blocked. The pause still holds for this visit. */
    }
  }, [paused]);
  return [paused, setPaused];
}

function merchantName(item) {
  return item.merchantLabel || shortAddress(item.merchant) || 'Merchant';
}

function ruleRows(item) {
  const rows = [
    ['amount must be positive', 'Amount is positive'],
    ['expired', 'Allowance has not expired'],
    ['merchant not allowed', 'Merchant is approved'],
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

/** Short tag for why a quote stopped, e.g. "Over 5.00 cap". */
function reasonTag(item, cap) {
  switch (item.reason) {
    case 'over per-purchase cap': return `Over ${money(cap)} cap`;
    case 'merchant not allowed': return 'Unapproved merchant';
    case 'over budget': return 'Over budget';
    case 'expired': return 'Allowance expired';
    case 'over channel cap': return 'Channel limit';
    case 'Jev flagged for review': return 'Flagged by Jev';
    default: return item.reason ? plainReason(item.reason) : 'Outside the rules';
  }
}

function hue(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [tab, setTab] = useState('home');
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState('loading');
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [runNote, setRunNote] = useState('');
  const [running, setRunning] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [paused, setPaused] = usePaused();
  const seen = useRef(null);
  const mainRef = useRef(null);

  async function load() {
    try {
      const next = await fetchSnapshot();
      setSnapshot(next);
      setConnection('online');
    } catch {
      setConnection('offline');
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

  const offline = connection === 'offline' && !snapshot;
  const data = snapshot ?? (offline ? sampleSnapshot : null);
  const ledger = useMemo(() => deriveLedger(data), [data]);
  const rules = data?.rules;

  useEffect(() => {
    const ids = ledger.activity.map((item) => item.id);
    if (!data) return;
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ledger.activity.filter((item) => !seen.current.has(item.id));
    for (const id of ids) seen.current.add(id);
    if (!added.length) return;
    const newest = added[0];
    setAnnounce(`${status(newest).label}. ${merchantName(newest)}, ${money(newest.amount)} RLUSD.`);
  }, [ledger.activity, data]);

  function go(next) {
    setTab(next);
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }

  async function decide(id, kind) {
    setBusyId(id);
    setActionError('');
    try {
      if (kind === 'approve') await approvePurchase(id);
      else await declinePurchase(id);
      setDetail(null);
      setAnnounce(kind === 'approve' ? 'Approved. Nothing was paid.' : 'Declined.');
      await load();
    } catch (error) {
      setActionError(error.message || 'That did not save.');
    } finally {
      setBusyId('');
    }
  }

  async function onRun() {
    if (paused) return;
    setRunNote('');
    setRunning(true);
    try {
      const body = await runAgent('Buy the morning market brief');
      setRunNote(body.ok ? 'Agent started. New purchases appear below in a few seconds.' : (body.error || 'Add the wallet in .env to pay a merchant.'));
    } catch (error) {
      setRunNote(error.message || 'Could not start the agent.');
    } finally {
      setRunning(false);
    }
  }

  const themeIndex = Math.max(0, THEMES.findIndex((t) => t.id === theme));
  const currentTheme = THEMES[themeIndex];
  const nextTheme = THEMES[(themeIndex + 1) % THEMES.length];
  const pendingCount = ledger.pending.length;

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <div className="sr-only" aria-live="polite">{announce}</div>

      <aside className="rail">
        <div className="brand">
          <Logo size={36} />
          <div>
            <p className="brand-name">Agent Allowance</p>
            <p className="brand-sub">Mastercard × XRPL</p>
          </div>
        </div>
        <nav className="nav" aria-label="Sections">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'nav-item is-on' : 'nav-item'}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => go(id)}
            >
              <span className="nav-icon"><Icon /></span>
              <span className="nav-label">{label}</span>
              {id === 'home' && pendingCount ? (
                <span className="nav-badge">
                  {pendingCount}
                  <span className="sr-only"> need you</span>
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <NetworkBadge network={data?.network} offline={offline} />
          <fieldset className="theme">
            <legend className="sr-only">Color theme</legend>
            {THEMES.map(({ id, label, Icon }) => (
              <label key={id} className={theme === id ? 'is-on' : ''} title={label}>
                <input type="radio" name="theme" value={id} checked={theme === id} onChange={() => setTheme(id)} />
                <Icon size={18} />
                <span className="sr-only">{label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </aside>

      <div className="column">
        <header className="topbar">
          <div className="brand">
            <Logo size={32} />
            <p className="brand-name">Agent Allowance</p>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label={`Theme: ${currentTheme.label}. Switch to ${nextTheme.label}`}
              onClick={() => setTheme(nextTheme.id)}
            >
              <currentTheme.Icon size={20} />
            </button>
            {tab !== 'eve' ? (
              <button type="button" className="icon-btn accent" aria-label="Talk to Eve" onClick={() => go('eve')}>
                <MicIcon size={20} />
              </button>
            ) : null}
          </div>
        </header>

        <main id="main" ref={mainRef} tabIndex={-1} className={`screen screen-${tab}`}>
          {offline ? (
            <div className="banner warn" role="status">
              <ShieldIcon size={20} />
              <p><strong>Offline preview.</strong> The allowance server is not answering, so this is sample data and buttons are off. Start it with <code>npm run server</code>.</p>
              <button type="button" className="btn small" onClick={load}>Retry</button>
            </div>
          ) : null}
          {connection === 'offline' && snapshot ? (
            <div className="banner warn" role="alert">
              <ShieldIcon size={20} />
              <p>Could not refresh. Showing the last numbers.</p>
              <button type="button" className="btn small" onClick={load}>Retry</button>
            </div>
          ) : null}
          {!offline && ledger.preview && tab !== 'eve' ? (
            <div className="banner info" role="note">
              <SparkIcon size={20} />
              <p><strong>Sample purchases.</strong> No RLUSD moves. The first real agent run replaces them.</p>
            </div>
          ) : null}

          {!data && tab !== 'eve' ? <Skeletons /> : null}

          {data && tab === 'home' ? (
            <Home
              ledger={ledger}
              rules={rules}
              paused={paused}
              offline={offline}
              running={running}
              runNote={runNote}
              busyId={busyId}
              actionError={actionError}
              onRun={onRun}
              onPause={() => { setPaused(true); setRunNote(''); }}
              onResume={() => setPaused(false)}
              onDecide={decide}
              onOpen={setDetail}
              onSeeAll={() => go('activity')}
            />
          ) : null}

          {data && tab === 'activity' ? (
            <Activity ledger={ledger} filter={filter} setFilter={setFilter} onOpen={setDetail} />
          ) : null}

          {tab === 'eve' ? (
            <EvePanel
              ledger={ledger}
              paused={paused}
              onPause={() => setPaused(true)}
              onResume={() => setPaused(false)}
            />
          ) : null}
        </main>
      </div>

      {detail ? (
        <Sheet title={merchantName(detail)} onClose={() => setDetail(null)}>
          <Detail
            item={detail}
            cap={ledger.cap}
            currency={data?.currency || 'RLUSD'}
            busy={busyId === detail.id}
            offline={offline}
            onDecide={decide}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

function NetworkBadge({ network, offline }) {
  return (
    <p className="network">
      <span className={offline ? 'dot off' : 'dot'} aria-hidden="true" />
      <span>
        {network?.name || 'XRPL EVM Testnet'}
        <span className="network-sub">{offline ? 'Server offline' : `Chain ${network?.chainId ?? 1449000}`}</span>
      </span>
    </p>
  );
}

function Home({
  ledger, rules, paused, offline, running, runNote, busyId, actionError,
  onRun, onPause, onResume, onDecide, onOpen, onSeeAll,
}) {
  const [showMerchants, setShowMerchants] = useState(false);
  const merchantsId = useId();
  const merchants = rules?.allowedMerchants ?? [];
  const days = daysUntil(rules?.expiresAt);
  const expired = days !== null && days <= 0;
  const budgetText = money(ledger.budget);
  const leftText = money(ledger.left);
  const spentText = money(ledger.spent);
  const state = offline ? 'Preview' : paused ? 'Paused' : expired ? 'Expired' : 'Active';

  return (
    <div className="home-grid">
      <section className="hero" aria-labelledby="balance-title">
        <div className="hero-head">
          <h1 id="balance-title" className="hero-kicker">Allowance left</h1>
          <span className={`state state-${state.toLowerCase()}`}>
            <span className="state-dot" aria-hidden="true" />
            {state}
          </span>
        </div>
        <div className="hero-body">
          <div className="hero-figures">
            <p className="hero-amount">
              <CountUp value={unitsToNumber(ledger.left)} text={leftText} />
              <span className="hero-unit">RLUSD</span>
            </p>
            <p className="hero-of">
              of <strong>{budgetText}</strong> RLUSD budget
            </p>
            <dl className="hero-split">
              <div>
                <dt>Spent</dt>
                <dd>{spentText}</dd>
              </div>
              <div>
                <dt>Purchases</dt>
                <dd>{ledger.paidCount}</dd>
              </div>
              <div>
                <dt>Waiting</dt>
                <dd>{ledger.pending.length}</dd>
              </div>
            </dl>
          </div>
          <Ring ratio={ledger.ratioLeft} />
        </div>
        <p className="sr-only">{leftText} of {budgetText} RLUSD left. {spentText} RLUSD spent.</p>

        <ul className="rule-chips" aria-label="Allowance rules">
          <li className="rule-chip">
            <span className="chip-icon"><CapIcon size={18} /></span>
            <span><strong>{money(ledger.cap)}</strong> max per purchase</span>
          </li>
          <li className="rule-chip">
            <span className="chip-icon"><CalendarIcon size={18} /></span>
            <span>
              {expired ? 'Expired ' : 'Expires '}
              <strong>{dateOnly(rules?.expiresAt)}</strong>
              {days !== null && days > 0 ? <span className="chip-dim"> · {days} day{days === 1 ? '' : 's'}</span> : null}
            </span>
          </li>
          <li>
            <button
              type="button"
              className="chip-btn"
              aria-expanded={showMerchants}
              aria-controls={merchantsId}
              onClick={() => setShowMerchants((v) => !v)}
            >
              <span className="chip-icon"><StoreIcon size={18} /></span>
              <span><strong>{merchants.length}</strong> approved merchant{merchants.length === 1 ? '' : 's'}</span>
              <ChevronIcon size={16} className={showMerchants ? 'chev open' : 'chev'} />
            </button>
          </li>
        </ul>
        {showMerchants ? (
          <ul className="merchant-list" id={merchantsId}>
            {merchants.map((m) => (
              <li key={m.address}>
                <Avatar name={m.label || m.address} />
                <span>
                  <span className="m-name">{m.label || 'Unnamed merchant'}</span>
                  <code>{shortAddress(m.address)}</code>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="hero-actions">
          {paused ? (
            <button type="button" className="btn hero-primary" onClick={onResume}>
              <PlayIcon size={20} /> Resume agent
            </button>
          ) : (
            <>
              <button type="button" className="btn hero-primary" onClick={onRun} disabled={offline || running || expired}>
                <PlayIcon size={20} /> {running ? 'Starting…' : 'Run agent'}
              </button>
              <button type="button" className="btn hero-ghost" onClick={onPause}>
                <PauseIcon size={20} /> Pause
              </button>
            </>
          )}
        </div>
        {paused ? <p className="hero-note" role="status">Paused. Run agent is off on this dashboard until you resume.</p> : null}
        {runNote ? <p className="hero-note" role="status">{runNote}</p> : null}
      </section>

      <section className="panel needs" aria-labelledby="needs-title">
        <div className="panel-head">
          <h2 id="needs-title">
            Needs you
            {ledger.pending.length ? <span className="count">{ledger.pending.length}</span> : null}
          </h2>
          <p>Quotes outside the rules wait here. Approving records your decision. It does not sign a voucher or move RLUSD.</p>
        </div>
        {ledger.pending.length === 0 ? (
          <div className="all-clear">
            <span className="all-clear-icon"><CheckIcon size={22} /></span>
            <p><strong>All clear.</strong> Nothing is waiting for you.</p>
          </div>
        ) : (
          <ul className="need-list">
            {ledger.pending.map((item) => {
              const risk = riskDisplay(item.jev?.risk);
              return (
                <li key={item.id} className="need">
                  <div className="need-top">
                    <Avatar name={merchantName(item)} />
                    <div className="need-main">
                      <h3>{merchantName(item)}</h3>
                      <p className="meta">{item.task || 'Purchase'}</p>
                    </div>
                    <p className="need-amount">{money(item.amount)}<span> RLUSD</span></p>
                  </div>
                  <p className="need-why">
                    <span className="tag warn"><ShieldIcon size={16} /> {reasonTag(item, ledger.cap)}</span>
                    {risk !== null ? <span className="tag">Jev risk {risk}/5</span> : null}
                    <span className="meta">{clock(item.createdAt)}</span>
                  </p>
                  <div className="need-actions">
                    <button type="button" className="btn primary" disabled={offline || busyId === item.id} onClick={() => onDecide(item.id, 'approve')}>
                      <CheckIcon size={18} /> {busyId === item.id ? 'Saving…' : 'Approve'}
                    </button>
                    <button type="button" className="btn" disabled={offline || busyId === item.id} onClick={() => onDecide(item.id, 'decline')}>
                      <XIcon size={18} /> Decline
                    </button>
                    <button type="button" className="btn text" onClick={() => onOpen(item)}>
                      Details<span className="sr-only"> for {merchantName(item)}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {actionError ? <p className="banner warn inline" role="alert">{actionError}</p> : null}
      </section>

      <section className="panel recent" aria-labelledby="recent-title">
        <div className="panel-head row-head">
          <h2 id="recent-title">Recent activity</h2>
          {ledger.activity.length ? (
            <button type="button" className="btn text" onClick={onSeeAll}>
              See all <ChevronIcon size={16} />
            </button>
          ) : null}
        </div>
        <ActivityList
          items={ledger.activity.slice(0, 5)}
          onOpen={onOpen}
          empty="No purchases yet. Press Run agent and paid or blocked quotes show up here."
        />
      </section>
    </div>
  );
}

function Activity({ ledger, filter, setFilter, onOpen }) {
  const counts = { all: ledger.activity.length, paid: 0, waiting: 0, blocked: 0 };
  for (const item of ledger.activity) counts[status(item).key] += 1;
  const shown = ledger.activity.filter((item) => filter === 'all' || status(item).key === filter);
  const groups = [];
  for (const item of shown) {
    const label = day(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="activity-screen">
      <div className="screen-head">
        <h1>Activity</h1>
        <p>{money(ledger.spent)} RLUSD paid across {ledger.paidCount} purchase{ledger.paidCount === 1 ? '' : 's'}. {money(ledger.left)} left.</p>
      </div>
      <div className="segmented" role="group" aria-label="Filter activity">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={filter === id ? 'seg is-on' : 'seg'}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
            <span className="seg-count">{counts[id]}</span>
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <section className="panel">
          <p className="empty-copy">
            {filter === 'all' ? 'No purchases yet. Run the agent, or ask Eve what to do next.' : `Nothing is ${filter} right now.`}
          </p>
        </section>
      ) : groups.map((group) => (
        <section key={group.label} className="panel" aria-label={group.label}>
          <h2 className="group-title">{group.label}</h2>
          <ActivityList items={group.items} onOpen={onOpen} />
        </section>
      ))}
    </div>
  );
}

function StatusPill({ item }) {
  const s = status(item);
  const Icon = s.key === 'paid' ? CheckIcon : s.key === 'blocked' ? BlockIcon : ClockIcon;
  return (
    <span className={`pill ${s.tone}`}>
      <Icon size={14} />
      {s.label}
    </span>
  );
}

function Avatar({ name }) {
  const letters = String(name || '?').replace(/^0x/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className="avatar" style={{ '--h': hue(name) }} aria-hidden="true">
      {letters}
    </span>
  );
}

function ActivityList({ items, onOpen, empty }) {
  if (!items.length) return <p className="empty-copy">{empty}</p>;
  return (
    <ul className="activity">
      {items.map((item) => {
        const s = status(item);
        return (
          <li key={item.id}>
            <button type="button" className="row" onClick={() => onOpen(item)}>
              <Avatar name={merchantName(item)} />
              <span className="row-main">
                <span className="row-title">
                  {merchantName(item)}
                  {item.sample ? <span className="sample-tag">Sample</span> : null}
                </span>
                <span className="meta">{item.task || 'Purchase'} · {clock(item.createdAt)}</span>
              </span>
              <span className="row-end">
                <span className={`row-amount ${s.key}`}>{money(item.amount)}<span className="unit"> RLUSD</span></span>
                <StatusPill item={item} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Detail({ item, cap, currency, busy, offline, onDecide }) {
  return (
    <div className="detail">
      <div className="detail-hero">
        <StatusPill item={item} />
        <p className="detail-amount">{money(item.amount)} <span>{currency}</span></p>
        <p className="detail-task">{item.task || 'Purchase'}</p>
        <p className="meta">{when(item.createdAt)}</p>
        {item.sample ? <p className="sample-tag">Sample data</p> : null}
      </div>
      {item.reason ? (
        <p className="banner warn inline"><ShieldIcon size={18} /> <span>{plainReason(item.reason)}{item.reason === 'over per-purchase cap' ? ` The cap is ${money(cap)} ${currency}.` : ''}</span></p>
      ) : null}
      {item.note ? <p className="meta">{item.note}</p> : null}
      {item.status === 'pending' ? (
        <div className="need-actions">
          <button type="button" className="btn primary" disabled={offline || busy} onClick={() => onDecide(item.id, 'approve')}>
            <CheckIcon size={18} /> {busy ? 'Saving…' : 'Approve'}
          </button>
          <button type="button" className="btn" disabled={offline || busy} onClick={() => onDecide(item.id, 'decline')}>
            <XIcon size={18} /> Decline
          </button>
        </div>
      ) : null}
      <h3 className="detail-h">Rule checks</h3>
      <ul className="checks">
        {ruleRows(item).map((row) => (
          <li key={row.label} className={row.state}>
            <span className="check-icon" aria-hidden="true">
              {row.state === 'pass' ? <CheckIcon size={16} /> : row.state === 'fail' ? <XIcon size={16} /> : '–'}
            </span>
            <span className="check-label">{row.label}</span>
            <span className="check-text">{row.text}</span>
          </li>
        ))}
      </ul>
      <JevCard jev={item.jev} />
      <h3 className="detail-h">On-chain record</h3>
      <dl className="facts">
        <Fact label="Merchant address" value={item.merchant} />
        <Fact label="Transaction" value={item.txHash} />
        <Fact label="Merchant payout" value={item.payoutTx} />
        <Fact label="Channel" value={item.channelId} />
        <Fact label="Claim ID" value={item.claimId} />
      </dl>
      <div className="links">
        {item.receiptUrl ? (
          <a className="btn" href={item.receiptUrl} target="_blank" rel="noreferrer noopener">
            Receipt <ExternalIcon size={16} /><span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        {item.explorerUrl ? (
          <a className="btn" href={item.explorerUrl} target="_blank" rel="noreferrer noopener">
            View on explorer <ExternalIcon size={16} /><span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ? <code title={value}>{shortAddress(value)}</code> : <span className="meta">Not recorded</span>}</dd>
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
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
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
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div className="sheet-back" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-top">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <XIcon size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Skeletons() {
  return (
    <div className="home-grid" aria-busy="true">
      <p className="sr-only" role="status">Loading the allowance</p>
      <div className="hero skeleton" />
      <div className="panel skeleton short" />
      <div className="panel skeleton" />
    </div>
  );
}
