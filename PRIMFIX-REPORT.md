# primfix: seabed objects that read as primitives, replaced

2026-10-13 · branch `primfix` (from main `5ab282b`) · brief: the audit's "obvious six" plus the bugs
(reviews/primitives-audit.md).

Contact sheet (BEFORE | AFTER, same camera per pair): `/Users/michaelpaulus/sc/.abyssa-wt/shots/primfix-before-after.png`
All frames: `/Users/michaelpaulus/sc/.abyssa-wt/shots/primfix/{before,after}/` (tool: `tools/bench/primfix-shots.mjs <port> <tag> [outdir] [only]`, `PF_BASE=/<dir>` shoots another checkout served on the same port).

## Status

All seven items are done and committed, and the invariants hold.

Cost is **unmeasured**. The host was contended, so timings couldn't resolve anything below about ±1 ms. The measured triangle deltas are +1.8 % to +1.9 % at the changed sites; details below.

| # | Item | Commit |
|---|---|---|
| 1 | Physics debris | `87b4586` (+ note `4ae350c`) |
| 2–4 | Shed shell, spent casings, trail pits | `f8657e7` (+ tune `cc15ded`) |
| 5 | Velkath's back reef | `f62a8a3` |
| 6 | Skiff deck kit + relic beacon | `18c24aa` (+ seat `950837e`) |
| 7 | Bugs: node in a boulder, hovering props and nodes | `08270ef` |
| — | Cost trims, beacon on the skiff only, boot-tail compile of her fresh build | `6683c7a` |

## What changed

**1. Physics debris (`systems/physics.js`).** The Rapier bodies were vestigial, so I removed them.
- Nothing read the bodies: no gameplay, no camera, no collision on Sal's side.
- Sal shoved a stone with a 0.9 u ball at his feet, about once per 250 u walked.
- A half-buried stone in a silt drift cannot be kicked loose anyway.
- Rapier is no longer fetched. It was loaded only for these bodies. physics.js keeps its contract, so game.js is unchanged.
- The debris is now about 87 static stones per zone, laid in clusters (a parent stone and the pieces broken off it).
- The shapes are flora.js `jamRockKit`'s four (the fissure jam's set) on flora's rock program: rockMapSet triplanar, no new programs.
- Each stone is seated on the drawn floor (`wrecks.js terrainSample`, which reads the fissure patch near the crack), sunk 28–42 %, with a silt drift from `driftSkirt` (the terrain's own material, banked on the lee).
- Layout comes from its own stream, `site.js seeds.debris` mixed with the zone. Boot and arrive-back give the same layout (instance-matrix hash 780140223 both times). No terrain stream moves.
- Stones are kept off the crack, Velkath's bed, wreck sites, flora boulders and steep ground.
- **The fall-through bug, measured on main.** Over three boots, 4–6 of the 120 bodies were 25–87 u under the floor about 10 s in, not just one. About half had spawned inside a flora boulder's fixed ball. The rest are unexplained; the likely cause is that placement read a bilinear sample of a triangulated 3.1 u collider. The bodies are gone, so this no longer applies.
- **Correction:** commit `87b4586` states the boulder cause as fact. `4ae350c` corrects it in the code comment.

**2. Shed shell (`brood.js moultGeo`).** It is now her own moult:
- her lathe (`shellAt` / `rimR`), dorsal shell only, at 0.42 R;
- **split down the back**: the seam opens from the rear margin toward the crown, the halves have sprung apart, and the lips are ragged;
- the margin chipped, the dome slumped and dented;
- her carapace maps (map, normal, roughness), weathered in vertex colour: grime, lime crust, silt on the faces that look up;
- laid along the broad slope with the split turned toward the trail Sal comes in by;
- seated so its whole margin sits a hand under the drawn floor, so no rim floats on any slope, with silt drifted over the margin.

**3. Spent casings.** Down from 420 squashed pills (49 hovering, all bobbing) to 240 torn empty egg skins.
- `casingGeo`: a collapsed, wrinkled dish with a torn hatch and its flap; two-sided.
- Drawn in the clutch program's casing mode: each turned to its own bearing, thin and pale amber-grey, silt-stained where it touches the floor, with the lantern showing through.
- Laid in clumps against the moult's margin, mostly on its lee, plus strays thinning out along the trail.
- Every skin sits on the drawn floor or on the drift. Measured: 0 to 0.42 u above the floor (the 0.42 is the drift), none below.

**4. Trail pits.** The 132 unlit black ovals are now prints pressed into the silt (`printGeo`).
- Each is a pointed oval along the trail's own heading.
- The floor is dished and shaded in the terrain's AO channel, with the silt shoved up in a lip that is highest behind the print.
- They use the terrain's own material, so they are lit, caustic-lit and rippled like the floor.
- The prints and the moult's drift are one mesh. It is taken out of her group before her dispose traversal, so the seabed material is never freed.

**5. Back reef (`brooderGeo.js reefGeo`).**
- Budding clumps of bent, lumpy, constricted tube sponges with oblique lips.
- Seven encrusting sponge mats, six coralline lumps, and the two fans.
- Muted ochre / olive / rust / bone / umber / greyed rose. The slate blue is gone.
- Still one merged vertex-coloured mesh on the same material, placed by `topH`, so `installSculpt` rebuilds it on her sculpted shell exactly as before (all frames are with the sculpt installed).

**6. Skiff deck kit (`wrecks.js`).** Everything uses the palette's own materials, so there are no new programs. Each prop is seated on the live floor in the wreck's frame; buildWrecks now computes the settle before `make()`.
- Each crate is seated on the lowest floor under its four corners.
- The fallen mast is seated by both ends, with its axis (and the hoops on it) running between them.
- Checked at home and at Pallid: every crate corner's lowest vertex is 0.11–0.28 u under the drawn floor, and both mast ends are 0.12–0.17 u under.
- Plank crates: chamfered boards with gaps, corner battens, iron straps with nail heads, a sprung or missing lid board, a side board fallen off beside the crate.
- The relic crate stands open, its lid of battened boards pried off and leaning.
- Two rope coils, the sounding lead on its line, and a ship's lantern on its side.
- The mast hoops are now on the fallen mast; they used to stand alone in the sand. The fallen mast is seated half in the silt. The sounding set's box is bevelled.
- **Beacon:** the relic beacon on the skiff is now a small brass-capped lamp glass on the sounding set, using the wreck's lit program, and it turns slowly instead of tumbling.
  - The trawler and the sub keep their old beacon, bit for bit: a lamp floating over a spear gun or a thruster would read wrong.
  - At 20 u it reads as a warm lamp. It is a little dimmer than the old white ball, and the two warm halos still carry the range.

**7. Bugs.**
- The polymer node "inside a boulder" (home, 27.1, 25.5) sat 6.7 u from the centre of a big boulder's collider ball (r 8.2), inside its circle at the floor.
- Any node inside a flora boulder's footprint is now pushed out to the rim + 1.2 u. This makes no stream draw, so every other node is unchanged.
- **Real input:** Sal stood 5 u out from the moved node, facing it, and W was held for 3.5 s through CDP. He picked it up: polymer 0 → 1, node taken at 1.6 u.
- **Correction to the audit:** the same test on main also picked the node up (at 2.66 u; the pickup radius is 3.2). It was embedded in the collider, not unreachable from the open side.
- Nodes now drape on the drawn floor. Using `terrainH` had left them 0.10–0.20 u clear.
- Props (logs, barrels) are now seated by their own sampled points. One log stood 0.36 u clear at home and 1.03 u clear at Pallid.
- Survey after the fix (fresh boot, then Pallid), covering 142 props, all nodes, all debris, the moult and the relics: nothing more than 0.08 u clear of the floor, nothing wholly under it, no node in a boulder.

## Verification (fresh headless tab, HEAD)

**Invariants**
- Lights: 14.
- `__lev.fp`: 15ce888c / c938fe6e / 652d0412.
- Terrain fp: home 3b526986, zones 1+2 d49d451d, Pallid b1c58f8d, Burned d2b6fb68.
- `sleeperFingerprint(0)`: ecfa371e, unchanged.
- `__safeFailed()` and `__shaderFailed()` both [].
- Console: only the favicon 404 and the three.js warnings already on main.

**Programs**
- Flat across home→Pallid→Burned→home ×2: 717 at every arrival. Main is flat at 725.

**Memory**
- Across the same soak, geometries stay flat at 308–309 and textures at 383 after the first voyage.
- Boot holds 457 geometries, with the rehearsal's extras.

**The crack**
- Everything on the trail is far outside the crack's lip, at home and at Pallid. Minimum `fissureDist`: prints 52 u, casings 44 u, the moult's rim 64 u, the relics 60 u.
- So the drawn floor (`terrainSample`, which includes the fissure patch) is the live floor for all of it. `shutFloorY` / the jam only exist inside the lip.
- The debris keeps the lip + 6 u clearance.

**First-sight compile**
- I fixed one regression of mine: the relics' program used to ride on the old shell's program and lost that when the shell got its own.
- Her trail is laid only once the sculpt is in hand. The boot's first zone-0 build therefore never had the relics. On main it also never compiled the clutch program (`brood|clutch|field`) or its micro layer, which were first-sight compiles.
- `game.js rehearseSleepers` now precompiles her fresh group at both sun-shadow states.
- Walking up to the shell now adds 3 generic shadow-depth programs (main adds 4). The skiff adds 1 (main adds 3). No material program is compiled at first sight any more.
- Method: program-list diffs before and after standing at each spot, in a tab that never ran the `__lev.fp` probes. Those probes dispose her outside `keepingPrograms`, so her programs rebuild at first sight afterwards.

**Cost** — unmeasured (host contended)
- The bench's own calibration flagged the GPU as contaminated. Stepped sync run at the skiff on primfix: gcal 1.7 ms against about 1.2 nominal, `busyGpu: true`, cal 2.6 ms. Wall 11.1 ms, of which CPU update 0.8 and submit 3.2.
- Frames ran 10–15 ms, where CLAUDE.md measured 3.7–6.3 ms.
- Cross-load ABBA (bench host, dpr 2, vsync off): z0, z0b, the skiff and the trail all differed by less than the A-vs-A spread of ±3 ms.
- In-page paired liveAB, each changed set shown vs hidden, 6 pairs × 2.5 s: medians were −0.05 to +0.30 ms on primfix and +0.2 to +0.5 ms on main. No set's cost could be told apart from noise on either build.
- Triangles (`__bench.draws`):
  - Beside the skiff: 7.01M → 7.15M (+1.9 %, after removing shadow casting from the deck kit's small parts). Calls 352 → 356.
  - At the trail: 7.38M → 7.51M (+1.8 %). Calls 333 → 348.
- Re-measure on a quiet host before merge.

**Survey**
- 20 home spots, 6 at Pallid plus her trail, the skiff and debris there, and home again: before and after, all re-shot on HEAD and paged through.
- The 20 home spots are my own rings and bearings (r 30–150). The audit never recorded its coordinates.
- Every dodecahedron and the white lens of the old shell are gone from the survey.
- The new stones are sparse at survey range and read as rock.

## Concerns and notes for the merge

- **Beacon:** the skiff's beacon core is a warm lamp now, slightly weaker at 20 u than the old fog-free white ball. If discovery suffers, the halo opacity is the knob.
- **Pits:** the prints are subtler than the black ovals were. They read as depressions under the lantern; at 15 u and more they mostly disappear into the ripples.
- **Casings:** these still read as small pale flakes at about 5 u, at true scale. They no longer read as pills, and none hover.
- **CLAUDE.md is now wrong in two places:**
  - `systems/physics.js — Rapier WASM via CDN` (Architecture section).
  - The Boot/loading text saying Rapier is awaited.
  - The loader's physics step still runs; it resolves at once.
- **Fall-through claim:** commit `87b4586` states the fall-through cause too confidently. The measured version is in `4ae350c` and above.
- **`game.js` changed (orchestrator-owned).** Four lines in the boot tail (`rehearseSleepers`): her fresh zone-0 group is precompiled at both sun-shadow states. Nothing else in game.js changed. physics.js keeps its contract, so the wiring is untouched.
- **Out of scope:** the audit's medium items (drift logs, plantKit tube/table/barrel sponges, polymer material, flora boulder silhouettes, vent rubble, the submersible's crate) are untouched.
