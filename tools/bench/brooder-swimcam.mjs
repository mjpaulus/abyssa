// BROODERFIX: the lens while Sal HAULS (swims, real W off the bottom) round and under Velkath
// with the swim framing live: how often the lens ends a frame inside her body, and its pumping.
import { connect, sleep } from './drv.mjs';
const c = await connect();
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
await c.until(`__sl.stand >= 1`, 20000);
await sleep(3000);
// up off the bottom (real Space tap), then haul round her in a circle at ~1.2 R, looking along the circle
await c.key('Space', true); await sleep(800); await c.key('Space', false);
await c.ev(`(window.__sc = [], window.__scT = performance.now(), (function f() { const p = player.pos; __sc.push([+camera.position.distanceTo(p).toFixed(2), __B.bodyBlocked(camera.position.x, camera.position.y, camera.position.z, 0) ? 1 : 0, player.grounded ? 1 : 0, +(window.__crecam ? __crecam.state().under : 0)]); if (performance.now() - __scT < 20000) requestAnimationFrame(f); })(), 1)`);
await c.key('KeyW', true);
const t0 = Date.now();
while (Date.now() - t0 < 20000) {
  await c.ev(`(() => { const L = __sl, p = player.pos, a = Math.atan2(p.z - L.pos.z, p.x - L.pos.x), r = Math.hypot(p.x - L.pos.x, p.z - L.pos.z), want = 1.0 * L.R;
    const tx = -Math.sin(a), tz = Math.cos(a), k = (want - r) / L.R; player.yaw = Math.atan2(tx + Math.cos(a) * k * 2, tz + Math.sin(a) * k * 2); player.pitch = -0.15; return 1; })()`);
  await sleep(100);
}
await c.key('KeyW', false);
const sc = await c.ev(`__sc`);
let rev = 0, dir = 0, ext = sc[0][0];
for (const r of sc) { const d = r[0] - ext; if (dir >= 0 && d < -1) { if (dir > 0) rev++; dir = -1; ext = r[0]; } else if (dir <= 0 && d > 1) { if (dir < 0) rev++; dir = 1; ext = r[0]; } else if ((dir > 0 && r[0] > ext) || (dir < 0 && r[0] < ext)) ext = r[0]; }
console.log(JSON.stringify({ frames: sc.length, lensInside: sc.filter(r => r[1]).length, airborne: sc.filter(r => !r[2]).length, underFrames: sc.filter(r => r[3] > 0.5).length, lensMin: Math.min(...sc.map(r => r[0])), lensMax: Math.max(...sc.map(r => r[0])), reversals: rev }));
c.close();
