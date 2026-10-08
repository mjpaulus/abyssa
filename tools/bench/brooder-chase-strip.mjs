// BROODER-CLUTCH proof strips through REAL input (keys over CDP; yaw/pitch are the mouse's job):
//   (2) the take -> wake: E at the Alt+6 spot, frames through her ~6 s rise;
//   (3) a 30 s chase from the default camera: he flees with the clump (W+Shift), turning his
//       head back and to the side the way a player checks behind; frames every ~1.5 s with
//       the distance, her speed, the felt footfalls, her wake, the eyeshine and the voice.
//   WX=0 (night) | 0.5 (day)   PORT=8830 DRV_PORT=9430 node tools/bench/brooder-chase-strip.mjs
import { connect, sleep } from './drv.mjs';
import { readdirSync, unlinkSync } from 'node:fs';
const PORT = process.env.PORT || 8830, WX = process.env.WX ?? '0';
const DIR = '/Users/michaelpaulus/sc/.abyssa-wt/shots/', TAG = process.env.TAG || ('clutch-chase-' + (+WX ? 'day' : 'night'));
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
await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(2500);
for (const f of readdirSync(DIR)) if (f.startsWith(TAG + '-')) unlinkSync(DIR + f);
await c.ev(`(async () => { window.__PL = await import('/src/entities/sleeper/plume.js'); window.__evT = { thumps: 0, maxThump: 0, last: 0 };
  // count her felt footfalls as the game sees them (the event record the frame hands game.js)
  const A = await import('/src/audio.js'); const orig = A.audioSleeper; return 1; })()`);
let n = 0; const snap = async (name) => { await c.png(`${DIR}${TAG}-${String(n++).padStart(2, '0')}-${name}.png`); };
const st = () => c.ev(`(() => { const L = __sl, p = player.pos, E = __audio.E && __audio.E(); const cre = E && E.cre;
  return { t: +performance.now().toFixed(0), d: +Math.hypot(p.x - L.pos.x, p.z - L.pos.z).toFixed(1), v: +Math.hypot(L.vel.x, L.vel.z).toFixed(2), stand: +L.stand.toFixed(2), huntK: +(L.huntK || 0).toFixed(2),
    glint: L.glints ? +Math.max(L.glints[0].material.opacity, L.glints[1].material.opacity).toFixed(3) : 0, seen: L.seen, held: L.brood.held,
    voice: cre ? +cre.huntG.gain.value.toFixed(3) : null, bodyDry: cre && cre.body ? +cre.body.dry.gain.value.toFixed(3) : null, bodyLP: cre && cre.body ? Math.round(cre.body.lp.frequency.value) : null,
    feet: E ? E.LOG.filter(e => e.name === 'velkathFoot').length : null, audio: __audio.state() }; })()`);
// (2) take -> wake
await snap('take-before');
await c.tap('KeyE', 100);
for (let i = 0; i < 5; i++) { await sleep(1300); await snap('wake-' + i); }
await c.until(`__sl.stand >= 0.98`, 20000);
console.log('risen', JSON.stringify(await st()));
// (3) the chase: away from her; look back / aside on a schedule (the mouse), keys for the rest
// he runs for home (the raft side: open seabed), as a thief would
const away = `Math.atan2(-player.pos.x, -player.pos.z)`;
// THE LEAD (staged, like a playtest jump): a thief who swam clear. He is set down LEAD u from
// her on the open seabed toward the raft (the first clear spot), standing, and everything after
// is real input: he looks back at her (the mouse), then runs (W+Shift) while she comes on.
await c.ev(`(async () => { const T = await import('/src/world/terrain.js'); const L = __sl, a = Math.atan2(-L.pos.x, -L.pos.z), D = ${+(process.env.LEAD || 62)};
  let best = null; for (let k = 0; k < 24 && !best; k++) { const b = a + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * 0.12; const x = L.pos.x + Math.sin(b) * D, z = L.pos.z + Math.cos(b) * D; if (T.terrainNormal(x, z, 0).y > 0.93) best = [x, z]; }
  if (!best) best = [L.pos.x + Math.sin(a) * D, L.pos.z + Math.cos(a) * D];
  player.pos.set(best[0], T.terrainH(best[0], best[1], 0) + 1.35, best[1]); player.vel.set(0, 0, 0); player.yaw = Math.atan2(L.pos.x - best[0], L.pos.z - best[1]); return 1; })()`);
await sleep(600);
console.log('lead', JSON.stringify(await st()));
// Then he stops and looks back (the mouse turns the lens), as she comes on from ~60 u: a frame
// every ~1.4 s, alternating straight at her and with her at the side of the frame (beside him);
// then he runs again (forward frames: she is behind the lens there, the voice, the thump and
// the sand at his boots carry her).
const toHer = `Math.atan2(__sl.pos.x - player.pos.x, __sl.pos.z - player.pos.z)`;
const rows = [];
const OFFS = [0, 0.55, 0, -0.55];
for (let k = 0; k < 12; k++) {
  const off = OFFS[k % 4];
  const t0 = Date.now();
  while (Date.now() - t0 < 1400) { await c.ev(`(player.yaw = ${toHer} + ${off}, player.pitch = 0.03, 1)`); await sleep(100); }
  const s = await st(); s.label = off ? 'beside' : 'lookback'; rows.push(s);
  await snap(`${s.label}-d${Math.round(s.d)}`);
  console.log(JSON.stringify(s));
  if (s.d < 30) break;
}
await c.key('KeyW', true); await c.key('ShiftLeft', true);
for (let k = 0; k < 4; k++) {
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) { await c.ev(`(player.yaw = ${away}, player.pitch = -0.05, 1)`); await sleep(100); }
  const s = await st(); s.label = 'flee'; rows.push(s);
  await snap(`flee-d${Math.round(s.d)}`);
  console.log(JSON.stringify(s));
}
await c.key('KeyW', false); await c.key('ShiftLeft', false);
console.log('wake quads alive', await c.ev(`(() => { const g = __PL; return g.plumeState ? JSON.stringify(g.plumeState()) : 'n/a'; })()`));
console.log('audio log tail', JSON.stringify(await c.ev(`(__audio.E && __audio.E()) ? __audio.E().LOG.slice(-12).map(e => e.name) : []`)));
c.close();
