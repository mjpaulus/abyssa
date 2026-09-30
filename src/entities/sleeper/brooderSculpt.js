// VELKATH THE BROODER — the sculpt (lib/sculpt.js specs). Pure data builders: no THREE,
// no scene; the same functions run in a worker, on the main thread and in node.
//
// Frames match brooderGeo.js: shell units (carapace half-width R = 1), +Z the front, +Y
// up; brooder.js scales the body group by R. Every rig/gameplay anchor brooder.js reads is
// preserved: leg hips (LEGS), claw roots (0.30 sd, -0.10, 0.66), ward sockets on the
// underside (y -0.105 .. -0.135), mouth hinges round (0, -0.20, 0.80), collision spheres.
//
// The design (after Michael's painting, docs/superpowers/specs/brooder-reference-...):
// ONE massive fused shell, not a dome with plates glued on — a low wedge heavier at the
// front, a V prow over a deep small face, the flanks broken into layered shale plates that
// grow OUT of the shell (smooth-fused at the root, crisp at the free edge, each one its own
// shard: its own taper, notches, tilt), asymmetric (the crusher side is heavier; the left
// shoulder carries an old healed break — a gouge with a callus lip and a snapped spine),
// scarred (healed cracks), crusted (barnacle colonies and sponge bores where silt settles),
// eroded toward the rear (worn convex edges, ridged pitting), silt in every crevice.
import { compile, mulberry } from '../../lib/sculpt.js';

const TAU = Math.PI * 2;
// ---- spec helpers ----------------------------------------------------------------------
const E = (c, r, m = 0, e) => ({ t: 'ellip', c, r, m, e });
const Bx = (c, h, r = 0, m = 0, e, R) => ({ t: 'box', c, h, r, m, e, R });
const Cap = (a, b, ra, rb = ra, m = 0) => ({ t: 'cap', a, b, ra, rb, m });
const U = (k, ...ch) => ({ t: 'u', k, ch });
const Sub = (k, a, ...b) => ({ t: 's', k, ch: [a, ...b] });
const I = (k, ...ch) => ({ t: 'i', k, ch });
const Tube = (p, r0, r1, n = 10, m = 0) => ({ t: 'tube', p, r: [r0, r1], n, m });
const Pl = (n, o, m = 0) => ({ t: 'plane', n, o, m });
const Xf = (R, p, ch) => ({ t: 'xf', R, p, ch: [ch] });
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// local->world rows from a long axis X and an approximate up
function basis(X, up) {
  X = norm(X);
  let Z = norm(cross(X, up));
  const Y = cross(Z, X);
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
}

// materials (the paint below keys off these)
export const M = { SHELL: 0, BELLY: 1, PLATE: 2, FACE: 3, HORN: 4, SCAR: 5, MEMB: 6, CHITIN: 7, EYE: 8 };

// The same V-prow shield footprint the old shell used (the silt drift and the weed still
// key off it), so the sculpt sits in the ground exactly where the ridge did.
export function rimR(th) {
  const c = Math.cos(th), s = Math.sin(th);
  let r = 1 / Math.sqrt(c * c + (s / 0.96) * (s / 0.96));
  if (s < 0) r *= 1 - 0.34 * Math.pow(-s, 1.3);
  if (s > 0) r *= 1 + 0.06 * Math.pow(s, 0.8) * (1 - s * s) * 4;
  if (s > 0) r = Math.min(r, 1.06 / Math.max(1e-3, s + 0.55 * Math.abs(c)));
  return r;
}

// ---- the carapace mass ---------------------------------------------------------------
// Built from overlapping masses (the anatomy every crab carries: gastric, branchial,
// cardiac swellings) melted together, the underside cut flat, a V prow slab over the face.
function massSpec() {
  const core = U(0.14,
    E([0, 0.02, 0.26], [0.99, 0.30, 0.66]),                       // front shoulders
    E([0, 0.00, -0.28], [0.74, 0.25, 0.60]),                      // hind mass, narrower
    E([0.47, 0.11, -0.02], [0.44, 0.23, 0.50]),                   // branchial, crusher side (bigger)
    E([-0.44, 0.09, -0.04], [0.40, 0.21, 0.46]),                  // branchial, left
    E([0.02, 0.17, 0.36], [0.32, 0.20, 0.30]),                    // gastric hump
    E([0, 0.13, -0.30], [0.24, 0.16, 0.22]),                      // cardiac
    E([0.10, 0.05, 0.62], [0.62, 0.16, 0.30])                     // the brow's mass, off-centre
  );
  // the V prow: two heavy slabs meeting over the face, tipped down at the front edge
  const prow = [];
  for (const sd of [1, -1]) {
    const X = norm([sd * 0.84, -0.10, -0.55]);      // along the slab edge, from the tip back
    prow.push(Bx([sd * 0.26, 0.10, 0.76], [0.36, 0.045, 0.16], 0.02, M.SHELL, null, basis(X, [0, 1, 0.25])));
  }
  let body = U(0.06, core, ...prow);
  // flat underside (the belly plane) and a hint of footprint trim at the rear
  body = I(0.04, body, Pl([0, -1, 0], 0.115));
  return body;
}

// Surface probe on the MASS (the plates and spines are placed on it).
let _mass = null;
function massTop(x, z) {
  if (!_mass) _mass = compile(massSpec());
  let y = 0.7;
  for (let i = 0; i < 120; i++) { const d = _mass.f(x, y, z); if (d < 1e-4) return y; y -= Math.max(d * 0.9, 1e-3); if (y < -0.2) return null; }
  return y;
}
function massNormal(x, y, z) {
  const f = _mass.f, e = 0.004;
  return norm([f(x + e, y, z) - f(x - e, y, z), f(x, y + e, z) - f(x, y - e, z), f(x, y, z + e) - f(x, y, z - e)]);
}
// the side of the mass at bearing th, height y: march inward along -radial
function massSide(th, y) {
  if (!_mass) _mass = compile(massSpec());
  const c = Math.cos(th), s = Math.sin(th);
  let r = 1.6;
  for (let i = 0; i < 120; i++) { const d = _mass.f(c * r, y, s * r); if (d < 1e-4) return r; r -= Math.max(d * 0.9, 1e-3); if (r < 0.05) return null; }
  return r;
}

// ---- a shale plate ---------------------------------------------------------------------
// One shard in its own frame (x along its length from the root, y its thickness, z its
// width): a slab whose flanks converge to an off-centre point, thinning toward the tip,
// with bites taken out of either margin and the tip sometimes snapped square. Fused to the
// shell at the root by the caller.
function plateSpec(rnd, len, wid, th, m) {
  const tipZ = (rnd() - 0.5) * wid * 0.5;                 // the point is off-centre
  const sh = 0.25 + 0.2 * rnd();                           // where the flanks start to close
  const kids = [Bx([len / 2, 0, 0], [len / 2, th / 2, wid / 2], th * 0.22, m)];
  for (const sd of [1, -1]) {
    // flank: from (sh*len, sd*wid/2) to (len, tipZ)
    const dx = len * (1 - sh), dz = tipZ - sd * wid / 2;
    const n = norm([-dz * sd, 0, dx * sd]);              // outward normal of the flank line
    const o = n[0] * sh * len + n[2] * sd * wid / 2;
    kids.push(Pl(n, o, m));
  }
  // thins toward the tip (top face slopes down)
  kids.push(Pl(norm([th * 0.55 / len, 1, 0]), th / 2, m));
  // a snapped tip on some
  if (rnd() < 0.4) kids.push(Pl(norm([1, 0, (rnd() - 0.5) * 1.4]), len * (0.80 + 0.12 * rnd()), m));
  let p = I(0, ...kids);
  const bites = [];
  const nb = 1 + Math.floor(rnd() * 2.5);
  for (let i = 0; i < nb; i++) {
    const x = len * (0.3 + 0.55 * rnd()), sd = rnd() < 0.5 ? 1 : -1, r = wid * (0.12 + 0.18 * rnd());
    bites.push(E([x, 0, sd * (wid / 2) * (1 - 0.6 * (x / len - sh) / (1 - sh)) + sd * r * 0.4], [r * 1.3, th * 3, r], m));
  }
  if (bites.length) p = Sub(0.004, p, ...bites);
  return p;
}

// Layered shingles down each flank from the shoulder to the tail, lower layers longer.
// The crusher side (+X) is heavier; on the left shoulder a run of plates is missing where
// the old break healed over.
function platesSpec(seed) {
  const rnd = mulberry(seed), out = [];
  const LAY = [{ y: -0.03, rho: 1.0, n: 9, len: 0.30 }, { y: 0.05, rho: 0.92, n: 8, len: 0.25 }, { y: 0.12, rho: 0.80, n: 7, len: 0.21 }, { y: 0.19, rho: 0.64, n: 5, len: 0.17 }];
  for (const sd of [1, -1]) for (let L = 0; L < LAY.length; L++) {
    const lay = LAY[L];
    for (let k = 0; k < lay.n; k++) {
      const f = (k + 0.5 * (L & 1) + 0.25 * (rnd() - 0.5)) / (lay.n - 0.3);
      const th0 = 0.95 - f * 2.05, th = sd > 0 ? th0 : Math.PI - th0;
      // the healed break: no plates over the left shoulder's upper layers
      if (sd < 0 && L >= 1 && th0 > 0.15 && th0 < 0.75) continue;
      const c = Math.cos(th), s = Math.sin(th);
      const y = lay.y + (rnd() - 0.5) * 0.02 - 0.05 * Math.max(0, -s);
      const r = massSide(th, y);
      if (r == null) continue;
      const rr = r * (L === 0 ? 1.0 : 0.985);
      const x = c * rr, z = s * rr;
      const nrm = massNormal(x, y, z);
      // lie along the slope, sweeping back: outward-and-down plus aft
      const X = norm([c * 0.8, -0.30 + 0.08 * L + nrm[1] * 0.25, s * 0.8 - 0.75]);
      const heavy = sd > 0 ? 1.12 : 0.94;
      const len = lay.len * heavy * (0.8 + 0.4 * rnd()) * (0.75 + 0.35 * Math.sin(Math.PI * Math.min(1, f)));
      const wid = len * (0.42 + 0.22 * rnd()), thk = 0.018 + 0.012 * rnd() - 0.003 * L;
      const R = basis(X, nrm);
      // the root is buried a little inside the mass so the fuse reads as growth
      const p = [x - X[0] * len * 0.12, y - X[1] * len * 0.12, z - X[2] * len * 0.12];
      out.push(Xf(R, p, plateSpec(rnd, len, wid, thk, M.PLATE)));
    }
  }
  // the rear crest: tall shards raking up and back off the hind slab
  for (let k = 0; k < 4; k++) {
    const x = (k - 1.5) * 0.17 + (rnd() - 0.5) * 0.04, z = -0.40 - 0.07 * Math.abs(k - 1.5) + (rnd() - 0.5) * 0.05;
    const y = massTop(x, z);
    if (y == null) continue;
    const len = 0.22 + 0.10 * rnd();
    const X = norm([x * 0.5, 0.35 + 0.1 * rnd(), -1]);
    out.push(Xf(basis(X, [0, 1, 0]), [x, y - 0.02, z], plateSpec(rnd, len, len * 0.5, 0.024, M.PLATE)));
  }
  return out;
}

// Spines: lateral horns off the shoulders (the left one snapped and healed to a stump), a
// row of short ones along the prow's edge, knobs up the keel.
function spinesSpec(seed) {
  const rnd = mulberry(seed), out = [];
  const rim = (th, y) => { const r = massSide(th, y); return [Math.cos(th) * r, y, Math.sin(th) * r]; };
  const LAT = [[0.62, 0.30, 0.060], [0.30, 0.20, 0.045], [-0.10, 0.15, 0.036]];
  for (const sd of [1, -1]) for (let i = 0; i < LAT.length; i++) {
    const [th0, len0, r0] = LAT[i], th = sd > 0 ? th0 : Math.PI - th0;
    const a = rim(th, 0.02);
    const dir = norm([Math.cos(th), 0.25, Math.sin(th) - 0.55]);
    let len = len0 * (sd > 0 ? 1.1 : 1.0) * (0.9 + 0.2 * rnd());
    const snapped = sd < 0 && i === 0;
    if (snapped) len *= 0.35;                       // the old break took it
    const b = [a[0] + dir[0] * len, a[1] + dir[1] * len + 0.02 * len, a[2] + dir[2] * len];
    out.push(Cap([a[0] - dir[0] * 0.05, a[1], a[2] - dir[2] * 0.05], b, r0, snapped ? r0 * 0.55 : 0.004, snapped ? M.SCAR : M.HORN));
  }
  // prow edge teeth
  for (const sd of [1, -1]) for (let k = 0; k < 4; k++) {
    const x = sd * (0.10 + 0.13 * k), z = 0.93 - 0.38 * (0.10 + 0.13 * k) * 1.6;
    const y = massTop(x, z - 0.02);
    if (y == null) continue;
    const dir = norm([sd * 0.3, -0.35, 1]);
    const len = 0.07 + 0.04 * rnd() - 0.01 * k;
    out.push(Cap([x, y - 0.02, z - 0.03], [x + dir[0] * len, y - 0.02 + dir[1] * len, z - 0.03 + dir[2] * len], 0.022, 0.003, M.HORN));
  }
  // keel knobs
  for (let k = 0; k < 6; k++) {
    const z = 0.50 - k * 0.17, x = 0.012 * Math.sin(k * 2.1), y = massTop(x, z);
    if (y == null) continue;
    const r = 0.030 - 0.003 * k;
    out.push(Cap([x, y - 0.01, z], [x, y + r * 1.1, z - r * 0.8], r, r * 0.35, M.HORN));
  }
  return out;
}

// ---- the face -------------------------------------------------------------------------
// Under the prow: a dark brow plate carrying the orbits (the stalked eyes fold into them),
// the four ocelli in their pits, the antennule notches, and the mouth frame — a deep
// buccal cavity walled by the third maxillipeds' heavy plates (the working mouthparts are
// separate, hinged meshes that live inside it).
export const EYESTALK = [0.155, -0.075, 0.905];      // +X orbit (mirrored), stalk pivot
export const OCELLI = [[0.050, -0.135, 0.918, 0.013], [0.088, -0.160, 0.905, 0.011]];
function faceSpec() {
  const plate = Bx([0, -0.15, 0.85], [0.27, 0.085, 0.07], 0.035, M.FACE);
  const cheeks = [];
  for (const sd of [1, -1]) cheeks.push(E([sd * 0.24, -0.12, 0.80], [0.12, 0.10, 0.12], M.FACE));
  let f = U(0.05, plate, ...cheeks);
  const cuts = [];
  for (const sd of [1, -1]) {
    cuts.push(E([sd * EYESTALK[0], EYESTALK[1] - 0.005, EYESTALK[2] + 0.01], [0.075, 0.042, 0.085], M.MEMB));   // orbit
    for (const [x, y, z, r] of OCELLI) cuts.push({ t: 'sphere', c: [sd * x, y, z + r * 0.6], r: r * 1.35, m: M.EYE });
    cuts.push(E([sd * 0.02, -0.105, 0.925], [0.018, 0.012, 0.03], M.MEMB));   // antennule notch
  }
  // the buccal cavity: where the mouthparts work
  cuts.push(Bx([0, -0.225, 0.86], [0.13, 0.05, 0.10], 0.03, M.MEMB));
  f = Sub(0.012, f, ...cuts);
  // ocellus rims (a raised lip round each pit) and the maxilliped plates framing the mouth
  const extra = [];
  for (const sd of [1, -1]) {
    for (const [x, y, z, r] of OCELLI) extra.push({ t: 'torus', c: [sd * x, y, z + r * 0.35], R: r * 1.45, r: r * 0.32, m: M.FACE, e: [Math.PI / 2, 0, 0] });
    extra.push(Bx([sd * 0.105, -0.235, 0.87], [0.045, 0.055, 0.02], 0.012, M.CHITIN, [0.25, sd * 0.25, 0]));
  }
  return U(0.01, f, ...extra);
}

// ---- underside -------------------------------------------------------------------------
// The belly (sternites) and the brood apron, the coxal sockets the legs seat in.
export const HIPS = [[0.80, -0.07, 0.36], [0.86, -0.07, 0.10], [0.84, -0.07, -0.16], [0.74, -0.07, -0.42]];
function bellySpec() {
  const apron = E([0, -0.118, -0.24], [0.36, 0.028, 0.34], M.BELLY);
  const sockets = [];
  for (const sd of [1, -1]) for (const [x, y, z] of HIPS) sockets.push(E([sd * (x + 0.03), y - 0.01, z], [0.10, 0.075, 0.10], M.MEMB));
  const chel = [];
  for (const sd of [1, -1]) chel.push(E([sd * 0.30, -0.10, 0.64], [0.12, 0.09, 0.10], M.MEMB));
  return { apron, sockets: [...sockets, ...chel] };
}

// ---- the whole body --------------------------------------------------------------------
export function bodySpec(seed = 0xB700D5E7) {
  const mass = massSpec();
  const plates = platesSpec(seed ^ 0x51A7E);
  const spines = spinesSpec(seed ^ 0x5919E);
  const face = faceSpec();
  const { apron, sockets } = bellySpec();
  // the cervical groove across the back, and the old break on the left shoulder: a gouge
  // (subtracted, smooth-healed) with a raised callus lip running round it
  const groove = Tube([[-0.85, 0.12, -0.02], [0, 0.46, 0.26], [0.85, 0.12, -0.02]], 0.022, 0.022, 14, M.SHELL);
  const gouge = Tube([[-0.92, 0.16, 0.40], [-0.70, 0.30, 0.22], [-0.48, 0.30, -0.02]], 0.07, 0.045, 10, M.SCAR);
  const callus = Tube([[-0.95, 0.18, 0.48], [-0.66, 0.36, 0.30], [-0.40, 0.33, -0.02]], 0.020, 0.012, 12, M.SCAR);
  let shell = U(0.012, U(0.05, mass, face), ...plates);
  shell = U(0.02, shell, ...spines);
  shell = U(0.03, shell, apron);
  shell = Sub(0.03, shell, groove);
  shell = Sub(0.05, shell, gouge, ...sockets);
  shell = U(0.02, shell, callus);
  // skin: broad lumps, healed cracks (geometry), and the bake-only detail — barnacle
  // colonies, sponge bores, fine cracks, growth grain, pitting — plus erosion at the rear
  const rear = ['ax', 2, -0.1, -0.7];
  shell = {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.010, f: 4.5, oct: 3, seed: 11 },
      { type: 'cracks', amp: 0.007, f: 3.2, w: 0.035, heal: 0.9, seed: 12, mask: [['n', 1.5, 0.45, 0.7, 13]] },
      { type: 'barn', amp: 0.030, f: 9, dens: 0.30, seed: 14, mask: [['n', 1.3, 0.55, 0.72, 15], ['ax', 1, -0.02, 0.1]] },
      // bake-only
      { type: 'barn', bake: true, amp: 0.012, f: 26, dens: 0.42, seed: 16, mask: [['n', 1.8, 0.45, 0.66, 17]] },
      { type: 'pits', bake: true, amp: 0.010, f: 11, dens: 0.18, r: 0.22, seed: 18, mask: [['ax', 1, 0.0, 0.1]] },
      { type: 'cracks', bake: true, amp: 0.004, f: 9, w: 0.05, heal: 0.5, seed: 19 },
      { type: 'ridged', bake: true, amp: 0.006, f: 16, oct: 3, seed: 20, mask: [rear] },
      { type: 'fbm', bake: true, amp: 0.0025, f: 40, oct: 3, seed: 21 }
    ], ch: [{ t: 'erode', amt: 0.012, r: 0.02, mask: [rear], ch: [shell] }]
  };
  return shell;
}

// ---- paint ------------------------------------------------------------------------------
// After the painting: olive-grey shell greening where things grow, rust at every broken
// edge of the shale, pale bleached barnacle rims, silt settled in crevices and on the
// up-facing ledges, a near-black face, a corpse-pale belly.
export const PAINT = {
  kScale: 0.02, aoAlb: 0.55,
  mats: {
    [M.SHELL]: { c: [0.34, 0.35, 0.29], ro: 0.62 },
    [M.BELLY]: { c: [0.56, 0.53, 0.47], ro: 0.70 },
    [M.PLATE]: { c: [0.31, 0.33, 0.31], ro: 0.50 },
    [M.FACE]: { c: [0.11, 0.10, 0.09], ro: 0.45 },
    [M.HORN]: { c: [0.52, 0.49, 0.42], ro: 0.40 },
    [M.SCAR]: { c: [0.50, 0.47, 0.40], ro: 0.72 },
    [M.MEMB]: { c: [0.40, 0.33, 0.30], ro: 0.80 },
    [M.CHITIN]: { c: [0.30, 0.37, 0.37], ro: 0.40 },
    [M.EYE]: { c: [0.02, 0.02, 0.02], ro: 0.1 }
  },
  layers: [
    { c: [0.28, 0.33, 0.20], a: 0.55, ro: 0.8, m: [['n', 3, 0.45, 0.7, 31], ['nd', [0, 1, 0], 0.2, 0.7], ['inv', ['mat', 3]]] },          // olive film on top
    { c: [0.20, 0.27, 0.10], a: 0.7, ro: 0.9, m: [['cav', 0.05, 0.4], ['nd', [0, 1, 0], 0.0, 0.5], ['n', 5, 0.4, 0.65, 32]] },               // moss in the low spots
    { c: [0.56, 0.24, 0.08], a: 0.85, ro: 0.75, m: [['mat', 2], ['cvx', 0.25, 0.9]] },                                                       // rust-edged shale
    { c: [0.46, 0.19, 0.07], a: 0.55, ro: 0.8, m: [['mat', 2], ['n', 7, 0.5, 0.75, 33]] },                                                   // rust bloom on the plates
    { c: [0.30, 0.12, 0.05], a: 0.6, ro: 0.85, m: [['cav', 0.2, 0.7], ['ao', 0.25, 0.7]] },                                                  // dark rust pooled in seams
    { c: [0.70, 0.68, 0.60], a: 0.75, ro: 0.85, m: [['cvx', 0.6, 1.5], ['n', 9, 0.35, 0.6, 34]] },                                           // bleached barnacle rims / worn edges
    { c: [0.48, 0.44, 0.36], a: 0.85, ro: 0.95, m: [['cav', 0.1, 0.5], ['nd', [0, 1, 0], 0.35, 0.8]] },                                      // silt settled in crevices
    { c: [0.46, 0.43, 0.36], a: 0.5, ro: 0.95, m: [['ax', 2, -0.2, -0.8], ['nd', [0, 1, 0], 0.2, 0.9]] },                                    // silt blanket over the eroded rear
    { c: [0.60, 0.56, 0.47], a: 0.5, ro: 0.8, m: [['mat', 5], ['n', 12, 0.3, 0.7, 35]] },                                                    // scar tissue mottle
    { c: [0.08, 0.07, 0.06], a: 0.9, ro: 0.7, m: [['ao', 0.55, 0.95]] }                                                                      // deep holes go black
  ]
};

export function bodyJob() {
  return {
    key: 'brooder-body-v1',
    parts: [{ name: 'body', sdf: bodySpec(), h: 0.0075, tris: 70000, err: 0.012 }],
    atlas: { size: 2048, gutter: 4, kEps: 0.012, ao: { r: 0.07, n: 4 }, paint: PAINT },
    probes: [{ name: 'top', part: 'body', type: 'top', x0: -1.1, x1: 1.1, z0: -1.0, z1: 1.1, n: 96 }],
    layout: { body: [0, 0, 0] }
  };
}
