---
title: Quality ladder
status: done
tags: perf
updated: 2026-08-05
---
Degrade sheds transparency LAST: quarter target, volumetrics/AO/sun-shadow, then full shed.

## Detail
Each rung needs its own 4 sustained seconds under 34fps. window.__perf.stage() reports the rung. Tier 2 measured: 26.2 -> 18.0 ms in-pane with the sea still a window.

## Log
- 2026-08-05 — shipped (078200b + c70151e)
