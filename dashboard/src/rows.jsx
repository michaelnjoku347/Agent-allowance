/** Rows, pills, and empty states shared by Home, Activity, Approvals, and the views. */

import { money, relativeTime, when } from './format.js';
import { IconAlert, IconCheck } from './icons.jsx';
import { plainReason } from '../../shared/words.js';

export function pill(item) {
  const ledgerPaid = item.approvedBy === 'ledger' || item.simulatedLedger || item.reason === 'ledger approved';
  if (item.status === 'paid' && ledgerPaid) return { label: 'Paid · Ledger', tone: 'ok' };
  if (item.status === 'paid') return { label: 'Paid', tone: 'ok' };
  if (item.declineOnly || item.reason === 'merchant not allowed' || item.status === 'declined' || item.status === 'skipped') {
    return { label: 'Blocked', tone: 'danger' };
  }
  return { label: 'Needs you', tone: 'warn' };
}

export function cannotApprove(item) {
  return Boolean(item.declineOnly) || item.reason === 'merchant not allowed';
}

export function reasonChip(item, cap) {
  if (item.reason === 'over per-purchase cap') {
    const over = Number(item.amount) - Number(cap);
    if (Number.isFinite(over) && over > 0) return `Over cap by ${money(over)}`;
  }
  return plainReason(item.reason);
}

export function planLabel(plan) {
  if (plan?.source === 'bedrock') return 'Amazon Bedrock';
  if (plan?.source === 'fallback') return 'Fallback (Bedrock not configured)';
  return '';
}

export function planDetail(plan) {
  const label = planLabel(plan);
  const reason = String(plan?.reason ?? '').trim();
  if (!label || !reason || reason.replace(/\.$/, '') === label) return '';
  return reason;
}

export function initial(label) {
  const text = (label || 'M').trim();
  return text.slice(0, 1).toUpperCase();
}

export function StatusPill({ status }) {
  return (
    <span className={`pill ${status.tone}`}>
      {status.tone === 'danger' ? <IconAlert size={14} /> : status.tone === 'warn' ? <IconAlert size={14} /> : <IconCheck size={14} />}
      {status.label}
    </span>
  );
}

export function EmptyState({ icon, title, children, action }) {
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

export function ActivityList({ items, onOpen, empty, flashId = '' }) {
  if (!items.length) return empty;
  return (
    <ul className="activity">
      <li className="activity-head" aria-hidden="true">
        <span>Merchant</span>
        <span>What it bought</span>
        <span>Amount</span>
        <span>Status</span>
        <span>When</span>
      </li>
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
