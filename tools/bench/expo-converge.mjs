#!/usr/bin/env node
// EXPOSURE CONVERGENCE (bench-zone0-stalls): the auto-exposure series through a light change, on the
// stepped loop with the clock plugged and pinned, so two builds can be compared frame for frame.
// 5 s on the deck (fresh load), then a cut to the zone-0 seabed under the raft (z0's mark) and 25 s
// there: 1800 rendered frames at dt 1/60. Between frames it calls postfx.frameStart(60), the paced
// frame's start, so a build that maps the readback back there (stalls branch) does so here too.
//   node tools/bench/expo-converge.mjs <url> <out.json>      (Env BENCH_DBG_PORT, as cdp.mjs)
import { writeFileSync } from 'node:fs';
import { plug, drift, lost, unmeasured } from './clockplug.mjs';
const DBG = +(process.env.BENCH_DBG_PORT || 9333);
const [, , URL0, OUTF] = process.argv;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function json(path) { const r = await fetch(`http://127.0.0.1:${DBG}${path}`); return r.json(); }
const tgt = (await json('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true, timeout: 600000 });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails));
  return r.result.result.value;
}
async function until(expr, ms = 240000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return; } catch (e) { } await sleep(300); } throw new Error('timeout ' + expr); }
const c = { ev };
await send('Page.navigate', { url: URL0 });
await sleep(1500);
await until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__exposure`);
await ev(`(() => { try { localStorage.clear(); } catch (e) {} __bench.size(1512, 982); window.setState('play'); window.__helm = true; window.survival.hose = 5000; __power.set(60, 60); __drs.pin(1.5); return 1; })()`);
await sleep(1500);
await plug(c);
const res = await ev(`(async () => {
  const P = await import(new URL('src/postfx.js', document.baseURI).href);
  window.__plugClk.clock.elapsedTime = 100; window.__plugClk.e0 = 100;   // the same sky, sea and weather on every load
  const S = [], st = () => { const s = __exposure.state(); return [s.ev, s.exposure, s.meanLog, s.samples, s.target]; };
  const rec = () => { P.frameStart(60); S.push(st()); };
  __bench.step(300, rec, { render: true });                      // the deck
  __bench.place(4, 4, 0.5, 0);                                    // the cut: z0's mark on the seabed
  __bench.step(1500, rec, { render: true });
  return S;
})()`);
const d = await drift(c);
writeFileSync(OUTF, JSON.stringify({ url: URL0, drift: d, series: res }));
console.log(JSON.stringify({ url: URL0, n: res.length, drift: d, lost: lost(d), unmeasured: unmeasured(d), first: res[0], cut: res[299], end: res[res.length - 1] }));
ws.close();
