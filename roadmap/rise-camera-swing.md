---
title: The camera stays out of Velkath as she rises
status: wip
tags: camera, velkath
updated: 2026-11-19
---
As Velkath rises next to Sal, the camera ends up inside her body for about half a second, then pops out. The fix lets the camera swing to one side when it cannot drop straight back. Being built on its own branch.

## Detail
Found in the discovery video of 2026-11-01 (24.85-25.45 s of the first take): the lens goes inside her, then jumps 1.3 u. Main has it too, so it is older than the sand and reef work.

Diagnosis (Opus, 2026-11-01, not yet re-proven): every spot the creature camera's drop tries is blocked. Straight behind Sal is inside her, and the floor rule (`game.js` `CRECAM` `dropClr` 1.2) refuses the rest. The main guard then holds the lens inside her; the pop is the guard's escape at 30 u/s. The 2.3-2.7 u hold that follows is `CRECAM.hold` 1.2 s.

Proposed lever: in `game.js` `updateCamera`'s DROP block, when the drop misses, try `creSpot` at +/-30 deg then +/-60 deg (`swing`), with a 0.6 floor. `swing: 0` must give today's camera bit for bit.

Rejected for now: shortening `CRECAM.hold` during her rise. Michael has not ruled on it.

Acceptance: over the whole rise at home, the lens is never inside her body and never jumps; `velfix-gate`, `burial-probe rise` and `risecam-probe` hold; a probe fails with `swing: 0` and passes with the fix; Michael watches a before/after video and says the camera reads right.

## Log
- 2026-11-09 — created. Michael: "do 1, 2 and 3" (1 = this fix). Branch `camswing`.
- 2026-11-09 — swing built on `camswing` (df75d03), rise only (in the fight it lost his helmet from frame). The diagnosed mechanism is real and fixed where it bites: Sal 2 u off her edge with his back to her, lens inside her 34 frames -> 2-3, drop misses 53 -> 2. The 2026-11-01 clip did not reproduce on today's main with the same inputs; it depends on where he ends up standing. Two older 1-4 frame cases remain (a leg unfolding through a close lens; the lens crossing her shell rim at a long boom). New probe `riseclip-probe.mjs`. Honest look: the swung view tucks low beside him with her leg filling a third of the frame and his helmet cropped; not clearly better than main. Videos in `~/sc/.abyssa-wt/video/camswing/`. Not merged; Michael to judge.
- 2026-11-19 — Michael watched the swing videos: "all looks good", then "yes merge and push both when they pass, then do 2", where 2 was "A better rise camera. Pull the camera up and back while she rises, instead of the sideways swing." The swing (`camswing`) stays held and unmerged. New branch `risecrane`: during her rise the camera lifts up and back so Sal and her rising body both read, with the lens never inside her. Acceptance is unchanged, plus: Sal stays in frame, the move reads as a camera move and not a lurch, and it hands back smoothly once she stands.
- 2026-11-19 — `risecrane` built (8 commits, 14a757d..3187b31; not merged). During her rise the lens cranes to the side of Sal away from her, 0.7 R out and 0.28 R above his helmet, easing in over 1.6 s and back over 1.8 s once she stands; only when he is within 1.3 R of her at the wake; `RISECRANE.on = 0` is today's camera. `riseclip-probe`: lens inside her 0 frames in every case (main 34 / 15 / 1-2), largest one-frame jump 0.39 u (main 1.05), helmet in frame through the rise; the one failing case, `off`, is 11 frames of the fight camera's framing after the hand-back, which main has too. `burial-probe rise` check (e) now passes (lensMin 5.49; main 2.39). Load, risecam, pointcam pass; clawcam 34/35 as main. Videos in `~/sc/.abyssa-wt/video/risecrane/`. Open for Michael: with his back to her the lens comes round about 155 deg to his front, so W walks him toward the camera while it is round; and a mouse look of 5 deg hands the crane back, which brings main's clipping back (26 / 3 / 15 frames), so in real play it may barely act unless looks stop dropping it.
