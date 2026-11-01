---
title: More reef on her back
status: wip
tags: velkath, burial, look, user
updated: 2026-10-31
---
The coral and weed on Velkath's exposed back are better but should be pushed further: grow more of it, so the buried rock reads as an old reef-covered stone.

## Detail
Michael 2026-10-31, look question 4 ("the coral and weeds having no surface"): "better but can be pushed more", then "grow more coral". So this is MORE GROWTH, not colliders: Sal still passes through it.

Levers: burial.js `growRock` (her reef's parts and the weed's spare slots, no new program), `prepGrowth` / `growReveal` / `growCover`; placement filters (the strip, floor + 0.3, the harpoon seam's sight corridor and GROW.near) stay. The dig-in does not re-lay the growth (ruled at the buried final review).

Acceptance: Michael's eye on stills / play; burial-probe disguise (incl. `coral`, `fronds`), wound and digin green; invariants hold; boot-tail compile still covers it (no first-sight hitch).

## Log
- 2026-10-31 — created from Michael's answer. Branch reefback.
- 2026-10-31 — built on reefback (to 9e9aa06): exposure-drawn colonies (10 fans, 28 mats, 59 coralline skins, 57 lumps, 17 tube clumps; 120 fronds in tufts), coral kept out of the seam's sight corridor, mats only where they lie. Michael on the stills: "1. good". Code review in progress. Not merged.
