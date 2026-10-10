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
export const FISSURE = ROWS.map((r, zi) => {
  const p = riftPos(zi);
  return Object.freeze({ cx: p.x, cz: p.z, dx: Math.cos(r.bear), dz: Math.sin(r.bear), halfLen: r.halfLen,
    halfW: r.halfW, throatHalfW: r.throatHalfW, lipDrop: r.lipDrop, jamDepth: r.jamDepth });
});
export function fissureLocal(x, z, zi, out) {
  const F = FISSURE[zi], rx = x - F.cx, rz = z - F.cz;
  out.u = rx * F.dx + rz * F.dz; out.v = -rx * F.dz + rz * F.dx; return out;
}
// Half width tapers toward the ends (a crack pinches out), with a jagged edge from cheap hash
// noise along u so the outline is not a capsule.
function halfWAt(F, u) {
  const t = Math.min(1, Math.abs(u) / F.halfLen);
  const taper = Math.sqrt(Math.max(0, 1 - t * t));
  const jag = 0.18 * Math.sin(u * 0.61 + 1.3) + 0.12 * Math.sin(u * 1.73 - 0.4) + 0.07 * Math.sin(u * 3.9);
  return F.halfW * taper * (1 + jag);
}
const _l = { u: 0, v: 0 };
export function fissureDist(x, z, zi) {
  const F = FISSURE[zi]; fissureLocal(x, z, zi, _l);
  if (Math.abs(_l.u) > F.halfLen) return Math.hypot(Math.abs(_l.u) - F.halfLen, _l.v);
  return Math.abs(_l.v) - halfWAt(F, _l.u);
}
export function inThroat(x, z, zi) {
  const F = FISSURE[zi]; fissureLocal(x, z, zi, _l);
  if (Math.abs(_l.u) > F.halfLen * 0.92) return false;
  return Math.abs(_l.v) < halfWAt(F, _l.u) * (F.throatHalfW / F.halfW);
}
export { halfWAt as _halfWAt };   // terrain.js carving uses the same edge
