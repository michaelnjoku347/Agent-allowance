import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { fetchSnapshot, runAgent, sampleSnapshot } from './api.js';
import CountUp from './CountUp.jsx';
import { DEMO_TASK, STEP_DEFS, STEP_MS, liveSteps, selectFeed } from './feed.js';
import { clock, money, shortAddress, when } from './format.js';

const POLL_MS = 3000;
const EASE = [0.22, 1, 0.36, 1];
const TWEEN = { type: 'tween', duration: 0.32, ease: EASE };

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function bannerCopy(connection, agentConnected) {
  if (connection === 'loading') return 'Loading the allowance…';
  if (connection === 'offline') return 'Server offline. Showing sample data until it is back.';
  if (connection === 'stale') return 'Server not responding. Showing the last update.';
  if (agentConnected) return 'Live. Checking for new payments every 3 seconds.';
  return 'Sample data. These purchases are not on-chain. They clear when the agent runs.';
}

function bandFor(ratio) {
  if (ratio >= 0.9) return 'hot';
  if (ratio >= 0.7) return 'warn';
  return 'ok';
}

function toneFor(reason) {
  return /expired/i.test(reason ?? '') ? 'hot' : 'wait';
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user" transition={TWEEN}>
      <Dashboard />
    </MotionConfig>
  );
}

function Dashboard() {
  const reduced = useReducedMotion();
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState('loading');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [resolvedId, setResolvedId] = useState(null);
  const [approveError, setApproveError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [runNote, setRunNote] = useState(null);
  const [liveFeed, setLiveFeed] = useState(null);
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [travel, setTravel] = useState({ key: 0, to: '0%' });
  const [freshIds, setFreshIds] = useState(() => new Set());
  const [receipt, setReceipt] = useState(null);
  const seen = useRef(null);
  const opened = useRef(false);
  const hold = useRef(false);
  const playToken = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timer;

    async function tick() {
      try {
        const next = await fetchSnapshot();
        if (stopped || hold.current) return;
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

  useEffect(() => {
    if (!snapshot || opened.current) return;
    opened.current = true;
    const feed = selectFeed(snapshot);
    setTravel({ key: 1, to: feed?.blocked ? '50%' : '100%' });
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const ids = snapshot.payments.map((payment) => payment.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current.has(id));
    for (const id of ids) seen.current.add(id);
    if (!added.length) return;
    setFreshIds(new Set(added));
    const paid = snapshot.payments.some((payment) => added.includes(payment.id) && payment.status === 'paid');
    if (paid) setTravel((current) => ({ key: current.key + 1, to: '100%' }));
    const addedIds = added;
    window.setTimeout(() => {
      setFreshIds((current) => {
        const next = new Set(current);
        for (const id of addedIds) next.delete(id);
        return next;
      });
    }, 1600);
  }, [snapshot]);

  useEffect(() => {
    if (!runStartedAt || !snapshot || playing) return;
    const paid = snapshot.payments.find((payment) => (
      payment.status === 'paid'
      && !payment.sample
      && payment.explorerUrl
      && Date.parse(payment.createdAt) >= runStartedAt - 2000
    ));
    if (paid) {
      setLiveFeed((current) => {
        if (!current) return current;
        const settled = current.steps.find((step) => step.key === 'settled');
        if (settled?.href === paid.explorerUrl) return current;
        return {
          ...current,
          id: paid.id,
          blocked: false,
          steps: current.steps.map((step) => (
            step.key === 'settled' ? { ...step, href: paid.explorerUrl, detail: null } : step
          )),
        };
      });
      return;
    }
    const blocked = snapshot.pending.find((item) => (
      !item.sample && Date.parse(item.createdAt) >= runStartedAt - 2000
    ));
    if (!blocked) return;
    setLiveFeed((current) => (current?.id === blocked.id ? current : {
      id: blocked.id,
      title: blocked.task,
      blocked: true,
      reason: blocked.reason,
      steps: [
        { key: 'requested', label: 'Requested resource', at: blocked.createdAt, detail: null },
        { key: 'challenge', label: '402 received', at: blocked.createdAt, detail: null },
        { key: 'rules', label: 'Rules checked', at: blocked.createdAt, detail: blocked.reason, blocked: true },
      ],
    }));
  }, [snapshot, runStartedAt, playing]);

  const closeReceipt = useCallback(() => setReceipt(null), []);

  async function approve(id) {
    hold.current = true;
    setBusyId(id);
    setApproveError(null);
    try {
      const response = await fetch(`/api/approve/${id}`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Approval failed.');
      setBusyId(null);
      setResolvedId(id);
      await wait(reduced ? 0 : 420);
      const next = await fetchSnapshot();
      setSnapshot(next);
      setConnection('online');
      setUpdatedAt(new Date().toISOString());
      setResolvedId(null);
    } catch (error) {
      setApproveError({ id, message: error.message });
      setBusyId(null);
      setResolvedId(null);
    } finally {
      hold.current = false;
    }
  }

  async function onRun() {
    if (playing) return;
    const token = playToken.current + 1;
    playToken.current = token;
    const startedAt = Date.now();
    setPlaying(true);
    setRunNote(null);
    setRunStartedAt(startedAt);
    setTravel((current) => ({ key: current.key + 1, to: '100%' }));
    setLiveFeed({
      id: `run-${startedAt}`,
      title: DEMO_TASK,
      blocked: false,
      live: true,
      steps: [],
    });

    const request = runAgent(DEMO_TASK).then((result) => {
      if (playToken.current !== token) return;
      if (result.demo) setRunNote(result.error);
      else if (result.ok) setRunNote('Agent started. A paid purchase shows up on the next refresh.');
      else setRunNote(result.error || 'The agent did not start.');
    }).catch(() => {
      if (playToken.current === token) {
        setRunNote('Server offline. Playing the sequence on this page.');
      }
    });

    for (let count = 1; count <= STEP_DEFS.length; count += 1) {
      if (count > 1) await wait(reduced ? 0 : STEP_MS);
      if (playToken.current !== token) return;
      setLiveFeed({
        id: `run-${startedAt}`,
        title: DEMO_TASK,
        blocked: false,
        live: true,
        steps: liveSteps(startedAt, count),
      });
    }
    await request;
    if (playToken.current === token) setPlaying(false);
  }

  const loading = connection === 'loading' && !snapshot;
  const view = snapshot ?? (connection === 'offline' ? sampleSnapshot : null);
  const showSample = view ? (connection === 'offline' || !view.agentConnected) : false;
  const paymentRows = view ? view.payments.filter((payment) => showSample || !payment.sample) : [];
  const pendingRows = view ? view.pending.filter((item) => showSample || !item.sample) : [];
  const ratio = view ? Math.max(0, Math.min(1, Number(view.spentRatio) || 0)) : 0;
  const canApprove = connection === 'online' || connection === 'stale';
  const feed = liveFeed ?? (view ? selectFeed({ ...view, payments: paymentRows, pending: pendingRows }) : null);

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
        <div className="actions">
          {view ? (
            <div className="topbar-meta">
              <p className="network">
                {view.network.name}
                <span>Chain ID {view.network.chainId}</span>
              </p>
              <p className={showSample ? 'tag' : 'tag tag-live'}>{showSample ? 'Sample' : 'Live'}</p>
            </div>
          ) : (
            <span className="bone bone-chip" />
          )}
          <button
            type="button"
            className="run"
            onClick={onRun}
            disabled={playing || loading}
            aria-busy={playing}
          >
            {playing ? 'Running…' : 'Run Agent'}
          </button>
        </div>
      </header>

      {loading || !view ? (
        <Skeleton />
      ) : (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...TWEEN, duration: reduced ? 0 : 0.32 }}
        >
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
              <p className="hero-label">Remaining</p>
              <p className="hero">
                <CountUp value={view.remaining} className="hero-num" />
                <span>{view.currency}</span>
              </p>
              <div className="stats">
                <p>
                  <span>Total</span>
                  <strong><CountUp value={view.budget} /></strong>
                </p>
                <p>
                  <span>Spent</span>
                  <strong><CountUp value={view.spent} /></strong>
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
                <motion.span
                  className={`bar-fill is-${bandFor(ratio)}`}
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${ratio * 100}%` }}
                  transition={{ ...TWEEN, duration: reduced ? 0 : 0.4 }}
                />
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
            </article>

            <article className="card flow-card span-2">
              <div className="card-head">
                <h2>Payment path</h2>
                <p>Agent to merchant to XRPL. The dot travels once for each payment.</p>
              </div>
              <Flow travel={travel} reduced={reduced} />
            </article>

            <article className="card feed-card">
              <div className="card-head">
                <h2>Live Agent Feed</h2>
                <p>{feed?.title || 'Waiting for a purchase.'}</p>
              </div>
              {runNote ? <p className="run-note">{runNote}</p> : null}
              {feed?.steps?.length ? (
                <ol className="feed-list" aria-live="polite">
                  <AnimatePresence>
                    {feed.steps.map((step, index) => (
                      <motion.li
                        key={`${feed.id}-${step.key}`}
                        initial={reduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          ...TWEEN,
                          duration: reduced ? 0 : 0.32,
                          delay: feed.live || reduced ? 0 : index * 0.04,
                        }}
                        className={step.blocked ? 'is-blocked' : undefined}
                      >
                        <span className="feed-icon"><Icon name={step.key} /></span>
                        <span className="feed-copy">
                          <span className="feed-label">{step.label}</span>
                          {step.detail ? <span className="sub">{step.detail}</span> : null}
                          {step.href ? (
                            <a href={step.href} target="_blank" rel="noreferrer noopener">
                              View transaction
                              <span className="sr-only"> on the XRPL EVM Testnet explorer</span>
                            </a>
                          ) : null}
                        </span>
                        <time dateTime={step.at}>{clock(step.at)}</time>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ol>
              ) : (
                <p className="empty">{playing ? 'Starting…' : 'Run the agent to watch a purchase move through the rules.'}</p>
              )}
            </article>

            <article className="card approvals" id="approvals">
              <div className="card-head">
                <h2>Approval needed</h2>
                <p>
                  The agent refused to pay. Approve records a placeholder for a Ledger check.
                  No voucher is signed and no RLUSD moves.
                </p>
              </div>
              {pendingRows.length === 0 ? (
                <p className="empty">Nothing is waiting. A quote that breaks the rules shows up here.</p>
              ) : (
                <ul className="queue">
                  {pendingRows.map((item) => {
                    const tone = toneFor(item.reason);
                    const done = resolvedId === item.id;
                    return (
                      <li key={item.id} className={`queue-card is-${tone}${done ? ' is-done' : ''}`}>
                        <div className="queue-top">
                          <span className={`pill pill-${tone === 'hot' ? 'hot' : 'pending'}`}>{item.reason}</span>
                          <strong>{money(item.amount)} {view.currency}</strong>
                        </div>
                        <h3>{item.task}</h3>
                        <p className="merchant-line">
                          {item.merchantLabel || 'Merchant'}
                          <code title={item.merchant}>{shortAddress(item.merchant)}</code>
                        </p>
                        {item.description ? <p className="sub">{item.description}</p> : null}
                        <p className="sub">{when(item.createdAt)}</p>
                        {done ? (
                          <motion.p
                            className="approved-mark"
                            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ ...TWEEN, duration: reduced ? 0 : 0.35 }}
                          >
                            <Icon name="settled" />
                            Approved
                          </motion.p>
                        ) : (
                          <>
                            <p className={`awaiting${tone === 'hot' ? ' is-hot' : ''}`}>Awaiting Ledger approval</p>
                            <button
                              type="button"
                              className="approve"
                              onClick={() => approve(item.id)}
                              disabled={!canApprove || busyId === item.id || Boolean(resolvedId)}
                            >
                              {busyId === item.id ? 'Approving…' : 'Approve'}
                            </button>
                          </>
                        )}
                        {approveError?.id === item.id ? <p className="form-error">{approveError.message}</p> : null}
                        {connection === 'offline' ? <p className="sub">Start the server to record an approval.</p> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>

            <article className="card table-card span-2">
              <div className="card-head">
                <h2>Payments</h2>
                <p>Live payments link to the XRPL EVM Testnet explorer. Click a row for the receipt.</p>
              </div>
              {paymentRows.length === 0 ? (
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
                      {paymentRows.map((payment) => (
                        <motion.tr
                          key={payment.id}
                          className={freshIds.has(payment.id) ? 'is-fresh' : undefined}
                          initial={freshIds.has(payment.id) && !reduced ? { opacity: 0, y: 8 } : false}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...TWEEN, duration: reduced ? 0 : 0.32 }}
                          onClick={() => setReceipt(payment)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setReceipt(payment);
                            }
                          }}
                          tabIndex={0}
                          aria-label={`Open receipt for ${payment.task}`}
                        >
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
                                onClick={(event) => event.stopPropagation()}
                              >
                                {shortAddress(payment.txHash)}
                                <span className="sr-only"> on the XRPL EVM Testnet explorer</span>
                              </a>
                            ) : (
                              <span className="muted">{payment.sample ? 'Sample' : '—'}</span>
                            )}
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </section>
        </motion.div>
      )}

      <footer>
        <p>
          {view ? `${view.network.name} · chain ID ${view.network.chainId} · ` : ''}
          RLUSD uses 18 decimals · hackathon testnet only
        </p>
      </footer>

      <AnimatePresence>
        {receipt && view ? (
          <ReceiptDrawer
            key={receipt.id}
            receipt={receipt}
            currency={view.currency}
            explorerBase={view.network.explorerUrl}
            onClose={closeReceipt}
            reduced={reduced}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Flow({ travel, reduced }) {
  return (
    <div className="flow" aria-hidden={travel.key === 0}>
      <div className="flow-labels">
        <span>Agent</span>
        <span>Merchant</span>
        <span>XRPL</span>
      </div>
      <div className="flow-rail">
        <span className="flow-line" />
        <span className="flow-stop" style={{ left: '0%' }} />
        <span className="flow-stop" style={{ left: '50%' }} />
        <span className="flow-stop" style={{ left: '100%' }} />
        {travel.key > 0 ? (
          <motion.span
            key={travel.key}
            className="flow-dot"
            initial={reduced ? { left: travel.to } : { left: '0%' }}
            animate={{ left: travel.to }}
            transition={{ ...TWEEN, duration: reduced ? 0 : 0.4 }}
          />
        ) : null}
      </div>
    </div>
  );
}

function ReceiptDrawer({ receipt, currency, explorerBase, onClose, reduced }) {
  const closeRef = useRef(null);
  const titleId = useId();
  const payoutHref = !receipt.sample && receipt.payoutTx && explorerBase
    ? `${explorerBase.replace(/\/$/, '')}/tx/${receipt.payoutTx}`
    : null;

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  return (
    <div className="drawer-layer">
      <motion.button
        type="button"
        className="backdrop"
        aria-label="Close receipt"
        onClick={onClose}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduced ? undefined : { opacity: 0 }}
        transition={{ ...TWEEN, duration: reduced ? 0 : 0.24 }}
      />
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={reduced ? false : { x: '100%' }}
        animate={{ x: 0 }}
        exit={reduced ? undefined : { x: '100%' }}
        transition={{ ...TWEEN, duration: reduced ? 0 : 0.34 }}
      >
        <div className="drawer-top">
          <p className="kicker">Receipt</p>
          <button type="button" className="ghost" ref={closeRef} onClick={onClose}>Close</button>
        </div>
        <h2 id={titleId}>{receipt.task}</h2>
        <p className="drawer-amount">{money(receipt.amount)} {currency}</p>
        <p className="merchant-line">
          {receipt.merchantLabel || 'Merchant'}
          <code title={receipt.merchant}>{shortAddress(receipt.merchant)}</code>
        </p>
        <p className="sub">{when(receipt.createdAt)}</p>
        <span className={`pill pill-${receipt.status}`}>{receipt.status}</span>
        {receipt.status === 'paid' && !receipt.sample ? <p className="sub">{receipt.payoutTx ? 'Merchant payout recorded' : 'Redeemed; merchant settlement is processing'}</p> : null}
        <dl className="receipt">
          <div>
            <dt>Channel</dt>
            <dd>{receipt.channelId ? <code>{receipt.channelId}</code> : <span className="muted">Not recorded</span>}</dd>
          </div>
          <div>
            <dt>Claim</dt>
            <dd>{receipt.claimId ? <code>{receipt.claimId}</code> : <span className="muted">Not recorded</span>}</dd>
          </div>
          <div>
            <dt>Payout</dt>
            <dd>
              {receipt.payoutTx ? (
                payoutHref ? (
                  <a href={payoutHref} target="_blank" rel="noreferrer noopener"><code>{receipt.payoutTx}</code></a>
                ) : (
                  <code>{receipt.payoutTx}</code>
                )
              ) : (
                <span className="muted">Not recorded</span>
              )}
              {receipt.sample && receipt.payoutTx ? <span className="sub">Sample. Not on-chain.</span> : null}
            </dd>
          </div>
          <div>
            <dt>Receipt</dt>
            <dd>
              {receipt.receiptUrl ? (
                <a href={receipt.receiptUrl} target="_blank" rel="noreferrer noopener">View receipt</a>
              ) : (
                <span className="muted">Not recorded</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Explorer</dt>
            <dd>
              {receipt.explorerUrl ? (
                <a href={receipt.explorerUrl} target="_blank" rel="noreferrer noopener">
                  View on XRPL EVM Testnet
                </a>
              ) : (
                <span className="muted">{receipt.sample ? 'Sample. Not on-chain.' : 'Not recorded'}</span>
              )}
            </dd>
          </div>
        </dl>
      </motion.aside>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="layout skeleton" aria-hidden="true">
      <div className="card"><span className="bone bone-lg" /><span className="bone" /><span className="bone bone-bar" /></div>
      <div className="card"><span className="bone" /><span className="bone" /><span className="bone" /></div>
      <div className="card span-2"><span className="bone bone-bar" /></div>
      <div className="card"><span className="bone" /><span className="bone" /><span className="bone" /></div>
      <div className="card"><span className="bone" /><span className="bone" /></div>
      <div className="card span-2"><span className="bone" /><span className="bone" /><span className="bone" /></div>
    </div>
  );
}

function Icon({ name }) {
  const paths = {
    requested: 'M5 12h12M13 6l6 6-6 6',
    challenge: 'M12 3.5l7 3v5.8c0 4.2-2.8 6.4-7 7.7-4.2-1.3-7-3.5-7-7.7V6.5l7-3z',
    rules: 'M8 7h8M8 12h8M8 17h5',
    voucher: 'M7 4.5h10v15H7zM10 9h4M10 13h4',
    released: 'M12 4l8 4-8 4-8-4 8-4zM4 8v8l8 4 8-4V8',
    settled: 'M5 12.5l4.5 4.5L19 7.5',
  };
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d={paths[name] || paths.settled}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
