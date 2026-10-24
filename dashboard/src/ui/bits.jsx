import { useEffect, useState } from 'react';
import { money, shortAddress } from '../format.js';
import { status } from '../ledger.js';
import { plainReason } from '../../../shared/words.js';
import { BlockIcon, CheckIcon, ClockIcon, CopyIcon } from '../icons.jsx';

export function merchantName(item) {
  return item.merchantLabel || shortAddress(item.merchant) || 'Merchant';
}

function hue(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Short tag for why a quote stopped, e.g. "Over 5.00 cap". */
export function reasonTag(item, cap) {
  switch (item.reason) {
    case 'over per-purchase cap': return `Over ${money(cap)} cap`;
    case 'merchant not allowed': return 'Unapproved merchant';
    case 'over budget': return 'Over budget';
    case 'expired': return 'Allowance expired';
    case 'over channel cap': return 'Channel limit';
    case 'Jev flagged for review': return 'Flagged by Jev';
    default: return item.reason ? plainReason(item.reason) : 'Outside the rules';
  }
}

export function Avatar({ name, size }) {
  const letters = String(name || '?').replace(/^0x/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className={size === 'sm' ? 'avatar sm' : 'avatar'} style={{ '--h': hue(name) }} aria-hidden="true">
      {letters}
    </span>
  );
}

export function StatusPill({ item }) {
  const s = status(item);
  const Icon = s.key === 'paid' ? CheckIcon : s.key === 'blocked' ? BlockIcon : ClockIcon;
  return (
    <span className={`pill ${s.tone}`}>
      <Icon size={14} />
      {s.label}
    </span>
  );
}

export function CopyButton({ value, label }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(t);
  }, [done]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
    } catch {
      /* Clipboard can be blocked outside HTTPS. The value is still on screen. */
    }
  }
  return (
    <button type="button" className={done ? 'copy is-done' : 'copy'} onClick={copy} aria-label={done ? `${label} copied` : `Copy ${label}`}>
      {done ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
    </button>
  );
}

export function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const list = window.matchMedia(query);
    const on = () => setMatches(list.matches);
    on();
    list.addEventListener('change', on);
    return () => list.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
