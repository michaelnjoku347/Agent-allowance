import { motion, useReducedMotion } from 'framer-motion';
import JevCard from '../JevCard.jsx';
import { money, shortAddress, when } from '../format.js';
import { CheckIcon, ExternalIcon, ShieldIcon, XIcon } from '../icons.jsx';
import { plainReason } from '../../../shared/words.js';
import { Avatar, CopyButton, StatusPill, merchantName } from './bits.jsx';

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

export default function Detail({ item, cap, currency, busy, offline, onDecide }) {
  const reduced = useReducedMotion();
  const rows = ruleRows(item);
  return (
    <div className="detail">
      <div className={`detail-hero tone-${item.status}`}>
        <div className="detail-who">
          <Avatar name={merchantName(item)} />
          <div>
            <p className="detail-task">{item.task || 'Purchase'}</p>
            <p className="meta">{when(item.createdAt)}</p>
          </div>
        </div>
        <p className="detail-amount">{money(item.amount)} <span>{currency}</span></p>
        <div className="detail-tags">
          <StatusPill item={item} />
          {item.sample ? <span className="sample-tag">Sample data</span> : null}
        </div>
      </div>

      {item.reason && item.status !== 'paid' ? (
        <p className="banner warn inline">
          <ShieldIcon size={18} />
          <span>{plainReason(item.reason)}{item.reason === 'over per-purchase cap' ? ` The cap is ${money(cap)} ${currency}.` : ''}</span>
        </p>
      ) : null}
      {item.note ? <p className="meta">{item.note}</p> : null}

      {item.status === 'pending' ? (
        <div className="decide">
          <p className="meta">Approving records your decision. It does not sign a voucher or move RLUSD.</p>
          <div className="need-actions">
            <button type="button" className="btn primary" disabled={offline || busy} onClick={() => onDecide(item.id, 'approve')}>
              <CheckIcon size={18} /> {busy ? 'Saving…' : 'Approve'}
            </button>
            <button type="button" className="btn" disabled={offline || busy} onClick={() => onDecide(item.id, 'decline')}>
              <XIcon size={18} /> Decline
            </button>
          </div>
        </div>
      ) : null}

      <h3 className="detail-h">Rule checks</h3>
      <ul className="checks">
        {rows.map((row, i) => (
          <motion.li
            key={row.label}
            className={row.state}
            initial={reduced ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08 + i * 0.07, duration: 0.24 }}
          >
            <span className="check-icon" aria-hidden="true">
              {row.state === 'pass' ? <CheckIcon size={16} /> : row.state === 'fail' ? <XIcon size={16} /> : '–'}
            </span>
            <span className="check-label">{row.label}</span>
            <span className="check-text">{row.text}</span>
          </motion.li>
        ))}
      </ul>

      <JevCard jev={item.jev} />

      <h3 className="detail-h">On-chain record</h3>
      <dl className="facts">
        <Fact label="Merchant" value={item.merchant} />
        <Fact label="Transaction" value={item.txHash} />
        <Fact label="Merchant payout" value={item.payoutTx} />
        <Fact label="Channel" value={item.channelId} />
        <Fact label="Claim ID" value={item.claimId} />
      </dl>
      {item.sample && item.txHash ? <p className="meta">Sample hashes are placeholders and are not on chain.</p> : null}
      <div className="links">
        {item.explorerUrl ? (
          <a className="btn primary" href={item.explorerUrl} target="_blank" rel="noreferrer noopener">
            Verify on explorer <ExternalIcon size={16} /><span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        {item.receiptUrl ? (
          <a className="btn" href={item.receiptUrl} target="_blank" rel="noreferrer noopener">
            Receipt <ExternalIcon size={16} /><span className="sr-only"> (opens in a new tab)</span>
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
      <dd>
        {value ? (
          <>
            <code title={value}>{shortAddress(value)}</code>
            <CopyButton value={value} label={label.toLowerCase()} />
          </>
        ) : <span className="meta">Not recorded</span>}
      </dd>
    </div>
  );
}
