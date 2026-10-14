# The sea-floor relief, home zone 0: the record

2026-10-14 · branch `relief` (cut from main `bf514e9`; head `d9dcec5` plus this record; nothing pushed) · spec
`docs/superpowers/specs/2026-10-13-seafloor-relief-design.md` · plan `docs/superpowers/plans/2026-10-13-seafloor-relief.md`
(14 tasks, built subagent-driven).

Michael: "the sea floor is all one level, like a big pit. Lets make that more dynamic but keep velkaths lair in the deepest part."

The ledger of every ruling (Rulings 1-54, each task's outcome, his words where he ruled) is
`.superpowers/sdd/2026-10-13-seafloor-relief/progress.md` in the worktree. It is git-ignored, so the rulings this record and
CLAUDE.md cite are restated at the end. The task reports sit beside it (`task-N-report.md`). Numbers below are from those
reports. The offline gates were re-run on `d9dcec5` for this record (validate 10/10, gates exit 0, cost 1.16); no browser
probe was run for it.

## 1. What shipped, in one table

| Area | Result |
|---|---|
| Terrain | Home zone 0 only: THE UPLANDS (additive, masked) and THE HOLLOW (bearing-varying, two treads, her flat), keyed to frozen geometry. The crack takes only the hollow's uniform part: lips 1.18 u apart (was 1.17), throat floor -315.3 (unchanged). |
| Anchors | Home `__ridge.fp()` **5c0705a1** (was 3b526986). Zones 1+2 d49d451d, Pallid b1c58f8d, Burned d2b6fb68, the shelf e5a8d9bf: unmoved. `sleeperFingerprint(0)` **1ca3b28c** (was ecfa371e). `__lev.fp` unchanged. |
| Velkath | Takes her designed raft-side station (89.7, 39.1). Turned in place, harpoon seat on her back half, stance +0.55 u (Michael 2026-10-14). |
| Skiff | Searched 100-140 u off riftPos(0) at 30-75 deg: (107.6, -53.6), 120.2 u from the raft. |
| Placements | Fauna floor `zoneBottom(0) - 32`; motes clamped to `terrainH + 4` (global: it fixes main's motes inside the ground). |
| Tools | `tools/relief/` (offline gates), `relief-load`, `relief-walk`, `seating-probe`; riteplay's ward column and hit/drop booking; `fissure-probe` bounds re-derived with REDs. |
| Perf harness | The bench clock leak found and plugged tool-side; the game.js root fix deferred. `drv.mjs` refuses reserved ports when imported. |
| Open | velfix-gate RED on main (the pressed fight lens; Michael: keep the lens off Sal under her). Average fights 40 s against main's 54 s (accepted). G8's quiet ABBA and a final sweep of all 25 fissure-probe modes are not done (sections 5, 6). |

### Commits, by plan task

| Task | Commits | What |
|---|---|---|
| 1 | `c43a05e`, `1dd7738` | `tools/relief/`: slice, mesh, validate, gates, cost (RED on main). Fix: the hidden shelf frozen, `--record` rewrites only `home`, re-slice on every run. |
| 2 | `8cf517d` | `wrecks.js` `findSite` bearing window; home's skiff row. |
| 3 | `d1e1b0e` | `heightAt` names its noise (bit-identical); THE UPLANDS. |
| 4 | `f97b919`, `c0f17a2` | THE HOLLOW, relative apron, carve compensation, `__relief`. Fix: deep-copy `rows()`, transactional `set`, `checkRelief`. |
| 5 | `aa7cb42` | `relief-load.mjs`: fresh loads, anchors, parity, voyage, old save. |
| 6 | `b7d41b7`, `1116a24`, `16d504b`, `55224d8` | Shut-crack probes re-derived; the pour's hide depth per bin (`fissure.js`). |
| 7 | `e6a44e0` (amended from `a58b242`, `8214e23`) | Open throat, lens, ending, her crack re-derived. |
| 7b | `ad63215` | `walls-inside` reads the true 3-D distance; the pocket cap tried and reverted. |
| 8 | `0e2a910`, `2485b57`, `5508993` | riteplay ward column, hit/drop booking; the paired campaign. |
| 9 | `6e70e51` | velfix-gate: route bound, average policy, per-phase wash, clock plug. RED on main. |
| 8b | `5a8171e`, `ee72957` | riteplay clock plug; Velkath turned, seat on her back half, stance +0.55. |
| 12 | `79507ad` | `seating-probe.mjs`; fauna floor; motes clamp. |
| 11 | `5ad7c5c`, `f6cb116`, `714fba2` | `relief-walk.mjs`: boots, lens, hose. One `game.js` line (`__camNoFloor`). |
| 10 | `c301647` (WIP-named: `714fba2` sits on it), `f3b15be`, `5440281` | Views `z0b` / `z0r`; hardened gate tools; `drv.mjs` ports; the relative velfix gate. |
| 12b | `1d6d114` | `fullplay.mjs` clock plug. |
| 13 | `d9dcec5` | `tools/relief/render/`: the look tools. |
| 14 | this commit | CLAUDE.md, this report. |

## 2. What Michael asked, and his calls

| Date | His words | What it decided |
|---|---|---|
| 2026-10-13 | "the sea floor is all one level, like a big pit. Lets make that more dynamic but keep velkaths lair in the deepest part." | The brief. |
| 2026-10-13 | "Uplands + hollow (Recommended)"; "Mostly walkable (Recommended)"; home only, with a new home fingerprint | The shape, the feel, the scope. |
| 2026-10-13 | "floor card looks good" | The first-draft spec. **Calls 1 and 2 were in that draft and have no words of their own:** call 1, the throat keeps its floor depth (about 40 u below the lip, not 73); call 2, the hollow reads darker and somewhat murkier. |
| 2026-10-13 | "yes, accept the NE wall and build it" | Call 3 (the basin wall stands about 30 u taller behind her crack), after the offline trials amended the spec (f63542d), and the plan. |
| 2026-10-14 | "Turn her around (Recommended)" and "Raise her to match (Recommended)" (his own selections) | Velkath's fix (Ruling 41 -> 44): turned in place at her bed, her stance raised. |
| 2026-10-14 | "it would be interesting if she was buried in the sand and looked like a rock. Sal would just see what looked like a harpoon in the rock and pulls it out and she rises from the sand. There would be a dust plum as the sand falls off of her" | A new feature, not this branch's: card `velkath-buried-rock`, spec approved. It resets her opening and the fight is re-measured then. |
| 2026-10-14 | "yes", to a relay of his picks: "1. A is good 2. approved 3. A is good" | (1) The remaining fight gap is accepted as built at `ee72957` (Ruling 49 final). (2) The buried-rock spec is approved. (3) The camera: option A, keep the lens off Sal under her (card `fight-lens-off-sal`). He said it after seeing four frames: the light-up at about 48% of the frame, his suit in a burst, his lantern white-out at the calm, the lens inside her shell at the calm. |

Stills for the three calls (all in `~/sc/.abyssa-wt/shots/relief-look/`, named in section 7): call 1 `L2-6-throat-from-lip` and
`L2-6b-throat-standing`; call 2 `L2-4-her-bed`; call 3 `L2-2b-NE-wall-near` (`L2-2-bed-NE-wall` cannot show the wall).

Still open for him (section 7): two treads, not three; the look of the hollow (call 2) on the stills; the NE wall's visibility;
the exposure fence at her bed; the mote clamp that reaches every site.

## 3. Anchors

| Anchor | Before (main) | Now | Cause |
|---|---|---|---|
| Home `__ridge.fp()` | 3b526986 | **5c0705a1** | THE RELIEF (zone 0 alone: 2e296b41). |
| Home with its relief rows removed (`homeNull`) | 3b526986 | 3b526986 | Bit-identity proof: 0 of 8,668,824 dense float64 samples differ from main. |
| `__ridge.fp([1,2])` | d49d451d | d49d451d | Hard-coded in `validate.mjs`. |
| Pallid / Burned / shelf | b1c58f8d / d2b6fb68 / e5a8d9bf | same | Hard-coded (shelf: `expect.json`). |
| `sleeperFingerprint(0/1/2)` | ecfa371e ac04921e ce3eaf9d | **1ca3b28c** ac04921e ce3eaf9d | Her bed moves to her station and her wards and body sit over the new ground; same on four fresh loads. |
| `__lev.fp(0/1/2)` | 15ce888c c938fe6e 652d0412 | same | The serpent's hash; `serpent.js` reads `terrainH` only for blobs it does not hash. Proven by mutating the terrain: `lev0` held while `sl0` moved. |
| `sleeperFingerprint(0)` built from home's sleeper row | (no row) | edb51a28 | The turn, the seat, the lift (Task 8b). Pallid 014f3101, Burned 5dc323ad, shelf 874758d2 from theirs. |
| LIVE Velkath anchor (`relief-load load`) | n/a | heading -121.51 deg, Alt+6 at fwd -0.81 / lat -0.59 R, lift 0.55, seat found | Fills `sleeperFingerprint`'s blind spot: it is taken with no site row, as are brooder-invariants, gates S2 and relief-load's voyage replica. |
| Skiff | (114.5, 4.2) | (107.6, -53.6) | The window. |
| Her bed | (43.5, 113.4) | (89.7, 39.1), 0.021 u off | Her designed station. |

## 4. Gates, offline (`node tools/relief/gates.mjs`, `cost.mjs`; re-run on `d9dcec5`)

Today = main. Q0 = the trial prototype (`levers9.mjs`, hooks). Shipped = the real code.

| Gate | Bar | Today | Q0 | Shipped |
|---|---|---|---|---|
| S1 relief: sd / 50 u median / 100 u median | 12 / 17 / 30 | 5.55 / 10.6 / 17 | 16.25 / 18.0 / 34.5 | **16.2 / 17.7 / 34.5** (r50 is the thinnest margin) |
| S2 her lair: body percentile / open minimum from her bed / her station | <= 5th / <= 40 u / (89.7, 39.1) +-0.5 | 73rd / 83.8 u / bed at (43.5, 113.4) | 1.2nd / 29.6 / ok | **1.2nd / 29.6 u / 0.021 u off** |
| S3 raft-side fall (target): sink / fall | <= 12 / >= 20 | 0 / -0.8 | 11.4 / 24.9 | **11.4 / 24.9** |
| S4 not a lathe: flat / outer radius spread; tread lines | >= 20% each; >= 15 u | no hollow | 26.7% / 39.6%; 34-56 u (three treads) | **26.7% / 39.6%; 53.5 and 36.5 u (two treads)** |
| S5 walkable: over 52 deg / reachable / route | <= 1.5% / >= 97% / no hop | 0 / 100% / yes | 0.7% | **0.7% / 100% / bed, skiff, lip all true** (over 33 deg 14.8%; over the 35.5 deg gait clamp 11.6%, main 1.3%) |
| S6 drawn = stood on, added error on the hollow's footprint | <= 0.3 (aim <= 0.25) | 0 | 0.296 (p99 0.127) | **0.231 (p99 0.085)**, n 298,811 |
| S7 her ground: body / bed / arena | <= 3 / 6.5 / 11.5 | 2.9 / 6.1 / 11.4 (NW bed) | 1.6 / 2.2 / 9.0 | **1.6 / 2.2 / 8.1** |
| §7 lowest walkable ground | >= -285 | -257.8 | -280.1 | **-280.1** |
| §7 descent-trigger margin | >= 24.5 u | 51.7 | 29.4 | **29.4** |
| §7 jam top over the trigger | >= 25 u | 63.9 | 33.2 | **33.2** |
| §7 hose spare under the 375 give | >= 10 u | 25.0 | 19.8 | **20.8** (at (209, 110)) |
| §7 lips' height difference | <= 1.2 u | 1.17 | 1.18 | **1.18** |
| §7 berm round the crack | <= 5.4 u | 5.4 | 0.9 | **0.9** |
| §7 ending dip | >= 150 u | 198.6 | 198.6 | **198.6** |
| G3 throat floor, centre line below -309.5 | within 1 u | n/a | 0 | **maxDev 0 over 62 points, -315.3 at riftPos(0)** |
| Cost: `heightAt` ns, rows on / off | <= 1.5x | 1.00 | 1.17 (the port at Q0) | **1.16** (334 -> 387 ns; uplands +22, hollow +33) |
| Far field untouched, r >= 300 (Ruling 15) | 0 differ | n/a | n/a | **0 of 1,800** (RED: 1,800 differed, up to 23.6 u) |
| Uplands exact in the keep-off incl. the apron | 0 differ | n/a | n/a | **0 of 99,829** (13,258 apron points) |
| Uplands raise the relief (sd, open-floor proxy) | > today + 0.5 | 5.34 | n/a | **7.48** |
| Skiff within 130 u of the raft, outside her arena; in its window | <= 130 u | 114.6 | n/a | **120.2 u (bed 94.4 u); rel 54.9 deg, d 140** |
| `validate.mjs` | 10 keys | 10/10 on main's code | | **10/10**, home 5c0705a1 |

Task 1 recorded the RED on main (S1, S2, S4, the skiff window failed; S3 missed); Tasks 3 and 4 each have a RED to GREEN run
(Task 4: six hard gates failing before the hollow, 19 of 19 passing after).

### Tuning log

| Step | Change | Measured | Commit |
|---|---|---|---|
| Port of Q0 | Q0's values into the real code. | Every hard gate passed; S6 0.287 against the 0.25 aim, cost 1.17. | `f97b919` |
| S6 diagnosis | Knockouts on the 38 footprint points over 0.25 u: the hollow's middle riser feet (0.279 with the uplands and outcrops off), upland rubble crests at r 234-250 (`r3amp`), the outcrop knolls' feet (curvature ~2 amp / soft). | A 48-row grid. Three treads reach <= 0.25 only at 0.244, and that row fails the skiff gate (131.2 u, a 0.001 u near-tie). | |
| Chosen | `hollow.N` 3 -> **2**; `hollow.oc.soft` 0.1 -> **0.2**; `uplands.r3amp` 1.5 -> **1.0**. | S6 0.231 / 0.085; S1 r50 18.0 -> 17.7; S7 arena 9.0 -> 8.1; hose spare 19.8 -> 20.8; skiff 122.1 -> 120.2 u (lead over the runner-up 0.114 u). | `f97b919` |
| S6's domain (Ruling 14) | Gated on the hollow's footprint, as the spec says. | Outside it upland crests draw up to **0.852 u** off the walked ground (INFO; Task 3 measured 0.839). | |
| Uplands bounded radially (Ruling 15) | smoothstep r 250 -> 300. | The far ridge and the isle shoals stay bit-identical. | `f97b919` |
| `checkRelief` (Ruling 17) | `sLvl` and `rw` <= 0 refused (0/0 = NaN over zone 0); `oc.keepOff` inside the crack's reach + 4 u refused; `uplands.fade` defaults to [250, 300]. | Bit-preserving: 5c0705a1 not re-recorded. | `c0f17a2` |
| Pour hide depth (Rulings 21, 25) | Per-station, per-bin floor minima over a block's footprint and drift replace a 9 x 9 grid. | Pour-hide 9 of 9 planes pass, every block >= 1.545 u under the ground; fixes main's 3.8-4.1 u misses at Pallid z0, Burned z0, Burned z1. +24-31 ms per zone per layout (~+80 ms at boot and every reseed). | `1116a24`, `55224d8` |
| The pocket cap (Ruling 36) | A drawn-only cap on the west tip's pocket. | Not clearly better (past 1 u: 43.0% -> 40.3%; drawn rock over water doubled): **reverted**. Saved as `~/sc/.abyssa-wt/reviews/t7b-scripts/pocket-cap-0e5043b.patch`. | `ad63215` |
| Stance lift (Ruling 44) | `hard.lift` from the gap between main's hunting stance and hers (seeds 901-904). | wardHuntP50 10.04 vs 9.475 -> **0.55 u**; under her the lift rises 0.54-0.56. | `ee72957` |

## 5. Gates, in game

| Gate | Verdict | Number |
|---|---|---|
| **G1** hard limits | PASS | Every §7 row as in section 4. The hose by a real walk (`relief-walk hose`): farthest range **352.5 u, 22.5 u short** of the 375 give, 0 frames in the give, `__leash.n` 0. RED `short20` yanks (exit 5). Ending dip 198.61 read live from the spline. |
| **G2** fissure probes | PASS, one carve-out | Every mode whose bound moved was re-derived with a RED (section 6). `open-ledge` zone 1 fails from a clean load on **both** builds (8.3 u, 130 frames in the throat): parked, main's card `zone1-open-ledge-throat` (Ruling 23). |
| **G3** throat keeps its floor | PASS | Offline 0 over 62 points; `fissure-probe shape` floor -315.33 +-1; RED `nocomp` -346.33 fails. |
| **G4** after the calm (`velfix-gate`) | **NOT MET as written** | RED on main, 12 of 12 route runs; the relative gate on the relief failed as registered (section 8). Michael chose the camera fix (card `fight-lens-off-sal`). |
| **G5** her rite | PASS on the ward column; **average band failed as registered, accepted** | Ward heights: hunting stance +0.09 u of main's (relief 10.185, main 10.095; bar +-0.5); max 13.33 against main 13.98 + 0.5. Average fights 40.4 s against main's 54.2 s; 4/12 in the 45-165 s band against 7/12 (sections 8, 9). `brooder-invariants` PASS; `harpoon-probe` 10 of 10 modes exit 0 after the turn; real Alt+6 + E at the new station: prompt, wake. |
| **G6** placements | PASS | `seating-probe` 22 PASS, RED `prop-lift` exits 1. Plants: 33 of 35 keys identical to main, `g_worm` +2.6%, `g_mat` +7.8%, none starved. Skiff 120.2 u from the raft, outside her arena; a real walk raft -> skiff: 146.4 u in 74 s, no hop. Keepsakes: the skiff's sextant -> his mark -> the sounding set, in main's order; remote sites bit-identical. |
| **G7** invariants | PASS | 14 lights; the anchors of section 3; `__safeFailed()` and `__shaderFailed()` []; console clean but the favicon 404. `relief-load all` PASS on the Task 8b tree (`ee72957`); `load` PASS again in Tasks 10, 11 and 12 (`79507ad`); Task 13 read home 5c0705a1 on the branch and 3b526986 on main, and zones 1+2 d49d451d on both, on fresh tabs. |
| **G8** cost and boot | **Partly reported, not closed** | Views re-anchored (`z0b`, `z0r`). `heightAt` 1.16x. Boot 9,563 ms against main's 9,696 (hitch ABBA); the terrain step 325-331 ms against 319 (relief-load; hitch 357-367 against 330-365). The pour hide adds ~80 ms per reseed. **ABBA** (not quiet; cycle deltas span +-1 ms; only z1 is like for like): z1 -0.03 ms, z0 +0.07; z0r +0.55 and z0b +1.10 stand on different ground from main's. **hitch `jet`**: +1 shadow program on the branch, 0 on main (Ruling 18: three r184's draw-order shadow variant; main compiles the same program at another spot). `hitch.mjs` last ran at `aa7cb42`, before the `fissure.js`, `brooder.js`, `fauna.js` and `rifts.js` changes: not re-run. The quiet ABBA is the controller's (Ruling 52). |

### Review Focus 1-5

| # | Risk | Test | Result |
|---|---|---|---|
| 1 | Boots on steep ground | `relief-walk boots`, real W up and down 4 lines, 2 walks each way | On ground <= 35 deg: OWN gap p95 **0.037 u** (bar 0.15; main 0.016), n 20,638. Steeper: 5,694 of 26,332 planted-boot samples (21.6%), p95 0.06-0.11, worst sink **-0.124 u** at 45-50 deg, 11 samples over 0.15. RED `noslope` p95 0.43-0.59, exit 5. The plan's formula `wlo - terrainH(contact)` reads `d x tan(slope)` on a perfect fit and fails on both builds, so OWN (each sole point over its own ground) is gated and the plan's is booked. |
| 2 | A voyage away and back | `relief-load voyage`: Pallid, Burned, then three round trips | Her bed recomputed every time: `lairPos` 0.021 u off the station, `bedAt()` equals it, the skiff site equals the replica's; every home arrival identical to the fresh load; Pallid b1c58f8d, Burned d2b6fb68 each time. |
| 3 | A save made before | `relief-load oldsave`: `pulled[0]`, `sighted[0]`, the harpoon owned | "[E] PRESS THE OLD WOUND" at the new station (anchor 15.4 u from it after the turn, 18.6 u before), a real E wakes her, no pull line. |
| 4 | The lens on the risers | `relief-walk lens`, real keys, 3 walks per line, looking up, a wall-foot control | Clearance >= 0.3 u on every walk frame (lowest 1.65 level, 1.20 looking up, 1.198 at the wall foot). The plan's step bar (main's p99 on one line, 2.42) cannot be held: every line's boom swoops once from 9 to 3.4 u at 15.6-16.0 u/s on both builds. Re-ruled (Ruling 48): the in-walk swoop <= main's max + 0.5 (upland 15.92-16.02 against 15.67), the settled p99 within +0.02 / +0.03 / +0.08 u/s of main's equivalents. RED `nofloor`: wall-foot control 181 of 181 frames under 0.3 u, exit 5. |
| 5 | Things placed at an absolute height | Fauna candidates; 100 seeds x 3 zones x 14 motes at four sites | Fauna: 39 rocks in the hollow were never candidates; with `zoneBottom(0) - 32`, 2 morays and 2 crabs stand there, the other sites bit-identical. Motes: main puts 59-61 of 1,260 inside the ground; the clamp gives 0 of 16,800, x, z and phase identical, 8.3% lifted to exactly `terrainH + 4`, up to 79.5 u (median 11.2). |

## 6. Probes: what each was re-derived from, and its RED

Rule held throughout: a bound is re-derived from a requirement and carries a case that fails; loosening a bound until it
passes is not re-deriving it. Bars measured on main are measured the same way on the branch.

### `fissure-probe.mjs` (25 modes; RED knobs `FP_MUTANT='<json>'` via `__relief.set`, `FP_RED=<variant>`, `FP_WALLS_SINK=<u>`)

| Mode | Old bound | New bound, derived from | RED and result |
|---|---|---|---|
| `shape` | depth >= 25 | >= 35 every zone (spec §6 plus the 25 u jam margin needs 32.8); home floor -315.33 +-1 (G3) | `deep` 8.85 u fails; `nocomp` -346.33, `sink` -378.33 fail; `tilt` passes by design |
| `jam-stand` | jam over trigger >= 55 | >= 25 u at every plane (§7); home lips <= 1.2 (the jam cap engages at 1.6) | `deep` / `sink` 1.2 u fail; a steep dish `{dish:6,rDish:12}` lips 2.172 fails only the lips |
| `jam-mesh` | `dropMin >= 20` (a tautology) | `DROP_MIN` read from `fissure.js` and pinned at 20; count 60-160 (home z0 lays 160) | `deep` 17 blocks; a served copy with `DROP_MIN = 15` fails |
| `pour-hide` | hidden >= 100 | >= 0.95 x blocks (main 160/160), blocks >= 60, all 9 site x zone planes | `ROCK_T` 12 s fails 8 planes (10-51 of 160), 9 s fails all 9; `deep` 17 blocks |
| `seep-depth` | 0.15 / 0.30 / 0.19 | unchanged (image-calibrated) | z0 0.097 against main 0.076: PASS |
| `walls` | under the jam >= -0.1 | each frame's own rise: d >= -(max(0, rise) + 0.01) (Rulings 22, 26): the trail is one frame's step up a block side, 4.5 x speed / 60 | `FP_WALLS_SINK=0.3` fails 36 of 36 cases |
| `rise` | totals 40 / 160 | per unit of rise: x 0.8252 (mean rise 72.32 against main's 87.64) -> 33.0 / 132.0, measured 26 / 122 | `FP_RED=no-rel-limit` (`relVmax` 1e9): hidden 168 fails |
| `throat-edges` | none | every haul >= 0.5 s in the shaft above the switch; zone 0 reads 4.05 s from 19 u over | `haul-low` (eye 1 u under the switch): 0 s fails |
| `walls-inside` | look 25 u, rays [4, 10, 20, 35] | scaled to the live column (42.06 u at home z0): look 0.34 x column, rays [0.055, 0.14, 0.28, 0.48] x column, ray-count floor >= 90%; the A/B at 25 u (0.2533, bar < 0.5); readings are the true 3-D distance (Ruling 35: the 12-bearing march read 2.925 where the truth was 0.204) | `rays-1.2` 80% fails; `wall-back-3` recess 3.59-3.82 fails all 9 planes; `wall-out-1` protrusion 0.98-1.01 fails all 9 |
| `fall-lens` | 150 samples; fixed counts | samples >= 150 x column / 72.7 (zone 0: 86.8, measured 152-203); count gates scaled, factor clamped at 1 | `cut-1s` 16 samples fails; `nocomp` passes, as it must |
| `ending` | none | dip >= 150, read live (198.61 on both builds) | `FP_MUTANT sink` 135.61 fails |
| `velkath-crack` | ward bound 10.5 | `R` read live (15.4 -> keep 34.02); per-site bound = main's max + 0.5 over a settled 1 s (home 9.4, Pallid 10.8, Burned 10.8); branch home 8.0-8.9; the probe resets her swept-touch origin so placement lights no ward | the bank mutant does **not** fail it (its one hunt never settles): the bound stands on its derivation, and riteplay's ward column is the home gate |
| `clearance` | none | her near flank normal.y >= 0.8 (home 1.00) | `{sDrop:-14, sR:[8,24]}` -> 0.597 fails |
| `wave-minors` M9 | fixed spot (0.91 u under `riftRimY`, line needs 1.5) | the jam point nearest the centre under `riftRimY - 1.5 - 0.3`, both halves, `jamY` checked every frame | loud failure if no such point exists |
| `tips`, `slabs`, `climb-out`, `floor-readers`, `opening`, `calm-open`, `open-persist`, `reascend`, `open-light`, `below-dark` | unchanged | ran PASS on the relief (`opening`: Pallid z0 pour gone at 13.7 s against the 14 s gate) | |
| `open-ledge` | | zone 1 FAILS on both builds from a clean load | parked (Ruling 23) |

Each mode was last run at its own task's head (Tasks 6-7b); `velkath-crack` and `clearance` again after the turn (`ee72957`).
**No sweep of all 25 modes on `d9dcec5` is recorded**: the controller's final review should run one.

### The other probes

| Probe | What it gates | RED |
|---|---|---|
| `tools/relief/gates.mjs`, `validate.mjs`, `cost.mjs` | The offline gates (section 4), the anchors | On main: S1, S2, S4, skiff window fail. `validate --record` refuses any moved non-`home` key. |
| `relief-load.mjs` | Fresh loads and anchors; parity (**40,401 points, 100% within 1e-9**, 99.81% bit-identical, max 1.14e-13); voyage; old save | Main: `load` fails home's anchors, `voyage` the station (87.5 u off), `oldsave` the anchor (105 u off) |
| `relief-walk.mjs` | Boots (OWN p95 <= 0.15), lens (clearance >= 0.3, swoop, settled p99), hose (spare >= 10) | `noslope`, `nofloor`, `short20` (exit 5). `past20` cannot yank: past the binding point the floor rises into the rim wall and the 3-D range falls to 344 u. |
| `seating-probe.mjs` | Hover (lowest vertex > 0.08 u over the drawn floor), sunk, node-in-boulder, motes within 3 u; count floors | `prop-lift`, `node-sink`, `node-boulder` exit 1; main fails the motes at all three surveys (61 / 59 / 61) |
| `riteplay.mjs` ward column | `RP_WARD_BAR` = main's max + 0.5. Exit **0** pass / **3** WARD FAIL / **2** UNMEASURED or a bad bar / **4** LOST clock / **1** crash | The bank mutant cannot host the rite (Alt+6 slides off the mound; woken by command it reads 12.50 < 15.01); the trivial-bar path `RP_WARD_BAR=0.1` fails. The bound stands on its derivation. |
| `velfix-gate.mjs` / `fullplay-gate.mjs` | Crack route must reach zone 1 in 90 s; per-phase wash; after-calm floor >= 100 frames; drift <= 0.05 s | `FP_NOVENT=1` stops him at the lip; `FP_NOPLUG=1` reads 13.6 s over 10 s stepped, exit 1 |

## 7. The look (for Michael)

Stills: `~/sc/.abyssa-wt/shots/relief-look/`. Each shot exists as `main-<name>.png`, `relief-<name>.png` and the pair
`relief-look-pair-<name>.png` (main left, relief right). One camera rule on both builds: pinned lens at `terrainH + 3.75`,
the post chain settled (`capture({ settle: 90 })`), day, no storm.

| File | Frames | Call |
|---|---|---|
| `relief-look-L1-map.png`, `relief-look-L1-sections.png` | Hillshade maps main beside relief with the raft, crack, her bed, the skiff, the hose point; sections A-D | the outline is not a lathe; her bed in the 1st percentile of the floor (main 73rd); throat floor -329.5 in both |
| `L2-1-raft-landing` | The landing, toward the crack | the floor falls away under the lens; the raft column is rock-heavy and Sal is half hidden on the riser |
| `L2-2-bed-NE-wall`, `L2-2b-NE-wall-near` | Her bed; the wall from 30 u past the crack | call 3. **The taller NE wall is out of sight from her bed**: its foot is 110-130 u away, past the visibility of about 100 u. `L2-2b` is the honest view. |
| `L2-3-upland-ridge`, `L2-3b-upland-ridge-west` | The ridges looking back at the crack | the uplands |
| `L2-4-her-bed` | 32 u out, on her flat | call 2: the quiet, murky floor of the hollow |
| `L2-5-skiff`, `L2-5b-skiff-side` | The skiff on its new ground | gentler on main (mean 1.8 deg) than here (7.5 deg) |
| `L2-6-throat-from-lip`, `L2-6b-throat-standing` | The open throat from the lip edge and from 3 u back | call 1, before and after |
| `glare/` | PNGs of a flash 0.3 s in, at 1.8 / 2.5 / 4.0 u | |
| `fullplay/` | Take stills, `relief-full-seed1.log`, `relief-full.json`, and `video-check-*.jpg` (spot frames of the FIRST, slow encode `relief-full-v1-slow.mp4`, not of the re-encoded `relief-full.mp4`) | |

**Video:** `~/sc/.abyssa-wt/video/relief-full.mp4`, the full take (seed 1, average policy: harpoon at 33.0 s, calm 81.6 s,
zone 1 at 106.4 s, 4 hits, drift 0). Re-encoded at true speed (Ruling 54): the container reads **111.9 s, 960 x 600** (mvhd
duration 2,238 at timescale 20; tkhd 960 x 600). The first encode, 128.5 s for 111.9 s of game and cropped to 534 rows, is kept
beside it as `relief-full-v1-slow.mp4`. The frames (1.6 GB) are in `relief-full-frames/` for a re-encode; the main extract
(123 MB) is at `~/sc/.abyssa-wt/reviews/main-look-t13/`.

Findings:

| Finding | Number |
|---|---|
| The hollow and the NE wall do not read from the water | visibility ~100 u; the wall's foot is 110-130 u from her bed. They read on the map and sections only. |
| **The exposure sits on its low fence at her bed** and at the raft column | Her bed: multiplier 0.850 on the LOW fence, the meter wants 0.48-0.74 EV below it (main 0.31-0.35). The clamp, not the meter, sets the hollow's brightness. The lever is the fence or the key, out of scope. The upland ridge is free (0.979-1.033). |
| Height-tied shading is negligible | 27.9% of the open floor is clamped at `hb` 0; albedo span <= 2.0%; zeroing the tie moves floor luma inside the A/A spread. No frame shows a flat band; her flat reads evenly because it is levelled and silted. |
| Ward glare with the lens pressed | At 1.8 u the blown share peaks at **0.614 (relief) against 0.617 (main)**, max 0.816 against 0.795: over 50% on **both**, so the relief is not a regression. At 2.5 u 0.405 / 0.375, at 4.0 u 0.230 / 0.251. This is `fight-lens-off-sal`. |
| Two treads, not three | Task 4 chose it for S6. The three-tread row (S6 0.244) fails the skiff gate (131.2 u). Never ruled by Michael; judged on L1 / L2. |

## 8. Failed as registered

### Task 10: the relative velfix gate (pre-registered in Ruling 51, failed, Ruling 52)

Main's gate is RED, so the relief was judged against main on the same tools: 3 alone runs per build interleaved plus 1 under
load. Classes from Task 9's main cuts, never refit: PRESSED (lens < 2 u from his bonnet), FLASH (newest light-up < 0.6 s), CLEAN.

| Bound | Result |
|---|---|
| A every relief route reaches its end, drift 0 | **PASS**: 12 of 12; crack zone 1 at 87-101.5 s |
| B CLEAN reds <= 2 per relief run per phase | **FAIL**: relief 1-6 per run; main alone 0-7, under load 8 |
| C per route and phase, relief reds <= 1.5 x main + 5 | **FAIL**: follow fight 93 against 72.5; resettle fight 97 against 63.5; resettle after calm 7 against 5 |
| D after the calm, lens on her surface + Sal in her <= main's max + 2 | **Split**: pooled passes at the limit (10 <= 8 + 2); per route fails on 5 runs |

Why (Ruling 52): the registration's flaw, not a pass. B's baseline ("main 0-1") came from four short Task 9 fights, and C
used totals that scale with fight length: the relief's gate fights ran 39.6 s on average against main's 23.6 (main's gate
approach walks straight in and samples the fight's quick end). The per-frame red rate is equal, **8.3 per 100 booked frames on
both builds**; the CLEAN rate is 0.97 against 0.43 per 100 (21 of 35 in her drop, 9 flash tails at flashT 0.62-0.63). Not
re-registered. It does not block under G2, since main is absolutely RED too. The absolute GREEN moves to `fight-lens-off-sal`'s
acceptance, run on main after the merge so it covers her new bed.

### Task 8b: the band criterion (c) (Ruling 39 pre-registered, Ruling 46: no waiver)

Phase B, 24 new paired fights (seeds 1-12 x perfect / average), the plugged clock, drift 0 in 48 of 48:

| Criterion | Result |
|---|---|
| (a) every fight calmed <= 240 s, alive, console clean | PASS 24/24 and 24/24 |
| (b) perfect: median ratio inside [0.8, 1.25] or p >= 0.10 | PASS: 49.8 against 44.6 s, ratio 1.118, p 0.18 |
| (b) average | PASS by the rule only: 40.4 against 54.2 s, ratio **0.745** (outside), p 0.58 |
| **(c)** share in the 45-165 s band with <= 3 hits >= main's - 1/12, and the median in band | **FAIL both halves**: relief 4/12 against main 7/12 (bar 0.50); median 40.4 s |
| (d) ward column | PASS: max 13.33 against 13.98 + 0.5 |
| (f) hunting stance, relief within +-0.5 u of main | PASS: +0.090 u (10.185 against 10.095, n 24 each) |
| (e) booked | heave hits 0 in both; the perfect player is hit at least once in 2/12 against 2/12 |

All 8 out-of-band relief fights are under 45 s (24.6-43.1), none for hits; main's own five are four under 30 s and one with
4 hits. Michael: "A is good" (accept).

### Plan bars that were re-ruled before or during the data

| Bar | Why it could not stand | Ruling |
|---|---|---|
| Task 8's per-seed fight times (+-20% per seed; relief s against main s) | Her behaviour is `Math.random`-driven page-side, so seed N on one build is an unrelated draw from seed N on the other; main fails the criterion against itself (perfect 36.5 vs 75.7 s). Replaced by a pre-registered paired campaign, n = 12 per build per mode. | 37 |
| The spec's ward-height bar "her wards stay at today's height" read one-sidedly | Task 8's gate let a ~1 u drop pass; the shift was real (average ratio 0.41, p 0.009). | 39, 40 |
| Boots formula `wlo - terrainH(contact)` | Slope-biased; fails on a perfect fit on both builds. | 48 |
| Lens step against one main line | The boom's swoop is an event; the bar moves with where a line's top stands against the hill. | 48 |
| Hose RED "20 u past the point" | Cannot yank: the 3-D range falls to 344 u. `short20` instead. | 48 |
| `walls` bar -0.1; `velkath-crack` ward bound 10.5; `rise` totals | A static number tests the player's integrator, or Pallid and Burned, or a rise that moved. | 22, 26, 31, 33, 34 |

## 9. The fight story

| Step | Finding |
|---|---|
| Task 8, the pre-registered paired campaign (n = 12 per build per mode, home) | Ward column PASS (relief max 12.10 against main 14.51 + 0.5). Perfect PASS (51.2 against 41.8 s, p 0.37). **Average FAIL: 24.3 against 59.8 s, ratio 0.41, p 0.009**; 4/12 in band against 7/12. The perfect player was hit in 8/12 fights (7 tears by her shell's heave at 9.2-9.3 s), main 1/12. |
| The diagnosis (Task 8b step 1, read-only: 16 average fights per build, Task 8's 12 and 4 instrumented) | **Geometry, not reach** (at most 2 of main's 42 failed dashes came within 1 u). Her raft-side bed MIRRORS her across the crack: Alt+6 started him at her front-right (fwd +0.62 / lat +1.08 R) against main's back-left (-0.48 / -1.16). The ward order was 0-2-1 in 16 of 16 relief fights (main 9/7): he lit the second ward from under her, stayed under through the drop and her slow turn, and crossed about 16 u under her belly to the far ward. Main fell into circling for the last ward 10 of 16 times, the relief 5 of 16. Her hunting body sat only 0.23 u lower; main's extra ward height was its ground falling away under her +x flank. |
| Michael's fix (2026-10-14) | "Turn her around" and "Raise her to match". The turn in place (her bed stays 0.021 u off the station; a re-fit moved her 1.011 u), the seat on her back half (otherwise a real Alt+6 stood him at her front-left: the best seam on the flat was her front corner), a stance lift of 0.55 u (through body height, `STAND.clear`, `CROUCH.clear`, `NOSAFE.depth`). Pallid's and Burned's Velkath fingerprints did not move. |
| Phase B (24 paired pairs) | Average **40.4 against 54.2 s** (was 24.3 against 59.8); perfect 49.8 against 44.6 s (was 51.2 against 41.8); hunting wards +0.09 u; **her rising shell catches nobody** (8/12 -> 0); the ward order is main's again (last ward index 0 x 1, 1 x 4, 2 x 7; main 1 x 5, 2 x 7). The gap left sits after the second ward (first-to-last span 17.3 against 41.1 s). The back-left corner opening delays the perfect player (first ward 17.3 against 10.0 s) without pushing (b) out. |
| What was accepted | The remaining gap: average fights about 25% shorter than main's, 4/12 against 7/12 in band. Michael: "A is good". The buried-rock work resets her opening and re-measures. |

## 10. Deferred, by area

### Follow-up cards the controller will create

| Card | Why |
|---|---|
| **The bench clock root fix, with a baseline re-derivation pass** | game.js `hold(false)`: `const e = clock.elapsedTime; clock.getDelta(); clock.elapsedTime = e;`. Ruling 42. It moves every `__bench.step` probe's baseline, which on this branch were derived on main under the same leak. Unplugged today: the fissure-, harpoon-, clawcam-, blade-, knife- and velfix-look probes, `play.mjs` and `ritefair-*`. |
| **The throat-tip sub-column wall features** | Pre-existing at every site, drawn-only: the east tip's needle (~2.7 u dip, ~0.5 u long, at u 24.7, seen from ~1,000 lens-clear sightlines) and the west tip's knife-slot drawn widened (strata recess ~2 u faces on a 0.36 u slot, wandering off its zigzag). The wall builder's sub-column features touch every plane; the pocket cap patch is saved (section 4). |
| **`fullplay.mjs` harpoon-arrival robustness** | `travel('the harpoon')` stops on the first frame `canTake` is true and the 2 s "facing the iron" beat holds no keys. Afloat and gliding at 3.7 u/s he coasts out of the 2.6 u reach (leaky clock: 0 of 3 takes; plugged: 5 of 5). Stop when grounded and slow, or brake in the beat. |
| `fight-lens-off-sal` (exists on main, status `next`) | Michael's camera call. Its acceptance is the absolute velfix-gate GREEN on main, with a RED/GREEN pair. |
| Exist already on main | `shadow-variant-warmup` (the first-jet shadow compile, Ruling 18), `zone1-open-ledge-throat` (Ruling 23), `velkath-buried-rock`, `bench-zone0-stalls`. |
| The `fissure-and-harpoon` card's flash Open line (the controller's, on main) | The measured numbers: 54 light-ups, peak blown share median 0.21, max 1.0; 34 over the 0.15 cap, 23 over 0.30, 4 over 0.50; over the cap to flashT 0.55-0.72 s; the glare series of section 7. |

### Stale text in code (not touched: this record is documentation only)

`src/world/site.js` line 16's row table (no `uplands` / `hollow` / window) and line 22's "SITE 0 IS THE SHIPPED WORLD, BIT-IDENTICAL" paragraph (true of the terra and seed rows, not of zone 0); `src/world/terrain.js`
lines 141-142 ("so the shipped world survives bit-identical": true of the ZP / RIM literals, not of home's zone-0 field); the spec's "Q0 has three treads" and "outcrop +1.5" (the shipped row is two
treads, `soft` 0.2).

### Tools: relief, walk, load, seating

- `tools/relief`: `gates.mjs:5` says every bar is judged at `stats.mjs`'s precision, true only for bars read from it (Ruling 10: a rounding loosens a bar by half a unit; S5's two 52 deg definitions); deleting `expect.json` and re-recording would re-baseline the non-hard keys (never delete it); no check that `capsules()` has `keepOff` or `r1 > r0`; the fade band r 250-300 is never sampled for mesh error; `__relief.set`'s JSON copy drops `undefined` and turns `Infinity` / `NaN` into null; `checkRelief` requires `oc.keepOff` even when `oc.amp` is 0; unguarded divisors (`sR0 = sR1`, `fade0 = fade1`, `ramp0 = ramp1`, `rDish = 0`, `rO = rF`) give NaN only on a measure-zero set; a throwing re-arrival in `set`'s catch would mask the original error.
- `relief-load`: parity gates only the share (>= 99%), so tighten the tail to <= 1e-6; the "no pull line" check can pass vacuously (it needs a positive control); `all` reuses one debug port (the pkill does not wait: flaky, never a false PASS); the LIVE tolerance compares 2-dp roundings at 0.01 (use integers or 0.015); LIVE's `lift` echoes config, nothing measures the stance plumbing; `gates.mjs` S2 and the voyage replica call `velkathLair(..., null)`, a path home no longer takes (pass `siteAt(0).sleepers[0]`); the `ANCHOR` comment lacks "re-record only with a named cause".
- `relief-walk`: the selftest covers the pure functions, not their call sites; wall-foot stands are not checked for disturbance; the place's snap puts the lens inside the hill for the first frames after a teleport (steep line -7.18 u for 35 frames; main's B -1.04 for 13): booked, not gated (Ruling 50), and it happens on main after a playtest Alt jump.
- `seating-probe`: a lifted mote lands inside a boulder's collider ball 5.6% of the time (about 1 layout in 20); the mote comment lacks its measurement; the egg-skin bar tests centre height <= 0.55, looser than the 0.08 lowest-vertex bar; in a RED run "home again = home" prints PASS unconditionally; count floors guard only total absence; the probe duplicates `wrecks.js`'s deck constants (stale values fail loudly); `zone0Floor`'s 32 margin is unexplained.
- `tools/relief/render`: the default `OUT` is inside the repo and not ignored; Chrome profile dirs are never removed (~1.4 GB of `abyssa-relief-*` in `$TMPDIR`); `lens.page.js` / `sample.page.js` fail a raw `node --check` (async bodies); `shade.mjs` lacks a try/finally around its restore; the README lacks the L1 pipeline order; no signal handlers.

### Tools: fissure-probe, walls, riteplay, gates

- `fissure.js` comments at 73-76 and 403 still quote round 1's "misses a bottom by at most 1.11 u" (measured on whole-width windows; the real net is pour-hide's >= 1.545 u); the `_widths` alias at `fissure.js:287` and `:744` (pre-existing, likely harmless). Three planes' pours end past the spec's 14 s with no probe gating them: Pallid z2 14.10 s (main 14.23), Burned z1 14.30 (main 14.30), Burned z2 14.02 (main 13.75; accepted, Ruling 27).
- `fissure-probe`: `fall-lens` count gates compare `x > bar` (NaN-unsafe: use `!(x <= bar)`); `RISE_HF` and the scaled count gates lack a RED at their new values; the per-unit-of-rise premise is not borne out (zone 0's counts held while its rise fell 90 -> 60; the scaling only tightens `RISE_HID` to 132); an erroring A/B look reports "streak undefined"; `velkath-crack`'s hunt is dense inside a page template (move its settle and window logic to a page helper if it grows).
- `walls-inside`: the refined list prints 12 entries without location dedupe; the patch surface summary lacks a top 3 and the top-3 dedupe keeps the first sample at a location, not its max; a RED on a plane whose `fissureWallGeo(zi)` is null reads GREEN (throw when `shift && !G`); the riser bias (rock-side readings up to 0.02 u under the truth) is unstated; `wall-back-3` proves no gross collapse, not accuracy near the bar; the shelf is missing from its bound loop.
- `riteplay`: `wardHuntP50` can be -Infinity (written null) when every ward is non-finite (treat as tainted whenever `wardUpBad` > 0); the header's "13 if killed mid-await"; `LOG_CAP` duplicates game.js's literal 64.
- `velfix-gate` / `fullplay*`: fresh-profile boots fail on unpkg now and then (`net::ERR_FAILED`, about 5 of 25); the CLI test is `argv[1].endsWith('drv.mjs')`; `connect()` is unguarded (a connect-only tool with `DRV_PORT` unset attaches to 9419); `seating-probe` and `relief-load` install an exit hook calling `stop()` before `start()` (a noisy throw on misuse); the port check is not atomic with `start()`; `velfix-gate` could print `r.status` to tell a refusal (2) from a crash (1); the rim light steers on `performance.now()` (render only); `fullplay.mjs` exits 0 or 4 only (no signal handlers) and its LOST test also fires on a running clock.
- Home's `__lev.swap(kind)` at zone 0 hands Velkath's `lair` / `hard` row to a swapped hoarder or hunter (dev only, no play path).

### Game and world

- Velkath's four leg InstancedMeshes are `frustumCulled = false` with `castShadow` on, so they are drawn into all six lantern cube faces every frame, wherever Sal is: 24 draws a frame on both builds. A distance cull in the shadow pass would save them.
- The first-jet shadow compile (+1 program on the branch at (4, 4), main at (-40, 30)): a boot warm-up of each caster's distance and depth variants for both `map` states at both sun-shadow states.
- The home skiff's sonar prompt waits behind the sextant and his mark (shipped; main the same).
- The play boundary `clampR[0]` moved -12.7 to +7.6 u per bearing; no gate covers it.
- The lifted mote clamp reaches zones 1-2 and every site (Ruling 47): a free fix of main's bug, reported to Michael.
- Stance lift rises 0.46-0.51 for 0.55 with Sal out on the sand (0.54-0.56 under her, where (f) gates it).
- The fight-lens frames behind the camera call: `~/sc/.abyssa-wt/shots/velfix/gates/t9-*` (for example `t9-n2-crack-shot-calm-14-50.4.png`), report `task-9-report.md` section 2b. The `fight-lens-off-sal` card on main cites `shots/t9-*`, which does not exist; the controller may want to correct it.
- Process: in Task 6 six scratch runs with an unset port fell back to drv.mjs's default 9419 and ran its `pkill`; a Chrome there may have been killed. Ruling 53 closed the hole.

## 11. Rulings the record cites

| # | Ruling |
|---|---|
| 14 | S6 is gated on the hollow's footprint; outside it the uplands' added error is an INFO line. |
| 15 | The uplands fade radially (r 250 -> 300); the far ridge and the isle shoals stay bit-identical. |
| 17 | Fix `rows()`'s shallow copy and `sLvl` = 0 before the mutants are built. |
| 18 | The first-jet shadow program is a draw-order variant main also compiles; not this branch's. |
| 21, 25 | The pour's hide depth from floor minima per bin over a block's footprint and drift. |
| 22, 26 | `walls` bars each frame's own rise. |
| 23 | `open-ledge` zone 1 fails from a clean load on main too; parked. |
| 27 | Burned z2's pour ending at 14.02 s is accepted. |
| 33, 34 | Rise bars scaled by the live mean rise; `velkath-crack` measures her settled stance with every ward dark. |
| 35, 36 | `walls-inside` reads the true 3-D distance; the pocket cap is reverted. |
| 37-40 | The paired campaign replaces per-seed criteria; the one-sided ward gate was a plan defect; (f) reads her hunting stance. |
| 41, 44, 45 | Michael's call on the fix; turn in place, seat on the back half, stance lift; Phase B as pre-registered. |
| 42 | The bench clock leak: plug tool-side; the game.js fix deferred. |
| 43 | Main's velfix RED is real game behaviour: a decision card for Michael. |
| 46, 49 | (c) fails as pre-registered, no waiver; the fight gap accepted (final after "A is good"). |
| 47 | The mote clamp stays global. |
| 48, 50 | The lens step compared like for like; the post-teleport snap is the probe's, not play. |
| 51, 52 | Task 10's relative gate pre-registered; failed as registered, not re-registered. |
| 53 | `drv.mjs` refuses 8777 / 8790 / 9419 when imported. |
| 54 | The video is re-encoded at true speed before Michael sees it. |
