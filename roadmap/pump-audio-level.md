---
title: Pump audio level
status: done
tags: audio
updated: 2026-10-04
---
The synth engine thump is deliberately shy. Does it carry on your speakers?

## Detail
`src/audio.js` setPump: ceiling ~0.08 dry-equivalent at point-blank. Raise the 0.30 in pumpBus's ramp if it hides.
The fuel-out die-down is the load-bearing moment: rate stretches naturally, no linear fade.

- Acceptance: Michael stands by the pump and dives once with sound on; the pumpBus ceiling moves or stays.

## Log
- 2026-08-05 — created at pump-audio ship; never heard by anyone yet
- 2026-10-04 — RULED by Michael: "Fold into one listen". Card was stale (pre audio rebuild; the pump is now spatial in audio/bed.js pumpBus). Its check folds into one pass through docs/audio.md, tracked on audio-audit. Moved decision -> done.

