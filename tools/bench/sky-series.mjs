#!/usr/bin/env node
// SKY SUN-VISIBILITY SERIES (roadmap/sky-probe-readback.md): the sky probe's readback series on the stepped loop with the clock
// plugged and pinned, so two builds can be compared frame for frame. Fresh load, the deck for 300 rendered frames, a cut to z0's
// mark on the seabed (the camera is deep: the probe does not run) for 250, then Alt+1 back to the deck for 300. Between frames it
// calls postfx.frameStart(60), the paced frame's start, so a build that maps the sky's readback back there (skyProbeEarly) does so
// here too. Per frame it books stats.sunVis (raw), __vsky.state().camSunVis, airAmbience.sunVis (the consumer: lighting.js scales
// the in-air key by it), the auto-exposure and, from a getBufferSubData wrapper, every raw value the sky ring read (skyVals).
//   node tools/bench/sky-series.mjs <url> <out.json>      (needs &playtest in the url; Env BENCH_DBG_PORT, as cdp.mjs)
// Compare two outputs with: node tools/bench/sky-series.mjs --cmp a.json b.json
// Exit (clockplug.mjs's convention): 0 measured, 2 UNMEASURED (no clock reading), 4 LOST (the game clock moved other than by the stepped frames).
import { writeFileSync, readFileSync } from 'node:fs';
import { plug, drift, lost, unmeasured } from './clockplug.mjs';
if (process.argv[2] === '--cmp') {
  const A = JSON.parse(readFileSync(process.argv[3])), B = JSON.parse(readFileSync(process.argv[4]));
  const cmp = (a, b) => { let n = Math.min(a.length, b.length), bad = 0, first = -1, maxd = 0; for (let i = 0; i < n; i++) { const x = a[i], y = b[i]; const d = Array.isArray(x) ? Math.max(...x.map((v, k) => Math.abs(v - y[k]))) : Math.abs(x - y); if (d > 0) { bad++; if (first < 0) first = i; } if (d > maxd) maxd = d; } return { n, lenA: a.length, lenB: b.length, differ: bad, first, maxAbsDiff: maxd }; };
  const out = {
    frames: cmp(A.frames.map(f => [f[0], f[1], f[2]]), B.frames.map(f => [f[0], f[1], f[2]])),   // stats.sunVis, camSunVis, airAmbience.sunVis
    exposure: cmp(A.frames.map(f => f[3]), B.frames.map(f => f[3])),
    skyVals: cmp(A.skyVals, B.skyVals),
    reads: cmp(A.frames.map(f => f[4]), B.frames.map(f => f[4])),                              // reads so far, per frame
    early: { A: A.early, B: B.early }
  };
  console.log(JSON.stringify(out));
  process.exit(out.frames.differ || out.exposure.differ || out.skyVals.differ || out.reads.differ || out.frames.lenA !== out.frames.lenB ? 1 : 0);
}
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
await until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__exposure && !!window.__playtest`);
await ev(`(() => { try { localStorage.clear(); } catch (e) {} __bench.size(1512, 982); window.setState('play'); window.__helm = true; window.survival.hose = 5000; __power.set(60, 60); __drs.pin(1.5); return 1; })()`);
await sleep(1500);
await plug(c);
const res = await ev(`(async () => {
  const P = await import(new URL('src/postfx.js', document.baseURI).href);
  const Wm = await import(new URL('src/world/water.js', document.baseURI).href);
  window.__plugClk.clock.elapsedTime = 100; window.__plugClk.e0 = 100;   // the same sky, sea and weather on every load
  // the sky ring's raw reads: the bound PIXEL_PACK_BUFFER tells the sky's from the exposure's (stalls.mjs does the same)
  const G = WebGL2RenderingContext.prototype, gbsd = G.getBufferSubData, bb = G.bindBuffer;
  let pack = null, expSet = null; const skyVals = [];
  G.bindBuffer = function (t, b) { if (t === 35051) pack = b; return bb.apply(this, arguments); };
  G.getBufferSubData = function (t, o, dst) {
    const r = gbsd.apply(this, arguments); const ep = __exposure.pass();
    if (!expSet || expSet.size !== ep.pbo.length) expSet = new Set(ep.pbo);
    if (pack && !expSet.has(pack)) skyVals.push(dst[0], dst[1]);
    return r;
  };
  const F = [], rec = () => { P.frameStart(60); const e = __exposure.state(); F.push([__vsky.stats.sunVis, __vsky.state().camSunVis, Wm.airAmbience.sunVis, [e.ev, e.exposure, e.meanLog, e.samples], skyVals.length / 2]); };
  // each rendered frame books AFTER its render (fn runs after the frame), so the frameStart in rec() is the NEXT frame's start
  const e0 = { sky: { ...__vsky.early }, exp: { ...__exposure.early } };
  __bench.step(300, rec, { render: true });                      // the deck
  __bench.place(4, 4, 0.5, 0);                                    // the cut: z0's mark on the seabed (deep: no probe)
  __bench.step(250, rec, { render: true });
  __playtest.jump('1');                                           // Alt+1: back to the deck
  __bench.step(300, rec, { render: true });
  G.getBufferSubData = gbsd; G.bindBuffer = bb;
  return { frames: F, skyVals, early: { sky: { ...__vsky.early }, exp: { ...__exposure.early }, e0 } };
})()`);
const d = await drift(c);
writeFileSync(OUTF, JSON.stringify({ url: URL0, drift: d, ...res }));
console.log(JSON.stringify({ url: URL0, n: res.frames.length, reads: res.skyVals.length / 2, drift: d, lost: lost(d), unmeasured: unmeasured(d), early: res.early, first: res.frames[0], end: res.frames[res.frames.length - 1] }));
ws.close();
if (unmeasured(d)) { console.log('UNMEASURED: no clock reading'); process.exit(2); }
if (lost(d)) { console.log('CLOCK LOST: drift ' + d.drift + ' s'); process.exit(4); }
