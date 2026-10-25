/**
 * Keyboard model for a popup menu (WAI-ARIA menu button pattern):
 * ArrowDown and ArrowUp move between items and wrap, Home and End jump,
 * Escape closes and returns focus to the button, Tab closes and moves on.
 * Returns the index to focus, 'close', 'close-and-return', or null.
 */
export function menuKey(key, index, count) {
  if (!count) return key === 'Escape' ? 'close-and-return' : null;
  if (key === 'ArrowDown') return (index + 1 + count) % count;
  if (key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'Escape') return 'close-and-return';
  if (key === 'Tab') return 'close';
  return null;
}

/** Wire menuKey to a DOM menu. items are the enabled menu items in order. */
export function handleMenuKey(event, { items, close, button }) {
  const index = items.indexOf(document.activeElement);
  const next = menuKey(event.key, index < 0 ? -1 : index, items.length);
  if (next === null) return;
  if (next === 'close') {
    close();
    return;
  }
  event.preventDefault();
  if (next === 'close-and-return') {
    close();
    button?.focus();
    return;
  }
  items[next]?.focus();
}
