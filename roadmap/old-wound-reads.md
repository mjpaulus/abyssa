---
title: The old wound reads in the rock
status: done
tags: velkath, harpoon, look, user
updated: 2026-10-31
---
On a revisit, where the harpoon was already pulled, Velkath's rock now shows a visible old wound with a torn lip and a cold glint where the iron was. A fresh pull's wound heals into it when she digs back in. Michael: "the old wound is fine as is".

## Detail
- Why: Michael's playtest at home with a remembered pull found no harpoon and nothing to find ("went down to velkath and there was no harpoon to pull"). The prompt "[E] PRESS THE OLD WOUND" existed, but the wound did not read from the sand.
- Levers: burial.js paints the wound into her crust (`crustWoundRec` / `setCrustWoundRec`, uniforms uWound / uWoundN / uWoundD / uWoundS); harpoon.js `H.oldW`, `oldWoundGeo` (torn lip and barb), the cold glint, `heal()` at the end of the dig-in; game.js `wardsLine` "FIND THE OLD WOUND IN THE ROCK" while she is buried.
- Rejected / not done: a frayed line trailing from the wound to the sand (offered; Michael kept it as is).
- Acceptance: burial-probe `wound` mode GREEN (RED on 983224c), digin's `wound10` / `woundAnchor` checks pass; stills in ~/sc/.abyssa-wt/shots/oldwound/.
- Known residuals: offbed.wound10 passes by 1 px; the rust weep mostly does not show; Sal's body covers the wound when seen straight on from behind him.

## Log
- 2026-10-31 — built on branch `oldwound` (3d0e759 .. 06d8b17); Michael judged it in his play copy: "the old wound is fine as is". Pending merge.
