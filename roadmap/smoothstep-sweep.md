---
title: Reversed-smoothstep sweep
status: next
tags: bug, shaders
updated: 2026-08-08
---
A reversed-edge smoothstep is undefined GLSL and returns 0 on this driver — it silently killed the entire Jacobian foam for a whole round. Twelve more suspect call sites remain across the codebase.

## Detail
The landmine (found during the opaque-storm round, fixed in water.js waveField with the defined-everywhere form `1.0 - smoothstep(lo, hi, x)`): GLSL smoothstep(edge0, edge1, x) with edge0 >= edge1 is UB; this driver returns exactly 0, no warning, so any term multiplied by it vanishes.
Flagged, unfixed: `water.js` god-ray billboard fade (~line 1079) and marine-snow fade (~line 1157) — both currently ×0 on this driver, meaning those fades never applied here. Elsewhere: `creatures.js` ×4, `predators.js` ×3, `flora.js` ×1 — GLSL, same risk; `weather.js` ×2 are THREE.MathUtils (CPU, x-first signature — verify they're actually correct, not reversed).
Approach: grep every smoothstep, classify GLSL vs CPU, fix GLSL reversed forms with the 1-minus pattern, then LOOK at each affected visual (god rays, snow, creature fades, predator fades, flora) — fixing these will CHANGE the look where the broken form was load-bearing-by-accident. A/B screenshot each before/after; anything that reads worse fixed-than-broken is a Michael call.
- Acceptance: zero reversed-edge GLSL smoothstep calls in src/; every visual change from the fixes screenshotted and either kept or re-tuned.

## Log
- 2026-08-08 — cut from the opaque-storm agent's discovery
