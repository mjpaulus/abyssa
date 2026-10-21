# Velkath buried: a rock with a harpoon in it — build report (2026-10-15 .. 2026-10-21)

Branch `buried`, cut from main `644879b` (lensfix merged), head `1589669` before this record, 116 commits `644879b..1589669`.
Spec `docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md`, plan `docs/superpowers/plans/2026-10-15-velkath-buried-rock.md`
(17 tasks, 7a/7b and 5b/5c), card `roadmap/velkath-buried-rock.md`. The ledger (`.superpowers/sdd/2026-10-15-velkath-buried-rock/progress.md`)
is git-ignored, so this report restates every ruling in it (section 12) and Michael's exact words (section 2). Evidence:
`~/sc/.abyssa-wt/reviews/buried/` (probe JSON and logs, `t13-*`, `t15-*`, `t16/`, `campaign/`), stills `~/sc/.abyssa-wt/shots/buried/`
(`look/`, `t5*-checkpoint.md`), videos `~/sc/.abyssa-wt/video/buried-full.mp4` and `buried-dig.mp4`.

## 1. What it is, and where it stands

Velkath sleeps at home as a rock: a long low outcrop of her own shell, lightly covered in sand, with an old harpoon in its flank. [E] PULL
THE HARPOON cracks the crust, shoves a man standing on her off, and she rises out of the sand in a dust plume that blinds her for the
first ~3.5 s. Once she stands the rite plays as shipped. After the calm she turns in place to the opening crack and points at it with her
great claw (the lens follows), then walks home and digs back in over 17.5 s. HOME ONLY (site.js home row `bury: { crest: 6.5 }`);
Pallid, Burned and the Shelf are the shipped ridge bit for bit.

**Status: built, every gate green or ruled, ONE open item that is Michael's: the look (section 3).** Michael's answers to the Task 16 look were
sent 2026-10-21 and are pending. The one registered fight-parity bar that failed (b, the perfect bot) is kept as data by ruling
(section 8). The card's `status` is left to the orchestrator; nothing is published or merged.

## 2. Michael's words

| date | words | what it did |
|---|---|---|
| 2026-10-14 | "it would be interesting if she was buried in the sand and looked like a rock. Sal would just see what looked like a harpoon in the rock and pulls it out and she rises from the sand. There would be a dust plum as the sand falls off of her" | the feature |
| 2026-10-14 | "actually can she turn and point to the void with her giant claw" | the point |
| 2026-10-14 | brainstorm picks: tell B (the sand breathes, up close), crest only A (~20 u low outcrop), slow 6 s rise A (blind 3-4 s in the plume), the point then dig back in A, the camera follows the point A, build approach 1 (a drawn burial skin over a sunken body); sections 1-4 "looks right"; spec "approved", confirmed "yes" | the spec |
| 2026-10-14 (relief) | "A is good" (the remaining fight gap accepted); "Turn her around", "Raise her to match" | her bed, turn and stance this builds on |
| 2026-10-15 | on the plan's three open feel calls (blind 3-4 s from ~3 s so she finds him ~6-7 s after the wake; the breath may be too subtle, he judges it on stills; if no crest seat is both buried and in reach the build stops for him): "I thought I already approved this but yes these are fine to proceed with" | Tasks 3a, 4, 8 |
| 2026-10-15 | "we should focus on getting one right now" (card anchorages-as-missions) | home only |
| 2026-10-15 | on lensfix: "just merge it for now" | the base |
| 2026-10-17, 10-18 | "Try again" (twice, after a model usage limit and a spend limit cut the Task 3b implementer) | Task 3b re-dispatch |
| 2026-10-20 | **Checkpoint 1 (Task 5, the disguise with the harpoon in it):** "I am bit sad that the her back had alot more rocky feeling, so it doesnt really read a rock. keep the weeds maybe even add more and coral"; approved the controller's revision, "yes go ahead": sink her less (crest ~6-7 u, beyond the spec's 3-4: his call), a lighter crust with two variants, more weeds and coral on the exposed rock, the harpoon re-seated | Task 5b |
| 2026-10-20 | **Checkpoint 2 (5b):** "reads as a rock now, but it should be her shell but lightly covered in sand. When she rises the sand should fall off and create a dust cloud" | Task 5c (the 'sand' look); the falling sand and dust cloud are 7a/7b/8 |
| 2026-10-20 | **Checkpoint 3 (5c):** "that looks right, keep going" | the disguise is settled |
| 2026-10-21 | on how fast she swings round to point (options: A faster turn, B finish turning then point, C point over her shoulder; the controller recommended B): "1" = finish turning at 0.5 rad/s, then point | Task 10 |
| 2026-10-21 | **The look (Task 16)** sent: two MP4s and five stills. **Answers pending.** | section 3 |

Unanswered earlier: the Task 5 checkpoint's question 3 (fronds against the iron: 21 of the 32 fronds on the uncovered rock are buried to keep
the harpoon visible) was not answered; the default, as built, stands. Michael was also told, plainly, that the fight opening is kept (section 8).

## 3. The look — pending Michael

Sent 2026-10-21 with `buried-full.mp4` (1661 frames, 83.05 s of game time) and `buried-dig.mp4` (3319 frames, 165.95 s, to the dug-in
outcrop), and stills in `shots/buried/look/` (asleep 10 u and 20 u, mid-rise at 2.5 s and 4.0 s, the point with the light, buried again with the
scar, night). The seven questions put to him, each with its default (what is built, and what happens if he does not say otherwise):

1. **Does the point read as pointing at the void?** The claw rises and holds ~3 s through the line, but the lens frames her claw and the
   opening only where both fit. PROPOSAL: angle the claw tip at the glow and frame both. DEFAULT: as built (the claw aimed along the shoulder -> opening
   line, POINTCAM framing the claw where it can); the proposal is a change that needs his yes.
2. **Can the breath be seen?** The sand over her lifts 0.045 u every 8-10 s, drawn with the lens within 18 u. DEFAULT: as built; the knob is
   `BURY.breath.lift` (his own ruling 2026-10-15: "may be too subtle... he judges it on stills").
3. **RIDGE_LINE: keep or not.** "THE RIDGE IS WARM UNDER YOUR HAND." is still said within 1.3 R while she is dormant (brooder.js). Does it give the rock
   away? DEFAULT: keep (unchanged, the spec says the sleeping lines stay).
4. **The coral and weeds have no surface.** The growth on her back has no collider, so the lens and boots pass through: coral through
   Sal's boots on 168 of 2,718 crest frames (to the full boot height), coral swallowing both lower legs at one crest spot, a weed frond on the lens
   for 4 frames at wake + 3.6 s (and another at wake + 0.9 s in the afloat pull: the "Mesh:18" hits, identified as a weed frond, not a ward disc). DEFAULT: keep as is.
5. **The scar after the dig-in does not read.** In no still, from 10 u, 6 u or 3.5 u, is the harpoon's scar resolved (he stands among her growth
   at the seat). DEFAULT: leave as is.
6. **The average player's extra hits.** Average-bot fights were hit in 8 of 12 fights on the branch against 3 of 12 on main (13 hits against 5; Fisher
   p 0.10, no mechanism found; 12 of 13 in the fight proper, none on the dune or crest). DEFAULT: nothing moves unless he says; a skilled player's
   first 30-45 s also read differently (section 8).
7. **Embers under the sand, built dark.** The spec says her burning wards are embers under the sand; the plan's bar (light 0, glow 0) built them
   dark, because BURN's 15 s fade has run out before the 17.5 s dig-in ends. Does he want a faint glow through the sand? DEFAULT: dark.

Also given for his information with the look: her walk home starts about 8 s later because of the point; the camera fix (lensfix), not POINTCAM,
keeps the lens out of her shell after the calm (a rotation cannot move the lens). Other things Task 16 found and flagged for his eye: the
point claw is `claws[1]`, her LEFT (body +X); the harpoon seen end-on from the sand reads as a glint plus a dark stub; the crack in the sand
cover is a faint seam, visible from 6 u and not from the anchor; the shove at 11 u/s (a ~8 u slide) and the 3-4 s blind window are feel targets
at one deterministic spot, not contracts; at ~1 s the crack's plume ring reads as three separate lumps hanging in the water.

## 4. What was built

| task | what | commits |
|---|---|---|
| 1 | the base, the plugged clock (`clockplug.mjs`), burial-probe `disguise`, the RED on main (sides +6.62 u, crest top 8.02 u) | 2adfbcf..188f4bc |
| 2 | `L.bury`, `L.buryD`, the sink; home's row `bury`; `BURY` knobs; the other anchorages bit-identical | debab38 |
| 3a | THE MOUND: the drift grown over her sunk shell (`makeMound`/`fitMound`), a sand pile at its repose; the tell (`breathTick`) | f55d2ea..713f13a |
| 3b | THE FOOTING: the dune and her crest are ground (`buriedFloorAt` -> `setExtraFloor`/`extraFloorAt`: player.js, diver.js, `shutFloorY`); the shell's collider capped at the drawn ground; relief-walk `mound` | 9f8f851..9e6a01b |
| 4 | the crest seat (`seat()` without the bearing test, `H._crestScan`), the iron-in-her bar, the rope on the drawn ground, LIVE re-recorded | 7153271..3a905b0 |
| 5 | THE CRUST (one program, every site, boot-built); `programs` mode | 325835f..1ddb11a |
| 5b | sunk less (crest 6.5 u), strip 20 u, weed and coral on the exposed rock, claws and clutch sink | baae604..f5d7a01 |
| 5c | the 'sand' look (sand lying on her shell, body-anchored) | 75d2360..ddd8133 |
| 6 | the clutch under the sand (`clutchSink`); its find line and fan held | f48373f..8a36759 |
| 7a | the rise out of the sand; the shove; the rising guard (`holdRise`, `hasStood`, `risenUp`); footing carried through the rise | 31d5a59..31a3b94 |
| 7b | the crack's look: `crackK`, 14 sand-crust slabs, the pour, `growReveal`, the dust budget | 3525e27..4fc8e38 |
| 8 | the `rise` plume kind; her blind start by the shipped SIGHT rule; the home-only shell keep (`keepShell`); `shoveV` 11 | 7b3597e..61332a0 |
| 9 | the crack and the pour in her wake's voice (audio/creatures.js) | 0bbb420, 2a6ef18 |
| 10 | THE POINT (`POINT`, `aimPoint`), the lab verb `calm`; finish turning, then point | 8ca9f02..3bdacd4 |
| 11 | POINTCAM (game.js `POINTCAM`, `__pointcam`) | 7a588a3..90e1f99 |
| 12 | THE DIG-IN as a job over frames; re-entry rebuilds her buried | 566d3fb..70ae5a3 |
| 13 | the sweep over the whole feature; `voyage-pallid.mjs`; probe corrections | d4c484b..352d3fe |
| 14 | the rite policies read the ground he stands on; the paired 48-fight campaign | 8f3f7ee |
| 15 | the cross-load ABBA (no commits) | (head 8f3f7ee) |
| 16 | the look: stills, two MP4s, `fullplay-gate.mjs FP_UNTIL` | 693045a |
| cleanup | claw-side comments, `__xf` host note, FP_UNTIL guards, `PC_PLACE`, voyage-pallid label and site wait | 1589669 |
| 17 | this record | (this commit) |

## 5. Invariants at the head

Checked on the head (Task 13 sweep, `relief-load all`; Task 17 re-ran `voyage-pallid.mjs`):
- 14 lights. Zero per-frame allocation in the new paths (the dig-in's job allocates small iterator results for ~3 s: event work). No reversed smoothstep.
- `sleeperFingerprint(0)` with no row is STILL `1ca3b28c` (`ac04921e` / `ce3eaf9d` for zones 1 and 2). The ROW-BUILT home value is **`b9fd3c26`**; it was
  `edb51a28` on the base, moved to `1199bc26` by Task 2's sink alone and to `b9fd3c26` by Task 5b's less-sunk crest (cause recorded with each).
  Remote row-built values are unchanged: Pallid `014f3101`, Burned `5dc323ad`, Shelf `874758d2`.
- The home LIVE anchor holds: heading -121.51 deg, Alt+6 at fwd -0.53 / lat -0.23 R (a ledge of her rock; the base's -0.81 / -0.59), lift 0.55, seat
  found, dormant, `bury` 1, crest 6-7 u (6.5), buryD 1.414. Its cause: the burial's crest seat (Task 4: -0.22 / -0.10 at the 3.5 u crest) and Michael's
  checkpoint (Task 5b: -0.53 / -0.23).
- `__ridge.fp()` home `5c0705a1`, zones 1+2 `d49d451d`, Pallid `b1c58f8d`, Burned `d2b6fb68`; `__lev.fp` `15ce888c` / `c938fe6e` / `652d0412`; `validate.mjs` 10/10.
- `__safeFailed()` and `__shaderFailed()` []; console clean but the favicon 404.

## 6. The gates (pre-registered in the plan; every bar's RED shown before its GREEN where the plan could build one)

| gate | final reading | RED (exit 5 = failed as it must) |
|---|---|---|
| Disguise, measured (`burial-probe disguise`) | legs -0.282, claws -0.869, eyes -2.549, mouth -5.604, wards -2.067 u (bar <= 0 over the drawn sand); sides -0.3 (<= +0.02); reef/weed 0 drawn outside the strip; crest top **6.5** u (bar RE-REGISTERED 3.0-4.0 -> 6.0-7.0 by Michael's checkpoint); crest 20.1 u long (16-24); exposed rock 500.09 u^2 (bar >= 171.4 = 1.8 x 1ddb11a's 95.24); repose worst 33.01 deg (fixed bar 33.81); clutch -0.491 (<= -0.05); seam +4.454, pole +4.157, iron in her (tip 0.207) | main 644879b exit 1 (sides +6.62, top 8.02); `BP_RED=ridge`, `shallow`, `steep` (repose 2.0), `late` (clutch) exit 5; the iron bar on 9e6a01b exit 1 (fallback seat in open water); top and exposed on 1ddb11a exit 1 (3.5 u, 95.24) |
| The tell (`breath`) | amplitude 0.045 u (0.03-0.06); peak intervals 8.4-9.0 s (8-10); trickle 1 per breath at 6 u, 0 at 12 u. Whether it can be seen is Michael's (Q2) | `BP_RED=still` exit 5; exit 1 on debab38 (amp 0) |
| Footing (`relief-walk mound`, `RW_PARKED=strip`) | shell contacts 0 / 0 / 0 on all three lines, lens >= 1.165 / 1.433 / 1.399 u over the drawn surface, blocked 0, 50 ms clamp 0, provider frames 0; gated floor+dune own p95 <= 0.024 (0.016 / 0.017 / 0.020 in the sweep). Strip PARKED: p95 0.299 / 1.486 / 0.762, hang to +4.55 | `RW_RED=nofloor-mound`, `nocap` exit 5 |
| Footing, lens (`relief-walk lens`, RW_BASE) and boots | provider 0, all six lens rows PASS against the lensfix-era base recorded on buried-main with the same stop; boots exit 0 after `BED_STOP` was re-derived to a fixed 37 u (the shipped 26 u was inside the 25.1 u dune) | the 26 u run (344 provider frames) |
| No compile in play (`programs`, `hitch`) | `vsBase []` at every checkpoint (boot, first sight, (a) dormant, (b) the rise, (c) the calm and point, (d) the dig-in); (c) and (d) equal (a) on 600 and 1920 rendered frames with her in frame; crust 4 variants in the boot tail; hitch newPrograms 1 / -9 / -1 / 1 / 3 as at Task 5 | `BP_RED=lazy` exit 5 (refused without `BP_BASE`); the positive control moves the count +1 |
| The rise (`rise`) | no tear and no hammer/drop until she stood (STOOD 6.733 s): 0; a shove with a stagger set on the wake frame (out +6.22 u anchor, +6.76 crest); wards under the sand at the wake (-2.07 u) and > 2 u at the stand (7.63), dark; body rise <= 8 u/s: 7.02 at every placement; footing (g) holds; crack drawn (h) at 0.717 s (bar 0.9 s); slabs (i) worst +0.024, iShell max 0.094 (anchor 0.118; bar 0.3); blind (anchor) lost 3.97 s, found 7.90 s by line of sight, a 3.93 s spell; off 12 u 3.45 s; dune 3.42; under 3.75; crest 4.28 (booked) | `noshove`, `tearable` (BP_FORCE: holdRise 0 tears once, hitV 13.0; on, 0 tears), `early`, `nofoot`, `sunk`, `noplume` all exit 5 |
| The plume | footprint 18.0 u (15-20); climbs 4.5 u over 4 s (>= 3); `quadEvicted` 0; `riseEvicted` 0 (live max 12); the pool's overwrites 0 at five placements, 6 at the dune (<= 50) | `BP_RED=noplume` exit 5 |
| The point (`pointcam-probe point`, hose 760) | back: she faces within -9.29 deg at the raise (bar 12), aim 10.04 deg (20), claw up 3.283 s [7.083, 10.35] s, raise 6.217 s after facing at 6.117 s; ahead: -0.79 deg, aim 5.33, hold [3.783, 7.05] containing the line at 4.117 s; tears 0; she walks home after | `PC_RED=nopoint` exit 5; back on b3e903f exit 1 (-103 deg at the raise) |
| POINTCAM (`framing`/`mouse`/`off`/`walk`/`lastward`) | framing theta 5.6-10.4 deg over the hold, close 320/320 (0.5 x min(thetaPre, 70)); a 6 deg look drops it in a frame and it stays off, 4 net / 10 path keeps it; off: lens quaternion == `qPre` 840/840 (positive control 494 engaged); aim step < 1 deg/frame; bonnet in frame; `clawcam-probe` 22/22 | `PC_ON=0`, `nopoint`, `fastturn`, `noface`, `inband` exit 5 |
| Digging back in (`digin`, `reentry`) | 17.5 s (15-20) once he is clear; ends `bury` 1 `dugIn`, disguise passes on the new pose (1.26 u off her bed); pause: 313 frames still while he is on her ground, resume in 60 frames (= `SETTLE.hold` x 60), boots min -0.027, lens min 3.61 u; afloat: 180 held frames still, `calmOut` 0, no sink; crest top: 180 frames still; wards light 0 / glow 0; breath 0.045; cost: worst frame +3.5-3.7 ms over the median (bar 4.0) | `fastdig` (8.0 s), `nopause` (316 frames moved), `keepdig`, the crest run on c3eaa00 (180/180 moved), `mem2` exit 5 |
| Existing probes (Task 13 sweep on 70ae5a3) | `relief-load all` exit 0; `seating-probe` 0 hover/sunk/boulder at home, Pallid, home; `harpoon-probe` x10 modes exit 0 (seams 4.45 / 2.03 / 1.35 / 1.42; lodged home tip 0.207 shank 0.191); `fissure-probe velkath-crack clearance ending opening calm-open open-persist` exit 0 (ending dip 198.61; the calm with the point running); `brooder-invariants`, `blade-invariants` 0; `clawcam-probe framing` 5/7 pass, 2 fail "bonnet 30 u ahead" (corrected to 2 of 5 on disk); `gates.mjs` 20 PASS; `clutch-line-probe` 0; `voyage-pallid` 0 | `velfix-gate` absolute RED (below) |
| Voyage (`voyage-pallid.mjs`) | **Task 17 rerun at head 1589669: exit 0** (JSON `reviews/buried/voyage-pallid-t17-green.json`): home fp `5c0705a1` and the LIVE anchor; home's dune is ground at home (1,403 footprint cells, -271.217 over terrainH -276.669 at her bed); 18 reseed reads of home's bed all -1e9; Pallid fp `b1c58f8d`, `extraFloorAt` -1e9 on 5,043 + 5,043 grid points, 9 dens exactly on `terrainH + 0.2`, row-built `014f3101` with no `bury`; home again the same anchor; console clean | `VP_RED=nositekey` on a scratch snapshot exit 5 (the reseed read -271.217); exit 2 on an unmutated head |
| Fight parity | section 8 | pre-registered, n/a |
| Cost | section 9 | n/a |
| The look | section 3 | n/a |

`velfix-gate` after the calm (3 alone + 1 under load): the registered absolute gate is RED on the base too and was judged against the base by ruling
(Task 13): PRESSED 0, eggs 0, `salIn` 0, `salCalm` 0 on every run; `lensSurf` 6 / 4 / 7 in 3 of 12 routes (claw meshes, the same ids as lensfix's own
accepted GREEN); FLASH 9-18 and CLEAN 5-22 in the base's range.

## 7. The tuning logs

### The crust (Task 5, 5b, 5c)

Task 5 (look-dev, `t5-try*`): T1 the brief's `sandC` null (flora silt 0x2c3d4a) read as stratified grey stone; **T2 `sandC` 0x3f4744** (zone 0's seabed
silt, the dune's own albedo) hollows a shade warmer and tied to the dune, shipped; T3 T2 + sand 0.9 showed no gain at 6-10 u. Thorns contingency not built (the
crest outline read as broken slabs, not spines). Programs: her body already compiled four lighting variants on the base; each now carries `|crust` (the
"exactly one" bar was re-derived to `crustBoot`).

Task 5b (after "it doesnt really read a rock"): crest 6.0 / 6.5 / 7.0 at `crestW` 6 left the exposed rock at 169.9 / 171.5 / 171.8 u^2 (a rock plate on a sand
hill) and the claws +1.52 / +2.02 / +2.52; `crestW` 10 / 14 / 20 / 40 at 6.5 gave 261 / 355 / 500 / 654 (legs fail at 40); 7.0 at w20 fails legs +0.22. Chosen: crest
6.5, `crestW` 20 (500.09 u^2, 5.25x). The claws, folded under her prow (1,647 of 1,661 vertices enclosed in her drawn shell; 14 not, worst +1.90), are laid by
`BURY.clawSink` 3.0 u. Crust looks `shell` / `light` / `stone` behind `CRUST.look`; growth +90 weed, 11 of her 60 kept (28 outside the strip, 21 over the iron),
coral 4 fans / 10 crusts / 10 lumps / 4 tubes. Home cost of the crust: liveAB z0b -0.12 / +0.04 ms (noise).

Task 5c (after "should be her shell but lightly covered in sand"): look `sand` shipped (sand on up faces and hollows, edges bare), drifts fade over `uBury` 0.25 -> 0, the
sand noise anchored to her BODY (`vCrO`). Concern recorded: from 20 u she reads paler (a ledge of sand and shell) than the stone look. Cost z0b -0.012 / +0.065 ms.

### The plume and the blind window (Task 8)

Trial 1 (the brief: life [6.5, 8.5], rh0 3, rhA 13, hvA 6, ring 6): blind 3.017 -> 9.483 s = 6.47 s by line of sight (bar 3-4), footprint 24.25 u (bar 15-20), climb
0.5 u (bar >= 3): the spawn points were already 12-16.5 u from the strip centre, so rhA 13 spread it to 24 u. **Trial 2 (shipped): life [5.5, 6.5], rh0 2, rhA 3, hvA
12**, sheets at ring 5: blind 3.2 -> 6.633 s = 3.43 s, footprint 18.0 u, climb 4.5 u, `quadEv` 0, `riseEv` 0. At the anchor the first spell ended after one frame by
the bump rule (he stood 4.6-5.2 u off her spine, inside the 5.34 u re-find), so `BURY.shoveV` was scanned: 7 touch-ended / 8 2.97 s crest (g) FAIL / 9 3.55 FAIL / 9.5 4.30 FAIL
/ 10 4.25 / 10.5 4.20 / **11 3.93** / 11.5 2.85 / 12 touch-ended. 11 is the only value in band with the crest passing, 0.07 s under the 4.0 s limit: a feel target at one
spot. The pool: emitted 1,650-1,850 puffs a rise with 280-514 live-slot overwrites (the rise's puffs evicting his boot puffs) before the `BURY.dust` budget; 1,206-1,416
emitted and 0-6 overwritten after.

Other tuned values on the record: `riseVmax` 6 failed `velkath-crack` shell clearance at home (2.89-2.98 against 3.0), 7 passes (3.60-3.74) and holds (d) at 7.02;
`POINT.turn` stays at the pre-registered 0.5 rad/s (Michael's "1"); `digT` 17.5 s; the dig-in's slices 2.5 ms -> worst +5.2 ms over the median (FAIL), 1.0 ms -> 3.8-3.9,
0.8 ms with the first frames split and the limbs captured -> 3.5-3.7 (the base has a +2.5-2.9 ms beat every ~23 frames).

## 8. The campaign: fight parity (Task 14)

Paired 48 fights, branch `8f3f7ee` (tool commit) against main 644879b, home, seeds 1-12 x perfect / average, clock plugged (drift exactly 0 in all 48), both builds on ground
`5c0705a1`, both arms ran the branch's `ritepolicy.mjs`/`riteplay.mjs` (his height read as `max(terrainH, extraFloorAt)`). Evidence `reviews/buried/campaign/` (`RESULT.md`).

| bar | verdict | numbers |
|---|---|---|
| (a) per fight | PASS | 24/24 calmed within 240 s, no death, console clean (main 24/24 too) |
| **(b) time per mode** | **FAIL (perfect)**, PASS (average) | perfect: branch median **73.5 s against main's 49.7 s**, ratio 1.479, Mann-Whitney p 0.0073 (exact 0.0056); average 56.8 vs 49.2 s, ratio 1.154, p 0.84 |
| (c) first half, gated | PASS | 8/12 in 45-165 s with <= 3 hits (0.667) against main's 7/12 (0.583); bar 0.500 |
| (c) second half, booked | not gated | branch median average 56.8 s, main 49.2 s, both inside 45-165 |
| (d) ward column | PASS | branch max 12.88 <= main max 12.98 + 0.5 |
| (f) hunting stance | PASS | `wardHuntP50` main 10.120, branch 10.070 (bar +-0.5) |
| (e) hits, booked | not gated | average: hit in 8/12 fights (13 hits: slam 5, leg 6, shell 2) against 3/12 (5 hits); perfect 1/12 against 2/12 |

The STOP RULE fired ((b) failed), so the campaign closed as data and nothing was tuned. THE DIAGNOSIS (Opus, not a campaign; evidence `campaign/diag/`): the perfect bot's +31 s to its
first ward is the scripted policy meeting the designed opening, where Sal stands on her crest when he pulls: the off-back rule fires (+2.3 s), a failed in-water dash then a
drop (+3 s), and the policy's walk-only close-in stall on her flank while she turns at about his walking speed (+22.5 s; main's bot hits the same stall, mirrored, in 2-3 of 12).
The Step 1 tool change contributes 0 s (the extra floor is gone by 5.5 s; terrainH-only reads give the same decisions); the burial after the stand ~0 s (teleported to main's
point: first ward 10.5 s, calm 43.6 / 46.5 / 45.9 s); the blind spell ~0 s; her hammer's threat starts ~2 s later, which favours the player. Hits are not why: perfect 1 against 2.
**The (b) FAIL stands as registered data and is not waived. The opening is kept by ruling (moving him off her back would undo Michael's design), and Michael was told plainly:
unless he says otherwise, nothing moves.** The average player's extra hits (p 0.10, no mechanism; 12 of 13 in the fight proper, none on the dune or crest, 1 in the opening
during the blind spell, 1.18 against 0.47 hits a minute; a seed-5 re-run did not reproduce) are booked for his look (Q6). START in her frame is fwd -0.53 / lat -0.23 / rho 0.57 R
on the branch against main's -0.81 / -0.59 / 1.00; every branch fight loses him at 5.2-5.9 s (ledger time) and finds him after 3.35-4.93 s. One pair was re-run on a main
boot timeout (no selection effect); same-seed branch fights are not reproducible to the second (79.0 s against 83.4 s).

## 9. The cost (Task 15)

Cross-load ABBA, 3 runs x 4 cycles, main 8887 (644879b) against the branch, headless Chrome, branch minus main, ms per frame:

| view | run 1 (noisy, A/A 1.6 ms) | run 2 | run 3 | runs 2+3 | all 12 (se) |
|---|---|---|---|---|---|
| **z0b** | +0.185 | -0.130 | -0.248 | -0.189 (worst +0.016) | **-0.06 +- 0.12** |
| **near** (8 u off the strip, breath moving) | +0.015 | -0.177 | -0.245 | -0.211 (worst -0.064) | **-0.14 +- 0.08** |
| z0 control | +0.130 | +0.072 | -0.002 | +0.035 | +0.067 (0.04) |
| z1 control | -0.162 | +0.034 | +0.037 | +0.035 | -0.031 (0.04) |

Bar (<= +0.3 ms at z0b and near): PASS both; pooled 95% upper bounds +0.20 and +0.04. The breath's rewrite moved in all 24 branch near loads and costs ~0 ms (near minus z0b per cycle
-0.07, se 0.05; the near window was aligned to the breath's onset, the worst case for the branch). The near spots differ by 6.0 u between builds (the branch's strip is wider), so the near
delta is a cross-build scene difference, not a cost. The plume's sight rule is ~3.0 us per call with ~10 records, **about 0.003 ms a frame**; the rise window itself read -0.81 ms (her
rise against main's wake). Other costs on record: the crust at home, noise (z0b -0.012 / +0.065); the fit 12-14 ms (+ ~10 with the envelope) and a re-bed 165-175 ms are one-off events,
the dig-in runs them as 0.8 ms slices (worst frame +3.5-3.7 ms against the pre-registered 4.0); `bedDown` is ~7 ms slower (the generators' deadline checks) on boot, zone entry and voyage.

## 10. Review Focus 1-5

1. **Leaving zone 0 mid-rise, mid-point or mid-dig and coming back** (`burial-probe reentry`, i mid-rise, ii mid-point, iii mid-dig, iv mid-JOB): PASS in all four. She is rebuilt at her bed,
   dormant, `bury` exactly 1, the disguise checks pass, `__pointcam` k 0 and the new sleeper's pointPh / pointK / calmNext / digging / dugIn clear, `extraFloorAt` equals the LIVE sleeper's drawn dune
   at >= 100 mid-quad points (a disposed sleeper's dune is never solid), the clutch hidden (-0.491, drop = clutchSink / R), `__shaderFailed()` []. A second rise after a dig-in works (the old wound
   pressed, wake 2.18 s, the growth reveal 0.017 -> 2.517 s, the point, a second dig-in 17.5 s) and leaving mid-JOB was added after the Task 12 review (I1). RED `keepdig` exit 5; `mem2` exit 5.
2. **Standing on the crest or the dune when he pulls** (`rise` with `BP_AT=crest`, also `anchor`/`off`/`front`/`dune`/`under`): the crack shoves him off with a stagger, no tear (0), never into the crack
   (`safeThrow`), the footing carried by her body and never the floor under her belly (the live 17 u lift of a man under her belly was found at the 7a review, C1, and fixed). Parked: the anchor's
   (e) lens frames (a leg's last capsule on 2 frames at 3.22 s, then 1 frame at wake + 2.93 s at the final head) and the one lens-in-shell-proxy frame at about wake + 4 s (no drawn hit under an every-frame
   drawn-surface ray); bar (g) at the anchor was parked, then PASSED once the shove carried him clear (shoveV 11).
3. **On the dune when the dig-in would start, or mid-dig, afloat over it too** (`digin` pause / afloat / crest): the dig-in pauses (313 / 180 / 180 frames of constant `bury`) and resumes in 60 frames after he leaves;
   boots never under the drawn sand (min -0.027), the lens never inside it (min 3.61 u). The crest run found a real hole (M1: a man on her crest top read as off her ground, so the dig-in ran under him; 180 of 180
   frames moved on c3eaa00) and `onHerDune`'s ceiling now includes her shell top.
4. **A save made before this change** (`relief-load oldsave`, `harpoon-probe rite`'s revisit, reentry iii/iv's second rise): with `pulled[0]` set she is buried with the OLD WOUND at the seat; "[E] PRESS THE OLD WOUND"
   raises her the same way and grants nothing. PASS. The near-flank bar for a buried seat was re-derived (Task 4). The scar itself does not read visually (Q5).
5. **A voyage from home to Pallid and back** (`relief-load voyage` plus `voyage-pallid.mjs`): PASS (section 6). Nothing stands on home's dune at Pallid during the reseed or after it; `extraFloorAt` is -1e9 on a 2 u grid round both beds;
   Pallid's 9 dens lie on its floor exactly; Pallid is the shipped ridge (row-built `014f3101`); home again is buried with the same anchor. The RED (the site key removed) reads the dune during the reseed (-271.217).

## 11. The open readings

Parked, booked, or follow-ups. None blocks the merge unless Michael says so.

- **The anchor rise (e) lens frame.** Standing at the harpoon's anchor, the lens passes through her leg's last capsule on 1 frame (2 at Task 7a), at wake + 2.93 s, while the shove carries him and she turns. Parked to the fight-camera follow-ups (game.js lens; same family as the claw-proxy residual).
- **The shell-proxy frame at wake + 4 s.** One frame, 11 of 15 runs: the lens within her shell PROXY (an over-reach of 0.2-0.8 u), no drawn clip by an every-frame drawn-surface ray across wake .. wake + 6 s (3 runs). Parked with (e).
- **The resettle under load (the gate route's timing).** Under load the post-calm route failed to re-rise in 2 of 2 runs of the first sweep (alone 3 of 3 fine; base 1 valid run re-rose, 2 invalid); the head's 4 of 5 re-rose. Cause: the gate parks Sal off her short flank, 11.4 u to cover at 1.6 u/s against the 3.75 s settle window. The settle and re-rise rules and `SETTLE` are untouched `644879b..HEAD` and the dig-in is inert (bury 0) during it. A rare missed re-rise when he returns to her short flank; the point's turn may change where Sal parks.
- **The boot-tail shadow warm (9 first-sight programs, also on main).** On first sight near her three's depth and distance shadow variants (`mapUv` 'uv') for her mapped casters compile (+9: 2 depth + 2 distance + 5 physical, identical on main). A boot-tail warm of the lantern's shadow pass over her would build them: a small separate game.js change.
- **`terrainH`'s allocation (~470 B a call).** Pre-existing boxing in terrain.js `heightAt`; ~80 MB a fit. It is the GC that threatens the dig-in's 4 ms margin (no scavenge landed in a slice in 6+ runs, but a GC-inflated slice on a beat frame would exceed 4.0) and every fit. A follow-up card.
- **The clawcam bonnet flake (also on base).** `clawcam-probe framing` "bonnet, 30 u ahead" fails 2 of 5 on the head (316/319, 318/319) and 2 of 6 on 644879b: pre-existing.
- **`digStep` does not restore `L.bury` on a throw.** Its `finally` puts `L.noPub` back but not `L.bury`: a throw between `L.bury = 1` and `L.bury = 0` (the capture pose and the fit's prologue) would leave the drawn pose at bury 1. Drawn pose only; parked at the Task 12 re-review.
- Also booked: the strip's exact contact (boots to +-1 u on her lips; `RW_PARKED=strip`), the relief-walk boots provider bar fixed by `BED_STOP` 37 u; bar (g) at the anchor passes now (a carried diver rose ~1.65 u/s after a fall at shoveV 5; gone at 11); the home rope sits -0.030 .. +0.048 u of the drawn ground (the +0.05 bar has 0.0015 u of margin; deterministic); the breath's +0.045 u lifts faces on rings 1-4 to 34.93 deg for a few cm (transient); the `exposed` bar would have passed the rejected plate-on-a-hill look (judge on `face` if reused); `shoveV` 11 sits 0.07 s under the blind window limit; the claws come up 3 u more than her body in the rise; the average riteplay bot's fights ran longer with lensfix's lens (unexplained, base); the fullplay-gate `FP_UNTIL` is recording-only.

## 12. Every ruling in the ledger (grouped by task)

70 rulings, each with the decision, its reason and the cost if wrong, as recorded. "Controller" = the orchestrator.

### Pre-flight
1. The cross-task scan rests on the two independent plan reviews (Opus: 5 Critical / 14 Important / 12 Minor; Sonnet re-review: all closed, 1 new Important + 12 Minor, fixed) plus spot-checks, not a third read of 2,241 lines. Cost if wrong: a mismatch surfaces in a task review.
2. Implementers and reviewers RETURN their full report as text (the harness refuses subagent report files); the controller saves it; reports stay <= 60 lines, probe JSON and logs go to `reviews/buried/` and `shots/buried/`. Cost: more controller context per task.
3. Model per the plan's header (Michael's policy): Sonnet for Tasks 1, 6, 9, 14-17 and tool-diff reviews; Opus for 2-5, 7a, 7b, 8, 10-13, game-code reviews and the final review.

### Task 1
4. `BP_RED=ridge` judges sides AND the crest group, where the crest group fails if top OR len fails (reading (a)); main's ridge is 19.8 u, inside 16-24, so length alone can never fail it. Nothing loosened. Cost: a later `{on:0}` RED could pass on length alone, which no task relies on.
5. A crest with n = 0 (no shell vertex over the sand in the strip) is FAIL, not UNMEASURED: a crest sunk under the sand is a real disguise failure. Cost: a probe artefact reads as a failure (the safe direction).

### Task 2
6. `height` is an alias for `top` in burial-probe (the brief's command named `height`, its Expected line the crest height): a naming fix, no bar moved.
7. relief-load `all` failing on the LIVE anchor / oldsave seat at this head is the expected intermediate state (the sunk shell's flank band is under the sand, so `seat()` falls back beside her); Task 4 owns the crest seat and the re-record; this head is not served for play. Cost: Task 4 inherits a seat break it must explain.

### Task 3a
8. D1-D6 accepted: the brief's fit verbatim failed its own `sides` bar for measured causes (blended per-bearing queries vs the drawn mesh, coarse `topAt` at her lip, profiles stopping at the first floor contact, fronds judged by root); each keeps the knobs and serves "nothing but the crest stands above the drawn sand". Cost: a bigger dune than the plan's numbers, judged at Michael's checkpoint.
9. P1-P3 accepted: P1 strengthens the growth check (every vertex, none outside the strip); P2 a measured FAIL outranks UNMEASURED and a RED judges only its own bars; P3 restores main's record for the ridge RED. Cost: none (no bar loosened).
10. C1 (the starburst: per-bearing run-outs left thin rays and dark AO wedges, seen from above and at 10 u) is a correctness defect addressed BEFORE review: the 2D repose envelope on a polar need grid, same knobs, plus a NEW pre-registered bar with a RED (no drawn dune slope steeper than repose + tolerance, outside the shell-cover zone), which 86fd2ba must FAIL first. Cost: ~10 ms more per fit (a one-off at bed and dig-in).
11. The probe's switch to reading triangles from the mesh index after pre-registration is accepted (the fit picks each quad's diagonal, so the fixed split would judge triangles not drawn); the re-run on 9829f9a with the final probe gives the identical RED (162 / 52 / 19). Cost: none.
12. N1 fixed by decoupling (reviewer's option a): "the strip" for the checks and `prepGrowth` stays the brief's ring 0 + 0.6 u; the shell tips in the widened row-0 ramp are covered so `sides` passes at +0.02. No bar moves. Cost: a little more sand at the strip's ends.
13. (Amends 12) Removing the lean-limited contour instead of decoupling is accepted: it makes ring 1, `inStrip`, `prepGrowth` and the probe one line at the brief's band, more simply (the decoupled route would have forced ring 1 up several u and broken repose). Cost: the settle carries the strip ends at its 0.5 u cap, so any crest-knob change re-runs disguise.

### Task 3b
14. (Advisor consulted; `task-3b-ruling-1.md`) Re-derive the strip measurement first (exact ray hits against the drawn triangles at every vertex of the planted sole: penetration none under -0.15, contact p95 <= 0.15; bar numbers unchanged; pre-registered, RED shown on 713f13a and 4cb3b06), then the floor as option (b): a walkable envelope baked at `fitMound` from exact hits; ONE footing surface `max(dune, envelope)` read by player.js, diver.js, `shutFloorY` and the shell cap, named apart from `crestY`/`sandY`; re-record RW_MAIN on buried-main; add a provider-seen counter (must be 0). A measurement whose error exceeds its bar is re-derived, not loosened. Cost: the crest's look (lips/spines) goes to Michael at Task 5 if the envelope can't hold the bars.
15. Ruling 1 (controller 2026-10-18): measure the strip exactly; the floor = option (b), a walkable envelope. Probe 32a07f4 pre-registered before any floor change; the REDs shown on 713f13a (0.679 / 1.566 / 0.970) and 4cb3b06.
16. The strip's exact contact / penetration bars are PARKED for Michael's Task 5 checkpoint, per ruling 1 item 5: the v2 envelope holds floor (p95 <= 0.008) and dune (<= 0.032) but not her crest (a max filter keeps her lips vertical, so a rigid sole beside a lip hangs to +2.08 or cuts in to -1.51); only reshaping the lips (a look change) fixes it. Cost: boots hang or clip near her lips until he rules.
17. Ruling 2 (strip bars parked for Task 5): shell contacts fixed by 9362503 (player.js: his floor is the higher of the frame's start and end on her footing; -1e9 elsewhere, never fires); mound GREEN with shell 0 / 0 / 0.
18. The parked zone is the strip plus the footing envelope's own reach (`r + h*sqrt2`, read from the build, not a new number), because there the floor IS the parked envelope; a sole with any vertex within it is booked as strip. Cost: a few dune samples at the strip's rim go ungated until Michael rules.

### Task 4
19. NOT the "no seat" stop: a seat that is buried in the rock AND in reach exists; the zero was a plan defect in the `side` filter (a bearing from her centre means nothing near her keel). Option (a): drop the bearing `side` test in the buried branch; the facing test (ns >= 0.35), the back half and the crack keep the seam on her sand-facing back. Cost: the seam may sit on her keel line rather than her flank; Michael sees it at Task 5.
20. The scan's coverage stands as MEASURED: the full-shell gather leaves the counts unchanged, so the 83.6% / 87% shortfall is the `under` test's own definition (a point inside a thin knob exits its far face), not a data gap. Cost: none to play.
21. `relief-walk.mjs` is added to Task 4's file list (line (c) walked from the real anchor).
22. The scan's dev-only diagnosis options (`side`, `keelR`) may stay as scan options if they never run in `seat()`.
23. Option (b) in its independent form: add an `iron in her` bar to disguise, pre-registered with 9e6a01b as its RED: the head and shank points lie INSIDE her drawn shell by exact hits AND `seatOk`; the probe must not rely on `seatOk` alone (the code grading itself). Cost: none to play.
24. Re-derive the near-flank bar for a BURIED seat by its intent (he reaches the iron from the open sand, never from over the crack): judged on the stand spot `(anchor - L.pos) . L.sand > 0` AND the seam's normal toward the sand (`n . L.sand >= 0.35`); the shipped bar unchanged where she is not buried; applied identically in harpoon-probe routes and relief-load oldsave. Cost: an iron on her keel line, which Michael judges.

### Task 5
25. `vsBase` (no program in play beyond the base's, at every checkpoint) stands as Task 5's "no compile in play" gate; the `rise` bar's one MeshDistance compile fails on the base too (pre-existing, later not reproduced), carried to 7b; the "exactly one '|crust' program" bar was re-derived to `crustBoot` because her body already compiles four lighting variants. Cost: a first-rise hitch stays until 7b chases it.

### Task 5b / 5c
26. The claw stop rule is met in letter but not in intent: the claws over the sand at 6-6.5 u are folded under her prow inside her drawn shell (1,647 of 1,661 vertices enclosed; 14 not, worst +1.90); `BURY.clawSink` 3.0 u (home only, bit-identical off home) lays them where they were at Task 5; accepted. Booked for 7a: the claws come up 3 u more than her body in the rise. Cost: a claw pose Michael may notice in the rise.
27. Probe re-derivations: (a) the mound grid inside the crack's lip reads the shut jam, (b) programs framing fixed at 23 u from the strip centre with the base re-run on the same probe, (c) breath judged from the strip's edge at 18 u, (d) rise as info under `BP_BASE` / lazy refused without it. None moves a bar; each follows the bigger strip. Cost: none to play.
28. (5c Minor 1) Anchor the sand noise to her BODY (object space, a varying from `transformed`, no key/define change), not the world: the cover is sand lying on her and must ride her as she rises and breathes; the falling sand belongs to the pour particles. Folded with Minors 2-4 into one Sonnet fix. Cost: none (source-only).

### Task 6
29. Option (a) by the 5b method: her live clutch lobes become sources of the dune's pile, with the same cover, so the sand drifts over the spill tongue; no eggs to see while buried. The check and its bar stand; the RED is the WIP probe on ddd8133 (exit 1, 0.711). Cost: the dune grows a little at her apron's spill side.
30. (Amends 29) The dune-source route cannot work (lobe 17 straddles ring 0 inside the strip's band, where no dune exists). Option (1): the spill lobes outside her rim drop by an extra amount scaled by `L.bury` (`clutchSink`, like 5b's `clawSink`); at bury 0 exactly as shipped; the soft-solid clutch collision and the take point follow the live lobes. Cost: in the rise the spill tongue comes up ~0.8 u more than her body (booked for 7a).

### Task 7a
31. Bar (a) is split per RED: `tearable` judges `aTear`, `early` judges `aHammer` (threatE / nsT), the GREEN judges both; a RED must fail for the reason it names. Cost: none.
32. `BP_RED=tearable` re-derived to a forced-contact case: Sal held in contact with her rising shell through the window the hold adds (shipped `rising` ends ~6.0 s, STOOD ~6.73 s), hitV above the slam threshold; with `holdRise` off it must tear (exit 5), with it on 0 tears. Cost: none.
33. Bar (d) <= 8 u/s STANDS. The shipped rise's sole floor carries her shell up 12-18 u/s for ~0.3 s at ~4.3 s; the spec asks for "a slow, heavy rise of about 6 s", so a HOME-ONLY rate limit on the sole lift while she has not stood is within the spec, not a new feel call. Cost: a slightly softer last metre of her rise at home.
34. Footing must track what is DRAWN through the rise: the dune floor follows `moundK` as it draws down and her crest footing follows her rising shell, never vanishing on the wake frame (he floated 6.7 u for 1.5 s); the shell cap holds while `bury >= solidK` so the uncapped, non-slick shell can't throw him up (0.7 u in 2 frames). Cost: none to play.
35. Bar (g)'s third amendment (after the fix's first anchor run: walking up her rock at 6 u/s, her lip turning out from under him) is accepted ONLY because the REDs were re-judged from their saved series and still fail, and both allowances describe motion the player or she causes; the task review must check "the lip turning out" cannot excuse him floating (he must descend toward ground at the suit's settle rate). Cost: a floating moment at the anchor goes unjudged.
36. The anchor's 2 lens-in-leg frames are PARKED to the fight-camera follow-ups (game.js lens, orchestrator-owned; the claw-proxy residual family); Task 13's lens gate re-reads them. Cost: two frames of camera inside her leg during one rise path.
37. Option 1, grounded in the spec ("Her rising body shoves him back ... cannot tear the dress") and a measured base property: in (g), while he is in contact with her shell collider the fall's sink rule pauses, his rise rate may not exceed her body's + 0.3 u/s, and his gap over her DRAWN shell may not exceed 1.0 u (the proxy's over-reach plus margin); out of contact the sink rule applies. Pre-registered in the probe header. Cost: a carried diver 1 u over her shell during the rise is accepted.
38. "In contact" for (g)'s carry rule includes a 0.25 s grace after each shell contact (resting contact on a rising surface flickers); the magnitude bounds stay exactly as ruled. Last relaxation for this bar. Cost: a diver riding her flank on intermittent contact is accepted for up to 0.25 s per gap.
39. (Inline in the ledger) Anchor (g) parked: a carried diver rises steadily at ~1.65 u/s while her body's own rise swings -0.24 .. 1.86 u/s over 3.27-3.53 s (gap <= 0.90 u): real but not load-bearing (no tear, no clip into her, within the proxy's over-reach); to the final review and to Michael's look (does riding her flank read right?). Cost: a brief upward drift off her flank after a fall. (It passes from shoveV 11 onward.)

### Task 7b
40. Deviations accepted: (1) no rock kit (it reads as stone; the direction was sand), (2) `slabTick` after `poseAll` (the current-frame body matrix), (3) the pour spawns between the drawn P and the fitted M (spawning on M floated puffs over a drawn-down dune), (4) the probe's shell read as the highest of 5 rays +-0.05 u plus an inside-test, after a dense scan MEASURED 0.01-0.03 u slits in her sculpted shell (285 / 39,600 and 58 / 14,520 rays); the bar is unchanged at 0.3 u. Cost: <= ~0.1 u of slack on her steepest faces.
41. Do NOT widen the bound to fit. Fix the game: find why piece 7 sits 0.35 u inside her shell at 1.68 s and seat / move the clods so depth <= 0.3 at every placement (done: the seat dips at most `SLAB_DIP` 0.1 u under its own read and a piece whose five reads span > `SLAB_STEP` 0.35 u bursts into silt; iShell max 0.094). Cost: a clod briefly clipping her shell.
42. M3 is large (the rise's puffs evict his boot puffs and the slab bursts for seconds): tune the rise's emitters so live-slot overwrites per rise are <= 50 at every placement, booked in `info.dust`, without the rise reading thinner than the t7b stills (done: `BURY.dust`; 0 at five placements, 6 at the dune). Cost: a slightly thinner pour.

### Task 8
43. Probe amendments accepted: footprint / climb read the rise kind only (amended BEFORE any build: her own footfall clouds read 28-30 u from 4 s, so the bar could never pass); `blind` judged only where a cloud lies between her eyes and him (anchor, off 12 u), geometric not fitted.
44. fissure-probe `velkath-crack` failing (her shell 11.77 off the lip, bar >= 12; 13.07 with the plume off) is a regression the plume causes (blind, she doesn't circle, she drifts to the keep line at a kinked spot): fix it HOME-ONLY (under `L.buried`) so her keep holds her shell off the lip while blind; the shipped keep at other anchorages unchanged; `velkath-crack` must pass at home, Pallid and Burned (done: `keepShell`, 14.13 u). Cost: a slightly different blind drift at home.
45. The anchor is where he stands when he pulls, so its blind window must be real: the crack's shove (`BURY.shoveV`) must carry him clear of her bump re-find distance (5.34 u from her spine plus margin), so the SIGHT rule's touch re-find does not end the spell the frame after; then the anchor's blind is judged like off. Cost: a longer shove at the crack.
46. Re-run the 7a/7b REDs (noshove, tearable, early, nofoot, sunk) on the final head (done: all exit 5).
47. `shoveV` 11 accepted with its fragility on record (scan: 7 touch-ended / 8-9.5 crest (g) fails / 10-11 pass / 11.5 2.85 s / 12 touch-ended; 11 sits 0.07 s under the 4.0 s limit at the exact anchor): the 3-4 s band is a feel target at one deterministic spot, not a contract a real player's position reproduces; the shove's strength (11 u/s, ~8 u slide) goes to Michael's look as a feel item. Cost: a harder shove than he wants at the crack.
48. (Review Minor 1) At `shoveV` 11 the crest DOES lose him (tau 3.87) for 4.283 s, so the header's reason for not judging it is stale. `blind` is judged at the anchor and off 12 u (the spec's frame); every other placement is booked as a reading because 3-4 s is a feel target; the crest's 4.28 s is on record for his look. Cost: a slightly longer blind window if he climbs her crest before pulling.

### Task 9
49. The `limGR` bar is vacuous (the limiter never engages on either build, max 0); the level evidence is RMS / peak (branch RMS mean -33.71 .. -34.34 dB against main -33.93 .. -34.63, ~0.3 dB inside run spread; peak max 0.095-0.105 vs 0.093-0.103), accepted as "a crack and a hiss, not a wall". Caveat: the level evidence is weak (measured ~100 u from her, not at the anchor; 10 Hz peak reads can't see a 2 ms crack). Cost: Michael's ear.
50. (Corrects the controller's own direction) The quake and the 11 u/s shove fire at the wake (`crackBeat`, t 0) and the crust's crack OPENS over 0-0.8 s, so delaying the crack sound to +0.8 s put it after the jolt. Revert to the brief: `velkathCrack` at the wake's t, the hiss at t + 0.6; drop `L.crackDelay`; the emit slot covers the buried hiss tail (8.5 s when buried, 7 shipped). Cost: Michael's ear (the single knob is the crack's offset).

### Task 10
51. The walk bar amendment is ratified: she hunts from her bed, so the shipped walk branch clears `walkTo` the same update and goes to `homeTurn`; the bar is "walkTo or homeTurn, and neither while pointPh > 0"; no build change. Cost: none.
52. `faceMax` 14 s (raise anyway if her turn is blocked, so she can't stall) and aiming at the target heading are accepted: both keep the ruled behaviour and close a stuck state / a 19.19 deg near-miss (back aim 19.19 -> 10.04). Cost: none.

### Task 11
53. Concerns 1-3 fixed BEFORE review, consistent with "framing her claw where it can" and the house CLAWCAM rules: (a) the cue eases in at the RAISE (pointPh 2), not at the calm (at `back` the lens sat on the opening ~6 s before her claw moved); (b) a CLAWCAM-style bonnet guard (Sal's helmet stays in frame, the cue taking only the rotation that keeps it); (c) a BOSSCAM-style front test (an opening behind the lens past the caps frames her claw within the caps, or stays off). Bars re-registered with REDs first. Cost: a gentler camera move than the spec's literal wording.
54. `close` re-registered to 0.5 x min(theta_pre, 70) (0.8 booked as info): with his bonnet held in frame the turn tops out at ~42-44 deg, so 0.8 x 61-69 deg is geometrically unreachable; the bonnet guard outranks the literal ease. Cost: the lens turns less toward the opening.

### Task 12
55. The pause-run procedure change (a real walk-off instead of a 35 u teleport that dragged the follow lens 13 u through the ground, with the span from 60 frames after placement) is accepted: the teleport was a probe artefact, the bar text is unchanged, the real walk is the stronger test. Cost: none.
56. (Review M1, the coordinator's ruling) `onHerDune`'s ceiling must include her shell top under him (plan-level fix accepted: mid-dig her crest isn't ground, so the dig ran under a man on her crest top). Cost: none to play.
57. The two second-rise probe readings amended after data are accepted: `pressed` is set when the wound gives (after the 1.5 s wrench), so reading it on the E frame was a probe error; a rebuilt "remembered" sleeper dim-lights one ward by design (shipped memory), so `rise.c` allows that ward only (Task 13 later barred its count: `memN <= 1`, RED `mem2`). Cost: none to play.

### Task 13
58. `velfix` `lensSurf` is judged against the base, as lensfix's own accepted GREEN (nonzero `lensSurf` 5/12 there; same claw meshes): PRESSED / `lensEggs` / `salIn` / `salCalm` 0 everywhere; FLASH / CLEAN in the base's range. Cost: a few claw-surface frames already shipped.
59. relief-walk boots `BED_STOP` was derived from the shipped ridge (R x 1.7 = 26) and Task 5b's dune reaches 25.1 u, so it is the brief's exception: re-derive the bed route's stop as a FIXED distance clear of the dune plus the boom (>= 25.1 + 9.5 + margin = 37 u), the same constant on branch and base so the lens like-for-like holds; re-record the lens base on buried-main; RED = the 26 u run. Cost: probe only.
60. The rise-time lens-in-shell-proxy frame (1 frame, 11/15 runs, ~wake + 4 s, no drawn hit) is parked with anchor (e) in the fight-camera follow-ups, AFTER the fix round confirms with an every-frame drawn-surface ray whether any drawn clip occurs (it did not). Cost: one frame of lens in her shell.
61. The clawcam "bonnet 30 u ahead" flake is pre-existing (base 2/6): parked.
62. B (the resettle under load) is the gate route's timing against the shipped settle window, not a branch regression (the rules are untouched and the dig-in is inert); booked as an observation for the fight-camera follow-ups. Cost: a rare missed re-rise when he returns to her short flank.
63. C's shell-proxy frame parked with anchor (e) (proxy over-reach, no drawn clip). The weed-on-lens 4 frames joins Michael's growth look item; the wake + 0.8 s "Mesh:18" hit goes to the Task 16 frames check (resolved: a weed frond). Cost: a few frames of foliage on the lens.
64. `BON_REL` back to the shipped 0.005 (pointcam bonnet tolerance): the data shows no need for more. Cost: a flaky bonnet bar on a pressed run, re-openable with data.
65. `TH_IN` 76 stays only with a RED (a knob that puts the opening out of frame while thetaPre is 70-76, judged by inFrame, exit 5) plus its derivation from maxYaw 75 and the 0.85 NDC frame (done: `PC_RED=inband`, 145/145 band frames out); else it reverts to 70 and accepts VOID on pressed runs.
66. Commit the Pallid voyage checks as a repo probe (`tools/bench/voyage-pallid.mjs`) with the RED exit-5 convention, so the next sweep can rerun them. Cost: one small tool file.

### Task 14
67. Per the stop rule the campaign closes as data; nothing is tuned and no bar moves. Before bringing the opening to Michael, a diagnosis (Opus, not a campaign; no gate) separates the cause: the tool change, the bot's route from the new opening plus the blind spell, a game-code effect; and places the average player's extra hits. Cost: Michael would get a decision framed on the bot's quirk instead of the game.
68. (b) FAIL stands as registered data and is NOT waived. The cause is the bench policy meeting the designed opening (Sal pulls the iron standing on her crest: Michael's own design); moving him off her back would undo the design. The opening is kept, and Michael is told plainly: unless he says otherwise, nothing moves. The average-hit rate (p 0.10, no mechanism) is booked for his playtest look. Cost: the first 30-45 s of the fight reads differently for a skilled player, and he can still ask for it moved.

### Task 16
69. `FP_UNTIL`'s "stand off her ground" is implemented as walking off then facing her: the follow loop's last action is ON her ground, so the brief's literal wording contradicts its own intent; intent wins. Cost: none.
70. Video duration +-1 frame is judged against `gameSec` (met, 1 frame); the 2-3 frame gap to `stepped` is the harness's PNG `shot()` frames outside the grab: accepted. Cost: <= 0.05 s on a take.

Michael's rulings (his own words) are in section 2; the "CHECKPOINT" ledger lines are those rows. The ledger also records the review outcomes (every task's spec and quality review, the fix rounds and the findings files
`task-*-findings-r*.md`) and the deferred minors; the ones still open are in section 11.
