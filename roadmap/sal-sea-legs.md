---
title: Sal's sea legs — standing on a rolling deck
status: done
tags: diver, motion, raft
updated: 2026-10-05
---
On the raft Sal ignored the boat: he stood rock-still on an imaginary flat floor while the deck rolled, so his boots sank through the planks or hung in the air, and the raft slid about under him. This makes him ride the boat like a man in 90 kg of dress would: boots on the planks, carried with the deck, braced wider and lower as the sea gets up, swaying and catching himself in a gale.

## Detail
Reference first: docs/superpowers/specs/sal-sea-legs.md (sea legs research, the naval motion-induced-interruption model, the Mark V on a tender). Files: src/player.js (tilted deck floor, carried in the raft's frame, balance excursion), src/entities/diver.js (deck-plane ground under each boot, raft-local anchors, sea-legs posture), src/game.js (frame order, deck spawn, stagger hook, camera roll knob).
Acceptance:
- A planted boot never goes through the planks and never floats: foot-to-plank gap measured per frame over 60 s of a gale (target 0 +-1 cm, max 2 cm).
- Standing still he moves with the deck (heave, surge, roll about the raft centre); drift relative to the deck about 0 (gale: small corrective steps that come back).
- Upright to gravity: on a rolled deck the uphill knee bends more and the downhill leg extends; the torso and helmet counter-lean late and heavy, with no wobble.
- Stance widens and knees soften with the sea; arms come out in a gale; occasional corrective shuffle or stagger in a gale only. Heave loads and unweights the knees.
- Walking on a rolling deck is slower and wider, with a down-slope lurch.
- Camera stays grounded; any deck roll in the lens is a tiny damped knob.
- Nothing broken: ladder on/off, stepping off the side, deck collisions, deck camera, chart table, voyage, drowning rescue, title screen, salfix leg IK, leash stagger.

## Log
- 2026-10-04 — Michael: "when sal is standing on the raft, he doesnt move with it. He is completely stable and his feet go through the raft. that is not what it is like to stand on a rocky boat." Started on branch `sealegs`. Baseline measured in a gale: planted boots -26 cm through to +25 cm above the planks, drift vs deck up to 0.53 u; raft roll p95 4.4 deg, pitch 1.8 deg, heave range 2.2 u.
- 2026-10-04 — SHIPPED on branch `sealegs` (reference note docs/superpowers/specs/sal-sea-legs.md). The deck floor is now the raft's tilted plane, the raft moves before Sal and carries him in its frame (heave, surge, pitch, roll), and planted boots keep raft-local anchors. Measured, gale 3 min standing: boot-to-plank gap -0.1..+0.3 cm (was -26..+25), his spot never drifts on the deck (was up to 0.53 u). He stands upright to gravity: the knee difference tracks the deck's side tilt (r 0.76, ~4.7 deg of knee per deg of tilt), the trunk-and-bonnet unit leans late against his sway (median 1 deg, max 2.6, no wobble), knees soften (22 deg vs 12) and the stance widens as the storm rises, arms come a little out, the heave loads and unweights the knees, a gale costs ~3 corrective shuffle steps a minute and a rare stagger (diverYank). Walking a rolling deck is slower with a down-slope lurch. The lens takes a twelfth of the deck roll (`__deckcam.knobs.roll`, 0 = level). Also fixed on the same branch (orchestrator: "His walk is still odd when turning left or right, he looks twisted"): walking turns no longer wring the corselet round on the hips (thorax-on-pelvis twist in walking turns median 26 -> 7 deg, A/D crabbing max 66 -> 15; knobs `__turn`). See it: start a dive, `weather.set(0.5, 1)` for a gale, stand on deck and watch the boots and knees from the front; walk the deck; compare `__sea.on = 0` / `__sealegs.on = 0`. Frames: shots/sealegs-*.png.
- 2026-10-05 — Merged to main (5ce569c), fresh-tab verified (14 lights, fingerprints, console clean). Open question for Michael: the raft itself only rolls ~5 deg in a gale; more roll is a raft.js updateRaft change. Moved wip -> done.
