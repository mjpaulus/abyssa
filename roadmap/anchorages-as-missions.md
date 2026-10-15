---
title: The other anchorages as missions
status: backlog
tags: chart, design, user
updated: 2026-10-15
---
Michael pictures the other anchorages as different missions, each feeling unique. Parked for now: the focus is getting home right first. Until then they stay in the game and must keep working, but get no new tuning or polish.

## Detail
- **Michael, 2026-10-15:**
  - "what is the point of having different anchorages?"
  - Then: "I guess, would want to ignore the other anchorages for now. I guess I was originally thinking of them as different missions. So each should feel unique in a way but we should focus on getting one right now."
- **What they are today:**
  - Pallid Bank, the Burned Ground, and the hidden Unsounded Shelf (found by a sonar ping from zone 2) are places the raft sails to from the chart table (THE CHART: `world/site.js`, `ui/chartOverlay.js`).
  - Each has its own water, light, seabed shape, vents and wrecks (fly-remote-sites, "Give each its own water").
  - Each holds the same three sleepers, tuned harder, with their own title lines (`site.js` `epithet`, `sleepers[i].hard`).
  - Their wrecks hold the previous owner's keepsakes, one line each (wrecks.js; the shelf by the chart table).
  - Nothing in the main path sends the player there; the full ending plays once, wherever the first triple calm happens.
- **Decided while parked:**
  - Home-only work (the relief, the buried rock, the camera) is built and judged at home.
  - The other anchorages are only kept from breaking: the probes that already cover them keep running (relief-load `voyage`, harpoon-probe `remote`, fissure-probe at their sites, the fingerprints Pallid b1c58f8d / Burned d2b6fb68 / Shelf e5a8d9bf).
  - The ending's Velkath pass stays as built at every anchorage (seafloor relief final review I1; she passes his eye level mid-pass at all four).
- **Not designed yet:**
  - What a "mission" is.
  - What makes each anchorage unique (its own creature instead of Velkath, its own goal, the previous owner's trail).
  - Whether finishing one leads to the next.
- **Acceptance (for leaving the backlog):** Michael says home is right and opens the design; it then gets a brainstorm and a spec.

## Log
- 2026-10-15 — created from Michael's words after he asked what the anchorages are for; parked until home is right.
