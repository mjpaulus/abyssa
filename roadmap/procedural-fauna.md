---
title: Procedural fauna (animal vocabulary)
status: wip
tags: creatures, geometry, quality
updated: 2026-09-04
---
Michael: 'we need more procedural sea life.' The evaluation also asked for an indifferent giant — every large body in sight is the objective.

## Detail
New src/world/fauna.js with the reference vocabulary (loft/blade/limb/gape/eyes/photophores, part-id vertex animation, 30Hz steering + interpolation, banking): ray, sea turtle, moray in a crevice, reef crabs, sea stars/urchins (zone 0); blind vent fish, flapjack octopus, giant isopods (zone 1); anglerfish with lure, gulper eel, lanternfish shoal with paired running lights (zone 2). Diver + rock avoidance, rest bouts, no new lights, own siteParams('fauna') stream, hidden during the rite.

## Log
2026-09-04: Shipped, merged 19df564 (recovered from a rate-limit interruption — the first agent left 1361 uncommitted lines; a finisher secured, rebased, and completed verification). 11 animals on one shared vocabulary program (loft/blade/limb/gape/eyes/photophores; part-id vertex animation: tail wave, wing wave, leg shuffle, jaw hinge, lure sway, umbrella pulse, rigid flipper), 30 Hz steering + interpolation, banking, rock + diver avoidance, rest bouts. 12 draw calls, ~97k tris worst case, programs flat at 219 across zone cycles + voyages, own fauna seeds in site.js, hidden during the rite, __noFauna A/B. Esca dimmed 2.2→1.6. FPS unmeasured (pane hidden) — delta is +6 calls/+65k tris at the reef. Awaiting Michael's eye.
