// THE PERF HARNESS (roadmap/perf-budget-oct.md). DEV ONLY: game.js imports this under
// ?lab or ?bench and hands it hooks; a normal load never fetches it.
//
// Why it exists: every frame number taken in the agent browser pane before October 2026
// was noisy by +-3-6 ms. The pane is usually HIDDEN, so rAF does not run; the 60 Hz
// `__power.drive` timer paced frames at ~4-16 fps with the GPU idling (and clocking down)
// between them, and a whole-frame timer query on this TBDR GPU (Apple, ANGLE/Metal) is
// only as good as the work around it. This harness owns the frame instead:
//
//   * FIXED STEP, BACK TO BACK. The game loop is held (`hold`), and the bench steps the
//     REAL update() + sky + refraction + composer itself, dt = 1/60, one frame per
//     macrotask (a MessageChannel hop, never throttled when hidden). The GPU never idles
//     long enough to change clocks.
//   * SYNC per frame (mode 'sync', the default): a 1-pixel readPixels of the canvas after
//     the frame forces CPU and GPU to finish it, so WALL = CPU + GPU serialised; the
//     EXT_disjoint_timer_query_webgl2 query around the whole frame (update included: the
//     FFT sea submits during update) gives the GPU share. Mode 'pipe' skips the sync and
//     reports throughput (wall per frame over the run) -- closer to the shipping loop.
//   * SPLIT (opts.split): an extra sync after every stage (sky, refraction, each composer
//     pass) so each stage's wall time is its own; the bench measures the sync's own cost
//     and subtracts it. Per-stage numbers carry ~0.05-0.1 ms of residue; use them to RANK,
//     use paired A/B for exact deltas.
//   * renderer.info accumulated per stage across the composer (autoReset off while it runs).
//   * PAIRED A/B (`ab`): alternating A/B blocks, a few settle frames dropped after each
//     switch, median of per-pair differences -> the delta and its spread. This is the
//     number to trust for "what does X cost".
//   * `hide(re)` takes whole systems out of the camera by owner module (core.js tags every
//     top-level scene.add with the calling file; layers, so module code that writes
//     .visible every frame cannot undo it); `draws()` attributes calls/triangles to owners.
//   * CPU sections: game.js books update() wall time per system while the bench records.
//
// Usage (console): __bench.size(1512, 982); __drs.pin(1); await __bench.run({ frames: 90 })
// await __bench.ab({ name: 'plants', a: () => __bench.hide(/plantKit/, false), b: () => __bench.hide(/plantKit/, true) })
// await __bench.noise() -- the A/A floor of the method on this machine right now.
import * as THREE from 'three';
import { renderer, scene, camera, clock, applySize, getRenderScale } from '../core.js';
import { composer } from '../postfx.js';

let H = null;
const gl = renderer.getContext();
const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const px = new Uint8Array(4);
const syncRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
const hop = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
function syncCanvas() {
  const prev = renderer.getRenderTarget();
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  renderer.setRenderTarget(prev);
}
// A sync that does not care what is bound: clear a 1x1 RGBA8 target and read it back.
// Metal command buffers on one queue complete in order, so waiting for this one waits
// for everything submitted before it.
function syncAll() {
  const prev = renderer.getRenderTarget(), ac = renderer.autoClear;
  renderer.setRenderTarget(syncRT); renderer.clear(true, false, false);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  renderer.setRenderTarget(prev); renderer.autoClear = ac;
}

const stats = (a) => {
  if (!a.length) return null;
  const s = Float64Array.from(a).sort(), q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { med: +q(0.5).toFixed(3), p10: +q(0.1).toFixed(3), p90: +q(0.9).toFixed(3), n: s.length };
};

// ---- stage instrumentation ------------------------------------------------------------
let rec = null;            // the per-frame stage record while running
let split = false, syncCost = 0;
let curStage = '';
// Optional second timer query: opts.qSplit names a stage; the frame query ends where that
// stage begins and a tail query covers the rest (e.g. '7:TemporalAAPass', whose output draw
// is the one that touches the canvas drawable).
let qSplit = '', openQ = null, tailQs = null;
function stageBegin(name) {
  if (openQ && name === qSplit && tailQs) {
    gl.endQuery(ext.TIME_ELAPSED_EXT); openQ.list.push(openQ.q);
    const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); openQ = { q, list: tailQs };
  }
  if (!rec) return;
  curStage = name;
  rec._t = performance.now(); rec._c = renderer.info.render.calls; rec._tr = renderer.info.render.triangles;
}
function stageEnd(name) {
  if (!rec) return;
  if (split) syncAll();
  const s = rec.stages[name] || (rec.stages[name] = { ms: [], calls: 0, tris: 0, frames: 0 });
  s.cur = (s.cur || 0) + performance.now() - rec._t - (split ? syncCost : 0);
  s.callsCur = (s.callsCur || 0) + renderer.info.render.calls - rec._c;
  s.trisCur = (s.trisCur || 0) + renderer.info.render.triangles - rec._tr;
  curStage = '';
}
function stageFlush() {
  for (const k in rec.stages) {
    const s = rec.stages[k];
    if (s.cur == null) continue;
    s.ms.push(s.cur); s.calls += s.callsCur; s.tris += s.trisCur; s.frames++;
    s.cur = null; s.callsCur = 0; s.trisCur = 0;
  }
}
const passName = (p, i) => `${i}:${p.name || p.constructor.name}`;
let wrapped = null;
function wrapPasses() {
  wrapped = [];
  composer.passes.forEach((p, i) => {
    const orig = p.render, nm = passName(p, i);
    p.render = function (...a) { stageBegin(nm); try { return orig.apply(this, a); } finally { stageEnd(nm); } };
    wrapped.push([p, orig]);
  });
}
function unwrapPasses() { if (wrapped) for (const [p, orig] of wrapped) p.render = orig; wrapped = null; }

// ---- the stepped frame ------------------------------------------------------------------
const DT = 1 / 60;
function stepFrame(o, gpuQs) {
  const t0 = performance.now();
  if (ext) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); openQ = { q, list: gpuQs }; }
  renderer.info.reset();
  clock.elapsedTime += DT;
  stageBegin('update');
  H.update(DT, clock.elapsedTime);
  stageEnd('update');
  const t1 = performance.now();
  stageBegin('sky'); H.sky(); stageEnd('sky');
  stageBegin('refraction'); H.refraction(); stageEnd('refraction');
  H.post(DT);
  if (openQ) { gl.endQuery(ext.TIME_ELAPSED_EXT); openQ.list.push(openQ.q); openQ = null; }
  const t2 = performance.now();
  if (o.mode !== 'pipe') { if (o.endSync === 'rt') syncAll(); else syncCanvas(); }
  const t3 = performance.now();
  return { upd: t1 - t0, sub: t2 - t1, wall: t3 - t0, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
}
function pollQueries(qs, out, final) {
  while (qs.length) {
    const q = qs[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { if (!final) break; else { qs.shift(); gl.deleteQuery(q); continue; } }
    const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
    qs.shift(); gl.deleteQuery(q);
    if (!dis) out.push(ns / 1e6);
  }
}

// CPU CALIBRATION. A hidden tab's renderer process is given background QoS by macOS and
// can land on the efficiency cores: every JS cost (update, three's submission) then runs
// ~2-3x slower for minutes at a time, with no other sign. A fixed scalar kernel timed at
// the start and end of every run is the tell: `cal` in ms (~2-3 on a performance core
// here). Compare runs only at the same cal; `calBest` is the fastest seen this session.
const calBuf = new Float64Array(4096);
let calBest = Infinity;
function calibrate() {
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    let acc = 0;
    for (let k = 0; k < 800; k++) for (let i = 0; i < 4096; i++) { const x = calBuf[i] + i * 0.37 + k; acc += Math.sqrt(x * x + 1.3) * 0.5; calBuf[i] = acc * 1e-9; }
    best = Math.min(best, performance.now() - t);
  }
  calBest = Math.min(calBest, best);
  return best;
}
// GPU CALIBRATION: a fixed fragment workload (1024^2, 480 hash iterations a pixel, x4 draws) timed by
// a sync. When another process holds the GPU (the iOS Simulator, a visible Chrome tab, the
// WindowServer compositing a video) this rises and every frame number with it.
const gcRT = new THREE.WebGLRenderTarget(1024, 1024, { depthBuffer: false, type: THREE.HalfFloatType });
const gcScene = new THREE.Scene(), gcCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
gcScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform float k; void main(){ vec2 p = gl_FragCoord.xy * 0.001; float a = k; for (int i = 0; i < 480; i++) { a = fract(sin(dot(p + a, vec2(12.9898, 78.233))) * 43758.5453); } gl_FragColor = vec4(a); }',
  uniforms: { k: { value: 0 } }, depthTest: false, depthWrite: false
})));
gcScene.children[0].frustumCulled = false;
let gcalBest = Infinity;
function gpuCalibrate() {
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(gcRT); renderer.render(gcScene, gcCam); syncAll();   // compile + warm
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    for (let j = 0; j < 4; j++) { gcScene.children[0].material.uniforms.k.value = r + j * 0.1; renderer.setRenderTarget(gcRT); renderer.render(gcScene, gcCam); }
    syncAll();
    best = Math.min(best, performance.now() - t);
  }
  renderer.setRenderTarget(prev);
  gcalBest = Math.min(gcalBest, best);
  return best;
}
let busy = false, holdN = 0;
const holdOn = () => { if (holdN++ === 0) H.hold(true); };
const holdOff = () => { if (--holdN === 0) H.hold(false); };
async function run(opts = {}) {
  if (!H) throw new Error('bench: not installed');
  if (busy) throw new Error('bench: already running');
  busy = true;
  const o = Object.assign({ frames: 90, warm: 20, mode: 'sync', split: false, prof: true }, opts);
  const info = renderer.info, ar = info.autoReset;
  holdOn();
  info.autoReset = false;
  const gpuQs = [], gpu = [], upd = [], sub = [], wall = [], calls = [], tris = [];
  const tq = [], gpuTail = [];
  qSplit = o.qSplit || ''; tailQs = qSplit ? tq : null;
  const prof = {};
  const cal0 = calibrate(), gcal0 = o.gcal === false ? 0 : gpuCalibrate();
  try {
    // the sync's own price, so split stages can subtract it
    if (o.split) { const t = performance.now(); for (let i = 0; i < 20; i++) syncAll(); syncCost = (performance.now() - t) / 20; }
    for (let i = 0; i < o.warm; i++) { stepFrame(o, gpuQs); await hop(); pollQueries(gpuQs, [], false); }
    pollQueries(gpuQs, [], true); pollQueries(tq, [], true);
    split = !!o.split;
    rec = { stages: {} };
    wrapPasses();
    if (o.prof) H.profOn(prof);
    const tRun = performance.now();
    for (let i = 0; i < o.frames; i++) {
      const f = stepFrame(o, gpuQs);
      stageFlush();
      upd.push(f.upd); sub.push(f.sub); wall.push(f.wall); calls.push(f.calls); tris.push(f.tris);
      await hop();
      pollQueries(gpuQs, gpu, false); pollQueries(tq, gpuTail, false);
    }
    H.profOn(null);
    if (o.mode === 'pipe') syncCanvas();   // drain the queue: throughput counts every frame's GPU work
    const thru = (performance.now() - tRun) / o.frames;
    for (let k = 0; k < 6 && gpuQs.length; k++) { await hop(); pollQueries(gpuQs, gpu, false); }
    pollQueries(gpuQs, gpu, true); pollQueries(tq, gpuTail, true);
    const st = {};
    for (const k in rec.stages) {
      const s = rec.stages[k];
      st[k] = { ms: stats(s.ms).med, calls: Math.round(s.calls / Math.max(1, s.frames)), tris: Math.round(s.tris / Math.max(1, s.frames)) };
    }
    const cpu = {};
    for (const k in prof) cpu[k] = +(prof[k] / o.frames).toFixed(3);
    const cal = Math.max(cal0, calibrate()), gcal = o.gcal === false ? 0 : Math.max(gcal0, gpuCalibrate());
    return {
      cal: +cal.toFixed(2), calBest: +calBest.toFixed(2), slowCpu: cal > calBest * 1.35,
      gcal: +gcal.toFixed(2), gcalBest: +gcalBest.toFixed(2), busyGpu: gcal > gcalBest * 1.35,
      mode: o.mode, split: !!o.split, frames: o.frames,
      size: [renderer.domElement.width, renderer.domElement.height], internal: renderer.getSize(new THREE.Vector2()).toArray(), scale: getRenderScale(),
      wall: stats(wall), gpu: stats(gpu), gpuTail: stats(gpuTail), cpuUpdate: stats(upd), cpuSubmit: stats(sub), throughput: +thru.toFixed(3),
      calls: stats(calls).med, tris: stats(tris).med, syncCost: +syncCost.toFixed(3),
      stages: st, cpuSections: cpu
    };
  } finally {
    rec = null; split = false; qSplit = ''; tailQs = null; unwrapPasses(); H.profOn(null);
    info.autoReset = ar; info.reset();
    holdOff();
    busy = false;
  }
}

// Paired A/B: `a()` and `b()` put the world in each state. Blocks alternate A,B,A,B; the
// first `drop` frames after each switch are discarded (program swaps, history settle).
// The answer is the median of per-pair (B - A) block medians, for wall and GPU.
async function ab(o = {}) {
  const P = Object.assign({ pairs: 10, per: 8, drop: 4, mode: 'sync' }, o);
  const A = { wall: [], gpu: [] }, B = { wall: [], gpu: [] }, dW = [], dG = [], cals = [];
  holdOn();
  try {
    for (let i = 0; i < P.pairs; i++) {
      const order = i & 1 ? ['b', 'a'] : ['a', 'b'];    // ABBA: cancels slow drift
      const got = {};
      for (const k of order) {
        P[k]();
        const r = await run({ frames: P.per, warm: P.drop, mode: P.mode, prof: false });
        got[k] = r; cals.push(r.cal);
      }
      A.wall.push(got.a.wall.med); B.wall.push(got.b.wall.med);
      if (got.a.gpu && got.b.gpu) { A.gpu.push(got.a.gpu.med); B.gpu.push(got.b.gpu.med); dG.push(got.b.gpu.med - got.a.gpu.med); }
      dW.push(got.b.wall.med - got.a.wall.med);
    }
  } finally { if (P.restore) P.restore(); else P.a(); holdOff(); }
  return { name: P.name || '', a: { wall: stats(A.wall), gpu: stats(A.gpu) }, b: { wall: stats(B.wall), gpu: stats(B.gpu) },
    dWall: stats(dW), dGpu: stats(dG), cal: stats(cals), calBest: +calBest.toFixed(2) };
}
// The A/A floor: the same state on both sides. |median| and the p10..p90 of the pair
// differences are what any A/B on this machine can and cannot resolve.
const noise = (o = {}) => ab(Object.assign({ name: 'A/A', a: () => {}, b: () => {} }, o));

// ---- ownership: hide / draws --------------------------------------------------------------
const ownerOf = (o) => { let r = o; while (r.parent && r.parent !== scene) r = r.parent; return r.parent === scene ? r : null; };
const tagOf = (top) => `${top.userData.benchSrc || '?'}${top.name ? ':' + top.name : ''}`;
const savedMask = new Map();
function hide(re, on = true) {
  let n = 0;
  for (const top of scene.children) {
    if (!re.test(tagOf(top))) continue;
    n++;
    top.traverse(o => {
      if (on) { if (!savedMask.has(o)) savedMask.set(o, o.layers.mask); o.layers.mask = 1 << 30; }
      else if (savedMask.has(o)) { o.layers.mask = savedMask.get(o); savedMask.delete(o); }
    });
  }
  return n;
}
function owners() {
  const m = {};
  for (const top of scene.children) { const k = tagOf(top); m[k] = (m[k] || 0) + 1; }
  return m;
}
// One recorded frame with every scene object instrumented: calls and triangles per owner,
// per stage (the main RenderPass, refraction, shadow, ...), and the top objects by tris.
async function draws(o = {}) {
  const per = {}, objs = new Map(), saved = [];
  let c0 = 0, t0 = 0;
  const book = (ob, tag, where) => {
    if (!rec) return;   // warm-up frames do not count
    const k = tag + ' @' + where;
    const e = per[k] || (per[k] = { calls: 0, tris: 0, objs: 0 });
    const dc = renderer.info.render.calls - c0, dt = renderer.info.render.triangles - t0;
    e.calls += dc; e.tris += dt; e.objs++;
    const key = where.endsWith('shadow') ? ob.id + 's' : ob.id;
    const on = objs.get(key) || { tag, where: where.endsWith('shadow') ? 'shadow' : 'color', name: ob.name || ob.type, type: ob.isBatchedMesh ? 'Batched' : ob.isInstancedMesh ? 'Instanced:' + ob.count : ob.type, tris: 0, calls: 0 };
    on.tris += dt; on.calls += dc; objs.set(key, on);
  };
  scene.traverse(ob => {
    if (!(ob.isMesh || ob.isPoints || ob.isLine || ob.isSprite)) return;
    const top = ownerOf(ob); const tag = top ? tagOf(top) : '(detached)';
    const b = ob.onBeforeRender, a = ob.onAfterRender, bs = ob.onBeforeShadow, as = ob.onAfterShadow;
    saved.push([ob, b, a, bs, as]);
    const mark = () => { c0 = renderer.info.render.calls; t0 = renderer.info.render.triangles; };
    ob.onBeforeRender = function (...x) { b.apply(this, x); mark(); };
    ob.onAfterRender = function (...x) { a.apply(this, x); book(ob, tag, curStage || 'other'); };
    ob.onBeforeShadow = function (...x) { bs.apply(this, x); mark(); };
    ob.onAfterShadow = function (...x) { as.apply(this, x); book(ob, tag, (curStage || 'other') + ' shadow'); };
  });
  const n = o.frames || 1;
  try { await run({ frames: n, warm: o.warm || 2, prof: false }); }
  finally { for (const [ob, b, a, bs, as] of saved) { ob.onBeforeRender = b; ob.onAfterRender = a; ob.onBeforeShadow = bs; ob.onAfterShadow = as; } }
  const rows = Object.entries(per).map(([k, v]) => ({ k, calls: +(v.calls / n).toFixed(1), tris: Math.round(v.tris / n), objs: +(v.objs / n).toFixed(1) })).sort((x, y) => y.tris - x.tris);
  const top = [...objs.values()].map(v => ({ ...v, tris: Math.round(v.tris / n), calls: +(v.calls / n).toFixed(1) })).sort((x, y) => y.tris - x.tris).slice(0, o.top || 25);
  return { byOwner: rows, topObjects: top };
}

// Fix the canvas's CSS box so the bench measures the same pixel count whatever the pane
// is doing (a hidden pane reports 0x0; the emulated viewport is cleared between turns).
function size(w, h) {
  const c = renderer.domElement;
  if (w) { c.style.width = w + 'px'; c.style.height = h + 'px'; } else { c.style.width = ''; c.style.height = ''; }
  applySize();
  return [c.clientWidth, c.clientHeight];
}

// THE STANDARD VIEWS (perf-budget-oct). Each is a reproducible spot: Sal stood on the
// seabed facing `yaw`, the follow camera settled behind him for `settle` ms of driven play.
// z0: under the raft (the dive's arrival, the kelp/reef garden); z0b: the Brooder's ridge;
// z1: under rift 0 (the zone-1 arrival); z1b: Orune on the trawler; z2: under rift 1 (the
// zone-2 arrival, reef + colony lights). Positions are the authored site-0 layout.
const VIEWS = {
  z0: { zone: 0, x: 4, z: 4, yaw: 0.5 },
  z1: { zone: 1, x: 81.5, z: 83.9, yaw: 0.5 },
  z2: { zone: 2, x: -116.8, z: -6.8, yaw: 0.5 }
};
async function setup(view = 'z0', o = {}) {
  const v = typeof view === 'string' ? VIEWS[view] : view;
  try { localStorage.clear(); } catch (e) { /* private mode */ }
  size(o.w || 1512, o.h || 982);
  if (window.gameState !== 'play') window.setState('play');
  window.__helm = true; window.survival.hose = 5000;
  window.__power.set(60, 60);
  if (o.scale != null) window.__drs.pin(o.scale); else window.__drs.pin(1);
  const r = H.place(v.x, v.z, v.yaw, v.zone);
  window.__power.drive(true);
  await new Promise(res => setTimeout(res, o.settle || 5000));
  window.__power.drive(false);
  H.place(v.x, v.z, v.yaw, v.zone);   // stand him back on his mark (he may have slid)
  for (let i = 0; i < 30; i++) { H.update(1 / 60, clock.elapsedTime += 1 / 60); }   // camera settles, no render
  return Object.assign(r, H.where());
}

export function installBench(hooks) {
  H = hooks;
  window.__bench = { VIEWS, setup, calibrate, gpuCalibrate, run, ab, noise, hide, owners, draws, size, place: H.place, where: H.where, get timer() { return !!ext; } };
}
