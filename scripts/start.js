/**
 * One command for a beginner: check Node, install if needed, start the
 * allowance API and the dashboard, print the dashboard URL, and open it.
 *
 *   npm start
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DASHBOARD_URL,
  browserOpen,
  dashboardInstall,
  dashboardLaunch,
  envFileNotice,
  installStaleness,
  lanAddresses,
  missingInstalls,
  nodeVersionProblem,
  npmBin,
  npmSpawnOptions,
  optionalKeyNotices,
  phoneRequested,
} from './start-lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function runNpm(args) {
  const result = spawnSync(npmBin(), args, { cwd: root, stdio: 'inherit', ...npmSpawnOptions() });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error('npm install failed. Read the message above, then run npm start again.');
    process.exit(result.status ?? 1);
  }
}

function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** Is dir/node_modules missing, or older than dir/package.json and its lockfile? */
function staleness(dir) {
  const modules = join(dir, 'node_modules');
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    /* No manifest to compare. */
  }
  const manifestTimes = [mtime(join(dir, 'package.json')), mtime(join(dir, 'package-lock.json'))].filter((at) => at != null);
  return installStaleness({
    modulesExists: existsSync(modules),
    installedAt: mtime(join(modules, '.package-lock.json')),
    manifestAt: manifestTimes.length ? Math.max(...manifestTimes) : null,
    dependencies: [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})],
    hasDependency: (name) => existsSync(join(modules, ...name.split('/'))),
  });
}

function installIfNeeded() {
  for (const step of missingInstalls(existsSync(join(root, 'node_modules')))) {
    console.log(step.label);
    runNpm(step.args);
  }
  const dashboard = dashboardInstall(staleness(join(root, 'dashboard')));
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

  const { clearStaleMerchantLocks } = await import('../shared/merchant-lock.js');
  const { merchantPort, historyPort } = await import('../shared/catalog.js');

  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: join(root, '.env') });
  const { readBedrockSettings } = await import('../server/bedrock.js');

  // A merchant that crashed or was closed with its window leaves merchant.lock behind.
  for (const row of await clearStaleMerchantLocks([
    { stateDirectory: process.env.MERCHANT_STATE_DIRECTORY || join(root, 'merchant', 'state'), port: merchantPort(process.env) },
    { stateDirectory: process.env.HISTORY_STATE_DIRECTORY || join(root, 'merchant', 'state-history'), port: historyPort(process.env) },
  ])) {
    if (row.verdict === 'stale') console.log(`Removed a leftover merchant lock in ${row.stateDirectory}. No merchant was running.`);
  }

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

  function launch(label, command, args, extra = {}) {
    const child = spawn(command, args, {
      cwd: root,
      env: childEnv,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      windowsHide: true,
      ...extra,
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
  launch('The dashboard', npmBin(), ['--prefix', 'dashboard', 'run', 'dev', '--', '--host', launchPlan.host], npmSpawnOptions());

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
