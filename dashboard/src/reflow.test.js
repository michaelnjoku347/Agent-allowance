import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

const CHROME = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']
  .find((bin) => existsSync(bin));

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

test('phone pages do not scroll sideways at 320 and 390', { skip: CHROME ? false : 'Chrome is not installed' }, async () => {
  let vite = null;
  if (!(await up('http://127.0.0.1:5173/'))) {
    vite = spawn('npm', ['--prefix', 'dashboard', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      cwd: new URL('../..', import.meta.url).pathname,
      stdio: 'ignore',
    });
    for (let i = 0; i < 40 && !(await up('http://127.0.0.1:5173/')); i += 1) await wait(250);
  }
  assert.equal(await up('http://127.0.0.1:5173/'), true, 'dashboard dev server');

  const chrome = spawn(CHROME, [
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
          source: `localStorage.setItem('allowance-theme', ${JSON.stringify(theme)});`,
        });
        await page('Page.navigate', { url: 'http://127.0.0.1:5173/' });
        let ready = false;
        for (let i = 0; i < 40; i += 1) {
          await wait(200);
          const probe = await page('Runtime.evaluate', {
            expression: 'Boolean(document.querySelector(".hero, .loading-splash"))',
            returnByValue: true,
          });
          if (probe.result?.value) {
            ready = true;
            break;
          }
        }
        assert.equal(ready, true, `${width} ${theme} rendered`);
        await wait(300);
        const measured = await page('Runtime.evaluate', {
          expression: `(() => {
            const root = document.documentElement;
            return { scrollWidth: root.scrollWidth, innerWidth: window.innerWidth, clientWidth: root.clientWidth };
          })()`,
          returnByValue: true,
        });
        const box = measured.result.value;
        assert.ok(box.scrollWidth <= box.innerWidth, `${width} ${theme} scrollWidth ${box.scrollWidth} innerWidth ${box.innerWidth}`);
        await send('Target.closeTarget', { targetId: created.targetId });
      }
    }
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    if (vite) vite.kill('SIGKILL');
  }
});
