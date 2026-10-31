// THE POINT, ALIVE (clawpoint 2026-10-31; Michael on the point after the calm: "looks good - but the claw still feels very robotic").
// The aim is approved and kept (brooder.js aimPoint, POINT): this is only how the claw gets there, holds and comes back.
//
// WHAT WAS RIGID: one scalar (L.pointK, a smoothstep) lerped the shoulder, the elbow, the wrist and the finger to the reach on the same
// frame (the pattern brooderClaw.js diagnosed in her strikes), and at pointK 1 the lerp erased her idle drift and the finger's work, so
// the 3 s hold was dead still; the lower was the same curve mirrored in the same 1 s; nothing else in her body answered.
//
// REFERENCE (reviews/clawpoint/report.md has the sources):
//   - fiddler crab vertical wave (Crane 1957): the cheliped starts flexed before the mouth, the lift leads, and the fuller the display the
//     further the elevation "continues through the unflexing" of the hand and fingers: proximal first, distal unfolds during the lift;
//     it comes down in the plane it went up in.
//   - Uca perplexa's wave (Murai & Backwell 2006): an upstroke, a PAUSE at the apex, a downstroke: three distinct beats.
//   - lobster pre-fight display (Kravitz): motionless, claws up, standing high on the tips of the walking legs: the body rises with it.
//   - crayfish meral spread (Edwards et al.): claws up, out and forward, the fingers moderately separated (open, not gaping).
//   - coconut crab (Oka et al. 2016): the great claw is the heaviest thing she carries; a held reach is a load.
// ANIMATION PRINCIPLE (not reference, the house's bar: heavy, dignified, never bouncy): the load arrives and SAGS, it does not spring
// back; the hold is a muscle working (a slow tire and re-hitch, a fine tremor); the lower is gravity started and muscle braked, slower
// than the raise, the hand trailing.
//
// Pure (no imports). Everything is a closed-form function of the point's own clock u (s since the raise) and her clock t: deterministic,
// frame-rate free, no state to reset, and EXACTLY zero at the point's end (every term is windowed to finish by the lower's last frame), so
// the walk home starts on the shipped pose. brooder.js poseAll / poseClaws / poseEyes apply it while L.pointPh > 1 (raise, hold, lower).
//
//   e0..e1, w0..w1  the elbow's and the wrist's unfold windows, fractions of POINT.raiseT (the shoulder runs 0..1 on pointK): the hand
//                   unfolds behind the merus, the wrist last (the aim bar reads the palm from pointK 0.95, ~0.87 raiseT: they are ~93% /
//                   ~80% there by then)
//   gather, gT      the gather (rad, s): the elbow folds the hand in a little more before the lift (it starts flexed before her mouth)
//   eOver, wOver, oT  the hand's arrival (rad, s): the elbow and the wrist carry a little past straight and settle (no bounce back)
//   sag, sagT       the load arriving (rad, s): the shoulder sinks ~2 deg just after the apex and recovers over ~1.5 s
//   drift           the share of her idle drift (poseClaws dz/dy) kept on the reach in the hold (the shipped lerp erased all of it)
//   hitch, hitchP   the hold's micro-adjust (rad, s): the reach tires (a slow sink) and is hitched back up, about every hitchP s
//   trem, tremF     a fine tremor under the load (rad, Hz), breathing in and out
//   fGather, fOpen, fOver, fWork, fLow, fQ  the finger (rad, absolute): shut in for the lift, opened late in the unfold to a moderate gape
//                   (crayfish: moderately separated; CHELA.open is 1.35), a slow partial close and re-open mid-hold, a faint quiver, closed
//                   to rest early in the lower
//   droop, refold   the lower: the hand hangs as the shoulder lets it down (rad), the elbow refolds once refold of the lower has run
//   lift, dip, rear, list, land  her body (lift / dip / land in R; rear / list rad): it loads (dips) before the lift, rises high on the legs
//                   and rears its front with the claw up (Kravitz), lists a little to the claw's side under the load, and settles as the
//                   claw comes home. The planted feet's IK makes the legs brace for it
//   minor           the cutter draws in and down, a guard, while the crusher is up (0 = as shipped)
//   brace           (R) early in the raise she steps her front foot on the claw's side out by this (and forward 0.4 of it), a low
//                   deliberate step that widens her base under the load (brooder.js's feet loop; 0 = none)
//   on              1; 0 = the shipped rigid reach (the lab A/B), at POINT's timings
export const REACH = {
  on: 1,
  e0: 0.18, e1: 0.98, w0: 0.32, w1: 1.10,
  gather: 0.14, gT: 0.55,
  eOver: 0.035, wOver: 0.08, oT: 0.22,
  sag: 0.035, sagT: 0.38,
  drift: 0.4,
  hitch: 0.016, hitchP: 1.7,
  trem: 0.0035, tremF: 7.3,
  fGather: 0.18, fOpen: 0.85, fOver: 0.06, fWork: 0.22, fLow: 0.32, fQ: 0.012,
  droop: 0.16, refold: 0.35,
  lift: 0.028, dip: 0.012, rear: 0.035, list: 0.018, land: 0.010,
  minor: 1, brace: 0.07
};

const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const ease = x => x * x * (3 - 2 * x);
const sst = (a, b, x) => ease(clamp01((x - a) / (b - a)));
// a smooth hump, 0 at a and b, 1 midway
const bump = (a, b, x) => { const s = Math.sin(Math.PI * clamp01((x - a) / (b - a))); return s * s; };
// an arrival: 0 at x <= 0, peaks at 1 when x = T, decays (x/T) e^(1 - x/T)
const arrive = (x, T) => x <= 0 ? 0 : (x / T) * Math.exp(1 - x / T);
// the hold's tire-and-hitch, one cycle on p in [0, 1): a slow sink to -1, then a quick lift back to 0 (continuous at the wrap)
const tire = p => p < 0.8 ? -ease(p / 0.8) : -(1 - ease((p - 0.8) / 0.2));

// This frame's offsets, into o (allocated once by the caller). u: s since the raise; P: brooder.js POINT (raiseT, holdT, lowerT); t: her clock.
//   kE, kW     the elbow's / wrist's share of the reach (tuckJoint blend; the shoulder's is pointK)
//   rz, ry     the shoulder's offsets (rad); drift the share of the idle drift added back
//   ey         the elbow's extra inward fold (unsigned; poseClaws mirrors); ez, wz the elbow / wrist pitch offsets
//   f, kF      the finger's target (rad) and its blend over the idle finger
//   lift, pit, rol  her body: lift in R, pitch (+ = front down) and roll (- = her +X side, the claw's, down) in rad
//   mk         the minor's draw-in 0..1; look 0..1 her eyes on the opening
export function reach(u, P, t, o) {
  const X = REACH, R = P.raiseT, t3 = R + P.holdT, Lo = P.lowerT, t4 = t3 + Lo;
  // the hold's window: on after the arrival, off as the lower starts
  const hk = sst(R + 0.2, R + 0.8, u) * (1 - sst(t3 - 0.2, t3 + 0.3, u));
  // the unfold (and the refold, trailing the shoulder, the wrist last; both done by t4)
  o.kE = sst(X.e0 * R, X.e1 * R, u) * (1 - sst(t3 + X.refold * Lo, t4, u));
  o.kW = sst(X.w0 * R, X.w1 * R, u) * (1 - sst(t3 + (X.refold + 0.2) * Lo, t4, u));
  const g = bump(0, X.gT, u);
  o.ey = X.gather * g;
  const out = 1 - sst(t3, t3 + 0.5, u);                                  // the arrival's and the sag's tails, gone by the lower
  o.ez = X.eOver * arrive(u - X.e1 * R, X.oT) * out;
  o.wz = X.wOver * arrive(u - X.w1 * R, X.oT) * out - X.droop * bump(t3 + 0.1 * Lo, t4, u);
  // the shoulder: the gather's small dip, the load's sag, the tire-and-hitch, the tremor
  const sag = -X.sag * arrive(u - 0.85 * R, X.sagT) * out;
  const ph = (u - R) / X.hitchP + 0.12 * Math.sin(u * 0.9);              // monotonic: d/du >= 1/1.7 - 0.108 > 0
  const hitch = X.hitch * tire(ph - Math.floor(ph)) * hk;
  const tr = X.trem * hk * (0.6 + 0.4 * Math.sin(t * 2.7 + 1));
  o.rz = -0.03 * g + sag + hitch + tr * Math.sin(t * 6.2832 * X.tremF);
  o.ry = 0.6 * tr * Math.sin(t * 6.2832 * X.tremF * 0.83 + 2);
  o.drift = X.drift * sst(0.6 * R, R + 0.6, u) * (1 - sst(t3, t3 + 0.6, u));
  // the finger: shut in for the lift, open late in the unfold (a little past, settling), worked in the hold, relaxed shut early in the lower
  let f = X.fGather + (X.fOpen - X.fGather) * sst(0.45 * R, 1.05 * R, u) + X.fOver * arrive(u - 1.05 * R, 0.3) * out;
  f -= X.fWork * bump(R + 0.7, R + 2.3, u);
  f += X.fQ * hk * Math.sin(t * 31) * Math.sin(t * 7.7);
  f += (X.fLow - f) * sst(t3, t3 + 0.45 * Lo, u);
  o.f = f;
  o.kF = sst(0, 0.3 * R, u) * (1 - sst(t3 + 0.5 * Lo, t4, u));
  // her body: loads, rises high on the legs and rears with the claw up, lists to it under the load, nods with the sag, settles as it lands
  const bk = sst(0.15 * R, R + 0.5, u) * (1 - sst(t3 + 0.15 * Lo, t4, u));
  o.lift = X.lift * bk - X.dip * bump(0, 0.6, u) - X.land * bump(t4 - 0.6, t4, u);
  o.pit = -X.rear * bk - 0.35 * sag - 0.2 * hitch;
  o.rol = -X.list * bk + 0.25 * hitch;
  o.mk = X.minor * bk;
  return o;
}
