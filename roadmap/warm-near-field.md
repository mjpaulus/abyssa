---
title: Warm near field, zone 0
status: done
tags: water, taste
updated: 2026-10-04
---
Red 2% reach 84 -> 105 units in zone 0. Is the warmth right?

## Detail
Kill switch is three adjacent constants in `src/world/water.js`: set `K_PART` equal to `K_EXT` and `SILT_MIX`/`SILT_GAIN` to 0.00/1.00 to revert the warm near field entirely.
Worth judging NOW: until the samplePerf fix the game silently ran with volumetrics/AO/shadows off — you had never seen full quality.

- Acceptance: Michael rules keep / revert / tune, after seeing zone 0 at full quality; his words go in the log.

## Log
- 2026-08-05 — carried from the silt-line round; still awaiting the call
- 2026-10-04 — RULED by Michael: "Keep it". The warm near field (K_PART / SILT_MIX 0.62 / SILT_GAIN 1.08) stays as shipped. Moved decision -> done.

