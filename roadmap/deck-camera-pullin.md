---
title: Deck camera pull-in
status: decision
tags: camera
updated: 2026-08-05
---
Camera sits 9 back; the raft is 9.4 wide — deck detail is only ever read from range.

## Detail
The levers are `CAM_BACK` and `CAM_UP` in `game.js`. Pulling the camera in while `player.onDeck` is true would change movement feel — explicitly the user's call.
All raft detail work to date was judged at the 9-unit distance.

- Acceptance: A ruling: keep the 9-unit boom everywhere, or a chosen closer distance on deck; then implement and judge live.

## Log
- 2026-08-05 — carried from the raft round (bb6e78a)
