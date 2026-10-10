// src/world/fissureShape.js — THE FISSURE's shape, the single source of truth (spec 2026-10-10).
// Pure: no THREE, no state beyond the frozen table. Every consumer (terrain carving, fall-through,
// exclusions, the jam, the light, the ending) asks here instead of drawing its own circle.
// The query functions allocate nothing (one module scratch object); terrainH calls fissureDist
// on every sample, so keep them cheap.
import { riftPos } from '../config.js';
// Authored per zone: bearing of the crack (radians) and its proportions. Bearings chosen so the
// crack runs across the basin, not toward the wall; lengths/widths inside the spec's ranges.
const ROWS = [
  { bear: 0.55, halfLen: 36, halfW: 6.5, throatHalfW: 4.2, lipDrop: 6, jamDepth: 7 },   // zone 0: limestone
  { bear: 2.20, halfLen: 33, halfW: 7.0, throatHalfW: 4.6, lipDrop: 5, jamDepth: 8 },   // zone 1: scorched
  { bear: 1.05, halfLen: 38, halfW: 7.5, throatHalfW: 5.0, lipDrop: 7, jamDepth: 9 },   // zone 2: basalt
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
const MID_MAX = 6.0, JAG_MAX = 1.36;
export const FISSURE = ROWS.map((r, zi) => {
  const p = riftPos(zi);
  const reach = Math.hypot(r.halfLen, MID_MAX + JAG_MAX * r.halfW) + 14 + 0.5;
  return Object.freeze({ cx: p.x, cz: p.z, dx: Math.cos(r.bear), dz: Math.sin(r.bear), halfLen: r.halfLen,
    halfW: r.halfW, throatHalfW: r.throatHalfW, lipDrop: r.lipDrop, jamDepth: r.jamDepth, ph: PH[zi],
    apronR2: reach * reach });   // fissureDist >= 14 everywhere outside this squared radius
});
// OVERHANG SLABS (fix round 1): a few slabs of the lip that have not fallen yet, jutting over the void.
// A heightfield can hold their TOPS (terrainH lifts the ground to them, so Sal stands on what is drawn)
// but not their undersides: terrain.js draws the carved wall under them in the fissure patch and the
// slab itself (top + front + underside) as rock. u0: centre along the crack; side: which lip
// (1: v >= 0, 0: v < 0); hu: half length along u; reach: how far past the lip it juts; th: thickness.
// Kept off the middle (|u| >= 7) so the opening the ending and the jam use stays clear.
export const SLABS = [
  [{ u0: -19, side: 1, hu: 2.6, reach: 2.0, th: 1.3 }, { u0: -8, side: 0, hu: 2.0, reach: 1.6, th: 1.0 },
   { u0: 11, side: 1, hu: 2.2, reach: 1.8, th: 1.5 }, { u0: 22, side: 0, hu: 2.8, reach: 1.7, th: 1.1 }],
  [{ u0: -17, side: 0, hu: 2.4, reach: 1.9, th: 1.2 }, { u0: -7, side: 1, hu: 1.9, reach: 1.5, th: 1.0 },
   { u0: 9, side: 0, hu: 2.6, reach: 2.0, th: 1.4 }, { u0: 20, side: 1, hu: 2.2, reach: 1.6, th: 1.1 }],
  [{ u0: -24, side: 1, hu: 2.8, reach: 2.1, th: 1.6 }, { u0: -10, side: 0, hu: 2.2, reach: 1.8, th: 1.2 },
   { u0: 8, side: 1, hu: 2.0, reach: 1.6, th: 1.0 }, { u0: 18, side: 0, hu: 3.0, reach: 2.2, th: 1.5 },
   { u0: 29, side: 1, hu: 2.0, reach: 1.4, th: 0.9 }],
];
export const SLAB_REACH_MAX = 2.2;
// Triangle wave, -1..1, period 1: straight runs and hard kinks, the en-echelon zigzag of a real
// tension crack (a sine reads as a meander, a river, not rock).
const tri = t => 4 * Math.abs(t - Math.floor(t + 0.5)) - 1;
// The crack's centreline wanders off the bearing axis by up to ~4 u in kinked runs (kinks every
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
// The slab at (x, z): writes _sp.r = the local reach of the slab whose u-range and lip side hold the
// point (0 if none; the wall under and beyond a slab is set back by it, so the slab overhangs), and
// _sp.q = s / reach when the point is on the slab's footprint (s = how far inside its lip), else -1.
const _sp = { r: 0, q: -1 };
export function slabProbe(x, z, zi) {
  const F = FISSURE[zi], L = SLABS[zi]; fissureLocal(x, z, zi, _l);
  const u = _l.u, v = _l.v;
  _sp.r = 0; _sp.q = -1;
  for (let i = 0; i < L.length; i++) {
    const sl = L[i];
    if (Math.abs(u - sl.u0) >= sl.hu || (sl.side ? v < 0 : v >= 0)) continue;
    widths(F, u);
    const w = sl.side ? _w.w1 : _w.w0, s = w - (sl.side ? v : -v), r = slabReach(sl, u, w);
    _sp.r = r;
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
export { halfWAt as _halfWAt, midAt as _midAt, widths as _widths, slabReach as _slabReach };
