// BROODER-CLUTCH: is she readable from the default camera at 40-50 u? Weber contrast of her
// silhouette against what she hides (two frozen captures, her group shown/hidden, same frame),
// with the chase-read terms ON and OFF (RIM / GLINT / wake knobs), day and night.
//   PORT=8830 DRV_PORT=9430 node tools/bench/brooder-chase-read.mjs
import { connect, sleep } from './drv.mjs';
const PORT = process.env.PORT || 8830;
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
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(1500);
await c.tap('KeyE', 100);
await c.until(`__sl.stand >= 1`, 20000);
await c.ev(`(async () => { window.__BR = await import('/src/entities/sleeper/brooder.js'); window.__PL = await import('/src/entities/sleeper/plume.js'); window.__T = await import('/src/world/terrain.js'); return 1; })()`);
// she stands where she rose; Sal is put D u off her centre on the open side, looking at her
const place = (D, side) => c.ev(`(() => { const L = __sl; L.hold = true; const t = L.lairPos; const rp = [L.pos.x - t.x, L.pos.z - t.z];
  const a = L.yaw + ${side}; const x = L.pos.x + Math.sin(a) * ${D}, z = L.pos.z + Math.cos(a) * ${D};
  player.pos.set(x, __T.terrainH(x, z, 0) + 1.35, z); player.vel.set(0, 0, 0); player.yaw = Math.atan2(L.pos.x - x, L.pos.z - z); player.pitch = -0.05; return 1; })()`);
const measure = () => c.ev(`(async () => {
  const L = __sl;
  const A = await __bench.capture({ frames: 8 });
  L.grp.visible = false;
  const B = await __bench.capture({ frames: 8 });
  L.grp.visible = true;
  // READABLE PIXELS: where showing her changes the frame by more than 12 codes of luma (the
  // post chain's own A/A floor is ~3-5), and how far (mean |delta|, and the brightest 1%)
  const n = A.w * A.h; let m = 0, sd = 0; const ds = [];
  const lum = (p, i) => 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
  for (let i = 0; i < n; i++) { const o = i * 4, d = lum(A.px, o) - lum(B.px, o); if (Math.abs(d) > 12) { m++; sd += Math.abs(d); ds.push(d); } }
  ds.sort((a, b) => b - a);
  return { readPx: m, meanD: +(sd / Math.max(1, m)).toFixed(1), brightTop1: ds.length ? +ds[Math.floor(ds.length * 0.01)].toFixed(0) : 0, darkerPx: ds.filter(d => d < 0).length };
})()`);
const set = on => c.ev(`(() => { __BR.RIM.k = ${on ? 0.55 : 0}; __BR.GLINT.k = ${on ? 0.75 : 0}; return 1; })()`);
const out = [];
// the meter would re-expose the frame when she is hidden: fixed exposure for the pairs
await c.ev(`(__exposure.set(false), 1)`);
for (const wx of [0.5, 0]) {
  await c.ev(`(weather.set(${wx}, 0), 1)`); await sleep(1500);
  for (const D of [40, 50]) for (const side of [0.0, 1.2]) {
    await place(D, side); await sleep(1800);
    for (const on of [false, true]) {
      await set(on); await sleep(300);
      const r = await measure();
      out.push({ day: wx, D, side, on, ...r });
      console.log(JSON.stringify(out[out.length - 1]));
      if (on) await c.png(`/Users/michaelpaulus/sc/.abyssa-wt/shots/clutch-read-${wx ? 'day' : 'night'}-${D}-${side ? 'side' : 'front'}.png`);
    }
  }
}
c.close();
