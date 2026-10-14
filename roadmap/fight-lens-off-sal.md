---
title: Velkath's fight — the camera keeps off Sal under her
status: next
tags: camera, brooder, game.js, velfix
updated: 2026-10-14
---
During Velkath's fight the camera can press against Sal when he is under her. It then rests against his dress or lantern, or inside her shell or legs after the calm, and her ward light-ups wash the frame. Michael's call: when the camera has no clear spot, it drops below Sal's helmet, as it already does for her eggs, instead of resting against him or inside her.

## Detail
- **Found by** relief Task 9 (velfix-gate on main, the clock plugged), reproduced on main 12/12 route runs.
  - Of 8,471 frames with the lens ≥ 2 u from his bonnet and no light-up in the last 0.6 s, 0 are washed.
  - Every washed frame has the lens pressed (CRECAM `minD` 2.2 u from his pivot, SALCAP's capsule inside it) or a fresh light-up 2–6 u off.
  - Classes:
    - the light-up's hide ring up close (17–59% of the frame, over the 15% cap to flashT 0.55–0.72 s);
    - his dress or lantern in an air-pack burst (4 full white-outs in 18 runs);
    - the lens inside her shell (12 frames) or a leg (29) after the calm.
  - Report: relief `.superpowers/sdd/.../task-9-report.md` §2b; frames `~/sc/.abyssa-wt/shots/velfix/gates/t9-*`.
- **Michael's ruling (2026-10-14):** "A is good", confirmed "yes", after seeing four frames: the light-up at ~48% of the frame, his suit in a burst, his lantern white-out at the calm, the lens inside her shell at the calm.
  - Picked: A, keep the lens off Sal under her.
  - Not picked: B (soften the light-up ring) or C (both).
- **Levers:** game.js `updateCamera`'s creature lens guard (`CRECAM` `minD`, `creLensAhead`), `SALCAP`, and the eggs' existing drop-below-the-helmet fallback.
- **Acceptance:**
  - velfix-gate on main goes from RED to GREEN on the pressed-lens classes. The PRESSED and calm-shell / leg frames go to 0; FLASH frames are judged as they then stand.
  - It needs a RED/GREEN pair on main, with the clock plugged as in relief Task 9's tools.
  - The camera stays grounded: weight cues as events only, and no continuous wander.
- **Hazards:**
  - The claw look-up (`CLAWCAM`) and the boss crane (`BOSSCAM`) also move the lens under her. Whatever this changes, those two must stay bit-identical when they are off.
  - Relief Task 10 judges the gate RELATIVE to main until this lands.

## Log
- 2026-10-14 — created from Michael's camera decision (velfix option 1, his "A").
