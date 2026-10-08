// BROODERFIX: the whole rite with her UNHELD and real keys (W/Shift/Space/C/E): take an egg,
// get under her and light wards (Space up to each), meet the brood rule, walk back and set the
// egg in the nest (E), the last ward lights itself, she calms and walks home over him.
// Placement is never used after the Alt+6 jump; steering = player.yaw (the mouse's job).
import { connect, sleep } from './drv.mjs';
const c = await connect();
const OUT = '/Users/michaelpaulus/sc/.abyssa-wt/shots/brooderfix-rite-';
// a first rite: no remembered ward (the save is cleared with the page away, so nothing re-writes it)
await c.send('Page.navigate', { url: 'about:blank' }); await sleep(800);
await c.send('Storage.clearDataForOrigin', { origin: 'http://localhost:8829', storageTypes: 'local_storage' });
await c.send('Page.navigate', { url: 'http://localhost:8829/?bench&playtest' });
await sleep(1500);
await c.until(`!document.getElementById('load') && typeof window.start === 'function'`, 240000, 500);
await sleep(1500);
await c.ev(`(window.__helm = true, 1)`);
await c.click(640, 400);
await c.until(`window.__power && __power.state().state === 'play'`, 30000);
await sleep(2500);
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(1500);
await c.ev(`(async () => { window.__B = await import('/src/entities/sleeper/bodyCols.js'); window.__msgs = []; window.__rl = []; window.__rT = performance.now();
  (function f() { const t = document.getElementById('msg').textContent; if (t && __msgs[__msgs.length - 1] !== t) __msgs.push(t); const L = __sl, p = player.pos;
    __rl.push([__B.BODY.hitV > 2.5 ? __B.BODY.last : '', +((performance.now() - __rT) / 1000).toFixed(1), +__B.BODY.push.toFixed(2), __B.BODY.hitV > 2.5 ? 1 : 0, L.calmed ? 1 : 0, +Math.hypot(L.vel.x, L.vel.z).toFixed(2), +(Math.hypot(p.x - L.pos.x, p.z - L.pos.z) / L.R).toFixed(2), L.sigils.map(g => g.lit ? 1 : 0).join(''), L.brood.held]);
    if (performance.now() - __rT < 400000) requestAnimationFrame(f); })(); return 1; })()`);
const st = () => c.ev(`(() => { const L = __sl; return { lit: L.sigils.map(g => g.lit ? 1 : 0).join(''), held: L.brood.held, out: L.brood.out(), calmed: L.calmed, d: +(Math.hypot(player.pos.x - L.pos.x, player.pos.z - L.pos.z) / L.R).toFixed(2), stand: +L.stand.toFixed(2), seen: L.seen, g: player.grounded }; })()`);
await (async () => { for (const f of (await import('node:fs')).readdirSync('/Users/michaelpaulus/sc/.abyssa-wt/shots')) if (f.startsWith('brooderfix-rite-')) (await import('node:fs')).unlinkSync('/Users/michaelpaulus/sc/.abyssa-wt/shots/' + f); })();
let shot = 0; const snap = async n => { await c.png(OUT + String(shot++).padStart(2, '0') + '-' + n + '.png'); };
await snap('nest');
await c.tap('KeyE', 100);                                   // take
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
const darkWard = `(() => { const L = __sl, p = player.pos; let b = null, bd = 1e9; for (const g of L.sigils) { if (g.lit) continue; const d = Math.hypot(g.grp.position.x - p.x, g.grp.position.z - p.z); if (d < bd) { bd = d; b = g; } } return b ? [b.grp.position.x, b.grp.position.z] : null; })()`;
// wards: up to 4 tries
for (let k = 0; k < 6; k++) {
  const s = await st(); console.log('ward try', k, JSON.stringify(s));
  if (!s.lit.includes('0') || s.calmed) break;
  const before = s.lit;
  await steerTo(darkWard, 1.4, 25000, ['KeyW', 'ShiftLeft']);
  await snap('under-' + k);
  await c.ev(`(player.pitch = 0.6, 1)`);
  await c.key('Space', true); await sleep(800); await c.key('Space', false);
  await sleep(1500);
  await snap('ward-' + k);
  await c.key('KeyC', true); await sleep(1500); await c.key('KeyC', false);
  const s2 = await st(); console.log(' after', JSON.stringify(s2));
  if (s2.lit === before && (await c.ev(`__msgs.some(m => /WILL NOT TAKE|COLD/.test(m))`))) break;   // the brood rule refuses: set the egg back
}
// back to the nest, set the egg back
console.log('to nest', JSON.stringify(await st()));
await steerTo(`[__sl.brood.nest.x, __sl.brood.nest.z]`, 3, 60000, ['KeyW', 'ShiftLeft']);
console.log('prompt', await c.ev(`__sl.brood.prompt(player.pos)`));
await c.tap('KeyE', 100);
await sleep(500);
console.log('after set back', JSON.stringify(await st()));
await snap('setback');
// stay and watch her calm and come home over the nest
for (let i = 0; i < 14; i++) { await sleep(2000); if (i % 3 === 0) await snap('home-' + i); }
await c.ev(`(() => { const L = __sl, p = player.pos; player.yaw = Math.atan2(L.pos.x - p.x, L.pos.z - p.z); return 1; })()`);
await sleep(1500); await snap('home-look');
console.log('end', JSON.stringify(await st()));
console.log('msgs', JSON.stringify(await c.ev(`__msgs`)));
const rl = await c.ev(`__rl`);
rl.forEach(r => r.shift && 0);
const slamParts = {}; for (const r of rl) if (r[0]) slamParts[r[0]] = (slamParts[r[0]] || 0) + 1; console.log('slam parts', JSON.stringify(slamParts));
for (const r of rl) r.shift();
const calmIdx = rl.findIndex(r => r[3]);
const after = calmIdx >= 0 ? rl.slice(calmIdx) : [];
console.log(JSON.stringify({ frames: rl.length, slamFrames: rl.filter(r => r[2]).length, maxPush: Math.max(...rl.map(r => r[1])), calmAt: calmIdx >= 0 ? rl[calmIdx][0] : null,
  afterCalm: { maxPush: after.length ? Math.max(...after.map(r => r[1])) : null, slams: after.filter(r => r[2]).length, herMaxSpeed: after.length ? Math.max(...after.map(r => r[4])) : null, minDist: after.length ? Math.min(...after.map(r => r[5])) : null } }));
c.close();
