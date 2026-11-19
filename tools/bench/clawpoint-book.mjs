// THE POINT, BOOKED (clawpoint 2026-10-31): one fresh load, her wake to her stand, the calm by the lab verb, 14 s stepped on the plugged
// clock, and per frame what brooderPoint.js REACH did: the phase and its clock, the brace (fired, foot 0 before/after, his distance), her
// body's lift / pitch / roll offsets, the finger, and the gate (L.ptLive must be null on every frame outside pointPh 2-4); and (2026-11-19)
// the claw tip and the palm in the world, and the TIP bar on the hold (below). Exit 0 = GATE and TIP pass, 1 = either failed.
//   DRV_PORT=<own> [CPB_AT=back] [CPB_REACH=0] [CPB_BRACE=0.2] [CPB_DRIFT=0] [CPB_TIPV=22] node tools/bench/clawpoint-book.mjs <game port> [out.json]
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
// him 22 u off her toward the opening (CPB_AT=ahead, default), on her sand side (CPB_AT=back, as pointcam-probe), or 22 u directly AWAY from the opening (CPB_AT=behind: behind her front once she has turned to it), or 22 u off her -X side (CPB_AT=offside: her claw's far side), facing her
await c.ev(`(async () => { const C = await import('/src/config.js'), T = await import('/src/world/terrain.js'); const L = window.lev, rp = C.riftPos(0);
  let ux = rp.x - L.pos.x, uz = rp.z - L.pos.z; const AT = ${JSON.stringify(process.env.CPB_AT || 'ahead')}; if (AT === 'back') { ux = L.sand.x; uz = L.sand.z; } else if (AT === 'behind') { ux = -ux; uz = -uz; } else if (AT === 'offside') { const l0 = Math.hypot(ux, uz); ux /= l0; uz /= l0; const t0 = ux; ux = -uz; uz = t0; } const ul = Math.hypot(ux, uz); ux /= ul; uz /= ul; const x = L.pos.x + ux * 22, z = L.pos.z + uz * 22;
  window.__bench.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0); window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0); return 1; })()`);
await c.ev(`window.__bench.step(120)`);
// CPB_BRACE=0.2: a bigger brace offset (REACH.brace, default 0.07), to exercise the step
if (process.env.CPB_BRACE) await c.ev(`import('/src/entities/sleeper/brooderPoint.js').then(m => (m.REACH.brace = ${+process.env.CPB_BRACE}, 1))`);
// CPB_REACH=0: REACH.on = 0, the A/B back to the shipped rigid point (no offsets, no brace, the shipped eyes)
if (process.env.CPB_REACH === '0') await c.ev(`import('/src/entities/sleeper/brooderPoint.js').then(m => (m.REACH.on = 0, 1))`);
// (clawpoint, the hold's jolt) the CLAW TIP: the fixed finger's point, the palm mesh's most distal vertex (largest local x) on the major's
// pj, found once here (the sculpt is in by her stand), booked in the world per frame; the bar (TIPV, below) is judged on the hold (pointPh 3)
await c.ev(`(() => { const L = window.lev, c = L.claws[1].major ? L.claws[1] : L.claws[0], g = c.palm.geometry.attributes.position; let bi = 0;
  for (let i = 1; i < g.count; i++) if (g.getX(i) > g.getX(bi)) bi = i;
  const V = c.palm.position.clone(); window.__cpbTip = { c, loc: V.set(g.getX(bi), g.getY(bi), g.getZ(bi)), w: V.clone() };
  const pa = V.clone(), pb = V.clone();   // the palm midpoint (pj + dj), as pointcam-probe books it, beside the tip
  window.__cpbPalmAt = () => { c.pj.getWorldPosition(pa); c.dj.getWorldPosition(pb); pa.add(pb).multiplyScalar(0.5); return [+pa.x.toFixed(4), +pa.y.toFixed(4), +pa.z.toFixed(4)]; };
  window.__cpbTipAt = () => { const T = window.__cpbTip; T.c.palm.updateWorldMatrix(true, false); T.w.copy(T.loc); T.c.palm.localToWorld(T.w); return [+T.w.x.toFixed(4), +T.w.y.toFixed(4), +T.w.z.toFixed(4)]; };
  return 1; })()`);
// CPB_DRIFT=<x>: REACH.drift for the run (the control: 0 = none of her idle drift kept on the held claw)
if (process.env.CPB_DRIFT) await c.ev(`import('/src/entities/sleeper/brooderPoint.js').then(m => (m.REACH.drift = ${+process.env.CPB_DRIFT}, 1))`);
await c.ev(`(window.__lev.cmd('calm'), window.__cpb = [], 1)`);
await c.ev(`window.__bench.step(840, () => { const L = window.lev, o = L.ptLive, f = L.feet[0], p = window.player.pos;
  window.__cpb.push({ ph: L.pointPh, u: +(L.pointU || 0).toFixed(3), k: +L.pointK.toFixed(4), live: !!o, braceN: L.braceN | 0, bYv: +L.bY.v.toFixed(3), br: !!f.br, eyeLook: !!(L.eyeSt && L.eyeSt.some(e => e.jx !== undefined)),
    f0: [+f.planted.x.toFixed(3), +f.planted.z.toFixed(3)], f0t: f.t, dHim: +Math.hypot(f.planted.x - p.x, f.planted.z - p.z).toFixed(2),
    lift: o ? +(o.lift * L.R).toFixed(3) : 0, pit: o ? +(o.pit * 57.3).toFixed(2) : 0, rol: o ? +(o.rol * 57.3).toFixed(2) : 0,
    rz: o ? +(o.rz * 57.3).toFixed(2) : 0, f: +L.claws[1].dj.rotation.z.toFixed(3), kE: o ? +o.kE.toFixed(3) : 0, kW: o ? +o.kW.toFixed(3) : 0,
    walk: !!L.walkTo || !!L.homeTurn, tip: window.__cpbTipAt(), palm: window.__cpbPalmAt() }); })`);
const S = await c.ev(`window.__cpb`);
const leak = S.filter(r => r.live && !(r.ph >= 2)).length, off = S.filter(r => r.ph < 2 && (r.lift || r.pit || r.rol || r.rz)).length;
const r2 = S.findIndex(r => r.ph >= 2), end = S.findIndex((r, i) => i > r2 && r.ph === 0);
const f0a = S[r2] && S[r2].f0, f0b = S[end] && S[end].f0;
const sum = { eyeLook: S.some(r => r.eyeLook), raiseF: r2, endF: end, leak, off, braceN: S[S.length - 1].braceN, braceF: S.findIndex(r => r.braceN > 0), foot0: [f0a, f0b],
  liftMax: Math.max(...S.map(r => r.lift)), liftMin: Math.min(...S.map(r => r.lift)), pitMin: Math.min(...S.map(r => r.pit)), rolMin: Math.min(...S.map(r => r.rol)),
  sagMin: Math.min(...S.map(r => r.rz)), fingerMax: Math.max(...S.slice(r2, end).map(r => r.f)), atEnd: S[end], clock: await drift(c) };
console.log(JSON.stringify(sum));
console.log(leak === 0 && off === 0 ? 'GATE PASS (REACH is null outside the raise / hold / lower, and every offset 0 there)' : 'GATE FAIL');
// THE HOLD'S JOLT (clawpoint 2026-11-19): the claw tip's peak one-frame speed (u/s, |d tip| * 60) over the hold (pointPh 3, frame pairs both
// in it), with the hold's vertical tip travel (max - min y) and median tip speed booked beside it. The tip is the fixed finger's point (the
// palm's most distal vertex), about twice as far out as pointcam-probe's palm (pj + dj midpoint), so it reads about twice the palm's speeds.
// Measured on this tip (2026-11-19, CPB_AT ahead / back / offside): main's own point 11.7 / 16.2 / 16.4 u/s (its 16s are lone frames, no
// footfall under them); db2e40c 107 / 102 / 106 (a footfall's bY.v step in the held claw's drift). TIPV 22 = main's worst plus a third,
// a fifth of the jolt. CPB_TIPV=<u/s> overrides
const TIPV = +(process.env.CPB_TIPV || 22);
const holdStats = key => {
  const hv = [], hy = [];
  for (let i = 1; i < S.length; i++) if (S[i].ph === 3 && S[i - 1].ph === 3) {
    const a = S[i - 1][key], b = S[i][key]; hv.push({ i, u: S[i].u, v: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 60 });
  }
  for (const r of S) if (r.ph === 3) hy.push(r[key][1]);
  const vs = hv.map(r => r.v).sort((a, b) => a - b), top = hv.slice().sort((a, b) => b.v - a.v)[0];
  return { holdF: hv.length, vMax: top ? +top.v.toFixed(2) : null, vMaxU: top ? top.u : null, vMed: vs.length ? +vs[vs.length >> 1].toFixed(2) : null,
    yTravel: hy.length ? +(Math.max(...hy) - Math.min(...hy)).toFixed(3) : null, over: hv.filter(r => r.v > TIPV).map(r => [r.u, +r.v.toFixed(1)]) };
};
const tipBar = holdStats('tip'), palm = holdStats('palm'); delete palm.over; tipBar.palm = palm;
const tipOk = tipBar.holdF > 100 && tipBar.vMax <= TIPV;
console.log(JSON.stringify({ tipBar }));
console.log(tipOk ? `TIP PASS (the hold's peak tip speed ${tipBar.vMax} u/s <= ${TIPV})` : `TIP FAIL (the hold's peak tip speed ${tipBar.vMax} u/s > ${TIPV}, or no hold booked)`);
if (OUT) writeFileSync(OUT, JSON.stringify({ sum, tipBar, S }));
process.exit(leak === 0 && off === 0 && tipOk ? 0 : 1);
