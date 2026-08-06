---
title: SKY & WIND — wind on the water
status: done
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
- 2026-08-06 — shipped: anisotropic chop in waveSum (vertex+fragment+CPU mirror agree — maxAbsDiff 0 at wind 0 over 1600 samples), whitecaps height-led (coverage 9-13% calm to gale, hard-clamped 0.26 under bloom), wind-aligned undercurrent decaying exp(-depth/60) — push at -30 (2.2u/5s), noise by -200. game.js wired setWindCurrentVec off the EASED wind. GLASS.windwater knobs
