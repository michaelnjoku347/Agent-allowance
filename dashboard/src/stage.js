/**
 * Browser extras for the pitch. Each one no-ops when the browser refuses it.
 * Voice and tones share one mute switch.
 */

import { toneFor } from './present.js';

const VOICE_KEY = 'allowance-voice';

export function readVoiceEnabled(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(VOICE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeVoiceEnabled(on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(VOICE_KEY, on ? 'on' : 'off');
  } catch {
    /* Private browsing can block storage. The switch still works this visit. */
  }
}

export function speakLine(text) {
  if (!text || typeof window === 'undefined') return;
  const synth = window.speechSynthesis;
  if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return;
  try {
    synth.cancel();
    const utter = new window.SpeechSynthesisUtterance(String(text));
    utter.rate = 1;
    utter.onerror = () => {};
    synth.speak(utter);
  } catch {
    /* The browser refused speech. The cards still show the result. */
  }
}

export function stopSpeech() {
  try {
    window.speechSynthesis?.cancel?.();
  } catch {
    /* Already stopped. */
  }
}

export function playTone(kind) {
  const tone = toneFor(kind);
  if (!tone || typeof window === 'undefined') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!playTone.ctx) playTone.ctx = new Ctx();
    const ctx = playTone.ctx;
    ctx.resume?.().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = tone.frequency;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(tone.gain, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.duration);
    osc.start(now);
    osc.stop(now + tone.duration + 0.02);
  } catch {
    /* Autoplay or a missing device. The screen still updates. */
  }
}

export async function setPresentation(on) {
  const root = document.querySelector('.app');
  if (root) root.classList.toggle('is-present', Boolean(on));
  if (!on) {
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
    } catch {
      /* Fullscreen was already left. */
    }
    return false;
  }
  try {
    if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  } catch {
    /* Larger type still applies when fullscreen is refused. */
  }
  return true;
}
