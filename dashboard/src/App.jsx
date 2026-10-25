import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { allowanceView } from './allowance.js';
import { declinePurchase, fetchSnapshot, runAgent, runOverCap, sampleSnapshot, selectUseCase, setAgentFrozen } from './api.js';
import BedrockMark from './BedrockMark.jsx';
import LedgerApproval from './LedgerApproval.jsx';
import CountUp from './CountUp.jsx';
import { EveDock } from './EvePanel.jsx';
import HeistDemo from './HeistDemo.jsx';
import { flowForHeist, flowForItem, narrationFor, narrationForHeist, toneKind, txFeed } from './present.js';
import { MoneyFlow, TxFeed } from './Stage.jsx';
import { playTone, readVoiceEnabled, setPresentation, speakLine, stopSpeech, writeVoiceEnabled } from './stage.js';
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
import { USE_CASES } from '../../shared/use-cases.js';
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
  if (item.sample) return { label: 'Sample', tone: 'warn' };
  if (item.status === 'paid') return { label: 'Paid', tone: 'ok' };
  if (item.status === 'approved') return { label: 'Waiting', tone: 'warn' };
  if (item.status === 'skipped') return { label: 'Not signed', tone: 'warn' };
  if (item.status === 'declined' || item.status === 'pending') return { label: 'Blocked', tone: 'danger' };
  return { label: item.status || 'Waiting', tone: 'warn' };
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
  const [tab, setTab] = useState('home');
  const [eveSeed, setEveSeed] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState('loading');
  const [filter, setFilter] = useState('all');
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
  }, [view.activity, voiceOn]);

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

  const onHeist = useCallback((report) => {
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

  async function onFreeze() {
    setControlBusy('freeze');
    try {
      await setAgentFrozen(!snapshot?.frozen);
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

  const shown = view.activity.filter((item) => matchesFilter(item, filter));
  const latest = view.activity.slice(0, 5);
  const merchantCount = snapshot?.rules?.allowedMerchants?.length ?? 0;
  const balanceLabel = `${money(view.spent)} of ${money(view.budget)} RLUSD spent. ${money(view.left)} RLUSD left.`;
  const liveFlow = flowOverride || flowForItem(view.activity[0]);
  const feed = txFeed(view.payments, snapshot?.network?.explorerUrl);

  return (
    <div className={presenting ? 'app is-present' : 'app'}>
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
            <div className="top-tools">
              <button type="button" className={voiceOn ? 'chip is-on' : 'chip'} aria-pressed={voiceOn} onClick={toggleVoice}>
                {voiceOn ? 'Voice on' : 'Voice off'}
              </button>
              <button type="button" className={presenting ? 'chip is-on' : 'chip'} aria-pressed={presenting} onClick={togglePresent}>
                {presenting ? 'Exit presentation' : 'Present'}
              </button>
              <ThemeControl theme={theme} setTheme={setTheme} />
            </div>
          </header>
          <p className="lede">Each purchase is checked against your rules before it is paid.</p>
          {snapshot?.simulatedLedger ? (
            <p className="sim-banner sim-banner-page" role="status">
              Backup demo only. simulated Ledger signature. This is not a Ledger device and it does not broadcast a voucher.
            </p>
          ) : null}

          <main id="main" tabIndex={-1}>
            {connection === 'loading' && !snapshot ? <Skeletons /> : null}
            {snapshot?.offlinePreview ? (
              <p className="offline-banner" role="status">
                Offline sample preview. The allowance server is not running, so these rows are examples, not payments.
                Start it with npm run server.
                <button type="button" className="btn" onClick={load}>Retry</button>
              </p>
            ) : null}
            {snapshot && tab === 'home' ? (
              <div className="stack">
                {snapshot.frozen ? (
                  <p className="freeze-banner" role="status">
                    {snapshot.channelClosed
                      ? 'Agent frozen. The payment channel is closed. The agent cannot sign another voucher.'
                      : snapshot.freezeDetail
                        ? `Agent frozen. ${snapshot.freezeDetail}`
                        : 'Agent frozen. New payments are refused until you unfreeze it.'}
                  </p>
                ) : null}
                {connection === 'offline' && !snapshot.offlinePreview ? (
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
                      <dl className="money-summary">
                        <div>
                          <dt>Remaining</dt>
                          <dd>{money(view.left)} RLUSD</dd>
                        </div>
                        <div>
                          <dt>Held for review</dt>
                          <dd>{money(view.held)} RLUSD</dd>
                        </div>
                        <div>
                          <dt>Lost</dt>
                          <dd>{money(view.lost)} RLUSD</dd>
                        </div>
                      </dl>
                      <p className="chain-lines">
                        <span>Local ledger {money(view.localSpent)} RLUSD</span>
                        <span>
                          On-chain redeemed {view.chainRedeemed == null ? 'not loaded' : `${money(view.chainRedeemed)} RLUSD`}
                        </span>
                        <span>Local budget {money(view.budget)} RLUSD</span>
                        <span>
                          Channel cap {view.chainCap == null ? 'not loaded' : `${money(view.chainCap)} RLUSD`}
                        </span>
                      </p>
                      {view.chainWarning ? <p className="note warn" role="status">{view.chainWarning}</p> : null}
                    </div>
                    <SpendRing ratio={view.ratio} label={balanceLabel} mood={ringMood} />
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
                    <button
                      type="button"
                      className={snapshot.frozen ? 'btn' : 'btn danger'}
                      onClick={onFreeze}
                      disabled={controlBusy === 'freeze' || snapshot.offlinePreview}
                    >
                      {snapshot.frozen ? 'Unfreeze agent' : 'Freeze agent'}
                    </button>
                    {runNote ? <p className="note" role="status">{runNote}</p> : null}
                  </div>
                </section>

                <UseCaseCard
                  selected={snapshot.useCase?.id}
                  busy={controlBusy}
                  disabled={Boolean(snapshot.offlinePreview)}
                  onSelect={onUseCase}
                />

                <MoneyFlow flow={liveFlow} />
                <TxFeed rows={feed} />

                <HeistDemo onDone={load} onResult={onHeist} />
                <AuditCard rows={snapshot.audit} onExport={exportAudit} />

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
                      <p>A quote outside the rules waits here. Approving it asks the Ledger to sign, then pays that quote once.</p>
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
                            {item.declineReason ? <p>{item.declineReason}</p> : null}
                            <p className="meta"><code>{shortAddress(item.merchant)}</code> · {when(item.createdAt)}</p>
                            <JevCard jev={item.jev} />
                            <div className="pair">
                              {item.declineOnly || item.sample || snapshot.offlinePreview ? (
                                <p className="meta">Decline only. A Ledger signature cannot pay this quote.</p>
                              ) : snapshot.frozen ? (
                                <p className="meta">Frozen. Unfreeze the agent before this quote can be paid.</p>
                              ) : (
                                <button type="button" className="btn primary" onClick={() => setApproval(item)}>
                                  Approve with Ledger
                                </button>
                              )}
                              <button type="button" className="btn" disabled={busyId === item.id || item.sample || snapshot.offlinePreview} onClick={() => decide(item.id)}>
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
                  flashId={flashId}
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

            {snapshot && tab === 'activity' ? (
              <div className="stack">
                <AuditCard rows={snapshot.audit} onExport={exportAudit} />
              </div>
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
      {approval ? (
        <Sheet title="Approve with Ledger" onClose={() => setApproval(null)}>
          <LedgerApproval item={approval} onPaid={load} simulated={Boolean(snapshot?.simulatedLedger)} />
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

function SpendRing({ ratio, label, mood = '' }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, ratio));
  const percent = Math.round(clamped * 100);
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

function ActivityList({ items, onOpen, empty, explorer, flashId = '' }) {
  if (!items.length) return empty;
  return (
    <ul className="activity">
      {items.map((item) => {
        const status = pill(item);
        return (
          <li key={item.id}>
            <button type="button" className={flashId === item.id ? 'row is-flash' : 'row'} onClick={() => onOpen(item)}>
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
            {planLabel(item.plan) ? (
              <p className="row-plan">
                <span className="fallback-label">{planLabel(item.plan)}</span>
                {planDetail(item.plan) ? ` ${planDetail(item.plan)}` : ''}
                {item.plan.source === 'bedrock' ? <BedrockMark /> : null}
              </p>
            ) : null}
            {item.status === 'skipped' && item.reason ? <p className="row-plan">{item.reason}</p> : null}
            {item.status === 'paid' && (item.txHash || item.payoutTx || item.receiptUrl) ? (
              <ReceiptCard item={item} explorer={explorer} />
            ) : null}
            {item.simulatedLedger ? <p className="sim-label">simulated Ledger signature</p> : null}
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
