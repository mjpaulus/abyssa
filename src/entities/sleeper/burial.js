// THE BURIAL — Velkath asleep as a rock with an old harpoon in it (velkath-buried-rock; spec
// docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md; Michael 2026-10-14: "it would be interesting if she was buried
// in the sand and looked like a rock"). HOME ONLY (Michael 2026-10-15: "we should focus on getting one right now"): the site row's
// sleepers[0].bury switches it on; without it nothing here is called and she is the shipped ridge bit for bit.
// ONE VALUE DRIVES IT: L.bury, 0 risen .. 1 buried. brooder.js poseAll sinks her body L.buryD * L.bury under her bed; the mound is
// drawn over her at L.bury (Task 3a); the crust shades her shell at L.bury (Task 5). Fits run at events (her build, the dig-in's
// start), never per frame; zero per-frame allocation.
import * as THREE from 'three';
import { V3 } from '../../lib/math.js';
import { terrainH } from '../../world/terrain.js';

// crest   u: her crest's top over the mean ground under her (spec: 3-4 u); the row may set it (home: 3.5)
// on      dev A/B (__burial.set): 0 = the shipped ridge at home too
export const BURY = { on: 1, crest: 3.5 };
// THE MOUND (spec §1 "The sand mound"): a dune over her sunk shell that leaves only a strip of her back's crest showing.
//   crestL / crestW  u: the strip, an ellipse along her keel (spec: "about 20 u long"); crestZ its centre (shell units: the bake's
//                    top lies at z -0.10)
//   edgeMin  u: on each bearing the strip's edge is pulled in until her shell there stands this high over the mean ground (the
//            keel falls away at her ends: no pit of sand-walled shell)
//   reveal   u: the rock stands this far out of the sand at the strip's edge (ring 0 lies this far inside her shell)
//   cover    u: sand over her shell outside the strip, at the least; repose: the dune's fall per unit run (0.55 ~ 29 deg)
//   rings    the dune's rings from the edge to where it meets the floor (+2 buried a hair under it); ringStep u, the march
//   sandOpen u: the strip's edge pushed out on her SAND side (where he comes in and the harpoon goes), so more of that flank shows as
//            a face of rock: a lopsided outcrop. 0 = the symmetric strip. Task 4's seat scan decides whether it is needed; if it is,
//            the shape goes to Michael at Task 5's checkpoint as a choice
//   breath   the tell (spec): a lift of `lift` u every period s (up s, down s); drawn only with the lens within `draw` u; the
//            trickle only with him within `near` u (spec: "visible only within about 8 u"). Michael, 2026-10-15: it may be too subtle
//            to see; he judges it on stills ("I thought I already approved this but yes these are fine to proceed with"); the knob
//            is `lift`
Object.assign(BURY, { crestL: 20, crestW: 6, crestZ: -0.07, sandOpen: 0, edgeMin: 1.2, reveal: 0.35, cover: 0.3, repose: 0.55, rings: 14, ringStep: 0.25,
  breath: { lift: 0.045, period: [8, 10], up: 1.6, down: 2.6, draw: 12, near: 8 } });
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
const RIN = new Float32Array(NB), RS = new Float32Array(NB), PROF = new Float32Array(160), PROFR = new Float32Array(160);
const _rgb = [0, 0, 0], RING = new Float32Array(NB), _mi = new THREE.Matrix4();
// THE DRAWN SHELL under the dune, binned (Task 3a, measured on the baked shell at home): the bake's top heightfield (L.topAt) is a
// coarse bilinear grid, and her shell is not a smooth dome under it. Her keel's spines read +-0.5 u off it, and the lip of her
// back is a near-vertical face (the top falls 2-4 u inside 0.5 u of run: the grid reads half-way down it), which stood 1.8 u over a
// dune fitted to topAt alone, outside the strip. So the dune reads her DRAWN vertices too: SHN, the highest drawn shell vertex per
// bearing (both bearings either side of it) and per radial bin (ringStep); LASTR, per bearing, the farthest one standing over the
// floor less the cover (the dune runs out past it: her shell does not fall away monotonically outward). Built at the fit (an event).
const NRAD = 160, SHN = new Float32Array(NB * NRAD), LASTR = new Float32Array(NB), _sv = V3();
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
    bx: 0, bz: 0, br2: 0, topAt: null, mw: new Float32Array(16), mwInv: new Float32Array(16) };
}
// her shell's top under WORLD (x, z), at the fit pose: into her frame by the FULL inverse (dormant she is pitched and rolled to her
// bed: a yaw-only map put a point 6 u up her back ~0.3 u off on a 3 deg tilt, against 0.3 u of cover), the height found in two passes
// (brood.js floorL's way: the local x, z depend on the height through the tilt), back to world y. NaN off her plan. (MD.topAt is
// L.topAt: procedural, null outside her rim; baked, null outside the probe box only, with a neighbour-cell fallback at its edge.)
export function shellTopW(MD, x, z) {
  const e = MD.mw, n = MD.mwInv;
  let wy = e[13];
  for (let it = 0; it < 2; it++) {
    const lx = n[0] * x + n[4] * wy + n[8] * z + n[12], lz = n[2] * x + n[6] * wy + n[10] * z + n[14];
    const h = MD.topAt(lx, lz); if (h == null) return NaN;
    wy = e[1] * lx + e[5] * h + e[9] * lz + e[13];
  }
  return wy;
}
// THE FIT, with her in her BURIED pose (L.bury 1). Polar about the strip's centre C, in her frame (yaw only, as restWorld): per
// bearing, ring 0 sits `reveal` u INSIDE her shell at the strip's edge (hidden in the rock), ring 1 on is the dune: at least `cover`
// u over her shell, never falling faster than `repose` (outward, and inward from a high point of her shell), out to where it meets
// the floor past the last of her drawn shell standing over it (LASTR); the last two rings a hair under the floor (the heightfield
// mesh is a linear sampling of terrainH: the edge must never float). Her shell is read off the heightfield AND her drawn vertices
// (SHN), and every drawn vertex outside the strip is then put under the cover (coverShell). Drawn in the seabed's own material
// with its vertex channels resampled (seabedColor), so dune and floor read as one. Drawn-only: terrainH is untouched. Cost
// (measured, M5 Max headless): fitMound 12-14 ms + prepGrowth 1.6 ms of a 35 ms re-bed.
export function fitMound(L, MD, seabedColor, fissureDist) {
  const K = BURY, R = L.R, cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), NR = MD.NR, NI = K.rings;
  L.body.updateMatrixWorld(true);
  MD.mw.set(L.body.matrixWorld.elements); MD.mwInv.set(_mi.copy(L.body.matrixWorld).invert().elements);
  MD.c = cy; MD.s = sy; MD.R = R; MD.cx = L.pos.x; MD.cz = L.pos.z; MD.crestZ = K.crestZ; MD.topAt = L.topAt;
  // the mesh's (x, z) by her yaw (as restWorld and toPolar map it); every HEIGHT read at that world (x, z) through the full matrix
  const wx = (lx, lz) => L.pos.x + (lx * cy + lz * sy) * R, wz = (lx, lz) => L.pos.z + (-lx * sy + lz * cy) * R;
  const topW = (lx, lz) => shellTopW(MD, wx(lx, lz), wz(lx, lz));
  const a = K.crestW / 2 / R, b = K.crestL / 2 / R, st = K.ringStep / R, dl = 0.6 / R, thS = L.sandSide > 0 ? 0 : Math.PI;
  binShell(L, MD, st);
  // her shell's top at radius r on bearing j: the heightfield's, or the highest drawn vertex binned there if higher; NaN off her plan
  const shAt = (j, r, lx, lz) => {
    const t = topW(lx, lz), k = Math.floor(r / st); let m = -1e9;
    for (let q = k - 1; q <= k + 1; q++) if (q >= 0 && q < NRAD) { const v = SHN[j * NRAD + q]; if (v > m) m = v; }
    return m > -1e8 ? (t === t && t > m ? t : m) : t;
  };
  for (let j = 0; j < NB; j++) {
    const th = j / NB * Math.PI * 2, ux = Math.cos(th), uz = Math.sin(th);
    const ws = Math.max(0, Math.cos(th - thS)), aj = a + K.sandOpen / R * ws * ws;   // (sandOpen: the sand side's face opened)
    let r = 1 / Math.sqrt((ux / aj) ** 2 + (uz / b) ** 2);
    // (her shell's drawn top, shAt: the heightfield alone read the lip of her back half-way down its face and pulled the edge 0.6 u
    // inside it, which left the lip outside the strip, standing 1.8 u over the floor)
    for (; r > 0.02; r -= st) { const h = shAt(j, r, ux * r, K.crestZ + uz * r); if (h === h && h >= L.meanG + K.edgeMin) break; }
    RIN[j] = Math.max(0.02, r);
  }
  for (let j = 0; j < NB; j++) { let s = 0; for (let q = -2; q <= 2; q++) s += RIN[(j + q + NB) % NB]; RS[j] = s / 5; }   // no corners
  const C = MD.geo.attributes.color.array, rgb = _rgb;
  for (let j = 0; j < NB; j++) {
    const th = j / NB * Math.PI * 2, ux = Math.cos(th), uz = Math.sin(th), r0 = RS[j];
    // the dune's profile outward from the edge (PROF heights at radii PROFR)
    let np = 0, hPrev = -1e9, rEnd = r0 + dl;
    for (let r = r0 + dl; r < r0 + 2.2 && np < PROF.length; r += st) {
      const lx = ux * r, lz = K.crestZ + uz * r, x = wx(lx, lz), z = wz(lx, lz), fl = terrainH(x, z, L.idx), sh = shAt(j, r, lx, lz);
      const need = Math.max(fl, sh === sh ? sh + K.cover : -1e9);
      const h = np ? Math.max(need, hPrev - K.repose * K.ringStep) : need;
      PROF[np] = h; PROFR[np] = r; np++; hPrev = h; rEnd = r;
      // (met the floor with her shell under it, and none of her drawn shell farther out on this bearing over the floor: LASTR)
      if (h <= fl + 0.02 && !(sh === sh && sh + K.cover > fl) && r > LASTR[j]) break;
      if (fissureDist(x, z, L.idx) < 1.5) break;          // (the drift never runs over the crack's lip)
    }
    // (and rising outward toward a high point of her shell, the dune keeps its repose too: no cliff on the inner side of it)
    for (let k = np - 2; k >= 0; k--) PROF[k] = Math.max(PROF[k], PROF[k + 1] - K.repose * K.ringStep);
    const set = (i, r, y, dk) => {
      const lx = ux * r, lz = K.crestZ + uz * r, x = wx(lx, lz), z = wz(lx, lz), o = (i * NB + j) * 3, sh = shAt(j, r, lx, lz);
      MD.M[o] = x; MD.M[o + 1] = y; MD.M[o + 2] = z;
      MD.NEED[i * NB + j] = i >= 1 && i < NI ? Math.max(terrainH(x, z, L.idx), sh === sh ? sh + K.cover : -1e9) : -1e9;
      MD.F[o] = x; MD.F[o + 1] = terrainH(x, z, L.idx) - 0.12; MD.F[o + 2] = z;
      MD.RR[j * NR + i] = r;
      seabedColor(x, z, rgb); C[o] = rgb[0] * dk; C[o + 1] = rgb[1]; C[o + 2] = rgb[2];
    };
    { const h0 = topW(ux * r0, K.crestZ + uz * r0); set(0, r0, (h0 === h0 ? h0 : L.meanG) - K.reveal, 0.42); }
    for (let i = 1; i < NI; i++) {
      const s = (i - 1) / (NI - 2), r = r0 + dl + (rEnd - r0 - dl) * s;
      let k = 0; while (k < np - 2 && PROFR[k + 1] < r) k++;
      const w = np > 1 ? Math.min(1, Math.max(0, (r - PROFR[k]) / (PROFR[k + 1] - PROFR[k] || 1))) : 0;
      set(i, r, np > 1 ? PROF[k] + (PROF[k + 1] - PROF[k]) * w : PROF[0], 0.42 + 0.58 * Math.pow(s, 0.6));
    }
    set(NI, rEnd + 0.4 / R, 0, 1); set(NI + 1, rEnd + 0.8 / R, 0, 1);
    for (const i of [NI, NI + 1]) { const o = (i * NB + j) * 3; MD.M[o + 1] = terrainH(MD.M[o], MD.M[o + 2], L.idx) - (i === NI ? 0.10 : 0.12); }
  }
  // every drawn shell vertex outside the strip under its cover (coverShell), then across bearings: a dune has no ridges between
  // bearings (5-tap average of rings 1..NI-1, never under its cover again)
  coverShell(L, MD);
  smoothRings(MD);
  // normals of the fitted dune, facing up (the seabed material is FrontSide); the floor state's normal is straight up
  MD.P.set(MD.M); MD.geo.computeVertexNormals();
  let ny = 0; const N = MD.geo.attributes.normal.array; for (let i = 1; i < N.length; i += 3) ny += N[i];
  if (ny < 0) { const ix = MD.geo.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } MD.geo.index.needsUpdate = true; MD.geo.computeVertexNormals(); }
  MD.NM.set(MD.geo.attributes.normal.array);
  MD.geo.attributes.color.needsUpdate = true;
  MD.k = -1; setMoundK(MD, L.bury, 0);
  MD.geo.computeBoundingSphere();
  // the queries' early-out: a circle round C holding every ring (shutFloorY runs this for every hose node, every frame)
  let rMax = 0; for (let q = 0; q < MD.RR.length; q++) if (MD.RR[q] > rMax) rMax = MD.RR[q];
  MD.bx = wx(0, K.crestZ); MD.bz = wz(0, K.crestZ); MD.br2 = (rMax * R + 1) * (rMax * R + 1);
}
// SHN / LASTR (above) off her drawn shell at the fit pose
function binShell(L, MD, st) {
  SHN.fill(-1e9); LASTR.fill(0);
  const sh = L.parts.shell, P = sh.geometry.attributes.position, mw = sh.matrixWorld, cover = BURY.cover, lo = L.meanG - 3;
  sh.updateMatrixWorld(true);
  for (let i = 0; i < P.count; i++) {
    _sv.fromBufferAttribute(P, i).applyMatrix4(mw);
    if (_sv.y + cover < lo) continue;                    // (deep under the floor: the floor under her stays within ~0.7 u of meanG)
    toPolar(MD, _sv.x, _sv.z);
    const k = Math.floor(_rho / st); if (k >= NRAD) continue;
    const b0 = Math.floor(_fa) % NB, b1 = (b0 + 1) % NB;
    if (_sv.y > SHN[b0 * NRAD + k]) SHN[b0 * NRAD + k] = _sv.y;
    if (_sv.y > SHN[b1 * NRAD + k]) SHN[b1 * NRAD + k] = _sv.y;
    if (_sv.y + cover > terrainH(_sv.x, _sv.z, L.idx)) { if (_rho > LASTR[b0]) LASTR[b0] = _rho; if (_rho > LASTR[b1]) LASTR[b1] = _rho; }
  }
}
// THE COVER, GUARANTEED: every drawn shell vertex outside the strip (past ring 1 at its bearing) raises the NEED of the four corners
// of the dune's quad over it to its height + cover. The drawn dune is linear across each of the quad's two triangles, so it then lies
// >= cover over every one of them (smoothRings clamps to NEED, never takes it back). The two outer rings stay buried under the floor
// (the edge must never float): a vertex in that last quad needing cover is booked in MD.uncov (the dune runs out past LASTR, so 0)
function coverShell(L, MD) {
  const sh = L.parts.shell, P = sh.geometry.attributes.position, mw = sh.matrixWorld, cover = BURY.cover, NI = BURY.rings, lo = L.meanG - 3;
  let un = 0;
  for (let v = 0; v < P.count; v++) {
    _sv.fromBufferAttribute(P, v).applyMatrix4(mw);
    if (_sv.y + cover < lo) continue;
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
  // which side of the diagonal b-c: a's side is triangle a b c
  const ex = P[ic] - P[ib], ez = P[ic + 2] - P[ib + 2];
  const sp = ex * (z - P[ib + 2]) - ez * (x - P[ib]), sa = ex * (P[ia + 2] - P[ib + 2]) - ez * (P[ia] - P[ib]);
  let y = sp * sa >= 0 ? triY(P, ia, ib, ic, x, z) : triY(P, ib, id, ic, x, z);
  if (y !== y) y = sp * sa >= 0 ? triY(P, ib, id, ic, x, z) : triY(P, ia, ib, ic, x, z);
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

// ---- THE TELL ----
const ease = x => x * x * (3 - 2 * x);
const TRICKLE_J = [-2, 0, 2];                         // the trickle's three bearings round the nearest one (module scratch, not a literal per breath)
// THE TELL (spec §1): every 8-10 s the sand over her lifts a few centimetres and settles; a thin trickle of silt slides off the
// crest's edge with each breath. Only a careful eye catches it: the lift is drawn only with the lens within BURY.breath.draw u (a
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
  const near = Math.hypot(camPos.x - MD.cx, camPos.z - MD.cz) < B.draw + BURY.crestL / 2;
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
export function prepGrowth(L, MD) {
  const reef = L.parts.reef, weed = L.parts.weed;
  // a re-fit on the SAME growth (a re-bed at a new spot, the dig-in) first puts the full growth back: else the strip's index would be
  // taken for the full one and the zeroed fronds for the grown ones, and rising she would never get them back. The sculpt's landing
  // replaces the reef geometry AND rewrites the weed's matrices, so a new reef geometry means both are whole already.
  if (reef && L.reefIdx && L.reefIdx.geo === reef.geometry) buryGrowth(L, false);
  if (reef && reef.geometry.index) {
    const g = reef.geometry, ix = g.index.array, P = g.attributes.position, keep = [];
    reef.updateMatrixWorld(true);
    for (let q = 0; q < ix.length; q += 3) {
      // kept only if ALL THREE corners lie in the strip: a triangle straddling its edge would leave a corner standing out of the
      // dune (and burial-probe's `reef` check books every drawn vertex outside the strip)
      let all = true;
      for (let k = 0; k < 3 && all; k++) { _gp.fromBufferAttribute(P, ix[q + k]).applyMatrix4(reef.matrixWorld); all = inStrip(MD, _gp.x, _gp.z); }
      if (all) keep.push(ix[q], ix[q + 1], ix[q + 2]);
    }
    L.reefIdx = { full: g.index, strip: new THREE.BufferAttribute(Uint32Array.from(keep), 1), geo: g };
  }
  if (weed) {
    L.weedM0 = Float32Array.from(weed.instanceMatrix.array);
    L.weedOut = new Uint8Array(weed.count);
    weed.updateMatrixWorld(true);
    // a frond stays only if EVERY vertex of it lies in the strip, as a reef triangle does (Task 3a, measured: judged by its root, 22
    // vertices of fronds rooted near the strip's edge leaned out over the dune, the worst 2.0 u over the sand)
    const WP = weed.geometry.attributes.position;
    for (let k = 0; k < weed.count; k++) {
      weed.getMatrixAt(k, _gm); _gm.premultiply(weed.matrixWorld);
      let all = true;
      for (let v = 0; v < WP.count && all; v++) { _gp.fromBufferAttribute(WP, v).applyMatrix4(_gm); all = inStrip(MD, _gp.x, _gp.z); }
      L.weedOut[k] = all ? 0 : 1;
    }
  }
  L.growthBuried = -1;
}
export function buryGrowth(L, on) {
  if (L.growthBuried === (on ? 1 : 0)) return;
  L.growthBuried = on ? 1 : 0;
  const reef = L.parts.reef, weed = L.parts.weed;
  if (reef && L.reefIdx) reef.geometry.setIndex(on ? L.reefIdx.strip : L.reefIdx.full);
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
  // patch the knobs (a `crest` key also writes the live home row) and rebuild the zone's sleeper IN PLACE (__lev.remember(null):
  // a fresh build at her bed, as enterZone builds her; __lev.swap would set her down in front of the diver). Off zone 0 (or with
  // another kind live) the knobs are patched for her next build and nothing is rebuilt (state() is then null)
  async set(p) {
    for (const k in p) { if (BURY[k] && typeof BURY[k] === 'object' && !Array.isArray(BURY[k])) Object.assign(BURY[k], p[k]); else BURY[k] = p[k]; }
    if ('crest' in p) { const S = await import('../../world/site.js'); const r = S.currentSite().sleepers[0]; if (r && r.bury) r.bury.crest = p.crest; }
    if (liveV()) window.__lev.remember(null);
    return this.state();
  },
  // the drawn sand (the dune; -1e9 where the floor or the rock is) and the strip, for the probes
  sandAt: (x, z) => { const L = liveV(); return moundY(L && L.mound, x, z); },
  inStrip: (x, z) => { const L = liveV(); return inStrip(L && L.mound, x, z); }
};
