---
title: SKY & WIND — clouds, fog, moon
status: next
tags: sky, water, shaders
updated: 2026-08-05
---
Procedural cumulus that drifts with the wind, marine-layer mornings the sun burns off, real blue noon, storm decks with dark bases, and a big moon with its own glitter path.

## Detail
Builds on the day-hands contract (weather state + GLASS). All in `world/water.js` sky dome (uCloud stub exists) + an air-side fog regime + `lighting.js` night.
- FBM cumulus: coverage/thickness from the day's hand, drift from wind; sun-lit edges by day, ember undersides at the sunset stop.
- Marine layer: air visibility drops to a few hundred units at a foggy dawn, sun a pale disc, thins from above past the burn-off elevation. UNDERWATER OPTICS UNTOUCHED.
- Noon stop goes real blue (Michael's ruling: shipped noon was flat).
- Moon: disc size/brightness/phase from the hand, moon glitter path, lifted full-moon night ambience.
- Sunset drama: leftover broken cloud catches the ember stops — post-storm sunsets go big, clear days stay modest.
- Acceptance: a foggy dawn burns off on scrub; a post-storm sunset visibly outdrames a clear one; big moon reads at night; calm-noon regression anchored except the sanctioned blue.

## Log
- 2026-08-05 — cut from the west-coast round; waits on day hands
