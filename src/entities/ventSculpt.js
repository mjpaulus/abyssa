// THE VENT SHRIMP and THE YETI CRAB (fauna3) — `node tools/blender/build.mjs vent` -> assets/fauna/vent/.
//
// world/ventlife.js draws both as GPU-instanced swarms whose every motion lives in the vertex
// shader (the swirl round the throat, the pleopod flick keyed on position.x, the crab's leg
// shuffle on y < 0, the claw lift on x > 0.15). The sculpts are authored in exactly that frame
// (+X forward, origin at the body, model units before the per-instance size), so the shader moves
// them unchanged; ventlife.js writes the same uv = (kind, along) labels onto the baked meshes.
//
// Reference:
//   Rimicaris exoculata (the Mid-Atlantic vent shrimp, swarming the black smokers in thousands):
//   an INFLATED carapace (the branchial chambers swollen for the bacteria it farms), no stalked
//   eyes but a pale pinkish DORSAL ORGAN on the front of the carapace (the "eye" that sees the
//   vent's glow), a short blunt rostrum, a six-segmented abdomen with side pleura, a tail fan;
//   the carapace often stained rust-orange with iron oxides; slender white walking legs.
//   Kiwa (the "yeti crab", a galatheid squat lobster of the Pacific/Southern vents): a longer-
//   than-wide carapace with transverse striae and a rostral spine, very long chelipeds held
//   forward and covered in dense SETAE (where it farms its bacteria), three pairs of walking
//   legs, the abdomen folded under, tiny reduced eyes. White to cream, setae yellow-grey.
const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const E = (c, r, m = 0, e) => ({ t: 'ellip', c, r, m, e });
const Cap = (a, b, ra, rb = ra, m = 0) => ({ t: 'cap', a, b, ra, rb, m });
const U = (k, ...ch) => ({ t: 'u', k, ch });
const Mir = (ax, ch) => ({ t: 'mir', ax, ch: [ch] });
const Disp = (L, ch) => ({ t: 'disp', L, ch: [ch] });
const mat = id => ['mat', id];
export const VM = { SHELL: 0, ABD: 1, ORGAN: 2, FAN: 3, CLAW: 4, LEG: 5, SETAE: 6, EYE: 7 };

// ---- the shrimp ---------------------------------------------------------------------------------
// abdomen segment centres (x, y, half-height, half-width): an arched tail tapering to the fan
export const SHRIMP_SEG = [
  [0.05, 0.075, 0.105, 0.088], [-0.035, 0.068, 0.098, 0.080], [-0.12, 0.055, 0.088, 0.070],
  [-0.20, 0.038, 0.076, 0.060], [-0.28, 0.018, 0.064, 0.050], [-0.355, -0.002, 0.050, 0.040]
];
function shrimpSpec() {
  // the carapace: inflated, the branchial chambers bulging low on each side
  let s = U(0.04, E([0.27, 0.085, 0], [0.215, 0.115, 0.115], VM.SHELL), Mir(2, E([0.24, 0.055, 0.055], [0.175, 0.095, 0.085], VM.SHELL)));
  // the blunt rostrum
  s = U(0.02, s, Cap([0.42, 0.13, 0], [0.505, 0.125, 0], 0.028, 0.008, VM.SHELL));
  // the abdomen: six overlapping rings (a tight blend keeps the joints), side pleura on the first five
  const segs = SHRIMP_SEG.map(([x, y, h, w], i) => E([x, y, 0], [0.072, h * 0.96, w], VM.ABD));
  const pleura = SHRIMP_SEG.slice(0, 5).map(([x, y, h, w]) => Mir(2, E([x, y - h * 0.55, w * 0.72], [0.05, h * 0.55, 0.022], VM.ABD)));
  s = U(0.028, s, ...segs, ...pleura);
  // the tail fan: telson and two pairs of uropods, thin plates
  s = U(0.015, s, E([-0.50, -0.025, 0], [0.13, 0.014, 0.032], VM.FAN, [0, 0, -0.12]),
    Mir(2, E([-0.49, -0.03, 0.055], [0.12, 0.012, 0.045], VM.FAN, [0, 0.42, -0.1])));
  return Disp([
    // the carapace's fine sculpture: a gentle cervical groove, the branchial swelling's grain
    { type: 'fn', amp: 0.006, bake: true, fn: (x, y, z) => x > 0.06 ? -0.004 * Math.exp(-(((x - 0.20) / 0.012) ** 2)) * sst(0.06, 0.12, y) : 0 },
    // segment joints on the abdomen (the overlaps read as grooves)
    { type: 'fn', amp: 0.005, bake: true, fn: (x, y, z) => {
      if (x > 0.1 || x < -0.40) return 0;
      let g = 0; for (let i = 0; i < 5; i++) { const xm = (SHRIMP_SEG[i][0] + SHRIMP_SEG[i + 1][0]) / 2; g = Math.max(g, Math.exp(-(((x - xm) / 0.008) ** 2))); }
      return -0.0035 * g;
    } },
    { type: 'grain', amp: 0.0015, f: 160, seed: 71, bake: true }
  ], s);
}
// the dorsal organ: a paired pale patch on the front of the carapace's back
const organ = S => {
  const dx = (S.x - 0.34) / 0.11, dz = Math.abs(S.z) / 0.075;
  return (1 - sst(0.8, 1.1, Math.hypot(dx, dz))) * sst(0.1, 0.5, S.ny) * (1 - 0.35 * sst(0.0, 0.25, 1 - Math.abs(S.z) / 0.012));
};
function shrimpPaint() {
  return {
    kScale: 0.004, aoAlb: 0.5,
    mats: { [VM.SHELL]: { c: [0.84, 0.74, 0.66], ro: 0.45 }, [VM.ABD]: { c: [0.88, 0.80, 0.74], ro: 0.4 }, [VM.FAN]: { c: [0.90, 0.84, 0.78], ro: 0.4 } },
    layers: [
      // iron-oxide staining over the carapace, heaviest on the branchial chambers
      { c: [0.62, 0.34, 0.18], a: 0.75, m: [mat(VM.SHELL), ['n', 14, 0.48, 0.72, 701]] },
      { c: [0.52, 0.30, 0.20], a: 0.45, m: [mat(VM.SHELL), ['n', 40, 0.55, 0.8, 702]] },
      // the abdomen: translucent pale, joints darker, a faint pink at the segment rims
      { c: [0.86, 0.64, 0.60], a: 0.4, m: [mat(VM.ABD), ['cvx', 0.4, 1.2]] },
      { c: [0.40, 0.30, 0.26], a: 0.6, m: [['cav', 0.3, 1.0]] },
      // the gut showing dark down the back of the abdomen
      { c: [0.36, 0.26, 0.20], a: 0.55, m: [mat(VM.ABD), ['fn', S => (1 - sst(0.010, 0.026, Math.abs(S.z))) * sst(0.2, 0.7, S.ny)]] },
      // the dorsal organ: the pale pink "eye"
      { c: [0.98, 0.80, 0.80], a: 0.95, m: [['fn', organ]] },
      { c: [0.94, 0.88, 0.82], a: 0.5, m: [mat(VM.FAN)] },
      { c: [0.04, 0.03, 0.03], a: 0.65, m: [['ao', 0.35, 0.9]] }
    ]
  };
}
// The shrimp's appendages stay thin generated geometry (the decimator would eat them): five pairs
// of jointed walking legs, the pleopods, two pairs of antennae. Each is a 2-triangle-per-segment
// ribbon; kind 2 (appendage) in the label. Returned as plain arrays for ventlife.js.
export function shrimpAppendages() {
  const P = [], I = [], K = [];
  const rib = (pts, w0, w1, kind, up = [0, 1, 0]) => {
    const base = P.length / 3, n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      // side vector: t x up, so the ribbon faces sideways-up and reads from above and the side
      let sx = ty * up[2] - tz * up[1], sy = tz * up[0] - tx * up[2], sz = tx * up[1] - ty * up[0];
      const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      const w = w0 + (w1 - w0) * i / (n - 1);
      P.push(pts[i][0] - sx * w, pts[i][1] - sy * w, pts[i][2] - sz * w, pts[i][0] + sx * w, pts[i][1] + sy * w, pts[i][2] + sz * w);
      K.push(kind, i / (n - 1), kind, i / (n - 1));
    }
    for (let i = 0; i < n - 1; i++) { const q = base + i * 2; I.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  };
  for (const s of [-1, 1]) {
    // walking legs (pereiopods): coxa under the carapace, out, a knee, down and back
    for (let k = 0; k < 5; k++) {
      const x = 0.36 - k * 0.07, sp = 1 + k * 0.08;
      rib([[x, 0.0, s * 0.05], [x - 0.03, -0.07, s * 0.13 * sp], [x - 0.10, -0.15, s * 0.16 * sp]], 0.008, 0.003, 2, [1, 0, 0]);
    }
    // pleopods: little paddles under the abdomen (the flick moves them with the tail)
    for (let k = 0; k < 3; k++) {
      const x = -0.02 - k * 0.09;
      rib([[x, -0.02, s * 0.03], [x - 0.04, -0.11, s * 0.05]], 0.014, 0.006, 2, [1, 0, 0]);
    }
    // antennules (short, forked) and antennae (long, swept back over the body)
    rib([[0.47, 0.10, s * 0.03], [0.72, 0.18, s * 0.08]], 0.006, 0.002, 2);
    rib([[0.46, 0.07, s * 0.05], [0.72, 0.15, s * 0.20], [1.0, 0.12, s * 0.44]], 0.006, 0.0015, 2);
  }
  return { P, I, K };
}

// ---- the yeti crab -----------------------------------------------------------------------------
// limb polylines (one side, z > 0): chelipeds forward, three walking legs, all in the crab frame
// (legs dip below y = 0 where the shader's shuffle moves them; claws are x > 0.15)
export const KIWA_CHELA = [[0.07, 0.06, 0.07], [0.17, 0.075, 0.15], [0.26, 0.07, 0.15], [0.33, 0.065, 0.12], [0.45, 0.06, 0.10], [0.52, 0.055, 0.09]];
export const KIWA_LEGS = [0, 1, 2].map(k => {
  const x = 0.04 - k * 0.065, z = 0.075 + (k === 1 ? 0.01 : 0);
  return [[x, 0.05, z], [x - 0.01 - k * 0.012, 0.12, z + 0.11], [x - 0.04 - k * 0.025, 0.02, z + 0.20], [x - 0.06 - k * 0.03, -0.07, z + 0.24]];
});
function chain(pts, r0, r1, m) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
    out.push(Cap(pts[i], pts[i + 1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, m));
  }
  return U(0.006, ...out);
}
function kiwaSpec() {
  // the carapace: longer than wide, a flattened dome; the rostral spine
  let s = E([0.0, 0.075, 0], [0.135, 0.058, 0.098], VM.SHELL);
  s = U(0.015, s, Cap([0.12, 0.08, 0], [0.19, 0.075, 0], 0.016, 0.003, VM.SHELL));
  // the abdomen folded under the rear
  s = U(0.02, s, E([-0.10, 0.035, 0], [0.07, 0.03, 0.07], VM.SHELL));
  // tiny reduced eyes under the rostrum
  s = U(0.006, s, Mir(2, E([0.13, 0.065, 0.028], [0.012, 0.010, 0.012], VM.EYE)));
  // the chelipeds: merus, carpus, the long hand, the fingers (a cleft between them)
  const chela = U(0.01,
    chain(KIWA_CHELA.slice(0, 4), 0.022, 0.03, VM.CLAW),
    E([0.385, 0.064, 0.112], [0.07, 0.03, 0.026], VM.CLAW, [0, 0.25, 0]),
    Cap([0.44, 0.07, 0.10], [0.53, 0.06, 0.085], 0.012, 0.004, VM.CLAW),
    Cap([0.44, 0.052, 0.102], [0.525, 0.048, 0.092], 0.011, 0.004, VM.CLAW));
  s = U(0.02, s, Mir(2, chela));
  for (const L of KIWA_LEGS) s = U(0.012, s, Mir(2, chain(L, 0.016, 0.006, VM.LEG)));
  return Disp([
    // transverse striae across the carapace (squat-lobster ridges)
    { type: 'fn', amp: 0.004, bake: true, fn: (x, y, z) => {
      if (y < 0.06 || Math.abs(z) > 0.11 || x < -0.14 || x > 0.14) return 0;
      const r = Math.abs(Math.sin((x + 0.012 * Math.sin(z * 40)) * 95));
      return 0.0028 * Math.pow(r, 8);
    } },
    // the setae: a dense hair coat on the chelipeds (and lighter on the legs) — in the bake as
    // fine directional ridges with a fuzz, so the normal map and the albedo carry the yeti read
    { type: 'fn', amp: 0.008, bake: true, fn: (x, y, z) => {
      const az = Math.abs(z);
      const onChela = x > 0.08 && az > 0.05 && y > 0.02;
      const onLeg = !onChela && az > 0.11;
      if (!onChela && !onLeg) return 0;
      const h1 = Math.sin(x * 900 + az * 610 + 3 * Math.sin(y * 300)), h2 = Math.sin(x * 1300 - az * 800 + y * 500);
      const fur = Math.max(0, h1 * 0.6 + h2 * 0.4);
      return (onChela ? 0.0055 : 0.0022) * fur * fur;
    } },
    { type: 'grain', amp: 0.0012, f: 180, seed: 81, bake: true }
  ], s);
}
const setae = S => { const az = Math.abs(S.z); return S.x > 0.08 && az > 0.05 && S.y > 0.02 ? 1 : az > 0.11 ? 0.45 : 0; };
function kiwaPaint() {
  return {
    kScale: 0.004, aoAlb: 0.55,
    mats: { [VM.SHELL]: { c: [0.88, 0.85, 0.78], ro: 0.6 }, [VM.CLAW]: { c: [0.86, 0.83, 0.76], ro: 0.6 }, [VM.LEG]: { c: [0.88, 0.85, 0.79], ro: 0.6 }, [VM.EYE]: { c: [0.55, 0.42, 0.36], ro: 0.3 } },
    layers: [
      // a faint mineral grime in the striae, cream between
      { c: [0.70, 0.66, 0.56], a: 0.5, m: [['cav', 0.2, 0.9]] },
      { c: [0.80, 0.76, 0.64], a: 0.35, m: [['n', 22, 0.5, 0.75, 801]] },
      // the setae: yellow-grey with the bacteria they farm, streaked
      { c: [0.66, 0.62, 0.46], a: 0.8, m: [['fn', setae], ['n', 60, 0.35, 0.75, 802]] },
      { c: [0.50, 0.48, 0.38], a: 0.45, m: [['fn', setae], ['cav', 0.1, 0.7]] },
      // finger tips darker
      { c: [0.42, 0.36, 0.30], a: 0.7, m: [['fn', S => sst(0.48, 0.52, S.x)]] },
      { c: [0.04, 0.04, 0.03], a: 0.65, m: [['ao', 0.35, 0.9]] }
    ]
  };
}
// labels (ventlife.js): uv = (kind, along) as its shaders expect. Shrimp body: 0 (the dorsal
// organ is in the bake). Crab: 0 shell, 1 leg, 2 claw, 3 eye.
export function kiwaKind(x, y, z) {
  const az = Math.abs(z);
  if (x > 0.115 && x < 0.15 && az < 0.045 && y < 0.08 && y > 0.05 && Math.hypot(x - 0.13, y - 0.065, az - 0.028) < 0.016) return 3;
  if (x > 0.09 && az > 0.06) return 2;
  if (az > 0.10 || y < 0.0) return 1;
  return 0;
}
export function pipeline() {
  return {
    name: 'vent', out: 'assets/fauna/vent',
    sets: { vent: { size: 1024, gutter: 6, aoDist: 0.03, aoSamples: 48, fill: true } },
    pieces: [
      { name: 'shrimp', set: 'vent', sdf: shrimpSpec(), paint: shrimpPaint(), hi: { h: 0.0022 }, lo: { h: 0.012, tris: 170, err: 0.03 }, kEps: 0.004, ao: { r: 0.02, n: 4 }, cage: 0.008, ray: 0.025 },
      { name: 'kiwa', set: 'vent', sdf: kiwaSpec(), paint: kiwaPaint(), hi: { h: 0.0018 }, lo: { h: 0.006, tris: 1300, err: 0.006 }, kEps: 0.004, ao: { r: 0.02, n: 4 }, cage: 0.008, ray: 0.025 }
    ],
    compress: { mesh: 'draco', tex: 'ktx2' },
    meta: {}
  };
}
export function preview() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const want = (q.get('p') || 'shrimp').split(','), k = +(q.get('k') || 2);
  const P = pipeline(), parts = P.pieces.filter(p => want.includes(p.name));
  return {
    key: 'preview-' + want.join('-') + '-' + k + '-' + Math.random(),
    parts: parts.map(p => ({ name: p.name, sdf: p.sdf, h: p.hi.h * k, tris: p.lo.tris * 2, err: p.lo.h })),
    atlas: { size: +(q.get('s') || 1024), paint: parts[0].paint, kEps: parts[0].kEps, ao: parts[0].ao },
    layout: Object.fromEntries(parts.map((p, i) => [p.name, [0, 0, i * 0.8]]))
  };
}
