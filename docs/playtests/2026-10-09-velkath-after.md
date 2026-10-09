# Velkath rite: before and after the fairness pass (ritefair, 2026-10-09)

This answers Michael's "you should try playing and getting all the wards its so hard" and the
orchestrator's ledger (docs/playtests/2026-10-09-velkath-ledger.md). Branch `ritefair`.
BEFORE means main 7ad6d7d. AFTER means this branch. Both were served from one dev server on
8832: AFTER from the worktree, BEFORE from an archive of main mounted at /_base.

## First finding: the harness itself was part of "so hard"

Two flaws made the fight harder than the game is.

**1. The game never froze her on pause.** In game.js, `updateLeviathan` ran even while
paused, unlike the predators (`PEV_IDLE`). So with the pointer lock off, Velkath kept
hunting and hammering:
- her knock was banked in Sal's velocity;
- the dress tore while nobody was at the keys.

This is a real bug for Michael too: Esc in the middle of the fight. It is fixed here: paused,
she gets `LEV_IDLE`.

**2. The freeze-step harness let the game keep running between moves.**
- `tools/bench/play.mjs` sets `__helm = false` between acts. Sal froze (paused), but she did
  not (bug 1). Every pause to think was free time for her. The orchestrator's three hits in
  80 s were partly this.
- `__bench.step` holds the loop only while it steps. Between CDP calls the page's own rAF
  kept playing real-time frames with whatever keys were down, and every screenshot forced one
  more.

My probes now stop the live rAF loop (`requestAnimationFrame` stubbed) and render every frame
through `__bench.step`. Every number below was taken that way. On main, with the old harness
semantics, 3 of 4 runs took a hit 2.8 s into the take that never happens in a held run.

## How it was played

**Bot, `tools/bench/riteplay.mjs`.** Real CDP keys, freeze-step, one frame rendered per step.
The ledger is booked per frame in the page. Both players play the same way at the start:
- [E] pries the clump;
- he runs off with it for 6 s, so the rite starts against a risen, hunting Velkath (the
  ledger's case);
- then the rite.

The two policies:

| | perfect | average ("sloppy") |
|---|---|---|
| Slice length | 0.25 s | 0.5-1.0 s, decided on the state at slice start |
| Aim | exact | +-20 deg |
| Ward knowledge | every ward's position | only wards it has seen on screen; otherwise "go under her belly" |
| Bursts | held for what the climb needs | held 0.6-1.2 s whatever the need |
| Dodging | rushes under her when she cocks the hammer | none |

Fixed seeds, but the game itself rolls Math.random (her strafe, her shift), so a seed does not
repeat exactly.

**Manual (me), `tools/bench/play.mjs`.** Perfect reaction, reading the per-move state and
frames. The live loop was stopped on main too, so the comparison is fair.

**Column meanings.**
- hits: tears more than 0.5 s apart.
- tears: every tear.
- dry dips: reserve under 12%.
- bowl falls: entering the rift bowl, defined as floor 15 u under her lair floor.
- max up / float: height over the floor; seconds spent more than 9 u up.
- cam off-frame: share of 4-frame samples (she is awake and within 30 u) where neither her
  belly nor a dark ward is on screen.
- cam pressed: share of the same samples with the lens within 2.6 u of his helmet.

### BEFORE (main), bot
| run | done | calm s | ward lit at (s) | return s | hits | tears | dry dips | min reserve | bowl falls | max up (u) | float >9u (s) | cam: off-frame % | cam: pressed % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home perfect s1 | yes | 19.5 | [15.4, 19.5, 16.7] | 19.5 | 1 | 1 | 0 | 0.7 | 0 | 12.2 | 0.9 | 11 | 67 |
| home perfect s2 | yes | 20.5 | [15.6, 20.5, 16.8] | 20.5 | 0 | 0 | 0 | 0.68 | 0 | 12.6 | 1.3 | 12 | 77 |
| home perfect s3 | yes | 20.3 | [15.6, 20.3, 16.8] | 20.3 | 0 | 0 | 0 | 0.68 | 0 | 12.7 | 1.3 | 13 | 76 |
| home average s1 | yes | 16.9 | [15.4, 16.7, 16.8] | 16.8 | 0 | 0 | 0 | 0.54 | 0 | 14.3 | 1.8 | 5 | 91 |
| home average s2 | yes | 17.1 | [15.2, 17.1, 16.3] | 17.1 | 0 | 0 | 0 | 0.47 | 0 | 12.6 | 3.4 | 13 | 90 |
| home average s3 | yes | 20.4 | [14.9, 17.3, 20.4] | 20.4 | 0 | 0 | 0 | 0.45 | 0 | 6.2 | 0 | 7 | 92 |
| pallid perfect s1 | NO | None | [None, None, None, None] | None | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 99 |
| pallid perfect s2 | NO | None | [None, None, None, None] | None | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 99 |
| pallid perfect s3 | NO | None | [None, None, None, None] | None | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 99 |
| pallid average s1 | NO | None | [14.9, 18.1, None, 16.7] | None | 46 | 46 | 0 | 0.29 | 0 | 29.9 | 183.1 | 7 | 7 |
| pallid average s2 | NO | None | [15.2, 53.3, 16.1, None] | None | 55 | 55 | 0 | 0.47 | 0 | 28.9 | 185.6 | 2 | 10 |
| pallid average s3 | yes | 23.3 | [15, 18.4, 23.3, 17.2] | 23.3 | 1 | 3 | 1 | 0.08 | 0 | 8.1 | 0 | 5 | 83 |

### AFTER (ritefair), bot
| run | done | calm s | ward lit at (s) | return s | hits | tears | dry dips | min reserve | bowl falls | max up (u) | float >9u (s) | cam: off-frame % | cam: pressed % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home perfect s1 | yes | 16.2 | [14.6, 16.1, 16.2] | 16.2 | 0 | 0 | 0 | 0.77 | 0 | 2.8 | 0 | 3 | 50 |
| home perfect s2 | yes | 16.2 | [14.6, 16.1, 16.2] | 16.2 | 0 | 0 | 0 | 0.78 | 0 | 2.5 | 0 | 3 | 53 |
| home perfect s3 | yes | 16 | [14.5, 15.9, 16] | 16 | 0 | 0 | 0 | 0.74 | 0 | 3.4 | 0 | 3 | 29 |
| home average s1 | yes | 24.1 | [15.8, 17.2, 24.1] | 24.1 | 0 | 0 | 0 | 0.71 | 0 | 5 | 0 | 7 | 57 |
| home average s2 | yes | 17.1 | [15, 17.1, 16.2] | 17.1 | 0 | 0 | 0 | 0.47 | 0 | 8.2 | 0 | 13 | 43 |
| home average s3 | yes | 26.3 | [15.8, 19.1, 26.2] | 26.2 | 1 | 1 | 0 | 0.5 | 0 | 15.7 | 2.3 | 3 | 50 |
| pallid perfect s1 | yes | 17.2 | [15.5, 17.2, 17, 16.3] | 17.2 | 0 | 0 | 0 | 0.77 | 0 | 6.6 | 0 | 2 | 62 |
| pallid perfect s2 | yes | 17.2 | [15.6, 17.2, 17, 16.3] | 17.2 | 0 | 0 | 0 | 0.77 | 0 | 6.6 | 0 | 0 | 59 |
| pallid perfect s3 | yes | 17.5 | [15.8, 17.5, 17.3, 16.6] | 17.5 | 0 | 0 | 0 | 0.76 | 0 | 6.7 | 0 | 1 | 57 |
| pallid average s1 | yes | 45.3 | [16.7, 43.4, 45.2, 17.5] | 45.2 | 1 | 1 | 1 | 0 | 0 | 15.6 | 12.9 | 1 | 73 |
| pallid average s2 | yes | 49.7 | [17.1, 49.6, 47.1, 18.2] | 49.6 | 2 | 2 | 2 | 0 | 0 | 19.4 | 10.3 | 1 | 59 |
| pallid average s3 | yes | 18.3 | [16.4, 18.3, 17.6, 16.8] | 18.3 | 0 | 0 | 0 | 0.59 | 0 | 7.7 | 0 | 7 | 55 |

The home and Pallid perfect rows, and Pallid average s3, are from the full rerun at the slick-back commit. Pallid average s1-s2 were re-measured
after the last commit (leg glitch speeds are not kicks). No home row took a hit from it.

### Manual, perfect reaction (play.mjs)

| | BEFORE home | AFTER home | BEFORE Pallid | AFTER Pallid |
|---|---|---|---|---|
| ward 1st | 13 s, but only because a knock threw him past ward 2 | 12.4 s (tap-hop under her face) | 12.3 s (0.4 s burst) | 12.7 s (0.35 s burst) |
| ward 2nd | 36 s | 15.6 s (hop) | 17.5 s | 14.2 s |
| ward 3rd | - | - | 18.5 s; the 4th socket sat inside the egg mass | 17.3 s |
| return / calm | 43 s (needed a hop into the hanging mass) | 21.5 s (hop, [E] at reach 5.0) | 21.7 s | 21 s (she shifted twice; [E] at reach 4.8) |
| hits / tears | 4 hits, ~5 tears (torn reached 44 s) | 0 | 0 | 0 |
| float | rose to 23 u over the floor, then stood on her back; C held 3 s and still rising (vy +0.7) | max ~3 u (hop) | ~4 u | ~6 u |
| bowl | 0 | 0 | 0 | 0 |
| reserve min | 0.81 | 0.91 | 0.77 | 0.87 |
| camera | jammed on his legs / the hanging eggs as he tumbled (see strip) | her face, claws and wards in every frame read; 1 frame had Sal behind her mouthparts | readable | readable (one frame half a rock wall) |

Frames:
- shots/ritefair-manual-home-strip.png
- shots/ritefair-manual-pallid-strip.png
- shots/ritefair-manual/ (AFTER)
- shots/ritefair-manual-before/ (BEFORE)
- shots/ritefair-cam-before-after.png

## Walk-in under her (Michael at 60 fps: "crouched too low and I kept colliding")

Probe: `tools/bench/ritefair-walkin.mjs`. Lane roofs are the lowest part of her over the floor
along a bearing from 1.2 R to 0.5 R. Legs plant at the rim, so a lane can read low where a
foot is; the free arc is the real door.

**Crouched**, unheld, Sal under her centre, at t = 3 s:

| | lane roofs front / right / back / left (u) | wards over the floor (u) | clutch underside (u) |
|---|---|---|---|
| BEFORE home | 7.2 / **0.6** / 6.3 / **1.3** | 9.8 / 6.3 / 12.8 | 4.6 (the old slung mass) |
| AFTER home | 2.2 (a planted leg) / 3.2 / 5.7 / 4.5 | 4.1 / 5.3 / 5.3 | 3.7 |
| BEFORE Pallid | 7.0 / 5.8 / 12.7 / 2.6 | 10.7 / 11.9 / 5.9 / 15.2 | 9.8 |
| AFTER Pallid | 5.1 / 2.9 / 6.8 / 6.4 | 6.0 / 6.5 / 7.3 / 6.5 | 5.9 |

In BEFORE, the 0.6 and 1.3 u readings are the rim on his side dropping 2.4 u from the crouch's
lean while he is still walking in. That is the collision.

**Standing (lab hold)**, free arcs at the rim (1.0 R) on four bearings:

| | home | Pallid |
|---|---|---|
| BEFORE | 25-48 u | 25-48 u |
| AFTER | 30-49 u | 33-49 u |

All four bearings are open, and real-key walk-ins reached under her (< 0.35 R) in 9.5-10.75 s:

| | home | Pallid |
|---|---|---|
| BEFORE | 3/3 (the 4th start was in the rift bowl, no walkable approach) | 4/4 |
| AFTER | 4/4 | 4/4 |

**Hunting** (she turns to face him and hammers), walk-ins under her:

| | home | Pallid |
|---|---|---|
| BEFORE | 2/3 | 3/3 |
| AFTER | 2/4 | 4/4 |

Two home AFTER failures:
- b90 never moved from its start spot (terrain);
- b270 was walled by a leg and took 1 slam (hitV 3.2).

Pallid perfect bot, walking straight at her front: BEFORE stuck at her claws for 200 s in
3 of 3 runs. AFTER the meral spread opens the front, and 3 of 3 completed in about 17 s.

## Decisions (each lever, what was done, why)

**1. Wards reachable.**
- She keeps her centre `STAND.keep` 1.45 R outside the rift's rim crest while she hunts a
  diver on the plateau. The crest is found once per lair along her lair's bearing (home: r 37,
  keep r 59.3; she walks off her ledge about 7 u as she rises). On the crest the crest came up
  under her and her feet, so the wards hung 12-17 u over him.
- She rides at most 0.06 R over the ground under her belly (`STAND.ride`). A foot on a boulder
  had lifted her 3-4 u.
- Standing height is 0.44 R -> 0.52 R. With the threat lift off while he is under her, the
  wards hang 4-6 u over the floor under her at home, 6-7 at Pallid: reachable standing or with
  one tap-hop.
- The crouch is RETIRED (drop and lean 0, knobs kept). Michael's report, plus the measured
  0.6-1.3 u rim, ruled out making it deeper.
- The Pallid/Burned 4th socket was INSIDE the hanging clutch's big lobe (touchable through the
  eggs but never seen). It now sits under the cutter's shoulder (-0.34, -0.117, 0.40).
- Wards stay on HER, on her belly.

**2. Burst vs dress.**
- A burst's dress spill now ramps in over its first 0.12-0.32 s (`JET_TRIM_T0/T1`).
- C held while rising bleeds the climb (`VENT_BRAKE` 2.2/s).
- The open-water feel was measured on the same protocol on both trees:

| | main | branch |
|---|---|---|
| seabed -> surface, two held bursts | 25.1 s | 25.1 s (unchanged) |
| 1 s burst up then C: time until he turns | 1.9 s | 0.8 s |
| ... rise before he turns | 10.5 u | 7.0 u |
| 0.3 s burst: fill / peak | 0.47 / 4.6 u | 0.44 / 4.1 u |

**3. Rift bowl.** Two behaviour changes, no terrain change:
- the hammer's throw never has a component toward the rift while Sal is outside the crest;
- she fights off the lip.

Bowl falls in the fair-harness runs: 0 BEFORE and 0 AFTER. The bowl showed up only in runs
with the old live-loop flaw: 5 falls in one home run and 2 in one Pallid run, the same flaw the
ledger's game was played under. So the bowl falls in the ledger were mostly flaw-driven. The
rift-ward knock guard stays, because a real knock near the lip can still do it.

**4. Hammer near her.**
- Under her body (0.85 R, below her belly) the hammer cannot hit, and she lowers it (threat 0).
  Instead, every 3.2 s she SHIFTS her stance sideways at 1.7 u/s for 1.3 s, and her stepping
  legs nudge him.
- The throw is flat: knockUp 0.12 (was setY(0.4) before normalising, about 10 u/s straight up),
  still 26 u/s.
- One collision tears once (`SLAM_GAP` 0.8 s): three tears in 0.1 s had been measured from one
  shove.
- Pose jumps are not blows: a shell point over 14 u/s or a leg over 20 u/s. Measured 63 and
  78 u/s "hits" that were IK re-solves.
- Her back is a slick dome: no tear from the shell under his boots, and he slides off at
  7 u/s^2 (`SHELL_SLIDE`). One sloppy run had stood on her back 49 s and taken 24 tears from
  her breathing.
- Outside her, the hammer, the lunge, the plume, the chase and the refusal lines are unchanged.

**5. Camera** (`BOSSCAM`, game.js). While she is up within 30 u (eased in over 0.8-1.0 x r):
- the boom cranes up 1.5 u;
- it does not swing down under him when he looks up (boom pitch held at 0.10 rad, the aim
  keeps the real pitch);
- the look slerps toward her belly / nearest dark ward by half the angle, at most 20 deg, and
  only while she is in front of the lens.

It is an event (she is up and near) on a critically damped spring, never wander. A longer
minimum boom was tried and dropped: a minimum inside her body only fights the guard that pulls
the lens out of her.

| | BEFORE | AFTER |
|---|---|---|
| pressed, home | 67-92% | 29-57% |
| pressed, Pallid | 7-99% (99% stuck at the claws; 7-10% floating away from her) | 49-73% |
| off-frame, home | 5-13% | 3-13% |

Remaining: the ward-lit flare washes the frame out for about 0.5 s when the look is on the
ward (frame 0300 in after-home-perfect-s1). That is the ward's own flash, but the lean makes
the lens face it.

**6. The return.**
- The clutch is carried TUCKED under her apron (brood.js `TUCK` 0.18 R, `TUCK_FLOOR` -0.20 R),
  as a berried crab carries it.
- Slung, it lay on the floor whenever she stood on flat ground (measured 0.1 and -2.2 u) and
  walled off the walk-in under her rear. On the crest it hung 6-10 u up.
- Its underside is now 3.7-5.9 u over the floor under her, over his helmet.
- `RET_R` 3.4 -> 5.0. The press-back is now a walk-under plus a hop at most.
- Asleep (the seated tongue) is unchanged. The lobes' tops stay inside her shell (checked from
  above, shots/ritefair-top-after.png).

**Also:**
- When he is in front within 2.4 R (was 1.6), both claws throw up and out in a meral spread
  (`HUNT.spread` 0.4). Held forward as a guard they walled off every walk-in from the front,
  and she always turns to face him.
- The crusher folds back into the hammer as it cocks.

## Target check (honest)

**The target was "competent first attempt 1.5-2.5 min, 1-3 hits".**
- With perfect reaction, the rite takes about 16-22 s of game time from the take, before AND
  after. A player who knows where to go was never slow.
- The difference is what goes wrong:

| | BEFORE | AFTER |
|---|---|---|
| bot runs completed | 7 of 12 | 12 of 12 |
| perfect | 3/3 home, 0/3 Pallid (stuck at the claw wall) | 3/3 home, 3/3 Pallid |
| sloppy | 3/3 home, 1/3 Pallid (46 and 55 hits, floating 180 s) | 3/3 home, 3/3 Pallid |
| sloppy max hits | | 2 |
| hits per sloppy run, home | | 0-1 |
| hits per sloppy run, Pallid | | 0-2 |
| sloppy Pallid, completion time | | 18-50 s |
| sloppy Pallid, float time | | 0-13 s (from its own 1 s bursts) |

- A real human at 60 fps reads the scene, finds the wards and handles the camera, so real-time
  play should land longer than these numbers.
- Is it now soft? The perfect runs take 0 hits because the policy goes straight under her,
  which is now a refuge. Out on the plateau the hammer, the lunge and the plume are as before.
  Michael's hands decide.

## Videos (orchestrator: assemble for Michael)

Frame sequences: every 3rd game frame, about 20 fps of game time, 960x600 PNG, under
/Users/michaelpaulus/sc/.abyssa-wt/shots/ritefair-video/.

| sequence | frames | outcome |
|---|---|---|
| before-home-perfect-s1 | 377 | completed |
| before-pallid-perfect-s1 | 1244 | stuck at her claws for 60 s, no ward |
| before-home-average-s2 | 398 | |
| before-pallid-average-s1 | 415 | this video run completed in 18 s; the suite runs of the same seed failed |
| after-home-perfect-s1 | 365 | |
| after-pallid-perfect-s1 | 394 | |
| after-home-average-s2 | 398 | |
| after-pallid-average-s1 | 642 | |

About 2.7 GB in total.

## Invariants (fresh load, branch)

- 14 lights.
- `__lev.fp` 15ce888c / c938fe6e / 652d0412.
- `__ridge.fp` 119f0cae.
- sleeperFingerprint 67303936 / ac04921e / ce3eaf9d (zone 0 twice), unchanged.
- `__safeFailed` [] and `__shaderFailed` [].
- Console: only favicon 404s.
- Perf: unmeasured. The added work is O(1) scalar per frame: a 5-sample ground max, a crest
  radius test, a 3-5 ward scan for the camera. It adds no allocation.
