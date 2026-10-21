// THE POINT AND ITS LENS PROBE (velkath-buried-rock; spec docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md §3, the gate table's
// "The point" (Task 10) and "POINTCAM" (Task 11)). Michael: "actually can she turn and point to the void with her giant claw".
//   DRV_PORT=9540 node tools/bench/pointcam-probe.mjs <point|framing|mouse|off> <game port>
// Stepped on the PLUGGED clock (clockplug.mjs). Exit 0 pass | 1 a bar failed | 2 UNMEASURED | 3 a RED whose bar did NOT fail | 4 LOST
// (clock drift) | 5 a RED whose bar failed, as it must. JSON of every series judged -> PC_OUT (default
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
//               turnRate  (Task 11, the Task 10 review's M1: with the turn bar judged at the raise, a turn of any speed passes it) the most
//                      her heading moved in one frame while she turns (rows with pointPh 1), |dyaw| x 60 (dyaw booked UNROUNDED in the page:
//                      the row's yaw is rounded to 1e-3 rad, 0.06 rad/s at 60 fps), <= 0.5 + 0.005 rad/s: the PRE-REGISTERED 0.5 (the
//                      live POINT.turn is booked beside it, never the bar: a RED that patches the knob must not move its own bar). VOID
//                      when no row has pointPh 1. A stills run's row right after a capture is left out (booked `cap`): __bench.capture
//                      runs 25 frozen frames (dt 1e-4) between two booked frames, so that row's dyaw carries 2.5 ms more of her turn
//                      (+0.075 rad/s at 0.5: the t11-back stills run read 0.573 on the frame after its 3.5 s capture, 0.498 either side)
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
//             faceMax (the Task 10 review's M2): PC_RED=noface (PC_AT=back only) makes her facing unsatisfiable (POINT.face -1 deg) and
//             POINT.faceMax 4 s: the raise must come at faceMax all the same (booked INFO: raiseS against 4 s, within 2 frames), and the turn
//             bar must FAIL (she is still ~50 deg off the opening at 4 s from `back`).
//             VERDICT ORDER: a bar that FAILED on a real measurement is FAIL (exit 1) even if another is VOID; with no failure, any VOID is
//             exit 2; nothing vacuous ever passes. A RED judges only its own bars.
//   framing   (Task 11) POINTCAM: the same calm (hose 760; her point runs its whole course wherever he stands), but with SAL PLACED FOR THE
//             LENS, the one placement this mode (and mouse, off) uses: 25 u from her (pulled toward her out of APRON as `ahead`), facing her,
//             at the bearing alpha off her centre -> opening line that puts the opening 61-69 deg off the grounded look. Found ITERATIVELY,
//             not from an analytic lens offset: stood at alpha, she turns to face him (face(), as `point`), the angle between the LIVE
//             lens's forward and P is read; alpha moves by the miss from 65 and it repeats (<= 6 tries, each printed). The side is the one whose
//             alpha-55 spot lies farther from the crack. (theta FALLS as alpha grows: alpha moves by (theta - 65).) Why 61-69, not just >= 60: the in-frame bar below is conditioned on thetaPre <= 70,
//             and thetaPre is ~constant over the hold (Sal still, BOSSCAM off once she is calmed), so a placement at 75 deg would book it
//             nothing (VOID). (Placed facing her from her sand side the opening lay ~12 deg off the grounded look, in frame with the cue off.)
//             PREMISE: thetaPre at the calm (the first frame pointPh >= 1) >= 60 deg, printed; under it the run is UNMEASURED (exit 2), the
//             closing bar would be vacuous.
//             Booked per frame, besides `point`'s: thetaPre (from __pointcam.state().qPre) and theta (from the drawn camera.quaternion), the
//             angles from the lens's forward to P; P's NDC from both quaternions (camera.fov / aspect, in front = camera-space z < 0); the
//             palm's NDC (drawn); the palm-P angle at the lens and whether both FIT (<= 0.8 x the horizontal FOV, POINTCAM.frame as
//             pre-registered); __pointcam.state() (k, tgt, yaw, pitch, off, why, look net / path); the camera quaternion and qPre, and eq (all
//             four components ===). With no __pointcam on the build (the head before Task 11) qPre := camera.quaternion (the lens IS the
//             grounded lens) and k is null.
//             t0 = the first frame pointPh >= 1 (the calm's update). THE HOLD (pre-registered, keyed to the point's phases, never to the
//             cue's own k, so the RED books the same frames): the frames from t0 + 96 (1.6 s, where k must be >= 0.9) to the last frame
//             before pointPh first reaches 4 (the end of the 14 s if it never does), pointPh 1-3.
//             Bars:
//               close    on >= 90% of the hold frames, thetaPre - theta >= 0.8 x min(thetaPre, 70)
//               inFrame  on EVERY hold frame with thetaPre <= 70: P in frame (drawn NDC |x|, |y| <= 0.85, in front). VOID when none
//               kIn      k >= 0.9 on some frame <= t0 + 96 (1.6 s)
//               kOut     k <= 0.1 on some frame <= 36 frames (0.6 s) after the first frame pointPh is 4 (VOID if it never is)
//               palm     on the hold frames where palm and P FIT, the palm in frame (NDC |x|, |y| <= 0.85, in front) on >= 50%; where they do
//                        not fit, booked (VOID when no hold frame fits)
//             RE-REGISTERED 2026-10-21 (the coordinator's ruling (a)-(b), before the build changed for it): the hold and kIn count from the
//             raise (raiseF, the first pointPh 2), not t0; close is 0.5 x min(thetaPre, 70) (0.8 booked), see lensBars and the framing block.
//             mouse's input lands 1.0 s after raiseF.
//             RED: PC_ON=0 (__pointcam.knobs.on = 0 for the run; on a build with no __pointcam, the lens as it is) judges `close` only and
//             must exit 5 (theta stays thetaPre), its premise shown: the printed thetaPre >= 60.
//   mouse     (Task 11) the framing placement and calm, THREE sessions (a fresh load each). Pointer lock is EMULATED (headless Chrome has
//             none: document.pointerLockElement is defined as the canvas and 'pointerlockchange' dispatched, so player.js's own `locked`
//             turns true) and the look input is REAL mouse movement over CDP (Input.dispatchMouseEvent mouseMoved, one move a frame), through
//             player.js's own handler (movementX x 0.0022 rad, clamped at 150 px). A calibration move (+10 px then -10 px, before he is
//             placed) must turn player.yaw by -0.022 rad; if the movement does not arrive, the input is written the way the handler writes
//             it (player.yaw -= px x 0.0022, clawcam-probe's way), booked `input: 'direct'`. The input lands 1.0 s after t0 (its first
//             frame: t0 + 60):
//               six    one 48 px move (6.05 deg net): k = 0 on that same frame with why 'mouse' and the lens = qPre, k = 0 on every frame after
//                      it, `off` held through pointPh 1-3 (it stays off to the lower)
//               four   one 32 px move (4.03 deg net): why 'on' and k > 0 on every frame from it to the last of pointPh 1-3
//               path   +8 -8 +8 -8 +8 -8 +8 -8 +16 px, one a frame (a 10.08 deg path, the running net never over 2.02 deg): as `four`
//             Premise each: k > 0 on the frame before the input (else VOID).
//   off       (Task 11) the framing placement and calm, two sessions: (A) __pointcam.knobs.on = 0: camera.quaternion === state().qPre,
//             component for component, on EVERY frame of the 14 s (840; read in the step hook, after the frame's update), and the point ran
//             (pointPh >= 1 booked); (B) the positive control, on = 1: every engaged frame (k > 0, >= 1 of them, else VOID) has q != qPre.
// PC_RED variants (each must fail ITS bar): nopoint (__burial.set({ point: 0 }): the claw never raises) -> hold; fastturn (POINT.turn 1.0)
// -> turnRate; noface (PC_AT=back; POINT.face -1, faceMax 4) -> turn. Framing's RED is PC_ON=0 (above).
// ENV (besides DRV_PORT, a port of this probe's own: never 8777 / 8790 / 9419; the probe exits 2 before importing drv.mjs):
//   PC_AT=back|ahead  the placement (point; default back)
//   PC_RED=<variant>  an opt-in RED (exit 5 when its bar failed, as it must; 3 when it did not)
//   PC_ON=0|1         __pointcam.knobs.on for the run (framing / point; default: the build's)
//   PC_NOPLUG=1       the drift RED: plug(c, { stop: false }). It must print CLOCK LOST (exit 4)
//   PC_SHOTS=<prefix> stills (point, framing): every frame of the 14 s RENDERED ({ render: true }) and __bench.capture({}) (frozen, settle 0:
//                     a settle's frames run outside __bench.step and would leak past the plug) at 2.0 s (the turn), 4.5 s (the claw up, the
//                     light, the line) and 7.6 s (the lower) after the calm -> ~/sc/.abyssa-wt/shots/buried/<prefix>-{turn,up,lower}.png.
//                     Gating runs are unrendered (the verdict is booked either way)
//   PC_OUT=<file>     the JSON; PC_TAG=<tag> (default port<port>)
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 9419].includes(P)) { console.error(`pointcam-probe: set DRV_PORT to a port of its own, an integer in 1024-65535 (not 8777 / 8790 / 9419; got ${JSON.stringify(process.env.DRV_PORT)})`); process.exit(2); }
const MODES = ['point', 'framing', 'mouse', 'off'];
const [, , MODE, PORT] = process.argv;
if (!MODES.includes(MODE) || !/^\d+$/.test(PORT || '')) { console.error('usage: DRV_PORT=<own> node tools/bench/pointcam-probe.mjs <' + MODES.join('|') + '> <game port>'); process.exit(2); }
const REDS = { point: { nopoint: { set: { point: 0 }, bars: ['hold'] }, fastturn: { pt: { turn: 1.0 }, bars: ['turnRate'] },
  noface: { pt: { face: -1, faceMax: 4 }, bars: ['turn'], at: 'back' } } };
const RED = process.env.PC_RED || '';
if (RED && !(REDS[MODE] && REDS[MODE][RED])) { console.error(`PC_RED: mode ${MODE} has ${REDS[MODE] ? 'the variants ' + Object.keys(REDS[MODE]).join(', ') : 'no PC_RED variant'} (got ${JSON.stringify(RED)})`); process.exit(2); }
const AT = MODE === 'point' ? process.env.PC_AT || 'back' : 'framing';
if (MODE === 'point' && !['back', 'ahead'].includes(AT)) { console.error(`PC_AT: back | ahead (got ${JSON.stringify(AT)})`); process.exit(2); }
if (RED && REDS[MODE][RED].at && REDS[MODE][RED].at !== AT) { console.error(`PC_RED ${RED} runs at PC_AT=${REDS[MODE][RED].at} only`); process.exit(2); }
const ON = process.env.PC_ON == null || process.env.PC_ON === '' ? null : +process.env.PC_ON;
if (ON != null && ON !== 0 && ON !== 1) { console.error('PC_ON: 0 | 1'); process.exit(2); }
if (ON != null && !['point', 'framing'].includes(MODE)) { console.error('PC_ON: point / framing only (mouse and off set the knob themselves)'); process.exit(2); }
const ONRED = MODE === 'framing' && ON === 0;
const SHOTS = process.env.PC_SHOTS || '';
if (SHOTS && !/^[\w.-]+$/.test(SHOTS)) { console.error(`PC_SHOTS: a plain file prefix (got ${JSON.stringify(SHOTS)})`); process.exit(2); }
if (SHOTS && !['point', 'framing'].includes(MODE)) { console.error('PC_SHOTS: point / framing only'); process.exit(2); }
const CALM_LINE = 'ALL WARDS LIT. IT STILLS. A RIFT OPENS BELOW.', HOSE = 760, SECS = 14, D_HIM = 25;
const BON_IN = 0.9, EASE_F = 12, CLOSE_K = 0.5, TURN_BAR = 0.5, TURN_EPS = 0.005, FRAME = 0.8, NDC_IN = 0.85, TH_LO = 61, TH_HI = 69, TH_PREM = 60;
const PX = 0.0022, PATTERNS = { six: [48], four: [32], path: [8, -8, 8, -8, 8, -8, 8, -8, 16] };
// (PC_SHOT_AT=name:s,...: other moments; at `back` since Michael's ruling the claw is up ~7.1-10.4 s, not through the line)
const SHOT_AT = process.env.PC_SHOT_AT ? process.env.PC_SHOT_AT.split(',').map(q => { const [n, v] = q.split(':'); return [n, +v]; }) : [['turn', 2.0], ['up', 4.5], ['lower', 7.6]];
if (SHOT_AT.some(([n, v]) => !/^\w+$/.test(n) || !(v > 0 && v < SECS))) { console.error('PC_SHOT_AT: name:s,... with 0 < s < 14'); process.exit(2); }

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
  if (${JSON.stringify(AT)} === 'ahead') { ux = rp.x - L.pos.x; uz = rp.z - L.pos.z; }
  else { ux = L.sand.x; uz = L.sand.z; }
  const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  let d = ${D_HIM}, x = L.pos.x + ux * d, z = L.pos.z + uz * d;
  while (d > 8 && S.fissureDist(x, z, 0) < S.APRON) { d -= 0.5; x = L.pos.x + ux * d; z = L.pos.z + uz * d; }
  window.__bench.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0);
  window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0);
  return { at: ${JSON.stringify(AT)}, him: [+x.toFixed(2), +z.toFixed(2)], her: [+L.pos.x.toFixed(2), +L.pos.z.toFixed(2)], dHim: d, fd: +S.fissureDist(x, z, 0).toFixed(2), apron: S.APRON };
})()`;

const INSTALL = `(async () => {
  const THREE = await import('three'), T = await import('/src/world/terrain.js'), S = await import('/src/world/fissureShape.js'), C = await import('/src/config.js');
  const BC = await import('/src/entities/sleeper/bodyCols.js'), { camera, renderer } = await import('/src/core.js'), DV = await import('/src/entities/diver.js');
  const L = window.lev; if (!L || L.kind !== 'brooder') return { err: 'no brooder' };
  const rp = C.riftPos(0), Pt = new THREE.Vector3(rp.x, S.lipMeanY(0, T.terrainH), rp.z);
  const c = L.claws.find(q => q.major); if (!c) return { err: 'no major claw' };
  const sh = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
  const qi = new THREE.Quaternion(), hbox = new THREE.Box3(), hc = new THREE.Vector3();
  const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100, r6 = v => Math.round(v * 1e6) / 1e6, D = 180 / Math.PI;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  // the lens's view of p under quaternion q (camera.position, fov, aspect): the angle off its forward (deg), the NDC, in front
  const view = (q, p) => {
    w.copy(p).sub(camera.position); const dl = w.length() || 1e-9;
    w.applyQuaternion(qi.copy(q).invert());
    const tf = Math.tan(camera.fov * Math.PI / 360), front = w.z < 0, iz = 1 / Math.max(1e-9, -w.z);
    const cap = v => Math.max(-99, Math.min(99, v));
    return { ang: Math.acos(Math.max(-1, Math.min(1, -w.z / dl))) * D, x: cap(w.x * iz / (tf * camera.aspect)), y: cap(w.y * iz / tf), front };
  };
  const inF = v => v.front && Math.abs(v.x) <= ${NDC_IN} && Math.abs(v.y) <= ${NDC_IN};
  const R = window.__pcR = { S: [], msgs: [], lineF: -1, calmF: -1, P: Pt, yawWas: L.yaw, inp: 0, inF: -1, input: null, pat: null, patAt: -1, patI: 0,
    errTo(x, z) { return wrap(Math.atan2(x - L.pos.x, z - L.pos.z) - L.yaw); },
    row() {
      if (window.lev !== L) throw new Error('the sleeper was rebuilt under the booking');
      L.grp.updateMatrixWorld(true);
      c.root.getWorldPosition(sh); c.pj.getWorldPosition(pa); c.dj.getWorldPosition(pb); pa.add(pb).multiplyScalar(0.5);
      u.subVectors(pa, sh).normalize(); w.subVectors(Pt, sh).normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, u.dot(w)))) * D;
      const brg = Math.atan2(Pt.x - L.pos.x, Pt.z - L.pos.z), err = wrap(brg - L.yaw);
      const dyaw = wrap(L.yaw - R.yawWas); R.yawWas = L.yaw;
      const m = window.__msg ? window.__msg().live : '', last = R.msgs.length ? R.msgs[R.msgs.length - 1][1] : null;
      if (m !== last) R.msgs.push([R.S.length, m]);
      if (R.lineF < 0 && m === ${JSON.stringify(CALM_LINE)}) R.lineF = R.S.length;
      const cp = camera.position, sv = window.survival;
      // the lens (Task 11): the drawn quaternion and the one without the cue (qPre; no __pointcam: the lens as it is)
      const PC = window.__pointcam, st = PC ? PC.state() : null, q = camera.quaternion, qp = st ? st.qPre : q;
      const eq = q.x === qp.x && q.y === qp.y && q.z === qp.z && q.w === qp.w;
      const vPre = view(qp, Pt), vPost = view(q, Pt), vPalm = view(q, pa);
      hbox.setFromObject(DV.diver.helmGroup, true); hbox.getCenter(hc); const vBon = view(q, hc);   // his bonnet (its own vertices), drawn
      const a = w.copy(pa).sub(cp).normalize().clone(), b = u.copy(Pt).sub(cp).normalize();
      const sep = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * D, hf = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect) * D;
      R.S.push({ ph: L.pointPh || 0, k: r3(L.pointK || 0), yaw: r3(L.yaw), dyaw: r6(dyaw), brg: r3(brg), err: r2(err * D), ang: r2(ang),
        sh: [r2(sh.x), r2(sh.y), r2(sh.z)], palm: [r2(pa.x), r2(pa.y), r2(pa.z)], fk: r3(window.__fissure ? window.__fissure.k(0) : -1),
        slam: window.__slamLog ? window.__slamLog.length : -1, torn: r3(sv ? sv.torn : -1), walk: L.walkTo ? 1 : 0, homeTurn: L.homeTurn ? 1 : 0,
        calmed: L.calmed ? 1 : 0, keepN: L.keepShellN || 0, threatE: r3(L.threatE), standE: r3(L.standE), pos: [r2(L.pos.x), r2(L.pos.z)],
        hd: r2(Math.hypot(window.player.pos.x - L.pos.x, window.player.pos.z - L.pos.z)), lift: r3(c.liftNow || 0), elbow: r3(c.elbow || 0),
        lensBlk: BC.bodyBlocked(cp.x, cp.y, cp.z, 0) ? 1 : 0, zone: window.zone,
        cam: { k: st ? st.k : null, tgt: st ? st.tgt : null, yaw: st ? st.yawDeg : null, pitch: st ? st.pitchDeg : null, off: st ? st.off : null, why: st ? st.why : null,
          net: st ? st.lookNetDeg : null, path: st ? st.lookPathDeg : null },
        thPre: r3(vPre.ang), th: r3(vPost.ang), ndcPre: [r3(vPre.x), r3(vPre.y), vPre.front ? 1 : 0], ndc: [r3(vPost.x), r3(vPost.y), vPost.front ? 1 : 0],
        pIn: inF(vPost) ? 1 : 0, palmNdc: [r3(vPalm.x), r3(vPalm.y), vPalm.front ? 1 : 0], palmIn: inF(vPalm) ? 1 : 0, sep: r2(sep), fits: sep <= ${FRAME} * hf ? 1 : 0,
        q: [r6(q.x), r6(q.y), r6(q.z), r6(q.w)], qPre: [r6(qp.x), r6(qp.y), r6(qp.z), r6(qp.w)], eq: eq ? 1 : 0, pyaw: r6(window.player.yaw), inp: R.inp, cap: R.cap ? 1 : 0,
        bon: [r3(vBon.x), r3(vBon.y), vBon.front ? 1 : 0], bonIn: vBon.front && Math.abs(vBon.x) <= ${BON_IN} && Math.abs(vBon.y) <= ${BON_IN} ? 1 : 0, amt: st && st.amt != null ? st.amt : null });
      R.inp = 0; R.cap = 0;
    },
    step(n, o) { window.__bench.step(n, () => R.row(), o); return R.S.length; },
    // turn to face him: stepped until her heading error to him is <= 10 deg (or max frames); { n: frames used, faced }
    face(max) { let n = 0, faced = false; window.__bench.step(max, () => { n++; const p = window.player.pos; if (Math.abs(R.errTo(p.x, p.z)) * D <= 10) { faced = true; return false; } }); return { n, faced }; },
    state() { const p = window.player.pos, e = R.errTo(Pt.x, Pt.z) * D;
      return { errOpen: r2(e), errHim: r2(R.errTo(p.x, p.z) * D), hd: r2(Math.hypot(p.x - L.pos.x, p.z - L.pos.z)), threatE: r3(L.threatE), hamPh: L.hamPh ?? null,
        pos: [r2(L.pos.x), r2(L.pos.z)], yaw: r3(L.yaw), calmed: !!L.calmed, standE: r3(L.standE), slam: window.__slamLog ? window.__slamLog.length : -1,
        fdHer: r2(S.fissureDist(L.pos.x, L.pos.z, 0)), fdHim: r2(S.fissureDist(p.x, p.z, 0)) }; },
    calm() {
      R.yawWas = L.yaw;
      window.__lev.cmd('calm');
      if ('calmNext' in L) return 'verb';
      for (const g of L.sigils) if (!g.lit) { g.lit = true; g.rev = 1; }
      return 'direct';
    },
    // (framing) the spot alpha deg off her centre -> P line on side s (+1 / -1), 25 u out (pulled toward her out of APRON)
    spot(alpha, s) {
      let ox = Pt.x - L.pos.x, oz = Pt.z - L.pos.z; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      const px = -oz * s, pz = ox * s, ca = Math.cos(alpha / D), sa = Math.sin(alpha / D), ux = ca * ox + sa * px, uz = ca * oz + sa * pz;
      let d = ${D_HIM}, x = L.pos.x + ux * d, z = L.pos.z + uz * d;
      while (d > 8 && S.fissureDist(x, z, 0) < S.APRON) { d -= 0.5; x = L.pos.x + ux * d; z = L.pos.z + uz * d; }
      return { x, z, d, fd: S.fissureDist(x, z, 0) };
    },
    placeA(alpha, s) {
      const p = R.spot(alpha, s);
      window.__bench.place(p.x, p.z, Math.atan2(L.pos.x - p.x, L.pos.z - p.z), 0);
      window.player.pos.y = T.shutFloorY(p.x, p.z, 0) + 1.35; window.player.vel.set(0, 0, 0);
      return { alpha: r2(alpha), side: s, him: [r2(p.x), r2(p.z)], her: [r2(L.pos.x), r2(L.pos.z)], dHim: p.d, fd: r2(p.fd), apron: S.APRON };
    },
    theta() { return r3(view(camera.quaternion, Pt).ang); },
    // (mouse) the look input: emulated lock, and the pattern's moves queued one a frame from frame index patAt (the probe dispatches them)
    lock() {
      const cv = renderer.domElement;
      Object.defineProperty(document, 'pointerLockElement', { get: () => cv, configurable: true });
      document.dispatchEvent(new Event('pointerlockchange'));
      return !!cv;
    } };
  return { R: L.R, P: [r2(Pt.x), r2(Pt.y), r2(Pt.z)], pointAt: L.pointAt ? [r2(L.pointAt.x), r2(L.pointAt.y), r2(L.pointAt.z)] : null, major: L.claws.indexOf(c),
    pointKnown: 'pointPh' in L, sand: [r3(L.sand.x), r3(L.sand.z)], bed: L.lairPos ? [r2(L.lairPos.x), r2(L.lairPos.z)] : null, pointcam: !!window.__pointcam };
})()`;

// ---- boot: about:blank, the domains on, the focus a player's window has; each session loads the game fresh ----
try { const r = await fetch(`http://127.0.0.1:${P}/json/version`, { signal: AbortSignal.timeout(2000) });
  console.error(`the debug port ${P} already answers /json/version (HTTP ${r.status}): not starting, nothing touched`); process.exit(2); }
catch (e) { if (!(e && e.cause && e.cause.code === 'ECONNREFUSED')) { console.error(`the debug port ${P} is not free (${e && e.name}: ${e && e.cause && e.cause.code || e && e.message}): not starting, nothing touched`); process.exit(2); } }
const TAG = process.env.PC_TAG || 'port' + PORT;
const OUT = process.env.PC_OUT || join(homedir(), 'sc/.abyssa-wt/reviews/buried', `pointcam-${MODE}-${AT}${ONRED ? '-on0' : ''}${RED ? '-' + RED : ''}-${TAG}.json`);
const SHOT_DIR = join(homedir(), 'sc/.abyssa-wt/shots/buried');
const record = { mode: MODE, at: AT, port: +PORT, tag: TAG, red: RED || (ONRED ? 'PC_ON=0' : null), on: ON, noplug: process.env.PC_NOPLUG === '1', shots: SHOTS || null, sessions: [] };
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
} catch (e) {
  const why = String(e && e.message || e);
  console.error('UNMEASURED: boot: ' + why);
  try { if (c) c.close(); } catch (e2) { }
  finish(2, 'boot: ' + why);
}

// ONE SESSION: a fresh load, the plug, her wake, his placement, the calm, 14 s booked. o = { on, pattern, label }
async function session(o) {
  const ses = { label: o.label || MODE };
  let fatal = null;
  try {
    await c.ev(`(window.__pcOld = 1, 1)`).catch(() => 0);
    const tNav = Date.now();
    await c.send('Page.navigate', { url: URL0 });
    await c.until(`!window.__pcOld && !document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
    console.log(`pointcam-probe ${MODE} ${AT}${ses.label !== MODE ? ' [' + ses.label + ']' : ''}${RED ? ' RED ' + RED : ''}${ON != null ? ' PC_ON=' + ON : ''}${record.noplug ? ' NOPLUG' : ''}${SHOTS ? ' SHOTS ' + SHOTS : ''} ${URL0} (fresh profile): loaded in ${((Date.now() - tNav) / 1000).toFixed(1)} s`);
    await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
    await sleep(1000);
    await plug(c, { stop: !record.noplug });
    await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.__bench.step(30), window.survival.hose = ${HOSE}, 1)`);
    ses.build = await c.ev(`!!(window.__burial && window.__burial.set) ? 'burial' : 'main'`);
    if (RED) {
      const R0 = REDS[MODE][RED];
      if (R0.set) {
        if (ses.build !== 'burial') throw new Error(`PC_RED ${RED} patches __burial.set, absent on this build`);
        await c.ev(`(await window.__burial.set(${JSON.stringify(R0.set)}), window.__bench.step(30), window.survival.hose = ${HOSE}, 1)`);
      }
      if (R0.pt) ses.ptPatched = await c.ev(`(async () => { const B = await import('/src/entities/sleeper/brooder.js'); if (!B.POINT) return null; Object.assign(B.POINT, ${JSON.stringify(R0.pt)}); return Object.assign({}, B.POINT); })()`);
      if (R0.pt && !ses.ptPatched) throw new Error(`PC_RED ${RED} patches POINT, absent on this build`);
      ses.patch = R0.set || R0.pt;
    }
    const pl0 = await c.ev(PLACE);
    if (!pl0 || pl0.err) throw new Error('place (bed): ' + (pl0 && pl0.err));
    const ins = await c.ev(INSTALL);
    if (!ins || ins.err) throw new Error('install: ' + (ins && ins.err));
    console.log(`placed ${JSON.stringify(pl0)}; ${JSON.stringify(ins)}`);
    if ((MODE === 'mouse' || MODE === 'off') && !ins.pointcam) throw new Error('no __pointcam on this build');
    // (mouse) the lock, emulated, and a calibration move: does real CDP movement reach player.yaw through player.js's handler?
    if (o.pattern) {
      ses.lock = await c.ev(`window.__pcR.lock()`);
      ses.mx = 400; ses.my = 300;
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ses.mx, y: ses.my });
      const y0 = await c.ev(`window.player.yaw`);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ses.mx + 10, y: ses.my });
      const y1 = await c.ev(`window.player.yaw`);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ses.mx, y: ses.my });
      const y2 = await c.ev(`window.player.yaw`);
      ses.calib = { d1: +(y1 - y0).toFixed(6), d2: +(y2 - y1).toFixed(6), want: -10 * PX };
      ses.input = Math.abs(y1 - y0 + 10 * PX) < 1e-6 && Math.abs(y2 - y1 - 10 * PX) < 1e-6 ? 'cdp' : 'direct';
      console.log(`mouse calibration ${JSON.stringify(ses.calib)}: input ${ses.input}`);
    }
    // the wake, to her stand
    const wk = await c.ev(`(window.__lev.cmd('wake'), { dormant: !!window.lev.dormant, hasStoodKnown: 'hasStood' in window.lev })`);
    if (!wk.hasStoodKnown) throw new Error('no L.hasStood on this build');
    let stoodF = -1;
    for (let k = 0; k < 40 && stoodF < 0; k++) { await c.ev(`window.__bench.step(30)`); if (await c.ev(`!!window.lev.hasStood`)) stoodF = (k + 1) * 30; }
    if (stoodF < 0) throw new Error('she did not stand within 20 s of the wake');
    // him: per PC_AT off where she is now, or (framing / mouse / off) placed for the lens; she turns to face him
    let pl, fc;
    if (MODE === 'point') {
      pl = await c.ev(PLACE);
      if (!pl || pl.err) throw new Error('place: ' + (pl && pl.err));
      fc = await c.ev(`window.__pcR.face(480)`);
    } else {
      const fdA = await c.ev(`window.__pcR.spot(55, 1).fd`), fdB = await c.ev(`window.__pcR.spot(55, -1).fd`);
      const side = fdA >= fdB ? 1 : -1;
      let alpha = 55; ses.tries = [];
      for (let k = 0; k < 6; k++) {
        pl = await c.ev(`window.__pcR.placeA(${alpha}, ${side})`);
        fc = await c.ev(`window.__pcR.face(480)`);
        const th = await c.ev(`window.__pcR.theta()`);
        ses.tries.push({ alpha: +alpha.toFixed(2), th, him: pl.him, dHim: pl.dHim, fd: pl.fd, face: fc });
        console.log(`  framing try ${k}: alpha ${alpha.toFixed(2)} side ${side} -> theta ${th} deg (him ${JSON.stringify(pl.him)}, d ${pl.dHim}, fd ${pl.fd}, faced ${fc.faced} in ${fc.n})`);
        if (th >= TH_LO && th <= TH_HI && fc.faced) break;
        alpha = Math.max(15, Math.min(150, alpha + (th - 65)));   // (theta falls as alpha grows: he goes round her, the opening comes in front)
      }
    }
    // (Task 10 review M4) a face() that ran out of frames is no placement: UNMEASURED
    if (!fc.faced) throw new Error(`UNFACED: she did not come within 10 deg of facing him in ${fc.n} frames`);
    const pre = await c.ev(`window.__pcR.state()`);
    console.log(`stood ${(stoodF / 60).toFixed(2)} s after the wake; placed ${JSON.stringify(pl)}; faced him in ${fc.n} frames: ${JSON.stringify(pre)}`);
    if (o.on != null) ses.knobs = await c.ev(`(() => { const C = window.__pointcam; if (!C) return null; C.knobs.on = ${o.on}; return Object.assign({}, C.knobs); })()`);
    else ses.knobs = await c.ev(`window.__pointcam ? Object.assign({}, window.__pointcam.knobs) : null`);
    // the calm, and 14 s
    const calmBy = await c.ev(`window.__pcR.calm()`);
    const shots = [];
    const N = SECS * 60;
    let at = 0;
    if (o.pattern) {
      // (re-registered 2026-10-21, the coordinator's ruling (a): the cue is keyed to the raise) the input's first frame is raiseF + 60, 1.0 s
      // after the first frame pointPh is 2 (was t0 + 60, 1.0 s after the calm)
      let rF = -1;
      while (rF < 0 && at < N - 120) { await c.ev(`window.__pcR.step(1)`); at++; rF = await c.ev(`window.__pcR.S.findIndex(r => r.ph >= 2)`); }
      if (rF < 0) throw new Error('the raise never came (no pointPh 2 by 12 s)');
      await c.ev(`window.__pcR.step(${rF + 60 - at})`); at = rF + 60;
      ses.t0 = await c.ev(`window.__pcR.S.findIndex(r => r.ph >= 1)`); ses.raiseF = rF; ses.inF = at;
      for (const px of o.pattern) {
        if (ses.input === 'cdp') { ses.mx += px; await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ses.mx, y: ses.my }); await c.ev(`(window.__pcR.inp = ${px}, 1)`); }
        else await c.ev(`(window.player.yaw -= ${px} * ${PX}, window.__pcR.inp = ${px}, 1)`);
        await c.ev(`window.__pcR.step(1)`); at++;
      }
    }
    for (const [name, s] of SHOTS ? SHOT_AT : []) {
      const f = Math.round(s * 60);
      await c.ev(`window.__pcR.step(${f - at}, { render: true })`); at = f;
      const url = await c.ev(`(async () => window.__bench.png(await window.__bench.capture({}), 1))()`);
      await c.ev(`(window.__pcR.cap = 1, 1)`);   // (the capture's 25 frozen frames, dt 1e-4, move her outside the booking: the next row is marked)
      const file = join(SHOT_DIR, `${SHOTS}-${name}.png`);
      mkdirSync(SHOT_DIR, { recursive: true }); writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      shots.push({ name, s, file, row: await c.ev(`window.__pcR.S[window.__pcR.S.length - 1]`) });
      console.log(`still ${file} at ${s} s`);
    }
    while (at < N) { const n = Math.min(300, N - at); await c.ev(`window.__pcR.step(${n}${SHOTS ? ', { render: true }' : ''})`); at += n; }
    Object.assign(ses, { place0: pl0, ins, stoodF, place: pl, faceF: fc.n, faced: fc.faced, pre, calmBy, shots,
      S: await c.ev(`window.__pcR.S`), msgs: await c.ev(`window.__pcR.msgs`), lineF: await c.ev(`window.__pcR.lineF`),
      pointPose: await c.ev(`window.lev.pointPose ? Array.from(window.lev.pointPose) : null`),
      pointAt: await c.ev(`window.lev.pointAt ? window.lev.pointAt.toArray() : null`),
      ptKnobs: await c.ev(`(async () => { try { const B = await import('/src/entities/sleeper/brooder.js'); return B.POINT ? Object.assign({}, B.POINT) : null; } catch (e) { return null; } })()`) });
  } catch (e) { fatal = String(e && e.message || e); }
  ses.clock = await drift(c).catch(() => null);
  ses.fatal = fatal;
  record.sessions.push(ses);
  return ses;
}

// the session's sanity, before any bar: UNMEASURED (2) and LOST (4) first
function sane(ses) {
  if (ses.fatal) { console.error('UNMEASURED: ' + ses.fatal); finish(2, 'throw: ' + ses.fatal); }
  const clock = ses.clock;
  if (record.noplug) {
    if (unmeasured(clock)) { console.error('UNMEASURED: PC_NOPLUG: no numeric drift'); finish(2, 'noplug: no drift'); }
    if (lost(clock)) { console.log(`CLOCK LOST (PC_NOPLUG, as it must): ${JSON.stringify(clock)}`); finish(4, 'clock lost (noplug RED)'); }
    console.error(`PC_NOPLUG: the clock did NOT drift past ${CLOCK_LOST} s: ${JSON.stringify(clock)}`); finish(3, 'noplug RED held');
  }
  if (unmeasured(clock)) { console.error('UNMEASURED: no clock reading'); finish(2, 'no clock'); }
  if (lost(clock)) { console.log(`CLOCK LOST: ${JSON.stringify(clock)} (the bar is ${CLOCK_LOST} s)`); finish(4, 'clock lost'); }
  const calmLines = ses.msgs.filter(m => /STILLS/.test(m[1] || ''));
  ses.lineShown = calmLines.length ? calmLines[0][1] : null;
  if (ses.lineShown !== CALM_LINE) { console.error(`UNMEASURED: the calm line that showed is ${JSON.stringify(ses.lineShown)}, not "${CALM_LINE}" (the hose was not set)`); finish(2, 'line'); }
  if (ses.S.some(r => r.zone !== 0)) { console.error('UNMEASURED: he left zone 0 under the booking'); finish(2, 'zone'); }
}
// the point's frames: t0 (first pointPh >= 1), ph4F (first pointPh 4), lastHold (the last frame before it, or the end)
function phases(S) {
  const t0 = S.findIndex(r => r.ph >= 1);
  const ph4F = t0 >= 0 ? S.findIndex((r, i) => i > t0 && r.ph === 4) : -1;
  return { t0, ph4F, lastHold: ph4F >= 0 ? ph4F - 1 : S.length - 1 };
}
// judge the checks; a RED judges only its own bars
function verdict(ck, redName, redBars) {
  if (redName) for (const k of ck) k.judged = redBars.includes(k.name);
  record.checks = (record.checks || []).concat(ck);
  for (const k of ck) console.log(`  ${k.judged ? (k.vacuous ? 'VOID' : k.ok ? 'ok  ' : 'FAIL') : 'info'} ${k.name.padEnd(8)} ${JSON.stringify(k.val)} (bar ${k.bar})`);
  const J = ck.filter(k => k.judged), failed = J.filter(k => !k.vacuous && !k.ok), vac = J.filter(k => k.vacuous);
  if (redName) {
    if (vac.length) { console.error(`UNMEASURED: RED ${redName}: nothing booked for ${vac.map(k => k.name).join(', ')}`); finish(2, 'RED bars vacuous'); }
    if (failed.length === J.length) { console.log(`RED ${redName}: ${J.map(k => k.name).join(', ')} failed as it must: exit 5`); finish(5); }
    console.error(`RED ${redName} did not fail as written: exit 3`); finish(3, 'RED did not fail');
  }
  return { failed, vac };
}
function conclude(failed, vac) {
  if (failed.length) { console.error('FAIL ' + failed.map(k => `${k.name} ${JSON.stringify(k.val)}`).join('; ') + (vac.length ? '; VOID ' + vac.map(k => k.name).join(', ') : '')); finish(1, 'failed: ' + failed.map(k => k.name).join(',')); }
  if (vac.length) { console.error('UNMEASURED: nothing booked for ' + vac.map(k => k.name).join(', ')); finish(2, 'vacuous'); }
  console.log('PASS'); finish(0);
}
async function consoleErrors() {
  const cons = c ? (await c.console().catch(() => [])).filter(l => /error|EXC/i.test(l) && !/favicon/i.test(l)) : [];
  record.consoleErrors = cons;
  if (cons.length) console.error('console errors (booked, not part of the bar): ' + JSON.stringify(cons));
}

// THE CUE'S RE-REGISTERED BARS (2026-10-21, the coordinator's ruling on Task 11's concerns 1-3, BEFORE the build changes for them):
//   noEarly  k = 0 on every frame before the raise (raiseF, the first frame pointPh is 2): (a) the cue is keyed to the raise, not the calm
//   easeIn   the cue's first frame k > 0 within 12 frames (0.2 s) of raiseF (judged at framing and back; at ahead booked, the cue may stay off)
//   bonnet   his bonnet (the centre of diver.helmGroup's own vertices, Box3 precise) in frame, drawn NDC |x|, |y| <= 0.9 and in front, on
//            every engaged frame (k > 0): (b)
//   aheadLens (PC_AT=ahead only) no engaged frame with BOTH the palm and his bonnet out of frame (NDC 0.9), and the palm in frame on every
//            frame with k >= 0.5 (past the ease): (c), the cue frames her claw within the caps or stays off; never pinned on her shell
function lensBars(S, place) {
  const raiseF = S.findIndex(r => r.ph >= 2), known = S.length && S[0].cam.k != null;
  const early = raiseF >= 0 ? S.slice(0, raiseF).filter(r => r.cam.k > 0).length : null;
  const f1 = raiseF >= 0 ? S.findIndex((r, i) => i >= raiseF && r.cam.k > 0) : -1;
  const eng = S.map((r, i) => r.cam.k > 0 ? i : -1).filter(i => i >= 0), bonOut = eng.filter(i => !S[i].bonIn);
  const pin9 = r => r.palmNdc[2] === 1 && Math.abs(r.palmNdc[0]) <= 0.9 && Math.abs(r.palmNdc[1]) <= 0.9;
  const both = eng.filter(i => !pin9(S[i]) && !S[i].bonIn), past = eng.filter(i => S[i].cam.k >= 0.5), pastOut = past.filter(i => !pin9(S[i]));
  const bonMax = eng.length ? +Math.max(...eng.map(i => Math.max(Math.abs(S[i].bon[0]), Math.abs(S[i].bon[1])))).toFixed(3) : null;
  const ck = [
    { name: 'noEarly', val: { raiseS: raiseF >= 0 ? +(raiseF / 60).toFixed(3) : null, early }, bar: 'k = 0 on every frame before the raise (pointPh 2)', ok: early === 0, vacuous: raiseF < 0 || !known, judged: true },
    { name: 'easeIn', val: { dF: f1 >= 0 ? f1 - raiseF : null }, bar: 'the first k > 0 within 12 frames (0.2 s) of the raise', ok: f1 >= 0 && f1 - raiseF <= 12, vacuous: raiseF < 0 || !known, judged: place !== 'ahead' },
    { name: 'bonnet', val: { engaged: eng.length, out: bonOut.length, ndcMax: bonMax, firstOutS: bonOut.length ? +(bonOut[0] / 60).toFixed(3) : null }, bar: 'his bonnet in frame (NDC <= 0.9, in front) on every engaged frame', ok: bonOut.length === 0, vacuous: !known || (!eng.length && place !== 'ahead'), judged: true }];
  if (place === 'ahead') ck.push({ name: 'aheadLens', val: { engaged: eng.length, bothOut: both.length, pastK05: past.length, palmOutPast: pastOut.length }, bar: 'no engaged frame with palm and bonnet both out; the palm in frame on every k >= 0.5 frame (or the cue off)', ok: both.length === 0 && pastOut.length === 0, vacuous: !known, judged: true });
  return ck;
}

// ============================================ point ============================================
if (MODE === 'point') {
  const ses = await session({ on: ON });
  await consoleErrors(); if (c) c.close();
  sane(ses);
  const S = ses.S, D = 180 / Math.PI, out = ses;
  console.log(`calm by ${out.calmBy}; messages ${JSON.stringify(out.msgs)}`);
  const lineF = out.lineF;
  const lightF = S.findIndex(r => r.fk >= 0.6);
  const raiseF = S.findIndex(r => r.ph === 2), faceOpenF = S.findIndex(r => Math.abs(r.err) <= 12);
  const up = S.map((r, i) => r.k >= 0.95 ? i : -1).filter(i => i >= 0);
  const contiguous = up.length > 0 && up[up.length - 1] - up[0] + 1 === up.length;
  const span = up.length ? +(up.length / 60).toFixed(3) : 0;
  const angs = up.map(i => S[i].ang), angMax = angs.length ? Math.max(...angs) : null;
  const endF = S.findIndex((r, i) => i > 0 && S[i - 1].ph === 4 && r.ph === 0);
  const walkF = endF >= 0 ? S.findIndex((r, i) => i >= endF && (r.walk || r.homeTurn)) : -1;
  const walkDuring = S.filter(r => r.ph > 0 && (r.walk || r.homeTurn)).length;
  const slam0 = S.length ? S[0].slam : 0, torn0 = S.length ? S[0].torn : 0;
  const slamN = S.length ? Math.max(...S.map(r => r.slam)) - slam0 : 0, tornUp = S.length ? +(Math.max(...S.map(r => r.torn)) - torn0).toFixed(3) : 0;
  const travel = up.length ? +(Math.abs(Math.atan2(Math.sin(S[up[up.length - 1]].yaw - S[up[0]].yaw), Math.cos(S[up[up.length - 1]].yaw - S[up[0]].yaw))) * D).toFixed(2) : null;
  // (M1) her turn's rate: the most her heading moved in one frame while pointPh is 1, rad/s
  const ph1 = S.filter(r => r.ph === 1 && !r.cap), rateMax = ph1.length ? +(Math.max(...ph1.map(r => Math.abs(r.dyaw))) * 60).toFixed(5) : null;
  const rateAt = ph1.length ? S.findIndex(r => r.ph === 1 && !r.cap && Math.abs(r.dyaw) * 60 === Math.max(...ph1.map(q => Math.abs(q.dyaw))) * 60) : -1;
  const faceMax = ses.ptKnobs ? ses.ptKnobs.faceMax : null;
  record.book = { raiseF, raiseS: raiseF >= 0 ? +(raiseF / 60).toFixed(3) : null, faceOpenF, faceOpenS: faceOpenF >= 0 ? +(faceOpenF / 60).toFixed(3) : null, errAtRaise: raiseF >= 0 ? S[raiseF].err : null, calmBy: out.calmBy, errAtCalm: out.pre.errOpen, errHimAtCalm: out.pre.errHim, errAtLight: lightF >= 0 ? S[lightF].err : null, lightF, lightS: lightF >= 0 ? +(lightF / 60).toFixed(3) : null,
    lineF, lineS: lineF >= 0 ? +(lineF / 60).toFixed(3) : null, upF: up.length ? [up[0], up[up.length - 1]] : null, upS: up.length ? [+(up[0] / 60).toFixed(3), +(up[up.length - 1] / 60).toFixed(3)] : null,
    span, contiguous, angMax, angAtUp: up.length ? S[up[0]].ang : null, yawTravelHold: travel, errOverHold: up.length ? [Math.min(...up.map(i => S[i].err)), Math.max(...up.map(i => S[i].err))] : null,
    endF, walkF, walkDuring, slamN, tornUp, keepN: S.length ? S[S.length - 1].keepN - S[0].keepN : 0, keepDuringPoint: S.filter((r, i) => i > 0 && r.ph > 0 && r.keepN > S[i - 1].keepN).length,
    lensBlk: S.filter(r => r.lensBlk).length, lensBlkPoint: S.filter(r => r.lensBlk && r.ph > 0).length, maxLift: S.length ? Math.max(...S.map(r => r.lift)) : null,
    turnRateMax: rateMax, turnRateAtF: rateAt, ph1Frames: ph1.length, faceMaxPath: { raiseS: raiseF >= 0 ? +(raiseF / 60).toFixed(3) : null, faceMax },
    camK: S.length && S[0].cam.k != null ? Math.max(...S.map(r => r.cam.k)) : null,
    pointPose: out.pointPose, pointAt: out.pointAt, P: out.ins.P, pointAtD: out.pointAt ? +Math.hypot(out.pointAt[0] - out.ins.P[0], out.pointAt[1] - out.ins.P[1], out.pointAt[2] - out.ins.P[2]).toFixed(3) : null,
    knobs: out.ptKnobs, ptPatched: out.ptPatched || null, placed: out.place, faceF: out.faceF, faced: out.faced, pre: out.pre };
  console.log(`POINT ${JSON.stringify(record.book)}`);
  const ck = [
    { name: 'turn', val: raiseF >= 0 ? S[raiseF].err : null, bar: '|her heading error to P| <= 12 deg on the frame the raise starts (POINT.turn ' + (out.ptKnobs ? out.ptKnobs.turn : '?') + ' rad/s)', ok: raiseF >= 0 && Math.abs(S[raiseF].err) <= 12, vacuous: raiseF < 0, judged: true },
    { name: 'turnRate', val: { rateMax, atF: rateAt, frames: ph1.length, knob: out.ptKnobs ? out.ptKnobs.turn : null }, bar: `max |dyaw| x 60 over pointPh 1 <= ${TURN_BAR} + ${TURN_EPS} rad/s (pre-registered)`, ok: rateMax != null && rateMax <= TURN_BAR + TURN_EPS, vacuous: !ph1.length, judged: true },
    { name: 'aim', val: angMax, bar: 'shoulder->palm vs shoulder->P <= 20 deg on every frame pointK >= 0.95', ok: angMax != null && angMax <= 20, vacuous: !up.length, judged: true },
    { name: 'hold', val: { span, contiguous, upS: record.book.upS, lineS: record.book.lineS, raiseS: record.book.raiseS, faceOpenS: record.book.faceOpenS },
      bar: 'pointK >= 0.95 on one contiguous span of 2.5-3.5 s; ' + (AT === 'ahead' ? 'containing the calm line\'s first frame' : 'the raise starting 0-30 frames after she first faces the opening'),
      ok: contiguous && span >= 2.5 && span <= 3.5 && (AT === 'ahead' ? lineF >= up[0] && lineF <= up[up.length - 1] : raiseF >= 0 && faceOpenF >= 0 && raiseF - faceOpenF >= 0 && raiseF - faceOpenF <= 30),
      vacuous: AT === 'ahead' ? lineF < 0 : false, judged: true },
    { name: 'tears', val: { slamN, tornUp }, bar: '0 tears over the 14 s', ok: slamN === 0 && tornUp <= 0, vacuous: !S.length, judged: true },
    { name: 'walk', val: { endF, walkF, dF: endF >= 0 && walkF >= 0 ? walkF - endF : null, walkDuring }, bar: 'walkTo / homeTurn null while pointPh > 0; set within 72 frames of pointPh leaving 4', ok: endF >= 0 && walkF >= 0 && walkF - endF <= 72 && walkDuring === 0, vacuous: endF < 0, judged: true },
    ...lensBars(S, AT)];
  if (RED === 'noface') console.log(`  info faceMax path: the raise at ${record.book.faceMaxPath.raiseS} s against faceMax ${faceMax} s (${raiseF >= 0 && faceMax != null && Math.abs(raiseF - faceMax * 60) <= 2 ? 'at faceMax' : 'NOT at faceMax'})`);
  const { failed, vac } = verdict(ck, RED, RED ? REDS[MODE][RED].bars : null);
  conclude(failed, vac);
}

// ============================================ framing ============================================
if (MODE === 'framing') {
  const ses = await session({ on: ON });
  await consoleErrors(); if (c) c.close();
  sane(ses);
  const S = ses.S, { t0, ph4F, lastHold } = phases(S);
  if (t0 < 0) { console.error('UNMEASURED: the point never started'); finish(2, 'no point'); }
  const thPre0 = S[t0].thPre;
  console.log(`thetaPre at the calm (frame ${t0}): ${thPre0} deg (premise >= ${TH_PREM}); placement tries ${JSON.stringify(ses.tries)}`);
  record.premise = { t0, thetaPre: thPre0, ok: thPre0 >= TH_PREM };
  if (!(thPre0 >= TH_PREM)) { console.error(`UNMEASURED: thetaPre ${thPre0} deg < ${TH_PREM}: the closing bar would be vacuous`); finish(2, 'premise'); }
  // (re-registered 2026-10-21, ruling (a)) the hold runs from raiseF + 96 (1.6 s after the raise, where k must be >= 0.9) to the last frame
  // before pointPh 4; kIn counts from raiseF. (b) re-registers CLOSE: with his bonnet held at NDC <= 0.9 the turn is bounded at ~42-44 deg
  // (atan(0.9 x tan(hfov / 2))), so 0.8 x min(thetaPre, 70) = 49-56 deg at the placement's 61-69 is unreachable with Sal in frame; the bar
  // is now 0.5 x min(thetaPre, 70) (with inFrame: the opening in frame on every hold frame with thetaPre <= 70); the 0.8 count is booked
  const raiseF = S.findIndex(r => r.ph >= 2);
  const hold = []; if (raiseF >= 0) for (let i = raiseF + 96; i <= lastHold; i++) if (S[i] && S[i].ph >= 2 && S[i].ph <= 3) hold.push(i);
  const closeOk = hold.filter(i => S[i].thPre - S[i].th >= CLOSE_K * Math.min(S[i].thPre, 70));
  const close80 = hold.filter(i => S[i].thPre - S[i].th >= 0.8 * Math.min(S[i].thPre, 70)).length;
  const in70 = hold.filter(i => S[i].thPre <= 70), in70Bad = in70.filter(i => !S[i].pIn);
  const kInF = raiseF >= 0 ? S.findIndex((r, i) => i >= raiseF && r.cam.k != null && r.cam.k >= 0.9) : -1;
  const kOutF = ph4F >= 0 ? S.findIndex((r, i) => i >= ph4F && r.cam.k != null && r.cam.k <= 0.1) : -1;
  const fit = hold.filter(i => S[i].fits), fitIn = fit.filter(i => S[i].palmIn), nofit = hold.filter(i => !S[i].fits);
  const stat = (a, f) => a.length ? [+Math.min(...a.map(f)).toFixed(2), +Math.max(...a.map(f)).toFixed(2)] : null;
  record.book = { t0, ph4F, lastHold, holdN: hold.length, holdS: hold.length ? [+(hold[0] / 60).toFixed(3), +(hold[hold.length - 1] / 60).toFixed(3)] : null,
    thPre: stat(hold, i => S[i].thPre), th: stat(hold, i => S[i].th), closeN: closeOk.length, closeFrac: hold.length ? +(closeOk.length / hold.length).toFixed(4) : null,
    in70N: in70.length, in70Bad: in70Bad.length, ndc: stat(hold, i => Math.max(Math.abs(S[i].ndc[0]), Math.abs(S[i].ndc[1]))),
    raiseF, close80, kInF, kInS: kInF >= 0 ? +((kInF - raiseF) / 60).toFixed(3) : null, kOutF, kOutS: kOutF >= 0 ? +((kOutF - ph4F) / 60).toFixed(3) : null,
    fitN: fit.length, fitInN: fitIn.length, fitFrac: fit.length ? +(fitIn.length / fit.length).toFixed(4) : null, nofitN: nofit.length, sep: stat(hold, i => S[i].sep),
    yawDeg: stat(hold, i => S[i].cam.yaw || 0), pitchDeg: stat(hold, i => S[i].cam.pitch || 0), why: [...new Set(S.map(r => r.cam.why))],
    kMax: S[0].cam.k != null ? Math.max(...S.map(r => r.cam.k)) : null, lensBlk: S.filter(r => r.lensBlk).length, lensBlkPoint: S.filter(r => r.lensBlk && r.ph > 0).length,
    camKnobs: ses.knobs, placed: ses.place, tries: ses.tries, pre: ses.pre };
  console.log(`FRAMING ${JSON.stringify(record.book)}`);
  const ck = [
    { name: 'close', val: { frac: record.book.closeFrac, n: closeOk.length, of: hold.length, close80, thPre: record.book.thPre, th: record.book.th }, bar: 'thetaPre - theta >= 0.5 x min(thetaPre, 70) on >= 90% of the hold (re-registered from 0.8 for the bonnet guard)', ok: hold.length > 0 && closeOk.length / hold.length >= 0.9, vacuous: !hold.length, judged: true },
    { name: 'inFrame', val: { n: in70.length, bad: in70Bad.length, ndcMax: record.book.ndc }, bar: 'P in frame (|x|, |y| <= 0.85, in front) on every hold frame with thetaPre <= 70', ok: in70.length > 0 && in70Bad.length === 0, vacuous: !in70.length, judged: true },
    { name: 'kIn', val: { kInS: record.book.kInS }, bar: 'k >= 0.9 by 1.6 s after the raise', ok: kInF >= 0 && kInF - raiseF <= 96, vacuous: S[0].cam.k == null || raiseF < 0, judged: true },
    { name: 'kOut', val: { kOutS: record.book.kOutS, ph4S: ph4F >= 0 ? +((ph4F - t0) / 60).toFixed(3) : null }, bar: 'k <= 0.1 by 0.6 s after pointPh reaches 4', ok: kOutF >= 0 && kOutF - ph4F <= 36, vacuous: ph4F < 0 || S[0].cam.k == null, judged: true },
    { name: 'palm', val: { frac: record.book.fitFrac, n: fitIn.length, of: fit.length, nofit: nofit.length }, bar: 'the palm in frame on >= 50% of the hold frames where palm and P fit (<= 0.8 x hfov)', ok: fit.length > 0 && fitIn.length / fit.length >= 0.5, vacuous: !fit.length, judged: true },
    ...lensBars(S, 'framing')];
  const { failed, vac } = verdict(ck, ONRED ? 'PC_ON=0' : '', ['close']);
  conclude(failed, vac);
}

// ============================================ mouse ============================================
if (MODE === 'mouse') {
  const runs = [];
  for (const name of ['six', 'four', 'path']) {
    const ses = await session({ on: 1, pattern: PATTERNS[name], label: name });
    sane(ses);
    runs.push([name, ses]);
  }
  await consoleErrors(); if (c) c.close();
  const ck = [];
  for (const [name, ses] of runs) {
    const S = ses.S, { lastHold } = phases(S), inF = ses.inF, endIn = inF + PATTERNS[name].length - 1;
    const pre = S[inF - 1] && S[inF - 1].cam.k > 0;
    const look = { input: ses.input, calib: ses.calib, kBefore: S[inF - 1] ? S[inF - 1].cam.k : null, net: S[endIn] ? S[endIn].cam.net : null, path: S[endIn] ? S[endIn].cam.path : null,
      dyawDeg: S[endIn] && S[inF - 1] ? +((S[endIn].pyaw - S[inF - 1].pyaw) * 180 / Math.PI).toFixed(3) : null, lastHoldS: +((lastHold - ses.t0) / 60).toFixed(3) };
    if (name === 'six') {
      const r = S[inF], after = S.slice(inF), offHeld = S.slice(inF, lastHold + 1).every(q => q.cam.off === true);
      const v = { ...look, atInput: r ? { k: r.cam.k, why: r.cam.why, eq: r.eq } : null, kMaxAfter: Math.max(...after.map(q => q.cam.k)), offHeld };
      ck.push({ name: 'six', val: v, bar: 'a 6 deg turn: k 0 on that frame (why mouse, lens = qPre), 0 on every frame after, off held through pointPh 1-3', ok: !!r && r.cam.k === 0 && r.cam.why === 'mouse' && r.eq === 1 && v.kMaxAfter === 0 && offHeld, vacuous: !pre, judged: true });
    } else {
      const span = S.slice(inF, lastHold + 1), bad = span.filter(q => !(q.cam.why === 'on' && q.cam.k > 0));
      ck.push({ name, val: { ...look, frames: span.length, bad: bad.length, kMin: span.length ? Math.min(...span.map(q => q.cam.k)) : null }, bar: (name === 'four' ? 'a 4 deg net turn' : 'a 10 deg path netting 2 deg') + ': why on, k > 0 from the input to the last frame of pointPh 1-3', ok: span.length > 0 && bad.length === 0, vacuous: !pre || !span.length, judged: true });
    }
  }
  const { failed, vac } = verdict(ck, '', null);
  conclude(failed, vac);
}

// ============================================ off ============================================
if (MODE === 'off') {
  const A = await session({ on: 0, label: 'on0' }); sane(A);
  const B = await session({ on: 1, label: 'on1' }); sane(B);
  await consoleErrors(); if (c) c.close();
  const ranA = A.S.some(r => r.ph >= 1), neqA = A.S.filter(r => !r.eq).length, kA = A.S.filter(r => r.cam.k !== 0).length;
  const engB = B.S.filter(r => r.cam.k > 0), eqB = engB.filter(r => r.eq).length;
  record.book = { A: { frames: A.S.length, ran: ranA, notEq: neqA, kNonZero: kA, whys: [...new Set(A.S.map(r => r.cam.why))] }, B: { frames: B.S.length, engaged: engB.length, eqWhileEngaged: eqB, kMax: engB.length ? Math.max(...engB.map(r => r.cam.k)) : 0 } };
  console.log(`OFF ${JSON.stringify(record.book)}`);
  const ck = [
    { name: 'off', val: record.book.A, bar: 'on 0: camera.quaternion === qPre component for component on every frame of the 14 s, the point run', ok: A.S.length === SECS * 60 && neqA === 0 && kA === 0, vacuous: !ranA, judged: true },
    { name: 'control', val: record.book.B, bar: 'on 1: every engaged frame (k > 0) has q != qPre', ok: engB.length > 0 && eqB === 0, vacuous: !engB.length, judged: true }];
  const { failed, vac } = verdict(ck, '', null);
  conclude(failed, vac);
}
