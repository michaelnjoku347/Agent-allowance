import assert from 'node:assert/strict';
import test from 'node:test';
import { dateInput, diffAllowance, draftFrom, endOfDayIso, ledgerProposal, merchantInputError, validateDraft } from './allowanceEdit.js';

const A = '0xa11cea11cea11cea11cea11cea11cea11cea11ce';
const B = '0xbee0bee0bee0bee0bee0bee0bee0bee0bee0bee0';
const C = '0xC0FFEE00C0FFEE00C0FFEE00C0FFEE00C0FFEE00';
const rules = {
  budget: '20',
  maxPerPurchase: '5',
  expiresAt: '2026-12-31T23:59:59.000Z',
  allowedMerchants: [{ address: A, label: 'Field Weather Co' }, { address: B, label: 'Market Desk' }],
};
const NOW = Date.parse('2026-10-25T12:00:00Z');

test('a draft mirrors the rules and dates round-trip through a date input', () => {
  assert.deepEqual(draftFrom(rules), { budget: '20', maxPerPurchase: '5', expiresOn: '2026-12-31', merchants: [A, B] });
  assert.equal(dateInput('nope'), '');
  assert.equal(endOfDayIso('2027-01-15'), '2027-01-15T23:59:59.000Z');
  assert.equal(endOfDayIso('15/01/2027'), null);
});

test('validation explains each field', () => {
  assert.deepEqual(validateDraft(draftFrom(rules), NOW), {});
  const bad = validateDraft({ budget: '0', maxPerPurchase: 'five', expiresOn: '', merchants: [] }, NOW);
  assert.match(bad.budget, /above 0/);
  assert.match(bad.maxPerPurchase, /above 0/);
  assert.match(bad.expiresOn, /last day/);
  assert.match(bad.merchants, /at least one/);
  assert.match(validateDraft({ ...draftFrom(rules), maxPerPurchase: '25' }, NOW).maxPerPurchase, /cannot be larger than the budget/);
  assert.match(validateDraft({ ...draftFrom(rules), expiresOn: '2026-10-01' }, NOW).expiresOn, /after today/);
  assert.match(validateDraft({ ...draftFrom(rules), merchants: ['0x12'] }, NOW).merchants, /40 hex/);
  assert.match(validateDraft({ ...draftFrom(rules), budget: '1.0000000000000000001' }, NOW).budget, /above 0/);
});

test('lowering is lower, raising is raise, and the patch holds only changes', () => {
  const same = diffAllowance(rules, draftFrom(rules));
  assert.equal(same.empty, true);
  assert.deepEqual(same.patch, {});

  const lower = diffAllowance(rules, { ...draftFrom(rules), maxPerPurchase: '3', budget: '20.00', merchants: [A] }, { [B]: 'Market Desk' });
  assert.equal(lower.raises, false);
  assert.deepEqual(lower.patch, { maxPerPurchase: '3', allowedMerchants: [A] });
  assert.deepEqual(lower.changes.map((change) => [change.label, change.from, change.to, change.direction]), [
    ['Per-purchase cap', '5.00 RLUSD', '3.00 RLUSD', 'lower'],
    ['Remove merchant', 'Market Desk', 'Removed', 'lower'],
  ]);

  const raise = diffAllowance(rules, { ...draftFrom(rules), budget: '50', expiresOn: '2027-03-31', merchants: [A, B, C] });
  assert.equal(raise.raises, true);
  assert.deepEqual(raise.changes.map((change) => [change.label, change.direction]), [
    ['Budget', 'raise'],
    ['Expires', 'raise'],
    ['Add merchant', 'raise'],
  ]);
  assert.equal(raise.patch.expiresAt, '2027-03-31T23:59:59.000Z');
  assert.deepEqual(raise.patch.allowedMerchants, [A, B, C.toLowerCase()]);

  const earlier = diffAllowance(rules, { ...draftFrom(rules), expiresOn: '2026-11-30' });
  assert.equal(earlier.changes[0].direction, 'lower');
});

test('the Ledger proposal is the whole allowance, not only the changed field', () => {
  assert.deepEqual(ledgerProposal(rules, { ...draftFrom(rules), budget: '40' }), {
    maxPerPurchase: '5',
    budget: '40',
    expiresAt: '2026-12-31T23:59:59.000Z',
    allowedMerchants: [A, B],
  });
});

test('adding a merchant checks the address and duplicates', () => {
  assert.match(merchantInputError(''), /Paste/);
  assert.match(merchantInputError('0x123'), /40 hex/);
  assert.match(merchantInputError(A.toUpperCase().replace('0X', '0x'), [A]), /already on the list/);
  assert.equal(merchantInputError(C, [A]), '');
});
