# Velkath rite: before and after the fairness pass (ritefair, 2026-10-09)

This answers Michael's two reports:
- "you should try playing and getting all the wards its so hard"
- "I was struggling to get under her as she was crouched too low and I kept colliding"

It also answers the orchestrator's ledger (docs/playtests/2026-10-09-velkath-ledger.md).

Branch `ritefair`. BEFORE means main 7ad6d7d. AFTER means the branch head. Both were served by
the one dev server on 8832: AFTER from the worktree, BEFORE from an archive of main mounted at
/_base. Bot and walk-in runs ran on DRV 9471 and 9472.

## Up front: where this lands against the target

The target was: a competent first attempt lights every ward in 1.5-2.5 min, taking 1-3 hits.

**The miss is on the SOFT side.**
- With perfect reaction the rite takes 16-22 s of game time from the take. That held before as
  well as after.
- After, 13 of the 14 bot runs took 0 hits. The 14th, sloppy home s2, took 1.
- Under her body is now a refuge, and a player who knows to go there is safe.

**Knobs, if Michael finds it soft** (brooder.js):

| knob | now | effect |
|---|---|---|
| `STAND.under` | 0.85 R | radius of the refuge |
| `STAND.shiftT` / `shiftV` / `shiftD` | 3.2 s / 1.7 u/s / 1.3 s | the stance shift that dislodges him; make it a real stomp |
| `HUNT.upR` | 2.4 R | how early the claws part for him |
| `reach` | 7 | ward touch reach |

**The 1.5-2.5 min figure** is human reading time (finding the wards, the camera, the controls).
A perfect-reaction harness cannot measure it.

## Two flaws that were making it harder than the game is

**1. GAME: paused, the sleeper did not stand still.**
- In game.js, `updateLeviathan` ran while paused. The predators do not (`PEV_IDLE`).
- So with the pointer lock off (Esc, blur), Velkath kept hunting and hammering. Her knock was
  banked in Sal's velocity and the dress tore with nobody at the keys.
- FIXED: paused, she gets `LEV_IDLE`. This applies to Orune and Mhor too. Checked live: their
  clocks stop on pause and resume on unpause, with no errors and `__shaderFailed` [].
- Not tested: a pause in the middle of an Orune grab or during Mhor's circle (Mhor was absent
  in the check).

**2. HARNESS: real-time frames leaked between steps.**
- `play.mjs` paused Sal between acts but, through flaw 1, not her.
- `__bench.step` holds the loop only while it steps. Between CDP calls the page's own rAF ran
  real-time frames with the keys as they were, and every screenshot forced one more.
- With the leak, on main, 3 of 4 runs took a hit 2.8 s after the take. Without it, 0 of 12.
- The orchestrator's ledger was played under both flaws. The mechanism is shown; how much of
  its 3 hits, the float and the bowl it explains is not measured.
- All numbers below stop the live rAF loop (`requestAnimationFrame` stubbed) and render every
  stepped frame.

## How it was played

**Bot, `tools/bench/riteplay.mjs`.** Real CDP keys on the freeze-step loop, the ledger booked
per frame in the page. Both policies play the same opening:
- [E] pries the clump;
- he runs off with it for 6 s, so the rite starts against a risen, hunting Velkath;
- then the rite.

The two policies:

| | perfect | average ("sloppy") |
|---|---|---|
| Slice length | 0.25 s | 0.5-1.0 s, decided on the state at slice start |
| Aim | exact | +-20 deg |
| Ward knowledge | every ward | only wards it has seen on screen; otherwise "under her belly" |
| Bursts | held for what the climb needs | held 0.6-1.2 s whatever the need |
| Dodging | rushes under her when she cocks | none |

Policy, harness and seeds are identical on both trees. The game's own Math.random (her strafe,
her shift) means a seed does not repeat exactly: compare rows in aggregate.

**Column meanings.**
- hits: tears more than 0.5 s apart.
- dry dips: reserve under 12%.
- bowl falls: entering the rift bowl.
- max up / float: height over the floor; seconds spent more than 9 u up.
- cam off-frame: share of samples (she is awake within 30 u) where neither her belly nor a dark
  ward is on screen.
- cam pressed: lens within 2.6 u of his helmet.

### BEFORE (main), bot: 11 of 14 complete
| run | done | calm s | ward lit at (s) | return s | hits | tears | dry dips | min reserve | bowl falls | max up (u) | float >9u (s) | cam: off-frame % | cam: pressed % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home perfect s1 | yes | 19.8 | [15.2, 19.8, 16.7] | 19.8 | 0 | 0 | 0 | 0.7 | 0 | 12.3 | 1 | 13 | 71 |
| home perfect s2 | yes | 20.1 | [15.3, 20.1, 16.7] | 20.1 | 0 | 0 | 0 | 0.68 | 0 | 12.4 | 1 | 12 | 71 |
| home perfect s3 | yes | 16.6 | [15.4, 16.6, 16.5] | 16.6 | 0 | 0 | 0 | 0.7 | 0 | 13.2 | 1.8 | 11 | 76 |
| home average s1 | yes | 25.7 | [15.6, 16.9, 25.7] | 25.7 | 1 | 1 | 0 | 0.44 | 0 | 7.9 | 0 | 8 | 89 |
| home average s2 | yes | 16.2 | [15.1, 16.2, 16.1] | 16.2 | 0 | 0 | 0 | 0.47 | 0 | 12.5 | 3.1 | 5 | 95 |
| home average s3 | yes | 24.9 | [14.9, 17.4, 24.9] | 24.9 | 0 | 0 | 1 | 0.08 | 0 | 14.7 | 1.3 | 12 | 91 |
| pallid perfect s1 | NO | None | [None, None, None, None] | None | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 99 |
| pallid perfect s2 | NO | None | [None, None, None, None] | None | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 99 |
| pallid perfect s3 | NO | None | [None, None, None, None] | None | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 99 |
| pallid average s1 | yes | 17.1 | [14.9, 17.1, 17, 16.3] | 17.1 | 0 | 0 | 0 | 0.61 | 0 | 13.9 | 1.6 | 5 | 84 |
| pallid average s2 | yes | 67.1 | [15.2, 67, 16.1, 66.7] | 67 | 18 | 19 | 1 | 0 | 0 | 27.6 | 48.2 | 2 | 22 |
| pallid average s3 | yes | 17.1 | [15.1, 16.9, 17.1, 16.9] | 17.1 | 0 | 0 | 0 | 0.64 | 0 | 8.1 | 0 | 4 | 86 |
| burned perfect s1 | yes | 35.5 | [25, 19.9, 35.5, 19.1] | 35.5 | 2 | 4 | 0 | 0.38 | 0 | 11.6 | 7.2 | 7 | 84 |
| burned average s1 | yes | 26.4 | [24.9, 17.9, 26.4, 17.9] | 26.4 | 1 | 1 | 1 | 0.09 | 0 | 19.5 | 8 | 0 | 82 |

### AFTER (ritefair), bot: 14 of 14 complete
| run | done | calm s | ward lit at (s) | return s | hits | tears | dry dips | min reserve | bowl falls | max up (u) | float >9u (s) | cam: off-frame % | cam: pressed % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home perfect s1 | yes | 16.9 | [15.8, 16.9, 16.9] | 16.9 | 0 | 0 | 0 | 0.69 | 0 | 7.3 | 0 | 4 | 15 |
| home perfect s2 | yes | 17.6 | [16.3, 17.6, 17.5] | 17.6 | 0 | 0 | 0 | 0.7 | 0 | 10.1 | 2.3 | 4 | 14 |
| home perfect s3 | yes | 17.6 | [16.3, 17.6, 17.5] | 17.6 | 0 | 0 | 0 | 0.7 | 0 | 10 | 1.8 | 4 | 14 |
| home average s1 | yes | 17.3 | [16.5, 17.3, 17.1] | 17.3 | 0 | 0 | 0 | 0.42 | 0 | 8.7 | 0 | 5 | 48 |
| home average s2 | yes | 58.1 | [45.5, 58.1, 16.4] | 58.1 | 1 | 1 | 1 | 0.12 | 0 | 21.2 | 44.4 | 9 | 11 |
| home average s3 | yes | 17.4 | [16.1, 17.1, 17.4] | 17.4 | 0 | 0 | 0 | 0.28 | 0 | 11.7 | 2.6 | 5 | 28 |
| pallid perfect s1 | yes | 17.6 | [16.4, 17.6, 17.4, 16.9] | 17.6 | 0 | 0 | 0 | 0.71 | 0 | 14.4 | 2 | 0 | 64 |
| pallid perfect s2 | yes | 17.6 | [16.4, 17.6, 17.4, 17] | 17.6 | 0 | 0 | 0 | 0.71 | 0 | 9.7 | 0.5 | 0 | 63 |
| pallid perfect s3 | yes | 20.7 | [16.7, 20.7, 17.9, 17.1] | 20.7 | 0 | 0 | 0 | 0.73 | 0 | 9.3 | 0.9 | 0 | 46 |
| pallid average s1 | yes | 29.2 | [17.1, 17.8, 20.1, 29.2] | 29.2 | 0 | 0 | 2 | 0 | 0 | 10 | 0.7 | 14 | 60 |
| pallid average s2 | yes | 28.3 | [17.4, 28.2, 19.1, 20.3] | 28.2 | 0 | 0 | 0 | 0.24 | 0 | 10.2 | 1.5 | 10 | 73 |
| pallid average s3 | yes | 18.3 | [16.6, 18.3, 17.6, 16.9] | 18.3 | 0 | 0 | 0 | 0.59 | 0 | 7.9 | 0 | 0 | 58 |
| burned perfect s1 | yes | 21.9 | [20.4, 21.9, 21.7, 21.1] | 21.9 | 0 | 0 | 0 | 0.66 | 0 | 13.4 | 3.6 | 0 | 48 |
| burned average s1 | yes | 26.8 | [23.2, 26.8, 21.3, 22.4] | 26.8 | 0 | 0 | 1 | 0.1 | 0 | 17.7 | 6.3 | 3 | 76 |

**Reading the tables.**
- Pallid perfect on main is stuck at her claws for 200 s in 3 of 3 runs, walking straight at
  her front.
- Sloppy Pallid on main had 18 hits, 48 s floating and 27 u up.
- AFTER, no bot run takes more than 1 hit or falls into the bowl.
- Camera pressed: home 71-95% -> 11-48%; Pallid 84-99% -> 46-73%.
- Sloppy home s2 still floats about 44 s after its own long bursts (policy, 1 hit).

### Manual, perfect reaction (me, `play.mjs`; the live loop stopped on main too)

Played on the branch before the final shell-clearance and reach commits: the geometry differs a
little from the head.

| | BEFORE home | AFTER home | BEFORE Pallid | AFTER Pallid |
|---|---|---|---|---|
| 1st ward | 13 s, but only because a knock threw him past ward 2 | 12.4 s (tap-hop under her face) | 12.3 s (0.4 s burst) | 12.7 s (0.35 s burst) |
| 2nd ward | 36 s | 15.6 s (hop) | 17.5 s | 14.2 s |
| 3rd ward | - | - | 18.5 s; the old 4th socket was inside the egg mass | 17.3 s |
| return, calm | 43 s | 21.5 s | 21.7 s | 21 s |
| hits | 4 (about 5 tears) | 0 | 0 | 0 |
| float | rose 23 u, then stood on her back; C held 3 s and still rising | about 3 u | about 4 u | about 6 u |

Frames:
- shots/ritefair-manual-home-strip.png
- shots/ritefair-manual-pallid-strip.png
- shots/ritefair-manual/ (AFTER)
- shots/ritefair-manual-before/ (BEFORE)

## Walk-in under her (`tools/bench/ritefair-walkin.mjs`, real W+Shift, re-aimed at her centre each 0.25 s)

**Free arc at the rim (1.0 R)** a 0.45 u diver fits through at 0.45/1.0/1.8 u, on four bearings
about her heading:

| | standing (lab hold) | hunting | narrowest |
|---|---|---|---|
| BEFORE home | 24-49 u | 2.8-40 u | 2.8 u, hunting, left |
| BEFORE Pallid | 26-49 u | 10-49 u | |
| AFTER home | 30-49 u | 49 u on all four | 29.7 u |
| AFTER Pallid | 49 u | 49 u | |

**Real-key walk-ins reaching under her (< 0.35 R) in 12 s**, starts on her plateau only:

| | standing | hunting |
|---|---|---|
| BEFORE home | 3/3 | 3/3 |
| BEFORE Pallid | 4/4 | 3/3 |
| AFTER home | 3/4 | 3/4 |
| AFTER Pallid | 4/4 | 4/4 |

The two AFTER home misses:
- standing b90: he pressed straight into a planted leg 1.78 R out (the probe never steers
  round);
- hunting b90: still moving at 1.38 R when the 12 s ran out.

**Him under her (unheld, 3 s): her lowest part over the floor** along the four lanes in
(1.2-0.5 R):

| | lane minimum over the ramp | wards over the floor | clutch underside |
|---|---|---|---|
| BEFORE home | 2.9 u | 9.3 / 9.4 / 15.1 | 8.1 |
| BEFORE Pallid | 0.1 u | 11.4 / 13.3 / 6.9 / 16.8 | 11.4 |
| AFTER home | 2.3 u | 6.7 / 7.7 / 7.8 | 6.3 |
| AFTER Pallid | 4.8 u | 8.3 / 9.2 / 9.5 / 9.6 | 7.9 |

The AFTER home 2.3 u minimum is the cutter claw held forward at 1.2 R. Shell-only it is 5.0 u or
more on every lane.

**Shell clearance and ward reach.** The shell now holds `STAND.clear` 3.6 u over the ground under
it, which lifts her on uneven ground. The ward touch reach went 6 -> 7 to meet that: a ward
8.35 u up is in reach standing directly under, and more with one tap-hop.

## Decisions (each lever, what was done, why)

**1. Wards reachable.**
- She hunts OFF THE LIP: her centre is held `STAND.keep` 1.45 R outside the rift's rim crest
  while the diver is on the plateau. The crest is found once along her lair's bearing (home:
  crest r 37, keep r 59.3, about a 7 u walk off her ledge as she rises).
- She rides at most `STAND.ride` 0.06 R over the ground under her belly (a foot on a boulder
  had lifted her 3-4 u).
- Standing height is 0.52 R.
- She holds her height when he is under her: `L.underE` keeps the threat lift and the front's
  pitch. Before, dropping them brought her 4.3 u down onto him.
- Her shell keeps `STAND.clear` 3.6 u over the ground under it while she is awake.
- Reach is 7. The wards stay on her belly.
- The 4th (remote) socket moved out of the egg mass, where it was touchable but invisible, to
  under the cutter's shoulder.

**2. Burst vs dress.**
- The spill ramps in over the burst's first 0.12-0.32 s.
- C bleeds a climb (`VENT_BRAKE` 2.2/s).
- Measured on the same protocol on both trees:

| | main | branch |
|---|---|---|
| seabed -> surface, two held bursts | 25.1 s | 25.1 s |
| 1 s burst up then C: time until he turns | 1.9 s | 0.8 s |
| ... rise before he turns | 10.5 u | 7.0 u |
| 0.3 s kick: fill / peak | 0.47 / 4.6 u | 0.44 / 4.1 u |

**3. Rift bowl.** The knock never has a rift-ward component outside the crest, and she fights
off the lip. Bowl falls were 0 in every fair-harness run on both trees: the ledger's bowl
belongs to the flaws above. The guard stays for a real knock near the lip.

**4. Hammer near her.**
- Under her body (0.85 R) the hammer is lowered and cannot hit. Instead she shifts her stance
  every 3.2 s.
- The throw is flat: `knockUp` 0.12 (it was about 10 u/s straight up), 26 u/s along the ground.
- One collision tears once (0.8 s gap).
- Pose-jump speeds are not blows: shell over 14 u/s, leg over 20 u/s. Measured 63 and 78 u/s
  "hits" that were IK re-solves.
- Her back is a slick dome: no tear, and he slides off at 7 u/s^2. On main a sloppy run stood
  on her back 49 s and took 24 tears from her breathing.
- Outside her: the hammer, lunge, plume, chase and refusal lines are unchanged.
- THE MERAL SPREAD: when he comes in at her face (2.4 R) both claws throw up and out. The
  crusher folds back into the hammer as it cocks.

**5. Camera** (`BOSSCAM` in game.js; she is up and within 30 u):
- the boom cranes up 1.5 u;
- the boom does not swing down under him when he looks up (boom pitch held at 0.10 rad, the aim
  keeps his pitch);
- the look slerps toward her belly / nearest dark ward, half the angle, at most 20 deg, only
  while she is in front of the lens. ANY mouse look drops the lean at once, and it returns once
  the look has been still 0.6 s.

It eases on a critically damped spring and is an event, not wander. **Flag for Michael (grounded
camera rule):** the lean is new camera behaviour. The bot sets the yaw every slice, so it saw
the lean mostly off; his hands judge it.

Known: the ward-lit flash fills the frame for about 0.5 s when the look is on the ward.

**6. The return.**
- The clutch is carried TUCKED under her apron (`TUCK` 0.18 R, `TUCK_FLOOR` -0.20 R), as a
  berried crab carries it.
- Slung, it lay on the floor on flat ground (0.1 and -2.2 u measured) and walled off the walk
  in under her rear.
- `RET_R` 3.4 -> 5.0.
- **This is a LOOK DEVIATION on the brooder-clutch decision card:** the mass reads flatter. See
  shots/ritefair-clutch-under-before-after.png. The lobes' tops stay inside her shell (checked
  from above, shots/ritefair-top-after.png).

## Regression probes on the branch

- `clutch2-alt6`, all three anchorages: prompt up, reach 0.46-0.61, push 0, Sal in eggs 0.
- `clutch2-camstress`: lens in a lobe 0 of 8454 frames; egg snaps 4, fails 0.
- `clutch2-solid`: lens in a lobe 0 of 6503. Sal's maximum overlap with the eggs is 0.11 u
  (clutch2 reported 0.05-0.07). The lens was inside another part of her for 102 frames: claw
  capsules about 19.5 s in while she rises, and the shell for about 10 frames at 42.4 s. The
  main comparison is not valid, because the probe imports the branch's bodyCols.
- `brooder-rush`: 3/3 rushes got under her and lit 2 wards.
- Burned Ground bot runs: perfect 22 s, sloppy 27 s, 0 hits each.

## Videos for Michael

Every 3rd game frame (about 20 fps of game time), 960x600 PNG, under
/Users/michaelpaulus/sc/.abyssa-wt/shots/ritefair-video/. About 3.5 GB. The bottom 66 px of each
frame is a black bar (the capture clip is taller than the headless viewport): crop it.

| BEFORE (main) | frames | outcome |
|---|---|---|
| before-home-perfect-s1 | 377 | |
| before-pallid-perfect-s1 | 1244 | stuck at her claws 60 s |
| before-home-average-s2 | 398 | |
| before-pallid-average-s1 | 415 | |

| AFTER (branch head) | frames |
|---|---|
| after-home-perfect-s1 | 382 |
| after-pallid-perfect-s1 | 555 |
| after-home-average-s2 | 1106 |
| after-pallid-average-s1 | 402 |
| after-burned-perfect-s1 | 488 |

The manual BEFORE home run (4 hits, 23 u up, on her back) was NOT recorded as video. Its still
frames are in shots/ritefair-manual-before/h01-h28.

## Invariants (fresh load, branch)

- 14 lights.
- `__lev.fp` 15ce888c / c938fe6e / 652d0412.
- `__ridge.fp` 119f0cae.
- sleeperFingerprint 67303936 / ac04921e / ce3eaf9d (zone 0 twice), unchanged.
- `__safeFailed` [] and `__shaderFailed` [].
- Console: favicon 404s only.
- Perf: unmeasured. The added work is O(1) scalar per frame and allocation-free; `__slamLog`
  allocates only on a tear and is capped at 64.
