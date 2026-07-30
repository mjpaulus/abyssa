// Player state, input, and underwater/ground locomotion. OWNED BY: orchestrator.
import * as THREE from 'three';
import { renderer } from './core.js';
import { WORLD_R, SURFACE_Y, RIFT_R, riftPos } from './config.js';
import { V3, clamp, fbm } from './lib/math.js';
import { terrainH, terrainNormal } from './world/terrain.js';
import { rockColliders } from './world/flora.js';
import { propColliders } from './world/props.js';
import { wreckColliders } from './world/wrecks.js';

export const player = {
  pos: V3(0, -10, 0),
  vel: V3(0, 0, 0),
  light: 1,
  yaw: 0,
  pitch: 0,
  grounded: false,
  // smoothed ground height, so cliffy terrain doesn't make the camera judder
  groundY: -10,
  bobPhase: 0,
  breath: 0
};

export const keys = {};
export let locked = false;

addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  document.getElementById('cross').classList.toggle('hidden', !locked);
});
addEventListener('mousemove', e => {
  if (!locked) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45);
});

export function requestLock() { renderer.domElement.requestPointerLock(); }

// Shared temps: these run every frame, so each returns a module-owned vector that is
// valid until the same helper is called again. Copy it if you need to hold it.
const _fwd = V3(), _flat = V3(), _right = V3(), _slide = V3(), _up = V3(0, 1, 0);
export function forwardVec() {
  return _fwd.set(Math.cos(player.pitch) * Math.sin(player.yaw), Math.sin(player.pitch), Math.cos(player.pitch) * Math.cos(player.yaw));
}
export function flatVec() { return _flat.set(Math.sin(player.yaw), 0, Math.cos(player.yaw)); }
export function rightVec() { return _right.set(Math.sin(player.yaw - Math.PI / 2), 0, Math.cos(player.yaw - Math.PI / 2)); }

// Storm factor (0..1, set by game.js): storms roughly triple the ambient current in
// the upper water and add a slow surge, fading out with depth.
let stormK = 0;
export function setStormCurrent(k) { stormK = k; }

// Slow large-scale current that varies over space and time; gives the water a living push.
const current = V3();
function sampleCurrent(pos, t) {
  const s = 0.004;
  const a = fbm(pos.x * s + t * 0.02, pos.z * s) - 0.5;
  const b = fbm(pos.x * s + 31, pos.z * s + t * 0.02 + 17) - 0.5;
  const surge = 1 + stormK * 2.2 * clamp(1 + pos.y / 220, 0, 1);   // storm bite fades by ~zone 0 floor
  return current.set(a, (fbm(pos.x * s + 7, pos.z * s + 3) - 0.5) * 0.4, b).multiplyScalar(2.2 * surge);
}

// Steeper than this and the diver can't get purchase; he slides instead of walking.
const MAX_WALK_SLOPE = 0.62; // cos of max standable angle (~52 degrees)
const EYE_H = 1.35;

export function updatePlayer(dt, t, zone, riftOpen) {
  const zi = zone < 0 ? 0 : zone;
  const th = terrainH(player.pos.x, player.pos.z, zi);
  const rp = riftPos(zi);
  const overRift = riftOpen && Math.hypot(player.pos.x - rp.x, player.pos.z - rp.z) < RIFT_R;
  const floorY = overRift ? -1e5 : th + EYE_H;

  const sprinting = keys['ShiftLeft'] || keys['ShiftRight'];
  const boost = sprinting ? 2 : 1;
  const fwd = forwardVec(), flat = flatVec(), right = rightVec();
  const normal = overRift ? _up : terrainNormal(player.pos.x, player.pos.z, zi);
  const walkable = normal.y > MAX_WALK_SLOPE;

  if (player.grounded) {
    // A man in a Mark V with lead soles PLODS: top speed ~2.6 u/s, a full second to
    // get there, and momentum that carries half a stride after the key lifts. The old
    // values (acc 26, friction 0.02^dt) walked like a jog on dry land and stopped
    // dead — the two together read as erratic.
    const acc = 5.2 * (sprinting ? 1.55 : 1) * (walkable ? 1 : 0.25);
    if (keys['KeyW'] || keys['ArrowUp']) player.vel.addScaledVector(flat, acc * dt);
    if (keys['KeyS'] || keys['ArrowDown']) player.vel.addScaledVector(flat, -acc * dt * 0.7);
    if (keys['KeyA'] || keys['ArrowLeft']) player.vel.addScaledVector(right, -acc * dt * 0.8);
    if (keys['KeyD'] || keys['ArrowRight']) player.vel.addScaledVector(right, acc * dt * 0.8);
    // push-off is a heavy hop into the water column, not a leap
    if (keys['Space']) { player.vel.y = 7.5; player.grounded = false; }
    // On terrain too steep to stand on, gravity drags him downslope.
    if (!walkable) player.vel.addScaledVector(_slide.set(normal.x, 0, normal.z).normalize(), 30 * dt);
    player.vel.y -= 22 * dt;                 // lead boots
    player.vel.x *= Math.pow(0.135, dt);     // silt drag: he keeps a little way on
    player.vel.z *= Math.pow(0.135, dt);
    player.bobPhase += player.vel.length() * dt * 2.1;
  } else {
    // the air thruster (game.js gates it on the relic + Shift + air) triples swim thrust
    const acc = 42 * (player.thrustOn ? 3.2 : boost);
    if (keys['KeyW'] || keys['ArrowUp']) player.vel.addScaledVector(fwd, acc * dt);
    if (keys['KeyS'] || keys['ArrowDown']) player.vel.addScaledVector(fwd, -acc * dt);
    if (keys['KeyA'] || keys['ArrowLeft']) player.vel.addScaledVector(right, -acc * dt);
    if (keys['KeyD'] || keys['ArrowRight']) player.vel.addScaledVector(right, acc * dt);
    if (keys['Space']) player.vel.y += acc * dt;
    if (keys['ControlLeft'] || keys['KeyC']) player.vel.y -= acc * dt;

    // A lead-weighted Mark V suit is decidedly negative-buoyant: he sinks unless he
    // finns. Strong enough that he actually reaches the seabed and can walk.
    player.vel.y -= 5.0 * dt;
    player.vel.y += Math.sin(t * 0.6) * 0.35 * dt;   // trapped helmet air, a slow bob
    // Ambient current nudges him around; the world should never feel perfectly still.
    player.vel.addScaledVector(sampleCurrent(player.pos, t), dt * 0.5);
    // Quadratic drag reads as water rather than the linear damping of air.
    const sp = player.vel.length();
    if (sp > 0.001) player.vel.addScaledVector(player.vel, -Math.min(1 / dt, sp * 0.10) * dt);
    player.vel.multiplyScalar(Math.pow(0.55, dt));
  }

  player.pos.addScaledVector(player.vel, dt);

  const hr = Math.hypot(player.pos.x, player.pos.z);
  if (hr > WORLD_R) { player.pos.x *= WORLD_R / hr; player.pos.z *= WORLD_R / hr; }
  player.pos.y = Math.min(SURFACE_Y - 1.2, player.pos.y);

  // Solid boulders and props: push the diver out of the same spheres the camera avoids,
  // and kill the inward velocity so he slides along the surface instead of jittering.
  const BODY_R = 0.9;
  for (let list = 0; list < 3; list++) {
  const cols = list === 0 ? rockColliders : list === 1 ? propColliders : wreckColliders;
  for (let k = 0; k < cols.length; k++) {
    const c = cols[k], rr = c.r + BODY_R;
    const dx = player.pos.x - c.x; if (dx > rr || dx < -rr) continue;
    const dz = player.pos.z - c.z; if (dz > rr || dz < -rr) continue;
    const dy = player.pos.y - c.y;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= rr * rr || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), push = (rr - d) / d;
    player.pos.x += dx * push; player.pos.y += dy * push; player.pos.z += dz * push;
    const inward = (player.vel.x * dx + player.vel.y * dy + player.vel.z * dz) / d;
    if (inward < 0) {
      player.vel.x -= (dx / d) * inward;
      player.vel.y -= (dy / d) * inward;
      player.vel.z -= (dz / d) * inward;
    }
  }
  }

  // Boots find the bottom a little before the body reaches it, so standing up out of
  // a swim doesn't require pixel-perfect contact on broken ground.
  if (player.pos.y <= floorY) {
    player.pos.y = floorY;
    if (player.vel.y < 0) player.vel.y = 0;
    player.grounded = true;
  } else if (player.pos.y < floorY + 1.2 && player.vel.y <= 0.5 && !keys['Space']) {
    player.pos.y += (floorY - player.pos.y) * Math.min(1, 10 * dt);
    player.grounded = true;
  } else if (player.pos.y > floorY + 1.4) {
    player.grounded = false;
  }

  // Smoothed ground reference used by the camera so cliffs don't snap the view.
  player.groundY += (floorY - player.groundY) * Math.min(1, 8 * dt);
  player.breath += dt;

  return { fwd, normal, walkable };
}

export function respawn(y) {
  player.pos.set(0, y, 0);
  player.vel.set(0, 0, 0);
  player.light = 1;
  player.groundY = y;
}
