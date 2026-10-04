---
title: Gale crests over the deck
status: done
tags: water, storm
updated: 2026-10-04
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
- 2026-10-04 — RULED by Michael: "Fix it". Build: first re-check the artefact still occurs with the FFT ocean (world/ocean.js); if it does, fade the screen-space refraction weight by fragment-to-raft proximity on the air side. Moved decision -> next.

- 2026-10-04 — FIXED (branch galecrest). Re-checked on the FFT sea first: the artefact had MOVED. In a full gale the opacity work already zeroes the refraction weight, so crests in front of the hull now read as opaque water; what remained was the sea standing ABOVE THE PLANKS (CPU probe: 21% of gale frames, up to 0.45 u, often the whole deck), drawn as opaque churned sea (gale: the deck vanished, gear floating in black water) or, below opq 1, as the refraction target = the hull cut open at the waterline and open water under it (storm 0.75 frames: the barrels' corner of the deck showed open sea). Fix in water.js: the eye ray beyond each sea fragment is slab-tested against the raft's dry slab (deck + bulwark, raft-local box fed by raft.js setRaftFrame); where it lands, the refraction target is dropped and the raft ALREADY IN THE COLOUR BUFFER (the sea is the first transparent draw) shows through alpha by the water crossed, exp(-sigma d), sigma 0.8..2.4 with churn; sheets over the deck lace white. No pass, no depth texture, no variant. Calm, underwater and the submerged hull from the air: pixel-identical to A/A. See it: weather.set(0.5,1) on deck; A/B __raftCrest(false); mask __sky.dbg(10). Shots: shots/galecrest-*.png.
- 2026-10-04 — Merged to main (af3aec9): raft-slab crest test, water over the deck reads as a wash. Fresh-tab verified. Moved next -> done.
