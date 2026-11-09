// THE RISE IN THE LENS PROBE (sandrise, 2026-10-31; card roadmap/velkath-sand-rise.md; game.js RISECAM / __risecam; Michael approved "yes do all
// three for the sand": the lens turns to her during the rise). POINTCAM's checks (pointcam-probe.mjs), keyed to the rise.
//   DRV_PORT=<own> node tools/bench/risecam-probe.mjs <engage|mouse|off|handback> <game port>
// Stepped on the PLUGGED clock (clockplug.mjs). Exit 0 pass | 1 a bar failed | 2 UNMEASURED | 3 a RED whose bar did NOT fail | 4 LOST | 5 a RED
// whose bar failed, as it must. JSON -> RC_OUT (default out/probe/risecam-<mode>-<tag>.json under the cwd).
// THE RISE (every mode, a fresh load): home, zone 0, her asleep and buried. RC_AT=anchor (default): Alt+6 (the harpoon's anchor) and REAL E (the
// wrench, the free, the wake 0.7 s later, the crack's shove); RC_AT=off: 12 u off her strip's edge on her sand side facing her centre, woken by
// lev.cmd('wake') (the pull's own onWake). Every frame from E (or the wake) to the wake + 9 s is booked in the step hook (after the frame's
// update): __risecam.state() (k, amt, why, off), the drawn camera.quaternion and the cue's qPre and whether all four components are equal (eq),
// the angle between them (dq, deg), the cue's aim point (state().aim) seen from the lens under each (thPre / th: deg off the forward; NDC),
// his bonnet (diver.helmGroup's own vertices, the Box3 centre) under each, L.cracked / hasStood / shedT, and the look input.
//   engage   kIn     k >= 0.9 on some frame within 1.8 s of the wake
//            close   on the frames with k >= 0.9: th < thPre on >= 90% and the mean (thPre - th) >= 0.3 x the mean thPre (it turns to her)
//            bonnet  on every frame with dq > 0.01: his bonnet in front and its drawn NDC |x|, |y| <= max(0.9, its qPre NDC + 0.005)
//            outside eq on every frame before the crack (L.cracked false) and on every frame after the cue's last k > 0 (bit for bit)
//            RED: RC_ON=0 (__risecam.knobs.on = 0): kIn and close must fail
//   mouse    the look input is REAL CDP mouse movement through player.js's handler with the pointer lock emulated (pointcam-probe's way; a
//            calibration move, or the input written as the handler writes it: booked `input`), landing 1.0 s after the wake (k > 0 on the frame
//            before it: the premise, else VOID). Two sessions:
//              six   one 48 px move (6.05 deg net): k 0 and eq on that same frame (why 'mouse'), and k 0 / eq on every frame after it to wake + 9 s
//              four  one 32 px move (4.03 deg net): k > 0 on the frame after it and the frames to wake + 2.5 s (a hand on the mouse is not a look)
//            RED: RC_RED=nodrop (__risecam.knobs.lookNet / lookPath 1e9): six's bars must fail
//   off      (A) __risecam.knobs.on = 0: eq on EVERY booked frame, and the rise ran (L.cracked); (B) the positive control on = 1: >= 1 frame
//            with k > 0 and every one of them !eq (VOID without one)
//            RED: RC_RED=on (A's bar judged on an on = 1 run): must fail
//   handback THE HAND-BACK: the first frame the cue's target goes to 0 from a drawn cue (tgt > 0 and k >= 0.1 on the frame before: the window's
//            close, or the near gate, or her gone): k halves (k <= 0.5 x its value the frame before) no sooner than 0.15 s and no later than
//            1.0 s after it (eased, not snapped: a critically damped wOut 3 halves in ~0.56 s), and the hand-back's own step (|amt step| x |the
//            held aim|) never more than 1.5 deg a frame in the 1.5 s after it. AMENDED A THIRD TIME (recorded, before this run): the event was
//            "why 'until' after k >= 0.9 / 0.5 / 0.3" and k <= 0.1 within 0.25-1.5 s; on the near-gated build the snap RED's k followed the
//            near gate's falling target down to 0.16 before the close (wOut 1e6 snaps k onto its target), so no premise held (VOID twice). AMENDED a second time, after the run on the near-gated build (recorded): as registered the step was the
//            drawn rotation's (dq, the angle between q and qPre), and it read 6.2 deg on one frame where the grounded lens LURCHED (his bonnet
//            under qPre moved 0.09 NDC in a frame, the lens pressed by her) and the bonnet keep (ptKeep, POINTCAM's rule) followed it: the guard,
//            not the hand-back. dq's step is booked beside it (maxStepDqDeg).
//            AMENDED after the first run (recorded): registered as k >= 0.9 before the close and k <= 0.1 within 1.0 s. The first GREEN-build run
//            (wOut 6) read kOut 0.63 s but a 2.64 deg step (a ~79 deg turn handed back at the spring's rate): the BUILD changed (wOut 6 -> 3,
//            ~1.3 s), so the window went to 1.5 s; the 1.5 deg step is unchanged. The snap RED's k sat at 0.86 on the frame before the close
//            (wOut 1e6 snaps k onto every dip of the under-gate's target), so a k >= 0.9 premise found no close (VOID): it reads >= 0.5
//            RED: RC_RED=snap (__risecam.knobs.wOut 1e6: the hand-back in a frame): must fail
//            look (L2, review of 2026-10-31: the mouse-look drop sat inside the window, so a real look DURING the hand-back left the cue easing
//            out): a second session, the hand-back found as above (premise: tgt 0 and k >= 0.1 on the frame before) and ONE 48 px move (6.05 deg
//            net, the mouse mode's `six`) landing 12 frames into it, k > 0 and tgt 0 on the frame before it (else VOID): k 0 and q === qPre on
//            that same frame, and k 0 / eq on every frame after it to wake + 9 s
//            RED: RC_RED=nolook (__risecam.knobs.lookNet / lookPath 1e9): look must fail. Only look is judged under it, and only eased under snap
// ENV: DRV_PORT (own; never 8777 / 8790 / 9419), RC_AT, RC_ON, RC_RED, RC_OUT, RC_TAG
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 9419].includes(P)) { console.error('risecam-probe: set DRV_PORT to a port of its own'); process.exit(2); }
const MODES = ['engage', 'mouse', 'off', 'handback'];
const [, , MODE, PORT] = process.argv;
if (!MODES.includes(MODE) || !/^\d+$/.test(PORT || '')) { console.error('usage: DRV_PORT=<own> node tools/bench/risecam-probe.mjs <' + MODES.join('|') + '> <game port>'); process.exit(2); }
const AT = process.env.RC_AT || 'anchor';
if (!['anchor', 'off'].includes(AT)) { console.error('RC_AT: anchor | off'); process.exit(2); }
const ON = process.env.RC_ON == null || process.env.RC_ON === '' ? null : +process.env.RC_ON;
const REDS = { mouse: { nodrop: ['six'] }, off: { on: ['bitid'] }, handback: { snap: ['eased'], nolook: ['look'] } };
const RED = process.env.RC_RED || '';
if (RED && !(REDS[MODE] && REDS[MODE][RED])) { console.error(`RC_RED: ${MODE} has ${REDS[MODE] ? Object.keys(REDS[MODE]).join(', ') : 'none'}`); process.exit(2); }
if (ON === 0 && MODE !== 'engage') { console.error('RC_ON=0 is engage\'s RED'); process.exit(2); }
const ONRED = MODE === 'engage' && ON === 0;
const PX = 0.0022, SECS = 9;
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join, dirname, resolve } = await import('node:path');
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-risecam-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, unmeasured, lost } = await import('./clockplug.mjs');
let chromeStarted = false;
process.on('exit', () => { if (chromeStarted) stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
const TAG = process.env.RC_TAG || AT + '-port' + PORT;
const OUT = resolve(process.env.RC_OUT || `out/probe/risecam-${MODE}${RED ? '-' + RED : ONRED ? '-on0' : ''}-${TAG}.json`);

await start('about:blank'); chromeStarted = true;
const c = await connect();
await c.send('Runtime.enable'); await c.send('Page.enable');
await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });

const INSTALL = `(async () => {
  const THREE = await import('three'), { camera, renderer } = await import('/src/core.js'), DV = await import('/src/entities/diver.js');
  const L = window.lev; if (!L || L.kind !== 'brooder' || !L.buried) return { err: 'no buried brooder' };
  const qi = new THREE.Quaternion(), w = new THREE.Vector3(), hbox = new THREE.Box3(), hc = new THREE.Vector3(), A = new THREE.Vector3(), D = 180 / Math.PI;
  const r3 = v => Math.round(v * 1000) / 1000, r6 = v => Math.round(v * 1e6) / 1e6;
  const view = (q, p) => { w.copy(p).sub(camera.position); const dl = w.length() || 1e-9; w.applyQuaternion(qi.copy(q).invert());
    const tf = Math.tan(camera.fov * Math.PI / 360), front = w.z < 0, iz = 1 / Math.max(1e-9, -w.z), cap = v => Math.max(-99, Math.min(99, v));
    return { ang: Math.acos(Math.max(-1, Math.min(1, -w.z / dl))) * D, x: cap(w.x * iz / (tf * camera.aspect)), y: cap(w.y * iz / tf), front }; };
  const R = window.__rcR = { S: [], inp: 0, wakeF: -1,
    row() {
      const RC = window.__risecam, st = RC ? RC.state() : null, q = camera.quaternion, qp = st ? st.qPre : q;
      const eq = q.x === qp.x && q.y === qp.y && q.z === qp.z && q.w === qp.w, dq = 2 * Math.acos(Math.min(1, Math.abs(q.dot(qp)))) * D;
      if (st) A.fromArray(st.aim); const vPre = view(qp, A), vPost = view(q, A);
      hbox.setFromObject(DV.diver.helmGroup, true); hbox.getCenter(hc); const vB = view(q, hc), vBp = view(qp, hc);
      if (R.wakeF < 0 && !L.dormant) R.wakeF = R.S.length;
      R.S.push({ k: st ? st.k : null, amt: st ? st.amt : null, aim: st ? Math.hypot(st.aimYawDeg, st.aimPitchDeg) : 0, why: st ? st.why : null, off: st ? st.off : null, tgt: st ? st.tgt : null, eq: eq ? 1 : 0, dq: r3(dq),
        thPre: r3(vPre.ang), th: r3(vPost.ang), ndc: [r3(vPost.x), r3(vPost.y)], bon: [r3(vB.x), r3(vB.y), vB.front ? 1 : 0], bonPre: [r3(vBp.x), r3(vBp.y)],
        cracked: L.cracked ? 1 : 0, stood: L.hasStood ? 1 : 0, shedT: r3(L.shedT || 0), dormant: L.dormant ? 1 : 0, inp: R.inp, pyaw: r6(window.player.yaw), net: st ? st.lookNetDeg : null });
      R.inp = 0;
    },
    step(n) { window.__bench.step(n, () => R.row()); return R.S.length; },
    lock() { const cv = renderer.domElement; Object.defineProperty(document, 'pointerLockElement', { get: () => cv, configurable: true }); document.dispatchEvent(new Event('pointerlockchange')); return !!cv; } };
  return { risecam: !!window.__risecam, R: L.R };
})()`;
const OFFPLACE = `(async () => { const T = await import('/src/world/terrain.js'); const L = window.lev, MD = L.mound, j = Math.round((L.sandSide > 0 ? 0 : 0.5) * MD.COLS) % MD.COLS;
  const ex = MD.P[j * 3], ez = MD.P[j * 3 + 2], cx = MD.bx, cz = MD.bz; let ux = ex - cx, uz = ez - cz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const x = ex + ux * 12, z = ez + uz * 12; window.__bench.place(x, z, Math.atan2(cx - x, cz - z), 0); window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0);
  return [+x.toFixed(2), +z.toFixed(2)]; })()`;

// one session: a fresh load, the knobs, the rise; pattern = px moves landing 1.0 s after the wake
async function session(knobs, pattern, atHb) {
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/?bench&playtest` });
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await sleep(1000);
  await plug(c);
  await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.weather.set(1, 0), window.__bench.step(30), 1)`);
  await c.until(`(window.__bench.step(10), !!(window.lev && window.lev.sculpted))`, 30000, 100);
  const ses = {};
  if (AT === 'anchor') { await c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit6',key:'6',altKey:true,bubbles:true})), window.dispatchEvent(new KeyboardEvent('keyup',{code:'Digit6',key:'6',altKey:true,bubbles:true})), window.__helm=true, window.__bench.step(60), 1)`); }
  else { ses.place = await c.ev(OFFPLACE); await c.ev(`(window.__bench.step(60), 1)`); }   // (the teleport's yaw leaks out of the cue's recent look)
  const ins = await c.ev(INSTALL);
  if (!ins || ins.err || !ins.risecam) throw new Error('install: ' + JSON.stringify(ins));
  if (knobs) await c.ev(`(Object.assign(window.__risecam.knobs, ${JSON.stringify(knobs)}), 1)`);
  ses.knobs = await c.ev(`JSON.parse(JSON.stringify(window.__risecam.knobs))`);
  if (pattern) {
    await c.ev(`window.__rcR.lock()`); const mx = 400, my = 300;
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my }); const y0 = await c.ev(`window.player.yaw`);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx + 10, y: my }); const y1 = await c.ev(`window.player.yaw`);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my }); const y2 = await c.ev(`window.player.yaw`);
    ses.calib = { d1: +(y1 - y0).toFixed(6), d2: +(y2 - y1).toFixed(6), want: -10 * PX };
    ses.input = Math.abs(y1 - y0 + 10 * PX) < 1e-6 && Math.abs(y2 - y1 - 10 * PX) < 1e-6 ? 'cdp' : 'direct';
    ses.mx = mx; ses.my = my;
    await c.ev(`(window.__bench.step(30), 1)`);   // (the calibration's look leaks out of the cue's recent look before the crack)
  }
  await c.ev(`(window.__helm = true, window.__bench.step(10), 1)`);
  if (AT === 'anchor') {
    await c.key('KeyE', true); await c.ev(`window.__rcR.step(2)`); await c.key('KeyE', false);
    if (!(await c.ev(`!!window.lev.harpoon.wrenching`))) throw new Error('real E did not start the wrench at the anchor');
  } else { await c.ev(`window.__rcR.step(1)`); await c.ev(`(window.__lev.cmd('wake'), 1)`); }
  for (let k = 0; k < 40; k++) { await c.ev(`window.__rcR.step(15)`); if (await c.ev(`window.__rcR.wakeF >= 0`)) break; }
  const wakeF = await c.ev(`window.__rcR.wakeF`); if (wakeF < 0) throw new Error('she did not wake');
  const end = wakeF + SECS * 60;
  if (pattern) {
    ses.inputF = wakeF + 60;
    if (atHb) {   // the hand-back's start (the frame the target goes to 0 from a drawn cue), then 12 frames into it
      const HB = `(() => { const S = window.__rcR.S; for (let i = 1; i < S.length; i++) if (S[i].tgt === 0 && S[i - 1].tgt > 0 && S[i - 1].k >= 0.1) return i; return -1; })()`;
      let hb = -1;
      while (hb < 0 && (await c.ev(`window.__rcR.S.length`)) < wakeF + SECS * 60 - 90) { await c.ev(`window.__rcR.step(4)`); hb = await c.ev(HB); }
      if (hb < 0) throw new Error('look: no hand-back found to put the look into');
      ses.hbF = hb; ses.inputF = hb + 12;
    }
    while ((await c.ev(`window.__rcR.S.length`)) < ses.inputF) await c.ev(`window.__rcR.step(1)`);
    for (const px of pattern) {
      if (ses.input === 'cdp') { ses.mx += px; await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ses.mx, y: ses.my }); }
      else await c.ev(`(window.player.yaw -= ${px * PX}, 1)`);
      await c.ev(`(window.__rcR.inp = ${px}, window.__rcR.step(1), 1)`);
    }
  }
  while ((await c.ev(`window.__rcR.S.length`)) < end) await c.ev(`window.__rcR.step(30)`);
  ses.S = await c.ev(`window.__rcR.S`); ses.wakeF = wakeF;
  ses.clock = await drift(c);
  return ses;
}

const out = { mode: MODE, at: AT, red: RED || (ONRED ? 'on0' : null), sessions: {}, bars: {} };
const bars = out.bars;
const bar = (name, ok, val, text) => { bars[name] = { ok: ok === null ? null : !!ok, val, text }; console.log(`  ${ok === null ? 'VOID' : ok ? 'ok  ' : 'FAIL'} (${name}) ${JSON.stringify(val)} (bar ${text})`); };
const clocks = [];
try {
  if (MODE === 'engage') {
    const s = await session(ONRED ? { on: 0 } : null, null); out.sessions.engage = s; clocks.push(s.clock);
    const S = s.S, w = s.wakeF, eng = S.filter(r => r.k >= 0.9);
    const kInF = S.findIndex((r, i) => i >= w && i <= w + 108 && r.k >= 0.9);
    bar('kIn', kInF >= 0, { kInS: kInF >= 0 ? +((kInF - w) / 60).toFixed(3) : null, kMax: Math.max(...S.map(r => r.k || 0)) }, 'k >= 0.9 within 1.8 s of the wake');
    const closer = eng.filter(r => r.th < r.thPre).length, mPre = eng.length ? eng.reduce((a, r) => a + r.thPre, 0) / eng.length : 0, mDrop = eng.length ? eng.reduce((a, r) => a + (r.thPre - r.th), 0) / eng.length : 0;
    bar('close', eng.length ? closer >= 0.9 * eng.length && mDrop >= 0.3 * mPre : false, { n: eng.length, closer, meanThPre: +mPre.toFixed(2), meanDrop: +mDrop.toFixed(2) }, 'k >= 0.9 frames: th < thPre on >= 90%, mean (thPre - th) >= 0.3 x mean thPre');
    const bad = S.filter(r => r.dq > 0.01 && !(r.bon[2] && Math.abs(r.bon[0]) <= Math.max(0.9, Math.abs(r.bonPre[0]) + 0.005) && Math.abs(r.bon[1]) <= Math.max(0.9, Math.abs(r.bonPre[1]) + 0.005)));
    if (!ONRED) bar('bonnet', S.some(r => r.dq > 0.01) ? bad.length === 0 : null, { frames: S.filter(r => r.dq > 0.01).length, bad: bad.length, first: bad[0] || null }, 'his bonnet in frame (NDC <= max(0.9, its qPre NDC + 0.005)) on every turned frame');
    const lastK = S.reduce((a, r, i) => r.k > 0 ? i : a, -1), pre = S.filter(r => !r.cracked), post = lastK >= 0 ? S.slice(lastK + 1) : [];
    if (!ONRED) bar('outside', pre.length && post.length ? pre.every(r => r.eq) && post.every(r => r.eq) : null, { pre: pre.length, preEq: pre.filter(r => r.eq).length, post: post.length, postEq: post.filter(r => r.eq).length }, 'q === qPre on every frame before the crack and after the cue');
  } else if (MODE === 'mouse') {
    const kn = RED === 'nodrop' ? { lookNet: 1e9, lookPath: 1e9 } : null;
    const six = await session(kn, [48]); out.sessions.six = { ...six, S: undefined, rows: six.S.slice(six.inputF - 3, six.inputF + 5) }; clocks.push(six.clock);
    const f = six.inputF, S = six.S, prem = S[f - 1] && S[f - 1].k > 0;
    const after = S.slice(f);
    bar('six', prem ? S[f].k === 0 && S[f].eq === 1 && after.every(r => r.k === 0 && r.eq === 1) : null, { premiseK: S[f - 1] ? S[f - 1].k : null, atK: S[f] ? S[f].k : null, atWhy: S[f] ? S[f].why : null, atEq: S[f] ? S[f].eq : null, laterOn: after.filter(r => r.k > 0).length, input: six.input }, 'a 48 px move (6 deg): k 0 and q === qPre that frame and every frame after');
    if (!RED) {
      const four = await session(null, [32]); out.sessions.four = { ...four, S: undefined, rows: four.S.slice(four.inputF - 3, four.inputF + 5) }; clocks.push(four.clock);
      const g = four.inputF, T = four.S, pr = T[g - 1] && T[g - 1].k > 0, win = T.slice(g + 1, four.wakeF + 150);
      bar('four', pr ? win.length > 0 && win.every(r => r.k > 0) : null, { premiseK: T[g - 1] ? T[g - 1].k : null, frames: win.length, offFrames: win.filter(r => !(r.k > 0)).length, input: four.input }, 'a 32 px move (4 deg): k > 0 after it to wake + 2.5 s');
    }
  } else if (MODE === 'off') {
    const A = await session(RED === 'on' ? null : { on: 0 }, null); out.sessions.A = { ...A, S: undefined, n: A.S.length }; clocks.push(A.clock);
    bar('bitid', A.S.some(r => r.cracked) ? A.S.every(r => r.eq === 1) : null, { frames: A.S.length, eq: A.S.filter(r => r.eq).length, cracked: A.S.filter(r => r.cracked).length }, 'knobs.on 0: q === qPre on every frame of the rise');
    if (!RED) {
      const B = await session(null, null); clocks.push(B.clock);
      const on = B.S.filter(r => r.k > 0);
      bar('control', on.length ? on.every(r => r.eq === 0) : null, { kFrames: on.length, neq: on.filter(r => !r.eq).length }, 'on 1: >= 1 frame with k > 0, and q !== qPre on every one');
    }
  } else {
    const kn = RED === 'snap' ? { wOut: 1e6 } : null;
    if (RED !== 'nolook') {
    const s = await session(kn, null); out.sessions.hb = { ...s, S: undefined }; clocks.push(s.clock);
    const S = s.S, hb = S.findIndex((r, i) => i > 0 && r.tgt === 0 && S[i - 1].tgt > 0 && S[i - 1].k >= 0.1);
    let kOut = -1; if (hb >= 0) for (let i = hb; i < S.length; i++) if (S[i].k <= 0.5 * S[hb - 1].k) { kOut = i; break; }
    // the hand-back's own pace: the eased share times the held aim (|amt step| x |aim|); the drawn rotation's step (dq, with the bonnet keep
    // following the grounded lens's own lurch) is booked beside it
    let step = 0, stepDq = 0; if (hb >= 0) for (let i = hb + 1; i < Math.min(S.length, hb + 90); i++) { step = Math.max(step, Math.abs(S[i].amt - S[i - 1].amt) * S[i].aim); stepDq = Math.max(stepDq, Math.abs(S[i].dq - S[i - 1].dq)); }
    out.sessions.hb.rows = hb >= 0 ? S.slice(hb - 2, hb + 60) : []; out.sessions.hb.kSeries = S.map(r => [r.k, r.why]);
    bar('eased', hb >= 0 && kOut >= 0 ? (kOut - hb) / 60 >= 0.15 && (kOut - hb) / 60 <= 1.0 && step <= 1.5 : null, { hbS: hb >= 0 ? +((hb - s.wakeF) / 60).toFixed(3) : null, why: hb >= 0 ? S[hb].why : null, k0: hb >= 0 ? S[hb - 1].k : null, kHalfS: kOut >= 0 ? +((kOut - hb) / 60).toFixed(3) : null, maxStepDeg: +step.toFixed(3), maxStepDqDeg: +stepDq.toFixed(3) }, 'from the target\'s drop to 0, k halves in 0.15-1.0 s and the hand-back steps <= 1.5 deg a frame');
    }
    if (RED !== 'snap') {   // L2: a real look during the hand-back (the pattern lands 12 frames into it)
      const lk = await session(RED === 'nolook' ? { lookNet: 1e9, lookPath: 1e9 } : null, [48], true); out.sessions.look = { ...lk, S: undefined, rows: lk.S.slice(lk.inputF - 3, lk.inputF + 5) }; clocks.push(lk.clock);
      const f = lk.inputF, T = lk.S, prem = T[f - 1] && T[f - 1].k > 0 && T[f - 1].tgt === 0, aft = T.slice(f);
      bar('look', prem ? T[f].k === 0 && T[f].eq === 1 && aft.every(r => r.k === 0 && r.eq === 1) : null, { hbF: lk.hbF - lk.wakeF, inputF: f - lk.wakeF, premiseK: T[f - 1] ? T[f - 1].k : null, premiseTgt: T[f - 1] ? T[f - 1].tgt : null, atK: T[f] ? T[f].k : null, atWhy: T[f] ? T[f].why : null, atEq: T[f] ? T[f].eq : null, laterOn: aft.filter(r => r.k > 0).length, laterNeq: aft.filter(r => !r.eq).length, input: lk.input }, 'a 48 px move (6 deg) 12 frames into the hand-back: k 0 and q === qPre on that frame and every later one');
    }
  }
} catch (e) { console.log('UNMEASURED: ' + (e && e.message || e)); c.close(); process.exit(2); }
out.clocks = clocks;
console.log('clock ' + JSON.stringify(clocks));
mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(out));
c.close();
if (clocks.some(unmeasured)) { console.log('UNMEASURED (clock)'); process.exit(2); }
if (clocks.some(lost)) { console.log('CLOCK LOST'); process.exit(4); }
if (RED || ONRED) {
  const mine = ONRED ? ['kIn', 'close'] : REDS[MODE][RED], failed = mine.filter(b => bars[b] && bars[b].ok === false);
  console.log(failed.length === mine.length ? `RED ${out.red}: ${failed.join(', ')} FAILED, as it must (exit 5)` : `RED ${out.red}: ${mine.filter(b => !failed.includes(b)).join(', ')} did NOT fail (exit 3)`);
  console.log('JSON ' + OUT); process.exit(failed.length === mine.length ? 5 : 3);
}
const fails = Object.entries(bars).filter(([, v]) => v.ok === false).map(([k]) => k), voids = Object.entries(bars).filter(([, v]) => v.ok === null).map(([k]) => k);
console.log(fails.length ? 'FAIL ' + fails.join(', ') : voids.length ? 'UNMEASURED ' + voids.join(', ') : 'PASS');
console.log('JSON ' + OUT);
process.exit(fails.length ? 1 : voids.length ? 2 : 0);
