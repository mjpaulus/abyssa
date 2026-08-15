---
title: SAL embodiment — edges, surfaces, strokes
status: wip
tags: sal, player, physics
updated: 2026-08-07
---
Sal doesn't yet believe in what he touches: the raft has no edges, wood and silt get the same walk, and swimming is a glide instead of strokes. Three fixes, one round.

## Detail
Michael's verdicts (2026-08-07): (1) "he can fall off from any side of the raft... enter the water exit the water via the ladder... the boom is in the way of the ladder. He collides with nothing on the raft"; (2) "walking is the same no matter what surface (ice skating on the raft)... at the bottom of the ocean pressure or buoyancy has no effect, walking under water is incredibly difficult"; (3) "swimming... just glides back and forth, this is why propulsion is important."
- EDGES: bulwark containment at the deck footprint (player.js deck block; frame ±4.7, walk lane, ladder bay |x|<1.2 z 4.2-5.9 is THE one gap — the boarding ritual becomes physical). Boom re-rake in raft/davit.js so the climb line is clear. Standing rulings intact: no leash-clamp, HOSE_REQ gating untouched.
- SURFACES: deck walk grips (high friction, stride locked to travel, fast stop — kills the skate); seabed walk is pressed (drag per step, buoyancy trims effective weight via player.buoy, slower ramp). Top speed unchanged — ponderous stays, per the old ruling; it becomes LEGIBLE.
- STROKES: swim thrust pulses on the frog kick (impulse on kick, coast between, one clock shared with diver.js swimP so the visible kick IS the push); banked turns; weak sculls for back/strafe. Thruster remains the speed answer.
- Acceptance: Michael walks the deck edge and is held by the bulwark except at the ladder bay; boards/exits via the ladder with the boom clear; deck walk plants, seabed walk presses; swimming breathes with the stroke. Hose economy, respawn, ending untouched.

## Log
- 2026-08-07 — cut from Michael's three oddities; single agent round on player.js/diver.js/davit.js with hard contracts
