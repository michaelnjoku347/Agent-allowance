import { useState } from 'react';
import { askEve, confirmEve } from '../api.js';
import { dateOnly, daysUntil, money, shortAddress } from '../format.js';
import { CalendarIcon, CapIcon, EditIcon, ShieldIcon, StoreIcon, WalletIcon } from '../icons.jsx';
import { Avatar, CopyButton } from './bits.jsx';
import Sheet from './Sheet.jsx';

/**
 * The allowance rules. Budget and cap changes go through Eve's own
 * confirmation endpoint, the same path as asking her in chat.
 */
export default function RulesSheet({ open, onClose, rules, ledger, offline, onChanged }) {
  const merchants = rules?.allowedMerchants ?? [];
  const days = daysUntil(rules?.expiresAt);
  return (
    <Sheet open={open} onClose={onClose} title="Allowance rules" subtitle="Checked before every voucher is signed.">
      <div className="rules">
        {rules?.summary ? <p className="rules-summary"><ShieldIcon size={20} /> <span>{rules.summary}</span></p> : null}
        <RuleRow
          Icon={WalletIcon}
          label="Budget"
          value={`${money(ledger.budget)} RLUSD`}
          note={`${money(ledger.spent)} spent · ${money(ledger.left)} left`}
          kind="budget"
          offline={offline}
          onChanged={onChanged}
        />
        <RuleRow
          Icon={CapIcon}
          label="Per-purchase cap"
          value={`${money(ledger.cap)} RLUSD`}
          note="Larger quotes wait for you"
          kind="cap"
          offline={offline}
          onChanged={onChanged}
        />
        <div className="rule-row">
          <span className="rule-icon"><CalendarIcon size={20} /></span>
          <div className="rule-text">
            <span className="rule-label">Expires</span>
            <strong>{dateOnly(rules?.expiresAt)}</strong>
            <span className="meta">{days !== null && days > 0 ? `${days} days from now` : 'The allowance has expired'}</span>
          </div>
        </div>
        <div className="rule-row column">
          <div className="rule-row-head">
            <span className="rule-icon"><StoreIcon size={20} /></span>
            <div className="rule-text">
              <span className="rule-label">Approved merchants</span>
              <strong>{merchants.length}</strong>
            </div>
          </div>
          <ul className="merchants">
            {merchants.map((m) => (
              <li key={m.address}>
                <Avatar name={m.label || m.address} size="sm" />
                <span className="m-text">
                  <span className="m-name">{m.label || 'Unnamed merchant'}</span>
                  <code>{shortAddress(m.address)}</code>
                </span>
                <CopyButton value={m.address} label={`${m.label || 'merchant'} address`} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Sheet>
  );
}

function RuleRow({ Icon, label, value, note, kind, offline, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function prepare(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = await askEve(kind === 'cap' ? `Set my cap to ${draft}` : `Set my budget to ${draft}`);
      if (body.confirmation) setCard({ ...body.confirmation, reply: body.reply });
      else setError(body.reply || 'Eve could not prepare that change.');
    } catch (err) {
      setError(err.message || 'Eve could not prepare that change.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const body = await confirmEve(card.token);
      setCard(null);
      setEditing(false);
      setDraft('');
      onChanged(body.reply || `${label} updated.`);
    } catch (err) {
      setError(err.message || 'That change did not go through.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rule-row column">
      <div className="rule-row-head">
        <span className="rule-icon"><Icon size={20} /></span>
        <div className="rule-text">
          <span className="rule-label">{label}</span>
          <strong>{value}</strong>
          <span className="meta">{note}</span>
        </div>
        {!editing ? (
          <button type="button" className="btn small" onClick={() => setEditing(true)} disabled={offline}>
            <EditIcon size={16} /> Change<span className="sr-only"> {label.toLowerCase()}</span>
          </button>
        ) : null}
      </div>
      {editing && !card ? (
        <form className="rule-edit" onSubmit={prepare}>
          <label className="sr-only" htmlFor={`rule-${kind}`}>New {label.toLowerCase()} in RLUSD</label>
          <input
            id={`rule-${kind}`}
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="New amount"
            data-autofocus
          />
          <span className="unit-suffix">RLUSD</span>
          <button type="submit" className="btn primary small" disabled={busy || !draft}>Review</button>
          <button type="button" className="btn text small" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
        </form>
      ) : null}
      {card ? (
        <div className="confirm" role="group" aria-label="Confirm this change">
          <p>{card.summary}</p>
          <p className="meta">Eve: {card.reply}</p>
          <div className="need-actions">
            <button type="button" className="btn primary" onClick={confirm} disabled={busy}>Confirm</button>
            <button type="button" className="btn" onClick={() => setCard(null)} disabled={busy}>Back</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="banner warn inline" role="alert">{error}</p> : null}
    </div>
  );
}
