// THE RISE, RECORDED IN THE PLAY LENS (sandrise, 2026-10-31): frames for a true-speed video of Velkath's rise from the real loop's update on the
// PLUGGED clock (riteplay's RP_VIDEO way: every 3rd game frame rendered through the real pipeline and captured, 20 fps of game time).
//   DRV_PORT=<own> node tools/bench/sandrise-rec.mjs <anchor|off> <game port> <frames dir> [stills dir]
// anchor: Alt+6 (the harpoon's anchor) and REAL E over CDP (the wrench, the free, the wake 0.7 s later), 1.5 s before E to 11 s after the wake.
// off: him 12 u off her strip's edge on her sand side, facing her centre (burial-probe's BP_AT=off), woken by lev.cmd('wake') (the pull's own
// onWake: a pull aborts away from the anchor), 1.5 s before the wake to 11 s after it. The lens is the play lens (no pin), his look untouched.
// Stills (full resolution): asleep (the frame before E / the wake), +1 s, +3 s after the wake, and STOOD (L.hasStood's first frame + 0.5 s).
// The playtest panel, toast and dock are hidden (riteplay's list); the HUD stays.
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || [8777, 8790, 9419].includes(P)) { console.error('set DRV_PORT to a port of its own'); process.exit(2); }
const [, , AT, PORT, DIR, STILLS] = process.argv;
if (!['anchor', 'off'].includes(AT) || !PORT || !DIR) { console.error('usage: DRV_PORT=<own> node tools/bench/sandrise-rec.mjs <anchor|off> <port> <frames dir> [stills dir]'); process.exit(2); }
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-srrec-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift } = await import('./clockplug.mjs');
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
mkdirSync(DIR, { recursive: true }); if (STILLS) mkdirSync(STILLS, { recursive: true });
await start('about:blank');
const c = await connect();
await c.send('Runtime.enable'); await c.send('Page.enable');
await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await c.send('Page.navigate', { url: `http://localhost:${PORT}/?bench&playtest` });
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(1000);
await plug(c);
await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.weather.set(1, 0), window.__bench.step(30), 1)`);
await c.until(`(window.__bench.step(10), !!(window.lev && window.lev.sculpted))`, 30000, 100);
await c.ev(`(['title','pause','ptPanel','ptToast','ptDock'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), 1)`);
if (AT === 'anchor') await c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit6',key:'6',altKey:true,bubbles:true})), window.dispatchEvent(new KeyboardEvent('keyup',{code:'Digit6',key:'6',altKey:true,bubbles:true})), window.__helm=true, 1)`);
else await c.ev(`(async () => { const T = await import('/src/world/terrain.js'); const L = window.lev, MD = L.mound, j = Math.round((L.sandSide > 0 ? 0 : 0.5) * MD.COLS) % MD.COLS;
  const ex = MD.P[j * 3], ez = MD.P[j * 3 + 2], cx = MD.bx, cz = MD.bz; let ux = ex - cx, uz = ez - cz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const x = ex + ux * 12, z = ez + uz * 12; window.__bench.place(x, z, Math.atan2(cx - x, cz - z), 0); window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0); window.player.pitch = -0.12; return 1; })()`);
await c.ev(`(window.__helm = true, window.__bench.step(150, null, { render: true }), 1)`);   // settled: the post chain, the lens, the exposure
let n = 0, ph = 0;
const grab = async () => { const r = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 800, scale: 0.75 } }); writeFileSync(`${DIR}/${String(n++).padStart(4, '0')}.png`, Buffer.from(r.result.data, 'base64')); };
const still = async name => { if (!STILLS) return; const r = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${STILLS}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
// one game frame, rendered; every 3rd captured
const frame = async () => { await c.ev(`(window.__helm = true, window.__bench.step(1, null, { render: true }), 1)`); if (++ph === 3) { ph = 0; await grab(); } };
for (let i = 0; i < 90; i++) await frame();
await still('asleep');
let wakeF = -1, f = 0, stoodF = -1;
if (AT === 'anchor') { await c.key('KeyE', true); await frame(); await frame(); await c.key('KeyE', false); f = 2;
  if (!(await c.ev(`!!window.lev.harpoon.wrenching`))) { console.error('real E did not start the wrench'); process.exit(1); } }
else { await c.ev(`(window.__lev.cmd('wake'), 1)`); }
const marks = { 60: 'w1', 180: 'w3' };
for (; f < 60 * 20; f++) {
  await frame();
  if (wakeF < 0 && !(await c.ev(`!!window.lev.dormant`))) { wakeF = f; console.log('woke at frame ' + f); }
  if (wakeF >= 0) { const k = f - wakeF; if (marks[k]) await still(marks[k]);
    if (stoodF < 0 && await c.ev(`!!window.lev.hasStood`)) stoodF = f;
    if (stoodF >= 0 && f - stoodF === 30) await still('stood');
    if (k >= 11 * 60) break; }
}
const st = await c.ev(`({ rc: window.__risecam ? (({ qPre, ...o }) => o)(window.__risecam.state()) : null, plume: window.__plume.state(), shed: window.__burial.shedState ? window.__burial.shedState() : null })`);
console.log(JSON.stringify({ frames: n, wakeF, stoodF, st, clock: await drift(c) }));
c.close(); process.exit(0);
