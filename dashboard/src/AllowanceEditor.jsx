import { useEffect, useId, useMemo, useState } from 'react';
import { lowerAllowance, requestAllowanceChallenge, submitAllowance } from './api.js';
import { diffAllowance, draftFrom, ledgerProposal, merchantInputError, validateDraft } from './allowanceEdit.js';
import { IconLock, IconUnlock } from './icons.jsx';
import { prepareLedger, signOnLedger } from './ledger.js';
import { webHidSupported } from '../../shared/ledger-device.js';

function shortAddress(address) {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Edit the budget, the cap, the expiry, and the merchant list.
 * Lowering applies as soon as you save. Raising anything, or adding a
 * merchant, is signed on your Ledger first. The server checks both again.
 *
 * seed     optional partial draft, for example from Eve: { maxPerPurchase: '3' }
 */
export default function AllowanceEditor({ snapshot, onSaved, onNotice, seed = null, compact = false }) {
  const rules = snapshot?.rules ?? {};
  const labels = Object.fromEntries((rules.allowedMerchants ?? [])
    .filter((item) => item?.address && item.label)
    .map((item) => [item.address.toLowerCase(), item.label]));
  // The poll hands over a new rules object every few seconds. Key on the values so typing is not reset.
  const baseKey = JSON.stringify(draftFrom(rules));
  const base = useMemo(() => JSON.parse(baseKey), [baseKey]);
  const seedKey = seed ? JSON.stringify(seed) : '';
  const [draft, setDraft] = useState(() => ({ ...base, ...(seed ?? {}) }));
  const [touched, setTouched] = useState({});
  const [adding, setAdding] = useState('');
  const [addError, setAddError] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const ids = { budget: useId(), cap: useId(), expiry: useId(), add: useId(), diff: useId() };

  // A new rule set from the server (or a new seed) restarts the draft.
  useEffect(() => {
    setDraft({ ...base, ...(seedKey ? JSON.parse(seedKey) : {}) });
    setTouched({});
  }, [base, seedKey]);

  const errors = validateDraft(draft);
  const diff = diffAllowance(rules, draft, labels);
  const invalid = Object.keys(errors).length > 0;
  const offline = Boolean(snapshot?.offlinePreview);
  const ledgerReady = webHidSupported();
  const busy = phase !== '';

  function set(field, value) {
    setDone('');
    setError('');
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function blur(field) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function addMerchant(event) {
    event.preventDefault();
    const problem = merchantInputError(adding, draft.merchants);
    if (problem) {
      setAddError(problem);
      return;
    }
    setAddError('');
    set('merchants', [...draft.merchants, adding.trim().toLowerCase()]);
    setAdding('');
  }

  function removeMerchant(address) {
    set('merchants', draft.merchants.filter((item) => item !== address));
  }

  function reset() {
    setDraft(base);
    setTouched({});
    setError('');
    setDone('');
  }

  async function save(event) {
    event.preventDefault();
    setTouched({ budget: true, maxPerPurchase: true, expiresOn: true, merchants: true });
    if (invalid || diff.empty || offline) return;
    setError('');
    setDone('');
    try {
      if (!diff.raises) {
        setPhase('saving');
        const body = await lowerAllowance(diff.patch);
        const line = body.note || 'Allowance lowered. Nothing was signed or paid.';
        setDone(line);
        onNotice?.(line);
      } else {
        if (!ledgerReady) {
          setError('Raising a limit needs your Ledger, connected over USB in Chrome or Edge on a computer.');
          return;
        }
        setPhase('preparing');
        prepareLedger();
        const challenge = await requestAllowanceChallenge(ledgerProposal(rules, draft));
        setPhase('signing');
        const signature = await signOnLedger(challenge.typedData, { expectedAddress: challenge.approverAddress });
        setPhase('saving');
        const body = await submitAllowance({ signature, message: challenge.typedData.message });
        const line = body.note || 'Allowance raised after a Ledger signature. Nothing was paid.';
        setDone(line);
        onNotice?.(line);
      }
      await onSaved?.();
    } catch (err) {
      setError(err.message || 'That change was not saved. Nothing else changed.');
    } finally {
      setPhase('');
    }
  }

  const show = (field) => touched[field] && errors[field];
  const saveLabel = phase === 'signing'
    ? 'Confirm on your Ledger…'
    : phase === 'preparing'
      ? 'Preparing the Ledger…'
      : phase === 'saving'
        ? 'Saving…'
        : diff.raises ? 'Sign with Ledger and save' : 'Save changes';

  return (
    <form className={compact ? 'editor is-compact' : 'editor'} onSubmit={save} noValidate aria-describedby={ids.diff}>
      <div className="editor-fields">
        <div className="editor-pair">
          <label className={diff.patch.budget ? 'field is-changed' : 'field'} htmlFor={ids.budget}>
            <span className="field-label">Budget</span>
            <span className="input-unit">
              <input
                id={ids.budget}
                inputMode="decimal"
                autoComplete="off"
                value={draft.budget}
                onChange={(event) => set('budget', event.target.value)}
                onBlur={() => blur('budget')}
                aria-invalid={Boolean(show('budget'))}
                aria-describedby={show('budget') ? `${ids.budget}-error` : `${ids.budget}-hint`}
                disabled={busy || offline}
              />
              <span aria-hidden="true">RLUSD</span>
            </span>
            {show('budget') ? <span className="field-error" id={`${ids.budget}-error`}>{errors.budget}</span> : <span className="field-hint" id={`${ids.budget}-hint`}>Total the agent may spend.</span>}
          </label>
          <label className={diff.patch.maxPerPurchase ? 'field is-changed' : 'field'} htmlFor={ids.cap}>
            <span className="field-label">Per-purchase cap</span>
            <span className="input-unit">
              <input
                id={ids.cap}
                inputMode="decimal"
                autoComplete="off"
                value={draft.maxPerPurchase}
                onChange={(event) => set('maxPerPurchase', event.target.value)}
                onBlur={() => blur('maxPerPurchase')}
                aria-invalid={Boolean(show('maxPerPurchase'))}
                aria-describedby={show('maxPerPurchase') ? `${ids.cap}-error` : `${ids.cap}-hint`}
                disabled={busy || offline}
              />
              <span aria-hidden="true">RLUSD</span>
            </span>
            {show('maxPerPurchase') ? <span className="field-error" id={`${ids.cap}-error`}>{errors.maxPerPurchase}</span> : <span className="field-hint" id={`${ids.cap}-hint`}>Anything above waits for you.</span>}
          </label>
        </div>
        <label className={diff.patch.expiresAt ? 'field is-changed' : 'field'} htmlFor={ids.expiry}>
          <span className="field-label">Last day to spend</span>
          <input
            id={ids.expiry}
            type="date"
            value={draft.expiresOn}
            onChange={(event) => set('expiresOn', event.target.value)}
            onBlur={() => blur('expiresOn')}
            aria-invalid={Boolean(show('expiresOn'))}
            aria-describedby={show('expiresOn') ? `${ids.expiry}-error` : `${ids.expiry}-hint`}
            disabled={busy || offline}
          />
          {show('expiresOn') ? <span className="field-error" id={`${ids.expiry}-error`}>{errors.expiresOn}</span> : <span className="field-hint" id={`${ids.expiry}-hint`}>Ends at 23:59 UTC on that day.</span>}
        </label>

        <fieldset className={diff.patch.allowedMerchants ? 'field merchants-field is-changed' : 'field merchants-field'}>
          <legend className="field-label">Merchants the agent may pay</legend>
          <ul className="merchant-chips">
            {draft.merchants.map((address) => {
              const isNew = !base.merchants.includes(address);
              return (
                <li key={address} className={isNew ? 'merchant-chip is-new' : 'merchant-chip'}>
                  <span className="merchant-chip-name">{labels[address] || shortAddress(address)}</span>
                  {labels[address] ? <code>{shortAddress(address)}</code> : null}
                  {isNew ? <span className="tag-new">New</span> : null}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeMerchant(address)}
                    aria-label={`Remove ${labels[address] || address}`}
                    disabled={busy || offline || draft.merchants.length <= 1}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {touched.merchants && errors.merchants ? <span className="field-error">{errors.merchants}</span> : null}
          <div className="add-merchant">
            <label className="sr-only" htmlFor={ids.add}>Merchant payout address</label>
            <input
              id={ids.add}
              placeholder="0x… payout address"
              autoComplete="off"
              spellCheck={false}
              value={adding}
              onChange={(event) => { setAdding(event.target.value); setAddError(''); }}
              onKeyDown={(event) => { if (event.key === 'Enter') addMerchant(event); }}
              aria-invalid={Boolean(addError)}
              aria-describedby={addError ? `${ids.add}-error` : undefined}
              disabled={busy || offline}
            />
            <button type="button" className="btn" onClick={addMerchant} disabled={busy || offline}>Add</button>
          </div>
          {addError ? <span className="field-error" id={`${ids.add}-error`}>{addError}</span> : <span className="field-hint">Adding a merchant is a raise. Your Ledger signs it.</span>}
        </fieldset>
      </div>

      <aside className="editor-diff" id={ids.diff} aria-live="polite">
        <p className="editor-diff-title">What changes</p>
        {diff.empty ? (
          <p className="meta">Nothing yet. Edit a field to see what saving would do.</p>
        ) : (
          <ul className="diff-list">
            {diff.changes.map((change) => (
              <li key={`${change.label}-${change.to}`} className={`diff-row is-${change.direction}`}>
                <span className="diff-label">{change.label}</span>
                <span className="diff-values">
                  <span className="diff-from">{change.from}</span>
                  <span aria-hidden="true">→</span>
                  <span className="diff-to">{change.to}</span>
                </span>
                <span className={`diff-badge is-${change.direction}`}>
                  {change.direction === 'raise' ? <><IconLock size={14} /> Ledger signs</> : <><IconUnlock size={14} /> Applies now</>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!diff.empty ? (
          <p className="editor-explain">
            {diff.raises
              ? 'This gives the agent more room, so your Ledger signs the whole new allowance before it is saved. The device shows the cap, budget, expiry, and merchants.'
              : 'This only takes room away from the agent. It is saved right away with no signature.'}
          </p>
        ) : null}
        {offline ? <p className="field-error">The allowance server is offline. Changes cannot be saved.</p> : null}
        {diff.raises && !ledgerReady && !offline ? (
          <p className="field-hint">Raising needs a Ledger connected over USB in Chrome or Edge.</p>
        ) : null}
        {error ? <p className="state-error" role="alert"><strong>Not saved.</strong> {error}</p> : null}
        {done ? <p className="note is-ok" role="status">{done}</p> : null}
        <div className="editor-actions">
          <button type="submit" className="btn primary" disabled={busy || invalid || diff.empty || offline || (diff.raises && !ledgerReady)} aria-busy={busy}>
            {saveLabel}
          </button>
          <button type="button" className="btn text" onClick={reset} disabled={busy || diff.empty}>Reset</button>
        </div>
      </aside>
    </form>
  );
}
