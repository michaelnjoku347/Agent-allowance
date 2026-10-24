import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { riskDisplay } from '../JevCard.jsx';
import { clock, dateOnly, daysUntil, money } from '../format.js';
import {
  ArrowIcon, CalendarIcon, CapIcon, CheckIcon, ChevronIcon, PauseIcon, PlayIcon, ShieldIcon, SparkIcon, StoreIcon, XIcon,
} from '../icons.jsx';
import AgentCard from '../ui/AgentCard.jsx';
import HowItWorks from '../ui/HowItWorks.jsx';
import SpendInsights from '../ui/SpendInsights.jsx';
import { Avatar, StatusPill, greeting, merchantName, reasonTag } from '../ui/bits.jsx';

export default function Home({
  ledger, data, paused, offline, run, busyId, actionError,
  onRun, onPause, onResume, onDecide, onOpen, onRules, onSeeAll, onEve,
}) {
  const rules = data.rules;
  const merchants = rules?.allowedMerchants ?? [];
  const days = daysUntil(rules?.expiresAt);
  const expired = days !== null && days <= 0;
  const state = offline ? 'Preview' : paused ? 'Paused' : expired ? 'Expired' : run?.phase === 'running' ? 'Running' : 'Active';

  return (
    <div className="home">
      <header className="home-head">
        <p className="eyebrow">{greeting()} · {dateOnly(new Date().toISOString())}</p>
        <h1>Your agent&rsquo;s allowance</h1>
      </header>

      <div className="home-cols">
        <div className="col col-main">
          <div className="o-card">
            <AgentCard ledger={ledger} rules={rules} network={data.network} state={state} />
          </div>

          <div className="controls o-controls">
            <RunTracker run={run} onOpen={onOpen} />
            <div className="actions">
              {paused ? (
                <button type="button" className="btn run-btn" onClick={onResume}>
                  <PlayIcon size={20} /> Resume agent
                </button>
              ) : (
                <>
                  <button type="button" className="btn run-btn" onClick={onRun} disabled={offline || expired || run?.phase === 'running'}>
                    <PlayIcon size={20} /> {run?.phase === 'running' ? 'Agent running…' : 'Run agent'}
                  </button>
                  <button type="button" className="btn pause-btn" onClick={onPause}>
                    <PauseIcon size={20} /> Pause
                  </button>
                </>
              )}
            </div>
            {paused ? <p className="note" role="status">Paused. Run agent is off on this dashboard until you resume.</p> : null}
            <ul className="rule-chips" aria-label="Allowance rules">
              <li>
                <button type="button" className="rule-chip" onClick={onRules}>
                  <span className="chip-icon"><CapIcon size={18} /></span>
                  <span><strong>{money(ledger.cap)}</strong> cap per purchase</span>
                </button>
              </li>
              <li>
                <button type="button" className="rule-chip" onClick={onRules}>
                  <span className="chip-icon"><CalendarIcon size={18} /></span>
                  <span>{expired ? 'Expired' : 'Expires'} <strong>{dateOnly(rules?.expiresAt)}</strong></span>
                </button>
              </li>
              <li>
                <button type="button" className="rule-chip" onClick={onRules}>
                  <span className="chip-icon"><StoreIcon size={18} /></span>
                  <span><strong>{merchants.length}</strong> approved merchant{merchants.length === 1 ? '' : 's'}</span>
                  <ChevronIcon size={16} />
                </button>
              </li>
            </ul>
          </div>

          <div className="o-insights"><SpendInsights ledger={ledger} /></div>
          <div className="o-how"><HowItWorks /></div>
        </div>

        <div className="col col-side">
          <div className="o-needs">
            <Needs ledger={ledger} offline={offline} busyId={busyId} actionError={actionError} onDecide={onDecide} onOpen={onOpen} />
          </div>
          <div className="o-eve">
            <button type="button" className="eve-promo" onClick={onEve}>
              <span className="eve-orb small" aria-hidden="true"><SparkIcon size={18} /></span>
              <span className="eve-promo-text">
                <strong>Ask Eve</strong>
                <span>“How much is left?” · “Approve pending” · “Pause agent”</span>
              </span>
              <ArrowIcon size={20} />
            </button>
          </div>
          <section className="panel recent o-recent" aria-labelledby="recent-title">
            <div className="panel-head row-head">
              <h2 id="recent-title">Recent activity</h2>
              {ledger.activity.length ? (
                <button type="button" className="btn text" onClick={onSeeAll}>
                  See all <ChevronIcon size={16} />
                </button>
              ) : null}
            </div>
            <ActivityList
              items={ledger.activity.slice(0, 6)}
              onOpen={onOpen}
              highlight={run?.result?.id}
              empty="No purchases yet. Press Run agent and paid or held quotes show up here."
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function RunTracker({ run, onOpen }) {
  const reduced = useReducedMotion();
  if (!run) return null;
  const done = run.phase === 'done';
  return (
    <motion.div
      className={`tracker ${run.phase}`}
      initial={reduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
    >
      <span className="tracker-dot" aria-hidden="true" />
      <div className="tracker-text">
        <strong>
          {done ? `${run.result ? merchantName(run.result) : 'Agent'} · ${run.resultLabel}` : run.phase === 'slow' ? 'Still waiting on the agent' : 'Agent is working'}
        </strong>
        <span>{run.task}</span>
      </div>
      {done && run.result ? (
        <button type="button" className="btn small" onClick={() => onOpen(run.result)}>View</button>
      ) : null}
    </motion.div>
  );
}

function Needs({ ledger, offline, busyId, actionError, onDecide, onOpen }) {
  const reduced = useReducedMotion();
  return (
    <section className="panel needs" aria-labelledby="needs-title">
      <div className="panel-head">
        <h2 id="needs-title">
          Needs you
          {ledger.pending.length ? <span className="count">{ledger.pending.length}</span> : null}
        </h2>
        <p>Outside the rules or flagged by Jev. Nothing is paid until a person decides.</p>
      </div>
      {ledger.pending.length === 0 ? (
        <div className="all-clear">
          <span className="all-clear-icon"><CheckIcon size={22} /></span>
          <p><strong>All clear.</strong> Nothing is waiting for you.</p>
        </div>
      ) : (
        <ul className="need-list">
          <AnimatePresence initial={false}>
            {ledger.pending.map((item) => {
              const jev = item.jev?.source === 'jev' ? item.jev : null;
              const risk = riskDisplay(jev?.risk);
              return (
                <motion.li
                  key={item.id}
                  className={item.reason === 'Jev flagged for review' ? 'need jev-flag' : 'need'}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40, transition: { duration: 0.2 } }}
                >
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
                    {risk !== null ? <span className="tag tag-jev">Jev risk {risk}/5</span> : null}
                    <span className="meta">{clock(item.createdAt)}</span>
                  </p>
                  <div className="need-actions">
                    <button type="button" className="btn primary" disabled={offline || busyId === item.id} onClick={() => onDecide(item.id, 'approve')}>
                      <CheckIcon size={18} /> {busyId === item.id ? 'Saving…' : 'Approve'}
                    </button>
                    <button type="button" className="btn" disabled={offline || busyId === item.id} onClick={() => onDecide(item.id, 'decline')}>
                      <XIcon size={18} /> Decline
                    </button>
                    <button type="button" className="btn more" onClick={() => onOpen(item)} aria-label={`Details for ${merchantName(item)}`} title="Details">
                      <ChevronIcon size={20} />
                    </button>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      {actionError ? <p className="banner warn inline" role="alert">{actionError}</p> : null}
    </section>
  );
}

export function ActivityList({ items, onOpen, empty, highlight }) {
  const reduced = useReducedMotion();
  if (!items.length) return <p className="empty-copy">{empty}</p>;
  return (
    <ul className="activity">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.li
            key={item.id}
            layout={!reduced}
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={item.id === highlight ? 'is-new' : undefined}
          >
            <button type="button" className="row" onClick={() => onOpen(item)}>
              <Avatar name={merchantName(item)} />
              <span className="row-main">
                <span className="row-title">
                  <span className="row-name">{merchantName(item)}</span>
                  {item.sample ? <span className="sample-tag">Sample</span> : null}
                </span>
                <span className="meta">{item.task || 'Purchase'} · {clock(item.createdAt)}</span>
              </span>
              <span className="row-end">
                <span className={`row-amount ${item.status}`}>{money(item.amount)}<span className="unit"> RLUSD</span></span>
                <StatusPill item={item} />
              </span>
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
