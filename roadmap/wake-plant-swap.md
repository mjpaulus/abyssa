---
title: Plants near Velkath swap in one frame when she wakes
status: wip
tags: velkath, flora, bug
updated: 2026-11-09
---
At the moment Velkath wakes, some kelp stalks and a tube sponge near her change in a single frame. It shows in both discovery videos. The cause is not known yet; it is being tracked down on its own branch.

## Detail
Seen in `velkath-rise-play.mp4` and `velkath-rise-observer.mp4` (2026-11-01, in `~/sc/.abyssa-wt/video/velkath-discover-rise/`) between 21.13 s and 21.20 s (frames 634 and 636 of the 958-frame, 30 fps takes). The observer take holds the camera still, so the change is in the world, not a camera cut.

Not known: which plants, which system redraws them, and whether main before the sand and reef work (75c487f) does it too.

Acceptance: the cause is named with evidence; a probe catches the swap and fails on today's main; after the fix no plant near her changes shape, place or kind across the wake frame, and the sleeper, ridge and serpent fingerprints are unchanged. If the fix needs a look choice, it comes to Michael first.

## Log
- 2026-11-09 — created. Michael: "do 1, 2 and 3" (2 = this). Branch `wakeswap`.
- 2026-11-09 — cause found: the plants never changed. Her plant push (`stir.js` `tickStir`, a 24.6 u sphere reaching about 47 u) switched on at full size the frame after she woke, while still buried, and off in one frame at the calm. 75c487f has it too. Fixed on `wakeswap` (76a110e, fa40cc5): the push eases in as she leaves the sand and out at the calm (`STIR.slpEase` 1 s). Largest one-frame push 8.05 u -> 0.13 u (wake), 0.37 u (calm). Probe `wakeswap-probe.mjs <wake|calm>`, fails on main. Load checks pass. Only Velkath at home was probed. Open for Michael: the standing push size (`STIR.slpScale`: A today's, B 0.6, C none; stills in `~/sc/.abyssa-wt/video/wakeswap/`). Not merged.
