// Rapier physics for WORLD PHYSICALITY only — dynamic debris that the player and the
// leviathan shove around. The player controller stays entirely in player.js; here the
// player is only a kinematic pusher sphere.
//
// CONTRACT (game.js wires these):
//   await initPhysics(zi)      -> builds statics + debris for zone zi. Always resolves;
//                                 if Rapier fails to load every export becomes a no-op.
//   updatePhysics(dt, playerPos, playerVel, levSpine)  -> fixed-step + mesh sync.
//                                 levSpine may be null; array of THREE.Vector3 otherwise.
//   switchZone(zi)             -> tears down and rebuilds statics + debris (sync, reuses WASM).
//   physicsReady               -> live-binding boolean; false until the WASM world is up.
//   physicsStats()             -> { bodies, awake, ms, maxV } for HUD/debug (on-demand only).
//
// Statics: one heightfield collider sampled from terrainH over +/-HF_EXT (200m) at
// HF_N+1 = 129 samples per axis (3.125 m cell) — coarse relative to the mesh, but debris
// is pebble-scale and rests on the interpolated triangles. Plus one fixed ball per entry
// in rockColliders (large boulders only, which is all that array holds).
//
// Water is modelled without any per-frame force application, so bodies can actually
// sleep: drag = per-body linear/angular damping, negative buoyancy = weak world gravity.
import * as THREE from 'three';
import { scene } from '../core.js';
import { WORLD_R, riftPos, zoneBottom } from '../config.js';
import { terrainH } from '../world/terrain.js';
import { rockColliders } from '../world/flora.js';

const RAPIER_CDN = 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.12.0/+esm';

const HF_EXT = 200;          // half-extent of the heightfield, x and z
const HF_N = 128;            // cells per axis -> (HF_N+1)^2 terrainH samples at init
const N_DEBRIS = 120;
const FIXED = 1 / 60;
const MAX_SUB = 5;           // hard cap so a tab-switch stall can never spiral the step count
const GRAV = -2.4;           // slight negative buoyancy, not real gravity
const PLAYER_R = 0.9;
const LEV_R = 6, LEV_N = 4;  // nearest N spine points act as kinematic shovers
const PARK_Y = -20000;       // where unused kinematic pushers go

// Muted rock palette, mirrored from flora.js P[].rock (flora does not export it).
const ROCK_COL = [0x1a2730, 0x211b2b, 0x2a1f1c];

export let physicsReady = false;
export function physicsStats() {
  let maxV = 0;
  for (let i = 0; i < bodies.length; i++) {
    const v = bodies[i].b.linvel(), m = Math.hypot(v.x, v.y, v.z);
    if (m > maxV) maxV = m;
  }
  return { bodies: bodies.length, awake: awakeCount, ms: lastMs, maxV };
}

let RAPIER = null, world = null, zone = 0, loadFailed = false;
let bodies = [], inst = null, instGeo = null, instMat = null;
let playerBody = null, levBodies = [];
let hfHeights = null;
let acc = 0, awakeCount = 0, lastMs = 0;

// hot-path temps — updatePhysics must not allocate
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _t = { x: 0, y: 0, z: 0 };
const _order = new Int32Array(64), _dist = new Float32Array(64);

export async function initPhysics(zi) {
  if (loadFailed) return;
  if (!RAPIER) {
    try {
      RAPIER = await import(/* @vite-ignore */ RAPIER_CDN);
      await RAPIER.init();
    } catch (e) {
      loadFailed = true; RAPIER = null;
      console.warn('[physics] Rapier unavailable, running without physics:', e && e.message);
      return;
    }
  }
  build(zi);
  physicsReady = true;
}

export function switchZone(zi) {
  if (!RAPIER || loadFailed) return;
  teardown();
  build(zi);
  physicsReady = true;
}

// ---------------------------------------------------------------------------
function build(zi) {
  zone = zi | 0;
  world = new RAPIER.World({ x: 0, y: GRAV, z: 0 });
  world.timestep = FIXED;

  // ---- heightfield ----
  // Rapier's layout is heights[j*(n+1)+i] where i runs along +Z and j along +X — NOT the
  // other way round. Verified empirically (a ramp built along i slides bodies in -z); the
  // transposed version silently spawned half the debris inside the terrain.
  const n1 = HF_N + 1, heights = new Float32Array(n1 * n1);
  const step = (HF_EXT * 2) / HF_N;
  for (let j = 0; j < n1; j++) {
    const x = -HF_EXT + j * step;
    for (let i = 0; i < n1; i++) heights[j * n1 + i] = terrainH(x, -HF_EXT + i * step, zone);
  }
  hfHeights = heights;
  const hfBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(HF_N, HF_N, heights, { x: HF_EXT * 2, y: 1, z: HF_EXT * 2 })
      .setFriction(0.9).setRestitution(0.05), hfBody);

  // ---- boulders ----
  for (const c of rockColliders) {
    if (Math.abs(c.x) > HF_EXT || Math.abs(c.z) > HF_EXT) continue;
    // flora fills rockColliders for every zone into one array; keep only this zone's band
    if (c.y > zoneBottom(zone) - 40 && c.y < zoneBottom(zone) + 400) {
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z));
      world.createCollider(RAPIER.ColliderDesc.ball(c.r).setFriction(0.8), b);
    }
  }

  // ---- kinematic pushers ----
  playerBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PARK_Y, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(PLAYER_R), playerBody);
  levBodies.length = 0;
  for (let i = 0; i < LEV_N; i++) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PARK_Y, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(LEV_R), b);
    levBodies.push(b);
  }

  buildDebris();
}

// Bilinear sample of the collider's OWN surface. Spawning against terrainH instead left
// debris either buried in or floating above the 3.1m-cell heightfield, and the resulting
// penetration/drop kept dozens of bodies creeping forever instead of sleeping.
const HF_STEP = (HF_EXT * 2) / HF_N;
function hfAt(x, z, out) {
  const fi = (z + HF_EXT) / HF_STEP, fj = (x + HF_EXT) / HF_STEP;   // i->z, j->x
  const i = Math.max(0, Math.min(HF_N - 1, fi | 0)), j = Math.max(0, Math.min(HF_N - 1, fj | 0));
  const u = fi - i, v = fj - j, n1 = HF_N + 1;
  const h00 = hfHeights[j * n1 + i], h10 = hfHeights[j * n1 + i + 1];
  const h01 = hfHeights[(j + 1) * n1 + i], h11 = hfHeights[(j + 1) * n1 + i + 1];
  const a = h00 + (h10 - h00) * u, b = h01 + (h11 - h01) * u;
  if (out) { out.dz = ((h10 - h00) + (h11 - h01)) * 0.5 / HF_STEP; out.dx = (b - a) / HF_STEP; }
  return a + (b - a) * v;
}
const _grad = { dx: 0, dz: 0 };

function buildDebris() {
  const rp = riftPos(zone);
  instGeo = new THREE.DodecahedronGeometry(1, 0);
  instMat = new THREE.MeshStandardMaterial({
    color: ROCK_COL[zone % 3], roughness: 0.9, metalness: 0.03, flatShading: true
  });
  inst = new THREE.InstancedMesh(instGeo, instMat, N_DEBRIS);
  inst.frustumCulled = false;               // bodies move; a stale bounds would pop them out
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.castShadow = false; inst.receiveShadow = true;
  scene.add(inst);

  const hull = new Float32Array(instGeo.attributes.position.count * 3);
  const src = instGeo.attributes.position.array;
  bodies.length = 0;
  const col = new THREE.Color();
  let placed = 0, guard = 0;
  while (placed < N_DEBRIS && guard++ < N_DEBRIS * 40) {
    const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * (WORLD_R * 0.62 - 30);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) > HF_EXT - 4 || Math.abs(z) > HF_EXT - 4) continue;
    if (Math.hypot(x - rp.x, z - rp.z) < 45) continue;      // keep the rift funnel clear
    const hy = hfAt(x, z, _grad);
    if (Math.hypot(_grad.dx, _grad.dz) > 0.26) continue;    // too steep: it would creep downhill and never sleep
    const s = 0.22 + Math.random() * 0.5, sy = s * (0.6 + Math.random() * 0.7);
    const y = hy + sy + 0.02;

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
        .setLinearDamping(1.6).setAngularDamping(2.2));   // water drag; no per-frame forces
    for (let i = 0; i < src.length; i += 3) {
      hull[i] = src[i] * s; hull[i + 1] = src[i + 1] * sy; hull[i + 2] = src[i + 2] * s;
    }
    const cd = RAPIER.ColliderDesc.convexHull(hull);
    world.createCollider((cd || RAPIER.ColliderDesc.ball(s)).setDensity(2.2).setFriction(0.85).setRestitution(0.08), body);

    _p.set(x, y, z); _q.identity(); _s.set(s, sy, s);
    inst.setMatrixAt(placed, _m.compose(_p, _q, _s));
    col.setHex(ROCK_COL[zone % 3]);
    const k = 0.7 + Math.random() * 0.6;
    inst.setColorAt(placed, col.setRGB(col.r * k, col.g * k, col.b * k));
    bodies.push({ b: body, sx: s, sy, live: true });
    placed++;
  }
  inst.count = placed;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
}

function teardown() {
  if (inst) { scene.remove(inst); inst.geometry.dispose(); inst.material.dispose(); inst = null; }
  bodies.length = 0; levBodies.length = 0; playerBody = null;
  if (world) { world.free(); world = null; }
  acc = 0; awakeCount = 0;
}

// ---------------------------------------------------------------------------
export function updatePhysics(dt, playerPos, playerVel, levSpine) {
  if (!world || !physicsReady) return;
  const t0 = performance.now();

  // Kinematic targets. Rapier derives the pusher's velocity from the position delta it
  // is asked to reach, which is what actually imparts the impulse on contact.
  if (playerPos) {
    _t.x = playerPos.x; _t.y = playerPos.y; _t.z = playerPos.z;
    if (playerVel) { _t.x += playerVel.x * dt; _t.y += playerVel.y * dt; _t.z += playerVel.z * dt; }
    playerBody.setNextKinematicTranslation(_t);
  }
  applySpine(levSpine, playerPos);

  acc += dt;
  if (acc > FIXED * MAX_SUB) acc = FIXED * MAX_SUB;
  let steps = 0;
  while (acc >= FIXED && steps < MAX_SUB) { world.step(); acc -= FIXED; steps++; }
  if (!steps) { lastMs = performance.now() - t0; return; }

  // ---- sync ----
  let awake = 0, dirty = false;
  for (let i = 0; i < bodies.length; i++) {
    const e = bodies[i], b = e.b;
    if (b.isSleeping()) { if (!e.live) continue; e.live = false; } else { e.live = true; awake++; }
    const p = b.translation(), r = b.rotation();
    _p.set(p.x, p.y, p.z); _q.set(r.x, r.y, r.z, r.w); _s.set(e.sx, e.sy, e.sx);
    inst.setMatrixAt(i, _m.compose(_p, _q, _s));
    dirty = true;
  }
  if (dirty) inst.instanceMatrix.needsUpdate = true;
  awakeCount = awake;
  lastMs = performance.now() - t0;
}

// Nearest LEV_N spine points to the player become kinematic shovers; the rest park.
function applySpine(spine, playerPos) {
  if (!spine || !spine.length || !playerPos) {
    for (let i = 0; i < levBodies.length; i++) {
      const p = levBodies[i].translation();
      if (p.y !== PARK_Y) { _t.x = 0; _t.y = PARK_Y; _t.z = 0; levBodies[i].setNextKinematicTranslation(_t); }
    }
    return;
  }
  const n = Math.min(spine.length, _order.length);
  for (let i = 0; i < n; i++) {
    const s = spine[i], dx = s.x - playerPos.x, dy = s.y - playerPos.y, dz = s.z - playerPos.z;
    _order[i] = i; _dist[i] = dx * dx + dy * dy + dz * dz;
  }
  // partial selection sort — LEV_N passes, no allocation
  const k = Math.min(LEV_N, n);
  for (let a = 0; a < k; a++) {
    let m = a;
    for (let b = a + 1; b < n; b++) if (_dist[_order[b]] < _dist[_order[m]]) m = b;
    const tmp = _order[a]; _order[a] = _order[m]; _order[m] = tmp;
  }
  for (let i = 0; i < levBodies.length; i++) {
    if (i < k) { const s = spine[_order[i]]; _t.x = s.x; _t.y = s.y; _t.z = s.z; }
    else { _t.x = 0; _t.y = PARK_Y; _t.z = 0; }
    levBodies[i].setNextKinematicTranslation(_t);
  }
}
