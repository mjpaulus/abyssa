// CLUTCH2: playEnding() on this branch: frames through Velkath's pass (she walks home along the
// zone-0 floor, ending.js), the real clutch's state, errors and shader failures.
import { connect, sleep } from './drv.mjs';
import { boot } from './clutch2-look.mjs';
const c = await connect();
await c.send('Runtime.enable'); await c.send('Log.enable');
await boot(c);
await sleep(3000);
console.log('before', JSON.stringify(await c.ev(`({ sf: __shaderFailed(), lev: !!window.__sl, B: __sl && __sl.brood ? { vis: __sl.brood.core.visible, st: __sl.brood.st } : null })`)));
await c.ev(`(playEnding(), 1)`);
const marks = [-275, -250, -230, -210, -190];
let k = 0; const t0 = Date.now(); let last = '';
while (Date.now() - t0 < 110000) {
  const s = await c.ev(`({ y: +player.pos.y.toFixed(1), st: gameState, cy: +camera.position.y.toFixed(1), lev: window.__sl ? { vis: __sl.grp ? __sl.grp.visible : null, coreVis: __sl.brood ? __sl.brood.core.visible : null, zone: window.zone } : null })`);
  const line = JSON.stringify(s); if (line !== last) { last = line; }
  if (k < marks.length && s.y > marks[k]) { await c.png(`/Users/michaelpaulus/sc/.abyssa-wt/shots/clutch2-ending-${k}.png`); console.log('frame', k, line); k++; }

  if (s.st === 'title' || (k >= marks.length && Date.now() - t0 > 80000)) break;
  await sleep(250);
}
console.log('after', JSON.stringify(await c.ev(`({ sf: __shaderFailed(), st: gameState })`)));
const out = [];
for (const e of c.events) {
  if (e.method === 'Runtime.exceptionThrown') out.push('EXC ' + e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description));
  else if (e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'warning')) out.push(e.params.type + ' ' + e.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
  else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') out.push('log ' + e.params.entry.text + ' ' + (e.params.entry.url || ''));
}
console.log('console', JSON.stringify(out));
c.close();
