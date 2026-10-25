/**
 * Keeping the dashboard connected, and saying so in plain words when it is not.
 * Pure helpers plus a reconnecting event stream. No React here.
 */

/** Exponential backoff with full jitter: 1s, 2s, 4s … capped at 30s. */
export function backoffDelay(attempt, { base = 1000, max = 30_000, random = Math.random } = {}) {
  const step = Math.max(0, Math.floor(Number(attempt) || 0));
  const ceiling = Math.min(max, base * 2 ** Math.min(step, 16));
  // Never below half the step, so a burst of tabs does not hammer the API in sync.
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

/** What kind of failure a fetch produced, so the banner can say something true. */
export function failureKind(error) {
  if (!error) return 'unknown';
  if (error.kind) return error.kind;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'timeout';
  if (error instanceof TypeError) return 'unreachable';
  const status = Number(error.status);
  if (status === 429) return 'busy';
  if (status === 503 && error.code === 'rules_unavailable') return 'rules';
  if (status >= 500) return 'server';
  return 'unknown';
}

function seconds(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s} second${s === 1 ? '' : 's'}`;
}

function ago(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'a moment ago';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

/**
 * One banner for the top of the page, or null when everything answers.
 *
 *   connection   'loading' | 'online' | 'offline'
 *   preview      true when the page fell back to the bundled example rows
 *   kind         failureKind() of the last failed refresh
 *   lastOkAt     ms of the last good refresh
 *   retryInMs    when the next attempt runs
 *   health       body of GET /api/health, when it answered
 */
export function describeConnection({ connection, preview = false, kind = '', lastOkAt = 0, retryInMs = 0, health = null, now = Date.now() } = {}) {
  if (connection === 'loading') return null;
  if (connection === 'offline') {
    const retry = retryInMs > 0 ? ` Trying again in ${seconds(retryInMs)}.` : '';
    if (kind === 'rules') {
      return {
        tone: 'danger',
        title: 'Payments are stopped',
        body: `The allowance rules could not be read, so the agent cannot pay. Check agent/rules.json, then retry.${retry}`,
        action: 'Retry now',
      };
    }
    if (kind === 'busy') {
      return {
        tone: 'warn',
        title: 'Slowing down',
        body: `The allowance server asked the page to wait.${retry}`,
        action: 'Retry now',
      };
    }
    if (preview) {
      return {
        tone: 'warn',
        title: 'Can’t reach the allowance server',
        body: `You are looking at example rows. Start the server with npm start.${retry}`,
        action: 'Retry now',
      };
    }
    const stale = lastOkAt ? ` These numbers are from ${ago(now - lastOkAt)}.` : '';
    return {
      tone: 'warn',
      title: kind === 'server' ? 'The allowance server hit an error' : 'Connection lost',
      body: `Nothing new can be paid or approved from here until it is back.${stale}${retry}`,
      action: 'Retry now',
    };
  }
  if (health && health.rules && health.rules !== 'ok') {
    return {
      tone: 'danger',
      title: 'Payments are stopped',
      body: health.message || 'The allowance rules could not be read.',
      action: null,
    };
  }
  if (health && health.merchantConfigured && health.merchant === 'down') {
    return {
      tone: 'info',
      title: 'Merchant offline',
      body: 'The merchant is not answering, so the agent cannot buy right now. Start it with npm run merchant. Your allowance is safe.',
      action: 'Check again',
    };
  }
  return null;
}

/**
 * EventSource with our own backoff. The browser's built-in retry is a fixed
 * interval forever; this closes the source on error and reopens it after
 * backoffDelay(), resetting once a connection opens.
 */
export function createReconnectingStream({
  url,
  handlers = {},
  onOpen,
  onDown,
  EventSourceImpl = typeof EventSource === 'function' ? EventSource : null,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  random = Math.random,
} = {}) {
  if (!EventSourceImpl) {
    onDown?.({ attempt: 0, retryInMs: 0, supported: false });
    return { close() {}, reconnectNow() {} };
  }
  let source = null;
  let attempt = 0;
  let timer = null;
  let closed = false;

  function open() {
    if (closed) return;
    timer = null;
    source = new EventSourceImpl(url);
    source.addEventListener('open', () => {
      attempt = 0;
      onOpen?.();
    });
    source.addEventListener('error', () => {
      if (closed) return;
      source?.close();
      source = null;
      const retryInMs = backoffDelay(attempt, { random });
      attempt += 1;
      onDown?.({ attempt, retryInMs, supported: true });
      if (timer == null) timer = schedule(open, retryInMs);
    });
    for (const [type, handler] of Object.entries(handlers)) {
      source.addEventListener(type, (event) => {
        let data = null;
        try {
          data = JSON.parse(event.data);
        } catch {
          data = null;
        }
        handler(data);
      });
    }
  }

  open();
  return {
    close() {
      closed = true;
      if (timer != null) cancel(timer);
      timer = null;
      source?.close();
      source = null;
    },
    /** Skip the wait, for example when the browser comes back online. */
    reconnectNow() {
      if (closed || source) return;
      if (timer != null) cancel(timer);
      attempt = 0;
      open();
    },
  };
}
