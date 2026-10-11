// Task 7 invariants on a FRESH profile (DRV_PORT 9485): 30 s of live play, then lights (scene traversal),
// __lev.fp(0/1/2), terrain fingerprints per anchorage (Alt+- sails home -> Pallid -> Burned -> home, x2,
// with an owned thrust at every stop), programs / geometries / textures at every stop (the soak),
// __safeFailed / __shaderFailed, console errors.
//   node tools/bench/blade-invariants.mjs <port> [extra query, e.g. salproc]
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
const stops = [];
for (let k = 0; k < 6; k++) {
  const r = await c.ev(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Minus', key: '-', altKey: true, bubbles: true }));
    window.__helm = true; window.__bench.step(120, null, { render: true });
    window.__helm = true; window.survival.hasHarpoon = true; window.__bench.step(30, null, { render: true }); window.__slash(); window.__bench.step(70, null, { render: true });
    const C = await import('/src/core.js'); const m = C.renderer.info.memory; let lights = 0; C.scene.traverse(o => { if (o.isLight) lights++; });
    return { site: window.__chart.site(), fp0: window.__ridge.fp([0]), fpAll: window.__ridge.fp(), programs: C.renderer.info.programs.length, geos: m.geometries, tex: m.textures, lights, blade: window.__bladeLast && window.__bladeLast.kind }; })()`);
  stops.push(r); console.log('stop', JSON.stringify(r));
}
console.log('first-sight', stops.length ? (stops[0].programs === base.programs ? 'OK' : 'COMPILED') : '?', base.programs, '->', stops.map(x => x.programs).join(' '));
const tail = await c.ev(`({ fp: [0, 1, 2].map(i => window.__lev.fp(i)), safe: window.__safeFailed(), shader: window.__shaderFailed ? window.__shaderFailed() : 'n/a' })`);
console.log('tail', JSON.stringify(tail));
const cons = await c.console();
const errs = cons.filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
console.log('console errors', errs.length, errs.slice(0, 5).join('\n'));
c.close(); stop();
