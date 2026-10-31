---
title: Sky probe readback moved to the start of a paced frame
status: done
tags: perf, sky
updated: 2026-10-31
---
The sky's sun-visibility readback blocked the main thread about 0.5 ms on every other frame on the deck. A paced frame now maps it back at frame start (0.12 ms), same values on the same frame. Pending merge.

## Detail
- Follows bench-zone0-stalls, which named it: `probeIssue()` in world/sky.js read its own PBO ring (`pbo`, `PBO_RING` 4, `PBO_LAG` 3) with getBufferSubData inside `renderSkyInner`, right after the weather map and seabed shadow pass. Blink's getBufferSubData waits for Chrome's GPU process to drain everything queued before it, so mid-frame it waited on that work.
- The pattern is the auto-exposure's: `skyProbeDue()` / `skyProbeEarly()` in world/sky.js map the due PBOs back into `pboPend`; `probeIssue()` ingests `pboPend` first, then runs its old loop, so `shadowSunVis`, `camSunVis`, `stats.sunVis` and airAmbience.sunVis (lighting.js and postfx.skyrays.js read it) change on the same frame at the same point. `postfx.frameStart(cap)` calls it under the exposure's gate (cap > 0, no GPU backlog) and books `skyEarly {ran, skipped}`, shown as `__vsky.early`. Uncapped frames (cap 0, `__bench.live`) keep the old read. Issue cadence (`frameN & 1`), ring size, lag and `pboFailed` are unchanged. The read frames and the issue frames are different frames (the read comes the frame after the issue), so the move does not touch the issue frame.
- Levers: `skyProbeDue`, `skyProbeEarly`, `probeIssue` (sky.js); `frameStart`, `skyEarly` (postfx.js).
- Acceptance: on the deck at the shipping cap the sky's read block drops below 0.2 ms with no missed vsync, the sun-visibility series is unchanged, `relief-load.mjs` passes, the deck still is within the A/A spread.
- Evidence (~/sc/.abyssa-wt/reviews/skyread/report.md), headful Chrome, vsync on, cap 60, DRS pinned 1.5, ABBA main / branch, 15 s per view. The display was the 120 Hz built-in panel (the 60 Hz Studio Display was not attached), so rAF ticks at 8.3 ms and "missed" means an interval over 1.5 ticks.
  - Sky read block on the deck, per read frame (n = 450 each): main 0.57 / 0.51 ms mean (p50 0.6 / 0.5, max 1.0 / 0.7); branch 0.12 / 0.13 (max 0.3). The exposure's read, booked apart, is 0.13 ms in all four runs.
  - Frame work on a sky-read frame (exposure-read frames left out): main 4.40 / 4.49 ms mean, branch 3.92 / 4.10 (about -0.4). On a sky-issue frame: main 5.64 / 5.84, branch 5.96 / 5.89 (unchanged).
  - z0 (deep, probe does not run), control: frame work p50 3.3 / 3.4 main, 3.5 / 3.5 branch; sky early ran 0 in the window. Missed vsyncs: 0 of 1,800 rAFs in every run.
  - `skyEarly` on the deck: ran 450-451, skipped 0 (reads 450). `skySeries` (stats.sunVis equals the last read's value after every frame): 900/900 on all four deck runs.
  - Series identity on the stepped loop (tools/bench/sky-series.mjs: plugged clock, `frameStart(60)` between frames, 850 frames: deck, a cut to z0, Alt+1 back; 9 loads of each build, clock drift 0): the ring starts one of two phases (first non-zero sample at frame 7 or 8) in both builds. Within a phase, main against branch differs on 0-10 of 850 frames and never by more than 0.00065 (the ring is 1/1024 quantised), the same as main against main; the raw ring reads, camSunVis and airAmbience.sunVis show the same. Several pairs are bit-identical. The auto-exposure series is not bit-reproducible between loads on either build (A/A), so it is not compared.
  - Look: settled deck still, 4 loads (plugged clock, `capture({settle: 90})`): A/B mean |delta| 1.65 / 1.62 / 1.20 / 1.77 against A/A 1.68 (main) and 1.72 (branch); sunVis 0.692, camSunVis 0.681 on every build.
  - relief-load.mjs (port 8892, load): PASS; console clean but the favicon 404; `__shaderFailed()` [].
- Tools: `tools/bench/stalls.mjs` (map-back block split by owner, sky issue/read counters, per-frame sunVis check), `tools/bench/sky-series.mjs` (stepped series + `--cmp`), `tools/bench/sky-look.mjs` (deck stills + diff).

## Log
- 2026-10-31 — Taken from the stalls card's Log (its remaining lead) on branch `skyread` (~/sc/.abyssa-wt/skyread). Baseline first: the read blocks 0.5-0.6 ms per read frame on the deck, above the 0.2 ms bar, so it was worth doing.
- 2026-10-31 — Shipped on `skyread` (pending merge): `skyProbeEarly` + `skyEarly` (d7ce37e), stalls.mjs split (0032af1), sky-series.mjs, sky-look.mjs, CLAUDE.md sentence, this card (40bb469); the numbers above.
