---
title: AAA pass 3: TAA, sculpted sleepers, audio, encounters
status: done
tags: quality, rendering, creatures, audio, lighting, perf
updated: 2026-09-30
---
Michael, 2026-09-30: "proceed...please note, we have the power to do anything. Please be braver." Then: "also I have blender installed now if that helps."
Seven Opus agents in parallel worktrees, merged serially and verified on main after each merge.

## Detail
- **TAA + temporal upscaling** (`postfx.taa.js`, `core.js`, `postfx.js`): 16-phase Halton jitter, closest-depth reprojection, Catmull-Rom history, YCoCg variance clip, disocclusion fill, RCAS sharpen. Exact motion vectors for Sal and the raft (`addTemporalMover`). DRS now moves only the INTERNAL resolution (floor 0.75); output stays at native. Texture mip bias follows the ratio. Shimmer down 55–70% on helmet, sand and wreck. `__taa`.
- **Sculpt pipeline** (`src/lib/sculpt.js`, `tools/blender/`): SDF creatures meshed by dual contouring in node (about 2M tris high), painted per vertex, decimated and charted in JS. Headless Blender 5.2 repacks the UVs, bakes normal, AO, albedo, roughness and cavity/emit through a cage with Cycles, and exports Draco glb with KTX2 (own BC1/BC5 encoder) and WebP maps. `node tools/blender/build.mjs <creature>`. Loaded by `lib/assets.js loadSculpted`, which never throws, so a procedural fallback is always kept.
- **Velkath** (`brooderSculpt.js`): fused faceted shell, about 50 shale plates, broken V prow, healed breaks, knobbed crusher, fanged hook claw, spined legs, stalked eyes that track Sal in saccades. Pass 2: shared `lib/microDetail.js` (tileable grit masked by the baked cavity), layered maxillipeds and mandibles, dark glass corneas with a moving glint, sponge bores fixed, a sawtooth keel crest asleep, Draco + KTX2 (GPU texture memory 96 → 27 MB).
- **Orune and Mhor** (`hoarderSculpt.js`, `hunterSculpt.js`): baked mantles (web, beak, chain and net scars, heavy lids; armour bands, keel, eye orbits, hook clubs, photophore rows). The arms and tentacles stay procedural and take the sculpted detail from tileable strips keyed to the sucker stations. Fixed an old NaN bug that left 25 of Orune's 36 suckers per arm unplaced. ORM.B is emit for these two and cavity for Velkath; the meta `ormB` records which.
- **Encounter lighting** (`common.js`, `hoarder.js`, `hoard.js`, `hunter.js`, `water.js`, `vents.js`): no lights added. The ward pool of five is staged per creature. Orune is lit by her hoard: coil lanterns and a heap backlight in her lee go out in the rite as the lanterns in her web kindle. Mhor has about 150 crisp lens photophores (one Points draw) and carries a cold key that holds lamp in-scatter slot B. Sigil wards (`L.sigilStyle`). The furnace borrows the vent throat light. Blue specks and Orune's swallowing grab coil are fixed.
- **Audio** (`src/audio/`): rebuilt, all synthesised. Five groups with ducking, a water filter that deepens with depth, helmet acoustics for Sal, four generated reverbs, 3D placement. Per-zone beds, a voice for each sleeper, and a sparse adaptive score. Listening guide in `docs/audio.md`.
- **Leftovers**: real backward walk; strafe slash turns into the cut; Mhor's white fin was his glow; Orune's resting arms drape; zone-2 kelp has structure and is no longer self-lit; Sal's chest and helmet occlude the lantern in-scatter; fish and octopus gaze; shark gape; bubble and sea-pen artefacts.

## Log
- 2026-09-30 — merged audio (637b4bc), taa (f750b6e), fixes (7b9b5d7), sculpt (merge before cbc6999), sculpt2, brooder2 (2ca26c3; ORM.B conflict resolved per set), encounter (06292bf). Each verified on main in a fresh tab: console clean, 14 lights, `__safeFailed` empty, sleeper fingerprints 15ce888c / c938fe6e / 652d0412.
- 2026-09-30 — GPU on a quiet machine (no agents running, driven loop, full 1.5x internal resolution): zone 0 12.4 ms, zone 1 10.6 ms, zone 2 14.5 ms, against a 16.7 ms slot.
- Open for Michael: the FIRST LISTEN (headphones, `docs/audio.md`); whether 0.75x internal under load looks soft; Mhor mid-hunt is still mostly a constellation and a halo; Velkath has no motivated light of her own; the rift-mote halos (`rifts.js`, 22 u sprites in 0x4fffb0) read as neon; the walk-start foot slide; the healed-scar patch on Velkath reads snowy.
