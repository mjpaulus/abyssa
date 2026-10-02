// THE SHARK — sculpted (fauna2). `node tools/blender/build.mjs shark` -> assets/fauna/shark/.
// A grey reef shark (Carcharhinus amblyrhynchos) cut from fishKit's anatomy in predators.js's
// shark frame: snout at z +0.5, the peduncle at z -0.5 (body t 0..1), half-width W x radius,
// half-height H x radius on the SAME radius keys the procedural lathe used (SHARK_R), every
// fin where sharkGeometry put it, so the strike FSM's tells (the hunch's thrown-down
// pectorals, the gape's dropped jaw, the roll) move the same anatomy.
//
// Anatomy: a blunt rounded snout with the nares slit under it and the ampullae pores over
// it; an underslung crescent mouth with serrated teeth in both jaws; a round eye with a
// dark iris; five gill slits, the last two over the pectoral base; a tall falcate first
// dorsal, a tiny second; a heterocercal caudal (the upper lobe long, the lower short) with
// a black trailing margin; caudal keels; claspers no (a female). Denticle grain along the
// body axis; a lateral line; old healed rake scars on the left flank.
import { makeFish, fishSpec, labelVertex, FM, _internal } from './fishKit.js';

const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const hashP = (i, j) => { let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export const SHARK_R = [
  [0.000, 0.020], [0.040, 0.130], [0.100, 0.265], [0.175, 0.385],
  [0.280, 0.455], [0.380, 0.470], [0.500, 0.442], [0.640, 0.338],
  [0.780, 0.212], [0.890, 0.120], [1.000, 0.062]
];
export function sharkR(t) {
  const K = SHARK_R, n = K.length;
  for (let i = 1; i < n; i++) if (t <= K[i][0]) {
    const p0 = K[Math.max(0, i - 2)][1], p1 = K[i - 1][1], p2 = K[i][1], p3 = K[Math.min(n - 1, i + 1)][1];
    const u = (t - K[i - 1][0]) / (K[i][0] - K[i - 1][0]);
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  }
  return K[n - 1][1];
}
const W = 0.158, H = 0.205;
// the profile in fishKit's [t, top, bot, hw]: the head flattened and widened toward the snout
const PROF = [];
for (const t of [0, 0.02, 0.05, 0.09, 0.14, 0.2, 0.28, 0.38, 0.5, 0.64, 0.78, 0.89, 0.95, 1]) {
  const r = Math.max(0.02, sharkR(t)), snout = Math.max(0, 1 - t * 5);
  const top = r * H * (1 - 0.22 * Math.max(0, 1 - t * 6)) * (1 - 0.14 * snout), bot = r * H * 0.86 * (1 - 0.14 * snout);
  PROF.push([t, top, bot, r * W * (1 + 0.28 * snout)]);
}
const zT = -0.5;
// fins, as sharkGeometry laid them (median: [y, t]; paired: plane through a root point)
const D0 = sharkR(0.36) * H, D1 = sharkR(0.55) * H, E0 = sharkR(0.76) * H, PR = sharkR(0.28) * W, VR = sharkR(0.62) * W;
export const SHARK = {
  prof: PROF,
  fins: [
    { name: 'dorsal', med: true, pts: [[D0 * 0.85, 0.35], [D0 * 0.95 + 0.04, 0.37], [D0 + 0.118, 0.495], [D0 + 0.10, 0.515], [D1 + 0.03, 0.55], [D1 * 0.85, 0.57]], root: [5, 0], th: 0.007, rays: 0, scal: 0, per: 8 },
    { name: 'dorsal2', med: true, pts: [[E0 * 0.85, 0.755], [E0 + 0.034, 0.815], [E0 + 0.02, 0.83], [sharkR(0.855) * H * 0.85, 0.86]], root: [3, 0], th: 0.004, rays: 0, scal: 0 },
    { name: 'caudal', med: true, pts: [[0.025, 0.955], [0.05, 1.02], [0.185, 1.315], [0.165, 1.31], [0.04, 1.09], [0.0, 1.06], [-0.06, 1.1], [-0.098, 1.145], [-0.085, 1.15], [-0.02, 1.03], [-0.02, 0.955]], root: [10, 0], th: 0.006, rays: 0, scal: 0, per: 6, focus: [0, 0.9] },
    { name: 'anal', med: true, pts: [[-sharkR(0.80) * H * 0.85, 0.80], [-sharkR(0.83) * H * 0.82 - 0.032, 0.86], [-sharkR(0.85) * H * 0.82 - 0.02, 0.87], [-sharkR(0.875) * H * 0.85, 0.875]], root: [3, 0], th: 0.004, rays: 0, scal: 0 },
    { name: 'pectoral', pair: true, O: [PR * 0.8, -0.018, 0.5 - 0.232], A: [0.72, -0.4, -0.56], B: [0, 0.1, -1], pts: [[0, 0], [0.12, 0.05], [0.185, 0.115], [0.16, 0.12], [0.07, 0.11], [0, 0.1]], root: [5, 0], th: 0.007, rays: 0, scal: 0 },
    { name: 'pelvic', pair: true, O: [VR * 0.75, -sharkR(0.62) * H * 0.65, 0.5 - 0.6], A: [0.5, -0.7, -0.5], B: [0, 0, -1], pts: [[0, 0], [0.045, 0.04], [0.05, 0.075], [0, 0.08]], root: [3, 0], th: 0.004, rays: 0, scal: 0 }
  ],
  eye: { t: 0.092, y: 0.017, r: 0.0115, sink: 0.45 },
  lat: { t0: 0.12, y0: 0.35, y1: 0.05, n: 80 },
  skin: { amp: 0.0003, f: 300 }
};

export const sharkFish = () => makeFish(Object.assign({ finMin: 0.0032 }, SHARK));
// the gape crescent and the teeth seated in it (both rows; labelled tooth at install)
const MOUTH_T = c => 0.066 + 0.042 * c * c;
export const TEETH = [];
for (const row of [-1, 1]) for (let k = 0; k < 24; k++) {
  const c = -0.78 + 1.56 * (k + 0.5) / 24, ang = Math.atan2(-Math.sqrt(1 - c * c), c), t = MOUTH_T(c) + row * 0.0026;
  const r = sharkR(t), x = Math.cos(ang) * r * W * (1 + 0.28 * Math.max(0, 1 - t * 5)) * 0.93, y = Math.sin(ang) * r * H * 0.86 * (1 - 0.14 * Math.max(0, 1 - t * 5)) * 0.93;
  TEETH.push({ a: [x, y, 0.5 - t], b: [x * 0.92, y * 0.92 - row * 0.0, 0.5 - t + row * 0.004 - 0.001], r: 0.0026 });
}
export function sharkSpec() {
  const fish = sharkFish();
  const sp = fishSpec(fish);
  // gills, mouth, nares, ampullae pores, scars, denticles: layers on the fish's displacement
  const o = {};
  const bc = (x, y, z) => _internal.bodyCoord(fish, x, y, z, o);
  sp.L.push(
    { type: 'fn', amp: 0.005, fn: (x, y, z) => {
      // five gill slits, the last two shorter, raking back toward the belly
      bc(x, y, z); if (o.k < 0.8 || o.k > 1.3 || o.t < 0.17 || o.t > 0.29) return 0;
      const s = Math.sin(o.th), GT = [0.186, 0.207, 0.228, 0.249, 0.268], GH = [1, 1, 0.95, 0.85, 0.72];
      let d = 0;
      for (let k = 0; k < 5; k++) {
        const lo = -0.34 * GH[k] - 0.05, hi = 0.46 * GH[k]; if (s < lo || s > hi) continue;
        const len = Math.sqrt(Math.sin(Math.PI * (s - lo) / (hi - lo)));
        const dt = o.t - GT[k] - 0.006 * (s - 0.1);
        d += (-0.0045 * Math.exp(-((dt / 0.0018) ** 2)) + 0.0012 * Math.exp(-(((dt - 0.0045) / 0.0025) ** 2))) * len;
      }
      return d;
    } },
    { type: 'fn', amp: 0.005, fn: (x, y, z) => {
      // the underslung crescent mouth
      bc(x, y, z); if (o.t > 0.14 || y > 0) return 0;
      const c = clamp(x / Math.max(1e-3, o.a), -1, 1), s = Math.sin(o.th);
      if (s > -0.2 || Math.abs(c) > 0.92) return 0;
      const k = Math.pow(1 - Math.abs(c) / 0.92, 0.6) * Math.min(1, (-s - 0.2) / 0.3);
      return -0.004 * Math.exp(-(((o.t - MOUTH_T(c)) / 0.004) ** 2)) * k;
    } },
    { type: 'fn', amp: 0.003, bake: true, fn: (x, y, z) => {
      // nares slits under the snout, the ampullae of Lorenzini as dark pores over it
      bc(x, y, z); if (o.t > 0.08) return 0;
      let d = 0;
      const nar = Math.exp(-((((Math.abs(x) - 0.02) / 0.004) ** 2) + (((o.t - 0.035) / 0.009) ** 2))) * (y < 0 ? 1 : 0);
      d -= 0.002 * nar;
      const f = 140, px = x * f, pz = z * f, q = Math.hypot(px - Math.round(px), pz - Math.round(pz));
      if (q < 0.22 && o.t < 0.08 && hashP(Math.round(px), Math.round(pz)) < 0.45) d -= 0.0007 * (1 - q / 0.22);
      return d;
    } },
    { type: 'fn', amp: 0.002, bake: true, fn: (x, y, z) => {
      // three healed rake scars on the left flank, a pale ridged seam each
      bc(x, y, z); if (x < 0 || o.k < 0.85 || o.k > 1.2) return 0;
      let m = 0;
      for (let k = 0; k < 3; k++) { const t0 = 0.40 + k * 0.012, y0 = 0.25 - k * 0.07; const d = Math.abs((o.yn - y0) - (o.t - t0) * -0.9) * o.b; if (o.t > t0 && o.t < t0 + 0.13) m = Math.max(m, Math.exp(-((d / 0.0016) ** 2)) * Math.sin(Math.PI * (o.t - t0) / 0.13)); }
      return 0.0012 * m;
    } },
    { type: 'fn', amp: 0.0006, bake: true, fn: (x, y, z) => { bc(x, y, z); return o.k > 0.8 && o.k < 1.2 ? 0.0003 * Math.sin(o.th * 900 + Math.sin(o.t * 200) * 1.5) : 0; } }
  );
  // the teeth in the crescent
  sp.ch[0] = { t: 'u', k: 0.0015, ch: [sp.ch[0], ...TEETH.map(T => ({ t: 'cone', a: T.a, b: [T.b[0], T.b[1], T.b[2]], ra: T.r, rb: 0.0006, m: FM.SPINE }))] };
  return { sp, fish };
}
export function sharkPaint(fish) {
  const o = {};
  const bc = S => _internal.bodyCoord(fish, S.x, S.y, S.z, o);
  return {
    kScale: 0.0015, aoAlb: 0.5,
    // NEUTRAL luminance: the shark's dorsal/ventral colour is the live uDark/uPale (per animal)
    mats: { [FM.BODY]: { c: [0.62, 0.62, 0.62], ro: 0.42 }, [FM.FIN]: { c: [0.6, 0.6, 0.6], ro: 0.45 }, [FM.EYE]: { c: [0.06, 0.06, 0.06], ro: 0.04 }, [FM.SPINE]: { c: [0.92, 0.9, 0.84], ro: 0.3 } },
    layers: [
      // the caudal's black trailing margin, dusky fin tips
      { c: [0.18, 0.18, 0.18], a: 0.85, m: [['mat', FM.FIN], ['fn', S => { const t = 0.5 - S.z; return sst(1.2, 1.3, t) + (t > 1.0 && S.y < -0.04 ? sst(1.1, 1.15, t) : 0) + sst(0.19, 0.21, S.y) * (t > 0.45 && t < 0.56 ? 1 : 0); }]] },
      { c: [0.30, 0.30, 0.30], a: 0.5, m: [['mat', FM.FIN], ['nd', [0, 1, 0], 0.4, 1.0]] },
      // a soft mottle and the gill tissue in the slits
      { c: [0.50, 0.50, 0.50], a: 0.4, m: [['mat', FM.BODY], ['n', 18, 0.5, 0.75, 191]] },
      { c: [0.30, 0.12, 0.12], a: 0.75, m: [['cav', 0.5, 1.4], ['fn', S => { bc(S); return o.t > 0.17 && o.t < 0.29 ? 1 : 0; }]] },
      { c: [0.10, 0.08, 0.08], a: 0.8, m: [['cav', 0.4, 1.2], ['fn', S => { bc(S); return o.t < 0.14 && S.y < 0 ? 1 : 0; }]] },
      // the healed scars paler
      { c: [0.86, 0.84, 0.80], a: 0.6, m: [['cvx', 0.5, 1.2], ['fn', S => (S.x > 0 && (0.5 - S.z) > 0.38 && (0.5 - S.z) < 0.6 ? 1 : 0)]] },
      // the eye: a dark bronze iris ring round a black pupil
      { c: [0.20, 0.16, 0.10], a: 0.8, m: [['mat', FM.EYE], ['fn', S => { const e = fish.eye.c, n = fish.eye.n; const dx = Math.abs(S.x) - e[0], dy = S.y - e[1], dz = S.z - e[2], l = Math.hypot(dx, dy, dz) || 1; return 1 - sst(0.55, 0.7, (dx * n[0] + dy * n[1] + dz * n[2]) / l); }]] },
      { c: [0.03, 0.03, 0.03], a: 0.7, m: [['ao', 0.35, 0.9]] }
    ]
  };
}
export function labelShark(fish, x, y, z, L) {
  labelVertex(fish, x, y, z, L);
  L.tooth = 0;
  for (const T of TEETH) { const dx = Math.abs(x) - Math.abs(T.a[0]), dy = y - T.a[1], dz = z - T.a[2]; if (dx * dx + dy * dy + dz * dz < 0.008 * 0.008 && y < 0) { L.tooth = 1; break; } }
  return L;
}
export function pipeline() {
  const { sp, fish } = sharkSpec();
  return {
    name: 'shark', out: 'assets/fauna/shark',
    sets: { shark: { size: 2048, gutter: 6, aoDist: 0.03, aoSamples: 48, fill: true } },
    pieces: [{ name: 'shark', set: 'shark', sdf: sp, paint: sharkPaint(fish), hi: { h: 0.0011 }, lo: { h: 0.003, tris: 5200, err: 0.006 }, kEps: 0.0025, ao: { r: 0.015, n: 4 }, cage: 0.003, ray: 0.01 }],
    compress: { mesh: 'draco', tex: 'ktx2' },
    meta: {}
  };
}
