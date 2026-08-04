// The surface raft: hull, air pump, hose reel, and the beacon the diver navigates home by.
// OWNED BY: orchestrator.
import * as THREE from 'three';
import { scene, envTex } from '../core.js';
import { SURFACE_Y } from '../config.js';
import { V3 } from '../lib/math.js';
import { makeGlow } from '../lib/textures.js';
import { survival } from './survival.js';

export const raft = new THREE.Group();
// IT FLOATS. This sat at SURFACE_Y - 1.6 for the whole project, which put the deck top at
// y = -1.49 and the flotation drums entirely under water — nobody noticed because the
// camera had never once been above the waterline. At +0.55 the drums (r 0.85, local
// centre -0.75) sit about 62% submerged, which is where an oil drum floats, and the deck
// carries ~0.66 of freeboard. The bob is +-0.32 before storm gain, so the deck never
// dips under. Everything downstream is position-relative (pumpPos, nearRaft, the respawn
// point, the ending's arrival, the HUD bearing) and follows for free.
export const RAFT_POS = V3(0, SURFACE_Y + 0.55, 0);
let flywheel = null, beacon = null, beaconGlow = null, reel = null;
let stackMesh = null, pump = null, govBall = null;
const PUFFN = 7, puffs = [];
let puffT = 0;
// Where the umbilical actually leaves the raft: over the gallows sheave, outboard of
// the deck edge. RAFT-LOCAL; pumpPos is this transformed into world space each frame.
const hoseHead = V3();
const hoseMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.85, metalness: 0.05 });

// Where the umbilical leaves the pump.
export const pumpPos = V3();

export function buildRaft() {
  raft.position.copy(RAFT_POS);

  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3a29, roughness: 0.9, envMap: envTex, envMapIntensity: 0.2 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2e3134, roughness: 0.55, metalness: 0.8, envMap: envTex, envMapIntensity: 0.5 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d2e, roughness: 0.35, metalness: 0.9, envMap: envTex, envMapIntensity: 0.7 });

  // hull: planked deck with cross-beams, seen mostly from underneath
  for (let i = -4; i <= 4; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 9.4), wood);
    plank.position.set(i * 1.05, 0, 0);
    raft.add(plank);
  }
  for (const z of [-3.6, 0, 3.6]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.26, 0.6), iron);
    beam.position.set(0, -0.22, z);
    raft.add(beam);
  }
  // flotation drums under the deck
  for (const [x, z] of [[-3.6, -3.2], [3.6, -3.2], [-3.6, 3.2], [3.6, 3.2]]) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.2, 14), iron);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(x, -0.75, z);
    raft.add(drum);
  }

  // ---- the air pump. It must READ as running or dead at a glance, because the fuel
  // gauge is the second most important number in the game and the pump IS that gauge.
  pump = new THREE.Group();
  pump.position.set(0, 0.75, -1.2);
  raft.add(pump);

  const blk = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.2), iron);
  pump.add(blk);
  // bed the block on a plinth instead of leaving it floating on the planks
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.16, 1.45), wood);
  plinth.position.y = -0.72;
  pump.add(plinth);
  // two cylinder heads with bolt collars — the single box read as a crate
  for (const x of [-0.42, 0.42]) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 12), iron);
    head.position.set(x, 0.78, 0);
    pump.add(head);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 6, 14), brass);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(x, 0.56, 0);
    pump.add(collar);
  }
  // receiver tank along the outboard face
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.5, 12), iron);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(0, -0.1, 0.75);
  pump.add(tank);

  // FLYWHEEL. Nested in its own group so the spin is unambiguous: the group carries the
  // orientation, the mesh spins about its OWN axis. Setting rotation.z on a mesh already
  // turned by rotation.y does not spin a torus in its plane, it tumbles it.
  const fwPivot = new THREE.Group();
  fwPivot.position.set(1.05, 0.10, 0);
  fwPivot.rotation.y = Math.PI / 2;
  pump.add(fwPivot);
  flywheel = new THREE.Group();
  fwPivot.add(flywheel);
  flywheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 8, 20), brass));
  // spokes, so a spinning wheel actually reads as spinning
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.07, 0.05), brass);
    spoke.rotation.z = i * Math.PI / 4;
    flywheel.add(spoke);
  }
  flywheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 10), iron)
    .rotateX(Math.PI / 2));
  // crank pin riding the rim: the one detail that makes rotation unmistakable
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), brass);
  pin.position.set(0.40, 0, 0.16); pin.rotation.x = Math.PI / 2;
  flywheel.add(pin);

  // governor: two balls that fly OUT as it runs and drop when it dies
  govBall = new THREE.Group();
  govBall.position.set(-0.62, 0.92, 0);
  pump.add(govBall);
  const govPost = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 6), iron);
  govPost.position.y = 0.21; govBall.add(govPost);
  for (const sgn of [-1, 1]) {
    const arm = new THREE.Group();
    arm.userData.sgn = sgn;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 5), iron);
    rod.position.y = -0.17; arm.add(rod);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), brass);
    ball.position.y = -0.34; arm.add(ball);
    arm.position.set(0, 0.42, 0);
    govBall.add(arm);
  }

  stackMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 10), iron);
  stackMesh.position.set(-0.5, 0.95, 0);
  pump.add(stackMesh);
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.17, 0.16, 10), iron);
  cowl.position.set(-0.5, 1.55, 0);
  pump.add(cowl);

  // exhaust: grey puffs that climb and fade, recycled. Only issued while it burns.
  const puffMat = new THREE.MeshBasicMaterial({ color: 0x6b6f73, transparent: true, opacity: 0.32, depthWrite: false });
  for (let i = 0; i < PUFFN; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), puffMat.clone());
    m.visible = false;
    raft.add(m);
    puffs.push({ m, life: 0, max: 1, vy: 0, dz: 0 });
  }

  // hose reel the umbilical pays out from
  reel = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.1, 16, 1, true), iron);
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0, 0.7, 0.6);
  raft.add(reel);
  for (const s of [-0.62, 0.62]) {
    const cheek = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.09, 16), iron);
    cheek.rotation.z = Math.PI / 2;
    cheek.position.set(s, 0.7, 0.6);
    raft.add(cheek);
  }

  // THE GALLOWS. This is a diving davit, not scenery: a tender lowers a dressed man
  // through it and the umbilical runs over its block, which is why it OVERHANGS the
  // side. Previously it sat inboard and read as "three posts around the lamp" — nothing
  // passed through it, so it explained nothing. Now the hose leaves the reel, rises to
  // the sheave and drops from a point outboard of the deck edge, which is also what
  // stops the line from cutting through the planking.
  const GAL_Z = 3.9, HEAD_Z = 5.35, HEAD_Y = 3.30;
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.10, 3.7, 8), iron);
    leg.position.set(s * 1.25, 1.95, GAL_Z);
    leg.rotation.z = -s * 0.15;
    raft.add(leg);
    // knee brace back to the deck: without it the frame reads as loose sticks
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), iron);
    brace.position.set(s * 1.42, 0.72, GAL_Z - 0.62);
    brace.rotation.set(0.72, 0, -s * 0.2);
    raft.add(brace);
  }
  // head beam, cantilevered outboard so the load hangs clear of the hull
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 2.6, 8), iron);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 3.72, GAL_Z);
  raft.add(bar);
  const jib = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.85, 8), iron);
  jib.rotation.x = Math.PI / 2 - 0.30;
  jib.position.set(0, 3.60, GAL_Z + 0.72);
  raft.add(jib);
  // the sheave the umbilical rides over — the thing that makes the frame legible
  const sheave = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.055, 8, 16), brass);
  sheave.rotation.y = Math.PI / 2;
  sheave.position.set(0, HEAD_Y, HEAD_Z);
  raft.add(sheave);
  const strop = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 6), iron);
  strop.position.set(0, HEAD_Y + 0.24, HEAD_Z);
  raft.add(strop);
  hoseHead.set(0, HEAD_Y, HEAD_Z);

  // A short static lead of hose from the reel up to the sheave, so the umbilical
  // visibly COMES FROM the reel instead of appearing out of the air at the block.
  {
    const a = new THREE.Vector3(0, 1.15, 0.6), b = hoseHead;
    const mid = a.clone().lerp(b, 0.5); mid.y += 0.22;      // a little sag over the run
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b.clone());
    const lead = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.055, 7, false), hoseMat);
    raft.add(lead);
  }

  beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  beacon.position.set(0, 3.62, GAL_Z);
  raft.add(beacon);
  beaconGlow = makeGlow(0xffc98a, 7);
  beaconGlow.position.copy(beacon.position);
  raft.add(beaconGlow);

  // downward lamp so the raft reads as a lit landmark from below
  const lamp = new THREE.PointLight(0xffd2a0, 26, 90, 1.7);
  lamp.position.set(0, -0.6, 0);
  raft.add(lamp);

  raft.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(raft);
  raft.updateMatrixWorld(true);
  raft.localToWorld(pumpPos.copy(hoseHead));
}

// Storm intensity 0..1, pushed in by game.js from the weather system.
let storm = 0, rpm = 0;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export function setSwell(k) { storm = k; }

export function updateRaft(dt, t) {
  // swell scales with the storm (set by game.js): a storm-tossed raft heaves ~3x and
  // adds a faster chop harmonic, which the tether anchor inherits for free via pumpPos.
  const sw = 1 + storm * 2.1, chop = storm * Math.sin(t * 2.3) * 0.22;
  raft.position.y = RAFT_POS.y + Math.sin(t * 0.6) * 0.32 * sw + chop;
  raft.position.x = RAFT_POS.x + Math.sin(t * 0.37) * 0.16 * sw;
  raft.rotation.z = Math.sin(t * 0.52) * 0.035 * sw + storm * Math.sin(t * 1.9) * 0.02;
  raft.rotation.x = Math.cos(t * 0.44) * 0.028 * sw;
  // The anchor rides the sheave, so the hose stays on the block as the raft rolls.
  // The matrix has to be refreshed first — localToWorld reads matrixWorld, which three
  // would not rebuild until render, leaving the anchor a frame behind the swell.
  raft.updateMatrixWorld(true);
  raft.localToWorld(pumpPos.copy(hoseHead));

  // ---- running or dead, told four ways at once -------------------------------------
  const running = survival.fuel > 0;
  // The wheel coasts to a stop rather than freezing: a heavy flywheel has inertia, and a
  // hard cut is the single clearest tell that a machine is fake.
  rpm += ((running ? 9.0 : 0) - rpm) * Math.min(1, dt * (running ? 1.6 : 0.35));
  flywheel.rotation.z += dt * rpm;
  if (running) reel.rotation.x += dt * 0.4;
  // governor balls fly out with speed and drop as it dies
  const gov = clamp01(rpm / 9);
  for (const a of govBall.children) {
    if (a.userData.sgn === undefined) continue;
    a.rotation.z = a.userData.sgn * (0.18 + 0.78 * gov);
  }
  // the whole engine shakes while it fires, and the shake follows the revs
  const vib = gov * 0.012;
  pump.position.set(Math.sin(t * 41) * vib, 0.75 + Math.sin(t * 33) * vib, -1.2);
  pump.rotation.z = Math.sin(t * 37) * vib * 0.6;

  // exhaust
  puffT -= dt;
  if (running && puffT <= 0) {
    puffT = 0.16 + Math.random() * 0.12;
    const p = puffs.find(q => q.life <= 0);
    if (p) {
      p.life = p.max = 1.7 + Math.random() * 0.9;
      p.vy = 0.9 + Math.random() * 0.5;
      p.dz = (Math.random() - 0.5) * 0.3;
      p.m.position.set(-0.5, 2.4, -1.2);
      p.m.visible = true;
    }
  }
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.m.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.m.position.y += p.vy * dt;
    p.m.position.x += (0.35 + p.dz) * dt;      // drifts downwind off the stack
    p.m.position.z += p.dz * dt;
    p.m.scale.setScalar(0.10 + k * 0.42);
    p.m.material.opacity = 0.30 * (1 - k) * (1 - k);
  }
  const lit = survival.fuel > 0 ? 1 : 0.25;
  beacon.material.color.setRGB(1 * lit, 0.85 * lit, 0.63 * lit);
  beaconGlow.scale.setScalar(7 * (0.8 + 0.2 * Math.sin(t * 2)) * lit);
}

export function nearRaft(pos, radius = 12) {
  return pos.distanceTo(raft.position) < radius;
}
