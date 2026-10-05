#!/usr/bin/env node
// HITCH PROBE (roadmap/loading-and-hitches.md). Drives the bench Chrome (tools/bench/cdp.mjs
// start) through the two transitions the player feels, with REAL input over CDP:
//   1. a fresh load -> loader timeline (marks) -> title
//   2. a mouse click on the title (title -> play)
//   3. W held from the deck spawn until Sal is in the water (the first dive)
// and records, around each: every rAF interval, every long task (PerformanceObserver),
// renderer.info.programs over time, the scene light count, DRS scale and the perf judge.
//
//   node tools/bench/hitch.mjs [url]           -> JSON report on stdout
// Env: BENCH_DBG_PORT (default 9333) as cdp.mjs.
const DBG = +(process.env.BENCH_DBG_PORT || 9333);
const URL0 = process.argv[2] || null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function json(path) { const r = await fetch(`http://127.0.0.1:${DBG}${path}`); return r.json(); }
const list = await json('/json/list');
const tgt = list.find(t => t.type === 'page' && /[?&]bench/.test(t.url)) || list.find(t => t.type === 'page');
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
async function until(expr, ms = 120000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await ev(expr)) return Date.now() - t0; } catch (e) { /* page loading */ } await sleep(step); }
  throw new Error('timeout: ' + expr);
}

// Install the recorder before the page runs: long tasks + every rAF interval, from t=0.
const REC = `
  window.__hx = { lt: [], fr: [], marks: [], t0: performance.now() };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) __hx.lt.push([+e.startTime.toFixed(1), +e.duration.toFixed(1)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  (function f(t) { __hx.fr.push(+t.toFixed(2)); requestAnimationFrame(f); })(performance.now());
`;
await send('Page.enable');
await send('Runtime.enable');
const sid = await send('Page.addScriptToEvaluateOnNewDocument', { source: REC });
const tNav = Date.now();
await send('Page.navigate', { url: URL0 || tgt.url });
await sleep(500);
// booted: the loader is gone and the title shows
const bootMs = await until(`!document.getElementById('load') && typeof window.start === 'function'`, 180000);
await sleep(3000);   // a settled title
const lightsN = `(() => { let n = 0; window.scene.traverse(o => { if (o.isLight) n++; }); return n; })()`;
const progs = `(await import('/src/core.js')).renderer.info.programs.length`;
const boot = await ev(`({ marks: performance.getEntriesByType('measure').map(m => [m.name, +m.duration.toFixed(0)]).concat(performance.getEntriesByType('mark').map(m => [m.name, +m.startTime.toFixed(0)])),
  programs: ${progs}, lights: ${lightsN}, drs: window.__drs && __drs.state().scale, focus: document.hasFocus(), lt: __hx.lt.slice() })`);

// snapshot a window [t0, t0+ms] of the recorder: frame intervals + long tasks + program/light timeline
async function windowAround(label, act, ms = 6000, anchor = null) {
  await ev(`(window.__hx.tl = [], window.__hx.mark = performance.now(), (async () => { const R = (await import('/src/core.js')).renderer; window.__hx.tlI = setInterval(() => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); __hx.tl.push([+(performance.now() - __hx.mark).toFixed(0), R.info.programs.length, n, window.__drs ? __drs.state().scale : null]); }, 100); })(), 1)`);
  const tAct = await ev(`performance.now()`);
  await act();
  await sleep(ms);
  return ev(`(() => { clearInterval(__hx.tlI); const t0 = ${anchor || tAct}, fr = __hx.fr.filter(t => t >= t0 - 500), iv = [];
    for (let i = 1; i < fr.length; i++) iv.push([+(fr[i] - t0).toFixed(1), +(fr[i] - fr[i - 1]).toFixed(1)]);
    const lt = __hx.lt.filter(e => e[0] >= t0 - 500).map(e => [+(e[0] - t0).toFixed(0), e[1]]);
    const after = iv.filter(e => e[0] > 0).map(e => e[1]).sort((a, b) => a - b);
    const q = p => after.length ? after[Math.min(after.length - 1, Math.floor(p * after.length))] : null;
    const tl = __hx.tl; const ch = []; for (let i = 0; i < tl.length; i++) if (!i || tl[i][1] !== tl[i - 1][1] || tl[i][2] !== tl[i - 1][2] || tl[i][3] !== tl[i - 1][3]) ch.push(tl[i]);
    return { label: ${JSON.stringify(label)}, frames: after.length, median: q(0.5), p95: q(0.95), max: after[after.length - 1],
      over33: after.filter(x => x > 33.4).length, over50: after.filter(x => x > 50).length,
      worst: iv.filter(e => e[0] > -200).sort((a, b) => b[1] - a[1]).slice(0, 12).sort((a, b) => a[0] - b[0]),
      longtasks: lt, timeline: ch, perf: window.__perf && __perf.state(), state: window.__power && __power.state().state };
  })()`);
}

const out = { bootMs, boot };
await ev(`(window.__helm = true, 1)`);
if (process.env.PRECLICK) { await ev(process.env.PRECLICK); await sleep(+(process.env.PRECLICK_MS || 3000)); }
// 2. the click: a real mouse press/release on the centre of the title
const W = await ev(`[innerWidth, innerHeight]`);
out.click = await windowAround('title->play click', async () => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x: W[0] / 2, y: W[1] / 2, button: 'left', clickCount: 1 });
}, 8000);
out.click.gameState = await ev(`__power.state().state`);
out.click.lightsAfter = await ev(lightsN);
// settle a little on deck, then 3. walk off the side with W held (spawn faces the boarding gap)
await sleep(4000);
out.deckSteady = await ev(`(async () => { const t0 = performance.now(), n0 = __hx.fr.length; await new Promise(r => setTimeout(r, 2000)); const fr = __hx.fr.slice(n0), iv = []; for (let i = 1; i < fr.length; i++) iv.push(fr[i] - fr[i - 1]); iv.sort((a, b) => a - b); return { median: +iv[iv.length >> 1].toFixed(2), max: +iv[iv.length - 1].toFixed(2), n: iv.length, programs: ${progs} }; })()`);
const key = (type, code, k) => send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
let entered = null;
// SCEN=jet,z1,z2,voyage: the later first-time transitions, each a measured window
// (z1/z2 arrive by __bench.place -- the same enterZone the rift descent calls -- with the
// camera on the sleeper; z2wake brings Mhor in; jet holds the REAL Space key in water;
// voyage sails to anchorage 1 and is anchored at the chart dissolving back to play)
const SCEN = (process.env.SCEN || '').split(',').filter(Boolean);
if (SCEN.length) {
  out.scen = {};
  const progN = async () => ev(progs);
  for (const sc of SCEN) {
    const p0 = await progN();
    if (sc === 'jet') {
      await ev(`(__bench.place(4, 4, 0.5, 0), 1)`); await sleep(4000);
      const q0 = await progN();
      out.scen.jet = await windowAround('first jet burst', async () => {
        await key('keyDown', 'Space', ' '); await sleep(1500); await key('keyUp', 'Space', ' ');
      }, 4000);
      out.scen.jet.newPrograms = (await progN()) - q0;
      out.scen.jet.pack = await ev(`({ taps: __pack.taps, holds: __pack.holds })`);
      continue;
    }
    if (sc === 'z1' || sc === 'z2') {
      const v = sc === 'z1' ? [-162, 70, -1.86, 1] : [-116.8, -6.8, 0.5, 2];
      out.scen[sc] = await windowAround(sc + ' arrival', async () => { await ev(`(__bench.place(${v.join(',')}), 1)`); }, 6000);
      out.scen[sc].newPrograms = (await progN()) - p0;
      if (sc === 'z2') {
        const q0 = await progN();
        out.scen.z2wake = await windowAround('Mhor arrives', async () => {
          await ev(`(window.__lev.cmd('wake'), window.__lev.cmd('wake'), 1)`);
          await ev(`(function f() { const s = __lev.state(); if (s && s.state !== 'absent') { const h = __sl && (__sl.head || __sl.pos); if (h) { camera.lookAt(h); } } })(), 1`);
        }, 8000);
        out.scen.z2wake.newPrograms = (await progN()) - q0;
        out.scen.z2wake.lev = await ev(`__lev.state() && __lev.state().state`);
      }
      continue;
    }
    if (sc === 'voyage') {
      await ev(`(__hx.backT = 0, window.__vg = 0, (function w() { const s = __power.state().state; if (s === 'voyage') __vg = 1; if (__vg && s === 'play') __hx.backT = performance.now(); else requestAnimationFrame(w); })(), 1)`);
      out.voyageTo = await ev(`(() => { let s = 0; try { s = JSON.parse(localStorage.getItem('abyssa.chart.v1')).site || 0; } catch (e) {} const to = s === 1 ? 2 : 1; __chart.sail(to); return to; })()`);
      await until(`__hx.backT > 0`, 30000, 50);
      out.scen.voyage = await windowAround('after the chart dissolves', async () => {}, 5000, '__hx.backT');
      out.scen.voyage.newPrograms = (await progN()) - p0;
      continue;
    }
  }
  out.end = await ev(`({ programs: ${progs}, lights: ${lightsN}, safe: window.__safeFailed ? __safeFailed() : null })`);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sid.result.identifier });
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  process.exit(0);
}
out.dive = await windowAround('first water entry', async () => {
  await ev(`(__hx.entryT = 0, (function w() { if (player.pos.y < -0.8) __hx.entryT = performance.now(); else requestAnimationFrame(w); })(), 1)`);
  await key('keyDown', 'KeyW', 'w');
  try { entered = await until(`window.player.pos.y < -0.8`, 20000, 16); } catch (e) { entered = 'never: ' + await ev(`window.player.pos.toArray()`); }
  await key('keyUp', 'KeyW', 'w');
}, 8000, '__hx.entryT');
out.dive.enteredAfterMs = entered;
out.dive.pos = await ev(`window.player.pos.toArray().map(v => +v.toFixed(2))`);
out.end = await ev(`({ programs: ${progs}, lights: ${lightsN}, safe: window.__safeFailed ? __safeFailed() : null })`);
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sid.result.identifier });
console.log(JSON.stringify(out, null, 1));
ws.close();
