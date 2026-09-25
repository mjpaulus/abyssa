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
// ---- SAL'S DRESS AND FITTINGS (polish-sal) -----------------------------------------
// Appended block, owned by the diver polish pass (entities/diver.js is the only caller).
// Everything here is generated ONCE at boot, seeded (the same dress every session), and
// handed over as mipmapped RepeatWrapping DataTextures in LINEAR space: these are
// structure maps that the diver's own shaders turn into colour, never colour themselves.
// Layout convention for every set: `pack` RGBA8 (channels documented per set) and `nrm`
// RGBA8 = tangent-space normal in rgb, height in a.
// =====================================================================================

// Tileable value noise straight into a Float32Array (no canvas round trip). Every
// lattice is modulo its own cell count, so the tile wraps exactly at any octave.
function _tileNoise(S, cells, oct, rand) {
  const out = new Float32Array(S * S);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = cells << o, g = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) g[i] = rand();
    for (let y = 0; y < S; y++) {
      const fy = y / S * n, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % n) * n, r1 = ((y0 + 1) % n) * n;
      for (let x = 0; x < S; x++) {
        const fx = x / S * n, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % n, c1 = (x0 + 1) % n;
        const a = g[r0 + c0], b = g[r0 + c1], c = g[r1 + c0], d = g[r1 + c1];
        out[y * S + x] += ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy) * amp;
      }
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < S * S; i++) out[i] /= tot;
  return out;
}

// Height field -> packed normal (rgb) + height (a). Central differences, wrapped.
function _packNormal(h, S, slope) {
  const nrm = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S, yp = ((y + 1) % S) * S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S, i = y * S + x, o = i * 4;
      let nx = (h[y * S + xm] - h[y * S + xp]) * slope, ny = (h[ym + x] - h[yp + x]) * slope, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
      nrm[o] = (nx * 0.5 + 0.5) * 255; nrm[o + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[o + 2] = (nz * 0.5 + 0.5) * 255; nrm[o + 3] = Math.max(0, Math.min(255, h[i] * 255));
    }
  }
  return nrm;
}

function _dataTex(data, S) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = MAX_ANISO;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// RUBBERISED TWILL. A 2/1 twill (the warp floats over two wefts and under one, the float
// stepping one thread per row), which is what gives drill and dress canvas their
// diagonal rib. 36 threads per tile at 8 px each; 36 is a multiple of the 3-thread
// repeat, so the diagonal wraps without a seam. Per-thread slub (thickness) and tone
// jitter keep it cloth and not a halftone screen.
//   pack.r = weave height, pack.g = low-frequency mottle (stains, salt, rubber-coat
//   thickness; sampled by the shader at a much larger scale), pack.b = thread tone
//   (warp darker than weft + fibre noise), pack.a = 255.
let _twill = null;
export function twillSet() {
  if (_twill) return _twill;
  const S = 288, N = 36, P = S / N;
  const rand = seededRand(0x5a1c0a7);
  const slubW = new Float32Array(N), slubF = new Float32Array(N), toneW = new Float32Array(N), toneF = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    slubW[i] = 0.86 + 0.26 * rand(); slubF[i] = 0.86 + 0.26 * rand();
    toneW[i] = rand(); toneF[i] = rand();
  }
  const fib = _tileNoise(S, 32, 2, rand);
  const mot = _tileNoise(S, 3, 4, rand);
  const h = new Float32Array(S * S), pack = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const j = Math.floor(y / P), fy = (y % P + 0.5) / P;
    for (let x = 0; x < S; x++) {
      const i = Math.floor(x / P), fx = (x % P + 0.5) / P;
      const k = (((i - j) % 3) + 3) % 3;
      const f = fib[y * S + x];
      let hh, tone;
      if (k < 2) {                                         // warp float, two cells long
        const t = (k === 1 ? fy : 1 + fy) / 2;
        const across = Math.pow(Math.sin(Math.PI * Math.min(1, fx * slubW[i] + (1 - slubW[i]) * 0.5)), 0.55);
        hh = across * (0.62 + 0.38 * Math.sin(Math.PI * t));
        tone = 0.30 + 0.16 * toneW[i];
      } else {                                             // weft on top for one cell
        const across = Math.pow(Math.sin(Math.PI * Math.min(1, fy * slubF[j] + (1 - slubF[j]) * 0.5)), 0.55);
        hh = across * (0.55 + 0.45 * Math.pow(Math.sin(Math.PI * fx), 0.4));
        tone = 0.62 + 0.18 * toneF[j];
      }
      hh = hh * (0.90 + 0.2 * f);
      const o = (y * S + x) * 4;
      h[y * S + x] = hh;
      pack[o] = hh * 255;
      pack[o + 1] = mot[y * S + x] * 255;
      pack[o + 2] = Math.max(0, Math.min(1, tone + (f - 0.5) * 0.3)) * 255;
      pack[o + 3] = 255;
    }
  }
  _twill = { pack: _dataTex(pack, S), nrm: _dataTex(_packNormal(h, S, 2.4), S), size: S };
  return _twill;
}

// CAST LEAD. Sand-cast weights and boot soles: a fine sand grain, gas pits (small, round,
// sharp-lipped), a few shallow pour ripples, and the white-grey oxide bloom lead grows in
// every hollow. Same API as the diver's metal sets: { map (sRGB), rough, nrm }.
//   map = albedo (sRGB), rough.g = roughness, nrm = tangent normal (a = height).
let _cast = null;
export function castSet() {
  if (_cast) return _cast;
  const S = 256, rand = seededRand(0x1eadca57);
  const grain = _tileNoise(S, 48, 2, rand), lump = _tileNoise(S, 4, 3, rand), ox = _tileNoise(S, 6, 3, rand);
  const h = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) h[i] = 0.55 + (grain[i] - 0.5) * 0.22 + (lump[i] - 0.5) * 0.35;
  const pit = new Float32Array(S * S);
  for (let k = 0; k < 150; k++) {                          // gas pits, wrapped
    const cx = rand() * S, cy = rand() * S, r = 1.2 + rand() * rand() * 5.5;
    const R = Math.ceil(r + 2);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d > 1.35) continue;
      const x = ((Math.floor(cx) + dx) % S + S) % S, y = ((Math.floor(cy) + dy) % S + S) % S, i = y * S + x;
      const dep = d < 1 ? (1 - d * d) : 0, lip = d >= 0.85 ? Math.max(0, 1 - Math.abs(d - 1.05) / 0.2) * 0.25 : 0;
      h[i] += lip * 0.12 - dep * 0.30;
      pit[i] = Math.max(pit[i], dep);
    }
  }
  const map = new Uint8Array(S * S * 4), rgh = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const v = h[i], o = i * 4;
    const hi = Math.max(0, Math.min(1, (v - 0.35) / 0.5));
    let r = 84 + 62 * hi, g = 86 + 62 * hi, b = 92 + 60 * hi;         // grey lead, lighter on the highs
    const bloom = Math.max(pit[i], Math.max(0, (0.5 - v) * 2.2)) * (0.45 + 0.55 * ox[i]);
    r += (196 - r) * bloom * 0.8; g += (194 - g) * bloom * 0.8; b += (186 - b) * bloom * 0.8;
    map[o] = r; map[o + 1] = g; map[o + 2] = b; map[o + 3] = 255;
    const ro = Math.max(0, Math.min(1, 0.62 + 0.3 * bloom - 0.22 * hi + (grain[i] - 0.5) * 0.2));
    rgh[o] = rgh[o + 1] = rgh[o + 2] = ro * 255; rgh[o + 3] = 255;
  }
  const mapT = _dataTex(map, S); mapT.colorSpace = THREE.SRGBColorSpace;
  _cast = { map: mapT, rough: _dataTex(rgh, S), nrm: _dataTex(_packNormal(h, S, 3.0), S) };
  return _cast;
}

// WATER ON GLASS. Beads left on a porthole after the helmet breaks the surface: round
// domes of every size, a few drops that ran and left a trail. Tileable, seeded.
//   nrm.rgb = tangent normal of the beads, nrm.a = bead mask/height (0 = dry glass).
let _drops = null;
export function dropletSet() {
  if (_drops) return _drops;
  const S = 256, rand = seededRand(0xd40b1e75);
  const h = new Float32Array(S * S);
  const dome = (cx, cy, r, amp) => {
    const R = Math.ceil(r + 1);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d2 = (dx * dx + dy * dy) / (r * r);
      if (d2 >= 1) continue;
      const x = ((Math.floor(cx) + dx) % S + S) % S, y = ((Math.floor(cy) + dy) % S + S) % S, i = y * S + x;
      h[i] = Math.max(h[i], amp * Math.sqrt(1 - d2));
    }
  };
  for (let k = 0; k < 420; k++) { const r = 0.8 + Math.pow(rand(), 3) * 7; dome(rand() * S, rand() * S, r, 0.35 + 0.65 * Math.min(1, r / 5)); }
  for (let k = 0; k < 9; k++) {                            // runs: a head bead and its thinning trail
    const x0 = rand() * S, y0 = rand() * S, len = 20 + rand() * 60, r0 = 2.5 + rand() * 3;
    for (let t = 0; t < len; t += 0.7) dome(x0 + Math.sin(t * 0.08) * 1.5, y0 + t, r0 * (0.35 + 0.35 * (1 - t / len)), 0.4);
    dome(x0, y0 + len, r0 * 1.2, 1);
  }
  const nrm = _packNormal(h, S, 6.0);
  for (let i = 0; i < S * S; i++) nrm[i * 4 + 3] = Math.min(255, h[i] * 400);
  _drops = { nrm: _dataTex(nrm, S) };
  return _drops;
}
