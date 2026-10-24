import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { approvePurchase, declinePurchase, fetchSnapshot, sampleSnapshot } from './api.js';
import EvePanel from './EvePanel.jsx';
import { deriveLedger, status } from './ledger.js';
import { money } from './format.js';
import { useTheme } from './theme.js';
import {
  AutoIcon, HomeIcon, ListIcon, Logo, MicIcon, MoonIcon, ShieldIcon, SparkIcon, SunIcon,
} from './icons.jsx';
import Home from './screens/Home.jsx';
import Activity from './screens/Activity.jsx';
import Detail from './ui/Detail.jsx';
import RulesSheet from './ui/RulesSheet.jsx';
import RunSheet from './ui/RunSheet.jsx';
import Sheet from './ui/Sheet.jsx';
import Toasts from './ui/Toasts.jsx';
import { merchantName } from './ui/bits.jsx';

const TABS = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'activity', label: 'Activity', Icon: ListIcon },
  { id: 'eve', label: 'Eve', Icon: SparkIcon },
];

const THEMES = [
  { id: 'light', label: 'Light', Icon: SunIcon },
  { id: 'dark', label: 'Dark', Icon: MoonIcon },
  { id: 'system', label: 'System', Icon: AutoIcon },
];

const PAUSE_KEY = 'allowance-paused';
const TONE = { paid: 'ok', pending: 'warn', declined: 'danger', approved: 'info' };

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

export default function App() {
  const [theme, setTheme] = useTheme();
  const [tab, setTab] = useState('home');
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState('loading');
  const [filter, setFilter] = useState('all');
  const [detailId, setDetailId] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [announce, setAnnounce] = useState('');
  const [paused, setPaused] = usePaused();
  const [runOpen, setRunOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [run, setRun] = useState(null);
  const [toasts, setToasts] = useState([]);
  const seen = useRef(null);
  const mainRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchSnapshot();
      setSnapshot(next);
      setConnection('online');
    } catch {
      setConnection('offline');
    }
  }, []);

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
  }, [load]);

  const offline = connection === 'offline' && !snapshot;
  const data = snapshot ?? (offline ? sampleSnapshot : null);
  const ledger = useMemo(() => deriveLedger(data), [data]);
  const detail = detailId ? ledger.activity.find((item) => item.id === detailId) ?? null : null;

  const toast = useCallback((next) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [{ id, ...next }, ...current].slice(0, 3));
    setAnnounce(`${next.title}. ${next.text ?? ''}`);
  }, []);
  const dismiss = useCallback((id) => setToasts((current) => current.filter((t) => t.id !== id)), []);

  // New rows since the last poll: toast them, and finish a run that was waiting on one.
  useEffect(() => {
    if (!data) return;
    const ids = ledger.activity.map((item) => item.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ledger.activity.filter((item) => !seen.current.has(item.id));
    for (const id of ids) seen.current.add(id);
    if (!added.length) return;
    const newest = added[0];
    const s = status(newest);
    toast({
      tone: TONE[newest.status] ?? 'info',
      title: `${s.label} · ${money(newest.amount)} RLUSD`,
      text: `${merchantName(newest)} — ${newest.task || 'Purchase'}`,
      item: newest,
    });
    setRun((current) => (current && current.phase !== 'done'
      ? { ...current, phase: 'done', result: newest, resultLabel: `${s.label} ${money(newest.amount)} RLUSD` }
      : current));
  }, [ledger.activity, data, toast]);

  useEffect(() => {
    if (!run) return undefined;
    const delay = run.phase === 'done' ? 20000 : run.phase === 'running' ? 75000 : null;
    if (delay === null) return undefined;
    const t = window.setTimeout(() => {
      setRun((current) => {
        if (current !== run) return current;
        return run.phase === 'done' ? null : { ...run, phase: 'slow' };
      });
    }, delay);
    return () => window.clearTimeout(t);
  }, [run]);

  function go(next) {
    setTab(next);
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }

  async function decide(id, kind) {
    const item = ledger.activity.find((row) => row.id === id);
    setBusyId(id);
    setActionError('');
    try {
      if (kind === 'approve') await approvePurchase(id);
      else await declinePurchase(id);
      setDetailId(null);
      toast({
        tone: kind === 'approve' ? 'info' : 'danger',
        title: kind === 'approve' ? 'Approved' : 'Declined',
        text: kind === 'approve'
          ? `${item ? merchantName(item) : 'Purchase'} recorded. Nothing was signed or paid.`
          : `${item ? merchantName(item) : 'Purchase'} will not be paid.`,
      });
      await load();
    } catch (error) {
      setActionError(error.message || 'That did not save.');
    } finally {
      setBusyId('');
    }
  }

  function onStarted(task) {
    setRun({ phase: 'running', task, startedAt: Date.now() });
    toast({ tone: 'info', title: 'Agent started', text: task });
  }

  function onRulesChanged(reply) {
    toast({ tone: 'ok', title: 'Rules updated', text: reply });
    load();
  }

  const themeIndex = Math.max(0, THEMES.findIndex((t) => t.id === theme));
  const currentTheme = THEMES[themeIndex];
  const nextTheme = THEMES[(themeIndex + 1) % THEMES.length];
  const pendingCount = ledger.pending.length;

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <a className="skip" href="#main">Skip to content</a>
        <div className="sr-only" aria-live="polite">{announce}</div>
        <Toasts toasts={toasts} onDismiss={dismiss} onOpen={(item) => setDetailId(item.id)} />

        <aside className="rail">
          <div className="brand">
            <Logo size={38} />
            <div>
              <p className="brand-name">Agent Allowance</p>
              <p className="brand-sub">Spending accounts for AI agents</p>
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
                {tab === id ? <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', damping: 30, stiffness: 400 }} /> : null}
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
            <div className="rail-card">
              <p className="rail-card-title">Built for</p>
              <p className="rail-card-body">Mastercard × XRPL hackathon. RLUSD settles through AP4M vouchers on XRPL EVM.</p>
            </div>
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
              <Logo size={34} />
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
                <p><strong>Offline preview.</strong> The allowance server is not answering, so this is sample data and actions are off. Start it with <code>npm run server</code>.</p>
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

            {!data && tab !== 'eve' ? <Skeletons /> : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tab}
                  className="screen-body"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  {tab === 'home' && data ? (
                    <Home
                      ledger={ledger}
                      data={data}
                      paused={paused}
                      offline={offline}
                      run={run}
                      busyId={busyId}
                      actionError={actionError}
                      onRun={() => setRunOpen(true)}
                      onPause={() => { setPaused(true); toast({ tone: 'warn', title: 'Agent paused', text: 'Run agent is off until you resume.' }); }}
                      onResume={() => { setPaused(false); toast({ tone: 'ok', title: 'Agent resumed' }); }}
                      onDecide={decide}
                      onOpen={(item) => setDetailId(item.id)}
                      onRules={() => setRulesOpen(true)}
                      onSeeAll={() => go('activity')}
                      onEve={() => go('eve')}
                    />
                  ) : null}
                  {tab === 'activity' && data ? (
                    <Activity ledger={ledger} filter={filter} setFilter={setFilter} onOpen={(item) => setDetailId(item.id)} />
                  ) : null}
                  {tab === 'eve' ? (
                    <EvePanel
                      ledger={ledger}
                      paused={paused}
                      onPause={() => setPaused(true)}
                      onResume={() => setPaused(false)}
                      onChanged={load}
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            )}
          </main>
        </div>

        <Sheet open={Boolean(detail)} title={detail ? merchantName(detail) : ''} onClose={() => setDetailId(null)}>
          {detail ? (
            <Detail
              item={detail}
              cap={ledger.cap}
              currency={data?.currency || 'RLUSD'}
              busy={busyId === detail.id}
              offline={offline}
              onDecide={decide}
            />
          ) : null}
        </Sheet>
        <RunSheet open={runOpen} onClose={() => setRunOpen(false)} ledger={ledger} onStarted={onStarted} />
        <RulesSheet
          open={rulesOpen}
          onClose={() => setRulesOpen(false)}
          rules={data?.rules}
          ledger={ledger}
          offline={offline}
          onChanged={onRulesChanged}
        />
      </div>
    </MotionConfig>
  );
}

function NetworkBadge({ network, offline }) {
  return (
    <p className="network">
      <span className={offline ? 'dot off' : 'dot'} aria-hidden="true" />
      <span>
        {network?.name || 'XRPL EVM Testnet'}
        <span className="network-sub">{offline ? 'Server offline' : `Live · chain ${network?.chainId ?? 1449000}`}</span>
      </span>
    </p>
  );
}

function Skeletons() {
  return (
    <div className="home" aria-busy="true">
      <p className="sr-only" role="status">Loading the allowance</p>
      <div className="skeleton sk-head" />
      <div className="agent-card skeleton" />
      <div className="panel skeleton short" />
      <div className="panel skeleton" />
    </div>
  );
}
