---
title: The fifth ward won't light
status: wip
tags: sleepers, bug, gameplay
updated: 2026-10-08
---
Michael, 60 fps playtest: "I tried multiple times to hit the 5th ward but it doesnt change." Which sleeper is unknown. Velkath at home has only 3 wards, so "5th" points at a 5-ward configuration: Mhor (zone 2) at every site, Orune (zone 1) at Pallid Bank and the Burned Ground, all three at the Unsounded Shelf.

## Detail
- Suspects: the shared ward light pool of 5 (sleeper/common.js) is also staged by Orune's hoard and Mhor's body lights; the remembered-ward path (`__lev.remember`); the per-site `hard` rows (Mhor's stun 10 / 8.5 / 7 s; Orune's wards need a sonar ping); the HUD feedback for a ward taking (flash/embers/chime, remaining count, the last ward) and Velkath's brood-rule line.
- Acceptance: every ward of every configuration (kind x site incl. the Unsounded Shelf, fresh and remembered) touch-tested through the game's own touch path with the real gates; per ward: built, has a light, touch registers, lights visibly, calm completes. Root causes fixed without adding a THREE light; the player sees each ward take and how many remain.

## Log
- 2026-10-08 — created; branch wardfix.
