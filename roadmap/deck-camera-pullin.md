---
title: Deck camera pull-in
status: decision
tags: camera
updated: 2026-08-05
---
Camera sits 9 back; the raft is 9.4 wide — deck detail is only ever read from range.

## Detail
CAM_BACK/CAM_UP in game.js (~line 335). Pulling in while `player.onDeck` would change movement feel — explicitly your call, not mine.
All raft detail work to date was judged at the 9-unit distance.

## Log
- 2026-08-05 — carried from the raft round (bb6e78a)
