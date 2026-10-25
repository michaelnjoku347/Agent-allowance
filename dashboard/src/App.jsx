import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { allowanceView } from './allowance.js';
import { declinePurchase, fetchSnapshot, runAgent, runOverCap, sampleSnapshot, selectUseCase, setAgentFrozen } from './api.js';
import BedrockMark from './BedrockMark.jsx';
import BrandMark from './BrandMark.jsx';
import LedgerApproval from './LedgerApproval.jsx';
import CountUp from './CountUp.jsx';
import { EveDock } from './EvePanel.jsx';
import HeistDemo from './HeistDemo.jsx';
import HowItWorks from './HowItWorks.jsx';
import RogueDemo from './RogueDemo.jsx';
import { flowForHeist, flowForItem, narrationFor, narrationForHeist, toneKind, txFeed } from './present.js';
import { MoneyFlow, TxFeed } from './Stage.jsx';
import { playTone, readVoiceEnabled, setPresentation, speakLine, stopSpeech, writeVoiceEnabled } from './stage.js';
import {
  IconActivity,
  IconAlert,
  IconCheck,
  IconHome,
  IconLock,
  IconReceipt,
  IconBadgeCheck,
  IconBot,
  IconContrast,
  IconGear,
  IconHelp,
  IconMore,
  IconShieldCheck,
  IconSliders,
  IconStore,
} from './icons.jsx';
import JevCard from './JevCard.jsx';
import { money, relativeTime, shortAddress, when } from './format.js';
import { useTheme } from './theme.js';
import { USE_CASES } from '../../shared/use-cases.js';
import { plainReason } from '../../shared/words.js';
import { NAV, approvalCount, mobileTabs, moreItems, navSections, parseRoute, routeHash } from './routes.js';

const Desk = lazy(() => import('./views.jsx'));

const ICONS = {
  home: IconHome,
  activity: IconActivity,
  approvals: IconBadgeCheck,
  rules: IconSliders,
  merchants: IconStore,
  agents: IconBot,
  security: IconShieldCheck,
  settings: IconGear,
  help: IconHelp,
  more: IconMore,
};

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

const EXPLORER = 'https://explorer.testnet.xrplevm.org';

const ACTIVITY_VIEWS = [
  ['all', 'All'],
  ['audit', 'Audit'],
  ['chain', 'On-chain'],
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
  const ledgerPaid = item.approvedBy === 'ledger' || item.simulatedLedger || item.reason === 'ledger approved';
  if (item.status === 'paid' && ledgerPaid) return { label: 'Paid · Ledger', tone: 'ok' };
  if (item.status === 'paid') return { label: 'Paid', tone: 'ok' };
  if (item.declineOnly || item.reason === 'merchant not allowed' || item.status === 'declined' || item.status === 'skipped') {
    return { label: 'Blocked', tone: 'danger' };
  }
  return { label: 'Needs you', tone: 'warn' };
}

function cannotApprove(item) {
  return Boolean(item.declineOnly) || item.reason === 'merchant not allowed';
}

function reasonChip(item, cap) {
  if (item.reason === 'over per-purchase cap') {
    const over = Number(item.amount) - Number(cap);
    if (Number.isFinite(over) && over > 0) return `Over cap by ${money(over)}`;
  }
  return plainReason(item.reason);
}

function planLabel(plan) {
  if (plan?.source === 'bedrock') return 'Amazon Bedrock';
  if (plan?.source === 'fallback') return 'Fallback (Bedrock not configured)';
  return '';
}

function planDetail(plan) {
  const label = planLabel(plan);
  const reason = String(plan?.reason ?? '').trim();
  if (!label || !reason || reason.replace(/\.$/, '') === label) return '';
  return reason;
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

function auditPill(row) {
  if (row.rule === 'freeze') return ['Frozen', 'is-block'];
  if (row.rule === 'unfreeze') return ['Unfrozen', 'is-ok'];
  if (row.outcome === 'ledger-approved') return ['Ledger approved', 'is-wait'];
  if (row.outcome === 'allowed') return ['Allowed', 'is-ok'];
  return ['Blocked', 'is-block'];
}

function UseCaseCard({ selected, busy, disabled, onSelect }) {
  const current = USE_CASES.find((item) => item.id === selected) || USE_CASES[0];
  return (
    <section className="card" aria-labelledby="usecase-title">
      <div className="section-head">
        <h2 id="usecase-title">This allowance</h2>
        <p>{current.summary}</p>
      </div>
      <div className="filters" role="toolbar" aria-label="Choose a job">
        {USE_CASES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === current.id ? 'chip is-on' : 'chip'}
            aria-pressed={item.id === current.id}
            disabled={disabled || busy === item.id}
            onClick={() => onSelect(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <ul className="use-jobs">
        {current.jobs.map((job) => <li key={job}>{job}</li>)}
      </ul>
      <p className="meta">Choosing a job names the work. The budget, the cap, and the merchant list stay as they are.</p>
    </section>
  );
}

function AuditCard({ rows, onExport }) {
  const shown = (rows || []).slice(0, 8);
  return (
    <section className="card" aria-labelledby="audit-title">
      <div className="audit-head">
        <div className="section-head">
          <h2 id="audit-title">Audit trail</h2>
          <p>Every allow, block, and Ledger approval is kept with the rule, the reason, and the signer.</p>
        </div>
        <button type="button" className="btn" onClick={onExport}>Export JSON</button>
      </div>
      {shown.length === 0 ? (
        <p className="meta">Decisions land here as soon as the agent or the rules make one. Export downloads that list.</p>
      ) : (
        <ul className="audit-list">
          {shown.map((row) => {
            const [label, tone] = auditPill(row);
            return (
              <li key={row.id} className="audit-row">
                <div className="audit-top">
                  <span className={`audit-pill ${tone}`}>{label}</span>
                  <span className="meta">{row.rule}</span>
                </div>
                <p>{row.reason}</p>
                <p className="meta">
                  {row.signer ? `Signer ${row.signer}` : 'Nothing signed'}
                  {row.amount ? ` · ${row.amount} RLUSD` : ''}
                  {row.merchantLabel ? ` · ${row.merchantLabel}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
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
  const [route, setRoute] = useState(() => (typeof window === 'undefined' ? 'home' : parseRoute(window.location.hash)));
  const [moreOpen, setMoreOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [onboarded, setOnboarded] = useState(() => readFlag('allowance-onboarded'));
  const [eveSeed, setEveSeed] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState('loading');
  const [filter, setFilter] = useState('all');
  const [setupOpen, setSetupOpen] = useState(false);
  const [pathAlert, setPathAlert] = useState(false);
  const [detail, setDetail] = useState(null);
  const [approval, setApproval] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [runNote, setRunNote] = useState('');
  const [overCap, setOverCap] = useState(null);
  const [overCapBusy, setOverCapBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState('');
  const [announce, setAnnounce] = useState('');
  const [voiceOn, setVoiceOn] = useState(() => readVoiceEnabled());
  const [presenting, setPresenting] = useState(false);
  const demoBridge = useRef({ runHeist: null, runRogue: null });
  const [demoBusy, setDemoBusy] = useState({ heist: false, rogue: false });
  const syncDemoBusy = useCallback((next) => {
    setDemoBusy((current) => (
      current.heist === next.heist && current.rogue === next.rogue ? current : next
    ));
  }, []);
  const [flowOverride, setFlowOverride] = useState(null);
  const [flashId, setFlashId] = useState('');
  const [ringMood, setRingMood] = useState('');
  const seen = useRef(null);
  const moodTimer = useRef(0);

  async function load() {
    try {
      const next = await fetchSnapshot();
      setSnapshot(next);
      setConnection('online');
    } catch {
      setConnection('offline');
      setSnapshot((current) => (
        current && !current.offlinePreview
          ? current
          : { ...sampleSnapshot, offlinePreview: true }
      ));
    }
  }

  useEffect(() => {
    function onHash() {
      setRoute(parseRoute(window.location.hash));
      setMoreOpen(false);
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function go(id) {
    const next = routeHash(id);
    const current = window.location.hash;
    if (current === next || (id === 'home' && (current === '' || current === '#'))) setRoute('home');
    else window.location.hash = next;
    setMoreOpen(false);
  }

  function pushToast(text) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((list) => [...list.slice(-2), { id, text }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id));
    }, 4200);
  }

  function dismissOnboarding() {
    setOnboarded(true);
    try {
      localStorage.setItem('allowance-onboarded', '1');
    } catch {
      /* The card stays dismissed for this visit. */
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
      if (!snapshot) return;
      seen.current = new Set(ids);
      return;
    }
    const added = view.activity.filter((item) => !seen.current.has(item.id));
    for (const id of ids) seen.current.add(id);
    if (!added.length) return;
    const newest = added[0];
    const spoken = narrationFor(newest);
    const status = pill(newest).label;
    setAnnounce(spoken || `${status}. ${newest.task || 'Purchase'} for ${money(newest.amount)} RLUSD.`);
    setFlashId(newest.id);
    const kind = toneKind(newest);
    if (kind) pulseRing(kind === 'approve' ? 'ok' : 'block');
    if (voiceOn && spoken) {
      speakLine(spoken);
      playTone(kind);
    }
  }, [view.activity, voiceOn, snapshot]);

  useEffect(() => () => {
    window.clearTimeout(moodTimer.current);
    stopSpeech();
  }, []);

  useEffect(() => {
    function onFullscreen() {
      if (!document.fullscreenElement) setPresenting(false);
    }
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  function pulseRing(mood) {
    setRingMood(mood);
    window.clearTimeout(moodTimer.current);
    moodTimer.current = window.setTimeout(() => setRingMood(''), 700);
  }

  function toggleVoice() {
    setVoiceOn((current) => {
      const next = !current;
      writeVoiceEnabled(next);
      if (!next) stopSpeech();
      return next;
    });
  }

  async function togglePresent() {
    const next = !presenting;
    setPresenting(next);
    try {
      await setPresentation(next);
    } catch {
      /* Larger type still applies from the class on the page. */
    }
  }

  const onRogueBeat = useCallback((card) => {
    setPathAlert(true);
    if (card?.phase === 'summary') setAnnounce(card.attempt || '3 attempts, 3 blocked, 0 RLUSD lost');
    else if (card?.ruleText) setAnnounce(`Blocked. ${card.ruleText}`);
  }, []);

  const onHeist = useCallback((report) => {
    setPathAlert(true);
    setAnnounce(report?.scripted
      ? 'Scripted preview. Attack blocked. 0.00 RLUSD lost.'
      : 'Attack blocked. 0.00 RLUSD lost.');
    const flow = flowForHeist(report);
    if (flow) setFlowOverride(flow);
    if (!voiceOn) return;
    const line = narrationForHeist(report);
    if (!line) return;
    speakLine(line);
    playTone('block');
    setRingMood('block');
    window.clearTimeout(moodTimer.current);
    moodTimer.current = window.setTimeout(() => setRingMood(''), 700);
  }, [voiceOn]);

  async function decide(id) {
    setBusyId(id);
    setActionError('');
    try {
      await declinePurchase(id);
      pushToast('Declined. Nothing was paid.');
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
      const note = body.ok ? 'Agent started.' : (body.error || 'Add the wallet in .env to pay a merchant.');
      setRunNote(note);
      if (body.ok) pushToast('The agent started.');
    } catch (error) {
      setRunNote(error.message || 'Could not start the agent.');
    }
  }

  async function onFreeze() {
    setControlBusy('freeze');
    try {
      const nextFrozen = !snapshot?.frozen;
      await setAgentFrozen(nextFrozen);
      const line = nextFrozen ? 'Agent frozen. New signatures have stopped.' : 'Agent can pay inside the allowance again.';
      setAnnounce(line);
      pushToast(line);
      await load();
    } catch (error) {
      setRunNote(error.message || 'Could not change the freeze.');
    } finally {
      setControlBusy('');
    }
  }

  async function onUseCase(id) {
    if (snapshot?.offlinePreview) return;
    setControlBusy(id);
    try {
      await selectUseCase(id);
      await load();
    } catch (error) {
      setRunNote(error.message || 'Could not select that job.');
    } finally {
      setControlBusy('');
    }
  }

  function exportAudit() {
    const rows = Array.isArray(snapshot?.audit) ? snapshot.audit : [];
    const blob = new Blob([`${JSON.stringify(rows, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'allowance-audit.json';
    link.click();
    URL.revokeObjectURL(url);
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

  const shown = view.activity;
  const latest = view.activity.slice(0, 3);
  const leftRatio = view.budgetNumber > 0 ? Math.max(0, view.leftNumber / view.budgetNumber) : 0;
  const merchantCount = snapshot?.rules?.allowedMerchants?.length ?? 0;
  const balanceLabel = `${money(view.spent)} of ${money(view.budget)} RLUSD spent. ${money(view.left)} RLUSD left.`;
  const liveFlow = flowOverride || flowForItem(view.activity[0]);
  const feed = txFeed(view.payments, snapshot?.network?.explorerUrl);

  const loading = connection === 'loading' && !snapshot;
  const appClass = ['app', presenting ? 'is-present' : '', loading ? 'is-loading' : '', snapshot?.frozen ? 'is-frozen' : ''].filter(Boolean).join(' ');
  const pendingCount = approvalCount(view.pending);
  const routeItem = NAV.find((item) => item.id === route);
  const pageLede = route === 'approvals'
    ? (pendingCount === 0 ? 'Nothing is waiting.' : `${pendingCount} waiting for a person.`)
    : routeItem?.lede;
  const setupLabel = onboarded ? 'Edit allowance' : 'Set up allowance';

  function onTabKey(event) {
    const ids = ACTIVITY_VIEWS.map(([id]) => id);
    const at = ids.indexOf(filter);
    const next = event.key === 'ArrowRight' ? ids[(at + 1) % ids.length]
      : event.key === 'ArrowLeft' ? ids[(at - 1 + ids.length) % ids.length]
        : event.key === 'Home' ? ids[0]
          : event.key === 'End' ? ids[ids.length - 1]
            : null;
    if (!next) return;
    event.preventDefault();
    setFilter(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return (
    <div className={appClass}>
      <a className="skip" href="#main">Skip to content</a>
      <div className="sr-only" aria-live="polite">{announce}</div>
      <aside className="sidenav">
        <div className="sidenav-brand">
          <BrandMark size={40} />
          <p className="brand-name">Agent Allowance</p>
        </div>
        <nav className="sidenav-nav" aria-label="Primary">
          {navSections().map((section) => (
            <div key={section.label} className="sidenav-section">
              <p className="sidenav-label">{section.label}</p>
              {section.items.map((item) => {
                const Icon = ICONS[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={route === item.id ? 'page' : undefined}
                    onClick={() => go(item.id)}
                  >
                    <Icon />
                    <span>{item.label}</span>
                    {item.id === 'approvals' && pendingCount > 0 ? (
                      <span className="nav-count">{pendingCount}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <nav className="sidenav-links" aria-label="Settings and help">
          {NAV.filter((item) => item.id === 'settings' || item.id === 'help').map((item) => {
            const Icon = ICONS[item.id];
            return (
              <button key={item.id} type="button" onClick={() => go(item.id)} aria-current={route === item.id ? 'page' : undefined}>
                <Icon />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidenav-foot">
          <p className="side-balance"><strong>{money(view.left)}</strong> of {money(view.budget)} RLUSD left</p>
          <p className={snapshot?.frozen ? 'side-status is-frozen' : 'side-status'}>
            <span className="side-dot" aria-hidden="true" />
            {snapshot?.frozen ? 'Agent frozen. Nothing can be signed.' : 'Agent can pay inside the rules'}
          </p>
          <p className="meta">{snapshot?.simulatedLedger ? 'Exceptions use the demo signer' : 'Exceptions need your Ledger'}</p>
        </div>
      </aside>

      <div className="frame">
        <div className="shell">
          <header className="top">
            <div className="brand-lockup">
              <div className="brand">
                <BrandMark size={32} />
                <p className="brand-name">Agent Allowance</p>
              </div>
            </div>
            <div className="top-tools">
              <button
                type="button"
                className={snapshot?.frozen ? 'chip is-on freeze-toggle' : 'chip freeze-toggle'}
                aria-pressed={Boolean(snapshot?.frozen)}
                onClick={onFreeze}
                disabled={!snapshot || controlBusy === 'freeze' || snapshot.offlinePreview}
                title={snapshot?.offlinePreview ? 'Freeze works when the allowance is online.' : undefined}
              >
                <IconLock />
                <span>{snapshot?.frozen ? 'Frozen' : 'Freeze'}</span>
              </button>
              <button type="button" className="chip setup-chip" onClick={() => setSetupOpen(true)}>{setupLabel}</button>
              {route === 'home' && snapshot && !presenting ? (
                <DemoMenu
                  onOverCap={onOverCap}
                  onHeist={() => demoBridge.current.runHeist?.()}
                  onRogue={() => demoBridge.current.runRogue?.()}
                  onPresent={togglePresent}
                  overCapBusy={overCapBusy}
                  heistBusy={demoBusy.heist}
                  rogueBusy={demoBusy.rogue}
                />
              ) : null}
              {presenting ? (
                <button type="button" className="chip is-on present-toggle" aria-pressed="true" onClick={togglePresent}>
                  Exit presentation
                </button>
              ) : null}
              <ThemeControl theme={theme} setTheme={setTheme} />
              {!presenting ? (
                <AppMenu
                  frozen={Boolean(snapshot?.frozen)}
                  freezeDisabled={!snapshot || controlBusy === 'freeze' || Boolean(snapshot?.offlinePreview)}
                  onFreeze={onFreeze}
                  setupLabel={setupLabel}
                  onSetup={() => setSetupOpen(true)}
                  demo={route === 'home' && snapshot ? {
                    onOverCap,
                    onHeist: () => demoBridge.current.runHeist?.(),
                    onRogue: () => demoBridge.current.runRogue?.(),
                    onPresent: togglePresent,
                  } : null}
                />
              ) : null}
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            {loading ? <Skeletons /> : null}
            {route === 'home' ? (
              <div className="page-head is-home">
                <h1 className="sr-only">Home</h1>
                <p className="hero-tagline">Spending power for AI, with a human key.</p>
              </div>
            ) : (
              <div className="page-head">
                <h1 id="page-title">{routeItem?.label}</h1>
                {pageLede ? <p>{pageLede}</p> : null}
              </div>
            )}
            {view.demo ? (
              <div className="demo-badge" role="status">
                <span className="demo-tag">Demo</span>
                <span className="demo-text">
                  {snapshot?.offlinePreview
                    ? 'Example rows while offline.'
                    : 'Example rows until the agent pays.'}
                </span>
                {snapshot?.offlinePreview ? (
                  <button type="button" className="retry-pill" onClick={load}>Try again</button>
                ) : null}
              </div>
            ) : null}
            {snapshot && route === 'home' ? (
              <HeistDemo onDone={load} onResult={onHeist}>
                {({ stage: heistStage, run: runHeist, busy: heistBusy }) => (
              <RogueDemo onBeat={onRogueBeat}>
                {({ stage: rogueStage, run: runRogue, busy: rogueBusy }) => (
              <>
              <DemoBridge
                bridge={demoBridge}
                onBusy={syncDemoBusy}
                runHeist={runHeist}
                runRogue={runRogue}
                heistBusy={heistBusy}
                rogueBusy={rogueBusy}
              />
              <div className="home-grid">
                <div className="home-main">
                {!onboarded && !presenting ? (
                  <section className="card setup-card" aria-labelledby="setup-title">
                    <h2 id="setup-title">Set up this allowance</h2>
                    <p>The budget, the cap, and the merchant list are already in place. Review them before the agent pays.</p>
                    <div className="how-actions">
                      <button type="button" className="btn primary" onClick={() => { dismissOnboarding(); go('rules'); }}>Review rules</button>
                      <button type="button" className="btn" onClick={dismissOnboarding}>Not now</button>
                    </div>
                  </section>
                ) : null}
                {snapshot.frozen ? <p className="freeze-banner" role="status">Agent frozen. New signatures have stopped.</p> : null}
                {connection === 'offline' && !snapshot.offlinePreview ? (
                  <div className="state-error" role="alert">
                    <p className="state-error-title">Could not refresh</p>
                    <p>Showing the last numbers.</p>
                    <button type="button" className="btn" onClick={load}>Retry</button>
                  </div>
                ) : null}
                <section className="card hero" aria-labelledby="allowance-title">
                  <div className="hero-main">
                    <div className="hero-copy">
                      <h2 id="allowance-title" className="eyebrow">Left to spend</h2>
                      <p className="figure">
                        <CountUp value={view.leftNumber} />
                        <span className="unit">RLUSD</span>
                      </p>
                      <p className="meter-caption">
                        {money(view.spent)} of {money(view.budget)} RLUSD spent
                      </p>
                    </div>
                    <SpendRing ratio={leftRatio} label={`${Math.round(leftRatio * 100)} percent left. ${balanceLabel}`} mood={ringMood} />
                  </div>
                  {view.chainWarning ? (
                    <p className="chain-chip is-warn">Check reconciliation</p>
                  ) : view.chainRedeemed != null ? (
                    <p className="chain-chip">Matches on-chain</p>
                  ) : null}
                  <ul className="rule-chips">
                    <li>Per purchase {money(snapshot.rules.maxPerPurchase)} RLUSD</li>
                    <li>Expires {expiresOn(snapshot.rules.expiresAt) || 'No date'}</li>
                    <li>{merchantCount} merchants</li>
                  </ul>
                  <MoneyFlow flow={liveFlow} embedded alert={pathAlert} />
                  <div className="hero-actions">
                    <button type="button" className="btn primary" onClick={onRun}>Run agent</button>
                    {runNote ? <p className="note" role="status">{runNote}</p> : null}
                  </div>
                </section>

                <section className="card needs-card" aria-labelledby="needs-title">
                    <h2 id="needs-title">Needs you</h2>
                    {view.pending.length === 0 ? (
                      <EmptyState icon={<IconCheck />} title="All clear. Nothing needs you." />
                    ) : (
                      <ul className="needs">
                        {[...view.pending].sort((a, b) => Number(cannotApprove(a)) - Number(cannotApprove(b))).map((item) => (
                          <li key={item.id} className={cannotApprove(item) ? 'need is-neutral' : 'need'}>
                            <div className="need-top">
                              <span className="avatar" aria-hidden="true">{initial(item.merchantLabel)}</span>
                              <h3>{item.merchantLabel || 'Merchant'}</h3>
                              <p className="amount">{money(item.amount)} RLUSD</p>
                            </div>
                            {cannotApprove(item) ? (
                              <p className="need-lock"><IconLock /> Not on your merchant list. Can't be approved.</p>
                            ) : (
                              <>
                                <p className="reason-chip">{reasonChip(item, snapshot.rules.maxPerPurchase)}</p>
                                <JevCard jev={item.jev} merchant={item.merchantLabel} />
                                {snapshot.frozen && !item.sample && !snapshot.offlinePreview ? (
                                  <p className="meta">Agent frozen</p>
                                ) : (
                                  <button type="button" className="btn primary need-approve" onClick={() => setApproval(item)}>
                                    Approve with Ledger
                                  </button>
                                )}
                                <button type="button" className="btn text" disabled={busyId === item.id || item.sample || snapshot.offlinePreview} onClick={() => decide(item.id)}>
                                  Decline
                                </button>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {overCap?.error ? (
                      <div className="state-error" role="alert">
                        <p className="state-error-title">The over-cap demo did not finish</p>
                        <p>{overCap.error}</p>
                        <button type="button" className="btn" onClick={onOverCap}>Retry</button>
                      </div>
                    ) : null}
                    {actionError ? (
                      <div className="state-error" role="alert">
                        <p className="state-error-title">That did not finish</p>
                        <p>{actionError}</p>
                      </div>
                    ) : null}
                  </section>
                </div>
                <div className="home-side">
                  <div className="heist-stage">{heistStage}{rogueStage}</div>
                  <section className="card activity-card" aria-labelledby="latest-title">
                    <h2 id="latest-title">Latest activity</h2>
                    <ActivityList
                      items={latest}
                      flashId={flashId}
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
              </>
                )}
              </RogueDemo>
                )}
              </HeistDemo>
            ) : null}

            {snapshot && route === 'approvals' ? (
              <section className="card needs-card" aria-labelledby="page-title">
                {view.pending.length === 0 ? (
                  <EmptyState icon={<IconCheck />} title="All clear. Nothing needs you." />
                ) : (
                  <ul className="needs">
                    {view.pending.map((item) => (
                      <li key={item.id} className={cannotApprove(item) ? 'need is-neutral' : 'need'}>
                        <div className="need-top">
                          <span className="avatar" aria-hidden="true">{initial(item.merchantLabel)}</span>
                          <h3>{item.merchantLabel || 'Merchant'}</h3>
                          <p className="amount">{money(item.amount)} RLUSD</p>
                        </div>
                        {cannotApprove(item) ? null : <p className="reason-chip">{reasonChip(item, snapshot.rules?.maxPerPurchase)}</p>}
                        {cannotApprove(item) ? (
                          <p className="need-lock"><IconLock /> Not on your merchant list. Can't be approved.</p>
                        ) : (
                          <button type="button" className="btn primary need-approve" onClick={() => setApproval(item)}>
                            Approve with Ledger
                          </button>
                        )}
                        <button type="button" className="btn text" disabled={busyId === item.id || item.sample || snapshot.offlinePreview} onClick={() => decide(item.id)}>
                          Decline
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {snapshot && route === 'activity' ? (
              <section className="card" aria-labelledby="page-title">
                <div className="filters" role="tablist" aria-label="Activity views" onKeyDown={onTabKey}>
                  {ACTIVITY_VIEWS.map(([id, label]) => (
                    <button
                      key={id}
                      id={`tab-${id}`}
                      type="button"
                      role="tab"
                      className={filter === id ? 'chip is-on' : 'chip'}
                      aria-selected={filter === id}
                      aria-controls="activity-panel"
                      tabIndex={filter === id ? 0 : -1}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div id="activity-panel" role="tabpanel" aria-labelledby={`tab-${filter}`} tabIndex={0} className="tab-panel">
                {filter === 'audit' ? <AuditCard rows={snapshot.audit} onExport={exportAudit} /> : null}
                {filter === 'chain' ? (feed.length ? <TxFeed rows={feed} /> : <p className="meta">Explorer links appear when a transaction hash is recorded.</p>) : null}
                {filter === 'all' ? (
                <ActivityList
                  items={shown}
                  flashId={flashId}
                  onOpen={setDetail}
                  empty={(
                    <EmptyState
                      icon={<IconReceipt />}
                      title="No payments yet"
                      action={<button type="button" className="btn" onClick={onRun}>Run agent</button>}
                    >
                      Run the agent, or ask Eve what to do next.
                    </EmptyState>
                  )}
                />
                ) : null}
                </div>
              </section>
            ) : null}

            {snapshot && route !== 'home' && route !== 'activity' && route !== 'approvals' ? (
              <Suspense fallback={<section className="card skeleton" aria-busy="true" aria-label="Loading this page" />}>
                <Desk
                  route={route}
                  snapshot={snapshot}
                  view={view}
                  theme={theme}
                  voiceOn={voiceOn}
                  onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  onVoice={() => {
                    const next = !voiceOn;
                    setVoiceOn(next);
                    writeVoiceEnabled(next);
                  }}
                  onAsk={(text) => setEveSeed({ text, id: Date.now() })}
                  onSetup={() => setSetupOpen(true)}
                  onFreeze={onFreeze}
                  busy={controlBusy === 'freeze'}
                  disabled={!snapshot || controlBusy === 'freeze' || snapshot.offlinePreview}
                />
              </Suspense>
            ) : null}

          </main>
        </div>

        <nav className="tabbar" aria-label="Mobile sections">
          <div className="tabbar-inner">
            {mobileTabs().map((item) => {
              const Icon = ICONS[item.id];
              const current = item.id === 'more' ? moreOpen || moreItems().some((entry) => entry.id === route) : route === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={current ? 'page' : undefined}
                  aria-expanded={item.id === 'more' ? moreOpen : undefined}
                  onClick={() => (item.id === 'more' ? setMoreOpen((open) => !open) : go(item.id))}
                >
                  <Icon />
                  <span>{item.label}</span>
                  {item.id === 'approvals' && pendingCount > 0 ? <span className="nav-count">{pendingCount}</span> : null}
                </button>
              );
            })}
          </div>
        </nav>
        {moreOpen ? (
          <div className="more-sheet" role="dialog" aria-label="More">
            {moreItems().map((item) => {
              const Icon = ICONS[item.id];
              return (
                <button key={item.id} type="button" onClick={() => go(item.id)} aria-current={route === item.id ? 'page' : undefined}>
                  <Icon />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="toasts" aria-live="polite">
          {toasts.map((item) => <p key={item.id} className="toast" role="status">{item.text}</p>)}
        </div>
      </div>

      <EveDock seed={eveSeed} onSeedHandled={() => setEveSeed(null)} presenting={presenting} />
      {approval ? (
        <Sheet variant="ceremony" title={`Approve ${money(approval.amount)} RLUSD`} onClose={() => setApproval(null)}>
          <LedgerApproval
            item={approval}
            onPaid={load}
            preview={Boolean(approval.sample || snapshot?.offlinePreview)}
            expiresAt={snapshot?.rules?.expiresAt || ''}
            simulated={Boolean(snapshot?.simulatedLedger) && !approval.sample && !snapshot?.offlinePreview}
          />
        </Sheet>
      ) : null}
      {detail ? (
        <Sheet title={detail.task || 'Purchase'} onClose={() => setDetail(null)}>
          <Detail item={detail} currency={snapshot?.currency || 'RLUSD'} />
        </Sheet>
      ) : null}
      {setupOpen ? (
        <Sheet title={setupLabel} onClose={() => setSetupOpen(false)}>
          <UseCaseCard
            selected={snapshot?.useCase?.id}
            busy={controlBusy}
            disabled={Boolean(snapshot?.offlinePreview)}
            onSelect={onUseCase}
          />
          {snapshot ? <HowItWorks snapshot={snapshot} onChange={load} /> : null}
          <details className="device-more">
            <summary>Technical details</summary>
            <p>{snapshot?.network?.name || 'XRPL EVM Testnet'}. Chain {snapshot?.network?.chainId || '1449000'}.</p>
            {snapshot?.simulatedLedger ? <p>Backup demo only. simulated Ledger signature. This is not a Ledger device.</p> : null}
          </details>
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
        <IconContrast />
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

function SpendRing({ ratio, label, mood = '' }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, ratio));
  const percent = Math.round(clamped * 100);
  const angle = clamped * Math.PI * 2;
  const dotX = 60 + radius * Math.cos(angle);
  const dotY = 60 + radius * Math.sin(angle);
  return (
    <div
      className={mood ? `ring is-${mood}` : 'ring'}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="ring-track" cx="60" cy="60" r={radius} />
        <circle
          className="ring-value"
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={`${circumference * clamped} ${circumference}`}
        />
        {clamped > 0 ? <circle className="ring-dot" cx={dotX} cy={dotY} r="6" /> : null}
      </svg>
      <div className="ring-label" aria-hidden="true">
        <strong>{percent}%</strong>
        <span>left</span>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  return (
    <span className={`pill ${status.tone}`}>
      {status.tone === 'danger' ? <IconAlert size={14} /> : status.tone === 'warn' ? <IconAlert size={14} /> : <IconCheck size={14} />}
      {status.label}
    </span>
  );
}

function DemoBridge({ bridge, onBusy, runHeist, runRogue, heistBusy, rogueBusy }) {
  bridge.current.runHeist = runHeist;
  bridge.current.runRogue = runRogue;
  useEffect(() => {
    onBusy({ heist: heistBusy, rogue: rogueBusy });
  }, [heistBusy, rogueBusy, onBusy]);
  return null;
}

function DemoMenu({ onOverCap, onHeist, onRogue, onPresent, overCapBusy, heistBusy, rogueBusy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);
  return (
    <div className="demo-menu" ref={ref}>
      <button type="button" className="chip" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
        Demo
      </button>
      {open ? (
        <div className="demo-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onOverCap(); }} disabled={overCapBusy}>
            {overCapBusy ? 'Checking the cap…' : 'Try an over-cap purchase'}
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onHeist(); }} disabled={heistBusy}>
            {heistBusy ? 'Showing the blocked prompt…' : 'Show a blocked prompt'}
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onRogue(); }} disabled={rogueBusy}>
            {rogueBusy ? 'Running the three blocks…' : 'Run the three blocks'}
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onPresent(); }}>
            Present
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AppMenu({ frozen, freezeDisabled, onFreeze, setupLabel, onSetup, demo }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    ref.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    function onDoc(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  function pick(action) {
    setOpen(false);
    action();
  }
  return (
    <div className="app-menu" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-label="Allowance actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMore />
      </button>
      {open ? (
        <div className="demo-pop" role="menu" id={menuId} aria-label="Allowance actions">
          <button type="button" role="menuitem" onClick={() => pick(onFreeze)} disabled={freezeDisabled}>
            <IconLock size={18} />
            <span>{frozen ? 'Unfreeze the agent' : 'Freeze the agent'}</span>
          </button>
          {freezeDisabled ? <p className="menu-note">Freeze works when the allowance is online.</p> : null}
          <button type="button" role="menuitem" onClick={() => pick(onSetup)}>
            <IconSliders size={18} />
            <span>{setupLabel}</span>
          </button>
          {demo ? (
            <>
              <p className="menu-label">Demo</p>
              <button type="button" role="menuitem" onClick={() => pick(demo.onOverCap)}>Try an over-cap purchase</button>
              <button type="button" role="menuitem" onClick={() => pick(demo.onHeist)}>Show a blocked prompt</button>
              <button type="button" role="menuitem" onClick={() => pick(demo.onRogue)}>Run the three blocks</button>
              <button type="button" role="menuitem" onClick={() => pick(demo.onPresent)}>Present</button>
            </>
          ) : null}
        </div>
      ) : null}
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
        <div>
          <dt>AP4M channel</dt>
          <dd>{item.sample ? 'Example' : item.channelId ? <code>{item.channelId}</code> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>AP4M claim</dt>
          <dd>{item.sample ? 'Example' : item.claimId ? <code>{item.claimId}</code> : 'Not recorded'}</dd>
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

function ActivityList({ items, onOpen, empty, flashId = '' }) {
  if (!items.length) return empty;
  return (
    <ul className="activity">
      {items.map((item) => {
        const status = pill(item);
        return (
          <li key={item.id}>
            <button
                type="button"
                className={flashId === item.id ? 'row is-flash' : 'row'}
                aria-label={`${item.merchantLabel || 'Merchant'}, ${money(item.amount)} RLUSD, ${status.label}, ${when(item.createdAt)}`}
                onClick={() => onOpen(item)}
              >
              <span className="row-line">
                <span className="avatar" aria-hidden="true">{initial(item.merchantLabel)}</span>
                <span className="row-title">{item.merchantLabel || 'Merchant'}</span>
                <span className="amount">{money(item.amount)} RLUSD</span>
              </span>
              <span className="row-line row-sub">
                <span className="row-task">{item.task || 'Purchase'}</span>
                <span className="row-time" title={when(item.createdAt)}>{relativeTime(item.createdAt)}</span>
                {item.plan?.source === 'bedrock' ? <span className="bedrock-tag">Bedrock</span> : null}
              </span>
              <StatusPill status={status} />
            </button>
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
      {item.sample ? <p>Example row</p> : null}
      {item.sample || item.status !== 'paid' ? (
        <p className="figure">{money(item.amount)} <span className="unit">{currency}</span></p>
      ) : (
        <ReceiptCard item={item} explorer={EXPLORER} />
      )}
      <p className="detail-name">{name}</p>
      {item.sample ? null : <p className="meta"><code>{item.merchant}</code></p>}
      <p className="meta">{when(item.createdAt)}</p>
      {item.simulatedLedger ? <p className="sim-label">simulated Ledger signature</p> : null}
      {item.reason ? <p>{plainReason(item.reason)}</p> : null}
      {planLabel(item.plan) ? (
        <div className="plan">
          <h3>Purchase plan</h3>
          <p className="fallback-label">{planLabel(item.plan)}</p>
          {planDetail(item.plan) ? <p>{planDetail(item.plan)}</p> : null}
          {item.plan.source === 'bedrock' ? <BedrockMark /> : null}
        </div>
      ) : null}
      <h3>Rule checks</h3>
      <ul className="checks">
        {ruleRows(item).map((row) => (
          <li key={row.label} className={row.state}>
            <span className={`check-icon is-${row.state}`} aria-hidden="true">
              {row.state === 'fail' ? <IconAlert size={16} /> : <IconCheck size={16} />}
            </span>
            <span>{row.text}</span>
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
      <JevCard jev={item.jev} merchant={name} />
      {item.sample ? null : (
      <details className="device-more">
        <summary>Technical details</summary>
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
          <dt>AP4M channel</dt>
          <dd>{item.channelId ? <code>{item.channelId}</code> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Settlement</dt>
          <dd>{settlementLabel(item.settlementStatus)}</dd>
        </div>
        <div>
          <dt>AP4M claim</dt>
          <dd>{item.claimId ? <code>{item.claimId}</code> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Receipt</dt>
          <dd>{item.receiptUrl ? <a href={item.receiptUrl} target="_blank" rel="noreferrer noopener">View receipt</a> : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Explorer</dt>
          <dd>{item.explorerUrl ? <a className="explorer" href={item.explorerUrl} target="_blank" rel="noreferrer noopener">Explorer</a> : 'Not recorded'}</dd>
        </div>
      </dl>
      </details>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children, variant = 'sheet' }) {
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
        className={variant === 'ceremony' ? 'sheet ceremony-modal' : 'sheet'}
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
    <div className="loading-splash" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading the allowance</p>
      <div className="loading-brand">
        <BrandMark size={64} />
        <p className="brand-name">Agent Allowance</p>
      </div>
      <div className="stack loading-skeleton">
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
    </div>
  );
}
