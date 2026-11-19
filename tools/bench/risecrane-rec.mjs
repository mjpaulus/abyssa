// THE RISE CAMERA'S TAKES (risecrane 2026-11-19, card roadmap/rise-camera-swing.md): frames for the before / after videos.
//   DRV_PORT=<own> node tools/bench/risecrane-rec.mjs <stay|beside> <game port> <frames dir> <log json>
// stay    vd-tools/rise2-rec.mjs mode A's inputs (the play lens; the same placement, settle and real-key W walk to the harpoon's anchor,
//         ~0.8 s stood, REAL E), but after the pull he STAYS PUT next to her: no key and no look at all until she has stood + HOLD s.
// beside  riseclip-probe's e2_0_b stand: 2 u off her strip's edge on her sand side, his back to her, 90 rendered settle frames, woken by
//         lev.cmd('wake'), hands off until she has stood + HOLD s.
// Both: a fresh profile (abyssa.chart.v1 removed before the load), the clock PLUGGED (clockplug.mjs), Math.random seeded on every document
// and re-seeded from the plugged frame count before every stepped frame (riseclip-probe's rule: the lens shake is random, and the before
// and after takes must draw the same numbers), every game frame rendered, every EVERY-th captured (2 = 30 fps of game time), 1920x1080.
// ENV: VD_HOLD (s after the stand, default 4), VD_EVERY (default 2), VD_CRANE (sets __risecrane.knobs.on; unset = the build's own), VD_SEED.
// The log books per captured frame: the lens, his place, her state, __risecrane / __risecam / __crecam state, his helmet's NDC.
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 8794, 8840, 9419].includes(P)) { console.error('set DRV_PORT to a port of its own'); process.exit(2); }
const [, , MODE, PORT, DIR, LOG] = process.argv;
if (!['stay', 'beside'].includes(MODE) || !/^\d+$/.test(PORT || '') || !DIR || !LOG) { console.error('usage: DRV_PORT=<own> node tools/bench/risecrane-rec.mjs <stay|beside> <game port> <frames dir> <log json>'); process.exit(2); }
const START = [106.0, 11.3], WAY = [105.5, 33.25];
const HOLD = +(process.env.VD_HOLD || 4), EVERY = +(process.env.VD_EVERY || 2), W = 1920, H = 1080;
const CRANE = process.env.VD_CRANE == null || process.env.VD_CRANE === '' ? null : +process.env.VD_CRANE;
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-rcrec-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, lost, unmeasured } = await import('./clockplug.mjs');
let started = false;
process.on('exit', () => { if (started) stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
mkdirSync(DIR, { recursive: true });
await start('about:blank'); started = true;
const c = await connect();
await c.send('Runtime.enable'); await c.send('Page.enable');
await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let a = ${+(process.env.VD_SEED || 12345)} >>> 0;
  const s0 = a; window.__cpSeed = f => { a = (s0 ^ Math.imul(f + 1, 0x9E3779B1)) >>> 0; };
  Math.random = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();` });
await c.send('Page.navigate', { url: `http://localhost:${PORT}/__fresh_profile_404` });
await sleep(800);
await c.ev(`(localStorage.removeItem('abyssa.chart.v1'), 1)`);
await c.send('Page.navigate', { url: `http://localhost:${PORT}/?bench&playtest` });
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(1000);
await plug(c);
await c.ev(`(window.__plugClk.clock.elapsedTime = 500, window.__plugClk.e0 = 500, 1)`);
await c.ev(`(() => { const K = window.__plugClk, S1 = window.__bench.step;
  window.__bench.step = (n, fn, o) => { window.__cpSeed(K.n); return S1(n, i => { const r = fn ? fn(i) : undefined; window.__cpSeed(K.n); return r; }, o); }; return 1; })()`);
await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.weather.set(1, 0), 1)`);
await c.until(`!!(window.lev && window.lev.sculpted)`, 60000, 100);
await c.ev(`(window.__helm = true, window.__bench.step(60), 1)`);
const fresh = await c.ev(`(() => { const H = window.lev.harpoon; return { wound: !!H.wound, hPulled: !!H.pulled, dormant: !!window.lev.dormant, view: [innerWidth, innerHeight], crane: !!window.__risecrane }; })()`);
console.log('FRESH', JSON.stringify(fresh));
if (fresh.wound || fresh.hPulled || !fresh.dormant) { console.error('not a fresh harpoon'); process.exit(1); }
if (fresh.view[0] !== W || fresh.view[1] !== H) { console.error('viewport is ' + fresh.view); process.exit(2); }
if (CRANE != null) await c.ev(`(window.__risecrane && (window.__risecrane.knobs.on = ${CRANE}), 1)`);
await c.ev(`(['title','pause','ptPanel','ptToast','ptDock'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), 1)`);
let n = 0, ph = 0, gf = 0;
const log = [];
const ST = `(async () => { const { camera } = await import('/src/core.js'); const L = window.lev, P = window.player, r = v => +v.toFixed(3);
  const v = P.pos.clone(); v.y += 0.4; camera.updateMatrixWorld(); v.applyMatrix4(camera.matrixWorldInverse); const front = v.z < 0; v.applyMatrix4(camera.projectionMatrix);
  const k = window.__risecrane ? window.__risecrane.state() : null, rc = window.__risecam.state(), cr = window.__crecam.state();
  return { p: [r(P.pos.x), r(P.pos.y), r(P.pos.z)], yaw: r(P.yaw), dL: r(Math.hypot(P.pos.x - L.pos.x, P.pos.z - L.pos.z)), dormant: !!L.dormant, stand: r(L.stand || 0), stood: !!L.hasStood,
    cam: [r(camera.position.x), r(camera.position.y), r(camera.position.z)], ndc: [r(v.x), r(v.y)], salOut: !front || Math.abs(v.x) > 1 || Math.abs(v.y) > 1,
    crane: k ? { k: k.k, why: k.why, alt: k.alt, b: k.bearingDeg } : null, rc: rc.why, rcAmt: rc.amt, cre: { eng: cr.eng, drop: cr.drop } }; })()`;
const grab = async () => {
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  writeFileSync(`${DIR}/${String(n).padStart(4, '0')}.png`, Buffer.from(r.result.data, 'base64'));
  const s = await c.ev(ST); s.i = n; s.t = +(n * EVERY / 60).toFixed(3); s.gf = gf; log.push(s); n++;
};
const frame = async () => { await c.ev(`(window.__helm = true, window.__bench.step(1, null, { render: true }), 1)`); gf++; if (++ph === EVERY) { ph = 0; await grab(); } };
const marks = {};
const save = extra => writeFileSync(LOG, JSON.stringify({ mode: MODE, every: EVERY, crane: CRANE, marks, ...extra, log }, null, 0));
if (MODE === 'stay') {
  await c.ev(`(async () => { const T = await import('/src/world/terrain.js'); const x = ${START[0]}, z = ${START[1]};
    window.__bench.place(x, z, Math.atan2(${WAY[0]} - x, ${WAY[1]} - z), 0); window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0); window.player.pitch = -0.05; return 1; })()`);
  await c.ev(`(window.__helm = true, window.__bench.step(150, null, { render: true }), 1)`);
  for (let i = 0; i < 90; i++) await frame();
  const AN = await c.ev(`[window.lev.harpoon.anchor.x, window.lev.harpoon.anchor.z]`);
  await c.key('KeyW', true);
  marks.walk = n;
  let tgt = WAY, leg = 0, promptAt = -1, last = null, lastF = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const s = await c.ev(`[window.player.pos.x, window.player.pos.z, window.player.yaw, !!window.lev.harpoon.prompt(window.player.pos)]`);
    if (s[3] && promptAt < 0) { promptAt = gf; marks.promptSeen = n; tgt = AN; leg = 1; }
    if (promptAt >= 0) { const dA = Math.hypot(AN[0] - s[0], AN[1] - s[1]); if (dA < 1.0 || !s[3] || gf - promptAt > 90) break; }
    if (!last || gf - lastF >= 120) { const moved = last ? Math.hypot(s[0] - last[0], s[1] - last[1]) : 9; last = [s[0], s[1]]; lastF = gf;
      if (moved < 0.8) { console.log('stalled at game frame ' + gf + ': Space'); await c.key('Space', true); for (let k = 0; k < 20; k++) await frame(); await c.key('Space', false); continue; } }
    if (leg === 0 && Math.hypot(tgt[0] - s[0], tgt[1] - s[1]) < 2.5) { leg = 1; tgt = AN; }
    const want = Math.atan2(tgt[0] - s[0], tgt[1] - s[1]);
    let d = want - s[2]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const mx = 1.4 / 60; d = Math.max(-mx, Math.min(mx, d));
    await c.ev(`(window.player.yaw = ${s[2] + d}, 1)`);
    await frame();
  }
  await c.key('KeyW', false);
  marks.prompt = n;
  if (promptAt < 0) { console.error('never reached the prompt'); save({}); process.exit(1); }
  for (let i = 0; i < 48; i++) await frame();
  if (!(await c.ev(`!!window.lev.harpoon.prompt(window.player.pos)`))) { console.error('no prompt where he stopped'); process.exit(1); }
  marks.e = n;
  await c.key('KeyE', true); await frame(); await frame(); await c.key('KeyE', false);
  if (!(await c.ev(`!!window.lev.harpoon.wrenching`))) { console.error('real E did not start the wrench'); process.exit(1); }
} else {
  marks.place = await c.ev(`(async () => { const T = await import('/src/world/terrain.js'); const L = window.lev, MD = L.mound, j = Math.round((L.sandSide > 0 ? 0 : 0.5) * MD.COLS) % MD.COLS;
    const ex = MD.P[j * 3], ez = MD.P[j * 3 + 2], cx = MD.bx, cz = MD.bz; let ux = ex - cx, uz = ez - cz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const x = ex + ux * 2, z = ez + uz * 2, yaw = Math.atan2(cx - x, cz - z) + Math.PI;
    window.__bench.place(x, z, yaw, 0); window.player.pos.y = Math.max(T.shutFloorY(x, z, 0), T.extraFloorAt ? T.extraFloorAt(x, z, 0) : -1e9) + 1.35; window.player.vel.set(0, 0, 0);
    return [+x.toFixed(2), +z.toFixed(2)]; })()`);
  await c.ev(`(window.__helm = true, window.__bench.step(90, null, { render: true }), 1)`);
  for (let i = 0; i < 60; i++) await frame();   // 1 s stood before the wake
  marks.e = n;
  await c.ev(`(window.__lev.cmd('wake'), 1)`);
}
let wakeF = -1, stoodF = -1;
for (let f = 0; f < 60 * 30; f++) {
  await frame();
  if (wakeF < 0) { if (!(await c.ev(`!!window.lev.dormant`))) { wakeF = gf; marks.wake = n; console.log('woke at game frame ' + gf); } continue; }
  if (stoodF < 0 && await c.ev(`!!window.lev.hasStood`)) { stoodF = gf; marks.stood = n; console.log('stood at game frame ' + gf + ' (+' + ((gf - wakeF) / 60).toFixed(2) + ' s)'); }
  if (stoodF >= 0 && gf - stoodF >= HOLD * 60 && ph === 0) break;
}
const clock = await drift(c);
const out = { frames: n, gameFrames: gf, wakeF, stoodF, clock, unmeasured: unmeasured(clock), lost: lost(clock) };
console.log(JSON.stringify(out));
save({ out });
c.close(); process.exit(lost(clock) || unmeasured(clock) ? 4 : 0);
