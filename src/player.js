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
  burstT: 0,     // seconds of bottle blowdown still to deliver
  burstDir: V3(0, 0, 1),
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
  scullZ: 0
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
// ---- THE BULWARK IS REAL --------------------------------------------------------
// hull.js walls the deck on all four sides and leaves ONE gap: the boarding bay on the
// +Z rail at |x| < 1.2, where the ladder hangs. Until now nothing in the physics knew
// that — Sal walked off any edge he liked and the dive ritual was a formality. The rail
// line is the footprint less a body's half-width, so his shoulder stops at the timber
// rather than his eye. The push-back uses the collider idiom below: put him back on the
// line and cancel the OUTWARD component of velocity only, so he slides along the rail.
const RAIL_IN = 4.36;      // DECK_HX (4.7) - body half-width (0.34)
const BAY_HX = 1.15;       // the one gap, a touch inside the ladder grab's 1.2

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

// ---- WOOD GRIPS, SILT PRESSES ---------------------------------------------------
// One walk law, two grounds, expressed as a single time constant TAU: an exponential
// drag e^(-dt/TAU) plus an acceleration of WALK_TOP/TAU. Terminal speed is TOP by
// construction on BOTH grounds, so the ponderous ruling (2.6 u/s) is arithmetic here,
// not a value that can drift — what changes between planks and silt is only how long
// it takes to get there and how far he carries after the key lifts.
//   planks: 0.14 s. Dry timber and lead soles. He plants; the skate is gone.
//   silt:   0.38 s vented, 0.85 s with a full dress. A blown-up dress barely touches
//           the bottom, so it moon-walks: slow to gather, long to give it back.
// DEPTH IS DELIBERATELY ABSENT. The suit equalises; `buoy` is the only knob, which is
// also the one the diver himself is holding (the valve).
const WALK_TOP = 2.6;
const TAU_DECK = 0.14;
const TAU_SILT_HEAVY = 0.38, TAU_SILT_LIGHT = 0.85;
// Each stride shoves a 0.75 m^2 chest through water and the water shoves back. A small
// impulse on the heel-strike the ANIMATION reports (diver.js publishes player.walkP off
// distance travelled), so the resistance lands on the visible step, never on a timer.
const STRIDE_DRAG = 0.048, STRIDE_DRAG_LIGHT = 0.040;

// ---- THE STROKE IS THE PUSH ------------------------------------------------------
// A frog kick is not a propeller. diver.js publishes player.swimP — the same phase that
// draws the legs — and the forward thrust is shaped on it: near-nothing through the
// tuck, everything through the snap at p ~ 0.55 (where S.knee falls 1.45 -> 0.06), then
// a coast. The pulse is normalised to unit mean over the cycle, so the AVERAGE thrust,
// and with it the distance covered in a minute, is exactly what it was.
const KICK_P = 0.55, KICK_W = 0.185;
// integral of exp(-((p)/KICK_W)^2) over one cycle = KICK_W * sqrt(pi)
const KICK_NORM = KICK_W * Math.sqrt(Math.PI);
// 0.60 shipped first and Michael couldn't feel it — a ±27% swell over a whole kick
// cycle is a tide, not a stroke. 0.88 drops the coast toward half the mean and makes
// the snap a real SURGE. The camera now shows this (game.js swim-surge coupling).
const KICK_DEPTH = 0.88;   // 0 = the old constant glide, 1 = pure impulse
// Drag is QUADRATIC, so a thrust that is unit-mean in force is NOT unit-mean in speed:
// the peaks are taxed harder than the coasts are rebated and the average drops. This is
// the measured make-good (mean 16.39 -> 17.6 against the old constant 17.72), applied to
// the whole pulse so the shape is untouched and only the average moves.
// Retuned for depth 0.88 (the deeper the pulse, the harder quadratic drag taxes it).
const KICK_GAIN = 1.16;
// Backwards and sideways are sculls, not strokes: a man in a Mark V can paddle himself
// crabwise, slowly. Was 1.0 and 1.0 — indistinguishable from swimming forwards.
// This is a FORCE fraction and the target is a SPEED fraction, and drag is quadratic, so
// the two are not the same number: 0.347 of the thrust buys 0.55 of the speed (measured
// 9.4 u/s against a forward mean of 17.2). Writing 0.55 here would have bought 0.72.
const SCULL = 0.347;

// Bottle blowdown: thrust from a fixed-volume bottle through a fixed orifice tracks
// bottle pressure, which decays exponentially once the valve is cracked. A 30 ms crack
// and an 85 ms half-life, spent by 0.26 s. A bottle gives you one shove.
export const BURST_DUR = 0.26;
const BURST_ACC = 850;
export function burstEnv(tau) {
  const o = clamp(tau / 0.030, 0, 1);
  return o * o * (3 - 2 * o) * Math.exp(-tau / 0.085);
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
  let deckY = -1e5;
  const dxr = player.pos.x - raft.position.x, dzr = player.pos.z - raft.position.z;
  if (dxr > -DECK_HX && dxr < DECK_HX && dzr > -DECK_HZ && dzr < DECK_HZ) {
    const top = raft.position.y + DECK_TOP + EYE_H;
    if (player.pos.y > top - 0.7) deckY = top;
  }
  const onDeck = deckY > -1e4;
  // Published because the footfall FX are seabed effects: a silt cloud and a boot print
  // pressed into the sand. On planks, in the air, both are nonsense.
  player.onDeck = onDeck;

  // THE LADDER IS HOW HE BOARDS. A man floating at the surface sits ~1.6 below the
  // one-way platform's 0.7 catch, so without this the raft cannot be re-boarded at all —
  // measured: swimming at it passes clean under the deck, and the boarding ladder the
  // davit hangs into the water was scenery. The zone is the bulwark gap the ladder hangs
  // in (raft-local |x| < 1.2, z 4.2..5.9, from ladder-foot depth up to the catch), and
  // holding W toward the raft is the grab: he rises up the rungs at a climb, not a
  // launch, until the deck check takes him. No new input to learn — swim at the ladder
  // and keep swimming.
  player.onLadder = false;
  if (!onDeck && dxr > -1.2 && dxr < 1.2 && dzr > 4.2 && dzr < 5.9) {
    const top = raft.position.y + DECK_TOP + EYE_H;
    if (player.pos.y > top - 4.2 && player.pos.y <= top - 0.68 &&
        (keys['KeyW'] || keys['ArrowUp']) && Math.cos(player.yaw - Math.PI) > 0.1) {
      player.onLadder = true;
      player.pos.y += CLIMB_RATE * dt;
      // hold him against the rungs: kill the swim that was carrying him under the hull,
      // and pin him to the ladder line from BOTH sides — the swim thrust re-accumulates
      // after this block and was walking him off the foot of the ladder at ~0.4 u/s.
      player.vel.set(0, 0, 0);
      // The rungs hang at 4.78 — OUTBOARD of the 4.7 deck footprint, as a real ladder
      // is. Held there to the top he falls off the last rung forever (measured: climb
      // to 1.46, drop, climb again), so the last metre of climb steps him inboard over
      // the rail, which is also just what boarding looks like.
      const zAim = player.pos.y > top - 1.15 ? 4.42 : 4.78;
      player.pos.z -= clamp(dzr - zAim, -1.6 * dt, 1.6 * dt);
      player.pos.x -= clamp(dxr, -0.5 * dt, 0.5 * dt);
    }
  }
  const floorY = overRift ? -1e5 : Math.max(th + EYE_H, deckY);

  const sprinting = keys['ShiftLeft'] || keys['ShiftRight'];
  const boost = sprinting ? 2 : 1;
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
  if (keys['Space']) player.trim = Math.min(TRIM_MAX, player.trim + TRIM_UP * dt);
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
  const burstA = player.burstT > 0 ? BURST_ACC * burstEnv(BURST_DUR - player.burstT) : 0;
  if (player.burstT > 0) player.burstT = Math.max(0, player.burstT - dt);

  if (player.grounded) {
    // A man in a Mark V with lead soles PLODS: top speed 2.6 u/s, and that has not moved
    // and is not going to. What used to be wrong was that ONE friction constant served
    // planks and silt alike, so he skated on the deck and the seabed told him nothing
    // about the water above it. Below, the ground picks the time constant and the top
    // speed is held fixed against it.
    // How much of him the bottom is actually carrying. Vented, the dress holds nothing
    // up and 170 kg of lead and brass is on his soles; blown up, he is nearly floating
    // and the boots skim. On planks there is no water to hold anything up: weight is 1.
    player.scullX = 0; player.scullZ = 0;
    const wgt = onDeck ? 1 : clamp((GROUND_BUOY - player.buoy) / (GROUND_BUOY - A_BUOY_MIN), 0, 1);
    const tau = onDeck ? TAU_DECK : TAU_SILT_LIGHT + (TAU_SILT_HEAVY - TAU_SILT_LIGHT) * wgt;
    const fr = Math.exp(-dt / tau);
    // Terminal speed is WALK_TOP on every ground, at every frame rate. The step here is
    // v <- (v + a*dt) * fr, whose fixed point is a*dt*fr/(1-fr); solving that for a
    // instead of writing the continuous a = TOP/tau is what makes the sentence true.
    // (The old law's continuous 2.6 was really 2.55 at 60 Hz and 2.6 at 1000 — nobody
    // wanted that, it was just what an exponent in a pow() does when nobody checks.)
    const acc = WALK_TOP * (1 - fr) / (fr * Math.max(dt, 1e-4)) * (sprinting ? 1.55 : 1) * (walkable ? 1 : 0.25);
    if (keys['KeyW'] || keys['ArrowUp']) player.vel.addScaledVector(flat, acc * dt);
    if (keys['KeyS'] || keys['ArrowDown']) player.vel.addScaledVector(flat, -acc * dt * 0.7);
    if (keys['KeyA'] || keys['ArrowLeft']) player.vel.addScaledVector(right, -acc * dt * 0.8);
    if (keys['KeyD'] || keys['ArrowRight']) player.vel.addScaledVector(right, acc * dt * 0.8);
    // A step up into the water column, not a leap. The same keypress is filling the
    // dress, so the push-off buys the seconds the air needs to take over.
    // NOT ON THE DECK: there is no water column to step into, and a hop is the one thing
    // that could still carry 90 lb of dress over a bulwark the rail check now holds him
    // at. On planks Space is the inlet valve and nothing else.
    if (keys['Space'] && !onDeck) { player.vel.y = 2.6; player.grounded = false; }
    // On terrain too steep to stand on, gravity drags him downslope.
    if (!walkable) player.vel.addScaledVector(_slide.set(normal.x, 0, normal.z).normalize(), 30 * dt);
    // lead boots, less whatever the dress is holding up
    player.vel.y -= clamp(22 - player.buoy * 2.2, 15, 28) * dt;
    player.vel.x *= fr; player.vel.z *= fr;
    // THE STRIDE PRESSES. Underwater only — the resistance is the water, not the walk —
    // and keyed on the heel strike diver.js reports, so it is felt on the step you see.
    // Scaled by speed so a standing man is not shoved by phantom footfalls.
    if (!onDeck) {
      const side = player.walkP < 0.5 ? 0 : 1;
      if (side !== strideSide) {
        strideSide = side;
        const sp = Math.hypot(player.vel.x, player.vel.z);
        const d = (STRIDE_DRAG * wgt + STRIDE_DRAG_LIGHT * (1 - wgt)) * clamp(sp / WALK_TOP, 0, 1);
        player.vel.x -= player.vel.x * d; player.vel.z -= player.vel.z * d;
      }
    }
    player.bobPhase += player.vel.length() * dt * 2.1;
  } else {
    // W/S drive him along the FLAT heading at full thrust; only a small share of the
    // stroke goes vertical when he is pitched. Before this, holding W while looking down
    // was a -18 u/s jet and the valve below was decoration.
    const acc = 42 * boost / AM_H;
    const sy = Math.sin(player.pitch);
    let ay = emerge > 0 ? (player.buoy + G_W) * (1 - emerge) - G_W : player.buoy;
    // The kick, not the throttle. Unit mean, so the minute-by-minute distance is the old
    // one; what is new is that the speed now rises and falls under him.
    const kick = kickThrust(player.swimP);
    player.scullX = 0; player.scullZ = 0;
    if (keys['KeyW'] || keys['ArrowUp']) { player.vel.addScaledVector(flat, acc * kick * dt); ay += A_LOOK * sy * kick; }
    if (keys['KeyS'] || keys['ArrowDown']) { player.vel.addScaledVector(flat, -acc * SCULL * dt); ay -= A_LOOK * sy * SCULL; player.scullZ = -1; }
    if (keys['KeyA'] || keys['ArrowLeft']) { player.vel.addScaledVector(right, -acc * SCULL * dt); player.scullX = -1; }
    if (keys['KeyD'] || keys['ArrowRight']) { player.vel.addScaledVector(right, acc * SCULL * dt); player.scullX = 1; }
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

  // ---- THE BULWARK ----------------------------------------------------------------
  // Held at the rail on all four sides while he is on the deck, with ONE gap: the
  // boarding bay on the +Z rail. Stepping off through that bay is the only way off the
  // raft, which is exactly what the ladder and the davit were built around.
  // Deck-side ONLY. Nothing here touches the water: swimming under the raft, the ladder
  // grab above, the one-way platform below and HOSE_REQ are all untouched, because this
  // block cannot run unless he was standing on the planks this frame.
  if (onDeck && player.grounded) {
    const rx = player.pos.x - raft.position.x, rz = player.pos.z - raft.position.z;
    if (rx > RAIL_IN) { player.pos.x = raft.position.x + RAIL_IN; if (player.vel.x > 0) player.vel.x = 0; }
    else if (rx < -RAIL_IN) { player.pos.x = raft.position.x - RAIL_IN; if (player.vel.x < 0) player.vel.x = 0; }
    if (rz < -RAIL_IN) { player.pos.z = raft.position.z - RAIL_IN; if (player.vel.z < 0) player.vel.z = 0; }
    // The dive side: rail everywhere except across the ladder bay, where the timber is
    // genuinely absent and he walks out over the edge and falls, as he should.
    else if (rz > RAIL_IN && (rx > BAY_HX || rx < -BAY_HX)) {
      player.pos.z = raft.position.z + RAIL_IN; if (player.vel.z > 0) player.vel.z = 0;
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
