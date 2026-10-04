---
title: Deck camera pull-in
status: next
tags: camera
updated: 2026-10-04
---
Camera sits 9 back; the raft is 9.4 wide — deck detail is only ever read from range.

## Detail
The levers are `CAM_BACK` and `CAM_UP` in `game.js`. Pulling the camera in while `player.onDeck` is true would change movement feel — explicitly the user's call.
All raft detail work to date was judged at the 9-unit distance.

- Acceptance: A ruling: keep the 9-unit boom everywhere, or a chosen closer distance on deck; then implement and judge live.

## Log
- 2026-08-05 — carried from the raft round (bb6e78a)
- 2026-10-04 — RULED by Michael: "Closer on deck (~6)". Build: while player.onDeck the boom is ~6 back and a touch lower; eases back to CAM_BACK 9 over ~1 s when Sal goes over the side (and in again on climbing out). clearCamDistance still pulls in against the pump rig. Moved decision -> next.

