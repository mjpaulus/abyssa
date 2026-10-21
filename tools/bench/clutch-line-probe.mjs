// THE CLUTCH'S LINE AND ITS FAN, BURIED AND RISEN (velkath-buried-rock Task 6; brood.js B.update).
//   DRV_PORT=<own> node tools/bench/clutch-line-probe.mjs <game port>
// Buried, there are no eggs to see: "A CLUTCH UNDER HER..." (found.clutch) and the fanning puff are held while L.bury > 0.5; risen, or at a ground
// she is not buried at, they are as shipped. Stepped on the PLUGGED clock (clockplug.mjs), him placed frame by frame (a virtual walk: the line's
// gate is his plan distance to B.takeAt, 11 u, and |dy| < 10). Three legs, in order, one browser:
//   buried  home, her asleep and buried: 30 s walking a circle 8 u (6-10 u band) round her centre at 1.5 u/s, then 12 s stood 4 u from the take
//           point. BAR: found.clutch stays false, no message or queued message holds 'CLUTCH', B.fanT does not move (the puff clock is held);
//           vacuity floor: >= 300 stepped frames inside 11 u of takeAt (the gate's own range), else UNMEASURED
//   ridge   CONTROL: __burial.set({ on: 0 }) (the shipped ridge at home: no burial), the same stand 4 u from the take point for 12 s: the line must
//           book (found.clutch true and the text seen) and fanT must run: the probe can see what it says it cannot
//   pallid  __chart.arrive(1): her asleep there (never buried: no row key), the same stand: the line books and the fan runs; B.drop 0 and the mass
//           meshes at y 0 (the shipped transforms)
// Exit 0 pass | 1 a bar failed | 2 UNMEASURED | 4 LOST (clock drift over 0.05 s). JSON -> CL_OUT (default ~/sc/.abyssa-wt/reviews/buried/clutch-line-<tag>.json)
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 9419].includes(P)) { console.error('clutch-line-probe: set DRV_PORT to a port of its own (not 8777 / 8790 / 9419)'); process.exit(2); }
const PORT = process.argv[2];
if (!/^\d+$/.test(PORT || '')) { console.error('usage: DRV_PORT=<own> node tools/bench/clutch-line-probe.mjs <game port>'); process.exit(2); }
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir, homedir } = await import('node:os');
const { join, dirname } = await import('node:path');
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-clutchline-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, unmeasured, lost } = await import('./clockplug.mjs');
let started = false;
process.on('exit', () => { if (started) stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
const OUT = process.env.CL_OUT || join(homedir(), 'sc/.abyssa-wt/reviews/buried', `clutch-line-${process.env.CL_TAG || 'port' + PORT}.json`);
const rec = { port: +PORT, legs: {} };
const finish = (code, why) => { rec.exit = code; if (why) rec.why = why; try { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(rec, null, 1)); console.log('JSON ' + OUT); } catch (e) { } process.exit(code); };

// the page side: STAND(d) places him d u from the take point on the far side from her centre; WALK(r, secs) circles her centre at r u
const LEG = (mode, a, secs) => `(async () => {
  const L = window.lev, B = L && L.brood; if (!B || !B.seated) return { err: 'no seated brood (' + (L && L.kind) + ')' };
  const T = B.takeAt, cx = L.pos.x, cz = L.pos.z, seen = new Set(), tx = [];
  const f0 = B.fanT, found0 = B.found.clutch; let inRange = 0, minD = 1e9, fanMax = f0, fanMin = f0, fanRuns = 0, prevFan = f0;
  let ang = Math.atan2(T.z - cz, T.x - cx) + 0.6, x = 0, z = 0;
  if (${JSON.stringify(mode)} === 'stand') { const dx = T.x - cx, dz = T.z - cz, dl = Math.hypot(dx, dz) || 1; x = T.x + dx / dl * ${a}; z = T.z + dz / dl * ${a}; }
  const n = ${secs} * 60, om = 1.5 / ${a};
  for (let f = 0; f < n; f += 6) {
    window.__bench.step(6, () => {
      if (${JSON.stringify(mode)} === 'walk') { ang += om / 60; x = cx + Math.cos(ang) * ${a}; z = cz + Math.sin(ang) * ${a}; }
      window.__bench.place(x, z, Math.atan2((${JSON.stringify(mode)} === 'walk' ? cx : T.x) - x, (${JSON.stringify(mode)} === 'walk' ? cz : T.z) - z), 0);
      const d = Math.hypot(player.pos.x - T.x, player.pos.z - T.z); if (d < 11) inRange++; if (d < minD) minD = d;
    });
    const m = window.__msg(); for (const t of [m.live, m.pend, ...m.queue]) if (t) seen.add(t);
    if (B.fanT > prevFan + 1) fanRuns++; prevFan = B.fanT; if (B.fanT > fanMax) fanMax = B.fanT; if (B.fanT < fanMin) fanMin = B.fanT;
  }
  const mp = [B.core, B.beadsN, B.setae].filter(Boolean).map(o => o.position.y);
  return { mode: ${JSON.stringify(mode)}, secs: ${secs}, frames: n, inRange, minD: +minD.toFixed(2), found: B.found.clutch, found0, texts: [...seen], clutchText: [...seen].some(t => /CLUTCH/.test(t)),
    fanT: [+f0.toFixed(3), +B.fanT.toFixed(3)], fanRuns, fanMoved: Math.abs(B.fanT - f0) > 1e-9 || fanMax !== f0 || fanMin !== f0, bury: L.bury, buried: !!L.buried, drop: B.drop, massY: mp, dormant: !!L.dormant, takeAt: [+T.x.toFixed(1), +T.y.toFixed(1), +T.z.toFixed(1)] }; })()`;

let c = null;
try {
  started = true; await start('about:blank'); c = await connect();
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/?bench&playtest` });
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`); await sleep(1000);
  await plug(c);
  await c.ev(`(window.__chart.arrive(0), window.gotoZone(0), window.__bench.step(60), 1)`);
} catch (e) { console.error('UNMEASURED: boot: ' + (e && e.message || e)); finish(2, 'boot'); }

let fail = [], vac = [];
try {
  const hasB = await c.ev(`!!(window.__burial && window.__burial.set)`);
  rec.build = hasB ? 'burial' : 'main';
  // buried: the walk, then the stand
  const w = await c.ev(LEG('walk', 8, 30)), s = await c.ev(LEG('stand', 4, 12));
  rec.legs.buried = { walk: w, stand: s };
  for (const [nm, r] of [['walk', w], ['stand', s]]) {
    if (!r || r.err) { vac.push('buried ' + nm + ': ' + (r && r.err)); continue; }
    console.log(`buried ${nm}: ${JSON.stringify({ ...r, takeAt: undefined })}`);
    if (!r.buried || !(r.bury > 0.5)) vac.push(`buried ${nm}: she is not buried (bury ${r.bury})`);
    if (r.found || r.clutchText) fail.push(`buried ${nm}: the clutch line booked (found ${r.found}, texts ${JSON.stringify(r.texts)})`);
    if (r.fanMoved) fail.push(`buried ${nm}: the fan clock moved (${r.fanT.join(' -> ')})`);
  }
  if (w && !w.err && w.inRange < 300) vac.push(`buried walk: only ${w.inRange} frames inside 11 u of the take point (floor 300)`);
  if (s && !s.err && s.inRange < 600) vac.push(`buried stand: only ${s.inRange} frames inside 11 u of the take point (floor 600)`);
  // the controls: the same stand, not buried
  const ctl = async (name, prep) => {
    await c.ev(prep); await c.ev(`window.__bench.step(90)`);
    // the line must book DURING the measured leg: stand him 60 u off, forget it, and wait out any live message (a message up blocks the next; 12 s is past any dur)
    await c.ev(`(() => { const L = window.lev, T = L.brood.takeAt; window.__bench.place(T.x + 45, T.z + 45, 0, 0); L.brood.found.clutch = false; window.__bench.step(2); return 1; })()`);
    for (let k = 0; k < 8 && await c.ev(`!!(window.__msg().live || window.__msg().pend)`); k++) await c.ev(`window.__bench.step(120)`);
    const r = await c.ev(LEG('stand', 4, 12)); rec.legs[name] = r;
    if (!r || r.err) { vac.push(name + ': ' + (r && r.err)); return; }
    console.log(`${name} stand: ${JSON.stringify({ ...r, takeAt: undefined })}`);
    if (r.buried) vac.push(name + ': still buried');
    if (r.found0) fail.push(`${name}: the line was already booked when the leg began (found0)`);
    if (!(r.found && r.clutchText)) fail.push(`${name}: the clutch line did not book (found ${r.found}, texts ${JSON.stringify(r.texts)}): the probe cannot see it`);
    if (!(r.fanRuns >= 1 || r.fanMoved)) fail.push(`${name}: the fan clock did not run (${r.fanT.join(' -> ')})`);
    if (r.drop !== 0 || r.massY.some(y => y !== 0)) fail.push(`${name}: the mass is not at its shipped transform (drop ${r.drop}, y ${JSON.stringify(r.massY)})`);
    if (r.inRange < 600) vac.push(`${name}: only ${r.inRange} frames inside 11 u of the take point`);
  };
  if (hasB) await ctl('ridge', `(async () => { await window.__burial.set({ on: 0 }); window.__bench.step(30); return 1; })()`);
  await ctl('pallid', `(window.__chart.arrive(1), window.gotoZone(0), window.__bench.step(60), 1)`);
} catch (e) { console.error('UNMEASURED: ' + (e && e.message || e)); finish(2, String(e && e.message || e)); }
const d = await drift(c); rec.clock = d;
if (unmeasured(d)) { console.error('UNMEASURED: no clock reading'); finish(2, 'no clock'); }
if (lost(d)) { console.error('CLOCK LOST ' + JSON.stringify(d)); finish(4, 'clock'); }
if (fail.length) { console.error('FAIL ' + fail.join('; ')); finish(1, fail.join('; ')); }
if (vac.length) { console.error('UNMEASURED: ' + vac.join('; ')); finish(2, vac.join('; ')); }
console.log('PASS'); finish(0);
