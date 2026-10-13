// CLAW POSE PROBE (clawfix 2026-10-13, reviews/claw-audit.md): Velkath's crusher over one hammer blow, live,
// frame by frame, and three assertions on it (exit 1 if any fails):
//   1. THE ARM IS NOT A STICK: the merus-to-palm angle (merus axis vs palm axis, world) ranges >= 25 deg over
//      the blow (main: ~1.3 deg, the palm welded to the merus)
//   2. THE FINGER OPENS ON THE WIND-UP: the dactyl at the trembling hold is >= 30 deg wider than at the cock's
//      start (main: parked open by the threat before the cock, +7 deg)
//   3. ...AND SNAPS SHUT ON THE LANDING: still open (>= 45 deg) on the last frame of the fall, and shut
//      (<= 12 deg) within 3 frames of the landing frame (main: it closes during the fall, with the arm)
// Also booked (not asserted): the hinge's path on every frame the hit test can run (L.swing > 0.85), in her
// body frame, the clacks, and how much of the blow the game camera sees (NDC of the hinge and the finger tip).
//   DRV_PORT=9510 node tools/bench/claw-pose-probe.mjs <port> [path ''|'new/'] [tag] [D=34] [side=9]
// Velkath is woken, Sal stood D u in front of her (side u to her left), her threat let come up, then she is
// HELD (__lev.cmd('hold'): no hunt, turn or lunge; the hammer keeps its clock) and the live loop stopped.
// JSON -> CP_OUT (default the shots dir) / claw-pose-<tag>.json
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9510';
if (!process.env.DRV_DIR) process.env.DRV_DIR = tmpdir() + '/abyssa-cp-' + process.env.DRV_PORT + '-' + Date.now();
const { start, stop, connect, sleep } = await import('./drv.mjs');
const [, , PORT = '8860', PATH = '', TAG = 'run', D = '34', SIDE = '9'] = process.argv;
const OUT = process.env.CP_OUT || '/Users/michaelpaulus/sc/.abyssa-wt/shots';
await start(`http://localhost:${PORT}/${PATH}?bench&playtest&lab`);
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(2500);
await c.ev(`(async () => { await window.__bench.setup('z0b'); return 1; })()`);
const setup = await c.ev(`(async () => {
  const L = window.__sl, B = window.__bench, P = window.player, D = ${+D}, side = ${+SIDE};
  window.__lev.cmd('wake');
  B.step(60 * 9);
  const place = () => { const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const x = L.pos.x + fx * D - rx * side, z = L.pos.z + fz * D - rz * side; B.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0); };
  place();
  let k = 0;
  B.step(60 * 10, i => { if (i % 30 === 0) place(); k = i; if (i > 200 && L.threatE > 0.99 && L.hamPh > 0.02 && L.hamPh < 0.05) return false; });
  window.__lev.cmd('hold');
  place();
  return { k, hold: L.hold, threatE: +L.threatE.toFixed(3), ph: +L.hamPh.toFixed(3), sculpted: !!L.sculpted, sal: P.pos.toArray().map(v => +v.toFixed(2)), fromCentre: +Math.hypot(P.pos.x - L.pos.x, P.pos.z - L.pos.z).toFixed(1) };
})()`);
console.log('setup', JSON.stringify(setup));
// CP_SET='{"apex":0.15}': lab knobs on WHIP before the blows (brooderClaw.js)
if (process.env.CP_SET) console.log('set', JSON.stringify(await c.ev(`window.__claw ? Object.assign(window.__claw.WHIP, ${process.env.CP_SET}) : null`)));
// two full cycles, every frame rendered through the real pipeline (the game camera with it)
const rows = await c.ev(`(async () => {
  const L = window.__sl, B = window.__bench, P = window.player, S = window.survival;
  const cam = (await import(new URL('src/core.js', document.baseURI).href)).camera;
  const V = P.pos.constructor, c = L.claws.find(q => q.major), m = L.claws.find(q => !q.major);
  const ax = o => new V(1, 0, 0).transformDirection(o.matrixWorld);
  const W = (o, x = 0, y = 0, z = 0) => new V(x, y, z).applyMatrix4(o.matrixWorld);
  const ndc = p => { const q = p.clone().project(cam); return [+q.x.toFixed(3), +q.y.toFixed(3), q.z < 1 ? 1 : 0]; };
  const d = r => +(r * 57.29578).toFixed(2);
  const keep = () => { S.fuel = 1; S.oxygen = 1; if (S.reserve != null) S.reserve = S.reserveCap || S.reserve; L.strikeCd = 99; };
  const sal0 = P.pos.clone();
  B.hold(true);
  const out = [], AB = ${process.env.CP_AB ? 1 : 0}, K = window.__claw;
  // A/B (CP_AB=1): five blows, the new claw OFF (the shipped rod and finger), ON, OFF, ON, OFF, switched at each
  // cock's start; the hammer's 2.6 s is exactly 156 frames, so the blows sample the same phases
  let nCk = 0, prevPh = L.hamPh;
  const setOn = v => { if (K) { K.WHIP.on = v; K.CHELA.on = v; } };
  if (AB) setOn(0);
  B.step(AB ? 5 * 156 + 70 : 2 * 156 + 2, () => {
    keep();
    if (AB && prevPh < 0.40 && L.hamPh >= 0.40) { nCk++; setOn(nCk % 2); }
    prevPh = L.hamPh;
    const h = W(c.dj), hb = L.body.worldToLocal(h.clone()), tip = W(c.dact, 0.52, -0.16);
    out.push({ ph: +L.hamPh.toFixed(4), impT: +(L.impT < 9 ? L.impT : 9).toFixed(4), cock: +L.cock.toFixed(4), swing: +L.swing.toFixed(4), thE: +L.threatE.toFixed(3),
      mp: d(ax(c.root).angleTo(ax(c.pj))), merusPitch: d(Math.asin(ax(c.root).y)), palmPitch: d(Math.asin(ax(c.pj).y)),
      rootZ: d(c.root.rotation.z), cjZ: d(c.cj.rotation.z), pjZ: d(c.pj.rotation.z), cjY: d(c.cj.rotation.y), pjY: d(c.pj.rotation.y),
      dj: d(c.dj.rotation.z), minorDj: d(m.dj.rotation.z), lift: d(c.liftNow || 0), need: d(c.need || 0), elbow: d(c.elbow || 0),
      hinge: h.toArray().map(v => +v.toFixed(3)), hingeBody: hb.toArray().map(v => +v.toFixed(5)),
      ndcHinge: ndc(h), ndcTip: ndc(tip), clackN: L.clackN || 0, hits: L.hits || 0, on: K ? K.WHIP.on : 1, blow: nCk });
  }, { render: true });
  setOn(1);
  B.hold(false);
  return { rows: out, salMoved: +P.pos.distanceTo(sal0).toFixed(3), camD: +cam.position.distanceTo(P.pos).toFixed(2) };
})()`);
const R = rows.rows;
if (process.env.CP_AB) {
  // the hit window, OFF vs ON at the same phase (blow 1/3 ON against the OFF blows either side of it), and
  // OFF vs OFF (blows 0, 2, 4) as the noise floor; hinge in her body frame (shell units, x R = u)
  const Ru = await c.ev('window.__sl.R');
  const win = b => R.filter(e => e.blow === b && e.swing > 0.85 && e.thE > 0.8);
  const dd = (a, b) => Math.hypot(...a.hingeBody.map((v, j) => v - b.hingeBody[j])) * Ru;
  const cmp = (x, y) => { const A = win(x), B2 = win(y); const n = Math.min(A.length, B2.length); const ds = [];
    for (let i = 0; i < n; i++) ds.push(+dd(A[i], B2[i]).toFixed(3)); return { blows: [x, y], n, ph: A.slice(0, n).map((e, i) => [e.ph, B2[i].ph]), drift_u: ds, max_u: Math.max(...ds) }; };
  const res = { offOff: [cmp(0, 2), cmp(2, 4)], onOff: [cmp(1, 0), cmp(1, 2), cmp(3, 2), cmp(3, 4)],
    liftOn: R.filter(e => e.on && e.swing > 0.85).map(e => e.lift), liftOff: R.filter(e => !e.on && e.swing > 0.85).map(e => e.lift) };
  writeFileSync(`${OUT}/claw-ab-${TAG}.json`, JSON.stringify({ res, rows: R }, null, 1));
  console.log(JSON.stringify(res));
  c.close(); stop(); process.exit(0);
}
// one blow: the second cycle, from the start of its cock to the start of the next cock
const i0 = R.findIndex((e, i) => i > 0 && R[i - 1].ph < 0.40 && e.ph >= 0.40);
const i1 = R.findIndex((e, i) => i > i0 + 10 && R[i - 1].ph < 0.40 && e.ph >= 0.40);
const blow = R.slice(i0, i1 > 0 ? i1 : R.length);
const li = blow.findIndex((e, i) => i > 0 && blow[i - 1].ph < 0.90 && e.ph >= 0.90);
const mps = blow.map(e => e.mp), mpRange = Math.max(...mps) - Math.min(...mps);
const holdRow = blow.find(e => e.ph >= 0.80);
const r1 = x => +x.toFixed(1);
const djCock = blow[0].dj, djHold = holdRow.dj, djLastFall = blow[li - 1].dj, djLand = blow.slice(li, li + 3).map(e => e.dj);
const A = [
  { name: 'merus-to-palm range >= 25 deg', value: r1(mpRange), pass: mpRange >= 25 },
  { name: 'finger opens >= 30 deg from the cock start to the hold', value: r1(djHold - djCock), pass: djHold - djCock >= 30 },
  { name: 'finger open (>= 45 deg) on the last fall frame', value: r1(djLastFall), pass: djLastFall >= 45 },
  { name: 'finger shut (<= 12 deg) within 3 frames of the landing', value: r1(Math.min(...djLand)), pass: Math.min(...djLand) <= 12 }
];
const hitWin = R.map((e, i) => ({ i, ...e })).filter(e => e.swing > 0.85 && e.thE > 0.8);
const inFrame = q => q[2] && Math.abs(q[0]) <= 1 && Math.abs(q[1]) <= 1;
const seen = blow.filter(e => inFrame(e.ndcHinge) || inFrame(e.ndcTip)).length;
const phases = { guard: [0, 0.40], cock: [0.40, 0.72], hold: [0.72, 0.84], fall: [0.84, 0.90], recoil: [0.90, 1.01] };
const seenBy = {};
for (const [k, [a, b]] of Object.entries(phases)) { const f = blow.filter(e => e.ph >= a && e.ph < b); seenBy[k] = `${f.filter(e => inFrame(e.ndcHinge) || inFrame(e.ndcTip)).length}/${f.length}`; }
const ndcHold = blow.filter(e => e.ph >= 0.72 && e.ph < 0.84).map(e => e.ndcTip[1]);
const summary = {
  tag: TAG, path: PATH, setup, salMoved: rows.salMoved, camD: rows.camD,
  assertions: A, pass: A.every(a => a.pass),
  mp: [r1(Math.min(...mps)), r1(Math.max(...mps))], dactyl: { cockStart: r1(djCock), hold: r1(djHold), lastFall: r1(djLastFall), landing: blow.slice(li, li + 12).map(e => r1(e.dj)) },
  minorDjMin: r1(Math.min(...R.map(e => e.minorDj))), clacks: R[R.length - 1].clackN,
  hitWindow: hitWin.map(e => ({ i: e.i, ph: e.ph, swing: e.swing, hingeBody: e.hingeBody, lift: e.lift })),
  framing: { seenFrames: `${seen}/${blow.length}`, seenBy, tipNdcYatHold: ndcHold.length ? [r1(Math.min(...ndcHold)), r1(Math.max(...ndcHold))] : null }
};
writeFileSync(`${OUT}/claw-pose-${TAG}.json`, JSON.stringify({ summary, rows: R }, null, 1));
for (const a of A) console.log(`${a.pass ? 'PASS' : 'FAIL'}  ${a.name}: ${a.value}`);
console.log(JSON.stringify({ ...summary, hitWindow: summary.hitWindow.length + ' frames' }));
const cons = (await c.console()).filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (cons.length) console.log('CONSOLE', cons.slice(0, 5).join('\n'));
c.close();
stop();
process.exit(summary.pass ? 0 : 1);
