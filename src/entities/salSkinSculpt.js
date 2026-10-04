// SAL, SKINNED — the Mark V hard-hat diver as a man in a dress, not a robot in tubes.
// Sculpt specs for the sculpt pipeline (lib/sculpt.js + tools/blender), baked by
//
//   node tools/blender/build.mjs salSkin      -> assets/salskin/   (re-run after any rig change)
//
// WHY (Michael, 2026-10-01): "you can make his model more realistic. just looks robotic".
// The rigid build (salSculpt.js, still shipped as the second fallback) was tube segments
// with ball joints: nothing ever deformed, every limb was a lathe, the folds never moved.
// Here the DRESS is one continuous skinned garment — trunk + both trouser legs in one mesh,
// a sleeve each side — bound to diver.js's own rig groups (salInstall.js maps the names),
// weighted in Blender (bone heat from an armature generated out of the rig's lengths, then
// cleaned), and it CREASES WITH THE POSE: a second normal map (the "wrinkle" map, baked from
// the same dress with deep compression gathers sculpted into the inside of every joint) is
// blended in per joint by the live bend angle (salInstall.js, SKIN_*), and the stretched
// outside of a bend flattens its folds.
//
// What stays RIGID (hard parts ride their bone): the helmet (unchanged — it was a win), the
// breastplate (now the plain US Navy Mark V corselet: brails, wing nuts, the rubber bib;
// the chest lead and harness of the old build are British-pattern and gone), the weight
// BELT with its lead (Mark V: the lead rides the belt, which hangs from the breastplate and
// is held down by a crotch strap — the strap is part of the skinned dress), the pack, the
// boots, and the HANDS: bare, working hands coming out of clamped rubber wrist cuffs
// (period-correct and far more human than a rubber mitten).
//
// FRAMES. The dress is authored in the HIPS group's frame (diver.js hips; +Y up, +Z front,
// +X the diver's left) in the rig's REST pose (every rotation zero: legs and arms hanging
// straight down), which is exactly the frame salInstall.js binds it in. Rigid pieces are in
// their own group's frame as before. All rig numbers are PARSED out of diver.js (salSculpt
// readRig) — change a length there, re-run the one command.
//
// SETS: helm 2048 (helmet, corselet) | dress 2048 (trunk, sleeveL, sleeveR; + wrinkle map)
//       gear 1024 (belt, pack, handL, handR, boot)
import {
  readRig, profOf, M, METAL, PAINT, metalEmit, helmetSpec, corseletSpec, packSpec, fbm, vn, isM, HELM_CAV, HELM_PORT0,
  Sph, E, Box, Cap, Cone, Tor, U, Sub, I, Xf, Pl, Fn, Disp, yTo, zTo, eul, norm, add, sub, cross, dot, crPts, Path, Ring,
  polySDF, smoothProf, Lathe, Slab, Band, Hex, Buckle, ETor, crease, win, folds, clamp, sst, gau, TAU, compile
} from './salSculpt.js';

const PROC = globalThis.process && process.versions && process.versions.node ? { fs: await import('fs') } : {};

// material ids beyond salSculpt's (paint only; metalness 0)
M.SKIN = 13; M.NAIL = 14; M.PATCH = 15; M.CORD = 16;

const FRONT = Math.PI / 2, BACK = -Math.PI / 2, INB = Math.PI, OUTB = 0;
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
// signed angular distance a - b, wrapped to (-PI, PI]
const dAng = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d <= -Math.PI) d += TAU; return d; };
const lobe = (th, c, w) => gau(dAng(th, c) / w);          // a gaussian lobe round the limb

// ------------------------------------------------------------------------------------------
// THE BODY PLAN read off the rig (hips frame, rest pose)
// ------------------------------------------------------------------------------------------
export function plan(rig) {
  const lg = rig.legL, am = rig.armL;
  const P = {
    hipX: lg.x, up: lg.up, lo: lg.lo, lr: lg.r, L: lg.up + lg.lo, sole: rig.soleY,
    spY: rig.spineY, neckY: rig.spineY + rig.neckY,
    shX: am.x, shY: rig.spineY + am.y, aUp: am.up, aLo: am.lo, ar: am.r, aL: am.up + am.lo,
    Pth: profOf(rig.P.thigh), Psh: profOf(rig.P.shank), Pua: profOf(rig.P.upArm), Pfa: profOf(rig.P.foreArm)
  };
  // (salprop) the corselet is shrunk by HELM_S about the shoulder line (spine y CORS_Y): a
  // spine-frame point under the brass maps y -> CORS_Y + S (y - CORS_Y), r -> S r
  P.hS = rig.helmS || 1; P.corsY = rig.corsY != null ? rig.corsY : 0.615;
  P.cy = y => P.corsY + P.hS * (y - P.corsY);          // spine-frame height under the shrink
  P.skirtY = P.cy(0.395);                              // the breastplate's skirt (spine frame)
  P.studY = P.cy(0.425);                               // the brail studs the suspenders hook on
  // the weight belt (rigid, hips frame): its centre line, height and the dress radius under it
  P.beltY = P.spY + 0.07; P.beltH = 0.15; P.beltRx = 0.372; P.beltZr = 0.86;
  // the boot SHAFT (leather, laced, part of the dress mesh, riding the SHIN: the rig's ankle
  // sits down in the boot, 0.15 over the sole, so the shaft cannot ride the foot — a pitched
  // foot would swing it through the trouser). Its top is ~0.40 over the sole, as the shoe was.
  P.shaftTop = Math.max(0.12, 0.40 + P.sole);      // above the ankle pivot
  P.shaftR = 0.126;
  P.inBoot = P.L - P.shaftTop;                     // u where the trouser goes into the boot
  return P;
}

// ------------------------------------------------------------------------------------------
// THE DRESS
// ------------------------------------------------------------------------------------------
// TRUNK PROFILE (hips frame): [y, x-radius, z/x ratio]. Hidden under the breastplate above
// its skirt (spine 0.395 = hips 0.595); BLOUSED out under the skirt (air and slack canvas),
// cinched hard under the belt, full again over the hips, closing between the legs.
function trunkProfile(P) {
  const b = P.beltY, S = P.hS, cy = P.cy;
  // (salprop) everything up under the brass shrinks with it; the blouse below the skirt is
  // drawn in a little (it may stand a hair proud of the smaller skirt — slack canvas does)
  const bl = 1 - 0.55 * (1 - S);
  return [
    [P.spY + cy(0.80), 0.30 * S, 0.80], [P.spY + cy(0.70), 0.46 * S, 0.80], [P.spY + cy(0.55), 0.505 * S, 0.78], [P.spY + cy(0.40), 0.51 * S, 0.78],
    [P.spY + 0.31, 0.495 * bl, 0.80], [P.spY + 0.235, 0.455 * (1 - 0.3 * (1 - S)), 0.81], [b + P.beltH / 2 + 0.01, 0.392, 0.84], [b, P.beltRx - 0.016, P.beltZr],
    [b - P.beltH / 2 - 0.01, 0.378, 0.84], [P.spY - 0.07, 0.402, 0.79], [-0.02, 0.405, 0.75], [-0.13, 0.385, 0.72],
    [-0.22, 0.30, 0.70], [-0.27, 0.12, 0.70], [-0.285, 0.0, 0.70]
  ];
}
function interp(T, y, k) {
  if (y >= T[0][0]) return T[0][k];
  for (let i = 1; i < T.length; i++) if (y >= T[i][0]) {
    const u = (y - T[i][0]) / (T[i - 1][0] - T[i][0]), s = u * u * (3 - 2 * u);
    return T[i][k] + (T[i - 1][k] - T[i][k]) * s;
  }
  return T[T.length - 1][k];
}

// LEG base radius along u (0 at the hip joint, L at the ankle pivot): the rig's thigh and
// shank profiles, cut BAGGY (canvas over a man's leg, not a sleeve on a tube), a little
// extra cloth bagged at the knee, drawn in by the boot over the last few inches
function legRb(P, u) {
  const t = clamp(u, 0, P.L);
  const rT = P.lr * P.Pth(clamp(t / P.up, 0, 1)) * 1.10, rS = P.lr * P.Psh(clamp((t - P.up) / P.lo, 0, 1)) * 1.06;
  const r = rT + (rS - rT) * sst(P.up - 0.07, P.up + 0.07, t);
  // drawn in to go into the boot: the canvas is gathered by the lacing into the shaft
  const rIn = P.shaftR - 0.016;
  return r + (Math.min(r, rIn) - r) * sst(P.inBoot - 0.16, P.inBoot + 0.02, t);
}
function armRb(P, u) {
  const t = clamp(u, 0, P.aL);
  const rU = P.ar * P.Pua(clamp(t / P.aUp, 0, 1)) * 1.10, rF = P.ar * P.Pfa(clamp((t - P.aUp) / P.aLo, 0, 1)) * 1.07;
  return rU + (rF - rU) * sst(P.aUp - 0.06, P.aUp + 0.06, t);
}

// FOLDS AT REST (geometry in the low mesh + finer copies in the bake). th is round the limb:
// 0 outboard, PI/2 front, PI inboard, -PI/2 back. s = +1 left, -1 right (asymmetry: seeds,
// phases and amplitudes differ side to side — no two legs of a worn dress hang alike).
// Heavy rubberised twill does not ripple: it hangs in a FEW broad soft folds, buckles into
// three or four big irregular stacks where it is pushed (the ankle, the wrist) and keeps a
// handful of memory creases where it has been bent ten thousand times (behind the knee, in
// the crook of the elbow). Ring patterns are what made the old build read as a Michelin
// man, so every family here is broken up: noisy phase, depth that comes and goes, spirals.
// bfold: one family of folds across a limb. u along it, th round it, lam its spacing along
// u, tw how much it spirals (radians of th per wavelength), sd seed
function bfold(u, th, lam, tw, sd) {
  const w = 3.2 * (vn(Math.cos(th) * 1.3 + 3, Math.sin(th) * 1.3, u * 2.2 / lam * 0.25, sd) - 0.5);
  const dep = sst(0.18, 0.62, vn(Math.cos(th) * 1.9, Math.sin(th) * 1.9 + 7, u * 0.9 / lam, sd + 5));
  return dep * crease(TAU * u / lam + tw * th + w);
}
// a broad hanging drape: n folds round the limb, each a long soft ridge that wanders
function drape(u, th, n, sd) {
  const w = 1.6 * (vn(u * 2.5, Math.cos(th), Math.sin(th), sd) - 0.5) + 0.5 * Math.sin(u * 3.1 + sd);
  return crease(n * th + w) * (0.55 + 0.45 * vn(u * 4, Math.cos(th) * 2, Math.sin(th) * 2, sd + 3));
}
function legFolds(P, s) {
  const sd = s > 0 ? 11 : 23, a = s > 0 ? 1 : 1.12, up = P.up, L = P.L;
  return (th, y) => {
    const u = -y;
    let o = 0;
    // the drape: four soft ridges down the leg, fading out at the knee where the bag is
    o += 0.0060 * a * drape(u, th, 4, sd) * win(-u, -0.08, -L + 0.12, 0.08) * (1 - 0.6 * gau((u - up) / 0.09));
    // diagonal pull folds from the crotch down the inner thigh toward the outside of the knee
    o += 0.0055 * a * win(-u, -0.02, -up + 0.06, 0.06) * Math.pow(0.5 + 0.5 * Math.cos(th - INB + 0.4), 1.4)
      * crease(TAU * (u * 0.9 - 0.11 * (th - INB)) / 0.11 + 2 * (vn(u * 6, th, 1, sd + 9) - 0.5));
    // the canvas's own creasing all down the leg: medium, irregular, mostly across it — the
    // rubber coat keeps every fold it was ever pushed into
    o += 0.0040 * a * bfold(u, th, 0.085, 1.1, sd + 4) * win(-u, -0.04, -L + 0.06, 0.06);
    // memory creases behind the knee
    o += 0.0045 * a * gau((u - up) / 0.075) * Math.pow(0.5 + 0.5 * Math.cos(th - BACK), 1.4) * bfold(u, th, 0.048, 0.7, sd + 1);
    // bagged knee: slack canvas standing proud of the knee cap, more so on the right (worn)
    o += (0.013 + 0.004 * (s < 0)) * gau((u - up + 0.01) / 0.08) * Math.pow(0.5 + 0.5 * Math.cos(th - FRONT), 1.6);
    // the trouser STACKED over the boot top: three or four big buckles that spiral and slump
    const st = win(-u, -P.inBoot + 0.17, -P.inBoot - 0.03, 0.05);
    o += 0.0105 * a * st * (0.6 + 0.4 * Math.pow(0.5 + 0.5 * Math.cos(th - FRONT), 1)) * bfold(u, th, 0.070, 1.6, sd + 2);
    o += 0.006 * st;
    // the seat and the backs of the thighs sag
    o += 0.010 * gau((u - 0.06) / 0.09) * Math.pow(0.5 + 0.5 * Math.cos(th - BACK), 2);
    // calf LACING (Mark V legs are laced up the back of the calf to keep the air out of
    // the legs): the canvas is drawn in along the lacing and pleats run into it
    const lw = win(-u, -up - 0.10, -P.inBoot + 0.18, 0.04);
    if (lw > 0) {
      const d = dAng(th, BACK);
      o -= 0.011 * lw * gau(d / 0.22);
      o += 0.0040 * lw * gau(d / 0.55) * crease(d * 22 + 2.5 * Math.sin(u * 9 + sd));
    }
    return o;
  };
}
function armFolds(P, s) {
  const sd = s > 0 ? 31 : 47, a = s > 0 ? 1 : 0.9, up = P.aUp, L = P.aL;
  return (th, y) => {
    const u = -y;
    let o = 0.0045 * a * drape(u, th, 3, sd) * win(-u, -0.06, -L + 0.10, 0.08);
    o += 0.0032 * a * bfold(u, th, 0.075, 1.3, sd + 4) * win(-u, -0.04, -L + 0.06, 0.06);
    // the crook of the elbow: a few memory creases
    o += 0.0050 * a * gau((u - up) / 0.07) * Math.pow(0.5 + 0.5 * Math.cos(th - FRONT), 1.3) * bfold(u, th, 0.042, 0.8, sd + 1);
    // slack at the point of the elbow
    o += 0.009 * gau((u - up) / 0.07) * Math.pow(0.5 + 0.5 * Math.cos(th - BACK), 1.5);
    // bunched into the cuff: two or three big buckles
    const st = sst(L - 0.20, L - 0.10, u);
    o += 0.0080 * a * st * bfold(u, th, 0.055, 1.4, sd + 2) + 0.004 * st;
    return o;
  };
}
// the trunk: canvas BLOUSING over the belt (V folds converging into it from above and
// puckers below it), and the slack round the hips
function trunkMod(P) {
  const b = P.beltY, top = b + P.beltH / 2, bot = b - P.beltH / 2;
  return (th, y) => {
    let o = 0;
    const wA = win(y, P.spY + P.skirtY - 0.035, top - 0.005, 0.03);
    if (wA > 0) {
      const g = sst(P.spY + P.skirtY - 0.035, top + 0.02, y);
      const k = 1 - g;
      o += 0.014 * wA * (0.35 + 0.65 * k) * drape(y * 1.5, th, 8, 61);
      o += 0.010 * wA * k;                   // overhang: the blouse rolls out over the belt
    }
    const wB = win(y, bot + 0.005, -0.10, 0.03);
    if (wB > 0) o += 0.007 * wB * sst(-0.10, bot, y) * drape(y * 2, th, 10, 67);
    // the seat sags low (behind, below the belt)
    o += 0.016 * gau((y + 0.14) / 0.10) * Math.pow(Math.max(0, -Math.sin(th)), 2);
    return o;
  };
}

// trunk field: a lathe with a section that changes from deep-chested to flat-hipped
function trunkField(P) {
  const T = trunkProfile(P), mod = trunkMod(P), y0 = T[T.length - 1][0], y1 = T[0][0];
  return Fn([-0.60, y0 - 0.03, -0.50, 0.60, y1 + 0.03, 0.50], (x, y, z) => {
    const yy = clamp(y, y0, y1), rx = interp(T, yy, 1), zr = interp(T, yy, 2);
    const rho = Math.hypot(x, z / zr), th = Math.atan2(z / zr, x);
    let d = (rho - rx - (rx > 0.05 ? mod(th, yy) : 0)) * zr * 0.62;
    const dy = Math.max(y0 - y, y - y1);
    if (dy > 0) d = Math.max(d, 0) + dy;
    return d;
  }, M.CANVAS);
}
// one trouser leg (s = +1 left): a lathe about the leg's axis, closed just below the ankle
// pivot (inside the boot) and above the hip joint (inside the trunk)
function legField(P, s) {
  const prof = [];
  const yT = 0.10, yB = -(P.L + 0.025), n = 90;
  for (let i = 0; i <= n; i++) { const y = yT + (yB - yT) * i / n; prof.push([legRb(P, -y) * (1 - 0.38 * sst(-0.03, yT, y)), y]); }
  const mod = legFolds(P, s);
  return Lathe(prof, M.CANVAS, { c: [s * P.hipX, 0, 0], sz: 0.96, amp: 0.03, lip: 0.55, mod: (th, y) => mod(s > 0 ? th : Math.PI - th, y) });
}
// THE SHOULDER (salfix, 2026-10-04 — Michael: "his arm is floating, not connected at shoulder").
// The sleeve used to close in a cap pinched to 55% of the arm's girth 0.07 BELOW the shoulder
// pivot, trusting the breastplate to hide it. Since salprop shrank the corselet (x0.85) its edge
// sits right ON the pivot (x 0.456 at pivot height against the pivot's 0.46), so nothing covered
// the joint: measured, 50% of the directions out of each shoulder pivot met no dress or brass
// within 0.30 u (76% of the deltoid hemisphere), the arm hung from a tube end beside the brass
// pot, and every lift of the arm (valve check, the haul, the lantern) swung that pinched end out
// into view. The sleeve now ends in a JOINT DOME: a sphere centred on the pivot, a hair wider
// than the arm there, so the upper arm rises into a rounded deltoid that tucks under the brass
// rim, and the dome maps onto itself under any rotation of the arm (the rigid build's joint
// ball, done in canvas) — the shoulder is closed by construction at every angle the rig reaches,
// with no blend zone to pinch or candy-wrap. Below the pivot the tube takes over at its own girth.
const SH_DOME = 0.172;
function sleeveField(P, s) {
  const prof = [], yT = SH_DOME, yB = -(P.aL - 0.075), n = 90;
  for (let i = 0; i <= n; i++) {
    const y = yT + (yB - yT) * i / n;
    const dome = Math.sqrt(Math.max(0, SH_DOME * SH_DOME - y * y));
    prof.push([y >= 0 ? dome : Math.max(armRb(P, -y), dome), y]);
  }
  const mod = armFolds(P, s);
  return Lathe(prof, M.CANVAS, { c: [s * P.shX, P.shY, 0], amp: 0.025, lip: 0.55, mod: (th, y) => mod(s > 0 ? th : Math.PI - th, y) });
}

// the CROTCH STRAP: bridle leather from the belt's front, down between the legs and up
// the seat to the back of the belt, lying on the canvas (flat, a chain of thin boxes)
function crotchStrap(P) {
  const b = P.beltY - P.beltH / 2 + 0.02, T = trunkProfile(P), ch = [];
  const pts = [];
  for (let k = 0; k <= 24; k++) {
    const a = -Math.PI / 2 + Math.PI * k / 24;         // -90 front .. +90 back, round under the crotch
    const yc = b - (b + 0.30) * Math.cos(a) ** 0.8;     // down to the crotch and back up
    const y = Math.max(-0.30, yc);
    const zr = interp(T, clamp(y, -0.285, 1), 2), rx = interp(T, clamp(y, -0.285, 1), 1);
    // on the canvas front and back; under the crotch it runs through the gap between the legs
    const z = -Math.sin(a) * (0.17 + (rx * zr + 0.004 - 0.17) * sst(0.55, 1.25, Math.abs(a)));
    pts.push([0, y, z]);
  }
  const Q = crPts(pts, 30);
  for (let i = 0; i < Q.length - 1; i++) {
    const A = Q[i], B = Q[i + 1], c = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    const Y = norm(sub(B, A)), out = norm([0, c[1] - 0.05, c[2]]);
    const Z = norm(add(out, Y, -(out[0] * Y[0] + out[1] * Y[1] + out[2] * Y[2]))), X = cross(Y, Z);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const R = [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
    ch.push(Box(add(c, Z, 0.004), [0.030, len / 2 + 0.004, 0.0055], 0.003, M.LEATHER, null, R));
  }
  return U(0.002, ...ch);
}

// ---- PATCHES AND REPAIRS (positions in the dress's own frame; mask + edge for paint and the
// bake-only displacement: a second layer of canvas 1.5 mm proud, stitched round its edge)
// limb coordinates of a dress point: which part, u along it, th round it (0 outboard)
function dressCoords(P, x, y, z, o) {
  if (Math.abs(Math.abs(x) - P.shX) < 0.24 && y > P.shY - P.aL - 0.1 && y < P.shY + 0.2 && o.sleeve) {
    const s = x > 0 ? 1 : -1, lx = s * x - P.shX;
    o.part = s > 0 ? 'armL' : 'armR'; o.u = P.shY - y; o.th = Math.atan2(z, lx); o.s = s; return o;
  }
  if (y < -0.05 && Math.abs(x) > 0.02) {
    const s = x > 0 ? 1 : -1, lx = s * x - P.hipX;
    o.part = s > 0 ? 'legL' : 'legR'; o.u = -y; o.th = Math.atan2(z / 0.96, lx); o.s = s; return o;
  }
  o.part = 'trunk'; o.u = y; o.th = Math.atan2(z, x); o.s = x > 0 ? 1 : -1; return o;
}
// [part, u centre, th centre, half-height (u), half-width (radians), corner, kind, rotation]
function patchList(P) {
  return [
    ['legL', P.up - 0.01, FRONT + 0.05, 0.13, 0.95, 0.04, 'knee', 0.0],
    ['legR', P.up + 0.01, FRONT - 0.08, 0.135, 0.98, 0.04, 'knee', 0.03],
    ['legR', P.up * 0.48, FRONT - 0.55, 0.06, 0.42, 0.03, 'rubber', 0.35],     // a vulcanised repair on the right thigh
    ['legL', P.L - 0.36, -0.15, 0.04, 0.35, 0.02, 'canvas', -0.2],              // a darned tear on the left shin, outboard
    ['armL', P.aUp + 0.02, BACK, 0.10, 0.95, 0.03, 'elbow', 0.0],
    ['armR', P.aUp + 0.01, BACK + 0.05, 0.10, 0.92, 0.03, 'elbow', 0.05],
    ['armL', P.aUp + 0.22, FRONT + 0.4, 0.035, 0.38, 0.015, 'canvas', 0.5]      // small forearm patch
  ];
}
const _pc = {};
function patchAt(P, x, y, z, sleeve) {
  const c = dressCoords(P, x, y, z, Object.assign(_pc, { sleeve }));
  let best = { m: 0, e: 1, kind: null };
  for (const q of PATCHES(P)) {
    if (q[0] !== c.part) continue;
    const r = c.part.startsWith('arm') ? armRb(P, c.u) : legRb(P, c.u);
    const du = c.u - q[1], dt = dAng(c.th, q[2]) * r, hw = q[4] * r, cr = Math.cos(q[7]), sr = Math.sin(q[7]);
    const a = du * cr - dt * sr, b = du * sr + dt * cr;
    // rounded rectangle SDF in (u, arc) metres, a little wobble so the cut is by hand
    const wob = 0.004 * Math.sin(a * 60 + q[1] * 9) + 0.003 * Math.sin(b * 47 + 1.3);
    const qx = Math.abs(a) - q[3] + q[5], qy = Math.abs(b) - hw + q[5];
    const sd = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - q[5] + wob;
    if (sd < best.e) best = { m: 1 - sst(-0.002, 0.002, sd), e: sd, kind: q[6] };
  }
  return best;
}
const PCACHE = new WeakMap();
function PATCHES(P) { let v = PCACHE.get(P); if (!v) PCACHE.set(P, v = patchList(P)); return v; }

// fine bake-only layers on the dress: canvas grain, diagonal stress lines, patch layers and
// their stitching, and the wrinkle-map's compression gathers (wrinkle = true)
function dressBake(P, sleeve, seed) {
  const C = {};
  return [
    { type: 'fbm', bake: true, amp: 0.00028, f: 170, oct: 2, seed },
    { type: 'fn', bake: true, amp: 0.0036, fn: (x, y, z) => {
      const c = dressCoords(P, x, y, z, Object.assign(C, { sleeve }));
      // fine creasing: two crossing families of short stress lines, broken up
      const br = sst(0.35, 0.7, vn(x * 9, y * 9, z * 9, seed + 40)), br2 = sst(0.4, 0.75, vn(x * 7 + 3, y * 7, z * 7, seed + 41));
      let o = 0.0011 * br * crease(c.th * 9 + c.u * 55 + 2.2 * Math.sin(c.u * 21 + seed))
        + 0.0009 * br2 * crease(-c.th * 7 + c.u * 80 + 1.7 * Math.sin(c.th * 5 + seed));
      const pt = patchAt(P, x, y, z, sleeve);
      if (pt.m > 0) {
        o += 0.0014 * pt.m;
        // the stitch line, 7 mm in from the edge, dashed
        const st = gau((pt.e + 0.007) / 0.0016) * (0.5 + 0.5 * Math.sign(Math.sin((c.u * 1.3 + c.th * 0.21) * 900)));
        o -= 0.0006 * st;
      }
      return o;
    } }
  ];
}
// THE WRINKLE MAP's extra layer: deep compression gathers on the INSIDE of every joint —
// behind the knee, the crook of the elbow, the front of the hip crease, the belly — the
// folds the dress throws when that joint closes. Baked to its own normal map; the game
// blends it in per joint by the live bend (salInstall.js).
function wrinkleLayer(P, sleeve) {
  const C = {};
  return { type: 'fn', bake: true, amp: 0.016, fn: (x, y, z) => {
    const c = dressCoords(P, x, y, z, Object.assign(C, { sleeve }));
    const sd = c.s > 0 ? 101 : 131;
    let o = 0;
    if (c.part === 'legL' || c.part === 'legR') {
      // knee: stacked gathers behind it, spiralling buckles round the sides
      const k = gau((c.u - P.up) / 0.11), back = Math.pow(0.5 + 0.5 * Math.cos(c.th - BACK), 1.2);
      o += 0.014 * k * back * bfold(c.u, c.th, 0.046, 1.1, sd);
      o += 0.008 * gau((c.u - P.up) / 0.13) * Math.pow(Math.abs(Math.cos(c.th)), 1.5) * bfold(c.u, c.th, 0.065, 2.6, sd + 3);
      // the hip crease: the front of the thigh folds into the belly when he lifts it
      o += 0.012 * gau((c.u - 0.05) / 0.09) * Math.pow(0.5 + 0.5 * Math.cos(c.th - FRONT), 1.5) * bfold(c.u, c.th, 0.055, 1.6, sd + 5);
    } else if (c.part === 'armL' || c.part === 'armR') {
      const k = gau((c.u - P.aUp) / 0.10), fr = Math.pow(0.5 + 0.5 * Math.cos(c.th - FRONT), 1.2);
      o += 0.013 * k * fr * bfold(c.u, c.th, 0.042, 1.2, sd + 7);
    } else {
      // belly (bending forward): folds across the front between belt and breastplate
      const fr = Math.pow(Math.max(0, Math.sin(c.th)), 1.3);
      o += 0.012 * win(c.u, P.spY + P.skirtY - 0.015, P.beltY - 0.06, 0.05) * fr * bfold(c.u, c.th, 0.055, 0.9, sd + 9);
      o += 0.008 * gau((c.u + 0.04) / 0.08) * fr * bfold(c.u, c.th, 0.05, 1.4, sd + 11);
    }
    return o;
  } };
}

// the KNIFE's two retaining straps round the left thigh (diver.js's knife rig rides
// legL.root; its scabbard stays procedural, its straps are the dress's, so they bend with it)
function knifeStraps(P) {
  const ch = [];
  for (const yy of [-0.155, -0.335]) {
    const rb = legRb(P, -yy) + 0.014;
    ch.push(Band(() => rb, yy, 0.040, 0.0055, M.LEATHER, { sz: 0.96, rr: 0.002, rmax: 0.32 }));
    for (const sz of [1, -1]) ch.push(Sph([rb + 0.004, yy, sz * 0.055], 0.012, M.BRASS));
  }
  return Xf([P.hipX, 0, 0], eul(0, 0, 0), U(0.002, ...ch));
}
// the boot SHAFT round one ankle (s = +1 left), in the hips frame, part of the dress mesh
// and weighted to the shin alone: leather, the trouser gathered into its rolled top, an
// ankle strap with its buckle outboard, laced up the front over brass hooks
function shaftSpec(P, s) {
  const T = P.shaftTop, R = P.shaftR, ch = [];
  const prof = [[R, -0.075], [R - 0.002, -0.02], [R - 0.005, 0.06], [R - 0.002, T * 0.6], [R + 0.006, T - 0.03], [R + 0.016, T]];
  ch.push(Disp([{ type: 'fn', bake: true, amp: 0.0012, fn: (x, y, z) => 0.0012 * crease(Math.atan2(z, x) * 5 + y * 90 + 2 * Math.sin(y * 31)) * sst(0.4, 0.8, Math.sin(Math.atan2(z, x) * 3 + y * 13)) }],
    Lathe(smoothProf(prof, 3), M.LEATHER, { sz: 1.0 })));
  ch.push(ETor(R + 0.014, 0.013, T - 0.004, M.LEATHER, 1, 1));
  const ya = 0.02;
  ch.push(Band(() => R + 0.002, ya, 0.034, 0.005, M.LEATHER, { rr: 0.002, rmax: 0.2 }));
  ch.push(Xf([s * (R + 0.008), ya, 0.0], zTo([s, 0, 0], Math.PI / 2), Buckle(0.044, 0.040, 0.0045)));
  // laces: hooks either side of the front seam, crossings between them, tied off at the top
  const nL = 6, y0 = -0.05, y1 = T - 0.035, hx = 0.046, zf = x => Math.sqrt(Math.max(0, R * R - x * x));
  const row = [];
  for (let i = 0; i < nL; i++) row.push(y0 + (y1 - y0) * i / (nL - 1));
  row.forEach((y, i) => {
    for (const sx of [1, -1]) ch.push(Sph([sx * hx, y, zf(hx) + 0.002], 0.0080, M.BRASS));
    if (i < nL - 1) {
      const y2 = row[i + 1];
      ch.push(Path([[-hx, y, zf(hx) + 0.006], [0, (y + y2) / 2, R + 0.008], [hx, y2, zf(hx) + 0.006]], 0.0042, M.CORD, 6));
      ch.push(Path([[hx, y, zf(hx) + 0.006], [0, (y + y2) / 2, R + 0.011], [-hx, y2, zf(hx) + 0.006]], 0.0042, M.CORD, 6));
    }
  });
  const yt = row[nL - 1];
  ch.push(E([0, yt + 0.006, R + 0.012], [0.014, 0.010, 0.010], M.CORD));
  for (const sx of [-1, 1]) ch.push(Path([[0, yt + 0.006, R + 0.014], [sx * 0.03, yt - 0.03, R + 0.02], [sx * 0.04, yt - 0.075, R + 0.012]], 0.0040, M.CORD, 6));
  return Xf([s * P.hipX, -P.L, 0], eul(0, 0, 0), U(0.004, ...ch));
}
function trunkSpec(P, wrinkle) {
  const body = U(0.075, trunkField(P), legField(P, 1), legField(P, -1));
  const L = dressBake(P, false, 3);
  if (wrinkle) L.push(wrinkleLayer(P, false));
  return U(0.003, Disp(L, body), crotchStrap(P), knifeStraps(P), shaftSpec(P, 1), shaftSpec(P, -1));
}
function sleeveSpec(P, s, wrinkle) {
  const L = dressBake(P, true, s > 0 ? 5 : 9);
  if (wrinkle) L.push(wrinkleLayer(P, true));
  return Disp(L, sleeveField(P, s));
}

// ------------------------------------------------------------------------------------------
// THE BELT (hips frame, rigid): Mark V weight belt — heavy bridle leather, lead weights
// riveted on all round, a cast brass frame buckle in front, and the suspender straps that
// hang it from the breastplate's skirt studs
// ------------------------------------------------------------------------------------------
function beltSpec(P) {
  const ch = [], y = P.beltY, h = P.beltH, rx = P.beltRx, zr = P.beltZr;
  ch.push(Band(() => rx, y, h, 0.0075, M.LEATHER, { sz: zr, rr: 0.003, rmax: 0.45 }));
  for (const dy of [-h / 2 + 0.006, h / 2 - 0.006]) ch.push(ETor(rx + 0.002, 0.0075, y + dy, M.LEATHER, 1, zr));
  // LEAD: six cast weights curved to the belt (none over the buckle), bolted through
  const at = (th, r = rx + 0.0075) => [Math.cos(th) * r, Math.sin(th) * r * zr];
  const W = [FRONT - 0.62, FRONT + 0.62, 0.0, Math.PI, BACK - 0.55, BACK + 0.55];
  W.forEach((th, i) => {
    const hw = 0.085, T = 0.024, hh = h * 0.42;
    const f = Fn([-0.6, y - hh - 0.02, -0.6, 0.6, y + hh + 0.02, 0.6], (x, yy, z) => {
      const a = Math.atan2(z / zr, x), rr = Math.hypot(x, z / zr);
      const arc = dAng(a, th) * rx, rad = (rr - (rx + 0.0075 + T / 2)) * zr;
      const qx = Math.abs(arc) - hw + 0.008, qy = Math.abs(yy - y) - hh + 0.008, qz = Math.abs(rad) - T / 2 + 0.006;
      return (Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - 0.006) * 0.8;
    }, M.LEAD);
    ch.push(Disp([{ type: 'pits', bake: true, amp: 0.0006, f: 90, dens: 0.6, r: 0.35, seed: 140 + i }, { type: 'fbm', bake: true, amp: 0.0004, f: 120, oct: 2, seed: 150 + i }], f));
    for (const sx of [-1, 1]) {
      const a2 = th + sx * 0.6 * hw / rx, [px, pz] = at(a2, rx + 0.0075 + 0.024), dir = norm([Math.cos(a2), 0, Math.sin(a2) * zr]);
      ch.push(Xf([px, y, pz], zTo(dir, i), Cap([0, 0, -0.004], [0, 0, 0.004], 0.011, 0.010, M.STEEL)));
    }
  });
  // the buckle, front centre, and the belt's tongue end through it
  const [bx, bz] = at(FRONT, rx + 0.009);
  ch.push(Xf([bx, y, bz], eul(0, 0, 0), Buckle(0.15, h + 0.02, 0.010, M.BRASS, false)));
  ch.push(Cap([bx - 0.055, y, bz + 0.012], [bx + 0.03, y, bz + 0.012], 0.0065, 0.006, M.BRASS));
  ch.push(Box([bx + 0.12, y, bz - 0.006], [0.05, h / 2 - 0.012, 0.006], 0.003, M.LEATHER, [0, -0.25, 0]));
  // SUSPENDERS: four straps up to the breastplate's skirt studs (front and back), each with
  // a brass snap hook at the top
  const T = trunkProfile(P);
  for (const th of [FRONT - 0.42, FRONT + 0.42, BACK - 0.45, BACK + 0.45]) {
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const yy = y + h / 2 - 0.01 + (P.spY + P.studY - 0.035 - (y + h / 2 - 0.01)) * k / 8;
      const r = interp(T, yy, 1) + 0.03 + 0.012 * Math.sin(Math.PI * k / 8), zz = interp(T, yy, 2);
      pts.push([Math.cos(th) * r, yy, Math.sin(th) * r * zz]);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i], B = pts[i + 1], c = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
      const Y = norm(sub(B, A)), out = norm([Math.cos(th), 0, Math.sin(th)]), X = norm(cross(Y, out)), Z = cross(X, Y);
      ch.push(Box(c, [0.022, Math.hypot(...sub(B, A)) / 2 + 0.003, 0.004], 0.002, M.LEATHER, null, [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]]));
    }
    const tp = pts[pts.length - 1];
    ch.push(Xf(tp, zTo(norm([Math.cos(th), 0.2, Math.sin(th)]), 0), Tor([0, 0, 0.004], 0.016, 0.0045, M.BRASS, yTo([1, 0, 0])), Cap([0, -0.02, 0.002], [0, 0.006, 0.004], 0.005, 0.005, M.BRASS)));
  }
  return U(0.003, ...ch);
}

// ------------------------------------------------------------------------------------------
// THE HAND (wrist frame, authored LEFT; the right is the mirror at runtime): a working man's
// bare hand out of a clamped RUBBER WRIST CUFF — the Mark V seal: the sleeve ends in a
// vulcanised rubber cuff, held tight on the wrist by a rolled rubber ring.
// Back of the hand outboard (+X), palm inboard (-X), fingers along -Y, thumb to the front (+Z).
//
// (salprop) THE HAND IS RIGGED. It was one fixed fist closed round a bar, whatever the man
// was doing. Now it is sculpted OPEN (a relaxed hand, fingers a little apart, so bone heat
// cannot bleed one finger into the next) and skinned to 16 finger bones (palm + three per
// finger + three in the thumb, bake.py's bone heat); the game blends four poses by state —
// GRIP (the lantern bail), KNIFE (the hilt), RELAX (an empty hand at his side) and SPREAD
// (sculling, swimming). Why bones, not swapped sculpted variants (evidence):
//   - a variant per pose is a separate DC mesh (different topology), so poses cannot BLEND —
//     every change of state would pop the whole hand, and the knife draw lasts 85 ms;
//   - four variants x two hands would be 8 hand charts in the 1024 gear set (measured on the
//     current pack: the two fists take 9% of it; x4 halves the texel density of every hand);
//   - the bones cost 16 joints x 2 skeletons of palette (two 64-texel bone textures), +0 draws,
//     and postfx.taa.js already writes exact motion vectors for any SkinnedMesh.
// The poses are SOLVED here, not keyed by eye: each finger's flexion is fitted so its joints
// wrap a bar of the right radius at the lantern bail / the knife hilt (meta.hand.poses).
// ------------------------------------------------------------------------------------------
const GRIP = [0.004, -0.200, 0.062];             // the lantern bail's top (diver.js lantPivot + 0.085)
const KNIFE_C = [0.014, -0.206, 0.064];          // the knife hilt's axis (diver.js knifeHeld)
// [name, MCP knuckle, phalanx lengths, radius, rest abduction (rad, + toward the thumb), rest flexion x3]
const FING = [
  ['i', [0.028, -0.152, 0.104], [0.066, 0.041, 0.030], 0.0166, 0.17, [0.18, 0.26, 0.14]],
  ['m', [0.030, -0.158, 0.075], [0.072, 0.045, 0.032], 0.0172, 0.03, [0.20, 0.30, 0.15]],
  ['r', [0.028, -0.154, 0.046], [0.067, 0.043, 0.030], 0.0163, -0.11, [0.23, 0.33, 0.16]],
  ['l', [0.024, -0.143, 0.018], [0.053, 0.033, 0.026], 0.0142, -0.26, [0.27, 0.36, 0.18]]
];
const THUMB = { base: [-0.006, -0.050, 0.082], len: [0.060, 0.048, 0.036], rad: [0.0215, 0.0185, 0.0158],
  dir: [-0.30, -0.80, 0.52], bend: [-0.55, -0.05, -0.83], rest: [0.12, 0.18, 0.14] };
// Rodrigues (v perpendicular to the unit axis a)
const rotP = (v, a, t) => add(v.map(q => q * Math.cos(t)), cross(a, v), Math.sin(t));
const rotA = (v, a, t) => {           // general axis-angle
  const c = Math.cos(t), s = Math.sin(t), d = dot(a, v), x = cross(a, v);
  return [v[0] * c + x[0] * s + a[0] * d * (1 - c), v[1] * c + x[1] * s + a[1] * d * (1 - c), v[2] * c + x[2] * s + a[2] * d * (1 - c)];
};
// a finger's frame: d0 its rest direction (abduction applied), flex axis (curls toward -X)
function fingFrame(f, dAbd = 0) {
  const ab = f[4] + dAbd, d0 = [0, -Math.cos(ab), Math.sin(ab)];
  return { d0, ax: norm(cross(d0, [-1, 0, 0])) };
}
// joint points of a finger at (abduction offset, flexions)
function fingPts(f, dAbd, th) {
  const { d0, ax } = fingFrame(f, dAbd), P = [f[1]];
  let phi = 0;
  for (let k = 0; k < 3; k++) { phi += th[k]; P.push(add(P[k], rotP(d0, ax, phi), f[2][k])); }
  return P;
}
function thumbFrame(dSw = 0) {
  const d0r = norm(THUMB.dir), b = norm(add(THUMB.bend, d0r, -dot(THUMB.bend, d0r)));
  const ax = norm(cross(d0r, b)), sw = norm(cross(d0r, ax));
  return { d0: rotA(d0r, sw, dSw), ax: rotA(ax, sw, dSw), sw };
}
function thumbPts(dSw, th) {
  const { d0, ax } = thumbFrame(dSw), P = [THUMB.base];
  let phi = 0;
  for (let k = 0; k < 3; k++) { phi += th[k]; P.push(add(P[k], rotP(d0, ax, phi), THUMB.len[k])); }
  return P;
}
// THE BONES (hand frame, rest pose): name, parent, head, tail, flex axis, swing axis
export function handBones() {
  const B = [{ name: 'hpalm', head: [0.006, 0.010, 0.040], tail: [0.010, -0.125, 0.062], ax: [0, 0, 1], sw: [1, 0, 0] }];
  for (const f of FING) {
    const P = fingPts(f, 0, f[5]), { ax } = fingFrame(f);
    for (let k = 0; k < 3; k++) B.push({ name: f[0] + (k + 1), parent: k ? f[0] + k : 'hpalm', head: P[k], tail: P[k + 1], ax, sw: [1, 0, 0] });
  }
  const T = thumbPts(0, THUMB.rest), tf = thumbFrame();
  for (let k = 0; k < 3; k++) B.push({ name: 't' + (k + 1), parent: k ? 't' + k : 'hpalm', head: T[k], tail: T[k + 1], ax: tf.ax, sw: tf.sw });
  return B;
}
// POSE SOLVE: the finger's flexions that lay its joints on a circle of radius rc round a bar
// along Z through C (hammer grip). Grid + refine, deterministic.
function wrapFinger(f, C, rc) {
  const dAbd = -f[4] * 0.85, cost = th => {
    const P = fingPts(f, dAbd, th);
    let e = 0;
    for (let k = 1; k <= 3; k++) e += (Math.hypot(P[k][0] - C[0], P[k][1] - C[1]) - rc) ** 2 * (k === 3 ? 1.4 : 1);
    // the tip must come round under the bar onto the palm side, not stop on top of it
    if (P[3][0] > C[0]) e += (P[3][0] - C[0]) ** 2 * 2;
    for (let k = 0; k < 3; k++) if (th[k] < 0.05) e += (0.05 - th[k]) ** 2 * 0.05;   // no hyperextended joint in a fist
    return e;
  };
  let best = null;
  for (let a = 0; a <= 1.9; a += 0.05) for (let b = 0.2; b <= 2.0; b += 0.05) for (let c = 0.1; c <= 1.6; c += 0.05) {
    const e = cost([a, b, c]);
    if (!best || e < best.e) best = { e, th: [a, b, c] };
  }
  let st = 0.025;
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let j = 0; j < 3; j++) for (const sg of [-1, 1]) {
      const th = best.th.slice(); th[j] += sg * st; const e = cost(th);
      if (e < best.e) { best = { e, th }; moved = true; }
    }
    if (!moved) st *= 0.5;
  }
  return { dAbd, th: best.th, err: Math.sqrt(best.e / 3) };
}
function wrapThumb(tip, mid) {
  const cost = q => { const P = thumbPts(q[0], [q[1], q[2], q[3]]); return Math.hypot(...sub(P[3], tip)) ** 2 + 0.4 * Math.hypot(...sub(P[2], mid)) ** 2; };
  let best = { e: 1e9, q: [0, 0.3, 0.3, 0.3] };
  for (let s = -0.6; s <= 0.8; s += 0.1) for (let a = 0; a <= 1.2; a += 0.1) for (let b = 0; b <= 1.4; b += 0.1) for (let c = 0; c <= 1.4; c += 0.1) {
    const e = cost([s, a, b, c]); if (e < best.e) best = { e, q: [s, a, b, c] };
  }
  let st = 0.05;
  for (let it = 0; it < 80; it++) {
    let moved = false;
    for (let j = 0; j < 4; j++) for (const sg of [-1, 1]) { const q = best.q.slice(); q[j] += sg * st; const e = cost(q); if (e < best.e) { best = { e, q }; moved = true; } }
    if (!moved) st *= 0.5;
  }
  return { q: best.q, err: Math.sqrt(best.e) };
}
// A pose = per bone [swing, flex] OFFSETS from the rest pose, in handBones() order
export function handPoses() {
  const out = {}, rest = b => b;
  const fist = (C, rc, tipOff, midOff) => {
    const p = [[0, 0]];
    const errs = [];
    FING.forEach((f, i) => {
      // the little finger closes tighter round the end of the bar (shorter, and the palm tapers)
      const w = wrapFinger(f, [C[0], C[1] + (i === 3 ? 0.012 : 0), C[2]], rc * [1, 1, 0.96, 0.82][i]); errs.push(+w.err.toFixed(4));
      for (let k = 0; k < 3; k++) p.push([k ? 0 : w.dAbd, w.th[k] - f[5][k]]);
    });
    const t = wrapThumb(add(C, tipOff), add(C, midOff)); errs.push(+t.err.toFixed(4));
    for (let k = 0; k < 3; k++) p.push([k ? 0 : t.q[0], t.q[k + 1] - THUMB.rest[k]]);
    return { p, errs };
  };
  const g = fist(GRIP, 0.036, [0.004, 0.012, 0.046], [-0.026, 0.044, 0.050]);
  const k = fist(KNIFE_C, 0.040, [0.006, 0.012, 0.048], [-0.026, 0.044, 0.052]);
  out.grip = g.p; out.knife = k.p; out.fitErr = { grip: g.errs, knife: k.errs };
  // RELAX: an empty working hand at his side — curled a little more than the sculpt, the
  // fingers drawn together, each one a touch further than the last (the little finger most)
  const r = [[0, 0]];
  FING.forEach((f, i) => { const c = 0.10 + 0.05 * i; r.push([-f[4] * 0.45, 0.18 + c], [0, 0.30 + c], [0, 0.16 + c * 0.5]); });
  r.push([0.10, 0.10], [0, 0.18], [0, 0.10]);
  out.relax = r;
  // SPREAD: sculling — the fingers straightened and splayed, the thumb out
  const s = [[0, 0]];
  FING.forEach(f => s.push([f[4] * 0.55 + Math.sign(f[4] || 1) * 0.04, -f[5][0] * 0.9 - 0.05], [0, -f[5][1] * 0.85], [0, -f[5][2] * 0.7]));
  s.push([-0.35, -0.10], [0, -0.15], [0, -0.10]);
  out.spread = s;
  void rest;
  return out;
}

function handSpec(left) {
  const ch = [];
  // ---- CUFF: a rubber tube from under the sleeve's end down onto the wrist, a rolled
  // retaining ring over it, and the cuff's lip turned out at the wrist
  const cuff = [[0.104, 0.115], [0.100, 0.085], [0.088, 0.045], [0.075, 0.015], [0.068, -0.005], [0.066, -0.020]];
  ch.push(Disp([{ type: 'fn', bake: true, amp: 0.0012, fn: (x, y, z) => 0.0012 * crease(Math.atan2(z, x) * 7 + y * 120 + 3 * Math.sin(y * 40)) * sst(0.0, 0.08, y) },
    { type: 'fbm', bake: true, amp: 0.0003, f: 140, oct: 2, seed: left ? 201 : 202 }],
  Lathe(smoothProf(cuff.map(q => [q[0], q[1]]), 3), M.RUBBER, { sz: 0.92 })));
  ch.push(ETor(0.077, 0.0095, 0.028, M.RUBBER, 1, 0.92));                 // the rolled ring
  ch.push(ETor(0.069, 0.0055, -0.016, M.RUBBER, 1, 0.92));                // the cuff's lip
  // ---- THE HAND, open (the rest pose the bones are laid in)
  const H = [];
  H.push(E([0.0, -0.035, 0.024], [0.040, 0.052, 0.046], M.SKIN));                     // wrist + heel
  H.push(Box([0.009, -0.100, 0.061], [0.021, 0.056, 0.050], 0.019, M.SKIN, [0, 0, 0.05]));   // palm
  H.push(E([-0.012, -0.078, 0.080], [0.022, 0.040, 0.026], M.SKIN));                  // thenar pad
  H.push(E([-0.010, -0.112, 0.026], [0.019, 0.044, 0.022], M.SKIN));                  // hypothenar
  const JT = [];                                  // finger joints: [centre, axis] for the creases
  const F = [];
  for (const f of FING) {
    const P = fingPts(f, 0, f[5]), r0 = f[3], rr = [r0 * 1.06, r0, r0 * 0.92, r0 * 0.82];
    const parts = [];
    for (let k = 0; k < 3; k++) parts.push(Cap(P[k], P[k + 1], rr[k], rr[k + 1], M.SKIN));
    parts.push(Sph(P[0], r0 * 1.20, M.SKIN), Sph(P[1], rr[1] * 1.08, M.SKIN), Sph(P[2], rr[2] * 1.05, M.SKIN));
    for (let k = 1; k < 3; k++) JT.push([P[k], norm(sub(P[k + 1], P[k - 1]))]);
    // the nail on the back of the last phalanx (+X side, away from the palm)
    const A = P[2], Bp = P[3], dir = norm(sub(Bp, A)), { ax } = fingFrame(f), outw = norm(cross(dir, ax));
    const nc = add(add(A, sub(Bp, A), 0.60), outw, rr[3] * 0.82);
    const Y = dir, Z = outw, X = norm(cross(Y, Z));
    parts.push(Box(nc, [r0 * 0.60, Math.hypot(...sub(Bp, A)) * 0.30, 0.0022], 0.002, M.NAIL, null, [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]]));
    F.push(U(0.004, ...parts));
  }
  {
    const T = thumbPts(0, THUMB.rest), r = THUMB.rad, parts = [];
    for (let k = 0; k < 3; k++) parts.push(Cap(T[k], T[k + 1], r[k], k < 2 ? r[k + 1] : r[2] * 0.86, M.SKIN));
    parts.push(Sph(T[1], r[1] * 1.08, M.SKIN), Sph(T[2], r[2] * 1.05, M.SKIN));
    const { ax } = thumbFrame(), dir = norm(sub(T[3], T[2])), outw = norm(cross(dir, ax));
    const X = norm(cross(dir, outw)), Z = outw;
    parts.push(Box(add(add(T[2], sub(T[3], T[2]), 0.6), Z, r[2] * 0.80), [0.0105, 0.012, 0.0022], 0.002, M.NAIL, null, [X[0], dir[0], Z[0], X[1], dir[1], Z[1], X[2], dir[2], Z[2]]));
    F.push(U(0.004, ...parts));
  }
  // fingers join the palm softly, but never each other: the palm takes k 0.010, the
  // fingers are a HARD union among themselves (bone heat must not see them as one web)
  const hand = U(0.010, U(0.008, ...H), U(0, ...F));
  const skin = Disp([
    { type: 'fn', bake: true, amp: 0.0014, fn: (x, y, z) => {
      let o = 0;
      if (x > 0.015 && y < -0.03 && y > -0.17) for (let i = 0; i < 4; i++) {
        const zt = 0.040 + (FING[i][1][2] - 0.040) * clamp((-y - 0.03) / 0.12, 0, 1);
        o += 0.0010 * gau((z - zt) / 0.0045) * sst(-0.035, -0.08, y);
      }
      for (const [c, a] of JT) {
        const dx = x - c[0], dy = y - c[1], dz = z - c[2], d = Math.hypot(dx, dy, dz);
        if (d > 0.03) continue;
        const along = dx * a[0] + dy * a[1] + dz * a[2];
        o -= 0.0007 * gau(d / 0.016) * Math.pow(Math.abs(Math.sin(along * 380)), 6);
      }
      if (x > 0.02) for (const [z0, z1, ph] of [[0.035, 0.085, 0.3], [0.060, 0.030, 1.7]]) {
        const t = clamp((-y - 0.04) / 0.10, 0, 1), zv = z0 + (z1 - z0) * t + 0.006 * Math.sin(t * 9 + ph);
        o += 0.0008 * gau((z - zv) / 0.0035) * sst(-0.04, -0.06, y) * (1 - sst(-0.13, -0.15, y));
      }
      return o;
    } },
    { type: 'fbm', bake: true, amp: 0.00022, f: 260, oct: 2, seed: left ? 211 : 212 }
  ], hand);
  ch.push(skin);
  return U(0.004, ...ch);
}

// ------------------------------------------------------------------------------------------
// THE BOOT (ankle frame), PARAMETRIC ON THE SOLE: every height is measured from the lead
// sole at SOLE (the IK plants on it), so a rig that moves the ankle pivot rebakes right.
// Mark V diving shoes: a lead sole, a brass toe cap, a canvas-and-leather upper laced up the
// front with leather straps over the instep and round the ankle; the trouser is stacked into
// the top of it.
// ------------------------------------------------------------------------------------------
function bootSpec2(rig) {
  const SOLE = rig.soleY, ch = [], A = -SOLE;           // A: ankle pivot height above the sole
  const yS = y => SOLE + y;                               // a height above the sole, ankle frame
  // (the SHAFT is the dress's — shaftSpec, riding the shin; the foot pitches inside it)
  // the THROAT: leather filling the opening at the ankle, so a pitched foot never shows a
  // gap under the shaft's edge (the rig's foot pitches -17..+45 deg about the pivot)
  ch.push(E([0, yS(0.1615), -0.01], [0.124, 0.110, 0.132], M.LEATHER));
  // the VAMP and the toe box
  // (leather grain, and the flex creases a walked-in boot keeps across the instep)
  ch.push(Disp([{ type: 'fbm', bake: true, amp: 0.0004, f: 140, oct: 2, seed: 74 },
    { type: 'fn', bake: true, amp: 0.0016, fn: (x, y, z) => -0.0016 * gau((z - 0.13) / 0.035) * Math.pow(Math.abs(Math.sin(z * 160 + 2 * Math.sin(x * 30))), 6) * sst(yS(0.12), yS(0.2), y) }],
  U(0.03, E([0, yS(0.128), 0.040], [0.127, 0.108, 0.20], M.LEATHER), Box([0, yS(0.116), 0.06], [0.11, 0.07, 0.15], 0.06, M.LEATHER),
    E([0, yS(0.122), 0.185], [0.136, 0.099, 0.156], M.LEATHER))));
  // the lacing's lowest crossings, over the INSTEP in front of the shaft (the shaft carries
  // the rest up the front), each hook seated on the vamp's top by marching down onto it
  {
    const f = compile(U(0.03, ...ch)).f, zs = [0.135, 0.175, 0.215];
    const seat = (x, z) => { let y = yS(0.40); for (let it = 0; it < 300; it++) { const d = f(x, y, z); if (d < 3e-4) break; y -= Math.max(d * 0.7, 4e-4); } return y; };
    const row = zs.map(z => [z, seat(0.044, z), seat(-0.044, z), seat(0, z)]);
    row.forEach(([z, yl, yr], i) => {
      ch.push(Sph([0.046, yl + 0.002, z], 0.0078, M.BRASS), Sph([-0.046, yr + 0.002, z], 0.0078, M.BRASS));
      if (i < row.length - 1) {
        const [z2, yl2, yr2, yc] = row[i + 1], ym = Math.max(row[i][3], yc) + 0.008;
        ch.push(Path([[-0.044, yr + 0.005, z], [0, ym, (z + z2) / 2], [0.044, yl2 + 0.005, z2]], 0.0042, M.CORD, 6));
        ch.push(Path([[0.044, yl + 0.005, z], [0, ym + 0.003, (z + z2) / 2], [-0.044, yr2 + 0.005, z2]], 0.0042, M.CORD, 6));
      }
    });
  }
  // the instep strap arched over the vamp, frame buckle outboard
  const yi = yS(0.130);
  ch.push(Fn([-0.16, yi - 0.05, 0.10, 0.16, yi + 0.18, 0.21], (x, y, z) => {
    const ex = x / 1.08, ey = (y - yi) / 0.94;
    const q = Math.hypot(ex, ey) - 0.130;
    return Math.max(Math.hypot(Math.max(Math.abs(q) - 0.006, 0), Math.max(Math.abs(z - 0.150) - 0.022, 0)) + Math.min(Math.max(Math.abs(q) - 0.006, Math.abs(z - 0.150) - 0.022), 0), -(y - yi) - 0.03) * 0.85;
  }, M.LEATHER));
  ch.push(Xf([0.144, yi + 0.014, 0.150], zTo(norm([1, 0.25, 0]), Math.PI / 2), Buckle(0.052, 0.046, 0.0045)));
  // BRASS TOE CAP
  {
    const c = [0, yS(0.122), 0.185], R = [0.136 * 1.05, 0.099 * 1.05, 0.156 * 1.05];
    const shell = Sub(0.002, E(c, R, M.BRASS), E(c, [R[0] - 0.006, R[1] - 0.006, R[2] - 0.006], M.BRASS));
    const cap = I(0.004, shell, Pl([0, 0, -1], -(c[2] + 0.045), M.BRASS), Pl([0, -1, 0], -(c[1] - 0.030), M.BRASS));
    ch.push(Disp([{ type: 'pits', bake: true, amp: 0.00015, f: 60, dens: 0.7, r: 0.6, seed: 72 }], cap));
    for (let k = 0; k < 7; k++) { const a = Math.PI * (0.15 + 0.7 * k / 6); ch.push(Sph([-Math.cos(a) * R[0] * 0.985, c[1] - 0.024, c[2] + 0.045 + Math.sin(a) * 0.004], 0.0055, M.BRASS)); }
  }
  // the stacked heel
  ch.push(Box([0, yS(0.076), -0.085], [0.105, 0.040, 0.075], 0.010, M.LEATHER));
  // THE LEAD SOLE
  const outline = [[0.000, -0.185], [0.070, -0.176], [0.100, -0.140], [0.104, -0.060], [0.098, 0.030], [0.122, 0.130],
    [0.130, 0.215], [0.112, 0.285], [0.066, 0.328], [0.000, 0.338]];
  const half = crPts(outline.map(q => [q[0], q[1], 0]), 36).map(q => [q[0], q[1]]);
  const full = half.concat(half.slice(1, -1).reverse().map(q => [-q[0], q[1]]));
  const BT = 0.009, DEP = 0.048, stop = SOLE + DEP + 2 * BT;
  ch.push(Disp([{ type: 'pits', bake: true, amp: 0.0006, f: 100, dens: 0.6, r: 0.35, seed: 73 }], Slab(full, SOLE, stop, 0.009, M.LEAD)));
  const wl = full.map(q => [q[0] * 1.012, stop + 0.003, q[1] * 1.012]);
  wl.push(wl[0]);
  ch.push(Path(wl, 0.0105, M.LEATHER));
  for (let i = 0; i < 14; i++) { const q = full[Math.floor(i / 14 * full.length)]; ch.push(Sph([q[0] * 1.045, SOLE + DEP * 0.62, q[1] * 1.045], 0.0068, M.BRASS)); }
  return U(0.005, ...ch);
}

// ------------------------------------------------------------------------------------------
// THE FACE (salprop). A man inside the bonnet, seen through the front light: a weathered
// working diver of the 1920s-40s — a heavy moustache, a week of stubble, a face that has
// been out in the weather, deep-set eyes. Sculpted in CENTIMETRES about the point between
// his eyes and placed into the helmet frame by one scaled transform (FACE.k = 1 cm in helmet
// units: the helmet frame is shrunk by HELM_S and 1 u ~ 0.6 m, so 1 cm = 1 / (60 x 0.85)).
// Only the front of the head exists: the bonnet is solid copper behind z = FACE.cut (the
// helmet sculpt's front cavity ends there), so the back of the skull would be wasted
// triangles. The eyes are NOT here — they are two procedural eyeballs (salInstall.js) that
// glance and blink; this sculpt carves the sockets they sit in and the lids round them.
// Coordinates: +x his left, +y up, +z out of the faceplate; eyes at (+-EYE.x, 0, EYE.z).
// ------------------------------------------------------------------------------------------
export const FACE = { k: 1 / 51, at: [0, 0.468, 0.262], cut: -10.6 };
export const EYE = { x: 3.15, y: 0.0, z: -1.15, r: 1.2 };
const mirX = n => ({ t: 'mir', ax: 0, ch: [n] });
function headCm() {
  const S = M.SKIN, F = [];
  // THE MASSES, sculptor's order: an egg of a cranium, the face's block hung under it, the jaw,
  // the chin, blended big (k 1.6) so the planes turn into each other
  F.push(E([0, 2.4, -8.0], [7.1, 9.0, 9.3], S));                                     // cranium
  F.push(E([0, -4.4, -3.4], [4.5, 5.0, 4.0], S));                                    // the face's block
  F.push(E([0, -7.3, -4.6], [4.7, 2.5, 4.0], S));                                    // jaw
  F.push(E([0, -9.15, -0.9], [2.3, 1.45, 1.8], S));                                  // chin
  F.push(mirX(E([3.9, -2.1, -2.0], [1.75, 1.2, 1.9], S)));                           // cheekbones
  F.push(Cap([-3.9, 1.7, -0.2], [3.9, 1.7, -0.2], 1.15, 1.15, S));                   // brow ridge
  F.push(mirX(E([EYE.x, 0.12, EYE.z + 0.2], [1.5, 1.3, 1.4], S)));                  // lids
  // the mouth: upper lip (under the moustache), lower lip
  F.push(E([0, -6.0, 0.35], [2.3, 0.8, 1.15], S));
  F.push(E([0, -7.0, -0.15], [1.9, 0.55, 0.95], S));
  // THE NOSE: a long bridge with a bump (broken once), a heavy tip, flared alae
  F.push(Cap([0, 0.4, 0.5], [0, -1.6, 1.55], 0.74, 0.80, S));
  F.push(Cap([0, -1.6, 1.55], [0.08, -3.55, 2.6], 0.80, 0.90, S));
  F.push(Sph([0.06, -1.65, 1.72], 0.6, S));                                          // the bump
  F.push(Sph([0.05, -3.9, 2.5], 1.08, S));                                           // tip
  F.push(mirX(E([1.25, -4.3, 1.25], [0.9, 0.75, 0.95], S)));                         // alae
  F.push(E([0, -4.75, 1.55], [0.5, 0.4, 0.85], S));                                  // columella
  F.push(Cap([0, -8, -5.6], [0, -16, -6.4], 4.4, 4.8, S));                           // the neck
  let head = U(1.0, U(1.6, ...F.slice(0, 5)), ...F.slice(5));
  // the temples narrow in above the cheekbones
  head = Sub(1.4, head, mirX(E([7.6, 1.2, -3.6], [1.6, 2.6, 2.8], S)));
  // carve: nostrils, the mouth line, the eye openings (the lids' almond), and the hollow
  // of each orbit the eyeball sits in
  head = Sub(0.18, head,
    mirX(E([0.72, -4.95, 1.75], [0.40, 0.26, 0.62], S)),
    Box([0, -6.6, 1.0], [1.95, 0.07, 1.4], 0.06, S),
    mirX(E([EYE.x, 0.02, EYE.z + 1.55], [1.46, 0.57, 1.6], S)),
    mirX(Sph([EYE.x, EYE.y, EYE.z], EYE.r + 0.06, S)));
  // THE MOUSTACHE: a heavy walrus, out over the lip and down past the corners of the mouth
  const ms = U(0.45,
    E([0, -5.5, 1.8], [2.2, 1.05, 1.0], S),
    mirX(Cap([1.2, -5.8, 1.6], [2.7, -6.75, 1.0], 0.95, 0.62, S)),
    mirX(Cap([2.7, -6.75, 1.0], [2.95, -7.5, 0.5], 0.62, 0.34, S)));
  // eyebrows: low ridges of hair on the brow
  const brows = mirX(Cap([1.4, 1.62, 1.0], [4.5, 1.8, 0.25], 0.30, 0.20, S));
  head = U(0.25, head, ms, brows);
  // the back is copper: cut flat behind the front cavity
  head = I(0.2, head, Pl([0, 0, -1], -FACE.cut, S));
  // AGE AND WEATHER, bake-only (texels, not triangles): forehead lines, crow's feet, the
  // nasolabial fold, pores, stubble, and the moustache's hair
  const C = FACE;
  return Disp([
    // the nasolabial fold and the mouth's corner creases: real geometry, a little
    { type: 'fn', amp: 0.25, fn: (x, y, z) => {
      const ax = Math.abs(x);
      const t = clamp((-y - 3.6) / 3.2, 0, 1), xc = 2.0 + 1.0 * t;           // from the ala down past the mouth
      return -0.22 * gau((ax - xc) / 0.35) * sst(-3.4, -4.2, y) * (1 - sst(-7.2, -7.8, y)) * sst(-1.5, 0.5, z);
    } },
    { type: 'fn', bake: true, amp: 0.12, fn: (x, y, z) => {
      const ax = Math.abs(x);
      let o = 0;
      // forehead: three long wavering lines
      if (y > 2.4 && y < 7.5 && z > -3) for (const yy of [3.3, 4.4, 5.6]) o -= 0.04 * gau((y - yy - 0.15 * Math.sin(x * 0.9 + yy)) / 0.13) * sst(5.2, 2.0, ax);
      // crow's feet: a fan of creases at the outer corner of each eye
      if (ax > 4.2 && ax < 6.2 && Math.abs(y) < 1.8) {
        const a = Math.atan2(y, ax - 4.4);
        o -= 0.035 * Math.pow(Math.abs(Math.sin(a * 5.5)), 8) * gau((Math.hypot(ax - 4.4, y) - 0.9) / 0.45);
      }
      // the bags under the eyes: a soft fold
      o -= 0.05 * gau((Math.hypot((ax - EYE.x) / 1.6, (y + 1.25) / 0.25)) - 1) * sst(-2, 0, z);
      // stubble: a dense pin field on the jaw, the chin, the cheeks below the bone and the lip
      const beard = sst(-2.2, -3.4, y) * (y > -5 ? sst(2.4, 3.6, ax) : 1);
      if (beard > 0) o += 0.03 * beard * Math.pow(vn(x * 9, y * 9, z * 9, 401), 4);
      // moustache: hair combed down and out, strand grooves along it
      const mz = gau((y + 5.6) / 0.9) * sst(0.0, 0.6, z) * (1 - sst(3.2, 3.6, ax));
      if (mz > 0.01) o += 0.09 * mz * crease((x * 6.5 + Math.sign(x) * y * 3.0) + 2 * vn(x * 2, y * 2, z * 2, 402));
      // brows: hair strands lying outward
      const bz = gau((y - 1.65) / 0.45) * sst(1.2, 1.6, ax) * (1 - sst(4.6, 5.0, ax)) * sst(-0.5, 0.5, z);
      if (bz > 0.01) o += 0.06 * bz * crease(ax * 9 - y * 4 + 2 * vn(x * 3, y * 3, 1, 403));
      return o;
    } },
    { type: 'fbm', bake: true, amp: 0.012, f: 3.2, oct: 2, seed: 404 }       // pores
  ], head);
}
function headSpec() {
  return { t: 'xf', p: FACE.at, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], s: FACE.k, ch: [headCm()] };
}
// paint (in the helmet frame: S.x/y/z are converted back to the face's centimetres)
function headPaint() {
  const k = FACE.k, A = FACE.at;
  const cm = S => [(S.x - A[0]) / k, (S.y - A[1]) / k, (S.z - A[2]) / k];
  const fnc = f => ['fn', S => { const [x, y, z] = cm(S); return f(x, y, z, S); }];
  const P0 = PAINT([
    // weathered: sun and wind on the nose, the cheekbones and the forehead
    { c: [0.62, 0.30, 0.24], a: 0.45, m: [['mat', M.SKIN], fnc((x, y, z) => Math.max(gau(Math.hypot(x, y + 3.2) / 1.8), 0.8 * gau(Math.hypot(Math.abs(x) - 4.2, y + 2.2) / 1.6)) * sst(-1, 1.5, z))] },
    { c: [0.48, 0.30, 0.22], a: 0.35, m: [['mat', M.SKIN], fnc((x, y) => sst(2.6, 4.5, y))] },
    // mottled, freckled, broken veins on the cheeks
    { c: [0.40, 0.24, 0.18], a: 0.35, m: [['mat', M.SKIN], ['fn', S => sst(0.55, 0.8, fbm(S.x, S.y, S.z, 90, 411, 3))]] },
    // stubble: dark, peppered with grey, the jaw / chin / lower cheeks / upper lip
    { c: [0.13, 0.11, 0.10], a: 0.78, ro: 0.75, m: [['mat', M.SKIN], fnc((x, y, z, S) => {
      const ax = Math.abs(x), beard = sst(-2.4, -3.6, y) * (y > -5.2 ? sst(2.2, 3.6, ax) : 1) * (1 - gau(Math.hypot(x, (y + 6.5) / 0.6) / 1.9) * 0.6) * sst(-11.5, -10, y) * sst(-5.5, -3.5, z);
      return beard * (0.55 + 0.45 * sst(0.35, 0.7, fbm(S.x, S.y, S.z, 160, 412, 2)));
    })] },
    { c: [0.46, 0.44, 0.42], a: 0.35, m: [['mat', M.SKIN], fnc((x, y, z, S) => sst(-2.4, -3.6, y) * sst(0.62, 0.75, fbm(S.x, S.y, S.z, 220, 413, 2)))] },
    // the moustache: dark brown going grey, thick
    { c: [0.12, 0.085, 0.065], a: 1.0, ro: 0.7, m: [['mat', M.SKIN], fnc((x, y, z) => Math.min(1, 1.3 * gau((y + 5.9 + 0.25 * Math.abs(x)) / 1.0)) * sst(0.4, 1.0, z) * (1 - sst(3.2, 3.6, Math.abs(x))))] },
    { c: [0.48, 0.45, 0.42], a: 0.35, m: [['mat', M.SKIN], fnc((x, y, z, S) => gau((y + 5.65) / 0.95) * sst(0.1, 0.7, z) * (1 - sst(3.3, 3.7, Math.abs(x))) * sst(0.5, 0.75, fbm(S.x * 3, S.y, S.z, 120, 414, 2)))] },
    // eyebrows
    { c: [0.16, 0.12, 0.09], a: 0.9, ro: 0.7, m: [['mat', M.SKIN], fnc((x, y, z) => gau((y - 1.7) / 0.42) * sst(1.1, 1.6, Math.abs(x)) * (1 - sst(4.5, 5.0, Math.abs(x))) * sst(-0.6, 0.2, z))] },
    // the hairline (receding, cropped short) at the top of the window
    { c: [0.15, 0.12, 0.10], a: 0.85, ro: 0.8, m: [['mat', M.SKIN], fnc((x, y) => sst(6.4 + 0.25 * Math.abs(x), 7.2 + 0.25 * Math.abs(x), y))] },
    // grime in the creases, a lick of red at the lids and lips
    { c: [0.30, 0.17, 0.14], a: 0.5, m: [['mat', M.SKIN], ['cav', 0.03, 0.4]] },
    { c: [0.55, 0.26, 0.22], a: 0.45, ro: 0.4, m: [['mat', M.SKIN], fnc((x, y, z) => gau(Math.hypot(x / 2.2, (y + 7.05) / 0.5)) + 0.6 * gau(Math.hypot((Math.abs(x) - EYE.x) / 1.4, y / 0.75)) * sst(-0.5, 0.3, z))] },
    { c: [0.70, 0.52, 0.42], a: 0.35, ro: 0.38, m: [['mat', M.SKIN], ['cvx', 0.04, 0.4]] }
  ]);
  P0.mats[M.SKIN] = { c: [0.55, 0.37, 0.28], ro: 0.55 };
  return P0;
}

// ------------------------------------------------------------------------------------------
// PAINT
// ------------------------------------------------------------------------------------------
// The dress: US Navy rubberised twill — dull khaki-tan canvas, never blue. Worn pale on the
// knees, elbows and seat, grimy in every fold, salt dried in tide lines up the legs, silt and
// mud ground into the knees and shins, a grease smear on the right thigh where the lantern
// hand wipes, the patches newer (and one a black vulcanised repair).
function dressPaint(P, sleeve) {
  const C = {};
  const pat = S => patchAt(P, S.x, S.y, S.z, sleeve);
  const coords = S => dressCoords(P, S.x, S.y, S.z, Object.assign(C, { sleeve }));
  const legLow = S => { const c = coords(S); return c.part.startsWith('leg') ? sst(P.up - 0.25, P.L, c.u) : 0; };
  const extra = [
    // the PATCHES: second canvas layers (newer, a shade greener-tan), the rubber repair black
    { c: [0.47, 0.40, 0.27], a: 0.85, ro: 0.82, m: [['fn', S => { const p = pat(S); return p.kind && p.kind !== 'rubber' ? p.m : 0; }]] },
    { c: [0.075, 0.07, 0.068], a: 0.95, ro: 0.55, m: [['fn', S => { const p = pat(S); return p.kind === 'rubber' ? p.m : 0; }]] },
    // stitching round every patch: tarred thread, dark
    { c: [0.16, 0.12, 0.08], a: 0.8, m: [['fn', S => { const p = pat(S); return p.kind ? gau((p.e + 0.007) / 0.0018) : 0; }]] },
    // worn pale on the points: knees, elbows, seat — the rubber coat rubbed through
    { c: [0.66, 0.58, 0.44], a: 0.55, ro: 0.9, m: [['cvx', 0.04, 0.35], ['fn', S => { const c = coords(S); return c.part.startsWith('leg') ? gau((c.u - P.up) / 0.12) : c.part.startsWith('arm') ? gau((c.u - P.aUp) / 0.10) : gau((S.y + 0.15) / 0.12) * sst(0, -0.2, S.z); }]] },
    // salt: dried tide lines up the lower legs and on the seat — white crust in wavering bands
    { c: [0.80, 0.78, 0.72], a: 0.55, ro: 0.95, m: [['fn', S => legLow(S) * gau(Math.sin(S.y * 21 + 2.0 * fbm(S.x, S.y, S.z, 3, 61, 3) * 6) / 0.22) * sst(0.45, 0.62, fbm(S.x, S.y, S.z, 7, 62, 3))]] },
    { c: [0.74, 0.71, 0.64], a: 0.35, ro: 0.95, m: [['fn', S => sst(0.6, 0.78, fbm(S.x * 1.4, S.y * 0.5, S.z * 1.4, 6, 63, 4))]] },
    // MUD and silt ground into the knees and the shins, heavier low and on the front
    { c: [0.20, 0.17, 0.12], a: 0.75, ro: 0.95, m: [['fn', S => { const c = coords(S); if (!c.part.startsWith('leg')) return 0;
      const k = gau((c.u - P.up - 0.02) / 0.10) * Math.pow(Math.max(0, Math.sin(c.th)), 0.7) * 0.9 + sst(P.L - 0.45, P.L, c.u) * 0.85;
      return k * sst(0.35, 0.60, fbm(S.x, S.y, S.z, 9, 64, 4)); }]] },
    // grease: a dark glossy smear on the right thigh's outside (the lantern hand wipes there)
    { c: [0.11, 0.09, 0.06], a: 0.7, ro: 0.38, m: [['fn', S => { const c = coords(S); return c.part === 'legR' ? gau((c.u - 0.30) / 0.10) * lobe(c.th, 0.35, 0.5) * sst(0.4, 0.6, fbm(S.x * 3, S.y, S.z * 3, 8, 65, 3)) : 0; }]] },
    // the calf lacing cord (dark tarred line) and its brass eyelets, painted on the pinch
    { c: [0.09, 0.07, 0.05], a: 0.9, m: [['fn', S => { const c = coords(S); if (!c.part.startsWith('leg')) return 0;
      const w = win(-c.u, -P.up - 0.10, -P.L + 0.14, 0.02), d = dAng(c.th, BACK) * legRb(P, c.u), ph = c.u / 0.045;
      const x1 = 0.022 * (2 * Math.abs((ph % 1 + 1) % 1 - 0.5) * 2 - 1);
      return w * Math.max(gau((d - x1) / 0.0035), gau((d + x1) / 0.0035)); }]] }
  ];
  return PAINT(extra);
}
// skin: weathered, sea-wet, cold — reddened knuckles, white-pruned fingertips, dirt in the
// creases and under the nails; the nails themselves
function handPaint(left) {
  const P0 = PAINT([
    { c: [0.64, 0.36, 0.30], a: 0.55, m: [['mat', M.SKIN], ['cvx', 0.05, 0.45]] },                         // red knuckles
    { c: [0.30, 0.20, 0.15], a: 0.55, m: [['mat', M.SKIN], ['cav', 0.04, 0.5]] },                          // grime in the creases
    { c: [0.70, 0.60, 0.53], a: 0.45, ro: 0.45, m: [['mat', M.SKIN], ['fn', S => sst(-0.20, -0.25, S.y)]] },  // pruned white tips
    { c: [0.52, 0.34, 0.25], a: 0.4, m: [['mat', M.SKIN], ['fn', S => sst(0.4, 0.7, fbm(S.x, S.y, S.z, 30, left ? 71 : 72, 3))]] },
    { c: [0.20, 0.14, 0.10], a: 0.8, m: [['mat', M.NAIL], ['fn', S => sst(0.3, 0.9, fbm(S.x, S.y, S.z, 90, 73, 2))]] },
    { c: [0.24, 0.24, 0.26], a: 0.5, ro: 0.45, m: [['mat', M.RUBBER], ['cvx', 0.06, 0.45]] }
  ]);
  P0.mats[M.SKIN] = { c: [0.56, 0.38, 0.29], ro: 0.52 };
  P0.mats[M.NAIL] = { c: [0.70, 0.58, 0.50], ro: 0.35 };
  return P0;
}
function gearPaint() {
  const P0 = PAINT();
  P0.mats[M.CORD] = { c: [0.20, 0.15, 0.10], ro: 0.8 };
  P0.mats[M.SKIN] = { c: [0.56, 0.38, 0.29], ro: 0.52 };
  P0.mats[M.NAIL] = { c: [0.70, 0.58, 0.50], ro: 0.35 };
  return P0;
}
function dressMats(p) {
  // Navy rubberised twill weathers to a grey-khaki, not a toy tan
  p.mats[M.CANVAS] = { c: [0.43, 0.37, 0.285], ro: 0.9 };
  // heavier grime in every fold, and a darker mottle where the coat has soaked and dried
  p.layers.splice(p.layers.length - 1, 0,
    { c: [0.15, 0.12, 0.09], a: 0.6, ro: 0.95, m: [['mat', M.CANVAS], ['cav', 0.02, 0.35]] },
    { c: [0.30, 0.26, 0.20], a: 0.45, m: [['mat', M.CANVAS], ['fn', S => sst(0.5, 0.72, fbm(S.x, S.y, S.z, 5, 81, 4))]] });
  p.mats[M.PATCH] = { c: [0.47, 0.40, 0.27], ro: 0.82 };
  p.mats[M.CORD] = { c: [0.20, 0.15, 0.10], ro: 0.8 };
  return p;
}

// ------------------------------------------------------------------------------------------
// SKIN: the armature the bake generates (hips frame, rest pose) — one bone per diver.js rig
// group the dress rides, named as salInstall.js maps them. Heads are the groups' pivots.
// ------------------------------------------------------------------------------------------
export function bones(P) {
  const hx = P.hipX, sx = P.shX, wy = P.shY - P.aL, ay = -P.L;
  return [
    { name: 'hips', head: [0, -0.18, 0], tail: [0, P.spY, 0] },
    { name: 'spine', head: [0, P.spY, 0], tail: [0, P.spY + 0.70, 0], parent: 'hips' },
    { name: 'thighL', head: [hx, 0, 0], tail: [hx, -P.up, 0], parent: 'hips' },
    { name: 'shinL', head: [hx, -P.up, 0], tail: [hx, ay, 0], parent: 'thighL' },
    { name: 'footL', head: [hx, ay, 0], tail: [hx, ay + P.sole * 0.6, 0.22], parent: 'shinL' },
    { name: 'thighR', head: [-hx, 0, 0], tail: [-hx, -P.up, 0], parent: 'hips' },
    { name: 'shinR', head: [-hx, -P.up, 0], tail: [-hx, ay, 0], parent: 'thighR' },
    { name: 'footR', head: [-hx, ay, 0], tail: [-hx, ay + P.sole * 0.6, 0.22], parent: 'shinR' },
    { name: 'upArmL', head: [sx, P.shY, 0], tail: [sx, P.shY - P.aUp, 0], parent: 'spine' },
    { name: 'foreArmL', head: [sx, P.shY - P.aUp, 0], tail: [sx, wy, 0], parent: 'upArmL' },
    { name: 'handL', head: [sx, wy, 0], tail: [sx, wy - 0.20, 0], parent: 'foreArmL' },
    { name: 'upArmR', head: [-sx, P.shY, 0], tail: [-sx, P.shY - P.aUp, 0], parent: 'spine' },
    { name: 'foreArmR', head: [-sx, P.shY - P.aUp, 0], tail: [-sx, wy, 0], parent: 'upArmR' },
    { name: 'handR', head: [-sx, wy, 0], tail: [-sx, wy - 0.20, 0], parent: 'foreArmR' }
  ];
}

// ------------------------------------------------------------------------------------------
// PIPELINE
// ------------------------------------------------------------------------------------------
// fill: the bake's push-pull gutter fill (tools/blender/bake.py) — no black seams in the mips;
// weldNormals: one normal per position across UV seams (no shading lines, no cracks under the push)
const SET = { size: 2048, gutter: 6, aoDist: 0.06, aoSamples: 64, ormB: 'metal', fill: true, weldNormals: true };
const SET1K = { size: 1024, gutter: 4, packMargin: 3, aoDist: 0.06, aoSamples: 64, ormB: 'metal', fill: true, weldNormals: true };
const piece = (name, set, sdf, o = {}) => ({
  name, set, sdf, paint: o.paint || PAINT(), emit: metalEmit,
  hi: { h: o.h || 0.003 }, lo: { h: o.loH || 0.008, tris: o.tris || 4000 },
  kEps: 0.006, ao: { r: 0.035, n: 4 }, cage: o.cage || 0.014, ray: o.ray || 0.04,
  wrk: o.wrk, skin: o.skin
});
function rigFromSource() {
  const fs = PROC.fs;
  if (!fs) throw new Error('salSkinSculpt.pipeline runs in node (tools/blender/build.mjs salSkin)');
  return readRig(fs.readFileSync(new URL('./diver.js', import.meta.url), 'utf8'));
}
export function pipeline() {
  const rig = rigFromSource(), P = plan(rig), HB = handBones(), B = bones(P).concat(HB.map(b => ({ name: b.name, head: b.head, tail: b.tail, parent: b.parent }))), HP = handPoses();
  // no foot bones: the trouser and the boot shaft ride the shin (the foot pitches inside them)
  const legBones = ['hips', 'spine', 'thighL', 'shinL', 'thighR', 'shinR'];
  const pieces = [
    piece('helmet', 'helm', helmetSpec(), { tris: 16000, h: 0.0028 }),
    piece('corselet', 'helm', corseletSpec({ mk5: true }), { tris: 11000, h: 0.0032, loH: 0.009 }),
    // THE DRESS (skinned): fine enough for the knees and elbows to bend round
    piece('trunk', 'dress', trunkSpec(P, false), { tris: 19000, h: 0.0034, loH: 0.010, paint: dressMats(dressPaint(P, false)),
      wrk: trunkSpec(P, true), cage: 0.022, ray: 0.05, skin: { allow: legBones } }),
    piece('sleeveL', 'dress', sleeveSpec(P, 1, false), { tris: 5200, h: 0.003, paint: dressMats(dressPaint(P, true)),
      wrk: sleeveSpec(P, 1, true), cage: 0.02, ray: 0.045, skin: { allow: ['spine', 'upArmL', 'foreArmL', 'handL'] } }),
    piece('sleeveR', 'dress', sleeveSpec(P, -1, false), { tris: 5200, h: 0.003, paint: dressMats(dressPaint(P, true)),
      wrk: sleeveSpec(P, -1, true), cage: 0.02, ray: 0.045, skin: { allow: ['spine', 'upArmR', 'foreArmR', 'handR'] } }),
    piece('belt', 'gear', beltSpec(P), { tris: 6500, h: 0.0028, loH: 0.007, paint: gearPaint() }),
    piece('pack', 'gear', packSpec(), { tris: 5000, h: 0.003, paint: gearPaint() }),
    // (salprop) the hands are skinned to their own 16 finger bones (handBones, wrist frame)
    piece('handL', 'gear', handSpec(true), { tris: 6400, h: 0.0018, loH: 0.0042, paint: handPaint(true), skin: { allow: HB.map(b => b.name), smooth: 2 } }),
    piece('handR', 'gear', handSpec(false), { tris: 6400, h: 0.0018, loH: 0.0042, paint: handPaint(false), skin: { allow: HB.map(b => b.name), smooth: 2 } }),
    // (salprop) THE FACE behind the front light, its own 1024 set
    piece('head', 'face', headSpec(), { tris: 9000, h: 0.0016, loH: 0.0040, paint: headPaint(), cage: 0.008, ray: 0.025 }),
    piece('boot', 'gear', bootSpec2(rig), { tris: 6500, h: 0.0025, loH: 0.006, paint: gearPaint() })
  ];
  return {
    name: 'salSkin', out: 'assets/salskin',
    sets: { helm: SET, dress: Object.assign({}, SET, { wrinkle: true, wrinkleHalf: true }), gear: SET1K, face: SET1K },
    pieces,
    skin: { bones: B },
    meta: {
      rig: { armL: rig.armL, legL: rig.legL, soleY: rig.soleY, pack: rig.pack, spineY: rig.spineY, neckY: rig.neckY, helmS: rig.helmS },
      mirror: ['handR', 'boot'],
      skinned: ['trunk', 'sleeveL', 'sleeveR'],
      bones: B.map(b => b.name),
      grip: GRIP, beltY: P.beltY, inBootY: -P.inBoot,
      // (salprop) the hand rig (wrist frame, authored left) and its solved poses; the face's eyes
      hand: { bones: HB.map(b => ({ name: b.name, parent: b.parent || null, head: b.head, ax: b.ax, sw: b.sw })), poses: { grip: HP.grip, knife: HP.knife, relax: HP.relax, spread: HP.spread }, fitErr: HP.fitErr },
      face: { k: FACE.k, at: FACE.at, cut: FACE.cut, eye: EYE, cav: HELM_CAV, port: HELM_PORT0() },
      metal: 'ormB'
    },
    compress: { mesh: 'draco', tex: 'ktx2' }
  };
}

// Look-dev preview for sculptlab.html (?lab&job=./src/entities/salSkinSculpt.js%23preview&p=head)
// (no rig read: the head and the hands do not depend on it)
export function preview() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const want = (q.get('p') || 'head').split(','), k = +(q.get('k') || 2);
  const all = [piece('head', 'face', headSpec(), { tris: 9000, h: 0.0016, loH: 0.004, paint: headPaint() }),
    piece('handL', 'gear', handSpec(true), { tris: 6400, h: 0.0018, loH: 0.0042, paint: handPaint(true) })];
  // eyeball stand-ins (the game's eyes are procedural): white spheres where salInstall puts them
  all.push(piece('eyes', 'face', { t: 'xf', p: FACE.at, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], s: FACE.k, ch: [mirX(Sph([EYE.x, EYE.y, EYE.z], EYE.r, M.IVORY))] }, { tris: 800, h: 0.0016 }));
  const parts = all.filter(p => want.includes(p.name));
  return {
    key: 'preview-salSkin-' + want.join('-') + '-' + k + '-' + Math.random(),
    parts: parts.map(p => ({ name: p.name, sdf: p.sdf, h: p.hi.h * k, tris: p.lo.tris, err: p.lo.h })),
    atlas: { size: +(q.get('s') || 1024), paint: parts[0].paint, kEps: parts[0].kEps, ao: parts[0].ao },
    layout: Object.fromEntries(parts.map(p => [p.name, [0, 0, 0]]))
  };
}
