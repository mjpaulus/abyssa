---
title: Procedural gardens (plant vocabulary)
status: wip
tags: flora, geometry, quality
updated: 2026-09-04
---
Michael: 'we need more procedural plants.' Flora has kelp, reef communities, brain coral, rocks — thin for an NMS-bar reef.

## Detail
New src/world/gardens.js: sea fans, seagrass beds, staghorn, barrel sponges, anemones (zone 0); tube-worm colonies with retracting plumes at chimney feet, bacterial mats, crinoids (zone 1); sea pens with dim bioluminescent tips, glass sponges, whip corals (zone 2). Instanced, vertex-shader sway on the current, zone-gated, own siteParams('gardens') stream so flora/rock layouts stay bit-identical, ≤12 draw calls. Reseed step after reseedFlora — ORDER IS CONTRACT.
