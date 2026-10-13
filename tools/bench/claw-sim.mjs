// CLAW SIM (clawfix 2026-10-13): Velkath's major claw over two hammer cycles, offline, at full threat, with
// brooder.js's hammer clock and the shipped joint formulas, against src/entities/sleeper/brooderClaw.js (the
// same module the game runs). No floor clamp, no body motion, no noise: the joints alone.
//   node tools/bench/claw-sim.mjs [json overrides for WHIP, e.g. '{"apex":0.1}'] [--rows]
// Prints per-frame rows around the blow and the summary the pose probe asserts live (claw-pose-probe.mjs):
// the merus-to-palm angle's range over a cycle, the finger through the cock and the landing, and the hinge's
// drift from the shipped pose on every frame the hit test can run (must be 0).
import { whip, chela, WHIP, CHELA, PH_COCK0, PH_COCK1, PH_SLAM0, PH_SLAM1 } from '../../src/entities/sleeper/brooderClaw.js';
const over = process.argv[2] && process.argv[2][0] === '{' ? JSON.parse(process.argv[2]) : {};
Object.assign(WHIP, over.WHIP || over);
if (over.CHELA) Object.assign(CHELA, over.CHELA);
const ROWS = process.argv.includes('--rows');
const T = 2.6, dt = 1 / 60, D = 180 / Math.PI, sd = 1, k = 1.35, R = 15.4;
const ease = x => x * x * (3 - 2 * x);
// rotation (YZX, x = 0) applied to a vector: Ry(y) * Rz(z) * v
const rot = (y, z, v) => { const cz = Math.cos(z), sz = Math.sin(z), cy = Math.cos(y), sy = Math.sin(y);
  const x1 = cz * v[0] - sz * v[1], y1 = sz * v[0] + cz * v[1], z1 = v[2];
  return [cy * x1 + sy * z1, y1, -sy * x1 + cy * z1]; };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))));
const HINGE = [0.60, 0.08, 0];
function chain(J) {   // J: {ry, rz, ey, ez, wy, wz} -> merus axis, palm axis, hinge (body units, from the shoulder)
  const pal = rot(J.ey, J.ez, rot(J.wy, J.wz, [1, 0, 0]));                 // palm axis in the merus frame
  const hin = add([0.40, 0, 0], rot(J.ey, J.ez, add([0.24, 0, 0], rot(J.wy, J.wz, HINGE))));
  return { mer: rot(J.ry, J.rz, [1, 0, 0]), palm: rot(J.ry, J.rz, pal), hinge: scl(rot(J.ry, J.rz, hin), k), mp: ang([1, 0, 0], pal) };
}
const L = { swingT: 0, hamPh: 0, cock: 0, swing: 0, impT: 9, clackN: 0 };
const c = { major: true }, th = 1, gape = 0.5, snap = 0;
const out = [];
for (let f = 0; f < 3 * 156; f++) {
  L.swingT += dt;
  const ph = (L.swingT % T) / T, prev = L.hamPh; L.hamPh = ph;
  L.cock = ph < PH_COCK0 ? 0 : ph < PH_COCK1 ? ease((ph - PH_COCK0) / (PH_COCK1 - PH_COCK0)) : ph < PH_SLAM0 ? 1
    : ph < PH_SLAM1 ? 1 - Math.pow((ph - PH_SLAM0) / (PH_SLAM1 - PH_SLAM0), 1.6) : 0;
  const landed = ph >= PH_SLAM1 && prev < PH_SLAM1;
  if (landed) L.impT = 0;
  if (ph >= PH_SLAM0 && ph < PH_SLAM1) L.swing = Math.pow((ph - PH_SLAM0) / (PH_SLAM1 - PH_SLAM0), 2.2);
  else if (L.impT < 3) { L.impT += dt; const kk = Math.max(0, L.impT - 0.10); L.swing = L.impT < 0.10 ? 1 : Math.exp(-4.5 * kk) * Math.cos(7 * kk); }
  else L.swing = 0;
  const ck = L.cock * th, sw = L.swing * th, hold = ck > 0.98 ? 1 : 0;
  const S = { ry: -Math.PI / 2 + sd * 0.45 - sd * 0.25 * sw + sd * 0.30 * ck, rz: 0.40 - 0.85 * sw + 0.55 * ck,
    ey: -sd * 0.40, ez: 0.30 - 0.25 * sw + 0.25 * ck, wy: -sd * 0.15, wz: -0.30 + 0.2 * sw - 0.25 * ck };
  const w = whip(c, L, th, dt);
  const N = { ry: S.ry, rz: S.rz + w.rz, ey: S.ey - sd * w.ey, ez: S.ez + w.ez, wy: S.wy - sd * w.wy, wz: S.wz + w.wz };
  const fz = chela(c, L, th, gape, snap, hold, L.swingT, dt);
  const shipDj = 0.08 + 0.20 * gape + snap + 1.00 * th * (1 - 0.9 * sw) + 0.35 * ck;
  const a = chain(S), b = chain(N);
  out.push({ f, ph, landed, impT: L.impT, ck, sw, G: w.G, mpS: a.mp * D, mpN: b.mp * D, palmPitchN: Math.asin(b.palm[1]) * D, merPitch: Math.asin(b.mer[1]) * D,
    djS: shipDj * D, djN: fz * D, hingeS: a.hinge, hingeN: b.hinge, dHinge: Math.hypot(...a.hinge.map((v, i) => v - b.hinge[i])) * R, hitWin: L.swing > 0.85,
    J: N });
}
// the third cycle (both springs and the finger in their steady cycle)
const cyc = out.slice(2 * 156);
const range = key => { const v = cyc.map(e => e[key]); return [Math.min(...v), Math.max(...v)]; };
const li = cyc.findIndex(e => e.landed);
const hw = out.filter(e => e.hitWin);
const ckStart = cyc.find(e => e.ph >= PH_COCK0), holdE = cyc.filter(e => e.ph >= 0.78 && e.ph < PH_SLAM0);
const r1 = x => +x.toFixed(1);
const sum = {
  WHIP, mpShipped: range('mpS').map(r1), mpNew: range('mpN').map(r1), mpRangeNew: r1(range('mpN')[1] - range('mpN')[0]), mpRangeShipped: r1(range('mpS')[1] - range('mpS')[0]),
  dactyl: { cockStart: r1(ckStart.djN), hold: r1(holdE[0].djN), lastFall: r1(cyc[li - 1].djN), landing: cyc.slice(li, li + 12).map(e => r1(e.djN)), shipLanding: cyc.slice(li - 1, li + 3).map(e => r1(e.djS)) },
  hitWindowFrames: hw.length, hitWindowMaxDrift_u: +Math.max(...hw.map(e => e.dHinge)).toFixed(4),
  clacks: L.clackN
};
console.log(JSON.stringify(sum, null, 1));
if (ROWS) {
  for (let i = 0; i < cyc.length; i++) {
    const e = cyc[i];
    if (!(e.ph >= 0.36 || e.ph < 0.15)) continue;
    console.log(`${String(i).padStart(3)} ph ${e.ph.toFixed(3)} ck ${e.ck.toFixed(2)} sw ${e.sw.toFixed(2)} G ${e.G.toFixed(2)} mer ${r1(e.merPitch)} palm ${r1(e.palmPitchN)} mp ${r1(e.mpS)}->${r1(e.mpN)} dj ${r1(e.djS)}->${r1(e.djN)} dH ${e.dHinge.toFixed(2)}u ez ${r1(e.J.ez * D)} wz ${r1(e.J.wz * D)} ey ${r1(e.J.ey * D)} wy ${r1(e.J.wy * D)}${e.hitWin ? ' HIT' : ''}${e.landed ? ' LAND' : ''}`);
  }
}
