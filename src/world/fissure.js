// src/world/fissure.js — THE FISSURE's jam, its seep and the opening (spec 2026-10-10 §1).
// OWNS each zone's OPEN LEVEL k (0 shut .. 1 open): riftOpen (k > 0.5), the shut floor's flag
// (fissureShape.js setFissureShut, read by terrain.js jamAt / shutFloorY) and, from Task 4, the
// open light all read fissureOpenK. game.js pushes the chart's calm record in (setFissureOpen on
// every zone entry / reseed) and starts the opening (openFissure); nothing else writes k.
//
// SHUT, what is drawn over the crack is what Sal stands on (fissureShape.js jamYAt):
//   - THE JAM: 160 boulders per zone, ONE InstancedMesh of flora's own seabed rock (flora.js
//     jamRockKit: the 'rock' program, its generated rock map set triplanar, the zone's albedo),
//     bedded in the silt with their tops within a step of it on the walkable middle, the big blocks
//     wedged against the walls. Kept out of the overhang slabs' footprints.
//   - THE SILT: a packed-sediment strip from lip to lip on jamYAt (placed through fissureWorld with
//     each side's own width), drawn with the TERRAIN's own zone material and vertex encoding
//     (r cavity AO, g rock bias, b height over the basin floor): it is seabed, same program. It
//     covers the buried slab tops (or sinks under a wall face) 0.06-0.08 u clear: no z-fight.
//   - THE SEEP: 8 pale blue-white additive sprites in the gaps (lib/textures.js warmGlow: fog off,
//     its own distance fade), breathing on an 8 s period, alpha <= 0.10 (1.6x for a beat at the break). No THREE light (14).
// THE OPENING (openFissure, COLLAPSE + SWELL = 6.6 s; k climbs linearly over it):
//   0.0  the seabed shudders (quake: the lens shakes as for her blows); the blocks jostle.
//   0.4  THE BREAK: the crack coughs silt (three of the Brooder's sand-plume clouds, plume.js:
//        fogged and lit like seabed, never additive) and a stir pulse startles the reef; the
//        seep flares as the cold light finds the cracks, then fades with the collapse.
//   0.4-3.3 THE SLUMP: the middle sags 2 u into the throat. The sag is part of the FLOOR
//        (fissureShape.js setJamSag -> terrain.js jamAt), so a man stood on it rides it down.
//   2.9-4.7 THE POUR: the blocks go, the middle first and the wall blocks last, tumbling, sinking
//        as stone does in water (9 u/s^2 to 10 u/s), drawn in toward the throat as they drop, to
//        the throat floor (every block sits over >= 14 u of drop: none is left resting in view).
//   3.3  k > 0.5: the floor goes (setFissureShut false); the silt drains into the throat, the
//        middle fastest, and is gone 14 u down; the crack exhales its cloud (seven more plumes).
//   3.6-6.6 THE SWELL: Task 4's open light reads k. The pour keeps its own clock past 6.6 until
//        the last block lands (<= 14 s), then the jam is hidden.
// Built at boot (game.js after buildRifts, inside the loader: the warm frames draw every mesh, so
// first sight builds nothing), refilled in place on a reseed (reseatFissures after resetJam).
// Per frame: zero allocation (module scratch); the CPU writes only during an opening and the
// seep's opacity while it is in sight.
import * as THREE from 'three';
import { scene, renderer } from '../core.js';
import { zoneBottom } from '../config.js';
import { FISSURE, jamYAt, jamTopY, fissureWorld, slabProbe, _widths, setFissureShut, setJamSag, jamSagProfile, lipMeanY, fissureShut } from './fissureShape.js';
import { terrainH, terrainUnderH, terrainMeshes, jamAt, shutFloorY } from './terrain.js';
import { stirPulse, P_STRIKE, P_SLAM } from './stir.js';
import { jamRockKit } from './flora.js';
import { makeWarmGlow, seededRand } from '../lib/textures.js';
import { spawnPlume, updatePlumes, plumeTicks, buildPlumes } from '../entities/sleeper/plume.js';
import { currentSiteIndex } from './site.js';

const N_BOULDER = 160, N_SEEP = 8, COLLAPSE = 3.6, SWELL = 3.0;
const T_BREAK = 0.4, T_OPEN = 0.5 * (COLLAPSE + SWELL);        // the break; k passes 0.5 (the floor goes)
const SAG_MAX = 2.0, A_SILT = 10, SILT_GONE = 14;     // u, u/s^2, u
const A_ROCK = 9, V_ROCK = 10, ROCK_T = 14, DROP_MIN = 14;           // a block sinking: u/s^2, terminal u/s; the pour's longest clock, s
const SEEP_COL = new THREE.Color(0.70, 0.82, 1.0), SEEP_MAX = 0.10, SEEP_PERIOD = 8;
const SILT_DU = 0.5, SILT_NV = 15;
const BS = 20;   // boulder record: u v restY sx sy sz qx qy qz qw start targetY targetV ax ay az rate p top ph
const Z = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _ax = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color(), _w = { x: 0, z: 0 };
const _out = { quake: 0, opening: false };
const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const sstep = (a, b, x) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---- build (boot) ----------------------------------------------------------------------
export function buildFissures() {
  buildPlumes();   // the opening's silt clouds (the Brooder's sand-plume system): built now, warmed with the rest
  for (let zi = 0; zi < 3; zi++) Z.push(buildZone(zi));
  for (let zi = 0; zi < 3; zi++) { layout(zi); setFissureOpen(zi, 0); }
}
function buildZone(zi) {
  const F = FISSURE[zi];
  // the boulders: one rock shape per zone (flora's generator on our own stream), instanced
  const kit = jamRockKit(zi, seededRand(0xF1550 + zi * 7919), 4, 0.95, 0.5, 2.4);   // blockier than the seabed's: fresh-broken
  const g = kit.geo;
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(N_BOULDER * 4), 4));
  const jam = new THREE.InstancedMesh(g, kit.mat, N_BOULDER);
  jam.name = 'fissureJam' + zi;
  jam.receiveShadow = true;           // as flora's boulders (part of the program key)
  jam.castShadow = false;
  for (let i = 0; i < N_BOULDER; i++) jam.setColorAt(i, _c.set(kit.rock));
  scene.add(jam);
  // the rock's own vertices, for each boulder's true top once it is turned and scaled
  const rp = g.attributes.position, rv = new Float32Array(rp.count * 3);
  for (let i = 0; i < rp.count; i++) { rv[i * 3] = rp.getX(i); rv[i * 3 + 1] = rp.getY(i); rv[i * 3 + 2] = rp.getZ(i); }
  // the silt: a (u, across) grid, lip to lip; topology is site-invariant, heights refilled per site
  const NU = Math.round(2 * F.halfLen / SILT_DU) + 1, nv = NU * SILT_NV;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  sg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  const idx = new Uint32Array((NU - 1) * (SILT_NV - 1) * 6);
  let t = 0;
  for (let a = 0; a < NU - 1; a++) for (let b = 0; b < SILT_NV - 1; b++) {
    const A = a * SILT_NV + b, B = A + SILT_NV, C = B + 1, D = A + 1;
    idx[t++] = A; idx[t++] = D; idx[t++] = B; idx[t++] = B; idx[t++] = D; idx[t++] = C;   // up (checked in layout)
  }
  sg.setIndex(new THREE.BufferAttribute(idx, 1));
  const silt = new THREE.Mesh(sg, terrainMeshes[zi].material);   // the seabed's own material
  silt.name = 'fissureSilt' + zi;
  silt.receiveShadow = true;          // as the terrain and its fissure patch (program key)
  scene.add(silt);
  // the seep
  const seep = [];
  for (let i = 0; i < N_SEEP; i++) {
    const s = makeWarmGlow(SEEP_COL.getHex(), 3, { near: 14, far: 80, nearW: 0 });
    s.material.opacity = 0; s.name = 'fissureSeep' + zi;
    scene.add(s); seep.push(s);
  }
  return { zi, jam, rv, rock: kit.rock, n: 0, B: new Float32Array(N_BOULDER * BS), silt, NU, nv,
    sU: new Float32Array(nv), sV: new Float32Array(nv), sY: new Float32Array(nv), sP: new Float32Array(nv),
    seep, seepPh: new Float32Array(N_SEEP), seepY: new Float32Array(N_SEEP), seepP: new Float32Array(N_SEEP),
    k: 0, t: -1, rt: -1, q: 0, sag: 0, drop: 0, topMax: -1e9, siltOn: true, rockOn: true };
}

// ---- layout (boot + every reseed): pure function of (site, zone) and the terrain -------------
// rotated + scaled top of the rock shape above its centre (true vertices)
function rockTop(Fz, q, sx, sy, sz) {
  const r = Fz.rv; let top = -1e9;
  for (let i = 0; i < r.length; i += 3) {
    _p.set(r[i] * sx, r[i + 1] * sy, r[i + 2] * sz).applyQuaternion(q);
    if (_p.y > top) top = _p.y;
  }
  return top;
}
function inSlab(x, z, zi, r) {
  if (slabProbe(x, z, zi).q >= 0) return true;
  for (let k = 0; k < 6; k++) {
    const a = k * 1.0472;
    if (slabProbe(x + Math.cos(a) * r, z + Math.sin(a) * r, zi).q >= 0) return true;
  }
  return false;
}
function layout(zi) {
  const Fz = Z[zi], F = FISSURE[zi], B = Fz.B, rand = seededRand(0x6A3C5 ^ (currentSiteIndex() * 92821) ^ (zi * 104729));
  const rr = (a, b) => a + (b - a) * rand();
  const kThroat = F.throatHalfW / F.halfW;
  const cx = [], cz = [], cr = [];
  let n = 0;
  // two passes: big blocks wedged at the walls, then the packed middle (largest first)
  const place = (wall, tries, count) => {
    let got = 0;
    for (let tr = 0; tr < tries && got < count && n < N_BOULDER; tr++) {
      const prog = tr / tries;
      const u = (rand() * 2 - 1) * F.halfLen * 0.86;   // the tips are silt-filled slots: every block has the throat under it
      const side = rand() < 0.5 ? 1 : 0, wd = _widths(F, u), w = side ? wd.w1 : wd.w0;
      if (w < 0.9) continue;
      const size = wall ? rr(2.2, 3.5) : rr(1.6, 1.6 + 2.2 * (1 - prog));   // diameter, u (the brief's 1.2-3.5)
      const R = size * 0.5;
      if (!wall && w < R * 1.1) continue;
      const f = wall ? rr(0.62, 0.98) : rr(0, 0.66) * (rand() < 0.5 ? 1 : 0.6);
      const v = (side ? 1 : -1) * f * w;
      fissureWorld(u, v, zi, _w);
      const x = _w.x, z = _w.z;
      let ok = true;
      for (let j = 0; j < cx.length && ok; j++) {
        const dx = x - cx[j], dz = z - cz[j], m = 0.56 * (R + cr[j]);
        if (dx * dx + dz * dz < m * m) ok = false;
      }
      if (!ok || inSlab(x, z, zi, R)) continue;
      // shape: an angular block, lying more or less flat, turned anyhow
      // the middle is a PAVEMENT of jammed blocks, broad faces near level and their tops near the
      // silt (so the walkable jam reads as packed rubble, not sand with stones on it); the wall
      // blocks stand up, wedged at angles
      const tl = wall ? 0.8 : 0.28;
      const sx = R * rr(0.85, 1.25), sy = R * (wall ? rr(0.65, 1.0) : rr(0.5, 0.78)), sz = R * rr(0.8, 1.15);
      _e.set(rr(-tl, tl), rr(0, 6.2832), rr(-tl, tl)); _q.setFromEuler(_e);
      const top = rockTop(Fz, _q, sx, sy, sz);
      const jy = jamYAt(u, zi, terrainH);
      // how far its top stands over the silt: a step at most on the walkable middle
      const pr = wall ? rr(0.4, 1.25) : rr(0.05, 0.4) * (rand() < 0.8 ? 1 : 1.25);
      const restY = jy + pr - top;
      const p = jamSagProfile(u, v, zi);
      const o = n * BS;
      B[o] = u; B[o + 1] = v; B[o + 2] = restY; B[o + 3] = sx; B[o + 4] = sy; B[o + 5] = sz;
      B[o + 6] = _q.x; B[o + 7] = _q.y; B[o + 8] = _q.z; B[o + 9] = _q.w;
      // the pour: the middle goes first, as the floor does; the wall blocks last
      B[o + 10] = 2.9 + 1.4 * Math.pow(1 - p, 0.7) + 0.4 * rand();
      // where it comes to rest: the throat floor (drawn in toward the throat as it falls), or the
      // tip slot's floor past the throat's ends
      const inT = Math.abs(u) < F.halfLen * 0.9;
      const tv = inT ? v * kThroat * 0.7 : v;
      fissureWorld(u, tv, zi, _w);
      const floorY = terrainUnderH(_w.x, _w.z, zi) + sy * 0.4;
      if (floorY > restY - DROP_MIN) continue;     // a shallow throat floor: silt only there (no block left resting in view)
      B[o + 11] = Math.max(floorY, restY - 90);
      B[o + 12] = tv;
      _ax.set(rr(-1, 1), rr(-0.4, 0.4), rr(-1, 1)).normalize();
      B[o + 13] = _ax.x; B[o + 14] = _ax.y; B[o + 15] = _ax.z; B[o + 16] = rr(0.6, 2.2) * (rand() < 0.5 ? 1 : -1) / Math.max(0.6, R);
      B[o + 17] = p; B[o + 18] = top; B[o + 19] = rr(0, 6.2832);
      _c.set(Fz.rock).multiplyScalar(rr(0.7, 1.2));
      Fz.jam.setColorAt(n, _c);
      cx.push(x); cz.push(z); cr.push(R);
      n++; got++;
    }
  };
  place(true, 1600, 48);
  place(false, 6000, N_BOULDER);
  Fz.n = n;
  Fz.jam.count = n;
  Fz.jam.instanceColor.needsUpdate = true;
  // bounds: the whole crack from the lip to the throat floor (the pour stays inside it)
  const jt = jamTopY(zi, terrainH);
  Fz.jam.boundingSphere = new THREE.Sphere(new THREE.Vector3(F.cx, jt - 30, F.cz), F.halfLen + 45);

  // the silt
  const P = Fz.silt.geometry.attributes.position.array, CC = Fz.silt.geometry.attributes.color.array;
  const ZB = zoneBottom(zi);
  for (let a = 0; a < Fz.NU; a++) {
    const u = Math.max(-F.halfLen, Math.min(F.halfLen, -F.halfLen + a * SILT_DU));
    const wd = _widths(F, u), w0 = wd.w0, w1 = wd.w1, jy = jamYAt(u, zi, terrainH);
    for (let b = 0; b < SILT_NV; b++) {
      const f = -1 + 2 * b / (SILT_NV - 1), v = f >= 0 ? f * w1 : f * w0, i = a * SILT_NV + b;
      fissureWorld(u, v, zi, _w);
      let y = jy;
      const sp = slabProbe(_w.x, _w.z, zi);
      if (sp.q >= 0) {                     // a buried / low slab: cover its top, never coplanar with it
        const top = terrainH(_w.x, _w.z, zi);
        if (top > y - 0.08 && top < y + 0.08) y = top + 0.08;
      } else {                             // a wall face at the jam's height: tuck under it
        const h = terrainH(_w.x, _w.z, zi);
        if (h > y - 0.06 && h < y + 0.06) y = h - 0.06;
      }
      P[i * 3] = _w.x; P[i * 3 + 1] = y; P[i * 3 + 2] = _w.z;
      Fz.sU[i] = u; Fz.sV[i] = v; Fz.sY[i] = y; Fz.sP[i] = jamSagProfile(u, v, zi);
      // colour, in the terrain's encoding: darker into the walls and round each boulder's foot,
      // gravel (rock bias) where the rubble pokes through
      let dmin = 1e9;
      for (let j = 0; j < cx.length; j++) { const d = Math.hypot(_w.x - cx[j], _w.z - cz[j]) - cr[j]; if (d < dmin) dmin = d; }
      const ao = (1 - 0.42 * sstep(0.55, 1.0, Math.abs(f))) * (0.62 + 0.38 * sstep(-0.2, 0.9, dmin));
      CC[i * 3] = 0.18 + 0.82 * ao * ao;
      CC[i * 3 + 1] = 0.5 + 0.38 * (1 - sstep(0, 1.2, dmin));   // packed, gritty: the rock bias, not clean rippled sand
      CC[i * 3 + 2] = c01((y - ZB - 2) / 220);
    }
  }
  const g = Fz.silt.geometry;
  g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere(); g.boundingSphere.radius += SILT_GONE + 2;
  // the seep: the most open gaps over the middle (furthest from any boulder), spread out
  const S = Fz.seep, sx = [], sz = [];
  for (let i = 0; i < N_SEEP; i++) {
    let best = -1, bu = 0, bv = 0, bx = 0, bz = 0;
    for (let tr = 0; tr < 260; tr++) {
      const u = (rand() * 2 - 1) * F.halfLen * 0.55, wd = _widths(F, u), v = (rand() * 2 - 1) * 0.42 * (rand() < 0.5 ? wd.w1 : wd.w0);
      fissureWorld(u, v, zi, _w);
      let d = 1e9;
      for (let j = 0; j < cx.length; j++) d = Math.min(d, Math.hypot(_w.x - cx[j], _w.z - cz[j]) - cr[j]);
      for (let j = 0; j < sx.length; j++) if (Math.hypot(_w.x - sx[j], _w.z - sz[j]) < 5) d = -1;
      if (slabProbe(_w.x, _w.z, zi).q >= 0) d = -1;
      if (d > best) { best = d; bu = u; bv = v; bx = _w.x; bz = _w.z; }
    }
    sx.push(bx); sz.push(bz);
    Fz.seepY[i] = jamYAt(bu, zi, terrainH) + 0.2; Fz.seepP[i] = jamSagProfile(bu, bv, zi);
    S[i].position.set(bx, Fz.seepY[i], bz);
    S[i].scale.setScalar(rr(3.6, 6.0));
    Fz.seepPh[i] = rr(0, 6.2832);
  }
}

// On a reseed (game.js reseedWorldNow, after resetJam): the jam hangs under the new site's lips.
export function reseatFissures() {
  for (let zi = 0; zi < Z.length; zi++) { const k = Z[zi].k; layout(zi); setFissureOpen(zi, k); }
}

// ---- state --------------------------------------------------------------------------------
// Instant state (load, reseed, zone entry from the chart's record, probes): stops an opening.
export function setFissureOpen(zi, k) {
  const F = Z[zi]; if (!F) return;
  F.k = Math.max(0, Math.min(1, k)); F.t = -1; F.rt = -1; F.q = 0;
  setJamSag(zi, 0); setFissureShut(zi, F.k <= 0.5);
  F.sag = 0; F.drop = 0;
  F.siltOn = F.rockOn = F.k <= 0.5;
  if (F.k <= 0.5) pose(zi, -1);
}
// The calm's opening: starts the collapse + swell from shut; returns its duration in seconds.
export function openFissure(zi) {
  const F = Z[zi]; if (!F) return 0;
  if (F.t < 0 && F.k >= 1) return 0;
  if (F.t < 0) { setFissureOpen(zi, 0); F.t = 0; F.rt = 0; }
  return COLLAPSE + SWELL;
}
export function fissureOpenK(zi) { return Z[zi] ? Z[zi].k : 0; }
export function fissureOpening(zi) { return !!Z[zi] && Z[zi].t >= 0; }

// ---- per frame ---------------------------------------------------------------------------
const sagAt = t => t < T_BREAK ? 0 : SAG_MAX * Math.pow(c01((t - T_BREAK) / (T_OPEN - T_BREAK)), 1.7);
// a boulder sinking through water: it gathers way, then falls at its terminal speed
const TC = V_ROCK / A_ROCK, DC = 0.5 * A_ROCK * TC * TC;
const fallAt = tau => tau < TC ? 0.5 * A_ROCK * tau * tau : DC + V_ROCK * (tau - TC);
const fallTime = D => D <= DC ? Math.sqrt(2 * D / A_ROCK) : TC + (D - DC) / V_ROCK;
let plumeSeen = -1, plumeOwn = 0;
export function updateFissure(dt, t, activeZone) {
  let quake = 0, opening = false;
  // the clouds' clock: the zone-0 Brooder ticks it every frame she lives; where nobody did since our
  // last look (zones 1 and 2, or her gone), and a cloud of ours may still be hanging, we tick it
  const pt = plumeTicks();
  if (pt === plumeSeen && plumeOwn > 0) { updatePlumes(dt); plumeOwn -= dt; }
  plumeSeen = plumeTicks();
  for (let zi = 0; zi < Z.length; zi++) {
    const F = Z[zi];
    const inSight = terrainMeshes[zi].visible;
    if (F.t >= 0) {
      opening = true;
      const t0 = F.t;
      F.t += dt;
      const T = F.t, c = Math.min(1, T / COLLAPSE);
      F.k = Math.min(1, T / (COLLAPSE + SWELL));
      setFissureShut(zi, F.k <= 0.5);
      // the slump is the floor until the floor goes
      F.sag = sagAt(Math.min(T, T_OPEN));
      setJamSag(zi, F.k <= 0.5 ? F.sag : 0);
      F.drop = T > T_OPEN ? 0.5 * A_SILT * (T - T_OPEN) * (T - T_OPEN) : 0;
      // the seabed shudders: a held tremor easing out over the collapse, a jolt at the break and
      // another as the floor goes
      F.q = T < COLLAPSE + 0.6 ? Math.min(1, T / 0.15) * 0.6 * (1 - c)
        + 0.25 * Math.exp(-(((T - T_BREAK) / 0.25) ** 2)) + 0.2 * Math.exp(-(((T - T_OPEN) / 0.3) ** 2)) : 0;
      if (zi === activeZone) {
        quake = Math.max(quake, F.q);
        // the silt plume: a cough at the break, then the pour's cloud heaving up out of the crack
        if (t0 < T_BREAK && T >= T_BREAK) burst(zi, 1.0, 0.55, 3, 0);
        if (t0 < T_OPEN && T >= T_OPEN) burst(zi, 0.8, 1.0, 4, 1);
        if (t0 < T_OPEN + 0.7 && T >= T_OPEN + 0.7) burst(zi, 0, 0.65, 3, 2);
      }
      if (T >= COLLAPSE + SWELL) { F.t = -1; F.k = 1; F.q = 0; setJamSag(zi, 0); setFissureShut(zi, false); }
    }
    // the pour runs on its own clock: the last blocks are still going down when k reaches 1
    if (F.rt >= 0) { F.rt += dt; pose(zi, F.rt); if (!F.rockOn) F.rt = -1; }
    // in sight only while there is something to see
    F.jam.visible = inSight && F.rockOn;
    F.silt.visible = inSight && F.siltOn;
    const seepOn = inSight && F.k < 1;
    let a = 0;
    if (seepOn) {
      const T = F.t >= 0 ? F.t : -1, c = T >= 0 ? Math.min(1, T / COLLAPSE) : 0;
      // breathing shut; at the break it flares as the cold light finds the cracks, then it is gone
      a = SEEP_MAX * (1 - c) * (T >= 0 ? 1 + 0.6 * Math.exp(-(((T - 1.0) / 0.6) ** 2)) : 1);
    }
    for (let i = 0; i < F.seep.length; i++) {
      const s = F.seep[i];
      s.visible = seepOn;
      if (!seepOn) continue;
      const br = 0.55 + 0.45 * Math.sin(t * (6.2832 / SEEP_PERIOD) + F.seepPh[i]);
      s.material.opacity = a * br;
      s.position.y = F.seepY[i] - F.sag * F.seepP[i];   // rides the slump
    }
  }
  _out.quake = quake; _out.opening = opening;
  return _out;
}
// a silt plume out of the crack: the stir pulse (k > 0) and n clouds of seabed (plume.js 'big', the
// hammer's: they burst low and out, climb, hang and settle over ~6 s, lit and fogged like silt)
// spread along the middle of the crack
function burst(zi, k, size, n, salt) {
  const F = FISSURE[zi], Fz = Z[zi];
  if (k > 0) stirPulse(F.cx, jamYAt(0, zi, terrainH), F.cz, 40, 0, k, k >= 1 ? P_STRIKE : P_SLAM);
  for (let j = 0; j < n; j++) {
    const h = ((j + salt * 3.7) * 0.618 + 0.31) % 1;
    const u = (-0.6 + 1.2 * (j + 0.3 + 0.4 * h) / n) * F.halfLen, wd = _widths(F, u);
    const v = (h * 2 - 1) * 0.35 * (j & 1 ? wd.w1 : wd.w0);
    fissureWorld(u, v, zi, _w);
    spawnPlume(_w.x, jamYAt(u, zi, terrainH) - Fz.sag * jamSagProfile(u, v, zi), _w.z, 'big', size, zi);
  }
  plumeOwn = 8;
}
// Write the jam's pose at opening time T (< 0: at rest). The silt goes once it has dropped out of
// sight; the boulders once every one has come to rest on the throat floor (or ROCK_T has passed).
function pose(zi, T) {
  const Fz = Z[zi], B = Fz.B, n = Fz.n;
  const rest = T < 0, sagV = rest ? 0 : sagAt(Math.min(T, T_OPEN));
  const jostle = rest ? 0 : 0.03 * Fz.q;
  let topMax = -1e9, moving = 0;
  for (let i = 0; i < n; i++) {
    const o = i * BS, p = B[o + 17];
    let v = B[o + 1], y = B[o + 2] - sagV * p, ang = 0;
    _q.set(B[o + 6], B[o + 7], B[o + 8], B[o + 9]);
    if (!rest && T >= B[o + 10]) {
      const D = Math.max(0, B[o + 2] - sagV * p - B[o + 11]), tL = fallTime(D);
      let tau = T - B[o + 10];
      if (tau < tL) moving++; else tau = tL;
      const fall = Math.min(D, fallAt(tau));
      y -= fall;
      v += (B[o + 12] - v) * Math.min(1, fall / 6);
      ang = B[o + 16] * tau;
      _ax.set(B[o + 13], B[o + 14], B[o + 15]);
      _q.multiply(_qa.setFromAxisAngle(_ax, ang));
    } else {
      if (!rest) moving++;
      if (jostle > 0) y += jostle * Math.sin(T * 41 + B[o + 19]);
    }
    fissureWorld(B[o], v, zi, _w);
    _m.compose(_p.set(_w.x, y, _w.z), _q, _s.set(B[o + 3], B[o + 4], B[o + 5]));
    Fz.jam.setMatrixAt(i, _m);
    const top = y + (ang === 0 ? B[o + 18] : Math.max(B[o + 3], B[o + 4], B[o + 5]) * 1.3);
    if (top > topMax) topMax = top;
  }
  Fz.topMax = topMax;
  Fz.jam.instanceMatrix.needsUpdate = true;
  Fz.rockOn = rest || (moving > 0 && T < ROCK_T);
  // the silt: sags with the floor, then drops away into the throat (the middle fastest)
  const drop = rest ? 0 : Fz.drop;
  Fz.siltOn = drop < SILT_GONE;
  if (Fz.siltOn) {
    const P = Fz.silt.geometry.attributes.position.array;
    for (let i = 0; i < Fz.nv; i++) {
      const p = Fz.sP[i];
      P[i * 3 + 1] = Fz.sY[i] - sagV * p - drop * (0.35 + 0.65 * p);
    }
    Fz.silt.geometry.attributes.position.needsUpdate = true;
  }
}

// ---- dev surface (probes) -------------------------------------------------------------
// state(zi): the opening's live numbers; siltAt(x, z): the DRAWN silt's height there now (the
// same sag + drop the vertices carry). audit(zi): the shut jam against the floor and the slabs.
function state(zi) {
  const F = Z[zi];
  return {
    k: F.k, t: F.t, quake: F.q, opening: F.t >= 0, bouldersVisible: F.rockOn, siltVisible: F.siltOn, boulderTopMax: F.topMax, n: F.n,
    siltAt(x, z) {
      let best = 1e9, bi = -1;
      const P = F.silt.geometry.attributes.position.array;
      for (let i = 0; i < F.nv; i++) { const dx = P[i * 3] - x, dz = P[i * 3 + 2] - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
      return bi < 0 ? NaN : P[bi * 3 + 1];
    }
  };
}
function audit(zi) {
  const F = Z[zi], P = F.silt.geometry.attributes.position.array, B = F.B, FS = FISSURE[zi];
  let floorErr = 0, slabGap = 1e9, inSlabN = 0, topMid = -1e9, topWall = -1e9, dropMin = 1e9;
  for (let i = 0; i < F.nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const j = jamAt(x, z, zi), h = terrainH(x, z, zi);
    if (slabProbe(x, z, zi).q >= 0) slabGap = Math.min(slabGap, Math.abs(y - h));
    else if (j > h + 0.1) floorErr = Math.max(floorErr, Math.abs(y - shutFloorY(x, z, zi)));
  }
  for (let i = 0; i < F.n; i++) {
    const o = i * BS; fissureWorld(B[o], B[o + 1], zi, _w);
    if (slabProbe(_w.x, _w.z, zi).q >= 0) inSlabN++;
    dropMin = Math.min(dropMin, B[o + 2] - B[o + 11]);
    const wd = _widths(FS, B[o]), w = B[o + 1] >= 0 ? wd.w1 : wd.w0;
    const over = B[o + 2] + B[o + 18] - jamYAt(B[o], zi, terrainH);
    if (Math.abs(B[o + 1]) < 0.6 * w) topMid = Math.max(topMid, over); else topWall = Math.max(topWall, over);
  }
  return { floorErr: +floorErr.toFixed(3), slabGap: +slabGap.toFixed(3), boulders: F.n, inSlab: inSlabN, dropMin: +dropMin.toFixed(1), topMid: +topMid.toFixed(2), topWall: +topWall.toFixed(2),
    seeps: F.seep.length, seepFogOff: F.seep.every(s => s.material.fog === false), lip: +lipMeanY(zi, terrainH).toFixed(2), shut: fissureShut(zi) };
}
export const __fissure = { setOpen: setFissureOpen, open: openFissure, k: fissureOpenK, state, audit, programs: () => renderer.info.programs.length,
  progList: () => renderer.info.programs.map(p => p.id + '|' + p.name + '|' + p.cacheKey.length),
  // which drawables use program id (dev: first-sight audits)
  progUsers: id => { const out = []; scene.traverse(o => { const m = o.material; if (!m || Array.isArray(m)) return; const pr = renderer.properties.get(m).currentProgram;
    if (pr && pr.id === id) { let q = o, path = ''; for (let d = 0; d < 4 && q; d++, q = q.parent) path += (q.name || q.type) + '<'; out.push(path + ' ' + m.type); } }); return out; },
  // the program ids the jam, silt and seep draw with (each must exist before first sight)
  ownProgs: () => { const out = []; for (const F of Z) for (const o of [F.jam, F.silt, F.seep[0]]) { const pr = renderer.properties.get(o.material).currentProgram; out.push(o.name + ':' + (pr ? pr.id : 'none')); } return out; },
  progKey: id => { const p = renderer.info.programs.find(q => q.id === id); return p ? p.cacheKey : null; } };
if (typeof window !== 'undefined') window.__fissure = __fissure;
