// Shared world layout constants. READ-ONLY for feature agents.
export const WORLD_R = 260;
export const ZONE_H = 220;
export const ZONE_GAP = 90;
export const SURFACE_Y = 0;
export const RIFT_R = 16;

export const zoneTop = i => -(40 + i * (ZONE_H + ZONE_GAP));
export const zoneBottom = i => zoneTop(i) - ZONE_H;

// Deterministic rift (zone exit) location per zone.
export function riftPos(i) {
  const a = i * 2.4 + 0.8;
  return { x: Math.cos(a) * WORLD_R * 0.45, y: 0, z: Math.sin(a) * WORLD_R * 0.45 };
}

export const LEVIATHAN_CFG = [
  { segs: 30, size: 5.5, speed: 9, nSigils: 3, color: 0x1d3a44, emiss: 0x0e2a33, hue: 0.52, name: 'VELKATH, THE PALE RIBBON' },
  { segs: 40, size: 7.5, speed: 12, nSigils: 4, color: 0x2a1d44, emiss: 0x1d1033, hue: 0.74, name: 'ORUNE, CROWN OF THORNS' },
  { segs: 52, size: 10, speed: 15, nSigils: 5, color: 0x441d1d, emiss: 0x330e0e, hue: 0.02, name: 'MHOR, THE LAST FURNACE' }
];

// THE SUN. One direction, shared: lighting.js aims the key light and its shadow camera
// down it, water.js draws the sky disc, the sea's glitter path and the god-ray shaft
// offset off it. They were separate copies of the same three numbers and would have
// silently drifted apart the first time either moved.
//
// Elevation is the whole argument. It sat at 77 degrees — near-vertical, which nobody
// chose; it was just "roughly downward" back when the camera never came above water.
// At that angle every shadow falls directly under the thing casting it, so the raft's
// deck renders flat no matter how much detail is on it. Lower rakes the light across
// the planks and slants the shafts below.
//
// The floor is physics, not taste: refraction at the surface compresses the entire sky
// into Snell's window, so a sun anywhere in the sky arrives underwater at no shallower
// than 41.4 degrees. Going under that would light the seabed from an angle the sea
// cannot produce.
export const SUN_ELEV_DEG = 58;
