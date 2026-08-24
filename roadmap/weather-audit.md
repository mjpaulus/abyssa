---
title: Weather audit round (threejs-skills)
status: done
tags: bug, perf, weather
updated: 2026-08-23
---
Audited the whole weather/sky/water stack against the in-repo threejs-skills packs, then fixed everything real. Merged `7519bf5`.

## Detail
Audit verdict: the system already beats the packs' bar on allocation, uniforms, instancing, sorting, shadow scoping. Four defects + cheap wins found and shipped:
- **Sea-surface lightning was dead** — game.js passed only 2 args to setWeatherWater, so uFlash stayed 0 forever and the derived day value used a stale surfK inversion (skewed moon/ember/fog gates in mid-day gales). Now passes day + flash explicitly.
- **Three billboards drew twice** (r163+ transparent DoubleSide = per-face passes): puff clouds (480 quads doubled), storm rain plane, god-ray billboards — `forceSinglePass: true` on each (ocean surface untouched, genuinely two-sided).
- **sun.castShadow hysteresis** — was a raw per-frame boolean; each flip = full-scene shader program switch. Now flips only after the condition holds >1s.
- **Fog fast path** — heavy fog now crushes uCloudCov under the shader gate, skipping the dome's fbm cloud block on pea-soup mornings; clear days bit-identical (ramp starts at fog 0.60).
- **De-latticed storm splashes** — rainCells ported splash()'s jitter/dead-cells/per-cell-beat, cost-identical.
- **Sky probe for the raft (M3)** — 64px CubeCamera renders the dome alone, PMREM'd, refreshed only on palette drift (>0.03, ≥2.5s). Scoped to raft materials via envMap swap, NOT scene.environment — deep zones structurally cannot show sky glints. Brass-age intensity kept.
- Rain-plane `discard` → output-zero (early-z kept). PCFSoftShadowMap radius skipped: renderer deliberately on PCFShadowMap (r182 deprecation), radius is ignored there.

Verified in-pane: flash reaches the sea (held `weather.flash(0.9,5)` in a night gale lifts the sea band silver), clear day unchanged, fog morning crushes coverage 0.70→0.07 cleanly, deck brass shows subtle sky response at noon/dusk, −500 m shows zero glints.
