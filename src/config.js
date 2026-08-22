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
    },
    // THE BRIGHT STORM. A second authored storm stop, blended against `storm` above by
    // the sun's own height before either touches the ring (see palette()). It exists
    // because a storm stop cannot be one look: `storm` describes a gale at NIGHT, which
    // is this game's dread, and Michael's poseidon reference is a gale at NOON, which is
    // enormous vivid teal water under a black lid and a hazy bright horizon. Keying the
    // difference off DARKNESS rather than off STORM is the whole correction.
    //
    // WHY A SECOND STOP and not more multipliers on the first: zen/hor/desat/tint/surfK
    // are six numbers that have to move together to read as one sky, and three
    // independent `dayK` scalars (which is what this replaced) cannot express "a bright
    // overcast" — they can only fade the slate out. A stop is authored as a LOOK.
    //
    // `storm` is untouched and is still exactly what a night gale gets. Nothing here can
    // reach a calm sky: both stops are only ever consulted through the storm envelope.
    stormDay: {
      // ~2.8x the slate zenith and ~2.1x its horizon. The far sea is mostly REFLECTED
      // SKY (Fresnel goes to 1 with distance), so these two numbers are what decides
      // whether the mid-field reads as pale living water or as the grey sheet it was.
      //
      // `hor` IS THE BLOOM LEVER, and it was authored against a measurement rather than
      // by eye, because it drives three things at once: the horizon band, the sea's
      // reflection of it, and both cloud colours (which are multiples of _pHor). Share of
      // frame over the 0.28 bloom threshold, noon gale, deck view:
      //     hor 0.52/0.60/0.66 -> 66%      (the first pass; visibly hot)
      //     hor 0.46/0.52/0.575 -> 42.9%   <- authored
      //     hor 0.44/0.50/0.55  -> 50%
      //     hor 0.36/0.415/0.46 -> 35%
      //     (a CLEAR noon, for reference    -> 43.4%; the old slate gale -> 26.5%)
      // 0.46/0.52/0.575 is the value where A DAY GALE IS NO MORE BLOOM-PRONE THAN A CLEAR
      // NOON — which is the honest ceiling for a game whose whole tone is "never
      // fireworks". Push this up for more of Michael's bright reference and the frame
      // starts glowing as a whole; the numbers above say exactly what it costs.
      zen: [0.140, 0.190, 0.240], hor: [0.460, 0.520, 0.575],
      // The sun is behind the deck, not gone: enough disc to say there is one up there,
      // and the cloud occlusion in the sky shader still hides it where the lid is thick.
      disc: [0.95, 1.00, 0.92],
      // Barely off neutral. The slate stop pushes off the blue axis so a gale reads as
      // weather rather than dimmed sunshine; a BRIGHT gale does not need that help,
      // because its drama is the lid and the sea, not a colour cast.
      tint: [0.98, 1.02, 0.98],
      surfK: 1.12,
      // 0.15, not 0.55. This is the number Michael's frame is actually about.
      desat: 0.15
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
    // DAY VARIANTS of the two storm-lid numbers, selected by the same solar-height gate
    // that cross-fades the two storm stops. A night gale keeps stormLit 0.30 / baseDark
    // 0.26 exactly. A NOON gale needs its lid to still have a top and a bottom: at 0.30
    // the lit and base ends collapse into one grey ceiling, which is right for dread and
    // wrong for the reference, where the deck is visibly modelled and bright along its
    // upper edges even while it is black underneath. Raising stormLit re-opens that
    // separation; raising baseDark keeps the UNDERSIDE genuinely dark so the lid does not
    // just become a bright fog. The pair is what makes a day gale read as weight
    // overhead rather than as a dimmer switch.
    // HARD BOUND, not taste: baseK is (baseK - baseDark * cloudTex), and a storm drives
    // cloudTex to ~0.99, so any baseDark >= baseK (0.42) drives the cloud UNDERSIDE
    // NEGATIVE. Measured at 0.48: base radiance [-0.020, -0.023, -0.025]. It looks fine
    // on screen because negative clamps to black, but it is not a colour, and anything
    // that blends against it inherits the sign. 0.34 leaves the underside at 0.08 x the
    // horizon — genuinely dark, still light.
    stormLitDay: 0.60,
    baseDarkDay: 0.34,
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
    emberGain: 1.7,
    // THE DOME'S SHARE. Michael's ruling on the painted sky: "just seems like a flat map
    // on the sky". world/clouds.js now draws real instanced puff clusters in the air, so
    // this layer is demoted to the DISTANT BACKDROP they fade into — 0.28 leaves a faint
    // painted haze past the puffs' 540-unit horizon and nothing readable as a clump.
    // It is the A/B for the whole ruling: 1 restores the shipped painted sky exactly,
    // 0 hands the sky entirely to the puffs. The storm envelope drives it back to 1 on
    // its own (see uCloudDome in water.js) — a gale's lid is a lid.
    dome: 0.28
  },

  // ---------------------------------------------------------------------------
  // PUFF-CLUSTER CLOUDS — world/clouds.js. Real 3D sprites in the air above the sea,
  // so parallax and inter-cloud occlusion are geometry rather than a shader's opinion.
  // The photo bar's four properties are bought here by ARRANGEMENT, not by shaping:
  // distinct clumps (each cluster is one object), gathered low near the horizon (an
  // area-uniform deal over a 130..540 annulus puts most clusters far, and perspective
  // compresses them into a low band for free), dark flat bases (per-puff height profile
  // + the same backlit pow the dome uses), milky merge at the waterline (hazeUp/hazeK,
  // shared with the dome so the two dissolve on the same curve).
  puff: {
    nMin: 6, nMax: 16,      // clusters dealt at hand.clouds 0 .. 1 (hard max 16)
    pMin: 16, pMax: 30,     // puffs per cluster (hard max 30) — 480 instances, 1 draw
    rIn: 130, rOut: 540,    // annulus the clusters are dealt into, around the camera
    yLo: 95, yHi: 205,      // cluster altitude band, world units. LOW, deliberately:
                            // altitude/distance IS the elevation angle, so this is what
                            // gathers the band down where the photo puts it (20 deg at
                            // 500 units, 45 deg at 150) instead of hanging it overhead.
    sizeMin: 34, sizeMax: 80,   // cluster half-width
    // Puff radius as a fraction of the cluster half-width. BIG, and paired with a
    // low per-puff alpha: at 0.30/0.52 and alpha 0.92 a cluster rendered as a dozen
    // separate bright discs (measured on screen — Michael's exact old complaint in a
    // new form). Fat overlapping puffs at low alpha ACCUMULATE into a solid body with a
    // soft torn rim, which is the only way a sprite cloud has ever worked.
    puffLo: 0.55, puffHi: 0.95,
    // A puff's own vertical squash, from base (flat, the photo's dark undersides) to
    // crown (round). Storm multiplies the whole cluster down on top of this.
    flatBase: 0.52,
    // DISTANCE. The camera's far plane is 700 and clusters wrap at 560, so the puffs are
    // fully faded before anything can be clipped by it — past `far` the painted dome IS
    // the far field. near/far are the fade band.
    fadeNear: 380, fadeFar: 545, wrapR: 560,
    wind: 5.4,              // world units per second of cluster drift at wind.speed 1
    // FORM. Deliberately the same three knobs the dome's dimension pass uses, and read
    // the same way, because the two have to agree about where the sun is.
    shade: 0.58,            // how far the leeward flank's lighting is pulled down
    base: 0.52,             // how far the bottom of a cluster is pulled down
    crown: 0.26,            // highlight on sunward tops
    litK: 0.94,             // scalar on the dome's lit colour (keeps the puffs a shade
                            // under the painted layer, so nothing new bloom-clips)
    alpha: 0.55,            // peak opacity of a puff's core (see puffLo/puffHi)
    // STORM. Clusters flatten, darken, sink toward a common deck and fade out as the
    // painted lid comes up — the handoff.
    stormFlat: 0.58, stormDark: 0.46, deckY: 108
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
  },

  // --- THE CHOP (surface water bar: Gerstner displacement, Jacobian foam, backlit
  // crests). All of it is pushed into uniforms by updateWater every frame, so every
  // number here is live-pokeable from the console (GLASS.chop.k = 2.2 etc).
  //
  // THE ANCHOR: `k` multiplies max(smoothstep(storm,0,0.9), windSpeed), so at storm 0
  // wind 0 the choppiness is EXACTLY zero — the horizontal displacement vanishes, the
  // Jacobian is the identity, det = 1, and the whole apparatus collapses to the shipped
  // vertical-only field, bit-for-bit, in the shader AND in surfaceHeightAt.
  chop: {
    // Gerstner choppiness. The no-self-intersection bound is sum(k_i * A_i) * chop < 1;
    // at full storm that sum is 0.406, so the loop-free ceiling is ~2.46. 1.55 spends
    // ~63% of it: the fronts steepen hard and the backs stretch, without the field ever
    // folding through itself (a folded Gerstner surface renders as a shattered mirror
    // and breaks the height mirror's fixed point at the same time).
    k: 1.55,
    // FOAM BIRTH. The determinant of (I + dD/dp) is 1 on undisturbed water and falls
    // below 1 exactly where the surface crowds. Foam starts at foamThr and is full
    // foamSoft below it. 0.86/0.34 puts foam on the steep FACE of a front rather than
    // on its top, which is where Michael's poseidon frames put it.
    // Tuned live in a full gale from 20 u up. 0.86 fired over ~90% of the surface (the
    // determinant swings about 1 by ~0.8 at this choppiness, and the three lagged samples
    // are max-combined on top) and the sea rendered as a white sheet; 0.65 puts foam on
    // the folds and leaves the troughs green. Measured sea-band brightness against
    // foam-off: 0.86 = +21.8 code values, 0.70 = +9.1, 0.65 = ~+6, 0.55 = +3.4.
    foamThr: 0.65,
    foamSoft: 0.24,
    foamK: 1.00,          // master foam strength (colour is clamped separately, see below)
    // FOAM PERSISTENCE, in seconds. Foam is a temporal state and this sea has no render
    // target to keep it in — so it is recovered ANALYTICALLY. A Gerstner field is a
    // LAGRANGIAN description: the parameter point p labels a water PARTICLE, and every
    // component's phase at time t-tau is sin(q)cos(w*tau) - cos(q)sin(w*tau) off values
    // the fragment already has. Three lagged evaluations of the compression therefore
    // cost three multiply-adds per component and tell you, exactly, whether THIS PARCEL
    // folded recently. No ping-pong RT, no state, no history texture.
    foamDecay: 2.9,       // e-folding time of the lagged weights; lags are 1.35 s apart
    // How much lingering foam there is against freshly-born foam. 1.0 is "the wake of a
    // fold is as white as the fold"; lower it and foam becomes a flash on the break again.
    foamLagK: 0.85,
    // THE OLD WIND-STREAK BLOCK, kept at its shipped strength (1.0) and given a knob.
    // It paints straight unbroken bands along WAVE[0]'s fixed 20-degree bearing whether
    // or not the water there is folding — which is the same job the Jacobian foam now
    // does properly, and from height in a gale the two together read as corduroy under
    // lace. A MICHAEL DECISION, not the agent's: 0 hands the gale entirely to the
    // fold-born foam. Screenshots of both are on the card.
    streakLegacy: 1.0,
    // FOAM TEXTURE. Value-noise octaves in the existing vn() style, advected downwind and
    // stretched ALONG the wind as it rises, so foam becomes streaks in a gale instead of
    // blobs. texScale is cells per world unit; streakK is the along-wind stretch at wind 1.
    // 0.42/5.0 was authored blind and read as fog patches from height: 2.4 u cells
    // stretched 5.5x are a smear, not foam. 1.2/2.5 gives 0.83 u cells stretched 3.2x at
    // wind 0.9 — fine enough to tear into lace along a crest, long enough to say wind.
    texScale: 1.2,
    streakK: 2.5,
    // BACKLIT CREST SCATTER. Green-teal light transmitted through a thin crest when the
    // sun is low and beyond it. scatterPow is the view/sun lobe tightness.
    // This is the DUSK SPECIALIZATION and stays exactly as it shipped: three hard gates
    // (sun low, view toward it, fragment thin) so it lights rims and nothing else. The
    // broad-body term below is a SEPARATE, wider, day-strong effect and they stack.
    scatterK: 1.00,
    scatterPow: 5.0,

    // --- BROAD-BODY SUBSURFACE SCATTERING ------------------------------------
    // Michael's poseidon reference is one dominant effect: sunlight scattered through
    // the MASS of a swell so its whole upper body glows turquoise from inside. Our dusk
    // rim term answers a different, much narrower question. This one is broad — it wants
    // most of a wave's upper flank at midday, not a wire on its lip.
    //
    // HUE IS DERIVED, NEVER INVENTED. The colour is `fogColor` (the palette's own surface
    // irradiance — THE SILT LINE still governs it) pushed through the water's molecular
    // transmittance exp(-K_EXT * sssTau). K_EXT is [3.50, 1.45, 1.00]: red dies, green and
    // blue survive in near-equal measure, and green-teal irradiance times that spectrum IS
    // turquoise. The reference teal is not a constant, it is what seawater does to this
    // game's own light. Raise sssTau for a deeper/bluer glow, lower it toward the raw
    // surface hue.
    sssK: 1.00,        // master. 0 removes the term exactly.
    sssPow: 1.2,       // bias on the wave's own normalized height h01. 1 = linear over the
                       // whole body; higher concentrates the glow in the upper third.
    sssTau: 0.55,      // optical thickness of the notional path through the wave body
    sssGain: 4.0,      // multiplier on fogColor after the transmittance
    // Ceiling on the emitted colour, applied as a SCALAR RESCALE of the whole vector so
    // the derived hue survives it (a per-channel min() turns turquoise into white the
    // moment two channels saturate — that was the first build, and it whited out the
    // entire gale). This is the hue guard; the BLOOM guard is separate and absolute: the
    // shader only ever spends the headroom a fragment still has under BloomEffect's 0.28,
    // so no poke of these knobs can add a blooming pixel to this sea.
    sssCap: 0.24,
    // The term is weighted by sqrt(1 - F): light arrives where the surface TRANSMITS, but
    // light leaving at a grazing angle also travelled further through the lit body, and
    // the two partly cancel. The literal (1 - F) measured almost nothing across the open
    // sea, where the view is grazing and F runs 0.8-1.0. sqrt still reads exactly 0 at
    // F = 1, which is the property the horizon needs.
    //
    // CALM ANCHOR. Scales with sea state, floored at sssCalm so a dead-flat noon gets a
    // faint lift on swell tops and nothing more. Measured calm delta is on the card; this
    // is the dial if Michael wants calm untouched (set 0) or more of it.
    sssCalm: 0.10,
    // Solar-elevation gate, on sin(elevation). 0.20 = 11.5 deg, 0.55 = 33.4 deg. Under
    // the low end this is dead and the dusk rim term owns the frame; over the high end it
    // is full. This gate is ALSO what excludes the moon, and it has to be: the rim term's
    // disc-luminance gate cannot be reused here, because the storm blend collapses the
    // disc stop to near-moonlight and that gate then shuts the term off in exactly the
    // gale it exists for (measured — see the shader). The elevNight floor is 8 deg
    // (sin 0.139), so a night gale reads exactly zero from this line alone.
    // This pair ALSO drives the sunlit-storm gate in palette() — the desaturation lifts
    // and the body glow arrives on the same curve, which is the point.
    sssDayLo: 0.20,
    sssDayHi: 0.55,

    // --- SUNLIT STORMS -------------------------------------------------------
    // The storm look is now TWO authored stops — GLASS.stops.storm (night slate) and
    // GLASS.stops.stormDay (the bright reference gale) — cross-faded by the sun's own
    // height BEFORE either is blended onto the ring. See palette().
    //
    // This replaced three independent day-scaled multipliers on the single slate stop
    // (stormDesatDayK / stormTintDayK / stormSurfDayK). They could fade the slate out but
    // could not author a bright overcast, because zen and hor were still pinned to the
    // dark stop and the far sea is mostly reflected sky. Two stops, one gate, six numbers
    // that move together.
    //
    // The gate is sssDayLo..sssDayHi below — the SAME window the body glow uses, so the
    // sky brightens, the desaturation lifts and the water starts to glow on one curve.

    // --- STORM SWELL SCALE ---------------------------------------------------
    // Multiplier on the STORM-scaled amplitude of the two LONGEST wave components (the
    // 62 u and 41 u swells). Applied to the HEIGHT and its gradient only — the Gerstner
    // horizontal displacement and the Jacobian keep the shipped amplitude, so sum(k*A)*chop
    // is bit-identical, the no-fold bound is untouched, the CPU height mirror's fixed point
    // contracts at exactly the rate it did, and the foam still fires where it always did.
    // Physically this is the right split: a bigger swell is longer and taller, not steeper.
    // Faded in by the same smoothstep(storm, 0, 0.9) as the storm amplitudes, so calm is
    // exactly 1.0 and the calm anchor is structural, not tuned.
    // 1.80 = 6.59 u peak-to-peak at full gale against the shipped 4.23 (1.56x).
    galeAmp: 1.80
  },

  // --- RAIN. Two systems, one entry.
  //
  // SPLASH (water.js, air side only): the sea's own drop-strike field. The shipped
  // version put one expanding ring at the CENTRE of every cell of a regular lattice,
  // which from the deck read as a marching grid of stamped o's. The replacement keeps
  // the technique (a ring in the surface normal) and breaks the lattice three ways at
  // once — per-cell centre jitter, per-cell beat rate, and dead cells. See splash() in
  // water.js. NOT LIVE-POKEABLE: these are baked into the shader as literals (they are
  // curve shape, and the sea shader is the most expensive in the game — they would cost
  // uniforms for nothing). Changing them needs a reload.
  //   splashScales  the two cell frequencies, 1/units. 2.6 -> 0.38 u (1.2 m) cells,
  //                 5.3 -> 0.19 u. The second lattice is ROTATED (see splashRot) so the
  //                 two grids share no axis.
  //   splashRot     rotation of the fine lattice, radians. 0.61 rad is deliberately not
  //                 a fraction of pi/2.
  //   splashDead    fraction of cells that never fire. Irregular spacing beats regular
  //                 spacing with jitter — a gap is what stops the eye finding a period.
  //   splashK       brightness of the splash fleck on the air side (foam colour x this).
  //                 Held far under BloomEffect's 0.28 so rain never glows.
  //
  // FALLING STREAKS (world/rain.js): ONE instanced draw call of wind-slanted streaks in
  // a cylinder around the camera. Those ARE live — rain.js reads them per frame.
  rain: {
    splashScales: [2.6, 5.3],
    splashRot: 0.61,
    splashDead: 0.34,
    splashK: 0.20,

    streaks: 420,       // instance count ceiling; buffers are sized for this once
    radius: 26,         // cylinder radius around the camera, world units
    top: 22,            // spawn height above the camera, recycled from the top
    len: 1.35,          // streak length in units at env.sky 1 (scaled down in a shower)
    wide: 0.020,        // streak half-width
    slantK: 0.62,       // horizontal drift per unit of fall at wind 1 (the slant)
    fall: 26,           // fall speed, u/s
    alpha: 0.16,        // peak per-streak alpha. Grey-silver, thin; never white noise.
    col: [0.74, 0.78, 0.82],   // brass-age grey-silver, faintly cool
    gustK: 0.55,        // how much the wind's gust term modulates density/slant
    skyOn: 0.10         // env.sky below this = no rain at all, one compare per frame
  }
};

// Live sky phase, published by weather.js and read by water.js. Same arrangement as
// SUN: a one-way channel through config.js so the palette needs no game.js wiring.
//   phase01  0 = midnight, 0.5 = noon, wraps at 1
//   ring     position on the night->dawn->noon->dusk ring, 0..4 (2 = noon exactly)
export const SKY = { phase01: 0.5, ring: 2 };
export function setSkyPhase(phase01, ring) { SKY.phase01 = phase01; SKY.ring = ring; }
