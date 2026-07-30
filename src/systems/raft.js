// The surface raft: hull, air pump, hose reel, and the beacon the diver navigates home by.
// OWNED BY: orchestrator.
import * as THREE from 'three';
import { scene, envTex } from '../core.js';
import { SURFACE_Y } from '../config.js';
import { V3 } from '../lib/math.js';
import { makeGlow } from '../lib/textures.js';
import { survival } from './survival.js';

export const raft = new THREE.Group();
export const RAFT_POS = V3(0, SURFACE_Y - 1.6, 0);
let flywheel = null, beacon = null, beaconGlow = null, reel = null;

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

  // air pump / generator: engine block with a driven flywheel
  const block = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.2), iron);
  block.position.set(0, 0.75, -1.2);
  raft.add(block);
  flywheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 8, 20), brass);
  flywheel.position.set(1.05, 0.85, -1.2);
  flywheel.rotation.y = Math.PI / 2;
  raft.add(flywheel);
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 10), iron);
  stack.position.set(-0.5, 1.7, -1.2);
  raft.add(stack);

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

  // derrick + beacon: the light the diver looks up for
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), iron);
    leg.position.set(s * 1.3, 1.9, 2.6);
    leg.rotation.z = -s * 0.16;
    raft.add(leg);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), iron);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 3.5, 2.6);
  raft.add(bar);
  beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  beacon.position.set(0, 3.2, 2.6);
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
  pumpPos.set(RAFT_POS.x, RAFT_POS.y - 0.9, RAFT_POS.z + 0.6);
}

// Storm intensity 0..1, pushed in by game.js from the weather system.
let storm = 0;
export function setSwell(k) { storm = k; }

export function updateRaft(dt, t) {
  // swell scales with the storm (set by game.js): a storm-tossed raft heaves ~3x and
  // adds a faster chop harmonic, which the tether anchor inherits for free via pumpPos.
  const sw = 1 + storm * 2.1, chop = storm * Math.sin(t * 2.3) * 0.22;
  raft.position.y = RAFT_POS.y + Math.sin(t * 0.6) * 0.32 * sw + chop;
  raft.position.x = RAFT_POS.x + Math.sin(t * 0.37) * 0.16 * sw;
  raft.rotation.z = Math.sin(t * 0.52) * 0.035 * sw + storm * Math.sin(t * 1.9) * 0.02;
  raft.rotation.x = Math.cos(t * 0.44) * 0.028 * sw;
  pumpPos.set(raft.position.x, raft.position.y - 0.9, raft.position.z + 0.6);

  // the flywheel only turns while there is fuel to burn
  if (survival.fuel > 0) {
    flywheel.rotation.z += dt * 9;
    reel.rotation.x += dt * 0.4;
  }
  const lit = survival.fuel > 0 ? 1 : 0.25;
  beacon.material.color.setRGB(1 * lit, 0.85 * lit, 0.63 * lit);
  beaconGlow.scale.setScalar(7 * (0.8 + 0.2 * Math.sin(t * 2)) * lit);
}

export function nearRaft(pos, radius = 12) {
  return pos.distanceTo(raft.position) < radius;
}
