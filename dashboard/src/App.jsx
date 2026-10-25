import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { allowanceView } from './allowance.js';
import { declinePurchase, fetchHealth, fetchSnapshot, resetDemo, runAgent, runOverCap, sampleSnapshot, selectUseCase, setAgentFrozen, subscribeEvents } from './api.js';
import { backoffDelay, describeConnection, failureKind } from './connection.js';
import { freezeControl, freezeNotice, freezeResult } from './freeze.js';
import { handleMenuKey } from './menuKeys.js';
import { daysLabel, daysLeft, outcomeCounts, spendByMerchant } from './insights.js';
import BedrockMark from './BedrockMark.jsx';
import BrandMark from './BrandMark.jsx';
import LedgerApproval from './LedgerApproval.jsx';
import CountUp from './CountUp.jsx';
import { EveDock } from './EvePanel.jsx';
import HeistDemo from './HeistDemo.jsx';
import HowItWorks from './HowItWorks.jsx';
import RogueDemo from './RogueDemo.jsx';
import { PATH_IDLE, flowForHeist, flowForItem, narrationFor, pathReducer, narrationForHeist, toneKind, txFeed } from './present.js';
import { MoneyFlow, TxFeed } from './Stage.jsx';
import { playTone, readVoiceEnabled, setPresentation, speakLine, stopSpeech, writeVoiceEnabled } from './stage.js';
import {
  IconActivity,
  EveMark,
  IconAlert,
  IconCheck,
  IconHome,
  IconLock,
  IconUnlock,
  IconReceipt,
  IconBadgeCheck,
  IconBot,
  IconContrast,
  IconGear,
  IconHelp,
  IconMore,
  IconMoreVertical,
  IconShieldCheck,
  IconSliders,
  IconStore,
} from './icons.jsx';
import JevCard from './JevCard.jsx';
import HistoryView from './HistoryView.jsx';
import Onboarding, { readIntroDone } from './Onboarding.jsx';
import ApprovalWhy from './ApprovalWhy.jsx';
import { explainApproval } from './approvalWhy.js';
import { EMPTY_FILTERS, downloadCsv, filterHistory, normalizeFilters } from './history.js';
import { ActivityList, EmptyState, StatusPill, cannotApprove, initial, pill, planDetail, planLabel, reasonChip } from './rows.jsx';
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
  ['all', 'History'],
  ['audit', 'Audit trail'],
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
  const [link, setLink] = useState({ kind: '', lastOkAt: 0, retryAt: 0 });
  const [health, setHealth] = useState(null);
  const [, setClockTick] = useState(0);
  const failures = useRef(0);
  const reconnect = useRef(null);
  const [filter, setFilter] = useState('all');
  const [historyFilters, setHistoryFilters] = useState(EMPTY_FILTERS);
  const [editorSeed, setEditorSeed] = useState(null);
  const [intro, setIntro] = useState(null);
  const introChecked = useRef(false);
  const [detail, setDetail] = useState(null);
  const [approval, setApproval] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [runNote, setRunNote] = useState('');
  const [overCap, setOverCap] = useState(null);
  const [overCapBusy, setOverCapBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState('');
  const [freezePhase, setFreezePhase] = useState('');
  const [freezeError, setFreezeError] = useState('');
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
  const [path, dispatchPath] = useReducer(pathReducer, PATH_IDLE);
  const streamOpen = useRef(false);
  const [flashId, setFlashId] = useState('');
  const [ringMood, setRingMood] = useState('');
  const seen = useRef(null);
  const moodTimer = useRef(0);

  async function load() {
    try {
      const next = await fetchSnapshot();
      const recovered = failures.current > 0;
      failures.current = 0;
      setSnapshot(next);
      setConnection('online');
      setLink({ kind: '', lastOkAt: Date.now(), retryAt: 0 });
      if (recovered) {
        fetchHealth().then(setHealth);
        reconnect.current?.();
      }
      return true;
    } catch (error) {
      failures.current += 1;
      setConnection('offline');
      setLink((current) => ({
        ...current,
        kind: failureKind(error),
        retryAt: Date.now() + backoffDelay(failures.current - 1, { base: 3000, max: 30_000 }),
      }));
      setSnapshot((current) => (
        current && !current.offlinePreview
          ? current
          : { ...sampleSnapshot, offlinePreview: true }
      ));
      return false;
    }
  }

  function retryNow() {
    reconnect.current?.();
    fetchHealth().then(setHealth);
    return load();
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
    let timer = 0;
    // The event stream drives updates while it is open. Polling is the fallback:
    // every 3s while the API answers, backing off to 30s while it does not.
    const schedule = (ok) => {
      if (stop) return;
      const wait = ok ? 3000 : backoffDelay(failures.current - 1, { base: 3000, max: 30_000 });
      timer = window.setTimeout(tick, wait);
    };
    const tick = async () => {
      if (stop) return;
      if (streamOpen.current && failures.current === 0) return schedule(true);
      schedule(await load());
    };
    load().then(schedule);
    fetchHealth().then((body) => { if (!stop) setHealth(body); });
    const healthTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchHealth().then((body) => { if (!stop) setHealth(body); });
    }, 30_000);
    const onOnline = () => {
      reconnect.current?.();
      load();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && failures.current > 0) onOnline();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const close = subscribeEvents({
      onOpen: () => {
        streamOpen.current = true;
      },
      onDown: () => {
        streamOpen.current = false;
      },
      onChange: () => {
        if (!stop) load();
      },
      onStage: (stage) => {
        if (!stop) dispatchPath({ type: 'stage', stage });
      },
    });
    reconnect.current = close.reconnect;
    return () => {
      stop = true;
      window.clearTimeout(timer);
      window.clearInterval(healthTimer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      close();
    };
  }, []);

  // First run: once the allowance answers (or the offline preview loads), show the intro
  // unless this browser finished or skipped it, or setup already finished on the server.
  useEffect(() => {
    if (!snapshot || introChecked.current) return;
    introChecked.current = true;
    if (readIntroDone() == null && !snapshot.profile?.onboardedAt) setIntro('intro');
  }, [snapshot]);

  useEffect(() => {
    const openIntro = () => setIntro('intro');
    const openSetup = () => setIntro('setup');
    window.addEventListener('intro:open', openIntro);
    window.addEventListener('setup:open', openSetup);
    return () => {
      window.removeEventListener('intro:open', openIntro);
      window.removeEventListener('setup:open', openSetup);
    };
  }, []);

  // While offline, re-render once a second so "Trying again in 8 seconds" counts down.
  useEffect(() => {
    if (connection !== 'offline') return undefined;
    const ticker = window.setInterval(() => setClockTick((value) => value + 1), 1000);
    return () => window.clearInterval(ticker);
  }, [connection]);

  const view = useMemo(() => allowanceView(snapshot), [snapshot]);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Eve's UI steps. Each one only changes what is on screen; saving, signing,
  // and approving stay with the person.
  useEffect(() => {
    function onEveUi(event) {
      const ui = event.detail || {};
      const rows = viewRef.current.activity;
      if (ui.type === 'navigate') go(ui.route);
      if (ui.type === 'filter') {
        setHistoryFilters(normalizeFilters(ui.filters));
        setFilter('all');
        go('activity');
      }
      if (ui.type === 'export') {
        const shownRows = filterHistory(rows, ui.filters);
        const name = downloadCsv(shownRows);
        pushToast(`Eve saved ${shownRows.length} row${shownRows.length === 1 ? '' : 's'} to ${name}.`);
      }
      if (ui.type === 'highlight') {
        setHistoryFilters(EMPTY_FILTERS);
        setFilter('all');
        go('activity');
        setFlashId(ui.id);
        window.setTimeout(() => {
          document.querySelector(`[data-row-id="${CSS.escape(String(ui.id))}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 80);
      }
      if (ui.type === 'edit') {
        setEditorSeed({ ...(ui.seed || {}) });
        go('rules');
      }
      if (ui.type === 'review') {
        const item = viewRef.current.pending.find((row) => row.id === ui.id);
        go('approvals');
        if (item) setApproval(item);
      }
    }
    function onChanged() {
      load();
    }
    window.addEventListener('eve:ui', onEveUi);
    window.addEventListener('allowance:changed', onChanged);
    return () => {
      window.removeEventListener('eve:ui', onEveUi);
      window.removeEventListener('allowance:changed', onChanged);
    };
  }, []);

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
    // A real decision replaces whatever a demo or a live stage left on the payment path.
    dispatchPath({ type: 'activity' });
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
    dispatchPath({ type: 'alert' });
    if (card?.phase === 'summary') setAnnounce(card.attempt || '3 attempts, 3 blocked, 0 RLUSD lost');
    else if (card?.ruleText) setAnnounce(`Blocked. ${card.ruleText}`);
  }, []);

  const onHeist = useCallback((report) => {
    setAnnounce(report?.scripted
      ? 'Scripted preview. Attack blocked. 0.00 RLUSD lost.'
      : 'Attack blocked. 0.00 RLUSD lost.');
    dispatchPath({ type: 'demo', flow: flowForHeist(report) });
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
      const note = body.simulated ? body.line : body.ok ? 'Agent started.' : (body.error || 'Add the wallet in .env to pay a merchant.');
      setRunNote(note);
      if (body.ok) pushToast(body.simulated ? body.line : 'The agent started.');
      if (body.simulated) load();
    } catch (error) {
      setRunNote(error.message || 'Could not start the agent.');
    }
  }

  async function onFreeze(target) {
    if (freezePhase || !snapshot || snapshot.offlinePreview) return;
    const nextFrozen = typeof target === 'boolean' ? target : !snapshot.frozen;
    const before = { frozen: snapshot.frozen, frozenAt: snapshot.frozenAt, channelClosed: snapshot.channelClosed, freezeDetail: snapshot.freezeDetail };
    setFreezeError('');
    setFreezePhase(nextFrozen ? 'freezing' : 'unfreezing');
    setControlBusy('freeze');
    // Show the new state at once. The server answer, or a revert, follows.
    setSnapshot((current) => (current ? {
      ...current,
      frozen: nextFrozen,
      frozenAt: nextFrozen ? new Date().toISOString() : null,
      ...(nextFrozen ? {} : { channelClosed: false, freezeDetail: null }),
    } : current));
    try {
      const body = await setAgentFrozen(nextFrozen);
      setSnapshot((current) => (current ? {
        ...current,
        frozen: Boolean(body.frozen ?? nextFrozen),
        frozenAt: body.frozenAt ?? current.frozenAt,
        channelClosed: Boolean(body.channelClosed),
        freezeDetail: body.channelReason ?? null,
      } : current));
      const line = freezeResult(nextFrozen, body);
      setAnnounce(line);
      pushToast(line);
      load();
    } catch (error) {
      // A freeze that timed out may still have stopped signing. Ask the server what is true.
      setSnapshot((current) => (current ? { ...current, ...before } : current));
      setFreezeError(error.message || (nextFrozen ? 'Could not freeze the agent.' : 'Could not unfreeze the agent.'));
      load();
    } finally {
      setFreezePhase('');
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
  const latest = view.activity.slice(0, 6);
  const breakdown = useMemo(() => spendByMerchant(view.payments), [view.payments]);
  const counts = outcomeCounts(view.activity);
  const whyContext = {
    cap: snapshot?.rules?.maxPerPurchase,
    budget: view.budget,
    spent: view.spent,
    expiresAt: snapshot?.rules?.expiresAt,
  };
  const leftRatio = view.budgetNumber > 0 ? Math.max(0, view.leftNumber / view.budgetNumber) : 0;
  const merchantCount = snapshot?.rules?.allowedMerchants?.length ?? 0;
  const balanceLabel = `${money(view.spent)} of ${money(view.budget)} RLUSD spent. ${money(view.left)} RLUSD left.`;
  const liveFlow = path.flow || flowForItem(view.activity[0]);
  const feed = txFeed(view.payments, snapshot?.network?.explorerUrl);

  const loading = connection === 'loading' && !snapshot;
  const banner = describeConnection({
    connection,
    preview: Boolean(snapshot?.offlinePreview),
    kind: link.kind,
    lastOkAt: link.lastOkAt,
    retryInMs: link.retryAt ? Math.max(0, link.retryAt - Date.now()) : 0,
    health,
    now: Date.now(),
  });
  const appClass = ['app', presenting ? 'is-present' : '', loading ? 'is-loading' : '', snapshot?.frozen ? 'is-frozen' : ''].filter(Boolean).join(' ');
  const pendingCount = approvalCount(view.pending);
  const freeze = freezeControl({ frozen: Boolean(snapshot?.frozen), phase: freezePhase });
  const frozenNotice = freezeNotice(snapshot, { phase: freezePhase, error: freezeError });
  const freezeDisabled = !snapshot || Boolean(freezePhase) || Boolean(snapshot?.offlinePreview);
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
          {snapshot?.profile?.agentName ? <p className="side-agent">{snapshot.profile.agentName}</p> : null}
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
                className={snapshot?.frozen ? 'chip freeze-toggle is-unfreeze' : 'chip freeze-toggle'}
                onClick={() => onFreeze(freeze.next)}
                disabled={freezeDisabled}
                aria-busy={freeze.busy}
                aria-label={snapshot?.frozen ? 'Unfreeze the agent' : 'Freeze the agent'}
                title={snapshot?.offlinePreview ? 'Freeze works when the allowance is online.' : undefined}
              >
                {snapshot?.frozen ? <IconUnlock /> : <IconLock />}
                <span>{freeze.label}</span>
              </button>
              <button type="button" className="chip setup-chip" onClick={() => go('rules')}>{setupLabel}</button>
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
              {!presenting ? <EveLaunch /> : null}
              {!presenting ? (
                <AppMenu
                  theme={theme}
                  setTheme={setTheme}
                  frozen={Boolean(snapshot?.frozen)}
                  freezeDisabled={freezeDisabled}
                  onFreeze={() => onFreeze(freeze.next)}
                  setupLabel={setupLabel}
                  onSetup={() => go('rules')}
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
            {banner ? <ConnectionBanner banner={banner} onRetry={retryNow} /> : null}
            {frozenNotice ? (
              <FreezeBanner notice={frozenNotice} onUnfreeze={() => onFreeze(false)} disabled={freezeDisabled} />
            ) : null}
            {snapshot?.publicDemo ? (
              <div className="public-demo" role="note">
                <span className="demo-tag">Public demo</span>
                <p>
                  This is your own sandbox. Approvals and raises use a <strong>simulated Ledger signature</strong>, and Run agent records simulated payments. Nothing is broadcast.
                </p>
                <button
                  type="button"
                  className="btn text"
                  onClick={async () => {
                    try {
                      await resetDemo();
                      seen.current = null;
                      pushToast('Your demo was reset to the sample rows.');
                      load();
                    } catch (error) {
                      pushToast(error.message || 'Could not reset the demo.');
                    }
                  }}
                >
                  Reset my demo
                </button>
              </div>
            ) : null}
            {view.demo && !snapshot?.publicDemo ? (
              <div className="demo-badge" role="status">
                <span className="demo-tag">Demo</span>
                <span className="demo-text">
                  {snapshot?.offlinePreview
                    ? 'Offline. Example rows.'
                    : 'Example rows until the agent pays.'}
                </span>
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
              <div className="home-board">
                {!onboarded && !presenting && !intro && !snapshot.profile?.onboardedAt && readIntroDone() === 'skipped' ? (
                  <section className="card setup-card board-setup" aria-labelledby="setup-title">
                    <h2 id="setup-title">Finish setting up your agent</h2>
                    <p>Name it, check the budget, the cap, the merchants, and the end date, and connect your Ledger. It takes about a minute.</p>
                    <div className="how-actions">
                      <button type="button" className="btn primary" onClick={() => setIntro('setup')}>Finish setup</button>
                      <button type="button" className="btn" onClick={dismissOnboarding}>Not now</button>
                    </div>
                  </section>
                ) : null}
                <section className="card hero board-hero" aria-labelledby="allowance-title">
                  <svg className="hero-watermark" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
                    <circle cx="100" cy="100" r="92" />
                    <circle cx="100" cy="100" r="70" />
                    <path d="M100 8 A92 92 0 0 1 187 70" />
                  </svg>
                  <div className="hero-main">
                    <div className="hero-copy">
                      <h2 id="allowance-title" className="eyebrow">{snapshot.profile?.agentName ? `${snapshot.profile.agentName} · left to spend` : 'Left to spend'}</h2>
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
                  <div className="hero-actions">
                    <button type="button" className="btn primary" onClick={onRun} disabled={Boolean(snapshot.frozen)}>
                      {snapshot.frozen ? 'Agent frozen' : 'Run agent'}
                    </button>
                    {runNote ? <p className="note" role="status">{runNote}</p> : null}
                  </div>
                </section>

                <ul className="stat-tiles board-tiles" aria-label="Allowance limits">
                  <StatTile label="Per purchase" value={money(snapshot.rules.maxPerPurchase)} unit="RLUSD" hint="Above this needs your Ledger" />
                  <StatTile label="Budget" value={money(view.budget)} unit="RLUSD" hint={`${money(view.spent)} spent`} />
                  <StatTile label="Held for you" value={money(view.held)} unit="RLUSD" hint={`${pendingCount} waiting`} tone={pendingCount ? 'warn' : ''} />
                  <StatTile label="Expires" value={expiresOn(snapshot.rules.expiresAt) || 'No date'} hint={daysLabel(daysLeft(snapshot.rules.expiresAt))} />
                  <StatTile label="Merchants" value={String(merchantCount)} hint="On the allowlist" />
                </ul>

                <section className="card needs-card board-needs" aria-labelledby="needs-title">
                    <div className="card-head">
                      <h2 id="needs-title">Needs you</h2>
                      {pendingCount ? <span className="count-badge">{pendingCount}</span> : null}
                    </div>
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
                                    Review and approve
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

                <section className="card path-card board-path" aria-label="Payment path">
                  <MoneyFlow flow={liveFlow} embedded alert={path.alert} live={Boolean(path.flow?.live)} />
                  {view.activity[0] ? (
                    <button type="button" className="path-latest" onClick={() => setDetail(view.activity[0])}>
                      <span className="path-latest-label">Latest decision</span>
                      <span className="path-latest-row">
                        <StatusPill status={pill(view.activity[0])} />
                        <span className="path-latest-name">{view.activity[0].merchantLabel || 'Merchant'}</span>
                        <span className="amount">{money(view.activity[0].amount)} RLUSD</span>
                        <span className="meta">{relativeTime(view.activity[0].createdAt)}</span>
                      </span>
                      <span className="path-latest-why">{view.activity[0].status === 'paid'
                          ? (view.activity[0].approvedBy === 'ledger' ? 'Approved on your Ledger and paid once.' : 'Inside every rule, so the agent paid without asking you.')
                          : plainReason(view.activity[0].reason)}</span>
                    </button>
                  ) : null}
                  {view.chainWarning ? (
                    <p className="chain-chip is-warn">Check reconciliation</p>
                  ) : view.chainRedeemed != null ? (
                    <p className="chain-chip">Matches on-chain</p>
                  ) : null}
                </section>

                <section className="card breakdown-card board-breakdown" aria-labelledby="breakdown-title">
                  <div className="card-head">
                    <h2 id="breakdown-title">Where it went</h2>
                    <p className="meta">{counts.paid} paid · {counts.waiting} waiting · {counts.blocked} blocked</p>
                  </div>
                  <SpendBars rows={breakdown} />
                </section>

                {heistStage || rogueStage ? <div className="heist-stage board-stage">{heistStage}{rogueStage}</div> : null}

                <section className="card activity-card board-activity" aria-labelledby="latest-title">
                  <div className="card-head">
                    <h2 id="latest-title">Latest activity</h2>
                    {view.activity.length > latest.length ? (
                      <button type="button" className="btn text" onClick={() => go('activity')}>View all {view.activity.length}</button>
                    ) : null}
                  </div>
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
              </>
                )}
              </RogueDemo>
                )}
              </HeistDemo>
            ) : null}

            {snapshot && route === 'approvals' ? (
              <section className="approvals-page" aria-labelledby="page-title">
                {view.pending.length === 0 ? (
                  <div className="card">
                    <EmptyState icon={<IconCheck />} title="All clear. Nothing needs you.">
                      When the agent finds a price over your cap, or Jev asks for a review, it waits here for you.
                    </EmptyState>
                  </div>
                ) : (
                  <ul className="approval-list">
                    {[...view.pending].sort((a, b) => Number(cannotApprove(a)) - Number(cannotApprove(b))).map((item) => {
                      const why = explainApproval(item, whyContext);
                      return (
                        <li key={item.id} className={why.canApprove ? 'card approval-card' : 'card approval-card is-locked'}>
                          <div className="approval-head">
                            <span className="avatar" aria-hidden="true">{initial(item.merchantLabel)}</span>
                            <div className="approval-id">
                              <h2>{item.merchantLabel || 'Merchant'}</h2>
                              <p className="meta">{item.task || 'Purchase'} · <span title={when(item.createdAt)}>{relativeTime(item.createdAt)}</span></p>
                            </div>
                            <p className="approval-amount">{money(item.amount)} <span>RLUSD</span></p>
                          </div>
                          <ApprovalWhy why={why} />
                          <JevCard jev={item.jev} merchant={item.merchantLabel} />
                          <div className="approval-actions">
                            {why.canApprove ? (
                              snapshot.frozen && !item.sample && !snapshot.offlinePreview ? (
                                <p className="meta">Unfreeze the agent to approve this.</p>
                              ) : (
                                <button type="button" className="btn primary" onClick={() => setApproval(item)}>
                                  Review and approve {money(item.amount)} RLUSD
                                </button>
                              )
                            ) : null}
                            <button type="button" className={why.canApprove ? 'btn text' : 'btn'} disabled={busyId === item.id || item.sample || snapshot.offlinePreview} onClick={() => decide(item.id)}>
                              {busyId === item.id ? 'Declining…' : 'Decline'}
                            </button>
                            {item.sample || snapshot.offlinePreview ? <p className="meta">Example row. Decline works on real purchases.</p> : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {actionError ? (
                  <div className="state-error" role="alert">
                    <p className="state-error-title">That did not finish</p>
                    <p>{actionError}</p>
                  </div>
                ) : null}
              </section>
            ) : null}

            {snapshot && route === 'activity' ? (
              <section className="activity-page" aria-labelledby="page-title">
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
                  <HistoryView
                    items={shown}
                    filters={historyFilters}
                    onFilters={(next) => setHistoryFilters(normalizeFilters(next))}
                    onOpen={setDetail}
                    flashId={flashId}
                    onRun={onRun}
                    onExported={(line) => { pushToast(line); setAnnounce(line); }}
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
                  setTheme={setTheme}
                  voiceOn={voiceOn}
                  onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  onVoice={() => {
                    const next = !voiceOn;
                    setVoiceOn(next);
                    writeVoiceEnabled(next);
                  }}
                  onAsk={(text) => setEveSeed({ text, id: Date.now() })}
                  onSetup={() => go('rules')}
                  onLoad={load}
                  agentPanels={(
                    <>
                      <UseCaseCard
                        selected={snapshot?.useCase?.id}
                        busy={controlBusy}
                        disabled={Boolean(snapshot?.offlinePreview)}
                        onSelect={onUseCase}
                      />
                      <HowItWorks snapshot={snapshot} onChange={load} />
                      <details className="device-more card">
                        <summary>Technical details</summary>
                        <p>{snapshot?.network?.name || 'XRPL EVM Testnet'}. Chain {snapshot?.network?.chainId || '1449000'}.</p>
                        {snapshot?.simulatedLedger ? <p>Backup demo only. simulated Ledger signature. This is not a Ledger device.</p> : null}
                      </details>
                    </>
                  )}
                  onNotice={(line) => { pushToast(line); setAnnounce(line); }}
                  onGo={go}
                  onOpen={setDetail}
                  onExportAudit={exportAudit}
                  onReplayIntro={() => window.dispatchEvent(new Event('intro:open'))}
                  editorSeed={editorSeed}
                  onFreeze={() => onFreeze(freeze.next)}
                  busy={Boolean(freezePhase)}
                  disabled={freezeDisabled}
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
          <div
            className="more-sheet"
            role="dialog"
            aria-label="More"
            ref={(node) => { if (node && !node.contains(document.activeElement)) node.querySelector('button')?.focus(); }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              setMoreOpen(false);
              document.querySelector('.tabbar button[aria-expanded]')?.focus();
            }}
          >
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
      {intro && snapshot ? (
        <Onboarding
          startAt={intro}
          snapshot={snapshot}
          onClose={() => setIntro(null)}
          onSaved={load}
          onNotice={(line) => { pushToast(line); setAnnounce(line); }}
        />
      ) : null}
      {approval ? (
        <Sheet variant="ceremony" title={`Approve ${money(approval.amount)} RLUSD`} onClose={() => setApproval(null)}>
          <ApprovalWhy why={explainApproval(approval, whyContext)} headingLevel={3} />
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
    </div>
  );
}

function StatTile({ label, value, unit = '', hint = '', tone = '' }) {
  return (
    <li className={tone ? `stat-tile is-${tone}` : 'stat-tile'}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}{unit ? <span className="stat-unit"> {unit}</span> : null}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </li>
  );
}

function SpendBars({ rows }) {
  if (!rows.length) {
    return <EmptyState icon={<IconReceipt />} title="Nothing paid yet">Spend by merchant shows here after the first payment.</EmptyState>;
  }
  return (
    <ul className="spend-bars">
      {rows.map((row) => {
        const percent = Math.round(row.share * 100);
        return (
          <li key={row.label}>
            <div className="spend-line">
              <span className="spend-name">{row.label}</span>
              <span className="spend-amount">{money(row.amount)} RLUSD</span>
            </div>
            <div className="spend-track" role="img" aria-label={`${row.label}: ${percent} percent of paid spend, ${row.count} payment${row.count === 1 ? '' : 's'}`}>
              <span className="spend-fill" style={{ '--share': row.share }} />
            </div>
            <p className="spend-meta">{percent}% · {row.count} payment{row.count === 1 ? '' : 's'}</p>
          </li>
        );
      })}
    </ul>
  );
}

function FreezeBanner({ notice, onUnfreeze, disabled }) {
  return (
    <section className={`freeze-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
      <span className="freeze-icon" aria-hidden="true">{notice.action ? <IconLock size={22} /> : <IconAlert size={22} />}</span>
      <div className="freeze-copy">
        <p className="freeze-title">{notice.title}</p>
        <p>{notice.body}</p>
        {notice.error ? <p className="freeze-error" role="alert">{notice.error}</p> : null}
      </div>
      {notice.action ? (
        <button type="button" className="btn primary freeze-action" onClick={onUnfreeze} disabled={disabled}>
          <IconUnlock size={18} />
          <span>{notice.action}</span>
        </button>
      ) : null}
    </section>
  );
}

function ConnectionBanner({ banner, onRetry }) {
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`conn-banner is-${banner.tone}`} role={banner.tone === 'danger' ? 'alert' : 'status'}>
      <span className="conn-dot" aria-hidden="true" />
      <div className="conn-copy">
        <p className="conn-title">{banner.title}</p>
        <p>{banner.body}</p>
      </div>
      {banner.action ? (
        <button type="button" className="btn conn-action" onClick={retry} disabled={busy} aria-busy={busy}>
          {busy ? 'Checking…' : banner.action}
        </button>
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

/**
 * The balance as the brand's gauge disk: a pine disk, a tick ring, and the
 * lime band of what is left, which sweeps in on first paint and eases to
 * each new value. The cream dot marks where the band ends, like the cut in
 * the logo. Reduced motion shows the final band at once.
 */
function SpendRing({ ratio, label, mood = '' }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, ratio));
  const percent = Math.round(clamped * 100);
  const angle = clamped * Math.PI * 2 - Math.PI / 2;
  const dotX = 60 + radius * Math.cos(angle);
  const dotY = 60 + radius * Math.sin(angle);
  const ticks = Array.from({ length: 24 }, (_, index) => index);
  return (
    <div
      className={mood ? `ring gauge is-${mood}` : 'ring gauge'}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="gauge-disk" cx="60" cy="60" r="58" />
        <g className="gauge-ticks">
          {ticks.map((index) => {
            const a = (index / ticks.length) * Math.PI * 2;
            const inner = index % 6 === 0 ? 52 : 54;
            return (
              <line
                key={index}
                x1={60 + inner * Math.cos(a)}
                y1={60 + inner * Math.sin(a)}
                x2={60 + 56 * Math.cos(a)}
                y2={60 + 56 * Math.sin(a)}
              />
            );
          })}
        </g>
        <circle className="ring-track" cx="60" cy="60" r={radius} />
        <circle
          className="ring-value"
          cx="60"
          cy="60"
          r={radius}
          transform="rotate(-90 60 60)"
          style={{ '--circ': circumference }}
          strokeDasharray={`${circumference * clamped} ${circumference}`}
        />
        {clamped > 0 ? <circle className="ring-dot" cx={dotX} cy={dotY} r="5" /> : null}
        <circle className="gauge-core" cx="60" cy="60" r="34" />
      </svg>
      <div className="ring-label" aria-hidden="true">
        <strong>{percent}%</strong>
        <span>left</span>
      </div>
    </div>
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
  const buttonRef = useRef(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    ref.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    function onDoc(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);
  function onMenuKey(event) {
    handleMenuKey(event, {
      items: [...(ref.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') ?? [])],
      close: () => setOpen(false),
      button: buttonRef.current,
    });
  }
  return (
    <div className="demo-menu" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="chip"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}
      >
        Demo
      </button>
      {open ? (
        <div className="demo-pop" role="menu" id={menuId} aria-label="Demo" onKeyDown={onMenuKey}>
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

/** Phone app bar button for Eve. The floating bubble is hidden on phones so it never covers content. */
function EveLaunch() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const onUnread = (event) => setUnread(Number(event.detail) || 0);
    window.addEventListener('eve:unread', onUnread);
    return () => window.removeEventListener('eve:unread', onUnread);
  }, []);
  return (
    <button
      type="button"
      className="icon-btn eve-launch"
      aria-label={unread ? `Ask Eve, ${unread} new ${unread === 1 ? 'reply' : 'replies'}` : 'Ask Eve'}
      onClick={() => window.dispatchEvent(new Event('eve:open'))}
    >
      <EveMark size={26} />
      {unread > 0 ? <span className="eve-badge" aria-hidden="true">{unread}</span> : null}
    </button>
  );
}

function AppMenu({ frozen, freezeDisabled, onFreeze, setupLabel, onSetup, demo, theme, setTheme }) {
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
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);
  function onMenuKey(event) {
    handleMenuKey(event, {
      items: [...(ref.current?.querySelectorAll('[role="menuitem"]:not(:disabled), [role="menuitemradio"]') ?? [])],
      close: () => setOpen(false),
      button: buttonRef.current,
    });
  }
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
        <IconMoreVertical />
      </button>
      {open ? (
        <div className="demo-pop" role="menu" id={menuId} aria-label="Allowance actions" onKeyDown={onMenuKey}>
          <button type="button" role="menuitem" onClick={() => pick(onFreeze)} disabled={freezeDisabled}>
            <IconLock size={18} />
            <span>{frozen ? 'Unfreeze the agent' : 'Freeze the agent'}</span>
          </button>
          {freezeDisabled ? <p className="menu-note">Freeze works when the allowance is online.</p> : null}
          <button type="button" role="menuitem" onClick={() => pick(onSetup)}>
            <IconSliders size={18} />
            <span>{setupLabel}</span>
          </button>
          <p className="menu-label">Appearance</p>
          {['light', 'dark', 'system'].map((choice) => (
            <button
              key={choice}
              type="button"
              role="menuitemradio"
              aria-checked={theme === choice}
              onClick={() => setTheme(choice)}
            >
              <span className="menu-check" aria-hidden="true">{theme === choice ? <IconCheck size={16} /> : null}</span>
              <span>{choice[0].toUpperCase() + choice.slice(1)}</span>
            </button>
          ))}
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
