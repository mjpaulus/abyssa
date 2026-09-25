---
title: GPU timer profiler + median quality loop
status: wip
tags: perf, reference
updated: 2026-09-25
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: S.

## Detail
Study: core/GpuProfiler.js (EXT_disjoint_timer_query ring, EMA, gl.finish fallback) and core/Quality.js tick() (median window, wall-time cap, log2 tier shed, cooldowns, UPGRADE path).

CHANGE: Replace samplePerf's one-window fps bar: per-zone GPU timings, outlier-proof median, panic shed by log2(overshoot), and the missing half — climbing back up when headroom appears.

## Log
- 2026-09-25 — shipped on branch `ref-profiler` (not merged). GPU timer: an 8-query
  EXT_disjoint_timer_query_webgl2 ring around refraction + composer, async readback,
  EMA + 64-frame median, disjoint discard, `window.__gpu` (supported/ms/median/last/n);
  wall-time-only where the extension is absent. Judge: 90-frame wall-time median vs
  the governor's budget (1000/cap ms; bar = 1.5x + 1 ms), 3 s sustained, log2(overshoot)
  panic shed capped short of the terminal rung, 3 s cooldown; terminal rung also needs
  the GPU median over half the budget where the timer exists. Upgrade: `restoreQuality()`
  climbs one rung after 10 s of headroom (keeps pace AND GPU median < 65% budget), per-rung
  wait doubles after a shed follows an upgrade. Measured (driven pane loop, ?lab hooks):
  `__gpu.median()` 8.7-9.4 ms at 1536x1152, stable; 60-cap rest 65 s -> stage 0 (median
  16.3-17.1 ms); hidden drive 20 s -> never sampled; 30 ms busy-wait -> tier 1 at +4.5 s,
  tier 2 at +10.6 s, load off -> tier 1 at +13.6 s, tier 0 at +13.1 s; 70 ms busy-wait
  (median 74 ms, 4.5x) -> two rungs in one judge. Not verified with real visible-tab rAF
  (pane and Chrome both reported document.hidden); per-pass timing not wired.
