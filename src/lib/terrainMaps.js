// THE SEABED'S DETAIL MAPS, GENERATED. OWNED BY: terrain agent (lib/triplanar.js is the only caller).
//
// Replaces the three downloaded AmbientCG sets (Ground054 silt, Gravel023 sediment, Rock035 rock) that
// triplanar.js used to load from assets/textures/*.jpg, under the HARD RULE (Michael 2026-08-07: every
// asset is generated in code). The packing is the one the shader already reads, so the GLSL is untouched:
//   albedo  RGB = silt / sediment / rock structure, greyscale, level-normalised to a 0.5 mean
//   rough   RGB = the same three, roughness structure, 0.5 mean
//   nSilt / nSed / nRock = tangent normals, OpenGL green (three.js), rgb in 0..1
// Each channel is MOMENT-MATCHED to the shipped set it replaces (mean and spread of the albedo and
// roughness, the spread of the normals' x/y), measured off the old jpgs on 2026-11-22, so the shader's
// constants and the zone palettes see the same contrast they were tuned against:
//   albedo sd  0.107 / 0.180 / 0.153      rough sd  0.149 / 0.236 / 0.187      normal xy sd  0.085 / 0.163 / 0.148
// Everything tiles exactly (every lattice and cell grid is modulo the tile) and is seeded: the same seabed
// every load. 512^2 (the old set was 1024^2 at one repeat per 8 u: 64 texels a unit is past what the fog
// and the mip chain let through at play distance). Pure: bakeTerrainMaps() has no THREE, so node can bake
// and measure it (the bench's check) and the page wraps the bytes in DataTextures.
//
// The three materials:
//   SILT      fine mud: a low soft swell, current ripple marks (crests asymmetric, warped, broken), burrow
//             pits and a fine grain; the smoothest of the three, as Ground054 was.
//   SEDIMENT  gritty pebble ground: a packed Worley field of domed stones of mixed size in a finer grit
//             matrix, each stone its own tone and gloss; the roughest relief, as Gravel023 was.
//   ROCK      fractured stone: a warped body, bedding ledges, a fissure net in patches and a few long
//             splits, pitting; the house rock (lib/textures.js rockMapSet) in spirit, at the seabed's scale.

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function lattice(rand, n) { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rand(); return { n, g }; }
// tileable smoothed value noise at (u, v) in tile units
function smp(L, u, v) {
  const n = L.n, g = L.g;
  const fx = (u - Math.floor(u)) * n, fy = (v - Math.floor(v)) * n;
  const xi = Math.floor(fx), yi = Math.floor(fy);
  const x0 = xi % n, y0 = yi % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  let tx = fx - xi, ty = fy - yi; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
  const top = a + (b - a) * tx; return top + ((c + (d - c) * tx) - top) * ty;
}
function fbm(octs, u, v) { let s = 0, a = 0.5, t = 0; for (let i = 0; i < octs.length; i++) { s += smp(octs[i], u, v) * a; t += a; a *= 0.5; } return s / t; }
// Worley on the torus, one jittered point per cell: returns f1, f2 and the nearest cell's id (via out)
function worley(rand, WC, jit = 1) {
  const px = new Float32Array(WC * WC), py = new Float32Array(WC * WC), id = new Float32Array(WC * WC);
  for (let i = 0; i < WC * WC; i++) { px[i] = 0.5 + (rand() - 0.5) * jit; py[i] = 0.5 + (rand() - 0.5) * jit; id[i] = rand(); }
  const out = { f1: 0, f2: 0, id: 0 };
  return (u, v) => {
    const fx = (u - Math.floor(u)) * WC, fy = (v - Math.floor(v)) * WC, cx = Math.floor(fx), cy = Math.floor(fy);
    let f1 = 9, f2 = 9, k = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j, ix = ((gx % WC) + WC) % WC, iy = ((gy % WC) + WC) % WC, c = iy * WC + ix;
      const dx = gx + px[c] - fx, dy = gy + py[c] - fy, d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; k = id[c]; } else if (d < f2) f2 = d;
    }
    out.f1 = f1; out.f2 = f2; out.id = k; return out;
  };
}
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ridged noise: sharp creases where the value field crosses its middle (fractures, worm casts)
function ridged(octs, u, v) { let s = 0, a = 0.5, t = 0; for (let i = 0; i < octs.length; i++) { const r = 1 - Math.abs(2 * smp(octs[i], u, v) - 1); s += r * r * a; t += a; a *= 0.5; } return s / t; }

function silt(S, rand, H, A, R) {
  const swell = [4, 8, 16].map(n => lattice(rand, n)), warp = [6, 12].map(n => lattice(rand, n));
  const lumps = [24, 48, 96].map(n => lattice(rand, n));      // bioturbation: worm casts, mounds, pocks
  const grain = [128, 256, 512].map(n => lattice(rand, n)), patch = [5, 10, 20].map(n => lattice(rand, n));
  const pits = worley(rand, 31, 0.9), casts = [16, 32, 64].map(n => lattice(rand, n));
  for (let y = 0; y < S; y++) { const v = y / S; for (let x = 0; x < S; x++) {
    const u = x / S, i = y * S + x;
    const sw = fbm(swell, u, v), w = fbm(warp, u + 0.37, v + 0.11) - 0.5, p = fbm(patch, u + 0.7, v + 0.2);
    const lp = fbm(lumps, u + w * 0.04, v - w * 0.04);
    const cast = ridged(casts, u + w * 0.08, v + 0.3) ;               // faint meandering casts
    const pt = pits(u + w * 0.03, v), pit = pt.id > 0.55 ? Math.max(0, 1 - pt.f1 / (0.18 + 0.15 * pt.id)) : 0;
    const g = fbm(grain, u, v) - 0.5;
    H[i] = 0.25 * sw + 0.45 * lp + 0.10 * cast * sst(0.45, 0.65, p) - 0.22 * pit * pit + 0.18 * g;
    A[i] = 0.20 * sw + 0.25 * (lp - 0.5) + 0.40 * g + 0.12 * (p - 0.5) - 0.30 * pit * pit;
    R[i] = 0.5 + 0.15 * (p - 0.5) + 0.55 * g + 0.15 * pit - 0.1 * (lp - 0.5);
  } }
}

function sediment(S, rand, H, A, R) {
  const big = worley(rand, 15, 0.95), mid = worley(rand, 27, 0.95), small = worley(rand, 50, 0.9);
  const grit = [128, 256, 512].map(n => lattice(rand, n)), patch = [4, 8, 16].map(n => lattice(rand, n));
  const skin = [64, 128].map(n => lattice(rand, n));
  for (let y = 0; y < S; y++) { const v = y / S; for (let x = 0; x < S; x++) {
    const u = x / S, i = y * S + x;
    const p = fbm(patch, u, v);
    const b = big(u, v), bf1 = b.f1, bid = b.id, bE = b.f2 - b.f1;
    const m = mid(u, v), mf1 = m.f1, mid_ = m.id, mE = m.f2 - m.f1;
    const s = small(u, v), sf1 = s.f1, sid = s.id, sE = s.f2 - s.f1;
    // stones fill their cells (packed gravel), sized by id; bigger stones where the patch field says
    const db = bid > 0.55 - 0.35 * p ? Math.max(0, 1 - (bf1 / (0.44 + 0.10 * bid)) ** 2) * sst(0, 0.25, bE) : 0;
    const dm = mid_ > 0.2 ? Math.max(0, 1 - (mf1 / (0.42 + 0.10 * mid_)) ** 2) * sst(0, 0.25, mE) : 0;
    const ds = Math.max(0, 1 - (sf1 / 0.45) ** 2) * sst(0, 0.25, sE);
    const g = fbm(grit, u, v) - 0.5, sk = fbm(skin, u, v) - 0.5;
    const domeB = Math.sqrt(db), domeM = Math.sqrt(dm), domeS = Math.sqrt(ds);
    let h = 0.18 * domeS, tone = 0.3 + 0.5 * sid, gloss = 0.2 * domeS;
    if (0.10 + 0.28 * domeM > h && dm > 0) { h = 0.10 + 0.28 * domeM; tone = 0.15 + 0.75 * mid_; gloss = 0.5 * domeM; }
    if (0.16 + 0.36 * domeB > h && db > 0) { h = 0.16 + 0.36 * domeB; tone = 0.1 + 0.85 * bid; gloss = 0.7 * domeB; }
    const lit = Math.max(domeB, domeM, domeS);
    H[i] = h + 0.05 * g + 0.03 * sk;
    // the stones' own tone, rimmed dark where they meet (contact shadow), the grit between them near black
    const rim = Math.max(domeB > 0 ? domeB : 0, domeM > 0 ? domeM : 0, domeS * 0.7);
    A[i] = (0.08 + tone) * (0.25 + 0.75 * Math.sqrt(rim)) + 0.18 * g + 0.12 * sk;
    R[i] = 0.75 + 0.35 * g - 0.5 * gloss + 0.1 * sk;
  } }
}

function rock(S, rand, H, A, R) {
  const body = [6, 12, 24, 48, 96, 192].map(n => lattice(rand, n)), warp = [3, 6, 12].map(n => lattice(rand, n));
  const frac = [8, 16, 32, 64].map(n => lattice(rand, n)), frac2 = [12, 24, 48].map(n => lattice(rand, n));
  const grit = [128, 256, 512].map(n => lattice(rand, n)), mask = [4, 8, 16].map(n => lattice(rand, n));
  const pits = worley(rand, 47, 0.9);
  const BANDS = 9, ang = 0.62, ca = Math.cos(ang), sa = Math.sin(ang);
  for (let y = 0; y < S; y++) { const v = y / S; for (let x = 0; x < S; x++) {
    const u = x / S, i = y * S + x;
    const w = fbm(warp, u + 0.31, v + 0.77) - 0.5;
    const bo = fbm(body, u + w * 0.12, v - w * 0.1);
    // bedding running on a slant (u and v both integer multiples so it still tiles: 9 bands along v, 4 across u)
    let ph = (v * BANDS + u * 4 + w * 1.4 + bo * 0.5) % 1; if (ph < 0) ph += 1;
    const strata = ph < 0.78 ? ph / 0.78 : 1 - (ph - 0.78) / 0.22;
    // fractures: ridged creases, stretched along the bedding by the warp, in patches
    const fr = ridged(frac, u * 1 + w * 0.2, v + w * 0.15), fr2 = ridged(frac2, u - w * 0.1, v * 1 + 0.4);
    const mk = sst(0.42, 0.62, fbm(mask, u + 0.61, v + 0.23));
    const crack = Math.pow(fr, 6) * (0.4 + 0.6 * mk) + Math.pow(fr2, 10) * 0.6;
    const pt = pits(u, v), pit = pt.id > 0.65 ? Math.max(0, 1 - pt.f1 / 0.3) : 0;
    const g = fbm(grit, u, v) - 0.5;
    H[i] = 0.55 * bo + 0.05 * strata - 0.45 * crack - 0.10 * pit + 0.12 * g;
    A[i] = 0.55 * bo + 0.10 * strata - 0.40 * crack - 0.15 * pit + 0.35 * g + 0.15 * Math.pow(fr2, 4) * mk;
    R[i] = 0.5 + 0.30 * crack + 0.12 * (1 - strata) + 0.40 * g + 0.1 * pit;
  } }
}

// affine to (mean, sd), clamped to 0..1
function matchMoments(a, mean, sd) {
  let m = 0, q = 0; const N = a.length;
  for (let i = 0; i < N; i++) m += a[i]; m /= N;
  for (let i = 0; i < N; i++) { const d = a[i] - m; q += d * d; }
  const k = sd / Math.max(1e-6, Math.sqrt(q / N));
  for (let i = 0; i < N; i++) a[i] = Math.min(1, Math.max(0, mean + (a[i] - m) * k));
}
// height -> normal, with the slope chosen so the encoded x/y spread is `sd` (bisection on a subsample)
function normals(h, S, sd, out) {
  const gx = new Float32Array(S * S), gy = new Float32Array(S * S);
  for (let y = 0; y < S; y++) { const ym = ((y - 1 + S) % S) * S, yp = ((y + 1) % S) * S;
    for (let x = 0; x < S; x++) { const xm = (x - 1 + S) % S, xp = (x + 1) % S, i = y * S + x;
      gx[i] = (h[y * S + xp] - h[y * S + xm]) * 0.5 * S; gy[i] = (h[yp + x] - h[ym + x]) * 0.5 * S; } }
  const spread = (s) => { let q = 0, n = 0; for (let i = 0; i < gx.length; i += 7) { const nx = -gx[i] * s, ny = -gy[i] * s, il = 1 / Math.hypot(nx, ny, 1); q += (nx * il) ** 2 * 0.25 + (ny * il) ** 2 * 0.25; n += 2; } return Math.sqrt(q / n); };
  let lo = 0, hi = 1; while (spread(hi) < sd && hi < 1e4) hi *= 2;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (spread(mid) < sd) lo = mid; else hi = mid; }
  const s = (lo + hi) / 2;
  for (let i = 0; i < S * S; i++) {
    // OpenGL green: +y is +v (row index up the tile, flipY false in the page)
    const nx = -gx[i] * s, ny = -gy[i] * s, il = 1 / Math.hypot(nx, ny, 1), o = i * 4;
    out[o] = Math.round((nx * il * 0.5 + 0.5) * 255); out[o + 1] = Math.round((ny * il * 0.5 + 0.5) * 255);
    out[o + 2] = Math.round((il * 0.5 + 0.5) * 255); out[o + 3] = 255;
  }
}

// the moments of the shipped AmbientCG set each channel replaces (see the header)
export const TERRAIN_TARGET = {
  albedo: { mean: [0.503, 0.509, 0.467], sd: [0.107, 0.180, 0.153] },
  rough: { mean: [0.507, 0.525, 0.521], sd: [0.149, 0.236, 0.187] },
  nrm: [0.085, 0.163, 0.148],
};

export function bakeTerrainMaps(S = 512) {
  const N = S * S, T = TERRAIN_TARGET;
  const make = [silt, sediment, rock], seeds = [0x51170001, 0x5ED10002, 0x0C0C0003];
  const alb = new Uint8Array(N * 4), rgh = new Uint8Array(N * 4), nrm = [0, 1, 2].map(() => new Uint8Array(N * 4));
  const H = new Float32Array(N), A = new Float32Array(N), R = new Float32Array(N);
  for (let c = 0; c < 3; c++) {
    make[c](S, mulberry(seeds[c]), H, A, R);
    matchMoments(A, T.albedo.mean[c], T.albedo.sd[c]);
    matchMoments(R, T.rough.mean[c], T.rough.sd[c]);
    for (let i = 0; i < N; i++) { alb[i * 4 + c] = Math.round(A[i] * 255); rgh[i * 4 + c] = Math.round(R[i] * 255); }
    normals(H, S, T.nrm[c], nrm[c]);
  }
  for (let i = 0; i < N; i++) { alb[i * 4 + 3] = 255; rgh[i * 4 + 3] = 255; }
  return { size: S, albedo: alb, rough: rgh, nSilt: nrm[0], nSed: nrm[1], nRock: nrm[2] };
}
