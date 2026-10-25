/** Primary navigation. Icons live in the app so this stays easy to test. */

export const NAV = [
  { id: 'home', label: 'Home', section: 'Spend', mobile: true },
  { id: 'activity', label: 'Activity', section: 'Spend', mobile: true },
  { id: 'approvals', label: 'Approvals', section: 'Spend', mobile: true },
  { id: 'rules', label: 'Rules', section: 'Controls' },
  { id: 'merchants', label: 'Merchants', section: 'Controls' },
  { id: 'agents', label: 'Agents', section: 'Controls' },
  { id: 'security', label: 'Security', section: 'Trust', mobile: true },
  { id: 'settings', label: 'Settings', section: 'Trust' },
  { id: 'help', label: 'Help', section: 'Trust' },
];

const MORE = ['rules', 'merchants', 'agents', 'settings', 'help'];

export function parseRoute(hash) {
  const id = String(hash ?? '').replace(/^#\/?/, '').split(/[?#]/)[0].trim().toLowerCase();
  return NAV.some((item) => item.id === id) ? id : 'home';
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
