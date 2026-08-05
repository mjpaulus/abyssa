---
title: Gale crests over the deck
status: decision
tags: water, storm
updated: 2026-08-05
---
In a full gale, wave crests overlapping the raft show refracted water, not the deck behind them.

## Detail
Inherent screen-space refraction limit: geometry above water is not in the underwater target.
Reads as sea washing the deck — defensible in a storm, but judge in motion.
Distortion already hard-clamped at 0.035 NDC (unbounded it ghosted a phantom davit leg).
If unacceptable: fade `uRefrK` by fragment-to-raft proximity on the air side, at the cost of transparency right at the hull.

- Acceptance: Michael watches a full gale from the deck and rules acceptable-as-sea-washing or fix-by-proximity-fade.

## Log
- 2026-08-05 — created at refraction ship (53376e8)
