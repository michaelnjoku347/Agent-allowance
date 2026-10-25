/**
 * Pure helpers for `npm start`. No installs, no servers, no browser.
 * Node 22.13 matches the engines field. A missing optional key is a notice.
 */

export const DASHBOARD_URL = 'http://127.0.0.1:5173';

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

export function dashboardInstall(dashboardExists) {
  if (dashboardExists) return null;
  return { label: 'Installing dashboard dependencies…', args: ['install', '--prefix', 'dashboard'] };
}

export function npmBin(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

/** Open a URL in the desktop browser. Failure to open must not stop the servers. */
export function browserOpen(url, platform = process.platform) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}
