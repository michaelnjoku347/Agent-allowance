import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

const CANDIDATES = [
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
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

async function up(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    return response.status < 500;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('phone pages do not scroll sideways at 320 and 390', async () => {
  const chromeBin = resolveChrome();
  let vite = null;
  if (!(await up('http://127.0.0.1:5173/'))) {
    vite = spawn('npm', ['--prefix', 'dashboard', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      cwd: new URL('../..', import.meta.url).pathname,
      stdio: 'ignore',
    });
    for (let i = 0; i < 40 && !(await up('http://127.0.0.1:5173/')); i += 1) await wait(250);
  }
  assert.equal(await up('http://127.0.0.1:5173/'), true, 'dashboard dev server');

  const chrome = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=9225',
    '--user-data-dir=/tmp/chrome-reflow',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
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
        await page('Page.navigate', { url: 'http://127.0.0.1:5173/' });
        let ready = false;
        for (let i = 0; i < 40; i += 1) {
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
              pillBesideTime: Boolean(time && pill && Math.abs(pill.getBoundingClientRect().top - time.getBoundingClientRect().top) < 12),
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
        assert.equal(box.pillBesideTime, true, `${width} ${theme} status pill sits beside the time`);
        assert.ok(
          box.scrollWidth <= box.clientWidth,
          `${width} ${theme} scrollWidth ${box.scrollWidth} clientWidth ${box.clientWidth} innerWidth ${box.innerWidth}`,
        );
        await send('Target.closeTarget', { targetId: created.targetId });
      }
    }
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    if (vite) vite.kill('SIGKILL');
  }
});
