// THE DEN OCTOPUS and THE SQUID — their bodies sculpted (fauna2). `node tools/blender/build.mjs octo`
// bakes them into assets/fauna/octo/. The ARMS stay procedural: predators.js generates every
// arm in the vertex shader from per-vertex (T, angle, ring) — reach, curl, grab, the verlet-
// free liquid lag are all there, and a sculpt cannot carry them. What the sculpt replaces is
// the body those arms leave from: the octopus's egg of a mantle, the squid's lathe.
//
// Frames are predators.js's `position` spaces BEFORE its vertex shader moves them:
//   octopus: the mantle as octopusGeometry lays it (y -0.30 underside .. 0.72 crown, x 1.06,
//            z 0.90 of the profile), eyes on the +-x knobs at v 0.42, the arm crown at
//            radius 0.24, y 0.14. The shader still flattens/rouses/jets it.
//   squid:   the mantle along +z (tail -0.5 .. collar 0.18), head to z 0.30, fins on +-x.
// The albedo is a NEUTRAL luminance pattern: the animal's colour is live (chromatophores,
// the flush, the alarm blanch, the zone palette) and is multiplied in by the shader.
//
// Reference: Octopus vulgaris / O. cyanea (a mantle sac behind the head, raised eye turrets
// with supraocular papillae "horns", warty papillae, skin ridges, the siphon, the web at the
// arm crown); a loliginid / ommastrephid squid (a long muscular mantle with a dorsal
// gladius ridge, rhomboid terminal fins, a collar, big eyes, a ventral funnel).
const TAU = Math.PI * 2;
const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const E = (c, r, m = 0, e) => ({ t: 'ellip', c, r, m, e });
const Sph = (c, r, m = 0) => ({ t: 'sphere', c, r, m });
const Cap = (a, b, ra, rb = ra, m = 0) => ({ t: 'cap', a, b, ra, rb, m });
const U = (k, ...ch) => ({ t: 'u', k, ch });
const Sub = (k, m, a, ...b) => ({ t: 's', k, m, ch: [a, ...b] });
const Mir = (ax, ch) => ({ t: 'mir', ax, ch: [ch] });
const Fn = (bb, f, m = 0) => ({ t: 'fn', bb, f, m });
const Disp = (L, ch) => ({ t: 'disp', L, ch: [ch] });
const mat = id => ['mat', id];
export const OM = { SKIN: 0, EYE: 1, SIPHON: 2, FIN: 3 };

function hash3(x, y, z, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(s | 0, 144665); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// soft domes on a jittered 3D lattice (each cell's feature, if populated, raises a smooth bump)
function warts(f, dens, amp, seed) {
  return (x, y, z) => {
    const X = Math.floor(x * f), Y = Math.floor(y * f), Z = Math.floor(z * f);
    let o = 0;
    for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = X + i, cy = Y + j, cz = Z + k;
      if (hash3(cx, cy, cz, seed + 7) > dens) continue;
      const px = (cx + hash3(cx, cy, cz, seed)) / f, py = (cy + hash3(cx, cy, cz, seed + 1)) / f, pz = (cz + hash3(cx, cy, cz, seed + 2)) / f;
      const r = (0.25 + 0.3 * hash3(cx, cy, cz, seed + 3)) / f, d = Math.hypot(x - px, y - py, z - pz) / r;
      if (d < 1) o += amp * (1 - d * d) * (1 - d * d) * (0.6 + 0.4 * hash3(cx, cy, cz, seed + 4));
    }
    return Math.min(o, amp * 1.3);
  };
}
// ---- the octopus ------------------------------------------------------------------------------
export const OCT_EYE = [0.45, 0.165, 0.0], OCT_EYER = 0.072;
function octMantleSpec() {
  // the mantle sac rides up and back over a broad head
  let s = U(0.14, E([0.0, 0.40, -0.05], [0.40, 0.34, 0.36], OM.SKIN, [-0.3, 0, 0]), E([0.0, 0.08, 0.02], [0.44, 0.25, 0.36], OM.SKIN));
  // the eye turrets: raised orbits on the head's flanks, the ball sunk in them
  s = U(0.06, s, Mir(0, E([0.42, 0.17, 0.0], [0.1, 0.12, 0.12], OM.SKIN)));
  s = Sub(0.02, OM.SKIN, s, Mir(0, Sph(OCT_EYE, OCT_EYER * 0.96)));
  s = U(0.008, s, Mir(0, Sph(OCT_EYE, OCT_EYER, OM.EYE)));
  // the lids: a fold over the top of each eye, and the supraocular papillae ("horns")
  s = U(0.02, s, Mir(0, { t: 'torus', c: [0.47, 0.2, 0.0], R: 0.06, r: 0.016, m: OM.SKIN, rot: [0, 0.96, 0.28, -1, 0, 0, 0, -0.28, 0.96] }));
  s = U(0.015, s, Mir(0, Cap([0.42, 0.26, -0.02], [0.45, 0.34, -0.04], 0.03, 0.006, OM.SKIN)), Mir(0, Cap([0.4, 0.26, 0.04], [0.42, 0.31, 0.07], 0.02, 0.005, OM.SKIN)));
  // the arm crown: eight root bulges where the procedural arms leave, and the web between
  const roots = [];
  for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * TAU, c = Math.cos(a), sn = Math.sin(a); roots.push(Cap([c * 0.12, 0.1, sn * 0.12], [c * 0.3, 0.1, sn * 0.3], 0.12, 0.105, OM.SKIN)); }
  s = U(0.07, s, ...roots);
  // the siphon on the side, hollow at its mouth
  s = U(0.03, s, Cap([0.0, 0.05, -0.3], [0.02, -0.02, -0.44], 0.065, 0.045, OM.SIPHON));
  s = Sub(0.01, OM.SIPHON, s, Cap([0.02, -0.02, -0.4], [0.025, -0.04, -0.5], 0.028, 0.03));
  return Disp([
    // warty papillae, larger on the mantle, the skin ridges round the sac
    // warty papillae: soft domes, bigger and sparser on the mantle, a fine field between
    { type: 'fn', amp: 0.016, fn: warts(9, 0.42, 0.012, 51) },
    { type: 'fn', amp: 0.006, bake: true, fn: warts(24, 0.5, 0.0045, 52) },
    { type: 'ridged', amp: 0.006, f: 7, oct: 3, seed: 53, bake: true },
    { type: 'grain', amp: 0.001, f: 90, seed: 54, bake: true }
  ], s);
}
function octPaint() {
  return {
    kScale: 0.006, aoAlb: 0.55,
    mats: { [OM.SKIN]: { c: [0.62, 0.62, 0.62], ro: 0.8 }, [OM.EYE]: { c: [0.4, 0.4, 0.4], ro: 0.05 }, [OM.SIPHON]: { c: [0.72, 0.72, 0.72], ro: 0.7 } },
    layers: [
      // a mottle of dark reticulation and pale patches (the chromatophores ride on top, live)
      { c: [0.36, 0.36, 0.36], a: 0.6, m: [['n', 6, 0.5, 0.75, 171]] },
      { c: [0.85, 0.85, 0.85], a: 0.5, m: [['cvx', 0.5, 1.4]] },          // wart tips pale
      { c: [0.30, 0.30, 0.30], a: 0.6, m: [['cav', 0.3, 1.0]] },
      { c: [0.82, 0.82, 0.82], a: 0.5, m: [['nd', [0, -1, 0], 0.3, 0.9]] },
      { c: [0.04, 0.04, 0.04], a: 0.75, m: [['ao', 0.35, 0.9]] }
    ]
  };
}
// mantle coordinates the octopus shader keys its skin by: v from the height, the azimuth
export function octLabel(x, y, z) {
  const v = clamp(Math.pow(clamp((y + 0.30) / 1.02, 0, 1), 1 / 0.92), 0, 1);
  let a = Math.atan2(z / 0.9, x / 1.06); if (a < 0) a += TAU;
  return [v, a];
}

// ---- the squid -------------------------------------------------------------------------------
// the old lathe's radius (predators.js prof), kept: the fins and arms are placed on it
const sqProf = v => Math.max(0.012, Math.sin(Math.pow(v, 0.62) * Math.PI * 0.94) * 0.20 * (1 - 0.30 * v * v));
export const SQ_EYE = [0.16, 0.0, 0.24], SQ_EYER = 0.055;
function sqMantleF(x, y, z) {
  // the mantle along +z: v = 0 tail tip (z -0.5) .. 1 collar (z 0.18)
  const v = clamp((z + 0.5) / 0.68, 0, 1), r = sqProf(v);
  const k = Math.hypot(x / r, y / (r * 0.94)) - 1;
  const d = k * r * 0.85, dz = Math.max(-0.5 - z, z - 0.2, 0);
  return dz > 0 ? Math.hypot(Math.max(d, 0), dz) : d;
}
function squidSpec() {
  let s = Fn([-0.25, -0.25, -0.55, 0.25, 0.25, 0.25], sqMantleF, OM.SKIN);
  // the collar, the head with its eyes, the gladius ridge
  s = U(0.03, s, { t: 'torus', c: [0, 0, 0.17], R: sqProf(1) * 0.98, r: 0.018, m: OM.SKIN, rot: [1, 0, 0, 0, 0, -1, 0, 1, 0] });
  s = U(0.05, s, E([0, 0, 0.25], [0.15, 0.13, 0.08], OM.SKIN));
  s = U(0.03, s, Mir(0, E([0.13, 0, 0.24], [0.06, 0.08, 0.07], OM.SKIN)));
  s = Sub(0.015, OM.SKIN, s, Mir(0, Sph(SQ_EYE, SQ_EYER * 0.96)));
  s = U(0.006, s, Mir(0, Sph(SQ_EYE, SQ_EYER, OM.EYE)));
  s = U(0.01, s, Fn([-0.03, 0.0, -0.5, 0.03, 0.25, 0.2], (x, y, z) => { const v = clamp((z + 0.5) / 0.68, 0, 1), r = sqProf(v); const d = Math.hypot(x, y - r * 0.92) - 0.01 * (0.3 + 0.7 * Math.sin(Math.PI * v)); const dz = Math.max(-0.48 - z, z - 0.16, 0); return dz > 0 ? Math.hypot(Math.max(d, 0), dz) : d; }, OM.SKIN));
  // the funnel under the head
  s = U(0.02, s, Cap([0, -0.11, 0.12], [0, -0.1, 0.24], 0.035, 0.028, OM.SIPHON));
  return Disp([
    // chromatophore pits and the fine skin, the mantle's ring muscles
    { type: 'pits', amp: 0.0025, f: 40, dens: 0.4, r: 0.3, seed: 61, bake: true },
    { type: 'fn', amp: 0.002, bake: true, fn: (x, y, z) => 0.0012 * Math.sin(z * 160 + Math.sin(x * 30) * 0.6) * (z < 0.16 ? 1 : 0) },
    { type: 'grain', amp: 0.0006, f: 140, seed: 62, bake: true }
  ], s);
}
function squidPaint() {
  return {
    kScale: 0.004, aoAlb: 0.55,
    mats: { [OM.SKIN]: { c: [0.66, 0.64, 0.66], ro: 0.4 }, [OM.EYE]: { c: [0.08, 0.08, 0.09], ro: 0.05 }, [OM.SIPHON]: { c: [0.75, 0.72, 0.72], ro: 0.4 } },
    layers: [
      { c: [0.40, 0.38, 0.42], a: 0.6, m: [['n', 18, 0.5, 0.75, 181]] },
      { c: [0.85, 0.84, 0.86], a: 0.5, m: [['nd', [0, -1, 0], 0.2, 0.8]] },
      { c: [0.04, 0.04, 0.04], a: 0.7, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

export function pipeline() {
  return {
    name: 'octo', out: 'assets/fauna/octo',
    sets: { octo: { size: 1024, gutter: 6, aoDist: 0.08, aoSamples: 48, fill: true } },
    pieces: [
      { name: 'octMantle', set: 'octo', sdf: octMantleSpec(), paint: octPaint(), hi: { h: 0.004 }, lo: { h: 0.01, tris: 3200, err: 0.03 }, kEps: 0.008, ao: { r: 0.05, n: 4 }, cage: 0.012, ray: 0.04 },
      { name: 'squid', set: 'octo', sdf: squidSpec(), paint: squidPaint(), hi: { h: 0.0025 }, lo: { h: 0.006, tris: 1600, err: 0.018 }, kEps: 0.005, ao: { r: 0.03, n: 4 }, cage: 0.008, ray: 0.025 }
    ],
    compress: { mesh: 'draco' },
    meta: {}
  };
}
