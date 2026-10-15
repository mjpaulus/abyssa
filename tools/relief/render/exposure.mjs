// L3a: AUTO-EXPOSURE AT THREE PLACES (Task 13). __exposure.state() on the follow lens (the real one, no pin) with Sal stood at: the raft column (the bench's
// z0 spot, (4, 4) yaw 0.5), her bed (30 u out from HER centre on her open-sand side, facing her: the bench's z0b rule, relative to each build's own bed), and an
// upland ridge ((-75, -135), the branch's crest, looking at the crack; the same world spot on main). Settled 6 s of rendered frames, read, 2 s more, read again.
// Per read: mult against the clamp in force at that depth01, whether it sits ON a fence (pinned), and the RAW want (the exposure the meter asks for before the
// clamp, key - meanLog + E.ev, air 0 below the interface) against log2 of the fences: a want past a fence is the scene asking for more than the clamp allows.
// A CAPTURE / PROBE TOOL, NOT A GATE (always exits 0).
//   DRV_PORT=9520 node tools/relief/render/exposure.mjs <port> <tag> [outdir]       branch: 8870 / 9520;  main: 8871 / 9521
const [, , PORT, TAG = 'exp', OUTD = '/Users/michaelpaulus/sc/.abyssa-wt/shots/relief-look'] = process.argv;
if (!process.env.DRV_PORT) { console.error('exposure.mjs: set DRV_PORT (9520 branch, 9521 main)'); process.exit(2); }
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
const { dirname, join } = await import('node:path'); const { fileURLToPath } = await import('node:url');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-relief-exp-');
const { start, stop, connect, sleep } = await import('../../bench/drv.mjs');
mkdirSync(OUTD, { recursive: true });
await start(`http://localhost:${PORT}/?bench&playtest`);
process.on('exit', () => stop());
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), window.__bench.size(1512, 982), window.__drs.pin(1), window.__power.set(60, 60), window.weather.set(1, 0), 1)`);
await sleep(4000);
await c.ev(`(async () => { ${readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lens.page.js'), 'utf8')} })()`);
const out = await c.ev(`(async () => {
  const k = window.__lk, F = k.F, B = window.__bench, { GLASS } = await import('/src/config.js');
  const read = () => { const s = window.__exposure.state(), E = GLASS.exposure, lo = s.clamp[0], hi = s.clamp[1];
    const want = s.key - s.meanLog + (E.ev || 0), lE = Math.log2(lo), hE = Math.log2(hi);
    return { mult: s.mult, clamp: s.clamp, depth01: s.depth01, ev: s.ev, wantEv: +want.toFixed(3), fenceEv: [+lE.toFixed(3), +hE.toFixed(3)], insideClamp: s.mult >= lo - 1e-3 && s.mult <= hi + 1e-3,
      pinned: s.mult <= lo + 2e-3 ? 'LOW fence' : s.mult >= hi - 2e-3 ? 'HIGH fence' : 'free', wantPast: want < lE - 1e-3 ? 'below the low fence by ' + (lE - want).toFixed(2) + ' EV' : want > hE + 1e-3 ? 'above the high fence by ' + (want - hE).toFixed(2) + ' EV' : 'inside', key: s.key, meanLog: s.meanLog, camY: window.camera.position.y }; };
  const spots = [
    ['raft-column', () => window.__bench.place(4, 4, 0.5, 0)],
    ['her-bed', () => { const b = k.bed, sd = k.L.sand, x = b.x + sd.x * 30, z = b.z + sd.z * 30; return window.__bench.place(x, z, Math.atan2(b.x - x, b.z - z), 0); }],
    ['upland-ridge', () => window.__bench.place(-75, -135, Math.atan2(F.cx + 75, F.cz + 135), 0)]];
  const res = {};
  for (const [name, set] of spots) {
    window.__camPin = null; k.refill(); const p = set();
    B.step(360, null, { render: true }); const a = read();
    k.refill(); B.step(120, null, { render: true }); const b = read();
    res[name] = { at: [window.player.pos.x, window.player.pos.y, window.player.pos.z], ground: k.g(window.player.pos.x, window.player.pos.z), read1: a, read2: b };
  }
  return { fp: window.__ridge.fp(), E: { ev: GLASS.exposure.ev, on: GLASS.exposure.on }, res };
})()`);
writeFileSync(`${OUTD}/${TAG}-exposure.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.E), out.fp);
for (const [k, v] of Object.entries(out.res)) console.log(k, 'ground', v.ground.toFixed(1), '|', JSON.stringify(v.read1), '|', JSON.stringify(v.read2));
c.close();
process.exit(0);
