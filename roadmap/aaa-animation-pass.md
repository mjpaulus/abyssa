---
title: AAA animation pass
status: wip
tags: quality, animation
updated: 2026-08-26
---
Last of the skill-pack sweeps. Audit verdict: the motion craft is far above baseline (dt-robustness fully clean, phase-integrated beats everywhere, springs stable, fish tails genuinely exploit the new geometry) — the findings are seams BETWEEN systems, not bad motion. Sal's approved gait fenced off throughout.

## Detail
Fix round on branch aaa-anim: (1) the title screen's raft is a dead prop — updateRaft never runs before the early return (frozen flywheel, no exhaust, hull ignoring the animated swell); (2) Sal frog-kicks up the ladder — onLadder is read by nothing → ladderF blend with alternating reach; (3) the calming beat snaps agitation 1→0 in one frame → the thrash now drains out over ~2s; (4) ending flythrough passes a dead boiler room and frozen predators; (5) leviathan half-rate rebuild jitters hide vs wards at close range; (6) lunge fires with zero anticipation → eased coil; (7) drowning = 2.5s half-frozen frame → dignified cut; (8) shark fades by shrinking over 63u → 8u band; (9) octopus flees without a jet — arms now answer; (10) jelly cull hysteresis; (11) raft ride ease → framerate-independent exp form; (12) knife sheath-return one frame early; (13) ending surf-beat eases framerate-independent.
