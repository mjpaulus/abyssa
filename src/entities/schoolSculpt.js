// THE SCHOOLS — every schooling fish in the sea, sculpted (fauna2). Pure data builders over
// fishKit.js; `node tools/blender/build.mjs school` bakes them high-to-low into
// assets/fauna/school/ (one atlas for the lot, so a school is still one draw).
//
// Each species is a real animal, built from its reference anatomy (proportions are
// fractions of standard length, read off the usual field-guide profiles): the reef's
// herring, red snapper, butterflyfish and needlefish; the boiler room's bigeye scad,
// pomfret and its blind vent eelpout; the abyss's bristlemouth, hatchetfish and lanternfish.
// Schools (creatures.js) use the canonical frame: head at z = +0.5, length 1. The eelpout
// and the lanternfish are fauna.js animals and are sculpted in ITS frame (head +X, 2 long);
// fauna.js scales them by its own merge scale at install.
import { makeFish, fishSpec, toCanon, photoD, FM, _internal } from './fishKit.js';

const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

// a row of photophores: n stations from t0 to t1 at height yn (radius r)
const row = (n, t0, t1, yn, r, dy = 0) => Array.from({ length: n }, (_, i) => ({ t: t0 + (t1 - t0) * (n > 1 ? i / (n - 1) : 0.5), yn: yn + dy * (n > 1 ? i / (n - 1) : 0), r }));
const PEC = (O, pts, o = {}) => Object.assign({ name: 'pectoral', pair: true, O, A: [0.4, -0.3, -0.88], B: [0, 0.4, -0.2], pts, root: [pts.length - 1, 0], th: 0.003, rays: 14 }, o);
const PEL = (O, pts, o = {}) => Object.assign({ name: 'pelvic', pair: true, O, A: [0.3, -0.6, -0.75], B: [0, 0, -1], pts, root: [pts.length - 1, 0], th: 0.0028, rays: 7 }, o);
const MED = (name, pts, o = {}) => Object.assign({ name, med: true, pts, root: [pts.length - 1, 0], th: 0.0034, rays: 14 }, o);
const CAUD = (pts, o = {}) => Object.assign({ name: 'caudal', med: true, pts, root: [pts.length - 1, 0], th: 0.004, rays: 17, scal: 0.1, per: 6, focus: [0, 0.9] }, o);
const fork = (r, h, len, notch, o = {}) => CAUD([[r, 0.955], [r * 2.6, 1.03], [h, 1 + len], [h * 0.62, 1 + len * 0.86], [0, notch], [-h * 0.62, 1 + len * 0.86], [-h, 1 + len], [-r * 2.6, 1.03], [-r, 0.955]], o);

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
      MED('dorsal', [[0.085, 0.39], [0.19, 0.43], [0.15, 0.5], [0.09, 0.565]], { rays: 17, th: 0.0035 }),
      fork(0.024, 0.165, 0.22, 1.09),
      MED('anal', [[-0.08, 0.66], [-0.125, 0.69], [-0.1, 0.8], [-0.04, 0.83]], { rays: 16, th: 0.003 }),
      PEL([0.02, -0.098, 0.5 - 0.47], [[0, 0], [0.065, 0.005], [0.07, 0.032], [0.0, 0.04]], { rays: 9 }),
      PEC([0.042, -0.06, 0.5 - 0.27], [[0, 0], [0.1, -0.004], [0.115, 0.022], [0.0, 0.036]], { A: [0.4, -0.35, -0.85], B: [0, 0.35, -0.25], rays: 15 })
    ],
    eye: { t: 0.105, y: 0.026, r: 0.027 },
    mouth: { t: 0.07, y: -0.008, w: 0.004, halfW: 0.05, tilt: 0.35 },
    op: { t: 0.205, k: 0.035 },
    scales: { n: 44, amp: 0.0014 },
    scutes: { t0: 0.28, t1: 0.66, yn: -1.0, w: 0.01, h: 0.0028, n: 30 }
  },
  // NORTHERN RED SNAPPER (Lutjanus campechanus): deep-ish (36% SL), a steep sloping head and
  // pointed snout; a continuous dorsal, ten stiff spines then a soft rounded lobe; slightly
  // forked caudal; three anal spines before a rounded soft anal; long pointed pectorals; a
  // big terminal mouth; red-amber above, a pale belly, the lateral line arching high.
  snapper: {
    prof: [[0, 0.01, 0.01, 0.006], [0.04, 0.05, 0.035, 0.03], [0.1, 0.11, 0.07, 0.05], [0.2, 0.165, 0.11, 0.065], [0.33, 0.19, 0.14, 0.072],
      [0.5, 0.175, 0.135, 0.066], [0.68, 0.12, 0.09, 0.048], [0.85, 0.06, 0.05, 0.028], [0.95, 0.042, 0.036, 0.018], [1, 0.04, 0.034, 0.016]],
    fins: [
      MED('dorsalS', [[0.17, 0.28], [0.27, 0.33], [0.285, 0.40], [0.25, 0.50], [0.215, 0.56], [0.16, 0.575]], { spine: 1, rays: 10, th: 0.004 }),
      MED('dorsal', [[0.15, 0.56], [0.24, 0.6], [0.235, 0.7], [0.17, 0.79], [0.10, 0.80]], { rays: 14 }),
      fork(0.035, 0.17, 0.2, 1.12, { rays: 17 }),
      MED('anal', [[-0.11, 0.62], [-0.2, 0.66], [-0.19, 0.72], [-0.12, 0.79], [-0.07, 0.8]], { rays: 11 }),
      PEL([0.03, -0.13, 0.5 - 0.36], [[0, 0], [0.1, 0.01], [0.11, 0.04], [0, 0.05]], { A: [0.25, -0.6, -0.75], rays: 6, spine: 0 }),
      PEC([0.066, -0.04, 0.5 - 0.27], [[0, 0], [0.08, -0.01], [0.2, 0.0], [0.15, 0.03], [0, 0.05]], { A: [0.35, -0.3, -0.88], rays: 15 })
    ],
    eye: { t: 0.13, y: 0.06, r: 0.032 },
    mouth: { t: 0.12, y: -0.012, w: 0.006, halfW: 0.07, tilt: 0.2 },
    op: { t: 0.27, k: 0.05 },
    scales: { n: 40, amp: 0.0017 },
    lat: { t0: 0.25, y0: 0.55, y1: 0.1, n: 50 }
  },
  // BUTTERFLYFISH (Chaetodon): a gold disc, depth ~58% SL and paper-thin; a protruding
  // pointed snout with a tiny mouth; dorsal and anal fins continuous with the body outline,
  // spiny in front, a rounded soft lobe behind; truncate caudal; the black eye-bar.
  butterfly: {
    prof: [[0, 0.012, 0.008, 0.006], [0.05, 0.03, 0.02, 0.012], [0.1, 0.06, 0.04, 0.022], [0.18, 0.14, 0.1, 0.035], [0.3, 0.25, 0.21, 0.045],
      [0.45, 0.29, 0.25, 0.047], [0.6, 0.26, 0.22, 0.042], [0.75, 0.17, 0.14, 0.032], [0.88, 0.08, 0.07, 0.02], [0.96, 0.055, 0.05, 0.014], [1, 0.05, 0.045, 0.013]],
    fins: [
      MED('dorsal', [[0.2, 0.22], [0.28, 0.27], [0.325, 0.35], [0.34, 0.5], [0.325, 0.65], [0.285, 0.78], [0.2, 0.89], [0.13, 0.87]], { rays: 26, th: 0.0035, scal: 0.12 }),
      MED('anal', [[-0.2, 0.5], [-0.285, 0.6], [-0.295, 0.7], [-0.24, 0.8], [-0.17, 0.89], [-0.11, 0.87]], { rays: 19, th: 0.0035 }),
      CAUD([[0.04, 0.94], [0.1, 1.03], [0.11, 1.12], [0, 1.135], [-0.11, 1.12], [-0.1, 1.03], [-0.04, 0.94]], { focus: [0, 0.86], rays: 14, scal: 0.08 }),
      PEL([0.02, -0.2, 0.5 - 0.36], [[0, 0], [0.1, 0.01], [0.1, 0.04], [0, 0.045]], { A: [0.2, -0.7, -0.6] }),
      PEC([0.046, -0.03, 0.5 - 0.3], [[0, 0], [0.1, -0.01], [0.11, 0.03], [0, 0.05]], { A: [0.3, -0.25, -0.9] })
    ],
    eye: { t: 0.15, y: 0.035, r: 0.028 },
    mouth: { t: 0.03, y: 0.0, w: 0.004, halfW: 0.02 },
    op: { t: 0.22, k: 0.1 },
    scales: { n: 30, amp: 0.0018 },
    lat: { t0: 0.2, y0: 0.75, y1: 0.55, n: 30 }
  },
  // NEEDLEFISH (Belonidae): a long silver rod, depth ~7% SL; both jaws drawn into a beak
  // set with fine teeth; dorsal and anal fins far back, opposite each other; small forked
  // caudal, the lower lobe longer; the lateral line runs low.
  needlefish: {
    prof: [[0, 0.003, 0.003, 0.003], [0.12, 0.008, 0.007, 0.006], [0.18, 0.014, 0.012, 0.01], [0.22, 0.028, 0.026, 0.022], [0.3, 0.04, 0.036, 0.03],
      [0.5, 0.042, 0.04, 0.032], [0.7, 0.036, 0.034, 0.027], [0.85, 0.024, 0.022, 0.018], [0.96, 0.016, 0.014, 0.011], [1, 0.015, 0.013, 0.01]],
    fins: [
      MED('dorsal', [[0.035, 0.74], [0.075, 0.76], [0.07, 0.8], [0.05, 0.86], [0.03, 0.87]], { rays: 13, th: 0.0024 }),
      MED('anal', [[-0.033, 0.70], [-0.075, 0.72], [-0.07, 0.78], [-0.045, 0.85], [-0.028, 0.86]], { rays: 15, th: 0.0024 }),
      CAUD([[0.012, 0.96], [0.04, 1.02], [0.08, 1.12], [0.04, 1.1], [0, 1.06], [-0.05, 1.1], [-0.095, 1.135], [-0.045, 1.02], [-0.012, 0.96]], { rays: 13, th: 0.003 }),
      PEL([0.015, -0.035, 0.5 - 0.56], [[0, 0], [0.04, 0.005], [0.045, 0.02], [0, 0.025]], { th: 0.0022 }),
      PEC([0.025, -0.005, 0.5 - 0.27], [[0, 0], [0.05, -0.003], [0.055, 0.015], [0, 0.02]], { A: [0.4, -0.2, -0.9], th: 0.0022 })
    ],
    eye: { t: 0.21, y: 0.01, r: 0.015 },
    mouth: { t: 0.2, y: 0.0, w: 0.0018, halfW: 0.02 },
    op: { t: 0.29, k: 0.02 },
    scales: { n: 70, amp: 0.0007 },
    lat: { t0: 0.25, y0: -0.7, y1: -0.7, n: 60 }
  },
  // BIGEYE SCAD (Selar crumenophthalmus): fusiform, the eye enormous; a spiny first dorsal
  // and a long low second; a row of bony scutes (lateral-line plates) along the rear flank;
  // deeply forked caudal; long falcate pectorals.
  scad: {
    prof: [[0, 0.01, 0.01, 0.006], [0.04, 0.045, 0.04, 0.03], [0.12, 0.09, 0.08, 0.06], [0.25, 0.125, 0.115, 0.078], [0.4, 0.13, 0.12, 0.08],
      [0.58, 0.11, 0.1, 0.068], [0.75, 0.07, 0.06, 0.044], [0.9, 0.03, 0.026, 0.018], [0.97, 0.02, 0.018, 0.012], [1, 0.02, 0.017, 0.011]],
    fins: [
      MED('dorsalS', [[0.11, 0.3], [0.2, 0.33], [0.19, 0.37], [0.14, 0.42], [0.115, 0.43]], { spine: 1, rays: 8, th: 0.0035 }),
      MED('dorsal', [[0.11, 0.45], [0.17, 0.47], [0.14, 0.52], [0.09, 0.75], [0.06, 0.8], [0.055, 0.79]], { rays: 24 }),
      MED('anal', [[-0.1, 0.55], [-0.15, 0.57], [-0.12, 0.61], [-0.07, 0.78], [-0.05, 0.8], [-0.045, 0.79]], { rays: 20 }),
      fork(0.018, 0.17, 0.24, 1.08),
      PEL([0.02, -0.115, 0.5 - 0.36], [[0, 0], [0.07, 0.005], [0.075, 0.03], [0, 0.04]]),
      PEC([0.075, -0.03, 0.5 - 0.27], [[0, 0], [0.1, -0.01], [0.2, 0.0], [0.13, 0.025], [0, 0.04]], { A: [0.35, -0.25, -0.9] })
    ],
    eye: { t: 0.1, y: 0.03, r: 0.042 },
    mouth: { t: 0.09, y: -0.02, w: 0.006, halfW: 0.05, tilt: 0.4 },
    op: { t: 0.22, k: 0.04 },
    scales: { n: 52, amp: 0.0011 },
    scutes: { t0: 0.55, t1: 0.97, yn: 0.08, w: 0.012, h: 0.004, n: 36 },
    lat: { t0: 0.22, y0: 0.6, y1: 0.08, n: 40 }
  },
  // POMFRET (Brama brama): deep (50% SL), a blunt steep head and an oblique mouth; long
  // falcate dorsal and anal fins, high in front and trailing low behind; a big deeply forked
  // caudal; long sickle pectorals; large keeled scales; dusk-violet steel.
  pomfret: {
    prof: [[0, 0.02, 0.015, 0.01], [0.04, 0.08, 0.05, 0.04], [0.1, 0.17, 0.11, 0.07], [0.2, 0.26, 0.18, 0.09], [0.33, 0.29, 0.22, 0.095],
      [0.5, 0.24, 0.19, 0.085], [0.65, 0.16, 0.13, 0.06], [0.8, 0.08, 0.07, 0.035], [0.92, 0.04, 0.035, 0.02], [1, 0.035, 0.03, 0.016]],
    fins: [
      MED('dorsal', [[0.27, 0.3], [0.42, 0.36], [0.36, 0.42], [0.27, 0.55], [0.18, 0.7], [0.1, 0.82], [0.07, 0.8]], { rays: 34, th: 0.004 }),
      MED('anal', [[-0.21, 0.36], [-0.36, 0.42], [-0.31, 0.48], [-0.22, 0.6], [-0.14, 0.72], [-0.08, 0.82], [-0.06, 0.8]], { rays: 28, th: 0.004 }),
      fork(0.03, 0.23, 0.27, 1.1, { rays: 19 }),
      PEL([0.03, -0.2, 0.5 - 0.3], [[0, 0], [0.06, 0.005], [0.065, 0.02], [0, 0.03]], { A: [0.25, -0.7, -0.65] }),
      PEC([0.09, -0.02, 0.5 - 0.25], [[0, 0], [0.12, -0.015], [0.28, 0], [0.17, 0.03], [0, 0.055]], { A: [0.35, -0.3, -0.88], rays: 17 })
    ],
    eye: { t: 0.1, y: 0.07, r: 0.04 },
    mouth: { t: 0.1, y: 0.0, w: 0.007, halfW: 0.06, tilt: 0.6 },
    op: { t: 0.22, k: 0.06 },
    scales: { n: 26, amp: 0.0026 },
    lat: { t0: 0.22, y0: 0.65, y1: 0.1, n: 30 }
  },
  // BRISTLEMOUTH (Gonostomatidae): the commonest vertebrate on earth — a slim dark fish with
  // a gape running back past the eye, a tiny eye, a short dorsal over a long anal, a small
  // forked caudal and paired rows of photophores down the belly.
  bristlemouth: {
    prof: [[0, 0.006, 0.006, 0.006], [0.05, 0.035, 0.03, 0.028], [0.15, 0.06, 0.055, 0.042], [0.3, 0.07, 0.068, 0.045], [0.5, 0.065, 0.065, 0.04],
      [0.7, 0.05, 0.05, 0.03], [0.88, 0.03, 0.028, 0.018], [0.97, 0.02, 0.018, 0.012], [1, 0.019, 0.017, 0.011]],
    fins: [
      MED('dorsal', [[0.06, 0.5], [0.1, 0.52], [0.09, 0.58], [0.055, 0.61]], { rays: 12, th: 0.0028 }),
      MED('anal', [[-0.058, 0.5], [-0.09, 0.53], [-0.07, 0.7], [-0.04, 0.78], [-0.035, 0.77]], { rays: 26, th: 0.0028 }),
      CAUD([[0.014, 0.96], [0.04, 1.02], [0.1, 1.15], [0.05, 1.12], [0, 1.07], [-0.05, 1.12], [-0.1, 1.15], [-0.04, 1.02], [-0.014, 0.96]], { rays: 16, th: 0.0032 }),
      PEL([0.02, -0.06, 0.5 - 0.42], [[0, 0], [0.04, 0.003], [0.045, 0.02], [0, 0.025]], { th: 0.0022 }),
      PEC([0.04, -0.03, 0.5 - 0.27], [[0, 0], [0.06, -0.004], [0.065, 0.015], [0, 0.022]], { th: 0.0022 })
    ],
    eye: { t: 0.09, y: 0.025, r: 0.016 },
    mouth: { t: 0.22, y: -0.005, w: 0.007, halfW: 0.05 },
    op: { t: 0.24, k: 0.05 },
    skin: { amp: 0.0006, f: 90 },
    photo: [...row(14, 0.2, 0.72, -0.7, 0.011), ...row(12, 0.24, 0.9, -0.36, 0.009), { t: 0.17, yn: -0.45, r: 0.011 }, { t: 0.06, yn: 0.1, r: 0.008 }]
  },
  // SILVER HATCHETFISH (Argyropelecus): a blade of a body, deep and paper-thin in front, the
  // tail a narrow stalk; a bony predorsal blade; tubular eyes turned UP; a near-vertical mouth;
  // the keel edged with paired photophores in clusters, all pointing down.
  hatchet: {
    prof: [[0, 0.01, 0.01, 0.008], [0.05, 0.06, 0.07, 0.035], [0.12, 0.14, 0.2, 0.06], [0.25, 0.2, 0.33, 0.065], [0.38, 0.2, 0.36, 0.06], [0.5, 0.14, 0.3, 0.05],
      [0.6, 0.08, 0.18, 0.035], [0.7, 0.045, 0.07, 0.022], [0.82, 0.032, 0.035, 0.015], [0.94, 0.028, 0.03, 0.013], [1, 0.028, 0.03, 0.013]],
    fins: [
      MED('blade', [[0.17, 0.33], [0.235, 0.37], [0.2, 0.45], [0.16, 0.45]], { spine: 1, rays: 1, th: 0.003 }),
      MED('dorsal', [[0.12, 0.48], [0.19, 0.5], [0.17, 0.56], [0.09, 0.6]], { rays: 9 }),
      MED('anal', [[-0.16, 0.58], [-0.2, 0.6], [-0.12, 0.68], [-0.06, 0.72], [-0.05, 0.7]], { rays: 12 }),
      CAUD([[0.02, 0.96], [0.05, 1.02], [0.11, 1.13], [0.06, 1.1], [0, 1.06], [-0.06, 1.1], [-0.11, 1.13], [-0.05, 1.02], [-0.02, 0.96]], { rays: 15 }),
      PEL([0.02, -0.33, 0.5 - 0.45], [[0, 0], [0.03, 0.003], [0.035, 0.015], [0, 0.02]], { A: [0.2, -0.7, -0.7] }),
      PEC([0.05, -0.02, 0.5 - 0.22], [[0, 0], [0.08, -0.005], [0.09, 0.02], [0, 0.03]])
    ],
    eye: { t: 0.1, y: 0.1, r: 0.045, sink: 0.2, look: [0.15, 1, 0.1] },
    mouth: { t: 0.06, y: -0.02, w: 0.005, halfW: 0.04, tilt: 1.1 },
    op: { t: 0.2, k: 0.1 },
    skin: { amp: 0.0005, f: 80 },
    photo: [...row(12, 0.14, 0.55, -0.93, 0.013), ...row(6, 0.58, 0.7, -0.86, 0.011), ...row(6, 0.2, 0.42, -0.62, 0.009), { t: 0.15, yn: -0.4, r: 0.012 }]
  },
  // VENT EELPOUT (Thermarces cerberus): the pale fish of the vents — an eel-like zoarcid with
  // a big blunt head, fleshy lips, vestigial eyes under the skin, one long fin running from
  // the nape round the tail and forward under the belly, big rounded pectorals.
  eelpout: {
    frame: 'fauna', faunaLen: 2,
    prof: [[0, 0.03, 0.02, 0.03], [0.04, 0.06, 0.05, 0.055], [0.1, 0.08, 0.07, 0.07], [0.2, 0.085, 0.075, 0.07], [0.4, 0.075, 0.07, 0.06],
      [0.6, 0.062, 0.058, 0.048], [0.8, 0.045, 0.042, 0.034], [0.95, 0.03, 0.028, 0.022], [1, 0.025, 0.024, 0.018]],
    fins: [
      MED('dorsal', [[0.07, 0.25], [0.11, 0.3], [0.11, 0.6], [0.095, 0.9], [0.06, 1.0], [0.03, 1.0], [0.05, 0.6], [0.065, 0.27]], { rays: 60, th: 0.003, scal: 0.06 }),
      MED('anal', [[-0.06, 0.45], [-0.1, 0.5], [-0.1, 0.85], [-0.06, 1.0], [-0.03, 1.0], [-0.05, 0.6], [-0.055, 0.47]], { rays: 44, th: 0.003, scal: 0.06 }),
      CAUD([[0.03, 0.97], [0.06, 1.04], [0.035, 1.1], [0, 1.115], [-0.035, 1.1], [-0.06, 1.04], [-0.03, 0.97]], { focus: [0, 0.92], rays: 12, scal: 0.05 }),
      PEC([0.065, -0.03, 0.5 - 0.18], [[0, 0], [0.06, -0.03], [0.12, -0.01], [0.13, 0.04], [0.08, 0.08], [0, 0.06]], { A: [0.45, -0.3, -0.85], B: [0, 0.5, -0.2], rays: 18 })
    ],
    eye: { t: 0.075, y: 0.042, r: 0.012, sink: 0.6 },
    mouth: { t: 0.075, y: -0.03, w: 0.007, halfW: 0.06, tilt: -0.2 },
    op: { t: 0.17, k: 0.05 },
    skin: { amp: 0.0012, f: 40 }
  },
  // LANTERNFISH (Myctophidae): blunt-headed, the eye huge, a big oblique mouth; dorsal over
  // the pelvics, an ADIPOSE fin before the tail; large thin scales; and the lights — the
  // named photophore series (PO, VO, AO, Pol, Dn) in rows down the belly and flank.
  lanternfish: {
    frame: 'fauna', faunaLen: 2,
    prof: [[0, 0.03, 0.025, 0.025], [0.05, 0.075, 0.065, 0.05], [0.12, 0.11, 0.1, 0.07], [0.25, 0.125, 0.115, 0.075], [0.45, 0.12, 0.11, 0.068],
      [0.65, 0.09, 0.08, 0.05], [0.82, 0.05, 0.045, 0.03], [0.95, 0.032, 0.03, 0.02], [1, 0.03, 0.028, 0.019]],
    fins: [
      MED('dorsal', [[0.11, 0.38], [0.2, 0.42], [0.19, 0.48], [0.12, 0.56], [0.1, 0.56]], { rays: 13 }),
      MED('adipose', [[0.055, 0.78], [0.085, 0.8], [0.075, 0.845], [0.05, 0.845]], { rays: 0, th: 0.004, scal: 0 }),
      MED('anal', [[-0.1, 0.55], [-0.16, 0.58], [-0.12, 0.7], [-0.07, 0.76], [-0.06, 0.75]], { rays: 18 }),
      CAUD([[0.02, 0.96], [0.06, 1.03], [0.13, 1.18], [0.07, 1.15], [0, 1.09], [-0.07, 1.15], [-0.13, 1.18], [-0.06, 1.03], [-0.02, 0.96]], { rays: 17 }),
      PEL([0.03, -0.105, 0.5 - 0.42], [[0, 0], [0.06, 0.004], [0.065, 0.025], [0, 0.03]]),
      PEC([0.06, -0.04, 0.5 - 0.24], [[0, 0], [0.1, -0.006], [0.11, 0.02], [0, 0.035]])
    ],
    eye: { t: 0.1, y: 0.03, r: 0.05 },
    mouth: { t: 0.14, y: -0.012, w: 0.006, halfW: 0.06, tilt: 0.5 },
    op: { t: 0.21, k: 0.06 },
    scales: { n: 30, amp: 0.0016 },
    // (on the lower FLANK, where a side view finds them: PO, VO, AO rows, Pol, PLO, Dn/Vn)
    photo: [...row(5, 0.26, 0.44, -0.72, 0.016), ...row(4, 0.48, 0.6, -0.62, 0.015), ...row(7, 0.62, 0.88, -0.5, 0.014, 0.12),
      { t: 0.32, yn: -0.15, r: 0.014 }, { t: 0.7, yn: 0.12, r: 0.014 }, { t: 0.04, yn: 0.35, r: 0.01 }, { t: 0.14, yn: -0.45, r: 0.013 }, { t: 0.18, yn: -0.6, r: 0.013 }]
  }
};

// ---------------------------------------------------------------------------------------
// paint: one parametric countershaded fish, per-species marks on top
// ---------------------------------------------------------------------------------------
function bc(fish) {
  const o = {};
  return S => { const c = toCanon(fish.S, S.x, S.y, S.z); return _internal.bodyCoord(fish, c[0], c[1], c[2], o); };
}
function eyeMask(fish, lo, hi) {
  return S => {
    if (!fish.eye) return 0;
    const c = toCanon(fish.S, S.x, S.y, S.z), e = fish.eye.c, n = fish.eye.look;
    const dx = Math.abs(c[0]) - e[0], dy = c[1] - e[1], dz = c[2] - e[2], l = Math.hypot(dx, dy, dz) || 1;
    return sst(lo, hi, (dx * Math.abs(n[0]) + dy * n[1] + dz * n[2]) / l);
  };
}
const mat = id => ['mat', id];
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// P: { back, flank, belly, edge: [lo, hi] back->flank (yn), bellyEdge: [lo, hi], fin, finTip, iris, pupil, rough,
//      marks: [{ c, a, ro?, f: (o, S) => 0..1 }] (o = body coords) }
function paintFor(fish, P) {
  const B = bc(fish);
  const e = P.edge || [0.15, 0.55], be = P.bellyEdge || [-0.75, -0.35];
  const back = S => { const o = B(S); return sst(e[0], e[1], o.yn + 0.04 * Math.sin(o.t * 37 + 1.3)); };
  const belly = S => { const o = B(S); return 1 - sst(be[0], be[1], o.yn); };
  const finTip = S => { const c = toCanon(fish.S, S.x, S.y, S.z); let best = 0; for (const F of fish.fins) { const d = fish.finD(F, F.pair ? Math.abs(c[0]) : c[0], c[1], c[2]); if (d < 0.004) best = Math.max(best, fish.FL.s); } return sst(0.55, 1.0, best); };
  const layers = [
    { c: P.back, a: 1, ro: (P.rough || 0.3) + 0.08, m: [mat(FM.BODY), ['fn', back]] },
    { c: P.belly, a: 0.85, m: [mat(FM.BODY), ['fn', belly]] }
  ];
  for (const k of P.marks || []) layers.push({ c: k.c, a: k.a, ro: k.ro, m: [k.fin ? mat(FM.FIN) : mat(FM.BODY), ['fn', S => k.f(B(S), S)]] });
  layers.push(
    // scale pockets catch dark, free edges catch light
    { c: lerp3(P.back, [0, 0, 0], 0.4), a: 0.4, m: [mat(FM.BODY), ['cav', 0.15, 0.6]] },
    { c: lerp3(P.flank, [1, 1, 1], 0.5), a: 0.2, m: [mat(FM.BODY), ['cvx', 0.2, 0.7]] },
    { c: P.finTip || lerp3(P.fin, [0, 0, 0], 0.5), a: 0.7, m: [mat(FM.FIN), ['fn', finTip]] },
    { c: lerp3(P.fin, P.back, 0.6), a: 0.45, m: [mat(FM.FIN), ['nd', [0, 1, 0], 0.3, 0.95]] },
    // the eye: iris ring, black pupil (the dome is mirror-smooth: the wet mask)
    { c: P.pupil || [0.015, 0.015, 0.02], a: 1, ro: 0.04, m: [mat(FM.EYE), ['fn', eyeMask(fish, P.pupilK || 0.5, (P.pupilK || 0.5) + 0.06)]] },
    { c: lerp3(P.iris, [0, 0, 0], 0.7), a: 0.9, m: [mat(FM.EYE), ['fn', S => 1 - eyeMask(fish, 0.15, 0.4)(S)]] },
    // occlusion into the crevices: gill slit, fin roots, the orbit
    { c: [0.03, 0.03, 0.035], a: 0.8, m: [['ao', 0.35, 0.9]] }
  );
  if (fish.S.photo) {
    // photophores: a dark-rimmed silver cup, a pale lens
    layers.push({ c: [0.05, 0.05, 0.06], a: 0.9, ro: 0.2, m: [['fn', S => { const c = toCanon(fish.S, S.x, S.y, S.z), d = photoD(fish, c[0], c[1], c[2]); return d < 1.45 ? 1 - sst(1.15, 1.45, d) : 0; }]] });
    layers.push({ c: P.lens || [0.62, 0.66, 0.64], a: 1, ro: 0.08, m: [['fn', S => { const c = toCanon(fish.S, S.x, S.y, S.z), d = photoD(fish, c[0], c[1], c[2]); return 1 - sst(0.6, 0.95, d); }]] });
  }
  return {
    kScale: 0.0025, aoAlb: 0.55,
    mats: {
      [FM.BODY]: { c: P.flank, ro: P.rough || 0.3 },
      [FM.FIN]: { c: P.fin, ro: 0.45 },
      [FM.EYE]: { c: P.iris, ro: 0.05 },
      [FM.MOUTH]: { c: P.mouth || [0.25, 0.14, 0.13], ro: 0.4 }
    },
    layers
  };
}
const photoEmit = fish => S => { const c = toCanon(fish.S, S.x, S.y, S.z), d = photoD(fish, c[0], c[1], c[2]); return 1 - sst(0.45, 0.9, d); };
const stripe = (yn, w, t0 = 0.2, t1 = 0.95) => o => Math.exp(-(((o.yn - yn) / w) ** 2)) * sst(t0 - 0.03, t0, o.t) * (1 - sst(t1, t1 + 0.03, o.t));

const PAINT = {
  herring: f => paintFor(f, { back: [0.07, 0.15, 0.19], flank: [0.66, 0.70, 0.72], belly: [0.86, 0.88, 0.86], fin: [0.42, 0.47, 0.48], iris: [0.62, 0.62, 0.55], rough: 0.28,
    marks: [{ c: [0.62, 0.58, 0.40], a: 0.3, f: stripe(0.24, 0.05, 0.2, 0.9) }] }),
  snapper: f => paintFor(f, { back: [0.44, 0.17, 0.12], flank: [0.68, 0.38, 0.25], belly: [0.86, 0.70, 0.62], fin: [0.62, 0.26, 0.16], finTip: [0.30, 0.08, 0.06], iris: [0.75, 0.22, 0.12], rough: 0.36, edge: [-0.1, 0.6],
    marks: [{ c: [0.80, 0.62, 0.26], a: 0.45, f: stripe(-0.05, 0.08, 0.25, 0.9) }, { c: [0.30, 0.10, 0.08], a: 0.5, f: o => Math.exp(-((((o.t - 0.62) / 0.05) ** 2) + (((o.yn - 0.35) / 0.25) ** 2))) * 0.0 }] }),
  butterfly: f => paintFor(f, { back: [0.54, 0.42, 0.16], flank: [0.64, 0.50, 0.20], belly: [0.78, 0.72, 0.56], fin: [0.62, 0.48, 0.2], finTip: [0.08, 0.06, 0.04], iris: [0.4, 0.3, 0.12], rough: 0.34, edge: [0.6, 0.95], bellyEdge: [-0.9, -0.6],
    marks: [
      // the eye-bar: a black band from nape to throat through the eye, edged pale
      { c: [0.04, 0.035, 0.03], a: 0.95, f: o => 1 - sst(0.014, 0.022, Math.abs(o.t - 0.15 - 0.03 * o.yn)) },
      { c: [0.92, 0.88, 0.75], a: 0.6, f: o => { const d = Math.abs(o.t - 0.15 - 0.03 * o.yn); return sst(0.018, 0.024, d) * (1 - sst(0.03, 0.04, d)); } },
      // fine chevron lines down the flank
      { c: [0.45, 0.30, 0.07], a: 0.35, f: o => { const v = (o.t * 26 + Math.abs(o.yn) * 2.2) % 1; return sst(0.0, 0.08, v) * (1 - sst(0.16, 0.26, v)) * sst(0.24, 0.32, o.t) * (1 - sst(0.85, 0.92, o.t)); } },
      // a dark submarginal band on the soft dorsal / anal
      { c: [0.08, 0.06, 0.04], a: 0.85, fin: true, f: (o, S) => { const c = toCanon(f.S, S.x, S.y, S.z); return sst(0.68, 0.74, 0.5 - c[2]) * (1 - sst(0.95, 1.0, 0.5 - c[2])) * sst(0.15, 0.2, Math.abs(c[1])); } }
    ] }),
  needlefish: f => paintFor(f, { back: [0.10, 0.24, 0.22], flank: [0.62, 0.70, 0.66], belly: [0.84, 0.87, 0.82], fin: [0.30, 0.42, 0.38], iris: [0.55, 0.6, 0.5], rough: 0.26, edge: [0.25, 0.6],
    marks: [{ c: [0.06, 0.16, 0.18], a: 0.65, f: stripe(0.2, 0.18, 0.22, 0.98) }, { c: [0.08, 0.10, 0.09], a: 0.8, f: o => 1 - sst(0.03, 0.08, o.t) }] }),
  scad: f => paintFor(f, { back: [0.12, 0.18, 0.26], flank: [0.58, 0.62, 0.66], belly: [0.82, 0.83, 0.82], fin: [0.38, 0.40, 0.44], finTip: [0.18, 0.2, 0.24], iris: [0.6, 0.6, 0.55], rough: 0.28,
    marks: [{ c: [0.62, 0.56, 0.36], a: 0.25, f: stripe(0.32, 0.06, 0.25, 0.9) }, { c: [0.06, 0.06, 0.08], a: 0.7, f: o => Math.exp(-((((o.t - 0.24) / 0.012) ** 2) + (((o.yn - 0.45) / 0.15) ** 2))) }] }),
  pomfret: f => paintFor(f, { back: [0.10, 0.09, 0.14], flank: [0.36, 0.34, 0.42], belly: [0.56, 0.54, 0.60], fin: [0.12, 0.11, 0.15], finTip: [0.04, 0.04, 0.06], iris: [0.45, 0.42, 0.38], rough: 0.3, edge: [-0.2, 0.7] }),
  bristlemouth: f => paintFor(f, { back: [0.05, 0.04, 0.035], flank: [0.09, 0.075, 0.065], belly: [0.12, 0.1, 0.09], fin: [0.10, 0.09, 0.08], iris: [0.2, 0.2, 0.2], rough: 0.45, lens: [0.55, 0.62, 0.6] }),
  hatchet: f => paintFor(f, { back: [0.10, 0.12, 0.15], flank: [0.62, 0.66, 0.70], belly: [0.70, 0.72, 0.74], fin: [0.35, 0.38, 0.42], iris: [0.55, 0.6, 0.62], rough: 0.2, edge: [0.62, 0.9], bellyEdge: [-1.2, -1.1],
    marks: [{ c: [0.08, 0.08, 0.1], a: 0.6, f: o => sst(-0.86, -0.97, o.yn) * 0 + (1 - sst(-0.99, -0.92, o.yn)) }], pupilK: 0.45, lens: [0.6, 0.66, 0.66] }),
  eelpout: f => paintFor(f, { back: [0.72, 0.62, 0.58], flank: [0.80, 0.72, 0.68], belly: [0.86, 0.80, 0.76], fin: [0.76, 0.66, 0.62], finTip: [0.6, 0.48, 0.46], iris: [0.62, 0.56, 0.54], pupil: [0.45, 0.4, 0.4], rough: 0.32, mouth: [0.6, 0.35, 0.33],
    marks: [{ c: [0.62, 0.48, 0.46], a: 0.4, f: o => sst(0.45, 0.75, Math.sin(o.t * 21) * 0.5 + 0.5) * 0.35 * sst(0.0, 0.5, o.yn) }] }),
  lanternfish: f => paintFor(f, { back: [0.10, 0.13, 0.17], flank: [0.44, 0.50, 0.54], belly: [0.56, 0.60, 0.62], fin: [0.20, 0.24, 0.28], iris: [0.62, 0.66, 0.60], rough: 0.25, edge: [0.1, 0.5], lens: [0.6, 0.72, 0.7] })
};
const TRIS = { herring: 1100, snapper: 1300, butterfly: 1200, needlefish: 900, scad: 1200, pomfret: 1400, bristlemouth: 900, hatchet: 1100, eelpout: 1400, lanternfish: 1300 };

// ---------------------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------------------
// the low's grid (canonical units) and the fin floor it implies (fishKit finMin)
const LO_H = 0.0045;
export const SCHOOL_KEYS = ['herring', 'snapper', 'butterfly', 'needlefish', 'scad', 'pomfret', 'bristlemouth', 'hatchet'];
export function fishes() { const o = {}; for (const k in FISH) o[k] = makeFish(Object.assign({ finMin: LO_H * 1.45 }, FISH[k])); return o; }

export function pipeline() {
  const F = fishes(), pieces = [];
  for (const k of Object.keys(FISH)) {
    const fish = F[k], fauna = fish.S.frame === 'fauna', L = fauna ? fish.S.faunaLen : 1;
    pieces.push({
      name: k, set: 'school', sdf: fishSpec(fish), paint: PAINT[k](fish),
      hi: { h: 0.0026 * L }, lo: { h: LO_H * L, tris: TRIS[k], err: 0.03 * L },
      kEps: 0.004 * L, ao: { r: 0.03 * L, n: 4 }, cage: 0.006 * L, ray: 0.02 * L,
      emit: fish.S.photo ? photoEmit(fish) : undefined
    });
  }
  // FAR LOD (the eight school species): the same sculpt decimated to ~260 tris in its own
  // small atlas, so a school past the near radius keeps its true silhouette and colour
  // instead of falling back to the procedural lozenge
  for (const k of SCHOOL_KEYS) {
    const fish = F[k];
    pieces.push({
      name: k + '_far', set: 'schoolFar', sdf: fishSpec(fish), paint: PAINT[k](fish),
      hi: { h: 0.004 }, lo: { h: 0.0068, tris: 260, err: 0.03 },
      kEps: 0.005, ao: { r: 0.03, n: 4 }, cage: 0.008, ray: 0.024,
      emit: fish.S.photo ? photoEmit(fish) : undefined
    });
  }
  return {
    name: 'school', out: 'assets/fauna/school',
    sets: { school: { size: 2048, gutter: 6, aoDist: 0.05, aoSamples: 48, fill: true }, schoolFar: { size: 512, gutter: 4, aoDist: 0.05, aoSamples: 32, fill: true } },
    pieces,
    compress: { mesh: 'draco', tex: 'ktx2' },
    meta: { species: Object.keys(FISH) }
  };
}

export function preview() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const want = (q.get('p') || 'herring').split(','), k = +(q.get('k') || 2);
  const P = pipeline(), parts = P.pieces.filter(p => want.includes(p.name));
  const lay = {};
  parts.forEach((p, i) => { lay[p.name] = [0, -(i % 4) * 0.7, Math.floor(i / 4) * 1.6]; });
  return {
    key: 'preview-' + want.join('-') + '-' + k + '-' + Math.random(),
    parts: parts.map(p => ({ name: p.name, sdf: p.sdf, h: p.hi.h * k, tris: p.lo.tris * 4, err: p.lo.h })),
    atlas: { size: +(q.get('s') || 1024), paint: parts[0].paint, kEps: parts[0].kEps, ao: parts[0].ao },
    layout: lay
  };
}
