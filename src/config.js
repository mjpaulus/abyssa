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
