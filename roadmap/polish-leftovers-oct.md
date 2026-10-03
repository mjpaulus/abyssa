---
title: October leftovers sweep
status: wip
tags: polish, bugs
updated: 2026-10-03
---
Small known defects left by the September and October passes: a sinking boot downhill, a mantle seam, crab claws in rock, the sea under a lightning flash, gale foam under anti-aliasing, the hose crossing deck gear, and dead knobs in the water code.

## Detail
- Sal: on a steep downhill the planted boot sinks about 5 cm now and then; seabed helmet bob 0.10 u against a 0.05–0.08 target (do not reintroduce the half-crouch).
- Octopus: a visible step where the sculpted mantle meets the generated arms.
- Vent crab: long claws poke into nearby rock.
- Ocean: a lightning flash turns the sea a flat pale grey; gale foam softens under TAA (motion vectors or reactive mask).
- Raft: the hose has no deck collision and can cut across the gallows' forward leg.
- Cleanup: dead `GLASS.chop` and `windwater` knobs in `water.js`; `postfx.skyrays.js` still uses the old haze constant `K_AIR_G`.
- Acceptance: each item fixed and verified live, or written down here with the reason it was left.

## Log
- 2026-10-03 — created from the open items on sal-walk-and-sculpt, sea-life-sculpted, sea-and-sky and raft-ladder-collision; work started.
