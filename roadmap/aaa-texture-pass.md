---
title: AAA texture pass
status: wip
tags: quality, textures
updated: 2026-08-25
---
Full texture pass against the threejs-textures skill pack. Audit verdict: engineering is clean (all POT, colorSpace discipline correct, reseed dispose correct, ~15-20 MB budget) — the AAA gap is MISSING textures, not broken ones.

## Detail
Ranked gaps: (1) the raft deck — the game's most-stared-at surface — has zero texture maps; 44 weathered boards read as painted plastic under the 58° sun. (2) Vent chimneys (zone 1's heroes) untextured. (3) Wrecks lack roughness maps (no wet-metal/dry-scab corrosion contrast). (4) Sal's brass is 256px at 2u close-up range. (5) No getMaxAnisotropy anywhere — planks/terrain/footprints blur at the grazing angles they're always seen at. Plus: glow sprite duplicated in ending.js, leviathan hide non-deterministic per arrival.

Fix round on branch aaa-tex: procedural grain/scratch map+rough+normal sets via lib/textures.js (diver.js pipeline; texture = structure, vertex weathering = hue, quiet), one shared 256 noise pair reused across chimneys/props/steel, max-aniso helper, 512 metal maps, roughness derived from existing height canvases.

## Log
2026-08-25: Round shipped, merged to main 17ac658. Deck wood/brass/iron get procedural grain + micro-scratch map/rough/normal sets (grayscale multipliers — palette hues and vertex weathering stay authoritative; grain runs with the boards via BoxGeometry face-UV stretch); chimneys + props share one seeded 256 noise pair; wrecks derive roughness from their height canvases (wet-metal vs dry-scab); helmet brass/copper 256→512 with feature counts rescaled; steel/port share copper detail; getMaxAnisotropy wired everywhere (device 16); footfx prints anisotropic; ending glow dedup; leviathan hide now seeded (stable per site). Texture count +16, 6-voyage soak plateaus (no leak). Verified in-pane at all four hero ranges. Awaiting Michael's eye.
