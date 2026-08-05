// Collectible craft materials: polymer nodules (hose) and bitumen seeps (pump fuel).
// OWNED BY: orchestrator. Deliberately self-contained — it does its own placement rather
// than importing flora's scatter, so concurrent flora work can't destabilise progression.
import * as THREE from 'three';
import { scene } from '../core.js';
import { WORLD_R, RIFT_R, riftPos } from '../config.js';
import { V3 } from '../lib/math.js';
import { makeGlow } from '../lib/textures.js';
import { terrainH } from './terrain.js';
import { collect } from '../systems/survival.js';
import { siteParams } from './site.js';

const RESPAWN = 55;   // finite-feeling but never soft-locking; scaled per-kind by scarcity
const N_POLYMER = 11, N_BITUMEN = 9;   // site-0 base counts — verbatim shipped values
export const nodes = [];

// ---------------------------------------------------------------------------
// Deterministic PRNG — mulberry32 via siteParams('resources').rng, drawn fresh on every
// build/reseed (site.js's own stream() factory). `rnd` is a `let` reassigned per build,
// never a counter this module owns, so a reseed can never resume mid-stream from a stale
// cursor. Site 0's seed is 0xC0FFEE01 and every draw below happens in the exact order the
// shipped Math.random()-driven version did, so site 0 grows the SHIPPED field.
// ---------------------------------------------------------------------------
let rnd = null;
const rr = (a, b) => a + rnd() * (b - a);

// Scarcity-scaled per-kind respawn seconds — recomputed on every build/reseed from the
// current site's scarcity dial. Site 0's dial is 1/1, so this equals RESPAWN exactly.
let respawnPolymer = RESPAWN, respawnBitumen = RESPAWN;

function place(zi, count, minR, maxR) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const a = rnd() * Math.PI * 2, r = rr(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rp = riftPos(zi);
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 2.6) continue;
    out.push(V3(x, terrainH(x, z, zi), z));
  }
  return out;
}

// The two materials every node's bladders/pools share — created once, ever, and reused
// on every reseed. A fresh instance would be a fresh compile for every node bound to it,
// which is exactly what reseedResources() exists to avoid.
let polymerMat = null, bitumenMat = null;

function polymerMesh() {
  if (!polymerMat) polymerMat = new THREE.MeshStandardMaterial({
    color: 0x2f6b5a, roughness: 0.45, metalness: 0.05,
    emissive: 0x1a5f4a, emissiveIntensity: 0.7
  });
  const g = new THREE.Group();
  // a small cluster of rubbery bladders
  for (let i = 0; i < 4; i++) {
    const s = rr(0.35, 0.62);
    const b = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), polymerMat);
    b.scale.y = rr(0.7, 1.3);
    b.position.set(rr(-0.5, 0.5), s * 0.7, rr(-0.5, 0.5));
    g.add(b);
  }
  g.add(makeGlow(0x5fffcf, 3.2));
  return g;
}

function bitumenMesh() {
  if (!bitumenMat) bitumenMat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.25, metalness: 0.3 });
  const g = new THREE.Group();
  const pool = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), bitumenMat);
  pool.scale.set(1.3, 0.35, 1.3);
  g.add(pool);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(rr(0.14, 0.26), 8, 6), bitumenMat);
    b.position.set(rr(-0.5, 0.5), rr(0.2, 0.7), rr(-0.5, 0.5));
    g.add(b);
  }
  g.add(makeGlow(0xffa64d, 1.8));
  return g;
}

// The shared placement pipeline both buildResources() and reseedResources() run. No
// `built`/state guard here — callers own that — and it never touches polymerMat/
// bitumenMat beyond lazily creating them once.
function growResources(scarcity) {
  const nPolymer = Math.max(1, Math.round(N_POLYMER * scarcity.polymer));
  const nBitumen = Math.max(1, Math.round(N_BITUMEN * scarcity.bitumen));
  respawnPolymer = RESPAWN / scarcity.polymer;
  respawnBitumen = RESPAWN / scarcity.bitumen;

  for (let zi = 0; zi < 3; zi++) {
    for (const p of place(zi, nPolymer, 25, WORLD_R * 0.85)) {
      const m = polymerMesh();
      m.position.copy(p);
      scene.add(m);
      nodes.push({ grp: m, kind: 'polymer', alive: true, respawn: 0, ph: rnd() * 7, zi });
    }
    for (const p of place(zi, nBitumen, 25, WORLD_R * 0.8)) {
      const m = bitumenMesh();
      m.position.copy(p);
      scene.add(m);
      nodes.push({ grp: m, kind: 'bitumen', alive: true, respawn: 0, ph: rnd() * 7, zi });
    }
  }
}

let built = false;

export function buildResources() {
  if (built) return;
  built = true;
  const sp = siteParams('resources');
  rnd = sp.rng;
  growResources(sp.scarcity);
}

// Tear down every accumulator this module owns and regrow against the current site +
// current terrain. polymerMat/bitumenMat are the two things that must survive untouched
// (zero recompiles); everything else here is a build product.
export function reseedResources() {
  if (!built) { buildResources(); return; }

  for (const n of nodes) {
    scene.remove(n.grp);
    n.grp.traverse(o => {
      if (o.isMesh) o.geometry.dispose();          // unique per-node sphere geo; material is polymerMat/bitumenMat — reused, not touched
      else if (o.isSprite) o.material.dispose();    // per-node SpriteMaterial; its map is lib/textures.js's shared glowTex — never touched
    });
  }
  nodes.length = 0;   // in place — nothing outside this module holds the array reference, but keep the idiom consistent

  const sp = siteParams('resources');   // fresh stream per brief: never reuse one across rebuilds
  rnd = sp.rng;
  growResources(sp.scarcity);
}

// Returns the kind collected this frame, or null.
export function updateResources(dt, t, playerPos) {
  let got = null;
  for (const n of nodes) {
    if (!n.alive) {
      n.respawn -= dt;
      if (n.respawn <= 0) { n.alive = true; n.grp.visible = true; }
      continue;
    }
    const glow = n.grp.children[n.grp.children.length - 1];
    glow.scale.setScalar((n.kind === 'polymer' ? 3.2 : 1.8) * (0.85 + 0.15 * Math.sin(t * 2 + n.ph)));
    if (n.grp.position.distanceTo(playerPos) < 3.2) {
      n.alive = false; n.respawn = n.kind === 'polymer' ? respawnPolymer : respawnBitumen; n.grp.visible = false;
      collect(n.kind);
      got = n.kind;
    }
  }
  return got;
}
