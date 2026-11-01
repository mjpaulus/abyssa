// THE BURIAL — Velkath asleep as a rock with an old harpoon in it (velkath-buried-rock; spec
// docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md; Michael 2026-10-14: "it would be interesting if she was buried
// in the sand and looked like a rock"). HOME ONLY (Michael 2026-10-15: "we should focus on getting one right now"): the site row's
// sleepers[0].bury switches it on; without it nothing here is called and she is the shipped ridge bit for bit.
// ONE VALUE DRIVES IT: L.bury, 0 risen .. 1 buried. brooder.js poseAll sinks her body L.buryD * L.bury under her bed; the mound is
// drawn over her at L.bury (Task 3a); the crust shades her shell at L.bury (Task 5). Fits run at events: her build (in one call), and the
// dig-in's refit, which runs as a JOB sliced over frames (BURY.job, brooder.js digStep: the same generators, at most job ms a frame); outside
// a fit, zero per-frame allocation.
import * as THREE from 'three';
import { V3 } from '../../lib/math.js';
import { terrainH } from '../../world/terrain.js';
import { seededRand } from '../../lib/textures.js';
import * as G from './brooderGeo.js';

// on      dev A/B (__burial.set): 0 = the shipped ridge at home too
// (the crest, u: her crest's top over the mean ground under her, is the SITE ROW's alone, sleepers[0].bury.crest (home 6.5; brooder.js L.crest
// reads it at her build), final review item 9: spec 3-4 u; Michael's checkpoint 2026-10-20, "it doesnt really read a rock": sunk less, 6-7 u, his
// call beyond the spec. At 7.0 her folded legs stood +0.22 u out of the dune (burial-probe disguise), and the exposed rock gained 1.5% over 6.5.
// __burial.set({ crest }) writes the live row and rebuilds her)
export const BURY = { on: 1 };
// THE MOUND (spec §1 "The sand mound"): a dune over her sunk shell that leaves only a strip of her back's crest showing.
//   crestL / crestW  u: the strip, an ellipse along her keel (spec: "about 20 u long"); crestZ its centre (shell units: the bake's
//                    top lies at z -0.10)
//   edgeMin  u: on each bearing the strip's edge is pulled in until her shell there stands this high over the mean ground (the
//            keel falls away at her ends: no pit of sand-walled shell)
//   reveal   u: the rock stands this far out of the sand at the strip's edge (ring 0 lies this far inside her shell)
//   cover    u: sand over her shell outside the strip, at the least; repose: the dune's fall per unit run (0.55 ~ 29 deg)
//   rings    the dune's rings from the edge to where it meets the floor (+2 buried a hair under it); ringStep u, the march
//   breath   the tell (spec): a lift of `lift` u every period s (up s, down s); drawn only with the lens within `draw` u of the strip's edge
//            (Task 5b: was 12 u of a crestL / 2 circle round her centre); the
//            trickle only with him within `near` u (spec: "visible only within about 8 u"). Michael, 2026-10-15: it may be too subtle
//            to see; he judges it on stills ("I thought I already approved this but yes these are fine to proceed with"); the knob
//            is `lift`
//   clutchSink u: buried, her whole clutch sits this much deeper than her body's sink (brood.js B.update, by L.bury). Sunk 1.41 u (crest 6.5)
//            her spill tongue's outer lobe (17, at the strip's rear end, inside the band where there is no dune) stood +0.711 u over the drawn
//            sand (burial-probe disguise clutch, ddd8133); it needs 0.761 u to meet the bar (-0.05 under); 1.2 u leaves 0.44 u of margin
//   clawSink u: buried, her folded claws sit this much deeper than her body's sink (brooder.js poseClaws, by L.bury). Sunk 1.4 u (crest 6.5)
//            the palm and finger of both claws, folded under her prow, stood up to +2.06 u over the bare floor inside her drawn shell (every one
//            enclosed: the burial-probe's literal bar failed on points nobody can see); 3.0 u = the 3.5 u crest's sink less the 6.5's (4.41 - 1.41):
//            the claws lie where Michael saw them at Task 5's checkpoint
// (Task 5b) crestW 6 -> 20: sunk less, a 6 u strip only lifted the whole dune with her (exposed rock 171 u^2, 1.8x 1ddb11a's 95, a plate on a
// sand hill in the stills); the strip's edge is now set by edgeMin round her back (her shell standing 1.2 u over the mean ground), so the
// sand meets her flanks and her back stands out of it as rock (500 u^2, 5.3x; crestW 14: 355, 3.7x)
Object.assign(BURY, { crestL: 20, crestW: 20, crestZ: -0.07, clawSink: 3.0, clutchSink: 1.2, edgeMin: 1.2, reveal: 0.35, cover: 0.3, repose: 0.55, rings: 14, ringStep: 0.25,
  breath: { lift: 0.045, period: [8, 10], up: 1.6, down: 2.6, draw: 18, near: 8 },
  // THE FOOTING over her crest (Task 3b, controller ruling 1; fitFooting below): r u, the lead sole's footprint (a disc the sole's half
  // length: diver.js's casting runs 0.52 u heel to toe); h u, the baked grid
  foot: { r: 0.25, h: 0.0625 } });
// THE RISE (spec §2, "about 6 s", on brooder.js RISE_T; u = L.stand, 0..1 over it):
//   crack   the crust cracks along her length over crackT s (uCrack, Task 7b), ev.quake jolts the lens, slabs of crust slough off (7b)
//   pour    she comes up out of the sand over riseU (bury 1 -> 0), the dune draws back down her sides over pourU (moundK), sand
//           streams off the dune's flanks (7b)
//   plume   plume.js 'rise' (Task 8)
// shoveV / shoveStag: on her the crack shoves him flat off her (u/s, s of stagger): "Her rising body shoves him back with a stagger,
// but cannot tear the dress". holdRise: "The fight's dangers (the drop, the hammer, the tear) start once she stands": until she has
// STOOD (the rise clock done and the heave settled) her body's contacts are a shove, her threat is held at 0 (no hammer) and the drop's
// count does not run (relief Task 8: the heave's overshoot closing her rise tore a perfect player in 8 of 12 fights).
// (Task 7a, the controller's rulings) riseVmax u/s: her body's rise is rate limited until she stands (brooder.js poseAll: the sole floor's
// 12-18 u/s surge at heave ~0.45; burial-probe rise (d) bar 8 u/s). 7, not 6: the lag it leaves when standE reaches 0.9 (where her hunt and
// fissure-probe velkath-crack's shell clearance, >= 3.0 u, begin) is 1.41 u, at 6 1.98 u (home's clearance read 2.89-2.98; at 7, 3.60-3.74). footRise 1: her crest's footing stays ground, carried by
// her body, from the crack until she stands (0 = it vanished on the wake frame: BP_RED=nofoot), for him only while his boots are within footStep u
// under it or over it (fix round 1, C1: never the floor under her belly)
// (Task 8) plume: 1 the rise's dust cloud (plume.js 'rise', spawned by brooder.js on the crack and the sheets), 0 none (burial-probe BP_RED=noplume)
// (Task 8, the controller's ruling 3) shoveV 5 -> 11: from the harpoon's anchor the crack must carry him clear of her bump re-find (sight():
// L._pd < collR x 1.05 = 5.34 u off her spine), or a blind spell ends on the next frame. At 5 he stood 4.6-5.2 u off it through 3.8-5.3 s (46 bump
// re-finds); at 11 her spine is 9+ u off at the loss and his capsule never meets her shell in the spell (burial-probe rise anchor: lost 3.97 s,
// found 7.90 s by line of sight, a 3.933 s spell: the final run). MEASURED SENSITIVE: the anchor's spell at 8 / 9 / 9.5 / 10 / 10.5 / 11 / 11.5 / 12 u/s read 2.97 / 3.55 /
// 4.30 / 4.25 / 4.20 / 3.90-3.93 / 2.85 / touch-ended (7 touch-ended too), and the crest's footing (g) fails at 8 / 9 / 9.5 (sliding down her
// flank in contact with her shell collider 3.5 u over the floor), passes at 5, 7, 10-12. The shove's line still goes through safeThrow (crackBeat)
Object.assign(BURY, { riseU: [0.04, 0.62], pourU: [0.08, 0.66], crackT: 0.8, shoveV: 11, shoveStag: 0.8, holdRise: 1, riseVmax: 7, footRise: 1, footStep: 0.6, plume: 1 });
// DIGGING BACK IN (spec §3; Task 12, brooder.js the dig-in): once he is off her ground (today's settle rule's margin and hold: SETTLE.release,
// SETTLE.hold s; tested by onHerDune, because onHerGround's height cutoff sinks with her), bury runs 0 -> 1 over digT s: she sinks, the sand
// slides back up her flanks (growCover below), the crust fades back in, a low haze of silt drifts off (render only: calmed, she is blinded by
// nothing). He comes back onto her ground: it pauses; it resumes when he has been off SETTLE.hold s again. At its start the mound is fitted
// to where she actually lay down (her walk home stops within 3 u and 0.12 rad of her bed): the sink re-measured there, the dune re-fitted
// over the sunk pose. When it ends she is the outcrop again, the harpoon's scar in the rock, her wards DARK under the sand: the spec's
// "embers" were built dark (BURN's 15 s fade has run out before the 17.5 s dig-in), an open question to Michael.
//   digT s (spec 15-20); pause 1 (0: burial-probe's RED nopause); haze s between haze puffs
//   job ms: THE REFIT AS A JOB OVER FRAMES (booked item 6). The re-bed measured 165 ms in one frame at home on this branch (fitMound 114 ms,
//        76 of them the footing's envelope; prepGrowth 4 ms; headless M5 Max, the page's CPU calibrated against node), so the dig-in's fit
//        runs as generators (fitMoundJ, prepGrowthJ) that yield whenever a frame's slice of `job` ms is spent; the pose is held for it (brooder.js
//        digStep; a throw inside a slice abandons the job, final review item 7). The rock's growth is NOT laid again (growRock runs at a bed only):
//        it rides her body, and its placement filters (the strip, the floor + 0.3, the seam) stay the first bed's (final review, the coordinator's
//        ruling: a re-lay read as a visible pop of coral on her exposed back). burial-probe digin's pre-registered bar: the window's worst frame <= 4.0 ms over its median. The base update has a beat of
//        +2.5-2.9 ms every ~23 frames, so the bar sees a slice landing on it: slices of 2.5 ms gave a worst frame 5.2 ms over the median (FAIL), 1.0 ms
//        3.8-3.9, 0.8 ms (with the first two frames split and the limbs captured, below) 3.5-3.7. A scavenge inside a slice (terrainH boxes ~470 B a
//        call, ~80 MB a fit: terrain.js, pre-existing) can stretch one to ~2 ms. The job is ~187 frames (~3.1 s) before bury rises. bedDown runs the
//        same generators to the end in one call (the deadline Infinity: never a yield), so a bed is the same arithmetic as before, bit for bit
//        (hash-checked against 90e1f99: reviews/buried/t12-bedhash-*.json); its checks cost a re-bed ~7 ms (the footing 76 -> 83)
Object.assign(BURY, { digT: 17.5, pause: 1, haze: 0.8, job: 0.8 });
// the job's clock: _dl the frame's deadline (performance.now() ms), Infinity outside a job (a bed: the checks below are one compare)
let _dl = Infinity, _ck = 0;
const due = () => _dl !== Infinity && (++_ck & 15) === 0 && performance.now() > _dl;   // (fine loops: a vertex, a triangle)
const dueNow = () => _dl !== Infinity && performance.now() > _dl;                        // (coarse loops: a bearing, a row)
// run a job to its end in this call (bedDown's fits)
function runAll(g) { const d = _dl; _dl = Infinity; try { while (!g.next().done); } finally { _dl = d; } }
// one slice of a job: until `ms` from now, or the job's end; true when it is done
export function jobSlice(g, ms) { const d = _dl; _dl = performance.now() + ms; try { return !!g.next().done; } finally { _dl = d; } }
const _v = V3();

// the mean ground under her: poseAll's own 5 x 5 support grid over her footprint, bare floor. (The grid's constants live in THREE
// places: here, brooder.js poseAll's support fit and tools/bench/burial-probe.mjs DISGUISE's mean ground. Change one, change all.)
export function meanGround(L) {
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), R = L.R;
  let s = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const lx = (-0.8 + 0.4 * i) * R, lz = (-0.84 + 0.425 * j) * R;
    s += terrainH(L.pos.x + lx * cy + lz * sy, L.pos.z - lx * sy + lz * cy, L.idx);
  }
  return s / 25;
}
// THE SINK (spec §1: "the depth that puts the crest's top 3–4 u above the mean ground under her"), read off her DRAWN shell in the
// pose she is in (L.bury 0): its highest vertex, less the sleeping breath's lift at this instant (L.breathU) so the depth does not
// depend on the phase of a breath at the fit.
export function fitSink(L, crest) {
  const sh = L.parts.shell, P = sh.geometry.attributes.position;
  L.body.updateMatrixWorld(true);
  const mw = sh.matrixWorld;
  let top = -1e9;
  for (let i = 0; i < P.count; i++) { _v.fromBufferAttribute(P, i).applyMatrix4(mw); if (_v.y > top) top = _v.y; }
  L.meanG = meanGround(L);
  L.crestTop0 = top - L.breathU;
  return Math.max(0, L.crestTop0 - L.meanG - crest);
}

// ---- THE MOUND ----
const NB = 128;   // bearings (the skirt's SK_COLS)
const RIN = new Float32Array(NB), RS = new Float32Array(NB);
const _rgb = [0, 0, 0], RING = new Float32Array(NB), _mi = new THREE.Matrix4(), REND = new Float32Array(NB), RE1 = new Float32Array(NB), RE2 = new Float32Array(NB), CAPR = new Float32Array(NB);
// THE DRAWN SHELL under the dune, binned (Task 3a, measured on the baked shell at home): the bake's top heightfield (L.topAt) is a
// coarse bilinear grid, and her shell is not a smooth dome under it. Her keel's spines read +-0.5 u off it, and the lip of her
// back is a near-vertical face (the top falls 2-4 u inside 0.5 u of run: the grid reads half-way down it), which stood 1.8 u over a
// dune fitted to topAt alone, outside the strip. So the fit reads her DRAWN vertices too: SHN, the highest drawn shell vertex per
// bearing (both bearings either side of it) and per radial bin (ringStep), for the strip's edge and each ring's need; VSRC, per
// drawn vertex, whether it stands over the floor less the cover (the vertices the dune must cover). Built at the fit (an event).
const NRAD = 160, SHN = new Float32Array(NB * NRAD), SHO = new Float32Array(NB * NRAD), _sv = V3();
let VSRC = new Uint8Array(0);
// THE SAND PILE (Task 3a fix round; the controller's ruling C1: a dune fitted bearing by bearing ran out in thin rays, each bearing
// its own length, with walls and 70 deg faces between them: a star, not drifted sand). The dune's height is a pile of sand at its
// angle of repose over her shell: at every point the highest of (her drawn shell + cover) - repose x distance, over every drawn
// vertex outside the strip standing over the floor, and never under the floor. Computed on a square grid round the strip's centre
// (GH u cells, world-aligned, so the fall is the same in every direction), by a 5 x 5 chamfer: two raster passes each way with the
// steps (1,0) (1,1) (2,1), their true lengths (a straight line between grid moves is at most 2.7% longer than the chamfer path, so
// the pile falls at most ~3% short of the repose in some directions, never steeper). Each vertex is deposited at the four cells
// round it (the bilinear read at it is then >= its need). The rings sample the pile, so every bearing's run-out is the pile's own.
const GH = 0.5, GMAX = 128, EH = new Float32Array(GMAX * GMAX);
let gx0 = 0, gz0 = 0, gn = 0, gh = GH;
export function makeMound(L, material) {
  const NR = BURY.rings + 2, n = NB * NR, g = new THREE.BufferGeometry();
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  const idx = [];
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NB; j++) {
    const a = i * NB + j, b = i * NB + (j + 1) % NB, c = a + NB, d = b + NB;
    idx.push(a, b, c, b, d, c);
  }
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, material);              // the seabed's own (SHARED: lifted out before disposeSleeper, as the skirt)
  mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.visible = false;
  L.grp.add(mesh);
  const prev = L.onDispose;                              // (brooder.js buildSkirt's chain: the shared material must survive her dispose)
  L.onDispose = () => { if (mesh.parent) mesh.parent.remove(mesh); g.dispose(); if (prev) prev(); };
  return { mesh, geo: g, P, N, M: new Float32Array(n * 3), F: new Float32Array(n * 3), NM: new Float32Array(n * 3),
    RR: new Float32Array(NB * NR), NEED: new Float32Array(n), COLS: NB, NR, k: -1, br: 0, drawn: false, c: 1, s: 0, R: L.R, cx: 0, cz: 0, crestZ: BURY.crestZ,
    bx: 0, bz: 0, br2: 0, topAt: null, mw: new Float32Array(16), mwInv: new Float32Array(16), DG: new Uint8Array(NB * NR) };
}
// her shell's top under WORLD (x, z), at the fit pose: into her frame by the FULL inverse (dormant she is pitched and rolled to her
// bed: a yaw-only map put a point 6 u up her back ~0.3 u off on a 3 deg tilt, against 0.3 u of cover), the height found in two passes
// (brood.js floorL's way: the local x, z depend on the height through the tilt), back to world y. NaN off her plan. (MD.topAt is
// L.topAt: procedural, null outside her rim; baked, null outside the probe box only, with a neighbour-cell fallback at its edge.)
export function shellTopW(MD, x, z) { return shellTopM(MD, MD.mw, MD.mwInv, x, z); }
// the same through any body matrix e and its inverse n (column-major arrays): (Task 7b) the slabs read her shell where it is NOW
function shellTopM(MD, e, n, x, z) {
  let wy = e[13];
  for (let it = 0; it < 2; it++) {
    const lx = n[0] * x + n[4] * wy + n[8] * z + n[12], lz = n[2] * x + n[6] * wy + n[10] * z + n[14];
    const h = MD.topAt(lx, lz); if (h == null) return NaN;
    wy = e[1] * lx + e[5] * h + e[9] * lz + e[13];
  }
  return wy;
}
// THE FIT, with her in her BURIED pose (L.bury 1). Polar about the strip's centre C, in her frame (yaw only, as restWorld): per
// bearing, ring 0 sits `reveal` u INSIDE her shell at the strip's edge (hidden in the rock), ring 1 on is the dune: the sand pile
// (above: at least `cover` u over her drawn shell, falling at `repose` in every direction, never under the floor) sampled out to
// where it meets the floor; the last two rings a hair under the floor (the heightfield mesh is a linear sampling of terrainH: the
// edge must never float). Every drawn vertex outside the strip is then put under the cover (coverShell: the pile's linear
// sampling cuts its peaks). Drawn in the seabed's own material with its vertex channels resampled (seabedColor), so dune and floor
// read as one. Drawn-only: terrainH is untouched. After coverShell and the ring smoothing the requirements go back into the pile
// (repile), each quad takes its shorter diagonal (diagonals) and the sand settles (settle). Cost
// (measured, M5 Max headless): 12-14 ms, + prepGrowth 2.5 ms, of a 37 ms re-bed on the Task 3a strip (6 u); on the 20 u strip since Task 5b (Task 12,
// the page's CPU calibrated against node): fitMound 114-128 ms (the footing 76-83 of it), prepGrowth 4-6, a re-bed 165-175 ms. Judged by burial-probe disguise `repose` (every
// triangle of rows 1 .. NI-1 <= a fixed 33.81 deg).
export function fitMound(L, MD, seabedColor, fissureDist) { runAll(fitMoundJ(L, MD, seabedColor, fissureDist)); }
// (Task 12) the fit as a generator (BURY.job): a yield wherever a frame's slice is spent. Its first slice must run in the fit pose (her body's
// matrix and her limbs are read there: MD.mw, limbPoints); every later one reads only her shell through her body's matrixWorld, which the caller
// holds at the fit pose (brooder.js digStep)
export function* fitMoundJ(L, MD, seabedColor, fissureDist) {
  const K = BURY, R = L.R, cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), NR = MD.NR, NI = K.rings;
  L.body.updateMatrixWorld(true);
  MD.mw.set(L.body.matrixWorld.elements); MD.mwInv.set(_mi.copy(L.body.matrixWorld).invert().elements);
  limbCapture(L);   // (Task 12: her limbs' matrices kept here, in the fit pose, for pileUp's sources; limbPoints was pileUp's own first call, the same pose at a bed)
  if (dueNow()) yield;   // (the job's first slice ends here: digStep poses her twice round it)
  yield* limbPointsJ();
  MD.c = cy; MD.s = sy; MD.R = R; MD.cx = L.pos.x; MD.cz = L.pos.z; MD.crestZ = K.crestZ; MD.topAt = L.topAt;
  // the mesh's (x, z) by her yaw (as restWorld and toPolar map it); every HEIGHT read at that world (x, z) through the full matrix
  const wx = (lx, lz) => L.pos.x + (lx * cy + lz * sy) * R, wz = (lx, lz) => L.pos.z + (-lx * sy + lz * cy) * R;
  const topW = (lx, lz) => shellTopW(MD, wx(lx, lz), wz(lx, lz));
  const a = K.crestW / 2 / R, b = K.crestL / 2 / R, st = K.ringStep / R, dl = 0.6 / R;
  yield* binShellJ(L, MD, st);
  // her shell's top at radius r on bearing j: the heightfield's, or the highest drawn vertex binned there if higher; NaN off her plan
  const shAt = (j, r, lx, lz) => {
    const t = topW(lx, lz), k = Math.floor(r / st); let m = -1e9;
    for (let q = k - 1; q <= k + 1; q++) if (q >= 0 && q < NRAD) { const v = SHN[j * NRAD + q]; if (v > m) m = v; }
    return m > -1e8 ? (t === t && t > m ? t : m) : t;
  };
  // her DRAWN shell's top near radius r on bearing j, NaN where none of it is binned: a ring's need. SHO: only the pile's sources
  // (outside the strip's band, over the floor less the cover). (The heightfield's edge cells fall back on a neighbour's height, so
  // just outside her outline it read her rim 1.3 u over the floor where the nearest drawn shell lay 3.6 u under it: a need there
  // lifted three rings of the dune's edge 1.6 u; and SHN's +-1 bin window read ring 1's need off her crest INSIDE the band, which
  // stood ring 1 0.8 u over ring 2 at both strip ends: measured, Task 3a fix rounds)
  const shDrawn = (j, r) => {
    const k = Math.floor(r / st); let m = -1e9;
    for (let q = k - 1; q <= k + 1; q++) if (q >= 0 && q < NRAD) { const v = SHO[j * NRAD + q]; if (v > m) m = v; }
    return m > -1e8 ? m : NaN;
  };
  for (let j = 0; j < NB; j++) {
    if (dueNow()) yield;
    const th = j / NB * Math.PI * 2, ux = Math.cos(th), uz = Math.sin(th);
    let r = 1 / Math.sqrt((ux / a) ** 2 + (uz / b) ** 2);
    // (her shell's drawn top, shAt: the heightfield alone read the lip of her back half-way down its face and pulled the edge 0.6 u
    // inside it, which left the lip outside the strip, standing 1.8 u over the floor)
    for (; r > 0.02; r -= st) { const h = shAt(j, r, ux * r, K.crestZ + uz * r); if (h === h && h >= L.meanG + K.edgeMin) break; }
    RIN[j] = Math.max(0.02, r);
  }
  for (let j = 0; j < NB; j++) { let s = 0; for (let q = -2; q <= 2; q++) s += RIN[(j + q + NB) % NB]; RS[j] = s / 5; }   // no corners
  // the strip's centre, then the pile round it (sources: her drawn shell outside the strip's band, over the floor less the cover)
  MD.bx = wx(0, K.crestZ); MD.bz = wz(0, K.crestZ);
  yield* pileUpJ(L, MD, dl, st);
  const C = MD.geo.attributes.color.array, rgb = _rgb, run0 = (NI - 2) * 0.1 / R;
  for (let j = 0; j < NB; j++) {
    if (dueNow()) yield;
    const th = j / NB * Math.PI * 2, ux = Math.cos(th), uz = Math.sin(th), r0 = RS[j];
    // the pile's run-out on this bearing: one step past the last sample standing over the floor (never over the crack's lip), and
    // never shorter than 0.1 u a ring (rings at one radius drew walls between bearings)
    // (off the grid, or the pile 4 u under the floor, it is done: it falls at the repose from its sources, and her shell is one cap,
    // no source lies 7 u past a gap in it)
    let rLast = -1, cap = 1e9;
    for (let r = r0 + dl; r < r0 + 2.2; r += st) {
      const lx = ux * r, lz = K.crestZ + uz * r, x = wx(lx, lz), z = wz(lx, lz), h = pileAt(x, z);
      if (h < -1e8) break;
      const fl = terrainH(x, z, L.idx);
      if (h > fl + 0.02) {
        if (fissureDist(x, z, L.idx) < 1.5) { cap = r - st; break; }   // (the drift never runs over the crack's lip)
        rLast = r;
      } else if (h < fl - 4) break;
    }
    CAPR[j] = cap; REND[j] = Math.min(cap, Math.max(rLast + st, r0 + dl + run0));
  }
  // the run-outs round the bearings, closed and smoothed (the max over +-3 bearings, averaged over +-3, never under a bearing's own):
  // where the pile's edge runs nearly along a bearing the run-out jumps 1.4 u from one bearing to the next, and the rings sheared
  // into slivers whose planes stood 50-75 deg (measured, Task 3a fix round); past the pile's edge the rings lie on the floor
  for (let j = 0; j < NB; j++) { let m = 0; for (let q = -3; q <= 3; q++) m = Math.max(m, REND[(j + q + NB) % NB]); RE1[j] = m; }
  // (+ 1.5 u: the requirements put back into the pile (repile) run it out up to ~1 u farther round her shell; the dune's last rings
  // must lie on the floor, or the step down to the buried ring is a wall)
  for (let j = 0; j < NB; j++) { let a2 = 0; for (let q = -3; q <= 3; q++) a2 += RE1[(j + q + NB) % NB]; RE2[j] = Math.min(CAPR[j], Math.max(REND[j], a2 / 7) + 1.5 / R); }
  for (let j = 0; j < NB; j++) {
    if (dueNow()) yield;
    const th = j / NB * Math.PI * 2, ux = Math.cos(th), uz = Math.sin(th), r0 = RS[j], rEnd = RE2[j];
    const set = (i, r, dk) => {
      const lx = ux * r, lz = K.crestZ + uz * r, x = wx(lx, lz), z = wz(lx, lz), o = (i * NB + j) * 3, sh = shDrawn(j, r), fl = terrainH(x, z, L.idx);
      MD.M[o] = x; MD.M[o + 2] = z;
      MD.M[o + 1] = i === 0 ? 0 : Math.max(fl, pileAt(x, z));
      MD.NEED[i * NB + j] = i >= 1 && i < NI ? Math.max(fl, sh === sh ? sh + K.cover : -1e9) : -1e9;
      MD.F[o] = x; MD.F[o + 1] = fl - 0.12; MD.F[o + 2] = z;
      MD.RR[j * NR + i] = r;
      seabedColor(x, z, rgb); C[o] = rgb[0] * dk; C[o + 1] = rgb[1]; C[o + 2] = rgb[2];
    };
    set(0, r0, 0.42);
    { const h0 = topW(ux * r0, K.crestZ + uz * r0), o = j * 3; MD.M[o + 1] = (h0 === h0 ? h0 : L.meanG) - K.reveal; }
    const r1 = r0 + dl;
    for (let i = 1; i < NI; i++) { const s = (i - 1) / (NI - 2); set(i, r1 + (rEnd - r1) * s, 0.42 + 0.58 * Math.pow(s, 0.6)); }
    set(NI, rEnd + 0.4 / R, 1); set(NI + 1, rEnd + 0.8 / R, 1);
    for (const i of [NI, NI + 1]) { const o = (i * NB + j) * 3; MD.M[o + 1] = terrainH(MD.M[o], MD.M[o + 2], L.idx) - (i === NI ? 0.10 : 0.12); }
  }
  // every drawn shell vertex outside the strip under its cover (coverShell), then across bearings: a dune has no ridges between
  // bearings (5-tap average of rings 1..NI-1, never under its cover again)
  yield* coverShellJ(L, MD);
  smoothRings(MD);
  yield* repileJ(L, MD);
  diagonals(MD);
  yield* settleJ(MD);
  if (dueNow()) yield;
  // normals of the fitted dune, facing up (the seabed material is FrontSide); the floor state's normal is straight up
  MD.P.set(MD.M); MD.geo.computeVertexNormals();
  let ny = 0; const N = MD.geo.attributes.normal.array; for (let i = 1; i < N.length; i += 3) ny += N[i];
  if (ny < 0) { const ix = MD.geo.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } MD.geo.index.needsUpdate = true; MD.geo.computeVertexNormals(); }
  MD.NM.set(MD.geo.attributes.normal.array);
  MD.geo.attributes.color.needsUpdate = true;
  // (Task 12, booked item 4, Task 3a M3) the bounding sphere of the FITTED dune (P = M here), never of the state drawn at L.bury: the dig-in
  // fits at bury 0, where setMoundK lays it flat under the floor, and a sphere of that would cull the dune as it rises
  MD.geo.computeBoundingSphere();
  MD.k = -1; setMoundK(MD, L.bury, 0);
  // the queries' early-out: a circle round C holding every ring (shutFloorY runs this for every hose node, every frame)
  let rMax = 0; for (let q = 0; q < MD.RR.length; q++) if (MD.RR[q] > rMax) rMax = MD.RR[q];
  MD.br2 = (rMax * R + 1) * (rMax * R + 1);
  { const t0 = performance.now(); yield* fitFootingJ(L, MD); MD.footMs = performance.now() - t0; }   // (booked: the bake's cost, an event; a job's spans its frames)
}
// THE FOOTING OVER HER CREST (Task 3b; controller ruling 1, 2026-10-18). His floor on the strip is NOT her crest's drawn top (crestY / sandY
// stay that, for the disguise and the harpoon's seat): her exposed back is all near-vertical lips and spines, and a rigid lead sole (0.52 u
// heel to toe) laid on the drawn top, or on the bake's coarse topAt (the first footing: the boots ran 0.8 u off the drawn rock, sinks to
// -1.25 u), cut into the rock wherever a spine stood under it. A sole on a spiky crest rests on the high points under it, so the footing is a
// WALKABLE ENVELOPE: at each point the highest drawn ground (her rock, else the dune or the floor) over the sole's footprint (a disc of
// BURY.foot.r round it). Baked here, at the fit (an event): her drawn shell's triangles exact-hit on an h-u grid over the strip's box (the
// topmost hit per node, each vertex also splatted into its nearest node so no spine top falls between nodes; max'd with terrainH and the
// drawn dune), then max-filtered over a disc of r + h sqrt2 (so the bilinear read between
// four nodes is never under the true footprint max). Kept to the strip and r + h sqrt2 round it (where her rock is ground: under the dune
// the sand is), and buriedFloorAt takes max(the dune, this): one surface across the strip's edge, no seam. Zero per-frame cost but a read.
let FW = new Float32Array(0), FG = new Float32Array(0), FIN = new Uint8Array(0);
function* fitFootingJ(L, MD) {
  const sh = L.parts.shell, PA = sh.geometry.attributes.position, P = PA.array, I = sh.geometry.index ? sh.geometry.index.array : null, nb = MD.COLS;
  const { r, h } = BURY.foot, rho = r + h * Math.SQRT2, K = Math.ceil(rho / h);
  sh.updateMatrixWorld(true);
  // (Task 12) the grids in scratch grown at a fit (an event), not allocated per fit: in the dig-in's job a 2 MB allocation and its fill were
  // one slice that could not yield (E is the mound's own: MD.foot holds it)
  const e = sh.matrixWorld.elements, nv = PA.count;
  if (FW.length < nv * 3) FW = new Float32Array(nv * 3);
  const W = FW;
  for (let v = 0; v < nv; v++) { if (due()) yield; const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    W[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; W[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; W[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; }
  // the box: the strip's edge (ring 1) + rho + a node
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let j = 0; j < nb; j++) { const o = (nb + j) * 3; if (MD.M[o] < x0) x0 = MD.M[o]; if (MD.M[o] > x1) x1 = MD.M[o]; if (MD.M[o + 2] < z0) z0 = MD.M[o + 2]; if (MD.M[o + 2] > z1) z1 = MD.M[o + 2]; }
  const pad = rho + h; x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  const nx = Math.ceil((x1 - x0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
  if (FG.length < nx * nz) { FG = new Float32Array(nx * nz); FIN = new Uint8Array(nx * nz); }
  const G = FG, IN = FIN;
  G.fill(-1e9, 0, nx * nz);
  // her drawn shell's topmost hit at every node
  const nt = I ? I.length / 3 : nv / 3;
  for (let t = 0; t < nt; t++) {
    if (due()) yield;
    const ia = (I ? I[t * 3] : t * 3) * 3, ib = (I ? I[t * 3 + 1] : t * 3 + 1) * 3, ic = (I ? I[t * 3 + 2] : t * 3 + 2) * 3;
    const ax = W[ia], az = W[ia + 2], bx = W[ib], bz = W[ib + 2], cx = W[ic], cz = W[ic + 2];
    const a0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / h)), a1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / h));
    const b0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) / h)), b1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / h));
    if (a0 > a1 || b0 > b1) continue;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (d > -1e-12 && d < 1e-12) continue;
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
      const px = x0 + a * h, pz = z0 + b * h, l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const y = l1 * W[ia + 1] + l2 * W[ib + 1] + l3 * W[ic + 1], o = b * nx + a; if (y > G[o]) G[o] = y; } }
  // every vertex into its nearest node (a spine's tip between nodes is still under the footprint of its neighbours: rho carries the offset)
  for (let v = 0; v < nv; v++) { const a = Math.round((W[v * 3] - x0) / h), b = Math.round((W[v * 3 + 2] - z0) / h);
    if (a < 0 || b < 0 || a >= nx || b >= nz) continue; const o = b * nx + a; if (W[v * 3 + 1] > G[o]) G[o] = W[v * 3 + 1]; }
  // the drawn GROUND under each node is her rock or, where it is lower, the floor or the dune: so a node of the strip with no rock over the
  // floor (her back's lip at the strip's ends falls under the sand: the first envelope left those nodes -1e9, buriedFloorAt then let her
  // shell's proxy stand solid there, and the keel walk stalled against it, 220 shell frames) is the floor's, never a hole
  // (Task 12) the dune as FITTED: at a bed it is drawn (k 1, P the fit); the dig-in fits it at bury 0, flat under the floor and not drawn, so the
  // ground term reads a view of it at the fit (P = M) instead: never the hidden state, and never the real mound drawn mid-job (ground nobody sees)
  const MDf = MD.drawn ? MD : Object.assign({}, MD, { P: MD.M, drawn: true });
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) { if (due()) yield; const x = x0 + a * h, z = z0 + b * h, o = b * nx + a, th = terrainH(x, z, L.idx), m = moundY(MDf, x, z);
    if (th > G[o]) G[o] = th; if (m > G[o]) G[o] = m; IN[o] = inStrip(MD, x, z) ? 1 : 0; }
  // the footprint max, over the strip and rho round it
  if (!MD.footE || MD.footE.length < nx * nz) MD.footE = new Float32Array(nx * nz);
  const E = MD.footE, K2 = (rho / h) * (rho / h);
  E.fill(-1e9, 0, nx * nz);
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) {
    if (due()) yield;
    let m = -1e9, near = false;
    for (let db = -K; db <= K; db++) { const bb = b + db; if (bb < 0 || bb >= nz) continue;
      for (let da = -K; da <= K; da++) { const aa = a + da; if (aa < 0 || aa >= nx || da * da + db * db > K2) continue;
        const o = bb * nx + aa; if (IN[o]) near = true; if (G[o] > m) m = G[o]; } }
    if (near) E[b * nx + a] = m; }
  MD.foot = { x0, z0, nx, nz, h, E };
}
// THE FOOTING's height under world (x, z): the envelope, bilinear; -1e9 off it (the dune or the floor is the ground there). Ground only, never
// the drawn top: the disguise and the harpoon's seat read crestY / sandY
export function footY(MD, x, z) {
  const F = MD && MD.foot; if (!F) return -1e9;
  const fx = (x - F.x0) / F.h, fz = (z - F.z0) / F.h, i = Math.floor(fx), k = Math.floor(fz);
  if (i < 0 || k < 0 || i >= F.nx - 1 || k >= F.nz - 1) return -1e9;
  const o = k * F.nx + i, E = F.E, a = E[o], b = E[o + 1], c = E[o + F.nx], d = E[o + F.nx + 1];
  if (a < -1e8 || b < -1e8 || c < -1e8 || d < -1e8) { const m = Math.max(a, b, c, d); return m > -1e8 ? Math.min(a < -1e8 ? m : a, b < -1e8 ? m : b, c < -1e8 ? m : c, d < -1e8 ? m : d) : -1e9; }
  const tx = fx - i, tz = fz - k;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
// SHN (above) off her drawn shell at the fit pose (no floor reads: the strip's edge needs only the shell)
function* binShellJ(L, MD, st) {
  SHN.fill(-1e9);
  const sh = L.parts.shell, P = sh.geometry.attributes.position, mw = sh.matrixWorld, cover = BURY.cover, lo = L.meanG - 3;
  sh.updateMatrixWorld(true);
  for (let i = 0; i < P.count; i++) {
    if (due()) yield;
    _sv.fromBufferAttribute(P, i).applyMatrix4(mw);
    if (_sv.y + cover < lo) continue;                    // (deep under the floor: the floor under her stays within ~0.7 u of meanG)
    toPolar(MD, _sv.x, _sv.z);
    const k = Math.floor(_rho / st); if (k >= NRAD) continue;
    const b0 = Math.floor(_fa) % NB, b1 = (b0 + 1) % NB;
    if (_sv.y > SHN[b0 * NRAD + k]) SHN[b0 * NRAD + k] = _sv.y;
    if (_sv.y > SHN[b1 * NRAD + k]) SHN[b1 * NRAD + k] = _sv.y;
  }
}
// THE SAND PILE (above): VSRC per drawn vertex (over the floor less the cover), the sources outside the strip's band (RS + dl at
// its bearing) deposited at the four grid cells round them, then the chamfer passes
// HER LIMBS UNDER THE SAND TOO (Task 5b, Michael's checkpoint 2026-10-20: sunk less, so more of her back stands out): at the 3.5 u crest
// her shell's own pile covered her folded legs, claws and face; sunk only 1.4 u (crest 6.5) her major claw stood 2.0 u out of the dune
// (burial-probe disguise, BP_KNOBS crest 6.5: claws +2.02, legs -0.15). So every drawn vertex of her legs, claws, eyes, eyestalks and
// mouthparts is a source of the pile as her shell's are (LSRC, world x y z, built at the fit: an event). Off the strip's band only, as the
// shell's (her crest is rock; a limb in the band would stand in it)
let LSRC = new Float32Array(0), LN = 0;
const _lm = new THREE.Matrix4(), _lm2 = new THREE.Matrix4();
// (Task 12) in two steps, so the dig-in's job can slice the second: limbCapture keeps each limb's world matrix (an instanced one's, each
// instance's) as posed NOW (the fit pose: fitMoundJ's prologue), limbPointsJ transforms every vertex through the kept matrices. The same
// matrices and the same products as the one-step version, so a bed's sources are bit for bit as before
const LOBJ = [];
let LMAT = new Float64Array(0), LMN = 0, LOWN = null;   // (LOWN: the sleeper whose limbs LOBJ holds)
function limbCapture(L) {
  LOBJ.length = 0; LOWN = L;
  if (L.legs) for (const k in L.legs) LOBJ.push(L.legs[k]);
  if (L.claws) for (const c of L.claws) LOBJ.push(c.merus, c.carpus, c.palm, c.dact);
  if (L.parts.eyes) LOBJ.push(L.parts.eyes);
  if (L.parts.stalks) LOBJ.push(L.parts.stalks);
  if (L.mouth) for (const q of L.mouth) LOBJ.push(q.hook);
  let need = 0, nm = 0;
  for (const o of LOBJ) if (o && o.geometry) { need += o.geometry.attributes.position.count * (o.isInstancedMesh ? o.count : 1); nm += o.isInstancedMesh ? o.count : 1; }
  if (LSRC.length < need * 3) LSRC = new Float32Array(need * 3);   // (grown at a fit, an event)
  if (LMAT.length < nm * 16) LMAT = new Float64Array(nm * 16);
  LMN = 0;
  for (const o of LOBJ) {
    if (!o || !o.geometry) continue;
    o.updateMatrixWorld(true);
    if (o.isInstancedMesh) for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, _lm); _lm2.multiplyMatrices(o.matrixWorld, _lm); LMAT.set(_lm2.elements, LMN * 16); LMN++; }
    else { LMAT.set(o.matrixWorld.elements, LMN * 16); LMN++; }
  }
}
// (final review item 12) her limb meshes let go when she is disposed (brooder.js L.onDispose), so a module array never holds a dead sleeper's
// geometry; only her own (a later sleeper's fit may already hold it)
export function limbRelease(L) { if (LOWN === L) { LOBJ.length = 0; LOWN = null; } }
function* limbPointsJ() {
  LN = 0; let q = 0;
  for (const o of LOBJ) {
    if (!o || !o.geometry) continue;
    const P = o.geometry.attributes.position, nk = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < nk; k++, q++) {
      _lm2.fromArray(LMAT, q * 16);
      for (let i = 0; i < P.count; i++) { if (due()) yield; _sv.fromBufferAttribute(P, i).applyMatrix4(_lm2); LSRC[LN * 3] = _sv.x; LSRC[LN * 3 + 1] = _sv.y; LSRC[LN * 3 + 2] = _sv.z; LN++; }
    }
  }
}
let LV = new Uint8Array(0);
function* pileUpJ(L, MD, dl, st) {
  const sh = L.parts.shell, P = sh.geometry.attributes.position, mw = sh.matrixWorld, cover = BURY.cover, lo = L.meanG - 2.5, R = L.R;
  const HS = 1.9 * R;                                    // (her rim ~1 R from C, a 4.5 u pile runs out ~8 u past it)
  gn = Math.min(GMAX, Math.ceil(2 * HS / GH) + 1); gh = 2 * HS / (gn - 1); gx0 = MD.bx - HS; gz0 = MD.bz - HS;
  EH.fill(-1e9, 0, gn * gn); SHO.fill(-1e9);
  if (VSRC.length < P.count) VSRC = new Uint8Array(P.count);   // (grown at a fit, an event; the shell's count only changes with the sculpt)
  for (let i = 0; i < P.count; i++) {
    if (due()) yield;
    VSRC[i] = 0;
    _sv.fromBufferAttribute(P, i).applyMatrix4(mw);
    const need = _sv.y + cover;
    if (need < lo || need <= terrainH(_sv.x, _sv.z, L.idx)) continue;
    VSRC[i] = 1;
    toPolar(MD, _sv.x, _sv.z);
    const f = Math.floor(_fa), t = _fa - f, b0 = f % NB, b1 = (b0 + 1) % NB;
    if (_rho < RS[b0] * (1 - t) + RS[b1] * t + dl) continue;   // (the strip's band: her crest is rock, the sand stops at its edge)
    { const k = Math.floor(_rho / st); if (k < NRAD) { if (_sv.y > SHO[b0 * NRAD + k]) SHO[b0 * NRAD + k] = _sv.y; if (_sv.y > SHO[b1 * NRAD + k]) SHO[b1 * NRAD + k] = _sv.y; } }
    deposit(_sv.x, _sv.z, need);
  }
  // her limbs (limbPoints above, read by fitMoundJ in the fit pose): the same rule, flagged in LV for coverShell
  if (LV.length < LN) LV = new Uint8Array(LN);
  for (let i = 0; i < LN; i++) {
    if (due()) yield;
    LV[i] = 0;
    const x = LSRC[i * 3], y = LSRC[i * 3 + 1], z = LSRC[i * 3 + 2], need = y + cover;
    if (need < lo || need <= terrainH(x, z, L.idx)) continue;
    toPolar(MD, x, z);
    const f = Math.floor(_fa), t = _fa - f, b0 = f % NB, b1 = (b0 + 1) % NB;
    if (_rho < RS[b0] * (1 - t) + RS[b1] * t + dl) continue;
    LV[i] = 1;
    { const k = Math.floor(_rho / st); if (k < NRAD) { if (y > SHO[b0 * NRAD + k]) SHO[b0 * NRAD + k] = y; if (y > SHO[b1 * NRAD + k]) SHO[b1 * NRAD + k] = y; } }
    deposit(x, z, need);
  }
  yield* chamferJ();
}
// a requirement at world (x, z) into the pile: the four cells round it (the bilinear read at it is then >= need)
function deposit(x, z, need) {
  const fx = (x - gx0) / gh, fz = (z - gz0) / gh, ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= gn - 1 || iz >= gn - 1) return;
  for (let q = 0; q < 4; q++) { const c = (iz + (q >> 1)) * gn + ix + (q & 1); if (need > EH[c]) EH[c] = need; }
}
// the 5 x 5 chamfer, twice each way: a cell takes (a neighbour - repose x the true step length) when that is higher
function* chamferJ() {
  const k = BURY.repose, w1 = k * gh, w2 = k * gh * Math.SQRT2, w3 = k * gh * Math.sqrt(5), n = gn;
  for (let rep = 0; rep < 2; rep++) {
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      if (ix === 0 && dueNow()) yield;
      const c = iz * n + ix; let v = EH[c], u;
      if (ix > 0 && (u = EH[c - 1] - w1) > v) v = u;
      if (iz > 0) {
        if ((u = EH[c - n] - w1) > v) v = u;
        if (ix > 0 && (u = EH[c - n - 1] - w2) > v) v = u;
        if (ix < n - 1 && (u = EH[c - n + 1] - w2) > v) v = u;
        if (ix > 1 && (u = EH[c - n - 2] - w3) > v) v = u;
        if (ix < n - 2 && (u = EH[c - n + 2] - w3) > v) v = u;
        if (iz > 1) { if (ix > 0 && (u = EH[c - 2 * n - 1] - w3) > v) v = u; if (ix < n - 1 && (u = EH[c - 2 * n + 1] - w3) > v) v = u; }
      }
      EH[c] = v;
    }
    for (let iz = n - 1; iz >= 0; iz--) for (let ix = n - 1; ix >= 0; ix--) {
      if (ix === n - 1 && dueNow()) yield;
      const c = iz * n + ix; let v = EH[c], u;
      if (ix < n - 1 && (u = EH[c + 1] - w1) > v) v = u;
      if (iz < n - 1) {
        if ((u = EH[c + n] - w1) > v) v = u;
        if (ix < n - 1 && (u = EH[c + n + 1] - w2) > v) v = u;
        if (ix > 0 && (u = EH[c + n - 1] - w2) > v) v = u;
        if (ix < n - 2 && (u = EH[c + n + 2] - w3) > v) v = u;
        if (ix > 1 && (u = EH[c + n - 2] - w3) > v) v = u;
        if (iz < n - 2) { if (ix < n - 1 && (u = EH[c + 2 * n + 1] - w3) > v) v = u; if (ix > 0 && (u = EH[c + 2 * n - 1] - w3) > v) v = u; }
      }
      EH[c] = v;
    }
  }
}
// the pile's height at world (x, z), bilinear; -1e9 off the grid or where no source's cone reaches
function pileAt(x, z) {
  const fx = (x - gx0) / gh, fz = (z - gz0) / gh, ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= gn - 1 || iz >= gn - 1) return -1e9;
  const c = iz * gn + ix, a = EH[c], b = EH[c + 1], d = EH[c + gn], e = EH[c + gn + 1];
  if (a < -1e8 || b < -1e8 || d < -1e8 || e < -1e8) return -1e9;
  const tx = fx - ix, tz = fz - iz;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz;
}
// THE COVER, GUARANTEED: every drawn shell vertex outside the strip (past ring 1 at its bearing) standing over the floor less the
// cover (VSRC: under it the floor already covers it) raises the NEED of the four corners of the dune's quad over it to its height +
// cover. The drawn dune is linear across each of the quad's two triangles, so it then lies >= cover over every one of them
// (smoothRings clamps to NEED, never takes it back). The two outer rings stay buried under the floor (the edge must never float):
// a vertex in that last quad needing cover is booked in MD.uncov
function* coverShellJ(L, MD) {
  const sh = L.parts.shell, P = sh.geometry.attributes.position, mw = sh.matrixWorld, cover = BURY.cover, NI = BURY.rings;
  let un = 0;
  for (let v = 0, nv = P.count + LN; v < nv; v++) {
    if (due()) yield;
    if (v < P.count) { if (!VSRC[v]) continue; _sv.fromBufferAttribute(P, v).applyMatrix4(mw); }
    else { const q = v - P.count; if (!LV[q]) continue; _sv.set(LSRC[q * 3], LSRC[q * 3 + 1], LSRC[q * 3 + 2]); }   // (her limbs: pileUp)
    const i = quadAt(MD, _sv.x, _sv.z);
    if (i < 1) continue;                                 // (the strip's band, inside the rock, or off the dune: the floor's)
    const need = _sv.y + cover;
    for (let q = i; q <= i + 1; q++) {
      if (q >= NI) { if (need > MD.M[(q * NB + _b0) * 3 + 1] || need > MD.M[(q * NB + _b1) * 3 + 1]) un++; continue; }
      if (need > MD.NEED[q * NB + _b0]) MD.NEED[q * NB + _b0] = need;
      if (need > MD.NEED[q * NB + _b1]) MD.NEED[q * NB + _b1] = need;
    }
  }
  MD.uncov = un;
}
// THE REQUIREMENTS BACK INTO THE PILE (Task 3a fix round 2; review I1): the pile is sampled at the rings and the linear mesh cuts its
// peaks, so the cover lifts corners back over her shell (coverShell) and the ring smoothing clamps them; a lifted corner beside its
// sampled neighbours stood faces of up to 84 deg, 0.9 u tall, at both strip ends (the faint spokes from above). After the ring
// smoothing, every ring vertex whose requirement stands over the pile's sample there goes into the pile as a source at its own
// (x, z), the pile is spread again, and the rings (at the same radii: the quads coverShell read are unchanged) take its heights
// where higher: the clamped corner's neighbours now fall from it at the repose, and the requirement holds at every corner (the
// deposit's bilinear read is >= it). Measured (with SHO, the repile alone, before the settle): over 33.81 deg 162 -> 60, worst
// 84.2 -> 63.1 deg, none of the remaining faces clamped
function* repileJ(L, MD) {
  const NI = BURY.rings, M = MD.M;
  let n = 0;
  for (let v = NB; v < NI * NB; v++) { const o = v * 3; if (MD.NEED[v] > pileAt(M[o], M[o + 2]) + 1e-4) { deposit(M[o], M[o + 2], MD.NEED[v]); n++; } }
  MD.repiled = n;
  if (!n) return;
  yield* chamferJ();
  for (let v = NB; v < NI * NB; v++) { const o = v * 3, h = pileAt(M[o], M[o + 2]); if (h > M[o + 1]) M[o + 1] = h; }
}
// THE SAND SETTLES (Task 3a fix round 2; review I1): what is left after the repile is the pile's own creases and cone tips sampled
// on the mesh (a triangle across a crease interpolates two flanks at once: measured 34-42 deg, none of those faces clamped).
// Raise-only, so every cover still holds: a vertex of rings 1 .. NI-2 rises to the lowest height at which a drawn triangle of rows
// 1 .. NI-1 round it is no steeper than the repose + SETTLE_SLACK (the smaller root of |g0 - h w|^2 = k^2; skipped where that is over
// both its other corners: then the far edge is the steep one and its own corners rise), Gauss-Seidel sweeps over the triangles,
// alternating direction, until nothing moves 0.1 mm (MD.settleN; MD.settleMax: the largest raise). Ring 0 (in the rock), the dune's
// last ring (where it meets the floor) and the buried rings are fixed. A raise travels downhill, shrinking by (k_settle - the pile's
// slope) per unit run, so the slack is load-bearing: on the sliver quads of the first cut, at the repose itself a raise ran out to
// the dune's edge and stood it 2 u over the floor, at + 3 deg 1 u. With the shorter diagonals it works at the strip's ends only (at
// home: 7 sweeps, 19 vertices raised over 5 cm (MD.settleRaised), the largest at its 0.5 u cap; worst face 33.01 deg; at repose 0.45: worst
// 32.12 deg, under the probe's bar, measured)
// (SETTLE_CAP u: no vertex rises more than this over its height before the settle, so a raise that will not die out is booked as a
// steep face the probe sees, never a shelf at the dune's edge)
const SETTLE_SWEEPS = 64, SETTLE_SLACK = 4.2 * Math.PI / 180, SETTLE_CAP = 0.5;
let M0 = new Float32Array(0);
let _ks = 0;
function lowFrom(M, v, a, b, lo) {
  const vx = M[v * 3], vz = M[v * 3 + 2], base = M[v * 3 + 1];
  const eax = M[a * 3] - vx, eaz = M[a * 3 + 2] - vz, ebx = M[b * 3] - vx, ebz = M[b * 3 + 2] - vz, det = eax * ebz - eaz * ebx;
  if (Math.abs(det) < 1e-9) return lo;
  const ra = M[a * 3 + 1] - base, rb = M[b * 3 + 1] - base, k = _ks;
  const g0x = (ebz * ra - eaz * rb) / det, g0z = (eax * rb - ebx * ra) / det, wx = (ebz - eaz) / det, wz = (eax - ebx) / det;
  const A = wx * wx + wz * wz, B = g0x * wx + g0z * wz, C = g0x * g0x + g0z * g0z - k * k, disc = B * B - A * C;
  if (!(A > 0) || disc < 0) return lo;                   // (the far edge alone is steeper: its own corners rise instead)
  const d = (B - Math.sqrt(disc)) / A;
  if (d > Math.max(ra, rb)) return lo;                   // (only over both its neighbours: the far edge is the steep one; it rises)
  return base + d > lo ? base + d : lo;
}
function* settleJ(MD) {
  const NI = BURY.rings, nb = NB, M = MD.M, DG = MD.DG;
  _ks = Math.tan(Math.atan(BURY.repose) + SETTLE_SLACK);
  if (M0.length < NB * MD.NR) M0 = new Float32Array(NB * MD.NR);   // (grown at a fit, an event)
  for (let v = 0; v < NB * MD.NR; v++) M0[v] = M[v * 3 + 1];
  let n = 0, top = 0, mx = 0;
  // one vertex of a triangle: raised to its lowest height under the slope (free: rings 1 .. NI-2; the rest are fixed)
  const up = (v, a, b) => {
    const r = (v / nb) | 0; if (r < 1 || r > NI - 2) return;
    const h = M[v * 3 + 1]; let lo = lowFrom(M, v, a, b, h);
    if (lo > M0[v] + SETTLE_CAP) lo = M0[v] + SETTLE_CAP;
    if (lo > h) { M[v * 3 + 1] = lo; if (lo - h > mx) mx = lo - h; if (lo - M0[v] > top) top = lo - M0[v]; }
  };
  for (; n < SETTLE_SWEEPS; n++) {
    mx = 0;
    const fwd = (n & 1) === 0;
    for (let ii = 1; ii < NI; ii++) {                    // (the triangles of rows 1 .. NI-1, as drawn: diagonals() picked each quad's)
      if (dueNow()) yield;
      const i = fwd ? ii : NI - ii;
      for (let jj = 0; jj < nb; jj++) {
        const j = fwd ? jj : nb - 1 - jj, a = i * nb + j, b = i * nb + (j + 1) % nb, c = a + nb, d = b + nb;
        if (DG[i * nb + j]) { up(a, b, d); up(b, a, d); up(d, a, b); up(a, d, c); up(d, a, c); up(c, a, d); }
        else { up(a, b, c); up(b, a, c); up(c, a, b); up(b, d, c); up(d, b, c); up(c, b, d); }
      }
    }
    if (mx < 1e-4) break;
  }
  let nr = 0; for (let v = 0; v < NB * MD.NR; v++) if (M[v * 3 + 1] > M0[v] + 0.05) nr++;
  MD.settleN = n; MD.settleMax = top; MD.settleRaised = nr;
}
// EACH QUAD'S DIAGONAL, the shorter one (Task 3a fix rounds 2-3): the strip is a slender lens round C, so at its ends its edge
// radius falls ~1.5 u a bearing over ~0.34 u of arc and the rings there lean up to 77 deg: each quad a leaning parallelogram, whose
// long diagonal made two slivers (median largest angle 149 deg) that stood the pile's slope up to 45-63 deg (the spokes at the strip's
// ends, measured). The index is rewritten at the fit (an event; the same vertices, the same winding as makeMound's); moundY reads
// MD.DG to find the drawn triangle. (A ring-1 contour with its lean held made the quads kinder but widened the band past the brief's
// 0.6 u: growth there was left drawn and her shell unjudged; review N1. Ring 1 stays at the strip's edge + 0.6 u, as the brief.)
function diagonals(MD) {
  const nb = NB, NR = MD.NR, M = MD.M, ix = MD.geo.index.array, DG = MD.DG;
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < nb; j++) {
    const a = i * nb + j, b = i * nb + (j + 1) % nb, c = a + nb, d = b + nb, q = i * nb + j, o = q * 6;
    const ad = Math.hypot(M[d * 3] - M[a * 3], M[d * 3 + 2] - M[a * 3 + 2]), bc = Math.hypot(M[c * 3] - M[b * 3], M[c * 3 + 2] - M[b * 3 + 2]);
    DG[q] = ad < bc ? 1 : 0;
    if (DG[q]) { ix[o] = a; ix[o + 1] = b; ix[o + 2] = d; ix[o + 3] = a; ix[o + 4] = d; ix[o + 5] = c; }
    else { ix[o] = a; ix[o + 1] = b; ix[o + 2] = c; ix[o + 3] = b; ix[o + 4] = d; ix[o + 5] = c; }
  }
  MD.geo.index.needsUpdate = true;
}
// rings 1..NI-1: a 5-tap average round the ring, never under the vertex's own need (the cover over her shell, the floor)
function smoothRings(MD) {
  const NI = BURY.rings;
  for (let i = 1; i < NI; i++) {
    for (let j = 0; j < NB; j++) { let s = 0; for (let q = -2; q <= 2; q++) s += MD.M[(i * NB + (j + q + NB) % NB) * 3 + 1]; RING[j] = s / 5; }
    for (let j = 0; j < NB; j++) MD.M[(i * NB + j) * 3 + 1] = Math.max(RING[j], MD.NEED[i * NB + j]);
  }
}

// the drawn state: the fitted dune at k = 1, flat under the floor at k = 0 (hidden), the breath on rings 1-4 (the sand nearest the
// rock lifts most). Writes only when k or the breath moved; no allocation.
export function setMoundK(MD, k, br = 0) {
  if (k === MD.k && br === MD.br) return;
  MD.k = k; MD.br = br;
  const P = MD.P, M = MD.M, F = MD.F, N = MD.geo.attributes.normal.array, NM = MD.NM, nb = MD.COLS;
  for (let v = 0, n = P.length / 3; v < n; v++) {
    const o = v * 3, ring = (v / nb) | 0, lift = ring >= 1 && ring <= 4 ? br * (1 - (ring - 1) / 4) : 0;
    P[o] = M[o]; P[o + 2] = M[o + 2];
    P[o + 1] = F[o + 1] + (M[o + 1] - F[o + 1]) * k + lift * k;
    const nx = NM[o] * k, ny = NM[o + 1] * k + (1 - k), nz = NM[o + 2] * k, nl = Math.hypot(nx, ny, nz) || 1;
    N[o] = nx / nl; N[o + 1] = ny / nl; N[o + 2] = nz / nl;
  }
  MD.geo.attributes.position.needsUpdate = true; MD.geo.attributes.normal.needsUpdate = true;
  MD.drawn = k > 0.001; MD.mesh.visible = MD.drawn;
}
// world (x, z) -> her frame at the fit -> polar about C: module scratch (_lx, _lz, _rho, _fa)
let _lx = 0, _lz = 0, _rho = 0, _fa = 0;
function toPolar(MD, x, z) {
  const dx = x - MD.cx, dz = z - MD.cz;
  _lx = (dx * MD.c - dz * MD.s) / MD.R; _lz = (dx * MD.s + dz * MD.c) / MD.R;
  const qz = _lz - MD.crestZ; _rho = Math.hypot(_lx, qz);
  let a = Math.atan2(qz, _lx) / (Math.PI * 2); if (a < 0) a += 1; _fa = a * MD.COLS;
}
// THE QUERIES READ THE DRAWN MESH (Task 3a, measured): every vertex of bearing j lies on the ray at angle j / NB from C, so the
// mesh's quad between bearings b0 and b1 is bounded by those two rays exactly, and its ring edges are STRAIGHT chords between them.
// Ring i's edge at the query's angle is where the ray meets that chord (ringR); a height read per bearing and then blended (the
// first cut) put the sand and the strip where the mesh does not draw them wherever a ring's radius changes from one bearing to the
// next (22 shell vertices read "outside the strip and no sand there" between bearings 31 and 32). Module scratch, no allocation.
const DTH = Math.PI * 2 / NB, SDTH = Math.sin(DTH);
let _b0 = 0, _b1 = 0, _sa = 0, _sb = 0;
function locate(MD, x, z) {
  toPolar(MD, x, z);
  const f = Math.floor(_fa), t = _fa - f;
  _b0 = f % MD.COLS; _b1 = (_b0 + 1) % MD.COLS; _sa = Math.sin(t * DTH); _sb = Math.sin((1 - t) * DTH);
}
// ring i's straight edge between _b0 and _b1 at the located angle: r0 r1 sin(dth) / (r0 sin(t dth) + r1 sin((1 - t) dth))
function ringR(MD, i) { const r0 = MD.RR[_b0 * MD.NR + i], r1 = MD.RR[_b1 * MD.NR + i]; return r0 * r1 * SDTH / (r0 * _sa + r1 * _sb); }
// the quad (rings i, i + 1) holding (x, z): i, or -1 inside ring 0 (the rock), -2 past the last ring (the floor's)
function quadAt(MD, x, z) {
  locate(MD, x, z);
  const NR = MD.NR;
  if (_rho < ringR(MD, 0)) return -1;
  if (_rho > ringR(MD, NR - 1)) return -2;
  let i = 0; while (i < NR - 2 && ringR(MD, i + 1) < _rho) i++;
  return i;
}
// the height of triangle (ia, ib, ic) of P at (x, z), barycentric in the plan; NaN for a degenerate one
function triY(P, ia, ib, ic, x, z) {
  const ax = P[ia], az = P[ia + 2], bx = P[ib], bz = P[ib + 2], cx = P[ic], cz = P[ic + 2];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return NaN;
  const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  return wa * P[ia + 1] + wb * P[ib + 1] + (1 - wa - wb) * P[ic + 1];
}
// the drawn sand's height under (x, z), or -1e9 (the strip: the rock is there; off the dune: the floor is): the drawn triangle's own
// (makeMound's quad a b c d = (i, b0) (i, b1) (i + 1, b0) (i + 1, b1), its triangles a b c and b d c)
export function moundY(MD, x, z) {
  if (!MD || !MD.drawn) return -1e9;
  { const dx = x - MD.bx, dz = z - MD.bz; if (dx * dx + dz * dz > MD.br2) return -1e9; }   // (off the dune: before any atan2)
  const i = quadAt(MD, x, z);
  if (i < 0) return -1e9;
  const nb = MD.COLS, P = MD.P, ia = (i * nb + _b0) * 3, ib = (i * nb + _b1) * 3, ic = ((i + 1) * nb + _b0) * 3, id = ((i + 1) * nb + _b1) * 3;
  let y;
  if (MD.DG[i * nb + _b0]) {
    // the diagonal a-d (diagonals()): b's side is triangle a b d, else a d c
    const ex = P[id] - P[ia], ez = P[id + 2] - P[ia + 2];
    const sp = ex * (z - P[ia + 2]) - ez * (x - P[ia]), sb = ex * (P[ib + 2] - P[ia + 2]) - ez * (P[ib] - P[ia]);
    y = sp * sb >= 0 ? triY(P, ia, ib, id, x, z) : triY(P, ia, id, ic, x, z);
    if (y !== y) y = sp * sb >= 0 ? triY(P, ia, id, ic, x, z) : triY(P, ia, ib, id, x, z);
  } else {
    // the diagonal b-c: a's side is triangle a b c, else b d c
    const ex = P[ic] - P[ib], ez = P[ic + 2] - P[ib + 2];
    const sp = ex * (z - P[ib + 2]) - ez * (x - P[ib]), sa = ex * (P[ia + 2] - P[ib + 2]) - ez * (P[ia] - P[ib]);
    y = sp * sa >= 0 ? triY(P, ia, ib, ic, x, z) : triY(P, ib, id, ic, x, z);
    if (y !== y) y = sp * sa >= 0 ? triY(P, ib, id, ic, x, z) : triY(P, ia, ib, ic, x, z);
  }
  return y === y ? y : -1e9;
}
// the drawn SAND under (x, z): the floor or the dune, never her crest (harpoon.js seat(): a seam is "over the sand" by this)
export function sandY(MD, x, z, zi) { const t = terrainH(x, z, zi), m = moundY(MD, x, z); return m > t ? m : t; }
// inside the strip's band on that bearing (to ring 1: the sand crosses her shell between ring 0 and ring 1)?
export function inStrip(MD, x, z) {
  if (!MD) return false;
  { const dx = x - MD.bx, dz = z - MD.bz; if (dx * dx + dz * dz > MD.br2) return false; }
  locate(MD, x, z);
  return _rho < ringR(MD, 1);
}
// her crest's top under (x, z) in the strip band, world y, from her baked top heightfield at the fit pose (she lies still while
// buried; shellTopW: the full matrix), or -1e9
export function crestY(MD, x, z) {
  if (!MD || !inStrip(MD, x, z)) return -1e9;
  const y = shellTopW(MD, x, z); return y === y ? y : -1e9;
}

// ---- THE CRACK'S SLABS (Task 7b; spec §2, beat 1: "Slabs of crust slough off") ----
// Her exposed back is her OWN SHELL lightly covered in sand (Task 5c, Michael 2026-10-20: "her shell but lightly covered in sand. When she
// rises the sand should fall off and create a dust cloud"), so what cracks off her at the wake is PACKED SAND: BURY.slabs clods and sheets of
// it, laid over her exposed back at the crack, sliding down whatever is under them (her shell where it is NOW, the dune, the floor), ridden
// with her as she rises, crumbling to silt as they go (a puff each, and a burst where one slides off a ledge: sand does not fall as a
// lump), gone in SLAB_T s. Hidden otherwise. (The dust cloud is Task 8's plume.)
// DRAWN IN THE SEABED'S OWN MATERIAL, one merged mesh (the dune's: makeMound, position / normal / color, the program the floor compiles at
// boot), the pieces' vertices written on the CPU while they live (14 x 42 vertices, ~0.6k, module scratch). The brief's route was the house
// rock kit's instanced program with a sand hue; its generated rock maps and cleavage read as stone, and the controller's direction for 7b
// (the 'sand' look) is sand: the dune's own grain and colour channels make a clod read as a piece of the dune. The material is
// triplanar in WORLD space, so a moving clod's grain slides over it (fine-grained sand, 1-2.5 u/s, for 3 s: it reads as sand on the move).
// Each piece: a seeded icosphere (detail 1), its radius rippled by three waves, squashed to a sheet (sy 0.28-0.42 of its width): 1.1-2.0 u
// across. A piece's lowest vertex rides the surface under it (burial-probe rise (i): never > 0.3 u over it), so on her rising back it is
// carried up with her; on the sand it sinks (SLAB_SINK u/s); where the surface drops more than SLAB_LEDGE u under it in a frame (her rim, as
// she rises out of the dune) it bursts into silt instead of hanging in the water.
// State per piece (SS floats): x z vx vz yaw spin age tEnd alive lastG y puffs
// WHY THESE (Task 7b fix round 1, M5; by eye in the dev stills t7b-dev-*, NOT measured beyond burial-probe rise (i) / (iShell); the arithmetic is the check):
//   SLAB_G 6.0, SLAB_DRAG 1.2: terminal slide speed on a face of slope s is G s / (DRAG (1 + s^2)) = 5 s / (1 + s^2) u/s (time constant 1 / DRAG = 0.83 s):
//     2.0 u/s at 27 deg, 2.5 at 45 deg (its peak), so the header's "1-2.5 u/s" and SLAB_VMAX 2.5 agree and the cap is only ever touched on a 45 deg face
//   SLAB_LEDGE 0.25: the surface under a piece dropping more than 0.25 u in a frame (15 u/s at 60 fps, 6x the fastest slide's 0.042 u a frame) is a
//     cliff, not a slope it rides: her rim as she rises out of the dune, so the piece bursts rather than hangs
//   SLAB_SINK 0.45: on sand a piece goes down 0.45 u for each second past 0.8 s of age: ~1.0 u by SLAB_T, about its whole thickness (0.28-0.42 of a
//     1.1-2.0 u width), so it is in the dune as it crumbles; never sunk on her shell (the sink is off there). On her shell the seat is clamped by SLAB_DIP
//     and a stepped piece bursts (below): the measured max depth in her is 0.094 u (anchor 0.118 u), burial-probe rise (iShell)
//   SLAB_FOOT 0.15: the five reads' spread, a little over half the shell grid's ~0.25 u cell, so a lowest point finds the crevice a cell bridges (the
//     game seats on the lowest of the five, the probe's slab() reads the highest of five +-0.05: the review's gMin -0.234 u inside her crest is that gap)
//   SLAB_DIP 0.1: the seat never goes more than 0.1 u under the read at the vertex itself. WHY: at a lip of her shell (a step 0.4-0.7 u down within
//     0.15 u) the lowest of the five reads sank a piece 0.45 u into her where it stood (0.348 u measured, iShell round 1); 0.1 is about a third of the
//     0.3 u bar, enough to still find a crevice a cell bridges
//   SLAB_STEP 0.35: a piece whose five reads span more than 0.35 u bursts into silt. WHY: that is a lip or wall of her shell, where no seat both
//     keeps it out of her and off the water (a piece at a wall, ny 0.13, read 0.30 u into her), so it is spent rather than left hanging or buried
const SLAB_STEP = 0.35, SLAB_DIP = 0.1, SLAB_FOOT = 0.15, FOOT_X = [SLAB_FOOT, -SLAB_FOOT, 0, 0], FOOT_Z = [0, 0, SLAB_FOOT, -SLAB_FOOT];
const SLAB_BEND = 1.6, SLAB_T = 3.0, SS = 12, SLAB_SINK = 0.45, SLAB_LEDGE = 0.25, SLAB_VMAX = 2.5, SLAB_G = 6.0, SLAB_DRAG = 1.2;
// (fix round 2, M3) THE RISE'S SILT BUDGET, particles a burst: the footfx pool holds 420 (life 1.2-2.4 s, shared with his boots), so the rise
// must emit under ~175 a second to cut no live puff short. On f6b4077 it emitted 1650-1850 in the 14 s after the wake, ~400 a second at its
// peak, and overwrote 280-514 live puffs a rise (burial-probe rise info.dust, first at ~1.5 s). pour: the dune's streams (was 3; stronger, 4.0:
// a larger puff for the one cut); rim: the pour off her rim once the dune is gone, buried builds only (the shipped 6 off home is untouched);
// crumble / ledge: a slab's puffs (were 3 / 6); reveal: a puff every GROW.revPuff (80, was 40) uncovered triangles (was 3)
Object.assign(BURY, { slabs: 14, pourRate: 2.5, dust: { pour: 2, pourStr: 4.0, rim: 3, crumble: 2, ledge: 4, reveal: 2 } });
let _ico = null;
const _sq = new THREE.Quaternion(), _sq2 = new THREE.Quaternion(), _sn = V3(), _sUp = V3(0, 1, 0), _slv = V3(), _sInv = new THREE.Matrix4();
function icoIndexed() {
  if (_ico) return _ico;
  const g = new THREE.IcosahedronGeometry(1, 1), A = g.attributes.position.array, map = new Map(), V = [], I = [];
  for (let i = 0; i < A.length / 3; i++) {
    const k = A[i * 3].toFixed(4) + ',' + A[i * 3 + 1].toFixed(4) + ',' + A[i * 3 + 2].toFixed(4);
    let j = map.get(k); if (j === undefined) { j = V.length / 3; map.set(k, j); V.push(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]); }
    I.push(j);
  }
  g.dispose();
  return (_ico = { V: Float32Array.from(V), I: Uint16Array.from(I), nv: V.length / 3 });
}
export function makeSlabs(L) {
  const n = BURY.slabs, ico = icoIndexed(), nv = ico.nv, ni = ico.I.length, rnd = seededRand(0x51AB5);
  const LP = new Float32Array(n * nv * 3), LN = new Float32Array(n * nv * 3), LO = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const sz = 0.6 + 0.5 * rnd(), sx = sz * (0.8 + 0.6 * rnd()), sw = sz * (0.8 + 0.6 * rnd()), sy = sz * (0.22 + 0.14 * rnd());
    const W = []; for (let q = 0; q < 3; q++) { const a = rnd() * 6.283, b = Math.acos(2 * rnd() - 1); W.push(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a), 1.6 + 1.6 * rnd(), rnd() * 6.283); }
    // a PLATE of crust, not a pebble: an irregular outline (three and five lobes round its rim), a flat-ish top, a lumpy underside
    const l3 = rnd() * 6.283, l5 = rnd() * 6.283, l2 = rnd() * 6.283;
    for (let i = 0; i < nv; i++) {
      const dx = ico.V[i * 3], dy = ico.V[i * 3 + 1], dz = ico.V[i * 3 + 2], th = Math.atan2(dz, dx);
      let r = 1; for (let q = 0; q < 15; q += 5) r += 0.12 * Math.sin((dx * W[q] + dy * W[q + 1] + dz * W[q + 2]) * W[q + 3] + W[q + 4]);
      const rim = 1 + 0.22 * Math.sin(2 * th + l2) + 0.2 * Math.sin(3 * th + l3) + 0.12 * Math.sin(5 * th + l5);
      const o = (k * nv + i) * 3; LP[o] = dx * r * rim * sx; LP[o + 1] = dy * r * sy * (dy > 0 ? 0.65 : 1.1); LP[o + 2] = dz * r * rim * sw;
    }
    // smooth normals off the faces (a clod of sand, not a cut stone)
    for (let t = 0; t < ni; t += 3) {
      const a = (k * nv + ico.I[t]) * 3, b = (k * nv + ico.I[t + 1]) * 3, c = (k * nv + ico.I[t + 2]) * 3;
      const ux = LP[b] - LP[a], uy = LP[b + 1] - LP[a + 1], uz = LP[b + 2] - LP[a + 2], wx = LP[c] - LP[a], wy = LP[c + 1] - LP[a + 1], wz = LP[c + 2] - LP[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      for (const q of [a, b, c]) { LN[q] += nx; LN[q + 1] += ny; LN[q + 2] += nz; }
    }
    // BENT toward its up (SLAB_BEND): the seabed's shader picks its material by slope (a face steeper than ~0.13-0.46 of 1 - n.y turns to its
    // rock and gravel, terrain.js color_fragment), and a clod's sides at their true normals drew it as pale stone; bent, the whole clod is
    // the silt's and its shape is told by its outline and its darkened underside (the cavity channel, slabsBreak)
    for (let i = 0; i < nv; i++) { const o = (k * nv + i) * 3; LN[o + 1] += SLAB_BEND * Math.hypot(LN[o], LN[o + 1], LN[o + 2]); const l = Math.hypot(LN[o], LN[o + 1], LN[o + 2]) || 1; LN[o] /= l; LN[o + 1] /= l; LN[o + 2] /= l; }
    LO[k] = rnd();
  }
  const g = new THREE.BufferGeometry(), P = new Float32Array(n * nv * 3), N = new Float32Array(n * nv * 3), C = new Float32Array(n * nv * 3), IX = new Uint16Array(n * ni);
  for (let k = 0; k < n; k++) for (let t = 0; t < ni; t++) IX[k * ni + t] = k * nv + ico.I[t];
  g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setIndex(new THREE.BufferAttribute(IX, 1));
  g.boundingSphere = new THREE.Sphere(V3(), 1);
  // the dune's material OBJECT (the seabed's: SHARED, lifted out before her dispose, as the mound is): receives shadows, casts none (the
  // mound's own flags: anything else is a shadow-depth variant compiled on first sight at the crack)
  const mesh = new THREE.Mesh(g, L.mound.mesh.material);
  mesh.receiveShadow = true; mesh.castShadow = false; mesh.visible = false; mesh.frustumCulled = false;
  L.grp.add(mesh);
  L.slabs = { mesh, geo: g, P, N, C, LP, LN, LO, S: new Float32Array(n * SS), n, nv, vpc: nv, t: SLAB_T, on: false };
  const prev = L.onDispose;
  L.onDispose = () => { if (mesh.parent) mesh.parent.remove(mesh); g.dispose(); if (prev) prev(); };
}
// hidden, when the slabs are spent
export function slabsHide(L) { const Sl = L.slabs; if (!Sl) return; Sl.on = false; Sl.t = SLAB_T; Sl.mesh.visible = false; }
// at every bed (bedDown, after the fit; the sculpt's landing beds her again on the baked shell): hidden, her drawn top re-gridded
export function slabsBed(L) { const Sl = L.slabs; if (!Sl) return; slabsHide(L); slabsTopGrid(L, Sl); }
// the drawn surface under (x, z): the floor, the drawn dune, her shell where it is now (through _sInv, set by the caller); _sOnShell: the
// shell was the highest
let _sOnShell = false;
// HER DRAWN TOP for the slabs: her shell's triangles rasterized at the bed (slabsBed, an event) into a grid in her body's frame, the
// highest drawn surface per cell (SLAB_GN^2 cells over the shell's plan, ~0.25 u). Not the bake's top probe (L.topAt): it reads the sculpt's
// spines and its edge answers with a neighbour cell's height past her rim, and slabs on it stood 0.3-0.68 u over her DRAWN shell (rise (i),
// first two runs: a slab must ride what is drawn). Bilinear inside a cell whose four corners she covers, NaN otherwise (her rim: the
// slab then reads the sand under it, and bursts at the ledge as she rises out of it)
// (Task 12, booked item 3) CACHED BY THE SHELL'S GEOMETRY AND ITS MATRIX IN HER BODY: the grid lies in her body's frame, so it does not move with
// her bed, and a re-bed on the same shell (the dig-in's: slabsBed in its job) keeps it; only the sculpt's landing (a new geometry) re-rasterizes
const SLAB_GN = 320;
function slabsTopGrid(L, Sl) {
  const sh = L.parts.shell, g = sh.geometry, P = g.attributes.position, I = g.index; sh.updateMatrix();
  const m = sh.matrix.elements; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  if (Sl.TH && Sl.topGeo === g && Sl.topM) { let same = true; for (let q = 0; q < 16 && same; q++) same = Sl.topM[q] === m[q]; if (same) return; }
  Sl.topGeo = g; Sl.topM = Float64Array.from(m);
  const W = Sl.TW && Sl.TW.length === P.count * 3 ? Sl.TW : (Sl.TW = new Float32Array(P.count * 3));
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const bx = m[0] * x + m[4] * y + m[8] * z + m[12], by = m[1] * x + m[5] * y + m[9] * z + m[13], bz = m[2] * x + m[6] * y + m[10] * z + m[14];
    W[i * 3] = bx; W[i * 3 + 1] = by; W[i * 3 + 2] = bz; if (bx < x0) x0 = bx; if (bx > x1) x1 = bx; if (bz < z0) z0 = bz; if (bz > z1) z1 = bz; }
  const n = SLAB_GN, H = Sl.TH || (Sl.TH = new Float32Array(n * n)); H.fill(-1e9);
  const sx = (n - 1) / (x1 - x0), sz = (n - 1) / (z1 - z0), nt = I ? I.count / 3 : P.count / 3;
  for (let t = 0; t < nt; t++) {
    const a = (I ? I.array[t * 3] : t * 3) * 3, b = (I ? I.array[t * 3 + 1] : t * 3 + 1) * 3, c = (I ? I.array[t * 3 + 2] : t * 3 + 2) * 3;
    const ax = (W[a] - x0) * sx, az = (W[a + 2] - z0) * sz, bx = (W[b] - x0) * sx, bz = (W[b + 2] - z0) * sz, cx = (W[c] - x0) * sx, cz = (W[c + 2] - z0) * sz;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 1e-6)), i1 = Math.min(n - 1, Math.floor(Math.max(ax, bx, cx) + 1e-6));
    const j0 = Math.max(0, Math.ceil(Math.min(az, bz, cz) - 1e-6)), j1 = Math.min(n - 1, Math.floor(Math.max(az, bz, cz) + 1e-6));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const wa = ((bz - cz) * (i - cx) + (cx - bx) * (j - cz)) / d, wb = ((cz - az) * (i - cx) + (ax - cx) * (j - cz)) / d, wc = 1 - wa - wb;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      const y = wa * W[a + 1] + wb * W[b + 1] + wc * W[c + 1]; if (y > H[j * n + i]) H[j * n + i] = y;
    }
  }
  Sl.tx0 = x0; Sl.tz0 = z0; Sl.tsx = sx; Sl.tsz = sz;
}
function slabTopAt(Sl, lx, lz) {
  const n = SLAB_GN, fx = (lx - Sl.tx0) * Sl.tsx, fz = (lz - Sl.tz0) * Sl.tsz;
  if (!(fx >= 0 && fz >= 0 && fx < n - 1 && fz < n - 1)) return NaN;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, H = Sl.TH, a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
  if (a < -1e8 || b < -1e8 || c < -1e8 || d < -1e8) return NaN;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
// her drawn shell's top under world (x, z), through her body now (e, n: its matrix and inverse), two passes as shellTopW; NaN off her
function slabShell(Sl, e, n, x, z) {
  let wy = e[13];
  for (let it = 0; it < 2; it++) {
    const lx = n[0] * x + n[4] * wy + n[8] * z + n[12], lz = n[2] * x + n[6] * wy + n[10] * z + n[14];
    const h = slabTopAt(Sl, lx, lz); if (h !== h) return NaN;
    wy = e[1] * lx + e[5] * h + e[9] * lz + e[13];
  }
  return wy;
}
function slabSurf(L, MD, e, x, z) {
  const t = terrainH(x, z, L.idx), m = moundY(MD, x, z), sh = slabShell(L.slabs, e, _sInv.elements, x, z);
  const g = m > t ? m : t;
  _sOnShell = sh === sh && sh > g;
  return _sOnShell ? sh : g;
}
// THE CRACK: the pieces laid over her exposed back (crackBeat, the wake's first rising frame): along the strip's length, jittered across it,
// each pushed outward across her back (her local +-x) and spinning slowly; its colour the dune's at the strip's edge on that bearing
export function slabsBreak(L) {
  const Sl = L.slabs, MD = L.mound; if (!Sl || !MD) return;
  // (seeded: the same crack every rise, so a probe's run and a still can be repeated)
  const S = Sl.S, n = Sl.n, R = L.R, nb = MD.COLS, CA = MD.geo.attributes.color.array, rnd = seededRand(0xC4AC + L.idx);
  L.body.updateMatrixWorld(true); _sInv.copy(L.body.matrixWorld).invert();
  const e = L.body.matrixWorld.elements;
  for (let k = 0; k < n; k++) {
    const f = (k + 0.2 + 0.6 * rnd()) / n, lz = MD.crestZ + (f - 0.5) * BURY.crestL / R * 0.85, side = (k & 1) ? 1 : -1, lx = side * (0.05 + 0.95 * rnd()) * BURY.crestW / R * 0.32;
    const x = MD.cx + (lx * MD.c + lz * MD.s) * R, z = MD.cz + (-lx * MD.s + lz * MD.c) * R, o = k * SS;
    S[o] = x; S[o + 1] = z;
    const sp = 0.5 + 0.7 * rnd(); S[o + 2] = side * MD.c * sp; S[o + 3] = -side * MD.s * sp;
    S[o + 4] = rnd() * 6.283; S[o + 5] = (rnd() - 0.5) * 1.2; S[o + 6] = 0; S[o + 7] = SLAB_T - 0.5 * Sl.LO[k]; S[o + 8] = 1;
    S[o + 9] = slabSurf(L, MD, e, x, z); S[o + 10] = S[o + 9]; S[o + 11] = 0;
    // the dune's colour channels at the strip's edge on this piece's bearing (ring 1, the sand nearest the rock)
    let bj = 0, bd = 1e9;
    for (let j = 0; j < nb; j++) { const q = (nb + j) * 3, d = (MD.P[q] - x) ** 2 + (MD.P[q + 2] - z) ** 2; if (d < bd) { bd = d; bj = j; } }
    // (r the cavity AO, darkened under the clod and toward its rim; g the rock bias, held low: it is silt; b the height over the basin).
    // Read off the dune's OPEN flank on that bearing (ring NR - 4): ring 1's cavity is darkened toward her (fitMound), and clods coloured
    // from it drew as dark stones on her back (stills t7b-dev-d)
    const q = ((MD.NR - 4) * nb + bj) * 3;
    for (let i = k * Sl.nv, i1 = (k + 1) * Sl.nv; i < i1; i++) {
      const up = Sl.LN[i * 3 + 1];
      Sl.C[i * 3] = CA[q] * (0.45 + 0.55 * Math.max(0, Math.min(1, (up - 0.55) / 0.4))); Sl.C[i * 3 + 1] = Math.min(CA[q + 1], 0.25); Sl.C[i * 3 + 2] = CA[q + 2];
    }
  }
  Sl.geo.attributes.color.needsUpdate = true;
  Sl.geo.boundingSphere.center.set(MD.bx, MD.mw[13], MD.bz); Sl.geo.boundingSphere.radius = BURY.crestL * 0.5 + 12;
  Sl.t = 0; Sl.on = true; Sl.mesh.visible = true;
  slabWrite(L, 0);
}
// a frame of the slabs (updateBrooder, after poseAll: her body's matrix is this frame's), from the crack until SLAB_T
export function slabTick(L, dt) {
  const Sl = L.slabs; if (!Sl || !Sl.on) return;
  Sl.t += dt;
  if (Sl.t >= SLAB_T) { slabsHide(L); return; }
  slabWrite(L, dt);
}
function slabWrite(L, dt) {
  const Sl = L.slabs, MD = L.mound, S = Sl.S, nv = Sl.nv, P = Sl.P, N = Sl.N, LP = Sl.LP, LN = Sl.LN, e = L.body.matrixWorld.elements;
  if (dt > 0) _sInv.copy(L.body.matrixWorld).invert();
  for (let k = 0; k < Sl.n; k++) {
    const o = k * SS, i0 = k * nv;
    if (!S[o + 8]) continue;
    S[o + 6] += dt;
    const age = S[o + 6], x = S[o], z = S[o + 1];
    // down the slope of what is under it: g along the surface's fall, drag, at most SLAB_VMAX (it slides; it does not fly)
    const h = 0.35, g0 = slabSurf(L, MD, e, x, z), onShell = _sOnShell, gx = (slabSurf(L, MD, e, x + h, z) - g0) / h, gz = (slabSurf(L, MD, e, x, z + h) - g0) / h;
    if (dt > 0) {
      S[o + 2] += (-SLAB_G * gx / (1 + gx * gx + gz * gz) - SLAB_DRAG * S[o + 2]) * dt; S[o + 3] += (-SLAB_G * gz / (1 + gx * gx + gz * gz) - SLAB_DRAG * S[o + 3]) * dt;
      const sp = Math.hypot(S[o + 2], S[o + 3]); if (sp > SLAB_VMAX) { S[o + 2] *= SLAB_VMAX / sp; S[o + 3] *= SLAB_VMAX / sp; }
      S[o] += S[o + 2] * dt; S[o + 1] += S[o + 3] * dt; S[o + 4] += S[o + 5] * dt;
    }
    // lying on the surface: its up the surface's normal, turned about it
    _sn.set(-gx, 1, -gz).normalize();
    _sq.setFromUnitVectors(_sUp, _sn).multiply(_sq2.setFromAxisAngle(_sUp, S[o + 4]));
    // crumbling: over its last 0.6 s it shrinks to nothing (and sheds a puff or two)
    const cr = Math.max(0, Math.min(1, (S[o + 7] - age) / 0.6)), sc = cr * cr * (3 - 2 * cr);
    // its lowest vertex (rotated, scaled) and the surface under that vertex
    let ly = 1e9, lx = 0, lz = 0;
    for (let i = i0; i < i0 + nv; i++) { _slv.set(LP[i * 3], LP[i * 3 + 1], LP[i * 3 + 2]).applyQuaternion(_sq); if (_slv.y < ly) { ly = _slv.y; lx = _slv.x; lz = _slv.z; } }
    // (the lowest of five reads round it, SLAB_FOOT u apart: a clod's lowest point settles into a crevice of her shell the grid's cells
    // bridge, rather than hang over it; but never more than SLAB_DIP u under the read at the vertex itself: fix round 2, at a lip of her
    // shell (a step 0.4-0.7 u down within 0.15 u, measured on f08a683) the lowest read sank a piece 0.45 u into her where it stood:
    // burial-probe rise (iShell) 0.348 u at t 1.683 s, piece 7)
    const nx = S[o] + lx * sc, nz = S[o + 1] + lz * sc;
    const g0c = slabSurf(L, MD, e, nx, nz), c0Shell = _sOnShell;
    let gl = g0c, lowShell = c0Shell, gh = g0c;
    for (let q = 0; q < 4; q++) { const v = slabSurf(L, MD, e, nx + FOOT_X[q], nz + FOOT_Z[q]); if (v < gl) { gl = v; lowShell = _sOnShell; } if (v > gh) gh = v; }
    if (gl < g0c - SLAB_DIP) { gl = g0c - SLAB_DIP; lowShell = c0Shell; }
    // a ledge under it (the surface fell away more than SLAB_LEDGE u since last frame), or a STEP under its lowest point (the five reads span more
    // than SLAB_STEP u: a lip or wall of her shell, where no seat both keeps it out of her and off the water; fix round 2, a piece at a wall,
    // ny 0.13, read 0.30 u into her): it bursts into silt rather than hang in the water or sit in her
    if (dt > 0 && (gl < S[o + 9] - SLAB_LEDGE || gh - gl > SLAB_STEP || sc <= 0.001)) {
      if (sc > 0.001) emitSlabDust(S[o], S[o + 10], S[o + 1], BURY.dust.ledge, 1.8);
      S[o + 8] = 0;
      for (let i = i0; i < i0 + nv; i++) { P[i * 3] = S[o]; P[i * 3 + 1] = S[o + 10]; P[i * 3 + 2] = S[o + 1]; }
      continue;
    }
    S[o + 9] = gl;
    // on the sand (not her shell) it sinks into it once it has slid a while
    const sink = !lowShell && !onShell ? Math.max(0, age - 0.8) * SLAB_SINK : 0;
    const cy = gl - ly * sc - sink;
    S[o + 10] = cy;
    if (sc < 0.6 && S[o + 11] < 1) { S[o + 11] = 1; emitSlabDust(S[o], cy, S[o + 1], BURY.dust.crumble, 1.2); }
    for (let i = i0; i < i0 + nv; i++) {
      _slv.set(LP[i * 3], LP[i * 3 + 1], LP[i * 3 + 2]).applyQuaternion(_sq);
      P[i * 3] = S[o] + _slv.x * sc; P[i * 3 + 1] = cy + _slv.y * sc; P[i * 3 + 2] = S[o + 1] + _slv.z * sc;
      _slv.set(LN[i * 3], LN[i * 3 + 1], LN[i * 3 + 2]).applyQuaternion(_sq);
      N[i * 3] = _slv.x; N[i * 3 + 1] = _slv.y; N[i * 3 + 2] = _slv.z;
    }
  }
  Sl.geo.attributes.position.needsUpdate = true; Sl.geo.attributes.normal.needsUpdate = true;
}
// the silt a crumbling piece sheds: the brooder's emitDust (footfx's puff pool), handed in by brooder.js (setSlabDust). The pool (420) is
// shared with the dune's streams and his boots; measured (M3, burial-probe rise info.dust, f6b4077, six placements): 1650-1850 puffs emitted in the
// 14 s after the wake, 280-514 of them over a slot whose puff was still alive (the first at 1.5-1.75 s), the oldest cut short; BURY.dust has since changed it
let emitSlabDust = () => {};
export function setSlabDust(f) { emitSlabDust = f; }

// ---- THE CRUST ----
// THE CRUST (spec §1 "The crest reads as stone"): her shell takes the hollow outcrops' rock shading - flora.js's rock: lib/textures.js
// rockMapSet(0) sampled triplanar at flora's two scales (R_DET 0.32, R_MAC 0.073), under the zone's rock hue - blended in by uBury,
// with sand settled in its hollows (the bake's ambient occlusion, on faces that look up), and on the rise's first beat its own
// fissure network cracks open along her (uCrack). A shading term on her body material, driven by uniforms: ONE program for every
// brooder build (installed at every site, uBury 0 off home; her body's lighting variants, four on the Task 4 head too, each carry it:
// burial-probe programs crustBoot), chained after the silhouette rim, its own key; the branch on uBury is
// uniform, so off home it costs a compare. (The procedural fallback shell gets none: it buries, it does not look like stone, which
// is acceptable for a fallback.) Its home cost (9 fetches per shell fragment; Task 5 review minor 2), measured Task 5b on the 6.5 u crest,
// look 'light': __bench.liveAB at z0b, crust on against uBury held at 0, 6 pairs x 3 s, two runs (headless host, vsync off): d (off - on)
// median -0.12 / +0.04 ms over frames of 8.0-8.6 ms, inside the harness's +-0.1-0.3 ms noise: no cost the harness can see
// (Task 5c, look 'sand': the cover adds a geometric normal, four derivatives and two octaves of value noise; the stone's three normal
// fetches are skipped while nrm is 0) the same liveAB at z0b, crust on against uBury held at 0, 6 pairs x 3 s, two runs (headless
// cdp.mjs host, vsync off): d median -0.01 / +0.07 ms over frames of 5.8-6.2 ms: inside the noise again
//   alb/nrm/rough  how far her albedo, normal and roughness go to the stone's at full burial; sand: the hollows' fill; crack: the
//                  crack's darkening
// (Task 7b) THE CRACK (uCrack = L.crackK: up over BURY.crackT s from the wake, times L.bury, so it goes with the sand): with the sand cover
// on (the 'sand' look, shipped) the crack opens only where sand lies on her, drifts or the dust veil between them (her bare steep shell has
// no crust to crack; on her up faces the veil is ~0.05-0.1 of cover, so the gate opens at 0.06: gated at 0.08-0.3 the network never drew,
// t7b-dev-ngate): the rock map's crevice channel
// (Task 5's network: polygonal plates, the look of a crust drying and splitting) sampled in her OWN frame (vCrO at the world scale, uCrackS:
// it rides her as she rises; triplanar weights off the world normal, true on her up faces, where the sand lies), widening with uCrack;
// in a crack the sand is taken off and the gap is dark. (Value-noise iso-lines were tried first: 1-3 codes of contrast, invisible in
// his light, stills t7b-dev-g/h.) The stone looks keep the network in the world, sampled where her body WAS at the crack (uCrackO: she
// rises up to 1.4 u while it shows). Branches on uniforms only: no program change; a fourth fetch set only while uCrack > 0 (~3.7 s)
//   sandC          the hollows' sand, a hex over the zone's silt hue (null = flora's silt, 0x2c3d4a at home: bluer and darker than the
//                  dune beside it); 0x3f4744 is zone 0's seabed silt (terrain.js zoneMat 0), so the sand in her hollows is the dune's
//                  own (Task 5 look-dev, trial 2 of 3, stills t5-try*: the best two, this and null, went to the controller)
// (Task 5b, Michael's checkpoint 2026-10-20: "her back had alot more rocky feeling"; the approved proposal: "ease off the stone shading
// so more of her own rough texture shows through ... two versions to compare: her own shell, and her shell lightly stoned over") TWO
// LOOKS behind one knob, CRUST.look (setCrust({ look })): 'shell' her own shell (crust 0 on the strip: no stone, no sand); 'light' her
// shell lightly stoned over (Task 5's stone at about half: alb 0.92 -> 0.45, nrm 0.85 -> 0.35, rough 0.9 -> 0.5, sand 0.7 -> 0.45). Both
// are uniforms of the one '|crust' program (crustTick): no program changes. The crack (the rise's first beat) is the same in both.
// Task 5's full stone stays a third look, 'stone', for the A/B.
// (Task 5c, Michael's second checkpoint 2026-10-20: "reads as a rock now, but it should be her shell but lightly covered in sand") the
// shipped look is 'sand': no stone (alb / nrm / rough 0: her own shell's colour and texture), and a COVER of the dune's silt (sandC)
// settled on her: uSandK = (cover, drift, dust, flat), 0 cover in every other look (their path is Task 5b's, unchanged). Where it
// lies: her GEOMETRIC normal facing up (nonPerturbedNormal: steep sides thin), her micro normal facing up, her convex edges bare (a
// signed curvature from the screen derivatives of that normal over world position: ridges and shard edges show through), pooled in
// her hollows (the bake's AO, the same signal as the hollow sand above, and concave curvature); broken by a generated 3D value noise
// (two octaves, ~2.5 u and ~0.7 u; drift sets its amplitude, not its size), sampled in her BODY's object space (vCrO: the sand lies ON her, so it rides her rise and her breath; vCrW stays for the stone triplanar) and THRESHOLDED at 1 - uBury * cover, so it reads as drifts with edges, not a
// wash; a thin dust veil (dust) on her up faces between them. Under it she is matte (roughness 0.95) and her relief is flattened by
// flat. ONE value takes it off: uBury (L.bury): as it falls the threshold climbs, so the sides and thin drifts go first and the
// hollows last; the drifts also fade out over uBury 0.25 -> 0 (the field reaches ~1.4 in a hollow, over the threshold's 1.0, so
// without that fade a patch would hold to the gate and pop off), and at 0 none is left (the rise, Tasks 7a/7b/12, needs no new path). Off home L.bury is 0: the branch is not taken.
// Look-dev (stills t5c-dev/, his light weather 0.5): cover 0.45 / drift 0.6 / dust 0.15 / flat 0.4 laid a smooth sand plate over
// her tops (her shell gone from above); cover 0.15 / drift 1 / dust 0 / flat 0.25 barely showed (Task 5b's bare shell); shipped
// cover 0.3 / drift 1 / dust 0.1 / flat 0.3: drifts on her tops and in her hollows, her plates and ridges showing between.
export const CRUST_LOOKS = { shell: { alb: 0, nrm: 0, rough: 0, sand: 0, cover: 0, drift: 0, dust: 0, flat: 0 }, light: { alb: 0.45, nrm: 0.35, rough: 0.5, sand: 0.45, cover: 0, drift: 0, dust: 0, flat: 0 },
  stone: { alb: 0.92, nrm: 0.85, rough: 0.9, sand: 0.7, cover: 0, drift: 0, dust: 0, flat: 0 },
  sand: { alb: 0, nrm: 0, rough: 0, sand: 0, cover: 0.3, drift: 1.0, dust: 0.1, flat: 0.3 } };
export const CRUST = { look: 'sand', ...CRUST_LOOKS.sand, crack: 0.85, sandC: 0x3f4744, driftWorld: 1 };
const CRUST_HEAD = `
varying vec3 vCrW, vCrO;
uniform float uBury, uCrack;
uniform vec3 uCrackO;
uniform float uCrackS;
uniform sampler2D uCrustPack, uCrustNrm;
uniform vec3 uRockC, uSand;
uniform vec4 uCrustK, uSandK;
uniform float uCrustRough;
uniform vec4 uWound;
uniform vec3 uWoundN, uWoundD;
uniform float uWoundS;
uniform vec4 uShed;
uniform vec3 uDownO;
uniform float uDriftS;
float crPaint = 0.0;
vec4 crTri(sampler2D t, vec3 p, vec3 bw, float f) { return texture2D(t, p.zy * f) * bw.x + texture2D(t, p.xz * f) * bw.y + texture2D(t, p.xy * f) * bw.z; }
vec3 crNrm(vec3 p, vec3 n, vec3 bw, float f, float str) {
  vec3 tx = texture2D(uCrustNrm, p.zy * f).xyz * 2.0 - 1.0, ty = texture2D(uCrustNrm, p.xz * f).xyz * 2.0 - 1.0, tz = texture2D(uCrustNrm, p.xy * f).xyz * 2.0 - 1.0;
  vec3 wx = vec3(tx.xy * str + n.zy, abs(tx.z) * n.x), wy = vec3(ty.xy * str + n.xz, abs(ty.z) * n.y), wz = vec3(tz.xy * str + n.xy, abs(tz.z) * n.z);
  return normalize(wx.zyx * bw.x + wy.xzy * bw.y + wz.xyz * bw.z);
}
float crH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float crVN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(crH(i), crH(i + vec3(1.0, 0.0, 0.0)), f.x), mix(crH(i + vec3(0.0, 1.0, 0.0)), crH(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(crH(i + vec3(0.0, 0.0, 1.0)), crH(i + vec3(1.0, 0.0, 1.0)), f.x), mix(crH(i + vec3(0.0, 1.0, 1.0)), crH(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}`;
const CRUST_APPLY = `
if (uBury > 0.001 || uShed.x > 0.001) {
  vec3 crWN = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 crBW = pow(abs(crWN), vec3(4.0)); crBW /= (crBW.x + crBW.y + crBW.z);
  vec4 crPd = crTri(uCrustPack, vCrW, crBW, 0.32), crPc = crTri(uCrustPack, vCrW + vec3(7.3, 2.9, 5.1), crBW, 0.073);
  float crAlb = (crPd.r * 1.6) * mix(1.0, crPc.r * 1.6, 0.55);
  float crK = uBury * uCrustK.x;
  diffuseColor.rgb = mix(diffuseColor.rgb, uRockC * crAlb, crK);
  if (crK * uCrustK.y > 0.001) {
    vec3 crN2 = crNrm(vCrW, crWN, crBW, 0.32, 0.9);
    normal = normalize(mix(normal, normalize((viewMatrix * vec4(crN2, 0.0)).xyz), crK * uCrustK.y));
  }
  roughnessFactor = mix(roughnessFactor, uCrustRough, crK);
  float crAO = 1.0;
  #ifdef USE_AOMAP
    crAO = texture2D(aoMap, vAoMapUv).r;
  #endif
  float crSand = uBury * uCrustK.z * smoothstep(0.2, 0.7, crWN.y) * (1.0 - smoothstep(0.35, 0.85, crAO));
  if (uSandK.x > 0.001) {
    vec3 crGN = normalize(inverseTransformDirection(nonPerturbedNormal, viewMatrix));
    vec3 crDx = dFdx(vCrW), crDy = dFdy(vCrW);
    float crCv = (dot(dFdx(crGN), crDx) + dot(dFdy(crGN), crDy)) / max(dot(crDx, crDx) + dot(crDy, crDy), 1e-6);
    float crUp = smoothstep(0.3, 0.85, crGN.y) * smoothstep(0.15, 0.6, crWN.y) * (1.0 - smoothstep(0.8, 2.5, crCv));
    float crPool = max(1.0 - smoothstep(0.35, 0.85, crAO), smoothstep(0.3, 1.5, -crCv)) * smoothstep(0.0, 0.3, crGN.y);
    // (sandrise) THE SHED: the sand on her (uShed.x, crSB) has its own clock from the crack (uShed.y, crP: 0 asleep and digging in at
    // bury 1, 1 once it has run): at crP 0 every line here is the shipped cover, read off uBury's value. Shedding, the field is read
    // UPSLOPE of where it lies by how far the sand has run (uShed.z, object units, steep faces run, flats hold), drawn out along the
    // fall line into streams, and each spot lets go when the shed passes its own time (crLeave: steep faces first, then the flats, the
    // hollows never): the threshold climbs THERE, so a drift shrinks from its thin edges to its core and runs, it does not fade
    float crSB = uShed.x, crP = uShed.y, crSteep = 1.0 - crGN.y;
    vec3 crQ = vCrO * uDriftS;
    float crStr = 0.0;
    if (crP > 0.0) {
      float crSl = smoothstep(0.12, 0.55, crSteep);
      crQ -= uDownO * (uShed.z * crSl);
      crStr = crSl * min(1.0, crP * 3.0);
      crQ -= uDownO * (dot(crQ, uDownO) * 0.7 * crStr);
    }
    float crN0 = crVN(crQ * vec3(0.4, 0.55, 0.4)), crN1 = crVN(crQ * 1.4 + 17.0);
    float crS = crUp * 0.6 + crPool * 0.4 + (crN0 * 0.65 + crN1 * 0.35 - 0.5) * 1.5 * uSandK.y;
    float crT = 1.0 - crSB * uSandK.x;
    float crVeil = crSB * uSandK.z * crUp;
    if (crP > 0.0) {
      float crN2 = crVN(crQ * 0.8 + 5.0);
      crS += (crN2 - 0.5) * 0.7 * crStr;
      float crLeave = 0.22 + 0.7 * crGN.y * crGN.y + 0.9 * crPool + 0.4 * (crN1 - 0.5);
      crT += 1.3 * smoothstep(crLeave - 0.3, crLeave, crP);
      crVeil *= 1.0 - smoothstep(0.0, 0.45, crP);
    }
    float crCov = smoothstep(crT - 0.1, crT + 0.1, crS) * 0.9 * min(1.0, crSB * 4.0) + crVeil;
    crSand = max(crSand, min(crCov, 0.92));
    // (Task 7b) THE CRUST CRACKS: the sand on her breaks into plates along the rock map's crevice channel (crPk.b, the shipped fissure
    // network, sampled triplanar in her OWN frame: vCrO, it rides her as she rises), the lines widening with uCrack; in a line the sand is gone and the gap is dark
    float crGap = 0.0;
    if (uCrack > 0.001) {
      vec4 crPk = crTri(uCrustPack, vCrO, crBW, uCrackS);
      crGap = min(1.0, uCrack * uCrustK.w * (1.0 - smoothstep(0.24, 0.40 + 0.25 * uCrack, crPk.b)) * smoothstep(0.0, 0.06, crSand));
      crSand *= 1.0 - crGap;
    }
    // (oldwound) THE OLD WOUND, painted into her shell where the iron was (uWound: the seam's outer surface in her object space, w on;
    // uWoundN its normal, uWoundD world down, both in her object space; uWoundS object units per world unit): only on a remembered build
    // at home (w 0 everywhere else, a uniform branch). Round the puncture the sand has given way and the shell is broken and stained dark
    // with old rust (crWb, ~0.7 u, a ragged edge), a ridge of pale healed callus rims it (crWc), fractures run out of it (crWf), the
    // puncture itself is a black pit (crWp), and a rust weep has run down from it (crWr: a tongue, world down, ~1.5 u, on whatever of her lies within 0.9 u of its plane)
    float crWb = 0.0, crWp = 0.0, crWf = 0.0, crWc = 0.0, crWr = 0.0, crWv = 0.0;
    if (uWound.w > 0.001) {
      vec3 wq = (vCrO - uWound.xyz) / uWoundS;
      vec3 wnh = normalize(uWoundN - uWoundD * dot(uWoundN, uWoundD) + vec3(1e-5)), wsd = normalize(cross(uWoundD, wnh));
      float wy = dot(wq, uWoundD), wx = dot(wq, wsd), wd = dot(wq, wnh);
      float wR = length(wq), wz = crVN(wq * 3.3 + 11.0), wz2 = crVN(wq * 9.0 + 3.0);
      float wK = uWound.w * smoothstep(0.0, 0.3, uBury);
      float wrb = 0.65 + 0.3 * wz;
      crWb = wK * (1.0 - smoothstep(wrb - 0.12, wrb, wR));
      float wrp = 0.09 + 0.06 * wz2;
      crWp = wK * (1.0 - smoothstep(wrp, wrp + 0.04, wR));
      float wa = atan(wx, wy);
      crWf = wK * pow(abs(sin(wa * 3.5 + wz * 4.0)), 14.0) * (1.0 - smoothstep(0.15, 0.6 + 0.15 * wz2, wR)) * step(0.08, wR);
      crWc = wK * exp(-pow((wR - (wrb - 0.08)) / 0.07, 2.0));
      float wu = clamp(wy / 1.6, 0.0, 1.0), wob = 0.06 * sin(wy * 3.1 + 1.7) + 0.03 * sin(wy * 8.0);
      float wwd = mix(0.24, 0.07, wu) * (0.75 + 0.5 * wz2);
      crWr = wK * smoothstep(0.0, 0.2, wy) * (1.0 - smoothstep(1.0, 1.6, wy)) * (1.0 - smoothstep(wwd * 0.5, wwd, abs(wx - wob)))
        * (1.0 - smoothstep(0.6, 0.9, abs(wd)));
      crWv = wz2;
      crSand *= 1.0 - max(crWb, crWr);
    }
    crPaint = crSand;
    roughnessFactor = mix(roughnessFactor, 0.95, crSand);
    normal = normalize(mix(normal, nonPerturbedNormal, crSand * uSandK.w));
    diffuseColor.rgb = mix(diffuseColor.rgb, uSand * (0.85 + 0.3 * crN1), crSand);
    diffuseColor.rgb *= 1.0 - 0.85 * crGap;
    if (uWound.w > 0.001) {
      // (absolute colours, not a tint: under the sand her own shell is paler than the sand, so a tint of what the cleared patch shows
      // came out no darker than the crust round it; anchor read, first build)
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.032, 0.016, 0.009) * (0.8 + 0.4 * crWv), crWb * 0.9);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.028, 0.01), min(1.0, crWr) * 0.9);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.33, 0.27), crWc * 0.85);
      diffuseColor.rgb *= 1.0 - 0.85 * crWf;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.004, 0.003, 0.002), crWp);
      roughnessFactor = mix(roughnessFactor, 0.92, crWb);
      roughnessFactor = mix(roughnessFactor, 0.6, crWr);
      // (the probe's paint: burial-probe wound sets w 2 for ONE capture to find the wound's pixels; the game never writes over 1)
      if (uWound.w > 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.0, 1.0), step(0.02, max(max(crWb, crWr), max(crWc, crWp))));
    }
  } else {
    diffuseColor.rgb = mix(diffuseColor.rgb, uSand, crSand);
    // (the stone looks: the shipped fissure network off the rock map's crevice channel, where her body was at the crack: uCrackO)
    if (uCrack > 0.001) {
      vec4 crPk = crTri(uCrustPack, vCrW - uCrackO, crBW, 0.32);
      diffuseColor.rgb *= 1.0 - 0.85 * uCrack * uCrustK.w * (1.0 - smoothstep(0.24, 0.40 + 0.25 * uCrack, crPk.b));
    }
  }
}`;
// (sandrise) the probe's PAINT (uShed.w 1, sandpix-probe only; the game never writes it): every fragment of her body's material drawn in
// one of three pure hues after the material's own light and fog: RED where the sand cover is over the threshold (uShed.w - 1; paint(on, thr), default 0.3) on a face that looks up, BLUE a bare
// face that looks up, GREEN any other face of hers. Read through the whole post chain by the dominant channel (the post bypass's frozen
// capture is black on the plugged clock: burial-probe's wound header), so a capture reads the cover as drawn, through the depth test
const CRUST_PAINT = 'if (uShed.w > 0.5) { float crPU = inverseTransformDirection(nonPerturbedNormal, viewMatrix).y; gl_FragColor = crPU > 0.5 ? (crPaint > uShed.w - 1.0 ? vec4(1.0, 0.0, 0.0, 1.0) : vec4(0.0, 0.0, 1.0, 1.0)) : vec4(0.0, 1.0, 0.0, 1.0); }';
export function crustTerm(L, m, rockSet, rockC, sandC) {
  const u = { uBury: { value: 0 }, uCrack: { value: 0 }, uCrackO: { value: V3() }, uCrackS: { value: 0.32 * L.R }, uCrustPack: { value: rockSet.pack }, uCrustNrm: { value: rockSet.nrm },
    uRockC: { value: new THREE.Color(rockC) }, uSand: { value: new THREE.Color(sandC) },
    uCrustK: { value: new THREE.Vector4(CRUST.alb, CRUST.nrm, CRUST.sand, CRUST.crack) }, uCrustRough: { value: CRUST.rough },
    uSandK: { value: new THREE.Vector4(CRUST.cover, CRUST.drift, CRUST.dust, CRUST.flat) },
    uWound: { value: new THREE.Vector4(0, 0, 0, 0) }, uWoundN: { value: V3(0, 0, 1) }, uWoundD: { value: V3(0, -1, 0) }, uWoundS: { value: 1 },
    uShed: { value: new THREE.Vector4(0, 0, 0, 0) }, uDownO: { value: V3(0, -1, 0) }, uDriftS: { value: 1 } };
  L.crustU = u; L.crustSilt = new THREE.Color(sandC);   // (the zone's silt: setCrust({ sandC: null }) goes back to it)
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCrW, vCrO;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCrW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCrO = transformed;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + CRUST_HEAD)
      .replace('#include <lights_physical_fragment>', CRUST_APPLY + '\n#include <lights_physical_fragment>')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + CRUST_PAINT);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|crust';
  m.needsUpdate = true;
}
// (oldwound) THE OLD WOUND's place in the crust (harpoon.js seat, a remembered build at home): p / n the seam's OUTER surface point and
// its normal (world, her dormant pose), into her shell's object space, where the crust samples it (vCrO: it rides her). on false clears
// it (w 0: the branch is not taken). (A pure down normal leaves the weep's side axis to the shader's epsilon.) No-op before the sculpt lands (no crust yet): seat runs again then. Uniform writes only
const _wInv = new THREE.Matrix4();
export function setCrustWound(L, p, n, on) {
  const rec = on ? crustWoundRec(L, p, n) : null;
  return on ? setCrustWoundRec(L, rec, true) : setCrustWoundRec(L, null, false);
}
// (oldwound) the same, split: crustWoundRec measures the place once (in her shell's object space, so it rides her body through a rise and
// a dig-in's re-bed: harpoon.js seat, her dormant pose) and setCrustWoundRec writes it, uniform writes only (a heal mid-dig-in costs nothing)
export function crustWoundRec(L, p, n, out = null) {
  const sh = L.parts && L.parts.shell;
  if (!L.crustU || !L.crustU.uWound || !sh) return null;
  sh.updateMatrixWorld(true);
  _wInv.copy(sh.matrixWorld).invert();
  const r = out || { c: V3(), n: V3(), d: V3(), s: 1 };
  r.c.copy(p).applyMatrix4(_wInv);
  r.n.copy(n).transformDirection(_wInv);
  r.d.set(0, -1, 0).transformDirection(_wInv);   // world down (the weep runs down from it)
  r.s = 1 / sh.matrixWorld.getMaxScaleOnAxis();
  return r;
}
export function setCrustWoundRec(L, rec, on) {
  const u = L.crustU;
  if (!u || !u.uWound) return false;
  if (!on || !rec) { u.uWound.value.w = 0; return !on; }
  u.uWound.value.set(rec.c.x, rec.c.y, rec.c.z, 1);
  u.uWoundN.value.copy(rec.n); u.uWoundD.value.copy(rec.d); u.uWoundS.value = rec.s;
  return true;
}
// (sandrise, 2026-10-31; card roadmap/velkath-sand-rise.md; Michael: "we lost that she is partially covered in sand and when she rises the
// sand rolls off in a slight dust cloud", approved "yes do all three for the sand") THE SHED: the sand on her shell no longer goes with
// L.bury (which reaches 0 at ~3.7 s, riseU, so she stood clean); it has its own clock from the crack. Two values, written into the crust's
// uShed by crustTick: L.sandS, the sand on her (the cover's own "bury": the threshold and the fades read it in place of uBury), and L.shedP,
// the shed's progress (0 .. 1 over T s from the crack). Asleep and dug in, shedP 0 and sandS = L.bury: the shipped cover, value for value.
// Shedding, each spot of her shell lets go at its own time (the shader's crLeave: steep faces first, then her flats, her hollows not at all),
// the drifts run down the fall line `run` u (accelerating, run x shedP^2) drawn out into streams, and what lies in her hollows when it has run
// STAYS (the residual) until she has stood `hold` s, then drifts off over `restT` s (sandS eased to 0: the cover's own fade, no pop). Digging
// in, shedP eases back to 0 as bury rises and sandS = max(what was left, bury): the dig-in ends on the asleep cover exactly.
// Reference (out/report.md): sand on a body lifting off the bed avalanches where the slope passes repose (~30-35 deg) and runs in sheets off
// the high edges; the flats keep it longer and the hollows keep it.
//   T s, the shed (from the crack; her rise's bury runs out at ~3.7 s); run u, how far a drift on a steep face has slid by the end; hold / restT s
export const SHED = { on: 1, T: 3.8, pow: 1.4, run: 3.0, hold: 20, restT: 90 };
const _shInv = new THREE.Matrix4();
// the shed's progress from the crack: slow to start (the sand holds through the crack and her first heave), then it runs (pow)
function shedCurve(t) { const x = Math.min(1, Math.max(0, t / SHED.T)); return Math.pow(x, SHED.pow); }
export function shedTick(L, dt) {
  if (!L.buried || !(SHED.on > 0)) { L.shedP = 0; L.sandS = L.bury; L.shedT = 0; L.shedDig = false; return; }
  if (L.digging || (L.dugIn && !L.cracked)) {
    if (!L.shedDig) { L.shedDig = true; L.shedP0 = L.shedP || 0; L.sandS0 = L.sandS ?? 0; }
    L.shedP = L.shedP0 * (1 - L.bury); L.sandS = Math.max(L.sandS0, L.bury);
    return;
  }
  L.shedDig = false;
  if (L.dormant || !L.cracked) { L.shedT = 0; L.shedP = 0; L.sandS = L.bury; L.stoodT = 0; return; }
  L.shedT = (L.shedT || 0) + dt;
  if (!L.hasStood) { L.shedP = shedCurve(L.shedT); L.sandS = 1; L.stoodT = 0; return; }
  // stood: the shed runs out (a lab calm mid-rise jumps her to stood: eased, never snapped), then the residual's slow drift off
  L.shedP = Math.min(1, Math.max(shedCurve(L.shedT), (L.shedP || 0) + dt / 0.6));
  L.stoodT = (L.stoodT || 0) + dt;
  const r = Math.min(1, Math.max(0, (L.stoodT - SHED.hold) / SHED.restT));
  L.sandS = Math.min(L.sandS ?? 1, 1 - r * r * (3 - 2 * r));
}
// the crust's uniforms each frame (brooder.js updateBrooder): uniform writes only, never a program change
export function crustTick(L) {
  const u = L.crustU;
  // (M6) uCrack and uCrackO lag the body one frame: crustTick runs where updateBrooder calls it, before this frame's poseAll has moved her
  // body (L.crackK is last frame's too), so the network trails her by a frame's rise (<= 8 u/s x 1/60 = 0.13 u, bar (d)); cosmetic
  u.uBury.value = L.bury; u.uCrack.value = L.crackK || 0;
  // (sandrise) the shed (shedTick): the sand on her, its progress and the run (object units); the crack drawn on the sand still on her,
  // closing as the shed ends (L.crackK itself is unchanged: it falls with bury and is 0 at the stand)
  const sp = L.shedP || 0, ss = L.buried ? (L.sandS ?? L.bury) : 0, sh = L.parts && L.parts.shell;
  if (sp > 0 && sh) {
    _shInv.copy(sh.matrixWorld).invert();
    u.uDownO.value.set(0, -1, 0).transformDirection(_shInv);
    u.uShed.value.set(ss, sp, SHED.run * sp * sp, u.uShed.value.w);
    if (L.cracked) u.uCrack.value = Math.min(1, (L.crackT || 0) / BURY.crackT) * ss * (1 - smoothK(0.55, 1, sp));
  } else u.uShed.value.set(ss, 0, 0, u.uShed.value.w);
  // (sandrise) THE DRIFTS' SCALE: the cover's noise reads vCrO, her shell's OBJECT space, and the sculpted shell is drawn at x15.4 (L.R): at
  // the shipped scale (driftWorld 0, uDriftS 1) its two octaves span her whole shell in under a cell, so the field is ~one value over her and
  // the threshold left only the thin veil (sandpix-probe: asleep, the cover over 0.3 on 0 of ~26k up-facing pixels of her strip). driftWorld 1
  // reads it at the world scale the look-dev comment describes (~2.5 u and ~0.7 u), so the drifts lie in patches with edges
  u.uDriftS.value = CRUST.driftWorld > 0 && sh ? sh.matrixWorld.getMaxScaleOnAxis() : 1;
  // (Task 7b) the crack's network rides her: sampled where her body was at the crack (vCrW less how far she has risen since)
  if (L.crackK > 0 && L.crackO0) u.uCrackO.value.subVectors(L.body.position, L.crackO0); else u.uCrackO.value.set(0, 0, 0);
  u.uCrustK.value.set(CRUST.alb, CRUST.nrm, CRUST.sand, CRUST.crack); u.uCrustRough.value = CRUST.rough;
  u.uSandK.value.set(CRUST.cover, CRUST.drift, CRUST.dust, CRUST.flat);
  if (CRUST.sandC != null) u.uSand.value.setHex(CRUST.sandC); else u.uSand.value.copy(L.crustSilt);
}

// ---- THE TELL ----
const ease = x => x * x * (3 - 2 * x);
function smoothK(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
const TRICKLE_J = [-2, 0, 2];                         // the trickle's three bearings round the nearest one (module scratch, not a literal per breath)
// THE TELL (spec §1): every 8-10 s the sand over her lifts a few centimetres and settles; a thin trickle of silt slides off the
// crest's edge with each breath. Only a careful eye catches it: the lift is drawn only with the lens within BURY.breath.draw u of the strip's edge (a
// few cm is nothing past that), the trickle only with him within BURY.breath.near u of the strip's edge.
export function breathTick(L, dt, player, camPos, emitDust) {
  const B = BURY.breath, MD = L.mound;
  if (!MD || !(L.dormant || L.dugIn)) { L.breathY = 0; return; }   // (dug back in after a calm she breathes again: Task 12)
  // (before her first breath there is nothing to trickle: the clock starts as if the last breath's trickle were spent, else his
  // first frame within `near` of a fresh build would book a trickle with no breath)
  if (L.brAge === undefined) { L.brAge = 99; L.brTrk = true; }
  if ((L.brT = (L.brT ?? 2) - dt) <= 0) { L.brT = B.period[0] + (B.period[1] - B.period[0]) * Math.random(); L.brAge = 0; L.brTrk = false; }
  L.brAge += dt;
  const a = L.brAge, y = a < B.up ? ease(a / B.up) : a < B.up + B.down ? 1 - ease((a - B.up) / B.down) : 0;
  // (the lens within `draw` u of the strip's edge on its own bearing, ring 0's straight edge there: locate / ringR, no allocation. Task 5b:
  // the centre's distance less crestL / 2 stood for it while the strip was 6 u wide; 20 u wide, him 6 u off its sand-side edge put the lens
  // 21.8-23.9 u from the centre and the breath was not drawn: burial-probe breath amp 0. From the edge, the lens trails him ~9 u, so draw
  // 18 = him within ~9 u, the spec's "about 8 u")
  locate(MD, camPos.x, camPos.z);
  const near = (_rho - ringR(MD, 0)) * MD.R < B.draw;
  L.breathY = near ? B.lift * y : 0;
  if (!L.brTrk && a >= B.up && player) {
    L.brTrk = true;
    let best = 1e9, bj = -1;                         // the strip's edge nearest him (ring 1)
    for (let j = 0; j < MD.COLS; j++) { const o = (MD.COLS + j) * 3, d = Math.hypot(MD.P[o] - player.pos.x, MD.P[o + 2] - player.pos.z); if (d < best) { best = d; bj = j; } }
    if (best < B.near) for (let q = 0; q < 3; q++) { const o = (MD.COLS + (bj + TRICKLE_J[q] + MD.COLS) % MD.COLS) * 3; emitDust(MD.P[o], MD.P[o + 1] + 0.05, MD.P[o + 2], 2, 0.3); }
    L.trickleN = (L.trickleN || 0) + (best < B.near ? 1 : 0);
  }
}

// THE GROWTH ON HER BACK, buried with her (velkath-buried-rock): the reef's triangles and the weed fronds whose root lies OUTSIDE the
// strip are hidden while she is buried (bury > 0.5); those on the exposed rock stay. Built at the fit (an event): the reef gets a second
// index holding only the strip's triangles, swapped in and out (no program changes); a weed frond is scaled to 0. Undone as she rises
// past bury 0.5, redone as she digs back in past it.
const _gm = new THREE.Matrix4(), _gp = V3();
export function prepGrowth(L, MD) { runAll(prepGrowthJ(L, MD)); }
// (Task 12) as a generator, for the dig-in's job (fitMoundJ's rule: her body's matrixWorld held at the fit pose by the caller)
export function* prepGrowthJ(L, MD) {
  const reef = L.parts.reef, weed = L.parts.weed;
  // a re-fit on the SAME growth (a re-bed at a new spot, the dig-in) first puts the full growth back: else the strip's index would be
  // taken for the full one and the zeroed fronds for the grown ones, and rising she would never get them back. The sculpt's landing
  // replaces the reef geometry AND rewrites the weed's matrices, so a new reef geometry means both are whole already.
  if (reef && L.reefIdx && L.reefIdx.geo === reef.geometry) buryGrowth(L, false);
  if (reef && reef.geometry.index) {
    const g = reef.geometry, ix = g.index.array, P = g.attributes.position, keep = [], hid = [];
    reef.updateMatrixWorld(true);
    for (let q = 0; q < ix.length; q += 3) {
      if (due()) yield;
      // kept only if ALL THREE corners lie in the strip: a triangle straddling its edge would leave a corner standing out of the
      // dune (and burial-probe's `reef` check books every drawn vertex outside the strip)
      let all = true;
      for (let k = 0; k < 3 && all; k++) { _gp.fromBufferAttribute(P, ix[q + k]).applyMatrix4(reef.matrixWorld); all = inStrip(MD, _gp.x, _gp.z); }
      if (all) keep.push(ix[q], ix[q + 1], ix[q + 2]); else hid.push(q);
    }
    // (Task 7b, M6) THE REVEAL ORDER: the hidden triangles by how far their centroid lies outside the strip's band (u; growReveal uncovers
    // them in that order from the crack), after the strip's own: drawn through a draw range, never a rebuilt buffer
    const key = new Float32Array(hid.length), cen = new Float32Array(hid.length * 3), ord = new Uint32Array(keep.length + hid.length * 3);
    ord.set(keep);
    const kk = hid.map(q => { let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 3; k++) { cx += P.getX(ix[q + k]); cy += P.getY(ix[q + k]); cz += P.getZ(ix[q + k]); }
      _gp.set(cx / 3, cy / 3, cz / 3).applyMatrix4(reef.matrixWorld); locate(MD, _gp.x, _gp.z);
      return [q, Math.max(0, (_rho - ringR(MD, 1)) * MD.R), cx / 3, cy / 3, cz / 3]; }).sort((a, b) => a[1] - b[1]);
    kk.forEach(([q, k, cx, cy, cz], i) => { ord[keep.length + i * 3] = ix[q]; ord[keep.length + i * 3 + 1] = ix[q + 1]; ord[keep.length + i * 3 + 2] = ix[q + 2]; key[i] = k; cen[i * 3] = cx; cen[i * 3 + 1] = cy; cen[i * 3 + 2] = cz; });
    L.reefIdx = { full: g.index, strip: new THREE.BufferAttribute(Uint32Array.from(keep), 1), geo: g, ordered: new THREE.BufferAttribute(ord, 1), nStrip: keep.length / 3, key, cen };
  }
  if (weed) {
    L.weedM0 = Float32Array.from(weed.instanceMatrix.array);
    L.weedOut = new Uint8Array(weed.count);
    weed.updateMatrixWorld(true);
    // a frond stays only if EVERY vertex of it lies in the strip, as a reef triangle does (Task 3a, measured: judged by its root, 22
    // vertices of fronds rooted near the strip's edge leaned out over the dune, the worst 2.0 u over the sand)
    // (Task 5b) and none of her own fronds over the iron: with the strip widened her rim tufts stand round the seam and hid the iron (seen
    // nearly end-on, ~30 px of pole at 3 u) from 3 and 6 u (stills t5b-dev/g2-h3 .. g5). A frond is buried with the rest if any vertex lies
    // within GROW.near u of the seam, or in the corridor his eye looks down at it from the sand: out from the seam along its normal's level
    // part, 0 .. GROW.sight[0] u, within GROW.sight[1] u of that line (a sphere of 3 u buried 24 of her 32 fronds on the strip; 1.5 u alone
    // left the ones rooted 2-3 u off it in the line of sight). The strip's new fronds keep GROW.clear off it already
    const WP = weed.geometry.attributes.position, Hs = L.harpoon && L.harpoon.seatOk ? L.harpoon.seamWorld() : null, nr2 = GROW.near * GROW.near;
    let snx = 0, snz = 0; if (Hs) { const hn = L.harpoon.normal, l = Math.hypot(hn.x, hn.z) || 1; snx = hn.x / l; snz = hn.z / l; }
    const overIron = p => { if (!Hs) return false; const dx = p.x - Hs.x, dy = p.y - Hs.y, dz = p.z - Hs.z; if (dx * dx + dy * dy + dz * dz < nr2) return true;
      const t = dx * snx + dz * snz; if (t < 0 || t > GROW.sight[0]) return false; const qx = dx - snx * t, qz = dz - snz * t; return qx * qx + dy * dy + qz * qz < GROW.sight[1] * GROW.sight[1]; };
    for (let k = 0; k < weed.count; k++) {
      if (dueNow()) yield;
      weed.getMatrixAt(k, _gm); _gm.premultiply(weed.matrixWorld);
      let all = true;
      for (let v = 0; v < WP.count && all; v++) { _gp.fromBufferAttribute(WP, v).applyMatrix4(_gm); all = inStrip(MD, _gp.x, _gp.z) && !overIron(_gp); }
      L.weedOut[k] = all ? 0 : 1;
    }
    // (Task 7b, M6) a hidden frond's reveal key: its root's distance outside the strip's band (u), as the reef's
    L.weedKey = new Float32Array(weed.count);
    for (let k = 0; k < weed.count; k++) { if (!L.weedOut[k]) continue; weed.getMatrixAt(k, _gm); _gp.setFromMatrixPosition(_gm.premultiply(weed.matrixWorld)); locate(MD, _gp.x, _gp.z); L.weedKey[k] = Math.max(0, (_rho - ringR(MD, 1)) * MD.R); }
  }
  let km = 0;
  if (L.reefIdx && L.reefIdx.key.length) km = L.reefIdx.key[L.reefIdx.key.length - 1];
  if (L.weedKey) for (let k = 0; k < L.weedKey.length; k++) if (L.weedKey[k] > km) km = L.weedKey[k];
  L.revMax = km + GROW.revRamp;
  L.growthBuried = -1;
}
// (Task 7b, M6: the growth's snap) Buried, the growth outside the strip is hidden (prepGrowth); measured on 31a3b94, 1150 of its 1346 reef
// triangles and 38 of its 53 fronds stand OUT of the drawn dune even at bury 1 (up to 1.3 u and 3.6 u: the cover is 0.3 u), so there is no
// moment of the rise when showing it all at once is not a pop (the shipped toggle at bury 0.5, ~2 s: every one of them out, half a dune
// drawn). From the crack it is UNCOVERED instead, outward from the strip over GROW.revealT s as the sand sloughs off her (the slabs slide the
// same way): each reef triangle drawn once the front passes its centroid (the ordered index's draw range), each frond grown from its root over
// GROW.revRamp u of the front, a puff of silt every GROW.revPuff triangles where the front is (the crust coming off what it hid). Its own
// clock from the crack (L.revT, dt a frame). Measured on 31a3b94's growth: the front runs 7.3 u (the farthest frond) over revealT 2.5 s,
// ~2.9 u/s, about the slabs' slide; the reef's 1346 hidden triangles lie within ~2 u of the band and are out in ~0.8 s. Writes only while
// the front moves; then buryGrowth(L, false) puts the full growth back (growthBuried 0)
export function growReveal(L, dt) {
  if (L.growthBuried === 0) return;
  const reef = L.parts.reef, weed = L.parts.weed, RI = L.reefIdx && reef && RI_ok(L) ? L.reefIdx : null, top = L.revMax || 0;
  if (L.growthBuried !== 2) { L.growthBuried = 2; L.revN = 0; L.revT = 0; if (RI) reef.geometry.setIndex(RI.ordered); }
  L.revT += dt;
  const w = Math.min(1, L.revT / GROW.revealT) * top;
  if (w >= top) { buryGrowth(L, false); return; }
  if (RI) {
    let n = L.revN;
    reef.updateMatrixWorld();
    while (n < RI.key.length && RI.key[n] <= w) {
      if (n % GROW.revPuff === 0) { _gp.set(RI.cen[n * 3], RI.cen[n * 3 + 1], RI.cen[n * 3 + 2]).applyMatrix4(reef.matrixWorld); emitSlabDust(_gp.x, _gp.y, _gp.z, BURY.dust.reveal, 1.4); }
      n++;
    }
    L.revN = n; reef.geometry.setDrawRange(0, (RI.nStrip + n) * 3);
  }
  if (weed && L.weedM0 && L.weedKey) {
    const A = weed.instanceMatrix.array, M0 = L.weedM0;
    for (let k = 0; k < weed.count; k++) {
      if (!L.weedOut[k]) continue;
      const f = Math.max(0, Math.min(1, (w - L.weedKey[k]) / GROW.revRamp)), sc = f * f * (3 - 2 * f), o = k * 16;
      A[o] = M0[o] * sc; A[o + 1] = M0[o + 1] * sc; A[o + 2] = M0[o + 2] * sc; A[o + 4] = M0[o + 4] * sc; A[o + 5] = M0[o + 5] * sc; A[o + 6] = M0[o + 6] * sc;
      A[o + 8] = M0[o + 8] * sc; A[o + 9] = M0[o + 9] * sc; A[o + 10] = M0[o + 10] * sc;
    }
    weed.instanceMatrix.needsUpdate = true;
  }
}
const RI_ok = L => L.reefIdx.geo === L.parts.reef.geometry && !!L.reefIdx.ordered;
// (Task 12) THE SAND SLIDES BACK UP HER FLANKS: the dig-in covers the growth outside the strip as the reveal uncovered it, in reverse (the
// farthest from the strip first: the dune rises from the floor up her sides), over GROW.coverU of bury, through the same ordered index and draw
// range (prepGrowth re-sorted it for the strip where she lies now) and each frond shrunk back to its root over GROW.revRamp u of the front; at
// the end of the range the buried state proper (buryGrowth). Writes only while the front moves. (The shipped toggle at bury 0.5 would pop: of
// 1346 hidden reef triangles 1150 stand out of the drawn dune even at bury 1: growReveal's measurement)
export function growCover(L, b) {
  const k = Math.max(0, Math.min(1, (b - GROW.coverU[0]) / (GROW.coverU[1] - GROW.coverU[0])));
  if (k >= 1) { buryGrowth(L, true); return; }
  const reef = L.parts.reef, weed = L.parts.weed, RI = L.reefIdx && reef && RI_ok(L) ? L.reefIdx : null, top = L.revMax || 0;
  if (L.growthBuried !== 3) {
    if (L.growthBuried === 1) buryGrowth(L, false);                // (from buried: the full growth first, then covered from its edge)
    L.growthBuried = 3; L.covW = -1; L.revN = RI ? RI.key.length : 0; if (RI) { reef.geometry.setIndex(RI.ordered); reef.geometry.setDrawRange(0, (RI.nStrip + L.revN) * 3); }
  }
  const w = (1 - k) * top;
  if (w === L.covW) return;
  L.covW = w;
  if (RI) { let n = L.revN; while (n > 0 && RI.key[n - 1] > w) n--; L.revN = n; reef.geometry.setDrawRange(0, (RI.nStrip + n) * 3); }
  if (weed && L.weedM0 && L.weedKey) {
    const A = weed.instanceMatrix.array, M0 = L.weedM0;
    for (let q = 0; q < weed.count; q++) {
      if (!L.weedOut[q]) continue;
      const f = Math.max(0, Math.min(1, (w - L.weedKey[q]) / GROW.revRamp)), sc = f * f * (3 - 2 * f), o = q * 16;
      A[o] = M0[o] * sc; A[o + 1] = M0[o + 1] * sc; A[o + 2] = M0[o + 2] * sc; A[o + 4] = M0[o + 4] * sc; A[o + 5] = M0[o + 5] * sc; A[o + 6] = M0[o + 6] * sc;
      A[o + 8] = M0[o + 8] * sc; A[o + 9] = M0[o + 9] * sc; A[o + 10] = M0[o + 10] * sc;
    }
    weed.instanceMatrix.needsUpdate = true;
  }
}
// THE GROWTH ON THE EXPOSED ROCK (Task 5b; Michael's checkpoint 2026-10-20: "keep the weeds maybe even add more and coral"). Laid at the
// bed (bedDown: after the fit and the harpoon's seat, before prepGrowth), home only (only a buried build beds down). No new program: the
// weed's spare slots (her weed InstancedMesh is built for 150 fronds and the sculpt keeps 60: the same mesh, the same material) and ONE
// mesh of her own reef's parts (brooderGeo.js rockGrowthParts: fans, encrusting mats, coralline lumps, tube clumps) drawn in the reef's
// own material object (the same program; the parts carry its uv). Every vertex of every frond and part on the strip (inStrip, as
// prepGrowth keeps the reef's triangles), so nothing of it stands out of the dune; a part that strays is dropped. Clear of the harpoon's
// seam by GROW.clear u (fronds hid the iron from 3 u: stills t5b-dev/g2-h3 .. g5, prepGrowth). Seeded per site; at most GROW.* of each (fewer where the strip has no room). Rebuilt at every bed (an event).
//   weed     fronds added (the spare slots), in GROW.tufts clumps at the rock's foot and flanks (her shell 1-3.5 u over the mean ground:
//            where sand lodges and weed roots), small (k 0.45-0.95: a frond 1.0-2.0 u)
//   fan / crust / lump / tube   the coral: fans on her high points, mats on the faces that look up, lumps and tube clumps between
// (Task 7b, M6) revealT s: the growth outside the strip uncovered from the crack over this long (growReveal); revRamp u: a frond grows from
// its root over this much of the front; revPuff: a puff of silt every this many reef triangles uncovered
// (Task 12) coverU: the bury over which the dig-in covers it (growCover): from 0.1 (the dune's first tenth up) to 0.7, before her flanks are
// under it (the dune's rings draw at bury x their fitted height)
export const GROW = { weed: 90, tufts: 12, fan: 6, crust: 12, lump: 12, tube: 5, clear: 3.0, near: 1.2, sight: [8, 1.5], revealT: 2.5, revRamp: 1.5, revPuff: 80, coverU: [0.1, 0.7] };
const _gq = new THREE.Quaternion(), _gq2 = new THREE.Quaternion(), _gn = V3(), _gu = V3(0, 1, 0), _gs = V3(), _gmw = new THREE.Matrix4(), _gm2 = new THREE.Matrix4(), _gm3 = new THREE.Matrix4();
export function growRock(L, MD) {
  const weed = L.parts.weed, reef = L.parts.reef, top = L.topAt;
  L.growN = { weed: 0, fan: 0, crust: 0, lump: 0, tube: 0 };
  if (!weed || !reef || !top || !MD) return;
  // a re-bed on the same growth: the full growth back first (prepGrowth's own first step; done here, or its restore would write the last
  // bed's fronds over this one's), then prepGrowth finds it whole
  if (L.reefIdx && L.reefIdx.geo === reef.geometry) buryGrowth(L, false);
  if (L.weedBase == null) L.weedBase = weed.count;   // (the procedural build: every slot used; the sculpt sets its own, brooder.js)
  const rnd = seededRand(0x5B6E0C + L.idx), mw = _gmw.fromArray(MD.mw), base = L.weedBase, cap = weed.instanceMatrix.count;
  const H = L.harpoon && L.harpoon.seatOk ? L.harpoon.seamWorld() : null, clr2 = GROW.clear * GROW.clear;
  const offSeam = (x, y, z) => !H || (x - H.x) ** 2 + (y - H.y) ** 2 + (z - H.z) ** 2 > clr2;
  // the candidates: her top on a 0.03 grid (0.46 u), on the strip and over the floor (the strip has no dune)
  const C = [];
  for (let x = -1.3; x <= 1.3; x += 0.03) for (let z = -1.0; z <= 1.15; z += 0.03) {
    const h = top(x, z); if (h == null) continue;
    _gs.set(x, h, z).applyMatrix4(mw);
    if (!inStrip(MD, _gs.x, _gs.z) || _gs.y < terrainH(_gs.x, _gs.z, L.idx) + 0.3) continue;
    const e = 0.02, hx = top(x + e, z), hz = top(x, z + e); if (hx == null || hz == null) continue;
    C.push({ x, z, h, wy: _gs.y, up: _gs.y - L.meanG, nx: -(hx - h) / e, nz: -(hz - h) / e });
  }
  if (!C.length) return;
  const pick = f => { const s = C.filter(f); return s.length ? s[Math.floor(rnd() * s.length)] : null; };
  // THE WEED: clumps at the rock's foot and flanks
  const WP = weed.geometry.attributes.position, A = weed.instanceMatrix.array, want = Math.min(GROW.weed, cap - base);
  let n = base;
  for (let t = 0; t < GROW.tufts && n < base + want; t++) {
    const c = pick(q => q.up > 1.0 && q.up < 3.5); if (!c) break;
    const per = Math.ceil(want / GROW.tufts);
    for (let k = 0, tries = 0; k < per && n < base + want && tries < per * 6; tries++) {
      const x = c.x + (rnd() - 0.5) * 0.09, z = c.z + (rnd() - 0.5) * 0.09, h = top(x, z); if (h == null) continue;
      const e = 0.02, hx = top(x + e, z), hz = top(x, z + e); if (hx == null || hz == null) continue;
      _gn.set(-(hx - h) / e, 1, -(hz - h) / e).normalize().lerp(_gu, 0.45).normalize();
      _gq.setFromUnitVectors(_gu, _gn).multiply(_gq2.setFromAxisAngle(_gu, rnd() * Math.PI * 2));
      const kk = 0.45 + 0.5 * rnd();
      _gm2.compose(_gs.set(x, h - 0.003, z), _gq, _gn.set(kk, kk, kk));
      // every vertex of it on the strip (prepGrowth's own rule, here at the source)
      let ok = true; const wm = _gm3.multiplyMatrices(mw, _gm2);
      for (let v = 0; v < WP.count && ok; v++) { _gs.fromBufferAttribute(WP, v).applyMatrix4(wm); ok = inStrip(MD, _gs.x, _gs.z) && offSeam(_gs.x, _gs.y, _gs.z); }
      if (!ok) continue;
      _gm2.toArray(A, n * 16); n++; k++;
    }
  }
  weed.count = n; weed.instanceMatrix.needsUpdate = true; weed.computeBoundingSphere();
  L.growN.weed = n - base;
  // THE CORAL: spots by kind, then every part kept only if all of it lies on the strip and clear of the seam
  const spots = [];
  const put = (kind, nWant, f, size) => { for (let i = 0; i < nWant; i++) { const c = pick(f); if (c) spots.push([kind, c.x, c.z, size(), Math.floor(rnd() * 7)]); } };
  put('fan', GROW.fan, q => q.up > 4.0, () => 0.07 + 0.05 * rnd());
  put('crust', GROW.crust, q => q.nx * q.nx + q.nz * q.nz < 0.6, () => 0.04 + 0.05 * rnd());
  put('lump', GROW.lump, () => true, () => 0.018 + 0.016 * rnd());
  put('tube', GROW.tube, q => q.up > 2.0, () => 0.010 + 0.006 * rnd());
  G.setShellHeight(top);
  let parts;
  try { parts = G.rockGrowthParts(0xC0BA1 + L.idx, spots); } finally { G.setShellHeight(null); }
  const keep = [];
  for (let i = 0; i < parts.length; i++) {
    const P = parts[i].attributes.position; let ok = true;
    for (let v = 0; v < P.count && ok; v++) { _gs.fromBufferAttribute(P, v).applyMatrix4(mw); ok = inStrip(MD, _gs.x, _gs.z) && offSeam(_gs.x, _gs.y, _gs.z); }
    if (ok) { keep.push(parts[i]); L.growN[spots[i][0]]++; } else parts[i].dispose();
  }
  let co = L.parts.coral;
  if (!co) {
    co = L.parts.coral = new THREE.Mesh(new THREE.BufferGeometry(), reef.material);   // (the reef's material OBJECT: its program)
    co.castShadow = true; reef.parent.add(co);
    // (lifted out before her dispose, as the mound is: the generic dispose walks her meshes and disposes each one's material, and the
    // reef's material disposed a SECOND time released its programs under game.js keepingPrograms (the first call anchors it, the second
    // really disposes): the boot's rehearsal lost the reef's 4 programs and they compiled at first sight in play, measured by bootkeys:
    // 711 -> 707 at boot, the programs gate's first sight +10 against the base's +7)
    const prev = L.onDispose;
    L.onDispose = () => { if (co.parent) co.parent.remove(co); co.geometry.dispose(); if (prev) prev(); };
  }
  co.geometry.dispose();
  co.geometry = keep.length ? mergeGeo(keep) : new THREE.BufferGeometry();
  for (const p of keep) p.dispose();
  co.visible = keep.length > 0;
}
const mergeGeo = parts => { const g = G.mergeParts(parts); g.computeBoundingSphere(); return g; };
export function buryGrowth(L, on) {
  if (L.growthBuried === (on ? 1 : 0)) return;
  L.growthBuried = on ? 1 : 0;
  const reef = L.parts.reef, weed = L.parts.weed;
  if (reef && L.reefIdx) { reef.geometry.setIndex(on ? L.reefIdx.strip : L.reefIdx.full); reef.geometry.setDrawRange(0, Infinity); }
  if (weed && L.weedM0) {
    const A = weed.instanceMatrix.array;
    A.set(L.weedM0);
    if (on) for (let k = 0; k < weed.count; k++) if (L.weedOut[k]) { const o = k * 16; A[o] = A[o + 1] = A[o + 2] = A[o + 4] = A[o + 5] = A[o + 6] = A[o + 8] = A[o + 9] = A[o + 10] = 0; }
    weed.instanceMatrix.needsUpdate = true;
  }
}

// the live Velkath, buried or not, at home's zone 0; null for any other zone's sleeper (window.__sl outlives a zone change: it is the
// last brooder built, and a set() through it would rebuild Orune or Mhor)
const liveV = () => { const L = window.__sl, lv = window.lev; return L && !L.gone && L === lv && L.kind === 'brooder' && window.zone === 0 ? L : null; };
if (typeof window !== 'undefined') window.__burial = {
  knobs: BURY,
  state: () => { const L = liveV(); return L ? { buried: !!L.buried, bury: L.bury, buryD: L.buryD, crest: L.crest, meanG: L.meanG } : null; },
  // patch the knobs (a `crest` key writes only the live home row, the crest's one source) and rebuild the zone's sleeper IN PLACE (__lev.remember(null):
  // a fresh build at her bed, as enterZone builds her; __lev.swap would set her down in front of the diver). Off zone 0 (or with
  // another kind live) the knobs are patched for her next build and nothing is rebuilt (state() is then null)
  async set(p) {
    for (const k in p) { if (k === 'crest') continue; if (BURY[k] && typeof BURY[k] === 'object' && !Array.isArray(BURY[k])) Object.assign(BURY[k], p[k]); else BURY[k] = p[k]; }
    if ('crest' in p) { const S = await import('../../world/site.js'); const r = S.currentSite().sleepers[0]; if (r && r.bury) r.bury.crest = p.crest; }
    if (liveV()) window.__lev.remember(null);
    return this.state();
  },
  // the drawn sand (the dune; -1e9 where the floor or the rock is) and the strip, for the probes
  sandAt: (x, z) => { const L = liveV(); return moundY(L && L.mound, x, z); },
  inStrip: (x, z) => { const L = liveV(); return inStrip(L && L.mound, x, z); },
  // THE CRUST's knobs (Task 5): a patch, no rebuild (updateBrooder writes them into the uniforms every frame)
  crust: CRUST,
  // (sandrise) THE SHED's knobs (SHED: on 0 = the shipped cover, the sand going with bury: sandpix-probe's RED fade) and its live values;
  // paint(on): the crust's probe paint (uShed.w), sandpix-probe only
  shed: SHED, shedState: () => { const L = liveV(); return L ? { shedP: L.shedP || 0, sandS: L.sandS ?? null, shedT: L.shedT || 0, stoodT: L.stoodT || 0 } : null; },
  paint(on, thr = 0.3) { const L = liveV(); if (L && L.crustU) L.crustU.uShed.value.w = on ? 1 + thr : 0; return !!(L && L.crustU); },
  // { look: 'sand' (the shipped default) | 'shell' | 'light' | 'stone' } sets that look's values (alb, nrm, rough, sand, and the sand cover's cover / drift / dust / flat; the three non-sand looks zero the cover keys); any other key patches its own value
  setCrust(p) { if (p.look && !CRUST_LOOKS[p.look]) throw new Error('setCrust: look is ' + Object.keys(CRUST_LOOKS).join(' | ')); Object.assign(CRUST, p.look ? CRUST_LOOKS[p.look] : null, p); return Object.assign({}, CRUST); }
};
