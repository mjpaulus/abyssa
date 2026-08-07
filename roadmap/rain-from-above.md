---
title: Rain from above
status: done
tags: water, storm
updated: 2026-08-07
---
The air-side rain lattice read as stamped circles and was muted; needs a stochastic splash field.

## Detail
The from-below rain lens is fine and untouched. Air side needs non-lattice splash placement — a separate small system.

- Acceptance: Storm rain from the deck reads as stochastic splashes, no visible lattice, from eye height and from above.

## Log
- 2026-08-05 — carried from the sky round
- 2026-08-07 — picked as next after the SKY & WIND round (Michael: "ok rain next"); agent launched
- 2026-08-07 — built: air-side lattice replaced with a stochastic splash field (centre jitter + dead cells + per-cell beat, two lattices, the fine one rotated); new `src/world/rain.js` falling streaks (one instanced draw call, wind-slanted, surface-anchored). GLASS.rain added. Awaiting orchestrator review.
- 2026-08-07 — shipped: lattice broken (jittered strike centers, 34% dead cells, per-cell beat, two rotated scales — same sample count as before; the old air side was actually muted to ZERO, so deck rain is new, not fixed) + world/rain.js falling streaks (420 quads, one draw call, camera-anchored cylinder, surface-anchored floor, slant = eased wind, gusts swing slant 27%, calm = one compare). Found and fixed: rain leaked into the refraction pass through a ShaderMaterial ignoring clip planes — it rained underwater in the transmitted scene
