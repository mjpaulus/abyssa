# Velkath Buried, a Rock with a Harpoon in It — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At home, Velkath sleeps sunk in the sand, so all that shows is a ~20 u outcrop of crusted stone with an old harpoon in it. Pulling the harpoon raises her out of the sand in a dust plume. After the calm she points her great claw at the opening crack, walks home and digs herself back in.

**Architecture:**
- **One value drives it:** `L.bury`, from 0 (risen) to 1 (buried).
  - brooder.js `poseAll` sinks her body by `L.buryD × L.bury`.
  - The silt drift becomes a **mound**: a dune mesh in the seabed's own material, CPU-blended between a fitted dune and a flat floor.
  - Her shell takes a **crust** shading term (rockMapSet, triplanar), driven by a uniform.
- **Footing.** The mound and the exposed crest are ground. They are published through `bodyCols.js` and read by:
  - `terrain.js shutFloorY` (the lens, the hose, the sonar);
  - `player.js` (his floor);
  - `diver.js` (the gait's slope rig).
  
  The read goes through one provider hook. With no provider, every reader is the shipped one, bit for bit.
- **The three events:**
  - **The rise** is a sequence on the existing `RISE_T` clock: the crack, the pour, and a new `rise` plume kind.
  - **The point** is a phase of her calm.
  - **The dig-in** runs off today's settle rule.
- **The camera cue.** `POINTCAM` in game.js is built like `CLAWCAM`.
- **Scope.** All of it is switched on by home's sleeper row (`site.js sleepers[0].bury`). The other anchorages carry no `bury` key and stay the shipped ridge.

**Tech Stack:**
- Three.js r184, browser, no build step (CDN importmap).
- Node 23 for tools.
- Headless Chrome over CDP: `tools/bench/drv.mjs`, `cdp.mjs`, `relief-walk.mjs`.
- WebAudio, generated (audio/creatures.js).

**Spec:** `docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md` is the binding authority. Michael approved it ("approved", confirmed "yes"). Read it first. His words, as the spec quotes them:
- "it would be interesting if she was buried in the sand and looked like a rock. Sal would just see what looked like a harpoon in the rock and pulls it out and she rises from the sand. There would be a dust plum as the sand falls off of her";
- "can she turn and point to the void with her giant claw".

**Card:** `roadmap/velkath-buried-rock.md`. It lists the hazards: the seat must still find a seam; her wards stay buried and dark; the plume must not hand him a free blind window unless that is intended; a moved harpoon moves the fight's opening.

**Model policy for execution (Michael, 2026-10-14):**
- **Opus:** open debugging, design calls and subtle game-code reviews. That covers Tasks 2–5, 7a, 7b, 8, 10–13, every game-code review and the final whole-branch review. Task 13 is open debugging: its rule is "a failure is a regression: find it".
- **Sonnet:** clear-brief implementers, probe/tooling/docs reviews and scoped re-reviews. That covers Tasks 1, 6, 9, 14–17 and every tool-diff review.
- **Haiku:** single-file mechanical fixes.
- Never omit the model on a dispatch (an omitted model inherits Opus).

**Measured basis (for this plan, offline, from `assets/sleepers/brooder/brooder.json` `probes.top`, the sculpt's 64×64 top heightfield):**
- Her shell's highest point is 0.4275 shell units (6.58 u) over her body origin, at local (−0.02, −0.10).
- Asleep today her origin sits at the 5-sample mean ground + 0.06 R (0.92 u), so her crest stands about 7.5 u over the floor.
- A crest 3.5 u high needs a sink of about 4.0 u. A flat sand line then exposes a cap 14.0 u across and 23.6 u along her keel (local x −0.37..0.54, z −0.83..0.70). The cap is 13.4 × 23.1 u at a 3.0 u crest and 19.9 × 24.1 u at 4.0 u.
- So the mound must cover the cap's flanks to leave a strip. The defaults below come from these numbers.
- Task 1 re-measures all of this live. The live numbers win.

## Global Constraints

- **Scope: home only.** Michael, 2026-10-15: "I guess, would want to ignore the other anchorages for now ... we should focus on getting one right now."
  - **Decision:** the spec builds her buried at every anchorage. This plan builds, tunes and judges the burial at home only.
  - It is switched on by a key in home's sleeper row, `sleepers[0].bury = { crest: 3.5 }` (site.js). Every other row carries no `bury`.
  - At Pallid Bank, the Burned Ground and the Unsounded Shelf she stays **the shipped ridge, bit for bit**: no sink, no mound, no crust blend (the crust program is shared, at `uBury` 0), no point, no dig-in.
  - Those three must keep passing the probes that already cover them. They are not look-judged.
  - Why not shared: an un-judged burial at three grounds would move three fights' openings with no campaign to measure them. Turning it on there later is a row key plus their own probes.
- **Base and sequencing.**
  - Branch `buried`, worktree `~/sc/.abyssa-wt/buried`. It is cut from main **after the camera fix `lensfix` (card `fight-lens-off-sal`) has merged**.
  - `POINTCAM` and the "no lens in her surface" gate are written against CRECAM as CLAUDE.md describes it. Task 1 records what lensfix changed, on the base commit, before any task touches the camera.
- **Spec values (verbatim):**
  - Crest: "3–4 u high", "about 20 u long".
  - The tell: "visible only within about 8 u", "Every 8–10 s the sand over her lifts a few centimetres and settles".
  - The rise: "A slow, heavy rise of about 6 s", on `RISE_T`. "she is blind for the first 3–4 s" (read, with Michael's leave, as a 3–4 s blind spell from about 3 s into the rise). The plume "spreads to 15–20 u and climbs".
  - The dangers: "The fight's dangers (the drop, the hammer, the tear) start once she stands."
  - The point: "holds it for about 3 s through the line".
  - POINTCAM: "eases round to the opening crack over about 1.5 s ... hands back over about 0.5 s". "A real mouse look drops it at once ... past 5° net or 15° of looking about". "the lens's last rotation, so off means the grounded lens bit for bit". Debug surface `__pointcam`.
  - Digging back in: "`bury` runs from 0 back to 1 over 15–20 s".
  - Cost: "≤ +0.3 ms per frame" at `z0b`, cross-load ABBA against main.
- **Invariants (fresh load, every task that touches game code):**
  - 14 lights.
  - `__lev.fp(0/1/2)` 15ce888c / c938fe6e / 652d0412.
  - `__ridge.fp()` home 5c0705a1; zones 1+2 d49d451d; Pallid b1c58f8d; Burned d2b6fb68.
  - `node tools/relief/validate.mjs` 10/10.
  - `__safeFailed()` and `__shaderFailed()` both `[]`.
  - Console clean except the favicon 404.
- **`sleeperFingerprint`** under the home-only scope:
  - `sleeperFingerprint(0)` is taken with **no site row**, so it **holds 1ca3b28c**. That holding is the proof that the shipped path is untouched.
  - The spec's "moves, with the burial as its named cause" applies to:
    - the row-built home fingerprint (`sleeperFingerprint(0, <home row over>)`, edb51a28 on the relief);
    - relief-load's LIVE anchor.
    
    Both are re-recorded with the cause "the burial, Michael 2026-10-14/15".
  - `sleeperFingerprint(1/2)` ac04921e / ce3eaf9d, and the remote row-built values (Pallid 014f3101, Burned 5dc323ad, Shelf 874758d2), must not move.
- **House code rules:**
  - zero per-frame allocation (module scratch; fits run at events only);
  - no reversed `smoothstep` (always `1.0 - smoothstep(lo, hi, x)`);
  - no backtick inside a GLSL comment;
  - a distinct `customProgramCacheKey` per material variant;
  - everything new is built in the boot tail (no program compiles in play);
  - comments in the file's voice: the why, with the measurement.
- **Off means off.** Every new term is a no-op at the other anchorages and when its knob is 0:
  - `x * (1 - 0)`, `y - 0 * 0`;
  - an extra floor of `-1e9` under `Math.max`;
  - no camera rotation call at all when the cue is off.
  
  Where a task claims bit-identity, it shows how it checked.
- **Gates are pre-registered here, each with a RED.**
  - A RED runs **before** the GREEN work and must fail its own bar. New probes use relief-walk's convention: `*_RED=<variant>` exits **5** when its bar failed as it must, and **3** when it did not.
  - A RED that does not fail as written stops the task. The controller rules (re-derive, or accept with the reason), and the ruling goes in the ledger. Never carry on past it, and never loosen a bar until it passes.
  - Every count has a vacuity floor. A probe that booked nothing is UNMEASURED (exit 2), never a pass.
  - Every probe writes the per-frame series it judged to JSON beside its verdict.
- **THE BENCH CLOCK LEAK** (CLAUDE.md "Perf harness"):
  - Every new `__bench.step` probe plugs the clock with `tools/bench/clockplug.mjs` (Task 1) and books the drift. Drift over 0.05 s, or a running clock, is LOST (exit 4) and is re-run.
  - Walks run on the live loop with real keys (`relief-walk.mjs`), which has no leak.
  - The game.js root fix stays deferred (Ruling 42).
- **Ports.** Never touch 8777, 8790 or 9419, or lensfix's 8884 / 9534–9535.
  - Branch: game 8886, Chrome 9540.
  - A detached main copy at the base, `~/sc/.abyssa-wt/buried-main`: game 8887, Chrome 9541.
  - Load: 8888 / 9542.
  - Extra probe Chromes: 9543–9549.
  - **Every command that drives a browser carries a port of its own:** `DRV_PORT` for drv.mjs-based probes (9540 for the branch, 9541 for the main copy, 9543–9549 for extra Chromes), `BENCH_DBG_PORT` for `cdp.mjs` / `hitch.mjs` (9543). A probe named in prose ("run `harpoon-probe` all modes", "`disguise` PASS") means the command with `DRV_PORT=9540` (the branch) or `DRV_PORT=9541` (the main copy). drv.mjs defaults an unset `DRV_PORT` to the reserved 9419, and only its `start()` / `stop()` refuse it: a connect-only probe would attach to the shared Chrome. So the two new probes (`burial-probe.mjs`, `pointcam-probe.mjs`) exit 2 before importing drv.mjs when `DRV_PORT` is unset or one of 8777 / 8790 / 9419.
  - Set `DRV_PORT` before any dynamic `import('./drv.mjs')`. Stop everything you start.
- **Ownership.** `src/game.js` and `src/player.js` are orchestrator-owned. Tasks 2, 3b and 11 edit them: their reviews are Opus game-code reviews, and the orchestrator merges those hunks itself.
- **Michael's rulings already in hand** (2026-10-15, on the plan's open feel calls: "I thought I already approved this but yes these are fine to proceed with"):
  - **The blind start.** She is blind for 3–4 s starting about 3 s into the rise, so she finds him about 6–7 s after the wake (Task 8).
  - **The breath.** The sand's breathing may be too subtle to see. He judges it on stills; the knob is `BURY.breath.lift` (Task 3a).
  - **The seat.** If no crest seat is both buried in the rock and in his reach, the build stops for his call (Task 4).
- **Michael does not re-approve this plan.** The orchestrator commits it once a scoped re-review passes. His checkpoints are only where he judges a look or a feel:
  - After Task 5 (the crust), with the harpoon already in the rock (Task 4): the spec's "Disguise, judged" stills from 10 u and 20 u in his light. He judges the rock with the harpoon in it, and the growth on her back (Task 5 Step 7). Nothing after Task 5 builds until he has seen them.
  - Task 10, only if its turn bar fails at the pre-registered speed: how fast she swings round to point is a feel call.
  - Task 16: the look and the motion (the plume, the shove, the point, the dig-in, the breath, RIDGE_LINE).
  - The STOP rules below that name him (no crest seat; Task 14's (a)/(b)).
- **The ledger:** `.superpowers/sdd/2026-10-15-velkath-buried-rock/progress.md` in the worktree (git-ignored, as the relief's was): every ruling, every RED's result, every tuning trial. Artefacts go to `~/sc/.abyssa-wt/reviews/buried/` and `~/sc/.abyssa-wt/shots/buried/`.
- **Commits.** Commit WIP early. Every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, never merge, never touch `/Users/michaelpaulus/sc/abyssa`.

**The gates (spec §4), pre-registered:**

| Gate | Pass | RED (must fail first) | Task |
|---|---|---|---|
| Disguise, measured | `burial-probe disguise`: legs, claws, eyes, mouth, wards 0 u over the drawn sand; her sides (shell outside the strip) ≤ +0.02 u; the reef and weed outside the strip ≤ 0 u; crest top 3.0–4.0 u over the mean ground; crest 16–24 u long; the clutch's lobes ≤ −0.05 u under the sand; the harpoon's seam ≥ +0.25 u and its pole ≥ 0 u over the drawn sand (crest excluded) | main (Task 1), `BP_RED=ridge`, `BP_RED=shallow` | 1, 2, 3a, 4, 6 |
| The tell | `burial-probe breath`: the dune's inner ring lifts 0.03–0.06 u, every 8–10 s; trickle only with him within 8 u (0 spawns at 12 u over 30 s). Whether it can be seen at all is Michael's, on stills | `BP_RED=still` | 3a |
| Disguise, judged | stills from 10 u and 20 u in his light, the harpoon in the rock: Michael | n/a | 5, 16 |
| Footing | `relief-walk mound` (lens bars need ≥ 90% of frames on the drawn-height grid): planted boots' OWN gap to the drawn sand or rock p95 ≤ 0.15 u, none under −0.15; her shell's contacts with him (`BODY.last === 'shell'`) 0 on every line; lens ≥ 0.3 u over the drawn surface every frame, never `bodyBlocked(lens, 0)`; no frame at the 50 ms clamp; velfix-gate after the calm: `lensSurf + lensEggs`, `salIn` and `lens.salCalm` 0 on every run | `RW_RED=nofloor-mound`, `RW_RED=nocap` | 3b, 13 |
| No compile in play | `burial-probe programs`, every checkpoint RENDERED with her in frame: `renderer.info.programs.length` equal before the pull, through the rise (the slabs, the plume), the point and the dig-in; `hitch.mjs` no new first-sight compile in its own scenarios | positive control: a visible mesh with a new key, in the frustum for one rendered frame, moves the count +1 | 5, 7b, 10, 12, 13 |
| The rise | `burial-probe rise`: 0 tears, no hammer cock (`threatE` 0) and no drop count (`nsT` 0) from E until she has stood (`hasStood`); a shove + stagger if he stood on her; every ward < 0 u over the sand at the wake, > 2 u at her stand, dark; her body's vertical speed ≤ 8 u/s; her first blind spell, where it ended by line of sight (`clearT`), 3.0–4.0 s long | `BP_RED=noshove`, `BP_RED=tearable`, `BP_RED=early`, `BP_RED=noplume` | 7a, 8 |
| The plume | its density footprint 1.5 u over the floor reaches 15–20 u from her centre at its widest, and climbs ≥ 3 u in 4 s; no living particle overwritten in the 448-quad ring (`plumeState().quadEvicted` 0 over the rise); no live rise record ever overwritten (`plumeState().riseEvicted` 0) | `BP_RED=noplume` | 8 |
| The point | `pointcam-probe point` (hose 760, the calm line booked): her front within 12° of the bearing to `riftPos(0)` when the light starts (fissure k ≥ 0.6), at the pre-registered `POINT.turn` 0.5 rad/s; claw (shoulder→palm) within 20° of the shoulder→opening line; claw up (`pointK` ≥ 0.95) for 2.5–3.5 s, a span that contains the frame "A RIFT OPENS BELOW." first shows; 0 tears. The turn bar failing at 0.5 goes to Michael (feel), never tuned past it | `PC_RED=nopoint` | 10 |
| POINTCAM | `pointcam-probe framing / mouse / off`, Sal placed so the opening is ≥ 60° off the grounded look (`qPre`, printed): the cue closes ≥ 80% of min(θpre, 70°) on ≥ 90% of hold frames, and the opening is in frame (NDC \|x\|,\|y\| ≤ 0.85) on those where θpre ≤ 70°; k ≥ 0.9 by 1.6 s, ≤ 0.1 by 0.6 s after the lower starts; a 6° look drops it within 1 frame and it stays off; 4° net / 10° path keeps it; `on: 0` → lens quaternion == `qPre` on every frame | `PC_ON=0` on framing | 11 |
| Digging back in | `burial-probe digin`: 15–20 s with him clear; `bury` constant (Δ ≤ 1e-9) every frame he is on her ground (on foot and afloat), resumes ≤ `SETTLE.hold` + 1 frame after he leaves; ends at `bury` 1, scar ≥ 0.2 u over the sand, disguise checks pass on the new pose, every ward's light 0 and glow 0 | `BP_RED=fastdig`, `BP_RED=nopause` | 12 |
| Existing probes | harpoon-probe all modes (the crest seat at home, the shipped seat at Pallid / Burned / Shelf); fissure-probe `velkath-crack`, `clearance`, `ending`; brooder-invariants; relief-load `all` (LIVE re-recorded, Task 4); seating-probe | as each probe's own | 4, 13 |
| Fight parity | paired 48-fight campaign against main, relief Task 8b's bars (a), (b), (c)'s first half, (d), (f); (c)'s second half and (e) booked, not gated (Task 14 restates them) | n/a (pre-registered) | 14 |
| Cost | cross-load ABBA, ≥ 4 cycles, quiet machine: mean delta ≤ +0.3 ms at `z0b` and at a near view 8 u off the strip's edge (the breath's rewrite running) | n/a | 15 |
| The look | stills asleep (10 u, 20 u), mid-rise in the plume, the point with the light, buried again; full-take MP4s | n/a | 16 |

## Review Focus

Five ways this change can bite a player that no spec gate exercises. Each has its test in the named task.

1. **Leaving zone 0 mid-rise, mid-point or mid-dig-in and coming back.** She must be rebuilt at her bed, buried and still. No cue stays engaged, the floor provider is the live sleeper's (a disposed sleeper's dune is never solid), and the clutch is hidden. Test: Task 12, `burial-probe reentry`.
2. **Standing on the crest or the dune when he pulls.**
   - The crack shoves him off with a stagger. No tear, never into the crack (safeThrow), never inside her (`bodyBlocked` at his capsule false once the shove has carried him off).
   - The lens stays out of her and the sand while her shell comes up under it.
   
   Test: Task 7a, `burial-probe rise` with him placed on the crest top (`BP_AT=crest`).
3. **On the dune when the dig-in would start or mid-dig, afloat over it too.** The dig-in pauses. The rising dune never closes over him: his boots are never under the drawn sand and the lens is never inside it. Test: Task 12, `burial-probe digin` (`pause`, `afloat`).
4. **A save made before this change.** With `pulled[0]` set, she is buried with the OLD WOUND as a scar in the rock's flank. "[E] PRESS THE OLD WOUND" at the crest raises her the same way and grants nothing. Test: Task 4, `relief-load oldsave` and `harpoon-probe rite`'s revisit.
5. **A voyage from home to Pallid and back.** Nothing stands on home's dune at Pallid, during the reseed or after it: the provider is keyed to the site (bodyCols `setMound`). Pallid's octopus dens (`reseedDens`, placed on `shutFloorY` mid-reseed, before her old build is disposed) lie on Pallid's floor; `extraFloorAt` is −1e9 on a 2 u grid round her bed; Pallid is the shipped ridge (row-built fingerprint 014f3101). Home again is buried with the same LIVE anchor. Test: Task 13, `relief-load voyage` plus the added checks.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/entities/sleeper/burial.js` (new) | `BURY` knobs. `meanGround`, `fitSink`. The mound: `makeMound`, `fitMound`, `setMoundK`, `moundY`, `sandY`, `crestY`, `inStrip`, `shellTopW`. The breath. The back's growth buried (`buryGrowth`). The crust term (`crustTerm`). The crust slabs. `window.__burial` | 2, 3a, 5, 7a, 7b, 12 |
| `src/entities/sleeper/brooder.js` | `L.bury` / `L.buryD` in `poseAll`; her folded feet sunk with her (`restWorld`); `bedDown` build order; publishes the mound; the crust wired (`installSculpt`, `updateBrooder`); the rise beats; the rising guard on contact, hammer and drop; the point; the dig-in; lab verb `calm` | 2, 3a, 3b, 5, 7a, 7b, 8, 10, 12 |
| `src/entities/sleeper/bodyCols.js` | `setMound` (keyed to zone and site), `buriedFloorAt`; the shell's collider capped at the drawn ground while she is fully buried; CALMCOL skipped while the dune is drawn; the shell's `slick` flag; `shellHiAt` (probe) | 3b |
| `src/world/terrain.js` | `setExtraFloor` / `extraFloorAt`; `shutFloorY` takes it | 3b |
| `src/player.js` (orchestrator) | his floor takes `extraFloorAt` | 3b |
| `src/entities/diver.js` | the slope rig's ground takes `extraFloorAt` | 3b |
| `src/game.js` (orchestrator) | `makeZoneSleeper` passes `bury`; `setExtraFloor(buriedFloorAt)` at boot; `POINTCAM` + `__pointcam` | 2, 3b, 11 |
| `src/world/site.js` | home's sleeper row: `bury: { crest: 3.5 }` | 2 |
| `src/entities/sleeper/harpoon.js` | the crest seat under burial (seam and pole over the drawn sand, footing on the dune); `gatherTris`' crest region for the burial test; `H._crestScan`; the rope on the sand | 4 |
| `src/ui/playtest.js` | Alt+6 stands him on the anchor's ground | 4 |
| `src/world/flora.js` | `rockHue(zi)`, `siltHue(zi)`: the zone's rock and silt hues for the crust | 5 |
| `src/entities/sleeper/brood.js` | the clutch under the sand; its find line and the fan held while she is buried | 6 |
| `src/entities/sleeper/plume.js` | the `rise` kind, its 12 records; the footfall ring held to its 8; `plumeState`'s `rise`, `riseEvicted`, `quadEvicted` | 8 |
| `src/audio/creatures.js` | the crack and the pour | 9 |
| `tools/bench/clockplug.mjs` (new) | the plugged clock for stepped probes | 1 |
| `tools/bench/burial-probe.mjs` (new) | modes `disguise` (the harpoon checks from Task 4, the clutch's from Task 6), `breath`, `programs`, `rise`, `digin`, `reentry` | 1, 2, 3a, 4, 5, 6, 7a, 7b, 8, 12 |
| `tools/bench/relief-walk.mjs` | mode `mound` (live loop, real keys, a precomputed drawn-height grid) | 3b |
| `tools/bench/pointcam-probe.mjs` (new) | modes `point`, `framing`, `mouse`, `off` | 10, 11 |
| `tools/bench/harpoon-probe.mjs`, `tools/bench/relief-load.mjs`, `tools/bench/fissure-probe.mjs` | the anchor's ground; LIVE re-recorded; the mound in `clearance` | 3a, 4, 13 |
| `tools/bench/ritepolicy.mjs`, `tools/bench/riteplay.mjs` | his height over the ground read off `max(terrainH, extraFloorAt)` (both arms alike) | 14 |
| `tools/bench/fullplay-gate.mjs` | `FP_UNTIL=<js>`: a route stepped on until it holds (the dig-in take) | 16 |
| `CLAUDE.md`, `roadmap/velkath-buried-rock.md`, `docs/reports/2026-10-15-velkath-buried-rock.md` | the record | 17 |

**Order and dependencies:**
- Tasks run in order: 1 (the base and a RED on main) → 2 → 3a → 3b → 4 (the harpoon on the crest, its feasibility scan first) → 5 (the crust) → **Michael sees the disguise with the harpoon in it** → 6 → 7a → 7b → 8 → … → 17.
- Task 4 depends only on 3a and 3b, not on the crust. With the seat before the checkpoint, Michael judges the reveal itself ("what looked like a harpoon in the rock"), and a seat-driven crest change can never follow his approval.
- The crest's knobs are frozen after the checkpoint. Changing them later re-runs Task 4 (the seat), Task 13 and Task 14 (the opening).

---

### Task 1: The base, lensfix's change, the plugged clock, and the disguise RED on main

**Files:**
- Create: `tools/bench/clockplug.mjs`, `tools/bench/burial-probe.mjs`.
- Create (git-ignored): `.superpowers/sdd/2026-10-15-velkath-buried-rock/progress.md`.

**Interfaces:**
- Produces:
  - `clockplug.mjs`: `plug(c, { stop })` (holds rAF, counts stepped frames, and with `stop` (the default) `clock.stop()`), `drift(c)` → `{ run, stepped, drift, running }` or null, `unmeasured(d)` → bool (no reading), `lost(d)` → bool (a reading over the bar), `CLOCK_LOST` 0.05.
  - `burial-probe.mjs <mode> <port>`, exit codes 0 / 1 fail / 2 unmeasured / 3 RED did not fail / 4 LOST / 5 RED failed as it must.
  - Mode `disguise` prints one JSON line `DISGUISE {...}`.

- [ ] **Step 1: Cut the branch on the base.** After lensfix has merged: `git -C /Users/michaelpaulus/sc/abyssa worktree add ~/sc/.abyssa-wt/buried -b buried main`. Also add a detached main copy for paired runs: `git -C /Users/michaelpaulus/sc/abyssa worktree add --detach ~/sc/.abyssa-wt/buried-main main`. Record the base hash in the ledger.

- [ ] **Step 2: Record what lensfix changed.** Before anything touches the camera:
  - Run `git -C ~/sc/.abyssa-wt/buried log --oneline 15bc610..HEAD -- src/game.js src/entities/sleeper/bodyCols.js` and `git diff 15bc610 HEAD -- src/game.js`.
  - Read `updateCamera` from `const SALCAP` through `clawFrame(dt)` on the base.
  - Write into the ledger, under "lensfix on the base":
    - every new or changed constant (CRECAM fields, the new drop rule's name and knobs);
    - what `window.__crecam.state()` now returns;
    - whether the after-calm "lens inside her shell" case is handled by the guard;
    - lensfix's own GREEN numbers from `~/sc/.abyssa-wt/reviews/lensfix/report.md`.
  
  Tasks 3b, 11 and 13 read this entry. If lensfix renamed or removed anything this plan names (`CRECAM`, `creBoomClear`, `creLensAhead`, `SALCAP`, `clawFrame`, `__crecam`), stop and ask the controller.

- [ ] **Step 3: Invariants on the base.** Serve the branch: `python3 serve.py 8886` from the worktree. Run:
  - `DRV_PORT=9540 node tools/bench/relief-load.mjs all 8886`: PASS.
  - `node tools/relief/slice.mjs && node tools/relief/validate.mjs`: 10/10.
  - `brooder-invariants` connects to a Chrome that is already up, so start one on the branch's own port first:
    - `DRV_PORT=9540 node tools/bench/drv.mjs start "http://localhost:8886/?playtest"`;
    - `DRV_PORT=9540 node tools/bench/brooder-invariants.mjs` (it reloads the page fresh). Expected: 14 lights, `sleeperFp` 1ca3b28c / ac04921e / ce3eaf9d;
    - `DRV_PORT=9540 node tools/bench/drv.mjs stop`.
    
    Never run the CLI without `DRV_PORT`: its default is 9419.
  
  Also read the row-built home fingerprint, as `makeZoneSleeper` builds the row:
  `(await import('/src/entities/leviathan.js')).sleeperFingerprint(0, { nSigils: 3, hue: (await import('/src/config.js')).LEVIATHAN_CFG[0].hue, idle: null, lair: { face: -1, seat: 'back' }, hard: { lift: 0.55 } })`
  
  `sleeperFingerprint` builds and disposes its own sleepers under the live one (`clearBodyCols`, `clearPlumes`, the ward pool's live pointer). So evaluate it in a load of its own, as the last read of that load, then reload; never between other reads. Expected edb51a28. Record it. Task 4 re-records it with the burial, inside relief-load at the place its existing `sleeperFingerprint` reads already run.

- [ ] **Step 4: Write `tools/bench/clockplug.mjs`.**

```js
// THE PLUGGED CLOCK for stepped probes (seafloor relief Ruling 42; CLAUDE.md "THE BENCH CLOCK LEAK"). game.js's bench hold(false)
// calls clock.getDelta(), and three r184's getDelta ADDS the wall time since its last call to clock.elapsedTime, so every
// __bench.step pushed the game's t on by its own wall time (1.5-2.1x the stepped time): the current, the tear gate, the weather.
// riteplay.mjs and fullplay-gate.mjs plug it inline; new probes import this. plug(c) once the page is up: the live loop is held,
// the clock stopped, every stepped frame counted. drift(c) at the end: unmeasured(d) = no reading at all (exit 2); lost(d) = a
// reading over the bar (exit 4, re-run). plug(c, { stop: false }) keeps the counter and skips only clock.stop(): the drift RED
// (fullplay-gate.mjs FP_NOPLUG's way), which must show a NUMERIC drift over the bar, never a missing one.
export const CLOCK_LOST = 0.05;
export async function plug(c, { stop = true } = {}) {
  await c.ev(`(window.requestAnimationFrame = cb => { window.__rafCb = cb; return 0; }, 1)`);
  await new Promise(r => setTimeout(r, 300));
  return c.ev(`(async () => {
    const { clock } = await import(new URL('src/core.js', document.baseURI).href);
    if (${stop}) clock.stop();
    const S0 = window.__bench.step;
    window.__plugClk = { clock, e0: clock.elapsedTime, n: 0 };
    window.__bench.step = (n, fn, o) => S0(n, i => { window.__plugClk.n++; return fn ? fn(i) : undefined; }, o);
    return 1; })()`);
}
export async function drift(c) {
  return c.ev(`(() => { const k = window.__plugClk; if (!k) return null; const run = k.clock.elapsedTime - k.e0, stepped = k.n / 60;
    return { run: +run.toFixed(3), stepped: +stepped.toFixed(3), drift: +(run - stepped).toFixed(4), running: !!k.clock.running }; })()`);
}
export const unmeasured = d => !d || !Number.isFinite(d.drift) || !(d.stepped > 0);
export const lost = d => !unmeasured(d) && (Math.abs(d.drift) > CLOCK_LOST || d.running);
```

- [ ] **Step 5: Write `tools/bench/burial-probe.mjs` with the `disguise` mode.** Its header documents every mode this plan adds (Tasks 2–12 fill them in), the exit codes and the env:
  - `BP_KNOBS` (JSON patched through `__burial.set` before the mode);
  - `BP_RED`;
  - `BP_AT` (where he stands: `anchor`, `crest`, `off`);
  - `BP_NOPLUG` (the drift RED: `plug(c, { stop: false })`).
  
  Its first lines, before any import of drv.mjs: `const P = +process.env.DRV_PORT; if (!Number.isInteger(P) || [8777, 8790, 9419].includes(P)) { console.error('burial-probe: set DRV_PORT to a port of its own (not 8777 / 8790 / 9419)'); process.exit(2); }`. `pointcam-probe.mjs` (Task 10) opens the same way.

```js
// THE BURIAL PROBE (velkath-buried-rock; spec docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md §1-§4).
//   DRV_PORT=9540 node tools/bench/burial-probe.mjs <disguise|breath|programs|rise|digin|reentry> <port>
// Stepped on the PLUGGED clock (clockplug.mjs). Exit 0 pass | 1 a bar failed | 2 UNMEASURED | 3 a BP_RED whose bar did NOT fail
// | 4 LOST (clock drift) | 5 a BP_RED whose bar failed, as it must. JSON of every series judged -> BP_OUT (default
// ~/sc/.abyssa-wt/reviews/buried/burial-<mode>-<tag>.json).
//   disguise  home, zone 0, Velkath dormant at her bed. THE DRAWN SAND at (x, z) = max(terrainH, the dune's drawn surface
//             (__burial.sandAt; absent on main)). Every vertex of her legs, claws, eyes / stalks, mouthparts and every ward
//             centre: its height over the drawn sand (max, per part; bar <= 0). HER SIDES: her shell's vertices outside the
//             crest strip (__burial.inStrip; on main the strip's default ellipse, BURY_DEFAULT below) over the drawn sand
//             (bar <= +0.02). THE CREST: her shell's vertices over the drawn sand: top over the mean ground (poseAll's 5 x 5
//             grid; bar 3.0-4.0 u), length along her keel (bar 16-24 u). THE CLUTCH (Task 6 on): every live lobe's top (r x
//             1.25) <= -0.05 u under the sand. THE HARPOON (Task 4 on): the seam >= +0.25 u, every pole sample >= 0 u over the
//             DRAWN SAND (terrain or dune, never the crest: harpoon.js seat()'s own test). THE GROWTH ON HER BACK (Task 3a on):
//             every reef and weed vertex OUTSIDE the strip <= 0 over the sand (inside it, growth on a rock is allowed).
//             BP_CHECK=<comma list> limits the verdict to those checks (the tasks before the mound check height / limbs only).
// BP_RED variants (each must fail ITS bar): ridge (__burial.set({on:0}): the shipped ridge at home) -> sides, crest;
// shallow (crest 5.5) -> crest height. A page-side throw is UNMEASURED (exit 2), never a fail (1) or a RED's pass (5).
// __burial.set rebuilds her through __lev.remember(null), outside game.js keepingPrograms: her programs are released and
// rebuilt, so a `programs` reading taken after a set is not a play reading (that mode never sets knobs).
```

  The page side of `disguise`, as code:

```js
const DISGUISE = `(async () => {
  const THREE = await import('three'), T = await import('/src/world/terrain.js');
  const L = window.lev; if (!L || L.kind !== 'brooder' || !L.dormant) return { err: 'no dormant brooder (' + (L && L.kind) + ')' };
  L.grp.updateMatrixWorld(true);
  const B = window.__burial || null;
  const BD = { crestL: 20, crestW: 6, crestZ: -0.07 };            // BURY_DEFAULT: main has no __burial
  const sand = (x, z) => Math.max(T.terrainH(x, z, 0), B && B.sandAt ? B.sandAt(x, z) : -1e9);   // (sandAt / inStrip from Task 3a)
  const inv = new THREE.Matrix4().copy(L.body.matrixWorld).invert(), v = new THREE.Vector3(), lv = new THREE.Vector3();
  const m = new THREE.Matrix4(), m2 = new THREE.Matrix4();
  const stripEll = (lx, lz) => { const a = BD.crestW / 2 / L.R, b = BD.crestL / 2 / L.R, q = lz - BD.crestZ; return (lx / a) ** 2 + (q / b) ** 2 < 1; };
  const inStrip = (x, z) => B && B.inStrip ? B.inStrip(x, z) : (lv.set(x, L.bodyY, z).applyMatrix4(inv), stripEll(lv.x, lv.z));
  const worst = {}, n = {};
  const book = (part, x, y, z) => { const d = y - sand(x, z); n[part] = (n[part] || 0) + 1;
    if (!(part in worst) || d > worst[part].d) worst[part] = { d: +d.toFixed(3), at: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)] }; };
  const mesh = (part, o, stride = 1) => { o.updateMatrixWorld(true); const P = o.geometry.attributes.position;
    const each = mw => { for (let i = 0; i < P.count; i += stride) { v.fromBufferAttribute(P, i).applyMatrix4(mw); book(part, v.x, v.y, v.z); } };
    if (o.isInstancedMesh) for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); each(m2.multiplyMatrices(o.matrixWorld, m)); } else each(o.matrixWorld); };
  for (const k of ['coxa', 'femur', 'tibia', 'dactyl']) mesh('legs', L.legs[k], 3);
  for (const c of L.claws) for (const o of [c.merus, c.carpus, c.palm, c.dact]) mesh('claws', o, 3);
  mesh('eyes', L.parts.eyes); if (L.parts.stalks) mesh('eyes', L.parts.stalks);
  for (const q of L.mouth) mesh('mouth', q.hook, 3);
  for (const g of L.sigils) book('wards', g.grp.position.x, g.grp.position.y, g.grp.position.z);
  // the growth on her back, outside the strip only (a sea fan standing out of a dune is a tell; on the rock it is growth)
  const grow = (part, o) => { o.updateMatrixWorld(true); const P = o.geometry.attributes.position, I = o.geometry.index;
    const at = (i, mw) => { v.fromBufferAttribute(P, i).applyMatrix4(mw); if (!inStrip(v.x, v.z)) book(part, v.x, v.y, v.z); };
    if (o.isInstancedMesh) { for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); if (m.elements[0] === 0 && m.elements[5] === 0) continue;   // (a buried frond: scale 0)
      m2.multiplyMatrices(o.matrixWorld, m); for (let i = 0; i < P.count; i += 2) at(i, m2); } }
    else if (I) { const ix = I.array; for (let q = 0; q < ix.length; q += 3) at(ix[q], o.matrixWorld); }   // (the index DRAWN: buried, burial.js swaps in the strip's own)
    else for (let i = 0; i < P.count; i += 2) at(i, o.matrixWorld); };
  if (L.parts.reef) grow('reef', L.parts.reef);
  if (L.parts.weed) grow('weed', L.parts.weed);
  // her shell: sides vs crest
  const sh = L.parts.shell, P = sh.geometry.attributes.position; sh.updateMatrixWorld(true);
  let top = -1e9, zLo = 1e9, zHi = -1e9, ne = 0, sides = { d: -1e9, at: null };
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(sh.matrixWorld); const d = v.y - sand(v.x, v.z);
    if (!inStrip(v.x, v.z)) { if (d > sides.d) sides = { d: +d.toFixed(3), at: [+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)] }; continue; }
    if (d > 0.02) { ne++; top = Math.max(top, v.y); lv.copy(v).applyMatrix4(inv); zLo = Math.min(zLo, lv.z); zHi = Math.max(zHi, lv.z); } }
  // the mean ground under her: poseAll's 5 x 5 support grid
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw); let g = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { const lx = (-0.8 + 0.4 * i) * L.R, lz = (-0.84 + 0.425 * j) * L.R;
    g += T.terrainH(L.pos.x + lx * cy + lz * sy, L.pos.z - lx * sy + lz * cy, 0); }
  g /= 25;
  const out = { worst, n, sides, crest: { top: +(top - g).toFixed(2), len: ne ? +((zHi - zLo) * L.R).toFixed(1) : 0, n: ne }, buried: !!(B && L.buried), bury: L.bury ?? null };
  // (Task 6) the clutch, (Task 4) the harpoon: added there
  return out; })()`;
```

  The verdicts:
  - `legs` / `claws` / `eyes` / `mouth` / `wards`: worst ≤ 0;
  - `reef` / `weed` (outside the strip): worst ≤ 0 (judged from Task 3a on: before the dune covers her flanks they stand on the floor's level by design);
  - `sides` ≤ +0.02;
  - `crest.top` in [3.0, 4.0];
  - `crest.len` in [16, 24];
  - any part with `n` 0 is UNMEASURED.

  The node side: plug the clock, `__chart.arrive(0)`, `gotoZone(0)`, `__bench.step(30)`, apply `BP_KNOBS` / the `BP_RED` patch through `__burial.set` (absent on main: a RED on main is the measurement itself), evaluate (a page-side throw or `err` → exit 2), judge, write JSON. Then the clock: `unmeasured(await drift(c))` → exit 2; `lost(...)` → exit 4.

- [ ] **Step 6: The RED on main.** Serve the main copy: `python3 serve.py 8887` from `~/sc/.abyssa-wt/buried-main`. Run `DRV_PORT=9541 node tools/bench/burial-probe.mjs disguise 8887`.
  - Expected: FAIL (exit 1) on `sides` (her shipped flanks stand metres over the floor) and `crest.top` (~7.5 u), and most likely `legs` (folded under the rim, over the floor where the drift hides them).
  - Paste the JSON numbers into the ledger: they are the "before". If `crest.top` is not 6.5–8.5 u, the measured basis above is wrong. Note it, and use the live number in Task 2.
  - Then `BP_NOPLUG=1` must print LOST with a numeric drift over 0.05 s (exit 4). A null or missing drift is exit 2 and is not the RED.

- [ ] **Step 7: Commit** `tools/bench/clockplug.mjs`, `tools/bench/burial-probe.mjs`: `burial-probe: the disguise measured (RED on main: <sides> / <crest> u); clockplug for stepped probes`.

---

### Task 2: She sinks — `L.bury`, the sink depth, the row key

**Files:**
- Create: `src/entities/sleeper/burial.js`.
- Modify:
  - `src/entities/sleeper/brooder.js`: the `L` init, `poseAll`, `restWorld` (her folded feet), the lair block's build calls, `cmd('place')`, the sculpt-landing path, `installSculpt` (keeps `L.topAt`), `L.probe`.
  - `src/world/site.js`: home's sleeper row.
  - `src/game.js` (orchestrator): `makeZoneSleeper`'s `over`.

**Interfaces:**
- Produces:
  - `burial.js`:
    - `BURY` (knobs);
    - `meanGround(L)` → number;
    - `fitSink(L, crest)` → depth u (call with `L.bury` 0).
  - brooder.js:
    - `L.buried` (bool);
    - `L.crest` (u);
    - `L.bury` (0..1);
    - `L.buryD` (u);
    - `L.meanG`;
    - `L.breathU` (the unburied breath term, u);
    - `L.breathY` (the sand's breath lift, u: Task 3a);
    - `L.topAt(lx, lz)` → her shell's top in shell units or null;
    - `bedDown(L, noHarpoon)`.
  - `window.__burial = { knobs, state(), set(patch) }` (rebuilds the zone's sleeper with `__lev.remember(null)`: no placement).

- [ ] **Step 1: The RED for this task's checks.**
  - Run `DRV_PORT=9540 BP_CHECK=height,legs,claws,eyes,mouth,wards node tools/bench/burial-probe.mjs disguise 8886` on the unchanged branch.
  - Expected: FAIL on `crest.top` (and `legs` if Task 1 saw it). Record it.

- [ ] **Step 2: Write `burial.js` (this task's part).**

```js
// THE BURIAL — Velkath asleep as a rock with an old harpoon in it (velkath-buried-rock; spec
// docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md; Michael 2026-10-14: "it would be interesting if she was buried
// in the sand and looked like a rock"). HOME ONLY (Michael 2026-10-15: "we should focus on getting one right now"): the site row's
// sleepers[0].bury switches it on; without it nothing here is called and she is the shipped ridge bit for bit.
// ONE VALUE DRIVES IT: L.bury, 0 risen .. 1 buried. brooder.js poseAll sinks her body L.buryD * L.bury under her bed; the mound is
// drawn over her at L.bury; the crust shades her shell at L.bury. Fits run at events (her build, the dig-in's start), never per
// frame; zero per-frame allocation.
import * as THREE from 'three';
import { V3 } from '../../lib/math.js';
import { terrainH } from '../../world/terrain.js';

// crest   u: her crest's top over the mean ground under her (spec: 3-4 u); the row may set it (home: 3.5)
// on      dev A/B (__burial.set): 0 = the shipped ridge at home too
export const BURY = { on: 1, crest: 3.5 };
const _v = V3();

// the mean ground under her: poseAll's own 5 x 5 support grid over her footprint, bare floor
export function meanGround(L) {
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), R = L.R;
  let s = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const lx = (-0.8 + 0.4 * i) * R, lz = (-0.84 + 0.425 * j) * R;
    s += terrainH(L.pos.x + lx * cy + lz * sy, L.pos.z - lx * sy + lz * cy, L.idx);
  }
  return s / 25;
}
// THE SINK (spec §1: "the depth that puts the crest's top 3–4 u above the mean ground under her"), read off her DRAWN shell in the
// pose she is in (L.bury 0): its highest vertex, less the sleeping breath's lift at this instant (L.breathU) so the depth does not
// depend on the phase of a breath at the fit.
export function fitSink(L, crest) {
  const sh = L.parts.shell, P = sh.geometry.attributes.position;
  L.body.updateMatrixWorld(true);
  const mw = sh.matrixWorld;
  let top = -1e9;
  for (let i = 0; i < P.count; i++) { _v.fromBufferAttribute(P, i).applyMatrix4(mw); if (_v.y > top) top = _v.y; }
  L.meanG = meanGround(L);
  L.crestTop0 = top - L.breathU;
  return Math.max(0, L.crestTop0 - L.meanG - crest);
}
```

- [ ] **Step 3: brooder.js — the state and the pose.**
  - In `makeBrooder`, after `L.standLift = ...`:

```js
  // (velkath-buried-rock) BURIED (site.js sleeper row `bury`: home only). Absent, L.bury and L.buryD stay 0 and every term they
  // enter is the shipped one bit for bit (x * (1 - 0), y - 0 * 0).
  L.buried = !!(c.bury && BURY.on);
  L.crest = L.buried ? (c.bury.crest ?? BURY.crest) : 0;
  L.bury = 0; L.buryD = 0; L.breathU = 0; L.breathY = 0;
  L.topAt = (x, z) => { const h = G.shellAt(x, z, _sa).h; return Math.hypot(x, z) <= G.rimR(Math.atan2(z, x)) ? h : null; };   // procedural; installSculpt swaps in the bake's
```

  (Add `const _sa = {};` to the module scratch.)

  - In `installSculpt`, inside `if (top) { ... }`, keep the heightfield on `L` **before** `G.setShellHeight(null)`:

```js
    L.topAt = (x, z) => {   // (velkath-buried-rock) the bake's own top probe, kept: the mound and the crest's footing read it
      const fx = (x - x0) / (x1 - x0) * (n - 1), fz = (z - z0) / (z1 - z0) * (n - 1);
      if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return null;
      const i = Math.min(n - 2, fx | 0), j = Math.min(n - 2, fz | 0), tx = fx - i, tz = fz - j;
      const a = h[j * n + i], b = h[j * n + i + 1], c2 = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
      if (a == null || b == null || c2 == null || d == null) return a != null ? a : b != null ? b : c2 != null ? c2 : d;
      return (a * (1 - tx) + b * tx) * (1 - tz) + (c2 * (1 - tx) + d * tx) * tz;
    };
```

  - In `poseAll`, replace the breath line and append to `L.bodyY`:

```js
  const breath0 = (0.012 * Math.sin(L.t * 0.45) + 0.004 * Math.sin(L.t * 1.07 + 1)) * (1 - hc);
  // (velkath-buried-rock) buried, her own breath is the SAND's (burial.js: a few cm every 8-10 s, L.breathY): the 0.18 u bob of the
  // bedded ridge would be the tell at any range
  const breath = breath0 * (1 - L.bury);
  L.breathU = breath0 * R;
```

  ```js
  L.bodyY = gy + R * (lerp(0.06, STAND.h - CROUCH.drop * cK, hv) + 0.10 * liftK * (1 - cK) + breath - DORM.drop * (1 - hv) + 0.06 * ck + 0.05 * h) + L.standLift * hv + L.bY.x
    - L.buryD * L.bury + L.breathY * L.bury;   // (velkath-buried-rock) sunk under her bed, the sand's breath with her
  ```

  - In `restWorld`, her folded feet sink with her body. Dormant, `updateBrooder` re-plants every foot each frame on `restWorld`'s ground (the `else` branch: `f.planted.lerp(_rw, ...)`), and `poseAll` lifts each target `R × (FOOT_LIFT0 + FOOT_LIFTF)` ≈ 1.06 u. Sunk 4 u with her feet left on the old floor, her dactyls would stand about 1 u over the sand some 13 u out, where the dune is thin:

```js
  out.y = groundAt(L, out.x, out.z, true);           // a rock's top is ground too
  // (velkath-buried-rock) her folded feet go down with her: buried, the rest spot is under her bed by the sink (rising, bury eases to 0
  // and the sprawl's lerp brings them up with her; awake they are planted on the ground by reachFoot, as shipped)
  if (L.buried) out.y -= L.buryD * L.bury;
  return out;
```

- [ ] **Step 4: brooder.js — the build order (`bedDown`).**

  Add:

```js
// HER BED, in the order the burial needs (velkath-buried-rock): the clutch rests on the floor of her UNSUNK pose (so after a calm her
// tongue of eggs lies on the sand exactly as shipped, and buried it is under the floor with her); then the sink, then (Task 3a) the
// mound over the sunk pose, then (Task 4) the harpoon on the crest. Called only when L.buried: the shipped paths keep their own lines.
function bedDown(L, noHarpoon = false) {
  L.bury = 0; poseAll(L, 0, null);
  if (L.brood) L.brood.seat();
  L.buryD = fitSink(L, L.crest);
  L.bury = 1;
  for (let li = 0; li < 8; li++) { const f = L.feet[li]; restWorld(L, li, f.planted); f.cur.copy(f.planted); f.t = -1; }   // the feet sunk now, not over a second
  poseAll(L, 0, null);
  if (L.harpoon && !noHarpoon) { L.harpoon.keep(); L.harpoon.seat(); }
}
```

  Then route the three build paths through it, each as an `if (!L.buried) { <shipped lines, unchanged> } else { ... }` so the shipped path stays visibly identical:
  - **The first build:** `poseAll(L, 0, null); seatRite(L, !!SC); buildSkirt(L); if (SC) {...} else SCULPT.then(...)` becomes, buried: `bedDown(L, !!SC); if (SC) { installSculpt(L, SC); if (L.dormant) bedDown(L); } else SCULPT.then(a => { if (a && !L.gone) { installSculpt(L, a); if (L.dormant) bedDown(L); else poseAll(L, 0, null); } });`
  - **`cmd('place')`:** buried, `placeAt(L, arg.pos, arg.yaw); if (L.dormant) bedDown(L);`.

  Note: `fitSink` reads the drawn shell. Before the sculpt lands the procedural shell gives a different top, and the sculpt landing re-runs `bedDown`.

- [ ] **Step 5: `L.probe()` and `__burial`.** Add `bury: +L.bury.toFixed(4), buryD: +L.buryD.toFixed(3), buried: !!L.buried, meanG: L.meanG ?? null` to `L.probe()`. In burial.js:

```js
if (typeof window !== 'undefined') window.__burial = {
  knobs: BURY,
  state: () => { const L = window.__sl; return L && L.kind !== undefined ? { buried: !!L.buried, bury: L.bury, buryD: L.buryD, crest: L.crest, meanG: L.meanG } : null; },
  // patch the knobs (a `crest` key also writes the live home row) and rebuild the zone's sleeper IN PLACE (__lev.remember(null):
  // a fresh build at her bed, as enterZone builds her; __lev.swap would set her down in front of the diver)
  async set(p) {
    for (const k in p) { if (BURY[k] && typeof BURY[k] === 'object' && !Array.isArray(BURY[k])) Object.assign(BURY[k], p[k]); else BURY[k] = p[k]; }
    if ('crest' in p) { const S = await import('../../world/site.js'); const r = S.currentSite().sleepers[0]; if (r && r.bury) r.bury.crest = p.crest; }
    window.__lev.remember(null); return this.state();
  }
};
```

  (Task 3a adds `sandAt` and `inStrip` to it; the probe guards for their absence on this task's head. Every later task adds its knobs to `BURY`.)

- [ ] **Step 6: The row and its wiring.**
  - In `site.js`, home's row becomes `sleepers: [{ sigils: 3, hueShift: 0, idle: null, lair: { face: -1, seat: 'back' }, hard: { lift: 0.55 }, bury: { crest: 3.5 } }, null, null]`.
  - Add to the row's comment: "bury: velkath-buried-rock, home only (Michael 2026-10-15); the crest's height over her ground (spec 3–4 u)".
  - Update the header's table line `sleepers[i].idle / lair / hard` → `idle / lair / hard / bury`.
  - In `game.js` `makeZoneSleeper`: `idle: row.idle || null, lair: row.lair || null, hard: row.hard || null, bury: row.bury || null`.

- [ ] **Step 7: GREEN for this task.**
  - `DRV_PORT=9540 BP_CHECK=height,legs,claws,eyes,mouth,wards node tools/bench/burial-probe.mjs disguise 8886`: PASS.
    - `crest.top` within ±0.05 of 3.5, measured against the floor alone. Her sides still stand over the floor: the mound comes in Task 3a.
    - `legs` is gated here: Step 3's `restWorld` line sinks her folded feet with her. If `legs` or `claws` still fail (a joint over the floor), report the part and its height. Do **not** deepen the sink: the knob is the crest height, which the spec fixes. The controller rules.
  - `BP_RED=shallow` (crest 5.5): exit 5.
  - At Pallid, `__chart.arrive(1)` then `lev.probe()`: `buried false`, `bury 0`, `buryD 0`.
  - Invariants (Global Constraints). `sleeperFingerprint(0)` holds 1ca3b28c. The row-built home value moves; record it, it is re-recorded in Task 4.

- [ ] **Step 8: Commit** `burial.js`, `brooder.js`, `site.js`, `game.js`: `velkath buried: L.bury and the sink (crest <top> u over her ground, sink <buryD> u), home's row bury; the shipped ridge elsewhere bit for bit`.

---

### Task 3a: The mound — the drift grown over her, and the tell

**Files:**
- Modify:
  - `src/entities/sleeper/burial.js`: the mound, `moundY`, `sandY`, `crestY`, `inStrip`, `shellTopW`, the breath, `buryGrowth`.
  - `src/entities/sleeper/brooder.js`: `bedDown` builds and fits it; `updateBrooder` blends it, runs the breath and buries the growth on her back.
  - `tools/bench/fissure-probe.mjs`: `clearance` reads the mound where the skirt was.
  - `tools/bench/burial-probe.mjs`: the `breath` mode.

**Interfaces:**
- Consumes: Task 2's `L.bury`, `L.buryD`, `L.meanG`, `L.topAt`, `bedDown`.
- Produces:
  - `makeMound(L, material)` → `MD`;
  - `fitMound(L, MD, seabedColor, fissureDist)`;
  - `prepGrowth(L, MD)`;
  - `setMoundK(MD, k, breathY)`;
  - `moundY(MD, x, z)` → the drawn sand's y, or −1e9 in the strip or off the dune;
  - `sandY(MD, x, z, zi)` → `max(terrainH, moundY)`: the drawn sand, never the crest (the harpoon's seam and pole test against it);
  - `crestY(MD, x, z)` → her shell's top inside the strip band, or −1e9;
  - `inStrip(MD, x, z)` → bool;
  - `shellTopW(MD, x, z)` → her shell's top under WORLD (x, z) at the fit pose (full matrix), or NaN;
  - `breathTick(L, dt, player, camPos, emitDust)`;
  - `buryGrowth(L, on)` (the reef and weed outside the strip hidden while she is buried);
  - `L.mound = MD`;
  - `MD.drawn` (bool), `MD.mesh` (in `L.grp`, the seabed's material);
  - `__burial.sandAt(x, z)`, `__burial.inStrip(x, z)`.

- [ ] **Step 1: The RED.**
  - Run `disguise` (all checks) on the Task 2 head. Expected: FAIL on `sides` (the cap's flanks stand over the floor) and on `crest.len` if the cap is long. Record it.
  - Write the `breath` mode first and run it: FAIL (no breath, amplitude 0).
  - The `reef` / `weed` checks: FAIL or pass, recorded. On the Task 2 head they stand on the shell with nothing over them.

- [ ] **Step 2: The knobs** (append to `BURY`). The values come from the measured basis: a strip 6 × 20 u on a cap 14 × 23.6 u.

```js
// THE MOUND (spec §1 "The sand mound"): a dune over her sunk shell that leaves only a strip of her back's crest showing.
//   crestL / crestW  u: the strip, an ellipse along her keel (spec: "about 20 u long"); crestZ its centre (shell units: the bake's
//                    top lies at z -0.10)
//   edgeMin  u: on each bearing the strip's edge is pulled in until her shell there stands this high over the mean ground (the
//            keel falls away at her ends: no pit of sand-walled shell)
//   reveal   u: the rock stands this far out of the sand at the strip's edge (ring 0 lies this far inside her shell)
//   cover    u: sand over her shell outside the strip, at the least; repose: the dune's fall per unit run (0.55 ~ 29 deg)
//   rings    the dune's rings from the edge to where it meets the floor (+2 buried a hair under it); ringStep u, the march
//   sandOpen u: the strip's edge pushed out on her SAND side (where he comes in and the harpoon goes), so more of that flank shows as
//            a face of rock: a lopsided outcrop. 0 = the symmetric strip. Task 4's seat scan decides whether it is needed; if it is,
//            the shape goes to Michael at Task 5's checkpoint as a choice
//   breath   the tell (spec): a lift of `lift` u every period s (up s, down s); drawn only with the lens within `draw` u; the
//            trickle only with him within `near` u (spec: "visible only within about 8 u"). Michael, 2026-10-15: it may be too subtle
//            to see; he judges it on stills ("I thought I already approved this but yes these are fine to proceed with"); the knob
//            is `lift`
Object.assign(BURY, { crestL: 20, crestW: 6, crestZ: -0.07, sandOpen: 0, edgeMin: 1.2, reveal: 0.35, cover: 0.3, repose: 0.55, rings: 14, ringStep: 0.25,
  breath: { lift: 0.045, period: [8, 10], up: 1.6, down: 2.6, draw: 12, near: 8 } });
```

- [ ] **Step 3: The mound's mesh and fit.** In burial.js:

```js
const NB = 128;   // bearings (the skirt's SK_COLS)
const _p = V3(), _q = V3();
const RIN = new Float32Array(NB), RS = new Float32Array(NB), PROF = new Float32Array(160), PROFR = new Float32Array(160);
export function makeMound(L, material) {
  const NR = BURY.rings + 2, n = NB * NR, g = new THREE.BufferGeometry();
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  const idx = [];
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NB; j++) {
    const a = i * NB + j, b = i * NB + (j + 1) % NB, c = a + NB, d = b + NB;
    idx.push(a, b, c, b, d, c);
  }
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, material);              // the seabed's own (SHARED: lifted out before disposeSleeper, as the skirt)
  mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.visible = false;
  L.grp.add(mesh);
  const prev = L.onDispose;                              // (brooder.js buildSkirt's chain: the shared material must survive her dispose)
  L.onDispose = () => { if (mesh.parent) mesh.parent.remove(mesh); g.dispose(); if (prev) prev(); };
  return { mesh, geo: g, P, N, M: new Float32Array(n * 3), F: new Float32Array(n * 3), NM: new Float32Array(n * 3),
    RR: new Float32Array(NB * NR), NEED: new Float32Array(n), COLS: NB, NR, k: -1, br: 0, drawn: false, c: 1, s: 0, R: L.R, cx: 0, cz: 0, crestZ: BURY.crestZ,
    bx: 0, bz: 0, br2: 0, topAt: null, mw: new Float32Array(16), mwInv: new Float32Array(16) };
}
// her shell's top under WORLD (x, z), at the fit pose: into her frame by the FULL inverse (dormant she is pitched and rolled to her
// bed: a yaw-only map put a point 6 u up her back ~0.3 u off on a 3 deg tilt, against 0.3 u of cover), the height found in two passes
// (brood.js floorL's way: the local x, z depend on the height through the tilt), back to world y. NaN off her plan.
export function shellTopW(MD, x, z) {
  const e = MD.mw, n = MD.mwInv;
  let wy = e[13];
  for (let it = 0; it < 2; it++) {
    const lx = n[0] * x + n[4] * wy + n[8] * z + n[12], lz = n[2] * x + n[6] * wy + n[10] * z + n[14];
    const h = MD.topAt(lx, lz); if (h == null) return NaN;
    wy = e[1] * lx + e[5] * h + e[9] * lz + e[13];
  }
  return wy;
}
// THE FIT, with her in her BURIED pose (L.bury 1). Polar about the strip's centre C, in her frame (yaw only, as restWorld): per
// bearing, ring 0 sits `reveal` u INSIDE her shell at the strip's edge (hidden in the rock), ring 1 on is the dune: at least `cover`
// u over her shell, never falling faster than `repose`, out to where it meets the floor; the last two rings a hair under the
// floor (the heightfield mesh is a linear sampling of terrainH: the edge must never float). Drawn in the seabed's own material
// with its vertex channels resampled (seabedColor), so dune and floor read as one. Drawn-only: terrainH is untouched.
export function fitMound(L, MD, seabedColor, fissureDist) {
  const K = BURY, R = L.R, cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), NR = MD.NR, NI = K.rings;
  L.body.updateMatrixWorld(true);
  MD.mw.set(L.body.matrixWorld.elements); MD.mwInv.set(_mi.copy(L.body.matrixWorld).invert().elements);
  MD.c = cy; MD.s = sy; MD.R = R; MD.cx = L.pos.x; MD.cz = L.pos.z; MD.crestZ = K.crestZ; MD.topAt = L.topAt;
  // the mesh's (x, z) by her yaw (as restWorld and toPolar map it); every HEIGHT read at that world (x, z) through the full matrix
  const wx = (lx, lz) => L.pos.x + (lx * cy + lz * sy) * R, wz = (lx, lz) => L.pos.z + (-lx * sy + lz * cy) * R;
  const topW = (lx, lz) => shellTopW(MD, wx(lx, lz), wz(lx, lz));
  const a = K.crestW / 2 / R, b = K.crestL / 2 / R, st = K.ringStep / R, dl = 0.6 / R, thS = L.sandSide > 0 ? 0 : Math.PI;
  for (let j = 0; j < NB; j++) {
    const th = j / NB * Math.PI * 2, ux = Math.cos(th), uz = Math.sin(th);
    const ws = Math.max(0, Math.cos(th - thS)), aj = a + K.sandOpen / R * ws * ws;   // (sandOpen: the sand side's face opened)
    let r = 1 / Math.sqrt((ux / aj) ** 2 + (uz / b) ** 2);
    for (; r > 0.02; r -= st) { const h = topW(ux * r, K.crestZ + uz * r); if (h === h && h >= L.meanG + K.edgeMin) break; }
    RIN[j] = Math.max(0.02, r);
  }
  for (let j = 0; j < NB; j++) { let s = 0; for (let q = -2; q <= 2; q++) s += RIN[(j + q + NB) % NB]; RS[j] = s / 5; }   // no corners
  const C = MD.geo.attributes.color.array, rgb = _rgb;
  for (let j = 0; j < NB; j++) {
    const th = j / NB * Math.PI * 2, ux = Math.cos(th), uz = Math.sin(th), r0 = RS[j];
    // the dune's profile outward from the edge (PROF heights at radii PROFR)
    let np = 0, hPrev = -1e9, rEnd = r0 + dl;
    for (let r = r0 + dl; r < r0 + 2.2 && np < PROF.length; r += st) {
      const lx = ux * r, lz = K.crestZ + uz * r, x = wx(lx, lz), z = wz(lx, lz), fl = terrainH(x, z, L.idx), sh = topW(lx, lz);
      const need = Math.max(fl, sh === sh ? sh + K.cover : -1e9);
      const h = np ? Math.max(need, hPrev - K.repose * K.ringStep) : need;
      PROF[np] = h; PROFR[np] = r; np++; hPrev = h; rEnd = r;
      if (h <= fl + 0.02 && !(sh === sh && sh + K.cover > fl)) break;
      if (fissureDist(x, z, L.idx) < 1.5) break;          // (the drift never runs over the crack's lip)
    }
    const set = (i, r, y, dk) => {
      const lx = ux * r, lz = K.crestZ + uz * r, x = wx(lx, lz), z = wz(lx, lz), o = (i * NB + j) * 3, sh = topW(lx, lz);
      MD.M[o] = x; MD.M[o + 1] = y; MD.M[o + 2] = z;
      MD.NEED[i * NB + j] = i >= 1 && i < NI ? Math.max(terrainH(x, z, L.idx), sh === sh ? sh + K.cover : -1e9) : -1e9;
      MD.F[o] = x; MD.F[o + 1] = terrainH(x, z, L.idx) - 0.12; MD.F[o + 2] = z;
      MD.RR[j * NR + i] = r;
      seabedColor(x, z, rgb); C[o] = rgb[0] * dk; C[o + 1] = rgb[1]; C[o + 2] = rgb[2];
    };
    { const h0 = topW(ux * r0, K.crestZ + uz * r0); set(0, r0, (h0 === h0 ? h0 : L.meanG) - K.reveal, 0.42); }
    for (let i = 1; i < NI; i++) {
      const s = (i - 1) / (NI - 2), r = r0 + dl + (rEnd - r0 - dl) * s;
      let k = 0; while (k < np - 2 && PROFR[k + 1] < r) k++;
      const w = np > 1 ? Math.min(1, Math.max(0, (r - PROFR[k]) / (PROFR[k + 1] - PROFR[k] || 1))) : 0;
      set(i, r, np > 1 ? PROF[k] + (PROF[k + 1] - PROF[k]) * w : PROF[0], 0.42 + 0.58 * Math.pow(s, 0.6));
    }
    set(NI, rEnd + 0.4 / R, 0, 1); set(NI + 1, rEnd + 0.8 / R, 0, 1);
    for (const i of [NI, NI + 1]) { const o = (i * NB + j) * 3; MD.M[o + 1] = terrainH(MD.M[o], MD.M[o + 2], L.idx) - (i === NI ? 0.10 : 0.12); }
  }
  // across bearings: a dune has no ridges between bearings (5-tap average of rings 1..NI-1, never under its cover again)
  smoothRings(MD);
  // normals of the fitted dune, facing up (the seabed material is FrontSide); the floor state's normal is straight up
  MD.P.set(MD.M); MD.geo.computeVertexNormals();
  let ny = 0; const N = MD.geo.attributes.normal.array; for (let i = 1; i < N.length; i += 3) ny += N[i];
  if (ny < 0) { const ix = MD.geo.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } MD.geo.index.needsUpdate = true; MD.geo.computeVertexNormals(); }
  MD.NM.set(MD.geo.attributes.normal.array);
  MD.geo.attributes.color.needsUpdate = true;
  MD.k = -1; setMoundK(MD, L.bury, 0);
  MD.geo.computeBoundingSphere();
  // the queries' early-out: a circle round C holding every ring (shutFloorY runs this for every hose node, every frame)
  let rMax = 0; for (let q = 0; q < MD.RR.length; q++) if (MD.RR[q] > rMax) rMax = MD.RR[q];
  MD.bx = wx(0, K.crestZ); MD.bz = wz(0, K.crestZ); MD.br2 = (rMax * R + 1) * (rMax * R + 1);
}
```

  The ring smoothing and the scratch it uses:

```js
const _rgb = [0, 0, 0], RING = new Float32Array(NB), _mi = new THREE.Matrix4();
// rings 1..NI-1: a 5-tap average round the ring, never under the vertex's own need (the cover over her shell, the floor)
function smoothRings(MD) {
  const NI = BURY.rings;
  for (let i = 1; i < NI; i++) {
    for (let j = 0; j < NB; j++) { let s = 0; for (let q = -2; q <= 2; q++) s += MD.M[(i * NB + (j + q + NB) % NB) * 3 + 1]; RING[j] = s / 5; }
    for (let j = 0; j < NB; j++) MD.M[(i * NB + j) * 3 + 1] = Math.max(RING[j], MD.NEED[i * NB + j]);
  }
}
```

  Notes on this code:
  - `seabedColor` is passed in as a closure over brooder.js's `seabedColor(tm, x, z, out, idx)`.
  - The fit is an event (her build, the dig-in's start). It creates a few small closures per call and reuses module scratch for every array. Nothing runs per frame.

- [ ] **Step 4: The blend, the queries.**

```js
// the drawn state: the fitted dune at k = 1, flat under the floor at k = 0 (hidden), the breath on rings 1-4 (the sand nearest the
// rock lifts most). Writes only when k or the breath moved; no allocation.
export function setMoundK(MD, k, br = 0) {
  if (k === MD.k && br === MD.br) return;
  MD.k = k; MD.br = br;
  const P = MD.P, M = MD.M, F = MD.F, N = MD.geo.attributes.normal.array, NM = MD.NM, nb = MD.COLS;
  for (let v = 0, n = P.length / 3; v < n; v++) {
    const o = v * 3, ring = (v / nb) | 0, lift = ring >= 1 && ring <= 4 ? br * (1 - (ring - 1) / 4) : 0;
    P[o] = M[o]; P[o + 2] = M[o + 2];
    P[o + 1] = F[o + 1] + (M[o + 1] - F[o + 1]) * k + lift * k;
    const nx = NM[o] * k, ny = NM[o + 1] * k + (1 - k), nz = NM[o + 2] * k, nl = Math.hypot(nx, ny, nz) || 1;
    N[o] = nx / nl; N[o + 1] = ny / nl; N[o + 2] = nz / nl;
  }
  MD.geo.attributes.position.needsUpdate = true; MD.geo.attributes.normal.needsUpdate = true;
  MD.drawn = k > 0.001; MD.mesh.visible = MD.drawn;
}
// world (x, z) -> her frame at the fit -> polar about C: module scratch (_lx, _lz, _rho, _fa)
let _lx = 0, _lz = 0, _rho = 0, _fa = 0;
function toPolar(MD, x, z) {
  const dx = x - MD.cx, dz = z - MD.cz;
  _lx = (dx * MD.c - dz * MD.s) / MD.R; _lz = (dx * MD.s + dz * MD.c) / MD.R;
  const qz = _lz - MD.crestZ; _rho = Math.hypot(_lx, qz);
  let a = Math.atan2(qz, _lx) / (Math.PI * 2); if (a < 0) a += 1; _fa = a * MD.COLS;
}
function alongRing(MD, b, rho) {
  const NR = MD.NR, RR = MD.RR, o = b * NR;
  if (rho < RR[o] || rho > RR[o + NR - 1]) return -1e9;
  let i = 0; while (i < NR - 2 && RR[o + i + 1] < rho) i++;
  const r0 = RR[o + i], r1 = RR[o + i + 1], w = r1 > r0 ? (rho - r0) / (r1 - r0) : 0;
  const ya = MD.P[(i * MD.COLS + b) * 3 + 1], yb = MD.P[((i + 1) * MD.COLS + b) * 3 + 1];
  return ya + (yb - ya) * w;
}
// the drawn sand's height under (x, z), or -1e9 (the strip: the rock is there; off the dune: the floor is)
export function moundY(MD, x, z) {
  if (!MD || !MD.drawn) return -1e9;
  { const dx = x - MD.bx, dz = z - MD.bz; if (dx * dx + dz * dz > MD.br2) return -1e9; }   // (off the dune: before any atan2)
  toPolar(MD, x, z);
  const b0 = Math.floor(_fa) % MD.COLS, b1 = (b0 + 1) % MD.COLS, wb = _fa - Math.floor(_fa);
  const y0 = alongRing(MD, b0, _rho), y1 = alongRing(MD, b1, _rho);
  return y0 < -1e8 || y1 < -1e8 ? -1e9 : y0 + (y1 - y0) * wb;
}
// the drawn SAND under (x, z): the floor or the dune, never her crest (harpoon.js seat(): a seam is "over the sand" by this)
export function sandY(MD, x, z, zi) { const t = terrainH(x, z, zi), m = moundY(MD, x, z); return m > t ? m : t; }
// inside the strip's band on that bearing (to ring 1: the sand crosses her shell between ring 0 and ring 1)?
export function inStrip(MD, x, z) {
  if (!MD) return false;
  { const dx = x - MD.bx, dz = z - MD.bz; if (dx * dx + dz * dz > MD.br2) return false; }
  toPolar(MD, x, z);
  const b0 = Math.round(_fa) % MD.COLS;
  return _rho < MD.RR[b0 * MD.NR + 1];
}
// her crest's top under (x, z) in the strip band, world y, from her baked top heightfield at the fit pose (she lies still while
// buried; shellTopW: the full matrix), or -1e9
export function crestY(MD, x, z) {
  if (!MD || !inStrip(MD, x, z)) return -1e9;
  const y = shellTopW(MD, x, z); return y === y ? y : -1e9;
}
```

  Add to `__burial`: `sandAt: (x, z) => moundY(window.__sl && window.__sl.mound, x, z)`, `inStrip: (x, z) => inStrip(window.__sl && window.__sl.mound, x, z)`.

- [ ] **Step 5: The tell.**

```js
const ease = x => x * x * (3 - 2 * x);
const TRICKLE_J = [-2, 0, 2];                         // the trickle's three bearings round the nearest one (module scratch, not a literal per breath)
// THE TELL (spec §1): every 8-10 s the sand over her lifts a few centimetres and settles; a thin trickle of silt slides off the
// crest's edge with each breath. Only a careful eye catches it: the lift is drawn only with the lens within BURY.breath.draw u (a
// few cm is nothing past that), the trickle only with him within BURY.breath.near u of the strip's edge.
export function breathTick(L, dt, player, camPos, emitDust) {
  const B = BURY.breath, MD = L.mound;
  if (!MD || !(L.dormant || L.dugIn)) { L.breathY = 0; return; }   // (dug back in after a calm she breathes again: Task 12)
  if ((L.brT = (L.brT ?? 2) - dt) <= 0) { L.brT = B.period[0] + (B.period[1] - B.period[0]) * Math.random(); L.brAge = 0; L.brTrk = false; }
  L.brAge = (L.brAge ?? 99) + dt;
  const a = L.brAge, y = a < B.up ? ease(a / B.up) : a < B.up + B.down ? 1 - ease((a - B.up) / B.down) : 0;
  const near = Math.hypot(camPos.x - MD.cx, camPos.z - MD.cz) < B.draw + BURY.crestL / 2;
  L.breathY = near ? B.lift * y : 0;
  if (!L.brTrk && a >= B.up && player) {
    L.brTrk = true;
    let best = 1e9, bj = -1;                         // the strip's edge nearest him (ring 1)
    for (let j = 0; j < MD.COLS; j++) { const o = (MD.COLS + j) * 3, d = Math.hypot(MD.P[o] - player.pos.x, MD.P[o + 2] - player.pos.z); if (d < best) { best = d; bj = j; } }
    if (best < B.near) for (let q = 0; q < 3; q++) { const o = (MD.COLS + (bj + TRICKLE_J[q] + MD.COLS) % MD.COLS) * 3; emitDust(MD.P[o], MD.P[o + 1] + 0.05, MD.P[o + 2], 2, 0.3); }
    L.trickleN = (L.trickleN || 0) + (best < B.near ? 1 : 0);
  }
}
```

- [ ] **Step 5b: The growth on her back.** installSculpt seats `G.reefGeo` (tube clumps 0.9–1.8 u, two sea fans 2.6–3.4 u tall) and up to 60 weed fronds on her sculpted top. Outside the strip they stand clear of 0.3 u of sand: a sea fan growing out of a dune is a tell. On the exposed rock they are growth on a stone, which reads as rock. So, while she is buried, the growth outside the strip is hidden and the growth on the strip stays. Whether a few should stand on the rock at all is Michael's look, at Task 5's checkpoint.

```js
// THE GROWTH ON HER BACK, buried with her (velkath-buried-rock): the reef's triangles and the weed fronds whose root lies OUTSIDE the
// strip are hidden while she is buried (bury > 0.5); those on the exposed rock stay. Built at the fit (an event): the reef gets a second
// index holding only the strip's triangles, swapped in and out (no program changes); a weed frond is scaled to 0. Undone as she rises
// past bury 0.5, redone as she digs back in past it.
const _gm = new THREE.Matrix4(), _gp = V3();
export function prepGrowth(L, MD) {
  const reef = L.parts.reef, weed = L.parts.weed;
  if (reef && reef.geometry.index) {
    const g = reef.geometry, ix = g.index.array, P = g.attributes.position, keep = [];
    reef.updateMatrixWorld(true);
    for (let q = 0; q < ix.length; q += 3) {
      // kept only if ALL THREE corners lie in the strip: a triangle straddling its edge would leave a corner standing out of the
      // dune (and burial-probe's `reef` check books every drawn vertex outside the strip)
      let all = true;
      for (let k = 0; k < 3 && all; k++) { _gp.fromBufferAttribute(P, ix[q + k]).applyMatrix4(reef.matrixWorld); all = inStrip(MD, _gp.x, _gp.z); }
      if (all) keep.push(ix[q], ix[q + 1], ix[q + 2]);
    }
    L.reefIdx = { full: g.index, strip: new THREE.BufferAttribute(Uint32Array.from(keep), 1) };
  }
  if (weed) {
    L.weedM0 = Float32Array.from(weed.instanceMatrix.array);
    L.weedOut = new Uint8Array(weed.count);
    weed.updateMatrixWorld(true);
    for (let k = 0; k < weed.count; k++) { weed.getMatrixAt(k, _gm); _gp.setFromMatrixPosition(_gm).applyMatrix4(weed.matrixWorld); L.weedOut[k] = inStrip(MD, _gp.x, _gp.z) ? 0 : 1; }
  }
  L.growthBuried = -1;
}
export function buryGrowth(L, on) {
  if (L.growthBuried === (on ? 1 : 0)) return;
  L.growthBuried = on ? 1 : 0;
  const reef = L.parts.reef, weed = L.parts.weed;
  if (reef && L.reefIdx) reef.geometry.setIndex(on ? L.reefIdx.strip : L.reefIdx.full);
  if (weed && L.weedM0) {
    const A = weed.instanceMatrix.array;
    A.set(L.weedM0);
    if (on) for (let k = 0; k < weed.count; k++) if (L.weedOut[k]) { const o = k * 16; A[o] = A[o + 1] = A[o + 2] = A[o + 4] = A[o + 5] = A[o + 6] = A[o + 8] = A[o + 9] = A[o + 10] = 0; }
    weed.instanceMatrix.needsUpdate = true;
  }
}
```

  `prepGrowth(L, L.mound)` runs in `bedDown` right after `fitMound` (and in Task 12's `beginDig`). `updateBrooder` calls `buryGrowth(L, L.bury > 0.5)` beside `setMoundK`: a write only on the frame it crosses. (The reef's index is an `Uint32Array` attribute built at an event; the first `setIndex` of the strip index uploads a new buffer once, no program.)

- [ ] **Step 6: brooder.js wiring.**
  - In `bedDown` (buried), after `L.bury = 1; poseAll(...)`:

```js
  if (!L.mound) L.mound = makeMound(L, terrainMeshes[L.idx] && terrainMeshes[L.idx].material);
  fitMound(L, L.mound, (x, z, out) => seabedColor(terrainMeshes[L.idx], x, z, out, L.idx), fissureDist);
```

  - In `makeBrooder`'s dispose chain, lift `L.mound.mesh` out of `L.grp` before `disposeSleeper` (the seabed material is shared, exactly as `buildSkirt` does) and dispose its geometry.
  - In `updateBrooder`, after `sight(...)`:

```js
  if (L.mound) { breathTick(L, dt, player, camera.position, emitDust); setMoundK(L.mound, L.moundK ?? L.bury, L.breathY); buryGrowth(L, L.bury > 0.5); }
```

    (`L.moundK` is set by the rise in Task 7a; until then the mound follows `L.bury`.)
  - The skirt block (`if (L.skirt && L.skirt.visible) ...`) is untouched. Buried she has no skirt.

- [ ] **Step 7: The disguise probe and the breath mode.**
  - `disguise` now judges all its checks, the `reef` and `weed` ones included.
  - The `breath` mode:
    1. Stand him 6 u off the strip's edge, facing it (`__bench.place`, then `player.pos.y = shutFloorY + 1.35`).
    2. Step 40 s, booking per frame `lev.mound.P` ring-1 vertex `y` at the nearest bearing and `L.trickleN`.
    3. Then stand him 12 u off and step 30 s more.
  - Verdicts:
    - lift amplitude (max − min of that vertex while dormant) in [0.03, 0.06];
    - the interval between breath peaks in [8, 10] s (≥ 3 peaks booked, else UNMEASURED);
    - trickles ≥ 1 per breath at 6 u;
    - trickles 0 at 12 u.
  - `BP_RED=still` (`{breath: {lift: 0}}`) must fail the amplitude → exit 5.

- [ ] **Step 8: `fissure-probe clearance`.** Its skirt check reads `L.skirt`. Make it read `L.skirt || (L.mound && L.mound.mesh)`, and keep the bar (≥ 1 u off the lip). Run `clearance`: PASS at all four sites. The dune is inside her plan, which is ≥ 14 u off the apron.

- [ ] **Step 9: GREEN.**
  - `disguise` all checks PASS.
  - `BP_RED=ridge` exit 5 (sides and crest).
  - `breath` PASS. `BP_RED=still` exit 5.
  - Invariants.
  - Two stills for the controller (not yet Michael): `__bench.capture({ settle: 90 })` from 10 u and 20 u, to `~/sc/.abyssa-wt/shots/buried/t3a-*`. No look tuning here: the crest's knobs are tuned in Task 5, after Task 4 has shown where a seat can go.

- [ ] **Step 10: Commit**: `velkath buried: the mound (the drift grown over her, the crest strip <len> u), the tell; disguise GREEN; clearance reads the mound`.

---

### Task 3b: Footing — the dune and the crest are ground, for him and for the lens

**Files:**
- Modify:
  - `src/world/terrain.js` (`setExtraFloor`, `extraFloorAt`, `shutFloorY`);
  - `src/entities/sleeper/bodyCols.js` (`setMound`, `buriedFloorAt`, the shell's collider capped at the drawn ground, `setShell`'s `slick`, `shellHiAt` for the probe);
  - `src/entities/sleeper/brooder.js` (`publishCols`);
  - `src/player.js` (orchestrator: `floorY`);
  - `src/entities/diver.js` (`hC`, `gH`);
  - `src/game.js` (orchestrator: the wiring at boot);
  - `tools/bench/relief-walk.mjs` (mode `mound`).

**Interfaces:**
- Consumes: Task 3a's `moundY`, `crestY`, `L.mound`.
- Produces:
  - `terrain.js`: `setExtraFloor(fn | null)`, `extraFloorAt(x, z, zi)` → y or −1e9;
  - `bodyCols.js`: `setMound(MD | null, zi, crestOn, cap)`, `buriedFloorAt(x, z, zi)` → y or −1e9 (keyed to the zone and the site it was published at);
  - `setShell(proxy, m, R, slick = true)`;
  - `shellHiAt(x, z)` → the published shell proxy's top under (x, z), world y, or −1e9 (probe only).

- [ ] **Step 1: Write the `mound` mode of relief-walk.mjs, and its REDs.**
  - Lines, picked from the live mound (`window.lev.mound`):
    - (a) from 6 u out on the flat, straight up the dune's flank to the strip's edge, across the crest top, and down the far flank to 6 u out;
    - (b) along the crest's length;
    - (c) the harpoon side's flank from the anchor (Task 4 on; before it, the sand side's mid-bearing).
  - Walk each line both ways with real W on the live loop (the mode reuses `walkOnce` / `walk`).
  - **The drawn surface is precomputed, never raycast in the frame hook.** The walk is booked in a rAF hook on the live loop (relief-walk.mjs `own(i)`: per planted boot per frame). Her body is ~70k triangles with no BVH, and a raycast per sole point per frame would put the walk at the 50 ms clamp: the probe would change the gait it measures (the relief record's probe-artifact failure). So, once per run before the walks, she lying still:
    - bucket the dune's and her shell's world triangles on 0.5 u x/z cells (harpoon.js `gatherTris`' CSR layout), and answer a vertical ray from a cell's own triangles (its `vray`: the topmost hit);
    - fill a drawn-height grid at 0.25 u over each line's corridor, wide enough for the lens too: 14 u beyond each end of the line along it and 6 u to each side (the lens trails him about 9 u, and the lines start 6 u out on the flat): `max(terrainH, the topmost dune or shell hit)`;
    - per frame, `own(i)` and the lens read it bilinearly (`drawnY(x, z)`). The breath moves the dune 4.5 cm; book that as the grid's stated tolerance;
    - a point off the grid reads NaN, never a fallback. Off-grid frames are booked and excluded, and each lens bar needs ≥ 90% of its line's frames on the grid, or it is UNMEASURED (exit 2).
    
    Under `RW.ground = 'drawn'`, `own` uses `drawnY` in place of `TH`.
  - Per frame, also book:
    - the lens clearance over `drawnY(cam.x, cam.z)` and `BC.bodyBlocked(cam.x, cam.y, cam.z, 0)`;
    - `BODY.contacts` with `BODY.last === 'shell'` (bodyCols.js: her shell collider meeting him);
    - the frame time (relief-walk's own `dt` series).
  - Once per run, over the dune and strip grid, the published proxy's excess `max(shellHiAt(x, z) − drawnY(x, z))`: the conflict C1 named, shown rather than assumed (the review measured 0.2–0.8 u from the bake).
  - Bars:
    - OWN p95 |gap| ≤ 0.15 u per line;
    - no planted-boot frame under −0.15;
    - her shell's contacts with him 0 on every line;
    - lens clearance ≥ 0.3 u every frame;
    - `bodyBlocked(lens, 0)` false every frame;
    - progress: no 2 s window under 0.5 u moved;
    - no frame at the 50 ms clamp (a clamped run is not a reading: re-run it, then stop).
  - REDs, both run on the Task 3a head first, then again once the footing is in:
    - `RW_RED=nofloor-mound` evaluates `window.__burial.set({ floor: 0 })` first: his boots walk on the floor under the drawn dune, and the gap bar must fail → exit 5;
    - `RW_RED=nocap` evaluates `window.__burial.set({ capShell: 0 })`: the proxy's shell term is solid over the drawn sand again, and the shell-contact bar must fail → exit 5.
    
    Record the numbers.

- [ ] **Step 2: terrain.js.** Right above `shutFloorY`, inside the relief slice's range so the replica keeps compiling:

```js
// (velkath-buried-rock) A FLOOR THAT IS A SLEEPER'S: a buried Velkath's dune and her crest (sleeper/bodyCols.js buriedFloorAt, wired
// once by game.js: this module never imports the sleepers). -1e9 where there is none. shutFloorY, player.js and the gait's slope rig
// take the max with it; unset (no provider) every one of them is the shipped one bit for bit.
let EXTRA_FLOOR = null;
export function setExtraFloor(fn) { EXTRA_FLOOR = fn; }
export function extraFloorAt(x, z, zi) { return EXTRA_FLOOR ? EXTRA_FLOOR(x, z, zi) : -1e9; }
export function shutFloorY(x, z, zi) {
  const h = terrainH(x, z, zi), j = jamAt(x, z, zi), g = j > h ? j : h;
  const e = EXTRA_FLOOR ? EXTRA_FLOOR(x, z, zi) : -1e9;
  return e > g ? e : g;
}
```

  Run `node tools/relief/slice.mjs && node tools/relief/validate.mjs`: 10/10.

- [ ] **Step 3: bodyCols.js.**

```js
import { moundY, crestY } from './burial.js';
import { currentSiteIndex } from '../../world/site.js';
// (velkath-buried-rock) THE DUNE AND THE CREST ARE GROUND (spec §1 "Footing": "He walks up the sand and stands on the rock").
// Published by a buried sleeper with the rest of her body each frame (brooder.js publishCols); cleared with the rest. Ground, not
// a collider: game.js hands buriedFloorAt to terrain.js setExtraFloor once, so his floor, the lens's floor clamp and the boom's
// floor test, the hose and the sonar all stand on the drawn sand. The crest is ground only while she is fully buried (crestOn);
// rising, her shell's own collider takes him. KEYED TO THE SITE it was published at: a voyage's reseed (game.js reseedWorldNow sets
// the new site first) places the next site's dens on shutFloorY before her old build is disposed, and home's dune must not be
// ground there.
let mound = null, moundZi = -1, moundSite = -1, crestOn = false, capOn = false;
export function setMound(MD, zi, cOn, cap = true) { mound = MD; moundZi = zi; moundSite = currentSiteIndex(); crestOn = !!cOn; capOn = !!(MD && cOn && cap); }
export function buriedFloorAt(x, z, zi) {
  if (!mound || zi !== moundZi || currentSiteIndex() !== moundSite) return -1e9;
  const m = moundY(mound, x, z), c = crestOn ? crestY(mound, x, z) : -1e9;
  return m > c ? m : c;
}
// (velkath-buried-rock) THE SHELL'S COLLIDER STOPS AT THE DRAWN GROUND while she is fully buried. Her shell proxy's top is the highest
// vertex per cell (48 bearings x 8 rings), interpolated between cell centres: on her sloping, scuted back it sits ~0.2-0.8 u over the
// real shell (measured from the bake's top heightfield), while the dune covers her by only 0.3 u and the crest's ground IS the real
// top. Left solid, it pushed a man on the dune up and sideways every frame against player.js's floor (hover, jitter, a shove back
// down the dune), and bodyBlocked called every stand spot on the thin dune "inside her" (harpoon.js clearAt: no seat). So with capOn
// a sample at or over the drawn ground (buriedFloorAt - 0.05) is never inside her shell. Below the drawn ground she stays solid;
// rising (crestOn false) everything is as shipped. The shell is still published: shellPlanNear (onHerGround, onHerDune) reads it.
function overGround(x, y, z) { if (!capOn) return false; const g = buriedFloorAt(x, z, moundZi); return g > -1e8 && y >= g - 0.05; }
// (probe) the published proxy's top under world (x, z), world y, or -1e9
export function shellHiAt(x, z) {
  if (!on || !shellOk) return -1e9;
  const M = SHI, S = shell, W = SHM;
  const px = M[0] * x + M[4] * by + M[8] * z + M[12], pz = M[2] * x + M[6] * by + M[10] * z + M[14];
  const dx = px - S.cx, dz = pz - S.cz, rho = Math.hypot(dx, dz);
  let a = Math.atan2(dz, dx) / (Math.PI * 2); if (a < 0) a += 1;
  band(S, a * S.B, rho);
  if (!(_hi > -1e8) || rho > _ro) return -1e9;
  return W[1] * px + W[5] * _hi + W[9] * pz + W[13];
}
```

  Also:
  - `clearBodyCols` adds `mound = null; crestOn = false; capOn = false;`.
  - In `resolveBodyCols`' shell loop, right after `const wy = ...` for each of the three samples: `if (overGround(p.x, wy, p.z)) continue;`.
  - In `bodyBlocked`'s shell branch: `if (shellOk && !overGround(x, y, z)) { ... }` around the shipped test.
  - CALMCOL is a second consumer of her shell: `resolveUnderCalm` keeps a calmed sleeper's underside closed to him from below (bodyCols.js: his bonnet pressed down to `roof` u under her belly, his upward speed zeroed). After the wake `L.dormant` is never true again, so `calmK` stays on through the dig-in and after it, and a man on (or afloat over) the dug-in dune, inside her plan, would be pressed down at 3 u/s and could not hop or jet off it. Her underside is under the sand once the dune is drawn, so there is no room under her to close: skip it then. `if (calmK && shellOk && CALMCOL.on && !mound) resolveUnderCalm(p, v, dt);`. `mound` is published only while the dune is drawn, so after the calm and before the dig-in (the dune flat and hidden) CALMCOL is the shipped one.
  - `setShell(proxy, m, R, slick = true)` stores `shSlick = slick`. In `resolveBodyCols`' `if (ny > 0.55)` branch, the `SHELL_SLIDE` velocity line runs only `if (shSlick)`: a buried crest is stone underfoot, not her slick dome.
  - With no mound published (`capOn` false), every one of these is the shipped test.

- [ ] **Step 4: brooder.js `publishCols`.** Before `endBodyCols(...)`:

```js
  // (velkath-buried-rock) her dune (while drawn) and, fully buried, her crest: ground (bodyCols.js buriedFloorAt); her shell's collider
  // capped at that ground while she is fully buried
  const MDd = L.mound && L.mound.drawn && BURY.floor ? L.mound : null;
  setMound(MDd, L.idx, MDd && L.bury >= BURY.solidK && (L.dormant || L.dugIn), BURY.capShell > 0);
```

  Change the `setShell` call to `setShell(L.shellProx, bw.elements, R, !(L.buried && L.bury >= BURY.solidK))`. Add `floor: 1, solidK: 0.98, capShell: 1` to `BURY`. `__burial.set({ floor: 0 })` and `__burial.set({ capShell: 0 })` are the REDs. Both are called only while she is published, so the shipped sleepers never pass a mound.

- [ ] **Step 5: player.js (orchestrator).** Import `extraFloorAt` from terrain.js. At the floor:

```js
  // (velkath-buried-rock) a buried Velkath's dune and crest are ground (terrain.js extraFloorAt; -1e9 everywhere else, so this is the
  // shipped floor bit for bit there)
  const xFloor = extraFloorAt(player.pos.x, player.pos.z, zi) + EYE_H;
  const floorY = overRift ? -1e5 : Math.max(th + EYE_H, deckY, jamFloor, xFloor);
```

- [ ] **Step 6: diver.js.** Import `extraFloorAt`.
  - In the slope block: `let hC = Math.max(terrainH(px, pz, slopeZi), extraFloorAt(px, pz, slopeZi));`, and the zone search's `const h = Math.max(terrainH(px, pz, z), extraFloorAt(px, pz, z));`.
  - `function gH(x, z) { return gdDeck ? deckH(x, z) : Math.max(terrainH(x, z, slopeZi), extraFloorAt(x, z, slopeZi)); }`.

- [ ] **Step 7: game.js (orchestrator).** Import `setExtraFloor` from terrain.js and `buriedFloorAt` from bodyCols.js. Once, right after `buildTerrain`: `setExtraFloor(buriedFloorAt);   // (velkath-buried-rock) the buried sleeper's ground (bodyCols.js): -1e9 unless one is published`.

- [ ] **Step 8: GREEN.**
  - `DRV_PORT=9540 node tools/bench/relief-walk.mjs mound 8886`: PASS, with the proxy's excess printed. Paste the table.
  - `RW_RED=nofloor-mound` and `RW_RED=nocap`: exit 5.
  - **Off-path proof:** at Pallid (no mound), `extraFloorAt` is −1e9 on a 2 u grid over her bed (±40 u). `relief-walk boots` and `lens` on their shipped lines read within their bars: the walks there never see the provider.
  - `clawcam-probe framing` (`CC_ON=1`) PASS.
  - Invariants.

- [ ] **Step 9: Commit**: `velkath buried: the dune and the crest are ground (bodyCols buriedFloorAt via terrain.js extraFloorAt: his floor, the gait, the lens); relief-walk mound`.

---

### Task 4: The harpoon in the rock — the crest seat, his footing at it, the old wound

**Files:**
- Modify:
  - `src/entities/sleeper/harpoon.js`: `seat()` candidates and score under burial; `trySeam`'s ground; the seam and the pole over the drawn sand; `H._crestScan`; the rope on the sand.
  - `src/entities/sleeper/brooder.js`: none beyond `bedDown`'s existing call order.
  - `src/ui/playtest.js` (`velkath()`).
  - `tools/bench/harpoon-probe.mjs` (`AT` reads the anchor's ground).
  - `tools/bench/relief-load.mjs` (the LIVE anchor, re-recorded).
  - `tools/bench/burial-probe.mjs` (the harpoon checks).

**Interfaces:**
- Consumes: `L.buried`, `L.mound`, `extraFloorAt` (Task 3b), `sandY`, `inStrip` (Task 3a).
- Produces:
  - Unchanged API: `H.anchor`, `H.seam`, `H.seatOk`.
  - Under burial, `H.anchor.y` is the **drawn ground** where he stands (the dune or the crest), not `terrainH`.
  - `H._crestScan()` → `{ n, exposed, side, back, facing, crack, buried, reach, pass, best }` (dev: per-filter survivors, in order).

Two grounds, kept apart:
- **The seam and the pole** are judged against the **drawn sand** only, `sandY = max(terrainH, moundY)`. Against `extraFloorAt`, which includes the crest's own top once she is fully buried, every crest vertex would sit under its own ground (`crestY` is the shell's top) and the candidate list would be empty whatever the geometry.
- **His footing and the grip** are judged against `groundY = max(terrainH, extraFloorAt)`: he stands on the dune or the crest.

- [ ] **Step 1: The feasibility scan, before anything else** (Michael, 2026-10-15: if no crest seat is both buried and in reach, the build stops for his call: "I thought I already approved this but yes these are fine to proceed with").
  - Add `H._crestScan()` beside `H._buriedScan` (harpoon.js). It runs the buried candidate filter of Step 2 vertex by vertex and counts the survivors after each filter, in order:
    - `exposed` (over the drawn sand by `SEAM_UP`);
    - `side` (within 1.15 rad of the sand side);
    - `back` (her back half);
    - `facing` (`ns ≥ 0.35`, `n.y ≤ 0.8`);
    - `crack` (≥ 8 u off it);
    - `under` (the data column: candidates whose vertical rays find triangles above and below them in the gathered set, the crest gather of Step 3);
    - `buried` (the head and shank inside her drawn shell at one of `AX_UPS`);
    - `buriedMargin` (the same with the shipped margin gather, side by side, so the gather's effect is visible);
    - `reach` (`trySeam` strict finds a stand spot);
    - `pass`, and the best score.
  - **A data gap never reads as "no seat".** If `under` is under 90% of `crack`'s survivors, the scan is UNMEASURED (the gathered triangles do not cover the crest) and the stop rule below does not fire: fix the gather first. Only a `pass` of 0 with `under` covered is "no seat".
  - Run it on the Task 3b head, with the crust absent (shading does not move geometry) and her knobs at Task 3a's defaults. Book the table in the ledger.
  - The review measured from the bake that across the 6 u strip her back's broad slopes give n.y about 0.82–0.99. So the facets that pass `n.y ≤ 0.8` facing sideways are local (the keel ridge's sides, scute edges, knobs, about 30% of the back-half strip's samples). A seam, if one qualifies, sits in the side of a knob or ridge on a gently rounded back, not in a flank of the outcrop. Book where the best seam sits (its local x, z, and the slope of the top heightfield around it).
  - **If `pass` is 0:** first try `BURY.sandOpen` (Task 3a: the sand side's face opened, a lopsided outcrop) at 1.5 and 3.0 u, one scan each, booked. If a seam passes only with the face opened, that shape is Michael's to choose at Task 5's checkpoint. **If none passes at all, stop:** the build waits for Michael's call (his ruling above). Never loosen the reach (0.9–1.9 u grip) or the burial test (`BURY`) to find one.

- [ ] **Step 2: The REDs.** On the Task 3b head (the shipped margin seat under a buried body):
  - `DRV_PORT=9540 node tools/bench/harpoon-probe.mjs routes 8886` must FAIL at home: no seam qualifies (`seatOk false`), or the seam is under the sand.
  - `disguise` with the new harpoon checks (Step 5) must FAIL.
  
  Record both.

- [ ] **Step 3: `seat()` under burial.** The spec: "`seat()` searches only the exposed crest, on her left flank: relief Task 8b's back-half seat, restricted to the crest".
  - In the candidate loop, when `L.buried`, replace the margin-band and rim tests with:

```js
      if (L.buried) {
        // (velkath-buried-rock) THE CREST SEAT: only her EXPOSED crest, on the sand side, her back half (lair.seat 'back'): a vertex
        // over the DRAWN SAND by SEAM_UP u (sandY: never the crest's own top, which is his ground there), its normal toward the sand
        // side and not her top (a flank of the rock, not its crown)
        _w.copy(_v).applyMatrix4(mw);                     // (_v stays body-local for the back-half and bearing tests)
        if (!(_w.y >= sandY(L.mound, _w.x, _w.z, idx) + SEAM_UP)) continue;
        if (backHalf && _v.z > 0) continue;
        const th = Math.atan2(_v.z, _v.x); let dth = th - sa; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
        if (Math.abs(dth) > 1.15) continue;
        _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
        const ns = _n.x * sand.x + _n.z * sand.z;           // (sand: L.sand, seat()'s own local)
        if (ns < 0.35 || _n.y > 0.8) continue;
        if (fissureDist(_w.x, _w.z, idx) < 8) continue;
        const gh = groundY(_w.x + _n.x * 1.5, _w.z + _n.z * 1.5);   // (where he stands: the dune, or the crest)
        cand.push(0.25 * Math.abs(dth) + 0.6 * (1 - ns) + 0.3 * Math.abs(_w.y - gh - 1.6), i);
        continue;
      }
```

    Notes on this code:
    - `SEAM_UP = 0.25` is a module constant.
    - Two closures in `makeHarpoon`: `groundY(x, z) = Math.max(terrainH(x, z, idx), extraFloorAt(x, z, idx))` (his ground), and `sandY` is burial.js's (the drawn sand). Import `extraFloorAt` from terrain.js and `sandY` from burial.js.
    - `_w` is the module's scratch V3; the loop uses it only before `seat()` reaches its own `_w` lines.
    - The block goes right after `_v.fromBufferAttribute(P, i);`, before the shipped margin-band test.
  - In `trySeam`, every `terrainH(ax, az, idx)` and the grip's `terrainH(_g.x, _g.z, idx)` becomes `groundY(...)`, so he stands on the drawn ground. Off home this is bit-identical: `extraFloorAt` is −1e9, so `Math.max` returns `terrainH`.
  - Under `strict && L.buried`, the pole's samples (`z` in `[-0.1, -0.3, -0.55, -0.8, -0.95]`) must also stand ≥ 0.05 u over `sandY` at their x, z: "the pole is clear" of the sand.
  - The stand spot's `clearAt` (bodyBlocked at 0.45 / 1.0 / 1.6 u over the ground, margin 0.5) works on the dune because Task 3b caps her shell's collider at the drawn ground while she is fully buried. Without that cap every stand spot on the thin dune read as inside her.
  - **The burial test sees the crest.** Every burial check (`buried()` → `depthIn()` → `vray`) reads only the triangles `gatherTris(sh, mw, sa)` collected, and the shipped gather keeps only the margin band: centroid `|y| ≤ 0.4` local, within 1.45 rad of the sand side, radius ≥ `0.5 × rimR(th)`. The crest's candidates lie at radius 0–0.46, where half of `rimR` is 0.36–0.43: the review sampled the wedge and found triangles under only 8.5% of them, and the crest's top (0.4275) is over the band. So `gatherTris` takes a `crest` flag, passed as `L.buried` by `seat()` and by `_crestScan`:

```js
      // (velkath-buried-rock) buried, the seam is in her CREST: the band reaches her top and there is no radial floor (near her keel,
      // where a candidate's bearing from her centre means little, every triangle within 0.6 of her centre is kept whatever its bearing).
      // This widens the DATA the burial test reads, never its thresholds (BURY's depths, AX_UPS). Seat time only.
      if (crest ? (cy < -0.4 || cy > 0.5) : (cy < -0.4 || cy > 0.4)) continue;
      const th = Math.atan2(cz, cx); let dth = th - sa; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      if (crest ? (Math.abs(dth) > 1.45 && Math.hypot(cx, cz) > 0.6) : (Math.abs(dth) > 1.45 || Math.hypot(cx, cz) < G.rimR(th) * 0.5)) continue;
```

    These three lines replace gatherTris' shipped three, from `if (cy < -0.4 || cy > 0.4) continue;` through the bearing-and-radius `continue` (harpoon.js `gatherTris`), and its signature becomes `(sh, mw, sa, crest = false)`. With `crest` false they are the shipped lines exactly (`H._buriedScan` keeps calling it with three arguments). The CSR is rebuilt for the larger set as it is now (`TRI` grows on demand). The burial test's thresholds are unchanged: "the head and shank are buried in the rock".
  - The fallback seat (no seam) is unchanged and stays loud through `seatOk`.
  - Keep the shipped branch's behaviour bit for bit: the buried code sits under `if (L.buried)`, and `gatherTris(sh, mw, sa, false)` is the shipped gather.
  - **The rope.** It is laid on `terrainH` (the `gy`, `ey` and mid-point heights in seat()'s rope block). Under burial it would dive into the dune, so lay it on `sandY(L.mound, x, z, idx)` when `L.buried`.

- [ ] **Step 4: Alt+6.** In playtest.js `velkath()`, after `standAt(...)`: `player.pos.y = Math.max(player.pos.y, a.y + EYE_H);`. Under burial the anchor's ground is the drawn ground. Elsewhere `a.y` is `terrainH`, so the line changes nothing.

- [ ] **Step 5: The probes.**
  - In harpoon-probe's `AT`: `const fl = Math.max(T.terrainH(a.x, a.z, 0), T.extraFloorAt(a.x, a.z, 0));`. That fixes `seamUpSal`, `gripUp` and the `blocked` heights. Keep the bars.
  - In burial-probe `disguise`, add the harpoon checks, against the drawn sand (`sand()`: the floor or the dune, never the crest), as seat() judges them:
    - `seam`: `H.seam.y - sand(H.seam)` ≥ +0.25;
    - `pole`: min over the iron's 5 pole samples (model z −0.1..−0.95, `H.worldM`) of (y − sand) ≥ 0.
  - Only when `L.harpoon && !L.harpoon.pulled`.

- [ ] **Step 6: The glint, unchanged.** Run `harpoon-probe lodged` (the glint and its one-time catch): PASS, its numbers within the shipped run's. The spec: "The brass glint and its one-time catch are unchanged."

- [ ] **Step 7: The LIVE anchor and the old save (Review Focus 4).**
  - In relief-load.mjs, `LIVE` gains `bury: 1`, `crest: [3.0, 4.0]` and `buryD` (recorded).
    - The crest is computed inside relief-load's own `LIVE_JS`: her drawn shell's highest vertex over `__burial.state().meanG`, read off the shell's vertices as burial-probe's `disguise` does. No cross-tool dependency.
    - `anchor` and `yawDeg` are re-recorded with the cause: "the burial: the crest seat, Michael 2026-10-14 (spec), home only 2026-10-15".
  - Record the row-built home fingerprint (Task 1 Step 3's expression plus `bury: { crest: 3.5 }`) as `ANCHOR.slRow` with the same cause, and gate it in `load`. Read it where relief-load's existing `sleeperFingerprint` reads already run (they dispose under the live sleeper), never between the LIVE checks.
  - `oldsave` must pass:
    - "[E] PRESS THE OLD WOUND" at the crest;
    - the scar visible (`H.scar.visible`) and ≥ 0.2 u over the drawn sand;
    - a real E wakes her;
    - no pull line;
    - nothing granted.

- [ ] **Step 8: GREEN.**
  - `harpoon-probe` all modes: exit 0 (routes at all four anchorages: home on the crest, the other three the shipped seat; rite and its revisit; remote; lodged; abort; the blade modes).
  - `relief-load all`: PASS.
  - `disguise` with the harpoon checks: PASS.
  - Real Alt+6 then E at home: the prompt, the wrench, the line, she wakes. Book in the ledger where Alt+6 stands him in her frame (fwd / lat in R; main −0.81 / −0.59). The fight's opening moved; Task 14 measures it.
  - `DRV_PORT=9540 node tools/bench/relief-walk.mjs mound 8886` again, now with line (c) walked from the real anchor up the harpoon side's flank: PASS.
  - Two stills of the harpoon in the rock (6 u and 10 u, his light) to `~/sc/.abyssa-wt/shots/buried/t4-*` for Task 5's checkpoint.

- [ ] **Step 9: Commit**: `velkath buried: the harpoon in the rock (crest seat on her left flank's back half, his footing on the dune, seam and pole over the drawn sand); old wound on the crest; relief-load LIVE re-recorded (cause: the burial)`.

---

### Task 5: The crust — her exposed shell reads as stone; boot-built; Michael judges the disguise with the harpoon in it

**Files:**
- Modify:
  - `src/entities/sleeper/burial.js` (`crustTerm`, `CRUST`);
  - `src/entities/sleeper/brooder.js` (`installSculpt` chains it; `updateBrooder` feeds `uBury`);
  - `src/world/flora.js` (`rockHue`, `siltHue`);
  - `tools/bench/burial-probe.mjs` (mode `programs`).

**Interfaces:**
- Produces:
  - `crustTerm(L, material)` installs uniforms `L.crustU = { uBury, uCrack, uRockC, uSand, ... }`;
  - `CRUST` knobs.
  - The body material's program key gains `'|crust'`. It is installed on **every** brooder build (one program; `uBury` 0 off home), so a voyage home never compiles it.

- [ ] **Step 1: The `programs` mode and its control.** A program compiles only on a rendered draw, and `__bench.step` runs only `update()` unless `o.render` is set (bench.js `step`). So every frame of this mode is **rendered** (`__bench.step(n, fn, { render: true })`), with her in the frame: Sal stood 14 u off her sand side, facing her strip's centre, the follow lens behind him. That keeps the slabs, the plume, the dune, the claw's reach and the haze in view through every phase.
  - It books `renderer.info.programs.length` and `__shaderFailed()` at:
    - (a) home dormant after 120 rendered frames;
    - (b) through the whole rise, stepping rendered: she is woken with `lev.cmd('wake')` (the same `wakeBrooder` the pull's `onWake` calls; a pull from the framing spot would abort, harpoon.js `H.update`: he is more than `REACH + 1` from the anchor), stepped to `L.hasStood` (Task 7a on; before it, 9 s after the wake);
    - (c) after `__lev.cmd('calm')` (Task 10 adds it; until then this check is skipped and booked as such), through the point and the walk home, rendered;
    - (d) through the dig-in (Task 12), rendered.
  - Bar: (b), (c), (d) equal (a).
  - **Positive control, run first:** a visible `MeshBasicMaterial` mesh with a new `customProgramCacheKey`, placed 3 u in front of the lens, for one rendered frame. The count must rise by at least 1 (a draw through the composer's passes may add more than one entry), or the mode exits 2 (the probe cannot see a compile). Then the mesh is removed and its material disposed (which releases its programs), and the count is read again before baseline (a), so (a) does not carry the control.
  - Note in the probe's header that `hitch.mjs`'s scenarios (`jet,z1,z2,voyage`) do not include the rise, the point or the dig-in. This mode is the gate for those.
  - Run it on the Task 4 head as the baseline.

- [ ] **Step 2: The crust term.**

```js
// THE CRUST (spec §1 "The crest reads as stone"): her shell takes the hollow outcrops' rock shading - flora.js's rock: lib/textures.js
// rockMapSet(0) sampled triplanar at flora's two scales (R_DET 0.32, R_MAC 0.073), under the zone's rock hue - blended in by uBury,
// with sand settled in its hollows (the bake's ambient occlusion, on faces that look up), and on the rise's first beat its own
// fissure network cracks open along her (uCrack). A shading term on her body material, driven by uniforms: ONE program for every
// brooder build (installed at every site, uBury 0 off home), chained after the silhouette rim, its own key; the branch on uBury is
// uniform, so off home it costs a compare.
//   alb/nrm/rough  how far her albedo, normal and roughness go to the stone's at full burial; sand: the hollows' fill; crack: the
//                  crack's darkening
export const CRUST = { alb: 0.92, nrm: 0.85, rough: 0.9, sand: 0.7, crack: 0.85, sandC: null };   // sandC: a hex over the zone's silt hue, or null
const CRUST_HEAD = `
varying vec3 vCrW;
uniform float uBury, uCrack;
uniform sampler2D uCrustPack, uCrustNrm;
uniform vec3 uRockC, uSand;
uniform vec4 uCrustK;
uniform float uCrustRough;
vec4 crTri(sampler2D t, vec3 p, vec3 bw, float f) { return texture2D(t, p.zy * f) * bw.x + texture2D(t, p.xz * f) * bw.y + texture2D(t, p.xy * f) * bw.z; }
vec3 crNrm(vec3 p, vec3 n, vec3 bw, float f, float str) {
  vec3 tx = texture2D(uCrustNrm, p.zy * f).xyz * 2.0 - 1.0, ty = texture2D(uCrustNrm, p.xz * f).xyz * 2.0 - 1.0, tz = texture2D(uCrustNrm, p.xy * f).xyz * 2.0 - 1.0;
  vec3 wx = vec3(tx.xy * str + n.zy, abs(tx.z) * n.x), wy = vec3(ty.xy * str + n.xz, abs(ty.z) * n.y), wz = vec3(tz.xy * str + n.xy, abs(tz.z) * n.z);
  return normalize(wx.zyx * bw.x + wy.xzy * bw.y + wz.xyz * bw.z);
}`;
const CRUST_APPLY = `
if (uBury > 0.001) {
  vec3 crWN = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 crBW = pow(abs(crWN), vec3(4.0)); crBW /= (crBW.x + crBW.y + crBW.z);
  vec4 crPd = crTri(uCrustPack, vCrW, crBW, 0.32), crPc = crTri(uCrustPack, vCrW + vec3(7.3, 2.9, 5.1), crBW, 0.073);
  float crAlb = (crPd.r * 1.6) * mix(1.0, crPc.r * 1.6, 0.55);
  float crK = uBury * uCrustK.x;
  diffuseColor.rgb = mix(diffuseColor.rgb, uRockC * crAlb, crK);
  vec3 crN2 = crNrm(vCrW, crWN, crBW, 0.32, 0.9);
  normal = normalize(mix(normal, normalize((viewMatrix * vec4(crN2, 0.0)).xyz), crK * uCrustK.y));
  roughnessFactor = mix(roughnessFactor, uCrustRough, crK);
  float crAO = 1.0;
  #ifdef USE_AOMAP
    crAO = texture2D(aoMap, vAoMapUv).r;
  #endif
  float crSand = uBury * uCrustK.z * smoothstep(0.2, 0.7, crWN.y) * (1.0 - smoothstep(0.35, 0.85, crAO));
  diffuseColor.rgb = mix(diffuseColor.rgb, uSand, crSand);
  float crCrk = uCrack * uCrustK.w * (1.0 - smoothstep(0.24, 0.40 + 0.25 * uCrack, crPd.b));
  diffuseColor.rgb *= 1.0 - 0.85 * crCrk;
}`;
export function crustTerm(L, m, rockSet, rockC, sandC) {
  const u = { uBury: { value: 0 }, uCrack: { value: 0 }, uCrustPack: { value: rockSet.pack }, uCrustNrm: { value: rockSet.nrm },
    uRockC: { value: new THREE.Color(rockC) }, uSand: { value: new THREE.Color(sandC) },
    uCrustK: { value: new THREE.Vector4(CRUST.alb, CRUST.nrm, CRUST.sand, CRUST.crack) }, uCrustRough: { value: CRUST.rough } };
  L.crustU = u;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCrW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCrW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + CRUST_HEAD)
      .replace('#include <lights_physical_fragment>', CRUST_APPLY + '\n#include <lights_physical_fragment>');
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|crust';
  m.needsUpdate = true;
}
```

  Checks on this code:
  - The GLSL strings contain no backtick.
  - Every `smoothstep` is in rising order. Its upper edge `0.40 + 0.25 * uCrack` ≥ 0.40 > 0.24.
  - `vAoMapUv` is r184's aoMap varying.
  - `inverseTransformDirection` is in three's `common` chunk.
  - If `worldpos_vertex` does not compute under the body's defines, use `vec4(transformed, 1.0)` through `modelMatrix` in `begin_vertex`'s place. Verify with `__shaderFailed()`.

- [ ] **Step 3: Wire it.**
  - Add two exports to flora.js, beside `jamRockKit`, so the brooder never builds a throwaway rock geometry for its hues:

```js
// (velkath-buried-rock) the zone's rock and silt hues, for her crust (brooder.js / burial.js crustTerm)
export function rockHue(zi) { return PAL[zi].rock; }
export function siltHue(zi) { return PAL[zi].silt; }
```

    `PAL` is module-level (flora.js), so neither needs `zoneMats`. `new THREE.Color(...)` takes a hex number.
  - In `installSculpt`, after `silhouetteRim(L, bodyMat)`: `crustTerm(L, bodyMat, rockMapSet(0), rockHue(0), siltHue(0))`. Import `rockMapSet` from lib/textures.js and `rockHue`, `siltHue` from world/flora.js.
  - The sand in her hollows starts at the zone's silt hue and is a look knob (`CRUST.sandC`, a hex, tuned in Step 4; `L.crustU.uSand.value.setHex(CRUST.sandC)` when it is set). It is **not** read from the seabed's vertex colours: those are data channels (terrain.js `float ao = vColor.r, bias = vColor.g, hb = vColor.b`), right for the dune, which draws in the seabed's own material, and meaningless as a tint. `L.crustU` exists only once the sculpt is installed: guard every write with `if (L.crustU)`.
  - In `updateBrooder`: `if (L.crustU) { L.crustU.uBury.value = L.bury; L.crustU.uCrack.value = L.crackK || 0; /* + the CRUST knobs, Step 4 */ }`.
  - The procedural fallback shell gets no crust. It buries, it does not look like stone. That is acceptable as a fallback; say so in the comment.

- [ ] **Step 4: The look-dev loop.**
  - Stills, settled (`__bench.capture({ settle: 90 })`), day, no storm, in his light (lantern on), the lens at the follow camera's place behind him:
    - (a) from 10 u, (b) from 20 u, both off her sand side;
    - (c) from 10 u off her crack side;
    - (d) the harpoon side from 6 u (the harpoon in the rock, Task 4);
    - (e) the same at night (weather.set to midnight), his lantern the only light.
  - Tune `CRUST` (and `CRUST.sandC`) and Task 3a's `cover` / `reveal` / `crestW` for "the crest reads as rock, not a creature". `CRUST` is a separate export, so it gets its own live path: `__burial` gains `crust: CRUST` and `setCrust(patch)` (`Object.assign(CRUST, patch)`, no rebuild), and the `updateBrooder` crust line (Step 3) reads it every frame: `uCrustK.value.set(CRUST.alb, CRUST.nrm, CRUST.sand, CRUST.crack); uCrustRough.value = CRUST.rough; if (CRUST.sandC != null) uSand.value.setHex(CRUST.sandC);` (uniform writes only, no program change). Task 3a's knobs go through `__burial.set` (a rebuild). Any change to Task 3a's knobs re-runs Task 4's `_crestScan` and `harpoon-probe routes` before the checkpoint: the seat must survive the tuning.
  - Book each trial (knobs, files) in the ledger. Stop after 6 trials and hand the best two to the controller.
  - **The thorns contingency (spec):** "If her dorsal thorns still betray her, they shrink into the crust while bury > 0."
    - The sculpt's thorns are baked into the body mesh: knobs up her keel, horns at her shoulders (`brooderSculpt.js spinesSpec`).
    - The shoulders' horns sit at the rim and are under the floor at the sink: the probe's `sides` check proves it.
    - If the keel's knobs break the outcrop's outline in the stills, the shrink is a vertex term in `crustTerm`.
      - At `#include <begin_vertex>`, it pulls `transformed.y` down toward the keel's smoothed profile `uKeel[16]` by `uBury * CRUST.shrink * max(0, transformed.y - keel(z))`, where `keel(z)` is a 16-sample profile of `L.topAt(0, z)` box-filtered over ±0.08.
      - It runs only within |x| < 0.12 of the keel. The uniform array is set at `bedDown`.
    - Its collider mismatch (the proxy is not shrunk) is ≤ the knobs' height, about 0.5 u. Book it.
    - Build it only if the stills need it. Record the call either way.

- [ ] **Step 5: GREEN.**
  - `programs` PASS on (a)/(b) (later checkpoints in their tasks). `__shaderFailed()` [].
  - `disguise` still PASS. The crust is shading only.
  - At Pallid, `L.crustU.uBury.value === 0` every frame.
  - `hitch.mjs`: start the bench Chrome on the branch's GAME port (`cdp.mjs start [port]` opens `http://localhost:<port>/?bench`; its default 9021 is not served): `BENCH_DBG_PORT=9543 node tools/bench/cdp.mjs start 8886`. Then `BENCH_DBG_PORT=9543 SCEN=jet,z1,z2,voyage node tools/bench/hitch.mjs` (no URL: it reloads the tab's own), then `BENCH_DBG_PORT=9543 node tools/bench/cdp.mjs stop`. Bar: no new first-sight compile.
  - Invariants.

- [ ] **Step 6: Commit**: `velkath buried: the crust (rock shading by bury, sand in her hollows, the crack network), one program at every site, boot-built; disguise stills`.

- [ ] **Step 7: MICHAEL'S CHECKPOINT (the spec's "Disguise, judged"), with the harpoon in the rock.**
  - The controller shows Michael stills (a), (b), (d) and (e). The harpoon is in them: the reveal is "what looked like a harpoon in the rock".
  - Two short questions go with them, both looks:
    - "From 10 u and 20 u in his light: does the crest read as a rock with an old harpoon in it, not a creature?" If Task 4 needed `sandOpen` (a lopsided outcrop showing more of the side facing him), say so and show it.
    - "The growth on her back: buried with her outside the strip, a few on the exposed rock. Keep that, bury all of it, or let more stand?"
  - RIDGE_LINE ("THE RIDGE IS WARM UNDER YOUR HAND.") goes with Task 16's look, not here.
  - Nothing after Task 5 builds until he answers. Changes he asks for are made here, in Tasks 2–5's knobs. Every probe they touch is re-run, Task 4's scan and seat first.
  - Then the crest's knobs are frozen, and the ledger records his words.

---

### Task 6: The clutch and the sleeping lines under the sand

**Files:** modify `src/entities/sleeper/brood.js` and `tools/bench/burial-probe.mjs` (the clutch check).

**Interfaces:** consumes `L.buried`, `L.bury`, `__burial.sandAt`. Produces no new API.

- [ ] **Step 1: The RED.** Add the `clutch` check to `disguise`: every live lobe (`L.brood.live`, x y z r body-local) has its top `y + 1.25 r` in world ≤ sand − 0.05. On the Task 5 head it should already pass for the lobes: they rest on the unsunk floor and sink with her (Task 2's `bedDown` order).
  - If it passes, the RED for this task is the order itself. Run `bedDown` with the clutch seated **after** the sink (a scratch edit, not committed) and confirm the check fails. That proves the check discriminates.
  - Record both runs.

- [ ] **Step 2: The find line and the fan.** In `B.update`:
  - the fan's puff: `if (L.dormant && B.seated && !(L.bury > 0.5) && (B.fanT -= dt) <= 0)`;
  - the clutch line: `else if (!F.clutch && L.dormant && !(L.bury > 0.5) && B.seated && near(B.takeAt, 11))`.
  
  Add a comment: buried, there are no eggs to see, and a line about them would be a lie; risen and calmed, the shipped behaviour is untouched.

- [ ] **Step 3: The other sleeping lines stay** (spec: "the dive-start line and the brood trail stay as they are"). `RIDGE_LINE` ("THE RIDGE IS WARM UNDER YOUR HAND.") is said within 1.3 R while she is dormant, unchanged. Whether it gives the rock away is Michael's call (a feel), asked with Task 16's look, not this plan's.

- [ ] **Step 4: GREEN.**
  - `disguise` (clutch) PASS.
  - A real walk round the outcrop at 6–10 u for 30 s books no "A CLUTCH UNDER HER" line (`__msg` log).
  - At Pallid, the clutch line still shows at its take point (`brooder-clutch-rite.mjs`'s check, or a direct `near` walk).

- [ ] **Step 5: Commit**: `velkath buried: the clutch under the sand with her; its line and the fan held while she is buried`.

---

### Task 7a: The rise out of the sand — the schedule, the pour, the shove, no danger until she stands

**Files:**
- Modify:
  - `src/entities/sleeper/brooder.js` (`updateBrooder`'s rise; `L.rising`; the threat and THE DROP held until she stands);
  - `src/entities/sleeper/burial.js` (the rise schedule);
  - `tools/bench/burial-probe.mjs` (mode `rise`).

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `L.moundK` (the dune's blend during the rise);
  - `L.cracked`, `L.crackT`;
  - `L.hasStood`;
  - `L.risenUp` (false while a buried rise has not stood: the hammer and the drop held);
  - `BURY.riseU`, `pourU`, `crackT`, `shoveV`, `shoveStag`, `holdRise`.

The spec: "No tear during the rise ... The fight's dangers (the drop, the hammer, the tear) start once she stands." Three paths can hurt him, and each is held until she has stood:
- **Her body's contacts:** `L.rising` (game.js's slam test needs `!lev.rising`).
- **The hammer:** its `ev.slam` is set inside updateBrooder, gated only by `threatE` and `swing`. Her `threatTarget` is held at 0.
- **THE DROP:** `dropImpact`, gated by noSafeSpot's `live = hunt && standE > 0.9`. `live` is held false, so the count does not run.

On the plan's own clock, `standE` passes 0.9 about 4.8 s after the wake, a first blow could land about 7.1 s and a drop start about 7.8 s, while `hasStood` (the clock done, the heave settled) comes about 7.5–8.5 s. Without these holds, bar (a) could fail for reasons nothing built for.

- [ ] **Step 1: The `rise` mode and its REDs.**
  - The mode:
    - Plug the clock. `__chart.arrive(0)`, `gotoZone(0)`.
    - Stand him per `BP_AT`:
      - `anchor` (Alt+6, the default);
      - `crest` (the crest's top: Review Focus 2);
      - `off` (12 u off her sand side);
      - `front` (in front of her at 2.3 R, the ring where her hammer's hinge lands: brooder.js HUNT's comment).
    - At `anchor`, press real E (the wrench, the free, the wake 0.7 s later). Elsewhere a pull would abort (harpoon.js `H.update`: he is more than `REACH + 1` from the anchor), so wake her with `lev.cmd('wake')`: the same `wakeBrooder` the pull's `onWake` calls.
    - Step 14 s, booking per frame:
      - t from the wake;
      - `L.stand`, `L.standE`, `L.bury`, `L.moundK`, `L.heave.x/v`, `L.rising`, `L.hasStood`, `L.bodyY`;
      - `L.threatE`, `L.nsT`, `L.drop` (the hammer's and the drop's first possible frame, booked);
      - `L.probe().sight` (seen, tau, blindT, lost);
      - `player.stagger`, his position over the drawn surface;
      - `window.__slamLog.length` and the dress's tear count (`survival` tear field);
      - each ward's height over the sand and `lit`;
      - `bodyBlocked` at his capsule (0.45 / 1.0 / 1.6 over his boots);
      - the lens over the drawn surface and `bodyBlocked(lens, 0)`.
  - The bars this task owns:
    - (a) from E until `L.hasStood`: tears 0, `threatE` 0 and `nsT` 0 (no blow cocked, no drop counting);
    - (b) with `BP_AT=crest` or `anchor`, `player.stagger > 0` within 1.0 s of the wake, and his distance from her strip centre rising over the next 1.5 s;
    - (c) every ward < 0 over the sand at the wake, > 2 u at `hasStood`, and none lit;
    - (d) her body's |dY/dt| ≤ 8 u/s every frame (no pop);
    - (e) Review Focus 2: his capsule never `bodyBlocked` after 1.5 s past the wake, and the lens never `bodyBlocked(lens, 0)` nor under the drawn surface + 0.3;
    - (f) the dune drawn back by her stand (`moundK` 0, `MD.drawn` false).
  - The blind bar is Task 8's.
  - REDs:
    - `BP_RED=noshove` (`{shoveV: 0, shoveStag: 0}`) fails (b).
    - `BP_RED=tearable` (`{holdRise: 0}`) with `BP_AT=crest` must fail (a): a tear from her rising shell.
    - `BP_RED=early` (`{holdRise: 0}`) with `BP_AT=front` must fail (a): her hammer cocks (or lands) before she has stood.
    - **Dry-run both `holdRise` REDs first.** If one does not fail, the hold it covers is proven only by construction plus the zero count. Stop for the controller's ruling: it may name a stronger case (the perfect policy's opening from relief Task 8, which met her heave at 9.2 s). Never proceed past it silently.
  - Run the REDs on the Task 6 head (no rise beats yet): (b) must fail as it is, and (c) and (d) are readings. Record them.

- [ ] **Step 2: The rise schedule** (append to `BURY`, with the spec's beats as the comment):

```js
// THE RISE (spec §2, "about 6 s", on brooder.js RISE_T; u = L.stand, 0..1 over it):
//   crack   the crust cracks along her length over crackT s (uCrack, Task 7b), ev.quake jolts the lens, slabs of crust slough off (7b)
//   pour    she comes up out of the sand over riseU (bury 1 -> 0), the dune draws back down her sides over pourU (moundK), sand
//           streams off the dune's flanks (7b)
//   plume   plume.js 'rise' (Task 8)
// shoveV / shoveStag: on her the crack shoves him flat off her (u/s, s of stagger): "Her rising body shoves him back with a stagger,
// but cannot tear the dress". holdRise: "The fight's dangers (the drop, the hammer, the tear) start once she stands": until she has
// STOOD (the rise clock done and the heave settled) her body's contacts are a shove, her threat is held at 0 (no hammer) and the drop's
// count does not run (relief Task 8: the heave's overshoot closing her rise tore a perfect player in 8 of 12 fights).
Object.assign(BURY, { riseU: [0.04, 0.62], pourU: [0.08, 0.66], crackT: 0.8, shoveV: 5, shoveStag: 0.8, holdRise: 1 });
```

- [ ] **Step 3: brooder.js — the rise and the holds.**
  - Right after `L.clawSt = ...` and the heave spring:

```js
  // (velkath-buried-rock) THE RISE OUT OF THE SAND (BURY above): only ever down while she rises; the beats on the same clock
  if (L.buried && !L.calmed && !L.dormant && rising) {
    const b = 1 - win(u, BURY.riseU[0], BURY.riseU[1]);
    if (b < L.bury) L.bury = b;
    L.moundK = Math.min(L.bury, 1 - win(u, BURY.pourU[0], BURY.pourU[1]));
    if (!L.cracked) { L.cracked = true; L.crackT = 0; crackBeat(L, ev, player); }
  }
  if (L.cracked && L.crackT < BURY.crackT + 1) L.crackT += dt;
```

  - Before `L.rising = rising;`:

```js
  // (velkath-buried-rock) the rise is not over until she STANDS (the clock done and the heave settled): until then her body's contacts
  // are a shove, not a slam (game.js reads L.rising), her threat is held and the drop's count does not run (L.risenUp, below).
  // Not buried: exactly the shipped line, and L.risenUp true.
  if (L.buried && !L.dormant && !L.calmed && !L.hasStood && L.stand >= 1 && Math.abs(L.heave.x - 1) < 0.02 && Math.abs(L.heave.v) < 0.05) { L.hasStood = true; L.crackK = 0; }
  L.risenUp = !(L.buried && BURY.holdRise > 0 && !L.dormant && !L.calmed && !L.hasStood);
  L.rising = rising || !L.risenUp;
```

  - The threat: `if (!L.hold && !L.calmed && !L.dormant) L.threatTarget = L.risenUp && L.standE > 0.9 && L._pdT < L.R * L.threatR && L.blindT < SIGHT_GIVEUP && !L.under ? 1 : 0;` (the shipped line with `L.risenUp &&` in front).
  - THE DROP: in `noSafeSpot`, `const live = hunt && L.standE > 0.9 && L.risenUp !== false;`. Not buried, `L.risenUp` is true and both lines are the shipped ones.
  - `L.crackK` goes back to 0 once she stands, so a dig-in's crust (Task 12) never shows a frozen crack. brooder.js imports `extraFloorAt` from terrain.js.
  - The crack beat (its slabs come in Task 7b):

```js
// THE CRACK (spec §2, beat 1): the crust cracks along her length, the ground jolts, slabs slough off; a man on her is shoved flat
// off her with a stagger (safeThrow: never toward the crack), never torn
function crackBeat(L, ev, player) {
  const MD = L.mound;
  quake(L, ev, MD ? MD.cx : L.pos.x, MD ? MD.cz : L.pos.z, 0.6, player);
  if (L.slabs) slabsBreak(L);   // (Task 7b: until then L.slabs is undefined)
  if (!player || !(BURY.shoveV > 0)) return;
  // (onHerGround alone can miss a man up on the crest: its height cutoff is her sunk body's + 0.15 R. The extraFloorAt term is what
  // catches him there: last frame, dormant, her crest and dune were ground under him.)
  const on = onHerGround(L, player, 1.0) || extraFloorAt(player.pos.x, player.pos.z, L.idx) > terrainH(player.pos.x, player.pos.z, L.idx) + 0.3;
  if (!on) return;
  const cx = MD ? MD.cx : L.pos.x, cz = MD ? MD.cz : L.pos.z;
  let dx = player.pos.x - cx, dz = player.pos.z - cz; const dl = Math.hypot(dx, dz);
  if (dl > 1e-3) _ns.set(dx / dl, 0, dz / dl); else _ns.set(L.sand.x, 0, L.sand.z);
  safeThrow(_ns, player.pos.x, player.pos.z, L.idx);
  _ns.y = 0.10; _ns.normalize();
  player.vel.addScaledVector(_ns, BURY.shoveV);
  player.stagger = player.staggerDur = BURY.shoveStag; player.staggerK = 0.85;
  L.shoveN = (L.shoveN || 0) + 1;
}
```

- [ ] **Step 4: GREEN.**
  - `rise` with `BP_AT=anchor`, `crest`, `off` and `front`: bars (a)–(f) PASS ((b) only where he stood on her).
  - `BP_RED=noshove`: exit 5. `BP_RED=tearable` and `BP_RED=early`: exit 5, or the controller's ruling recorded.
  - `harpoon-probe rite`: PASS.
  - `fissure-probe velkath-crack`: PASS at home, Pallid and Burned. Her hunt after a buried wake keeps every bound.
  - Invariants.

- [ ] **Step 5: Commit**: `velkath buried: the rise out of the sand (the schedule, the pour back down her sides, the shove; no tear, hammer or drop until she stands)`.

---

### Task 7b: The crack's look — the crust cracking, the slabs, the sand streaming off

**Files:**
- Modify:
  - `src/entities/sleeper/burial.js` (the crust slabs);
  - `src/entities/sleeper/brooder.js` (`uCrack`'s drive; the slabs; the pour's streams);
  - `tools/bench/burial-probe.mjs` (`rise`: the slabs' booking; `programs` (b)).

**Interfaces:**
- Consumes: Task 7a's `L.cracked`, `L.crackT`, `L.moundK`, `crackBeat`; Task 5's `L.crustU`.
- Produces: `L.crackK` (0..1); `makeSlabs(L)`, `slabsBreak(L)`, `slabTick(L, dt)`; `BURY.slabs`, `pourRate`.

- [ ] **Step 1: The RED.** On the Task 7a head, `rise` books `L.crackK` 0 throughout and no slab (`L.slabs` undefined): the new bookings below read UNMEASURED, recorded. `programs` (b), run rendered through the rise on that head, is the baseline count.

- [ ] **Step 2: The crack's drive.** In the rise block, after Task 7a's `L.crackT += dt` line: `L.crackK = Math.min(1, L.crackT / BURY.crackT) * L.bury;`. Task 5's `updateBrooder` line already feeds `uCrack` from `L.crackK`.

- [ ] **Step 3: The crust slabs** (burial.js). One `InstancedMesh` of the jam's rock kit, set up exactly as the debris is, so its program is the boulders' own. In `bedDown` (buried), after the mound's fit: `if (!L.slabs) makeSlabs(L);`. In `updateBrooder`, right AFTER Task 7a's rise block (so on the crack's frame `slabsBreak` has laid the slabs before the first `slabTick` writes their matrices; run first, the frame would draw 14 instances at their unset matrices): `if (L.slabs) slabTick(L, dt);`. Task 7a's `crackBeat` already calls `slabsBreak(L)` once `L.slabs` exists. brooder.js imports the three from burial.js. Append `slabs: 14, pourRate: 2.5` to `BURY`.

```js
import { jamRockKit } from '../../world/flora.js';
import { seededRand } from '../../lib/textures.js';
// THE CRACK'S SLABS (spec §2, beat 1: "Slabs of crust slough off"): BURY.slabs pieces of the house rock kit laid on her exposed crest
// at the crack, sliding down her back's slope and out over the sand, tumbling, sinking into it, gone in SLAB_T s. Hidden otherwise.
// Per slab: x y z vx vz rot age scale (S, 8 floats).
const SLAB_T = 3.0, _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _se = new THREE.Euler(), _ss = V3(), _sc = new THREE.Color();
export function makeSlabs(L) {
  const kit = jamRockKit(0, seededRand(0x51AB5), 3, 0.35, 0.6, 1.8);
  // EXACTLY the debris' setup (physics.js, fissure.js): the caller adds aInst (zeros: no sway) and an instanceColor, receives shadows and
  // casts none (flora.js jamRockKit's own comment: so the program key is the boulders' own). Anything else is a new program, compiled
  // on first sight at the crack (castShadow true alone adds a shadow-depth variant)
  kit.geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(BURY.slabs * 4), 4));
  const im = new THREE.InstancedMesh(kit.geo, kit.mat, BURY.slabs);
  for (let k = 0; k < BURY.slabs; k++) im.setColorAt(k, _sc.set(kit.rock));
  im.instanceColor.needsUpdate = true;
  im.receiveShadow = true; im.castShadow = false;
  im.visible = false; im.frustumCulled = false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  L.grp.add(im);
  L.slabs = { im, S: new Float32Array(BURY.slabs * 8), t: SLAB_T };
  const prev = L.onDispose;
  L.onDispose = () => { if (im.parent) im.parent.remove(im); kit.geo.dispose(); if (prev) prev(); };   // (kit.mat is the zone's, shared)
}
export function slabsBreak(L) {
  const Sl = L.slabs, MD = L.mound; if (!Sl || !MD) return;
  const S = Sl.S, n = BURY.slabs, R = L.R;
  for (let k = 0; k < n; k++) {
    // along the strip's length, jittered across it
    const f = (k + 0.5) / n, lz = MD.crestZ + (f - 0.5) * BURY.crestL / R * 0.9, lx = (Math.random() - 0.5) * BURY.crestW / R * 0.6;
    const x = MD.cx + (lx * MD.c + lz * MD.s) * R, z = MD.cz + (-lx * MD.s + lz * MD.c) * R;
    const y = crestY(MD, x, z), side = lx >= 0 ? 1 : -1;
    S[k * 8] = x; S[k * 8 + 1] = y > -1e8 ? y : MD.mw[13]; S[k * 8 + 2] = z;
    S[k * 8 + 3] = side * MD.c * 1.2; S[k * 8 + 4] = -side * MD.s * 1.2;   // outward across her back (her local +x in the world)
    S[k * 8 + 5] = Math.random() * 6.283; S[k * 8 + 6] = 0; S[k * 8 + 7] = 0.8 + 0.8 * Math.random();
  }
  Sl.t = 0; Sl.im.visible = true;
}
export function slabTick(L, dt) {
  const Sl = L.slabs; if (!Sl || Sl.t >= SLAB_T) return;
  Sl.t += dt;
  const S = Sl.S, MD = L.mound;
  for (let k = 0; k < BURY.slabs; k++) {
    const o = k * 8;
    S[o + 6] += dt;
    S[o + 3] *= 1 + 0.8 * dt; S[o + 4] *= 1 + 0.8 * dt;                          // gathering way down the slope
    const sp = Math.hypot(S[o + 3], S[o + 4]); if (sp > 2.5) { S[o + 3] *= 2.5 / sp; S[o + 4] *= 2.5 / sp; }
    S[o] += S[o + 3] * dt; S[o + 2] += S[o + 4] * dt;
    const under = Math.max(crestY(MD, S[o], S[o + 2]), moundY(MD, S[o], S[o + 2]), terrainH(S[o], S[o + 2], L.idx));
    const sink = Math.max(0, S[o + 6] - 1.4) * 0.45;                           // into the sand once it has slid off
    S[o + 1] = under - sink;
    _se.set(0.6 * S[o + 6], S[o + 5], 0.3 * S[o + 6]); _sq.setFromEuler(_se);
    const s = S[o + 7] * (1 - Math.max(0, (Sl.t - (SLAB_T - 0.4)) / 0.4));       // and gone
    Sl.im.setMatrixAt(k, _sm.compose(_ss.set(S[o], S[o + 1], S[o + 2]), _sq, _v.set(s, s * 0.35, s)));
  }
  Sl.im.instanceMatrix.needsUpdate = true;
  if (Sl.t >= SLAB_T) Sl.im.visible = false;
}
```

  The `rise` mode books `L.slabs.im.visible` and the slabs' lowest point over the drawn surface. A slab hovering more than 0.3 u is a fail: they ride the surface until they sink.

- [ ] **Step 4: The pour's streams.** In the "silt pours off her back" block, when `L.buried && L.mound && L.moundK > 0.02`:
  - multiply the rate term by `BURY.pourRate`;
  - spawn at a random bearing's ring-4..8 vertex of `L.mound.M` (the fitted dune's flank: where the sand was) in place of her rim.
  
  The shipped branch is untouched.

- [ ] **Step 5: GREEN.**
  - `rise` (all placements): Task 7a's bars still PASS; `L.crackK` rises to ≥ 0.9 × `bury` within `crackT` + 0.1 s of the wake; every slab within 0.3 u of the drawn surface while visible and hidden by 3.1 s.
  - `programs` (b), rendered through the rise with her in frame: equal to (a). The slabs' first draw compiles nothing.
  - Invariants.

- [ ] **Step 6: Commit**: `velkath buried: the crack's look (the crust cracks, slabs of it slough off in the house rock kit's own program, sand streams off the dune)`.

---

### Task 8: The plume — the `rise` kind, and her blind start

**Files:**
- Modify:
  - `src/entities/sleeper/plume.js` (the kind, its 12 records, the footfall ring held to its 8);
  - `src/entities/sleeper/brooder.js` (spawns on the beats);
  - `tools/bench/burial-probe.mjs` (`rise`: the blind and plume bars).

**Interfaces:**
- Produces:
  - `spawnPlume(x, y, z, 'rise', k, zi)`;
  - `PLUME.rise`;
  - `plumeState().rise` (live rise records), `plumeState().riseEvicted` (rise records overwritten while still live: must stay 0);
  - `BURY.plume` (0 = no rise plume, the RED).

- [ ] **Step 1: The blind and plume bars, and their RED.**
  - Add to `rise` (with `BP_AT=anchor`, Sal still after the shove):
    - (g) her first blind spell. `L.lostN` rises during the rise (she loses him), and `blindT` on the frame she finds him (`seen` false → true) is in **[3.0, 4.0] s**. Book the time from the wake too.
      - **Which rule ended it is booked, and only a line-of-sight ending is judged.** `sight()` also reacquires him at once on a bump (`L._pd < collR × 1.05`), a touch of her shell (`L.touchT > 0`: game.js sets it whenever his capsule meets her shell) or a lit ward (`sigilLit`). Book per spell: `clearT ≥ SIGHT.reacq` (line of sight), `touchT`, `_pd`, `sigilLit`. A spell ended any other way is reported, not judged; (g) needs a line-of-sight ending in at least the `anchor` and `off` placements (UNMEASURED otherwise).
    - (h) the plume's density footprint. At its widest over the rise, the farthest of 32 bearings from her strip centre where `__plume.dens(x, groundY + 1.5, z) > 0.02` is in [15, 20] u.
    - (i) it climbs: the height of the density's peak over the floor rises ≥ 3 u over the first 4 s.
    - (j) no live particle overwritten during the rise: `plumeState().quadEvicted` 0 (the quad ring of 448 wraps by construction, so a count of quads could not fail; overwriting a still-living particle can);
    - (k) `plumeState().riseEvicted` 0 over the rise: every live rise cloud keeps its density record, so the cloud she is blinded by is the cloud on screen (plume.js: the cloud is "REAL to her").
  - **The reading is Michael's ruling** (2026-10-15: "I thought I already approved this but yes these are fine to proceed with"): she is blind for 3–4 s starting about 3 s into the rise, so she finds him about 6–7 s after the wake, about as she stands. That is the spec's "blind for the first 3–4 s" as the unchanged rule can show it: `sight()` cannot lose him before `standE` 0.5, about 3 s in.
  - On the Task 7b head, (g) must fail: no plume, so she never loses him. Record it.

- [ ] **Step 2: The kind** (plume.js):
  - Add to `PLUME`:

```js
  // THE RISE (velkath-buried-rock §2): the sand pouring off her as she comes up out of it. A ring at the crack, more as the sheets
  // fall; it spreads to 15-20 u and climbs, and it is REAL to her (the density model): the SIGHT rule blinds her in it, no new rule.
  // Long-lived and slow (kd), so the line from her eyes stays thick past her first look (standE 0.5, ~3 s in).
  rise: { n: 16, life: [6.5, 8.5], vr: [2.0, 8.0], vy: [0.8, 3.2], s0: [4.0, 6.0], s1: [10, 15], a: 0.62, kd: 0.55,
    rh0: 3.0, rhA: 13.0, rhK: 0.45, hv0: 2.0, hvA: 6.0, hvK: 0.45, D: 4.2 }
```

  - **The records.** `PL` goes 12 → 24:
    - records 0..3: the hammer's (unchanged);
    - records 4..11: the footfalls'. Their ring was `recHeadS = (recHeadS + 1) % (PL - 4)` (plume.js `spawnPlume`): at a larger PL it would run on into the rise records, and her legs step during the rise (`standE > 0.35`: brooder.js's `'small'` plume on a heavy footfall), inside the blind window. So it becomes `% 8`, its shipped span, written out;
    - records 12..23: the rise's 12 (`recHeadR = (recHeadR + 1) % 12`). A rise is at most 6 + 2 × 3 = 12 clouds (Step 3), so no rise cloud evicts another while it lives.
    
    `KINDS = [PLUME.big, PLUME.small, PLUME.rise]`.
  - In `spawnPlume`: `ki = kind === 'small' ? 1 : kind === 'rise' ? 2 : 0`, and `K` likewise. The core-column rule (`ki === 0 && i % 3 === 0`) stays the hammer's. Records: `ki === 2 → o = (12 + recHeadR) * 8; if (rec[o + 7] && clock - rec[o + 3] < rec[o + 4]) riseEvicted++; recHeadR = (recHeadR + 1) % 12`.
  - In `spawnPlume`'s particle loop, before a slot is written: `if (c[p + 2] > 0 && clock - a[p + 3] < c[p + 2]) quadEvicted++;` (that slot's particle is still alive). Module state: `let recHeadR = 0, riseEvicted = 0, quadEvicted = 0;`.
  - `plumeState()` returns them, with the live rise records:

```js
export function plumeState() {
  let n = 0, big = 0, rise = 0;
  for (let i = 0; i < PL; i++) if (rec[i * 8 + 7] && clock - rec[i * 8 + 3] < rec[i * 8 + 4]) { n++; if (i < 4) big++; else if (i >= 12) rise++; }
  return { live: n, big, rise, riseEvicted, quadEvicted, clock, visible: !!(mesh && mesh.visible), veil: veil ? +veil.material.uniforms.uA.value.toFixed(3) : 0, veilOn: !!(veil && veil.visible) };
}
```

  - `clearPlumes()` also resets `recHeadR = riseEvicted = quadEvicted = 0` (every new sleeper calls it on dispose: a rise's counters belong to that rise).
  - `densRec` already reads `KINDS[rec[o + 5]]`. `plumeTau` loops PL: 16 samples × 24 records once a frame for her sight, booked in Task 15's cost.
  - The quads stay inside the shared ring of 448: at most 12 rise clouds × 16 = 192 a rise, while no hammer falls.

- [ ] **Step 3: The spawns** (brooder.js, in the rise block), when `BURY.plume`. Append `plume: 1` to `BURY` (`BP_RED=noplume` is `__burial.set({ plume: 0 })`):

```js
    // (velkath-buried-rock) THE PLUME (spec §2, beat 3): a ring at the crack, more as the sheets fall (plume.js 'rise')
    if (BURY.plume && L.mound) {
      const MD = L.mound;
      if (L.crackT === 0) for (let q = 0; q < 6; q++) { const o = ringAt(MD, 3, RISE_J[q]); spawnPlume(MD.M[o], MD.M[o + 1], MD.M[o + 2], 'rise', 1, L.idx); }
      const sheet = L.moundK < 0.25 ? 3 : L.moundK < 0.5 ? 2 : L.moundK < 0.75 ? 1 : 0;
      while ((L.riseSheetN || 0) < sheet) {
        const j0 = (L.riseSheetN || 0) * 37;
        let o = ringAt(MD, 6, j0); spawnPlume(MD.M[o], MD.M[o + 1], MD.M[o + 2], 'rise', 1, L.idx);
        o = ringAt(MD, 6, j0 + 64); spawnPlume(MD.M[o], MD.M[o + 1], MD.M[o + 2], 'rise', 1, L.idx);
        L.riseSheetN = (L.riseSheetN || 0) + 1;
      }
    }
```

  At module level (no closure or array literal per rising frame):

```js
const RISE_J = [0, 21, 43, 64, 85, 107];                                     // the crack's ring of six bearings
const ringAt = (MD, ring, j) => (ring * MD.COLS + (j % MD.COLS)) * 3;       // a dune vertex's offset
```

  (`L.crackT === 0` is the crack's own frame: `crackBeat` runs and sets it in that frame, before the `+= dt`. The positions are the FITTED dune's, `MD.M`, so a cloud bursts where the sand was.)

- [ ] **Step 4: Tune to the bars.**
  - The knobs: `PLUME.rise.life` / `D` / `rhA` / `kd`, and the spawn schedule.
  - Book every trial in the ledger: knobs, blind spell, footprint.
  - **Stop rule:** six trials without (g) and (h) both in band → stop and hand the table to the controller. The two bars may conflict: a thick enough cloud may spread past 20 u. The ruling may go to Michael. Never move a bar.

- [ ] **Step 5: GREEN.**
  - `rise` (g)–(k) PASS, with (a)–(f) still PASS.
  - `BP_RED=noplume`: exit 5.
  - Report the blind spell also with him standing 10 u and 25 u off her flank (booked, not gated).
  - `fissure-probe velkath-crack`: PASS.
  - `harpoon-probe rite`: PASS.

- [ ] **Step 6: Commit**: `velkath buried: the rise plume (plume.js 'rise', its own record ring); blind <s> s by the SIGHT rule`.

---

### Task 9: The sound — a deep grinding crack, then the long hiss of the pour

**Files:** modify `src/audio/creatures.js` (`velkathWake`, new `velkathCrack`).

**Interfaces:** consumes `L.buried` (the wake's `growl()` passes the live sleeper as `E.in.lev`).

- [ ] **Step 1: A presence check, not a RED.** In a page with audio unlocked (`__audio.unlock()`), wake her at home (`lev.cmd('wake')`: her next update raises `ev.woke`, and game.js calls `growl()`). Then `__audio.log(40)` does not contain `velkathCrack`. It cannot yet: this only proves the log is read after the wake, and is named that in the ledger. The discriminating checks are Step 3's (home against Pallid, and the level).

- [ ] **Step 2: The voice** (generated, as the hard rule requires):

```js
// (velkath-buried-rock) THE CRACK: the crust splitting along her length as she starts up out of the sand - a dry split that runs (a
// train of short bright cracks), the ground under it (a deep thump) and a deep grind - before her wake's own voice
function velkathCrack(E, vg, t) {
  noiseHit(E, vg, t, 'white', 'bandpass', 1900, 1.2, 0.002, 0.35, 0.30 * E.startle, 600);
  for (let i = 0; i < 6; i++) noiseHit(E, vg, t + 0.05 + i * E.r(0.06, 0.14), 'white', 'bandpass', E.r(900, 2400), 3, 0.001, 0.08, 0.10 * E.startle);
  thump(E, vg, t, 55, 24, 1.2, 0.55 * E.startle);
  grind(E, vg, t + 0.15, 1.4, 0.35 * E.startle, 18, 40, [[180, 5, 1], [420, 7, 0.6]]);
  E.log('velkathCrack');
}
```

  In `velkathWake`, right after the `vg` line: `if (L.buried) velkathCrack(E, vg, t);`. After the shipped `noiseHit(... 'silt pouring off her back')`:
  
  `if (L.buried) noiseHit(E, vg, t + 0.6, 'pink', 'bandpass', 900, 0.6, 1.6, 7.5, 0.20, 240);   // (velkath-buried-rock) the long hiss of the pour, under her growl`
  
  Not buried: the shipped voice, unchanged.

- [ ] **Step 3: GREEN.**
  - The wake at home logs `velkathCrack` then `velkathWake`.
  - At Pallid only `velkathWake`.
  - The level: `__audio.peak()` is an instant read, so sample it every 100 ms through the wake's window (0–8 s from `ev.woke`) on both builds (the branch at home, the main copy at home), and compare the series' maximum `limGR` and its mean. The branch within 1 dB of main on both. It adds a crack and a hiss, not a wall.
  - The ear is Michael's (Task 16's video carries it).

- [ ] **Step 4: Commit**: `velkath buried: the crack and the pour in her wake's voice (generated)`.

---

### Task 10: The point — she turns her front to the opening crack and reaches with her great claw

**Files:**
- Modify: `src/entities/sleeper/brooder.js` (the point phases; `poseClaws`' reach; the walk home deferred; lab verb `calm`).
- Create: `tools/bench/pointcam-probe.mjs` (mode `point`; Task 11 adds the rest). It opens as burial-probe does: exit 2 before importing drv.mjs when `DRV_PORT` is unset or reserved; run it with `DRV_PORT=9540`.

**Interfaces:**
- Produces:
  - `L.pointPh` (0 none / 1 turn / 2 raise / 3 hold / 4 lower), `L.pointT`;
  - `L.pointK` (0..1, the claw's reach);
  - `L.pointAt` (`Vector3`: the crack's opening);
  - `POINT` knobs;
  - `L.cmd('calm')`: lights every dark ward on the next update, through `common.js lightWard` (dev, as `wake`).

- [ ] **Step 1: The `point` mode and its RED.**
  - Plug the clock. Home, `gotoZone(0)`, `window.survival.hose = 760` (velfix-gate's `FP_HOSE`). Without enough line, `canDescendTo(1)` fails (survival.js `HOSE_REQ` 640 against a fresh diver's 380) and the calm says "IT STILLS. YOU HAVE ... M OF LINE..." at once, never "A RIFT OPENS BELOW."
  - `lev.cmd('wake')`, step until `hasStood`. Then stand him per `PC_AT`, and `lev.cmd('calm')`:
    - `back` (the worst case, and the one the turn bar judges): 25 u off her sand side, facing her. At home the opening, `riftPos(0)` (81.5, 83.9), is about 45 u from her bed (89.7, 39.1) at a bearing about 158° from `L.sand`. After she has turned to face him, the opening is up to about 160° behind her front;
    - `ahead`: 25 u from her on the line toward the opening, so her front is already about on it.
  - Step 14 s, booking per frame:
    - `L.pointPh`, `L.pointK`, `L.yaw`;
    - the bearing to `L.pointAt`, and her heading error to it (booked at the calm too);
    - shoulder (`claws[major].root` world), palm (`pj`/`dj` midpoint), `pointAt`;
    - `__fissure.k(0)`;
    - the message log (`__msg().live`): which calm line showed, and its first frame;
    - tears.
  - Bars (both placements unless named):
    - the line that showed is "ALL WARDS LIT. IT STILLS. A RIFT OPENS BELOW." (else UNMEASURED: the hose was not set);
    - `back`: her front within 12° of the bearing to `pointAt` on the first frame `__fissure.k(0) ≥ 0.6`, at the pre-registered `POINT.turn` 0.5 rad/s;
    - the angle between shoulder→palm and shoulder→`pointAt` ≤ 20° while `pointK ≥ 0.95`;
    - `pointK ≥ 0.95` for 2.5–3.5 s, and that span contains the frame the line first shows;
    - 0 tears;
    - she walks home after (`L.walkTo` set within 1.2 s of `pointPh` leaving 4).
  - **The turn is a feel.** `POINT.turn` 0.5 rad/s already exceeds the 0.35 rad/s her calm heading turns at (brooder.js `wr`), and the yaw's inertia (`yawV += (yawWant − yawV) × 1.6 dt`) and the ×1.4 gain slow the last 20°. A swing near 160° takes about 6 s. If the `back` bar fails at 0.5, it is **not** tuned past it: the numbers (her heading error at the calm and at the light, per placement) go to Michael. His choices: she swings round faster than she ever does in the fight, she starts the raise late, or she points over her shoulder. The rest of the task goes on with the `ahead` placement.
  - `PC_RED=nopoint` (`__burial.set({ point: 0 })`): the claw never raises, so it must fail → exit 5.
  - On the Task 9 head the mode fails as written (no point). Record it.

- [ ] **Step 2: The knobs and phases.**

```js
// THE POINT (spec §3; Michael: "can she turn and point to the void with her giant claw"). The calm itself is unchanged (game.js:
// the wards burn, the crack opens over fissure.js's 6.6 s - quake, pour, silt, then the light from 3.6 s - and the line lands at
// 6.6 - 2.5 = 4.1 s). During the pour she turns her front to the opening (the throat's centre, riftPos(idx), at its lip height); as
// the light comes up her major claw rises and reaches toward it; she holds it ~3 s through the line, lowers it, and only then walks
// home. Not a blow: calmed, her contacts only push him aside (game.js's slam test needs !calmed). Buried sites only (home).
//   turn     rad/s (pre-registered; past it is Michael's feel call, never a tuning knob)
//   turnT / raiseT / holdT / lowerT  s on her own clock from the calm: the raise from 2.9 s (late in the pour, the light at 3.6), so
//            the claw is up (pointK 0.95) by ~3.8 s, before the line at 4.1; held to 6.9 s, down by 7.9 s. (A raise from 3.6 s put
//            the claw at 0.95 only at ~4.5 s: the line landed mid-raise and "holds it ... through the line" failed its own bar.)
export const POINT = { turn: 0.5, turnT: 2.9, raiseT: 1.0, holdT: 3.0, lowerT: 1.0 };
```

  At build (makeBrooder): `L.pointPh = 0; L.pointT = 0; L.pointK = 0; L.pointAt = V3(); L.pointPose = [0, 0];`. brooder.js imports `riftPos` from config.js and `lipMeanY` from fissureShape.js. `BURY` gains `point: 1`.

  In the `allLit` branch:

```js
      if (L.buried && BURY.point) {
        // (velkath-buried-rock) THE POINT first (POINT above); she walks home when it is done
        const rp = riftPos(L.idx);
        L.pointPh = 1; L.pointT = 0; L.pointAt.set(rp.x, lipMeanY(L.idx, terrainH), rp.z); L.standTarget = 1;
      } else if (L.brood) { L.walkTo = L.lairPos.clone(); L.toBed = true; L.standTarget = 1; }   // (the shipped line)
      else { L.standTarget = 0; L.walkTo = null; }
```

  Each frame, in the heading block: after the `let want = null, speed = 0;` declaration (it assigns `want`), and before the `if (L.walkTo && L.standE > 0.9)` / `homeTurn` chain:

```js
  if (L.pointPh) {
    const P = POINT, t = (L.pointT += dt), t1 = P.turnT, t2 = t1 + P.raiseT, t3 = t2 + P.holdT, t4 = t3 + P.lowerT;
    const ph = t < t1 ? 1 : t < t2 ? 2 : t < t3 ? 3 : t < t4 ? 4 : 0;
    if (ph === 2 && L.pointPh === 1) aimPoint(L);                       // the reach is solved once, as the light comes up
    L.pointPh = ph;
    L.pointK = ph === 2 ? ease((t - t1) / P.raiseT) : ph === 3 ? 1 : ph === 4 ? 1 - ease((t - t3) / P.lowerT) : 0;
    if (!ph) { L.walkTo = L.lairPos.clone(); L.toBed = true; }           // done: the shipped walk home
    else want = Math.atan2(L.pointAt.x - L.pos.x, L.pointAt.z - L.pos.z);
  }
```

  Wire the turn rate: where `const wr = hunt ? nsTurn(L) : 0.35;`, use `const wr = hunt ? nsTurn(L) : L.pointPh ? POINT.turn : 0.35;`. The `homeTurn` / `walkTo` branches are untouched. Not buried: the shipped `allLit` lines, unchanged.

- [ ] **Step 3: The reach.**

```js
// THE REACH, solved once as the light comes up: the major claw's root (merus) aimed down the shoulder -> opening line, the elbow and
// wrist near straight. The arm is a 'YZX' chain whose rest heading -PI/2 points it along her +z (buildClaw), so a unit direction t in
// her body frame from the shoulder is reached by rz = asin(t.y), ry = atan2(-t.z, t.x); one correction pass takes out what the elbow
// and wrist bend adds. Writes L.pointPose; no allocation.
const _pa = V3(), _pb = V3();
function aimPoint(L) {
  const c = L.claws[1].major ? L.claws[1] : L.claws[0];
  _pa.copy(L.pointAt).applyMatrix4(_inv.copy(L.body.matrixWorld).invert()).sub(c.root.position).normalize();   // her frame, from the shoulder
  let ry = Math.atan2(-_pa.z, _pa.x), rz = Math.asin(clamp(_pa.y, -1, 1));
  const r = c.root.rotation, r0x = r.x, r0y = r.y, r0z = r.z;
  r.set(0, ry, rz); c.root.updateMatrixWorld(true);
  _pb.setFromMatrixPosition(c.pj.matrixWorld).add(_v.setFromMatrixPosition(c.dj.matrixWorld)).multiplyScalar(0.5)   // the palm
    .applyMatrix4(_inv).sub(c.root.position).normalize();
  ry += Math.atan2(-_pa.z, _pa.x) - Math.atan2(-_pb.z, _pb.x); rz += Math.asin(clamp(_pa.y, -1, 1)) - Math.asin(clamp(_pb.y, -1, 1));
  r.set(r0x, r0y, r0z); c.root.updateMatrixWorld(true);
  L.pointPose[0] = ry; L.pointPose[1] = rz;
}
```

  In `poseClaws`, for the major claw, after its shipped pose and before the dormant tuck:

```js
      if (L.pointK > 0) {   // (velkath-buried-rock) THE POINT: the reach, blended in by L.pointK (no swing, no threat: she is calmed)
        const k = L.pointK, r = c.root.rotation;
        r.set(r.x + (0 - r.x) * k, r.y + (L.pointPose[0] - r.y) * k, r.z + (L.pointPose[1] - r.z) * k);
        tuckJoint(c.cj, PT_CJ, 0, sd, k); tuckJoint(c.pj, PT_PJ, 0, sd, k);   // (module constants: PT_CJ [0, 0.15, 0.10], PT_PJ [0, 0.10, -0.05])
        c.dj.rotation.z += (0.35 - c.dj.rotation.z) * k; if (c.djShip !== undefined) c.djShip += (0.35 - c.djShip) * k;
      }
```

  The floor clamp (`clampClaw`) still runs after, so the reach never goes into the sand. The probe's 20° bar judges the aim. If it misses, the correction pass is the lever: a second pass, booked.

- [ ] **Step 4: The lab verb.** In `L.cmd`: `else if (name === 'calm') L.calmNext = true;`. In the ward loop: `if (L.calmNext && !g.lit) lightWard(L, g, ev);`. After the loop: `L.calmNext = false;`. Import `lightWard` from common.js. It runs only when a probe or the lab asks for it.

- [ ] **Step 5: GREEN.**
  - `point` PASS. `PC_RED=nopoint`: exit 5.
  - `programs` (c): PASS.
  - velfix-gate, the `follow` route alone: `DRV_PORT=9543 node tools/bench/velfix-gate.mjs 8886 t10 follow` (the route is its third argument; velfix-gate sets `FP_ROUTE` itself and overwrites the environment's). Its after-the-calm verdict as on the base. A full run is Task 13.

- [ ] **Step 6: Commit**: `velkath buried: the point (she turns to the opening crack and reaches with her great claw through the line, then walks home); lab verb calm`.

---

### Task 11: POINTCAM — the lens follows her point, and any real look drops it

**Files:**
- Modify: `src/game.js` (orchestrator: `POINTCAM`, `pointFrame(dt)`, `window.__pointcam`).
- Modify: `tools/bench/pointcam-probe.mjs` (modes `framing`, `mouse`, `off`).

**Interfaces:**
- Consumes: `lev.pointPh`, `lev.pointK`, `lev.pointAt`, the major claw's `pj` / `dj`; Task 1's lensfix entry.
- Produces: `window.__pointcam = { knobs: POINTCAM, state() → { k, tgt, yaw, pitch, off, why, qPre } }`.

- [ ] **Step 1: The modes and their REDs.**
  - `framing`: as `point` (hose 760; her point runs its whole course wherever he stands), but with **Sal placed for the lens**, the one placement this mode uses:
    - he stands 25 u from her, at the bearing (computed in the probe) that puts the opening at least 60° off the grounded look, facing her;
    - the probe prints θpre, the angle between `qPre`'s forward and the opening, at the calm. Under 60°, the run is UNMEASURED: the RED below would be vacuous. (Placed facing her from her sand side, the opening lay about 12° off the grounded look, already "in frame" with the cue off.)
    
    Booking per frame:
    - θpre (from `qPre`) and θ (from the drawn camera), the angles from the lens's forward to the opening;
    - the opening's NDC computed from both quaternions, printed;
    - the palm's NDC;
    - `__pointcam.state()`;
    - the camera quaternion.
    
    Bars (the cue judged by what it does):
    - over the hold, on ≥ 90% of frames, the cue closes the angle by ≥ 80% of min(θpre, 70°): `θpre − θ ≥ 0.8 × min(θpre, 70°)`;
    - on those frames where θpre ≤ 70°, the opening is in frame (|x|, |y| ≤ 0.85, in front);
    - `k ≥ 0.9` by 1.6 s;
    - `k ≤ 0.1` by 0.6 s after `pointPh` reaches 4;
    - the palm in frame on ≥ 50% of the hold frames **where both fit** (the angle between the palm and the opening ≤ 0.8 × the horizontal FOV); where they do not fit, booked.
  - `mouse`: the same calm, three runs. Dispatch real mouse movement over CDP (`Input.dispatchMouseEvent` with pointer lock emulated as clawcam-probe does), 1.0 s after the calm:
    - (1) a 6° net turn: `k` → 0 on the same frame (`why: 'mouse'`) and it stays off to the lower;
    - (2) a 4° net turn: it stays on;
    - (3) a 10° path that nets 2°: it stays on.
  - `off`: `__pointcam.knobs.on = 0`. The camera quaternion equals `state().qPre` component-for-component on every frame of the calm. Positive control: with `on = 1`, the engaged frames show `q ≠ qPre`.
  - REDs: `PC_ON=0 ... framing` must fail the closing bar (θ stays θpre) → exit 5. Its premise is shown, not assumed: the printed θpre ≥ 60°.

- [ ] **Step 2: Write it** (after `clawFrame(dt)` in `updateCamera`, the lens's last rotation; CLAWCAM never runs after the calm, so the two never overlap):

```js
// ---- THE POINT IN THE LENS (velkath-buried-rock §3; Michael: "can she turn and point to the void with her giant claw"). While she
// points (brooder.js L.pointPh 1-3: the turn, the raise, the hold through the line) the lens EASES ROUND to the opening crack, framing
// her claw where both fit, holds through the light, and hands back as she lowers it. An EVENT: outside it the rotation is exactly 0
// and the lens is the grounded lens bit for bit (qPre). The LAST rotation the lens takes (after clawFrame): yaw about world up, then
// pitch about the lens's own right axis; the boom and the lens position untouched. The mouse owns the view: his look input measured
// from the frame the point opens (CLAWCAM's lookNet / lookPath, Michael 2026-10-13 "ignore small mouse movements") drops it AT ONCE
// past 5 deg net or 15 deg of looking about, for the rest of this calm.
//   maxYaw/maxPitch  deg caps ("where it can": an opening behind the lens is turned toward, not reached)
//   frame            the claw is framed with the opening when they lie within frame x the horizontal FOV of each other
//   wIn/wOut         /s, critically damped (in ~95% by 1.5 s, out ~94% by 0.5 s)
const POINTCAM = { on: 1, maxYaw: 75, maxPitch: 25, frame: 0.8, wIn: 3.2, wOut: 9, lookNet: 5, lookPath: 15, lookTau: 0.3 };
let ptK = 0, ptKV = 0, ptOff = false, ptOpen = false, ptY0 = 0, ptP0 = 0, ptPath = 0, ptRecent = 0, ptYawWas = 0, ptPitchWas = 0, ptWhy = '';
let ptYaw = 0, ptPitch = 0;
const _ptQ = new THREE.Quaternion(), _ptA = V3(), _ptF = V3(), _ptR = V3();
function pointFrame(dt) {
  const L = lev, C = POINTCAM;
  _ptQ.copy(camera.quaternion);
  const dl = Math.abs(player.yaw - ptYawWas) + Math.abs(player.pitch - ptPitchWas);
  ptYawWas = player.yaw; ptPitchWas = player.pitch;
  ptRecent = ptRecent * Math.exp(-Math.min(dt, 0.1) / C.lookTau) + dl;
  const ph = L && L.kind === 'brooder' ? L.pointPh || 0 : 0, win = ph >= 1 && ph <= 3;
  if (!ph) { ptOff = false; ptOpen = false; }
  const d2r = Math.PI / 180;
  if (win) {
    if (!ptOpen) { ptOpen = true; ptY0 = player.yaw; ptP0 = player.pitch; ptPath = 0; if (ptRecent > C.lookNet * d2r) ptOff = true; }
    else ptPath += dl;
    if (Math.abs(player.yaw - ptY0) + Math.abs(player.pitch - ptP0) > C.lookNet * d2r || ptPath > C.lookPath * d2r) { ptOff = true; ptK = 0; ptKV = 0; }
  }
  let tgt = 0, why = '';
  if (!C.on) why = 'off'; else if (!win) why = ph ? 'lower' : 'none'; else if (ptOff) why = 'mouse';
  else if (paused || deckK > 0 || throatOn) why = 'place';
  else { tgt = 1; why = 'on'; }
  // critically damped, exact step (clawFrame's)
  const w = tgt > ptK ? C.wIn : C.wOut, h = Math.min(dt, 0.05);
  if (h > 0 && (tgt > 0 || ptK > 0 || ptKV !== 0)) { const ex = Math.exp(-w * h), e0 = ptK - tgt, k = ptKV + w * e0; ptK = tgt + (e0 + k * h) * ex; ptKV = (ptKV - w * k * h) * ex; }
  if (ptK < 0) { ptK = 0; if (ptKV < 0) ptKV = 0; }
  if (tgt === 0 && ptK < 1e-4 && Math.abs(ptKV) < 1e-3) { ptK = 0; ptKV = 0; }
  ptWhy = why;
  if (!(ptK > 0)) return;                                         // (off: no rotation call at all)
  // the aim: the opening, or its midpoint with her palm when both fit
  _ptA.copy(L.pointAt);
  const c = L.claws && (L.claws[1].major ? L.claws[1] : L.claws[0]);
  if (c) {
    _ptF.setFromMatrixPosition(c.pj.matrixWorld); _ptR.setFromMatrixPosition(c.dj.matrixWorld); _ptF.add(_ptR).multiplyScalar(0.5);
    const hf = 2 * Math.atan(Math.tan(camera.fov * d2r / 2) * camera.aspect);
    _ptR.copy(_ptF).sub(camera.position).normalize(); _bp.copy(_ptA).sub(camera.position).normalize();
    if (Math.acos(clamp(_ptR.dot(_bp), -1, 1)) <= C.frame * hf) _ptA.add(_ptF).multiplyScalar(0.5);
  }
  _ptF.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _ptR.copy(_ptA).sub(camera.position);
  let dy = Math.atan2(_ptR.x, _ptR.z) - Math.atan2(_ptF.x, _ptF.z); dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const dp = Math.atan2(_ptR.y, Math.hypot(_ptR.x, _ptR.z)) - Math.asin(clamp(_ptF.y, -1, 1));
  ptYaw = clamp(dy, -C.maxYaw * d2r, C.maxYaw * d2r) * ptK; ptPitch = clamp(dp, -C.maxPitch * d2r, C.maxPitch * d2r) * ptK;
  camera.rotateOnWorldAxis(camUpAxis, ptYaw);
  camera.rotateX(ptPitch);
}
window.__pointcam = { knobs: POINTCAM, state: () => ({ k: +ptK.toFixed(4), yawDeg: +(ptYaw * 57.29578).toFixed(2), pitchDeg: +(ptPitch * 57.29578).toFixed(2), off: ptOff, why: ptWhy, qPre: _ptQ.clone() }) };
```

  Call `pointFrame(dt)` right after `clawFrame(dt)`. Before writing, check against Task 1's lensfix entry that:
  - `clawFrame` is still the last rotation;
  - `_bp`, `camUpAxis` and `deckK` / `throatOn` / `paused` exist under those names.

- [ ] **Step 3: The spec's "It also pulls the lens out of her shell at the calm instant".**
  - A rotation cannot move the lens. Pulling the lens out of her is the position guard's job: CRECAM's `bodyBlocked` pull plus lensfix's fallback.
  - So this task does not build that, and the requirement is gated where it is measured: velfix-gate's after-the-calm `lensSurf` / `salIn` = 0 (Task 13) on the branch, with the point's delay to the walk home included.
  - Write this in the comment and in the report.

- [ ] **Step 4: GREEN.**
  - `framing`, `mouse`, `off`: PASS.
  - `PC_ON=0 framing`: exit 5.
  - `clawcam-probe framing` (`CC_ON=1`) and `CC_ON=0` (RED) as on the base.
  - Invariants.

- [ ] **Step 5: Commit**: `POINTCAM: the lens follows her point to the opening crack (the last rotation; any real look drops it; off = the grounded lens bit for bit)`.

---

### Task 12: Digging back in — and coming back mid-way

**Files:**
- Modify:
  - `src/entities/sleeper/brooder.js` (the dig-in under the calmed branch; `beginDig`);
  - `src/entities/sleeper/burial.js` (`BURY.digT`, `pause`, the haze);
  - `tools/bench/burial-probe.mjs` (modes `digin`, `reentry`).

**Interfaces:**
- Consumes: Tasks 2–10.
- Produces: `L.digging`, `L.dugIn`, `L.digOff` (s clear of her), `BURY.digT`, `BURY.pause`.

- [ ] **Step 1: The modes and their REDs.**
  - `digin`:
    - calm her (`cmd('calm')`), step through the point and the walk home;
    - when she has settled (`stand` 0, the heave landed), stand him 35 u off;
    - step until `bury ≥ 1` or 40 s, booking `bury` per frame.
    
    Bars:
    - from the first frame `bury` rises to `bury ≥ 1`: 15–20 s;
    - at the end: `disguise` (all checks except the harpoon pole, which is gone, and with `seam` replaced by the scar's centre ≥ +0.2 u over the sand) PASS on the new pose;
    - every ward's `light.intensity` 0 and its burn glow's opacity 0;
    - dug in, she breathes again (`breath` mode's amplitude bar, 6 u off: `breathTick` runs while `L.dugIn`).
    
    Second run, `pause` (Review Focus 3):
    - at `bury ≈ 0.4` walk him onto her ground (onto the dune) for 3 s, then off;
    - `bury` constant (|Δ| ≤ 1e-9) every frame he is on her ground;
    - it resumes ≤ `SETTLE.hold` + 1 frame after he leaves;
    - his OWN boot gap never under −0.15 over the drawn sand;
    - the lens never under the drawn surface + 0.3.
    
    Third run, `afloat`: the same with him hovering 1.5 u over the dune. It must pause all the same, and nothing presses him down onto it: `BODY.calmOut` 0 on every frame over the dune (Task 3b's CALMCOL skip; held 2 s), his height over the drawn dune never dropping by more than his own settle (`A_SETTLE`) would. `onHerDune` (Step 2) is plan-based up to a ceiling 6 u over the drawn ground. The shipped `onHerGround` would NOT see him: its `pos.y > bodyY + 0.15 R` cutoff rides her body, which sinks about 4 u under him as she digs in.
  - `reentry` (Review Focus 1). Leave zone 0 with `gotoZone(1)`, then return with `gotoZone(0)`:
    - (i) mid-rise (`u ≈ 0.3`);
    - (ii) mid-point (`pointPh` 2);
    - (iii) mid-dig-in (`bury ≈ 0.5`).
    
    After each return:
    - `lev.dormant`, `bury` 1;
    - `disguise` PASS;
    - `__pointcam.state().k` 0;
    - `extraFloorAt` over her dune equals `__burial.sandAt` (the live sleeper's);
    - the clutch hidden;
    - `__shaderFailed()` [].
  - REDs:
    - `BP_RED=fastdig` (`{digT: 8}`) fails the duration;
    - `BP_RED=nopause` (`{pause: 0}`) fails the pause bar.
  - On the Task 11 head `digin` fails (she never digs in). Record it.

- [ ] **Step 2: The rule.**

```js
// DIGGING BACK IN (spec §3): once he is off her ground (today's settle rule's margin and hold: SETTLE.release, SETTLE.hold s; tested
// by onHerDune, below, because onHerGround's height cutoff sinks with her),
// bury runs 0 -> 1 over digT s: she sinks, the sand slides back up her flanks, the crust fades back in, a low haze of silt drifts
// off (render only: calmed, she is blinded by nothing). He comes back onto her ground: it pauses; it resumes when he has been off
// SETTLE.hold s again. At its start the mound is fitted to where she actually lay down (her walk home stops within 3 u and 0.12 rad
// of her bed): the sink is re-measured there, the dune re-fitted over the sunk pose. When it ends she is the outcrop again, the
// harpoon's scar in the rock, her burning wards embers under the sand.
//   digT s (spec 15-20); pause 1 (0: the RED); haze s between haze puffs
Object.assign(BURY, { digT: 17.5, pause: 1, haze: 0.8 });
```

  The pause's test (brooder.js; `shellPlanNear` from bodyCols.js, `extraFloorAt` from terrain.js):

```js
// (velkath-buried-rock) THE DIG-IN'S "ON HER GROUND": her shell's plan + m, by plan alone, up to a ceiling over the drawn ground (a
// swimmer far overhead does not freeze it). Not onHerGround: its height cutoff (pos.y > bodyY + 0.15 R) rides her body, and digging
// in she sinks ~4 u under him, so a man on the rising dune, or beside it afloat, would read as off her ground mid-dig.
function onHerDune(L, player, m) {
  if (!player) return false;
  const g = Math.max(terrainH(player.pos.x, player.pos.z, L.idx), extraFloorAt(player.pos.x, player.pos.z, L.idx));
  if (player.pos.y - 1.35 > g + 6) return false;
  return shellPlanNear(player.pos.x, player.pos.y - 0.45, player.pos.z, m);
}
```

  In `updateBrooder`, after the calmed branch's `homeTurn` / settle logic, when `L.buried && L.calmed && !L.pointPh && !L.homeTurn && !L.walkTo && L.standTarget === 0 && L.stand <= 0.001 && L.heave.x < 0.02`:

```js
    const near = BURY.pause > 0 && onHerDune(L, player, SETTLE.release);
    L.digOff = near ? 0 : (L.digOff || 0) + dt;
    if (!L.dugIn && !L.digging && L.digOff > SETTLE.hold) { L.digging = true; beginDig(L); }
    if (L.digging && (!near && L.digOff > SETTLE.hold || BURY.pause <= 0)) {
      L.bury = Math.min(1, L.bury + dt / BURY.digT); L.moundK = L.bury;
      if ((L.hazeT = (L.hazeT || 0) - dt) <= 0) { L.hazeT = BURY.haze; const j = (Math.random() * L.mound.COLS) | 0, o = (5 * L.mound.COLS + j) * 3; spawnWake(L.mound.P[o], L.mound.P[o + 1], L.mound.P[o + 2], 0.4, L.idx); }
      if (L.bury >= 1) { L.digging = false; L.dugIn = true; }
    }
```

  `beginDig`:

```js
// the dig-in's start: the sink re-measured and the dune re-fitted where she actually lay down (one event: two poses and a fit)
function beginDig(L) {
  L.bury = 0; poseAll(L, 0, null);
  L.buryD = fitSink(L, L.crest);
  L.bury = 1; poseAll(L, 0, null);
  fitMound(L, L.mound, (x, z, out) => seabedColor(terrainMeshes[L.idx], x, z, out, L.idx), fissureDist);
  prepGrowth(L, L.mound);                               // (the growth on her back, re-sorted for the strip where she lies now)
  L.bury = 0; L.moundK = 0; setMoundK(L.mound, 0, 0); poseAll(L, 0, null);
}
```

  Book its cost in ms in the report: it is a one-frame cost, never per frame.

  `L.dugIn` lets `publishCols` publish the crest as ground again (Task 3b's `L.dormant || L.dugIn`).

- [ ] **Step 3: GREEN.**
  - `digin` (all three runs) PASS. `fastdig` and `nopause`: exit 5.
  - `reentry`: PASS.
  - `programs` (d): PASS.
  - Invariants.

- [ ] **Step 4: Commit**: `velkath buried: she digs back in (17.5 s off her ground, pauses while he is on it); re-entry rebuilds her buried`.

---

### Task 13: The existing probes and the invariants on the whole feature

**Files:** probe bounds only if one moved (each with its RED and the requirement it derives from); otherwise read-only. An Opus implementer: this task is open debugging.

- [ ] **Step 1: The sweep**, alone on the machine (Review Focus 5 included):
  - `relief-load all`. Plus `voyage`'s added checks, on a voyage that starts at home with her buried and dormant:
    - at Pallid, `extraFloorAt` −1e9 on a 2 u grid ±40 u round home's bed position (89.7, 39.1) and round Pallid's bed;
    - Pallid's octopus dens (`window.pred.octos[i].den`, laid by predators.js `reseedDens` on `shutFloorY + 0.2` during the reseed, before her old build is disposed) each within 0.05 u of Pallid's `terrainH + 0.2` (jam aside): none sits on home's dune. RED: run the same voyage with bodyCols' site key removed (a scratch edit, not committed) and confirm a den inside home's dune footprint, if any falls there, reads high. If no den falls inside the footprint on this seed, book it: the RED is then the `extraFloorAt` grid read DURING the reseed (a `reseedDens` wrapper in the probe's page code reading `extraFloorAt` at home's bed), which must be −1e9;
    - Pallid's row-built fingerprint 014f3101;
    - home again buried with the LIVE anchor.
  - `seating-probe` at Pallid after that voyage from home, and at home again.
  - `harpoon-probe` all modes.
  - `fissure-probe velkath-crack clearance ending` (and `opening calm-open open-persist`: the calm and the crack opening with the point running).
  - `brooder-invariants`.
  - `seating-probe`.
  - `blade-invariants`.
  - `clawcam-probe framing`.
  - `node tools/relief/validate.mjs`, `gates.mjs`.
  - `hitch.mjs`, as Task 5 Step 5 runs it: `BENCH_DBG_PORT=9543 node tools/bench/cdp.mjs start 8886`, `BENCH_DBG_PORT=9543 SCEN=jet,z1,z2,voyage node tools/bench/hitch.mjs`, `BENCH_DBG_PORT=9543 node tools/bench/cdp.mjs stop`.
  - `DRV_PORT=9540 node tools/bench/relief-walk.mjs mound 8886` (all three lines, (c) from the real anchor) and `relief-walk boots` / `lens` at their shipped lines.
  
  A failure is a regression: find it. Never re-bar it. Exception: a bound that was derived from the shipped ridge and that the burial changes by design (for example a dormant-pose reading). That bound is re-derived from its requirement with a RED and a ruling.

- [ ] **Step 2: The after-the-calm lens (the Footing gate).** velfix-gate, 3 runs alone + 1 under load, clock plugged: `DRV_PORT=9543 node tools/bench/velfix-gate.mjs 8886 t13-<n>`, and under load with the branch also served on 8888: `VG_LOAD=8888:9542 DRV_PORT=9543 node tools/bench/velfix-gate.mjs 8886 t13-load`.
  - Bar: `lensSurf + lensEggs`, `salIn` and `lens.salCalm` = 0 on every run, as lensfix's acceptance.
  - The FLASH and CLEAN classes are reported against the base's numbers (Task 1's lensfix entry), per class, per run.
  - The dune is in `L.grp`, so the drawn verdict's raycast sees it. Confirm that from the verdict's mesh list.

- [ ] **Step 3: Commit** any probe change, with the sweep's table in the body.

---

### Task 14: Fight parity — the paired 48-fight campaign

**Files:**
- Modify (committed): `tools/bench/ritepolicy.mjs` and `tools/bench/riteplay.mjs`, his height over the ground (Step 1).
- Copy `~/sc/.abyssa-wt/reviews/t8b-scripts/phaseB/campaignB.sh` and `statsB.mjs` to `~/sc/.abyssa-wt/reviews/buried/campaign/`, with the branch on 8886 / 9540 and the main copy on 8887 / 9541. Both arms run the branch's tools (the same files, so a tool change is the same in both).
- Read `~/sc/.abyssa-wt/reviews/t8-scripts/stats2.mjs` for the test code.

**Pre-registered, now, before any fight** (relief Rulings 37, 39, 40 restated; nothing here is new):
- Home, `maxSec` 240, `RP_RENDER` identical in both arms. Every fight PAIRED: both builds at once, same mode and seed. Seeds 1–12 × perfect / average: n = 12 per build per mode, 48 fights. The clock plugged (riteplay's), drift booked.
- `RP_WARD_BAR` = the base main's highest over its own 24 fights + 0.5. It is read after the campaign from main's ledgers and applied to the branch's: (d) as built.
- **(a)** per fight, both builds, hard: calmed within 240 s, no death, no console error but the favicon 404. A branch fight failing it FAILS. A main fight failing it is reported as main's.
- **(b)** time, per mode: FAIL only if the branch/main median ratio lies outside [0.8, 1.25] **and** a two-sided Mann-Whitney U gives p < 0.10.
- **(c)** the average band, relative. **Judged on its first half only:**
  - GATED: the branch's share of average fights inside 45–165 s with ≤ 3 hits ≥ main's share − 1/12;
  - BOOKED, NOT GATED: the branch's median average time, against the 45–165 s band, reported with both builds' medians.
  - Why, fixed here before any fight (the orchestrator's ruling, 2026-10-15): main IS the relief build now. Its average median was 40.4 s in Phase B, outside the band, and Michael accepted that gap ("A is good", 2026-10-14). A build equal to main cannot meet the second half, so gating it would gate the accepted gap, not the burial.
- **(d)** ward column: the branch's max ≤ main's max over all its fights + 0.5. Per-fight medians of the maxima reported.
- **(f)** her hunting stance: per fight the median of her highest ward over the ground on frames `!L.drop && L.standE > 0.9` (`wardHuntP50`), per build the median over its 24 fights. The branch within ±0.5 u of main's. A fight is tainted when `wardUpBad > 0`; null per-fight values are dropped.
- **(e)** booked for Michael, never gated: every hit's source (drop slam / sweep / claw / other) and phase per build per mode; the heave hits; who was hit at least once.
- A lost pair (a non-zero exit, no LEDGER line or no ledger JSON in either arm, or a LOST clock) is re-run as a pair. No pilot fights, no per-seed criteria (Ruling 37).
- **Stop rules:**
  - (a) or (b) failing on the branch: the campaign closes as data, and the controller rules. The opening's geometry (the crest seat, the shove) is the suspect, and moving it is Michael's call (relief Ruling 41's STOP case).
  - (c)'s first half, (d) or (f) failing: report as registered, no waiver, to Michael.

- [ ] **Step 1: The policies read the ground he stands on.** ritepolicy.mjs (`STATE`'s and `PROBE`'s `fl = terrainH(P.pos.x, P.pos.z, 0)`) and riteplay.mjs (the hit log's `agl`) take his height over the ground off `terrainH`. At the opening he stands on the dune or the crest, which reads 1–3 u "up", and the perfect policy's `duck` branch (`s.agl > 2.0` near her rim: it vents) would act on that: the opening would move because of the tool, not the game.
  - First list every branch that reads `agl` or `fl` (`grep -n "agl\|\bfl\b" tools/bench/ritepolicy.mjs tools/bench/riteplay.mjs`), in the ledger.
  - Then make each `fl` read `Math.max(terrainH(x, z, 0), window.__xf ? window.__xf(x, z, 0) : -1e9)`, with `window.__xf = T.extraFloorAt || null` set once in the page's setup (terrain.js). On main `extraFloorAt` does not exist, so main's arm reads exactly what it did; both arms run the same file.
  - Commit the tool change before any fight, with the list in its body.
- [ ] **Step 2:** Estimate the wall time from Phase B's logs (24 pairs ran 25 min 31 s). Book it in the ledger with the scripts' blob hashes.
- [ ] **Step 3:** Run the campaign. Book the run table (per seed, both builds: s, hits, calmed, ward max, `wardHuntP50`, drift) and the verdicts (a), (b), (c) first half, (d), (f), with (c)'s second half and (e) booked.
- [ ] **Step 4:** Add booked columns per fight (not gated): where Alt+6 stood him in her frame at E; his positions over the first 10 s after E, per arm; her blind spell at the start (from the ledger's sight series if riteplay books it; else stated as not booked). These explain an opening that moved.
- [ ] **Step 5:** Write the table and verdicts into `~/sc/.abyssa-wt/reviews/buried/campaign/RESULT.md`. Nothing else is committed in the repo for this task. The record (Task 17) carries the table.

---

### Task 15: Cost — cross-load ABBA at `z0b` and up close

- [ ] **Step 1:** Make sure the machine is quiet: no other Chrome stepping, no simulators. Check with `cal` / `gcal` from `__bench.run`; a flagged cycle is re-run.
- [ ] **Step 2:** Run the cross-load ABBA (CLAUDE.md "Perf harness"): branch 8886 and main 8887. `BENCH_DBG_PORT=9543 node tools/bench/cdp.mjs start 8886`, then `BENCH_DBG_PORT=9543 node tools/bench/cdp.mjs goto http://localhost:8887/?bench` and back, A B B A, with `setup('z0b')` + `live(4000)` in each (`cdp.mjs eval`); `BENCH_DBG_PORT=9543 node tools/bench/cdp.mjs stop` at the end.
  - At least 4 cycles; also `z0` and `z1` as controls.
  - `z0b` stands 30 u from her bed. On the branch it frames the buried outcrop; on main, the ridge. At 30 u the breath is not drawn (it is drawn within `draw` + `crestL`/2 = 22 u of the strip's centre).
  - **A near view**, so the breath's per-frame rewrite (2,048 positions and normals, both attributes uploaded on every frame it moves) is in the reading: after `setup('z0b')`, `__bench.place` Sal 8 u off the strip's edge on her sand side, facing it, then 120 settled frames before `live`. On main the same spot (8 u off her ridge). Run it as a fourth view in the same ABBA.
- [ ] **Step 3:** Bar: the mean delta ≤ +0.3 ms per frame at `z0b` **and** at the near view, each reported against the cycle spread and the `z1` control (like for like: must be within its noise).
  - Over the bar: profile with `run({ prof: true })` and `draws()`. Candidates: her shell's crust fetches, the dune's draw and its breath rewrite, the slabs' hidden mesh, `plumeTau`'s 24 records.
  - Fix it inside this plan, or stop for a ruling. Never re-bar.
- [ ] **Step 4:** Book the table in the ledger. Nothing is committed unless a fix was needed (then commit with the ABBA in the body).

---

### Task 16: The look, for Michael

**Outputs:** `~/sc/.abyssa-wt/shots/buried/look/` and `~/sc/.abyssa-wt/video/buried-full.mp4`.

- [ ] **Step 1: Stills,** settled (`capture({ settle: 90 })`), day, no storm, in his light, at the follow lens. Each one on main too where it exists, side by side:
  - (1) asleep from 10 u;
  - (2) asleep from 20 u;
  - (3) mid-rise in the plume (2.5 s and 4.0 s after the wake);
  - (4) the point with the light (the line on screen);
  - (5) buried again after the dig-in, the scar in the rock;
  - (6) at night, asleep from 10 u, his lantern the only light.
- [ ] **Step 2: The full take.**
  - Run `FP_HOSE=760 RP_VIDEO=<dir> DRV_PORT=9544 node tools/bench/fullplay.mjs 8886 average buried-full 1`, from the raft to zone 1. It passes the outcrop, pulls, fights, the point, and goes down the crack. (Without `FP_HOSE` a fresh diver's 380 of line cannot descend, and the calm says the line is short instead of "A RIFT OPENS BELOW.".) Plugged clock: exit 4 means LOST, re-run.
  - Encode with `~/sc/.abyssa-wt/encode2.mjs`: serve `~/sc/.abyssa-wt/video` on 8793, `DRV_PORT=9544 node encode2.mjs <frames> <n> <out.mp4> "<label>"`.
  - Then `avconvert --source in.mp4 --output out.mp4 --preset PresetHighestQuality --replace`.
  - Read the duration back with AVFoundation, not `mdls`. It must equal the game time ± one frame.
  - A second take with the dig-in. fullplay.mjs has no routes, so this one is fullplay-gate.mjs (which has `RP_VIDEO` and `FP_ROUTE`): `FP_HOSE=760 FP_ROUTE=follow FP_UNTIL='window.lev && window.lev.dugIn' RP_VIDEO=<dir> DRV_PORT=9545 node tools/bench/fullplay-gate.mjs 8886 average buried-dig 1`.
    - Add `FP_UNTIL=<js>` to fullplay-gate.mjs (committed with this task): once its route's own steps are done, keep stepping the route's last action (he stands off her ground) until the expression is true, capped at 60 s more, booked. Without it the follow route's 40 s ends before the point (about 8 s), the walk home and the 17.5 s dig-in are through.
    - Encode it as the first.
- [ ] **Step 3:** The controller sends Michael the stills and the videos. His looks and feels, nothing he has already ruled:
  - the disguise in motion, the plume, the shove, the point, the dig-in;
  - the breath: can it be seen at all (his ruling: judged here, knob `BURY.breath.lift`);
  - RIDGE_LINE ("THE RIDGE IS WARM UNDER YOUR HAND."): keep it on the rock, or does it give her away;
  - for his information: her walk home starts about 8 s later because of the point; the camera fix (lensfix), not POINTCAM, keeps the lens out of her shell after the calm (a rotation cannot move the lens).

---

### Task 17: The record

**Files:** `CLAUDE.md`, `roadmap/velkath-buried-rock.md`, `docs/reports/2026-10-15-velkath-buried-rock.md` (new).

- [ ] **Step 1: CLAUDE.md.**
  - In the brooder bullet, a "VELKATH BURIED" paragraph:
    - home only, its row key;
    - `L.bury` and the sink;
    - the mound (burial.js) and its footing hook (bodyCols `buriedFloorAt` → terrain.js `extraFloorAt`: player.js, diver.js, `shutFloorY`);
    - the crust (one program, every site);
    - the rise's beats and the `rise` plume;
    - the rising guard (contact, hammer and drop held until she stands);
    - the point and POINTCAM;
    - the dig-in;
    - `__burial`, `__pointcam`, the probes (`burial-probe` modes, `relief-walk mound`, `pointcam-probe`).
  - INVARIANTS:
    - `sleeperFingerprint(0)` still 1ca3b28c (no row);
    - the row-built home value and the LIVE anchor with their cause.
  - The camera bullet: POINTCAM beside CLAWCAM.
- [ ] **Step 2: The report.**
  - Every gate's table with its RED.
  - The tuning logs (the crust, the plume).
  - Michael's words: his 2026-10-15 rulings, the disguise checkpoint, the look.
  - The campaign.
  - The cost.
  - Review Focus 1–5 results.
  - The open readings.
  - Every ruling restated (the ledger is git-ignored).
- [ ] **Step 3: The card.**
  - Log the build with the commits.
  - Leave `status` to the orchestrator.
  - Run `python3 /Users/michaelpaulus/.claude/mods/roadmap/bin/gen.py roadmap`. The orchestrator publishes.
- [ ] **Step 4: Commit**: `docs: velkath buried in CLAUDE.md, the report, the card`.
