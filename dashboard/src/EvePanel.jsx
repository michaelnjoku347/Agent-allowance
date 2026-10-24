import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useRef, useState } from 'react';
import { askEve, confirmEve } from './api.js';
import { money } from './format.js';
import { MicIcon, SendIcon, SparkIcon, SpeakerIcon } from './icons.jsx';

function chips(ledger, paused) {
  return [
    'How much is left?',
    ledger.pending.length ? 'Approve pending' : null,
    paused ? 'Resume agent' : 'Pause agent',
    ledger.pending.length ? 'Why was the last one blocked?' : null,
    'What did my agent spend today?',
    'Set my cap to 3',
  ].filter(Boolean);
}

const YES = /^(yes|yeah|yep|confirm|ok|okay)$/i;

function speechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/**
 * Questions the page can answer from the numbers it already shows, so Eve's
 * balance matches the hero exactly. Pause lives on this dashboard only.
 * Everything else goes to the server.
 */
function localAnswer(text, { ledger, paused, onPause, onResume }) {
  const lower = text.toLowerCase();
  if (/\b(left|remaining|balance)\b/.test(lower) && !/\bcap\b|\bbudget\b.*\d/.test(lower)) {
    const sample = ledger.preview ? ' These are sample purchases. No real RLUSD has moved yet.' : '';
    return `${money(ledger.left)} of ${money(ledger.budget)} RLUSD is left. ${money(ledger.spent)} RLUSD is spent across ${ledger.paidCount} purchase${ledger.paidCount === 1 ? '' : 's'}.${sample}`;
  }
  if (/\b(pause|stop)\b.*\bagent\b|^pause\b/.test(lower)) {
    if (paused) return 'The agent is already paused. Say "resume agent" when you want it back.';
    onPause();
    return 'Paused. Run agent is off on this dashboard until you resume. The agent never runs on its own.';
  }
  if (/\b(resume|unpause|restart)\b/.test(lower)) {
    if (!paused) return 'The agent is not paused. Press Run agent on Home to start a purchase.';
    onResume();
    return 'Resumed. Run agent is back on Home.';
  }
  return null;
}

export default function EvePanel({ ledger, paused, onPause, onResume, onChanged }) {
  const transcriptId = useId();
  const [messages, setMessages] = useState([
    {
      role: 'eve',
      text: 'Hi, I\'m Eve. Ask what\'s left, why something was blocked, or what is waiting. I always ask before I approve, decline, or change a rule.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
  const contextRef = useRef(null);
  voiceRef.current = voiceMode;
  confirmRef.current = confirmation;
  contextRef.current = { ledger, paused, onPause, onResume };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
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

  function reply(text) {
    setMessages((current) => [...current, { role: 'eve', text }]);
    speak(text, () => {
      if (voiceRef.current) startListening();
    });
  }

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft('');
    setError('');
    setMessages((current) => [...current, { role: 'you', text: message }]);
    const local = localAnswer(message, contextRef.current);
    if (local) {
      reply(local);
      return;
    }
    setBusy(true);
    try {
      const body = await askEve(message);
      setMessages((current) => [...current, { role: 'eve', text: body.reply }]);
      setConfirmation(body.confirmation ?? null);
      speak(body.confirmation ? `${body.reply} ${body.confirmation.summary}` : body.reply, () => {
        if (voiceRef.current) startListening();
      });
    } catch (err) {
      setError(err.message || 'Eve could not answer. Is the server running?');
    } finally {
      setBusy(false);
    }
  }

  async function accept(card) {
    if (!card || busy) return;
    setBusy(true);
    setError('');
    try {
      const body = await confirmEve(card.token);
      setConfirmation(null);
      reply(body.reply);
      onChanged?.();
    } catch (err) {
      setError(err.message || 'That confirmation did not go through.');
    } finally {
      setBusy(false);
    }
  }

  const micLabel = listening ? 'Stop listening' : speaking ? 'Eve is speaking. Tap to talk' : 'Tap to talk to Eve';

  return (
    <section className="eve-screen" aria-labelledby="eve-title">
      <header className="eve-head">
        <span className={listening ? 'eve-orb is-live' : speaking ? 'eve-orb is-speaking' : 'eve-orb'} aria-hidden="true"><SparkIcon size={24} /></span>
        <div>
          <h1 id="eve-title">Eve</h1>
          <p>Your allowance assistant. Nothing changes until you confirm.</p>
        </div>
      </header>
      <ul className="eve-context" aria-label="What Eve can see">
        <li><strong>{money(ledger.left)}</strong> left</li>
        <li><strong>{ledger.pending.length}</strong> waiting</li>
        <li><strong>{money(ledger.cap)}</strong> cap</li>
        <li>{paused ? 'Agent paused' : 'Agent active'}</li>
      </ul>

      <div className="transcript" id={transcriptId} role="log" aria-live="polite" aria-label="Conversation with Eve">
        <AnimatePresence initial={false}>
          {messages.map((message, index) => (
            <motion.div
              key={`${message.role}-${index}`}
              className={`bubble ${message.role}`}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            >
              <span className="sr-only">{message.role === 'you' ? 'You said: ' : 'Eve said: '}</span>
              {message.text}
            </motion.div>
          ))}
        </AnimatePresence>
        {interim ? <div className="bubble you interim" aria-hidden="true">{interim}…</div> : null}
        {busy ? <div className="bubble eve typing" role="status" aria-label="Eve is thinking"><span /><span /><span /></div> : null}
        {confirmation ? (
          <div className="confirm" role="group" aria-label="Confirm this change">
            <p>{confirmation.summary}</p>
            <div className="need-actions">
              <button type="button" className="btn primary" onClick={() => accept(confirmation)} disabled={busy}>Confirm</button>
              <button type="button" className="btn" onClick={() => setConfirmation(null)} disabled={busy}>Cancel</button>
            </div>
            {supported ? <p className="meta">Or say “yes”.</p> : null}
          </div>
        ) : null}
        <div ref={bottomRef} className="transcript-end" />
      </div>

      <div className="eve-dock">
        <div className="suggest" role="group" aria-label="Suggestions">
          {chips(ledger, paused).map((chip) => (
            <button key={chip} type="button" className="suggest-chip" onClick={() => send(chip)} disabled={busy}>{chip}</button>
          ))}
        </div>

        {supported ? (
          <div className="mic-wrap">
            <button
              type="button"
              className={listening ? 'mic-big is-on' : speaking ? 'mic-big is-speaking' : 'mic-big'}
              aria-pressed={listening}
              aria-label={micLabel}
              onClick={() => (listening ? stopListening() : startListening())}
              disabled={denied}
            >
              <span className="mic-pulse" aria-hidden="true" />
              <MicIcon size={34} />
            </button>
            {listening || speaking ? (
              <span className={speaking ? 'wave speaking' : 'wave'} aria-hidden="true">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => <span key={i} style={{ animationDelay: `${i * 0.09}s` }} />)}
              </span>
            ) : null}
            <p className="mic-state" role="status">
              {denied ? 'Microphone blocked' : listening ? 'Listening…' : speaking ? 'Speaking…' : 'Tap to talk'}
            </p>
          </div>
        ) : null}

        <form className="composer" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
          <label className="sr-only" htmlFor="eve-message">Message Eve</label>
          <input
            id="eve-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={supported ? 'Or type a message' : 'Message Eve'}
            autoComplete="off"
            disabled={busy}
          />
          <button type="submit" className="send" aria-label="Send" disabled={busy || !draft.trim()}>
            <SendIcon size={20} />
          </button>
        </form>

        {supported ? (
          <details className="voice-settings">
            <summary><SpeakerIcon size={18} /> Voice settings</summary>
            <div className="voice-row">
              <button
                type="button"
                className="btn small"
                aria-pressed={voiceMode}
                onClick={() => {
                  const next = !voiceMode;
                  setVoiceMode(next);
                  if (!next) {
                    stopListening();
                    stopSpeaking();
                  }
                }}
              >
                Read replies aloud: {voiceMode ? 'On' : 'Off'}
              </button>
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
              <button type="button" className="btn small" onClick={stopSpeaking} disabled={!speaking}>Stop speaking</button>
            </div>
          </details>
        ) : (
          <p className="meta center">Voice input is not supported in this browser. Type instead.</p>
        )}
        {denied ? (
          <p className="banner warn inline" role="alert">
            The microphone is blocked. Allow it in the browser site settings, then reload this page.
          </p>
        ) : null}
        {error ? <p className="banner warn inline" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
