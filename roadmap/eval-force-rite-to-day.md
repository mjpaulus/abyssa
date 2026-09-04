---
title: Force the rite to day
status: done
tags: ending, weather, eval
updated: 2026-09-01
---
From the 2026-09-01 design evaluation (ABYSSA Soundings). Effort: S.

## Detail
PROBLEM: Observed: the rite triggered at night → the 75s ascent is a dark screen with a lantern for ~50s. 'One light returns' needs the light to exist. The ending is weather-dependent and startEnding does not force day.

CHANGE: In startEnding, scrub weather toward late morning during the 6.5s STILL beat (it exists precisely to hide a cut). Keep the sky's own drama — a clearing storm is fine, night is not.

## Log
2026-09-01: Shipped in campaign wave 1 (merged 7d7771d design / 5c36aa6 story / 8e5726c audio / eec2480 world). Awaiting Michael's eye.
