/**
 * Live updates for the dashboard over Server-Sent Events.
 *
 * The agent runs in its own process and writes the same store file, so the
 * stream watches that file rather than an in-memory emitter. Each change sends
 * `change` (reload the snapshot) and, when it moved, `stage` (where the current
 * purchase is on the payment path). The dashboard keeps its 3s poll as a
 * fallback whenever the stream is down.
 */

import { readFileSync, statSync } from 'node:fs';
import { storeFile } from './store.js';

const LIVE_TTL_MS = 60_000;
const LEDGER_PHASES = new Set(['signed', 'broadcasting', 'settling']);

function newestRowMs(store) {
  let newest = 0;
  for (const row of [...(store.payments ?? []), ...(store.pending ?? [])]) {
    if (!row || row.sample) continue;
    const at = Date.parse(row.updatedAt || row.createdAt || 0);
    if (at > newest) newest = at;
  }
  return newest;
}

/**
 * The stage to light on the payment path, or null when nothing is in flight.
 * A Ledger-approved payment reports its own phase. An agent purchase reports
 * the stage it last wrote, until a newer activity row or a minute replaces it.
 */
export function stageFromStore(store, nowMs = Date.now()) {
  const paying = (store?.pending ?? []).find((row) => row && !row.sample && row.status === 'paying');
  if (paying) {
    const phase = LEDGER_PHASES.has(paying.paymentPhase) ? paying.paymentPhase : 'signed';
    return {
      source: 'ledger',
      id: paying.id,
      phase,
      task: paying.task ?? null,
      amount: paying.amount ?? null,
      merchantLabel: paying.merchantLabel ?? null,
    };
  }
  const live = store?.live;
  if (!live || !live.stage) return null;
  const at = Date.parse(live.at || 0);
  if (!at || nowMs - at > LIVE_TTL_MS || newestRowMs(store) > at) return null;
  return {
    source: 'agent',
    stage: live.stage,
    task: live.task ?? null,
    amount: live.amount ?? null,
    merchantLabel: live.merchantLabel ?? null,
  };
}

function readStoreFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function fileVersion(path) {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

/**
 * One watcher shared by every open stream. It only polls the file's mtime
 * while someone is listening.
 */
export function createStoreEvents({ intervalMs = 250, path = () => storeFile(), now = () => Date.now() } = {}) {
  const listeners = new Set();
  let timer = null;
  let version = null;
  let lastStage = 'null';

  function emit(type, data) {
    for (const listener of listeners) listener({ type, data });
  }

  function check() {
    const file = path();
    const next = fileVersion(file);
    const stage = stageFromStore(readStoreFile(file) ?? {}, now());
    const stageKey = JSON.stringify(stage);
    if (version !== null && next !== version) emit('change', { version: next });
    if (stageKey !== lastStage) emit('stage', stage);
    version = next;
    lastStage = stageKey;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!timer) {
        version = fileVersion(path());
        lastStage = 'null';
        check();
        timer = setInterval(check, intervalMs);
        timer.unref?.();
      } else {
        // A new tab gets the current stage at once instead of waiting for a change.
        listener({ type: 'stage', data: JSON.parse(lastStage) });
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    check,
    get listening() {
      return listeners.size;
    },
  };
}
