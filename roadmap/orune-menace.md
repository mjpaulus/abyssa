---
title: Orune, menacing
status: wip
tags: leviathan, creatures, encounter, audio, shaders
updated: 2026-10-03
---
Michael: "the octopus also needs to feel more menacing". Orune now lets you feel her before she moves, wakes slowly and covers you, and hunts like an octopus. Every new threat has a tell you can see and hear. Branch `orune`, not merged.

## Detail
Research notes and the threat → tell table: docs/superpowers/specs/orune-menace.md (Scheel 2016 dark-means-aggression, deimatic displays, papillae, web-over hunting, the Jaws rule, the Subnautica Reaper's sound-before-sight, Dredge's murk).

**Levers** (all in `sleeper/hoarder.js` unless noted; one program for her skin, `uMen` = papillae / dark / deimatic / web, `uTell[1+arm]` = per-arm tell):
- PRESENCE, asleep: `L.aware` (distance to the lamp and head) raises papillae; the hoard HUSHES and breathes with her (`hoard.js` `H.hush`, lantern glows, glass and the coil pool lights x0.45 near the lamp); arms out of the camera's view RESETTLE 1.8-4 u nearer him (≤8 u, never within 7 u of him, silt puff + `oruneDrag`); the near lid cracks (0.34) and the bar pupil tracks him, and it SNAPS SHUT when he looks straight at it (re-opens 4-7 s after he looks away).
- REVEAL: rise 4 s → 6.5 s; 8.5 s web-over (the arms come up over him and down round him at 11 → 8 u, no lash for its length); deimatic flash at 4.2 s as the eyes come open; the web flares; the web lanterns still kindle as her only light.
- SILHOUETTE: she LOOMS (body +0.32 R and reared 0.16 rad when he is inside her reach; +0.40 rad rear with a held diver), mantle inflates 7%, the web flares out 0.30 / up 0.10 and the arm roots ride it; idle arms are low and wide (0.66 of length, tips just off the silt) instead of curled up; papilla horns (vertex-displaced, sparse, dorsal) + a fine papilla field (derivative bump) + a horn over each eye; darkened, counter-shaded skin (arm oral faces darken too); bar pupil blows round in the hunt; a working BEAK (two swept horn mandibles, everts and snaps about once a second while he is held).
- BEHAVIOUR: two PROBING arms test the silt toward him (one from behind the camera), silt puffs and sucker pops; THE FREEZE (half of all lashes: 1.2-2.2 s, breath held, writhe off, skin black, pupils round, the bed silent) then the AMBUSH (faster strike, w 9 vs 7); every lash COCKS first and the arm BLANCHES in racing bands (0.45 s; 0.6 s when it comes from out of view); a flinched arm sends her CIRCLING round the light (3.2 s, 7 s cooldown) and the next lash comes from where he isn't looking; INK when the lantern is held into two arms ~1.2 s (siphon swell + sub exhale 0.9 s first; `deployInk` ×2; game.js `inkBlind` dims the lantern up to 60% for 2.5 s; arms ignore the light 3 s; no lash for 2.5 s; 22 s cooldown).
- SOUND (`audio/creatures.js`, read-only on her edge counters): a low wet churn riding her body (with arm speed), the drag of a resettling arm, sucker pops near a probe, the cock's inhale, the slither on the STRIKE (was on the cock), freeze silence (`amb` duck + score silence), beak clicks, a 31→23 Hz sub under the big exhale.

**Contracts kept**: lamp take wakes her (real E), knife frees (real RT pad path → `doSlash` → `lev.onSlash`), arms flinch from light, sonar (real T) rings the sucker-face wards, all four lit → calm → lighthouse, ev events, collR 6.06 unchanged, grab ≤ 5 s, lights 14, `__lev.fp` 15ce888c / c938fe6e / 652d0412, procedural fallback (`__noSculpt`) renders, memory flat across 3 zone swaps (287 geo / 346 tex), zero per-frame allocation in her update.

**Acceptance (measured, scripted real input, 60 s hunt standing 20 u off her, cutting at 1.6 s)**: 11 lashes, 6 grabs, 4 freezes, 0 dress tears (main: 15 grabs/60 s, 0 tears). Two fixes came out of measuring: she stands taller, so the flinch test now spans the arm's inner 60% (the inner quarter rode over his head and stopped answering the light), and a thrown arm is committed; the grab drag stops short of her contact shell (it was tearing the dress, 2 in 30 s).

**GPU** (paired visible/hidden toggles, shared machine, noisy): her cost in a close awake frame ~2-3.5 ms vs ~0.2-0.5 ms on main, mostly coverage (her arms now reach across the frame); the fine papillae alone ~0.6 ms median (`lev.noPap` A/B). Needs a quiet-machine re-measure.

**Open**: the beak only reads from low and close (it is under her web, behind arms); ink clouds are predators.js's small puffs, not a wall of ink; the arms' pale oral faces still read in close lantern light; the reveal from the lamp is seen across the trawler.

## Log
- 2026-10-03 — wip on branch `orune` (23270eb, 17cb6e1, 88fb9ce): research, presence, reveal, silhouette, hunting, sound, fairness fixes. Verified with real E / T / RT / W input; fingerprints and light count held.
