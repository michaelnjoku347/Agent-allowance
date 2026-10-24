import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pendingPurchase, validateRecovery } from './recovery.js';

test('an unresolved purchase retains its original channel and operation without exposing the signature', () => {
  const dir = mkdtempSync(join(tmpdir(), 'allowance-recovery-'));
  const file = join(dir, 'purchase.json');
  const intent = { channelId: '0x' + 'aa'.repeat(32), agent: '0x' + 'bb'.repeat(20), resourceUrl: 'http://127.0.0.1:4308/resource', operation: 'same-purchase', maximumAmount: '1000000000000000000' };
  try {
    assert.equal(pendingPurchase(file), null);
    writeFileSync(file, JSON.stringify({ intent, header: 'private-signed-voucher', complete: false }));
    const pending = pendingPurchase(file);
    assert.deepEqual(pending, intent);
    assert.equal('header' in pending, false);
    validateRecovery(pending, { agent: intent.agent, resourceUrl: intent.resourceUrl });
    assert.throws(() => validateRecovery(pending, { agent: intent.agent, resourceUrl: 'http://127.0.0.1:4308/other' }), /Resume/);
    assert.throws(() => validateRecovery(pending, { agent: intent.agent, resourceUrl: intent.resourceUrl, channelId: '0x' + 'cc'.repeat(32) }), /Resume/);
    writeFileSync(file, JSON.stringify({ intent, complete: true }));
    assert.equal(pendingPurchase(file), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
