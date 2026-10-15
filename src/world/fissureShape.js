// src/world/fissureShape.js — THE FISSURE's shape, the single source of truth (spec 2026-10-10).
// Pure: no THREE, no state beyond the frozen table, the jam cache and one shut flag per zone. Every consumer (terrain carving, fall-through,
// exclusions, the jam, the light, the ending) asks here instead of drawing its own circle.
// The query functions allocate nothing (one module scratch object); terrainH calls fissureDist
// on every sample, so keep them cheap.
import { riftPos } from '../config.js';
// Authored per zone: bearing of the crack (radians) and its proportions. Bearings chosen so the
// crack runs across the basin, not toward the wall; lengths/widths inside the spec's ranges.
const ROWS = [
  { bear: 0.55, halfLen: 36, halfW: 6.5, throatHalfW: 4.2, lipDrop: 6 },   // zone 0: limestone
  { bear: 2.20, halfLen: 33, halfW: 7.0, throatHalfW: 4.6, lipDrop: 5 },   // zone 1: scorched
  { bear: 1.05, halfLen: 38, halfW: 7.5, throatHalfW: 5.0, lipDrop: 7 },   // zone 2: basalt
];
// Per zone, per side: phases for the edge's jag and the centreline's kinks, so the two lips of
// one crack never mirror each other and the three cracks never rhyme.
const PH = [
  { m: [0.13, 0.61], j: [[0.4, 2.1], [3.3, 5.0]] },
  { m: [0.71, 0.27], j: [[1.9, 4.4], [5.6, 0.8]] },
  { m: [0.42, 0.88], j: [[4.7, 1.2], [2.6, 3.9]] },
];
// Bound for the cheap reject in terrainH: |midAt| <= 2.2*2 + 0.8*2 = 6.0 (triangle-wave differences),
// half width <= 1.36 * halfW (jag), so every point with fissureDist < 14 lies inside this radius.
// (Exported: terrain.js's relief checks bound its outcrops' keep-off by the crack's widest reach off its axis.)
export const MID_MAX = 6.0, JAG_MAX = 1.36;
export const FISSURE = ROWS.map((r, zi) => {
  const p = riftPos(zi);
  const reach = Math.hypot(r.halfLen, MID_MAX + JAG_MAX * r.halfW) + 14 + 0.5;
  return Object.freeze({ cx: p.x, cz: p.z, dx: Math.cos(r.bear), dz: Math.sin(r.bear), halfLen: r.halfLen,
    halfW: r.halfW, throatHalfW: r.throatHalfW, lipDrop: r.lipDrop, ph: PH[zi],
    apronR2: reach * reach });   // fissureDist >= 14 everywhere outside this squared radius
});
// OVERHANG SLABS (fix round 1): a few slabs of the lip that have not fallen yet, jutting over the void.
// A heightfield can hold their TOPS (terrainH lifts the ground to them, so Sal stands on what is drawn)
// but not their undersides: terrain.js draws the carved wall under them in the fissure patch and the
// slab itself (top + front + underside) as rock. u0: centre along the crack; side: which lip
// (1: v >= 0, 0: v < 0); hu: half length along u; reach: how far past the lip it juts; th: thickness.
// Their centres are kept off the middle (|u0| >= 7; with their half lengths none reaches nearer than |u| ~5.1)
// so the opening the ending and the jam use stays clear.
export const SLABS = [
  [{ u0: -19, side: 1, hu: 2.6, reach: 2.6, th: 1.3 }, { u0: -8, side: 0, hu: 2.0, reach: 2.2, th: 1.0 },
   { u0: 11, side: 1, hu: 2.2, reach: 2.4, th: 1.5 }, { u0: 22, side: 0, hu: 2.8, reach: 2.3, th: 1.1 }],
  [{ u0: -17, side: 0, hu: 2.4, reach: 2.5, th: 1.2 }, { u0: -7, side: 1, hu: 1.9, reach: 2.1, th: 1.0 },
   { u0: 9, side: 0, hu: 2.6, reach: 2.6, th: 1.4 }, { u0: 20, side: 1, hu: 2.2, reach: 2.2, th: 1.1 }],
  [{ u0: -24, side: 1, hu: 2.8, reach: 2.7, th: 1.6 }, { u0: -10, side: 0, hu: 2.2, reach: 2.4, th: 1.2 },
   { u0: 8, side: 1, hu: 2.0, reach: 2.2, th: 1.0 }, { u0: 18, side: 0, hu: 3.0, reach: 2.8, th: 1.5 },
   { u0: 29, side: 1, hu: 2.0, reach: 2.0, th: 0.9 }],
];
export const SLAB_REACH_MAX = 2.8;
// Triangle wave, -1..1, period 1: straight runs and hard kinks, the en-echelon zigzag of a real
// tension crack (a sine reads as a meander, a river, not rock).
const tri = t => 4 * Math.abs(t - Math.floor(t + 0.5)) - 1;
// The crack's centreline wanders off the bearing axis in kinked runs by up to 3.3-3.8 u (measured per zone;
// MID_MAX 6.0 below is the analytic bound the cheap reject uses) (kinks every
// ~12 u and ~4.5 u: both at or above two mesh cells, ~2.3 u at the rifts). Pinned to 0 at u = 0 so
// the opening stays centred on riftPos (the ending's spline and the fall-through rely on it).
function midAt(F, u) {
  const m = F.ph.m;
  return 2.2 * (tri(u / 24 + m[0]) - tri(m[0])) + 0.8 * (tri(u / 9 + m[1]) - tri(m[1]));
}
// u along the bearing; v across, measured from the KINKED CENTRELINE, not the straight bearing
// axis (so fissureDist and inThroat follow the drawn crack). CONTRACT for every consumer:
//   world(u, v) = (cx, cz) + (dx, dz) * u + (-dz, dx) * (v + _midAt(F, u))   -> fissureWorld below
//   the lip on side s is at |v| = _halfWAt(F, u, s), s = 1 for v >= 0, s = 0 for v < 0 (the two
//   lips differ: never size both from one side), the throat at _halfWAt(F, u, s) * throatHalfW / halfW.
// Building positions as centre + dir * u + normal * v (ignoring _midAt) misses the crack by up to
// ~4 u, a whole throat half width.
export function fissureLocal(x, z, zi, out) {
  const F = FISSURE[zi], rx = x - F.cx, rz = z - F.cz;
  const u = rx * F.dx + rz * F.dz;
  out.u = u; out.v = -rx * F.dz + rz * F.dx - midAt(F, u); return out;
}
// The inverse of fissureLocal: writes out.x, out.z for crack coordinates (u, v). No allocation.
export function fissureWorld(u, v, zi, out) {
  const F = FISSURE[zi], w = v + midAt(F, u);
  out.x = F.cx + F.dx * u - F.dz * w; out.z = F.cz + F.dz * u + F.dx * w; return out;
}
// Half width on one side (side 1: v >= 0, side 0: v < 0). It pinches toward the ends (a crack
// thins to a hairline: (1 - t^2)^0.7, pointed, not the round ends of an ellipse) and each lip
// carries its own jag at 15 u and 6.5 u periods (anything finer aliases on the mesh grid into a
// regular sawtooth; it also rippled the apron that eases the ground toward the lip).
function halfWAt(F, u, side = 1) {
  widths(F, u); return side ? _w.w1 : _w.w0;
}
// Both sides at once (one taper, no allocation): writes _w.w0 (side 0) and _w.w1 (side 1).
const _w = { w0: 0, w1: 0 };
function widths(F, u) {
  const t = Math.min(1, Math.abs(u) / F.halfLen);
  const k = F.halfW * Math.pow(Math.max(0, 1 - t * t), 0.7);
  const a = F.ph.j[0], b = F.ph.j[1];
  _w.w0 = k * (1 + 0.22 * Math.sin(u * 0.41 + a[0]) + 0.14 * Math.sin(u * 0.97 + a[1]));
  _w.w1 = k * (1 + 0.22 * Math.sin(u * 0.41 + b[0]) + 0.14 * Math.sin(u * 0.97 + b[1]));
  return _w;
}
// How far slab sl juts past its lip at u (0 off its ends): rounded ends, a ragged front.
function slabReach(sl, u, w) {
  const q = (u - sl.u0) / sl.hu;
  if (q <= -1 || q >= 1) return 0;
  return Math.min(sl.reach, 0.42 * w) * Math.sqrt(1 - q * q) * (0.82 + 0.18 * Math.sin(u * 2.3 + sl.u0));
}
const _l = { u: 0, v: 0 };
// Signed distance to the lip outline: negative inside. Inside it is the interval distance
// max(v - w1, -v - w0) — continuous across the centreline even though the two lips differ (a
// side-switched |v| - w(side) stepped by |w1 - w0| there, up to ~4.7 u, down the throat floor).
export function fissureDist(x, z, zi) {
  const F = FISSURE[zi]; fissureLocal(x, z, zi, _l);
  if (Math.abs(_l.u) > F.halfLen) return Math.hypot(Math.abs(_l.u) - F.halfLen, _l.v);
  widths(F, _l.u);
  return Math.max(_l.v - _w.w1, -_l.v - _w.w0);
}
// THE CLEARANCE RULE (Task 5, spec §1 "Lairs"): everything placed in the world keeps LIP_CLEAR u
// plus its own radius r off the lip (it replaced each module's riftPos circle: the crack is long
// and narrow, a circle either swallowed the basin or missed the tips). Pure, no allocation.
export const LIP_CLEAR = 6;
// The APRON: within this of the lip terrain.js eases the ground up toward a shelf and heaves the lip
// (heightAt's fm). A body standing on it is lifted on its crack side: Velkath keeps her whole outline off it.
export const APRON = 14;
export function clearOfCrack(x, z, zi, r = 0) { return fissureDist(x, z, zi) > LIP_CLEAR + r; }
// The slab at (x, z): writes _sp.r = the local reach of the slab whose u-range and lip side hold the
// point (0 if none; the wall under and beyond a slab is set back by it, so the slab overhangs), and
// _sp.q = s / reach when the point is on the slab's footprint (s = how far inside its lip), else -1.
// _sp.th / _sp.side: that slab's thickness and lip side (player.js keeps him out of a slab's body
// when he is under it, not on it).
const _sp = { r: 0, q: -1, th: 0, side: 0 };
export function slabProbe(x, z, zi) {
  const F = FISSURE[zi], L = SLABS[zi]; fissureLocal(x, z, zi, _l);
  const u = _l.u, v = _l.v;
  _sp.r = 0; _sp.q = -1;
  for (let i = 0; i < L.length; i++) {
    const sl = L[i];
    if (Math.abs(u - sl.u0) >= sl.hu || (sl.side ? v < 0 : v >= 0)) continue;
    widths(F, u);
    const w = sl.side ? _w.w1 : _w.w0, s = w - (sl.side ? v : -v), r = slabReach(sl, u, w);
    _sp.r = r; _sp.th = sl.th; _sp.side = sl.side;
    if (s >= 0 && s < r) _sp.q = s / r;
    break;
  }
  return _sp;
}
// -1 off every slab footprint, else s / reach in [0, 1] (terrainH: a slab top is ground; inThroat:
// a slab is not open water).
export function slabAt(x, z, zi) { return slabProbe(x, z, zi).q; }
export function inThroat(x, z, zi) {
  const F = FISSURE[zi]; fissureLocal(x, z, zi, _l);
  if (Math.abs(_l.u) > F.halfLen * 0.92) return false;
  widths(F, _l.u);
  const k = F.throatHalfW / F.halfW;
  if (Math.max(_l.v - _w.w1 * k, -_l.v - _w.w0 * k) >= 0) return false;
  return slabAt(x, z, zi) < 0;
}
// THE JAM (shut): the walkable top of the rubble that chokes the crack, "a few units below the lip"
// (spec §1). jamYAt(u, zi, terrainH) is its surface at crack coordinate u — one profile per zone,
// a table at 0.25 u built once per terrain (boot / reseed) and read by lerp (no allocation, no
// terrainH per frame). Built from the lip line (fd = 0) on both sides at each station:
//   - JAM_BELOW_LIP under the HIGHER lip (a +-1 u windowed max), so from anywhere along the jam a
//     seabed hop and a step reach either lip: no trench to be trapped in;
//   - toward each tip (past |u| = JAM_T0 * halfLen) it rises on a smoothstep to that tip's own lip
//     (the tips are slots ~2 u wide and 8-12 u deep; filled, they walk out);
//   - never closer than JAM_UNDER_LIP under the LOWER lip (a +-0.5 u windowed min), so the floor
//     max(terrain, jam) is continuous at the outline and stepping in is never a step up — where the
//     two lips differ by more than JAM_BELOW_LIP - JAM_UNDER_LIP this cap wins and the higher lip
//     stands further above;
//   - slope-limited to |dy/du| <= JAM_SLOPE (lowering only).
// jamTopY(zi): the LOWEST point of the walkable middle (|u| <= JAM_T0 * halfLen) — what the trigger
// planes are checked against. lipMeanY(zi): the mean lip height (sampled 1.5 u outside each lip at
// nine stations through fissureWorld with each side's own width; the rift-shut beat's rim).
// terrainH is passed in so this module stays pure (terrain.js imports us; we must not import it).
// Cached: call resetJam() after a reseed (the terrain changed). (The plan's per-zone jamDepth, 7-9 u, made
// a trench Sal could not leave mid-crack; it is gone from the rows: the jam hangs JAM_BELOW_LIP under the lip.)
const JAM = [null, null, null], LIPMEAN = [0, 0, 0], _j = { x: 0, z: 0 };
const JAM_T0 = 0.5, JAM_BELOW_LIP = 2.0, JAM_UNDER_LIP = 0.4, JAM_DU = 0.25, JAM_SLOPE = 0.9;
const JAM_WIN_LO = 2, JAM_WIN_HI = 4;   // stations: +-0.5 u (cap), +-1 u (target)
const JAM_N = FISSURE.map(F => Math.round(2 * F.halfLen / JAM_DU) + 1);
const JAM_P = JAM_N.map(n => new Float32Array(n));
const _lipLo = new Float32Array(Math.max(...JAM_N)), _lipHi = new Float32Array(Math.max(...JAM_N));
function buildJam(zi, terrainH) {
  const F = FISSURE[zi], N = JAM_N[zi], P = JAM_P[zi];
  let s = 0, n = 0;
  for (let i = -4; i <= 4; i++) {
    const u = i / 4 * F.halfLen * 0.8;
    for (let sd = 0; sd < 2; sd++) {
      fissureWorld(u, (sd ? 1 : -1) * (halfWAt(F, u, sd) + 1.5), zi, _j);
      s += terrainH(_j.x, _j.z, zi); n++;
    }
  }
  LIPMEAN[zi] = s / n;
  for (let i = 0; i < N; i++) {
    const u = -F.halfLen + i * JAM_DU; let lo = 1e9, hi = -1e9;
    for (let sd = 0; sd < 2; sd++) {
      fissureWorld(u, (sd ? 1 : -1) * halfWAt(F, u, sd), zi, _j);
      const h = terrainH(_j.x, _j.z, zi); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    _lipLo[i] = lo; _lipHi[i] = hi;
  }
  const cap = i => {   // the lower lip, windowed min, less the margin
    let m = 1e9;
    for (let k = Math.max(0, i - JAM_WIN_LO); k <= Math.min(N - 1, i + JAM_WIN_LO); k++) m = Math.min(m, _lipLo[k]);
    return m - JAM_UNDER_LIP;
  };
  const want = i => {  // the higher lip, windowed max, less JAM_BELOW_LIP
    let m = -1e9;
    for (let k = Math.max(0, i - JAM_WIN_HI); k <= Math.min(N - 1, i + JAM_WIN_HI); k++) m = Math.max(m, _lipHi[k]);
    return m - JAM_BELOW_LIP;
  };
  const tipW = cap(0), tipE = cap(N - 1);
  for (let i = 0; i < N; i++) {
    const u = -F.halfLen + i * JAM_DU, t = Math.min(1, Math.abs(u) / F.halfLen);
    let y = want(i);
    if (t > JAM_T0) { const q = (t - JAM_T0) / (1 - JAM_T0), tip = u > 0 ? tipE : tipW; y += Math.max(0, tip - y) * q * q * (3 - 2 * q); }
    P[i] = Math.min(y, cap(i));
  }
  // a slope limiter that only ever LOWERS (so the profile stays under the lip): |dy/du| <= JAM_SLOPE
  const dm = JAM_SLOPE * JAM_DU;
  for (let i = 1; i < N; i++) P[i] = Math.min(P[i], P[i - 1] + dm);
  for (let i = N - 2; i >= 0; i--) P[i] = Math.min(P[i], P[i + 1] + dm);
  let lowest = 1e9;
  for (let i = 0; i < N; i++) if (Math.abs(-F.halfLen + i * JAM_DU) <= JAM_T0 * F.halfLen) lowest = Math.min(lowest, P[i]);
  JAM[zi] = lowest;
}
export function jamTopY(zi, terrainH) {
  if (JAM[zi] == null) { if (!terrainH) return -1e9; buildJam(zi, terrainH); }
  return JAM[zi];
}
export function lipMeanY(zi, terrainH) { jamTopY(zi, terrainH); return LIPMEAN[zi]; }
export function jamYAt(u, zi, terrainH) {
  if (jamTopY(zi, terrainH) < -1e8) return -1e9;
  const F = FISSURE[zi], N = JAM_N[zi], P = JAM_P[zi];
  const f = Math.min(N - 1, Math.max(0, (u + F.halfLen) / JAM_DU)), i = Math.min(N - 2, f | 0);
  return P[i] + (P[i + 1] - P[i]) * (f - i);
}
export function resetJam() { JAM[0] = JAM[1] = JAM[2] = null; JG[0] = JG[1] = JG[2] = null; }
// THE JAM'S FLOOR GRID (Task 3 fix round 1, controller ruling: "the jam floor becomes a baked (u,v)
// height grid made from the block tops plus drifted silt, step-limited so Sal walks ON the rocks").
// world/fissure.js bakes it per zone at layout (boot, every reseed) from the boulders it draws and the
// silt it drifts between them; jamFloorAt(u, v) reads it bilinearly (no allocation), and terrain.js
// jamAt stands everything on it. jamYAt(u) stays the jam's BASE profile (the silt's datum: trigger
// clearance, the lip bounds, the stir pulse); the grid only ever lies at or above it, slope- and
// step-limited (a block stands at most a step proud of the silt banked round it). Until a grid is
// baked (and after resetJam, which makes it stale) jamFloorAt is jamYAt.
//   grid: { u0, v0, d, nu, nv, h: Float32Array(nu * nv) }, cell (i, j) at u0 + i d, v0 + j d, h[i * nv + j]
const JG = [null, null, null];
export function setJamGrid(zi, g) { JG[zi] = g; }
export function jamGrid(zi) { return JG[zi]; }
export function jamFloorAt(u, v, zi, terrainH) {
  const g = JG[zi];
  if (!g) return jamYAt(u, zi, terrainH);
  const fu = Math.min(g.nu - 1.0001, Math.max(0, (u - g.u0) / g.d)), fv = Math.min(g.nv - 1.0001, Math.max(0, (v - g.v0) / g.d));
  const i = fu | 0, j = fv | 0, a = fu - i, b = fv - j, h = g.h, o = i * g.nv + j;
  return (h[o] * (1 - b) + h[o + 1] * b) * (1 - a) + (h[o + g.nv] * (1 - b) + h[o + g.nv + 1] * b) * a;
}
// SHUT OR OPEN, per zone: the one runtime flag here. The fissure's state owner (game.js's stub now,
// world/fissure.js from Task 3) sets it every frame; terrain.js's jamAt / shutFloorY read it, so
// every consumer of "the ground under X" (player, hose, spear, sonar ring, camera) agrees on the jam.
const SHUT = [true, true, true];
export function setFissureShut(zi, shut) { SHUT[zi] = !!shut; }
export function fissureShut(zi) { return SHUT[zi]; }
// THE SLUMP (world/fissure.js, the opening): while the jam fails, before the throat opens, its
// middle sags into the throat. The sag is part of the FLOOR (terrain.js jamAt subtracts jamSagAt),
// so a man stood on it rides it down with the drawn silt instead of hovering over a sinking
// surface. jamSagProfile(u, v): 1 over the throat's middle, 0 at the lips and toward the tips.
// SAG is 0 except during an opening: every other reader sees jamYAt exactly.
const SAG = [0, 0, 0];
export function setJamSag(zi, s) { SAG[zi] = s; }
export function jamSagProfile(u, v, zi) {
  const F = FISSURE[zi]; widths(F, u);
  const w = v >= 0 ? _w.w1 : _w.w0, f = Math.min(1, Math.abs(v) / Math.max(0.3, w)), a = Math.min(1, Math.abs(u) / F.halfLen);
  const sf = f <= 0.25 ? 0 : (f >= 1 ? 1 : ((f - 0.25) / 0.75) ** 2 * (3 - 2 * (f - 0.25) / 0.75));
  const sa = a <= 0.5 ? 0 : (a >= 0.9 ? 1 : ((a - 0.5) / 0.4) ** 2 * (3 - 2 * (a - 0.5) / 0.4));
  return (1 - sf) * (1 - sa);
}
export function jamSagAt(u, v, zi) { return SAG[zi] === 0 ? 0 : SAG[zi] * jamSagProfile(u, v, zi); }
// THE OPEN SHAFT AT A HEIGHT (final fix wave I1): the open interval across the crack (v) at station u
// where the ground stays under height y — floorAt(x, z, zi) is passed in (terrain.js shutFloorY), so this
// module stays pure. Marched out in `step` u from the open sample nearest vRef (vRef itself first), over
// the lip interval and 1.5 u past each lip. Writes out.lo / out.hi (the outermost open samples: the face
// lies within `step` beyond each) and out.loOpen / out.hiOpen (the run reaches past that lip: no wall on
// that side at this height). False: no open water at this station at this height (the throat floor, a
// tip). Allocation-free; ~(run width / step) floor samples. The shaft only widens upward (the walls step
// down in s, never overhang but under the slabs, which the floor counts as rock), so a run found at y is
// open from y up. Shared by the follow lens (game.js throatLens) and Sal's fall (player.js holdInShaft),
// so they agree on where the shaft is.
const _ow = { x: 0, z: 0 };
function openAt(u, v, zi, y, floorAt) { fissureWorld(u, v, zi, _ow); return floorAt(_ow.x, _ow.z, zi) < y; }
export function openRunAt(u, vRef, zi, y, floorAt, out, step = 0.2) {
  const F = FISSURE[zi]; widths(F, u);
  const vMin = -_w.w0 - 1.5, vMax = _w.w1 + 1.5;   // (read now: floorAt -> terrainH -> fissureDist re-uses _w)
  const vr = Math.min(vMax, Math.max(vMin, vRef)), nk = Math.ceil((vMax - vMin) / step);
  let v0 = NaN;
  for (let k = 0; k <= nk; k++) {
    const a = vr + k * step, b = vr - k * step;
    if (a <= vMax && openAt(u, a, zi, y, floorAt)) { v0 = a; break; }
    if (k > 0 && b >= vMin && openAt(u, b, zi, y, floorAt)) { v0 = b; break; }
    if (a > vMax && b < vMin) break;
  }
  if (v0 !== v0) return false;
  let lo = v0, hi = v0;
  while (lo - step >= vMin && openAt(u, lo - step, zi, y, floorAt)) lo -= step;
  while (hi + step <= vMax && openAt(u, hi + step, zi, y, floorAt)) hi += step;
  out.lo = lo; out.hi = hi; out.loOpen = lo - step < vMin; out.hiOpen = hi + step > vMax;
  return true;
}
export { halfWAt as _halfWAt, midAt as _midAt, widths as _widths, slabReach as _slabReach };
