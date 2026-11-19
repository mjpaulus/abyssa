// THE LENS IN HER AS SHE RISES (camswing, 2026-11-09; card roadmap/rise-camera-swing.md). Found in the discovery video of 2026-11-01 (first
// take, 24.85-25.45 s): as Velkath rises beside Sal the follow lens ends up inside her body for ~0.5 s, then pops ~1.3 u out.
//   DRV_PORT=<own> node tools/bench/riseclip-probe.mjs <case|all> <game port>
// Cases (each a fresh load, fresh profile save removed, home, zone 0, her asleep and buried; stepped on the PLUGGED clock, clockplug.mjs):
//   take      the recorded approach, rise2-rec.mjs mode A's inputs exactly (vd-tools/rise2-rec.mjs): placed at START (106.0, 11.3) facing WAY
//             (105.5, 33.25), 150 settle frames, 1.5 s stood, the real-key W walk (yaw eased 1.4 rad/s) via WAY to the harpoon's anchor, 0.8 s
//             stood, REAL E; after the wake no look for 4.0 s, from +0.85 s a real A/D strafe away from her to 18 u, at +4.0 s he turns to face
//             her (1.6 rad/s) and backs off with S under 16 u. Every frame rendered (as the recording).
//   walk      the FIRST take's inputs (vd-tools/discover-rec.mjs, the discovery video of 2026-11-01): the same placement and walk, W released at
//             the FIRST frame the [E] prompt shows, 0.8 s stood, REAL E, then no keys and no look at all to the end.
//   a0 a90 am90 a180   Alt+6 (the anchor, facing the iron) then his yaw turned by 0 / +90 / -90 / 180 deg, 60 settle frames, REAL E, hands off
//   e<d>_<b>_<f|b|s|l>  (stand-offs round her) d u off her strip's edge at the bearing b of the way round from her sand side (0..1), facing her
//             (f), his back to her (b: the lens toward her), her on his right (s) or left (l); woken by lev.cmd('wake'), hands off
//   off       risecam-probe's RC_AT=off stand: 12 u off her strip's edge on her sand side facing her centre, woken by lev.cmd('wake')
// Booked every frame from E (the wake, `off`) to her stand + 2 s (cap wake + 14 s), in the step hook after the frame's update (the drawn
// lens: camera.position; RISECAM only turns it): `in` = bodyBlocked(lens, 0) (the game's own body colliders: her capsules, the shell proxy
// over the drawn ground, the clutch; blockWhy = which), `in15` = the same at the guard's 0.15 margin, the lens's distance from his pivot
// (`dp`, the top of his helmet), its one-frame move RELATIVE TO HIM (`rel`: the lens's step less his, so his own shove is not a jump) and raw,
// the turn of its bearing about his pivot in that frame (`dAng`, deg), and __crecam's books (eng bits, drop, dropMiss, guard / keep counts).
// BARS (each case):
//   inside   0 frames with the lens inside her (bodyBlocked margin 0)
//   framed   (added after the first after-video: a swung lens left him out of the picture) his helmet in the drawn frame on every frame
//   jump     the largest one-frame lens move relative to him <= JUMP u (CP_JUMP, default 0.5). Why 0.5: the lens's own rules travel at most
//            CRECAM.guardTravel 30 u/s = 0.5 u a frame at 60 fps (the guard escaping her; travel 12 u/s = 0.2); the pop on main was 1.3 u in a
//            frame (2.6x that). At 2.2-4 u from his helmet 0.5 u is a 7-13 deg swing of the view about him in 1/60 s, which the eye follows as
//            a fast move (a 30 fps video shows two such frames as one ~1 u step); past it, on main, is the snap that reads as a cut.
// Exit 0 pass | 1 a bar failed | 2 UNMEASURED | 4 LOST. CP_SWING=<deg> sets __crecam.knobs.swing before E (0 = main's lens: the RED).
// CP_TRACE=1 books the lens at full precision (x, y, z and the quaternion, every frame of the window) for the swing-0 vs main compare.
// JSON -> CP_OUT (default out/probe/riseclip-<case>-<tag>.json). ENV: DRV_PORT, CP_SWING, CP_JUMP, CP_TRACE, CP_TAG, CP_OUT, CP_RENDER (0 = no
// render in the hands-off cases; default 1).
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 8794, 8840, 9419].includes(P)) { console.error('riseclip-probe: set DRV_PORT to a port of its own'); process.exit(2); }
const CASES = ['take', 'walk', 'a0', 'a90', 'am90', 'a180', 'off'];
const [, , WHICH, PORT] = process.argv;
const EDGE = /^e(\d+(?:\.\d+)?)_(\d+(?:\.\d+)?)_([fbsl])$/;   // e<u off the strip edge>_<bearing, a fraction of the way round from her sand side>_<f facing her | b back to her | s her on his right | l on his left>
if (!(CASES.includes(WHICH) || WHICH === 'all' || EDGE.test(WHICH)) || !/^\d+$/.test(PORT || '')) { console.error('usage: DRV_PORT=<own> node tools/bench/riseclip-probe.mjs <' + CASES.join('|') + '|all> <game port>'); process.exit(2); }
const CRANE = process.env.CP_CRANE == null || process.env.CP_CRANE === '' ? null : +process.env.CP_CRANE;
const JUMP = +(process.env.CP_JUMP || 0.5), TRACE = process.env.CP_TRACE === '1', RENDER = process.env.CP_RENDER !== '0';
const START = [106.0, 11.3], WAY = [105.5, 33.25], OFF_TO = 18, BACK_MIN = 16;
const [W, H] = (process.env.CP_VIEW || '1920x1080').split('x').map(Number);   // CP_VIEW=1280x720: the first take's viewport
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join, dirname, resolve } = await import('node:path');
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-riseclip-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, unmeasured, lost } = await import('./clockplug.mjs');
let chromeStarted = false;
process.on('exit', () => { if (chromeStarted) stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
const TAG = process.env.CP_TAG || (CRANE == null ? 'default' : 'crane' + CRANE) + '-port' + PORT;

await start('about:blank'); chromeStarted = true;
const c = await connect();
await c.send('Runtime.enable'); await c.send('Page.enable');
await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// A SEEDED Math.random on every document (CP_SEED=0 leaves the browser's): the lens shake (game.js `shake`, rng per axis per frame) is the
// one random term in the lens, so without it two runs of one build differ from the wake on and no trace compare can mean anything
if (process.env.CP_SEED !== '0') await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let a = ${+(process.env.CP_SEED || 12345)} >>> 0;
  const s0 = a; window.__cpSeed = f => { a = (s0 ^ Math.imul(f + 1, 0x9E3779B1)) >>> 0; };
  Math.random = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();` });

// the frame hook: everything booked page-side, read back once
const INSTALL = `(async () => {
  const BC = await import('/src/entities/sleeper/bodyCols.js'), { camera } = await import('/src/core.js'), THREE = await import('three');
  const hv = new THREE.Vector3();
  const L = window.lev; if (!L || L.kind !== 'brooder' || !L.buried) return { err: 'no buried brooder' }; window.__cpT = await import('/src/world/terrain.js');
  window.__crecamDbg = true;
  const D = 180 / Math.PI, r4 = v => Math.round(v * 1e4) / 1e4;
  const R = window.__cpR = { S: [], T: [], on: false, wakeF: -1, stoodF: -1, gf: 0, prev: null,
    row() {
      R.gf++;
      if (R.wakeF < 0 && !L.dormant) R.wakeF = R.S.length;
      if (R.stoodF < 0 && L.hasStood) R.stoodF = R.S.length;
      const cp = camera.position, pp = window.player.pos, px = pp.x, py = pp.y + 0.4, pz = pp.z;
      const inside = BC.bodyBlocked(cp.x, cp.y, cp.z, 0), why = inside ? BC.blockWhy : null, in15 = BC.bodyBlocked(cp.x, cp.y, cp.z, 0.15);
      const dx = cp.x - px, dy = cp.y - py, dz = cp.z - pz, dp = Math.hypot(dx, dy, dz), ang = Math.atan2(dx, dz);
      let rel = 0, raw = 0, dAng = 0;
      if (R.prev) { const q = R.prev; raw = Math.hypot(cp.x - q[0], cp.y - q[1], cp.z - q[2]);
        rel = Math.hypot(cp.x - q[0] - (pp.x - q[3]), cp.y - q[1] - (pp.y - q[4]), cp.z - q[2] - (pp.z - q[5]));
        let a = ang - q[6]; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; dAng = Math.abs(a) * D; }
      R.prev = [cp.x, cp.y, cp.z, pp.x, pp.y, pp.z, ang];
      const st = window.__crecam.state(), dbg = window.__crecam.dbg, shk = window.__hh.impulse(0);
      // his helmet (the pivot) in the drawn frame: NDC, and out of frame (behind the lens or |x| / |y| > 1)
      camera.updateMatrixWorld(); hv.set(px, py, pz).applyMatrix4(camera.matrixWorldInverse); const front = hv.z < 0; hv.applyMatrix4(camera.projectionMatrix);
      const salOut = !front || Math.abs(hv.x) > 1 || Math.abs(hv.y) > 1;
      R.S.push({ i: R.S.length, in: inside ? 1 : 0, why, in15: in15 ? 1 : 0, dp: r4(dp), rel: r4(rel), raw: r4(raw), dAng: r4(dAng), k: st.k, eng: st.eng, drop: st.drop, dropT: st.dropT,
        dropMiss: st.dropMiss, guardN: st.guardN, guardMain: st.guardMain, keepN: st.keepN, keepFail: st.keepFail, hold: st.hold, cd: st.camDist, rawB: r4(dbg.raw), dT: r4(dbg.tgt), dS: r4(dbg.spring), dG: r4(dbg.guard), dF: r4(dbg.final), lift: st.lift,
        crk: window.__risecrane ? window.__risecrane.state().k : null, crWhy: window.__risecrane ? window.__risecrane.state().why : null, crAlt: window.__risecrane ? window.__risecrane.state().alt : null, cam: [r4(cp.x), r4(cp.y), r4(cp.z)], sal: [r4(pp.x), r4(pp.y), r4(pp.z)], dL: r4(Math.hypot(pp.x - L.pos.x, pp.z - L.pos.z)),
        shake: r4(shk), salOut: salOut ? 1 : 0, ndc: [r4(hv.x), r4(hv.y)], dormant: L.dormant ? 1 : 0, bury: r4(L.bury || 0), stood: L.hasStood ? 1 : 0 });
      if (${process.env.CP_SCAN === '1'}) { const r = R.S[R.S.length - 1], y = window.player.yaw, ax = px - L.pos.x, az = pz - L.pos.z, al = Math.hypot(ax, az) || 1;
        const clear = (bx, bz, d, h) => { for (let k = 1; k <= 24; k++) { const f = k / 24; if (BC.bodyBlocked(px + bx * d * f, py + h * f, pz + bz * d * f, 0.4)) return false; } return true; };
        const scan = (bx, bz) => [4, 6, 8, 10, 12].map(d => { for (let h = 0; h <= 12; h += 1) if (clear(bx, bz, d, h)) return h; return 99; });
        { const TT = [0, 45, -45, 90, -90, 135, -135, 180], DD = [6, 9, 12], HH = [2, 4, 6], b0 = Math.atan2(-Math.cos(y), -Math.sin(y)); const g = []; const T = window.__cpT;
          for (const t of TT) { const a = b0 + t * Math.PI / 180, bx = Math.cos(a), bz = Math.sin(a); for (const d of DD) for (const h of HH) { const x = px + bx * d, yy = py + h, z = pz + bz * d;
            g.push(BC.bodyBlocked(x, yy, z, 0.6) || BC.bodyBlockedAhead(x, yy, z, 0.6, 6) ? 1 : (T && yy < T.shutFloorY(x, z, 0) + 1.2 ? 2 : 0)); } }
          r.grid = g.join(''); const hx = (L.pos.x - px), hz = (L.pos.z - pz); r.herAng = Math.round(((Math.atan2(hz, hx) - b0 + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI); }
        r.R = r4(L.R); r.bodyY = r4(L.bodyY); r.stand = r4(L.stand); r.lp = [r4(L.pos.x), r4(L.bodyY), r4(L.pos.z)]; r.gy = r4(pp.y - 1.35);
        r.scBack = scan(-Math.sin(y), -Math.cos(y)); { let m = 0; for (; m <= 14; m += 0.5) if (BC.shellPlanNear(px, py, pz, m) || BC.limbNearXZ(px, pz, m)) break; r.plan = m; let n = 0; for (; n <= 14; n += 0.5) if (BC.shellPlanNear(px, py, pz, n)) break; r.planS = n; } r.scAway = scan(ax / al, az / al); }
      if (${TRACE}) { const q = camera.quaternion; R.T.push([cp.x, cp.y, cp.z, q.x, q.y, q.z, q.w]); }
    },
    // (Math.random re-seeded from the frame number before every booked frame: other consumers (audio, particles, async callbacks between
    // CDP calls) draw from it a varying number of times, and the lens shake must draw the same numbers in a compared run)
    seed() { if (window.__cpSeed) window.__cpSeed(R.gf); },
    step(n, render) { R.seed(); window.__bench.step(n, () => { R.row(); R.seed(); }, render ? { render: true } : undefined); return R.S.length; } };
  return { ok: 1 };
})()`;
const OFFPLACE = `(async () => { const T = await import('/src/world/terrain.js'); const L = window.lev, MD = L.mound, j = Math.round((L.sandSide > 0 ? 0 : 0.5) * MD.COLS) % MD.COLS;
  const ex = MD.P[j * 3], ez = MD.P[j * 3 + 2], cx = MD.bx, cz = MD.bz; let ux = ex - cx, uz = ez - cz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const x = ex + ux * 12, z = ez + uz * 12; window.__bench.place(x, z, Math.atan2(cx - x, cz - z), 0); window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0);
  return [+x.toFixed(2), +z.toFixed(2)]; })()`;

async function boot() {
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/__fresh_profile_404` });
  await sleep(800);
  await c.ev(`(localStorage.removeItem('abyssa.chart.v1'), 1)`);
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/?bench&playtest` });
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await sleep(1000);
  await plug(c);
  // (a run that can be compared frame for frame with another: the game clock starts from one value, not from however long the live loop
  // ran before the plug, and the sculpt is waited for WITHOUT stepping (it lands on a promise), so every run steps the same frames)
  await c.ev(`(window.__plugClk.clock.elapsedTime = 500, window.__plugClk.e0 = 500, 1)`);
  // every stepped frame from here re-seeds Math.random from the plugged frame count before it runs (R.seed did it for the booked frames only)
  await c.ev(`(() => { if (!window.__cpSeed) return 0; const K = window.__plugClk, S1 = window.__bench.step;
    window.__bench.step = (n, fn, o) => { window.__cpSeed(K.n); return S1(n, i => { const r = fn ? fn(i) : undefined; window.__cpSeed(K.n); return r; }, o); }; return 1; })()`);
  await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.weather.set(1, 0), 1)`);
  await c.until(`!!(window.lev && window.lev.sculpted)`, 60000, 100);
  await c.ev(`(window.__helm = true, window.__bench.step(60), 1)`);
  const fresh = await c.ev(`(() => { const H = window.lev.harpoon; return { wound: !!H.wound, hPulled: !!H.pulled, dormant: !!window.lev.dormant, view: [innerWidth, innerHeight] }; })()`);
  if (fresh.wound || fresh.hPulled || !fresh.dormant) throw new Error('not a fresh harpoon ' + JSON.stringify(fresh));
  if (fresh.view[0] !== W || fresh.view[1] !== H) throw new Error('viewport ' + fresh.view);
}
const knob = async () => { if (CRANE != null) await c.ev(`(window.__risecrane && (window.__risecrane.knobs.on = ${CRANE}), 1)`); return c.ev(`JSON.parse(JSON.stringify({ crecam: window.__crecam.knobs, crane: window.__risecrane ? window.__risecrane.knobs : null }))`); };
const len = () => c.ev(`window.__cpR.S.length`);
const ev = s => c.ev(s);

async function runTake(ses, discover) {
  await c.ev(`(async () => { const T = await import('/src/world/terrain.js'); const x = ${START[0]}, z = ${START[1]};
    window.__bench.place(x, z, Math.atan2(${WAY[0]} - x, ${WAY[1]} - z), 0); window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0); window.player.pitch = -0.05; return 1; })()`);
  await c.ev(`(window.__helm = true, window.__bench.step(150, null, { render: true }), 1)`);
  const ins = await ev(INSTALL); if (!ins || ins.err) throw new Error('install ' + JSON.stringify(ins));
  ses.knobs = await knob();
  // the take's game frame counter: the recording's video time is (frames since the 1.5 s stood began) / 60
  const fr = () => ev(`(window.__helm = true, window.__cpR.step(1, true), 1)`);
  let gf = 0; const frame = async () => { await fr(); gf++; };
  for (let i = 0; i < 90; i++) await frame();
  const AN = await ev(`[window.lev.harpoon.anchor.x, window.lev.harpoon.anchor.z]`);
  await c.key('KeyW', true);
  let tgt = WAY, leg = 0, promptAt = -1, last = null, lastF = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const s = await ev(`[window.player.pos.x, window.player.pos.z, window.player.yaw, !!window.lev.harpoon.prompt(window.player.pos)]`);
    if (discover && s[3]) { promptAt = gf; break; }
    if (s[3] && promptAt < 0) { promptAt = gf; tgt = AN; leg = 1; }
    if (promptAt >= 0) { const dA = Math.hypot(AN[0] - s[0], AN[1] - s[1]); if (dA < 1.0 || !s[3] || gf - promptAt > 90) break; }
    if (!discover && (!last || gf - lastF >= 120)) { const moved = last ? Math.hypot(s[0] - last[0], s[1] - last[1]) : 9; last = [s[0], s[1]]; lastF = gf;
      if (moved < 0.8) { await c.key('Space', true); for (let k = 0; k < 20; k++) await frame(); await c.key('Space', false); continue; } }
    if (leg === 0 && Math.hypot(tgt[0] - s[0], tgt[1] - s[1]) < 2.5) { leg = 1; tgt = AN; }
    const want = Math.atan2(tgt[0] - s[0], tgt[1] - s[1]);
    let d = want - s[2]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const mx = 1.4 / 60; d = Math.max(-mx, Math.min(mx, d));
    await ev(`(window.player.yaw = ${s[2] + d}, 1)`);
    await frame();
  }
  await c.key('KeyW', false);
  if (promptAt < 0) throw new Error('never reached the prompt');
  for (let i = 0; i < 48; i++) await frame();
  if (!(await ev(`!!window.lev.harpoon.prompt(window.player.pos)`))) throw new Error('no prompt where he stopped');
  ses.eF = await len(); ses.eVideoS = +(gf / 60).toFixed(3);
  await c.key('KeyE', true); await frame(); await frame(); await c.key('KeyE', false);
  if (!(await ev(`!!window.lev.harpoon.wrenching`))) throw new Error('real E did not start the wrench');
  let wakeF = -1, stoodF = -1, strafe = null, phase = 'wait', backing = false;
  const awayKey = () => ev(`(() => { const P = window.player, L = window.lev; const ax = P.pos.x - L.pos.x, az = P.pos.z - L.pos.z;
    const rx = Math.sin(P.yaw - Math.PI / 2), rz = Math.cos(P.yaw - Math.PI / 2); return rx * ax + rz * az > 0 ? 'KeyD' : 'KeyA'; })()`);
  const dL = () => ev(`Math.hypot(window.player.pos.x - window.lev.pos.x, window.player.pos.z - window.lev.pos.z)`);
  ses.marks = {};
  for (let f = 0; f < 60 * 30; f++) {
    await frame();
    if (wakeF < 0) { if (!(await ev(`!!window.lev.dormant`))) { wakeF = gf; ses.marks.wakeVideoS = +(gf / 60).toFixed(3); } continue; }
    const k = gf - wakeF;
    if (discover) { if (stoodF < 0 && await ev(`!!window.lev.hasStood`)) { stoodF = gf; ses.marks.stoodVideoS = +(gf / 60).toFixed(3); } if (stoodF >= 0 && gf - stoodF >= 240) break; if (k > 14 * 60) break; continue; }
    if (phase === 'wait' && k >= 51) { strafe = await awayKey(); await c.key(strafe, true); phase = 'strafe'; ses.marks.strafe = strafe; }
    if (phase === 'strafe' && (k >= 240 || (await dL()) >= OFF_TO)) { await c.key(strafe, false); phase = 'idle'; }
    if (k >= 240 && (phase === 'idle' || phase === 'strafe' || phase === 'turn')) {
      if (phase === 'strafe') await c.key(strafe, false);
      if (phase !== 'turn') phase = 'turn';
      const s = await ev(`[window.player.yaw, Math.atan2(window.lev.pos.x - window.player.pos.x, window.lev.pos.z - window.player.pos.z)]`);
      let d = s[1] - s[0]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const mx = 1.6 / 60;
      if (Math.abs(d) > 0.01) await ev(`(window.player.yaw = ${s[0] + Math.max(-mx, Math.min(mx, d))}, 1)`);
      else phase = 'faced';
    }
    if (phase === 'faced' && !backing && (await dL()) < BACK_MIN) { backing = true; await c.key('KeyS', true); }
    if (backing && (await dL()) >= BACK_MIN + 1) { backing = false; await c.key('KeyS', false); phase = 'done'; }
    if (stoodF < 0 && await ev(`!!window.lev.hasStood`)) { stoodF = gf; ses.marks.stoodVideoS = +(gf / 60).toFixed(3); }
    if (stoodF >= 0 && gf - stoodF >= 240) break;
    if (k > 14 * 60) break;
  }
  if (backing) await c.key('KeyS', false);
  ses.gf0 = 0;   // row i of the window is video time (i - eF) / 60 + eVideoS
}

const edgePlace = (d, b, m) => `(async () => { const T = await import('/src/world/terrain.js'); const L = window.lev, MD = L.mound, j = Math.round(((L.sandSide > 0 ? 0 : 0.5) + ${b}) * MD.COLS) % MD.COLS;
  const ex = MD.P[j * 3], ez = MD.P[j * 3 + 2], cx = MD.bx, cz = MD.bz; let ux = ex - cx, uz = ez - cz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const x = ex + ux * ${d}, z = ez + uz * ${d}, f = Math.atan2(cx - x, cz - z), yaw = f + ${{ f: 0, b: Math.PI, s: -Math.PI / 2, l: Math.PI / 2 }[m]};
  window.__bench.place(x, z, yaw, 0); window.player.pos.y = Math.max(T.shutFloorY(x, z, 0), T.extraFloorAt ? T.extraFloorAt(x, z, 0) : -1e9) + 1.35; window.player.vel.set(0, 0, 0);
  return [+x.toFixed(2), +z.toFixed(2)]; })()`;
async function runStand(ses, cs) {
  const em = EDGE.exec(cs);
  if (em) { ses.place = await ev(edgePlace(+em[1], +em[2], em[3])); }
  else if (cs === 'off') { ses.place = await ev(OFFPLACE); }
  else {
    await ev(`(window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit6',key:'6',altKey:true,bubbles:true})), window.dispatchEvent(new KeyboardEvent('keyup',{code:'Digit6',key:'6',altKey:true,bubbles:true})), 1)`);
    const off = { a0: 0, a90: 90, am90: -90, a180: 180 }[cs];
    if (off) await ev(`(window.player.yaw += ${off * Math.PI / 180}, 1)`);
  }
  await ev(`(window.__helm = true, window.__bench.step(${RENDER ? 90 : 60}, null, ${RENDER ? '{ render: true }' : 'undefined'}), 1)`);
  ses.stand = await ev(`(() => { const P = window.player, L = window.lev; return { p: [+P.pos.x.toFixed(2), +P.pos.z.toFixed(2)], yawDeg: +(P.yaw * 180 / Math.PI).toFixed(1), dL: +Math.hypot(P.pos.x - L.pos.x, P.pos.z - L.pos.z).toFixed(2) }; })()`);
  const ins = await ev(INSTALL); if (!ins || ins.err) throw new Error('install ' + JSON.stringify(ins));
  ses.knobs = await knob();
  ses.eF = 0;
  if (cs === 'off' || em) { await ev(`window.__cpR.step(1, ${RENDER})`); await ev(`(window.__lev.cmd('wake'), 1)`); }
  else {
    if (!(await ev(`!!window.lev.harpoon.prompt(window.player.pos)`))) throw new Error('no prompt at the anchor');
    await c.key('KeyE', true); await ev(`window.__cpR.step(2, ${RENDER})`); await c.key('KeyE', false);
    if (!(await ev(`!!window.lev.harpoon.wrenching`))) throw new Error('real E did not start the wrench');
  }
  for (let k = 0; k < 60; k++) { await ev(`window.__cpR.step(10, ${RENDER})`); if (await ev(`window.__cpR.wakeF >= 0`)) break; }
  const wakeF = await ev(`window.__cpR.wakeF`); if (wakeF < 0) throw new Error('she did not wake');
  for (;;) {
    await ev(`window.__cpR.step(20, ${RENDER})`);
    const [n, sf] = await ev(`[window.__cpR.S.length, window.__cpR.stoodF]`);
    if ((sf >= 0 && n >= sf + 240) || n >= wakeF + 14 * 60) break;
  }
}

const out = { case: WHICH, crane: CRANE, jumpBar: JUMP, sessions: {}, bars: {} };
const clocks = [];
const OUT = resolve(process.env.CP_OUT || `out/probe/riseclip-${WHICH}-${TAG}.json`);
let anyFail = false, anyVoid = false;
try {
  for (const cs of WHICH === 'all' ? CASES : [WHICH]) {
    await boot();
    const ses = { case: cs };
    if (cs === 'take' || cs === 'walk') await runTake(ses, cs === 'walk'); else await runStand(ses, cs);
    const S = await ev(`window.__cpR.S`), wakeF = await ev(`window.__cpR.wakeF`), stoodF = await ev(`window.__cpR.stoodF`);
    if (TRACE) ses.trace = await ev(`window.__cpR.T`);
    ses.clock = await drift(c); clocks.push(ses.clock);
    const win = S.slice(ses.eF);
    // (the lens SHAKE, game.js `shake`: her wake sets it to 1, a random offset of up to 0.5 u an axis each frame, decaying at 2/s, a deliberate
    // event the jump bar is not about: frames shaken (shake > 0 after this frame or the one before) are booked apart, maxRelShaken)
    const shaken = r => r.shake > 0 || (S[r.i - 1] && S[r.i - 1].shake > 0);
    const ins = win.filter(r => r.in), jr = win.slice(1).filter(r => !shaken(r)).reduce((a, r) => r.rel > a.rel ? r : a, { rel: 0 });
    const vt = i => cs === 'take' || cs === 'walk' ? +(((i - ses.eF) / 60) + ses.eVideoS).toFixed(3) : null;
    const runs = []; for (const r of ins) { const L = runs[runs.length - 1]; if (L && r.i === L.to + 1) L.to = r.i; else runs.push({ from: r.i, to: r.i }); }
    ses.summary = { frames: win.length, wakeF, stoodF, inside: ins.length, in15: win.filter(r => r.in15).length, insideRuns: runs.map(u => ({ fromS: +((u.from - wakeF) / 60).toFixed(3), toS: +((u.to - wakeF) / 60).toFixed(3), n: u.to - u.from + 1, video: vt(u.from) })),
      whyParts: [...new Set(ins.map(r => r.why))], maxRel: jr.rel, maxRelAtS: jr.i != null ? +((jr.i - wakeF) / 60).toFixed(3) : null, maxRelVideo: jr.i != null ? vt(jr.i) : null, maxRaw: Math.max(...win.slice(1).map(r => r.raw)), maxRelShaken: Math.max(0, ...win.slice(1).filter(shaken).map(r => r.rel)), shakenN: win.filter(shaken).length,
      maxDAng: Math.max(...win.slice(1).map(r => r.dAng)), minDp: Math.min(...win.map(r => r.dp)), dropMiss: win.length ? win[win.length - 1].dropMiss - win[0].dropMiss : 0,
      craneN: win.filter(r => r.crk > 0).length,
      closeAfterStood: (() => { const a = win.filter(r => r.stood); return a.length ? { n: a.length, dpLt27: a.filter(r => r.dp < 2.7).length, minDp: Math.min(...a.map(r => r.dp)) } : null; })() };
    // the hold after her rise: frames from the wake to the stand + 2 s where the lens is held within 2.7 u of his helmet
    ses.summary.close27 = win.filter(r => r.i >= wakeF && r.dp < 2.7).length;
    ses.summary.salOut = win.filter(r => r.salOut).length;   // frames his helmet is out of the drawn frame (a lens swung round to his front)
    ses.rows = win.map(r => ({ ...r, t: +((r.i - wakeF) / 60).toFixed(3), v: vt(r.i) }));
    out.sessions[cs] = ses;
    const s = ses.summary;
    const okIn = s.inside === 0, okJ = s.maxRel <= JUMP, okF = s.salOut === 0;
    out.bars[cs] = { inside: okIn, jump: okJ, framed: okF };
    console.log(`${cs}: ${okIn ? 'ok  ' : 'FAIL'} inside ${s.inside} frames (in15 ${s.in15}) runs ${JSON.stringify(s.insideRuns)} parts ${JSON.stringify(s.whyParts)} | ${okJ ? 'ok  ' : 'FAIL'} jump rel max ${s.maxRel} u at +${s.maxRelAtS} s${s.maxRelVideo != null ? ' (video ' + s.maxRelVideo + ' s)' : ''} (bar ${JUMP}; shaken frames apart: ${s.shakenN}, their max ${s.maxRelShaken}); raw ${s.maxRaw}, bearing ${s.maxDAng.toFixed(2)} deg; minDp ${s.minDp}; dropMiss ${s.dropMiss}; craneN ${s.craneN}; close27 ${s.close27}; salOut ${s.salOut}${ses.stand ? ' stand ' + JSON.stringify(ses.stand) : ''}`);
    if (!okF) console.log(`${cs}: FAIL framed: his helmet out of the drawn frame on ${s.salOut} frames`);
    if (!okIn || !okJ || !okF) anyFail = true;
    if (!win.some(r => r.stood)) { console.log(`${cs}: she never stood in the window (UNMEASURED)`); anyVoid = true; }
  }
} catch (e) { console.log('UNMEASURED: ' + (e && e.stack || e)); c.close(); process.exit(2); }
out.clocks = clocks;
console.log('clock ' + JSON.stringify(clocks));
mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(out));
console.log('JSON ' + OUT);
c.close();
if (clocks.some(unmeasured)) { console.log('UNMEASURED (clock)'); process.exit(2); }
if (clocks.some(lost)) { console.log('CLOCK LOST'); process.exit(4); }
console.log(anyFail ? 'FAIL' : anyVoid ? 'UNMEASURED' : 'PASS');
process.exit(anyFail ? 1 : anyVoid ? 2 : 0);
