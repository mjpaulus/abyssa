---
title: Sea-floor relief, home zone 0
status: wip
tags: world, terrain, zone 0, design
updated: 2026-10-14
---
Zone 0's floor is a flat table in a ring wall ("like a big pit"). It is being rebuilt with uplands and a terraced hollow, with Velkath's lair at the deepest point. Michael approved the spec, the plan and all three calls.

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
- 2026-10-13 — Michael ruled. On the spec: "floor card looks good". After the offline trials amended it (f63542d: additive uplands; the hollow runs under the NE wall; the skiff's bearing window), on call 3 and the plan: "yes, accept the NE wall and build it". Plan docs/superpowers/plans/2026-10-13-seafloor-relief.md (14 tasks) is being built subagent-driven on branch `relief`. Moved decision -> wip.
- 2026-10-14 — Velkath's fight on the new ground: the pre-registered paired campaign (relief Task 8) found average fights 2.5x shorter (24 vs 60 s, p 0.009). Cause: her raft-side bed mirrored her, so the harpoon's opening moved to her other flank. Michael ruled "Turn her around" and "Raise her to match": turned in place at her bed, harpoon seated on her back half (Alt+6 opens at her back-left as shipped), raised 0.55 u at home (ee72957). Re-measured: perfect fights match, her rising shell catches nobody (8/12 -> 0), ward height within 0.1 u; average fights 40 vs 54 s (4/12 vs 7/12 in band). Michael on the remaining gap: "A is good" (accept; the buried-rock work resets her opening and re-measures).
