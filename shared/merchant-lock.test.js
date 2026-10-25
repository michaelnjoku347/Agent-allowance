import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  clearStaleMerchantLocks,
  lockPaths,
  lockVerdict,
  pidAlive,
  readOwnerPid,
  removeOwnerPid,
  writeOwnerPid,
} from './merchant-lock.js';

function stateDir() {
  return mkdtempSync(join(tmpdir(), 'merchant-lock-'));
}

test('a lock is stale only when its owner is gone and the port is silent', () => {
  assert.equal(lockVerdict({ lockExists: false, ownerAlive: false, portAnswers: false }), 'none');
  assert.equal(lockVerdict({ lockExists: true, ownerAlive: true, portAnswers: false }), 'held');
  assert.equal(lockVerdict({ lockExists: true, ownerAlive: false, portAnswers: true }), 'held');
  assert.equal(lockVerdict({ lockExists: true, ownerAlive: false, portAnswers: false }), 'stale');
});

test('pidAlive treats EPERM as alive and ESRCH as gone', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive('nope'), false);
  const eperm = () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); };
  const esrch = () => { throw Object.assign(new Error('x'), { code: 'ESRCH' }); };
  assert.equal(pidAlive(1234, eperm), true);
  assert.equal(pidAlive(1234, esrch), false);
});

test('the owner pid file round-trips and rejects junk', () => {
  const dir = stateDir();
  try {
    assert.equal(readOwnerPid(dir), null);
    writeOwnerPid(dir, 4242);
    assert.equal(readOwnerPid(dir), 4242);
    writeFileSync(lockPaths(dir).owner, 'not a pid');
    assert.equal(readOwnerPid(dir), null);
    removeOwnerPid(dir);
    removeOwnerPid(dir);
    assert.equal(existsSync(lockPaths(dir).owner), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a leftover lock is removed and the sqlite store is never touched', async () => {
  const dir = stateDir();
  try {
    const { lock, owner } = lockPaths(dir);
    writeFileSync(lock, '');
    writeFileSync(owner, '999999\n');
    writeFileSync(join(dir, 'merchant.sqlite'), 'db');
    const rows = await clearStaleMerchantLocks([{ stateDirectory: dir, port: 1 }], {
      alive: () => false,
      portAnswers: async () => false,
    });
    assert.deepEqual(rows, [{ stateDirectory: dir, verdict: 'stale' }]);
    assert.equal(existsSync(lock), false);
    assert.equal(existsSync(owner), false);
    assert.equal(existsSync(join(dir, 'merchant.sqlite')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a lock held by a live process or a listening merchant stays', async () => {
  const dir = stateDir();
  try {
    const { lock } = lockPaths(dir);
    writeFileSync(lock, '');
    writeOwnerPid(dir, 4242);
    let rows = await clearStaleMerchantLocks([{ stateDirectory: dir, port: 1 }], {
      alive: (pid) => pid === 4242,
      portAnswers: async () => false,
    });
    assert.equal(rows[0].verdict, 'held');
    assert.equal(existsSync(lock), true);

    removeOwnerPid(dir);
    rows = await clearStaleMerchantLocks([{ stateDirectory: dir, port: 4308 }], {
      alive: () => false,
      portAnswers: async (port) => port === 4308,
    });
    assert.equal(rows[0].verdict, 'held');
    assert.equal(existsSync(lock), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no lock means nothing to do', async () => {
  const dir = stateDir();
  try {
    const rows = await clearStaleMerchantLocks([{ stateDirectory: dir, port: 1 }], {
      portAnswers: async () => { throw new Error('should not probe'); },
    });
    assert.deepEqual(rows, [{ stateDirectory: dir, verdict: 'none' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
