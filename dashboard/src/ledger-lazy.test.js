import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SRC = import.meta.dirname;

test('the Ledger kit is imported only on demand, so it stays out of the first download', () => {
  const offenders = [];
  for (const name of readdirSync(SRC)) {
    if (!/\.(js|jsx)$/.test(name) || name.endsWith('.test.js')) continue;
    const text = readFileSync(join(SRC, name), 'utf8');
    if (/^\s*import\s[^;]*from\s+['"]@ledgerhq\//m.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
  const ledger = readFileSync(join(SRC, 'ledger.js'), 'utf8');
  for (const pkg of ['device-management-kit', 'device-signer-kit-ethereum', 'device-transport-kit-web-hid']) {
    assert.match(ledger, new RegExp(`import\\('@ledgerhq/${pkg}'\\)`));
  }
});
