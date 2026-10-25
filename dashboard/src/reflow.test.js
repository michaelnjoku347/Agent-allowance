import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WINDOWS = process.platform === 'win32';
const programFiles = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);

const CANDIDATES = [
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  // Playwright's bundled Chromium, present on many CI and cloud images.
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ...programFiles.map((dir) => join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe')),
];

function resolveChrome() {
  const fromEnv = process.env.CHROME_PATH || process.env.CHROME || '';
  if (fromEnv) {
    assert.equal(existsSync(fromEnv), true, `CHROME_PATH does not exist: ${fromEnv}`);
    return fromEnv;
  }
  const found = CANDIDATES.find((bin) => existsSync(bin));
  assert.ok(
    found,
    'Chrome was not found. Set CHROME_PATH to a Chrome or Chromium binary. This test does not skip when Chrome is missing.',
  );
  return found;
}

const DASHBOARD = 'http://127.0.0.1:5173/';

async function up(url, ms = 800) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return response.status < 500;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A cold Vite on a CI runner can take several seconds to pre-bundle before it
// answers reliably, so wait against a deadline, not a fixed number of tries.
async function waitUntilUp(url, deadlineMs) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (await up(url, 5000)) return true;
    await wait(250);
  }
  return false;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (WINDOWS) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    // npm starts sh, node, and esbuild. Kill the whole group so nothing outlives the test.
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/** Kill Chrome and wait for it to exit, so its profile folder is no longer being written. */
async function killChrome(chrome) {
  if (!chrome || chrome.exitCode !== null || chrome.signalCode) return;
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  chrome.kill('SIGKILL');
  await Promise.race([exited, wait(5000)]);
}

/** A temp profile is best-effort cleanup. A stray lock file must not fail the test. */
function removeProfile(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* The OS temp cleaner will get it. */
  }
}

// A cold Vite pre-bundles React and the Ledger kit on first start. On a slow
// laptop or a shared CI runner that alone can take most of a minute.
test('phone pages do not scroll sideways at 320 and 390', { timeout: 150_000 }, async () => {
  const chromeBin = resolveChrome();
  const profile = mkdtempSync(join(tmpdir(), 'chrome-reflow-'));
  let vite = null;
  let chrome = null;
  try {
    if (!(await up(DASHBOARD))) {
      vite = spawn(WINDOWS ? 'npm.cmd' : 'npm', ['--prefix', 'dashboard', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        stdio: 'ignore',
        detached: !WINDOWS,
        shell: WINDOWS,
        windowsHide: true,
      });
    }
    assert.equal(await waitUntilUp(DASHBOARD, 90_000), true, 'dashboard dev server');
    // Warm the module graph so the first Chrome load is not the one paying for it.
    assert.equal(await up(new URL('/src/main.jsx', DASHBOARD).href, 15_000), true, 'dashboard entry module');

    chrome = spawn(chromeBin, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--remote-debugging-port=9225',
      `--user-data-dir=${profile}`,
      'about:blank',
    ], { stdio: 'ignore' });

    let version;
    for (let i = 0; i < 40; i += 1) {
      await wait(200);
      try {
        version = await (await fetch('http://127.0.0.1:9225/json/version')).json();
        break;
      } catch {
        /* chrome is still starting */
      }
    }
    assert.ok(version?.webSocketDebuggerUrl, 'chrome debugging socket');
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    const send = (method, params = {}, sessionId) => {
      const msgId = ++id;
      const payload = { id: msgId, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
    };

    for (const width of [320, 390]) {
      for (const theme of ['light', 'dark']) {
        const created = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
        const page = (method, params) => send(method, params, sessionId);
        await page('Page.enable');
        await page('Runtime.enable');
        await page('Emulation.setDeviceMetricsOverride', {
          width, height: 700, deviceScaleFactor: 1, mobile: true,
        });
        await page('Page.addScriptToEvaluateOnNewDocument', {
          source: `
            localStorage.setItem('allowance-theme', ${JSON.stringify(theme)});
            const originalFetch = window.fetch.bind(window);
            window.fetch = (input, init) => {
              const url = typeof input === 'string' ? input : (input && input.url) || '';
              if (url.includes('/api/status') || url.includes('/api/payments') || url.includes('/api/pending')) {
                return Promise.reject(new TypeError('reflow fixture'));
              }
              return originalFetch(input, init);
            };
          `,
        });
        await page('Page.navigate', { url: DASHBOARD });
        let ready = false;
        for (let i = 0; i < 100; i += 1) {
          await wait(200);
          const probe = await page('Runtime.evaluate', {
            expression: 'Boolean(document.querySelector(".hero") && document.querySelector(".pill.danger") && document.querySelector(".pill.warn"))',
            returnByValue: true,
          });
          if (probe.result?.value) {
            ready = true;
            break;
          }
        }
        assert.equal(ready, true, `${width} ${theme} rendered the sample activity`);
        await wait(300);
        const measured = await page('Runtime.evaluate', {
          expression: `(() => {
            const root = document.documentElement;
            const pills = [...document.querySelectorAll('.activity .pill')].map((el) => el.textContent.trim());
            const merchant = [...document.querySelectorAll('.flow-label')].find((el) => el.textContent.trim() === 'Merchant');
            const items = [...document.querySelectorAll('.flow-item')];
            const tops = items.map((el) => el.getBoundingClientRect().top);
            const lines = [...document.querySelectorAll('.flow-line')].map((el) => el.getBoundingClientRect().width);
            const steps = [...document.querySelectorAll('.flow-step')].map((el) => ({
              label: el.querySelector('.flow-label')?.textContent.trim() || '',
              width: el.getBoundingClientRect().width,
              lines: el.querySelector('.flow-label')?.getClientRects().length || 0,
            }));
            const blocked = [...document.querySelectorAll('.activity .row')].find((el) => el.querySelector('.pill.danger'));
            const title = blocked?.querySelector('.row-title');
            const pill = blocked?.querySelector('.pill');
            const time = blocked?.querySelector('.row-time');
            const task = blocked?.querySelector('.row-task');
            const box = (el) => el.getBoundingClientRect();
            return {
              scrollWidth: root.scrollWidth,
              clientWidth: root.clientWidth,
              innerWidth: window.innerWidth,
              pills,
              merchantLines: merchant ? merchant.getClientRects().length : 0,
              sameRow: tops.length > 0 && Math.max(...tops) - Math.min(...tops) <= 2,
              lines,
              steps,
              pillBelowTitle: Boolean(title && pill && pill.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 2),
              timeUnderPill: Boolean(time && pill && box(time).top >= box(pill).bottom - 2 && Math.abs(box(time).right - box(pill).right) <= 1),
              taskUnderTitle: Boolean(task && title && Math.abs(box(task).left - box(title).left) <= 1),
            };
          })()`,
          returnByValue: true,
        });
        const box = measured.result.value;
        assert.ok(box.pills.includes('Blocked'), `${width} ${theme} shows a Blocked row`);
        assert.ok(box.pills.includes('Needs you'), `${width} ${theme} shows a Needs you row`);
        assert.equal(box.merchantLines, 1, `${width} ${theme} Merchant stays on one line`);
        assert.equal(box.sameRow, true, `${width} ${theme} stepper stays on one row`);
        assert.ok(box.lines.every((line) => line >= 8), `${width} ${theme} connectors ${box.lines.join(',')}`);
        assert.ok(box.steps.every((step) => step.lines === 1), `${width} ${theme} a step label wrapped`);
        if (width >= 390) {
          assert.ok(box.steps.every((step) => step.width >= 52), `${width} ${theme} steps ${box.steps.map((step) => step.width).join(',')}`);
        }
        assert.equal(box.pillBelowTitle, true, `${width} ${theme} status pill is on the second line`);
        assert.equal(box.timeUnderPill, true, `${width} ${theme} time sits right-aligned under the status pill`);
        assert.equal(box.taskUnderTitle, true, `${width} ${theme} task lines up under the merchant name`);
        assert.ok(
          box.scrollWidth <= box.clientWidth,
          `${width} ${theme} scrollWidth ${box.scrollWidth} clientWidth ${box.clientWidth} innerWidth ${box.innerWidth}`,
        );
        await send('Target.closeTarget', { targetId: created.targetId });
      }
    }
    ws.close();
  } finally {
    await killChrome(chrome);
    stop(vite);
    removeProfile(profile);
  }
});

/** Start Vite if it is not up, and a headless Chrome with a CDP session helper. */
async function openBrowser(port) {
  const chromeBin = resolveChrome();
  const profile = mkdtempSync(join(tmpdir(), 'chrome-onboard-'));
  let vite = null;
  if (!(await up(DASHBOARD))) {
    vite = spawn(WINDOWS ? 'npm.cmd' : 'npm', ['--prefix', 'dashboard', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      stdio: 'ignore',
      detached: !WINDOWS,
      shell: WINDOWS,
      windowsHide: true,
    });
  }
  assert.equal(await waitUntilUp(DASHBOARD, 90_000), true, 'dashboard dev server');
  assert.equal(await up(new URL('/src/main.jsx', DASHBOARD).href, 15_000), true, 'dashboard entry module');
  const chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 40 && !version; i += 1) {
    await wait(200);
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      /* chrome is still starting */
    }
  }
  assert.ok(version?.webSocketDebuggerUrl, 'chrome debugging socket');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}, sessionId) => {
    const msgId = ++id;
    ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
  };
  return {
    send,
    async close() {
      ws.close();
      await killChrome(chrome);
      stop(vite);
      removeProfile(profile);
    },
  };
}

test('the first-run intro is a keyboard dialog, pages name themselves, and nothing moves under reduced motion', { timeout: 150_000 }, async () => {
  const browser = await openBrowser(9226);
  try {
    const { send } = browser;
    const created = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    await page('Page.enable');
    await page('Runtime.enable');
    await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        localStorage.removeItem('allowance-intro-done');
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.includes('/api/')) return Promise.reject(new TypeError('onboarding fixture'));
          return originalFetch(input, init);
        };
      `,
    });
    await page('Page.navigate', { url: DASHBOARD });
    const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
    let open = false;
    for (let i = 0; i < 100 && !open; i += 1) {
      await wait(200);
      open = await evaluate('Boolean(document.querySelector(".onboard[role=dialog][aria-modal=true]"))');
    }
    assert.equal(open, true, 'the intro opens on first run');
    await wait(300);
    assert.equal(await evaluate('document.activeElement?.tagName'), 'H2', 'focus starts on the slide heading');
    assert.equal(await evaluate('document.querySelectorAll(".dot").length'), 4);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".slide.is-active .slide-copy")).animationName'), 'none', 'no slide animation under reduced motion');
    const key = async (keyName, code, keyCode) => {
      await page('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode });
      await page('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode });
      await wait(150);
    };
    await key('ArrowRight', 'ArrowRight', 39);
    assert.equal(await evaluate('[...document.querySelectorAll(".dot")].findIndex((dot) => dot.classList.contains("is-on"))'), 1, 'ArrowRight moves to slide 2');
    await key('ArrowLeft', 'ArrowLeft', 37);
    assert.equal(await evaluate('[...document.querySelectorAll(".dot")].findIndex((dot) => dot.classList.contains("is-on"))'), 0, 'ArrowLeft moves back');
    const sizes = await evaluate('[...document.querySelectorAll(".onboard button")].filter((b) => b.offsetParent && getComputedStyle(b).visibility !== "hidden").map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); })');
    assert.ok(sizes.every((size) => size >= 40), `touch targets ${sizes.join(',')}`);
    await key('Escape', 'Escape', 27);
    assert.equal(await evaluate('Boolean(document.querySelector(".onboard"))'), false, 'Escape closes the intro');
    assert.equal(await evaluate('localStorage.getItem("allowance-intro-done")'), 'skipped');

    // Moving to a page names it in the tab and puts focus on its heading.
    assert.equal(await evaluate('document.title'), 'Agent Allowance');
    await evaluate('location.hash = "#/security"');
    await wait(400);
    assert.equal(await evaluate('document.title'), 'Security · Agent Allowance');
    assert.equal(await evaluate('document.activeElement?.tagName + " " + document.activeElement?.textContent'), 'H1 Security');
    const moving = await evaluate(`[...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      const animated = cs.animationName !== 'none' && cs.animationDuration.split(',').some((d) => parseFloat(d) > 0.001);
      const sliding = cs.transitionProperty !== 'none' && cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0.001);
      return animated || sliding;
    }).length`);
    assert.equal(moving, 0, 'nothing moves under reduced motion');
    await send('Target.closeTarget', { targetId: created.targetId });
  } finally {
    await browser.close();
  }
});
