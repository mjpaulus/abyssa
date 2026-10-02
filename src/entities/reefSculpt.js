// THE REEF — zone 0's named animals, sculpted (fauna2): the manta, the green turtle, the
// honeycomb moray, the brown crab, the long-spined urchin and the sea star.
// `node tools/blender/build.mjs reef` bakes them into assets/fauna/reef/ (one atlas).
//
// Every piece is sculpted in fauna.js's AUTHORED frame for that animal (+X forward, +Y up,
// Z lateral, around the origin, before fauna's merge scale), at the same extents as the
// procedural build it replaces, so every motion uniform tuned for that build (wing span,
// body length, hinge points, flipper hinge) still fits. A body is split into PIECES where
// its motion parts move discontinuously (the manta's tail whips, its disc does not; the
// moray's jaw hinges; the turtle's flippers stroke about their roots; a crab's legs step),
// and each piece's LABEL (exported here, read by fauna.js at install) writes the part id,
// phase and surface kind the one vertex shader animates by.
//
// Reference: Mobula birostris (chevron shoulder patches, rolled cephalic lobes, a terminal
// mouth, ventral gill slits, a whip tail with a tiny dorsal fin); Chelonia mydas (4 costal
// scute pairs, 5 vertebrals, 11 marginal pairs, one claw per fore flipper, pale-edged head
// scales, a serrated beak); Gymnothorax favagineus (honeycomb pattern, tubular nostrils,
// fangs, a small round gill pore, a dorsal fin from the nape); Cancer pagurus ("pie-crust"
// anterolateral lobes, black-tipped chelae); Diadema setosum (very long banded spines, an
// orange anal ring); Asterias rubens (reticulated ossicles, white-tipped spines, the
// madreporite, tube-foot grooves).
import { compile } from '../lib/sculpt.js';

const TAU = Math.PI * 2;
const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const E = (c, r, m = 0, e) => ({ t: 'ellip', c, r, m, e });
const Sph = (c, r, m = 0) => ({ t: 'sphere', c, r, m });
const Cap = (a, b, ra, rb = ra, m = 0) => ({ t: 'cap', a, b, ra, rb, m });
const U = (k, ...ch) => ({ t: 'u', k, ch });
const Sub = (k, m, a, ...b) => ({ t: 's', k, m, ch: [a, ...b] });
const Tube = (p, r0, r1, n = 10, m = 0, rr) => ({ t: 'tube', p, r: [r0, r1], n, m, rr });
const Mir = (ax, ch) => ({ t: 'mir', ax, ch: [ch] });
const Fn = (bb, f, m = 0) => ({ t: 'fn', bb, f, m });
const Disp = (L, ch) => ({ t: 'disp', L, ch: [ch] });
const mat = id => ['mat', id];
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
function hash(i, s = 0) { let h = Math.imul(i | 0, 374761393) ^ Math.imul(s | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// 2D worley over (u, v): F1, F2, cell centre
function wor2(u, v, s, o) {
  const X = Math.floor(u), Y = Math.floor(v);
  let f1 = 9, f2 = 9, cx = 0, cy = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = X + i, gy = Y + j, k = gx * 7919 + gy * 104729;
    const px = gx + 0.15 + 0.7 * hash(k, s), py = gy + 0.15 + 0.7 * hash(k, s + 1), d = Math.hypot(px - u, py - v);
    if (d < f1) { f2 = f1; f1 = d; cx = px; cy = py; } else if (d < f2) f2 = d;
  }
  o.f1 = f1; o.f2 = f2; o.cx = cx; o.cy = cy; o.id = hash(Math.floor(cx) * 7919 + Math.floor(cy) * 104729, s + 2);
  return o;
}

// shared material ids (one paint vocabulary per piece)
export const RM = { SKIN: 0, BELLY: 1, EYE: 2, MOUTH: 3, SHELL: 4, SCALE: 5, CLAW: 6, SPINE: 7, TOOTH: 8, FOOT: 9 };

// =============================================================================================
// MANTA (fauna RAY: merge scale 3.1, span 2.35 authored)
// =============================================================================================
const MSPAN = 2.35;
const mLE = u => 1.0 - 1.35 * Math.pow(u, 1.45);           // leading edge x at span fraction u
const mTE = u => -0.88 + 0.53 * Math.pow(u, 1.7);          // trailing edge (swept, concave)
const mCam = u => 0.03 * (1 - u) - 0.09 * u * u;           // the wings droop to the tips
function mantaDisc(x, y, z) {
  const az = Math.abs(z), u = Math.min(1, az / MSPAN);
  const le = mLE(u), te = mTE(u), c = Math.max(1e-3, le - te);
  const xi = clamp((x - te) / c, 0, 1);
  const T = 0.22 * Math.pow(1 - u, 1.6) + 0.010;
  const half = T * 2.6 * Math.sqrt(xi) * (1 - xi) * (1 - 0.35 * xi);
  // the MESH keeps at least M_MIN of half-thickness to the very edge (so the low's grid
  // never pinches the trailing edge into rags); mantaThin pares the high back to a blade
  const dy = Math.abs(y - mCam(u)) - Math.max(half, M_MIN);
  const dp = Math.max(x - le, te - x, az - MSPAN) * 0.75;
  return dp > 0 || dy > 0 ? Math.hypot(Math.max(dp, 0), Math.max(dy, 0)) : Math.max(dp, dy);
}
const M_MIN = 0.014;
function mantaThin(x, y, z) {
  const az = Math.abs(z), u = Math.min(1, az / MSPAN);
  if (az < 0.5) return 0;
  const le = mLE(u), te = mTE(u), c = Math.max(1e-3, le - te), xi = clamp((x - te) / c, 0, 1);
  const T = 0.22 * Math.pow(1 - u, 1.6) + 0.010, half = T * 2.6 * Math.sqrt(xi) * (1 - xi) * (1 - 0.35 * xi);
  return -Math.max(0, M_MIN - half) * sst(0.5, 0.6, az);
}
const M_EYE = [0.86, 0.045, 0.34], M_EYER = 0.048;
function mantaSpec() {
  let s = U(0.14, Fn([-1.0, -0.4, -2.45, 1.15, 0.4, 2.45], mantaDisc, RM.SKIN), E([0.05, 0.03, 0], [1.0, 0.2, 0.5], RM.SKIN));
  // cephalic lobes: rolled horns either side of the mouth
  const lobe = U(0.03, E([1.02, -0.035, 0.31], [0.16, 0.035, 0.075], RM.SKIN, [0.15, -0.12, 0]), E([1.22, -0.07, 0.33], [0.13, 0.03, 0.06], RM.SKIN, [0.35, -0.08, 0]), E([1.36, -0.1, 0.31], [0.07, 0.025, 0.045], RM.SKIN, [0.5, 0.1, 0]));
  s = U(0.04, s, Mir(2, lobe));
  // the terminal mouth: a wide slot between the lobes
  s = Sub(0.02, RM.MOUTH, s, E([1.07, -0.035, 0], [0.12, 0.034, 0.25], RM.MOUTH));
  // the eyes: on the head's flank behind the lobes
  s = Sub(M_EYER * 0.3, RM.SKIN, s, Mir(2, Sph(M_EYE, M_EYER * 0.96)));
  s = U(M_EYER * 0.06, s, Mir(2, Sph(M_EYE, M_EYER, RM.EYE)));
  // the dorsal fin, a small blade at the tail root
  s = U(0.03, s, { t: 'i', k: 0.01, ch: [E([-0.86, 0.13, 0], [0.14, 0.11, 0.025], RM.SKIN), { t: 'plane', n: [0, -1, 0], o: -0.04, m: RM.SKIN }] });
  return Disp([
    // ventral gill slits: five arcs a side under the head
    { type: 'fn', amp: 0.012, fn: (x, y, z) => {
      if (y > 0.0) return 0;
      const az = Math.abs(z);
      if (az < 0.24 || az > 0.56 || x < 0.15 || x > 0.8) return 0;
      let g = 0;
      for (let k = 0; k < 5; k++) { const xk = 0.72 - k * 0.11 - 0.25 * (az - 0.24) ** 2; g = Math.max(g, Math.exp(-(((x - xk) / 0.008) ** 2))); }
      return -0.010 * g * sst(0.24, 0.3, az) * (1 - sst(0.5, 0.56, az));
    } },
    // the wing's spanwise muscle ridges (dorsal), and the dermal grain
    { type: 'fn', amp: 0.004, bake: true, fn: (x, y, z) => { const az = Math.abs(z); if (az < 0.45 || y < mCam(Math.min(1, az / MSPAN))) return 0; return 0.0025 * Math.sin(az * 26 + Math.sin(x * 3) * 2) * sst(0.45, 0.8, az) * (1 - sst(1.9, 2.3, az)); } },
    { type: 'grain', amp: 0.0018, f: 90, seed: 3, bake: true },
    { type: 'fbm', amp: 0.004, f: 7, oct: 3, seed: 4, bake: true },
    { type: 'fn', amp: M_MIN, bake: true, fn: mantaThin }
  ], s);
}
function mantaTailSpec() {
  const rr = []; for (let i = 0; i <= 16; i++) { const t = i / 16; rr.push(Math.max(0.011, 0.058 * Math.pow(1 - t, 1.3))); }
  return Disp([{ type: 'grain', amp: 0.0015, f: 70, seed: 5, bake: true }],
    Tube([[-0.82, 0.01, 0], [-1.9, 0.03, 0], [-2.9, 0.07, 0], [-3.6, 0.1, 0]], 0, 0, 16, RM.SKIN, rr));
}
function mantaPaint() {
  const dors = S => sst(-0.25, 0.25, S.ny);
  // the shoulder chevrons: white patches from behind the eyes out along the wing roots
  const chev = S => {
    // a lens-shaped pale patch either side, from behind the spiracle out along the leading
    // edge of the wing root, its inner end hooked toward the midline (the T of B. birostris)
    const az = Math.abs(S.z); if (S.ny < 0.05) return 0;
    const u = clamp((az - 0.36) / 0.75, 0, 1);
    const cx = 0.5 - 0.55 * u - 0.1 * Math.sin(u * Math.PI);
    const w = 0.13 * Math.sin(Math.PI * Math.pow(u, 0.7)) + 0.012;
    const d = Math.abs(S.x - cx) / w + 0.35 * Math.sin(az * 13 + S.x * 9) * (1 - u * 0.5);
    return (1 - sst(0.6, 1.1, d)) * sst(0.36, 0.46, az) * (1 - sst(0.9, 1.12, az)) * sst(0.05, 0.3, S.ny);
  };
  const belly = S => 1 - sst(-0.35, 0.1, S.ny);
  // the underside's dark wing margins and the individual's belly spots
  const margin = S => { const az = Math.abs(S.z), u = Math.min(1, az / MSPAN); const dl = mLE(u) - S.x, dt = S.x - mTE(u); return (1 - sst(0.0, 0.16 + 0.2 * u, Math.min(dl, dt))) * sst(0.5, 0.9, az); };
  const spots = S => { const az = Math.abs(S.z); if (az > 0.9 || S.x < -0.5 || S.x > 0.55) return 0; let m = 0; for (let k = 0; k < 9; k++) { const sx = -0.4 + hash(k, 3) * 0.9, sz = (hash(k, 4) - 0.5) * 1.5, r = 0.03 + 0.04 * hash(k, 5); m = Math.max(m, 1 - sst(r * 0.7, r, Math.hypot(S.x - sx, S.z - sz))); } return m; };
  return {
    kScale: 0.006, aoAlb: 0.5,
    mats: { [RM.SKIN]: { c: [0.07, 0.08, 0.085], ro: 0.55 }, [RM.EYE]: { c: [0.02, 0.02, 0.02], ro: 0.05 }, [RM.MOUTH]: { c: [0.03, 0.03, 0.035], ro: 0.5 } },
    layers: [
      { c: [0.80, 0.80, 0.76], a: 1, ro: 0.6, m: [mat(RM.SKIN), ['fn', belly]] },
      { c: [0.10, 0.10, 0.11], a: 0.85, m: [mat(RM.SKIN), ['fn', belly], ['fn', margin]] },
      { c: [0.12, 0.12, 0.13], a: 0.9, m: [mat(RM.SKIN), ['fn', belly], ['fn', spots]] },
      { c: [0.46, 0.47, 0.45], a: 0.8, m: [mat(RM.SKIN), ['fn', chev]] },
      { c: [0.10, 0.11, 0.12], a: 0.45, m: [mat(RM.SKIN), ['fn', chev], ['n', 14, 0.55, 0.8, 23]] },
      { c: [0.14, 0.15, 0.16], a: 0.35, m: [mat(RM.SKIN), ['fn', dors], ['n', 6, 0.45, 0.75, 21]] },
      { c: [0.30, 0.32, 0.32], a: 0.3, m: [['cvx', 0.3, 1.0]] },
      { c: [0.02, 0.02, 0.02], a: 0.7, m: [['ao', 0.3, 0.9]] },
      // gill slits: dark inside
      { c: [0.15, 0.09, 0.09], a: 0.8, m: [['cav', 0.4, 1.2], ['fn', belly]] }
    ]
  };
}

// =============================================================================================
// GREEN TURTLE (fauna TURTLE: merge scale 1.35; flipper hinge |z| 0.63 authored)
// =============================================================================================
// carapace scute centres (x, z): 5 vertebrals, 4 costal pairs (fauna.js TSC, kept)
const TSC = [[-0.72, 0], [-0.38, 0], [-0.02, 0], [0.34, 0], [0.68, 0], [-0.55, 0.42], [-0.18, 0.5], [0.2, 0.48], [0.55, 0.36], [-0.55, -0.42], [-0.18, -0.5], [0.2, -0.48], [0.55, -0.36]];
function carapaceH(x, z) {
  // dome height over the planform (heart-shaped: broad shoulders, tapered rear)
  const px = x / (x > 0 ? 0.98 : 1.0), w = 0.78 * (1 - 0.18 * Math.max(0, -x) ** 2) * (1 - 0.25 * Math.max(0, x - 0.55) ** 2 / 0.2);
  const r2 = px * px + (z / w) ** 2;
  return r2 >= 1 ? -1 : 0.43 * Math.pow(1 - r2, 0.55) + 0.06;
}
function turtleShell(x, y, z) {
  // a solid: the dome above, a flat plastron below at y = -0.13, the bridge between
  const w = 0.78 * (1 - 0.18 * Math.max(0, -x) ** 2) * (1 - 0.25 * Math.max(0, x - 0.55) ** 2 / 0.2);
  const px = x / (x > 0 ? 0.98 : 1.0), rr = Math.hypot(px, z / w);
  const dPlan = (rr - 1) * Math.min(0.98, w) * 0.9;
  const top = rr < 1 ? 0.43 * Math.pow(1 - rr * rr, 0.55) + 0.06 : 0.06;
  const bot = -0.13 + 0.06 * rr * rr;
  const dTop = (y - top) * 0.8, dBot = bot - y;
  const d = Math.max(dTop, dBot);
  return dPlan > 0 ? Math.hypot(dPlan, Math.max(d, 0)) : Math.max(dPlan, d);
}
const T_EYE = [1.47, 0.17, 0.13], T_EYER = 0.04;
function turtleBodySpec() {
  let shell = Fn([-1.05, -0.2, -0.85, 1.05, 0.55, 0.85], turtleShell, RM.SHELL);
  // the rim: marginal scutes flare a little and serrate behind
  shell = U(0.02, shell, Fn([-1.05, -0.05, -0.85, 1.05, 0.15, 0.85], (x, y, z) => {
    const w = 0.78 * (1 - 0.18 * Math.max(0, -x) ** 2) * (1 - 0.25 * Math.max(0, x - 0.55) ** 2 / 0.2), px = x / (x > 0 ? 0.98 : 1.0), rr = Math.hypot(px, z / w);
    const a = Math.atan2(z / w, px), ser = x < -0.3 ? 0.012 * Math.max(0, Math.cos(a * 11)) : 0;
    const dPlan = (rr - 1.015 - ser) * Math.min(0.98, w) * 0.9, dy = Math.abs(y - 0.03) - 0.035;
    return dPlan > 0 ? Math.hypot(dPlan, Math.max(dy, 0)) : Math.max(dPlan, dy);
  }, RM.SHELL));
  // neck + head: a short thick neck folding out from under the shell, a blunt head
  const neck = Tube([[0.62, -0.02, 0], [0.95, 0.04, 0], [1.22, 0.1, 0]], 0.17, 0.135, 10, RM.SKIN);
  const head = U(0.07, E([1.44, 0.12, 0], [0.27, 0.155, 0.165], RM.SKIN), E([1.66, 0.095, 0], [0.12, 0.1, 0.11], RM.SKIN));
  let hd = U(0.05, neck, head);
  // the beak: a horny sheath, serrated lower jaw, a gape line
  hd = U(0.01, hd, E([1.74, 0.05, 0], [0.06, 0.06, 0.07], RM.MOUTH));
  hd = Sub(0.005, RM.MOUTH, hd, { t: 'i', k: 0.004, ch: [E([1.6, 0.045, 0], [0.22, 0.011, 0.14]), { t: 'plane', n: [-1, 0, 0], o: -1.5 }] });
  // eyes in the head's flank, heavy lids above
  hd = Sub(T_EYER * 0.3, RM.SKIN, hd, Mir(2, Sph(T_EYE, T_EYER * 0.95)));
  hd = U(T_EYER * 0.06, hd, Mir(2, Sph(T_EYE, T_EYER, RM.EYE)));
  hd = U(0.012, hd, Mir(2, Tube([[1.42, 0.2, 0.1], [1.48, 0.215, 0.14], [1.54, 0.2, 0.12]], 0.016, 0.012, 6, RM.SKIN)));
  // tail stub
  const tail = Tube([[-0.9, -0.03, 0], [-1.1, -0.05, 0], [-1.22, -0.08, 0]], 0.07, 0.025, 8, RM.SKIN);
  let s = U(0.04, shell, hd, tail);
  return Disp([
    // scute seams: shallow grooves in the mesh, deep in the bake
    { type: 'fn', amp: 0.006, fn: scuteSeam(0.004) },
    { type: 'fn', amp: 0.008, bake: true, fn: scuteSeam(0.006, true) },
    // head scales (polygonal), neck folds
    { type: 'fn', amp: 0.006, bake: true, fn: turtleSkinFn },
    { type: 'barn', amp: 0.012, f: 9, dens: 0.05, seed: 77, bake: true, mask: [['ax', 0, -0.2, -0.6], ['ax', 1, 0.15, 0.3]] },
    { type: 'grain', amp: 0.0012, f: 120, seed: 8, bake: true }
  ], s);
}
// scute seams by the nearest two centres (the TSC layout), growth rings parallel to the seams
function scuteSeam(depth, rings) {
  return (x, y, z) => {
    if (y < 0.05) return 0;
    const top = carapaceH(x, z); if (top < 0 || Math.abs(y - top) > 0.06) return 0;
    const q = [x, z * 1.15];
    let d1 = 9, d2 = 9;
    for (const c of TSC) { const d = Math.hypot(q[0] - c[0], q[1] - c[1]); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
    // marginal scutes: the rim band, 11 a side
    const w = 0.78 * (1 - 0.18 * Math.max(0, -x) ** 2), rr = Math.hypot(x, z / w);
    const ma = Math.atan2(z / w, x) * 22 / TAU, mseam = Math.abs(ma - Math.round(ma));
    let seam = d2 - d1;
    if (rr > 0.84) seam = Math.min(seam, mseam * 0.25, Math.abs(rr - 0.84) * 0.6);
    const g = -depth * Math.exp(-((seam / 0.012) ** 2));
    const r = rings ? -0.0012 * (0.5 + 0.5 * Math.cos(seam * 160)) * (1 - sst(0.02, 0.15, seam)) : 0;
    return g + r;
  };
}
const _w = {};
function turtleSkinFn(x, y, z) {
  // polygonal scales on head/neck/tail (anything off the shell)
  if (x < 0.62 && x > -0.85) return 0;
  const big = x > 1.3 && y > 0.12;                       // the big prefrontal/head scutes
  const f = big ? 14 : 26;
  wor2(x * f + y * 3, (z + y * 0.7) * f, 41, _w);
  const seam = _w.f2 - _w.f1;
  return -0.004 * Math.exp(-((seam / 0.08) ** 2)) + 0.0015 * (1 - _w.f1);
}
// the flippers: a long fore paddle (one claw on the leading edge) and a short hind paddle;
// each authored on +z and mirrored. Root inside the shell's bridge.
const F_MIN = 0.012;
function turtleFlipSpec() {
  // the bake pares the mesh's edge floor (F_MIN) back to the true thin trailing edge
  const thin = (x, y, z) => {
    const az = Math.abs(z);
    const fu = clamp((az - 0.45) / 1.42, 0, 1), fxc = 0.3 - 0.45 * fu, fch = 0.5 * (1 - Math.pow(fu, 1.6)) + 0.012, fle = fxc + fch * 0.45, fte = fxc - fch * 0.55;
    const hu = clamp((az - 0.42) / 0.66, 0, 1), hle = -0.52 - 0.18 * hu, hte = -0.95 - 0.12 * hu + 0.25 * hu * hu;
    const fore = x > -0.45;
    const u = fore ? fu : hu, le = fore ? fle : hle, te = fore ? fte : hte, c = Math.max(1e-3, le - te), xi = clamp((x - te) / c, 0, 1);
    const T = (fore ? 0.06 : 0.05) * (1 - u) + 0.012, half = T * 2.6 * Math.sqrt(xi) * (1 - xi) * (1 - 0.3 * xi);
    return -Math.max(0, F_MIN - half) * sst(0.5, 0.65, az);
  };
  // the fore flipper: long, swept back, tapering to a point (a wing, not a paddle)
  const foreLE = u => { const xc = 0.3 - 0.45 * u, ch = 0.5 * (1 - Math.pow(u, 1.6)) + 0.012; return [xc + ch * 0.45, xc - ch * 0.55]; };
  const fore = (x, y, z) => {
    const u = clamp((z - 0.45) / 1.42, 0, 1);
    const [le, te] = foreLE(u);
    const c = Math.max(1e-3, le - te), xi = clamp((x - te) / c, 0, 1);
    const T = 0.06 * (1 - u) + 0.012, half = T * 2.6 * Math.sqrt(xi) * (1 - xi) * (1 - 0.3 * xi);
    const cam = -0.03 - 0.06 * u;
    const dy = Math.abs(y - cam) - Math.max(half, F_MIN), dp = Math.max(x - le, te - x, z - 1.87, 0.45 - z) * 0.7;
    return dp > 0 || dy > 0 ? Math.hypot(Math.max(dp, 0), Math.max(dy, 0)) : Math.max(dp, dy);
  };
  const hind = (x, y, z) => {
    const u = clamp((z - 0.42) / 0.66, 0, 1);
    const le = -0.52 - 0.18 * u, te = -0.95 - 0.12 * u + 0.25 * u * u;
    const c = Math.max(1e-3, le - te), xi = clamp((x - te) / c, 0, 1);
    const T = 0.05 * (1 - u) + 0.012, half = T * 2.6 * Math.sqrt(xi) * (1 - xi) * (1 - 0.3 * xi);
    const dy = Math.abs(y + 0.02) - Math.max(half, F_MIN), dp = Math.max(x - le, te - x, z - 1.08, 0.42 - z) * 0.7;
    return dp > 0 || dy > 0 ? Math.hypot(Math.max(dp, 0), Math.max(dy, 0)) : Math.max(dp, dy);
  };
  const claw = { t: 'cone', a: [0.36, -0.03, 0.82], b: [0.42, -0.05, 0.87], ra: 0.016, rb: 0.003, m: RM.CLAW };
  const s = U(0.02, Fn([-0.75, -0.2, 0.4, 0.62, 0.15, 1.9], fore, RM.SKIN), Fn([-1.12, -0.12, 0.38, -0.45, 0.1, 1.1], hind, RM.SKIN), claw);
  return Disp([
    { type: 'fn', amp: 0.006, bake: true, fn: (x, y, z) => {
      // scales: big on the leading edge, small elsewhere
      const f = 22 + 10 * sst(0.3, -0.2, x);
      wor2(x * f, z * f, 51, _w);
      return -0.0035 * Math.exp(-(((_w.f2 - _w.f1) / 0.09) ** 2)) + 0.0012 * (1 - _w.f1);
    } },
    { type: 'grain', amp: 0.001, f: 120, seed: 9, bake: true },
    { type: 'fn', amp: F_MIN, bake: true, fn: thin }
  ], Mir(2, s));
}
function turtlePaint(flip) {
  // tortoiseshell: per-scute radiating streaks of amber over olive-brown
  const streak = S => {
    let d1 = 9, c1 = TSC[0];
    const q = [S.x, S.z * 1.15];
    for (const c of TSC) { const d = Math.hypot(q[0] - c[0], q[1] - c[1]); if (d < d1) { d1 = d; c1 = c; } }
    const a = Math.atan2(q[1] - c1[1], q[0] - c1[0]);
    const n = 0.5 + 0.5 * Math.sin(a * 7 + hash(Math.round(c1[0] * 10 + c1[1] * 100), 2) * 9 + Math.sin(d1 * 30) * 0.8);
    return sst(0.55, 0.9, n) * sst(0.04, 0.2, d1);
  };
  const shell = mat(RM.SHELL);
  const skinScale = S => 0;   // (handled by cavity: the scale seams catch pale)
  return {
    kScale: 0.004, aoAlb: 0.5,
    mats: {
      [RM.SHELL]: { c: [0.20, 0.18, 0.11], ro: 0.6 }, [RM.SKIN]: { c: [0.22, 0.21, 0.15], ro: 0.62 },
      [RM.EYE]: { c: [0.04, 0.035, 0.03], ro: 0.05 }, [RM.MOUTH]: { c: [0.30, 0.27, 0.20], ro: 0.45 }, [RM.CLAW]: { c: [0.32, 0.28, 0.2], ro: 0.4 }
    },
    layers: [
      { c: [0.40, 0.31, 0.16], a: 0.55, m: [shell, ['fn', streak]] },
      { c: [0.16, 0.18, 0.12], a: 0.35, m: [shell, ['n', 3, 0.5, 0.8, 31]] },          // algal film
      { c: [0.66, 0.62, 0.46], a: 0.9, m: [shell, ['nd', [0, -1, 0], 0.4, 0.8]] },    // plastron, cream
      // skin: dark scales, pale (yellow-cream) seams between them, paler underneath
      { c: [0.56, 0.52, 0.38], a: 0.45, m: [mat(RM.SKIN), ['cav', 0.35, 1.1]] },
      { c: [0.60, 0.56, 0.42], a: 0.6, m: [mat(RM.SKIN), ['nd', [0, -1, 0], 0.2, 0.8]] },
      { c: [0.10, 0.08, 0.05], a: 0.7, m: [shell, ['cav', 0.3, 1.0]] },                 // scute seams dark
      { c: [0.55, 0.52, 0.44], a: 0.6, m: [['cvx', 0.6, 1.4]] },                         // barnacle rims, worn edges
      { c: [0.02, 0.02, 0.02], a: 0.75, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// =============================================================================================
// HONEYCOMB MORAY (fauna MORAY: merge scale 1.0; jaw hinge (0.45, -0.02) opening down)
// =============================================================================================
export const MO_HINGE = [0.45, -0.02];
function morayR(x) {
  // height, width along the body (x from -3.2 tail to 1.06 snout)
  const t = clamp((1.06 - x) / 4.26, 0, 1);
  const h = 0.06 + 0.2 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.45 + 0.08)), 0.6) * (1 - 0.7 * sst(0.55, 1.0, t));
  return [h * (1 - 0.55 * sst(0.0, 0.08, 0.08 - t) * 0), h * 0.82];
}
function morayBody(x, y, z) {
  const xc = clamp(x, -3.2, 1.06);
  const [h, w] = morayR(xc);
  // the head: the snout tapers to a blunt point, the upper profile rises to the nape
  const snout = sst(0.55, 1.06, xc);
  const hh = h * (1 - 0.55 * snout * snout), ww = w * (1 - 0.6 * snout * snout);
  const cy = 0.03 * sst(0.2, 0.7, xc) - 0.03 * snout;
  const k0 = Math.hypot(z / ww, (y - cy) / hh), d = (k0 - 1) * Math.min(hh, ww) * 0.85;
  const dx = Math.max(x - 1.06, -3.2 - x, 0);
  return dx > 0 ? Math.hypot(Math.max(d, 0), dx) : d;
}
function morayUpper(x, y, z) {
  // everything above the gape plane in the head; the throat behind the hinge stays whole
  const d = morayBody(x, y, z);
  if (x < MO_HINGE[0] - 0.02) return d;
  const gy = MO_HINGE[1] - 0.04 * sst(0.45, 1.06, x);       // the gape line falls toward the snout
  return Math.max(d, -(y - gy) + 0.004);
}
function morayJaw(x, y, z) {
  const d = morayBody(x, y, z);
  const gy = MO_HINGE[1] - 0.04 * sst(0.45, 1.06, x);
  return Math.max(d, y - gy + 0.004, MO_HINGE[0] - 0.03 - x);
}
function moraySpec() {
  let s = Fn([-3.3, -0.3, -0.3, 1.15, 0.35, 0.3], morayUpper, RM.SKIN);
  // the dorsal fin: a thick fleshy ridge from the nape to the tail
  s = U(0.04, s, Fn([-3.3, 0.0, -0.06, 0.45, 0.5, 0.06], (x, y, z) => {
    const xc = clamp(x, -3.2, 0.35), [h] = morayR(xc), top = h + 0.03 * Math.min(1, 1.2 * (0.35 - xc)) + 0.065 * sst(0.35, -0.2, xc) * sst(-3.2, -2.4, xc);
    const dy = y - top, dz = Math.abs(z) - 0.014 * (1 + 0.5 * sst(top - 0.02, top - 0.12, y));
    const dx = Math.max(x - 0.35, -3.2 - x, 0);
    const dd = Math.max(dy, dz, -y + h * 0.5);
    return dx > 0 ? Math.hypot(dx, Math.max(dd, 0)) : dd;
  }, RM.SKIN));
  // the mouth cavity under the upper jaw: carved up into the head, dark lining, fangs down
  s = Sub(0.02, RM.MOUTH, s, E([0.78, MO_HINGE[1] - 0.005, 0], [0.33, 0.06, 0.1], RM.MOUTH));
  const teeth = [];
  for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) {
    const x = 0.52 + i * 0.055, zz = sd * (0.095 - 0.07 * (i / 8) ** 2), y0 = MO_HINGE[1] - 0.04 * sst(0.45, 1.06, x) + 0.03;
    const L = 0.035 + (i > 6 ? 0.025 : 0) + 0.01 * hash(i * 2 + (sd > 0), 1);
    teeth.push({ t: 'cone', a: [x, y0, zz], b: [x + 0.015, y0 - L - 0.02, zz * 0.92], ra: 0.011, rb: 0.002, m: RM.TOOTH });
  }
  s = U(0.004, s, ...teeth);
  // tubular anterior nostrils at the snout, posterior ones above the eye
  s = U(0.01, s, Mir(2, Cap([0.99, 0.03, 0.035], [1.06, 0.06, 0.05], 0.013, 0.009, RM.SKIN)), Mir(2, Cap([0.74, 0.12, 0.06], [0.75, 0.15, 0.065], 0.01, 0.008, RM.SKIN)));
  // eyes, high on the head; the round gill pore behind the jaw
  const eye = [0.64, 0.12, 0.125], er = 0.038;
  s = Sub(er * 0.3, RM.SKIN, s, Mir(2, Sph(eye, er * 0.95)));
  s = U(er * 0.06, s, Mir(2, Sph(eye, er, RM.EYE)));
  s = Sub(0.01, RM.MOUTH, s, Mir(2, Sph([0.18, -0.04, 0.215], 0.03, RM.MOUTH)));
  return Disp([
    // the thick wrinkled hide: folds across the throat and nape, fine creases everywhere
    { type: 'fn', amp: 0.006, fn: (x, y, z) => x > -0.2 && x < 0.7 ? -0.004 * Math.pow(Math.abs(Math.sin(x * 38 + Math.sin(z * 9) * 1.5)), 6) * sst(0.0, 0.1, -y + 0.05) : 0 },
    { type: 'fbm', amp: 0.006, f: 9, oct: 3, seed: 13, bake: true },
    { type: 'grain', amp: 0.0012, f: 90, seed: 14, bake: true }
  ], s);
}
function morayJawSpec() {
  let s = Fn([0.35, -0.35, -0.3, 1.15, 0.1, 0.3], morayJaw, RM.SKIN);
  s = Sub(0.015, RM.MOUTH, s, E([0.8, MO_HINGE[1] + 0.03, 0], [0.32, 0.06, 0.085], RM.MOUTH));
  const teeth = [];
  for (let i = 0; i < 8; i++) for (const sd of [-1, 1]) {
    const x = 0.55 + i * 0.058, zz = sd * (0.085 - 0.06 * (i / 7) ** 2), y0 = MO_HINGE[1] - 0.04 * sst(0.45, 1.06, x) - 0.025;
    const L = 0.03 + (i > 5 ? 0.02 : 0) + 0.01 * hash(i * 2 + (sd > 0), 2);
    teeth.push({ t: 'cone', a: [x, y0, zz], b: [x + 0.012, y0 + L + 0.015, zz * 0.95], ra: 0.01, rb: 0.002, m: RM.TOOTH });
  }
  s = U(0.004, s, ...teeth);
  return Disp([{ type: 'fbm', amp: 0.005, f: 9, oct: 3, seed: 13, bake: true }, { type: 'grain', amp: 0.0012, f: 90, seed: 15, bake: true }], s);
}
function morayPaint() {
  // honeycomb: pale yellowish polygons inside a dark brown net, the net coarsening down the body
  const comb = S => {
    const f = 10 + 5 * sst(0.5, -2.5, S.x);
    wor2(S.x * f, (S.y * 1.3 + S.z) * f * 0.9 + (S.z < 0 ? 37 : 0), 61, _w);
    return 1 - sst(0.03, 0.17, _w.f2 - _w.f1);
  };
  return {
    kScale: 0.004, aoAlb: 0.5,
    mats: {
      [RM.SKIN]: { c: [0.62, 0.58, 0.38], ro: 0.3 }, [RM.EYE]: { c: [0.55, 0.5, 0.25], ro: 0.05 },
      [RM.MOUTH]: { c: [0.42, 0.30, 0.24], ro: 0.35 }, [RM.TOOTH]: { c: [0.80, 0.77, 0.66], ro: 0.3 }
    },
    layers: [
      { c: [0.13, 0.10, 0.06], a: 0.95, m: [mat(RM.SKIN), ['fn', comb]] },
      { c: [0.70, 0.66, 0.50], a: 0.5, m: [mat(RM.SKIN), ['nd', [0, -1, 0], 0.3, 0.9]] },
      { c: [0.02, 0.02, 0.02], a: 1, ro: 0.04, m: [mat(RM.EYE), ['fn', S => sst(0.35, 0.5, Math.abs(S.z) - 0.125 + 0.0) * 0 + sst(0.45, 0.65, ((Math.abs(S.z) - 0.125) / 0.038))]] },
      { c: [0.08, 0.05, 0.04], a: 0.6, m: [['cav', 0.3, 1.2]] },
      { c: [0.02, 0.02, 0.02], a: 0.75, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// =============================================================================================
// BROWN CRAB (fauna CRAB: merge scale 0.55; legs step on part 3, claws aPhase +-1.3)
// =============================================================================================
// leg spines (authored, +z side; mirrored): 4 walking legs + the cheliped
export const CRAB_LEGS = [];
for (let i = 0; i < 4; i++) {
  const x = (i / 3 - 0.5) * 0.9, z = 0.5;
  CRAB_LEGS.push({ p: [[x, 0.3, z], [x - 0.04, 0.47, z + 0.22], [x - 0.12, 0.55, z + 0.42], [x - 0.18, 0.3, z + 0.65], [x - 0.21, 0.04, z + 0.8]], phase: (i % 2) * Math.PI, side: 0.5 });
}
const CHELA = { p: [[0.4, 0.3, 0.45], [0.66, 0.4, 0.66], [0.92, 0.42, 0.74], [1.15, 0.36, 0.7]] };
function crabCarapace(x, y, z) {
  // oval, broader than long, the front edge lobed ("pie crust"), domed
  const a = Math.atan2(z, x), r0 = 0.7 * (1 + 0.06 * Math.cos(2 * a)) * (x > 0 ? 1 : 0.86);
  const lob = x > -0.15 ? 0.025 * Math.max(0, Math.cos(a * 9)) * sst(-0.15, 0.2, x) : 0;
  const R = Math.hypot(x * 1.05, z * 0.82), dPlan = (R - r0 * 0.82 - lob) * 0.9;
  const top = 0.36 + 0.17 * Math.max(0, 1 - (R / (r0 * 0.82)) ** 2) ** 0.7, bot = 0.2;
  const d = Math.max(y - top, bot - y);
  return dPlan > 0 ? Math.hypot(dPlan, Math.max(d, 0)) : Math.max(dPlan, d);
}
function crabBodySpec() {
  let s = Fn([-0.75, 0.1, -0.75, 0.75, 0.6, 0.75], crabCarapace, RM.SHELL);
  // the underside: sternum and the folded abdomen
  s = U(0.05, s, E([-0.02, 0.2, 0], [0.42, 0.08, 0.36], RM.BELLY));
  // eyes on short stalks in orbits at the front
  for (const sd of [-1, 1]) s = U(0.012, s, Cap([0.5, 0.42, sd * 0.11], [0.6, 0.47, sd * 0.13], 0.03, 0.022, RM.SHELL), Sph([0.61, 0.475, sd * 0.135], 0.03, RM.EYE));
  // mouthparts: the third maxillipeds, a pair of plates under the front
  s = U(0.01, s, Mir(2, E([0.45, 0.26, 0.05], [0.09, 0.03, 0.045], RM.BELLY)));
  return Disp([
    { type: 'fn', amp: 0.008, bake: true, fn: (x, y, z) => {
      // granules over the carapace, the regions (gastric, cardiac, branchial) as soft grooves
      if (y < 0.3) return 0;
      wor2(x * 34, z * 34, 71, _w);
      const gran = 0.003 * Math.max(0, 1 - _w.f1 / 0.4) ** 2;
      const groove = -0.006 * Math.exp(-(((Math.abs(z) - 0.2 - 0.25 * x * x) / 0.02) ** 2)) * sst(0.4, 0.5, y) - 0.005 * Math.exp(-(((x + 0.08 + 0.3 * z * z) / 0.018) ** 2)) * (1 - sst(0.25, 0.35, Math.abs(z)));
      return gran + groove;
    } },
    { type: 'grain', amp: 0.0015, f: 80, seed: 16, bake: true }
  ], s);
}
function legSpec(L, rTop, rTip) {
  // a jointed leg: one capsule per podomere with a narrow arthrodial joint between
  const segs = [];
  for (let k = 0; k < L.p.length - 1; k++) {
    const a = L.p[k], b = L.p[k + 1], t0 = k / (L.p.length - 1), t1 = (k + 1) / (L.p.length - 1);
    const r0 = rTop + (rTip - rTop) * t0, r1 = rTop + (rTip - rTop) * t1;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const a2 = [a[0] + d[0] * 0.04, a[1] + d[1] * 0.04, a[2] + d[2] * 0.04], b2 = [b[0] - d[0] * 0.04, b[1] - d[1] * 0.04, b[2] - d[2] * 0.04];
    segs.push(Cap(a2, b2, r0, r1 * (k === L.p.length - 2 ? 0.35 : 0.9), RM.SHELL));
  }
  return U(0.012, ...segs);
}
function crabLegsSpec() {
  const legs = CRAB_LEGS.map(L => legSpec(L, 0.06, 0.032));
  // the cheliped: a heavy arm, the palm, the fixed finger and the dactyl, black tips
  const arm = legSpec(CHELA, 0.085, 0.09);
  const palm = E([1.18, 0.36, 0.68], [0.23, 0.13, 0.15], RM.SHELL, [0, -0.25, 0]);
  const dac = Tube([[1.3, 0.42, 0.62], [1.48, 0.43, 0.57], [1.6, 0.39, 0.64]], 0.05, 0.016, 8, RM.CLAW);
  const fix = Tube([[1.3, 0.3, 0.7], [1.48, 0.3, 0.67], [1.6, 0.35, 0.72]], 0.045, 0.014, 8, RM.CLAW);
  const chela = U(0.03, arm, palm, dac, fix);
  return Disp([
    { type: 'fn', amp: 0.005, bake: true, fn: (x, y, z) => { wor2(x * 40, (y + z) * 40, 73, _w); return 0.0025 * Math.max(0, 1 - _w.f1 / 0.35) ** 2; } },
    { type: 'grain', amp: 0.0012, f: 90, seed: 17, bake: true }
  ], Mir(2, U(0.0, ...legs, chela)));
}
function crabPaint() {
  return {
    kScale: 0.004, aoAlb: 0.5,
    mats: {
      [RM.SHELL]: { c: [0.42, 0.25, 0.15], ro: 0.5 }, [RM.BELLY]: { c: [0.76, 0.68, 0.56], ro: 0.5 },
      [RM.EYE]: { c: [0.03, 0.03, 0.03], ro: 0.05 }, [RM.CLAW]: { c: [0.05, 0.04, 0.035], ro: 0.3 }
    },
    layers: [
      { c: [0.76, 0.60, 0.46], a: 0.85, m: [mat(RM.SHELL), ['nd', [0, -1, 0], 0.1, 0.7]] },        // pale underside
      { c: [0.36, 0.17, 0.09], a: 0.5, m: [mat(RM.SHELL), ['n', 12, 0.45, 0.75, 81]] },
      { c: [0.70, 0.48, 0.32], a: 0.4, m: [mat(RM.SHELL), ['cvx', 0.4, 1.2]] },                      // granule tops
      { c: [0.86, 0.80, 0.70], a: 0.45, m: [mat(RM.SHELL), ['cav', 0.6, 1.4]] },                     // joint membranes paler
      { c: [0.02, 0.02, 0.02], a: 0.75, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// =============================================================================================
// LONG-SPINED URCHIN (fauna URCHIN: merge scale 0.75; static)
// =============================================================================================
const URC = { c: [0, 0.27, 0], r: [0.38, 0.27, 0.38] };
export const URCHIN_SPINES = (() => {
  const S = [];
  for (let i = 0; i < 130; i++) {
    const y = 1 - (i + 0.5) / 130 * 1.75, a = i * 2.399963, r = Math.sqrt(Math.max(0, 1 - y * y));
    if (y < -0.55) continue;                                      // the oral face is bare (tube feet, the mouth)
    const d = [Math.cos(a) * r, y, Math.sin(a) * r];
    const len = (0.42 + 0.38 * hash(i, 9)) * (0.6 + 0.4 * sst(-0.5, 0.3, y));
    S.push({ d, len, banded: hash(i, 10) < 0.7 });
  }
  return S;
})();
function urchinSpec() {
  let s = E(URC.c, URC.r, RM.SHELL);
  // flatten the oral face, sink the peristome
  s = { t: 'i', k: 0.03, ch: [s, { t: 'plane', n: [0, -1, 0], o: -0.04, m: RM.SHELL }] };
  s = Sub(0.02, RM.MOUTH, s, Sph([0, 0.0, 0], 0.07, RM.MOUTH));
  // the orange anal ring at the apex
  s = U(0.015, s, { t: 'torus', c: [0, URC.c[1] + URC.r[1] - 0.012, 0], R: 0.06, r: 0.018, m: RM.FOOT });
  const spines = URCHIN_SPINES.map(q => {
    const base = [URC.c[0] + q.d[0] * URC.r[0] * 0.95, URC.c[1] + q.d[1] * URC.r[1] * 0.95, URC.c[2] + q.d[2] * URC.r[2] * 0.95];
    const tip = [base[0] + q.d[0] * q.len, base[1] + q.d[1] * q.len, base[2] + q.d[2] * q.len];
    return { t: 'cone', a: base, b: tip, ra: 0.022, rb: 0.007, m: RM.SPINE };
  });
  // the boss each spine rides on (tubercle)
  const boss = URCHIN_SPINES.map(q => Sph([URC.c[0] + q.d[0] * URC.r[0] * 0.98, URC.c[1] + q.d[1] * URC.r[1] * 0.98, URC.c[2] + q.d[2] * URC.r[2] * 0.98], 0.03, RM.SHELL));
  s = U(0.02, s, ...boss);
  s = U(0.006, s, ...spines);
  return Disp([
    { type: 'fn', amp: 0.004, bake: true, fn: (x, y, z) => {
      // banded spines: rings of thicker calcite along each spine
      const r = Math.hypot(x, (y - URC.c[1]) / 0.75, z); if (r < 0.42) return 0;
      return 0.0018 * Math.sin(r * 120);
    } },
    { type: 'grain', amp: 0.0008, f: 140, seed: 18, bake: true }
  ], s);
}
function urchinPaint() {
  const band = S => { const r = Math.hypot(S.x, (S.y - URC.c[1]) / 0.75, S.z); return sst(0.3, 0.7, Math.sin(r * 32)) * sst(0.45, 0.5, r); };
  return {
    kScale: 0.004, aoAlb: 0.55,
    mats: {
      [RM.SHELL]: { c: [0.07, 0.06, 0.07], ro: 0.5 }, [RM.SPINE]: { c: [0.06, 0.055, 0.065], ro: 0.25 },
      [RM.MOUTH]: { c: [0.18, 0.12, 0.1], ro: 0.5 }, [RM.FOOT]: { c: [0.55, 0.26, 0.10], ro: 0.4 }
    },
    layers: [
      { c: [0.26, 0.25, 0.24], a: 0.4, m: [mat(RM.SPINE), ['fn', band]] },
      // the blue iridophore spots on the test between the ambulacra
      { c: [0.16, 0.24, 0.36], a: 0.6, m: [mat(RM.SHELL), ['n', 18, 0.62, 0.8, 91]] },
      { c: [0.02, 0.02, 0.02], a: 0.8, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// =============================================================================================
// SEA STAR (fauna SEA STAR: merge scale 0.7; static)
// =============================================================================================
function starArm(x, y, z) {
  // five tapering arms, rounded in section, the disc in the middle
  const a = Math.atan2(z, x), r = Math.hypot(x, z);
  const k = Math.round(a / (TAU / 5)) * (TAU / 5), da = a - k;
  const along = r * Math.cos(da), across = r * Math.sin(da);
  const w = 0.24 * (1 - 0.78 * clamp(along / 1.0, 0, 1)) + 0.02 + 0.08 * Math.max(0, 1 - along / 0.25);
  const h = 0.17 * (1 - 0.7 * clamp(along / 1.0, 0, 1)) + 0.03;
  const dy = y - 0.03;
  const k0 = Math.hypot(across / w, Math.max(0, dy) / h + Math.min(0, dy) / 0.05);
  const d = (k0 - 1) * Math.min(w, h) * 0.8;
  const dx = along - 1.0;
  return dx > 0 ? Math.hypot(Math.max(d, 0), dx) : d;
}
function starSpec() {
  let s = Fn([-1.05, -0.05, -1.05, 1.05, 0.3, 1.05], starArm, RM.SKIN);
  // the madreporite: a small sieve plate off-centre on the disc
  s = U(0.01, s, E([0.1, 0.19, 0.06], [0.04, 0.012, 0.04], RM.SCALE));
  return Disp([
    { type: 'fn', amp: 0.012, fn: (x, y, z) => {
      if (y < 0.05) return 0;
      // the reticulated ossicle net, spines (white-tipped) on the ossicle crossings
      wor2(x * 16, z * 16, 101, _w);
      return 0.006 * Math.max(0, 1 - _w.f1 / 0.32) ** 2 * (_w.id > 0.55 ? 1.6 : 0.8);
    } },
    { type: 'fn', amp: 0.006, bake: true, fn: (x, y, z) => {
      // tube feet in the ambulacral groove underneath
      if (y > 0.04) return 0;
      const a = Math.atan2(z, x), r = Math.hypot(x, z), k = Math.round(a / (TAU / 5)) * (TAU / 5), across = r * Math.sin(a - k);
      const groove = -0.012 * Math.exp(-((across / 0.03) ** 2));
      const feet = 0.004 * Math.max(0, Math.cos(r * 70)) * Math.exp(-(((Math.abs(across) - 0.02) / 0.012) ** 2));
      return groove + feet;
    } },
    { type: 'grain', amp: 0.0015, f: 90, seed: 19, bake: true }
  ], s);
}
function starPaint() {
  return {
    kScale: 0.006, aoAlb: 0.5,
    mats: { [RM.SKIN]: { c: [0.50, 0.25, 0.15], ro: 0.75 }, [RM.SCALE]: { c: [0.75, 0.6, 0.45], ro: 0.6 } },
    layers: [
      { c: [0.82, 0.74, 0.62], a: 0.75, m: [['cvx', 0.7, 1.6]] },              // spine tips pale
      { c: [0.36, 0.14, 0.08], a: 0.6, m: [['cav', 0.2, 0.9]] },
      { c: [0.82, 0.62, 0.42], a: 0.8, m: [['nd', [0, -1, 0], 0.2, 0.8]] },    // pale oral face
      { c: [0.44, 0.18, 0.12], a: 0.35, m: [['n', 5, 0.45, 0.75, 111]] },
      { c: [0.02, 0.02, 0.02], a: 0.75, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// =============================================================================================
// LABELS (runtime, fauna.js): authored (pre-scale) position -> L = { part, phase, kind, glow }
// SK kinds: 0 skin, 1 cornea, 3 fin membrane
// =============================================================================================
const near = (p, c, r) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < r;
export const LABELS = {
  manta: (x, y, z, L) => { L.part = 2; if (near([x, y, Math.abs(z)], M_EYE, M_EYER * 1.05)) { L.kind = 1; L.phase = M_EYER; } },
  mantaTail: (x, y, z, L) => { L.part = 1; },
  turtleBody: (x, y, z, L) => { if (near([x, y, Math.abs(z)], T_EYE, T_EYER * 1.05)) { L.kind = 1; L.phase = T_EYER; } },
  turtleFlip: (x, y, z, L) => { L.part = 7; L.phase = x > -0.42 ? 0 : Math.PI; },
  moray: (x, y, z, L) => { if (near([x, y, Math.abs(z)], [0.64, 0.12, 0.125], 0.04)) { L.kind = 1; L.phase = 0.038; } },
  morayJaw: (x, y, z, L) => { L.part = 4; },
  crabBody: (x, y, z, L) => { L.part = 0; },
  crabLegs: (x, y, z, L) => {
    // nearest leg spine (this side): walking legs alternate, the chela carries +-1.3
    const s = z < 0 ? -1 : 1, az = Math.abs(z);
    let best = 9, ph = 0;
    for (const lg of CRAB_LEGS) for (const q of lg.p) { const d = Math.hypot(x - q[0], y - q[1], az - q[2]); if (d < best) { best = d; ph = lg.phase + s * lg.side; } }
    for (const q of CHELA.p.concat([[1.3, 0.36, 0.66], [1.55, 0.38, 0.66]])) { const d = Math.hypot(x - q[0], y - q[1], az - q[2]); if (d < best) { best = d; ph = s * 1.3; } }
    L.part = 3; L.phase = ph;
  },
  urchin: (x, y, z, L) => { L.part = 0; },
  star: (x, y, z, L) => { L.part = 0; }
};

// =============================================================================================
// pipeline
// =============================================================================================
export function pipeline() {
  const P = (name, sdf, paint, h, loH, tris, o = {}) => Object.assign({ name, set: 'reef', sdf, paint, hi: { h }, lo: { h: loH, tris, err: loH * 3 }, kEps: h * 2, ao: { r: h * 12, n: 4 }, cage: h * 2.5, ray: h * 8 }, o);
  return {
    name: 'reef', out: 'assets/fauna/reef',
    sets: { reef: { size: 2048, gutter: 6, aoDist: 0.2, aoSamples: 48, fill: true } },
    pieces: [
      P('manta', mantaSpec(), mantaPaint(), 0.008, 0.013, 2800),
      P('mantaTail', mantaTailSpec(), mantaPaint(), 0.006, 0.012, 300),
      P('turtleBody', turtleBodySpec(), turtlePaint(), 0.006, 0.014, 2800),
      P('turtleFlip', turtleFlipSpec(), turtlePaint(true), 0.005, 0.011, 1400),
      P('moray', moraySpec(), morayPaint(), 0.006, 0.013, 2600),
      P('morayJaw', morayJawSpec(), morayPaint(), 0.004, 0.009, 600),
      P('crabBody', crabBodySpec(), crabPaint(), 0.005, 0.012, 900),
      P('crabLegs', crabLegsSpec(), crabPaint(), 0.004, 0.011, 1500),
      P('urchin', urchinSpec(), urchinPaint(), 0.003, 0.007, 2200),
      P('star', starSpec(), starPaint(), 0.005, 0.012, 1100)
    ],
    compress: { mesh: 'draco' },
    meta: { pieces: ['manta', 'mantaTail', 'turtleBody', 'turtleFlip', 'moray', 'morayJaw', 'crabBody', 'crabLegs', 'urchin', 'star'] }
  };
}
export function preview() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const want = (q.get('p') || 'manta').split(','), k = +(q.get('k') || 2);
  const P = pipeline(), parts = P.pieces.filter(p => want.includes(p.name));
  return {
    key: 'preview-' + want.join('-') + '-' + k + '-' + Math.random(),
    parts: parts.map(p => ({ name: p.name, sdf: p.sdf, h: p.hi.h * k, tris: p.lo.tris * 3, err: p.lo.h })),
    atlas: { size: +(q.get('s') || 1024), paint: parts[0].paint, kEps: parts[0].kEps, ao: parts[0].ao },
    layout: Object.fromEntries(parts.map(p => [p.name, [0, 0, 0]]))
  };
}
export const _test = { compile };
