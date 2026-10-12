---
title: The fissure and the harpoon
status: wip
tags: world, leviathan, zone 0, design, sal
updated: 2026-10-11
---
Each zone's rift is now a carved crack in the seabed, choked by rubble Sal can stand on, that pours open with a cold pale light when the zone's sleeper is calmed. Velkath wakes when Sal pulls an old harpoon from her side (her clutch stays, the brood rule is gone), and the harpoon then becomes his blade.

## Detail
- Michael (2026-10-10): "so lets design the rift so its more realistic. Glowing when it opens makes sense, like a portal. Also maybe taking Velkath's eggs isnt the thing that wakes her. They are hard to get to." Brainstorm rulings: a fissure in the seabed (not a blue hole); the deep's own pale light; an old harpoon in her shell; clutch stays, rule goes; a longer, harder thrust; carve it into the seabed. Spec docs/superpowers/specs/2026-10-10-fissure-and-harpoon-design.md, plan docs/superpowers/plans/2026-10-10-fissure-and-harpoon.md; built subagent-driven on branch `fissure` (ledger .superpowers/sdd/2026-10-10-fissure-and-harpoon/progress.md, git-ignored).
- REJECTED: a round blue hole; "the sleeper is the seal"; a warm/neon portal glow; keeping the eggs as the trigger; pre-opening a fissure on a remembered revisit (Michael's "Ritual, remembered" — the water does not remember: a revisit is shut until she is calmed again this visit).
- Levers: `world/fissureShape.js` (FISSURE frames, fissureDist, inThroat, the jam floor grid, clearOfCrack), `world/terrain.js` (carving, the dense patch, strata walls, jamAt/shutFloorY), `world/fissure.js` (jam, seep, opening, open state k), `world/rifts.js` (the open light), game.js `visitCalm` / `syncFissureRecord`, `entities/sleeper/lair.js` (Velkath alongside her crack), `entities/sleeper/harpoon.js` + `lib/harpoonModel.js` / `harpoonSculpt.js` (assets/harpoon, Blender-baked, procedural fallback), game.js `BLADE` (knife 0.22/3.4, harpoon 0.30/5.5), playtest Alt+6 (at the harpoon/wound), Alt+= (grant/revoke the harpoon). Dev: `__fissure`, `__bladeLast`.
- Verification: tools/bench/fissure-probe.mjs (gating modes incl. opening, calm-open, reascend, open-persist, below-dark, walls-inside, clearance, velkath-crack, ending), harpoon-probe.mjs (routes, rite, remote, lodged, abort, thrust-contact, orune-cut, orune-parry, shark-thrust), riteplay.mjs. Invariants: 14 lights; __lev.fp 15ce888c / c938fe6e / 652d0412; terrain fp home 3b526986, zones 1+2 d49d451d, Pallid b1c58f8d, Burned d2b6fb68. Cost vs main (ABBA): z0 +0.21, z0b +0.10, z1 +0.05 ms (noise floor). Played + recorded: docs/playtests/2026-10-10-fissure-harpoon.md (six videos in ~/sc/.abyssa-wt/video/fh-*.webm).
- Acceptance (done when): the branch is merged with the final review's fixes; Michael's playtest of the items below is his to log.
- For Michael's eye/feel: Velkath may now be too soft (calm < 21 s, 0 hits, perfect and average); the day surface glow is a fleck by day; a faint pink-lavender lean on the far wall from a low lens at the home lip, slight teal at home/Shelf in other views; zone 1's throat walls plain (WALL_LOOK[1]); the thrust reads through the body/lantern/puff/lens punch more than the iron; Velkath on the far side of her crack from the raft at home (one lair.bear row to change).
- Hazards: colour work must be judged on SETTLED frames (`__bench.capture({settle})`); `__bench.step()` without render keeps a stale grade.

## Log
- 2026-10-11 — built on branch fissure (Tasks 1-7 + 5b, each reviewed; final whole-branch review: 0 Critical, 2 Important fixed in the final wave); played and recorded.
