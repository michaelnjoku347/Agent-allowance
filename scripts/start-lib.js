/**
 * Pure helpers for `npm start`. No installs, no servers, no browser.
 * Node 22.13 matches the engines field. A missing optional key is a notice.
 */

import { networkInterfaces } from 'node:os';

export const DASHBOARD_URL = 'http://127.0.0.1:5173';
export const DASHBOARD_PORT = 5173;

const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;

/** Opt-in only. The default stays on this computer. */
export function phoneRequested(argv = [], env = {}) {
  if (argv.includes('--phone') || argv.includes('--host')) return true;
  return String(env.DASHBOARD_HOST ?? '').trim() === '0.0.0.0';
}

export function lanAddresses(interfaces = networkInterfaces()) {
  const found = [];
  for (const rows of Object.values(interfaces ?? {})) {
    for (const row of rows ?? []) {
      const family = row?.family;
      const v4 = family === 4 || family === 'IPv4';
      if (!row || row.internal || !v4 || !PRIVATE_IP.test(row.address)) continue;
      if (!found.includes(row.address)) found.push(row.address);
    }
  }
  return found;
}

export function phoneUrls(addresses, port = DASHBOARD_PORT) {
  return (addresses ?? []).map((host) => `http://${host}:${port}`);
}

export function dashboardLaunch({ phone = false, addresses = [], port = DASHBOARD_PORT } = {}) {
  const local = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  if (!phone) {
    return { host: '127.0.0.1', urls: [local[0]], origins: local, phone: [] };
  }
  const phoneList = phoneUrls(addresses, port);
  return {
    host: '0.0.0.0',
    urls: [local[0], ...phoneList],
    origins: [...local, ...phoneList],
    phone: phoneList,
  };
}

export function nodeVersionProblem(version) {
  const [major, minor] = String(version ?? '').split('.').map((part) => Number.parseInt(part, 10));
  if (Number.isInteger(major) && (major > 22 || (major === 22 && Number.isInteger(minor) && minor >= 13))) {
    return null;
  }
  const shown = version ? `Node ${version}` : 'an unknown Node version';
  return `Agent Allowance needs Node.js 22.13 or newer. You have ${shown}. Install Node 22 from https://nodejs.org and try again.`;
}

export function optionalKeyNotices({ jevKey = '', bedrockConfigured = false } = {}) {
  const notices = [];
  if (!String(jevKey ?? '').trim()) {
    notices.push('Jev is not configured. The rules decide alone.');
  }
  if (!bedrockConfigured) {
    notices.push('Amazon Bedrock is not configured. The agent will use Fallback (Bedrock not configured).');
  }
  return notices;
}

export function envFileNotice(exists) {
  if (exists) return null;
  return 'No .env file. Copy .env.example to .env. The sample dashboard still opens.';
}

export function missingInstalls(rootExists) {
  const steps = [];
  if (!rootExists) steps.push({ label: 'Installing dependencies…', args: ['install'] });
  return steps;
}

/**
 * Why a node_modules folder needs `npm install`, or null when it is current.
 * npm writes node_modules/.package-lock.json on every install, so a manifest
 * or lockfile edited after it (a git pull that bumped a version) is stale.
 * A dependency folder that is missing is stale too.
 *
 *   modulesExists       node_modules is present
 *   installedAt         mtime of node_modules/.package-lock.json, or null
 *   manifestAt          newest mtime of package.json and package-lock.json
 *   dependencies        names from package.json dependencies and devDependencies
 *   hasDependency(name) true when node_modules/<name> exists
 */
export function installStaleness({ modulesExists, installedAt, manifestAt, dependencies = [], hasDependency = () => true }) {
  if (!modulesExists) return 'missing';
  if (installedAt == null) return 'unknown install';
  if (manifestAt != null && manifestAt > installedAt + 1000) return 'package files changed';
  const absent = dependencies.find((name) => !hasDependency(name));
  if (absent) return `${absent} is missing`;
  return null;
}

/** reason is what installStaleness returned for dashboard/node_modules. */
export function dashboardInstall(reason) {
  if (!reason) return null;
  const why = reason === 'missing' ? '' : ` (${reason})`;
  return { label: `Installing dashboard dependencies…${why}`, args: ['install', '--prefix', 'dashboard'] };
}

const MERCHANT_KEYS = ['MERCHANT_PAYOUT_ADDRESS', 'MERCHANT_ID', 'MERCHANT_SUBMITTER_KEY'];

/**
 * Should npm start run the local x402 merchant too? Then one window (or one
 * double-click) starts everything, and closing it stops everything. Only when
 * all three merchant keys are in .env and nothing answers on the merchant
 * port yet; a merchant you started yourself is used as it is.
 * --no-merchant or START_MERCHANT=0 leaves the merchant to you.
 *
 *   running(port)   resolves true when something answers on the port
 */
export async function merchantLaunch({ argv = [], env = {}, port = 4308, running = async () => false } = {}) {
  if (argv.includes('--no-merchant') || String(env.START_MERCHANT ?? '').trim() === '0') {
    return { start: false, note: null };
  }
  const missing = MERCHANT_KEYS.filter((key) => !String(env[key] ?? '').trim());
  if (missing.length === MERCHANT_KEYS.length) {
    return { start: false, note: 'The merchant was not started: its keys are not in .env. Add them for a paid run.' };
  }
  if (missing.length) {
    return { start: false, note: `The merchant also needs ${missing.join(' and ')} in .env. It was not started.` };
  }
  if (await running(port)) {
    return { start: false, note: `A merchant already answers on port ${port}. Using it.` };
  }
  return { start: true, note: `Starting the merchant on port ${port}.` };
}

export function npmBin(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Node 18.20.2+ and 20.12.2+ refuse to spawn a .cmd file without a shell
 * (the CVE-2024-27980 fix), so `npm.cmd` fails with EINVAL on Windows unless
 * shell is on. The arguments passed here are fixed words, never user text.
 */
export function npmSpawnOptions(platform = process.platform) {
  return platform === 'win32' ? { shell: true } : {};
}

/** Open a URL in the desktop browser. Failure to open must not stop the servers. */
export function browserOpen(url, platform = process.platform) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}
