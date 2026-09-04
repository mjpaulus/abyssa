---
title: Announce the hose gate at calm time
status: done
tags: design, onboarding, survival, eval
updated: 2026-09-01
---
From the 2026-09-01 design evaluation (ABYSSA Soundings). Effort: S.

## Detail
PROBLEM: 'THE LINE IS TOO SHORT — 1440 M NEEDED' fires only when the player is already ~55% into the rift after calming. With HOSE_START 380 and zone 1 needing 480, the player must find 4 polymer AND return to the raft before the second zone — a long, unannounced backtrack.

CHANGE: At calm time, when !canDescendTo(zone+1): 'IT STILLS. YOU HAVE 1140 M OF LINE. THE RIFT NEEDS 1440.' That is the one moment the player is looking at the message.

## Log
2026-09-01: Shipped in campaign wave 1 (merged 7d7771d design / 5c36aa6 story / 8e5726c audio / eec2480 world). Awaiting Michael's eye.
