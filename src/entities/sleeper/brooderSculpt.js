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
  let body = core;
  // CUT TO A WEDGE (the painting reads as a slab of rock, not a dome): a shallow roof
  // ridged along the keel (lower on the left), shoulders bevelled toward the prow, steep
  // flanks and a rear bevel. Smooth-intersected with a small radius, so the facet ridges
  // stay crisp through dual contouring.
  const PP = (p0, n) => { n = norm(n); return Pl(n, p0[0] * n[0] + p0[1] * n[1] + p0[2] * n[2]); };
  body = I(0.035, body,
    PP([0, 0.335, 0], [0.34, 1, 0.07]), PP([0, 0.315, 0], [-0.42, 1, 0.05]),
    PP([0, 0.28, 0.66], [0.22, 1, 0.95]), PP([0, 0.27, 0.66], [-0.26, 1, 0.95]),
    PP([0, 0.20, -0.52], [0, 1, -1.05]),
    PP([0.97, 0, 0], [1, 0.30, 0.05]), PP([-0.92, 0, 0], [-1, 0.34, 0.05]),
    Pl([0, -1, 0], 0.098));      // the belly plane: every ward socket (y -0.105 .. -0.135) sits proud of it
  // the V prow, ON the cut: two heavy slabs meeting in a point over the face, their
  // undersides a visor that keeps the face in shadow (the painting's brow)
  const prow = [], T = [0, 0.06, 1.0];
  for (const sd of [1, -1]) {
    const X = norm([sd * 0.80, 0.10, -0.60]), L = 0.36;
    prow.push(Bx([T[0] + X[0] * L, T[1] + X[1] * L, T[2] + X[2] * L], [L, 0.038, 0.13], 0.012, M.SHELL, null, basis(X, [0, 1, 0.35])));
  }
  body = U(0.03, body, ...prow);
  // the prow's edge is broken: bites out of its front lip
  const nr = mulberry(0x9A0);
  const bites = [];
  for (const sd of [1, -1]) for (let k = 0; k < 3; k++) {
    const t = 0.15 + 0.28 * k + 0.08 * nr(), X = norm([sd * 0.80, 0.10, -0.60]);
    const c = [T[0] + X[0] * t, T[1] + X[1] * t + 0.01, T[2] + X[2] * t + 0.10 + 0.02 * nr()];
    bites.push(E(c, [0.05 + 0.03 * nr(), 0.05, 0.05 + 0.03 * nr()], M.SCAR));
  }
  return Sub(0.012, body, ...bites);
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
    // the margin at x (the flank line closes from the shoulder toward the point)
    const t = Math.max(0, (x / len - sh) / (1 - sh)), edge = (wid / 2) * (1 - t) + (sd > 0 ? tipZ : -tipZ) * t * sd;
    bites.push(E([x, 0, sd * (Math.abs(edge) + r * 0.35)], [r * 1.3, th * 3, r], m));
  }
  if (bites.length) p = Sub(0.004, p, ...bites);
  return p;
}

// Layered shingles down each flank from the shoulder to the tail, lower layers longer.
// The crusher side (+X) is heavier; on the left shoulder a run of plates is missing where
// the old break healed over.
function platesSpec(seed) {
  const rnd = mulberry(seed), out = [];
  const LAY = [{ y: -0.04, rho: 1.0, n: 8, len: 0.46 }, { y: 0.05, rho: 0.92, n: 7, len: 0.40 }, { y: 0.14, rho: 0.80, n: 6, len: 0.33 }, { y: 0.22, rho: 0.64, n: 5, len: 0.26 }];
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
      const wid = len * (0.45 + 0.22 * rnd()), thk = 0.030 + 0.014 * rnd() - 0.004 * L;
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
    const len = 0.34 + 0.14 * rnd();
    const X = norm([x * 0.5, 0.42 + 0.12 * rnd(), -1]);
    out.push(Xf(basis(X, [0, 1, 0]), [x, y - 0.03, z], plateSpec(rnd, len, len * 0.5, 0.036, M.PLATE)));
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
  const apron = E([0, -0.103, -0.24], [0.36, 0.022, 0.34], M.BELLY);
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
  let shell = U(0.012, U(0.05, mass, face), ...plates);
  shell = U(0.02, shell, ...spines);
  shell = U(0.03, shell, apron);
  shell = Sub(0.03, shell, groove);
  shell = Sub(0.05, shell, gouge, ...sockets);
  // skin: broad lumps, healed cracks (geometry), and the bake-only detail — barnacle
  // colonies, sponge bores, fine cracks, growth grain, pitting — plus erosion at the rear
  const rear = ['ax', 2, -0.1, -0.7];
  // the two old breaks: the gouge over the left shoulder, a starred impact on the right rear
  const breakL = ['sph', [-0.70, 0.30, 0.22], 0.16, 0.34], breakR = ['sph', [0.46, 0.24, -0.46], 0.10, 0.26];
  shell = {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.006, f: 4.5, oct: 3, seed: 11 },
      { type: 'cracks', amp: 0.012, f: 4.0, w: 0.05, heal: 1.1, seed: 12, mask: [breakL] },
      { type: 'cracks', amp: 0.010, f: 5.0, w: 0.05, heal: 1.1, seed: 22, mask: [breakR] },
      // bake-only: barnacle colonies, sponge bores with bleached rims, shale strata, pits
      { type: 'barn', bake: true, amp: 0.030, f: 9, dens: 0.30, seed: 14, mask: [['n', 1.3, 0.55, 0.72, 15], ['ax', 1, -0.02, 0.1]] },
      { type: 'barn', bake: true, amp: 0.012, f: 26, dens: 0.42, seed: 16, mask: [['n', 1.8, 0.45, 0.66, 17]] },
      { type: 'pits', bake: true, amp: 0.022, f: 5.5, dens: 0.14, r: 0.30, seed: 18, mask: [['ax', 1, 0.0, 0.1]] },
      { type: 'pits', bake: true, amp: 0.006, f: 16, dens: 0.25, r: 0.22, seed: 23 },
      { type: 'bands', bake: true, amp: 0.004, f: 70, ax: [0.1, 1, 0.3] },
      { type: 'cracks', bake: true, amp: 0.003, f: 14, w: 0.03, seed: 24, mask: [['n', 2.5, 0.55, 0.7, 25]] },
      { type: 'ridged', bake: true, amp: 0.006, f: 16, oct: 3, seed: 20, mask: [rear] },
      { type: 'fbm', bake: true, amp: 0.004, f: 40, oct: 3, seed: 21 }
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
    [M.SHELL]: { c: [0.23, 0.25, 0.19], ro: 0.62 },
    [M.BELLY]: { c: [0.56, 0.53, 0.47], ro: 0.70 },
    [M.PLATE]: { c: [0.20, 0.23, 0.22], ro: 0.50 },
    [M.FACE]: { c: [0.11, 0.10, 0.09], ro: 0.45 },
    [M.HORN]: { c: [0.52, 0.49, 0.42], ro: 0.40 },
    [M.SCAR]: { c: [0.50, 0.47, 0.40], ro: 0.72 },
    [M.MEMB]: { c: [0.40, 0.33, 0.30], ro: 0.80 },
    [M.CHITIN]: { c: [0.30, 0.37, 0.37], ro: 0.40 },
    [M.EYE]: { c: [0.02, 0.02, 0.02], ro: 0.1 }
  },
  layers: [
    { c: [0.26, 0.31, 0.15], a: 0.75, ro: 0.8, m: [['n', 3, 0.40, 0.7, 31], ['nd', [0, 1, 0], 0.1, 0.7], ['inv', ['mat', 3]]] },          // olive film on top
    { c: [0.12, 0.13, 0.10], a: 0.55, ro: 0.7, m: [['n', 7, 0.55, 0.75, 36], ['inv', ['mat', 3]]] },                                         // dark mottle
    { c: [0.42, 0.20, 0.08], a: 0.45, ro: 0.8, m: [['n', 2.2, 0.62, 0.8, 37], ['nd', [0, 1, 0], -0.4, 0.3]] },                               // rust bloom down the flanks
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

// ---- limbs --------------------------------------------------------------------------------
// Every limb piece is sculpted at its TRUE size in its rig frame (brooder.js): +X along the
// bone from the proximal joint, +Y the dorsal side, Z fore-aft (the flattened axis). A walking
// leg segment is a compressed tube (crab meri are flattened) with a keel along its crest,
// raked spines growing out of the keel, a stepped cuff at the distal joint and a wrinkled
// pale membrane neck at the root that disappears into the previous segment's cuff.
export const SEG_L = { coxa: 0.14, femur: 0.48, tibia: 0.42, dactyl: 0.28 };
function legSegSpec({ L, r0, r1, flat = 0.62, spines = 0, vspines = 0, seed = 1, tip = false, curl = 0 }) {
  const rnd = mulberry(seed), kids = [];
  const r = x => r0 + (r1 - r0) * x / L;
  if (tip) {
    // the dactyl: a curved horn-tipped spike with fluted flanks
    const p = [[-0.03 * L, 0, 0], [0.45 * L, -curl * 0.25 * L, 0], [L, -curl * L, 0]];
    kids.push(Tube(p, r0, 0.004, 12, M.CHITIN));
    kids.push(Cap([-0.07 * L, 0, 0], [0.05 * L, 0, 0], r0 * 0.78, r0 * 0.8, M.MEMB));
    return {
      t: 'disp', L: [
        { type: 'bands', amp: 0.0025, f: 180, ax: [0, 0, 1], mask: [['ax', 0, 0.1 * L, 0.2 * L]] },
        { type: 'grain', bake: true, amp: 0.0012, f: 90, seed: seed + 3 }
      ], ch: [U(0.02, ...kids)]
    };
  }
  // the shaft, flattened fore-aft
  const shaft = I(0.02, Cap([0.02 * L, 0, 0], [0.90 * L, 0, 0], r0, r1, M.CHITIN), Pl([0, 0, 1], r0 * flat, M.CHITIN), Pl([0, 0, -1], r0 * flat, M.CHITIN));
  kids.push(shaft);
  // the dorsal keel
  kids.push(Tube([[0.06 * L, r0 * 0.86, 0], [0.5 * L, r(0.5 * L) * 1.04, 0], [0.88 * L, r1 * 0.92, 0]], 0.010, 0.006, 8, M.CHITIN));
  // the distal cuff: a swelling and a lipped rim
  kids.push(E([0.86 * L, 0, 0], [0.08 * L, r1 * 1.12, r1 * flat * 1.15], M.CHITIN));
  kids.push({ t: 'torus', c: [0.91 * L, 0, 0], R: r1 * 0.96, r: r1 * 0.06, m: M.HORN, e: [0, 0, Math.PI / 2] });
  // the membrane neck at the root
  kids.push(Cap([-0.07 * L, 0, 0], [0.07 * L, 0, 0], r0 * 0.74, r0 * 0.80, M.MEMB));
  let seg = U(0.025, ...kids);
  // spines out of the keel, raked toward the distal end, and a ventral row of short ones
  const sp = [];
  for (let k = 0; k < spines; k++) {
    const x = L * (0.18 + 0.64 * (k + 0.3 * rnd()) / spines), rr = r(x), h = rr * (0.55 + 0.45 * rnd());
    sp.push(Cap([x, rr * 0.85, 0], [x + h * 0.9, rr + h, (rnd() - 0.5) * rr * 0.3], rr * 0.30, 0.004, M.HORN));
  }
  for (let k = 0; k < vspines; k++) {
    const x = L * (0.2 + 0.6 * (k + 0.5) / vspines), rr = r(x), h = rr * 0.35;
    sp.push(Cap([x, -rr * 0.9, 0], [x + h, -rr - h * 0.6, 0], rr * 0.10, 0.002, M.HORN));
  }
  if (sp.length) seg = U(0.012, seg, ...sp);
  return {
    t: 'disp', L: [
      { type: 'bands', bake: true, amp: 0.0018, f: 300, ax: [1, 0.25, 0], mask: [['ax', 0, 0.08 * L, 0.02 * L]] },     // membrane folds
      { type: 'fbm', amp: 0.0025, f: 30, oct: 3, seed: seed + 1 },
      { type: 'pits', bake: true, amp: 0.0025, f: 70, dens: 0.3, r: 0.25, seed: seed + 2 },
      { type: 'grain', bake: true, amp: 0.0010, f: 140, seed: seed + 3 },
      { type: 'cracks', bake: true, amp: 0.0012, f: 22, w: 0.04, seed: seed + 4 }
    ], ch: [seg]
  };
}

// A cheliped segment (merus / carpus): heavier, knobbed with pale tubercles, a few spines.
function armSegSpec({ L, r0, r1, x0 = -0.07, knobs = 0, spines = 0, flat = 0.78, seed = 1, out = 1 }) {
  const rnd = mulberry(seed);
  const r = x => r0 + (r1 - r0) * Math.max(0, x) / L;
  const kids = [
    I(0.03, Cap([x0 * L + r0 * 0.5, 0, 0], [0.9 * L, 0, 0], r0, r1, M.CHITIN), Pl([0, 0, 1], r0 * flat, M.CHITIN), Pl([0, 0, -1], r0 * flat, M.CHITIN)),
    E([0.88 * L, 0, 0], [0.10 * L, r1 * 1.12, r1 * flat * 1.12], M.CHITIN),
    { t: 'torus', c: [0.94 * L, 0, 0], R: r1 * 0.95, r: r1 * 0.06, m: M.HORN, e: [0, 0, Math.PI / 2] },
    Cap([x0 * L, 0, 0], [x0 * L + 0.12 * L, 0, 0], r0 * 0.75, r0 * 0.8, M.MEMB),
    Tube([[x0 * L + 0.2 * L, r0 * 0.9, 0], [0.45 * L, r(0.45 * L) * 1.02, 0], [0.86 * L, r1 * 0.95, 0]], 0.012, 0.008, 8, M.CHITIN)
  ];
  const bumps = [];
  for (let k = 0; k < knobs; k++) for (const a of [0.0, 0.85, -0.85]) {
    const x = L * (0.15 + 0.7 * (k + (a ? 0.5 : 0) + 0.2 * (rnd() - 0.5)) / knobs), rr = r(x), kr = rr * (0.13 + 0.06 * rnd());
    const cy = Math.cos(a) * rr * 0.95, cz = Math.sin(a) * rr * flat * 0.95;
    bumps.push({ t: 'sphere', c: [x, cy, cz], r: kr, m: M.HORN });
  }
  for (let k = 0; k < spines; k++) {
    const x = L * (0.55 + 0.35 * k / Math.max(1, spines - 1)), rr = r(x), h = rr * 0.6;
    bumps.push(Cap([x, rr * 0.85, out * rr * 0.2], [x + h * 0.8, rr + h * 0.7, out * rr * 0.35], rr * 0.18, 0.003, M.HORN));
  }
  let seg = U(0.03, ...kids);
  if (bumps.length) seg = U(0.01, seg, ...bumps);
  return {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.004, f: 16, oct: 3, seed: seed + 1 },
      { type: 'bands', bake: true, amp: 0.0015, f: 260, ax: [1, 0.2, 0], mask: [['ax', 0, x0 * L + 0.13 * L, x0 * L + 0.05 * L]] },
      { type: 'pits', bake: true, amp: 0.003, f: 45, dens: 0.35, r: 0.25, seed: seed + 2 },
      { type: 'barn', bake: true, amp: 0.004, f: 38, dens: 0.18, seed: seed + 5, mask: [['n', 6, 0.55, 0.7, seed + 6]] },
      { type: 'grain', bake: true, amp: 0.0012, f: 120, seed: seed + 3 },
      { type: 'cracks', bake: true, amp: 0.0015, f: 14, w: 0.04, heal: 0.6, seed: seed + 4 }
    ], ch: [seg]
  };
}

// The hands. MAJOR, the crusher: a swollen, heavy palm; the fixed finger (pollex) short and
// massive, its biting edge set with rounded molar knobs. MINOR, the cutter: a slimmer hand
// whose pollex is long, hooked and saw-toothed. Both carry the painting's rows of pale
// knobs down the outer face. The moving finger (dactyl) pivots at HINGE.
export const HAND = {
  major: { len: 0.62, hgt: 0.40, wid: 0.30, hinge: [0.60, 0.08, 0] },
  minor: { len: 0.70, hgt: 0.30, wid: 0.22, hinge: [0.66, 0.06, 0] }
};
function palmSpec(kind, seed) {
  // the outer face: the major rides on the right (+X) and its hand's local +Z faces inward
  // there, so its knobs go on -Z; the minor (left) keeps them on +Z
  const rnd = mulberry(seed), H = HAND[kind], major = kind === 'major', out = major ? -1 : 1;
  const { len, hgt, wid } = H, c = [len * 0.50, 0, 0];
  // a compressed, flat-faced hand: an ellipsoid cut by a rounded box (flat faces, keeled
  // margins), swelling toward the fingers
  const hand = U(0.05,
    I(0.03, E(c, [len * 0.56, hgt * 0.58, wid * 0.62], M.CHITIN), Bx(c, [len * 0.5, hgt * 0.5, wid * 0.5], 0.04, M.CHITIN)),
    I(0.03, E([len * 0.80, 0, 0], [len * 0.26, hgt * 0.56, wid * 0.60], M.CHITIN), Bx([len * 0.80, 0, 0], [len * 0.22, hgt * 0.52, wid * 0.48], 0.03, M.CHITIN)),
    Cap([-0.06, 0, 0], [0.08, 0, 0], hgt * 0.28, hgt * 0.34, M.MEMB));
  const kids = [hand];
  // keels: the upper crest and the lower margin, sharp ridges running to the fingers
  kids.push(Tube([[len * 0.08, hgt * 0.46, 0], [len * 0.5, hgt * 0.54, 0], [len * 0.92, hgt * 0.44, 0]], 0.012, 0.008, 10, M.CHITIN));
  kids.push(Tube([[len * 0.10, -hgt * 0.47, 0], [len * 0.55, -hgt * 0.52, 0], [len * 0.95, -hgt * 0.40, 0]], 0.012, 0.009, 10, M.CHITIN));
  // the pollex: a flattened blade from the lower distal corner, hooking up at its point
  const pl = major ? 0.40 : 0.58, pr = major ? hgt * 0.24 : hgt * 0.19;
  const p0 = [len * 0.86, -hgt * 0.22, 0], hook = major ? 0.07 : 0.13;
  const P = [p0, [p0[0] + pl * 0.45, p0[1] - 0.005, 0], [p0[0] + pl * 0.85, p0[1] + hook * 0.4, 0], [p0[0] + pl, p0[1] + hook, 0]];
  kids.push(I(0.01, Tube(P, pr, 0.006, 14, M.PLATE), Pl([0, 0, 1], pr * 0.62, M.PLATE), Pl([0, 0, -1], pr * 0.62, M.PLATE)));
  const teeth = [];
  const bez = t => { const u = 1 - t; return [0, 1].map(i => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]); };
  const nT = major ? 4 : 5;
  for (let k = 0; k < nT; k++) {
    const t = 0.10 + 0.62 * k / (nT - 1), [x, y] = bez(t), rr = pr * (1 - 0.75 * t) + 0.008;
    // crusher: squat rounded molars; cutter: a few great fangs raking forward
    if (major) teeth.push(E([x, y + rr * 0.75, 0], [rr * 0.55, rr * 0.45, rr * 0.5], M.HORN));
    else teeth.push(Cap([x, y + rr * 0.5, 0], [x + rr * 0.45, y + rr * 0.5 + rr * (1.2 + 0.4 * (k & 1)), 0], rr * 0.30, 0.003, M.HORN));
  }
  // pale knobs in rows on the outer face and along the crest (the painting's rivets)
  const knobs = [];
  for (const [cy, cz, n0] of [[0.52, 0.2, 6], [0.22, 0.55, 5], [-0.12, 0.60, 4]]) {
    const n = major ? n0 : n0 - 1;
    for (let k = 0; k < n; k++) {
      const x = len * (0.16 + 0.70 * (k + 0.4 * rnd()) / n), kr = hgt * (0.040 + 0.02 * rnd());
      knobs.push({ t: 'sphere', c: [x, cy * hgt, out * cz * wid * 0.5], r: kr, m: M.HORN });
    }
  }
  let g = U(0.02, ...kids);
  g = U(0.008, g, ...teeth, ...knobs);
  // the hinge socket the dactyl seats in
  g = Sub(0.015, g, E(H.hinge, [0.06, 0.05, wid * 0.28], M.MEMB));
  return {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.004, f: 9, oct: 3, seed: seed + 1 },
      { type: 'pits', amp: 0.004, f: 16, dens: 0.15, r: 0.3, seed: seed + 7 },
      { type: 'barn', bake: true, amp: 0.006, f: 24, dens: 0.16, seed: seed + 5, mask: [['n', 4, 0.55, 0.72, seed + 6]] },
      { type: 'pits', bake: true, amp: 0.003, f: 50, dens: 0.35, r: 0.25, seed: seed + 2 },
      { type: 'grain', bake: true, amp: 0.0015, f: 110, seed: seed + 3 },
      { type: 'cracks', bake: true, amp: 0.002, f: 7, w: 0.035, heal: 0.8, seed: seed + 4 }
    ], ch: [g]
  };
}
// The moving finger, from its hinge along +X: a flattened blade curving DOWN over the
// pollex to a hard terminal hook. Crusher: short, heavy, molars on its biting edge.
// Cutter: long, slender, three raking fangs. Pale knobs down its back.
function dactylSpec(kind, seed) {
  const rnd = mulberry(seed), major = kind === 'major';
  const len = major ? 0.52 : 0.66, r0 = major ? 0.10 : 0.078;
  const P = major ? [[-0.02, 0, 0], [len * 0.45, 0.02, 0], [len * 0.85, -0.05, 0], [len, -0.16, 0]]
    : [[-0.02, 0, 0], [len * 0.50, 0.015, 0], [len * 0.88, -0.05, 0], [len, -0.20, 0]];
  const bez = t => { const u = 1 - t; return [0, 1].map(i => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]); };
  const blade = I(0.01, Tube(P, r0, 0.005, 16, M.PLATE), Pl([0, 0, 1], r0 * 0.66, M.PLATE), Pl([0, 0, -1], r0 * 0.66, M.PLATE));
  const kids = [blade, E([0.02, 0, 0], [0.07, r0 * 1.05, r0 * 0.8], M.CHITIN)];
  // a keel down the back of the finger
  kids.push(Tube([[0.02, r0 * 0.92, 0], [len * 0.45, r0 * 0.62 + 0.02, 0], [len * 0.82, r0 * 0.2 - 0.03, 0]], 0.009, 0.004, 10, M.PLATE));
  const teeth = [];
  const nT = major ? 4 : 3;
  for (let k = 0; k < nT; k++) {
    const t = 0.14 + 0.56 * k / (nT - 1), [x, y] = bez(t), rr = r0 * (1 - 0.8 * t) + 0.008;
    if (major) teeth.push(E([x, y - rr * 0.75, 0], [rr * 0.55, rr * 0.45, rr * 0.5], M.HORN));
    else teeth.push(Cap([x, y - rr * 0.5, 0], [x + rr * 0.5, y - rr * 0.5 - rr * (1.4 + 0.3 * k), 0], rr * 0.32, 0.003, M.HORN));
  }
  for (let k = 0; k < (major ? 3 : 4); k++) {
    const t = 0.12 + 0.18 * k, [x, y] = bez(t), rr = r0 * (1 - 0.8 * t);
    teeth.push({ t: 'sphere', c: [x, y + rr * 0.85, 0], r: r0 * (0.14 + 0.04 * rnd()), m: M.HORN });
  }
  return {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.003, f: 12, oct: 3, seed: seed + 1 },
      { type: 'pits', bake: true, amp: 0.003, f: 50, dens: 0.3, r: 0.25, seed: seed + 2 },
      { type: 'grain', bake: true, amp: 0.0012, f: 120, seed: seed + 3 }
    ], ch: [U(0.008, U(0.03, ...kids), ...teeth)]
  };
}

// A stalked compound eye: the stalk pivots at the origin (the orbit) and points along +Z;
// a ringed peduncle, a collar, and the corneal bulb (black, glassy, faceted) at the tip.
export const STALK_L = 0.12;
function eyestalkSpec() {
  const L = STALK_L;
  const kids = [
    Cap([0, 0, -0.01], [0, 0.004, L * 0.45], 0.024, 0.019, M.CHITIN),
    Cap([0, 0.004, L * 0.45], [0, 0.002, L * 0.82], 0.019, 0.021, M.CHITIN),
    { t: 'torus', c: [0, 0.004, L * 0.45], R: 0.019, r: 0.004, m: M.HORN, e: [Math.PI / 2, 0, 0] },
    E([0, 0.003, L * 0.86], [0.030, 0.028, 0.022], M.CHITIN),
    E([0, 0.006, L * 1.0], [0.033, 0.031, 0.028], M.EYE)
  ];
  return {
    t: 'disp', L: [
      { type: 'bands', amp: 0.0012, f: 300, ax: [0, 0, 1], mask: [['ax', 2, 0.02, 0.05], ['ax', 2, 0.10, 0.07]] },
      { type: 'pits', bake: true, amp: 0.0008, f: 520, dens: 1.0, r: 0.42, seed: 91, mask: [['ax', 2, L * 0.9, L * 0.96]] },   // ommatidia
      { type: 'grain', bake: true, amp: 0.0006, f: 200, seed: 92 }
    ], ch: [U(0.012, ...kids)]
  };
}
// A mouthpart (third maxilliped palp): hinged at the origin, along +X, hooking down, a comb
// of setae on the lower edge and a saw of small teeth.
export const MOUTH_L = 0.16;
function mouthSpec() {
  const L = MOUTH_L, P = [[-0.01, 0, 0], [L * 0.5, -0.012, 0], [L, -0.35 * L, 0]];
  const kids = [Tube(P, 0.026, 0.004, 12, M.CHITIN)];
  for (let k = 0; k < 9; k++) {
    const t = 0.1 + 0.8 * k / 8, x = L * t, y = -0.35 * L * t * t, r = 0.026 * (1 - 0.8 * t);
    kids.push(Cap([x, y - r * 0.7, 0], [x - 0.004, y - r - 0.018 - 0.01 * Math.sin(k * 2.3), (k % 3 - 1) * 0.006], 0.0035, 0.0012, M.MEMB));
  }
  return { t: 'disp', L: [{ type: 'grain', bake: true, amp: 0.0006, f: 200, seed: 93 }], ch: [U(0.006, ...kids)] };
}

// ---- limb paint: grey-teal chitin (near-black on the walking legs), pale membranes,
// pale knobs, fingers running to rust and dark horn at the points, a black glassy cornea
export function limbPaint(opts = {}) {
  const { legs = false, finger = false, eye = false, L = 1 } = opts;
  const layers = [
    { c: [0.72, 0.71, 0.64], a: 0.8, ro: 0.55, m: [['mat', M.HORN], ['cvx', 0.4, 1.4]] },                       // bleached knobs
    { c: [0.23, 0.38, 0.40], a: 0.4, ro: 0.4, m: [['n', 14, 0.5, 0.75, 41], ['mat', M.CHITIN]] },               // teal patches
    { c: [0.75, 0.76, 0.70], a: 0.45, m: [['n', 60, 0.72, 0.8, 42], ['mat', M.CHITIN]] },                        // pale flecks
    { c: [0.44, 0.22, 0.09], a: 0.55, ro: 0.7, m: [['cav', 0.1, 0.6]] },                                         // rust in the joints
    { c: [0.46, 0.43, 0.36], a: 0.6, ro: 0.9, m: [['cav', 0.2, 0.8], ['nd', [0, 1, 0], 0.3, 0.8]] },             // silt
    { c: [0.05, 0.05, 0.05], a: 0.8, m: [['ao', 0.55, 0.95]] }
  ];
  if (finger) layers.unshift(
    { c: [0.58, 0.27, 0.09], a: 0.9, ro: 0.55, m: [['ax', 0, 0.05 * L, 0.35 * L]] },                             // rust along the finger
    { c: [0.14, 0.09, 0.06], a: 0.9, ro: 0.3, m: [['ax', 0, 0.72 * L, 0.98 * L]] }                               // dark horn tips
  );
  return {
    kScale: 0.012, aoAlb: 0.5,
    mats: {
      [M.CHITIN]: { c: legs ? [0.085, 0.09, 0.09] : [0.22, 0.29, 0.29], ro: 0.38 },
      [M.PLATE]: { c: [0.40, 0.44, 0.42], ro: 0.4 },
      [M.MEMB]: { c: [0.62, 0.55, 0.50], ro: 0.8 },
      [M.HORN]: { c: legs ? [0.24, 0.22, 0.20] : [0.60, 0.59, 0.52], ro: 0.45 },
      [M.EYE]: { c: [0.015, 0.016, 0.016], ro: 0.06 }
    },
    layers: eye ? [layers[0], layers[5]] : layers
  };
}

// ---- the offline pipeline (tools/blender) ------------------------------------------------
// Pieces are baked high-to-low in Blender into two texture sets: 'body' (the fused shell,
// 2048) and 'limbs' (legs, claws, eyes, mouthparts, one shared 2048 atlas).
export function pipeline() {
  const limb = (name, sdf, h, tris, paint, extra = {}) => ({ name, set: 'limbs', sdf, hi: { h }, lo: { h: h * 2.2, tris }, paint, kEps: 0.006, ao: { r: 0.03, n: 4 }, cage: h * 4, ray: h * 10, ...extra });
  const legP = limbPaint({ legs: true });
  return {
    name: 'brooder', out: 'assets/sleepers/brooder',
    sets: { body: { size: 2048, gutter: 6, aoDist: 0.10, aoSamples: 64 }, limbs: { size: 2048, gutter: 6, aoDist: 0.05, aoSamples: 64 } },
    pieces: [
      { name: 'body', set: 'body', sdf: bodySpec(), hi: { h: 0.004 }, lo: { h: 0.009, tris: 70000 }, paint: PAINT, kEps: 0.012, ao: { r: 0.07, n: 4 }, cage: 0.02, ray: 0.05 },
      limb('leg_coxa', legSegSpec({ L: SEG_L.coxa, r0: 0.125, r1: 0.118, seed: 101 }), 0.0022, 2500, legP),
      limb('leg_femur', legSegSpec({ L: SEG_L.femur, r0: 0.122, r1: 0.092, spines: 4, vspines: 0, seed: 102 }), 0.0022, 5000, legP),
      limb('leg_tibia', legSegSpec({ L: SEG_L.tibia, r0: 0.090, r1: 0.062, spines: 3, vspines: 0, seed: 103 }), 0.002, 4000, legP),
      limb('leg_dactyl', legSegSpec({ L: SEG_L.dactyl, r0: 0.060, r1: 0, tip: true, curl: 0.16, seed: 104 }), 0.0018, 2000, limbPaint({ legs: true, finger: true, L: SEG_L.dactyl })),
      limb('major_merus', armSegSpec({ L: 0.40, r0: 0.130, r1: 0.118, x0: -0.35, knobs: 5, spines: 3, seed: 201, out: -1 }), 0.0025, 6000, limbPaint()),
      limb('major_carpus', armSegSpec({ L: 0.24, r0: 0.118, r1: 0.128, x0: -0.07, knobs: 2, spines: 1, seed: 202, out: -1 }), 0.0025, 4000, limbPaint()),
      limb('major_palm', palmSpec('major', 203), 0.0028, 9000, limbPaint()),
      limb('major_dactyl', dactylSpec('major', 204), 0.0022, 5000, limbPaint({ finger: true, L: 0.52 })),
      limb('minor_merus', armSegSpec({ L: 0.40, r0: 0.120, r1: 0.108, x0: -0.35, knobs: 4, spines: 3, seed: 301 }), 0.0025, 5000, limbPaint()),
      limb('minor_carpus', armSegSpec({ L: 0.24, r0: 0.108, r1: 0.112, x0: -0.07, knobs: 2, spines: 2, seed: 302 }), 0.0025, 3500, limbPaint()),
      limb('minor_palm', palmSpec('minor', 303), 0.0026, 8000, limbPaint()),
      limb('minor_dactyl', dactylSpec('minor', 304), 0.002, 5000, limbPaint({ finger: true, L: 0.66 })),
      limb('eyestalk', eyestalkSpec(), 0.0009, 3000, limbPaint({ eye: true }), { kEps: 0.003, ao: { r: 0.015, n: 4 } }),
      limb('mouthpart', mouthSpec(), 0.0009, 1500, limbPaint({ finger: true, L: MOUTH_L }), { kEps: 0.003, ao: { r: 0.012, n: 4 } })
    ],
    meta: { segL: SEG_L, hand: HAND, stalkL: STALK_L, mouthL: MOUTH_L, eyestalk: EYESTALK, ocelli: OCELLI },
    probes: [{ name: 'top', part: 'body', x0: -1.1, x1: 1.1, z0: -1.0, z1: 1.1, n: 64 }]
  };
}

// Look-dev preview for sculptlab.html (?job=./src/entities/sleeper/brooderSculpt.js#preview
// &p=name1,name2): the pipeline's pieces through the in-browser runJob at preview density
// (seconds, not the Blender round trip). Form and paint only; the shipped maps come from
// the Cycles bake.
export function preview() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const want = (q.get('p') || 'body').split(','), k = +(q.get('k') || 2);
  const P = pipeline(), parts = P.pieces.filter(p => want.includes(p.name));
  return {
    key: 'preview-' + want.join('-') + '-' + k + '-' + Math.random(),
    parts: parts.map(p => ({ name: p.name, sdf: p.sdf, h: p.hi.h * k, tris: p.lo.tris, err: p.lo.h })),
    atlas: { size: +(q.get('s') || 512), paint: parts[0].paint, kEps: parts[0].kEps, ao: parts[0].ao },
    layout: parts.length === 1 ? { [parts[0].name]: [0, 0, 0] } : undefined
  };
}
