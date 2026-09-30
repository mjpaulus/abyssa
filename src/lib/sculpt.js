// SCULPT — procedural sculpting at load time: signed distance fields in, game meshes and
// baked maps out. The AAA high-to-low workflow, done in code (no assets, no downloads).
//
//   spec (plain data) -> sparse SDF grid -> dual contouring -> QEM decimation ->
//   UV charts + atlas -> bake (normal / albedo / AO + roughness) from the SDF itself
//
// The "high poly" is the SDF: every texel of the bake projects onto the true surface and
// samples it (gradient = normal, 4-tap Laplacian = curvature, marched occlusion = AO), so
// detail far below the game mesh's resolution (barnacle walls, pits, cracks) lands in the
// maps. The game mesh is a feature-preserving decimation of a fine dual-contoured mesh.
//
// PURE: no imports, no THREE, no DOM. Runs in a module worker, on the main thread, and in
// node (for benches). Deterministic: every random draw is seeded from the spec.
//
// ------------------------------------------------------------------------------------
// API
// ------------------------------------------------------------------------------------
// runJob(job) -> result                          synchronous, anywhere
// sculptAsync(job) -> Promise<result>             worker pool (falls back to runJob on the
//                                                 main thread when workers are missing);
//                                                 results cached in memory by job key
// toGeometry(THREE, part) -> BufferGeometry       position/normal/uv/index (+ color = AO)
// toTextures(THREE, maps) -> { map, normalMap, ormMap }   mipmapped DataTextures
// compile(spec, forMesh?) -> { f(x,y,z), bb }     a spec as a callable SDF (probes, tests)
//
// OFFLINE (tools/blender pipeline, node): the heavy path for hero assets
// meshSDF(spec, h, { forMesh?, mesher?, lip? }) -> { pos, idx, field }   dense DC mesh
// shadeVertices(field, pos, paint, { kEps, ao }) -> { normal, rgba }     per-vertex paint
// decimate(pos, idx, tris, err) -> { pos, idx }                          QEM
// unwrapSet([{ pos, idx }], size, gutter) -> { meshes: [{ pos, idx, uv }], coverage }
// plyBytes(pos, idx, normal?, rgba?, swizzle = true, uv?) -> Uint8Array  binary PLY
//
// WHERE TO RUN WHAT (measured): a hero body's full spec costs ~7 us per evaluation (60
// plates, worley barnacles, erosion taps), so its 2048 bake is ~1 min in a browser
// worker — ship it through the Blender pipeline (README there). runJob/sculptAsync at
// runtime suit small, cheap specs (props, crumbs) where a few hundred ms in a worker is
// fine; results are cached per job key.
//
// JOB
//   { key?, parts: [PART...], atlas: ATLAS, probes?: [PROBE...] }
//   PART  { name, sdf: NODE, h: cell size, mesher: 'dc'|'nets' (default 'dc'),
//           tris: target triangle count after decimation (0 = keep), err: max QEM error
//           (in units, default h * 0.35), lip: Lipschitz safety for block culling (1.6) }
//   ATLAS { size: texels (pow2), gutter: 4, ormHalf: true, eps: normal tap (default auto),
//           kEps: curvature tap (0.012), ao: { r: 0.06, n: 4 }, paint: PAINT }
//           Every part of a job packs into ONE atlas (one material for all of them).
//   PROBE { name, part, type: 'top', x0, x1, z0, z1, n }  top-surface heights (ray-marched
//           down from the part's bound): for seating instanced props on the sculpt.
//
// RESULT
//   { parts: { name: { position, normal, uv, index, color } },   typed arrays
//     maps: { size, albedo, normal, orm, ormSize },                RGBA8 Uint8Arrays
//     probes: { name: Float32Array }, stats: { ... ms, tris, verts, evals } }
//
// NODE — primitives (every one takes m: material id, default 0)
//   { t:'sphere', c:[x,y,z], r }
//   { t:'ellip',  c, r:[rx,ry,rz], e?:[ex,ey,ez] }          e = Euler XYZ radians, or
//                                                     R: [9] row-major local->world matrix
//                                                     (box, ellip, xf take it; torus: rot)
//   { t:'box',    c, h:[hx,hy,hz], r: rounding, e? }
//   { t:'cap',    a:[..], b:[..], r } | { t:'cap', a, b, ra, rb }   capsule / round cone
//   { t:'cone',   a, b, ra, rb }                              capped cone, sharp rims
//   { t:'torus',  c, R, r, e? }                               in the local XZ plane
//   { t:'tube',   p:[[..]x3|4], r:[r0, r1], n: segments, rr?: [radius per sample] }
//                                                             bezier tube (round cones)
//   { t:'plane',  n:[..], o: offset }                         dot(p, n) - o
// NODE — operators
//   { t:'u', k, ch:[...] }       smooth union (k = blend radius, 0 = hard min)
//   { t:'s', k, ch:[a, ...b] }   a minus every b (smooth); m? paints the cut faces
//   { t:'i', k, ch:[...] }       smooth intersection
//   { t:'xf', p?:[..], e?:[..], s?: uniform scale, ch:[x] }    move a subtree
//   { t:'mir', ax: 0|1|2, ch:[x] }                              mirror across an axis plane
//   { t:'warp', amp, f, oct?, seed, mask?, ch:[x] }             fbm domain warp
//   { t:'disp', L:[LAYER...], ch:[x] }                          surface displacement
//   { t:'erode', amt, r, mask?, ch:[x] }    curvature carving: convex edges wear away
//   { t:'round', r, ch:[x] }     inflate (d - r)
// LAYER (displacement; + raises the surface)
//   { type:'fbm'|'ridged'|'grain', amp, f, oct?, seed, mask? }
//   { type:'barn', amp, f, dens, seed, mask? }    worley barnacles: fluted cones, open pits
//   { type:'pits', amp, f, dens, r, seed, mask? } worley pitting (sponge bores)
//   { type:'cracks', amp, f, w, heal?, seed, mask? }  cell-border cracks; heal raises a
//                                                  callus ridge either side (old breaks)
//   { type:'bands', amp, f, ax:[x,y,z], mask? }    growth lines along an axis
//   any layer + bake: true -> left out of the game mesh, present in the baked maps (the
//   high-to-low split: fine detail costs texels, not triangles, and never stalls QEM)
// MASK — an array of terms, multiplied (positional terms work in the node's frame)
//   ['ax', axis, a, b]  smoothstep along an axis (a > b reverses it)
//   ['sph', [c], r0, r1] 1 inside r0 fading to 0 at r1
//   ['n', f, lo, hi, seed]  fbm patches
//   ['rad', lo, hi]      smoothstep of the xz radius
//   bake-only terms (paint masks): ['cav', lo, hi] concavity, ['cvx', lo, hi] convexity
//   (curvature * kScale), ['ao', lo, hi] occlusion, ['nd', [dir], lo, hi] facing,
//   ['mat', id] dominant material, ['wor', f, w, seed] worley border lines, ['inv', TERM],
//   ['fn', S => 0..1] a creature's own function of the paint state (analytic placements)
// PAINT
//   { mats: { id: { c:[r,g,b] sRGB 0..1, ro: roughness } }, kScale: 0.03,
//     layers: [ { c, a: opacity, ro?, m: MASK } ... ],  aoAlb: 0.5 (AO into albedo) }
//
// COST NOTES (measured, see stats): evaluation is sparse — 8^3 cell blocks, each with the
// spec PRUNED to the primitives whose bounds touch it (a 60-plate shell evaluates ~3-6
// primitives per point), culled by a Lipschitz bound before any corner is sampled.
// ------------------------------------------------------------------------------------

// ---------------------------------------------------------------- rng / noise
export function mulberry(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(s | 0, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const PERMS = new Map();
function perm(seed) {
  let P = PERMS.get(seed);
  if (P) return P;
  const r = mulberry(seed * 7919 + 17), p = new Uint8Array(512), a = [];
  for (let i = 0; i < 256; i++) a.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  PERMS.set(seed, p);
  return p;
}
function grad(h, x, y, z) {
  const hh = h & 15, u = hh < 8 ? x : y, v = hh < 4 ? y : (hh === 12 || hh === 14 ? x : z);
  return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
}
// improved Perlin noise, ~[-1, 1]
export function perlin(P, x, y, z) {
  let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
  const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  const x1 = x - 1, y1 = y - 1, z1 = z - 1;
  const a0 = grad(P[AA], x, y, z), a1 = grad(P[BA], x1, y, z), a2 = grad(P[AB], x, y1, z), a3 = grad(P[BB], x1, y1, z);
  const b0 = grad(P[AA + 1], x, y, z1), b1 = grad(P[BA + 1], x1, y, z1), b2 = grad(P[AB + 1], x, y1, z1), b3 = grad(P[BB + 1], x1, y1, z1);
  const l0 = a0 + u * (a1 - a0), l1 = a2 + u * (a3 - a2), l2 = b0 + u * (b1 - b0), l3 = b2 + u * (b3 - b2);
  const m0 = l0 + v * (l1 - l0), m1 = l2 + v * (l3 - l2);
  return m0 + w * (m1 - m0);
}
// fbm in ~[-1, 1] (normalised by the amplitude sum)
export function fbm3(P, x, y, z, oct) {
  let s = 0, a = 1, t = 0, f = 1;
  for (let o = 0; o < oct; o++) { s += a * perlin(P, x * f + o * 31.7, y * f + o * 17.3, z * f + o * 11.1); t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}
function ridged3(P, x, y, z, oct) {
  let s = 0, a = 1, t = 0, f = 1;
  for (let o = 0; o < oct; o++) { const n = 1 - Math.abs(perlin(P, x * f + o * 31.7, y * f, z * f)); s += a * n * n; t += a; a *= 0.5; f *= 2.1; }
  return s / t;
}
// Worley: F1, F2 and the nearest feature's cell hash, written to W
const W = { f1: 0, f2: 0, id: 0, fx: 0, fy: 0, fz: 0 };
function worley(x, y, z, seed) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  let f1 = 9, f2 = 9, id = 0, fx = 0, fy = 0, fz = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = X + dx, cy = Y + dy, cz = Z + dz;
    const px = cx + hash3(cx, cy, cz, seed), py = cy + hash3(cx, cy, cz, seed + 101), pz = cz + hash3(cx, cy, cz, seed + 211);
    const ex = px - x, ey = py - y, ez = pz - z, d = ex * ex + ey * ey + ez * ez;
    if (d < f1) { f2 = f1; f1 = d; id = hash3(cx, cy, cz, seed + 307); fx = px; fy = py; fz = pz; } else if (d < f2) f2 = d;
  }
  W.f1 = Math.sqrt(f1); W.f2 = Math.sqrt(f2); W.id = id; W.fx = fx; W.fy = fy; W.fz = fz;
  return W;
}
const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

// ---------------------------------------------------------------- material tracking
// Every evaluation leaves the dominant material (MA), the runner-up (MB) and the weight
// of the runner-up (MW) here; unions blend them, the bake reads them.
let MA = 0, MB = 0, MW = 0;

// ---------------------------------------------------------------- rotations
function eulerMat(e) {           // rows of R (local -> world), Euler XYZ like THREE
  const [a, b, c] = e || [0, 0, 0];
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // THREE Euler XYZ: R = Rx * Ry * Rz
  return [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb
  ];
}
// world -> local is R^T
function bbOfRotated(R, hx, hy, hz, cx, cy, cz, pad) {
  const ex = Math.abs(R[0]) * hx + Math.abs(R[1]) * hy + Math.abs(R[2]) * hz;
  const ey = Math.abs(R[3]) * hx + Math.abs(R[4]) * hy + Math.abs(R[5]) * hz;
  const ez = Math.abs(R[6]) * hx + Math.abs(R[7]) * hy + Math.abs(R[8]) * hz;
  return [cx - ex - pad, cy - ey - pad, cz - ez - pad, cx + ex + pad, cy + ey + pad, cz + ez + pad];
}
const bbUnion = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
const bbGrow = (a, k) => [a[0] - k, a[1] - k, a[2] - k, a[3] + k, a[4] + k, a[5] + k];
const bbHit = (a, b) => a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];
const FAR = 1e3;

// ---------------------------------------------------------------- masks
function compileMask(m) {
  if (!m || !m.length) return null;
  const terms = m.map(t => {
    const k = t[0];
    if (k === 'ax') { const ax = t[1], a = t[2], b = t[3]; return (x, y, z) => sst(a, b, ax === 0 ? x : ax === 1 ? y : z); }
    if (k === 'sph') { const [cx, cy, cz] = t[1], r0 = t[2], r1 = t[3]; return (x, y, z) => 1 - sst(r0, r1, Math.hypot(x - cx, y - cy, z - cz)); }
    if (k === 'n') { const f = t[1], lo = t[2], hi = t[3], P = perm(t[4] || 1); return (x, y, z) => sst(lo, hi, 0.5 + 0.5 * fbm3(P, x * f, y * f, z * f, 3)); }
    if (k === 'rad') { const lo = t[1], hi = t[2]; return (x, y, z) => sst(lo, hi, Math.hypot(x, z)); }
    return null;                                   // bake-only terms: 1 here
  }).filter(Boolean);
  if (!terms.length) return null;
  return (x, y, z) => { let v = 1; for (let i = 0; i < terms.length && v > 0; i++) v *= terms[i](x, y, z); return v; };
}

// ---------------------------------------------------------------- compile
// Internal node: { bb, f(x,y,z), kids?, make(kidFns) -> f, xfBox?(box) -> kid box }
function leaf(bb, f) { return { bb, f, leaf: true }; }

// forMesh: layers flagged bake: true are left out (the low-poly's field)
let FOR_MESH = false;
export function compile(spec, forMesh = false) {
  FOR_MESH = forMesh;
  try { return node(spec); } finally { FOR_MESH = false; }
}

function node(s) {
  const m = s.m | 0;
  switch (s.t) {
    case 'sphere': {
      const [cx, cy, cz] = s.c, r = s.r;
      return leaf([cx - r, cy - r, cz - r, cx + r, cy + r, cz + r], (x, y, z) => { MA = MB = m; MW = 0; return Math.hypot(x - cx, y - cy, z - cz) - r; });
    }
    case 'ellip': {
      const [cx, cy, cz] = s.c, [rx, ry, rz] = s.r, R = s.R || eulerMat(s.e);
      const ix = 1 / rx, iy = 1 / ry, iz = 1 / rz, ix2 = ix * ix, iy2 = iy * iy, iz2 = iz * iz;
      return leaf(bbOfRotated(R, rx, ry, rz, cx, cy, cz, 0), (x, y, z) => {
        MA = MB = m; MW = 0;
        const px = x - cx, py = y - cy, pz = z - cz;
        const lx = R[0] * px + R[3] * py + R[6] * pz, ly = R[1] * px + R[4] * py + R[7] * pz, lz = R[2] * px + R[5] * py + R[8] * pz;
        const k0 = Math.sqrt(lx * lx * ix2 + ly * ly * iy2 + lz * lz * iz2), k1 = Math.sqrt(lx * lx * ix2 * ix2 + ly * ly * iy2 * iy2 + lz * lz * iz2 * iz2);
        return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
      });
    }
    case 'box': {
      const [cx, cy, cz] = s.c, rr = s.r || 0, hx = s.h[0] - rr, hy = s.h[1] - rr, hz = s.h[2] - rr, R = s.R || eulerMat(s.e);
      return leaf(bbOfRotated(R, s.h[0], s.h[1], s.h[2], cx, cy, cz, 0), (x, y, z) => {
        MA = MB = m; MW = 0;
        const px = x - cx, py = y - cy, pz = z - cz;
        const qx = Math.abs(R[0] * px + R[3] * py + R[6] * pz) - hx, qy = Math.abs(R[1] * px + R[4] * py + R[7] * pz) - hy, qz = Math.abs(R[2] * px + R[5] * py + R[8] * pz) - hz;
        const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
        const inn = Math.max(qx, qy, qz);
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + (inn < 0 ? inn : 0) - rr;
      });
    }
    case 'cap': {
      const [ax, ay, az] = s.a, [bx, by, bz] = s.b, r1 = s.ra != null ? s.ra : s.r, r2 = s.rb != null ? s.rb : s.r;
      const bbx = bx - ax, bby = by - ay, bbz = bz - az, l2 = bbx * bbx + bby * bby + bbz * bbz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
      const rm = Math.max(r1, r2);
      const bb = [Math.min(ax, bx) - rm, Math.min(ay, by) - rm, Math.min(az, bz) - rm, Math.max(ax, bx) + rm, Math.max(ay, by) + rm, Math.max(az, bz) + rm];
      return leaf(bb, (x, y, z) => {
        MA = MB = m; MW = 0;
        const pax = x - ax, pay = y - ay, paz = z - az;
        const yy = pax * bbx + pay * bby + paz * bbz, zz = yy - l2;
        const qx = pax * l2 - bbx * yy, qy = pay * l2 - bby * yy, qz = paz * l2 - bbz * yy;
        const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
        const k = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
        if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
        return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
      });
    }
    case 'cone': {
      const [ax, ay, az] = s.a, [bx, by, bz] = s.b, ra = s.ra, rb = s.rb;
      const rba = rb - ra, dx = bx - ax, dy = by - ay, dz = bz - az, baba = dx * dx + dy * dy + dz * dz, kk = rba * rba + baba, rm = Math.max(ra, rb);
      const bb = [Math.min(ax, bx) - rm, Math.min(ay, by) - rm, Math.min(az, bz) - rm, Math.max(ax, bx) + rm, Math.max(ay, by) + rm, Math.max(az, bz) + rm];
      return leaf(bb, (x, y, z) => {
        MA = MB = m; MW = 0;
        const px = x - ax, py = y - ay, pz = z - az, papa = px * px + py * py + pz * pz, paba = (px * dx + py * dy + pz * dz) / baba;
        const xx = Math.sqrt(Math.max(0, papa - paba * paba * baba));
        const cax = Math.max(0, xx - (paba < 0.5 ? ra : rb)), cay = Math.abs(paba - 0.5) - 0.5;
        const f = clamp01((rba * (xx - ra) + paba * baba) / kk);
        const cbx = xx - ra - f * rba, cby = paba - f;
        const sg = (cbx < 0 && cay < 0) ? -1 : 1;
        return sg * Math.sqrt(Math.min(cax * cax + cay * cay * baba, cbx * cbx + cby * cby * baba));
      });
    }
    case 'torus': {
      const [cx, cy, cz] = s.c, RR = s.R, r = s.r, R = s.rot || eulerMat(s.e);
      return leaf(bbOfRotated(R, RR + r, r, RR + r, cx, cy, cz, 0), (x, y, z) => {
        MA = MB = m; MW = 0;
        const px = x - cx, py = y - cy, pz = z - cz;
        const lx = R[0] * px + R[3] * py + R[6] * pz, ly = R[1] * px + R[4] * py + R[7] * pz, lz = R[2] * px + R[5] * py + R[8] * pz;
        const q = Math.hypot(lx, lz) - RR;
        return Math.hypot(q, ly) - r;
      });
    }
    case 'plane': {
      const [nx, ny, nz] = s.n, o = s.o || 0, l = Math.hypot(nx, ny, nz);
      return leaf([-FAR, -FAR, -FAR, FAR, FAR, FAR], (x, y, z) => { MA = MB = m; MW = 0; return (x * nx + y * ny + z * nz) / l - o; });
    }
    case 'tube': {
      // bezier (3 or 4 control points) sampled into round-cone segments, hard union
      const P = s.p, n = s.n || 8, kids = [];
      const at = t => {
        const u = 1 - t;
        if (P.length === 3) return [0, 1, 2].map(i => u * u * P[0][i] + 2 * u * t * P[1][i] + t * t * P[2][i]);
        return [0, 1, 2].map(i => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]);
      };
      const rad = t => s.rr ? s.rr[Math.min(s.rr.length - 1, Math.round(t * (s.rr.length - 1)))] : s.r[0] + (s.r[1] - s.r[0]) * t;
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        kids.push({ t: 'cap', a: at(t0), b: at(t1), ra: rad(t0), rb: rad(t1), m });
      }
      return node({ t: 'u', k: 0, ch: kids });
    }
    case 'u': case 'i': {
      const kids = s.ch.map(node), k = s.k || 0, inter = s.t === 'i';
      let bb = kids[0].bb;
      for (let i = 1; i < kids.length; i++) bb = inter ? [Math.max(bb[0], kids[i].bb[0]), Math.max(bb[1], kids[i].bb[1]), Math.max(bb[2], kids[i].bb[2]), Math.min(bb[3], kids[i].bb[3]), Math.min(bb[4], kids[i].bb[4]), Math.min(bb[5], kids[i].bb[5])] : bbUnion(bb, kids[i].bb);
      const make = fns => inter ? makeInter(fns, k) : makeUnion(fns, k);
      const n = { bb: inter ? bb : bbGrow(bb, k * 0.25), kids, k, kind: s.t, make };
      n.f = make(kids.map(c => c.f));
      return n;
    }
    case 's': {
      const kids = s.ch.map(node), k = s.k || 0, cm = s.m != null ? m : -1;
      const make = fns => makeSub(fns, k, cm);
      const n = { bb: kids[0].bb, kids, k, kind: 's', make };
      n.f = make(kids.map(c => c.f));
      return n;
    }
    case 'xf': {
      const kid = node(s.ch[0]), R = s.R || eulerMat(s.e), [px, py, pz] = s.p || [0, 0, 0], sc = s.s || 1, is = 1 / sc;
      const toWorld = b => {       // kid bb (local) -> world bb
        const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2, hx = (b[3] - b[0]) / 2, hy = (b[4] - b[1]) / 2, hz = (b[5] - b[2]) / 2;
        const wx = px + sc * (R[0] * cx + R[1] * cy + R[2] * cz), wy = py + sc * (R[3] * cx + R[4] * cy + R[5] * cz), wz = pz + sc * (R[6] * cx + R[7] * cy + R[8] * cz);
        return bbOfRotated(R, hx * sc, hy * sc, hz * sc, wx, wy, wz, 0);
      };
      const toLocal = b => {       // world box -> local bb (R^T)
        const cx = (b[0] + b[3]) / 2 - px, cy = (b[1] + b[4]) / 2 - py, cz = (b[2] + b[5]) / 2 - pz, hx = (b[3] - b[0]) / 2, hy = (b[4] - b[1]) / 2, hz = (b[5] - b[2]) / 2;
        const RT = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
        const lx = is * (RT[0] * cx + RT[1] * cy + RT[2] * cz), ly = is * (RT[3] * cx + RT[4] * cy + RT[5] * cz), lz = is * (RT[6] * cx + RT[7] * cy + RT[8] * cz);
        return bbOfRotated(RT, hx * is, hy * is, hz * is, lx, ly, lz, 0);
      };
      const make = ([f]) => (x, y, z) => {
        const qx = x - px, qy = y - py, qz = z - pz;
        return sc * f(is * (R[0] * qx + R[3] * qy + R[6] * qz), is * (R[1] * qx + R[4] * qy + R[7] * qz), is * (R[2] * qx + R[5] * qy + R[8] * qz));
      };
      const n = { bb: toWorld(kid.bb), kids: [kid], kind: 'xf', make, kidBox: toLocal };
      n.f = make([kid.f]);
      return n;
    }
    case 'mir': {
      const kid = node(s.ch[0]), ax = s.ax | 0;
      const b = kid.bb.slice();
      const lo = Math.min(b[ax], -b[ax + 3]), hi = Math.max(b[ax + 3], -b[ax]);
      b[ax] = lo; b[ax + 3] = hi;
      const make = ([f]) => ax === 0 ? (x, y, z) => f(Math.abs(x), y, z) : ax === 1 ? (x, y, z) => f(x, Math.abs(y), z) : (x, y, z) => f(x, y, Math.abs(z));
      const kidBox = w => { const o = w.slice(); const a = w[ax], c = w[ax + 3]; o[ax] = a > 0 ? a : c < 0 ? -c : 0; o[ax + 3] = Math.max(Math.abs(a), Math.abs(c)); return o; };
      const n = { bb: b, kids: [kid], kind: 'mir', make, kidBox };
      n.f = make([kid.f]);
      return n;
    }
    case 'warp': {
      const kid = node(s.ch[0]), amp = s.amp, f = s.f, oct = s.oct || 2, P1 = perm(s.seed || 1), P2 = perm((s.seed || 1) + 1), P3 = perm((s.seed || 1) + 2);
      const mask = compileMask(s.mask);
      const make = ([g]) => (x, y, z) => {
        const k = mask ? mask(x, y, z) : 1;
        if (k <= 0) return g(x, y, z);
        const a = amp * k;
        return g(x + a * fbm3(P1, x * f, y * f, z * f, oct), y + a * fbm3(P2, x * f, y * f, z * f, oct), z + a * fbm3(P3, x * f, y * f, z * f, oct));
      };
      const n = { bb: bbGrow(kid.bb, amp), kids: [kid], kind: 'warp', make, kidBox: w => bbGrow(w, amp) };
      n.f = make([kid.f]);
      return n;
    }
    case 'disp': {
      const kid = node(s.ch[0]), L = s.L.filter(l => !(FOR_MESH && l.bake)).map(compileLayer);
      if (!L.length) return kid;
      let amax = 0;
      for (const l of L) amax += l.amax;
      const make = ([g]) => (x, y, z) => {
        const d = g(x, y, z);
        if (d > amax * 1.5 + 0.02 || d < -amax * 1.5 - 0.02) return d;   // far from the skin
        const ma = MA, mb = MB, mw = MW;
        let o = 0;
        for (let i = 0; i < L.length; i++) o += L[i].f(x, y, z);
        MA = ma; MB = mb; MW = mw;
        return d - o;
      };
      const n = { bb: bbGrow(kid.bb, amax), kids: [kid], kind: 'disp', make, kidBox: w => bbGrow(w, amax) };
      n.f = make([kid.f]);
      return n;
    }
    case 'erode': {
      const kid = node(s.ch[0]), amt = s.amt, r = s.r, mask = compileMask(s.mask), ir2 = 1 / (r * r);
      const make = ([g]) => (x, y, z) => {
        const d = g(x, y, z);
        if (d > 2 * r || d < -2 * r) return d;
        const k = mask ? mask(x, y, z) : 1;
        if (k <= 0) return d;
        const ma = MA, mb = MB, mw = MW;
        const lap = (g(x + r, y, z) + g(x - r, y, z) + g(x, y + r, z) + g(x, y - r, z) + g(x, y, z + r) + g(x, y, z - r) - 6 * d) * ir2;
        MA = ma; MB = mb; MW = mw;
        // convex edges (positive laplacian of the distance) wear away
        return d + amt * k * sst(0, 1, lap * r * 0.5);
      };
      const n = { bb: kid.bb, kids: [kid], kind: 'erode', make, kidBox: w => bbGrow(w, r) };
      n.f = make([kid.f]);
      return n;
    }
    case 'round': {
      const kid = node(s.ch[0]), r = s.r;
      const make = ([g]) => (x, y, z) => g(x, y, z) - r;
      const n = { bb: bbGrow(kid.bb, r), kids: [kid], kind: 'round', make, kidBox: w => bbGrow(w, r) };
      n.f = make([kid.f]);
      return n;
    }
  }
  throw new Error('sculpt: unknown node ' + s.t);
}

function makeUnion(fns, k) {
  const n = fns.length;
  if (n === 1) return fns[0];
  if (k <= 0) return (x, y, z) => {
    let d = fns[0](x, y, z), a = MA, b = MB, w = MW;
    for (let i = 1; i < n; i++) { const e = fns[i](x, y, z); if (e < d) { d = e; a = MA; b = MB; w = MW; } }
    MA = a; MB = b; MW = w;
    return d;
  };
  const ik = 1 / k;
  return (x, y, z) => {
    let d = fns[0](x, y, z), a = MA, b = MB, w = MW;
    for (let i = 1; i < n; i++) {
      const e = fns[i](x, y, z), diff = e - d;
      if (diff >= k) continue;
      const ea = MA;
      if (-diff >= k) { d = e; a = ea; b = MB; w = MW; continue; }
      const h = 0.5 + 0.5 * diff * ik;           // weight of the running result
      const hh = Math.max(k - Math.abs(diff), 0) * ik;
      d = Math.min(d, e) - hh * hh * k * 0.25;
      if (h >= 0.5) { b = ea; w = 1 - h; } else { b = a; a = ea; w = h; }
    }
    MA = a; MB = b; MW = w;
    return d;
  };
}
function makeInter(fns, k) {
  const n = fns.length;
  if (n === 1) return fns[0];
  return (x, y, z) => {
    let d = fns[0](x, y, z), a = MA, b = MB, w = MW;
    for (let i = 1; i < n; i++) {
      const e = fns[i](x, y, z);
      if (k <= 0) { if (e > d) { d = e; } continue; }
      const hh = Math.max(k - Math.abs(d - e), 0) / k;
      d = Math.max(d, e) + hh * hh * k * 0.25;
    }
    MA = a; MB = b; MW = w;
    return d;
  };
}
function makeSub(fns, k, cm) {
  const n = fns.length;
  if (n === 1) return fns[0];
  return (x, y, z) => {
    let d = fns[0](x, y, z);
    const a = MA, b = MB, w = MW;
    let cut = 0;
    for (let i = 1; i < n; i++) {
      const e = -fns[i](x, y, z);
      if (k <= 0) { if (e > d) { d = e; cut = 1; } continue; }
      const diff = e - d;
      if (diff <= -k) continue;
      if (diff >= k) { d = e; cut = 1; continue; }
      const hh = (k - Math.abs(diff)) / k;
      d = Math.max(d, e) + hh * hh * k * 0.25;
      if (diff > 0) cut = Math.max(cut, 0.5 + 0.5 * diff / k); else cut = Math.max(cut, 0.5 + 0.5 * diff / k);
    }
    MA = a; MB = b; MW = w;
    if (cm >= 0 && cut > 0) { if (cut >= 0.5) { MB = MA; MA = cm; MW = 1 - cut; } else { MB = cm; MW = cut; } }
    return d;
  };
}

// displacement layers: f(x,y,z) -> outward offset (+ raises the surface)
function compileLayer(l) {
  const amp = l.amp, f = l.f || 1, seed = l.seed || 1, P = perm(seed), mask = compileMask(l.mask), oct = l.oct || 4;
  let g, amax = Math.abs(amp);
  if (l.type === 'fbm') g = (x, y, z) => amp * fbm3(P, x * f, y * f, z * f, oct);
  else if (l.type === 'grain') g = (x, y, z) => amp * perlin(P, x * f, y * f, z * f);
  else if (l.type === 'ridged') g = (x, y, z) => amp * (ridged3(P, x * f, y * f, z * f, oct) - 0.35);
  else if (l.type === 'bands') { const [ax, ay, az] = l.ax || [0, 0, 1]; g = (x, y, z) => amp * Math.sin((x * ax + y * ay + z * az) * f + 1.3 * perlin(P, x * 3, y * 3, z * 3)); }
  else if (l.type === 'barn' || l.type === 'pits') {
    // every populated feature in the 27 surrounding cells contributes its own profile and
    // the contributions SUM: a nearest-feature (F1) form switches cells discontinuously
    // and the bake's gradient turns every such border into a black speck
    const barn = l.type === 'barn', dens = l.dens != null ? l.dens : barn ? 0.5 : 0.4, pr = l.r || 0.3;
    amax = Math.abs(amp) * (barn ? 1.6 : 1.2);
    g = (x, y, z) => {
      x *= f; y *= f; z *= f;
      const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      let o = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = X + dx, cy = Y + dy, cz = Z + dz, id = hash3(cx, cy, cz, seed + 307);
        if (id > dens) continue;
        const ex = cx + hash3(cx, cy, cz, seed) - x, ey = cy + hash3(cx, cy, cz, seed + 101) - y, ez = cz + hash3(cx, cy, cz, seed + 211) - z;
        const r = Math.sqrt(ex * ex + ey * ey + ez * ez), q = id / Math.max(1e-6, dens);
        if (barn) {
          const sz = 0.26 + 0.2 * hash3(cx, cy, cz, seed + 401);           // radius, cell units
          const t = r / sz;
          if (t >= 1.12) continue;
          const flute = 1 + 0.10 * Math.cos(Math.atan2(ey, ex) * 6 + q * 40);
          const c = Math.max(0, 1 - t * flute), cone = sst(0, 0.55, c) * (0.55 + 0.45 * c);
          const crater = 1 - sst(0.16, 0.40, t);
          o += amp * (0.7 + 0.3 * q) * (cone * (1 - 0.9 * crater) - 0.5 * crater);
        } else {
          const rr = pr * (0.6 + 0.8 * q), t = r / rr;
          if (t >= 1.4) continue;
          o += -amp * (1 - sst(0.55, 1.0, t)) + 0.25 * amp * (sst(0.9, 1.05, t) * (1 - sst(1.05, 1.4, t)));
        }
      }
      return o;
    };
  } else if (l.type === 'cracks') {
    const wd = l.w || 0.04, heal = l.heal || 0, Pw = perm(seed + 9);
    g = (x, y, z) => {
      // warped cell borders: F2 - F1 small is a crack
      const wx = x * f + 0.35 * perlin(Pw, x * f * 2, y * f * 2, z * f * 2), wy = y * f + 0.35 * perlin(Pw, y * f * 2 + 5, z * f * 2, x * f * 2), wz = z * f + 0.35 * perlin(Pw, z * f * 2, x * f * 2 + 9, y * f * 2);
      const w = worley(wx, wy, wz, seed), e = w.f2 - w.f1;
      if (e > wd * 3.5) return 0;
      const crack = 1 - sst(0, wd, e);
      const callus = heal ? sst(wd * 0.6, wd * 1.4, e) * (1 - sst(wd * 1.6, wd * 3.4, e)) : 0;
      return -amp * crack + heal * amp * callus;
    };
    amax = Math.abs(amp) * (1 + heal);
  } else throw new Error('sculpt: unknown layer ' + l.type);
  const fn = mask ? (x, y, z) => { const k = mask(x, y, z); return k > 0 ? k * g(x, y, z) : 0; } : g;
  return { f: fn, amax };
}

// ---------------------------------------------------------------- pruning
// A node specialised to a box: children that cannot touch the box (their bounds, grown
// by the blend radius, miss it) are dropped. Exact for the sign everywhere in the box and
// for the value wherever |d| < margin — which is all the mesher and the bake ever read.
function prune(n, box) {
  if (n.leaf) return bbHit(n.bb, box) ? n.f : null;
  if (!bbHit(n.bb, box)) return null;
  if (n.kind === 'u' || n.kind === 'i') {
    const gb = bbGrow(box, n.k);
    const fns = [];
    for (const c of n.kids) { const f = prune(c, gb); if (f) fns.push(f); else if (n.kind === 'i') return null; }
    if (!fns.length) return null;
    return n.make(fns);
  }
  if (n.kind === 's') {
    const a = prune(n.kids[0], box);
    if (!a) return null;
    const gb = bbGrow(box, n.k), fns = [a];
    for (let i = 1; i < n.kids.length; i++) { const f = prune(n.kids[i], gb); if (f) fns.push(f); }
    return fns.length === 1 ? a : n.make(fns);
  }
  const kb = n.kidBox ? n.kidBox(box) : box;
  const f = prune(n.kids[0], kb);
  return f ? n.make([f]) : null;
}

// ---------------------------------------------------------------- sparse grid
const B = 8, BC = B + 1, BC2 = BC * BC, BC3 = BC2 * BC;
function farFn() { MA = MB = 0; MW = 0; return FAR; }

function makeField(root, h, lip) {
  const pad = 3 * h;
  const bb = root.bb;
  const x0 = bb[0] - pad, y0 = bb[1] - pad, z0 = bb[2] - pad;
  const nx = Math.ceil((bb[3] + pad - x0) / h), ny = Math.ceil((bb[4] + pad - y0) / h), nz = Math.ceil((bb[5] + pad - z0) / h);
  const nbx = Math.ceil(nx / B), nby = Math.ceil(ny / B), nbz = Math.ceil(nz / B);
  const F = { root, h, lip, x0, y0, z0, nx: nbx * B, ny: nby * B, nz: nbz * B, nbx, nby, nbz, blocks: new Map(), fns: new Map(), evals: 0 };
  // lazily pruned evaluator per block (also serves points off the active band: AO rays)
  F.fnAt = (bi, bj, bk) => {
    const key = bi + nbx * (bj + nby * bk);
    let f = F.fns.get(key);
    if (f === undefined) {
      const s = B * h, m = h * 2;
      const box = [x0 + bi * s - m, y0 + bj * s - m, z0 + bk * s - m, x0 + (bi + 1) * s + m, y0 + (bj + 1) * s + m, z0 + (bk + 1) * s + m];
      f = prune(root, box) || farFn;
      F.fns.set(key, f);
    }
    return f;
  };
  F.at = (x, y, z) => {
    const s = B * h;
    let bi = Math.floor((x - x0) / s), bj = Math.floor((y - y0) / s), bk = Math.floor((z - z0) / s);
    if (bi < 0 || bj < 0 || bk < 0 || bi >= nbx || bj >= nby || bk >= nbz) return root.f(x, y, z);
    F.evals++;
    return F.fnAt(bi, bj, bk)(x, y, z);
  };
  return F;
}

// Evaluate every block that can hold surface: prune, cull by the centre value against a
// Lipschitz bound, sample the 9^3 corners, keep blocks with a sign change.
function fillField(F) {
  const { h, lip, x0, y0, z0, nbx, nby, nbz } = F, s = B * h, half = s * 0.5 * Math.sqrt(3);
  let tested = 0, kept = 0;
  for (let bk = 0; bk < nbz; bk++) for (let bj = 0; bj < nby; bj++) for (let bi = 0; bi < nbx; bi++) {
    const f = F.fnAt(bi, bj, bk);
    if (f === farFn) continue;
    tested++;
    const cx = x0 + (bi + 0.5) * s, cy = y0 + (bj + 0.5) * s, cz = z0 + (bk + 0.5) * s;
    const dc = f(cx, cy, cz);
    F.evals++;
    if (Math.abs(dc) > half * lip + h) continue;
    const v = new Float32Array(BC3);
    let pos = 0, neg = 0;
    const bx = x0 + bi * s, by = y0 + bj * s, bz = z0 + bk * s;
    for (let k = 0, o = 0; k < BC; k++) for (let j = 0; j < BC; j++) for (let i = 0; i < BC; i++, o++) {
      const d = f(bx + i * h, by + j * h, bz + k * h);
      v[o] = d;
      if (d < 0) neg++; else pos++;
    }
    F.evals += BC3;
    if (!neg || !pos) continue;
    F.blocks.set(bi + nbx * (bj + nby * bk), { bi, bj, bk, v, f });
    kept++;
  }
  F.tested = tested; F.kept = kept;
  return F;
}

// ---------------------------------------------------------------- mesher
// Surface nets topology (one vertex per sign-changing cell, a quad per sign-changing edge);
// vertex placement either the crossings' mass point ('nets') or the dual-contouring QEF
// ('dc': minimise the squared distance to every crossing's tangent plane, regularised
// toward the mass point and clamped to the cell), with Hermite normals from the SDF.
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const COFF = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const TET = [[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]];
const G = { d: 0, x: 0, y: 0, z: 0, s: 0 };
function tetra(f, x, y, z, e) {
  const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
  let gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  G.x = gx / l; G.y = gy / l; G.z = gz / l; G.d = (a + b + c + d) * 0.25; G.s = a + b + c + d;
  return G;
}

function meshField(F, mode) {
  const { h, x0, y0, z0, nx, ny } = F;
  const vid = new Map();
  const pos = [];
  const cellKey = (gx, gy, gz) => gx + nx * (gy + ny * gz);
  const cv = new Float32Array(8);
  for (const b of F.blocks.values()) {
    const { bi, bj, bk, v, f } = b;
    for (let k = 0; k < B; k++) for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const o = (i + COFF[c][0]) + BC * (j + COFF[c][1]) + BC2 * (k + COFF[c][2]);
        cv[c] = v[o];
        if (v[o] < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      const gx = bi * B + i, gy = bj * B + j, gz = bk * B + k;
      const cx = x0 + gx * h, cy = y0 + gy * h, cz = z0 + gz * h;
      let mx = 0, my = 0, mz = 0, cnt = 0;
      let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0, b0 = 0, b1 = 0, b2 = 0;
      const px = [], py = [], pz = [], nn = [];
      for (const [e0, e1] of EDGES) {
        const va = cv[e0], vb = cv[e1];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        const qx = cx + h * (COFF[e0][0] + t * (COFF[e1][0] - COFF[e0][0]));
        const qy = cy + h * (COFF[e0][1] + t * (COFF[e1][1] - COFF[e0][1]));
        const qz = cz + h * (COFF[e0][2] + t * (COFF[e1][2] - COFF[e0][2]));
        mx += qx; my += qy; mz += qz; cnt++;
        if (mode === 'dc') { px.push(qx); py.push(qy); pz.push(qz); }
      }
      mx /= cnt; my /= cnt; mz /= cnt;
      let vx = mx, vy = my, vz = mz;
      if (mode === 'dc') {
        for (let q = 0; q < px.length; q++) {
          const g = tetra(f, px[q], py[q], pz[q], h * 0.25);
          F.evals += 4;
          const nX = g.x, nY = g.y, nZ = g.z, dd = nX * (px[q] - mx) + nY * (py[q] - my) + nZ * (pz[q] - mz);
          a00 += nX * nX; a01 += nX * nY; a02 += nX * nZ; a11 += nY * nY; a12 += nY * nZ; a22 += nZ * nZ;
          b0 += nX * dd; b1 += nY * dd; b2 += nZ * dd;
        }
        const lam = 0.05 * px.length;
        const m00 = a00 + lam, m11 = a11 + lam, m22 = a22 + lam;
        const det = m00 * (m11 * m22 - a12 * a12) - a01 * (a01 * m22 - a12 * a02) + a02 * (a01 * a12 - m11 * a02);
        if (Math.abs(det) > 1e-12) {
          const i00 = (m11 * m22 - a12 * a12) / det, i01 = (a02 * a12 - a01 * m22) / det, i02 = (a01 * a12 - a02 * m11) / det;
          const i11 = (m00 * m22 - a02 * a02) / det, i12 = (a01 * a02 - m00 * a12) / det, i22 = (m00 * m11 - a01 * a01) / det;
          const dx = i00 * b0 + i01 * b1 + i02 * b2, dy = i01 * b0 + i11 * b1 + i12 * b2, dz = i02 * b0 + i12 * b1 + i22 * b2;
          const sl = h * 0.08;
          vx = Math.min(cx + h + sl, Math.max(cx - sl, mx + dx));
          vy = Math.min(cy + h + sl, Math.max(cy - sl, my + dy));
          vz = Math.min(cz + h + sl, Math.max(cz - sl, mz + dz));
        }
      }
      vid.set(cellKey(gx, gy, gz), pos.length / 3);
      pos.push(vx, vy, vz);
    }
  }
  // quads: every sign-changing edge leaving a cell's min corner along +x/+y/+z
  const idx = [];
  const P = pos;
  const tri = (a, b, c) => idx.push(a, b, c);
  for (const b of F.blocks.values()) {
    const { bi, bj, bk, v } = b;
    for (let k = 0; k < B; k++) for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const gx = bi * B + i, gy = bj * B + j, gz = bk * B + k;
      if (!vid.has(cellKey(gx, gy, gz))) continue;
      const v0 = v[i + BC * j + BC2 * k];
      for (let ax = 0; ax < 3; ax++) {
        const v1 = v[(i + (ax === 0)) + BC * (j + (ax === 1)) + BC2 * (k + (ax === 2))];
        if ((v0 < 0) === (v1 < 0)) continue;
        // the four cells round this edge
        let c1, c2, c3;
        if (ax === 0) { c1 = cellKey(gx, gy - 1, gz); c2 = cellKey(gx, gy - 1, gz - 1); c3 = cellKey(gx, gy, gz - 1); }
        else if (ax === 1) { c1 = cellKey(gx - 1, gy, gz); c2 = cellKey(gx - 1, gy, gz - 1); c3 = cellKey(gx, gy, gz - 1); }
        else { c1 = cellKey(gx - 1, gy, gz); c2 = cellKey(gx - 1, gy - 1, gz); c3 = cellKey(gx, gy - 1, gz); }
        const A = vid.get(cellKey(gx, gy, gz)), Bv = vid.get(c1), C = vid.get(c2), D = vid.get(c3);
        if (Bv === undefined || C === undefined || D === undefined) continue;
        // orient: the face normal must point from inside (v < 0) to outside
        const sgn = v0 < 0 ? 1 : -1;
        // split along the shorter diagonal
        const dAC = (P[A * 3] - P[C * 3]) ** 2 + (P[A * 3 + 1] - P[C * 3 + 1]) ** 2 + (P[A * 3 + 2] - P[C * 3 + 2]) ** 2;
        const dBD = (P[Bv * 3] - P[D * 3]) ** 2 + (P[Bv * 3 + 1] - P[D * 3 + 1]) ** 2 + (P[Bv * 3 + 2] - P[D * 3 + 2]) ** 2;
        const t0 = idx.length;
        if (dAC <= dBD) { tri(A, Bv, C); tri(A, C, D); } else { tri(A, Bv, D); tri(Bv, C, D); }
        // check the winding against the edge direction on the first triangle
        const a = idx[t0], bb = idx[t0 + 1], c = idx[t0 + 2];
        const ux = P[bb * 3] - P[a * 3], uy = P[bb * 3 + 1] - P[a * 3 + 1], uz = P[bb * 3 + 2] - P[a * 3 + 2];
        const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
        const nrm = ax === 0 ? uy * wz - uz * wy : ax === 1 ? uz * wx - ux * wz : ux * wy - uy * wx;
        if (nrm * sgn < 0) for (let q = t0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
      }
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

// ---------------------------------------------------------------- QEM decimation
// Garland-Heckbert edge collapse: a quadric per vertex (sum of its faces' planes, area-
// weighted), the cheapest edge collapses first to the point minimising the quadric; a
// collapse is refused if it flips a neighbouring face, crushes one to a sliver, or breaks
// the link condition (would pinch the surface non-manifold). Stale heap entries are
// skipped by a per-vertex stamp.
function decimate(pos, idx, target, maxErr) {
  const nv = pos.length / 3, nf = idx.length / 3;
  if (!target || nf <= target) return { pos, idx };
  const P = new Float64Array(pos);
  const Q = new Float64Array(nv * 10);
  const F = new Int32Array(idx);
  const alive = new Uint8Array(nf).fill(1);
  const vf = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nf; f++) {
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    vf[a].push(f); vf[b].push(f); vf[c].push(f);
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-20) continue;
    const area = l * 0.5;
    nx /= l; ny /= l; nz /= l;
    const d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
    for (const v of [a, b, c]) {
      const o = v * 10;
      Q[o] += area * nx * nx; Q[o + 1] += area * nx * ny; Q[o + 2] += area * nx * nz; Q[o + 3] += area * nx * d;
      Q[o + 4] += area * ny * ny; Q[o + 5] += area * ny * nz; Q[o + 6] += area * ny * d;
      Q[o + 7] += area * nz * nz; Q[o + 8] += area * nz * d; Q[o + 9] += area * d * d;
    }
  }
  // total quadric weight per vertex normalises the error to a distance^2
  const stamp = new Int32Array(nv), removed = new Uint8Array(nv);
  const heap = [];   // entries: [cost, a, b, sa, sb, x, y, z]
  const hpush = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } };
  const hpop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m; } } return top; };
  const qsum = new Float64Array(10);
  const cost = (a, b) => {
    for (let k = 0; k < 10; k++) qsum[k] = Q[a * 10 + k] + Q[b * 10 + k];
    const q = qsum;
    const A00 = q[0], A01 = q[1], A02 = q[2], A11 = q[4], A12 = q[5], A22 = q[7];
    const det = A00 * (A11 * A22 - A12 * A12) - A01 * (A01 * A22 - A12 * A02) + A02 * (A01 * A12 - A11 * A02);
    let x, y, z;
    const mx = (P[a * 3] + P[b * 3]) / 2, my = (P[a * 3 + 1] + P[b * 3 + 1]) / 2, mz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
    if (Math.abs(det) > 1e-14) {
      const i00 = (A11 * A22 - A12 * A12) / det, i01 = (A02 * A12 - A01 * A22) / det, i02 = (A01 * A12 - A02 * A11) / det;
      const i11 = (A00 * A22 - A02 * A02) / det, i12 = (A01 * A02 - A00 * A12) / det, i22 = (A00 * A11 - A01 * A01) / det;
      x = -(i00 * q[3] + i01 * q[6] + i02 * q[8]); y = -(i01 * q[3] + i11 * q[6] + i12 * q[8]); z = -(i02 * q[3] + i12 * q[6] + i22 * q[8]);
      // never let the optimum wander off the edge's neighbourhood
      const el = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
      if (Math.hypot(x - mx, y - my, z - mz) > el) { x = mx; y = my; z = mz; }
    } else { x = mx; y = my; z = mz; }
    const e = q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
    return [Math.max(0, e), a, b, stamp[a], stamp[b], x, y, z];
  };
  const area = new Float64Array(nv);        // quadric area sum per vertex, for normalising
  for (let v = 0; v < nv; v++) area[v] = Q[v * 10] + Q[v * 10 + 4] + Q[v * 10 + 7];
  const seen = new Set();
  for (let f = 0; f < nf; f++) for (let e = 0; e < 3; e++) {
    const a = F[f * 3 + e], b = F[f * 3 + (e + 1) % 3], key = a < b ? a * nv + b : b * nv + a;
    if (seen.has(key)) continue;
    seen.add(key);
    hpush(cost(a, b));
  }
  let faces = nf;
  const maxE2 = maxErr * maxErr;
  const nbr = new Set(), nbr2 = new Set();
  const flips = (v, other, x, y, z) => {
    for (const f of vf[v]) {
      if (!alive[f]) continue;
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a === other || b === other || c === other) continue;   // collapses away
      const pa = a === v ? null : a, pb = b === v ? null : b, pc = c === v ? null : c;
      const gx = i => i === null ? x : P[i * 3], gy = i => i === null ? y : P[i * 3 + 1], gz = i => i === null ? z : P[i * 3 + 2];
      // old normal
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
      const ox = uy * wz - uz * wy, oy = uz * wx - ux * wz, oz = ux * wy - uy * wx;
      const u2x = gx(pb) - gx(pa), u2y = gy(pb) - gy(pa), u2z = gz(pb) - gz(pa);
      const w2x = gx(pc) - gx(pa), w2y = gy(pc) - gy(pa), w2z = gz(pc) - gz(pa);
      const nx = u2y * w2z - u2z * w2y, ny = u2z * w2x - u2x * w2z, nz = u2x * w2y - u2y * w2x;
      const lo = Math.hypot(ox, oy, oz), ln = Math.hypot(nx, ny, nz);
      if (ln < 1e-14) return true;
      if ((ox * nx + oy * ny + oz * nz) < 0.5 * lo * ln) return true;       // > 60 degrees
      // sliver guard: area vs longest edge^2
      const e1 = u2x * u2x + u2y * u2y + u2z * u2z, e2 = w2x * w2x + w2y * w2y + w2z * w2z;
      const e3 = (w2x - u2x) ** 2 + (w2y - u2y) ** 2 + (w2z - u2z) ** 2;
      if (ln < 0.08 * Math.max(e1, e2, e3)) return true;
    }
    return false;
  };
  while (heap.length && faces > target) {
    const e = hpop();
    const [c, a, b, sa, sb, x, y, z] = e;
    if (removed[a] || removed[b] || stamp[a] !== sa || stamp[b] !== sb) continue;
    const wn = Math.max(1e-12, (area[a] + area[b]) / 3);
    if (c / wn > maxE2) break;
    // link condition: the only vertices shared by both rings are the two opposite ones
    nbr.clear(); nbr2.clear();
    for (const f of vf[a]) if (alive[f]) for (let k = 0; k < 3; k++) nbr.add(F[f * 3 + k]);
    let shared = 0, edgeFaces = 0;
    for (const f of vf[b]) if (alive[f]) {
      let hasA = false;
      for (let k = 0; k < 3; k++) { const q = F[f * 3 + k]; if (q === a) hasA = true; nbr2.add(q); }
      if (hasA) edgeFaces++;
    }
    for (const q of nbr2) if (q !== a && q !== b && nbr.has(q)) shared++;
    if (edgeFaces !== 2 || shared !== 2) continue;
    if (flips(a, b, x, y, z) || flips(b, a, x, y, z)) continue;
    // collapse b into a
    P[a * 3] = x; P[a * 3 + 1] = y; P[a * 3 + 2] = z;
    for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
    area[a] += area[b];
    for (const f of vf[b]) {
      if (!alive[f]) continue;
      let hasA = false;
      for (let k = 0; k < 3; k++) if (F[f * 3 + k] === a) hasA = true;
      if (hasA) { alive[f] = 0; faces--; continue; }
      for (let k = 0; k < 3; k++) if (F[f * 3 + k] === b) F[f * 3 + k] = a;
      vf[a].push(f);
    }
    vf[a] = vf[a].filter(f => alive[f]);
    removed[b] = 1;
    // only a's quadric and position moved: its edges are requeued, every other entry in
    // the heap is still exact (its validity is re-checked when it pops anyway)
    stamp[a]++;
    const ring = new Set();
    for (const f of vf[a]) for (let k = 0; k < 3; k++) { const q = F[f * 3 + k]; if (q !== a) ring.add(q); }
    for (const q of ring) hpush(cost(a, q));
  }
  // compact
  const remap = new Int32Array(nv).fill(-1);
  const op = [], oi = [];
  for (let f = 0; f < nf; f++) {
    if (!alive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      if (remap[v] < 0) { remap[v] = op.length / 3; op.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
      oi.push(remap[v]);
    }
  }
  return { pos: new Float32Array(op), idx: new Uint32Array(oi) };
}

// ---------------------------------------------------------------- charts + atlas
// Charts: faces grouped by the dominant axis of a SMOOTHED normal (so bumps do not shred
// the charts), grown as connected regions, each projected orthographically along its
// axis. A face that would overlap its own chart in UV (a plate over the shell it grows
// from) is evicted and seeds a later chart. Charts are shelf-packed into the atlas at one
// texel density (binary-searched to fill it) with a gutter; the vertices are split per
// chart, so every chart border is a UV seam the bake pads across.
function faceNormals(pos, idx) {
  const nf = idx.length / 3, N = new Float32Array(nf * 3), A = new Float32Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    N[f * 3] = nx / l; N[f * 3 + 1] = ny / l; N[f * 3 + 2] = nz / l; A[f] = l * 0.5;
  }
  return { N, A };
}
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// projection basis per axis: (U, V) with U x V = axis (so the chart is not mirrored)
const UVB = [[[0, 0, -1], [0, 1, 0]], [[0, 0, 1], [0, 1, 0]], [[1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, 0, 1]], [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]]];

function chartMesh(pos, idx, texel) {
  const nf = idx.length / 3, nv = pos.length / 3;
  const { N, A } = faceNormals(pos, idx);
  // face adjacency by shared edge
  const edgeMap = new Map(), adj = new Int32Array(nf * 3).fill(-1);
  for (let f = 0; f < nf; f++) for (let e = 0; e < 3; e++) {
    const a = idx[f * 3 + e], b = idx[f * 3 + (e + 1) % 3], key = a < b ? a * nv + b : b * nv + a;
    const o = edgeMap.get(key);
    if (o === undefined) edgeMap.set(key, f * 3 + e);
    else { adj[f * 3 + e] = (o / 3) | 0; adj[o] = f; }
  }
  // smooth the normals over the adjacency (area-weighted), a few passes
  let S = new Float32Array(N), T2 = new Float32Array(N.length);
  for (let it = 0; it < 4; it++) {
    for (let f = 0; f < nf; f++) {
      let x = S[f * 3] * A[f], y = S[f * 3 + 1] * A[f], z = S[f * 3 + 2] * A[f];
      for (let e = 0; e < 3; e++) { const g = adj[f * 3 + e]; if (g >= 0) { x += S[g * 3] * A[g]; y += S[g * 3 + 1] * A[g]; z += S[g * 3 + 2] * A[g]; } }
      const l = Math.hypot(x, y, z) || 1;
      T2[f * 3] = x / l; T2[f * 3 + 1] = y / l; T2[f * 3 + 2] = z / l;
    }
    const t = S; S = T2; T2 = t;
  }
  const axisOf = new Int8Array(nf);
  for (let f = 0; f < nf; f++) {
    let best = 0, bv = -9;
    for (let k = 0; k < 6; k++) { const v = S[f * 3] * AXES[k][0] + S[f * 3 + 1] * AXES[k][1] + S[f * 3 + 2] * AXES[k][2]; if (v > bv) { bv = v; best = k; } }
    // the TRUE normal must still face the axis, or the projection folds
    if (N[f * 3] * AXES[best][0] + N[f * 3 + 1] * AXES[best][1] + N[f * 3 + 2] * AXES[best][2] < 0.15) {
      bv = -9;
      for (let k = 0; k < 6; k++) { const v = N[f * 3] * AXES[k][0] + N[f * 3 + 1] * AXES[k][1] + N[f * 3 + 2] * AXES[k][2]; if (v > bv) { bv = v; best = k; } }
    }
    axisOf[f] = best;
  }
  const chartOf = new Int32Array(nf).fill(-1);
  const charts = [];
  // coverage grid for overlap tests, in texel-ish units
  const cell = texel * 2;
  // evicted faces go back to unassigned; sweep until every face has a chart
  let pending = true;
  while (pending) {
  pending = false;
  for (let seed = 0; seed < nf; seed++) {
    if (chartOf[seed] >= 0) continue;
    pending = true;
    const ax = axisOf[seed], [U, V] = UVB[ax], id = charts.length, AX = AXES[ax];
    const cov = new Map();
    const faces = [];
    const queue = [seed];
    chartOf[seed] = id;
    const pu = i => pos[i * 3] * U[0] + pos[i * 3 + 1] * U[1] + pos[i * 3 + 2] * U[2];
    const pv = i => pos[i * 3] * V[0] + pos[i * 3 + 1] * V[1] + pos[i * 3 + 2] * V[2];
    for (let qi = 0; qi < queue.length; qi++) {
      const f = queue[qi];
      // rasterise the face's projection into the coverage grid (cell centres strictly inside)
      const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
      const ua = pu(a) / cell, va = pv(a) / cell, ub = pu(b) / cell, vb = pv(b) / cell, uc = pu(c) / cell, vc = pv(c) / cell;
      const area2 = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
      let clash = 0;
      const cells = [];
      if (Math.abs(area2) > 1e-9) {
        const i0 = Math.floor(Math.min(ua, ub, uc)), i1 = Math.ceil(Math.max(ua, ub, uc)), j0 = Math.floor(Math.min(va, vb, vc)), j1 = Math.ceil(Math.max(va, vb, vc));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = i + 0.5, y = j + 0.5;
          const w0 = ((ub - x) * (vc - y) - (uc - x) * (vb - y)) / area2, w1 = ((uc - x) * (va - y) - (ua - x) * (vc - y)) / area2, w2 = 1 - w0 - w1;
          if (w0 > 0.02 && w1 > 0.02 && w2 > 0.02) { const key = i * 73856093 ^ j * 19349663; if (cov.has(key)) clash++; cells.push(key); }
        }
      }
      if (clash > 1 || (area2 <= 0 && Math.abs(area2) > 1e-9)) {     // overlaps or folds: evict
        if (f !== seed) { chartOf[f] = -1; continue; }
      }
      for (const k of cells) cov.set(k, 1);
      faces.push(f);
      for (let e = 0; e < 3; e++) {
        const g = adj[f * 3 + e];
        // grow into same-axis faces, and ABSORB any neighbour that still projects cleanly
        // onto this axis (noisy borders otherwise shatter into one-face charts)
        if (g >= 0 && chartOf[g] < 0 && (axisOf[g] === ax || N[g * 3] * AX[0] + N[g * 3 + 1] * AX[1] + N[g * 3 + 2] * AX[2] > 0.3)) { chartOf[g] = id; queue.push(g); }
      }
    }
    charts.push({ ax, faces, cov });
  }
  }
  // merge the crumbs: a chart of a few faces moves face by face into any neighbouring
  // chart whose axis it projects onto without folding or overlapping
  const dotAx = (f, ax) => N[f * 3] * AXES[ax][0] + N[f * 3 + 1] * AXES[ax][1] + N[f * 3 + 2] * AXES[ax][2];
  const cellsOf = (f, ax, out) => {
    const [U, V] = UVB[ax];
    const P = i => [(pos[i * 3] * U[0] + pos[i * 3 + 1] * U[1] + pos[i * 3 + 2] * U[2]) / cell, (pos[i * 3] * V[0] + pos[i * 3 + 1] * V[1] + pos[i * 3 + 2] * V[2]) / cell];
    const [ua, va] = P(idx[f * 3]), [ub, vb] = P(idx[f * 3 + 1]), [uc, vc] = P(idx[f * 3 + 2]);
    const area2 = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
    if (area2 <= 1e-9) return false;
    out.length = 0;
    const i0 = Math.floor(Math.min(ua, ub, uc)), i1 = Math.ceil(Math.max(ua, ub, uc)), j0 = Math.floor(Math.min(va, vb, vc)), j1 = Math.ceil(Math.max(va, vb, vc));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i + 0.5, y = j + 0.5;
      const w0 = ((ub - x) * (vc - y) - (uc - x) * (vb - y)) / area2, w1 = ((uc - x) * (va - y) - (ua - x) * (vc - y)) / area2, w2 = 1 - w0 - w1;
      if (w0 > 0.02 && w1 > 0.02 && w2 > 0.02) out.push(i * 73856093 ^ j * 19349663);
    }
    return true;
  };
  const tmp = [];
  for (let pass = 0; pass < 6; pass++) {
    let moved = 0;
    for (let ci = 0; ci < charts.length; ci++) {
      const c = charts[ci];
      if (!c.faces.length || c.faces.length > 40) continue;
      for (let fi = c.faces.length - 1; fi >= 0; fi--) {
        const f = c.faces[fi];
        for (let e = 0; e < 3; e++) {
          const g = adj[f * 3 + e];
          if (g < 0) continue;
          const tc = chartOf[g];
          if (tc === ci || tc < 0 || charts[tc].faces.length <= c.faces.length) continue;
          const T = charts[tc];
          if (dotAx(f, T.ax) < 0.02 || !cellsOf(f, T.ax, tmp)) continue;
          let clash = 0;
          for (const k of tmp) if (T.cov.has(k)) clash++;
          if (clash > 1) continue;
          for (const k of tmp) T.cov.set(k, 1);
          T.faces.push(f); chartOf[f] = tc; c.faces.splice(fi, 1); moved++;
          break;
        }
      }
    }
    if (!moved) break;
  }
  for (const c of charts) delete c.cov;
  return { charts: charts.filter(c => c.faces.length), N };
}

// Build the per-part seam-split meshes with chart UVs in world units, then pack.
function packAtlas(parts, size, gutter) {
  // gather charts across parts: bounds in projected units
  const all = [];
  for (const p of parts) for (const c of p.charts.charts) {
    const [U, V] = UVB[c.ax];
    let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9;
    for (const f of c.faces) for (let k = 0; k < 3; k++) {
      const i = p.idx[f * 3 + k], u = p.pos[i * 3] * U[0] + p.pos[i * 3 + 1] * U[1] + p.pos[i * 3 + 2] * U[2], v = p.pos[i * 3] * V[0] + p.pos[i * 3 + 1] * V[1] + p.pos[i * 3 + 2] * V[2];
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    all.push({ part: p, c, U, V, u0, v0, w: u1 - u0, h: v1 - v0, x: 0, y: 0 });
  }
  const order = all.slice().sort((a, b) => b.h - a.h);
  const tryPack = dens => {
    let x = gutter, y = gutter, rowH = 0;
    for (const r of order) {
      // a crumb of a chart gets a thin gutter: a full one per crumb wasted most of the atlas
      const g = Math.max(2, Math.min(gutter, Math.ceil(Math.max(r.w, r.h) * dens / 8)));
      const w = Math.ceil(r.w * dens) + 2 * g, h = Math.ceil(r.h * dens) + 2 * g;
      if (x + w > size) { x = gutter; y += rowH; rowH = 0; }
      if (w > size) return false;
      r.x = x + g; r.y = y + g;
      x += w; rowH = Math.max(rowH, h);
      if (y + rowH > size) return false;
    }
    return true;
  };
  let area = 0;
  for (const r of all) area += r.w * r.h;
  let lo = 0, hi = size / Math.sqrt(Math.max(1e-9, area));
  while (tryPack(hi)) { lo = hi; hi *= 1.5; }
  for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (tryPack(m)) lo = m; else hi = m; }
  tryPack(lo);
  return { dens: lo, rects: all };
}

// ---------------------------------------------------------------- bake
const PAINT_DEFAULT = { mats: { 0: { c: [0.5, 0.5, 0.5], ro: 0.6 } }, layers: [], kScale: 0.03, aoAlb: 0.5 };
function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linToSrgb(c) { c = c < 0 ? 0 : c > 1 ? 1 : c; return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

function compilePaint(paint) {
  paint = Object.assign({}, PAINT_DEFAULT, paint || {});
  const mats = [];
  for (const k in paint.mats) mats[k | 0] = { c: paint.mats[k].c.map(srgbToLin), ro: paint.mats[k].ro != null ? paint.mats[k].ro : 0.6 };
  const term = t => {
    const k = t[0];
    if (k === 'cav') return s => sst(t[1], t[2], -s.k);
    if (k === 'cvx') return s => sst(t[1], t[2], s.k);
    if (k === 'ao') return s => sst(t[1], t[2], 1 - s.ao);
    if (k === 'nd') { const [dx, dy, dz] = t[1]; return s => sst(t[2], t[3], s.nx * dx + s.ny * dy + s.nz * dz); }
    if (k === 'mat') return s => (s.ma === t[1] ? 1 - s.mw : 0) + (s.mb === t[1] ? s.mw : 0);
    if (k === 'ax') return s => sst(t[2], t[3], t[1] === 0 ? s.x : t[1] === 1 ? s.y : s.z);
    if (k === 'sph') { const [cx, cy, cz] = t[1]; return s => 1 - sst(t[2], t[3], Math.hypot(s.x - cx, s.y - cy, s.z - cz)); }
    if (k === 'rad') return s => sst(t[1], t[2], Math.hypot(s.x, s.z));
    if (k === 'n') { const P = perm(t[4] || 1), f = t[1]; return s => sst(t[2], t[3], 0.5 + 0.5 * fbm3(P, s.x * f, s.y * f, s.z * f, t[5] || 4)); }
    if (k === 'wor') { const f = t[1], w = t[2], sd = t[3] || 1; return s => { const q = worley(s.x * f, s.y * f, s.z * f, sd); return 1 - sst(0, w, q.f2 - q.f1); }; }
    if (k === 'inv') { const g = term(t[1]); return s => 1 - g(s); }
    if (k === 'fn') return t[1];                   // a creature's own mask: fn(S) -> 0..1 (S: x,y,z,nx,ny,nz,k,ao,ma)
    throw new Error('sculpt: unknown mask term ' + k);
  };
  const layers = paint.layers.map(l => ({ c: l.c.map(srgbToLin), a: l.a != null ? l.a : 1, ro: l.ro, m: (l.m || []).map(term) }));
  return { mats, layers, kScale: paint.kScale, aoAlb: paint.aoAlb, fallback: mats[0] || { c: [0.2, 0.2, 0.2], ro: 0.6 } };
}

function bake(job, parts, pack, out) {
  const size = pack.size, A = job.atlas || {}, gutter = A.gutter || 4;
  const N = size * size;
  const alb = new Uint8Array(N * 4), nrm = new Uint8Array(N * 4), orm = new Uint8Array(N * 4), fill = new Uint8Array(N);
  const paint = compilePaint(A.paint);
  const aoR = (A.ao && A.ao.r) || 0.06, aoN = (A.ao && A.ao.n) || 4;
  const texelW = 1 / pack.dens;
  const eps = A.eps || texelW * 0.75, kEps = A.kEps || 0.012;
  const S = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, k: 0, ao: 1, ma: 0, mb: 0, mw: 0 };
  const col = [0, 0, 0];
  let evals = 0;
  for (const p of parts) {
    const F = p.bakeField, at = F.at, P = p.out.position, NN = p.out.normal, UV = p.out.uv, I = p.out.index;
    for (let t = 0; t < I.length; t += 3) {
      const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
      const ax = UV[i0 * 2] * size, ay = UV[i0 * 2 + 1] * size, bx = UV[i1 * 2] * size, by = UV[i1 * 2 + 1] * size, cx = UV[i2 * 2] * size, cy = UV[i2 * 2 + 1] * size;
      const area2 = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(area2) < 1e-9) continue;
      // the shader's frame for this triangle (three getTangentFrame with triangle edges)
      const e1x = P[i1 * 3] - P[i0 * 3], e1y = P[i1 * 3 + 1] - P[i0 * 3 + 1], e1z = P[i1 * 3 + 2] - P[i0 * 3 + 2];
      const e2x = P[i2 * 3] - P[i0 * 3], e2y = P[i2 * 3 + 1] - P[i0 * 3 + 1], e2z = P[i2 * 3 + 2] - P[i0 * 3 + 2];
      const du1 = (bx - ax) / size, dv1 = (by - ay) / size, du2 = (cx - ax) / size, dv2 = (cy - ay) / size;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy) + 1));
      // conservative: accept texels whose centre is within ~0.7 px of the triangle
      const la = Math.hypot(cx - bx, cy - by), lb = Math.hypot(ax - cx, ay - cy), lc = Math.hypot(bx - ax, by - ay);
      const tol0 = 0.7 * la / Math.abs(area2), tol1 = 0.7 * lb / Math.abs(area2), tol2 = 0.7 * lc / Math.abs(area2);
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const o = py * size + px;
        if (fill[o] === 2) continue;
        const X = px + 0.5, Y = py + 0.5;
        let w0 = ((bx - X) * (cy - Y) - (cx - X) * (by - Y)) / area2, w1 = ((cx - X) * (ay - Y) - (ax - X) * (cy - Y)) / area2, w2 = 1 - w0 - w1;
        const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
        if (!inside) {
          if (fill[o]) continue;
          if (w0 < -tol0 || w1 < -tol1 || w2 < -tol2) continue;
          w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2);
          const s = w0 + w1 + w2; w0 /= s; w1 /= s; w2 /= s;
        }
        let x = w0 * P[i0 * 3] + w1 * P[i1 * 3] + w2 * P[i2 * 3], y = w0 * P[i0 * 3 + 1] + w1 * P[i1 * 3 + 1] + w2 * P[i2 * 3 + 1], z = w0 * P[i0 * 3 + 2] + w1 * P[i1 * 3 + 2] + w2 * P[i2 * 3 + 2];
        let Nx = w0 * NN[i0 * 3] + w1 * NN[i1 * 3] + w2 * NN[i2 * 3], Ny = w0 * NN[i0 * 3 + 1] + w1 * NN[i1 * 3 + 1] + w2 * NN[i2 * 3 + 1], Nz = w0 * NN[i0 * 3 + 2] + w1 * NN[i1 * 3 + 2] + w2 * NN[i2 * 3 + 2];
        const nl = Math.hypot(Nx, Ny, Nz) || 1; Nx /= nl; Ny /= nl; Nz /= nl;
        // 1) onto the true surface, along the gradient (never further than a few cells)
        let g = tetra(at, x, y, z, eps);
        const step = Math.max(-p.h * 3, Math.min(p.h * 3, g.d));
        x -= g.x * step; y -= g.y * step; z -= g.z * step;
        // 2) the true normal there
        g = tetra(at, x, y, z, eps);
        let nx = g.x, ny = g.y, nz = g.z;
        if (nx * Nx + ny * Ny + nz * Nz < 0.05) { nx = Nx; ny = Ny; nz = Nz; }   // jumped to another sheet
        // 3) curvature at a broader tap (the Laplacian of the distance ~ mean curvature)
        const kd = at(x, y, z);
        const MA0 = MA, MB0 = MB, MW0 = MW;
        const gk = tetra(at, x, y, z, kEps);
        const kap = (gk.s - 4 * kd) / (4 * kEps * kEps);
        // 4) occlusion: march out along the normal
        let occ = 0, wsum = 0;
        for (let q = 1; q <= aoN; q++) {
          const s = aoR * q / aoN, w = 1 / q;
          const d = at(x + nx * s, y + ny * s, z + nz * s);
          occ += w * clamp01((s - d) / s); wsum += w;
        }
        evals += 13 + aoN;
        const ao = clamp01(1 - occ / wsum * 1.4);
        // paint
        S.x = x; S.y = y; S.z = z; S.nx = nx; S.ny = ny; S.nz = nz; S.k = kap * paint.kScale; S.ao = ao; S.ma = MA0; S.mb = MB0; S.mw = MW0;
        const ro = paintAt(paint, S, col);
        const ak = 1 - paint.aoAlb * (1 - ao);
        const j = o * 4;
        alb[j] = linToSrgb(col[0] * ak) * 255 + 0.5; alb[j + 1] = linToSrgb(col[1] * ak) * 255 + 0.5; alb[j + 2] = linToSrgb(col[2] * ak) * 255 + 0.5; alb[j + 3] = 255;
        // tangent-space normal in the SHADER'S frame (see header): T, B = the surface
        // gradients of u and v in the plane of the interpolated normal
        const q1x = e2y * Nz - e2z * Ny, q1y = e2z * Nx - e2x * Nz, q1z = e2x * Ny - e2y * Nx;   // cross(e2, N)
        const q0x = Ny * e1z - Nz * e1y, q0y = Nz * e1x - Nx * e1z, q0z = Nx * e1y - Ny * e1x;   // cross(N, e1)
        let Tx = q1x * du1 + q0x * du2, Ty = q1y * du1 + q0y * du2, Tz = q1z * du1 + q0z * du2;
        let Bx = q1x * dv1 + q0x * dv2, By = q1y * dv1 + q0y * dv2, Bz = q1z * dv1 + q0z * dv2;
        const sc = 1 / Math.sqrt(Math.max(Tx * Tx + Ty * Ty + Tz * Tz, Bx * Bx + By * By + Bz * Bz) || 1);
        Tx *= sc; Ty *= sc; Tz *= sc; Bx *= sc; By *= sc; Bz *= sc;
        const zc = nx * Nx + ny * Ny + nz * Nz;
        const tx = nx - zc * Nx, ty = ny - zc * Ny, tz = nz - zc * Nz;
        const tt = Tx * Tx + Ty * Ty + Tz * Tz, tb = Tx * Bx + Ty * By + Tz * Bz, bbb = Bx * Bx + By * By + Bz * Bz;
        const rt = tx * Tx + ty * Ty + tz * Tz, rb = tx * Bx + ty * By + tz * Bz, dt = tt * bbb - tb * tb;
        let mx = 0, my = 0, mz = 1;
        if (Math.abs(dt) > 1e-12) { mx = (rt * bbb - rb * tb) / dt; my = (rb * tt - rt * tb) / dt; mz = zc; }
        const ml = Math.hypot(mx, my, mz) || 1;
        nrm[j] = (mx / ml * 0.5 + 0.5) * 255 + 0.5; nrm[j + 1] = (my / ml * 0.5 + 0.5) * 255 + 0.5; nrm[j + 2] = (mz / ml * 0.5 + 0.5) * 255 + 0.5; nrm[j + 3] = 255;
        orm[j] = ao * 255 + 0.5; orm[j + 1] = clamp01(ro) * 255 + 0.5; orm[j + 2] = clamp01(0.5 - S.k) * 255; orm[j + 3] = 255;
        fill[o] = inside ? 2 : 1;
      }
    }
  }
  // gutters: grow every chart outward so filtering and mips never read the empty void
  const G2 = gutter * 2;
  for (let it = 0; it < G2; it++) {
    const add = [];
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const o = py * size + px;
      if (fill[o]) continue;
      let n = 0, s0 = 0, s1 = 0, s2 = 0, a0 = 0, a1 = 0, a2 = 0, r0 = 0, r1 = 0, r2 = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = px + dx, Y = py + dy;
        if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
        const q = Y * size + X;
        if (!fill[q]) continue;
        const j = q * 4;
        n++; s0 += alb[j]; s1 += alb[j + 1]; s2 += alb[j + 2]; a0 += nrm[j]; a1 += nrm[j + 1]; a2 += nrm[j + 2]; r0 += orm[j]; r1 += orm[j + 1]; r2 += orm[j + 2];
      }
      if (n) add.push(o, s0 / n, s1 / n, s2 / n, a0 / n, a1 / n, a2 / n, r0 / n, r1 / n, r2 / n);
    }
    for (let q = 0; q < add.length; q += 10) {
      const o = add[q], j = o * 4;
      alb[j] = add[q + 1]; alb[j + 1] = add[q + 2]; alb[j + 2] = add[q + 3]; alb[j + 3] = 255;
      nrm[j] = add[q + 4]; nrm[j + 1] = add[q + 5]; nrm[j + 2] = add[q + 6]; nrm[j + 3] = 255;
      orm[j] = add[q + 7]; orm[j + 1] = add[q + 8]; orm[j + 2] = add[q + 9]; orm[j + 3] = 255;
      fill[o] = 1;
    }
  }
  for (let o = 0; o < N; o++) if (!fill[o]) {                // the void: flat, mid, rough
    const j = o * 4; alb[j] = alb[j + 1] = alb[j + 2] = 40; alb[j + 3] = 255; nrm[j] = nrm[j + 1] = 128; nrm[j + 2] = 255; nrm[j + 3] = 255; orm[j] = 255; orm[j + 1] = 200; orm[j + 2] = 128; orm[j + 3] = 255;
  }
  let ormOut = orm, ormSize = size;
  if (A.ormHalf !== false) {
    const hs = size >> 1, o2 = new Uint8Array(hs * hs * 4);
    for (let y = 0; y < hs; y++) for (let x = 0; x < hs; x++) for (let c = 0; c < 4; c++) {
      const a = ((2 * y) * size + 2 * x) * 4 + c;
      o2[(y * hs + x) * 4 + c] = (orm[a] + orm[a + 4] + orm[a + size * 4] + orm[a + size * 4 + 4] + 2) >> 2;
    }
    ormOut = o2; ormSize = hs;
  }
  out.maps = { size, albedo: alb, normal: nrm, orm: ormOut, ormSize };
  return evals;
}

// ---------------------------------------------------------------- offline (node) path
// The Blender pipeline (tools/blender/) meshes the FULL-detail field densely here, paints
// every vertex with the same shading the in-engine bake uses, and hands Blender a high-
// poly to bake from and a low-poly source (bake-only layers left out) to decimate.
export function meshSDF(spec, h, opts = {}) {
  const root = compile(spec, !!opts.forMesh);
  const F = makeField(root, h, opts.lip || 1.6);
  fillField(F);
  const m = meshField(F, opts.mesher || 'dc');
  return { pos: m.pos, idx: m.idx, field: F, stats: { evals: F.evals, blocks: F.kept } };
}
export { decimate };
// Chart + pack a SET of meshes into one atlas and split vertices per chart. Returns the
// meshes with uv (0..1) and the pack's texel size; coverage = charted fraction of the
// atlas (the Blender pipeline's gate: Smart UV Project managed 0.20 on the shell).
export function unwrapSet(meshes, size, gutter = 6) {
  let area = 0;
  for (const m of meshes) { const { A: fa } = faceNormals(m.pos, m.idx); for (let f = 0; f < fa.length; f++) area += fa[f]; }
  const texel = Math.sqrt(area / (size * size * 0.55));
  const parts = meshes.map(m => ({ pos: m.pos, idx: m.idx, charts: chartMesh(m.pos, m.idx, texel) }));
  const pack = packAtlas(parts, size, gutter);
  let used = 0;
  const out = parts.map(p => {
    const rects = pack.rects.filter(r => r.part === p), map = new Map(), P = [], UV = [], IDX = [];
    for (const r of rects) {
      map.clear();
      for (const f of r.c.faces) for (let k = 0; k < 3; k++) {
        const i = p.idx[f * 3 + k];
        let v = map.get(i);
        if (v === undefined) {
          v = P.length / 3; map.set(i, v);
          const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
          P.push(x, y, z);
          UV.push(((x * r.U[0] + y * r.U[1] + z * r.U[2] - r.u0) * pack.dens + r.x) / size, ((x * r.V[0] + y * r.V[1] + z * r.V[2] - r.v0) * pack.dens + r.y) / size);
        }
        IDX.push(v);
      }
    }
    const uv = new Float32Array(UV), idx = new Uint32Array(IDX);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2;
      used += Math.abs((uv[b] - uv[a]) * (uv[c + 1] - uv[a + 1]) - (uv[c] - uv[a]) * (uv[b + 1] - uv[a + 1])) / 2;
    }
    return { pos: new Float32Array(P), idx, uv, charts: rects.length };
  });
  return { meshes: out, texel: 1 / pack.dens, coverage: used };
}

// Per-vertex normal (SDF gradient) and paint: RGBA8 = sRGB albedo (SDF-marched AO folded
// in by paint.aoAlb) + roughness in alpha.
export function shadeVertices(field, pos, paintSpec, opts = {}) {
  const paint = compilePaint(paintSpec), at = field.at, h = field.h;
  const eps = opts.eps || h * 0.5, kEps = opts.kEps || 0.012, aoR = (opts.ao && opts.ao.r) || 0.06, aoN = (opts.ao && opts.ao.n) || 4;
  const n = pos.length / 3, nrm = new Float32Array(n * 3), rgba = new Uint8Array(n * 4);
  const S = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, k: 0, ao: 1, ma: 0, mb: 0, mw: 0 }, col = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const g = tetra(at, x, y, z, eps), nx = g.x, ny = g.y, nz = g.z;
    nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
    const kd = at(x, y, z);
    const MA0 = MA, MB0 = MB, MW0 = MW;
    const gk = tetra(at, x, y, z, kEps);
    const kap = (gk.s - 4 * kd) / (4 * kEps * kEps);
    let occ = 0, wsum = 0;
    for (let q = 1; q <= aoN; q++) {
      const s = aoR * q / aoN, w = 1 / q;
      const d = at(x + nx * s, y + ny * s, z + nz * s);
      occ += w * clamp01((s - d) / s); wsum += w;
    }
    const ao = clamp01(1 - occ / wsum * 1.4);
    S.x = x; S.y = y; S.z = z; S.nx = nx; S.ny = ny; S.nz = nz; S.k = kap * paint.kScale; S.ao = ao; S.ma = MA0; S.mb = MB0; S.mw = MW0;
    const ro = paintAt(paint, S, col);
    const ak = 1 - paint.aoAlb * (1 - ao);
    rgba[i * 4] = linToSrgb(col[0] * ak) * 255 + 0.5; rgba[i * 4 + 1] = linToSrgb(col[1] * ak) * 255 + 0.5; rgba[i * 4 + 2] = linToSrgb(col[2] * ak) * 255 + 0.5;
    rgba[i * 4 + 3] = clamp01(ro) * 255 + 0.5;
  }
  return { normal: nrm, rgba };
}
function paintAt(paint, S, col) {
  const mA = paint.mats[S.ma] || paint.fallback, mB = paint.mats[S.mb] || paint.fallback, w = S.mw;
  col[0] = mA.c[0] + (mB.c[0] - mA.c[0]) * w; col[1] = mA.c[1] + (mB.c[1] - mA.c[1]) * w; col[2] = mA.c[2] + (mB.c[2] - mA.c[2]) * w;
  let ro = mA.ro + (mB.ro - mA.ro) * w;
  for (const L of paint.layers) {
    let a = L.a;
    for (let q = 0; q < L.m.length && a > 0; q++) a *= L.m[q](S);
    if (a <= 0) continue;
    col[0] += (L.c[0] - col[0]) * a; col[1] += (L.c[1] - col[1]) * a; col[2] += (L.c[2] - col[2]) * a;
    if (L.ro != null) ro += (L.ro - ro) * a;
  }
  return ro;
}
// Binary little-endian PLY: position, normal, RGBA8, triangles. `swizzle` writes the
// coordinates in Blender's frame (x, -z, y) so the glTF exporter's +Y-up round trip
// returns them to the game's frame exactly.
export function plyBytes(pos, idx, normal, rgba, swizzle = true, uv = null) {
  const n = pos.length / 3, m = idx.length / 3;
  const head = 'ply\nformat binary_little_endian 1.0\nelement vertex ' + n + '\nproperty float x\nproperty float y\nproperty float z\n' +
    (normal ? 'property float nx\nproperty float ny\nproperty float nz\n' : '') +
    (rgba ? 'property uchar red\nproperty uchar green\nproperty uchar blue\nproperty uchar alpha\n' : '') +
    (uv ? 'property float s\nproperty float t\n' : '') +
    'element face ' + m + '\nproperty list uchar int vertex_indices\nend_header\n';
  const hb = new TextEncoder().encode(head);
  const vs = 12 + (normal ? 12 : 0) + (rgba ? 4 : 0) + (uv ? 8 : 0);
  const buf = new ArrayBuffer(hb.length + n * vs + m * 13), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8.set(hb, 0);
  let o = hb.length;
  const W = (a, i) => swizzle ? [a[i * 3], -a[i * 3 + 2], a[i * 3 + 1]] : [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
  for (let i = 0; i < n; i++) {
    const p = W(pos, i);
    dv.setFloat32(o, p[0], true); dv.setFloat32(o + 4, p[1], true); dv.setFloat32(o + 8, p[2], true); o += 12;
    if (normal) { const q = W(normal, i); dv.setFloat32(o, q[0], true); dv.setFloat32(o + 4, q[1], true); dv.setFloat32(o + 8, q[2], true); o += 12; }
    if (rgba) { u8[o] = rgba[i * 4]; u8[o + 1] = rgba[i * 4 + 1]; u8[o + 2] = rgba[i * 4 + 2]; u8[o + 3] = rgba[i * 4 + 3]; o += 4; }
    if (uv) { dv.setFloat32(o, uv[i * 2], true); dv.setFloat32(o + 4, uv[i * 2 + 1], true); o += 8; }
  }
  for (let f = 0; f < m; f++) {
    u8[o] = 3; dv.setInt32(o + 1, idx[f * 3], true); dv.setInt32(o + 5, idx[f * 3 + 1], true); dv.setInt32(o + 9, idx[f * 3 + 2], true); o += 13;
  }
  return u8;
}

// ---------------------------------------------------------------- job
function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

export function runJob(job) {
  const T = { t0: now() }, stats = { parts: {} };
  const parts = [];
  for (const ps of job.parts) {
    const st = {}, t0 = now();
    // two fields: the mesh's (bake-only layers left out) is filled; the bake's full-detail
    // field is only ever sampled lazily near the surface
    const root = compile(ps.sdf, true), full = compile(ps.sdf, false);
    const F = makeField(root, ps.h, ps.lip || 1.6);
    fillField(F);
    const FB = makeField(full, ps.h, ps.lip || 1.6);
    st.fieldMs = now() - t0; st.blocks = F.kept; st.tested = F.tested; st.fieldEvals = F.evals;
    const t1 = now();
    const raw = meshField(F, ps.mesher || 'dc');
    st.meshMs = now() - t1; st.rawTris = raw.idx.length / 3;
    const t2 = now();
    const dec = decimate(raw.pos, raw.idx, ps.tris || 0, ps.err != null ? ps.err : ps.h * 0.35);
    st.decMs = now() - t2; st.tris = dec.idx.length / 3;
    parts.push({ name: ps.name, spec: ps, field: F, bakeField: FB, h: ps.h, pos: dec.pos, idx: dec.idx });
    stats.parts[ps.name] = st;
  }
  // charts over every part, one atlas
  const A = job.atlas || {}, size = A.size || 1024, gutter = A.gutter || 4;
  const t3 = now();
  let area = 0;
  for (const p of parts) { const { A: fa } = faceNormals(p.pos, p.idx); for (let f = 0; f < fa.length; f++) area += fa[f]; }
  const texel = Math.sqrt(area / (size * size * 0.55));
  for (const p of parts) p.charts = chartMesh(p.pos, p.idx, texel);
  const pack = packAtlas(parts, size, gutter);
  pack.size = size;
  stats.chartMs = now() - t3; stats.texel = 1 / pack.dens;
  // split vertices per chart, UVs from the pack, normals from the SDF
  const out = { parts: {}, probes: {}, stats };
  for (const p of parts) {
    const rects = pack.rects.filter(r => r.part === p);
    const map = new Map(), P = [], UV = [], IDX = [];
    for (const r of rects) {
      map.clear();
      for (const f of r.c.faces) for (let k = 0; k < 3; k++) {
        const i = p.idx[f * 3 + k];
        let v = map.get(i);
        if (v === undefined) {
          v = P.length / 3; map.set(i, v);
          const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
          P.push(x, y, z);
          const u = (x * r.U[0] + y * r.U[1] + z * r.U[2] - r.u0) * pack.dens + r.x, vv = (x * r.V[0] + y * r.V[1] + z * r.V[2] - r.v0) * pack.dens + r.y;
          UV.push(u / size, vv / size);
        }
        IDX.push(v);
      }
    }
    const pos = new Float32Array(P), nrm = new Float32Array(P.length);
    const e = p.h * 0.5;
    for (let i = 0; i < pos.length; i += 3) {
      const g = tetra(p.field.at, pos[i], pos[i + 1], pos[i + 2], e);
      nrm[i] = g.x; nrm[i + 1] = g.y; nrm[i + 2] = g.z;
    }
    p.out = { position: pos, normal: nrm, uv: new Float32Array(UV), index: new Uint32Array(IDX) };
    out.parts[p.name] = p.out;
  }
  const t4 = now();
  stats.bakeEvals = bake(job, parts, pack, out);
  stats.bakeMs = now() - t4;
  // per-vertex AO (vertex colour) from the baked ORM, for LOD / fallbacks
  for (const p of parts) {
    const o = p.out, n = o.position.length / 3, c = new Float32Array(n * 3), s = out.maps.ormSize, M = out.maps.orm;
    for (let i = 0; i < n; i++) {
      const x = Math.min(s - 1, Math.max(0, Math.floor(o.uv[i * 2] * s))), y = Math.min(s - 1, Math.max(0, Math.floor(o.uv[i * 2 + 1] * s)));
      const a = M[(y * s + x) * 4] / 255;
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = a;
    }
    o.color = c;
  }
  // probes
  for (const pr of job.probes || []) {
    const p = parts.find(q => q.name === pr.part);
    const n = pr.n, H = new Float32Array(n * n), F = p.field, top = F.root.bb[4] + 0.01, bot = F.root.bb[1] - 0.01;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = pr.x0 + (pr.x1 - pr.x0) * i / (n - 1), z = pr.z0 + (pr.z1 - pr.z0) * j / (n - 1);
      let y = top, hit = NaN;
      for (let it = 0; it < 200 && y > bot; it++) {
        const d = F.at(x, y, z);
        if (d < p.h * 0.05) { hit = y; break; }
        y -= Math.max(d * 0.8, p.h * 0.1);
      }
      H[j * n + i] = hit;
    }
    out.probes[pr.name] = H;
  }
  stats.totalMs = now() - T.t0;
  return out;
}

// transferable buffers of a result (for postMessage)
export function transferables(res) {
  const t = [];
  for (const k in res.parts) for (const a in res.parts[k]) t.push(res.parts[k][a].buffer);
  if (res.maps) t.push(res.maps.albedo.buffer, res.maps.normal.buffer, res.maps.orm.buffer);
  for (const k in res.probes) t.push(res.probes[k].buffer);
  return t;
}

// ---------------------------------------------------------------- async (worker pool)
const CACHE = new Map();
let POOL = null, SEQ = 0;
const PENDING = new Map();
function pool() {
  if (POOL !== null) return POOL;
  POOL = [];
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return POOL;
  const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2));
  try {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./sculpt.worker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = e => {
        const { id, res, err } = e.data, p = PENDING.get(id);
        w.busy--;
        if (!p) return;
        PENDING.delete(id);
        if (err) p.reject(new Error(err)); else p.resolve(res);
      };
      w.onerror = e => { console.warn('sculpt worker failed; falling back to the main thread', e.message); };
      POOL.push(w);
    }
  } catch (e) { POOL = []; }
  return POOL;
}
// A job runs on the least busy worker (each job is a whole creature part set, so the
// parallelism is coarse and needs no stitching). Results are cached by key for the page's
// lifetime: rebuilding a creature (zone re-entry, a swap, a voyage) costs nothing.
export function sculptAsync(job) {
  const key = job.key || null;
  if (key && CACHE.has(key)) return CACHE.get(key);
  const P = pool();
  let pr;
  if (!P.length) pr = new Promise(res => setTimeout(() => res(runJob(job)), 0));
  else {
    const w = P.reduce((a, b) => (b.busy < a.busy ? b : a));
    w.busy++;
    const id = ++SEQ;
    pr = new Promise((resolve, reject) => { PENDING.set(id, { resolve, reject }); w.postMessage({ id, job }); })
      .catch(e => { console.warn('sculpt: worker job failed, running on the main thread', e); return runJob(job); });
  }
  if (key) CACHE.set(key, pr);
  return pr;
}
export function sculptCached(key) { return CACHE.get(key) || null; }

// ---------------------------------------------------------------- THREE adapters
export function toGeometry(THREE, part) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
  if (part.color) g.setAttribute('color', new THREE.BufferAttribute(part.color, 3));
  g.setIndex(new THREE.BufferAttribute(part.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
export function toTextures(THREE, maps, aniso = 8) {
  const mk = (data, s, srgb) => {
    const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(maps.albedo, maps.size, true), normalMap: mk(maps.normal, maps.size, false), ormMap: mk(maps.orm, maps.ormSize, false) };
}
