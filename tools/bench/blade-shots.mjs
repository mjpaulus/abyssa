// Sal's blade look-dev (fissure-and-harpoon Task 7): a persistent headless page, driven one command at a time.
//   node tools/bench/blade-shots.mjs start <port> [extra query, e.g. salproc]
//   node tools/bench/blade-shots.mjs ev "<expr>"            evaluate in the page (async ok), print JSON
//   node tools/bench/blade-shots.mjs png <file> [view]       one rendered frame -> png. view: game (the follow lens),
//        left | right | front | back (a pinned lens 4.2 u off his side at chest height, looking at his chest)
//   node tools/bench/blade-shots.mjs stop
// Env DRV_PORT (default 9485).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
process.env.DRV_PORT = process.env.DRV_PORT || '9485';
const { start, stop, connect } = await import('./drv.mjs');
const [, , cmd, a1, a2, a3] = process.argv;
if (cmd === 'stop') { stop(); process.exit(0); }
if (cmd === 'start') {
  await start(`http://localhost:${a1}/?bench&playtest${a2 ? '&' + a2 : ''}`);
  const c = await connect();
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench`, 240000, 1000);
  await c.ev(`(window.__helm = true, window.setState('play'), ['title','pause'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), window.__bench.step(30), window.__helm = false, 1)`);
  console.log('ready');
  process.exit(0);
}
const c = await connect();
if (cmd === 'ev') { console.log(JSON.stringify(await c.ev(`(async () => { window.__helm = true; try { return await (${a1}); } finally { window.__helm = false; } })()`))); process.exit(0); }
if (cmd === 'png') {
  const view = a2 || 'game', dist = +(a3 || 4.2);
  await c.ev(`(async () => {
    window.__helm = true;
    const D = await import('/src/entities/diver.js');
    ['title','pause','ptDock','ptPanel','ptToast'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; });
    const v = '${view}', P = window.player, y = D.diver.rotation.y;
    if (v === 'game') window.__camPin = null;
    else {
      const ang = { left: Math.PI / 2, right: -Math.PI / 2, front: 0, back: Math.PI, fl: Math.PI / 4, fr: -Math.PI / 4 }[v] || 0;
      const a = y + ang, d = ${dist};
      const cx = P.pos.x + Math.sin(a) * d, cz = P.pos.z + Math.cos(a) * d, cy = P.pos.y - 0.25;
      window.__camPin = { p: [cx, cy, cz], t: [P.pos.x, P.pos.y - 0.35, P.pos.z] };
    }
    window.__bench.step(1, null, { render: true });
    window.__bench.hold(true);   // the live loop must not run the game on (or redraw) before the screenshot
    return 1; })()`);
  mkdirSync(dirname(a1), { recursive: true });
  await c.png(a1);
  await c.ev(`(window.__bench.hold(false), window.__helm = false, 1)`);
  console.log('wrote', a1);
  process.exit(0);
}
// strip <prefix> [view] [dist]: window.__slash() then a frame every 0.05 s through 0.9 s -> <prefix>-NN.png
if (cmd === 'strip') {
  const view = a2 || 'game', dist = +(a3 || 4.2);
  mkdirSync(dirname(a1), { recursive: true });
  // the lens is pinned ONCE, at the swing's start (a lens that follows his turn would hide it)
  await c.ev(`(async () => {
    window.__helm = true;
    const D = await import('/src/entities/diver.js');
    window.player.yaw = D.diver.rotation.y; window.__bench.step(70);   // no squaring-up turn in the strip (and the last swing over)
    ['title','pause','ptDock','ptPanel','ptToast'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; });
    const v = '${view}', P = window.player, y = P.yaw;
    window.__camPin = null;
    if (v !== 'game') {
      const ang = { left: Math.PI / 2, right: -Math.PI / 2, front: 0, back: Math.PI, fl: Math.PI / 4, fr: -Math.PI / 4 }[v] || 0;
      const a = y + ang, d = ${dist};
      window.__camPin = { p: [P.pos.x + Math.sin(a) * d, P.pos.y - 0.25, P.pos.z + Math.cos(a) * d], t: [P.pos.x + Math.sin(y) * 0.8, P.pos.y - 0.35, P.pos.z + Math.cos(y) * 0.8] };
    }
    window.__slash();
    window.__bench.hold(true);   // the live loop stands still between the frames (it animates Sal even paused)
    return 1; })()`);
  for (let k = 0; k <= 18; k++) {
    await c.ev(`(window.__helm = true, window.__bench.step(${k === 0 ? 1 : 3}, null, { render: true }), window.__helm = false, 1)`);
    await c.png(`${a1}-${String(k).padStart(2, '0')}.png`);
  }
  await c.ev(`(window.__bench.hold(false), window.__helm = false, 1)`);
  console.log('wrote 19 frames', a1);
  process.exit(0);
}
// at <file> <view> <dist> <sec>: settle his yaw onto the look first, then window.__slash(), step to <sec>, png
if (cmd === 'at') {
  const view = a2 || 'game', dist = +(a3 || 4.2), sec = +(process.argv[6] || 0.3);
  await c.ev(`(async () => {
    window.__helm = true; window.__camPin = null;
    { const D = await import('/src/entities/diver.js'); window.player.yaw = D.diver.rotation.y; }   // no squaring-up turn in the frame
    window.__bench.step(90);
    ['title','pause','ptDock','ptPanel','ptToast'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; });
    const v = '${view}', P = window.player, y = P.yaw;
    if (v !== 'game') {
      const ang = { left: Math.PI / 2, right: -Math.PI / 2, front: 0, back: Math.PI, fl: Math.PI / 4, fr: -Math.PI / 4, bl: Math.PI * 0.75, br: -Math.PI * 0.75 }[v] || 0;
      const a = y + ang, d = ${dist};
      window.__camPin = { p: [P.pos.x + Math.sin(a) * d, P.pos.y + 0.1, P.pos.z + Math.cos(a) * d], t: [P.pos.x + Math.sin(y) * 0.6, P.pos.y - 0.1, P.pos.z + Math.cos(y) * 0.6] };
    }
    if (${sec} >= 0) window.__slash();
    window.__bench.step(Math.max(1, Math.round(${sec} * 60)), null, { render: true });
    window.__bench.hold(true);   // the live loop must not run the game on (or redraw) before the screenshot
    return 1; })()`);
  mkdirSync(dirname(a1), { recursive: true });
  await c.png(a1);
  await c.ev(`(window.__bench.hold(false), window.__helm = false, 1)`);
  console.log('wrote', a1);
  process.exit(0);
}
console.error('unknown command ' + cmd); process.exit(1);
