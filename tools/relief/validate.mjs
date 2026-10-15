// THE RELIEF VALIDATOR: the canonical terrain fingerprint (terrain.js terrainFingerprint: FNV-1a over the float32
// bytes of terrainH on the 32 x 32 grid x, z = -248..248 step 16, zone-major) on the SLICED code (re-sliced on every
// run). It checks every site (the hidden shelf too), home with its relief rows removed, and the frozen wreck sites
// against expect.json, and the shipped anchors (HARD) against their literals whatever expect.json says. Exit 1 on any
// mismatch.  --record: the first time (no expect.json) it writes every key; after that it rewrites ONLY `home` (Task 4's
// new anchor) and, if any other key moved, writes nothing and exits 1. A moved HARD anchor is never recorded.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setSite, siteAt } from '../../src/world/site.js';
await import('./slice.mjs');          // re-slice first: the gen files are always the code on disk
const T = await import('./terrain.gen.mjs'), P = await import('./pins.gen.mjs');
const EXP = new URL('./expect.json', import.meta.url);
// the shipped anchors (CLAUDE.md; spec §1, "must not move"): hard failures, independent of expect.json
const HARD = { homeNull: '3b526986', z12: 'd49d451d', pallid: 'b1c58f8d', burned: 'd2b6fb68' };
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
for (const [s, key] of [[1, 'pallid'], [2, 'burned'], [3, 'shelf']]) { setSite(s); T.syncSite(); P.resetPins(); got[key] = fp([0, 1, 2]); got[key + 'Wrecks'] = wr(); }
setSite(0); T.syncSite(); P.resetPins();
got.home = fp([0, 1, 2]); got.z12 = fp([1, 2]); got.homeWrecks12 = wr().slice(1);
const H = siteAt(0), keep = { shape: H.shape, wrecks: H.wrecks };
H.shape = null; H.wrecks = null; T.syncSite(); P.resetPins();
got.homeNull = fp([0, 1, 2]);
H.shape = keep.shape; H.wrecks = keep.wrecks; T.syncSite(); P.resetPins();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hardBad = Object.entries(HARD).filter(([k, v]) => got[k] !== v);
const hardFail = () => { for (const [k, v] of hardBad) console.log(`FAIL ${k} ${JSON.stringify(got[k])} is not the shipped ${v}`); };
if (process.argv.includes('--record')) {
  if (hardBad.length) { hardFail(); console.log('NOT RECORDED: a shipped anchor moved'); process.exit(1); }
  if (!existsSync(EXP)) { writeFileSync(EXP, JSON.stringify(got, null, 1) + '\n'); console.log('recorded (first: every key)', got); process.exit(0); }
  const exp = JSON.parse(readFileSync(EXP, 'utf8'));
  const moved = [...new Set([...Object.keys(exp), ...Object.keys(got)])].filter(k => k !== 'home' && !same(got[k], exp[k]));
  if (moved.length) { for (const k of moved) console.log('MOVED ' + k, JSON.stringify(got[k]), 'expected ' + JSON.stringify(exp[k])); console.log('NOT RECORDED: only home may be re-recorded'); process.exit(1); }
  const was = exp.home; exp.home = got.home;
  writeFileSync(EXP, JSON.stringify(exp, null, 1) + '\n'); console.log('recorded home', was === got.home ? got.home + ' (unchanged)' : was + ' -> ' + got.home); process.exit(0);
}
const exp = JSON.parse(readFileSync(EXP, 'utf8'));
let bad = hardBad.length;
for (const k of new Set([...Object.keys(exp), ...Object.keys(got)])) { const ok = same(got[k], exp[k]); if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + k, JSON.stringify(got[k]), ok ? '' : 'expected ' + JSON.stringify(exp[k])); }
hardFail();
process.exit(bad ? 1 : 0);
