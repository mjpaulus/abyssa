// THE POINT AND ITS LENS PROBE (velkath-buried-rock; spec docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md §3, the gate table's
// "The point" (Task 10) and "POINTCAM" (Task 11)). Michael: "actually can she turn and point to the void with her giant claw".
//   DRV_PORT=9540 node tools/bench/pointcam-probe.mjs <point|framing|mouse|off> <game port>
// Stepped on the PLUGGED clock (clockplug.mjs). Exit 0 pass | 1 a bar failed | 2 UNMEASURED | 3 a PC_RED whose bar did NOT fail | 4 LOST
// (clock drift) | 5 a PC_RED whose bar failed, as it must. JSON of every series judged -> PC_OUT (default
// ~/sc/.abyssa-wt/reviews/buried/pointcam-<mode>-<at>-<tag>.json).
//   point     (Task 10) Home, zone 0, window.survival.hose = 760 (velfix-gate's FP_HOSE: without the line canDescendTo(1) fails, survival.js
//             HOSE_REQ 640 against a fresh diver's 380, and the calm says "IT STILLS. YOU HAVE ... M OF LINE..." at once, never the rift line).
//             He is stood per PC_AT off her bed, she is woken (__lev.cmd('wake'), the pull's own onWake) and stepped to L.hasStood (else
//             UNMEASURED); he is stood per PC_AT again, off where she is NOW, and stepped (<= 8 s) until her front is within 10 deg of the
//             bearing to him (she turns to face him: the worst case for `back`); then __lev.cmd('calm') (brooder.js: every dark ward lit
//             through common.js lightWard on her next update). A build without the verb (the Task 9 head: L.cmd ignores an unknown name, and
//             L.calmNext is never a field) is calmed DIRECTLY: every unlit ward's g.lit set, so allLit holds on her next update (booked
//             calmBy 'verb' | 'direct'). Then 14 s stepped, booked per frame.
//               PC_AT=back (default; the worst case and the one the turn bar judges): 25 u from her centre along L.sand (her sand side), facing
//                 her. At home the opening, riftPos(0) (81.5, 83.9), is ~45 u from her bed (89.7, 39.1) at ~158 deg from L.sand: once she
//                 has turned to face him it is up to ~160 deg behind her front.
//               PC_AT=ahead: 25 u from her on the line toward the opening (her front is already about on it). If that spot is within APRON
//                 (14 u) of the crack's lip (fissureDist) he is pulled back along the line toward her until it is not (the crack opens at
//                 the calm: a man on its lip would fall through and, with 760 u of line, enterZone(1) would rebuild her under the booking).
//                 The distance used is booked (dHim).
//             THE OPENING, P: the probe's own, riftPos(0) at fissureShape.js lipMeanY(0) (never the build's L.pointAt alone: the code grading
//             itself); L.pointAt is booked beside it (pointAtD, its distance from P).
//             Booked per frame: L.pointPh, L.pointK (absent: 0), L.yaw, the bearing to P and her heading error to it (atan2 convention: her
//             front is (sin yaw, cos yaw)); her major claw's shoulder (claws[major].root, world), its palm (the pj / dj midpoint, world) and the
//             angle between shoulder->palm and shoulder->P; __fissure.k(0); the message log (__msg().live, booked on change; the calm line's
//             first frame); tears (window.__slamLog.length and survival.torn); L.walkTo set; L.keepShellN (the shell's keep engaging);
//             the lens bodyBlocked(lens, 0) (INFO: the base's lensfix residual, the camera follow-ups' card, never this mode's bar).
//             Bars (both placements unless named):
//               line   the calm line that showed is "ALL WARDS LIT. IT STILLS. A RIFT OPENS BELOW." (else UNMEASURED: the hose was not set)
//               turn   RE-REGISTERED 2026-10-21 on Michael's ruling ("1": she finishes turning at 0.5 rad/s, then points; the raise waits
//                      for her facing, even past the light and the line): her front within 12 deg of the bearing to P on the frame the
//                      raise starts (the first frame pointPh is 2; VOID when it never is), both placements. Her facing at the light is
//                      booked, not judged. (Was: back only, within 12 deg on the first frame __fissure.k(0) >= 0.6, at POINT.turn 0.5 rad/s:
//                      FAIL on b3e903f, -63.58 deg)
//               aim    the angle between shoulder->palm and shoulder->P <= 20 deg on every frame pointK >= 0.95 (>= 1 such frame, else VOID),
//                      both placements
//               hold   pointK >= 0.95 on ONE contiguous span of 2.5-3.5 s; at `ahead` (she already faces it) that span contains the frame
//                      the calm line first shows; at `back` the raise starts within 0.5 s (30 frames) of the first frame she faces the
//                      opening (|error| <= 12 deg), and not before it
//               tears  0 over the 14 s (slamLog and torn never rise)
//               walk   L.walkTo null on every frame with pointPh > 0, and set within 1.2 s (72 frames) of pointPh leaving 4 (VOID when
//                      pointPh never reached 4: the shipped calm's walkTo at the calm cannot pass it). AMENDED on the first GREEN run
//                      (t10-g1, before any change to the build for it): the walk home is L.walkTo OR L.homeTurn (its arrival stage). At her
//                      bed already (she hunts him from it: 0.00 u off at the calm in both placements) brooder.js's walk branch clears
//                      walkTo on the SAME update that set it (dist < 3 with toBed: homeTurn), so a per-frame read never sees walkTo (walkF
//                      -1 on a build that did walk home); homeTurn is booked beside it and both are held to null/false while pointPh > 0
//             VERDICT ORDER: a bar that FAILED on a real measurement is FAIL (exit 1) even if another is VOID; with no failure, any VOID is
//             exit 2; nothing vacuous ever passes. A RED judges only its own bars.
//   framing / mouse / off   POINTCAM (Task 11 adds them).
// PC_RED variants (each must fail ITS bar): nopoint (__burial.set({ point: 0 }): the claw never raises) -> hold.
// ENV (besides DRV_PORT, a port of this probe's own: never 8777 / 8790 / 9419; the probe exits 2 before importing drv.mjs):
//   PC_AT=back|ahead  the placement (point; default back)
//   PC_RED=<variant>  an opt-in RED (exit 5 when its bar failed, as it must; 3 when it did not)
//   PC_NOPLUG=1       the drift RED: plug(c, { stop: false }). It must print CLOCK LOST (exit 4)
//   PC_SHOTS=<prefix> stills: every frame of the 14 s RENDERED ({ render: true }) and __bench.capture({}) (frozen, settle 0: a settle's
//                     frames run outside __bench.step and would leak past the plug) at 2.0 s (the turn), 4.5 s (the claw up, the light, the
//                     line) and 7.6 s (the lower) after the calm -> ~/sc/.abyssa-wt/shots/buried/<prefix>-{turn,up,lower}.png. Gating runs
//                     are unrendered (the verdict is booked either way)
//   PC_OUT=<file>     the JSON; PC_TAG=<tag> (default port<port>)
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 9419].includes(P)) { console.error(`pointcam-probe: set DRV_PORT to a port of its own, an integer in 1024-65535 (not 8777 / 8790 / 9419; got ${JSON.stringify(process.env.DRV_PORT)})`); process.exit(2); }
const MODES = ['point', 'framing', 'mouse', 'off'], BUILT = ['point'];
const [, , MODE, PORT] = process.argv;
if (!MODES.includes(MODE) || !/^\d+$/.test(PORT || '')) { console.error('usage: DRV_PORT=<own> node tools/bench/pointcam-probe.mjs <' + MODES.join('|') + '> <game port>'); process.exit(2); }
if (!BUILT.includes(MODE)) { console.error(`pointcam-probe: mode ${MODE} is not built yet (Task 11 of the velkath-buried-rock plan adds it)`); process.exit(2); }
const REDS = { point: { nopoint: { set: { point: 0 }, bars: ['hold'] } } };
const RED = process.env.PC_RED || '';
if (RED && !(REDS[MODE] && REDS[MODE][RED])) { console.error(`PC_RED: mode ${MODE} has ${REDS[MODE] ? 'the variants ' + Object.keys(REDS[MODE]).join(', ') : 'no RED variant'} (got ${JSON.stringify(RED)})`); process.exit(2); }
const AT = process.env.PC_AT || 'back';
if (!['back', 'ahead'].includes(AT)) { console.error(`PC_AT: back | ahead (got ${JSON.stringify(AT)})`); process.exit(2); }
const SHOTS = process.env.PC_SHOTS || '';
if (SHOTS && !/^[\w.-]+$/.test(SHOTS)) { console.error(`PC_SHOTS: a plain file prefix (got ${JSON.stringify(SHOTS)})`); process.exit(2); }
const CALM_LINE = 'ALL WARDS LIT. IT STILLS. A RIFT OPENS BELOW.', HOSE = 760, SECS = 14, D_HIM = 25;
const SHOT_AT = [['turn', 2.0], ['up', 4.5], ['lower', 7.6]];

const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir, homedir } = await import('node:os');
const { join, dirname } = await import('node:path');
// a fresh profile (no save, no caches), the debug port refused if it is taken, only OUR Chrome ever stopped. DRV_PORT is checked above,
// before this dynamic import (a static import is hoisted above the check and drv.mjs's DBG would already have been 9419)
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-pointcam-probe-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, unmeasured, lost, CLOCK_LOST } = await import('./clockplug.mjs');
let chromeStarted = false;
process.on('exit', () => { if (chromeStarted) stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));

// where he stands (PC_AT), off where she is NOW: { x, z, yaw } and the bookings
const PLACE = `(async () => {
  const T = await import('/src/world/terrain.js'), S = await import('/src/world/fissureShape.js'), C = await import('/src/config.js');
  const L = window.lev; if (!L || L.kind !== 'brooder') return { err: 'no brooder (' + (L && L.kind) + ')' };
  const rp = C.riftPos(0);
  let ux, uz;
  if (${JSON.stringify(AT)} === 'back') { ux = L.sand.x; uz = L.sand.z; }
  else { ux = rp.x - L.pos.x; uz = rp.z - L.pos.z; }
  const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  let d = ${D_HIM}, x = L.pos.x + ux * d, z = L.pos.z + uz * d;
  while (d > 8 && S.fissureDist(x, z, 0) < S.APRON) { d -= 0.5; x = L.pos.x + ux * d; z = L.pos.z + uz * d; }
  window.__bench.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0);
  window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0);
  return { at: ${JSON.stringify(AT)}, him: [+x.toFixed(2), +z.toFixed(2)], her: [+L.pos.x.toFixed(2), +L.pos.z.toFixed(2)], dHim: d, fd: +S.fissureDist(x, z, 0).toFixed(2), apron: S.APRON };
})()`;

const INSTALL = `(async () => {
  const THREE = await import('three'), T = await import('/src/world/terrain.js'), S = await import('/src/world/fissureShape.js'), C = await import('/src/config.js');
  const BC = await import('/src/entities/sleeper/bodyCols.js'), { camera } = await import('/src/core.js');
  const L = window.lev; if (!L || L.kind !== 'brooder') return { err: 'no brooder' };
  const rp = C.riftPos(0), Pt = new THREE.Vector3(rp.x, S.lipMeanY(0, T.terrainH), rp.z);
  const c = L.claws.find(q => q.major); if (!c) return { err: 'no major claw' };
  const sh = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
  const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100, D = 180 / Math.PI;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const R = window.__pcR = { S: [], msgs: [], lineF: -1, calmF: -1, P: Pt,
    errTo(x, z) { return wrap(Math.atan2(x - L.pos.x, z - L.pos.z) - L.yaw); },
    row() {
      if (window.lev !== L) throw new Error('the sleeper was rebuilt under the booking');
      L.grp.updateMatrixWorld(true);
      c.root.getWorldPosition(sh); c.pj.getWorldPosition(pa); c.dj.getWorldPosition(pb); pa.add(pb).multiplyScalar(0.5);
      u.subVectors(pa, sh).normalize(); w.subVectors(Pt, sh).normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, u.dot(w)))) * D;
      const brg = Math.atan2(Pt.x - L.pos.x, Pt.z - L.pos.z), err = wrap(brg - L.yaw);
      const m = window.__msg ? window.__msg().live : '', last = R.msgs.length ? R.msgs[R.msgs.length - 1][1] : null;
      if (m !== last) R.msgs.push([R.S.length, m]);
      if (R.lineF < 0 && m === ${JSON.stringify(CALM_LINE)}) R.lineF = R.S.length;
      const cp = camera.position, sv = window.survival;
      R.S.push({ ph: L.pointPh || 0, k: r3(L.pointK || 0), yaw: r3(L.yaw), brg: r3(brg), err: r2(err * D), ang: r2(ang),
        sh: [r2(sh.x), r2(sh.y), r2(sh.z)], palm: [r2(pa.x), r2(pa.y), r2(pa.z)], fk: r3(window.__fissure ? window.__fissure.k(0) : -1),
        slam: window.__slamLog ? window.__slamLog.length : -1, torn: r3(sv ? sv.torn : -1), walk: L.walkTo ? 1 : 0, homeTurn: L.homeTurn ? 1 : 0,
        calmed: L.calmed ? 1 : 0, keepN: L.keepShellN || 0, threatE: r3(L.threatE), standE: r3(L.standE), pos: [r2(L.pos.x), r2(L.pos.z)],
        hd: r2(Math.hypot(window.player.pos.x - L.pos.x, window.player.pos.z - L.pos.z)), lift: r3(c.liftNow || 0), elbow: r3(c.elbow || 0),
        lensBlk: BC.bodyBlocked(cp.x, cp.y, cp.z, 0) ? 1 : 0, zone: window.zone });
    },
    step(n, o) { window.__bench.step(n, () => R.row(), o); return R.S.length; },
    // turn to face him: stepped until her heading error to him is <= 10 deg (or max frames); returns the frames used
    face(max) { let n = 0; window.__bench.step(max, () => { n++; const p = window.player.pos; return Math.abs(R.errTo(p.x, p.z)) * D > 10; }); return n; },
    state() { const p = window.player.pos, e = R.errTo(Pt.x, Pt.z) * D;
      return { errOpen: r2(e), errHim: r2(R.errTo(p.x, p.z) * D), hd: r2(Math.hypot(p.x - L.pos.x, p.z - L.pos.z)), threatE: r3(L.threatE), hamPh: L.hamPh ?? null,
        pos: [r2(L.pos.x), r2(L.pos.z)], yaw: r3(L.yaw), calmed: !!L.calmed, standE: r3(L.standE), slam: window.__slamLog ? window.__slamLog.length : -1,
        fdHer: r2(S.fissureDist(L.pos.x, L.pos.z, 0)), fdHim: r2(S.fissureDist(p.x, p.z, 0)) }; },
    calm() {
      window.__lev.cmd('calm');
      if ('calmNext' in L) return 'verb';
      for (const g of L.sigils) if (!g.lit) { g.lit = true; g.rev = 1; }
      return 'direct';
    } };
  return { R: L.R, P: [r2(Pt.x), r2(Pt.y), r2(Pt.z)], pointAt: L.pointAt ? [r2(L.pointAt.x), r2(L.pointAt.y), r2(L.pointAt.z)] : null, major: L.claws.indexOf(c),
    pointKnown: 'pointPh' in L, sand: [r3(L.sand.x), r3(L.sand.z)], bed: L.lairPos ? [r2(L.lairPos.x), r2(L.lairPos.z)] : null };
})()`;

// ---- boot: about:blank, the domains on, the focus a player's window has, then the game ----
try { const r = await fetch(`http://127.0.0.1:${P}/json/version`, { signal: AbortSignal.timeout(2000) });
  console.error(`the debug port ${P} already answers /json/version (HTTP ${r.status}): not starting, nothing touched`); process.exit(2); }
catch (e) { if (!(e && e.cause && e.cause.code === 'ECONNREFUSED')) { console.error(`the debug port ${P} is not free (${e && e.name}: ${e && e.cause && e.cause.code || e && e.message}): not starting, nothing touched`); process.exit(2); } }
const TAG = process.env.PC_TAG || 'port' + PORT;
const OUT = process.env.PC_OUT || join(homedir(), 'sc/.abyssa-wt/reviews/buried', `pointcam-${MODE}-${AT}-${TAG}.json`);
const SHOT_DIR = join(homedir(), 'sc/.abyssa-wt/shots/buried');
const record = { mode: MODE, at: AT, port: +PORT, tag: TAG, red: RED || null, noplug: process.env.PC_NOPLUG === '1', shots: SHOTS || null };
const finish = (code, why) => {
  record.exit = code; if (why) record.why = why;
  try { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(record, null, 1)); console.log('JSON ' + OUT); } catch (e) { console.error('could not write ' + OUT + ': ' + e.message); }
  process.exit(code);
};
const URL0 = `http://localhost:${PORT}/?bench&playtest`;
let c = null;
try {
  chromeStarted = true;
  await start('about:blank');
  c = await connect();
  await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const tNav = Date.now();
  await c.send('Page.navigate', { url: URL0 });
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
  console.log(`pointcam-probe ${MODE} ${AT}${RED ? ' RED ' + RED : ''}${record.noplug ? ' NOPLUG' : ''}${SHOTS ? ' SHOTS ' + SHOTS : ''} ${URL0} (fresh profile): loaded in ${((Date.now() - tNav) / 1000).toFixed(1)} s`);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await sleep(1000);
} catch (e) {
  const why = String(e && e.message || e);
  console.error('UNMEASURED: boot: ' + why);
  try { if (c) c.close(); } catch (e2) { }
  finish(2, 'boot: ' + why);
}

let out = null, fatal = null;
try {
  await plug(c, { stop: !record.noplug });
  await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.__bench.step(30), window.survival.hose = ${HOSE}, 1)`);
  record.build = await c.ev(`!!(window.__burial && window.__burial.set) ? 'burial' : 'main'`);
  if (RED) {
    if (record.build !== 'burial') throw new Error(`PC_RED ${RED} patches __burial.set, absent on this build`);
    await c.ev(`(await window.__burial.set(${JSON.stringify(REDS[MODE][RED].set)}), window.__bench.step(30), window.survival.hose = ${HOSE}, 1)`);
    record.patch = REDS[MODE][RED].set;
  }
  const pl0 = await c.ev(PLACE);
  if (!pl0 || pl0.err) throw new Error('place (bed): ' + (pl0 && pl0.err));
  const ins = await c.ev(INSTALL);
  if (!ins || ins.err) throw new Error('install: ' + (ins && ins.err));
  console.log(`placed ${JSON.stringify(pl0)}; ${JSON.stringify(ins)}`);
  // the wake, to her stand
  const wk = await c.ev(`(window.__lev.cmd('wake'), { dormant: !!window.lev.dormant, hasStoodKnown: 'hasStood' in window.lev })`);
  if (!wk.hasStoodKnown) throw new Error('no L.hasStood on this build');
  let stoodF = -1;
  for (let k = 0; k < 40 && stoodF < 0; k++) { await c.ev(`window.__bench.step(30)`); if (await c.ev(`!!window.lev.hasStood`)) stoodF = (k + 1) * 30; }
  if (stoodF < 0) throw new Error('she did not stand within 20 s of the wake');
  // him per PC_AT off where she is now; she turns to face him
  const pl = await c.ev(PLACE);
  if (!pl || pl.err) throw new Error('place: ' + (pl && pl.err));
  const faceF = await c.ev(`window.__pcR.face(480)`);
  const pre = await c.ev(`window.__pcR.state()`);
  console.log(`stood ${(stoodF / 60).toFixed(2)} s after the wake; placed ${JSON.stringify(pl)}; faced him in ${faceF} frames: ${JSON.stringify(pre)}`);
  // the calm, and 14 s
  const calmBy = await c.ev(`window.__pcR.calm()`);
  const shots = [];
  const N = SECS * 60;
  let at = 0;
  for (const [name, s] of SHOTS ? SHOT_AT : []) {
    const f = Math.round(s * 60);
    await c.ev(`window.__pcR.step(${f - at}, { render: true })`); at = f;
    const url = await c.ev(`(async () => window.__bench.png(await window.__bench.capture({}), 1))()`);
    const file = join(SHOT_DIR, `${SHOTS}-${name}.png`);
    mkdirSync(SHOT_DIR, { recursive: true }); writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    shots.push({ name, s, file, row: await c.ev(`window.__pcR.S[window.__pcR.S.length - 1]`) });
    console.log(`still ${file} at ${s} s`);
  }
  while (at < N) { const n = Math.min(300, N - at); await c.ev(`window.__pcR.step(${n}${SHOTS ? ', { render: true }' : ''})`); at += n; }
  out = { place0: pl0, ins, stoodF, place: pl, faceF, pre, calmBy, shots,
    S: await c.ev(`window.__pcR.S`), msgs: await c.ev(`window.__pcR.msgs`), lineF: await c.ev(`window.__pcR.lineF`),
    pointPose: await c.ev(`window.lev.pointPose ? Array.from(window.lev.pointPose) : null`),
    pointAt: await c.ev(`window.lev.pointAt ? window.lev.pointAt.toArray() : null`),
    knobs: await c.ev(`(async () => { try { const B = await import('/src/entities/sleeper/brooder.js'); return B.POINT ? Object.assign({}, B.POINT) : null; } catch (e) { return null; } })()`) };
} catch (e) { fatal = String(e && e.message || e); }
const clock = c ? await drift(c).catch(() => null) : null;
record.clock = clock;
const cons = c ? (await c.console().catch(() => [])).filter(l => /error|EXC/i.test(l) && !/favicon/i.test(l)) : [];
record.consoleErrors = cons;
if (c) c.close();

// ---- the verdicts: UNMEASURED (2) and LOST (4) come before any bar ----
if (fatal) { console.error('UNMEASURED: ' + fatal); finish(2, 'throw: ' + fatal); }
if (!out) { console.error('UNMEASURED: no reading'); finish(2, 'no reading'); }
Object.assign(record, out);
if (record.noplug) {
  if (unmeasured(clock)) { console.error('UNMEASURED: PC_NOPLUG: no numeric drift'); finish(2, 'noplug: no drift'); }
  if (lost(clock)) { console.log(`CLOCK LOST (PC_NOPLUG, as it must): ${JSON.stringify(clock)}`); finish(4, 'clock lost (noplug RED)'); }
  console.error(`PC_NOPLUG: the clock did NOT drift past ${CLOCK_LOST} s: ${JSON.stringify(clock)}`); finish(3, 'noplug RED held');
}
if (unmeasured(clock)) { console.error('UNMEASURED: no clock reading'); finish(2, 'no clock'); }
if (lost(clock)) { console.log(`CLOCK LOST: ${JSON.stringify(clock)} (the bar is ${CLOCK_LOST} s)`); finish(4, 'clock lost'); }

const S = out.S, D = 180 / Math.PI;
const calmLines = out.msgs.filter(m => /STILLS/.test(m[1] || ''));
const lineShown = calmLines.length ? calmLines[0][1] : null;
record.lineShown = lineShown;
console.log(`calm by ${out.calmBy}; messages ${JSON.stringify(out.msgs)}`);
if (lineShown !== CALM_LINE) { console.error(`UNMEASURED: the calm line that showed is ${JSON.stringify(lineShown)}, not "${CALM_LINE}" (the hose was not set)`); finish(2, 'line'); }
if (S.some(r => r.zone !== 0)) { console.error('UNMEASURED: he left zone 0 under the booking'); finish(2, 'zone'); }
const lineF = out.lineF;
// the light: the first frame __fissure.k(0) >= 0.6
const lightF = S.findIndex(r => r.fk >= 0.6);
// the raise's first frame (pointPh 2) and the first frame she faces the opening (|err| <= 12 deg)
const raiseF = S.findIndex(r => r.ph === 2), faceOpenF = S.findIndex(r => Math.abs(r.err) <= 12);
// the hold: frames with pointK >= 0.95, and whether they are one contiguous span
const up = S.map((r, i) => r.k >= 0.95 ? i : -1).filter(i => i >= 0);
const contiguous = up.length > 0 && up[up.length - 1] - up[0] + 1 === up.length;
const span = up.length ? +(up.length / 60).toFixed(3) : 0;
const angs = up.map(i => S[i].ang), angMax = angs.length ? Math.max(...angs) : null;
// the lower's end: the first frame pointPh goes from 4 to 0; the walk home's first frame after it
const endF = S.findIndex((r, i) => i > 0 && S[i - 1].ph === 4 && r.ph === 0);
const walkF = endF >= 0 ? S.findIndex((r, i) => i >= endF && (r.walk || r.homeTurn)) : -1;
const walkDuring = S.filter(r => r.ph > 0 && (r.walk || r.homeTurn)).length;
const slam0 = S.length ? S[0].slam : 0, torn0 = S.length ? S[0].torn : 0;
const slamN = S.length ? Math.max(...S.map(r => r.slam)) - slam0 : 0, tornUp = S.length ? +(Math.max(...S.map(r => r.torn)) - torn0).toFixed(3) : 0;
const yawAt = i => i >= 0 && i < S.length ? S[i].yaw : null;
const travel = up.length ? +(Math.abs(Math.atan2(Math.sin(S[up[up.length - 1]].yaw - S[up[0]].yaw), Math.cos(S[up[up.length - 1]].yaw - S[up[0]].yaw))) * D).toFixed(2) : null;
record.book = { raiseF, raiseS: raiseF >= 0 ? +(raiseF / 60).toFixed(3) : null, faceOpenF, faceOpenS: faceOpenF >= 0 ? +(faceOpenF / 60).toFixed(3) : null, errAtRaise: raiseF >= 0 ? S[raiseF].err : null, calmBy: out.calmBy, errAtCalm: out.pre.errOpen, errHimAtCalm: out.pre.errHim, errAtLight: lightF >= 0 ? S[lightF].err : null, lightF, lightS: lightF >= 0 ? +(lightF / 60).toFixed(3) : null,
  lineF, lineS: lineF >= 0 ? +(lineF / 60).toFixed(3) : null, upF: up.length ? [up[0], up[up.length - 1]] : null, upS: up.length ? [+(up[0] / 60).toFixed(3), +(up[up.length - 1] / 60).toFixed(3)] : null,
  span, contiguous, angMax, angAtUp: up.length ? S[up[0]].ang : null, yawTravelHold: travel, errOverHold: up.length ? [Math.min(...up.map(i => S[i].err)), Math.max(...up.map(i => S[i].err))] : null,
  endF, walkF, walkDuring, slamN, tornUp, keepN: S.length ? S[S.length - 1].keepN - S[0].keepN : 0, keepDuringPoint: S.filter((r, i) => i > 0 && r.ph > 0 && r.keepN > S[i - 1].keepN).length,
  lensBlk: S.filter(r => r.lensBlk).length, lensBlkPoint: S.filter(r => r.lensBlk && r.ph > 0).length, maxLift: S.length ? Math.max(...S.map(r => r.lift)) : null,
  pointPose: out.pointPose, pointAt: out.pointAt, P: out.ins.P, pointAtD: out.pointAt ? +Math.hypot(out.pointAt[0] - out.ins.P[0], out.pointAt[1] - out.ins.P[1], out.pointAt[2] - out.ins.P[2]).toFixed(3) : null,
  knobs: out.knobs, placed: out.place, faceF: out.faceF, pre: out.pre };
console.log(`POINT ${JSON.stringify(record.book)}`);
const ck = [
  { name: 'turn', val: raiseF >= 0 ? S[raiseF].err : null, bar: '|her heading error to P| <= 12 deg on the frame the raise starts (POINT.turn ' + (out.knobs ? out.knobs.turn : '?') + ' rad/s)', ok: raiseF >= 0 && Math.abs(S[raiseF].err) <= 12, vacuous: raiseF < 0, judged: true },
  { name: 'aim', val: angMax, bar: 'shoulder->palm vs shoulder->P <= 20 deg on every frame pointK >= 0.95', ok: angMax != null && angMax <= 20, vacuous: !up.length, judged: true },
  { name: 'hold', val: { span, contiguous, upS: record.book.upS, lineS: record.book.lineS, raiseS: record.book.raiseS, faceOpenS: record.book.faceOpenS },
    bar: 'pointK >= 0.95 on one contiguous span of 2.5-3.5 s; ' + (AT === 'ahead' ? 'containing the calm line\'s first frame' : 'the raise starting 0-30 frames after she first faces the opening'),
    ok: contiguous && span >= 2.5 && span <= 3.5 && (AT === 'ahead' ? lineF >= up[0] && lineF <= up[up.length - 1] : raiseF >= 0 && faceOpenF >= 0 && raiseF - faceOpenF >= 0 && raiseF - faceOpenF <= 30),
    vacuous: AT === 'ahead' ? lineF < 0 : false, judged: true },
  { name: 'tears', val: { slamN, tornUp }, bar: '0 tears over the 14 s', ok: slamN === 0 && tornUp <= 0, vacuous: !S.length, judged: true },
  { name: 'walk', val: { endF, walkF, dF: endF >= 0 && walkF >= 0 ? walkF - endF : null, walkDuring }, bar: 'walkTo / homeTurn null while pointPh > 0; set within 72 frames of pointPh leaving 4', ok: endF >= 0 && walkF >= 0 && walkF - endF <= 72 && walkDuring === 0, vacuous: endF < 0, judged: true }];
if (RED) for (const k of ck) k.judged = REDS[MODE][RED].bars.includes(k.name);
record.checks = ck;
for (const k of ck) console.log(`  ${k.judged ? (k.vacuous ? 'VOID' : k.ok ? 'ok  ' : 'FAIL') : 'info'} ${k.name.padEnd(6)} ${JSON.stringify(k.val)} (bar ${k.bar})`);
if (cons.length) console.error('console errors (booked, not part of the bar): ' + JSON.stringify(cons));
const J = ck.filter(k => k.judged), failed = J.filter(k => !k.vacuous && !k.ok), vac = J.filter(k => k.vacuous);
if (RED) {
  if (vac.length) { console.error(`UNMEASURED: PC_RED ${RED}: nothing booked for ${vac.map(k => k.name).join(', ')}`); finish(2, 'RED bars vacuous'); }
  if (failed.length === J.length) { console.log(`RED ${RED}: ${J.map(k => k.name).join(', ')} failed as it must: exit 5`); finish(5); }
  console.error(`RED ${RED} did not fail as written: exit 3`); finish(3, 'RED did not fail');
}
if (failed.length) { console.error('FAIL ' + failed.map(k => `${k.name} ${JSON.stringify(k.val)}`).join('; ') + (vac.length ? '; VOID ' + vac.map(k => k.name).join(', ') : '')); finish(1, 'failed: ' + failed.map(k => k.name).join(',')); }
if (vac.length) { console.error('UNMEASURED: nothing booked for ' + vac.map(k => k.name).join(', ')); finish(2, 'vacuous'); }
console.log('PASS'); finish(0);
