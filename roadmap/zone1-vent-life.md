---
title: Zone-1 vent life
status: done
tags: zone 1, creatures
updated: 2026-08-05
---
Pale shrimp and crabs swarming the chimneys — the boiler room inhabited, not just built.

## Detail
Pattern: creatures.js boid/instancing idioms; swarm anchors at the 12 active chimney positions (vents.js `activeVents`).
Tone: pale, small, dense near throats — life that eats the heat. No glow.

- Acceptance: Swarms visible at every active chimney, dense near throats, zero glow, no measurable frame cost at the floor.

## Log
- 2026-08-05 — agreed as next after the boiler room shipped
- 2026-08-05 — started: `activeVents` exported from `vents.js`, contract stub `ventlife.js` wired into game.js (build/reseed/update), craft agent building the swarms
- 2026-08-05 — shipped: `world/ventlife.js` — two InstancedMeshes (160 shrimp/vent GPU-swirled at the throat, 2 crabs/vent on the crust), all motion in the vertex shader, no glow, fog on, depth-band gate -340/-630. Verified live: 1920 shrimp + 24 crabs across 12 vents, materials stable across 5x reseed, no measurable frame cost at the floor (16.0 vs 16.2 ms median)
