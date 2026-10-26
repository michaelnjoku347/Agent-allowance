import { useId, useState } from 'react';
import { setApprover } from './api.js';
import { prepareLedger, readLedgerAddress } from './ledger.js';
import { webHidSupported } from '../../shared/ledger-device.js';
import { approverInputError } from './ledgerCopy.js';

/**
 * Name the Ledger account that approves exceptions, once, from the dashboard.
 * Read it from the device or paste it. The server refuses a second change, so
 * the dashboard can never replace the key that guards the allowance.
 */
export default function ApproverSetup({ disabled = false, onSaved, onNotice }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fieldId = useId();
  const ledger = webHidSupported();
  const off = disabled || Boolean(busy);

  async function readDevice() {
    setBusy('ledger');
    setError('');
    try {
      prepareLedger();
      setAddress(await readLedgerAddress());
    } catch (err) {
      setError(err.message || 'The Ledger did not share an address. Nothing was saved.');
    } finally {
      setBusy('');
    }
  }

  async function save(event) {
    event.preventDefault();
    const problem = approverInputError(address);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy('save');
    setError('');
    try {
      const body = await setApprover(address.trim());
      onNotice?.(body.note || 'Approver saved.');
      await onSaved?.();
    } catch (err) {
      setError(err.message || 'The approver was not saved. Nothing changed.');
    } finally {
      setBusy('');
    }
  }

  return (
    <form className="approver-setup" onSubmit={save} noValidate>
      <p className="approver-missing">No approver yet. Until you name one, purchases over the cap can only be declined, and no limit can be raised.</p>
      <label className="field" htmlFor={fieldId}>
        <span className="field-label">Ledger account address</span>
        <input
          id={fieldId}
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="0x…"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            if (error) setError('');
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${fieldId}-${error ? 'error' : 'hint'}`}
          disabled={off}
        />
        {error
          ? <span className="field-error" id={`${fieldId}-error`} role="alert">{error}</span>
          : <span className="field-hint" id={`${fieldId}-hint`}>Account m/44&apos;/60&apos;/0&apos;/0/0 in the Ethereum app. A public address, never a key.</span>}
      </label>
      <div className="approver-setup-actions">
        {ledger ? (
          <button type="button" className="btn" onClick={readDevice} disabled={off} aria-busy={busy === 'ledger'}>
            {busy === 'ledger' ? 'Waiting for your Ledger…' : 'Read from Ledger'}
          </button>
        ) : null}
        <button type="submit" className="btn primary" disabled={off} aria-busy={busy === 'save'}>
          {busy === 'save' ? 'Saving…' : 'Save as approver'}
        </button>
      </div>
      <p className="field-hint">You can name the approver once. After that, only an edit on the server changes it.</p>
    </form>
  );
}
