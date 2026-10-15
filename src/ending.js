// Ending cinematic. OWNED BY: ending agent.
//
// Contract with game.js:
//   startEnding()        — called once when the last rift is passed (state -> 'won').
//   updateEnding(dt, t)  — called every frame while state === 'won'. Owns player.pos
//                          and the camera outright; game.js runs no player input,
//                          no updateCamera, and no HUD writes while it runs.
//                          game.js keeps atmosphere/lighting fed from player.pos.y,
//                          so ascending the water column brightens on its own.
//
// Structure: one monotonic clock T, five beats read off it, everything else derived.
// Nothing allocates after startEnding() — meshes, materials, the bubble buffer and the
// vector temps are all built once (lazily, on the first win) and then only written to.
import * as THREE from 'three';
import { camera, scene } from './core.js';
import { player } from './player.js';
import { zoneTop, zoneBottom, riftPos, RIFT_R } from './config.js';
import { terrainH } from './world/terrain.js';
import { FISSURE, fissureWorld, _widths } from './world/fissureShape.js';
import { clamp, V3 } from './lib/math.js';
import { glowTex as sharedGlowTex } from './lib/textures.js';
import { updateDiver, lanternWorldPos } from './entities/diver.js';
import { lanternLight, playerLightSrc } from './lighting.js';
import { raft } from './systems/raft.js';
import { setTetherVisible } from './systems/tether.js';
import { hidePredators } from './world/predators.js';
import { hideFauna } from './world/fauna.js';   // FAUNA PATCH
import { chime, setCalm, setSpeed, setWalking, setLight } from './audio.js';

// ---------------------------------------------------------------- beat timings (s)
const T_STILL = 6.5;        // hold on the diver at the bottom of the rift
const T_RISE_END = 52.0;    // he breaks into the shallows
const T_SURF_END = 60.0;    // last held frame before the wipe starts
const T_FADE = 3.0;         // black wipe
const T_CARD = T_SURF_END + T_FADE;
const T_LINE2 = T_CARD + 1.4;
const T_LINE3 = T_CARD + 8.6;
const T_HINT = T_CARD + 11.0;

const SURFACE_END_Y = -8;   // where the ascent lands him, just under the light

// ---------------------------------------------------------------- small math
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
// Half power-ease-in, half smoothstep: he leaves the floor at ~9 u/s, opens out to ~25
// through the middle, and eases back to ~17 as the light arrives. This curve is the
// whole feeling of "the trench releases him". A pure sigmoid was tried first and read
// wrong — it held him almost motionless for fifteen seconds, then bolted at 33 u/s.
function ascentCurve(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return 0.5 * Math.pow(u, 1.7) + 0.5 * u * u * (3 - 2 * u);
}

// ---------------------------------------------------------------- the ascent path
// He leaves the way he came: up through the three opened fissures, in order. All three zone
// terrains stay in the scene for the whole cinematic, so a straight lerp from the zone-2
// rift to the raft drove him through two solid seafloors in open water. The only places
// the floors may be crossed are the fissures' throats at riftPos — the game already reads a
// rift transit as sinking through a throat floor, because that is what normal play does.
//
// The path is a spline through seven points, built once. Its shape is dictated by two
// rules, and every waypoint is one of them:
//   * before moving sideways off a rift, rise CLEAR above the highest ground the corridor
//     to the next rift crosses in the zone he has just left;
//   * arrive at the next rift still DIP below the lowest ground of the zone above (and its
//     throat floor), so the floor he is about to break through is only ever crossed at the
//     throat, rising straight up the crack.
// Both levels are measured off terrainH at startEnding rather than hardcoded: the
// heightfield is seeded and identical every load, but a terrain retune would silently
// invalidate numbers baked in here.
const CLEAR = 18;      // headroom over the floor he is leaving, before he tracks sideways
const DIP = 14;        // how far below the next floor he must still be when he reaches it
const CORR_N = 56;     // corridor samples per leg
const PATH_N = 320;    // y -> x/z table resolution

// Highest ground of zone zi anywhere along the a->b corridor.
function corridorMax(a, b, zi) {
  let m = -Infinity;
  for (let i = 0; i <= CORR_N; i++) {
    const t = i / CORR_N;
    const h = terrainH(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, zi);
    if (h > m) m = h;
  }
  return m;
}
// Lowest ground of zone zi along the corridor, ignoring a RIFT_R * 2.8 circle round its rift —
// the crack there is the way he is aiming for (buildPath takes its throat floor separately),
// and counting it here would drag the arrival level down under the seafloor he is meant to stay
// beneath until he is in the crack.
function corridorMin(a, b, zi) {
  const rp = riftPos(zi), rr = RIFT_R * 2.8;
  let m = Infinity;
  for (let i = 0; i <= CORR_N; i++) {
    const t = i / CORR_N;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    if (Math.hypot(x - rp.x, z - rp.z) < rr) continue;
    const h = terrainH(x, z, zi);
    if (h < m) m = h;
  }
  return m;
}

let pathY = null, pathX = null, pathZ = null;
// The higher of a crack's two lips at riftPos (u = 0), 2 u outside each.
const _lw = { x: 0, z: 0 };
function lipTop(zi) {
  const W = _widths(FISSURE[zi], 0), w0 = W.w0, w1 = W.w1;
  fissureWorld(0, w1 + 2, zi, _lw); const a = terrainH(_lw.x, _lw.z, zi);
  fissureWorld(0, -(w0 + 2), zi, _lw); const b = terrainH(_lw.x, _lw.z, zi);
  return Math.max(a, b);
}
// Per-rift transit bands, for the camera: [just under the throat floor, where he clears the crack].
const trY0 = new Float32Array(3), trY1 = new Float32Array(3);
const trX = new Float32Array(3), trZ = new Float32Array(3);
const _pts = [];        // the seven control points, reused across wins
const _path = V3(), _ahead = V3();
const _fw = { x: 0, z: 0 };   // fissureWorld scratch for the camera

function buildPath(sx, sy, sz, endX, endZ) {
  const r2 = riftPos(2), r1 = riftPos(1), r0 = riftPos(0);
  const end = { x: endX, z: endZ };
  // Clearance level above each floor he leaves, and arrival level under each floor above.
  const yA = corridorMax(r2, r1, 2) + CLEAR;   // clear of the zone-2 floor
  // THE FISSURE (2026-10-10): the opening is a narrow crack whose throat floor lies ~70 u under
  // its lip, so arriving just under the general floor would track sideways through the crack's
  // walls. Arrive under the throat floor at the rift (terrainH at riftPos) and rise up the crack.
  const yB = Math.min(corridorMin(r2, r1, 1), terrainH(r1.x, r1.z, 1)) - DIP;   // under zone 1's floor and its throat
  const yC = corridorMax(r1, r0, 1) + CLEAR;   // clear of the zone-1 floor
  const yD = Math.min(corridorMin(r1, r0, 0), terrainH(r0.x, r0.z, 0)) - DIP;   // under zone 0's floor and its throat
  const yE = corridorMax(r0, end, 0) + CLEAR;  // clear of the zone-0 floor

  // THE FISSURE: each opening is a crack ~5 u either side of riftPos, and a spline corner bleeds
  // sideways ~8 u (the old 43 u bowl absorbed it). Pin the transit vertical: a point just under
  // each throat floor and one just over each lip, both on riftPos, so the segment between them has
  // vertical tangents at both ends and runs straight up the crack.
  const tf = [terrainH(r0.x, r0.z, 0), terrainH(r1.x, r1.z, 1), terrainH(r2.x, r2.z, 2)];
  const lp = [lipTop(0), lipTop(1), lipTop(2)];
  _pts.length = 0;
  _pts.push(new THREE.Vector3(sx, sy, sz));
  if (lp[2] + 8 < yA - 4) _pts.push(new THREE.Vector3(r2.x, lp[2] + 8, r2.z));
  _pts.push(new THREE.Vector3(r2.x, yA, r2.z));
  _pts.push(new THREE.Vector3(r1.x, yB, r1.z));
  if (tf[1] - 4 > yB + 2) _pts.push(new THREE.Vector3(r1.x, tf[1] - 4, r1.z));
  if (lp[1] + 8 < yC - 4) _pts.push(new THREE.Vector3(r1.x, lp[1] + 8, r1.z));
  _pts.push(new THREE.Vector3(r1.x, yC, r1.z));
  _pts.push(new THREE.Vector3(r0.x, yD, r0.z));
  if (tf[0] - 4 > yD + 2) _pts.push(new THREE.Vector3(r0.x, tf[0] - 4, r0.z));
  if (lp[0] + 8 < yE - 4) _pts.push(new THREE.Vector3(r0.x, lp[0] + 8, r0.z));
  _pts.push(new THREE.Vector3(r0.x, yE, r0.z));
  _pts.push(new THREE.Vector3(end.x, SURFACE_END_Y, end.z));

  // Centripetal parameterisation, not uniform: the four right-angle corners where a
  // vertical hold turns into a lateral leg made the uniform curve loop out past the rift
  // and swing back, which put him through the rift's wall on the way in.
  const curve = new THREE.CatmullRomCurve3(_pts, false, 'centripetal', 0.5);
  let prev = -Infinity;
  for (let i = 0; i < PATH_N; i++) {
    curve.getPoint(i / (PATH_N - 1), _path);
    // y is only ever read as a key, and the caller's y is monotonic by construction, so
    // the table must be too — the spline can still shave a fraction of a unit backwards
    // through a corner.
    const y = _path.y > prev ? _path.y : prev + 1e-4;
    prev = y;
    pathY[i] = y; pathX[i] = _path.x; pathZ[i] = _path.z;
  }

  const rr = [r0, r1, r2];
  const top = [yE, yC, yA];
  for (let i = 0; i < 3; i++) {
    trX[i] = rr[i].x; trZ[i] = rr[i].z;
    trY0[i] = terrainH(rr[i].x, rr[i].z, i) - 22;   // just under the throat floor at riftPos
    trY1[i] = top[i];
  }
}

// x/z for a given depth. Binary search rather than a walking cursor: the yaw look-ahead
// queries a second, deeper key each frame and would fight a cursor. No allocation.
function pathAt(y, out) {
  const last = PATH_N - 1;
  if (y <= pathY[0]) { out.set(pathX[0], y, pathZ[0]); return out; }
  if (y >= pathY[last]) { out.set(pathX[last], y, pathZ[last]); return out; }
  let lo = 0, hi = last;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pathY[m] <= y) lo = m; else hi = m; }
  const y0 = pathY[lo], y1 = pathY[hi];
  const t = y1 > y0 ? (y - y0) / (y1 - y0) : 0;
  out.set(pathX[lo] + (pathX[hi] - pathX[lo]) * t, y, pathZ[lo] + (pathZ[hi] - pathZ[lo]) * t);
  return out;
}

// Is a point close enough under one of the three heightfields to eat the frame? The band is
// deliberately shallow. A floor is a surface, not a solid: 70u below one is the open water
// column of the zone beneath — where most of the ascent happens — and its backfaces are
// culled, so it costs nothing. It is the first few metres under the skin that fill the lens
// with rock, and those are the only ones worth steering out of.
const UNDER = 26;
function insideFloor(x, y, z) {
  for (let zi = 0; zi < 3; zi++) {
    if (y < zoneBottom(zi) - 62) continue;
    if (y > zoneBottom(zi) + 190) continue;
    const h = terrainH(x, z, zi);
    if (y < h + 1.8 && y > h - UNDER) return true;
  }
  return false;
}

// Does the lens at (cx, cy, cz) see the point (px, py, pz)? Marched in 0.5 u steps against every zone's
// heightfield within 40 u: blocked where the line goes from over a floor to under it (it enters the rock
// from the water side: a front face as drawn, the throat walls included); from under a floor up through
// it is a culled back face, not a block. No allocation.
function losClear(cx, cy, cz, px, py, pz) {
  const d = Math.hypot(px - cx, py - cy, pz - cz), n = Math.max(8, Math.ceil(d / 0.5));
  let prev = sideOf(cx, cy, cz);
  for (let k = 1; k < n; k++) {
    const f = k / n, a = sideOf(cx + (px - cx) * f, cy + (py - cy) * f, cz + (pz - cz) * f);
    if (prev > 0 && a < 0) return false;
    if (a !== 0) prev = a;
  }
  return true;
}
// +1 over the floor of the zone whose floor lies within 40 u of y, -1 under it, 0 in the open water between
function sideOf(x, y, z) {
  for (let zi = 0; zi < 3; zi++) {
    const h = terrainH(x, z, zi);
    if (y - h < 40 && h - y < 40) return y > h ? 1 : -1;
  }
  return 0;
}

// ---------------------------------------------------------------- sleeper silhouettes
// Deliberately NOT the real leviathan module: these are tapered spines of scaled spheres
// with an additive cyan wash, read at 43-72u through the fog. Ordered deepest-pass-first
// (zone 2, then 1, then 0) so each pass is closer and slower than the one before.
// bearing is a world direction from the diver, measured as (cos b, sin b) in x/z.
// The first pass used to sit at bearing 0.55 — outward from rift 2, which was harmless
// while the ascent barely moved sideways. Now that the path tracks rift 2 -> rift 1 it
// threw the body out past r=240 and buried its nose in the basin rim; 4.2 keeps the whole
// 118u body 80u clear of the zone-2 floor while still crossing the frame.
// THE THREE SLEEPERS (roadmap/three-sleepers.md): each pass is its own animal now, not
// three eels. Mhor streams through tail-first, arms trailing; Orune jets by, sac leading
// and eight arms pulsing behind; Velkath WALKS home along the zone-0 floor beneath him
// (`floor`: pinned to the seabed, the diver looks down at her as he rises).
const SLEEPERS = [
  { kind: 'squid', yFrom: -840, yTo: -670, dist: 72, len: 118, rad: 9.5, segs: 34, travel: 205, bearing: 4.2, note: 233, tint: 0xffa060 },
  { kind: 'octopus', yFrom: -560, yTo: -380, dist: 57, len: 100, rad: 12.0, segs: 30, travel: 165, bearing: 2.75, note: 262, tint: 0xd8a8ff },
  // her pass is timed to the moment he rises past the zone-0 floor, so she walks by at eye level (yFrom / yTo: on main's
  // home ground; startEnding moves the window with the ground under her, floorShift below)
  { kind: 'crab', yFrom: -300, yTo: -170, dist: 50, len: 84, rad: 13.0, segs: 26, travel: 110, bearing: 4.65, note: 311, tint: 0xcfe9d6, floor: 0 }
];
// A FLOOR PASS'S WINDOW IS MEASURED OFF HER GROUND (seafloor relief, final review I1). Velkath walks the zone-0 floor (gy in
// updateEnding), so where he rises past her eye level within her window depends on how deep that floor lies, and the window
// above was tuned on main's home ground: there he passes her eye level at uu 0.455 and she walks 7 u under him at uu 0.5. The
// relief's hollow lies 27 u deeper under her pass, and the same hard-coded window put the crossing at uu 0.26 (34 u under
// him at mid-pass). So, by this file's rule (levels are measured off terrainH at startEnding, never hard-coded), startEnding
// moves a floor pass's whole window by `ys`: the ground under her at mid-pass (uu 0.5, her anchor carried as updateEnding
// carries it) less FLOOR_G0, that ground on main's home. FLOOR_G0 is the exact double (read live on main, and on the relief
// with its rows removed), so main's window is -300 / -170 bit for bit. Four fixed-point rounds: the window moves where he is
// when she goes live, so where she walks. The swimmers keep ys 0 (their windows are open water, gy off yFrom).
const FLOOR_G0 = -249.2839673401641;
const FOLLOW = 0.85;          // her anchor follows this share of his sideways travel (updateEnding)
const _fa = V3(), _fm = V3();
function floorShift(sp) {
  let s = 0;
  for (let k = 0; k < 4; k++) {
    pathAt(sp.yFrom + s, _fa);                        // where she goes live: her anchor is where he is
    pathAt(0.5 * (sp.yFrom + sp.yTo) + s, _fm);       // mid-pass: no offset along her travel
    const ax = _fa.x + (_fm.x - _fa.x) * FOLLOW, az = _fa.z + (_fm.z - _fa.z) * FOLLOW;
    s = terrainH(ax + Math.cos(sp.bearing) * sp.dist, az + Math.sin(sp.bearing) * sp.dist, sp.floor) - FLOOR_G0;
  }
  return s;
}

let built = false;
let bubbles = null, bubbleData = null, bubblePos = null;
const _v = V3(), _lant = V3();
const _bodyCol = new THREE.Color(), _darkCol = new THREE.Color();

// One soft radial dot, shared by every glow sprite and by the bubbles. This used to be
// a private 64px duplicate of lib/textures' glowTex; the shared 128px one has the same
// soft-falloff profile and the sprites are scaled anyway, so the duplicate is gone.
const glowTex = () => sharedGlowTex;

function makeSleeper(spec) {
  const grp = new THREE.Group();
  grp.visible = false;
  // Opaque on purpose. As a transparent material the ~3 overlapping segments along any
  // view ray stacked their alpha, drawing a chain of lens-shaped seams down the body.
  // The fade in and out of the pass is done by lerping the colour to the water instead
  // — hand-rolled fog, which is what fog:false gave up in exchange for control.
  const body = new THREE.MeshBasicMaterial({ color: 0x061019, fog: false });
  // Glow is sprites, not geometry. Additive low-poly spheres were tried twice and both
  // times the flat, falloff-free fill drew hard faceted edges in the frame; a radial
  // gradient billboard is the only cheap way to get a soft bloom underwater.
  const haze = new THREE.SpriteMaterial({
    color: spec.tint, map: glowTex(), transparent: true, opacity: 0, fog: false,
    depthWrite: false, blending: THREE.AdditiveBlending
  });
  const glow = new THREE.SpriteMaterial({
    color: spec.tint, map: glowTex(), transparent: true, opacity: 0, fog: false,
    depthWrite: false, blending: THREE.AdditiveBlending
  });
  const geo = new THREE.SphereGeometry(1, 14, 10);
  // Parts: a mesh (or sprite), a base position in the animal's frame (+Z = the way it
  // travels), and a motion kind the pose loop reads. Chains (arms, legs) are runs of
  // stretched spheres, each link offset from the last.
  const parts = [];
  const R = spec.rad, L = spec.len;
  const blob = (sx, sy, sz, x, y, z, mot = 'body', k = 0, n = 1) => {
    const m = new THREE.Mesh(geo, body);
    m.scale.set(sx, sy, sz);
    m.renderOrder = 2;
    grp.add(m);
    parts.push({ m, bx: x, by: y, bz: z, mot, k, n });
    return m;
  };
  const light = (x, y, z, s) => {
    const g = new THREE.Sprite(glow);
    g.scale.set(s, s, 1);
    g.renderOrder = 3;
    grp.add(g);
    parts.push({ m: g, bx: x, by: y, bz: z, mot: 'body', k: 0, n: 1 });
  };
  const hazeAt = (x, y, z, s) => {
    const h = new THREE.Sprite(haze);
    h.scale.set(s, s * 0.8, 1);
    h.renderOrder = 1;
    grp.add(h);
    parts.push({ m: h, bx: x, by: y, bz: z, mot: 'body', k: 0, n: 1 });
  };
  if (spec.kind === 'squid') {
    // tail (fins) leads at +Z, the mantle a long torpedo, the head, then arms trailing
    const M = 14;
    for (let k = 0; k < M; k++) {
      const u = k / (M - 1), prof = Math.pow(Math.sin(Math.PI * (0.08 + 0.84 * u)), 0.6) * (0.35 + 0.65 * u);
      blob(R * prof, R * prof * 0.9, L * 0.05, 0, 0, L * (0.5 - 0.45 * u), 'body');
    }
    for (const sx of [-1, 1]) { const f = blob(R * 1.1, R * 0.06, L * 0.09, sx * R * 0.55, 0, L * 0.44, 'fin', sx); f.rotation.z = sx * 0.1; }
    blob(R * 0.9, R * 0.85, R * 1.1, 0, 0, L * 0.02, 'body');            // the head
    for (let a = 0; a < 10; a++) {
      const ang = (a + 0.5) / 10 * Math.PI * 2, tent = a < 2, len = L * (tent ? 0.75 : 0.45), n = tent ? 9 : 6;
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, r = R * (tent ? 0.10 : 0.22) * (1 - 0.7 * u) + 0.2;
        blob(r, r, len / n * 0.85, Math.cos(ang) * R * 0.35 * (1 + u), Math.sin(ang) * R * 0.35 * (1 + u), -len * u, 'arm', a, u);
      }
    }
    for (let k = 0; k < 8; k++) light((k & 1 ? 1 : -1) * R * 0.75, 0, L * (0.4 - k * 0.07), R * 0.18);
    hazeAt(0, 0, L * 0.2, R * 4);
  } else if (spec.kind === 'octopus') {
    // the sac leads, swollen and tilted back; eight arms pulse behind it (a jet swim)
    blob(R * 0.9, R * 0.8, R * 1.4, 0, R * 0.3, R * 0.4, 'body');
    blob(R * 0.75, R * 0.65, R * 0.8, 0, 0, -R * 0.5, 'body');         // the head
    for (const sx of [-1, 1]) light(sx * R * 0.55, R * 0.05, -R * 0.35, R * 0.22);  // eyeshine
    for (let a = 0; a < 8; a++) {
      const ang = (a + 0.5) / 8 * Math.PI * 2, n = 9, len = L * 0.7;
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, r = R * 0.18 * (1 - 0.8 * u) + 0.2;
        blob(r, r, len / n * 0.8, Math.cos(ang) * R * 0.45, Math.sin(ang) * R * 0.45, -R * 0.8 - len * u, 'jet', a, u);
      }
    }
    for (let k = 0; k < 4; k++) light((k & 1 ? 1 : -1) * R * 0.25, -R * 0.25, -R * 0.8 - L * 0.1 * (k + 1), R * 0.12);   // the burning wards
    hazeAt(0, R * 0.2, 0, R * 3.4);
  } else {
    // the Brooder walking: a low wedge of shell, eight legs stepping, the great claw
    blob(R * 1.0, R * 0.34, R * 0.85, 0, 0, 0, 'body');
    blob(R * 0.55, R * 0.22, R * 0.45, 0, R * 0.22, -R * 0.1, 'body');   // the hump
    for (let l = 0; l < 8; l++) {
      const sd = l < 4 ? 1 : -1, j = l & 3, z = R * (0.55 - j * 0.36);
      blob(R * 0.55, R * 0.10, R * 0.10, sd * R * 1.15, -R * 0.05, z, 'legA', l);     // femur, out and up
      blob(R * 0.10, R * 0.55, R * 0.10, sd * R * 1.65, -R * 0.45, z, 'legB', l);     // tibia, down to the floor
    }
    blob(R * 0.55, R * 0.28, R * 0.40, R * 0.75, R * 0.10, R * 1.05, 'body');          // the great claw
    blob(R * 0.30, R * 0.16, R * 0.25, -R * 0.55, -R * 0.05, R * 0.95, 'body');         // the minor
    for (const sx of [-1, 1]) light(sx * R * 0.12, R * 0.05, R * 0.85, R * 0.12);       // eyeshine
    hazeAt(0, 0, 0, R * 3);
  }
  const segs = parts, deco = [], N = parts.length;
  scene.add(grp);
  return { grp, segs, deco, parts, kind: spec.kind, body, haze, glow, N, ax: 0, az: 0, seen: false, live: false };
}

const NBUB = 260;
function buildOnce() {
  if (built) return;
  built = true;
  for (const s of SLEEPERS) s.obj = makeSleeper(s);
  pathY = new Float32Array(PATH_N);
  pathX = new Float32Array(PATH_N);
  pathZ = new Float32Array(PATH_N);

  bubblePos = new Float32Array(NBUB * 3);
  bubbleData = new Float32Array(NBUB * 3);   // rise speed, wobble radius, phase
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.26, map: glowTex(), color: 0xcdeeff, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true
  });
  bubbles = new THREE.Points(geo, mat);
  bubbles.frustumCulled = false;
  bubbles.visible = false;
  scene.add(bubbles);
  buildCard();
}

function respawnBubble(i, initial) {
  const a = Math.random() * Math.PI * 2;
  // Keep them off the lens: a bubble spawned a metre from the camera fills the frame.
  const r = 2.6 + Math.random() * 12;
  bubblePos[i * 3] = player.pos.x + Math.cos(a) * r;
  bubblePos[i * 3 + 1] = player.pos.y + (initial ? Math.random() * 44 - 18 : -16 - Math.random() * 8);
  bubblePos[i * 3 + 2] = player.pos.z + Math.sin(a) * r;
  bubbleData[i * 3] = 3.5 + Math.random() * 7;
  bubbleData[i * 3 + 1] = 0.35 + Math.random() * 0.9;
  bubbleData[i * 3 + 2] = Math.random() * 6.28;
}

// ---------------------------------------------------------------- title card DOM
let card = null, cLine1 = null, cLine2 = null, cLine3 = null, cHint = null, cRule = null;
function buildCard() {
  const st = document.createElement('style');
  // Typography lifted from index.html's title block: Georgia, wide letterspacing,
  // uppercase smallcaps, #d8f4f7 with the same cyan bloom. @keyframes pulse is global.
  st.textContent = `
  #endcard{position:fixed;inset:0;z-index:40;pointer-events:auto;background:#01060a;opacity:0;
    display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
    font-family:Georgia,'Times New Roman',serif;color:#d8f4f7;cursor:pointer;
    transition:opacity ${T_FADE}s linear}
  #endcard .ec1{font-size:clamp(2.2rem,7.5vw,5.6rem);letter-spacing:.45em;margin:0 0 0 .45em;
    font-weight:400;text-shadow:0 0 34px rgba(120,220,255,.45);opacity:0;transition:opacity 4s ease-in}
  #endcard .ec2{letter-spacing:.32em;font-size:.92rem;text-transform:uppercase;opacity:0;
    color:#bfe3e8;transition:opacity 3.6s ease-in;margin:1.6em 0 0 .32em}
  #endcard .ec3{letter-spacing:.28em;font-size:.72rem;text-transform:uppercase;opacity:0;
    color:#9fc9d2;transition:opacity 4.5s ease-in;margin:3.6em 0 0 .28em}
  #endcard .ec4{letter-spacing:.24em;font-size:.66rem;text-transform:uppercase;opacity:0;
    color:#8fb6bf;transition:opacity 2.5s ease-in;margin:5.5em 0 0 .24em}
  #endcard .ec4.on{animation:pulse 3.4s infinite}
  #endcard .rule{width:min(220px,34vw);height:1px;margin:2.2em 0 0 0;opacity:0;
    transition:opacity 4s ease-in;background:linear-gradient(90deg,
      rgba(190,225,232,0),rgba(190,225,232,.45),rgba(190,225,232,0))}`;
  document.head.appendChild(st);

  card = document.createElement('div');
  card.id = 'endcard';
  cLine1 = document.createElement('div'); cLine1.className = 'ec1'; cLine1.textContent = 'A B Y S S A';
  cRule = document.createElement('div'); cRule.className = 'rule';
  cLine2 = document.createElement('div'); cLine2.className = 'ec2'; cLine2.textContent = 'the trench is quiet.';
  cLine3 = document.createElement('div'); cLine3.className = 'ec3'; cLine3.textContent = 'three sleepers rest · one light returns';
  cHint = document.createElement('div'); cHint.className = 'ec4'; cHint.textContent = 'click to surface again';
  card.append(cLine1, cRule, cLine2, cLine3, cHint);
  card.addEventListener('click', () => { if (T >= T_CARD) location.reload(); });
  document.body.appendChild(card);
}

// game.js stops calling updateTether once the ending owns the frame, so the umbilical
// freezes mid-simulation and hangs across the shot as a rigid grey wire from nowhere.
// tether.js exports no handle to its mesh and is not mine to change, so it is found by
// shape (the only 63-instance cylinder in the scene) and hidden. The line has done its
// job by now; the last beat is a man rising free of everything that held him.
function hideTether() {
  scene.traverse(o => {
    if (o.isInstancedMesh && o.count === 63 && o.geometry.type === 'CylinderGeometry') o.visible = false;
  });
}

// ---------------------------------------------------------------- state
let T = -1, startY = -900, startX = 0, startZ = 0, lastY = -900;
let camAz = 0, camDist = 8.5, camHeight = 1.9, camFov = 62, camRoll = 0, lookLift = 0, camPull = 0;
// THE THROAT, SEEN (final fix wave M5). Two things hid him in the open throats (fissure-probe `ending`):
//   - the floor's skin: he rises the last ~14 u to each throat floor UNDER it, on riftPos, while the lens
//     rode 5-12 u above him, over the floor: he was inside the rock with the lens on the other side (74
//     frames of 4500, 19/3/52 by zone). So while he is under the floor of the crack he is threading, the
//     lens is held under it too (at its own column's floor less FLOOR_UNDER), released on a decay once he
//     is through: from below the floor is a back face (culled) and he is seen rising through it.
//   - the kinks: the orbit is held along the crack's line at the arm's length, and the deep shaft kinks
//     and pinches: the line from the lens to him ran into a wall (292 rise frames). While he threads a
//     crack, the arm is shortened to the longest of LOS_F that sees him (a heightfield march from the lens
//     to his chest: no entry into the rock from the water side), the lost reach put back as height (the
//     shaft widens upward); fast in, slow out.
const FLOOR_UNDER = 1.5, UNDER_HIM = 1.5, LOS_F = [1, 0.8, 0.64, 0.5, 0.38, 0.28, 0.2], LOS_RAISE = 1.0, DROP_RATE = 45, LENS_REL = 40, LENS_ABS = 58;
let losF = 1, floorDrop = 0, lensPrevOk = false;
const lensPrev = V3(), diverPrev = V3();
let endX = 34, endZ = 27;
let cardOn = false, l2 = false, l3 = false, hintOn = false;
let yawF = 0, pitchF = 0;

export function startEnding() {
  buildOnce();
  card.style.display = '';   // (abortEnding puts the card away entirely: it takes clicks)
  T = 0;
  startY = player.pos.y;
  startX = player.pos.x;
  startZ = player.pos.z;
  // In play he has just sunk through zone 2's throat floor when this fires (the trigger is
  // zoneBottom(2) - 70). The debug hook drops him at the origin instead, 70u under the seafloor and
  // 118u off the rift — from there the first leg would drag him through the zone-2 floor
  // from below. Either way the shot starts under the rift, so put him there.
  // THE FISSURE: he now falls through anywhere along a ~70 u crack, and the trigger
  // (zoneBottom(2) - 70) lies only a few units under its throat floor, so an off-centre start held
  // the lens in the floor's skin through the whole STILL beat (199 of 4500 frames, measured from a
  // real fall 12 u along the crack). The STILL beat is the cut: always start on riftPos, under the
  // throat, in open water.
  const r2 = riftPos(2);
  startX = r2.x; startZ = r2.z;
  player.pos.x = startX; player.pos.z = startZ;
  const under = terrainH(startX, startZ, 2) - 28;
  if (startY > under) { startY = under; player.pos.y = startY; }
  // Far enough out that the raft reads as a small silhouette on the ceiling of light.
  // At 9u it filled the upper third of the frame with hull logs and float barrels.
  endX = raft.position.x + 34; endZ = raft.position.z + 27;
  buildPath(startX, startY, startZ, endX, endZ);
  for (const s of SLEEPERS) s.ys = s.floor != null ? floorShift(s) : 0;   // (after the path: her window off her ground)
  lastY = startY;
  player.vel.set(0, 0, 0);
  player.grounded = false;
  player.light = 1;
  yawF = player.yaw;
  pitchF = player.pitch;
  camAz = player.yaw + Math.PI;
  camDist = 8.5; camHeight = 1.9; camFov = 62; camRoll = 0; lookLift = 0; camPull = 0; losF = 1; floorDrop = 0; lensPrevOk = false;
  cardOn = l2 = l3 = hintOn = false;
  for (const s of SLEEPERS) { s.obj.seen = false; s.obj.live = false; s.obj.grp.visible = false; }
  for (let i = 0; i < NBUB; i++) respawnBubble(i, true);
  bubbles.visible = true;
  bubbles.material.opacity = 0;
  bubbles.geometry.attributes.position.needsUpdate = true;
  setCalm(1);
  setWalking(false);
  hideTether();
  hidePredators();   // story-irrelevant during the rite, and frozen once 'won' stops their updates
  hideFauna();       // FAUNA PATCH: same rule
  // The HUD has nothing left to say. Let it go before the ascent starts.
  const ui = document.getElementById('ui');
  if (ui) { ui.style.transition = 'opacity 2.6s ease-in'; ui.style.opacity = '0'; }
  if (document.pointerLockElement) document.exitPointerLock();
  // THE RITE IS A DAY RITE. 'One light returns' needs the light to exist: a rite that
  // fired at night gave 50 s of black water and a lantern. The STILL beat exists to hide
  // a cut, so the weather is scrubbed toward late morning under it (see updateEnding).
  dayScrub = -1;
}

// Take the rite down mid-flight and hand the frame back (the ?playtest jumps; a normal
// game never calls this). Undoes what startEnding did to things outside this module that
// game.js does not rebuild on its own: the HUD fade, the hidden umbilical, the card (which
// takes clicks even while transparent). game.js re-runs the zone (predators, calm) and the
// fauna layout. The silhouettes and bubbles go dark here; updateEnding no longer runs.
export function abortEnding() {
  if (T < 0) return false;
  T = -1;
  if (card) {
    card.style.display = 'none'; card.style.opacity = '0';
    for (const el of [cLine1, cRule, cLine2, cLine3, cHint]) el.style.opacity = '0';
    cHint.classList.remove('on');
  }
  cardOn = l2 = l3 = hintOn = false;
  if (bubbles) bubbles.visible = false;
  for (const s of SLEEPERS) if (s.obj) { s.obj.grp.visible = false; s.obj.live = false; }
  setTetherVisible(true);
  const ui = document.getElementById('ui');
  if (ui) { ui.style.transition = ''; ui.style.opacity = ''; }
  return true;
}

// ---------------------------------------------------------------- force the rite to day
// Late morning on the 12-minute cycle: sunrise is phase 0.25, noon 0.5. The clock only
// ever moves FORWARD (a night rite passes through dawn, not back into the afternoon),
// and it is not touched when the sky is already bright: a clearing storm at noon is
// the ending's own drama and stays. Goes through the weather's dev surface — the one
// scrub API it exposes — never by reaching into weather.js.
const DAY_PHASE = 0.41;
let dayScrub = -1;             // total phase to travel this rite; <0 = not measured yet
function forceRiteToDay(dt) {
  const w = typeof window !== 'undefined' ? window.weather : null;
  if (!w || !w.state || !w.scrub) return;
  const st = w.state();
  if (dayScrub < 0) {
    dayScrub = st.day >= 0.7 ? 0 : ((DAY_PHASE - st.phase01) % 1 + 1) % 1;
    if (dayScrub === 0) return;
  }
  if (dayScrub === 0) return;
  const left = Math.max(0.05, T_STILL - 0.4 - T);          // land before the still beat ends
  const step = Math.min(dayScrub, dayScrub * Math.min(1, dt / left));
  w.scrub(st.phase01 + step);
  dayScrub -= step;
}

// ---------------------------------------------------------------- per-frame
export function updateEnding(dt, t) {
  if (T < 0) return;
  T += dt;

  // ---- the vertical journey: the timeline is authoritative, velocity is derived ----
  const rise = clamp((T - T_STILL) / (T_RISE_END - T_STILL), 0, 1);
  let y;
  if (T <= T_STILL) {
    y = startY + Math.sin(t * 0.5) * 0.12;                       // he only breathes
    forceRiteToDay(dt);
  } else if (T <= T_RISE_END) {
    y = startY + (SURFACE_END_Y - startY) * ascentCurve(rise);
  } else {
    y = SURFACE_END_Y + 3 * smooth(T_RISE_END, T_SURF_END + 6, T) + Math.sin(t * 0.42) * 0.25;
  }
  player.pos.y = y;
  const vy = dt > 0 ? (y - lastY) / dt : 0;
  lastY = y;

  // He drifts home along the rift chain, so the shallows he surfaces in are the raft's and
  // every floor he breaks through is broken through its own hole. Depth is the only
  // parameter: the timeline above owns y, the spline owns where that depth puts him.
  pathAt(y, _path);
  player.pos.x = _path.x;
  player.pos.z = _path.z;
  // A look-ahead down the same table, so he faces the way he is being carried rather than
  // permanently at the raft — for most of the ascent the raft is not where he is going.
  pathAt(y + 52, _ahead);
  player.vel.set(0, vy, 0);
  player.light = 1;

  // ---- sleepers: windows keyed to his depth, so a pass can never miss its zone ----
  let sleeperAz = 0, sleeperFocus = 0, sleeperEl = 0;
  for (let i = 0; i < SLEEPERS.length; i++) {
    const sp = SLEEPERS[i], o = sp.obj;
    const u = (y - sp.yFrom - sp.ys) / (sp.yTo - sp.yFrom);   // (ys: a floor pass's window off her ground, startEnding)
    if (u <= 0 || u >= 1.06) {
      if (o.live) { o.live = false; o.grp.visible = false; }
      continue;
    }
    if (!o.live) {
      o.live = true;
      o.grp.visible = true;
      o.ax = player.pos.x; o.az = player.pos.z;
      o.px = player.pos.x; o.pz = player.pos.z;
    }
    // Anchored in world, but only for FOLLOW's worth of his sideways travel — the rest of
    // it drags the anchor along. A fully world-fixed anchor was fine when the ascent moved
    // 40u sideways in total; on the rift chain he covers 200u inside a single window and
    // left every animal a dot in the fog. 15% of that is 30u of genuine parallax, which is
    // what the fixed anchor used to be worth, and the pass still frames at 40-125u. (FOLLOW
    // 0.85 is declared by SLEEPERS: floorShift carries her anchor the same way.)
    const ax0 = o.ax + (player.pos.x - o.px) * FOLLOW;
    const az0 = o.az + (player.pos.z - o.pz) * FOLLOW;
    const uu = clamp(u, 0, 1);
    if (!o.seen && uu > 0.1) { o.seen = true; chime(sp.note, 5.5, 0.1, 'ending'); chime(sp.note * 1.5, 4.5, 0.055, 'ending'); }

    // it crosses the frame perpendicular to our line of sight, drifting up more slowly
    // than he does, so he overtakes it and it slides away below into the fog
    const off = (uu - 0.5) * sp.travel;
    const hx = Math.cos(sp.bearing + Math.PI / 2), hz = Math.sin(sp.bearing + Math.PI / 2);
    const cx = ax0 + Math.cos(sp.bearing) * sp.dist;
    const cz = az0 + Math.sin(sp.bearing) * sp.dist;
    // The +72 puts the moment their paths cross at uu = 0.5, so the animal is level with
    // him — and dead centre of frame — exactly at the middle of the pass. Without it the
    // crossing landed at uu 0.29 and it spent most of the shot sliding out of the corner.
    const gx = cx + hx * off, gz = cz + hz * off;
    // the Brooder walks the floor; the swimmers cross the water column
    const gy = sp.floor != null ? terrainH(gx, gz, sp.floor) + sp.rad * 0.55 : sp.yFrom + 72 + 40 * uu;
    o.grp.position.set(gx, gy, gz);
    // A dead-level body reads as a bar across the frame; a few degrees of climb and
    // roll is the difference between a shape and something swimming.
    o.grp.rotation.set(sp.floor != null ? 0 : -0.06 + Math.sin(t * 0.07 + i) * 0.03, Math.atan2(hx, hz), sp.floor != null ? 0 : -0.05 + Math.sin(t * 0.05 + i) * 0.05);

    // each animal's own motion, slow — the later (closer) passes slower still
    const ph = t * (0.42 - i * 0.09);
    const R = sp.rad, jet = 0.5 + 0.5 * Math.sin(t * 0.9);
    for (let k = 0; k < o.parts.length; k++) {
      const p = o.parts[k];
      let x = p.bx, y = p.by, z = p.bz;
      if (p.mot === 'arm') {                  // trailing arms, a slow wave down each
        x += Math.sin(ph * 1.3 - p.n * 3 + p.k) * R * 0.5 * p.n;
        y += Math.cos(ph * 1.1 - p.n * 3 + p.k * 1.7) * R * 0.4 * p.n;
      } else if (p.mot === 'fin') {
        y += Math.sin(ph * 3) * R * 0.25 * Math.abs(p.bx) / R;
      } else if (p.mot === 'jet') {           // arms close together and flare out: the jet pulse
        const k2 = 0.55 + 0.9 * jet;
        x *= k2; y *= k2;
        x += Math.sin(ph - p.n * 2.5 + p.k) * R * 0.25 * p.n;
      } else if (p.mot === 'legA' || p.mot === 'legB') {
        const gp = ((p.k & 3) + (p.k < 4 ? 0 : 1)) & 1, step = Math.max(0, Math.sin(t * 1.1 + gp * Math.PI));
        y += step * R * 0.18;
        z += Math.cos(t * 1.1 + gp * Math.PI) * R * 0.12;
      } else {
        y += Math.sin(ph * 0.8) * R * 0.04;
      }
      p.m.position.set(x, y, z);
    }
    // Hand-rolled visibility instead of scene fog: at 0.028 density the real fog would
    // erase anything past ~50u in the deep, and these need to be seen and then lost.
    const vis = smooth(0, 0.14, uu) * (1 - smooth(0.8, 1, uu));
    // A shade of transparency lets the murk through, so the mass sits *in* the water
    // rather than being pasted on top of it — fog:false would otherwise cut it out.
    // Water colour at vis 0, a mass three times darker than the water at vis 1. This
    // also keeps it reading in the bright shallows, where a flat black body looked like
    // a hole punched in the teal rather than something swimming in it.
    if (scene.background && scene.background.isColor) {
      _bodyCol.copy(scene.background);
      o.body.color.copy(_bodyCol).lerp(_darkCol.copy(_bodyCol).multiplyScalar(0.3), vis);
    }
    o.haze.opacity = vis * 0.1;
    o.glow.opacity = vis * 0.62;

    // the frame should want to look at it
    const w = smooth(0.02, 0.2, uu) * (1 - smooth(0.72, 0.96, uu));
    if (w > sleeperFocus) {
      sleeperFocus = w;
      sleeperAz = sp.bearing;
      sleeperEl = Math.atan2(o.grp.position.y - y, sp.dist);
    }
  }

  // ---- the diver: face the drift home, then turn toward whatever is passing ----
  const upLook = 0.3 * smooth(T_STILL, T_STILL + 10, T) * (1 - smooth(T_RISE_END, T_SURF_END, T));
  const ax = _ahead.x - player.pos.x, az = _ahead.z - player.pos.z;
  // Near the surface the look-ahead has run off the end of the table and collapses onto
  // him; hold the last heading rather than snapping to whatever noise is left.
  let yawWant = (ax * ax + az * az) > 4 ? Math.atan2(ax, az) : yawF;
  let pitchWant = upLook;
  if (sleeperFocus > 0.02) {
    yawWant = sleeperAz;
    pitchWant = upLook * (1 - sleeperFocus) + sleeperEl * 0.7 * sleeperFocus;
  }
  let dy = yawWant - yawF;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  yawF += dy * Math.min(1, 0.55 * dt);
  pitchF += (pitchWant - pitchF) * Math.min(1, 0.7 * dt);
  player.yaw = yawF;
  player.pitch = pitchF;
  player.grounded = false;
  updateDiver(dt, t, player);

  // ---- lantern + fill: game.js stops driving these once the ending owns the frame ----
  lanternWorldPos(_lant);
  lanternLight.position.copy(_lant);
  lanternLight.intensity = (12 + 3.2 * Math.sin(t * 6.5) + 1.2 * Math.sin(t * 19))
    * (1 - 0.45 * smooth(zoneTop(1), -30, y));   // the lantern matters less in the light
  playerLightSrc.position.copy(player.pos);
  playerLightSrc.intensity = 30 + 26 * smooth(-900, -60, y);

  // ---- bubbles: rise past him faster than he does, so the motion stays legible ----
  const bOp = 0.34 * smooth(T_STILL - 1, T_STILL + 4, T) * (1 - smooth(T_SURF_END, T_CARD, T));
  bubbles.material.opacity = bOp;
  if (bOp > 0.002) {
    const carry = Math.max(0, vy);
    for (let i = 0; i < NBUB; i++) {
      const j = i * 3;
      bubblePos[j + 1] += (bubbleData[j] + carry * 1.22) * dt;
      const wob = bubbleData[j + 2] + t * 1.5;
      bubblePos[j] += Math.cos(wob) * bubbleData[j + 1] * dt;
      bubblePos[j + 2] += Math.sin(wob * 1.13) * bubbleData[j + 1] * dt;
      if (bubblePos[j + 1] > y + 30 || bubblePos[j + 1] < y - 40) respawnBubble(i, false);
    }
    bubbles.geometry.attributes.position.needsUpdate = true;
  }

  // ---- camera: slow elevator orbit that opens out as he rises ----
  const inRise = smooth(T_STILL, T_STILL + 9, T);
  const inSurf = smooth(T_RISE_END - 2, T_SURF_END, T);
  camAz += (0.036 + 0.062 * inRise + 0.018 * Math.sin(T * 0.11)) * dt;
  if (sleeperFocus > 0.01) {
    // ease the orbit around so the diver sits between us and the sleeper
    let d = sleeperAz + Math.PI - camAz;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    camAz += d * Math.min(1, 1.9 * sleeperFocus * dt);
  }
  if (inSurf > 0.02) {
    // Last composition of the game: settle the camera on the far side of him from the
    // raft, so the boat he came back to hangs in the light above and behind his head.
    let d = Math.atan2(raft.position.z - player.pos.z, raft.position.x - player.pos.x) + Math.PI - camAz;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    camAz += d * Math.min(1, 1.1 * inSurf * dt);
  }

  // Threading a crack the orbit has to come in and sit higher (wantDist / wantH below take
  // `transit`): a 19u arm swinging round across it is buried in a wall. Pulled in, the arm
  // stays in the throat where the water is (and THE THROAT, SEEN below shortens it further).
  let transit = 0, ti = 0;
  for (let i = 0; i < 3; i++) {
    const near = 1 - smooth(RIFT_R * 1.1, RIFT_R * 3.0,
      Math.hypot(player.pos.x - trX[i], player.pos.z - trZ[i]));
    const band = smooth(trY0[i] - 30, trY0[i] + 12, y) * (1 - smooth(trY1[i] - 26, trY1[i] + 16, y));
    const f = near * band;
    if (f > transit) { transit = f; ti = i; }
  }
  // THE FISSURE (2026-10-10): the opening is a crack ~13 u wide and ~70 long, not a 43 u bowl, so
  // an orbit swinging across it buries the arm in a wall. While he threads one, the orbit is held
  // to the crack's own (kinked) line, toward whichever end the camera is already nearer.
  if (transit > 0.01) {
    const F = FISSURE[ti], ax = Math.atan2(F.dz, F.dx);
    let d = ax - camAz;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // aim down the middle of the GAP: the two lips differ, so it sits at v = (w1 - w0) / 2, not v = 0
    // at the arm's own length, so the camera itself (not just its bearing) lands in the gap
    const arm = Math.max(3, camDist * (1 - 0.62 * camPull));
    const ua = Math.abs(d) < Math.PI / 2 ? arm : -arm, W = _widths(F, ua);
    fissureWorld(ua, (W.w1 - W.w0) * 0.5, ti, _fw);
    let e = Math.atan2(_fw.z - player.pos.z, _fw.x - player.pos.x) - camAz;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    camAz += e * Math.min(1, 3 * transit * dt);
  }

  const wantDist = (8.5 + 10.5 * inRise + 3.6 * Math.sin(T * 0.083) + 15 * inSurf) * (1 - 0.46 * transit);
  const wantH = 1.9 + inRise * (2.2 + 4.2 * Math.sin(T * 0.067)) - 15 * inSurf + 3.4 * transit;
  const wantFov = 62 + 4.5 * Math.sin(T * 0.13 + 1.2) - 6 * inSurf;
  // Exponential drop-ins (tether.js's MU_RATE idiom): the k*dt forms made the shot's
  // composition depend on framerate — a 30 fps machine framed the surf beat differently.
  camDist += (wantDist - camDist) * (1 - Math.exp(-1.1 * dt));
  camHeight += (wantH - camHeight) * (1 - Math.exp(-0.9 * dt));
  camFov += (wantFov - camFov) * (1 - Math.exp(-0.8 * dt));
  // At the surface the camera falls below him and tilts up, so he reads small against
  // the glow rather than centred in it.
  lookLift += (inSurf * 13 - lookLift) * (1 - Math.exp(-0.6 * dt));

  // Last line of defence, and the same trick game.js plays with its own boom: if the arm
  // still ends up in rock, shorten it until it does not. Measured against the position it
  // is actually about to use, so it converges instead of hunting.
  const dEff = camDist * (1 - 0.62 * camPull);
  const cax = Math.cos(camAz), caz = Math.sin(camAz);
  // THE THROAT, SEEN (see FLOOR_UNDER / LOS_F): the arm that sees him, while he threads a crack
  let fWant = 1, hd = 0, cross = 0;
  if (transit > 0.01) {
    fWant = LOS_F[LOS_F.length - 1];
    for (let k = 0; k < LOS_F.length; k++) {
      const f = LOS_F[k], d = dEff * f;
      const cy = player.pos.y + camHeight + (1 - f) * dEff * LOS_RAISE - floorDrop;
      if (losClear(player.pos.x + cax * d, cy, player.pos.z + caz * d, player.pos.x, player.pos.y - 0.5, player.pos.z)) { fWant = f; break; }
    }
    // crossing the floor (his last ~16 u under it, his first few over it) the arm comes all the way in:
    // the throat floor is at full depth only in a slot a few units wide round his own column, and a lens
    // out along the crack sat in the rock of a pocket's wall (zone 2: black frames)
    hd = terrainH(player.pos.x, player.pos.z, ti);
    const rel = player.pos.y - hd; cross = smooth(-32, -15, rel) * (1 - smooth(2, 7, rel)) * transit;
    fWant = Math.min(fWant, 1 - (1 - LOS_F[LOS_F.length - 1]) * cross);
  }
  losF += (fWant - losF) * (1 - Math.exp(-(fWant < losF ? 3 : 1.5) * dt));
  const dArm = dEff * losF;
  const camX = player.pos.x + cax * dArm, camZ = player.pos.z + caz * dArm;
  let camY = player.pos.y + camHeight + (1 - losF) * dEff * LOS_RAISE;
  // under the floor of the crack he threads while he is: the lens stays under it too, and through the
  // crossing itself UNDER HIM (he rises through the pit at the throat floor's bottom: every floor round
  // him is higher, so a line from below him stays under it all), held there continuously as both rise
  // and let go on a ~0.7 s decay once he is through: from below, the floor is a culled back face
  // (final residual fix 4) the under-him part rides `cross` as a share of the way down (it was a cap 40 u
  // over him squeezed into cross's 5 u ramp: 6.6 u in one frame at the zone-1 crossing), and the drop is
  // taken at <= DROP_RATE u/s: no step of the lens past ~1 u a frame at 60 fps
  let need = 0;
  if (transit > 0.01 && player.pos.y - 0.5 < hd + 0.3) {
    need = Math.max(0, camY - (terrainH(camX, camZ, ti) - FLOOR_UNDER), cross * (camY - (player.pos.y - UNDER_HIM)));
  }
  const fd0 = floorDrop * Math.exp(-1.4 * dt);
  floorDrop = need > fd0 ? Math.min(need, Math.max(fd0, floorDrop + DROP_RATE * dt)) : fd0;
  camY -= floorDrop;
  const hit = insideFloor(camX, camY, camZ);
  camPull += ((hit ? 1 : 0) - camPull) * Math.min(1, 3 * dt);

  // and the lens never moves faster than LENS_REL u/s relative to him (frame-rate independent): every term
  // above is eased, this is the backstop that keeps a ramp from ever reading as a cut
  if (lensPrevOk && dt > 0) {
    const ex = camX - (lensPrev.x + player.pos.x - diverPrev.x), ey = camY - (lensPrev.y + player.pos.y - diverPrev.y), ez = camZ - (lensPrev.z + player.pos.z - diverPrev.z);
    const el = Math.hypot(ex, ey, ez), lim = LENS_REL * dt;
    if (el > lim) { const k = lim / el; camera.position.set(camX - ex * (1 - k), camY - ey * (1 - k), camZ - ez * (1 - k)); }
    else camera.position.set(camX, camY, camZ);
    // ...and absolutely no faster than LENS_ABS u/s (~1 u a frame at 60 fps; he himself rides up to ~44 u/s)
    const ax = camera.position.x - lensPrev.x, ay = camera.position.y - lensPrev.y, az = camera.position.z - lensPrev.z;
    const al = Math.hypot(ax, ay, az), alim = LENS_ABS * dt;
    if (al > alim) { const k = alim / al; camera.position.set(lensPrev.x + ax * k, lensPrev.y + ay * k, lensPrev.z + az * k); }
  } else camera.position.set(camX, camY, camZ);
  lensPrev.copy(camera.position); diverPrev.copy(player.pos); lensPrevOk = true;
  _v.set(player.pos.x, player.pos.y + 0.6 + lookLift, player.pos.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(_v);
  camRoll += (Math.sin(T * 0.094) * 0.022 - camRoll) * (1 - Math.exp(-1.5 * dt));
  camera.rotateZ(camRoll);
  if (Math.abs(camera.fov - camFov) > 0.02) { camera.fov = camFov; camera.updateProjectionMatrix(); }

  // ---- the bits of the audio feed the ending owns ----
  setSpeed(Math.abs(vy) * 0.35);
  setLight(1);

  // ---- title card ----
  if (!cardOn && T >= T_SURF_END) {
    cardOn = true;
    card.style.opacity = '1';
    chime(196, 7, 0.1, 'ending'); chime(294, 6, 0.07, 'ending');   // a last pair of notes under the wipe
    setTimeout(() => { cLine1.style.opacity = '1'; cRule.style.opacity = '1'; }, T_FADE * 1000 - 400);
  }
  if (cardOn && !l2 && T >= T_LINE2) { l2 = true; cLine2.style.opacity = '1'; }
  if (cardOn && !l3 && T >= T_LINE3) { l3 = true; cLine3.style.opacity = '1'; chime(349, 6, 0.07, 'ending'); }
  if (cardOn && !hintOn && T >= T_HINT) { hintOn = true; cHint.style.opacity = '1'; cHint.classList.add('on'); }
  // Once the card is opaque there is nothing to see; stop paying for the silhouettes.
  if (T > T_CARD + 1.5 && bubbles.visible) {
    bubbles.visible = false;
    for (const s of SLEEPERS) s.obj.grp.visible = false;
  }
}
