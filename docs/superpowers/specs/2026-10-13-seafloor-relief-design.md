# Sea-floor relief, home zone 0 — design (2026-10-13)

Michael (verbatim): "the sea floor is all one level, like a big pit. Lets make that more dynamic but keep
velkaths lair in the deepest part."

Rulings (brainstorm, 2026-10-13):
- Shape: **uplands + a hollow** (his pick: "Uplands + hollow (Recommended)").
- Feel: **mostly walkable** ("Mostly walkable (Recommended)": rolling ground you can walk almost everywhere, a
  few outcrops and ledges you go round or hop up; the drama comes from the view).
- Build: **tune the existing terrain generator** and borrow a little hand-shaping for the hollow's terraces and
  outcrops. A precomputed erosion heightmap was rejected: it would change how collision and every placement work.
- **Home only.** Pallid Bank's line "VELKATH KEEPS NO DEPTH HERE" stays true; the Burned Ground is unchanged too.
- Home's terrain fingerprint re-anchors, recorded in CLAUDE.md, as THE FAR RIDGE and THE FISSURE did.

Evidence: the relief audit (`docs/reports/2026-10-13-seabed-relief-audit.md`) and a node replica of `heightAt`
that matches the game to 2e-13 and reproduces every fingerprint (`~/sc/.abyssa-wt/reviews/seabed-relief-tool/`;
the variants below are its `levers.mjs` / `levers2.mjs`).

## What Michael will see

- **From the raft.** You sink onto the upper flank of a broad hollow. The floor falls about 30 u toward her
  crack in two or three broad terraces, which wander and break rather than forming rings. Ridgelines and higher
  ground rise behind you to the north-west and around the edges.
- **The bottom.** Her crack and her bed lie in the deepest ground, with the lowest point beside her. The bottom
  has swells and a few rock outcrops, so it is not a smaller flat pit. The ground where she fights stays gentle,
  so her ward heights and the fight are unchanged.
- **What moves.**
  - Velkath moves to the raft side of her crack. That was her designed spot; today the skiff crowds it by 4 u
    and she flips to the far flank.
  - The skiff is kept out of the hollow's bottom, so it sits on higher ground, likely a terrace above her.
  - Plants, props, debris and the trail re-place by their own rules on the new ground.
  - Unchanged: the raft, all three cracks' positions, zones 1 and 2, Pallid Bank, the Burned Ground.
- **Two calls made for you.** Say if you want either the other way.
  1. **The crack's throat keeps its present floor depth.** Since the lip is now ~33 u lower, the throat is
     ~40 u deep below its lip instead of ~73 u. The zone change then still fires just above the throat floor,
     as now. Keeping today's depth below the lip instead would put the zone change halfway down the throat, and
     the throat's bottom would sit in a band of open water that turns murky (a known latent fault). You'll get
     a before/after view into the open throat from its lip to judge it.
  2. **The hollow reads darker and somewhat murkier than the shelf.** At the bottom the silt layer is at full
     density (today's floor gets ~88% of it) and the ambient light is ~0.82× today's; auto-exposure makes up part of it. *I told you
     earlier the hollow would not be murkier. That was wrong.* It suits a lair; you judge it on the stills.

## The design

### 1. Scope, and how home keeps its changes to itself

- **Zone 0 at home only.** Home gets its own `shape` and `wrecks` rows in `world/site.js`, as Pallid and the
  Burned Ground already have. The shipped `ZP[0]` literals in `terrain.js` do not change. Changing them would
  leak to the remote sites, which inherit every knob their rows don't override: `roc` and `r3amp` to Pallid,
  `cnamp` to Burned, `camp` and every wavelength to both.
- **Site 0 stops being bit-identical to the shipped world.** Its comment and CLAUDE.md say so. Its new
  fingerprint becomes the regression anchor.
- **Must not move:**
  - `__ridge.fp([1,2])` d49d451d;
  - Pallid b1c58f8d and Burned d2b6fb68;
  - wreck sites for zones 1 and 2;
  - `sleeperFingerprint` for zones 1 and 2 (ac04921e, ce3eaf9d).

### 2. The uplands

- **Wake zone 0's massif machinery in home's `shape` row.** Today `rbias −0.32` holds the ridge mask off over
  81% of the floor. The starting values are V9c's: `rbias −0.05`, `ramp 42`, `roc 4`, `r3amp 3`, `s2amp 6`,
  `camp 50`. Tune from there.
- **Keep the ridges off the places that matter.** Mask them (rk) off the crack and apron, both of her flank
  stations, the raft column, and the band between the raft and her bed.
- **Masks use frozen geometry only:** `FISSURE[0]`, `riftPos(0)`, the station points as computed from the
  fissure frame, and the origin. Never `bedAt()` or `velkathLair`. Her bed is placed after the terrain, so keying
  the terrain to it would go round in a circle.

### 3. The hollow (not a lathe)

- **What it is.** A sunk floor added in `heightAt` **after** the soft-floor knee. Before the knee, the 4:1
  compression eats a third of it and flattens the bottom. It applies to zone 0 at home only and is centred on
  `riftPos(0)`.
- **Depth.** 28–35 u at the bottom (V10b: 30).
- **What the bottom must contain:** the crack, its apron, both flank stations and her body.
- **It is not round.** Its flat-bottom radius and outer edge vary with bearing, so it is not a lathe. A round
  bowl centred on the crack would be "the big pit" again, smaller: the eye reads concentric rings at one
  distance. The project killed that look for the rim with bearing harmonics, and the hollow uses the same tool.
  - It is tight on the raft's bearing, so the raft column stays up on the flank.
  - It is wide away from the raft, out toward the NE.
  - Low harmonics (or noise) make the outline wander.
  - Its outer reach fades out before the basin rim's onset `rin`, so the NE rim foot and the far ridge are not
    lowered.
- **The apron target becomes relative** (`18 + hollow(x, z)`). With the shipped absolute target the crack would
  stand on a ~21 u berm (V6).
- **A target, not a requirement: the raft column (mean over r ≤ 15 u) sinks ≤ 12 u**, and the floor falls
  ≥ 20 u from it to her bed. That fall is the "floor falls toward her crack" read from where Sal lands.
  - A radial hollow puts the raft column ~24 u down (V9c), which kills that read.
  - The bearing-varying V10b holds it to 6.6 u, with a 31.4 u fall to her bed.
  - If this target and the walkability bars (§4) conflict, **walkability wins**. It was his explicit pick.

### 4. Terraces, outcrops, and her ground

- **Two or three terraces.** They are broad treads built into the hollow's own profile. The global `terrace()`
  quantiser would step the whole floor, so it is not used.
  - Tread lines wander with bearing and break.
  - No riser is a continuous ring: each one has walkable ramps through it on several bearings.
- **The bottom is not flat.** Outside her fight ground it gets gentle swells and a few rock outcrops, so the
  levelling is partial, not V3c's 85%. Primfix's seabed debris still lands there by its own rules.
- **Drawn ground = stood-on ground.** Collision reads `terrainH` exactly, but the basin mesh pitch is ~1.7–2.3 u.
  - Any riser, outcrop face or step steeper than ~35° spans at least two mesh cells, a run of ≥ ~4 u.
  - Nothing sharp lives between vertices, or Sal's boots float or sink at every riser. The fissure needed its
    own 0.5 u patch for exactly this, and this design does not add another one.
- **Her fight ground stays gentle.** The rite assumes level ground: a bank under one side once lifted her wards
  to 10–17 u. Today's NW-bed values are the bars.
  - Relief under her body (R 15.4) ≤ 3 u.
  - Relief under her bed footprint (23.9 u) ≤ 6.5 u.
  - Relief across her 45 u arena ≤ 11.5 u.
  - V10b gives 5 / 6.3 / 11, so the levelling near her station needs to be stronger.

### 5. Her bed and the skiff (deterministic)

- **The problem.** Today `velkathLair` tries her designed raft-side flank first. The skiff vetoes it when it
  lies within 46.8 u of her lip or within 22 u of her head. The skiff's flatness search moves with every terrain
  change, and its outcome flips which flank she takes. In the replica the skiff landed in four different places
  across five hollow variants. Tuning against gates that move with each iteration would never settle.
- **The rule.** Home's `wrecks` row fences zone 0's skiff search ring to start ≥ 100 u from `riftPos(0)` (the
  shipped default starts at 70).
  - Her raft-side lip is 45.5 u from `riftPos(0)`. Her trail head is at most 73.2 u from it, since `HEAD_R` puts
    it 1.8 R further out on the sand side.
  - By the triangle inequality the skiff is then always ≥ 54.5 u from her lip and ≥ 26.8 u from her head. Both
    are past the 46.8 u and 22 u vetoes, so the veto can never fire. A ring starting at 95 would miss the head
    veto by 0.2 u.
  - She always takes her designed station, at (89.7, 39.1) today, which is a pure function of the frozen fissure
    frame.
  - The skiff still lands on the flattest ground in its ring, likely a terrace tread or upland bench above her.
  - Zones 1 and 2 keep their shipped bands.
- **What follows her as today:** the harpoon, which is seated on her near flank, and the brood trail.
- **"The deepest part" is a gate, not a key** (§7, S2). The hollow is centred on the crack. A shallow dish may be
  keyed to her station as a frozen literal, which is safe now that the station cannot move.

### 6. The throat

- **Its floor keeps today's absolute depth.** At home, zone 0's carve is shortened by the hollow's depth at
  each point, so floor ≈ today's.
  - It stays 5.8 u under the descent trigger `zoneBottom(0) − ZONE_GAP·0.55` (= −309.5) at `riftPos(0)`.
  - It stays clear of the −336 latent silt crossing (CLAUDE.md, "Far field").
  - The shaft hold, the throat lens and the ending's under-floor lens all keep the geometry they were tuned
    and probed on.
- **What follows the carve:** the strata walls (drawn-only) and the wall light.
- **Zones 1 and 2 and the remote sites are untouched.**
- **The cost is ~33 u less throat below the lip.** The alternative is §"Two calls", item 1.

### 7. Hard limits

| Limit | Bar | Today | V10b (replica) |
|---|---|---|---|
| Lowest walkable ground outside the throat (zone gates verified over −211..−285) | ≥ −285 | −257.8 | −281.8 |
| Descent-trigger margin (follows) | ≥ 24.5 u | 51.7 | 27.7 |
| Jam top above the trigger plane | ≥ 25 u | 63.9 | 31.2 |
| Hose: farthest walkable home point vs the give (375 of HOSE_START 380) | ≥ 10 u spare | 25.0 | 19.3 |
| Crack lips' height difference (the jam cap engages at 1.6) | ≤ 1.2 u | 1.17 | 0.74 |
| Berm round the crack | ≤ 5.4 u | 5.4 | 1.8 |
| Ending ascent: zone-0 dip to zone-1 clear | ≥ 150 u | 198.6 | 165.1 |

V10b was run with today's throat carve. Its throat floor therefore sits at −348.8, which is what pulls its
ending gap down to 165.1. §6 puts the floor back at −315.3.

## Acceptance gates

**Shape.** Tuned on the replica first, then confirmed on the game's own 1 u grids.

- **S1, relief.** Over the open floor: sd ≥ 12 u (today 5.55); median relief in a 50 u window ≥ 17 u (10.6);
  in a 100 u window ≥ 30 u (17).
- **S2, her lair is the deepest part.**
  - Mean ground under her body ≤ the 5th percentile of the open floor (today 73rd; V10b 3.7th).
  - The open floor's minimum lies within 40 u of her bed centre (today 84; V10b 33).
- **S3, the raft-side fall.** This is the §3 target.
- **S4, not a lathe.**
  - The hollow's flat-bottom and outer radii vary ≥ 20% peak-to-peak with bearing.
  - Along each tread line the radius from `riftPos(0)` varies ≥ 15 u.
  - The hillshade passes the eye.
- **S5, mostly walkable.**
  - ≤ 1.5% of the open floor is steeper than Sal's 52° limit (V9c/V10b 1.2%).
  - ≥ 97% of the open floor is reachable on foot from the raft column, with steps ≤ 2 u allowed.
  - Raft → trail → harpoon anchor → her bed → crack lip → skiff is reachable without a single hop.
- **S6, drawn = stood on.** Drawn mesh vs `terrainH` ≤ 0.3 u at standing points across the hollow, its risers and
  outcrops. That is the fissure lip's bar.
- **S7, her fight ground.** The §4 bars.

**Play.** In the game, from fresh loads.

- **G1, the hard limits.** Every row of §7. The hose row is checked by a real walk to the binding point.
- **G2, fissure probes.** Every `tools/bench/fissure-probe.mjs` mode passes, on bounds re-derived for the new
  ground, each with a case that fails: `clearance`, `velkath-crack`, `jam-stand`, `throat-edges`, `climb-out`,
  `fall-lens`, `rise`, `reascend`, `ending`, `wave-minors`, `floor-readers`, `opening`. Loosening a bound until it
  passes is not re-deriving it.
- **G3, the crack throat keeps its floor.** The floor is within ±1 u of today's at every throat point.
- **G4, after the calm.** `velfix-gate.mjs` (via `fullplay-gate.mjs`) passes its three post-calm routes. Its
  crack route fails on main today, so it is fixed and green on main **before** it gates this work.
- **G5, her rite.**
  - `riteplay` stays inside its shipped bands (average 45–165 s, 0–3 hits) on the standard policies and seeds.
  - Her ward heights over her ground stay at today's (~6 u).
  - `brooder-invariants.mjs` and the `harpoon-probe` wrench at her new station pass.
- **G6, placements.**
  - Nothing hovers or sinks: primfix's seating checks over debris, props, wrecks, egg skins, prints, trail
    items and plants.
  - Plant counts per type stay within ±10% of today's.
  - The skiff is outside her arena and reachable.
  - The keepsakes are reachable.
- **G7, invariants.**
  - 14 lights.
  - `__ridge.fp([1,2])` d49d451d; Pallid b1c58f8d; Burned d2b6fb68.
  - New home `__ridge.fp()` and `sleeperFingerprint(0)`, recorded.
  - `__lev.fp(0/1/2)` measured. serpent.js reads `terrainH` for its ground blobs, so if zone 0's value moves,
    the cause is named and the new anchor recorded.
  - `__safeFailed()` and `__shaderFailed()` both [].
  - Console clean except the favicon 404.
- **G8, cost and boot.**
  - Bench views `z0`, `z0r` and `z0b` are re-anchored. `z0b` is retargeted at her bed from ~30 u; its comment
    is stale today.
  - A cross-load ABBA against main on a quiet machine reports the cost.
  - `hitch.mjs` shows no new first-sight compiles.

**Look.** Michael's eye.

- **L1.** Replica hillshade map and three sections, before/after.
- **L2.** In-game stills with the post chain settled (`capture({ settle: 90 })`):
  - the raft-column landing, looking toward the crack;
  - an upland ridge, looking back over the hollow;
  - her bed;
  - the skiff on its new ground;
  - the lip, looking down into the open throat (before/after).
- **L3.** Exposure stays inside its depth clamp. Velhard's ward-glare check holds at the new depth: the light-up
  flash is ≤ 50% of the frame.
- **L4.** A new full take, raft → rift → zone 1, as an MP4.

## Process

1. **Move the replica into the repo** (`tools/relief/`): the verbatim slice of `heightAt`, `findSite` and
   `velkathLair`; `validate.mjs`; and the stats, levers and hillshade renderer. It slices `terrain.js` at run
   time, so it cannot drift from the game.
2. **Fix the `velfix-gate` crack-route flake on main.**
3. **Tune to S1–S7 on the replica**, where a variant takes seconds, not a game run.
4. **Port to the game**: the home `shape` / `wrecks` rows, the hollow term, the relative apron, the throat carve.
   Then run G1–G8, record the fingerprints, and produce L1–L4.

## Out of scope

- **Breaking up the ring wall** with rim spurs and benches (the audit's lever C). The uplands soften the
  floor-to-wall contrast. If the "pit" read survives this pass, that is the next lever.
- The remote anchorages, and zones 1 and 2.
- Retuning the silt layer (`NEPH_YF`) or the exposure clamps. The darker hollow is judged first (§"Two calls").
- Camera changes. The claw wind-up look-up is separate work.
