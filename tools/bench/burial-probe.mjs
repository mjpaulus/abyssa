// THE BURIAL PROBE (velkath-buried-rock; spec docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md §1-§4).
//   DRV_PORT=9540 node tools/bench/burial-probe.mjs <disguise|breath|programs|rise|digin|reentry> <port>
// Stepped on the PLUGGED clock (clockplug.mjs). Exit 0 pass | 1 a bar failed | 2 UNMEASURED | 3 a BP_RED whose bar did NOT fail
// | 4 LOST (clock drift) | 5 a BP_RED whose bar failed, as it must. JSON of every series judged -> BP_OUT (default
// ~/sc/.abyssa-wt/reviews/buried/burial-<mode>-<tag>.json).
//   disguise  home, zone 0, Velkath dormant at her bed. THE DRAWN SAND at (x, z) = max(terrainH, the dune's drawn surface
//             (__burial.sandAt; absent on main)). Every vertex of her legs, claws, eyes / stalks, mouthparts and every ward
//             centre: its height over the drawn sand (max, per part; bar <= 0). HER SIDES: her shell's vertices outside the
//             crest strip (__burial.inStrip; on main the strip's default ellipse, BURY_DEFAULT below) over the drawn sand
//             (bar <= +0.02). THE CREST: her shell's vertices over the drawn sand: top over the mean ground (poseAll's 5 x 5
//             grid; bar 3.0-4.0 u), length along her keel (bar 16-24 u). THE CLUTCH (Task 6 on): every live lobe's top (r x
//             1.25) <= -0.05 u under the sand. THE HARPOON (Task 4 on): the seam >= +0.25 u, every pole sample >= 0 u over the
//             DRAWN SAND (terrain or dune, never the crest: harpoon.js seat()'s own test). THE GROWTH ON HER BACK (Task 3a on):
//             every DRAWN reef and weed vertex OUTSIDE the strip <= 0 over the sand (inside it, growth on a rock is allowed);
//             buried, burial.js hides the growth outside the strip, so none drawn there passes; n = every growth vertex examined
//             (the vacuity floor), nOut = those drawn outside the strip.
//             THE REPOSE (Task 3a; narrowed in fix round 2 and pre-registered on 9829f9a BEFORE the fit's repose pass was written):
//             the drawn dune is never steeper than drifted sand lies, the strip's band aside. Every triangle of the mound's quad rows
//             1 .. NI-1 (ring 1, the dune's first, out to the first buried ring; row 0 is the strip's band, where the sand meets the
//             rock, and is the ONLY area skipped) is judged by its plane's steepest slope in ANY direction, in degrees, read off
//             MD.M (the fit, without the breath). A plan-degenerate triangle with more than 5 mm of height to it is a wall: 90 deg.
//             Bar: a FIXED 33.81 deg (the repose's 28.81, BURY.repose 0.55, + 5; fixed so a knob cannot move it); >= 200 triangles
//             judged, else UNMEASURED. Booked: the counts over 33.81 / 45 / 60 deg, the worst face, the tallest face over the bar,
//             and every triangle [row, bearing, half, deg, height span, clamped corners] in the JSON. Judged only where she has a mound.
//             BP_CHECK=<comma list> limits the verdict to those checks (the tasks before the mound check height / limbs only).
//   breath    THE TELL (Task 3a; spec §1 "Every 8-10 s the sand over her lifts a few centimetres and settles", "visible only
//             within about 8 u"). Home, her asleep: he is stood 6 u off the strip's edge on her SAND side, facing it (__bench.place,
//             then player.pos.y = shutFloorY + 1.35), 40 s stepped, then 12 u off for 30 s more. Booked per frame: the dune's ring-1
//             vertex y at the bearing nearest him (lev.mound.P; with no mound, the drawn sand where ring 1 would lie, 0.6 u outside
//             the default strip's edge: the floor, which never moves), L.trickleN, L.brAge, L.breathY, his and the lens's
//             distances. Bars: amplitude (max - min of that y while dormant, the 6 u leg) 0.03-0.06 u; every interval between
//             breath peaks (a peak = the top of an excursion over half the amplitude, not cut by the leg's ends) 8-10 s, >= 3
//             peaks booked or UNMEASURED; trickles >= 1 per breath at 6 u (a breath = its rise completed, brAge crossing
//             BURY.breath.up, inside the leg; none booked = UNMEASURED); trickles 0 at 12 u (>= 1 breath booked there).
//             VERDICT ORDER (breath): a bar that FAILED on a real measurement is FAIL (exit 1) even if another is UNMEASURED; with
//             no failure, any UNMEASURED bar is exit 2; nothing vacuous ever passes. A RED judges only its own bars.
// BP_RED variants (each must fail ITS bar): ridge (__burial.set({on:0}): the shipped ridge at home) -> sides, crest;
// shallow (crest 5.5) -> crest height; steep (repose 2.0: the dune fitted to fall at 63 deg; the bar is fixed, so it must fail) ->
// repose; still (breath: __burial.set({breath:{lift:0}})) -> amplitude. A page-side throw is
// UNMEASURED (exit 2), never a fail (1) or a RED's pass (5).
// __burial.set rebuilds her through __lev.remember(null), outside game.js keepingPrograms: her programs are released and
// rebuilt, so a `programs` reading taken after a set is not a play reading (that mode never sets knobs).
//
// MODES: `disguise` is built (Task 1), `breath` (Task 3a). `programs` (5, 7b, 10, 12, 13), `rise` (7a, 8), `digin` (12) and
// `reentry` (Tasks 2-12 fill them in, one by one) exit 2 "not built yet" until their task adds them to MODES below.
// ENV (besides DRV_PORT, a port of this probe's own: never 8777 / 8790 / 9419; the probe exits 2 before importing drv.mjs):
//   BP_KNOBS=<json>   patched through `__burial.set` before the mode (absent on main: exit 2, a patch has nothing to act on)
//   BP_RED=<variant>  an opt-in RED, never part of the default run: it must fail ITS bar (exit 5; 3 = it did not). disguise:
//                     ridge | shallow | steep; breath: still. Applied through `__burial.set` too, so it needs a build that has `__burial`, except
//                     `ridge` on main: main already is the shipped ridge, the unpatched reading is that RED (exit 5 there).
//   BP_AT=<where>     where he stands for the modes that place him: anchor (Alt+6's harpoon anchor) | crest (on her) | off
//                     (clear of her ground). `disguise` is geometry only and does not place him (the value is still checked).
//   BP_NOPLUG=1       the drift RED: plug(c, { stop: false }), the counter on and clock.stop() skipped. It must print CLOCK LOST
//                     with a NUMERIC drift over 0.05 s (exit 4). A missing reading is exit 2 and is not the RED.
//   BP_CHECK=<list>   disguise: legs,claws,eyes,mouth,wards,reef,weed,sides,top,len,repose (crest = top + len; height = top, the crest's
//                     height alone, as the plan's briefs name it),clutch,harpoon
//   BP_OUT=<file>     the JSON (default ~/sc/.abyssa-wt/reviews/buried/burial-<mode>-<tag>.json); BP_TAG=<tag> (default port<port>)
// (an empty DRV_PORT is +'' = 0, an integer: the port must be all digits and inside 1024-65535, as drv.mjs's start() demands)
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 9419].includes(P)) { console.error(`burial-probe: set DRV_PORT to a port of its own, an integer in 1024-65535 (not 8777 / 8790 / 9419; got ${JSON.stringify(process.env.DRV_PORT)})`); process.exit(2); }
const MODES = ['disguise', 'breath', 'programs', 'rise', 'digin', 'reentry'], BUILT = ['disguise', 'breath'];
const [, , MODE, PORT] = process.argv;
if (!MODES.includes(MODE) || !/^\d+$/.test(PORT || '')) { console.error('usage: DRV_PORT=<own> node tools/bench/burial-probe.mjs <' + MODES.join('|') + '> <game port>'); process.exit(2); }
if (!BUILT.includes(MODE)) { console.error(`burial-probe: mode ${MODE} is not built yet (a later task of the velkath-buried-rock plan adds it)`); process.exit(2); }
// (ridge's `crest`: RULED (controller, Task 1 ledger) as the crest GROUP, which fails if its top OR its length fails. main's ridge is
// 19.8 u long, inside 16-24, so `len` can never fail for it and the group fails on `top` alone: bars ['sides', 'top'] are the same
// verdict on the shipped ridge, nothing loosened (its top, 8.02 u, and its sides, +6.62 u, are what make it a ridge). A crest with
// n 0 (no shell vertex over the sand in the strip) is FAIL, not UNMEASURED: also ruled there)
const REDS = { disguise: { ridge: { set: { on: 0 }, bars: ['sides', 'top'], mainIsIt: true }, shallow: { set: { crest: 5.5 }, bars: ['top'] },
    steep: { set: { repose: 2.0 }, bars: ['repose'] } },
  breath: { still: { set: { breath: { lift: 0 } }, bars: ['amp'] } } };
const RED = process.env.BP_RED || '';
if (RED && !(REDS[MODE] && REDS[MODE][RED])) { console.error(`BP_RED: mode ${MODE} has ${REDS[MODE] ? 'the variants ' + Object.keys(REDS[MODE]).join(', ') : 'no RED variant'} (got ${JSON.stringify(RED)})`); process.exit(2); }
const AT = process.env.BP_AT || '';
if (AT && !['anchor', 'crest', 'off'].includes(AT)) { console.error(`BP_AT: anchor | crest | off (got ${JSON.stringify(AT)})`); process.exit(2); }
let KNOBS = null;
if (process.env.BP_KNOBS) { try { KNOBS = JSON.parse(process.env.BP_KNOBS); } catch (e) { console.error('BP_KNOBS is not JSON: ' + e.message); process.exit(2); } }
const CHECKS = ['legs', 'claws', 'eyes', 'mouth', 'wards', 'reef', 'weed', 'sides', 'top', 'len', 'repose', 'clutch', 'harpoon'];
let ONLY = null;
if (process.env.BP_CHECK) {
  ONLY = process.env.BP_CHECK.split(',').map(s => s.trim()).filter(Boolean).flatMap(s => s === 'crest' ? ['top', 'len'] : s === 'height' ? ['top'] : [s]);
  const bad = ONLY.filter(s => !CHECKS.includes(s));
  if (bad.length || !ONLY.length) { console.error(`BP_CHECK: ${CHECKS.join(',')},crest,height (got ${JSON.stringify(process.env.BP_CHECK)})`); process.exit(2); }
  if (MODE !== 'disguise') { console.error(`BP_CHECK is disguise's (mode ${MODE} judges all its bars)`); process.exit(2); }
}

const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir, homedir } = await import('node:os');
const { join, dirname } = await import('node:path');
// a fresh profile (no save, no caches), the debug port refused if it is taken, only OUR Chrome ever stopped. DRV_PORT is set above,
// before this dynamic import (a static import is hoisted above the check and drv.mjs's DBG would already have been 9419)
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-burial-probe-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, unmeasured, lost, CLOCK_LOST } = await import('./clockplug.mjs');
let chromeStarted = false;
process.on('exit', () => { if (chromeStarted) stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));

// BURY_DEFAULT (the crest strip's default ellipse) and the page side of `disguise`: see the header
const DISGUISE = `(async () => {
  const THREE = await import('three'), T = await import('/src/world/terrain.js');
  const L = window.lev; if (!L || L.kind !== 'brooder' || !L.dormant) return { err: 'no dormant brooder (' + (L && L.kind) + ')' };
  L.grp.updateMatrixWorld(true);
  const B = window.__burial || null;
  const BD = { crestL: 20, crestW: 6, crestZ: -0.07 };            // BURY_DEFAULT: main has no __burial
  const sand = (x, z) => Math.max(T.terrainH(x, z, 0), B && B.sandAt ? B.sandAt(x, z) : -1e9);   // (sandAt / inStrip from Task 3a)
  const inv = new THREE.Matrix4().copy(L.body.matrixWorld).invert(), v = new THREE.Vector3(), lv = new THREE.Vector3();
  const m = new THREE.Matrix4(), m2 = new THREE.Matrix4();
  const stripEll = (lx, lz) => { const a = BD.crestW / 2 / L.R, b = BD.crestL / 2 / L.R, q = lz - BD.crestZ; return (lx / a) ** 2 + (q / b) ** 2 < 1; };
  // (the mound's strip where she has one; with none (main, BP_RED=ridge's {on:0} rebuild) the default ellipse, as main reads it)
  const inStrip = (x, z) => B && B.inStrip && L.mound ? B.inStrip(x, z) : (lv.set(x, L.bodyY, z).applyMatrix4(inv), stripEll(lv.x, lv.z));
  const worst = {}, n = {};
  const book = (part, x, y, z) => { const d = y - sand(x, z); if (part !== 'reef' && part !== 'weed') n[part] = (n[part] || 0) + 1;
    if (!(part in worst) || d > worst[part].d) worst[part] = { d: +d.toFixed(3), at: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)] }; };
  const mesh = (part, o, stride = 1) => { o.updateMatrixWorld(true); const P = o.geometry.attributes.position;
    const each = mw => { for (let i = 0; i < P.count; i += stride) { v.fromBufferAttribute(P, i).applyMatrix4(mw); book(part, v.x, v.y, v.z); } };
    if (o.isInstancedMesh) for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); each(m2.multiplyMatrices(o.matrixWorld, m)); } else each(o.matrixWorld); };
  for (const k of ['coxa', 'femur', 'tibia', 'dactyl']) mesh('legs', L.legs[k], 3);
  for (const c of L.claws) for (const o of [c.merus, c.carpus, c.palm, c.dact]) mesh('claws', o, 3);
  mesh('eyes', L.parts.eyes); if (L.parts.stalks) mesh('eyes', L.parts.stalks);
  for (const q of L.mouth) mesh('mouth', q.hook, 3);
  for (const g of L.sigils) book('wards', g.grp.position.x, g.grp.position.y, g.grp.position.z);
  // the growth on her back, outside the strip only (a sea fan standing out of a dune is a tell; on the rock it is growth). n counts
  // EVERY vertex of the growth examined, drawn or not (the vacuity floor is the growth itself: buried, the growth outside the strip
  // is hidden and books nothing, which is the best outcome, not a missing measurement); every DRAWN vertex outside the strip is booked
  // (out[part]), the reef's by its drawn index (all three corners of every drawn triangle), a frond's unless it is scaled to 0
  const outN = {}, grow = (part, o) => { o.updateMatrixWorld(true); const P = o.geometry.attributes.position, I = o.geometry.index;
    const at = (i, mw) => { v.fromBufferAttribute(P, i).applyMatrix4(mw); if (!inStrip(v.x, v.z)) { outN[part] = (outN[part] || 0) + 1; book(part, v.x, v.y, v.z); } };
    if (o.isInstancedMesh) { for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); n[part] = (n[part] || 0) + Math.ceil(P.count / 2);
      if (m.elements[0] === 0 && m.elements[5] === 0) continue;   // (a buried frond: scale 0)
      m2.multiplyMatrices(o.matrixWorld, m); for (let i = 0; i < P.count; i += 2) at(i, m2); } }
    else if (I) { const ix = I.array, seen = new Uint8Array(P.count); for (let q = 0; q < ix.length; q++) seen[ix[q]] = 1;   // (the index DRAWN: buried, burial.js swaps in the strip's own)
      n[part] = (n[part] || 0) + P.count; for (let i = 0; i < P.count; i++) if (seen[i]) at(i, o.matrixWorld); }
    else { n[part] = (n[part] || 0) + Math.ceil(P.count / 2); for (let i = 0; i < P.count; i += 2) at(i, o.matrixWorld); } };
  if (L.parts.reef) grow('reef', L.parts.reef);
  if (L.parts.weed) grow('weed', L.parts.weed);
  // her shell: sides vs crest
  const sh = L.parts.shell, P = sh.geometry.attributes.position; sh.updateMatrixWorld(true);
  let top = -1e9, zLo = 1e9, zHi = -1e9, ne = 0, sides = { d: -1e9, at: null };
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(sh.matrixWorld); const d = v.y - sand(v.x, v.z);
    if (!inStrip(v.x, v.z)) { if (d > sides.d) sides = { d: +d.toFixed(3), at: [+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)] }; continue; }
    if (d > 0.02) { ne++; top = Math.max(top, v.y); lv.copy(v).applyMatrix4(inv); zLo = Math.min(zLo, lv.z); zHi = Math.max(zHi, lv.z); } }
  // the mean ground under her: poseAll's 5 x 5 support grid
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw); let g = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { const lx = (-0.8 + 0.4 * i) * L.R, lz = (-0.84 + 0.425 * j) * L.R;
    g += T.terrainH(L.pos.x + lx * cy + lz * sy, L.pos.z - lx * sy + lz * cy, 0); }
  g /= 25;
  // THE REPOSE (header; fix round 2 of Task 3a: the skipped area narrowed to row 0, the bar a fixed 33.81 deg). Every triangle of
  // the mound's quad rows 1 .. NI-1, read off MD.M (the fit; the breath excluded)
  let repose = null;
  if (L.mound && B && B.knobs) {
    const MD = L.mound, NB = MD.COLS, NR = MD.NR, NI = NR - 2, Mm = MD.M, NEED = MD.NEED;
    const tris = []; let wst = null, tall = null, nDeg = 0;
    const tri = (i, j, t, ia, ib, ic) => {
      const ax = Mm[ia * 3], ay = Mm[ia * 3 + 1], az = Mm[ia * 3 + 2], bx = Mm[ib * 3], by = Mm[ib * 3 + 1], bz = Mm[ib * 3 + 2], cx = Mm[ic * 3], cy = Mm[ic * 3 + 1], cz = Mm[ic * 3 + 2];
      const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az), span = Math.max(ay, by, cy) - Math.min(ay, by, cy);
      let deg;
      if (Math.abs(d) < 2e-6) { nDeg++; if (span <= 0.005) return; deg = 90; }
      else { const gx = ((by - ay) * (cz - az) - (cy - ay) * (bz - az)) / d, gz = ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / d; deg = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; }
      // (clamped corners: the corner's height is its cover requirement, over the floor: where the fit pinned it)
      let cl = 0; for (const q of [ia, ib, ic]) if (NEED[q] > -1e8 && Math.abs(Mm[q * 3 + 1] - NEED[q]) < 1e-6 && NEED[q] > T.terrainH(Mm[q * 3], Mm[q * 3 + 2], 0) + 1e-6) cl++;
      tris.push([i, j, t, +deg.toFixed(2), +span.toFixed(3), cl]);
      const at = [+((ax + bx + cx) / 3).toFixed(1), +((ay + by + cy) / 3).toFixed(1), +((az + bz + cz) / 3).toFixed(1)];
      if (!wst || deg > wst.deg) wst = { deg: +deg.toFixed(2), span: +span.toFixed(3), ring: i, bearing: j, at };
      if (deg > 33.81 && (!tall || span > tall.span)) tall = { deg: +deg.toFixed(2), span: +span.toFixed(3), ring: i, bearing: j, at }; };
    for (let i = 1; i <= NI - 1; i++) for (let j = 0; j < NB; j++) {
      const a = i * NB + j, b = i * NB + (j + 1) % NB, c2 = a + NB, d2 = b + NB;
      tri(i, j, 0, a, b, c2); tri(i, j, 1, b, d2, c2); }
    const over = x => tris.filter(q => q[3] > x).length;
    repose = { barDeg: 33.81, n: tris.length, nDeg, worst: wst, tallestSteep: tall, over33: over(33.81), over45: over(45), over60: over(60),
      over45tall: tris.filter(q => q[3] > 45 && q[4] > 0.2).length, tris };
  }
  const out = { worst, n, outN, sides, crest: { top: +(top - g).toFixed(2), len: ne ? +((zHi - zLo) * L.R).toFixed(1) : 0, n: ne }, buried: !!(B && L.buried), bury: L.bury ?? null, repose };
  // (Task 6) the clutch, (Task 4) the harpoon: added there
  return out; })()`;

// the page side of `breath`. PLACE(d): him d u off the strip's edge on her SAND side (where he comes in), facing it; the point
// booked is the ring-1 vertex nearest him (breathTick's own pick for the trickle), or with no mound the drawn sand where ring 1
// would lie (0.6 u outside BURY_DEFAULT's edge). BOOK(n, leg): n stepped frames, every one booked into window.__bpS
const BREATH_PLACE = d => `(async () => {
  const T = await import('/src/world/terrain.js');
  const L = window.lev; if (!L || L.kind !== 'brooder' || !L.dormant) return { err: 'no dormant brooder (' + (L && L.kind) + ')' };
  const MD = L.mound || null, R = L.R, cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
  const wx = (lx, lz) => L.pos.x + (lx * cy + lz * sy) * R, wz = (lx, lz) => L.pos.z + (-lx * sy + lz * cy) * R;
  let ex, ez, cx, cz, src;
  if (MD) { const j = Math.round((L.sandSide > 0 ? 0 : 0.5) * MD.COLS) % MD.COLS; ex = MD.P[j * 3]; ez = MD.P[j * 3 + 2]; cx = MD.bx; cz = MD.bz; src = 'the mound: ring 1'; }
  else { const a = 6 / 2 / R * L.sandSide, zc = -0.07; ex = wx(a, zc); ez = wz(a, zc); cx = wx(0, zc); cz = wz(0, zc); src = 'no mound: the drawn sand 0.6 u outside the default strip'; }
  let ux = ex - cx, uz = ez - cz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const x = ex + ux * ${d}, z = ez + uz * ${d};
  window.__bench.place(x, z, Math.atan2(ex - x, ez - z), 0);
  window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0);
  let bj = -1, px = ex + ux * 0.6, pz = ez + uz * 0.6;
  if (MD) { let best = 1e9; for (let j = 0; j < MD.COLS; j++) { const o = (MD.COLS + j) * 3, dd = Math.hypot(MD.P[o] - x, MD.P[o + 2] - z); if (dd < best) { best = dd; bj = j; } }
    px = MD.P[(MD.COLS + bj) * 3]; pz = MD.P[(MD.COLS + bj) * 3 + 2]; }
  window.__bpPt = { bj, px, pz };
  return { d: ${d}, src, edge: [+ex.toFixed(2), +ez.toFixed(2)], him: [+x.toFixed(2), +z.toFixed(2)], bj, pt: [+px.toFixed(2), +pz.toFixed(2)],
    dPt: +Math.hypot(px - x, pz - z).toFixed(2), tr0: L.trickleN || 0, age0: L.brAge ?? null };
})()`;
// per frame: [leg, y, trickleN, brAge, breathY, dormant, him to the nearest ring-1 vertex (or the point), the lens to her centre]
const BREATH_BOOK = (n, leg) => `(async () => {
  const T = await import('/src/world/terrain.js'), { camera } = await import('/src/core.js');
  const L = window.lev, MD = L.mound || null, Q = window.__bpPt, B = window.__burial, p = window.player.pos;
  const S = window.__bpS || (window.__bpS = []);
  window.__bench.step(${n}, () => {
    const y = MD ? MD.P[(MD.COLS + Q.bj) * 3 + 1] : Math.max(T.terrainH(Q.px, Q.pz, 0), B && B.sandAt ? B.sandAt(Q.px, Q.pz) : -1e9);
    let dh = Math.hypot(Q.px - p.x, Q.pz - p.z);
    if (MD) for (let j = 0; j < MD.COLS; j++) { const o = (MD.COLS + j) * 3, dd = Math.hypot(MD.P[o] - p.x, MD.P[o + 2] - p.z); if (dd < dh) dh = dd; }
    S.push([${leg}, +y.toFixed(5), L.trickleN || 0, L.brAge == null ? null : +L.brAge.toFixed(4), +(L.breathY || 0).toFixed(5), L.dormant ? 1 : 0,
      +dh.toFixed(2), +Math.hypot(camera.position.x - L.pos.x, camera.position.z - L.pos.z).toFixed(2)]);
  });
  return S.length; })()`;

// ---- boot: about:blank, the domains on, the focus a player's window has, then the game ----
try { const r = await fetch(`http://127.0.0.1:${P}/json/version`, { signal: AbortSignal.timeout(2000) });
  console.error(`the debug port ${P} already answers /json/version (HTTP ${r.status}): not starting, nothing touched`); process.exit(2); }
catch (e) { if (!(e && e.cause && e.cause.code === 'ECONNREFUSED')) { console.error(`the debug port ${P} is not free (${e && e.name}: ${e && e.cause && e.cause.code || e && e.message}): not starting, nothing touched`); process.exit(2); } }
const TAG = process.env.BP_TAG || 'port' + PORT;
const OUT = process.env.BP_OUT || join(homedir(), 'sc/.abyssa-wt/reviews/buried', `burial-${MODE}-${TAG}.json`);
const record = { mode: MODE, port: +PORT, tag: TAG, red: RED || null, noplug: process.env.BP_NOPLUG === '1', knobs: KNOBS, at: AT || null, only: ONLY };
const finish = (code, why) => {
  record.exit = code; if (why) record.why = why;
  try { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(record, null, 1)); console.log('JSON ' + OUT); } catch (e) { console.error('could not write ' + OUT + ': ' + e.message); }
  process.exit(code);
};
// a boot that never got to the game (Chrome would not start, no CDP connection, the page never loaded: a game port nobody
// serves waits out the 300 s) is UNMEASURED with its JSON, never exit 1, which would read as a failed bar
const URL0 = `http://localhost:${PORT}/?bench&playtest`;
let c = null;
try {
  chromeStarted = true;
  await start('about:blank');
  c = await connect();
  await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const tNav = Date.now();
  await c.send('Page.navigate', { url: URL0 });
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
  console.log(`burial-probe ${MODE}${RED ? ' RED ' + RED : ''}${record.noplug ? ' NOPLUG' : ''} ${URL0} (fresh profile): loaded in ${((Date.now() - tNav) / 1000).toFixed(1)} s`);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await sleep(1000);
} catch (e) {
  const why = String(e && e.message || e);
  console.error('UNMEASURED: boot: ' + why);
  try { if (c) c.close(); } catch (e2) { }
  finish(2, 'boot: ' + why);
}

// ---- the clock is plugged once the page is up; then home, zone 0, her asleep ----
let out = null, fatal = null;
try {
  await plug(c, { stop: !record.noplug });
  await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.__bench.step(30), 1)`);
  const hasBurial = await c.ev(`!!(window.__burial && window.__burial.set)`);
  record.build = hasBurial ? 'burial' : 'main';
  console.log(`build: ${record.build}`);
  // the patches: __burial.set is absent on main, where there is nothing to patch (the unpatched reading IS the main RED)
  // (`ridge` is the shipped ridge, so on main its patch is the build itself and is skipped; every other patch needs __burial.set)
  const redSet = RED && !(!hasBurial && REDS[MODE][RED].mainIsIt) ? REDS[MODE][RED].set : {};
  const patch = Object.assign({}, KNOBS || {}, redSet);
  if (!hasBurial && RED && REDS[MODE][RED].mainIsIt) console.log(`BP_RED ${RED}: no __burial on this build, which already IS the shipped ridge: the unpatched reading is the RED`);
  if (Object.keys(patch).length) {
    if (!hasBurial) throw new Error(`BP_KNOBS / BP_RED patch ${JSON.stringify(patch)}, but this build has no __burial.set: nothing to act on`);
    // (awaited: a `crest` key makes set() import site.js before it rebuilds her, so an unawaited call stepped the OLD sleeper)
    await c.ev(`(await window.__burial.set(${JSON.stringify(patch)}), window.__bench.step(30), 1)`);
    record.patch = patch;
  }
  if (MODE === 'disguise') {
    out = await c.ev(DISGUISE);
    record.hasSand = await c.ev(`!!(window.__burial && window.__burial.sandAt)`);
  }
  if (MODE === 'breath') {
    const legs = [];
    for (const [d, secs] of [[6, 40], [12, 30]]) {
      const pl = await c.ev(BREATH_PLACE(d));
      if (!pl || pl.err) { out = pl; break; }
      console.log(`leg ${d} u: ${JSON.stringify(pl)}`);
      for (let f = 0; f < secs * 60; f += 300) await c.ev(BREATH_BOOK(Math.min(300, secs * 60 - f), d));
      legs.push(pl);
    }
    if (!out) out = { legs, series: await c.ev(`window.__bpS || []`), hasMound: await c.ev(`!!window.lev.mound`),
      up: await c.ev(`(window.__burial && window.__burial.knobs.breath ? window.__burial.knobs.breath.up : null)`),
      knobs: await c.ev(`(window.__burial && window.__burial.knobs.breath ? JSON.parse(JSON.stringify(window.__burial.knobs.breath)) : null)`) };
  }
} catch (e) { fatal = String(e && e.message || e); }
const clock = await drift(c).catch(() => null);
record.clock = clock;
const cons = (await c.console().catch(() => [])).filter(l => /error|EXC/i.test(l) && !/favicon/i.test(l));
record.consoleErrors = cons;
c.close();

// ---- the verdicts: UNMEASURED (2) and LOST (4) come before any bar ----
if (fatal) { console.error('UNMEASURED: page-side throw: ' + fatal); finish(2, 'throw: ' + fatal); }
if (out && out.err) { console.error('UNMEASURED: ' + out.err); finish(2, out.err); }
if (!out) { console.error('UNMEASURED: the page returned no reading (no out, no err)'); finish(2, 'no reading'); }
if (unmeasured(clock)) { console.error('UNMEASURED: no clock reading ' + JSON.stringify(clock)); finish(2, 'no clock reading'); }
record[MODE] = out;
if (lost(clock)) {
  console.log(`${MODE.toUpperCase()} ${JSON.stringify(MODE === 'breath' ? { legs: out.legs, frames: out.series.length } : out)}`);
  console.log(`CLOCK LOST: drift ${clock.drift} s over ${clock.stepped} s stepped (the bar is ${CLOCK_LOST} s), clock ${clock.running ? 'RUNNING' : 'stopped'}: ${JSON.stringify(clock)}`);
  finish(4, 'clock lost');
}

// breath: the bars (header). A RED judges only its own bars; otherwise a real FAIL beats an UNMEASURED, and nothing vacuous passes
if (MODE === 'breath') {
  const S = out.series, up = out.up ?? 1.6, rows = leg => S.filter(r => r[0] === leg);
  const r6 = rows(6), r12 = rows(12), dorm6 = r6.filter(r => r[5] === 1), ys = dorm6.map(r => r[1]);
  const lo = ys.length ? Math.min(...ys) : null, hi = ys.length ? Math.max(...ys) : null, amp = ys.length ? +(hi - lo).toFixed(5) : null;
  // the peaks: an excursion over half the amplitude, its top; one cut by the leg's first or last frame is not booked
  const peaks = [];
  if (amp > 1e-4) { const th = lo + amp / 2; let a = -1;
    for (let i = 0; i <= r6.length; i++) { const over = i < r6.length && r6[i][1] > th;
      if (over && a < 0) a = i;
      if (!over && a >= 0) { if (a > 0 && i < r6.length) { let m = a; for (let q = a; q < i; q++) if (r6[q][1] > r6[m][1]) m = q; peaks.push(+(m / 60).toFixed(3)); } a = -1; } } }
  const iv = peaks.slice(1).map((t, i) => +(t - peaks[i]).toFixed(3));
  // a breath = its rise completed inside the leg (brAge crossing up: the frame breathTick's trickle check runs)
  const ups = (rr, age0) => { let n = 0, prev = age0; for (const r of rr) { if (r[3] != null && prev != null && prev < up && r[3] >= up) n++; if (r[3] != null) prev = r[3]; } return n; };
  const b6 = ups(r6, out.legs[0] ? out.legs[0].age0 : null), b12 = ups(r12, r6.length ? r6[r6.length - 1][3] : null);
  const t6 = r6.length ? r6[r6.length - 1][2] - (out.legs[0] ? out.legs[0].tr0 : 0) : 0, t12 = r12.length && r6.length ? r12[r12.length - 1][2] - r6[r6.length - 1][2] : 0;
  const dh = rr => rr.length ? [Math.min(...rr.map(r => r[6])), Math.max(...rr.map(r => r[6]))] : null, dc = rr => rr.length ? [Math.min(...rr.map(r => r[7])), Math.max(...rr.map(r => r[7]))] : null;
  const ck = [
    { name: 'amp', val: amp, n: dorm6.length, bar: '0.03 - 0.06 u (max - min of the ring-1 vertex, dormant, at 6 u)', ok: amp != null && amp >= 0.03 && amp <= 0.06, vacuous: !dorm6.length },
    { name: 'interval', val: iv, n: peaks.length, peaks, bar: 'every peak-to-peak 8 - 10 s, >= 3 peaks', ok: peaks.length >= 3 && iv.every(v => v >= 8 && v <= 10), vacuous: peaks.length < 3 },
    { name: 'trickle6', val: b6 ? +(t6 / b6).toFixed(2) : null, n: b6, trickles: t6, bar: '>= 1 per breath at 6 u', ok: b6 > 0 && t6 >= b6, vacuous: b6 === 0 },
    { name: 'trickle12', val: t12, n: b12, bar: '0 at 12 u over 30 s', ok: b12 > 0 && t12 === 0, vacuous: b12 === 0 }];
  const red = RED ? REDS.breath[RED].bars : null;
  for (const k of ck) k.judged = !red || red.includes(k.name);
  record.checks = ck;
  record.legsInfo = { notDormant: S.filter(r => r[5] !== 1).length, him6: dh(r6), him12: dh(r12), lens6: dc(r6), lens12: dc(r12), breaths: [b6, b12], hasMound: out.hasMound, knobs: out.knobs };
  console.log(`BREATH ${JSON.stringify({ legs: out.legs, frames: S.length, info: record.legsInfo })}`);
  for (const k of ck) console.log(`  ${k.judged ? (k.vacuous ? 'VOID' : k.ok ? 'ok  ' : 'FAIL') : 'info'} ${k.name.padEnd(9)} ${JSON.stringify(k.val)} (bar ${k.bar}; n ${k.n}${k.peaks ? '; peaks at ' + JSON.stringify(k.peaks) + ' s' : ''}${k.trickles != null ? '; trickles ' + k.trickles : ''})`);
  if (cons.length) console.error('console errors (booked, not part of the bar): ' + JSON.stringify(cons));
  const J = ck.filter(k => k.judged), failed = J.filter(k => !k.vacuous && !k.ok), vac = J.filter(k => k.vacuous);
  if (RED) {
    if (vac.length) { console.error(`UNMEASURED: BP_RED ${RED}: nothing booked for ${vac.map(k => k.name).join(', ')}`); finish(2, 'RED bars vacuous'); }
    if (failed.length === J.length) { console.log(`RED ${RED}: ${red.join(', ')} failed as it must: exit 5`); finish(5); }
    console.error(`RED ${RED} did not fail as written (${J.filter(k => k.ok).map(k => k.name).join(', ')} held): exit 3`); finish(3, 'RED did not fail');
  }
  if (failed.length) { console.error('FAIL ' + failed.map(k => `${k.name} ${JSON.stringify(k.val)} (bar ${k.bar})`).join('; ') + (vac.length ? '; UNMEASURED ' + vac.map(k => k.name).join(', ') : '')); finish(1, 'failed: ' + failed.map(k => k.name).join(',')); }
  if (vac.length) { console.error('UNMEASURED: nothing booked for ' + vac.map(k => k.name).join(', ')); finish(2, 'vacuous: ' + vac.map(k => k.name).join(',')); }
  console.log('PASS'); finish(0);
}

// disguise: every check as { name, val, bar, ok, judged }. judged = in BP_CHECK if given, else those this build can judge
const hasSand = !!record.hasSand;
const checks = [];
const part = (name, bar) => { const w = out.worst[name], n = out.n[name] || 0; checks.push({ name, val: w ? w.d : null, at: w ? w.at : null, n, bar, ok: !!w && w.d <= 0, vacuous: !w || n === 0, judged: true }); };
for (const p of ['legs', 'claws', 'eyes', 'mouth', 'wards']) part(p, '<= 0');
// (from Task 3a on: before the dune covers her flanks they stand on the floor's level by design.) n = the growth's vertices examined
// (the vacuity floor); nOut = those DRAWN outside the strip; none drawn there passes (the growth outside the strip is buried)
for (const p of ['reef', 'weed']) { const w = out.worst[p], n = out.n[p] || 0, nOut = (out.outN || {})[p] || 0;
  checks.push({ name: p, val: w ? w.d : null, at: w ? w.at : null, n, nOut, bar: '<= 0 (drawn, outside the strip)', ok: n > 0 && (!w || w.d <= 0), vacuous: n === 0, judged: hasSand }); }
checks.push({ name: 'sides', val: out.sides.d, at: out.sides.at, bar: '<= +0.02', ok: out.sides.at != null && out.sides.d <= 0.02, vacuous: out.sides.at == null, judged: true });
// no shell vertex over the sand in the strip = no crest at all: a finding (the bar fails), not a missing measurement
checks.push({ name: 'top', val: out.crest.n ? out.crest.top : null, n: out.crest.n, bar: '3.0 - 4.0 u', ok: out.crest.n > 0 && out.crest.top >= 3.0 && out.crest.top <= 4.0, vacuous: false, judged: true });
checks.push({ name: 'len', val: out.crest.len, n: out.crest.n, bar: '16 - 24 u', ok: out.crest.n > 0 && out.crest.len >= 16 && out.crest.len <= 24, vacuous: false, judged: true });
// the repose (Task 3a, narrowed in fix round 2): judged where she has a mound (main / the ridge RED have no dune to judge); >= 200
// triangles booked, else UNMEASURED
{ const r = out.repose;
  checks.push(r ? { name: 'repose', val: r.worst ? r.worst.deg : null, at: r.worst ? r.worst.at : null, n: r.n, bar: '<= 33.81 deg (fixed)', ok: r.n >= 200 && !!r.worst && r.worst.deg <= 33.81, vacuous: r.n < 200, judged: true,
      info: { over33: r.over33, over45: r.over45, over60: r.over60, over45tall: r.over45tall, worstSpan: r.worst && r.worst.span, worstRing: r.worst && r.worst.ring, worstBearing: r.worst && r.worst.bearing, tallestSteep: r.tallestSteep, degenerate: r.nDeg } }
    : { name: 'repose', val: null, n: 0, bar: 'n/a (no mound)', ok: false, vacuous: true, judged: false }); }
// (Task 6) clutch, (Task 4) harpoon: pushed here when the page side reports them
for (const k of checks) if (ONLY) k.judged = ONLY.includes(k.name);
for (const need of ONLY || []) if (!checks.some(k => k.name === need)) { console.error(`UNMEASURED: BP_CHECK ${need} is not built into this probe yet`); finish(2, 'BP_CHECK ' + need + ' not built'); }
record.checks = checks;
console.log(`DISGUISE ${JSON.stringify({ ...out, repose: out.repose ? { ...out.repose, tris: out.repose.tris.length + ' triangles (JSON)' } : null, checks: checks.map(k => ({ name: k.name, val: k.val, ok: k.ok, judged: k.judged })) })}`);
for (const k of checks) console.log(`  ${k.judged ? (k.vacuous ? 'VOID' : k.ok ? 'ok  ' : 'FAIL') : 'info'} ${k.name.padEnd(6)} ${k.val == null ? 'n/a' : k.val} (bar ${k.bar}; n ${k.n ?? '-'}${k.nOut != null ? '; drawn outside the strip ' + k.nOut : ''}${k.at ? '; worst at ' + JSON.stringify(k.at) : ''}${k.info ? '; ' + JSON.stringify(k.info) : ''})${k.judged ? '' : ' [not judged here]'}`);
const judged = checks.filter(k => k.judged);
const vac = judged.filter(k => k.vacuous);
if (vac.length) { console.error('UNMEASURED: nothing booked for ' + vac.map(k => k.name).join(', ')); finish(2, 'vacuous: ' + vac.map(k => k.name).join(',')); }
if (cons.length) console.error('console errors (booked, not part of the bar): ' + JSON.stringify(cons));
const failed = judged.filter(k => !k.ok);
if (RED) {
  const bars = REDS[MODE][RED].bars, notJudged = bars.filter(b => !judged.some(k => k.name === b));
  if (notJudged.length) { console.error(`UNMEASURED: BP_RED ${RED} targets ${bars.join(', ')} and ${notJudged.join(', ')} is not among the judged checks`); finish(2, 'RED bars not judged'); }
  const hit = bars.filter(b => failed.some(k => k.name === b)), miss = bars.filter(b => !hit.includes(b));
  console.log(`RED ${RED}: targeted ${bars.join(', ')}; failed ${hit.join(', ') || 'none'}${miss.length ? '; did NOT fail ' + miss.join(', ') : ''}`);
  if (miss.length) { console.error(`RED ${RED} did not fail as written (${miss.join(', ')} held): exit 3`); finish(3, 'RED did not fail: ' + miss.join(',')); }
  console.log(`RED ${RED} failed as it must: exit 5`); finish(5);
}
if (failed.length) { console.error('FAIL ' + failed.map(k => `${k.name} ${k.val} (bar ${k.bar})`).join('; ')); finish(1, 'failed: ' + failed.map(k => k.name).join(',')); }
console.log('PASS'); finish(0);
