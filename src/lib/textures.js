// Procedural texture helpers shared across modules. READ-ONLY for feature agents
// (add new generators here only if no other agent owns the concept).
import * as THREE from 'three';
import { rng } from './math.js';

// ---- anisotropy ---------------------------------------------------------------------
// The device's real max anisotropy. core.js calls setMaxAniso(renderer) at module scope,
// immediately after the renderer is built — before any world module evaluates — so every
// toTexture() after that picks the true cap. The default 8 only ever applies to textures
// built by modules core.js itself pulls in (none currently make mip-mapped surfaces).
let MAX_ANISO = 8;
export function setMaxAniso(renderer) {
  const m = renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy();
  if (m) MAX_ANISO = m;
}
export const maxAniso = () => MAX_ANISO;

export const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

export function makeGlow(color, scale) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity: 0.8,
    depthWrite: false, blending: THREE.AdditiveBlending
  }));
  s.scale.setScalar(scale);
  return s;
}

export function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { canvas: c, ctx: c.getContext('2d') };
}

export function toTexture(canvas, repeat = 1, srgb = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

// ---- shared generic surface pair ---------------------------------------------------
// One 256 noise-derived roughnessMap + normalMap, reused by several modules at their own
// repeats (vent crust, prop de-plastic, diver satellites). The canvases are built once;
// each surfacePair() call is just two cheap CanvasTexture wrappers over the same pixels,
// so different repeats never mean re-generating the noise. Deterministic seed: this pair
// is scenery-wide, it must never drift between boots.
let _surf = null;
export function surfacePair(repeat = 1) {
  if (!_surf) {
    const S = 256;
    const hc = noiseCanvas(S, 5, 1.1, seededRand(0x5EAF00D));
    const hd = hc.getContext('2d').getImageData(0, 0, S, S).data;
    const { canvas: rc, ctx: r } = canvas2d(S);
    const ri = r.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      // multiplier map: mostly 1, dipping to ~0.72 in the low spots — tooth, not sparkle
      const v = hd[i * 4] / 255;
      const g = (0.72 + 0.28 * v) * 255;
      ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = g;
      ri.data[i * 4 + 3] = 255;
    }
    r.putImageData(ri, 0, 0);
    _surf = { rc, nc: normalFromHeight(hc, 1.4) };
  }
  return { rough: toTexture(_surf.rc, repeat), nrm: toTexture(_surf.nc, repeat) };
}

// mulberry32 — the project's house deterministic stream (same body as site.js/weather.js),
// exposed here so texture generators can be seeded without importing world modules.
export function seededRand(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable fractal-noise canvas; returns grayscale ImageData-backed canvas.
export function noiseCanvas(size, octaves = 4, contrast = 1, rand = Math.random) {
  const { canvas, ctx } = canvas2d(size);
  const img = ctx.createImageData(size, size);
  const grid = [];
  for (let o = 0; o < octaves; o++) {
    const n = 4 << o, g = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) g[i] = rand();
    grid.push({ n, g });
  }
  const sample = (layer, x, y) => {
    const { n, g } = layer;
    const fx = x * n, fy = y * n;
    const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < octaves; o++) { v += sample(grid[o], x / size, y / size) * amp; tot += amp; amp *= 0.5; }
    v = Math.pow(v / tot, contrast);
    const i = (y * size + x) * 4, c = (v * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Derive a tangent-space normal map from a grayscale height canvas.
export function normalFromHeight(heightCanvas, strength = 2) {
  const size = heightCanvas.width;
  const hctx = heightCanvas.getContext('2d');
  const h = hctx.getImageData(0, 0, size, size).data;
  const { canvas, ctx } = canvas2d(size);
  const out = ctx.createImageData(size, size);
  const at = (x, y) => h[((((y + size) % size) * size + ((x + size) % size)) * 4)] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
    const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    out.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
    out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
    out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

// ---- THE RIPPLE NORMAL (water.js, surface detail) ------------------------------------
// One 1024x1024 tangent-space normal of wind-ruffled water: two tileable fbm bands
// (long-ish ruffle + fine capillary) and a trace of cellular (worley) dimpling rounded
// off hard so it gives shape, not creases. Baked ONCE on the CPU, seeded, and handed
// over as a mipmapped, anisotropic, RepeatWrapping DataTexture in LINEAR colour space --
// a normal is data, never colour. The sea samples it with textureGrad at three rotated
// incommensurate scales, so a single tile has to hold up under any rotation and any
// footprint: tileability is exact (every lattice is modulo the tile), the mips are the
// device's own, and the anisotropy is what keeps the near-horizon taps from smearing.
// Cost is boot-only (~1 s of JS at 1024^2); water.js asks for it lazily at buildSurface.
// Alpha carries the height, in case a caller wants it.
let _ripple = null;
export function rippleNormalTex() {
  if (_ripple) return _ripple;
  const S = 1024, N = S * S;
  const rand = seededRand(0x51D3A7E5);
  // Tileable value-noise lattice at n cells per tile, smoothstep-interpolated.
  const lattice = (n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) g[i] = rand();
    return { n, g };
  };
  const smp = (L, x, y) => {           // x, y in tile units [0,1)
    const { n, g } = L;
    const fx = x * n, fy = y * n;
    const xi = Math.floor(fx), yi = Math.floor(fy);
    const x0 = xi % n, y0 = yi % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    let tx = fx - xi, ty = fy - yi;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  };
  // fbm A: 5 octaves from 11 cells; fbm B: 4 octaves from 26 cells (offset lattice set).
  const octA = [11, 22, 44, 88, 176].map(lattice);
  const octB = [26, 52, 104, 208].map(lattice);
  // Worley: 30x30 cells, one jittered feature point each, F1 distance, torus metric.
  const WC = 30, wpx = new Float32Array(WC * WC), wpy = new Float32Array(WC * WC);
  for (let i = 0; i < WC * WC; i++) { wpx[i] = rand(); wpy[i] = rand(); }
  const worley = (x, y) => {
    const fx = x * WC, fy = y * WC;
    const cx = Math.floor(fx), cy = Math.floor(fy);
    let best = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const ix = ((gx % WC) + WC) % WC, iy = ((gy % WC) + WC) % WC;
      const dx = gx + wpx[iy * WC + ix] - fx, dy = gy + wpy[iy * WC + ix] - fy;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.min(1, Math.sqrt(best));
  };
  const h = new Float32Array(N);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      let a = 0, amp = 0.5, tot = 0;
      for (let o = 0; o < 5; o++) { a += smp(octA[o], u, v) * amp; tot += amp; amp *= 0.5; }
      a /= tot;
      let b = 0; amp = 0.5; tot = 0;
      const ub = u + 0.371, vb = v + 0.129;   // a different phase of the tile, still tileable
      for (let o = 0; o < 4; o++) { b += smp(octB[o], ub - Math.floor(ub), vb - Math.floor(vb)) * amp; tot += amp; amp *= 0.5; }
      b /= tot;
      // 1 - F1 peaks at the feature points: dimples, smoothstepped hard so the cell
      // edges never print as creases.
      let c = 1 - worley(u, v);
      c = Math.min(1, Math.max(0, (c - 0.10) / 0.85)); c = c * c * (3 - 2 * c);
      h[y * S + x] = a * 0.56 + b * 0.30 + c * 0.14;
    }
  }
  // Central differences on the torus -> tangent-space normal. SLOPE sets the baked
  // steepness; the shader applies its own gains on top, so this only has to fill the
  // 8-bit range without clipping.
  const SLOPE = 5.5, data = new Uint8Array(N * 4), e = 1.5 / S;
  for (let y = 0; y < S; y++) {
    const ym = (y - 1 + S) % S, yp = (y + 1) % S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S;
      const gx = (h[y * S + xp] - h[y * S + xm]) / (2 * e);
      const gy = (h[yp * S + x] - h[ym * S + x]) / (2 * e);
      let nx = -gx * SLOPE, ny = 1, nz = -gy * SLOPE;
      const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
      const i = (y * S + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = Math.min(255, Math.max(0, h[y * S + x] * 255));
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = MAX_ANISO;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  _ripple = t;
  return t;
}

// ---- THE ROCK MAP SET (flora.js, boulders) --------------------------------------------
// Weathered stone, generated: two variants baked once on the CPU, each a PAIR of
// 512x512 RepeatWrapping, mipmapped, anisotropic DataTextures.
//   pack : R = albedo multiplier (mean ~1.0, so it multiplies INTO the zone palette,
//              never replaces it), G = roughness (0..1), B = height (0..1), A = 255.
//   nrm  : tangent-space normal (linear, NoColorSpace), A = height again.
// The height is three things summed: layered fbm STRATA (bedding planes -- a sine of
// v warped by a low fbm, integer band count so the tile closes), Worley FISSURES
// (F2-F1 valleys carved down as thin dark cracks along the cell borders) and fine
// GRIT (a high-octave lattice). Variant 1 (the deep zones) is darker, more fissured,
// and carries a mineral crust: bright speckle pooled in low-frequency Worley blotches.
// Everything is a tileable lattice modulo the tile, like rippleNormalTex, so the
// triplanar projection in flora.js can sample it at any world scale and rotation.
// Boot cost: ~60-90 ms per variant at 512^2 (measured 2026-09, M-series Safari/Chrome).
const _rockSets = [null, null];
export function rockMapSet(variant = 0) {
  if (_rockSets[variant]) return _rockSets[variant];
  const S = 512, N = S * S, deep = variant === 1;
  const rand = seededRand(deep ? 0xBA5A17C0 : 0x5707E5ED);
  const lattice = (n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) g[i] = rand();
    return { n, g };
  };
  const smp = (L, x, y) => {
    const { n, g } = L;
    x -= Math.floor(x); y -= Math.floor(y);
    const fx = x * n, fy = y * n;
    const xi = Math.floor(fx), yi = Math.floor(fy);
    const x0 = xi % n, y0 = yi % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    let tx = fx - xi, ty = fy - yi;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
    const top = a + (b - a) * tx;
    return top + ((c + (d - c) * tx) - top) * ty;
  };
  const fbmL = (octs, x, y) => {
    let v = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < octs.length; o++) { v += smp(octs[o], x, y) * amp; tot += amp; amp *= 0.5; }
    return v / tot;
  };
  const base = [6, 12, 24, 48, 96].map(lattice);   // body fbm
  const warp = [3, 6, 12].map(lattice);              // strata warp
  const grit = [64, 128, 256].map(lattice);          // fine grit
  // Worley: F1 and F2 on a torus, one jittered point per cell.
  const worley = (WC) => {
    const px = new Float32Array(WC * WC), py = new Float32Array(WC * WC);
    for (let i = 0; i < WC * WC; i++) { px[i] = rand(); py[i] = rand(); }
    return (x, y) => {
      const fx = x * WC, fy = y * WC, cx = Math.floor(fx), cy = Math.floor(fy);
      let f1 = 9, f2 = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const gx = cx + i, gy = cy + j;
        const ix = ((gx % WC) + WC) % WC, iy = ((gy % WC) + WC) % WC;
        const dx = gx + px[iy * WC + ix] - fx, dy = gy + py[iy * WC + ix] - fy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      return [f1, f2];
    };
  };
  const cracks = worley(deep ? 11 : 8);     // fissure network (fine)
  const splits = worley(3);                 // the few big splits per tile
  const crust = worley(5);                  // mineral-crust blotches (deep only)
  const mask = [4, 8, 16].map(lattice);     // where the fine fissures live at all
  const BANDS = deep ? 9 : 7;               // bedding planes per tile
  const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const h = new Float32Array(N), alb = new Float32Array(N), rgh = new Float32Array(N);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      const body = fbmL(base, u, v);                                   // 0..1, mean .5
      const w = fbmL(warp, u + 0.31, v + 0.77) - 0.5;
      // strata: asymmetric sawtooth of bedding -- a slow rise, a sharp drop (the
      // ledge). Warped by the low fbm so the planes undulate instead of ruling lines.
      let ph = (v * BANDS + w * 0.9 + body * 0.25) % 1; if (ph < 0) ph += 1;
      const strata = ph < 0.82 ? ph / 0.82 : 1 - (ph - 0.82) / 0.18;
      const ledge = ph > 0.82 ? 1 : 0;
      // Fissures: a full Voronoi net reads as dry mud, so the fine net only exists
      // inside a patchy fbm mask (~40% of the tile, soft-edged), and a second, much
      // sparser Worley supplies the two or three long splits every real boulder has.
      const [f1, f2] = cracks(u + w * 0.05, v - w * 0.04);
      const fine = 1 - Math.min(1, (f2 - f1) / (deep ? 0.09 : 0.07));
      const mk = sst(deep ? 0.44 : 0.50, deep ? 0.60 : 0.66, fbmL(mask, u + 0.61, v + 0.23));
      const [s1, s2] = splits(u - w * 0.08, v + w * 0.06);
      const big = 1 - Math.min(1, (s2 - s1) / 0.11);
      let ck = Math.max(fine * fine * (3 - 2 * fine) * mk, big * big * (3 - 2 * big) * 0.85);
      const g = fbmL(grit, u, v) - 0.5;
      let hh = 0.52 * body + 0.22 * strata - 0.30 * ck + 0.12 * g + 0.14;
      let a = 0.86 + 0.22 * body + 0.045 * strata - 0.30 * ck + 0.07 * g + ledge * 0.04 * (1 - ck);
      let r = 0.64 + 0.28 * ck + 0.10 * (1 - strata) + 0.08 * Math.abs(g) * 2;
      if (deep) {
        const [c1, c2] = crust(u, v);
        const blot = Math.max(0, 1 - c1 / 0.55);                        // pooled crust
        const speck = Math.max(0, (smp(grit[2], u * 1.7, v * 1.3) - 0.74) / 0.26);
        a = a * 0.86 - 0.05 * blot + speck * blot * 0.22;             // darker, crusted
        r = r * 0.92 + blot * 0.10 - speck * blot * 0.18;
        hh += speck * blot * 0.03 - blot * 0.03 - (1 - Math.min(1, (c2 - c1) / 0.06)) * 0.04;
      }
      h[i] = hh; alb[i] = a; rgh[i] = r;
    }
  }
  // Level-normalise the albedo multiplier to a 1.0 mean: structure, not brightness.
  let mean = 0; for (let i = 0; i < N; i++) mean += alb[i]; mean /= N;
  const pack = new Uint8Array(N * 4), nrm = new Uint8Array(N * 4);
  const SLOPE = 3.2, e = 1.5 / S;
  for (let y = 0; y < S; y++) {
    const ym = (y - 1 + S) % S, yp = (y + 1) % S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S, i = y * S + x, o = i * 4;
      const gx = (h[y * S + xp] - h[y * S + xm]) / (2 * e);
      const gy = (h[yp * S + x] - h[ym * S + x]) / (2 * e);
      let nx = -gx * SLOPE, ny = -gy * SLOPE, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
      const hb = Math.min(255, Math.max(0, h[i] * 255)) | 0;
      // albedo multiplier packed as value/1.6 so the range [0,1.6] fits 8 bits.
      pack[o] = Math.min(255, Math.max(0, (alb[i] / mean) / 1.6 * 255)) | 0;
      pack[o + 1] = Math.min(255, Math.max(0, rgh[i] * 255)) | 0;
      pack[o + 2] = hb; pack[o + 3] = 255;
      nrm[o] = (nx * 0.5 + 0.5) * 255; nrm[o + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[o + 2] = (nz * 0.5 + 0.5) * 255; nrm[o + 3] = hb;
    }
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = MAX_ANISO;
    t.colorSpace = THREE.NoColorSpace;   // structure and normals are data, never colour
    t.needsUpdate = true;
    return t;
  };
  _rockSets[variant] = { pack: mk(pack), nrm: mk(nrm), size: S };
  return _rockSets[variant];
}

export { rng };

// =====================================================================================
// ==== BLOCK: polish-world (wrecks / flora / gardens) — appended 2026-09-25 ===========
// Owned by the polish-world branch. Two generated sets, both baked once, cached forever,
// both DataTextures (mipmapped, anisotropic, RepeatWrapping):
//   ironPlateSet()  riveted ship plating for the wrecks
//   bladeMapSet()   the thin-blade vein/rib map for kelp and fan blades
// =====================================================================================

// Shared tileable lattice helpers for this block (the rock set keeps its own copies so
// its bake stays bit-identical).
function _pwLattice(rand, n) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = rand();
  return { n, g };
}
function _pwSmp(L, x, y) {
  const { n, g } = L;
  x -= Math.floor(x); y -= Math.floor(y);
  const fx = x * n, fy = y * n, xi = Math.floor(fx), yi = Math.floor(fy);
  const x0 = xi % n, y0 = yi % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  let tx = fx - xi, ty = fy - yi;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
  const top = a + (b - a) * tx;
  return top + ((c + (d - c) * tx) - top) * ty;
}
function _pwFbm(octs, x, y) {
  let v = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < octs.length; o++) { v += _pwSmp(octs[o], x, y) * amp; tot += amp; amp *= 0.5; }
  return v / tot;
}
function _pwTex(data, S, T, srgb) {
  const t = new THREE.DataTexture(data, S, T, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = MAX_ANISO;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
function _pwNormals(h, S, T, slope, out, aFn) {
  const ex = 1.5 / S, ey = 1.5 / T;
  for (let y = 0; y < T; y++) {
    const ym = (y - 1 + T) % T, yp = (y + 1) % T;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S, i = y * S + x, o = i * 4;
      const gx = (h[y * S + xp] - h[y * S + xm]) / (2 * ex);
      const gy = (h[yp * S + x] - h[ym * S + x]) / (2 * ey);
      let nx = -gx * slope, ny = -gy * slope, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
      out[o] = (nx * 0.5 + 0.5) * 255; out[o + 1] = (ny * 0.5 + 0.5) * 255;
      out[o + 2] = (nz * 0.5 + 0.5) * 255; out[o + 3] = aFn ? aFn(i) : 255;
    }
  }
}

// ---- THE IRON PLATE SET (wrecks.js: trawler, submersible, every iron fitting) --------
// One tile = two strakes of riveted plating (u runs along the strake, v across it).
// Each strake is two plates butted end to end, the butts staggered strake to strake the
// way a yard lays them. The strake's LOWER edge laps proud over the one below (a height
// ramp across the strake that drops at the seam), seams are cut as grooves, and rivet
// heads stand in double rows along every lap and single rows down every butt.
// Dents: a handful of broad pressure dishes per plate plus low fbm. Rust: patchy bloom
// that POOLS round every rivet head and weeps along the seams, over a dark grey-green
// oxide paint that survives in the flat middles of the plates.
//   map   (sRGB)   : RGB albedo, A = rust SOURCE mask (rivet blooms + seam weep) — the
//                    wreck shader smears this down the hull along world gravity.
//   nrm   (linear) : tangent-space normal, A = cavity (0 in seams/around heads).
//   pack  (linear) : R = unused (1), G = roughness (three reads .g), B = height, A = 255.
// Boot cost ~70 ms at 512^2 (measured in the polish-world log).
let _ironSet = null;
export function ironPlateSet() {
  if (_ironSet) return _ironSet;
  const S = 512, N = S * S;
  const rand = seededRand(0x1A0B7A7E);
  const low = [4, 8, 16].map(n => _pwLattice(rand, n));
  const mid = [16, 32, 64].map(n => _pwLattice(rand, n));
  const fine = [64, 128, 256].map(n => _pwLattice(rand, n));
  const STRAKES = 2, RIV_U = 22, RIV_B = 7;
  // per-plate dents: 4 strake-plates per tile, three dishes each
  const dents = [];
  for (let k = 0; k < STRAKES * 2 * 3; k++) dents.push([rand(), rand(), 0.05 + rand() * 0.09, 0.5 + rand() * 0.8]);
  const h = new Float32Array(N), src = new Float32Array(N), rust = new Float32Array(N), cav = new Float32Array(N);
  const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < S; y++) {
    const v = y / S;
    const sv = v * STRAKES, si = Math.floor(sv), sf = sv - si;       // strake index / frac
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      // butt joints: plates are half a tile long, staggered a quarter tile per strake
      const bu = (u * 2 + si * 0.5) % 1, bi = Math.floor(u * 2 + si * 0.5);
      // distances (in tile units) to the nearest lap seam and nearest butt
      const dSeam = Math.min(sf, 1 - sf) / STRAKES;
      const dButt = Math.min(bu, 1 - bu) / 2;
      // plate body: lap ramp (lower edge proud), broad dents, low fbm buckle
      let hh = 0.46 + 0.07 * sf + 0.10 * (_pwFbm(low, u, v) - 0.5);
      for (let k = 0; k < 3; k++) {
        const d = dents[((si * 2 + (bi & 1)) * 3 + k) % dents.length];
        const cx = (d[0] * 0.5 + (bi & 1) * 0.5 - si * 0.25), cy = (si + 0.15 + d[1] * 0.7) / STRAKES;
        let dx = u - cx; dx -= Math.round(dx);
        let dy = v - cy; dy -= Math.round(dy);
        hh -= 0.05 * d[3] * Math.exp(-(dx * dx + dy * dy) / (d[2] * d[2]));
      }
      // seams: cut grooves, the lap edge rounded over
      const seamG = 1 - sst(0.0, 0.0065, dSeam), buttG = 1 - sst(0.0, 0.005, dButt);
      hh -= 0.20 * Math.max(seamG, buttG);
      // rivets: double row either side of every lap seam, single row down every butt
      let riv = 0, near = 0;
      const ru = u * RIV_U, rf = ru - Math.floor(ru) - 0.5;
      for (const off of [0.018, 0.036]) {
        for (const side of [-1, 1]) {
          const ry = (side < 0 ? si : si + 1) / STRAKES + side * -off;
          let dy2 = v - ry; dy2 -= Math.round(dy2);
          const stag = off > 0.03 ? 0.5 : 0;
          let rx = ru + stag; rx = rx - Math.floor(rx) - 0.5;
          const d = Math.hypot(rx / RIV_U, dy2);
          if (d < 0.0085) riv = Math.max(riv, Math.sqrt(1 - (d / 0.0085) ** 2));
          near = Math.max(near, Math.exp(-(d * d) / (0.024 * 0.024)));
        }
      }
      {
        const rv = v * RIV_B * STRAKES, rvf = rv - Math.floor(rv) - 0.5;
        const d = Math.hypot(dButt - 0.016, rvf / (RIV_B * STRAKES));
        if (d < 0.0085) riv = Math.max(riv, Math.sqrt(1 - (d / 0.0085) ** 2));
        near = Math.max(near, Math.exp(-(d * d) / (0.024 * 0.024)));
      }
      hh += 0.16 * riv;
      // fine pitting / scale
      const pit = _pwFbm(fine, u, v);
      hh += 0.016 * (pit - 0.5) - 0.028 * Math.max(0, pit - 0.72);
      // rust: patchy fbm field, pooled at the rivet heads and weeping from the seams
      const patch = 0.62 * _pwFbm(low, u + 0.37, v + 0.11) + 0.38 * _pwFbm(mid, u + 0.37, v + 0.11);
      let r = sst(0.46, 0.66, patch + 0.30 * near + 0.22 * Math.max(seamG, buttG));
      r = Math.max(r, near * 0.75 * sst(0.35, 0.6, patch + 0.2));
      h[i] = hh; rust[i] = r;
      src[i] = Math.min(1, near * 0.9 + 0.7 * Math.max(seamG, buttG) * sst(0.4, 0.6, patch));
      cav[i] = 1 - Math.max(seamG, buttG) * 0.8 - (near - riv) * 0.25;
    }
  }
  const map = new Uint8Array(N * 4), nrm = new Uint8Array(N * 4), pack = new Uint8Array(N * 4);
  // paint: dark oxide grey-green; rust: dark umber through to a dull orange bloom
  const P0 = [0.105, 0.115, 0.108], P1 = [0.165, 0.170, 0.155];
  const R0 = [0.170, 0.080, 0.040], R1 = [0.340, 0.160, 0.066];
  for (let i = 0; i < N; i++) {
    const o = i * 4, x = i % S, y = (i / S) | 0;
    const t = _pwFbm(fine, x / S * 0.5 + 0.2, y / S * 0.5);   // tonal breakup
    const r = rust[i], c = Math.max(0.35, cav[i]);
    for (let k = 0; k < 3; k++) {
      const paint = P0[k] + (P1[k] - P0[k]) * t;
      const rc = R0[k] + (R1[k] - R0[k]) * Math.min(1, r * 1.2 * (0.6 + 0.8 * t));
      const lin = (paint + (rc - paint) * r) * c;
      map[o + k] = Math.min(255, Math.max(0, Math.pow(lin, 1 / 2.2) * 255));
    }
    map[o + 3] = Math.min(255, src[i] * 255);
    pack[o] = 255;
    pack[o + 1] = Math.min(255, (0.55 + 0.42 * r + 0.08 * (1 - cav[i])) * 255);
    pack[o + 2] = Math.min(255, Math.max(0, h[i] * 255));
    pack[o + 3] = 255;
  }
  _pwNormals(h, S, S, 2.6, nrm, i => Math.min(255, Math.max(0, cav[i] * 255)));
  _ironSet = { map: _pwTex(map, S, S, true), nrm: _pwTex(nrm, S, S, false), pack: _pwTex(pack, S, S, false), size: S };
  return _ironSet;
}

// ---- THE BLADE MAP SET (flora.js kelp, gardens.js/flora.js fans and seagrass) ---------
// A 128 x 512 map in BLADE space: u across the blade (0 edge .. 0.5 midrib .. 1 edge),
// v along it (0 base .. 1 tip). The midrib is a raised ridge that thins toward the tip;
// lateral veins leave it at a shallow angle toward the tip (herringbone, like a real
// laminaria blade) and fade before the margin; between the veins the lamina is bullate
// (a soft blistered quilting). Non-tiling in v on purpose — it spans exactly one blade.
//   nrm  : tangent-space normal (x across, y along), A = 255
//   pack : R = vein/rib mask (bright where the blade is thick), G = thickness (0 at the
//          margin, 1 on the rib — the translucency term reads 1-G), B = bullate
//          blister height, A = 255
let _bladeSet = null;
export function bladeMapSet() {
  if (_bladeSet) return _bladeSet;
  const W = 128, H = 512, N = W * H;
  const rand = seededRand(0xB1ADE5E7);
  const bl = [8, 16, 32].map(n => _pwLattice(rand, n));
  const h = new Float32Array(N), vein = new Float32Array(N), thick = new Float32Array(N), blis = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W, i = y * W + x, a = Math.abs(u - 0.5) * 2;      // 0 rib .. 1 edge
      const ribW = 0.06 * (1 - 0.6 * v) + 0.015;
      const rib = Math.exp(-(a * a) / (ribW * ribW));
      // lateral veins: lines of constant (v - k*a), spacing tightening toward the tip
      const ph = (v * 15 - a * 1.6);
      const f = ph - Math.floor(ph);
      const vl = Math.exp(-((f - 0.5) * (f - 0.5)) / 0.006) * (1 - a * 0.85) * (0.45 + 0.35 * v);
      const b = _pwFbm(bl, u * 0.5 + 0.13, v * 2.0);
      const blister = (1 - a) * (0.5 + 0.5 * Math.sin(ph * Math.PI * 2 + 1.6)) * (0.6 + 0.8 * b);
      h[i] = 0.55 * rib + 0.14 * vl + 0.10 * blister;
      vein[i] = Math.min(1, rib + vl * 0.8);
      thick[i] = Math.min(1, 0.25 + 0.75 * rib + 0.2 * vl) * (1 - Math.pow(a, 6) * 0.8);
      blis[i] = blister;
    }
  }
  const nrm = new Uint8Array(N * 4), pack = new Uint8Array(N * 4);
  _pwNormals(h, W, H, 3.0, nrm, null);
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    pack[o] = vein[i] * 255; pack[o + 1] = thick[i] * 255; pack[o + 2] = Math.min(255, blis[i] * 255); pack[o + 3] = 255;
  }
  const mk = (d, srgb) => { const t = _pwTex(d, W, H, srgb); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };
  _bladeSet = { nrm: mk(nrm, false), pack: mk(pack, false) };
  return _bladeSet;
}
// ==== END BLOCK: polish-world ========================================================
