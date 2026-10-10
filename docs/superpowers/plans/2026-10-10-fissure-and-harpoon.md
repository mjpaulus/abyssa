# The Fissure and the Harpoon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the round rift crater in all three zones with a carved seabed fissure that is choked shut until the zone's sleeper is calmed and then opens to the deep's own pale light; wake Velkath by pulling an old harpoon from her shell (clutch stays, brood rule goes); make the harpoon Sal's blade.

**Architecture:** One pure shape module (`src/world/fissureShape.js`) is the single source of truth for each zone's crack (frame, signed distance, throat test) and is consumed by terrain carving, fall-through, exclusions, the jam, the light and the ending. The jam/opening visuals live in a new `src/world/fissure.js`; the open light retunes `src/world/rifts.js`. Velkath's rite swaps brood.js's pry/return for a harpoon prop + trigger; the blade is a branch of game.js's existing slash path.

**Tech Stack:** Three.js r184 (CDN importmap, no build step), plain ES modules, GLSL via onBeforeCompile/ShaderMaterial, headless Blender 5.2 sculpt pipeline (tools/blender), CDP bench host (tools/bench) for probes.

**Spec:** `docs/superpowers/specs/2026-10-10-fissure-and-harpoon-design.md` (approved by Michael 2026-10-10). Read it before any task.

## Global Constraints

- ALL assets generated in code or scripted Blender; every loaded asset keeps a procedural fallback (`lib/assets.js loadSculpted` never throws).
- Exactly **14** THREE lights in the scene at all times; never add a light. Any glow = emissive/additive, `fog:false` + its own distance curve (`lib/textures.js warmGlow`/`makeWarmGlow` style); never a fogged additive sprite.
- Invariants before every commit (fresh load): 14 lights; `__lev.fp(0/1/2)` = `15ce888c / c938fe6e / 652d0412` (MUST NOT change); `__safeFailed()` = []; `__shaderFailed()` = []; console clean except favicon 404. Terrain fingerprints `__ridge.fp()` WILL change in Task 1 — record new values (home, Pallid, Burned) in CLAUDE.md; after Task 1 they must not change again.
- `riftPos(i)` is frozen; the ending's ascent spline threads the three openings (`ending.js`); the opening stays centred on `riftPos(i)`.
- Zero per-frame allocation in hot paths; GLSL: no backticks in comments inside template strings; reversed `smoothstep` is UB (`1.0 - smoothstep(lo,hi,x)`); each material variant gets a `customProgramCacheKey`.
- Anything new that first appears in play (mesh, material, texture) is built/warmed in the boot tail (CLAUDE.md "Boot / loading") or it hitches.
- Copy: ALL-CAPS period voice via `showMsg`; exact lines: "A HARPOON IN HER SIDE. SOMEONE CAME BEFORE YOU." / "IT COMES FREE. SHE FEELS IT." / "ANOTHER DIVER'S HARPOON." / prompts "[E] PULL THE HARPOON" and "[E] PRESS THE OLD WOUND"; grab line becomes "IT HAS YOU. CUT IT — CLICK TO THRUST." once the harpoon is owned; title hint "click: blade".
- Agents: worktree `/Users/michaelpaulus/sc/.abyssa-wt/<branch>`, follow `/Users/michaelpaulus/sc/.abyssa-wt/BRIEF-COMMON.md`, own ports (never 8777/8790/8792), commit early, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The orchestrator merges.

## Review Focus

1. Standing/walking on the SHUT jam: Sal must stand on it without jitter or falling through, and must not be able to get under it from the sides (throat walls). Expected: solid ground at the jam surface. → Task 2 test `jam-stand`.
2. The OPEN throat's fall-through region must match the drawn crack (no invisible floor over open dark, no falling through rock lips). → Task 2 test `throat-edges`.
3. Reload / voyage / remembered visit with a zone already calmed: the fissure must load OPEN (no replayed cutscene), and an uncalmed zone loads SHUT. → Task 4 test `open-persist`.
4. The crack must not cut through anything placed: Velkath's lair, Orune's trawler, Mhor's furnace, vents, wrecks, flora/props, the raft's shadow area — at all three anchorages. Expected: clearance ≥ 6 u from the crack lip to any collider. → Task 5 test `clearance`.
5. Harpoon trigger reachable on BOTH routes (natural walk + `?playtest` Alt+6) at all three anchorages; revisit shows the old wound; owning the harpoon survives reload. → Task 6 test `harpoon-routes`; blade timing stays in sync with the hit (Task 7 test `thrust-contact`).

---

## File Structure

- Create `src/world/fissureShape.js` — PURE shape: per-zone frame + signed distance + throat/jam queries. No THREE import, no state. (Task 1)
- Modify `src/world/terrain.js` — replace the round funnel (`rm` block in `terrainH`, `RIFT_RR`) with fissure carving from fissureShape. (Task 1)
- Modify `src/player.js` — fall-through uses `inThroat`; shut jam is a floor. (Task 2)
- Modify `src/game.js` — rift checks at ~706/~2111 use fissureShape; calm → `openFissure(zone)`; boot warm of fissure meshes; persistence on load. (Tasks 2, 4)
- Create `src/world/fissure.js` — the jam (instanced boulders + silt surface), seep light, the opening animation, per-zone open state. (Task 3)
- Modify `src/world/rifts.js` — open light retuned to pale breathing; `rimRing` removed; shafts follow the crack line; surface glow. (Task 4)
- Modify `src/world/wrecks.js`, `src/world/vents.js`, `src/world/flora.js`, `src/world/gardens.js`, `src/world/props.js`, `src/ui/playtest.js` — exclusion/placement uses `fissureDist` instead of a riftPos circle. (Task 5)
- Modify `src/entities/sleeper/brooder.js` — lair alongside the crack; wake on harpoon; remove brood-rule hooks. (Tasks 5, 6)
- Modify `src/entities/sleeper/brood.js` — remove pry/return + brood rule; clutch stays as look + soft solid. (Task 6)
- Create `src/entities/sleeper/harpoon.js` — the lodged harpoon prop, glint, trail discoverables (boot, coupling), the rite (`prompt`/`interact`), old-wound revisit. (Task 6)
- Create `src/lib/harpoonSculpt.js` + `assets/harpoon/` via `node tools/blender/build.mjs harpoon` — the generated model; procedural fallback in harpoon.js. (Task 6)
- Modify `src/entities/sleeper/common.js` — drop `MSG_BROOD_COLD` use for Velkath; keep `wardRefuse` for Orune/Mhor. (Task 6)
- Modify `src/systems/survival.js` + `game.js` save — `survival.hasHarpoon`, `tools.harpoon`, per-anchorage `pulled[site]`. (Tasks 6, 7)
- Modify `src/entities/diver.js` — harpoon hand prop + thrust pose (contact 0.30 s). (Task 7)
- Modify `src/world/predators.js` — `slash(pos, fwd, range, power)`; shark stagger by power. (Task 7)
- Modify `src/entities/sleeper/hoarder.js` — `onSlash(pos, fwd, reach)`. (Task 7)
- Modify `index.html` — title hint. (Task 7)
- Create `tools/bench/fissure-probe.mjs`, `tools/bench/harpoon-probe.mjs` — the tests (CDP, real keys). (Tasks 1–7)

Tests in this repo are browser probes: a node script drives a private headless Chrome over CDP (`tools/bench/drv.mjs`), loads `http://localhost:<port>/?bench&playtest`, and asserts on the game's debug surfaces. Each task's probe exits non-zero on failure.

---

### Task 1: The fissure shape and its carving

**Files:**
- Create: `src/world/fissureShape.js`
- Modify: `src/world/terrain.js` (the `rm` funnel block in `terrainH`, `RIFT_RR`)
- Test: `tools/bench/fissure-probe.mjs` (mode `shape`)

**Interfaces:**
- Produces (fissureShape.js, all pure, no allocation in the query functions):
  - `FISSURE[zi]` → `{ cx, cz, dx, dz, halfLen, halfW, throatHalfW, lipDrop, jamDepth }` (centre = riftPos(zi), unit direction (dx,dz), half length 30–40, half width 5–8, throat half width 3.5–5)
  - `fissureLocal(x, z, zi, out)` → writes `out.u` (along, −halfLen..halfLen), `out.v` (across), returns `out`
  - `fissureDist(x, z, zi)` → signed distance (u) to the crack's lip outline (negative inside)
  - `inThroat(x, z, zi)` → boolean: inside the open throat (fall-through region)
  - (added in Task 2) `jamTopY(zi, terrainH)` → world y of the shut jam's walkable surface
- terrain.js keeps `export function terrainH(x, z, zi)` unchanged in signature.

- [ ] **Step 1: Write the failing probe**

```js
// tools/bench/fissure-probe.mjs  (mode: shape)  — node tools/bench/fissure-probe.mjs shape <port>
import { start, stop, connect } from './drv.mjs';
const [, , mode, port] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9481';
await start(`http://localhost:${port}/?bench&playtest`);
const c = await connect();
await c.until(`!document.getElementById('load')`, 240000, 1000);
const fail = [];
if (mode === 'shape') {
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    const out = [];
    for (let zi = 0; zi < 3; zi++) {
      const F = S.FISSURE[zi], o = {};
      const atC = T.terrainH(F.cx, F.cz, zi);                          // opening centre
      const lipL = T.terrainH(F.cx + F.dx * F.halfLen * 0.9, F.cz + F.dz * F.halfLen * 0.9, zi);
      const side = T.terrainH(F.cx - F.dz * (F.halfW + 8), F.cz + F.dx * (F.halfW + 8), zi);
      out.push({ zi, len: F.halfLen * 2, w: F.halfW * 2, depthCentre: side - atC, depthEnd: side - lipL,
        inC: S.inThroat(F.cx, F.cz, zi), outSide: S.inThroat(F.cx - F.dz * (F.halfW + 3), F.cz + F.dx * (F.halfW + 3), zi) });
    }
    return out; })()`);
  for (const z of r) {
    if (z.len < 60 || z.len > 80) fail.push(`zone ${z.zi} length ${z.len}`);
    if (z.w < 10 || z.w > 16) fail.push(`zone ${z.zi} width ${z.w}`);
    if (z.depthCentre < 25) fail.push(`zone ${z.zi} throat too shallow ${z.depthCentre}`);
    if (!z.inC || z.outSide) fail.push(`zone ${z.zi} throat test wrong`);
  }
  console.log(JSON.stringify(r));
}
stop();
if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('PASS');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 serve.py 8840 & node tools/bench/fissure-probe.mjs shape 8840`
Expected: FAIL (module `/src/world/fissureShape.js` not found).

- [ ] **Step 3: Implement fissureShape.js**

```js
// src/world/fissureShape.js — THE FISSURE's shape, the single source of truth (spec 2026-10-10).
// Pure: no THREE, no state beyond the frozen table. Every consumer (terrain carving, fall-through,
// exclusions, the jam, the light, the ending) asks here instead of drawing its own circle.
import { riftPos } from '../config.js';
// Authored per zone: bearing of the crack (radians) and its proportions. Bearings chosen so the
// crack runs across the basin, not toward the wall; lengths/widths inside the spec's ranges.
const ROWS = [
  { bear: 0.55, halfLen: 36, halfW: 6.5, throatHalfW: 4.2, lipDrop: 6, jamDepth: 7 },   // zone 0: limestone
  { bear: 2.20, halfLen: 33, halfW: 7.0, throatHalfW: 4.6, lipDrop: 5, jamDepth: 8 },   // zone 1: scorched
  { bear: 1.05, halfLen: 38, halfW: 7.5, throatHalfW: 5.0, lipDrop: 7, jamDepth: 9 },   // zone 2: basalt
];
export const FISSURE = ROWS.map((r, zi) => {
  const p = riftPos(zi);
  return Object.freeze({ cx: p.x, cz: p.z, dx: Math.cos(r.bear), dz: Math.sin(r.bear), halfLen: r.halfLen,
    halfW: r.halfW, throatHalfW: r.throatHalfW, lipDrop: r.lipDrop, jamDepth: r.jamDepth });
});
export function fissureLocal(x, z, zi, out) {
  const F = FISSURE[zi], rx = x - F.cx, rz = z - F.cz;
  out.u = rx * F.dx + rz * F.dz; out.v = -rx * F.dz + rz * F.dx; return out;
}
// Half width tapers toward the ends (a crack pinches out), with a jagged edge from cheap hash
// noise along u so the outline is not a capsule.
function halfWAt(F, u) {
  const t = Math.min(1, Math.abs(u) / F.halfLen);
  const taper = Math.sqrt(Math.max(0, 1 - t * t));
  const jag = 0.18 * Math.sin(u * 0.61 + 1.3) + 0.12 * Math.sin(u * 1.73 - 0.4) + 0.07 * Math.sin(u * 3.9);
  return F.halfW * taper * (1 + jag);
}
const _l = { u: 0, v: 0 };
export function fissureDist(x, z, zi) {
  const F = FISSURE[zi]; fissureLocal(x, z, zi, _l);
  if (Math.abs(_l.u) > F.halfLen) return Math.hypot(Math.abs(_l.u) - F.halfLen, _l.v);
  return Math.abs(_l.v) - halfWAt(F, _l.u);
}
export function inThroat(x, z, zi) {
  const F = FISSURE[zi]; fissureLocal(x, z, zi, _l);
  if (Math.abs(_l.u) > F.halfLen * 0.92) return false;
  return Math.abs(_l.v) < halfWAt(F, _l.u) * (F.throatHalfW / F.halfW);
}
export { halfWAt as _halfWAt };   // terrain.js carving uses the same edge
```

`jamTopY(zi)` is added in Task 2 (it needs the carved terrain height).

- [ ] **Step 4: Replace the funnel carving in terrainH**

In `terrain.js` remove the `RIFT_RR`/`rm` funnel (the `dr < RIFT_RR` mask at the top of `terrainH` and the `if (rm > 0) { ... }` block). Add at the top of `terrainH`:

```js
  // THE FISSURE (spec 2026-10-10): a jagged crack carved along FISSURE[zi]; replaces the round funnel.
  const fd = fissureDist(x, z, zi);          // < 0 inside the lip outline
  const fm = fd < 14 ? 1 - Math.min(1, Math.max(0, fd) / 14) : 0;   // 14 u apron: ground eased toward the lip
```

and after `h += P.lift;` (before the soft floor), insert:

```js
  if (fm > 0) {
    const F = FISSURE[zi];
    // apron: flatten the landform near the crack so lips read as broken shelf, not noise
    const a = fm * fm * (3 - 2 * fm);
    h = h * (1 - 0.6 * a) + 18 * 0.6 * a;
    if (fd < 0) {
      // walls: steep, layered (terrace steps every 4.5 u), slumped blocks via a 9 u hash lump
      const depth = Math.min(1, -fd / 2.2);                                   // lip break within ~2 u
      const strata = Math.floor((-fd) * 1.7) / 1.7;                           // stepped faces
      const lumps = (fbm2(x * 0.11 + 7.7, z * 0.11 - 3.1, 2) - 0.5) * 6;      // slumped blocks
      h -= F.lipDrop + depth * (60 + strata * 2.5) + lumps * depth;           // ~60 u throat into black
    }
  }
```

(`fbm2` is the file's existing noise; import `fissureDist, FISSURE` from `./fissureShape.js`.) Keep the "soft floor" clamp ABOVE the carving so the throat is not clamped (move the `if (h < 4)` line before the fissure block).

- [ ] **Step 5: Run the probe, iterate proportions until it passes**

Run: `node tools/bench/fissure-probe.mjs shape 8840` → Expected: PASS with per-zone lengths 66–76, widths 13–15, centre depth ≥ 25.

- [ ] **Step 6: Look at it** — `play.mjs`-style frames (game camera) of each zone's crack from 40 u and from above; record `__ridge.fp()` home/Pallid/Burned and `__ridge.fp([1,2])`.

- [ ] **Step 7: Commit**

```bash
git add src/world/fissureShape.js src/world/terrain.js tools/bench/fissure-probe.mjs
git commit -m "fissure: carved seabed crack replaces the round rift funnel (all zones)"
```

---

### Task 2: Walking on the shut jam, falling through the open throat

**Files:**
- Modify: `src/world/fissureShape.js` (add `jamTopY`), `src/player.js` (`updatePlayer` overRift / floorY), `src/game.js` (~2111 descent check, ~706 rim)
- Test: `tools/bench/fissure-probe.mjs` modes `jam-stand`, `throat-edges`

**Interfaces:**
- Consumes: `inThroat`, `fissureDist`, `FISSURE` (Task 1)
- Produces: `jamTopY(zi)` → number (world y of the jam surface, = terrainH at the crack's lip line minus `jamDepth`); player.js: shut → `floorY = max(terrain, jamTopY+EYE_H)` inside the outline; open → fall-through iff `inThroat`.

- [ ] **Step 1: Write the failing probes**

```js
// append to fissure-probe.mjs
if (mode === 'jam-stand') {      // shut: stand on the jam 5 s, never below it, no jitter
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js'); window.__helm = true; window.gotoZone(0);
    const F = S.FISSURE[0]; window.__bench.place(F.cx, F.cz, 0, 0);
    let minY = 1e9, maxStep = 0, last = null;
    window.__bench.step(300, () => { const y = window.player.pos.y; minY = Math.min(minY, y);
      if (last != null) maxStep = Math.max(maxStep, Math.abs(y - last)); last = y; });
    return { minY, jam: S.jamTopY(0, T.terrainH), maxStep, zone: window.zone }; })()`);
  if (r.minY < r.jam) fail.push('fell below the jam ' + JSON.stringify(r));
  if (r.maxStep > 0.08) fail.push('jitter on the jam ' + r.maxStep);
  if (r.zone !== 0) fail.push('left zone 0 while shut');
  console.log(JSON.stringify(r));
}
if (mode === 'throat-edges') {   // open: inside the throat falls to zone 1; on the lip 1 u outside it does not
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); window.__helm = true; window.gotoZone(0);
    window.lev.calmed = true; window.__fissure.setOpen(0, 1);
    const F = S.FISSURE[0], res = {};
    window.__bench.place(F.cx, F.cz, 0, 0); window.__bench.step(600); res.centreZone = window.zone;
    window.gotoZone(0); window.lev.calmed = true; window.__fissure.setOpen(0, 1);
    const ox = F.cx - F.dz * (F.halfW + 1.0), oz = F.cz + F.dx * (F.halfW + 1.0);
    window.__bench.place(ox, oz, 0, 0); window.__bench.step(300); res.lipZone = window.zone;
    return res; })()`);
  if (r.centreZone !== 1) fail.push('did not fall through the open throat');
  if (r.lipZone !== 0) fail.push('fell through from the lip');
  console.log(JSON.stringify(r));
}
```

- [ ] **Step 2: Run to verify they fail** — `node tools/bench/fissure-probe.mjs jam-stand 8840` → FAIL (`jamTopY` missing / falls into the throat).

- [ ] **Step 3: Implement** — in fissureShape.js:

```js
// The jam's walkable top: the crack's mean lip height minus jamDepth. terrainH is passed in so
// this module stays pure (terrain.js imports us; we must not import it).
const JAM = [null, null, null];
export function jamTopY(zi, terrainH) {
  if (JAM[zi] != null) return JAM[zi];
  if (!terrainH) return -1e9;
  const F = FISSURE[zi]; let s = 0, n = 0;
  for (let i = -4; i <= 4; i++) { const u = i / 4 * F.halfLen * 0.8, w = halfWAt(F, u) + 1.5;
    for (const sg of [-1, 1]) { s += terrainH(F.cx + F.dx * u - F.dz * w * sg, F.cz + F.dz * u + F.dx * w * sg, zi); n++; } }
  return (JAM[zi] = s / n - F.jamDepth);
}
export function resetJam() { JAM[0] = JAM[1] = JAM[2] = null; }   // call after a reseed (terrain changed)
```

In player.js replace the circle test:

```js
  const throat = inThroat(player.pos.x, player.pos.z, zi);
  const overRift = riftOpen && throat;
  // shut: the jam is a floor wherever the crack is (inside the lip outline), at jamTopY
  const inCrack = fissureDist(player.pos.x, player.pos.z, zi) < 0;
  const jamFloor = (!riftOpen && inCrack) ? jamTopY(zi, terrainH) + EYE_H : -1e9;
```

and use `Math.max(th + EYE_H, deckY, jamFloor)` where `floorY` is computed. In game.js replace the two `riftPos(zone)` circle checks (~706 rim estimate, ~2111 descent) with `inThroat(...)` / `fissureDist(...)`. Call `resetJam()` at the start of `reseedWorldNow`. Expose `window.__fissure = { setOpen }` from Task 3's module (stub now: `setOpen(zi,k){ openK[zi]=k }` reading into `updatePlayer`'s `riftOpen` via game.js).

- [ ] **Step 4: Run both probes** → Expected: PASS (`minY ≥ jam`, `maxStep ≤ 0.08`, centre falls to zone 1, lip stays zone 0).

- [ ] **Step 5: Commit**

```bash
git add src/world/fissureShape.js src/player.js src/game.js tools/bench/fissure-probe.mjs
git commit -m "fissure: the jam is a floor while shut; fall-through follows the open throat"
```

---

### Task 3: The jam, the seep and the opening moment

**Files:**
- Create: `src/world/fissure.js`
- Modify: `src/game.js` (build in the boot tail next to `buildRifts`; `updateFissure` in the frame loop next to `updateRifts`), `src/world/rifts.js` (remove `floorGlow` — the seep replaces it)
- Test: `tools/bench/fissure-probe.mjs` mode `opening`

**Interfaces:**
- Consumes: `FISSURE`, `jamTopY`, `fissureLocal` (Tasks 1–2), `stirPulse` (world/stir.js), `ev.quake` path in game.js
- Produces (fissure.js):
  - `buildFissures()` — builds per-zone jam meshes (one InstancedMesh of boulders ≤ 160 instances + one silt surface mesh per zone) and seep sprites; returns nothing
  - `setFissureOpen(zi, k)` — instant state (0 shut … 1 open), used on load/reseed
  - `openFissure(zi)` — starts the ~3.5 s collapse + ~3 s light swell; returns the duration in seconds
  - `updateFissure(dt, t, activeZone)` → `{ quake: number, opening: boolean }`
  - `fissureOpenK(zi)` → current 0..1 (drives `riftOpen` = k > 0.5 and the light in Task 4)
  - `window.__fissure = { setOpen: setFissureOpen, open: openFissure, k: fissureOpenK }`

- [ ] **Step 1: Write the failing probe**

```js
if (mode === 'opening') {   // a calm opens it once: k climbs 0 -> 1 in 5-9 s, quake fires, jam boulders end below the lip
  const r = await c.ev(`(async () => {
    window.__helm = true; window.gotoZone(0); window.__fissure.setOpen(0, 0);
    const dur = window.__fissure.open(0); let quake = 0, k5 = 0, kEnd = 0;
    window.__bench.step(Math.round(dur * 60) + 60, i => { if (i === 300) k5 = window.__fissure.k(0); });
    kEnd = window.__fissure.k(0); return { dur, k5, kEnd, lights: (() => { let n = 0; window.scene.traverse(o => { if (o.isLight) n++ }); return n })() }; })()`);
  if (r.dur < 5 || r.dur > 9) fail.push('opening duration ' + r.dur);
  if (r.kEnd < 0.99) fail.push('did not finish opening');
  if (r.lights !== 14) fail.push('light count ' + r.lights);
  console.log(JSON.stringify(r));
}
```

- [ ] **Step 2: Run to verify it fails** → FAIL (`window.__fissure.open` undefined).

- [ ] **Step 3: Implement fissure.js** — structure (fill the look by eye, keeping these mechanics exact):

```js
// src/world/fissure.js — THE FISSURE's jam, seep and opening (spec 2026-10-10 §1).
import * as THREE from 'three';
import { scene } from '../core.js';
import { FISSURE, jamTopY, _halfWAt } from './fissureShape.js';
import { terrainH } from './terrain.js';
import { stirPulse, P_STRIKE } from './stir.js';
const N_BOULDER = 160, COLLAPSE = 3.6, SWELL = 3.0;
const Z = [];                                          // per zone: { jam, silt, seep, k, t, opening }
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function buildFissures() { for (let zi = 0; zi < 3; zi++) Z.push(buildZone(zi)); }
function buildZone(zi) {
  // boulders: a generated rock (lib/textures.js rockMapSet triplanar like flora.js rocks), placed
  // along the crack between the lips at jamTopY, sizes 1.2-3.5 u, packed tighter at the centre.
  // silt: a thin displaced plane clipped to the crack outline at jamTopY + 0.3 (walkable look).
  // seep: 6-10 additive fog:false sprites in boulder gaps, pale blue-white (0.70, 0.82, 1.0),
  // alpha breathing on an 8 s period, max alpha 0.10, distance-faded like warmGlow.
  // Each boulder keeps its rest matrix + a fall target (down the throat, 20-60 u, tumbling).
  return { /* jam: InstancedMesh, silt: Mesh, seep: Sprite[], rest: Float32Array, k: 0, t: -1 */ };
}
export function setFissureOpen(zi, k) { const F = Z[zi]; F.k = k; F.t = -1; pose(zi, k); }
export function openFissure(zi) { const F = Z[zi]; F.t = 0; return COLLAPSE + SWELL; }
export function fissureOpenK(zi) { return Z[zi] ? Z[zi].k : 0; }
export function updateFissure(dt, t, activeZone) {
  let quake = 0;
  for (let zi = 0; zi < 3; zi++) { const F = Z[zi]; if (F.t < 0) continue;
    F.t += dt; const c = Math.min(1, F.t / COLLAPSE);
    F.k = Math.min(1, F.t / (COLLAPSE + SWELL));
    pose(zi, c);                                     // boulders fall per their eased schedule
    if (zi === activeZone && F.t < COLLAPSE) quake = Math.max(quake, 0.6 * (1 - c));
    if (zi === activeZone && F.t - dt < 0.4 && F.t >= 0.4) {    // one silt burst at the break
      const R = FISSURE[zi]; stirPulse(R.cx, jamTopY(zi, terrainH), R.cz, 40, 0, 1.0, P_STRIKE); }
    if (F.t >= COLLAPSE + SWELL) F.t = -1; }
  return { quake, opening: Z.some(F => F.t >= 0) };
}
function pose(zi, c) { /* write instance matrices: rest -> fall target by an ease-in per boulder
  with staggered start (0-1.2 s) and spin; silt mesh sinks and fades with c; seep fades out as c->1 */ }
export const __fissure = { setOpen: setFissureOpen, open: openFissure, k: fissureOpenK };
if (typeof window !== 'undefined') window.__fissure = __fissure;
```

Wire in game.js: `buildFissures()` in the boot tail after `buildRifts()` (and warm-draw the jam/silt in the warm cameras); in the frame loop `const fz = updateFissure(dt, t, zone); if (fz.quake) ev.quake = Math.max(ev.quake || 0, fz.quake);`; `riftOpen` for updatePlayer becomes `fissureOpenK(zone) > 0.5`. Delete `floorGlow` from rifts.js (its job is the seep's).

- [ ] **Step 4: Run** → `node tools/bench/fissure-probe.mjs opening 8840` → PASS; also re-run `jam-stand` and `throat-edges`.

- [ ] **Step 5: Frames** — a frame strip (game camera, 20 u from the lip, every 0.5 s) of the opening at home; check the boulders read as rock and the silt burst reads.

- [ ] **Step 6: Commit**

```bash
git add src/world/fissure.js src/game.js src/world/rifts.js
git commit -m "fissure: rubble jam + pale seep while shut; the opening collapse (quake, silt, swell)"
```

---

### Task 4: The deep's own light, the calm wiring and persistence

**Files:**
- Modify: `src/world/rifts.js` (shafts/caustics/motes retuned; `rimRing` removed; shafts follow the crack; a surface glow), `src/game.js` (calm → `openFissure`; load/reseed → `setFissureOpen`)
- Test: `tools/bench/fissure-probe.mjs` mode `open-persist`

**Interfaces:**
- Consumes: `fissureOpenK`, `openFissure`, `setFissureOpen`, `FISSURE` (Tasks 1–3); `chartRec[site][zone]` (game.js calm record)
- Produces: `updateRifts(dt, t, activeZone, openK[])` — signature changes: the 4th arg becomes the per-zone open level array `[k0,k1,k2]` (game.js passes `[fissureOpenK(0), fissureOpenK(1), fissureOpenK(2)]` via a module-scoped array, no allocation).

- [ ] **Step 1: Write the failing probe**

```js
if (mode === 'open-persist') {   // calmed zones load OPEN without the cutscene; uncalmed load SHUT
  const r = await c.ev(`(async () => {
    window.__helm = true; const rec = window.__chart.rec(); const site = 0;
    rec[site][0] = 1; rec[site][1] = 0;                                   // zone 0 calmed, zone 1 not
    window.__chart.arrive(0);                                             // reseed path applies the record
    return { k0: window.__fissure.k(0), k1: window.__fissure.k(1) }; })()`);
  if (r.k0 !== 1) fail.push('calmed zone did not load open ' + r.k0);
  if (r.k1 !== 0) fail.push('uncalmed zone loaded open ' + r.k1);
  console.log(JSON.stringify(r));
}
```

- [ ] **Step 2: Run to verify it fails** → FAIL (k0 0 after arrive).

- [ ] **Step 3: Implement**
  - game.js, in the `if (ev.calmed)` block (where "ALL WARDS LIT. IT STILLS. A RIFT OPENS BELOW." is shown, ~line 2258): call `const dur = openFissure(zone);` and DELAY that line so it lands as the light arrives: queue it with `showMsg(line, 6, 2)` after `dur - 2.5` s (a small timer variable in game.js, no allocation per frame).
  - game.js: after every `reseedWorldNow` and at boot after the save loads: `for zi in 0..2: setFissureOpen(zi, chartRec[currentSiteIndex()][zi] ? 1 : 0)`.
  - rifts.js: colour `(0.62, 0.78, 1.0)`; breath `0.75 + 0.25 * sin(t * 2π / 7.5)`; shafts become 3–5 thin shells spaced ALONG the crack line (FISSURE dx/dz) rising from the throat; caustic disc replaced by caustic light on the wall faces (project the existing caustic pattern onto the two wall planes); motes column along the crack; a surface glow sprite on the water above the crack, fog:false, faint (alpha ≤ 0.08) and distance-faded; delete `rimRing` and its update.

- [ ] **Step 4: Run** `open-persist`, `opening`, `throat-edges` → PASS.

- [ ] **Step 5: Frames** — each zone's fissure open from 40 u and from mid-water above; from the raft deck looking toward the zone-0 crack (surface glow). Check never-neon by eye; the pale light must read in all three zone waters and at Pallid/Burned.

- [ ] **Step 6: Commit**

```bash
git add src/world/rifts.js src/game.js tools/bench/fissure-probe.mjs
git commit -m "fissure: the deep's own pale light (breathing shafts along the crack, wall caustics, surface glow); calm opens it; record loads it open"
```

---

### Task 5: Everything clears the crack (lairs, wrecks, vents, flora, props)

**Files:**
- Modify: `src/world/wrecks.js` (~1538), `src/world/vents.js`, `src/world/flora.js`, `src/world/gardens.js`, `src/world/props.js`, `src/ui/playtest.js` (~81), `src/entities/sleeper/brooder.js` (lair ~200/~506), `src/entities/sleeper/hoarder.js` / `hoard.js` (trawler), `src/entities/sleeper/hunter.js` (furnace)
- Test: `tools/bench/fissure-probe.mjs` mode `clearance`

**Interfaces:**
- Consumes: `fissureDist(x, z, zi)` (Task 1)
- Produces: every placement uses `fissureDist(x,z,zi) > CLEAR` (CLEAR = 6 + the object's radius) instead of a riftPos circle; Velkath's lair = a point beside the crack: `lair = centre + dir*u0 + normal*(halfW + 6 + R*0.55)` on her row's side.

- [ ] **Step 1: Write the failing probe**

```js
if (mode === 'clearance') {   // at each anchorage: every collider and the three lairs keep >= 6 u from the lip
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const out = []; window.__helm = true;
    for (const site of [0, 1, 2]) { window.__chart.arrive(site);
      for (let zi = 0; zi < 3; zi++) { window.gotoZone(zi);
        const L = window.lev, pts = [];
        if (L && L.lairPos) pts.push(['lair', L.lairPos.x, L.lairPos.z, L.R || 10]);
        if (L && L.hoard && L.hoard.center) pts.push(['trawler', L.hoard.center.x, L.hoard.center.z, 14]);
        if (L && L.furnace && L.furnace.pos) pts.push(['furnace', L.furnace.pos.x, L.furnace.pos.z, 6]);
        for (const w of (window.wrecks && window.wrecks.sites ? window.wrecks.sites(zi) : [])) pts.push(['wreck', w.x, w.z, w.r || 10]);
        for (const [n, x, z, rad] of pts) { const d = S.fissureDist(x, z, zi) - rad; if (d < 6) out.push({ site, zi, n, d: +d.toFixed(1) }); } } }
    window.__chart.arrive(0); return out; })()`);
  if (r.length) fail.push('too close to the crack: ' + JSON.stringify(r));
}
```

(If `window.wrecks.sites` does not exist, add it to wrecks.js as `sites: zi => wreckSites().filter(w => w.zi === zi)` exposing `{x,z,r}` — read wrecks.js `wreckSites()` for its fields.)

- [ ] **Step 2: Run to verify it fails** — expected FAIL listing Velkath's lair (she sleeps on the old rim crest) and any wreck/vent within the new crack's length.

- [ ] **Step 3: Implement** — replace each riftPos-circle exclusion with `fissureDist`; move Velkath's lair beside the crack (brooder.js lair code: keep per-site `lair.bear`/`arc` as the SIDE + position along the crack); check Orune's trawler and Mhor's furnace rows at every site; keep layouts pure functions of the site streams (re-run rejection sampling with the new test, same draws order).

- [ ] **Step 4: Run** `clearance` → PASS; re-run `shape`, `jam-stand`, `throat-edges`, `opening`, `open-persist` → PASS; voyage soak (home→Pallid→Burned→home ×3): programs/geometries flat.

- [ ] **Step 5: Commit**

```bash
git add src/world src/entities/sleeper src/ui/playtest.js tools/bench/fissure-probe.mjs
git commit -m "fissure: placements clear the crack at every anchorage; Velkath sleeps alongside it"
```

---

### Task 6: Velkath's harpoon rite

**Files:**
- Create: `src/entities/sleeper/harpoon.js`, `src/lib/harpoonSculpt.js` (+ `tools/blender/build.mjs harpoon` target → `assets/harpoon/`)
- Modify: `src/entities/sleeper/brood.js` (remove pry/return + brood rule; clutch stays look + soft solid), `src/entities/sleeper/brooder.js` (`L.rite = L.harpoon`; wake on pull; remove `clutchOut`/brood-rule hooks), `src/entities/sleeper/common.js` (Velkath no longer uses `MSG_BROOD_COLD`), `src/game.js` (ward-count line without the egg variant; save `pulled[site]`, `tools.harpoon`), `src/systems/survival.js` (`hasHarpoon`), `src/ui/playtest.js` (Alt+6 → at the harpoon or the wound)
- Test: `tools/bench/harpoon-probe.mjs` modes `routes`, `rite`

**Interfaces:**
- Consumes: `lev.rite` generic hook (`prompt(pos)` → string|null, `interact(pos)` → result|null), brooder.js `wakeBrooder(L)` (existing wake), chart record `chartRec`, `saveChart()`
- Produces (harpoon.js):
  - `makeHarpoon(L, opts)` → `H` with `H.prompt(pos)`, `H.interact(pos)` → `{ pulled: true, first: boolean, msg } | null`, `H.pulled` (bool), `H.wound` (bool: revisit mode), `H.update(dt, t, lanternPos, lanternFacing)`, `H.dispose()`
  - `H.anchor` (THREE.Vector3, world) — where Sal stands to pull (used by playtest Alt+6)
  - survival: `survival.hasHarpoon` (bool); save: `tools.harpoon` (bool), `pulled: number[site]` (0/1)

- [ ] **Step 1: Write the failing probe**

```js
// tools/bench/harpoon-probe.mjs
import { start, stop, connect, sleep } from './drv.mjs';
const [, , mode, port] = process.argv; process.env.DRV_PORT = process.env.DRV_PORT || '9482';
await start(`http://localhost:${port}/?bench&playtest`); const c = await connect();
await c.until(`!document.getElementById('load')`, 240000, 1000); const fail = [];
const alt = d => c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit${d}',key:'${d}',altKey:true,bubbles:true})), window.dispatchEvent(new KeyboardEvent('keyup',{code:'Digit${d}',key:'${d}',altKey:true,bubbles:true})), window.__helm=true, window.__bench.step(60), 1)`);
if (mode === 'routes') {
  for (const site of [0, 1, 2]) {
    await c.ev(`(window.__helm=true, window.__chart.arrive(${site}), 1)`); await alt(6);
    const p = await c.ev(`window.lev.rite.prompt(window.player.pos)`);
    if (p !== '[E] PULL THE HARPOON') fail.push(`site ${site} prompt: ${p}`);
  }
}
if (mode === 'rite') {           // real E: pull -> she wakes -> Sal owns the harpoon -> reload keeps it -> revisit shows the wound
  await c.ev(`(window.__helm=true, window.__chart.arrive(0), 1)`); await alt(6);
  await c.key('KeyE', true); await sleep(80); await c.key('KeyE', false);
  await c.ev(`(window.__bench.step(600), 1)`);
  const s = await c.ev(`({ dormant: window.lev.dormant, owns: window.survival.hasHarpoon, msg: window.__msg().live })`);
  if (s.dormant) fail.push('she did not wake'); if (!s.owns) fail.push('no harpoon owned');
  await c.ev(`(window.saveChart && window.saveChart(), location.reload(), 1)`).catch(() => {}); await sleep(3000);
  const c2 = await connect(); await c2.until(`!document.getElementById('load')`, 240000, 1000);
  await c2.ev(`(window.__helm=true, window.setState('play'), 1)`); await sleep(1000);
  const a = await c2.ev(`(window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit6',key:'6',altKey:true,bubbles:true})), window.__bench.step(60), ({ owns: window.survival.hasHarpoon, prompt: window.lev.rite.prompt(window.player.pos) }))`);
  if (!a.owns) fail.push('ownership lost on reload');
  if (a.prompt !== '[E] PRESS THE OLD WOUND') fail.push('revisit prompt: ' + a.prompt);
}
stop(); if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('PASS');
```

- [ ] **Step 2: Run to verify it fails** → FAIL (prompt is "[E] PRY A CLUMP FROM HER CLUTCH").

- [ ] **Step 3: Implement**
  - harpoon.js: the prop lodged in a seam on her near flank (sand side, standing height; attach to `L.body` so it rides her), a frayed line to the silt; `H.prompt` → `'[E] PULL THE HARPOON'` (first visit at the site) or `'[E] PRESS THE OLD WOUND'` (revisit, `opts.wound`) within 2.6 u of `H.anchor`; `H.interact` plays the 1.5 s brace-and-wrench (diver pose via existing `diverLookAt` + a short `diverImpulse` back), then hides the lodged prop, sets `survival.hasHarpoon = true` (first pull ever) and returns `{ pulled: true, first, msg }` with msg "IT COMES FREE. SHE FEELS IT." (home first) / "ANOTHER DIVER'S HARPOON." (remote first) / null (wound); a dark plume (stirPulse + 2 s of dark particulate at the wound) on pull. Glint: an additive fog:false sprite on the brass, scaled by lantern facing and distance (same pattern as her eyeshine). First lantern sighting fires "A HARPOON IN HER SIDE. SOMEONE CAME BEFORE YOU." once.
  - Trail: an old lead boot (half-buried) and a broken air-hose coupling placed on the approach (reuse the trail head in brood.js: same positions), each with a one-time line through the existing discoverable mechanism.
  - harpoonSculpt.js: SDF model (iron head with barbs, toggle, brass ferrule, shaft, frayed line stub), baked via `node tools/blender/build.mjs harpoon`; harpoon.js falls back to a procedural lathe+box build if the asset is missing.
  - brooder.js: `L.harpoon = makeHarpoon(L, { wound: pulledAtSite })`, `L.rite = L.harpoon`, wake on `res.pulled`; remove `clutchOut` and every brood-rule branch; she hunts whoever pulled (the existing HUNT target, unburdened speeds).
  - brood.js: delete pry/return/held/clump/shed carry code and `B.prompt`/`B.interact`; keep the clutch build, look and `setClutch` soft solid.
  - game.js: ward-count line drops the egg variant; save gains `tools.harpoon` and `pulled[site]`; `pulled[site] = 1` on pull.
  - playtest.js Alt+6: place Sal at `L.harpoon.anchor` facing the harpoon.

- [ ] **Step 4: Run** `node tools/bench/harpoon-probe.mjs routes 8841` and `rite 8841` → PASS. Re-run the old ritefair play probes for the wards (`docs/playtests/2026-10-09-velkath-after.md` method) — all wards light, she calms, the fissure opens.

- [ ] **Step 5: Commit**

```bash
git add src/entities/sleeper src/lib/harpoonSculpt.js assets/harpoon tools/blender src/game.js src/systems/survival.js src/ui/playtest.js tools/bench/harpoon-probe.mjs
git commit -m "velkath: woken by pulling an old harpoon from her side (clutch stays, brood rule goes); old wound on revisit"
```

---

### Task 7: The harpoon as Sal's blade

**Files:**
- Modify: `src/game.js` (`doSlash`, `pendingSlash`, contact handler ~2372, grab line, title copy), `src/entities/diver.js` (`triggerSlash`, hand prop, thrust pose), `src/world/predators.js` (`slash`), `src/entities/sleeper/hoarder.js` (`onSlash`), `src/entities/sleeper/hunter.js` (no effect check), `index.html` (hint)
- Test: `tools/bench/harpoon-probe.mjs` modes `thrust-contact`, `orune-cut`

**Interfaces:**
- Consumes: `survival.hasHarpoon` (Task 6)
- Produces:
  - `BLADE` (game.js): `{ knife: { contact: 0.22, reach: 3.4, cd: 0.45, power: 1 }, harpoon: { contact: 0.30, reach: 5.5, cd: 0.9, power: 1.8 } }`
  - diver.js `triggerSlash(kind)` — `kind` 'knife'|'harpoon' selects the pose; returns false while recovering
  - predators.js `slash(pos, fwd, range = 3.4, power = 1)` — shark stagger/abort scaled by power
  - hoarder.js `L.onSlash(pos, fwd, reach = 3)` — the cut lands if the blade tip is within `A.r0 * 1.2 + reach` of the holding arm

- [ ] **Step 1: Write the failing probes**

```js
if (mode === 'thrust-contact') {   // owned: contact at 0.30 s, reach 5.5; not owned: knife 0.22 / 3.4
  const r = await c.ev(`(async () => { window.__helm = true; window.gotoZone(0);
    const t = []; for (const own of [false, true]) { window.survival.hasHarpoon = own; window.__slash();
      let hitAt = -1; window.__bench.step(60, i => { if (hitAt < 0 && window.__bladeLast && window.__bladeLast.t >= 0) hitAt = i; });
      t.push({ own, contactFrames: hitAt, reach: window.__bladeLast && window.__bladeLast.reach }); window.__bladeLast = null;
      window.__bench.step(70); }
    return t; })()`);
  const [k, h] = r;
  if (Math.abs(k.contactFrames - 13) > 1 || k.reach !== 3.4) fail.push('knife changed ' + JSON.stringify(k));
  if (Math.abs(h.contactFrames - 18) > 1 || h.reach !== 5.5) fail.push('harpoon timing/reach ' + JSON.stringify(h));
}
if (mode === 'orune-cut') {        // grabbed by Orune, one thrust from 5 u frees him
  const r = await c.ev(`(async () => { window.__helm = true; window.survival.hasHarpoon = true; window.survival.hasSonar = true;
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit7',key:'7',altKey:true,bubbles:true})); window.__bench.step(60);
    window.lev.cmd('wake'); let grabbed = false; window.__bench.step(900, () => { if (window.lev.grab) { grabbed = true; return false; } });
    if (!grabbed) return { grabbed };
    window.__slash(); window.__bench.step(40); return { grabbed, free: !window.lev.grab }; })()`);
  if (!r.grabbed) fail.push('no grab happened in 15 s'); else if (!r.free) fail.push('one thrust did not free him');
}
```

- [ ] **Step 2: Run to verify they fail** → FAIL (`__bladeLast` undefined; harpoon timing = knife).

- [ ] **Step 3: Implement**
  - game.js: `function doSlash() { const b = survival.hasHarpoon ? BLADE.harpoon : BLADE.knife; if (triggerSlash(survival.hasHarpoon ? 'harpoon' : 'knife')) { pendingSlash = b.contact; pendingBlade = b; knife(); } }`; at contact: `const kill = slash(player.pos, forwardVec(), pendingBlade.reach, pendingBlade.power); if (lev && lev.onSlash) lev.onSlash(player.pos, forwardVec(), pendingBlade.reach - 0.4); window.__bladeLast = { t: 0, reach: pendingBlade.reach };` (`__bladeLast` reused object, set fields — no allocation).
  - diver.js: `triggerSlash(kind)` keeps the knife path bit-identical; the harpoon path is a two-handed forward jab (wind-up 0.18 s back, drive to contact at 0.30 s, recover to 0.9 s), both arms on the shaft; the hand prop (sculpted harpoon, procedural fallback) parented to the right hand, shaft laid along the forearm at idle, trailing along the arm in the haul stroke and the burst lean.
  - predators.js: `slash(pos, fwd, range = 3.4, power = 1)`: shark windup/strike abort chance and stagger impulse multiplied by `power`.
  - hoarder.js: `L.onSlash = (pos, fwd, reach = 3) => { ... A.pts[i].distanceTo(pos) < A.r0 * 1.2 + reach ... }`.
  - Copy: hoarder grab line `survival.hasHarpoon ? 'IT HAS YOU. CUT IT — CLICK TO THRUST.' : 'IT HAS YOU. CUT IT — CLICK TO SLASH.'`; index.html hint `click: blade`.

- [ ] **Step 4: Run** both probes → PASS; frames of the idle carry, the swim stroke, the burst lean and a thrust strip.

- [ ] **Step 5: Commit**

```bash
git add src/game.js src/entities/diver.js src/world/predators.js src/entities/sleeper/hoarder.js index.html tools/bench/harpoon-probe.mjs
git commit -m "harpoon: Sal's blade — a heavier two-handed thrust (contact 0.30 s, reach 5.5) through the knife's path"
```

---

### Task 8: Played and recorded (orchestrator)

**Files:** `docs/playtests/2026-10-10-fissure-harpoon.md`, videos under `/Users/michaelpaulus/sc/.abyssa-wt/video/`

- [ ] **Step 1:** Fresh-load invariants (14 lights, `__lev.fp` unchanged, `__safeFailed()`/`__shaderFailed()` [], console clean); record the new terrain fingerprints in CLAUDE.md; `playEnding()` runs and the ascent threads all three openings.
- [ ] **Step 2:** Record with `tools/bench/play.mjs` (`rec start` / `act` / `rec stop`): Velkath home — pull → survive → wards → fissure opens → swim down into zone 1; Velkath at Pallid (first visit "ANOTHER DIVER'S HARPOON."); a revisit (old wound); Orune quick run with the harpoon freeing a grab and her fissure opening; Mhor's fissure opening.
- [ ] **Step 3:** Frames: each zone's fissure shut / opening / open / from the water above; from the raft deck toward the zone-0 glow.
- [ ] **Step 4:** Bench cost of the fissure + light (`__bench.liveAB`, ABBA vs the pre-merge main) — report ms.
- [ ] **Step 5:** Update roadmap cards and CLAUDE.md (rifts → fissure; Velkath's rite; the blade), regenerate the board, push, republish.
