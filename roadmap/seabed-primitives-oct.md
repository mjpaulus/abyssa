---
title: The seabed's last primitives (primfix)
status: done
tags: quality, props, world, zone 0
updated: 2026-10-13
---
The objects on the zone-0 floor that still read as primitives are replaced: loose stone is now the house rock, half-buried, and her moult, egg skins and prints are real. The skiff carries a real kit, and nothing hovers.

## Detail
- Michael (2026-10-13): "I still see many objects on the ocean floor that look like primatives." He picked "The obvious six (Recommended)" from the audit (~/sc/.abyssa-wt/reviews/primitives-audit.md).
- Decisions:
  - The debris is static house rock (flora.js jamRockKit + rockMapSet), half-buried with silt drifts, laid from its own site stream (seeds.debris).
  - Rapier is removed: its 120 dodecahedra were vestigial and 4-6 fell through the floor every load. systems/physics.js keeps the initPhysics/switchZone contract.
- Levers:
  - systems/physics.js (debris);
  - sleeper/brood.js (the moult, 240 egg skins, prints);
  - sleeper/brooderGeo.js (the muted back reef);
  - world/wrecks.js (the skiff's kit: crates, rope, lead, lantern);
  - world/resources.js (the polymer node pulled out of its boulder).
- Verification:
  - invariants flat;
  - soak flat;
  - first-sight compiles 3 and 1;
  - report docs/reports/2026-10-13-primfix.md;
  - before/after sheet ~/sc/.abyssa-wt/shots/primfix-before-after.png.
- Cost: measured 2026-10-13 by cross-load ABBA (41e8340 vs 0b770d4), within noise at every view (report ~/sc/.abyssa-wt/reviews/primfix-bench.md).
- Open: the prints fade into the ripples past ~15 u.

## Log
- 2026-10-13 — Built on branch primfix; merged to main (0b770d4) and pushed with clawfix. Fresh load clean: 14 lights, fingerprints unchanged, __safeFailed/__shaderFailed [].
- 2026-10-13 — Cost measured by cross-load ABBA, 41e8340 -> 0b770d4, live 1.0x, 6 pairs per view:
  - z0 −0.06, z0r −0.00, z0b −0.07, z1 −0.01, z2 +0.02 ms, against a pooled noise floor of ±0.075: no measurable cost.
  - A second window showed z2 +0.20 ms (unconfirmed by a follow-up) and z1 −0.13 ms (the Rapier step is gone: physics CPU 0.23 -> 0 ms).
  - The machine was only partly quiet (three iOS Simulators booted); 21 of 128 loads were flagged and repeated.
  - Report: ~/sc/.abyssa-wt/reviews/primfix-bench.md.
