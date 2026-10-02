---
title: Raft: ladder to the left rail, deck collision
status: done
tags: raft, gameplay
updated: 2026-10-02
---
Michael, 2026-10-02: "lets focus on the raft. Lets move the ladder to the left side. The air hose rig is in the way. Also seems like sal can walk through most items."

## Detail
- "Left" was read as screen-left from the old default deck camera (looking toward +Z), which is raft +X. The ladder and its bulwark gap moved to the +X rail at |z| < 1.2; that is the only spot clear of the flotation drums. The +Z rail is now solid.
- The gallows (davit.js) is turned onto the +X rail beside the gap (`RIG_Z` 2.9) and the jib is extended 0.25. The hose reel sits in the same rotated frame, so its lead runs straight to the sheave. The tether anchor follows the sheave.
- Sal spawns at (2.6, 0) facing +X (`DECK_SPAWN_YAW` in game.js), so the ladder is straight ahead. The ladder climb triggers at x 4.2–5.9.
- Deck collision (`src/systems/raft/colliders.js`, 25 flat boxes and capsules in raft-local x/z) is resolved in player.js in the raft's moving frame, with slide along faces and zero allocation. Any gap narrower than Sal's body is filled, so he can never wedge.
- Moved to make room: the lashed cargo to the forward rail, the hose stock aft of the gap, the chafe plates to flank the gap. Draw calls unchanged (9).

## Log
- 2026-10-02 — merged raftfix (f45615b, 7d4e009). Verified on main: Sal walks out of the gap into the sea, stops at the dressing station, console clean, fingerprints unchanged.
- Open: if Michael meant "ladder to his left while still facing +Z", it is a one-line `DECK_SPAWN_YAW` change. Some colliders are blockier than the gear they cover. The hose has no deck collision, so it can cut across the gallows' forward leg. The deck camera ignores gear.
