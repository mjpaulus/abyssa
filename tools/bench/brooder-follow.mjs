// BROODERFIX probe: the egg take through REAL input, then 30 s of Velkath's state.
//   ROUTE=playtest|natural node tools/bench/brooder-follow.mjs [walkAway=1]
import { connect, sleep } from './drv.mjs';
const c = await connect();
const ROUTE = process.env.ROUTE || 'playtest';
const AWAY = process.env.AWAY !== '0';
await c.send('Page.reload', { ignoreCache: true });
await sleep(1500);
await c.until(`!document.getElementById('load') && typeof window.start === 'function'`, 240000, 500);
await sleep(2000);
await c.ev(`(window.__helm = true, 1)`);
await c.click(640, 400);
await c.until(`window.__power && __power.state().state === 'play'`, 30000);
await sleep(2500);
const S = `(() => { const L = __sl, p = player.pos; return { t: +performance.now().toFixed(0), dorm: L.dormant, stand: +L.stand.toFixed(2), thr: +L.threat.toFixed(2), seen: L.seen, blindT: +L.blindT.toFixed(1),
  tau: +L.tau.toFixed(2), pos: [+L.pos.x.toFixed(1), +L.pos.z.toFixed(1)], yaw: +L.yaw.toFixed(2), spd: +Math.hypot(L.vel.x, L.vel.z).toFixed(2), pd: +L._pd.toFixed(1), pdT: +(L._pdT||0).toFixed(1),
  walkTo: !!L.walkTo, hold: !!L.hold, calmed: L.calmed, held: L.brood.held, eggsOut: L.brood.out(), sal: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)], R: +L.R.toFixed(1), standT: L.standTarget, state: __power.state().state, hidden: document.hidden }; })()`;
if (ROUTE === 'playtest') {
  await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1);
  await sleep(1500);
} else {
  // natural: walk off the deck with W, then swim toward the nest (yaw set toward it, real W held)
  await c.key('KeyW', true);
  await c.until(`player.pos.y < -2`, 60000);
  const nest = await c.ev(`[__sl.brood.nest.x, __sl.brood.nest.z]`);
  console.log('nest', nest, await c.ev(S));
  let t0 = Date.now(), sinking = false;
  while (Date.now() - t0 < 150000) {
    const d = await c.ev(`(() => { const n = __sl.brood.nest, p = player.pos, h = Math.hypot(n.x - p.x, n.z - p.z), ny = (n.y || 0) + 1.35;
      player.yaw = Math.atan2(n.x - p.x, n.z - p.z); player.pitch = Math.max(-1.2, Math.min(0.3, Math.atan2(ny - p.y, Math.max(1, h)))); return [h, __sl.brood.nearEgg(p), p.y, player.grounded]; })()`);
    if (!sinking && d[2] < -0.5) { sinking = true; await c.key('KeyC', true); }
    if (sinking && d[3]) { await c.key('KeyC', false); }
    if (d[1] >= 0) break;
    await sleep(250);
  }
  await c.key('KeyW', false); await c.key('KeyC', false);
  await sleep(1500);
}
console.log('before', JSON.stringify(await c.ev(S)), 'near', await c.ev(`__sl.brood.nearEgg(player.pos)`));
await c.tap('KeyE', 100);
await sleep(300);
console.log('after E', JSON.stringify(await c.ev(S)));
const rows = [];
const t0 = Date.now();
let walking = false;
while (Date.now() - t0 < 30000) {
  const el = (Date.now() - t0) / 1000;
  if (AWAY && el > 8 && !walking) {
    walking = true;
    await c.ev(`(() => { const L = __sl, p = player.pos; player.yaw = Math.atan2(p.x - L.pos.x, p.z - L.pos.z); return 1; })()`);
    await c.key('KeyW', true);
  }
  const r = await c.ev(S); r.el = +el.toFixed(1);
  rows.push(r);
  console.log(JSON.stringify(r));
  await sleep(1000);
}
if (walking) await c.key('KeyW', false);
console.log(JSON.stringify((await c.console()).filter(l => /error|EXC|warn/i.test(l)).slice(0, 20)));
c.close();
