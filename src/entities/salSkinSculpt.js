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
  readRig, profOf, M, METAL, PAINT, metalEmit, helmetSpec, corseletSpec, packSpec, fbm, vn, isM,
  Sph, E, Box, Cap, Cone, Tor, U, Sub, I, Xf, Pl, Fn, Disp, yTo, zTo, eul, norm, add, sub, cross, crPts, Path, Ring,
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
  // the weight belt (rigid, hips frame): its centre line, height and the dress radius under it
  P.beltY = P.spY + 0.07; P.beltH = 0.15; P.beltRx = 0.372; P.beltZr = 0.86;
  return P;
}

// ------------------------------------------------------------------------------------------
// THE DRESS
// ------------------------------------------------------------------------------------------
// TRUNK PROFILE (hips frame): [y, x-radius, z/x ratio]. Hidden under the breastplate above
// its skirt (spine 0.395 = hips 0.595); BLOUSED out under the skirt (air and slack canvas),
// cinched hard under the belt, full again over the hips, closing between the legs.
function trunkProfile(P) {
  const b = P.beltY;
  return [
    [P.spY + 0.80, 0.30, 0.80], [P.spY + 0.70, 0.46, 0.80], [P.spY + 0.55, 0.505, 0.78], [P.spY + 0.40, 0.51, 0.78],
    [P.spY + 0.31, 0.495, 0.80], [P.spY + 0.235, 0.455, 0.81], [b + P.beltH / 2 + 0.01, 0.392, 0.84], [b, P.beltRx - 0.016, P.beltZr],
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
  return rT + (rS - rT) * sst(P.up - 0.07, P.up + 0.07, t) - 0.010 * sst(P.L - 0.17, P.L - 0.05, t);
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
    // the trouser STACKED over the boot: three or four big buckles that spiral and slump
    const st = sst(L - 0.22, L - 0.10, u);
    o += 0.0105 * a * st * (0.6 + 0.4 * Math.pow(0.5 + 0.5 * Math.cos(th - FRONT), 1)) * bfold(u, th, 0.070, 1.6, sd + 2);
    o += 0.006 * st;
    // the seat and the backs of the thighs sag
    o += 0.010 * gau((u - 0.06) / 0.09) * Math.pow(0.5 + 0.5 * Math.cos(th - BACK), 2);
    // calf LACING (Mark V legs are laced up the back of the calf to keep the air out of
    // the legs): the canvas is drawn in along the lacing and pleats run into it
    const lw = win(-u, -up - 0.10, -L + 0.16, 0.04);
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
    const wA = win(y, P.spY + 0.36, top - 0.005, 0.03);
    if (wA > 0) {
      const g = sst(P.spY + 0.36, top + 0.02, y);
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
function sleeveField(P, s) {
  const prof = [], yT = -0.07, yB = -(P.aL - 0.075), n = 70;
  for (let i = 0; i <= n; i++) { const y = yT + (yB - yT) * i / n; prof.push([armRb(P, -y) * (1 - 0.45 * sst(-0.22, yT, y)), y]); }
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
  if (Math.abs(Math.abs(x) - P.shX) < 0.24 && y > P.shY - P.aL - 0.1 && y < P.shY + 0.1 && o.sleeve) {
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
      o += 0.012 * win(c.u, P.spY + 0.38, P.beltY - 0.06, 0.05) * fr * bfold(c.u, c.th, 0.055, 0.9, sd + 9);
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
function trunkSpec(P, wrinkle) {
  const body = U(0.075, trunkField(P), legField(P, 1), legField(P, -1));
  const L = dressBake(P, false, 3);
  if (wrinkle) L.push(wrinkleLayer(P, false));
  return U(0.003, Disp(L, body), crotchStrap(P), knifeStraps(P));
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
      const yy = y + h / 2 - 0.01 + (P.spY + 0.39 - (y + h / 2 - 0.01)) * k / 8;
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
// bare hand closed round a bar along Z at C (the lantern bail / the knife grip pass through
// it), out of a clamped RUBBER WRIST CUFF — the Mark V seal: the sleeve ends in a vulcanised
// rubber cuff, held tight on the wrist by a rolled rubber ring.
// Back of the hand outboard (+X), palm inboard, fingers along -Y curling round the bar.
// ------------------------------------------------------------------------------------------
const GRIP = [0.006, -0.205, 0.075];
function handSpec(left) {
  const ch = [], C = GRIP;
  // ---- CUFF: a rubber tube from under the sleeve's end down onto the wrist, a rolled
  // retaining ring over it, and the cuff's lip turned out at the wrist
  const cuff = [[0.104, 0.115], [0.100, 0.085], [0.088, 0.045], [0.075, 0.015], [0.068, -0.005], [0.066, -0.020]];
  ch.push(Disp([{ type: 'fn', bake: true, amp: 0.0012, fn: (x, y, z) => 0.0012 * crease(Math.atan2(z, x) * 7 + y * 120 + 3 * Math.sin(y * 40)) * sst(0.0, 0.08, y) },
    { type: 'fbm', bake: true, amp: 0.0003, f: 140, oct: 2, seed: left ? 201 : 202 }],
  Lathe(smoothProf(cuff.map(q => [q[0], q[1]]), 3), M.RUBBER, { sz: 0.92 })));
  ch.push(ETor(0.077, 0.0095, 0.028, M.RUBBER, 1, 0.92));                 // the rolled ring
  ch.push(ETor(0.069, 0.0055, -0.016, M.RUBBER, 1, 0.92));                // the cuff's lip
  // ---- THE HAND. Wrist (forearm end) at y ~ -0.02, palm ~0.17 long, a big working hand.
  const H = [];
  // wrist and the heel of the hand
  H.push(E([0.0, -0.035, 0.022], [0.042, 0.052, 0.048], M.SKIN));
  // palm block: back of the hand faces +X, slightly cupped, wider at the knuckles
  H.push(Box([0.010, -0.105, 0.058], [0.024, 0.060, 0.056], 0.022, M.SKIN, [0, 0, 0.06]));
  H.push(E([-0.012, -0.090, 0.025], [0.026, 0.050, 0.034], M.SKIN));   // thenar/hypothenar pad
  // fingers: index (front, +Z) to little; knuckle (MCP) on the back side above the bar,
  // each finger wraps the bar on a circle round C: down the outboard side, under, up inside
  const Rc = 0.046, fz = [0.107, 0.077, 0.048, 0.020], len = [1.0, 1.06, 0.98, 0.80], rad = [0.0168, 0.0172, 0.0162, 0.0140];
  const curl = [0, 0, 3, 7];                    // the little finger curls a touch tighter
  const JT = [];                                 // finger joints: [centre, axis] for the skin creases
  for (let i = 0; i < 4; i++) {
    const z = fz[i], sc = len[i], r0 = rad[i];
    const K = [0.030, -0.158 + (1 - sc) * 0.030, z];                     // MCP knuckle
    const ang = [40, -12 - curl[i], -78 - curl[i], -140 - 2 * curl[i]].map(a => a * Math.PI / 180);
    const pts = [K];
    for (let k = 1; k < 4; k++) pts.push([C[0] + Math.cos(ang[k]) * Rc * (0.94 + 0.06 * sc), C[1] + Math.sin(ang[k]) * Rc * (0.94 + 0.06 * sc) - (1 - sc) * 0.012, z]);
    const rr = [r0 * 1.08, r0, r0 * 0.93, r0 * 0.84];
    for (let k = 0; k < 3; k++) H.push(Cap(pts[k], pts[k + 1], rr[k], rr[k + 1], M.SKIN));
    for (let k = 1; k < 3; k++) JT.push([pts[k], norm(sub(pts[k + 1], pts[k - 1]))]);
    H.push(Sph(K, r0 * 1.22, M.SKIN));                                    // the knuckle
    H.push(Sph(pts[1], rr[1] * 1.10, M.SKIN));                            // PIP
    H.push(Sph(pts[2], rr[2] * 1.06, M.SKIN));                            // DIP
    // the nail: on the back of the last phalanx (the side away from the bar)
    const A = pts[2], B = pts[3], dir = norm(sub(B, A)), outw = norm(sub(add(A, dir, 0.5 * Math.hypot(...sub(B, A))), C));
    const nc = add(add(A, sub(B, A), 0.62), outw, rr[3] * 0.80);
    const Y = dir, Z = outw, X = norm(cross(Y, Z));
    H.push(Box(nc, [r0 * 0.62, Math.hypot(...sub(B, A)) * 0.30, 0.0022], 0.002, M.NAIL, null, [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]]));
  }
  // thumb: from the heel of the hand (inboard, front), across the front of the bar and
  // pressed over the middle phalanges of the index and middle fingers
  const T0 = [-0.012, -0.050, 0.088], T1 = [-0.030, -0.110, 0.130], T2 = [-0.020, -0.170, 0.136], T3 = [0.004, -0.208, 0.128];
  H.push(Cap(T0, T1, 0.024, 0.020, M.SKIN), Cap(T1, T2, 0.020, 0.0175, M.SKIN), Cap(T2, T3, 0.0175, 0.0150, M.SKIN));
  H.push(Sph(T1, 0.021, M.SKIN), Sph(T2, 0.018, M.SKIN));
  {
    const dir = norm(sub(T3, T2)), outw = norm([0.25, 0.1, 1]), X = norm(cross(dir, outw)), Z = cross(X, dir);
    H.push(Box(add(add(T2, sub(T3, T2), 0.6), Z, 0.0125), [0.0105, 0.012, 0.0022], 0.002, M.NAIL, null, [X[0], dir[0], Z[0], X[1], dir[1], Z[1], X[2], dir[2], Z[2]]));
  }
  // the hand's skin: tendons on the back, knuckle creases, the finger joint creases, pores
  const skin = Disp([
    { type: 'fn', bake: true, amp: 0.0014, fn: (x, y, z) => {
      let o = 0;
      // extensor tendons fanning over the back of the hand to each knuckle
      if (x > 0.015 && y < -0.03 && y > -0.17) for (let i = 0; i < 4; i++) {
        const zt = 0.040 + (fz[i] - 0.040) * clamp((-y - 0.03) / 0.13, 0, 1);
        o += 0.0010 * gau((z - zt) / 0.0045) * sst(-0.035, -0.08, y);
      }
      // creases across every finger joint (PIP, DIP): a few deep lines, only at the joint
      for (const [c, a] of JT) {
        const dx = x - c[0], dy = y - c[1], dz = z - c[2], d = Math.hypot(dx, dy, dz);
        if (d > 0.03) continue;
        const along = dx * a[0] + dy * a[1] + dz * a[2];
        o -= 0.0007 * gau(d / 0.016) * Math.pow(Math.abs(Math.sin(along * 380)), 6);
      }
      // two veins over the back of the hand, wandering toward the knuckles
      if (x > 0.02) for (const [z0, z1, ph] of [[0.035, 0.085, 0.3], [0.060, 0.030, 1.7]]) {
        const t = clamp((-y - 0.04) / 0.10, 0, 1), zv = z0 + (z1 - z0) * t + 0.006 * Math.sin(t * 9 + ph);
        o += 0.0008 * gau((z - zv) / 0.0035) * sst(-0.04, -0.06, y) * (1 - sst(-0.13, -0.15, y));
      }
      return o;
    } },
    { type: 'fbm', bake: true, amp: 0.00022, f: 260, oct: 2, seed: left ? 211 : 212 }
  ], U(0.010, ...H));
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
  const top = Math.min(0.10, 0.36 * A);                   // shaft top above the ankle pivot
  // THE SHAFT: leather, round the ankle, a rolled top the trouser bunches into
  const shaft = [[0.128, yS(0.12)], [0.120, yS(0.20)], [0.118, Math.min(yS(0.30), top - 0.06)], [0.128, top - 0.02], [0.142, top]];
  ch.push(Disp([{ type: 'fn', bake: true, amp: 0.0012, fn: (x, y, z) => 0.0012 * crease(Math.atan2(z, x) * 5 + y * 90 + 2 * Math.sin(y * 31)) * sst(0.4, 0.8, Math.sin(Math.atan2(z, x) * 3 + y * 13)) }],
    Lathe(smoothProf(shaft.map(q => [q[0], q[1]]), 3), M.LEATHER, { sz: 1.0 })));
  ch.push(ETor(0.140, 0.014, top - 0.004, M.LEATHER, 1, 1));
  // ankle strap and buckle
  const ya = Math.max(yS(0.24), top - 0.075);
  ch.push(Band(() => 0.128, ya, 0.036, 0.005, M.LEATHER, { rr: 0.002, rmax: 0.2 }));
  ch.push(Xf([0.133, ya, 0.0], zTo([1, 0, 0], Math.PI / 2), Buckle(0.044, 0.040, 0.0045)));
  // the VAMP and the toe box
  ch.push(U(0.03, E([0, yS(0.128), 0.040], [0.127, 0.108, 0.20], M.LEATHER), Box([0, yS(0.116), 0.06], [0.11, 0.07, 0.15], 0.06, M.LEATHER)));
  ch.push(E([0, yS(0.122), 0.185], [0.136, 0.099, 0.156], M.LEATHER));
  // laces up the front: crossings and brass hooks either side, seated on the leather by
  // marching the upper's own field in from the front
  {
    const f = compile(U(0.03, ...ch)).f, nL = 6, y0 = yS(0.205), y1 = top - 0.035;
    const seat = (x, y) => { let z = 0.40; for (let it = 0; it < 200; it++) { const d = f(x, y, z); if (d < 3e-4) break; z -= Math.max(d * 0.7, 4e-4); } return z; };
    const row = [];
    for (let i = 0; i < nL; i++) { const y = y0 + (y1 - y0) * i / (nL - 1); row.push([y, seat(0.050, y), seat(-0.050, y), seat(0, y)]); }
    row.forEach(([y, zl, zr], i) => {
      ch.push(Sph([0.052, y, zl + 0.002], 0.0085, M.BRASS), Sph([-0.052, y, zr + 0.002], 0.0085, M.BRASS));
      if (i < nL - 1) {
        const [y2, zl2, zr2, zc] = row[i + 1], zm = Math.max(row[i][3], zc) + 0.010;
        ch.push(Path([[-0.050, y, zr + 0.006], [0, (y + y2) / 2, zm], [0.050, y2, zl2 + 0.006]], 0.0042, M.CORD, 6));
        ch.push(Path([[0.050, y, zl + 0.006], [0, (y + y2) / 2, zm + 0.004], [-0.050, y2, zr2 + 0.006]], 0.0042, M.CORD, 6));
      }
    });
    const [yt, zl, zr, zc] = row[nL - 1];
    ch.push(E([0, yt + 0.006, zc + 0.012], [0.014, 0.010, 0.010], M.CORD));          // the knot
    for (const sx of [-1, 1]) ch.push(Path([[0, yt + 0.006, zc + 0.014], [sx * 0.03, yt - 0.03, zc + 0.02], [sx * 0.04, yt - 0.075, zc + 0.012]], 0.0040, M.CORD, 6));
  }
  // the instep strap arched over the vamp, frame buckle outboard
  const yi = yS(0.130);
  ch.push(Fn([-0.16, yi - 0.05, 0.06, 0.16, yi + 0.18, 0.17], (x, y, z) => {
    const ex = x / 1.08, ey = (y - yi) / 0.94;
    const q = Math.hypot(ex, ey) - 0.130;
    return Math.max(Math.hypot(Math.max(Math.abs(q) - 0.006, 0), Math.max(Math.abs(z - 0.112) - 0.022, 0)) + Math.min(Math.max(Math.abs(q) - 0.006, Math.abs(z - 0.112) - 0.022), 0), -(y - yi) - 0.03) * 0.85;
  }, M.LEATHER));
  ch.push(Xf([0.144, yi + 0.014, 0.112], zTo(norm([1, 0.25, 0]), Math.PI / 2), Buckle(0.052, 0.046, 0.0045)));
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
  const rig = rigFromSource(), P = plan(rig), B = bones(P);
  const legBones = ['hips', 'spine', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
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
    piece('handL', 'gear', handSpec(true), { tris: 5200, h: 0.0018, loH: 0.0045, paint: handPaint(true) }),
    piece('handR', 'gear', handSpec(false), { tris: 5200, h: 0.0018, loH: 0.0045, paint: handPaint(false) }),
    piece('boot', 'gear', bootSpec2(rig), { tris: 6500, h: 0.0025, loH: 0.006, paint: gearPaint() })
  ];
  return {
    name: 'salSkin', out: 'assets/salskin',
    sets: { helm: SET, dress: Object.assign({}, SET, { wrinkle: true }), gear: SET1K },
    pieces,
    skin: { bones: B },
    meta: {
      rig: { armL: rig.armL, legL: rig.legL, soleY: rig.soleY, pack: rig.pack, spineY: rig.spineY },
      mirror: ['handR', 'boot'],
      skinned: ['trunk', 'sleeveL', 'sleeveR'],
      bones: B.map(b => b.name),
      grip: GRIP, beltY: P.beltY,
      metal: 'ormB'
    },
    compress: { mesh: 'draco', tex: 'ktx2' }
  };
}
