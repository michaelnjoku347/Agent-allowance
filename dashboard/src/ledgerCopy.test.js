import assert from 'node:assert/strict';
import test from 'node:test';
import { APPROVAL_ERROR_TITLES, approverInputError, deviceStatusLine } from './ledgerCopy.js';

test('the approval status line says what is happening, and nothing while an error shows', () => {
  assert.equal(deviceStatusLine({ phase: 'loading' }), 'Preparing the approval…');
  assert.match(deviceStatusLine({ phase: 'ready', supported: true }), /Plug in your Ledger/);
  assert.match(deviceStatusLine({ phase: 'ready', supported: false }), /Chrome, Edge, or Brave/);
  assert.equal(deviceStatusLine({ phase: 'ready', simulated: true }), '');
  assert.equal(deviceStatusLine({ phase: 'device' }), 'Waiting for your Ledger…');
  assert.equal(deviceStatusLine({ phase: 'device', status: 'Confirm the purchase on the Ledger.' }), 'Confirm the purchase on the Ledger.');
  assert.equal(deviceStatusLine({ phase: 'paying', status: 'Broadcasting' }), 'Broadcasting');
  // A failed challenge never contacted the device, so nothing says it is waiting.
  assert.equal(deviceStatusLine({ phase: 'error', error: 'No approver is set yet.' }), '');
  assert.equal(deviceStatusLine({ phase: 'device', error: 'x' }), '');
  assert.equal(deviceStatusLine({ phase: 'ready', preview: true }), '');
  assert.equal(deviceStatusLine(), '');
});

test('an error before the device step is not blamed on the Ledger', () => {
  assert.equal(APPROVAL_ERROR_TITLES.prepare, 'This approval cannot start yet');
  assert.doesNotMatch(APPROVAL_ERROR_TITLES.prepare, /Ledger/);
  assert.equal(APPROVAL_ERROR_TITLES.device, 'The Ledger did not finish');
  assert.doesNotMatch(APPROVAL_ERROR_TITLES.simulated, /Ledger/);
});

test('the approver address must be a 0x account address', () => {
  assert.match(approverInputError(''), /Enter the address/);
  assert.match(approverInputError('   '), /Enter the address/);
  assert.match(approverInputError('0x1234'), /not an account address/);
  assert.match(approverInputError(`0x${'g'.repeat(40)}`), /not an account address/);
  assert.match(approverInputError(`${'a'.repeat(42)}`), /not an account address/);
  assert.equal(approverInputError(`0x${'aB'.repeat(20)}`), '');
  assert.equal(approverInputError(`  0x${'0'.repeat(40)}  `), '');
});
