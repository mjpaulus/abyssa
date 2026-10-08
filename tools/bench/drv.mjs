// A tiny CDP driver for scripted REAL-input probes (brooderfix). Own Chrome, own port.
//   import { start, connect } from './drv.mjs'
//   node tools/bench/drv.mjs start <url>   |   node tools/bench/drv.mjs stop
// Env: DRV_PORT (debug port, default 9419), DRV_DIR (profile dir), DRV_W/DRV_H.
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const DBG = +(process.env.DRV_PORT || 9419);
const DIR = process.env.DRV_DIR || join(tmpdir(), 'abyssa-drv-' + DBG);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
async function json(p) { const r = await fetch(`http://127.0.0.1:${DBG}${p}`); return r.json(); }
export async function start(url) {
  mkdirSync(DIR, { recursive: true });
  const W = process.env.DRV_W || 1280, H = process.env.DRV_H || 800;
  const ch = spawn(CHROME, [`--user-data-dir=${join(DIR, 'profile')}`, `--remote-debugging-port=${DBG}`,
    '--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-device-scale-factor=1',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    `--window-size=${W},${H}`, url], { detached: true, stdio: 'ignore' });
  ch.unref();
  for (let i = 0; i < 60; i++) { try { await json('/json/version'); break; } catch (e) { await sleep(250); } }
  return ch.pid;
}
export function stop() { try { execSync(`pkill -f "remote-debugging-port=${DBG}"`); } catch (e) { } }
export async function connect() {
  const list = await json('/json/list');
  const p = list.find(t => t.type === 'page');
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  let id = 0; const wait = new Map(); const events = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } else if (d.method) events.push(d); };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true, timeout: 600000 });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails));
    return r.result.result.value;
  }
  async function until(expr, ms = 120000, step = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return Date.now() - t0; } catch (e) { } await sleep(step); }
    throw new Error('timeout: ' + expr);
  }
  const VK = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyE: 69, KeyC: 67, Space: 32, ShiftLeft: 16, Digit6: 54, KeyP: 80 };
  const KEYS = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyE: 'e', KeyC: 'c', Space: ' ', ShiftLeft: 'Shift', Digit6: '6', KeyP: 'p' };
  async function key(code, down, mods = 0) {
    await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: KEYS[code] || code, windowsVirtualKeyCode: VK[code] || 0, modifiers: mods });
  }
  async function tap(code, ms = 80, mods = 0) { await key(code, true, mods); await sleep(ms); await key(code, false, mods); }
  async function click(x, y) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  async function png(path, expr = `__bench.png(await __bench.capture({}), 1)`) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  }
  async function console_() {
    await send('Runtime.enable'); await send('Log.enable'); await sleep(300);
    const out = [];
    for (const e of events) if (e.method === 'Runtime.consoleAPICalled') out.push(e.params.type + ' ' + e.params.args.map(a => a.value ?? a.description).join(' '));
    else if (e.method === 'Log.entryAdded') out.push('log:' + e.params.entry.level + ' ' + e.params.entry.text + ' ' + (e.params.entry.url || ''));
    else if (e.method === 'Runtime.exceptionThrown') out.push('EXC ' + e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description));
    return out;
  }
  return { send, ev, until, key, tap, click, png, events, console: console_, close: () => ws.close() };
}
if (process.argv[1] && process.argv[1].endsWith('drv.mjs')) {
  const [, , cmd, url] = process.argv;
  if (cmd === 'start') console.log(await start(url));
  else if (cmd === 'stop') { stop(); console.log('stopped'); }
  else if (cmd === 'eval') { const c = await connect(); console.log(JSON.stringify(await c.ev(url))); c.close(); }
}
