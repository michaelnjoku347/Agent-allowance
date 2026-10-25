import assert from 'node:assert/strict';
import test from 'node:test';
import { menuKey } from './menuKeys.js';

test('arrow keys wrap through a menu, Home and End jump, Escape and Tab close', () => {
  assert.equal(menuKey('ArrowDown', -1, 3), 0, 'the first ArrowDown lands on the first item');
  assert.equal(menuKey('ArrowDown', 2, 3), 0);
  assert.equal(menuKey('ArrowUp', 0, 3), 2);
  assert.equal(menuKey('Home', 2, 3), 0);
  assert.equal(menuKey('End', 0, 3), 2);
  assert.equal(menuKey('Escape', 1, 3), 'close-and-return');
  assert.equal(menuKey('Tab', 1, 3), 'close');
  assert.equal(menuKey('a', 1, 3), null);
  assert.equal(menuKey('ArrowDown', 0, 0), null);
  assert.equal(menuKey('Escape', 0, 0), 'close-and-return');
});
