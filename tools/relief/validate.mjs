// THE RELIEF VALIDATOR: the canonical terrain fingerprint (terrain.js terrainFingerprint: FNV-1a over the float32
// bytes of terrainH on the 32 x 32 grid x, z = -248..248 step 16, zone-major) on the SLICED code. It checks every
// site, home with its relief rows removed (which must be the shipped 3b526986), and the frozen wreck sites, against
// expect.json. Exit 1 on any mismatch.  --record rewrites expect.json (main, or Task 4's new home anchor only).
import { readFileSync, writeFileSync } from 'node:fs';
import { setSite, siteAt } from '../../src/world/site.js';
const T = await import('./terrain.gen.mjs'), P = await import('./pins.gen.mjs');
const EXP = new URL('./expect.json', import.meta.url);
function fp(zones) {
  let h = 0x811c9dc5; const f = new Float32Array(1), b = new Uint8Array(f.buffer);
  for (const zi of zones) for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
    f[0] = T.terrainH(-248 + i * 16, -248 + j * 16, zi);
    for (let k = 0; k < 4; k++) { h ^= b[k]; h = Math.imul(h, 16777619) >>> 0; }
  }
  return h.toString(16).padStart(8, '0');
}
const wr = () => P.wreckSites().map(s => [+s.x.toFixed(3), +s.z.toFixed(3)]);
const got = {};
for (const [s, key] of [[1, 'pallid'], [2, 'burned']]) { setSite(s); T.syncSite(); P.resetPins(); got[key] = fp([0, 1, 2]); got[key + 'Wrecks'] = wr(); }
setSite(0); T.syncSite(); P.resetPins();
got.home = fp([0, 1, 2]); got.z12 = fp([1, 2]); got.homeWrecks12 = wr().slice(1);
const H = siteAt(0), keep = { shape: H.shape, wrecks: H.wrecks };
H.shape = null; H.wrecks = null; T.syncSite(); P.resetPins();
got.homeNull = fp([0, 1, 2]);
H.shape = keep.shape; H.wrecks = keep.wrecks; T.syncSite(); P.resetPins();
if (process.argv.includes('--record')) { writeFileSync(EXP, JSON.stringify(got, null, 1) + '\n'); console.log('recorded', got); process.exit(0); }
const exp = JSON.parse(readFileSync(EXP, 'utf8'));
let bad = 0;
for (const k of Object.keys(exp)) { const ok = JSON.stringify(got[k]) === JSON.stringify(exp[k]); if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + k, JSON.stringify(got[k]), ok ? '' : 'expected ' + JSON.stringify(exp[k])); }
if (got.homeNull !== '3b526986') { bad++; console.log('FAIL homeNull is not the shipped 3b526986'); }
process.exit(bad ? 1 : 0);
