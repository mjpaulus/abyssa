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
// ---- RAFT SURFACE SETS (polish-raft) — appended block, OWNED BY: raft polish pass ----
// =====================================================================================
// Generated PBR sets for the dive tender, authored in METRES: the raft rewrites every
// piece's UVs to metric (kit.js metricUV), so a texture's `tile` (metres per repeat) is
// the whole density story and a 9-unit look and a 1-unit look sample the same pixels.
// Each set is { map (sRGB albedo, near-white structure the palette hue multiplies),
// rough (G = roughness multiplier), nrm (tangent-space, linear), tile }. All seeded, all
// built once per boot as mipmapped anisotropic DataTextures (no canvas round-trips).
// Every pattern is exactly tileable: lattices are taken modulo their period.
const _rs = {};
const _ihash = (x, y, s) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
// Periodic value noise: lattice px x py cells over the unit square, wraps exactly. A
// noise is a FACTORY: its lattice tables are hashed once up front, so a pixel costs four
// array reads per octave rather than four integer hashes (most of the boot budget).
function _table(px, py, s) {
  const t = new Float32Array(px * py);
  for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) t[y * px + x] = _ihash(x, y, s);
  return t;
}
function _samp(T, px, py, u, v) {
  const fx = u * px, fy = v * py;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  let xa = x0 % px; if (xa < 0) xa += px; let ya = y0 % py; if (ya < 0) ya += py;
  const xb = xa + 1 === px ? 0 : xa + 1, yb = ya + 1 === py ? 0 : ya + 1;
  const a = T[ya * px + xa], b = T[ya * px + xb], c = T[yb * px + xa], d = T[yb * px + xb];
  const ab = a + (b - a) * sx;
  return ab + ((c + (d - c) * sx) - ab) * sy;
}
// fbm factory: returns (u, v) -> 0..1
function pfbm(px, py, oct, s) {
  const L = [];
  let n = 0, a = 0.5;
  for (let o = 0; o < oct; o++) { L.push([_table(px << o, py << o, s + o * 131), px << o, py << o, a]); n += a; a *= 0.5; }
  const inv = 1 / n;
  if (oct === 1) { const [T, X, Y] = L[0]; return (u, v) => _samp(T, X, Y, u, v); }
  return (u, v) => { let t = 0; for (let o = 0; o < L.length; o++) { const l = L[o]; t += _samp(l[0], l[1], l[2], u, v) * l[3]; } return t * inv; };
}
const _sat = v => v < 0 ? 0 : v > 1 ? 1 : v;
const _ss = (a, b, x) => { const t = _sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Pack float fields into the three textures. `alb` is rgb (0..1 linear-ish values that are
// written straight as sRGB bytes), `rgh` a multiplier 0..1, `hgt` a height in metres; the
// normal is the height's metric gradient (px = metres per texel on each axis).
function _packSet(W, H, alb, rgh, hgt, pxU, pxV, tile, bump = 1) {
  const A = new Uint8Array(W * H * 4), R = new Uint8Array(W * H * 4), N = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const ym = ((y - 1 + H) % H) * W, yp = ((y + 1) % H) * W, yr = y * W;
    for (let x = 0; x < W; x++) {
      const i = yr + x, o = i * 4, xm = (x - 1 + W) % W, xp = (x + 1) % W;
      A[o] = _sat(alb[i * 3]) * 255; A[o + 1] = _sat(alb[i * 3 + 1]) * 255; A[o + 2] = _sat(alb[i * 3 + 2]) * 255; A[o + 3] = 255;
      const r = _sat(rgh[i]) * 255; R[o] = R[o + 1] = R[o + 2] = r; R[o + 3] = 255;
      const gx = (hgt[yr + xp] - hgt[yr + xm]) / (2 * pxU) * bump;
      const gy = (hgt[yp + x] - hgt[ym + x]) / (2 * pxV) * bump;
      const il = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      N[o] = (-gx * il * 0.5 + 0.5) * 255; N[o + 1] = (-gy * il * 0.5 + 0.5) * 255;
      N[o + 2] = (il * 0.5 + 0.5) * 255; N[o + 3] = 255;
    }
  }
  const mk = (d, srgb) => {
    const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = MAX_ANISO; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.repeat.set(1 / tile[0], 1 / tile[1]);
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(A, true), rough: mk(R, false), nrm: mk(N, false), tile };
}

// WEATHERED DECK TIMBER. 256 x 512 over 0.5 m across x 2.0 m along the grain (2 mm across,
// 4 mm along: every feature is long in v). Plain-sawn faces: growth rings are the slice of a tapering log, so
// they sweep into cathedral arches where the cut depth changes along the board; the
// arch field is folded with |sin| so it wraps exactly. Weathering erodes the soft
// earlywood and leaves the latewood standing proud — THAT is the relief that catches a
// low sun. Knots (rings wrapping a dark resinous core with radial checks), pores, and
// long seasoning checks. Albedo carries silvering and dirt in the eroded bands.
export function raftWoodSet() {
  if (_rs.wood) return _rs.wood;
  const nz0 = pfbm(4, 8, 3, 11);
  const nz1 = pfbm(8, 16, 3, 23);
  const nz2 = pfbm(16, 4, 2, 37);
  const nz3 = pfbm(128, 16, 2, 51);
  const nz4 = pfbm(64, 4, 2, 67);
  const nz5 = pfbm(2, 4, 3, 79);
  const nz6 = pfbm(8, 8, 2, 91);
  const W = 256, H = 512, TU = 0.5, TV = 2.0, n = W * H;
  const alb = new Float32Array(n * 3), rgh = new Float32Array(n), hgt = new Float32Array(n);
  const rr = seededRand(0x7EAC0DE);
  const knots = [];
  for (let k = 0; k < 5; k++) knots.push({ u: rr(), v: rr(), r: 0.010 + rr() * 0.016, a: rr() * 6.283 });
  const checks = [];
  for (let k = 0; k < 9; k++) checks.push({ u: rr(), v0: rr(), l: 0.05 + rr() * 0.22, w: 0.0008 + rr() * 0.0009 });
  for (let y = 0; y < H; y++) {
    const v = y / H;
    // cut depth below the pith wanders along the board: this is what draws the arches
    const D = 0.055 + 0.030 * Math.sin(6.2832 * v + 0.7) + 0.018 * Math.sin(12.566 * v + 2.1);
    for (let x = 0; x < W; x++) {
      const u = x / W, i = y * W + x;
      const wob = (nz0(u, v) - 0.5) * 0.010;
      const X = Math.abs(Math.sin(6.2832 * (u - 0.25))) * (TU / 6.2832) * 1.6 + wob;
      let rad = Math.sqrt(X * X + D * D) + (nz1(u, v) - 0.5) * 0.004;
      // knots: rings pulled round each knot, a dark resinous core
      let kc = 0, kr = 0;
      for (const K of knots) {
        let du = u - K.u; du -= Math.round(du); let dv = v - K.v; dv -= Math.round(dv);
        const dx = du * TU, dy = dv * TV * 0.55, d = Math.sqrt(dx * dx + dy * dy);
        const f = Math.exp(-(d * d) / (K.r * K.r * 6));
        rad = rad * (1 - f) + (d * 0.9 + 0.02) * f;
        const core = 1 - _ss(K.r * 0.55, K.r, d);
        if (core > kc) { kc = core; kr = Math.atan2(dy, dx) - K.a; }
      }
      const ring = rad * 105 + (nz2(u, v) - 0.5) * 0.5;
      const t = ring - Math.floor(ring);
      // earlywood -> latewood: gradual rise, sharp fall at the ring boundary
      const late = _ss(0.40, 0.80, t) * (1 - _ss(0.90, 1.0, t));
      // pores and fibre streaks: fine noise stretched hard along the grain
      const pore = nz3(u, v);
      const streak = nz4(u, v);
      let chk = 0;
      for (const C of checks) {
        let du = u - C.u; du -= Math.round(du); let dv = v - C.v0; dv -= Math.round(dv);
        const along = dv * TV;
        if (along < 0 || along > C.l) continue;
        const taper = Math.sin(Math.PI * along / C.l);
        const dxm = Math.abs(du * TU + Math.sin(along * 40) * 0.0006);
        chk = Math.max(chk, (1 - _ss(C.w * taper * 0.4, C.w * taper + 0.0004, dxm)) * taper);
      }
      const radial = kc > 0 ? Math.pow(Math.abs(Math.cos(kr * 3.0)), 24) * kc : 0;
      const silver = nz5(u, v);                // weathering varies across a board
      const dirt = (1 - late) * (0.55 + 0.45 * nz6(u, v));
      let L = 0.90 - late * 0.20 - (pore < 0.35 ? (0.35 - pore) * 0.55 : 0) - (streak - 0.5) * 0.10
        - dirt * 0.10 - chk * 0.55 - kc * 0.42 - radial * 0.25;
      const g = _ss(0.35, 0.75, silver) * 0.55;               // silvering pulls toward grey
      alb[i * 3] = L * (1.0 - g * 0.08); alb[i * 3 + 1] = L * (0.935 + g * 0.03); alb[i * 3 + 2] = L * (0.84 + g * 0.12);
      rgh[i] = 0.97 - late * 0.20 + chk * 0.03 - kc * 0.22 + (1 - pore) * 0.0;
      hgt[i] = late * 0.00055 + (streak - 0.5) * 0.00012 - (pore < 0.3 ? (0.3 - pore) * 0.0008 : 0)
        - chk * 0.0016 + kc * 0.0003 - radial * 0.0004;
    }
  }
  _rs.wood = _packSet(W, H, alb, rgh, hgt, TU / W, TV / H, [TU, TV], 1.0);
  return _rs.wood;
}

// CAST AND WROUGHT IRON. 512^2 over 0.45 m. Cast skin mottle, pitting (a crater with a
// raised lip, rust-filled at the bottom), blooms of oxide that are rough and non-metal
// looking even before the vertex state pushes them further, and a few bright scratches
// where something hard dragged across. Albedo is mid-grey so the orange of the blooms
// survives the palette multiply.
export function raftIronSet() {
  if (_rs.iron) return _rs.iron;
  const nz0 = pfbm(6, 6, 4, 3);
  const nz1 = pfbm(5, 5, 5, 17);
  const nz2 = pfbm(64, 64, 2, 29);
  const S = 512, T = 0.45, n = S * S;
  const alb = new Float32Array(n * 3), rgh = new Float32Array(n), hgt = new Float32Array(n);
  const rr = seededRand(0x1A0B17);
  // pit field: stamp craters on a grid of candidate cells (O(n), not O(n*pits))
  const pit = new Float32Array(n), lip = new Float32Array(n);
  for (let k = 0; k < 1400; k++) {
    const cx = rr() * S, cy = rr() * S, r = 1.2 + rr() * rr() * 5.5, dep = 0.4 + rr() * 0.6;
    const R = Math.ceil(r * 1.7);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx + (cx % 1), dy + (cy % 1)) / r;
      if (d > 1.7) continue;
      const xx = ((Math.floor(cx) + dx) % S + S) % S, yy = ((Math.floor(cy) + dy) % S + S) % S, j = yy * S + xx;
      if (d < 1) pit[j] = Math.max(pit[j], (1 - d * d) * dep);
      else lip[j] = Math.max(lip[j], (1 - Math.abs(d - 1.25) / 0.45) * dep * 0.35);
    }
  }
  const scr = new Float32Array(n);
  for (let k = 0; k < 90; k++) {
    let x = rr() * S, y = rr() * S; const a = rr() * 6.283, l = 20 + rr() * 110, c = Math.cos(a), s = Math.sin(a);
    const w = 0.3 + rr() * 0.6;
    for (let t = 0; t < l; t++) {
      const j = ((Math.floor(y) % S + S) % S) * S + ((Math.floor(x) % S + S) % S);
      scr[j] = Math.max(scr[j], w * Math.sin(Math.PI * t / l));
      x += c; y += s;
    }
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const mot = nz0(u, v);
    const bloomN = nz1(u, v);
    const bloom = _ss(0.54, 0.70, bloomN + (pit[i] > 0 ? 0.06 : 0));
    const fine = nz2(u, v);
    let L = 0.52 + (mot - 0.5) * 0.16 + (fine - 0.5) * 0.06 - pit[i] * 0.14 + lip[i] * 0.05 + scr[i] * 0.22;
    // rust: warm, lighter than the iron, darker where it has scaled deep
    const rc = bloom * (0.85 + 0.3 * fine);
    const pr = pit[i] * 0.7;
    const kR = Math.max(rc, pr);
    alb[i * 3] = L + (0.66 - L) * kR; alb[i * 3 + 1] = L + (0.36 - L) * kR; alb[i * 3 + 2] = L + (0.20 - L) * kR;
    rgh[i] = 0.62 + (mot - 0.5) * 0.25 + kR * 0.38 - scr[i] * 0.35 + (fine - 0.5) * 0.10;
    hgt[i] = -pit[i] * 0.00040 + lip[i] * 0.00018 + bloom * (fine - 0.3) * 0.00022 + (mot - 0.5) * 0.00025 - scr[i] * 0.00005;
  }
  _rs.iron = _packSet(S, S, alb, rgh, hgt, T / S, T / S, [T, T], 1.0);
  return _rs.iron;
}

// BRASS. 512^2 over 0.30 m. Patinated brass is two surfaces fighting: a warm brown-green
// tarnish that lives in every low spot, and bright metal wherever something rubs. The
// texture carries the micro version (tarnish pooling in scratches and pores, dull
// fingerprint whorls on the polish); the handled/crevice split is baked per vertex.
export function raftBrassSet() {
  if (_rs.brass) return _rs.brass;
  const nz0 = pfbm(4, 4, 5, 7);
  const nz1 = pfbm(96, 3, 2, 13);
  const nz2 = pfbm(24, 24, 2, 19);
  const S = 512, T = 0.30, n = S * S;
  const alb = new Float32Array(n * 3), rgh = new Float32Array(n), hgt = new Float32Array(n);
  const rr = seededRand(0xB2A55);
  const fp = new Float32Array(n);
  for (let k = 0; k < 26; k++) {                        // fingerprints: concentric whorls
    const cx = rr() * S, cy = rr() * S, rx = 9 + rr() * 8, ry = rx * (1.2 + rr() * 0.4), a = rr() * 3.14;
    const ca = Math.cos(a), sa = Math.sin(a), R = Math.ceil(ry * 1.2);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const qx = (dx * ca + dy * sa) / rx, qy = (-dx * sa + dy * ca) / ry, d = Math.sqrt(qx * qx + qy * qy);
      if (d > 1) continue;
      const j = (((Math.floor(cy) + dy) % S + S) % S) * S + (((Math.floor(cx) + dx) % S + S) % S);
      fp[j] = Math.max(fp[j], (0.5 + 0.5 * Math.sin(d * 34)) * (1 - d * d));
    }
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const tn = nz0(u, v);
    const tar = _ss(0.30, 0.64, tn);                       // tarnish patches
    const brush = nz1(u, v);                // polishing hairlines
    const spot = nz2(u, v);
    const pitD = spot < 0.22 ? (0.22 - spot) * 4 : 0;
    const k = _sat(tar * 0.8 + pitD * 0.7);
    let L = 0.92 + (brush - 0.5) * 0.10;
    alb[i * 3] = L * (1 - k * 0.66); alb[i * 3 + 1] = L * (1 - k * 0.58); alb[i * 3 + 2] = L * (1 - k * 0.42);
    rgh[i] = 0.55 + k * 0.45 + fp[i] * 0.35 + (brush - 0.5) * 0.15;
    hgt[i] = (brush - 0.5) * 0.00008 - pitD * 0.0002 + fp[i] * 0.00002;
  }
  _rs.brass = _packSet(S, S, alb, rgh, hgt, T / S, T / S, [T, T], 1.0);
  return _rs.brass;
}

// ENGINE ENAMEL over iron. 512^2 over 0.55 m. The albedo carries the colour (the
// material is white): sun-faded engine green, chipped through a red-oxide primer ring to
// dark iron, with a raised paint lip round every chip. `coat` is a separate mask
// (clearcoatMap) that takes the clear-coat off the chips and thins it on the primer.
export function raftPaintSet() {
  if (_rs.paint) return _rs.paint;
  const nz0 = pfbm(14, 14, 4, 5);
  const nz1 = pfbm(3, 24, 2, 9);
  const nz2 = pfbm(2, 2, 3, 15);
  const nz3 = pfbm(48, 48, 2, 21);
  const S = 512, T = 0.55, n = S * S;
  const alb = new Float32Array(n * 3), rgh = new Float32Array(n), hgt = new Float32Array(n);
  const coat = new Uint8Array(n * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const cn = nz0(u, v);
    const chip = _ss(0.695, 0.705, cn);                  // bare where the flake came off
    const primer = _ss(0.672, 0.688, cn) - chip;         // red-oxide primer ring round each chip
    const drip = nz1(u, v);                 // brush drag in the enamel
    const fade = nz2(u, v);
    const pr = _sat(primer);
    const iron = 0.22 + (nz3(u, v) - 0.5) * 0.10;
    const pa = [0.12 + fade * 0.05, 0.18 + fade * 0.05, 0.10 + fade * 0.03];   // engine green, sun-faded
    const pm = [0.46, 0.20, 0.13];
    for (let c = 0; c < 3; c++) {
      let a = pa[c] * (0.94 + (drip - 0.5) * 0.12);
      a = a * (1 - pr) + pm[c] * pr;
      alb[i * 3 + c] = a * (1 - chip) + iron * (c === 0 ? 1.08 : 1) * chip;
    }
    rgh[i] = 0.42 + (drip - 0.5) * 0.12 + fade * 0.10 + pr * 0.35 + chip * 0.45;
    hgt[i] = (1 - chip) * 0.00018 + pr * 0.00006 + (drip - 0.5) * 0.00004;
    const cc = (1 - chip) * (1 - pr * 0.8) * (0.75 + fade * 0.25) * 255;
    coat[i * 4] = coat[i * 4 + 1] = coat[i * 4 + 2] = cc; coat[i * 4 + 3] = 255;
  }
  const set = _packSet(S, S, alb, rgh, hgt, T / S, T / S, [T, T], 1.0);
  const t = new THREE.DataTexture(coat, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = MAX_ANISO;
  t.repeat.set(1 / T, 1 / T); t.needsUpdate = true;
  set.coat = t;
  _rs.paint = set;
  return set;
}

// LAID ROPE. 128 x 128, mapped (along / (2 pi r), around) by the kit's 'strand' mode:
// one tile is one full lay, three strands around, each strand's fibres twisted the
// other way. Exactly periodic both ways, so it wraps any rope at any radius.
export function raftRopeSet() {
  if (_rs.rope) return _rs.rope;
  const nz0 = pfbm(16, 16, 2, 3);
  const S = 128, n = S * S;
  const alb = new Float32Array(n * 3), rgh = new Float32Array(n), hgt = new Float32Array(n);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const s = 3 * (v + u), f = s - Math.floor(s);
    const prof = Math.pow(Math.sin(Math.PI * f), 0.55);
    const fib = 0.5 + 0.5 * Math.sin(6.2832 * (8 * (v - u * 1.0) + f * 2.0));
    const fz = nz0(u, v);
    const h = prof * 0.75 + fib * 0.12 * prof + (fz - 0.5) * 0.10;
    const L = 0.55 + prof * 0.40 + (fib - 0.5) * 0.10 + (fz - 0.5) * 0.12;
    alb[i * 3] = L; alb[i * 3 + 1] = L * 0.96; alb[i * 3 + 2] = L * 0.88;
    rgh[i] = 1.0 - prof * 0.08;
    hgt[i] = h;
  }
  // height is in "strand units": the kit maps one tile around to one circumference, so
  // the bump is scaled for a ~0.03 radius rope (the common case) and reads right to 2x.
  _rs.rope = _packSet(S, S, alb, rgh, hgt, 1 / S, 1 / S, [1, 1], 0.14);
  return _rs.rope;
}

// DUCK CANVAS. 256^2 over 0.064 m: 32 x 32 threads of a plain weave (2 mm pitch), each
// crossing a rounded over/under, thread-to-thread slub, and the grime that settles in
// the weave's valleys.
export function raftCanvasSet() {
  if (_rs.canvas) return _rs.canvas;
  const nz0 = pfbm(4, 4, 3, 5);
  const S = 256, T = 0.064, N = 32, n = S * S;
  const alb = new Float32Array(n * 3), rgh = new Float32Array(n), hgt = new Float32Array(n);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const cu = u * N, cv = v * N, iu = Math.floor(cu), iv = Math.floor(cv), fu = cu - iu, fv = cv - iv;
    const warpUp = ((iu + iv) & 1) === 0;
    const wp = Math.sin(Math.PI * fu), wf = Math.sin(Math.PI * fv);
    const slubU = 0.85 + 0.3 * _ihash(iu, 0, 7), slubV = 0.85 + 0.3 * _ihash(0, iv, 9);
    const hw = wp * (warpUp ? 1 : 0.55) * Math.sin(Math.PI * (0.15 + fv * 0.7)) * slubU;
    const hf = wf * (warpUp ? 0.55 : 1) * Math.sin(Math.PI * (0.15 + fu * 0.7)) * slubV;
    const h = Math.max(hw, hf);
    const g = nz0(u, v);
    const L = 0.70 + h * 0.30 - (1 - h) * g * 0.18;
    alb[i * 3] = L; alb[i * 3 + 1] = L * 0.97; alb[i * 3 + 2] = L * 0.90;
    rgh[i] = 1.0 - h * 0.06;
    hgt[i] = h * 0.00035;
  }
  _rs.canvas = _packSet(S, S, alb, rgh, hgt, T / S, T / S, [T, T], 1.0);
  return _rs.canvas;
}

// OILED LEATHER. 256^2 over 0.30 m: pebble grain (cells), and creases — ridged noise
// folded into thin dark valleys running mostly across the belt, where it flexes.
export function raftLeatherSet() {
  if (_rs.leather) return _rs.leather;
  const nz0 = pfbm(3, 12, 3, 3);
  const nz1 = pfbm(48, 48, 2, 7);
  const nz2 = pfbm(4, 4, 3, 11);
  const S = 256, T = 0.30, n = S * S;
  const alb = new Float32Array(n * 3), rgh = new Float32Array(n), hgt = new Float32Array(n);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const cr = 1 - Math.abs(nz0(u, v) * 2 - 1);
    const crease = Math.pow(cr, 14);
    const peb = nz1(u, v);
    const sheen = nz2(u, v);
    const L = 0.80 - crease * 0.35 + (peb - 0.5) * 0.12 + (sheen - 0.5) * 0.10;
    alb[i * 3] = L; alb[i * 3 + 1] = L * 0.95; alb[i * 3 + 2] = L * 0.90;
    rgh[i] = 0.62 + crease * 0.30 + (peb - 0.5) * 0.10 - sheen * 0.15;
    hgt[i] = -crease * 0.0005 + (peb - 0.5) * 0.00012;
  }
  _rs.leather = _packSet(S, S, alb, rgh, hgt, T / S, T / S, [T, T], 1.0);
  return _rs.leather;
}
// DEV bench: regenerate every raft set cold (cache bypassed, results discarded) and
// time each. Used to hold the boot budget; the game never calls it.
export function raftSetsBench() {
  const keep = Object.assign({}, _rs), t = {};
  for (const k in _rs) delete _rs[k];
  const fns = { wood: raftWoodSet, iron: raftIronSet, brass: raftBrassSet, paint: raftPaintSet,
    rope: raftRopeSet, canvas: raftCanvasSet, leather: raftLeatherSet };
  let tot = 0;
  for (const k in fns) {
    const t0 = performance.now(); const S = fns[k](); t[k] = +(performance.now() - t0).toFixed(1); tot += t[k];
    for (const x of ['map', 'rough', 'nrm', 'coat']) if (S[x]) S[x].dispose();
  }
  for (const k in _rs) delete _rs[k];
  Object.assign(_rs, keep);
  t.total = +tot.toFixed(1);
  return t;
}
// ---- end RAFT SURFACE SETS ----------------------------------------------------------
