---
title: three.js upgrade (r160 → current)
status: backlog
tags: infra, risk
updated: 2026-08-06
---
We ship on r160 (Dec 2023); three.js is at r184+ with production WebGPU since r171 and a node-based post pipeline since r183. An upgrade is its own careful round, not a version bump.

## Detail
Why it's risky here: the per-channel Beer-Lambert fog is patched into `THREE.ShaderChunk` globally (`world/water.js`), and most materials do `onBeforeCompile` surgery keyed to r160's exact chunk names — routine upstream chunk renames break the game's look silently. The CDN `postprocessing` + `n8ao` libs must stay compatible with the chosen core.
Approach when taken: bump one importmap entry on a branch, run the existing anchors (terrain fingerprints, calm-noon ambient probe, program-count soak, refraction A/B via P key), grep three's migration guide r160→target for every chunk name we patch.
WebGPU is a separate decision from the version bump — do not conflate.
- Acceptance: game visually identical on the new core (anchors green), or a written list of what changed and Michael's sign-off on each.

## Log
- 2026-08-06 — captured from Michael's note that a new version exists; parked while SKY & WIND is in flight
