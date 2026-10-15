# Sea-Floor Relief, Home Zone 0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape home zone 0's flat seabed into uplands and a bearing-varying, terraced hollow with Velkath's lair at its deepest point. The crack's lips, its throat floor, zones 1–2 and the two remote anchorages must not move.

**Architecture:** Two new zone-0 terms in `src/world/terrain.js` `heightAt`, both driven by home's site row (`src/world/site.js`):
- **The uplands** (`shape.uplands`): an additive massif, ridge and swell term built on noise values `heightAt` already computes, masked to exactly 0 off the crack, her two stations, the raft column and the raft-to-station band.
- **The hollow** (`shape.hollow`): a sunk, bearing-varying profile with treads, ramps, a flat at her station, a crack-centred dish and soft outcrops.
- **The crack takes only the hollow's uniform part.** The relative apron and a wall-weighted carve compensation cancel that part, so the lips and the throat floor stay exactly as today.

Home's `wrecks` row fences the skiff's search ring to start 100 u from `riftPos(0)` and gives it a bearing window, so Velkath always takes her designed raft-side station.

**Tooling.** An offline node toolkit (`tools/relief/`) slices `terrain.js`, `wrecks.js` and `lair.js` by marker lines on every run, so it tests the real code. It gates every shape requirement in seconds. The game's own probes are then re-derived on the new ground.

**Tech Stack:**
- Three.js r184 browser game, with no build step (CDN importmap).
- Node 23 for the offline tools.
- Headless Chrome over CDP (`tools/bench/drv.mjs`, `cdp.mjs`) for the in-game probes.

**Spec:** `docs/superpowers/specs/2026-10-13-seafloor-relief-design.md` (amended in f63542d after offline trials). Read it first; it is the binding authority.

**Measured basis:**
- The relief audit: `docs/reports/2026-10-13-seabed-relief-audit.md`.
- The trial prototype `~/sc/.abyssa-wt/reviews/seabed-relief-tool/levers9.mjs`, variant Q0. It drives the same design through hooks and passed every gate. Its values are this plan's starting row values.

## Global Constraints

- **Scope.** Home (site 0) zone 0 only. These must not move:
  - `__ridge.fp([1,2])` d49d451d;
  - Pallid Bank b1c58f8d and the Burned Ground d2b6fb68;
  - the wreck sites of zones 1 and 2 at every site, and of zone 0 at Pallid and Burned;
  - `sleeperFingerprint` zones 1 and 2: ac04921e and ce3eaf9d.
- **Identity when off.** With home's `shape` and `wrecks` rows absent, the code must reproduce the shipped field bit for bit: home `__ridge.fp()` 3b526986. The shipped `ZP[0]` literals in `terrain.js` do not change.
- **Frozen geometry only.** The relief is keyed to `FISSURE[0]` (= `riftPos(0)`, its axis and half-length), the origin, and the station literals (89.7, 39.1) and (43.5, 113.4). Never key it to `bedAt()` or `velkathLair` (circular).
- **Hard limits (spec §7):**
  - lowest walkable ground outside the throat ≥ −285;
  - descent-trigger margin ≥ 24.5 u (trigger plane −309.5);
  - jam top ≥ 25 u above the trigger plane;
  - hose ≥ 10 u spare under the 375 give (HOSE_START 380);
  - crack lips' height difference ≤ 1.2 u;
  - berm ≤ 5.4 u;
  - ending ascent zone-0 dip to zone-1 clear ≥ 150 u;
  - `heightAt` at home zone 0 ≤ 1.5× today's ns per call.
- **Shape gates (spec):**
  - S1: open-floor sd ≥ 12, 50 u relief median ≥ 17, 100 u ≥ 30.
  - S2: her body ≤ the 5th percentile, the open minimum within 40 u of her bed, her bed at (89.7, 39.1) ± 0.5.
  - S3 (target): the raft column sinks ≤ 12 u and falls ≥ 20 u to her bed.
  - S4: radii vary ≥ 20% peak-to-peak; each tread line varies ≥ 15 u.
  - S5: ≤ 1.5% of the open floor steeper than 52°; ≥ 97% reachable with steps ≤ 2 u; the route has no hop.
  - S6: added mesh error ≤ 0.3 u (aim ≤ 0.25).
  - S7: relief under her body ≤ 3 u, under her bed footprint ≤ 6.5 u, across her 45 u arena ≤ 11.5 u.
  - G3: the centre-line floor below −309.5 is within ±1 u of today's.
- **Invariants (fresh load):**
  - 14 lights; never add a light.
  - `__lev.fp(0/1/2)` 15ce888c / c938fe6e / 652d0412 measured; it may move only with a named cause and a recorded new anchor.
  - `__safeFailed()` and `__shaderFailed()` both [].
  - Console clean except the favicon 404.
- **House code rules:**
  - zero per-frame allocation (module temps);
  - no backticks inside GLSL template comments;
  - never a reversed smoothstep;
  - a distinct `customProgramCacheKey` per material variant;
  - comments in the file's own voice: the why, with the measurement that justifies it.
- **Probe bounds** are re-derived from a requirement, each with a case that fails (a RED mutant). Loosening a bound until it passes is not re-deriving it.
- **Ports.** Never start, stop or load anything on 8777 (Michael plays main there) or 8790. Each task's dispatch assigns its own ports.
- **Commits.** Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Five ways the spec's change can bite a player that no spec gate exercises. Each has its test in the named task.

1. **Boots on steep ground.** About 15% of the new open floor is steeper than the gait rig's pitch clamp. `diver.js` `groundPitch` clamps at ±0.62 rad (35.5°), `groundRoll` at ±0.45 rad, and the slope rig engages only within 0.6 u of the sole. On risers and ridge flanks the heel or edge sinks by design.
   - Expected on ground ≤ 35°: planted soles within 0.15 u of `terrainH`.
   - Steeper ground is measured and reported to Michael.
   - Test: Task 11, `relief-walk.mjs` `boots`.
2. **A voyage away and back.** Home → Pallid → home must land on the new home field again (the rows reapply), with Pallid unchanged. Her bed must be recomputed on return: `lair.js` caches the bed on the wreck array's identity.
   - Test: Task 5, step 5.
3. **A save made before this change.** With `pulled[0]` true (her old wound) on the new ground, the rite must start at the old wound at her new station, and the anchor must be reachable.
   - Test: Task 5, step 6.
4. **The lens on the risers.** Walking down a 35–45° riser with the riser behind him, the follow lens must not go into the ground (`shutFloorY` clearance) or pop.
   - Test: Task 11, `relief-walk.mjs` `lens`.
5. **Things placed at an absolute height.** Rifts' glowing motes spawn at y ≥ −242 anywhere in the basin and can land inside a 30 u ridge. Fauna's moray and crab candidates need rocks above −266, so the hollow gets none.
   - Test: Task 12, steps 3–4.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tools/relief/slice.mjs` (new) | Writes `terrain.gen.mjs` (the noise..clamp-table slice of `terrain.js` plus the mesh axis) and `pins.gen.mjs` (`findSite`..`wreckSites`, `R_OF_SIZE`..`velkathLair`, `rimR`), sliced by marker lines | 1 |
| `tools/relief/stats.mjs` (copied) | Masks and statistics: `analyze`, `classify`, `N`, `X0`, `idx` | 1 |
| `tools/relief/mesh.mjs` (new) | `meshH(T, x, z, zi)`: the drawn coarse mesh's interpolation (terrain.js `coarseLerp`'s split) | 1 |
| `tools/relief/validate.mjs` (new) | Offline fingerprints for every site, home with its rows removed, and the frozen wreck sites, against `expect.json` | 1 |
| `tools/relief/gates.mjs` (new) | S1–S7, the §7 limits, G3, the skiff checks | 1 |
| `tools/relief/cost.mjs` (new) | `heightAt` ns per call, rows on vs off | 1 |
| `tools/relief/expect.json` (new) | Recorded anchors: fingerprints and frozen wreck sites | 1, 4 |
| `tools/relief/render/` (copied) | The browser hillshade/sections renderer (`drive.mjs`, `sample.page.js`, `render.page.js`, `upload.page.js`) | 13 |
| `.gitignore` | Ignores `tools/relief/*.gen.mjs` | 1 |
| `tools/bench/velfix-gate.mjs`, `tools/bench/fullplay-gate.mjs` | The crack-route flake and the route bound | 9 |
| `src/world/wrecks.js` | `findSite` bearing window; `wreckSites` reads it | 2 |
| `src/world/terrain.js` | Raw-noise locals in `heightAt`, `UPL`/`HOL` state, `syncRelief`, `keepOff`, `uplandsAt`, `hollowAt`, the hollow in `heightAt`, the relative apron, the carve compensation | 3, 4 |
| `src/world/site.js` | Home's `shape.uplands` / `shape.hollow` / `wrecks` rows; the header's "bit-identical" paragraph | 2, 3, 4 |
| `src/game.js` | `window.__relief` (rows, `set` → `reseedWorld`), used for tuning and RED mutants | 4 |
| `tools/bench/fissure-probe.mjs` | Bounds re-derived for the new ground, with RED mutants | 6, 7 |
| `tools/bench/relief-walk.mjs` (new) | Real-key walks: boots on risers, the lens on risers, the hose to its binding point | 11 |
| `tools/bench/seating-probe.mjs` (new) | Nothing hovers or sinks: props, nodes, debris, relics, moult, skiff kit (from the primfix survey `x3.mjs`) | 12 |
| `src/world/fauna.js`, `src/world/rifts.js` | Moray/crab candidates reach the hollow; motes never spawn inside the ground | 12 |
| `src/lib/bench.js` | View `z0b` retargeted at her new bed; `z0r` re-found | 10 |
| `CLAUDE.md`, `roadmap/seafloor-relief.md`, `docs/reports/2026-10-13-seafloor-relief.md` | The record | 14 |

Task order and dependencies:
- **Tasks 1–2** are independent of the terrain change.
- **Tasks 3–4** build it on the offline gates.
- **Tasks 5–12** verify it in the game.
  - Task 9 (the `velfix-gate` flake) runs just before Task 10, the only task that uses its gate.
  - Task 9 is capped, so an open debugging problem cannot hold up the rest.
- **Task 13** produces Michael's look.
- **Task 14** writes the record.

---

### Task 1: The relief toolkit in the repo (offline, RED on main)

**Files:**
- Create: `tools/relief/slice.mjs`, `tools/relief/mesh.mjs`, `tools/relief/validate.mjs`, `tools/relief/gates.mjs`, `tools/relief/cost.mjs`, `tools/relief/expect.json`, and `tools/relief/README.md` (usage, five lines).
- Copy: `~/sc/.abyssa-wt/reviews/seabed-relief-tool/stats.mjs` → `tools/relief/stats.mjs`. Change only its two absolute imports (`/Users/michaelpaulus/sc/abyssa/src/...`) to the relative `../../src/...`.
- Modify: `.gitignore` (add `tools/relief/*.gen.mjs`).

**Interfaces:**
- Produces:
  - `node tools/relief/slice.mjs` writes `tools/relief/terrain.gen.mjs` and `tools/relief/pins.gen.mjs`.
  - `terrain.gen.mjs` exports `terrainH, terrainUnderH, heightAt, syncSite, buildClampTable, clampR, ZP, ZP0, RIM_KR, RIM_KH, gn, fbm2, rmf, c01, SEG, HALF, axisMap`. It also exports `HOL, UPL, hollowAt, uplandsAt, keepOff, _hv` when those identifiers exist in the slice; they do from Task 3/4 on.
  - `pins.gen.mjs` exports `wreckSites, resetPins, findSite, SITE_SPEC, velkathLair`.
  - `mesh.mjs` exports `meshH(T, x, z, zi)` and `AX`.
  - `node tools/relief/validate.mjs` exits 1 on a fingerprint or wreck mismatch with `expect.json`.
  - `node tools/relief/gates.mjs [--json out.json]` prints one line per gate and exits 1 if a hard gate fails.
  - `node tools/relief/cost.mjs` prints ns per call with the rows on and off, and exits 1 if on/off > 1.5.

- [ ] **Step 1: Write `slice.mjs`**

```js
// THE RELIEF TOOLKIT (spec docs/superpowers/specs/2026-10-13-seafloor-relief-design.md): an offline node copy of the
// zone heightfield and of the two terrain-driven pins (the wreck sites and Velkath's bed), sliced VERBATIM out of the
// game's own sources by MARKER LINES on every run (never line numbers: they move), so the gates test the real code.
// The generated files are git-ignored.
//   node tools/relief/slice.mjs   ->   tools/relief/terrain.gen.mjs, tools/relief/pins.gen.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), REPO = join(HERE, '..', '..');
const lines = f => readFileSync(join(REPO, f), 'utf8').split('\n');
const find = (arr, pred, from, what) => { const i = arr.findIndex((l, k) => k >= from && pred(l)); if (i < 0) throw new Error('slice marker missing: ' + what); return i; };
const starts = s => l => l.startsWith(s);
// terrain.js: from the rule line above "// Noise." to the closing brace of buildClampTable, plus the mesh axis
const TR = lines('src/world/terrain.js');
const t0 = find(TR, starts('// Noise.'), 0, '// Noise.') - 1;
const tC = find(TR, starts('function buildClampTable'), t0, 'function buildClampTable');
const t1 = find(TR, l => l === '}', tC, 'the end of buildClampTable');
const aS = find(TR, starts('const SEG = '), t1, 'const SEG'), aM = find(TR, starts('const axisMap'), aS, 'const axisMap');
let body = TR.slice(t0, t1 + 1).join('\n') + '\n' + TR[aS] + '\n' + TR[aM] + '\n';
const has = id => new RegExp('\\b(?:const|let|function)\\s+' + id + '\\b').test(body);
const opt = ['HOL', 'UPL', 'hollowAt', 'uplandsAt', 'keepOff', '_hv'].filter(has);
const thead = `// GENERATED by tools/relief/slice.mjs from src/world/terrain.js — do not edit.
import { WORLD_R, zoneBottom } from '../../src/config.js';
import { siteParams, currentSiteIndex, stream } from '../../src/world/site.js';
import { FISSURE, fissureDist, slabProbe, SLABS, fissureWorld, fissureLocal, jamFloorAt, jamSagAt, fissureShut, _widths, _slabReach, APRON } from '../../src/world/fissureShape.js';
const THREE = { Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } } };
`;
const ttail = `
export { heightAt, syncSite, buildClampTable, ZP, ZP0, RIM_KR, RIM_KH, gn, fbm2, rmf, c01, SEG, HALF, axisMap${opt.length ? ', ' + opt.join(', ') : ''} };
`;
writeFileSync(join(HERE, 'terrain.gen.mjs'), thead + body + ttail);
// the pins: wrecks.js findSite .. wreckSites, lair.js R_OF_SIZE .. velkathLair, brooderGeo.js rimR
const W = lines('src/world/wrecks.js'), Lr = lines('src/entities/sleeper/lair.js'), G = lines('src/entities/sleeper/brooderGeo.js');
const w0 = find(W, starts('function findSite'), 0, 'function findSite'), w1 = find(W, starts('// ------------------------------------------------------------------ state'), w0, 'wrecks state divider');
const l0 = find(Lr, starts('export const R_OF_SIZE'), 0, 'R_OF_SIZE'), l1 = find(Lr, starts('// Her bed at the current site'), l0, 'her bed divider');
const g0 = find(G, starts('export function rimR'), 0, 'rimR'), g1 = find(G, l => l === '}', g0, 'the end of rimR');
const phead = `// GENERATED by tools/relief/slice.mjs from wrecks.js / lair.js / brooderGeo.js — do not edit.
import { WORLD_R, riftPos, LEVIATHAN_CFG } from '../../src/config.js';
import { siteParams } from '../../src/world/site.js';
import { FISSURE, fissureDist, fissureWorld, _halfWAt, APRON, clearOfCrack } from '../../src/world/fissureShape.js';
import { terrainH } from './terrain.gen.mjs';
const TAU = Math.PI * 2;
class V { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } clone() { return new V(this.x, this.y, this.z); } negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; } addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; } }
const V3 = (x, y, z) => new V(x, y, z);
`;
const pbody = G.slice(g0, g1 + 1).join('\n').replace('export function rimR', 'function rimR') + '\n' + W.slice(w0, w1).join('\n') + '\n' + Lr.slice(l0, l1).join('\n');
writeFileSync(join(HERE, 'pins.gen.mjs'), phead + pbody + `
export function resetPins() { SITES = null; }
export { findSite, SITE_SPEC };
`);
console.log('sliced terrain.js (' + (t1 + 1 - t0) + ' lines' + (opt.length ? ', relief: ' + opt.join(' ') : '') + ') and the pins');
```

- [ ] **Step 2: Run the slicer and confirm the slice loads**

Run: `node tools/relief/slice.mjs && node -e "import('./tools/relief/terrain.gen.mjs').then(T => console.log(T.terrainH(0, 0, 0)))"`

Expected:
- `sliced terrain.js (…)`;
- a number near −240.3, the raft column today.

If a name the slice uses is not imported, Node throws `ReferenceError`. Add that name to the matching header import, then re-run.

- [ ] **Step 3: Write `mesh.mjs`**

```js
// The drawn coarse terrain mesh, as terrain.js builds it: SEG x SEG cells on the graded axis axisMap, each cell split
// (a, b, d) / (b, c, d) exactly as terrain.js coarseLerp interpolates it. S6 compares this with terrainH.
export function makeMesh(T) {
  const AX = Float64Array.from({ length: T.SEG + 1 }, (_, i) => T.axisMap((i / T.SEG) * 2 - 1));
  const ax = v => { let lo = 0, hi = T.SEG; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (AX[m] <= v) lo = m; else hi = m; } return lo; };
  function meshH(x, z, zi) {
    const k = ax(x), j = ax(z), fx = (x - AX[k]) / (AX[k + 1] - AX[k]), fz = (z - AX[j]) / (AX[j + 1] - AX[j]);
    const ha = T.terrainH(AX[k], AX[j], zi), hb = T.terrainH(AX[k], AX[j + 1], zi);
    const hc = T.terrainH(AX[k + 1], AX[j + 1], zi), hd = T.terrainH(AX[k + 1], AX[j], zi);
    return fx + fz <= 1 ? ha * (1 - fx - fz) + hb * fz + hd * fx : hb * (1 - fx) + hc * (fx + fz - 1) + hd * (1 - fz);
  }
  return { AX, meshH };
}
```

Before using `meshH`, confirm the vertex layout against `terrain.js` `fillTerrain`: vertex `k + (SEG+1) j` must sit at `(AX[k], AX[j])`. If the fill flips z, mirror `j` here and note it in the file's header.

- [ ] **Step 4: Write `validate.mjs` and record `expect.json` on main**

```js
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
```

Run on main's code (this branch before any game change): `node tools/relief/slice.mjs && node tools/relief/validate.mjs --record`.

Then check that `tools/relief/expect.json` holds:
- `home` 3b526986, `z12` d49d451d, `pallid` b1c58f8d, `burned` d2b6fb68 and `homeNull` 3b526986;
- `pallidWrecks`, `burnedWrecks` and `homeWrecks12`: the shipped sites, three per site for the remote sites and two for home's zones 1 and 2.

If any of those five fingerprints differs, the slice is wrong. Stop and fix `slice.mjs`; never record a wrong anchor.

Run: `node tools/relief/validate.mjs`. Expected: every line PASS, exit 0.

- [ ] **Step 5: Write `gates.mjs`**

```js
// THE RELIEF GATES — spec docs/superpowers/specs/2026-10-13-seafloor-relief-design.md: the §7 hard limits, the shape
// acceptance S1-S7 and G3, measured on the SLICED REAL code at home zone 0 (run slice.mjs first), against the same
// code with home's relief rows removed (= the shipped world; validate.mjs proves it bit for bit). Exit 1 if a hard
// gate fails. S3 is a target: reported, never fails the run.
//   node tools/relief/slice.mjs && node tools/relief/gates.mjs [--json out.json]
import { writeFileSync } from 'node:fs';
import { setSite, siteAt } from '../../src/world/site.js';
import { riftPos } from '../../src/config.js';
import { FISSURE, resetJam, jamTopY, fissureDist, fissureWorld } from '../../src/world/fissureShape.js';
import { analyze, classify, N, X0, idx } from './stats.mjs';
import { makeMesh } from './mesh.mjs';
const T = await import('./terrain.gen.mjs'), P = await import('./pins.gen.mjs');
const { meshH } = makeMesh(T);
const PUMP = [5.382, 4.232, 2.895];              // the live pump head the leash anchors to (audit §3; stats.analyze takes [x, y, z])
const TRIG = -309.5, R = 15.4, STATION = { x: 89.7, z: 39.1 }, TODAY_RAFT = -240.3;
const F0 = FISSURE[0], C = { x: F0.cx, z: F0.cz };
setSite(0);
const HOME = siteAt(0), ROWS = { shape: HOME.shape, wrecks: HOME.wrecks };
function rows(on) { HOME.shape = on ? ROWS.shape : null; HOME.wrecks = on ? ROWS.wrecks : null; T.syncSite(); T.buildClampTable(); P.resetPins(); resetJam(); }
const grid = () => { const H = new Float64Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = T.terrainH(X0 + i, X0 + j, 0); return H; };
const centre = () => { const o = [], w = { x: 0, z: 0 }; for (let u = -0.9 * F0.halfLen; u <= 0.9 * F0.halfLen; u += 0.5) { fissureWorld(u, 0, 0, w); o.push([w.x, w.z, T.terrainH(w.x, w.z, 0)]); } return o; };
const raftCol = () => { let s = 0, n = 0; for (let z = -15; z <= 15; z++) for (let x = -15; x <= 15; x++) if (x * x + z * z <= 225) { s += T.terrainH(x, z, 0); n++; } return s / n; };
// --- the shipped side (rows off): G3's centre line and S6's per-point mesh error
rows(false);
const centre0 = centre();
const S6PTS = [];
for (let z = C.z - 200; z <= C.z + 200; z += 0.5) for (let x = C.x - 200; x <= C.x + 200; x += 0.5) {
  if (Math.hypot(x, z) > 250 || fissureDist(x, z, 0) < 17) continue;
  S6PTS.push(x, z, Math.abs(meshH(x, z, 0) - T.terrainH(x, z, 0)));
}
// --- the relief (rows on)
rows(true);
const hasHollow = !!(T.HOL && T.hollowAt);
const ws = P.wreckSites(), lair = P.velkathLair(0, R, null), bed = { x: lair.lip.x, z: lair.lip.z, r: 1.55 * R };
const H = grid();
const res = analyze({ T, H, zi: 0, clampTbl: T.clampR[0], bed, R, pump: PUMP });
const out = { skiff: [+ws[0].x.toFixed(1), +ws[0].z.toFixed(1)], bed: [+bed.x.toFixed(1), +bed.z.toFixed(1)] };
const g = [];   // [name, pass, value, hard]
const gate = (name, pass, value, hard = true) => g.push([name, !!pass, value, hard]);
// S1
gate('S1 relief', res.open.sd >= 12 && res.relief50.p50 >= 17 && res.relief100.p50 >= 30, { sd: res.open.sd, r50: res.relief50.p50, r100: res.relief100.p50 });
// S2
gate('S2 her lair is the deepest part', res.lair.pctOfOpen <= 0.05 && res.low.minOpen.dBed <= 40 && Math.hypot(bed.x - STATION.x, bed.z - STATION.z) <= 0.5,
  { pct: res.lair.pctOfOpen, minOpenDBed: res.low.minOpen.dBed, bed: out.bed });
// S3 (target)
const rc = raftCol();
gate('S3 raft-side fall (TARGET)', TODAY_RAFT - rc <= 12 && rc - res.lair.underR.mean >= 20, { sink: +(TODAY_RAFT - rc).toFixed(1), fall: +(rc - res.lair.underR.mean).toFixed(1) }, false);
// S4: the outline and the tread lines vary with bearing (the hollow's own profile, not the noise on it)
let s4 = null;
if (hasHollow) {
  const o = T._hv, rF = [], rO = [], N_ = T.HOL.N, tread = Array.from({ length: N_ }, () => []);
  for (let b = 0; b < 360; b++) {
    const a = b * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    T.hollowAt(C.x + ca * 100, C.z + sa * 100, o); rF.push(o.rF); rO.push(o.rO);
    for (let k = 1; k <= N_; k++) { const lv = (k - 0.5) / N_; let hit = NaN; for (let d = 2; d < 260; d += 0.5) { T.hollowAt(C.x + ca * d, C.z + sa * d, o); if (o.q <= lv) { hit = d; break; } } tread[k - 1].push(hit); }
  }
  const ptp = a => { const f = a.filter(Number.isFinite), mn = Math.min(...f), mx = Math.max(...f), m = f.reduce((p, q) => p + q, 0) / f.length; return { pct: +((mx - mn) / m * 100).toFixed(1), range: +(mx - mn).toFixed(1) }; };
  s4 = { rF: ptp(rF), rO: ptp(rO), treads: tread.map(ptp) };
}
gate('S4 not a lathe', s4 && s4.rF.pct >= 20 && s4.rO.pct >= 20 && s4.treads.every(t => t.range >= 15), s4 || 'no hollow');
// S5: walkable; reachability over the walkable grid from the raft column (a step: |dh| <= tan 52 x run, or a hop <= 2 u)
const { C: CL } = classify(T, 0, T.clampR[0]);
const walk = k => CL[k] === 2 || CL[k] === 3 || CL[k] === 4, TAN = Math.tan(52 * Math.PI / 180);
function bfs(hop) {
  const seen = new Uint8Array(N * N), q = new Int32Array(N * N); let h = 0, t = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = X0 + i, z = X0 + j, k = j * N + i; if (x * x + z * z <= 100 && walk(k)) { seen[k] = 1; q[t++] = k; } }
  while (h < t) { const k = q[h++], i = k % N, j = (k / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const kk = jj * N + ii; if (seen[kk] || !walk(kk)) continue;
      const run = di && dj ? Math.SQRT2 : 1, dh = Math.abs(H[kk] - H[k]); if (dh <= TAN * run || (hop && dh <= 2)) { seen[kk] = 1; q[t++] = kk; } } }
  return seen;
}
const sHop = bfs(true), sWalk = bfs(false), at = (x, z) => idx(Math.round(x - X0), Math.round(z - X0));
let on = 0, oy = 0; for (let k = 0; k < N * N; k++) if (CL[k] === 3) { on++; if (sHop[k]) oy++; }
const lipW = { x: 0, z: 0 }; fissureWorld(0, F0.halfW + 1.5, 0, lipW);
const route = { bed: !!sWalk[at(bed.x, bed.z)], skiff: !!sWalk[at(ws[0].x, ws[0].z)], lip: !!sWalk[at(lipW.x, lipW.z)] };
gate('S5 mostly walkable', res.slope.over.sal_ny062 <= 0.015 && oy / on >= 0.97 && route.bed && route.skiff && route.lip,
  { over52: res.slope.over.sal_ny062, over33: res.slope.over.kelp_ny084, reach: +(oy / on).toFixed(4), route });
// S6: the mesh error the change ADDS (today's floor already reaches 1.9 u near the NE rim)
let e6 = 0, e6at = null, e6n = 0; const e6s = [];
for (let i = 0; i < S6PTS.length; i += 3) { const x = S6PTS[i], z = S6PTS[i + 1]; const e = Math.abs(meshH(x, z, 0) - T.terrainH(x, z, 0)) - S6PTS[i + 2]; e6s.push(e); e6n++; if (e > e6) { e6 = e; e6at = [x, z]; } }
e6s.sort((a, b) => a - b);
gate('S6 drawn = stood on (added error)', e6 <= 0.3, { max: +e6.toFixed(3), p99: +e6s[Math.floor(e6s.length * 0.99)].toFixed(3), at: e6at, n: e6n });
// S7
const arena = res.lair.arena45.max - res.lair.arena45.min;
gate('S7 her fight ground', res.lair.underR.relief <= 3 && res.lair.underBED.relief <= 6.5 && arena <= 11.5, { body: res.lair.underR.relief, bed: res.lair.underBED.relief, arena: +arena.toFixed(1) });
// §7 hard limits
const jam = jamTopY(0, T.terrainH), r0 = riftPos(0), r1 = riftPos(1);
let z1max = -Infinity; for (let i = 0; i <= 56; i++) { const t = i / 56; z1max = Math.max(z1max, T.terrainH(r1.x + (r0.x - r1.x) * t, r1.z + (r0.z - r1.z) * t, 1)); }
const tf0 = T.terrainH(r0.x, r0.z, 0);
let cmin = Infinity; for (let i = 0; i <= 56; i++) { const t = i / 56, x = r1.x + (r0.x - r1.x) * t, z = r1.z + (r0.z - r1.z) * t; if (Math.hypot(x - r0.x, z - r0.z) < 16 * 2.8) continue; cmin = Math.min(cmin, T.terrainH(x, z, 0)); }
const endGap = Math.min(tf0, cmin) - 14 - (z1max + 18);   // ending.js: yD (CLEAR 18, DIP 14) over zone 1's corridor crest
gate('L walkable floor >= -285', res.trigger.minWalk >= -285, res.trigger.minWalk);
gate('L trigger margin >= 24.5', res.trigger.margin >= 24.5, res.trigger.margin);
gate('L jam top >= 25 over the trigger', jam - TRIG >= 25, +(jam - TRIG).toFixed(1));
gate('L hose >= 10 u spare', 375 - res.hose.maxDist >= 10, { spare: +(375 - res.hose.maxDist).toFixed(1), at: res.hose.at });
gate('L lips <= 1.2', res.crack.lipDiffMax <= 1.2, res.crack.lipDiffMax);
gate('L berm <= 5.4', res.crack.berm <= 5.4, res.crack.berm);
gate('L ending dip >= 150', endGap >= 150, +endGap.toFixed(1));
// G3: along the centre line, wherever today's floor is below the trigger, the new floor is within 1 u of today's
const c1 = centre(); let g3 = 0, g3n = 0;
for (let i = 0; i < c1.length; i++) if (centre0[i][2] < TRIG) { g3n++; g3 = Math.max(g3, Math.abs(c1[i][2] - centre0[i][2])); }
gate('G3 the throat keeps its floor', g3n > 0 && g3 <= 1, { maxDev: +g3.toFixed(3), points: g3n, floorAtRift: +tf0.toFixed(1) });
// the skiff (spec §5)
const sk = { raft: Math.hypot(ws[0].x, ws[0].z), bed: Math.hypot(ws[0].x - bed.x, ws[0].z - bed.z) };
gate('skiff within 130 u of the raft, outside her arena', sk.raft <= 130 && sk.bed >= 57, { at: out.skiff, raft: +sk.raft.toFixed(1), bed: +sk.bed.toFixed(1) });
const th0 = Math.atan2(-F0.cz, -F0.cx), sa = Math.atan2(ws[0].z - F0.cz, ws[0].x - F0.cx), sdist = Math.hypot(ws[0].x - F0.cx, ws[0].z - F0.cz);
let rel = (sa - th0) * 180 / Math.PI; rel = ((rel % 360) + 540) % 360 - 180;
const win = (ROWS.wrecks && ROWS.wrecks.band && ROWS.wrecks.band[0]) || null;
gate('skiff in its window', win && win.length >= 4 && rel >= win[2] - 0.5 && rel <= win[3] + 0.5 && sdist >= win[0] - 0.5 && sdist <= win[1] + 0.5, { rel: +rel.toFixed(1), d: +sdist.toFixed(1), win });
let hard = 0;
for (const [n, p, v, h] of g) { if (!p && h) hard++; console.log((p ? 'PASS ' : h ? 'FAIL ' : 'MISS ') + n.padEnd(46), JSON.stringify(v)); }
// INFO: the gait rig's pitch clamp is 35.5 deg (diver.js groundPitch); steeper planted soles sink by design. Reported so
// tuning can push it down (today ~2.4% of the open floor is past 33 deg; trial Q0 ~15%) — Michael judges (Review Focus 1)
{ let s355 = 0, sn = 0; const cmax = Math.cos(35.5 * Math.PI / 180);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const k = j * N + i; if (CL[k] !== 3) continue; sn++;
    const gx = (H[k + 1] - H[k - 1]) / 2, gz = (H[k + N] - H[k - N]) / 2; if (1 / Math.sqrt(1 + gx * gx + gz * gz) < cmax) s355++; }
  console.log('INFO open floor steeper than the gait clamp (35.5 deg):', +(s355 / sn * 100).toFixed(1) + '%'); }
const ji = process.argv.indexOf('--json'); if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify({ out, gates: g }, null, 1));
process.exit(hard ? 1 : 0);
```

`analyze`'s `hose` stat is the 3D straight distance from `PUMP` to the farthest walkable sample, as the audit measured it. `res.trigger.minWalk` / `margin`, `res.crack.*` and `res.lair.*` come from the copied `stats.mjs`; read it once to confirm the names.

- [ ] **Step 6: Run the gates on main (RED)**

Run: `node tools/relief/slice.mjs && node tools/relief/gates.mjs; echo exit=$?`

Expected `exit=1`, with these lines:
- `FAIL S1 relief` (sd 5.55);
- `FAIL S2` (pct about 0.73; her bed at (43.5, 113.4));
- `FAIL S4 … "no hollow"`;
- `PASS skiff within 130 u…` (on main the skiff at (114.5, 4.2) is 114.6 u from the raft and 130 u from her NW bed);
- `FAIL skiff in its window` (no window on main);
- the §7 limits and G3 all PASS, at today's values: walkable −257.8, margin 51.7, jam 63.9, hose 25.0, lips 1.17, berm 5.4, ending 198.6, G3 0.

Paste the table into the task report.

- [ ] **Step 7: Write `cost.mjs`**

```js
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
```

Run: `node tools/relief/cost.mjs`. On main the rows are absent, so expect a ratio of about 1.00 and exit 0. Record "rows off" ns as today's baseline.

- [ ] **Step 8: Commit**

```bash
git add tools/relief/slice.mjs tools/relief/mesh.mjs tools/relief/validate.mjs tools/relief/gates.mjs tools/relief/cost.mjs tools/relief/stats.mjs tools/relief/expect.json tools/relief/README.md .gitignore
git commit -m "relief tools: an offline slice of the real terrain/pins code, the validator (fingerprints + frozen wrecks), the gates (S1-S7, §7, G3) and the cost bench — RED on main

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The skiff's bearing window (`wrecks.js`), tested on today's ground

**Files:**
- Modify: `src/world/wrecks.js` (`findSite`, `wreckSites`).
- Modify: `src/world/site.js` (home's `wrecks` row).
- Test: `tools/relief/validate.mjs` (the frozen wrecks) and a check in `tools/relief/gates.mjs` (the skiff).

**Interfaces:**
- Produces: a site row's `wrecks.band[zi]` may be `[minR, maxR, from, to]`, where the window runs from `from` to `to` in degrees, measured counter-clockwise in atan2(z, x) from the bearing riftPos(zi) → raft. A two-element entry, or a null one, is the shipped behaviour.

- [ ] **Step 1: The failing check.** Add home's row in `site.js`: `wrecks: { band: [[100, 140, 30, 75]] }`.
  - Run `node tools/relief/slice.mjs && node tools/relief/validate.mjs`. Expected: all PASS. The band moves only home's zone-0 skiff, which `validate` does not freeze, and the terrain is unchanged.
  - Run `node tools/relief/gates.mjs`. Expected: `FAIL skiff in its window` (Task 1 wrote this gate), because `findSite` still ignores a band's elements 3–4.
- [ ] **Step 2: Implement.** In `findSite`:

```js
function findSite(zi, minR, maxR, footprint, clear, win) {
  const rp = riftPos(zi);
  // (seafloor relief, spec §5) a site's band may carry a bearing WINDOW [from, to] (deg from the rift -> raft bearing,
  // counter-clockwise in atan2(z, x)): the 48 samples spread across it instead of the whole circle. Home's puts the
  // skiff on the raft-side terraces; without it the flattest-ground search wandered 60-170 u between variants.
  const a0 = win ? Math.atan2(-rp.z, -rp.x) + win[0] * Math.PI / 180 : 0, span = win ? (win[1] - win[0]) * Math.PI / 180 : 0;
  let best = null;
  for (let ai = 0; ai < 48; ai++) {
    const a = win ? a0 + span * (ai / 47) : ai / 48 * TAU;
```

  The rest is unchanged. In `wreckSites`:

```js
    const site = findSite(zi, b ? b[0] : s.minR, b ? b[1] : s.maxR, s.foot, s.clear, b && b.length >= 4 ? [b[2], b[3]] : null);
```

  Update `site.js`'s header comment: "Every one is null at home…" becomes "…at home except `shape` and `wrecks` (seafloor relief, 2026-10-13)". Also update home's row comment.
- [ ] **Step 3: Verify.**
  - `gates.mjs`: `PASS skiff in its window`.
  - `validate.mjs`: `pallidWrecks`, `burnedWrecks` and `homeWrecks12` all PASS (frozen); `home` still 3b526986 (terrain unchanged).
  - Paste the skiff's new spot and its distances: raft, her bed (NW today), and `riftPos(0)`.
- [ ] **Step 4: Commit**

```bash
git add src/world/wrecks.js src/world/site.js tools/relief/gates.mjs
git commit -m "wrecks: a site band's optional bearing window; home's skiff searched 100-140 u off riftPos(0) at 30-75 deg (spec §5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `heightAt` keeps its raw noise; THE UPLANDS (an additive, masked term)

**Files:**
- Modify: `src/world/terrain.js`. In `heightAt`, keep the raw noise values in locals. Add `UPL`, `syncRelief`, `keepOff` and `uplandsAt` inside the sliced region, after `syncSite`.
- Modify: `src/world/site.js` (home's `shape.uplands` row).
- Test: `tools/relief/validate.mjs`, `tools/relief/gates.mjs` and `tools/relief/cost.mjs`.

**Interfaces:**
- Consumes: Task 1's toolkit.
- Produces (module scope, `terrain.js`):
  - `let UPL` (null, or the prepared row);
  - `function keepOff(x, z, K)`: 0..1, exactly 0 inside any capsule's inner radius; `K` is a flat array of `[ax, az, bx, bz, r0, r1]` × n;
  - `function uplandsAt(x, z, nReg, nBase, nM, nS2, nR3)`: the term, in u.
- Home row: `shape.uplands = { rbias, ramp, r3amp, s2amp, camp, keepOff: { crack: [r0, r1], stations: [[x, z], ...], station: [r0, r1], raft: [r0, r1], band: [r0, r1] } }`.

- [ ] **Step 1: The refactor, bit-identical first.** In `heightAt`, name the noise values and leave every float operation in the same order:

```js
  const nBase = fbm2(px * P.cf, pz * P.cf, 3);
  let h = nBase * P.camp;
  const nReg = fbm2(px * 0.0028 + 9.1, pz * 0.0028 - 4.4, 2);
  let rk = c01(nReg * 2.2 + 0.5 + P.rbias);
  rk = rk * rk * (3 - 2 * rk);
  const nM = rmf(px * P.rf, pz * P.rf, P.roc);
  h += nM * P.ramp * rk;
  const nS2 = rmf(px * P.s2f + 13.7, pz * P.s2f + 4.2, 3);
  h += nS2 * P.s2amp * (0.30 + 0.70 * rk);
```

  Further down:

```js
  const nR3 = rmf(px * P.r3f + 71.3, pz * P.r3f - 29.6, 2);
  h += nR3 * P.r3amp * rk;
```

  Run `node tools/relief/slice.mjs && node tools/relief/validate.mjs`. Expected: all PASS. Pallid, Burned and home are unchanged bit for bit; this proves the refactor.
- [ ] **Step 2: The failing gate.** Add home's row in `site.js`:

```js
    // THE RELIEF (spec docs/superpowers/specs/2026-10-13-seafloor-relief-design.md §2): zone 0's uplands, an additive
    // term on today's noise (measured starting values, trial Q0), masked to exactly 0 off the crack, her two stations,
    // the raft column and the raft -> station band
    shape: {
      uplands: { rbias: -0.10, ramp: 24, r3amp: 1.5, s2amp: 2.0, camp: 12,
        keepOff: { crack: [35, 65], stations: [[89.7, 39.1], [43.5, 113.4]], station: [30, 55], raft: [25, 50], band: [20, 45] } }
    },
```

  Add two gates to `gates.mjs`, before its final table:

```js
// (Task 3) THE UPLANDS' MASK IS EXACT: with the uplands alone (no hollow), inside every keep-off capsule's inner radius
// the field is today's, bit for bit; and they do raise the relief
{
  const ko = ROWS.shape && ROWS.shape.uplands && ROWS.shape.uplands.keepOff, pts = [];
  if (ko) {
    const caps = [];   // [ax, az, bx, bz, r0]
    if (ko.crack) caps.push([F0.cx - F0.dx * F0.halfLen, F0.cz - F0.dz * F0.halfLen, F0.cx + F0.dx * F0.halfLen, F0.cz + F0.dz * F0.halfLen, ko.crack[0]]);
    if (ko.stations && ko.station) for (const st of ko.stations) caps.push([st[0], st[1], st[0], st[1], ko.station[0]]);
    if (ko.raft) caps.push([0, 0, 0, 0, ko.raft[0]]);
    if (ko.band && ko.stations) caps.push([0, 0, ko.stations[0][0], ko.stations[0][1], ko.band[0]]);
    for (const c of caps) {
      const r = c[4], vx = c[2] - c[0], vz = c[3] - c[1], l2 = vx * vx + vz * vz;
      for (let z = Math.min(c[1], c[3]) - r; z <= Math.max(c[1], c[3]) + r; z += 0.5) for (let x = Math.min(c[0], c[2]) - r; x <= Math.max(c[0], c[2]) + r; x += 0.5) {
        let t = l2 > 0 ? ((x - c[0]) * vx + (z - c[1]) * vz) / l2 : 0; t = Math.min(1, Math.max(0, t));
        if (Math.hypot(x - c[0] - vx * t, z - c[1] - vz * t) < r - 0.01) pts.push(x, z);
      }
    }
  }
  HOME.shape = ko ? { uplands: ROWS.shape.uplands } : null; HOME.wrecks = null; T.syncSite();
  const upl = []; for (let i = 0; i < pts.length; i += 2) upl.push(T.terrainH(pts[i], pts[i + 1], 0));
  let sdU = 0; { const v = []; for (let j = 0; j < N; j += 2) for (let i = 0; i < N; i += 2) v.push(T.terrainH(X0 + i, X0 + j, 0)); const m = v.reduce((a, b) => a + b, 0) / v.length; sdU = Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length); }
  rows(false);
  let bad = 0; for (let i = 0; i < pts.length; i += 2) if (T.terrainH(pts[i], pts[i + 1], 0) !== upl[i / 2]) bad++;
  let sd0 = 0; { const v = []; for (let j = 0; j < N; j += 2) for (let i = 0; i < N; i += 2) v.push(T.terrainH(X0 + i, X0 + j, 0)); const m = v.reduce((a, b) => a + b, 0) / v.length; sd0 = Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length); }
  rows(true);
  gate('uplands exact in the keep-off', !!ko && pts.length > 0 && bad === 0, { points: pts.length / 2, differ: bad });
  gate('uplands raise the relief', !!ko && sdU > sd0 + 0.5, { sdUplandsOnly: +sdU.toFixed(2), sdToday: +sd0.toFixed(2) });
}
```

  These sds are over the whole ±300 u grid (rim included), so they are a relative check only; S1 is the spec's measure.

  Run `gates.mjs`. Expected: `PASS uplands exact…` (vacuously: no term yet) and `FAIL uplands raise the relief`. The second gate is the failing test this step needs.
- [ ] **Step 3: Implement.** In `terrain.js`, put the block below between `syncSite`'s closing brace and `const RAM_IN`.
  - It must sit above the module-level `syncSite();` call (after `layIsles`), which runs at import: `let UPL` must be declared before that call runs.
  - It must also stay inside `slice.mjs`'s region (`// Noise.` .. `buildClampTable`).

```js
// ---- THE RELIEF (spec docs/superpowers/specs/2026-10-13-seafloor-relief-design.md; Michael 2026-10-13: "the sea
// floor is all one level, like a big pit. Lets make that more dynamic but keep velkaths lair in the deepest part").
// Zone-0 terms a site's shape row may carry (home is the only one that does). Null rows = the shipped field bit for
// bit (tools/relief/validate.mjs: 3b526986). Keyed to FROZEN geometry only — FISSURE[0], the origin, the station
// literals — never to bedAt()/velkathLair, which are placed after the terrain (the loop would close).
// THE UPLANDS: today's massif / secondary-ridge / outcrop / continental noise, reused (heightAt computes it anyway),
// with a mask bias of its own, ADDED on top and masked to exactly 0 off the places that matter. Overriding the
// shipped knobs instead (the first draft) moved the crack's lips to 1.39 u and its throat floor 1.4 u (trial H7):
// camp and s2amp act everywhere.
let UPL = null;
function keepOff(x, z, K) {
  let m = 1;
  for (let i = 0; i < K.length; i += 6) {
    const ax = K[i], az = K[i + 1], vx = K[i + 2] - ax, vz = K[i + 3] - az, l2 = vx * vx + vz * vz;
    let t = l2 > 0 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - ax - vx * t, dz = z - az - vz * t, d = Math.sqrt(dx * dx + dz * dz);
    if (d <= K[i + 4]) return 0;
    if (d < K[i + 5]) { const s = (d - K[i + 4]) / (K[i + 5] - K[i + 4]); m *= s * s * (3 - 2 * s); }
  }
  return m;
}
function uplandsAt(x, z, nReg, nBase, nM, nS2, nR3) {
  const U = UPL, m = keepOff(x, z, U.K);
  if (m <= 0) return 0;
  let rk = c01(nReg * 2.2 + 0.5 + U.rbias); rk = rk * rk * (3 - 2 * rk);
  return m * (nBase * U.camp + nM * U.ramp * rk + nS2 * U.s2amp * (0.30 + 0.70 * rk) + nR3 * U.r3amp * rk);
}
function capsules(ko, F) {
  const K = [];
  const add = (ax, az, bx, bz, r) => K.push(ax, az, bx, bz, r[0], r[1]);
  if (ko.crack) add(F.cx - F.dx * F.halfLen, F.cz - F.dz * F.halfLen, F.cx + F.dx * F.halfLen, F.cz + F.dz * F.halfLen, ko.crack);
  if (ko.stations && ko.station) for (const s of ko.stations) add(s[0], s[1], s[0], s[1], ko.station);
  if (ko.raft) add(0, 0, 0, 0, ko.raft);
  if (ko.band && ko.stations) add(0, 0, ko.stations[0][0], ko.stations[0][1], ko.band);
  return Float64Array.from(K);
}
function syncRelief(sh) {
  const u = sh && sh.uplands;
  UPL = u ? { rbias: u.rbias, ramp: u.ramp, r3amp: u.r3amp, s2amp: u.s2amp, camp: u.camp, K: capsules(u.keepOff, FISSURE[0]), row: u } : null;
}
```

  At the end of `syncSite`, add `syncRelief(sh);`. In `heightAt`, right after `h += P.lift;`:

```js
  if (UPL && zi === 0) h += uplandsAt(x, z, nReg, nBase, nM, nS2, nR3);
```

- [ ] **Step 4: Verify.**
  - `validate.mjs`: `home` FAILs (expected: it changed), while `homeNull` 3b526986, `z12`, `pallid` and `burned` all PASS.
  - `gates.mjs`:
    - `uplands exact in the keep-off` PASS;
    - lips 1.17 ± 0.02 (the masked crack is untouched);
    - G3 0;
    - S5 `over52` ≤ 1.5%;
    - S1's sd above 5.55. S1 itself may still FAIL: the uplands alone gave about 10 in trial H7, so the hollow is needed.
  - `cost.mjs`: ratio ≤ 1.15. The term reuses the noise, so a higher ratio means the reuse failed.
- [ ] **Step 5: Commit** (do not record the new home anchor yet; Task 4 records it once)

```bash
git add src/world/terrain.js src/world/site.js tools/relief/gates.mjs
git commit -m "terrain: heightAt names its noise (bit-identical); THE UPLANDS — home's additive massif/ridge/swell term, masked to exactly 0 off the crack, her stations, the raft column and the band (spec §2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: THE HOLLOW (uniform at the crack, treads, ramps, her flat, the dish, outcrops), the relative apron, the carve

**Files:**
- Modify: `src/world/terrain.js` (`HOL`, `_hv`, `hollowAt`, `syncRelief`, `heightAt`).
- Modify: `src/world/site.js` (home's `shape.hollow`).
- Modify: `src/game.js` (`window.__relief`).
- Test: `tools/relief/gates.mjs`, `validate.mjs` and `cost.mjs`. Record `expect.json`'s new home anchor.

**Interfaces:**
- Consumes: Task 3's `keepOff`, `capsules`, `syncRelief` and `UPL`.
- Produces:
  - `let HOL`;
  - `const _hv = { uni, det, level, flatW, q, rF, rO }`;
  - `function hollowAt(x, z, o)`: fills `o`, returns `o`, allocates nothing;
  - `window.__relief = { rows(), set(patch), reset() }` in `game.js`. `set` deep-merges `patch` into the live site's `shape` rows and runs `reseedWorld(currentSiteIndex())`. `reset` restores the authored rows. Tasks 6–7 use it for RED mutants.
- Home row: `shape.hollow`, the values in Step 2.

- [ ] **Step 1: The failing gates.**
  - `gates.mjs` now FAILs S1 (no hollow), S2 (her bed is still NW: the band fence moved the skiff, but there is no hollow) and S4 (`no hollow`).
  - Confirm this run and paste it.
- [ ] **Step 2: Implement.** Add home's row: these are the trial's Q0 values.

```js
      hollow: { D: 28, f0: 80, fA: 6, o0: 185, oA: 35, wig: 0.15, fade: [250, 290], lvl: 0.7, level0: 17,
        N: 3, rw: 0.85, tw: 0.05, twf: 0.012, ramp: [0.55, 0.85], rampPh: 0.9,
        station: [89.7, 39.1], sR: [30, 46], sLvl: 0.92, sDrop: 4, dish: 3, rDish: 90,
        oc: { f: 0.035, thr: 0.25, amp: 10, soft: 0.1, keepOff: [25, 45] } }
```

  In `terrain.js`, after `uplandsAt`. It goes in the same block, above the module-level `syncSite();` call:

```js
// THE HOLLOW: home zone 0's floor falls toward her crack. Bearing-varying about riftPos(0) (a round bowl would be "the
// big pit" again, smaller): tight toward the raft so the raft column stays up on the flank (trial Q0: it sinks
// 11.4 u, and falls 24.9 u to her bed), wide away from it; the outline wanders on low harmonics, held still toward
// and away from the raft. Three treads, each riser taking 85% of its band (walkable slopes, not walls), smooth in
// three ramp sectors so no riser is a ring. The UNIFORM part (depth + the crack-centred dish) acts everywhere, the
// crack's apron included; the apron target and the throat's carve compensate exactly that part, so the crack just
// drops (lips 1.17 -> 1.18, the throat floor at today's -315.3). The DETAIL (levelling, her flat, the outcrops) fades
// out toward the lip. Her flat (30-46 u about her station, levelled 92%, 4 u lower than the bottom) makes her ground
// the deepest. It runs on under the NE wall (fade 250-290 u from the raft): ending it before the wall's onset put a
// steep rise behind her crack (5.4% of the floor too steep to walk, trial H0) — the wall stands ~30 u taller there.
let HOL = null;
const _hv = { uni: 0, det: 0, level: 0, flatW: 0, q: 0, rF: 0, rO: 0 };
const sst01 = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
function hollowAt(x, z, o) {
  const H = HOL;
  o.uni = 0; o.det = 0; o.level = 0; o.flatW = 0; o.q = 0;
  const rr = Math.sqrt(x * x + z * z);
  if (rr >= H.fade1) return o;
  const fade = 1 - sst01((rr - H.fade0) / (H.fade1 - H.fade0));
  const dx = x - H.cx, dz = z - H.cz, d = Math.sqrt(dx * dx + dz * dz), id = 1 / (d > 1e-3 ? d : 1e-3), ux = dx * id, uz = dz * id;
  const c = ux * H.rdx + uz * H.rdz, c2 = ux * ux - uz * uz, s2 = 2 * ux * uz, c3 = ux * c2 - uz * s2, s3 = ux * s2 + uz * c2;
  const w = 1 + H.wig * (0.6 * (0.8 * c2 + 0.6 * s2) + 0.4 * (0.6 * c3 - 0.8 * s3)) * (1 - c * c);
  const rF = (H.f0 - H.fA * c) * w, rO = (H.o0 - H.oA * c) * w;
  const t = c01((d - rF) / (rO - rF) + H.tw * gn(x * H.twf + 5.1, z * H.twf - 2.7));
  const q = 1 - t * t * t * (t * (t * 6 - 15) + 10);
  let qt = q;
  if (H.N > 0) { const sN = q * H.N, f = Math.min(Math.floor(sN), H.N - 1), r = sN - f, u = c01((r - (1 - H.rw)) / H.rw); qt = (f + u * u * (3 - 2 * u)) / H.N; }
  const cp = c3 * H.cPh - s3 * H.sPh;                         // cos(3 bearing + rampPh): the three ramp sectors
  const qq = q + (qt - q) * (1 - sst01((cp - H.ramp0) / (H.ramp1 - H.ramp0)));
  const sx = x - H.sx, sz = z - H.sz, flat = H.sLvl * (1 - sst01((Math.sqrt(sx * sx + sz * sz) - H.sR0) / (H.sR1 - H.sR0)));
  let oc = 0;
  if (H.ocAmp > 0 && q > 0.2) {
    const v = fbm2(x * H.ocF + 31.7, z * H.ocF - 12.9, 2) - H.ocThr;
    // soft threshold: v^2 / (v + soft) leaves the knoll's foot C1 (a hard max(0, v) kink is a crease the mesh can't draw)
    if (v > 0) oc = v * v / (v + H.ocSoft) * H.ocAmp * q * q * (1 - flat / H.sLvl) * keepOff(x, z, H.ocK);
  }
  o.uni = (-H.D * qq - H.dish * (1 - sst01(d / H.rDish))) * fade;
  o.det = oc * fade;
  o.level = (1 - (1 - H.lvl * q) * (1 - flat)) * fade;      // a soft union (a max() kink broke S6: trial Q0, 0.345 u)
  o.flatW = flat / H.sLvl * fade;
  o.q = q; o.rF = rF; o.rO = rO;
  return o;
}
```

  Extend `syncRelief`:

```js
  const h = sh && sh.hollow, F = FISSURE[0];
  if (h) {
    const l = Math.hypot(F.cx, F.cz);
    HOL = { D: h.D, f0: h.f0, fA: h.fA, o0: h.o0, oA: h.oA, wig: h.wig, fade0: h.fade[0], fade1: h.fade[1], lvl: h.lvl, level0: h.level0,
      N: h.N, rw: h.rw, tw: h.tw, twf: h.twf, ramp0: h.ramp[0], ramp1: h.ramp[1], cPh: Math.cos(h.rampPh), sPh: Math.sin(h.rampPh),
      sx: h.station[0], sz: h.station[1], sR0: h.sR[0], sR1: h.sR[1], sLvl: h.sLvl, sDrop: h.sDrop, dish: h.dish, rDish: h.rDish,
      ocF: h.oc.f, ocThr: h.oc.thr, ocAmp: h.oc.amp, ocSoft: h.oc.soft, ocK: capsules({ crack: h.oc.keepOff }, F),
      cx: F.cx, cz: F.cz, rdx: -F.cx / l, rdz: -F.cz / l, noComp: !!h.noComp, row: h };   // noComp: a RED mutant only (Tasks 6-7)
  } else HOL = null;
```

  In `heightAt`, right after the soft-floor knee line:

```js
  // THE HOLLOW (above): its uniform part `hu` is what the apron's target and the throat's carve compensate below
  let hu = 0;
  if (HOL && zi === 0) {
    hollowAt(x, z, _hv);
    hu = _hv.uni;
    const g = fd < 14 ? sst01((fd - 4) / 10) : 1;   // the detail fades out toward the lip (fd is 1e3 outside apronR2)
    h += (HOL.level0 - h) * _hv.level * g + hu + _hv.det - HOL.sDrop * _hv.flatW * g;
  }
```

  In the apron, change `h = h * (1 - 0.6 * a) + 18 * 0.6 * a;` to:

```js
    h = h * (1 - 0.6 * a) + (18 + hu) * 0.6 * a;      // relative to the hollow (shipped: hu = 0, the same 18)
```

  In the throat, after the carve statement (`h -= F.lipDrop * lip + wall * (60 + st * 2.5) + …;`), still inside its block:

```js
        // (the hollow) the carve is shortened by the hollow's uniform part from 60% of the wall's depth down, so the
        // throat floor keeps today's depth (G3) while the upper walls drop with the lip
        if (hu !== 0 && !HOL.noComp) h -= hu * sst01(wall / 0.6);
```

  In `game.js`, next to `window.__chart`:

```js
// (seafloor relief) live retune of a site's relief rows for tuning and RED mutants: set({hollow: {D: 60}}) deep-merges
// into the current site's shape rows and reseeds the world (fillTerrain -> ... the full ORDER-IS-CONTRACT chain)
const _reliefRows = new Map();
window.__relief = {
  rows: () => ({ ...currentSite().shape }),
  set(patch) {
    const s = currentSite(), i = currentSiteIndex();
    if (!_reliefRows.has(i)) _reliefRows.set(i, JSON.parse(JSON.stringify(s.shape || null)));
    const merge = (a, b) => { for (const k in b) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(a[k] || {}, b[k]) : b[k]; return a; };
    s.shape = merge(s.shape || {}, patch);
    reseedWorld(i);
    return window.__relief.rows();
  },
  reset() { const i = currentSiteIndex(); if (_reliefRows.has(i)) { currentSite().shape = _reliefRows.get(i); _reliefRows.delete(i); reseedWorld(i); } }
};
```

  Before writing this, confirm that `currentSite()` returns the live registry row (`site.js` `siteAt(current)`), not a copy. If it returns a copy, use `siteAt(currentSiteIndex())`.
- [ ] **Step 3: Gate and tune on the real code.** Run `node tools/relief/slice.mjs && node tools/relief/gates.mjs && node tools/relief/cost.mjs`.
  - **Expected:** every hard gate PASSes. The trial's hooks gave Q0:
    - S1 16.25 / 18.0 / 34.5;
    - S2 1.2%, 29.6 u, her bed at (89.7, 39.1);
    - S3 11.4 / 24.9;
    - S4 26.7% / 39.6%, treads 34–56 u;
    - S5 0.7%, 100%, route all true;
    - S6 0.296 (p99 0.127);
    - S7 1.6 / 2.2 / 9.0;
    - limits −280.1, 29.4, 33.2, 19.8, 1.18, 0.9, 198.6;
    - G3 0;
    - the skiff in its window, within 130 u of the raft.
  - **Why the port drifts:**
    - the outcrops now fade by distance to the crack's axis (`keepOff`) instead of a full `fissureDist`, which `heightAt` only knows inside `apronR2`;
    - the uplands reuse today's three-octave massif instead of the trial's four.
  - **Tuning.** Re-tune within home's row until every hard gate passes with S6 ≤ 0.25 u of headroom. The levers:
    - S6: `oc.f` / `oc.soft` / `oc.amp`, `rw`, `sR`;
    - S5: the uplands' `ramp` / `r3amp`, and `rw`;
    - S7: `sR`, `sLvl`, `f0`;
    - S3: `f0`, `fA`, `o0`, `oA`;
    - the skiff: the window.
  - Record every change and its gate deltas in the task report. Never change a gate's bar.
  - `cost.mjs`: ratio ≤ 1.5. If it is over, profile first: `hollowAt` early-outs beyond `fade1`; `gn`/`fbm2` run only where `q` > 0.2.
- [ ] **Step 4: Validate and record the new anchor**
  - Run `node tools/relief/validate.mjs`. Expected: `home` FAILs (new); everything else PASSes, `homeNull` 3b526986 included.
  - Then run `node tools/relief/validate.mjs --record`, inspect `expect.json`'s diff (only `home` may change), and run `validate.mjs` again: all PASS.
- [ ] **Step 5: Commit**

```bash
git add src/world/terrain.js src/world/site.js src/game.js tools/relief/expect.json tools/relief/gates.mjs
git commit -m "terrain: THE HOLLOW — home zone 0 falls toward her crack (bearing-varying, three treads, ramps, her flat, the dish, soft outcrops); the crack takes only its uniform part (relative apron, carve compensation: lips 1.18, throat floor -315.3); __relief for tuning. Gates all PASS (table in the report); home fp <new>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: In the game — fresh loads, invariants, the new anchors, a voyage, an old save, boot

**Files:**
- Create: `tools/bench/relief-load.mjs`. It is a CDP script modelled on `tools/bench/clawcam-probe.mjs`'s start/connect and the fresh-load check in `docs/reports/2026-10-13-clawcam.md`.

**Interfaces:** consumes Tasks 2–4. Produces the recorded anchors (home `__ridge.fp()`, `sleeperFingerprint(0)`) for Task 14.

- [ ] **Step 1: Write the probe.** It must:
  - load `?playtest` (plain) on your port in a fresh profile;
  - `__helm = true`, then `setState('play')`;
  - wait 32 s, then print:
    - the lights (`(await import('/src/core.js')).scene` traversal);
    - `__ridge.fp()` and `__ridge.fp([1,2])`;
    - `__lev.fp(0..2)`;
    - `sleeperFingerprint(0..2)`, as `brooder-invariants.mjs` does;
    - `__safeFailed()` and `__shaderFailed()`;
    - console errors from the CDP `Log`/`Runtime` events.
  - Exit 1 on:
    - lights ≠ 14;
    - `fp([1,2])` ≠ d49d451d;
    - `__lev.fp(1/2)` ≠ c938fe6e / 652d0412;
    - `sleeperFingerprint(1/2)` ≠ ac04921e / ce3eaf9d;
    - a non-empty failure list;
    - any console error other than the favicon 404.
- [ ] **Step 2: The game's field equals the replica.** In the page, sample `terrainH` on a 2 u grid over the hollow (x, z ∈ [−120, 280]). In node, sample the sliced replica at the same points.
  - Expected: max |d| ≤ 1e-9 on ≥ 99% of samples. Chrome's and Node's `Math.exp` can differ in the last bit; the audit saw that on < 1%.
  - Report the share and the max.
- [ ] **Step 3: Record the anchors.** Home `__ridge.fp()` must equal `expect.json`'s `home`.
  - `__lev.fp(0)`: if it moved from 15ce888c, find the cause. `serpent.js`'s `updateBlobs` reads `terrainH`, and its path clamps at `zoneBottom+55` = −205, which sits beside the uplands' crests. Write the cause and the new anchor in the report.
  - `sleeperFingerprint(0)`: a new value is expected, because her wards sit over new ground. Record it.
- [ ] **Step 4: Pallid and Burned.** Run `__chart.arrive(1)` then `__chart.fp()` (b1c58f8d), and `arrive(2)` (d2b6fb68).
- [ ] **Step 5 (Review Focus 2): Voyage back.**
  - After `arrive(1)` then `arrive(0)`: `__ridge.fp()` equals the new home anchor.
  - `__sl.lairPos` is within 0.5 u of (89.7, 39.1), and the skiff's `wrecks.list()` position equals the replica's.
  - Repeat the round trip three times; the result is identical each time.
- [ ] **Step 6 (Review Focus 3): An old save.**
  - Before loading, put a chart save in localStorage (`abyssa.chart.v1`, shaped as `game.js` writes it; read `saveChart`) with site 0, `pulled[0] = true` and `tools.harpoon` true.
  - Load and press Alt+6. The prompt reads `PRESS THE OLD WOUND`, and the anchor stands at her raft-side station: within 30 u of (89.7, 39.1), with `harpoon-probe`'s `routes` checks passing at this site.
- [ ] **Step 7: Boot.**
  - `tools/bench/hitch.mjs` (BENCH_DBG_PORT on your assigned port), `SCEN=jet,z1,z2,voyage`: no first-sight compile in any scenario that main does not also show.
  - `__boot.log()`: the boot completes; report the time against main.
- [ ] **Step 8: Commit** `tools/bench/relief-load.mjs`, with the run's output in the commit body.

---

### Task 6: `fissure-probe` on the new ground — the shut crack

**Files:** modify `tools/bench/fissure-probe.mjs`. For each mode below, change the bound named, and comment the requirement it now derives from.

**RED mutants** (Task 4's `__relief.set`), each run against the bound it must break:
- `deep`: `{ hollow: { D: 60 } }`. The lip drops to about −303, so the jam top lands near the trigger and the throat under it is about 10 u.
- `nocomp`: `{ hollow: { noComp: true } }`. The carve is not shortened, so the throat floor drops about 31 u, to about −346 (Task 4's `HOL.noComp`).
- `sink`: `{ hollow: { D: 60, noComp: true } }`. The throat floor drops about 60 u, to about −375, which pulls the ending's dip under 150.
- `tilt`: `{ hollow: { sDrop: -14 } }`. A 14 u mound under her station puts her on a bank.

Write each mutant's verdict into the report.

- [ ] **`shape`**
  - Today: `depthCentre ≥ 25`; at 39 u after the reshape it passes silently.
  - New bound:
    - `depthCentre ≥ 35`, since the spec's throat is the lip (~−276) down to −315.3;
    - the throat floor at `riftPos(0)` within ±1 of −315.3 (G3).
  - RED: `deep` (depthCentre about 12) and `nocomp` (the floor about 31 u below −315.3).
- [ ] **`jam-stand`**
  - `jamTopY − trig ≥ 55` was the fissure ledger's literal, not a requirement.
  - New bound: ≥ 25 at every site and zone. The requirement is the same on every plane: the jam stays far enough above the trigger plane that standing, hopping or venting on it never fires the descent. Spec §7 sets that margin at 25 u. Print every plane's measured margin beside the bar.
  - Keep `lowerLip ≤ 3`. Add `lips ≤ 1.2` at home z0 (spec §7).
  - RED: `deep` (the jam about 10 u over the trigger).
- [ ] **`jam-mesh`**
  - `fissure.js DROP_MIN = 20` places blocks only over ≥ 20 u of throat, so `dropMin ≥ 20` is a tautology. Replace it: `dropMin ≥ 20` must equal `DROP_MIN` read from the module, and print the count.
  - `blocks 60–160`: measure the new home z0 count. The throat under the jam goes from about 70 u to 37 u. If the count falls below 60, re-derive from block DENSITY (blocks per u² of jam area, measured at Pallid/Burned/home z1, unchanged ground). Bar it at that density's minimum − 10%. Never just lower the literal.
  - RED: `deep` (a jam over a throat of about 10 u must fail density).
- [ ] **`pour-hide`**: `hidden ≥ 100` scales with the block count. Re-derive it as `hidden ≥ 0.6 × blocks` (today: ≥ 100 of the measured count; check the ratio on main first and use main's ratio − 0.05).
- [ ] **`seep-depth`**: image-calibrated. Re-measure z0's blotch on the new ground. The bars stay; if z0 moves outside `[0.15]`, attach before/after frames for Michael and rule on it in the report.
- [ ] **`tips`, `walls`, `slabs`, `climb-out`, `open-ledge`, `floor-readers`, `opening`, `calm-open`, `open-persist`**: relative to the lips and jam. Run all and paste the verdicts. A failure is a real regression: find it, never re-bar it.
- [ ] **Commit**: `fissure-probe: the shut crack re-derived for the relief (shape, jam-stand, jam-mesh, pour-hide), RED mutants via __relief`.

---

### Task 7: `fissure-probe` on the new ground — the open throat, the lens, the ending, her crack

**Files:** modify `tools/bench/fissure-probe.mjs` and `tools/bench/walls-inside.page.js`. Same mutants as Task 6.

- [ ] **`rise`.** Its totals are frame counts over a rise that drops from about 87 u to 53 u, so they get easier silently.
  - Re-derive per unit of rise. Today: ΣhfIn 24 / Σhidden 123 over 40 rises × 87 u. The bars become `RISE_HF` 40 and `RISE_HID` 160 scaled by (new rise / 87). Print both.
  - RED: `__throatCam.knobs.guard = 0` must fail `RISE_HID`.
- [ ] **`throat-edges`.** The haul's fall above −309.5 shrinks from about 49 u to 16 u.
  - Add a coverage floor: the haul must spend ≥ 0.5 s in the shaft above the switch.
  - RED: start the haul at `wallLo − 25` (already below the switch), which must fail the floor.
- [ ] **`walls-inside`.** The look depth (25 under the lip) and the ray depths `[4, 10, 20, 35]` were sized for a ~73 u throat.
  - Make both fractions of the zone's lip-to-floor column: look 0.34, rays `[0.055, 0.14, 0.28, 0.48]`.
  - Add a ray-count floor: ≥ 90% of the rays planned for the column are cast. Today a depth-35 ray below the floor is skipped silently.
  - RED: rays at `[…, 1.2]` of the column (below the floor) must fail the count floor.
- [ ] **`fall-lens`.** `samples ≥ 150` per case is a coverage floor sized on the 73 u column.
  - Re-derive it as `samples ≥ 150 × column / 72.7` at the case's zone. The count gates (close / hfIn / salIn) scale the same way, rounded up.
  - RED: `nocomp` must still pass (a deeper column). Then a case with C released after 1 s must fail the samples floor.
- [ ] **`ending`.** Add the spec's ≥ 150 u zone-0 dip: read `ending.js`'s spline yD/yC live, or recompute the replica's formula in the page.
  - RED: `sink` must fail the dip. `deep` alone does not: the compensated throat floor stays the dip's lowest point.
- [ ] **`wave-minors` R2.** If the shorter shaft ends before the guard engages, start R2 at `lipMeanY − 2` of the new lip; the vacuity check stays.
- [ ] **`velkath-crack`.** The dark-ward bound ≤ 10.5 carries a stale comment ("reach 7 + hop"); reach has been 5 since velhard.
  - Measure main's dark-ward max over the probe's spots.
  - New bound: main's max + 0.5. The spec says her wards stay at today's ~6 u over her ground.
  - Keep `keep = APRON + STAND.keep × R`, with R read live (`__sl.R`), not the literal 15.4.
  - RED: `tilt`.
- [ ] **`clearance`.** The near flank's `normal.y ≥ 0.8` must pass on her flat. RED: `tilt`.
- [ ] **`below-dark`, `open-light`, `reascend`**: run and paste. They are relative; a failure is a regression.
- [ ] **Commit**: `fissure-probe: the open throat, lens, ending and her crack re-derived for the relief (per-column coverage, the ending dip, ward bound from main), RED mutants`.

---

### Task 8: Her rite on the new ground

**Files:** read-only except `tools/bench/riteplay.mjs`: add a `ward height over her ground` column to its ledger, `max(ward.y − terrainH(ward.x, ward.z))` while she is up.

- [ ] **Step 1: The ledger column.** Add it, then run main: 2 seeds × perfect and average. That gives the "today" ward heights (about 6 u).
- [ ] **Step 2: The relief.**
  - The same seeds, plus a third seed per mode.
  - Pass:
    - every average fight inside the shipped band, 45–165 s and 0–3 hits;
    - perfect within ±20% of main's;
    - the ward height column ≤ main's max + 0.5 u.
  - These scripted fights vary a lot (main alone ran 20.5 and 107.8 s on one seed). Report every run, never only a mean.
- [ ] **Step 3: The other checks.**
  - `harpoon-probe`: all modes PASS.
  - `brooder-invariants`: prints.
  - `fissure-probe velkath-crack clearance` (Task 7's bounds): PASS.
- [ ] **Step 4: The rite's start.** Press Alt+6 at home. The harpoon anchor is ≥ 6 u off the crack and on her sand side; the prompt reads; the pull wakes her.
- [ ] **Commit** the ledger column, with the run table in the body.

---

### Task 9: `velfix-gate`'s crack route — green on main, and it gates the route

**Background:** read `/Users/michaelpaulus/sc/.abyssa-wt/velfix/VELFIX-REPORT.md` (finding 1) and `docs/reports/2026-10-13-clawcam.md`.

What is known:
- The crack route is RED on main and was RED on clawfix.
- Run alone, main had 9 wash frames (max outside 0.13) and 2 lens-on-surface frames, on her body mesh as she walks home with him under her. Under load it had 14 wash frames and 0 lens frames.
- velfix found a load-induced "pressed" fight mode on pristine baa7f88. The mechanism is unidentified; a wall-clock dependence is suspected.

Three code facts:
- `fullplay-gate.mjs`'s fight uses its own inline `decide()`, which predates velhard's NO SAFE SPOT. It is not `ritepolicy.mjs`.
- The wash counter books fight frames: it has no calm condition.
- The crack route has no route bound. `way.zoneAt` is reported, never gated, so a crack run that never reaches zone 1 can be GREEN.

**Files:** modify `tools/bench/fullplay-gate.mjs` and `tools/bench/velfix-gate.mjs`; game code only if the root cause is a game bug.

- [ ] **Step 1: Reproduce.** Serve main (this branch's base) on your port. Run `velfix-gate.mjs` three times alone, then once with a second headless Chrome running the game on another port (load). Record per run:
  - each route's verdict;
  - wash frames, and max outside;
  - lens-on-surface frames;
  - the fight's length and drops.
**Cap.** This is an open debugging problem that velfix could not close.
- After three fix rounds without an identified root cause, stop and record a ledger ruling. The floor this task must still reach:
  - the route bound, with its `FP_NOVENT` RED case;
  - `ritepolicy` in place of the stale inline `decide()`;
  - the wash booked per phase;
  - all three routes GREEN on 3 of 3 consecutive runs ALONE on main.
- The load sensitivity is then documented with its evidence, and Task 10 runs the gate alone.

- [ ] **Step 2: Find the root cause** (superpowers:systematic-debugging; no fix without one).
  - Look for wall-clock reads in the sim: `grep -n "performance.now\|Date.now" src/**/*.js` on any value that feeds gameplay rather than perf or UI.
  - Compare a RED and a GREEN run's frame logs at the first divergence.
  - Write the cause in the report, with the evidence.
- [ ] **Step 3: Write the failing route bound first.** The crack route's verdict requires `way.zoneAt` (zone 1 reached) within its 90 s.
  - The RED case: run the crack route with `FP_NOVENT=1` (add it: the route walks to the throat but never vents). It must print `GATE RED` because zone 1 is not reached.
- [ ] **Step 4: Fix.** Fix the root cause. Also:
  - replace `fullplay-gate.mjs`'s inline `decide()` with `ritepolicy.mjs`'s `makePolicy` in the `average` mode, the way `fullplay.mjs` uses it;
  - book the wash gate per phase (fight / after the calm), and print both. The gate stays on both: velfix's "lit wards burn, they don't wash" holds during the fight too. Velhard's known 0.3 s light-up flash is ≤ 50%, which is under the per-frame red rule's 0.15 overall share only when it is short. If fight frames are red only at light-up, confirm that against `docs/playtests/2026-10-10-fissure-harpoon.md` and rule on it in the report.
- [ ] **Step 5: Prove it.**
  - Main plus this task's tool changes: all three routes GREEN on 3 of 3 consecutive runs alone and 1 of 1 under load.
  - The `FP_NOVENT` crack run is RED.
  - Paste the per-run table into the report.
- [ ] **Step 6: Commit**

```bash
git add tools/bench/fullplay-gate.mjs tools/bench/velfix-gate.mjs   # plus any game file the root cause needed
git commit -m "velfix-gate: the crack route gates reaching zone 1; the fight runs ritepolicy; <root cause, one line> — green on main 3/3 alone, 1/1 under load

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The post-calm gate, the full take, and the bench views

**Files:** modify `src/lib/bench.js` (`VIEWS.z0b`, `VIEWS.z0r` and their comment).

- [ ] **Step 1: `velfix-gate` on the new ground.** All three routes are GREEN, with Task 9's tools and route bound. Runs: 3 alone and 1 under load.
- [ ] **Step 2: `fullplay.mjs`.** With `FP_HOSE=760`, the run reaches zone 1 through the new crack. The tool exits 0 regardless, so assert it from its ledger: `zone 1 reached`.
- [ ] **Step 3: Bench views.**
  - `z0b`: "Velkath's ridge from 30 u". Retarget it to stand 30 u from (89.7, 39.1) on her open-sand side, facing her.
  - `z0r`: "the densest 40 u plant cell". Re-find it with the scene traversal of instanced meshes by `userData.plantKey` (the densest 40 u cell of zone-0 plant instances), and update its x/z.
  - Fix the comment: the views stand on `terrainH + 0.05`.
- [ ] **Step 4: Cost (G8).** On a quiet machine, run a cross-load ABBA against main (CLAUDE.md "Perf harness": two worktrees on two ports, `goto` A B B A, `setup` + `live` in each). Views: `z0`, `z0r`, `z0b` and `z1`, at 1.0x.
  - Prove the machine is quiet with the `cal` / `gcal` flags.
  - Report each view's delta against the noise floor (±0.1–0.3 ms). Main's `z0b` and `z0r` stand at the OLD coordinates, so note that the views differ.
- [ ] **Commit**: `bench views: z0b at her new bed from 30 u, z0r the densest plant cell on the new ground; velfix-gate 3/3 + under load, fullplay reaches zone 1; ABBA cost`.

---

### Task 11: Walking and the lens on the new ground (Review Focus 1 and 4; G1's hose)

**Files:** create `tools/bench/relief-walk.mjs`: real CDP keys, a live loop, modelled on `fissure-probe climb-out`'s key path.

- [ ] **Step 1: Write the three modes.**

  `boots`: real `W` walks along three lines. Run the replica first, so the lines are picked by measurement:
  - a riser at its steepest (the replica's steepest S5 cell in the riser band, from `gates.mjs --json`);
  - an upland flank (the steepest uplands cell);
  - the raft column → her bed.

  Per planted stance frame, book `__fts[i].wlo − terrainH(__fts[i].wx, __fts[i].wz)` (`diver.js`) and the ground slope there.

  Pass:
  - on ground ≤ 35°: p95 |gap| ≤ 0.15 u;
  - steeper ground is REPORTED (per 5° bin), not gated. The rig clamps at 35.5° by design; Michael judges it.
  - Sal makes progress: no 2 s window with less than 0.5 u moved, except where the slope exceeds 52°.

  `lens`: the same lines walked DOWN, the riser behind him.
  - Per frame, book `camera.y − shutFloorY(camera.x, camera.z, 0)` and the lens's frame step.
  - Pass: clearance ≥ 0.3 u on every frame, step ≤ main's p99 on the same probe at the old floor's equivalent line.
  - RED: add a dev flag in `game.js` `updateCamera`, `if (!inCrack && !window.__camNoFloor) camDesired.y = Math.max(camDesired.y, shutFloorY(…) + 1.2);`. Set `__camNoFloor = true` and the walk down must fail clearance.

  `hose`: start from the deck with `HOSE_START` 380 (`FP_HOSE` unset). Walk to the replica's hose binding point (`gates.mjs --json` → `hose.at`).
  - Pass: arrive without a yank (`__leash` last yank null) and with `__leash.state()` short of the give by ≥ 10 u (spec §7).
  - RED: target a point 20 u past the binding point; it must yank.
- [ ] **Step 2: Run all three modes on the new ground** and paste the tables. Run `boots` on main too, on the closest equivalent slopes, for the comparison.
- [ ] **Commit** the probe, with the tables in the body.

---

### Task 12: Placements on the new ground (G6; Review Focus 5)

**Files:**
- Create: `tools/bench/seating-probe.mjs` (from `~/sc/.abyssa-wt/reviews/primfix-survey/x3.mjs`, `x8.mjs`, `x9.mjs`, `x2.mjs`).
- Modify: `src/world/fauna.js` (`morayLayout`, `crabLayout`).
- Modify: `src/world/rifts.js` (`seedMotes`).

- [ ] **Step 1: The seating probe.** Port the survey into a committed probe that exits 1 on a failure. It samples, against `wrecks.js` `terrainSample(zi, x, z)`:
  - props, resource nodes, debris (`physics.js`), relics, her moult, egg skins, crate corners and mast ends.

  Its checks:
  - hover: lowest point > 0.08 u over the floor;
  - sunk: highest point < 0;
  - nodes inside boulders.

  Its zone test is by `terrainH`, not the survey's hard-coded `y > −330`. Run it at home, Pallid, then home again.
  - Pass: 0 hover, 0 wholly sunk.
  - RED: lift one prop 0.5 u in the page; it must be caught.
- [ ] **Step 2: Plant counts.** Traverse the scene for instanced meshes with `userData.plantKey` and read `.count`, at home on main and on the branch.
  - Pass: each key within ±10% of main's (spec G6).
  - If one fails, the `place()` slope gates are starving it. Report which gate, and rule on it.
- [ ] **Step 3: The fauna floor.** `morayLayout` and `crabLayout` take candidate rocks with `c.y > zoneBottom(0) − 6` (−266), so the hollow (bottom about −278) gets none.
  - First run the failing check: count rocks with `c.y < −266` in zone 0 (> 0 on the relief) and morays/crabs placed there (0).
  - Then change the bound to the zone's real floor, `c.y > zoneBottom(0) − 32` (−292, under the spec's −285 floor), and confirm that zone 1's rocks (≈ −520..−570) still stay out.
  - Re-run: morays and crabs appear in the hollow; the totals are within ±1 of main's.
- [ ] **Step 4: Motes.** `seedMotes` spawns at y ∈ [zoneBottom + 18, zoneTop − 15] anywhere in r 15–221. On the relief, some land inside ridges up to −205.
  - Failing check: count motes with `y < terrainH(x, z, zi) + 3` (expect > 0 over a few seeds).
  - Fix: `grp.position.y = Math.max(y, terrainH(x, z, zi) + 4)`, a one-line clamp after the draw. Don't reorder the random draws, so the layout stays otherwise the same.
  - Re-run: 0 motes inside.
- [ ] **Step 5: The skiff and the sonar.**
  - The skiff is on its terrace, not hovering (seating probe).
  - A real walk from the raft to it: no hop needed (S5's route), and the sonar pickup prompt appears at the wreck.
  - The keepsakes at remote sites are unchanged; validate's frozen wrecks prove it.
- [ ] **Commit**: `placements on the relief: the seating probe committed; morays and crabs reach the hollow; motes never spawn inside the ground; plant counts within ±10%`.

---

### Task 13: The look, for Michael (L1–L4)

**Files:** copy `~/sc/.abyssa-wt/reviews/seabed-relief-tool/{drive.mjs, sample.page.js, render.page.js, upload.page.js}` into `tools/relief/render/`, and fix their paths and ports. Outputs go to `~/sc/.abyssa-wt/shots/relief-*`.

- [ ] **L1.** The hillshade map of home zone 0 and three sections (A, B, C as in the audit): main beside the branch. Overlay the raft, the crack, her bed, the skiff and the hose binding point.
- [ ] **L2.** In-game stills, with the post chain settled (`__bench.capture({ settle: 90 })`), for main and the branch at the same camera:
  1. the raft-column landing, looking toward the crack;
  2. her bed, looking north-east at the taller wall (call 3);
  3. an upland ridge, looking back over the hollow;
  4. her bed;
  5. the skiff on its new ground;
  6. the open throat from its lip (call 1).
- [ ] **L2b. Height-tied shading.** The terrain shader reads `vColor.b`, the height above `ZB[0]` (−260) over 220 u, clamped to 0..1 (`fillTerrain`). It uses it twice: `rockW += hb × 0.10`, and albedo × (… + 0.10 hb).
  - Today's open floor sits at hb ≈ 0.07. The hollow clamps to 0 (−0.7% albedo) and the uplands reach ≈ 0.2 (+2%). Measured in the code this is negligible, but confirm it in the stills: the hollow's tonal variation comes from slope, AO and the macro bias, not a flat band.
  - If a still shows the hollow reading as one flat tone, report it with the frame. Do not retune the encoding inside this plan.
- [ ] **L3.** `__exposure.state()` at her bed, the raft column and an upland ridge: inside its depth clamp.
  - The ward glare at the new depth: light a ward with the lens under her and book the blown share per frame (velhard's check). The light-up flash must be ≤ 50% of the frame.
- [ ] **L4.** A full take: `fullplay.mjs` with `RP_VIDEO`, average policy, from the raft to zone 1. Encode it to MP4 (`~/sc/.abyssa-wt/encode.mjs`, `ENC_MIME='video/mp4;codecs=avc1.640028'`, then `avconvert … --preset PresetHighestQuality --replace`) as `~/sc/.abyssa-wt/video/relief-full.mp4`.
- [ ] **Commit** the render tools; the images and video stay outside the repo.

---

### Task 14: The record

**Files:** `CLAUDE.md`, `roadmap/seafloor-relief.md`, `docs/reports/2026-10-13-seafloor-relief.md` (new).

- [ ] **CLAUDE.md.**
  - In the terrain bullet, add a THE RELIEF paragraph: the two terms, keyed to frozen geometry; the crack takes only the uniform part; `__relief`; `tools/relief/` and its four commands.
  - Update the fingerprints everywhere they are quoted: the INVARIANTS line, THE CHART paragraph, and home `__ridge.fp()` (new, with 3b526986 as history). Update `sleeperFingerprint(0)` (new), and `__lev.fp(0)` if it moved, with its cause.
  - THE CHART: "site 0 = shipped world BIT-IDENTICAL" becomes the new anchor's story, with home's rows named.
  - The bench views (`z0b`, `z0r`).
  - `fissure-probe`'s mode count (25).
- [ ] **The report.** Every gate's table:
  - offline S1–S7, §7, G3, cost;
  - in game, G1–G8;
  - the probes' re-derivations with their RED mutants;
  - Review Focus 1–5 results;
  - the tuning log;
  - the three calls with their stills (paths).
- [ ] **The roadmap card.** Log the build, with commits and the merge hash once merged, then `python3 /Users/michaelpaulus/.claude/mods/roadmap/bin/gen.py roadmap`. The orchestrator publishes it.
- [ ] **Commit**: `docs: THE RELIEF in CLAUDE.md (anchors, tools, views), the report, the card`.
