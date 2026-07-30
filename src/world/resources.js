// Collectible craft materials: polymer nodules (hose) and bitumen seeps (pump fuel).
// OWNED BY: orchestrator. Deliberately self-contained — it does its own placement rather
// than importing flora's scatter, so concurrent flora work can't destabilise progression.
import * as THREE from 'three';
import { scene } from '../core.js';
import { WORLD_R, RIFT_R, riftPos } from '../config.js';
import { rng, V3 } from '../lib/math.js';
import { makeGlow } from '../lib/textures.js';
import { terrainH } from './terrain.js';
import { collect } from '../systems/survival.js';

const RESPAWN = 55;   // finite-feeling but never soft-locking
export const nodes = [];

function place(zi, count, minR, maxR) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const a = Math.random() * Math.PI * 2, r = rng(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rp = riftPos(zi);
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 2.6) continue;
    out.push(V3(x, terrainH(x, z, zi), z));
  }
  return out;
}

function polymerMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2f6b5a, roughness: 0.45, metalness: 0.05,
    emissive: 0x1a5f4a, emissiveIntensity: 0.7
  });
  // a small cluster of rubbery bladders
  for (let i = 0; i < 4; i++) {
    const s = rng(0.35, 0.62);
    const b = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), mat);
    b.scale.y = rng(0.7, 1.3);
    b.position.set(rng(-0.5, 0.5), s * 0.7, rng(-0.5, 0.5));
    g.add(b);
  }
  g.add(makeGlow(0x5fffcf, 3.2));
  return g;
}

function bitumenMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.25, metalness: 0.3 });
  const pool = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  pool.scale.set(1.3, 0.35, 1.3);
  g.add(pool);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(rng(0.14, 0.26), 8, 6), mat);
    b.position.set(rng(-0.5, 0.5), rng(0.2, 0.7), rng(-0.5, 0.5));
    g.add(b);
  }
  g.add(makeGlow(0xffa64d, 1.8));
  return g;
}

export function buildResources() {
  for (let zi = 0; zi < 3; zi++) {
    for (const p of place(zi, 11, 25, WORLD_R * 0.85)) {
      const m = polymerMesh();
      m.position.copy(p);
      scene.add(m);
      nodes.push({ grp: m, kind: 'polymer', alive: true, respawn: 0, ph: Math.random() * 7, zi });
    }
    for (const p of place(zi, 9, 25, WORLD_R * 0.8)) {
      const m = bitumenMesh();
      m.position.copy(p);
      scene.add(m);
      nodes.push({ grp: m, kind: 'bitumen', alive: true, respawn: 0, ph: Math.random() * 7, zi });
    }
  }
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
      n.alive = false; n.respawn = RESPAWN; n.grp.visible = false;
      collect(n.kind);
      got = n.kind;
    }
  }
  return got;
}
