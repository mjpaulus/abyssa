// Seafloor terrain: heightfield, mesh, triplanar PBR material, caustics. OWNED BY: terrain agent.
import * as THREE from 'three';
import { scene } from '../core.js';
import { WORLD_R, RIFT_R, zoneBottom, riftPos, SUN } from '../config.js';
import { canvas2d, noiseCanvas, normalFromHeight, toTexture } from '../lib/textures.js';
import { pbrUniforms, PBR_GLSL } from '../lib/triplanar.js';
import { siteParams } from './site.js';

// ---------------------------------------------------------------------------
// Noise. lib/math's vnoise hashes with Math.sin, which measures ~15x slower than
// an int-hash gradient noise; that margin is what pays for the extra octaves and
// the 7x denser mesh below. Seeded so the field is identical every load.
// ---------------------------------------------------------------------------
const PERM = new Uint8Array(512), GX = new Float32Array(8), GZ = new Float32Array(8);
(() => {
  let s = 0x9e3779b9;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0, v = t[i]; t[i] = t[j]; t[j] = v; }
  for (let i = 0; i < 512; i++) PERM[i] = t[i & 255];
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; GX[i] = Math.cos(a); GZ[i] = Math.sin(a); }
})();

// 2D gradient noise, roughly -0.7..0.7.
function gn(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const X = ix & 255, Z = iz & 255, p0 = PERM[Z], p1 = PERM[Z + 1];
  const a = PERM[X + p0] & 7, b = PERM[X + 1 + p0] & 7, c = PERM[X + p1] & 7, d = PERM[X + 1 + p1] & 7;
  const n00 = GX[a] * fx + GZ[a] * fz, n10 = GX[b] * (fx - 1) + GZ[b] * fz;
  const n01 = GX[c] * fx + GZ[c] * (fz - 1), n11 = GX[d] * (fx - 1) + GZ[d] * (fz - 1);
  const l0 = n00 + (n10 - n00) * u, l1 = n01 + (n11 - n01) * u;
  return l0 + (l1 - l0) * v;
}

// Gain is deliberately below 1/lacunarity: each octave then adds less slope than the
// last, which is what keeps landforms readable instead of collapsing into noise mush.
function fbm2(x, z, oct) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += gn(x * f + i * 17.3, z * f - i * 11.7) * a; a *= 0.44; f *= 2.11; }
  return s * 1.28;
}

// Ridged multifractal: crest-concentrated detail, the source of cliff edges and spines.
function rmf(x, z, oct) {
  let s = 0, a = 0.5, f = 1, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(gn(x * f + i * 23.1, z * f + i * 7.9)) * 2.3;
    if (n < 0) n = 0;
    n *= n;
    s += n * a * w;
    w = n * 2.4 > 1 ? 1 : n * 2.4;
    a *= 0.34; f *= 2.13;
  }
  return s * 1.6;
}

// Period-N variant of the same noise, for texture generation that has to tile exactly.
function pn(x, z, N) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const X0 = ((ix % N) + N) % N, X1 = (X0 + 1) % N, Z0 = ((iz % N) + N) % N, Z1 = (Z0 + 1) % N;
  const a = PERM[(X0 + PERM[Z0]) & 255] & 7, b = PERM[(X1 + PERM[Z0]) & 255] & 7;
  const c = PERM[(X0 + PERM[Z1]) & 255] & 7, d = PERM[(X1 + PERM[Z1]) & 255] & 7;
  const n00 = GX[a] * fx + GZ[a] * fz, n10 = GX[b] * (fx - 1) + GZ[b] * fz;
  const n01 = GX[c] * fx + GZ[c] * (fz - 1), n11 = GX[d] * (fx - 1) + GZ[d] * (fz - 1);
  const l0 = n00 + (n10 - n00) * u, l1 = n01 + (n11 - n01) * u;
  return l0 + (l1 - l0) * v;
}

const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// Flat treads, quick risers — sedimentary strata / lava shelves.
function terrace(h, q, amt) {
  const s = h / q, f = Math.floor(s), t = s - f;
  const a = t * t * (3 - 2 * t);
  return h + ((f + a * a * (3 - 2 * a)) * q - h) * amt;
}

// Per-zone landform character. 0 = sandy shelf, 1 = broken canyon, 2 = volcanic.
// Amplitudes are held to a sane fraction of each term's wavelength (1/f); that ratio,
// not the octave count, is what decides whether the result reads as landform or noise.
const ZP = [
  { ox: 0, oz: 0, warp: 46, cf: 0.0043, camp: 34, rbias: -0.32, rf: 0.0050, ramp: 28, roc: 3,
    s2f: 0.0165, s2amp: 3.5, r3f: 0.055, r3amp: 1.2, cnf: 0.0072, cnamp: 9, cnoc: 2,
    duf: 0.0060, dvf: 0.0210, damp: 4.5,
    mf: 0.021, mamp: 1.0, ff: 0.072, famp: 0.28, tq: 0, tamt: 0, lift: 17 },
  { ox: 910, oz: -430, warp: 78, cf: 0.0040, camp: 40, rbias: -0.10, rf: 0.0056, ramp: 42, roc: 4,
    s2f: 0.0200, s2amp: 11, r3f: 0.062, r3amp: 3.0, cnf: 0.0105, cnamp: 21, cnoc: 3,
    duf: 0, dvf: 0, damp: 0,
    mf: 0.026, mamp: 2.6, ff: 0.082, famp: 0.60, tq: 9.0, tamt: 0.62, lift: 23 },
  { ox: -1740, oz: 1220, warp: 62, cf: 0.0048, camp: 34, rbias: -0.14, rf: 0.0074, ramp: 48, roc: 4,
    s2f: 0.0270, s2amp: 13, r3f: 0.078, r3amp: 3.6, cnf: 0.0150, cnamp: 19, cnoc: 3,
    duf: 0, dvf: 0, damp: 0,
    mf: 0.033, mamp: 3.2, ff: 0.098, famp: 0.80, tq: 6.0, tamt: 0.52, lift: 23 }
];

const RP = [riftPos(0), riftPos(1), riftPos(2)];
const ZB = [zoneBottom(0), zoneBottom(1), zoneBottom(2)];
const RIFT_RR = RIFT_R * 2.7;
const RIM_IN = WORLD_R * 0.68, RIM_SPAN = WORLD_R * 0.44, RIM_H = 118;

// Azimuthal rim harmonics (a2,b2,a3,b3,a5,b5 per zone). Distinct seeds per zone so
// the three skylines never rhyme. Amplitudes are sized so aR*0.62+0.5 and aH*0.62+0.5
// span all of [0,1] (measured over 4096 bearings: ~7-17% of bearings clamp at each
// end, which reads as flat crest/saddle stretches rather than lost range).
const RIM_KR = [
  [ 0.62, -0.31,  0.44,  0.26, -0.22,  0.30],
  [-0.38,  0.55,  0.20, -0.48,  0.28,  0.17],
  [ 0.29,  0.47, -0.52,  0.14,  0.19, -0.33]
];
const RIM_KH = [
  [ 0.41,  0.52, -0.36,  0.30,  0.24, -0.18],
  [ 0.57, -0.22,  0.33,  0.41, -0.15,  0.26],
  [-0.48,  0.34,  0.45, -0.20,  0.31,  0.12]
];

// THE CHART owns the per-zone domain offsets and the rim harmonic rows now. The
// literals above stay as the module's resting state, but the truth is whatever site
// is current: syncSite copies the active site's rows over them IN PLACE, so terrainH
// keeps reading the same objects it always has — no per-call registry lookup on the
// hottest function in the game, and no stale captured copies either, because every
// caller reaches these tables through the module scope. Site 0's registry rows are
// verbatim copies of the literals, so the shipped world survives bit-identical.
// Amplitudes, frequencies and the mesh itself never vary by site — only where in the
// infinite noise field each zone looks, and which skyline harmonics it wears.
function syncSite() {
  const t = siteParams().terra;
  for (let zi = 0; zi < 3; zi++) {
    ZP[zi].ox = t.off[zi][0];
    ZP[zi].oz = t.off[zi][1];
    const kr = t.rimKR[zi], kh = t.rimKH[zi];
    for (let k = 0; k < 6; k++) { RIM_KR[zi][k] = kr[k]; RIM_KH[zi][k] = kh[k]; }
  }
}
syncSite();

// Second ridgeline. Zero new triangles: the graded axisMap already samples out here.
const RAM_IN = 340, RAM_PK = 410, RAM_OUT = 540, RAM_H = 66;

// Analytic height function. Mesh generation, prop scatter, and player collision all
// call this, so any change here changes what the player physically stands on.
export function terrainH(x, z, zi) {
  const P = ZP[zi];

  // Rift funnel mask up front: noise is flattened toward a plateau inside it so the
  // zone exit stays a clean, traversable bowl no matter what the landform does there.
  const rp = RP[zi], ddx = x - rp.x, ddz = z - rp.z, dr = Math.sqrt(ddx * ddx + ddz * ddz);
  let rm = 0;
  if (dr < RIFT_RR) { const t = 1 - dr / RIFT_RR; rm = t * t * (3 - 2 * t); }

  // Domain warp — pulls every later octave off the noise lattice, so ridges meander.
  const xs = x + P.ox, zs = z + P.oz;
  const px = xs + gn(xs * 0.0042, zs * 0.0042) * P.warp;
  const pz = zs + gn(xs * 0.0042 + 41.7, zs * 0.0042 - 23.1) * P.warp;

  // Continental base: broad basin/plateau shape.
  let h = fbm2(px * P.cf, pz * P.cf, 3) * P.camp;

  // One regional mask drives both feature systems in opposition: uplifted massifs
  // where it is high, channelled lowland where it is low. Mixing them everywhere is
  // what turns ridged noise into mush.
  let rk = c01(fbm2(px * 0.0028 + 9.1, pz * 0.0028 - 4.4, 2) * 2.2 + 0.5 + P.rbias);
  rk = rk * rk * (3 - 2 * rk);
  h += rmf(px * P.rf, pz * P.rf, P.roc) * P.ramp * rk;
  // Secondary ridges at 40-60m: without these the massifs above read as bare domes.
  h += rmf(px * P.s2f + 13.7, pz * P.s2f + 4.2, 3) * P.s2amp * (0.30 + 0.70 * rk);

  // Canyons / fissures: squared inverted ridges cut branching channels.
  const cv = rmf(px * P.cnf + 57.2, pz * P.cnf - 31.8, P.cnoc);
  h -= cv * cv * P.cnamp * (1 - rk * 0.8);

  // Dune field: anisotropic ridges on a rotated axis, kept off the rocky uplands.
  if (P.damp > 0) {
    const dx = px * 0.906 - pz * 0.423, dz = px * 0.423 + pz * 0.906;
    h += rmf(dx * P.duf, dz * P.dvf, 2) * P.damp * (1 - rk * 0.75);
  }

  // Outcrop rubble at ~15m: the smallest crests the mesh can still hold a silhouette for.
  h += rmf(px * P.r3f + 71.3, pz * P.r3f - 29.6, 2) * P.r3amp * rk;

  // Rubble and boulder-field lumps, then the finest scale the mesh can still resolve.
  h += fbm2(px * P.mf, pz * P.mf, 3) * P.mamp;
  h += fbm2(x * P.ff + 3.3, z * P.ff - 8.8, 2) * P.famp;

  if (P.tamt > 0) h = terrace(h, P.tq, P.tamt * rk);

  h += P.lift;
  // Soft floor: canyons must not dig below the zone-change trigger plane.
  if (h < 4) h = 4 + (h - 4) * 0.25;

  if (rm > 0) {
    const k = rm * 0.9;
    h = h * (1 - k) + 18 * k;      // flatten toward a plateau, then sink the funnel
    h -= rm * rm * 78;
    // raised collar so the exit reads as a sinkhole rather than a dent
    const q = (dr - RIFT_RR * 0.84) / (RIFT_RR * 0.2);
    h += Math.exp(-q * q) * 13;
  }

  h += ZB[zi];

  // Basin rim: a noisy wall that closes each zone into a bowl and hides the mesh edge.
  // The onset radius and crest height run on azimuthal Chebyshev harmonics of the
  // unit direction — no atan2, no branch cut, wraps seamlessly by construction — so
  // the wall is a skyline rather than a lathe cut. OUTWARD ONLY: rin >= RIM_IN, so
  // the basin never shrinks and scatter out to WORLD_R*0.99 = 257 stays off wall faces.
  const rr = Math.sqrt(x * x + z * z);
  const ir = 1 / Math.max(rr, 1e-3), cx = x * ir, cz = z * ir;
  const c2 = cx * cx - cz * cz, s2 = 2 * cx * cz;
  const c3 = cx * c2 - cz * s2, s3 = cx * s2 + cz * c2;
  const c5 = c2 * c3 - s2 * s3, s5 = c2 * s3 + s2 * c3;
  const KR = RIM_KR[zi], KH = RIM_KH[zi];
  const aR = KR[0] * c2 + KR[1] * s2 + KR[2] * c3 + KR[3] * s3 + KR[4] * c5 + KR[5] * s5;
  const aH = KH[0] * c2 + KH[1] * s2 + KH[2] * c3 + KH[3] * s3 + KH[4] * c5 + KH[5] * s5;
  const rin = RIM_IN + 46 * c01(aR * 0.62 + 0.5);            // 176.8 .. 222.8
  const rh = RIM_H * (0.55 + 0.90 * c01(aH * 0.62 + 0.5));   // 64.9 .. 171.1
  const rt = c01((rr - rin) / RIM_SPAN);
  if (rt > 0) {
    const s = rt * rt * rt * (rt * (rt * 6 - 15) + 10);
    h += s * rh * (1.0 + fbm2(x * 0.0060 + 71, z * 0.0060 - 19, 3) * 0.55)
       + s * s * rmf(x * 0.0105 + 5, z * 0.0105 - 3, 3) * 30;
  }

  // Rampart: a second ridgeline 100+ units behind the rim crest, at roughly half its
  // luminance through the water — aerial perspective, and the wall that keeps the
  // clear-band sightlines (456/477 units in zones 1/2) from finding the mesh edge.
  // The upper bound is exact, not a fade cutoff: at rr >= RAM_OUT the envelope is
  // identically zero, and without the bound 11% of mesh samples (the corners) paid
  // six noise octaves for nothing.
  if (rr > RAM_IN && rr < RAM_OUT) {
    const up = c01((rr - RAM_IN) / (RAM_PK - RAM_IN));
    const dn = c01((rr - RAM_PK) / (RAM_OUT - RAM_PK));
    const sR = up * up * (3 - 2 * up) * (1 - dn * dn * (3 - 2 * dn));
    h += sR * RAM_H * (1.0 + fbm2(x * 0.0042 + 133, z * 0.0042 - 61, 3) * 0.62)
       + sR * rmf(x * 0.0080 + 17, z * 0.0080 + 29, 3) * 22;
  }
  // Drowned shelf edge: everything above y=-34 is compressed toward it, never folded.
  // The increasing form matters — the published `-34 - (h+34)*0.15` is monotone
  // DECREASING in h, which inverts every crest above the line into a crease and flips
  // terrainNormal's central differences along the whole far ridgeline. Only zone 0
  // can reach -34 (zones 1/2 top out near -320 and -630), so this fires nowhere else.
  if (h > -34) h = -34 + (h + 34) * 0.15;
  return h;
}

// ---------------------------------------------------------------------------
// Foot-of-wall clamp table: where the play boundary meets rock, per bearing.
// player.js lerps this instead of the old circular r=260 clamp, which stranded
// Sal at y=-118 in open water partway up a cliff face. Index 128 duplicates
// index 0 so the consumer's lerp never needs a wrap branch.
// ---------------------------------------------------------------------------
export const clampR = [];   // 3 x Float32Array(129), filled by fillTerrain

const CLAMP_N = 128, CLAMP_MIN = 235, CLAMP_MAX = 305, RIM_FOOT_RISE = 30;

function buildClampTable() {
  for (let zi = 0; zi < 3; zi++) {
    // Refill in place on reseed: player.js holds these exact arrays by reference,
    // so a fresh allocation here would strand it clamping against the old site.
    const t = clampR[zi] || (clampR[zi] = new Float32Array(CLAMP_N + 1));
    for (let bi = 0; bi < CLAMP_N; bi++) {
      const a = (bi / CLAMP_N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      // Basin reference at r=150: far enough out to be past the rift funnel, far
      // enough in to be untouched by the rim on every bearing.
      const href = terrainH(150 * ca, 150 * sa, zi) + RIM_FOOT_RISE;
      // Bisect for the smallest r where the wall stands RIM_FOOT_RISE above the
      // basin. The wall is the dominant monotone term out here, so 12 halvings of
      // a 154-unit bracket land within 0.04 units.
      let r = CLAMP_MAX;
      if (terrainH(330 * ca, 330 * sa, zi) > href) {
        let lo = 176, hi = 330;
        for (let it = 0; it < 12; it++) {
          const mid = (lo + hi) * 0.5;
          if (terrainH(mid * ca, mid * sa, zi) > href) hi = mid; else lo = mid;
        }
        r = hi;
      }
      // The 235 floor is not cosmetic: flora and props scatter to WORLD_R*0.99 = 257,
      // and a clamp below that would make existing content unreachable.
      t[bi] = Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, r));
    }
    // One circular 1-2-1 pass: the raw foot can jump ~20 units between adjacent
    // bearings where a noise spur meets the criterion early, and the consumer is a
    // straight lerp — smoothing here is what keeps the boundary from kinking. A
    // convex blend of in-range values stays in [235, 305].
    const raw = Float32Array.from(t.subarray(0, CLAMP_N));
    for (let bi = 0; bi < CLAMP_N; bi++) {
      const p = raw[(bi + CLAMP_N - 1) % CLAMP_N], q = raw[(bi + 1) % CLAMP_N];
      t[bi] = raw[bi] * 0.5 + (p + q) * 0.25;
    }
    t[CLAMP_N] = t[0];
  }
}

// Surface normal via finite differences of terrainH — used for slope-aware placement and physics.
export function terrainNormal(x, z, zi, eps = 0.5) {
  const hL = terrainH(x - eps, z, zi), hR = terrainH(x + eps, z, zi);
  const hD = terrainH(x, z - eps, zi), hU = terrainH(x, z + eps, zi);
  return new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
}

// ---------------------------------------------------------------------------
// Procedural PBR maps. Three textures total, all tileable, each reused at several
// world scales in the shader so we never pay for more texture generation.
// ---------------------------------------------------------------------------
const MAPS = (() => {
  const S = 256;

  // Rock height. The mesh already carries every low frequency, so this map is weighted
  // hard toward grain and chip scale and adds a three-level fracture network. Two earlier
  // attempts are worth not repeating: drawn strokes read as raised worms, and quantising
  // a smooth base into slabs read as topographic contour bands.
  const { canvas: rh, ctx: rhx } = canvas2d(S);
  const ri = rhx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let h = pn(u * 6, v * 6, 6) * 0.22 + pn(u * 13, v * 13, 13) * 0.20 + pn(u * 27, v * 27, 27) * 0.18
          + pn(u * 55, v * 55, 55) * 0.13 + pn(u * 101, v * 101, 101) * 0.08;
    let c1 = 1 - Math.abs(pn(u * 9, v * 9, 9)) * 6.5; if (c1 < 0) c1 = 0;
    let c2 = 1 - Math.abs(pn(u * 23, v * 23, 23)) * 7.5; if (c2 < 0) c2 = 0;
    let c3 = 1 - Math.abs(pn(u * 47, v * 47, 47)) * 8.5; if (c3 < 0) c3 = 0;
    h -= c1 * c1 * 0.30 + c2 * c2 * 0.20 + c3 * c3 * 0.12;
    const o = (y * S + x) * 4, g = c01(h * 0.62 + 0.56) * 255 | 0;
    ri.data[o] = ri.data[o + 1] = ri.data[o + 2] = g; ri.data[o + 3] = 255;
  }
  rhx.putImageData(ri, 0, 0);

  // Packed detail: R = silt grain, G = the rock height above, B = large stain blotches.
  const gr = noiseCanvas(S, 6, 1.15), bl = noiseCanvas(S, 3, 0.85);
  const a = gr.getContext('2d').getImageData(0, 0, S, S).data;
  const b = ri.data, c = bl.getContext('2d').getImageData(0, 0, S, S).data;
  const { canvas: dc, ctx: dx } = canvas2d(S);
  const di = dx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    di.data[o] = a[o]; di.data[o + 1] = b[o]; di.data[o + 2] = c[o]; di.data[o + 3] = 255;
  }
  dx.putImageData(di, 0, 0);

  // Sand ripples: integer-frequency bands warped by tileable noise, so the tile still wraps.
  const wv = noiseCanvas(S, 3, 1).getContext('2d').getImageData(0, 0, S, S).data;
  const { canvas: pc, ctx: px } = canvas2d(S);
  const pi = px.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4, n = wv[o] / 255;
    const u = x / S + (n - 0.5) * 0.17;
    let v = Math.sin(u * Math.PI * 14) * 0.5 + 0.5;
    v = Math.pow(v, 1.7) * 0.72 + n * 0.28;
    const g = (v * 255) | 0;
    pi.data[o] = pi.data[o + 1] = pi.data[o + 2] = g; pi.data[o + 3] = 255;
  }
  px.putImageData(pi, 0, 0);

  return {
    detail: toTexture(dc),
    rockN: toTexture(normalFromHeight(rh, 1.7)),
    rippleN: toTexture(normalFromHeight(pc, 1.6))
  };
})();

// uSunW: the same sun the sky, key light and god rays share, in WORLD space, for the
// caustic shading term below. It was a module-level constant baked into the shader
// source; it is a uniform now, refreshed every updateTerrain from config.js's SUN.
// It reads dirWater, not dir — a caustic is sunlight that has already crossed the
// interface, so it arrives inside Snell's window or it is not a caustic.
export const causticsUniforms = {
  uTime: { value: 0 }, uCamY: { value: 0 }, uSunK: { value: 1 },
  uSunW: { value: new THREE.Vector3(SUN.dirWater.x, SUN.dirWater.y, SUN.dirWater.z) }
};

const COMMON = {
  uDetail: { value: MAPS.detail },
  uRockN: { value: MAPS.rockN },
  uRipple: { value: MAPS.rippleN }
};

const FRAG_HEAD = PBR_GLSL + /* glsl */`
uniform sampler2D uDetail, uRockN, uRipple;
uniform vec3 uSilt, uGrav, uRock;
uniform float uTime, uCamY, uCaust, uWet, uSunK;
uniform vec3 uSunW;
varying vec3 vWPos, vWNrm;

// NOTE: no early return before the side taps. A return inside non-uniform control flow
// leaves the remaining texture2D calls with undefined derivatives on quads straddling
// the bw.y threshold — measured as sparkle along the flat/steep contour. All taps are
// unconditional; the flat-ground fast path is selected with step/mix instead.
vec4 tpDetail(vec3 p, vec3 bw, float s) {
  vec4 a = texture2D(uDetail, p.xz * s);
  vec4 tri = a * bw.y + texture2D(uDetail, p.zy * s) * bw.x + texture2D(uDetail, p.xy * s) * bw.z;
  return mix(tri, a, step(0.93, bw.y));
}

// Whiteout-blended triplanar normal; cliffs get all three planes, flat ground one tap.
vec3 tpNormal(vec3 p, vec3 n, vec3 bw, float s, float str) {
  vec3 ty = texture2D(uRockN, p.xz * s).xyz * 2.0 - 1.0;
  vec3 tx = texture2D(uRockN, p.zy * s).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(uRockN, p.xy * s).xyz * 2.0 - 1.0;
  vec3 flat_ = normalize(vec3(n.x + ty.x * str, n.y, n.z + ty.y * str));
  vec3 wx = vec3(tx.xy * str + n.zy, abs(tx.z) * n.x);
  vec3 wy = vec3(ty.xy * str + n.xz, abs(ty.z) * n.y);
  vec3 wz = vec3(tz.xy * str + n.xy, abs(tz.z) * n.z);
  vec3 tri = normalize(wx.zyx * bw.x + wy.xzy * bw.y + wz.xyz * bw.z);
  return mix(tri, flat_, step(0.93, bw.y));
}

// Refracted-light filament: warped interference field, thresholded hard so the
// bright bands stay thin and branch the way real caustics do.
float causticF(vec2 p, float t) {
  vec2 q = p + 0.55 * vec2(sin(p.y * 1.31 - t * 0.83), sin(p.x * 1.17 + t * 0.71));
  float v = sin(q.x * 1.9 + t * 1.03) * sin(q.y * 1.63 - t * 0.87) * 0.78
          + sin((q.x + q.y) * 1.31 - t * 0.61) * 0.44;
  float c = 1.0 - min(1.0, abs(v) * 1.28);
  c *= c; c *= c;
  return c;
}
`;

// One shared function object so all three zone materials hit the same program cache key.
function compileTerrain(sh) {
  Object.assign(sh.uniforms, COMMON, pbrUniforms, causticsUniforms, sh.__zone);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos, vWNrm;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);

  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
    // Material composition replaces the vertex-color multiply; vColor now carries
    // r = baked cavity AO, g = macro rock bias, b = height above the basin floor.
    .replace('#include <color_fragment>', /* glsl */`
      vec3 wn = normalize(vWNrm);
      // Power 5: softer blends leave the XZ projection visibly stretched on 45deg faces.
      vec3 bw = abs(wn); bw *= bw; bw *= bw; bw *= abs(wn); bw /= (bw.x + bw.y + bw.z);
      float ao = vColor.r, bias = vColor.g, hb = vColor.b;

      vec4 mac = texture2D(uDetail, vWPos.xz * 0.0072);
      // Drift the detail lookup by a 140m-scale field: costs no extra tap and pushes the
      // 16m tile repeat out of phase with itself across a cliff face.
      vec3 dp = vWPos + (mac.rbg - 0.5) * 7.0;
      vec4 det = tpDetail(dp, bw, 0.062);

      float slope = 1.0 - clamp(wn.y, 0.0, 1.0);
      float rockW = smoothstep(0.13, 0.46, slope + (mac.g - 0.5) * 0.30 + (bias - 0.5) * 0.36 + hb * 0.10);
      float gravW = smoothstep(0.02, 0.24, slope + (mac.b - 0.5) * 0.26) * (1.0 - rockW);
      float siltW = max(0.0, 1.0 - rockW - gravW);

      vec3 alb = uSilt * (0.68 + 0.64 * det.r) * siltW
               + uGrav * (0.55 + 0.85 * det.g) * gravW
               + uRock * (0.46 + 0.95 * det.g) * rockW;
      alb *= 0.62 + 0.80 * mac.r;
      alb *= 0.16 + 0.84 * ao;
      // Slight up-facing bias so distant landforms keep some form under the flat
      // ambient-dominated rig instead of reading as flat cutouts.
      alb *= 0.86 + 0.20 * max(0.0, wn.y) + 0.10 * hb;

      // --- Photographed sediment structure (AmbientCG), layered onto the palette ---
      // The packed maps are level-normalised to a 0.5 mean at bake time, so the
      // weighted dot doubled lands on 1.0 and these are pure multipliers: the zone
      // palette above still owns every hue, this only owns the grain.
      vec3 wgt = vec3(siltW, gravW, rockW);
      // Octave mix driven by the same 140m field as the detail drift, so the 8m tile
      // and the 45m tile are never in phase across a single view.
      float oct = 0.10 + 0.36 * smoothstep(0.28, 0.72, mac.b);
      float aStr = dot(pbrPlane(uPAlb, dp, bw, oct), wgt) * 2.0;
      float rStr = dot(pbrPlane(uPRgh, dp, bw, oct), wgt) * 2.0;
      alb *= mix(1.0, 0.22 + 0.78 * aStr, uTexAmt * 0.92);
      diffuseColor.rgb = alb;

      float tRough = 0.98 * siltW + 0.90 * gravW + uWet * rockW;
      tRough = clamp(tRough * (0.88 + 0.24 * det.g)
                            * mix(1.0, 0.66 + 0.68 * rStr, uTexAmt), 0.22, 1.0);

      // Fracture normals belong to stone only — at full strength on silt they read as scratches.
      vec3 tN = tpNormal(dp, wn, bw, 0.062, 0.10 + 1.05 * rockW);
      // Photographed relief on top of the procedural fracture network. Strong enough
      // that the lantern raking across the floor at night picks out individual grains
      // and pebble shadows; rock faces get more because their relief is coarser.
      tN = normalize(tN + pbrNormal(dp, wn, bw, wgt, oct, uTexAmt * (1.15 + 0.55 * rockW)));
      // Near-field micro relief: sand ripples then grain, both faded out with distance
      // so only ground within a few metres of the diver carries the extra detail.
      float dCam = length(vWPos - cameraPosition);
      float mf = 1.0 - smoothstep(10.0, 56.0, dCam);
      if (mf > 0.01) {
        vec3 r1 = texture2D(uRipple, vWPos.xz * 0.085).xyz * 2.0 - 1.0;
        vec3 r2 = texture2D(uRipple, vWPos.zx * 0.63).xyz * 2.0 - 1.0;
        float k = mf * (0.22 + 1.05 * siltW);
        tN = normalize(tN + vec3(r1.x * 1.15 + r2.x * 0.45, 0.0, r1.y * 1.15 + r2.y * 0.45) * k);
      }`)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
    .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);')
    .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      {
        // Calibrated so the zone-0 seafloor (~-240) still catches light and zone 1 is nearly dark.
        float depth01 = clamp((-vWPos.y - 110.0) / 380.0, 0.0, 1.0);
        float fade = 1.0 - depth01; fade *= fade;
        fade *= clamp(1.0 + (uCamY + 60.0) / 460.0, 0.12, 1.0);
        fade *= max(0.0, wn.y) * ao * uCaust * uSunK * (0.35 + 0.9 * mac.b);
        if (fade > 0.002) {
          vec2 cp = vWPos.xz * mix(0.155, 0.075, depth01);
          // The chromatic split was 0.35 WORLD UNITS of RGB separation — a metre-wide
          // rainbow fringe on every band, which is a swimming-pool-mural tell, not
          // dispersion. Real dispersion at this scale is a few centimetres of warm/cool
          // edge; 0.008 keeps exactly that and nothing more.
          vec2 ch = vec2(0.008, -0.005);
          float g = causticF(cp, uTime);
          float r = causticF(cp + ch, uTime);
          float b = causticF(cp - ch, uTime);
          float fine = causticF(cp * 2.35 + 11.0, uTime * 1.42) * 0.45;
          vec3 c = vec3(r, g, b) + fine * vec3(0.6, 0.9, 1.0);
          // A caustic is FOCUSED SUNLIGHT, not a glowing decal. The old form added a
          // flat emissive tint that ignored the surface entirely — which is why the
          // bands washed the triplanar texture out instead of revealing it. Focused
          // light obeys the same physics as unfocused light: it is coloured by the
          // ALBEDO it lands on (diffuseColor here already carries the full triplanar
          // composite) and shaded by the micro NORMAL (facets tilted away from the sun
          // go dark inside the band). The texture now shows through the caustic — the
          // band brightens the detail rather than replacing it. The 4.4 gain rebuys
          // the luminance the albedo multiply costs (floor albedos run 0.05-0.25).
          vec3 sunV = normalize((viewMatrix * vec4(uSunW, 0.0)).xyz);
          float ndl = clamp(dot(normal, sunV), 0.0, 1.0);
          // PARTIALLY normalised albedo, not raw. Raw albedo was physically pure and
          // visually wrong for this world: the palette keeps rock near 0.05 on
          // purpose, so the bands survived only on pale silt (user-reported: "now
          // only sand has that effect"). Dividing by a soft luminance floor lifts
          // dark surfaces toward the band's tuned brightness while the LOCAL texture
          // and hue still modulate it — silt to rock now spans about 2:1 instead of
          // 5:1, and zero was never on the menu.
          float alum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 alb = diffuseColor.rgb / (alum * 0.55 + 0.045);
          totalEmissiveRadiance += c * alb * vec3(0.35, 0.60, 0.70)
                                 * fade * 0.90 * (0.22 + 0.78 * ndl);
        }
      }`);
}

function zoneMat(silt, grav, rock, caust, wet) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, dithering: true });
  const u = {
    uSilt: { value: new THREE.Color(silt) },
    uGrav: { value: new THREE.Color(grav) },
    uRock: { value: new THREE.Color(rock) },
    uCaust: { value: caust },
    uWet: { value: wet }
  };
  m.onBeforeCompile = sh => { sh.__zone = u; compileTerrain(sh); };
  return m;
}

const zoneMats = [
  // Deeper zones carry higher albedo on purpose: they receive almost no light, and at
  // the zone-0 values they render as flat black rather than as dark stone.
  zoneMat(0x3f4744, 0x242c2f, 0x131c23, 1.0, 0.58),   // 0 — pale carbonate silt, cool wet stone
  zoneMat(0x4c4c3a, 0x30352a, 0x1d251f, 0.45, 0.52),  // 1 — olive sediment over broken green-grey rock
  zoneMat(0x513f33, 0x322a26, 0x22171a, 0.12, 0.44)   // 2 — ash and scorched basalt
];

export const terrainMat = zoneMats[0];

export const terrainMeshes = [];

// ---------------------------------------------------------------------------
// Roof shells, zones 0 and 1: the underside of the zone above. The silt-line
// optics give 25% blue transmittance from zone 1's clear band straight up to
// zone 0's floor, and zoneMats are FrontSide — without these the player sees the
// background dome through 300 units of rock at exactly the altitude the design
// tells him to climb to. BackSide + fog so they sit in the same medium as
// everything else; no PBR, no lighting — at 200+ units through silt only the
// silhouette and the lichen survive.
// ---------------------------------------------------------------------------
// DROP is 22, not the drafted 12: the stride-3 subsample runs 25-40u cells over the
// rampart's rmf crests near the mesh corners, and the bilinear shell there sat up to
// 18u above the true surface — a player under it would have been inside the shell
// volume. Measured worst gap 18.0u (zone 1); 22 leaves 4u everywhere. The offset is
// invisible: at 231 units through 25% transmittance nothing about it reads.
const SHELL_STEP = 3, SHELL_DROP = 22;   // 288/3 = 96 quads/side, 97x97 verts
const roofShells = [];

function shellMat(alb) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uAlb: { value: new THREE.Color(alb) }
    }),
    vertexShader: /* glsl */`
      varying vec3 vWPos;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform vec3 uAlb;
      varying vec3 vWPos;
      float sh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float svn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = sh21(i), b = sh21(i + vec2(1.0, 0.0));
        float c = sh21(i + vec2(0.0, 1.0)), d = sh21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
      }
      float sfbm(vec2 p) {
        return svn(p) * 0.5 + svn(p * 2.13 + 19.7) * 0.27 + svn(p * 4.41 - 7.3) * 0.145;
      }
      void main() {
        // Broad tonal variation so the ceiling is not one flat card up close.
        vec3 col = uAlb * (0.78 + 0.44 * svn(vWPos.xz * 0.017));
        // Sparse lichen, 2.98 percent coverage measured at this threshold. The
        // emissive is load-bearing: a pure silhouette at 231 units sits near the
        // 8-bit detection floor, and these patches push it suprathreshold. Peak
        // channel 0.14 is half the bloom luminanceThreshold of 0.28, so it glows
        // and never flares.
        float m = smoothstep(0.46, 0.64, sfbm(vWPos.xz * 0.06));
        col += vec3(0.0824, 0.14, 0.1153) * m;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`
  });
}

const shellMats = [shellMat(0x0d1416), shellMat(0x121612)];

// ---------------------------------------------------------------------------
// Mesh. Graded axis mapping keeps ~1.7m spacing through the playable basin and
// coarsens out on the rim wall, which is only ever seen through heavy fog.
// HALF is 560, not WORLD_R*1.5 = 390: the mesh is a SQUARE, so its edge sits at
// only 390 on the axes, and the silt-line clear bands see 456/477 units in zones
// 1/2 — the player could see past the edge of the world, and the 340..540 rampart
// would lose its crest over 39% of bearings. The linear coefficient holds the
// inner sampling product at ~242 (was 390*0.62, now 560*0.432), so basin pitch is
// unchanged and the extra reach is paid for entirely by coarser rim quads (+31%).
// ---------------------------------------------------------------------------
const SEG = 288, HALF = 560;
const axisMap = u => HALF * (0.432 * u + 0.568 * u * u * u);

// The axis samples are pure topology — site changes never move a vertex in XZ, only
// in height — so they are computed once and shared by every fill.
const AX = (() => {
  const n = SEG + 1, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = axisMap((i / SEG) * 2 - 1);
  return a;
})();

// Topology once, heights per site. buildTerrain allocates the geometries and puts the
// meshes in the scene — that half must never run twice, because player.js and the
// render list hold the mesh and attribute references. fillTerrain owns everything the
// height functions derive and is the reseed entry point: setSite(i) then fillTerrain()
// under the black screen re-floors the basin in place.
export function buildTerrain() {
  if (terrainMeshes.length) { fillTerrain(); return; }

  for (let zi = 0; zi < 3; zi++) {
    // PlaneGeometry is used for its index/attribute topology only; every position is rewritten.
    const g = new THREE.PlaneGeometry(1, 1, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    const tm = new THREE.Mesh(g, zoneMats[zi]);
    tm.receiveShadow = true;
    scene.add(tm);
    terrainMeshes.push(tm);

    // Roof shell topology: built here (not lazily) so its material is in the scene
    // before the boot precompile and first sight never hitches.
    if (zi < 2) {
      const q = SEG / SHELL_STEP;
      const sg = new THREE.PlaneGeometry(1, 1, q, q);
      sg.rotateX(-Math.PI / 2);
      const sm = new THREE.Mesh(sg, shellMats[zi]);
      sm.visible = false;               // updateTerrain gates it; warmUp un-hides for compile
      scene.add(sm);
      roofShells.push(sm);
    }
  }

  fillTerrain();
}

// Everything downstream of terrainH, recomputed for the current site. Safe and
// complete to call again: every array it touches is refilled end to end, nothing is
// reallocated, and the temporaries below are load-time cost, not per-frame cost.
export function fillTerrain() {
  syncSite();
  buildClampTable();   // ~4.7k terrainH calls, vs the 250k the meshes below do

  const n = SEG + 1, ax = AX;

  for (let zi = 0; zi < 3; zi++) {
    const g = terrainMeshes[zi].geometry;
    const P = g.attributes.position.array, N = g.attributes.position.count;
    const H = new Float32Array(N), B = ZB[zi];

    for (let j = 0, i = 0; j < n; j++) {
      const z = ax[j];
      for (let k = 0; k < n; k++, i++) {
        const x = ax[k], h = terrainH(x, z, zi);
        H[i] = h; P[i * 3] = x; P[i * 3 + 1] = h; P[i * 3 + 2] = z;
      }
    }

    // Analytic grid normals — exact for a heightfield and far cheaper than computeVertexNormals.
    const NR = g.attributes.normal.array;
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const i = j * n + k;
      const k0 = k > 0 ? k - 1 : k, k1 = k < n - 1 ? k + 1 : k;
      const j0 = j > 0 ? j - 1 : j, j1 = j < n - 1 ? j + 1 : j;
      const nx = -(H[j * n + k1] - H[j * n + k0]) / (ax[k1] - ax[k0]);
      const nz = -(H[j1 * n + k] - H[j0 * n + k]) / (ax[j1] - ax[j0]);
      const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      NR[i * 3] = nx * il; NR[i * 3 + 1] = il; NR[i * 3 + 2] = nz * il;
    }

    // Multi-scale cavity occlusion baked from the grid. SSAO in the post stack only
    // reaches a few centimetres; this supplies the metre-to-decametre shading that
    // makes canyons and crevices read as deep.
    const ao = new Float32Array(N).fill(1);
    const rings = [2, 0.28, 7, 0.38, 20, 0.34];
    for (let s = 0; s < rings.length; s += 2) {
      const st = rings[s], wt = rings[s + 1];
      for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
        const km = k > st ? k - st : 0, kp = k + st < n ? k + st : n - 1;
        const jm = j > st ? j - st : 0, jp = j + st < n ? j + st : n - 1;
        const avg = (H[j * n + km] + H[j * n + kp] + H[jm * n + k] + H[jp * n + k] +
          H[jm * n + km] + H[jm * n + kp] + H[jp * n + km] + H[jp * n + kp]) * 0.125;
        const span = (ax[kp] - ax[km]) * 0.42 + 0.01;
        ao[j * n + k] -= c01((avg - H[j * n + k]) / span) * wt;
      }
    }

    const col = g.attributes.color.array;
    for (let j = 0, i = 0; j < n; j++) for (let k = 0; k < n; k++, i++) {
      const a = c01(ao[i]);
      col[i * 3] = 0.18 + 0.82 * a * a;
      col[i * 3 + 1] = c01(gn(ax[k] * 0.0135 + zi * 40, ax[j] * 0.0135 - zi * 17) * 1.5 + 0.5);
      // /220, not /70: at /70 the channel saturates 70 units up, so the 118-unit rim
      // read as one flat value and the new 65..184 skyline plus the rampart would get
      // no tonal separation at all.
      col[i * 3 + 2] = c01((H[i] - B - 2) / 220);
    }

    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.computeBoundingSphere();

    // Roof shell: subsample the H array just computed — SEG = 288 and 288/3 = 96
    // exactly, so a 97x97 stride-3 pick lands on real grid points. Zero extra
    // terrainH calls; the geometry is the one buildTerrain allocated, resampled in
    // place so the mesh the scene already holds follows the new floor.
    if (zi < 2) {
      const m = SEG / SHELL_STEP + 1;
      const sg = roofShells[zi].geometry;
      const SP = sg.attributes.position.array;
      for (let j = 0, i = 0; j < m; j++) for (let k = 0; k < m; k++, i++) {
        SP[i * 3] = ax[k * SHELL_STEP];
        SP[i * 3 + 1] = H[(j * SHELL_STEP) * n + k * SHELL_STEP] - SHELL_DROP;
        SP[i * 3 + 2] = ax[j * SHELL_STEP];
      }
      sg.attributes.position.needsUpdate = true;
      sg.computeBoundingSphere();
    }
  }
}

export function updateTerrain(dt, t, camY, sunK = 1) {
  causticsUniforms.uTime.value = t;
  causticsUniforms.uCamY.value = camY;
  // Caustics are sunlight. Night has none, an overcast gale has none — the same
  // day/storm factor the sky and key light already run on, or the floor sparkles
  // under a black sky.
  causticsUniforms.uSunK.value = sunK;
  causticsUniforms.uSunW.value.set(SUN.dirWater.x, SUN.dirWater.y, SUN.dirWater.z);
  // A shell only exists for the player in the zone BELOW it, looking up: on when the
  // camera is 40 under the parent floor, off again 340 under (past the next floor,
  // where the zone below's own shell takes over). From above, backfaces + early-z
  // make it free, so this gate is about draw-call hygiene, not correctness.
  for (let i = 0; i < roofShells.length; i++) {
    roofShells[i].visible = camY < ZB[i] - 40 && camY > ZB[i] - 340;
  }
}
