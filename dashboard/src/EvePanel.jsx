import { useEffect, useId, useRef, useState } from 'react';
import { askEve, confirmEve } from './api.js';

const CHIPS = [
  'What did my agent spend today?',
  'Why was the last one blocked?',
  'Approve the pending purchase',
  'Set my cap to 3',
];

const YES = /^(yes|yeah|yep|confirm|ok|okay)$/i;

function speechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default function EvePanel({ active }) {
  const listId = useId();
  const [messages, setMessages] = useState([
    {
      role: 'eve',
      text: 'I can explain a blocked purchase, total what was spent, or prepare a change. I will ask before I approve, decline, or edit the rules.',
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
  voiceRef.current = voiceMode;
  confirmRef.current = confirmation;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
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
      setMessages((current) => [...current, { role: 'eve', text: body.reply }]);
      setConfirmation(body.confirmation ?? null);
      speak(body.confirmation ? `${body.reply} ${body.confirmation.summary}` : body.reply, () => {
        if (voiceRef.current) startListening();
      });
    } catch (err) {
      setError(err.message || 'Eve could not answer.');
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
      setMessages((current) => [...current, { role: 'eve', text: body.reply }]);
      speak(body.reply, () => {
        if (voiceRef.current) startListening();
      });
    } catch (err) {
      setError(err.message || 'That confirmation did not go through.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="eve" aria-label="Eve">
      <header className="section-head">
        <h2>Eve</h2>
        <p>Ask in text{supported ? ' or by voice' : ''}. Changes wait for you to confirm.</p>
      </header>
      <div className="transcript" id={listId} aria-live="polite" aria-relevant="additions">
        {messages.map((message, index) => (
          <p key={`${message.role}-${index}`} className={message.role === 'you' ? 'bubble you' : 'bubble eve'}>
            <span className="who">{message.role === 'you' ? 'You' : 'Eve'}</span>
            {message.text}
          </p>
        ))}
        {interim ? <p className="bubble you interim"><span className="who">You</span>{interim}</p> : null}
        <div ref={bottomRef} />
      </div>
      {confirmation ? (
        <div className="confirm" role="group" aria-label="Confirmation">
          <p>{confirmation.summary}</p>
          <div className="pair">
            <button type="button" className="btn primary" onClick={() => accept(confirmation)} disabled={busy}>Confirm</button>
            <button type="button" className="btn" onClick={() => setConfirmation(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : null}
      <div className="chips">
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
            className={listening ? 'btn mic is-on' : 'btn mic'}
            aria-pressed={listening}
            aria-label={listening ? 'Stop voice input' : 'Start voice input'}
            onClick={() => (listening ? stopListening() : startListening())}
          >
            <MicIcon />
            <span>{listening ? 'Listening' : 'Mic'}</span>
          </button>
        ) : null}
      </form>
      {supported ? (
        <div className="voice-row">
          <button
            type="button"
            className="btn"
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
            Voice mode {voiceMode ? 'on' : 'off'}
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
          <button type="button" className="btn" onClick={stopSpeaking} disabled={!speaking}>Stop</button>
          {listening ? <p className="listen-state" role="status">Listening</p> : null}
          {speaking ? <p className="listen-state" role="status">Speaking</p> : null}
        </div>
      ) : (
        <p className="note">Voice input not supported in this browser — type instead.</p>
      )}
      {denied ? (
        <p className="note" role="alert">
          The microphone is blocked. Allow it in the browser site settings, then reload this page.
        </p>
      ) : null}
      {error ? <p className="note warn" role="alert">{error}</p> : null}
    </section>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.1A5 5 0 0 0 17 11z" />
    </svg>
  );
}
