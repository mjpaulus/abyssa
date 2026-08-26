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

export { rng };
