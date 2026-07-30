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
import { clamp, V3 } from './lib/math.js';
import { updateDiver, lanternWorldPos } from './entities/diver.js';
import { lanternLight, playerLightSrc } from './lighting.js';
import { raft } from './systems/raft.js';
import { setTetherVisible } from './systems/tether.js';
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
// He leaves the way he came: up through the three rift bowls, in order. All three zone
// terrains stay in the scene for the whole cinematic, so a straight lerp from the zone-2
// rift to the raft drove him through two solid seafloors in open water. The only places
// the floors may be crossed are the rift funnels — the game already reads a rift transit
// as passing through the flattened bowl mesh, because that is what normal play does.
//
// The path is a spline through seven points, built once. Its shape is dictated by two
// rules, and every waypoint is one of them:
//   * before moving sideways off a rift, rise CLEAR above the highest ground the corridor
//     to the next rift crosses in the zone he has just left;
//   * arrive at the next rift still DIP below the lowest ground of the zone above, so the
//     floor he is about to break through can only ever be crossed inside the funnel.
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
// Lowest ground of zone zi along the corridor, ignoring its own funnel — the funnel is
// the hole he is aiming for, and counting its floor would drag the arrival level down
// under the seafloor he is meant to stay beneath until he is inside it.
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
// Per-rift transit bands, for the camera: [where he enters the funnel, where he clears it].
const trY0 = new Float32Array(3), trY1 = new Float32Array(3);
const trX = new Float32Array(3), trZ = new Float32Array(3);
const _pts = [];        // the seven control points, reused across wins
const _path = V3(), _ahead = V3();

function buildPath(sx, sy, sz, endX, endZ) {
  const r2 = riftPos(2), r1 = riftPos(1), r0 = riftPos(0);
  const end = { x: endX, z: endZ };
  // Clearance level above each floor he leaves, and arrival level under each floor above.
  const yA = corridorMax(r2, r1, 2) + CLEAR;   // clear of the zone-2 floor
  const yB = corridorMin(r2, r1, 1) - DIP;     // still under the zone-1 floor, at rift 1
  const yC = corridorMax(r1, r0, 1) + CLEAR;   // clear of the zone-1 floor
  const yD = corridorMin(r1, r0, 0) - DIP;     // still under the zone-0 floor, at rift 0
  const yE = corridorMax(r0, end, 0) + CLEAR;  // clear of the zone-0 floor

  _pts.length = 0;
  _pts.push(new THREE.Vector3(sx, sy, sz));
  _pts.push(new THREE.Vector3(r2.x, yA, r2.z));
  _pts.push(new THREE.Vector3(r1.x, yB, r1.z));
  _pts.push(new THREE.Vector3(r1.x, yC, r1.z));
  _pts.push(new THREE.Vector3(r0.x, yD, r0.z));
  _pts.push(new THREE.Vector3(r0.x, yE, r0.z));
  _pts.push(new THREE.Vector3(end.x, SURFACE_END_Y, end.z));

  // Centripetal parameterisation, not uniform: the four right-angle corners where a
  // vertical hold turns into a lateral leg made the uniform curve loop out past the rift
  // and swing back, which put him through the funnel wall on the way in.
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
    trY0[i] = terrainH(rr[i].x, rr[i].z, i) - 22;   // just under the bowl floor
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

// ---------------------------------------------------------------- sleeper silhouettes
// Deliberately NOT the real leviathan module: these are tapered spines of scaled spheres
// with an additive cyan wash, read at 43-72u through the fog. Ordered deepest-pass-first
// (zone 2, then 1, then 0) so each pass is closer and slower than the one before.
// bearing is a world direction from the diver, measured as (cos b, sin b) in x/z.
// The first pass used to sit at bearing 0.55 — outward from rift 2, which was harmless
// while the ascent barely moved sideways. Now that the path tracks rift 2 -> rift 1 it
// threw the body out past r=240 and buried its nose in the basin rim; 4.2 keeps the whole
// 118u body 80u clear of the zone-2 floor while still crossing the frame.
const SLEEPERS = [
  { yFrom: -840, yTo: -670, dist: 72, len: 118, rad: 9.5, segs: 34, travel: 205, bearing: 4.2, note: 233, tint: 0x74d8ff },
  { yFrom: -560, yTo: -380, dist: 57, len: 100, rad: 8.0, segs: 30, travel: 165, bearing: 2.75, note: 262, tint: 0x8ae2ff },
  { yFrom: -250, yTo: -70, dist: 43, len: 84, rad: 6.5, segs: 26, travel: 128, bearing: 4.65, note: 311, tint: 0xa6ecff }
];

let built = false;
let bubbles = null, bubbleData = null, bubblePos = null;
const _v = V3(), _lant = V3();
const _bodyCol = new THREE.Color(), _darkCol = new THREE.Color();

// One soft radial dot, shared by every glow sprite and by the bubbles.
let _glowTex = null;
function glowTex() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.18, 'rgba(255,255,255,0.62)');
  rg.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

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
  const geo = new THREE.SphereGeometry(1, 12, 8);
  const segs = [], deco = [];
  const N = spec.segs;
  const spacing = spec.len / (N - 1);
  // Segment count is set high (26-34) purely so the spheres overlap enough to read as
  // one continuous body: at 15 segments the silhouette scalloped into visible blobs.
  for (let k = 0; k < N; k++) {
    const u = k / (N - 1);
    // fat behind the head, tapering to a thread at the tail
    const prof = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.7) * 0.9 + 0.14;
    const r = spec.rad * prof;
    const m = new THREE.Mesh(geo, body);
    // The along-body half-length never drops below the segment spacing: once the taper
    // took r under len/N the nose and tail broke into a row of separate floating discs.
    // Each segment is stretched well past the spacing along the body. Two earlier passes
    // showed why: at z-scale ~= r the outline stepped visibly from sphere to sphere in
    // bright water, and at the tapered ends it broke into separate floating discs.
    m.scale.set(r, r * 0.8, Math.max(r * 1.5, spacing * 1.7));
    m.renderOrder = 2;
    grp.add(m);
    segs.push(m);

    // Sprites hang off the group, not off the segments: a sprite inherits its parent's
    // scale, and the segments are scaled non-uniformly, which would squash the billboard.
    // They are cheap enough to reposition by hand each frame (about a dozen writes).
    if (k % Math.max(1, Math.round(N / 7)) === 1) {
      const h = new THREE.Sprite(haze);
      const s = spec.rad * (1.5 + 2.1 * prof);
      h.scale.set(s, s * 0.8, 1);
      h.renderOrder = 1;
      grp.add(h);
      deco.push({ sp: h, k, dy: 0 });
    }
    // ward-light points down the flank, brighter toward the head
    if (k % 5 === 3) {
      const g = new THREE.Sprite(glow);
      const s = spec.rad * (0.15 + 0.1 * (1 - u));
      g.scale.set(s, s, 1);
      g.renderOrder = 3;
      grp.add(g);
      // Sits just clear of the hull: the body is opaque and depth-tests the sprites, so a
      // node buried inside the mass would be rejected and never light anything.
      deco.push({ sp: g, k, dy: r * 0.95 });
    }
  }
  // Tail fluke and one pair of pectorals, so the silhouette reads as a creature and not
  // a worm. They ride the group rather than a segment: the segments carry a big
  // non-uniform stretch that turned the fluke into a fourteen-unit paddle.
  const R = spec.rad;
  const fluke = new THREE.Mesh(geo, body);
  fluke.scale.set(R * 0.16, R * 1.15, R * 0.5);
  fluke.renderOrder = 2;
  grp.add(fluke);
  deco.push({ sp: fluke, k: N - 1, dy: 0 });
  const fi = Math.round(N * 0.28);
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? -1 : 1;
    const fin = new THREE.Mesh(geo, body);
    fin.scale.set(R * 1.15, R * 0.12, R * 0.5);
    fin.position.x = sx * R * 0.9;
    fin.rotation.z = sx * 0.22;
    fin.renderOrder = 2;
    grp.add(fin);
    deco.push({ sp: fin, k: fi, dy: -R * 0.2, dx: sx * R * 0.9 });
  }
  scene.add(grp);
  return { grp, segs, deco, body, haze, glow, N, ax: 0, az: 0, seen: false, live: false };
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
let endX = 34, endZ = 27;
let cardOn = false, l2 = false, l3 = false, hintOn = false;
let yawF = 0, pitchF = 0;

export function startEnding() {
  buildOnce();
  T = 0;
  startY = player.pos.y;
  startX = player.pos.x;
  startZ = player.pos.z;
  // In play he is standing in the zone-2 bowl when this fires, a few units under its
  // floor. The debug hook drops him at the origin instead, 70u under the seafloor and
  // 118u off the rift — from there the first leg would drag him through the zone-2 floor
  // from below. Either way the shot starts in the funnel, so put him in it.
  const r2 = riftPos(2);
  if (Math.hypot(startX - r2.x, startZ - r2.z) > RIFT_R * 1.6) {
    startX = r2.x; startZ = r2.z;
    player.pos.x = startX; player.pos.z = startZ;
  }
  // Far enough out that the raft reads as a small silhouette on the ceiling of light.
  // At 9u it filled the upper third of the frame with hull logs and float barrels.
  endX = raft.position.x + 34; endZ = raft.position.z + 27;
  buildPath(startX, startY, startZ, endX, endZ);
  lastY = startY;
  player.vel.set(0, 0, 0);
  player.grounded = false;
  player.light = 1;
  yawF = player.yaw;
  pitchF = player.pitch;
  camAz = player.yaw + Math.PI;
  camDist = 8.5; camHeight = 1.9; camFov = 62; camRoll = 0; lookLift = 0; camPull = 0;
  cardOn = l2 = l3 = hintOn = false;
  for (const s of SLEEPERS) { s.obj.seen = false; s.obj.live = false; s.obj.grp.visible = false; }
  for (let i = 0; i < NBUB; i++) respawnBubble(i, true);
  bubbles.visible = true;
  bubbles.material.opacity = 0;
  bubbles.geometry.attributes.position.needsUpdate = true;
  setCalm(1);
  setWalking(false);
  hideTether();
  // The HUD has nothing left to say. Let it go before the ascent starts.
  const ui = document.getElementById('ui');
  if (ui) { ui.style.transition = 'opacity 2.6s ease-in'; ui.style.opacity = '0'; }
  if (document.pointerLockElement) document.exitPointerLock();
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
    const u = (y - sp.yFrom) / (sp.yTo - sp.yFrom);
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
    // what the fixed anchor used to be worth, and the pass still frames at 40-125u.
    const FOLLOW = 0.85;
    const ax0 = o.ax + (player.pos.x - o.px) * FOLLOW;
    const az0 = o.az + (player.pos.z - o.pz) * FOLLOW;
    const uu = clamp(u, 0, 1);
    if (!o.seen && uu > 0.1) { o.seen = true; chime(sp.note, 5.5, 0.1); chime(sp.note * 1.5, 4.5, 0.055); }

    // it crosses the frame perpendicular to our line of sight, drifting up more slowly
    // than he does, so he overtakes it and it slides away below into the fog
    const off = (uu - 0.5) * sp.travel;
    const hx = Math.cos(sp.bearing + Math.PI / 2), hz = Math.sin(sp.bearing + Math.PI / 2);
    const cx = ax0 + Math.cos(sp.bearing) * sp.dist;
    const cz = az0 + Math.sin(sp.bearing) * sp.dist;
    // The +72 puts the moment their paths cross at uu = 0.5, so the animal is level with
    // him — and dead centre of frame — exactly at the middle of the pass. Without it the
    // crossing landed at uu 0.29 and it spent most of the shot sliding out of the corner.
    o.grp.position.set(cx + hx * off, sp.yFrom + 72 + 40 * uu, cz + hz * off);
    // A dead-level body reads as a bar across the frame; a few degrees of climb and
    // roll is the difference between a shape and something swimming.
    o.grp.rotation.set(-0.06 + Math.sin(t * 0.07 + i) * 0.03, Math.atan2(hx, hz), -0.05 + Math.sin(t * 0.05 + i) * 0.05);

    // slow body wave; the later (closer) sleepers move slower still
    const ph = t * (0.42 - i * 0.09);
    const amp = sp.rad * 0.85;
    const N = o.N;
    for (let k = 0; k < N; k++) {
      const kv = k / (N - 1);
      o.segs[k].position.set(
        Math.sin(ph - k * 0.4) * amp * (0.18 + 0.82 * kv),
        Math.cos(ph * 0.7 - k * 0.28) * amp * 0.3,
        (kv - 0.5) * -sp.len
      );
    }
    for (let d = 0; d < o.deco.length; d++) {
      const dc = o.deco[d];
      dc.sp.position.copy(o.segs[dc.k].position);
      dc.sp.position.y += dc.dy;
      if (dc.dx) dc.sp.position.x += dc.dx;
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

  // Inside a funnel the orbit has to come in and sit higher: the bowl is 43u across and
  // 100u deep, and a 19u arm swinging round the far side of it spent a second and a half
  // buried in the wall. Pulled in, the arm stays in the throat where the water is.
  let transit = 0;
  for (let i = 0; i < 3; i++) {
    const near = 1 - smooth(RIFT_R * 1.1, RIFT_R * 3.0,
      Math.hypot(player.pos.x - trX[i], player.pos.z - trZ[i]));
    const band = smooth(trY0[i] - 30, trY0[i] + 12, y) * (1 - smooth(trY1[i] - 26, trY1[i] + 16, y));
    const f = near * band;
    if (f > transit) transit = f;
  }

  const wantDist = (8.5 + 10.5 * inRise + 3.6 * Math.sin(T * 0.083) + 15 * inSurf) * (1 - 0.46 * transit);
  const wantH = 1.9 + inRise * (2.2 + 4.2 * Math.sin(T * 0.067)) - 15 * inSurf + 3.4 * transit;
  const wantFov = 62 + 4.5 * Math.sin(T * 0.13 + 1.2) - 6 * inSurf;
  camDist += (wantDist - camDist) * Math.min(1, 1.1 * dt);
  camHeight += (wantH - camHeight) * Math.min(1, 0.9 * dt);
  camFov += (wantFov - camFov) * Math.min(1, 0.8 * dt);
  // At the surface the camera falls below him and tilts up, so he reads small against
  // the glow rather than centred in it.
  lookLift += (inSurf * 13 - lookLift) * Math.min(1, 0.6 * dt);

  // Last line of defence, and the same trick game.js plays with its own boom: if the arm
  // still ends up in rock, shorten it until it does not. Measured against the position it
  // is actually about to use, so it converges instead of hunting.
  const dEff = camDist * (1 - 0.62 * camPull);
  const camY = player.pos.y + camHeight;
  const hit = insideFloor(player.pos.x + Math.cos(camAz) * dEff, camY,
                          player.pos.z + Math.sin(camAz) * dEff);
  camPull += ((hit ? 1 : 0) - camPull) * Math.min(1, 3 * dt);

  camera.position.set(
    player.pos.x + Math.cos(camAz) * camDist * (1 - 0.62 * camPull),
    camY,
    player.pos.z + Math.sin(camAz) * camDist * (1 - 0.62 * camPull)
  );
  _v.set(player.pos.x, player.pos.y + 0.6 + lookLift, player.pos.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(_v);
  camRoll += (Math.sin(T * 0.094) * 0.022 - camRoll) * Math.min(1, 1.5 * dt);
  camera.rotateZ(camRoll);
  if (Math.abs(camera.fov - camFov) > 0.02) { camera.fov = camFov; camera.updateProjectionMatrix(); }

  // ---- the bits of the audio feed the ending owns ----
  setSpeed(Math.abs(vy) * 0.35);
  setLight(1);

  // ---- title card ----
  if (!cardOn && T >= T_SURF_END) {
    cardOn = true;
    card.style.opacity = '1';
    chime(196, 7, 0.1); chime(294, 6, 0.07);   // a last pair of notes under the wipe
    setTimeout(() => { cLine1.style.opacity = '1'; cRule.style.opacity = '1'; }, T_FADE * 1000 - 400);
  }
  if (cardOn && !l2 && T >= T_LINE2) { l2 = true; cLine2.style.opacity = '1'; }
  if (cardOn && !l3 && T >= T_LINE3) { l3 = true; cLine3.style.opacity = '1'; chime(349, 6, 0.07); }
  if (cardOn && !hintOn && T >= T_HINT) { hintOn = true; cHint.style.opacity = '1'; cHint.classList.add('on'); }
  // Once the card is opaque there is nothing to see; stop paying for the silhouettes.
  if (T > T_CARD + 1.5 && bubbles.visible) {
    bubbles.visible = false;
    for (const s of SLEEPERS) s.obj.grp.visible = false;
  }
}
