---
title: Home is done enough
status: wip
tags: design, zone 0, velkath, user
updated: 2026-11-22
---
What "home is right" means, written down so the polishing stops. When every line below holds, home is closed: no new look or feel cards for zone 0, only bug fixes, and the work moves to zones 1-2 and the other anchorages.

## Detail
- **Michael, 2026-11-22**, answering the review's six steps ("Declare home done enough. Write down what right means in one card, then stop polishing it."): "do all 6, I already made all those calls".
- **Why:** from 2026-10-09 to 2026-11-19 almost every commit went into one encounter (Velkath at home: the relief, the burial, the sand rise, the reef, the claw point and four camera rules) while zones 1-2, Orune, Mhor, the audio and the anchorages stood still. Every recent home card closed with another camera or look follow-up.
- **The bar (all must hold):**
  1. The rise camera is merged (card rise-camera-swing; `risecrane`, held through the rise).
  2. No downloaded asset is left (the AmbientCG terrain maps replaced by generated ones; branch `terrain-gen`).
  3. One real-input run of home end to end passes on merged main: raft, ladder, descent, the harpoon pulled, the rise, the fight, the calm, the point, the rift opening, the drop into zone 1. No console errors, the invariants (relief-load `load`) pass, and no frame with the camera inside her or Sal (riseclip-probe, velfix-gate's in-her columns).
  4. Michael plays home once on his own machine and says it is done. Anything he finds goes on this card's log as a punch list; only bugs get fixed.
- **Closed by this card, as they stand:** the claw hold's stillness (kept as merged 2026-11-19), the clutch look (card brooder-clutch, kept as built), fight-camera-followups (parked: only a playtest finding reopens one of its items).
- **Not home work, and not blocked by it:** the bench clock leak, the sand-cloud check's noise, shadow-variant-warmup (tooling and perf, any time).
- **Acceptance:** lines 1-4 hold; then this card moves to done and zone 1 (card zone1-to-home-bar) starts.

## Log
- 2026-11-22 — created from Michael's "do all 6" on the repo review's next steps.
- 2026-11-22 — line 1 holds: the rise camera merged (PR #4). Line 2 is PR #5 (`terrain-gen`), verified (LOAD PASS, no jpg requests) and waiting on Michael's look at open seabed.
