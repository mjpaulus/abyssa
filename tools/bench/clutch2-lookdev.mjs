// CLUTCH2 look-dev: Alt+6, then the game camera turned so the clutch sits beside Sal (yaw
// offsets off the take point), lantern night. Frames to shots/clutch2-dev-<TAG>-*.png.
//   TAG=x PORT=8831 DRV_PORT=9431 node tools/bench/clutch2-lookdev.mjs
import { connect, sleep } from './drv.mjs';
import { boot } from './clutch2-look.mjs';
const TAG = process.env.TAG || 'x', WX = process.env.WX ?? '0';
const OUT = `/Users/michaelpaulus/sc/.abyssa-wt/shots/clutch2-dev-${TAG}-`;
const c = await connect();
await boot(c);
await c.ev(`(weather.set(${WX}, 0), 1)`);
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(3000);
const views = (process.env.VIEWS || '0.9:-0.35,-0.9:-0.35,0.5:-0.6').split(',').map(v => v.split(':').map(Number));
let n = 0;
for (const [dy, pt] of views) {
  await c.ev(`(() => { const t = __sl.brood.takeAt, p = player.pos; player.yaw = Math.atan2(t.x - p.x, t.z - p.z) + ${dy}; player.pitch = ${pt}; return 1; })()`);
  await sleep(1500);
  await c.png(`${OUT}${n++}.png`);
}
console.log(await c.ev(`JSON.stringify({ sf: __shaderFailed(), ms: 0 })`));
c.close();
