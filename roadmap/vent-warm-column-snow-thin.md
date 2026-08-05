---
title: Thin Marine Snow In Vent Warm Columns
status: backlog
tags: water, vents, marine-snow
updated: 2026-08-05
---
Marine snow should thin out inside the hydrothermal vents' warm water columns, since rising heated water would carry fewer sinking particles through those columns than the surrounding cold water.

## Detail
Currently the marine snow layers are built without regard to vent shimmer columns, so snow density looks uniform whether or not a column of warm water is passing through it.

- Marine snow layers: `src/world/water.js` — the `snowLayers` uniform holders and the snow build inside `buildWater` (the `snow` group); per-layer density already driven by `uDepth` writes in `updateWater` via `murkFrac`.
- Vent shimmer columns: `src/world/vents.js` `buildShimmer` — the hot-vent positions live in `hotVents`.
- Likely approach: sample each vent's shimmer column position/radius when generating or updating snow particles, and reduce local snow density/opacity within that radius (falloff toward the column's edge, not a hard cutoff).
- Acceptance criteria: marine snow visibly and smoothly thins inside each vent's warm water column compared to ambient water; no regression to snow density/behavior outside vent fields; no new perf hit large enough to disqualify (spot-check frame time near a vent field).

## Log
- 2026-08-05 — created
