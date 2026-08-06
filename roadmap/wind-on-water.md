---
title: SKY & WIND — wind on the water
status: next
tags: water, waves, player
updated: 2026-08-05
---
Waves follow the wind: directional bias and amplitude, whitecaps torn off crests in a gale, and an undercurrent that pushes at -30 and dies by the abyss.

## Detail
Builds on day hands (wind {speed, dir}); runs AFTER the clouds/fog/moon card (same file, serialized).
- Surface: anisotropic wave bias along wind dir, amplitude from wind not just storm; whitecap crest brightening above ~0.6 wind. `world/water.js` surface shader.
- Below: storm current becomes a wind-aligned vector decaying with depth — real push at -30, whisper at -200, nothing in the abyss. `player.js` setStormCurrent wiring is the orchestrator's.
- Raft swell already reads env.sea; verify the pairing in a gale.
- Acceptance: in the lab a wind sweep visibly re-aims the swell and whitecaps appear; the underwater push aligns with the surface wind and decays with depth; calm noon anchored.

## Log
- 2026-08-05 — cut from the west-coast round; serialized behind the sky card
