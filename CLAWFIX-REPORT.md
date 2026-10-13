# CLAWFIX: Velkath's crusher strikes like a living claw

Branch `clawfix`, from main `5ab282b`. Michael: "velkath's claw strikes are very stiff, the pincher doesnt move, just feels like a straight stick". He approved the audit's design (`reviews/claw-audit.md`) and said "Yes, build it".

## Status

Built and verified. The pose probe fails on main and passes on the branch. The blow lands on the shipped pose: on the hit-test frames the hinge differs from main by no more than the run-to-run noise.

The fight checks show no change I can attribute to the claw.

- Not one hammer hit happened in any of the 28 riteplay runs, base or new.
- Calm times, tears and drops sit inside base's own wide spread. The same seeds on unchanged code ran from 23 s to 130 s.
- Perfect seed 1 took a leg-contact tear in both clawfix passes, against 0 of 6 base perfect runs. I re-ran it on one build with the claw switched off and on, three runs each. Off took leg tears in 2 of 3 runs, on in 0 of 3. So the tears are noise, not the claw.
- fissure-probe and harpoon-probe pass.
- velfix-gate's crack route is RED on main too, so that was already broken.

The table, the gates and the open concerns are below.

The framing goal is only partly met. The wind-up is still above the follow lens at fight range, and the probe showed that a modest drop in the cock apex makes this worse, not better. The landing snap is the beat the player sees.

## What changed

Most of the logic is in `src/entities/sleeper/brooderClaw.js`, a new pure module with no imports. `brooder.js` `poseClaws` applies it, and `tools/bench/claw-sim.mjs` runs the same module offline. Everything in the module is an offset on the shipped pose.

### 1. The arm is a whip, not a stick (`WHIP`)

- **Wind-up.** The elbow and wrist ride damped springs on the shoulder's cock (ω 9 / ζ 0.5 and ω 6.5 / ζ 0.38). They start late, overshoot at the top and settle in the trembling hold.
- **Wrist cocks back.** The shipped wrist pitch had `-0.25*ck`, which cancelled the elbow's `+0.25*ck`. It is now `+0.55*cW`, so the wrist cocks BACK. The elbow bends a further 0.12.
- **Side bends.** The elbow folds the hand in by 0.15.
  - I tried a wrist fold too (the audit's 0.30). It turned the open pincer edge-on to a diver in front of her: gape-plane facing 0.17, against 0.42 shipped. So the wrist fold is 0, which gives a facing of 0.32.
- **Fall.** The shoulder lets go of its cock at once, as shipped. The elbow keeps `1 - u^2` of its cock and the wrist keeps `1 - u^3.4`, where `u` reaches 1 at 85% of the fall. The palm stays cocked back while the merus comes down, then whips through. It peaks at about 24° per frame against the merus's 13°.
- **Recoil.** The carpus and palm get the shoulder's bounce 0.035 s and 0.075 s late, in world pitch. The hand drags, flicks up past the merus and settles.
- **The gate.** Every offset fades out as `L.swing` rises from 0.45 to 0.75.
  - The floor clamp first touches the sand at about 0.80, and the hit test runs above 0.85.
  - So the blow reaches the sand and the hit window on the shipped joint angles, and the offsets stay off until the swing falls back under 0.75.
- **Measured range.** The merus-to-palm angle now ranges 31.1–66.4° over a blow, which is 35.4°. Main ranges 30.2–32.0°, which is 1.8°.

### 2. The pincer has its own beat (`CHELA`)

This is the audit's simulated channel, keyed to `hamPh` and `impT`.

| beat | finger angle |
|---|---|
| rest | 26° |
| cock | opens ahead of the rise to 77°, with a ±2° quiver in the hold |
| fall | held open |
| landing frame onward | snaps 53.5°, 24.9°, 8.6° (shut on the third frame) |
| rebound | to 18° on frame +5, re-seated at 8.6° by frame +10 |
| hold | shut for 0.28 s |
| release | lets go late in the recoil |

- `L.clackN` counts one clack per blow. No audio is wired to it yet.
- At threat 0 the finger keeps the old idle close. The ward flinch still snatches it shut.

### 3. The hit point does not move

`clampClaw` runs the floor clamp with the SHIPPED finger angle (`c.djShip`), then puts the new finger back.

- If the new angle is in the sand, `fingerFloor` bisects it toward the shipped angle just far enough to clear it. The finger stops on the sand.
- Without this, the open or snapping finger changed the clamp's shoulder and elbow lift. In the same-page A/B that moved the hinge 0.3–1.6 u on the hit frames, about twice the noise.
- The hit test reads the hinge's world position (`dj.getWorldPosition`), which the finger's own rotation never moves.

### 4. The minor claw (the cutter)

Its finger never closes past 26°, awake or folded asleep (`CHELA.minor`, applied after the DORM blend). Before, it went down to about 5° at idle and -17° folded, which runs it through its own fangs.

- No re-bake.
- Asleep, it lies under her brow. The before/after freeze frames from a lens at her brow show no visible difference.
- `sleeperFingerprint(0)` is unchanged.

### 5. Lab A/B

`window.__claw.WHIP.on` and `CHELA.on` set to 0 give the shipped rod and finger, and the shipped cutter, on the same page. The strips, the probe's `CP_AB` mode and the A/B below all use this.

## How Michael sees it

Wake her and stand in front of her: Alt+6 at the harpoon, then pull.

- From his lens, the claw lands with the pincer open and snaps shut on the sand in two frames, then stays shut while the arm bounces up.
- From the side, or from further out, the claw cocks back like a whip handle, the open pincer comes down, and the palm flips through at the end.

Frame strips, one blow every 0.05 s, before and after, landing on sample #24:

- `shots/clawfix-sheet-blow.png`: hold → fall → landing snap → recoil, with side and game lenses, before and after. **Start here.**
- `shots/clawfix-strip-{before,after}-{game,side}.png`: the whole blow, 40 samples each.
- `shots/clawfix-strips/`: the single frames, plus `clawfix-strips.json` with the finger angle and merus-to-palm angle per sample.
- Recapture with `DRV_PORT=9512 node tools/bench/claw-strip.mjs 8860`.

## Measurements

### Pose probe (`tools/bench/claw-pose-probe.mjs`)

Setup: Velkath held mid-threat, Sal 34 u out and 9 u to her left, two blows, every frame rendered. Main is served from the same server (an untracked `_base/` copy of `5ab282b`).

| assertion | main 5ab282b | clawfix |
|---|---|---|
| merus-to-palm range ≥ 25° | **1.8° FAIL** | **35.4° PASS** |
| finger opens ≥ 30° from cock start to hold | 19.8° FAIL (67.8 → 87.7°: parked open by the threat) | 51.7° PASS (25.9 → 77.7°) |
| finger open (≥ 45°) on the last fall frame | 22° FAIL (it closes during the fall) | 77.4° PASS |
| finger shut (≤ 12°) within 3 frames of landing | 16° FAIL | 8.6° PASS (53.5, 24.9, 8.6) |

- Exit codes: main 1, clawfix 0.
- Offline, `node tools/bench/claw-sim.mjs` shows the hinge drift from the shipped pose on every hit-test frame is exactly 0.

### Hit window, same-page A/B

Command: `CP_AB=1 node tools/bench/claw-pose-probe.mjs 8860 '' ab`. The blows alternate OFF, ON, OFF, ON, OFF. The hammer is 156 frames, so the blows sample the same phases. The hinge is measured in her body frame on the 8 frames per blow where the hit test can run.

| comparison | max | mean |
|---|---|---|
| OFF vs OFF (blows 2, 4): the noise floor | 0.56 u | 0.18 u |
| ON (blow 3) vs the OFF blows either side | 0.38 / 0.48 u | 0.25 / 0.32 u |

- The hit radius is 6.5 u.
- Blow 1 differs from every later blow, ON and OFF alike (mean 0.55–0.79 u). That is the setup settling, not the change.
- The clamp's shoulder lift on the hit frames is the same ON and OFF: 14–16°, then 25.8°, then about 28°.

### Lens and capsules (bodyCols)

Measured at fight range: 30 u at -9 and 28 u at +4, both with BOSSCAM partly on. Same probe, main against the branch at 28d8f7d. The fold has changed since then, and that change only moves the raised arm.

| spot | lens distance, main | lens distance, branch | max per-frame step, main | max per-frame step, branch |
|---|---|---|---|---|
| 30 u, -9 | 1.98–8.77 u | 2.02–8.70 u | 0.27 | 0.31 |
| 28 u, +4 | 1.95–8.62 u | 2.04–8.46 u | 0.21 | 0.27 |

- No one-frame pull-in on the snap frames. The lens sits 2–3 u from him around the landing at the first spot on main too, so that is pre-existing.
- At 30 u, -9 the landing claw shoves Sal on both: 1.38 u over two blows on main, 1.37 u on the branch. Elsewhere it does not shove him.
- At 34 u, +9 the lens holds at 8.9–9.6 u on both.

### Framing from the game camera

Setup: Sal 35 u out, boom free, BOSSCAM off.

| | main | branch |
|---|---|---|
| frames with the claw in frame | 8/156 (fall 2/9, recoil 6/15) | 9/156 (fall 2/10, recoil 7/15) |
| cocked finger tip, NDC y (1.0 = top edge) | 4.1–4.5 | 1.9–2.1 |

- Lowering the cock apex by 0.15 or 0.30 rad moved the tip to 2.1–2.4 and 2.3–2.7. That is further out of frame: a lower merus brings the cocked hand toward the lens. So the apex is unchanged (`WHIP.apex` 0).
- At fight range the wind-up stays above the follow lens. The beat in frame is the landing, which is where the snap now happens (game strip #24–#26).
- The one lever left is a camera EVENT, such as BOSSCAM tilting toward the raised claw between `PH_COCK1` and `PH_SLAM0`. That is game.js, so it is the orchestrator's or Michael's call. I have not done it.

### Riteplay (`tools/bench/riteplay.mjs`, shared `ritepolicy.mjs`)

Each cell: calm time / hammer and drop hits (h) and tears (t) / drops (clean, sweeps, slams). Base passes ran on unchanged code. The new passes ran on the final code.

Run as `riteplay.mjs 8860 <site> <mode> <tag> <seed>`. Base passes 1 and 2 were served from the root before the code changed. Base pass 3 went through `_base/`. Two Chromes ran in parallel throughout.

| run | base pass 1 | base pass 2 | base pass 3 | clawfix pass 1 | clawfix pass 2 |
|---|---|---|---|---|---|
| home perfect 1 | 36.1s / 0h 0t / 2d (2c 0s 0x) | 58.6s / 0h 0t / 2d (2c 0s 0x) | 52.4s / 0h 0t / 1d (1c 0s 0x) | 60.5s / 1h 1t / 2d (2c 0s 0x) | 54.6s / 1h 1t / 2d (2c 0s 0x) |
| home perfect 2 | 36.1s / 0h 0t / 2d (2c 0s 0x) | 58.9s / 0h 0t / 1d (1c 0s 0x) | 38.9s / 0h 0t / 2d (2c 0s 0x) | 48.4s / 0h 0t / 2d (2c 0s 0x) | 37.7s / 0h 0t / 2d (2c 0s 0x) |
| home average 1 | 23.1s / 0h 0t / 3d (3c 0s 0x) | (no ledger: stale Chrome) | 39.2s / 1h 1t / 5d (4c 0s 1x) | 25.3s / 1h 1t / 2d (1c 1s 0x) | 56.2s / 2h 2t / 5d (3c 0s 2x) |
| home average 2 | 36.5s / 3h 3t / 3d (1c 0s 2x) | 24.9s / 1h 1t / 2d (2c 0s 0x) | 126.4s / 2h 2t / 6d (4c 1s 1x) | 82.2s / 3h 3t / 3d (1c 1s 1x) | 68.9s / 3h 3t / 6d (3c 0s 3x) |
| home average 3 | 31.9s / 1h 1t / 5d (4c 0s 1x) | (no ledger: stale Chrome) | 58.1s / 1h 1t / 4d (3c 0s 1x) | 57.3s / 0h 0t / 5d (4c 1s 0x) | 59.5s / 1h 1t / 4d (4c 0s 0x) |
| pallid average 1 | 31.5s / 0h 0t / 3d (3c 0s 0x) | 28.5s / 0h 0t / 2d (2c 0s 0x) | 130.4s / 2h 2t / 4d (3c 0s 1x) | 25.1s / 0h 0t / 1d (1c 0s 0x) | 24.8s / 0h 0t / 0d (0c 0s 0x) |

- **Base is noisy.** The same seeds on unchanged code spread widely:
  - perfect: 36.1 s in one pass, 58.6–58.9 s in the next;
  - average seed 1: 23.1 s and 0 hits in one pass, 39.2 s and 1 hit in another;
  - average seed 2: 3 hits, then 1.
- **No hammer hit in any run**, base or new. Every hit was a drop slam or a leg contact (`__slamLog`: `blow`, `legNN`).
- **What the claw can still change.** Its capsules (bodyCols) follow the drawn pieces, so they move:
  - in the guard: the finger's three capsules sit at 26°, not about 70°;
  - through the cock and the first half of the fall;
  - in the recoil: the lagged drag, and the floor clamp's lift on those frames.
- **What I measured:**
  - no hammer hits in any run;
  - the hit window unchanged within noise (the A/B above);
  - the lens distance and the landing shove comparable at the two fight-range spots (the Lens table above).

- **Summary, base (16 runs) against clawfix (12 runs).**
  - Perfect calm times: base 36.1, 36.1, 58.6, 58.9, 52.4, 38.9 s; clawfix 60.5, 48.4, 54.6, 37.7 s.
  - Average calm times: base 23.1–130.4 s; clawfix 24.8–82.2 s.
  - Tears per average run: base 0–3; clawfix 0–3.
  - Drops per run: base 1–6; clawfix 0–6.
  - Every clawfix calm time and drop count is inside base's spread for its mode. Against base's spread for the same seed, some sit just outside:
    - perfect seed 1: 60.5 s against base's 36.1–58.6 s;
    - average seed 1: 56.2 s against 23.1–39.2 s;
    - average seed 3: 59.5 s against 31.9–58.1 s;
    - Pallid: 24.8–25.1 s against 28.5–130.4 s.
  - With 1–3 base samples per seed, the spread for a single seed is not known well enough to call these a change.
- **Perfect seed 1's leg-contact tears are noise, not the claw.** It took one tear in each of the two clawfix passes (`leg34`, `leg29`), and none of 6 base perfect runs did. So I ran it again on one build with the lab switch, `RP_PRE="__claw.WHIP.on=0;__claw.CHELA.on=0"`. That gives the shipped rod, finger and cutter on otherwise identical code, under the same two-Chrome load.

  | claw | calm times | tears | hammer hits | logs |
  |---|---|---|---|---|
  | OFF | 73.6, 53.9, 44.6 s | 2 of 3 runs (`leg26`, `leg8`) | 0 | `logs/ab-off-*` |
  | ON | 52.1, 38.4, 79.6 s | 0 of 3 runs | 0 | `logs/ab-on-*` |

  - Leg contacts with her walking legs happen with or without the new claw. Base passes 1–3 just didn't draw one for the perfect player.
- **What the claw can still change.** Its capsules (bodyCols) follow the drawn pieces, so they move:
  - in the guard: the finger's three capsules sit at 26°, not about 70°;
  - through the cock and the first half of the fall;
  - in the recoil: the lagged drag, and the floor clamp's lift on those frames.
- **What I measured:**
  - no hammer hits in any run;
  - the hit window unchanged within noise (the A/B above);
  - the lens distance and the landing shove comparable at the two fight-range spots (the Lens table above).

- **Summary, base (16 runs) against clawfix (12 runs).**
  - Perfect calm times: base 36.1, 36.1, 58.6, 58.9, 52.4, 38.9 s; clawfix 60.5, 48.4, 54.6, 37.7 s.
  - Average calm times: base 23.1–130.4 s; clawfix 24.8–82.2 s.
  - Tears per average run: base 0–3; clawfix 0–3.
  - Drops per run: base 1–6; clawfix 0–6.
  - Every clawfix calm time and drop count is inside base's spread for its mode. Against base's spread for the same seed, some sit just outside:
    - perfect seed 1: 60.5 s against base's 36.1–58.6 s;
    - average seed 1: 56.2 s against 23.1–39.2 s;
    - average seed 3: 59.5 s against 31.9–58.1 s;
    - Pallid: 24.8–25.1 s against 28.5–130.4 s.
  - With 1–3 base samples per seed, the spread for a single seed is not known well enough to call these a change.
- **Not explained by noise with certainty: perfect seed 1.** It took one tear in each clawfix run (`leg34` at 52 s and `leg29` at 48 s, two legs coming into him). It took none in 3 base runs of that seed, and no base perfect run of either seed took a hit (0 of 6).
  - Leg contacts do happen on base too: `leg29`, `leg7` and `shell` in the average runs.
  - The claw strike cannot move her legs. My best explanation is that the perfect player's path diverges after its first changed contact with the guard claw, but two runs cannot prove it.
  - If Michael feels her as harder, this is the place to look. The first thing to try is the guard finger's capsules: `CHELA.rest` back toward the old ~70° under threat.

### Gates

Final code, on 8860:

- `tools/bench/fissure-probe.mjs velkath-crack`: **PASS**.
- `tools/bench/harpoon-probe.mjs rite`: **PASS**. The earlier code passed both too.
- `tools/bench/velfix-gate.mjs` (crack route): **RED on both main and clawfix, so the RED was already on main.**
  - Alone (no other Chrome): main wash 9 frames (max outside 0.13), lens on her drawn surface 2 frames after the calm. Clawfix wash 11 frames (max outside 0.088), lens surface 0.
  - Under load (two Chromes): main wash 14, lens surface 0; clawfix wash 9–15, lens surface 4–13.
  - The post-calm lens hits are her body mesh (`Mesh:3591` under the body group) as she walks home with him under her. They are not a claw. The claws are idle after the calm, where only the cutter's ≥26° floor differs.
  - The gate is load-sensitive (VELFIX-REPORT Finding 1), and it fails on main in this environment.

### Invariants

Fresh Chrome, final code, `tools/bench/brooder-invariants.mjs`:

- 14 lights.
- `__lev.fp(0/1/2)` = 15ce888c / c938fe6e / 652d0412.
- `__ridge.fp()` = 3b526986.
- `__safeFailed()` = [] and `__shaderFailed()` = [], before and after the fingerprints.
- `sleeperFingerprint(0)` = **ecfa371e**, unchanged (twice, deterministic).
- Console clean apart from the favicon 404.

Zero per-frame allocation: the spring and finger state live on the claw (`c.wh`, `c.fs`), created once. `fingerFloor` uses module scratch, with no closures. No lights were added.

## Concerns and weaknesses

- **The wind-up is still out of his lens at fight range.** This is measured, not guessed. Fixing it needs a camera event (see Framing).
- **The cocked pose is new.** At the hold the merus-to-palm angle is about 68°, with the wrist pitched back and the elbow folded 0.15.
  - Freeze frames from the front, the front-side and face-on to the gape show no cuff seams and nothing cutting into her brow or eyestalks.
  - From straight in front, the open pincer is less of a V than on main (facing 0.32 against 0.42).
  - Only one terrain spot was checked.
- **The floor clamp sees the shipped finger, not the drawn one.** This is deliberate (section 3). If the drawn finger would enter the sand, `fingerFloor` stops it. I did not measure how often that fires.
- **Perf is unmeasured.** The cost is one extra hull-sample test of the major finger per awake frame, plus a short bisection when it touches sand.
- **Audio.** `L.clackN` exists, but `audio/creatures.js` does not answer it yet.
- **Tools.** The page-side `import('/src/...')` calls in riteplay.mjs, fullplay.mjs and fullplay-gate.mjs now resolve against the page (`document.baseURI`), so the tools work under a sub-path. At the root this changes nothing.
- **Roadmap.** There is no card for this work, so I logged nothing. I did not regenerate ROADMAP.html.

## Files

- `src/entities/sleeper/brooderClaw.js` (new): `WHIP`, `CHELA`, `whip()`, `chela()`, the hammer phases.
- `src/entities/sleeper/brooder.js`:
  - `poseClaws(L, dt)` applies the module.
  - `clampClaw` and `fingerFloor` handle the clamp.
  - The cutter's floor is applied after the DORM blend.
  - `window.__claw` exposes the lab knobs.
- `tools/bench/claw-pose-probe.mjs`: the RED/GREEN probe, plus the `CP_AB` and `CP_SET` modes.
- `tools/bench/claw-sim.mjs`: offline.
- `tools/bench/claw-strip.mjs`: the strips.
- Evidence:
  - `shots/clawfix-probe/` (probe JSONs: `claw-pose-main2`, `claw-pose-final2`, `claw-ab-abfinal`, `claw-pose-lens-*`)
  - `shots/clawfix-rp/` (riteplay ledgers)
  - `shots/clawfix-*.png`
