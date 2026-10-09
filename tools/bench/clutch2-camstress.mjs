// CLUTCH2: the lens under the hanging mass, stressed. Alt+6, wake her and hold her, walk under
// the mass, then ~2 min of real Space bursts up into it from under, turning (yaw) between
// bursts, pitch swinging. Per frame: the lens inside a lobe (margin 0); the first offence dumps
// the last 24 frames. PORT=8831 DRV_PORT=9431 node tools/bench/clutch2-camstress.mjs
import { connect, sleep } from './drv.mjs';
import { boot } from './clutch2-look.mjs';
const c = await connect();
await boot(c);
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(2500);
await c.ev(`(async () => { window.__B = await import('/src/entities/sleeper/bodyCols.js');
  window.__ck = { frames: 0, camIn: 0, camMax: 0, at: [] }; window.__ring = []; window.__rT = performance.now();
  (function f() { const p = player.pos, cp = camera.position, ci = __B.inClutch(cp.x, cp.y, cp.z, 0), cs = __crecam.state();
    __ring.push([+((performance.now() - __rT) / 1000).toFixed(2), +cp.distanceTo(p).toFixed(2), +ci.toFixed(2), __B.bodyBlocked(cp.x, cp.y, cp.z, 0.15) ? 1 : 0, cs.k, cs.camDist, cs.liftT, cs.eggs, cs.eggFail, +player.vel.y.toFixed(1)]);
    if (__ring.length > 24) __ring.shift();
    __ck.frames++; if (ci > 0) { __ck.camIn++; if (ci > __ck.camMax) __ck.camMax = ci; if (!__ck.ring) __ck.ring = __ring.slice(); }
    if (performance.now() - __rT < 600000) requestAnimationFrame(f); })(); return 1; })()`);
await c.ev(`(__sl.cmd('wake'), __sl.hold = true, 1)`);
await c.until(`__sl.stand >= 0.98`, 25000);
const massXZ = `(() => { const v = new player.pos.constructor(0, -0.3, -0.26); __sl.body.localToWorld(v); return [v.x, v.z]; })()`;
await c.key('KeyW', true);
{ const t0 = Date.now(); while (Date.now() - t0 < 30000) { const d = await c.ev(`(() => { const q = ${massXZ}; const p = player.pos; player.yaw = Math.atan2(q[0] - p.x, q[1] - p.z); player.pitch = -0.1; return Math.hypot(q[0] - p.x, q[1] - p.z); })()`); if (d < 1.5) break; await sleep(90); } }
await c.key('KeyW', false);
const T0 = Date.now(); let n = 0;
while (Date.now() - T0 < +(process.env.MS || 120000)) {
  await c.ev(`(player.yaw += ${(Math.random() - 0.5) * 2.4}, player.pitch = ${(Math.random() * 1.4 - 0.4).toFixed(2)}, 1)`);
  await c.key('Space', true); await sleep(150 + Math.random() * 450); await c.key('Space', false);
  await sleep(600 + Math.random() * 900);
  if (Math.random() < 0.3) { await c.key('KeyW', true); await sleep(400); await c.key('KeyW', false); }
  // back under it if he drifted out
  const d = await c.ev(`(() => { const q = ${massXZ}; return Math.hypot(q[0] - player.pos.x, q[1] - player.pos.z); })()`);
  if (d > 4) { await c.key('KeyC', true); await sleep(1500); await c.key('KeyC', false); await c.key('KeyW', true); const t1 = Date.now(); while (Date.now() - t1 < 6000) { const e = await c.ev(`(() => { const q = ${massXZ}; const p = player.pos; player.yaw = Math.atan2(q[0] - p.x, q[1] - p.z); return Math.hypot(q[0] - p.x, q[1] - p.z); })()`); if (e < 1.5) break; await sleep(90); } await c.key('KeyW', false); }
  n++;
}
console.log('bursts', n, JSON.stringify(await c.ev(`(() => { const s = __crecam.state(); return Object.assign({}, __ck, { eggs: s.eggs, eggFail: s.eggFail }); })()`)));
c.close();
