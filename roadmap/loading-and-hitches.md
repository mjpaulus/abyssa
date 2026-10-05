---
title: Loading bar + first-play hitches
status: wip
tags: perf, boot
updated: 2026-10-04
---
A real loading screen whose bar is driven by the actual boot work (module fetch, world build steps, each sculpted asset set, physics, audio, shader compile, warm-up frames), and the root-cause fix for the chunky seconds after the title click and after Sal's first entry into the water.

## Detail
Michael (verbatim): "when the game is loading, show a progress bar of what is happening. After I click the screen everything is super chunky, it settles after a moment and performance improves. It happens again after sal enters the water."

- Progress must be monotonic and reach 100% only when the game is truly ready to play smoothly.
- Design like the game: brass/ink/paper, never a web spinner, never neon; reduced motion respected; hands off to the title.
- Goal: after 100%, the click into play and the first dive have no frame over ~2x the steady frame time.
- Measure with the headless bench host (tools/bench/cdp.mjs) + tools/bench/hitch.mjs (real mouse click, real W key).

## Log
- 2026-10-04 — created (branch loadbar). Baseline measured (bench host, 60 Hz vsync): the click stalls ~2 s (a 614 ms task, then ~1.4 s more): programs 306 -> 422 because the ward-light pool (5 PointLights) is built by the first enterZone(0) AT THE CLICK, taking the scene from 9 to 14 lights and recompiling every lit material (getProgramInfoLog 1.3 s), plus the Brooder's build (418 ms), audio graph (200 ms), shadow-depth programs and Rapier init. The first dive stalls ~700 ms (200/350/150 ms frames) inside the sky's PBO readback: GPU-process pipeline creation for draws first seen underwater (only 2 new programs). DRS then stepped 1.5 -> 0.875 on the hitch misses.
