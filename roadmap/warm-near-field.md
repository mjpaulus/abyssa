---
title: Warm near field, zone 0
status: eye
tags: water, taste
updated: 2026-08-05
---
Red 2% reach 84 -> 105 units in zone 0. Is the warmth right?

## Detail
Kill switch is three adjacent constants at ~`src/world/water.js:44`: `K_PART = K_EXT`, `SILT_MIX/SILT_GAIN = 0.00/1.00` reverts.
Worth judging NOW: until the samplePerf fix the game silently ran with volumetrics/AO/shadows off — you had never seen full quality.

## Log
- 2026-08-05 — carried from the silt-line round; still awaiting the call
