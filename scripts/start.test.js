import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DASHBOARD_URL,
  browserOpen,
  dashboardInstall,
  dashboardLaunch,
  envFileNotice,
  lanAddresses,
  missingInstalls,
  nodeVersionProblem,
  npmBin,
  optionalKeyNotices,
  phoneRequested,
  phoneUrls,
} from './start-lib.js';

test('Node 22.13 and newer pass, and older Node gets a friendly message', () => {
  assert.equal(nodeVersionProblem('22.13.0'), null);
  assert.equal(nodeVersionProblem('22.23.4'), null);
  assert.equal(nodeVersionProblem('24.0.0'), null);
  const old = nodeVersionProblem('20.11.0');
  assert.match(old, /Node\.js 22\.13 or newer/);
  assert.match(old, /Node 20\.11\.0/);
  assert.match(old, /https:\/\/nodejs\.org/);
  assert.match(nodeVersionProblem('22.12.9'), /22\.12\.9/);
  assert.match(nodeVersionProblem(''), /unknown Node version/);
});

test('missing Jev and Bedrock keys are one-line notices, and set keys stay quiet', () => {
  const both = optionalKeyNotices({ jevKey: '', bedrockConfigured: false });
  assert.deepEqual(both, [
    'Jev is not configured. The rules decide alone.',
    'Amazon Bedrock is not configured. The agent will use Fallback (Bedrock not configured).',
  ]);
  assert.deepEqual(optionalKeyNotices({ jevKey: '  ', bedrockConfigured: false }), both);
  assert.deepEqual(optionalKeyNotices({ jevKey: 'present', bedrockConfigured: true }), []);
  assert.deepEqual(optionalKeyNotices({ jevKey: 'present', bedrockConfigured: false }), [
    'Amazon Bedrock is not configured. The agent will use Fallback (Bedrock not configured).',
  ]);
});

test('install steps run only when a node_modules folder is missing', () => {
  assert.deepEqual(missingInstalls(true), []);
  assert.equal(dashboardInstall(true), null);
  assert.deepEqual(missingInstalls(false), [
    { label: 'Installing dependencies…', args: ['install'] },
  ]);
  assert.deepEqual(dashboardInstall(false), {
    label: 'Installing dashboard dependencies…',
    args: ['install', '--prefix', 'dashboard'],
  });
});

test('phone mode is opt-in and prints only private LAN addresses', () => {
  assert.equal(phoneRequested([], {}), false);
  assert.equal(phoneRequested(['--phone'], {}), true);
  assert.equal(phoneRequested(['--host'], {}), true);
  assert.equal(phoneRequested([], { DASHBOARD_HOST: '0.0.0.0' }), true);
  assert.equal(phoneRequested([], { DASHBOARD_HOST: '127.0.0.1' }), false);

  const addresses = lanAddresses({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [
      { address: '192.168.1.42', family: 'IPv4', internal: false },
      { address: '8.8.8.8', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    docker: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
  });
  assert.deepEqual(addresses, ['192.168.1.42', '172.17.0.1']);
  assert.deepEqual(phoneUrls(addresses), ['http://192.168.1.42:5173', 'http://172.17.0.1:5173']);

  const local = dashboardLaunch({ phone: false, addresses });
  assert.equal(local.host, '127.0.0.1');
  assert.deepEqual(local.urls, [DASHBOARD_URL]);
  assert.deepEqual(local.phone, []);

  const shared = dashboardLaunch({ phone: true, addresses });
  assert.equal(shared.host, '0.0.0.0');
  assert.deepEqual(shared.phone, ['http://192.168.1.42:5173', 'http://172.17.0.1:5173']);
  assert.ok(shared.origins.includes(DASHBOARD_URL));
  assert.ok(shared.origins.includes('http://192.168.1.42:5173'));
  assert.deepEqual(dashboardLaunch({ phone: true, addresses: [] }).phone, []);
});

test('the launcher opens the dashboard URL on each desktop', () => {
  assert.equal(DASHBOARD_URL, 'http://127.0.0.1:5173');
  assert.equal(envFileNotice(true), null);
  assert.match(envFileNotice(false), /Copy \.env\.example to \.env/);
  assert.deepEqual(browserOpen(DASHBOARD_URL, 'win32'), {
    command: 'cmd',
    args: ['/c', 'start', '', DASHBOARD_URL],
  });
  assert.deepEqual(browserOpen(DASHBOARD_URL, 'darwin'), { command: 'open', args: [DASHBOARD_URL] });
  assert.deepEqual(browserOpen(DASHBOARD_URL, 'linux'), { command: 'xdg-open', args: [DASHBOARD_URL] });
  assert.equal(npmBin('win32'), 'npm.cmd');
  assert.equal(npmBin('linux'), 'npm');
});
