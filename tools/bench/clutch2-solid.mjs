// CLUTCH2: the clutch as a SOFT SOLID and the lens round it, through real keys (W/A/D/Space/E).
// Alt+6, walk into the tongue (he must stop at the surface: frame strip), slide along it, pry
// a clump (E: she wakes and the tongue folds up past him), get under the hanging mass (she is
// held still with the lab 'hold' verb so the probe is about the clutch, not the hunt), rise to
// it (Space), press it back (E), she calms (the probe lights all but her last ward directly;
// the brood rule lights the last), walks home, he walks out, she settles and the tongue spills
// toward the lens. Per frame: the camera inside a lobe (margin 0) / inside any part of her,
// Sal's capsule inside a lobe, the clutch's push.
//   PORT=8831 DRV_PORT=9431 node tools/bench/clutch2-solid.mjs
import { connect, sleep } from './drv.mjs';
import { boot } from './clutch2-look.mjs';
const DIR = '/Users/michaelpaulus/sc/.abyssa-wt/shots/';
const PRE = process.env.SHOTS || 'clutch2';
const c = await connect();
await boot(c);
await c.ev(`(weather.set(${process.env.WX ?? 0}, 0), 1)`);
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(2500);
await c.ev(`(async () => { window.__B = await import('/src/entities/sleeper/bodyCols.js'); window.__T0 = await import('/src/world/terrain.js');
  window.__ck = { frames: 0, camIn: 0, camMax: 0, camAt: [], camBody: 0, camBodyAt: [], salMax: 0, salDeep: 0, pushMax: 0, contactFrames: 0, minCamFloor: 1e9 };
  window.__rT = performance.now(); window.__msgs = []; window.__ring = [];
  (function f() { const L = __sl, p = player.pos, cp = camera.position;
    const t = document.getElementById('msg').textContent; if (t && __msgs[__msgs.length - 1] !== t) __msgs.push(t);
    const ci = __B.inClutch(cp.x, cp.y, cp.z, 0);
    { const cs = __crecam.state(); __ring.push([+((performance.now() - __rT) / 1000).toFixed(2), +cp.distanceTo(p).toFixed(2), +ci.toFixed(2), __B.bodyBlocked(cp.x, cp.y, cp.z, 0.15) ? 1 : 0, cs.k, cs.camDist, cs.liftT, cs.eggs, +player.vel.y.toFixed(1), __power.state().state, document.hidden ? 'H' : '']); if (__ring.length > 24) __ring.shift(); if (ci > 0 && !__ck.ring) __ck.ring = __ring.slice(); }
    if (ci > 0) { __ck.camIn++; if (ci > __ck.camMax) __ck.camMax = ci; if (__ck.camAt.length < 20) __ck.camAt.push([+((performance.now() - __rT) / 1000).toFixed(1), +ci.toFixed(2), +L.stand.toFixed(2), JSON.stringify(__crecam.state()).slice(0, 160), +cp.distanceTo(p).toFixed(2), +player.vel.y.toFixed(2)]); }
    if (__B.bodyBlocked(cp.x, cp.y, cp.z, 0)) { __ck.camBody++; if (__ck.camBodyAt.length < 30) __ck.camBodyAt.push([+((performance.now() - __rT) / 1000).toFixed(1), __B.blockWhy, +L.stand.toFixed(2)]); }
    __ck.frames++;
    let sp = 0; for (const h of [-0.9, -0.45, 0]) { const v = __B.inClutch(p.x, p.y + h, p.z, 0.45); if (v > sp) sp = v; }
    if (sp > __ck.salMax) __ck.salMax = sp; if (sp > 0.1) __ck.salDeep++;
    if (__B.BODY.clPush > __ck.pushMax) __ck.pushMax = __B.BODY.clPush; if (__B.BODY.clutch) __ck.contactFrames++;
    if (performance.now() - __rT < 900000) requestAnimationFrame(f); })(); return 1; })()`);
const st = () => c.ev(`(() => { const L = __sl, B = L.brood, p = player.pos; return { held: B.held, calmed: L.calmed, dormant: L.dormant, stand: +L.stand.toFixed(2), reach: +B.reach(p).toFixed(2), prompt: B.prompt(p), g: player.grounded, feet: +(p.y - 1.35 - __T0.terrainH(p.x, p.z, 0)).toFixed(2), cam: +camera.position.distanceTo(p).toFixed(2), clPush: +__B.BODY.clPush.toFixed(3), lit: L.sigils.map(g => g.lit ? 1 : 0).join('') }; })()`);
let shot = 0; const snap = async n => { await c.png(DIR + PRE + '-' + n + '.png'); };
const faceTake = (dy = 0, pt = -0.3) => c.ev(`(() => { const t = __sl.brood.takeAt, p = player.pos; player.yaw = Math.atan2(t.x - p.x, t.z - p.z) + ${dy}; player.pitch = ${pt}; return 1; })()`);
// 1. walk in (the strip): the camera turned a little off his back so the tongue is in frame
console.log('start', JSON.stringify(await st()));
// (out past her rim first, with real keys: S held facing the clutch, so the lens is clear of her
// shell and the walk in is long enough to read)
await c.key('KeyS', true);
{ const t0 = Date.now(); while (Date.now() - t0 < +(process.env.BACK || 4000)) { await faceTake(0.3, -0.3); await sleep(70); } }
await c.key('KeyS', false); await sleep(800);
await faceTake(0.35, -0.3); await sleep(1500);
await snap('walkin-0'); console.log('walkin 0', JSON.stringify(await st()));
await c.key('KeyW', true);
for (let i = 1; i <= 5; i++) {
  const t0 = Date.now(); while (Date.now() - t0 < 900) { await faceTake(0.35, -0.3); await sleep(70); }
  await snap('walkin-' + i); console.log('walkin', i, JSON.stringify(await st()));
}
await c.key('KeyW', false);
// 2. slide: strafe along it, still pushing in
await c.key('KeyW', true); await c.key('KeyD', true);
{ const t0 = Date.now(); while (Date.now() - t0 < 2500) { await faceTake(0, -0.3); await sleep(70); } }
await c.key('KeyD', false); await c.key('KeyW', false); await sleep(400);
console.log('slid', JSON.stringify(await st()));
await snap('slide');
console.log('counters after walk-in', JSON.stringify(await c.ev(`__ck`)));
// 3. pry: back into reach, E
await faceTake(0, -0.3); await sleep(300);
console.log('pre-take', JSON.stringify(await st()));
await c.tap('KeyE', 100); await sleep(500);
console.log('took', JSON.stringify(await st()));
await snap('take');
await c.until(`__sl.stand >= 0.98`, 25000);
console.log('risen', JSON.stringify(await st()));
await snap('risen');
// she is held still (lab verb) so this probe is about the clutch, not the hunt
await c.ev(`(__sl.cmd('hold'), 1)`);
// 4. under the hanging mass: W toward it
const massXZ = `(() => { const v = new player.pos.constructor(0, -0.3, -0.26); __sl.body.localToWorld(v); return [v.x, v.z]; })()`;
async function steerTo(expr, near, ms) {
  await c.key('KeyW', true);
  const t0 = Date.now(); let d = 1e9;
  while (Date.now() - t0 < ms) {
    d = await c.ev(`(() => { const q = ${expr}; const p = player.pos; player.yaw = Math.atan2(q[0] - p.x, q[1] - p.z); player.pitch = -0.1; return Math.hypot(q[0] - p.x, q[1] - p.z); })()`);
    if (d < near) break;
    await sleep(90);
  }
  await c.key('KeyW', false);
  return d;
}
console.log('to mass', await steerTo(massXZ, 1.2, 40000), JSON.stringify(await st()));
await sleep(2000);
await c.ev(`(player.pitch = 0.5, 1)`); await sleep(800);
await snap('under-0');
console.log('under', JSON.stringify(await st()), 'mass bottom over floor', await c.ev(`(() => { const v = new player.pos.constructor(0, -0.40, -0.27); __sl.body.localToWorld(v); return +(v.y - __T0.terrainH(v.x, v.z, 0)).toFixed(1); })()`));
// 5. up to it (taps, then short bursts), E as soon as it is in reach
let back = false;
for (let a = 0; a < 6 && !back; a++) {
  if (await c.ev(`__sl.brood.canReturn(player.pos)`)) { await c.tap('KeyE', 100); back = true; break; }
  await c.ev(`(player.pitch = 0.9, 1)`);
  await c.key('Space', true); const t0 = Date.now();
  while (Date.now() - t0 < (a ? 380 : 120)) { if (await c.ev(`__sl.brood.canReturn(player.pos)`)) { await c.tap('KeyE', 100); back = true; break; } await sleep(30); }
  await c.key('Space', false);
  const t1 = Date.now();
  while (!back && Date.now() - t1 < 2500) { if (await c.ev(`__sl.brood.canReturn(player.pos)`)) { await c.ev(`(player.pitch = 0.6, 1)`); await snap('under-touch'); await c.tap('KeyE', 100); back = true; break; } await sleep(40); }
  console.log(' rise', a, back, JSON.stringify(await st()));
  if (a === 1) await snap('under-1');
}
console.log('returned', back, JSON.stringify(await st()));
await sleep(300); await snap('pressed-back');
// down, then the calm: all but her last ward lit by the probe; the brood rule lights the last
await c.key('KeyC', true); { const t0 = Date.now(); while (Date.now() - t0 < 8000 && !(await c.ev(`player.grounded`))) await sleep(100); } await c.key('KeyC', false);
await c.ev(`(() => { const S = __sl.sigils; for (let i = 0; i < S.length - 1; i++) S[i].lit = true; return 1; })()`);
await c.ev(`(__sl.hold = false, 1)`);
await c.until(`__sl.calmed`, 20000).catch(() => console.log('NOT CALMED'));
console.log('calm', JSON.stringify(await st()));
// he walks out from under her (W away from her centre), then watches her settle from beside the tongue
await c.key('KeyW', true);
{ const t0 = Date.now(); while (Date.now() - t0 < 9000) { await c.ev(`(player.yaw = Math.atan2(player.pos.x - __sl.pos.x, player.pos.z - __sl.pos.z), player.pitch = -0.05, 1)`); await sleep(120); } }
await c.key('KeyW', false);
for (let i = 0; i < 8; i++) {
  await sleep(2500);
  await faceTake(0.6, -0.25);
  if (i % 2 === 1) await snap('settle-' + (i >> 1));
  console.log('settle', i, JSON.stringify(await st()), 'homeTurn', await c.ev(`!!__sl.homeTurn`));
}
// THE SETTLE BESIDE HIM (the game's own path): Alt+6 (re-arms her asleep, Sal on the tongue),
// wake her and hold her, light all but her last ward (the brood rule lights the last: no clump
// is out), so she is calmed at home: she must NOT settle while he stands on her clutch's bed;
// he backs off a few steps (S) facing it and she settles, the tongue spilling toward the lens
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(2500);
await faceTake(0.5, -0.3); await sleep(800);
await c.ev(`(__sl.cmd('wake'), __sl.hold = true, 1)`);
await c.until(`__sl.stand >= 0.98`, 25000).catch(() => console.log('no stand'));
await c.ev(`(() => { const S = __sl.sigils; for (let i = 0; i < S.length - 1; i++) S[i].lit = true; __sl.hold = false; return 1; })()`);
await c.until(`__sl.calmed`, 20000).catch(() => console.log('NOT CALMED'));
await faceTake(0.5, -0.3); await sleep(1000); await snap('resettle-0-up');
for (let i = 0; i < 3; i++) { await sleep(1500); await faceTake(0.5, -0.3); console.log('on her bed', i, JSON.stringify(await st()), 'homeTurn', await c.ev(`!!__sl.homeTurn`), 'onBed', await c.ev(`__sl.brood.onBed(player.pos)`)); }
await c.key('KeyS', true); { const t0 = Date.now(); while (Date.now() - t0 < 2200) { await faceTake(0.3, -0.3); await sleep(70); } } await c.key('KeyS', false);
for (let i = 1; i <= 4; i++) { await sleep(1500); await faceTake(0.4, -0.3); await snap('resettle-' + i); console.log('resettle', i, JSON.stringify(await st()), 'onBed', await c.ev(`__sl.brood.onBed(player.pos)`)); }
await sleep(3000); await c.key('KeyW', true); { const t0 = Date.now(); while (Date.now() - t0 < 2500) { await faceTake(-0.4, -0.35); await sleep(70); } } await c.key('KeyW', false);
await sleep(1200); await snap('after-settle');
console.log('end', JSON.stringify(await st()));
console.log('msgs', JSON.stringify(await c.ev(`__msgs`)));
console.log('CLUTCH', JSON.stringify(await c.ev(`__ck`)));
console.log('sf', JSON.stringify(await c.ev(`__shaderFailed()`)));
c.close();
