---
title: GPU timer profiler + median quality loop
status: backlog
tags: perf, reference
updated: 2026-09-01
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: S.

## Detail
Study: core/GpuProfiler.js (EXT_disjoint_timer_query ring, EMA, gl.finish fallback) and core/Quality.js tick() (median window, wall-time cap, log2 tier shed, cooldowns, UPGRADE path).

CHANGE: Replace samplePerf's one-window fps bar: per-zone GPU timings, outlier-proof median, panic shed by log2(overshoot), and the missing half — climbing back up when headroom appears.
