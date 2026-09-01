---
title: HUD hierarchy for five bars
status: backlog
tags: ui, hud, eval
updated: 2026-09-01
---
From the 2026-09-01 design evaluation (ABYSSA Soundings). Effort: S.

## Detail
PROBLEM: Five stacked bars with identical geometry (dress / bottle / lantern / air / pump) and no visual hierarchy for the one that kills you. The HUD is also visible behind the title screen.

CHANGE: Group: survival pair (AIR widest, pump) bottom-centre; control pair (dress, bottle) bottom-left; lantern beside the bearing strip. #ui opacity 0 while state === 'title'.
