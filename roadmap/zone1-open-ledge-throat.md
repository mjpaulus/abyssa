---
title: Zone-1 ledge walks him into the open throat (fissure-probe open-ledge)
status: backlog
tags: zone 1, fissure, bugs
updated: 2026-10-13
---
On a fresh load, fissure-probe's zone-1 open-ledge case walks Sal off a ledge into the open throat. It counts 8.3 u and 130 frames in the throat. Main's full run passes only because zone 0's case leaves gait state behind.

## Detail
- Found by the sea-floor relief's Task 6 (the relief branch's `.superpowers/sdd/.../task-6-report.md`; its findings are copied into docs/reports/2026-10-13-seafloor-relief.md at Task 14).
- On main, from a clean load: 8.3 u and 130 frames in the throat. In main's full-mode run the case passes because it runs after zone 0's case and inherits its gait state.
- Zone 1's ground is unchanged by the relief, so this is main's defect, not the relief's (Ruling 23 on the relief branch).
- Levers: `tools/bench/fissure-probe.mjs` `open-ledge` (the searched ledge: n.y ≥ 0.8, ≥ 1.5 u under `lipMeanY`); player.js's ledge/edge handling near the open crack.
- The same report found a related clean-load fragility on walls z2: −0.104 against the old −0.1 bar. The relief re-derived that bar to −0.12, from player.js's per-frame step-up of 0.113 u.
- Acceptance:
  - each fissure-probe case starts from a clean state (no gait carried over);
  - open-ledge passes in zone 1 from a fresh load;
  - or the ledge behaviour is ruled acceptable, with the reason.

## Log
- 2026-10-13 — Captured from relief Task 6 (Ruling 23).
