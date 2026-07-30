// The umbilical: a verlet-simulated air hose from the raft's pump to the diver's helmet.
// Also enforces the hard leash — the diver physically cannot outrun his air supply.
// OWNED BY: orchestrator.
import * as THREE from 'three';
import { scene } from '../core.js';
import { V3, clamp } from '../lib/math.js';
import { terrainH } from '../world/terrain.js';
import { survival } from './survival.js';
import { pumpPos } from './raft.js';
import { airInletWorldPos } from '../entities/diver.js';

const N = 64;                    // rope nodes
const GRAVITY = -1.6;            // rubber hose is slightly negative-buoyant
const DAMP = 0.986;
const ITER = 10;                 // constraint relaxation passes
const STIFF = 0.34;              // bending stiffness: how hard kinks are pushed out

const pts = [], prev = [];
let anchor = V3(0, -1.2, 0);
let inst = null;
const _b = V3(), _d = V3(), _m = new THREE.Matrix4(), _inlet = V3();
const _q = new THREE.Quaternion(), _s = V3(), _up = V3(0, 1, 0);

export function buildTether(anchorPos) {
  anchor.copy(anchorPos);
  for (let i = 0; i < N; i++) {
    const p = anchor.clone();
    p.y -= i * 0.5;
    pts.push(p);
    prev.push(p.clone());
  }
  const geo = new THREE.CylinderGeometry(1, 1, 1, 7, 1, true);
  geo.translate(0, 0.5, 0);                 // pivot at the base so scaling grows along the segment
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f42, roughness: 0.85, metalness: 0.05 });
  inst = new THREE.InstancedMesh(geo, mat, N - 1);
  inst.castShadow = true;
  inst.frustumCulled = false;
  scene.add(inst);
}

export function tetherAnchor() { return anchor; }

export function setTetherVisible(v) { if (inst) inst.visible = v; }

// Returns the distance from the raft, after applying the leash to player.pos/vel.
export function updateTether(dt, player, zone) {
  // The raft rides the swell, so the anchor must track the pump's live position or the
  // hose visibly detaches from the reel by the height of a wave.
  anchor.copy(pumpPos);
  const zi = zone < 0 ? 0 : zone;
  const helmet = airInletWorldPos(_inlet);

  // Hard leash: the hose runs out and the diver is held back.
  // window.__noLeash disables it so test harnesses can teleport freely.
  const toDiver = _d.copy(player.pos).sub(anchor);
  const dist = toDiver.length();
  if (dist > survival.hose && !window.__noLeash) {
    toDiver.multiplyScalar(survival.hose / dist);
    player.pos.copy(anchor).add(toDiver);
    const outward = player.vel.dot(toDiver.normalize());
    if (outward > 0) player.vel.addScaledVector(toDiver, -outward);
  }
  survival.tautness = clamp(dist / survival.hose, 0, 1);

  // Pay out only a little more hose than the straight-line distance, so the rope
  // hangs in a believable catenary instead of folding into sharp switchbacks.
  const deployed = Math.min(survival.hose, dist * 1.04 + 4);
  const rest = deployed / (N - 1);

  const g = GRAVITY * dt * dt;
  for (let i = 1; i < N - 1; i++) {
    const p = pts[i], q = prev[i];
    const vx = (p.x - q.x) * DAMP, vy = (p.y - q.y) * DAMP, vz = (p.z - q.z) * DAMP;
    q.copy(p);
    p.set(p.x + vx, p.y + vy + g, p.z + vz);
  }
  pts[0].copy(anchor);
  pts[N - 1].copy(helmet);

  for (let k = 0; k < ITER; k++) {
    for (let i = 0; i < N - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      _b.copy(q).sub(p);
      const d = _b.length() || 1e-6;
      const diff = (d - rest) / d * 0.5;
      _b.multiplyScalar(diff);
      if (i !== 0) p.add(_b);
      if (i + 1 !== N - 1) q.sub(_b);
    }
    // Bending stiffness: pull each node toward the midpoint of its neighbours so the
    // hose curves like rubber instead of folding into hard switchbacks.
    for (let i = 1; i < N - 1; i++) {
      const p = pts[i], a = pts[i - 1], b = pts[i + 1];
      p.x += ((a.x + b.x) * 0.5 - p.x) * STIFF;
      p.y += ((a.y + b.y) * 0.5 - p.y) * STIFF;
      p.z += ((a.z + b.z) * 0.5 - p.z) * STIFF;
    }
    pts[0].copy(anchor);
    pts[N - 1].copy(helmet);
  }

  // Rest on the seafloor rather than sinking through it.
  for (let i = 1; i < N - 1; i++) {
    const p = pts[i];
    const floor = terrainH(p.x, p.z, zi) + 0.2;
    if (p.y < floor) { p.y = floor; prev[i].y = floor; }
  }

  // Orient one cylinder per segment.
  for (let i = 0; i < N - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    _d.copy(q).sub(p);
    const len = _d.length() || 1e-6;
    _q.setFromUnitVectors(_up, _d.divideScalar(len));
    const r = 0.065 * (i % 3 === 0 ? 1.25 : 1);   // rings read as corrugation
    _s.set(r, len, r);
    _m.compose(p, _q, _s);
    inst.setMatrixAt(i, _m);
  }
  inst.instanceMatrix.needsUpdate = true;
  return dist;
}
