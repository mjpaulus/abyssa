// BROODERFIX: the chase, measured per frame (rAF logger in the page) after a REAL E take.
//   ROUTE=playtest|natural node tools/bench/brooder-chase.mjs
// Phase 1 (12 s): Sal stands at the nest with the egg. Phase 2 (16 s): he walks away (real W).
// Phase 3 (10 s): he sets the egg back? no: he keeps walking with Shift (real ShiftLeft+W).
import { connect, sleep } from './drv.mjs';
const c = await connect();
const ROUTE = process.env.ROUTE || 'playtest';
await c.send('Page.reload', { ignoreCache: true });
await sleep(1500);
await c.until(`!document.getElementById('load') && typeof window.start === 'function'`, 240000, 500);
await sleep(1500);
await c.ev(`(window.__helm = true, 1)`);
await c.click(640, 400);
await c.until(`window.__power && __power.state().state === 'play'`, 30000);
await sleep(2500);
if (ROUTE === 'playtest') { await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(1500); }
else {
  await c.key('KeyW', true);
  await c.until(`player.pos.y < -2`, 60000);
  let sinking = false; const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    const d = await c.ev(`(() => { const n = __sl.brood.nest, p = player.pos, h = Math.hypot(n.x - p.x, n.z - p.z), ny = (n.y || 0) + 1.35;
      player.yaw = Math.atan2(n.x - p.x, n.z - p.z); player.pitch = Math.max(-1.2, Math.min(0.3, Math.atan2(ny - p.y, Math.max(1, h)))); return [h, __sl.brood.nearEgg(p), p.y, player.grounded]; })()`);
    if (!sinking && d[2] < -0.5) { sinking = true; await c.key('KeyC', true); }
    if (sinking && d[3]) await c.key('KeyC', false);
    if (d[1] >= 0) break;
    await sleep(250);
  }
  await c.key('KeyW', false); await c.key('KeyC', false);
  await sleep(1500);
}
await c.ev(`(async () => { const T = await import('three'); window.__cv = new T.Vector3(); window.__B = await import('/src/entities/sleeper/bodyCols.js'); return 1; })()`);
console.log('near egg', await c.ev(`__sl.brood.nearEgg(player.pos)`), 'route', ROUTE);
await c.tap('KeyE', 100);
await c.ev(`(window.__ch = [], window.__chT0 = performance.now(), (function f() { const L = __sl, p = player.pos, cl = L.claws[1].major ? L.claws[1] : L.claws[0];
  cl.dj.getWorldPosition(__cv);
  let slip = 0;
  for (let i = 0; i < 8; i++) { const ft = L.feet[i]; if (ft.t >= 0) continue; }
  __ch.push([+((performance.now() - __chT0) / 1000).toFixed(2), +L.stand.toFixed(2), +L.threatE.toFixed(2), +(L.huntD || 0).toFixed(1), +Math.hypot(L.vel.x, L.vel.z).toFixed(2),
    +L.hamPh.toFixed(2), +L.swing.toFixed(2), +Math.hypot(__cv.x - L.pos.x, __cv.z - L.pos.z).toFixed(1), +__cv.distanceTo(p).toFixed(1), L.seen ? 1 : 0, +L.blindT.toFixed(1),
    +Math.hypot(player.vel.x, player.vel.z).toFixed(1), +p.y.toFixed(1), __B.BODY.contacts, __B.BODY.last, +(L.strikeCd || 0).toFixed(1), L.brood.held, +camera.position.distanceTo(p).toFixed(2), +__crecam.state().hold.toFixed(1), __B.blockWhy]);
  if (performance.now() - __chT0 < 42000) requestAnimationFrame(f); })(), 1)`);
{ const t0 = Date.now(); let cDown = false; while (Date.now() - t0 < 12000) { const g = await c.ev(`player.grounded`); if (!g && !cDown) { await c.key('KeyC', true); cDown = true; } else if (g && cDown) { await c.key('KeyC', false); cDown = false; } await sleep(150); } if (cDown) await c.key('KeyC', false); }
await c.ev(`(() => { const L = __sl, p = player.pos; player.yaw = Math.atan2(p.x - L.pos.x, p.z - L.pos.z); player.pitch = -0.05; return 1; })()`);
// he keeps to the bottom (real C while a blow has him off it), walking away from her
async function walk(ms) { const t0 = Date.now(); let cDown = false; while (Date.now() - t0 < ms) { const g = await c.ev(`player.grounded`); if (!g && !cDown) { await c.key('KeyC', true); cDown = true; } else if (g && cDown) { await c.key('KeyC', false); cDown = false; } await sleep(150); } if (cDown) await c.key('KeyC', false); }
await c.key('KeyW', true);
await walk(14000);
await c.key('ShiftLeft', true);
await walk(14000);
await c.key('ShiftLeft', false); await c.key('KeyW', false);
const ch = await c.ev(`__ch`);
// summarise per 0.5 s
let last = -1;
for (const r of ch) { if (r[0] - last >= (process.env.FINE ? 0.1 : 0.5)) { last = r[0]; console.log(JSON.stringify([r[0], r[2], r[3], r[5], r[6], r[8], r[13], r[14], r[17], r[18], r[19], r[12]])); } }
// strike ring: the claw hinge's horizontal distance from her centre at the bottom of each swing
const lands = ch.filter(r => r[6] > 0.9 && r[2] > 0.5).map(r => r[7]);
// the lens: reversals of its distance bigger than 1 u (pumping), and its range
{ let rev = 0, dir = 0, ext = ch[0][17]; for (const r of ch) { const d = r[17] - ext; if (dir >= 0 && d < -1) { if (dir > 0) rev++; dir = -1; ext = r[17]; } else if (dir <= 0 && d > 1) { if (dir < 0) rev++; dir = 1; ext = r[17]; } else if ((dir > 0 && r[17] > ext) || (dir < 0 && r[17] < ext)) ext = r[17]; }
  const L = ch.map(r => r[17]); console.log('lens min', Math.min(...L), 'max', Math.max(...L), 'reversals>1u', rev, 'over', ch[ch.length - 1][0], 's'); }
console.log('landing ring (R units)', lands.length ? (lands.reduce((a, b) => a + b) / lands.length / 15.4).toFixed(2) : '-', 'hits', ch.filter((r, i) => i && r[15] > 1.9 && ch[i - 1][15] < 1.9).length);
c.close();
