// Player state, input, and underwater/ground locomotion. OWNED BY: orchestrator.
import * as THREE from 'three';
import { renderer } from './core.js';
import { WORLD_R, SURFACE_Y, RIFT_R, riftPos, GLASS } from './config.js';
import { V3, clamp, fbm } from './lib/math.js';
import { terrainH, terrainNormal, clampR } from './world/terrain.js';
import { rockColliders } from './world/flora.js';
import { propColliders } from './world/props.js';
import { wreckColliders } from './world/wrecks.js';
import { ventColliders } from './world/vents.js';
import { raft } from './systems/raft.js';
import { resolveDeck, LADDER_Z, GAP_HZ } from './systems/raft/colliders.js';
import { surfaceHeightAt, stormLevel } from './world/water.js';

export const player = {
  pos: V3(0, -10, 0),
  vel: V3(0, 0, 0),
  light: 1,
  yaw: 0,
  pitch: 0,
  grounded: false,
  onDeck: false,
  // smoothed ground height, so cliffy terrain doesn't make the camera judder
  groundY: -10,
  bobPhase: 0,
  breath: 0,
  // ---- suit air. These are initialised here and not in updatePlayer because the
  // title screen and the ending both pose the rig without ever stepping the physics.
  trim: 0.225,   // surface-equivalent air standing in the dress: his valve setting
  fill: 0.412,   // 0..1 envelope fill AT THE CURRENT DEPTH — drives force, HUD and pose
  buoy: 0,       // u/s^2, signed net buoyancy. Read by game.js and diver.js.
  burstT: 0,     // seconds of the air pack's TAP blowdown still to deliver
  burstDir: V3(0, 0, 1),
  burstPow: 1,   // the tap's share of a full bottle blowdown (game.js airPackTap)
  // THE AIR PACK's HELD BURST (game.js updateAirPack writes both, player.js flies them):
  // jet 0..1 is the thrust level (ramped in over ~0.2 s), jetDir the unit thrust direction.
  jet: 0,
  jetDir: V3(0, 1, 0),
  thrustOn: false,   // diver.js breath effort
  // A tap ON THE SEABED is a hop: the pop speed asked for, consumed by the grounded branch.
  hop: 0,
  hopT: 0,       // seconds left on the hop's braking (see HOP_* below)
  // ---- animation phases, WRITTEN BY diver.js, READ HERE ----------------------------
  // The direction is deliberate: diver.js already owns both clocks (walkP advances on
  // distance travelled, swimP on the kick), it already receives `player` every frame,
  // and it is the one that decides when a stride or a kick actually happens. Publishing
  // them costs two scalar stores and makes the push and the visible limb the SAME event.
  // Both are seeded so the first frame of physics is never fed an undefined.
  walkP: 0,
  swimP: 0,
  // -1..1 sideways / -1..0 backwards scull input, published the other way (physics knows
  // the keys, the rig does not) so diver.js can bias the arms without reading input.
  scullX: 0,
  scullZ: 0,
  // (swimfix) the haul he is MAKING, not the way he is making: +1 hauling forward (W), -1
  // pulling himself back (S), 0 neither or both; times ctrl, so a man jerked off balance by
  // the line strokes at what he has left. Zero on the ground. diver.js keys the stroke's
  // size and cadence on this, because at the air pack's ~7 u/s haul the way made through
  // the water no longer tells a hard-working man from one hanging still.
  haulZ: 0,
  // THE YANK (tether.js leash): seconds of recovery left after the hose snapped him back,
  // over a recovery of staggerDur, at staggerK (0..1) of his hands off the controls.
  // game.js sets all three on a yank; updatePlayer eases the drive back in.
  stagger: 0,
  staggerDur: 0,
  staggerK: 0,
  // ---- SEA LEGS (docs/superpowers/specs/sal-sea-legs.md). On the planks he stands in the
  // RAFT'S frame: deckL is where he stands in raft-local x/z (written at the end of every
  // deck frame, read by carryDeck after the raft moves), and `sea` is what the moving deck
  // is doing to him this frame, published for diver.js (posture) and game.js (lens, stagger):
  //   k        0..1 how hard the sea has him working (stance, knees, arms, steps)
  //   sx, sz   his balance excursion off his chosen spot, WORLD x/z units (the body sways
  //            over planted boots; past his support a boot steps)
  //   nx, nz   the deck's up axis, world x/z (its tilt: the deck descends toward +n)
  //   ay       the deck's vertical acceleration under him, u/s^2, smoothed (+ loads him)
  //   lurch    > 0 on the frame the deck throws him (a stagger), with its direction lx/lz
  deckL: { x: 0, z: 0, ok: false },
  stepUp: 0, stepUpV: 0,   // (sweep) the last of the ladder still to rise, u (0 = standing)
  sea: { k: 0, sx: 0, sz: 0, nx: 0, nz: 0, ay: 0, lurch: 0, lx: 0, lz: 0 }
};

export const keys = {};
export let locked = false;

addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
// Every key up. A keyup that lands on another window, the chart, or a fade never reaches
// the listener above; game.js calls this at each of those seams so nothing stays held.
export function clearKeys() { for (const k in keys) keys[k] = false; }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  document.getElementById('cross').classList.toggle('hidden', !locked);
});
// Clamped: a lock transition or a stalled frame can deliver one enormous delta and
// spin him round. 150 px is more than any real hand moves in a frame.
const MOVE_MAX = 150;
addEventListener('mousemove', e => {
  if (!locked) return;
  player.yaw -= clamp(e.movementX, -MOVE_MAX, MOVE_MAX) * 0.0022;
  player.pitch = clamp(player.pitch - clamp(e.movementY, -MOVE_MAX, MOVE_MAX) * 0.0022, -1.45, 1.45);
});

// Raw mouse where the browser offers it (no OS acceleration under the lock); the
// promise form rejects on a denied or unsupported request — fall back to the plain
// call once, and never let either rejection surface as an unhandled error.
export function requestLock() {
  const el = renderer.domElement;
  let p = null;
  try { p = el.requestPointerLock({ unadjustedMovement: true }); } catch (e) { p = null; }
  if (p && p.catch) {
    p.catch(() => { try { const q = el.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (e) { /* */ } });
  }
}

// Shared temps: these run every frame, so each returns a module-owned vector that is
// valid until the same helper is called again. Copy it if you need to hold it.
const TAU2 = Math.PI * 2;
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

// THE UNDERCURRENT. The wind on the surface drags the water under it: a wind-aligned
// drift that is real at -30, a whisper at -200 and arithmetically nothing in the abyss.
// setStormCurrent's signature is left ALONE — it carries a scalar and callers depend on
// that — so this is its own setter, called next to it in game.js with the EASED wind
// water.js publishes (windState()), so the drift and the chop re-aim on one curve.
// Zero-safe: with the wiring absent, windS stays 0 and every term below vanishes.
let windS = 0, windX = 0, windZ = 0;
export function setWindCurrent(speed, dirRad) {
  windS = clamp(speed || 0, 0, 1);
  // (cos, sin) in (x, z) — water.js's convention for the same angle. See the note there.
  windX = Math.cos(dirRad || 0); windZ = Math.sin(dirRad || 0);
}
// Vector form, for callers that already hold the eased unit bearing and would only be
// converting it to an angle for this function to convert it straight back.
export function setWindCurrentVec(speed, dx, dz) {
  windS = clamp(speed || 0, 0, 1);
  windX = dx; windZ = dz;
}

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
  current.set(a, c, b).multiplyScalar(2.2 * surge);
  // The wind drift rides ON TOP of the ambient field, horizontally only — wind does not
  // push water down. It is ADDED after the surge multiply on purpose: it must not be
  // amplified by the storm term (they are two separate things arriving together), and
  // at wind 0 this whole block is +0.
  if (windS > 0.0005) {
    const WW = GLASS.windwater;
    // depth is measured from the mean waterline, not the live crest: one exp per frame,
    // and a diver 30 units down does not care which way the swell happens to be leaning.
    const depth = SURFACE_Y - pos.y;
    const k = windS * WW.currentK * (depth <= 0 ? 1 : Math.exp(-depth / WW.decayH));
    current.x += windX * k; current.z += windZ * k;
  }
  return current;
}

// Steeper than this and the diver can't get purchase; he slides instead of walking.
const MAX_WALK_SLOPE = 0.62; // cos of max standable angle (~52 degrees)
const EYE_H = 1.35;
// Raft deck footprint and top. These are the CONTRACT the deck is built to, not a
// readback of it: systems/raft/hull.js lays its planking to exactly this footprint and
// this top face, and every builder on the raft is given these numbers as the frame it
// composes in. Change one of them and the planks and the floor Sal stands on part ways.
const DECK_HX = 4.7, DECK_HZ = 4.7, DECK_TOP = 0.11;
// Up the boarding ladder. A man in 90 lb of dress does not vault a bulwark: 1.1 u/s is
// a deliberate hand-over-hand, about three seconds from the waterline to the catch.
const CLIMB_RATE = 1.1;
// (sweep) the step up off the top rung: knob w (rad/s of a critically damped ease), on
export const LADDER_STEP = { on: 1, w: 9 };
if (typeof window !== 'undefined') window.__ladStep = LADDER_STEP;
let ladYPrev = -1e5;
let ladTopPrev = -1e5;          // the deck-top at the rungs last frame (the ladder's carry)
// ---- THE BULWARK AND EVERYTHING ON DECK ARE REAL ---------------------------------
// hull.js walls the deck on all four sides and leaves ONE gap: the boarding bay on the
// +X rail at |z - LADDER_Z| < 1.2, where the ladder hangs (moved off the +Z rail
// 2026-10-02 — the gallows stood over it). The bulwark runs and every solid thing
// standing on the planks are 2D shapes in systems/raft/colliders.js; the body circle is
// pushed out of them in RAFT-LOCAL space and only the inward part of his velocity goes,
// so he slides along a face and rounds a corner instead of stopping dead or jittering.
const _deckInv = new THREE.Matrix4(), _deckP = new THREE.Vector3();
const _deckL = { x: 0, z: 0 }, _deckV = { x: 0, z: 0 };
// Rungs: the ladder hangs 0.08 outboard of the +X edge; the last metre of the climb
// steps him inboard over the sill, onto the planks.
const LADDER_X = 4.78, LADDER_SILL_X = 4.42;

// ---- THE DECK IS A TILTED, MOVING FLOOR (sealegs, 2026-10-04) ------------------------
// Michael: "when sal is standing on the raft, he doesnt move with it. He is completely stable
// and his feet go through the raft." The floor here used to be a FLAT plane at
// raft.position.y + DECK_TOP: the raft pitches and rolls (updateRaft), so at the spawn spot,
// 2.6 off the centre, the real planks rose and fell up to 26 cm through his boots in a gale,
// and the raft surged 0.5 u back and forth under a man standing still in world space.
// Now the floor is the deck's own plane (raft.matrixWorld, deck top at raft-local y 0.11),
// and a man standing on it is carried in the RAFT'S frame (carryDeck, after updateRaft).
// The raft carries no scale: its matrix is a rotation + translation.
export function deckHeightAt(x, z) {
  const e = raft.matrixWorld.elements;
  const ny = e[5] > 0.2 ? e[5] : 0.2;
  const px = e[12] + DECK_TOP * e[4], py = e[13] + DECK_TOP * e[5], pz = e[14] + DECK_TOP * e[6];
  return py - (e[4] * (x - px) + e[6] * (z - pz)) / ny;
}
// world -> raft-local (rotation transpose), into a {x, y, z}
function toDeck(x, y, z, out) {
  const e = raft.matrixWorld.elements;
  const dx = x - e[12], dy = y - e[13], dz = z - e[14];
  out.x = e[0] * dx + e[1] * dy + e[2] * dz;
  out.y = e[4] * dx + e[5] * dy + e[6] * dz;
  out.z = e[8] * dx + e[9] * dy + e[10] * dz;
  return out;
}
// raft-local deck point (lx, DECK_TOP, lz) -> world, into a vector
function fromDeck(lx, lz, out) {
  const e = raft.matrixWorld.elements;
  return out.set(e[12] + e[0] * lx + e[4] * DECK_TOP + e[8] * lz,
    e[13] + e[1] * lx + e[5] * DECK_TOP + e[9] * lz,
    e[14] + e[2] * lx + e[6] * DECK_TOP + e[10] * lz);
}
const _dkW = new THREE.Vector3(), _dkL = { x: 0, y: 0, z: 0 };
// Stand him on the deck at raft-local (lx, lz): the spawns (start, rescue, voyage, title)
// put him here, and the carry picks it up from the first frame.
export function placeOnDeck(lx, lz) {
  fromDeck(lx, lz, _dkW);
  player.pos.set(_dkW.x, _dkW.y + EYE_H, _dkW.z);
  player.deckL.x = lx; player.deckL.z = lz; player.deckL.ok = true;
  seaReset();
  return player.pos;
}

// ---- SEA LEGS: the balance excursion (spec: sal-sea-legs.md, Targets) --------------------
// He rides a 0.1 Hz roll (Buchanan & Horak: slow support motion is ridden, not resisted), so
// most of it is just the carry above. What is left is the part his stance has to work at,
// the MII model's tipping load: gravity along the tilted deck plus the deck's own horizontal
// acceleration, felt at his centre of mass. It drives a slow, heavily damped excursion of his
// body off the spot he chose (the man swaying over his planted boots), with the righting
// spring of a top-heavy rig: ~3 s and dead-beat, no wobble. The sea state scales how much of
// the tilt he gives to (a calm-day roll he simply stands through). Past his support, a boot
// steps (diver.js's shuffle, at a margin that shrinks with the sea) and a hard throw is a
// stagger (`sea.lurch`, game.js -> diverYank). SEA.on = 0 is the A/B: rigid on the deck plane.
// (raftroll, 2026-10-05: the raft rolls 15-18 deg in a gale now) tSat saturates the tilt load;
// lurch 0.13 -> 0.143 and lurchCd 7 -> 10 keep a gale's staggers to about one a minute.
export const SEA = { on: 1, w: 2.1, z: 0.92, kg: 0.62, kgCalm: 0.22, ki: 1.0, max: 0.24, lurch: 0.143, lurchCd: 10,
  walkK: 1.25, walkMax: 0.42, slow: 0.22, ayT: 0.12, kT: 4.0, tSat: 0.10 };
if (typeof window !== 'undefined') window.__sea = SEA;
const seaS = { x: 0, z: 0, vx: 0, vz: 0 };     // excursion, raft-local x/z, and its rate
let seaPrevOk = false, seaVx = 0, seaVy = 0, seaVz = 0, seaPx = 0, seaPy = 0, seaPz = 0;
let seaAx = 0, seaAy = 0, seaAz = 0, seaK = 0, seaCd = 0;
function seaReset() { seaS.x = seaS.z = seaS.vx = seaS.vz = 0; seaPrevOk = false; }

// CARRIED BY THE BOAT. Called by game.js right after updateRaft, every play frame (paused
// too: the boat does not stop for a menu, and a man left behind in world space would have
// his planted boots dragged away from under him). Re-stands him on the plank he was on, in
// the raft's NEW pose: heave, surge, pitch and roll about the raft centre all carry him.
export function carryDeck(dt) {
  const sea = player.sea;
  sea.lurch = 0;
  const st = stormLevel();
  seaK += (st - seaK) * Math.min(1, dt / SEA.kT);
  sea.k = seaK;
  const e = raft.matrixWorld.elements;
  sea.nx = e[4]; sea.nz = e[6];
  if (!player.onDeck || !player.grounded || !player.deckL.ok || player.onLadder) {
    seaReset(); player.deckL.ok = false; sea.sx = sea.sz = 0; sea.ay += (0 - sea.ay) * Math.min(1, dt * 4);
    return;
  }
  const L = player.deckL;
  // the deck under him, this frame: its velocity and acceleration (finite differences on
  // the point he stands on, smoothed: the hull's ease is smooth, but a weather jump is not)
  fromDeck(L.x, L.z, _dkW);
  if (dt > 1e-4) {
    if (seaPrevOk) {
      const vx = (_dkW.x - seaPx) / dt, vy = (_dkW.y - seaPy) / dt, vz = (_dkW.z - seaPz) / dt;
      const a = Math.min(1, dt / SEA.ayT);
      seaAx += (clamp((vx - seaVx) / dt, -4, 4) - seaAx) * a;
      seaAy += (clamp((vy - seaVy) / dt, -4, 4) - seaAy) * a;
      seaAz += (clamp((vz - seaVz) / dt, -4, 4) - seaAz) * a;
      seaVx = vx; seaVy = vy; seaVz = vz;
    } else { seaVx = seaVy = seaVz = 0; seaAx = seaAy = seaAz = 0; }
    seaPx = _dkW.x; seaPy = _dkW.y; seaPz = _dkW.z; seaPrevOk = true;
  }
  sea.ay = seaAy;
  // ---- the excursion, in raft-local x/z ----
  if (SEA.on && dt > 1e-4) {
    // gravity along the deck (raft-local): the local axes' world Y components
    // (raftroll) The raft now rolls 15-18 deg in a gale, not 5. He stands upright to gravity
    // through the knees, so what his stance has to work at is not the whole tilt: the load
    // saturates (tSat * tanh(tilt / tSat), on the sine), which keeps a calm day's 3 deg nearly
    // as it was and lets a gale's big rolls throw him further and more often without pinning
    // him at the limit for the whole wallow.
    const g = 9.81 * (SEA.kgCalm + (SEA.kg - SEA.kgCalm) * seaK);
    const ts = Math.sqrt(e[1] * e[1] + e[9] * e[9]), tq = ts > 1e-6 ? SEA.tSat * Math.tanh(ts / SEA.tSat) / ts : 1;
    const gx = -g * e[1] * tq, gz = -g * e[9] * tq;
    // the deck's horizontal acceleration, into the raft's axes; the body lags it
    const ix = -(e[0] * seaAx + e[1] * seaAy + e[2] * seaAz) * SEA.ki;
    const iz = -(e[8] * seaAx + e[9] * seaAy + e[10] * seaAz) * SEA.ki;
    // walking, the gait owns the balance: the excursion bleeds out into the steps
    const walking = Math.hypot(player.vel.x, player.vel.z) > 0.3;
    const w = SEA.w * (walking ? 1.8 : 1), zt = SEA.z;
    const fx = walking ? 0 : gx + ix, fz = walking ? 0 : gz + iz;
    const n = dt > 0.022 ? Math.ceil(dt / 0.022) : 1, h = dt / n;
    for (let i = 0; i < n; i++) {
      seaS.vx += (fx - w * w * seaS.x - 2 * zt * w * seaS.vx) * h;
      seaS.vz += (fz - w * w * seaS.z - 2 * zt * w * seaS.vz) * h;
      seaS.x += seaS.vx * h; seaS.z += seaS.vz * h;
    }
    const r = Math.hypot(seaS.x, seaS.z);
    if (r > SEA.max) { const k = SEA.max / r; seaS.x *= k; seaS.z *= k; }
    // THE THROW. A heavy man pushed fast past his support does not ease back: he staggers.
    // Rare by construction (a gale's worst roll), once per SEA.lurchCd at most.
    seaCd = Math.max(0, seaCd - dt);
    const sp = Math.hypot(seaS.vx, seaS.vz);
    if (!walking && seaCd <= 0 && r > SEA.lurch * (1.6 - 0.6 * seaK) && sp > 0.05) {
      seaCd = SEA.lurchCd;
      sea.lurch = clamp((r - SEA.lurch) / 0.08, 0.25, 1) * (0.4 + 0.6 * seaK);
      // direction he is thrown, world x/z
      sea.lx = e[0] * seaS.vx + e[8] * seaS.vz; sea.lz = e[2] * seaS.vx + e[10] * seaS.vz;
    }
  } else if (!SEA.on) { seaS.x = seaS.z = seaS.vx = seaS.vz = 0; }
  // re-stand him: chosen spot plus excursion, on the deck's plane, in its new pose
  fromDeck(L.x + seaS.x, L.z + seaS.z, _dkW);
  player.pos.set(_dkW.x, _dkW.y + EYE_H, _dkW.z);
  sea.sx = e[0] * seaS.x + e[8] * seaS.z; sea.sz = e[2] * seaS.x + e[10] * seaS.z;
}

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
const TRIM_DOWN = 1.15;   // /s  exhaust dumps at the ambient differential — 2.3x faster
const TRIM_RELIEF = 0.90; // /s  spring relief valve; must beat the pack's JET_TRIM (0.50) or he over-pressures
const SURF_TRIM = 2.5;    // /s  a tended diver at the surface is kept blown up, not vented
const A_BUOY_MIN = -1.83, A_BUOY_MAX = 2.61;
export const NEUTRAL_FILL = -A_BUOY_MIN / (A_BUOY_MAX - A_BUOY_MIN);   // 0.4122
const A_KICK = 3.6;       // finning plus hauling on the lifeline — the line runs straight up
const A_LOOK = 1.30;      // the vertical share of a swim stroke when he is pitched over
// Drag is anisotropic because he is: ~0.28 m^2 at Cd 1.05 along his long axis against
// ~0.75 m^2 at Cd 1.2 broadside, so vertical drag is 0.327x horizontal. This is why a
// Mark V walks and is hauled but does not swim.
const LIN_H = 0.5978, DRAG_H = 0.10;      // UNCHANGED from the shipped swim law
// THE AIR PACK pass (Michael 2026-10-04: "Rising takes to long"): x0.60 on the vertical
// drag. A blown-up dress used to top out at 6.4 u/s and seabed-to-surface took 25 s of
// held Space; at 0.60 a full dress floats up at ~9 u/s and a vented one sinks at ~7 (C
// held: ~13). Still 0.196x the horizontal drag — end-on he is the streamlined axis.
const V_STREAM = 0.60;
const LIN_V = 0.1955 * V_STREAM, DRAG_V = 0.0327 * V_STREAM;    // = horizontal * 0.327 * V_STREAM
// Added mass: a body accelerating in water must accelerate the water around it. Dividing
// BOTH the applied acceleration and the drag by AM cancels in the terminal-velocity
// solution and multiplies the response time — a pure laginess knob that costs no speed.
// HEAVIER (Michael, 2026-10-01: "make the swimming feel heavier"). Both raised past the
// textbook added mass to stand in for what the textbook leaves out — 170 kg of man,
// brass and lead that the stroke has to get moving and that then keeps going. Terminal
// speed is untouched (added mass divides force and drag alike); what changes is the
// ramp both ways: ~1.4 s to 90% of cruise (was ~0.9), ~25 u of carry after the stroke
// stops (was ~19), a 90-degree change of heading taking ~2.2 s to come round (was ~1.1).
const AM_V = 1.90;        // was 1.26 (C_a ~ 0.25 along the long axis): rising and sinking are sluggish
const AM_H = 2.90;        // was 1.55, then 2.40 (1.88 is the full broadside physics). 2.90: the
                          // weighted-suit pass — the haul has to get 90 kg of dress going.
// The bottle shove is computed against the SHIPPED added mass, so the burst keeps its
// full punch — and on a heavier body it now carries ~45 u instead of ~29, which is what
// makes it read as the one thing that can throw this much brass through the water.
const AM_BURST_V = 1.26, AM_BURST_H = 1.55;
// The haul's thrust (u/s^2 before added mass). See the swim branch.
const HAUL = 8.0;
// Unworked, he settles. A small downward bias while no stroke, scull or valve key is
// held: ~0.3 u/s of slow sinking at neutral trim after several seconds. Small beside the
// dress (the valve spans -1.83..+2.61), so fill and vent still decide where he goes.
const A_SETTLE = -0.11;
// 1/s of extra drag while a hose yank has him tumbling (see TUMBLING in updatePlayer)
const YANK_TUMBLE_DRAG = 2.6;
const G_W = 9.81;         // dry weight over mass — only used once he breaks the surface
const Y_SUB = -2.15, EMERGE_H = 2.6, SURF_DAMP = 1.5;
const GROUND_BUOY = 0.9;  // above this he cannot get purchase on the bottom

// ---- WOOD GRIPS, SILT PRESSES ---------------------------------------------------
// One walk law, two grounds, expressed as a single time constant TAU: an exponential
// drag e^(-dt/TAU) plus an acceleration of TOP/TAU. Terminal speed is that ground's TOP by
// construction, so the ponderous ruling is arithmetic here, not a value that can drift.
//   planks: 0.30 s (was 0.14). Dry timber and lead soles: he plants, and 90 kg takes time.
//   silt:   0.50 s vented, 1.00 s with a full dress (was 0.38 / 0.85). A blown-up dress
//           barely touches the bottom, so it moon-walks: slow to gather, long to give it back.
// DEPTH IS DELIBERATELY ABSENT. The suit equalises; `buoy` is the only knob, which is
// also the one the diver himself is holding (the valve).
// HEAVIER (Michael, 2026-10-01: "his swimming and walking still dont seem like a person in a
// weighted suit would move"; docs/superpowers/specs/sal-weighted-suit-motion.md). The top speed
// is now set by the GROUND, because the man is carrying a different weight on each:
//   planks: 1.5 u/s (was 2.6). In air the full 90 kg of brass and lead hangs off his shoulders
//           and hips. A dressed Mark V diver does not stroll a deck, he plods a few steps to the
//           ladder (Men of Honor's qualifying test is twelve steps). The walk lane is 3 u long.
//   silt:   2.15 u/s (was 2.6). In water the dress takes the weight off his shoulders, but he is
//           still kept heavy, leaning into the drag. Fully submerged people walk at about 68
//           steps/min (aquatic treadmill, neck depth), so the seabed walk buys its weight with a
//           slow cadence and long double support rather than a much slower speed.
// The time constants are longer on both grounds: 90 kg does not get going in a seventh of a second.
const WALK_TOP_DECK = 1.5, WALK_TOP_BED = 2.15;
const TAU_DECK = 0.30;
const TAU_SILT_HEAVY = 0.50, TAU_SILT_LIGHT = 1.00;
// Shift on the ground is a hurried plod, not a run (was 1.55x).
const WALK_HURRY = 1.3;
// Each stride shoves a 0.75 m^2 chest through water and the water shoves back. A small
// impulse on the heel-strike the ANIMATION reports (diver.js publishes player.walkP off
// distance travelled), so the resistance lands on the visible step, never on a timer.
// On the planks the same event is the dead stop of a lead boot taking 90 kg: a braking jolt.
const STRIDE_DRAG = 0.085, STRIDE_DRAG_LIGHT = 0.060, STRIDE_DRAG_DECK = 0.070;
// THE LURCH. A heavy walker does not glide: the body stalls while both boots are down and
// the weight changes feet, then surges over the stance boot. The drive is shaped on the
// step phase (q = 0 at each heel strike, peak at mid single support) with a unit mean, so the
// average speed stays the top speed. The lurch is a property of the walk, not a timer: the
// phase is distance-keyed in diver.js, so a slower step simply takes longer.
const LURCH_DECK = 0.32, LURCH_BED = 0.65;

// ---- THE STROKE IS THE PUSH ------------------------------------------------------
// He does not swim, he HAULS (the weighted-suit pass): diver.js publishes player.swimP — the
// same phase that draws the two-handed sweep — and the forward thrust is shaped on it:
// near-nothing through the reach and the recovery, everything through the pull at p ~ 0.36,
// then a drift. The pulse is normalised to unit mean over the cycle, so the AVERAGE thrust,
// and with it the distance covered in a minute, is set by the thrust alone.
const KICK_P = 0.36, KICK_W = 0.20;
const KICK_NORM = KICK_W * Math.sqrt(Math.PI);
// 0.60 shipped first and Michael couldn't feel it — a ±27% swell over a whole kick
// cycle is a tide, not a stroke. 0.88 drops the coast toward half the mean and makes
// the snap a real SURGE. The camera now shows this (game.js swim-surge coupling).
// The haul (weighted-suit pass) runs at ~0.38 Hz, half again as slow as the kick, so the
// same depth swung him 11 -> 28 u/s every stroke: a rubber band, not a heavy man. 0.62 at
// this period is still a surge you can see and feel, and the drift between hauls is long.
const KICK_DEPTH = 0.62;   // 0 = the old constant glide, 1 = pure impulse
// Drag is QUADRATIC, so a thrust that is unit-mean in force is NOT unit-mean in speed:
// the peaks are taxed harder than the coasts are rebated and the average drops. This is
// the measured make-good (mean 16.39 -> 17.6 against the old constant 17.72), applied to
// the whole pulse so the shape is untouched and only the average moves.
// Retuned for depth 0.88 (the deeper the pulse, the harder quadratic drag taxes it).
// (swimfix) The haul's stroke runs at its own 0.38 Hz now (was ~0.25 Hz, speed-keyed); its
// cruise is unchanged at this gain — measured with real keys, 22 s of W, whole strokes only.
const KICK_GAIN = 1.16;
// Backwards and sideways are sculls, not strokes: a man in a Mark V can paddle himself
// crabwise, slowly. Was 1.0 and 1.0 — indistinguishable from swimming forwards.
// This is a FORCE fraction and the target is a SPEED fraction, and drag is quadratic, so
// the two are not the same number: 0.347 of the thrust buys 0.55 of the speed (measured
// 9.4 u/s against a forward mean of 17.2). Writing 0.55 here would have bought 0.72.
const SCULL = 0.347;
// (swimfix) BACKING IS A STROKE TOO. The back-pull (diver.js SB) pushes on the same phase as
// the haul (push centred on KICK_P), so the backward thrust is shaped on it like the forward:
// the visible push IS the push. kickThrust carries KICK_GAIN (the forward make-good); the
// back-pull takes its own, measured to keep the old constant scull's speed (~2.4 u/s).
const BACK_GAIN = 1.0;

// Bottle blowdown: thrust from a fixed-volume bottle through a fixed orifice tracks
// bottle pressure, which decays exponentially once the valve is cracked. A 30 ms crack
// and an 85 ms half-life, spent by 0.26 s. THE AIR PACK's TAP is this envelope at
// player.burstPow of the old full bottle (a full one was a 37 u/s shove).
export const BURST_DUR = 0.26;
const BURST_ACC = 850;
export function burstEnv(tau) {
  const o = clamp(tau / 0.030, 0, 1);
  return o * o * (3 - 2 * o) * Math.exp(-tau / 0.085);
}

// ---- THE AIR PACK (roadmap/air-jet-pack.md) -------------------------------------
// Michael, 2026-10-04: "use the air like a jet pack. Where a tap of the space bar does a
// short burst and allows him to jump off the surface a bit. If the space bar is held it
// uses a big burst of air to travel quicker but that air burst is short lived ... Since
// his suit is filled he can continue to float to the surface."
// game.js owns the key (tap vs hold, the reserve); this is the physics.
//   TAP   — airPackTap(): a TAP_POW share of the bottle blowdown along the asked
//           direction; on the seabed a HOP instead (a sharp pop, braked to a 2-4 u rise,
//           then he drifts down or hangs on whatever his trim is).
//   HOLD  — player.jet x JET_ACC along player.jetDir, pushed through the SHIPPED added
//           mass like the old bottle so it has punch (the haul keeps the heavy one), and
//           it BLOWS UP THE DRESS as it runs (JET_TRIM, scaled by how much of the burst
//           points up): let go and the full dress carries him on toward the surface
//           until he vents with C.
export const TAP_POW = 0.14;     // ~5 u/s shove level, ~6 u/s straight up
const TAP_TRIM = 0.03;           // a tap UP spills a little into the dress (his fine trim now)
const JET_ACC = 23;              // u/s^2 at full burst
const JET_TRIM = 0.50;           // /s of trim at full burst straight up
const JET_TRIM_FLAT = 0;         // ...and a level burst spills none: a dash along the bottom
                                 // must not leave him on a Boyle runaway to the surface
// (ritefair, 2026-10-09) ...and a SHORT burst spills little: the spill comes in over the burst's
// first JET_TRIM_T0..T1 s, so a 0.3 s kick up to a ward is a kick, not a blown-up dress (it left
// him floating up past her back, C taking > 3 s to turn it); a held burst (the open-water climb,
// 1-1.4 s) still blows the dress up nearly as before.
const JET_TRIM_T0 = 0.15, JET_TRIM_T1 = 0.45;
// C turns an ascent: while he vents and is still rising, the collapsing dress and the haul down
// on the line bleed the climb (1/s) on top of the vent; it never touches a descent
const VENT_BRAKE = 2.2;
const AM_JET_V = 1.26, AM_JET_H = 1.55;
// The hop. HOP_V is the pop; while HOP_BRAKE runs the lead and the broadside dress fight
// the climb (linear drag HOP_K on the way up only), so the pop is sharp but the rise is a
// hop — not a launch. Forward input adds HOP_FWD.
const HOP_V = 5.6, HOP_K = 2.1, HOP_BRAKE = 1.2, HOP_FWD = 2.2;
export function airPackTap(dx, dy, dz, grounded) {
  player.trim = Math.min(TRIM_MAX, player.trim + TAP_TRIM * (grounded ? 1 : Math.max(0, dy)));
  if (grounded) {
    player.hop = HOP_V;
    player.hopT = HOP_BRAKE;
    // the hop carries a little of whatever level push was asked for
    player.vel.x += dx * HOP_FWD; player.vel.z += dz * HOP_FWD;
    return;
  }
  player.burstDir.set(dx, dy, dz);
  player.burstPow = TAP_POW;
  player.burstT = BURST_DUR;
}

// Unit-mean impulse envelope on the kick phase. A wrapped gaussian, so it is smooth
// across the cycle seam and its integral is closed-form — the normalisation is exact
// rather than tuned, which is what keeps the average speed where it was.
function kickThrust(p) {
  let d = p - KICK_P;
  if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
  const g = Math.exp(-(d * d) / (KICK_W * KICK_W)) / KICK_NORM;
  return KICK_GAIN * (1 + KICK_DEPTH * (g - 1));
}

// Which half of the stride he was in last frame, for the per-step water resistance.
let strideSide = 0;

export function updatePlayer(dt, t, zone, riftOpen) {
  const zi = zone < 0 ? 0 : zone;
  const th = terrainH(player.pos.x, player.pos.z, zi);
  const rp = riftPos(zi);
  const overRift = riftOpen && Math.hypot(player.pos.x - rp.x, player.pos.z - rp.z) < RIFT_R;

  // THE RAFT DECK IS A ONE-WAY PLATFORM. He lands on it from above and passes straight
  // up through it from below — surfacing under the raft should put him alongside it, not
  // punt him onto the deck from 200 m down. The 0.7 tolerance is what lets him land
  // rather than clip when he steps off and the swell lifts the deck to meet him.
  // (sealegs) The footprint is tested in the RAFT'S frame and the top is the tilted plane
  // under him, not a flat one at the raft's centre height.
  let deckY = -1e5;
  toDeck(player.pos.x, player.pos.y, player.pos.z, _dkL);
  const dxr = _dkL.x, dzr = _dkL.z;
  const deckTop = deckHeightAt(player.pos.x, player.pos.z) + EYE_H;
  if (dxr > -DECK_HX && dxr < DECK_HX && dzr > -DECK_HZ && dzr < DECK_HZ) {
    // (sweep) ...and a man still stepping up off the ladder (stepUp) is on it already
    if (player.pos.y > deckTop - 0.7 - player.stepUp) deckY = deckTop;
  }
  const onDeck = deckY > -1e4;
  // Published because the footfall FX are seabed effects: a silt cloud and a boot print
  // pressed into the sand. On planks, in the air, both are nonsense.
  player.onDeck = onDeck;

  // THE LADDER IS HOW HE BOARDS. A man floating at the surface sits ~1.6 below the
  // one-way platform's 0.7 catch, so without this the raft cannot be re-boarded at all —
  // measured: swimming at it passes clean under the deck, and the boarding ladder the
  // davit hangs into the water was scenery. The zone is the bulwark gap the ladder hangs
  // in (raft-local x 4.2..5.9, |z - LADDER_Z| < 1.2, from ladder-foot depth up to the
  // catch), and holding W toward the raft (facing -X) is the grab: he rises up the rungs
  // at a climb, not a launch, until the deck check takes him. No new input to learn —
  // swim at the ladder and keep swimming.
  const wasLadder = player.onLadder;
  player.onLadder = false;
  if (!onDeck && dxr > 4.2 && dxr < 5.9 && dzr > LADDER_Z - GAP_HZ && dzr < LADDER_Z + GAP_HZ) {
    const top = deckTop;
    if (player.pos.y > top - 4.2 && player.pos.y <= top - 0.68 &&
        (keys['KeyW'] || keys['ArrowUp']) && -Math.sin(player.yaw) > 0.1) {
      player.onLadder = true;
      // (raftroll) THE LADDER CARRIES HIM. It hangs off the dive rail, 4.8 from the raft's
      // centre, so a gale's 15-18 deg roll swings it up and down ~1.5 u at up to ~1.6 u/s,
      // faster than he climbs (1.1): a man in world space slid off the bottom rung on every
      // rise and was punted up past it on every fall. On the rungs he moves with them.
      if (wasLadder && ladTopPrev > -1e4) player.pos.y += clamp(top - ladTopPrev, -0.12, 0.12);
      ladTopPrev = top;
      player.pos.y += CLIMB_RATE * dt;
      // hold him against the rungs: kill the swim that was carrying him under the hull,
      // and pin him to the ladder line from BOTH sides — the swim thrust re-accumulates
      // after this block and was walking him off the foot of the ladder at ~0.4 u/s.
      player.vel.set(0, 0, 0);
      // The rungs hang at 4.78 — OUTBOARD of the 4.7 deck footprint, as a real ladder
      // is. Held there to the top he falls off the last rung forever (measured: climb
      // to 1.46, drop, climb again), so the last metre of climb steps him inboard over
      // the rail, which is also just what boarding looks like.
      const xAim = player.pos.y > top - 1.15 ? LADDER_SILL_X : LADDER_X;
      player.pos.x -= clamp(dxr - xAim, -1.6 * dt, 1.6 * dt);
      player.pos.z -= clamp(dzr - LADDER_Z, -0.5 * dt, 0.5 * dt);
    }
  }
  const floorY = overRift ? -1e5 : Math.max(th + EYE_H, deckY);
  // Published for diver.js: where the boots actually stand (the grounded snap below holds
  // his centre up to 1.2 above it for a few frames while he settles).
  player.floorY = overRift ? null : floorY;

  // Shift is the hurried plod on the bottom and nothing off it (THE AIR PACK pass: off the
  // bottom it was a 2.2x haul; real speed in open water is the pack's now, not the arms').
  const sprinting = keys['ShiftLeft'] || keys['ShiftRight'];
  const fwd = forwardVec(), flat = flatVec(), right = rightVec();
  const normal = overRift ? _up : terrainNormal(player.pos.x, player.pos.z, zi);
  // On the deck the seafloor's slope is irrelevant — planks are planks.
  const walkable = onDeck || normal.y > MAX_WALK_SLOPE;

  // ---- suit air, integrated UNCONDITIONALLY ---------------------------------
  // Above the grounded/swim split on purpose: the exhaust valve has to work while he is
  // standing on the bottom, the trim gauge has to keep moving while he walks, and his
  // weight on the seabed is whatever the dress is holding up right now.
  const P = 1 + Math.max(0, -player.pos.y) / P_REF;
  const fullTrim = P / PFILL;
  // Space is the AIR PACK now, not the inlet valve: the dress fills from the pack's burst
  // (the jet spills into it as it runs; a tap spills a little — airPackTap).
  if (player.jet > 0) {
    player.jetT = (player.jetT || 0) + dt;
    const up = player.jetDir.y > 0 ? player.jetDir.y : 0;
    const ramp = clamp((player.jetT - JET_TRIM_T0) / (JET_TRIM_T1 - JET_TRIM_T0), 0, 1);
    player.trim = Math.min(TRIM_MAX, player.trim + JET_TRIM * player.jet * ramp * ramp * (3 - 2 * ramp) * (JET_TRIM_FLAT + (1 - JET_TRIM_FLAT) * up) * dt);
  } else player.jetT = 0;
  player.thrustOn = player.jet > 0.05;
  if (keys['ControlLeft'] || keys['KeyC']) player.trim = Math.max(0, player.trim - TRIM_DOWN * dt);
  if (player.trim > fullTrim) player.trim = Math.max(fullTrim, player.trim - TRIM_RELIEF * dt);
  // THE REAL WAVE UNDER HIM. This was the raft's old decorative sine — but the raft
  // rides surfaceHeightAt now and Sal was left floating on a phantom flat-ish sea
  // while gale swells rolled through him (user-reported: "sal doesnt really float in
  // the water correctly when the storm hits"). Same source the raft and the mesh use,
  // sampled at HIS position, so a passing crest lifts him and a trough drops him.
  const swell = surfaceHeightAt(player.pos.x, player.pos.z, t, stormLevel());
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
  const burstA = player.burstT > 0 ? BURST_ACC * player.burstPow * burstEnv(BURST_DUR - player.burstT) : 0;
  if (player.burstT > 0) player.burstT = Math.max(0, player.burstT - dt);
  // JERKED OFF BALANCE. After a hard snap of the hose he is not driving, he is getting his
  // feet (or his trim) back: the drive comes back in on a smoothstep over the recovery,
  // so the first half is mostly the line's and the last half is mostly his.
  let ctrl = 1;
  if (player.stagger > 0) {
    const u = 1 - player.stagger / Math.max(player.staggerDur, 1e-3);
    ctrl = 1 - player.staggerK * (1 - u * u * (3 - 2 * u));
    player.stagger = Math.max(0, player.stagger - dt);
  }

  if (player.grounded) {
    // A man in a Mark V with lead soles PLODS: 1.5 u/s on planks, 2.15 on the seabed (the
    // weighted-suit pass; both were 2.6, and faster was rejected). What used to be wrong was that ONE friction constant served
    // planks and silt alike, so he skated on the deck and the seabed told him nothing
    // about the water above it. Below, the ground picks the time constant and the top
    // speed is held fixed against it.
    // How much of him the bottom is actually carrying. Vented, the dress holds nothing
    // up and 170 kg of lead and brass is on his soles; blown up, he is nearly floating
    // and the boots skim. On planks there is no water to hold anything up: weight is 1.
    player.scullX = 0; player.scullZ = 0; player.haulZ = 0;
    const wgt = onDeck ? 1 : clamp((GROUND_BUOY - player.buoy) / (GROUND_BUOY - A_BUOY_MIN), 0, 1);
    const tau = onDeck ? TAU_DECK : TAU_SILT_LIGHT + (TAU_SILT_HEAVY - TAU_SILT_LIGHT) * wgt;
    // (sealegs) on a working deck he walks slower: wider, shorter, picking his moment
    const top = onDeck ? WALK_TOP_DECK * (1 - SEA.slow * player.sea.k * SEA.on) : WALK_TOP_BED;
    const fr = Math.exp(-dt / tau);
    // Terminal speed is the ground's top on every ground, at every frame rate. The step here is
    // v <- (v + a*dt) * fr, whose fixed point is a*dt*fr/(1-fr); solving that for a
    // instead of writing the continuous a = TOP/tau is what makes the sentence true.
    const q = (player.walkP * 2) % 1;
    const lurch = 1 + (onDeck ? LURCH_DECK : LURCH_BED) * Math.cos(TAU2 * (q - 0.5));
    const acc = top * (1 - fr) / (fr * Math.max(dt, 1e-4)) * (sprinting ? WALK_HURRY : 1) * (walkable ? 1 : 0.25) * lurch * ctrl
      * (player.stepUp > 0 ? 0 : 1);   // (sweep) hauling himself up off the ladder: no walk yet
    if (keys['KeyW'] || keys['ArrowUp']) player.vel.addScaledVector(flat, acc * dt);
    if (keys['KeyS'] || keys['ArrowDown']) player.vel.addScaledVector(flat, -acc * dt * 0.7);
    if (keys['KeyA'] || keys['ArrowLeft']) player.vel.addScaledVector(right, -acc * dt * 0.8);
    if (keys['KeyD'] || keys['ArrowRight']) player.vel.addScaledVector(right, acc * dt * 0.8);
    // THE LURCH DOWN-SLOPE (sealegs). Walking a rolled deck, gravity along the planks takes a
    // share of every step: he is carried down the slope and labours up it, so his path bends
    // and his pace swells and stalls with the roll. Only while he is walking: standing, the
    // balance excursion (carryDeck) owns the slope, and a drift here would walk him off.
    if (onDeck && SEA.on && (keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown'] ||
        keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight'])) {
      const e = raft.matrixWorld.elements;
      // the deck's downhill direction in the world, x/z: the horizontal part of -gravity
      // projected onto the plane is (nx, nz) of its up axis
      const gk = 9.81 * SEA.walkK * (0.35 + 0.65 * player.sea.k);
      const ax = clamp(e[4] * gk, -SEA.walkMax / tau, SEA.walkMax / tau), az = clamp(e[6] * gk, -SEA.walkMax / tau, SEA.walkMax / tau);
      player.vel.x += ax * dt; player.vel.z += az * dt;
    }
    // A step up into the water column, not a leap. The same keypress is filling the
    // dress, so the push-off buys the seconds the air needs to take over.
    // NOT ON THE DECK: there is no water column to step into, and a hop is the one thing
    // that could still carry 90 lb of dress over a bulwark the rail check now holds him
    // at. On planks Space is the inlet valve and nothing else.
    // THE AIR PACK's hop (a tap on the seabed, airPackTap) and its held burst both take
    // him off the bottom; the swim branch flies him from the next frame.
    // (sweep) hauling himself up off the ladder he stands where the deck carries him
    if (player.stepUp > 0) { player.vel.x = 0; player.vel.z = 0; }
    if (player.hop > 0 && !onDeck) { player.vel.y = player.hop; player.grounded = false; }
    if (player.jet > 0 && !onDeck) player.grounded = false;
    player.hop = 0;
    // On terrain too steep to stand on, gravity drags him downslope.
    if (!walkable) player.vel.addScaledVector(_slide.set(normal.x, 0, normal.z).normalize(), 30 * dt);
    // lead boots, less whatever the dress is holding up
    player.vel.y -= clamp(22 - player.buoy * 2.2, 15, 28) * dt;
    player.vel.x *= fr; player.vel.z *= fr;
    // THE STRIDE PRESSES, keyed on the heel strike diver.js reports, so it is felt on the step
    // you see. Underwater it is the water; on the planks it is the boot stopping dead.
    // Scaled by speed so a standing man is not shoved by phantom footfalls.
    {
      const side = player.walkP < 0.5 ? 0 : 1;
      if (side !== strideSide) {
        strideSide = side;
        const sp = Math.hypot(player.vel.x, player.vel.z);
        const d = (onDeck ? STRIDE_DRAG_DECK : STRIDE_DRAG * wgt + STRIDE_DRAG_LIGHT * (1 - wgt)) * clamp(sp / top, 0, 1);
        player.vel.x -= player.vel.x * d; player.vel.z -= player.vel.z * d;
      }
    }
    player.bobPhase += player.vel.length() * dt * 2.1;
  } else {
    // W/S drive him along the FLAT heading at full thrust; only a small share of the
    // stroke goes vertical when he is pitched. Before this, holding W while looking down
    // was a -18 u/s jet and the valve below was decoration.
    // 33, was 42 (the weighted-suit pass): cruise ~15.5 u/s, was 17.6. A man hauling himself
    // through the water in 90 kg of dress is drawn along, not driven; the bottle burst
    // (untouched) is still the way to cover ground fast.
    // THE AIR PACK pass (Michael 2026-10-04: "Swimming forward or back is still too fast and
    // should need the air pack to push him forward faster"): 8.0, was 33 — cruise ~6.6 u/s,
    // was ~16. He drags himself through the water; speed is the pack's.
    const acc = HAUL / AM_H * ctrl;
    const sy = Math.sin(player.pitch);
    let ay = emerge > 0 ? (player.buoy + G_W) * (1 - emerge) - G_W : player.buoy;
    // The kick, not the throttle. Unit mean, so the minute-by-minute distance is the old
    // one; what is new is that the speed now rises and falls under him.
    const kick = kickThrust(player.swimP);
    const kickB = kick * (BACK_GAIN / KICK_GAIN);
    player.scullX = 0; player.scullZ = 0;
    const kF = keys['KeyW'] || keys['ArrowUp'], kB = keys['KeyS'] || keys['ArrowDown'];
    player.haulZ = ((kF ? 1 : 0) - (kB ? 1 : 0)) * ctrl;
    if (kF) { player.vel.addScaledVector(flat, acc * kick * dt); ay += A_LOOK * sy * kick; }
    if (kB) { player.vel.addScaledVector(flat, -acc * SCULL * kickB * dt); ay -= A_LOOK * sy * SCULL * kickB; player.scullZ = -1; }
    if (keys['KeyA'] || keys['ArrowLeft']) { player.vel.addScaledVector(right, -acc * SCULL * dt); player.scullX = -1; }
    if (keys['KeyD'] || keys['ArrowRight']) { player.vel.addScaledVector(right, acc * SCULL * dt); player.scullX = 1; }
    // (Space no longer kicks up: it is the pack. C still drives him down as it vents.)
    if (keys['ControlLeft'] || keys['KeyC']) { ay -= A_KICK; if (player.vel.y > 0) player.vel.y *= Math.exp(-VENT_BRAKE * dt); }
    if (!(keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown'] || keys['KeyA'] || keys['ArrowLeft'] ||
      keys['KeyD'] || keys['ArrowRight'] || keys['Space'] || keys['ControlLeft'] || keys['KeyC'])) ay += A_SETTLE * (1 - emerge);

    // Ambient current nudges him around; the world should never feel perfectly still.
    player.vel.addScaledVector(sampleCurrent(player.pos, t), dt * 0.5);
    // Bottle blowdown, split per axis so the added mass it has to shift is the same
    // added mass everything else shifts.
    if (burstA > 0) {
      const k = burstA * dt;
      player.vel.x += player.burstDir.x * k / AM_BURST_H;
      player.vel.y += player.burstDir.y * k / AM_BURST_V;
      player.vel.z += player.burstDir.z * k / AM_BURST_H;
    }
    // THE HELD BURST. Faded out as he breaks the surface: there is no water to push on.
    if (player.jet > 0) {
      const k = JET_ACC * player.jet * (1 - emerge) * dt;
      player.vel.x += player.jetDir.x * k / AM_JET_H;
      player.vel.y += player.jetDir.y * k / AM_JET_V;
      player.vel.z += player.jetDir.z * k / AM_JET_H;
    }
    // THE HOP's brake: the climb out of a seabed hop is fought, the fall back is not.
    if (player.hopT > 0) {
      if (player.vel.y > 0) player.vel.y *= Math.exp(-HOP_K * dt);
      player.hopT = Math.max(0, player.hopT - dt);
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
      // TUMBLING: jerked over by the hose he is broadside to the water, not drawn through it
      // end-on, and the extra drag is what stops the snap's rebound carrying him tens of
      // units back toward the raft (the heavy-swim added mass would). Fades with the stagger.
      if (player.stagger > 0) {
        const tk = Math.exp(-YANK_TUMBLE_DRAG * (1 - ctrl) * dt);
        player.vel.x *= tk; player.vel.z *= tk; player.vel.y *= tk;
      }
    }
  }

  player.pos.addScaledVector(player.vel, dt);

  // ---- THE BULWARK AND THE DECK GEAR ---------------------------------------------------
  // Held at the rail on all four sides while he is on the deck, with ONE gap: the
  // boarding bay on the +X rail. Stepping off through that bay is the only way off the
  // raft, which is exactly what the ladder and the davit were built around. And held off
  // every solid thing standing on the planks (systems/raft/colliders.js).
  // Deck-side ONLY. Nothing here touches the water: swimming under the raft, the ladder
  // grab above, the one-way platform below and HOSE_REQ are all untouched, because this
  // block cannot run unless he was standing on the planks this frame.
  // RAFT-LOCAL: his waist is taken into the raft's frame (its heave, surge, pitch and
  // roll — updateRaft refreshed matrixWorld this frame), resolved there, and the push is
  // carried back out through the raft's own axes.
  if (onDeck && player.grounded) {
    _deckInv.copy(raft.matrixWorld).invert();
    _deckP.set(player.pos.x, player.pos.y - EYE_H + 0.9, player.pos.z).applyMatrix4(_deckInv);
    const e = raft.matrixWorld.elements;
    _deckL.x = _deckP.x; _deckL.z = _deckP.z;
    // velocity into the raft's axes (the inverse of a rotation is its transpose; the
    // raft carries no scale)
    _deckV.x = e[0] * player.vel.x + e[1] * player.vel.y + e[2] * player.vel.z;
    _deckV.z = e[8] * player.vel.x + e[9] * player.vel.y + e[10] * player.vel.z;
    const vx0 = _deckV.x, vz0 = _deckV.z;
    if (resolveDeck(_deckL, _deckV)) {
      const dx = _deckL.x - _deckP.x, dz = _deckL.z - _deckP.z;
      player.pos.x += e[0] * dx + e[8] * dz;
      player.pos.z += e[2] * dx + e[10] * dz;
      const dvx = _deckV.x - vx0, dvz = _deckV.z - vz0;
      player.vel.x += e[0] * dvx + e[8] * dvz;
      player.vel.z += e[2] * dvx + e[10] * dvz;
    }
  }

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
  // A man on the boarding ladder is the exception: hand-over-hand up the rungs is the
  // one legitimate way out of the water, and this ceiling was silently erasing every
  // centimetre the climb added.
  // Wave-relative, not flat: the old fixed SURFACE_Y - 1.2 plane clamped him ~4 units
  // under a passing gale crest (the wave field heaves +-3 now), which is exactly the
  // "doesn't float right in a storm" report. The backstop follows the same wave his
  // buoyancy equilibrium rides.
  const ceilY = SURFACE_Y - 1.2 + swell;
  if (player.pos.y > ceilY && !player.onLadder) {
    player.pos.y = ceilY;
    if (player.vel.y > 0) player.vel.y = 0;
  }

  // Solid boulders and props: push the diver out of the same spheres the camera avoids,
  // and kill the inward velocity so he slides along the surface instead of jittering.
  const BODY_R = 0.9;
  for (let list = 0; list < 4; list++) {
  const cols = list === 0 ? rockColliders : list === 1 ? propColliders : list === 2 ? wreckColliders : ventColliders;
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
    // In AIR buoyancy is meaningless: he is held down by his own weight, not by failing
    // to displace water. Without the onDeck term a full dress (buoy +2.61 at the surface,
    // where the tenders keep him blown up) made the deck unstandable.
    player.grounded = onDeck || player.buoy < GROUND_BUOY;
  } else if (player.pos.y < floorY + 1.2 && player.vel.y <= 0.5 && !keys['Space'] && (onDeck || player.buoy < GROUND_BUOY)) {
    // ON PLANKS THE FOLLOW IS RIGID: a man standing on a boat moves WITH the boat.
    // The 10/s ease is for seabed terrain; against the raft's swell bob it left Sal
    // a few centimetres out of phase with his own deck, which read as him bobbing
    // "like he is in the water" (user-reported). Exact snap on deck, ease on ground.
    if (onDeck) player.pos.y = floorY;
    else player.pos.y += (floorY - player.pos.y) * Math.min(1, 10 * dt);
    player.grounded = true;
  } else if (player.pos.y > floorY + 1.4 || (!onDeck && player.buoy > GROUND_BUOY)) {
    player.grounded = false;
  }

  // (sweep) OVER THE SILL, NOT A TELEPORT. The climb hands over to the deck when his eye is
  // 0.7 under the deck's standing height (the one-way catch), and the catch put him there in
  // ONE frame: measured, the whole diver (helmet, hips, camera) jumped 0.69 u up and both boots
  // went from half a metre under the planks to 20 cm over them between two frames. Now the
  // deck takes his boots at once and his body comes up over them, a heavy man straightening
  // out of the last step (~0.45 s, eased out), still on the deck and carried with it.
  if (onDeck && player.grounded && !player.onLadder) {
    if (wasLadder && ladYPrev < floorY - 0.05 && LADDER_STEP.on) { player.stepUp = floorY - ladYPrev; player.stepUpV = 0; }
    if (player.stepUp > 0) {
      // critically damped toward 0 at w (no overshoot: he never rises past standing)
      const w = LADDER_STEP.w, a = -w * w * player.stepUp - 2 * w * player.stepUpV;
      player.stepUpV += a * dt; player.stepUp += player.stepUpV * dt;
      if (player.stepUp < 0.002) player.stepUp = player.stepUpV = 0;
      player.pos.y = floorY - player.stepUp;
    }
  } else player.stepUp = player.stepUpV = 0;
  ladYPrev = player.pos.y;

  // (sealegs) Where he stands on the planks, in the raft's frame, for the next carry: the
  // deck point under him, less the balance excursion (that is the sway, not the spot).
  if (onDeck && player.grounded && !player.onLadder) {
    // (stepUp: the spot is where he will STAND; read off his lowered centre, a tilted deck's
    // inverse rotation slid it sideways a little every frame and walked him off the edge)
    toDeck(player.pos.x, player.pos.y + player.stepUp - EYE_H, player.pos.z, _dkL);
    player.deckL.x = _dkL.x - seaS.x; player.deckL.z = _dkL.z - seaS.z; player.deckL.ok = true;
  } else player.deckL.ok = false;

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
  player.jet = 0; player.hop = 0; player.hopT = 0; player.thrustOn = false;
}
