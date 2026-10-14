// RELIEF STILLS (Task 13, L2 + the L3 exposure reads): in-game stills of home zone 0, the post chain settled, for the SAME build tool on
// main and on the relief branch. A CAPTURE TOOL, NOT A GATE (it always exits 0 unless the page fails to boot).
//   DRV_PORT=9520 node tools/relief/render/stills.mjs <port> <tag> [outdir] [only]     branch: serve.py 8870, DRV_PORT 9520
//   DRV_PORT=9521 node tools/relief/render/stills.mjs <port> <tag> [outdir] [only]     main:   serve.py 8871, DRV_PORT 9521
// `only`: comma list of shot names (prefix match). Writes <outdir>/<tag>-<shot>.png (1512x982 CSS canvas, the bench's own png at scale 1)
// and <outdir>/<tag>-log.json (every shot's camera, ground heights and __exposure.state()).
//
// THE CAMERA RULE (both builds, so the stills frame the same place):
//  * The lens is pinned with window.__camPin = { p, t } (game.js updateCamera). Its HEIGHT is relative to each build's OWN ground:
//    terrainH(lens x, z) + 3.75 (the standing follow lens: floor + EYE_H + CAM_UP), never a world Y.
//  * WORLD-PINNED shots (the same lens x, z and the same look direction on both builds; main's ground there is flat table, the
//    branch's falls away, which is the comparison): 1 raft-column landing (lens (4, 4), looking at the crack, pitch -0.10),
//    2 her bed looking NE at the wall (lens 40 u back from the branch's bed along the raft->crack bearing, pitch +0.06),
//    2b the NE wall from 30 u past the crack's centre on the raft->crack bearing (pitch +0.25), 3 / 3b the upland ridges (lens on the
//    branch's ridge crests (-75, -135) and (-125, 155), looking at the crack, pitch -0.10 / -0.12).
//  * RELATIVE shots (each build's own object, the same offsets): 4 her bed (lens 32 u out, 30 deg round from her open-sand side, looking at her centre),
//    5 the skiff (lens 18 u out on the raft's side, looking at it), 5b the same a quarter turn round.
//  * 6 / 6b the throat from its lip: the SAME lens x, z on the raft side of the lip (the crack is frozen), looking across it at the SAME pitch
//    (so the depth is what differs), the fissure forced open (visitCalm + setOpen, k = 1).
//  Sal stands 9 u ahead of the lens and 3.5 u to the right (the follow lens's own distance), so the depth, the zone and the lighting
//  grade where the lens is. Every shot: air/fuel/hose refilled, ~120 rendered frames of pre-roll (the exposure adapts up in 3 s), then
//  __bench.capture({ settle: 90 }).
const [, , PORT, TAG = 'shot', OUTD0 = '/Users/michaelpaulus/sc/.abyssa-wt/shots/relief-look', ONLY = ''] = process.argv;
if (!process.env.DRV_PORT) { console.error('stills.mjs: set DRV_PORT (9520 branch, 9521 main)'); process.exit(2); }
const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-relief-stills-');
const { start, stop, connect, sleep } = await import('../../bench/drv.mjs');
mkdirSync(OUTD0, { recursive: true });
await start(`http://localhost:${PORT}/?bench&playtest`);
process.on('exit', () => stop());
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), window.__bench.size(1512, 982), window.__drs.pin(1), window.__power.set(60, 60), window.weather.set(1, 0), 1)`);
await sleep(4000);
await c.ev(`(['title','pause','ptPanel','ptToast','ptDock'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), 1)`);

const { readFileSync } = await import('node:fs'); const { dirname, join } = await import('node:path'); const { fileURLToPath } = await import('node:url');
await c.ev(`(async () => { ${readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lens.page.js'), 'utf8')} })()`);

const SHOTS = [];
const add = (name, js) => SHOTS.push({ name, js });
// 1. the raft-column landing, looking at the crack (world-pinned)
add('L2-1-raft-landing', `const k = window.__lk, F = k.F; const yaw = Math.atan2(F.cx + 8, F.cz + 8); k.log['L2-1-raft-landing.view'] = k.view(-8, -8, yaw, -0.15); return await k.shot('L2-1-raft-landing');`);
// 2. her bed, looking NE at the taller wall (world-pinned at the BRANCH's bed station (89.7, 39.1), 40 u back on the raft->crack bearing)
add('L2-2-bed-NE-wall', `const k = window.__lk, F = k.F, Lc = Math.hypot(F.cx, F.cz), ux = F.cx / Lc, uz = F.cz / Lc; const yaw = Math.atan2(ux, uz);
  k.log['L2-2-bed-NE-wall.view'] = k.view(89.7 - 40 * ux, 39.1 - 40 * uz, yaw, 0.06); return await k.shot('L2-2-bed-NE-wall');`);
// 2b. the NE wall itself (the bed's view reaches only ~100 u: the wall foot is at the edge of the water's visibility): the same lens 30 u past the crack
add('L2-2b-NE-wall-near', `const k = window.__lk, F = k.F, Lc = Math.hypot(F.cx, F.cz), ux = F.cx / Lc, uz = F.cz / Lc; const yaw = Math.atan2(ux, uz);
  k.log['L2-2b-NE-wall-near.view'] = k.view(F.cx + 30 * ux, F.cz + 30 * uz, yaw, 0.25); return await k.shot('L2-2b-NE-wall-near');`);
// 3. an upland ridge, looking back over the hollow (world-pinned: the branch's ridge crests, found on the 1 u grid)
add('L2-3-upland-ridge', `const k = window.__lk, F = k.F; const lx = -75, lz = -135; k.log['L2-3-upland-ridge.view'] = k.view(lx, lz, Math.atan2(F.cx - lx, F.cz - lz), -0.10); return await k.shot('L2-3-upland-ridge');`);
add('L2-3b-upland-ridge-west', `const k = window.__lk, F = k.F; const lx = -125, lz = 155; k.log['L2-3b-upland-ridge-west.view'] = k.view(lx, lz, Math.atan2(F.cx - lx, F.cz - lz), -0.12); return await k.shot('L2-3b-upland-ridge-west');`);
// 4. her bed: this build's own bed, the lens 32 u out, 30 deg round from her open-sand side (the straight-on lens sits in kelp on both builds), looking at her centre
add('L2-4-her-bed', `const k = window.__lk, b = k.bed, sd = k.L.sand, a = 30 * Math.PI / 180, rx = sd.x * Math.cos(a) - sd.z * Math.sin(a), rz = sd.x * Math.sin(a) + sd.z * Math.cos(a);
  k.log['L2-4-her-bed.view'] = k.viewAt(b.x + rx * 32, b.z + rz * 32, b.x, k.g(b.x, b.z) + 4, b.z); return await k.shot('L2-4-her-bed');`);
// 5. the skiff on its ground: this build's own skiff, lens 18 u out on the raft's side; 5b the same 18 u out, a quarter turn round (the side view: how it lies on the slope)
const SKIFF = (name, turn) => `const k = window.__lk, w = k.W0, d = Math.hypot(w.x, w.z), ux = -w.x / d, uz = -w.z / d, a = ${turn} * Math.PI / 180, rx = ux * Math.cos(a) - uz * Math.sin(a), rz = ux * Math.sin(a) + uz * Math.cos(a);
  const sl = (x, z) => Math.atan(Math.hypot((k.g(x + 1, z) - k.g(x - 1, z)) / 2, (k.g(x, z + 1) - k.g(x, z - 1)) / 2)) * 57.2958; const v6 = [], v12 = [];
  for (let r = 0; r <= 12; r += 1.5) for (let q = 0; q < 16; q++) { const th = q / 16 * Math.PI * 2, x = w.x + Math.cos(th) * r, z = w.z + Math.sin(th) * r; (r <= 6 ? v6 : v12).push(sl(x, z)); if (r <= 6) v12.push(sl(x, z)); }
  const st = a => ({ mean: +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(1), max: +Math.max(...a).toFixed(1) });
  k.log['${name}.skiffGround'] = { at: [w.x, w.y, w.z], terrainAt: k.g(w.x, w.z), slopeDeg6u: st(v6), slopeDeg12u: st(v12), dev: w.dev };
  k.log['${name}.view'] = k.viewAt(w.x + rx * 18, w.z + rz * 18, w.x, k.g(w.x, w.z) + 1.2, w.z); return await k.shot('${name}');`;
add('L2-5-skiff', SKIFF('L2-5-skiff', 0));
add('L2-5b-skiff-side', SKIFF('L2-5b-skiff-side', 90));
// 6. the open throat from its lip: LAST (it changes state). The lens is on the raft side of the crack, in the crack's own frame (fissureWorld u = 0,
//    v = the raft side), looking ACROSS it at the SAME pitch on both builds, so the throat's depth is what differs. A standing eye cannot see the floor from
//    back of the lip (3.75 u up, the ground hides it), so 6 is at the lip edge (v = halfW + 0.8, pitch -0.80) and 6b is a standing spot (v = halfW + 3, -0.65).
const THROAT = (name, back, pitch) => `const k = window.__lk, S = k.S, F = k.F; window.__chart.visit()[0] = 1; window.__fissure.setOpen(0, 1);
  const w = (u, v) => { const o = { x: 0, z: 0 }; S.fissureWorld(u, v, 0, o); return o; };
  const sg = (() => { const a = w(0, 1), b = w(0, -1); return Math.hypot(a.x, a.z) < Math.hypot(b.x, b.z) ? 1 : -1; })();   // the crack's side facing the raft
  const L = w(0, sg * (F.halfW + ${back})), T = w(0, -sg * 4);
  window.__bench.step(60, null, { render: true });   // the open state lands
  k.log['${name}.view'] = k.view(L.x, L.z, Math.atan2(T.x - L.x, T.z - L.z), ${pitch});
  k.log['${name}.open'] = { k: window.__fissure.k(0), lipGround: k.g(L.x, L.z), floorAtRift: k.g(F.cx, F.cz) }; return await k.shot('${name}');`;
add('L2-6-throat-from-lip', THROAT('L2-6-throat-from-lip', 0.8, -0.80));
add('L2-6b-throat-standing', THROAT('L2-6b-throat-standing', 3, -0.65));

const only = ONLY ? ONLY.split(',') : null;
for (const s of SHOTS) {
  if (only && !only.some(o => s.name.startsWith(o))) continue;
  const t0 = Date.now();
  try {
    const url = await c.ev(`(async () => { ${s.js} })()`);
    writeFileSync(`${OUTD0}/${TAG}-${s.name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${s.name} ok ${Date.now() - t0} ms`);
  } catch (e) { console.log(`${s.name} FAIL ${String(e.message).slice(0, 300)}`); }
}
const log = await c.ev(`({ log: window.__lk.log, lights: (() => { let n = 0; window.scene && window.scene.traverse(o => { if (o.isLight) n++; }); return n; })(), shader: window.__shaderFailed(), safe: window.__safeFailed(), fp: window.__ridge.fp(), w: window.weather.hand && window.weather.hand() })`);
writeFileSync(`${OUTD0}/${TAG}-log.json`, JSON.stringify(log, null, 1));
console.log('shaderFailed', JSON.stringify(log.shader), 'safeFailed', JSON.stringify(log.safe), 'fp', log.fp);
const errs = (await c.console()).filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (errs.length) console.log('CONSOLE', errs.slice(0, 5).join('\n'));
c.close();
process.exit(0);
