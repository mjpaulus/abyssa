// BROODERFIX regression: THE PLUME RUSH with her body solid. Take the egg (real E), let her
// come and hammer; the moment the plume blinds her, rush in under her front (real W+Shift),
// then rise to a ward (real Space). Logs per frame; frames to shots/ if SHOTS=1.
import { connect, sleep } from './drv.mjs';
const c = await connect();
const OUT = '/Users/michaelpaulus/sc/.abyssa-wt/shots/brooderfix-' + (process.env.TAG || 'after') + '-rush-';
await c.send('Page.reload', { ignoreCache: true });
await sleep(1500);
await c.until(`!document.getElementById('load') && typeof window.start === 'function'`, 240000, 500);
await sleep(1500);
await c.ev(`(window.__helm = true, 1)`);
await c.click(640, 400);
await c.until(`window.__power && __power.state().state === 'play'`, 30000);
await sleep(2500);
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(1500);
await c.ev(`(async () => { window.__B = await import('/src/entities/sleeper/bodyCols.js'); return 1; })()`);
await c.tap('KeyE', 100);
// face her and wait for the blind
await c.until(`__sl.stand >= 1`, 20000);
// the card's protocol: Sal ~2.6 R ahead of her, on the open side (placement only; every move after is real input)
await c.ev(`(async () => { const T = await import('/src/world/terrain.js'); const L = __sl, fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), x = L.pos.x + fx * 2.6 * L.R, z = L.pos.z + fz * 2.6 * L.R; player.pos.set(x, T.terrainH(x, z, 0) + 1.35, z); player.vel.set(0, 0, 0); return 1; })()`);
const face = `(() => { const L = __sl, p = player.pos; player.yaw = Math.atan2(L.pos.x - p.x, L.pos.z - p.z); player.pitch = 0.1; return 1; })()`;
let t0 = Date.now(), blind = false;
while (Date.now() - t0 < 40000) {
  await c.ev(face);
  const s = await c.ev(`[__sl.seen, +__sl.tau.toFixed(2), +(__sl.huntD / __sl.R).toFixed(2), player.grounded]`);
  if (!s[3]) { await c.key('KeyC', true); await sleep(150); await c.key('KeyC', false); }
  if (process.env.V && (Date.now() - t0) % 1000 < 120) console.log(JSON.stringify(s), await c.ev(`[+__sl.threatE.toFixed(2), +__sl.hamPh.toFixed(2), +Math.hypot(player.vel.x, player.vel.z).toFixed(1), (window.__plume && __plume.state ? JSON.stringify(__plume.state()).slice(0, 120) : "")]`));
  if (!s[0]) { blind = true; console.log('blind at', (Date.now() - t0) / 1000, s); break; }
  await sleep(100);
}
if (!blind) { console.log('never blinded'); process.exit(0); }
await c.ev(`(window.__rr = [], window.__rT0 = performance.now(), (function f() { const L = __sl, p = player.pos; __rr.push([+((performance.now() - __rT0) / 1000).toFixed(2), +(Math.hypot(p.x - L.pos.x, p.z - L.pos.z) / L.R).toFixed(2), L.seen ? 1 : 0, +L.blindT.toFixed(1), __B.BODY.under ? 1 : 0, __B.BODY.contacts, __B.BODY.last, +__B.BODY.push.toFixed(2), L.sigils.map(g => g.lit ? 1 : 0).join(''), +p.y.toFixed(2), +L.threatE.toFixed(2), +Math.hypot(player.vel.x, player.vel.z).toFixed(1), (() => { const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), dx = p.x - L.pos.x, dz = p.z - L.pos.z; return [+((dx * cy - dz * sy) / L.R).toFixed(2), +((dx * sy + dz * cy) / L.R).toFixed(2)]; })(), window.__wp]); if (performance.now() - __rT0 < 12000) requestAnimationFrame(f); })(), 1)`);
await c.key('ShiftLeft', true); await c.key('KeyW', true);
// the air pack: a held burst along his look (real Space), then C to keep low
const burstAt = Date.now();
let burst = false, burstDone = false;
let under = 0, shot = 0, window_wp = null, wpI = 0;
t0 = Date.now();
while (Date.now() - t0 < 9000) {
  // RUSH=center: straight at her middle; side (default): blind, she does not turn, so he goes
  // in by her front-right (round both claws, which guard her mouth and front-left), then under
  if (!window_wp) window_wp = await c.ev(`(() => { const L = __sl, cy = Math.cos(L.yaw), sy = Math.sin(L.yaw); const W = ${process.env.RUSH === 'center' ? '[[0, 0]]' : '[[0.95, 1.45], [0.4, 0.1]]'};
    return W.map(w => [L.pos.x + w[0] * L.R * cy + w[1] * L.R * sy, L.pos.z - w[0] * L.R * sy + w[1] * L.R * cy]); })()`);
  { const p = await c.ev(`[player.pos.x, player.pos.z]`); let w = window_wp[wpI]; if (Math.hypot(p[0] - w[0], p[1] - w[1]) < 3 && wpI < window_wp.length - 1) { wpI++; w = window_wp[wpI]; }
    if (Math.hypot(p[0] - w[0], p[1] - w[1]) > 1.5) await c.ev(`(player.yaw = Math.atan2(${w[0]} - player.pos.x, ${w[1]} - player.pos.z), 1)`);
    if (process.env.DBG) console.log('wp', wpI, w.map(v => +v.toFixed(1)), p.map(v => +v.toFixed(1)), await c.ev(`[+player.yaw.toFixed(2), +Math.atan2(player.vel.x, player.vel.z).toFixed(2), +Math.hypot(player.vel.x, player.vel.z).toFixed(1), player.grounded, +(player.stagger || 0).toFixed(2), __power.state().state]`)); }
  if (!process.env.NOBURST && !burst && Date.now() - burstAt > 150) { await c.ev(`(player.pitch = -0.1, 1)`); await c.key('Space', true); burst = true; }
  if (burst && !burstDone && Date.now() - burstAt > 1300) { await c.key('Space', false); await c.key('KeyC', true); burstDone = true; }
  if (process.env.SHOTS && Date.now() - t0 > shot * 700) { await c.png(OUT + shot + '.png'); shot++; }
  const u = await c.ev(`__B.BODY.under`);
  if (u) { under++; if (under > 4) break; }
  await sleep(100);
}
await c.key('KeyW', false); await c.key('ShiftLeft', false); await c.key('Space', false); await c.key('KeyC', false);
console.log('under after', ((Date.now() - t0) / 1000).toFixed(1), 's', under > 4 ? 'YES' : 'NO');
// now up to the nearest dark ward: steer under it, then Space
const w = await c.ev(`(() => { const L = __sl, p = player.pos; let best = null, bd = 1e9; for (const g of L.sigils) { if (g.lit) continue; const d = Math.hypot(g.grp.position.x - p.x, g.grp.position.z - p.z); if (d < bd) { bd = d; best = g; } } return best ? [best.grp.position.x, best.grp.position.y - p.y, best.grp.position.z, bd] : null; })()`);
console.log('nearest dark ward (dx, dy above eye, dz, horiz)', w);
if (w) {
  await c.key('KeyW', true);
  t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const d = await c.ev(`(() => { const p = player.pos; player.yaw = Math.atan2(${w[0]} - p.x, ${w[2]} - p.z); return Math.hypot(${w[0]} - p.x, ${w[2]} - p.z); })()`);
    if (d < 1.5) break;
    await sleep(80);
  }
  await c.key('KeyW', false);
  await c.ev(`(player.pitch = 0.9, 1)`);
  await c.key('Space', true); await sleep(900); await c.key('Space', false);
  await sleep(2500);
  if (process.env.SHOTS) await c.png(OUT + 'ward.png');
}
await sleep(500);
const rr = await c.ev(`__rr`);
let last = -1;
for (const r of rr) if (r[0] - last >= 0.25) { last = r[0]; console.log(JSON.stringify(r)); }
console.log('wards', await c.ev(`__sl.sigils.map(g => g.lit ? 1 : 0).join('')`), 'max push/frame', Math.max(...rr.map(r => r[7])));
c.close();
