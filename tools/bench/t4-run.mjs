// scratch runner (Task 4): node tools/bench/t4-run.mjs <port> <script.js>  -- starts a fresh profile, waits for the loader, runs the file's
// async body via c.ev, prints JSON, dumps console errors. Env DRV_PORT. KEEP=1 leaves Chrome running.
const [, , port, file] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9485';
const { mkdtempSync, readFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = process.env.DRV_DIR || mkdtempSync(tmpdir() + '/abyssa-t4-');
const { start, stop, connect } = await import('./drv.mjs');
if (!process.env.ATTACH) await start(`http://localhost:${port}/${process.env.QS || '?bench&playtest'}`);
const c = await connect();
await c.send('Runtime.enable'); await c.send('Log.enable');
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__fissure`, 240000, 1000);
const body = readFileSync(file, 'utf8');
globalThis.c = c;
try {
  const mod = await import('data:text/javascript,' + encodeURIComponent(`export default async function(c){ ${body} }`));
  const r = await mod.default(c);
  console.log(JSON.stringify(r, null, 1));
} catch (e) { console.log('ERR', e.message); }
const errs = c.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
console.log('console errors:', errs.map(e => JSON.stringify(e.params).slice(0, 300)));
c.close();
if (!process.env.KEEP) stop();
