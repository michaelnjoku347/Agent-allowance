import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMenuKey, menuKey } from './menuKeys.js';

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

test('the menu handler moves focus, and Escape closes and returns focus to the button', () => {
  const focused = [];
  const item = (name) => ({ name, focus: () => { focused.push(name); globalThis.document.activeElement = it[name]; } });
  const it = { a: item('a'), b: item('b'), c: item('c'), button: item('button') };
  const items = [it.a, it.b, it.c];
  const saved = globalThis.document;
  globalThis.document = { activeElement: it.b };
  try {
    let closed = 0;
    let prevented = 0;
    const press = (key) => handleMenuKey({ key, preventDefault: () => { prevented += 1; } }, { items, close: () => { closed += 1; }, button: it.button });
    press('ArrowDown');
    assert.deepEqual(focused, ['c']);
    press('ArrowDown');
    assert.deepEqual(focused, ['c', 'a'], 'wraps to the top');
    press('End');
    assert.equal(focused.at(-1), 'c');
    press('x');
    assert.equal(focused.length, 3, 'other keys do nothing');
    press('Tab');
    assert.equal(closed, 1, 'Tab closes and lets focus move on');
    assert.equal(prevented, 3, 'Tab is not swallowed');
    press('Escape');
    assert.equal(closed, 2);
    assert.equal(focused.at(-1), 'button', 'Escape returns focus to the menu button');
  } finally {
    globalThis.document = saved;
  }
});
