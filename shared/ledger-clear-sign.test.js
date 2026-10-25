import assert from 'node:assert/strict';
import test from 'node:test';
import { clearSignDescriptor, ledgerClearSign } from './ledger-clear-sign.js';

test('chain 1449000 cannot clear-sign without a Ledger registry certificate', () => {
  const decision = ledgerClearSign(1449000);
  assert.equal(decision.available, false);
  assert.match(decision.reason, /1449000/);
  assert.match(decision.reason, /cannot clear-sign/);
  assert.equal(clearSignDescriptor().context.eip712.domain.chainId, 1449000);
  assert.equal(clearSignDescriptor().context.eip712.domain.name, 'Agent Allowance');
});
