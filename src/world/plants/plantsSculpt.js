// THE SESSILE SCULPTS — the sea's plants and fixed animals through the sculpt pipeline
// (lib/sculpt.js SDF specs -> tools/blender high-to-low bake). Pure data builders: no THREE,
// no scene. `node tools/blender/build.mjs plants` -> assets/plants/.
//
// Every species is authored in the SAME local frame the procedural builder in flora.js /
// gardens.js used (base on y = 0, the old bounding box), so the placement streams, the
// instance matrices and the sway amplitudes carry over untouched: plantKit.js swaps the
// geometry under the existing layout. Each species has several VARIANTS, each its own
// seeded spec (`variant(seed)`), and every variant a near low and a far LOD (bake.py `far`).
//
// Each species is its own texture SET (one material per batched draw anyway, so a shared
// atlas would buy no draw; per-species sets keep texel density honest and let a zone stream
// only what it shows).
//
// The runtime also needs, per vertex, the SWAY data the old procedural meshes carried (flex,
// normalised height, part mask, part phase, flutter). Those are pure functions of position
// and the variant's skeleton, so each variant records its skeleton in the meta (`sk`) and
// plantKit.js derives the attributes once at load (SWAY below is the shared definition).
import { mulberry, compile } from '../../lib/sculpt.js';

const TAU = Math.PI * 2;
const E = (c, r, m = 0, e) => ({ t: 'ellip', c, r, m, e });
const Sph = (c, r, m = 0) => ({ t: 'sphere', c, r, m });
const Cap = (a, b, ra, rb = ra, m = 0) => ({ t: 'cap', a, b, ra, rb, m });
const U = (k, ...ch) => ({ t: 'u', k, ch });
const Sub = (k, a, ...b) => ({ t: 's', k, ch: [a, ...b] });
const SubM = (k, m, a, ...b) => ({ t: 's', k, m, ch: [a, ...b] });
const I = (k, ...ch) => ({ t: 'i', k, ch });
const Tube = (p, r0, r1, n = 8, m = 0, rr) => ({ t: 'tube', p, r: [r0, r1], n, m, rr });
const Tor = (c, R, r, m, e) => ({ t: 'torus', c, R, r, m, e });
const Disp = (L, ch) => ({ t: 'disp', L, ch: [ch] });
const Fn = (bb, f, m = 0) => ({ t: 'fn', bb, f, m });
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const r3 = v => v.map(x => +x.toFixed(4));
function bez(P, t) {
  const u = 1 - t;
  if (P.length === 3) return [0, 1, 2].map(i => u * u * P[0][i] + 2 * u * t * P[1][i] + t * t * P[2][i]);
  return [0, 1, 2].map(i => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]);
}

// ============================================================================ TUBE SPONGE
// Callyspongia / Aplysina: a cluster of fused hollow tubes off one encrusting base, each
// curving up and flaring a little at a thick lip round its osculum; the wall is pored and
// carries low conules and a fine fibrous grain (bake-only). Frame: flora.js spongeGeo —
// base at y 0, tallest tube to y ~1, footprint ~0.3.
const TS = { WALL: 0, LIP: 1, BASE: 2 };
function tubeSponge(seed) {
  const R = mulberry(seed);
  const n = 3 + Math.floor(R() * 4), outer = [], bores = [], sk = [];
  const a0 = R() * TAU;
  for (let k = 0; k < n; k++) {
    const a = a0 + k / n * TAU + (R() - 0.5) * 0.7, rb = 0.02 + R() * 0.06;
    const tall = k === 0 ? 1 : 0.42 + R() * 0.5;
    const H = 0.98 * tall, rt = 0.055 + R() * 0.03, tilt = (0.04 + R() * 0.2) * (k === 0 ? 0.35 : 1);
    const b = [Math.cos(a) * rb, -0.04, Math.sin(a) * rb];
    const dir = norm([Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)]);
    const bendA = R() * TAU, bend = 0.015 + R() * 0.035;
    const c1 = add(b, dir, H * 0.35), c2 = add(add(b, dir, H * 0.7), [Math.cos(bendA) * bend, 0, Math.sin(bendA) * bend]);
    const top = add(add(b, dir, H), [Math.cos(bendA) * bend * 1.6, 0, Math.sin(bendA) * bend * 1.6]);
    const P = [b, c1, c2, top];
    // radius along the tube: a narrower foot, near-uniform shaft, the faintest flare at the lip
    const rr = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; rr.push(rt * (0.8 + 0.2 * sst(0, 0.25, t) + 0.05 * sst(0.85, 1, t) + 0.04 * Math.sin(t * 9 + k))); }
    outer.push(Tube(P, rt, rt, 12, TS.WALL, rr));
    // the bore: the same path, open past the top; the wall thins toward the rim
    const wall = 0.013 + R() * 0.005, up = norm([top[0] - c2[0], top[1] - c2[1], top[2] - c2[2]]);
    const Pb = [lerp3(b, c1, 0.5), c1, c2, add(top, up, 0.1)];
    const rb2 = rr.map((r, i) => Math.max(0.01, r - wall * (1 - 0.35 * sst(9, 12, i))));
    bores.push(Tube(Pb, rt - wall, rt - wall, 12, TS.LIP, rb2));
    sk.push({ b: r3(b), top: r3(top), r: +(rr[12]).toFixed(4) });
  }
  const base = E([0, -0.03, 0], [0.13, 0.05, 0.13], TS.BASE);
  const body = Sub(0.004, U(0.04, base, ...outer), ...bores);
  const sdf = Disp([
    { type: 'fbm', amp: 0.005, f: 8, oct: 3, seed: seed + 1 },
    { type: 'barn', amp: 0.0045, f: 42, dens: 0.42, seed: seed + 2, mask: [['ax', 1, 0.02, 0.1]] },   // conules
    { type: 'pits', bake: true, amp: 0.0045, f: 80, dens: 0.6, r: 0.3, seed: seed + 3 },             // ostia
    { type: 'ridged', bake: true, amp: 0.0022, f: 55, oct: 2, seed: seed + 4 },                      // fibrous skeleton
    { type: 'grain', bake: true, amp: 0.0008, f: 240, seed: seed + 5 }
  ], body);
  return { sdf, sk: { tubes: sk } };
}
function frameUp(up) {
  // rows of R (local -> world): local +Y onto `up`
  const Y = norm(up), X0 = Math.abs(Y[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const Z = norm([X0[1] * Y[2] - X0[2] * Y[1], X0[2] * Y[0] - X0[0] * Y[2], X0[0] * Y[1] - X0[1] * Y[0]]);
  const X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]];
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
}
const TS_PAINT = {
  kScale: 0.0015, aoAlb: 0.75,
  mats: {
    [TS.WALL]: { c: [0.70, 0.58, 0.48], ro: 0.86 },
    [TS.LIP]: { c: [0.80, 0.70, 0.60], ro: 0.8 },
    [TS.BASE]: { c: [0.46, 0.40, 0.34], ro: 0.92 }
  },
  layers: [
    { c: [0.56, 0.44, 0.36], a: 0.55, m: [['n', 7, 0.45, 0.75, 11]] },                    // blotched growth
    { c: [0.36, 0.28, 0.24], a: 0.7, m: [['cav', 0.15, 0.9]] },                          // pores, conule pits
    { c: [0.86, 0.78, 0.68], a: 0.5, ro: 0.72, m: [['cvx', 0.4, 1.6]] },                 // worn conule crowns
    { c: [0.30, 0.28, 0.25], a: 0.6, ro: 0.95, m: [['ax', 1, 0.14, 0.0]] },              // silted foot
    { c: [0.18, 0.12, 0.10], a: 0.85, m: [['ao', 0.45, 0.95]] }                          // the bore's dark throat
  ]
};

// ============================================================================ ANEMONE
// (plants2 rebuild) The column is no longer a pot with a rim: a broad, lumpy PEDAL DISC grips
// the rock, the column WAISTS above it and swells again under a soft rolled margin (the
// capitulum, with acrorhagi), and the tentacles start AT that margin so the crown hides it.
// Six forms for silhouette: std (Urticina), long (Condylactis), bubble-tipped (Entacmaea),
// dense-short (Anthopleura), plume (Metridium: a tall smooth column under a lobed, frilled
// crown of fine tentacles) and carpet (Stichodactyla: a wide undulating disc of tiny ones).
// Frame: gardens.js / flora.js anemoneGeo — base y 0, crown to ~0.75, r ~0.45.
const AN = { COL: 0, DISC: 1, TENT: 2, TIP: 3, MOUTH: 4 };
const AN_T = {
  std: { D: 0.15, colR: 0.13, disc: 1.12, thick: 1, rings: [[36, 0.98, 0.3, 0.4], [26, 0.76, 0.26, 0.36], [14, 0.52, 0.2, 0.28]] },
  long: { D: 0.14, colR: 0.12, disc: 1.12, thick: 1, rings: [[32, 0.98, 0.4, 0.52], [22, 0.74, 0.34, 0.46], [12, 0.5, 0.24, 0.32]] },
  bubble: { D: 0.13, colR: 0.13, disc: 1.1, thick: 1.35, rings: [[28, 0.98, 0.18, 0.25], [20, 0.74, 0.16, 0.22], [12, 0.5, 0.13, 0.17]] },
  dense: { D: 0.1, colR: 0.15, disc: 1.12, thick: 0.9, rings: [[46, 0.98, 0.16, 0.22], [34, 0.8, 0.15, 0.2], [24, 0.6, 0.12, 0.17], [12, 0.38, 0.1, 0.13]] },
  plume: { D: 0.44, colR: 0.095, disc: 2.6, thick: 0.45, lobes: 5, rings: [[90, 0.97, 0.05, 0.08], [70, 0.82, 0.05, 0.07], [50, 0.64, 0.04, 0.06]] },
  carpet: { D: 0.06, colR: 0.11, disc: 3.4, thick: 0.6, lobes: 9, rings: [] }
};
function anemone(seed, type) {
  const R = mulberry(seed), T = AN_T[type];
  const D = T.D, colR = T.colR * (0.92 + R() * 0.16), dR = colR * T.disc, lobes = T.lobes || 0, lph = R() * TAU;
  const discR = a => dR * (1 + (lobes ? 0.22 * Math.cos(a * lobes + lph) : 0.04 * Math.sin(a * 7 + lph)));
  const frill = (a, r) => lobes ? 0.035 * Math.sin(a * lobes * 2 + lph) * sst(0.5, 1, r) * (type === 'plume' ? 1 : 0.6) : 0;
  // the column: pedal disc -> waist -> swelling under the margin (a lathe with lumps)
  const colProf = y => { const t = Math.min(1, Math.max(0, y / D)); return colR * (type === 'plume' ? 1.3 - 0.42 * sst(0.0, 0.45, t) + 0.16 * sst(0.7, 1.0, t) : 1.12 - 0.14 * sst(0.0, 0.5, t) + 0.08 * sst(0.7, 1.0, t)); };
  const col = Fn([-0.5, -0.06, -0.5, 0.5, D + 0.02, 0.5], (x, y, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const lump = 0.012 * Math.sin(a * 5 + y * 30 + lph) * sst(0.0, 0.3, y / D);
    return Math.max((r - colProf(y) - lump) * 0.85, -0.04 - y, y - D);
  }, AN.COL);
  const pedal = E([0, -0.005, 0], [colR * (type === 'plume' ? 1.55 : 1.25), 0.025, colR * (type === 'plume' ? 1.4 : 1.18)], AN.COL);
  // the oral disc (lobed and frilled on the plume and the carpet), its margin rolled
  const disc = Fn([-0.75, D - 0.08, -0.75, 0.75, D + 0.1, 0.75], (x, y, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x), R0 = discR(a), q = r / R0;
    const yc = D + 0.012 - 0.02 * (1 - q * q) * (type === 'carpet' ? 0.3 : 1) + frill(a, q) + (type === 'plume' ? 0.04 * q * q : 0);
    return Math.max(Math.abs(y - yc) - 0.016 * (1 - 0.5 * q), (r - R0) * 0.8);
  }, AN.DISC);
  const margin = Tor([0, D - 0.008, 0], colR * 1.02, 0.017, AN.COL);
  const lip = Tor([0, D + 0.014, 0], 0.028, 0.012, AN.MOUTH);
  const slit = E([0, D + 0.03, 0], [0.024, 0.02, 0.008], AN.MOUTH);
  const tents = [], sk = [];
  T.rings.forEach(([cnt, rk, l0, l1], ri) => {
    for (let i = 0; i < cnt; i++) {
      const a = (i + (ri % 2) * 0.5) / cnt * TAU + (R() - 0.5) * 0.14;
      const R0 = discR(a) * rk, len = l0 + R() * (l1 - l0), out = [Math.cos(a), 0, Math.sin(a)];
      const q = rk, yb = D + 0.012 - 0.02 * (1 - q * q) + frill(a, q) + (type === 'plume' ? 0.04 * q * q : 0) + 0.008;
      const b = [out[0] * R0, yb, out[2] * R0];
      // the outer ring leaves the margin low and falls over it (the crown hides the column);
      // inner rings stand taller
      const el0 = (type === 'long' ? 0.6 : type === 'plume' ? 0.7 : 0.75) + 0.3 * ri + (R() - 0.5) * 0.3;
      const fall = (type === 'long' ? 1.25 : 1.0) + R() * 0.5 - 0.15 * ri, sway = (R() - 0.5) * 0.5;
      const pts = [b];
      let p = b.slice();
      for (let k = 1; k <= 3; k++) {
        const t = k / 3, el = el0 - fall * t * t, az = a + sway * t;
        p = add(p, [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], len / 3);
        pts.push(p);
      }
      const tip = pts[3], r0 = 0.012 * T.thick, r1 = 0.0055 * T.thick, rr = [];
      for (let k = 0; k <= 8; k++) { const t = k / 8; rr.push(r0 + (r1 - r0) * Math.pow(t, 0.7)); }
      if (type === 'bubble') { rr[5] *= 1.15; rr[6] *= 1.45; rr[7] *= 1.75; rr[8] *= 1.7; }
      tents.push(Tube(pts, r0, r1, type === 'plume' ? 3 : 8, AN.TENT, rr));
      tents.push(Sph(tip, rr[8] * 1.1, AN.TIP));
      sk.push({ b: r3(b), tip: r3(tip), len: +len.toFixed(3) });
    }
  });
  let body = U(0.03, pedal, col);
  body = U(0.02, body, margin);
  body = U(0.02, body, disc);
  body = U(0.008, body, lip);
  body = SubM(0.004, AN.MOUTH, body, slit);
  const L = [
    { type: 'barn', amp: 0.007, f: 30, dens: 0.6, seed: seed + 7, mask: [['ax', 1, D * 0.9, D * 0.5]] },     // verrucae / acrorhagi up the column
    { type: 'fbm', amp: 0.003, f: 14, oct: 2, seed: seed + 8 },
    { type: 'fbm', bake: true, amp: 0.0015, f: 40, oct: 2, seed: seed + 10, mask: [['ax', 1, D * 0.9, D * 0.3]] },   // the column's soft wrinkling
    { type: 'grain', bake: true, amp: 0.0006, f: 300, seed: seed + 9 }
  ];
  if (type === 'carpet') L.push({ type: 'barn', bake: true, amp: 0.006, f: 70, dens: 0.85, seed: seed + 11, mask: [['ax', 1, D - 0.01, D + 0.02]] });   // the carpet's tiny tentacles
  const sdf = Disp(L, tents.length ? U(0.012, body, U(0, ...tents)) : body);
  // the plume's fine crown is bake detail on its lobes in the low (hundreds of slivers QEM
  // cannot keep); every other form keeps its tentacles in the mesh
  const loSdf = type === 'plume' ? Disp(L, U(0.02, body, Fn([-0.75, D - 0.02, -0.75, 0.75, D + 0.16, 0.75], (x, y, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x), R0 = discR(a), q = r / R0;
    const yc = D + 0.06 + 0.04 * q * q + frill(a, q);
    return Math.max(Math.abs(y - yc) - 0.03 * (1 - 0.4 * q), (r - R0 * 1.06) * 0.8);
  }, AN.TENT))) : undefined;
  return { sdf, loSdf, sk: { disc: D, colR: +colR.toFixed(4), dR: +dR.toFixed(4), tents: sk } };
}
// radial stripes on the disc (the stripe count follows the tentacle ring)
const discStripe = S => { if (!((S.ma === AN.DISC && S.mw < 0.5) || (S.mb === AN.DISC && S.mw >= 0.5))) return 0; const a = Math.atan2(S.z, S.x); return sst(0.2, 0.9, Math.sin(a * 13) * 0.5 + 0.5); };
const tentTip = S => (S.ma === AN.TIP || S.mb === AN.TIP) ? 1 : 0;
const AN_PAINT = {
  kScale: 0.0012, aoAlb: 0.6,
  mats: {
    [AN.COL]: { c: [0.52, 0.40, 0.36], ro: 0.6 },
    [AN.DISC]: { c: [0.62, 0.52, 0.44], ro: 0.45 },
    [AN.TENT]: { c: [0.74, 0.64, 0.56], ro: 0.38 },
    [AN.TIP]: { c: [0.88, 0.80, 0.70], ro: 0.3 },
    [AN.MOUTH]: { c: [0.58, 0.36, 0.34], ro: 0.4 }
  },
  layers: [
    { c: [0.40, 0.30, 0.28], a: 0.55, m: [['n', 18, 0.5, 0.8, 21], ['mat', AN.COL]] },
    { c: [0.32, 0.26, 0.24], a: 0.5, m: [['mat', AN.COL], ['ax', 1, 0.08, -0.02]] },                 // the pedal disc, silted
    { c: [0.68, 0.56, 0.46], a: 0.5, m: [['fn', discStripe]] },
    { c: [0.86, 0.78, 0.70], a: 0.45, m: [['mat', AN.TENT], ['cvx', 0.2, 1.2]] },                    // paler tentacle crests
    { c: [0.60, 0.50, 0.46], a: 0.5, m: [['fn', S => tentTip(S) * sst(0.5, 1, Math.sin(S.x * 140) * Math.sin(S.z * 140))]] },
    { c: [0.30, 0.20, 0.20], a: 0.6, m: [['cav', 0.2, 1.0]] },
    { c: [0.14, 0.08, 0.08], a: 0.8, m: [['ao', 0.5, 0.95]] }
  ]
};

// ---- 2D/3D noise for the analytic fields (deterministic, periodic-free) --------------------
function h2(x, y, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function h3(x, y, z, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(s | 0, 144665); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn3(x, y, z, s) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = x - X, fy = y - Y, fz = z - Z;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h3(X, Y, Z, s), h3(X + 1, Y, Z, s), u), L(h3(X, Y + 1, Z, s), h3(X + 1, Y + 1, Z, s), u), v),
    L(L(h3(X, Y, Z + 1, s), h3(X + 1, Y, Z + 1, s), u), L(h3(X, Y + 1, Z + 1, s), h3(X + 1, Y + 1, Z + 1, s), u), v), w) * 2 - 1;
}
const fbm3n = (x, y, z, s, o = 3) => { let a = 0, k = 1, t = 0, f = 1; for (let i = 0; i < o; i++) { a += k * vn3(x * f, y * f, z * f, s + i * 7); t += k; k *= 0.5; f *= 2.02; } return a / t; };
// 2D cell borders: distance (in cell units) to the nearest Voronoi edge, ~ (F2 - F1) / 2
function cellEdge2(x, y, s) {
  const X = Math.floor(x), Y = Math.floor(y);
  let f1 = 9, f2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = X + i, cy = Y + j, px = cx + 0.15 + 0.7 * h2(cx, cy, s), py = cy + 0.15 + 0.7 * h2(cx, cy, s + 31);
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return (f2 - f1) * 0.5;
}

// ============================================================================ BARREL SPONGE
// Xestospongia: a thick-walled vase, the wall thrown into deep meandering vertical ridges
// (digitate toward the rim), a wide osculum, the throat dark; the skin pored and conuled.
// Frame: gardens.js barrelGeo — base y 0, rim ~1.72, radius ~0.64.
const BR = { WALL: 0, RIM: 1, IN: 2 };
// (plants2) five silhouettes: classic, squat (wider than tall), tall (a narrow urn), split (the
// rim torn into lobes, one side slumped), lean (grown curved toward the light)
function barrel(seed, type = 'classic') {
  const R = mulberry(seed);
  let top = 1.55 + R() * 0.2, wide = 0.56 + R() * 0.08, N = 9 + Math.floor(R() * 6), ph = R() * TAU, amp = 0.05 + R() * 0.035;
  const s = seed;
  if (type === 'squat') { top = 1.0 + R() * 0.1; wide = 0.7 + R() * 0.06; N = 12 + Math.floor(R() * 4); }
  if (type === 'tall') { top = 1.9 + R() * 0.1; wide = 0.44 + R() * 0.04; N = 8 + Math.floor(R() * 2); amp *= 0.8; }
  const notches = type === 'split' ? [R() * TAU, R() * TAU + 2, R() * TAU + 4] : [];
  const leanA = R() * TAU, leanK = type === 'lean' ? 0.22 : 0;
  const prof = y => { const t = Math.min(1, Math.max(0, y / top)); return wide * (0.5 + 0.5 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5)) * (1 - 0.1 * sst(0.8, 1, t)); };
  const ridge = (a, y) => {
    const w = a * N + ph + 1.6 * fbm3n(Math.cos(a) * 1.4, y * 1.3, Math.sin(a) * 1.4, s, 2);
    const c = Math.abs(Math.sin(w * 0.5));                  // 1 on the crests, 0 in the valleys
    return amp * (Math.pow(c, 2.2) - 0.35) * (0.35 + 0.65 * sst(0.1, 0.9, y / top));
  };
  const f = (x0, y, z0) => {
    const lt = Math.pow(Math.max(0, y / top), 2) * leanK, x = x0 - Math.cos(leanA) * lt, z = z0 - Math.sin(leanA) * lt;
    const rad = Math.hypot(x, z), a = Math.atan2(z, x);
    const Ro = prof(y) + ridge(a, y), wall = 0.13 - 0.07 * sst(0.2, 1.0, y / top);
    let lipY = top + 0.03 * Math.sin(a * 3 + ph) + 0.6 * ridge(a, top);
    for (let k = 0; k < notches.length; k++) { const da = Math.atan2(Math.sin(a - notches[k]), Math.cos(a - notches[k])); lipY -= (k === 0 ? 0.55 : 0.28) * top * Math.exp(-((da / (k === 0 ? 0.5 : 0.22)) ** 2)); }
    const dOut = (rad - Ro) * 0.62;
    const dCav = Math.max(rad - (Ro - wall - Math.max(0, ridge(a, y))), 0.3 - y);   // < 0 inside the cavity
    return Math.max(dOut, -dCav * 0.62, y - lipY, -0.06 - y);
  };
  const body = Fn([-0.95, -0.08, -0.95, 0.95, top + 0.12, 0.95], f, BR.WALL);
  const sdf = Disp([
    { type: 'fbm', amp: 0.012, f: 5, oct: 3, seed: s + 3 },
    { type: 'barn', amp: 0.006, f: 22, dens: 0.4, seed: s + 4 },
    { type: 'pits', bake: true, amp: 0.006, f: 45, dens: 0.6, r: 0.3, seed: s + 5 },
    { type: 'ridged', bake: true, amp: 0.003, f: 30, oct: 2, seed: s + 6 },
    { type: 'grain', bake: true, amp: 0.0012, f: 160, seed: s + 7 }
  ], { t: 'round', r: 0.01, ch: [body] });
  return { sdf, sk: { top: +top.toFixed(3) } };
}
const BR_PAINT = {
  kScale: 0.003, aoAlb: 0.8,
  mats: { [BR.WALL]: { c: [0.62, 0.42, 0.34], ro: 0.88 } },
  layers: [
    { c: [0.50, 0.32, 0.26], a: 0.5, m: [['n', 4, 0.4, 0.75, 51]] },
    { c: [0.30, 0.18, 0.15], a: 0.75, m: [['cav', 0.1, 0.8]] },
    { c: [0.78, 0.62, 0.50], a: 0.55, ro: 0.75, m: [['cvx', 0.3, 1.4]] },
    { c: [0.32, 0.30, 0.26], a: 0.55, ro: 0.95, m: [['ax', 1, 0.22, 0.0]] },
    { c: [0.10, 0.06, 0.05], a: 0.9, m: [['ao', 0.35, 0.9]] }
  ]
};

// ============================================================================ TUBE WORMS
// Riftia: a clump of chitin tubes off a sulphide-crusted mound, each tube banded by growth
// collars and stained toward the base, crowned by a blood-red branchial plume of stacked
// lamellae. The plume retracts INTO its own tube (plantKit's sway data carries each plume's
// mouth). Frame: gardens.js tubewormGeo — base y 0, tallest crown ~1.14, radius ~0.45.
const TW = { TUBE: 0, PLUME: 1, CRUST: 2, COLLAR: 3 };
function worms(seed) {
  const R = mulberry(seed);
  const n = 11 + Math.floor(R() * 7), tubes = [], bores = [], plumes = [], sk = [], collars = [];
  for (let k = 0; k < n; k++) {
    const a = R() * TAU, r = Math.sqrt(R()) * 0.3;
    const b = [Math.cos(a) * r, -0.05, Math.sin(a) * r];
    const lean = norm([Math.cos(a) * r * 0.5 + (R() - 0.5) * 0.3, 1, Math.sin(a) * r * 0.5 + (R() - 0.5) * 0.3]);
    const H = 0.42 + R() * 0.55, tr = 0.022 + R() * 0.012;
    const bendA = R() * TAU, bend = 0.02 + R() * 0.05;
    const c1 = add(b, lean, H * 0.33), c2 = add(add(b, lean, H * 0.66), [Math.cos(bendA) * bend, 0, Math.sin(bendA) * bend]);
    const top = add(add(b, lean, H), [Math.cos(bendA) * bend * 1.3, 0, Math.sin(bendA) * bend * 1.3]);
    const up = norm([top[0] - c2[0], top[1] - c2[1], top[2] - c2[2]]);
    const rr = []; for (let i = 0; i <= 10; i++) { const t = i / 10; rr.push(tr * (0.85 + 0.15 * t + 0.06 * Math.sin(t * 17 + k))); }
    tubes.push(Tube([b, c1, c2, top], tr, tr, 10, TW.TUBE, rr));
    bores.push(Tube([lerp3(c2, top, 0.5), top, add(top, up, 0.06)], tr * 0.68, tr * 0.72, 3, TW.TUBE));
    // growth collars: flared rims left by each growth spurt
    const nc = 3 + Math.floor(R() * 4);
    for (let c = 0; c < nc; c++) {
      const t = 0.25 + 0.7 * (c + R() * 0.5) / nc, p = bez([b, c1, c2, top], t), p2 = bez([b, c1, c2, top], Math.min(1, t + 0.02));
      collars.push({ t: 'xf', p, R: frameUp([p2[0] - p[0], p2[1] - p[1], p2[2] - p[2]]), ch: [Tor([0, 0, 0], tr * 1.02, tr * 0.22, TW.COLLAR)] });
    }
    // the plume: a crown of lamellae (grooves cut by the displacement below), rising from the mouth
    const L = 0.1 + R() * 0.07, pc = add(top, up, L * 0.48 + 0.01);
    plumes.push({ t: 'xf', p: pc, R: frameUp(up), ch: [E([0, 0, 0], [tr * 1.55, L * 0.55, tr * 1.55], TW.PLUME)] });
    sk.push({ m: r3(top), up: r3(up), L: +L.toFixed(3), r: +tr.toFixed(4) });
  }
  // lamella grooves: radial fins around each plume's own axis
  const lam = (x, y, z) => {
    let best = 1e9, q = null;
    for (const t of sk) { const d = (x - t.m[0]) ** 2 + (y - t.m[1]) ** 2 + (z - t.m[2]) ** 2; if (d < best) { best = d; q = t; } }
    const px = x - q.m[0], py = y - q.m[1], pz = z - q.m[2], al = px * q.up[0] + py * q.up[1] + pz * q.up[2];
    if (al < 0 || al > q.L * 1.2) return 0;
    const rx = px - q.up[0] * al, ry = py - q.up[1] * al, rz = pz - q.up[2] * al;
    // a stable angle about the axis
    const X = Math.abs(q.up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const zx = q.up[1] * X[2] - q.up[2] * X[1], zy = q.up[2] * X[0] - q.up[0] * X[2], zz = q.up[0] * X[1] - q.up[1] * X[0];
    const xx = zy * q.up[2] - zz * q.up[1], xy = zz * q.up[0] - zx * q.up[2], xz = zx * q.up[1] - zy * q.up[0];
    const ang = Math.atan2(rx * zx + ry * zy + rz * zz, rx * xx + ry * xy + rz * xz);
    const fin = Math.abs(Math.sin(ang * 11 + al * 30));
    return -0.006 * Math.pow(fin, 3) * sst(0.0, 0.25, al / q.L);
  };
  const plumeU = Disp([{ type: 'fn', amp: 0.006, fn: lam }, { type: 'grain', bake: true, amp: 0.0008, f: 260, seed: seed + 3 }], U(0.01, ...plumes));
  const crust = E([0, -0.05, 0], [0.42, 0.09, 0.4], TW.CRUST);
  let body = U(0.03, crust, U(0.004, ...tubes, ...collars));
  body = Sub(0.003, body, ...bores);
  body = U(0.006, body, plumeU);
  const L = [
    { type: 'fbm', amp: 0.004, f: 10, oct: 3, seed: seed + 1 },
    { type: 'barn', amp: 0.01, f: 18, dens: 0.55, seed: seed + 2, mask: [['ax', 1, 0.06, -0.02]] },     // the mound's sulphide crust
    { type: 'bands', bake: true, amp: 0.0012, f: 260, ax: [0, 1, 0], mask: [['ax', 1, 0.02, 0.08]] },    // the tubes' fine growth lines
    { type: 'grain', bake: true, amp: 0.0007, f: 300, seed: seed + 4 }
  ];
  const sdf = Disp(L, body);
  // the LOW leaves the collars and the lamellae to the bake (they are what kept QEM from
  // reaching its budget: hundreds of tiny charts), keeping the tubes, mouths and plume bodies
  const loSdf = Disp(L, U(0.006, Sub(0.003, U(0.03, crust, U(0.004, ...tubes)), ...bores), U(0.01, ...plumes)));
  return { sdf, loSdf, sk: { tubes: sk } };
}
const plumeTip = S => (S.ma === TW.PLUME || S.mb === TW.PLUME) ? 1 : 0;
const TW_PAINT = {
  kScale: 0.0015, aoAlb: 0.65,
  mats: {
    [TW.TUBE]: { c: [0.86, 0.82, 0.72], ro: 0.55 },
    [TW.COLLAR]: { c: [0.80, 0.74, 0.62], ro: 0.6 },
    [TW.PLUME]: { c: [0.52, 0.05, 0.04], ro: 0.35 },
    [TW.CRUST]: { c: [0.26, 0.22, 0.19], ro: 0.95 }
  },
  layers: [
    { c: [0.55, 0.45, 0.32], a: 0.75, m: [['ax', 1, 0.28, 0.0], ['mat', TW.TUBE]] },                // sulphide staining up from the base
    { c: [0.62, 0.52, 0.38], a: 0.45, m: [['n', 22, 0.5, 0.8, 61], ['mat', TW.TUBE]] },
    { c: [0.70, 0.14, 0.10], a: 0.6, m: [['fn', plumeTip], ['cvx', 0.2, 1.0]] },                    // lamella edges brighter
    { c: [0.25, 0.02, 0.02], a: 0.6, m: [['fn', plumeTip], ['cav', 0.1, 0.8]] },
    { c: [0.86, 0.84, 0.78], a: 0.55, m: [['mat', TW.CRUST], ['n', 30, 0.6, 0.75, 62]] },          // bacterial frosting on the crust
    { c: [0.14, 0.10, 0.08], a: 0.6, m: [['cav', 0.2, 1.0], ['inv', ['fn', plumeTip]]] },
    { c: [0.05, 0.03, 0.03], a: 0.85, m: [['ao', 0.5, 0.95]] }
  ]
};

// ============================================================================ STAGHORN
// Acropora cervicornis: antler branches rising off an encrusting plate, forking at 30-50
// degrees, knobbled by radial corallites (bake) with a pale axial corallite at every tip.
// Frame: gardens.js staghornGeo / flora.js staghornGeo — base y 0, ~0.7 tall, ~0.42 wide.
const SG = { BR: 0, TIP: 1, PLATE: 2 };
function staghorn(seed) {
  const R = mulberry(seed);
  const caps = [], tips = [];
  const grow = (p, d, len, r, lvl) => {
    const pts = [p];
    let q = p.slice(), dir = d.slice();
    for (let k = 1; k <= 3; k++) {
      dir = norm(add(add(dir, [0, 1, 0], 0.12 + R() * 0.12), [(R() - 0.5) * 0.25, 0, (R() - 0.5) * 0.25]));
      q = add(q, dir, len / 3);
      pts.push(q);
    }
    const r1 = r * 0.62;
    caps.push(Tube(pts, r, r1, 6, SG.BR));
    if (lvl <= 0 || len < 0.08) { tips.push(Sph(q, r1 * 1.04, SG.TIP)); return; }
    const nk = lvl >= 2 ? 2 + (R() < 0.5 ? 1 : 0) : 1 + (R() < 0.6 ? 1 : 0);
    for (let i = 0; i < nk; i++) {
      const t = 0.45 + 0.45 * (i + R() * 0.6) / nk, b = bez(pts, t), az = R() * TAU;
      const side = [Math.cos(az), 0, Math.sin(az)], off = 0.5 + R() * 0.35;
      const tg = norm([pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]]);
      const d2 = norm(add(tg.map(v => v * Math.cos(off)), side, Math.sin(off)));
      grow(b, d2, len * (0.5 + R() * 0.2), r * (0.72 + 0.12 * (1 - t)), lvl - 1);
    }
    tips.push(Sph(q, r1 * 1.04, SG.TIP));
  };
  const nb = 3 + Math.floor(R() * 3), a0 = R() * TAU;
  for (let b = 0; b < nb; b++) {
    const az = a0 + b / nb * TAU + (R() - 0.5) * 0.6, tilt = 0.35 + R() * 0.55;
    grow([Math.cos(az) * 0.04, 0.0, Math.sin(az) * 0.04], [Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt)], 0.36 + R() * 0.18, 0.03 + R() * 0.006, 2);
  }
  const plate = E([0, -0.01, 0], [0.16, 0.035, 0.15], SG.PLATE);
  const body = U(0.012, plate, U(0.008, ...caps), U(0.004, ...tips));
  const sdf = Disp([
    { type: 'fbm', amp: 0.0025, f: 18, oct: 2, seed: seed + 1 },
    { type: 'barn', amp: 0.0035, f: 70, dens: 0.6, seed: seed + 2 },                                  // radial corallites
    { type: 'pits', bake: true, amp: 0.002, f: 150, dens: 0.6, r: 0.3, seed: seed + 3 },
    { type: 'grain', bake: true, amp: 0.0006, f: 320, seed: seed + 4 }
  ], body);
  return { sdf, sk: {} };
}
const SG_PAINT = {
  kScale: 0.0012, aoAlb: 0.7,
  mats: { [SG.BR]: { c: [0.70, 0.60, 0.46], ro: 0.62 }, [SG.TIP]: { c: [0.92, 0.88, 0.80], ro: 0.5 }, [SG.PLATE]: { c: [0.46, 0.40, 0.32], ro: 0.8 } },
  layers: [
    { c: [0.60, 0.48, 0.36], a: 0.45, m: [['n', 12, 0.45, 0.8, 71]] },
    { c: [0.88, 0.84, 0.74], a: 0.6, m: [['ax', 1, 0.3, 0.7]] },                  // the growing ends bleach
    { c: [0.32, 0.26, 0.20], a: 0.7, m: [['cav', 0.2, 1.0]] },
    { c: [0.92, 0.88, 0.80], a: 0.5, m: [['cvx', 0.6, 1.8]] },                    // corallite rims
    { c: [0.12, 0.09, 0.07], a: 0.8, m: [['ao', 0.45, 0.95]] }
  ]
};

// ============================================================================ BRAIN CORAL
// Diploria (plants2 rebuild): the meanders are GEOMETRY now. A labyrinth is grown in the
// colony's own polar map (difference-of-blurs, the Turing mechanism: valleys and collines of
// one constant width that wander, fork and dead-end) and displaces the dome; the bake adds
// the septa that tooth every valley, the groove along every crest, pits and grain. The low
// is EXPLICIT: a polar grid ray-cast onto the field, its UVs the azimuthal-equidistant map
// (one chart, no seams), and the far LODs are the same grid at lower resolution on the
// maze-free dome (same UVs — they decimate perfectly because they are not decimated).
// Frame: flora.js brainGeo — dome r ~0.5, crown ~0.42, rim rolled under to ~-0.12.
const BC = { CORAL: 0 };
const BR_O = [0, -0.06, 0], BR_TH = 1.95;   // ray origin, polar cap angle of the map
let MAZE = null;
function brainMaze() {
  if (MAZE) return MAZE;
  const N = 480, R = mulberry(4242);
  let x = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) x[i] = R() * 2 - 1;
  const tmp = new Float32Array(N * N);
  const box = (src, dst, r) => {   // separable box blur, wrap (the disc never reaches the border)
    const w = 2 * r + 1;
    for (let j = 0; j < N; j++) { let acc = 0; for (let k = -r; k <= r; k++) acc += src[j * N + ((k + N) % N)]; for (let i = 0; i < N; i++) { tmp[j * N + i] = acc / w; acc += src[j * N + ((i + r + 1) % N)] - src[j * N + ((i - r + N) % N)]; } }
    for (let i = 0; i < N; i++) { let acc = 0; for (let k = -r; k <= r; k++) acc += tmp[((k + N) % N) * N + i]; for (let j = 0; j < N; j++) { dst[j * N + i] = acc / w; acc += tmp[((j + r + 1) % N) * N + i] - tmp[((j - r + N) % N) * N + i]; } }
  };
  const gb = (src, r) => { const a = new Float32Array(N * N), b = new Float32Array(N * N); box(src, a, r); box(a, b, r); box(b, a, r); return a; };
  for (let it = 0; it < 28; it++) {
    const a = gb(x, 2), b = gb(x, 4);
    for (let i = 0; i < N * N; i++) x[i] = Math.tanh(5 * (a[i] - b[i]) / 0.08 + 0.02);
  }
  const s = gb(x, 1);
  MAZE = { N, s };
  return MAZE;
}
// the maze value at a map coordinate (u, v in 0..1), bilinear; s in [-1, 1], ridges positive
function mazeAt(u, v) {
  const M = brainMaze(), N = M.N, x = u * N - 0.5, y = v * N - 0.5, X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y;
  const g = (i, j) => M.s[((j + N) % N) * N + ((i + N) % N)];
  return (g(X, Y) * (1 - fx) + g(X + 1, Y) * fx) * (1 - fy) + (g(X, Y + 1) * (1 - fx) + g(X + 1, Y + 1) * fx) * fy;
}
// world point -> the polar map
function brainUV(x, y, z) {
  const dx = x - BR_O[0], dy = y - BR_O[1], dz = z - BR_O[2], r = Math.hypot(dx, dz), th = Math.atan2(r, dy), ph = Math.atan2(dz, dx);
  const rho = Math.min(1, th / BR_TH) * 0.47;
  return [0.5 + rho * Math.cos(ph), 0.5 + rho * Math.sin(ph)];
}
const brainRidge = (x, y, z) => { const [u, v] = brainUV(x, y, z), m = mazeAt(u, v); return sst(-0.55, 0.55, m); };
function brain(seed) {
  const R = mulberry(seed);
  const sq = 0.72 + R() * 0.16, s = seed;
  const dome = E([0, -0.12, 0], [0.5, 0.5 * sq + 0.06, 0.48], BC.CORAL);
  const lumps = [];
  for (let k = 0; k < 3; k++) { const a = R() * TAU, r = 0.15 + R() * 0.2; lumps.push(Sph([Math.cos(a) * r, 0.12 + R() * 0.12, Math.sin(a) * r], 0.16 + R() * 0.08, BC.CORAL)); }
  const body = I(0.03, U(0.12, dome, ...lumps), { t: 'plane', n: [0, -1, 0], o: 0.12, m: BC.CORAL });
  // collines: rounded, the crest grooved (bake); valleys floored, toothed by septa (bake)
  const maze = (x, y, z) => 0.026 * (brainRidge(x, y, z) - 0.5);
  const groove = (x, y, z) => { const [u, v] = brainUV(x, y, z), m = mazeAt(u, v); return -0.004 * Math.exp(-(((m - 0.97) / 0.06) ** 2)); };
  const septa = (x, y, z) => {
    const [u, v] = brainUV(x, y, z), e = 1 / 512, gx = mazeAt(u + e, v) - mazeAt(u - e, v), gy = mazeAt(u, v + e) - mazeAt(u, v - e), gl = Math.hypot(gx, gy) || 1;
    const m = mazeAt(u, v), val = 1 - sst(-0.7, -0.1, m);
    return 0.0035 * val * Math.pow(Math.abs(Math.sin((u * -gy + v * gx) / gl * 900)), 3);
  };
  const base = [{ type: 'fbm', amp: 0.01, f: 4, oct: 2, seed: s + 1 }];
  const sdf = Disp([...base,
    { type: 'fn', amp: 0.026, fn: maze },
    { type: 'fn', bake: true, amp: 0.004, fn: groove },
    { type: 'fn', bake: true, amp: 0.0035, fn: septa },
    { type: 'pits', bake: true, amp: 0.0012, f: 170, dens: 0.4, r: 0.3, seed: s + 2 },
    { type: 'grain', bake: true, amp: 0.0005, f: 300, seed: s + 3 }
  ], body);
  const fLo = compile(Disp([...base, { type: 'fn', amp: 0.026, fn: maze }], body), true).f;
  const fFar = compile(Disp(base, body), true).f;
  return { sdf, low: () => brainGrid(fLo, 46, 168), farLow: () => brainGrid(fFar, 18, 56), farLow2: () => brainGrid(fFar, 8, 20), sk: {} };
}
// a polar grid ray-cast onto field f: ring 0 is the crown vertex
function brainGrid(f, rings, segs) {
  const pos = [], uv = [], idx = [];
  const hit = (th, ph) => {
    const d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    let lo = 0, hi = 1.0;
    // bisection on the ray from the origin outward: inside at lo, outside at hi
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(BR_O[0] + d[0] * m, BR_O[1] + d[1] * m, BR_O[2] + d[2] * m) < 0) lo = m; else hi = m; }
    const t = (lo + hi) / 2;
    return [BR_O[0] + d[0] * t, BR_O[1] + d[1] * t, BR_O[2] + d[2] * t];
  };
  const push = (th, ph) => { const p = hit(th, ph); pos.push(...p); const rho = th / BR_TH * 0.47; uv.push(0.5 + rho * Math.cos(ph), 0.5 + rho * Math.sin(ph)); };
  push(0, 0);
  for (let j = 1; j <= rings; j++) for (let i = 0; i < segs; i++) push(BR_TH * j / rings, i / segs * TAU);
  for (let i = 0; i < segs; i++) idx.push(0, 1 + (i + 1) % segs, 1 + i);
  for (let j = 1; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = 1 + (j - 1) * segs + i, b = 1 + (j - 1) * segs + (i + 1) % segs, c = a + segs, d = b + segs;
    idx.push(a, b, d, a, d, c);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), uv: new Float32Array(uv) };
}
const BC_PAINT = {
  kScale: 0.004, aoAlb: 0.8,
  mats: { [BC.CORAL]: { c: [0.74, 0.66, 0.50], ro: 0.6 } },
  layers: [
    { c: [0.62, 0.56, 0.40], a: 0.45, m: [['n', 6, 0.4, 0.8, 81]] },
    // the valleys: darker, warmer tissue; the collines paler and drier
    { c: [0.50, 0.42, 0.30], a: 0.6, m: [['fn', S => 1 - brainRidge(S.x, S.y, S.z)]] },
    { c: [0.86, 0.80, 0.66], a: 0.45, m: [['fn', S => sst(0.75, 1.0, brainRidge(S.x, S.y, S.z))]] },
    { c: [0.30, 0.24, 0.18], a: 0.45, m: [['cav', 0.15, 1.0]] },                 // septa gaps, crest grooves
    { c: [0.92, 0.88, 0.76], a: 0.4, m: [['cvx', 0.4, 1.4]] },                   // septa teeth catch light
    { c: [0.30, 0.28, 0.24], a: 0.6, ro: 0.95, m: [['ax', 1, -0.02, -0.1]] },    // silted skirt
    { c: [0.10, 0.08, 0.06], a: 0.8, m: [['ao', 0.4, 0.95]] }
  ]
};

// ============================================================================ TABLE CORAL
// Acropora hyacinthus (plants2 rebuild): a stalk flaring into a broad table whose plate is
// THICK at the heart and thins to a knife edge at a lobed, digitate growing rim; the top a
// dense pile of upright branchlets (bake), the UNDERSIDE what it really is — radiating
// horizontal branches, forking as they spread, with deep shadowed furrows between (geometry
// at near range, the corallite rows baked). Parametric surfaces, so the low is EXPLICIT:
// top disc, underside disc, rim strip, stalk — UV regions laid out here — and every LOD is
// the same surfaces at a lower resolution. Frame: flora.js tableGeo — stalk to y ~0.4, the
// dish r ~0.58, its top ~0.62.
const TB = { CORAL: 0, RIM: 1, STALK: 2 };
const TBU = { A: [0.25, 0.25, 0.235], B: [0.75, 0.25, 0.235], C: [0.02, 0.53, 0.96, 0.07], D: [0.02, 0.64, 0.96, 0.34] };
function tableShape(seed) {
  const R = mulberry(seed);
  const c = [0.03 + (R() - 0.5) * 0.04, 0.4, (R() - 0.5) * 0.04], Rr = 0.52 + R() * 0.08, ph1 = R() * TAU, ph2 = R() * TAU, s = seed;
  const rim = a => Rr * (1 + 0.1 * Math.sin(3 * a + ph1) + 0.07 * Math.sin(5 * a + ph2) + 0.05 * Math.sin(9 * a + ph1 * 2)) * (1 + 0.03 * Math.pow(Math.abs(Math.sin(a * 23 + ph2 + 0.6 * Math.sin(a * 7))), 0.6));
  const yMid = (q, a) => c[1] + 0.03 + 0.15 * Math.pow(q, 1.8) + 0.015 * Math.sin(a * 4 + ph2) * q;
  const th = q => 0.011 + 0.055 * Math.pow(1 - Math.min(1, q), 1.3);
  // the radiating branches under the plate: 22 near the heart, forking to 44 past mid-radius
  const ribs = (q, a) => {
    const w = 0.35 * Math.sin(q * 6 + a * 2 + ph1), f = sst(0.42, 0.6, q);
    const r1 = Math.pow(0.5 + 0.5 * Math.cos(a * 22 + w), 5), r2 = Math.pow(0.5 + 0.5 * Math.cos(a * 44 + 2 * w + 1.1), 5);
    return 0.022 * (1 - 0.55 * q) * sst(0.1, 0.25, q) * (r1 * (1 - f) + r2 * f);
  };
  const top = (q, a) => yMid(q, a) + th(q) / 2;
  const bot = (q, a, smooth) => yMid(q, a) - th(q) / 2 - (smooth ? 0.004 * sst(0.1, 0.25, q) : ribs(q, a));
  return { c, rim, yMid, th, ribs, top, bot, s };
}
function tableLow(T, rings, segsT, segsB, smooth, stalkSides) {
  const pos = [], uv = [], idx = [];
  const P = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); return pos.length / 3 - 1; };
  // a disc (top or bottom): polar grid, centre vertex, uv into region Rg
  const disc = (Rg, segs, yf, flip) => {
    const c0 = P(T.c[0], yf(0, 0), T.c[2], Rg[0], Rg[1]), b = c0 + 1;
    for (let j = 1; j <= rings; j++) { const q = j / rings; for (let i = 0; i < segs; i++) { const a = i / segs * TAU, r = q * T.rim(a); P(T.c[0] + Math.cos(a) * r, yf(q, a), T.c[2] + Math.sin(a) * r, Rg[0] + Rg[2] * q * Math.cos(a), Rg[1] + Rg[2] * q * Math.sin(a)); } }
    const tri = (x, y, z) => flip ? idx.push(x, z, y) : idx.push(x, y, z);
    for (let i = 0; i < segs; i++) tri(c0, b + (i + 1) % segs, b + i);
    for (let j = 1; j < rings; j++) for (let i = 0; i < segs; i++) { const p0 = b + (j - 1) * segs + i, p1 = b + (j - 1) * segs + (i + 1) % segs; tri(p0, p1, p1 + segs); tri(p0, p1 + segs, p0 + segs); }
  };
  disc(TBU.A, segsT, (q, a) => T.top(q, a), false);
  disc(TBU.B, segsB, (q, a) => T.bot(q, a, smooth), true);
  // the rim: top edge -> a rounded lip -> bottom edge (seam duplicated in u)
  const C = TBU.C, rb = pos.length / 3, rr = 3;
  for (let i = 0; i <= segsB; i++) {
    const a = i / segsB * TAU, R0 = T.rim(a), yt = T.top(1, a), yb = T.bot(1, a, smooth);
    for (let k = 0; k < rr; k++) { const t = k / (rr - 1), bulge = Math.sin(t * Math.PI) * 0.008; P(T.c[0] + Math.cos(a) * (R0 + bulge), yt + (yb - yt) * t, T.c[2] + Math.sin(a) * (R0 + bulge), C[0] + C[2] * i / segsB, C[1] + C[3] * t); }
  }
  for (let i = 0; i < segsB; i++) for (let k = 0; k < rr - 1; k++) { const a0 = rb + i * rr + k, a1 = a0 + rr; idx.push(a0, a1, a1 + 1, a0, a1 + 1, a0 + 1); }
  // the stalk: an encrusting foot narrowing into the stem, flaring into the plate
  const D = TBU.D, sb = pos.length / 3, nr = smooth ? 5 : 10, yTop = T.bot(0.12, 0, true) + 0.01;
  for (let j = 0; j <= nr; j++) {
    const t = j / nr, y = -0.03 + (yTop + 0.03) * t, r = 0.075 + 0.09 * Math.pow(Math.max(0, 1 - t / 0.16), 2) + 0.075 * Math.pow(t, 5);
    for (let i = 0; i <= stalkSides; i++) { const a = i / stalkSides * TAU, rw = r * (1 + 0.06 * Math.sin(a * 3 + t * 4 + T.s)); P(T.c[0] * t + Math.cos(a) * rw, y, T.c[2] * t + Math.sin(a) * rw, D[0] + D[2] * i / stalkSides, D[1] + D[3] * t); }
  }
  for (let j = 0; j < nr; j++) for (let i = 0; i < stalkSides; i++) { const a0 = sb + j * (stalkSides + 1) + i, a1 = a0 + stalkSides + 1; idx.push(a0, a1, a1 + 1, a0, a1 + 1, a0 + 1); }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), uv: new Float32Array(uv) };
}
function table(seed) {
  const T = tableShape(seed), s = seed;
  const plate = Fn([-0.85, 0.2, -0.85, 0.85, 0.85, 0.85], (x, y, z) => {
    const px = x - T.c[0], pz = z - T.c[2], r = Math.hypot(px, pz), a = Math.atan2(pz, px), R0 = T.rim(a), q = Math.min(1, r / R0);
    const d1 = Math.max(y - T.top(q, a), T.bot(q, a, false) - y) * 0.6;
    return Math.max(d1, (r - R0) * 0.85);
  }, TB.CORAL);
  const stalk = Fn([-0.35, -0.08, -0.35, 0.35, 0.6, 0.35], (x, y, z) => {
    const yTop = T.bot(0.12, 0, true) + 0.01, t = Math.min(1, Math.max(0, (y + 0.03) / (yTop + 0.03)));
    const r = 0.075 + 0.09 * Math.pow(Math.max(0, 1 - t / 0.16), 2) + 0.075 * Math.pow(t, 5);
    return Math.max((Math.hypot(x - T.c[0] * t, z - T.c[2] * t) - r) * 0.8, -0.03 - y, y - yTop - 0.02);
  }, TB.STALK);
  // the branchlet pile on top, corallite rows along the radiating branches underneath
  const pile = (x, y, z) => {
    const px = x - T.c[0], pz = z - T.c[2], r = Math.hypot(px, pz), a = Math.atan2(pz, px), q = Math.min(1, r / T.rim(a));
    if (y > T.yMid(q, a)) { const v = Math.abs(vn3(x * 70, z * 70, 0.5, s)); return 0.006 * (1 - Math.min(1, v * 3)) * (1 - 0.6 * sst(0.85, 1, q)); }
    return -0.003 * Math.pow(Math.abs(Math.sin(r * 160 + a * 3)), 6) * sst(0.15, 0.3, q);
  };
  const sdf = Disp([
    { type: 'fbm', amp: 0.004, f: 7, oct: 2, seed: s + 1 },
    { type: 'fn', bake: true, amp: 0.006, fn: pile },
    { type: 'barn', bake: true, amp: 0.0022, f: 110, dens: 0.7, seed: s + 2 },
    { type: 'grain', bake: true, amp: 0.0006, f: 300, seed: s + 3 }
  ], U(0.035, plate, stalk));
  return { sdf, low: () => tableLow(T, 22, 96, 176, false, 12), farLow: () => tableLow(T, 8, 40, 48, true, 8), farLow2: () => tableLow(T, 4, 16, 20, true, 5), sk: {} };
}
const TB_PAINT = {
  kScale: 0.002, aoAlb: 0.85,
  mats: { [TB.CORAL]: { c: [0.70, 0.64, 0.50], ro: 0.62 }, [TB.STALK]: { c: [0.48, 0.42, 0.34], ro: 0.8 } },
  layers: [
    { c: [0.60, 0.56, 0.40], a: 0.5, m: [['n', 9, 0.4, 0.8, 111]] },
    { c: [0.92, 0.88, 0.78], a: 0.65, m: [['fn', S => sst(0.48, 0.62, Math.hypot(S.x, S.z)) * sst(-0.2, 0.4, S.ny)]] },   // the bleached growing rim
    { c: [0.30, 0.25, 0.18], a: 0.6, m: [['cav', 0.2, 1.0]] },
    { c: [0.40, 0.34, 0.26], a: 0.55, m: [['nd', [0, -1, 0], 0.2, 0.8]] },          // the underside: shaded, filmed
    { c: [0.84, 0.78, 0.64], a: 0.35, m: [['nd', [0, -1, 0], 0.2, 0.8], ['cvx', 0.3, 1.2]] },   // the branch crests below catch the lamp
    { c: [0.10, 0.08, 0.07], a: 0.8, m: [['ao', 0.45, 0.95]] }
  ]
};

// ============================================================================ GLASS SPONGE
// Euplectella and its vase-shaped cousins: a basket of fused silica spicules — a square
// lattice crossed by diagonals, oblique external ridges spiralling up it, a sieve plate on
// top, a tuft of glassy root fibres. The LATTICE is the high; the LOW is a plain shell, and
// the bake's misses become the holes (alpha, set alpha: true; plantKit alpha-hashes them).
// Frame: gardens.js glassGeo — base y 0, top ~1, radius up to ~0.44.
const GS = { SIL: 0 };
function glass(seed, type) {
  const R = mulberry(seed);
  const top = 0.92 + R() * 0.08, vase = type === 'vase';
  const r0 = vase ? 0.2 + R() * 0.05 : 0.11 + R() * 0.03, flare = vase ? 1.6 + R() * 0.5 : 0.55 + R() * 0.3;
  const curve = (R() - 0.5) * 0.12;
  const cx = y => curve * y * y;
  const Rad = y => { const t = Math.max(0, Math.min(1, y / top)); return r0 * (0.45 + 0.55 * sst(0, 0.18, t)) * (1 + flare * t * t) * (1 - 0.06 * sst(0.9, 1, t)); };
  const NV = vase ? 16 : 14, sh = vase ? 0.1 : 0.07, ws = 0.0042;
  const lat = (x, y, z) => {
    const px = x - cx(y), rad = Math.hypot(px, z), a = Math.atan2(z, px), Ry = Rad(y);
    const dShell = Math.abs(rad - Ry) - 0.0035;
    const arc = TAU * Ry / NV;
    const u = a / TAU * NV, v = y / sh;
    const dV = Math.abs(u - Math.round(u)) * arc, dH = Math.abs(v - Math.round(v)) * sh;
    const dg = (u * arc / sh + v), dD1 = Math.abs(dg / 2 - Math.round(dg / 2)) * sh * 1.2, dg2 = (u * arc / sh - v), dD2 = Math.abs(dg2 / 2 - Math.round(dg2 / 2)) * sh * 1.2;
    let d = Math.min(dV - ws, dH - ws, dD1 - ws * 0.6, vase ? 1 : dD2 - ws * 0.6);
    // oblique external ridges (a raised spiral every few cells)
    const sp = (u * arc * 0.8 + y * 0.6) / (sh * 3.2), dS = Math.abs(sp - Math.round(sp)) * sh * 3.2;
    const ridge = Math.max(Math.abs(rad - Ry - 0.006) - 0.006, dS - ws * 1.3);
    return Math.min(Math.max(dShell, d), ridge);
  };
  const shellLat = (x, y, z) => Math.max(lat(x, y, z), -y, y - top);
  // the sieve plate across the top
  const Rt = Rad(top);
  const plate = (x, y, z) => {
    const px = x - cx(top);
    const dP = Math.abs(y - top) - 0.003, r = Math.hypot(px, z) - Rt;
    const gu = px / (sh * 0.8), gv = z / (sh * 0.8), dG = Math.min(Math.abs(gu - Math.round(gu)), Math.abs(gv - Math.round(gv))) * sh * 0.8 - ws;
    return Math.max(dP, r, dG);
  };
  const B = [-0.7, -0.2, -0.7, 0.7, top + 0.05, 0.7];
  const hiParts = [Fn(B, shellLat, GS.SIL), Fn(B, plate, GS.SIL)];
  // root tuft: glassy fibres splaying down into the sediment
  for (let k = 0; k < 10; k++) { const a = R() * TAU, l = 0.08 + R() * 0.1; hiParts.push(Cap([Math.cos(a) * r0 * 0.3, 0.03, Math.sin(a) * r0 * 0.3], [Math.cos(a) * (r0 * 0.4 + l), -0.06, Math.sin(a) * (r0 * 0.4 + l)], 0.003, 0.0018, GS.SIL)); }
  const hi = Disp([{ type: 'grain', bake: true, amp: 0.0005, f: 400, seed: seed + 1 }], U(0.002, ...hiParts));
  // the low: a closed shell around the lattice, wall 0.012 either side of the lattice surface
  const lo = Fn(B, (x, y, z) => {
    const px = x - cx(y), Ry = Rad(Math.min(top, Math.max(0, y)));
    return Math.max(Math.abs(Math.hypot(px, z) - Ry) - 0.011, -y - 0.01, y - top - 0.004);
  }, GS.SIL);
  const loTop = Fn(B, (x, y, z) => Math.max(Math.abs(y - top) - 0.011, Math.hypot(x - cx(top), z) - Rt - 0.004), GS.SIL);
  return { sdf: hi, loSdf: U(0.006, lo, loTop), emit: () => 1, sk: { top: +top.toFixed(3) } };
}
const GS_PAINT = {
  kScale: 0.001, aoAlb: 0.5,
  mats: { [GS.SIL]: { c: [0.84, 0.83, 0.78], ro: 0.35 } },
  layers: [
    { c: [0.66, 0.66, 0.60], a: 0.5, m: [['n', 8, 0.45, 0.8, 91]] },
    { c: [0.92, 0.94, 0.92], a: 0.5, m: [['cvx', 0.5, 2]] },
    { c: [0.46, 0.44, 0.38], a: 0.5, ro: 0.8, m: [['ax', 1, 0.12, 0.0]] }     // silt on the root end
  ]
};

// ============================================================================ SEA FAN
// Gorgonia: a flat fan grown in one plane across the current — a short trunk, dichotomous
// main branches thickening into a fine anastomosing NET; polyps stud every strand. Like the
// glass sponge, the net is the high and the low a flat card (alpha holes from the bake).
// Frame: gardens.js / flora.js fanGeo — the XY plane, base y 0, ~1.1 tall, ~0.45 half-width.
const GF = { BR: 0, NET: 1 };
function seaFan(seed, type) {
  const R = mulberry(seed);
  const H = 1.0 + R() * 0.1, W = type === 'tall' ? 0.3 + R() * 0.05 : 0.44 + R() * 0.05, s = seed;
  const lobes = [];
  const nl = type === 'lobed' ? 3 : 1;
  for (let k = 0; k < nl; k++) {
    const cx = nl === 1 ? 0 : (k - 1) * W * 0.55, cy = H * (nl === 1 ? 0.6 : 0.55 + 0.1 * (k === 1)), ax = nl === 1 ? W : W * 0.55, ay = H * (nl === 1 ? 0.42 : 0.42);
    lobes.push([cx + (R() - 0.5) * 0.04, cy, ax, ay]);
  }
  // outline: union of ellipses + a short stalk; ~signed distance in the plane
  const out2 = (x, y) => {
    let d = 1e9;
    for (const [cx, cy, ax, ay] of lobes) {
      const e = Math.hypot((x - cx) / ax, (y - cy) / ay);
      const wob = 0.035 * Math.sin(Math.atan2(y - cy, x - cx) * 7 + s);
      d = Math.min(d, (e - 1 - wob) * Math.min(ax, ay));
    }
    const st = Math.max(Math.abs(x) - 0.03, y - H * 0.3, -y - 0.02);
    return Math.min(d, st);
  };
  // branches: dichotomous growth in the plane
  const caps = [];
  const grow = (x, y, ang, len, r, d) => {
    const ex = x - Math.sin(ang) * len, ey = y + Math.cos(ang) * len;
    if (out2(ex, ey) > 0.02) { len *= 0.6; }
    const mx = (x + ex) / 2 + (R() - 0.5) * len * 0.12, my = (y + ey) / 2;
    caps.push(Tube([[x, y, 0], [mx, my, 0], [x - Math.sin(ang) * len, y + Math.cos(ang) * len, 0]], r, r * 0.8, 3, GF.BR));
    if (d >= 4) return;
    const n = d === 0 ? 3 : 2;
    for (let i = 0; i < n; i++) grow(x - Math.sin(ang) * len, y + Math.cos(ang) * len, ang + (i - (n - 1) / 2) * (0.42 + R() * 0.3), len * (0.62 + R() * 0.15), r * 0.78, d + 1);
  };
  grow(0, -0.03, (R() - 0.5) * 0.1, 0.26, 0.012, 0);
  const cell = type === 'tall' ? 0.04 : 0.05;
  const net = Fn([-0.6, -0.05, -0.02, 0.6, H + 0.05, 0.02], (x, y, z) => {
    const o = out2(x, y);
    const e = cellEdge2(x / cell + 0.13 * vn3(x * 9, y * 9, 0, s), y / (cell * 1.25), s) * cell;   // strands run a little along the fan's height
    return Math.max(Math.hypot(Math.max(0, e - 0.0008), z) - 0.0014, o + 0.006);
  }, GF.NET);
  const hi = Disp([
    { type: 'barn', bake: true, amp: 0.0012, f: 260, dens: 0.6, seed: s + 1 },   // polyp bumps
    { type: 'grain', bake: true, amp: 0.0004, f: 500, seed: s + 2 }
  ], U(0.004, I(0.002, U(0, ...caps), Fn([-0.7, -0.1, -0.1, 0.7, H + 0.1, 0.1], (x, y, z) => out2(x, y) - 0.004)), net));
  const lo = Fn([-0.7, -0.08, -0.03, 0.7, H + 0.08, 0.03], (x, y, z) => Math.max(Math.abs(z) - 0.0075, out2(x, y) - 0.003), GF.BR);
  return { sdf: hi, loSdf: lo, emit: () => 1, sk: { H: +H.toFixed(3) } };
}
const GF_PAINT = {
  kScale: 0.0008, aoAlb: 0.4,
  mats: { [GF.BR]: { c: [0.66, 0.50, 0.46], ro: 0.6 }, [GF.NET]: { c: [0.74, 0.60, 0.54], ro: 0.6 } },
  layers: [
    { c: [0.56, 0.42, 0.40], a: 0.5, m: [['n', 10, 0.45, 0.8, 101]] },
    { c: [0.90, 0.82, 0.74], a: 0.45, m: [['cvx', 0.5, 2.0]] },                   // polyp crowns
    { c: [0.48, 0.38, 0.34], a: 0.5, m: [['ax', 1, 0.25, 0.0]] }
  ]
};

// ============================================================================ CRINOID
// A stalked sea lily: a jointed column (columnals, with whorls of cirri at the nodes), a
// small calyx and ten feathered arms opening like a tulip. The pinnule comb along each arm
// is an alpha vane (the arm's own low is a flattened ribbon; the high carries the pinnules).
// Frame: gardens.js crinoidGeo — base y 0, crown to ~1.06, ~0.2 wide.
const CR = { STALK: 0, ARM: 1, PIN: 2, CALYX: 3 };
function crinoid(seed) {
  const R = mulberry(seed);
  const H = 0.62 + R() * 0.22, sw = (R() - 0.5) * 0.18;
  const st = [[0, -0.02, 0], [sw * 0.4, H * 0.4, sw * 0.2], [sw, H * 0.75, sw * 0.4], [sw * 1.2, H, sw * 0.3]];
  const top = st[3];
  const parts = [Tube(st, 0.012, 0.009, 14, CR.STALK)];
  // columnal joints: little ridged rings every ~0.02
  for (let t = 0.04; t < 0.98; t += 0.024) { const p = bez(st, t), p2 = bez(st, t + 0.01); parts.push({ t: 'xf', p, R: frameUp([p2[0] - p[0], p2[1] - p[1], p2[2] - p[2]]), ch: [Tor([0, 0, 0], 0.0105, 0.0022, CR.STALK)] }); }
  // cirri whorls
  for (let w = 1; w <= 4; w++) {
    const t = w * 0.19, p = bez(st, t);
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * TAU + w, d = [Math.cos(a), -0.4, Math.sin(a)];
      parts.push(Tube([p, add(p, d, 0.035), add(add(p, d, 0.06), [0, -0.035, 0])], 0.0042, 0.0028, 4, CR.STALK));
    }
  }
  parts.push(E(add(top, [0, 0.02, 0]), [0.03, 0.03, 0.03], CR.CALYX));
  const arms = [], vanes = [], pins = [], sk = [];
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * TAU + (R() - 0.5) * 0.2, len = 0.26 + R() * 0.12, open = 0.55 + R() * 0.35;
    const out = [Math.cos(a), 0, Math.sin(a)], side = [-Math.sin(a), 0, Math.cos(a)];
    const b = add(add(top, [0, 0.03, 0]), out, 0.022);
    const pts = [b];
    let p = b.slice();
    for (let i = 1; i <= 3; i++) {
      const t = i / 3, el = 1.25 - open * t * 1.6;              // rise, open, the tips curl out and down
      p = add(p, [out[0] * Math.cos(el), Math.sin(el), out[2] * Math.cos(el)], len / 3);
      pts.push(p);
    }
    arms.push(Tube(pts, 0.0075, 0.003, 10, CR.ARM));
    // pinnules: alternate either side, perpendicular to the arm, in the plane of the vane
    for (let i = 2; i < 22; i++) {
      const t = i / 22, c = bez(pts, t), c2 = bez(pts, Math.min(1, t + 0.02)), tg = norm([c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]]);
      const sd = i % 2 ? 1 : -1, pl = 0.045 * (1 - 0.55 * t);
      const dir = norm(add(side.map(v => v * sd), tg, 0.45));
      pins.push(Cap(c, add(c, dir, pl), 0.0022, 0.0011, CR.PIN));
    }
    // the vane (low only): a thin ribbon along the arm, as wide as the pinnules reach
    for (let i = 0; i < 8; i++) {
      const t0 = i / 8, t1 = (i + 1) / 8, c0 = bez(pts, t0), c1 = bez(pts, t1), m = lerp3(c0, c1, 0.5);
      const tg = norm([c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]]), w = 0.046 * (1 - 0.5 * (t0 + t1) / 2);
      const nrm = norm([tg[1] * side[2] - tg[2] * side[1], tg[2] * side[0] - tg[0] * side[2], tg[0] * side[1] - tg[1] * side[0]]);
      // rows of R: columns are local x (side), y (tangent), z (normal)
      const Rm = [side[0], tg[0], nrm[0], side[1], tg[1], nrm[1], side[2], tg[2], nrm[2]];
      vanes.push({ t: 'box', c: m, h: [w, Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]) / 2 + 0.004, 0.006], r: 0.002, R: Rm, m: CR.ARM });
    }
    sk.push({ b: r3(b), tip: r3(p), len: +len.toFixed(3) });
  }
  const hi = Disp([{ type: 'grain', bake: true, amp: 0.0005, f: 400, seed: seed + 1 }], U(0.003, ...parts, ...arms, U(0.0015, ...pins)));
  const lo = U(0.003, ...parts.slice(0, 1), ...parts.slice(-1), ...arms, ...vanes, ...parts.filter(q => q.t === 'tube'));
  return { sdf: hi, loSdf: lo, emit: () => 1, sk: { top: r3(top), arms: sk } };
}
const CR_PAINT = {
  kScale: 0.0008, aoAlb: 0.5,
  mats: { [CR.STALK]: { c: [0.58, 0.48, 0.36], ro: 0.6 }, [CR.ARM]: { c: [0.76, 0.60, 0.38], ro: 0.5 }, [CR.PIN]: { c: [0.86, 0.72, 0.48], ro: 0.45 }, [CR.CALYX]: { c: [0.62, 0.46, 0.34], ro: 0.5 } },
  layers: [
    { c: [0.44, 0.34, 0.26], a: 0.6, m: [['cav', 0.2, 1.0]] },
    { c: [0.94, 0.86, 0.66], a: 0.4, m: [['cvx', 0.5, 2.0]] }
  ]
};

// ============================================================================ SEA PEN
// Pennatulids (plants2): a fleshy rachis rising from a buried bulb (peduncle), leaf-like
// pinnae stacked up it like the plates of a quill, each curving up and carrying a row of
// white autozooid polyps on its outer margin; the third form is Umbellula, the abyssal pen —
// a long bare stalk with a nodding crown of a few large polyps. The polyps are the ones that
// GLOW (real pennatulids flash blue-green when touched, the wave running down the colony):
// the polyp material is painted into the emit channel (ORM.B, set ormB 'emit').
// Frame: gardens.js seaPenGeo — base y 0 (bulb below), tip ~1.05, pinnae out to ~0.25.
const PN = { RACH: 0, PIN: 1, POLYP: 2, BULB: 3 };
function seaPen(seed, type) {
  const R = mulberry(seed), parts = [], polyps = [], pins = [];
  const sk = { type, pins: [] };
  if (type === 'umb') {
    const lean = (R() - 0.5) * 0.12, top = [lean, 1.0, 0.02];
    parts.push(E([0, -0.04, 0], [0.03, 0.08, 0.03], PN.BULB));
    parts.push(Tube([[0, -0.06, 0], [lean * 0.2, 0.35, 0], [lean * 0.7, 0.75, 0.01], top], 0.011, 0.006, 16, PN.RACH));
    const np = 6 + Math.floor(R() * 4), nod = R() * TAU;
    for (let k = 0; k < np; k++) {
      const a = nod + (k / np - 0.5) * 2.0, d = norm([Math.cos(a), -0.35 - 0.3 * R(), Math.sin(a)]), L = 0.12 + 0.05 * R();
      const b = add(top, d, L);
      parts.push(Cap(top, b, 0.01, 0.028, PN.PIN));
      // eight pinnate tentacles round the polyp's mouth
      const t0 = norm(add(d, [0, 0.4, 0]));
      for (let q = 0; q < 8; q++) {
        const qa = q / 8 * TAU, X = norm([d[2], 0, -d[0]]), Y = norm([d[1] * X[2] - d[2] * X[1], d[2] * X[0] - d[0] * X[2], d[0] * X[1] - d[1] * X[0]]);
        const o = add(add(t0, X, Math.cos(qa) * 0.9), Y, Math.sin(qa) * 0.9);
        polyps.push(Tube([b, add(b, o, 0.04), add(add(b, o, 0.065), d, 0.02)], 0.005, 0.0022, 3, PN.POLYP));
      }
      sk.pins.push({ c: r3(b), L: 0.12 });
    }
  } else {
    const slender = type === 'slim', np = slender ? 18 : 13, y0 = slender ? 0.32 : 0.28, y1 = 0.95;
    parts.push(E([0, -0.03, 0], [0.04, 0.1, 0.04], PN.BULB));
    const cv = (R() - 0.5) * 0.05;
    const rach = y => [cv * y * y, y, 0];
    parts.push(Tube([[0, -0.08, 0], rach(0.35), rach(0.7), rach(1.04)], slender ? 0.018 : 0.026, 0.007, 18, PN.RACH));
    for (let i = 0; i < np; i++) {
      const t = i / (np - 1), y = y0 + (y1 - y0) * t;
      const L = (slender ? 0.17 : 0.24) * Math.sin(Math.PI * (0.18 + 0.8 * t)) + 0.04;
      for (const sd of [-1, 1]) {
        const a = 0.42 + 0.35 * t + (R() - 0.5) * 0.12, dir = [sd * Math.cos(a), Math.sin(a), 0];
        const W = (slender ? 0.045 : 0.065) * (0.75 + 0.25 * Math.sin(Math.PI * t)), th = slender ? 0.007 : 0.011;
        const n = [-Math.sin(a), sd * Math.cos(a), 0];   // the leaf's thickness axis
        const c = add(rach(y), dir, L * 0.5);
        // rows of R: columns are local x (dir), y (thickness), z (across)
        const Rm = [dir[0], n[0], 0, dir[1], n[1], 0, dir[2], n[2], 1];
        pins.push({ t: 'ellip', c, r: [L * 0.55, th, W * 0.5], R: Rm, m: PN.PIN });
        // the polyp row on the outer margin
        const nq = 6 + Math.round(L * 30);
        for (let q = 0; q < nq; q++) {
          const tt = -1.25 + 2.5 * q / (nq - 1), pp = add(add(c, dir, Math.cos(tt) * L * 0.52), [0, 0, 1], Math.sin(tt) * W * 0.47);
          polyps.push(Sph(add(pp, n, th * 0.6), 0.0055 + 0.002 * R(), PN.POLYP));
        }
        sk.pins.push({ y: +y.toFixed(3), L: +L.toFixed(3), sd });
      }
    }
  }
  const L = [
    { type: 'fbm', amp: 0.0025, f: 14, oct: 2, seed: seed + 1 },
    { type: 'barn', bake: true, amp: 0.002, f: 120, dens: 0.55, seed: seed + 2, mask: [['ax', 1, 0.05, 0.2]] },   // siphonozooid warts
    { type: 'grain', bake: true, amp: 0.0006, f: 320, seed: seed + 3 }
  ];
  const body = pins.length ? U(0.012, ...parts, U(0.006, ...pins)) : U(0.012, ...parts);
  return { sdf: Disp(L, U(0.003, body, U(0, ...polyps))), loSdf: Disp(L, body), sk,
    emit: S => (S.ma === PN.POLYP ? 1 - S.mw : 0) + (S.mb === PN.POLYP ? S.mw : 0) };
}
const PN_PAINT = {
  kScale: 0.0012, aoAlb: 0.6,
  mats: { [PN.RACH]: { c: [0.78, 0.52, 0.36], ro: 0.45 }, [PN.PIN]: { c: [0.82, 0.50, 0.32], ro: 0.4 }, [PN.POLYP]: { c: [0.95, 0.90, 0.82], ro: 0.3 }, [PN.BULB]: { c: [0.60, 0.40, 0.30], ro: 0.6 } },
  layers: [
    { c: [0.70, 0.36, 0.22], a: 0.5, m: [['n', 10, 0.45, 0.8, 131]] },
    { c: [0.92, 0.74, 0.56], a: 0.5, m: [['mat', PN.PIN], ['cvx', 0.3, 1.4]] },               // pinna rims paler
    { c: [0.50, 0.26, 0.18], a: 0.5, m: [['cav', 0.2, 1.0]] },
    { c: [0.38, 0.30, 0.26], a: 0.6, ro: 0.9, m: [['ax', 1, 0.08, -0.02]] },                  // the buried end silted
    { c: [0.12, 0.06, 0.05], a: 0.7, m: [['ao', 0.45, 0.95]] }
  ]
};

// ============================================================================ WHIP CORAL
// Deep sea whips (plants2): Ellisella / Junceella rods tapering from a holdfast disc, polyps
// all along them (bake), and two other silhouettes — a forked whip and Cirrhipathes, the
// corkscrew wire coral. Authored at TRUE height `Href` (not a unit mesh): plantKit's remap
// picks the variant nearest the instance's own aspect (H / S) and draws it (S, H / Href, S),
// so the polyps are never stretched five-fold.
const WP = { ROD: 0, FOOT: 1 };
function whipCoral(seed, type, Href) {
  const R = mulberry(seed), rods = [];
  const r0 = 0.016, r1 = 0.0045;
  const path = (n, f) => { const P = []; for (let i = 0; i <= n; i++) P.push(f(i / n)); return P; };
  const swA = R() * TAU, swB = R() * TAU;
  const main = t => {
    if (type === 'spiral') { const a = t * TAU * Href * 0.9 + swA, rr = 0.07 * sst(0.05, 0.25, t); return [Math.cos(a) * rr, t * Href, Math.sin(a) * rr]; }
    const sw = Math.sin(t * 3.0 + swA) * 0.05 * t * Href / 4, sw2 = Math.sin(t * 5.3 + swB) * 0.03 * t * Href / 4;
    return [sw, t * Href * (1 - 0.04 * t * t), sw2];
  };
  const seg = (P, ra, rb, n) => { for (let i = 0; i < P.length - 1; i++) { const t0 = i / (P.length - 1), t1 = (i + 1) / (P.length - 1); rods.push(Cap(P[i], P[i + 1], ra + (rb - ra) * t0, ra + (rb - ra) * t1, WP.ROD)); } };
  const nP = type === 'spiral' ? Math.round(Href * 14) : Math.round(Href * 6);
  const MP = path(nP, main);
  seg(MP, r0, r1);
  if (type === 'fork') {
    const tb = 0.3 + 0.15 * R(), b0 = main(tb), dA = R() * TAU;
    const BP = path(Math.round(Href * 4), t => { const q = main(tb + (1 - tb) * t * 0.85); return [q[0] + Math.cos(dA) * 0.12 * Math.sqrt(t) * Href / 4, b0[1] + (q[1] - b0[1]) * 0.92, q[2] + Math.sin(dA) * 0.12 * Math.sqrt(t) * Href / 4]; });
    seg(BP, r0 * 0.75, r1);
  }
  const foot = E([0, -0.005, 0], [0.05, 0.015, 0.05], WP.FOOT);
  const L = [
    { type: 'barn', bake: true, amp: 0.0022, f: 95, dens: 0.75, seed: seed + 1 },      // polyp calyces
    { type: 'grain', bake: true, amp: 0.0005, f: 300, seed: seed + 2 },
    { type: 'fbm', amp: 0.0015, f: 20, oct: 2, seed: seed + 3 }
  ];
  const body = U(0.01, foot, U(0, ...rods));
  return { sdf: Disp(L, body), loSdf: Disp(L.slice(2), body), sk: { Href }, emit: S => sst(0.4, 1.4, S.k) * (1 - sst(0.2, 0.6, 1 - S.ao)) };
}
const WP_PAINT = {
  kScale: 0.0015, aoAlb: 0.6,
  mats: { [WP.ROD]: { c: [0.80, 0.52, 0.34], ro: 0.55 }, [WP.FOOT]: { c: [0.42, 0.34, 0.28], ro: 0.8 } },
  layers: [
    { c: [0.86, 0.80, 0.68], a: 0.55, m: [['n', 3, 0.5, 0.75, 141]] },                       // some colonies pale (Junceella)
    { c: [0.94, 0.88, 0.76], a: 0.6, m: [['cvx', 0.4, 1.6]] },                               // polyp crowns
    { c: [0.40, 0.20, 0.14], a: 0.5, m: [['cav', 0.2, 1.0]] },
    { c: [0.08, 0.05, 0.04], a: 0.6, m: [['ao', 0.5, 0.95]] }
  ]
};

// ============================================================================ BACTERIAL MAT
// Beggiatoa / sulphur mats round the vents (plants2): a thin felted sheet draped on the crust,
// lobed and ragged at its edge, torn through in places so the sediment shows, cottony
// filament tufts (bake), zoned white at the heart through sulphur-yellow to an oxidised rust
// rim. An ALPHA card set: the low is a plain shallow dome, the coverage is baked.
// Frame: gardens.js matGeo — a disc of radius 0.5 at y ~0.03.
const MT = { MAT: 0 };
function bactMat(seed) {
  const R = mulberry(seed), s = seed, ph = [R() * TAU, R() * TAU, R() * TAU];
  const rim = a => 0.5 * (1 + 0.1 * Math.sin(5 * a + ph[0]) + 0.07 * Math.sin(9 * a + ph[1]) + 0.05 * Math.sin(14 * a + ph[2]));
  const surf = (x, z) => 0.016 - 0.45 * (x * x + z * z) + 0.006 * fbm3n(x * 9, 0, z * 9, s, 3) + 0.005 * Math.max(0, fbm3n(x * 4, 1, z * 4, s + 2, 2));   // draped: the rim sinks into the crust
  const hi = Fn([-0.66, -0.22, -0.66, 0.66, 0.07, 0.66], (x, y, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x), R0 = rim(a) * (1 + 0.08 * fbm3n(x * 12, 2, z * 12, s + 4, 2));
    const th = 0.005 * (1 - sst(0.7, 1.0, r / R0)) + 0.0025;
    let d = Math.max(Math.abs(y - surf(x, z)) - th, (r - R0) * 0.8);
    // tears through the felt: sediment shows (more toward the rim)
    const [f1, id] = cell2(x * 9 + 0.6 * fbm3n(x * 20, 3, z * 20, s + 6, 2), z * 9, s + 7);
    if (id < 0.08 + 0.18 * sst(0.6, 1, r / R0)) d = Math.max(d, (0.2 - f1) / 9);
    return d;
  }, MT.MAT);
  const sdf = Disp([
    { type: 'fbm', bake: true, amp: 0.002, f: 60, oct: 3, seed: s + 9 },                     // felted filaments
    { type: 'barn', bake: true, amp: 0.0018, f: 90, dens: 0.4, seed: s + 10 },               // cottony tufts
    { type: 'grain', bake: true, amp: 0.0006, f: 400, seed: s + 11 }
  ], hi);
  const lo = Fn([-0.7, -0.22, -0.7, 0.7, 0.08, 0.7], (x, y, z) => Math.max(Math.abs(y - 0.018 + 0.45 * (x * x + z * z)) - 0.011, Math.hypot(x, z) - 0.62), MT.MAT);
  return { sdf, loSdf: lo, emit: () => 1, sk: {} };
}
function cell2(x, y, s) {
  const X = Math.floor(x), Y = Math.floor(y); let f1 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = X + i, cy = Y + j, px = cx + h2(cx, cy, s), py = cy + h2(cx, cy, s + 7), d = Math.hypot(px - x, py - y);
    if (d < f1) { f1 = d; id = h2(cx, cy, s + 19); }
  }
  return [f1, id];
}
const matR = S => Math.hypot(S.x, S.z) / 0.5;
const MT_PAINT = {
  kScale: 0.0008, aoAlb: 0.5,
  mats: { [MT.MAT]: { c: [0.92, 0.91, 0.86], ro: 0.9 } },
  layers: [
    { c: [0.88, 0.80, 0.46], a: 0.7, m: [['fn', S => sst(0.5, 0.85, matR(S) + 0.25 * fbm3n(S.x * 7, 0, S.z * 7, 151, 2))]] },   // sulphur
    { c: [0.62, 0.38, 0.20], a: 0.8, m: [['fn', S => sst(0.82, 1.05, matR(S) + 0.2 * fbm3n(S.x * 9, 1, S.z * 9, 153, 2))]] },      // oxidised rim
    { c: [0.55, 0.55, 0.52], a: 0.5, m: [['n', 7, 0.6, 0.78, 155]] },                                                               // grey patches
    { c: [0.98, 0.97, 0.94], a: 0.5, m: [['cvx', 0.3, 1.5]] },                                                                      // tuft crowns
    { c: [0.30, 0.22, 0.16], a: 0.5, m: [['cav', 0.2, 1.0]] }
  ]
};

// ============================================================================ SWAY
// The per-vertex data the shared sway shader reads (gardens.js / flora.js aVA, aFlut):
// returns [flex, h, mask, phase, flut] for a vertex of `species` variant `sk`. Pure.
const hashPh = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return (s - Math.floor(s)) * TAU; };
export const SWAY = {
  tube(x, y, z, h, sk) { return [h * h, h, 0, 0, 0]; },
  anem(x, y, z, h, sk) {
    const D = sk.disc;
    if (y < D - 0.01 || Math.hypot(x, z) < sk.colR * 0.45) return [0, h, 0, 0, 0];
    if (!sk.tents.length) { const u = Math.min(1, Math.hypot(x, z) / (sk.dR || 0.4)); return [u * u * 0.35, h, 0, hashPh(Math.round(Math.atan2(z, x) * 3), 7), 0.01 * u]; }
    // nearest tentacle root: the tentacle's own length normalises the flex
    let best = 1e9, bt = null;
    for (const t of sk.tents) { const d = (x - t.b[0]) ** 2 + (y - t.b[1]) ** 2 + (z - t.b[2]) ** 2; if (d < best) { best = d; bt = t; } }
    const u = Math.min(1, Math.sqrt(best) / (bt.len * 1.05));
    return [u * u, h, sst(0.6, 1, u), hashPh(bt.b[0], bt.b[2]), 0.04 * u * u];
  },
  barrel(x, y, z, h) { return [h * h * 0.25, h, 0, 0, 0]; },
  // a plume vertex carries mask 1, its own tube's phase, and its MOUTH (aBU) to retract into
  worm(x, y, z, h, sk) {
    for (const t of sk.tubes) {
      const px = x - t.m[0], py = y - t.m[1], pz = z - t.m[2], al = px * t.up[0] + py * t.up[1] + pz * t.up[2];
      if (al < -0.004 || al > t.L * 1.25) continue;
      const rx = px - t.up[0] * al, ry = py - t.up[1] * al, rz = pz - t.up[2] * al;
      if (rx * rx + ry * ry + rz * rz > (t.r * 2.3) ** 2) continue;
      return [h * h * 0.4, h, 1, hashPh(t.m[0], t.m[2]), 0.006, t.m[0], t.m[2]];
    }
    return [h * h * 0.15, h, 0, 0, 0];
  },
  stag(x, y, z, h) { return [h * h * 0.5, h, 0, 0, 0]; },
  brain(x, y, z, h) { return [0, h, 0, 0, 0]; },
  table(x, y, z, h) { return [0, h, 0, 0, 0]; },
  glass(x, y, z, h) { return [h * h * 0.05, h, 0, 0, 0]; },
  fan(x, y, z, h) { return [h * h, h, 0, 0, 0]; },
  pen(x, y, z, h, sk) {
    if (sk.type === 'umb') { const u = sst(0.85, 1.05, y); return [Math.pow(h, 1.4) * 0.8 + u * 0.2, h, u, 0, 0.012 * u]; }
    const u = Math.min(1, Math.abs(x) / 0.25);
    return [Math.pow(h, 1.4) * 0.8 + u * 0.15, h, u, hashPh(Math.round(y * 40), x > 0 ? 1 : 2), 0.012 * u];
  },
  whip(x, y, z, h) { return [Math.pow(h, 1.4), h, 0, 0, 0]; },
  mat() { return [0, 0, 0, 0, 0]; },
  crin(x, y, z, h, sk) {
    const T = sk.top, d = Math.hypot(x - T[0], y - T[1] - 0.02, z - T[2]);
    if (y < T[1] + 0.01) return [h * h * 0.2, h, 0, 0, 0];
    let len = 0.3; for (const a of sk.arms) len = Math.max(len, a.len);
    const u = Math.min(1, d / len);
    return [0.2 + Math.pow(u, 1.4) * 0.8, h, sst(0.7, 1, u), hashPh(Math.round(Math.atan2(z - T[2], x - T[0]) * 1.59), 3), 0.025 * u];
  }
};

// ============================================================================ SPECIES
// name -> { variants: [ { seed, ...opts } ], build(seed, opts), paint, set size, h / budgets }
export const SPECIES = {
  tube: {
    variants: [{ seed: 101 }, { seed: 202 }, { seed: 303 }, { seed: 404 }],
    build: v => tubeSponge(v.seed), paint: TS_PAINT,
    set: { size: 1024 }, hi: 0.0028, lo: 0.006, tris: 2400, err: 0.008, far: 600, kEps: 0.006, ao: { r: 0.03, n: 4 }, cage: 0.012, ray: 0.03
  },
  anem: {
    variants: [{ seed: 11, type: 'std' }, { seed: 22, type: 'long' }, { seed: 33, type: 'bubble' }, { seed: 44, type: 'dense' }, { seed: 55, type: 'plume' }, { seed: 66, type: 'carpet' }],
    build: v => anemone(v.seed, v.type), paint: AN_PAINT,
    set: { size: 1024 }, hi: 0.0018, lo: 0.0038, tris: 4200, err: 0.009, far: 1000, kEps: 0.004, ao: { r: 0.025, n: 4 }, cage: 0.008, ray: 0.024
  },
  barrel: {
    variants: [{ seed: 501, type: 'classic' }, { seed: 502, type: 'squat' }, { seed: 503, type: 'tall' }, { seed: 504, type: 'split' }, { seed: 505, type: 'lean' }],
    build: v => barrel(v.seed, v.type), paint: BR_PAINT,
    set: { size: 1024, aoDist: 0.12 }, hi: 0.005, lo: 0.012, tris: 3200, err: 0.014, far: 800, kEps: 0.012, ao: { r: 0.08, n: 4 }, cage: 0.03, ray: 0.08
  },
  worm: {
    variants: [{ seed: 601 }, { seed: 602 }, { seed: 603 }],
    build: v => worms(v.seed), paint: TW_PAINT,
    set: { size: 1024 }, hi: 0.002, lo: 0.0045, tris: 4200, err: 0.012, far: 1100, kEps: 0.004, ao: { r: 0.03, n: 4 }, cage: 0.01, ray: 0.03
  },
  stag: {
    variants: [{ seed: 701 }, { seed: 702 }, { seed: 703 }, { seed: 704 }],
    build: v => staghorn(v.seed), paint: SG_PAINT,
    set: { size: 1024 }, hi: 0.0018, lo: 0.005, tris: 3000, err: 0.006, far: 800, kEps: 0.004, ao: { r: 0.03, n: 4 }, cage: 0.008, ray: 0.024
  },
  brain: {
    variants: [{ seed: 801 }, { seed: 802 }, { seed: 803 }],
    build: v => brain(v.seed), paint: BC_PAINT,
    set: { size: 1024, aoDist: 0.05, uvFixed: true }, hi: 0.0025, lo: 0.012, tris: 1800, err: 0.012, far: 500, kEps: 0.005, ao: { r: 0.03, n: 4 }, cage: 0.025, ray: 0.06
  },
  table: {
    variants: [{ seed: 1201 }, { seed: 1202 }, { seed: 1203 }],
    build: v => table(v.seed), paint: TB_PAINT,
    set: { size: 1024, aoDist: 0.08, uvFixed: true }, hi: 0.0028, lo: 0.009, tris: 1600, err: 0.01, far: 450, kEps: 0.006, ao: { r: 0.04, n: 4 }, cage: 0.02, ray: 0.05
  },
  glass: {
    variants: [{ seed: 901, type: 'basket' }, { seed: 902, type: 'basket' }, { seed: 903, type: 'vase' }, { seed: 904, type: 'vase' }],
    build: v => glass(v.seed, v.type), paint: GS_PAINT,
    set: { size: 1024, ormHalf: false, alpha: true, ormB: 'alpha' }, hi: 0.0011, lo: 0.0065, tris: 1400, err: 0.01, far: 400, kEps: 0.003, ao: { r: 0.02, n: 3 }, cage: 0.016, ray: 0.03
  },
  fan: {
    variants: [{ seed: 1001, type: 'wide' }, { seed: 1002, type: 'wide' }, { seed: 1003, type: 'tall' }, { seed: 1004, type: 'lobed' }],
    build: v => seaFan(v.seed, v.type), paint: GF_PAINT,
    set: { size: 1024, ormHalf: false, alpha: true, ormB: 'alpha' }, hi: 0.0008, lo: 0.005, tris: 700, err: 0.008, far: 250, kEps: 0.003, ao: { r: 0.01, n: 3 }, cage: 0.012, ray: 0.024
  },
  pen: {
    variants: [{ seed: 1301, type: 'plump' }, { seed: 1302, type: 'slim' }, { seed: 1303, type: 'umb' }, { seed: 1304, type: 'plump' }],
    build: v => seaPen(v.seed, v.type), paint: PN_PAINT,
    set: { size: 1024, ormB: 'emit' }, hi: 0.0018, lo: 0.0045, tris: 2600, err: 0.008, far: 500, kEps: 0.004, ao: { r: 0.02, n: 4 }, cage: 0.012, ray: 0.03
  },
  whip: {
    variants: [{ seed: 1401, type: 'rod', Href: 3 }, { seed: 1402, type: 'rod', Href: 5 }, { seed: 1403, type: 'rod', Href: 8 }, { seed: 1404, type: 'fork', Href: 4.5 }, { seed: 1405, type: 'spiral', Href: 5 }],
    build: v => whipCoral(v.seed, v.type, v.Href), paint: WP_PAINT,
    set: { size: 1024, ormB: 'emit' }, hi: 0.0018, lo: 0.006, tris: 700, err: 0.004, far: 140, kEps: 0.004, ao: { r: 0.015, n: 3 }, cage: 0.008, ray: 0.02
  },
  mat: {
    variants: [{ seed: 1501 }, { seed: 1502 }, { seed: 1503 }],
    build: v => bactMat(v.seed), paint: MT_PAINT,
    set: { size: 1024, ormHalf: false, alpha: true, ormB: 'alpha' }, hi: 0.0016, lo: 0.008, tris: 300, err: 0.006, far: 80, kEps: 0.004, ao: { r: 0.01, n: 3 }, cage: 0.02, ray: 0.05
  },
  crin: {
    variants: [{ seed: 1101 }, { seed: 1102 }, { seed: 1103 }],
    build: v => crinoid(v.seed), paint: CR_PAINT,
    set: { size: 1024, alpha: true, ormB: 'alpha' }, hi: 0.001, lo: 0.0032, tris: 3200, err: 0.004, far: 900, kEps: 0.003, ao: { r: 0.012, n: 3 }, cage: 0.009, ray: 0.02
  }
};

// (plants2) whip corals are authored at true height: pick the variant whose own height matches
// the instance's aspect (the host lays a unit whip out as (S, H, S)), and carry the sway terms
const ihash = (i, k) => { const q = Math.sin(i * 91.345 + k * 17.13) * 24634.6345; return q - Math.floor(q); };
export function whipRemap(i, sx, sy, amp, shrink) {
  const V = SPECIES.whip.variants, R = ihash(i, 5), want = R < 0.2 ? 'spiral' : R < 0.4 ? 'fork' : 'rod';
  let best = 0, bd = 1e9;
  V.forEach((v, k) => { if (v.type !== want) return; const d = Math.abs(Math.log(sy / sx / v.Href)); if (d < bd) { bd = d; best = k; } });
  const Href = V[best].Href;
  return { v: best, sx, sy: sy / Href, amp, shrink: shrink * Href };
}

// ---- the offline pipeline -----------------------------------------------------------------
export function pipeline() {
  const sets = {}, pieces = [], sk = {};
  for (const [name, S] of Object.entries(SPECIES)) {
    sets[name] = { size: S.set.size, gutter: 6, aoDist: S.set.aoDist || 0.06, aoSamples: 64, fill: true, weldNormals: true, alpha: !!S.set.alpha, ormHalf: S.set.ormHalf !== false, ...(S.set.ormB ? { ormB: S.set.ormB } : {}), ...(S.set.uvFixed ? { uvFixed: true } : {}) };
    sk[name] = [];
    S.variants.forEach((v, i) => {
      const b = S.build(v);
      sk[name].push(b.sk);
      pieces.push({ name: name + '_v' + i, set: name, sdf: b.sdf, loSdf: b.loSdf, low: b.low, farLow: b.farLow, farLow2: b.farLow2, hi: { h: S.hi }, lo: { h: S.lo, tris: S.tris, err: S.err }, far: S.far, paint: S.paint, kEps: S.kEps, ao: S.ao, cage: S.cage, ray: S.ray, emit: b.emit || S.emit });
    });
  }
  return {
    name: 'plants', out: 'assets/plants', sets, pieces,
    compress: { mesh: 'draco', tex: 'ktx2' },
    meta: { sk, species: Object.fromEntries(Object.entries(SPECIES).map(([k, S]) => [k, { variants: S.variants.length }])) }
  };
}

export function preview() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const want = (q.get('p') || 'tube_v0').split(','), k = +(q.get('k') || 2);
  const P = pipeline(), parts = P.pieces.filter(p => want.includes(p.name));
  return {
    key: 'preview-' + want.join('-') + '-' + k + '-' + Math.random(),
    parts: parts.map(p => ({ name: p.name, sdf: p.sdf, h: p.hi.h * k, tris: p.lo.tris, err: p.lo.h })),
    atlas: { size: +(q.get('s') || 512), paint: parts[0].paint, kEps: parts[0].kEps, ao: parts[0].ao }
  };
}
