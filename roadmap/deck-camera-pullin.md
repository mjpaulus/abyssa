---
title: Deck camera pull-in
status: done
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

- 2026-10-04 — SHIPPED on branch deckcam. On the planks the boom is 6.0 back, 2.1 up (was 9 / 2.4) and aims 0.8 lower, so the sea line sits in the upper third, the helmet stands clear below it, and the pump/reel/cargo fill the lower half. `deckK` eases 9<->6 on a critically-damped spring (~1 s): out when he steps over the side, in from mid-ladder as he climbs aboard; spawn/voyage/rescue cut straight to the deck boom. Underwater deckK is exactly 0, so the water camera is unchanged. On deck the boom is tested from the top of his helmet against the raft's gear in raft-local space (colliders.js camBlockedLocal: deck lines as columns, gallows legs, jib, lantern, pump stack/head/receiver/flywheel), so the test rolls with the hull; contact is bisected so the pull-in has no steps. When something waist-high is right behind him the boom cranes up over it (0.9/1.8/2.7 lifts, with hysteresis) rather than pulling in to 2.2. A hard stop catches spring lag in fast turns. Measured: deck loops of 1275 frames (calm) and 1778 (storm, roll to 9 deg) gave 0 lens-inside-gear frames, with 4.3%/4.4% of frames pulled in (gallows legs, stack); 10 in-place spins at 5 spots, 0 clips. See it: start a dive and walk the deck. A/B: `__deckcam.knobs.on = false` (back to 9), live state `__deckcam.state()`.
- 2026-10-04 — Merged to main (9477571): 6 back / 2.1 up / aim -0.8 on deck, ~1 s blend, deck-gear occlusion + crane. Fresh-tab verified. Moved next -> done.
