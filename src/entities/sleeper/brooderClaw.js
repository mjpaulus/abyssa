// THE CRUSHER, ALIVE (clawfix 2026-10-13, reviews/claw-audit.md; Michael: "velkath's claw strikes are very
// stiff, the pincher doesnt move, just feels like a straight stick"). Velkath's hammer as a decapod cheliped
// strikes: the merus (shoulder) leads, the carpus (elbow) and propodus (palm) trail it, and the dactyl (the
// moving finger) has its own beat. The shipped arm drove every joint off the same two curves on the same frame,
// and the elbow's and wrist's pitch terms cancelled, so the palm held ~31 deg to the merus through the whole
// blow (a rod on a pin), and the finger was parked open by the threat and closed with the fall.
//
// Pure (no imports): brooder.js poseClaws applies it to the major claw; tools/bench/claw-sim.mjs runs it offline.
// Everything here is an OFFSET on the shipped pose, and every offset is gone by the frame the hit test can
// first run (L.swing > 0.85) and stays gone until it can no longer run: the blow lands on the shipped pose, so
// the hit frame, the hinge's path through the hit and the reach are the shipped ones (riteplay measured her
// difficulty on them).
export const PH_COCK0 = 0.40, PH_COCK1 = 0.72, PH_SLAM0 = 0.84, PH_SLAM1 = 0.90;   // hammer cycle phases

// THE ARM (the joints' own offsets, rad; positive z = up, the side bends fold the hand in across her face)
//   wE/zE, wW/zW  the wind-up: the elbow and the wrist ride springs on the shoulder's cock, so they start late,
//                 overshoot at the top and settle in the hold (the wrist later and looser than the elbow)
//   eUp, wBack    the cocked pose: the elbow bends further up, the wrist cocks BACK (the shipped -0.25 cock on the
//                 wrist cancelled the elbow's +0.25: the palm stayed level with the merus)
//   foldE, foldW  the side bends: the hand tucks in as it cocks and unfolds into the blow (the elbow's; folded at
//                 the wrist too, the open pincer turned edge-on to a diver in front of her: it is held up OPEN at him)
//   pE, pW, xHit  the fall: the share of the cock the elbow / wrist still hold = 1 - u^p, u the fall's progress
//                 reaching 1 at xHit of it (the shoulder lets go at once): the palm stays cocked back while the
//                 merus comes down, then whips through, all of it home before the hit window
//   dE, dW, kRec  the recoil: the elbow and the palm get the shoulder's bounce dE / dW s late, in world pitch
//                 (kRec of it): the hand drags, then flicks up past the merus and settles
//   apex          the shoulder's cock lowered by this (rad; 0.55 shipped) so more of the wind-up is in his lens
//   gate          every offset fades out as L.swing rises through gate[0]..gate[1]: home before the claw can meet the
//                 sand (the floor clamp's first contact, ~0.8 on flat ground) and the hit test (0.85)
//   on            1; 0 = the shipped rod (lab A/B: tools/bench/claw-pose-probe.mjs)
export const WHIP = {
  on: 1,
  wE: 9, zE: 0.5, wW: 6.5, zW: 0.38,
  eUp: 0.12, wBack: 0.55, foldE: 0.15, foldW: 0,
  pE: 2.0, pW: 3.4, xHit: 0.85,
  dE: 0.035, dW: 0.075, kRec: 1,
  apex: 0,
  gate: [0.45, 0.75]
};

// THE FINGER (rad): its own channel, keyed to the blow (hamPh, impT), not parked open by the threat. A small
// gape at rest; it opens ahead of the rise and stays open through the hold (trembling, `quiver`) and the fall;
// from the landing frame it SNAPS shut onto the fixed finger (aimed `past` it until it hits, so it arrives fast:
// ~54, 25, 9 deg), rebounds ~9 deg and re-seats by ~frame 10 (the clack, counted once a blow in L.clackN), is
// held shut through the pin (`holdT`, the crush) and lets go late in the recoil (`relT`).
//   open 1.35, not 1.6: past ~90 deg the knuckle shows out of its socket. shut 0.15: the crusher's biting
//   edges meet at ~0.14, its base molars at ~0.48 (overlapping a little below 0.25 reads as molars biting).
//   minor: the cutter never strikes; its tall fangs cut through its own finger below ~26 deg, so it never
//   closes past `minor` (awake; asleep it is folded under her brow, DORM). on: 0 = the shipped finger (lab A/B).
export const CHELA = {
  on: 1, rest: 0.45, open: 1.35, shut: 0.15, past: 0.4, wOpen: 9, zOpen: 0.8, wSnap: 45, zSnap: 0.4, wSeat: 30, zSeat: 0.3,
  bounce: 0.4, holdT: 0.28, relT: 0.45, quiver: 0.035, minor: 0.455
};

const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const ease = x => x * x * (3 - 2 * x);
const sstep = (a, b, x) => ease(clamp01((x - a) / (b - a)));
// implicit damped spring on a {x, v} pair (brooder.js's own): stable for any w*dt, overshoots for z < 1
function spr(o, target, w, z, dt) {
  o.v = (o.v + w * w * dt * (target - o.x)) / (1 + 2 * z * w * dt + w * w * dt * dt);
  o.x += o.v * dt;
  return o.x;
}
// the hammer's recoil as brooder.js runs it (pinned 0.10 s, then one damped bounce), at impT
export function bounce(impT) { const k = impT - 0.10; return k < 0 ? 1 : Math.exp(-4.5 * k) * Math.cos(7 * k); }

// The arm's offsets for this frame, into c.wh (no allocation after the first call):
//   rz (shoulder pitch), ez / wz (elbow / wrist pitch), ey / wy (elbow / wrist fold, unsigned: poseClaws mirrors)
export function whip(c, L, th, dt) {
  const W = WHIP;
  const s = c.wh || (c.wh = { cE: { x: 0, v: 0 }, cW: { x: 0, v: 0 }, fall: false, cE0: 0, cW0: 0, rz: 0, ez: 0, wz: 0, ey: 0, wy: 0, G: 1 });
  const ph = L.hamPh, ck = L.cock * th, sw = L.swing * th;
  const falling = ph >= PH_SLAM0 && ph < PH_SLAM1;
  let cE, cW;
  if (falling) {
    // the fall: the shoulder lets go of its cock at once (1 - x^1.6); the elbow and the wrist hold theirs and
    // let go late, the wrist last (the whip), all of it spent at u = 1
    if (!s.fall) { s.fall = true; s.cE0 = s.cE.x; s.cW0 = s.cW.x; }
    const u = clamp01((ph - PH_SLAM0) / (PH_SLAM1 - PH_SLAM0) / W.xHit);
    cE = s.cE0 * (1 - Math.pow(u, W.pE)); cW = s.cW0 * (1 - Math.pow(u, W.pW));
    s.cE.x = cE; s.cE.v = 0; s.cW.x = cW; s.cW.v = 0;
  } else {
    s.fall = false;
    cE = spr(s.cE, ck, W.wE, W.zE, dt); cW = spr(s.cW, ck, W.wW, W.zW, dt);
  }
  // the recoil: each joint's own copy of the shoulder's bounce, later down the arm (world pitch: the carpus
  // carries 1.10 of the swing, the palm 0.90, the shoulder 0.85)
  let lE = 0, lW = 0;
  if (!falling && L.impT < 3) { lE = W.kRec * (th * bounce(L.impT - W.dE) - sw); lW = W.kRec * (th * bounce(L.impT - W.dW) - sw); }
  const G = W.on * (1 - sstep(W.gate[0], W.gate[1], L.swing));
  s.G = G;
  s.rz = -G * W.apex * ck;
  s.ez = G * ((0.25 + W.eUp) * cE - 0.25 * ck - 1.10 * lE);
  s.wz = G * (W.wBack * cW + 0.25 * ck - 0.90 * lW + 1.10 * lE);
  s.ey = G * W.foldE * cE;
  s.wy = G * W.foldW * cW;
  return s;
}

function chelaAim(L) {
  const C = CHELA, ph = L.hamPh, k = L.impT;
  if (k >= 0 && k < C.holdT) return C.shut;                                                    // bitten shut: the pin, the crush
  if (k >= C.holdT && k < C.holdT + C.relT) return C.shut + (C.rest - C.shut) * ease((k - C.holdT) / C.relT);   // let go, late
  if (ph < PH_COCK0) return C.rest;
  return C.rest + (C.open - C.rest) * sstep(PH_COCK0, PH_COCK0 + 0.6 * (PH_COCK1 - PH_COCK0), ph);   // opens ahead of the rise, open to the landing
}
// The major claw's moving finger (rad, before the ward flinch). gape/snap: poseClaws's idle working noise;
// hold: 1 while the cocked claw trembles at the top. State on the claw (c.fs, c.fHit).
export function chela(c, L, th, gape, snap, hold, t, dt) {
  const C = CHELA, s = c.fs || (c.fs = { x: 0.08, v: 0 });
  if (!C.on) return 0.08 + 0.20 * gape + snap + th * (1 - 0.9 * L.swing * th) + 0.35 * L.cock * th;   // as shipped
  const biting = th > 0.5 && L.impT >= 0 && L.impT < C.holdT;
  if (!biting) c.fHit = false;
  let aim = 0.08 + 0.20 * gape + snap, w = C.wOpen, z = C.zOpen;
  aim += (chelaAim(L) - aim) * th;
  // the snap: aimed PAST the fixed finger until it hits (so it arrives fast), then AT it (so the rebound opens it)
  if (biting) { aim = c.fHit ? C.shut : C.shut - C.past; w = c.fHit ? C.wSeat : C.wSnap; z = c.fHit ? C.zSeat : C.zSnap; }
  spr(s, aim, w, z, dt);
  if (biting && s.x < C.shut && s.v < 0) {                       // the clack: it stops on the fixed finger and rebounds
    s.x = C.shut; s.v *= -C.bounce;
    if (!c.fHit) { c.fHit = true; L.clackN = (L.clackN | 0) + 1; }   // once a blow (a spring pressed into the stop chatters)
  }
  return s.x + 0.06 * (gape - 0.5) * th + hold * th * C.quiver * Math.sin(t * 61) * Math.sin(t * 9.1);
}
