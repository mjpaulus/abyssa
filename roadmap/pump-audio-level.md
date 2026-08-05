---
title: Pump audio level
status: eye
tags: audio
updated: 2026-08-05
---
The synth engine thump is deliberately shy. Does it carry on your speakers?

## Detail
`src/audio.js` setPump: ceiling ~0.08 dry-equivalent at point-blank. Raise the 0.30 in pumpBus's ramp if it hides.
The fuel-out die-down is the load-bearing moment: rate stretches naturally, no linear fade.

## Log
- 2026-08-05 — created at pump-audio ship; never heard by anyone yet
