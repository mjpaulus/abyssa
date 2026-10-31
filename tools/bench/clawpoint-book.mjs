// THE POINT, BOOKED (clawpoint 2026-10-31): one fresh load, her wake to her stand, the calm by the lab verb, 14 s stepped on the plugged
// clock, and per frame what brooderPoint.js REACH did: the phase and its clock, the brace (fired, foot 0 before/after, his distance), her
// body's lift / pitch / roll offsets, the finger, and the gate (L.ptLive must be null on every frame outside pointPh 2-4).
//   DRV_PORT=<own> node tools/bench/clawpoint-book.mjs <game port> [out.json]
const P = +process.env.DRV_PORT;
if (!Number.isInteger(P) || [8777, 8790, 9419].includes(P)) { console.error('set DRV_PORT to a port of your own'); process.exit(2); }
const [, , PORT, OUT] = process.argv;
const { writeFileSync, mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'cpb-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift } = await import('./clockplug.mjs');
await start(`http://localhost:${PORT}/?bench&playtest`);
process.on('exit', () => stop());
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.lev`, 300000, 500);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`); await sleep(1000);
await plug(c, { stop: true });
await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.__bench.step(30), window.survival.hose = 760, 1)`);
await c.ev(`(window.__lev.cmd('wake'), 1)`);
let stood = false;
for (let k = 0; k < 40 && !stood; k++) { await c.ev(`window.__bench.step(30)`); stood = await c.ev(`!!window.lev.hasStood`); }
if (!stood) { console.log('UNMEASURED: she never stood'); process.exit(2); }
// him 22 u off her toward the opening (CPB_AT=ahead, default) or on her sand side (CPB_AT=back, as pointcam-probe), facing her
await c.ev(`(async () => { const C = await import('/src/config.js'), T = await import('/src/world/terrain.js'); const L = window.lev, rp = C.riftPos(0);
  let ux = rp.x - L.pos.x, uz = rp.z - L.pos.z; if (${JSON.stringify(process.env.CPB_AT || 'ahead')} === 'back') { ux = L.sand.x; uz = L.sand.z; } const ul = Math.hypot(ux, uz); ux /= ul; uz /= ul; const x = L.pos.x + ux * 22, z = L.pos.z + uz * 22;
  window.__bench.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0); window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0); return 1; })()`);
await c.ev(`window.__bench.step(120)`);
await c.ev(`(window.__lev.cmd('calm'), window.__cpb = [], 1)`);
await c.ev(`window.__bench.step(840, () => { const L = window.lev, o = L.ptLive, f = L.feet[0], p = window.player.pos;
  window.__cpb.push({ ph: L.pointPh, u: +L.pointU.toFixed(3), k: +L.pointK.toFixed(4), live: !!o, braceN: L.braceN | 0,
    f0: [+f.planted.x.toFixed(3), +f.planted.z.toFixed(3)], f0t: f.t, dHim: +Math.hypot(f.planted.x - p.x, f.planted.z - p.z).toFixed(2),
    lift: o ? +(o.lift * L.R).toFixed(3) : 0, pit: o ? +(o.pit * 57.3).toFixed(2) : 0, rol: o ? +(o.rol * 57.3).toFixed(2) : 0,
    rz: o ? +(o.rz * 57.3).toFixed(2) : 0, f: +L.claws[1].dj.rotation.z.toFixed(3), kE: o ? +o.kE.toFixed(3) : 0, kW: o ? +o.kW.toFixed(3) : 0,
    walk: !!L.walkTo || !!L.homeTurn }); })`);
const S = await c.ev(`window.__cpb`);
const leak = S.filter(r => r.live && !(r.ph >= 2)).length, off = S.filter(r => r.ph < 2 && (r.lift || r.pit || r.rol || r.rz)).length;
const r2 = S.findIndex(r => r.ph >= 2), end = S.findIndex((r, i) => i > r2 && r.ph === 0);
const f0a = S[r2] && S[r2].f0, f0b = S[end] && S[end].f0;
const sum = { raiseF: r2, endF: end, leak, off, braceN: S[S.length - 1].braceN, braceF: S.findIndex(r => r.braceN > 0), foot0: [f0a, f0b],
  liftMax: Math.max(...S.map(r => r.lift)), liftMin: Math.min(...S.map(r => r.lift)), pitMin: Math.min(...S.map(r => r.pit)), rolMin: Math.min(...S.map(r => r.rol)),
  sagMin: Math.min(...S.map(r => r.rz)), fingerMax: Math.max(...S.slice(r2, end).map(r => r.f)), atEnd: S[end], clock: await drift(c) };
console.log(JSON.stringify(sum));
console.log(leak === 0 && off === 0 ? 'GATE PASS (REACH is null outside the raise / hold / lower, and every offset 0 there)' : 'GATE FAIL');
if (OUT) writeFileSync(OUT, JSON.stringify({ sum, S }));
process.exit(leak === 0 && off === 0 ? 0 : 1);
