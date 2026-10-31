---
title: The sand rolls off her as she rises
status: wip
tags: velkath, burial, look, camera, user
updated: 2026-10-31
---
When Velkath rises, sand stays on her and pours off her back and flanks over a few seconds, a low sandy cloud rolls off her edges, and the camera turns to her for the rise, then hands back.

## Detail
Michael 2026-10-31: "we lost that she is partially covered in sand and when she rises the sand rolls off in a slight dust cloud." Investigation (reviews/sandfix): no build lost anything; from the 10-20 checkpoint to main the crust, slabs, pour and plume are identical in state and pixels. In play the lens follows Sal (shoved off her) into a pale puff around him, her rising shell off-frame, and her crust fades with `bury` so she is clean by the time she stands. Michael approved the proposal: "yes do all three for the sand".

The three parts:
1. Sand stays on her through the rise: a partial cover that pours off her back and flanks over ~3-4 s (streams and sheets off her edges), some left lying in the hollows of her shell once she stands (burial.js crust / slabs / `L.crackK` / `riseU` / `pourU`).
2. A low, sandy dust cloud that rolls off her edges and settles, in place of the pale puff round Sal (plume.js `rise` kind; the blind rule SIGHT keeps working).
3. RISECAM: the lens turns to her during the rise like POINTCAM, the lens's LAST rotation, dropped on a real mouse look, handed back.

Acceptance: Michael watches it in play and says it reads; a pixel check on the crust and the cloud (the probes never read pixels: a crust that drew no sand would pass them); invariants and burial-probe / pointcam-probe green.

## Log
- 2026-10-31 — created; Michael approved all three parts. Branch sandrise.
