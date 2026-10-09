// CLUTCH2: the now-solid hanging mass against the rest of the rite (real keys: W/Space/C/E).
// (a) Alt+6, E (the take wakes her), she is HELD still (lab verb) and Sal walks under each dark
//     ward and goes up to it with Space taps/bursts, as brooder-clutch-rite.mjs did: does each
//     light (the last must refuse while the clump is out), is he ever inside the eggs?
// (b) hold off: she hunts and CROUCHES over him under her; the clearance from his helmet to the
//     drawn (lumped + filleted) mass over him, then [E] press-back standing / after a hop.
//   PORT=8831 DRV_PORT=9431 node tools/bench/clutch2-wards.mjs
import { connect, sleep } from './drv.mjs';
import { boot } from './clutch2-look.mjs';
const SH = '/Users/michaelpaulus/sc/.abyssa-wt/shots/clutch2-';
const c = await connect();
await boot(c);
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(2500);
await c.ev(`(async () => { window.__B = await import('/src/entities/sleeper/bodyCols.js'); window.__T0 = await import('/src/world/terrain.js');
  window.__ck = { frames: 0, salMax: 0, salDeep: 0, camIn: 0 }; window.__rT = performance.now(); window.__msgs = [];
  (function f() { const p = player.pos, cp = camera.position;
    const t = document.getElementById('msg').textContent; if (t && __msgs[__msgs.length - 1] !== t) __msgs.push(t);
    let sp = 0; for (const h of [-0.9, -0.45, 0]) sp = Math.max(sp, __B.inClutch(p.x, p.y + h, p.z, 0.45));
    if (sp > __ck.salMax) __ck.salMax = sp; if (sp > 0.1) __ck.salDeep++;
    if (__B.inClutch(cp.x, cp.y, cp.z, 0) > 0) __ck.camIn++;
    __ck.frames++; if (performance.now() - __rT < 900000) requestAnimationFrame(f); })(); return 1; })()`);
// (the drawn mass right over his helmet: the first height above it inside the eggs)
const gap = `(() => { const p = player.pos; for (let y = p.y + 0.45; y < p.y + 14; y += 0.05) if (__B.inClutch(p.x, y, p.z, 0) > 0) return +(y - p.y - 0.45).toFixed(2); return null; })()`;
const st = () => c.ev(`(() => { const L = __sl, B = L.brood, p = player.pos; return { lit: L.sigils.map(g => g.lit ? 1 : 0).join(''), held: B.held, stand: +L.stand.toFixed(2), crouch: L.crouch ? +L.crouch.x.toFixed(2) : 0, g: player.grounded, feet: +(p.y - 1.35 - __T0.terrainH(p.x, p.z, 0)).toFixed(2), reach: +B.reach(p).toFixed(2), canRet: B.canReturn(p), calmed: L.calmed }; })()`);
async function steerTo(expr, near, ms) {
  await c.key('KeyW', true);
  const t0 = Date.now(); let d = 1e9;
  while (Date.now() - t0 < ms) {
    d = await c.ev(`(() => { const q = ${expr}; if (!q) return -1; const p = player.pos; player.yaw = Math.atan2(q[0] - p.x, q[1] - p.z); player.pitch = -0.05; return Math.hypot(q[0] - p.x, q[1] - p.z); })()`);
    if (d >= 0 && d < near) break;
    await sleep(90);
  }
  await c.key('KeyW', false);
  return d;
}
async function down() { await c.key('KeyC', true); const t0 = Date.now(); while (Date.now() - t0 < 10000 && !(await c.ev(`player.grounded`))) await sleep(100); await c.key('KeyC', false); }
await c.tap('KeyE', 100); await sleep(400);
await c.until(`__sl.stand >= 0.98`, 25000);
await c.ev(`(__sl.hold = true, 1)`);
console.log('(a) held, clump out', JSON.stringify(await st()));
const wards = await c.ev(`__sl.sigils.length`);
for (let w = 0; w < wards; w++) {
  const wp = `(() => { const g = __sl.sigils[${w}]; return [g.grp.position.x, g.grp.position.z]; })()`;
  const info = await c.ev(`(() => { const g = __sl.sigils[${w}], p = g.grp.position; return { lit: g.lit, over: +(p.y - __T0.terrainH(p.x, p.z, 0)).toFixed(1), eggsBelowWard: (() => { for (let y = p.y; y > p.y - 12; y -= 0.1) if (__B.inClutch(p.x, y, p.z, 0) > 0) return +(p.y - y).toFixed(1); return null; })() }; })()`);
  console.log(' ward', w, JSON.stringify(info));
  if (info.lit) continue;
  const d = await steerTo(wp, 1.2, 30000);
  const before = (await st()).lit;
  let lit = false;
  for (let b = 0; b < 5 && !lit; b++) {
    await c.ev(`(player.pitch = 0.6, 1)`);
    await c.key('Space', true); await sleep(b === 0 ? 120 : 320); await c.key('Space', false);
    await sleep(1200);
    const s = await st();
    console.log('   press', b, JSON.stringify(s), 'gap', await c.ev(gap));
    if (s.lit !== before) lit = true;
    if (b === 1) await c.png(SH + 'ward' + w + '-reach.png');
  }
  console.log('  ward', w, 'steer', +d.toFixed ? d.toFixed(2) : d, 'lit', lit);
  await down();
}
console.log('(a) end', JSON.stringify(await st()), 'msgs', JSON.stringify(await c.ev(`__msgs.slice(-4)`)));
// (b) she hunts again; under her she crouches
await c.ev(`(__sl.hold = false, 1)`);
const massXZ = `(() => { const v = new player.pos.constructor(0, -0.3, -0.26); __sl.body.localToWorld(v); return [v.x, v.z]; })()`;
let back = false;
for (let k = 0; k < 4 && !back; k++) {
  await steerTo(massXZ, 1.0, 20000);
  await sleep(2500);
  const s = await st();
  console.log('(b) under', k, JSON.stringify(s), 'gap over helmet', await c.ev(gap));
  if (k === 0) { await c.ev(`(player.pitch = 0.45, 1)`); await sleep(600); await c.png(SH + 'crouch-under.png'); }
  if (s.canRet) { await c.tap('KeyE', 100); back = true; console.log('  pressed back STANDING'); break; }
  await c.ev(`(player.pitch = 0.7, 1)`);
  await c.key('Space', true); await sleep(120); await c.key('Space', false);
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) { if (await c.ev(`__sl.brood.canReturn(player.pos)`)) { await c.tap('KeyE', 100); back = true; console.log('  pressed back after a HOP', JSON.stringify(await st())); break; } await sleep(40); }
  await down();
}
await sleep(1500);
console.log('(b) end', JSON.stringify(await st()), 'msgs', JSON.stringify(await c.ev(`__msgs.slice(-4)`)));
console.log('COUNTERS', JSON.stringify(await c.ev(`(() => Object.assign({}, __ck, { eggs: __crecam.state().eggs, eggFail: __crecam.state().eggFail }))()`)));
c.close();
