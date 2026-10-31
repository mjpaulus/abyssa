#!/usr/bin/env node
// STALL PROBE (roadmap/bench-zone0-stalls.md). The frame-interval SERIES the player feels, not a
// mean: drives the bench Chrome (tools/bench/cdp.mjs start; for Michael's conditions run it with
// BENCH_VSYNC=1 BENCH_HEADFUL=1, a visible 60 Hz window) through a list of views and records, per
// game rAF callback: the rAF timestamp, the main-thread time of the game's frame(), the time spent
// inside getBufferSubData (every PBO map-back is a synchronous GPU-process round trip), whether the
// composer ran, the auto-exposure ring's issue/read counters and the seabed shadow refreshes.
//
//   node tools/bench/stalls.mjs <url> <view,view,..> [secs=15] [variant-js] [label]
//     view: a __bench VIEW (z0, z0b, z1, ...), 'alt6' (the playtest jump to Velkath's bed: url
//           needs &playtest) or 'deck' (Alt+1, deck calm)
//     variant-js: an expression run page-side after setup, before recording (an experiment knob),
//           e.g. "__exposure.set({every: 1e9})" (meter frozen). Default: none.
//           `__stall.pre = () => {...}` installs a hook the recorder calls first thing in each
//           game rAF, INSIDE the timed frame (the experiment that read the exposure PBO at
//           frame start: "__stall.pre = () => __exposure.pass()._poll()").
//   Targets the tab whose URL carries ?bench (as hitch.mjs does), else the first page; the tab
//   is parked on about:blank at the end only if it was a ?bench page to begin with (any other
//   page is sent back to the URL it had).
//   Env: BENCH_DBG_PORT (as cdp.mjs), STALL_SCALE (DRS pin; default the ceiling RES_SCALE),
//        STALL_OUT (append one JSON line per view to this file), STALL_TRACE=<file> (also a
//        DevTools trace of the last 4 s of each view: <file>.<view>.json).
// The map-back block is split by owner (the bound PIXEL_PACK_BUFFER: the exposure ring's, else the sky probe's): `gbExp`, `gbSky`,
// the work on sky read / issue / no-sky frames, and `skySeries` (the per-frame check that stats.sunVis is the last value the ring read).
// Prints per view: p50/p95/p99/max interval, missed-vsync count, stall-gap histogram, the
// autocorrelation of frame() main-thread time at lags 1..24, and the cost split by frame kind.
import { writeFileSync, appendFileSync } from 'node:fs';
const DBG = +(process.env.BENCH_DBG_PORT || 9333);
const [, , URL0, VIEWS = 'z0', SECS = '15', VARIANT = '', LABEL = ''] = process.argv;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function json(path) { const r = await fetch(`http://127.0.0.1:${DBG}${path}`); return r.json(); }
const list = await json('/json/list');
const tgt = list.find(t => t.type === 'page' && /[?&]bench/.test(t.url)) || list.find(t => t.type === 'page');
const ownTab = /[?&]bench/.test(tgt.url);
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
let id = 0; const wait = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } else if (d.method) events.push(d); };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true, timeout: 600000 });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails));
  return r.result.result.value;
}
async function until(expr, ms = 240000, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await ev(expr)) return Date.now() - t0; } catch (e) { /* loading */ } await sleep(step); }
  throw new Error('timeout: ' + expr);
}

// Page side: install the recorder once per load. rAF is wrapped so the GAME's callback (rafTick)
// is timed exactly; getBufferSubData is wrapped so each map-back's block is booked to the frame.
const INSTALL = `(async () => {
  if (window.__stall) return true;
  const Lm = await import('/src/lighting.js');
  const R = window.__stall = { on: false, rec: [], gb: 0, gbN: 0, Lm };
  const P = WebGL2RenderingContext.prototype, gbsd = P.getBufferSubData, bb = P.bindBuffer, rp = P.readPixels;
  // Each map-back is booked to its OWNER by the PIXEL_PACK_BUFFER bound at the call: the exposure ring's PBOs
  // (ep.pbo) are the exposure's, any other is the sky's probe ring (sky-probe-readback). gbE / gbS = ms, nE / nS = calls.
  // skyVals = every value the sky ring read, in read order; skyIss = sky readbacks issued (readPixels into a non-exposure PBO).
  R.gbE = 0; R.gbS = 0; R.nS = 0; R.skyIss = 0; R.skyVals = []; R.pack = null; let expSet = null;
  const isExp = (b) => { const ep = window.__exposure.pass(); if (!expSet || expSet.size !== ep.pbo.length) expSet = new Set(ep.pbo); return expSet.has(b); };
  P.bindBuffer = function (t, b) { if (t === 35051) R.pack = b; return bb.apply(this, arguments); };
  P.readPixels = function () { if (arguments.length === 7 && R.pack && !isExp(R.pack)) R.skyIss++; return rp.apply(this, arguments); };
  P.getBufferSubData = function (t, o, dst) {
    const a = performance.now(); const r = gbsd.apply(this, arguments); const d = performance.now() - a;
    R.gb += d; R.gbN++;
    if (R.pack && isExp(R.pack)) R.gbE += d; else { R.gbS += d; R.nS++; R.skyVals.push(dst[0], dst[1]); }
    return r;
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    if (cb.name !== 'rafTick') return raf(cb);
    return raf(function (t) {
      if (!R.on) return cb(t);
      const ep = window.__exposure.pass(), f0 = ep.frame, i0 = ep.issued, r0 = ep.read, s0 = Lm.floorShadow.refreshes;
      R.gb = 0; R.gbN = 0; R.gbE = 0; R.gbS = 0; R.nS = 0; const iss0 = R.skyIss;
      const a = performance.now(); if (R.pre) R.pre(); cb(t); const w = performance.now() - a;
      // [9] exposure map-back ms, [10] sky map-back ms, [11] sky map-backs, [12] sky issued BEFORE this frame, [13] stats.sunVis after it,
      // [14] sky issues this frame, [15] sky values read so far (R.skyVals.length / 2)
      R.rec.push([t, w, R.gb, R.gbN, ep.frame - f0, ep.issued - i0, ep.read - r0, Lm.floorShadow.refreshes - s0, +window.__exposure.state().exposure,
        R.gbE, R.gbS, R.nS, iss0, window.__vsky.stats.sunVis, R.skyIss - iss0, R.skyVals.length / 2]);
    });
  };
  return true;
})()`;

async function setupView(view) {
  await until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__exposure`);
  await ev(INSTALL);
  const scale = process.env.STALL_SCALE ? +process.env.STALL_SCALE : 'null';
  if (view === 'alt6' || view === 'deck') {
    await until(`!!window.__playtest`, 30000);
    await ev(`(() => { __bench.size(1512, 982); window.setState('play'); window.__helm = true; window.survival && (window.survival.hose = 5000); __power.set(60, 60); __drs.pin(${scale}); __playtest.jump('${view === 'alt6' ? '6' : '1'}'); return 1; })()`);
    await sleep(6000);
    await ev(`(() => { window.__helm = true; window.setState('play'); return 1; })()`);
  } else {
    await ev(`__bench.setup('${view}', { scale: ${scale} })`);
  }
  if (VARIANT) await ev(`(() => { ${VARIANT}; return 1; })()`);
  await sleep(1500);   // the variant settles, the pipeline refills
}

function pct(a, p) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; }
const r2 = (x) => +(+x).toFixed(2);
const split = (a) => a.length ? { n: a.length, mean: r2(a.reduce((s, v) => s + v, 0) / a.length), p50: r2(pct(a, 0.5)), p95: r2(pct(a, 0.95)), max: r2(Math.max(...a)) } : null;
function acf(x, maxLag) {
  const n = x.length, m = x.reduce((s, v) => s + v, 0) / n; let d = 0;
  for (const v of x) d += (v - m) * (v - m);
  const out = [];
  for (let L = 1; L <= maxLag; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += (x[i] - m) * (x[i + L] - m); out.push(r2(d ? s / d : 0)); }
  return out;
}
function analyse(rec, skyVals = []) {
  const iv = []; for (let i = 1; i < rec.length; i++) iv.push(rec[i][0] - rec[i - 1][0]);
  const work = rec.map(r => r[1]);
  const slot = pct(iv, 0.5);
  const miss = []; iv.forEach((v, i) => { if (v > slot * 1.5) miss.push(i + 1); });
  const gaps = {}; for (let i = 1; i < miss.length; i++) { const g = miss[i] - miss[i - 1]; gaps[g] = (gaps[g] || 0) + 1; }
  // cost by frame kind: a frame that mapped a PBO back, a frame that refreshed the seabed shadow, the rest
  const kinds = { read: [], shadow: [], both: [], plain: [] };
  rec.forEach(r => { const k = r[6] > 0 && r[7] > 0 ? 'both' : r[6] > 0 ? 'read' : r[7] > 0 ? 'shadow' : 'plain'; if (r[4] > 0) kinds[k].push(r[1]); });
  const kstat = {}; for (const k in kinds) if (kinds[k].length) kstat[k] = { n: kinds[k].length, p50: r2(pct(kinds[k], 0.5)), p95: r2(pct(kinds[k], 0.95)), max: r2(Math.max(...kinds[k])) };
  const gb = rec.filter(r => r[3] > 0).map(r => r[2]);
  // which frames missed: what they were
  const missKind = { read: 0, shadow: 0, both: 0, plain: 0, idle: 0 };
  for (const i of miss) { const r = rec[i - 1]; const k = r[4] === 0 ? 'idle' : r[6] > 0 && r[7] > 0 ? 'both' : r[6] > 0 ? 'read' : r[7] > 0 ? 'shadow' : 'plain'; missKind[k]++; }
  const exp = rec.map(r => r[8]);
  return {
    n: iv.length, slot: r2(slot), hz: r2(1000 / slot),
    interval: { p50: r2(pct(iv, 0.5)), p95: r2(pct(iv, 0.95)), p99: r2(pct(iv, 0.99)), max: r2(Math.max(...iv)), mean: r2(iv.reduce((s, v) => s + v, 0) / iv.length) },
    missed: miss.length, missedPer1000: r2(miss.length / iv.length * 1000), stallGaps: gaps, missKind,
    work: { p50: r2(pct(work, 0.5)), p95: r2(pct(work, 0.95)), p99: r2(pct(work, 0.99)), max: r2(Math.max(...work)) },
    workAcf: acf(work, 24), intervalAcf: acf(iv, 24),
    // a rAF interval booked to the frame that ran just before it (the frame whose work delayed the next)
    ivByKind: (() => { const o = {}; for (let i = 1; i < rec.length; i++) { const r = rec[i - 1]; const k = r[4] === 0 ? 'idle' : r[6] > 0 ? 'read' : r[7] > 0 ? 'shadow' : 'plain'; (o[k] = o[k] || []).push(iv[i - 1]); } for (const k in o) o[k] = { n: o[k].length, p50: r2(pct(o[k], 0.5)), p99: r2(pct(o[k], 0.99)), max: r2(Math.max(...o[k])) }; return o; })(),
    gbsd: gb.length ? { n: gb.length, p50: r2(pct(gb, 0.5)), p95: r2(pct(gb, 0.95)), max: r2(Math.max(...gb)) } : null,
    byKind: kstat,
    // the 8-frame bump: median work on the read phase (relative to the first map-back, mod 8) less the median of the other 7
    bump8: (() => { const i0 = rec.findIndex(r => r[6] > 0); if (i0 < 0) return null; const ph = [[], []]; for (let i = i0; i < rec.length; i++) ph[(i - i0) % 8 === 0 ? 0 : 1].push(rec[i][1]); return r2(pct(ph[0], 0.5) - pct(ph[1], 0.5)); })(),
    // THE SPLIT (sky-probe-readback): the exposure's map-back and the sky probe's, each over the frames that made one
    gbExp: split(rec.filter(r => r[9] > 0).map(r => r[9])),
    gbSky: split(rec.filter(r => r[11] > 0).map(r => r[10])),
    skyFrames: rec.filter(r => r[11] > 0).length, skyIssued: rec.reduce((n, r) => n + r[14], 0),
    // frame work by sky traffic, exposure-read frames left out. The sky READS the frame after it issues (the loop at the top of
    // probeIssue, before its own issue test), so read frames and issue frames are disjoint: work on a read frame against a frame
    // with no sky traffic is the read's cost (plus whatever else differs, which A/B between builds cancels).
    workSkyRead: split(rec.filter(r => r[11] > 0 && r[14] === 0 && r[6] === 0 && r[4] > 0).map(r => r[1])),
    workSkyIssue: split(rec.filter(r => r[14] > 0 && r[11] === 0 && r[6] === 0 && r[4] > 0).map(r => r[1])),
    workNoSky: split(rec.filter(r => r[14] === 0 && r[11] === 0 && r[6] === 0 && r[4] > 0).map(r => r[1])),
    // THE SKY SERIES, frame by frame (sky-probe-readback). The ring reads exactly the readbacks that are PBO_LAG issues old, so after
    // every frame the sky ran, (reads so far) - (issued before the frame) is one constant c, and stats.sunVis is that last read's
    // value clamped to [0, 1] (the first channel; a non-finite read leaves the last good one). It holds whether the read ran at
    // frame start (the branch) or inside renderSkyInner (main): same readbacks, same count, same value, on the same frame.
    skySeries: (() => {
      const f = rec.filter(r => r[4] > 0 && r[13] !== undefined); let ok = 0, bad = 0, last = 1; const cs = {};
      for (const r of f) {
        const reads = r[15], c = reads - r[12], v = reads > 0 ? skyVals[2 * (reads - 1)] : NaN;
        if (Number.isFinite(v)) last = Math.min(1, Math.max(0, v));
        if (reads === 0 || r[13] === last) ok++; else bad++;
        cs[c] = (cs[c] || 0) + 1;
      }
      return { frames: f.length, ok, bad, c: cs, sunVis: { min: r2(Math.min(...f.map(r => r[13]))), max: r2(Math.max(...f.map(r => r[13]))) } };
    })(),
    expo: { first: exp[0], last: exp[exp.length - 1], min: Math.min(...exp), max: Math.max(...exp) }
  };
}

const out = [];
await send('Page.enable');
// a visible window that is not the OS key window reports document.hasFocus() false; the game reads it
// (frameCap's idle rule). Focus emulation makes the page focused without stealing Michael's keyboard.
if (!process.env.STALL_NOFOCUS) await send('Emulation.setFocusEmulationEnabled', { enabled: true });
for (const view of VIEWS.split(',')) {
  await send('Page.navigate', { url: URL0 });
  await sleep(1500);
  await setupView(view);
  const env = await ev(`({ drs: __drs.state().scale, ceil: __drs.state().ceil, cap: __power.state().cap, focus: document.hasFocus(), hidden: document.hidden, vis: document.visibilityState, lights: (() => { let n = 0; window.scene && window.scene.traverse(o => { if (o.isLight) n++; }); return n; })(), where: __bench.where ? __bench.where() : null })`);
  const secs = +SECS;
  let traceFile = null;
  const early0 = await ev(`window.__exposure.early ? { ...window.__exposure.early } : null`);
  const skyEarly0 = await ev(`window.__vsky.early ? { ...window.__vsky.early } : null`);
  await ev(`(() => { __stall.rec.length = 0; __stall.skyVals.length = 0; __stall.skyIss = 0; __stall.on = true; return 1; })()`);
  if (process.env.STALL_TRACE) {
    await sleep(Math.max(0, secs - 4) * 1000);
    traceFile = `${process.env.STALL_TRACE}.${view}.json`;
    const chunks = []; events.length = 0;
    await send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,v8.gc,gpu,viz,toplevel,disabled-by-default-gpu.service', transferMode: 'ReportEvents' });
    await sleep(4000);
    await send('Tracing.end');
    for (let i = 0; i < 100; i++) { if (events.some(e => e.method === 'Tracing.tracingComplete')) break; await sleep(200); }
    for (const e of events) if (e.method === 'Tracing.dataCollected') chunks.push(...e.params.value);
    writeFileSync(traceFile, JSON.stringify({ traceEvents: chunks }));
  } else await sleep(secs * 1000);
  const rec = await ev(`(() => { __stall.on = false; return __stall.rec.slice(); })()`);
  const skyVals = await ev(`__stall.skyVals.slice()`);
  const post = await ev(`({ early: window.__exposure.early ? { ...window.__exposure.early } : null, skyEarly: window.__vsky.early ? { ...window.__vsky.early } : null, lag: __gpu.lag ? __gpu.lag() : null, lagMax: __gpu.lagMax ? __gpu.lagMax() : null })`);
  const a = analyse(rec, skyVals);
  const row = { label: LABEL, view, variant: VARIANT, secs, env, ...a, post, early0, skyEarly0, traceFile, t: new Date().toISOString() };
  out.push(row);
  console.log(JSON.stringify(row));
  if (process.env.STALL_OUT) { appendFileSync(process.env.STALL_OUT, JSON.stringify(row) + '\n'); appendFileSync(process.env.STALL_OUT.replace(/\.jsonl$/, '') + '.raw.jsonl', JSON.stringify({ label: LABEL, view, variant: VARIANT, rec, skyVals }) + '\n'); }
}
await send('Page.navigate', { url: ownTab ? 'about:blank' : tgt.url });   // a tab that was not a bench page goes back where it was
ws.close();
