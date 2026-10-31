#!/usr/bin/env node
// SKY LOOK (roadmap/sky-probe-readback.md): the settled DECK still of each build and the diff between them. Per url, in order: a fresh
// load, the deck, the clock plugged and pinned at 100 s (the same sky, sea and weather on every load: clockplug.mjs), then
// __bench.capture({ settle: 90 }) (90 rendered frames, so the post chain has converged; CLAUDE.md "capture() / diff()") with
// frameStart(60) between the settle frames (a paced frame's start, where the branch maps the sky's readback back). The raw canvas comes
// back to node and every pair is diffed as __bench.diff does (mean |delta| per channel max, 99.9th percentile, share > 2 and > 8
// codes). Same build twice = the A/A spread; across builds must sit inside it.
//   node tools/bench/sky-look.mjs <outdir> <label=url> <label=url> ...     (needs &playtest; Env BENCH_DBG_PORT, as cdp.mjs)
import { writeFileSync, mkdirSync } from 'node:fs';
import { plug } from './clockplug.mjs';
const DBG = +(process.env.BENCH_DBG_PORT || 9333);
const [, , OUT, ...ARGS] = process.argv;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function json(path) { const r = await fetch(`http://127.0.0.1:${DBG}${path}`); return r.json(); }
const tgt = (await json('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true, timeout: 600000 });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails));
  return r.result.result.value;
}
async function until(expr, ms = 240000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return; } catch (e) { } await sleep(300); } throw new Error('timeout ' + expr); }
const c = { ev };
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
const caps = [];
for (const a of ARGS) {
  const [label, url] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
  await send('Page.navigate', { url });
  await sleep(1500);
  await until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__exposure && !!window.__playtest`);
  await ev(`(() => { try { localStorage.clear(); } catch (e) {} __bench.size(1512, 982); window.setState('play'); window.__helm = true; window.survival.hose = 5000; __power.set(60, 60); __drs.pin(1.5); return 1; })()`);
  await sleep(1500);
  await plug(c);
  const r = await ev(`(async () => {
    const P = await import(new URL('src/postfx.js', document.baseURI).href);
    window.__plugClk.clock.elapsedTime = 100; window.__plugClk.e0 = 100;
    // settle: 90 rendered frames with the paced frame start in front of each, then the frozen capture
    __bench.step(90, () => P.frameStart(60), { render: true });
    const cap = await __bench.capture({ settle: 90 });
    const b = new Uint8Array(cap.px.buffer, cap.px.byteOffset, cap.px.length);
    let s = ''; const CH = 1 << 15; for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return { w: cap.w, h: cap.h, b64: btoa(s), sunVis: __vsky.state().sunVis, camSunVis: __vsky.state().camSunVis, early: __vsky.early || null, exp: __exposure.state().exposure, png: __bench.png(cap, 0.5) };
  })()`);
  const px = Buffer.from(r.b64, 'base64');
  caps.push({ label, w: r.w, h: r.h, px });
  writeFileSync(`${OUT}/${label}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(JSON.stringify({ label, w: r.w, h: r.h, sunVis: r.sunVis, camSunVis: r.camSunVis, early: r.early, exposure: r.exp }));
}
function diff(a, b) {
  const n = a.w * a.h, hist = new Uint32Array(256); let sum = 0, gt2 = 0, gt8 = 0;
  for (let i = 0; i < n; i++) { const k = i * 4; const d = Math.max(Math.abs(a.px[k] - b.px[k]), Math.abs(a.px[k + 1] - b.px[k + 1]), Math.abs(a.px[k + 2] - b.px[k + 2])); sum += d; hist[d]++; if (d > 2) gt2++; if (d > 8) gt8++; }
  let acc = 0, p999 = 0; for (let d = 0; d < 256; d++) { acc += hist[d]; if (acc >= n * 0.999) { p999 = d; break; } }
  return { mean: +(sum / n).toFixed(4), p999, gt2: +(gt2 / n).toFixed(5), gt8: +(gt8 / n).toFixed(5) };
}
for (let i = 0; i < caps.length; i++) for (let j = i + 1; j < caps.length; j++) console.log('diff', caps[i].label, caps[j].label, JSON.stringify(diff(caps[i], caps[j])));
await send('Page.navigate', { url: 'about:blank' });
ws.close();
