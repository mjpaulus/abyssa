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
export const FISSURE = ROWS.map((r, zi) => {
  const p = riftPos(zi);
  return Object.freeze({ cx: p.x, cz: p.z, dx: Math.cos(r.bear), dz: Math.sin(r.bear), halfLen: r.halfLen,
    halfW: r.halfW, throatHalfW: r.throatHalfW, lipDrop: r.lipDrop, jamDepth: r.jamDepth, ph: PH[zi] });
});
// Triangle wave, -1..1, period 1: straight runs and hard kinks, the en-echelon zigzag of a real
// tension crack (a sine reads as a meander, a river, not rock).
const tri = t => 4 * Math.abs(t - Math.floor(t + 0.5)) - 1;
// The crack's centreline wanders off the bearing axis by up to ~3 u in kinked runs (kinks every
// ~12 u and ~4.5 u: both at or above two mesh cells, ~2.3 u at the rifts). Pinned to 0 at u = 0 so
// the opening stays centred on riftPos (the ending's spline and the fall-through rely on it).
function midAt(F, u) {
  const m = F.ph.m;
  return 2.2 * (tri(u / 24 + m[0]) - tri(m[0])) + 0.8 * (tri(u / 9 + m[1]) - tri(m[1]));
}
// u along the bearing; v across, measured from the kinked centreline (so fissureDist and inThroat
// follow the drawn crack, not the straight axis).
export function fissureLocal(x, z, zi, out) {
  const F = FISSURE[zi], rx = x - F.cx, rz = z - F.cz;
  const u = rx * F.dx + rz * F.dz;
  out.u = u; out.v = -rx * F.dz + rz * F.dx - midAt(F, u); return out;
}
// Half width on one side (side 1: v >= 0, side 0: v < 0). It pinches toward the ends (a crack
// thins to a hairline: (1 - t^2)^0.7, pointed, not the round ends of an ellipse) and each lip
// carries its own jag at 15 u and 6.5 u periods (anything finer aliases on the mesh grid into a
// regular sawtooth; it also rippled the apron that eases the ground toward the lip).
function halfWAt(F, u, side = 1) {
  const t = Math.min(1, Math.abs(u) / F.halfLen);
  const taper = Math.pow(Math.max(0, 1 - t * t), 0.7);
  const ph = F.ph.j[side ? 1 : 0];
  const jag = 0.22 * Math.sin(u * 0.41 + ph[0]) + 0.14 * Math.sin(u * 0.97 + ph[1]);
  return F.halfW * taper * (1 + jag);
}
const _l = { u: 0, v: 0 };
export function fissureDist(x, z, zi) {
  const F = FISSURE[zi]; fissureLocal(x, z, zi, _l);
  if (Math.abs(_l.u) > F.halfLen) return Math.hypot(Math.abs(_l.u) - F.halfLen, _l.v);
  return Math.abs(_l.v) - halfWAt(F, _l.u, _l.v >= 0 ? 1 : 0);
}
export function inThroat(x, z, zi) {
  const F = FISSURE[zi]; fissureLocal(x, z, zi, _l);
  if (Math.abs(_l.u) > F.halfLen * 0.92) return false;
  return Math.abs(_l.v) < halfWAt(F, _l.u, _l.v >= 0 ? 1 : 0) * (F.throatHalfW / F.halfW);
}
export { halfWAt as _halfWAt, midAt as _midAt };   // terrain.js carving uses the same edge
