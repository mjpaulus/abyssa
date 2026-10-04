---
title: Voyage fade timing
status: done
tags: chart
updated: 2026-10-04
---
2s fade out, 2.3s at black (reseed), 1.6s return. Judged only by feel, in real time.

## Detail
Constants live in game.js voyage block (`voyageT` thresholds 2 / 2.3 / 4.6 / 6.2).
Sound is currently chain slam at weigh-anchor + bell on arrival.

- Acceptance: Michael sails once at real speed and rules on the three thresholds; retune is minutes.

## Log
- 2026-08-05 — created at phase 4 ship (de2aacc)
- 2026-10-04 — RULED by Michael: "Inked chart passage". Build: replace the hold-at-black with the paper chart (ui/chartOverlay.js look) filling the screen while the course inks itself from the departure site to the destination; the reseed runs under it; bell on arrival as the line reaches the mark; fade from chart to the new water. Same total budget (~6 s), and the ink must not stall during the reseed (pre-start the stroke or drive it from wall time). Moved decision -> next.

- 2026-10-04 — SHIPPED on branch voyage (fe87024): the inked chart passage. The sea fades as the chart comes up under a lamp; the course is ruled in ink across it in three legs (wobble, pools, dry-pen thinning, DR ticks, fixes dated 4 BELLS / 8 BELLS), the raft's pencil mark riding it; the bell rings as the nib touches the mark, the name is lettered in, the chart dissolves into the new water. Nib scratch synthesized (audio nib()). Reseed runs in the still beat after the chart is up and before the pen goes down; the beat absorbs the stall and waits to settle. Nominal 5.95 s, 6.1-6.4 s wall measured (one 8.4 s when a reseed stalled 2.7 s). How to see it: on deck, [E] at the chart table, click another anchorage. Dev: __passage.state(), __passage.preview(from, to).
- 2026-10-04 — Merged to main (c7aa70b): inked chart passage. Fresh-tab verified. Moved next -> done.
