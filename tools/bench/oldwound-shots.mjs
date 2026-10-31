// THE OLD WOUND, STILLS (branch oldwound): the remembered build at home (a pulled save seeded before the page's scripts), settled day
// (weather.set(1, 0)), the follow lens, on the PLUGGED clock. burial-probe's `wound` framing (its page side, window.__bpWound.aim): him on
// the sand 14 / 10 / 6 u out from the seam along her sand side, and at Alt+6's anchor, turned so the seam sits at ndc.x 0.3 beside him.
// Each view: <tag>-<view>.png (a frozen capture, grain off, after 90 counted rendered frames) and <tag>-<view>-zoom.png (3x round the
// seam). Then the zone line on screen (the title click's own path, window.start(), stepped until the line that holds 'OLD WOUND' is
// live, him at the 10 u view): <tag>-line.png, a page screenshot (the HUD is DOM).
//   DRV_PORT=<own> node tools/bench/oldwound-shots.mjs <game port> <tag> [out dir, default ~/sc/.abyssa-wt/shots/oldwound]
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 9419].includes(P)) { console.error('oldwound-shots: set DRV_PORT to a port of its own'); process.exit(2); }
const [, , PORT, TAG, OUTD0] = process.argv;
if (!/^\d+$/.test(PORT || '') || !/^[\w.-]+$/.test(TAG || '')) { console.error('usage: DRV_PORT=<own> node tools/bench/oldwound-shots.mjs <game port> <tag> [out dir]'); process.exit(2); }
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } = await import('node:fs');
const { tmpdir, homedir } = await import('node:os');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const OUTD = OUTD0 || join(homedir(), 'sc/.abyssa-wt/shots/oldwound');
mkdirSync(OUTD, { recursive: true });
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-oldwound-shots-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, lost } = await import('./clockplug.mjs');
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
// burial-probe's page side, read out of its source (one framing for the probe and the stills)
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'burial-probe.mjs'), 'utf8');
const k0 = src.indexOf('const WOUND_INSTALL = `') + 'const WOUND_INSTALL = `'.length, WOUND_INSTALL = src.slice(k0, src.indexOf('})()`;', k0) + 4);
await start('about:blank');
const c = await connect();
await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('abyssa.chart.v1', JSON.stringify({ site: 0, pulled: [1, 0, 0, 0], sighted: [1, 0, 0, 0], tools: { harpoon: true } })); } catch (e) { }` });
await c.send('Page.navigate', { url: `http://localhost:${PORT}/?bench&playtest` });
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(1000);
await plug(c);
const home = async () => {
  await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.weather.set(1, 0), window.__bench.step(30), 1)`);
  await c.until(`(window.__bench.step(10), !!(window.lev && window.lev.sculpted))`, 30000, 100);
  const p = await c.ev(WOUND_INSTALL);
  if (!p || p.err || !p.wound || !p.dormant) throw new Error('not the remembered build: ' + JSON.stringify(p));
  return p;
};
console.log('build ' + JSON.stringify(await home()));
const SEAMPX = `(async () => { const core = await import('/src/core.js'), cam = core.camera; cam.updateMatrixWorld(); const v = window.lev.harpoon.seam.clone().project(cam); return v; })()`;
const save = (file, url) => writeFileSync(join(OUTD, file), Buffer.from(url.split(',')[1], 'base64'));
for (const [name, mode, d] of [['d14', 'sand', 14], ['d10', 'sand', 10], ['d6', 'sand', 6], ['anchor', 'anchor', 0]]) {
  const aim = await c.ev(`window.__bpWound.aim('${mode}', ${d}, 0.3)`);
  const r = await c.ev(`(async () => { const B = window.__bench, k = window.__plugClk && window.__plugClk.clock; B.step(90, null, { render: true });
    const e = k ? k.elapsedTime : 0; const cap = await B.capture({}); if (k) k.elapsedTime = e;
    const core = await import('/src/core.js'), cam = core.camera; cam.updateMatrixWorld(); const v = window.lev.harpoon.seam.clone().project(cam);
    const W = cap.w, H = cap.h, cx = Math.round((v.x + 1) / 2 * W), cy = Math.round((1 - v.y) / 2 * H), z = 3, hw = Math.round(W / z / 2), hh = Math.round(H / z / 2);
    const full = B.png(cap, 1);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const im = new Image(); im.src = full; await im.decode(); cv.getContext('2d').drawImage(im, 0, 0);
    const o = document.createElement('canvas'); o.width = W; o.height = H; const g = o.getContext('2d'); g.imageSmoothingEnabled = true;
    const sx = Math.max(0, Math.min(W - 2 * hw, cx - hw)), sy = Math.max(0, Math.min(H - 2 * hh, cy - hh));
    g.drawImage(cv, sx, sy, 2 * hw, 2 * hh, 0, 0, W, H);
    return { full, zoom: o.toDataURL('image/png'), seamPx: [cx, cy] }; })()`);
  save(`${TAG}-${name}.png`, r.full); save(`${TAG}-${name}-zoom.png`, r.zoom);
  console.log(`${name} ${JSON.stringify(aim)} seam at ${JSON.stringify(r.seamPx)}`);
}
// the zone line
await c.ev(`(() => { window.setState('title'); window.start(); window.__helm = true; return 1; })()`);
const live = await c.ev(`(() => { let hit = null; window.__bench.step(1200, () => { const m = window.__msg(); if (/OLD WOUND/.test(m.live || '')) { hit = m.live; return false; } }); return hit; })()`);
if (!live) throw new Error('the zone line never showed');
await c.ev(`(window.__helm = true, window.weather.set(1, 0), 1)`);
await c.ev(WOUND_INSTALL);   // (start() at zone 0 announces it, it does not rebuild her)
const aim = await c.ev(`(() => { const r = window.__bpWound.aim('sand', 10, 0.3); window.__bench.step(30, null, { render: true }); return Object.assign(r, { msg: window.__msg() }); })()`);
console.log('line ' + JSON.stringify(aim));
await c.png(join(OUTD, `${TAG}-line.png`));
const d = await drift(c);
console.log('clock ' + JSON.stringify(d) + (lost(d) ? ' LOST' : ''));
c.close();
