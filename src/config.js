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

// THE GLASS: the sun is a LIVE vector now, one authority for every consumer
// (lighting key + shadow cam, sky disc, glitter, god-ray shafts, terrain caustics).
// setSun() recomputes in place each frame from weather's time-of-day; nothing may
// cache a copy at module load. `dirWater` is the same sun with elevation clamped at
// Snell's 41.4 degrees — underwater consumers read it so depth can never be lit
// from an angle the sea cannot produce. Defaults reproduce the shipped constants
// exactly (elev 58, azimuth atan2(0.4472,0.8944) = 26.565 deg).
const _d2r = Math.PI / 180;
function _sunVec(o, elevDeg, azimDeg) {
  const k = 1 / Math.tan(elevDeg * _d2r);
  const ax = Math.cos(azimDeg * _d2r), az = Math.sin(azimDeg * _d2r);
  const x = ax * k, z = az * k, l = Math.hypot(x, 1, z);
  o.x = x / l; o.y = 1 / l; o.z = z / l;
}
export const SUN = {
  elevDeg: SUN_ELEV_DEG, azimDeg: 26.565,
  dir: { x: 0, y: 0, z: 0 },        // unit, +y up — in AIR
  dirWater: { x: 0, y: 0, z: 0 },   // unit, elevation clamped >= 41.4
  proj: [0, 0]                       // dirWater.xz / dirWater.y (god-ray descent)
};
export function setSun(elevDeg, azimDeg) {
  SUN.elevDeg = elevDeg; SUN.azimDeg = azimDeg;
  _sunVec(SUN.dir, Math.max(2, elevDeg), azimDeg);
  _sunVec(SUN.dirWater, Math.max(41.4, elevDeg), azimDeg);
  SUN.proj[0] = SUN.dirWater.x / SUN.dirWater.y;
  SUN.proj[1] = SUN.dirWater.z / SUN.dirWater.y;
}
setSun(SUN_ELEV_DEG, 26.565);

// ---------------------------------------------------------------------------
// THE GLASS — the tuning surface for the weather/light lab.
//
// WHY IT LIVES HERE and not in water.js (the brief offered the choice): weather.js
// needs GLASS.sun to place the sun, water.js needs GLASS.stops to paint the sky, and
// lighting/terrain read SUN. config.js is already the one module all of them import
// and the one that owns the live sun, so putting the data here is the only
// arrangement with no import cycle and no module importing a sibling for constants.
// water.js RE-EXPORTS `GLASS` so the contract in the brief still reads from there.
//
// Everything below is PLAIN MUTABLE DATA. The lab pokes it live; every consumer
// re-reads it each frame, so there is nothing to invalidate and nothing to rebuild.
// No consumer may cache a value out of it at module load.
//
// PALETTE STOPS. Five authored looks blended on a ring:
//   night -> dawn -> noon -> dusk -> night   (ring coordinate 0..4, wrapping)
// then cross-faded toward `storm` by the storm envelope. Fields:
//   zen   sky zenith radiance, scene-linear (see the bloom note in water.js ~line 90)
//   hor   sky horizon radiance — the window's only structural landmark
//   disc  sun/moon disc radiance (the one thing allowed over the 0.28 bloom threshold)
//   tint  per-channel multiplier on SURF_LIGHT — the surface irradiance's colour
//   surfK scalar on SURF_LIGHT — on TOP of game.js's own day/storm surfK
//   desat pull of zen/hor toward their own luminance
//
// THE REGRESSION ANCHOR IS THE `noon` STOP: tint [1,1,1], surfK 1, desat 0, and zen/
// hor/disc exactly the values water.js shipped as SKY_ZEN_D / SKY_HOR_D / SUN_DISC.
// At day = 1, storm = 0 the ring lands exactly on it, so today's noon is reproduced
// bit-for-bit. `night` is likewise exactly the old SKY_*_N / MOON_DISC pair, which is
// what the old two-point night/day lerp reached at day = 0. Do not "improve" either.
export const GLASS = {
  sun: {
    elevNoon: SUN_ELEV_DEG,  // solar elevation at high noon — the shipped 58
    elevDawn: 12,            // elevation at the dawn/dusk crossing
    elevNight: 8,            // held floor below the horizon (moon/ambient regime)
    azimCenter: 26.565,      // azimuth AT NOON — atan2(0.447214, 0.894427), shipped
    azimSweep: 120           // total degrees swept across one full cycle
  },
  stops: {
    night: {
      zen: [0.0045, 0.0068, 0.0135], hor: [0.0165, 0.0180, 0.0210],
      disc: [0.30, 0.34, 0.42], tint: [1, 1, 1], surfK: 1, desat: 0
    },
    // Low amber sun over a rose horizon; the zenith is still nearly night.
    dawn: {
      zen: [0.055, 0.075, 0.150], hor: [0.520, 0.330, 0.260],
      disc: [3.20, 1.75, 0.85], tint: [1.18, 1.00, 0.86], surfK: 0.72, desat: 0
    },
    noon: {
      zen: [0.090, 0.155, 0.310], hor: [0.620, 0.660, 0.720],
      disc: [3.40, 3.00, 2.30], tint: [1, 1, 1], surfK: 1, desat: 0
    },
    // Ember: dusk is dawn with the red pushed and the blue pulled.
    dusk: {
      zen: [0.048, 0.058, 0.120], hor: [0.560, 0.270, 0.180],
      disc: [3.30, 1.45, 0.62], tint: [1.24, 0.99, 0.82], surfK: 0.66, desat: 0.05
    },
    // Desaturated slate-green. Sits where the old `gain 0.38 / desat 0.5` storm math
    // landed at noon, then pushed off the blue axis so a gale reads as weather rather
    // than as dimmed sunshine.
    storm: {
      zen: [0.052, 0.068, 0.078], hor: [0.235, 0.258, 0.250],
      disc: [0.42, 0.46, 0.42], tint: [0.92, 1.00, 0.95], surfK: 1, desat: 0.55
    }
  }
};

// Live sky phase, published by weather.js and read by water.js. Same arrangement as
// SUN: a one-way channel through config.js so the palette needs no game.js wiring.
//   phase01  0 = midnight, 0.5 = noon, wraps at 1
//   ring     position on the night->dawn->noon->dusk ring, 0..4 (2 = noon exactly)
export const SKY = { phase01: 0.5, ring: 2 };
export function setSkyPhase(phase01, ring) { SKY.phase01 = phase01; SKY.ring = ring; }
