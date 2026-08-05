// THE CHART's registry: what a dive site IS. OWNED BY: orchestrator.
//
// A site is the same basin with a different sea floor. Nothing here may move the raft,
// the rifts, the zone layout or the hose economy — those are the game's frozen frame
// (see CLAUDE.md invariants). A site is exactly: a name in the previous chart-owner's
// hand, per-zone DOMAIN OFFSETS into terrain's infinite noise field (new skylines, no
// amplitude touched), fresh rim-warp harmonic rows inside the shipped amplitude
// envelope, seed streams for every scatter system, a scarcity dial, and a hand-authored
// sleeper overlay. All authored, never generated: the register is the product.
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
    seeds: { flora: 0x5EAF00D1, wrecks: 0x57EE1B0A, vents: 0xB01Ec0DE, resources: 0xC0FFEE01, props: 0x9A11A5E1 },
    scarcity: { polymer: 1, bitumen: 1 },
    sleepers: null                       // no overlay: LEVIATHAN_CFG untouched
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
    seeds: { flora: 0x1A7EBA1C, wrecks: 0x2B00B51E, vents: 0x3C07A177, resources: 0x4D1FF5EA, props: 0x5E77A007 },
    scarcity: { polymer: 1.5, bitumen: 0.55 },
    sleepers: [
      { sigils: 4, hueShift: 0.03, idle: [62, 38] },
      { sigils: 5, hueShift: -0.02, idle: null },
      { sigils: 6, hueShift: 0.02, idle: null }
    ]
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
    seeds: { flora: 0x6F1A6E11, wrecks: 0x7A5AE5B2, vents: 0x8B14C4F1, resources: 0x9CADB0B3, props: 0xAD1E5E14 },
    scarcity: { polymer: 0.55, bitumen: 1.5 },
    sleepers: [
      { sigils: 4, hueShift: -0.03, idle: null },
      { sigils: 5, hueShift: 0.03, idle: [70, 44] },
      { sigils: 6, hueShift: -0.02, idle: null }
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
    rng: key && s.seeds[key] !== undefined ? stream(s.seeds[key]) : stream(0xD1CE0000 + current)
  };
}
