// THE OLD HARPOON (fissure-and-harpoon Task 6; spec 2026-10-10 §2 + §3) —
//   node tools/blender/build.mjs harpoon  ->  assets/harpoon/  (harpoon.glb, harpoon_albedo/normal/orm.webp, harpoon.json)
//
// ONE model, two owners: lodged in Velkath's near flank (sleeper/harpoon.js) and, from Task 7, Sal's
// blade in his free hand. So it is sculpted ONCE at true game size with its own pivot, and the meta
// records the points either owner needs (no re-bake to re-use it).
//
// After the reference: a 19th-century whaling iron of the TOGGLE pattern (Lewis Temple's iron,
// 1848): a wrought-iron SHANK whose fork carries a pivoting HEAD on a pin, the head a two-flued
// leaf with its barbs swept back, canted on the pin the way a toggle lies once it has turned in
// the wound; a forged SOCKET flaring to take the pole; a BRASS FERRULE (a whaleman's repair band)
// round the pole's mouth with two raised rings and rivets; the POLE itself, hickory gone grey and
// checked in the water, snapped a forearm's length back (a splintered break, not a saw cut); a
// LASHING of tarred line round the pole behind the ferrule, three turns, and the line's STUB
// leaving it, frayed to its strands (the game draws the rest of the line down into the silt from
// meta.lineEnd).
//
// Frame: +Z toward the point, the head's leaf flat in X/Z (wide in X), +Y its face. Origin on the
// axis at the ferrule's mouth. Units: game units (Sal's eye is 1.35 over his soles).
// PURE (no THREE): sleeper/harpoon.js imports DIM for its procedural fallback (the same proportions).
const PI = Math.PI;
const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
function hash(i, s = 0) { let h = Math.imul(i | 0, 374761393) ^ Math.imul(s | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

export const HM = { IRON: 0, BRASS: 1, WOOD: 2, ROPE: 3 };
// the proportions (z along the axis; r radii)
export const DIM = {
  tip: 0.665, headBase: 0.47, barbBack: 0.42, headHalfW: 0.088, pin: 0.448, toggle: 0.21,   // toggle: the head's cant on its pin (rad)
  shank0: 0.105, shankR: 0.0155, socket0: 0.03, socketR: 0.031,
  fer0: -0.125, fer1: 0.035, ferR: 0.047,
  butt: -1.02, poleR0: 0.034, poleR1: 0.031,
  lash0: -0.215, lash1: -0.16, lashR: 0.0105,
  // where a hand closes on it (Task 7) and how far the iron goes in when it is lodged
  grip: -0.42, lodge: 0.40
};
// the line's stub: from the lashing, a short hang down and back, then the frayed end
const LINE = [[0.040, -0.022, -0.172], [0.072, -0.085, -0.215], [0.070, -0.165, -0.268], [0.052, -0.215, -0.318]];
const LINE_R = 0.0105;
// the frayed strands at the stub's end (deterministic)
const STRANDS = (() => {
  const e = LINE[3], out = [];
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * 2 * PI + 0.4 * hash(k, 3), sp = 0.35 + 0.5 * hash(k, 5), len = 0.035 + 0.05 * hash(k, 7);
    // mostly on along the line's own run (down and back), splayed out
    const dx = 0.12 * Math.cos(a) * sp, dy = -0.80, dz = -0.55 + 0.25 * Math.sin(a) * sp, l = Math.hypot(dx, dy, dz);
    const b = [e[0] + dx / l * len + 0.010 * Math.cos(a), e[1] + dy / l * len, e[2] + dz / l * len + 0.010 * Math.sin(a)];
    out.push({ a: [e[0] + 0.004 * Math.cos(a), e[1] - 0.004, e[2] + 0.004 * Math.sin(a)], b, r: 0.0036 - 0.0006 * hash(k, 9) });
  }
  return out;
})();

// 2-D signed distance to a polygon (x, z), after iq
function sdPoly(px, pz, V) {
  let d = (px - V[0][0]) ** 2 + (pz - V[0][1]) ** 2, s = 1;
  for (let i = 0, j = V.length - 1; i < V.length; j = i, i++) {
    const ex = V[j][0] - V[i][0], ez = V[j][1] - V[i][1], wx = px - V[i][0], wz = pz - V[i][1];
    const h = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1);
    const bx = wx - ex * h, bz = wz - ez * h;
    d = Math.min(d, bx * bx + bz * bz);
    const c1 = pz >= V[i][1], c2 = pz < V[j][1], c3 = ex * wz > ez * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}
// the head's leaf, in its own (un-canted) frame: the point, the flues, the barbs swept back
const W = DIM.headHalfW;
const LEAF = [[0, DIM.tip], [0.070, 0.508], [W, DIM.barbBack], [0.046, 0.469], [0.019, 0.462],
  [-0.019, 0.462], [-0.046, 0.469], [-W, DIM.barbBack], [-0.070, 0.508]];
const TC = Math.cos(DIM.toggle), TS = Math.sin(DIM.toggle);
// the toggle: the head turned on its pin about Y (the axis through its face)
function toHead(x, z, o) { const dx = x, dz = z - DIM.pin; o.x = dx * TC - dz * TS; o.z = dx * TS + dz * TC + DIM.pin; return o; }
const _h = { x: 0, z: 0 };
function headSdf(x, y, z) {
  toHead(x, z, _h);
  const d2 = sdPoly(_h.x, _h.z, LEAF);
  // a ridge down the middle, the flues thinning to an edge; the barbs a little heavier
  const th = 0.0042 + 0.0085 * Math.max(0, 1 - Math.abs(_h.x) / 0.085) + 0.002 * sst(0.5, 0.44, _h.z);
  return Math.max(d2, Math.abs(y) - th) * 0.95;
}
// the snapped pole's end: splinters (longer on one side, where it tore), as a cut plane that jags
function buttCut(x, y, z) {
  const a = Math.atan2(y, x), r = Math.hypot(x, y);
  const jag = 0.045 * Math.max(0, Math.sin(a * 1 + 0.7)) + 0.022 * Math.abs(Math.sin(a * 5 + 1.3)) + 0.012 * Math.abs(Math.sin(a * 13 + 0.2))
    + 0.03 * sst(0.015, 0.034, r) * Math.max(0, Math.sin(a * 3 + 2.1));
  return (DIM.butt + 0.075 - jag) - z;   // > 0 behind the break (removed)
}
// the pole's surface, weathered: grain grooves wandering along it, and a few long CHECKS
function woodRelief(x, y, z) {
  const r = Math.hypot(x, y);
  if (z > DIM.fer0 + 0.004 || r > DIM.poleR0 + 0.006) return 0;
  const a = Math.atan2(y, x);
  const g = Math.sin(a * 41 + 2.6 * Math.sin(z * 8.3) + 1.4 * Math.sin(z * 21 + a * 3));
  const g2 = Math.sin(a * 97 + 1.1 * Math.sin(z * 13 + 0.5));
  let d = -0.0016 * Math.pow(Math.max(0, g), 6) - 0.0007 * Math.pow(Math.max(0, g2), 4);
  // checks: dry splits along the grain, a few per pole, tapering at each end
  for (let k = 0; k < 6; k++) {
    const ca = hash(k, 21) * 2 * PI, c0 = DIM.butt + 0.1 + hash(k, 23) * 0.7, cl = 0.12 + hash(k, 25) * 0.25;
    const t = (z - c0) / cl;
    if (t < 0 || t > 1) continue;
    let da = a - ca - 0.06 * Math.sin(z * 11 + k); da = Math.atan2(Math.sin(da), Math.cos(da));
    const w = 0.022 * Math.sin(PI * t);
    d -= 0.0055 * Math.sin(PI * t) * Math.max(0, 1 - (da / Math.max(1e-3, w)) ** 2);
  }
  // the break: the last few cm fibrous
  d -= 0.0018 * sst(DIM.butt + 0.16, DIM.butt + 0.08, z) * Math.pow(Math.max(0, g2), 2);
  return d;
}
// iron: forge scale and corrosion, rust blooms raised, pitting under them
function ironMask(x, y, z) { return sst(DIM.fer1 - 0.01, DIM.fer1 + 0.01, z); }

function harpoonSpec() {
  const D = DIM;
  const pole = { t: 'i', k: 0.004, ch: [
    { t: 'cap', a: [0, 0, D.butt], b: [0, 0, D.fer0 + 0.01], ra: D.poleR1, rb: D.poleR0, m: HM.WOOD },
    // the break: a jagged cut plane (its bound spans the whole pole: an intersection takes the
    // smaller bound, and a short one would clip the pole to the break's few cm)
    { t: 'fn', bb: [-0.06, -0.06, D.butt - 0.02, 0.06, 0.06, D.fer0 + 0.02], f: (x, y, z) => buttCut(x, y, z) * 0.8, m: HM.WOOD }
  ] };
  const ferrule = { t: 'u', k: 0.002, ch: [
    { t: 'cone', a: [0, 0, D.fer0], b: [0, 0, D.fer1], ra: D.ferR, rb: D.ferR - 0.003, m: HM.BRASS },
    { t: 'torus', c: [0, 0, D.fer0 + 0.008], R: D.ferR, r: 0.0065, e: [PI / 2, 0, 0], m: HM.BRASS },
    { t: 'torus', c: [0, 0, D.fer1 - 0.010], R: D.ferR - 0.003, r: 0.0058, e: [PI / 2, 0, 0], m: HM.BRASS },
    { t: 'sphere', c: [D.ferR - 0.001, 0, -0.045], r: 0.0075, m: HM.BRASS },
    { t: 'sphere', c: [-(D.ferR - 0.001), 0, -0.045], r: 0.0075, m: HM.BRASS },
    { t: 'sphere', c: [0, D.ferR - 0.001, -0.075], r: 0.0068, m: HM.BRASS }
  ] };
  const iron = { t: 'u', k: 0.008, ch: [
    // the socket, forged round the pole's mouth, drawn down into the shank
    { t: 'cone', a: [0, 0, D.socket0 - 0.02], b: [0, 0, D.shank0 + 0.012], ra: D.socketR, rb: D.shankR + 0.002, m: HM.IRON },
    // the shank: square-ish wrought rod
    { t: 'box', c: [0, 0, (D.shank0 + D.pin) / 2], h: [D.shankR, D.shankR, (D.pin - D.shank0) / 2], r: 0.0075, m: HM.IRON },
    // the fork's cheeks either side of the head, and the pin through them
    { t: 'box', c: [0, 0.0135, D.pin - 0.006], h: [0.016, 0.0042, 0.022], r: 0.003, m: HM.IRON },
    { t: 'box', c: [0, -0.0135, D.pin - 0.006], h: [0.016, 0.0042, 0.022], r: 0.003, m: HM.IRON },
    { t: 'cap', a: [0, -0.021, D.pin], b: [0, 0.021, D.pin], r: 0.0062, m: HM.IRON }
  ] };
  const head = { t: 'fn', bb: [-0.11, -0.02, 0.38, 0.11, 0.02, 0.69], f: headSdf, m: HM.IRON };
  // the lashing: three turns of tarred line behind the ferrule, and the stub leaving it
  const lash = [];
  for (let k = 0; k < 3; k++) {
    const z = D.lash0 + (D.lash1 - D.lash0) * (k + 0.5) / 3;
    lash.push({ t: 'torus', c: [0, 0, z], R: D.poleR0 + D.lashR * 0.75, r: D.lashR, e: [PI / 2, 0.06 * (k - 1), 0], m: HM.ROPE });
  }
  const stub = { t: 'tube', p: LINE, r: [LINE_R, LINE_R * 0.92], n: 10, m: HM.ROPE };
  const strands = STRANDS.map(s => ({ t: 'cap', a: s.a, b: s.b, ra: s.r, rb: s.r * 0.6, m: HM.ROPE }));
  const rope = { t: 'u', k: 0.004, ch: [...lash, stub, { t: 'u', k: 0.003, ch: strands }] };
  const body = { t: 'u', k: 0.003, ch: [pole, ferrule, iron, head, rope] };
  return {
    t: 'disp', L: [
      // mesh: the wood's checks deep enough to break the silhouette a little
      { type: 'fn', amp: 0.006, fn: (x, y, z) => 0.6 * woodRelief(x, y, z) },
      // bake: the grain itself, the rest of the checks
      { type: 'fn', amp: 0.004, bake: true, fn: (x, y, z) => 0.4 * woodRelief(x, y, z) },
      // bake: iron corrosion, raised blooms and pits under them
      { type: 'fbm', amp: 0.0016, f: 70, oct: 3, seed: 41, bake: true, mask: [['ax', 2, D.fer1 - 0.005, D.fer1 + 0.015]] },
      { type: 'pits', amp: 0.0018, f: 90, dens: 0.55, r: 0.35, seed: 43, bake: true, mask: [['ax', 2, D.fer1 - 0.005, D.fer1 + 0.015]] },
      // bake: brass dents and wear
      { type: 'fbm', amp: 0.0007, f: 120, oct: 2, seed: 47, bake: true, mask: [['ax', 2, D.fer0 - 0.01, D.fer0 + 0.005], ['ax', 2, D.fer1 + 0.005, D.fer1 - 0.005]] },
      // bake: the line's lay (strands twisting round it) and its fibre
      { type: 'fn', amp: 0.0022, bake: true, fn: (x, y, z) => ropeLay(x, y, z) },
      { type: 'grain', amp: 0.0006, f: 260, seed: 49, bake: true }
    ], ch: [body]
  };
}
// the line's lay: three strands round the stub and round each lashing turn (a helical groove)
function ropeLay(x, y, z) {
  const r = Math.hypot(x, y);
  // lashing turns: the ring frame (angle round the pole a, the tube's own angle b)
  if (z > DIM.lash0 - 0.01 && z < DIM.lash1 + 0.01 && r > DIM.poleR0 + 0.002) {
    const a = Math.atan2(y, x), q = r - (DIM.poleR0 + DIM.lashR * 0.75), zz = (z - DIM.lash0) / (DIM.lash1 - DIM.lash0) * 3;
    const b = Math.atan2(zz - Math.floor(zz) - 0.5, q / DIM.lashR * 0.33);
    return -0.0016 * Math.pow(Math.abs(Math.sin(1.5 * b + a * 9)), 3);
  }
  // the stub: below/behind the lashing, keyed on position along its run
  if (y < -0.01 && z < -0.15) {
    const t = clamp((-y - 0.01) / 0.21, 0, 1), c = LINE, u = 1 - t;
    const cx = u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0];
    const cz = u * u * u * c[0][2] + 3 * u * u * t * c[1][2] + 3 * u * t * t * c[2][2] + t * t * t * c[3][2];
    const b = Math.atan2(z - cz, x - cx);
    return -0.0018 * Math.pow(Math.abs(Math.sin(1.5 * b + t * 55)), 3);
  }
  return 0;
}

const mat = id => ['mat', id];
function harpoonPaint() {
  const z = f => ['fn', S => f(S)];
  return {
    kScale: 0.0025, aoAlb: 0.5,
    mats: {
      [HM.IRON]: { c: [0.20, 0.19, 0.18], ro: 0.62 },
      [HM.BRASS]: { c: [0.58, 0.45, 0.24], ro: 0.42 },
      [HM.WOOD]: { c: [0.46, 0.43, 0.38], ro: 0.82 },
      [HM.ROPE]: { c: [0.20, 0.17, 0.13], ro: 0.88 }
    },
    layers: [
      // IRON: rust in broad blooms (orange-brown), darker scale in the crevices, bright where worn
      { c: [0.36, 0.17, 0.08], a: 0.85, ro: 0.86, m: [mat(HM.IRON), ['n', 18, 0.38, 0.62, 301]] },
      { c: [0.26, 0.11, 0.05], a: 0.7, ro: 0.9, m: [mat(HM.IRON), ['cav', 0.05, 0.6]] },
      { c: [0.44, 0.24, 0.11], a: 0.5, ro: 0.9, m: [mat(HM.IRON), ['n', 55, 0.5, 0.72, 303]] },
      { c: [0.34, 0.33, 0.32], a: 0.55, ro: 0.45, m: [mat(HM.IRON), ['cvx', 0.4, 1.6], ['n', 9, 0.3, 0.7, 305]] },
      // BRASS: verdigris in the crevices and round the rivets, a dull bronze bloom, worn bright on the rings
      { c: [0.30, 0.42, 0.33], a: 0.85, ro: 0.85, m: [mat(HM.BRASS), ['cav', 0.04, 0.5]] },
      { c: [0.36, 0.44, 0.34], a: 0.55, ro: 0.8, m: [mat(HM.BRASS), ['n', 26, 0.52, 0.72, 311]] },
      { c: [0.40, 0.30, 0.17], a: 0.4, m: [mat(HM.BRASS), ['n', 7, 0.4, 0.7, 313]] },
      { c: [0.76, 0.60, 0.33], a: 0.55, ro: 0.3, m: [mat(HM.BRASS), ['cvx', 0.5, 1.8]] },
      // WOOD: grey weathered hickory, darker in the checks and grain, a silt-stained underside, the
      // break pale and raw
      { c: [0.30, 0.28, 0.25], a: 0.8, m: [mat(HM.WOOD), ['cav', 0.04, 0.5]] },
      { c: [0.55, 0.52, 0.45], a: 0.35, m: [mat(HM.WOOD), ['n', 12, 0.45, 0.75, 321]] },
      { c: [0.33, 0.30, 0.24], a: 0.45, m: [mat(HM.WOOD), ['nd', [0, -1, 0], 0.2, 0.9]] },
      { c: [0.66, 0.56, 0.40], a: 0.85, m: [mat(HM.WOOD), z(S => sst(DIM.butt + 0.12, DIM.butt + 0.05, S.z))] },
      // a band of rust bleeding onto the pole from the ferrule
      { c: [0.34, 0.20, 0.11], a: 0.5, m: [mat(HM.WOOD), z(S => sst(DIM.fer0 - 0.09, DIM.fer0 - 0.005, S.z))] },
      // ROPE: tarred line, black-brown, the frayed end paler where the tar is gone
      { c: [0.12, 0.10, 0.08], a: 0.6, m: [mat(HM.ROPE), ['cav', 0.04, 0.5]] },
      { c: [0.42, 0.36, 0.27], a: 0.8, ro: 0.95, m: [mat(HM.ROPE), z(S => sst(-0.205, -0.235, S.y) * sst(-0.29, -0.31, S.z))] },
      // silt in every crevice, over everything
      { c: [0.40, 0.38, 0.32], a: 0.45, ro: 0.95, m: [['cav', 0.2, 0.9], ['n', 30, 0.45, 0.7, 331]] },
      { c: [0.02, 0.02, 0.02], a: 0.6, m: [['ao', 0.3, 0.9]] }
    ]
  };
}
// METALNESS (ORM.B, Sal's convention: set ormB 'metal'): the iron's clean metal only where the rust
// is not (bare where worn), the brass a metal under its verdigris, the pole and the line none
function isM(S, id) { return (S.ma === id ? 1 - S.mw : 0) + (S.mb === id ? S.mw : 0); }
function vn(x, y, z, f, s) {
  // a cheap value noise for the emit mask (the paint's own masks are not reachable here)
  const X = Math.floor(x * f), Y = Math.floor(y * f), Z = Math.floor(z * f);
  return hash(X * 7919 + Y * 104729 + Z * 1299709, s);
}
export const harpoonMetal = S => {
  const iron = isM(S, HM.IRON), brass = isM(S, HM.BRASS);
  const worn = sst(0.4, 1.6, S.k);
  const rusty = 0.55 + 0.45 * vn(S.x, S.y, S.z, 30, 7);
  return iron * clamp(0.25 + 0.6 * worn - 0.3 * rusty + 0.2, 0, 0.85) + brass * clamp(0.85 - 0.8 * sst(-0.05, -0.5, S.k) - 0.3 * (1 - S.ao), 0, 1);
};

export function pipeline() {
  return {
    name: 'harpoon', out: 'assets/harpoon',
    sets: { harpoon: { size: 1024, gutter: 4, packMargin: 3, aoDist: 0.03, aoSamples: 48, ormB: 'metal', fill: true } },
    pieces: [{
      name: 'harpoon', set: 'harpoon', sdf: harpoonSpec(), paint: harpoonPaint(), emit: harpoonMetal,
      hi: { h: 0.0016 }, lo: { h: 0.0034, tris: 6000, err: 0.0028 },
      kEps: 0.004, ao: { r: 0.02, n: 4 }, cage: 0.006, ray: 0.02
    }],
    compress: { mesh: 'draco' },
    meta: {
      dim: DIM, lineEnd: LINE[3], lineDir: [LINE[3][0] - LINE[2][0], LINE[3][1] - LINE[2][1], LINE[3][2] - LINE[2][2]],
      metal: 'ormB', frame: '+Z point, origin on the axis at the ferrule mouth, head flat in X/Z'
    }
  };
}
export function preview() {
  const P = pipeline(), p = P.pieces[0];
  return {
    key: 'preview-harpoon-' + Math.random(),
    parts: [{ name: p.name, sdf: p.sdf, h: p.hi.h * 2, tris: p.lo.tris, err: p.lo.h }],
    atlas: { size: 1024, paint: p.paint, kEps: p.kEps, ao: p.ao },
    layout: { harpoon: [0, 0, 0] }
  };
}
