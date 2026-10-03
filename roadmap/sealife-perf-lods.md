---
title: Sea life detail levels and cost
status: wip
tags: perf, creatures, flora
updated: 2026-10-03
---
The new sculpted sea life is heavier in a few spots: the vent shrimp swarm, the sea stars and the zone-0 reef. Give them proper distance versions so the rebuild costs no more than the old procedural life.

## Detail
- Vent shrimp: about +326k triangles near vents, no distance version (`ventlife.js`, `ventSculpt.js`).
- Sea stars: all 40 always draw the full sculpt (`starSculpt.js`).
- Zone-0 reef: about +1 ms over procedural (plantKit LOD and impostor distances).
- Kelp pops out at 130 u instead of fading (`GD_NODITHER`); find a fade that keeps early-Z.
- Acceptance: paired `__gpu` A/B at parity or better in zone 0 reef, zone 1 vents and zone 2; no visible popping at detail-level switches.

## Log
- 2026-10-03 — created from the open items on sea-life-sculpted; work started.
