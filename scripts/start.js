/**
 * One command for a beginner: check Node, install if needed, start the
 * allowance API and the dashboard, print the dashboard URL, and open it.
 *
 *   npm start
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
} from './start-lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function runNpm(args) {
  const result = spawnSync(npmBin(), args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error('npm install failed. Read the message above, then run npm start again.');
    process.exit(result.status ?? 1);
  }
}

function installIfNeeded() {
  for (const step of missingInstalls(existsSync(join(root, 'node_modules')))) {
    console.log(step.label);
    runNpm(step.args);
  }
  const dashboard = dashboardInstall(existsSync(join(root, 'dashboard', 'node_modules')));
  if (dashboard) {
    console.log(dashboard.label);
    runNpm(dashboard.args);
  }
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return false;
}

function openDashboard(url) {
  const spec = browserOpen(url);
  try {
    const child = spawn(spec.command, spec.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {
      console.log(`Open ${url} in your browser.`);
    });
    child.unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

async function main() {
  const problem = nodeVersionProblem(process.versions.node);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  installIfNeeded();

  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: join(root, '.env') });
  const { readBedrockSettings } = await import('../server/bedrock.js');

  const envNotice = envFileNotice(existsSync(join(root, '.env')));
  if (envNotice) console.log(envNotice);
  for (const line of optionalKeyNotices({
    jevKey: process.env.JEV_API_KEY,
    bedrockConfigured: readBedrockSettings().configured,
  })) {
    console.log(line);
  }

  const phone = phoneRequested(process.argv.slice(2), process.env);
  const launchPlan = dashboardLaunch({ phone, addresses: phone ? lanAddresses() : [] });
  const childEnv = {
    ...process.env,
    ALLOWANCE_NOTICES_SHOWN: '1',
    DASHBOARD_HOST: launchPlan.host,
    DASHBOARD_ORIGIN: launchPlan.origins.join(','),
  };
  const children = [];
  let shuttingDown = false;

  function stopChild(child) {
    if (!child.pid || child.exitCode != null) return;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      return;
    }
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }

  function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) stopChild(child);
    setTimeout(() => process.exit(code), 400).unref();
  }

  function launch(label, command, args) {
    const child = spawn(command, args, {
      cwd: root,
      env: childEnv,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    children.push(child);
    child.on('error', (error) => {
      console.error(`${label} could not start. ${error.message}`);
      shutdown(1);
    });
    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      const why = signal ? ` (${signal})` : code ? ` (exit ${code})` : '';
      console.error(`${label} stopped${why}. If a port is already in use, close the other window and run npm start again.`);
      shutdown(code || 1);
    });
    return child;
  }

  launch('The allowance server', process.execPath, ['server/index.js']);
  launch('The dashboard', npmBin(), ['--prefix', 'dashboard', 'run', 'dev', '--', '--host', launchPlan.host]);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  const ready = await waitForHttp(DASHBOARD_URL);
  console.log(`Dashboard: ${DASHBOARD_URL}`);
  if (phone) {
    if (launchPlan.phone.length) {
      for (const url of launchPlan.phone) console.log(`On your phone: ${url}`);
    } else {
      console.log('No LAN address found. Join Wi-Fi, then run npm run start:phone again.');
    }
  }
  if (ready) openDashboard(DASHBOARD_URL);
  else console.log('The dashboard is still starting. Open the URL above if the browser does not.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
