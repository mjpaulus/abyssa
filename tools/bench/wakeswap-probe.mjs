// THE PLANTS NEAR HER DO NOT SWAP WHEN SHE WAKES (wakeswap, 2026-11-09; card roadmap/wake-plant-swap.md).
// Seen in both discovery takes (velkath-rise-*.mp4, frames 634 -> 636): at the wake the kelp, a tube sponge and an anemone near
// her changed between two frames. Measured cause: NOTHING about the plants' instances changes (the batch's matrices, visibility,
// LOD and variant arrays and every host mesh hash identically across the wake); what changes is stir.js's PLANT PUSH: the sleeper's
// sphere (~1.6 R = 24.6 u at home) went from absent to full in ONE frame when L.dormant fell, and the sway program (gardens.js
// PUSH_GLSL stirPush + the FLINCH term) bent every plant within ~47 u up to ~13 u (x flex) and withdrew the flinchers within ~110 u.
// So this probe judges the DRAWN displacement, not the instance data: a CPU replica of stirPush (and the FLINCH term's push share)
// at every shown plant instance near her, from the live uPush uniform, frame by frame across the wake (and, mode calm, the calm).
//   DRV_PORT=<own> node tools/bench/wakeswap-probe.mjs <wake|calm> <game port>
// Exit 0 pass | 3 a bar failed | 2 UNMEASURED (no wake / no plants) | 4 LOST (clock drift) | 1 the run failed.
// The take is vd-tools/rise2-rec.mjs mode B: a fresh profile, the plugged clock, the observer lens pinned (window.__camPin) 36 u off
// her centre at (98, 3), 5 u up, looking at (98, 39); he walks to the anchor with a REAL W and pulls with a REAL E (the real input path).
//   wake  every frame from the E to WAKE + 30 frames is stepped and rendered; booked from WAKE - 3 to WAKE + 30.
//   calm  as wake, then stepped until L.hasStood, __lev.cmd('calm') (the lab verb), booked from 3 frames before the first calmed
//         frame to 30 after.
// For every instance the plant kit shows (vis != 0) within NEAR 60 u (horizontal) of her centre, its TIP is the instance origin plus
// its matrix's up column (the plant's own height axis), and its flex is taken as 1 (the push's largest share: tips). Per frame:
//   disp  = sum over the live push spheres of stirPush(tip) except Sal's (his sphere moves with his own walk and the shove; booked
//           apart as dispSal), in world units;  flinch = the FLINCH term's push share (1 - smoothstep(2w, 4.5w, d)) at the origin.
// Bars (pre-registered before the fix was run; main measured: jump 3.9 u, flinch jump 1.0 on the frame her sphere appeared):
//   jump    the largest one-frame change of |disp| over the near instances < 0.5 u
//   flinch  the largest one-frame change of flinch < 0.25
//   same    the plant kit's instance hash (matrices, vis, lod, variant, host matrices) is identical over the window (a rebuild or a
//           LOD pop would show here; booked, a bar)
// Booked, not barred: the pinned lens's changed pixels frame to frame (> 60 codes summed RGB) over the window and their peak over
// the median (main: 299k against ~143k: 2.1x), from screenshots WS_PIX=1 (slow; default on in wake).
// WS_RED=snap  window.__stir.STIR.slpEase = 0 (the shipped snap): jump AND flinch must fail (exit 5 = the RED failed as it must,
//              3 = it did not). Unfixed main has no STIR: run it plain, it must exit 3.
// JSON -> WS_OUT (default out/probe/wakeswap-<mode>[-red].json under the cwd).
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || [8777, 8790, 8794, 8840, 9419].includes(P)) { console.error('set DRV_PORT to a port of its own'); process.exit(1); }
const [, , MODE, PORT] = process.argv;
if (!['wake', 'calm'].includes(MODE) || !PORT) { console.error('usage: DRV_PORT=<own> node tools/bench/wakeswap-probe.mjs <wake|calm> <game port>'); process.exit(1); }
const RED = process.env.WS_RED || '';
if (RED && RED !== 'snap') { console.error('WS_RED: snap'); process.exit(1); }
const PIX = process.env.WS_PIX ? process.env.WS_PIX === '1' : MODE === 'wake';
const NEAR = 60, BAR_JUMP = 0.5, BAR_FL = 0.25, W = 1920, H = 1080;
const START = [106.0, 11.3], WAY = [105.5, 33.25], OBS = { p: [98, 3], h: 5, t: [98, 39], th: 5 };
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join, dirname } = await import('node:path');
const { execFileSync } = await import('node:child_process');
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-wsp-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, lost, unmeasured } = await import('./clockplug.mjs');
const OUT = process.env.WS_OUT || `out/probe/wakeswap-${MODE}${RED ? '-red' : ''}.json`;
const SHOTS = OUT.replace(/\.json$/, '') + '-shots';
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
mkdirSync(dirname(OUT), { recursive: true });
if (PIX) mkdirSync(SHOTS, { recursive: true });
const FF = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(f => { try { execFileSync(f, ['-version']); return true; } catch (e) { return false; } });
const raw = f => execFileSync(FF, ['-loglevel', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });

await start('about:blank');
const c = await connect();
await c.send('Runtime.enable'); await c.send('Page.enable');
await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await c.send('Page.navigate', { url: `http://localhost:${PORT}/__fresh_profile_404` });
await sleep(800);
await c.ev(`(localStorage.removeItem('abyssa.chart.v1'), 1)`);
await c.send('Page.navigate', { url: `http://localhost:${PORT}/?bench&playtest` });
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev && !!window.__plants`, 300000, 500);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(1000);
await plug(c);
await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.weather.set(1, 0), window.__bench.step(30), 1)`);
await c.until(`(window.__bench.step(10), !!(window.lev && window.lev.sculpted && window.__plants.state().state === 'ready'))`, 60000, 100);
const fresh = await c.ev(`({ wound: !!window.lev.harpoon.wound, pulled: !!window.lev.harpoon.pulled, dormant: !!window.lev.dormant, stir: !!(window.__stir && window.__stir.STIR) })`);
console.log('FRESH', JSON.stringify(fresh));
if (fresh.wound || fresh.pulled || !fresh.dormant) { console.error('not a fresh harpoon'); process.exit(1); }
if (RED) { if (!fresh.stir) { console.error('WS_RED needs a build with __stir.STIR'); process.exit(1); } await c.ev(`(window.__stir.STIR.slpEase = 0, 1)`); }
await c.ev(`(['title','pause','ptPanel','ptToast','ptDock'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), 1)`);
await c.ev(`(async () => { const T = await import('/src/world/terrain.js'); const x = ${START[0]}, z = ${START[1]};
  window.__bench.place(x, z, Math.atan2(${WAY[0]} - x, ${WAY[1]} - z), 0); window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0); window.player.pitch = -0.05;
  window.__camPin = { p: [${OBS.p[0]}, T.terrainH(${OBS.p[0]}, ${OBS.p[1]}, 0) + ${OBS.h}, ${OBS.p[1]}], t: [${OBS.t[0]}, T.terrainH(${OBS.t[0]}, ${OBS.t[1]}, 0) + ${OBS.th}, ${OBS.t[1]}] }; return 1; })()`);
await c.ev(`(window.__helm = true, window.__bench.step(240, null, { render: true }), 1)`);
// page side: the replica (gardens.js PUSH_GLSL stirPush, and the FLINCH loop's push share) and the instance hash
await c.ev(`(async () => {
  const S = await import('/src/world/stir.js');
  const fnv = (h, a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const push = (wx, wy, wz, skipSal, out) => {
    let ax = 0, ay = 0, az = 0;
    for (let i = 0; i < S.uPush.value.length; i++) {
      const s = S.uPush.value[i], v = S.uPushV.value[i];
      if (s.w <= 0 || (skipSal === (s.w === 1.25))) continue;
      const dx = wx - s.x, dy = wy - s.y, dz = wz - s.z, rr = s.w * 1.9, dd = Math.hypot(dx, dz);
      if (dd > rr || Math.abs(dy) > rr * 1.4) continue;
      let k = 1 - ss(s.w * 0.35, rr, dd); k *= 1 - ss(rr * 0.6, rr * 1.4, Math.abs(dy));
      const awx = dd > 1e-3 ? dx / dd : 1, awz = dd > 1e-3 ? dz / dd : 0;
      let gx = v.x * 0.22, gz = v.z * 0.22; const dl = Math.hypot(gx, gz); if (dl > 0.9) { gx *= 0.9 / dl; gz *= 0.9 / dl; }
      ax += (awx * s.w * 0.55 + gx) * k; az += (awz * s.w * 0.55 + gz) * k; ay -= k * s.w * 0.12;
    }
    out[0] = ax; out[1] = ay; out[2] = az; return out;
  };
  const flinch = (x, y, z) => { let f = 0; for (const s of S.uPush.value) { if (s.w <= 0) continue; f = Math.max(f, 1 - ss(s.w * 2, s.w * 4.5, Math.hypot(x - s.x, y - s.y, z - s.z))); } return f; };
  const prev = new Map(), o3 = [0, 0, 0];
  window.__wsp = { reset: () => prev.clear(), snap: () => {
    const L = window.lev, cx = L.pos.x, cz = L.pos.z;
    let h = 2166136261, n = 0, jump = 0, jumpSal = 0, fj = 0, worst = null, maxD = 0;
    for (const G of window.__plants.groups.values()) {
      h = fnv(h, G.vis); h = fnv(h, G.lod); h = fnv(h, G.var); h = fnv(h, G.batch._matricesTexture.image.data);
      for (const K of G.hosts) if (K.im) h = fnv(h, K.im.instanceMatrix.array);
      const md = G.batch._matricesTexture.image.data;
      for (let i = 0; i < G.cap; i++) {
        if (!G.vis[i]) continue;
        const px = G.px[i * 3], py = G.px[i * 3 + 1], pz = G.px[i * 3 + 2];
        if (Math.hypot(px - cx, pz - cz) > ${NEAR}) continue;
        const e = 16 * i, tx = px + md[e + 4], ty = py + md[e + 5], tz = pz + md[e + 6];
        push(tx, ty, tz, true, o3); const d = Math.hypot(o3[0], o3[1], o3[2]), dx = o3[0], dy = o3[1], dz = o3[2];
        push(tx, ty, tz, false, o3); const dS = Math.hypot(o3[0], o3[1], o3[2]);
        const fl = flinch(px, py, pz), key = G.sp + i, q = prev.get(key);
        if (q) {
          const j = Math.hypot(dx - q[0], dy - q[1], dz - q[2]);
          if (j > jump) { jump = j; worst = { sp: G.sp, i, at: [+px.toFixed(1), +pz.toFixed(1)], dHer: +Math.hypot(px - cx, pz - cz).toFixed(1), from: +Math.hypot(q[0], q[1], q[2]).toFixed(2), to: +d.toFixed(2) }; }
          jumpSal = Math.max(jumpSal, Math.abs(dS - q[3])); fj = Math.max(fj, Math.abs(fl - q[4]));
          q[0] = dx; q[1] = dy; q[2] = dz; q[3] = dS; q[4] = fl;
        } else prev.set(key, [dx, dy, dz, dS, fl]);
        maxD = Math.max(maxD, d); n++;
      }
    }
    const sl = S.uPush.value.filter(s => s.w > 0 && s.w !== 1.25).map(s => +s.w.toFixed(2));
    return { n, hash: h.toString(16), jump: +jump.toFixed(3), jumpSal: +jumpSal.toFixed(3), flinchJump: +fj.toFixed(3), maxDisp: +maxD.toFixed(2), worst,
      dormant: !!L.dormant, calmed: !!L.calmed, bury: +(L.bury || 0).toFixed(3), spheres: sl, slp: window.__stir.slp ? window.__stir.slp() : null };
  } };
  return 1; })()`);

let gf = 0, pixN = 0;
const pix = [];
let lastShot = null;
const frame = async () => { await c.ev(`(window.__helm = true, window.__bench.step(1, null, { render: true }), 1)`); gf++; };
const shot = async () => {
  const f = `${SHOTS}/${String(pixN++).padStart(3, '0')}.png`;
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  if (lastShot && FF) { const a = raw(lastShot), b = raw(f); let n = 0; for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++; pix.push(n); }
  lastShot = f; return f;
};
for (let i = 0; i < 90; i++) await frame();
const AN = await c.ev(`[window.lev.harpoon.anchor.x, window.lev.harpoon.anchor.z]`);
await c.key('KeyW', true);
let tgt = WAY, leg = 0, promptAt = -1, last = null, lastF = 0;
for (let i = 0; i < 60 * 40; i++) {
  const s = await c.ev(`[window.player.pos.x, window.player.pos.z, window.player.yaw, !!window.lev.harpoon.prompt(window.player.pos)]`);
  if (s[3] && promptAt < 0) { promptAt = gf; tgt = AN; leg = 1; }
  if (promptAt >= 0) { const dA = Math.hypot(AN[0] - s[0], AN[1] - s[1]); if (dA < 1.0 || !s[3] || gf - promptAt > 90) break; }
  if (!last || gf - lastF >= 120) { const moved = last ? Math.hypot(s[0] - last[0], s[1] - last[1]) : 9; last = [s[0], s[1]]; lastF = gf;
    if (moved < 0.8) { await c.key('Space', true); for (let k = 0; k < 20; k++) await frame(); await c.key('Space', false); continue; } }
  if (leg === 0 && Math.hypot(tgt[0] - s[0], tgt[1] - s[1]) < 2.5) { leg = 1; tgt = AN; }
  const want = Math.atan2(tgt[0] - s[0], tgt[1] - s[1]);
  let d = want - s[2]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const mx = 1.4 / 60; d = Math.max(-mx, Math.min(mx, d));
  await c.ev(`(window.player.yaw = ${s[2] + d}, 1)`);
  await frame();
}
await c.key('KeyW', false);
if (promptAt < 0) { console.error('never reached the prompt'); process.exit(1); }
for (let i = 0; i < 48; i++) await frame();
if (!(await c.ev(`!!window.lev.harpoon.prompt(window.player.pos)`))) { console.error('no prompt where he stopped'); process.exit(1); }
await c.key('KeyE', true); await frame(); await frame(); await c.key('KeyE', false);
if (!(await c.ev(`!!window.lev.harpoon.wrenching`))) { console.error('real E did not start the wrench'); process.exit(1); }
console.log('E at game frame ' + gf);

// the window: a ring of the last 3 snaps before the event, then 30 after
const rows = [];
let ring = [], ev = -1;
const evExpr = MODE === 'wake' ? `!window.lev.dormant` : `!!window.lev.calmed`;
if (MODE === 'calm') {
  let k = 0; while (!(await c.ev(`!!window.lev.hasStood`)) && k++ < 1200) await c.ev(`(window.__helm = true, window.__bench.step(10), 1)`);
  if (!(await c.ev(`!!window.lev.hasStood`))) { console.error('she never stood'); process.exit(2); }
  await c.ev(`(window.__helm = true, window.__bench.step(30, null, { render: true }), 1)`);
  await c.ev(`(window.__lev.cmd('calm'), 1)`);
}
await c.ev(`(window.__wsp.reset(), 1)`);
for (let f = 0; f < 60 * 12; f++) {
  const s = await c.ev(`window.__wsp.snap()`); s.gf = gf;
  if (ev < 0 && await c.ev(evExpr)) { ev = gf; console.log(MODE + ' at game frame ' + gf); }
  s.k = ev < 0 ? null : gf - ev;
  if (ev < 0) { ring.push(s); if (ring.length > 3) ring.shift(); if (PIX && ring.length) await shot(); }
  else { if (rows.length === 0) rows.push(...ring); rows.push(s); if (PIX) await shot(); if (gf - ev >= 30) break; }
  await frame();
}
const clock = await drift(c);
if (ev < 0) { console.error('no ' + MODE + ' in the window'); writeFileSync(OUT, JSON.stringify({ mode: MODE, red: RED, clock, rows: ring }, null, 1)); process.exit(2); }
// the first row's jump compares with the ring's previous frame, so drop it from the bars only if it predates the ring (it does not)
const win = rows.slice(1);
const jump = Math.max(...win.map(r => r.jump)), fl = Math.max(...win.map(r => r.flinchJump)), worst = win.reduce((a, r) => r.jump > a.jump ? r : a, win[0]);
const hashes = [...new Set(rows.map(r => r.hash))];
const n = Math.min(...rows.map(r => r.n));
const med = pix.length ? [...pix].sort((a, b) => a - b)[pix.length >> 1] : null, peak = pix.length ? Math.max(...pix) : null;
const bars = { jump: jump < BAR_JUMP, flinch: fl < BAR_FL, same: hashes.length === 1 };
const res = { mode: MODE, red: RED, near: NEAR, n, event: ev, jump, flinchJump: fl, worst: worst && { k: worst.k, ...worst.worst, spheres: worst.spheres },
  jumpSal: Math.max(...win.map(r => r.jumpSal)), hashes, pix: pix.length ? { peak, median: med, ratio: +(peak / med).toFixed(2), series: pix } : null, bars, clock };
writeFileSync(OUT, JSON.stringify({ ...res, rows }, null, 1));
for (const r of rows) console.log(`k ${String(r.k).padStart(4)}  dormant ${+r.dormant} calmed ${+r.calmed} bury ${r.bury}  spheres ${JSON.stringify(r.spheres)}  n ${r.n}  jump ${r.jump}  flinchJump ${r.flinchJump}  maxDisp ${r.maxDisp}  sal ${r.jumpSal}  ${r.hash}`);
console.log(JSON.stringify(res));
c.close();
if (unmeasured(clock) || n === 0) { console.log('UNMEASURED'); process.exit(2); }
if (lost(clock)) { console.log('LOST'); process.exit(4); }
const fails = Object.entries(bars).filter(([, v]) => !v).map(([k]) => k);
if (RED) { const ok = !bars.jump && !bars.flinch; console.log(ok ? 'RED FAILED AS IT MUST (' + fails.join(', ') + ')' : 'RED DID NOT FAIL: ' + JSON.stringify(bars)); process.exit(ok ? 5 : 3); }
console.log(fails.length ? 'FAIL ' + fails.join(', ') : 'PASS');
process.exit(fails.length ? 3 : 0);
