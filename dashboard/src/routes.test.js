import assert from 'node:assert/strict';
import test from 'node:test';
import { NAV, approvalCount, mobileTabs, moreItems, navSections, parseRoute, routeHash } from './routes.js';

test('routes cover the fintech nav and ignore unknown hashes', () => {
  assert.deepEqual(NAV.map((item) => item.id), [
    'home', 'activity', 'approvals', 'rules', 'merchants', 'agents', 'security', 'settings', 'help',
  ]);
  assert.equal(parseRoute(''), 'home');
  assert.equal(parseRoute('#/approvals'), 'approvals');
  assert.equal(parseRoute('#security'), 'security');
  assert.equal(parseRoute('#/nope'), 'home');
  assert.equal(routeHash('home'), '#/');
  assert.equal(routeHash('rules'), '#/rules');
});

test('sections, phone tabs, and the approval count stay in order', () => {
  const sections = navSections();
  assert.deepEqual(sections.map((section) => section.label), ['Spend', 'Controls', 'Trust']);
  assert.deepEqual(sections[0].items.map((item) => item.id), ['home', 'activity', 'approvals']);
  assert.deepEqual(mobileTabs().map((item) => item.label), ['Home', 'Activity', 'Approvals', 'Security', 'More']);
  assert.deepEqual(moreItems().map((item) => item.id), ['rules', 'merchants', 'agents', 'settings', 'help']);
  assert.equal(approvalCount([{ status: 'pending' }, { status: 'paying' }, { status: 'paid' }]), 2);
  assert.equal(approvalCount(null), 0);
});
