/**
 * The AP4M merchant kit takes merchant/state/merchant.lock with an exclusive
 * create and never writes who holds it. A crash, a closed terminal window, or
 * a Windows taskkill leaves the file behind, and the next start refuses to run.
 *
 * merchant/index.js now writes merchant.pid beside the lock once it holds it.
 * A lock is stale only when its recorded process is gone AND nothing answers
 * on the merchant's port. Anything less certain keeps the lock. The SQLite
 * store next to it is never touched.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_NAME = 'merchant.lock';
export const OWNER_NAME = 'merchant.pid';

export function lockPaths(stateDirectory) {
  return {
    lock: join(stateDirectory, LOCK_NAME),
    owner: join(stateDirectory, OWNER_NAME),
  };
}

/** true when a process with this pid exists. EPERM means it exists but is not ours. */
export function pidAlive(pid, kill = process.kill.bind(process)) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return false;
  try {
    kill(id, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function readOwnerPid(stateDirectory) {
  try {
    const text = readFileSync(lockPaths(stateDirectory).owner, 'utf8').trim();
    return /^\d{1,10}$/.test(text) ? Number(text) : null;
  } catch {
    return null;
  }
}

export function writeOwnerPid(stateDirectory, pid = process.pid) {
  writeFileSync(lockPaths(stateDirectory).owner, `${pid}\n`, { mode: 0o600 });
}

export function removeOwnerPid(stateDirectory) {
  try {
    unlinkSync(lockPaths(stateDirectory).owner);
  } catch {
    /* Already gone. */
  }
}

/**
 * Pure decision.
 *   none   no lock file
 *   held   a live process or a listening port says a merchant is running
 *   stale  the lock is left over and can be removed
 */
export function lockVerdict({ lockExists, ownerAlive, portAnswers }) {
  if (!lockExists) return 'none';
  if (ownerAlive || portAnswers) return 'held';
  return 'stale';
}

/** What a second merchant prints instead of the kit's raw lock error. */
export function heldLockMessage(stateDirectory, pid = null) {
  const who = pid ? ` (process ${pid})` : '';
  return `A merchant is already running for ${stateDirectory}${who}. Keep using it, or close its window first. npm start runs the merchant for you when its keys are in .env.`;
}

/** true when anything answers HTTP on 127.0.0.1:port, even a 404. */
export async function portAnswers(port) {
  if (!port) return false;
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove leftover merchant locks. Each target is { stateDirectory, port }.
 * Returns one row per target with the verdict, so the caller can say what it did.
 */
export async function clearStaleMerchantLocks(targets, {
  exists = existsSync,
  alive = pidAlive,
  portAnswers: answers = portAnswers,
  remove = unlinkSync,
} = {}) {
  const results = [];
  for (const { stateDirectory, port } of targets) {
    const paths = lockPaths(stateDirectory);
    const lockExists = exists(paths.lock);
    let verdict = 'none';
    if (lockExists) {
      const owner = readOwnerPid(stateDirectory);
      const ownerAlive = owner != null && owner !== process.pid && alive(owner);
      verdict = lockVerdict({ lockExists, ownerAlive, portAnswers: ownerAlive ? false : await answers(port) });
    }
    if (verdict === 'stale') {
      try {
        remove(paths.lock);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          results.push({ stateDirectory, verdict: 'held', error: error.message });
          continue;
        }
      }
      try {
        remove(paths.owner);
      } catch {
        /* No owner file from an older run. */
      }
    }
    results.push({ stateDirectory, verdict });
  }
  return results;
}
