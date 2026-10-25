import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'allowance-signer-'));
process.env.ALLOWANCE_STORE = join(dir, 'store.json');
process.env.ALLOWANCE_RULES = join(dir, 'rules.json');
copyFileSync(new URL('../agent/rules.json', import.meta.url), process.env.ALLOWANCE_RULES);
process.env.ALLOWANCE_DEV_SIGNER = '1';
process.env.APPROVER_ADDRESS = '';

const { createApp } = await import('./index.js');
const { backupApproverWallet } = await import('./backup-demo.js');
const { signApprovalForTest } = await import('./dev-signer.js');

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

test('the backup allowance challenge and verification use the same approver', async () => {
  const server = await listen(createApp());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' };
  try {
    const challenge = await fetch(`${base}/api/allowance/challenge`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ maxPerPurchase: '0.08' }),
    });
    const prepared = await challenge.json();
    assert.equal(challenge.status, 200);
    assert.equal(prepared.approverAddress, backupApproverWallet().address.toLowerCase());
    const signed = await signApprovalForTest(prepared.typedData, backupApproverWallet().privateKey);
    const accepted = await fetch(`${base}/api/allowance`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ signature: signed.signature, message: prepared.typedData.message }),
    });
    const body = await accepted.json();
    assert.equal(accepted.status, 200, body.message || body.error);
    const rules = JSON.parse(readFileSync(process.env.ALLOWANCE_RULES, 'utf8'));
    assert.equal(rules.maxPerPurchase, '0.08');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
