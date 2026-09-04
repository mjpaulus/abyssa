---
title: Procedural gardens (plant vocabulary)
status: wip
tags: flora, geometry, quality
updated: 2026-09-04
---
Michael: 'we need more procedural plants.' Flora has kelp, reef communities, brain coral, rocks — thin for an NMS-bar reef.

## Detail
New src/world/gardens.js: sea fans, seagrass beds, staghorn, barrel sponges, anemones (zone 0); tube-worm colonies with retracting plumes at chimney feet, bacterial mats, crinoids (zone 1); sea pens with dim bioluminescent tips, glass sponges, whip corals (zone 2). Instanced, vertex-shader sway on the current, zone-gated, own siteParams('gardens') stream so flora/rock layouts stay bit-identical, ≤12 draw calls. Reseed step after reseedFlora — ORDER IS CONTRACT.

## Log
2026-09-04: Shipped, merged d9c379a. 12 types, 12 draw calls, ~143k submitted tris at the reef; flora/rock fingerprints proven identical wired vs unwired; layout deterministic across voyages. Reseed sits after reseedVentLife (needs activeVents), still after flora. TASTE: colours pulled toward brass after a first pass read as candy — judge against the reference. TODO: authored gardens seeds in site.js (currently a per-site fallback stream). Awaiting Michael's eye.
