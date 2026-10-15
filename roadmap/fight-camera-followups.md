---
title: Fight camera follow-ups
status: backlog
tags: camera, brooder, game.js
updated: 2026-10-15
---
What the merged fight-camera fix left open: under Velkath, Sal's boot soles can fill the screen when he hauls flat; her body hides the wards more often from the low camera; and after the calm the camera can still end up inside her when her claws close round him.

## Detail
- **Where it comes from:** card fight-lens-off-sal (merged 4bc2db6, Michael: "dont worry about the camera fix just merge it for now"). Report: `~/sc/.abyssa-wt/reviews/lensfix/report.md`; stills `~/sc/.abyssa-wt/shots/lensfix/` (`drop-sheet.png` shows the boot soles).
- **The items:**
  - **Boot soles.** The keep holds the lens 2.2 u off a VERTICAL axis through him (like SALCAP); hauling flat, his boots fill the frame from ~1.5 u. Lever: the keep's axis follows his body (game.js `updateCamera`, the keep, `CRECAM.drop`).
  - **Wards hidden.** From the low lens, a dark ward is in frame and not behind her body less often (70 -> 41%, 39 -> 35 / 24%, 35 -> 25%; one 47 -> 51%), and riteplay's average bot (it only targets wards it has seen) fought longer, median 51 vs 31 s over 16 pairs. Unproven for a human; judge it on video first. The alternative to the drop is a sideways swing round him.
  - **In her after the calm.** When she settles or re-rises with her claws closing round him there is no clear spot below his helmet; the lens ends in her (3 of 12 runs) or pressed (3 frames, one run). Main does the same. Her claw collision capsules are an 85th-percentile fit and under-cover the claws (also the lens-on-her-surface frames at a full 9 u boom). Levers: `sleeper/bodyCols.js` claw capsules; a sideways swing.
  - **Untested:** the eggs' minimum moved 1.0 -> 2.2 u and never fired on the branch.
  - **The light-up flash** (option B, not picked) still washes the frame up close.
- **Acceptance:** Michael judges a before/after video of the same fight first; then whichever items he picks, each with a RED/GREEN on velfix-gate (clock plugged).
- **Hazards:** CLAWCAM / BOSSCAM bit-identical when off; the camera stays grounded; the buried-rock work adds POINTCAM on top of this code.

## Log
- 2026-10-15 — created when Michael merged the fight-camera fix as it stood.
