---
title: AAA shader pass (all shaders)
status: wip
tags: bug, perf, shaders, quality
updated: 2026-08-25
---
Full pass over every shader in the game against the threejs-skills packs, AAA bar. Three parallel audits (life / world / postfx), then three implementation branches. Absorbs the reversed-smoothstep sweep.

## Detail
Audit headlines (2026-08-25):
- **Eleven dead reversed-smoothsteps confirmed** (sweep card knew 10 of the sites; ventlife shrimp flick is new). Art that has NEVER rendered: the entire 48-billboard god-ray system, both marine-snow layers (6,600 points), every fish's photophore rows (the whole zone-2 species identity), jelly crown glow + four-lobed inner core, the shark's eye/gills/lateral sheen, all brain-coral grooves AND their bioluminescence, shrimp tail-flick.
- Volumetric shafts were tuned against the invisible billboards — joint re-balance owed on resurrection. All resurrected art is un-reviewed: first live render gets re-tuned to the quiet bar.
- Eight more transparent-DoubleSide double-draws (r163 class): jelly trails/drifters (additive = silently 2× brightness), leviathan membranes, boot prints, rift shaft/caustic/rim, sonar + thruster rings.
- Predator culling stale vs the stratified fog (shark pops at 205u while sightlines reach ~420); rift motes have no distance fade (neon points across the basin — house-law violation); spear metal has no envMap (black stick); chimney normal seams; grain applied before SMAA then smoothed away; COLOR_DODGE grain brightens the murk; DoF blurs the deck horizon; no NaN guard before mipmap bloom.
- Worth reviving from the benched cinematic pass: NaN scrub + depth-driven CDL grade (as merged Effects, not Passes).

DECISION (Michael): props.js loads downloaded glTF models — violates the generated-only hard rule (predates it). Regenerate props procedurally, or exempt?
