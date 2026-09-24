# The Brooder, checkpoint 1 (module split + body) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the leviathan module so a zone can host a different creature, then build VELKATH THE BROODER's body (carapace, eight walking legs, crusher and cutter claws, eye stalks, underside wards) and make her posable in the lab for Michael's eye.

**Architecture:** `src/entities/leviathan.js` stays the only import path the game uses and becomes a facade that dispatches on `cfg.kind`. The shared machinery (ward light pool, rune texture, embers, sonar/keeper gates, dispose) moves to `src/entities/sleeper/common.js`. The current creature moves verbatim to `src/entities/sleeper/serpent.js`. The Brooder is two new files: pure geometry and baked maps in `brooderGeo.js`, build and motion in `brooder.js`. Zone 0 keeps shipping the serpent until Michael approves; the lab swaps her in live.

**Tech Stack:** Three.js r184 (WebGL2, ES modules via importmap, no build step), `three/addons/utils/BufferGeometryUtils.js`, the in-app browser pane for verification (no test runner exists in this repo; tests are JavaScript probes run in the page).

**Spec:** `docs/superpowers/specs/2026-09-13-three-sleepers-design.md` §2 (zone 0), §4 (shared contract), §5 (geometry bar), §7 steps 1–2.

## Global Constraints

- Hard rule: every asset is generated in code. No model files, no image files, no Blender.
- The game imports only `makeLeviathan`, `disposeLeviathan`, `updateLeviathan`, `BODY_R_MAX` from `src/entities/leviathan.js`, and `revealWards` in `src/systems/tools.js`. Those names and signatures must keep working.
- The scene light count is sacred at 14. Wards borrow from the fixed pool of 5 ward lights and never add a light.
- Zero per-frame allocation in any update path. Scratch vectors are module-level.
- Reseed/voyage contract: `disposeLeviathan` must release everything a build made, and a rebuild must work any number of times.
- Site-0 terrain fingerprint stays `35acc2d0`. Terrain is not touched in this plan.
- Serpent behaviour must be bit-identical after the split (Task 1 records the goldens, Task 2 must reproduce them).
- The frame governor is on: before any GPU or frame-rate measurement run `__power.set(0,0)`, and restore with `__power.set(60,30)`.
- Browser pane rules: own tab, explicit `tabId`, `localStorage.clear()` before a clean load, close the tab when done.
- Commit per task. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `sleepers-brooder`; merge to `main` with `--no-ff` at the end. `git checkout -- ROADMAP.html` before any merge.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/entities/leviathan.js` | rewritten as facade | kind dispatch, dispose, the split's regression fingerprint |
| `src/entities/sleeper/common.js` | new | live sleeper pointer, sonar reveal, messages, ward light pool, rune texture, ward build/idle/touch/flash, embers, generic dispose |
| `src/entities/sleeper/serpent.js` | new, moved verbatim | the current serpent creature |
| `src/entities/sleeper/brooderGeo.js` | new | Brooder geometry and baked maps, pure functions, unit scale |
| `src/entities/sleeper/brooder.js` | new | Brooder build, planted-foot gait, IK, claw/eye/mouth rig, wards, lab commands |
| `src/config.js` | modify | `kind` on each `LEVIATHAN_CFG` row |
| `src/game.js` | modify | `makeZoneSleeper`, per-kind collision radius, `window.__lev` probe |
| `src/ui/lab.js` | modify | "sleeper" group |
| `CLAUDE.md`, `roadmap/three-sleepers.md` | modify | architecture notes, log |

## How code blocks in this plan are applied

A fenced block preceded by a line `<!-- write: PATH -->` is the complete content of that file. Apply it with the extractor below rather than retyping it, so the file on disk is exactly the plan:

```bash
python3 - "$PLAN" "$FILE" <<'EOF'
import re, sys
plan, want = sys.argv[1], sys.argv[2]
s = open(plan).read()
m = re.search(r'<!-- write: ' + re.escape(want) + r' -->\n```[a-z]*\n(.*?)\n```\n', s, re.S)
assert m, 'no block for ' + want
open(want, 'w').write(m.group(1) + '\n')
print('wrote', want, len(m.group(1).splitlines()), 'lines')
EOF
```

with `PLAN=docs/superpowers/plans/2026-09-24-brooder-body.md` and `FILE` the repo-relative path.

---

### Task 1: Regression anchor for the split

**Files:**
- Modify: `src/entities/leviathan.js` (append at end of file)
- Modify: `src/game.js` (add `window.__lev.fp`)

**Interfaces:**
- Produces: `sleeperFingerprint(idx, over, frames = 120) -> string` (8 hex chars), exported from `src/entities/leviathan.js`. `window.__lev.fp(i)` in the page.

- [ ] **Step 1: Branch**

```bash
cd /Users/michaelpaulus/sc/abyssa && git switch -c sleepers-brooder
```

- [ ] **Step 2: Write the probe call that will fail**

In the page (after load, `?lab`), run:

```js
window.__lev && window.__lev.fp(0)
```

Expected now: `undefined` or a TypeError, because neither exists yet.

- [ ] **Step 3: Append the fingerprint to `src/entities/leviathan.js`**

```js
// ---- REGRESSION ANCHOR --------------------------------------------------------------
// Build zone idx's sleeper under a seeded Math.random, step it `frames` fixed 1/60 s
// frames against a parked player 12 u off the head, and FNV-1a hash what came out
// (events, head, spine, ward positions, a stride of the body surface). Disposes what it
// built. The CALLER owns the live sleeper: this touches the shared ward light pool and
// the module's live pointer, so game.js tears the live one down first and rebuilds after.
// Values are rounded to 1e-4 before hashing so a harmless reassociation can't flip it.
export function sleeperFingerprint(idx, over, frames = 120) {
  // Warm the lazy module caches first (one of them draws Math.random on its first
  // build), so the seeded run below sees the same stream on every call.
  disposeLeviathan(makeLeviathan(idx, over));
  const R0 = Math.random;
  Math.random = seededRand(0x51EE9E11);
  let h = 0x811c9dc5;
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const mix = v => { f32[0] = Math.round(v * 1e4) / 1e4; h ^= u32[0]; h = Math.imul(h, 0x01000193) >>> 0; };
  let L = null;
  try {
    L = makeLeviathan(idx, over);
    const player = { pos: L.head.clone().add(new THREE.Vector3(12, 0, 0)), vel: new THREE.Vector3() };
    for (let f = 0; f < frames; f++) {
      const ev = updateLeviathan(L, 1 / 60, f / 60, player);
      mix(ev.sigilLit); mix(ev.lightDrain); mix(ev.remaining); mix(ev.slam ? 1 : 0);
    }
    mix(L.head.x); mix(L.head.y); mix(L.head.z);
    for (const s of L.spine) { mix(s.x); mix(s.y); mix(s.z); }
    for (const g of L.sigils) { mix(g.grp.position.x); mix(g.grp.position.y); mix(g.grp.position.z); mix(g.lit ? 1 : 0); }
    if (L.bodyGeo) { const a = L.bodyGeo.attributes.position.array; for (let i = 0; i < a.length; i += 7) mix(a[i]); }
  } finally {
    if (L) disposeLeviathan(L);
    Math.random = R0;
  }
  return h.toString(16).padStart(8, '0');
}
```

- [ ] **Step 4: Expose it in `src/game.js`**

Change the leviathan import line to:

```js
import { makeLeviathan, disposeLeviathan, updateLeviathan, BODY_R_MAX, sleeperFingerprint } from './entities/leviathan.js';
```

Directly after the `enterZone` function, add:

```js
// Sleeper probe (roadmap/three-sleepers.md). fp(i): the split's regression hash for zone
// i's home sleeper; tears the live sleeper down around the run and rebuilds it.
window.__lev = {
  fp(i = Math.max(0, zone)) {
    disposeLeviathan(lev); lev = null;
    let out;
    try { out = sleeperFingerprint(i); }
    finally { if (zone >= 0) lev = makeZoneSleeper(zone); }
    return out;
  }
};
```

and factor the row logic out of `enterZone` so both use it. Replace the block in `enterZone` from `const row = currentSite().sleepers ...` through the closing `} : undefined);` with `lev = makeZoneSleeper(i);`, and add above `enterZone`:

```js
// Remote anchorages carry hand-authored sleeper rows: more wards, a hue nudge, an
// epithet in the previous chart-owner's ink. Home passes undefined and is untouched.
// `extra` merges last (the lab uses it to ask for a different kind).
function makeZoneSleeper(i, extra) {
  const row = currentSite().sleepers && currentSite().sleepers[i];
  const over = row ? {
    nSigils: row.sigils,
    hue: (LEVIATHAN_CFG[i].hue + row.hueShift + 1) % 1,
    name: currentSite().epithet ? currentSite().epithet[i] : LEVIATHAN_CFG[i].name
  } : undefined;
  return makeLeviathan(i, extra ? Object.assign({}, over, extra) : over);
}
```

- [ ] **Step 5: Record the goldens**

Serve (`python3 serve.py` is the project server on 8777; if it is already running reuse it), open `http://localhost:8777/?lab` in its own pane tab, wait for the title, then:

```js
[window.__lev.fp(0), window.__lev.fp(1), window.__lev.fp(2), window.__lev.fp(0)]
```

Expected: four 8-hex strings; the first and fourth equal (determinism). Run it twice more after a reload; identical each time. Write the three values into the card log (`roadmap/three-sleepers.md`) as the split's goldens. Console must show no errors.

- [ ] **Step 6: Commit**

```bash
git add src/entities/leviathan.js src/game.js roadmap/three-sleepers.md
git commit -m "sleepers: regression fingerprint for the leviathan split

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Split the module (serpent verbatim, shared machinery out)

**Files:**
- Create: `src/entities/sleeper/common.js`, `src/entities/sleeper/serpent.js`
- Rewrite: `src/entities/leviathan.js` (facade)
- Modify: `src/config.js:18-20` (add `kind`)

**Interfaces:**
- Consumes: `sleeperFingerprint` goldens from Task 1.
- Produces:
  - `common.js`: `REVEAL_T`, `MSG_WARDS_ANSWER`, `MSG_WARDS_DARK`, `MSG_WARDS_KEPT`, `setLive(L)`, `revealWards(origin, range)`, `wardRevealLeft()`, `SIGIL_POOL_N`, `sigilPool`, `ensureSigilPool()`, `runeTex(seed)`, `segDist(p, a, b)`, `burstEmbers(L, at, n)`, `updateEmbers(L, dt)`, `disposeSleeper(L)`. (Task 4 adds the ward helpers and `makeEmbers`.)
  - `serpent.js`: `makeSerpent(idx, cfg) -> L`, `updateSerpent(L, dt, t, player) -> ev`, `BODY_R_MAX`.
  - `leviathan.js`: unchanged public API plus `sleeperFingerprint`, and `L.kind` on every sleeper.
  - Sleeper object hooks: `L.onDispose()` (optional, called by `disposeSleeper`), `L.keepTex` (optional `Set` of textures dispose must not free).

- [ ] **Step 1: Add `kind` to the config rows**

In `src/config.js`, add `kind: 'serpent', ` as the first property of each of the three `LEVIATHAN_CFG` rows. Nothing else changes.

- [ ] **Step 2: Run the slicer**

The serpent moves verbatim; only four seams are edited. This script slices `src/entities/leviathan.js` at its section comments and asserts each anchor is found exactly once:

```bash
cd /Users/michaelpaulus/sc/abyssa && mkdir -p src/entities/sleeper && python3 - <<'EOF'
src = open('src/entities/leviathan.js').read()
def cut(a, b=None):
    i = src.index(a); assert src.count(a) == 1, a
    j = src.index(b) if b else len(src)
    return src[i:j]
A = {
 'rules':   ('// ---- A TOOL-SHAPED REASON PER ZONE', 'const smooth = THREE.MathUtils.smoothstep;'),
 'ident':   ('const smooth = THREE.MathUtils.smoothstep;', '// A carved ward:'),
 'rune':    ('// A carved ward:', '// ---------------------------------------------------------------- GLSL'),
 'glsl':    ('// ---------------------------------------------------------------- GLSL', '// ---- SIGIL LIGHT POOL'),
 'pool':    ('// ---- SIGIL LIGHT POOL', 'export function makeLeviathan'),
 'make':    ('export function makeLeviathan', 'export function disposeLeviathan'),
 'motion':  ('// ---------------------------------------------------------------- motion', '// Distance from p to the segment a->b'),
 'seg':     ('// Distance from p to the segment a->b', '// Seats a ward flush'),
 'place':   ('// Seats a ward flush', '// One ember burst'),
 'embers':  ('// One ember burst', '// Radial shockwave of hide-light'),
 'tail':    ('// Radial shockwave of hide-light', '// ---- REGRESSION ANCHOR'),
}
P = {k: cut(*v) for k, v in A.items()}

make = P['make']
head_old = make[:make.index('  if (c.nSigils > SIGIL_POOL_N)')]
assert 'let c = over ?' in head_old
make = 'export function makeSerpent(idx, cfg) {\n  // cfg arrives merged (leviathan.js): the chart row over the shipped config.\n  let c = cfg;\n  const Z = ZONE[idx];\n  // A chart row asking for more wards than the pool holds would force per-build\n  // PointLights and a scene light-count change mid-voyage — clamp instead.\n' + make[len(head_old):]
old = '  updateSpine(L);\n  scene.add(grp);\n  live = L;\n'
assert make.count(old) == 1
make = make.replace(old, '  L.onDispose = () => disposeSerpentExtras(L);\n  updateSpine(L);\n  scene.add(grp);\n  setLive(L);\n')
tail = P['tail'].replace('export function updateLeviathan(L, dt, t, player) {', 'export function updateSerpent(L, dt, t, player) {')
assert 'export function updateSerpent' in tail

serp_head = """// THE SERPENT — the original sleeper: one continuous deformed body carrying the wards.
// Moved verbatim out of entities/leviathan.js (roadmap/three-sleepers.md, task 2); the
// facade there dispatches on cfg.kind. Retires zone by zone as the three sleepers land.
//
// Shape pipeline: a follow-the-leader anchor chain gives the swim path; an anguilliform
// travelling wave is baked into L.spine (so gameplay hit-tests and visuals agree); the
// spine plus its frames are uploaded to a tiny float texture that the fin vertex
// shaders sample, and the body surface itself is solved on the CPU (rebuildBody).
import * as THREE from 'three';
import { scene, envTexDeep as envTex, camera } from '../../core.js';
import { WORLD_R, ZONE_H, zoneTop, zoneBottom } from '../../config.js';
import { rng, V3, clamp, lerp } from '../../lib/math.js';
import { makeGlow, glowTex, canvas2d, toTexture, noiseCanvas, normalFromHeight, seededRand } from '../../lib/textures.js';
import { terrainH } from '../../world/terrain.js';
import { setWardTargets, wardGuardCount } from '../../world/predators.js';
import {
  MSG_WARDS_DARK, MSG_WARDS_KEPT, setLive, SIGIL_POOL_N, sigilPool, ensureSigilPool,
  runeTex, segDist, burstEmbers, updateEmbers
} from './common.js';

const UP = V3(0, 1, 0);
"""
serp_tail = """
// The serpent's own leftovers for disposeSleeper: its contact blobs live on the scene
// (not on grp) and its spine texture is not reachable by the traversal.
function disposeSerpentExtras(L) {
  if (L.blobs) for (const b of L.blobs) { scene.remove(b); b.geometry.dispose(); b.material.dispose(); }
  if (L.blobTex) L.blobTex.dispose();
  if (L.sTex) L.sTex.dispose();
}
"""
open('src/entities/sleeper/serpent.js', 'w').write(
  serp_head + '\n' + P['ident'] + P['glsl'] + make + '\n' + P['motion'] + P['place'] + tail.rstrip() + '\n' + serp_tail)

com_head = """// Shared machinery for every sleeper kind (roadmap/three-sleepers.md, spec §4): the
// live-sleeper pointer and the sonar/keeper rules keyed on it, the fixed ward light
// pool, the carved rune, ward construction and the touch rule, ember bursts, dispose.
// Each creature file (serpent.js, brooder.js) builds its own body and motion on this.
import * as THREE from 'three';
import { scene, envTexDeep as envTex } from '../../core.js';
import { clamp } from '../../lib/math.js';
import { makeGlow, glowTex, canvas2d, maxAniso } from '../../lib/textures.js';
import { setWardTargets, wardGuardCount } from '../../world/predators.js';

const _b = new THREE.Vector3();
"""
rules = P['rules'].replace('export const MSG_WARDS_ANSWER', 'export { REVEAL_T };\nexport const MSG_WARDS_ANSWER')
rules = rules.replace('let live = null;\n', 'let live = null;\nexport function setLive(L) { live = L; }\n')
assert 'export function setLive' in rules
pool = P['pool'].replace('const SIGIL_POOL_N = 5;\nconst sigilPool = [];\nfunction ensureSigilPool()',
                         'export const SIGIL_POOL_N = 5;\nexport const sigilPool = [];\nexport function ensureSigilPool()')
assert 'export function ensureSigilPool' in pool
rune = P['rune'].replace('function runeTex(seed)', 'export function runeTex(seed)')
seg = P['seg'].replace('function segDist(p, a, b)', 'export function segDist(p, a, b)')
emb = P['embers'].replace('function burstEmbers(L, at, n = 40)', 'export function burstEmbers(L, at, n = 40)') \
                 .replace('function updateEmbers(L, dt)', 'export function updateEmbers(L, dt)')
assert 'export function updateEmbers' in emb and 'export function segDist' in seg and 'export function runeTex' in rune
com_tail = """
// Generic teardown: park the borrowed ward lights (never remove them — the pool exists
// to keep the scene's light count constant), drop the group, let the creature release
// anything outside it (L.onDispose), then free every geometry/material/texture under
// grp except the shared glow/env maps and anything the creature caches (L.keepTex).
export function disposeSleeper(L) {
  if (!L) return;
  if (live === L) { live = null; setWardTargets(-1, null); }
  for (const g of L.sigils) g.light.intensity = 0;
  scene.remove(L.grp);
  if (L.onDispose) L.onDispose();
  L.grp.traverse(o => {
    if (o.geometry && !o.isSprite) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) {
        const v = m[k];
        if (v && v.isTexture && v !== glowTex && v !== envTex && !(L.keepTex && L.keepTex.has(v))) v.dispose();
      }
      m.dispose();
    }
  });
}
"""
open('src/entities/sleeper/common.js', 'w').write(com_head + '\n' + rules + '\n' + rune + '\n' + pool + '\n' + seg + '\n' + emb.rstrip() + '\n' + com_tail)
print('ok')
EOF
```

Note on `REVEAL_T`: the rules chunk declares `const REVEAL_T = 8;` before the messages; the script adds an `export { REVEAL_T };` line so later kinds can read it.

- [ ] **Step 3: Write the facade**

<!-- write: src/entities/leviathan.js -->
```js
// The sleepers — ONE import path for the game (game.js, tools.js). Each zone's colossus
// is a KIND: cfg.kind in config.js LEVIATHAN_CFG picks the creature module, and a chart
// row (`over`) or the lab can override it. Every kind returns the same sleeper object
// shape the game reads — head, spine (collision centres), size, name, sigils, calmed —
// and the same update event { sigilLit, calmed, lightDrain, slam, remaining, msg }.
// Shared machinery lives in sleeper/common.js; see roadmap/three-sleepers.md.
import * as THREE from 'three';
import { LEVIATHAN_CFG } from '../config.js';
import { seededRand } from '../lib/textures.js';
import { disposeSleeper } from './sleeper/common.js';
import { makeSerpent, updateSerpent, BODY_R_MAX } from './sleeper/serpent.js';
import { makeBrooder, updateBrooder } from './sleeper/brooder.js';

export { BODY_R_MAX };
export { revealWards, wardRevealLeft, MSG_WARDS_ANSWER, MSG_WARDS_DARK, MSG_WARDS_KEPT } from './sleeper/common.js';

const KINDS = {
  serpent: { make: makeSerpent, update: updateSerpent },
  brooder: { make: makeBrooder, update: updateBrooder }
};
export const sleeperKinds = () => Object.keys(KINDS);

// `over` is THE CHART's authored sleeper row for a remote site (nSigils/hue/name, and
// optionally kind). It merges over the shipped config and flows through the creature.
export function makeLeviathan(idx, over) {
  const c = over ? Object.assign({}, LEVIATHAN_CFG[idx], over) : LEVIATHAN_CFG[idx];
  const kind = KINDS[c.kind] ? c.kind : 'serpent';
  const L = KINDS[kind].make(idx, c);
  L.kind = kind;
  return L;
}

export function updateLeviathan(L, dt, t, player) {
  return KINDS[L.kind].update(L, dt, t, player);
}

export function disposeLeviathan(L) { disposeSleeper(L); }

// ---- REGRESSION ANCHOR --------------------------------------------------------------
// Build zone idx's sleeper under a seeded Math.random, step it `frames` fixed 1/60 s
// frames against a parked player 12 u off the head, and FNV-1a hash what came out
// (events, head, spine, ward positions, a stride of the body surface). Disposes what it
// built. The CALLER owns the live sleeper: this touches the shared ward light pool and
// the module's live pointer, so game.js tears the live one down first and rebuilds after.
// Values are rounded to 1e-4 before hashing so a harmless reassociation can't flip it.
export function sleeperFingerprint(idx, over, frames = 120) {
  // Warm the lazy module caches first (one of them draws Math.random on its first
  // build), so the seeded run below sees the same stream on every call.
  disposeLeviathan(makeLeviathan(idx, over));
  const R0 = Math.random;
  Math.random = seededRand(0x51EE9E11);
  let h = 0x811c9dc5;
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const mix = v => { f32[0] = Math.round(v * 1e4) / 1e4; h ^= u32[0]; h = Math.imul(h, 0x01000193) >>> 0; };
  let L = null;
  try {
    L = makeLeviathan(idx, over);
    const player = { pos: L.head.clone().add(new THREE.Vector3(12, 0, 0)), vel: new THREE.Vector3() };
    for (let f = 0; f < frames; f++) {
      const ev = updateLeviathan(L, 1 / 60, f / 60, player);
      mix(ev.sigilLit); mix(ev.lightDrain); mix(ev.remaining); mix(ev.slam ? 1 : 0);
    }
    mix(L.head.x); mix(L.head.y); mix(L.head.z);
    for (const s of L.spine) { mix(s.x); mix(s.y); mix(s.z); }
    for (const g of L.sigils) { mix(g.grp.position.x); mix(g.grp.position.y); mix(g.grp.position.z); mix(g.lit ? 1 : 0); }
    if (L.bodyGeo) { const a = L.bodyGeo.attributes.position.array; for (let i = 0; i < a.length; i += 7) mix(a[i]); }
  } finally {
    if (L) disposeLeviathan(L);
    Math.random = R0;
  }
  return h.toString(16).padStart(8, '0');
}
```

The facade imports `brooder.js`, which does not exist until Task 5. For this task only, create a stub so the page loads:

<!-- write: src/entities/sleeper/brooder.js -->
```js
// THE BROODER — placeholder until task 5 lands the real body.
import { makeSerpent, updateSerpent } from './serpent.js';
export const makeBrooder = makeSerpent;
export const updateBrooder = updateSerpent;
```

- [ ] **Step 4: Syntax check**

```bash
for f in src/entities/leviathan.js src/entities/sleeper/*.js src/config.js src/game.js; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 5: Verify the goldens**

Reload the pane tab with `localStorage.clear()` first, then run the same probe as Task 1 Step 5. Expected: exactly the three recorded hashes. Also confirm the page reaches the title, a dive starts, and `read_console_messages` with `onlyErrors` is empty.

If any hash differs, the split is not verbatim: diff `serpent.js` against `git show HEAD:src/entities/leviathan.js` and fix the seam; do not continue.

- [ ] **Step 6: Commit**

```bash
git add src/entities/leviathan.js src/entities/sleeper src/config.js
git commit -m "sleepers: split leviathan.js into facade + common + serpent (fingerprints identical)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Game-side kind support and the lab swap

**Files:**
- Modify: `src/game.js` (`buildDynCols`, `window.__lev`)
- Modify: `src/ui/lab.js` (a "sleeper" group after the rays group)

**Interfaces:**
- Consumes: `makeZoneSleeper(i, extra)` (Task 1), `L.kind`.
- Produces: `window.__lev = { fp(i), swap(kind), cmd(name, arg), state(), me() }`. Sleeper objects MAY provide `L.collR` (collision sphere radius), `L.cmd(name, arg)`, `L.probe()`.

- [ ] **Step 1: Failing probe**

```js
typeof window.__lev.swap
```

Expected: `"undefined"`.

- [ ] **Step 2: Collision radius per kind**

In `buildDynCols`, replace `const r = lev.size * BODY_R_MAX;` with:

```js
    const r = lev.collR || lev.size * BODY_R_MAX;   // per kind: the brooder's shell spheres are smaller
```

- [ ] **Step 3: Extend `window.__lev`**

Replace the Task 1 `window.__lev` block with:

```js
// Sleeper probe (roadmap/three-sleepers.md). fp(i): the split's regression hash for zone
// i's home sleeper. swap(kind): rebuild the live zone's sleeper as another kind — a
// placeable kind is set down 45 u ahead of the diver, facing him. cmd: the kind's own
// lab verbs (brooder: stand / settle / walk / rear / place). Dev only; nothing calls it.
window.__lev = {
  fp(i = Math.max(0, zone)) {
    disposeLeviathan(lev); lev = null;
    let out;
    try { out = sleeperFingerprint(i); }
    finally { if (zone >= 0) lev = makeZoneSleeper(zone); }
    return out;
  },
  swap(kind) {
    disposeLeviathan(lev);
    lev = makeZoneSleeper(zone, kind ? { kind } : undefined);
    if (lev.cmd) {
      const f = forwardVec(), fx = f.x, fz = f.z, fl = Math.hypot(fx, fz) || 1;
      const pos = player.pos.clone();
      pos.x += fx / fl * 45; pos.z += fz / fl * 45;
      lev.cmd('place', { pos, yaw: Math.atan2(-fx, -fz) });
    }
    return lev.kind;
  },
  cmd(name, arg) { return lev && lev.cmd ? lev.cmd(name, arg) : null; },
  state() { return lev ? (lev.probe ? lev.probe() : { kind: lev.kind, calmed: lev.calmed }) : null; },
  me() { return player.pos.clone(); }
};
```

- [ ] **Step 4: Lab group**

In `src/ui/lab.js`, directly after the `michael's road` button block that follows `knobGroup('rays', …)` closes, add:

```js
  // --- SLEEPERS (roadmap/three-sleepers.md) ----------------------------------------
  // Swap the live zone's sleeper to another kind and pose it. Not saved, not a knob:
  // the next zone entry or voyage rebuilds the shipped kind.
  {
    const d = el('details', 'stop', bd);
    const sm = el('summary', null, d);
    el('span', null, sm, 'sleeper');
    const inr = el('div', 'in', d);
    const rb = el('div', 'btns', inr);
    const rb2 = el('div', 'btns', inr);
    const sro = el('div', 'ro', inr);
    const show = () => {
      const s = window.__lev && window.__lev.state();
      sro.textContent = s ? JSON.stringify(s, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v, 1).slice(0, 900) : 'no sleeper';
    };
    const btn = (row, label, fn) => {
      const b = el('button', null, row, label);
      b.addEventListener('click', () => { if (window.__lev) fn(window.__lev); show(); });
    };
    btn(rb, 'serpent', L => L.swap('serpent'));
    btn(rb, 'brooder', L => L.swap('brooder'));
    btn(rb2, 'stand', L => L.cmd('stand'));
    btn(rb2, 'settle', L => L.cmd('settle'));
    btn(rb2, 'walk to me', L => L.cmd('walk', L.me()));
    btn(rb2, 'rear', L => L.cmd('rear'));
    setInterval(() => { if (!d.open || panel.classList.contains('off')) return; show(); }, 500);
  }
```

If `panel` is not the lab root's variable name in scope at that point, use the name the existing `tick = setInterval` block tests (`panel.classList.contains('off')`); it is the same scope.

- [ ] **Step 5: Verify**

Syntax check the two files with `node --check`. Reload the pane, then:

```js
[window.__lev.swap('serpent'), window.__lev.fp(0), window.__lev.state()]
```

Expected: `'serpent'`, the zone-0 golden, `{ kind: 'serpent', calmed: false }`. Open the lab, confirm the "sleeper" group renders with six buttons. Console clean.

- [ ] **Step 6: Commit**

```bash
git add src/game.js src/ui/lab.js
git commit -m "sleepers: per-kind collision radius, __lev swap/cmd probe, lab sleeper group

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Brooder geometry and baked maps

**Files:**
- Create: `src/entities/sleeper/brooderGeo.js`

**Interfaces:**
- Produces (all unit scale, carapace half-width = 1, +Z front, +Y up):
  - `rimR(th) -> number` footprint radius at bearing `th` (0 = +X, PI/2 = +Z).
  - `shellAt(x, z, out) -> out` with `out.h, out.rho, out.d, out.id, out.f1`.
  - `shellNormal(x, z, out: Vector3) -> Vector3`.
  - `carapaceGeo() -> BufferGeometry` (position, normal, uv, color).
  - `carapaceMaps() -> { map, normalMap, roughnessMap }` (cached; module lifetime).
  - `bellyGeo() -> BufferGeometry` (belly + brood apron, faces down).
  - `segmentGeo({ r0, r1, flat, spines, rows, radial, tip, curl }) -> BufferGeometry` unit length along +X.
  - `hornGeo({ len, r0, curve, flat, bite, teeth, rows, radial }) -> BufferGeometry`.
  - `palmGeo(kind: 'crusher'|'cutter') -> BufferGeometry` with `userData.hinge: [x, y, z]`, `userData.len`.
  - `barnacleGeo() -> BufferGeometry`, `barnacleMatrices(n, seed) -> { m: Matrix4[], c: Color[] }`.
  - `weedMatrices(n, seed) -> Matrix4[]`.
  - `limbGrain() -> Texture` (cached normal map for the limbs).

- [ ] **Step 1: Failing probe**

In the pane: `import('/src/entities/sleeper/brooderGeo.js').then(m => Object.keys(m))`. Expected: a rejected promise (404).

- [ ] **Step 2: Write the file**

<!-- write: src/entities/sleeper/brooderGeo.js -->
```js
// THE BROODER — geometry and baked maps (roadmap/three-sleepers.md, spec §2 zone 0).
// Pure: unit scale (carapace half-width R = 1), +Z is the front, +Y up, seeded, no
// scene access. brooder.js scales the body group by R and poses the parts.
//
// The shell is a crab carapace read as armour: a dome over a lobed footprint (flat
// frontal margin, the eye orbits, a "pie-crust" of scallops down the front flanks),
// the anatomical swellings every crab has (gastric, branchial, cardiac) cut by the
// cervical groove, and over that a mirrored Voronoi of 26 scutes with chamfered seams
// and growth lines. The same function feeds the mesh, the baked maps, the barnacle
// scatter and the ward/collision placement, so they can never disagree.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas2d, toTexture, normalFromHeight, noiseCanvas, seededRand } from '../../lib/textures.js';

const TAU = Math.PI * 2;
// JS smoothstep; reversed edges are fine HERE (the GLSL UB rule is about the driver).
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x / w) * (x / w));

// ---- seeded value noise ------------------------------------------------------------
function lattice(n, rnd) { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); return { n, g }; }
function vsmp(L, x, y) {
  const n = L.n, g = L.g;
  x = (x % 1 + 1) % 1 * n; y = (y % 1 + 1) % 1 * n;
  const xi = Math.floor(x), yi = Math.floor(y), x1 = (xi + 1) % n, y1 = (yi + 1) % n;
  let tx = x - xi, ty = y - yi;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = g[yi * n + xi], b = g[yi * n + x1], c = g[y1 * n + xi], d = g[y1 * n + x1];
  return a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * ty;
}
const OCT = (() => { const r = seededRand(0xC4A8A9E5); return [4, 8, 16, 32, 64, 128].map(n => lattice(n, r)); })();
function fbm(x, y, o0 = 0, o1 = 4) {
  let v = 0, a = 0.5, t = 0;
  for (let o = o0; o < o1; o++) { v += vsmp(OCT[o], x, y) * a; t += a; a *= 0.5; }
  return v / t;
}

// ---- footprint ---------------------------------------------------------------------
export function rimR(th) {
  const c = Math.cos(th), s = Math.sin(th);
  let r = 1 / Math.sqrt(c * c + (s / 0.86) * (s / 0.86));
  if (s < 0) r *= 1 - 0.16 * Math.pow(-s, 1.5);                  // narrower behind
  if (s > 0) r = Math.min(r, 0.80 / Math.max(s, 1e-3));           // flat frontal margin
  if (s > 0) {
    // anterolateral scallops between the orbit and the widest point
    const a = Math.atan2(s, Math.abs(c));                         // 0 at the side, PI/2 dead ahead
    if (a > 0.12 && a < 1.18) {
      const k = (a - 0.12) / 1.06, lobe = 0.5 - 0.5 * Math.cos(k * 9 * TAU);
      r *= 1 + 0.045 * lobe * lobe * Math.sin(Math.PI * k);
    }
    r -= 0.030 * gauss(c, 0.07) * s;                              // rostral notch
    r -= 0.040 * gauss(Math.abs(c) - 0.21, 0.05) * s;             // eye orbits
  }
  return r;
}

// 26 scutes: four on the keel, eleven mirrored pairs down the flanks.
const PLATES = (() => {
  const rnd = seededRand(0xB700D5E7), pts = [];
  for (const z of [0.52, 0.18, -0.16, -0.48]) pts.push([0, z + (rnd() - 0.5) * 0.06]);
  const flank = [[0.34, 0.56], [0.38, 0.26], [0.36, -0.06], [0.34, -0.36], [0.66, 0.40], [0.70, 0.10],
    [0.66, -0.20], [0.56, -0.50], [0.90, 0.22], [0.90, -0.06], [0.80, -0.34]];
  for (const [x, z] of flank) {
    const jx = (rnd() - 0.5) * 0.08, jz = (rnd() - 0.5) * 0.08;
    pts.push([x + jx, z + jz], [-(x + jx), z + jz]);
  }
  return pts;
})();

export function shellAt(x, z, out) {
  const rr = rimR(Math.atan2(z, x)), rho = Math.min(1, Math.hypot(x, z) / rr);
  let f1 = 9, f2 = 9, id = 0;
  for (let i = 0; i < PLATES.length; i++) {
    const dx = x - PLATES[i][0], dz = z - PLATES[i][1], d = dx * dx + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; id = i; } else if (d < f2) f2 = d;
  }
  f1 = Math.sqrt(f1); f2 = Math.sqrt(f2);
  const d = f2 - f1, inner = 1 - sst(0.86, 0.985, rho);           // scutes fade into the margin
  let h = 0.42 * Math.pow(Math.max(0, 1 - Math.pow(rho, 2.2)), 0.62);
  h += 0.045 * Math.exp(-(x * x + (z - 0.34) * (z - 0.34)) / 0.07);                        // gastric
  h += 0.035 * (Math.exp(-((x - 0.46) * (x - 0.46) + (z + 0.04) * (z + 0.04)) / 0.09)
              + Math.exp(-((x + 0.46) * (x + 0.46) + (z + 0.04) * (z + 0.04)) / 0.09));   // branchial
  h += 0.030 * Math.exp(-(x * x + (z + 0.30) * (z + 0.30)) / 0.03);                        // cardiac
  h -= 0.020 * gauss(z - (0.08 + 0.35 * x * x), 0.03) * inner;                              // cervical groove
  h += 0.030 * gauss(x, 0.07) * (1 - rho);                                                   // keel
  h -= 0.022 * (1 - sst(0.0, 0.035, d)) * inner;                                             // scute seams
  h += 0.018 * sst(0.02, 0.16, d) * inner;                                                   // scute crowns
  out.h = h; out.rho = rho; out.d = d; out.id = id; out.f1 = f1;
  return out;
}

const _s1 = {}, _s2 = {};
export function shellNormal(x, z, out) {
  const e = 0.004;
  const hx = (shellAt(x + e, z, _s1).h - shellAt(x - e, z, _s2).h) / (2 * e);
  const hz = (shellAt(x, z + e, _s1).h - shellAt(x, z - e, _s2).h) / (2 * e);
  return out.set(-hx, 1, -hz).normalize();
}

function withColor(g, r, gg, b) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function build(pos, uv, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- carapace ----------------------------------------------------------------------
// Polar grid: ROWS from the crown to the rim, then RIM rows curling under to the lip at
// rho 0.80. The wrap column duplicates column 0; its normals are averaged after the
// solve so the +X flank has no seam. Planar UVs (x,z)*0.5+0.5 carry the baked maps.
export function carapaceGeo(COLS = 256, ROWS = 88, RIM = 14) {
  const sh = {}, pos = [], uv = [], col = [], idx = [];
  const NR = ROWS + RIM;
  for (let i = 0; i <= NR; i++) for (let j = 0; j <= COLS; j++) {
    const th = (j % COLS) / COLS * TAU, rr = rimR(th), c = Math.cos(th), s = Math.sin(th);
    let x, y, z, shade = 1;
    if (i <= ROWS) {
      const rho = 0.004 + 0.996 * Math.pow(i / ROWS, 0.85);
      x = c * rr * rho; z = s * rr * rho; y = shellAt(x, z, sh).h;
    } else {
      const k = (i - ROWS) / RIM;
      const rho = 1 + 0.018 * Math.sin(k * Math.PI) - 0.20 * sst(0.25, 1, k);
      const yE = shellAt(c * rr * 0.9999, s * rr * 0.9999, sh).h;
      x = c * rr * rho; z = s * rr * rho;
      y = yE * (1 - k) - 0.085 * Math.sin(k * Math.PI / 2);
      shade = 1 - 0.42 * k;                                        // the lip's underside is in its own shade
    }
    pos.push(x, y, z); uv.push(x * 0.5 + 0.5, z * 0.5 + 0.5); col.push(shade, shade, shade);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);                        // faces up/out
  }
  const g = build(pos, uv, col, idx);
  const n = g.attributes.normal;
  for (let i = 0; i <= NR; i++) {
    const a = i * (COLS + 1), b = a + COLS;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

// Baked over the planar UV: pale chalk scutes, weathered toward their seams, black-brown
// seam cavities, growth lines, an olive film pooled in grooves and down the flanks, crust
// speckle, pitting, sediment dusting the rear. Built once per module lifetime.
let _maps = null;
export function carapaceMaps(S = 1024) {
  if (_maps) return _maps;
  const sh = {};
  const A = canvas2d(S), Rg = canvas2d(S), H = canvas2d(S);
  const ai = A.ctx.createImageData(S, S), ri = Rg.ctx.createImageData(S, S), hi = H.ctx.createImageData(S, S);
  const C0 = [0.80, 0.76, 0.68], C1 = [0.55, 0.50, 0.43], C2 = [0.16, 0.13, 0.10];
  const C3 = [0.34, 0.38, 0.27], C4 = [0.92, 0.90, 0.85], SAND = [0.63, 0.58, 0.49];
  for (let py = 0; py < S; py++) {
    const z = 1 - 2 * (py + 0.5) / S, v = z * 0.5 + 0.5;
    for (let px = 0; px < S; px++) {
      const x = 2 * (px + 0.5) / S - 1, u = x * 0.5 + 0.5, i = (py * S + px) * 4;
      shellAt(x, z, sh);
      const tone = 0.90 + 0.10 * ((sh.id * 0.618034) % 1);
      const seam = 1 - sst(0.0, 0.022, sh.d), wear = 1 - sst(0.02, 0.13, sh.d);
      const mott = fbm(u * 2.0, v * 2.0, 1, 5);
      const film = sst(0.52, 0.70, fbm(u * 1.3 + 0.37, v * 1.3 + 0.11, 0, 4)) * (0.35 + 0.65 * sst(0.45, 1.0, sh.rho));
      const crust = sst(0.70, 0.76, fbm(u * 6.0, v * 6.0, 2, 6));
      const pits = sst(0.66, 0.72, fbm(u * 11 + 0.5, v * 11 + 0.5, 3, 6));
      const rings = 0.5 + 0.5 * Math.sin(sh.f1 * 150 + mott * 3);
      for (let k = 0; k < 3; k++) {
        let cv = C0[k] * tone;
        cv += (C1[k] - cv) * wear * 0.75;
        cv *= 0.86 + 0.26 * mott - 0.05 * rings * (1 - wear);
        cv += (C3[k] - cv) * film * (0.45 + 0.4 * seam);
        cv += (C4[k] - cv) * crust * 0.55;
        cv += (SAND[k] - cv) * 0.28 * sst(-0.15, -0.85, z);
        cv += (C2[k] - cv) * seam * 0.92;
        cv *= 1 - 0.35 * pits;
        ai.data[i + k] = Math.max(0, Math.min(255, cv * 255));
      }
      ai.data[i + 3] = 255;
      const rough = Math.min(1, 0.78 + 0.16 * seam + 0.10 * film + 0.08 * crust - 0.14 * sst(0.30, 0.45, sh.h) * (1 - film));
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rough * 255; ri.data[i + 3] = 255;
      const ht = 0.5 + 0.30 * sst(0.02, 0.16, sh.d) - 0.45 * seam + 0.06 * rings * (1 - wear)
        + 0.10 * crust - 0.22 * pits + 0.08 * (mott - 0.5);
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = Math.max(0, Math.min(255, ht * 255)); hi.data[i + 3] = 255;
    }
  }
  A.ctx.putImageData(ai, 0, 0); Rg.ctx.putImageData(ri, 0, 0); H.ctx.putImageData(hi, 0, 0);
  _maps = {
    map: toTexture(A.canvas, 1, true),
    roughnessMap: toTexture(Rg.canvas),
    normalMap: toTexture(normalFromHeight(H.canvas, 2.2))
  };
  for (const k in _maps) _maps[k].wrapS = _maps[k].wrapT = THREE.ClampToEdgeWrapping;
  return _maps;
}

// ---- belly + brood apron -------------------------------------------------------------
export function bellyGeo(COLS = 128, ROWS = 28) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= ROWS; i++) for (let j = 0; j <= COLS; j++) {
    const th = (j % COLS) / COLS * TAU, rho = 0.002 + 0.998 * i / ROWS, rr = rimR(th) * 0.80;
    const x = Math.cos(th) * rr * rho, z = Math.sin(th) * rr * rho;
    let y = -0.075 - 0.035 * (1 - rho * rho);
    for (const zk of [0.40, 0.18, -0.04, -0.26]) y += 0.010 * gauss(z - zk, 0.018) * (1 - rho);   // sternite sutures
    y += 0.008 * gauss(x, 0.02) * (1 - rho);                                                     // median suture
    pos.push(x, y, z); uv.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    const c = 0.62 + 0.10 * rho; col.push(c, c * 0.97, c * 0.92);
  }
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);                        // faces down
  }
  const belly = build(pos, uv, col, idx);
  // The brood apron: the broad rounded flap folded under the rear that a brooding crab
  // carries her clutch beneath. Three segment sutures across it.
  const S = 24, T = 16, ap = [], au = [], ac = [], ai = [];
  for (let i = 0; i <= S; i++) for (let j = 0; j <= T; j++) {
    const s = i / S, t = j / T * 2 - 1;
    const z = -0.58 + 0.66 * s;
    const w = 0.36 * Math.pow(Math.sin(Math.PI * (0.15 + 0.85 * s)), 0.5) * (1 - 0.35 * s);
    const x = t * w;
    let y = -0.108 - 0.022 * (1 - t * t);
    for (const sk of [0.28, 0.52, 0.74]) y += 0.006 * gauss(s - sk, 0.02);
    ap.push(x, y, z); au.push(x * 0.5 + 0.5, z * 0.5 + 0.5); ac.push(0.70, 0.67, 0.63);
  }
  for (let i = 0; i < S; i++) for (let j = 0; j < T; j++) {
    const a = i * (T + 1) + j, b = a + T + 1;
    ai.push(a, a + 1, b, b, a + 1, b + 1);                         // faces down
  }
  return mergeGeometries([belly, build(ap, au, ac, ai)]);
}

// ---- limbs ---------------------------------------------------------------------------
// A unit-length exoskeleton segment along +X (0 = proximal joint, 1 = distal). Section
// tall in Y, thin in Z (crab legs are flattened fore-aft), a neck at the socket, condyles
// flaring at the distal joint, a dorsal carina, optional raked spines along the top.
// Vertex colour darkens into both joints; a `tip` segment tapers to a hooked, dark point.
export function segmentGeo({ r0, r1, flat = 0.58, spines = 0, rows = 26, radial = 18, tip = false, curl = 0 }) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows;
    let r;
    if (tip) r = r0 * Math.pow(1 - s, 0.75) + 0.002;
    else {
      r = r0 + (r1 - r0) * s;
      r *= 1 - 0.16 * gauss(s - 0.04, 0.05);
      r *= 1 + 0.20 * gauss(s - 0.95, 0.06);
      r *= 1 + 0.04 * Math.sin(s * Math.PI);
    }
    const cy = -curl * s * s;
    const dark = tip ? 1 - 0.78 * sst(0.35, 1.0, s) : 1 - 0.35 * (gauss(s, 0.05) + gauss(s - 1, 0.05));
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const keel = 1 + 0.10 * Math.pow(Math.max(0, ca), 8);
      pos.push(s, cy + ca * r * keel, sa * r * flat);
      uv.push(s, j / radial);
      const c = dark * (0.92 + 0.08 * ca);
      col.push(c, c * 0.96, c * 0.90);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  let g = build(pos, uv, col, idx);
  if (spines) {
    const parts = [g];
    for (let k = 0; k < spines; k++) {
      const s = 0.14 + 0.72 * (k + 0.5) / spines, r = r0 + (r1 - r0) * s;
      const cone = new THREE.ConeGeometry(r * 0.22, r * 0.9, 5);
      cone.translate(0, r * 0.45, 0);
      cone.rotateZ(-0.6);                                          // raked toward the distal end
      cone.translate(s, r * 1.02, 0);
      parts.push(withColor(cone, 0.55, 0.52, 0.47));
    }
    g = mergeGeometries(parts);
  }
  return g;
}

// A curved finger along +X from its hinge, hooking by `curve` (+ up, - down), tapering to
// a dark point. Teeth on the biting edge (`bite` +1 = +Y, -1 = -Y): 'molar' is three
// rounded crushing tubercles, 'saw' nine raked cutting teeth.
export function hornGeo({ len, r0, curve, flat = 0.7, bite = -1, teeth = 'saw', rows = 22, radial = 14 }) {
  const pos = [], uv = [], col = [], idx = [];
  const C = s => [len * s, curve * len * s * s];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, [cx, cy] = C(s);
    const tx = len, ty = 2 * curve * len * s, tl = Math.hypot(tx, ty), nx = -ty / tl, ny = tx / tl;
    const r = r0 * Math.pow(1 - s, 0.8) + 0.002, dark = 1 - 0.82 * sst(0.35, 1, s);
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(cx + nx * ca * r, cy + ny * ca * r, sa * r * flat);
      uv.push(s, j / radial);
      col.push(dark, dark * 0.93, dark * 0.86);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const parts = [build(pos, uv, col, idx)];
  const at = teeth === 'molar' ? [0.25, 0.50, 0.72] : Array.from({ length: 9 }, (_, k) => 0.10 + 0.08 * k);
  for (const s of at) {
    const [cx, cy] = C(s), r = r0 * Math.pow(1 - s, 0.8) + 0.002;
    let t;
    if (teeth === 'molar') {
      t = new THREE.SphereGeometry(r * 0.55, 10, 8);
      t.scale(1.3, 0.8, 0.9);
    } else {
      t = new THREE.ConeGeometry(r * 0.30, r * 0.95, 5);
      t.translate(0, r * 0.47, 0);
      t.rotateZ(-0.5);
      if (bite < 0) t.rotateX(Math.PI);
    }
    t.translate(cx, cy + bite * r * 0.92, 0);
    parts.push(withColor(t, 0.30, 0.27, 0.24));
  }
  return mergeGeometries(parts);
}

// The claw's hand: a flattened, swollen palm along +X with the fixed finger (pollex)
// growing from its lower distal corner. userData.hinge is where the moving finger pivots.
export function palmGeo(kind) {
  const crusher = kind === 'crusher';
  const len = crusher ? 0.62 : 0.74, hgt = crusher ? 0.36 : 0.22, wid = crusher ? 0.62 : 0.60;
  const rows = 30, radial = 22, pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, prof = Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * s)), 0.55);
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      // granular tubercles on the crusher's outer face; the cutter is smooth and keeled
      const gr = crusher ? 1 + 0.04 * sst(0.58, 0.74, fbm(s * 3, j / radial * 3, 2, 5)) : 1 + 0.06 * Math.pow(Math.max(0, ca), 10);
      const r = hgt * 0.5 * prof * gr;
      pos.push(s * len, ca * r, sa * r * wid);
      uv.push(s, j / radial);
      const c = 0.90 + 0.08 * ca;
      col.push(c, c * 0.97, c * 0.92);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const pollex = hornGeo({ len: crusher ? 0.30 : 0.44, r0: hgt * 0.28, curve: 0.12, bite: 1, teeth: crusher ? 'molar' : 'saw' });
  pollex.translate(len * 0.88, -hgt * 0.17, 0);
  const g = mergeGeometries([build(pos, uv, col, idx), pollex]);
  g.userData.hinge = [len * 0.90, hgt * 0.20, 0];
  g.userData.len = len;
  return g;
}

// ---- crust ---------------------------------------------------------------------------
// An acorn barnacle: a fluted volcano of six wall plates around a closed operculum.
export function barnacleGeo() {
  const P = [[0.050, 0], [0.053, 0.008], [0.046, 0.024], [0.033, 0.044], [0.022, 0.056],
    [0.017, 0.054], [0.012, 0.044], [0.004, 0.036], [0.0, 0.035]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(P, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), f = 1 + 0.10 * Math.cos(Math.atan2(z, x) * 6);
    p.setX(i, x * f); p.setZ(i, z * f);
  }
  g.computeVertexNormals();
  return g;
}

const _up = new THREE.Vector3(0, 1, 0), _nn = new THREE.Vector3(), _qq = new THREE.Quaternion(), _qt = new THREE.Quaternion();
const _pp = new THREE.Vector3(), _ss = new THREE.Vector3();
// Barnacles colonise the upper shell in patches, thickest toward the rim and the rear.
export function barnacleMatrices(n, seed) {
  const rnd = seededRand(seed), sh = {}, m = [], c = [];
  let guard = 0;
  while (m.length < n && guard++ < n * 60) {
    const x = rnd() * 2 - 1, z = rnd() * 2 - 1;
    shellAt(x, z, sh);
    if (sh.rho > 0.97 || sh.rho < 0.25) continue;
    const want = sst(0.40, 0.62, fbm(x * 0.9 + 0.5, z * 0.9 + 0.5, 0, 3)) * (0.35 + 0.65 * sst(0.4, 0.95, sh.rho)) * (z < 0 ? 1 : 0.6);
    if (rnd() > want) continue;
    shellNormal(x, z, _nn);
    _qq.setFromUnitVectors(_up, _nn).multiply(_qt.setFromAxisAngle(_up, rnd() * TAU));
    const k = 0.5 + 1.3 * Math.pow(rnd(), 1.6);
    m.push(new THREE.Matrix4().compose(_pp.set(x, sh.h - 0.004, z), _qq, _ss.set(k, k * (0.8 + 0.4 * rnd()), k)));
    const t = 0.84 + 0.14 * rnd();
    c.push(new THREE.Color(t, t * 0.98, t * 0.93));
  }
  return { m, c };
}

// Weed tufts: the rear margin and the flank edges, leaning outward.
export function weedMatrices(n, seed) {
  const rnd = seededRand(seed), sh = {}, m = [];
  let guard = 0;
  while (m.length < n && guard++ < n * 60) {
    const th = rnd() * TAU, rho = 0.80 + 0.17 * rnd();
    if (Math.sin(th) > 0.25 && rnd() > 0.2) continue;
    const rr = rimR(th), x = Math.cos(th) * rr * rho, z = Math.sin(th) * rr * rho;
    shellAt(x, z, sh);
    shellNormal(x, z, _nn);
    _nn.x += Math.cos(th) * 0.5; _nn.z += Math.sin(th) * 0.5; _nn.normalize();
    _qq.setFromUnitVectors(_up, _nn).multiply(_qt.setFromAxisAngle(_up, rnd() * TAU));
    const k = 0.6 + 0.9 * rnd();
    m.push(new THREE.Matrix4().compose(_pp.set(x, sh.h - 0.003, z), _qq, _ss.set(k, k, k)));
  }
  return m;
}

let _grain = null;
export function limbGrain() {
  if (_grain) return _grain;
  _grain = toTexture(normalFromHeight(noiseCanvas(256, 5, 1.3, seededRand(0x6A1F00D5)), 3));
  _grain.repeat.set(6, 2);
  return _grain;
}
```

- [ ] **Step 3: Probe the geometry**

```js
const G = await import('/src/entities/sleeper/brooderGeo.js?' + Date.now());
const cg = G.carapaceGeo(), bg = G.bellyGeo(), sh = {};
const n = cg.attributes.normal, mid = Math.floor(cg.attributes.position.count / 2);
cg.computeBoundingBox(); bg.computeBoundingBox();
const nan = a => a.some(v => !Number.isFinite(v));
const t0 = performance.now(); G.carapaceMaps(); const mapsMs = performance.now() - t0;
({
  tris: cg.index.count / 3 + bg.index.count / 3,
  box: cg.boundingBox, crownUp: n.getY(5) > 0.9, bellyDown: (() => { bg.computeVertexNormals(); return bg.attributes.normal.getY(3) < -0.5; })(),
  nan: nan(Array.from(cg.attributes.position.array)) || nan(Array.from(bg.attributes.position.array)),
  crownH: G.shellAt(0, 0, sh).h, rimH: G.shellAt(0.999, 0, sh).h,
  seg: G.segmentGeo({ r0: 0.07, r1: 0.055, spines: 5 }).attributes.position.count,
  palm: G.palmGeo('crusher').userData, barn: G.barnacleMatrices(220, 7).m.length, weed: G.weedMatrices(150, 9).length,
  mapsMs: Math.round(mapsMs)
})
```

Expected: `tris` about 57k; box x within ±1.06, y from about -0.09 to 0.47, z within about -0.9..0.85; `crownUp` true; `bellyDown` true; `nan` false; `crownH` ~0.43; `rimH` < 0.01; `palm.hinge` a 3-array; `barn` 220; `weed` 150; `mapsMs` under 900. If `crownUp` or `bellyDown` is false the winding comment is wrong: swap the two middle indices of each triangle in that builder.

- [ ] **Step 4: Commit**

```bash
git add src/entities/sleeper/brooderGeo.js
git commit -m "brooder: carapace, belly/apron, limb, claw and crust geometry + baked shell maps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Brooder — build, gait, rig, wards

**Files:**
- Modify: `src/entities/sleeper/common.js` (append ward helpers and `makeEmbers`)
- Rewrite: `src/entities/sleeper/brooder.js`

**Interfaces:**
- Consumes: everything in Task 4; `common.js` exports from Task 2.
- Produces:
  - `common.js`: `makeWard(L, i, scale) -> ward`, `wardIdle(g, dt, haloK)`, `wardLitPose(g, dt, scale, haloK)`, `wardTouch(L, i, g, player, ev) -> bool`, `wardFlashes(L, dt, fx?)`, `makeEmbers(L, size)`.
  - `brooder.js`: `makeBrooder(idx, cfg) -> L`, `updateBrooder(L, dt, t, player) -> ev`. `L.cmd(name, arg)` with `stand`, `settle`, `walk` (arg Vector3), `rear` (toggle), `place` (arg `{ pos, yaw }`). `L.probe() -> { kind, stand, threat, yaw, pos, bodyY, swinging, walking, wards, tris }`. `L.collR`, `L.R`, `L.head`, `L.spine` (9 collision centres), `L.keepTex`.

- [ ] **Step 1: Failing probe**

```js
window.__lev.swap('brooder'); window.__lev.state()
```

Expected: the stub builds a serpent, so `state()` returns `{ kind: 'brooder', calmed: false }` with no `stand` field.

- [ ] **Step 2: Append the ward helpers to `common.js`**

```js

// ---- wards, for kinds that place them in their own frame ---------------------------
// (The serpent keeps its original inline ward code; these are the same visuals and the
// same touch rule, factored for the kinds that followed.)
const _wq = new THREE.Vector3();
export function makeWard(L, i, scale) {
  const ringGeo = new THREE.TorusGeometry(0.62, 0.11, 6, 18);
  const boltGeo = new THREE.ConeGeometry(0.10, 0.42, 5);
  boltGeo.translate(0, 0.21, 0);
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x241d16, roughness: 0.42, metalness: 0.85, envMap: envTex, envMapIntensity: 1.1 });
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.9, metalness: 0.2 });
  const sg = new THREE.Group();
  sg.scale.setScalar(scale);
  sg.add(new THREE.Mesh(ringGeo, ironMat));
  const socket = new THREE.Mesh(new THREE.CircleGeometry(0.60, 16), socketMat);
  socket.position.z = -0.05;
  sg.add(socket);
  const bolts = new THREE.InstancedMesh(boltGeo, ironMat, 6);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (let b = 0; b < 6; b++) {
    const a = b / 6 * 6.2832;
    p.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.04);
    q.setFromUnitVectors(_wq.set(0, 1, 0), p.clone().setZ(0).normalize().multiplyScalar(0.45).setZ(1).normalize());
    bolts.setMatrixAt(b, m.compose(p, q, s));
  }
  bolts.instanceMatrix.needsUpdate = true;
  sg.add(bolts);
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), new THREE.MeshBasicMaterial({
    map: runeTex(L.idx * 17 + i * 7), color: 0xffe8a8, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  rune.position.z = 0.08;
  sg.add(rune);
  const light = sigilPool[i - 1];
  light.intensity = 0;
  const halo = makeGlow(0xffe8a8, 0);
  L.grp.add(halo, sg);
  return { lit: false, grp: sg, mesh: sg, rune, light, halo, pulse: Math.random() * 7, flashT: 9, rev: 1, note: 352 + i * 40, scale };
}
export function wardIdle(g, dt, haloK) {
  g.pulse += dt;
  const rv = g.rev;
  g.rune.material.opacity = (0.22 + 0.16 * Math.sin(g.pulse * 2)) * rv;
  g.light.intensity = (8 + 5 * Math.sin(g.pulse * 2)) * rv;
  g.halo.scale.setScalar(Math.max(0.001, (haloK * 1.2 + Math.sin(g.pulse * 2) * 0.6) * rv));
  g.light.position.copy(g.grp.position);
  g.halo.position.copy(g.grp.position);
}
export function wardLitPose(g, dt, haloK) {
  g.pulse += dt;
  g.rune.material.opacity = 1;
  g.grp.scale.setScalar(g.scale * (1 + 0.04 * Math.sin(g.pulse * 3)));
  g.light.intensity = 140 + 40 * Math.sin(g.pulse * 3);
  g.halo.scale.setScalar(haloK * 3);
  g.light.position.copy(g.grp.position);
  g.halo.position.copy(g.grp.position);
}
// The touch: a swept test from last frame's diver position, so a hitch or a fast pass
// can't tunnel through a ward. The zone-1 dark rule and zone-2 keeper rule apply to any
// kind that sets sonarWards / guardWards. Returns true on the frame the ward lights.
export function wardTouch(L, i, g, player, ev) {
  if (segDist(g.grp.position, L.pPrev, player.pos) >= L.reach) return false;
  const dark = L.sonarWards && g.rev < 0.5;
  const kept = L.guardWards && wardGuardCount(i) > 0;
  if (dark || kept) {
    if (!L.hinted) { L.hinted = true; ev.msg = ev.msg || (dark ? MSG_WARDS_DARK : MSG_WARDS_KEPT); }
    return false;
  }
  g.lit = true; g.rev = 1; g.flashT = 0;
  L.flare = 1;
  burstEmbers(L, g.grp.position);
  ev.sigilLit = g.note;
  L.agitation = 1;
  return true;
}
// The ward-lighting flash: ~1.5 s of extra light on the borrowed PointLight (and the
// hide ring, for kinds with a uniform array to drive).
export function wardFlashes(L, dt, fx) {
  for (let i = 0; i < L.sigils.length; i++) {
    const g = L.sigils[i], f = fx ? fx[i] : null;
    if (g.flashT >= 1.5) { if (f) f.y = 0; continue; }
    g.flashT += dt;
    const k = Math.min(1, g.flashT / 1.5);
    if (f) { f.x = 0.62 * Math.pow(k, 0.65); f.y = 3.4 * (1 - k) * (1 - k) * THREE.MathUtils.smoothstep(k, 0, 0.06); }
    g.light.intensity += 360 * (1 - k) * (1 - k) * (1 - k);
  }
  updateEmbers(L, dt);
}
// The ember burst pool, idle at zero cost (mesh hidden, no integration).
export function makeEmbers(L, size) {
  const EM = 96;
  const emPos = new Float32Array(EM * 3), emLife = new Float32Array(EM), emSz = new Float32Array(EM);
  const emVel = new Float32Array(EM * 3);
  const emGeo = new THREE.BufferGeometry();
  emGeo.setAttribute('position', new THREE.BufferAttribute(emPos, 3));
  emGeo.setAttribute('aLife', new THREE.BufferAttribute(emLife, 1));
  emGeo.setAttribute('aSize', new THREE.BufferAttribute(emSz, 1));
  emGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const emMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: glowTex }, uPS: { value: size * 170 } },
    vertexShader: /* glsl */`
      attribute float aLife, aSize;
      uniform float uPS;
      varying float vL;
      void main(){
        vL = aLife;
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = aSize*uPS/max(-mv.z, 0.5);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      varying float vL;
      void main(){
        if (vL <= 0.0) discard;
        float a = texture2D(uTex, gl_PointCoord).a;
        vec3 col = mix(vec3(1.0,0.42,0.12), vec3(1.0,0.94,0.78), vL);
        gl_FragColor = vec4(col, a*vL*(0.35+0.65*vL)*1.25);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  L.embers = new THREE.Points(emGeo, emMat);
  L.embers.frustumCulled = false;
  L.embers.visible = false;
  L.em = { pos: emPos, vel: emVel, life: emLife, sz: emSz, cap: EM, head: 0, alive: 0 };
  L.grp.add(L.embers);
}
```

- [ ] **Step 3: Write `brooder.js`**

<!-- write: src/entities/sleeper/brooder.js -->
```js
// THE BROODER — Velkath, zone 0's sleeper (roadmap/three-sleepers.md, spec §2).
// A plated crab-colossus: a domed carapace ~28 u across, eight rigid-jointed walking
// legs on planted-foot IK, a crusher and a cutter claw, eyes on stalks that fold into
// their orbits while she sleeps. Her wards are on the UNDERSIDE. Settled, the belly is
// in the sand and the wards sit below the terrain, so nothing needs a rule to keep them
// out of reach: standing up is what exposes them.
//
// Frames: the body group (L.body) is in shell units (carapace half-width = 1) and scaled
// by L.R; every rig computation below is in that local space. The wards, their halos
// and the embers live on L.grp at the world origin (the ward light pool is placed in
// world coordinates, exactly as the serpent does).
//
// This file is the body and its motion. The ridge/nest/egg reveal, the fight and the
// payoff come in the next plan; until then the lab drives her through L.cmd().
import * as THREE from 'three';
import { scene, envTexDeep as envTex } from '../../core.js';
import { V3, clamp, lerp } from '../../lib/math.js';
import { makeGlow } from '../../lib/textures.js';
import { registerPaint } from '../../lib/paint.js';
import { terrainH } from '../../world/terrain.js';
import { setWardTargets } from '../../world/predators.js';
import {
  setLive, SIGIL_POOL_N, ensureSigilPool, makeWard, wardIdle, wardLitPose, wardTouch, wardFlashes, makeEmbers
} from './common.js';
import * as G from './brooderGeo.js';

const UP = V3(0, 1, 0);
const smooth = THREE.MathUtils.smoothstep;
const R_OF_SIZE = 2.55;                    // carapace half-width in cfg.size units (5.5 -> 14 u)
// Walking legs, per side front to back: hip on the lip, rest-foot bearing off the side
// (+ toward the front), length scale (the middle pairs are the longest, as in crabs).
const LEGS = [
  { hip: [0.80, -0.07, 0.36], splay: 0.42, k: 0.92 },
  { hip: [0.86, -0.07, 0.10], splay: 0.12, k: 1.00 },
  { hip: [0.84, -0.07, -0.16], splay: -0.16, k: 1.00 },
  { hip: [0.74, -0.07, -0.42], splay: -0.46, k: 0.88 }
];
const SEG = { coxa: 0.14, femur: 0.95, tibia: 0.90, dactyl: 0.45 };
// Ward sockets on the underside, local position and outward normal. The first nSigils
// are used: mouth, both hips, then two more for chart rows that ask for them.
const SOCKETS = [
  { p: [0, -0.125, 0.56], n: [0, -0.94, 0.34] },
  { p: [0.52, -0.105, -0.06], n: [0.18, -0.98, 0] },
  { p: [-0.52, -0.105, -0.06], n: [-0.18, -0.98, 0] },
  { p: [0, -0.135, -0.36], n: [0, -1, 0] },
  { p: [0, -0.118, 0.18], n: [0, -1, 0] }
];
// Collision centres: the crown and a ring of eight over the shell, sized so the spheres
// stop at the belly and a diver can pass UNDER her when she stands.
const COLL = [[0, 0.17, 0]];
for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; COLL.push([Math.cos(a) * 0.55, 0.15, Math.sin(a) * 0.50]); }
const STRIDE = 0.30, SWING_T = 0.55, RISE_T = 6, SETTLE_T = 4;

// Scratch (never allocated per frame).
const _hip = V3(), _d = V3(), _pn = V3(), _j1 = V3(), _ank = V3(), _ank2 = V3(), _knee = V3(), _ft = V3(), _v = V3();
const _x = V3(), _y = V3(), _z = V3(), _sc = V3(), _r = V3(), _rw = V3(), _lp = V3(), _pl = V3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qs = new THREE.Quaternion();

export function makeBrooder(idx, cfg) {
  let c = cfg;
  if (c.nSigils > SIGIL_POOL_N) c = Object.assign({}, c, { nSigils: SIGIL_POOL_N });
  ensureSigilPool();
  const R = c.size * R_OF_SIZE;
  const grp = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(R);
  body.rotation.order = 'YXZ';
  grp.add(body);

  const L = {
    ...c, idx, R, size: c.size, grp, body, t: 0, agitation: 0, calmed: false, calmT: 0,
    sonarWards: false, guardWards: false, reveal: 0, rang: false, hinted: false, pendingMsg: null,
    reach: 5, collR: 0.33 * R, flare: 0,
    pos: V3(), yaw: 0, vel: V3(), stand: 0, standE: 0, standTarget: 0, threat: 0, threatE: 0, threatTarget: 0,
    walkTo: null, bodyY: 0, head: V3(), spine: COLL.map(() => V3()), sigils: [], feet: [], _pd: 1e9,
    uni: { uTime: { value: 0 } }
  };

  // ---- materials ----
  const maps = G.carapaceMaps();
  const grain = G.limbGrain();
  L.keepTex = new Set([maps.map, maps.normalMap, maps.roughnessMap, grain]);
  const shellMat = registerPaint(new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 0, vertexColors: true,
    envMap: envTex, envMapIntensity: 0.35
  }));
  const limbMat = registerPaint(new THREE.MeshStandardMaterial({
    color: 0xc2b7a2, roughness: 0.74, metalness: 0, vertexColors: true,
    normalMap: grain, normalScale: new THREE.Vector2(0.6, 0.6), envMap: envTex, envMapIntensity: 0.3
  }));
  const bellyMat = registerPaint(new THREE.MeshStandardMaterial({
    color: 0xd6ccb8, roughness: 0.82, metalness: 0, vertexColors: true,
    normalMap: grain, normalScale: new THREE.Vector2(0.4, 0.4), envMap: envTex, envMapIntensity: 0.25
  }));

  // ---- shell ----
  const shell = new THREE.Mesh(G.carapaceGeo(), shellMat);
  shell.castShadow = shell.receiveShadow = true;
  body.add(shell);
  const belly = new THREE.Mesh(G.bellyGeo(), bellyMat);
  belly.castShadow = belly.receiveShadow = true;
  body.add(belly);

  // ---- crust: barnacles and weed ----
  const bar = G.barnacleMatrices(220, 0xBA2AC1E5 + idx);
  const barnMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xdcd6c8, roughness: 0.86, metalness: 0, side: THREE.DoubleSide, envMap: envTex, envMapIntensity: 0.25 }));
  const barn = new THREE.InstancedMesh(G.barnacleGeo(), barnMat, bar.m.length);
  bar.m.forEach((m, i) => { barn.setMatrixAt(i, m); barn.setColorAt(i, bar.c[i]); });
  barn.instanceMatrix.needsUpdate = true;
  if (barn.instanceColor) barn.instanceColor.needsUpdate = true;
  barn.castShadow = true;
  body.add(barn);

  const weedGeo = new THREE.PlaneGeometry(0.014, 0.14, 1, 6);
  weedGeo.translate(0, 0.07, 0);
  const weedMat = new THREE.MeshStandardMaterial({ color: 0x55603c, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  weedMat.customProgramCacheKey = () => 'abyssa-brooder-weed';
  weedMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = L.uni.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        float wh = clamp(position.y / 0.14, 0.0, 1.0);
        float wi = float(gl_InstanceID);
        transformed.x += sin(uTime * 1.4 + wi * 1.7 + wh * 2.0) * 0.030 * wh * wh;
        transformed.z += cos(uTime * 1.1 + wi * 2.3) * 0.020 * wh * wh;`);
  };
  const wm = G.weedMatrices(150, 0x77EED + idx);
  const weed = new THREE.InstancedMesh(weedGeo, weedMat, wm.length);
  wm.forEach((m, i) => weed.setMatrixAt(i, m));
  weed.instanceMatrix.needsUpdate = true;
  body.add(weed);

  // ---- walking legs: one InstancedMesh per segment type, eight instances each ----
  const legs = {
    coxa: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.078, r1: 0.072, rows: 8, radial: 16 }), limbMat, 8),
    femur: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.070, r1: 0.055, spines: 6 }), limbMat, 8),
    tibia: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.050, r1: 0.036, spines: 4 }), limbMat, 8),
    dactyl: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.034, r1: 0, tip: true, curl: 0.10, rows: 20, radial: 12 }), limbMat, 8)
  };
  for (const k in legs) {
    legs[k].frustumCulled = false;                 // instance bounds go stale as she walks
    legs[k].castShadow = true;
    legs[k].instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    body.add(legs[k]);
  }
  L.legs = legs;
  for (let li = 0; li < 8; li++) {
    const sd = li < 4 ? 1 : -1, k = li & 3;
    L.feet.push({ planted: V3(), from: V3(), to: V3(), cur: V3(), t: -1, group: (k + (sd > 0 ? 0 : 1)) & 1 });
  }

  // ---- claws: crusher on the -X side, cutter on +X ----
  L.claws = [buildClaw(body, limbMat, -1, 'crusher'), buildClaw(body, limbMat, 1, 'cutter')];

  // ---- eyes on stalks, antennules, mouthparts ----
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x06080a, roughness: 0.08, metalness: 0.25, envMap: envTex, envMapIntensity: 1.4 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x8ff4ff, transparent: true, opacity: 0 });
  L.eyes = [];
  for (const sd of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(0.21 * sd, 0.04, 0.76);
    piv.rotation.order = 'YXZ';
    const stalk = new THREE.Mesh(G.segmentGeo({ r0: 0.030, r1: 0.024, rows: 10, radial: 12 }), limbMat);
    stalk.scale.set(0.15, 1, 1);
    stalk.rotation.z = Math.PI / 2;                // +X segment axis -> +Y
    piv.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.048, 18, 14), eyeMat);
    eye.position.y = 0.16;
    piv.add(eye);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), pupilMat);
    pupil.position.set(0, 0.16, 0.049);
    piv.add(pupil);
    const halo = makeGlow(0x8ff4ff, 0.001);
    halo.position.set(0, 0.16, 0.05);
    piv.add(halo);
    body.add(piv);
    L.eyes.push({ piv, halo, sd });
  }
  L.pupilMat = pupilMat;
  L.antennae = [];
  for (const sd of [-1, 1]) {
    const a = new THREE.Mesh(G.segmentGeo({ r0: 0.010, r1: 0, tip: true, curl: -0.15, rows: 12, radial: 6 }), limbMat);
    a.scale.set(0.16, 1, 1);
    a.position.set(0.05 * sd, 0.03, 0.80);
    a.rotation.set(0, -Math.PI / 2 + sd * 0.25, 0.5, 'YZX');
    body.add(a);
    L.antennae.push({ mesh: a, sd });
  }
  L.mouth = [];
  for (const sd of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), limbMat);
    pl.scale.set(0.07, 0.014, 0.11);
    const hinge = new THREE.Group();
    hinge.position.set(0.065 * sd, -0.065, 0.74);
    pl.position.z = -0.10;
    hinge.add(pl);
    body.add(hinge);
    L.mouth.push({ hinge, sd });
  }

  // ---- wards ----
  const wardScale = 4.2;
  for (let i = 1; i <= c.nSigils; i++) {
    const w = makeWard(L, i, wardScale);
    const s = SOCKETS[i - 1];
    w.local = V3(s.p[0], s.p[1], s.p[2]);
    w.q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(s.n[0], s.n[1], s.n[2]).normalize());
    L.sigils.push(w);
  }
  makeEmbers(L, c.size);

  // Set down somewhere in the zone, asleep. The lab and (later) the ridge move her.
  placeAt(L, V3((Math.random() - 0.5) * 120, 0, (Math.random() - 0.5) * 120), Math.random() * Math.PI * 2);

  L.cmd = (name, arg) => {
    if (name === 'stand') L.standTarget = 1;
    else if (name === 'settle') { L.standTarget = 0; L.walkTo = null; }
    else if (name === 'walk') { L.walkTo = arg ? arg.clone() : null; L.standTarget = 1; }
    else if (name === 'rear') L.threatTarget = L.threatTarget > 0.5 ? 0 : 1;
    else if (name === 'place') placeAt(L, arg.pos, arg.yaw);
    return L.probe();
  };
  L.probe = () => ({
    kind: 'brooder', stand: L.stand, threat: L.threat, yaw: L.yaw, pos: L.pos.toArray(), bodyY: L.bodyY,
    swinging: L.feet.filter(f => f.t >= 0).length, walking: !!L.walkTo, calmed: L.calmed,
    wards: L.sigils.map(g => ({ lit: g.lit, y: +(g.grp.position.y - terrainH(g.grp.position.x, g.grp.position.z, L.idx)).toFixed(2) })),
    tris: countTris(L.body)
  });

  scene.add(grp);
  setLive(L);
  setWardTargets(-1, null);
  poseAll(L, 0, null);
  return L;
}

function countTris(root) {
  let n = 0;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry.index) return;
    n += o.geometry.index.count / 3 * (o.isInstancedMesh ? o.count : 1);
  });
  return n;
}

// A cheliped as a joint chain: root (merus) -> carpus -> palm -> moving finger. Each
// joint is a Group so posing is plain Euler writes (no allocation).
function buildClaw(body, mat, sd, kind) {
  const root = new THREE.Group();
  root.position.set(0.40 * sd, -0.05, 0.62);
  root.rotation.order = 'YZX';
  body.add(root);
  const merus = new THREE.Mesh(G.segmentGeo({ r0: 0.088, r1: 0.078, spines: 4 }), mat);
  merus.scale.x = 0.62;
  merus.castShadow = true;
  root.add(merus);
  const cj = new THREE.Group();
  cj.position.x = 0.62;
  cj.rotation.order = 'YZX';
  root.add(cj);
  const carpus = new THREE.Mesh(G.segmentGeo({ r0: 0.082, r1: 0.090, spines: 2 }), mat);
  carpus.scale.x = 0.26;
  carpus.castShadow = true;
  cj.add(carpus);
  const pj = new THREE.Group();
  pj.position.x = 0.26;
  pj.rotation.order = 'YZX';
  cj.add(pj);
  const pg = G.palmGeo(kind);
  const palm = new THREE.Mesh(pg, mat);
  palm.castShadow = true;
  pj.add(palm);
  const dj = new THREE.Group();
  dj.position.fromArray(pg.userData.hinge);
  pj.add(dj);
  const crusher = kind === 'crusher';
  const dact = new THREE.Mesh(G.hornGeo({ len: crusher ? 0.32 : 0.46, r0: crusher ? 0.085 : 0.055, curve: -0.12, bite: -1, teeth: crusher ? 'molar' : 'saw' }), mat);
  dact.castShadow = true;
  dj.add(dact);
  return { root, cj, pj, dj, sd, crusher };
}

// Teleport: body to pos (on the ground), heading yaw, feet reset to their rest spots.
function placeAt(L, pos, yaw) {
  L.pos.set(pos.x, 0, pos.z);
  L.yaw = yaw;
  L.vel.set(0, 0, 0);
  for (let li = 0; li < 8; li++) {
    const f = L.feet[li];
    restWorld(L, li, f.planted);
    f.cur.copy(f.planted); f.t = -1;
  }
}

// Rest spot of foot li: local (yaw only) -> world, on the terrain.
function restWorld(L, li, out) {
  const lg = LEGS[li & 3], sd = li < 4 ? 1 : -1, st = L.standE;
  const reach = lerp(1.62, 1.10, st) * lg.k, a = lg.splay * lerp(1.15, 0.85, st);
  const lx = lg.hip[0] * sd + Math.cos(a) * reach * sd, lz = lg.hip[2] + Math.sin(a) * reach;
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
  out.set(L.pos.x + (lx * cy + lz * sy) * L.R, 0, L.pos.z + (-lx * sy + lz * cy) * L.R);
  out.y = terrainH(out.x, out.z, L.idx);
  return out;
}

// Rigid segment a->b in body-local space as an instance matrix: X along the bone, Z the
// leg-plane normal (so the flattened section faces fore-aft), Y the in-plane up.
function segMat(im, i, a, b, pn) {
  _x.subVectors(b, a);
  const len = _x.length() || 1e-4;
  _x.divideScalar(len);
  _z.copy(pn);
  _y.crossVectors(_z, _x).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _m.scale(_sc.set(len, 1, 1));
  _m.setPosition(a);
  im.setMatrixAt(i, _m);
}

// Two-bone IK in the leg's vertical plane, knee UP (the crab silhouette). footL is the
// planted foot in body-local space. If the target is out of reach the tibia still
// points at the ankle and the dactyl at the foot: the foot slides, the leg never tears.
function poseLeg(L, li, footL) {
  const lg = LEGS[li & 3], sd = li < 4 ? 1 : -1, k = lg.k;
  _hip.set(lg.hip[0] * sd, lg.hip[1], lg.hip[2]);
  _d.set(footL.x - _hip.x, 0, footL.z - _hip.z);
  if (_d.lengthSq() < 1e-6) _d.set(sd, 0, 0);
  _d.normalize();
  _pn.crossVectors(_d, UP).normalize();
  _j1.copy(_hip).addScaledVector(_d, SEG.coxa * 0.98).addScaledVector(UP, -SEG.coxa * 0.2);
  _ank.copy(footL).addScaledVector(UP, SEG.dactyl * k * 0.93).addScaledVector(_d, -SEG.dactyl * k * 0.36);
  const l1 = SEG.femur * k, l2 = SEG.tibia * k;
  _v.subVectors(_ank, _j1);
  const qx = _v.x * _d.x + _v.z * _d.z, qy = _v.y;
  const D = clamp(Math.hypot(qx, qy), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const base = Math.atan2(qy, qx);
  const th1 = base + Math.acos(clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1));
  _knee.copy(_j1).addScaledVector(_d, Math.cos(th1) * l1).addScaledVector(UP, Math.sin(th1) * l1);
  segMat(L.legs.coxa, li, _hip, _j1, _pn);
  segMat(L.legs.femur, li, _j1, _knee, _pn);
  _ank2.copy(_knee).addScaledVector(_v.subVectors(_ank, _knee).normalize(), l2);
  segMat(L.legs.tibia, li, _knee, _ank2, _pn);
  _ft.copy(_ank2).addScaledVector(_v.subVectors(footL, _ank2).normalize(), SEG.dactyl * k);
  segMat(L.legs.dactyl, li, _ank2, _ft, _pn);
}

// Claw pose: folded before the mouth (asleep / idle) <-> raised and open (threat).
function poseClaws(L) {
  const th = L.threatE, t = L.t, st = L.standE;
  for (const c of L.claws) {
    const sd = c.sd, low = c.crusher ? -0.45 : -0.25;
    c.root.rotation.set(0, -Math.PI / 2 + sd * lerp(0.35, 0.75, th), lerp(low - 0.25 * (1 - st), 0.70, th));
    c.cj.rotation.set(0, -sd * lerp(1.50, 0.90, th), lerp(-0.05, 0.60, th));
    c.pj.rotation.set(0, -sd * lerp(0.50, 0.15, th), lerp(-0.10, 0.30, th));
    const snap = Math.pow(Math.max(0, Math.sin(t * 0.7 + sd * 1.3)), 8) * 0.10 * st;
    c.dj.rotation.z = 0.04 + snap + 0.55 * th;
  }
}

function poseAll(L, dt, player) {
  const b = L.body, R = L.R, st = L.standE;
  // body on the ground: mean of five samples, pitch/roll from the fore-aft/side slopes
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), o = 0.7 * R;
  const gF = terrainH(L.pos.x + sy * o, L.pos.z + cy * o, L.idx), gB = terrainH(L.pos.x - sy * o, L.pos.z - cy * o, L.idx);
  const gL = terrainH(L.pos.x + cy * o, L.pos.z - sy * o, L.idx), gR = terrainH(L.pos.x - cy * o, L.pos.z + sy * o, L.idx);
  const gC = terrainH(L.pos.x, L.pos.z, L.idx);
  const gy = (gF + gB + gL + gR + gC) / 5;
  L.bodyY = gy + R * (lerp(0.19, 0.95, st) + 0.14 * L.threatE + 0.012 * Math.sin(L.t * 0.45) * (1 - st));
  b.position.set(L.pos.x, L.bodyY, L.pos.z);
  b.rotation.set(-Math.atan2(gF - gB, 2 * o) - 0.32 * L.threatE, L.yaw, Math.atan2(gL - gR, 2 * o));
  b.updateMatrixWorld(true);
  _inv.copy(b.matrixWorld).invert();

  for (let li = 0; li < 8; li++) poseLeg(L, li, _lp.copy(L.feet[li].cur).applyMatrix4(_inv));
  for (const k in L.legs) L.legs[k].instanceMatrix.needsUpdate = true;
  poseClaws(L);

  // eyes: folded into the orbits asleep, up and tracking the diver awake
  const look = player ? _pl.copy(player.pos).applyMatrix4(_inv) : null;
  for (const e of L.eyes) {
    let yawL = 0, pitchL = 0;
    if (look) {
      const dx = look.x - e.piv.position.x, dz = look.z - e.piv.position.z, dy = look.y - e.piv.position.y;
      yawL = clamp(Math.atan2(dx, dz), -1.1, 1.1);
      pitchL = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.5, 0.6);
    }
    e.piv.rotation.set(lerp(1.35, 0.25, st) - pitchL * st, yawL * st, e.sd * 0.12);
    e.halo.material.opacity = 0.35 * st;
    e.halo.scale.setScalar(0.001 + 0.10 * st);
  }
  L.pupilMat.opacity = 0.25 + 0.55 * st;
  for (const a of L.antennae) a.mesh.rotation.z = 0.5 + 0.18 * Math.sin(L.t * 3.1 + a.sd) * (0.3 + st);
  for (const m of L.mouth) m.hinge.rotation.x = 0.10 + 0.08 * Math.sin(L.t * 5.3 + m.sd * 1.9) * (0.4 + st);

  // wards, collision centres, head
  for (const g of L.sigils) {
    g.grp.position.copy(g.local).applyMatrix4(b.matrixWorld);
    b.getWorldQuaternion(_q);
    g.grp.quaternion.copy(_q).multiply(g.q);
  }
  for (let k = 0; k < COLL.length; k++) L.spine[k].set(COLL[k][0], COLL[k][1], COLL[k][2]).applyMatrix4(b.matrixWorld);
  L.head.set(0, 0.10, 0.80).applyMatrix4(b.matrixWorld);
}

export function updateBrooder(L, dt, t, player) {
  const ev = { sigilLit: 0, calmed: false, lightDrain: 0, slam: false, remaining: 0, msg: null };
  if (L.pendingMsg) { ev.msg = L.pendingMsg; L.pendingMsg = null; }
  if (!L.pPrev) L.pPrev = player.pos.clone();
  L.t += dt;
  L.uni.uTime.value = L.t;

  // ---- stand / threat easing: she takes ~6 s to rise and ~4 s to settle ----
  const rate = L.standTarget > L.stand ? 1 / RISE_T : 1 / SETTLE_T;
  L.stand += clamp(L.standTarget - L.stand, -rate * dt, rate * dt);
  L.standE = smooth(L.stand, 0, 1);
  L.threat += clamp(L.threatTarget - L.threat, -1.5 * dt, 1.5 * dt);
  L.threatE = smooth(L.threat, 0, 1) * L.standE;

  // ---- heading and locomotion ----
  let pd = 1e9;
  for (const s of L.spine) { const d = s.distanceTo(player.pos); if (d < pd) pd = d; }
  L._pd = pd;
  let want = null, speed = 0;
  if (L.walkTo && L.standE > 0.9) {
    const dx = L.walkTo.x - L.pos.x, dz = L.walkTo.z - L.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 6 + L.R) L.walkTo = null;
    else { want = Math.atan2(dx, dz); speed = L.speed * 0.30; }
  } else if (!L.calmed && L.standE > 0.5 && pd < 90) {
    want = Math.atan2(player.pos.x - L.pos.x, player.pos.z - L.pos.z);
  }
  if (want !== null) {
    let dA = want - L.yaw;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    L.yaw += clamp(dA, -0.35 * dt, 0.35 * dt);
    if (Math.abs(dA) > 0.6) speed *= 0.2;                // turn on the spot before striding off
  }
  const vx = Math.sin(L.yaw) * speed, vz = Math.cos(L.yaw) * speed;
  L.vel.x = lerp(L.vel.x, vx, Math.min(1, 2 * dt));
  L.vel.z = lerp(L.vel.z, vz, Math.min(1, 2 * dt));
  L.pos.x += L.vel.x * dt;
  L.pos.z += L.vel.z * dt;

  // ---- feet: alternating tetrapod gait on planted feet ----
  const busy = [0, 0];
  for (const f of L.feet) if (f.t >= 0) busy[f.group]++;
  for (let li = 0; li < 8; li++) {
    const f = L.feet[li];
    restWorld(L, li, _rw);
    if (f.t >= 0) {
      f.t = Math.min(1, f.t + dt / SWING_T);
      const e = smooth(f.t, 0, 1);
      f.cur.lerpVectors(f.from, f.to, e);
      f.cur.y += Math.sin(Math.PI * f.t) * 0.30 * L.R * L.standE;
      if (f.t >= 1) { f.t = -1; f.planted.copy(f.to); f.cur.copy(f.to); }
    } else if (L.standE > 0.35) {
      if (busy[f.group ^ 1] === 0 && f.planted.distanceTo(_rw) > STRIDE * L.R) {
        f.from.copy(f.planted);
        f.to.copy(_rw).addScaledVector(L.vel, SWING_T * 0.6);
        f.to.y = terrainH(f.to.x, f.to.z, L.idx);
        f.t = 0;
        busy[f.group]++;
      }
    } else {
      f.planted.lerp(_rw, 1 - Math.pow(0.05, dt));      // the sprawl slides with the settle
      f.cur.copy(f.planted);
    }
  }

  poseAll(L, dt, player);

  // ---- contact: the shell shoves ----
  if (pd < L.collR) {
    let ni = 0, nd = 1e9;
    for (let k = 0; k < L.spine.length; k++) { const d = L.spine[k].distanceTo(player.pos); if (d < nd) { nd = d; ni = k; } }
    _v.copy(player.pos).sub(L.spine[ni]).normalize();
    player.vel.addScaledVector(_v, 90 * dt * 8);
    ev.lightDrain += dt * 0.5;
    ev.slam = true;
  }
  if (!L.calmed && L.standE > 0.5 && pd < L.R * 2) L.agitation = Math.min(1, L.agitation + dt * 0.8);
  L.agitation = Math.max(0, L.agitation - dt * 0.2);

  // ---- wards ----
  const haloK = L.size;
  if (!L.calmed) {
    let allLit = true;
    for (let i = 0; i < L.sigils.length; i++) {
      const g = L.sigils[i];
      if (g.lit) wardLitPose(g, dt, haloK);
      else {
        allLit = false;
        wardIdle(g, dt, haloK);
        wardTouch(L, i, g, player, ev);
      }
    }
    ev.remaining = L.sigils.filter(q => !q.lit).length;
    if (allLit) { L.calmed = true; L.calmT = 0; ev.calmed = true; L.standTarget = 0; L.threatTarget = 0; L.walkTo = null; }
  } else {
    L.calmT += dt;
    for (const g of L.sigils) {
      g.pulse += dt;
      g.light.intensity = Math.max(0, 120 - L.calmT * 8);
      g.light.position.copy(g.grp.position);
      g.halo.position.copy(g.grp.position);
    }
  }
  wardFlashes(L, dt, null);
  L.pPrev.copy(player.pos);
  return ev;
}
```

- [ ] **Step 4: Syntax check**

```bash
for f in src/entities/sleeper/*.js src/entities/leviathan.js; do node --check "$f" || echo "FAIL $f"; done
```

- [ ] **Step 5: Probe her in the page**

Reload with `localStorage.clear()`, start a dive (click the title; zone 0), open the lab, then:

```js
const a = window.__lev.swap('brooder');
const s0 = window.__lev.state();
window.__lev.cmd('stand');
await new Promise(r => setTimeout(r, 7500));
const s1 = window.__lev.state();
window.__lev.cmd('walk', window.__lev.me());
await new Promise(r => setTimeout(r, 4000));
const s2 = window.__lev.state();
window.__lev.cmd('rear');
await new Promise(r => setTimeout(r, 1500));
const s3 = window.__lev.state();
({ a, s0, s1, s2, s3 })
```

Expected: `a === 'brooder'`; `s0.stand` 0 and every ward `y` below 0 (under the sand); `s1.stand` 1, `s1.bodyY` about 13 u above ground, ward `y` roughly 10–12; `s2.walking` true or already arrived, `s2.swinging` between 1 and 4; `s3.threat` near 1. `s0.tris` between 100k and 170k. Console clean.

Then with `__power.set(0,0)`, run for ~3 s and read frame rate as in the battery-governor card; it must stay above 60 on this machine with her standing in view. Restore `__power.set(60,30)`.

Then regression: `window.__lev.swap('serpent'); window.__lev.fp(0)` equals the golden; swap to brooder and back three times, then `renderer.info` program count (via `__sky` or `__perf` if exposed, else skip) and console clean.

- [ ] **Step 6: Commit**

```bash
git add src/entities/sleeper/common.js src/entities/sleeper/brooder.js
git commit -m "brooder: Velkath's body — shell, planted-foot gait, claws, eye stalks, underside wards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Look-dev pass and Michael's checkpoint

**Files:**
- Modify: `src/entities/sleeper/brooder.js`, `src/entities/sleeper/brooderGeo.js` (tuning only)
- Modify: `CLAUDE.md`, `roadmap/three-sleepers.md`

**Interfaces:**
- Consumes: the lab sleeper group, `__lev`.
- Produces: screenshots for Michael; merged branch.

- [ ] **Step 1: Frame her**

In the pane: brooder, stand. Screenshots from four angles: front three-quarter from the seabed (the reveal angle), side profile standing, underneath looking up at the wards, and settled from 30 u. Check against the spec: monolithic next to Sal, chalk plates not plastic, claw asymmetry reads, knees above the shell line, eye stalks folded when settled.

- [ ] **Step 2: Fix what reads wrong**

Typical fixes, each a one-line constant: carapace `normalScale`, scute seam depth (`0.022`) and crown (`0.018`), limb color, `SEG` lengths if knees read low, `R_OF_SIZE` if she reads small next to Sal. Re-screenshot after each change. Do not change the stand heights without re-running the ward-height check from Task 5 Step 5.

- [ ] **Step 3: Docs**

In `CLAUDE.md`, replace the `entities/leviathan.js` bullet with:

```markdown
- `entities/leviathan.js` — FACADE: dispatches on `cfg.kind` (config LEVIATHAN_CFG rows;
  a chart row or `__lev.swap(kind)` can override). Shared machinery in
  `entities/sleeper/common.js` (ward light pool of 5, rune, ward build/touch/flash,
  embers, sonar/keeper gates, generic dispose with `L.onDispose`/`L.keepTex`).
  Kinds: `sleeper/serpent.js` (the original: CPU-rebuilt body, alpha-hashed fins,
  flyby steering fade — don't regress the pirouette fix) and `sleeper/brooder.js` +
  `brooderGeo.js` (Velkath: crab colossus, planted-foot gait, underside wards exposed
  only when she stands). `__lev.fp(i)` is the serpent's regression hash.
```

- [ ] **Step 4: Card log and board**

Append to `roadmap/three-sleepers.md` a dated log line: split shipped with identical fingerprints, the Brooder's body posable in the lab, tris/draws/frame-rate measured, how Michael views her (lab → sleeper → brooder, stand, walk to me, rear), and that zone 0 still ships the serpent until he approves. Set `status: wip`. Regenerate the board with `python3 ~/.claude/skills/roadmap/gen.py roadmap` and republish the artifact at its existing URL.

- [ ] **Step 5: Merge**

```bash
git add CLAUDE.md roadmap/three-sleepers.md ROADMAP.html src/entities/sleeper
git commit -m "brooder: look-dev pass, docs, card log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git switch main && git checkout -- ROADMAP.html && git merge --no-ff sleepers-brooder -m "Merge sleepers-brooder: leviathan split + the Brooder's body

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push origin main
```

- [ ] **Step 6: Stop for Michael's eye**

Send the screenshots. Do not flip zone 0's `kind` to `brooder`; that is his call after he has seen her.
