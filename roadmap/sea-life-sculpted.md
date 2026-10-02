---
title: Sea life sculpted: animals and plants
status: done
tags: creatures, flora, quality
updated: 2026-10-02
---
Michael, 2026-10-02: "there are still sea live plants etc that feel like primitives need better quality".

## Detail
- **Animals (fauna2)**: eight school-fish species on one atlas (herring, red snapper, butterflyfish, needlefish, bigeye scad, pomfret, bristlemouth, hatchetfish) with near and far detail levels. The reef animals (manta, green turtle, honeycomb moray, brown crab, long-spined urchin), the deep animals (anglerfish, gulper, giant isopod, flapjack, vent eelpout, lanternfish), the grey reef shark, and the octopus and squid bodies are sculpted and baked. Motion is kept by writing the existing per-vertex attributes onto the sculpted meshes; there is no skinning. Layout fingerprints are identical and draw counts unchanged. About 19 MB download, about 57 MB GPU textures. A/B with `?fishproc&faunaproc&octproc&sharkproc`, `__school`, `__faunaSculpt`, `pred.sculptOn`.
- **Plants (plants)**: tube sponge, anemone, barrel sponge, tube worms, staghorn, brain coral, table coral, sea fan (an alpha-tested net), glass sponge and crinoid, 3–4 variants each with near and far meshes. Drawn as one batched draw per species with the gardens sway shader (current, push, flinch and plume retraction kept). Placement hashes are identical. About 17 MB download. `?plantproc`, `__plants`.

## Log
- 2026-10-02 — merged fauna2 and plants. Verified on main: console clean, 14 lights, `__safeFailed` empty, fingerprints unchanged.
- Open: jellies (still too bright), vent shrimp and crabs, and the octopus and squid arms are not rebuilt. Kelp, seagrass, sea pens, whip corals and bacterial mats are untouched. Brain coral reads as a printed pattern and table coral is a slab from below. Far detail levels are heavy, so the dense zone-2 reef costs about 1.5–2 ms more. Zone 2 is darker because the old self-glow is gone. School fish read small beyond about 45 u (anatomically right; Michael's call). About 57 ms of one-time micro-texture generation.
