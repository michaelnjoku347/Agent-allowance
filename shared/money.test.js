import assert from 'node:assert/strict';
import test from 'node:test';
import { money } from './money.js';

test('money shows 2 to 4 decimals and never rounds a paid amount away', () => {
  assert.equal(money('20'), '20.00');
  assert.equal(money('0.2'), '0.20');
  assert.equal(money('0.01'), '0.01');
  assert.equal(money('0.075'), '0.075');
  assert.equal(money('0.0025'), '0.0025');
  assert.equal(money('0.12345'), '0.12345');
  assert.equal(money('0.00005'), '0.00005');
  assert.equal(money('1234.5'), '1,234.50');
  assert.equal(money(0.1 + 0.2), '0.30');
  assert.equal(money('nope'), 'nope');
  assert.equal(money(undefined), '');
});
