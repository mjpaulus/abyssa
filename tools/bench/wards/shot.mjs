#!/usr/bin/env node
// Page screenshot (canvas + DOM HUD) from the bench host, optionally waiting for a page
// condition first (polled every ~16 ms over one CDP socket, so a short-lived beat - a ward's
// cold spark - can be caught while the real rAF loop runs).
//   node tools/bench/wards/shot.mjs out.png ["<expr: truthy when to shoot>"] [timeoutMs]
// Uses BENCH_DBG_PORT like cdp.mjs.
import { writeFileSync } from 'node:fs';
const DBG = +(process.env.BENCH_DBG_PORT || 9333);
const [, , out, cond, tmo = '20000'] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
const p = list.find(t => t.type === 'page' && /[?&]bench/.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const wait = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const t0 = Date.now();
let ok = !cond;
while (!ok && Date.now() - t0 < +tmo) {
  const r = await send('Runtime.evaluate', { expression: `!!(${cond})`, returnByValue: true });
  ok = r.result && r.result.result && r.result.result.value === true;
  if (!ok) await new Promise(r => setTimeout(r, 16));
}
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(s.result.data, 'base64'));
console.log(JSON.stringify({ out, waited: Date.now() - t0, condMet: ok }));
ws.close();
