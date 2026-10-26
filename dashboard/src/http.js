/**
 * The dashboard's one way to talk to the allowance API: a timeout on every
 * call, and an error a person can act on instead of "Failed to fetch".
 * No imports, so the tests can load it in Node.
 */

export const UNREACHABLE = 'Can’t reach the allowance server. Check that npm start is still running, then try again.';

/**
 * fetch with a timeout and a sentence a person can act on. A dropped
 * connection becomes kind "unreachable"; a 429 carries the server's wait.
 */
export async function call(path, { method = 'GET', body, timeoutMs = 15_000, fetchImpl = fetch } = {}) {
  const init = { method, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetchImpl(path, init);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const wrapped = new Error(timedOut ? 'The allowance server took too long to answer. Try again.' : UNREACHABLE);
    wrapped.kind = timedOut ? 'timeout' : 'unreachable';
    throw wrapped;
  }
  const parsed = await response.json().catch(() => ({}));
  return { response, body: parsed && typeof parsed === 'object' ? parsed : {} };
}

export function failure(response, body, fallback) {
  const error = new Error(body.message || body.error || fallback);
  error.status = response.status;
  error.code = body.error;
  if (response.status === 429) error.kind = 'busy';
  return error;
}

export async function postJson(path, payload, fallback, timeoutMs = 15_000, fetchImpl = undefined) {
  const { response, body } = await call(path, { method: 'POST', body: payload, timeoutMs, fetchImpl });
  if (!response.ok) throw failure(response, body, fallback);
  return body;
}

/**
 * Where a paying approval is. Only a 404 means the row is gone (paid). A
 * network blip or a server error keeps waiting: it must never read as paid.
 */
export async function approvalProgress(id, { fetchImpl } = {}) {
  try {
    const { response, body } = await call(`/api/approve/${encodeURIComponent(id)}/progress`, { timeoutMs: 10_000, fetchImpl });
    if (response.status === 404) return { inFlight: false, missing: true, phase: null };
    if (!response.ok) return { inFlight: true, missing: false, phase: null, unknown: true };
    return body;
  } catch {
    return { inFlight: true, missing: false, phase: null, unknown: true };
  }
}
