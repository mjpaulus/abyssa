#!/usr/bin/env node
// PERF HARNESS HOST (roadmap/perf-budget-oct.md, CLAUDE.md "Perf harness"). A private,
// headless Chrome driven over the DevTools protocol, so __bench (src/lib/bench.js) runs in a
// page that is VISIBLE to the browser (rAF live, no hidden-tab timer clamp) in a process at
// normal QoS. The agent Browser pane is usually hidden, and macOS then parks its renderer on
// the efficiency cores: the same JS ran 3-4x slower there (bench `cal` 8-13 ms vs 2.1-2.6),
// which is most of the +-3-6 ms noise every earlier reading carried.
//
//   node tools/bench/cdp.mjs start [port=9021] [w=1512] [h=982]  -> launches Chrome, opens ?bench
//   node tools/bench/cdp.mjs eval "<js expression, await ok>"     -> prints the JSON result
//   node tools/bench/cdp.mjs run probe.js                          -> the file is an async function body
//   node tools/bench/cdp.mjs png out.png "<expr -> data URL>"       -> writes the PNG (e.g. __bench.png(window.cap))
//   node tools/bench/cdp.mjs reload                                -> fresh load of the page
//   node tools/bench/cdp.mjs console                               -> console lines since load
//   node tools/bench/cdp.mjs stop
//
// Own --user-data-dir under $TMPDIR (never the user's profile), debugging port 9333.
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DBG = +(process.env.BENCH_DBG_PORT || 9333);
const DIR = join(process.env.BENCH_TMP || tmpdir(), 'abyssa-bench-chrome');
const STATE = join(DIR, 'state.json');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [, , cmd, ...args] = process.argv;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function json(path) { const r = await fetch(`http://127.0.0.1:${DBG}${path}`); return r.json(); }
async function pageWs() {
  const list = await json('/json/list');
  const p = list.find(t => t.type === 'page' && /[?&]bench/.test(t.url)) || list.find(t => t.type === 'page');
  if (!p) throw new Error('no page target');
  return p.webSocketDebuggerUrl;
}
function rpc(url) {
  const ws = new WebSocket(url);
  let id = 0; const wait = new Map(); const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } else if (d.method) events.push(d);
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ready, send, events, close: () => ws.close() };
}

if (cmd === 'start') {
  const [port = '9021', w = '1512', h = '982'] = args;
  mkdirSync(DIR, { recursive: true });
  const url = `http://localhost:${port}/?bench`;
  const ch = spawn(CHROME, [
    `--user-data-dir=${join(DIR, 'profile')}`, `--remote-debugging-port=${DBG}`,
    '--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-device-scale-factor=2', '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    `--window-size=${w},${+h + 87}`, url
  ], { detached: true, stdio: 'ignore' });
  ch.unref();
  writeFileSync(STATE, JSON.stringify({ pid: ch.pid, url }));
  for (let i = 0; i < 40; i++) { try { await json('/json/version'); break; } catch (e) { await sleep(250); } }
  console.log(JSON.stringify({ pid: ch.pid, url, version: (await json('/json/version')).Browser }));
} else if (cmd === 'stop') {
  if (existsSync(STATE)) { const s = JSON.parse(readFileSync(STATE, 'utf8')); try { process.kill(s.pid); } catch (e) { /* gone */ } }
  try { execSync(`pkill -f "user-data-dir=${join(DIR, 'profile')}"`); } catch (e) { /* none */ }
  console.log('stopped');
} else if (cmd === 'eval' || cmd === 'run' || cmd === 'png' || cmd === 'reload' || cmd === 'console') {
  const c = rpc(await pageWs());
  await c.ready;
  if (cmd === 'reload') {
    await c.send('Page.reload', { ignoreCache: true });
    console.log('reloaded');
  } else if (cmd === 'console') {
    await c.send('Runtime.enable'); await sleep(300);
    for (const e of c.events) if (e.method === 'Runtime.consoleAPICalled') console.log(e.params.type, e.params.args.map(a => a.value ?? a.description).join(' '));
    else if (e.method === 'Runtime.exceptionThrown') console.log('EXC', e.params.exceptionDetails.text, e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description);
  } else {
    // eval: one expression; run <file.js>: the file is an async function BODY (use return)
    const src = cmd === 'run' ? `(async () => { ${readFileSync(args[0], 'utf8')}\n})()`
      : cmd === 'png' ? `(async () => (${args.slice(1).join(' ')}))()` : `(async () => (${args.join(' ')}))()`;
    const r = await c.send('Runtime.evaluate', { expression: src, awaitPromise: true, returnByValue: true, timeout: 600000 });
    if (r.result.exceptionDetails) console.log('ERROR', JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails));
    else if (cmd === 'png') { const v = r.result.result.value; writeFileSync(args[0], Buffer.from(String(v).split(',')[1], 'base64')); console.log('wrote ' + args[0]); }
    else { const v = r.result.result.value; console.log(typeof v === 'string' ? v : JSON.stringify(v)); }
  }
  c.close();
} else {
  console.log('usage: cdp.mjs start [port] [w] [h] | eval "<expr>" | reload | console | stop');
}
