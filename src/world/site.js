// THE CHART's registry: what a dive site IS. OWNED BY: orchestrator.
//
// A site is the same basin with a different sea floor. Nothing here may move the raft,
// the rifts, the zone layout or the hose economy — those are the game's frozen frame
// (see CLAUDE.md invariants). A site is: a name in the previous chart-owner's hand,
// per-zone DOMAIN OFFSETS into terrain's infinite noise field, fresh rim-warp harmonic
// rows, seed streams for every scatter system, a scarcity dial, a hand-authored sleeper
// overlay, and — since Michael's ruling "Give each its own water" (2026-10-04,
// roadmap/fly-remote-sites.md) — its OWN WATER and GROUND:
//   water   colour/clarity/silt/absorption/veil -> water.js setSiteWater (uniforms + CPU)
//   light   underwater ambient/hemi/key tints   -> lighting.js setSiteLight
//   grade   per-zone look overrides             -> postfx.js setSiteGrade
//   floor   silt/gravel/rock albedo multipliers -> terrain.js uSite* uniforms
//   shape   per-zone landform overrides + rim   -> terrain.js syncSite (not RAM_H)
//   vents   field size/density/heat             -> vents.js ventKnobs
//   wrecks  search ring about each rift         -> wrecks.js wreckSites
//   sleepers[i].idle / lair / hard              -> the kinds (brooder/hoarder/hunter)
// Every one is null at home and every consumer treats null as the shipped constant.
// All authored, never generated: the register is the product.
//
// SITE 0 IS THE SHIPPED WORLD, BIT-IDENTICAL. Its rows below are copied verbatim from
// terrain.js's ZP/RIM tables and every stream seed matches the constant the module it
// feeds used before this file existed (flora's placement was raw Math.random() — that
// latent nondeterminism dies here; vents shipped on 0xB01Ec0DE). That identity is the
// whole regression story: every reseed path can be verified by hashing site 0 against
// the world as it ships today.

// Deterministic stream factory — mulberry32, the same generator weather.js trusts.
export function stream(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rim harmonic rows for the two remote sites: same order of magnitude as the shipped
// rows (|k| 0.12..0.62 — the documented amplitude envelope), re-rolled by hand and
// kept, not generated at runtime.
const SITES = [
  {
    key: 'home',
    name: 'THE HOME MOORING',
    epithet: null,                       // the shipped three keep their shipped names
    conditions: 'KNOWN WATER. THE FIRST INK IS YOURS.',
    // Verbatim shipped values — bit-identity is this row's contract.
    terra: {
      off: [[0, 0], [910, -430], [-1740, 1220]],
      rimKR: [
        [0.62, -0.31, 0.44, 0.26, -0.22, 0.30],
        [-0.38, 0.55, 0.20, -0.48, 0.28, 0.17],
        [0.29, 0.47, -0.52, 0.14, 0.19, -0.33]
      ],
      rimKH: [
        [0.41, 0.52, -0.36, 0.30, 0.24, -0.18],
        [0.57, -0.22, 0.33, 0.41, -0.15, 0.26],
        [-0.48, 0.34, 0.45, -0.20, 0.31, 0.12]
      ]
    },
    seeds: { flora: 0x5EAF00D1, wrecks: 0x57EE1B0A, vents: 0xB01Ec0DE, resources: 0xC0FFEE01, props: 0x9A11A5E1, creatures: 0xF15C0011, fauna: 0xFA0BA001 },
    scarcity: { polymer: 1, bitumen: 1 },
    sleepers: null,                      // no overlay: LEVIATHAN_CFG untouched
    // OWN WATER (Michael 2026-10-04, "Give each its own water"). Home carries none of it:
    // every consumer reads null as "the shipped constant", so site 0 stays bit-identical.
    water: null, light: null, floor: null, shape: null, vents: null, wrecks: null, grade: null
  },
  {
    key: 'pallid',
    name: 'PALLID BANK',
    epithet: ['VELKATH KEEPS NO DEPTH HERE', 'ORUNE CIRCLES THE BANK', 'MHOR IS PATIENT UNDER PALE GROUND'],
    conditions: 'POLYMER RICH. BITUMEN SCARCE. THE SLEEPERS SIT SHALLOW.',
    terra: {
      off: [[3120, 1480], [-2260, -3510], [4030, -1870]],
      rimKR: [
        [-0.44, 0.28, 0.51, -0.19, 0.33, -0.24],
        [0.36, -0.57, 0.22, 0.41, -0.16, 0.29],
        [-0.27, 0.49, 0.31, -0.45, 0.20, 0.15]
      ],
      rimKH: [
        [0.53, -0.30, 0.26, 0.44, -0.21, 0.17],
        [-0.39, 0.48, -0.25, 0.32, 0.19, -0.28],
        [0.45, 0.23, -0.50, 0.16, 0.35, 0.13]
      ]
    },
    seeds: { flora: 0x1A7EBA1C, wrecks: 0x2B00B51E, vents: 0x3C07A177, resources: 0x4D1FF5EA, props: 0x5E77A007, creatures: 0xF15C0012, fauna: 0xFA0BA002 },
    scarcity: { polymer: 1.5, bitumen: 0.55 },
    // THE SLEEPERS SIT SHALLOW. Velkath's idle [62, 38] is the serpent-era split toward the
    // TOP of her band: on the ground it picks the HIGH lip of her rift (sleeper/brooder.js
    // lairOf). Harder = behaviour, never more lights (the ward pool is 5): a quicker hammer
    // and a longer reach; Orune holds longer and pulls harder; Mhor circles less, strikes
    // wider and shakes the fire off sooner. Every tell (wind-up, cock, freeze) is untouched.
    sleepers: [
      { sigils: 4, hueShift: 0.03, idle: [62, 38], lair: { arc: [-80, 80] },
        hard: { hammerT: 2.25, threatR: 2.6 } },
      { sigils: 5, hueShift: -0.02, idle: null, lair: { bear: -55 },
        hard: { pull: 16.5, hold: 6.0, lashCd: [2.6, 2.2], grabR: 3.6 } },
      { sigils: 5, hueShift: 0.02, idle: null, lair: { bear: 70, r: 0.36 },
        hard: { circleT: 6.0, stunT: 8.5, hitR: 8.0, speed: 16.5 } }
    ],
    // PALE WATER: a chalk bank. Milky, high-scatter: the column is thicker (clear x1.4,
    // silt x1.65) but what it scatters back is pale grey-green and brighter, so the far
    // field is a bright veil instead of a dark wall. Surface light colder and paler.
    water: { surf: [1.55, 1.22, 1.18], clear: 1.40, silt: 1.65, siltMix: 0.86, siltGain: 1.40,
      siltTint: [0.96, 1.14, 1.04], absorb: [0.80, 1.00, 1.12], glow: 1.30, veil: 0.80 },
    // the zone looks (postfx.js ZONE_LOOKS overrides): chalk -- lifted milky blacks, the
    // colour held down, a pale grey-green mood; the boiler a paler sulphur; the abyss slate
    grade: [
      { slope: [0.98, 1.00, 0.99], offset: [0.010, 0.012, 0.012], power: [1.02, 1.00, 1.01], mood: [0.62, 0.80, 0.66], satUp: 0.04, satDn: -0.30, wash: 0.20, cool: [0.30, 0.38, 0.42], toe: [0.30, 0.34, 0.33] },
      { slope: [1.04, 1.00, 0.90], offset: [0.012, 0.010, 0.006], mood: [0.95, 0.82, 0.50], satUp: 0.14, satDn: -0.32, wash: 0.32, cool: [0.26, 0.30, 0.40] },
      { offset: [0.006, 0.006, 0.008], mood: [0.50, 0.50, 0.70], satUp: 0.04, satDn: -0.40, wash: 0.16, cool: [0.22, 0.24, 0.36], toe: [0.22, 0.22, 0.30] }
    ],
    light: { amb: [1.22, 1.18, 1.12], sky: [1.18, 1.14, 1.06], gnd: [1.85, 1.85, 1.70], sun: [1.06, 1.05, 1.00] },
    // bleached limestone, chalk silt, pale gravel
    floor: { silt: [1.62, 1.60, 1.48], grav: [1.50, 1.48, 1.40], rock: [1.85, 1.80, 1.70] },
    // broad terraced banks: lower massifs, strata stepped across the open ground too
    // (tflat), fewer canyons, a lower and gentler rim
    shape: {
      zp: [
        { ramp: 19, s2amp: 2.4, warp: 62, rbias: -0.42, cnamp: 5.5, tq: 5.0, tamt: 0.60, tflat: 0.70 },
        { ramp: 30, s2amp: 7.5, warp: 96, cnamp: 13, tq: 7.5, tamt: 0.78, tflat: 0.60 },
        { ramp: 36, s2amp: 9.5, warp: 74, cnamp: 13, tq: 6.5, tamt: 0.70, tflat: 0.55 }
      ],
      rim: { h: 0.80, span: 1.22, jag: 0.55 }
    },
    // sparse, cold: three small fields, many chimneys long dead
    vents: { clusters: 3, per: [3, 4, 3], deadP: 0.42, hot: 2, h: [3.5, 11] },
    // the wrecks lie out on the bank, far from the rifts
    wrecks: { band: [[96, 150], [92, 150], [88, 142]] }
  },
  {
    key: 'burned',
    name: 'THE BURNED GROUND',
    epithet: ['VELKATH SWIMS ASH HERE', 'ORUNE WEARS A DARKER CROWN', 'MHOR CAME HOME'],
    conditions: 'BITUMEN RICH. POLYMER SCARCE. THE FLOOR REMEMBERS FIRE.',
    terra: {
      off: [[-4480, 2650], [1830, 4210], [-3390, -2940]],
      rimKR: [
        [0.58, 0.21, -0.47, 0.30, -0.18, 0.26],
        [-0.33, 0.44, 0.28, -0.52, 0.24, -0.14],
        [0.41, -0.29, 0.36, 0.18, -0.43, 0.22]
      ],
      rimKH: [
        [-0.46, 0.35, 0.29, -0.24, 0.40, -0.15],
        [0.51, 0.19, -0.38, 0.27, -0.22, 0.31],
        [0.30, -0.42, 0.24, 0.46, 0.14, -0.26]
      ]
    },
    seeds: { flora: 0x6F1A6E11, wrecks: 0x7A5AE5B2, vents: 0x8B14C4F1, resources: 0x9CADB0B3, props: 0xAD1E5E14, creatures: 0xF15C0013, fauna: 0xFA0BA003 },
    scarcity: { polymer: 0.55, bitumen: 1.5 },
    // MHOR CAME HOME: his furnace stands in its own field. ORUNE WEARS A DARKER CROWN
    // (idle [70, 44]: she lies on the HIGH side of her trawler). The hardest water.
    sleepers: [
      { sigils: 4, hueShift: -0.03, idle: null, lair: { bear: -60 },
        hard: { hammerT: 2.05, threatR: 2.8 } },
      { sigils: 5, hueShift: 0.03, idle: [70, 44], lair: null,
        hard: { pull: 19, hold: 7.0, lashCd: [2.2, 2.0], grabR: 4.0 } },
      { sigils: 5, hueShift: -0.02, idle: null, lair: { bear: -45, r: 0.40 },
        hard: { circleT: 5.0, stunT: 7.0, hitR: 9.0, speed: 18 } }
    ],
    // ASH WATER: warm and dark. The column carries suspended ash (silt x1.5) that scatters
    // umber, blue is eaten first (humic/ash absorption), so depth goes olive-brown instead
    // of blue, and the surface light arrives already warm and dimmer.
    water: { surf: [0.92, 0.70, 0.52], clear: 1.15, silt: 1.50, siltMix: 0.84, siltGain: 0.86,
      siltTint: [1.74, 1.08, 0.56], absorb: [0.78, 1.10, 1.55], glow: 0.85, veil: 0.72 },
    // the zone looks: umber ash with warm-neutral shadows (no teal wash), a red-amber
    // boiler, an ember-black abyss -- the darker crown
    grade: [
      { slope: [1.06, 0.98, 0.86], offset: [0.008, 0.004, -0.002], power: [0.97, 1.00, 1.08], mood: [1.00, 0.66, 0.40], satUp: 0.06, satDn: -0.34, wash: 0.24, cool: [0.24, 0.22, 0.22], toe: [0.30, 0.22, 0.14] },
      { slope: [1.10, 0.96, 0.80], offset: [0.014, 0.004, -0.006], mood: [1.00, 0.52, 0.18], satUp: 0.26, satDn: -0.30, wash: 0.44, cool: [0.22, 0.20, 0.24], toe: [0.44, 0.22, 0.10] },
      { slope: [1.02, 0.92, 0.92], offset: [0.004, 0.000, 0.000], mood: [0.80, 0.36, 0.30], satUp: 0.06, satDn: -0.40, wash: 0.20, cool: [0.20, 0.14, 0.16], toe: [0.30, 0.14, 0.12] }
    ],
    light: { amb: [1.16, 0.86, 0.66], sky: [1.10, 0.86, 0.62], gnd: [0.90, 0.62, 0.46], sun: [1.00, 0.86, 0.70] },
    // basalt and ash: dark, a little warm in the gravel
    floor: { silt: [0.60, 0.54, 0.50], grav: [0.62, 0.54, 0.48], rock: [0.48, 0.44, 0.44] },
    // jagged: taller sharper massifs (an extra ridged octave), lava-step ledges, a steep
    // close rim with a broken crest
    shape: {
      zp: [
        { ramp: 38, roc: 4, rbias: -0.16, s2amp: 5.0, r3amp: 2.2, damp: 2.0, tq: 3.6, tamt: 0.50, tflat: 0.25 },
        { ramp: 54, roc: 5, rbias: 0.02, s2amp: 14, r3amp: 4.6, tq: 4.5, tamt: 0.80 },
        { ramp: 60, roc: 5, s2amp: 16, r3amp: 5.2, tq: 4.0, tamt: 0.72 }
      ],
      rim: { h: 1.15, span: 0.82, jag: 1.6 }
    },
    // more and hotter: five dense fields, taller living chimneys, four burning throats
    vents: { clusters: 5, per: [5, 5, 4, 5, 4], deadP: 0.16, hot: 4, h: [5, 16], clusterR: 18, sep: 48 },
    // the wrecks went down close to the rifts, in the ash
    wrecks: { band: [[60, 100], [62, 104], [60, 98]] }
  },
  {
    key: 'shelf',
    name: 'THE UNSOUNDED SHELF',
    hidden: true,                        // not on the paper until the deep sound channel gives it up
    epithet: ['VELKATH HAS NEVER BEEN COUNTED HERE', 'ORUNE LISTENS BACK', 'MHOR WAS HERE BEFORE THE CHART'],
    conditions: 'NO SOUNDINGS. THE OWNER NEVER CAME.',
    terra: {
      off: [[5240, -3160], [-4870, 1520], [2410, 5090]],
      rimKR: [
        [0.34, -0.51, 0.27, 0.43, -0.20, 0.16],
        [-0.49, 0.31, 0.45, -0.23, 0.37, -0.13],
        [0.26, 0.53, -0.35, 0.21, -0.44, 0.29]
      ],
      rimKH: [
        [-0.37, 0.50, -0.22, 0.33, 0.18, -0.27],
        [0.42, -0.26, 0.39, -0.17, 0.48, 0.14],
        [-0.31, 0.24, 0.55, -0.40, 0.19, 0.23]
      ]
    },
    seeds: { flora: 0xBE0F5E15, wrecks: 0xCF10D2A6, vents: 0xD0217EB7, resources: 0xE1329AC8, props: 0xF243B6D9, creatures: 0xF15C0014, fauna: 0xFA0BA004 },
    scarcity: { polymer: 1.25, bitumen: 1.25 },
    sleepers: [
      { sigils: 5, hueShift: 0.04, idle: null },
      { sigils: 5, hueShift: -0.04, idle: null },
      { sigils: 5, hueShift: 0.03, idle: [58, 34] }
    ]
  }
];

let current = 0;

export function siteCount() { return SITES.length; }
export function currentSite() { return SITES[current]; }
export function currentSiteIndex() { return current; }
export function setSite(i) { current = Math.max(0, Math.min(SITES.length - 1, i | 0)); return SITES[current]; }
export function siteAt(i) { return SITES[i] || null; }

// The per-module entry point: siteParams('flora') hands a module its own fresh
// deterministic stream plus the shared authored rows. A module must take a NEW stream
// on every rebuild — reusing one across reseeds would make layout depend on rebuild
// COUNT, which is exactly the nondeterminism this file exists to kill.
export function siteParams(key) {
  const s = SITES[current];
  return {
    index: current,
    key: s.key,
    terra: s.terra,
    scarcity: s.scarcity,
    sleepers: s.sleepers,
    water: s.water || null, light: s.light || null, floor: s.floor || null,
    shape: s.shape || null, vents: s.vents || null, wrecks: s.wrecks || null, grade: s.grade || null,
    rng: key && s.seeds[key] !== undefined ? stream(s.seeds[key]) : stream(0xD1CE0000 + current)
  };
}
