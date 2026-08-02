// Player state, input, and underwater/ground locomotion. OWNED BY: orchestrator.
import * as THREE from 'three';
import { renderer } from './core.js';
import { WORLD_R, SURFACE_Y, RIFT_R, riftPos } from './config.js';
import { V3, clamp, fbm } from './lib/math.js';
import { terrainH, terrainNormal, clampR } from './world/terrain.js';
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
  breath: 0,
  // ---- suit air. These are initialised here and not in updatePlayer because the
  // title screen and the ending both pose the rig without ever stepping the physics.
  trim: 0.225,   // surface-equivalent air standing in the dress: his valve setting
  fill: 0.412,   // 0..1 envelope fill AT THE CURRENT DEPTH — drives force, HUD and pose
  buoy: 0,       // u/s^2, signed net buoyancy. Read by game.js and diver.js.
  burstT: 0,     // seconds of bottle blowdown still to deliver
  burstDir: V3(0, 0, 1)
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
  // The vertical channel carries a time term and only half its old weight. Without the
  // time term it is a STATIC field — a permanent per-location updraught — and once
  // buoyancy exists that reads as the trim being broken rather than as water moving.
  const c = (fbm(pos.x * s + 7, pos.z * s + 3 + t * 0.05) - 0.5) * 0.22;
  return current.set(a, c, b).multiplyScalar(2.2 * surge);
}

// Steeper than this and the diver can't get purchase; he slides instead of walking.
const MAX_WALK_SLOPE = 0.62; // cos of max standable angle (~52 degrees)
const EYE_H = 1.35;

// ---------------------------------------------------------------- the suit as physics
// A dressed Mark V is ~170 kg. Its displacement splits in two, and that split is the
// whole model: 0.135 m^3 of flesh, lead and spun-copper helmet whose volume CANNOT
// change, plus up to 0.075 m^3 of flexible canvas dress that Boyle acts on. At
// rho 1025 and g 9.81 that is -310 N flat (-1.83 u/s^2) and +444 N taut (+2.61),
// neutral at 41.2% of the envelope. Those three numbers are the rig, not a taste call.
//
// `trim` is the air he is holding measured at SURFACE volume. The raft pump is
// fixed-displacement, so it adds to trim at a CONSTANT rate and every depth effect
// falls out of the single division by P below. That division is Boyle's law, and it is
// the real reason a Mark V diver could step off a ledge and not come back.
const P_REF = 260;        // depth units per extra atmosphere: 1.00 surface / 1.92 zone-0
const PFILL = 1.90;       // trim = 1 exactly fills the dress at y = -234
const TRIM_MAX = 2.6;     // headroom to fill the dress at the zone-2 floor (needs 2.35)
const TRIM_UP = 0.50;     // /s  inlet
const TRIM_DOWN = 1.15;   // /s  exhaust dumps at the ambient differential — 2.3x faster
const TRIM_RELIEF = 0.90; // /s  spring relief valve; must beat TRIM_UP or he over-pressures
const SURF_TRIM = 2.5;    // /s  a tended diver at the surface is kept blown up, not vented
const A_BUOY_MIN = -1.83, A_BUOY_MAX = 2.61;
export const NEUTRAL_FILL = -A_BUOY_MIN / (A_BUOY_MAX - A_BUOY_MIN);   // 0.4122
const A_KICK = 3.6;       // finning plus hauling on the lifeline — the line runs straight up
const A_LOOK = 1.30;      // the vertical share of a swim stroke when he is pitched over
// Drag is anisotropic because he is: ~0.28 m^2 at Cd 1.05 along his long axis against
// ~0.75 m^2 at Cd 1.2 broadside, so vertical drag is 0.327x horizontal. This is why a
// Mark V walks and is hauled but does not swim.
const LIN_H = 0.5978, DRAG_H = 0.10;      // UNCHANGED from the shipped swim law
const LIN_V = 0.1955, DRAG_V = 0.0327;    // = horizontal * 0.327
// Added mass: a body accelerating in water must accelerate the water around it. Dividing
// BOTH the applied acceleration and the drag by AM cancels in the terminal-velocity
// solution and multiplies the response time — a pure laginess knob that costs no speed.
const AM_V = 1.26;        // C_a ~ 0.25 along the long axis: (170+45)/170
const AM_H = 1.55;        // broadside; 1.00 is today's feel, 1.88 is the full physics
const G_W = 9.81;         // dry weight over mass — only used once he breaks the surface
const Y_SUB = -2.15, EMERGE_H = 2.6, SURF_DAMP = 1.5;
const GROUND_BUOY = 0.9;  // above this he cannot get purchase on the bottom

// Bottle blowdown: thrust from a fixed-volume bottle through a fixed orifice tracks
// bottle pressure, which decays exponentially once the valve is cracked. A 30 ms crack
// and an 85 ms half-life, spent by 0.26 s. A bottle gives you one shove.
export const BURST_DUR = 0.26;
const BURST_ACC = 850;
export function burstEnv(tau) {
  const o = clamp(tau / 0.030, 0, 1);
  return o * o * (3 - 2 * o) * Math.exp(-tau / 0.085);
}

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

  // ---- suit air, integrated UNCONDITIONALLY ---------------------------------
  // Above the grounded/swim split on purpose: the exhaust valve has to work while he is
  // standing on the bottom, the trim gauge has to keep moving while he walks, and his
  // weight on the seabed is whatever the dress is holding up right now.
  const P = 1 + Math.max(0, -player.pos.y) / P_REF;
  const fullTrim = P / PFILL;
  if (keys['Space']) player.trim = Math.min(TRIM_MAX, player.trim + TRIM_UP * dt);
  if (keys['ControlLeft'] || keys['KeyC']) player.trim = Math.max(0, player.trim - TRIM_DOWN * dt);
  if (player.trim > fullTrim) player.trim = Math.max(fullTrim, player.trim - TRIM_RELIEF * dt);
  // Same swell term the raft rides (raft.js), so Sal and the raft heave together.
  const swell = Math.sin(t * 0.6) * 0.32 * (1 + stormK * 2.1) + stormK * Math.sin(t * 2.3) * 0.22;
  const ySub = SURFACE_Y + Y_SUB + swell;
  // Emergence: buoyant force scales with the volume still under water, weight does not.
  // That makes the waterline a real equilibrium he floats at instead of a ceiling he
  // sticks to, and it is what lets him ride the swell against the raft.
  const emerge = clamp((player.pos.y - ySub) / EMERGE_H, 0, 1);
  if (player.pos.y > ySub - 1.0) player.trim += (fullTrim - player.trim) * SURF_TRIM * dt;
  player.fill = clamp(player.trim * PFILL / P, 0, 1);
  player.buoy = A_BUOY_MIN + (A_BUOY_MAX - A_BUOY_MIN) * player.fill;
  // The blowdown runs on its own clock, not the swim branch's, or a burst fired into the
  // floor is banked while he is grounded and replays the next time he leaves the bottom.
  const burstA = player.burstT > 0 ? BURST_ACC * burstEnv(BURST_DUR - player.burstT) : 0;
  if (player.burstT > 0) player.burstT = Math.max(0, player.burstT - dt);

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
    // A step up into the water column, not a leap. The same keypress is filling the
    // dress, so the push-off buys the seconds the air needs to take over.
    if (keys['Space']) { player.vel.y = 2.6; player.grounded = false; }
    // On terrain too steep to stand on, gravity drags him downslope.
    if (!walkable) player.vel.addScaledVector(_slide.set(normal.x, 0, normal.z).normalize(), 30 * dt);
    // lead boots, less whatever the dress is holding up
    player.vel.y -= clamp(22 - player.buoy * 2.2, 15, 28) * dt;
    player.vel.x *= Math.pow(0.135, dt);     // silt drag: he keeps a little way on
    player.vel.z *= Math.pow(0.135, dt);
    player.bobPhase += player.vel.length() * dt * 2.1;
  } else {
    // W/S drive him along the FLAT heading at full thrust; only a small share of the
    // stroke goes vertical when he is pitched. Before this, holding W while looking down
    // was a -18 u/s jet and the valve below was decoration.
    const acc = 42 * boost / AM_H;
    const sy = Math.sin(player.pitch);
    let ay = emerge > 0 ? (player.buoy + G_W) * (1 - emerge) - G_W : player.buoy;
    if (keys['KeyW'] || keys['ArrowUp']) { player.vel.addScaledVector(flat, acc * dt); ay += A_LOOK * sy; }
    if (keys['KeyS'] || keys['ArrowDown']) { player.vel.addScaledVector(flat, -acc * dt); ay -= A_LOOK * sy; }
    if (keys['KeyA'] || keys['ArrowLeft']) player.vel.addScaledVector(right, -acc * dt);
    if (keys['KeyD'] || keys['ArrowRight']) player.vel.addScaledVector(right, acc * dt);
    if (keys['Space']) ay += A_KICK;
    if (keys['ControlLeft'] || keys['KeyC']) ay -= A_KICK;

    // Ambient current nudges him around; the world should never feel perfectly still.
    player.vel.addScaledVector(sampleCurrent(player.pos, t), dt * 0.5);
    // Bottle blowdown, split per axis so the added mass it has to shift is the same
    // added mass everything else shifts.
    if (burstA > 0) {
      const k = burstA * dt;
      player.vel.x += player.burstDir.x * k / AM_H;
      player.vel.y += player.burstDir.y * k / AM_V;
      player.vel.z += player.burstDir.z * k / AM_H;
    }
    // Wave-making drag at the waterline, or he corks for half a minute.
    if (emerge > 0) ay -= player.vel.y * SURF_DAMP * emerge;
    // Drag, split per axis. Added mass divides BOTH the force and the drag, which leaves
    // terminal velocity untouched and stretches the response — heavy without being slow.
    const vy = player.vel.y, avy = vy < 0 ? -vy : vy;
    ay -= LIN_V * vy + DRAG_V * vy * avy;
    // dt is capped at 0.05 (game.js); explicit Euler is stable well past that here, but
    // the guard is the same one the old quadratic step carried. Keep it if DRAG_V moves.
    player.vel.y += Math.min(Math.abs(ay) * dt, avy + 90) * Math.sign(ay) / AM_V;
    const hx = player.vel.x, hz = player.vel.z, hsp = Math.hypot(hx, hz);
    if (hsp > 0.001) {
      const hd = Math.min(1 / dt, LIN_H + DRAG_H * hsp) * dt / AM_H;
      player.vel.x -= hx * hd; player.vel.z -= hz * hd;
    }
  }

  player.pos.addScaledVector(player.vel, dt);

  // Stop him at the FOOT OF THE WALL, not on a circle. The flat WORLD_R clamp put the
  // boundary at r=260 on every bearing, which after the rim warp (and before it) left him
  // hovering in open water partway up a cliff face — measured 128 units above the basin
  // floor with nothing under his boots. terrain.js bisects the real wall foot per bearing
  // into clampR, so the invisible boundary and the visible one are now the same object.
  // 128 bearings, wrapped (index 128 === index 0) so the lerp is continuous across 0/2pi.
  const hr = Math.hypot(player.pos.x, player.pos.z);
  const tbl = clampR[zone < 0 ? 0 : zone];
  let lim = WORLD_R;
  if (tbl) {
    const th = Math.atan2(player.pos.z, player.pos.x);
    const fi = ((th < 0 ? th + Math.PI * 2 : th) / (Math.PI * 2)) * 128, i = fi | 0;
    lim = tbl[i] + (tbl[i + 1] - tbl[i]) * (fi - i);
  }
  if (hr > lim) { const k = lim / hr; player.pos.x *= k; player.pos.z *= k; }
  // Backstop only. The emergence term above is what actually floats him, so in calm
  // water this never fires; in a storm the swell throws him against it, which is right.
  if (player.pos.y > SURFACE_Y - 1.2) {
    player.pos.y = SURFACE_Y - 1.2;
    if (player.vel.y > 0) player.vel.y = 0;
  }

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
    // Lead boots in silt barely rebound, but they do not stop dead either.
    if (player.vel.y < -1.2) player.vel.y *= -0.10;
    else if (player.vel.y < 0) player.vel.y = 0;
    // Set BOTH ways: a diver with air in his dress cannot get purchase on the bottom,
    // and if that is only ever tested on the way down he can never be lifted off it.
    player.grounded = player.buoy < GROUND_BUOY;
  } else if (player.pos.y < floorY + 1.2 && player.vel.y <= 0.5 && !keys['Space'] && player.buoy < GROUND_BUOY) {
    player.pos.y += (floorY - player.pos.y) * Math.min(1, 10 * dt);
    player.grounded = true;
  } else if (player.pos.y > floorY + 1.4 || player.buoy > GROUND_BUOY) {
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
  resetSuit(y);
}

// He is hauled up and re-dressed: the tenders blow the dress up, they do not leave him
// flat. game.js's own respawn path calls this — player.js's respawn() is not on it.
// Re-dressed AND TRIMMED, not over-inflated. This used to set a full dress at maximum
// lift (+2.61), which meant every respawn rocketed Sal off the spawn point and clipped
// him up inside the raft hull, with the camera breaking the surface into a washed-out
// frame the game has no above-water world to fill. Neutral holds him where the tenders
// put him — which is what the "he must not sink straight back off the surface" note
// below was actually asking for.
export function resetSuit(y) {
  const P = 1 + Math.max(0, -y) / P_REF;
  player.trim = NEUTRAL_FILL * P / PFILL;
  player.fill = NEUTRAL_FILL;
  player.buoy = 0;
  player.burstT = 0;
}
