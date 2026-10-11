// Task 7 invariants on a FRESH profile (DRV_PORT 9485): 30 s of live play, then lights (scene traversal),
// __lev.fp(0/1/2), terrain fingerprints per anchorage (Alt+- sails home -> Pallid -> Burned -> home, x2,
// with an owned thrust at every stop), programs / geometries / textures at every stop (the soak),
// __safeFailed / __shaderFailed, console errors.
//   node tools/bench/blade-invariants.mjs <port> [extra query, e.g. salproc]
// (final fix wave) It FAILS (exit 1): the fresh profile already owns the harpoon (the first-sight check would be
// vacuous); lights != 14 anywhere; __lev.fp off 15ce888c / c938fe6e / 652d0412; a terrain fingerprint off its
// anchorage's (home 3b526986, Pallid b1c58f8d, Burned d2b6fb68; zones 1+2 at home d49d451d); the first thrust
// at home compiles a program; the soak grows (programs / geometries / textures at a stop vs the same anchorage
// one cycle earlier); the harpoon's thrust did not land at a stop (per stop: the record is cleared before each
// stop's thrust and must be rewritten by it, residual fix 5); __safeFailed / __shaderFailed non-empty; a
// console error (favicon aside). NOGRANT=1 (the control) skips the blade checks.
const [, , port, extra] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9485';
const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-blade-inv-');
const { start, stop, connect, sleep } = await import('./drv.mjs');
await start(`http://localhost:${port}/?bench&playtest${extra ? '&' + extra : ''}`);
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(30000);
// (fix round 1) programs read here, BEFORE the first grant ever on this fresh profile (asserted not owned)
const base = await c.ev(`(async () => { const C = await import('/src/core.js'); let lights = 0; C.scene.traverse(o => { if (o.isLight) lights++; });
  const owned = !!window.survival.hasHarpoon, programs = C.renderer.info.programs.length;
  return { lights, fp: [0, 1, 2].map(i => window.__lev.fp(i)), home: window.__ridge.fp([0]), all: window.__ridge.fp(), z12: window.__ridge.fp([1, 2]), owned, programs }; })()`);
if (base.owned) console.log('WARN the fresh profile owns the harpoon: the first-sight check is vacuous');
console.log('base', JSON.stringify(base));
// the first-sight check proper: at home, where the base was read, grant + settle + the first thrust + settle
const NOGRANT = process.env.NOGRANT === '1';   // the control: the same soak never granting (the voyage's own programs)
const home = await c.ev(`(async () => { const C = await import('/src/core.js'); window.__helm = true;
  if (!${NOGRANT}) window.survival.hasHarpoon = true; window.__bench.step(30, null, { render: true }); window.__slash(); window.__bench.step(70, null, { render: true });
  return { programs: C.renderer.info.programs.length, owned: !!window.survival.hasHarpoon }; })()`);
console.log('first-sight at home', base.programs, '->', home.programs, home.programs === base.programs ? 'OK' : 'COMPILED', 'owned', home.owned);
const stops = [];
for (let k = 0; k < 6; k++) {
  const r = await c.ev(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Minus', key: '-', altKey: true, bubbles: true }));
    window.__helm = true; window.__bench.step(120, null, { render: true });
    window.__helm = true; if (!${NOGRANT}) window.survival.hasHarpoon = true; window.__bench.step(30, null, { render: true });
    // (residual fix 5) per stop: the record is cleared before THIS stop's thrust, so a stale 'harpoon' from an
    // earlier stop no longer passes; the landing rewrites kind and t
    const t0 = window.__bladeLast ? window.__bladeLast.t : null; if (window.__bladeLast) window.__bladeLast.kind = '';
    window.__slash(); window.__bench.step(70, null, { render: true });
    const C = await import('/src/core.js'); const m = C.renderer.info.memory; let lights = 0; C.scene.traverse(o => { if (o.isLight) lights++; });
    const bl = window.__bladeLast;
    return { site: window.__chart.site(), fp0: window.__ridge.fp([0]), fpAll: window.__ridge.fp(), programs: C.renderer.info.programs.length, geos: m.geometries, tex: m.textures, lights,
      blade: bl ? bl.kind : null, landed: !!bl && bl.kind !== '' && bl.t !== t0 }; })()`);
  stops.push(r); console.log('stop', JSON.stringify(r));
}
console.log('soak programs', base.programs, home.programs, '->', stops.map(x => x.programs).join(' '));
const tail = await c.ev(`({ fp: [0, 1, 2].map(i => window.__lev.fp(i)), safe: window.__safeFailed(), shader: window.__shaderFailed ? window.__shaderFailed() : 'n/a' })`);
console.log('tail', JSON.stringify(tail));
const cons = await c.console();
const errs = cons.filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
console.log('console errors', errs.length, errs.slice(0, 5).join('\n'));
c.close(); stop();
const FP = ['15ce888c', 'c938fe6e', '652d0412'], SITE_FP = { 0: '3b526986', 1: 'b1c58f8d', 2: 'd2b6fb68' };
const fail = [];
if (base.owned) fail.push('the fresh profile owned the harpoon before the first grant (the first-sight check is vacuous)');
if (base.lights !== 14) fail.push('lights at boot ' + base.lights);
if (base.fp.join() !== FP.join()) fail.push('__lev.fp at boot ' + base.fp.join(' '));
if (base.all !== SITE_FP[0]) fail.push('home terrain fingerprint ' + base.all);
if (base.z12 !== 'd49d451d') fail.push('zones 1+2 fingerprint ' + base.z12);
if (!NOGRANT && home.programs !== base.programs) fail.push(`the first thrust at home compiled: programs ${base.programs} -> ${home.programs}`);
stops.forEach((r, k) => {
  if (r.lights !== 14) fail.push(`stop ${k} (site ${r.site}): lights ${r.lights}`);
  if (SITE_FP[r.site] && r.fpAll !== SITE_FP[r.site]) fail.push(`stop ${k} (site ${r.site}): terrain fingerprint ${r.fpAll}, want ${SITE_FP[r.site]}`);
  if (!NOGRANT && !(r.landed && r.blade === 'harpoon')) fail.push(`stop ${k} (site ${r.site}): the harpoon's thrust did not land at this stop (${r.blade}, landed ${r.landed})`);
  const prev = stops[k - 3];
  if (prev) for (const key of ['programs', 'geos', 'tex']) if (r[key] > prev[key]) fail.push(`soak: ${key} grew at site ${r.site} ${prev[key]} -> ${r[key]} (stop ${k - 3} -> ${k})`);
});
if (tail.fp.join() !== FP.join()) fail.push('__lev.fp at the end ' + tail.fp.join(' '));
if (tail.safe.length) fail.push('__safeFailed ' + JSON.stringify(tail.safe));
if (Array.isArray(tail.shader) && tail.shader.length) fail.push('__shaderFailed ' + JSON.stringify(tail.shader));
if (errs.length) fail.push(errs.length + ' console errors');
if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('PASS');
