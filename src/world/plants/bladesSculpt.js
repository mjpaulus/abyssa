// THE BLADE CARDS — kelp and seagrass through the sculpt pipeline, the way foliage is
// really built: every blade, stipe, float and haptera skin is SCULPTED FLAT on a bake plane
// (a thin slab whose relief is the corrugation, the midrib, the veins, the spinules on the
// margin, the grazed holes) and baked high-to-low onto a flat CARD of the atlas; ORM.B is
// the card's coverage (alpha set), so outlines, serrations, splits and holes are texels,
// not triangles. The PLANTS themselves are then assembled at load (buildKelp/buildGrass,
// pure arrays) from bent, twisted, ruffled ribbons, tubes and floats whose UVs land on
// those cards — tangent-space maps are indifferent to the bend. Nothing is hand-made: the
// atlas rebuilds from this file (`node tools/blender/build.mjs blades` -> assets/blades/),
// the plants are a pure function of their seeds.
//
// Frame of the bake plane: x = u, y = v (a card's own coordinates ARE its UVs; the runtime
// writes (u, 1 - v), glTF convention), the relief stands toward +z.
//
// Species built here (plantKit.js swaps them under flora.js / gardens.js's own layouts):
//   kelp   canopy giants (Macrocystis: many stipes, a pneumatocyst under every blade,
//          a tangled holdfast, the apical scimitar), bull kelp (Nereocystis: one whip
//          stipe, a bulb, a mane of ribbons), understory Alaria (a midribbed blade +
//          sporophylls) and Laminaria (a stout stipe, a palm split into digits).
//   grass  seagrass clumps (Zostera / Thalassia straps with parallel veins, sheaths,
//          rounded and broken tips, epiphytes), and a far LOD of crossed TUFT cards baked
//          from a dense planar clump so a meadow still reads as a meadow at 40 u.
import { mulberry } from '../../lib/sculpt.js';

const TAU = Math.PI * 2;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function h2(x, y, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn2(x, y, s) {
  const X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h2(X, Y, s), b = h2(X + 1, Y, s), c = h2(X, Y + 1, s), d = h2(X + 1, Y + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
const fbm2 = (x, y, s, o = 3) => { let a = 0, k = 1, t = 0; for (let i = 0; i < o; i++) { a += k * vn2(x, y, s + i * 13); t += k; k *= 0.5; x *= 2.03; y *= 2.03; } return a / t; };
// nearest-cell distance (cells of size 1): for holes, blisters
function cell2(x, y, s) {
  const X = Math.floor(x), Y = Math.floor(y); let f1 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = X + i, cy = Y + j, px = cx + h2(cx, cy, s), py = cy + h2(cx, cy, s + 7), d = Math.hypot(px - x, py - y);
    if (d < f1) { f1 = d; id = h2(cx, cy, s + 19); }
  }
  return [f1, id];
}

// ============================================================================ ATLASES
// (bake-plane units == UV units)
const KL = [];
for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) KL.push({ k: 'mac', id: r * 5 + i, u0: 0.012 + i * 0.098, v0: r ? 0.455 : 0.012, w: 0.092, h: 0.43, old: r === 1 });
for (let i = 0; i < 6; i++) KL.push({ k: 'ala', id: i, u0: 0.508 + i * 0.08, v0: 0.012, w: 0.07, h: 0.6, old: i >= 4 });
for (let i = 0; i < 8; i++) KL.push({ k: 'bul', id: i, u0: 0.508 + i * 0.036, v0: 0.625, w: 0.03, h: 0.365, old: i >= 6 });
KL.push({ k: 'sti', id: 0, u0: 0.80, v0: 0.625, w: 0.09, h: 0.365 });
KL.push({ k: 'hold', id: 0, u0: 0.90, v0: 0.625, w: 0.088, h: 0.365 });
KL.push({ k: 'flo', id: 0, u0: 0.012, v0: 0.90, w: 0.12, h: 0.088 });
KL.push({ k: 'bulb', id: 0, u0: 0.145, v0: 0.90, w: 0.17, h: 0.088 });
export const KELP_CARDS = KL;

const GL = [];
for (let r = 0; r < 2; r++) for (let i = 0; i < 14; i++) {
  const id = r * 14 + i;
  GL.push({ k: 'sg', id, u0: 0.01 + i * 0.044, v0: r ? 0.5 : 0.01, w: 0.036, h: 0.47, type: i % 7 < 4 ? 'zos' : 'tha', old: r === 1 && i % 3 !== 0 });
}
for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) GL.push({ k: 'tuft', id: r * 2 + c, u0: 0.635 + c * 0.18, v0: 0.01 + r * 0.33, w: 0.17, h: 0.31 });
export const GRASS_CARDS = GL;

const byKind = (L, k) => L.filter(c => c.k === k);
function cardAt(L, x, y) {
  for (const c of L) if (x >= c.u0 - 0.006 && x <= c.u0 + c.w + 0.006 && y >= c.v0 - 0.006 && y <= c.v0 + c.h + 0.006) return c;
  return null;
}

// ============================================================================ HIGH FIELDS
// Every card is a slab around its own relief z = rel(X, T) (X across from the card's centre
// in plane units, T = 0 at the blade's base .. 1 at its tip), cut in-plane by the outline.
const SLAB = 0.0028;
function slab(c, outline, relief) {
  const cx = c.u0 + c.w / 2;
  const bb = [c.u0 - 0.004, c.v0 - 0.004, -0.014, c.u0 + c.w + 0.004, c.v0 + c.h + 0.004, 0.014];
  return { bb, f: (x, y, z) => {
    const X = x - cx, T = (y - c.v0) / c.h;
    const r = relief(X, T, x, y);
    return Math.max((Math.abs(z - r) - SLAB) * 0.7, outline(X, T, x, y));
  } };
}
const rect = (c, pad = 0.003) => (X, T, x, y) => Math.max(Math.abs(X) - c.w / 2 - pad, c.v0 - pad - y, y - c.v0 - c.h - pad);

// ---- Macrocystis blade: lanceolate, a petiole into the float, spinulose (sawtooth) margins
// pointing to the tip, a rugose surface (transverse bullations), old ones eroded at the tip,
// grazed through, carrying bryozoan crust
function macHW(c, T) {
  // (kelp) BROAD: a short petiole off the float widening fast into a long oblong lamina,
  // broadest past mid-length, a blunt rounded tip; the margin waves
  const s = c.id * 7.3;
  const a = Math.pow(sst(0.0, 0.16, T), 0.7), b = 1 - 0.8 * Math.pow(sst(0.62, 1.0, T), 1.7);
  return c.w / 2 * Math.max(0.08, a * b) * (0.94 + 0.06 * Math.sin(T * 13 + s));
}
function macOutline(c) {
  const s = c.id * 31 + 5, tipCut = c.old ? 0.86 + 0.08 * h2(c.id, 3, 9) : 1.01;
  return (X, T, x, y) => {
    let d = Math.max(Math.abs(X) - macHW(c, T), c.v0 - y + 0.0005, y - c.v0 - c.h);
    if (c.old) d = Math.max(d, (T - tipCut - 0.03 * fbm2(X * 80, T * 9, s)) * c.h);
    return d;
  };
}
function macRelief(c) {
  const s = c.id * 17 + 1;
  return (X, T, x, y) => {
    const hw = Math.max(1e-4, macHW(c, T)), q = Math.min(1, Math.abs(X) / hw);
    // bullations: transverse wrinkles broken into blisters
    // irregular transverse corrugation, broken by a warp and by blisters (cells), never a
    // regular stripe (a clean sine read as printed chevrons under the lamp)
    // the rugose lamina: strong transverse corrugations broken by a warp, blistered, and the
    // margins thrown into ruffles
    const w = Math.sin(y * 140 + 6.0 * fbm2(X * 40, y * 16, s)) * (0.45 + 0.55 * Math.abs(fbm2(X * 50, y * 26, s + 3)));
    const [cf] = cell2(X * 120 + 0.5 * fbm2(x * 40, y * 40, s + 9), y * 90, s + 5);
    const blis = Math.max(0, 1 - cf / 0.62) ** 2;
    let r = 0.0018 * w + 0.0016 * blis + 0.0005 * fbm2(X * 300, y * 300, s + 11) + 0.0026 * Math.sin(y * 110 + s) * q * q * q;
    r *= sst(0.04, 0.2, T) * (1 - 0.6 * q * q);
    r += 0.0011 * Math.exp(-((X / (c.w * 0.05)) ** 2)) * (1 - T);   // the faint central thickening
    r -= 0.0012 * q * q * q * q;                                    // margins thinner
    return r;
  };
}
// ---- Alaria: a strong midrib, a thin wavy lamina either side torn into strips toward the tip
function alaHW(c, T) { return c.w / 2 * Math.max(0.12, sst(0.0, 0.1, T) * (1 - 0.9 * Math.pow(sst(0.55, 1, T), 1.4))) * (0.95 + 0.05 * Math.sin(T * 9 + c.id)); }
function alaOutline(c) {
  const s = c.id * 13 + 2, slits = [];
  const R = mulberry(900 + c.id), n = 3 + Math.floor(R() * 4) + (c.old ? 3 : 0);
  for (let i = 0; i < n; i++) slits.push([0.35 + 0.6 * R(), R() < 0.5 ? -1 : 1, 0.02 + 0.03 * R()]);
  return (X, T, x, y) => {
    const hw = alaHW(c, T) * (1 - 0.06 * Math.abs(fbm2(T * 40, X * 30, s)));
    let d = Math.max(Math.abs(X) - hw, c.v0 - y + 0.0005, y - c.v0 - c.h);
    // tears from the margin down toward the midrib, leaning back toward the base
    for (const [t0, sd, lean] of slits) {
      if (X * sd < c.w * 0.05) continue;
      const q = (X * sd - c.w * 0.05) / (c.w * 0.5), Ty = t0 - lean * q * 2;
      const dl = Math.abs((T - Ty) * c.h) - 0.0009 * (0.4 + q);
      d = Math.max(d, -dl);
    }
    return d;
  };
}
function alaRelief(c) {
  const s = c.id * 19 + 4;
  return (X, T, x, y) => {
    const hw = Math.max(1e-4, alaHW(c, T)), q = Math.min(1, Math.abs(X) / hw);
    const rib = 0.0042 * Math.exp(-((X / (c.w * 0.055)) ** 2)) * (1 - 0.55 * T);
    const wave = 0.0022 * Math.sin(y * 95 + s + 2 * fbm2(X * 30, y * 20, s)) * sst(0.15, 0.8, q);
    const wr = 0.0006 * Math.sin(y * 420 + 4 * fbm2(X * 200, y * 60, s + 1)) * sst(0.1, 0.4, q);
    return rib + wave + wr - 0.0008 * q * q * q;
  };
}
// ---- bull kelp / Laminaria digit ribbon: long, near-uniform, longitudinal wrinkles
function bulHW(c, T) { return c.w / 2 * Math.max(0.15, sst(0.0, 0.06, T) * (1 - 0.55 * sst(0.8, 1.0, T))); }
function bulOutline(c) {
  const s = c.id * 23 + 6, tip = c.old ? 0.86 : 1.01;
  return (X, T, x, y) => {
    const hw = bulHW(c, T) * (1 - 0.05 * Math.abs(fbm2(T * 60, X * 40, s)));
    let d = Math.max(Math.abs(X) - hw, c.v0 - y + 0.0005, y - c.v0 - c.h);
    d = Math.max(d, (T - tip - 0.05 * fbm2(X * 120, 1, s)) * c.h);
    return d;
  };
}
function bulRelief(c) {
  const s = c.id * 29 + 7;
  return (X, T, x, y) => {
    const q = Math.min(1, Math.abs(X) / Math.max(1e-4, bulHW(c, T)));
    // longitudinal wrinkles that wander, fork and fade (not a corrugated sheet)
    const lon = 0.0008 * Math.sin(X * 700 + 9 * fbm2(X * 40, y * 12, s)) * Math.abs(fbm2(X * 50, y * 40, s + 2)) * 1.6 + 0.0006 * fbm2(X * 200, y * 90, s + 4);
    return lon + 0.0014 * Math.sin(y * 150 + s) * q * q * q - 0.0006 * q * q;
  };
}
// ---- stipe / haptera skin (a tube unrolled: X around, T along), the holdfast's crusted skin,
// the floats (lat-long: X around, T from stalk to crown)
function stiRelief(c) {
  return (X, T, x, y) => 0.0007 * Math.sin(X * 700 + 2 * fbm2(X * 40, y * 30, 41)) + 0.0009 * fbm2(X * 120, y * 50, 43) + 0.0012 * Math.max(0, fbm2(X * 60, y * 60, 47) - 0.35);
}
function holdRelief(c) {
  return (X, T, x, y) => 0.0018 * fbm2(X * 90, y * 90, 51, 4) + 0.0016 * Math.max(0, 0.3 - cell2(X * 60, y * 60, 53)[0]) * 4;
}
function floRelief(c) {
  return (X, T, x, y) => 0.0005 * Math.sin(X * 520 + fbm2(X * 30, y * 30, 61)) + 0.0004 * fbm2(X * 200, y * 200, 63);
}

// ---- seagrass straps: parallel veins, a channelled midvein, rounded (Zostera) or blunt-wide
// (Thalassia) tips, broken tips on the old ones, a sheath at the base
function sgHW(c, T) {
  const W = c.w / 2 * (c.type === 'zos' ? 0.62 : 0.9);
  const yt = c.h * (c.old ? 0.82 + 0.12 * h2(c.id, 4, 4) : 1) - 0.002;
  const yy = T * c.h, rt = W * (c.type === 'zos' ? 1.0 : 0.6);
  let hw = W * (0.96 + 0.04 * Math.sin(T * 7 + c.id));
  if (yy > yt - rt) hw *= Math.sqrt(Math.max(0, 1 - ((yy - (yt - rt)) / rt) ** 2));
  if (T < 0.07) hw = Math.max(hw, W * 1.08);                           // the sheath
  return yy > yt ? -1 : hw;
}
function sgOutline(c) {
  const s = c.id * 37 + 9;
  return (X, T, x, y) => {
    const hw = sgHW(c, T);
    let d = Math.max(Math.abs(X) - hw, c.v0 - y + 0.0005, y - c.v0 - c.h);
    if (c.old) d = Math.max(d, (T - (0.82 + 0.12 * h2(c.id, 4, 4)) - 0.02 * fbm2(X * 300, 2, s)) * c.h);
    return d;
  };
}
function sgRelief(c) {
  const nv = c.type === 'zos' ? 5 : 9, s = c.id * 41 + 3;
  return (X, T, x, y) => {
    const hw = Math.max(1e-4, sgHW(c, T)), q = X / hw;
    const veins = 0.00045 * Math.cos(q * Math.PI * nv * 0.5) ** 8;
    const mid = -0.0009 * Math.exp(-((q / 0.12) ** 2)) + 0.0006 * Math.exp(-((q / 0.28) ** 2));
    return veins + mid + 0.00035 * fbm2(X * 300, y * 120, s) - 0.0006 * q * q;
  };
}
// ---- the TUFT impostor: a dense clump of straps seen side-on, layered in depth
function tuftBlades(c) {
  const R = mulberry(3100 + c.id), n = 15 + Math.floor(R() * 5), B = [];
  for (let i = 0; i < n; i++) {
    const x0 = (R() - 0.5) * c.w * 0.18, lean = (R() - 0.5) * c.w * 0.75, Ht = c.h * (0.45 + 0.53 * R()), wd = 0.0042 + 0.0035 * R();
    const P = [[x0, 0], [x0 + lean * 0.15, Ht * 0.45], [x0 + lean * 0.65, Ht * 0.8], [x0 + lean, Ht]];
    const pts = [];
    for (let k = 0; k <= 10; k++) { const t = k / 10, u = 1 - t; pts.push([u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0], u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]]); }
    B.push({ pts, wd, z: (R() - 0.5) * 0.004, id: i, old: R() < 0.3 });
  }
  return B;
}
function tuftNearest(B, X, Y) {
  let best = 1e9, bt = 0, bb = null;
  for (const b of B) {
    for (let k = 0; k < 10; k++) {
      const [ax, ay] = b.pts[k], [bx, by] = b.pts[k + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = clamp(((X - ax) * dx + (Y - ay) * dy) / l2, 0, 1), px = ax + dx * t - X, py = ay + dy * t - Y;
      const w = b.wd * (1 - 0.65 * Math.pow((k + t) / 10, 1.6));
      const d = Math.hypot(px, py) - w;
      if (d < best) { best = d; bt = (k + t) / 10; bb = b; }
    }
  }
  return [best, bt, bb];
}
function tuftField(c) {
  const B = tuftBlades(c), cx = c.u0 + c.w / 2;
  c._B = B;
  const bb = [c.u0 - 0.004, c.v0 - 0.004, -0.014, c.u0 + c.w + 0.004, c.v0 + c.h + 0.004, 0.014];
  return { bb, f: (x, y, z) => {
    const X = x - cx, Y = y - c.v0;
    let d = 1e9;
    for (const b of B) {
      // per blade: in-plane strip distance and its own depth layer (overlaps occlude, AO pools)
      let dp = 1e9;
      for (let k = 0; k < 10; k++) {
        const [ax, ay] = b.pts[k], [bx, by] = b.pts[k + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = clamp(((X - ax) * dx + (Y - ay) * dy) / l2, 0, 1), px = ax + dx * t - X, py = ay + dy * t - Y;
        dp = Math.min(dp, Math.hypot(px, py) - b.wd * (1 - 0.65 * Math.pow((k + t) / 10, 1.6)));
      }
      d = Math.min(d, Math.max(Math.abs(z - b.z) - 0.0016, dp));
    }
    return Math.max(d, Math.max(Math.abs(X) - c.w / 2, -Y, Y - c.h));
  } };
}

// ============================================================================ PAINT
const PK = { MAC: 0, ALA: 1, BUL: 2, STI: 3, HOLD: 4, FLO: 5 };
const KIND_M = { mac: PK.MAC, ala: PK.ALA, bul: PK.BUL, sti: PK.STI, hold: PK.HOLD, flo: PK.FLO, bulb: PK.FLO };
// paint-state helpers: the card under a high vertex, its across/along coordinates
const kAt = S => cardAt(KL, S.x, S.y);
const kT = (c, S) => (S.y - c.v0) / c.h, kX = (c, S) => S.x - (c.u0 + c.w / 2);
const blade = c => c && (c.k === 'mac' || c.k === 'ala' || c.k === 'bul');
const KELP_PAINT = {
  kScale: 0.0004, aoAlb: 0.55,
  mats: {
    [PK.MAC]: { c: [0.56, 0.41, 0.15], ro: 0.38 },
    [PK.ALA]: { c: [0.42, 0.36, 0.17], ro: 0.42 },
    [PK.BUL]: { c: [0.52, 0.39, 0.16], ro: 0.4 },
    [PK.STI]: { c: [0.30, 0.23, 0.12], ro: 0.55 },
    [PK.HOLD]: { c: [0.26, 0.20, 0.12], ro: 0.8 },
    [PK.FLO]: { c: [0.60, 0.48, 0.20], ro: 0.28 }
  },
  layers: [
    // per card hue: some blades olive, some golden, some ruddy
    { c: [0.46, 0.38, 0.15], a: 0.4, m: [['fn', S => { const c = kAt(S); return blade(c) && c.id % 3 === 1 ? 1 : 0; }]] },
    { c: [0.50, 0.33, 0.16], a: 0.35, m: [['fn', S => { const c = kAt(S); return blade(c) && c.id % 4 === 2 ? 1 : 0; }]] },
    // dense and dark where the blade leaves its float/stipe
    { c: [0.19, 0.14, 0.07], a: 0.85, m: [['fn', S => { const c = kAt(S); return blade(c) ? 1 - sst(0.0, 0.2, kT(c, S)) : 0; }]] },
    // older, strawier toward the tip
    { c: [0.64, 0.56, 0.31], a: 0.6, m: [['fn', S => { const c = kAt(S); return blade(c) ? sst(0.55, 1.0, kT(c, S)) * (0.55 + 0.45 * fbm2(S.x * 40, S.y * 40, 5)) : 0; }]] },
    // the midrib (Alaria) paler and yellower
    { c: [0.66, 0.58, 0.33], a: 0.75, m: [['fn', S => { const c = kAt(S); return c && c.k === 'ala' ? Math.exp(-((kX(c, S) / (c.w * 0.04)) ** 2)) : 0; }]] },
    // margins: thinner tissue, lighter
    { c: [0.58, 0.50, 0.27], a: 0.4, m: [['fn', S => { const c = kAt(S); if (!blade(c)) return 0; const T = kT(c, S), hw = c.k === 'mac' ? macHW(c, T) : c.k === 'ala' ? alaHW(c, T) : bulHW(c, T); return sst(0.7, 1.0, Math.abs(kX(c, S)) / Math.max(1e-4, hw)); }]] },
    // bullation crests catch light, troughs pool dark
    { c: [0.17, 0.12, 0.06], a: 0.45, m: [['cav', 0.15, 1.0]] },
    { c: [0.62, 0.52, 0.28], a: 0.35, m: [['cvx', 0.2, 1.2]] },
    // decay along the eroded margin of old blades
    { c: [0.27, 0.18, 0.09], a: 0.8, m: [['fn', S => { const c = kAt(S); return blade(c) && c.old ? sst(0.5, 1, kT(c, S)) * sst(0.1, 0.9, fbm2(S.x * 90, S.y * 90, 8) + 0.4) : 0; }]] },
    // Membranipora: lacy white bryozoan crust on old blades
    { c: [0.56, 0.55, 0.48], a: 0.45, ro: 0.85, m: [['fn', S => { const c = kAt(S); return blade(c) && c.old ? sst(0.38, 0.5, fbm2(S.x * 30, S.y * 30, 11 + c.id)) * sst(0.4, 0.8, kT(c, S)) : 0; }]] },
    { c: [0.80, 0.79, 0.72], a: 0.6, ro: 0.9, m: [['fn', S => { const c = kAt(S); return blade(c) && c.old ? sst(0.4, 0.52, fbm2(S.x * 30, S.y * 30, 11 + c.id)) * sst(0.4, 0.8, kT(c, S)) : 0; }], ['wor', 900, 0.12, 17]] },
    // stipe: darker knots, pale encrusting patches
    { c: [0.20, 0.15, 0.08], a: 0.6, m: [['mat', PK.STI], ['n', 120, 0.55, 0.75, 21]] },
    { c: [0.55, 0.52, 0.44], a: 0.5, ro: 0.8, m: [['mat', PK.STI], ['n', 60, 0.66, 0.8, 23]] },
    // holdfast: pink coralline crust and sponge patches
    { c: [0.62, 0.36, 0.40], a: 0.75, ro: 0.85, m: [['mat', PK.HOLD], ['n', 50, 0.55, 0.7, 25]] },
    { c: [0.58, 0.46, 0.24], a: 0.6, m: [['mat', PK.HOLD], ['n', 80, 0.62, 0.78, 27]] },
    // floats: the stalk end darker, a paler crown
    { c: [0.28, 0.22, 0.10], a: 0.8, m: [['fn', S => { const c = kAt(S); return c && (c.k === 'flo' || c.k === 'bulb') ? 1 - sst(0.0, 0.3, kT(c, S)) : 0; }]] },
    { c: [0.66, 0.58, 0.32], a: 0.4, m: [['fn', S => { const c = kAt(S); return c && (c.k === 'flo' || c.k === 'bulb') ? sst(0.6, 1.0, kT(c, S)) : 0; }]] },
    { c: [0.08, 0.06, 0.03], a: 0.6, m: [['ao', 0.4, 0.95]] }
  ]
};
const gAt = S => cardAt(GL, S.x, S.y);
const GRASS_PAINT = {
  kScale: 0.0004, aoAlb: 0.6,
  mats: { 0: { c: [0.30, 0.40, 0.16], ro: 0.45 }, 1: { c: [0.30, 0.40, 0.16], ro: 0.5 } },
  layers: [
    { c: [0.26, 0.36, 0.20], a: 0.5, m: [['fn', S => { const c = gAt(S); return c && c.k === 'sg' && c.id % 3 === 1 ? 1 : 0; }]] },
    { c: [0.38, 0.42, 0.17], a: 0.5, m: [['fn', S => { const c = gAt(S); return c && c.k === 'sg' && c.id % 4 === 3 ? 1 : 0; }]] },
    // the sheath at the base: brown, papery
    { c: [0.32, 0.25, 0.14], a: 0.85, ro: 0.7, m: [['fn', S => { const c = gAt(S); return c && c.k === 'sg' ? 1 - sst(0.03, 0.09, (S.y - c.v0) / c.h) : 0; }]] },
    // older toward the tip: yellowing, then brown dieback
    { c: [0.55, 0.50, 0.22], a: 0.65, m: [['fn', S => { const c = gAt(S); return c && c.k === 'sg' ? sst(0.55, 0.95, (S.y - c.v0) / c.h) * (0.6 + 0.4 * fbm2(S.x * 50, S.y * 30, 3)) : 0; }]] },
    { c: [0.34, 0.24, 0.12], a: 0.8, m: [['fn', S => { const c = gAt(S); return c && c.k === 'sg' ? sst(0.82, 1.0, (S.y - c.v0) / c.h) * (c.old ? 1 : 0.4) : 0; }]] },
    // veins read darker, the lamina between lighter
    { c: [0.18, 0.26, 0.10], a: 0.4, m: [['cav', 0.1, 0.9]] },
    { c: [0.44, 0.52, 0.26], a: 0.3, m: [['cvx', 0.1, 0.9]] },
    // epiphytes on old blades: coralline crust spots and a brown diatom film
    { c: [0.40, 0.32, 0.18], a: 0.5, m: [['fn', S => { const c = gAt(S); return c && c.k === 'sg' && c.old ? sst(0.1, 0.4, fbm2(S.x * 60, S.y * 25, 31 + c.id)) * sst(0.3, 0.7, (S.y - c.v0) / c.h) : 0; }]] },
    { c: [0.82, 0.78, 0.74], a: 0.85, ro: 0.85, m: [['fn', S => { const c = gAt(S); if (!c || c.k !== 'sg' || !c.old) return 0; const [f1, id] = cell2(S.x * 260, S.y * 260, 33 + c.id); return id < 0.22 ? 1 - sst(0.18, 0.32, f1) : 0; }]] },
    // the tuft: per blade hue, tips straw, bases dark (it is seen at range: value carries it)
    { c: [0.22, 0.30, 0.14], a: 0.6, m: [['fn', S => { const c = gAt(S); if (!c || c.k !== 'tuft') return 0; const [d, t, b] = tuftNearest(c._B, S.x - (c.u0 + c.w / 2), S.y - c.v0); return b && b.id % 3 === 0 ? 1 : 0; }]] },
    { c: [0.56, 0.52, 0.26], a: 0.7, m: [['fn', S => { const c = gAt(S); if (!c || c.k !== 'tuft') return 0; const [d, t, b] = tuftNearest(c._B, S.x - (c.u0 + c.w / 2), S.y - c.v0); return sst(0.6, 1.0, t) * (b && b.old ? 1 : 0.55); }]] },
    { c: [0.14, 0.16, 0.08], a: 0.7, m: [['fn', S => { const c = gAt(S); return c && c.k === 'tuft' ? 1 - sst(0.0, 0.25, (S.y - c.v0) / c.h) : 0; }]] },
    { c: [0.06, 0.07, 0.03], a: 0.6, m: [['ao', 0.4, 0.95]] }
  ]
};

// ---- the offline pieces --------------------------------------------------------------------
function kelpHigh() {
  const parts = [];
  for (const c of KL) {
    const m = KIND_M[c.k];
    let F;
    if (c.k === 'mac') F = slab(c, macOutline(c), macRelief(c));
    else if (c.k === 'ala') F = slab(c, alaOutline(c), alaRelief(c));
    else if (c.k === 'bul') F = slab(c, bulOutline(c), bulRelief(c));
    else if (c.k === 'sti') F = slab(c, rect(c), stiRelief(c));
    else if (c.k === 'hold') F = slab(c, rect(c), holdRelief(c));
    else F = slab(c, rect(c), floRelief(c));
    parts.push({ t: 'fn', bb: F.bb, f: F.f, m });
  }
  return { t: 'u', k: 0, ch: parts };
}
function grassHigh() {
  const parts = [];
  for (const c of GL) {
    const F = c.k === 'sg' ? slab(c, sgOutline(c), sgRelief(c)) : tuftField(c);
    parts.push({ t: 'fn', bb: F.bb, f: F.f, m: c.k === 'sg' ? 0 : 1 });
  }
  return { t: 'u', k: 0, ch: parts };
}
// the lows: one flat quad per card, its UVs its own plane coordinates
function cardsLow(L) {
  const pos = [], uv = [], idx = [];
  for (const c of L) {
    const b = pos.length / 3, x0 = c.u0, x1 = c.u0 + c.w, y0 = c.v0, y1 = c.v0 + c.h;
    pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
    uv.push(x0, y0, x1, y0, x1, y1, x0, y1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), uv: new Float32Array(uv), normal: new Float32Array(pos.length).map((v, i) => i % 3 === 2 ? 1 : 0) };
}

export function pipeline() {
  const set = { size: 1024, gutter: 4, aoDist: 0.006, aoSamples: 48, fill: true, alpha: true, ormB: 'alpha', ormHalf: false, uvFixed: true };
  return {
    name: 'blades', out: 'assets/blades',
    sets: { kelp: { ...set }, grass: { ...set } },
    pieces: [
      { name: 'kelp_v0', set: 'kelp', sdf: kelpHigh(), low: () => cardsLow(KL), hi: { h: 0.0011 }, lo: { h: 0.01, tris: 0 }, paint: KELP_PAINT, kEps: 0.002, ao: { r: 0.004, n: 3 }, cage: 0.012, ray: 0.03, emit: () => 1 },
      { name: 'grass_v0', set: 'grass', sdf: grassHigh(), low: () => cardsLow(GL), hi: { h: 0.0009 }, lo: { h: 0.01, tris: 0 }, paint: GRASS_PAINT, kEps: 0.0016, ao: { r: 0.003, n: 3 }, cage: 0.012, ray: 0.03, emit: () => 1 }
    ],
    compress: { mesh: 'draco', tex: 'ktx2' },
    meta: { kelpVariants: KELP_VARIANTS.length, grassVariants: GRASS_VARIANTS.length }
  };
}

// ============================================================================ RUNTIME BUILD
// A mesh accumulator in the attribute layout plantKit.js / gardens.js's sway program reads:
// position, normal, uv (glTF V), aVA (flex, h, mask, phase), aFlut, aBU (across, along + 1
// on ruffling blade vertices; 0,0 elsewhere).
class MB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.va = []; this.fl = []; this.bu = []; this.ix = []; }
  get nv() { return this.p.length / 3; }
  v(x, y, z, nx, ny, nz, u, v, va, fl, bu0 = 0, bu1 = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, 1 - v);
    this.va.push(va[0], va[1], va[2], va[3]); this.fl.push(fl); this.bu.push(bu0, bu1);
    return this.nv - 1;
  }
  grid(b, cols, rows) {   // (cols + 1) x (rows + 1) vertices, row-major from b
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = b + j * (cols + 1) + i, c = a + cols + 1;
      this.ix.push(a, a + 1, c + 1, a, c + 1, c);
    }
  }
  out() {
    return { position: new Float32Array(this.p), normal: new Float32Array(this.n), uv: new Float32Array(this.uv), aVA: new Float32Array(this.va), aFlut: new Float32Array(this.fl), aBU: new Float32Array(this.bu), index: this.nv > 65535 ? new Uint32Array(this.ix) : new Uint16Array(this.ix) };
  }
}
const V = {
  add: (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  rot: (v, ax, an) => { const c = Math.cos(an), s = Math.sin(an), d = V.dot(ax, v), x = V.cross(ax, v); return [v[0] * c + x[0] * s + ax[0] * d * (1 - c), v[1] * c + x[1] * s + ax[1] * d * (1 - c), v[2] * c + x[2] * s + ax[2] * d * (1 - c)]; }
};
function bez(P, t) { const u = 1 - t; return [0, 1, 2].map(i => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]); }
function bezD(P, t) { const u = 1 - t; return V.norm([0, 1, 2].map(i => 3 * u * u * (P[1][i] - P[0][i]) + 6 * u * t * (P[2][i] - P[1][i]) + 3 * t * t * (P[3][i] - P[2][i]))); }
const tri = x => { const f = x - Math.floor(x); return f < 0.5 ? f * 2 : 2 - f * 2; };   // mirrored repeat: no seam

// A blade ribbon along a cubic bezier. o: { P (4 pts), N0 (blade-plane normal hint), wid,
// card, rows, cols (1 or 2), twist (rad over the length), fold (V about the midline),
// ruf (margin ruffle amplitude), rufF (ruffles per unit length), ph, sw(t, pos) -> [flex,
// h, mask, phase], flut(t) }
function ribbon(M, o) {
  const { P, card: c, rows, cols } = o, b = M.nv, hw = o.wid / 2;
  let T = bezD(P, 0), S = V.norm(V.cross(T, o.N0));
  const L = o.len || 1;
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, C = bez(P, t), Tj = bezD(P, Math.min(0.999, Math.max(0.001, t)));
    S = V.norm(V.sub(S, V.scale(Tj, V.dot(S, Tj))));
    const Sr = V.rot(S, Tj, o.twist * t), N = V.cross(Sr, Tj);
    // (fill-rate) the ribbon hugs the card's own outline row by row (conservatively: the
    // widest the outline gets between this row's neighbours), so alpha-hashed fragments are
    // not spent on the empty corners of every card
    const fr = o.fit ? (o.exact ? Math.min(1, o.fit(c, Math.min(0.995, Math.max(0.005, t))) / (c.w / 2) + 0.03) : fitFrac(o.fit, c, Math.max(0, (j - 1) / rows), Math.min(1, (j + 1) / rows))) : 1;
    for (let i = 0; i <= cols; i++) {
      const s = (-1 + 2 * i / cols) * fr, a = Math.abs(s);
      const off = o.fold * a * hw + o.ruf * a * a * Math.sin(t * L * o.rufF + o.ph + s * 1.7) * sst(0.05, 0.3, t);
      const p = V.add(V.add(C, Sr, s * hw), N, off);
      pts.push(p);
      const sw = o.sw(t, p);
      M.v(p[0], p[1], p[2], 0, 0, 0, c.u0 + (s + 1) / 2 * c.w, c.v0 + t * c.h, sw, o.flut(t), (s + 1) / 2, 1 + t);
    }
  }
  M.grid(b, cols, rows);
  // smooth normals over this ribbon's own grid
  const n = new Float32Array(pts.length * 3);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, q = [a, a + 1, a + cols + 2, a + cols + 1];
    const f = V.cross(V.sub(pts[q[1]], pts[q[0]]), V.sub(pts[q[3]], pts[q[0]]));
    for (const k of q) { n[k * 3] += f[0]; n[k * 3 + 1] += f[1]; n[k * 3 + 2] += f[2]; }
  }
  for (let k = 0; k < pts.length; k++) { const nn = V.norm([n[k * 3], n[k * 3 + 1], n[k * 3 + 2]]); M.n[(b + k) * 3] = nn[0]; M.n[(b + k) * 3 + 1] = nn[1]; M.n[(b + k) * 3 + 2] = nn[2]; }
}
// the outline's half-width as a fraction of the card's, maxed over [t0, t1], plus a margin
function fitFrac(fn, c, t0, t1) {
  let m = 0;
  for (let k = 0; k <= 6; k++) { const T = t0 + (t1 - t0) * k / 6, h = fn(c, T); if (h > m) m = h; }
  return Math.min(1, m / (c.w / 2) + 0.1);
}
const FIT = { mac: macHW, ala: alaHW, bul: bulHW, sg: (c, T) => Math.max(0, sgHW(c, T)) };
// A tube along a polyline (parallel-transported rings, a duplicated seam), skin from a
// region card (around = u, along = mirrored repeat of v every `rep` units).
function tube(M, pts, rad, sides, c, rep, sw, flut = () => 0) {
  const b = M.nv, n = pts.length;
  let T = V.norm(V.sub(pts[1], pts[0])), X = V.norm(V.cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  let acc = 0;
  for (let j = 0; j < n; j++) {
    const Tj = V.norm(V.sub(pts[Math.min(n - 1, j + 1)], pts[Math.max(0, j - 1)]));
    X = V.norm(V.sub(X, V.scale(Tj, V.dot(X, Tj))));
    const Y = V.cross(Tj, X);
    if (j) acc += Math.hypot(...V.sub(pts[j], pts[j - 1]));
    const t = j / (n - 1);
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * TAU, r = rad(t, a), d = V.add(V.scale(X, Math.cos(a)), Y, Math.sin(a));
      const p = V.add(pts[j], d, r);
      M.v(p[0], p[1], p[2], d[0], d[1], d[2], c.u0 + (k / sides) * c.w, c.v0 + c.h * tri(acc / rep), sw(t, p), flut(t));
    }
  }
  M.grid(b, sides, n - 1);
}
// An ellipsoid float on an axis (lat-long onto its region card; T = 0 at the stalk end)
function ellip(M, C, ax, ra, rr, sides, rings, c, sw, flut) {
  const b = M.nv, A = V.norm(ax), X = V.norm(V.cross(A, Math.abs(A[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), Y = V.cross(A, X);
  for (let j = 0; j <= rings; j++) {
    const th = j / rings * Math.PI, ca = -Math.cos(th), sa = Math.sin(th);
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * TAU, ring = V.add(V.scale(X, Math.cos(a)), Y, Math.sin(a));
      const p = V.add(V.add(C, A, ca * ra), ring, sa * rr);
      const nn = V.norm(V.add(V.scale(A, ca / ra), ring, sa / rr));
      M.v(p[0], p[1], p[2], nn[0], nn[1], nn[2], c.u0 + (k / sides) * c.w, c.v0 + (j / rings) * c.h, sw(p), flut);
    }
  }
  M.grid(b, sides, rings);
}

// ---------------------------------------------------------------------------- KELP
// Variants: the host (flora.js) lays a kelp out as (W, H, W) on a unit-height mesh; plantKit
// re-picks a variant by H (understory under 6.6) and draws it at its true proportions,
// (k, H / Href, k) — see kelpRemap below.
export const KELP_VARIANTS = [
  { type: 'mac', Href: 9, seed: 11, stipes: 4 },
  { type: 'mac', Href: 13, seed: 22, stipes: 6 },
  { type: 'mac', Href: 17.5, seed: 33, stipes: 7 },
  { type: 'mac', Href: 12, seed: 44, stipes: 4 },
  { type: 'bull', Href: 10, seed: 55 },
  { type: 'bull', Href: 15.5, seed: 66 },
  { type: 'ala', Href: 3.2, seed: 77 },
  { type: 'ala', Href: 5.0, seed: 88 },
  { type: 'lam', Href: 2.8, seed: 99 },
  { type: 'lam', Href: 4.6, seed: 111 }
];
// instance index hash -> [0,1)
const ih = (i, k) => { const s = Math.sin(i * 91.345 + k * 17.13) * 24634.6345; return s - Math.floor(s); };
export function kelpPick(i, H) {
  const under = H < 6.6, R = ih(i, 3);
  let best = -1, bd = 1e9;
  for (let v = 0; v < KELP_VARIANTS.length; v++) {
    const K = KELP_VARIANTS[v], isU = K.type === 'ala' || K.type === 'lam';
    if (isU !== under) continue;
    if (!under && (K.type === 'bull') !== (R < 0.22)) continue;
    if (under && (K.type === 'lam') !== (R < 0.45)) continue;
    const d = Math.abs(Math.log(H / K.Href)) + 0.15 * ih(i, v + 7);
    if (d < bd) { bd = d; best = v; }
  }
  return best < 0 ? 0 : best;
}

const LODK = [
  { rows: 7, cols: 3, every: 1, grow: 1, floats: true, sides: 5, ring: 0.45, hold: 2, fsides: 5, frings: 3 },
  { rows: 3, cols: 1, every: 2, grow: 1.35, floats: true, sides: 3, ring: 1.0, hold: 1, fsides: 3, frings: 1 },
  { rows: 2, cols: 1, every: 3, grow: 1.6, floats: false, sides: 3, ring: 2.2, hold: 0, fsides: 0 }
];
const KC = k => byKind(KL, k);
// the skeleton: every random draw happens here, once per variant, so the three LODs are the
// same plant at three resolutions
const _skel = new Map();
function kelpSkel(vi) {
  if (_skel.has(vi)) return _skel.get(vi);
  const K = KELP_VARIANTS[vi], R = mulberry(K.seed * 7919 + 1), H = K.Href, sk = { K, stipes: [], blades: [], haptera: [], floats: [], bulbs: [] };
  const hold = K.type === 'mac' ? 0.34 : K.type === 'bull' ? 0.2 : 0.16;
  sk.hold = hold;
  // haptera: branching roots splaying out and down off the mound
  const nh = K.type === 'mac' ? 14 : 8;
  for (let i = 0; i < nh; i++) {
    const a = i / nh * TAU + (R() - 0.5) * 0.4, r1 = hold * (0.8 + 0.7 * R()), y0 = hold * (0.35 + 0.4 * R());
    const p0 = [Math.cos(a) * hold * 0.25, y0, Math.sin(a) * hold * 0.25];
    const p1 = [Math.cos(a) * r1 * 0.6, y0 * 0.9 + 0.04, Math.sin(a) * r1 * 0.6];
    const p2 = [Math.cos(a + 0.12) * r1, -0.03, Math.sin(a + 0.12) * r1];
    sk.haptera.push({ pts: [p0, p1, p2], r: 0.022 * (hold / 0.34 + 0.4) });
    if (R() < 0.6) { const a2 = a + (R() - 0.5) * 0.9; sk.haptera.push({ pts: [p1, [Math.cos(a2) * r1 * 0.95, 0.03, Math.sin(a2) * r1 * 0.95], [Math.cos(a2) * r1 * 1.25, -0.03, Math.sin(a2) * r1 * 1.25]], r: 0.014 * (hold / 0.34 + 0.4) }); }
  }
  const bladeAt = (stipe, t, side, len, wid, card, kind) => sk.blades.push({ stipe, t, side, len, wid, card, kind, ph: R() * TAU, el: 0.35 + 0.4 * R(), sweep: (R() - 0.5) * 0.6, twist: (R() - 0.5) * 1.6, fold: 0.12 + 0.12 * R(), ruf: 0.012 + 0.012 * R() });
  // the current runs along local +x (plantKit turns every instance so): DOWNSTREAM
  const DS = [1, 0, 0];
  if (K.type === 'mac') {
    // FRONDS: rope-like stipes rising off the holdfast and bending DOWNSTREAM with height, the
    // tallest arching over into a trailing canopy; along each, every ~0.4 u a pear-shaped
    // pneumatocyst carrying one broad, ruffled blade that streams downstream and droops.
    const young = KC('mac').filter(c => !c.old), old = KC('mac').filter(c => c.old);
    for (let s = 0; s < K.stipes; s++) {
      const a = s / K.stipes * TAU + R() * 0.9, top = H * (s < 2 ? 0.92 + 0.08 * R() : 0.4 + 0.5 * R());
      const base = [Math.cos(a) * 0.07, hold * 0.7, Math.sin(a) * 0.07];
      const lean = 0.08 + 0.08 * R(), spread = (R() - 0.5) * 0.6, canopy = top > H * 0.8;
      const P = [base,
        V.add(base, [Math.cos(a) * 0.25, top * 0.33, Math.sin(a) * 0.25 + spread * 0.3]),
        V.add(base, [top * lean * 0.6, top * 0.7, spread * 0.8]),
        V.add(base, [top * lean + (canopy ? 0.16 * H : 0.03 * H), top - hold - (canopy ? 0.05 * H : 0), spread])];
      sk.stipes.push({ P, r0: 0.036, r1: 0.026, ph: R() * TAU });
      const n = Math.floor((top - 0.8) / (0.38 + 0.06 * R()));
      let sd = R() < 0.5 ? 1 : -1;
      // irregular, as grown: spacing jitters, a blade now and then on the same side, lengths
      // and lifts and droops all their own (a regular ladder read as a fern frond)
      for (let k = 0; k < n; k++) {
        const t = (0.6 + (k + (R() - 0.5) * 0.6) * (top - 0.8) / n) / top, age = 1 - t;
        if (R() < 0.75) sd = -sd;
        const card = age > 0.45 && R() < 0.7 ? old[Math.floor(R() * old.length)] : young[Math.floor(R() * young.length)];
        sk.blades.push({ stipe: s, t, side: sd * (0.6 + 0.6 * R()), len: (0.85 + 0.45 * age) * (0.75 + 0.6 * R()), wid: 0.22 + 0.12 * R(), card, kind: 'mac', ph: R() * TAU, el: -0.15 + 0.7 * R(), droop: 0.2 + 0.8 * R(), sweep: (R() - 0.5) * 0.9, twist: (R() - 0.5) * 2.0, fold: 0.06 + 0.1 * R(), ruf: 0.03 + 0.035 * R() });
      }
      sk.blades.push({ stipe: s, t: 1, side: 1, len: 0.7 + 0.2 * R(), wid: 0.2, card: young[Math.floor(R() * young.length)], kind: 'apex', ph: R() * TAU, el: 0.1, sweep: 0.3, twist: 0.5, fold: 0.15, ruf: 0.03 });
    }
  } else if (K.type === 'bull') {
    // ONE long whip stipe arcing downstream to one big float, a mop of long ribbons streaming
    // off it in the current and drooping
    const top = H - 1.0, base = [0, hold * 0.6, 0], zz = (R() - 0.5) * 0.4;
    const P = [base, [0.15, top * 0.35, zz * 0.3], [H * 0.08, top * 0.72, zz * 0.7], [H * 0.2, top, zz]];
    sk.stipes.push({ P, r0: 0.018, r1: 0.045, ph: R() * TAU, bull: true });
    const bulb = bez(P, 1), up = bezD(P, 1);
    sk.bulbs.push({ C: V.add(bulb, up, 0.12), A: up, ra: 0.17, rr: 0.14 });
    const cards = KC('bul'), nb = 16 + Math.floor(R() * 7);
    for (let k = 0; k < nb; k++) {
      sk.blades.push({ stipe: 0, t: 1, side: k / nb * TAU + R() * 0.3, len: (0.3 + 0.2 * R()) * H, wid: 0.11 + 0.05 * R(), card: cards[Math.floor(R() * cards.length)], kind: 'bull', ph: R() * TAU, el: 0, sweep: (R() - 0.5) * 0.4, twist: (R() - 0.5) * 2.0, fold: 0.05, ruf: 0.035 + 0.025 * R() });
    }
  } else if (K.type === 'ala') {
    const cards = KC('ala'), spor = KC('mac').filter(c => !c.old), n = 3 + Math.floor(R() * 3);
    for (let s = 0; s < n; s++) {
      const a = s / n * TAU + R(), st = 0.18 + 0.25 * R(), base = [Math.cos(a) * 0.04, hold * 0.6, Math.sin(a) * 0.04];
      const P = [base, V.add(base, [Math.cos(a) * 0.03, st * 0.4, Math.sin(a) * 0.03]), V.add(base, [Math.cos(a) * 0.06, st * 0.75, Math.sin(a) * 0.06]), V.add(base, [Math.cos(a) * 0.09, st, Math.sin(a) * 0.09])];
      sk.stipes.push({ P, r0: 0.02, r1: 0.016, ph: R() * TAU });
      sk.blades.push({ stipe: s, t: 1, side: a, len: H * (0.6 + 0.3 * R()), wid: 0.2 + 0.07 * R(), card: cards[Math.floor(R() * cards.length)], kind: 'ala', ph: R() * TAU, el: 1.15 + 0.25 * R(), sweep: (R() - 0.5) * 0.4, twist: (R() - 0.5) * 1.2, fold: 0.18, ruf: 0.03 + 0.02 * R() });
      const ns = 3 + Math.floor(R() * 4);
      for (let k = 0; k < ns; k++) sk.blades.push({ stipe: s, t: 0.55 + 0.4 * R(), side: R() * TAU, len: 0.22 + 0.12 * R(), wid: 0.07 + 0.02 * R(), card: spor[Math.floor(R() * spor.length)], kind: 'spor', ph: R() * TAU, el: 0.6 + 0.5 * R(), sweep: 0, twist: (R() - 0.5), fold: 0.15, ruf: 0.006 });
    }
  } else {   // lam: a stout stipe, a palm, digits fanning in a plane
    // two or three individuals: a short stout stipe each, the lamina split into digits that
    // stream together off to one side (the current has combed them)
    const ni = 2 + Math.floor(R() * 2), cards = KC('bul'), flow = (R() - 0.5) * 0.6;   // downstream (+x)
    for (let s = 0; s < ni; s++) {
      const a = s / ni * TAU + R(), st = H * (0.14 + 0.1 * R()), base = [Math.cos(a) * 0.08, hold * 0.6, Math.sin(a) * 0.08];
      const P = [base, V.add(base, [Math.cos(a) * 0.03, st * 0.4, Math.sin(a) * 0.03]), V.add(base, [Math.cos(flow) * st * 0.12, st * 0.75, Math.sin(flow) * st * 0.12]), V.add(base, [Math.cos(flow) * st * 0.25, st, Math.sin(flow) * st * 0.25])];
      sk.stipes.push({ P, r0: 0.05, r1: 0.04, ph: R() * TAU });
      const nd = 5 + Math.floor(R() * 4);
      for (let k = 0; k < nd; k++) {
        const f = k / (nd - 1) - 0.5;
        sk.blades.push({ stipe: s, t: 1, side: flow, fan: f * 0.55, len: H * (0.5 + 0.3 * R()) * (1 - 0.2 * Math.abs(f)), wid: 0.12 + 0.05 * R(), card: cards[Math.floor(R() * cards.length)], kind: 'lam', ph: R() * TAU, el: 0.6, sweep: (R() - 0.5) * 0.3, twist: (R() - 0.5) * 1.4, fold: 0.06, ruf: 0.02 + 0.015 * R() });
      }
    }
  }
  _skel.set(vi, sk);
  return sk;
}

// (lods) THE KELP LOD MORPH. Level 1 keeps every 2nd frond blade (grown 1.35x) and level 2 every
// 3rd (1.6x, no floats), so the switches at 14 u and 40 u used to halve the blades in one frame.
// Every vertex now also carries aKD = (anchor xyz, code): over the last few units before its
// level's switch (gardens.js GD_KELPX, plantKit uKX) a blade the next level drops shrinks into
// its anchor and a kept blade grows toward the next level's size, so the swap lands on (nearly)
// the same plant. code = (band + 1) * 8 + f; f = 0 drop, f >= 1 grow factor; 0 = untouched.
const KX_CODE = (band, f) => (band + 1) * 8 + f;
export function buildKelp(vi, lod) {
  const sk = kelpSkel(vi), K = sk.K, H = K.Href, Lq = LODK[lod], M = new MB();
  const Ln = lod < 2 ? LODK[lod + 1] : null, kxR = [];   // kxR: [v0, v1, ax, ay, az, code]
  const kx = (v0, A, code) => { if (Ln && M.nv > v0) kxR.push(v0, M.nv, A[0], A[1], A[2], code); };
  const STI = KC('sti')[0], HOLD = KC('hold')[0], FLO = KC('flo')[0], BULB = KC('bulb')[0];
  const hN = y => clamp(y / H, 0, 1);
  const stSw = ph => (t, p) => { const h = hN(p[1]); return [h * h, h, 0, ph]; };
  // holdfast: a lumpy mound and its haptera
  if (Lq.hold > 0) {
    const mound = [], nr = 4;
    for (let j = 0; j <= nr; j++) mound.push([0, sk.hold * (j / nr) * 0.95 - 0.04, 0]);
    tube(M, mound, (t, a) => sk.hold * (0.55 * (1 - t * 0.75)) * (1 + 0.22 * vn2(a * 2.2, t * 3, K.seed)), Lq.hold > 1 ? 7 : 5, HOLD, 0.25, () => [0, 0, 0, 0]);
    if (Lq.hold > 1) for (const hp of sk.haptera) {
      const pts = []; for (let j = 0; j <= 4; j++) { const t = j / 4, u = 1 - t; pts.push([0, 1, 2].map(i => u * u * hp.pts[0][i] + 2 * u * t * hp.pts[1][i] + t * t * hp.pts[2][i])); }
      tube(M, pts, t => hp.r * (1 - 0.5 * t), 3, HOLD, 0.2, () => [0, 0, 0, 0]);
    }
  }
  // stipes
  for (const s of sk.stipes) {
    const len = Math.hypot(...V.sub(s.P[3], s.P[0])) * 1.1, n = Math.max(2, Math.ceil(len / Lq.ring)), pts = [];
    for (let j = 0; j <= n; j++) pts.push(bez(s.P, j / n));
    tube(M, pts, t => s.r0 + (s.r1 - s.r0) * (s.bull ? t * t : t), Lq.sides, STI, 0.35, stSw(s.ph));
  }
  for (const b of sk.bulbs) ellip(M, b.C, b.A, b.ra, b.rr, Lq.fsides ? 8 : 5, Lq.fsides ? 6 : 3, BULB, p => { const h = hN(p[1]); return [h * h, h, 0, 0]; }, 0);
  // blades
  let bi = 0;
  for (const b of sk.blades) {
    const special = b.kind === 'apex' || b.kind === 'bull' || b.kind === 'ala' || b.kind === 'lam', bix = special ? -1 : bi++;
    const keep = special || bix % Lq.every === 0;
    if (!keep) continue;
    if (b.kind === 'spor' && lod > 0) continue;
    // (lods) does the next level keep this blade, and how much bigger is it there
    const keepN = Ln && (special || bix % Ln.every === 0) && b.kind !== 'spor';
    // (length ratio x width ratio)^0.5: one uniform scale about the base for a blade the next level
    // draws longer AND wider (len x grow, wid x min(1.3, sqrt(grow)), grow per kind as below)
    const gk = q => b.kind === 'mac' ? q.grow : b.kind === 'apex' ? 1 : Math.sqrt(q.grow);
    const gN = !Ln ? 1 : Math.sqrt((gk(Ln) / gk(Lq)) * (Math.min(1.3, Math.sqrt(gk(Ln))) / Math.min(1.3, Math.sqrt(gk(Lq)))));
    const v0b = M.nv;
    const st = sk.stipes[b.stipe], A = bez(st.P, b.t), Ts = bezD(st.P, Math.min(0.999, b.t));
    const DS = [1, 0, 0], DN = [0, -1, 0];
    const grow = (b.kind === 'mac' ? Lq.grow : b.kind === 'apex' ? 1 : Math.sqrt(Lq.grow));
    const len = b.len * grow, wid = b.wid * Math.min(1.3, Math.sqrt(grow));
    let P0, dir, d2, d3;
    if (b.kind === 'mac' || b.kind === 'apex') {
      // the float leaves the stipe to one side (alternating), the blade turns downstream at once
      const side = V.norm(V.cross(Ts, DS).map((x, i) => x + (i === 2 ? 1e-4 : 0))), sv = V.scale(side, b.side);
      const fa = V.norm(V.add(V.add(sv, DS, 0.7), Ts, 0.5));
      P0 = V.add(A, sv, st.r1 + 0.01);
      if (Lq.floats) {
        const fC = V.add(P0, fa, 0.065), vf = M.nv;
        ellip(M, fC, fa, 0.065, 0.04, Lq.fsides, Lq.frings, FLO, p => { const h = hN(p[1]); return [hN(A[1]) ** 2, h, 0, b.ph]; }, 0.004);
        // (lods) the float goes with its blade, and at the last switch (no floats) on its own
        kx(vf, A, keepN && Ln.floats ? 0 : KX_CODE(lod, 0));
        P0 = V.add(fC, fa, 0.06);
      } else P0 = V.add(P0, fa, 0.12);
      dir = V.norm(V.add(V.add(V.add(sv, DS, 0.9), [0, 1, 0], b.el), Ts, 0.3));
      d2 = V.norm(V.add(V.add(DS, sv, 0.12 + b.sweep * 0.4), [0, 1, 0], 0.15 * b.sweep));
      d3 = V.norm(V.add(V.add(DS, DN, 0.25 + 0.9 * (b.droop ?? 0.5)), sv, 0.08 + 0.2 * b.sweep));
    } else if (b.kind === 'bull') {
      const bl = sk.bulbs[0], rad0 = [0, Math.cos(b.side), Math.sin(b.side)];
      const rad = V.norm(V.sub(rad0, V.scale(bl.A, V.dot(rad0, bl.A))));
      P0 = V.add(bl.C, V.add(V.scale(rad, bl.rr * 0.7), bl.A, bl.ra * 0.4));
      dir = V.norm(V.add(V.add(DS, rad, 0.55), [0, 1, 0], 0.1));
      d2 = V.norm(V.add(DS, rad, 0.22 + b.sweep * 0.2));
      d3 = V.norm(V.add(V.add(DS, DN, 0.55), rad, 0.15));
    } else if (b.kind === 'lam') {
      const fl = [Math.cos(b.side), 0, Math.sin(b.side)], side = V.norm(V.cross(Ts, fl));
      dir = V.norm(V.add(V.add(V.scale(Ts, 0.55), fl, 0.85), side, Math.sin(b.fan)));
      P0 = V.add(A, side, b.fan * 0.06);
      d2 = V.norm(V.add(V.add(dir, [0, 1, 0], 0.25), side, b.sweep));
      d3 = V.norm(V.add(V.add(d2, DN, 0.9), side, b.sweep * 0.5));
    } else {
      const out0 = V.norm(V.sub([Math.cos(b.side), 0, Math.sin(b.side)], V.scale(Ts, V.dot([Math.cos(b.side), 0, Math.sin(b.side)], Ts))));
      P0 = V.add(A, out0, st.r1 + 0.01);
      dir = V.norm(V.add(V.add(V.scale(out0, Math.cos(b.el)), Ts, Math.sin(b.el)), DS, b.kind === 'ala' ? 0.5 : 0.2));
      const sideV = V.norm(V.cross(dir, [0, 1, 0]).map((x, i) => x + (i === 1 ? 1e-4 : 0)));
      d2 = V.norm(V.add(V.add(dir, [0, 1, 0], 0.25), sideV, b.sweep));
      d3 = V.norm(V.add(V.add(d2, DN, b.kind === 'ala' ? 0.9 : 0.55), sideV, b.sweep * 0.5));
    }
    const hb = hN(P0[1]);
    const P = [P0, V.add(P0, dir, len * 0.3), V.add(V.add(P0, dir, len * 0.4), d2, len * 0.3), V.add(V.add(P0, dir, len * 0.35), d3, len * 0.6)];
    // giant/bull kelp blades stand edge-up in the flow (broad faces to the sides, a curtain seen
    // across the current), each rolled a little its own way; the rest lie as before
    const N0 = (b.kind === 'mac' || b.kind === 'apex' || b.kind === 'bull')
      ? V.norm(V.rot(V.norm(V.cross(dir, [0, 1, 0]).map((x, i) => x + (i === 2 ? 1e-4 : 0))), dir, b.twist * 0.6 + (b.ph - Math.PI) * 0.15))
      : V.norm(V.cross(dir, V.norm(V.cross([0, 1, 0], dir).map((x, i) => x + (i === 0 ? 1e-4 : 0)))));
    const rows = b.kind === 'bull' || b.kind === 'ala' || b.kind === 'lam' ? Math.max(Lq.rows, Math.round(Lq.rows * 1.5)) : Lq.rows;
    ribbon(M, {
      P, N0, wid, len, card: b.card, rows, cols: Lq.cols, fit: FIT[b.card.k], exact: true, twist: b.twist, fold: lod ? 0 : b.fold, ruf: lod ? 0 : b.ruf * (b.kind === 'ala' ? 1.4 : 1), rufF: 16, ph: b.ph,
      sw: (t, p) => { const h = hN(p[1]); return [Math.min(1.2, hb * hb + (1.05 - hb * hb) * 0.55 * t), h, sst(0.45, 1, h) * 0.5 * t, b.ph]; },
      flut: t => 0.1 * t * t
    });
    // (lods) the blade itself (its float, if any, was coded above): drop, or grow about its base
    if (Ln) { const vb = Math.max(v0b, kxR.length ? kxR[kxR.length - 5] : 0); kx(vb, P0, keepN ? (Math.abs(gN - 1) > 1e-3 ? KX_CODE(lod, Math.min(7.9, gN)) : 0) : KX_CODE(lod, 0)); }
  }
  const o = M.out(), kd = new Float32Array(M.nv * 4);
  for (let r = 0; r < kxR.length; r += 6) if (kxR[r + 5]) for (let v = kxR[r]; v < kxR[r + 1]; v++) { kd[v * 4] = kxR[r + 2]; kd[v * 4 + 1] = kxR[r + 3]; kd[v * 4 + 2] = kxR[r + 4]; kd[v * 4 + 3] = kxR[r + 5]; }
  o.aKD = kd;
  return o;
}
// host (W, H, W) on a unit mesh -> our scale and sway terms (see plantKit sync)
const KELP_CUR = [Math.cos(0.9), 0, Math.sin(0.9)];
export function kelpRemap(i, sx, sy, amp, shrink) {
  const v = kelpPick(i, sy), Href = KELP_VARIANTS[v].Href;
  const k = clamp(Math.sqrt(sx / 1.7), 0.85, 1.18);
  // cur: the WORLD downstream heading (flora/gardens' base current, CUR0 = 0.9 rad in xz) the kit
  // turns the plant's local +x onto
  return { v, sx: k, sy: sy / Href, amp: amp * sx / k, shrink: 0.4 * k * k * Href / (sy * sy), cur: KELP_CUR };
}

// ---------------------------------------------------------------------------- SEAGRASS
// Clumps in the host's own unit frame (flora.js / gardens.js scale them (W, H, W)): blades
// rise from a short rhizome, sheathed at the base, leaning and arching; far LOD = two or
// three crossed TUFT cards.
export const GRASS_VARIANTS = [{ seed: 5, n: 22 }, { seed: 6, n: 30 }, { seed: 7, n: 18 }, { seed: 8, n: 34 }, { seed: 9, n: 26 }, { seed: 10, n: 16 }];
export function buildGrass(vi, lod) {
  const G = GRASS_VARIANTS[vi], R = mulberry(G.seed * 104729 + 3), M = new MB();
  const straps = GL.filter(c => c.k === 'sg'), tufts = GL.filter(c => c.k === 'tuft');
  const lean = R() * TAU;
  const blades = [];
  for (let i = 0; i < G.n; i++) {
    const a = R() * TAU, r = Math.sqrt(R()) * 0.5, h = 0.4 + 0.6 * R(), la = lean + (R() - 0.5) * 1.6, lk = 0.15 + 0.45 * R() * h;
    blades.push({ a, r, h, la, lk, w: 0.022 + 0.014 * R(), card: straps[Math.floor(R() * straps.length)], ph: R() * TAU, tw: (R() - 0.5) * 2.2 });
  }
  if (lod >= 2) {
    // crossed tuft cards (+ one more at an angle for the bigger clumps)
    const nc = G.n > 20 ? 4 : 3, t0 = tufts[G.seed % tufts.length];
    for (let k = 0; k < nc; k++) {
      const a = lean + k / nc * Math.PI, c = tufts[(G.seed + k) % tufts.length], hw = 0.62, H = 0.9;
      const X = [Math.cos(a), 0, Math.sin(a)], b = M.nv, N = [-X[2], 0, X[0]];
      for (let j = 0; j <= 2; j++) for (let i = 0; i <= 1; i++) {
        const s = i * 2 - 1, t = j / 2, bend = 0.12 * t * t;
        const p = [X[0] * s * hw + Math.cos(lean) * bend, t * H, X[2] * s * hw + Math.sin(lean) * bend];
        M.v(p[0], p[1], p[2], N[0], 0.35, N[2], c.u0 + i * c.w, c.v0 + t * c.h, [Math.pow(t, 1.4), t, 0, k * 2.1], 0.0);
      }
      M.grid(b, 1, 2);
      void t0;
    }
    return M.out();
  }
  // (fill rate) the mid LOD keeps every other blade, a little wider: half the overdraw
  const rows = lod ? 3 : 6;
  let bi = 0;
  for (const b of blades) {
    if (lod && (bi++ & 1)) continue;
    const P0 = [Math.cos(b.a) * b.r, -0.02, Math.sin(b.a) * b.r], L = b.h, D = [Math.cos(b.la), 0, Math.sin(b.la)];
    const P = [P0, V.add(P0, [D[0] * b.lk * 0.1, L * 0.4, D[2] * b.lk * 0.1]), V.add(P0, [D[0] * b.lk * 0.6, L * 0.75, D[2] * b.lk * 0.6]), V.add(P0, [D[0] * b.lk * 1.2, L * (0.96 - 0.25 * b.lk), D[2] * b.lk * 1.2])];
    const N0 = [-D[2], 0, D[0]];
    ribbon(M, {
      P, N0: V.norm(V.rot(N0, [0, 1, 0], b.tw * 0.3)), wid: b.w * (lod ? 1.35 : 1), len: L, card: b.card, rows, cols: 1, fit: FIT.sg, twist: b.tw, fold: 0, ruf: 0, rufF: 0, ph: b.ph,
      sw: (t, p) => [Math.pow(t, 1.4), clamp(p[1], 0, 1), 0, b.ph], flut: t => 0.02 * t * t
    });
  }
  return M.out();
}
