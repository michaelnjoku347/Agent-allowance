import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { lowerAllowance, requestAllowanceChallenge, saveProfile, setApprover, submitAllowance } from './api.js';
import { ledgerProposal, merchantInputError, validateDraft } from './allowanceEdit.js';
import BrandMark from './BrandMark.jsx';
import { money } from './format.js';
import { ART } from './IntroArt.jsx';
import { IconCheck, IconLock, IconUnlock } from './icons.jsx';
import { prepareLedger, readLedgerAddress, signOnLedger } from './ledger.js';
import { INTRO_KEY, SETUP_STEPS, SLIDES, keyAction, lowerOnlyDraft, setupDraft, setupPlan, slideReducer, stepErrors, swipeDirection } from './onboarding.js';
import { webHidSupported } from '../../shared/ledger-device.js';

export function readIntroDone() {
  try {
    return localStorage.getItem(INTRO_KEY);
  } catch {
    return null;
  }
}

function writeIntroDone(value) {
  try {
    localStorage.setItem(INTRO_KEY, value);
  } catch {
    /* Private browsing: the intro may show again next visit. */
  }
}

function shortAddress(address) {
  const text = String(address ?? '');
  return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

function dayLabel(day) {
  const ms = Date.parse(`${day}T12:00:00Z`);
  if (Number.isNaN(ms)) return day || 'Not set';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms));
}

function focusables(root) {
  if (!root) return [];
  return [...root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.disabled && node.offsetParent !== null);
}

/**
 * First-run flow: four slides, then a six-step setup. Opens full screen.
 * startAt "setup" skips the slides (used by "Finish setup").
 */
export default function Onboarding({ snapshot, onClose, onSaved, onNotice, startAt = 'intro' }) {
  const [phase, setPhase] = useState(startAt);
  const [slide, dispatch] = useReducer(slideReducer, { index: 0, done: false });
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => setupDraft(snapshot));
  const [touched, setTouched] = useState({});
  const [adding, setAdding] = useState('');
  const [addError, setAddError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [direction, setDirection] = useState('next');
  const rootRef = useRef(null);
  const headingRef = useRef(null);
  const swipe = useRef(null);
  const titleId = useId();
  const liveId = useId();
  const ids = { name: useId(), budget: useId(), cap: useId(), expiry: useId(), add: useId(), approver: useId() };
  const rules = snapshot?.rules ?? {};
  const labels = Object.fromEntries((rules.allowedMerchants ?? []).filter((item) => item?.label).map((item) => [item.address.toLowerCase(), item.label]));
  const approverSet = Boolean(rules.approverAddress);
  const ledgerReady = webHidSupported();
  const offline = Boolean(snapshot?.offlinePreview);

  // Keep focus inside, move it to each new heading, and let Escape skip.
  useEffect(() => {
    const previous = document.activeElement;
    document.body.classList.add('has-overlay');
    return () => {
      document.body.classList.remove('has-overlay');
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [phase, slide.index, step]);

  useEffect(() => {
    if (slide.done && phase === 'intro') {
      setPhase('setup');
      setStep(0);
    }
  }, [slide.done, phase]);

  function finish(value) {
    writeIntroDone(value);
    onClose?.(value);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(phase === 'done' ? 'done' : 'skipped');
      return;
    }
    if (event.key === 'Tab') {
      const items = focusables(rootRef.current);
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
      return;
    }
    if (phase !== 'intro') return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const action = keyAction(event.key);
    if (!action) return;
    event.preventDefault();
    move(action);
  }

  function move(action) {
    setDirection(action.type === 'back' || (action.type === 'go' && action.index < slide.index) ? 'back' : 'next');
    dispatch(action);
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    swipe.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event) {
    if (!swipe.current) return;
    const dir = swipeDirection(event.clientX - swipe.current.x, event.clientY - swipe.current.y);
    swipe.current = null;
    if (dir) move({ type: dir });
  }

  const current = SETUP_STEPS[step];
  const errors = phase === 'setup' ? stepErrors(current.id, draft) : {};
  const show = (field) => touched[field] && errors[field];
  const plan = setupPlan(rules, draft, { approverSet, ledgerReady, labels });

  function set(field, value) {
    setError('');
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function nextStep() {
    const fields = Object.keys(stepErrors(current.id, draft));
    if (fields.length) {
      setTouched((prev) => ({ ...prev, ...Object.fromEntries(fields.map((key) => [key, true])) }));
      rootRef.current?.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    setDirection('next');
    setStep((value) => Math.min(SETUP_STEPS.length - 1, value + 1));
  }

  function backStep() {
    setDirection('back');
    if (step === 0) {
      setPhase('intro');
      dispatch({ type: 'go', index: SLIDES.length - 1 });
      return;
    }
    setStep((value) => Math.max(0, value - 1));
  }

  function addMerchant(event) {
    event?.preventDefault?.();
    const problem = merchantInputError(adding, draft.merchants);
    if (problem) {
      setAddError(problem);
      return;
    }
    setAddError('');
    set('merchants', [...draft.merchants, adding.trim().toLowerCase()]);
    setAdding('');
  }

  async function connectLedger() {
    setBusy('ledger');
    setError('');
    try {
      prepareLedger();
      const address = await readLedgerAddress();
      set('approver', address);
    } catch (err) {
      setError(err.message || 'The Ledger did not share an address.');
    } finally {
      setBusy('');
    }
  }

  async function save({ lowerOnly = false } = {}) {
    setBusy('save');
    setError('');
    const done = [];
    try {
      const name = String(draft.agentName ?? '').trim();
      await saveProfile({ agentName: name, onboarded: true });
      done.push(`Named the agent ${name}.`);
      if (plan.newApprover) {
        await setApprover(plan.newApprover);
        done.push(`Saved ${shortAddress(plan.newApprover)} as your approver.`);
      }
      const target = lowerOnly ? lowerOnlyDraft(rules, draft) : draft;
      if (lowerOnly && Object.keys(validateDraft(target)).length) {
        throw new Error('Without the raises, the cap would be larger than the budget. Lower the cap too, or connect your Ledger.');
      }
      const finalPlan = setupPlan(rules, target, { approverSet: approverSet || Boolean(plan.newApprover), ledgerReady, labels });
      if (!finalPlan.empty) {
        if (!finalPlan.raises) {
          await lowerAllowance(finalPlan.patch);
          done.push('Lowered the limits. Nothing needed a signature.');
        } else {
          setBusy('sign');
          prepareLedger();
          const challenge = await requestAllowanceChallenge(ledgerProposal(rules, target));
          const signature = await signOnLedger(challenge.typedData, { expectedAddress: challenge.approverAddress });
          await submitAllowance({ signature, message: challenge.typedData.message });
          done.push('Your Ledger signed the new allowance.');
        }
      } else {
        done.push('Kept your current limits.');
      }
      writeIntroDone('done');
      setResult({ lines: done, name });
      setDirection('next');
      setPhase('done');
      onNotice?.(`${name} is set up.`);
      await onSaved?.();
    } catch (err) {
      setError(err.message || 'Setup did not finish. Nothing else changed.');
      if (done.length) setError(`${done.join(' ')} Then: ${err.message || 'the last step did not finish.'}`);
    } finally {
      setBusy('');
    }
  }

  const progress = phase === 'intro'
    ? `Slide ${slide.index + 1} of ${SLIDES.length}`
    : phase === 'setup' ? `Step ${step + 1} of ${SETUP_STEPS.length}` : 'Done';

  return (
    <div className="onboard-back">
      <div
        className={`onboard is-${phase}`}
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={liveId}
        onKeyDown={onKeyDown}
      >
        <header className="onboard-top">
          <div className="onboard-brand">
            <BrandMark size={32} />
            <span>Agent Allowance</span>
          </div>
          {phase !== 'done' ? (
            <button type="button" className="btn text onboard-skip" onClick={() => finish('skipped')}>
              {phase === 'intro' ? 'Skip intro' : 'Finish later'}
            </button>
          ) : null}
        </header>
        <p className="sr-only" id={liveId} aria-live="polite">{progress}</p>

        {phase === 'intro' ? (
          <section className="onboard-intro" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipe.current = null; }}>
            {SLIDES.map((item, index) => {
              const Art = ART[item.id];
              const active = index === slide.index;
              return (
                <article
                  key={item.id}
                  className={`slide is-${item.id}${active ? ` is-active is-from-${direction}` : ''}`}
                  aria-hidden={!active}
                  hidden={!active}
                  aria-roledescription="slide"
                  aria-label={`${index + 1} of ${SLIDES.length}`}
                >
                  <div className="slide-art"><Art /></div>
                  <div className="slide-copy">
                    <p className="slide-kicker">{item.kicker}</p>
                    <h2 id={active ? titleId : undefined} ref={active ? headingRef : undefined} tabIndex={-1}>{item.title}</h2>
                    <p className="slide-body">{item.body}</p>
                  </div>
                </article>
              );
            })}
            <nav className="slide-nav" aria-label="Intro slides">
              <button type="button" className={slide.index === 0 ? 'btn is-placeholder' : 'btn'} onClick={() => move({ type: 'back' })} disabled={slide.index === 0} aria-hidden={slide.index === 0} tabIndex={slide.index === 0 ? -1 : undefined}>Back</button>
              <ol className="dots">
                {SLIDES.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={index === slide.index ? 'dot is-on' : 'dot'}
                      aria-label={`Slide ${index + 1}: ${item.title}`}
                      aria-current={index === slide.index ? 'step' : undefined}
                      onClick={() => move({ type: 'go', index })}
                    />
                  </li>
                ))}
              </ol>
              <button type="button" className="btn primary" onClick={() => move({ type: 'next' })}>
                {slide.index === SLIDES.length - 1 ? 'Set it up' : 'Next'}
              </button>
            </nav>
            <p className="slide-hint" aria-hidden="true">Swipe, or use the arrow keys</p>
          </section>
        ) : null}

        {phase === 'setup' ? (
          <section className={`onboard-setup is-from-${direction}`} key={current.id}>
            <ol className="steps" aria-label="Setup progress">
              {SETUP_STEPS.map((item, index) => (
                <li key={item.id} className={index < step ? 'is-done' : index === step ? 'is-now' : ''} aria-current={index === step ? 'step' : undefined}>
                  <span className="step-n" aria-hidden="true">{index < step ? <IconCheck size={14} /> : index + 1}</span>
                  <span className="step-label">{item.title}</span>
                </li>
              ))}
            </ol>
            <div className="step-body">
              <p className="slide-kicker">Step {step + 1} of {SETUP_STEPS.length}</p>
              <h2 id={titleId} ref={headingRef} tabIndex={-1}>{current.title}</h2>
              <p className="step-hint">{current.hint}</p>
              {offline ? <p className="field-error">The allowance server is offline, so setup cannot be saved yet. You can still look around.</p> : null}

              {current.id === 'name' ? (
                <label className="field" htmlFor={ids.name}>
                  <span className="field-label">Agent name</span>
                  <input
                    id={ids.name}
                    value={draft.agentName}
                    maxLength={40}
                    autoComplete="off"
                    placeholder="Research Scout"
                    onChange={(event) => set('agentName', event.target.value)}
                    onBlur={() => setTouched((prev) => ({ ...prev, agentName: true }))}
                    onKeyDown={(event) => { if (event.key === 'Enter') nextStep(); }}
                    aria-invalid={Boolean(show('agentName'))}
                    aria-describedby={show('agentName') ? `${ids.name}-e` : undefined}
                  />
                  {show('agentName') ? <span className="field-error" id={`${ids.name}-e`}>{errors.agentName}</span> : null}
                  <span className="name-ideas">
                    {['Research Scout', 'Data Buyer', 'Travel Desk'].map((idea) => (
                      <button key={idea} type="button" className="chip" onClick={() => set('agentName', idea)}>{idea}</button>
                    ))}
                  </span>
                </label>
              ) : null}

              {current.id === 'limits' ? (
                <div className="editor-pair">
                  <label className="field" htmlFor={ids.budget}>
                    <span className="field-label">Budget</span>
                    <span className="input-unit">
                      <input id={ids.budget} inputMode="decimal" value={draft.budget} onChange={(event) => set('budget', event.target.value)} onBlur={() => setTouched((prev) => ({ ...prev, budget: true }))} aria-invalid={Boolean(show('budget'))} aria-describedby={`${ids.budget}-h`} />
                      <span aria-hidden="true">RLUSD</span>
                    </span>
                    <span className={show('budget') ? 'field-error' : 'field-hint'} id={`${ids.budget}-h`}>{show('budget') || 'The most it can ever spend.'}</span>
                  </label>
                  <label className="field" htmlFor={ids.cap}>
                    <span className="field-label">Per-purchase cap</span>
                    <span className="input-unit">
                      <input id={ids.cap} inputMode="decimal" value={draft.maxPerPurchase} onChange={(event) => set('maxPerPurchase', event.target.value)} onBlur={() => setTouched((prev) => ({ ...prev, maxPerPurchase: true }))} aria-invalid={Boolean(show('maxPerPurchase'))} aria-describedby={`${ids.cap}-h`} />
                      <span aria-hidden="true">RLUSD</span>
                    </span>
                    <span className={show('maxPerPurchase') ? 'field-error' : 'field-hint'} id={`${ids.cap}-h`}>{show('maxPerPurchase') || 'Above this, it asks you.'}</span>
                  </label>
                  <p className="limit-preview" aria-live="polite">
                    {Number(draft.maxPerPurchase) > 0 && Number(draft.budget) > 0
                      ? `That is up to ${Math.floor(Number(draft.budget) / Number(draft.maxPerPurchase))} purchases at the cap.`
                      : ''}
                  </p>
                </div>
              ) : null}

              {current.id === 'merchants' ? (
                <fieldset className="field merchants-field">
                  <legend className="field-label">Allowed merchants</legend>
                  <ul className="merchant-chips">
                    {draft.merchants.map((address) => (
                      <li key={address} className={rules.allowedMerchants?.some((item) => item.address.toLowerCase() === address) ? 'merchant-chip' : 'merchant-chip is-new'}>
                        <span className="merchant-chip-name">{labels[address] || shortAddress(address)}</span>
                        <code>{shortAddress(address)}</code>
                        <button type="button" className="chip-remove" aria-label={`Remove ${labels[address] || address}`} onClick={() => set('merchants', draft.merchants.filter((item) => item !== address))} disabled={draft.merchants.length <= 1}>
                          <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="add-merchant">
                    <label className="sr-only" htmlFor={ids.add}>Merchant payout address</label>
                    <input id={ids.add} placeholder="0x… payout address" spellCheck={false} autoComplete="off" value={adding} onChange={(event) => { setAdding(event.target.value); setAddError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') addMerchant(event); }} aria-invalid={Boolean(addError)} />
                    <button type="button" className="btn" onClick={addMerchant}>Add</button>
                  </div>
                  {addError ? <span className="field-error">{addError}</span> : <span className="field-hint">Adding a merchant is a raise, so your Ledger signs it at the end.</span>}
                  {show('merchants') ? <span className="field-error">{errors.merchants}</span> : null}
                </fieldset>
              ) : null}

              {current.id === 'expiry' ? (
                <label className="field" htmlFor={ids.expiry}>
                  <span className="field-label">Last day to spend</span>
                  <input id={ids.expiry} type="date" value={draft.expiresOn} onChange={(event) => set('expiresOn', event.target.value)} onBlur={() => setTouched((prev) => ({ ...prev, expiresOn: true }))} aria-invalid={Boolean(show('expiresOn'))} aria-describedby={`${ids.expiry}-h`} />
                  <span className={show('expiresOn') ? 'field-error' : 'field-hint'} id={`${ids.expiry}-h`}>{show('expiresOn') || 'Ends at 23:59 UTC that day.'}</span>
                  <span className="name-ideas">
                    {[['In 30 days', 30], ['In 90 days', 90], ['End of year', 0]].map(([label, days]) => {
                      const date = days ? new Date(Date.now() + days * 86_400_000) : new Date(Date.UTC(new Date().getUTCFullYear(), 11, 31));
                      const value = date.toISOString().slice(0, 10);
                      return <button key={label} type="button" className={draft.expiresOn === value ? 'chip is-on' : 'chip'} onClick={() => set('expiresOn', value)}>{label}</button>;
                    })}
                  </span>
                </label>
              ) : null}

              {current.id === 'approver' ? (
                <div className="approver-step">
                  {approverSet ? (
                    <div className="approver-set">
                      <span className="why-icon is-soft" aria-hidden="true"><IconLock size={16} /></span>
                      <div>
                        <p className="approver-title">Your approver is set</p>
                        <p className="meta"><code>{rules.approverAddress}</code></p>
                        <p className="meta">To change it, edit APPROVER_ADDRESS on the server. The dashboard cannot replace it.</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="btn primary connect-ledger" onClick={connectLedger} disabled={!ledgerReady || busy === 'ledger' || offline} aria-busy={busy === 'ledger'}>
                        {busy === 'ledger' ? 'Waiting for your Ledger…' : draft.approver ? 'Connected. Read again' : 'Connect Ledger'}
                      </button>
                      {!ledgerReady ? <p className="field-hint">Connecting reads the address over USB in Chrome or Edge on a computer. You can paste it instead.</p> : null}
                      <label className="field" htmlFor={ids.approver}>
                        <span className="field-label">Or paste the approver address</span>
                        <input id={ids.approver} spellCheck={false} autoComplete="off" placeholder="0x…" value={draft.approver} onChange={(event) => set('approver', event.target.value.trim())} onBlur={() => setTouched((prev) => ({ ...prev, approver: true }))} aria-invalid={Boolean(show('approver'))} />
                        {show('approver') ? <span className="field-error">{errors.approver}</span> : <span className="field-hint">Set once. After this, only a server-side edit can change it. You can skip this and add it later.</span>}
                      </label>
                    </>
                  )}
                </div>
              ) : null}

              {current.id === 'review' ? (
                <div className="review">
                  <dl className="review-list">
                    <div><dt>Agent</dt><dd>{draft.agentName}</dd></div>
                    <div><dt>Budget</dt><dd>{money(draft.budget)} RLUSD</dd></div>
                    <div><dt>Per purchase</dt><dd>{money(draft.maxPerPurchase)} RLUSD</dd></div>
                    <div><dt>Merchants</dt><dd>{draft.merchants.map((address) => labels[address] || shortAddress(address)).join(', ')}</dd></div>
                    <div><dt>Ends</dt><dd>{dayLabel(draft.expiresOn)}</dd></div>
                    <div><dt>Approver</dt><dd>{rules.approverAddress ? shortAddress(rules.approverAddress) : plan.newApprover ? `${shortAddress(plan.newApprover)} (new)` : 'Not set yet'}</dd></div>
                  </dl>
                  {plan.empty ? <p className="meta">Your limits stay as they are.</p> : (
                    <ul className="diff-list">
                      {plan.changes.map((change) => (
                        <li key={`${change.label}-${change.to}`} className={`diff-row is-${change.direction}`}>
                          <span className="diff-label">{change.label}</span>
                          <span className="diff-values"><span className="diff-from">{change.from}</span><span aria-hidden="true">→</span><span className="diff-to">{change.to}</span></span>
                          <span className={`diff-badge is-${change.direction}`}>{change.direction === 'raise' ? <><IconLock size={14} /> Ledger signs</> : <><IconUnlock size={14} /> Applies now</>}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {plan.blockers.map((line) => <p key={line} className="field-hint">{line}</p>)}
                </div>
              ) : null}

              {error ? <p className="state-error" role="alert">{error}</p> : null}

              <div className="step-actions">
                <button type="button" className="btn" onClick={backStep} disabled={Boolean(busy)}>Back</button>
                {current.id !== 'review' ? (
                  <button type="button" className="btn primary" onClick={nextStep}>
                    {current.id === 'approver' && !approverSet && !draft.approver ? 'Skip for now' : 'Continue'}
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn primary" onClick={() => save()} disabled={Boolean(busy) || offline || !plan.canSaveAll} aria-busy={Boolean(busy)}>
                      {busy === 'sign' ? 'Confirm on your Ledger…' : busy === 'save' ? 'Saving…' : plan.raises ? 'Sign with Ledger and finish' : 'Finish setup'}
                    </button>
                    {!plan.canSaveAll ? (
                      <button type="button" className="btn" onClick={() => save({ lowerOnly: true })} disabled={Boolean(busy) || offline}>
                        Finish without the raises
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {phase === 'done' ? (
          <section className="onboard-done">
            <div className="done-mark" aria-hidden="true"><BrandMark size={88} /></div>
            <h2 id={titleId} ref={headingRef} tabIndex={-1}>{result?.name || 'Your agent'} is ready</h2>
            <ul className="done-list">
              {(result?.lines ?? []).map((line) => <li key={line}><IconCheck size={16} /> {line}</li>)}
            </ul>
            <p className="step-hint">The agent now pays only inside these rules. Anything else waits for you.</p>
            <button type="button" className="btn primary" onClick={() => finish('done')}>Go to my dashboard</button>
          </section>
        ) : null}
      </div>
    </div>
  );
}
