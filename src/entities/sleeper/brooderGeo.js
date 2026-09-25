// THE BROODER — geometry and baked maps (roadmap/three-sleepers.md, spec §2 zone 0).
// Pure: unit scale (carapace half-width R = 1), +Z is the front, +Y up, seeded, no
// scene access. brooder.js scales the body group by R and poses the parts.
//
// The shell is a crab carapace read as armour: a dome over a lobed footprint (flat
// frontal margin, the eye orbits, a "pie-crust" of scallops down the front flanks),
// the anatomical swellings every crab has (gastric, branchial, cardiac) cut by the
// cervical groove, and over that a mirrored Voronoi of 26 scutes with chamfered seams
// and growth lines. The same function feeds the mesh, the baked maps, the barnacle
// scatter and the ward/collision placement, so they can never disagree.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas2d, toTexture, normalFromHeight, noiseCanvas, seededRand, maxAniso } from '../../lib/textures.js';

const TAU = Math.PI * 2;
// JS smoothstep; reversed edges are fine HERE (the GLSL UB rule is about the driver).
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x / w) * (x / w));

// ---- seeded value noise ------------------------------------------------------------
function lattice(n, rnd) { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); return { n, g }; }
function vsmp(L, x, y) {
  const n = L.n, g = L.g;
  x = (x % 1 + 1) % 1 * n; y = (y % 1 + 1) % 1 * n;
  const xi = Math.floor(x), yi = Math.floor(y), x1 = (xi + 1) % n, y1 = (yi + 1) % n;
  let tx = x - xi, ty = y - yi;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = g[yi * n + xi], b = g[yi * n + x1], c = g[y1 * n + xi], d = g[y1 * n + x1];
  return a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * ty;
}
const OCT = (() => { const r = seededRand(0xC4A8A9E5); return [4, 8, 16, 32, 64, 128].map(n => lattice(n, r)); })();
function fbm(x, y, o0 = 0, o1 = 4) {
  let v = 0, a = 0.5, t = 0;
  for (let o = o0; o < o1; o++) { v += vsmp(OCT[o], x, y) * a; t += a; a *= 0.5; }
  return v / t;
}

// ---- footprint ---------------------------------------------------------------------
export function rimR(th) {
  // A shield, not a pie (Michael 2026-09-24: "crab like, menacing" — the round
  // scalloped dome read as a literal, friendly crab). Widest across the front
  // shoulders, tapering hard to the rear, a straight brow across the face, and a
  // fine jagged serration all round instead of scallops. The big spikes are thorn
  // instances (thornMatrices), not footprint wiggles.
  const c = Math.cos(th), s = Math.sin(th);
  let r = 1 / Math.sqrt(c * c + (s / 0.96) * (s / 0.96));   // wider than long: chunky, not a millipede
  if (s < 0) r *= 1 - 0.34 * Math.pow(-s, 1.3);                   // tapers to the rear
  if (s > 0) r *= 1 + 0.06 * Math.pow(s, 0.8) * (1 - s * s) * 4;   // heavy front shoulders
  // the prow: a V over the face (Michael's reference, 2026-09-24), not a flat brow
  if (s > 0) r = Math.min(r, 1.06 / Math.max(1e-3, s + 0.55 * Math.abs(c)));
  r *= 1 + 0.018 * Math.pow(Math.abs(Math.sin(th * 23)), 6);       // jagged margin
  return r;
}

// 26 scutes: four on the keel, eleven mirrored pairs down the flanks.
const PLATES = (() => {
  const rnd = seededRand(0xB700D5E7), pts = [];
  for (const z of [0.52, 0.18, -0.16, -0.48]) pts.push([0, z + (rnd() - 0.5) * 0.06]);
  const flank = [[0.34, 0.56], [0.38, 0.26], [0.36, -0.06], [0.34, -0.36], [0.66, 0.40], [0.70, 0.10],
    [0.66, -0.20], [0.56, -0.50], [0.90, 0.22], [0.90, -0.06], [0.80, -0.34]];
  for (const [x, z] of flank) {
    const jx = (rnd() - 0.5) * 0.08, jz = (rnd() - 0.5) * 0.08;
    pts.push([x + jx, z + jz], [-(x + jx), z + jz]);
  }
  return pts;
})();

export function shellAt(x, z, out) {
  const rr = rimR(Math.atan2(z, x)), rho = Math.min(1, Math.hypot(x, z) / rr);
  let f1 = 9, f2 = 9, id = 0;
  for (let i = 0; i < PLATES.length; i++) {
    const dx = x - PLATES[i][0], dz = z - PLATES[i][1], d = dx * dx + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; id = i; } else if (d < f2) f2 = d;
  }
  f1 = Math.sqrt(f1); f2 = Math.sqrt(f2);
  const d = f2 - f1, inner = 1 - sst(0.86, 0.985, rho);           // scutes fade into the margin
  // hunched: the mass rides forward over the face, the back falls away
  // a low angular slab (the reference reads as a rock wedge), not a dome
  let h = 0.36 * Math.pow(Math.max(0, 1 - Math.pow(rho, 2.8)), 0.42) * (0.82 + 0.26 * sst(-0.7, 0.35, z));
  h += 0.045 * Math.exp(-(x * x + (z - 0.34) * (z - 0.34)) / 0.07);                        // gastric
  h += 0.035 * (Math.exp(-((x - 0.46) * (x - 0.46) + (z + 0.04) * (z + 0.04)) / 0.09)
              + Math.exp(-((x + 0.46) * (x + 0.46) + (z + 0.04) * (z + 0.04)) / 0.09));   // branchial
  h += 0.030 * Math.exp(-(x * x + (z + 0.30) * (z + 0.30)) / 0.03);                        // cardiac
  h -= 0.020 * gauss(z - (0.08 + 0.35 * x * x), 0.03) * inner;                              // cervical groove
  h += 0.045 * gauss(x, 0.05) * (1 - rho * rho);                                             // keel ridge
  h += 0.050 * gauss(Math.abs(x) - (0.95 - z) * 0.55, 0.035) * sst(-0.2, 0.5, z) * (1 - sst(0.9, 1.0, rho));   // prow ridges
  h -= 0.012 * (1 - sst(0.0, 0.035, d)) * inner;                                             // scute seams
  h += 0.010 * sst(0.02, 0.16, d) * inner;                                                   // scute crowns
  out.h = h; out.rho = rho; out.d = d; out.id = id; out.f1 = f1;
  return out;
}

const _s1 = {}, _s2 = {};
export function shellNormal(x, z, out) {
  const e = 0.004;
  const hx = (shellAt(x + e, z, _s1).h - shellAt(x - e, z, _s2).h) / (2 * e);
  const hz = (shellAt(x, z + e, _s1).h - shellAt(x, z - e, _s2).h) / (2 * e);
  return out.set(-hx, 1, -hz).normalize();
}

function withColor(g, r, gg, b) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function build(pos, uv, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The eight eyes: [x, y, z, radius] for the +X side (mirrored), in the pinpoint cluster
// under the prow. Shared by the face plate's sockets and brooder.js's eye instances.
export const EYES = [[0.045, -0.165, 0.905, 0.016], [0.095, -0.158, 0.885, 0.014], [0.140, -0.150, 0.860, 0.012], [0.06, -0.195, 0.895, 0.011]];

// ---- carapace ----------------------------------------------------------------------
// Polar grid: ROWS from the crown to the rim, then RIM rows curling under to the lip at
// rho 0.80. The wrap column duplicates column 0; its normals are averaged after the
// solve so the +X flank has no seam. Planar UVs (x,z)*0.5+0.5 carry the baked maps.
export function carapaceGeo(COLS = 256, ROWS = 88, RIM = 14) {
  const sh = {}, pos = [], uv = [], col = [], idx = [];
  const NR = ROWS + RIM;
  for (let i = 0; i <= NR; i++) for (let j = 0; j <= COLS; j++) {
    const th = (j % COLS) / COLS * TAU, rr = rimR(th), c = Math.cos(th), s = Math.sin(th);
    let x, y, z, shade = 1;
    if (i <= ROWS) {
      const rho = 0.004 + 0.996 * Math.pow(i / ROWS, 0.85);
      x = c * rr * rho; z = s * rr * rho; y = shellAt(x, z, sh).h;
    } else {
      const k = (i - ROWS) / RIM;
      // across the front the margin hangs as a visor that shadows the eyes
      const front = Math.pow(Math.max(0, s), 4);
      const rho = 1 + 0.018 * Math.sin(k * Math.PI) - (0.20 - 0.12 * front) * sst(0.25, 1, k);
      const yE = shellAt(c * rr * 0.9999, s * rr * 0.9999, sh).h;
      x = c * rr * rho; z = s * rr * rho;
      // (polish-brooder) the visor stops ABOVE the eye cluster: it shades the face, it
      // no longer curtains it — the eyes sit in their sockets in the face plate below
      y = yE * (1 - k) - (0.085 + 0.05 * front) * Math.sin(k * Math.PI / 2);
      shade = 1 - 0.72 * k;                                        // the lip's underside is in its own shade
    }
    pos.push(x, y, z); uv.push(x * 0.5 + 0.5, z * 0.5 + 0.5); col.push(shade, shade, shade);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);                        // faces up/out
  }
  // THE FACE (polish-brooder): a dark brow plate under the prow that carries the eyes in
  // real sockets — each a cup carved round its dome, lipped with a raised rim — and curls
  // back under itself above the mouthparts. Same UV/colour contract as the shell.
  {
    const NX = 56, NY = 26, base = pos.length / 3;
    for (let iy = 0; iy <= NY; iy++) for (let ix = 0; ix <= NX; ix++) {
      const x = -0.27 + 0.54 * ix / NX, y = -0.075 - 0.15 * iy / NY;
      let z = 0.905 - 1.9 * x * x - 0.004 - 2.2 * Math.max(0, -0.20 - y);
      let c = 0.42 + 0.1 * fbm(x * 4 + 0.5, y * 4 + 0.5, 1, 4);
      for (const [ex, ey, ez, er] of EYES) for (const sd of [-1, 1]) {
        const d = Math.hypot(x - ex * sd, y - ey), R0 = er * 1.55;
        if (d < R0) { const q = 1 - (d / R0) * (d / R0); z -= er * 0.95 * q; c *= 1 - 0.75 * q; }
        const rim = gauss((d - er * 1.7) / (er * 0.35), 1);
        z += er * 0.30 * rim; c += 0.25 * rim;
      }
      z = Math.min(z, 0.905 - 1.9 * x * x + 0.02);
      pos.push(x, y, z); uv.push(x * 0.5 + 0.5, 0.93 + y * 0.35);   // a vertical plate: map it by height, not depth
      const edge = sst(0.20, 0.27, Math.abs(x));
      c *= 1 - 0.6 * edge;
      col.push(c, c * 0.97, c * 0.94);
    }
    for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) {
      const a = base + iy * (NX + 1) + ix, b = a + NX + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = build(pos, uv, col, idx);
  const n = g.attributes.normal;
  for (let i = 0; i <= NR; i++) {
    const a = i * (COLS + 1), b = a + COLS;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

// ---- bake helpers (polish-brooder, 2026-09-25) -----------------------------------------
// Every map below is baked straight into typed arrays and handed over as a mipmapped
// DataTexture: no canvas round trip, and the height stays FLOAT until the normal is taken
// (an 8-bit height canvas bands every shallow slope into terraces). Detail noise comes
// from small tileable fbm TABLES sampled bilinearly, so a 1M-texel bake costs lookups,
// not lattice evaluations.
function ntable(N, o0, o1, ox, oy) {
  const T = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) T[y * N + x] = fbm(x / N + ox, y / N + oy, o0, o1);
  // stretch to ~[0,1]: fbm crowds the middle and every threshold below wants the range
  let lo = 1, hi = 0;
  for (let i = 0; i < T.length; i++) { if (T[i] < lo) lo = T[i]; if (T[i] > hi) hi = T[i]; }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < T.length; i++) T[i] = (T[i] - lo) * k;
  return { N, T };
}
function nt(tb, u, v) {
  const N = tb.N, T = tb.T;
  let x = u * N, y = v * N;
  x -= Math.floor(x / N) * N; y -= Math.floor(y / N) * N;
  const xi = x | 0, yi = y | 0, tx = x - xi, ty = y - yi, x1 = (xi + 1) % N, y1 = (yi + 1) % N;
  const a = T[yi * N + xi], b = T[yi * N + x1], c = T[y1 * N + xi], d = T[y1 * N + x1];
  return a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * ty;
}
let _NT = null;
function NT() {
  if (!_NT) _NT = { A: ntable(128, 0, 5, 0.0, 0.0), B: ntable(128, 1, 6, 0.37, 0.61), C: ntable(128, 2, 6, 0.73, 0.19) };
  return _NT;
}
function dataTex(data, W, H, srgb) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso();
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
// Tangent-space normal from a float height field (heights in the SAME units as the texel
// spacing du/dv, so k = 1 is physically true relief). Row y is v (DataTexture: no flip).
function normalsInto(out, Hf, W, H, du, dv, k, wrap) {
  for (let y = 0; y < H; y++) {
    const ym = wrap ? (y + H - 1) % H : Math.max(0, y - 1), yp = wrap ? (y + 1) % H : Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xm = wrap ? (x + W - 1) % W : Math.max(0, x - 1), xp = wrap ? (x + 1) % W : Math.min(W - 1, x + 1);
      const nx = -(Hf[y * W + xp] - Hf[y * W + xm]) / ((xp - xm) * du) * k;
      const ny = -(Hf[yp * W + x] - Hf[ym * W + x]) / ((yp - ym) * dv) * k;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + 1), i = (y * W + x) * 4;
      out[i] = (nx * l * 0.5 + 0.5) * 255; out[i + 1] = (ny * l * 0.5 + 0.5) * 255; out[i + 2] = (l * 0.5 + 0.5) * 255; out[i + 3] = 255;
    }
  }
}
// Separable box blur (running sums), used for the cavity mask: blur(h) - h is positive in
// every groove, seam and pit, which is where moss, silt and rust pool.
function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s / n;
      s += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / n;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}
const hash1 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// The scute Voronoi with the third distance too (f3 - f1 small = a corner where three
// scutes meet: that is where the chips come out).
function scuteField(x, z, out) {
  let f1 = 9, f2 = 9, f3 = 9, id = 0;
  for (let i = 0; i < PLATES.length; i++) {
    const dx = x - PLATES[i][0], dz = z - PLATES[i][1], d = dx * dx + dz * dz;
    if (d < f1) { f3 = f2; f2 = f1; f1 = d; id = i; } else if (d < f2) { f3 = f2; f2 = d; } else if (d < f3) f3 = d;
  }
  f1 = Math.sqrt(f1); out.d = Math.sqrt(f2) - f1; out.c = Math.sqrt(f3) - f1; out.id = id;
  return out;
}

// Baked over the planar UV (u = x/2 + 1/2, v = z/2 + 1/2). After Michael's reference and
// the AAA audit (2026-09-25: "lots of things just look like primitives"): every scute is a
// bevelled plate with a V seam of real depth, growth lines running parallel to its margin,
// ragged chips bitten out of its edges (most at the corners, exposing a paler under-layer),
// encrusting lichen that stands proud, sponge bores with raised bleached rims; rust pools
// in the seams and streaks DOWNHILL from them; moss sits only in the low spots (a cavity
// mask from the height); the crowns are wet and glossy, the crust matte.
let _maps = null;
export function carapaceMaps(S = 1024) {
  if (_maps) return _maps;
  const t0 = performance.now();
  const { A: TA, B: TB, C: TC } = NT();
  // 1) analytic fields at F (shape, seams, corners, scute id), sampled bilinearly below
  const F = 320, FH = new Float32Array(F * F), FD = new Float32Array(F * F), FC = new Float32Array(F * F), FR = new Float32Array(F * F), FI = new Uint8Array(F * F);
  const sh = {}, sf = {};
  for (let fy = 0; fy < F; fy++) for (let fx = 0; fx < F; fx++) {
    const x = 2 * fx / (F - 1) - 1, z = 2 * fy / (F - 1) - 1, i = fy * F + fx;
    shellAt(x, z, sh); scuteField(x, z, sf);
    FH[i] = sh.h; FD[i] = sf.d; FC[i] = sf.c; FR[i] = sh.rho; FI[i] = sf.id;
  }
  const bil = (A, x, z) => {
    let fx = (x * 0.5 + 0.5) * (F - 1), fz = (z * 0.5 + 0.5) * (F - 1);
    fx = Math.min(F - 1.001, Math.max(0, fx)); fz = Math.min(F - 1.001, Math.max(0, fz));
    const xi = fx | 0, zi = fz | 0, tx = fx - xi, tz = fz - zi, i = zi * F + xi;
    const a = A[i], b = A[i + 1], c = A[i + F], d = A[i + F + 1];
    return a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * tz;
  };
  const near = (A, x, z) => A[Math.round((z * 0.5 + 0.5) * (F - 1)) * F + Math.round((x * 0.5 + 0.5) * (F - 1))];
  // rust RUN field: for each field texel, the strongest seam up-slope (toward the crown),
  // so the streaks below can be one bilinear lookup per texel
  const FRUN = new Float32Array(F * F);
  for (let fy = 0; fy < F; fy++) for (let fx = 0; fx < F; fx++) {
    const x = 2 * fx / (F - 1) - 1, z = 2 * fy / (F - 1) - 1;
    let run = 0;
    for (let k = 1; k <= 4; k++) {
      const f = 1 - k * 0.028, dk = bil(FD, x * f, z * f);
      run = Math.max(run, (1 - sst(0.0, 0.018, dk)) * (1 - 0.2 * k));
    }
    FRUN[fy * F + fx] = run;
  }
  // scute personalities: each plate its own grey-olive, some greener, some warmer
  const TINT = PLATES.map((_, k) => { const a = hash1(k + 3.1), b = hash1(k + 9.7); return [0.90 + 0.2 * a, 0.92 + 0.16 * b, 0.86 + 0.18 * (1 - a)]; });
  const holes = (() => { const r = seededRand(0x40E5); const p = []; for (let k = 0; k < 60; k++) p.push([r() * 2 - 1, r() * 2 - 1, 0.009 + 0.022 * r() * r()]); return p; })();

  // 2) the detail height and the masks, per texel
  const N = S * S, Hd = new Float32Array(N), M = new Float32Array(N * 9);   // masks: d, rho, chip, lich, crown, id, n1, n2, n3
  const du = 2 / S;
  for (let py = 0; py < S; py++) {
    const v = (py + 0.5) / S, z = 2 * v - 1;
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S, x = 2 * u - 1, i = py * S + px;
      const d = bil(FD, x, z), c3 = bil(FC, x, z), rho = bil(FR, x, z);
      const n1 = nt(TA, u * 3, v * 3), n2 = nt(TB, u * 9, v * 9), n3 = nt(TC, u * 26, v * 26), n4 = nt(TA, u * 70 + 0.31, v * 70 + 0.77);
      const inner = 1 - sst(0.86, 0.985, rho);
      const seamW = 0.007 + 0.006 * n2;
      const bevel = sst(0.0, seamW + 0.016, d), crown = sst(0.02, 0.20, d);
      // chips: ragged shelves bitten from the scute margins, most where three scutes meet
      const zone = sst(0.52, 0.70, n2 * 0.8 + 0.45 * (1 - sst(0.0, 0.09, c3)));
      const reach = (0.018 + 0.05 * zone) * (0.55 + 0.9 * n3);
      const chip = zone > 0.02 ? (1 - sst(reach - 0.003, reach + 0.002, d)) * sst(0.05, 0.3, zone) * sst(0.0, seamW, d + 0.004) : 0;
      const lich = sst(0.58, 0.72, nt(TB, u * 7 + 0.4, v * 7 + 0.1)) * sst(0.35, 0.75, n3) * inner;
      const growth = Math.sin(d * 240 + n2 * 1.5) * sst(0.012, 0.03, d) * (1 - sst(0.05, 0.10, d)) * (1 - chip);
      let ht = 0.020 * crown + 0.016 * bevel
        - 0.024 * (1 - sst(0.0, seamW, d))                  // the V seam
        - 0.012 * chip * (0.8 + 0.4 * n3)                   // the chipped shelf
        + 0.0016 * growth                                   // growth lines along the margin
        + lich * (0.005 + 0.003 * n3)                        // lichen crust, standing proud
        - 0.003 * sst(0.66, 0.74, n4) * (1 - lich)          // pitting
        + 0.010 * (n1 - 0.5);                               // broad undulation
      ht *= 0.35 + 0.65 * inner;
      Hd[i] = ht;
      const o = i * 9;
      M[o] = d; M[o + 1] = rho; M[o + 2] = chip; M[o + 3] = lich; M[o + 4] = crown; M[o + 5] = near(FI, x, z);
      M[o + 6] = n1; M[o + 7] = n2; M[o + 8] = n3;
    }
  }
  // sponge bores, stamped (each only over its own footprint): a deep dark hole with a
  // raised, bleached rim
  const HOLE = new Float32Array(N), HRIM = new Float32Array(N);
  for (const [hx, hz, hr] of holes) {
    const cx = (hx * 0.5 + 0.5) * S, cz = (hz * 0.5 + 0.5) * S, rp = hr * 2.2 / du;
    for (let py = Math.max(0, Math.floor(cz - rp)); py < Math.min(S, Math.ceil(cz + rp)); py++)
      for (let px = Math.max(0, Math.floor(cx - rp)); px < Math.min(S, Math.ceil(cx + rp)); px++) {
        const dd = Math.hypot(px + 0.5 - cx, py + 0.5 - cz) * du, i = py * S + px;
        const hole = 1 - sst(hr * 0.7, hr * 0.95, dd), rim = sst(hr * 0.75, hr, dd) * (1 - sst(hr * 1.25, hr * 2.0, dd));
        if (hole > HOLE[i]) HOLE[i] = hole;
        if (rim > HRIM[i]) HRIM[i] = rim;
        Hd[i] += 0.010 * rim - 0.045 * hole;
      }
  }
  // 3) cavity from the combined height (the mesh's own shape counts: moss in the cervical
  // groove, silt behind the ridges)
  const Ht = new Float32Array(N);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const i = py * S + px;
    Ht[i] = Hd[i] + 0.35 * bil(FH, 2 * (px + 0.5) / S - 1, 2 * (py + 0.5) / S - 1);
  }
  const Bl = boxBlur(Ht, S, S, Math.round(S / 96));

  // 4) colour, roughness, normal
  const alb = new Uint8Array(N * 4), rgh = new Uint8Array(N * 4), nrm = new Uint8Array(N * 4);
  const C0 = [0.33, 0.34, 0.29], MOSS = [0.20, 0.28, 0.10], RUST = [0.52, 0.21, 0.07], RUSTD = [0.24, 0.09, 0.04];
  const SEAM = [0.045, 0.04, 0.035], LICH = [0.64, 0.64, 0.56], UNDER = [0.56, 0.54, 0.47], SAND = [0.43, 0.40, 0.33];
  const HOLEC = [0.025, 0.025, 0.022], RIMC = [0.72, 0.70, 0.63], BEV = [0.44, 0.44, 0.39];
  const col = [0, 0, 0];
  for (let py = 0; py < S; py++) {
    const v = (py + 0.5) / S, z = 2 * v - 1;
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S, x = 2 * u - 1, i = py * S + px, o = i * 9;
      const d = M[o], rho = M[o + 1], chip = M[o + 2], lich = M[o + 3], crown = M[o + 4], tint = TINT[M[o + 5]];
      const n1 = M[o + 6], n2 = M[o + 7], n3 = M[o + 8];
      const cav = Math.max(0, Bl[i] - Ht[i]) * 60;                       // ~0..1 in grooves
      const seam = 1 - sst(0.0, 0.011, d);
      // rust streaks DOWNHILL: look up-slope (toward the crown) for a seam, and let it run
      // down the plate as a streak broken by a radially stretched noise
      const th = Math.atan2(z, x), stN = sst(0.45, 0.78, nt(TC, th / TAU * 48, rho * 1.3));
      const run = bil(FRUN, x, z);
      const rust = Math.min(1, seam * 0.55 + cav * 0.5 * (0.4 + 0.6 * n2) + run * stN * 0.8 + sst(0.93, 1.0, rho) * (0.2 + 0.4 * n1));
      const moss = sst(0.12, 0.45, cav) * sst(0.35, 0.6, n2 * 0.7 + n1 * 0.5) * (1 - chip) * (1 - lich);
      const bev = sst(0.004, 0.012, d) * (1 - sst(0.014, 0.03, d)) * (1 - chip);   // the worn chamfer catches light
      const hole = HOLE[i], rim = HRIM[i];
      for (let k = 0; k < 3; k++) {
        let cv = C0[k] * tint[k] * (0.78 + 0.44 * n1) * (0.92 + 0.16 * n3);
        cv += (BEV[k] - cv) * bev * 0.6;
        cv += (UNDER[k] - cv) * chip * 0.75;
        cv += (LICH[k] - cv) * lich * (0.55 + 0.3 * n3);
        cv += (MOSS[k] - cv) * moss * 0.85;
        cv += (RUST[k] - cv) * rust * 0.85;
        cv += (RUSTD[k] - cv) * seam * 0.6;
        cv += (SEAM[k] - cv) * (1 - sst(0.0, 0.005, d)) * 0.9;
        cv += (SAND[k] - cv) * 0.3 * sst(-0.15, -0.85, z) * (0.4 + 0.6 * sst(0.1, 0.5, cav + 0.2));
        cv += (RIMC[k] - cv) * rim * 0.8;
        cv += (HOLEC[k] - cv) * hole;
        cv *= 1 - 0.35 * Math.min(1, cav);                               // grime darkens every groove
        col[k] = cv;
      }
      const j = i * 4;
      alb[j] = Math.min(255, Math.max(0, col[0]) * 255);              // authored in sRGB, as before
      alb[j + 1] = Math.min(255, Math.max(0, col[1]) * 255);
      alb[j + 2] = Math.min(255, Math.max(0, col[2]) * 255);
      alb[j + 3] = 255;
      // wet crowns, matte crust: the contrast is the point
      const wet = crown * (1 - lich) * (1 - moss) * (1 - chip) * (1 - 0.6 * rust);
      let r = 0.64 - 0.40 * wet + 0.28 * lich + 0.22 * moss + 0.26 * seam + 0.10 * rust + 0.16 * chip + 0.35 * hole + 0.08 * (n3 - 0.5);
      r = Math.min(1, Math.max(0.18, r));
      rgh[j] = rgh[j + 1] = rgh[j + 2] = r * 255; rgh[j + 3] = 255;
    }
  }
  normalsInto(nrm, Hd, S, S, du, du, 1.0, false);
  _maps = {
    map: dataTex(alb, S, S, true),
    roughnessMap: dataTex(rgh, S, S, false),
    normalMap: dataTex(nrm, S, S, false)
  };
  for (const k in _maps) _maps[k].wrapS = _maps[k].wrapT = THREE.ClampToEdgeWrapping;
  _maps.ms = performance.now() - t0;
  return _maps;
}


// ---- belly + brood apron -------------------------------------------------------------
export function bellyGeo(COLS = 160, ROWS = 48) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= ROWS; i++) for (let j = 0; j <= COLS; j++) {
    const th = (j % COLS) / COLS * TAU, rho = 0.002 + 0.998 * i / ROWS, rr = rimR(th) * 0.80;
    const x = Math.cos(th) * rr * rho, z = Math.sin(th) * rr * rho;
    let y = -0.075 - 0.035 * (1 - rho * rho);
    for (const zk of [0.40, 0.18, -0.04, -0.26]) y += 0.016 * gauss(z - zk, 0.016) * (1 - 0.6 * rho);   // sternite sutures
    y += 0.012 * gauss(x, 0.018) * (1 - rho);                                                     // median suture
    y -= 0.006 * sst(0.55, 0.75, fbm(x * 0.8 + 0.5, z * 0.8 + 0.5, 1, 4));                        // swollen sternites
    pos.push(x, y, z); uv.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    const c = 0.62 + 0.10 * rho; col.push(c, c * 0.97, c * 0.92);
  }
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);                        // faces down
  }
  const belly = build(pos, uv, col, idx);
  // The brood apron: the broad rounded flap folded under the rear that a brooding crab
  // carries her clutch beneath. Three segment sutures across it.
  const S = 24, T = 16, ap = [], au = [], ac = [], ai = [];
  for (let i = 0; i <= S; i++) for (let j = 0; j <= T; j++) {
    const s = i / S, t = j / T * 2 - 1;
    const z = -0.58 + 0.66 * s;
    const w = 0.36 * Math.pow(Math.sin(Math.PI * (0.15 + 0.85 * s)), 0.5) * (1 - 0.35 * s);
    const x = t * w;
    let y = -0.108 - 0.022 * (1 - t * t);
    for (const sk of [0.28, 0.52, 0.74]) y += 0.006 * gauss(s - sk, 0.02);
    ap.push(x, y, z); au.push(x * 0.5 + 0.5, z * 0.5 + 0.5); ac.push(0.70, 0.67, 0.63);
  }
  for (let i = 0; i < S; i++) for (let j = 0; j < T; j++) {
    const a = i * (T + 1) + j, b = a + T + 1;
    ai.push(a, a + 1, b, b, a + 1, b + 1);                         // faces down
  }
  return mergeGeometries([belly, build(ap, au, ac, ai)]);
}

// ---- limbs ---------------------------------------------------------------------------
// UV CONTRACT (the chitin atlas, chitinMaps): u in [0, 0.5) is a limb segment from its
// proximal joint (u = 0: the soft arthrodial membrane) to its distal cuff (u -> 0.5);
// u in [0.5, 1) is a finger or claw tip from hinge to point, running grey-teal chitin to
// rust to dark horn. v runs round the section and tiles.
const U_SEG = s => s * 0.5, U_TIP = s => 0.5 + 0.5 * Math.min(0.999, s);

// A chitin spike, not a cone: a flared, fluted base (five grooves) narrowing to a slightly
// hooked point, bone-pale at the root running to dark horn at the tip. Along +Y from a
// base sunk a little below y = 0; hooks toward +X by `hook`.
export function spikeGeo(r, h, hook = 0.25, u0 = 0.25, grooves = 5, rows = 8, radial = 10) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows;
    const flare = 1 + 0.75 * (1 - sst(0.0, 0.3, s));
    const rr = r * Math.pow(1 - s, 1.05) * flare;
    const cx = hook * h * s * s, cy = h * s - 0.18 * h;
    const bone = 1 - sst(0.25, 1.0, s);
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, g = Math.cos(a * grooves);
      const rg = rr * (1 + 0.10 * g * (1 - s));
      pos.push(cx + Math.cos(a) * rg, cy, Math.sin(a) * rg);
      uv.push(u0 + 0.015 * s, 0.30 + 0.12 * j / radial);           // a small patch of the atlas
      const c = (0.32 + 1.45 * bone) * (0.86 + 0.14 * g);
      col.push(c * 1.02, c * 0.97, c * 0.86);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return build(pos, uv, col, idx);
}

// A tubercle: a flared boss with a raised rim round a low cratered cap, pale like set
// rivets (the reference's knobs), dark where it meets the armour.
export function tubercleGeo(r, u0 = 0.25) {
  const P = [[1.35, -0.12], [1.15, 0.04], [1.0, 0.20], [0.97, 0.42], [1.04, 0.55], [0.95, 0.66], [0.72, 0.63], [0.45, 0.68], [0.0, 0.72]];
  const C = [0.55, 0.8, 1.15, 1.45, 1.95, 1.8, 1.35, 1.55, 1.6];
  const radial = 12, pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i < P.length; i++) for (let j = 0; j <= radial; j++) {
    const a = (j % radial) / radial * TAU;
    pos.push(Math.cos(a) * P[i][0] * r, P[i][1] * r, Math.sin(a) * P[i][0] * r);
    uv.push(u0 + 0.01 * Math.cos(a) * P[i][0], 0.6 + 0.03 * Math.sin(a) * P[i][0]);
    col.push(C[i], C[i] * 0.99, C[i] * 0.93);
  }
  for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return build(pos, uv, col, idx);
}

// A unit-length exoskeleton segment along +X (0 = proximal joint, 1 = distal). Section
// tall in Y, thin in Z (flattened fore-aft), and ARTICULATED: a wrinkled, pale arthrodial
// membrane pinched into the socket at the root, a stepped cuff with a lipped rim at the
// distal joint (so each segment visibly seats in the last, the next one's membrane
// disappearing into this one's cuff), a dorsal carina, optional spines and tubercles.
// Vertex colour is AMBIENT OCCLUSION (the neck, under the cuff step); hue is the atlas.
export function segmentGeo({ r0, r1, flat = 0.58, spines = 0, rows = 30, radial = 18, tip = false, curl = 0, knobs = 0, x0 = null, capF = 0.05 }) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    // rows crowd toward both ends, where the domed caps and the joint detail live
    const q = i / rows, s = 0.5 * q + 0.25 * (1 - Math.cos(Math.PI * q));
    const dome = e => Math.sqrt(Math.max(0, 1 - Math.pow(1 - Math.min(1, e), 2)));
    let r, ao = 1;
    if (tip) {
      r = r0 * Math.pow(1 - s, 0.75) + 0.002;
      r *= 1 - 0.22 * gauss(s - 0.03, 0.04) + 0.012 * Math.sin(s * 220) * (1 - sst(0.02, 0.08, s));
      ao = 1 - 0.35 * gauss(s - 0.03, 0.05);
    } else {
      r = r0 + (r1 - r0) * s;
      const mem = 1 - sst(0.05, 0.09, s);
      r *= 1 - 0.26 * gauss(s - 0.035, 0.045) + 0.012 * Math.sin(s * 230) * mem;   // membrane folds
      r *= 1 + 0.04 * Math.sin(s * Math.PI);
      // the knuckle: the segment swells into a cuff with a small lipped rim that turns IN
      // over a shoulder, and the next segment's membrane neck (which starts behind its
      // joint, see X0) sits inside it — a real joint, never a cut tube end
      r *= 1 + 0.10 * sst(0.70, 0.90, s) + 0.035 * gauss(s - 0.905, 0.014) - 0.42 * sst(0.955, 1.0, s);
      ao = (1 - 0.40 * gauss(s - 0.035, 0.05)) * (1 - 0.18 * gauss(s - 0.93, 0.02));
    }
    // domed caps (capF of the length, ~ the radius in world terms): round knuckles, never
    // an open or flat tube end
    r *= 0.02 + 0.98 * dome(s / capF);
    if (!tip) r *= 0.02 + 0.98 * dome((1 - s) / capF);
    const cy = -curl * s * s, X0 = x0 != null ? x0 : tip ? -0.05 : -0.07;   // the neck starts inside the last cuff
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const keel = 1 + 0.10 * Math.pow(Math.max(0, ca), 8);
      pos.push(X0 + (1 - X0) * s, cy + ca * r * keel, sa * r * flat);
      // on the domed caps the cylindrical v would pinch into a starburst: pull it to one
      // texel column there, so a knuckle reads as smooth horn
      const capK = sst(0.35, 0.95, 1 - Math.min(1, s / capF)) + (tip ? 0 : sst(0.35, 0.95, 1 - Math.min(1, (1 - s) / capF)));
      uv.push(tip ? U_TIP(s) : U_SEG(Math.min(0.94, Math.max(0.02, s))), j / radial + (0.5 - j / radial) * Math.min(1, capK));
      const c = ao * (0.84 + 0.16 * (0.5 + 0.5 * ca));
      col.push(c, c, c);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const parts = [build(pos, uv, col, idx)];
  for (let k = 0; k < spines; k++) {
    const s = 0.16 + 0.66 * (k + 0.5) / spines, r = r0 + (r1 - r0) * s;
    const sp = spikeGeo(r * 0.24, r * 0.72, 0.30, U_SEG(s), 5, 7, 9);
    sp.rotateZ(-0.80);                                              // raked toward the distal end
    sp.translate(s, r * 0.98, 0);
    parts.push(sp);
  }
  for (let k = 0; k < knobs; k++) for (const a of [0.0, 0.9, -0.9]) {
    const sk = 0.16 + 0.64 * (k + (a ? 0.5 : 0)) / knobs, r = r0 + (r1 - r0) * sk;
    const kn = tubercleGeo(r * 0.16, U_SEG(sk));
    kn.translate(0, r * 0.93, 0);
    kn.rotateX(a);
    kn.scale(1, 1, flat);
    kn.translate(sk, 0, 0);
    parts.push(kn);
  }
  return parts.length > 1 ? mergeGeometries(parts) : parts[0];
}

// A curved finger along +X from its hinge, hooking by `curve` (+ up, - down), tapering to
// a point. Teeth on the biting edge (`bite` +1 = +Y, -1 = -Y): 'molar' rounded crushing
// bosses, 'fang' three great hooked spikes, 'saw' nine raked ones. `knobs` sets a row of
// tubercles down the back; `fringe` a comb of fine setae along the biting edge (the
// mouthparts' hair). UVs run in the atlas's tip half: chitin -> rust -> horn is the MAP.
export function hornGeo({ len, r0, curve, flat = 0.7, bite = -1, teeth = 'saw', rows = 22, radial = 14, knobs = 0, fringe = 0 }) {
  const pos = [], uv = [], col = [], idx = [];
  const C = s => [len * s, curve * len * s * s];
  const frame = s => { const tx = len, ty = 2 * curve * len * s, tl = Math.hypot(tx, ty); return [-ty / tl, tx / tl]; };
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, [cx, cy] = C(s), [nx, ny] = frame(s);
    const r = r0 * Math.pow(1 - s, 0.8) + 0.002;
    const ao = 1 - 0.35 * gauss(s, 0.06);
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      // a keeled back and a flattened biting face: a blade, not a tube
      const kr = r * (1 + 0.18 * Math.pow(Math.max(0, -ca * bite), 6) + 0.05 * Math.sin(s * 40) * sst(0.1, 0.3, s) * (1 - s));
      pos.push(cx + nx * ca * kr, cy + ny * ca * kr, sa * kr * flat);
      uv.push(U_TIP(s), j / radial);
      const c = ao * (0.86 + 0.14 * (0.5 - 0.5 * ca * bite));
      col.push(c, c, c);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const parts = [build(pos, uv, col, idx)];
  const at = teeth === 'none' ? [] : teeth === 'molar' ? [0.25, 0.50, 0.72] : teeth === 'fang' ? [0.22, 0.42, 0.60] : Array.from({ length: 9 }, (_, k) => 0.10 + 0.08 * k);
  for (const s of at) {
    const [cx, cy] = C(s), r = r0 * Math.pow(1 - s, 0.8) + 0.002;
    let t;
    if (teeth === 'molar') t = tubercleGeo(r * 0.42, U_TIP(s));
    else if (teeth === 'fang') { t = spikeGeo(r * 0.36, r * 1.55, 0.35, U_TIP(s)); t.rotateZ(-0.35); }
    else { t = spikeGeo(r * 0.24, r * 0.95, 0.25, U_TIP(s), 4, 5, 7); t.rotateZ(-0.5); }
    if (bite < 0) t.rotateX(Math.PI);
    t.translate(cx, cy + bite * r * 0.90, 0);
    parts.push(t);
  }
  for (let k = 0; k < knobs; k++) {
    const s = 0.14 + 0.6 * (k + 0.5) / knobs, [cx, cy] = C(s), r = r0 * Math.pow(1 - s, 0.8);
    const kn = tubercleGeo(r * 0.26, U_TIP(s));
    if (bite > 0) kn.rotateX(Math.PI);
    kn.translate(cx, cy - bite * r * 0.92, r * 0.25 * flat);
    parts.push(kn);
  }
  for (let k = 0; k < fringe; k++) {
    const s = 0.08 + 0.8 * k / Math.max(1, fringe - 1), [cx, cy] = C(s), r = r0 * Math.pow(1 - s, 0.8) + 0.002;
    const hl = r * (1.6 + 0.8 * hash1(k * 3.3 + len * 17));
    const hr = new THREE.ConeGeometry(r * 0.10, hl, 3, 1, true);
    hr.translate(0, hl / 2, 0);
    hr.rotateZ(0.5 + 0.3 * hash1(k + 0.5));
    if (bite < 0) hr.rotateX(Math.PI);
    hr.rotateX((hash1(k * 7.1) - 0.5) * 0.9);
    hr.translate(cx, cy + bite * r * 0.8, 0);
    const n = hr.attributes.position.count, c = new Float32Array(n * 3), u = hr.attributes.uv;
    for (let q = 0; q < n; q++) { c[q * 3] = 1.25; c[q * 3 + 1] = 1.15; c[q * 3 + 2] = 1.0; u.setXY(q, U_TIP(0.2), u.getY(q)); }
    hr.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(hr);
  }
  return parts.length > 1 ? mergeGeometries(parts) : parts[0];
}

// The claw's hand: a flattened, swollen palm along +X with the fixed finger (pollex)
// growing from its lower distal corner. userData.hinge is where the moving finger pivots.
export function palmGeo(kind) {
  const crusher = kind === 'crusher', scythe = kind === 'scythe', hook = kind === 'hook';
  const len = crusher ? 0.62 : scythe ? 0.95 : hook ? 0.70 : 0.74, hgt = crusher ? 0.36 : scythe ? 0.15 : hook ? 0.34 : 0.22, wid = crusher || hook ? 0.62 : 0.55;
  const rows = 34, radial = 24, pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, prof = Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * s)), 0.55);
    const mem = (1 - 0.18 * gauss(s - 0.03, 0.04)) * (0.5 + 0.5 * sst(0.0, 0.03, s));
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const gr = crusher || hook ? 1 + 0.05 * sst(0.58, 0.74, fbm(s * 3, j / radial * 3, 2, 5)) + 0.07 * Math.pow(Math.max(0, ca), 12) : 1 + 0.06 * Math.pow(Math.max(0, ca), 10);
      const r = hgt * 0.5 * prof * gr * mem * (i === 0 ? 0.05 : 1);
      pos.push(s * len, ca * r, sa * r * wid);
      uv.push(U_SEG(Math.max(0.0, s * 0.92)), j / radial);
      const c = (1 - 0.35 * gauss(s - 0.03, 0.05)) * (0.86 + 0.14 * (0.5 + 0.5 * ca));
      col.push(c, c, c);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const parts = [build(pos, uv, col, idx)];
  const pollex = hornGeo(hook
    ? { len: 0.62, r0: hgt * 0.30, curve: 0.30, bite: 1, teeth: 'fang', knobs: 3 }
    : { len: crusher ? 0.30 : scythe ? 0.16 : 0.44, r0: hgt * 0.28, curve: 0.12, bite: 1, teeth: crusher ? 'molar' : 'saw' });
  pollex.translate(len * 0.88, -hgt * 0.17, 0);
  parts.push(pollex);
  if (hook) for (let k = 0; k < 4; k++) {
    // a row of pale tubercles along the hand's crest, as in the painting
    const s = 0.22 + 0.17 * k, r = hgt * 0.5 * Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * s)), 0.55);
    const kn = tubercleGeo(hgt * 0.06, U_SEG(s * 0.92));
    kn.rotateX(-0.35);
    kn.translate(s * len, r * 0.94, r * wid * 0.32);
    parts.push(kn);
  }
  const g = mergeGeometries(parts);
  g.userData.hinge = [len * 0.90, hgt * 0.20, 0];
  g.userData.len = len;
  return g;
}

// THE CHITIN ATLAS (arms, legs, mouthparts; 1024 x 512). Left half: a limb segment —
// the pale wrinkled membrane at the root, grey-teal chitin with a fine stipple, teal and
// pale flecks and long scratches, a suture and a rust-stained edge at the cuff. Right
// half: a finger — chitin running into rust that pools in the stipple pits, then dark
// glossy horn at the point. The normal is a FINE stipple (the micro-texture that stops
// the arms reading as clay); roughness keeps chitin wet and membranes matte.
let _chit = null;
export function chitinMaps() {
  if (_chit) return _chit;
  const t0 = performance.now();
  const W = 1024, H = 512, { A: TA, B: TB, C: TC } = NT();
  const Hf = new Float32Array(W * H), alb = new Uint8Array(W * H * 4), rgh = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4);
  const CH = [0.42, 0.50, 0.49], CHD = [0.20, 0.25, 0.25], TEAL = [0.26, 0.44, 0.46], FLECK = [0.74, 0.76, 0.70];
  const MEM = [0.60, 0.54, 0.50], RUST = [0.56, 0.25, 0.09], RUSTD = [0.28, 0.10, 0.04], HORN = [0.16, 0.10, 0.07];
  const col = [0, 0, 0];
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W, tipHalf = u >= 0.5, s = tipHalf ? (u - 0.5) * 2 : u * 2, i = py * W + px;
      // integer frequencies in v so the section tiles round the limb
      const n1 = nt(TA, u * 4, v * 2), n2 = nt(TB, u * 12, v * 6), st = nt(TC, u * 64, v * 32), st2 = nt(TA, u * 128 + 0.5, v * 64 + 0.25);
      const stip = sst(0.58, 0.72, st) * 0.7 + sst(0.6, 0.75, st2) * 0.5;      // the fine stipple
      const pit = sst(0.72, 0.8, nt(TB, u * 48 + 0.2, v * 24 + 0.6));
      const scr = (1 - sst(0.0, 0.012, Math.abs(nt(TC, u * 2 + 0.1, v * 16) - 0.5))) * sst(0.4, 0.7, n2);
      const fleck = sst(0.74, 0.80, nt(TB, u * 30 + 0.7, v * 15 + 0.3));
      const tealK = sst(0.5, 0.75, nt(TA, u * 8 + 0.3, v * 4 + 0.9));
      let mem = 0, cuff = 0, rust = 0, horn = 0;
      if (!tipHalf) {
        mem = 1 - sst(0.05, 0.085, s);
        cuff = sst(0.84, 0.87, s);
        rust = cuff * sst(0.4, 0.8, n2) * 0.6 + sst(0.955, 1.0, s) * 0.5;
      } else {
        rust = Math.min(1, sst(0.10, 0.62, s + 0.18 * (n1 - 0.5)) + pit * 0.3);
        horn = sst(0.80, 0.98, s);
        mem = 1 - sst(0.02, 0.05, s);
      }
      let ht = 0.5 * stip - 0.8 * pit - 0.6 * scr + 0.25 * (n2 - 0.5);
      ht += mem * (0.9 * Math.sin(s * 520) - 0.2);                                   // membrane wrinkles
      if (!tipHalf) ht += 1.4 * (1 - sst(0.0, 0.006, Math.abs(s - 0.878))) * -1 + 0.6 * sst(0.87, 0.9, s);   // the cuff suture
      Hf[i] = ht * (1 - 0.6 * horn);
      for (let k = 0; k < 3; k++) {
        let c = CH[k] + (CHD[k] - CH[k]) * sst(0.3, 0.8, n1) * 0.8;
        c += (TEAL[k] - c) * tealK * 0.45;
        c *= 0.9 + 0.22 * stip;
        c += (FLECK[k] - c) * fleck * 0.55;
        c += (RUST[k] - c) * rust * 0.9;
        c += (RUSTD[k] - c) * rust * pit * 0.8;
        c += (HORN[k] - c) * horn * 0.85;
        c += (MEM[k] - c) * mem;
        c *= 1 - 0.45 * pit;
        col[k] = c;
      }
      const j = i * 4;
      alb[j] = Math.min(255, col[0] * 255); alb[j + 1] = Math.min(255, col[1] * 255); alb[j + 2] = Math.min(255, col[2] * 255); alb[j + 3] = 255;
      let r = 0.34 - 0.10 * stip + 0.35 * pit + 0.45 * mem + 0.22 * rust * (1 - horn) - 0.08 * horn + 0.15 * scr;
      r = Math.min(1, Math.max(0.16, r));
      rgh[j] = rgh[j + 1] = rgh[j + 2] = r * 255; rgh[j + 3] = 255;
    }
  }
  // heights above are in arbitrary units: 0.0025 texel-units of relief per unit
  const du = 1 / W, dv = 1 / H;
  for (let i = 0; i < Hf.length; i++) Hf[i] *= 0.0022;
  normalsInto(nrm, Hf, W, H, du, dv, 1.0, true);
  _chit = { map: dataTex(alb, W, H, true), normalMap: dataTex(nrm, W, H, false), roughnessMap: dataTex(rgh, W, H, false) };
  _chit.ms = performance.now() - t0;
  return _chit;
}


// ---- crust ---------------------------------------------------------------------------
// An acorn barnacle: a fluted volcano of six wall plates around a closed operculum.
export function barnacleGeo() {
  const P = [[0.050, 0], [0.053, 0.008], [0.046, 0.024], [0.033, 0.044], [0.022, 0.056],
    [0.017, 0.054], [0.012, 0.044], [0.004, 0.036], [0.0, 0.035]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(P, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), f = 1 + 0.10 * Math.cos(Math.atan2(z, x) * 6);
    p.setX(i, x * f); p.setZ(i, z * f);
  }
  g.computeVertexNormals();
  return g;
}

const _up = new THREE.Vector3(0, 1, 0), _nn = new THREE.Vector3(), _qq = new THREE.Quaternion(), _qt = new THREE.Quaternion();
const _pp = new THREE.Vector3(), _ss = new THREE.Vector3();
// Barnacles colonise the upper shell in patches, thickest toward the rim and the rear.
export function barnacleMatrices(n, seed) {
  const rnd = seededRand(seed), sh = {}, m = [], c = [];
  let guard = 0;
  while (m.length < n && guard++ < n * 60) {
    const x = rnd() * 2 - 1, z = rnd() * 2 - 1;
    shellAt(x, z, sh);
    if (sh.rho > 0.97 || sh.rho < 0.25) continue;
    const want = sst(0.50, 0.66, fbm(x * 0.9 + 0.5, z * 0.9 + 0.5, 0, 3)) * (0.35 + 0.65 * sst(0.4, 0.95, sh.rho)) * (z < 0 ? 1 : 0.6);
    if (rnd() > want) continue;
    shellNormal(x, z, _nn);
    _qq.setFromUnitVectors(_up, _nn).multiply(_qt.setFromAxisAngle(_up, rnd() * TAU));
    // sized to the scutes, not to the diver: a crust, not a rockpile (look-dev 2026-09-24)
    const k = 0.30 + 0.55 * Math.pow(rnd(), 2.2);
    m.push(new THREE.Matrix4().compose(_pp.set(x, sh.h - 0.004, z), _qq, _ss.set(k, k * (0.8 + 0.4 * rnd()), k)));
    const t = 0.84 + 0.14 * rnd();
    c.push(new THREE.Color(t, t * 0.98, t * 0.93));
  }
  return { m, c };
}

// Weed tufts: the rear margin and the flank edges, leaning outward.
export function weedMatrices(n, seed) {
  const rnd = seededRand(seed), sh = {}, m = [];
  let guard = 0;
  while (m.length < n && guard++ < n * 60) {
    const th = rnd() * TAU, rho = 0.80 + 0.17 * rnd();
    if (Math.sin(th) > 0.25 && rnd() > 0.2) continue;
    const rr = rimR(th), x = Math.cos(th) * rr * rho, z = Math.sin(th) * rr * rho;
    shellAt(x, z, sh);
    shellNormal(x, z, _nn);
    _nn.x += Math.cos(th) * 0.5; _nn.z += Math.sin(th) * 0.5; _nn.normalize();
    _qq.setFromUnitVectors(_up, _nn).multiply(_qt.setFromAxisAngle(_up, rnd() * TAU));
    const k = 0.6 + 0.9 * rnd();
    m.push(new THREE.Matrix4().compose(_pp.set(x, sh.h - 0.003, z), _qq, _ss.set(k, k, k)));
  }
  return m;
}

// Limb albedo: tileable mottle with pitting and a faint olive film. `pale` is the
// underbelly: the colour of something that never sees light.
const _limbAlb = {};
export function limbAlbedo(pale = false, S = 256) {
  const key = pale ? 'p' : 'd';
  if (_limbAlb[key]) return _limbAlb[key];
  const { canvas, ctx } = canvas2d(S), im = ctx.createImageData(S, S);
  const B = pale ? [0.58, 0.54, 0.47] : [0.17, 0.16, 0.15];
  const D = pale ? [0.40, 0.36, 0.31] : [0.07, 0.066, 0.06];
  const F = pale ? [0.45, 0.46, 0.36] : [0.12, 0.14, 0.09];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    const m = fbm(u, v, 0, 5), pit = sst(0.64, 0.70, fbm(u * 4, v * 4, 2, 6)), film = sst(0.55, 0.72, fbm(u + 0.3, v + 0.7, 0, 3));
    for (let k = 0; k < 3; k++) {
      let c = B[k] + (D[k] - B[k]) * sst(0.35, 0.75, m) * 0.7;
      c += (F[k] - c) * film * 0.35;
      c *= 1 - 0.45 * pit;
      im.data[i + k] = Math.max(0, Math.min(255, c * 255));
    }
    im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  const t = toTexture(canvas, 1, true);
  t.repeat.set(3, 1);
  return (_limbAlb[key] = t);
}

// ---- thorns ----------------------------------------------------------------------------
// One unit thorn along +X, hooking up (+Y), bone at the base darkening to horn at the tip.
export function thornGeo() {
  return hornGeo({ len: 1, r0: 0.16, curve: 0.22, flat: 0.8, teeth: 'none', rows: 14, radial: 9 });
}
const _td = new THREE.Vector3(), _tu = new THREE.Vector3(), _tz = new THREE.Vector3(), _tp = new THREE.Vector3();
function thornMat(p, dir, len, out) {
  _td.copy(dir).normalize();
  _tu.set(0, 1, 0);
  if (Math.abs(_td.y) > 0.9) _tu.set(0, 0, -1);
  _tz.crossVectors(_td, _tu).normalize();
  _tu.crossVectors(_tz, _td).normalize();
  out.makeBasis(_td, _tu, _tz).scale(_tp.set(len, len, len)).setPosition(p);
  return out;
}
// The menace in the silhouette: lateral spikes raking back off the shoulders, a row of
// brow spikes over the face, a dorsal ridge of spines, and short thorns on the scute crowns.
export function thornMatrices(seed) {
  const rnd = seededRand(seed), sh = {}, m = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const rimPt = th => { const rr = rimR(th); return V(Math.cos(th) * rr * 0.995, shellAt(Math.cos(th) * rr * 0.99, Math.sin(th) * rr * 0.99, sh).h, Math.sin(th) * rr * 0.995); };
  // lateral: four per side, longest at the shoulder, all raked back and a little up
  const LAT = [[1.05, 0.34], [0.62, 0.30], [0.22, 0.24], [-0.30, 0.18]];
  for (const [th, len] of LAT) for (const sd of [1, -1]) {
    const t = sd > 0 ? th : Math.PI - th, p = rimPt(t);
    m.push(thornMat(p, V(Math.cos(t), 0.30, Math.sin(t) - 0.55), len * (0.9 + 0.2 * rnd()), new THREE.Matrix4()));
  }
  // brow: five across the face, forward and down, the middle pair longest
  for (let k = 0; k < 5; k++) {
    const x = (k - 2) * 0.13, t = Math.atan2(0.92, x), p = rimPt(t);
    p.y -= 0.05;
    m.push(thornMat(p, V(x * 0.6, -0.45, 1), (k === 1 || k === 3 ? 0.20 : 0.15) * (0.9 + 0.2 * rnd()), new THREE.Matrix4()));
  }
  // dorsal ridge: seven up the keel, raked back, shrinking to the rear
  for (let k = 0; k < 7; k++) {
    const z = 0.50 - k * 0.16, h = shellAt(0, z, sh).h;
    m.push(thornMat(V(0, h - 0.01, z), V(0, 1, -0.6), (0.20 - k * 0.018) * (0.9 + 0.2 * rnd()), new THREE.Matrix4()));
  }
  // crown thorns on the scutes
  let guard = 0;
  const n0 = m.length;
  while (m.length < n0 + 40 && guard++ < 4000) {
    const x = rnd() * 2 - 1, z = rnd() * 2 - 1;
    shellAt(x, z, sh);
    if (sh.rho > 0.9 || sh.d < 0.10) continue;
    shellNormal(x, z, _nn);
    _nn.z -= 0.5;
    m.push(thornMat(V(x, sh.h - 0.005, z), _nn, 0.05 + 0.06 * rnd(), new THREE.Matrix4()));
  }
  return m;
}

let _grain = null;
export function limbGrain() {
  if (_grain) return _grain;
  _grain = toTexture(normalFromHeight(noiseCanvas(256, 5, 1.3, seededRand(0x6A1F00D5)), 3));
  _grain.repeat.set(6, 2);
  return _grain;
}

// ---- the shingles ----------------------------------------------------------------------
// The reference's signature: long angular shale plates layered down the flanks, sweeping
// back. AAA pass (2026-09-25): a real PLATE, not a lens-section tube. One unit blade along
// +X (0 at the root), width across Z, thickness in Y. The section is a flat top plateau
// that breaks over a CHAMFER into a thin rim, and a flat underside: so every plate has a
// bevelled edge that catches the light and a dark shadowed lip. The root is THICK and the
// tip thin. Each of BLADE_VARIANTS has its own broken-edge profile — V notches bitten out
// of either margin, a fine serration, and on some a snapped, jagged tip — and its own
// strip of the blade atlas (bladeMaps) with growth shelves, ribs, pitting, rust rims.
// Vertex colour is ambient occlusion only: the dark cavity at the root where the plate
// goes under the one above, and the underside.
export const BLADE_VARIANTS = 4;
export function bladeGeo(variant = 0, rows = 24) {
  const rnd = seededRand(0xB1AD0 + variant * 7919);
  const notches = [[], []];
  for (const sd of [0, 1]) {
    const n = 1 + Math.floor(rnd() * 2.6);
    for (let k = 0; k < n; k++) notches[sd].push([0.22 + 0.66 * rnd(), 0.025 + 0.06 * rnd(), 0.18 + 0.32 * rnd()]);
  }
  const ph = [rnd() * 10, rnd() * 10], brk = [0.05, 0.16, 0.08, 0.26][variant % 4], jph = rnd() * 6;
  const chip = (x, sd) => {
    let c = 0;
    for (const [p, w, dp] of notches[sd]) c = Math.max(c, dp * Math.max(0, 1 - Math.abs(x - p) / w));
    c += 0.06 * Math.abs(Math.sin(x * 41 + ph[sd])) * Math.abs(Math.sin(x * 97 + 2 * ph[sd]));
    return Math.min(0.6, c) * sst(0.05, 0.2, x);
  };
  // the section, walked round from the +Z rim over the top and back under: [t, yK, part]
  // (part 0 top, 1 chamfer, 2 rim, 3 underside); yK multiplies the local thickness
  const SEC = [[1.0, 0.10, 2], [0.93, 0.62, 1]];
  for (let k = 0; k <= 10; k++) SEC.push([0.84 - 1.68 * k / 10, 1.0, 0]);
  SEC.push([-0.93, 0.62, 1], [-1.0, 0.10, 2], [-1.0, -0.12, 2], [-0.92, -0.42, 3]);
  for (let k = 0; k <= 4; k++) SEC.push([-0.75 + 1.5 * k / 4, -0.50, 3]);
  SEC.push([0.92, -0.42, 3], [1.0, -0.12, 2], [1.0, 0.10, 2]);
  const NS = SEC.length, pos = [], uv = [], col = [], idx = [];
  // a shard, not a scale: straight flanks from a broad shoulder to a long point
  const sho = 0.22 + 0.12 * rnd();
  const w0 = x => 0.15 * (x < sho ? 0.55 + 0.45 * Math.pow(x / sho, 0.6) : Math.pow((1 - x) / (1 - sho), 0.85)) + 0.003;
  for (let i = 0; i <= rows; i++) {
    const xi = i / rows;
    for (let j = 0; j < NS; j++) {
      const [t, yK, part] = SEC[j], sd = t >= 0 ? 0 : 1;
      // a snapped tip: the end edge is a jagged diagonal, not a point
      const jag = 0.5 + 0.5 * Math.sin(t * 5.3 + jph) * Math.cos(t * 11.7 + jph);
      const x = xi * (1 - brk * jag * Math.pow(xi, 5));
      const w = w0(x) * (1 - chip(x, sd));
      const th = 0.007 + 0.034 * Math.pow(1 - x, 1.4);          // thick root, thin tip
      const z = t * w;
      let y = yK * th * 0.5 - 1.1 * z * z - 0.10 * x * x;
      // growth shelves stepping down the top face toward the free margin
      if (part === 0) y += 0.0035 * sst(0.0, 0.08, ((x + 0.4 * t * t) * 7.0) % 1) * (1 - x);
      pos.push(x, y, z);
      uv.push(x, (variant + 0.5 + 0.47 * Math.max(-1, Math.min(1, t))) / BLADE_VARIANTS);
      // AO: the root is in the dark under the plate above; the underside is shadowed
      const root = 0.30 + 0.70 * sst(0.0, 0.32, x);
      const c = part === 3 ? 0.45 * root : part === 2 ? 0.75 * root : part === 1 ? 1.08 * root : root;
      col.push(c, c, c);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < NS - 1; j++) {
    const a = i * NS + j, b = a + NS;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // close the root: a fan to the section's centre
  const c0 = pos.length / 3;
  pos.push(0, 0, 0); uv.push(0, (variant + 0.5) / BLADE_VARIANTS); col.push(0.1, 0.1, 0.1);
  for (let j = 0; j < NS - 1; j++) idx.push(c0, j + 1, j);
  return build(pos, uv, col, idx);
}

// THE BLADE ATLAS: four strips (one per variant) of 512 x 128, u along the plate, v across.
// Height: growth shelves (a sawtooth of steps bowed toward the root — each a layer the
// plate grew), fine growth rings between them, faint longitudinal ribs, pitting, and
// chips near the margins. Colour: dark slate-teal heart streaked paler along the ribs,
// running to bright rust at the rims and tip (the painting's rust-edged shale), with
// lichen specks and grime in every step. Roughness: wet ridges, matte grooves and rust.
let _blade = null;
export function bladeMaps() {
  if (_blade) return _blade;
  const t0 = performance.now();
  const W = 512, SH = 128, H = SH * BLADE_VARIANTS, { A: TA, B: TB, C: TC } = NT();
  const Hf = new Float32Array(W * H), alb = new Uint8Array(W * H * 4), rgh = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4);
  const HEART = [[0.36, 0.29, 0.23], [0.31, 0.35, 0.34], [0.35, 0.35, 0.29], [0.29, 0.30, 0.28]];
  const RIB = [0.42, 0.45, 0.42], RUST = [0.60, 0.27, 0.10], RUSTD = [0.30, 0.12, 0.05], LICH = [0.62, 0.62, 0.55], GRIME = [0.07, 0.07, 0.06];
  const col = [0, 0, 0];
  for (let py = 0; py < H; py++) {
    const vb = Math.floor(py / SH), tv = ((py % SH) + 0.5) / SH, t = (tv - 0.5) / 0.47, at = Math.min(1, Math.abs(t));
    const v = (py + 0.5) / H;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W, i = py * W + px, o = vb * 0.31;
      // v spans four strips of a plate ~0.3 as wide as long: x12 keeps features round
      const n1 = nt(TA, u * 3 + o, v * 36), n2 = nt(TB, u * 10 + o, v * 120), n3 = nt(TC, u * 30 + o, v * 360);
      const q = u + 0.40 * t * t + 0.05 * (n1 - 0.5);
      const shelfF = (q * 7.0) % 1, shelf = sst(0.0, 0.07, shelfF) - 0.25 * shelfF;   // step up, slope down
      const ring = Math.sin(q * 150 + n2 * 5) * 0.5 + 0.5;
      const rib = Math.pow(Math.abs(Math.sin(t * 6.5 + n1 * 2)), 3);
      const pit = sst(0.70, 0.78, n3);
      const edge = sst(0.70, 1.0, at), tipK = sst(0.72, 1.0, u);
      const chipE = sst(0.62, 0.72, n2) * sst(0.8, 0.97, at);
      Hf[i] = 1.0 * shelf + 0.25 * ring + 0.18 * rib - 0.6 * pit - 0.8 * chipE;
      const rust = Math.min(1, edge * (0.55 + 0.6 * n2) + tipK * 0.7 + (1 - shelf) * 0.25 * sst(0.4, 0.7, n1));
      const grime = (1 - sst(0.0, 0.10, shelfF)) * 0.7 + pit * 0.6;
      const lich = sst(0.70, 0.80, nt(TA, u * 7 + o + 0.5, v * 84)) * (1 - edge) * 0.7;
      const HT = HEART[vb];
      for (let k = 0; k < 3; k++) {
        let c = HT[k] * (0.8 + 0.4 * n1);
        c += (RIB[k] - c) * rib * 0.35 * (1 - rust);
        c += (RUST[k] - c) * rust * 0.9;
        c += (RUSTD[k] - c) * rust * grime * 0.7;
        c += (LICH[k] - c) * lich * 0.6;
        c += (GRIME[k] - c) * grime * 0.45;
        c += (0.55 - c) * chipE * 0.4;                           // fresh break: paler
        col[k] = c;
      }
      const j = i * 4;
      alb[j] = Math.min(255, col[0] * 255); alb[j + 1] = Math.min(255, col[1] * 255); alb[j + 2] = Math.min(255, col[2] * 255); alb[j + 3] = 255;
      let r = 0.42 - 0.12 * ring * (1 - rust) + 0.30 * grime + 0.22 * rust + 0.25 * lich + 0.2 * chipE;
      r = Math.min(1, Math.max(0.30, r));
      rgh[j] = rgh[j + 1] = rgh[j + 2] = r * 255; rgh[j + 3] = 255;
    }
  }
  for (let i = 0; i < Hf.length; i++) Hf[i] *= 0.0016;
  normalsInto(nrm, Hf, W, H, 1 / W, 1 / H, 1.0, true);
  _blade = { map: dataTex(alb, W, H, true), normalMap: dataTex(nrm, W, H, false), roughnessMap: dataTex(rgh, W, H, false) };
  for (const k in _blade) { _blade[k].wrapS = THREE.ClampToEdgeWrapping; }
  _blade.ms = performance.now() - t0;
  return _blade;
}


const _bd = new THREE.Vector3(), _bn = new THREE.Vector3(), _bz = new THREE.Vector3(), _bs = new THREE.Vector3();
function bladeMat(p, dir, up, len, wid, out) {
  _bd.copy(dir).normalize();
  _bz.crossVectors(_bd, up).normalize();
  _bn.crossVectors(_bz, _bd).normalize();
  return out.makeBasis(_bd, _bn, _bz).scale(_bs.set(len, 1, wid)).setPosition(p);
}
// Three shingled layers down each flank from the shoulder to the tail, the upper layers
// shorter and steeper; a crest of tall shards off the rear of the back; two brow blades
// along the prow.
export function bladeMatrices(seed) {
  const rnd = seededRand(seed), sh = {}, m = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const sd of [1, -1]) {
    for (let layer = 0; layer < 4; layer++) {
      const rhoL = [1.02, 0.90, 0.78, 0.64][layer], N = [9, 8, 7, 6][layer];
      for (let k = 0; k < N; k++) {
        const f = (k + 0.5 * (layer & 1)) / (N - 0.5);
        const th0 = 1.00 - f * 1.95, th = sd > 0 ? th0 : Math.PI - th0;   // shoulder -> tail
        const rr = rimR(th) * rhoL * 0.97, x = Math.cos(th) * rr, z = Math.sin(th) * rr;
        const y = shellAt(Math.min(0.99, 1 / rhoL) * x, Math.min(0.99, 1 / rhoL) * z, sh).h + 0.02;
        shellNormal(x * 0.96, z * 0.96, _nn);
        // lie along the slope, sweeping back: outward-and-down plus aft
        const dir = V(Math.cos(th) * 0.75, -0.22 + 0.06 * layer, Math.sin(th) * 0.75 - 0.6);
        const len = (0.28 + 0.16 * Math.sin(Math.PI * f)) * (1 - 0.08 * layer) * (0.85 + 0.3 * rnd());
        m.push(bladeMat(V(x, y, z), dir, _nn, len, 0.9 + 0.6 * rnd(), new THREE.Matrix4()));
      }
    }
  }
  // rear crest: tall shards raking up and back off the hind slab
  for (let k = 0; k < 5; k++) {
    const x = (k - 2) * 0.16 + (rnd() - 0.5) * 0.05, z = -0.30 - 0.12 * Math.abs(k - 2) + (rnd() - 0.5) * 0.06;
    const y = shellAt(x, z, sh).h;
    shellNormal(x, z, _nn);
    m.push(bladeMat(V(x, y - 0.01, z), V(x * 0.6, 0.30 + 0.15 * rnd(), -1), _nn, 0.38 + 0.20 * rnd(), 1.2, new THREE.Matrix4()));
  }
  // brow blades along the prow edges
  for (const sd of [1, -1]) {
    const th = sd > 0 ? 1.15 : Math.PI - 1.15, rr = rimR(th) * 0.96, x = Math.cos(th) * rr, z = Math.sin(th) * rr;
    shellNormal(x, z, _nn);
    m.push(bladeMat(V(x, shellAt(x, z, sh).h, z), V(sd * 0.40, -0.12, 1), _nn, 0.42, 1.3, new THREE.Matrix4()));
  }
  return m;
}

// ---- the reef on her back --------------------------------------------------------------
// AAA pass (2026-09-25): the real things, small and muted (never neon). Tube sponges are
// lathed with a flared foot, a lumpy pitted wall, a lipped OSCULUM and a dark throat that
// goes down inside; the sea fan is a lattice (a net of branches with holes through it,
// cut from a Voronoi), on a short trunk; the encrusting sponge is a bumpy mat moulded to
// the shell with dark pores. ONE merged geometry with vertex colours in one material
// (the old four meshes were four draws).
const _rc = new THREE.Color();
function paint(g, hex, fn) {
  _rc.set(hex);                                              // linear, via colour management
  const p = g.attributes.position, n = p.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const k = fn ? fn(i, p) : 1; c[i * 3] = _rc.r * k; c[i * 3 + 1] = _rc.g * k; c[i * 3 + 2] = _rc.b * k; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function tubeSponge(rnd, r, h) {
  // profile bottom -> lip -> down the throat
  const P = [[1.25, -0.05], [1.05, 0.05], [0.96, 0.2], [0.90, 0.45], [0.94, 0.7], [1.0, 0.9], [1.10, 0.98], [1.04, 1.02], [0.84, 1.0], [0.74, 0.9], [0.66, 0.6]];
  const pts = P.map(([a, b]) => new THREE.Vector2(a * r, b * h));
  const g = new THREE.LatheGeometry(pts, 14);
  const p = g.attributes.position, ph = rnd() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const body = sst(0.08, 0.2, y / h) * (1 - sst(0.8, 0.95, y / h));
    const k = 1 + body * (0.12 * Math.sin(a * 3 + ph + y / h * 5) + 0.16 * (fbm(a / TAU + ph, y / h * 0.7, 2, 6) - 0.5) * 2);
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function tubes(rnd, cx, cz, n, rMin, rMax, hMin, hMax, spread, hex) {
  const sh = {}, parts = [];
  for (let k = 0; k < n; k++) {
    const x = cx + (rnd() - 0.5) * spread, z = cz + (rnd() - 0.5) * spread;
    const r = rMin + (rMax - rMin) * rnd(), h = hMin + (hMax - hMin) * rnd();
    const t = tubeSponge(rnd, r, h);
    const shade = 0.8 + 0.3 * rnd();
    paint(t, hex, (i, p) => {
      const y = p.getY(i), rr = Math.hypot(p.getX(i), p.getZ(i));
      const inside = y > 0.5 * h && rr < r * 0.8 ? 0.12 : 1;             // the dark throat
      return shade * inside * (0.75 + 0.35 * sst(0, h, y));
    });
    t.rotateX((rnd() - 0.5) * 0.6); t.rotateZ((rnd() - 0.5) * 0.6);
    t.translate(x, shellAt(x, z, sh).h - 0.012, z);
    parts.push(t);
  }
  return parts;
}
// A gorgonian sea fan, in one plane: a short trunk forking into tapering branches, and
// the branches fused sideways into a LATTICE (each branch node bridged to its nearest
// neighbours), so the fan is a net with holes through it, as in the painting.
function fan(rnd, cx, cz, size, hex) {
  const sh = {}, y0 = shellAt(cx, cz, sh).h - 0.006, yaw = rnd() * TAU, parts = [], nodes = [];
  const bar = (x0, y0b, x1, y1, r0, r1, k) => {
    const len = Math.hypot(x1 - x0, y1 - y0b);
    if (len < 1e-4) return;
    const c = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true);
    c.translate(0, len / 2, 0);
    c.rotateZ(Math.atan2(y1 - y0b, x1 - x0) - Math.PI / 2);
    c.translate(x0, y0b, 0);
    parts.push(paint(c, hex, () => k));
  };
  const grow = (x, y, ang, len, r, depth, pid) => {
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    bar(x, y, ex, ey, r, r * 0.72, 0.55 + 0.1 * (5 - depth) * 0.15 + 0.35 * (1 - depth / 5));
    const id = nodes.length;
    nodes.push([ex, ey, pid]);
    if (depth > 0) for (const da of [-0.40, 0.40]) grow(ex, ey, ang + da + (rnd() - 0.5) * 0.35, len * 0.78, r * 0.72, depth - 1, id);
  };
  grow(0, 0, Math.PI / 2, size * 0.20, size * 0.024, 5, -1);
  const lr = size * 0.0045, reach = size * 0.13;
  for (let i = 0; i < nodes.length; i++) {
    const best = [];
    for (let j = 0; j < nodes.length; j++) {
      if (j === i || nodes[j][2] === i || nodes[i][2] === j) continue;
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
      if (d < reach) best.push([d, j]);
    }
    best.sort((p, q) => p[0] - q[0]);
    for (const [, j] of best.slice(0, 2)) if (j > i) bar(nodes[i][0], nodes[i][1], nodes[j][0], nodes[j][1], lr, lr, 0.9);
  }
  const g = mergeGeometries(parts);
  g.rotateY(yaw);
  g.translate(cx, y0, cz);
  return g;
}
// Encrusting sponge: a lumpy mat moulded to the shell, pores dark.
function crust(rnd, cx, cz, rad, hex) {
  const sh = {}, R = 26, A = 40, pos = [], col = [], uv = [], idx = [], ph = rnd() * 10;
  _rc.set(hex);
  const pores = []; for (let k = 0; k < 16; k++) pores.push([(rnd() - 0.5) * rad * 1.2, (rnd() - 0.5) * rad * 1.2, rad * (0.05 + 0.05 * rnd())]);
  for (let i = 0; i <= R; i++) for (let j = 0; j <= A; j++) {
    const rr = i / R, a = j / A * TAU;
    const edge = rad * (1 + 0.25 * Math.sin(a * 3 + ph) + 0.12 * Math.sin(a * 7 + ph * 2));
    const lx = Math.cos(a) * rr * edge, lz = Math.sin(a) * rr * edge, x = cx + lx, z = cz + lz;
    const lump = fbm(x * 3 + ph, z * 3, 2, 6), fine = fbm(x * 9 + ph, z * 9, 3, 6);
    let bump = rad * Math.sqrt(Math.max(0, 1 - rr * rr)) * (0.10 + 0.30 * sst(0.35, 0.8, lump) + 0.08 * fine);
    let k = (0.55 + 0.6 * lump) * (0.8 + 0.3 * fine);
    for (const [px, pz, pr] of pores) { const d = Math.hypot(lx - px, lz - pz); if (d < pr) { bump -= rad * 0.06 * (1 - d / pr); k *= 0.25; } }
    pos.push(x, shellAt(x, z, sh).h - 0.004 + bump, z); uv.push(rr, j / A);
    col.push(_rc.r * k, _rc.g * k, _rc.b * k);
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < A; j++) {
    const a = i * (A + 1) + j, b = a + A + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function reefGeo(seed) {
  const rnd = seededRand(seed);
  const parts = [
    ...tubes(rnd, -0.42, 0.30, 9, 0.010, 0.018, 0.08, 0.17, 0.16, 0x3d4f6e),
    ...tubes(rnd, 0.30, -0.10, 6, 0.009, 0.015, 0.06, 0.13, 0.12, 0x3d4f6e),
    ...tubes(rnd, 0.20, -0.52, 7, 0.013, 0.022, 0.07, 0.14, 0.14, 0x7a4a2c),
    ...tubes(rnd, -0.10, -0.25, 5, 0.006, 0.010, 0.04, 0.09, 0.10, 0x8a7c6c),
    fan(rnd, -0.66, 0.46, 0.26, 0x7e3a3c), fan(rnd, 0.05, 0.20, 0.20, 0x7e3a3c),
    crust(rnd, -0.28, -0.05, 0.09, 0x6e5836), crust(rnd, 0.46, 0.22, 0.07, 0x5a5358), crust(rnd, -0.05, -0.55, 0.08, 0x6e5836)
  ];
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'uv') p.deleteAttribute(k);
  return mergeGeometries(parts.map(p => p.index ? p : p));
}

// ---- the eyes ------------------------------------------------------------------------
// One eye, looking down +Z: a wet black dome with a thin GOLD ring where it meets its
// socket (the socket itself is carved into the face plate, carapaceGeo). Vertex colour
// carries the two materials; the eye material masks its eyeshine emissive to the black
// dome by that colour.
export function eyeGeo() {
  const dome = paint(new THREE.SphereGeometry(1, 22, 14).translate(0, 0, 0.15), 0x010101, () => 1);
  const ring = paint(new THREE.TorusGeometry(0.985, 0.055, 6, 28).translate(0, 0, 0.20), 0x7a5418, () => 1);
  // the socket is a CUP on an ocular mound: a thin lipped rim hugging the dome, then the
  // mound falling away and back into the face (concave where it meets the eye), so
  // neighbouring eyes merge into one cluster instead of reading as separate rings
  const g = mergeGeometries([dome, ring].map(x => { for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
  return g;
}
