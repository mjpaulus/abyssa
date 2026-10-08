// BROODER-CLUTCH proof (1): the asleep clutch in the lantern from the GAME camera: the Alt+6
// spot, then Sal circling it with real keys (A/D strafe, W in), the mouse turning him to it.
//   WX=0|0.5 PORT=8830 DRV_PORT=9430 node tools/bench/brooder-clutch-shots.mjs
import { connect, sleep } from './drv.mjs';
const PORT = process.env.PORT || 8830, WX = process.env.WX ?? '0.5';
const OUT = `/Users/michaelpaulus/sc/.abyssa-wt/shots/clutch-asleep-${+WX ? 'day' : 'night'}-`;
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
await sleep(2000);
await c.ev(`(weather.set(${WX}, 0), 1)`);
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(3000);
let n = 0; const snap = async t => c.png(`${OUT}${n++}-${t}.png`);
await snap('jump');
const face = `(() => { const t = __sl.brood.takeAt, p = player.pos; player.yaw = Math.atan2(t.x - p.x, t.z - p.z); player.pitch = -0.32; return 1; })()`;
for (const [k, ms, tag] of [['KeyA', 900, 'left'], ['KeyD', 1800, 'right'], ['KeyS', 700, 'back']]) {
  await c.key(k, true); const t0 = Date.now(); while (Date.now() - t0 < ms) { await c.ev(face); await sleep(80); } await c.key(k, false);
  await sleep(1200); await c.ev(face); await sleep(600);
  console.log(tag, await c.ev(`JSON.stringify({ reach: +__sl.brood.reach(player.pos).toFixed(1), prompt: __sl.brood.prompt(player.pos) })`));
  await snap(tag);
}
c.close();
