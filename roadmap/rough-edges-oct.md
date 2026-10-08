---
title: October rough edges sweep
status: wip
tags: polish, bugs, motion, look, perf
updated: 2026-10-08
---
Known weaknesses reported by the agents that shipped sea legs, the rockier raft, the air pack, the site pass, the far ridge and DRS. Each is reproduced and measured first, fixed at its root, and checked again with before/after numbers and frames.

## Detail
1. Walk start on a rolled deck: in a gale the first frames of a walk start can lift the downhill planted boot up to ~9 cm for ~0.25 s. Target: boot-to-plank 1-2 cm or less through walk starts and stops at any roll.
2. Ladder step-off: the first 3 frames after stepping onto the deck from the ladder show a 12 cm boot gap. Target: no visible pop.
3. Burst pose: during the air-pack burst Sal stays upright. He should lean into the thrust (level bursts 45-70 deg pitch, head up; upward bursts vertical; sideways bursts bank), heavy damped transitions, arms braced back, legs trailing, and come back smoothly.
4. Pallid Bank plants: per-site flora/garden/plant-kit tint via uniforms (bleached at Pallid, scorched/ashen at Burned; home bit-identical; no recompile on a voyage).
5. Marine-snow dither: a visible stipple in mid-water at every site. Find the pass, make mid-water smooth without losing the snow.
6. Far-ridge crest line: the ridge drape can read as a bright horizontal stripe in mid-water views. Soften its top edge and fade it with view angle/distance.
7. Deck frames after the click: scattered 33-50 ms frames for ~5 s after title -> play while DRS steps down. Measure the deck's real cost per scale on the bench host; start DRS where the deck holds 60.
8. Camera on the raft's heave: judge whether the deck camera riding Sal's heave reads as bobbing; consider a tight low-pass on the deck only, as a knob.

## Log
- 2026-10-08 — created; work started on branch `sweep`.
