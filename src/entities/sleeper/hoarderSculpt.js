// ORUNE, THE HOARDER — the sculpt (lib/sculpt.js specs + a tileable arm strip). Pure data
// builders: no THREE, no scene; runs in node (tools/blender pipeline) and in the browser
// (sculptlab preview).
//
// THE SPLIT (why, with the evidence in hoarder.js's header): what is RIGID or moves by a
// shader is sculpted and baked high-to-low — the mantle and head (breath is a uniform
// scale, the siphon pulse a vertex-shader bump keyed on the same SIPHON point), the web,
// the beak, both lids (they rotate as rigid pieces) and ONE sucker (instanced 288x on the
// arms). What DEFORMS stays procedural — the eight arm tubes are verlet chains rebuilt on
// the CPU every frame — and gets its sculpt as a TILEABLE STRIP: a heightfield over the
// tube's own (u, v) whose u is keyed to the sucker stations, so every baked socket sits
// under an instanced sucker whatever the arm is doing.
//
// Frame: hoarderGeo's unit frame (mantle radius Rm = 1), +Z the face, +Y up. hoarder.js
// scales the body by Rm. Anchors preserved: EYE_AT (the turret centre the eye group sits
// in), the arm roots (sin a * 0.52, -0.42, cos a * 0.52 + 0.10), SIPHON (-0.80, -0.36,
// 0.44), the collision centres and the sucker-hiding ellipsoid (the silhouette keeps the
// old sac's reach: head to z 0.62, sac back to z -1.5 and up to y ~1.0, crown at -0.42).
//
// The design: an ANCIENT octopus. The sac is heavy and slack — it sags back and down onto
// the silt in folds; the skin is warty and papillate over a reticulate net; the eyes sit
// in raised turrets under heavy brow folds and thick, rolled lids; a web of skin skirts the
// crown between the arm roots; a parrot beak in the buccal ring under it. She has lived
// round the trawler for a long time and it shows: a length of its CHAIN is grown into a
// groove across her back (flesh healed over the links), the diamond lattice of its NET is
// scarred into her left flank, and three parallel slashes from its screw cross her right.
import { compile, mulberry } from '../../lib/sculpt.js';
import { tnoise } from '../../../tools/blender/strip.mjs';

const TAU = Math.PI * 2;
const E = (c, r, m = 0, e) => ({ t: 'ellip', c, r, m, e });
const Sph = (c, r, m = 0) => ({ t: 'sphere', c, r, m });
const Cap = (a, b, ra, rb = ra, m = 0) => ({ t: 'cap', a, b, ra, rb, m });
const U = (k, ...ch) => ({ t: 'u', k, ch });
const Sub = (k, a, ...b) => ({ t: 's', k, ch: [a, ...b] });
const SubM = (k, m, a, ...b) => ({ t: 's', k, m, ch: [a, ...b] });
const I = (k, ...ch) => ({ t: 'i', k, ch });
const Tube = (p, r0, r1, n = 10, m = 0) => ({ t: 'tube', p, r: [r0, r1], n, m });
const Pl = (n, o, m = 0) => ({ t: 'plane', n, o, m });
const Tor = (c, R, r, m, rot) => ({ t: 'torus', c, R, r, m, rot });
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// rows of a local->world rotation whose local Y is `up` (for tori: their axis)
function yTo(up) {
  const Y = norm(up), X = norm(Math.abs(Y[0]) < 0.9 ? cross(Y, [1, 0, 0]) : cross(Y, [0, 0, 1])), Z = cross(X, Y);
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
}

export const M = { SKIN: 0, BELLY: 1, SCAR: 2, IRON: 3, BEAK: 4, LIP: 5, MEMB: 6, WART: 7, CHITIN: 8 };
export const EYE_AT = [0.52, 0.30, 0.34];
export const EYE_C = [0.52, 0.32, 0.34];                       // the eye group's centre (EYE_AT + 0.02 y)
export const SIPHON = [-0.80, -0.36, 0.44];
const EYE_YAW = 0.75;

// ---- the base mass --------------------------------------------------------------------
function massSpec() {
  const head = E([0, 0.04, 0.16], [0.70, 0.46, 0.50]);
  const neck = E([0, 0.12, -0.20], [0.76, 0.48, 0.52]);
  const sac = E([0, 0.42, -0.66], [0.84, 0.60, 0.90], 0, [0.40, 0, 0]);
  // the slack rear: the sac's weight slumps back and down (it lies on the silt asleep)
  const slump = E([0, 0.20, -1.06], [0.66, 0.36, 0.48], 0, [-0.15, 0, 0]);
  const hips = [1, -1].map(sd => E([sd * 0.42, 0.18, -0.72], [0.42, 0.40, 0.62], 0, [0.2, sd * 0.2, 0]));
  const turrets = [1, -1].map(sd => E([sd * EYE_AT[0], EYE_AT[1] + 0.02, EYE_AT[2]], [0.23, 0.22, 0.23]));
  let m = U(0.16, head, neck, sac, slump, ...hips);
  m = U(0.12, m, ...turrets);
  // the crown underneath is flat where she rests on it
  m = I(0.06, m, Pl([0, -1, 0], 0.42));
  return m;
}
let _mass = null;
function mass() { if (!_mass) _mass = compile(massSpec()); return _mass; }
// the surface point on a ray from `c` along `d` (marched inward from outside)
function surf(dir, c = [0, 0.25, -0.35]) {
  const f = mass().f, d = norm(dir);
  let t = 2.4;
  for (let i = 0; i < 200; i++) { const p = add(c, d, t), v = f(p[0], p[1], p[2]); if (Math.abs(v) < 1e-4) break; t -= v * 0.9; if (t < 0) return null; }
  return add(c, d, t);
}
function nrmAt(p) {
  const f = mass().f, e = 0.004;
  return norm([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
}
// a polyline laid on the surface between two directions from the centre (n samples), as
// a chain of capsules sunk `sink` below it (a groove when subtracted, a cord when added)
function surfLine(d0, d1, n, r, sink, m, c) {
  const P = [];
  for (let i = 0; i <= n; i++) { const p = surf(lerp3(d0, d1, i / n), c); if (p) P.push(add(p, nrmAt(p), -sink)); }
  const caps = [];
  for (let i = 1; i < P.length; i++) caps.push(Cap(P[i - 1], P[i], r, r, m));
  return { caps, pts: P };
}

// ---- the eyes: raised turrets, sockets, heavy brow folds ------------------------------------
function eyeSpec() {
  const add_ = [], cut = [];
  for (const sd of [1, -1]) {
    const c = [sd * EYE_C[0], EYE_C[1], EYE_C[2]], look = [sd * Math.sin(EYE_YAW), 0, Math.cos(EYE_YAW)];
    cut.push(Cap(c, add(c, look, 0.4), 0.19, 0.20, M.LIP));                                   // the socket, open to the front
    // the orbit's rolled rim, facing where the eye looks, and two slack rings of skin
    add_.push(Tor(add(c, look, 0.02), 0.215, 0.034, M.SKIN, yTo(look)));
    add_.push(Tor(add(c, look, -0.035), 0.255, 0.022, M.SKIN, yTo(add(look, [0, 0.25, 0]))));
    // the heavy brow: a fold of skin overhanging the eye from above, lower at its outer end
    const side = norm(cross([0, 1, 0], look));
    const b0 = add(add(c, [0, 0.19, 0]), side, 0.16 * sd), b1 = add(add(add(c, [0, 0.20, 0]), look, 0.07), [0, 0, 0]), b2 = add(add(c, [0, 0.12, 0]), side, -0.20 * sd);
    add_.push(Tube([b0, b1, b2], 0.055, 0.04, 10, M.SKIN));
    // the lower bag under the eye
    add_.push(Tube([add(add(c, [0, -0.17, 0]), side, 0.12 * sd), add(add(c, [0, -0.20, 0]), look, 0.08), add(add(c, [0, -0.14, 0]), side, -0.17 * sd)], 0.04, 0.03, 10, M.SKIN));
  }
  return { add: add_, cut };
}

// ---- warts: seeded domes scattered over the dorsal skin, larger on the sac ---------------
function wartsSpec(seed) {
  const rnd = mulberry(seed), out = [];
  for (let k = 0; k < 170; k++) {
    let d;
    for (;;) { d = [rnd() * 2 - 1, rnd() * 1.6 - 0.45, rnd() * 2 - 1.1]; if (Math.hypot(d[0], d[1], d[2]) > 0.3) break; }
    const p = surf(d);
    if (!p || p[1] < -0.28) continue;
    // not in the eye sockets, not on the chain/scar ground
    let bad = false;
    for (const sd of [1, -1]) if (Math.hypot(p[0] - sd * EYE_C[0], p[1] - EYE_C[1], p[2] - EYE_C[2]) < 0.30) bad = true;
    if (bad) continue;
    const onSac = sst(0.0, -0.6, p[2]);
    const r = (0.012 + 0.058 * Math.pow(rnd(), 2.6)) * (0.7 + 0.6 * onSac), n = nrmAt(p);
    out.push(E(add(p, n, -r * 0.5), [r, r * (0.8 + 0.3 * rnd()), r], M.WART));
    // a warty cluster: the big ones carry satellites
    if (r > 0.045) for (let j = 0; j < 3; j++) {
      const q = add(p, [(rnd() - 0.5) * r * 3, (rnd() - 0.5) * r * 2, (rnd() - 0.5) * r * 3]), qq = surf([q[0], q[1] - 0.25, q[2] + 0.35]);
      if (qq) { const rr = r * (0.3 + 0.25 * rnd()); out.push(Sph(add(qq, nrmAt(qq), -rr * 0.3), rr, M.WART)); }
    }
  }
  return out;
}

// ---- the slack folds: the sac hangs; heavy rolls along its lower flanks and rear -----------
function foldsSpec() {
  const valleys = [], rolls = [];
  const F = [
    [[0.95, -0.05, -0.3], [0.9, 0.1, -1.0], 0.045], [[0.85, 0.25, -0.2], [0.75, 0.45, -1.0], 0.035],
    [[-0.95, -0.05, -0.35], [-0.9, 0.05, -1.0], 0.045], [[-0.8, 0.3, -0.25], [-0.7, 0.5, -0.95], 0.03],
    [[0.5, 0.0, -1.2], [-0.5, 0.0, -1.2], 0.05], [[0.45, 0.35, -1.1], [-0.45, 0.35, -1.1], 0.04]
  ];
  for (const [a, b, r] of F) {
    const g = surfLine(a, b, 10, r * 0.55, r * 0.15, M.SKIN);
    valleys.push(...g.caps);
    // the roll of skin above the crease
    const h = surfLine(add(a, [0, 0.08, 0]), add(b, [0, 0.08, 0]), 10, r, r * 0.55, M.SKIN);
    rolls.push(...h.caps);
  }
  return { valleys, rolls };
}

// ---- the web: a skirt of skin between the arm roots, scalloped ---------------------------------
export const ARM_ROOT = a => { const ang = (a + 0.5) / 8 * TAU; return [Math.sin(ang) * 0.52, -0.42, Math.cos(ang) * 0.52 + 0.10]; };
function webSpec() {
  // a conical skirt of skin under the crown, open beneath, its free edge scalloped between
  // the arm roots (the arms come out through it)
  const C = (a, b, ra, rb, m) => ({ t: 'cone', a, b, ra, rb, m });
  const outer = C([0, -0.26, 0.10], [0, -0.54, 0.10], 0.60, 0.84, M.MEMB);
  const inner = C([0, -0.30, 0.10], [0, -0.60, 0.10], 0.56, 0.84, M.BELLY);
  let w = Sub(0.015, outer, inner);
  const bites = [];
  for (let a = 0; a < 8; a++) { const ang = (a + 1) / 8 * TAU; bites.push(E([Math.sin(ang) * 0.92, -0.60, Math.cos(ang) * 0.92 + 0.10], [0.22, 0.20, 0.22], M.MEMB)); }
  // the web is slack: it ruckles between the roots
  return { t: 'disp', L: [{ type: 'fbm', amp: 0.02, f: 6, oct: 2, seed: 61, mask: [['ax', 1, -0.36, -0.5]] }], ch: [Sub(0.03, w, ...bites)] };
}

// ---- the beak in its buccal ring (under the crown, at the arms' centre) --------------------------
function beakSpec() {
  const c = [0, -0.44, 0.12];
  const lips = Tor([c[0], c[1] + 0.01, c[2]], 0.10, 0.042, M.LIP);
  // upper mandible: a deep hooked blade curving down and forward to a point
  const up = I(0.008, Tube([[0, c[1] + 0.03, c[2] - 0.05], [0, c[1] - 0.05, c[2] + 0.07], [0, c[1] - 0.13, c[2] + 0.05], [0, c[1] - 0.14, c[2] - 0.01]], 0.07, 0.006, 16, M.BEAK),
    Pl([1, 0, 0], 0.05, M.BEAK), Pl([-1, 0, 0], 0.05, M.BEAK));
  // lower mandible: shorter, set behind, its edge meeting the hook
  const lo = I(0.008, Tube([[0, c[1] + 0.02, c[2] - 0.08], [0, c[1] - 0.06, c[2] - 0.06], [0, c[1] - 0.10, c[2] + 0.02]], 0.06, 0.008, 12, M.BEAK),
    Pl([1, 0, 0], 0.058, M.BEAK), Pl([-1, 0, 0], 0.058, M.BEAK));
  return U(0.01, lips, up, lo);
}

// ---- the siphon: a muscular funnel under the left eye, lipped, dark inside -----------------------
function siphonSpec() {
  const P = [[-0.50, -0.20, 0.0], [-0.72, -0.26, 0.20], [-0.80, -0.36, 0.44]];
  const outer = U(0.02, Tube(P, 0.11, 0.088, 12, M.SKIN), Tor(P[2], 0.08, 0.022, M.SKIN, yTo(norm([-0.08, -0.1, 0.24]))));
  const bore = Tube([[-0.68, -0.25, 0.16], [-0.78, -0.33, 0.38], [-0.84, -0.39, 0.56]], 0.052, 0.06, 8, M.LIP);
  return SubM(0.012, M.LIP, outer, bore);
}

// ---- the trawler's marks -----------------------------------------------------------------------
// the CHAIN: grown into a groove across her back, the links half buried in healed flesh
function chainSpec() {
  const g = surfLine([-0.95, 0.35, -0.05], [0.9, 0.55, -0.95], 40, 0.034, 0.0, M.SCAR);
  const links = [], P = g.pts;
  // walk the polyline by arc length, a link every 0.052
  let acc = 0, k = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    while (acc < L) {
      const p = lerp3(a, b, acc / L), n = nrmAt(p);
      // alternate links: one lying flat on the skin, the next standing on edge; half sunk
      const flat = (k & 1) === 0, ax = flat ? n : norm(cross(t, n));
      const c = add(p, n, flat ? -0.006 : -0.012);
      // an elongated link: two tori halves bridged — approximated by an ellipsoidal ring
      links.push({ t: 'xf', R: (() => { const Y = ax, X = t, Z = norm(cross(X, Y)); return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]]; })(), p: c,
        ch: [{ t: 'u', k: 0, ch: [Tor([0.012, 0, 0], 0.018, 0.0085, M.IRON), Tor([-0.012, 0, 0], 0.018, 0.0085, M.IRON), Cap([-0.012, 0, 0.018], [0.012, 0, 0.018], 0.0085, 0.0085, M.IRON), Cap([-0.012, 0, -0.018], [0.012, 0, -0.018], 0.0085, 0.0085, M.IRON)] }] });
      acc += 0.052; k++;
    }
    acc -= L;
  }
  return { groove: g.caps, links };
}
// the NET: a diamond lattice of thin healed scars over the left flank of the sac
function netSpec() {
  const out = [];
  for (let i = -4; i <= 4; i++) {
    const o = i * 0.11;
    out.push(...surfLine([-1, 0.2 + o, -0.35 + o], [-1, 0.75 + o, -1.0 + o], 10, 0.009, 0.001, M.SCAR).caps);
    out.push(...surfLine([-1, 0.75 + o, -0.35 - o], [-1, 0.2 + o, -1.0 - o], 10, 0.009, 0.001, M.SCAR).caps);
  }
  return out;
}
// the SCREW: three parallel slashes across the right flank, deep, healed with raised lips
function slashSpec() {
  const cuts = [], lips = [];
  for (let i = 0; i < 3; i++) {
    const o = i * 0.13;
    const g = surfLine([1, 0.72 - o, -0.35 - o * 0.4], [1, 0.05 - o, -0.95 - o * 0.3], 14, 0.028 - 0.005 * i, 0.012, M.SCAR);
    cuts.push(...g.caps);
    for (const sd of [1, -1]) {
      const h = surfLine([1, 0.72 - o + sd * 0.04, -0.35 - o * 0.4], [1, 0.05 - o + sd * 0.04, -0.95 - o * 0.3], 14, 0.012, 0.004, M.SCAR);
      lips.push(...h.caps);
    }
  }
  return { cuts, lips };
}

// ---- the whole mantle ---------------------------------------------------------------------
export function mantleSpec(seed = 0x0A7E5) {
  const eye = eyeSpec(), folds = foldsSpec(), chain = chainSpec(), slash = slashSpec();
  let b = massSpec();
  b = U(0.05, b, ...eye.add);
  b = U(0.04, b, ...folds.rolls);
  b = U(0.03, b, webSpec());
  b = U(0.05, b, siphonSpec());
  b = U(0.02, b, beakSpec());
  b = U(0.012, b, ...wartsSpec(seed));
  b = U(0.008, b, ...slash.lips);
  b = SubM(0.03, M.SKIN, b, ...folds.valleys);
  b = SubM(0.012, M.SCAR, b, ...slash.cuts, ...chain.groove);
  b = SubM(0.005, M.SCAR, b, ...netSpec());
  b = SubM(0.02, M.LIP, b, ...eye.cut);
  b = U(0.004, b, ...chain.links);
  const sac = ['ax', 2, -0.1, -0.7];
  return {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.022, f: 2.2, oct: 3, seed: 10 },
      { type: 'fbm', amp: 0.008, f: 5.5, oct: 3, seed: 11 },
      { type: 'bands', amp: 0.006, f: 30, ax: [0, 0.35, 0.94], mask: [sac] },                       // slack wrinkles across the sac
      { type: 'cracks', amp: 0.006, f: 5.0, w: 0.05, heal: 1.2, seed: 12, mask: [['n', 1.6, 0.55, 0.72, 13]] },   // old healed tears
      // bake-only: papillae, the reticulate net, fine wrinkles, pores, grain
      { type: 'pits', bake: true, amp: -0.007, f: 26, dens: 0.35, r: 0.32, seed: 14, mask: [['ax', 1, -0.3, -0.1]] },
      { type: 'pits', bake: true, amp: -0.004, f: 60, dens: 0.4, r: 0.3, seed: 15 },
      { type: 'cracks', bake: true, amp: 0.0035, f: 9, w: 0.06, seed: 16 },
      { type: 'bands', bake: true, amp: 0.0022, f: 140, ax: [0.2, 0.3, 0.93], mask: [['n', 3, 0.4, 0.7, 17]] },
      { type: 'pits', bake: true, amp: 0.0018, f: 120, dens: 0.3, r: 0.25, seed: 18 },
      { type: 'grain', bake: true, amp: 0.0012, f: 220, seed: 19 }
    ], ch: [b]
  };
}

// ---- photophores: faint violet freckles (emissive, baked into the ORM's B) ----------------------
// A seeded point in every 0.075 cell of the skin, a third of them lit; a lens where they sit.
function hashc(x, y, z, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(s, 144665); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
export function photo(x, y, z, cell = 0.075, lr = 0.010, dens = 0.33, seed = 0xF070) {
  const X = Math.floor(x / cell), Y = Math.floor(y / cell), Z = Math.floor(z / cell);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = X + dx, cy = Y + dy, cz = Z + dz;
    if (hashc(cx, cy, cz, seed) > dens) continue;
    const px = (cx + 0.2 + 0.6 * hashc(cx, cy, cz, seed + 1)) * cell, py = (cy + 0.2 + 0.6 * hashc(cx, cy, cz, seed + 2)) * cell, pz = (cz + 0.2 + 0.6 * hashc(cx, cy, cz, seed + 3)) * cell;
    const d = Math.hypot(px - x, py - y, pz - z) / (lr * (0.7 + 0.6 * hashc(cx, cy, cz, seed + 4)));
    if (d < best) best = d;
  }
  return best;
}
const onSkin = S => (S.y > -0.30 ? 1 : 0) * (1 - sst(0.28, 0.2, Math.hypot(Math.abs(S.x) - EYE_C[0], S.y - EYE_C[1], S.z - EYE_C[2])));
const lensMask = S => onSkin(S) * (1 - sst(0.75, 1.0, photo(S.x, S.y, S.z)));
export const mantleEmit = S => { const d = photo(S.x, S.y, S.z); return onSkin(S) * Math.min(1, (1 - sst(0.0, 0.5, d)) + 0.25 * Math.exp(-(d / 2) * (d / 2))); };

// ---- paint ------------------------------------------------------------------------------------
// A deep mauve-brown mottled over a reticulate net, paler warts, a corpse-pale crown and
// web, pale pink-grey scar tissue, the chain rusted black-brown with bright wear on its
// crowns, a dark horn beak paling at its cutting edges. Palette sits on the old skin's (the
// zone-1 lighting was balanced against it).
export const PAINT = {
  kScale: 0.02, aoAlb: 0.6,
  mats: {
    [M.SKIN]: { c: [0.36, 0.21, 0.20], ro: 0.42 },
    [M.BELLY]: { c: [0.58, 0.46, 0.43], ro: 0.45 },
    [M.SCAR]: { c: [0.62, 0.50, 0.47], ro: 0.60 },
    [M.IRON]: { c: [0.16, 0.09, 0.05], ro: 0.75 },
    [M.BEAK]: { c: [0.07, 0.05, 0.04], ro: 0.30 },
    [M.LIP]: { c: [0.30, 0.13, 0.14], ro: 0.35 },
    [M.MEMB]: { c: [0.48, 0.34, 0.32], ro: 0.40 },
    [M.WART]: { c: [0.40, 0.25, 0.22], ro: 0.50 },
    [M.CHITIN]: { c: [0.40, 0.28, 0.12], ro: 0.35 }
  },
  layers: [
    { c: [0.16, 0.075, 0.075], a: 0.9, m: [['n', 2.2, 0.42, 0.62, 31], ['nd', [0, 1, 0], -0.3, 0.4], ['inv', ['mat', M.IRON]], ['inv', ['mat', M.BEAK]]] },   // dark patches on the dorsum
    { c: [0.55, 0.34, 0.24], a: 0.6, m: [['n', 5, 0.52, 0.72, 32], ['inv', ['mat', M.IRON]], ['inv', ['mat', M.BEAK]]] },                             // rust-ochre mottle
    { c: [0.10, 0.04, 0.05], a: 0.7, m: [['wor', 7, 0.07, 33], ['inv', ['mat', M.IRON]], ['inv', ['mat', M.BEAK]], ['inv', ['mat', M.SCAR]]] },       // the reticulate net
    { c: [0.60, 0.42, 0.37], a: 0.6, m: [['n', 6.5, 0.60, 0.70, 38], ['inv', ['mat', M.IRON]], ['inv', ['mat', M.BEAK]], ['inv', ['mat', M.LIP]]] },     // pale blotches
    { c: [0.60, 0.47, 0.44], a: 0.85, m: [['nd', [0, -1, 0], 0.15, 0.75], ['inv', ['mat', M.IRON]], ['inv', ['mat', M.BEAK]], ['inv', ['mat', M.LIP]]] },   // pale beneath
    { c: [0.58, 0.44, 0.38], a: 0.7, m: [['mat', M.WART], ['cvx', 0.3, 1.2]] },                                                                         // wart tips pale
    { c: [0.14, 0.06, 0.06], a: 0.6, ro: 0.3, m: [['cav', 0.15, 0.7], ['inv', ['mat', M.IRON]]] },                                                      // wet dark creases
    { c: [0.70, 0.58, 0.54], a: 0.6, m: [['mat', M.SCAR], ['cvx', 0.2, 0.9]] },                                                                          // callus ridges bleached
    { c: [0.30, 0.13, 0.05], a: 0.8, ro: 0.85, m: [['mat', M.IRON], ['n', 18, 0.35, 0.7, 34]] },                                                        // rust bloom
    { c: [0.42, 0.36, 0.30], a: 0.7, ro: 0.4, m: [['mat', M.IRON], ['cvx', 0.5, 1.4]] },                                                                // worn crowns
    { c: [0.42, 0.33, 0.22], a: 0.8, ro: 0.4, m: [['mat', M.BEAK], ['cvx', 0.3, 1.0]] },                                                                // the beak's worn edges
    { c: [0.40, 0.38, 0.52], a: 0.55, ro: 0.15, m: [['fn', lensMask]] },                                                                                  // photophore lenses
    { c: [0.05, 0.02, 0.02], a: 0.85, m: [['ao', 0.55, 0.95]] }
  ]
};

// ---- lids: thick, slack, rolled at the lip (eye-group frame: ball r 0.16 at the origin) ------
function lidSpec(lower) {
  const sg = lower ? -1 : 1, Ro = lower ? 0.212 : 0.226, Ri = 0.184;
  let shell = Sub(0.006, Sph([0, 0, 0], Ro, M.SKIN), Sph([0, 0, 0], Ri, M.LIP));
  shell = I(0.004, shell, Pl([0, -sg, 0], 0.0, M.SKIN));
  // the heavy rolled lip round the equator, a second slack roll above it
  const lip = Tor([0, sg * 0.004, 0], (Ro + Ri) / 2 + 0.006, lower ? 0.026 : 0.032, M.WART);
  const roll = Tor([0, sg * 0.055, 0], (Ro + Ri) / 2 - 0.004, 0.018, M.SKIN);
  let l = U(0.012, shell, lip, roll);
  // a few warts on the lid
  const rnd = mulberry(lower ? 71 : 70), w = [];
  for (let k = 0; k < 9; k++) {
    const th = rnd() * TAU, ph = 0.35 + 0.8 * rnd(), d = [Math.cos(th) * Math.sin(ph), sg * Math.cos(ph), Math.sin(th) * Math.sin(ph)], r = 0.008 + 0.012 * rnd();
    w.push(Sph(add([0, 0, 0], d, Ro - r * 0.2), r, M.WART));
  }
  l = U(0.006, l, ...w);
  return {
    t: 'disp', L: [
      { type: 'bands', amp: 0.0025, f: 120, ax: [0, 1, 0], mask: [['ax', 1, sg * 0.03, sg * 0.10]] },    // folds parallel to the lip
      { type: 'pits', bake: true, amp: -0.0015, f: 160, dens: 0.4, r: 0.3, seed: 81 },
      { type: 'grain', bake: true, amp: 0.0006, f: 400, seed: 82 }
    ], ch: [l]
  };
}

// ---- the sucker (instanced on the arms): unit rim radius ~1, facing +Y ------------------------
// A fleshy stalk out of the arm, a heavy rolled rim, a ring of worn CHITIN inside it (old,
// cracked, chipped), the ridged infundibulum and the dark acetabulum at the centre.
function suckerSpec() {
  // a squat cushion (no brim: the rim is the cushion's own rolled edge) on a hidden stalk
  const stalk = { t: 'cone', a: [0, -0.70, 0], b: [0, -0.1, 0], ra: 0.62, rb: 0.80, m: M.MEMB };
  const cushion = E([0, -0.06, 0], [1.0, 0.40, 1.0], M.MEMB);
  let s = U(0.12, stalk, cushion);
  // the rim: a thick rolled lip standing a little proud of the cushion
  s = U(0.10, s, Tor([0, 0.18, 0], 0.74, 0.16, M.WART));
  // the cup (infundibulum) and, inside its lip, the ring of worn chitin
  s = SubM(0.05, M.LIP, s, E([0, 0.44, 0], [0.62, 0.38, 0.62], M.LIP));
  const ring = Tor([0, 0.20, 0], 0.57, 0.055, M.CHITIN);
  const ridges = [];
  for (let k = 0; k < 18; k++) { const a = k / 18 * TAU; ridges.push(Cap([Math.cos(a) * 0.18, 0.08, Math.sin(a) * 0.18], [Math.cos(a) * 0.50, 0.14, Math.sin(a) * 0.50], 0.028, 0.034, M.LIP)); }
  s = U(0.015, s, ring, ...ridges);
  s = SubM(0.03, M.BEAK, s, Cap([0, 0.3, 0], [0, -0.3, 0], 0.14, 0.09, M.BEAK));
  // chips out of the chitin ring (worn, broken)
  const rnd = mulberry(91), chips = [];
  for (let k = 0; k < 5; k++) { const a = rnd() * TAU; chips.push(Sph([Math.cos(a) * 0.57, 0.26, Math.sin(a) * 0.57], 0.045 + 0.03 * rnd(), M.CHITIN)); }
  s = SubM(0.01, M.CHITIN, s, ...chips);
  return {
    t: 'disp', L: [
      { type: 'fbm', amp: 0.02, f: 3, oct: 3, seed: 92 },
      { type: 'bands', bake: true, amp: 0.008, f: 40, ax: [0, 1, 0], mask: [['rad', 0.75, 0.95]] },
      { type: 'cracks', bake: true, amp: 0.008, f: 5, w: 0.05, seed: 93, mask: [['rad', 0.45, 0.52], ['inv', ['rad', 0.62, 0.70]]] },
      { type: 'pits', bake: true, amp: 0.006, f: 14, dens: 0.3, r: 0.3, seed: 94 },
      { type: 'grain', bake: true, amp: 0.004, f: 30, seed: 95 }
    ], ch: [s]
  };
}
export const SUCKER_PAINT = {
  kScale: 0.004, aoAlb: 0.5,
  mats: {
    [M.MEMB]: { c: [0.40, 0.26, 0.25], ro: 0.45 },
    [M.WART]: { c: [0.58, 0.49, 0.46], ro: 0.40 },
    [M.LIP]: { c: [0.46, 0.30, 0.31], ro: 0.25 },
    [M.CHITIN]: { c: [0.36, 0.23, 0.09], ro: 0.30 },
    [M.BEAK]: { c: [0.08, 0.03, 0.03], ro: 0.2 }
  },
  layers: [
    { c: [0.62, 0.52, 0.34], a: 0.75, m: [['mat', M.CHITIN], ['cvx', 0.3, 1.2]] },          // worn chitin, pale at its crowns
    { c: [0.70, 0.63, 0.59], a: 0.45, m: [['mat', M.WART], ['cvx', 0.4, 1.4]] },
    { c: [0.30, 0.18, 0.17], a: 0.5, m: [['mat', M.WART], ['n', 5, 0.45, 0.7, 96]] },
    { c: [0.30, 0.14, 0.14], a: 0.6, m: [['cav', 0.2, 0.8]] },
    { c: [0.04, 0.02, 0.02], a: 0.8, m: [['ao', 0.5, 0.95]] }
  ]
};

// ---- THE ARM STRIP ------------------------------------------------------------------------
// One tile = ARM_PAIRS sucker pairs along u, once round in v (v = 0 the dorsal crest, 0.5
// the oral face; v = a / TAU of the tube's section angle). Physical units are the local arm
// radius r (the tile is conformal: both the sucker step and the circumference scale with
// r), so one heightfield serves the whole taper. Sucker k sits at u = k / (2 ARM_PAIRS):
// even k on v = 0.5 + SV, odd on v = 0.5 - SV (hoarder.js's side rule: odd = +B = sin a > 0).
export const ARM_PAIRS = 4, ARM_STEP = 1.04, ARM_SV = 0.0553, SUCK_K = 0.34;
function armStrip() {
  const N = tnoise(0xA2A), Lu = 2 * ARM_PAIRS * ARM_STEP, Lv = 6.1;
  const cw = {}, cc = {}, cp = {}, cs = {};
  const suck = [];
  for (let k = 0; k < 2 * ARM_PAIRS; k++) suck.push([k / (2 * ARM_PAIRS), 0.5 + ((k & 1) ? -ARM_SV : ARM_SV)]);
  const wrapd = x => x - Math.round(x);
  return {
    name: 'arm', W: 1024, H: 768, Lu, Lv, kScale: 0.02, ao: { r: 0.35, dirs: 8, steps: 6 },
    field(u, v, S) {
      const a = v * TAU, cosA = Math.cos(a);
      const oral = sst(-0.35, -0.75, cosA), dors = sst(0.2, 0.8, cosA);
      // sucker sockets: a raised collar round each stalk, radial creases pulled into it
      let col = 0, crease = 0, sd = 9;
      for (const [su, sv] of suck) {
        const du = wrapd(u - su) * Lu, dv = wrapd(v - sv) * Lv, d = Math.hypot(du, dv) / SUCK_K;
        if (d < sd) sd = d;
        if (d < 2.4) {
          col += Math.exp(-(((d - 1.15) / 0.28) ** 2));
          crease += (1 - sst(1.3, 2.0, d)) * sst(0.95, 1.3, d) * Math.pow(Math.abs(Math.sin(Math.atan2(dv, du) * 5 + su * 40 + 2 * N.fbm(u, v, 8, 6, 2))), 4) * 0.5;
        }
      }
      // the oral furrow between the rows, fine transverse wrinkles over the oral face
      const furrow = Math.exp(-(((wrapd(v - 0.5) * Lv) / 0.08) ** 2));
      const wr = Math.pow(Math.abs(Math.sin((u * Lu * 9.5 + 0.8 * N.fbm(u, v, 4, 6, 3)) * Math.PI)), 3);
      // dorsal: warts (big, few) and papillae (small, many), a reticulate net of grooves,
      // the crest ridge, longitudinal skin folds on the flanks — all in a WARPED domain (the
      // warp is itself periodic, so the tile still tiles) so no cell reads as a polygon
      const wu = u + (N.fbm(u, v, 3, 2, 3) - 0.5) * 0.05, wv = v + (N.fbm(u + 0.5, v + 0.5, 3, 2, 3) - 0.5) * 0.07;
      N.cells(wu, wv, 16, 8, 0.85, 1, cw, Lv / Lu * 16 / 8);
      const wr_ = 0.20 + 0.22 * cw.id, wart = cw.id < 0.42 ? Math.max(0, 1 - (cw.f1 / wr_) ** 2) * (0.8 + 0.4 * N.fbm(u, v, 24, 16, 2)) : 0;
      N.cells(wu, wv, 40, 22, 0.9, 2, cp, Lv / Lu * 40 / 22);
      const pap = cp.id < 0.3 ? Math.max(0, 1 - (cp.f1 / 0.28) ** 2) : 0;
      N.cells(wu, wv, 18, 11, 0.95, 3, cc, Lv / Lu * 18 / 11);
      const net = (1 - sst(0.0, 0.30, cc.f2 - cc.f1)) * (0.3 + 0.7 * sst(0.4, 0.8, N.fbm(u, v, 6, 4, 3)));
      const crest = Math.exp(-(((wrapd(v) * Lv) / 0.12) ** 2));
      const flankFold = Math.pow(Math.abs(Math.sin(v * TAU * 3 + 1.7 * N.fbm(u, v, 3, 4, 3))), 12) * (1 - oral);
      const lump = N.fbm(u, v, 3, 3, 4);
      S.oral = oral; S.dors = dors; S.col = col; S.crease = crease; S.furrow = furrow; S.wart = wart * (1 - oral); S.pap = pap * (1 - oral);
      S.net = net * (1 - oral); S.sd = sd; S.crest = crest;
      S.blot = sst(0.52, 0.62, N.fbm(u + 0.2, v, 5, 3, 4));
      S.h = 0.06 * (lump - 0.5) + (1 - oral) * (0.07 * wart * wart + 0.022 * pap - 0.006 * net) + 0.02 * crest
        - 0.02 * flankFold + oral * (0.010 * wr - 0.04 * furrow) + 0.085 * col - 0.02 * crease;
      S.ph = photoStrip(u, v, N, cs, Lu, Lv) * dors;
    },
    paint(S) {
      const mot = sst(0.35, 0.75, N.fbm(S.u, S.v, 4, 3, 4)), mot2 = N.fbm(S.u + 0.3, S.v + 0.1, 12, 8, 3);
      const base = [0.36 - 0.14 * mot, 0.21 - 0.10 * mot, 0.20 - 0.09 * mot];
      const pale = [0.66, 0.53, 0.49];
      const c = base.map((q, i) => q + (pale[i] - q) * S.oral);
      for (let i = 0; i < 3; i++) {
        c[i] *= 0.85 + 0.3 * mot2;
        c[i] += ([0.58, 0.44, 0.38][i] - c[i]) * (S.wart * 0.7 + S.pap * 0.4);
        c[i] *= 1 - 0.18 * S.net;
        c[i] = c[i] * (1 - 0.45 * S.blot * (1 - S.oral)) + 0.02 * S.blot;
        c[i] += ([0.70, 0.58, 0.54][i] - c[i]) * Math.min(1, S.col * 0.45) * S.oral;
        c[i] *= 1 - 0.2 * S.crease - 0.3 * S.furrow;
        c[i] += ([0.40, 0.38, 0.52][i] - c[i]) * S.ph * 0.6;
        c[i] *= 0.45 + 0.55 * S.ao;
      }
      // chromatophore dots over the dorsum
      S.c = c;
      S.ro = 0.40 + 0.12 * S.pap - 0.1 * S.ph + 0.08 * (1 - S.ao);
      S.e = S.ph;
    }
  };
}
function photoStrip(u, v, N, out, Lu, Lv) {
  N.cells(u, v, 10, 6, 0.6, 9, out, Lv / Lu * 10 / 6);
  if (out.id > 0.35) return 0;
  return 1 - sst(0.10, 0.16, out.f1);
}

// the caught lanterns' seats: a ray from outside (along `out`) back onto the full sculpt
export const LANTERN_SEATS = [
  [[-0.7, 0.7, 0.1], [-0.62, 0.55, 0.0]],                  // the left shoulder, in the chain
  [[0.5, 0.6, 0.5], [0.52, -0.40, 0.56]],                  // the web, front right
  [[-0.4, 0.6, -0.5], [-0.52, -0.46, -0.40]]               // the web, back left
];
function lanternSeats(spec) {
  const f = compile(spec).f, out = [];
  for (const [o, at] of LANTERN_SEATS) {
    const d = norm(o);
    let t = 0, p = add(at, d, 1.5);
    for (let i = 0; i < 300; i++) { const v = f(p[0], p[1], p[2]); if (v < 1e-4) break; t += v * 0.8; p = add(add(at, d, 1.5), d, -t); if (t > 3) { p = null; break; } }
    if (!p) continue;
    const e = 0.004, n = norm([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
    out.push({ p: p.map(v => +v.toFixed(4)), n: n.map(v => +v.toFixed(4)) });
  }
  return out;
}

// ---- the offline pipeline (tools/blender) -----------------------------------------------------
export function pipeline() {
  return {
    name: 'hoarder', out: 'assets/sleepers/hoarder',
    sets: { body: { size: 2048, gutter: 6, aoDist: 0.08, aoSamples: 64 }, sucker: { size: 512, gutter: 6, aoDist: 0.25, aoSamples: 64 } },
    pieces: [
      { name: 'mantle', set: 'body', sdf: mantleSpec(), hi: { h: 0.0042 }, lo: { h: 0.010, tris: 60000 }, paint: PAINT, kEps: 0.012, ao: { r: 0.07, n: 4 }, cage: 0.025, ray: 0.06, emit: mantleEmit },
      { name: 'lid_top', set: 'body', sdf: lidSpec(false), hi: { h: 0.0016 }, lo: { h: 0.004, tris: 3000 }, paint: PAINT, kEps: 0.004, ao: { r: 0.02, n: 4 }, cage: 0.008, ray: 0.02 },
      { name: 'lid_bot', set: 'body', sdf: lidSpec(true), hi: { h: 0.0016 }, lo: { h: 0.004, tris: 2600 }, paint: PAINT, kEps: 0.004, ao: { r: 0.02, n: 4 }, cage: 0.008, ray: 0.02 },
      { name: 'sucker', set: 'sucker', sdf: suckerSpec(), hi: { h: 0.008 }, lo: { h: 0.035, tris: 360, err: 0.1 }, paint: SUCKER_PAINT, kEps: 0.03, ao: { r: 0.2, n: 4 }, cage: 0.04, ray: 0.12 }
    ],
    strips: [armStrip()],
    meta: { eyeAt: EYE_AT, siphon: SIPHON, armPairs: ARM_PAIRS, armSV: ARM_SV, suckK: SUCK_K, get lanterns() { return lanternSeats(mantleSpec()); } }
  };
}

// Look-dev preview for sculptlab.html (?job=./src/entities/sleeper/hoarderSculpt.js%23preview&p=mantle)
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
