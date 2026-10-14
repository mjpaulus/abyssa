---
title: The bench clock leaks wall time into the stepped game
status: backlog
tags: bench, tooling, game.js, probes
updated: 2026-10-14
---
Every probe that steps the game with `__bench.step` runs a game clock that also gains wall time. The recorded game ran 1.5–2.1× fast: currents, weather, slam gaps and timers all raced. Three tools plug it on their side. The root fix is one line in game.js, but every probe's baseline then has to be re-derived.

## Detail
- **Found by:** relief Task 9 (Ruling 42).
  - game.js's bench hook `hold(on)` calls `clock.getDelta()` on release. In three r184, `Clock.getDelta()` ADDS the wall time since its last call to `elapsedTime`.
  - So each `__bench.step` pushes `t` on by its own wall time plus the CDP round trip.
  - Measured: `t` runs 1.50–1.62× the stepped time alone, and 1.70–2.1× under load.
- **What `t` feeds:**
  - the current field (player.js `sampleCurrent`);
  - the surface swell;
  - the hose current;
  - the tear gate `SLAM_GAP`;
  - the weather;
  - the lantern flicker;
  - the blade repeat;
  - the throat lens's relative-motion window;
  - the ocean.
- **Plugged tool-side** in `fullplay-gate.mjs`, `fullplay.mjs` and `riteplay.mjs`:
  - `clock.stop()` once the live loop is held;
  - a stepped-frame count;
  - drift gated, so a drift over 0.05 s exits 4 as LOST.
- **The root fix** (keep the reset, drop the add):
  - `const e = clock.elapsedTime; clock.getDelta(); clock.elapsedTime = e;` in the hook.
- **Hazard:** every other `__bench.step` probe has a baseline derived under the leak, so each needs re-deriving on the fixed clock. That includes fissure-probe, harpoon-probe, clawcam-probe, blade-*, play.mjs, ritefair-*, velfix-look and walls-inside.page.js. So do this deliberately, as its own task.
- **Acceptance:**
  - the hook no longer adds wall time, with a drift probe showing 0 for every stepped tool;
  - each probe re-run and its bars re-derived or confirmed, in one recorded pass.

## Log
- 2026-10-14 — created from the relief branch (Task 9, Ruling 42); the root fix deferred so the branch's probe baselines stay symmetric with main's.
