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
      // THE ONE SANCTIONED CHANGE TO THE SHIPPED NOON (Michael's ruling: the shipped
      // noon was flat — "no blue sky"). Old zenith: [0.090, 0.155, 0.310]. The blue
      // channel is NOT raised (0.310 already sits over BloomEffect's 0.28 and making it
      // brighter would put a bloom halo on the whole upper sky); red and green come DOWN
      // instead, which is what turns a pale cyan-white lid into a marine blue. Ratios:
      // blue/red 3.44 -> 7.50, blue/green 2.00 -> 2.86. `hor` and `disc` are untouched,
      // so the horizon ring, the disc, the tint, surfK and desat all still anchor and
      // everything derived from SURF_LIGHT (scene.fog.color, ambient) is bit-identical.
      zen: [0.040, 0.105, 0.300], hor: [0.620, 0.660, 0.720],
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
  },

  // --- SKY DRAMA (clouds / marine layer / moon). Authored constants for the three
  // beats water.js draws in the sky dome and the sea's air-side branch. All plain data,
  // all read once per frame by water.js's updateWater — poke any of it live.
  //
  // CLOUDS. The field is one FBM on a plane projected overhead; `cov` maps the day
  // hand's `clouds` onto the smoothstep threshold, `soft` is the edge width (a fair-
  // weather cumulus has a hard edge, a storm deck has none), and the two colours are
  // resolved on the CPU from the palette so the deck is always made of the same light
  // as the sky behind it.
  cloud: {
    // uv scale on the projected plane. The deck this replaced ran at 0.35 and got away
    // with it because it was a soft multiplicative dimming with no shape to read: at
    // that scale the ENTIRE visible hemisphere maps into ~0.35 uv, which is a third of
    // one fbm cell, so the sky was one enormous smooth blob (measured — a clean blue
    // zenith with no cloud in it at coverage 0.48). Several cells across the sky is what
    // makes a cumulus a cumulus. Came DOWN from 3.2 when the island mask below landed:
    // once the mask groups cells into clumps, 3.2 made each clump a stipple of small
    // identical puffs. At 2.4 one clump is one cloud with its own silhouette — measured
    // at hand.clouds 0.4, mean component size 0.45% -> 0.93% of the sky for the same
    // total cover.
    scale: 2.4,
    drift: 0.028,         // uv per second at wind.speed 1 (a system moving, not a fan)
    covCalm: 0.16,        // coverage floor even at hand.clouds 0 (a few high wisps)
    covGain: 0.74,        // coverage added at hand.clouds 1
    covStorm: 0.30,       // extra coverage the storm envelope buys on top
    softCalm: 0.30,       // cumulus: crisp edges
    softStorm: 0.78,      // deck: no edges at all, one flat lid
    // NOT LIVE-POKEABLE: hazeK, backPow and backK are COMPILED INTO the shader as
    // literals (they are pure curve shape, so they cost a uniform for nothing). Every
    // other field below rides a uniform and answers on the next frame, the way the rest
    // of THE GLASS does. Changing the three baked ones needs a reload.
    //
    // CLUMPS, not a field. A second, much lower-frequency value-noise blob field gates
    // WHERE cloud may exist; the coverage threshold swings by +/-islAmp across it (two-
    // sided — a one-sided penalty just empties the sky). islScale is relative to the
    // cumulus uv, so one island holds several cumulus cells. Raising islGate empties
    // more of the sky; raising islAmp hardens the edge between "cloudy region" and
    // "clear region". islAmp is faded out above coverage 0.62 so a storm still shuts.
    islScale: 0.42,
    islGate: 0.46,
    islSoft: 0.30,
    islAmp: 0.20,
    // Ragged silhouette: one high-frequency vn sample perturbing the density +/-rag/2
    // before the threshold, so edges tear rather than following the fbm's own contour.
    ragScale: 3.4,
    rag: 0.10,
    // HORIZON GATHERING. Added to the threshold as view elevation climbs (smoothstep
    // over up 0.35..0.95, i.e. 20 to 72 degrees), so the zenith goes nearly clean on a
    // fair day while the low band keeps its cloud. Storm-scaled to zero on the CPU — a
    // gale's deck covers the zenith too.
    zenBias: 0.16,
    // THE MILKY BAND: clouds dissolve back into the sky over the lowest hazeUp of the
    // hemisphere (0.18 = 10.4 degrees), by hazeK at the waterline, so there is no hard
    // cloud/sea meeting on a CLEAR day. The marine layer's own white-out is separate and
    // multiplies after this; they cannot double-apply because this scales the cloud's
    // amount, not the colour.
    hazeUp: 0.18,
    hazeK: 0.92,
    // DARK BASES at the day's edges. backElev is the solar elevation (degrees) over
    // which the backlit response dies; under it the lighting term is pushed through
    // pow(k, backPow) * backK, which darkens the body and keeps only the sunward rim
    // lit. At noon this is inert. 34 (not the dawn/dusk stop's own 12) because the term
    // has to be ALREADY STRONG when the ring reaches that stop, not just starting:
    // at elevation 12 this deals 0.65, at 20 it deals 0.41, at the shipped noon 58 it
    // is exactly 0 and the lit-top response is byte-identical to what shipped.
    backElev: 34,
    backPow: 2.2,
    backK: 0.88,
    // FORM — the dimension pass. The shaping pass cut good silhouettes and Michael read
    // the result as flat cutouts, because a coverage map has an outline and no interior.
    // These six give the interior relief. They cost NO extra noise samples: the sunward
    // density gradient and the ragged-edge vn are both already computed for other
    // reasons, and this block just reads them a second way. All except formGrad/formDepth
    // (pure curve shape) are storm-scaled to zero on the CPU.
    formGrad: 0.055,      // half-width of the terminator in gradient units. Wider than
                          // this and the two flanks blur back into the soft vignette the
                          // shipped k already was; much narrower and the shadow line
                          // crawls with the noise and reads as a seam, not a curve.
    formDepth: 0.20,      // density above the coverage threshold that counts as "the top
                          // of the cloud". The amt ramp is uCloudSoft (0.30) wide, so at
                          // 0.20 the skirt band is genuinely the outer feathered third
                          // and the crown only lands where the body is actually thick.
    formShade: 0.55,      // how far the anti-sunward flank's lighting is pulled down.
                          // This is THE dimension knob — it is the whole lit-side /
                          // shadow-side split, and it is what the sun-side ratio probe
                          // measures. Over ~0.7 a fair noon sky starts to look bruised.
    formBase: 0.45,       // flat dark underside at noon. Faded out by uCloudBak so it
                          // never stacks with the dawn/dusk backlit bases.
    formTop: 0.30,        // crown highlight where the body is deep AND facing the sun.
                          // k is clamped to 1 afterwards, so this can brighten a top
                          // toward uCloudLit and never past it — the 0.85x horizon bloom
                          // cap is structural here, not a tuning result.
    formDetail: 0.30,     // cauliflower relief on lit faces (the rag vn is +/-0.5, so
                          // this is +/-0.15 on the lighting term), dying to nothing in
                          // shadow. Lumpy light side, smooth dark side = curvature.
    // Cloud colours are multipliers on the palette's HORIZON radiance. litK sits UNDER 1
    // on purpose: at noon the horizon is 0.62-0.72 scene-linear and already over the 0.28
    // bloom threshold, so a physically-white cumulus at 1.55x measured 0.96 and bloomed
    // three times harder than the sky it sat in — a fireworks sky, which this game is not.
    // At 0.85 a lit top measures ~0.53: brightly white against the 0.30 blue zenith,
    // a shade under the bright horizon band, and nothing new crossing the threshold.
    litK: 0.85,           // brightness of a sun-facing cloud top vs the horizon sky
    baseK: 0.42,          // darkness of the underside vs the horizon sky, at cloudTex 0
    baseDark: 0.26,       // how much further cloudTex 1 pushes the underside down
    stormLit: 0.30,       // the lit colour collapses toward the base under a storm deck
    // PEAK scene-linear radiance of an ember-lit cloud top at the dawn/dusk stops. The
    // disc's own colour is renormalised to this, deliberately just UNDER BloomEffect's
    // 0.28: the sunset payoff is coverage and hue, not a glowing sky. The moon disc is
    // the only thing this card is allowed to put over that line.
    emberK: 0.26,
    emberElev: 26,        // degrees of solar elevation over which the ember term dies
    // Gain on the day hand's sunsetDrama before it is clamped. A clear day deals ~0.08
    // and a post-storm clearing ~0.55-0.73; at gain 1 both rounded to nothing. At 1.7 a
    // clear evening reaches 0.14 and a post-storm one saturates — which is the card's
    // acceptance test ("a post-storm sunset visibly outdrames a clear one") made a knob.
    emberGain: 1.7
  },
  // MARINE LAYER. The morning white-out. `thr`/`full` map hand.fog onto 0..1; the
  // burn-off is keyed on solar ELEVATION against the hand's own fogBurn, so the sun
  // really does eat it from the top down. Storms blow it out.
  fog: {
    thr: 0.34, full: 0.66,
    burnBand: 9,          // degrees below fogBurn over which it thins to nothing
    maxK: 0.94,           // horizon whiteness at full fog (never a solid 1.0)
    zenK: 0.42,           // share of that which reaches the zenith
    discK: 0.82,          // how much of the disc heavy fog eats (pale disc, no glitter)
    stormKill: 0.70,      // a gale clears the fog
    nightK: 0.35,         // fog at deep night vs at noon
    // The white-out colour, as a multiplier on the palette's HORIZON — so the fog is
    // always made of the day's own light and goes dark at night for free. Under 1 on
    // purpose: a lid at the full horizon radiance (0.62-0.72 at noon) would put the
    // WHOLE sky over the bloom threshold. At these values a foggy noon peaks at ~0.32
    // where a clear noon's horizon already peaks at 0.72, so the frame's peak radiance
    // goes DOWN in fog, which is also what the eye expects.
    col: [0.44, 0.45, 0.45]
  },
  // THE MOON. Its own arc, opposite the sun's: elevation is the sun's proxy negated, so
  // it is highest at midnight and gone by mid-morning. Radius is ANGULAR (radians) —
  // 0.052 is ~3 degrees, six times the real moon, which is the size the eye expects a
  // "big moon" to be in a game frame.
  moon: {
    elevMax: 62, azimOffset: 180,
    radius: 0.052,
    bright: 0.95,         // scene-linear radiance of the lit limb at moonK 1 (over the
                          // 0.28 bloom threshold ON PURPOSE — the disc is the one thing
                          // in this card allowed to)
    earthshine: 0.16,     // the unlit limb, so a crescent still reads as a sphere
    halo: 0.055,          // the soft aureole around it
    col: [0.72, 0.82, 1.00],  // cool; the night stop's disc was already this family
    hemiLift: 0.30        // hemisphere/ambient lift in lighting.js on a full-moon night
  },

  // --- WIND ON THE WATER. The wave field, the whitecaps and the subsurface drift all
  // read these. EVERY ONE OF THEM IS ZERO-SAFE: at wind.speed 0 the anisotropy mix, the
  // amplitude gain, the cap term and the current all collapse to exactly what shipped,
  // which is the regression anchor (calm windless noon must be indistinguishable).
  // water.js pushes anisoK/ampK/capThr/capK into uniforms every frame, so all four are
  // live-tunable; currentK/decayH are read by player.js each frame.
  windwater: {
    // Wind speed at which torn crests begin. Below this the only foam is the storm
    // spectrum's own |grad h| term that shipped.
    capThr: 0.60,
    capK: 1.00,           // strength of the cap mix at wind 1 (colour is clamped separately)
    // How far each wave component's bearing is dragged onto the wind axis, and how much
    // the amplitude is redistributed onto the aligned components. The redistribution is
    // MEAN-NEUTRAL — mix(1-anisoK, 1+anisoK, cos^2) averages to 1 over the spectrum's
    // spread — so this re-aims the chop without inflating the field on its own.
    anisoK: 0.45,
    // Amplitude the wind adds ON TOP of the storm swell, at wind 1 in a dead calm. Held
    // low and further halved under a full storm: WAVE's storm amplitudes are already
    // capped because player.js clamps the swim ceiling to y = -1.2 and game.js lifts the
    // camera 2.4 above it — a taller field puts the interface through the eye at the raft.
    ampK: 0.30,
    // Subsurface drift: u/s^2 of wind-aligned push at the surface, at wind 1. Sits well
    // under the storm surge this rides alongside (that term reaches ~4.8) — it is a
    // drift, never a shove, and the swim feel is not up for renegotiation.
    currentK: 1.5,
    // e-folding depth of that push, in world units. Real at -30 (0.61), a whisper at
    // -200 (0.036), arithmetically nothing in the abyss (-600 -> 4e-5).
    decayH: 60
  }
};

// Live sky phase, published by weather.js and read by water.js. Same arrangement as
// SUN: a one-way channel through config.js so the palette needs no game.js wiring.
//   phase01  0 = midnight, 0.5 = noon, wraps at 1
//   ring     position on the night->dawn->noon->dusk ring, 0..4 (2 = noon exactly)
export const SKY = { phase01: 0.5, ring: 2 };
export function setSkyPhase(phase01, ring) { SKY.phase01 = phase01; SKY.ring = ring; }
