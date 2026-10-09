// A kept session for ad-hoc probes (ritefair): `start <port> [site]` boots ?playtest&bench in
// its own headless Chrome (DRV_PORT, default 9471) and jumps to Velkath (Alt+6, after Alt+-
// for pallid / twice for burned); `ev "<expr>"` evaluates; `file <path.js>` runs an async
// function body from a file; `stop`.
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9471';
if (!process.env.DRV_DIR) process.env.DRV_DIR = tmpdir() + '/abyssa-sess-' + process.env.DRV_PORT;
const { start, stop, connect, sleep } = await import('./drv.mjs');
const [, , cmd, a1, a2] = process.argv;
if (cmd === 'stop') { stop(); process.exit(0); }
if (cmd === 'start') {
  await start(`http://localhost:${a1}/?playtest&bench`);
  const c = await connect();
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await sleep(3000);
  const alt = async code => {
    await c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: 'x', altKey: true, bubbles: true })), window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}', key: 'x', altKey: true, bubbles: true })), 1)`);
    await c.ev(`(window.__helm = true, window.__bench.step(90), 1)`);
  };
  const n = a2 === 'pallid' ? 1 : a2 === 'burned' ? 2 : 0;
  for (let i = 0; i < n; i++) { await alt('Minus'); await sleep(4000); await c.ev(`(window.__bench.step(120), 1)`); }
  await alt('Digit6');
  console.log('ready'); process.exit(0);
}
const c = await connect();
const expr = cmd === 'file' ? `(async () => { ${readFileSync(a1, 'utf8')} })()` : a1;
console.log(JSON.stringify(await c.ev(expr)));
process.exit(0);
