// heightAt's cost at home zone 0, home's relief rows ON vs removed (= the shipped path): ns per call over a fixed
// 200k-point set in the basin, the best of 5 alternating runs each. Exit 1 if on / off > 1.5 (spec §7).
import { setSite, siteAt } from '../../src/world/site.js';
const T = await import('./terrain.gen.mjs');
setSite(0);
const HOME = siteAt(0), keep = HOME.shape, n = 200000, X = new Float64Array(n), Z = new Float64Array(n);
let s = 0x2468ace; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 250; X[i] = Math.cos(a) * d; Z[i] = Math.sin(a) * d; }
let sink = 0;
const run = () => { const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) sink += T.terrainH(X[i], Z[i], 0); return Number(process.hrtime.bigint() - t) / n; };
const best = { on: Infinity, off: Infinity };
for (let k = 0; k < 5; k++) for (const m of ['off', 'on']) { HOME.shape = m === 'on' ? keep : null; T.syncSite(); best[m] = Math.min(best[m], run()); }
HOME.shape = keep; T.syncSite();
const ratio = best.on / best.off;
console.log(`heightAt home z0: rows off ${best.off.toFixed(1)} ns, on ${best.on.toFixed(1)} ns, ratio ${ratio.toFixed(2)} (sink ${sink > 0 ? '+' : '-'})`);
process.exit(ratio > 1.5 ? 1 : 0);
