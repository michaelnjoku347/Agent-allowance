/** Primary navigation. Icons live in the app so this stays easy to test. */

export const NAV = [
  { id: 'home', label: 'Home', section: 'Spend', mobile: true },
  { id: 'activity', label: 'Activity', section: 'Spend', mobile: true, lede: 'Every purchase the agent tried, paid or blocked.' },
  { id: 'approvals', label: 'Approvals', section: 'Spend', mobile: true },
  { id: 'rules', label: 'Rules', section: 'Controls', lede: 'The agent pays on its own only inside these limits. A raise needs the Ledger.' },
  { id: 'merchants', label: 'Merchants', section: 'Controls', lede: 'The agent can pay only the merchants on this list.' },
  { id: 'agents', label: 'Agents', section: 'Controls', lede: 'One agent spends inside this allowance. The model chooses. It does not hold the keys.' },
  { id: 'security', label: 'Security', section: 'Trust', mobile: true, lede: 'The Ledger approves exceptions. Freeze stops new signatures.' },
  { id: 'settings', label: 'Settings', section: 'Trust', lede: 'Appearance and spoken updates stay on this device.' },
  { id: 'help', label: 'Help', section: 'Trust', lede: 'The agent decides what to buy. It cannot decide what it is allowed to spend.' },
];

const MORE = ['rules', 'merchants', 'agents', 'settings', 'help'];

export function parseRoute(hash) {
  const id = String(hash ?? '').replace(/^#\/?/, '').split(/[?#]/)[0].trim().toLowerCase();
  return NAV.some((item) => item.id === id) ? id : 'home';
}

/** The browser tab's title for a page (WCAG 2.4.2): the page first, then the product. */
export function pageTitle(id) {
  const item = NAV.find((row) => row.id === id);
  return !item || item.id === 'home' ? 'Agent Allowance' : `${item.label} · Agent Allowance`;
}

export function routeHash(id) {
  return id === 'home' ? '#/' : `#/${id}`;
}

export function navSections(items = NAV) {
  const order = ['Spend', 'Controls', 'Trust'];
  return order.map((label) => ({
    label,
    items: items.filter((item) => item.section === label && item.id !== 'settings' && item.id !== 'help'),
  })).filter((section) => section.items.length);
}

export function mobileTabs(items = NAV) {
  return [...items.filter((item) => item.mobile), { id: 'more', label: 'More' }];
}

export function moreItems(items = NAV) {
  return MORE.map((id) => items.find((item) => item.id === id)).filter(Boolean);
}

export function approvalCount(pending) {
  return (pending ?? []).filter((item) => item && (item.status === 'pending' || item.status === 'paying' || !item.status)).length;
}
