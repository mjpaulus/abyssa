---
title: Boarding Ladder Rungs Should Show Wear Where Sal Grabs
status: done
tags: raft, davit, detail
updated: 2026-09-01
---
The boarding ladder's rungs are bare iron cylinders with only waterline grime. Add
worn, hand-polished patches where Sal's grip actually lands each climb, so the
ladder reads as used rather than freshly built.

## Detail
The ladder is built by hand in `davit.js` `buildDavit`, in the boarding-ladder block: two side rails plus `RUNGS = 9` rungs, each placed with
`P.put(cyl(...), iron, 0, ry, LZ, 0, 0, Math.PI / 2)` and finished with `wetGrime()`
for the waterline slime band. There is currently no separate "hand wear" treatment —
only the uniform grime pass.

The climb itself is `player.js` `updatePlayer`, in the `player.onLadder` block: holding W in the bulwark-gap zone rises Sal up the rung line at
`CLIMB_RATE` from ladder-foot depth to the deck catch. That logic already knows the
Y range Sal's hands travel through, which is the natural source of "where he grabs."

Open questions for whoever picks this up:
- Wear as authored dulled/polished vertex-color patches at fixed rung heights (cheap,
  static, matches the "weather as boards not as noise" precedent used elsewhere on
  the raft), vs. wear keyed dynamically off climb usage (more true to the prompt but
  adds state to track and persist — likely overkill for a cosmetic detail).
- Recommend starting with the static approach: bake brighter/worn iron patches into
  the rung material in `davit.js`'s per-rung loop, roughly where a climbing hand
  would land relative to rung spacing, using the same `Part`/`weather()` idiom
  (`raft/kit.js`) rather than inventing a new vertex-paint path.

Acceptance criteria: rungs show visible burnished/worn patches distinct from the
grime band, concentrated where a climbing hand would naturally grip; raft draw-call
count budget (~10 static calls) is not increased; verified in-browser at the ladder
in daylight and matched against the "recent No Man's Sky underwater" quality bar.

## Log
- 2026-08-05 — created; captured from user request, not yet scheduled.

## Log
2026-09-01: Shipped in campaign wave 1 (merged 7d7771d design / 5c36aa6 story / 8e5726c audio / eec2480 world). Awaiting Michael's eye.
