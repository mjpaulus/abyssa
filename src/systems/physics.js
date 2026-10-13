// SEABED DEBRIS: the loose stone of the open floor (rubble, cobbles, broken slabs), in the
// house rock vocabulary, half in the silt with the silt drifted against it.
//
// HISTORY (primfix 2026-10-13, reviews/primitives-audit.md item 1): this module was Rapier
// "world physicality" — 120 flat-shaded dodecahedra per zone, placed with Math.random, as
// dynamic bodies that Sal's boots (a 0.9 u kinematic ball at his feet) and the sleeper's
// spine shoved about. THE BODIES WERE VESTIGIAL and are gone: nothing read them (no
// gameplay, no camera, no collision on Sal's side), the contact rate was ~1 stone per
// 250 u walked, a half-buried stone in a silt drift cannot be kicked loose, and one body
// fell through the floor on boot (spawned inside a flora boulder's fixed ball, the solver
// pushed it under the one-sided heightfield). Rapier is no longer fetched (it was only ever
// loaded for these). The debris is static decor now, laid as a pure function of the site:
//
//   * its OWN stream (site.js seeds.debris, mixed with the zone): boot and arrive-back lay the
//     same stones, and no terrain/flora/wreck stream or fingerprint moves;
//   * flora.js jamRockKit's four shapes (the fissure jam's: a fresh-broken block, a rounded
//     boulder, a slab, a shard), flora's 'rock' program and generated rock map set (rockMapSet,
//     triplanar) — zero new programs; one InstancedMesh per shape;
//   * in clusters (a parent stone and the pieces broken off it), varied size, tilt and squash,
//     each SEATED on the drawn floor (wrecks.js terrainSample: the terrain mesh's own triangles,
//     or the fissure patch near a crack) and sunk 28-42 % of its height;
//   * a SILT DRIFT round each (wrecks.js driftSkirt, the terrain's own material, deeper on the
//     lee of the current): one merged mesh per zone, the seabed's own program;
//   * kept off the crack (clearOfCrack), Velkath's bed (clearOfBed), the wreck sites and flora's
//     boulders (rockColliders footprints), and off steep ground.
//
// CONTRACT (game.js wires these; kept so game.js needs no change):
//   await initPhysics(zi)  -> lays zone zi's debris (sync; the boot awaits it in the loader).
//   switchZone(zi)         -> re-lays for zone zi (a zone entry, the voyage's enterZone(0));
//                             a no-op until initPhysics has run (the boot's enterZone(0, true)
//                             precedes it).
//   updatePhysics()        -> nothing per frame (static).
//   physicsReady, physicsStats() -> { stones, drift, ms } (debug).
import * as THREE from 'three';
import { scene } from '../core.js';
import { WORLD_R } from '../config.js';
import { clearOfCrack } from '../world/fissureShape.js';
import { clearOfBed } from '../entities/sleeper/lair.js';
import { terrainNormal, terrainMeshes } from '../world/terrain.js';
import { rockColliders, jamRockKit } from '../world/flora.js';
import { terrainSample, driftSkirt, leeOf, wreckSites } from '../world/wrecks.js';
import { siteParams } from '../world/site.js';
import { seededRand } from '../lib/textures.js';

const TAU = Math.PI * 2;
const N_CLUSTER = 34;          // clusters per zone (a parent stone + 0-4 pieces): ~90 stones
// flora rockGeo shapes [detail, squash, amp, facet] (fissure.js SHAPES at detail 3: 320 tris)
const SHAPES = [[3, 0.95, 0.5, 2.4], [3, 0.85, 0.75, 1.0], [3, 0.55, 0.55, 2.0], [3, 1.0, 0.9, 3.0]];
const CAP = 72;                // instances per shape (the cluster draws stop at CAP)

export let physicsReady = false;
let started = false, zone = 0, lastMs = 0, nStones = 0;
let kinds = null, drift = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _ax = new THREE.Vector3(), _c = new THREE.Color();

export function physicsStats() { return { stones: nStones, drift: drift ? drift.geometry.attributes.position.count : 0, ms: lastMs }; }

export async function initPhysics(zi) {
  started = true;
  build(zi);
  physicsReady = true;
}
export function switchZone(zi) {
  if (!started) return;
  build(zi);
}
export function updatePhysics() { /* static: nothing per frame */ }

function teardown() {
  // geometry is this build's own; the materials are flora's rock / the terrain's: never disposed
  if (kinds) for (const k of kinds) { scene.remove(k.im); k.im.geometry.dispose(); }
  if (drift) { scene.remove(drift); drift.geometry.dispose(); }
  kinds = null; drift = null; nStones = 0;
}

// a stone's footprint test against flora's boulders (their fixed balls: the ground-level circle)
function inBoulder(x, z, r, y) {
  for (let i = 0; i < rockColliders.length; i++) {
    const c = rockColliders[i], dx = x - c.x, dz = z - c.z, dy = c.y - y;
    const gr = c.r * c.r - dy * dy;
    if (gr <= 0) continue;
    const R = Math.sqrt(gr) + r + 0.4;
    if (dx * dx + dz * dz < R * R) return true;
  }
  return false;
}

function build(zi) {
  const t0 = performance.now();
  teardown();
  zone = zi | 0;
  // OWN stream: the site's debris seed, mixed with the zone (a pure function of both)
  const base = siteParams('debris').rng;
  const rand = seededRand(((base() * 4294967296) >>> 0) ^ Math.imul(zone + 1, 0x9E3779B1));
  const rr = (a, b) => a + (b - a) * rand();
  if (!terrainMeshes[zone]) return;

  // the four shapes: flora's generator on our stream, flora's rock material ('rock' program)
  kinds = SHAPES.map((S, k) => {
    const kit = jamRockKit(zone, rand, S[0], S[1], S[2], S[3]);
    const g = kit.geo;
    g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4));   // zeros: no sway
    const im = new THREE.InstancedMesh(g, kit.mat, CAP);
    im.name = 'debris' + zone + '_' + k;
    im.receiveShadow = true;             // as flora's boulders and the jam (part of the program key)
    im.castShadow = false;
    im.frustumCulled = false;            // one mesh spans the zone; the material's own range cull does the rest
    const P = g.attributes.position;
    let lo = 1e9, hi = -1e9, rx = 0;
    for (let i = 0; i < P.count; i++) { const y = P.getY(i); lo = Math.min(lo, y); hi = Math.max(hi, y); rx = Math.max(rx, Math.hypot(P.getX(i), P.getZ(i))); }
    return { im, lo, hi, rx, n: 0, rock: kit.rock };
  });

  const sites = wreckSites().filter(w => w.zi === zone);
  const skirts = [];
  let guard = 0, clusters = 0;
  while (clusters < N_CLUSTER && guard++ < N_CLUSTER * 60) {
    const a = rand() * TAU, r = 26 + Math.sqrt(rand()) * (WORLD_R * 0.64 - 26);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const nPiece = rand() < 0.3 ? 0 : 1 + Math.floor(rand() * 4);
    const S0 = rr(0.34, 0.85) * (rand() < 0.16 ? 1.45 : 1);       // the parent stone's half-size (u)
    if (!placeStone(cx, cz, S0, true)) continue;
    clusters++;
    // the pieces broken off it: smaller, scattered round its downslope / lee side
    for (let k = 0; k < nPiece; k++) {
      const pa = rand() * TAU, pr = S0 * rr(1.3, 3.2), s = S0 * rr(0.25, 0.6);
      placeStone(cx + Math.cos(pa) * pr, cz + Math.sin(pa) * pr, s, false);
    }
  }
  // the stone itself: shape, size, squash, tilt, burial; rejected where it does not belong
  function placeStone(x, z, S, parent) {
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const sq = rr(0.55, 0.95), yaw = rand() * TAU, tilt = rr(0, 0.42), tAz = rand() * TAU, bury = rr(0.28, 0.42), shade = rr(0.72, 1.18);
    if (kind.n >= CAP) return false;
    const fr = S * kind.rx * 1.15;
    if (!clearOfCrack(x, z, zone, fr + 0.5) || !clearOfBed(zone, x, z, fr)) return false;
    for (const w of sites) if (Math.hypot(x - w.x, z - w.z) < w.clear + fr) return false;
    const n = terrainNormal(x, z, zone);
    if (n.y < 0.86) return false;                                   // too steep to hold loose stone
    const y0 = terrainSample(zone, x, z);
    if (inBoulder(x, z, fr, y0)) return false;
    // lean: mostly onto the slope, plus the stone's own random tilt
    _n.set(n.x, n.y, n.z);
    _q.setFromUnitVectors(_up, _n).slerp(_q2.identity(), 0.25);
    _ax.set(Math.cos(tAz), 0, Math.sin(tAz));
    _q.multiply(_q2.setFromAxisAngle(_ax, tilt)).multiply(_q2.setFromAxisAngle(_up, yaw));
    const sx = S * rr(0.85, 1.25), sy = S * sq, sz = S * rr(0.85, 1.25);
    // sunk `bury` of its height: its lowest point that far under the drawn floor (tilt adds a little)
    const h = (kind.hi - kind.lo) * sy;
    const y = y0 - kind.lo * sy - bury * h - Math.sin(tilt) * S * 0.25;
    _p.set(x, y, z); _s.set(sx, sy, sz);
    kind.im.setMatrixAt(kind.n, _m.compose(_p, _q, _s));
    _c.set(kind.rock).multiplyScalar(shade);
    kind.im.setColorAt(kind.n, _c);
    kind.n++;
    nStones++;
    // the drift: footprint ~ the stone's waterline radius, banked deeper on the lee
    const R = Math.max(sx, sz) * kind.rx * 0.82;
    const fp = new Float32Array(12);
    for (let i = 0; i < 12; i++) fp[i] = R * (0.82 + 0.3 * Math.abs(Math.sin(i * 1.7 + x * 3.1 + z * 1.3)));
    const H = Math.min(0.32, 0.05 + 0.2 * S * (parent ? 1 : 0.7)), W = 0.22 + 1.05 * S;
    skirts.push(driftSkirt(zone, x, z, fp, i => H * (0.45 + 0.55 * leeOf(i / 12 * TAU)), i => W * (0.5 + 0.8 * leeOf(i / 12 * TAU)), 0.72, 3));
    return true;
  }
  for (const k of kinds) {
    k.im.count = k.n;
    k.im.instanceMatrix.needsUpdate = true;
    if (k.im.instanceColor) k.im.instanceColor.needsUpdate = true;
    scene.add(k.im);
  }
  // one merged drift mesh, the terrain's own zone material (it IS seabed: same program)
  if (skirts.length) {
    let nv = 0, ni = 0;
    for (const g of skirts) { nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const g of skirts) {
      pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); col.set(g.attributes.color.array, vo * 3);
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + vo;
      vo += g.attributes.position.count; io += ix.length;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    drift = new THREE.Mesh(geo, terrainMeshes[zone].material);
    drift.receiveShadow = true;
    drift.name = 'debrisDrift' + zone;
    scene.add(drift);
  }
  lastMs = +(performance.now() - t0).toFixed(1);
}
