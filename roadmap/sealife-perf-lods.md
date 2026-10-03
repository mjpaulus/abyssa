---
title: Sea life detail levels and cost
status: done
tags: perf, creatures, flora
updated: 2026-10-03
---
The new sculpted sea life is heavier in a few spots: the vent shrimp swarm, the sea stars and the zone-0 reef. Give them proper distance versions so the rebuild costs no more than the old procedural life.

## Detail
- Vent shrimp: about +326k triangles near vents, no distance version (`ventlife.js`, `ventSculpt.js`).
- Sea stars: all 40 always draw the full sculpt (`starSculpt.js`).
- Zone-0 reef: about +1 ms over procedural (plantKit LOD and impostor distances).
- Kelp pops out at 130 u instead of fading (`GD_NODITHER`); find a fade that keeps early-Z.
- Acceptance: paired `__gpu` A/B at parity or better in zone 0 reef, zone 1 vents and zone 2; no visible popping at detail-level switches.

## Log
- 2026-10-03 — created from the open items on sea-life-sculpted; work started.
- 2026-10-03 — branch lods (not merged). Plant batches no longer re-upload their draw list every render (2172505). Kelp fades into the fog over 94–130 u with no discard, so early depth testing is kept (5eeefc6). Each kelp level now morphs toward the next before its switch, which roughly halves the 14 u and 40 u pops (a0dd0ba). Vent shrimp have near, body and spindle levels per vent and nothing past 60 u: 449k → 39k triangles in the vent view (2bce0ea). Sea stars get a baked far mesh past 24 u and a fog cull: 111k → 50k triangles (42abd77). Opaque reef species with an impostor drop the dither discard (b1a40ac). Scene pass, sculpted minus procedural, 50 pairs each on a shared GPU, before → after: zone-0 reef −0.10 → −0.02, zone-1 vents +0.08 → −0.07, zone-2 reef +0.12 → −0.11 (all at parity within ±0.17 ms). Zone-0 kelp forest +0.56 → +0.75 (frame +1.45 ± 0.35) is still over: the near kelp level (6–18k triangles a plant inside 14 u) costs about 0.35 ms. Fixing that is a look call (a shorter near range or lighter near fronds).
- 2026-10-03 — merged to main and verified in a fresh tab (zone tour clean, 14 lights, fingerprints unchanged). Reef, vents and zone-2 reef at parity or cheaper than procedural; kelp pop at 130 u gone, 14 u and 40 u switches morph. Open, Michael's call: the zone-0 kelp view is still about +1.45 ms on the full frame, mostly the near kelp level (16 plants within 14 u at 6–18k tris); fixing it means a shorter near range or lighter near fronds, which changes the look.
