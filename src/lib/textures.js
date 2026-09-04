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

export { rng };
