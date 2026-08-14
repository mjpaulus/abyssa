---
title: SAL — the diver deserves better
status: wip
tags: sal, character, animation
updated: 2026-08-07
---
Sal's limbs read as tubes and his movement is stiff. A two-pass quality round: sculpt the suit like canvas over a man, then make the man move like one — all generated, per the hard rule.

## Detail
Michael's verdict: "Limbs feel very tubular not very human like, movements are stiff." Bar: as high as possible, all procedural (`entities/diver.js`, ~40k tris, Part/bake merged, curve-keyed gait).
Key insight for the sculpt: a Mark V diver is a man inside BAGGY CANVAS — human-ness comes from suit behavior, not bare anatomy: girth that swells and tapers (shoulder>elbow>wrist, thigh>knee>calf>ankle), fold/bunch rings at elbows/knees/groin, the twill pulling taut across shoulders and ballooning at the torso, laced gauntlet cuffs, weighted boots with real toe/heel form. Lathe profiles per limb segment, not cylinders.
Motion pass: overlapping action (hips lead, shoulders counter, wrists/ankles trail), weight — heel-strike compression and hip drop in the gait, breathing at idle, drag-lagged arms in the swim, eased starts/stops instead of velocity-keyed poses. The suit's spring secondary motion exists; the skeleton's timing is what is stiff.
Includes the GENERATED Mark V helmet upgrade (bonnet, faceplates with real bezels, wing nuts) replacing the external-glb plan.
- Acceptance: Michael judges Sal at the dressing station and in motion (walk, swim, ladder, knife) — "human in a suit," not "tubes." Perf: stays ~40-55k tris, same draw calls, gait/stepCount/slash timing contracts unbroken (game.js pendingSlash at t=0.22s, footsteps on heel strike).

## Log
- 2026-08-07 — cut from Michael's verdict + the all-generated hard rule; sculpt pass first
- 2026-08-07 — Michael: "when he is standing on the raft he is bobbing up and down like he is in the water." Diagnosed for the motion pass: (1) idle pose is the AQUATIC sway/bob sine set even on planks — deck idle must be terrestrial (planted, weight-shifts, shoulder breathing); (2) pos.y eases toward the live deckY at 10/s and the camera at 8/s — out-of-phase with the swell; on deck the follow should be RIGID (you move with the boat); (3) swim->walk blend (gb, 4.5/s) leaks swim bob just after boarding. Probes: player.pos.y vs raft.position.y phase, gb settle time
