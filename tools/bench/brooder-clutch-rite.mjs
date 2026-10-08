// BROODER-CLUTCH: the whole rite with her UNHELD and real keys (W/Shift/Space/C/E): pry a clump
// off her clutch at the Alt+6 jump (she wakes), get under her and light wards (Space up to
// each), meet the brood rule, press the clump back into the clutch hanging under her (Space up
// to it, E), the last ward lights itself, she calms and walks home.
// Steering = player.yaw/pitch (the mouse's job); movement is only ever keys.
//   PORT=8830 DRV_PORT=9430 SHOTS=clutch-rite node tools/bench/brooder-clutch-rite.mjs
import { connect, sleep } from './drv.mjs';
import { readdirSync, unlinkSync } from 'node:fs';
const PORT = process.env.PORT || 8830;
const DIR = '/Users/michaelpaulus/sc/.abyssa-wt/shots/';
const PRE = (process.env.SHOTS || 'clutch-rite') + '-';
const c = await connect();
await c.send('Page.navigate', { url: 'about:blank' }); await sleep(800);
await c.send('Storage.clearDataForOrigin', { origin: `http://localhost:${PORT}`, storageTypes: 'local_storage' });
await c.send('Page.navigate', { url: `http://localhost:${PORT}/?bench&playtest` });
await sleep(1500);
await c.until(`!document.getElementById('load') && typeof window.start === 'function'`, 240000, 500);
await sleep(1500);
await c.ev(`(window.__helm = true, 1)`);
await c.click(640, 400);
await c.until(`window.__power && __power.state().state === 'play'`, 30000);
await sleep(2500);
if (process.env.WX) await c.ev(`(weather.set(${process.env.WX}, 0), 1)`);
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(1500);
await c.ev(`(async () => { window.__B = await import('/src/entities/sleeper/bodyCols.js'); window.__msgs = []; window.__rl = []; window.__rT = performance.now();
  (function f() { const t = document.getElementById('msg').textContent; if (t && __msgs[__msgs.length - 1] !== t) __msgs.push(t); const L = __sl, p = player.pos;
    __rl.push([__B.BODY.hitV > 2.5 ? __B.BODY.last : '', +((performance.now() - __rT) / 1000).toFixed(1), +__B.BODY.push.toFixed(2), __B.BODY.hitV > 2.5 && !L.rising ? 1 : 0, L.calmed ? 1 : 0, +Math.hypot(L.vel.x, L.vel.z).toFixed(2), +(Math.hypot(p.x - L.pos.x, p.z - L.pos.z) / L.R).toFixed(2), L.sigils.map(g => g.lit ? 1 : 0).join(''), L.brood.held]);
    if (performance.now() - __rT < 400000) requestAnimationFrame(f); })(); return 1; })()`);
const st = () => c.ev(`(() => { const L = __sl, B = L.brood; return { lit: L.sigils.map(g => g.lit ? 1 : 0).join(''), held: B.held, out: B.out(), calmed: L.calmed, d: +(Math.hypot(player.pos.x - L.pos.x, player.pos.z - L.pos.z) / L.R).toFixed(2), stand: +L.stand.toFixed(2), seen: L.seen, g: player.grounded, reach: +B.reach(player.pos).toFixed(1), py: +(player.pos.y - 1.35).toFixed(1) }; })()`);
for (const f of readdirSync(DIR)) if (f.startsWith(PRE)) unlinkSync(DIR + f);
let shot = 0; const snap = async n => { await c.png(DIR + PRE + String(shot++).padStart(2, '0') + '-' + n + '.png'); };
console.log('at clutch', JSON.stringify(await st()), 'prompt', await c.ev(`__sl.brood.prompt(player.pos)`));
await snap('clutch');
await c.tap('KeyE', 100);                                   // the take
await sleep(400); await snap('take');
await c.until(`__sl.stand >= 1`, 20000);
await snap('risen');
async function steerTo(expr, near, ms, keys = ['KeyW']) {
  for (const k of keys) await c.key(k, true);
  const t0 = Date.now(); let d = 1e9, cd = false;
  while (Date.now() - t0 < ms) {
    d = await c.ev(`(() => { const q = ${expr}; if (!q) return -1; const p = player.pos; player.yaw = Math.atan2(q[0] - p.x, q[1] - p.z); player.pitch = -0.05; return Math.hypot(q[0] - p.x, q[1] - p.z); })()`);
    if (d >= 0 && d < near) break;
    const gr = await c.ev(`player.grounded`);
    if (!gr && !cd) { await c.key('KeyC', true); cd = true; } else if (gr && cd) { await c.key('KeyC', false); cd = false; }
    await sleep(100);
  }
  for (const k of keys) await c.key(k, false);
  if (cd) await c.key('KeyC', false);
  return d;
}
// back to the floor: C held until he stands (the dress keeps him floating otherwise)
async function down() { await c.key('KeyC', true); const t0 = Date.now(); while (Date.now() - t0 < 12000 && !(await c.ev(`player.grounded`))) await sleep(100); await c.key('KeyC', false); }
const darkWard = `(() => { const L = __sl, p = player.pos; let b = null, bd = 1e9; for (const g of L.sigils) { if (g.lit) continue; const d = Math.hypot(g.grp.position.x - p.x, g.grp.position.z - p.z); if (d < bd) { bd = d; b = g; } } return b ? [b.grp.position.x, b.grp.position.z] : null; })()`;
console.log('ward heights over the floor', JSON.stringify(await c.ev(`__sl.sigils.map(g => +(g.grp.position.y - __T0.terrainH(g.grp.position.x, g.grp.position.z, 0)).toFixed(1))`).catch(async () => { await c.ev(`(async () => { window.__T0 = await import('/src/world/terrain.js'); return 1; })()`); return c.ev(`__sl.sigils.map(g => +(g.grp.position.y - __T0.terrainH(g.grp.position.x, g.grp.position.z, 0)).toFixed(1))`); })));
for (let k = 0; k < 6; k++) {
  const s = await st(); console.log('ward try', k, JSON.stringify(s));
  if (!s.lit.includes('0') || s.calmed) break;
  const before = s.lit;
  await steerTo(darkWard, 1.4, 25000, ['KeyW', 'ShiftLeft']);
  await sleep(1200);
  console.log('  under ward: crouch', await c.ev(`+(__sl.crouch ? __sl.crouch.x : 0).toFixed(2)`), 'bellyOver', await c.ev(`+(__sl.bellyOver || 0).toFixed(1)`), 'dark ward heights', JSON.stringify(await c.ev(`__sl.sigils.filter(g => !g.lit).map(g => +(g.grp.position.y - __T0.terrainH(g.grp.position.x, g.grp.position.z, 0)).toFixed(1))`)));
  await snap('under-' + k);
  // up to it: a tap (the seabed hop), then short bursts, until it takes or he is past it
  for (let b = 0; b < 4; b++) {
    await c.ev(`(player.pitch = 0.6, 1)`);
    await c.key('Space', true); await sleep(b === 0 ? 120 : +(process.env.BURST || 300)); await c.key('Space', false);
    await sleep(1100);
    const l = (await st()).lit;
    console.log('   press', b, l, 'feet over floor', await c.ev(`+(player.pos.y - 1.35 - __T0.terrainH(player.pos.x, player.pos.z, 0)).toFixed(1)`));
    if (l !== before) break;
  }
  await snap('ward-' + k);
  await down();
  const s2 = await st(); console.log(' after', JSON.stringify(s2));
  if (s2.lit === before && (await c.ev(`__msgs.some(m => /STAYS COLD|WILL NOT TAKE/.test(m))`))) break;   // the brood rule refuses: put the clump back
}
// back under her, up to the clutch, press it back
const clutchAt = `(() => { const v = new player.pos.constructor(0, -0.3, -0.26); __sl.body.localToWorld(v); return [v.x, v.z]; })()`;
console.log('to the clutch', JSON.stringify(await st()), 'clutch bottom over floor', await c.ev(`(() => { const v = new player.pos.constructor(0, -0.40, -0.27); __sl.body.localToWorld(v); return +(v.y - __T0.terrainH(v.x, v.z, 0)).toFixed(1); })()`));
let returned = false;
for (let a = 0; a < 5 && !returned; a++) {
  await steerTo(clutchAt, 1.5, 40000, ['KeyW', 'ShiftLeft']);
  await sleep(1500);
  console.log('  under clutch: crouch', await c.ev(`+(__sl.crouch ? __sl.crouch.x : 0).toFixed(2)`), 'bellyOver', await c.ev(`+(__sl.bellyOver || 0).toFixed(1)`));
  await snap('under-clutch-' + a);
  console.log(' under', JSON.stringify(await st()), 'prompt', await c.ev(`__sl.brood.prompt(player.pos)`));
  if (await c.ev(`__sl.brood.canReturn(player.pos)`)) { await c.tap('KeyE', 100); returned = true; break; }
  // up to it: a burst (Space held), E the moment it is in reach
  await c.ev(`(player.pitch = 0.9, 1)`);
  await c.key('Space', true);
  const t0 = Date.now();
  while (Date.now() - t0 < +(process.env.BURST || 450)) {
    if (await c.ev(`__sl.brood.canReturn(player.pos)`)) { await c.tap('KeyE', 100); returned = true; break; }
    await sleep(40);
  }
  await c.key('Space', false);
  if (!returned) { const t1 = Date.now(); while (Date.now() - t1 < 2500) { if (await c.ev(`__sl.brood.canReturn(player.pos)`)) { await c.tap('KeyE', 100); returned = true; break; } await sleep(40); } }
  console.log(' try', a, 'returned', returned, JSON.stringify(await st()));
  await down();
}
await sleep(500);
console.log('after the return', JSON.stringify(await st()));
await snap('pressed-back');
await c.key('KeyC', true); await sleep(1500); await c.key('KeyC', false);
// calmed: she will not lie down on him. He walks out from under her (W, away from her centre)
await sleep(2500); await snap('calm-over-him');
console.log('calm, before walking out', JSON.stringify(await st()), 'homeTurn', await c.ev(`!!__sl.homeTurn`));
await c.key('KeyW', true);
{ const t0 = Date.now(); while (Date.now() - t0 < 7000) { await c.ev(`(player.yaw = Math.atan2(player.pos.x - __sl.pos.x, player.pos.z - __sl.pos.z), player.pitch = -0.05, 1)`); await sleep(120); } }
await c.key('KeyW', false);
console.log('walked out', JSON.stringify(await st()));
for (let i = 0; i < 5; i++) { await sleep(2000); await c.ev(`(player.yaw = Math.atan2(__sl.pos.x - player.pos.x, __sl.pos.z - player.pos.z), player.pitch = -0.12, 1)`); await snap('home-' + i); }
console.log('end', JSON.stringify(await st()));
console.log('msgs', JSON.stringify(await c.ev(`__msgs`)));
const rl = await c.ev(`__rl`);
const slamParts = {}; for (const r of rl) if (r[0]) slamParts[r[0]] = (slamParts[r[0]] || 0) + 1; console.log('contact parts', JSON.stringify(slamParts));
for (const r of rl) r.shift();
const calmIdx = rl.findIndex(r => r[3]);
console.log(JSON.stringify({ frames: rl.length, slamFrames: rl.filter(r => r[2]).length, maxPush: Math.max(...rl.map(r => r[1])), calmAt: calmIdx >= 0 ? rl[calmIdx][0] : null }));
c.close();
