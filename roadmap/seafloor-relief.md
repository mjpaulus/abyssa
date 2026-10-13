---
title: Sea-floor relief, home zone 0
status: decision
tags: world, terrain, zone 0, design
updated: 2026-10-13
---
Zone 0's floor is a flat table in a ring wall ("like a big pit"). The design adds uplands and a terraced hollow, with Velkath's lair at the deepest point. The spec is written and waits on Michael's review and two calls.

## Detail
- Michael (2026-10-13): "the sea floor is all one level, like a big pit. Lets make that more dynamic but keep velkaths lair in the deepest part."
- His picks:
  - "Uplands + hollow (Recommended)";
  - "Mostly walkable (Recommended)";
  - home only, with a new home terrain fingerprint.
- Spec: docs/superpowers/specs/2026-10-13-seafloor-relief-design.md (e0be4de). Evidence: docs/reports/2026-10-13-seabed-relief-audit.md and the node replica ~/sc/.abyssa-wt/reviews/seabed-relief-tool/ (levers.mjs, levers2.mjs).
- Decisions in the spec:
  - home gets its own shape and wrecks rows (ZP[0] untouched);
  - the hollow is keyed to riftPos(0), applied after the knee, varies with bearing (not a lathe), and has a relative apron;
  - 2-3 wandering terraces;
  - the skiff's search is fenced >= 100 u from riftPos(0), so Velkath always takes her designed raft-side station;
  - the throat keeps its floor depth.
- REJECTED:
  - an erosion heightmap (changes collision and placement);
  - a round bowl (a smaller pit);
  - keying the hollow to bedAt() (circular).
- Acceptance (a ruling looks like): Michael approves the spec or asks for changes. He also rules on the two calls:
  - the throat ~40 u deep below its lip instead of ~73;
  - the hollow reads darker and somewhat murkier.
  Then a plan is written (writing-plans) and the work is built.
- Hazards:
  - every downstream layout reshuffles;
  - the descent trigger, hose reach, ending and fissure probes all re-derive;
  - the drawn mesh must match terrainH at risers (S6).

## Log
- 2026-10-13 — Spec written and committed (e0be4de); waiting on Michael's review.
