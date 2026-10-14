---
title: fullplay's walk to the harpoon can coast out of reach
status: backlog
tags: bench, tooling, recorder
updated: 2026-10-14
---
The full-take recorder walks Sal to Velkath's harpoon. It stops on the first frame he is in reach, then holds still for 2 s. If he arrives afloat and gliding, he coasts out of the 2.6 u reach and the take fails. On a correctly running clock he arrives on his feet and holds. Making the arrival robust is a small tool fix.

## Detail
- **Found by:** relief Tasks 10 and 12b.
  - On the leaking clock, he arrived afloat at 3.7 u/s with dh 1.43 and coasted to x 109: 0 of 3 takes.
  - Plugged, he arrived grounded with dh 1.89, which damped to 1.12: 5 of 5 takes.
  - Standing still at the anchor, a grounded Sal never drifts (12 of 12 runs, both builds).
- **Lever:** fullplay.mjs `travel('the harpoon')`. Stop it only once he is grounded and slow, or brake during the "facing the iron" beat.
- **Acceptance:** the take succeeds over 10 seeds and both modes on the relief and on main.

## Log
- 2026-10-14 — created from relief Tasks 10 and 12b.
