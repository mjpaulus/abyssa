// The knife's exact path (fissure-and-harpoon Task 7 regression): on the persistent blade-shots page (DRV_PORT 9485),
// a fresh reload, Alt+3, 120 settled frames, window.__slash(), then per frame through 0.6 s: the left hand's world
// position and the composed arm channels. Prints JSON lines; diff two runs (before/after a change).
//   node tools/bench/knife-trace.mjs > out.json
process.env.DRV_PORT = process.env.DRV_PORT || '9485';
const { connect, sleep } = await import('./drv.mjs');
let c = await connect();
await c.ev(`(location.reload(), 1)`).catch(() => {}); await sleep(3000);
c.close(); c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench`, 240000, 1000);
const r = await c.ev(`(async () => {
  window.__helm = true; window.survival.hasHarpoon = false; window.setState('play'); window.__bench.step(30);   // the knife (a saved harpoon would make it the thrust)
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit3',key:'3',altKey:true,bubbles:true}));
  window.__helm = true; window.__bench.step(120);
  const D = await import('/src/entities/diver.js'); const G = window.__gait.dbg, CH = G.CH, v = new (window.player.pos.constructor)();
  const out = []; window.__slash();
  window.__bench.step(38, i => { D.diver.armL.end.getWorldPosition(v); v.sub(window.player.pos);
    out.push([i, +v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5), +G.pc[CH.Lsx].toFixed(5), +G.pc[CH.Lsy].toFixed(5), +G.pc[CH.Lsz].toFixed(5), +G.pc[CH.Le].toFixed(5), +G.pc[CH.sYaw].toFixed(5), D.diver.knifeHeld.visible ? 1 : 0]); });
  return out; })()`);
for (const row of r) console.log(JSON.stringify(row));
process.exit(0);
