// THE DEEP — the abyss's and the boiler room's named animals, sculpted (fauna2): the humpback
// anglerfish, the gulper eel, the giant isopod and the flapjack octopus.
// `node tools/blender/build.mjs deep` bakes them into assets/fauna/deep/ (one atlas).
// Same contract as reefSculpt.js: fauna.js's AUTHORED frame per animal (+X forward), the
// procedural build's extents (every motion uniform still fits), pieces split where the
// motion parts split, LABELS exported for the install.
//
// Reference: Melanocetus johnsonii (a globular black body, a cavernous oblique mouth set
// with long recurved fangs, a tiny eye, lateral-line papillae on the head, the illicium
// and its esca: a pale bulb with a light window and filaments); Eurypharynx pelecanoides
// (a vast loose lower jaw, the tiny eye at the snout, a whip tail ending in a luminous
// organ); Bathynomus giganteus (seven overlapping pereon tergites, the broad spined
// pleotelson, big faceted eyes, long second antennae, seven pairs of pereopods, lilac-
// beige); Opisthoteuthis (a gelatinous umbrella, webbed arms with cirri, two ear fins, big
// eyes, orange-rose).
import { _internal } from './fishKit.js';

const TAU = Math.PI * 2;
const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const E = (c, r, m = 0, e) => ({ t: 'ellip', c, r, m, e });
const Sph = (c, r, m = 0) => ({ t: 'sphere', c, r, m });
const Cap = (a, b, ra, rb = ra, m = 0) => ({ t: 'cap', a, b, ra, rb, m });
const U = (k, ...ch) => ({ t: 'u', k, ch });
const I = (k, ...ch) => ({ t: 'i', k, ch });
const Sub = (k, m, a, ...b) => ({ t: 's', k, m, ch: [a, ...b] });
const Tube = (p, r0, r1, n = 10, m = 0, rr) => ({ t: 'tube', p, r: [r0, r1], n, m, rr });
const Mir = (ax, ch) => ({ t: 'mir', ax, ch: [ch] });
const Fn = (bb, f, m = 0) => ({ t: 'fn', bb, f, m });
const Pl = (n, o, m = 0) => ({ t: 'plane', n, o, m });
const Disp = (L, ch) => ({ t: 'disp', L, ch: [ch] });
const mat = id => ['mat', id];
function hash(i, s = 0) { let h = Math.imul(i | 0, 374761393) ^ Math.imul(s | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export const DM = { SKIN: 0, BELLY: 1, EYE: 2, MOUTH: 3, TOOTH: 4, FIN: 5, LURE: 6, SHELL: 7, LEG: 8 };

// a thin plate in the z = 0 plane over a smooth outline (x, y); rays radiate from `focus`
function plateZ(pts, th, focus, rays, m) {
  const P = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n], d = pts[(i + 2) % n];
    for (let k = 0; k < 6; k++) { const u = k / 6; P.push([0, 1].map(j => 0.5 * (2 * b[j] + (-a[j] + c[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * u * u + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * u * u * u))); }
  }
  let bb = [9, 9, -th * 3, -9, -9, th * 3];
  for (const p of P) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[3] = Math.max(bb[3], p[0]); bb[4] = Math.max(bb[4], p[1]); }
  return Fn(bb, (x, y, z) => {
    const d2 = _internal.polyD(P, x, y);
    const ang = Math.atan2(y - focus[1], x - focus[0]), q = ang * rays / Math.PI, rq = q - Math.round(q);
    const t = th * (1 + 0.5 * Math.exp(-(rq * rq) / 0.02));
    const e = Math.abs(z) - t;
    return d2 > 0 || e > 0 ? Math.hypot(Math.max(d2, 0), Math.max(e, 0)) : Math.max(d2, e);
  }, m);
}

// =============================================================================================
// HUMPBACK ANGLERFISH (fauna ANGLER: merge scale 1.6; jaw hinge (0.27, 0.0) authored; the lure
// moves above y 0.75 authored)
// =============================================================================================
export const AN_HINGE = [0.27, 0.0];
const AN_EYE = [0.5, 0.33, 0.33], AN_EYER = 0.035;
const gapeY = x => 0.035 + 0.16 * sst(0.27, 0.8, x);             // the gape rises: an oblique mouth
function anglerBodyF(x, y, z) {
  // a globe with a humped back, a short peduncle behind
  const d1 = Math.hypot((x - 0.05) / 0.74, (y - 0.12) / 0.6, z / 0.5) - 1;
  const d2 = Math.hypot((x + 0.25) / 0.55, (y - 0.28) / 0.48, z / 0.42) - 1;
  return Math.min(d1 * 0.42, d2 * 0.38);
}
function anglerSpec() {
  let s = U(0.12, Fn([-0.8, -0.55, -0.55, 0.85, 0.8, 0.55], anglerBodyF, DM.SKIN), Cap([-0.4, 0.07, 0], [-0.93, 0.03, 0], 0.24, 0.06, DM.SKIN));
  // cut the head at the gape (the lower jaw is its own piece), carve the mouth back into it
  s = Sub(0.02, DM.MOUTH, s, Fn([0.2, -0.8, -0.7, 1.0, 0.6, 0.7], (x, y, z) => Math.max(gapeY(x) - y, AN_HINGE[0] - x), DM.MOUTH));
  s = Sub(0.03, DM.MOUTH, s, E([0.5, 0.06, 0], [0.32, 0.16, 0.36], DM.MOUTH));
  // fangs hanging from the upper jaw, recurved, long at the front
  const teeth = [];
  for (let i = 0; i < 13; i++) {
    const a = (i / 12 - 0.5) * 2.2, cx = 0.72 * Math.cos(a * 0.62) - 0.02, cz = 0.4 * Math.sin(a), y0 = gapeY(cx) + 0.02;
    const L = (0.1 + 0.11 * Math.cos(a * 0.7)) * (0.75 + 0.5 * hash(i, 3));
    teeth.push(Tube([[cx, y0, cz], [cx + 0.02, y0 - L * 0.6, cz * 0.97], [cx - 0.015, y0 - L, cz * 0.9]], 0.014, 0.002, 6, DM.TOOTH));
  }
  s = U(0.006, s, ...teeth);
  // the eye: tiny, set above the jaw's corner
  s = Sub(AN_EYER * 0.3, DM.SKIN, s, Mir(2, Sph(AN_EYE, AN_EYER * 0.95)));
  s = U(AN_EYER * 0.06, s, Mir(2, Sph(AN_EYE, AN_EYER, DM.EYE)));
  // the fins: a small soft dorsal, the caudal fan, the pectorals on the flank (own piece)
  const dorsal = plateZ([[-0.72, 0.2], [-0.62, 0.52], [-0.4, 0.46], [-0.3, 0.33]], 0.008, [-0.6, 0.15], 9, DM.FIN);
  const caudal = plateZ([[-0.88, 0.06], [-1.32, 0.3], [-1.38, 0.0], [-1.32, -0.28], [-0.88, -0.04]], 0.009, [-0.85, 0.0], 10, DM.FIN);
  s = U(0.03, s, dorsal, caudal);
  return Disp([
    // lateral-line papillae: rows of small sensory bumps over the head and flank
    { type: 'fn', amp: 0.008, fn: (x, y, z) => {
      if (x < -0.5) return 0;
      let m = 0;
      for (const yy of [0.42, 0.18, -0.12]) { const ly = yy + 0.18 * (x - 0.2); const d = Math.abs(y - ly); if (d < 0.03) { const ph = (x * 22) % 1; m = Math.max(m, Math.exp(-((d / 0.012) ** 2)) * Math.exp(-(((ph - 0.5) / 0.15) ** 2))); } }
      return 0.006 * m;
    } },
    { type: 'fbm', amp: 0.008, f: 6, oct: 3, seed: 21, bake: true },
    { type: 'grain', amp: 0.0015, f: 70, seed: 22, bake: true }
  ], s);
}
function anglerJawSpec() {
  // the lower jaw: a deep scoop that juts past the upper, fangs standing in it
  let s = I(0.02, E([0.45, -0.06, 0], [0.42, 0.26, 0.43], DM.SKIN), Fn([0.0, -0.5, -0.6, 1.0, 0.6, 0.6], (x, y, z) => Math.max(y - gapeY(x) + 0.004, AN_HINGE[0] - 0.02 - x), DM.SKIN));
  s = Sub(0.03, DM.MOUTH, s, E([0.5, 0.06, 0], [0.34, 0.2, 0.36], DM.MOUTH));
  const teeth = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 10 - 0.5) * 2.0, cx = 0.78 * Math.cos(a * 0.6) - 0.02, cz = 0.4 * Math.sin(a), y0 = gapeY(cx) - 0.03;
    const L = (0.12 + 0.1 * Math.cos(a * 0.7)) * (0.75 + 0.5 * hash(i, 4));
    teeth.push(Tube([[cx, y0, cz], [cx + 0.02, y0 + L * 0.6, cz * 0.97], [cx - 0.02, y0 + L, cz * 0.88]], 0.015, 0.002, 6, DM.TOOTH));
  }
  s = U(0.006, s, ...teeth);
  return Disp([{ type: 'fbm', amp: 0.008, f: 6, oct: 3, seed: 21, bake: true }, { type: 'grain', amp: 0.0015, f: 70, seed: 23, bake: true }], s);
}
function anglerPecSpec() {
  // the pectorals: small fans on the flank behind the jaw, mirrored
  const fan = { t: 'xf', p: [-0.2, -0.02, 0.38], e: [0.2, -0.6, 0], ch: [plateZ([[0, 0.04], [-0.32, 0.18], [-0.38, -0.02], [-0.3, -0.2], [0, -0.04]], 0.008, [0.05, 0], 10, DM.FIN)] };
  return Disp([{ type: 'grain', amp: 0.001, f: 80, seed: 24, bake: true }], Mir(2, fan));
}
export const AN_ESCA = [1.04, 1.08, 0], AN_ESCAR = 0.08;
function anglerLureSpec() {
  // the illicium: a thin rod from the snout, arching forward; the esca: a pale bulb with a
  // dark pigment cap, a translucent window and a fringe of filaments
  const rod = Tube([[0.18, 0.72, 0], [0.28, 1.38, 0.02], [0.79, 1.46, 0.035], [1.04, 1.14, 0]], 0.017, 0.011, 18, DM.SKIN);
  let esca = E(AN_ESCA, [AN_ESCAR * 0.95, AN_ESCAR * 1.1, AN_ESCAR * 0.9], DM.LURE);
  esca = U(0.02, esca, E([AN_ESCA[0] - 0.01, AN_ESCA[1] + 0.06, 0], [0.06, 0.04, 0.055], DM.SKIN));
  const fil = [];
  for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU; fil.push(Tube([[AN_ESCA[0] + Math.cos(a) * 0.05, AN_ESCA[1] - 0.06, Math.sin(a) * 0.05], [AN_ESCA[0] + Math.cos(a) * 0.09, AN_ESCA[1] - 0.14, Math.sin(a) * 0.09], [AN_ESCA[0] + Math.cos(a) * 0.08, AN_ESCA[1] - 0.22 - 0.04 * hash(k, 5), Math.sin(a) * 0.08]], 0.009, 0.006, 5, DM.SKIN)); }
  return Disp([{ type: 'grain', amp: 0.001, f: 80, seed: 25, bake: true }], U(0.02, rod, esca, ...fil));
}
function anglerPaint() {
  return {
    kScale: 0.006, aoAlb: 0.5,
    mats: {
      [DM.SKIN]: { c: [0.045, 0.04, 0.04], ro: 0.85 }, [DM.FIN]: { c: [0.06, 0.055, 0.05], ro: 0.7 }, [DM.EYE]: { c: [0.1, 0.11, 0.1], ro: 0.05 },
      [DM.MOUTH]: { c: [0.10, 0.04, 0.04], ro: 0.4 }, [DM.TOOTH]: { c: [0.72, 0.70, 0.62], ro: 0.25 }, [DM.LURE]: { c: [0.70, 0.74, 0.66], ro: 0.2 }
    },
    layers: [
      { c: [0.16, 0.14, 0.12], a: 0.6, m: [mat(DM.SKIN), ['cvx', 0.5, 1.4]] },          // papillae, pale tips
      { c: [0.09, 0.08, 0.07], a: 0.4, m: [mat(DM.SKIN), ['n', 9, 0.5, 0.8, 131]] },
      { c: [0.02, 0.01, 0.01], a: 0.7, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// =============================================================================================
// GULPER EEL (fauna GULPER: merge scale 1.5; tail part ramps in behind x -1.2; jaw hinge
// (0.82, -0.16) authored)
// =============================================================================================
export const GU_HINGE = [0.82, -0.16];
const GU_TIP = [-4.67, -0.15, 0];
function gulperR(x) {
  // body radius along x: a whip that swells into the head
  const t = clamp((x + 4.7) / 6.2, 0, 1);
  return 0.006 + 0.33 * Math.pow(t, 2.4) * (1 - 0.25 * sst(0.9, 1.0, t));
}
function gulperUpperF(x, y, z) {
  const r = gulperR(x), cy = -0.15 + 0.1 * sst(-1.5, 0.5, x) - 0.05 * sst(0.6, 1.5, x);
  const d = (Math.hypot(z / (r * 0.85 + 1e-3), (y - cy) / (r + 1e-3)) - 1) * Math.min(r, r * 0.85) * 0.9;
  const dx = Math.max(x - 1.5, -4.7 - x, 0);
  let dd = dx > 0 ? Math.hypot(Math.max(d, 0), dx) : d;
  if (x > GU_HINGE[0] - 0.05) dd = Math.max(dd, -(y - (GU_HINGE[1] + 0.03 * (x - 0.82))) + 0.004);
  return dd;
}
function gulperSpec() {
  let s = Fn([-4.8, -0.55, -0.4, 1.6, 0.35, 0.4], gulperUpperF, DM.SKIN);
  // the upper jaw is a long thin bony bar; the eye a pinhead at the very snout
  s = Sub(0.02, DM.MOUTH, s, E([1.2, -0.15, 0], [0.32, 0.08, 0.24], DM.MOUTH));
  s = U(0.006, s, Mir(2, Sph([1.36, 0.0, 0.1], 0.03, DM.EYE)));
  // long low dorsal and anal fin folds, and the tail organ
  const dors = Fn([-4.5, -0.1, -0.03, 0.2, 0.4, 0.03], (x, y, z) => { const r = gulperR(x), top = -0.15 + 0.1 * sst(-1.5, 0.5, x) + r + 0.04 * sst(-4.4, -3.5, x) * (1 - sst(-0.5, 0.2, x)); const dd = Math.max(y - top, Math.abs(z) - 0.007, -y + top - 0.06); const dx = Math.max(x - 0.2, -4.4 - x, 0); return dx > 0 ? Math.hypot(dx, Math.max(dd, 0)) : dd; }, DM.FIN);
  const anal = Fn([-4.5, -0.5, -0.03, -0.6, 0.0, 0.03], (x, y, z) => { const r = gulperR(x), bot = -0.15 - r - 0.035 * sst(-4.4, -3.5, x) * (1 - sst(-1.4, -0.7, x)); const dd = Math.max(bot - y, Math.abs(z) - 0.007, y - bot - 0.05); const dx = Math.max(x + 0.7, -4.4 - x, 0); return dx > 0 ? Math.hypot(dx, Math.max(dd, 0)) : dd; }, DM.FIN);
  s = U(0.02, s, dors, anal, E(GU_TIP, [0.045, 0.035, 0.03], DM.LURE));
  return Disp([
    // fine transverse skin creases (the body is soft and loose), the grain
    { type: 'fn', amp: 0.003, bake: true, fn: (x, y, z) => 0.0015 * Math.pow(Math.abs(Math.sin(x * 60 + Math.sin(y * 20))), 8) },
    { type: 'grain', amp: 0.001, f: 80, seed: 31, bake: true }
  ], s);
}
function gulperJawSpec() {
  // the vast lower jaw: a loose pouch hanging from a thin mandible, open at the top
  const pouchF = (x, y, z) => {
    const u = clamp((x - 0.82) / 0.68, 0, 1);
    const dep = 0.36 * Math.sin(Math.PI * Math.pow(u, 0.8)) + 0.03, wid = 0.28 * (1 - 0.6 * u * u) + 0.02;
    const cy = GU_HINGE[1] - dep * 0.6;
    const outer = (Math.hypot(z / wid, (y - cy) / dep) - 1) * Math.min(wid, dep) * 0.9;
    const top = y - (GU_HINGE[1] + 0.03 * (x - 0.82)) + 0.004;
    const dx = Math.max(x - 1.52, 0.8 - x, 0);
    let d = Math.max(outer, top);
    return dx > 0 ? Math.hypot(dx, Math.max(d, 0)) : d;
  };
  let s = Fn([0.75, -0.65, -0.35, 1.6, 0.0, 0.35], pouchF, DM.SKIN);
  // hollow it: the pouch is a sack with a mouth, the inside dark
  s = Sub(0.01, DM.MOUTH, s, Fn([0.8, -0.6, -0.33, 1.55, 0.05, 0.33], (x, y, z) => pouchF(x, y, z) + 0.03, DM.MOUTH));
  s = U(0.01, s, Mir(2, Tube([[0.82, GU_HINGE[1], 0.2], [1.2, GU_HINGE[1] + 0.01, 0.17], [1.5, GU_HINGE[1] + 0.02, 0.04]], 0.018, 0.012, 10, DM.SKIN)));
  return Disp([{ type: 'fn', amp: 0.004, bake: true, fn: (x, y, z) => 0.002 * Math.pow(Math.abs(Math.sin(x * 40 + y * 30)), 6) }, { type: 'grain', amp: 0.001, f: 80, seed: 32, bake: true }], s);
}
function gulperPaint() {
  return {
    kScale: 0.006, aoAlb: 0.5,
    mats: {
      [DM.SKIN]: { c: [0.05, 0.045, 0.045], ro: 0.6 }, [DM.FIN]: { c: [0.07, 0.065, 0.06], ro: 0.6 }, [DM.EYE]: { c: [0.12, 0.13, 0.12], ro: 0.05 },
      [DM.MOUTH]: { c: [0.08, 0.04, 0.04], ro: 0.4 }, [DM.LURE]: { c: [0.70, 0.62, 0.66], ro: 0.2 }
    },
    layers: [
      { c: [0.10, 0.09, 0.09], a: 0.5, m: [mat(DM.SKIN), ['n', 4, 0.5, 0.8, 141]] },
      { c: [0.02, 0.01, 0.01], a: 0.7, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// =============================================================================================
// GIANT ISOPOD (fauna ISOPOD: merge scale 0.62; legs step fore-aft on part 3)
// =============================================================================================
export const ISO_LEGS = [];
for (let i = 0; i < 7; i++) { const x = (i / 6 - 0.5) * 1.6; ISO_LEGS.push({ p: [[x, 0.27, 0.42], [x - 0.08, 0.3, 0.55], [x - 0.18, 0.2, 0.66], [x - 0.3, 0.04, 0.8]], phase: i * Math.PI * 0.8 }); }
function isoTergite(i) {
  // a pereon tergite: a curved shield band; the posterior edge stands over the next
  const x0 = -0.78 + i * 0.255, w = 0.47 + Math.sin(i / 6 * Math.PI) * 0.06;
  const band = Fn([x0 - 0.2, 0.05, -0.62, x0 + 0.2, 0.6, 0.62], (x, y, z) => {
    const dx = (x - x0) / 0.155;
    const arch = 0.27 + 0.17 * Math.sqrt(Math.max(0, 1 - (z / w) ** 2)) + 0.025 * sst(-1, 1, -dx);
    const dy = y - arch, dyi = 0.24 - y, dz = Math.abs(z) - w - 0.02 * Math.max(0, -dx);
    return Math.max(dy * 0.85, dyi, dz, (Math.abs(dx) - 1) * 0.155);
  }, DM.SHELL);
  return band;
}
function isoBodySpec() {
  let s = E([0.0, 0.25, 0], [1.0, 0.18, 0.46], DM.BELLY);
  const terg = []; for (let i = 0; i < 7; i++) terg.push(isoTergite(i));
  s = U(0.015, s, ...terg);
  // the head (cephalon) with the big compound eyes, the pleon and the broad pleotelson
  s = U(0.04, s, E([1.02, 0.33, 0], [0.24, 0.17, 0.33], DM.SHELL));
  s = U(0.01, s, Mir(2, E([1.04, 0.38, 0.25], [0.12, 0.08, 0.09], DM.EYE, [0, 0.4, 0])));
  s = U(0.02, s, E([-0.92, 0.32, 0], [0.12, 0.13, 0.42], DM.SHELL), E([-1.1, 0.27, 0], [0.18, 0.08, 0.36], DM.SHELL));
  // the pleotelson's posterior spines and the uropods
  const spines = [];
  for (let k = -3; k <= 3; k++) spines.push({ t: 'cone', a: [-1.2, 0.27, k * 0.07], b: [-1.3, 0.26, k * 0.075], ra: 0.018, rb: 0.003, m: DM.SHELL });
  s = U(0.006, s, ...spines, Mir(2, E([-1.08, 0.24, 0.36], [0.14, 0.03, 0.08], DM.SHELL, [0, 0.5, 0])));
  // antennae: the long second pair, the short first pair
  s = U(0.01, s, Mir(2, Tube([[1.1, 0.43, 0.19], [1.64, 0.5, 0.32], [2.0, 0.28, 0.64]], 0.03, 0.009, 14, DM.LEG)), Mir(2, Tube([[1.18, 0.42, 0.1], [1.32, 0.48, 0.14], [1.4, 0.44, 0.2]], 0.02, 0.008, 6, DM.LEG)));
  return Disp([
    { type: 'fn', amp: 0.005, bake: true, fn: (x, y, z) => {
      // facets on the eyes; fine pitting on the tergites
      const ex = x - 1.04, ez = Math.abs(z) - 0.25, ey = y - 0.38;
      if (ex * ex / 0.02 + ez * ez / 0.012 + ey * ey / 0.01 < 1.6) { const f = 70; return 0.0015 * (Math.abs(Math.sin(x * f + z * f * 0.5)) + Math.abs(Math.sin(y * f - z * f * 0.5))) - 0.0015; }
      return 0;
    } },
    { type: 'pits', amp: 0.003, f: 30, dens: 0.3, r: 0.3, seed: 33, bake: true },
    { type: 'grain', amp: 0.001, f: 90, seed: 34, bake: true }
  ], s);
}
function isoLegsSpec() {
  const legs = ISO_LEGS.map(L => {
    const segs = [];
    for (let k = 0; k < L.p.length - 1; k++) segs.push(Cap(L.p[k], L.p[k + 1], 0.036 - k * 0.006, 0.03 - k * 0.007 - (k === L.p.length - 2 ? 0.012 : 0), DM.LEG));
    return U(0.01, ...segs);
  });
  return Disp([{ type: 'grain', amp: 0.001, f: 90, seed: 35, bake: true }], Mir(2, U(0, ...legs)));
}
function isoPaint() {
  return {
    kScale: 0.005, aoAlb: 0.55,
    mats: {
      [DM.SHELL]: { c: [0.62, 0.56, 0.54], ro: 0.4 }, [DM.BELLY]: { c: [0.70, 0.64, 0.58], ro: 0.5 }, [DM.EYE]: { c: [0.08, 0.08, 0.1], ro: 0.15 },
      [DM.LEG]: { c: [0.66, 0.58, 0.52], ro: 0.45 }
    },
    layers: [
      { c: [0.50, 0.44, 0.50], a: 0.35, m: [mat(DM.SHELL), ['n', 5, 0.45, 0.8, 151]] },   // lilac cast
      { c: [0.40, 0.34, 0.32], a: 0.5, m: [mat(DM.SHELL), ['cav', 0.3, 1.0]] },
      { c: [0.86, 0.82, 0.76], a: 0.35, m: [['cvx', 0.4, 1.2]] },
      { c: [0.02, 0.02, 0.02], a: 0.75, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// =============================================================================================
// FLAPJACK OCTOPUS (fauna FLAPJACK: merge scale 1.1; the umbrella contracts radially, part 6)
// =============================================================================================
function flapBodyF(x, y, z) {
  // a soft dome (mantle) over a flat umbrella of webbed arms, the web scalloped between arms
  const R = Math.hypot(x, z), a = Math.atan2(z, x);
  const dome = Math.hypot(x / 0.6, (y - 0.24) / 0.3, z / 0.6) - 1;
  const scal = 0.08 * (0.5 + 0.5 * Math.cos(a * 8));
  const rim = 0.92 + scal + 0.05 * Math.sin(a * 3 + 1);
  const webTop = 0.2 * (1 - (R / rim) ** 2) + 0.08, webBot = 0.05 + 0.02 * (R / rim);
  const dWeb = Math.max(y - webTop, webBot - y, (R - rim) * 0.9);
  return Math.min(dome * 0.3, dWeb);
}
function flapBodySpec() {
  let s = Fn([-1.15, -0.05, -1.15, 1.15, 0.6, 1.15], flapBodyF, DM.SKIN);
  // the arms: ribs in the web running to the rim, ending in short free tips
  const arms = [];
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU, c = Math.cos(a), sn = Math.sin(a); arms.push(Tube([[c * 0.25, 0.18, sn * 0.25], [c * 0.62, 0.12, sn * 0.62], [c * 0.92, 0.075, sn * 0.92], [c * 1.0, 0.07, sn * 1.0]], 0.055, 0.022, 10, DM.SKIN)); }
  s = U(0.04, s, ...arms);
  // the eyes: big, bulging from the dome's front flanks
  const eyeC = [0.34, 0.36, 0.42];
  s = U(0.04, s, Mir(2, E([0.32, 0.36, 0.4], [0.13, 0.11, 0.09], DM.SKIN)));
  s = Sub(0.02, DM.SKIN, s, Mir(2, Sph([0.36, 0.37, 0.47], 0.075)));
  s = U(0.006, s, Mir(2, Sph([0.36, 0.37, 0.47], 0.078, DM.EYE)));
  return Disp([
    // papillae over the dome, cirri pairs along each arm's underside, the web's fine folds
    { type: 'pits', amp: -0.004, f: 22, dens: 0.35, r: 0.35, seed: 41, bake: true },
    { type: 'fn', amp: 0.004, bake: true, fn: (x, y, z) => { if (y > 0.1) return 0; const R = Math.hypot(x, z); return 0.003 * Math.max(0, Math.cos(R * 50)) * Math.max(0, Math.cos(Math.atan2(z, x) * 8)) ** 8; } },
    { type: 'fbm', amp: 0.006, f: 6, oct: 3, seed: 42, bake: true }
  ], s);
}
function flapFinsSpec() {
  // the two ear fins on top of the dome
  const fin = E([-0.22, 0.47, 0.42], [0.11, 0.025, 0.2], DM.SKIN, [0.75, 0.15, 0.0]);
  return Disp([{ type: 'fbm', amp: 0.004, f: 9, oct: 2, seed: 43, bake: true }], Mir(2, fin));
}
function flapPaint() {
  return {
    kScale: 0.005, aoAlb: 0.5,
    mats: { [DM.SKIN]: { c: [0.46, 0.28, 0.22], ro: 0.35 }, [DM.EYE]: { c: [0.04, 0.035, 0.03], ro: 0.05 } },
    layers: [
      { c: [0.64, 0.46, 0.40], a: 0.6, m: [mat(DM.SKIN), ['nd', [0, -1, 0], 0.2, 0.8]] },
      { c: [0.42, 0.20, 0.14], a: 0.5, m: [mat(DM.SKIN), ['n', 7, 0.5, 0.8, 161]] },
      { c: [0.78, 0.56, 0.46], a: 0.4, m: [['cvx', 0.4, 1.2]] },
      { c: [0.02, 0.02, 0.02], a: 0.7, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// =============================================================================================
// LABELS
// =============================================================================================
const near = (p, c, r) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < r;
export const LABELS = {
  angler: (x, y, z, L) => { L.part = clamp((-x - 0.85) / 0.25, 0, 1); if (near([x, y, Math.abs(z)], AN_EYE, AN_EYER * 1.05)) { L.kind = 1; L.phase = AN_EYER; } if (x < -0.88 || (x < -0.3 && y > 0.3 && Math.abs(z) < 0.03)) L.kind = 3; },
  anglerJaw: (x, y, z, L) => { L.part = 4; },
  anglerPec: (x, y, z, L) => { L.part = 2; L.phase = Math.sign(z) || 1; L.kind = 3; },
  anglerLure: (x, y, z, L) => { L.part = 5; },
  gulper: (x, y, z, L) => { L.part = clamp((-x - 1.2) / 0.6, 0, 1); if (near([x, y, Math.abs(z)], [1.36, 0.0, 0.1], 0.032)) { L.kind = 1; L.phase = 0.03; } },
  gulperJaw: (x, y, z, L) => { L.part = 4; },
  isoBody: (x, y, z, L) => { L.part = 0; },
  isoLegs: (x, y, z, L) => {
    const s = z < 0 ? -1 : 1, az = Math.abs(z);
    let best = 9, ph = 0;
    for (const lg of ISO_LEGS) for (const q of lg.p) { const d = Math.hypot(x - q[0], y - q[1], az - q[2]); if (d < best) { best = d; ph = lg.phase + s; } }
    L.part = 3; L.phase = ph;
  },
  flapBody: (x, y, z, L) => { L.part = 6; if (near([x, y, Math.abs(z)], [0.36, 0.37, 0.47], 0.082)) { L.kind = 1; L.phase = 0.078; } },
  flapFins: (x, y, z, L) => { L.part = 2; L.phase = Math.sign(z) || 1; }
};

export function pipeline() {
  const P = (name, sdf, paint, h, loH, tris, o = {}) => Object.assign({ name, set: 'deep', sdf, paint, hi: { h }, lo: { h: loH, tris, err: loH * 3 }, kEps: h * 2, ao: { r: h * 12, n: 4 }, cage: h * 2.5, ray: h * 8 }, o);
  const escaEmit = S => 1 - sst(AN_ESCAR * 0.7, AN_ESCAR * 1.05, Math.hypot(S.x - AN_ESCA[0], S.y - AN_ESCA[1] + 0.02, S.z - AN_ESCA[2]));
  const tipEmit = S => 1 - sst(0.03, 0.06, Math.hypot(S.x - GU_TIP[0], S.y - GU_TIP[1], S.z - GU_TIP[2]));
  return {
    name: 'deep', out: 'assets/fauna/deep',
    sets: { deep: { size: 2048, gutter: 6, aoDist: 0.15, aoSamples: 48, fill: true } },
    pieces: [
      P('angler', anglerSpec(), anglerPaint(), 0.005, 0.012, 3000),
      P('anglerJaw', anglerJawSpec(), anglerPaint(), 0.005, 0.011, 900),
      P('anglerPec', anglerPecSpec(), anglerPaint(), 0.004, 0.009, 300),
      P('anglerLure', anglerLureSpec(), anglerPaint(), 0.003, 0.007, 500, { emit: escaEmit }),
      P('gulper', gulperSpec(), gulperPaint(), 0.006, 0.012, 2600, { emit: tipEmit }),
      P('gulperJaw', gulperJawSpec(), gulperPaint(), 0.006, 0.012, 1000),
      P('isoBody', isoBodySpec(), isoPaint(), 0.005, 0.012, 2000),
      P('isoLegs', isoLegsSpec(), isoPaint(), 0.004, 0.01, 900),
      P('flapBody', flapBodySpec(), flapPaint(), 0.006, 0.013, 2200),
      P('flapFins', flapFinsSpec(), flapPaint(), 0.005, 0.011, 300)
    ],
    compress: { mesh: 'draco', tex: 'ktx2' },
    meta: {}
  };
}
