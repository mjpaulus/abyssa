// Seafloor-relief render driver (Task 13; grown from the audit's read-only prototype, reviews/seabed-relief-tool/drive.mjs).
// Our own headless Chrome on DRV_PORT, the game served by serve.py on GAME_PORT. Branch: GAME_PORT 8870 / DRV_PORT 9520; main: 8871 / 9521.
//   DRV_PORT=9520 GAME_PORT=8870 node tools/relief/render/drive.mjs boot     -> fresh profile, load ?bench&playtest, wait for the boot, start play
//   DRV_PORT=9520 node tools/relief/render/drive.mjs run <page.js> [json|@file]
//                                       -> evaluate page.js as an async function body with ARGS = json; result.files {name: base64|dataURL}
//                                          are written to OUT (env) or ./out
//   DRV_PORT=9520 node tools/relief/render/drive.mjs stop                    -> stop THIS port's Chrome (anchored pkill, drv.mjs)
// DRV_PORT has no default here: it must be set, and drv.mjs refuses 8777 / 8790 / 9419 when it is imported. Never touches another port's Chrome.
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.env.DRV_PORT) { console.error('drive.mjs: set DRV_PORT (the Chrome debug port: 9520 branch, 9521 main)'); process.exit(2); }
process.env.DRV_DIR = process.env.DRV_DIR || join(tmpdir(), 'abyssa-relief-render-' + process.env.DRV_PORT);
const { start, stop, connect } = await import('../../bench/drv.mjs');
const [, , cmd, a1, a2] = process.argv;
if (cmd === 'boot') {
  const gp = process.env.GAME_PORT;
  if (!gp) { console.error('drive.mjs boot: set GAME_PORT (serve.py: 8870 branch, 8871 main)'); process.exit(2); }
  try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { }
  mkdirSync(process.env.DRV_DIR, { recursive: true });
  console.log('chrome pid', await start(`http://localhost:${gp}/?bench&playtest`));
  const c = await connect();
  const ms = await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__fissure`, 300000, 1000);
  const r = await c.ev(`(async () => {
    if (window.start && window.gameState === 'title') window.start();
    window.setState('play'); window.__helm = true;
    return { boot: ${ms}, state: window.gameState, site: window.__chart.site(), fp: window.__ridge.fp(), fp12: window.__ridge.fp([1, 2]) };
  })()`);
  console.log(JSON.stringify(r));
  c.close();
} else if (cmd === 'run') {
  const src = readFileSync(a1, 'utf8');
  const args = a2 ? (a2.startsWith('@') ? readFileSync(a2.slice(1), 'utf8') : a2) : '{}';
  const c = await connect();
  const r = await c.ev(`(async () => { const ARGS = ${args}; ${src}\n })()`);
  const out = process.env.OUT || join(HERE, 'out');
  if (r && r.files) {
    mkdirSync(out, { recursive: true });
    for (const [name, data] of Object.entries(r.files)) {
      const b64 = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
      writeFileSync(join(out, name), Buffer.from(b64, 'base64'));
    }
    r.files = Object.keys(r.files);
  }
  console.log(JSON.stringify(r));
  c.close();
} else if (cmd === 'stop') {
  stop(); console.log('stopped');
} else { console.error('usage: drive.mjs boot|run <page.js> [json|@file]|stop'); process.exit(2); }
process.exit(0);
