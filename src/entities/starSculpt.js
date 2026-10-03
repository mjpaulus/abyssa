// THE SEA STAR (fauna3) — `node tools/blender/build.mjs star` -> assets/fauna/star/.
//
// Round one baked a star into the shared reef atlas and it lost to the procedural shader star
// (fauna.js skin 5) at every distance: its relief was a few millimetres of soft bumps on a few
// hundred texels. This one gets its own 1024 set and is built the way a forcipulate star
// (Asterias / Pisaster) actually is, so the relief reads from the game camera:
//   - five arms of slightly different length and set, each tip CURLED UP (a star lifts its arm
//     tips to sense, showing the red optic cushion and the terminal tentacle underneath);
//   - the dorsal skeleton: a RETICULUM of calcite ossicles laid along each arm, with blunt white
//     spines (tubercles) on its nodes and a CARINAL row of larger spines down each arm's crest;
//   - PAPULAE, soft skin gills, clustered in the meshes of the reticulum (darker, purplish);
//   - MARGINAL plates along the arm sides;
//   - underneath: the ambulacral GROOVE down each arm with four rows of TUBE FEET (podia with
//     suction discs), the mouth in the middle; the madreporite on the disc.
// Frame: fauna.js's SEA STAR authored frame (arms to ~1.0 on the xz plane, the underside on
// y = 0), placed by FS_DEFS scale 0.7 exactly where the procedural star sat.
const TAU = Math.PI * 2;
const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const E = (c, r, m = 0, e) => ({ t: 'ellip', c, r, m, e });
const U = (k, ...ch) => ({ t: 'u', k, ch });
const Fn = (bb, f, m = 0) => ({ t: 'fn', bb, f, m });
const Disp = (L, ch) => ({ t: 'disp', L, ch: [ch] });
const mat = id => ['mat', id];
function hash(i, s = 0) { let h = Math.imul(i | 0, 374761393) ^ Math.imul(s | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function wor2(u, v, s, o) {
  const X = Math.floor(u), Y = Math.floor(v);
  let f1 = 9, f2 = 9, cx = 0, cy = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = X + i, gy = Y + j, k = gx * 7919 + gy * 104729;
    const px = gx + 0.15 + 0.7 * hash(k, s), py = gy + 0.15 + 0.7 * hash(k, s + 1), d = Math.hypot(px - u, py - v);
    if (d < f1) { f2 = f1; f1 = d; cx = px; cy = py; } else if (d < f2) f2 = d;
  }
  o.f1 = f1; o.f2 = f2; o.id = hash(Math.floor(cx) * 7919 + Math.floor(cy) * 104729, s + 2);
  return o;
}
export const SM = { SKIN: 0, MADRE: 1 };

// five arms: length, tip lift (authored units), a gentle sideways set (radians per unit)
const ARMS = [
  { L: 1.00, curl: 0.06, bend: 0.05 },
  { L: 0.93, curl: 0.12, bend: -0.09 },
  { L: 1.04, curl: 0.03, bend: 0.0 },
  { L: 0.96, curl: 0.15, bend: 0.07 },
  { L: 0.90, curl: 0.08, bend: -0.05 }
].map((a, k) => Object.assign(a, { ang: k / 5 * TAU + 0.08 * Math.sin(k * 2.3) }));
// the tip closes as a rounded cone over its last 12% (the old end was a flat cut)
const tipK = t => Math.sqrt(Math.max(0.0, 1 - Math.pow(Math.max(0, (t - 0.88) / 0.12), 2)));
const armW = (al, L) => { const t = clamp(al / L, 0, 1); return (0.205 * (1 - 0.80 * t) + 0.022 + 0.06 * Math.max(0, 1 - al / 0.26)) * Math.max(0.12, tipK(t)); };
const armH = (al, L) => { const t = clamp(al / L, 0, 1); return (0.185 * (1 - 0.64 * t) + 0.028) * Math.max(0.2, tipK(t)); };
const armY = (al, A) => 0.040 + A.curl * Math.pow(sst(0.42, 1.0, al / A.L), 2) * 1.05;
// arm-local coordinates of a point for arm A: along, across, the centreline height
function local(A, x, z, o) {
  const c = Math.cos(A.ang), s = Math.sin(A.ang);
  const al = x * c + z * s;
  o.al = al; o.ac = -x * s + z * c - A.bend * al * al; o.yc = armY(Math.max(0, al), A);
  o.t = clamp(al / A.L, 0, 1); o.w = armW(Math.max(0, al), A.L); o.h = armH(Math.max(0, al), A.L);
  return o;
}
const _o = {};
function armSdf(A, x, y, z) {
  local(A, x, z, _o);
  const dy = y - _o.yc;
  // tip lift tilts the section: measure height along the lifted direction (approximately)
  const hb = 0.042 * Math.max(0.3, tipK(_o.t));
  const k0 = Math.hypot(_o.ac / _o.w, dy > 0 ? dy / _o.h : dy / hb);
  let d = (k0 - 1) * Math.min(_o.w, dy > 0 ? _o.h : hb) * 0.85;
  const over = _o.al - A.L, back = -_o.al;
  if (over > 0) d = Math.hypot(Math.max(d, 0), over);
  else if (back > 0) d = Math.hypot(Math.max(d, 0), back);
  return d;
}
// the nearest arm (by angle) and its local frame, cached per point (paint asks many times)
const NA = { x: NaN, y: NaN, z: NaN, k: 0, al: 0, ac: 0, yc: 0, t: 0, w: 1, h: 1, dy: 0, r: 0 };
function nearArm(x, y, z) {
  if (x === NA.x && y === NA.y && z === NA.z) return NA;
  let best = 9, bk = 0;
  const a = Math.atan2(z, x);
  for (let k = 0; k < 5; k++) { let d = Math.abs(a - ARMS[k].ang); d = Math.min(d, TAU - d); if (d < best) { best = d; bk = k; } }
  local(ARMS[bk], x, z, NA);
  NA.x = x; NA.y = y; NA.z = z; NA.k = bk; NA.dy = y - NA.yc; NA.r = Math.hypot(x, z);
  return NA;
}
const W1 = {}, W2 = {}, W3 = {};
// the dorsal skeleton (in the star's own xz: an arm-local frame would seam at every interradius)
// a warped lattice so the meshes are round-ish holes in a lumpy net, not polygon plates
function reticulum(n) {
  const wx = n.x + 0.018 * Math.sin(n.z * 41 + 1.3) + 0.012 * Math.sin(n.x * 67), wz = n.z + 0.018 * Math.sin(n.x * 37 + 0.4) + 0.012 * Math.sin(n.z * 59);
  wor2(wx * 23, wz * 23, 101, W1);
  return 1 - sst(0.02, 0.30, W1.f2 - W1.f1);
}
function tubercle(n) {
  wor2(n.x * 31, n.z * 31, 211, W2);
  if (W2.id < 0.22) return 0;
  const q = Math.max(0, 1 - W2.f1 / 0.30);
  return q * q * (0.6 + 0.4 * W2.id);
}
function carinal(n) {
  const sp = 0.062, j = Math.round(n.al / sp), du = n.al - j * sp;
  const d = Math.hypot(du, n.ac * 1.1) / (0.022 * (1 - 0.45 * n.t));
  return n.al > 0.12 && n.t < 0.96 ? Math.max(0, 1 - d * d) ** 1.4 : 0;
}
function marginal(n) {
  // two rows of plates along each side, at the arm's widest
  const sp = 0.07, j = Math.round(n.al / sp + 0.5 * (n.ac > 0 ? 1 : 0)), du = n.al - (j - 0.5 * (n.ac > 0 ? 1 : 0)) * sp;
  const side = Math.abs(Math.abs(n.ac) - n.w * 0.86) / (0.03 * (1 - 0.4 * n.t));
  const along = Math.abs(du) / (sp * 0.45);
  return n.al > 0.15 ? Math.max(0, 1 - Math.max(side, along) ** 2) * sst(-0.03, 0.02, n.dy) * (1 - sst(0.06, 0.12, n.dy)) * (1 - sst(0.78, 0.92, n.t)) : 0;
}
function papulae(n) {
  wor2(n.x * 70, n.z * 70, 307, W3);
  return W3.id < 0.55 ? Math.max(0, 1 - (W3.f1 / 0.38) ** 2) : 0;
}
// underneath: the groove down the arm, four rows of tube feet in it
function grooveFeet(n, out) {
  const under = 1 - sst(-0.03, 0.0, n.dy);
  if (under <= 0 || n.al < 0.06) { out.g = 0; out.f = 0; return out; }
  const gw = n.w * 0.42;
  const g = Math.exp(-((n.ac / gw) ** 2));
  let f = 0;
  for (const off of [-0.62, -0.22, 0.22, 0.62]) {
    const sp = 0.026 * (1 - 0.4 * n.t), sh = off > 0 ? 0.5 : 0, j = Math.round(n.al / sp + sh), du = n.al - (j - sh) * sp;
    const d = Math.hypot(du, n.ac - off * gw) / (0.010 * (1 - 0.45 * n.t));
    f = Math.max(f, Math.max(0, 1 - d * d));
  }
  out.g = g * under; out.f = f * under * (1 - sst(0.95, 1.0, n.t)); return out;
}
const GF = {};

function starSpec() {
  const bb = [-1.12, -0.06, -1.12, 1.12, 0.46, 1.12];
  const arms = ARMS.map(A => Fn(bb, (x, y, z) => armSdf(A, x, y, z), SM.SKIN));
  let s = U(0.09, E([0, 0.10, 0], [0.30, 0.14, 0.30], SM.SKIN), ...arms);
  // the madreporite: a small sieve plate off-centre on the disc, between two arms
  s = U(0.012, s, E([0.11, 0.225, 0.07], [0.038, 0.014, 0.038], SM.MADRE));
  return Disp([
    // mesh: the carinal spines, the marginal plates, the reticulum's ridges
    { type: 'fn', amp: 0.02, fn: (x, y, z) => {
      const n = nearArm(x, y, z);
      if (n.dy < -0.02) return 0;
      const top = sst(-0.01, 0.04, n.dy);
      return top * (0.013 * carinal(n) + 0.0045 * reticulum(n)) + 0.008 * marginal(n);
    } },
    // bake: the tubercles on the reticulum's nodes, papulae in its meshes
    { type: 'fn', amp: 0.014, bake: true, fn: (x, y, z) => {
      const n = nearArm(x, y, z);
      if (n.dy < -0.02) return 0;
      const top = sst(-0.01, 0.04, n.dy), ret = reticulum(n);
      return top * (0.010 * tubercle(n) * (0.4 + 0.6 * ret) + 0.0028 * papulae(n) * (1 - ret));
    } },
    // bake: the ambulacral groove and its tube feet
    { type: 'fn', amp: 0.016, bake: true, fn: (x, y, z) => {
      const n = nearArm(x, y, z);
      grooveFeet(n, GF);
      return -0.012 * GF.g + 0.008 * GF.f;
    } },
    { type: 'grain', amp: 0.0012, f: 110, seed: 19, bake: true }
  ], s);
}
function starPaint() {
  const m = f => ['fn', S => f(nearArm(S.x, S.y, S.z))];
  return {
    kScale: 0.006, aoAlb: 0.55,
    mats: { [SM.SKIN]: { c: [0.72, 0.37, 0.16], ro: 0.72 }, [SM.MADRE]: { c: [0.80, 0.62, 0.40], ro: 0.6 } },
    layers: [
      // a slow mottle of the ground colour along the arms
      { c: [0.56, 0.25, 0.13], a: 0.45, m: [['n', 4, 0.45, 0.75, 111]] },
      // papular fields: soft, darker, purplish skin in the reticulum's meshes
      { c: [0.46, 0.20, 0.17], a: 0.38, m: [m(n => (1 - reticulum(n)) * sst(0.0, 0.04, n.dy))] },
      // the ossicle bars paler and warmer
      { c: [0.84, 0.50, 0.24], a: 0.32, m: [m(n => reticulum(n) * sst(0.0, 0.04, n.dy))] },
      // spines and tubercles bone-white at their tips
      { c: [0.93, 0.86, 0.72], a: 0.9, m: [['cvx', 0.5, 1.4]] },
      { c: [0.90, 0.82, 0.68], a: 0.85, m: [m(n => Math.max(carinal(n), marginal(n) * 0.35) * sst(-0.02, 0.03, n.dy))] },
      // underneath pale, the groove shadowed, the tube feet cream
      { c: [0.86, 0.66, 0.46], a: 0.85, m: [['nd', [0, -1, 0], 0.35, 0.85]] },
      { c: [0.38, 0.20, 0.12], a: 0.7, m: [m(n => grooveFeet(n, GF).g * (1 - GF.f))] },
      { c: [0.96, 0.86, 0.62], a: 0.85, m: [m(n => grooveFeet(n, GF).f)] },
      // the optic cushion: a red eyespot under each lifted tip
      { c: [0.72, 0.10, 0.06], a: 0.9, m: [m(n => (1 - sst(0.012, 0.03, Math.hypot(n.al - (ARMS[n.k].L - 0.02), n.ac))) * (1 - sst(-0.01, 0.03, n.dy)))] },
      { c: [0.02, 0.02, 0.02], a: 0.75, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

export const LABEL = (x, y, z, L) => { L.part = 0; };
export function pipeline() {
  return {
    name: 'star', out: 'assets/fauna/star',
    sets: { star: { size: 1024, gutter: 6, aoDist: 0.08, aoSamples: 48, fill: true } },
    pieces: [{ name: 'star', set: 'star', sdf: starSpec(), paint: starPaint(), hi: { h: 0.0032 }, lo: { h: 0.009, tris: 2400, err: 0.02 }, far: 450, kEps: 0.006, ao: { r: 0.04, n: 4 }, cage: 0.012, ray: 0.04 }],
    compress: { mesh: 'draco', tex: 'ktx2' },
    meta: { arms: ARMS.map(a => ({ L: a.L, curl: a.curl })) }
  };
}
export function preview() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const k = +(q.get('k') || 2), P = pipeline(), p = P.pieces[0];
  return {
    key: 'preview-star-' + k + '-' + Math.random(),
    parts: [{ name: p.name, sdf: p.sdf, h: p.hi.h * k, tris: p.lo.tris * 2, err: p.lo.h }],
    atlas: { size: +(q.get('s') || 1024), paint: p.paint, kEps: p.kEps, ao: p.ao },
    layout: { star: [0, 0, 0] }
  };
}
