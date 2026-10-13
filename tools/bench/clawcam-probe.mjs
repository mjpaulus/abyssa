// CLAWCAM PROBE (clawcam 2026-10-13; Michael: "add the camera look-up"). The REAL follow camera over
// Velkath's hammer blows (__bench.step runs update(), which runs updateCamera), with Sal stood still
// in front of her at fight ranges and no look input: per frame, the NDC of her major claw's palm (the
// middle of the propodus, wrist to finger hinge), its dactyl tip and Sal's helmet, the lens pitch, and
// the pitch the lens would have had without the look-up (__clawcam.state().pre: the look-up is the
// LAST rotation updateCamera makes, so the lens without it is exactly the on:0 lens).
//   DRV_PORT=9512 node tools/bench/clawcam-probe.mjs <port> [path ''|'x/'] [tag] [mode framing|grounded|mouse|all]
//   env CC_ON=0|1 (default 1): __clawcam.knobs.on for the run (main has no __clawcam: on 0)
//       CC_SET='{"maxDeg":30}': more knobs. CC_SPOTS='[[18,0],[24,0]]': [ahead u, left u] of her centre.
// Velkath is woken, her threat raised with Sal 24 u ahead, then HELD (__lev.cmd('hold'): no hunt, turn
// or lunge; the hammer keeps its clock and her threat stays up), and Sal is stood at each spot facing her.
// Each spot books two whole blows from a cock's start (156 frames each), every frame rendered.
// JSON -> CC_OUT (default the shots dir) / clawcam-<tag>.json. Exit 1 if an assertion fails.
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9512';
if (!process.env.DRV_DIR) process.env.DRV_DIR = tmpdir() + '/abyssa-cc-' + process.env.DRV_PORT + '-' + Date.now();
const { start, stop, connect, sleep } = await import('./drv.mjs');
const [, , PORT = '8862', PATH = '', TAG = 'run', MODE = 'framing'] = process.argv;
const OUT = process.env.CC_OUT || '/Users/michaelpaulus/sc/.abyssa-wt/shots';
mkdirSync(OUT, { recursive: true });
const ON = process.env.CC_ON == null ? 1 : +process.env.CC_ON;
const SPOTS = JSON.parse(process.env.CC_SPOTS || '[[10,0],[14,0],[18,0],[24,0],[30,0],[34,0],[18,12]]');

await start(`http://localhost:${PORT}/${PATH}?bench&playtest&lab`);
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(2500);
const knobs = await c.ev(`(() => { const C = window.__clawcam; if (!C) return null; C.knobs.on = ${ON}; ${process.env.CC_SET ? `Object.assign(C.knobs, ${process.env.CC_SET});` : ''} return Object.assign({}, C.knobs); })()`);
console.log('knobs', JSON.stringify(knobs), 'on', knobs ? knobs.on : 0);

// ---- page side: the helpers (module temps on window.__ccp) ----
await c.ev(`(async () => {
  const THREE = await import('three');
  const DV = await import(new URL('src/entities/diver.js', document.baseURI).href);
  const L = window.__sl, P = window.player, cam = window.camera, V = THREE.Vector3;
  const box = new THREE.Box3(), w = new V(), a = new V(), b = new V(), f = new V(), r = new V(), u = new V(), Y = new V(0, 1, 0);
  const pts = { palm: new V(), wrist: new V(), hinge: new V(), tip: new V(), helm: new V(), helmLo: new V(), helmHi: new V() };
  const claw = () => L.claws.find(q => q.major);
  const r3 = x => +x.toFixed(3), r2 = x => +x.toFixed(2);
  // where the points are this frame (the claw's matrices are current after her update: clampClaw
  // refreshes them, and the render did too)
  function points() {
    const c = claw();
    pts.wrist.setFromMatrixPosition(c.pj.matrixWorld);
    pts.hinge.setFromMatrixPosition(c.dj.matrixWorld);
    pts.palm.copy(pts.wrist).add(pts.hinge).multiplyScalar(0.5);
    pts.tip.set(0.52, -0.16, 0).applyMatrix4(c.dact.matrixWorld);
    box.setFromObject(DV.diver.helmGroup, true);   // precise: the bonnet's own vertices
    box.getCenter(pts.helm);
    pts.helmLo.set(pts.helm.x, box.min.y, pts.helm.z); pts.helmHi.set(pts.helm.x, box.max.y, pts.helm.z);
  }
  const ndc = p => { w.copy(p).project(cam); return [r3(w.x), r3(w.y), w.z < 1 ? 1 : 0]; };
  // the angle of p above the lens's forward, in the lens's pitch plane (deg; about the horizontal right)
  function phi(p, q) {
    f.set(0, 0, -1).applyQuaternion(q); r.crossVectors(f, Y).normalize(); u.crossVectors(r, f);
    w.copy(p).sub(cam.position);
    return r2(Math.atan2(w.dot(u), w.dot(f)) * 57.29578);
  }
  const pitchOf = q => { f.set(0, 0, -1).applyQuaternion(q); return r3(Math.asin(Math.max(-1, Math.min(1, f.y))) * 57.29578); };
  function row() {
    cam.updateMatrixWorld();
    points();
    const CC = window.__clawcam, st = CC ? CC.state() : null;
    const cs = window.__crecam.state(), bs = window.__bosscam.state();
    const qPre = st && st.qPre ? st.qPre : cam.quaternion;
    const o = { ph: +L.hamPh.toFixed(4), impT: r3(L.impT < 9 ? L.impT : 9), thE: r3(L.threatE), cock: r3(L.cock), swing: r3(L.swing),
      pitch: pitchOf(cam.quaternion), pre: pitchOf(qPre), tilt: st ? r3(st.tilt) : 0, k: st ? r3(st.k) : 0, gate: st ? r3(st.gate) : 0, why: st ? st.why : '',
      fov: r2(cam.fov), camD: cs.camDist, creU: cs.under, bossK: bs.k };
    for (const k in pts) o[k] = ndc(pts[k]);
    // (for the what-if: angles above the PRE-tilt forward)
    o.phi = { palm: phi(pts.palm, qPre), tip: phi(pts.tip, qPre), wrist: phi(pts.wrist, qPre), hinge: phi(pts.hinge, qPre), helm: phi(pts.helm, qPre), helmLo: phi(pts.helmLo, qPre) };
    o.sal = [r2(P.pos.x), r2(P.pos.y), r2(P.pos.z)];
    o.q = [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w];
    o.qPre = [qPre.x, qPre.y, qPre.z, qPre.w];
    o.cp = [cam.position.x, cam.position.y, cam.position.z];
    return o;
  }
  const keep = () => { const S = window.survival; S.fuel = 1; S.oxygen = 1; if (S.reserve != null) S.reserve = S.reserveCap || S.reserve; L.strikeCd = 99; };
  // stand him D u ahead of her centre and side u to her left, facing her
  function place(D, side) {
    const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const x = L.pos.x + fx * D - rx * side, z = L.pos.z + fz * D - rz * side;
    window.__bench.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0);
  }
  window.__ccp = { row, keep, place, points, pts, ndc };
  return 1;
})()`);

const summary = { tag: TAG, path: PATH, on: knobs ? knobs.on : 0, knobs, mode: MODE };
const asserts = [];
const r1 = x => +x.toFixed(1), r2 = x => +x.toFixed(2);
const inF = q => q[2] && Math.abs(q[0]) <= 0.95 && Math.abs(q[1]) <= 0.95;
const PH = { cock0: 0.40, cock1: 0.72, slam0: 0.84, slam1: 0.90 };
// THE BARS (written 2026-10-13 on main 50832db's numbers, BEFORE the camera code: run main1, Sal still, her held):
// Her cocked palm hangs 57-78 deg above the lens's forward at the front spots, and his bonnet's lowest point leaves
// the bottom edge after 13-19 deg of pitch at 14-24 u (24-38 deg at 30-34 u, where CRECAM has the lens 2.2 u behind
// him and his helmet sits high in the frame). So a pitch-only look-up that keeps him in frame cannot frame her claw
// at 14-24 u (the what-if on main's own frames: 0% at 14 and 18 u, 39% of the hold at 24 u), and the brief's
// suggested "palm on >= 80% of cock+hold frames at every range" is out of reach there. The bars are set where it
// is reachable, and the rest is booked:
//   GATE   10 u ahead (under her shell, rule 5; in play she does not hammer there): the look-up is exactly 0 on
//          every frame.
//   CLAW   30 and 34 u ahead (her standoff: un-held with Sal still she stops 33-35 u off) and 18 u ahead / 12 u to
//          her left: any of wrist / palm / finger hinge / dactyl tip in frame (|x|,|y| <= 0.95) on >= 80% of the
//          HOLD frames and >= 50% of the cock+hold frames (main: 0/0, 0/0, 0/31%).
//   PALM   34 u: the palm itself in frame on >= 20% of the cock+hold frames (main 0%; the ceiling with his bonnet
//          held in frame and a 25 deg cap is ~32%).
//   SAL    his bonnet's centre AND its lowest point in frame on 100% of frames, every spot.
//   SETTLE |pitch - the on:0 pitch| <= 0.5 deg from 0.4 s after each landing to the next cock, every spot.
// 14, 18 and 24 u ahead are booked, not asserted.
const BARS = { gate: [[10, 0]], claw: [[30, 0], [34, 0], [18, 12]], palm: [[34, 0]], clawHold: 80, clawCH: 50, palmCH: 20 };
const isAt = (list, D, side) => list.some(([a, b]) => a === D && b === side);
const D2R = Math.PI / 180;
// the ceiling: what a pitch-only tilt could frame on these frames (the pre-tilt lens), capped at `cap` deg and held
// so his bonnet's lowest point stays at NDC y >= -guard, aiming the palm at NDC y `aim`
function ceiling(rows, cap, aim, guard) {
  const T = Math.tan(rows[0].fov * D2R / 2);
  const inAfter = (e, k, th) => {
    const ph = e.phi[k] * D2R, t = th * D2R;
    if (Math.cos(ph - t) <= 0.05) return false;
    const y = Math.tan(ph - t) / T, x = e[k][2] && Math.cos(ph) > 0.05 ? e[k][0] * Math.cos(ph) / Math.cos(ph - t) : 9;
    return Math.abs(y) <= 0.95 && Math.abs(x) <= 0.95;
  };
  const th = e => Math.max(0, Math.min(cap, Math.max(0, e.phi.palm - Math.atan(aim * T) / D2R), e.phi.helmLo + Math.atan(guard * T) / D2R));
  const ch = rows.filter(e => e.ph >= PH.cock0 && e.ph < PH.slam0), hd = rows.filter(e => e.ph >= PH.cock1 && e.ph < PH.slam0);
  const anyC = e => ['wrist', 'palm', 'hinge', 'tip'].some(k => inAfter(e, k, th(e)));
  return { clawCH: Math.round(100 * ch.filter(anyC).length / ch.length), clawHold: Math.round(100 * hd.filter(anyC).length / hd.length),
    palmCH: Math.round(100 * ch.filter(e => inAfter(e, 'palm', th(e))).length / ch.length), tiltMax: +Math.max(...ch.map(th)).toFixed(1) };
}

// ---- FRAMING: the blows at each spot ----
if (MODE === 'framing' || MODE === 'all') {
  const setup = await c.ev(`(async () => {
    const L = window.__sl, B = window.__bench, X = window.__ccp;
    await B.setup('z0b');
    window.__lev.cmd('wake');
    B.step(60 * 9);
    X.place(24, 0);
    let k = 0;
    B.step(60 * 12, i => { X.keep(); if (i % 30 === 0) X.place(24, 0); k = i; if (i > 200 && L.threatE > 0.99 && L.hamPh > 0.02 && L.hamPh < 0.05) return false; });
    if (!L.hold) window.__lev.cmd('hold');
    return { k, hold: L.hold, threatE: +L.threatE.toFixed(3), ph: +L.hamPh.toFixed(3), R: L.R, pos: L.pos.toArray().map(v => +v.toFixed(2)), yaw: +L.yaw.toFixed(3) };
  })()`);
  console.log('setup', JSON.stringify(setup));
  summary.setup = setup;
  summary.spots = [];
  const allRows = {};
  for (const [D, side] of SPOTS) {
    const rows = await c.ev(`(async () => {
      const L = window.__sl, B = window.__bench, X = window.__ccp;
      X.place(${D}, ${side});
      // settle at least 1.5 s, then start on a cock's first frame
      let n = 0, prev = L.hamPh;
      B.step(600, () => { X.keep(); n++; const go = n > 90 && prev < ${PH.cock0} && L.hamPh >= ${PH.cock0}; prev = L.hamPh; if (go) return false; }, { render: true });
      const out = [X.row()];
      B.step(2 * 156 + 6, () => { X.keep(); out.push(X.row()); }, { render: true });
      return out;
    })()`);
    allRows[`${D},${side}`] = rows;
    const ch = rows.filter(e => e.ph >= PH.cock0 && e.ph < PH.slam0), hd = rows.filter(e => e.ph >= PH.cock1 && e.ph < PH.slam0);
    const palmIn = ch.filter(e => inF(e.palm)).length, tipIn = ch.filter(e => inF(e.tip)).length;
    // the claw on screen: any of the wrist, palm, finger hinge or dactyl tip in frame
    const anyC = e => inF(e.wrist) || inF(e.palm) || inF(e.hinge) || inF(e.tip);
    const clawIn = ch.filter(anyC).length, clawInHold = hd.filter(anyC).length;
    // Sal: the bonnet's centre AND its lowest point both in frame
    const helmIn = rows.filter(e => inF(e.helm) && inF(e.helmLo)).length;
    // settle: from 0.4 s (24 frames) after each landing to the next cock, |pitch - pre| <= 0.5 deg
    const lands = rows.map((e, i) => i > 0 && rows[i - 1].ph < PH.slam1 && e.ph >= PH.slam1 ? i : -1).filter(i => i >= 0);
    let settleMax = 0, settle03 = 0;
    for (const li of lands) for (let i = li; i < rows.length && !(rows[i].ph >= PH.cock0 && rows[i].ph < PH.slam1 && i > li + 30); i++) {
      const d = Math.abs(rows[i].pitch - rows[i].pre);
      if (i >= li + 24) settleMax = Math.max(settleMax, d);
      if (i >= li + 18) settle03 = Math.max(settle03, d);
    }
    const tilts = rows.map(e => e.tilt);
    const sp = { D, side, n: rows.length, cockHold: ch.length,
      palmIn: `${palmIn}/${ch.length}`, palmInPct: Math.round(100 * palmIn / Math.max(1, ch.length)), tipIn: `${tipIn}/${ch.length}`,
      clawIn: `${clawIn}/${ch.length}`, clawInPct: Math.round(100 * clawIn / Math.max(1, ch.length)), clawInHoldPct: Math.round(100 * clawInHold / Math.max(1, hd.length)),
      helmIn: `${helmIn}/${rows.length}`, helmInPct: +(100 * helmIn / rows.length).toFixed(1),
      helmYmin: r2(Math.min(...rows.map(e => e.helm[1]))), helmLoYmin: r2(Math.min(...rows.map(e => e.helmLo[1]))),
      palmYhold: [r2(Math.min(...rows.filter(e => e.ph >= PH.cock1 && e.ph < PH.slam0).map(e => e.palm[1]))), r2(Math.max(...rows.filter(e => e.ph >= PH.cock1 && e.ph < PH.slam0).map(e => e.palm[1])))],
      tiltMaxDeg: r1(Math.max(...tilts) * 57.29578), settleMaxDeg: r2(settleMax), settle03Deg: r2(settle03),
      pitch: [r1(Math.min(...rows.map(e => e.pitch))), r1(Math.max(...rows.map(e => e.pitch)))],
      camD: [r2(Math.min(...rows.map(e => e.camD))), r2(Math.max(...rows.map(e => e.camD)))], creU: r2(Math.max(...rows.map(e => e.creU))),
      thE: [r2(Math.min(...rows.map(e => e.thE))), r2(Math.max(...rows.map(e => e.thE)))],
      ceiling: ceiling(rows, knobs && knobs.maxDeg || 25, knobs && knobs.aimY || 0.7, knobs ? -knobs.helmY : 0.92) };
    summary.spots.push(sp);
    console.log('spot', JSON.stringify(sp));
    const at = `${D} u ahead${side ? `, ${side} u left` : ''}`;
    asserts.push({ name: `SAL bonnet in frame, ${at}`, value: sp.helmIn, pass: helmIn === rows.length });
    asserts.push({ name: `SETTLE within 0.5 deg of on:0 from 0.4 s after landing, ${at}`, value: sp.settleMaxDeg, pass: settleMax <= 0.5 });
    if (isAt(BARS.gate, D, side)) asserts.push({ name: `GATE look-up exactly 0 (under her shell), ${at}`, value: `max ${Math.max(...tilts)}`, pass: tilts.every(v => v === 0) && rows.every(e => e.q.every((v, i) => v === e.qPre[i])) });
    if (isAt(BARS.claw, D, side)) {
      asserts.push({ name: `CLAW on screen >= ${BARS.clawHold}% of the hold, ${at}`, value: `${sp.clawInHoldPct}% (ceiling ${sp.ceiling.clawHold}%)`, pass: sp.clawInHoldPct >= BARS.clawHold });
      asserts.push({ name: `CLAW on screen >= ${BARS.clawCH}% of cock+hold, ${at}`, value: `${sp.clawInPct}% (ceiling ${sp.ceiling.clawCH}%)`, pass: sp.clawInPct >= BARS.clawCH });
    }
    if (isAt(BARS.palm, D, side)) asserts.push({ name: `PALM in frame >= ${BARS.palmCH}% of cock+hold, ${at}`, value: `${sp.palmInPct}% (ceiling ${sp.ceiling.palmCH}%)`, pass: sp.palmInPct >= BARS.palmCH });
  }
  writeFileSync(`${OUT}/clawcam-${TAG}.json`, JSON.stringify({ summary, rows: allRows }, null, 1));
}

writeFileSync(`${OUT}/clawcam-${TAG}-summary.json`, JSON.stringify(summary, null, 1));
for (const a of asserts) console.log(`${a.pass ? 'PASS' : 'FAIL'}  ${a.name}: ${a.value}`);
const cons = (await c.console()).filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (cons.length) console.log('CONSOLE', cons.slice(0, 5).join('\n'));
c.close();
stop();
process.exit(asserts.every(a => a.pass) ? 0 : 1);
