import { useEffect, useId, useRef, useState } from 'react';
import { askEve, confirmEve, requestAllowanceChallenge, submitAllowance } from './api.js';
import BedrockMark from './BedrockMark.jsx';
import { prepareLedger, signOnLedger } from './ledger.js';
import { EveMark, IconChevron, IconMic, IconMinus } from './icons.jsx';

const CHIPS = [
  'What did my agent spend today?',
  'Why was the last one blocked?',
  'What is waiting for approval?',
  'Set my cap to 0.03',
];

const YES = /^(yes|yeah|yep|confirm|ok|okay)$/i;
const DOCK_KEY = 'allowance-eve';
const CHAT_KEY = 'allowance-eve-chat';
const HELLO = 'Ask what was spent, why a quote was blocked, or to change a rule. I ask before I change anything.';

function readChat() {
  try {
    const raw = sessionStorage.getItem(CHAT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return null;
    const messages = parsed.filter((item) => (
      item && typeof item.text === 'string' && (item.role === 'eve' || item.role === 'you')
    ));
    if (messages.length) return messages.slice(-40);
  } catch {
    /* Private browsing can block storage. The chat still lasts while Eve stays mounted. */
  }
  return null;
}

function speechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function mobileDock() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 959px)').matches;
}

function readMode() {
  try {
    const saved = localStorage.getItem(DOCK_KEY);
    if (saved === 'min' || saved === 'open' || saved === 'peek') return saved;
  } catch {
    /* Private browsing can block storage. */
  }
  return 'min';
}

function focusable(root) {
  if (!root) return [];
  return [...root.querySelectorAll('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.disabled && node.getAttribute('aria-hidden') !== 'true');
}

export function EveDock({ seed, onSeedHandled, presenting = false }) {
  const panelId = useId();
  const panelRef = useRef(null);
  const pillRef = useRef(null);
  const modeRef = useRef(readMode());
  const [mode, setMode] = useState(modeRef.current);
  const [unread, setUnread] = useState(0);
  const dragRef = useRef({ y: 0, dragged: false });
  const [status, setStatus] = useState({ listening: false, speaking: false });
  const [announcement, setAnnouncement] = useState('');
  modeRef.current = mode;

  useEffect(() => {
    try {
      localStorage.setItem(DOCK_KEY, mode);
    } catch {
      /* Private browsing can block storage. The choice still applies this visit. */
    }
  }, [mode]);

  useEffect(() => {
    if (presenting) setMode('min');
  }, [presenting]);

  useEffect(() => {
    if (!seed || presenting) return undefined;
    setMode('open');
    setUnread(0);
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector('#eve-message')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [seed, presenting]);

  function minimize() {
    setMode('min');
    requestAnimationFrame(() => {
      // On a phone the pill is hidden and Eve lives in the app bar, so focus goes back there.
      const pill = pillRef.current;
      if (pill && pill.offsetParent !== null) pill.focus();
      else document.querySelector('.eve-launch')?.focus();
    });
  }

  function expand() {
    if (presenting) return;
    const next = mobileDock() ? 'peek' : 'open';
    setMode(next);
    setUnread(0);
    requestAnimationFrame(() => {
      panelRef.current?.querySelector('#eve-message')?.focus();
    });
  }

  const expandRef = useRef(expand);
  expandRef.current = expand;

  // The phone app bar opens Eve with an event, and shows her unread count.
  useEffect(() => {
    const open = () => expandRef.current();
    window.addEventListener('eve:open', open);
    return () => window.removeEventListener('eve:open', open);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('eve:unread', { detail: unread }));
  }, [unread]);

  function expandFull() {
    setMode('open');
    setUnread(0);
    requestAnimationFrame(() => {
      panelRef.current?.querySelector('#eve-message')?.focus();
    });
  }

  function onGrabDown(event) {
    if (!mobileDock() || event.button > 0) return;
    dragRef.current = { y: event.clientY, dragged: false };
    function move(next) {
      const dy = dragRef.current.y - next.clientY;
      if (dy > 28) {
        dragRef.current.dragged = true;
        expandFull();
        cleanup();
      } else if (dy < -28 && modeRef.current === 'open') {
        dragRef.current.dragged = true;
        setMode('peek');
        cleanup();
      }
    }
    function up() { cleanup(); }
    function cleanup() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onGrabClick() {
    if (!mobileDock() || dragRef.current.dragged) return;
    if (modeRef.current === 'peek') expandFull();
    else setMode('peek');
  }

  useEffect(() => {
    const root = panelRef.current;
    if (!root || mode === 'min') return undefined;
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        minimize();
        return;
      }
      const mobile = mobileDock();
      if (!mobile || mode !== 'open' || event.key !== 'Tab') return;
      const items = focusable(root);
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
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [mode]);

  function onReply(text) {
    setAnnouncement(text);
    if (modeRef.current === 'min') setUnread((count) => count + 1);
    if (modeRef.current === 'peek') setMode('open');
  }

  const stateLabel = status.listening ? 'Listening' : status.speaking ? 'Speaking' : 'Allowance assistant';
  const pillLabel = status.listening
    ? 'Eve, listening. Expand chat'
    : status.speaking
      ? 'Eve, speaking. Expand chat'
      : unread
        ? `Eve, ${unread} new ${unread === 1 ? 'reply' : 'replies'}. Expand chat`
        : 'Expand Eve';

  return (
    <div className={`eve-dock is-${mode}`}>
      <section
        className={`eve-window is-${mode}`}
        id={panelId}
        ref={panelRef}
        role="region"
        aria-label="Eve"
        hidden={mode === 'min'}
      >
        <button
          type="button"
          className="eve-grab"
          aria-label={mode === 'peek' ? 'Expand Eve' : 'Show the compact Eve chat'}
          onPointerDown={onGrabDown}
          onClick={onGrabClick}
        />
        <header className="eve-head">
          <EveMark size={32} />
          <div className="eve-id">
            <h2>Eve</h2>
            <p className={status.listening || status.speaking ? 'is-live' : ''}>{stateLabel}</p>
          </div>
          <div className="eve-tools">
            {mode === 'peek' ? (
              <button type="button" className="icon-btn eve-min" aria-label="Expand Eve" onClick={expandFull}>
                <IconChevron />
              </button>
            ) : null}
            <button type="button" className="icon-btn eve-min" aria-label="Minimize Eve" onClick={minimize}>
              <IconMinus />
            </button>
          </div>
        </header>
        <EvePanel
          seed={seed}
          onSeedHandled={onSeedHandled}
          onStatus={setStatus}
          onReply={onReply}
        />
      </section>
      <button
        type="button"
        className="eve-pill"
        ref={pillRef}
        hidden={mode !== 'min'}
        aria-expanded="false"
        aria-controls={panelId}
        aria-label={announcement ? `${pillLabel}. ${announcement}` : pillLabel}
        onClick={expand}
      >
        <EveMark size={28} />
        <span className="eve-pill-name">Eve</span>
        {status.listening || status.speaking ? <span className="eve-pill-state">{stateLabel}</span> : null}
        {unread > 0 ? <span className="eve-badge" aria-hidden="true">{unread}</span> : null}
      </button>
    </div>
  );
}

export default function EvePanel({ seed, onSeedHandled, onStatus, onReply }) {
  const listId = useId();
  const [messages, setMessages] = useState(() => readChat() ?? [{ role: 'eve', text: HELLO }]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedText, setFailedText] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [rate, setRate] = useState(1);
  const [denied, setDenied] = useState(false);
  const Recognition = speechRecognition();
  const supported = Boolean(Recognition);
  const recognitionRef = useRef(null);
  const voiceRef = useRef(false);
  const confirmRef = useRef(null);
  const bottomRef = useRef(null);
  const handledSeed = useRef(null);
  voiceRef.current = voiceMode;
  confirmRef.current = confirmation;

  useEffect(() => {
    onStatus?.({ listening, speaking });
  }, [listening, speaking, onStatus]);

  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* The mounted panel still keeps the thread if storage is blocked. */
    }
  }, [messages]);

  useEffect(() => {
    const node = bottomRef.current;
    if (!node || node.closest('[hidden]')) return;
    node.scrollIntoView({ block: 'nearest' });
  }, [messages, interim, confirmation]);

  useEffect(() => () => {
    recognitionRef.current?.stop?.();
    window.speechSynthesis?.cancel?.();
  }, []);

  function stopSpeaking() {
    window.speechSynthesis?.cancel?.();
    setSpeaking(false);
  }

  function speak(text, after) {
    if (!voiceRef.current || !window.speechSynthesis || !text) {
      after?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = rate;
    setSpeaking(true);
    utter.onend = () => {
      setSpeaking(false);
      after?.();
    };
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }

  function stopListening() {
    recognitionRef.current?.stop?.();
    setListening(false);
    setInterim('');
  }

  function startListening() {
    if (!Recognition || denied) return;
    stopSpeaking();
    const recognition = recognitionRef.current ?? new Recognition();
    recognitionRef.current = recognition;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.onstart = () => {
      window.speechSynthesis?.cancel?.();
      setSpeaking(false);
      setListening(true);
    };
    recognition.onresult = (event) => {
      let finalText = '';
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript ?? '';
        if (event.results[i].isFinal) finalText += piece;
        else live += piece;
      }
      setInterim(live);
      const said = finalText.trim();
      if (said) {
        setInterim('');
        if (confirmRef.current && YES.test(said)) {
          setMessages((current) => [...current, { role: 'you', text: said }]);
          accept(confirmRef.current);
          return;
        }
        send(said);
      }
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setDenied(true);
        setVoiceMode(false);
      }
    };
    recognition.onend = () => setListening(false);
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  }

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft('');
    setError('');
    setMessages((current) => [...current, { role: 'you', text: message }]);
    setBusy(true);
    try {
      const body = await askEve(message);
      setMessages((current) => [...current, { role: 'eve', text: body.reply, bedrock: body.bedrock === true }]);
      onReply?.(body.reply);
      setConfirmation(body.confirmation ?? null);
      speak(body.confirmation ? `${body.reply} ${body.confirmation.summary}` : body.reply, () => {
        if (voiceRef.current) startListening();
      });
    } catch (err) {
      setFailedText(message);
      setError(err.message || 'Eve could not answer.');
    } finally {
      setBusy(false);
    }
  }

  async function accept(card) {
    if (!card || busy) return;
    if (card.ledger) {
      setBusy(true);
      setError('');
      try {
        prepareLedger();
        const challenge = await requestAllowanceChallenge(card.proposal);
        const signature = await signOnLedger(challenge.typedData, {
          expectedAddress: challenge.approverAddress,
        });
        const body = await submitAllowance({
          signature,
          message: challenge.typedData.message,
        });
        setConfirmation(null);
        const text = body.note || 'Allowance raised after a Ledger signature. Nothing was paid.';
        setMessages((current) => [...current, { role: 'eve', text }]);
        onReply?.(text);
        speak(text, () => {
          if (voiceRef.current) startListening();
        });
      } catch (err) {
        setError(err.message || 'The Ledger did not sign that change.');
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = await confirmEve(card.token);
      setConfirmation(null);
      setMessages((current) => [...current, { role: 'eve', text: body.reply }]);
      onReply?.(body.reply);
      speak(body.reply, () => {
        if (voiceRef.current) startListening();
      });
    } catch (err) {
      setError(err.message || 'That confirmation did not go through.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!seed || handledSeed.current === seed.id) return;
    handledSeed.current = seed.id;
    send(seed.text);
    onSeedHandled?.();
  }, [seed]);

  function toggleVoice() {
    const next = !voiceMode;
    setVoiceMode(next);
    if (!next) {
      stopListening();
      stopSpeaking();
    }
  }

  return (
    <div className="eve">
      <div className="transcript" id={listId} role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message, index) => (
          <p key={`${message.role}-${index}`} className={message.role === 'you' ? 'bubble you' : 'bubble eve'}>
            <span className="who">{message.role === 'you' ? 'You' : 'Eve'}</span>
            {message.text}
            {message.bedrock ? <BedrockMark /> : null}
          </p>
        ))}
        {interim ? <p className="bubble you interim"><span className="who">You</span>{interim}</p> : null}
        <div ref={bottomRef} />
      </div>
      {confirmation ? (
        <div className="confirm" role="group" aria-label="Confirmation">
          <p>{confirmation.summary}</p>
          <div className="pair">
            <button type="button" className="btn primary" onClick={() => accept(confirmation)} disabled={busy}>
              {confirmation.ledger ? 'Sign on Ledger' : 'Confirm'}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmation(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : null}
      <div className="chips" aria-label="Suggestions">
        {CHIPS.map((chip) => (
          <button key={chip} type="button" className="chip" onClick={() => send(chip)} disabled={busy}>{chip}</button>
        ))}
      </div>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
        <label className="sr-only" htmlFor="eve-message">Message Eve</label>
        <input
          id="eve-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask Eve"
          autoComplete="off"
          disabled={busy}
        />
        <button type="submit" className="btn primary" disabled={busy || !draft.trim()}>Send</button>
        {supported ? (
          <button
            type="button"
            className={listening ? 'mic-btn is-on' : 'mic-btn'}
            aria-pressed={listening}
            aria-label={listening ? 'Stop voice input' : 'Start voice input'}
            onClick={() => (listening ? stopListening() : startListening())}
          >
            <IconMic />
          </button>
        ) : null}
      </form>
      {supported ? (
        <div className="voice-row">
          <button
            type="button"
            className="voice-toggle"
            aria-pressed={voiceMode}
            onClick={toggleVoice}
          >
            <span className="switch" aria-hidden="true" />
            Read replies
          </button>
          {voiceMode ? (
            <label className="rate">
              Speech rate
              <input
                type="range"
                min="0.8"
                max="1.4"
                step="0.1"
                value={rate}
                onChange={(event) => setRate(Number(event.target.value))}
              />
            </label>
          ) : null}
          {voiceMode ? (
            <button type="button" className="btn" onClick={stopSpeaking} disabled={!speaking}>Stop</button>
          ) : null}
        </div>
      ) : (
        <p className="note">Voice input is not available in this browser. Type instead.</p>
      )}
      {denied ? (
        <p className="note" role="alert">
          The microphone is blocked. Allow it in the browser site settings, then reload this page.
        </p>
      ) : null}
      {error ? (
        <div className="state-error" role="alert">
          <p className="state-error-title">Eve is offline</p>
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => send(failedText)} disabled={busy || !failedText}>Retry</button>
        </div>
      ) : null}
    </div>
  );
}
