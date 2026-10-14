---
title: The throat walls at the crack's tips draw sub-column features loosely
status: backlog
tags: terrain, fissure, drawn-only
updated: 2026-10-14
---
At the two tips of every zone-0 crack, the drawn strata walls handle features narrower than their 0.5 u columns loosely:
- The east tip draws a needle about 2.7 u deep and about 0.5 u long that the ground ends sooner.
- The west tip draws its knife-slot wider and wandering.

Both are drawn-only, small, and there at every site. They were found while measuring the relief, which did not cause them.

## Detail
- **Found by:** relief Task 7b (Rulings 29, 35, 36). The true 3-D distance from the drawn wall to the ground is 0.13–0.27 u, so walls-inside's recess bar passes.
- **East tip.** The overhang slab {u0 22, side 0} sets the carve back only for v < 0, so the ground steps at v = 0. The floor split lands on that needle, and the strip to the next column dips under the floor. About 1,000 lens-clear sightlines can see it, at every site.
- **West tip.**
  - The strata recess widens a 0.36 u slot's faces to about 2 u.
  - The drawn crevice wanders off the slot's zigzag, through a 0.28 u fin.
  - A pocket cap was tried and reverted (Ruling 36). It hid real slot to cover the fin. The patch is saved at `~/sc/.abyssa-wt/reviews/t7b-scripts/pocket-cap-0e5043b.patch`.
- **Levers:** terrain.js `buildFissureWall` / `wallScan` / `wallMeasure` / `fillFissureWall`, and the strata `wallRecess`. One candidate rule: no strata recess in sub-column pockets. It touches every plane.
- **Acceptance:**
  - walls-inside passes at every plane;
  - the drawn-against-ground mismatch at both tips falls (7b's lattice measure);
  - the other planes are judged by stills, not by bit-identity.

## Log
- 2026-10-14 — created from relief Task 7b's findings.
