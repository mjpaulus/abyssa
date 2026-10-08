---
title: Velkath carries her clutch
status: next
tags: leviathan, design, zone 0
updated: 2026-10-08
---
Real crabs carry thousands of tiny eggs as a spongy mass under the body, not a few big eggs in a nest. Velkath's eggs become a berried clutch under her apron; the rite is prying a clump off a sleeping colossus.

## Detail
- Michael (2026-10-08): "Also, are those really what crab eggs look like?" Answer given: no — a berried female carries thousands of ~0.5 mm eggs as a sponge-like mass clutched under her abdomen (orange when fresh, darkening to brown/grey with visible eyespots as they develop). Ruled: "Clutch under her body".
- Build: remove the nest/3 helmet-sized eggs as the rite object (brood.js); a huge clutch mass of beaded eggs held under her apron while she sleeps on the rift lip; Sal pries a clump off (the [E] take) — the wake trigger; carrying the clump is the "egg out" state for the brood rule (her last ward stays cold until the clump goes back under her); the eggs' look must be reference-true (bead mass, translucent amber -> brown with dark eyespots, attached to setae/pleopod hairs), generated (sculpt pipeline or procedural instancing), lit by Sal's lantern.
- Keep: the old clutch's broken shells / track trail as discoverables can stay re-themed (empty egg casings drifting, a shed carapace) — designer's call.
- Depends on brooderfix (chase/collision/camera) landing first — same files.
- Acceptance: Michael judges the look; the rite plays end to end (take, wake, chase, wards, return, calm) via real input and ?playtest Alt+6.

## Log
- 2026-10-08 — created from Michael's ruling; queued behind brooderfix.
