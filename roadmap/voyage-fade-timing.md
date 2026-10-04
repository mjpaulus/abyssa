---
title: Voyage fade timing
status: next
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

