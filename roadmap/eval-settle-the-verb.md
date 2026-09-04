---
title: Settle the verb (wards lit, sleeper stills)
status: done
tags: design, copy, onboarding, eval
updated: 2026-09-01
---
From the 2026-09-01 design evaluation (ABYSSA Soundings). Effort: S.

## Detail
PROBLEM: Three different verbs for one action: you LIGHT sigils, the counter says '2 SIGILS SLEEP', the creature STILLS — and the fiction says 'wake nothing else'. A new player cannot tell whether lighting a ward calms or wakes it. The only real confusion in the first five minutes.

CHANGE: Wards are LIT; the sleeper STILLS. Replace '2 SIGILS SLEEP' with 'TWO WARDS DARK' / 'ONE WARD DARK'. Rewrite the opener so it says what a ward is and where it rides: 'THREE IRON WARDS RIDE ITS HIDE. LIGHT THEM AND IT STILLS.' Sweep showMsg strings in game.js + leviathan.js for the verb set.

## Log
2026-09-01: Shipped in campaign wave 1 (merged 7d7771d design / 5c36aa6 story / 8e5726c audio / eec2480 world). Awaiting Michael's eye.
