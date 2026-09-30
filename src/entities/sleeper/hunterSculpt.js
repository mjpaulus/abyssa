// MHOR, THE HUNTER — the sculpt (lib/sculpt.js specs + tileable arm/tentacle strips). Pure
// data builders: no THREE, no scene.
//
// THE SPLIT (hunter.js's header has the why): the MANTLE is one rigid sculpt the jet moves
// in the vertex shader (the contraction scales xy by a function of z, which works on any
// mesh in this frame); the FIN is a rigid sculpt the undulation moves in the vertex shader
// (its wave coordinates come from its position, see hunter.js); the tentacle CLUB is rigid,
// riding the chain's tip; ONE sucker is instanced 224x. The eight arms and two tentacles
// are verlet chains rebuilt every frame and get TILEABLE STRIPS (strip.mjs) — the arm's
// keyed to its sucker stations, the tentacle's conformal (u runs with 1/r, so the texel
// stays square as it tapers).
//
// Frame (hunter.js): the mantle along +Z, 0 at the head end, 1 at the tail tip; unit =
// mantle length (ML = 36 u at size 10). Anchors kept: prof(s) (the old lathe's radius, so
// the wards, the glow stations and the collision spine still sit on the skin), EYE_L, the
// arm crown at z ~0.02, the fins' root span z 0.62..0.99 on +-X.
//
// The design: a lean abyssal HUNTER, armoured. The barrel is sheathed in overlapping bands
// of tough hide (a squid made for ramming), a gladius ridge down the back and a blade KEEL
// down the belly; the fins are ribbed; the eyes are huge and dark in heavy orbits, each
// ringed with small photophores; rows of lensed photophores run down the belly and flanks.
// He has fought something BIGGER: ring scars (sucker marks the size of a hand) across his
// flanks and three long rake gouges down the left side.
import { compile, mulberry } from '../../lib/sculpt.js';
import { tnoise } from '../../../tools/blender/strip.mjs';

const TAU = Math.PI * 2;
const E = (c, r, m = 0, e) => ({ t: 'ellip', c, r, m, e });
const Sph = (c, r, m = 0) => ({ t: 'sphere', c, r, m });
const Cap = (a, b, ra, rb = ra, m = 0) => ({ t: 'cap', a, b, ra, rb, m });
const Cone = (a, b, ra, rb, m = 0) => ({ t: 'cone', a, b, ra, rb, m });
const U = (k, ...ch) => ({ t: 'u', k, ch });
const Sub = (k, a, ...b) => ({ t: 's', k, ch: [a, ...b] });
const SubM = (k, m, a, ...b) => ({ t: 's', k, m, ch: [a, ...b] });
const I = (k, ...ch) => ({ t: 'i', k, ch });
const Tube = (p, r0, r1, n = 10, m = 0, rr) => ({ t: 'tube', p, r: [r0, r1], n, m, rr });
const Pl = (n, o, m = 0) => ({ t: 'plane', n, o, m });
const Tor = (c, R, r, m, rot) => ({ t: 'torus', c, R, r, m, rot });
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function yTo(up) {
  const Y = norm(up), X = norm(Math.abs(Y[0]) < 0.9 ? cross(Y, [1, 0, 0]) : cross(Y, [0, 0, 1])), Z = cross(X, Y);
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
}
function basis(X, up) { X = norm(X); const Z = norm(cross(X, up)), Y = cross(Z, X); return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]]; }

export const M = { HIDE: 0, BELLY: 1, PLATE: 2, SCAR: 3, EYE: 4, LENS: 5, HORN: 6, MEMB: 7, KEEL: 8 };
// the old lathe's radius (hunter.js prof): the skin every station was placed on
export const prof = s => {
  const head = 0.075 * Math.exp(-Math.pow((s - 0.06) / 0.07, 2));
  const barrel = 0.095 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05 + 0.02)), 0.55);
  return Math.max(0.004, Math.max(head, barrel) * (1 - 0.85 * sst(0.70, 1.0, s)) + 0.004);
};
export const EYE_L = [0.062, 0.015, 0.075];
const at = (a, s, k = 1) => { const r = prof(s) * k; return [Math.cos(a) * r * 1.04, Math.sin(a) * r, s]; };

// ---- photophore stations -------------------------------------------------------------------
// The 24 GLOW stations hunter.js draws its additive points at (flank rows + ventral), each a
// big lens; the belly's three rows of small lenses; the ring round each eye.
export function stations() {
  const S = [];
  for (let k = 0; k < 24; k++) {
    let a, s;
    if (k < 20) { const side = k < 10 ? 0 : Math.PI, row = (k % 10) < 5 ? 0.22 : -0.22; a = side + (side ? -row : row); s = 0.18 + 0.13 * (k % 5) + (row > 0 ? 0 : 0.06); }
    else { a = -Math.PI / 2 + ((k - 20) - 1.5) * 0.35; s = 0.30 + 0.09 * (k - 20); }
    S.push({ p: at(a, s, 0.985), r: 0.0062 });
  }
  for (const a of [-Math.PI / 2 - 0.42, -Math.PI / 2, -Math.PI / 2 + 0.42]) for (let s = 0.16; s < 0.86; s += 0.036) {
    const off = a === -Math.PI / 2 ? 0.018 : 0;
    S.push({ p: at(a, s + off, 0.985), r: 0.0032 });
  }
  for (const sd of [1, -1]) {
    const c = [sd * EYE_L[0], EYE_L[1], EYE_L[2]];
    for (let k = 0; k < 14; k++) {
      const th = k / 14 * TAU, R = 0.056;
      S.push({ p: [c[0] + sd * 0.006, c[1] + Math.sin(th) * R, c[2] + Math.cos(th) * R], r: 0.0026 });
    }
  }
  return S;
}
const ST = stations();
// nearest station distance in lens radii (for the emit and the lens paint)
function lensD(x, y, z) {
  let best = 9;
  for (const q of ST) { const d = Math.hypot(x - q.p[0], y - q.p[1], z - q.p[2]) / q.r; if (d < best) best = d; }
  return best;
}

// ---- the mantle -----------------------------------------------------------------------------
function mantleSpec() {
  // the barrel as a chain of round cones on the lathe's profile, and the head bulb
  const n = 40, rr = [];
  for (let i = 0; i <= n; i++) rr.push(prof(0.11 + 0.89 * i / n));
  let body = U(0.03, Tube([[0, 0, 0.11], [0, 0, 0.55], [0, 0, 1.0]], 0, 0, n, M.HIDE, rr),
    E([0, 0.004, 0.064], [0.074, 0.070, 0.070], M.HIDE));
  // ARMOUR: overlapping bands of hide down the barrel, each flaring a little at its rear
  // edge over the next (dorsal two-thirds; the belly stays smooth for the keel and lenses)
  const bands = [];
  for (let k = 0; k < 15; k++) {
    const s0 = 0.18 + k * 0.042, s1 = s0 + 0.046, r0 = prof(s0), r1 = prof(s1);
    bands.push(I(0.004, Cone([0, 0, s0], [0, 0, s1], r0 * 0.985, r1 * 1.03 + 0.0012, M.PLATE), Pl([0, -1, 0], r1 * 0.35, M.PLATE)));
  }
  body = U(0.004, body, ...bands);
  // the gladius ridge down the back, and the KEEL: a blade down the belly
  const gl = [], keel = [];
  for (let i = 0; i < 20; i++) {
    const s0 = 0.14 + i * 0.041, s1 = s0 + 0.041;
    gl.push(Cap([0, prof(s0) * 0.99, s0], [0, prof(s1) * 0.99, s1], 0.0035, 0.0035, M.PLATE));
    if (s0 > 0.22 && s1 < 0.97) {
      const h0 = 0.012 * Math.sin(Math.PI * (s0 - 0.22) / 0.75), h1 = 0.012 * Math.sin(Math.PI * (s1 - 0.22) / 0.75);
      keel.push(I(0.001, Cap([0, -prof(s0) - h0 * 0.5, s0], [0, -prof(s1) - h1 * 0.5, s1], 0.004 + h0 * 0.6, 0.004 + h1 * 0.6, M.KEEL), Pl([1, 0, 0], 0.0022, M.KEEL), Pl([-1, 0, 0], 0.0022, M.KEEL)));
    }
  }
  body = U(0.004, body, ...gl);
  body = U(0.006, body, ...keel);
  // the mantle margin: a collar where the barrel overlaps the head
  body = U(0.006, body, Tor([0, 0, 0.118], prof(0.118) * 1.0, 0.0045, M.PLATE, yTo([0, 0, 1])));
  // the funnel (siphon) under the head, pointing forward
  const fun = SubM(0.004, M.MEMB, U(0.006, Tube([[0, -0.052, 0.13], [0, -0.066, 0.08], [0, -0.064, 0.035]], 0.018, 0.012, 10, M.BELLY)),
    Tube([[0, -0.060, 0.10], [0, -0.066, 0.06], [0, -0.064, 0.02]], 0.008, 0.009, 8, M.MEMB));
  body = U(0.01, body, fun);
  // eyes: heavy orbits, a socket each (the eyeball is its own mesh)
  const orb = [], sock = [];
  for (const sd of [1, -1]) {
    const c = [sd * EYE_L[0], EYE_L[1], EYE_L[2]];
    orb.push(Tor([c[0] - sd * 0.004, c[1], c[2]], 0.050, 0.0085, M.HIDE, yTo([sd, 0, 0])));
    orb.push(Tube([[c[0] - sd * 0.008, c[1] + 0.052, c[2] + 0.04], [c[0] + sd * 0.004, c[1] + 0.066, c[2]], [c[0] - sd * 0.008, c[1] + 0.05, c[2] - 0.045]], 0.008, 0.006, 10, M.PLATE));   // the brow
    sock.push(Cap(c, [c[0] + sd * 0.06, c[1], c[2]], 0.047, 0.05, M.EYE));
  }
  body = U(0.008, body, ...orb);
  body = SubM(0.006, M.EYE, body, ...sock);
  // lenses: the photophores stand as low domes in the hide
  const lenses = ST.map(q => Sph(q.p, q.r, M.LENS));
  body = U(0.0015, body, ...lenses);
  // SCARS: ring scars (a groove round a raised healed centre) and three long rakes
  const rnd = mulberry(0x5CA2), rings = [], rakes = [];
  for (let k = 0; k < 11; k++) {
    const a = (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 1.4, s = 0.25 + 0.55 * rnd(), p = at(a, s, 1.0), R = 0.008 + 0.01 * rnd();
    const nrm = norm([Math.cos(a), Math.sin(a), 0]);
    rings.push(Tor(p, R, 0.0022, M.SCAR, yTo(nrm)));
  }
  for (let i = 0; i < 3; i++) {
    const a0 = Math.PI - 0.1 - i * 0.22;
    const P = [at(a0, 0.30 + i * 0.03, 1.02), at(a0 - 0.12, 0.50 + i * 0.02, 1.02), at(a0 - 0.08, 0.72, 1.02)];
    rakes.push(Tube(P, 0.0045, 0.0015, 14, M.SCAR));
  }
  body = SubM(0.003, M.SCAR, body, ...rings, ...rakes);
  const bar = ['ax', 2, 0.14, 0.2];
  return {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.0012, f: 30, oct: 3, seed: 21 },
      { type: 'cracks', amp: 0.0012, f: 45, w: 0.06, heal: 0.8, seed: 22, mask: [bar, ['ax', 1, -0.02, 0.03]] },          // scute tessellation on the armour
      { type: 'cracks', bake: true, amp: 0.0006, f: 110, w: 0.05, heal: 0.6, seed: 23, mask: [['ax', 1, -0.03, 0.02]] },
      { type: 'pits', bake: true, amp: 0.0005, f: 260, dens: 0.35, r: 0.28, seed: 24 },
      { type: 'grain', bake: true, amp: 0.00025, f: 700, seed: 25 }
    ], ch: [body]
  };
}
const lensMask = S => 1 - sst(0.7, 1.05, lensD(S.x, S.y, S.z));
export const mantleEmit = S => { const d = lensD(S.x, S.y, S.z); return Math.min(1, (1 - sst(0.0, 0.6, d)) + 0.3 * Math.exp(-(d / 1.8) * (d / 1.8))); };

// furnace-red hide darkening to the back, the armour bands' edges darker and worn paler at
// their crowns, a pale pink belly, pearl lenses, ivory scars, a near-black orbit
export const PAINT = {
  kScale: 0.004, aoAlb: 0.6,
  mats: {
    [M.HIDE]: { c: [0.40, 0.10, 0.06], ro: 0.40 },
    [M.BELLY]: { c: [0.60, 0.30, 0.24], ro: 0.45 },
    [M.PLATE]: { c: [0.30, 0.07, 0.05], ro: 0.35 },
    [M.SCAR]: { c: [0.66, 0.52, 0.44], ro: 0.6 },
    [M.EYE]: { c: [0.03, 0.02, 0.02], ro: 0.2 },
    [M.LENS]: { c: [0.62, 0.56, 0.50], ro: 0.12 },
    [M.HORN]: { c: [0.10, 0.07, 0.05], ro: 0.3 },
    [M.MEMB]: { c: [0.20, 0.05, 0.05], ro: 0.4 },
    [M.KEEL]: { c: [0.22, 0.05, 0.04], ro: 0.35 }
  },
  layers: [
    { c: [0.18, 0.04, 0.04], a: 0.75, m: [['nd', [0, 1, 0], 0.1, 0.8], ['inv', ['mat', M.LENS]], ['inv', ['mat', M.SCAR]]] },                  // dark back
    { c: [0.62, 0.32, 0.26], a: 0.8, m: [['nd', [0, -1, 0], 0.3, 0.85], ['inv', ['mat', M.LENS]], ['inv', ['mat', M.KEEL]], ['inv', ['mat', M.SCAR]]] },   // pale belly
    { c: [0.52, 0.17, 0.06], a: 0.5, m: [['n', 40, 0.55, 0.72, 31], ['inv', ['mat', M.LENS]]] },                                                  // chromatophore mottle
    { c: [0.10, 0.02, 0.02], a: 0.6, m: [['cav', 0.2, 0.8]] },                                                                                     // the bands' dark seams
    { c: [0.58, 0.28, 0.18], a: 0.6, ro: 0.5, m: [['cvx', 0.4, 1.4], ['mat', M.PLATE]] },                                                           // worn crowns of the armour
    { c: [0.72, 0.62, 0.55], a: 0.6, m: [['mat', M.SCAR], ['cvx', 0.2, 1.0]] },
    { c: [0.56, 0.48, 0.44], a: 0.6, ro: 0.1, m: [['fn', lensMask]] },
    { c: [0.03, 0.01, 0.01], a: 0.85, m: [['ao', 0.55, 0.95]] }
  ]
};

// ---- the fin (+X side; hunter.js mirrors it for -X) --------------------------------------------
// The old outline (a quadratic from the root at 0.62 out to the tip at 0.97, back in at 0.99):
// a thick muscular root thinning to a translucent membrane, RIBBED (raised radial rays sweeping
// back), its trailing edge torn in two places.
export function finWidth(z) {
  const Q = [];
  for (let k = 0; k <= 64; k++) { const t = k / 64, m = 1 - t; Q.push([2 * m * t * 0.14 + t * t * 0.10, m * m * 0.62 + 2 * m * t * 0.80 + t * t * 0.97]); }
  if (z >= 0.97) return 0.10 * Math.max(0, 0.99 - z) / 0.02;
  for (let k = 1; k < Q.length; k++) if (Q[k][1] >= z) { const f = (z - Q[k - 1][1]) / (Q[k][1] - Q[k - 1][1]); return Q[k - 1][0] + (Q[k][0] - Q[k - 1][0]) * f; }
  return 0;
}
function finSpec() {
  // the outline as a stack of slabs (each z slice a box to its width), thickness tapering out
  const kids = [];
  const N = 30;
  for (let i = 0; i < N; i++) {
    const z0 = 0.62 + 0.37 * i / N, z1 = 0.62 + 0.37 * (i + 1) / N, zc = (z0 + z1) / 2, w = Math.max(0.003, finWidth(zc));
    kids.push({ t: 'box', c: [w / 2, 0, zc], h: [w / 2, 0.0014, (z1 - z0) / 2 + 0.0015], r: 0.001, m: M.MEMB });
  }
  let fin = U(0.004, ...kids);
  // thicker at the root (the muscle), a rounded free edge
  fin = U(0.006, fin, Cap([0.0, 0, 0.63], [0.0, 0, 0.985], 0.009, 0.004, M.HIDE));
  // RIBS: raised rays from the root, sweeping back toward the tail
  const ribs = [];
  for (let k = 0; k < 13; k++) {
    const z = 0.64 + k * 0.026, w = finWidth(Math.min(0.98, z + 0.03));
    if (w < 0.01) continue;
    for (const sy of [1, -1]) ribs.push(Tube([[0.004, 0, z], [w * 0.5, sy * 0.0012, z + 0.03], [w * 0.92, 0, z + 0.05]], 0.0018, 0.0006, 8, M.KEEL));
  }
  fin = U(0.002, fin, ...ribs);
  // torn: two bites out of the trailing edge
  fin = SubM(0.002, M.SCAR, fin, E([finWidth(0.83) + 0.004, 0, 0.845], [0.022, 0.02, 0.012], M.SCAR), E([finWidth(0.92) + 0.002, 0, 0.93], [0.014, 0.02, 0.008], M.SCAR));
  return {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.0004, f: 60, oct: 2, seed: 41, mask: [['ax', 0, 0.02, 0.06]] },
      { type: 'bands', bake: true, amp: 0.00025, f: 700, ax: [0.4, 0, 1] },
      { type: 'grain', bake: true, amp: 0.0002, f: 900, seed: 42 }
    ], ch: [fin]
  };
}
export const FIN_PAINT = {
  kScale: 0.002, aoAlb: 0.4,
  mats: {
    [M.MEMB]: { c: [0.46, 0.14, 0.09], ro: 0.42 },
    [M.HIDE]: { c: [0.30, 0.07, 0.05], ro: 0.4 },
    [M.KEEL]: { c: [0.20, 0.05, 0.035], ro: 0.4 },
    [M.SCAR]: { c: [0.56, 0.36, 0.30], ro: 0.5 }
  },
  layers: [
    { c: [0.58, 0.24, 0.16], a: 0.6, m: [['ax', 0, 0.04, 0.12], ['mat', M.MEMB]] },     // the thin edge paler
    { c: [0.14, 0.03, 0.03], a: 0.5, m: [['cav', 0.2, 0.8]] }
  ]
};

// ---- the tentacle club (unit: half-length 1 along +Z, dorsal +Y, the palm on -Y) ----------------
// The manus: a flattened spindle; a dorsal swimming KEEL; down the palm two rows of SWIVEL
// HOOKS (each a claw on a swollen socket, curved back toward the stalk, some three-pointed,
// as the colossal squid carries them), toothed suckers at the margins.
function clubSpec() {
  let club = E([0, 0, 0], [0.36, 0.18, 1.0], M.HIDE);
  club = U(0.1, club, Cap([0, 0, -1.2], [0, 0, -0.6], 0.12, 0.2, M.HIDE));          // into the stalk
  // the keel: a thin crest along the back
  club = U(0.03, club, I(0.01, E([0, 0.16, 0.05], [0.03, 0.14, 0.8], M.KEEL), Pl([0, -1, 0], -0.12, M.KEEL)));
  const hooks = [], cups = [];
  const rnd = mulberry(0xC1B);
  for (let k = 0; k < 16; k++) {
    const row = k & 1, z = -0.72 + 1.3 * (k >> 1) / 7, x = (row ? 0.10 : -0.10) + (rnd() - 0.5) * 0.02;
    const surfY = -0.18 * Math.sqrt(Math.max(0, 1 - (x / 0.36) ** 2 - (z / 1.0) ** 2));
    const sc = 0.8 + 0.4 * Math.sin(Math.PI * (z + 1) / 2);
    const base = [x, surfY - 0.01, z];
    hooks.push(E(base, [0.055 * sc, 0.04 * sc, 0.06 * sc], M.HORN));                  // the swivel socket
    // the claw: up out of the socket, curving back toward the stalk (-Z) to a point
    const tip = [x + (rnd() - 0.5) * 0.04, base[1] - 0.16 * sc, z - 0.12 * sc];
    hooks.push(Tube([base, [x, base[1] - 0.14 * sc, z + 0.02], tip], 0.028 * sc, 0.003, 10, M.HORN));
    if (rnd() < 0.3) {                                                                    // three-pointed
      for (const sd of [1, -1]) hooks.push(Tube([[x, base[1] - 0.04 * sc, z], [x + sd * 0.05 * sc, base[1] - 0.09 * sc, z - 0.02], [x + sd * 0.07 * sc, base[1] - 0.10 * sc, z - 0.07 * sc]], 0.012 * sc, 0.002, 8, M.HORN));
    }
  }
  for (let k = 0; k < 18; k++) {
    const sd = k < 9 ? 1 : -1, z = -0.8 + 1.6 * (k % 9) / 8, x = sd * 0.25;
    const surfY = -0.18 * Math.sqrt(Math.max(0, 1 - (x / 0.36) ** 2 - (z / 1.0) ** 2));
    cups.push([x, surfY, z]);
  }
  club = U(0.01, club, ...cups.map(p => Sph(p, 0.045, M.MEMB)));
  club = SubM(0.008, M.MEMB, club, ...cups.map(p => Sph([p[0], p[1] - 0.03, p[2]], 0.03, M.MEMB)));
  club = U(0.012, club, ...hooks);
  return {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.006, f: 6, oct: 3, seed: 51 },
      { type: 'pits', bake: true, amp: 0.004, f: 30, dens: 0.3, r: 0.3, seed: 52 },
      { type: 'grain', bake: true, amp: 0.002, f: 80, seed: 53 }
    ], ch: [club]
  };
}
export const CLUB_PAINT = {
  kScale: 0.01, aoAlb: 0.6,
  mats: {
    [M.HIDE]: { c: [0.38, 0.09, 0.06], ro: 0.4 },
    [M.KEEL]: { c: [0.26, 0.06, 0.04], ro: 0.4 },
    [M.HORN]: { c: [0.09, 0.06, 0.045], ro: 0.25 },
    [M.MEMB]: { c: [0.62, 0.40, 0.34], ro: 0.4 }
  },
  layers: [
    { c: [0.60, 0.34, 0.26], a: 0.7, m: [['nd', [0, -1, 0], 0.2, 0.8], ['mat', M.HIDE]] },
    { c: [0.36, 0.28, 0.18], a: 0.8, ro: 0.35, m: [['mat', M.HORN], ['cvx', 0.4, 1.4]] },     // worn hook crowns
    { c: [0.05, 0.02, 0.02], a: 0.8, m: [['ao', 0.5, 0.95]] }
  ]
};

// ---- the sucker (instanced on the arms): a stalked cup with a toothed chitin ring ---------------
function suckerSpec() {
  const stalk = Cone([0, -0.9, 0], [0, -0.2, 0], 0.30, 0.45, M.MEMB);
  const cup = E([0, 0.0, 0], [0.92, 0.42, 0.92], M.MEMB);
  let s = U(0.12, stalk, cup);
  s = SubM(0.04, M.LENS, s, E([0, 0.40, 0], [0.64, 0.42, 0.64], M.LENS));
  // the ring of teeth round the aperture
  const teeth = [Tor([0, 0.26, 0], 0.66, 0.06, M.HORN)];
  for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; teeth.push(Cap([Math.cos(a) * 0.66, 0.28, Math.sin(a) * 0.66], [Math.cos(a) * 0.52, 0.44, Math.sin(a) * 0.52], 0.05, 0.008, M.HORN)); }
  s = U(0.01, s, ...teeth);
  return { t: 'disp', L: [{ type: 'fbm', amp: 0.015, f: 3, oct: 2, seed: 61 }, { type: 'grain', bake: true, amp: 0.004, f: 30, seed: 62 }], ch: [s] };
}
export const SUCKER_PAINT = {
  kScale: 0.004, aoAlb: 0.5,
  mats: {
    [M.MEMB]: { c: [0.60, 0.36, 0.30], ro: 0.4 },
    [M.LENS]: { c: [0.42, 0.18, 0.16], ro: 0.25 },
    [M.HORN]: { c: [0.16, 0.10, 0.06], ro: 0.25 }
  },
  layers: [
    { c: [0.52, 0.42, 0.28], a: 0.7, m: [['mat', M.HORN], ['cvx', 0.5, 1.5]] },
    { c: [0.05, 0.02, 0.02], a: 0.8, m: [['ao', 0.5, 0.95]] }
  ]
};

// ---- STRIPS -----------------------------------------------------------------------------------
// ARM: one tile = ARM_PAIRS sucker pairs (hunter.js stations: t = (k >> 1 + 0.5 odd) / 14, so a
// tile of 7 is half the arm). v = 0 dorsal, 0.5 oral; odd suckers sit on v = 0.5 + SV, even on
// 0.5 - SV (hunter.js: odd rows ride +_sd = -F, i.e. sin a < 0). Units: the local arm radius.
export const ARM_PAIRS = 7, ARM_SV = 0.048, SUCK_K = 0.19;
function armStrip() {
  const N = tnoise(0x3A2), Lu = ARM_PAIRS * 1.7, Lv = 6.0;
  const suck = [];
  for (let k = 0; k < 2 * ARM_PAIRS; k++) suck.push([(k >> 1) / ARM_PAIRS + ((k & 1) ? 0.5 / ARM_PAIRS : 0), 0.5 + ((k & 1) ? ARM_SV : -ARM_SV)]);
  const wrapd = x => x - Math.round(x), cc = {}, cp = {};
  return {
    name: 'arm', W: 1024, H: 512, Lu, Lv, kScale: 0.02, ao: { r: 0.3, dirs: 8, steps: 6 },
    field(u, v, S) {
      const a = v * TAU, ca = Math.cos(a), oral = sst(-0.3, -0.75, ca), dors = sst(0.2, 0.8, ca);
      let col = 0;
      for (const [su, sv] of suck) {
        const du = wrapd(u - su) * Lu, dv = wrapd(v - sv) * Lv, d = Math.hypot(du, dv) / SUCK_K;
        if (d < 2.2) col += Math.exp(-(((d - 1.2) / 0.3) ** 2));
      }
      // armour on the dorsal face: transverse overlapping bands (sawtooth), scute cracks;
      // a dorsal ridge; the oral face smooth, finely creased
      const wu = u + (N.fbm(u, v, 3, 2, 3) - 0.5) * 0.03;
      const band = ((wu * ARM_PAIRS * 3) % 1 + 1) % 1, saw = sst(0.0, 0.85, band) - sst(0.85, 1.0, band);
      N.cells(wu, v, 42, 12, 0.9, 5, cc, Lv / Lu * 42 / 12);
      const crack = 1 - sst(0.0, 0.12, cc.f2 - cc.f1);
      const ridge = Math.exp(-(((wrapd(v) * Lv) / 0.1) ** 2));
      const crease = Math.pow(Math.abs(Math.sin((u * Lu * 7 + N.fbm(u, v, 4, 4, 2)) * Math.PI)), 4);
      N.cells(u, v, 20, 6, 0.6, 7, cp, Lv / Lu * 20 / 6);
      const ph = cp.id < 0.25 ? 1 - sst(0.12, 0.2, cp.f1) : 0;
      S.oral = oral; S.dors = dors; S.col = col; S.crack = crack * (1 - oral); S.saw = saw * (1 - oral); S.ph = ph * dors;
      S.h = 0.05 * (N.fbm(u, v, 3, 3, 4) - 0.5) + (1 - oral) * (0.035 * saw - 0.012 * crack) + 0.03 * ridge + oral * 0.008 * crease + 0.06 * col + 0.012 * S.ph;
    },
    paint(S) {
      const mot = sst(0.4, 0.7, N.fbm(S.u, S.v, 6, 4, 4));
      const c = [0.40 - 0.18 * mot, 0.10 - 0.05 * mot, 0.06 - 0.02 * mot];
      const pale = [0.62, 0.34, 0.28];
      for (let i = 0; i < 3; i++) {
        c[i] += (pale[i] - c[i]) * S.oral;
        c[i] *= 1 - 0.35 * S.crack;
        c[i] += ([0.55, 0.26, 0.16][i] - c[i]) * S.saw * 0.25;
        c[i] += ([0.70, 0.46, 0.40][i] - c[i]) * Math.min(1, S.col) * 0.6;
        c[i] += ([0.66, 0.60, 0.55][i] - c[i]) * S.ph * 0.7;
        c[i] *= 0.45 + 0.55 * S.ao;
      }
      S.c = c; S.ro = 0.36 + 0.1 * S.crack - 0.2 * S.ph; S.e = S.ph;
    }
  };
}
// TENTACLE: conformal (u advances with 1/r), a bare, tough stalk — a keel down one side, a
// scatter of photophores down its back (the lure of him), fine rings.
export const TENT_LU = 8;
function tentStrip() {
  const N = tnoise(0x7E7), Lu = TENT_LU, Lv = 6.0, cp = {};
  const wrapd = x => x - Math.round(x);
  return {
    name: 'tent', W: 1024, H: 512, Lu, Lv, kScale: 0.02, ao: { r: 0.3, dirs: 8, steps: 6 },
    field(u, v, S) {
      const a = v * TAU, ca = Math.cos(a), oral = sst(-0.3, -0.75, ca), dors = sst(0.2, 0.8, ca);
      const keel = Math.exp(-(((wrapd(v - 0.25) * Lv) / 0.12) ** 2));
      const rings = Math.pow(Math.abs(Math.sin((u * Lu * 3.2 + 0.6 * N.fbm(u, v, 3, 3, 2)) * Math.PI)), 6);
      N.cells(u, v, 12, 5, 0.7, 3, cp, Lv / Lu * 12 / 5);
      const ph = cp.id < 0.35 ? 1 - sst(0.1, 0.17, cp.f1) : 0;
      S.oral = oral; S.keel = keel; S.ph = ph * dors; S.rings = rings;
      S.h = 0.04 * (N.fbm(u, v, 4, 3, 4) - 0.5) + 0.05 * keel - 0.008 * rings + 0.012 * S.ph;
    },
    paint(S) {
      const mot = sst(0.4, 0.7, N.fbm(S.u, S.v, 5, 3, 4));
      const c = [0.42 - 0.16 * mot, 0.11 - 0.05 * mot, 0.07 - 0.02 * mot];
      for (let i = 0; i < 3; i++) {
        c[i] += ([0.60, 0.33, 0.27][i] - c[i]) * S.oral;
        c[i] *= 1 - 0.25 * S.rings - 0.2 * S.keel;
        c[i] += ([0.66, 0.60, 0.55][i] - c[i]) * S.ph * 0.7;
        c[i] *= 0.5 + 0.5 * S.ao;
      }
      S.c = c; S.ro = 0.36 - 0.2 * S.ph; S.e = S.ph;
    }
  };
}

// ---- the offline pipeline -----------------------------------------------------------------------
export function pipeline() {
  return {
    name: 'hunter', out: 'assets/sleepers/hunter',
    sets: { body: { size: 2048, gutter: 6, aoDist: 0.01, aoSamples: 64 }, limbs: { size: 1024, gutter: 6, aoDist: 0.08, aoSamples: 64 }, sucker: { size: 256, gutter: 4, aoDist: 0.3, aoSamples: 64 } },
    pieces: [
      { name: 'mantle', set: 'body', sdf: mantleSpec(), hi: { h: 0.0007 }, lo: { h: 0.0018, tris: 50000 }, paint: PAINT, kEps: 0.002, ao: { r: 0.008, n: 4 }, cage: 0.003, ray: 0.008, emit: mantleEmit },
      { name: 'fin', set: 'limbs', sdf: finSpec(), hi: { h: 0.0005 }, lo: { h: 0.0012, tris: 6000 }, paint: FIN_PAINT, kEps: 0.002, ao: { r: 0.006, n: 4 }, cage: 0.0015, ray: 0.004 },
      { name: 'club', set: 'limbs', sdf: clubSpec(), hi: { h: 0.008 }, lo: { h: 0.02, tris: 5000 }, paint: CLUB_PAINT, kEps: 0.02, ao: { r: 0.1, n: 4 }, cage: 0.03, ray: 0.08 },
      { name: 'sucker', set: 'sucker', sdf: suckerSpec(), hi: { h: 0.01 }, lo: { h: 0.04, tris: 300, err: 0.1 }, paint: SUCKER_PAINT, kEps: 0.03, ao: { r: 0.2, n: 4 }, cage: 0.05, ray: 0.14 }
    ],
    strips: [armStrip(), tentStrip()],
    meta: { armPairs: ARM_PAIRS, armSV: ARM_SV, suckK: SUCK_K, tentLu: TENT_LU }
  };
}

export function preview() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const want = (q.get('p') || 'mantle').split(','), k = +(q.get('k') || 3);
  const P = pipeline(), parts = P.pieces.filter(p => want.includes(p.name));
  return {
    key: 'preview-' + want.join('-') + '-' + k + '-' + Math.random(),
    parts: parts.map(p => ({ name: p.name, sdf: p.sdf, h: p.hi.h * k, tris: p.lo.tris, err: p.lo.h })),
    atlas: { size: +(q.get('s') || 512), paint: parts[0].paint, kEps: parts[0].kEps, ao: parts[0].ao },
    layout: parts.length === 1 ? { [parts[0].name]: [0, 0, 0] } : undefined
  };
}
