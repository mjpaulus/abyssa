// SAL — the sculpt. The Mark V hard-hat diver as signed-distance specs for the sculpt
// pipeline (lib/sculpt.js + tools/blender): every rigid part of the procedural rig in
// entities/diver.js re-authored as a sculpt in ITS OWN BONE SPACE, baked high-to-low by
// headless Blender into assets/sal/. Pure data builders: no THREE, no scene. Node only
// (pipeline() reads the rig out of diver.js's source).
//
//   node tools/blender/build.mjs sal          <- the one command (re-run after any rig change)
//
// THE RIG IS READ, NOT COPIED. Segment lengths, joint offsets, limb radii and the four
// limb profiles are parsed out of diver.js at bake time (readRig), so a change to Sal's
// proportions there (the walk branch moves thigh/shin lengths) re-bakes correctly with the
// same command. The bake records what it used in meta.rig; salInstall.js compares that
// with the live rig and refuses / stretches loudly on a mismatch.
//
// DEFORMATION: rigid sculpted segments with sculpted joint gathers that overlap, the same
// contract as the procedural Part build (salInstall.js header has the evidence). Each
// lower segment carries a JOINT BALL centred on its pivot, sized to the upper segment's
// end radius, so any bend angle shows continuous canvas; the upper segment's end cap
// tucks into it. The gathers (compression folds) are sculpted on the INNER side of each
// bend, where canvas has nowhere to go: the front of the elbow, behind the knee, the groin.
//
// PIECES (frame = the diver.js group they ride; metalness rides ORM.B, see bake 'ormB'):
//   set helm   : helmet (neck)
//   set torso  : corselet (spine), hips (hips), pack (spine.pack)
//   set limbs  : upperArm, foreArm, glove (arm L; the R arm is the mirror, scale.x = -1),
//                thighL, thighR (the left thigh carries the knife strap rig), shin, boot
//
// Glass, the feed hose, the lantern and the knife/scabbard stay procedural (transparent /
// braided / animated parts that the procedural shaders already do well).
import { compile } from '../lib/sculpt.js';
// node only (the bake): diver.js is read off disk. In a browser this module is never loaded.
const PROC = globalThis.process && process.versions && process.versions.node ? { fs: await import('fs') } : {};

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gau = t => Math.exp(-t * t);
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---- the rig, read from diver.js ---------------------------------------------------------
export function readRig(src) {
  const num = '(-?[\\d.]+)';
  const need = (re, what) => { const m = src.match(re); if (!m) throw new Error('salSculpt.readRig: could not find ' + what + ' in diver.js'); return m; };
  const limb = (name, parent) => {
    const m = need(new RegExp('g\\.' + name + '\\s*=\\s*limb\\(\\s*' + parent + '\\s*,\\s*' + [num, num, num, num, num].join('\\s*,\\s*')), name);
    return { x: +m[1], y: +m[2], up: +m[3], lo: +m[4], r: +m[5] };
  };
  const prof = name => JSON.parse(need(new RegExp('const ' + name + '\\s*=\\s*profOf\\((\\[[^;]*?\\])\\);'), name)[1]);
  const rig = {
    hipsY: +need(/hips\.position\.y\s*=\s*(-?[\d.]+)/, 'hips.position.y')[1],
    spineY: +need(/spine\.position\.y\s*=\s*(-?[\d.]+)/, 'spine.position.y')[1],
    neckY: +need(/neck\.position\.y\s*=\s*(-?[\d.]+)/, 'neck.position.y')[1],
    pack: need(/pk\.position\.set\(([^)]*)\)/, 'pack position')[1].split(',').map(Number),
    armR: limb('armR', 'spine'), armL: limb('armL', 'spine'), legR: limb('legR', 'hips'), legL: limb('legL', 'hips'),
    soleY: +need(/const SOLE_Y\s*=\s*(-?[\d.]+)/, 'SOLE_Y')[1],
    P: { upArm: prof('P_UPARM'), foreArm: prof('P_FOREARM'), thigh: prof('P_THIGH'), shank: prof('P_SHANK') }
  };
  // the gait's own constants must agree with the build's (diver.js keeps both)
  const UP = src.match(/const UP_L\s*=\s*(-?[\d.]+),\s*LO_L\s*=\s*(-?[\d.]+)/);
  if (UP && (Math.abs(+UP[1] - rig.legL.up) > 1e-4 || Math.abs(+UP[2] - rig.legL.lo) > 1e-4))
    console.warn('salSculpt: UP_L/LO_L (' + UP[1] + ', ' + UP[2] + ') disagree with the leg build (' + rig.legL.up + ', ' + rig.legL.lo + '); sculpting to the build');
  return rig;
}
export const profOf = keys => s => {
  let i = 1;
  while (i < keys.length - 1 && keys[i][0] < s) i++;
  const [s0, k0] = keys[i - 1], [s1, k1] = keys[i];
  const u = clamp((s - s0) / (s1 - s0), 0, 1);
  return k0 + (k1 - k0) * (u * u * (3 - 2 * u));
};

// ---- node builders --------------------------------------------------------------------------
export const M = {
  COPPER: 0, BRASS: 1, LEAD: 2, STEEL: 3, SOLDER: 4,
  CANVAS: 5, DUCK: 6, TAPE: 7, LEATHER: 8, RUBBER: 9, IVORY: 10, DARK: 11, SEAM: 12
};
// metalness per material (ORM.B): brass and copper are metal, lead is a dead one (the
// procedural lead was 0.55), steel 0.8, solder a bright tin-lead
const METAL = { [M.COPPER]: 1, [M.BRASS]: 1, [M.LEAD]: 0.45, [M.STEEL]: 0.8, [M.SOLDER]: 0.85 };

const Sph = (c, r, m) => ({ t: 'sphere', c, r, m });
const E = (c, r, m, e, R) => ({ t: 'ellip', c, r, m, e, R });
const Box = (c, h, r, m, e, R) => ({ t: 'box', c, h, r, m, e, R });
const Cap = (a, b, ra, rb, m) => ({ t: 'cap', a, b, ra, rb: rb == null ? ra : rb, m });
const Cone = (a, b, ra, rb, m) => ({ t: 'cone', a, b, ra, rb, m });
const Tor = (c, R, r, m, rot) => ({ t: 'torus', c, R, r, m, rot });
const U = (k, ...ch) => ({ t: 'u', k, ch: ch.flat() });
const Sub = (k, a, ...b) => ({ t: 's', k, ch: [a, ...b.flat()] });
const SubM = (k, m, a, ...b) => ({ t: 's', k, m, ch: [a, ...b.flat()] });
const I = (k, ...ch) => ({ t: 'i', k, ch: ch.flat() });
const Xf = (p, R, ...ch) => ({ t: 'xf', p, R, ch: [U(0, ...ch)] });
const Pl = (n, o, m) => ({ t: 'plane', n, o, m });
const Fn = (bb, f, m) => ({ t: 'fn', bb, f, m });
const Disp = (L, ch) => ({ t: 'disp', L, ch: [ch] });

// rotation (row-major local -> world) whose local Y (resp. Z) is `up` (resp. `fw`)
function yTo(up) {
  const Y = norm(up), X = norm(Math.abs(Y[0]) < 0.9 ? cross(Y, [1, 0, 0]) : cross(Y, [0, 0, 1])), Z = cross(X, Y);
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
}
function zTo(fw, roll = 0) {
  const Z = norm(fw), t = Math.abs(Z[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  let X = norm(cross(t, Z)), Y = cross(Z, X);
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const X2 = add(X.map(v => v * c), Y, s), Y2 = add(Y.map(v => v * c), X, -s); X = X2; Y = Y2; }
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
}
function eul(a, b, c) {   // THREE Euler XYZ, row-major local -> world (sculpt.js eulerMat)
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [cb * cc, -cb * sc, sb, ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb, sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb];
}
const mulRv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

// centripetal-free uniform Catmull-Rom through points (end tangents extrapolated)
function crPts(P, n) {
  const out = [], m = P.length;
  const g = i => i < 0 ? add(P[0], sub(P[0], P[1])) : i >= m ? add(P[m - 1], sub(P[m - 1], P[m - 2])) : P[i];
  for (let k = 0; k <= n; k++) {
    const t = k / n * (m - 1), i = Math.min(m - 2, Math.floor(t)), u = t - i;
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2), u2 = u * u, u3 = u2 * u;
    out.push([0, 1, 2].map(j => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3)));
  }
  return out;
}
// a swept round tube through points (hard union of round cones)
function Path(P, r, m, n = 0, r1) {
  const Q = n ? crPts(P, n) : P, ch = [];
  for (let i = 0; i < Q.length - 1; i++) {
    const a = r1 == null ? r : r + (r1 - r) * i / (Q.length - 1), b = r1 == null ? r : r + (r1 - r) * (i + 1) / (Q.length - 1);
    ch.push(Cap(Q[i], Q[i + 1], a, b, m));
  }
  return U(0, ...ch);
}
function Ring(c, R, r, m, axis = [0, 1, 0]) { return Tor(c, R, r, m, yTo(axis)); }

// 2D signed distance to a closed polygon (iq), precomputed edge arrays
function polySDF(P) {
  const n = P.length, X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = P[i][0]; Y[i] = P[i][1]; }
  return (px, py) => {
    let d = 1e9, s = 1;
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const ex = X[j] - X[i], ey = Y[j] - Y[i], wx = px - X[i], wy = py - Y[i];
      const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1e-12), 0, 1), bx = wx - ex * t, by = wy - ey * t, q = bx * bx + by * by;
      if (q < d) d = q;
      const c1 = py >= Y[i], c2 = py < Y[j], c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * Math.sqrt(d);
  };
}
// smooth a [r, y] profile (Catmull-Rom, n samples per span)
function smoothProf(P, n = 4) {
  const Q = crPts(P.map(p => [p[0], p[1], 0]), (P.length - 1) * n);
  return Q.map(q => [Math.max(0, q[0]), q[1]]);
}
// SOLID OF REVOLUTION about local Y: prof [[r, y], ...] (closed to the axis at both ends),
// optional elliptical section (sx, sz) and a radial modulation mod(theta, y, x, z) -> outward
// offset (cloth folds, spun ridges). lip scales the field back to ~1-Lipschitz.
function Lathe(prof, m, o = {}) {
  const pts = prof.slice();
  if (pts[0][0] > 1e-6) pts.unshift([0, pts[0][1]]);
  if (pts[pts.length - 1][0] > 1e-6) pts.push([0, pts[pts.length - 1][1]]);
  const f2 = polySDF(pts), sx = o.sx || 1, sz = o.sz || 1, smin = Math.min(sx, sz), mod = o.mod, lip = o.lip || (mod ? 0.7 : 1);
  let rmax = 0, y0 = 1e9, y1 = -1e9;
  for (const p of pts) { rmax = Math.max(rmax, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const pad = (o.amp || 0) + 0.002, c = o.c || [0, 0, 0];
  const bb = [c[0] - rmax * sx - pad, c[1] + y0 - pad, c[2] - rmax * sz - pad, c[0] + rmax * sx + pad, c[1] + y1 + pad, c[2] + rmax * sz + pad];
  return Fn(bb, (x, y, z) => {
    x -= c[0]; y -= c[1]; z -= c[2];
    const rho = Math.hypot(x / sx, z / sz);
    let d = f2(rho, y) * smin;
    if (mod) d -= mod(Math.atan2(z / sz, x / sx), y, x, z);
    return d * lip;
  }, m);
}
// extrude a 2D outline [[x, z], ...] between y0 and y1, every edge rounded by rr
function Slab(outline, y0, y1, rr, m) {
  const f2 = polySDF(outline), hh = (y1 - y0) / 2 - rr, yc = (y0 + y1) / 2;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of outline) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  return Fn([x0 - 0.01, y0 - 0.01, z0 - 0.01, x1 + 0.01, y1 + 0.01, z1 + 0.01], (x, y, z) => {
    const wx = f2(x, z) + rr, wy = Math.abs(y - yc) - hh;
    return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - rr;
  }, m);
}
// a flat band hugging a surface of revolution: |rho - R(theta, y)| < t, |y - yc| < h/2
function Band(Rf, yc, h, t, m, o = {}) {
  const sx = o.sx || 1, sz = o.sz || 1, sm = Math.min(sx, sz), rmax = (o.rmax || 0.6) + t, rr = o.rr || 0, gap = o.gap;
  return Fn([-rmax * sx, yc - h, -rmax * sz, rmax * sx, yc + h, rmax * sz], (x, y, z) => {
    const th = Math.atan2(z / sz, x / sx), rho = Math.hypot(x / sx, z / sz);
    const wx = Math.abs(rho - Rf(th, y)) * sm - t + rr, wy = Math.abs(y - yc) - h / 2 + rr;
    let d = Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - rr;
    if (gap) d = Math.max(d, gap(th));      // gap(th) > 0 cuts the band (brails broken at the shoulders)
    return d * 0.85;
  }, m);
}
// elliptical torus: ring of radius R (on the unit ellipse sx, sz), tube r, at height yc
function ETor(R, r, yc, m, sx = 1, sz = 1) {
  const sm = Math.min(sx, sz), e = (R + r) * Math.max(sx, sz);
  return Fn([-e, yc - r, -e, e, yc + r, e], (x, y, z) => (Math.hypot((Math.hypot(x / sx, z / sz) - R) * sm, y - yc) - r) * 0.9, m);
}
// a capsule along Y with an elliptical section (CapsuleGeometry(r, len).scale(1, 1, sz))
function LCap(cy, r, len, m, sz = 1, mod, amp) {
  const P = [];
  for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI / 2; P.push([r * Math.sin(a), cy - len / 2 - r * Math.cos(a)]); }
  for (let k = 8; k >= 0; k--) { const a = k / 8 * Math.PI / 2; P.push([r * Math.sin(a), cy + len / 2 + r * Math.cos(a)]); }
  return Lathe(P, m, { sz, mod, amp });
}
// hex head (bolt or nut): axis +Z in a frame placed by Xf
function Hex(z0, r, h, m, round = 0.0015) {
  const ch = [];
  for (let k = 0; k < 3; k++) ch.push(Box([0, 0, z0 + h / 2], [r * 0.866, r * 2, h / 2], round, m, [0, 0, k * Math.PI / 3]));
  return I(0, ...ch);
}
// A WING NUT as cast, shaft along local +Z (unit = the procedural WING_PROTO's metres)
function WingNut(s, m = M.BRASS) {
  const k = x => x * s;
  return U(k(0.004),
    Cone([0, 0, 0], [0, 0, k(0.040)], k(0.032), k(0.026), m),
    Sph([0, 0, k(0.036)], k(0.020), m),
    Cap([0, 0, k(0.03)], [0, 0, k(0.062)], k(0.010), k(0.009), m),
    Box([k(0.042), k(0.012), k(0.018)], [k(0.020), k(0.022), k(0.0045)], k(0.004), m, [0, 0, -0.35]),
    Box([-k(0.042), k(0.012), k(0.018)], [k(0.020), k(0.022), k(0.0045)], k(0.004), m, [0, 0, 0.35]));
}
// a frame buckle (rounded rectangle loop) in the XY plane, facing +Z, w x h outer
function Buckle(w, h, t, m = M.BRASS, prong = true) {
  const o = Box([0, 0, 0], [w / 2, h / 2, t], t * 0.6, m), i = Box([0, 0, 0], [w / 2 - 2 * t, h / 2 - 2 * t, t * 3], t * 0.5, m);
  const b = Sub(0.001, o, i);
  return prong ? U(0.001, b, Cap([-w * 0.25, 0, t * 0.8], [w * 0.36, 0, t * 0.8], t * 0.55, t * 0.5, m)) : b;
}

// ---- noise for paint masks (deterministic, ours) ----------------------------------------------
function h3(x, y, z, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(s | 0, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vn(x, y, z, s) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = x - X, fy = y - Y, fz = z - Z;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h3(X, Y, Z, s), h3(X + 1, Y, Z, s), u), L(h3(X, Y + 1, Z, s), h3(X + 1, Y + 1, Z, s), u), v),
    L(L(h3(X, Y, Z + 1, s), h3(X + 1, Y, Z + 1, s), u), L(h3(X, Y + 1, Z + 1, s), h3(X + 1, Y + 1, Z + 1, s), u), v), w);
}
export function fbm(x, y, z, f, s, oct = 4) {
  let a = 0, w = 0.5, t = 0;
  for (let i = 0; i < oct; i++) { a += w * vn(x * f, y * f, z * f, s + i * 17); t += w; w *= 0.5; f *= 2.03; }
  return a / t;
}

// ---- THE PAINT ----------------------------------------------------------------------------------
// sRGB. Colours are the procedural Sal's, read off its materials and vertex tints, so the
// sculpted man is the same man: copper bonnet, brass fittings, a salt-bleached tan dress
// over a blue duck underlayer, white herringbone tape, dark bridle leather, black rubber.
const isM = (S, id) => (S.ma === id ? 1 - S.mw : 0) + (S.mb === id ? S.mw : 0);
const metalOf = S => (METAL[S.ma] || 0) * (1 - S.mw) + (METAL[S.mb] || 0) * S.mw;
// verdigris: copper and brass, in the crevices and in patches (mask shared with the emit)
const verdK = S => (isM(S, M.COPPER) + isM(S, M.BRASS)) * sst(0.06, 0.55, -S.k + 0.35 * (1 - S.ao)) * sst(0.45, 0.68, fbm(S.x, S.y, S.z, 9, 101, 3));
// lead oxide bloom: white, in patches and the crevices
const oxK = S => isM(S, M.LEAD) * clamp(0.28 * sst(0.5, 0.75, fbm(S.x, S.y, S.z, 22, 131, 3)) + 0.5 * sst(0.05, 0.5, -S.k), 0, 1);
export const metalEmit = S => metalOf(S) * (1 - 0.85 * verdK(S)) * (1 - 0.7 * oxK(S));

function PAINT(extra = []) {
  return {
    kScale: 0.004, aoAlb: 0.45,
    mats: {
      [M.COPPER]: { c: [0.60, 0.35, 0.235], ro: 0.42 },
      [M.BRASS]: { c: [0.72, 0.57, 0.31], ro: 0.36 },
      [M.LEAD]: { c: [0.30, 0.30, 0.315], ro: 0.78 },
      [M.STEEL]: { c: [0.34, 0.35, 0.37], ro: 0.48 },
      [M.SOLDER]: { c: [0.44, 0.43, 0.41], ro: 0.62 },
      [M.CANVAS]: { c: [0.47, 0.37, 0.27], ro: 0.86 },
      [M.DUCK]: { c: [0.16, 0.24, 0.49], ro: 0.92 },
      [M.TAPE]: { c: [0.83, 0.80, 0.72], ro: 0.82 },
      [M.LEATHER]: { c: [0.29, 0.18, 0.105], ro: 0.62 },
      [M.RUBBER]: { c: [0.13, 0.135, 0.15], ro: 0.62 },
      [M.IVORY]: { c: [0.74, 0.68, 0.54], ro: 0.24 },
      [M.DARK]: { c: [0.035, 0.03, 0.028], ro: 0.5 },
      [M.SEAM]: { c: [0.30, 0.23, 0.165], ro: 0.52 }
    },
    layers: [
      // the DRESS: grime in the folds, the crests rubbed pale through the rubber coat,
      // salt bloom and a mottled coat
      { c: [0.36, 0.28, 0.20], a: 0.45, m: [['mat', M.CANVAS], ['fn', S => sst(0.45, 0.75, fbm(S.x, S.y, S.z, 7, 11, 4))]] },
      { c: [0.70, 0.66, 0.57], a: 0.35, m: [['mat', M.CANVAS], ['fn', S => sst(0.58, 0.78, fbm(S.x, S.y, S.z, 4, 12, 4))]] },
      { c: [0.19, 0.14, 0.095], a: 0.75, ro: 0.92, m: [['mat', M.CANVAS], ['cav', 0.05, 0.6]] },
      { c: [0.66, 0.56, 0.42], a: 0.7, ro: 0.62, m: [['mat', M.CANVAS], ['cvx', 0.06, 0.4]] },
      // the blue duck and the white tape take dirt in the creases
      { c: [0.08, 0.11, 0.22], a: 0.7, m: [['mat', M.DUCK], ['cav', 0.05, 0.6]] },
      { c: [0.30, 0.40, 0.64], a: 0.55, m: [['mat', M.DUCK], ['cvx', 0.06, 0.4]] },
      { c: [0.52, 0.48, 0.40], a: 0.65, m: [['mat', M.TAPE], ['cav', 0.04, 0.5]] },
      { c: [0.70, 0.66, 0.56], a: 0.35, m: [['mat', M.TAPE], ['fn', S => sst(0.5, 0.75, fbm(S.x, S.y, S.z, 10, 14, 3))]] },
      // leather: scuffed pale on every edge, black in the creases
      { c: [0.47, 0.33, 0.20], a: 0.7, ro: 0.42, m: [['mat', M.LEATHER], ['cvx', 0.05, 0.45]] },
      { c: [0.10, 0.06, 0.035], a: 0.7, m: [['mat', M.LEATHER], ['cav', 0.05, 0.5]] },
      { c: [0.27, 0.27, 0.28], a: 0.6, ro: 0.45, m: [['mat', M.RUBBER], ['cvx', 0.06, 0.45]] },
      // COPPER: tarnished dark in every crevice, a mottled patina, polished bright on the
      // edges the hands and the hose rub
      { c: [0.36, 0.19, 0.12], a: 0.75, ro: 0.58, m: [['mat', M.COPPER], ['fn', S => sst(0.36, 0.66, fbm(S.x, S.y, S.z, 6, 21, 4))]] },
      { c: [0.24, 0.13, 0.09], a: 0.5, ro: 0.7, m: [['mat', M.COPPER], ['fn', S => sst(0.55, 0.8, fbm(S.x * 0.6, S.y * 3, S.z * 0.6, 9, 24, 3)) * sst(-0.2, 0.4, -S.ny)]] },
      { c: [0.26, 0.13, 0.08], a: 0.85, ro: 0.72, m: [['mat', M.COPPER], ['cav', 0.04, 0.5]] },
      { c: [0.86, 0.56, 0.40], a: 0.7, ro: 0.2, m: [['mat', M.COPPER], ['cvx', 0.10, 0.6]] },
      // BRASS: dull mottling, tarnish in the crevices, bright on every rim and bolt head
      { c: [0.46, 0.36, 0.18], a: 0.7, ro: 0.55, m: [['mat', M.BRASS], ['fn', S => sst(0.38, 0.70, fbm(S.x, S.y, S.z, 8, 22, 4))]] },
      { c: [0.30, 0.22, 0.09], a: 0.85, ro: 0.74, m: [['mat', M.BRASS], ['cav', 0.04, 0.5]] },
      { c: [0.95, 0.82, 0.52], a: 0.75, ro: 0.18, m: [['mat', M.BRASS], ['cvx', 0.10, 0.6]] },
      // verdigris (the emit takes the metal off it too)
      { c: [0.31, 0.54, 0.45], a: 0.9, ro: 0.88, m: [['fn', verdK]] },
      { c: [0.62, 0.62, 0.59], a: 0.75, ro: 0.95, m: [['fn', oxK]] },
      { c: [0.20, 0.20, 0.21], a: 0.5, m: [['mat', M.STEEL], ['cav', 0.05, 0.5]] },
      ...extra,
      // deep occlusion: the inside of every fold and fitting
      { c: [0.02, 0.018, 0.015], a: 0.45, m: [['ao', 0.35, 0.95]] }
    ]
  };
}

// ---- CLOTH: folds as a radial modulation ------------------------------------------------------
// crease(u): round crests (+1 at u = PI), sharp V valleys (-1 at u = 0) — canvas folds over
// itself in a sharp line and bellies round between.
const crease = u => 2 * Math.abs(Math.sin(u * 0.5)) - 1;
const win = (y, top, bot, fade) => sst(bot - fade, bot, y) * (1 - sst(top, top + fade, y));
// spec: { drape: [{ n, amp, top, bot, fade, tw, fy, ph }], gath: [{ top, bot, fade, lam, amp, th, k, wv, ph }] }
function folds(spec) {
  const D = spec.drape || [], G = spec.gath || [];
  return (th, y) => {
    let o = 0;
    for (let i = 0; i < D.length; i++) {
      const d = D[i], w = win(y, d.top, d.bot, d.fade);
      if (w <= 0) continue;
      o += d.amp * w * crease(d.n * th + d.tw * Math.sin(y * d.fy + d.ph) + 0.7 * Math.sin(2 * th + y * 3 + d.ph));
    }
    // GATHERS are not rings: each fold runs part way round, fades out, and the next one
    // picks up a little higher (breakup); the spacing wanders (the phase is warped by a
    // slow noise round the limb) and so does the depth
    const cx = Math.cos(th), cz = Math.sin(th);
    for (let i = 0; i < G.length; i++) {
      const g = G[i], w = win(y, g.top, g.bot, g.fade);
      if (w <= 0) continue;
      const side = g.k + (1 - g.k) * Math.pow(0.5 + 0.5 * Math.cos(th - g.th), 1.5);
      const sd = 37 * i + (g.ph * 100 | 0);
      const warp = 5.0 * (vn(cx * 1.6 + 7, cz * 1.6, y * 7 / g.lam * 0.05 + 3, sd) - 0.5);
      const brk = sst(0.22, 0.62, vn(cx * 2.4, cz * 2.4 + 5, y * 0.55 / g.lam, sd + 9));
      const dep = 0.55 + 0.9 * vn(cx * 3.1 + 2, cz * 3.1, y * 0.35 / g.lam, sd + 21);
      o += g.amp * w * side * (0.25 + 0.75 * brk) * dep * crease(TAU * y / g.lam + g.wv * Math.sin(2 * th + g.ph) + 0.6 * g.wv * Math.sin(3 * th - g.ph * 1.3) + warp);
    }
    return o;
  };
}
// the limb segment profile as the procedural segGeo lathes it: rounded caps both ends
function segProf(len, r, prof, capT = 0.45, capB = 0.62, rings = 72) {
  const pts = [], rT = r * prof(0), rB = r * prof(1);
  for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI / 2; pts.push([rB * Math.sin(a), -len - rB * capB * Math.cos(a)]); }
  for (let i = rings - 1; i >= 1; i--) pts.push([r * prof(i / rings), -len * (i / rings)]);
  for (let k = 6; k >= 0; k--) { const a = k / 6 * Math.PI / 2; pts.push([rT * Math.sin(a), rT * capT * Math.cos(a)]); }
  return pts;
}


// =============================================================================================
// THE HELMET (neck frame). The bonnet keeps diver.js's Mark V profile EXACTLY (HP) — the
// procedural port glass and its dark recess are kept and sit at offsets measured off it.
// =============================================================================================
export const HP = [
  [0.000, 0.000], [0.246, 0.000], [0.256, 0.045], [0.262, 0.085], [0.300, 0.115], [0.352, 0.165],
  [0.400, 0.235], [0.430, 0.315], [0.444, 0.400], [0.448, 0.480], [0.440, 0.560], [0.418, 0.635],
  [0.382, 0.705], [0.330, 0.775], [0.262, 0.838], [0.176, 0.892], [0.086, 0.936], [0.000, 0.952]
];
export const hR = y => {
  for (let i = 2; i < HP.length; i++) if (y <= HP[i][1]) {
    const [r0, y0] = HP[i - 1], [r1, y1] = HP[i];
    return r0 + (r1 - r0) * clamp((y - y0) / (y1 - y0), 0, 1);
  }
  return 0;
};
// [rimR, x, y, z, rx, ry, bolts, bars] — diver.js PORTS + porthole() calls
const PORTS = [[0.198, 0, 0.455, 0.402, -0.08, 0, 12, false], [0.132, 0.376, 0.470, 0.128, 0, 1.245, 8, true],
  [0.132, -0.376, 0.470, 0.128, 0, -1.245, 8, true], [0.126, 0, 0.818, 0.172, -1.16, 0, 8, true]];
const portAxis = q => mulRv(eul(q[4], q[5], 0), [0, 0, 1]);
function portOff(q) {        // diver.js sOff: march out along the axis to the copper
  const a = portAxis(q);
  for (let t = -0.05; t < 0.2; t += 0.001) if (Math.hypot(q[1] + a[0] * t, q[3] + a[2] * t) > hR(q[2] + a[1] * t)) return t;
  return 0.045;
}
function port(q) {
  const [rimR, x, y, z, rx, ry, nb, bars] = q, so = portOff(q), ch = [];
  // the brass FRAME: a heavy cast ring standing off the bonnet, bored for the glass,
  // its face chamfered, a raised bezel lip round the glass
  ch.push(Sub(0.002, Cone([0, 0, so - 0.07], [0, 0, so + 0.016], rimR * 1.10, rimR * 1.0, M.BRASS),
    Cap([0, 0, so - 0.2], [0, 0, so + 0.2], rimR * 0.835, rimR * 0.835, M.BRASS)));
  ch.push(Tor([0, 0, so + 0.014], rimR * 0.93, rimR * 0.11, M.BRASS, yTo([0, 0, 1])));
  // the copper FLANGE the frame is sweated onto, soldered to the bonnet (SOLDER fillet)
  ch.push(Tor([0, 0, so - 0.010], rimR * 1.20, rimR * 0.085, M.COPPER, yTo([0, 0, 1])));
  ch.push(Tor([0, 0, so - 0.019], rimR * 1.28, rimR * 0.03, M.SOLDER, yTo([0, 0, 1])));
  // bezel bolts: washer + hex head + a proud thread end
  for (let i = 0; i < nb; i++) {
    const a = i / nb * TAU, bx = Math.cos(a) * rimR * 1.06, by = Math.sin(a) * rimR * 1.06, r = rimR * 0.085;
    ch.push(Cap([bx, by, so + 0.012], [bx, by, so + 0.017], r * 1.35, r * 1.35, M.BRASS));
    ch.push(Xf([bx, by, 0], eul(0, 0, a * 0.7 + i), Hex(so + 0.016, r, r * 0.9, M.BRASS)));
    ch.push(Sph([bx, by, so + 0.016 + r * 0.9], r * 0.45, M.BRASS));
  }
  // guard bars bowing out over the glass, each landing on a cast foot
  if (bars) for (let i = -1; i <= 1; i++) {
    const off = i * rimR * 0.56, R = rimR * 0.98, t = rimR * 0.085, h = so + 0.004;
    ch.push(Path([[off, -R, h], [off * 1.06, -R * 0.55, h + 0.046], [off * 1.09, 0, h + 0.062], [off * 1.06, R * 0.55, h + 0.046], [off, R, h]], t, M.BRASS, 16));
    for (const sy of [-1, 1]) ch.push(E([off, sy * R, h + 0.004], [t * 1.6, t * 1.8, t * 1.3], M.BRASS));
  }
  return Xf([x, y, z], eul(rx, ry, 0), U(0.006, ...ch));
}
function helmetSpec() {
  // THE BONNET: spun copper, the profile exact, raised a hair at the five spun ridges, a
  // planishing dimple field on it (bake-only) and three real dents (mesh) — knocked
  // against a gunwale, a ladder, a wreck.
  const ridges = [0.235, 0.400, 0.520, 0.635, 0.775];
  const spun = Lathe(smoothProf(HP, 3), M.COPPER, {
    amp: 0.004, lip: 0.92,
    mod: (th, y) => { let o = 0; for (const yy of ridges) o += 0.0022 * gau((y - yy) / 0.0055); return o * sst(0.1, 0.2, y); }
  });
  const dents = [[[-0.25, 0.70, -0.30], 0.07], [[0.36, 0.30, -0.25], 0.06], [[0.10, 0.86, -0.18], 0.05]].map(([c, r]) => {
    const rr = hR(c[1]), k = (rr + r * 0.94) / Math.hypot(c[0], c[2]), p = [c[0] * k, c[1], c[2] * k];
    return Sph(p, r, M.COPPER);
  });
  let bonnet = Sub(0.04, spun, ...dents);
  bonnet = Disp([
    { type: 'fbm', amp: 0.0012, f: 4, oct: 2, seed: 5 },                                  // not quite true: raised by hand
    { type: 'pits', bake: true, amp: 0.00016, f: 45, dens: 0.85, r: 0.6, seed: 6 },      // planishing hammer
    { type: 'fbm', bake: true, amp: 0.00018, f: 260, oct: 2, seed: 7 }
  ], bonnet);
  const fit = [];
  // NECK RING: the bonnet's breech ring, interrupted-thread lugs, 12 bolts, 4 dogs
  fit.push(Cone([0, -0.004, 0], [0, 0.088, 0], 0.278, 0.268, M.BRASS));
  fit.push(Ring([0, 0.084, 0], 0.270, 0.026, M.BRASS));
  fit.push(Ring([0, 0.096, 0], 0.262, 0.012, M.SOLDER));                // the sweat joint to the copper
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5) / 12 * TAU, dir = [Math.cos(a), 0, Math.sin(a)];
    fit.push(Xf([dir[0] * 0.276, 0.036, dir[2] * 0.276], zTo(dir, i), Cap([0, 0, 0], [0, 0, 0.006], 0.022, 0.022, M.BRASS), Hex(0.005, 0.0165, 0.014, M.BRASS)));
  }
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + 0.4;
    fit.push(Box([Math.cos(a) * 0.29, 0.006, Math.sin(a) * 0.29], [0.05, 0.018, 0.025], 0.006, M.BRASS, [0, -a, 0]));
  }
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + 0.785, dir = [Math.cos(a), 0, Math.sin(a)];
    fit.push(Xf([dir[0] * 0.290, 0.068, dir[2] * 0.290], zTo(dir, 0), WingNut(0.9)));
  }
  // the four ports
  for (const q of PORTS) fit.push(port(q));
  // faceplate dogs: three wing nuts round the front light
  // (seated on the copper: the procedural z = 0.300 buried them in the bonnet)
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094, x = Math.sin(a) * 0.300, y = 0.455 + Math.cos(a) * 0.300, z = Math.sqrt(Math.max(0, hR(y) ** 2 - x * x));
    fit.push(Xf([x, y, z - 0.004], zTo(norm([x, 0.35 * (y - 0.45), z]), -a), WingNut(0.85)));
  }
  // THE FACEPLATE IS A DOOR: hinge knuckles + pin on the diver's right, hasp + swing bolt +
  // dogged wing nut on his left
  {
    const HX = 0.225, Y = 0.455, HZ = 0.345;
    for (const dy of [-0.055, 0.055]) fit.push(Box([HX, Y + dy, HZ], [0.026, 0.021, 0.020], 0.005, M.BRASS, [0, 0.55, 0]));
    fit.push(Cap([HX + 0.012, Y - 0.088, HZ + 0.012], [HX + 0.012, Y + 0.088, HZ + 0.012], 0.013, 0.013, M.BRASS));
    fit.push(Sph([HX + 0.012, Y + 0.090, HZ + 0.012], 0.017, M.BRASS));
    fit.push(Box([-HX, Y + 0.010, HZ], [0.023, 0.0375, 0.018], 0.005, M.BRASS, [0, -0.55, 0]));
    fit.push(Cap([-HX - 0.006 + 0.006, Y - 0.069, HZ + 0.006 - 0.009], [-HX - 0.006 - 0.006, Y + 0.045, HZ + 0.006 + 0.009], 0.011, 0.011, M.BRASS));
    fit.push(Xf([-HX - 0.014, Y + 0.052, HZ + 0.014], zTo([Math.sin(-0.55), 0, Math.cos(-0.55)], 0), WingNut(0.7)));
  }
  // the brass crest strap, faceplate to top light, riveted down
  {
    const P = [];
    for (let k = 0; k <= 8; k++) { const y = 0.665 + 0.085 * k / 8; P.push([0, y, hR(y) + 0.004]); }
    fit.push(Path(P, 0.016, M.BRASS));
    for (const k of [1, 7]) fit.push(Sph([0, P[k][1], P[k][2] + 0.013], 0.008, M.BRASS));
  }
  // THE EXHAUST VALVE, right of the faceplate: sweated flange, barrel, hex body, knurled
  // adjusting cap and the spitcock lever (axis radial off the bonnet at the vent)
  {
    const d = norm([-0.375, 0, 0.245]), B = [d[0] * hR(0.315), 0.315, d[2] * hR(0.315)];
    const knurl = Fn([-0.05, -0.05, 0.075], (x, y, z) => {
      const rr = 0.036 * (1 + 0.035 * Math.abs(Math.cos(14 * Math.atan2(y, x))));
      const wx = Math.hypot(x, y) - rr, wz = Math.abs(z - 0.094) - 0.016;
      return (Math.min(Math.max(wx, wz), 0) + Math.hypot(Math.max(wx, 0), Math.max(wz, 0))) * 0.8;
    }, M.COPPER);
    knurl.bb = [-0.045, -0.045, 0.074, 0.045, 0.045, 0.114];
    fit.push(Xf(B, zTo(d, 0),
      Cone([0, 0, -0.006], [0, 0, 0.012], 0.074, 0.062, M.BRASS),
      Tor([0, 0, -0.002], 0.074, 0.006, M.SOLDER, yTo([0, 0, 1])),
      Cap([0, 0, 0.008], [0, 0, 0.058], 0.053, 0.050, M.BRASS),
      Hex(0.058, 0.046, 0.020, M.BRASS, 0.002),
      knurl,
      Sph([0, 0, 0.110], 0.018, M.BRASS)));
    fit.push(Path([add(B, d, 0.04).map((v, i) => i === 1 ? v - 0.045 : v), add(add(B, d, 0.045).map((v, i) => i === 1 ? v - 0.06 : v), [0.02, 0, 0.045])], 0.006, M.BRASS));
  }
  // THE AIR INLET: gooseneck elbow out of the back of the bonnet, hex nuts both ends, the
  // non-return valve body at its middle (the feed hose's ferrule meets its lower end)
  {
    const P0 = [-0.323, 0.452, -0.306], P3 = [-0.352, 0.378, -0.338];
    const G = crPts([P0, [-0.352, 0.476, -0.338], [-0.380, 0.452, -0.366], [-0.372, 0.408, -0.358], P3], 20);
    fit.push(Path(G, 0.030, M.BRASS));
    fit.push(Xf(P0, zTo([-0.72, 0.05, -0.69]), Hex(-0.012, 0.048, 0.022, M.BRASS)));
    fit.push(Xf(P3, zTo(sub(G[20], G[18])), Hex(-0.015, 0.040, 0.030, M.BRASS)));
    fit.push(Xf(G[10], zTo(sub(G[9], G[11])), Cap([0, 0, -0.019], [0, 0, 0.019], 0.041, 0.041, M.BRASS)));
  }
  // the telephone/chin-button boss at the back right, and its copper dome
  fit.push(Xf([0.28, 0.30, -0.30], eul(0, 0.6, 0.5), Cone([0, -0.05, 0], [0, 0.05, 0], 0.056, 0.05, M.BRASS)));
  fit.push(Sph([0.30, 0.365, -0.325], 0.042, M.COPPER));
  // rivet ring low on the bonnet: domed heads standing off the copper
  for (let i = 0; i < 16; i++) { const a = (i + 0.5) / 16 * TAU, r = hR(0.24); fit.push(Sph([Math.cos(a) * (r + 0.004), 0.24, Math.sin(a) * (r + 0.004)], 0.016, M.BRASS)); }
  // solder beads where the bonnet meets the breech ring
  return U(0.006, bonnet, ...fit);
}
export { Sph, E, Box, Cap, Cone, Tor, U, Sub, SubM, I, Xf, Pl, Fn, Disp, yTo, zTo, eul, mulRv, crPts, Path, Ring, polySDF, smoothProf, Lathe, Slab, Band, Hex, WingNut, Buckle, PAINT, crease, win, folds, segProf, clamp, sst, gau, norm, cross, add, sub, dot, TAU, compile };

// =============================================================================================
// THE CORSELET (spine frame): brass breastplate from the skirt up, the blue duck dress
// blousing over the belt below it, the dress canvas under the brass, the brails and their
// twelve wing nuts, the cast-lead front weight on its hooks, the webbing, the harness straps
// =============================================================================================
const BP = [
  [0.392, 0.055], [0.414, 0.092], [0.432, 0.158], [0.462, 0.240], [0.524, 0.328], [0.588, 0.424], [0.612, 0.500],
  [0.594, 0.578], [0.530, 0.648], [0.420, 0.706], [0.322, 0.746], [0.276, 0.772], [0.274, 0.816]
];
const bpR = y => {
  if (y <= BP[0][1]) return BP[0][0];
  for (let i = 1; i < BP.length; i++) if (y <= BP[i][1]) { const [r0, y0] = BP[i - 1], [r1, y1] = BP[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); }
  return BP[BP.length - 1][0];
};
function corseletSpec() {
  const ZS = 0.78, SX = 0.93, SKIRT = 0.395, ch = [];
  // the brass: one spun-and-beaten shell, the same profile as diver.js, its rim ROLLED
  const up = [[bpR(SKIRT) + 0.004, SKIRT - 0.004]].concat(BP.filter(q => q[1] > SKIRT + 0.01)).concat([[0.268, 0.818]]);
  const shell = Disp([
    { type: 'fbm', amp: 0.0010, f: 5, oct: 2, seed: 31 },
    { type: 'pits', bake: true, amp: 0.00014, f: 40, dens: 0.8, r: 0.6, seed: 32 }
  ], Lathe(smoothProf(up, 3), M.BRASS, { sx: SX, sz: ZS }));
  ch.push(shell);
  ch.push(ETor(bpR(SKIRT) + 0.007, 0.013, SKIRT, M.BRASS, SX, ZS));                 // rolled skirt edge
  ch.push(Ring([0, 0.804, 0], 0.279, 0.025, M.BRASS));                              // neck collar the helmet locks to
  for (let i = 0; i < 12; i++) { const a = (i + 0.5) / 12 * TAU; ch.push(Sph([Math.cos(a) * 0.288 * SX, 0.778, Math.sin(a) * 0.288 * ZS], 0.0135, M.BRASS)); }
  // a stamped maker's plate on the chest, four rivets (the corselet's one bit of lettering
  // space; left plain — the sea took the name)
  {
    const y = 0.60, r = bpR(y), z = r * ZS, R = zTo([0, 0.32, 1]);
    ch.push(Xf([0, y, z - 0.004], R, Box([0, 0, 0.002], [0.062, 0.030, 0.004], 0.003, M.BRASS),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, v]) => Sph([u * 0.052, v * 0.021, 0.006], 0.005, M.BRASS))));
  }
  // FOUR BRAILS pressing the gasket, broken at the shoulders, twelve studs + wing nuts
  const yb = SKIRT + 0.030, rb = bpR(yb);
  ch.push(Band(() => rb + 0.010, yb, 0.044, 0.0075, M.BRASS, { sx: SX, sz: ZS, rr: 0.003, rmax: 0.7,
    gap: th => { const w = ((th / (TAU / 4)) % 1 + 1) % 1; return 0.02 - Math.min(w, 1 - w) * 0.35 > 0 ? 0.01 : -1; } }));
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5) / 12 * TAU, cx = Math.cos(a), sz = Math.sin(a);
    const pos = [cx * (rb + 0.018) * SX, yb, sz * (rb + 0.018) * ZS], dir = norm([cx / SX, 0, sz / ZS]);
    ch.push(Xf(pos, zTo(dir, a), Cap([0, 0, -0.01], [0, 0, 0.004], 0.011, 0.011, M.BRASS), WingNut(0.62)));
  }
  // the gasket: rubber squeezed out under the skirt
  ch.push(ETor(bpR(SKIRT) - 0.004, 0.011, SKIRT - 0.016, M.RUBBER, SX, ZS));
  // the dress canvas under the brass (shows at the arm holes and over the shoulders' flanks)
  ch.push(Lathe(smoothProf(BP, 2), M.CANVAS, { sx: SX * 0.985, sz: ZS * 0.985 }));
  // THE DRESS TORSO, blue duck, air-filled: ballooning below the corselet, pushed down onto
  // the belt and folded over itself in creases that wander round the body
  {
    const tk = [[0.000, -0.16], [0.336, -0.17], [0.398, -0.06], [0.464, 0.10], [0.536, 0.30], [0.582, 0.470], [0.556, 0.560], [0.000, 0.572]];
    const blouse = (th, y) => {
      const env = sst(-0.15, -0.08, y) * (1 - sst(0.16, 0.30, y));
      const cr = Math.sin(y * 88 + 1.3 * Math.sin(2 * th + 0.4) + 0.7 * Math.sin(5 * th));
      const r = 0.45;
      return r * env * (0.040 * Math.sign(cr) * Math.pow(Math.abs(cr), 0.6) + 0.024) * 0.55
        + 0.004 * crease(6 * th + 2 * Math.sin(y * 9)) * sst(0.15, 0.3, y);
    };
    ch.push(Disp([{ type: 'fn', bake: true, amp: 0.0015, fn: (x, y, z) => 0.0015 * crease(Math.atan2(z, x) * 23 + y * 140 + 3 * Math.sin(y * 31 + x * 13)) * sst(0.4, 0.7, Math.sin(y * 17 + Math.atan2(z, x) * 3)) }],
      Lathe(smoothProf(tk, 2), M.DUCK, { sz: 0.66, mod: blouse, amp: 0.03, lip: 0.6 })));
  }
  // THE FRONT WEIGHT: ~16 kg of sand-cast lead bent to the chest, a raised cast border,
  // hung on two hooks from the skirt studs
  {
    const W = 0.205, H = 0.29, Y0 = 0.035, Z0 = 0.43, BEND = 1.1, T = 0.025;
    const surf = (x, v) => Z0 - BEND * x * x - 0.10 * (1 - clamp(v / H, 0, 1));
    const half = v => W * (0.84 + 0.16 * clamp(v / H, 0, 1) + 0.05 * sst(0.8, 1, v / H));
    const slab = Fn([-0.25, Y0 - 0.02, 0.2, 0.25, Y0 + H + 0.02, 0.5], (x, y, z) => {
      const v = y - Y0, top = H - 0.018 * (1 - (x / W) ** 2) * sst(0.6, 1, v / H);
      const zc = surf(x, v), rr = 0.014;
      const qx = Math.abs(x) - half(v) + rr, qy = Math.abs(v - top / 2) - top / 2 + rr, qz = Math.abs(z - zc) - T + rr;
      const o = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rr;
      // the cast border: a raised bead round the face, and the face sunk a hair inside it
      const inner = Math.max(Math.abs(x) - half(v) + 0.03, Math.abs(v - top / 2) - top / 2 + 0.03);
      return (o + (inner < 0 && z > zc ? 0.0025 * sst(-0.012, 0, inner) - 0.0025 : 0)) * 0.7;
    }, M.LEAD);
    ch.push(Disp([{ type: 'pits', bake: true, amp: 0.0006, f: 90, dens: 0.6, r: 0.35, seed: 41 }, { type: 'fbm', bake: true, amp: 0.0004, f: 120, oct: 2, seed: 42 }], slab));
    for (const hx of [-0.15, 0.15]) {
      const top = Y0 + H - 0.006, zf = Z0 + 0.012 - BEND * hx * hx;
      ch.push(Tor([hx, top + 0.012, zf - 0.006], 0.020, 0.008, M.LEAD, yTo([1, 0, 0])));
      ch.push(Path([[hx, top + 0.004, zf + 0.004], [hx * 1.01, top + 0.040, zf + 0.030], [hx * 1.03, yb - 0.030, zf + 0.050], [hx * 1.03, yb - 0.004, zf + 0.056]], 0.0068, M.BRASS, 10));
    }
    // the webbing strap round the torso behind it, buckled at his left side
    ch.push(Band(() => 0.500, 0.105, 0.050, 0.004, M.LEATHER, { sz: 0.665, rr: 0.002, rmax: 0.55 }));
    ch.push(Xf([0.497, 0.105, 0.03], zTo(norm([1, 0, 0.12]), Math.PI / 2), Buckle(0.07, 0.062, 0.0055)));
  }
  // the harness straps lying on the brass, buckled above the skirt
  for (const sx of [-1, 1]) {
    const R = eul(-0.36, 0, sx * 0.05);
    ch.push(Box([sx * 0.20, 0.515, 0.432], [0.036, 0.085, 0.008], 0.003, M.LEATHER, null, R));
    ch.push(Xf([sx * 0.20, 0.445, 0.444], R, Buckle(0.086, 0.05, 0.006)));
  }
  return U(0.005, ...ch);
}

// ---- THE HIPS (hips frame): duck trunks, the seat sag, the weight belt, lacing, D-rings ----
function hipsSpec() {
  const ch = [];
  const drape = folds({ drape: [{ n: 7, amp: 0.004, top: 0.2, bot: -0.45, fade: 0.05, tw: 1.4, fy: 6, ph: 2 }] });
  ch.push(LCap(0.02, 0.338, 0.16, M.DUCK, 0.86, drape, 0.006));
  // the seat sags where the air in the dress can't reach: canvas, rubbed pale
  ch.push(Disp([{ type: 'fn', bake: true, amp: 0.0016, fn: (x, y, z) => 0.0016 * crease(y * 120 + 4 * Math.sin(x * 14)) * sst(0, 0.2, -z) }],
    E([0, -0.140, -0.140], [0.268, 0.160, 0.172], M.CANVAS)));
  const trunkFold = folds({
    drape: [{ n: 6, amp: 0.0035, top: 0.0, bot: -0.40, fade: 0.05, tw: 1.0, fy: 5, ph: 0.4 }],
    gath: [{ top: -0.20, bot: -0.40, fade: 0.05, lam: 0.06, amp: 0.005, th: -Math.PI / 2, k: 0.25, wv: 1.6, ph: 0.7 }]
  });
  ch.push(LCap(-0.10, 0.348, 0.13, M.CANVAS, 0.86, trunkFold, 0.008));
  // THE WEIGHT BELT: bridle leather, welted edges, a cast frame buckle
  ch.push(Band(() => 0.368, 0.03, 0.20, 0.006, M.LEATHER, { sz: 0.90, rr: 0.003, rmax: 0.42 }));
  for (const yy of [-0.064, 0.124]) ch.push(ETor(0.374, 0.0085, 0.03 + yy, M.LEATHER, 1, 0.90));
  ch.push(Box([-0.02, 0.03, 0.336], [0.15, 0.059, 0.007], 0.003, M.LEATHER));
  ch.push(Xf([0, 0.03, 0.351], eul(0, 0, 0), Buckle(0.205, 0.165, 0.011, M.BRASS, false)));
  ch.push(Cap([-0.02, -0.052, 0.354], [-0.02, 0.112, 0.354], 0.0075, 0.0075, M.BRASS));
  ch.push(Cap([-0.012, 0.03, 0.359], [0.072, 0.03, 0.359], 0.0055, 0.005, M.BRASS));
  ch.push(Box([-0.13, 0.03, 0.344], [0.015, 0.07, 0.010], 0.003, M.LEATHER));
  // back lacing: two rows of brass eyelets, a criss-cross thong
  {
    const bz = -0.334, ys = [-0.035, 0.005, 0.045, 0.085];
    for (const yy of ys) for (const lx of [-0.052, 0.052]) ch.push(Tor([lx, yy, bz - 0.003], 0.0085, 0.0038, M.BRASS, yTo([0, 0, 1])));
    for (let i = 0; i < ys.length - 1; i++) for (const sx of [-1, 1]) ch.push(Cap([sx * 0.052, ys[i], bz - 0.007], [-sx * 0.052, ys[i + 1], bz - 0.007], 0.0045, 0.0045, M.LEATHER));
  }
  for (const sx of [-1, 1]) ch.push(Xf([sx * 0.318, -0.02, 0.13], eul(0, sx * 1.1, 0), Tor([0, 0, 0], 0.042, 0.011, M.BRASS, yTo([0, 0, 1]))));
  return U(0.004, ...ch);
}

// ---- THE PACK (spine.pack frame): back plate, steel tank, copper bottle, regulator, gauge ----
function packSpec() {
  const ch = [];
  ch.push(Box([0, 0.02, 0.075], [0.23, 0.30, 0.035], 0.012, M.LEATHER));
  ch.push(Xf([-0.03, 0, -0.10], eul(0, 0, 0), Disp([{ type: 'pits', bake: true, amp: 0.0004, f: 70, dens: 0.5, r: 0.3, seed: 51 }], LCap(0.01, 0.148, 0.34, M.STEEL, 1))));
  for (const yy of [-0.13, 0.15]) ch.push(Ring([-0.03, yy, -0.10], 0.150, 0.016, M.BRASS));
  ch.push(Cone([-0.03, 0.20, -0.10], [-0.03, 0.27, -0.10], 0.058, 0.05, M.BRASS));
  ch.push(Xf([0.215, 0, -0.045], eul(0, 0, 0), LCap(-0.03, 0.072, 0.20, M.COPPER, 1)));
  ch.push(Ring([0.215, 0.075, -0.045], 0.074, 0.013, M.BRASS));
  ch.push(Box([-0.02, 0.30, -0.02], [0.15, 0.085, 0.08], 0.010, M.STEEL));
  for (let i = 0; i < 4; i++) ch.push(Sph([-0.02 + (i % 2 ? 0.12 : -0.12), 0.30 + (i < 2 ? 0.06 : -0.06), -0.10], 0.007, M.BRASS));
  ch.push(Box([-0.02, 0.375, -0.02], [0.16, 0.0175, 0.0875], 0.006, M.LEATHER));
  for (const sx of [-1, 1]) ch.push(Box([sx * 0.20, 0.02, 0.115], [0.0275, 0.31, 0.010], 0.003, M.LEATHER));
  // the regulator's gauge: brass bezel, ivory face, dark needle at working pressure
  ch.push(Tor([0.195, 0.352, -0.158], 0.052, 0.013, M.BRASS, yTo([0, 0, 1])));
  ch.push(Cap([0.195, 0.352, -0.12], [0.195, 0.352, -0.168], 0.047, 0.047, M.IVORY));
  ch.push(Xf([0.195, 0.352, -0.1745], eul(0, 0, -0.6), Box([0, 0.014, 0], [0.0028, 0.017, 0.002], 0.001, M.DARK)));
  ch.push(Sph([0.195, 0.352, -0.174], 0.005, M.BRASS));
  return U(0.004, ...ch);
}

// =============================================================================================
// THE LIMBS. Frames are diver.js's limb() groups: root (shoulder/hip) -> mid (elbow/knee) at
// -up -> end (wrist/ankle) at -lo; +Z forward, +X outboard (the LEFT limbs are authored; the
// right arm/shin/boot/glove are the same meshes mirrored, scale.x = -1). theta = atan2(z, x):
// 0 outboard, PI/2 front, PI inboard, -PI/2 back. The elbow folds FORWARD (its crease is
// the front, theta PI/2); the knee folds BACK (its crease is behind it, theta -PI/2).
// =============================================================================================
const FRONT = Math.PI / 2, BACK = -Math.PI / 2, INB = Math.PI, OUTB = 0;
// fine creases, bake only: wrinkle lines across the limb near the joints, diagonal elsewhere
function fineCreases(len, joints, seed) {
  return { type: 'fn', bake: true, amp: 0.0016, fn: (x, y, z) => {
    const th = Math.atan2(z, x);
    let o = 0.0006 * crease(th * 9 + y * 60 + 2.2 * Math.sin(y * 23 + seed));
    for (const [yj, w, side] of joints) {
      const k = gau((y - yj) / w) * (0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.cos(th - side), 2));
      o += 0.0012 * k * crease(y * 210 + 2.5 * Math.sin(th * 3 + seed) + 1.2 * Math.sin(th * 7 - seed));
    }
    return o;
  } };
}
const canvasGrain = seed => ({ type: 'fbm', bake: true, amp: 0.00025, f: 180, oct: 2, seed });
// a profiled sleeve/trouser segment with sculpted folds; returns { node, R(th, y) }
function segment(len, r, prof, fl, m, joints, seed, o = {}) {
  const P = segProf(len, r, prof, o.capT, o.capB);
  const Rb = y => r * prof(clamp(-y / len, 0, 1));
  const node = Disp([fineCreases(len, joints, seed), canvasGrain(seed + 1)], Lathe(P, m, { mod: fl, amp: 0.012, lip: 0.62 }));
  return { node, R: (th, y) => Rb(y) + fl(th, y) };
}
// raised piping down a seam at angle th0, riding the folded surface
function piping(R, th0, y0, y1, rad, m) {
  const P = [];
  for (let k = 0; k <= 14; k++) { const y = y0 + (y1 - y0) * k / 14, rr = R(th0, y) + rad * 0.35; P.push([Math.cos(th0) * rr, y, Math.sin(th0) * rr]); }
  return Path(P, rad, m, 28);
}
function upperArmSpec(rig) {
  const A = rig.armL, len = A.up, r = A.r, prof = profOf(rig.P.upArm);
  const fl = folds({
    drape: [{ n: 5, amp: 0.0035, top: -0.03, bot: -len + 0.03, fade: 0.06, tw: 1.2, fy: 7, ph: 1 }],
    gath: [
      { top: -len * 0.76, bot: -len - 0.03, fade: 0.05, lam: 0.044, amp: 0.008, th: FRONT, k: 0.30, wv: 1.3, ph: 0.5 },   // elbow crook
      { top: 0.03, bot: -len * 0.16, fade: 0.04, lam: 0.05, amp: 0.006, th: INB, k: 0.35, wv: 1.6, ph: 2.1 }               // armpit
    ]
  });
  const S = segment(len, r, prof, fl, M.CANVAS, [[-len * 0.9, 0.06, FRONT], [-0.02, 0.05, INB]], 3);
  const ch = [S.node];
  ch.push(piping(S.R, OUTB, -0.02, -len + 0.02, 0.0065, M.CANVAS));
  // the blue duck gusset down the inner arm
  ch.push(E([-r * prof(0.54) * 0.80, -len * 0.54, 0], [0.050, len * 0.26, 0.064], M.DUCK));
  // the white herringbone tape band
  const yb = -len * 0.20, rb = r * prof(0.20) + 0.010;
  ch.push(Band(() => rb, yb, 0.058, 0.0055, M.TAPE, { rr: 0.003, rmax: 0.25 }));
  return U(0.006, ...ch);
}
function foreArmSpec(rig) {
  const A = rig.armL, len = A.lo, r = A.r, prof = profOf(rig.P.foreArm), rUp = r * profOf(rig.P.upArm)(1);
  const fl = folds({
    drape: [{ n: 5, amp: 0.003, top: -0.05, bot: -len + 0.04, fade: 0.06, tw: 1.4, fy: 8, ph: 2.5 }],
    gath: [
      { top: 0.08, bot: -len * 0.24, fade: 0.04, lam: 0.040, amp: 0.009, th: FRONT, k: 0.25, wv: 1.4, ph: 1.2 },   // the crook of the elbow
      { top: -len * 0.80, bot: -len - 0.04, fade: 0.04, lam: 0.034, amp: 0.005, th: OUTB, k: 0.6, wv: 1.8, ph: 0.3 } // bunched into the cuff
    ]
  });
  const S = segment(len, r, prof, fl, M.CANVAS, [[0, 0.07, FRONT], [-len, 0.05, OUTB]], 5);
  const ch = [S.node];
  // the JOINT BALL: canvas over the elbow, the upper sleeve's end radius, so a bent arm is
  // continuous (sculpted, so its folds are the same canvas)
  ch.push(Disp([fineCreases(0.2, [[0, 0.06, BACK]], 9)], Sph([0, 0.004, 0], rUp * 1.0, M.CANVAS)));
  ch.push(piping(S.R, OUTB, -0.03, -len + 0.03, 0.006, M.CANVAS));
  // the elbow's reinforcing patch: a second layer of canvas on the point of the elbow,
  // its edge turned under and stitched (SEAM paint on the edge)
  ch.push(E([0, -0.07, -r * prof(0.17) * 0.90], [0.080, 0.105, 0.026], M.SEAM));
  return U(0.007, ...ch);
}
// THE GLOVE (wrist frame): a pleated duck cuff bell gathered by a drawstring, a lace tape
// with brass eyelets, the welt, and a rubber gauntlet hand closed in a loose fist round a
// bar along Z (the lantern bail / the knife grip pass through it)
function gloveSpec() {
  const ch = [];
  const keys = [[0.150, 0.098], [0.118, 0.101], [0.100, 0.118], [0.060, 0.146], [0.030, 0.148], [0.004, 0.140], [-0.018, 0.126], [-0.034, 0.114]].sort((a, b) => a[0] - b[0]);
  const rAt = y => { let i = 1; while (i < keys.length - 1 && keys[i][0] < y) i++; const [y0, r0] = keys[i - 1], [y1, r1] = keys[i], u = clamp((y - y0) / (y1 - y0), 0, 1); return r0 + (r1 - r0) * u * u * (3 - 2 * u); };
  const yg = 0.118, n = 12, depth = 0.020;
  const prof = [];
  for (let k = 0; k <= 24; k++) { const y = -0.034 + (0.150 + 0.034) * k / 24; prof.push([rAt(y), y]); }
  const pleat = th => { const w = ((th / TAU * n) % 1 + 1) % 1; return 0.5 * (w < 0.78 ? w / 0.78 : (1 - w) / 0.22) + 0.5 * (0.5 - 0.5 * Math.cos(TAU * w)); };
  ch.push(Disp([canvasGrain(61)], Lathe(prof, M.DUCK, { amp: depth, lip: 0.55, mod: (th, y) => {
    const open = sst(0.004, 0.045, Math.abs(y - yg)) * sst(0.030, 0.056, y) * (1 - 0.7 * sst(0.128, 0.150, y));
    return (pleat(th + 0.10 * (y - yg) / 0.18 * Math.sin(3 * th)) - 0.55) * depth * open;
  } })));
  // the drawstring: a tarred cord round the gather, a knot and two whipped tails
  const rc = rAt(yg) + 0.005;
  ch.push(Ring([0, yg, 0], rc, 0.0055, M.LEATHER));
  const kx = rc * 1.02;
  ch.push(E([kx + 0.0055, yg, 0], [0.011, 0.009, 0.012], M.LEATHER));
  for (const [dz, L] of [[-0.010, 0.040], [0.009, 0.028]]) {
    ch.push(Path([[kx + 0.008, yg - 0.0055, dz * 0.4], [kx + 0.012, yg - L * 0.5, dz], [kx + 0.011, yg - L, dz * 1.3]], 0.005, M.LEATHER, 6));
    ch.push(Sph([kx + 0.011, yg - L, dz * 1.3], 0.007, M.LEATHER));
  }
  // lace tape with six brass eyelets, the cuff welt, the glove's rubber mouth
  ch.push(Band(() => 0.150, 0.034, 0.032, 0.0055, M.TAPE, { rr: 0.002, rmax: 0.2 }));
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; ch.push(Tor([Math.cos(a) * 0.1585, 0.034, Math.sin(a) * 0.1585], 0.0085, 0.0034, M.BRASS, yTo([Math.cos(a), 0, Math.sin(a)]))); }
  ch.push(Ring([0, -0.032, 0], 0.126, 0.015, M.LEATHER));
  ch.push(Cone([0, -0.030, 0], [0, -0.085, 0], 0.120, 0.105, M.RUBBER));
  // THE HAND: back of the hand outboard (+X), palm inboard, fingers curled round a bar
  // along Z at C, thumb over the index
  const C = [0.006, -0.205, 0.075], hand = [];
  hand.push(Box([0.014, -0.120, 0.058], [0.040, 0.058, 0.064], 0.032, M.RUBBER, [0, 0, 0.10]));
  const zs = [0.112, 0.080, 0.048, 0.016], Rc = 0.060;
  zs.forEach((z, i) => {
    const sc = [1.0, 1.05, 1.0, 0.86][i], ang = [62, 2, -70, -138].map(a => a * Math.PI / 180), rr = [0.0245, 0.0225, 0.0200].map(v => v * sc);
    const pts = ang.map((a, k) => [C[0] + Math.cos(a) * Rc * (k === 3 ? 0.88 : 1) * sc, C[1] + Math.sin(a) * Rc * sc - (1 - sc) * 0.02, C[2] + z - 0.064]);
    pts[0] = [0.046, -0.150 - (1 - sc) * 0.02, C[2] + z - 0.064];
    for (let k = 0; k < 3; k++) hand.push(Cap(pts[k], pts[k + 1], rr[k], k < 2 ? rr[k + 1] : rr[k] * 0.9, M.RUBBER));
    hand.push(Sph(pts[0], rr[0] * 1.15, M.RUBBER));            // knuckle
    hand.push(Sph(pts[1], rr[1] * 1.08, M.RUBBER));
  });
  // thumb: from the inboard heel of the palm, down and forward, pressed over the index
  hand.push(Cap([-0.018, -0.105, 0.105], [-0.032, -0.158, 0.135], 0.024, 0.021, M.RUBBER));
  hand.push(Cap([-0.032, -0.158, 0.135], [-0.006, -0.196, 0.140], 0.021, 0.018, M.RUBBER));
  hand.push(Sph([-0.032, -0.158, 0.135], 0.023, M.RUBBER));
  ch.push(Disp([{ type: 'fn', bake: true, amp: 0.0012, fn: (x, y, z) => 0.0012 * crease(y * 260 + 3 * Math.sin(z * 40)) * gau((y + 0.15) / 0.03) }, canvasGrain(63)], U(0.012, ...hand)));
  return U(0.004, ...ch);
}
function thighSpec(rig, left) {
  const L = rig.legL, len = L.up, r = L.r, prof = profOf(rig.P.thigh);
  const fl = folds({
    drape: [{ n: 6, amp: 0.004, top: -0.04, bot: -len + 0.04, fade: 0.06, tw: 1.1, fy: 6, ph: 0.8 }],
    gath: [
      { top: 0.04, bot: -len * 0.13, fade: 0.04, lam: 0.050, amp: 0.008, th: INB, k: 0.3, wv: 1.5, ph: 1.7 },        // groin
      { top: -len * 0.82, bot: -len - 0.04, fade: 0.04, lam: 0.042, amp: 0.009, th: BACK, k: 0.3, wv: 1.3, ph: 0.4 }    // behind the knee
    ]
  });
  const S = segment(len, r, prof, fl, M.CANVAS, [[-len * 0.95, 0.06, BACK], [0, 0.06, INB]], 7);
  const ch = [S.node];
  for (const th of [OUTB, INB]) ch.push(piping(S.R, th, -0.03, -len + 0.03, 0.0075, M.LEATHER));
  for (const th of [FRONT, BACK]) ch.push(piping(S.R, th, -0.06, -len + 0.03, 0.0065, M.LEATHER));
  // thigh straps, each with a small frame buckle at the front
  for (const sv of [0.356, 0.712]) {
    const yy = -len * sv, rb = r * prof(sv) + 0.010;
    ch.push(Band(() => rb, yy, 0.048, 0.0055, M.LEATHER, { rr: 0.002, rmax: 0.3 }));
    ch.push(Xf([0, yy, rb + 0.006], zTo([0, 0, 1], Math.PI / 2), Buckle(0.062, 0.056, 0.0055)));
  }
  if (left) {   // the knife rig's retaining straps (diver.js knife rig, legL.root)
    const TH = 0.62, ct = Math.cos(TH), st = Math.sin(TH);
    for (const yy of [-0.155, -0.335]) {
      const sv = clamp(-yy / len, 0, 1), rb = r * prof(sv) + 0.016;
      ch.push(Band(() => rb, yy, 0.040, 0.0055, M.LEATHER, { rr: 0.002, rmax: 0.3 }));
      for (const sz of [1, -1]) ch.push(Sph([r * 1.02, yy, sz * 0.055], 0.012, M.BRASS));
      ch.push(Box([r * 1.46 * ct, yy, -r * 1.46 * st], [0.011, 0.019, 0.065], 0.003, M.LEATHER, [0, TH, 0.10]));
      ch.push(Sph([r * 1.50 * ct + 0.04 * st, yy, -r * 1.50 * st + 0.04 * ct], 0.012, M.BRASS));
    }
  }
  return U(0.006, ...ch);
}
function shinSpec(rig) {
  const L = rig.legL, len = L.lo, r = L.r, prof = profOf(rig.P.shank), rUp = r * profOf(rig.P.thigh)(1);
  const fl = folds({
    drape: [{ n: 6, amp: 0.0035, top: -0.06, bot: -len + 0.04, fade: 0.06, tw: 1.3, fy: 7, ph: 2.2 }],
    gath: [
      { top: 0.06, bot: -len * 0.26, fade: 0.04, lam: 0.038, amp: 0.010, th: BACK, k: 0.2, wv: 1.4, ph: 2.9 },     // behind the knee
      { top: -len * 0.82, bot: -len - 0.04, fade: 0.04, lam: 0.036, amp: 0.006, th: FRONT, k: 0.5, wv: 1.6, ph: 1.1 } // bunched at the ankle
    ]
  });
  const S = segment(len, r, prof, fl, M.CANVAS, [[0, 0.07, BACK], [-len, 0.05, FRONT]], 11);
  const ch = [S.node];
  ch.push(Disp([fineCreases(0.2, [[0, 0.06, BACK]], 13)], Sph([0, 0.004, 0], rUp, M.CANVAS)));
  for (const th of [OUTB, INB]) ch.push(piping(S.R, th, -0.08, -len + 0.03, 0.0065, M.LEATHER));
  // the stitched leather KNEE PAD, quilted, stitched round its edge
  const kz = r * prof(0.118), pc = [0, -0.055, kz * 1.02], pr = [0.140, 0.168, 0.042];
  ch.push(Disp([{ type: 'fn', bake: true, amp: 0.0012, fn: (x, y, z) => {
    const u = (x - pc[0]) / pr[0], v = (y - pc[1]) / pr[1], e = Math.hypot(u, v);
    const q = Math.min(Math.abs(Math.sin((u + v) * 9.4)), Math.abs(Math.sin((u - v) * 9.4)));
    return -0.0010 * (1 - sst(0.0, 0.12, q)) * (1 - sst(0.78, 0.84, e)) - 0.0012 * gau((e - 0.86) / 0.025);
  } }], E(pc, pr, M.LEATHER)));
  // the under-knee strap and its buckle
  const yb = -0.20, rb = r * prof(0.43) + 0.010;
  ch.push(Band(() => rb, yb, 0.042, 0.0055, M.LEATHER, { rr: 0.002, rmax: 0.3 }));
  ch.push(Xf([0, yb, rb + 0.006], zTo([0, 0, 1], Math.PI / 2), Buckle(0.056, 0.05, 0.005)));
  return U(0.006, ...ch);
}
// THE BOOT (ankle frame): pleated gaiter over the boot top, lathed leather ankle, a vamp
// with real mass, laces, instep and ankle straps, the BRASS TOE CAP, a stacked heel and the
// LEAD SOLE — its underside exactly at SOLE_Y (the IK plants on it)
function bootSpec(rig) {
  const SOLE = rig.soleY, ch = [];
  const keys = [[0.100, 0.122], [0.066, 0.132], [0.036, 0.118], [0.000, 0.140], [-0.045, 0.146], [-0.080, 0.140]].sort((a, b) => a[0] - b[0]);
  const rAt = y => { let i = 1; while (i < keys.length - 1 && keys[i][0] < y) i++; const [y0, r0] = keys[i - 1], [y1, r1] = keys[i], u = clamp((y - y0) / (y1 - y0), 0, 1); return r0 + (r1 - r0) * u * u * (3 - 2 * u); };
  const yg = 0.036, n = 14, depth = 0.022, prof = [];
  for (let k = 0; k <= 24; k++) { const y = -0.080 + 0.180 * k / 24; prof.push([rAt(y), y]); }
  const pleat = th => { const w = ((th / TAU * n) % 1 + 1) % 1; return 0.5 * (w < 0.78 ? w / 0.78 : (1 - w) / 0.22) + 0.5 * (0.5 - 0.5 * Math.cos(TAU * w)); };
  ch.push(Disp([canvasGrain(71)], Lathe(prof, M.DUCK, { sz: 0.95, amp: depth, lip: 0.55, mod: (th, y) => {
    const open = sst(0.004, 0.045, Math.abs(y - yg)) * (1 - sst(0.028, 0.040, -y)) * (1 - 0.7 * sst(0.075, 0.100, y));
    return (pleat(th + 0.1 * (y - yg) / 0.18 * Math.sin(3 * th)) - 0.55) * depth * open;
  } })));
  ch.push(ETor(rAt(yg) + 0.005, 0.0058, yg, M.LEATHER, 1, 0.95));
  ch.push(E([rAt(yg) + 0.012, yg, 0], [0.011, 0.009, 0.012], M.LEATHER));
  ch.push(Band(() => 0.150, -0.058, 0.040, 0.0055, M.TAPE, { sz: 0.95, rr: 0.002, rmax: 0.2 }));
  // the leather ankle flare and its rolled top
  ch.push(Lathe([[0.120, 0.005], [0.150, -0.10], [0.170, -0.195]], M.LEATHER, { sz: 0.96 }));
  ch.push(ETor(0.168, 0.020, -0.176, M.LEATHER, 1, 0.96));
  ch.push(Band(() => 0.159, -0.118, 0.040, 0.005, M.LEATHER, { sz: 0.96, rr: 0.002, rmax: 0.2 }));
  ch.push(Xf([0.165, -0.118, 0.0], zTo([1, 0, 0], Math.PI / 2), Buckle(0.048, 0.042, 0.0045)));
  // the VAMP and the toe box: a weighted boot out-masses the ankle by a lot
  ch.push(U(0.03, E([0, -0.238, 0.040], [0.127, 0.108, 0.20], M.LEATHER), Box([0, -0.25, 0.06], [0.11, 0.07, 0.15], 0.06, M.LEATHER)));
  ch.push(E([0, -0.244, 0.185], [0.136, 0.099, 0.156], M.LEATHER));
  // laces over the instep with brass hooks either side
  for (let i = 0; i < 4; i++) {
    const y = -0.150 + i * 0.012 - 0.01, z = 0.05 + i * 0.054;
    ch.push(Cap([-0.104, y - 0.012, z], [0.104, y - 0.012, z], 0.0085, 0.0085, M.LEATHER));
    for (const sx of [1, -1]) ch.push(Sph([sx * 0.106, y - 0.012, z], 0.013, M.BRASS));
  }
  // instep strap arched over the vamp, frame buckle outboard
  ch.push(Fn([-0.16, -0.27, 0.06, 0.16, -0.09, 0.17], (x, y, z) => {
    const ex = x / 1.08, ey = (y + 0.236) / 0.94;
    const q = Math.hypot(ex, ey) - 0.130;
    return Math.max(Math.hypot(Math.max(Math.abs(q) - 0.006, 0), Math.max(Math.abs(z - 0.112) - 0.022, 0)) + Math.min(Math.max(Math.abs(q) - 0.006, Math.abs(z - 0.112) - 0.022), 0), -(y + 0.236) - 0.03) * 0.85;
  }, M.LEATHER));
  ch.push(Xf([0.144, -0.222, 0.112], zTo(norm([1, 0.25, 0]), Math.PI / 2), Buckle(0.052, 0.046, 0.0045)));
  // BRASS TOE CAP: a spun shell over the front of the toe box, 5% proud, rolled rim, rivets
  {
    const c = [0, -0.244, 0.185], R = [0.136 * 1.05, 0.099 * 1.05, 0.156 * 1.05];
    const shell = Sub(0.002, E(c, R, M.BRASS), E(c, [R[0] - 0.006, R[1] - 0.006, R[2] - 0.006], M.BRASS));
    const cap = I(0.004, shell, Pl([0, 0, -1], -(c[2] + 0.045), M.BRASS), Pl([0, -1, 0], -(c[1] - 0.030), M.BRASS));
    ch.push(Disp([{ type: 'pits', bake: true, amp: 0.00015, f: 60, dens: 0.7, r: 0.6, seed: 72 }], cap));
    // rim: where the cap's two cutting planes leave its edge
    const rim = [];
    for (let k = 0; k <= 20; k++) {
      const a = Math.PI * (0.02 + 0.96 * k / 20);
      const ex = -Math.cos(a), ez = Math.sin(a);
      // walk round the toe box at the rim line: z = c.z + 0.010 at the sides, y = c.y - 0.034 at the front
      let p;
      if (ez < 0.34) { const zz = c[2] + 0.045, yy = c[1] - 0.034 + (0.34 - ez) * 0.5 * R[1] / 0.34 * 1.6, u = Math.sqrt(Math.max(0, 1 - ((yy - c[1]) / R[1]) ** 2)); p = [Math.sign(ex) * R[0] * u, yy, zz]; }
      else { const yy = c[1] - 0.034, u = Math.sqrt(Math.max(0, 1 - ((yy - c[1]) / R[1]) ** 2)); p = [ex * R[0] * u, yy, c[2] + ez * R[2] * u]; }
      rim.push(p);
    }
    ch.push(Path(rim.filter((p, k) => k > 0 && k < 20), 0.0055, M.BRASS, 40));
    for (let k = 3; k < 18; k += 2) { const p = rim[k]; ch.push(Sph([p[0] * 1.02, p[1] + 0.010, p[2] + (p[2] > c[2] + 0.02 ? 0.004 : 0)], 0.0055, M.BRASS)); }
  }
  // the stacked heel
  ch.push(Box([0, -0.290, -0.085], [0.105, 0.040, 0.075], 0.010, M.LEATHER));
  ch.push(Disp([{ type: 'fn', bake: true, amp: 0.0008, fn: (x, y, z) => -0.0008 * (1 - sst(0.0, 0.0025, Math.abs(((y + 0.30) / 0.013) % 1 - 0.5) * 0.013)) * sst(-0.33, -0.31, y) }], Box([0, -0.300, -0.085], [0.106, 0.026, 0.076], 0.008, M.LEATHER)));
  // THE LEAD SOLE: one casting in the outline of the foot, chamfered all round
  const outline = [[0.000, -0.185], [0.070, -0.176], [0.100, -0.140], [0.104, -0.060], [0.098, 0.030], [0.122, 0.130],
    [0.130, 0.215], [0.112, 0.285], [0.066, 0.328], [0.000, 0.338]];
  const half = crPts(outline.map(q => [q[0], q[1], 0]), 36).map(q => [q[0], q[1]]);
  const full = half.concat(half.slice(1, -1).reverse().map(q => [-q[0], q[1]]));
  const BT = 0.009, DEP = 0.048, top = SOLE + DEP + 2 * BT;
  ch.push(Disp([{ type: 'pits', bake: true, amp: 0.0006, f: 100, dens: 0.6, r: 0.35, seed: 73 }], Slab(full, SOLE, top, 0.009, M.LEAD)));
  // the welt where the upper meets the lead, and the brass sole nails through it
  const wl = full.map(q => [q[0] * 1.012, top + 0.003, q[1] * 1.012]);
  wl.push(wl[0]);
  ch.push(Path(wl, 0.0105, M.LEATHER));
  for (let i = 0; i < 14; i++) { const q = full[Math.floor(i / 14 * full.length)]; ch.push(Sph([q[0] * 1.045, SOLE + DEP * 0.62, q[1] * 1.045], 0.0068, M.BRASS)); }
  return U(0.005, ...ch);
}

// =============================================================================================
// PIPELINE
// =============================================================================================
const SET = { size: 2048, gutter: 6, aoDist: 0.06, aoSamples: 64, ormB: 'metal' };
const piece = (name, set, sdf, o = {}) => ({
  name, set, sdf, paint: o.paint || PAINT(), emit: metalEmit,
  hi: { h: o.h || 0.003 }, lo: { h: o.loH || 0.008, tris: o.tris || 4000 },
  kEps: 0.006, ao: { r: 0.035, n: 4 }, cage: o.cage || 0.014, ray: o.ray || 0.04
});
function rigFromSource() {
  const fs = globalThis.process && process.versions && process.versions.node ? PROC.fs : null;
  if (!fs) throw new Error('salSculpt.pipeline runs in node (tools/blender/build.mjs sal)');
  return readRig(fs.readFileSync(new URL('./diver.js', import.meta.url), 'utf8'));
}
export function pipeline() {
  const rig = rigFromSource();
  const pieces = [
    piece('helmet', 'helm', helmetSpec(), { tris: 16000, h: 0.0028 }),
    piece('corselet', 'torso', corseletSpec(), { tris: 14000, h: 0.0032, loH: 0.009 }),
    piece('hips', 'torso', hipsSpec(), { tris: 7000, h: 0.0032, loH: 0.009 }),
    piece('pack', 'torso', packSpec(), { tris: 5000, h: 0.003 }),
    piece('upperArm', 'limbs', upperArmSpec(rig), { tris: 3200 }),
    piece('foreArm', 'limbs', foreArmSpec(rig), { tris: 3000 }),
    piece('glove', 'limbs', gloveSpec(), { tris: 4600, h: 0.0025, loH: 0.006 }),
    piece('thighL', 'limbs', thighSpec(rig, true), { tris: 3800 }),
    piece('thighR', 'limbs', thighSpec(rig, false), { tris: 3400 }),
    piece('shin', 'limbs', shinSpec(rig), { tris: 3600 }),
    piece('boot', 'limbs', bootSpec(rig), { tris: 6000, h: 0.0025, loH: 0.006 })
  ];
  return {
    name: 'sal', out: 'assets/sal',
    sets: { helm: SET, torso: SET, limbs: SET },
    pieces,
    // the rig this bake was sculpted to; salInstall.js checks it against the live rig
    meta: {
      rig: { armL: rig.armL, legL: rig.legL, soleY: rig.soleY, pack: rig.pack },
      mirror: ['upperArm', 'foreArm', 'glove', 'thighR', 'shin', 'boot'],
      metal: 'ormB'
    },
    compress: { mesh: 'draco', tex: 'ktx2' }
  };
}
