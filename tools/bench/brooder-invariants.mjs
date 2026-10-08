// BROODERFIX invariants on a fresh load: lights, fingerprints, safe/shader failures, console.
import { connect, sleep } from './drv.mjs';
const c = await connect();
await c.send('Runtime.enable'); await c.send('Log.enable');
await c.send('Page.reload', { ignoreCache: true });
await sleep(1500);
await c.until(`!document.getElementById('load') && typeof window.start === 'function'`, 240000, 500);
await sleep(1500);
await c.ev(`(window.__helm = true, 1)`);
await c.click(640, 400);
await c.until(`window.__power && __power.state().state === 'play'`, 30000);
if (process.env.ALT6) { await sleep(2000); await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1); }
await sleep(32000);
const lights = await c.ev(`(() => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); return n; })()`);
const safe = await c.ev(`window.__safeFailed ? __safeFailed() : 'n/a'`);
const shader = await c.ev(`window.__shaderFailed ? __shaderFailed() : 'n/a'`);
const ridge = await c.ev(`__ridge.fp()`);
const fps = await c.ev(`[__lev.fp(0), __lev.fp(1), __lev.fp(2)]`);
const sfp = await c.ev(`(async () => { const M = await import('/src/entities/leviathan.js'); const out = []; for (let i = 0; i < 3; i++) out.push(M.sleeperFingerprint(i)); __lev.swap(); return out; })()`);
const shader2 = await c.ev(`window.__shaderFailed ? __shaderFailed() : 'n/a'`);
const cons = (await c.console()).filter(l => /error|EXC/i.test(l));
console.log(JSON.stringify({ lights, safe, shader, shader2, ridge, levFp: fps, sleeperFp: sfp, consoleErrors: cons }, null, 1));
c.close();
