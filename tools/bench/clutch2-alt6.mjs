// CLUTCH2: Alt+6 at all three anchorages (Alt+- sails on; its handler is called directly, the
// Alt+6 is the real key). At each: prompt, reach, the clutch's push on him, Sal inside eggs.
import { connect, sleep } from './drv.mjs';
import { boot } from './clutch2-look.mjs';
const c = await connect();
await boot(c);
await c.ev(`(async () => { window.__B = await import('/src/entities/sleeper/bodyCols.js'); return 1; })()`);
for (let s = 0; s < 3; s++) {
  if (s) { await c.ev(`(__playtest.jump('-'), 1)`); await sleep(9000); console.log('sailed:', await c.ev(`__playtest.last()`)); }
  await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); await sleep(3000);
  let maxPush = 0, maxIn = 0;
  for (let i = 0; i < 20; i++) { const r = await c.ev(`(() => { const p = player.pos; let v = 0; for (const h of [-0.9, -0.45, 0]) v = Math.max(v, __B.inClutch(p.x, p.y + h, p.z, 0.45)); return [__B.BODY.push, v]; })()`); maxPush = Math.max(maxPush, r[0]); maxIn = Math.max(maxIn, r[1]); await sleep(100); }
  console.log('site', s, JSON.stringify(await c.ev(`(() => { const B = __sl.brood; return { lev: __sl.pos.toArray().map(v => Math.round(v)), prompt: B.prompt(player.pos), reach: +B.reach(player.pos).toFixed(2), dormant: __sl.dormant, toast: __playtest.last() }; })()`)), 'push', maxPush.toFixed(3), 'salInEggs', maxIn.toFixed(3));
  await c.png(`/Users/michaelpaulus/sc/.abyssa-wt/shots/clutch2-alt6-site${s}.png`);
}
c.close();
