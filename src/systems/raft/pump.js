// The air pump: a single-cylinder oil engine belt-driving a two-stage compressor.
// OWNED BY: orchestrator.
//
// This machine is the fuel gauge. Sal's air comes down the umbilical from it, and
// `survival.fuel` is literally what is in its tank, so the player has to be able to read
// running-or-dead from across the deck without looking at the HUD. It was a box with a
// ring on it; now it is two machines linked by a belt, which is the oldest and clearest
// way to draw "power is being transmitted" in three dimensions.
//
// Six simultaneous tells, so the read survives any camera angle:
//   flywheel coasts up and down (a heavy wheel has inertia; a hard cut reads as fake)
//   the compressor pulley turns with it, geared by the belt ratio
//   governor balls fly out with revs and drop as it dies
//   the receiver's pressure gauge needle follows, and bleeds down when it stops
//   the whole bed vibrates in proportion
//   the stack issues exhaust that climbs and drifts
//
// The group origin sits ON THE DECK (local y = 0 is the plank surface), so every number
// below reads as a height above the boards.
import * as THREE from 'three';
import { Part, xf, box, cyl, sph, tor, lathe, weather, tint, rivetRing, boltLine, rope, TAU } from './kit.js';

// Where the machine sits on the deck. Its footprint is the OCCUPIED box the deck
// builders were told to keep clear: x [-1.15,1.60], y [0,2.50], z [-2.05,-0.35].
export const PUMP_POS = new THREE.Vector3(0.15, 0.11, -1.20);

// Belt geometry, solved once. Open (non-crossed) flat belt between two pulleys:
// the tangent lines lie at asin((r1-r2)/d) to the centre line.
const FW_X = -0.55, FW_Y = 0.82, FW_R = 0.58;       // engine flywheel
const PL_X = 0.85, PL_R = 0.26;                      // compressor pulley
const BELT_Z = 0.46, BELT_W = 0.11, BELT_T = 0.024;
const BELT_D = PL_X - FW_X;
const BELT_A = Math.asin((FW_R - PL_R) / BELT_D);
const BELT_RATIO = FW_R / PL_R;

// A straight run of flat belt between two tangent points.
function beltRun(P, mat, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  P.add(xf(box(Math.hypot(dx, dy), BELT_T, BELT_W),
    (x0 + x1) / 2, (y0 + y1) / 2, BELT_Z, 0, 0, Math.atan2(dy, dx)), mat);
}

// The wrap around a pulley, as short chords. A torus would give a round section, and a
// flat belt seen edge-on is the whole point of drawing one.
function beltArc(P, mat, cx, cy, r, a0, a1, n) {
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n, tm = (t0 + t1) / 2;
    const seg = 2 * r * Math.sin(Math.abs(t1 - t0) / 2) * 1.06;
    P.add(xf(box(seg, BELT_T, BELT_W), cx + Math.cos(tm) * r, cy + Math.sin(tm) * r, BELT_Z,
      0, 0, tm + Math.PI / 2), mat);
  }
}

// A spoked wheel in the XY plane. Both wheels live in one plane so the belt is a plane
// figure — that is why there is no pivot group here any more. Setting rotation.z on a
// mesh already turned by rotation.y does not spin a torus in its plane, it tumbles it,
// and that bug cost a round last time.
// `ts` is the rim's tubular count: these wheels SPIN, and a faceted rim strobes — the
// flywheel runs 36, the smaller (and faster, belt-ratio) pulley 24.
function wheel(P, mats, r, spokes, tube, hub, ts = 36) {
  P.add(tor(r, tube, 8, ts), mats.brass);
  P.add(xf(cyl(r * 0.96, r * 0.96, tube * 0.55, 20), 0, 0, 0, Math.PI / 2), mats.iron);  // web
  for (let i = 0; i < spokes; i++) {
    P.add(xf(box(r * 1.86, tube * 0.75, tube * 0.6), 0, 0, 0, 0, 0, i * Math.PI / spokes), mats.brass);
  }
  P.add(xf(cyl(hub, hub, tube * 2.6, 10), 0, 0, 0, Math.PI / 2), mats.iron);
}

export function buildPump(group, mats) {
  group.position.copy(PUMP_POS);
  const P = Part(group);

  // ---- bed ---------------------------------------------------------------------
  // Timber bearers on iron sole plates, through-bolted to the deck. An engine that is
  // not bolted down walks itself off a boat, and the bolt heads are what say so.
  for (const z of [-0.30, 0.30]) {
    P.add(weather(xf(box(2.62, 0.16, 0.26), 0.08, 0.08, z), { tone: 0.86, freq: 1.1, amp: 0.30 }), mats.wood);
  }
  P.add(xf(box(2.72, 0.05, 0.86), 0.08, 0.185, 0), mats.iron);
  boltLine(P, mats.iron, -1.16, 0.22, -0.30, 1.30, 0.22, -0.30, 6, 0.036, 6, 4, true);
  boltLine(P, mats.iron, -1.16, 0.22, 0.30, 1.30, 0.22, 0.30, 6, 0.036, 6, 4, true);

  // ---- the engine --------------------------------------------------------------
  // Crankcase, one big cylinder with cooling fins, hot-bulb head. Period oil engines
  // were enormous for their power, which is why this thing is half the machine.
  P.add(weather(xf(box(1.02, 0.62, 0.62), FW_X, 0.52, 0), { tone: 0.92, freq: 1.4, amp: 0.22, rust: 0.35 }), mats.iron);
  P.add(xf(box(1.08, 0.06, 0.68), FW_X, 0.84, 0), mats.iron);          // crankcase joint flange
  rivetRing(P, mats.iron, 8, FW_X, 0.52, 0.32, 0.24, 0.028, 'z');       // inspection door
  P.add(xf(cyl(0.14, 0.14, 0.04, 10), FW_X, 0.52, 0.33, Math.PI / 2), mats.brass);

  P.add(weather(xf(cyl(0.21, 0.23, 0.60, 12), FW_X, 1.17, 0), { tone: 0.90, freq: 2.0, amp: 0.20, rust: 0.30 }), mats.iron);
  for (let i = 0; i < 7; i++) {                                        // cooling fins
    P.add(xf(cyl(0.28, 0.28, 0.026, 12), FW_X, 0.94 + i * 0.075, 0), mats.iron);
  }
  P.add(xf(lathe([[0, 0], [0.20, 0.02], [0.24, 0.10], [0.22, 0.24], [0.13, 0.33], [0, 0.35]], 12),
    FW_X, 1.47, 0), mats.iron);                                         // hot-bulb head
  rivetRing(P, mats.brass, 6, FW_X, 1.49, 0, 0.20, 0.030, 'y');

  // Exhaust stack, offboard of the head so it clears the governor. Its tip has to stay
  // under raft-local y = 2.50, which is the ceiling the deck builders were promised.
  P.add(weather(xf(cyl(0.095, 0.115, 1.30, 10), -1.00, 1.56, 0), { tone: 0.88, freq: 2.2, amp: 0.24, rust: 0.55 }), mats.iron);
  P.add(xf(cyl(0.135, 0.10, 0.14, 10), -1.00, 2.26, 0), mats.iron);     // cowl
  P.add(xf(cyl(0.17, 0.17, 0.025, 10), -1.00, 2.36, 0), mats.iron);     // rain cap
  P.add(xf(cyl(0.02, 0.02, 0.10, 5), -1.00, 2.32, 0), mats.iron);
  // elbow from head to stack
  rope(P, mats.iron, [[FW_X - 0.16, 1.62, 0], [-0.80, 1.70, 0], [-1.00, 1.58, 0]], 0.075, 10);

  // Fuel tank: this is the bitumen. Sight glass on the near face so the level reads.
  P.add(weather(xf(box(0.44, 0.40, 0.46), -1.08, 1.06, -0.22), { tone: 0.84, freq: 1.8, amp: 0.26, rust: 0.45 }), mats.iron);
  P.add(xf(cyl(0.035, 0.035, 0.34, 8), -0.88, 1.06, -0.04), mats.glass);   // sight glass
  P.add(xf(cyl(0.05, 0.05, 0.07, 8), -1.08, 1.28, -0.22), mats.brass);     // filler cap
  P.add(xf(cyl(0.028, 0.028, 0.16, 6), -0.94, 0.90, -0.02, 0, 0, Math.PI / 2), mats.brass);  // tap
  P.add(xf(box(0.09, 0.015, 0.015), -0.88, 0.90, -0.02), mats.brass);

  // Drip lubricators: two brass cups with glass bodies on the crankcase top. The most
  // period-correct object on the whole machine and it costs almost nothing.
  for (const x of [FW_X - 0.20, FW_X + 0.20]) {
    P.add(xf(cyl(0.045, 0.045, 0.11, 8), x, 0.95, -0.20), mats.glass);
    P.add(xf(cyl(0.055, 0.055, 0.035, 8), x, 1.02, -0.20), mats.brass);
    P.add(xf(cyl(0.018, 0.018, 0.08, 6), x, 0.88, -0.20), mats.brass);
  }

  // Starting handle, stowed in its clip on the bed. Nobody is cranking it — Sal is in
  // the water — and a handle lying idle says that better than an empty bracket.
  P.add(xf(cyl(0.026, 0.026, 0.62, 6), -0.30, 0.30, -0.40, 0, 0, Math.PI / 2), mats.iron);
  P.add(xf(cyl(0.026, 0.026, 0.16, 6), 0.01, 0.30, -0.40), mats.iron);
  P.add(xf(cyl(0.042, 0.042, 0.13, 8), 0.01, 0.38, -0.40), mats.wood);

  // ---- the compressor ----------------------------------------------------------
  // Two finned barrels on a small crankcase: high stage and low stage. It is visibly
  // smaller and faster than the engine, which is what the belt ratio is telling you.
  P.add(weather(xf(box(0.74, 0.48, 0.52), PL_X, 0.45, 0), { tone: 0.90, freq: 1.6, amp: 0.22, rust: 0.30 }), mats.iron);
  for (const [x, r, h] of [[PL_X - 0.17, 0.135, 0.50], [PL_X + 0.17, 0.105, 0.44]]) {
    P.add(xf(cyl(r, r * 1.05, h, 10), x, 0.69 + h / 2 - 0.02, 0), mats.iron);
    for (let i = 0; i < 5; i++) P.add(xf(cyl(r + 0.055, r + 0.055, 0.022, 10), x, 0.76 + i * 0.085, 0), mats.iron);
    P.add(xf(cyl(r + 0.03, r + 0.03, 0.07, 10), x, 0.71 + h, 0), mats.brass);   // head
  }
  P.add(xf(box(0.52, 0.07, 0.16), PL_X, 1.26, 0), mats.brass);                  // manifold

  // Receiver, cradled above the compressor. Air is stored here before it goes down the
  // hose, and its gauge is the one dial on the raft worth reading.
  // Hemispherical ends put a full radius past the barrel, so the barrel is short: the
  // whole vessel has to finish inside x = 1.45.
  P.add(weather(xf(cyl(0.25, 0.25, 0.98, 14), 0.68, 1.66, -0.14, 0, 0, Math.PI / 2),
    { tone: 0.92, freq: 1.5, amp: 0.20, rust: 0.28 }), mats.iron);
  for (const x of [0.19, 1.17]) P.add(xf(sph(0.25, 10, 6), x, 1.66, -0.14), mats.iron);
  for (const x of [0.34, 1.02]) {                                              // saddle straps
    P.add(xf(tor(0.27, 0.028, 4, 14), x, 1.66, -0.14, 0, Math.PI / 2), mats.iron);
    P.add(xf(box(0.06, 0.30, 0.12), x, 1.41, -0.14), mats.iron);
  }
  rope(P, mats.brass, [[PL_X, 1.30, 0], [PL_X, 1.44, -0.06], [0.80, 1.48, -0.14]], 0.038, 10);
  // delivery line off the receiver, heading forward to the reel
  rope(P, mats.brass, [[1.17, 1.62, 0.02], [1.24, 1.30, 0.28], [1.18, 0.72, 0.52]], 0.036, 12);

  // Stop valve on the delivery. A wheel says a human decides when air flows.
  P.add(xf(tor(0.105, 0.020, 4, 12), 1.24, 1.30, 0.30, Math.PI / 2), mats.brass);
  for (let i = 0; i < 3; i++) P.add(xf(box(0.20, 0.018, 0.018), 1.24, 1.30, 0.30, 0, i * Math.PI / 3, 0), mats.brass);
  P.add(xf(cyl(0.028, 0.028, 0.09, 6), 1.24, 1.30, 0.30, Math.PI / 2), mats.brass);

  // ---- governor -----------------------------------------------------------------
  const gov = new THREE.Group();
  gov.position.set(-0.16, 1.02, 0.10);
  group.add(gov);
  const GP = Part(gov);
  GP.add(xf(cyl(0.035, 0.035, 0.46, 6), 0, 0.23, 0), mats.iron);
  GP.add(xf(cyl(0.075, 0.075, 0.05, 8), 0, 0.02, 0), mats.iron);
  GP.bake();
  const govArms = [];
  for (const sgn of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(0, 0.46, 0);
    const AP = Part(arm);
    AP.add(xf(cyl(0.020, 0.020, 0.34, 5), 0, -0.17, 0), mats.iron);
    AP.add(xf(sph(0.070, 8, 6), 0, -0.34, 0), mats.brass);
    AP.bake();
    arm.userData.sgn = sgn;
    gov.add(arm);
    govArms.push(arm);
  }

  // ---- flywheel, pulley, belt ----------------------------------------------------
  const flywheel = new THREE.Group();
  flywheel.position.set(FW_X, FW_Y, BELT_Z);
  group.add(flywheel);
  const FP = Part(flywheel);
  wheel(FP, mats, FW_R, 4, 0.085, 0.13);
  FP.add(xf(cyl(0.055, 0.055, 0.26, 8), FW_R * 0.72, 0, 0.10, Math.PI / 2), mats.brass);  // crank pin
  FP.bake();

  const pulley = new THREE.Group();
  pulley.position.set(PL_X, FW_Y, BELT_Z);
  group.add(pulley);
  const UP = Part(pulley);
  wheel(UP, mats, PL_R, 3, 0.055, 0.075, 24);
  UP.bake();

  {
    // The tangent point sits at (90 deg - alpha) from the centre line, not (90 + alpha):
    // the radius is perpendicular to a tangent that slopes DOWN from the big wheel to
    // the small one, so it leans toward the small wheel, not away from it. Getting that
    // sign wrong also flips which wheel gets the long wrap. Open belt: the large wheel
    // wraps pi + 2*alpha (206.4 deg here), the small one pi - 2*alpha (153.6 deg).
    const a = Math.PI / 2 - BELT_A;
    const ca = Math.cos(a), sa = Math.sin(a);
    beltRun(P, mats.leather, FW_X + ca * FW_R, FW_Y + sa * FW_R, PL_X + ca * PL_R, FW_Y + sa * PL_R);
    beltRun(P, mats.leather, FW_X + ca * FW_R, FW_Y - sa * FW_R, PL_X + ca * PL_R, FW_Y - sa * PL_R);
    beltArc(P, mats.leather, FW_X, FW_Y, FW_R, a, TAU - a, 11);         // round the back
    beltArc(P, mats.leather, PL_X, FW_Y, PL_R, -a, a, 8);               // round the front
  }

  // ---- the gauge ------------------------------------------------------------------
  // Mounted on the compressor head facing +Z, because the player stands forward of the
  // machine and looks aft at it.
  const GX = PL_X, GY = 1.15, GZ = 0.30;
  P.add(xf(cyl(0.11, 0.11, 0.05, 14), GX, GY, GZ, Math.PI / 2), mats.brass);
  P.add(tint(xf(cyl(0.093, 0.093, 0.012, 14), GX, GY, GZ + 0.028, Math.PI / 2), 1.22, 1.20, 1.10), mats.brass);
  P.add(xf(cyl(0.02, 0.02, 0.20, 6), GX, GY - 0.14, GZ - 0.06), mats.brass);   // standpipe
  for (let i = 0; i <= 8; i++) {                                               // dial ticks
    const th = Math.PI * 1.25 - i / 8 * Math.PI * 1.5;
    P.add(xf(box(0.022, 0.008, 0.004), GX + Math.cos(th) * 0.070, GY + Math.sin(th) * 0.070,
      GZ + 0.035, 0, 0, th), mats.iron);
  }
  const needle = new THREE.Group();
  needle.position.set(GX, GY, GZ + 0.040);
  group.add(needle);
  const NP = Part(needle);
  NP.add(xf(box(0.075, 0.010, 0.006), 0.030, 0, 0), mats.iron);
  NP.add(xf(cyl(0.014, 0.014, 0.014, 8), 0, 0, 0, Math.PI / 2), mats.brass);
  NP.bake(false);

  P.bake();
  return { group, flywheel, pulley, govArms, needle, stackTip: new THREE.Vector3(-1.00, 2.44, 0) };
}

// ---- animation -------------------------------------------------------------------
// Called once per frame by raft.js. Writes floats only; allocates nothing.
const RPM = 9.0;
let rpm = 0, press = 0;

export function updatePump(h, dt, t, running) {
  // The wheel coasts. A heavy flywheel has inertia, and a hard stop is the single
  // clearest tell that a machine is scenery.
  rpm += ((running ? RPM : 0) - rpm) * Math.min(1, dt * (running ? 1.6 : 0.35));
  h.flywheel.rotation.z += dt * rpm;
  h.pulley.rotation.z += dt * rpm * BELT_RATIO;

  const gov = rpm / RPM;
  for (const a of h.govArms) a.rotation.z = a.userData.sgn * (0.18 + 0.78 * gov);

  // Pressure builds fast and bleeds slowly: the needle keeps falling for a while after
  // the wheel has stopped, which is exactly what a receiver does.
  press += ((running ? 0.62 + 0.30 * gov : 0) - press) * Math.min(1, dt * (running ? 0.9 : 0.22));
  h.needle.rotation.z = Math.PI * 1.25 - press * Math.PI * 1.5;

  const vib = gov * 0.012;
  h.group.position.set(
    PUMP_POS.x + Math.sin(t * 41) * vib,
    PUMP_POS.y + Math.sin(t * 33) * vib,
    PUMP_POS.z);
  h.group.rotation.z = Math.sin(t * 37) * vib * 0.6;
  return gov;
}
