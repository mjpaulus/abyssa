---
title: The sand-cloud check fails one run in ten by chance
status: backlog
tags: tooling, velkath
updated: 2026-11-19
---
The check that measures Velkath's rising dust cloud fails about one run in ten on main with nothing wrong. Each load scatters the dust particles differently, and the pass marks sit too close to that spread. It cost a day of doubt on the claw-point merge.

## Detail
Found 2026-11-19 while clearing `clawpoint` for merge. `tools/bench/sandpix-probe.mjs cloud` has two bars: `seen` (coverage at +2 s >= 0.03) and `settles` (cov12/covMax <= 0.70). Over 20 runs main reads `seen` 0.0348 +/- 0.0030 and `settles` 0.476 +/- 0.117, so each bar fails a few percent of runs by chance; 2 of 20 main runs failed one.

Cause: `plume.js` draws each particle's angle, spread and start time from unseeded `Math.random`, so the same cloud lands on different pixels every load. The capture adds about 0.6% coverage of noise. `settles` also reads the wrong dust: by +12 s no rise particles are left, and it tracks her hunt's footfall dust (correlation 0.86 with cov12).

Options, none chosen: seed the plume's random numbers in the probe so one run is the answer; judge the median of 5 runs; set the bars from main's own spread (for example `seen` at about 0.026); make `settles` measure the rise plume alone.

Evidence and the instrumented and seeded probe copies are in `~/sc/.abyssa-wt/video/clawpoint/cloud-noise/`.

Acceptance: the cloud check passes on main in at least 39 of 40 runs, still fails when the cloud is really gone or never settles (a RED for each bar), and the look of the cloud in the game is unchanged.

## Log
- 2026-11-19 — created from the clawpoint cloud investigation.
