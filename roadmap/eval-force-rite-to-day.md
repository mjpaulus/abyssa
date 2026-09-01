---
title: Force the rite to day
status: next
tags: ending, weather, eval
updated: 2026-09-01
---
From the 2026-09-01 design evaluation (ABYSSA Soundings). Effort: S.

## Detail
PROBLEM: Observed: the rite triggered at night → the 75s ascent is a dark screen with a lantern for ~50s. 'One light returns' needs the light to exist. The ending is weather-dependent and startEnding does not force day.

CHANGE: In startEnding, scrub weather toward late morning during the 6.5s STILL beat (it exists precisely to hide a cut). Keep the sky's own drama — a clearing storm is fine, night is not.
