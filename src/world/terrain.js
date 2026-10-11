// Seafloor terrain: heightfield, mesh, triplanar PBR material, caustics. OWNED BY: terrain agent.
import * as THREE from 'three';
import { scene } from '../core.js';
import { WORLD_R, zoneTop, zoneBottom, zoneBand, ZONE_SEEN, SUN, GLASS } from '../config.js';
// WAVE-SLOPE CAUSTICS + SEABED SHADOW (roadmap/ref-caustics-shadow.md). Both are
// runtime-only reads of values those modules already resolve each frame (the wave field
// water.js publishes, the shadow mode lighting.js runs); nothing here is touched at
// module evaluation, so the import cycle through water.js -> lighting.js is inert.
import { waveLow } from './water.js';
import { floorShadow, playerLightSrc } from '../lighting.js';
import { canvas2d, noiseCanvas, normalFromHeight, toTexture } from '../lib/textures.js';
import { pbrUniforms, PBR_GLSL } from '../lib/triplanar.js';
import { siteParams, currentSiteIndex, stream } from './site.js';
import { buildIslands, fillIslands, updateIslands } from './islands.js';
import { FISSURE, fissureDist, slabProbe, SLABS, fissureWorld, fissureLocal, jamFloorAt, jamSagAt, fissureShut, _widths, _slabReach, APRON } from './fissureShape.js';

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
// Joint blocks for the fissure's broken lip and slumped faces: a 2.4 u grid turned 0.5 rad off the
// world axes, one hashed value per block, eased to 0.5 within 0.25 u of each joint so the field is
// continuous (the joints read as grooves, not as steps the mesh would alias).
function jointBlock(x, z) {
  const a = (x * 0.8776 - z * 0.4794) / 2.4, b = (x * 0.4794 + z * 0.8776) / 2.4;
  const ia = Math.floor(a), ib = Math.floor(b), fa = a - ia, fb = b - ib;
  const e = Math.min(fa, 1 - fa, fb, 1 - fb) * 2.4;
  const v = PERM[(ia & 255) + PERM[ib & 255]] / 255;
  const k = e < 0.25 ? e / 0.25 : 1;
  return 0.5 + (v - 0.5) * k;
}

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

const ZB = [zoneBottom(0), zoneBottom(1), zoneBottom(2)];
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
//
// OWN WATER, OWN GROUND (roadmap/fly-remote-sites.md, Michael 2026-10-04): a remote site
// may now also carry a `shape` row — per-zone overrides of the landform knobs above
// (ramp, s2amp, terrace...) plus the rim's height / span / crest-jag — so Pallid Bank
// reads as broad terraced chalk and the Burned Ground as jagged lava steps. Every
// override is restored from ZP0 (the shipped literals, snapshotted before the first
// sync) on every sync, so a voyage home lands on the exact shipped numbers. The new
// knobs' shipped values are identities: tflat 0 (terrace gated by the uplands only, as
// shipped), rimK 1, rimSpan RIM_SPAN, rimJag 30 — each enters terrainH in a form that is
// bit-exact at those values. RAM_H and the rampart's generation are NOT site knobs.
for (const P of ZP) { P.tflat = 0; P.rimK = 1; P.rimSpan = RIM_SPAN; P.rimJag = 30; P.rimIn = RIM_IN; }
const ZP0 = ZP.map(P => Object.assign({}, P));
// The floor palette per site (uniform multipliers on every zone's silt/gravel/rock, all
// ones at home). Shared by the three zone programs through COMMON below.
const SITE_PAL = {
  uSiteSilt: { value: new THREE.Vector3(1, 1, 1) },
  uSiteGrav: { value: new THREE.Vector3(1, 1, 1) },
  uSiteRock: { value: new THREE.Vector3(1, 1, 1) }
};
function syncSite() {
  const sp = siteParams(), t = sp.terra, sh = sp.shape;
  for (let zi = 0; zi < 3; zi++) {
    Object.assign(ZP[zi], ZP0[zi]);
    if (sh && sh.zp && sh.zp[zi]) Object.assign(ZP[zi], sh.zp[zi]);
    if (sh && sh.rim) {
      ZP[zi].rimK = sh.rim.h ?? 1;
      ZP[zi].rimSpan = RIM_SPAN * (sh.rim.span ?? 1);
      ZP[zi].rimJag = 30 * (sh.rim.jag ?? 1);
      ZP[zi].rimIn = RIM_IN + (sh.rim.out ?? 0);   // push the wall's foot outward (u)
    }
    ZP[zi].ox = t.off[zi][0];
    ZP[zi].oz = t.off[zi][1];
    const kr = t.rimKR[zi], kh = t.rimKH[zi];
    for (let k = 0; k < 6; k++) { RIM_KR[zi][k] = kr[k]; RIM_KH[zi][k] = kh[k]; }
  }
  const fl = sp.floor;
  const set = (u, m) => { if (m) u.value.set(m[0], m[1], m[2]); else u.value.set(1, 1, 1); };
  set(SITE_PAL.uSiteSilt, fl && fl.silt);
  set(SITE_PAL.uSiteGrav, fl && fl.grav);
  set(SITE_PAL.uSiteRock, fl && fl.rock);
  layIsles();
}

// Second ridgeline. Zero new triangles: the graded axisMap already samples out here.
// Zones 1/2 keep the W2 rampart exactly (their clear-band sightlines are what it is for).
const RAM_IN = 340, RAM_PK = 410, RAM_OUT = 540, RAM_H = 66;

// THE FAR RIDGE, zone 0 (roadmap/far-ridgeline-read.md, Michael 2026-10-04: "Raise it").
// The W2 rampart sat at 4.5% transmittance behind the rim's 13.1% and, worse, the
// drowned-shelf ceiling squashed every crest into one flat band at -21..-34 — measured
// from the pinned mid-water cameras the silhouette step across its skyline was 0.007-0.012
// linear luma: no edge, only the water's own vertical gradient. Three levers, all here:
//  - nearer: the envelope rises straight off the rim plateau and peaks at r 348, not 410,
//    so from 120 u off the raft at y -110 the crest is ~245 u away, not ~295 (green
//    transmittance ~7% vs ~4%: the extinction is 0.0105-0.0113 per unit from -5 to -150,
//    so distance is the only lever that buys contrast);
//  - higher and jagged: a harder ridged term plus a ~48 u crag term, and the ceiling over
//    it is SOFT (asymptotic to RIDGE.top, slope 1 where it engages at RIDGE.c0) instead of
//    the 0.15 kink, so the crest keeps peaks and notches (-9..-60 over 128 bearings, median
//    -23) instead of one flat band;
//  - paler: a carbonate drape on its upper faces (terrain shader, uDrape), so the wall
//    reads as a lighter shape behind the dark near rim — aerial perspective by albedo as
//    well as by distance. Faded in past ~100 u from the eye.
// Tuned from pinned mid-water frames (compare2/B_mid_*): far-ridge skyline Weber contrast
// 2.4-3.9% -> 3.9-12.2%. The near rim (r < RIDGE.in0 = 300) is untouched: weight 0 there.
export const RIDGE = { in0: 300, pk0: 348, out0: 540, h0: 74, j0: 44, j2: 28, top: -8, c0: -75, drape: 1, drapeK: 5.5 };

// THE FAR ISLANDS (same card: "Build a few far islands"). The rampart breaks the surface
// in two or three places per site: basalt stacks on a drowned shoal, ~390-430 u off the
// raft. terrainH carries only the SHOAL (a pedestal under each crown, soft-capped below
// the deepest storm trough so the seabed never pokes through the sea); the stacks that
// stand in the air are world/islands.js geometry, embedded down into this shoal.
// Layout is a pure function of the site index: a seeded stream, bearings >= 95 degrees
// apart. Filled in place by syncSite (no reallocation; islands.js reads it at fill time).
export const ISLES = [];
const ISLE_KINDS = ['crown', 'needle', 'teeth'];
const ISLE_TOP = -6.5;          // shoal asymptote: below a gale trough at ~400 u
function layIsles() {
  const si = currentSiteIndex();
  const rnd = stream(0x15AE7000 + si * 7919);
  const n = si === 0 ? 3 : 2 + (rnd() < 0.5 ? 1 : 0);
  let a = rnd() * Math.PI * 2;
  ISLES.length = 0;
  const kinds = ISLE_KINDS.slice();
  for (let i = 0; i < n; i++) {
    const r = 392 + rnd() * 36;
    const k = kinds.splice(Math.floor(rnd() * kinds.length), 1)[0];
    const rc = k === 'crown' ? 17 : k === 'needle' ? 11 : 15;
    ISLES.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, a, r, kind: k, rc,
      rIn: rc + 6, rOut: rc + 44, lift: 150, seed: (0x5EA57AC0 + si * 131 + i * 17) >>> 0 });
    a += (95 + rnd() * (360 / n - 95 + 20)) * Math.PI / 180;
  }
}
syncSite();

// Analytic height function. Mesh generation, prop scatter, and player collision all
// call this, so any change here changes what the player physically stands on.
export function terrainH(x, z, zi) { return heightAt(x, z, zi, true); }
// The ground UNDER the fissure's overhang slabs (the carved wall the patch draws beneath them):
// player.js stands him on it when he is below a slab, not on it. Equal to terrainH off the slabs.
export function terrainUnderH(x, z, zi) { return heightAt(x, z, zi, false); }
// THE SHUT FISSURE'S JAM is a floor that is not terrain (fissureShape.js jamFloorAt: the rubble's
// baked (u, v) grid, block tops and drifted silt, over the jamYAt profile): jamAt is its
// surface over (x, z) while the zone's fissure is shut and (x, z) is inside the lip outline, else
// -1e9. shutFloorY = the ground anything rests on there: max(terrainH, jam). Open, it is terrainH.
// Every reader of "the ground under X" that Sal can be over (hose nodes, spears, the sonar ring,
// the camera's clearance, player.js) uses these, not terrainH.
const _jl = { u: 0, v: 0 };
export function jamAt(x, z, zi) {
  const F = FISSURE[zi];
  if (!F || !fissureShut(zi)) return -1e9;
  const dx = x - F.cx, dz = z - F.cz;
  if (dx * dx + dz * dz > F.apronR2 || fissureDist(x, z, zi) >= 0) return -1e9;
  fissureLocal(x, z, zi, _jl);
  return jamFloorAt(_jl.u, _jl.v, zi, terrainH) - jamSagAt(_jl.u, _jl.v, zi);   // the rubble's baked floor; (the slump: 0 but mid-opening)
}
export function shutFloorY(x, z, zi) {
  const h = terrainH(x, z, zi), j = jamAt(x, z, zi);
  return j > h ? j : h;
}
// The ground with or without the fissure's overhang slabs: terrainH (collision, scatter, the
// patch's slab tops) stands on them; the fissure patch draws the carved wall UNDER them.
function heightAt(x, z, zi, slabs) {
  const P = ZP[zi];

  // THE FISSURE (spec 2026-10-10): a jagged crack carved along FISSURE[zi]; replaces the round funnel.
  // Cheap reject first: outside apronR2 the crack is >= 14 u away and changes nothing.
  const FZ = FISSURE[zi], fdx = x - FZ.cx, fdz = z - FZ.cz;
  const fd = fdx * fdx + fdz * fdz < FZ.apronR2 ? fissureDist(x, z, zi) : 1e3;   // < 0 inside the lip
  const fm = fd < APRON ? 1 - Math.min(1, Math.max(0, fd) / APRON) : 0;   // 14 u apron: ground eased toward the lip

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

  // tflat (a site knob, 0 at home) carries the strata out over the open ground too
  if (P.tamt > 0) h = terrace(h, P.tq, P.tamt * (P.tflat > 0 ? rk + P.tflat * (1 - rk) : rk));

  h += P.lift;
  // Soft floor: canyons must not dig below the zone-change trigger plane. It sits ABOVE the
  // fissure carving on purpose: the throat is the one place meant to go deeper.
  if (h < 4) h = 4 + (h - 4) * 0.25;

  if (fm > 0) {
    const F = FZ;
    // apron: flatten the landform near the crack so lips read as broken shelf, not noise
    const a = fm * fm * (3 - 2 * fm);
    h = h * (1 - 0.6 * a) + 18 * 0.6 * a;
    const lumps = fbm2(x * 0.11 + 7.7, z * 0.11 - 3.1, 2);                 // 9 u slumped blocks, ~-0.9..0.9
    // broken lip: the shelf heaves up a little at the edge before it fails, in blocks, so the
    // crack shows a lip line from standing height instead of vanishing into flat ground
    if (fd > -2 && fd < 7) { const q = (fd - 1.2) / 1.9; h += Math.exp(-q * q) * (1.7 + 1.3 * lumps); }
    if (fd < 0) {
      const s = -fd;
      // an overhang slab's top is ground that has not fallen yet: no carve, a slight lean outward.
      // The wall under and beyond it is set back by 1.3 x its reach (in BOTH modes, so drawn and
      // collision agree past its front), which is what leaves it overhanging the void.
      const sp = slabProbe(x, z, zi), q = sp.q, ru = Math.min(1, Math.max(0, (s - 1.1) / 0.6));
      const rs = 1.3 * sp.r * ru * ru * (3 - 2 * ru);   // ramps in from 1.1 u inside: a patch cell (<= 0.5 u, ~0.7 u diagonal, |grad fd| up to ~1.4 at the kinks) over the lip must not dip
      if (slabs && q >= 0) h -= 0.3 * s + 0.35 * q * q;
      else {
        // Drawn by the fissure patch at ~0.46 u (see buildFissurePatch), so the walls carry detail
        // the 2.3 u terrain grid could not: the lip breaks off in 2.4 u joint blocks at different
        // setbacks, the wall steps down in layered strata (1.5 u steps: a 0.9 u ledge, a 0.6 u
        // riser, wandering with depth), and slumped blocks sit on the faces. Where the crack pinches
        // toward its tips the wall never reaches full depth, so it shallows out instead of ending blunt.
        const bk = jointBlock(x, z);                                          // 0..1 per joint block
        const sl = Math.max(0, s + rs - 0.9 * bk);                            // broken lip setback (+ slab undercut)
        // the break eases in (smootherstep over 2 u): a linear cell straddling the lip must not
        // cut the corner Sal stands on (drawn-vs-collision on the lip band < 0.3 u)
        const lt = sl < 2 ? sl / 2 : 1, lip = lt * lt * lt * (lt * (lt * 6 - 15) + 10);
        const ss = Math.max(0, sl + 0.35 * gn(x * 0.13 + 3.1, z * 0.13 - 7.4));
        const n = Math.floor(ss / 1.5), f = ss / 1.5 - n;
        const r = f < 0.6 ? 0 : (f - 0.6) / 0.4;
        const st = (n + r * r * (3 - 2 * r)) * 1.5;                           // soft staircase in s
        const w = Math.min(1, Math.max(0, (st - 0.6) / 4.6)), wall = w * w * (3 - 2 * w);
        h -= F.lipDrop * lip + wall * (60 + st * 2.5) + lumps * 4 * wall      // ~60-80 u throat into black
           - (bk - 0.5) * 3.2 * wall * (1 - wall) * 4;                        // slumped blocks on the faces
      }
    }
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
  const rin = P.rimIn + 46 * c01(aR * 0.62 + 0.5);           // 176.8 .. 222.8 (+ a site's rim.out)
  const rh = RIM_H * P.rimK * (0.55 + 0.90 * c01(aH * 0.62 + 0.5));   // 64.9 .. 171.1 (x rimK)
  const rt = c01((rr - rin) / P.rimSpan);
  if (rt > 0) {
    const s = rt * rt * rt * (rt * (rt * 6 - 15) + 10);
    h += s * rh * (1.0 + fbm2(x * 0.0060 + 71, z * 0.0060 - 19, 3) * 0.55)
       + s * s * rmf(x * 0.0105 + 5, z * 0.0105 - 3, 3) * P.rimJag;
  }

  // Rampart: a second ridgeline 100+ units behind the rim crest, at roughly half its
  // luminance through the water — aerial perspective, and the wall that keeps the
  // clear-band sightlines (456/477 units in zones 1/2) from finding the mesh edge.
  // The upper bound is exact, not a fade cutoff: at rr >= RAM_OUT the envelope is
  // identically zero, and without the bound 11% of mesh samples (the corners) paid
  // six noise octaves for nothing. Zone 0 runs THE FAR RIDGE rows (RIDGE, above).
  const z0 = zi === 0;
  const rIn = z0 ? RIDGE.in0 : RAM_IN, rOut = z0 ? RIDGE.out0 : RAM_OUT;
  let sR = 0;
  if (rr > rIn && rr < rOut) {
    const rPk = z0 ? RIDGE.pk0 : RAM_PK;
    const up = c01((rr - rIn) / (rPk - rIn));
    const dn = c01((rr - rPk) / (rOut - rPk));
    sR = up * up * (3 - 2 * up) * (1 - dn * dn * (3 - 2 * dn));
    h += sR * (z0 ? RIDGE.h0 : RAM_H) * (1.0 + fbm2(x * 0.0042 + 133, z * 0.0042 - 61, 3) * 0.62)
       + sR * rmf(x * 0.0080 + 17, z * 0.0080 + 29, 3) * (z0 ? RIDGE.j0 : 22);
    // Zone 0 only: a ~48 u crag term, so the far skyline breaks into peaks and notches a
    // few degrees wide instead of the long smooth swells the 125 u ridging gives alone.
    if (z0) h += sR * rmf(x * 0.021 - 41, z * 0.021 + 7, 2) * RIDGE.j2;
  }
  // Drowned shelf edge: everything above y=-34 is compressed toward it, never folded.
  // The increasing form matters — the published `-34 - (h+34)*0.15` is monotone
  // DECREASING in h, which inverts every crest above the line into a crease and flips
  // terrainNormal's central differences along the whole far ridgeline. Only zone 0
  // can reach -34 (zones 1/2 top out near -320 and -630), so this fires nowhere else.
  if (z0 && rr > rIn) {
    // THE FAR RIDGE + ISLAND SHOALS. Over the rampart envelope (weight sR) and under each
    // island crown (weight wI) the ceiling is soft: identity below c0, asymptotic to its
    // top above, slope 1 where it engages, so peaks and saddles survive up to the top.
    // For a fixed (x, z) both forms are increasing in h and the weight is fixed, so the
    // blend is too: still never folded. Weight 0 is the shipped shelf exactly.
    let wI = 0;
    for (let i = 0; i < ISLES.length; i++) {
      const s = ISLES[i], dx = x - s.x, dz = z - s.z, d2 = dx * dx + dz * dz;
      if (d2 < s.rOut * s.rOut) {
        const t = c01((s.rOut - Math.sqrt(d2)) / (s.rOut - s.rIn)), k = t * t * (3 - 2 * t);
        h += k * s.lift;
        if (k > wI) wI = k;
      }
    }
    const w = sR > wI ? sR : wI;
    const old = h > -34 ? -34 + (h + 34) * 0.15 : h;
    if (w > 0) {
      const top = RIDGE.top + (ISLE_TOP - RIDGE.top) * wI, sc = top - RIDGE.c0;
      const soft = h > RIDGE.c0 ? top - sc * Math.exp(-(h - RIDGE.c0) / sc) : h;
      h = old + (soft - old) * w;
    } else h = old;
  } else if (h > -34) h = -34 + (h + 34) * 0.15;
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

// THE CHART's regression probe is terrainFingerprint() at the end of this file
// (window.__ridge.fp / __chart.fp — one canonical probe since 2026-10-04).

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
  uSunW: { value: new THREE.Vector3(SUN.dirWater.x, SUN.dirWater.y, SUN.dirWater.z) },
  // The two longest Gerstner components, mirrored from water.js's waveLow every frame:
  // (dir.x, dir.z, k, height amplitude) each, and (omega0, omega1, wave clock, 0).
  uWaveA: { value: new THREE.Vector4(1, 0, 0.1, 0) },
  uWaveB: { value: new THREE.Vector4(0, 1, 0.15, 0) },
  uWaveW: { value: new THREE.Vector4(0, 0, 0, 0) },
  // GLASS.seabed: (caustStr, caustScale, caustFollow, shadowAmbient), live.
  uCTune: { value: new THREE.Vector4(1, 1, 1, 0.45) }
};

// (sweep) the far ridge drape's top taper / grazing fade / range thinning (zone 0 only,
// gated by uDrape.x like the rest of it). window.__ridge.drape2 / drape3 for look-dev.
export const DRAPE2 = { value: new THREE.Vector4(-58, -14, 0.70, 1.0) };
export const DRAPE3 = { value: new THREE.Vector4(280, 460, 0.35, 0) };
const COMMON = {
  ...SITE_PAL,
  uDrape2: DRAPE2, uDrape3: DRAPE3,
  uDetail: { value: MAPS.detail },
  uRockN: { value: MAPS.rockN },
  uRipple: { value: MAPS.rippleN }
};

const FRAG_HEAD = PBR_GLSL + /* glsl */`
uniform sampler2D uDetail, uRockN, uRipple;
uniform vec3 uSilt, uGrav, uRock;
uniform vec3 uSiteSilt, uSiteGrav, uSiteRock;
uniform float uTime, uCamY, uCaust, uWet, uSunK;
uniform vec4 uDrape, uDrape2, uDrape3;
uniform vec3 uSunW;
uniform vec4 uWaveA, uWaveB, uWaveW, uCTune;
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

// THE THROAT WALLS' LAYER (fissure Task 5b). vWall = (u along the crack; the BED COORDINATE (wallBed:
// the bed's index + how far up it, the same beds the drawn strata are cut from); the wall weight, 0 in
// the seam band where the ribbon IS the patch's surface; the recess 0..1 + 2 on side 1). The beds are
// a function of height only, so their boundaries run level along the wall (fix round 1: 2-D noise
// stretched into bands drew wandering, closing contours: wood grain). The texture is projected on the
// crack's own frame (u, world y). Per zone: uWallHard / uWallSoft (the beds), uWallSilt (what runs
// down from each bed's top), uWallCrust (on the hard beds' tops and every up-turned face), uWallSoot
// (streaks down from the lip); uWallP = (the share of hard beds: STRATA's, soot, runs, crust);
// uWallG = (roughness hard / soft, the bed hash's seed, laminae contrast); uWallL = (laminae
// frequency in the bed coordinate, groove strength, photo normal strength); uWallTop: the lip band (soot); times the
// anchorage's rock tint (uSiteRock).
const WALL_HEAD = /* glsl */`
varying vec4 vWall;
uniform vec3 uWallHard, uWallSoft, uWallSilt, uWallCrust, uWallSoot;
uniform vec4 uWallP, uWallG;
uniform vec2 uWallAx;
uniform float uWallY, uWallTop;
uniform vec3 uWallL;
uniform sampler2D uWallN;
// terrain.js hash1 in uint math (bit for bit: the drawn strata and the shader agree on every bed)
float wHashI(int k, int s) {
  uint h = ((uint(k) ^ 0x9e3779b9u) * 0x85ebca6bu) ^ (uint(s) * 0xc2b2ae35u);
  h ^= h >> 13u; h *= 0x27d4eb2fu; h ^= h >> 16u;
  return float(h) * (1.0 / 4294967296.0);
}
`;
// where the wall layer rules (wk0 > 0.9) the terrain's own triplanar steps take their flat-ground
// path (one plane): its share there is a tenth at most, and on a wall face it paid for every plane
const WALL_0 = /* glsl */`
      float wk0 = vWall.z * (1.0 - smoothstep(0.68, 0.9, wn.y));
      bw = wk0 > 0.9 ? vec3(0.0, 1.0, 0.0) : bw;
`;
// albedo: the bed (hard or soft as drawn, a tone per bed), darker up under a hard bed's lip; laminae
// (1-D in the bed coordinate, a hair of wander along the crack); runs from each bed's top fading down
// it; soot streaks toward the lip; crust on the hard beds' tops and every up-turned face (and over
// the treads' silt). The noise is one baked tile (WALL_NOISE, 16 u).
const WALL_A = /* glsl */`
      float wk = wk0;
      float wu = vWall.x, wb = vWall.y, wside = step(1.5, vWall.w), wrec = vWall.w - 2.0 * wside;
      float wy = vWPos.y - uWallY;
      vec2 wq = vec2(wu, wy);
      float wkb = floor(wb), wf = wb - wkb;
      int wki = int(wkb), wsd = int(uWallG.z + 0.5);
      float whard = wHashI(wki, wsd) > uWallP.x ? 0.0 : 1.0, wtone = wHashI(wki, wsd + 28);
      float wlam = texture2D(uWallN, vec2(0.31 + wu * 0.004, wb * uWallL.x)).g;
      vec4 wn1 = texture2D(uWallN, wq * 0.0625);
      vec3 wA = mix(uWallSoft, uWallHard, whard) * (0.8 + 0.4 * wtone);
      // a soft bed is darkest up under the hard bed's lip: the undercut's roof in shadow
      wA *= (1.0 - 0.3 * wrec) * (1.0 - 0.35 * (1.0 - whard) * smoothstep(0.8, 0.98, wf));
      wA *= 1.0 - uWallG.w * 0.5 + uWallG.w * wlam;
      // the parting under each bed: a thin dark seam at its foot (antialiased on its own footprint)
      float wfw = fwidth(wb);
      wA *= 1.0 - (0.25 + uWallG.w) * (1.0 - smoothstep(0.0, 0.05 + 1.5 * wfw, wf)) * (1.0 - smoothstep(0.15, 0.6, wfw));
      float wrun = smoothstep(0.55, 0.85, wn1.b) * exp(-(1.0 - wf) * 2.2);
      wA = mix(wA, uWallSilt, clamp(wrun * uWallP.z, 0.0, 1.0));
      float wsoot = smoothstep(0.3, 0.62, texture2D(uWallN, vec2(wu * 0.033 + 0.23, wy * 0.012)).b) * smoothstep(-45.0, -6.0, vWPos.y - uWallTop);
      wA = mix(wA, uWallSoot, clamp(wsoot * uWallP.y, 0.0, 1.0));
      float wcr = max(whard * smoothstep(0.7, 0.95, wf), smoothstep(0.12, 0.55, wn.y)) * smoothstep(0.35, 0.62, wn1.a);
      wA = mix(wA, uWallCrust, clamp(wcr * uWallP.w, 0.0, 1.0));
      wA *= uSiteRock * (0.62 + 0.80 * mac.r) * (0.16 + 0.84 * ao);
      alb = mix(alb, wA, wk);
      alb = mix(alb, uWallCrust * uSiteRock * (0.16 + 0.84 * ao) * (0.75 + 0.5 * wn1.a),
                vWall.z * (1.0 - wk) * smoothstep(0.4, 0.75, wn1.a) * uWallP.w * 0.8);
`;
// structure: the rock channel of the photographed maps on the crack's frame
const WALL_B = /* glsl */`
      float aStrW = 2.0 * mix(ABYSSA_TEX(uPAlb, wq * PBR_NEAR).b, ABYSSA_TEX(uPAlb, wq * PBR_FAR).b, oct);
      float rStrW = 2.0 * mix(ABYSSA_TEX(uPRgh, wq * PBR_NEAR).b, ABYSSA_TEX(uPRgh, wq * PBR_FAR).b, oct);
      aStr = mix(aStr, aStrW, wk); rStr = mix(rStr, rStrW, wk);
`;
// relief on the crack's frame: the procedural rock normal, the photographed one damped and at its
// large scale only (near, under grazing light, it drew curvy streaks), the laminae as fine grooves.
// The tangent is horizontal in the face and turns with the side (cross(up, n), pointing +u on both
// walls), so a face turned along the crack (a tip, a block's end) keeps a steady one.
const WALL_C = /* glsl */`
      {
        vec3 wT0 = cross(vec3(0.0, 1.0, 0.0), wn);
        vec3 wT = wT0 * ((wside > 0.5 ? -1.0 : 1.0) / max(length(wT0), 1e-3));
        vec3 wB = normalize(vec3(0.0, 1.0, 0.0) - wn * wn.y + vec3(0.0, 1e-4, 0.0));
        vec3 n1 = texture2D(uRockN, wq * 0.062).xyz * 2.0 - 1.0;
        vec3 n2 = mix(ABYSSA_TEX(uPNR, wq * PBR_NEAR).xyz, ABYSSA_TEX(uPNR, wq * PBR_FAR).xyz, max(oct, uWallL.z < 0.4 ? 1.0 : 0.0)) * 2.0 - 1.0;
        float lg = (texture2D(uWallN, vec2(0.31 + wu * 0.004, (wb + 0.05) * uWallL.x)).g - wlam) * uWallL.y;
        vec2 dn = n1.xy * 0.5 + n2.xy * uTexAmt * uWallL.z + vec2(0.0, -lg);
        vec3 wN = normalize(wn + wT * dn.x + wB * dn.y);
        tN = normalize(mix(tN, wN, wk));
        // (the treads in the throat take the wall's roughness too: the terrain's wet rock glinted there)
        tRough = mix(tRough, mix(uWallG.y, uWallG.x, whard) * (0.85 + 0.15 * rStrW), wk);
        tRough = mix(tRough, uWallG.y, max(0.0, vWall.z - wk));
      }
`;
// One shared function object so all three zone materials hit the same program cache key.
// wall: the throat walls' variant (fissure Task 5b, program key 'fissureWall'): the same program
// plus the wall layer at the @W markers (comments in the terrain's own program).
function compileTerrain(sh, wall = false) {
  Object.assign(sh.uniforms, COMMON, pbrUniforms, causticsUniforms, sh.__zone);
  if (wall) Object.assign(sh.uniforms, sh.__wall);
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
      /*@W0*/
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

      // (uSite*: the anchorage's floor palette, exactly 1.0 at home)
      vec3 alb = uSilt * uSiteSilt * (0.68 + 0.64 * det.r) * siltW
               + uGrav * uSiteGrav * (0.55 + 0.85 * det.g) * gravW
               + uRock * uSiteRock * (0.46 + 0.95 * det.g) * rockW;
      alb *= 0.62 + 0.80 * mac.r;
      alb *= 0.16 + 0.84 * ao;
      // Slight up-facing bias so distant landforms keep some form under the flat
      // ambient-dominated rig instead of reading as flat cutouts.
      alb *= 0.86 + 0.20 * max(0.0, wn.y) + 0.10 * hb;
      // THE FAR RIDGE's carbonate drape (zone 0 only: uDrape is 0 on the other two, and
      // the radial gate starts past the near rim). Pale sediment settles on the upper
      // faces of the rampart, so behind the dark near rim it reads as a lighter wall.
      // Faded in with distance from the eye: near the surface the caustics already light
      // the crest, and drape plus caustics at arm's length read as snow (measured at 5.0
      // from r = 300, y = -30).
      if (uDrape.x > 0.0) {
        // (sweep) NOT A STRIPE. The drape rose to full strength at the top of every face, so
        // from mid-water the last few metres under the skyline were the palest thing on the
        // ridge, brighter than the water above it (measured: a +3.3-code band along the crest
        // where the face below was darker) -- a bright line drawn round the basin. The pale
        // now builds up the face and eases back over the top metres (uDrape2.x..y keeps
        // 1 - uDrape2.z there), fades where a face is seen edge-on (uDrape2.w: the grazing
        // band that compresses into a line), and thins with range (uDrape3.x..y keeps
        // 1 - uDrape3.z), so the ridge reads as a paler MASS.
        float dEye = length(vWPos - cameraPosition);
        float dUp = smoothstep(0.15, 0.75, wn.y);
        float dGraze = mix(1.0, smoothstep(0.04, 0.30, abs(dot(normalize(cameraPosition - vWPos), wn))), uDrape2.w);
        float dr = uDrape.x * smoothstep(uDrape.y, uDrape.z, length(vWPos.xz))
                 * smoothstep(-90.0, -35.0, vWPos.y) * (1.0 - uDrape2.z * smoothstep(uDrape2.x, uDrape2.y, vWPos.y))
                 * (0.45 + 0.55 * dUp) * dGraze
                 // a far read: within ~100 u the ridge is just rock and silt like the rest
                 * smoothstep(70.0, 170.0, dEye) * (1.0 - uDrape3.z * smoothstep(uDrape3.x, uDrape3.y, dEye));
        alb = mix(alb, uSilt * uDrape.w * (0.75 + 0.5 * det.r), dr);
      }

      /*@WA*/
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
      /*@WB*/
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
      // Footprint fade for the fine grain (repeat 1.6 u): once a texel of it is smaller
      // than a pixel it aliases into per-pixel speckle -- the sand's share of the 'grainy'
      // report. Taken here, outside the branch, so the derivatives stay defined.
      float gfp = 1.0 - smoothstep(0.35, 1.0, length(fwidth(vWPos.xz * 0.63)) * 24.0);
      if (mf > 0.01) {
        vec3 r1 = texture2D(uRipple, vWPos.xz * 0.085).xyz * 2.0 - 1.0;
        vec3 r2 = texture2D(uRipple, vWPos.zx * 0.63).xyz * 2.0 - 1.0;
        float k = mf * (0.22 + 1.05 * siltW);
        tN = normalize(tN + vec3(r1.x * 1.15 + r2.x * 0.45 * gfp, 0.0, r1.y * 1.15 + r2.y * 0.45 * gfp) * k);
      }
      /*@WC*/`)
    // The sky light is blocked too: under a boulder or the Brooder's belly the
    // hemisphere and ambient terms are what remain once the direct sun is gone, and at
    // 240 u they are most of the floor's light — an unshaded indirect left the shadow a
    // 15% tint (measured). GLASS.seabed.shadowAmbient is how much of it the map takes.
    .replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
      reflectedLight.indirectDiffuse *= mix(1.0, seabedSh, uCTune.w);`)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
    .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);')
    .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      // SEABED SHADOW. The sun's shadow map (lighting.js, re-aimed over the floor in
      // zone 0), sampled once here with the same 5-tap PCF the lit term uses, so the
      // caustic lace and the direct light share one edge. Above -26 the map is the
      // raft box and every floor fragment is outside it: getShadow returns 1. In
      // zones 1-2 the sun casts no map at all and this whole branch is not compiled.
      float seabedSh = 1.0;
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        seabedSh = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
      #endif
      {
        // Calibrated so the zone-0 seafloor (~-240) still catches light and zone 1 is nearly dark.
        float depth01 = clamp((-vWPos.y - 110.0) / 380.0, 0.0, 1.0);
        float fade = 1.0 - depth01; fade *= fade;
        fade *= clamp(1.0 + (uCamY + 60.0) / 460.0, 0.12, 1.0);
        fade *= max(0.0, wn.y) * ao * uCaust * uSunK * (0.35 + 0.9 * mac.b);
        fade *= uCTune.x;
        if (fade > 0.002) {
          // WAVE-SLOPE CAUSTICS. The sun ray that lands on this fragment crossed the
          // surface at sp (uSunW points up-sun, Snell-clamped). The surface gradient
          // there, from the two longest components of the SAME field the sea mesh runs
          // (water.js publishes bearing, k, height amplitude and omega each frame),
          // bends the ray by roughly (n - 1) times the slope, and the lace on the
          // floor moves by that times the depth: a calm 62 u swell walks it ~2 u, a
          // gale stretches it by 10+. Zero extra taps, two cosines.
          vec2 sp = vWPos.xz - uSunW.xz * (vWPos.y / max(0.25, uSunW.y));
          float pa = dot(sp, uWaveA.xy) * uWaveA.z + uWaveW.x * uWaveW.z;
          float pb = dot(sp, uWaveB.xy) * uWaveB.z + uWaveW.y * uWaveW.z;
          vec2 grad = uWaveA.xy * (uWaveA.z * uWaveA.w * cos(pa))
                    + uWaveB.xy * (uWaveB.z * uWaveB.w * cos(pb));
          vec2 off = grad * (uCTune.z * 0.33 * clamp(-vWPos.y, 0.0, 300.0));
          vec2 cp = (vWPos.xz + off) * mix(0.155, 0.075, depth01) * uCTune.y;
          // Focused sunlight is still sunlight: where a rock or the Brooder is in the
          // way, the lace goes out too. The 0.12 floor is the water column scattering
          // a little light under everything.
          float csh = 0.12 + 0.88 * seabedSh;
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
                                 * fade * csh * 0.90 * (0.22 + 0.78 * ndl);
        }
      }`);
  if (wall) {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aW; varying vec4 vWall;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n      vWall = aW;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WALL_HEAD)
      .replace('/*@W0*/', WALL_0).replace('/*@WA*/', WALL_A).replace('/*@WB*/', WALL_B).replace('/*@WC*/', WALL_C);
  }
}

function zoneMat(silt, grav, rock, caust, wet, drape = 0) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, dithering: true });
  // SEABED SHADOW: three draws the BACK faces of a caster into a PCF shadow map (its
  // acne defence), and a heightfield seen from the sun has none, so the floor wrote
  // nothing into the map — measured: rocks and the Brooder present, terrain absent.
  // Front faces here; the map's bias/normalBias (GLASS.seabed) carry the acne instead.
  m.shadowSide = THREE.FrontSide;
  const u = {
    uSilt: { value: new THREE.Color(silt) },
    uGrav: { value: new THREE.Color(grav) },
    uRock: { value: new THREE.Color(rock) },
    uCaust: { value: caust },
    uWet: { value: wet },
    uDrape: { value: new THREE.Vector4(drape, 0, 1, 1) }
  };
  m.onBeforeCompile = sh => { sh.__zone = u; compileTerrain(sh); };
  m.userData.zoneU = u;
  return m;
}

const zoneMats = [
  // Deeper zones carry higher albedo on purpose: they receive almost no light, and at
  // the zone-0 values they render as flat black rather than as dark stone.
  zoneMat(0x3f4744, 0x242c2f, 0x131c23, 1.0, 0.58, 1),   // 0 — pale carbonate silt, cool wet stone
  zoneMat(0x4c4c3a, 0x30352a, 0x1d251f, 0.45, 0.52),  // 1 — olive sediment over broken green-grey rock
  zoneMat(0x513f33, 0x322a26, 0x22171a, 0.12, 0.44)   // 2 — ash and scorched basalt
];

export const terrainMat = zoneMats[0];

// (the throat walls' beds: wallBed / wallRecess below, and the shader's hard-bed share)
const STRATA = [
  { t: 3.2, j: 0.4, hard: 0.62, cut: 1.0, blk: 3.6, bk: 0.3 },    // 0: pale limestone, even beds, deep notches
  { t: 2.6, j: 0.5, hard: 0.6, cut: 0.75, blk: 2.4, bk: 0.5 },    // 1: scorched, broken and blocky
  { t: 4.8, j: 0.25, hard: 0.7, cut: 0.6, blk: 1.4, bk: 0.5 },    // 2: black basalt: thick flows, columns
];
// THE THROAT WALLS' materials (fissure Task 5b): the zone's own terrain material (its uniforms, its
// palette, the anchorage's tint) plus the wall layer, one program for all three ('fissureWall').
// Pushed back a hair (polygon offset) under the kept patch at the seam band, where the ribbon lies
// WALL_SINK under it.
// per zone: the hard and soft beds, the runs, the crust, the soot; P: (soot, runs, crust) with the
// hard beds' share taken from STRATA; G: roughness hard / soft, laminae contrast; L: laminae per bed
// unit (x 26 in the tile), their grooves' strength, the photographed rock normal's strength (under
// 0.4 it reads at its large scale only: zone 1's grazing light turned the near one into curvy streaks).
const WALL_LOOK = [
  // 0: pale limestone, sand run down the faces and drifted on the ledges, no soot
  { hard: 0x676a62, soft: 0x40443f, silt: 0x7e7f72, crust: 0x8a8a7c, soot: 0x2a2c2a, P: [0.0, 0.45, 0.3], G: [0.80, 0.95, 0.13], L: [0.19, 0.5, 0.7] },
  // 1: scorched black-grey: soot down from the lip, sulphur running from the beds, rust crust on the
  //    ledges and the hard beds' tops (dry, matte)
  { hard: 0x1f232b, soft: 0x111317, silt: 0x5e5428, crust: 0x5a2c17, soot: 0x040405, P: [0.85, 0.45, 0.8], G: [0.9, 0.97, 0.06], L: [0.1, 0.15, 0.25] },
  // 2: black glassy basalt: glass on the hard flows, a little grey silt, faint soot
  { hard: 0x1a191e, soft: 0x100f13, silt: 0x2c2a30, crust: 0x2a2436, soot: 0x050507, P: [0.2, 0.2, 0.12], G: [0.55, 0.78, 0.12], L: [0.25, 0.4, 0.7] },
];
// THE WALLS' NOISE: one 16 u tile (256 texels), tileable (pn), every channel stretched for its job:
// r the beds' tone (slow along the crack, ~3 u down the face), g the laminae (~0.6 u down the face),
// b the silt runs (narrow along the crack, long down the face), a the crust blotches.
const WALL_NOISE = (() => {
  const S = 256, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, o = (y * S + x) * 4;
    const bed = pn(u * 2, v * 5, 5) * 0.75 + pn(u * 4 + 3, v * 11, 11) * 0.25;
    const lam = pn(u * 3, v * 26, 26) * 0.6 + pn(u * 7 + 5, v * 53, 53) * 0.4;
    const run = pn(u * 29, v * 2, 2) * 0.7 + pn(u * 61 + 7, v * 5, 5) * 0.3;
    const cru = pn(u * 7, v * 9, 9) * 0.6 + pn(u * 17 + 2, v * 21, 21) * 0.4;
    d[o] = c01(bed * 1.6 + 0.5) * 255; d[o + 1] = c01(lam * 1.6 + 0.5) * 255; d[o + 2] = c01(run * 1.6 + 0.5) * 255; d[o + 3] = c01(cru * 1.6 + 0.5) * 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
})();
function wallMat(zi) {
  const zm = zoneMats[zi], L = WALL_LOOK[zi], F = FISSURE[zi];
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, dithering: true });
  m.shadowSide = THREE.FrontSide;
  m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1;
  const w = {
    uWallHard: { value: new THREE.Color(L.hard) }, uWallSoft: { value: new THREE.Color(L.soft) },
    uWallSilt: { value: new THREE.Color(L.silt) }, uWallCrust: { value: new THREE.Color(L.crust) }, uWallSoot: { value: new THREE.Color(L.soot) },
    uWallP: { value: new THREE.Vector4(STRATA[zi].hard, L.P[0], L.P[1], L.P[2]) },
    uWallG: { value: new THREE.Vector4(L.G[0], L.G[1], 23 + zi, L.G[2]) },   // z: the bed hash's seed (wallRecess: hash1(kb, 23 + zi))
    uWallAx: { value: new THREE.Vector2(F.dx, F.dz) }, uWallY: { value: ZB[zi] }, uWallTop: { value: 0 }, uWallN: { value: WALL_NOISE }, uWallL: { value: new THREE.Vector3(...L.L) }
  };
  m.onBeforeCompile = sh => { sh.__zone = zm.userData.zoneU; sh.__wall = w; compileTerrain(sh, true); };
  m.customProgramCacheKey = () => 'fissureWall';
  m.userData.wallU = w;
  return m;
}
const wallMats = [0, 1, 2].map(wallMat);

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
// THE FISSURE (Task 4, I2 / N0 / N3): the roof shell is cut ALONG THE CRACK'S OUTLINE. Every coarse
// cell that comes within SHELL_TOUCH of the crack is taken out of the coarse index and redrawn as a
// fine COLLAR (SHELL_FINE grid) of which only the triangles outside the outline (fissureDist >
// SHELL_EDGE) are kept, at the true ground less SHELL_DROP; so the opening is the crack's own shape,
// the shell never hangs the carve's keel down as blades, and nothing lids the throat. The collar's
// border vertices on an edge shared with an uncut cell follow that edge exactly (watertight).
const SHELL_TOUCH = 2, SHELL_EDGE = 0.3, SHELL_FINE = 0.8;
const shellCollars = [];
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

// ---------------------------------------------------------------------------
// THE FISSURE PATCH (fix round 1; controller ruling: "what is drawn IS what Sal stands on").
// The 2.3 u terrain grid cannot hold a 13 u crack: its lips aliased into a sawtooth and the drawn
// lip sat up to 23 u off the collision lip. Around each zone's crack (the lip outline + its 14 u
// apron + 3 u) the coarse cells are cut out of the terrain's index and redrawn here, every cell
// split mx x mz (<= 0.5 u) and sampled from the same height function Sal stands on. The patch is
// the terrain's OWN material (vertex colours in its encoding: r cavity AO, g macro rock bias,
// b height above the basin floor), so it IS terrain: same program (nothing new to compile in the
// boot tail), same palette, caustics, drape; visibility and shadow casting follow the zone's mesh.
// Seam: a patch vertex on a coarse edge shared with an un-refined cell takes the coarse
// triangle's height, normal and colour there, so the two meshes meet edge-exactly.
// The overhang SLABS (fissureShape.js SLABS) are appended to the same geometry: their tops are
// terrainH (the ground stands on them); the patch under them draws the carved wall (heightAt with
// slabs off), so the undercut shows.
// Cell rule is site-independent (FISSURE never moves), so topology is built once; fillTerrain
// refills heights per site in place.
const PATCH_STEP = 0.5, PATCH_FD = 17;
const fissurePatches = [];
function axSearch(A, v) {           // last index i with A[i] <= v, clamped to [0, A.length - 2]
  let lo = 0, hi = A.length - 2;
  if (v <= A[0]) return 0;
  if (v >= A[hi + 1]) return hi;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m] <= v) lo = m; else hi = m - 1; }
  return lo;
}
const SLAB_NU = 10, SLAB_NS = 4, SLAB_TRIS = SLAB_NU * SLAB_NS * 4 + SLAB_NU * 4;
// Each coarse column/row is split into its OWN ceil(width / 0.5) steps (the grid's spacing varies
// 1.7-2.9 u here), so no part of the patch is denser than the ruling's 0.5 u needs.
// ONE mesh per zone (slabs included): cut into 8x8 / 16x16-cell chunks so the frustum and the
// lantern's cube faces could cull pieces, it cost MORE (paired live A/B at the zone-0 lip, patch vs
// the uncut coarse terrain: one mesh +0.11..0.20 ms, 16-cell chunks +0.25, 8-cell +0.38..0.44): the
// draw calls (61 shadow + 16 colour at 8 cells) outweigh the triangles they cull. PATCH_CHUNK
// keeps the split available should that ever change.
const PATCH_CHUNK = 1 << 20;
let PATCH_ON = true;
function splitAxis(ax, c0, c1) {        // fine axis over coarse lines c0..c1: values, coarse line, sub index
  let n = 1; const m = [];
  for (let c = c0; c < c1; c++) { const k = Math.ceil((ax[c + 1] - ax[c]) / PATCH_STEP); m.push(k); n += k; }
  const V = new Float64Array(n), K = new Int32Array(n), I = new Int32Array(n), S = new Int32Array(c1 - c0 + 1);
  let a = 0;
  for (let c = c0; c < c1; c++) {
    const k = m[c - c0]; S[c - c0] = a;
    for (let i = 0; i < k; i++, a++) { V[a] = i === 0 ? ax[c] : ax[c] + (ax[c + 1] - ax[c]) * i / k; K[a] = c; I[a] = i; }
  }
  S[c1 - c0] = a; V[a] = ax[c1]; K[a] = c1; I[a] = 0;
  return { V, K, I, S, m, n };
}
function buildFissurePatch(zi, g) {
  const ax = AX, n = SEG + 1, F = FISSURE[zi], R = Math.sqrt(F.apronR2) + 6;
  const ka = axSearch(ax, F.cx - R), kb = axSearch(ax, F.cx + R), ja = axSearch(ax, F.cz - R), jb = axSearch(ax, F.cz + R);
  let k0 = SEG, k1 = 0, j0 = SEG, j1 = 0;
  const ref = new Uint8Array(SEG * SEG);           // per coarse cell (k, j): refined
  for (let j = ja; j <= jb; j++) for (let k = ka; k <= kb; k++) {
    const dx = ax[k + 1] - ax[k], dz = ax[j + 1] - ax[j];
    const fd = fissureDist((ax[k] + ax[k + 1]) * 0.5, (ax[j] + ax[j + 1]) * 0.5, zi);
    if (fd < PATCH_FD + 0.6 * Math.hypot(dx, dz)) {
      ref[j * SEG + k] = 1;
      if (k < k0) k0 = k; if (k + 1 > k1) k1 = k + 1; if (j < j0) j0 = j; if (j + 1 > j1) j1 = j + 1;
    }
  }
  const XA = splitAxis(ax, k0, k1), ZA = splitAxis(ax, j0, j1);
  const nfx = XA.n, nfz = ZA.n, FX = XA.V, FZ = ZA.V;
  const isRef = (k, j) => k >= k0 && k < k1 && j >= j0 && j < j1 && ref[j * SEG + k] === 1;
  // compact vertex map: only vertices of refined cells
  const vmap = new Int32Array(nfx * nfz).fill(-1);
  let nv = 0, nq = 0, nsub = 0;
  for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) if (ref[j * SEG + k]) {
    nq++;
    const as = XA.S[k - k0], bs = ZA.S[j - j0], mxk = XA.m[k - k0], mzj = ZA.m[j - j0];
    nsub += mxk * mzj;
    for (let jj = 0; jj <= mzj; jj++) for (let ii = 0; ii <= mxk; ii++) {
      const id = (bs + jj) * nfx + as + ii;
      if (vmap[id] < 0) vmap[id] = nv++;
    }
  }
  // per compact vertex: its fine (a, b), and whether it sits on the seam with the coarse mesh
  const va = new Int32Array(nv), vb = new Int32Array(nv), bnd = new Uint8Array(nv);
  for (let b = 0; b < nfz; b++) for (let a = 0; a < nfx; a++) {
    const v = vmap[b * nfx + a]; if (v < 0) continue;
    va[v] = a; vb[v] = b;
    const ia = XA.I[a], ib = ZA.I[b], kc = XA.K[a], jc = ZA.K[b];
    let all = true;
    if (ia === 0 && ib === 0) all = isRef(kc - 1, jc - 1) && isRef(kc, jc - 1) && isRef(kc - 1, jc) && isRef(kc, jc);
    else if (ia === 0) all = isRef(kc - 1, jc) && isRef(kc, jc);
    else if (ib === 0) all = isRef(kc, jc - 1) && isRef(kc, jc);
    bnd[v] = all ? 0 : 1;
  }
  const L = SLABS[zi], nsv = L.length * SLAB_TRIS * 3;
  const pos = new THREE.BufferAttribute(new Float32Array((nv + nsv) * 3), 3);
  const nor = new THREE.BufferAttribute(new Float32Array((nv + nsv) * 3), 3);
  const col = new THREE.BufferAttribute(new Float32Array((nv + nsv) * 3), 3);
  // chunks: count, then fill each chunk's index
  const ncx = Math.ceil((k1 - k0) / PATCH_CHUNK), ncz = Math.ceil((j1 - j0) / PATCH_CHUNK);
  const cnt = new Int32Array(ncx * ncz);
  for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) if (ref[j * SEG + k])
    cnt[Math.floor((j - j0) / PATCH_CHUNK) * ncx + Math.floor((k - k0) / PATCH_CHUNK)] += XA.m[k - k0] * ZA.m[j - j0] * 6;
  const IX = [], fill = new Int32Array(ncx * ncz);
  for (let c = 0; c < cnt.length; c++) IX.push(cnt[c] ? new Uint32Array(cnt[c]) : null);
  for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) if (ref[j * SEG + k]) {
    const ci = Math.floor((j - j0) / PATCH_CHUNK) * ncx + Math.floor((k - k0) / PATCH_CHUNK), I = IX[ci];
    let t = fill[ci];
    const as = XA.S[k - k0], bs = ZA.S[j - j0];
    for (let jj = 0; jj < ZA.m[j - j0]; jj++) for (let ii = 0; ii < XA.m[k - k0]; ii++) {
      const a = as + ii, b = bs + jj;
      const A = vmap[b * nfx + a], B = vmap[(b + 1) * nfx + a], C = vmap[(b + 1) * nfx + a + 1], D = vmap[b * nfx + a + 1];
      I[t++] = A; I[t++] = B; I[t++] = D; I[t++] = B; I[t++] = C; I[t++] = D;   // the coarse winding (up)
    }
    fill[ci] = t;
  }
  // slab triangles (their own vertices, flat shaded) ride in the first chunk: no draw of their own
  const c0 = IX.findIndex(I => I), merged = new Uint32Array(IX[c0].length + nsv);
  merged.set(IX[c0]);
  for (let i = 0; i < nsv; i++) merged[IX[c0].length + i] = nv + i;
  IX[c0] = merged;
  const group = new THREE.Group();
  group.name = 'fissurePatch' + zi;
  const meshes = [];
  for (const I of IX) {
    if (!I) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', pos); geo.setAttribute('normal', nor); geo.setAttribute('color', col);
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.boundingSphere = new THREE.Sphere();          // set per fill from the chunk's own vertices
    const m = new THREE.Mesh(geo, zoneMats[zi]);
    m.receiveShadow = true;
    m.name = 'fissurePatch' + zi;
    group.add(m); meshes.push(m);
  }
  scene.add(group);
  // cut the refined cells out of the coarse mesh (PlaneGeometry order: a = k + n j, faces abd, bcd)
  const keep = new Uint32Array((SEG * SEG - nq) * 6);
  let c = 0;
  for (let j = 0; j < SEG; j++) for (let k = 0; k < SEG; k++) {
    if (ref[j * SEG + k]) continue;
    const a = k + n * j, b = k + n * (j + 1), cc = k + 1 + n * (j + 1), d = k + 1 + n * j;
    keep[c++] = a; keep[c++] = b; keep[c++] = d; keep[c++] = b; keep[c++] = cc; keep[c++] = d;
  }
  const fullIdx = g.index;
  g.setIndex(new THREE.BufferAttribute(keep, 1));
  fissurePatches[zi] = { coarse: g, fullIdx, cutIdx: g.index, group, meshes, pos, nor, col, ref, k0, k1, j0, j1, XA, ZA, nfx, nfz, FX, FZ, vmap, va, vb, bnd, nv, nsv,
    HF: new Float32Array(nfx * nfz), cells: nq, tris: nsub * 2 + nsv / 3 };
}

// Coarse triangle interpolation (the terrain mesh's own split of a cell) of a per-vertex array.
function coarseLerp(Arr, stride, off, k, j, x, z) {
  const ax = AX, n = SEG + 1;
  const fx = (x - ax[k]) / (ax[k + 1] - ax[k]), fz = (z - ax[j]) / (ax[j + 1] - ax[j]);
  const ia = j * n + k, ib = (j + 1) * n + k, ic = (j + 1) * n + k + 1, id = j * n + k + 1;
  if (fx + fz <= 1) return Arr[ia * stride + off] * (1 - fx - fz) + Arr[ib * stride + off] * fz + Arr[id * stride + off] * fx;
  return Arr[ib * stride + off] * (1 - fx) + Arr[ic * stride + off] * (fx + fz - 1) + Arr[id * stride + off] * (1 - fz);
}
const AO_RINGS = [1.4, 0.22, 4.6, 0.28, 16, 0.38, 46, 0.34];
function fillFissurePatch(zi, H, NR, COL) {
  const Q = fissurePatches[zi]; if (!Q) return;
  const { FX, FZ, nfx, nfz, XA, ZA, vmap, va, vb, bnd, nv, HF } = Q, B = ZB[zi], ax = AX;
  const P = Q.pos.array, NN = Q.nor.array, CC = Q.col.array;
  const cellK = a => Math.min(SEG - 1, XA.K[a]), cellJ = b => Math.min(SEG - 1, ZA.K[b]);
  // heights: refined interior from the height function; seam + the rest of the block from the coarse mesh
  for (let b = 0; b < nfz; b++) for (let a = 0; a < nfx; a++) {
    const v = vmap[b * nfx + a], x = FX[a], z = FZ[b];
    HF[b * nfx + a] = v >= 0 && !bnd[v] ? heightAt(x, z, zi, false) : coarseLerp(H, 1, 0, cellK(a), cellJ(b), x, z);
  }
  // height at a fine-grid index (AO rings): the block's own value inside it, the coarse mesh outside
  const hIdx = (a2, b2, x2, z2) => (a2 >= 0 && a2 < nfx && b2 >= 0 && b2 < nfz) ? HF[b2 * nfx + a2]
    : coarseLerp(H, 1, 0, axSearch(ax, x2), axSearch(ax, z2), x2, z2);
  for (let v = 0; v < nv; v++) {
    const a = va[v], b = vb[v], x = FX[a], z = FZ[b], h = HF[b * nfx + a];
    P[v * 3] = x; P[v * 3 + 1] = h; P[v * 3 + 2] = z;
    const kc = cellK(a), jc = cellJ(b);
    if (bnd[v]) {
      let nx = coarseLerp(NR, 3, 0, kc, jc, x, z), ny = coarseLerp(NR, 3, 1, kc, jc, x, z), nz = coarseLerp(NR, 3, 2, kc, jc, x, z);
      const il = 1 / Math.hypot(nx, ny, nz);
      NN[v * 3] = nx * il; NN[v * 3 + 1] = ny * il; NN[v * 3 + 2] = nz * il;
      for (let ch = 0; ch < 3; ch++) CC[v * 3 + ch] = coarseLerp(COL, 3, ch, kc, jc, x, z);
      continue;
    }
    const a0 = a - 1, a1 = a + 1, b0 = b - 1, b1 = b + 1;      // interior: all four neighbours exist
    const nx = -(HF[b * nfx + a1] - HF[b * nfx + a0]) / (FX[a1] - FX[a0]);
    const nz = -(HF[b1 * nfx + a] - HF[b0 * nfx + a]) / (FZ[b1] - FZ[b0]);
    const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    NN[v * 3] = nx * il; NN[v * 3 + 1] = il; NN[v * 3 + 2] = nz * il;
    // cavity AO on world-unit rings (the coarse bake's 4.6 / 16 / 46 u plus a 1.4 u crevice ring),
    // eased to the coarse colours toward the seam so the tone never steps there
    // (ring offsets in fine-grid steps at this vertex's own spacing: the grid is uniform within a
    // coarse cell and nearly so across neighbours, and this keeps the fill free of searches)
    const sxl = FX[a1] - FX[a], szl = FZ[b1] - FZ[b];
    let ao = 1;
    for (let r = 0; r < AO_RINGS.length; r += 2) {
      const d = AO_RINGS[r], wt = AO_RINGS[r + 1], e = d * 0.7071;
      const da = Math.round(d / sxl), db = Math.round(d / szl), ea = Math.round(e / sxl), eb = Math.round(e / szl);
      const avg = (hIdx(a - da, b, x - d, z) + hIdx(a + da, b, x + d, z) + hIdx(a, b - db, x, z - d) + hIdx(a, b + db, x, z + d) +
        hIdx(a - ea, b - eb, x - e, z - e) + hIdx(a + ea, b - eb, x + e, z - e) + hIdx(a - ea, b + eb, x - e, z + e) +
        hIdx(a + ea, b + eb, x + e, z + e)) * 0.125;
      ao -= c01((avg - h) / (2 * d * 0.42 + 0.01)) * wt;
    }
    const aa = c01(ao), wB = c01((fissureDist(x, z, zi) - (PATCH_FD - 4)) / 3);
    const r0 = 0.18 + 0.82 * aa * aa, g0 = c01(gn(x * 0.0135 + zi * 40, z * 0.0135 - zi * 17) * 1.5 + 0.5);
    CC[v * 3] = r0 + (coarseLerp(COL, 3, 0, kc, jc, x, z) - r0) * wB;
    CC[v * 3 + 1] = g0 + (coarseLerp(COL, 3, 1, kc, jc, x, z) - g0) * wB;
    CC[v * 3 + 2] = c01((h - B - 2) / 220);
  }
  fillSlabs(zi, Q, P, NN, CC, nv);
  Q.pos.needsUpdate = true; Q.nor.needsUpdate = true; Q.col.needsUpdate = true;
  for (const m of Q.meshes) {             // each chunk's bounds from its own vertices
    const I = m.geometry.index.array, bb = m.geometry.boundingSphere;
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < I.length; i++) { const o = I[i] * 3, x = P[o], y = P[o + 1], z = P[o + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    bb.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    bb.radius = 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  }
}

// The overhang slabs: top = terrainH (what he stands on), a ragged underside a slab-thickness
// below that dips deeper toward the wall it grows from, a front face over the void and a back face
// into the lip. Flat shaded (rock), each face wound outward from the slab's centroid.
const _sw = { x: 0, z: 0 }, _sT = new Float32Array((SLAB_NU + 1) * (SLAB_NS + 1) * 3), _sB = new Float32Array((SLAB_NU + 1) * (SLAB_NS + 1) * 3);
function fillSlabs(zi, Q, P, NN, CC, base) {
  const F = FISSURE[zi], L = SLABS[zi], B = ZB[zi];
  let o = base;
  const tri = (A, ia, Bv, ib, Cv, ic, cx, cy, cz, shade) => {
    const ax = A[ia], ay = A[ia + 1], az = A[ia + 2], bx = Bv[ib], by = Bv[ib + 1], bz = Bv[ib + 2], qx = Cv[ic], qy = Cv[ic + 1], qz = Cv[ic + 2];
    let nx = (by - ay) * (qz - az) - (bz - az) * (qy - ay), ny = (bz - az) * (qx - ax) - (bx - ax) * (qz - az), nz = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    const mxp = (ax + bx + qx) / 3 - cx, myp = (ay + by + qy) / 3 - cy, mzp = (az + bz + qz) / 3 - cz;
    const flip = nx * mxp + ny * myp + nz * mzp < 0;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const pts = flip ? [ax, ay, az, qx, qy, qz, bx, by, bz] : [ax, ay, az, bx, by, bz, qx, qy, qz];
    for (let p = 0; p < 3; p++, o++) {
      const x = pts[p * 3], y = pts[p * 3 + 1], z = pts[p * 3 + 2];
      P[o * 3] = x; P[o * 3 + 1] = y; P[o * 3 + 2] = z;
      NN[o * 3] = nx; NN[o * 3 + 1] = ny; NN[o * 3 + 2] = nz;
      CC[o * 3] = shade; CC[o * 3 + 1] = c01(gn(x * 0.0135 + zi * 40, z * 0.0135 - zi * 17) * 1.5 + 0.5) * 0.6 + 0.4;
      CC[o * 3 + 2] = c01((y - B - 2) / 220);
    }
  };
  const W = SLAB_NU + 1;
  for (let si = 0; si < L.length; si++) {
    const sl = L[si], sg = sl.side ? 1 : -1;
    let cx = 0, cy = 0, cz = 0;
    for (let iu = 0; iu <= SLAB_NU; iu++) {
      const u = sl.u0 - sl.hu * 0.97 + (2 * sl.hu * 0.97) * iu / SLAB_NU;
      const wd = _widths(F, u), w = sl.side ? wd.w1 : wd.w0, reach = _slabReach(sl, u, w);
      for (let is = 0; is <= SLAB_NS; is++) {
        const s = 0.05 + (reach * 0.97 - 0.05) * is / SLAB_NS, k = (is * W + iu) * 3;
        fissureWorld(u, sg * (w - Math.max(0.05, s)), zi, _sw);
        const top = terrainH(_sw.x, _sw.z, zi);
        const fr = reach > 0.1 ? Math.min(1, s / reach) : 1;
        const th = sl.th * (0.8 + 0.2 * Math.sin(u * 3.1 + s * 2.3 + si)) + sl.th * 1.4 * (1 - fr) * (1 - fr);
        _sT[k] = _sw.x; _sT[k + 1] = top; _sT[k + 2] = _sw.z;
        _sB[k] = _sw.x; _sB[k + 1] = top - th; _sB[k + 2] = _sw.z;
        cx += _sw.x * 2; cy += top * 2 - th; cz += _sw.z * 2;
      }
    }
    const nP = W * (SLAB_NS + 1) * 2; cx /= nP; cy /= nP; cz /= nP;
    for (let is = 0; is < SLAB_NS; is++) for (let iu = 0; iu < SLAB_NU; iu++) {
      const a = (is * W + iu) * 3, b = (is * W + iu + 1) * 3, c2 = ((is + 1) * W + iu + 1) * 3, d = ((is + 1) * W + iu) * 3;
      tri(_sT, a, _sT, b, _sT, c2, cx, cy, cz, 0.78); tri(_sT, a, _sT, c2, _sT, d, cx, cy, cz, 0.78);   // top
      tri(_sB, a, _sB, b, _sB, c2, cx, cy, cz, 0.26); tri(_sB, a, _sB, c2, _sB, d, cx, cy, cz, 0.26);   // underside
    }
    for (let iu = 0; iu < SLAB_NU; iu++) {
      const f0 = (SLAB_NS * W + iu) * 3, f1 = (SLAB_NS * W + iu + 1) * 3;                 // front: over the void
      tri(_sT, f0, _sT, f1, _sB, f1, cx, cy, cz, 0.5); tri(_sT, f0, _sB, f1, _sB, f0, cx, cy, cz, 0.5);
      const b0 = iu * 3, b1 = (iu + 1) * 3;                                               // back: into the lip
      tri(_sT, b0, _sT, b1, _sB, b1, cx, cy, cz, 0.4); tri(_sT, b0, _sB, b1, _sB, b0, cx, cy, cz, 0.4);
    }
  }
}

// ---------------------------------------------------------------------------
// THE THROAT WALLS (fissure Task 5b). Seen from inside the throat (every descent falls through it)
// the patch's walls were a heightfield sampled on an x/z grid across a near-vertical face: each
// 0.5 u cell spans up to 30 u of riser, so the faces rendered as sawtooth teeth with the texture
// smeared down them. The walls are drawn here instead, in the crack's OWN frame: one ribbon whose
// columns stand at constant u (WALL_DU apart along the kinked centreline) and whose rows run across
// the cross-section, down side 0's face, over the floor, up side 1's. Per column the heightfield Sal
// stands on (heightAt, slabs off) is scanned across the crack every WALL_DV, and the rows are laid
// on those samples by THE ROW LADDER (wallMeasure): counted down from one height for the whole crack,
// so a row meets its neighbours at the same height (never a riser in one column to a ledge in the
// next), at a spacing that grows with depth (0.45 u at the lip, 1.6 u down in the black). Every row
// vertex lies ON the heightfield: no grid ever cuts a face at a random height again.
//   - The drawn strata (wallRecess) only ever lie BACK into the rock (along the face's inward
//     normal, at most WALL_RECESS): hard beds stand at the heightfield and the soft ones between
//     them are undercut, so every overhang lip, notch and setback is drawn rock behind the rock Sal
//     and the lens are kept out of (player.js wallRefuses, game.js clearCamDistance test the
//     heightfield). None on up-facing treads (open-ledge: he can stand on a strata ledge); eased in
//     under the jam's band, out at the floor and toward the tips; WALL_BACK (0.15 u) on every steep
//     face, so the rare chord across a step of the heightfield between two columns stays in the rock.
//   - The patch keeps the lip, the apron and the slabs; the triangles it drew INSIDE the outline
//     (three corners within WALL_HIDE_FD of the lip) leave its index. Over that seam the ribbon runs
//     on out to WALL_TOP_FD past the lip lying on the patch's own drawn surface (fissurePatchSample)
//     WALL_SINK under it, with the patch's normals and colours, then eases onto the heightfield
//     over WALL_BAND: from above the kept patch draws, where it was cut the ribbon is the same
//     surface, so the cut's grid-jagged edge does not show. No stitching.
//   - Its own material (wallMats): the terrain's program plus the wall layer (WALL_0/A/B/C at the
//     terrain's @W markers: beds and laminae, silt run down the faces, the zone's crust and sheen,
//     the texture on the crack's own (u, y) frame), its own program key 'fissureWall'.
//   - Topology once at build (the row count measured at the boot site, +12%); positions, normals,
//     colours and the crack frame attributes refilled per site in place (the ribbon's x/z follow the
//     heights). aF (fissureDist, v) rides along for the open light (rifts.js) on these triangles.
// fissureWallAB(false) puts the old patch walls back (probe A/B and bench).
const WALL_DU = 0.5, WALL_DV = 0.04, WALL_TOP_FD = 1.0, WALL_HIDE_FD = 0.3, WALL_SINK = 0.06;
const WALL_BAND0 = -1.2, WALL_BAND1 = -0.45;
const WALL_RECESS = 1.0, WALL_FLAT = 1.0, WALL_BACK = 0.15;
const fissureWalls = [];
let WALL_ON = true;
const sst = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
// row spacing at a depth below the side's top: fine where he stands and looks, coarse in the black
const wallSigma = d => 0.45 + 1.15 * sst(6, 48, d);
// THE STRATA (drawn only): how far the face lies back in the rock at (u, y) on this side, before the
// envelope. Beds are anchored in world y (level, like real bedding) and dip-warped a little along
// the crack; each bed is hard or soft by a hash. A soft bed is undercut under the hard bed above it
// and slopes back out to its foot (talus): the hard bed's front edge is an overhang lip. Hard beds
// break into blocks along the crack, each set back a little. All features are kept >= ~2 rows /
// columns wide (a narrower one would alias between rows: teeth again); the fine bedding and the
// joints are the shader's (WALL_A / WALL_C).
// STRATA (declared with the wall materials, which read it):
//   t: mean bed thickness, j: bed boundary jitter (x t), hard: share of hard beds, cut: undercut
//   (x WALL_RECESS), blk: block length along the crack, bk: block setback (x WALL_RECESS)
const hash1 = (k, s) => { let h = Math.imul((k | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(s | 0, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
// THE BEDS, one function for the drawn strata and the wall shader (fix round 1: the shader's beds were
// stretched 2-D noise, whose contours wander and close into eyes: wood grain). Bed kb spans world
// heights [b0, b1) (jittered boundaries, each its own hash, shared by the two beds it divides) after
// a gentle dip along the crack. Writes _bd and returns the BED COORDINATE kb + (yw - b0) / (b1 - b0):
// the bed's index and how far up it the point is, continuous and rising with height. The ribbon
// carries it per vertex (aW.y); the shader takes floor() for the bed and hashes it exactly as here
// (wHashI is hash1 in GLSL uint math), so the texture's beds sit on the drawn ledges.
const _bd = { kb: 0, b0: 0, b1: 0, yw: 0 };
function wallBed(zi, u, y, side) {
  const P = STRATA[zi];
  const yw = y + 0.9 * gn(u * 0.045 + zi * 11.1, side * 7.3 + 0.5);          // the beds dip and wander along the crack
  const k = Math.floor(yw / P.t);
  const y0 = (k + (hash1(k, 11) - 0.5) * P.j) * P.t, y1 = (k + 1 + (hash1(k + 1, 11) - 0.5) * P.j) * P.t;
  let kb = k, b0 = y0, b1 = y1;
  if (yw < y0) { kb = k - 1; b1 = y0; b0 = (k - 1 + (hash1(k - 1, 11) - 0.5) * P.j) * P.t; }
  else if (yw >= y1) { kb = k + 1; b0 = y1; b1 = (k + 2 + (hash1(k + 2, 11) - 0.5) * P.j) * P.t; }
  _bd.kb = kb; _bd.b0 = b0; _bd.b1 = b1; _bd.yw = yw;
  return kb + (yw - b0) / (b1 - b0);
}
function wallRecess(zi, u, y, side, sig) {
  const P = STRATA[zi];
  wallBed(zi, u, y, side);
  const kb = _bd.kb, b0 = _bd.b0, b1 = _bd.b1, yw = _bd.yw;
  const hk = hash1(kb, 23 + zi);
  const fromTop = b1 - yw, th = b1 - b0;
  if (hk > P.hard) {
    // soft: the undercut, deepest just under the hard bed above, out to nothing at its foot; the
    // roof eases over two rows (sig: the local row spacing), never a step the rows would alias
    const s = 0.55 + 0.45 * (hk - P.hard) / (1 - P.hard);
    const roof = sst(0, Math.min(th * 0.45, 2 * sig), fromTop);
    const foot = Math.pow(c01(1 - fromTop / th), 0.6);
    return P.cut * s * roof * foot;
  }
  // hard: blocks along the crack, each set back a little (eased over two columns at the joints)
  const ub = (u + hash1(kb, 31) * P.blk) / P.blk, ib = Math.floor(ub), fb = ub - ib;
  const e = Math.min(fb, 1 - fb) * P.blk, ease = sst(0, 0.55, e);
  return P.bk * hash1(kb * 131 + ib, 41 + zi) * ease;
}
function buildFissureWall(zi) {
  const F = FISSURE[zi], Q = fissurePatches[zi];
  const nc = Math.ceil(2 * F.halfLen / WALL_DU) + 1;
  const cu = new Float32Array(nc);
  for (let c = 0; c < nc; c++) cu[c] = Math.max(-F.halfLen + 0.02, Math.min(F.halfLen - 0.02, -F.halfLen + 2 * F.halfLen * c / (nc - 1)));
  // the scan buffers: the widest cross-section at WALL_DV and its graded measure
  let wmax = 0;
  for (let c = 0; c < nc; c++) { const w = _widths(F, cu[c]); wmax = Math.max(wmax, w.w0 + w.w1); }
  const ns = Math.ceil((wmax + 2 * WALL_TOP_FD) / WALL_DV) + 3;
  const W = { F, nc, cu, ns, sv: new Float64Array(ns), sh: new Float64Array(ns), pm: new Float64Array(ns), pm1: new Float64Array(ns), pd: new Float64Array(ns) };
  // the row count: this site's largest measure over every column and side, + 12% (side 0's rows
  // 0..K, the floor's split row K, side 1's K..nr-1)
  let mmax = 0;
  const yRef = wallRef(zi, W);
  for (let c = 0; c < nc; c++) { wallScan(zi, W, c); mmax = Math.max(mmax, wallMeasure(W, yRef)); }
  const K = Math.max(12, Math.ceil(mmax * 1.12) + 2), nr = 2 * K + 1;
  W.nr = nr; W.K = K;
  const nv = nc * nr;
  const g = new THREE.BufferGeometry();
  W.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
  W.nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
  W.col = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
  W.aW = new THREE.BufferAttribute(new Float32Array(nv * 4), 4);     // (u, depth below the side's top, wall weight, recess 0..1)
  W.aF = new THREE.BufferAttribute(new Float32Array(nv * 2), 2);     // (fissureDist, v): the open light's crack frame
  g.setAttribute('position', W.pos); g.setAttribute('normal', W.nor); g.setAttribute('color', W.col); g.setAttribute('aW', W.aW); g.setAttribute('aF', W.aF);
  const I = new Uint32Array((nc - 1) * (nr - 1) * 6);
  let t = 0;
  for (let c = 0; c < nc - 1; c++) for (let r = 0; r < nr - 1; r++) {
    const a = c * nr + r, b = a + nr, a1 = a + 1, b1 = b + 1;      // (c, r) (c+1, r) (c, r+1) (c+1, r+1)
    // (r -> across, down side 0's face, over the floor, up side 1's) x (c -> +u) faces the water
    I[t++] = a; I[t++] = a1; I[t++] = b; I[t++] = b; I[t++] = a1; I[t++] = b1;
  }
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.boundingSphere = new THREE.Sphere();
  const m = new THREE.Mesh(g, wallMats[zi]);
  m.name = 'fissureWall' + zi;
  m.receiveShadow = true;
  scene.add(m);
  W.mesh = m; W.geo = g;
  W.base = new Float32Array(nv * 3); W.bn = new Float32Array(nv * 3); W.dTop = new Float32Array(nv); W.yMin = new Float32Array(nc);
  // the patch: the triangles drawn inside the outline leave its index (kept for the A/B)
  const fdv = new Float32Array(Q.nv), uv = new Uint8Array(Q.nv), _q = { u: 0, v: 0 };
  for (let v = 0; v < Q.nv; v++) {
    const x = Q.FX[Q.va[v]], z = Q.FZ[Q.vb[v]];
    fdv[v] = fissureDist(x, z, zi); fissureLocal(x, z, zi, _q); uv[v] = Math.abs(_q.u) < F.halfLen - 0.1 ? 1 : 0;
  }
  Q.wallIdx = []; Q.fullIdx2 = [];
  for (const mesh of Q.meshes) {
    const full = mesh.geometry.index, A = full.array, keep = [];
    for (let i = 0; i < A.length; i += 3) {
      const a = A[i], b = A[i + 1], c = A[i + 2];
      const hide = a < Q.nv && b < Q.nv && c < Q.nv && uv[a] && uv[b] && uv[c] && fdv[a] < WALL_HIDE_FD && fdv[b] < WALL_HIDE_FD && fdv[c] < WALL_HIDE_FD;
      if (!hide) keep.push(a, b, c);
    }
    const cut = new THREE.BufferAttribute(new Uint32Array(keep), 1);
    Q.fullIdx2.push(full); Q.wallIdx.push(cut);
    mesh.geometry.setIndex(cut);
  }
  fissureWalls[zi] = W;
}
// One column's cross-section: the heightfield (slabs off) every WALL_DV from WALL_TOP_FD outside
// side 0's lip to WALL_TOP_FD outside side 1's (W.sv, W.sh, W.n). W.k: where the two sides meet,
// the middle of the open slot a quarter of the way up the shallower side (the lowest point jumps
// from pocket to pocket along a lumpy floor; this moves with the walls, smoothly), held at row K
// in every column so the floor's rows line up along the crack.
function wallScan(zi, W, c) {
  const F = W.F, u = W.cu[c], wd = _widths(F, u), w0 = wd.w0, w1 = wd.w1;
  const v0 = -(w0 + WALL_TOP_FD), v1 = w1 + WALL_TOP_FD, n = Math.min(W.ns, Math.ceil((v1 - v0) / WALL_DV) + 1);
  let k = -1, kh = 1e9, ka = -1, kah = 1e9;
  for (let i = 0; i < n; i++) {
    const v = i === n - 1 ? v1 : v0 + i * WALL_DV;
    fissureWorld(u, v, zi, _sw);
    const h = heightAt(_sw.x, _sw.z, zi, false);
    W.sv[i] = v; W.sh[i] = h;
    if (h < kah) { kah = h; ka = i; }
    if (v > -w0 && v < w1 && h < kh) { kh = h; k = i; }
  }
  W.n = n;
  const fl = k >= 0 ? kh : kah, yr = fl + 0.25 * (Math.min(W.sh[0], W.sh[n - 1]) - fl);
  let a = 0, b = n - 1;
  while (a < n - 1 && W.sh[a] >= yr) a++;
  while (b > 0 && W.sh[b] >= yr) b--;
  W.k = a <= b ? Math.max(1, Math.min(n - 2, Math.round((a + b) / 2))) : Math.max(1, Math.min(n - 2, k >= 0 ? k : ka));
}
// THE ROW LADDER. Rows must meet their neighbours across a column at the SAME HEIGHT, or a
// triangle between two columns spans a riser in one and a ledge in the next and cuts through rock
// (a share of a column's own depth, as first built, put the same row 10 u apart in two columns
// 0.5 u apart). So the measure is counted down from one height for the whole crack (yRef, over
// every lip), mostly by drop, |dy| + WALL_FLAT |dv| over the row spacing at that depth below yRef
// (so a tread or the floor still gets rows), and row j of every column sits where that column's
// measure reaches j: the same beds at the same rows all along the crack. Above a column's own top
// its rows rest on the top; below its split (a shallower column) they rest on the split.
// W.pm: side 0's measure from its top (samples 0..k); W.pm1: side 1's from its top (k..n-1);
// W.pd: each sample's depth below its own side's top (the envelope's top band).
function wallMeasure(W, yRef) {
  const n = W.n, k = W.k, top0 = W.sh[0], top1 = W.sh[n - 1];
  for (let i = 0; i < n; i++) W.pd[i] = Math.max(0, (i <= k ? top0 : top1) - W.sh[i]);
  // only NEW depth counts (the drop of the running lowest point), so a slumped block's bump on a
  // face (down into a pocket and back up) does not push every row under it down the ladder
  let lo = 1e9;
  const seg = (i, j) => { const d0 = Math.max(0, lo - W.sh[j]); lo = Math.min(lo, W.sh[j]);
    return (d0 + WALL_FLAT * Math.abs(W.sv[j] - W.sv[i])) / wallSigma(yRef - lo); };
  const up = h => { const d = Math.max(0, yRef - h); return d / wallSigma(0.5 * d); };
  W.pm[0] = up(top0); lo = top0;
  for (let i = 1; i <= k; i++) W.pm[i] = W.pm[i - 1] + seg(i - 1, i);
  W.pm1[n - 1] = up(top1); lo = top1;
  for (let i = n - 2; i >= k; i--) W.pm1[i] = W.pm1[i + 1] + seg(i, i + 1);
  return Math.max(W.pm[k], W.pm1[k]);
}
// yRef: over every column's two lip ends (fillTerrain's site)
function wallRef(zi, W) {
  let y = -1e9;
  for (let c = 0; c < W.nc; c++) {
    const wd = _widths(W.F, W.cu[c]);
    for (const v of [-(wd.w0 + WALL_TOP_FD), wd.w1 + WALL_TOP_FD]) { fissureWorld(W.cu[c], v, zi, _sw); y = Math.max(y, heightAt(_sw.x, _sw.z, zi, false)); }
  }
  return y + 0.25;
}
// The patch's drawn normal (or any per-vertex 3-vector) at (x, z): its own split of the fine cell.
function patchLerp3(Q, Arr, x, z, out) {
  const { FX, FZ, nfx, vmap } = Q;
  if (x < FX[0] || x > FX[nfx - 1] || z < FZ[0] || z > FZ[Q.nfz - 1]) return false;
  const a = axSearch(FX, x), b = axSearch(FZ, z);
  const A = vmap[b * nfx + a], Bv = vmap[(b + 1) * nfx + a], C = vmap[(b + 1) * nfx + a + 1], D = vmap[b * nfx + a + 1];
  if (A < 0 || Bv < 0 || C < 0 || D < 0) return false;
  const fx = (x - FX[a]) / (FX[a + 1] - FX[a]), fz = (z - FZ[b]) / (FZ[b + 1] - FZ[b]), lo = fx + fz <= 1;
  const wa = lo ? 1 - fx - fz : 0, wb = lo ? fz : 1 - fx, wc = lo ? 0 : fx + fz - 1, wd = lo ? fx : 1 - fz;
  for (let ch = 0; ch < 3; ch++) out[ch] = Arr[A * 3 + ch] * wa + Arr[Bv * 3 + ch] * wb + Arr[C * 3 + ch] * wc + Arr[D * 3 + ch] * wd;
  return true;
}
const _pn = new Float32Array(3), _pc = new Float32Array(3), _wl = { u: 0, v: 0 };
// grid normal of the ribbon at (c, r) from array A (central differences, one-sided at the ends):
// (r -> across) x (c -> along) faces the water
function wallNormal(W, A, c, r, out, oo) {
  const nc = W.nc, nr = W.nr, at = (cc, rr) => (cc * nr + rr) * 3;
  const c0 = c > 0 ? c - 1 : c, c1 = c < nc - 1 ? c + 1 : c, r0 = r > 0 ? r - 1 : r, r1 = r < nr - 1 ? r + 1 : r;
  const pa = at(c0, r), pb = at(c1, r), qa = at(c, r0), qb = at(c, r1);
  const tx = A[pb] - A[pa], ty = A[pb + 1] - A[pa + 1], tz = A[pb + 2] - A[pa + 2];
  const sx = A[qb] - A[qa], sy = A[qb + 1] - A[qa + 1], sz = A[qb + 2] - A[qa + 2];
  const nx = sy * tz - sz * ty, ny = sz * tx - sx * tz, nz = sx * ty - sy * tx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) { out[oo] = 0; out[oo + 1] = 1; out[oo + 2] = 0; return; }
  out[oo] = nx / l; out[oo + 1] = ny / l; out[oo + 2] = nz / l;
}
function fillFissureWall(zi) {
  const W = fissureWalls[zi], Q = fissurePatches[zi]; if (!W || !Q) return;
  const F = W.F, nc = W.nc, nr = W.nr, B = ZB[zi], P = W.pos.array, N = W.nor.array, C = W.col.array, AW = W.aW.array, AF = W.aF.array;
  const base = W.base, bn = W.bn;
  // 1. the rows down the cross-section, ON the heightfield (the scan's own samples), on the ladder
  const yRef = wallRef(zi, W), K = W.K;
  wallMats[zi].userData.wallU.uWallTop.value = yRef;   // (the lip band: the soot's reach)
  for (let c = 0; c < nc; c++) {
    wallScan(zi, W, c);
    wallMeasure(W, yRef);
    const u = W.cu[c], n = W.n, k = W.k;
    let ymin = 1e9;
    for (let s = 0; s < 2; s++) {
      const pm = s ? W.pm1 : W.pm, mEnd = pm[k], sc = mEnd > K ? mEnd / K : 1;   // (a deeper site than the build's: squeezed onto the rows)
      let j = s ? n - 1 : 0;                                                    // the sample walk, from this side's top toward the split
      const step = s ? -1 : 1;
      for (let q = 0; q <= K; q++) {
        const M = q * sc, r = s ? nr - 1 - q : q;
        let v, y, d;
        if (M <= pm[s ? n - 1 : 0]) { const t = s ? n - 1 : 0; v = W.sv[t]; y = W.sh[t]; d = W.pd[t]; }
        else if (M >= mEnd) { v = W.sv[k]; y = W.sh[k]; d = W.pd[k]; }
        else {
          while (j !== k && pm[j + step] < M) j += step;
          const a = j, b = j + step, span = pm[b] - pm[a], f = span > 1e-12 ? Math.min(1, Math.max(0, (M - pm[a]) / span)) : 0;
          v = W.sv[a] + (W.sv[b] - W.sv[a]) * f; y = W.sh[a] + (W.sh[b] - W.sh[a]) * f; d = W.pd[a] + (W.pd[b] - W.pd[a]) * f;
        }
        fissureWorld(u, v, zi, _sw);
        const i = c * nr + r, o = i * 3;
        base[o] = _sw.x; base[o + 1] = y; base[o + 2] = _sw.z;
        W.dTop[i] = d; AW[i * 4] = u;
        if (y < ymin) ymin = y;
      }
    }
    W.yMin[c] = ymin;
  }
  // 2. the base normals; 3. the drawn strata, back into the rock along them; the seam band
  for (let c = 0; c < nc; c++) for (let r = 0; r < nr; r++) wallNormal(W, base, c, r, bn, (c * nr + r) * 3);
  for (let c = 0; c < nc; c++) {
    const au = Math.abs(W.cu[c]) / F.halfLen, ymin = W.yMin[c];
    for (let r = 0; r < nr; r++) {
      const i = c * nr + r, o = i * 3, x = base[o], y = base[o + 1], z = base[o + 2];
      const fd = fissureDist(x, z, zi), wP = sst(WALL_BAND0, WALL_BAND1, fd), dTop = W.dTop[i];
      fissureLocal(x, z, zi, _wl);
      // steep faces only (treads are ground he can stand on), never in the seam band (the patch's own
      // surface); the strata ease in under the jam's band and out toward the tips; a hair (WALL_BACK)
      // everywhere steep, so the rare chord over a step of the heightfield stays behind the rock too
      const stp = (1 - sst(0.3, 0.6, bn[o + 1])) * (1 - wP), env = sst(4, 10, dTop) * sst(0, 2, y - ymin) * (1 - sst(0.82, 0.96, au));
      const rec = stp > 0 ? stp * (WALL_BACK + (env > 0 ? env * WALL_RECESS * wallRecess(zi, W.cu[c], y, _wl.v >= 0 ? 1 : 0, wallSigma(dTop)) : 0)) : 0;
      const px = x - bn[o] * rec, pz = z - bn[o + 2] * rec;
      let py = y - bn[o + 1] * rec;
      if (wP > 0) {   // the seam band: onto the patch's drawn surface, just under it
        const yp = fissurePatchSample(zi, px, pz, null);
        if (yp === yp) py = py + (yp - WALL_SINK - py) * wP;
      }
      P[o] = px; P[o + 1] = py; P[o + 2] = pz;
      // aW: u, the bed coordinate at the drawn point, the wall weight, recess + 2 on side 1 (the shader's
      // relief tangent turns with the side: horizontal in the face, along +u)
      const sd = _wl.v >= 0 ? 1 : 0;
      AW[i * 4 + 1] = wallBed(zi, W.cu[c], py, sd); AW[i * 4 + 2] = 1 - wP; AW[i * 4 + 3] = rec / WALL_RECESS + 2 * sd;
      fissureLocal(px, pz, zi, _wl);
      AF[i * 2] = fissureDist(px, pz, zi); AF[i * 2 + 1] = _wl.v;
    }
  }
  // 4. normals of the drawn surface; colours (r cavity, g macro bias, b height: the terrain's
  // encoding); the seam band takes the patch's own
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let c = 0; c < nc; c++) {
    const wd = _widths(F, W.cu[c]), wsum = wd.w0 + wd.w1 + 0.5;
    for (let r = 0; r < nr; r++) {
      const i = c * nr + r, o = i * 3, x = P[o], y = P[o + 1], z = P[o + 2];
      wallNormal(W, P, c, r, N, o);
      const wP = 1 - AW[i * 4 + 2];
      // the cavity: how far down the slot this face sits against how wide the slot is there (the
      // crack narrows with depth), and the undercuts darker still
      const dd = W.dTop[i], ow = wsum * Math.max(0.12, 1 - dd / 70);
      const shut = sst(0, 1, dd / (dd + 2.2 * ow)), aa = c01(1 - 0.78 * shut - 0.22 * (AW[i * 4 + 3] % 2));
      let cr = 0.18 + 0.82 * aa * aa, cg = c01(gn(x * 0.0135 + zi * 40, z * 0.0135 - zi * 17) * 1.5 + 0.5), cb = c01((y - B - 2) / 220);
      if (wP > 0) {
        if (patchLerp3(Q, Q.col.array, x, z, _pc)) { cr += (_pc[0] - cr) * wP; cg += (_pc[1] - cg) * wP; cb += (_pc[2] - cb) * wP; }
        if (patchLerp3(Q, Q.nor.array, x, z, _pn)) {
          const nx = N[o] + (_pn[0] - N[o]) * wP, ny = N[o + 1] + (_pn[1] - N[o + 1]) * wP, nz = N[o + 2] + (_pn[2] - N[o + 2]) * wP;
          const l = Math.hypot(nx, ny, nz) || 1; N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
        }
      }
      C[o] = cr; C[o + 1] = cg; C[o + 2] = cb;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
  }
  W.pos.needsUpdate = W.nor.needsUpdate = W.col.needsUpdate = W.aW.needsUpdate = W.aF.needsUpdate = true;
  const bs = W.geo.boundingSphere;
  bs.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); bs.radius = 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}
// The throat wall's buffers and index (probes; rifts.js lays the open light on these triangles).
export function fissureWallGeo(zi) {
  const W = fissureWalls[zi];
  return W ? { pos: W.pos, nor: W.nor, aF: W.aF, aW: W.aW, index: W.geo.index.array, nc: W.nc, nr: W.nr, mesh: W.mesh } : null;
}
export function fissureWallOn() { return WALL_ON; }
// A/B: false puts back the old patch walls (the full patch index, no ribbon); true the throat walls.
export function fissureWallAB(on) {
  WALL_ON = !!on;
  for (let zi = 0; zi < 3; zi++) {
    const Q = fissurePatches[zi], W = fissureWalls[zi];
    if (!Q || !W) continue;
    Q.meshes.forEach((m, i) => m.geometry.setIndex(WALL_ON ? Q.wallIdx[i] : Q.fullIdx2[i]));
    W.mesh.visible = WALL_ON && Q.group.visible;
  }
  return WALL_ON;
}
export function fissureWallState() {
  return fissureWalls.map((W, zi) => W && ({ zi, cols: W.nc, rows: W.nr, verts: W.nc * W.nr, tris: W.geo.index.count / 3,
    patchTrisCut: fissurePatches[zi].fullIdx2.reduce((a, b) => a + b.count, 0) / 3 - fissurePatches[zi].wallIdx.reduce((a, b) => a + b.count, 0) / 3, visible: W.mesh.visible }));
}

// THE OPEN LIGHT'S WALLS (rifts.js): the patch's own vertex buffers (refilled in place per site) and
// its index arrays, so the light on the walls lies on exactly the triangles drawn there (the seep's
// depth-stable rule: same vertices, same transform). Read once at build; slab vertices are >= nv.
// index: what the patch draws with the throat walls on (Task 5b: the walls inside the outline are
// the ribbon's, fissureWallGeo); indexFull: the old patch walls (fissureWallAB(false)).
export function fissurePatchGeo(zi) {
  const Q = fissurePatches[zi];
  return Q ? { pos: Q.pos, nor: Q.nor, nv: Q.nv, index: Q.meshes.map((m, i) => (Q.wallIdx ? Q.wallIdx[i] : m.geometry.index).array),
    indexFull: Q.meshes.map((m, i) => (Q.fullIdx2 ? Q.fullIdx2[i] : m.geometry.index).array) } : null;
}
// The DRAWN height of the fissure patch at (x, z) (its own two-triangle split of each fine cell),
// or NaN where the coarse terrain draws. Slab tops are not included. With col (3 floats), also the
// patch's vertex colour there (the terrain's encoding). Readers that sample the coarse mesh's own
// vertices (wrecks.js terrainSample: drift skirts and fillets; brooder.js: Velkath's silt skirt)
// take this first near a crack (Task 5), where the coarse cells are cut out and drawn here instead.
export function fissurePatchSample(zi, x, z, col) {
  const Q = fissurePatches[zi]; if (!Q) return NaN;
  const { FX, FZ, nfx, nfz, vmap } = Q, P = Q.pos.array;
  if (x < FX[0] || x > FX[nfx - 1] || z < FZ[0] || z > FZ[nfz - 1]) return NaN;
  const a = axSearch(FX, x), b = axSearch(FZ, z);
  const A = vmap[b * nfx + a], Bv = vmap[(b + 1) * nfx + a], C = vmap[(b + 1) * nfx + a + 1], D = vmap[b * nfx + a + 1];
  if (A < 0 || Bv < 0 || C < 0 || D < 0) return NaN;
  const fx = (x - FX[a]) / (FX[a + 1] - FX[a]), fz = (z - FZ[b]) / (FZ[b + 1] - FZ[b]);
  const lo = fx + fz <= 1;
  const wa = lo ? 1 - fx - fz : 0, wb = lo ? fz : 1 - fx, wc = lo ? 0 : fx + fz - 1, wd = lo ? fx : 1 - fz;
  if (col) { const K = Q.col.array; for (let c = 0; c < 3; c++) col[c] = K[A * 3 + c] * wa + K[Bv * 3 + c] * wb + K[C * 3 + c] * wc + K[D * 3 + c] * wd; }
  return P[A * 3 + 1] * wa + P[Bv * 3 + 1] * wb + P[C * 3 + 1] * wc + P[D * 3 + 1] * wd;
}
// DEBUG / PROBES: the drawn patch height alone.
export function fissurePatchH(zi, x, z) { return fissurePatchSample(zi, x, z, null); }
// A/B (bench): false draws the uncut coarse terrain and hides the patch; true restores the patch.
export function fissurePatchAB(on) {
  PATCH_ON = !!on;
  for (const Q of fissurePatches) if (Q) { Q.coarse.setIndex(PATCH_ON ? Q.cutIdx : Q.fullIdx); Q.group.visible = PATCH_ON; }
  return PATCH_ON;
}
export function fissurePatchState() {
  return fissurePatches.map((Q, zi) => Q && ({ zi, cells: Q.cells, chunks: Q.meshes.length, subs: [Math.min(...Q.XA.m), Math.max(...Q.XA.m), Math.min(...Q.ZA.m), Math.max(...Q.ZA.m)],
    maxStep: +Math.max(...Q.XA.m.map((m, i) => (AX[Q.k0 + i + 1] - AX[Q.k0 + i]) / m), ...Q.ZA.m.map((m, i) => (AX[Q.j0 + i + 1] - AX[Q.j0 + i]) / m)).toFixed(3),
    verts: Q.nv + Q.nsv, tris: Q.tris, visible: Q.group.visible }));
}

// Topology once, heights per site. buildTerrain allocates the geometries and puts the
// meshes in the scene — that half must never run twice, because player.js and the
// render list hold the mesh and attribute references. fillTerrain owns everything the
// height functions derive and is the reseed entry point: setSite(i) then fillTerrain()
// under the black screen re-floors the basin in place.
// The collar: per cut cell a fine grid; vertex record (x, z, mode, a, b, t): mode 0 = the true ground,
// mode 1 = on an edge shared with an uncut cell: lerp the coarse shell vertices a -> b by t.
function buildShellCollar(zi, q, sg) {
  const m1 = q + 1, keep = [], cut = new Uint8Array(q * q), V = [], I = [];
  const fdAt = (x, z) => fissureDist(x, z, zi);
  for (let iy = 0; iy < q; iy++) for (let ix = 0; ix < q; ix++) {
    const x0 = AX[ix * SHELL_STEP], x1 = AX[(ix + 1) * SHELL_STEP], z0 = AX[iy * SHELL_STEP], z1 = AX[(iy + 1) * SHELL_STEP];
    let near = false;
    for (let a = 0; a <= 4 && !near; a++) for (let b = 0; b <= 4; b++) if (fdAt(x0 + (x1 - x0) * a / 4, z0 + (z1 - z0) * b / 4) < SHELL_TOUCH) { near = true; break; }
    if (near) { cut[iy * q + ix] = 1; continue; }
    const a = ix + m1 * iy, b = ix + m1 * (iy + 1), c = ix + 1 + m1 * (iy + 1), d = ix + 1 + m1 * iy;
    keep.push(a, b, d, b, c, d);
  }
  sg.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1));
  const isCut = (ix, iy) => ix >= 0 && iy >= 0 && ix < q && iy < q && cut[iy * q + ix] === 1;
  for (let iy = 0; iy < q; iy++) for (let ix = 0; ix < q; ix++) {
    if (!cut[iy * q + ix]) continue;
    const x0 = AX[ix * SHELL_STEP], x1 = AX[(ix + 1) * SHELL_STEP], z0 = AX[iy * SHELL_STEP], z1 = AX[(iy + 1) * SHELL_STEP];
    const nx = Math.max(1, Math.ceil((x1 - x0) / SHELL_FINE)), nz = Math.max(1, Math.ceil((z1 - z0) / SHELL_FINE));
    const A = ix + m1 * iy, B = ix + 1 + m1 * iy, C = ix + m1 * (iy + 1), D = ix + 1 + m1 * (iy + 1);   // (x0,z0) (x1,z0) (x0,z1) (x1,z1)
    const base = V.length / 6, fd = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz;
      let mode = 0, a = 0, b = 0, t = 0;
      // on a cell edge whose neighbour across it is an uncut (coarse) cell: follow that edge
      if (j === 0 && !isCut(ix, iy - 1)) { mode = 1; a = A; b = B; t = i / nx; }
      else if (j === nz && !isCut(ix, iy + 1)) { mode = 1; a = C; b = D; t = i / nx; }
      else if (i === 0 && !isCut(ix - 1, iy)) { mode = 1; a = A; b = C; t = j / nz; }
      else if (i === nx && !isCut(ix + 1, iy)) { mode = 1; a = B; b = D; t = j / nz; }
      V.push(x, z, mode, a, b, t); fd.push(fdAt(x, z));
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i, b = a + (nx + 1), c = b + 1, d = a + 1;   // a (i,j) b (i,j+1) c (i+1,j+1) d (i+1,j)
      const f = k => fd[k - base];
      // the coarse winding (a, b, d), (b, c, d); a triangle is kept only outside the outline
      if ((f(a) + f(b) + f(d)) / 3 > SHELL_EDGE && Math.min(f(a), f(b), f(d)) > -0.2) I.push(a, b, d);
      if ((f(b) + f(c) + f(d)) / 3 > SHELL_EDGE && Math.min(f(b), f(c), f(d)) > -0.2) I.push(b, c, d);
    }
  }
  const n = V.length / 6, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
  const C = { g, V: new Float32Array(V), n };
  shellCollars[zi] = C;
  return C;
}
// per site: the collar on this floor (fillTerrain, after the coarse shell is resampled)
function fillShellCollar(zi, SP, m) {
  const C = shellCollars[zi]; if (!C) return;
  const P = C.g.attributes.position.array, V = C.V;
  for (let k = 0; k < C.n; k++) {
    const o = k * 6, x = V[o], z = V[o + 1];
    let y;
    if (V[o + 2] === 1) { const a = V[o + 3], b = V[o + 4], t = V[o + 5]; y = SP[a * 3 + 1] + (SP[b * 3 + 1] - SP[a * 3 + 1]) * t; }
    else y = heightAt(x, z, zi, true) - SHELL_DROP;
    P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
  }
  C.g.attributes.position.needsUpdate = true;
  C.g.computeBoundingSphere();
}

export function buildTerrain() {
  if (terrainMeshes.length) { fillTerrain(); return; }
  buildIslands();

  for (let zi = 0; zi < 3; zi++) {
    // PlaneGeometry is used for its index/attribute topology only; every position is rewritten.
    const g = new THREE.PlaneGeometry(1, 1, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    const tm = new THREE.Mesh(g, zoneMats[zi]);
    tm.receiveShadow = true;
    scene.add(tm);
    terrainMeshes.push(tm);
    buildFissurePatch(zi, g);   // cuts the crack's cells out of g's index and draws them dense
    buildFissureWall(zi);       // the throat walls in the crack's own frame; the patch's walls leave its index

    // Roof shell topology: built here (not lazily) so its material is in the scene
    // before the boot precompile and first sight never hitches.
    if (zi < 2) {
      const q = SEG / SHELL_STEP;
      const sg = new THREE.PlaneGeometry(1, 1, q, q);
      sg.rotateX(-Math.PI / 2);
      // the crack (see SHELL_TOUCH): its cells leave the coarse index for the collar. Topology from the
      // frozen outline: built once.
      const collar = buildShellCollar(zi, q, sg);
      const sm = new THREE.Mesh(sg, shellMats[zi]);
      sm.add(new THREE.Mesh(collar.g, shellMats[zi]));   // a child: the shell's gate is its gate
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
  // The far ridge's drape follows its envelope (zone 0's material only).
  zoneMats[0].userData.zoneU.uDrape.value.set(RIDGE.drape, RIDGE.in0 + 8, RIDGE.pk0, RIDGE.drapeK);
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
    fillFissurePatch(zi, H, NR, col);
    fillFissureWall(zi);        // after the patch: its seam band lies on the patch's drawn surface

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
      fillShellCollar(zi, SP, m);
    }
  }
  fillIslands();   // the far islands' stacks, sunk into this site's shoals
}

export function updateTerrain(dt, t, camY, sunK = 1) {
  causticsUniforms.uTime.value = t;
  causticsUniforms.uCamY.value = camY;
  // Caustics are sunlight. Night has none, an overcast gale has none — the same
  // day/storm factor the sky and key light already run on, or the floor sparkles
  // under a black sky.
  causticsUniforms.uSunK.value = sunK;
  causticsUniforms.uSunW.value.set(SUN.dirWater.x, SUN.dirWater.y, SUN.dirWater.z);
  // The swell under the caustics: water.js resolved this frame's two longest wave
  // components (storm and wind already folded in) in updateWater, which game.js runs
  // before this. Copied by value into the terrain's own uniforms.
  const W = waveLow, SB = GLASS.seabed;
  causticsUniforms.uWaveA.value.set(W[0], W[1], W[2], W[3]);
  causticsUniforms.uWaveB.value.set(W[5], W[6], W[7], W[8]);
  causticsUniforms.uWaveW.value.set(W[4], W[9], W[10], 0);
  causticsUniforms.uCTune.value.set(SB.caustStr, SB.caustScale, SB.caustFollow, SB.shadowAmbient);
  // The floor casts onto itself (cliffs onto sand) only while lighting.js has the sun's
  // shadow box over the seabed. Off, the terrain never enters the raft box's shadow
  // pass (its bounding sphere would otherwise put 166k tris into it every frame).
  const cast = floorShadow.on;
  for (let i = 0; i < 3; i++) if (terrainMeshes[i].castShadow !== cast) {
    terrainMeshes[i].castShadow = cast;
    if (fissurePatches[i]) for (const m of fissurePatches[i].meshes) m.castShadow = cast;
    if (fissureWalls[i]) fissureWalls[i].mesh.castShadow = cast;
  }
  // Zone gating: each 166k-tri heightfield is submitted only while the camera is
  // inside its band — the same bands flora already runs (top+120 / bottom-150), which
  // overlap 180 units through every rift so a descent or the ending's fast ascent
  // never shows a frame with a missing floor. Visibility only: fillTerrain, the
  // collision field (terrainH) and the roof shells are untouched.
  for (let i = 0; i < 3; i++) {
    terrainMeshes[i].visible = zoneBand(i, camY);
    if (fissurePatches[i]) fissurePatches[i].group.visible = PATCH_ON && terrainMeshes[i].visible;
    if (fissureWalls[i]) fissureWalls[i].mesh.visible = WALL_ON && PATCH_ON && terrainMeshes[i].visible;
  }
  updateIslands(camY, t);   // gated on the zone-0 mesh just set: they never pop off their shoal
  // A shell only exists for the player in the zone BELOW it, looking up: on when the
  // camera is 40 under the parent floor, off again 340 under (past the next floor,
  // where the zone below's own shell takes over). From above, backfaces + early-z
  // make it free, so this gate is about draw-call hygiene, not correctness.
  for (let i = 0; i < roofShells.length; i++) {
    roofShells[i].visible = camY < ZB[i] - 40 && camY > ZB[i] - 340;
  }
}

// ZONE SIGHT (config.js ZONE_SEEN): zone i is visible only once the camera is within
// SIGHT_MARGIN of, or under, zone i-1's floor at its own x, z. Two terrainH calls a frame.
// The follow camera rides only ~2-4 u over the seabed, so a 4 u margin left zone 1 drawn in
// most of zone 0 (z0r, z0b). 0.5 u covers the gate's one-frame lag at any swim or fall
// speed the camera reaches; and anything of zone i seen from just under zone i-1's floor
// is >= 90 u away through the gap, where the water's transmittance is already ~e^-10.
const SIGHT_MARGIN = 0.5;
export function updateZoneSight(x, y, z) {
  const on = GLASS.zoneSight !== 0;
  ZONE_SEEN[0] = 1;
  for (let i = 1; i < 3; i++) ZONE_SEEN[i] = !on || y < terrainH(x, z, i - 1) + SIGHT_MARGIN ? 1 : 0;
}

// ---- DEV PROBE: window.__ridge (roadmap/far-ridgeline-read.md) ---------------------
// fp(zones?): the terrain fingerprint — FNV-1a over the float32 BYTES of terrainH on the
// 32x32 grid x,z = -248..248 step 16, zone-major then z then x. The quoted pre-2026-10
// values (35acc2d0, 5e6cfe45) were taken with an unrecorded probe and do not reproduce
// under any byte/word/order variant of this one, so this is now the canonical probe.
// set({...}) retunes THE FAR RIDGE rows live and refills the terrain (dev only).
export function terrainFingerprint(zones = [0, 1, 2]) {
  let h = 0x811c9dc5;
  const f = new Float32Array(1), b = new Uint8Array(f.buffer);
  for (const zi of zones) for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
    f[0] = terrainH(-248 + i * 16, -248 + j * 16, zi);
    for (let k = 0; k < 4; k++) { h ^= b[k]; h = Math.imul(h, 16777619) >>> 0; }
  }
  return h.toString(16).padStart(8, '0');
}
if (typeof window !== 'undefined') {
  window.__ridge = {
    RIDGE, ISLES, drape2: DRAPE2.value, drape3: DRAPE3.value,
    fp: terrainFingerprint,
    set(o) { Object.assign(RIDGE, o); fillTerrain(); return { ...RIDGE, fp: terrainFingerprint() }; }
  };
}

// ---- DEV PROBE: window.__caust (roadmap/ref-caustics-shadow.md) --------------------
// state(): the live wave gradient at the diver's sun projection (the same expression the
// shader evaluates per fragment, on the CPU), the tune uniforms, and lighting.js's
// seabed shadow state. set({caustStr, caustFollow, shadow, ...}) writes GLASS.seabed.
if (typeof window !== 'undefined') {
  window.__caust = {
    state() {
      const W = waveLow, P = playerLightSrc.position, d = SUN.dirWater;
      const sx = P.x - d.x * (P.y / Math.max(0.25, d.y)), sz = P.z - d.z * (P.y / Math.max(0.25, d.y));
      const pa = (sx * W[0] + sz * W[1]) * W[2] + W[4] * W[10];
      const pb = (sx * W[5] + sz * W[6]) * W[7] + W[9] * W[10];
      const ca = W[2] * W[3] * Math.cos(pa), cb = W[7] * W[8] * Math.cos(pb);
      const gx = W[0] * ca + W[5] * cb, gz = W[1] * ca + W[6] * cb;
      const k = GLASS.seabed.caustFollow * 0.33 * Math.min(300, Math.max(0, -P.y));
      return {
        grad: [gx, gz], offset: [gx * k, gz * k], ampH: [W[3], W[8]], t: W[10],
        sunK: causticsUniforms.uSunK.value, camY: causticsUniforms.uCamY.value,
        tune: causticsUniforms.uCTune.value.toArray(),
        shadow: { on: floorShadow.on, refreshes: floorShadow.refreshes, box: floorShadow.box.slice(), terrainCast: terrainMeshes[0].castShadow },
        knobs: { ...GLASS.seabed }
      };
    },
    set(o) { Object.assign(GLASS.seabed, o); return window.__caust.state(); }
  };
}
