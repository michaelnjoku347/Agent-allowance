/**
 * Per-request file locations for the hosted public demo. When a request runs
 * inside a sandbox, the store and the rules resolve to that visitor's own
 * copies, so one judge's freeze or decline never reaches another's screen.
 * Outside a sandbox (every local run and every test) nothing changes.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const sandboxContext = new AsyncLocalStorage();

/** { id, dir, storePath, rulesPath } for the current request, or null. */
export function currentSandbox() {
  return sandboxContext.getStore() ?? null;
}
