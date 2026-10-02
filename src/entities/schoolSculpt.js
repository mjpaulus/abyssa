// THE SCHOOLS — every schooling fish in the sea, sculpted (fauna2). Pure data builders over
// fishKit.js; `node tools/blender/build.mjs school` bakes them high-to-low into
// assets/fauna/school/ (one atlas for the lot, so a school is still one draw).
//
// Each species is a real animal, built from its reference anatomy (proportions are measured
// fractions of standard length): the reef's herring, snapper, butterflyfish and needlefish;
// the boiler room's bigeye scad and pomfret and its blind eelpout; the abyss's bristlemouth,
// hatchetfish and lanternfish. Schools (creatures.js) use the canonical frame: head at
// z = +0.5, length 1. The eelpout and the lanternfish are fauna.js animals and are sculpted
// in ITS frame (head +X, 2 long, scaled by fauna's merge scale at runtime).
//
// SPECIES order matches creatures.js SPECIES (index = school species), then fauna's two.
import { makeFish, fishSpec, toCanon, FM, _internal } from './fishKit.js';

const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------
// the animals
// ---------------------------------------------------------------------------------------
export const FISH = {
  // ATLANTIC HERRING (Clupea harengus): fusiform, compressed, depth ~21% SL; one mid dorsal
  // over the pelvics; deeply forked caudal; a keel of ventral scutes; large deciduous
  // cycloid scales; no visible lateral line; the lower jaw just proud of the upper.
  herring: {
    prof: [[0, 0.006, 0.006, 0.004], [0.03, 0.034, 0.03, 0.022], [0.1, 0.068, 0.064, 0.04], [0.22, 0.094, 0.096, 0.053],
      [0.38, 0.104, 0.112, 0.056], [0.55, 0.094, 0.1, 0.05], [0.72, 0.068, 0.064, 0.036], [0.88, 0.038, 0.034, 0.02], [0.97, 0.029, 0.025, 0.013], [1.0, 0.028, 0.024, 0.012]],
    fins: [
      { name: 'dorsal', med: true, pts: [[0.085, 0.39], [0.19, 0.43], [0.15, 0.5], [0.09, 0.565]], root: [3, 0], th: 0.0035, rays: 17 },
      { name: 'caudal', med: true, pts: [[0.024, 0.955], [0.075, 1.04], [0.175, 1.245], [0.11, 1.215], [0.0, 1.1], [-0.11, 1.215], [-0.175, 1.245], [-0.075, 1.04], [-0.024, 0.955]], root: [8, 0], th: 0.004, rays: 19, scal: 0.1, per: 6 },
      { name: 'anal', med: true, pts: [[-0.08, 0.66], [-0.125, 0.69], [-0.1, 0.8], [-0.04, 0.83]], root: [3, 0], th: 0.003, rays: 16 },
      { name: 'pelvic', pair: true, O: [0.02, -0.098, 0.0], A: [0.35, -0.55, -0.75], B: [0, 0, -1], pts: [[0, 0], [0.065, 0.005], [0.07, 0.032], [0.0, 0.04]], root: [3, 0], th: 0.0028, rays: 9 },
      { name: 'pectoral', pair: true, O: [0.042, -0.06, 0.5 - 0.27], A: [0.4, -0.35, -0.85], B: [0, 0.35, -0.25], pts: [[0, 0], [0.1, -0.004], [0.115, 0.022], [0.0, 0.036]], root: [3, 0], th: 0.003, rays: 15 }
    ],
    eye: { t: 0.105, y: 0.026, r: 0.027 },
    mouth: { t: 0.07, y: -0.008, w: 0.004, halfW: 0.05, tilt: -0.35 },
    op: { t: 0.205, k: 0.035 },
    scales: { n: 44, amp: 0.0016, ar: 1.0 },
    scutes: { t0: 0.28, t1: 0.66, yn: -1.0, w: 0.01, h: 0.0028, n: 30 }
  }
};
// the pelvic origin sits under the dorsal (t 0.47)
FISH.herring.fins[3].O[2] = 0.5 - 0.47;

// ---------------------------------------------------------------------------------------
// paint
// ---------------------------------------------------------------------------------------
// helpers: canonical body coordinates of a paint sample
function bc(fish) {
  const o = {};
  return S => { const c = toCanon(fish.S, S.x, S.y, S.z); return _internal.bodyCoord(fish, c[0], c[1], c[2], o); };
}
function eyeMask(fish, lo, hi) {
  return S => {
    if (!fish.eye) return 0;
    const c = toCanon(fish.S, S.x, S.y, S.z), e = fish.eye.c, n = fish.eye.n;
    const dx = Math.abs(c[0]) - e[0], dy = c[1] - e[1], dz = c[2] - e[2], l = Math.hypot(dx, dy, dz) || 1;
    return sst(lo, hi, (dx * n[0] + dy * n[1] + dz * n[2]) / l);
  };
}
const mat = id => ['mat', id];

function herringPaint(fish) {
  const B = bc(fish);
  const back = S => { const o = B(S); return sst(0.15, 0.55, o.yn + 0.05 * Math.sin(o.t * 40)); };
  const brass = S => { const o = B(S); return Math.exp(-(((o.yn - 0.24) / 0.05) ** 2)) * sst(0.2, 0.3, o.t) * (1 - sst(0.85, 0.95, o.t)); };
  const belly = S => { const o = B(S); return 1 - sst(-0.75, -0.35, o.yn); };
  const finEdge = S => { const c = toCanon(fish.S, S.x, S.y, S.z); return sst(1.12, 1.24, 0.5 - c[2]) + sst(0.14, 0.19, c[1]); };
  return {
    kScale: 0.0025, aoAlb: 0.55,
    mats: {
      [FM.BODY]: { c: [0.66, 0.70, 0.72], ro: 0.28 },
      [FM.FIN]: { c: [0.50, 0.55, 0.56], ro: 0.45 },
      [FM.EYE]: { c: [0.70, 0.72, 0.70], ro: 0.05 },
      [FM.MOUTH]: { c: [0.30, 0.26, 0.26], ro: 0.4 }
    },
    layers: [
      { c: [0.07, 0.15, 0.19], a: 1, ro: 0.35, m: [mat(FM.BODY), ['fn', back]] },
      { c: [0.62, 0.58, 0.40], a: 0.35, m: [mat(FM.BODY), ['fn', brass]] },
      { c: [0.86, 0.88, 0.86], a: 0.8, m: [mat(FM.BODY), ['fn', belly]] },
      // scale pockets catch dark, the free edges catch light
      { c: [0.10, 0.14, 0.16], a: 0.45, m: [mat(FM.BODY), ['cav', 0.15, 0.6]] },
      { c: [0.9, 0.92, 0.9], a: 0.25, m: [mat(FM.BODY), ['cvx', 0.2, 0.7]] },
      { c: [0.18, 0.24, 0.27], a: 0.7, m: [mat(FM.FIN), ['fn', finEdge]] },
      { c: [0.20, 0.22, 0.22], a: 0.5, m: [mat(FM.FIN), ['nd', [0, 1, 0], 0.2, 0.9]] },
      // the eye: silver iris, black pupil, a dark orbit
      { c: [0.02, 0.02, 0.025], a: 1, ro: 0.04, m: [mat(FM.EYE), ['fn', eyeMask(fish, 0.72, 0.78)]] },
      { c: [0.24, 0.23, 0.19], a: 0.75, m: [mat(FM.EYE), ['fn', S => 1 - eyeMask(fish, 0.35, 0.6)(S)]] },
      { c: [0.04, 0.05, 0.06], a: 0.85, m: [['ao', 0.35, 0.9]] }
    ]
  };
}

// ---------------------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------------------
const BUILD = {
  herring: { paint: herringPaint, tris: 1100 }
};
export function fishes() { const o = {}; for (const k in FISH) o[k] = makeFish(FISH[k]); return o; }

export function pipeline() {
  const F = fishes(), pieces = [];
  for (const k of Object.keys(BUILD)) {
    const fish = F[k], B = BUILD[k];
    pieces.push({
      name: k, set: 'school', sdf: fishSpec(fish), paint: B.paint(fish),
      hi: { h: 0.0026 }, lo: { h: 0.0042, tris: B.tris, err: 0.004 },
      kEps: 0.004, ao: { r: 0.03, n: 4 }, cage: 0.006, ray: 0.02,
      emit: B.emit ? B.emit(fish) : undefined
    });
  }
  return {
    name: 'school', out: 'assets/fauna/school',
    sets: { school: { size: 2048, gutter: 6, aoDist: 0.05, aoSamples: 48, fill: true } },
    pieces,
    compress: { mesh: 'draco' },
    meta: { species: Object.keys(BUILD) }
  };
}

export function preview() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const want = (q.get('p') || 'herring').split(','), k = +(q.get('k') || 2);
  const P = pipeline(), parts = P.pieces.filter(p => want.includes(p.name));
  return {
    key: 'preview-' + want.join('-') + '-' + k + '-' + Math.random(),
    parts: parts.map(p => ({ name: p.name, sdf: p.sdf, h: p.hi.h * k, tris: p.lo.tris * 4, err: p.lo.h })),
    atlas: { size: +(q.get('s') || 1024), paint: parts[0].paint, kEps: parts[0].kEps, ao: parts[0].ao }
  };
}
