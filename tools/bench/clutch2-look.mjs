// CLUTCH2 proof: the asleep clutch close up in Sal's lantern, from the GAME camera. Alt+6, then
// W in to the surface (real keys), the mouse's job (yaw/pitch) done by the probe.
//   TAG=before WX=0 PORT=8831 DRV_PORT=9431 node tools/bench/clutch2-look.mjs
import { connect, sleep } from './drv.mjs';
const PORT = process.env.PORT || 8831, WX = process.env.WX ?? '0', TAG = process.env.TAG || 'after';
const OUT = `/Users/michaelpaulus/sc/.abyssa-wt/shots/clutch2-${TAG}-`;
export async function boot(c, port = PORT) {
  await c.send('Page.navigate', { url: 'about:blank' }); await sleep(800);
  await c.send('Storage.clearDataForOrigin', { origin: `http://localhost:${port}`, storageTypes: 'local_storage' });
  await c.send('Page.navigate', { url: `http://localhost:${port}/?bench&playtest` });
  await sleep(1500);
  await c.until(`!document.getElementById('load') && typeof window.start === 'function'`, 240000, 500);
  await sleep(1500);
  await c.ev(`(window.__helm = true, 1)`);
  await c.click(640, 400);
  await c.until(`window.__power && __power.state().state === 'play'`, 30000);
  await sleep(2000);
}
if (process.argv[1].endsWith('clutch2-look.mjs')) {
  const c = await connect();
  await boot(c);
  await c.ev(`(weather.set(${WX}, 0), 1)`);
  await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(3500);
  const face = (pitch) => `(() => { const t = __sl.brood.takeAt, p = player.pos; player.yaw = Math.atan2(t.x - p.x, t.z - p.z); player.pitch = ${pitch}; return 1; })()`;
  const st = `JSON.stringify({ reach: +__sl.brood.reach(player.pos).toFixed(2), prompt: __sl.brood.prompt(player.pos), cam: +camera.position.distanceTo(player.pos).toFixed(2) })`;
  await c.ev(face(-0.3)); await sleep(800);
  console.log('jump', await c.ev(st));
  await c.png(`${OUT}0-jump.png`);
  // in: W held until he stops at the surface (or 3 s)
  await c.key('KeyW', true);
  { const t0 = Date.now(); while (Date.now() - t0 < 3000) { await c.ev(face(-0.35)); await sleep(80); } }
  await c.key('KeyW', false); await sleep(1500);
  console.log('in', await c.ev(st));
  await c.ev(face(-0.45)); await sleep(900);
  await c.png(`${OUT}1-close.png`);
  // a quarter round it (D strafe), still facing it
  await c.key('KeyD', true);
  { const t0 = Date.now(); while (Date.now() - t0 < 1600) { await c.ev(face(-0.4)); await sleep(80); } }
  await c.key('KeyD', false); await sleep(1200); await c.ev(face(-0.5)); await sleep(800);
  console.log('side', await c.ev(st));
  await c.png(`${OUT}2-side.png`);
  c.close();
}
