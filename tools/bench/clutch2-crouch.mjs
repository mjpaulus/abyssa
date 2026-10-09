// CLUTCH2: the press-back under her crouch, comparable across versions (plain-sphere gap from
// B.live, so it runs on the old clutch too). Alt+6, E, she hunts; W under the mass; the gap,
// reach and canReturn standing, then the best reach during one Space tap (a hop) and a 300 ms
// burst, pressing E as soon as canReturn holds.
import { connect, sleep } from './drv.mjs';
import { boot } from './clutch2-look.mjs';
const c = await connect();
await boot(c);
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(2500);
await c.ev(`(async () => { window.__T0 = await import('/src/world/terrain.js'); return 1; })()`);
const gap = `(() => { const L = __sl, B = L.brood, p = player.pos; const inv = L.body.matrixWorld.clone().invert(); const v = p.clone();
  for (let y = p.y + 0.45; y < p.y + 16; y += 0.05) { v.set(p.x, y, p.z).applyMatrix4(inv); for (let k = 0; k < B.nL; k++) { const o = k * 4, r = B.live[o + 3]; if (r > 0.002 && Math.hypot(v.x - B.live[o], v.y - B.live[o + 1], v.z - B.live[o + 2]) < r) return +(y - p.y - 0.45).toFixed(2); } } return null; })()`;
const st = () => c.ev(`(() => { const L = __sl, B = L.brood, p = player.pos; return { held: B.held, stand: +L.stand.toFixed(2), crouch: L.crouch ? +L.crouch.x.toFixed(2) : 0, g: player.grounded, feet: +(p.y - 1.35 - __T0.terrainH(p.x, p.z, 0)).toFixed(2), reach: +B.reach(p).toFixed(2), canRet: B.canReturn(p), bodyOverFloor: +(L.bodyY - __T0.terrainH(L.pos.x, L.pos.z, 0)).toFixed(1) }; })()`);
await c.tap('KeyE', 100); await sleep(400);
await c.until(`__sl.stand >= 0.98`, 25000);
const massXZ = `(() => { const v = new player.pos.constructor(0.0, -0.39, -0.26); __sl.body.localToWorld(v); return [v.x, v.z]; })()`;
let res = [];
for (let k = 0; k < 3; k++) {
  await c.key('KeyW', true);
  { const t0 = Date.now(); while (Date.now() - t0 < 20000) { const d = await c.ev(`(() => { const q = ${massXZ}; const p = player.pos; player.yaw = Math.atan2(q[0] - p.x, q[1] - p.z); player.pitch = -0.05; return Math.hypot(q[0] - p.x, q[1] - p.z); })()`); if (d < 0.8) break; await sleep(80); } }
  await c.key('KeyW', false);
  await sleep(2500);
  const s = await st(); const g = await c.ev(gap);
  let best = 99, pressed = '';
  if (s.canRet) { await c.tap('KeyE', 100); pressed = 'standing'; }
  else for (const ms of [120, 300]) {
    await c.ev(`(player.pitch = 0.7, 1)`);
    await c.key('Space', true); await sleep(ms); await c.key('Space', false);
    const t0 = Date.now();
    while (Date.now() - t0 < 2500) { const r = await c.ev(`+__sl.brood.reach(player.pos).toFixed(2)`); if (r < best) best = r; if (await c.ev(`__sl.brood.canReturn(player.pos)`)) { await c.tap('KeyE', 100); pressed = ms === 120 ? 'hop' : 'burst'; break; } await sleep(30); }
    if (pressed) break;
    await c.key('KeyC', true); { const t1 = Date.now(); while (Date.now() - t1 < 8000 && !(await c.ev(`player.grounded`))) await sleep(100); } await c.key('KeyC', false);
  }
  res.push({ k, ...s, gapOverHelmet: g, bestReachInAir: best, pressed });
  console.log(JSON.stringify(res[res.length - 1]));
  if (pressed) break;
}
console.log('final held', await c.ev(`__sl.brood.held`));
c.close();
