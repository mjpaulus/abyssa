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

**Amended 2026-10-13, after offline trials and before the plan** (Michael approved the first draft: "floor card looks
good"). The trials ran the full design on the replica and showed three things the first draft got wrong:
- **The uplands are an additive term,** not overrides of the shipped landform knobs (§2).
- **The hollow runs on under the north-east wall:** a third call for Michael (call 3 below; §3).
- **S6 and G3 are restated** as they were measured.

All the measured values below come from that run, variant Q0 in `levers9.mjs`.

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
- **Three calls made for you.** Say if you want any of them the other way.
  1. **The crack's throat keeps its present floor depth.** Since the lip is now ~33 u lower, the throat is
     ~40 u deep below its lip instead of ~73 u. The zone change then still fires just above the throat floor,
     as now. Keeping today's depth below the lip instead would put the zone change halfway down the throat, and
     the throat's bottom would sit in a band of open water that turns murky (a known latent fault). You'll get
     a before/after view into the open throat from its lip to judge it.
  2. **The hollow reads darker and somewhat murkier than the shelf.** At the bottom the silt layer is at full
     density (today's floor gets ~88% of it) and the ambient light is ~0.82× today's; auto-exposure makes up part of it. *I told you
     earlier the hollow would not be murkier. That was wrong.* It suits a lair; you judge it on the stills.
  3. **Behind her crack, the basin wall stands taller** (added 2026-10-13, after the offline trials). On the
     north-east her crack sits only ~55 u from the foot of the basin wall. Ending the hollow before the wall put a
     steep rise right behind the crack: 5% of the floor too steep to walk. So the hollow runs on to the wall's foot,
     and that stretch of wall stands ~30 u taller over a lower floor. You'll get a still from her bed looking
     north-east to judge it.

## The design

### 1. Scope, and how home keeps its changes to itself

- **Zone 0 at home only.** Home gets its own `shape` and `wrecks` rows in `world/site.js`, as Pallid and the
  Burned Ground already have.
  - The `shape` row carries two new zone-0 sub-rows, `uplands` and `hollow`.
  - The shipped `ZP[0]` literals in `terrain.js` do not change. Changing them would leak to the remote sites,
    which inherit every knob their rows don't override: `roc` and `r3amp` to Pallid, `cnamp` to Burned, `camp`
    and every wavelength to both.
  - With home's new rows absent, the new code must reproduce today's field bit for bit (3b526986).
- **Site 0 stops being bit-identical to the shipped world.** Its comment and CLAUDE.md say so. Its new
  fingerprint becomes the regression anchor.
- **Must not move:**
  - `__ridge.fp([1,2])` d49d451d;
  - Pallid b1c58f8d and Burned d2b6fb68;
  - wreck sites for zones 1 and 2;
  - `sleeperFingerprint` for zones 1 and 2 (ac04921e, ce3eaf9d).

### 2. The uplands

- **Wake zone 0's massif machinery as an ADDITIVE term** (home's `shape.uplands`). Today `rbias −0.32` holds the
  ridge mask off over 81% of the floor.
- **How the term works.** The extra relief reuses the noise values `heightAt` already computes (the regional mask,
  the massif, secondary-ridge and outcrop ridged noise, and the continental base) with a higher mask bias of its
  own. It is multiplied by a mask that is exactly 0 off the places that matter (below), so the shipped landform
  there is untouched bit for bit.
- **Measured starting values (Q0).** These are increments on today's terms, not replacements: mask bias `−0.10`,
  massif `+24`, outcrop `+1.5`, secondary ridges `+2.0`, continental swell `+12`.
- **Why not override the shipped knobs.** The first draft overrode them (`shape.zp`, V9c's `ramp 42 … camp 50`),
  and the trials showed two problems:
  - `camp` and `s2amp` act everywhere, so on their own (H7) they moved the crack lips to 1.39 u and the throat
    floor by 1.4 u;
  - at those amplitudes 4.7% of the open floor was steeper than Sal's limit.
- **Keep the ridges off the places that matter.** The mask is exactly 0 near the crack and apron, both of her
  flank stations, the raft column, and the band between the raft and her bed. Each is a capsule with a 25–35 u
  inner and a 45–65 u outer radius.
- **Masks use frozen geometry only:** `FISSURE[0]`, `riftPos(0)`, the station points as computed from the
  fissure frame, and the origin. Never `bedAt()` or `velkathLair`. Her bed is placed after the terrain, so keying
  the terrain to it would go round in a circle.

### 3. The hollow (not a lathe)

- **What it is.** A sunk floor added in `heightAt` **after** the soft-floor knee. Before the knee, the 4:1
  compression eats a third of it and flattens the bottom. It applies to zone 0 at home only and is centred on
  `riftPos(0)`.
- **Depth.** 28–35 u at the bottom (Q0: 28, plus a 3 u dish centred on the crack).
- **What the bottom must contain:** the crack, its apron, both flank stations and her body.
- **It is not round.** Its flat-bottom radius and outer edge vary with bearing, so it is not a lathe. A round
  bowl centred on the crack would be "the big pit" again, smaller: the eye reads concentric rings at one
  distance. The project killed that look for the rim with bearing harmonics, and the hollow uses the same tool.
  - It is tight on the raft's bearing, so the raft column stays up on the flank. Q0's flat bottom reaches 74 u
    toward the raft and 86 u away from it; its outer edge reaches 150 u toward the raft and 220 u away.
  - It is wide away from the raft, out toward the NE.
  - Low harmonics make the outline wander ±15% on the side bearings: ±27% for the flat bottom, ±40% for the
    outer edge.
  - **Its outer reach fades out under the basin wall,** between 250 and 290 u from the raft. On the NE the crack
    sits only ~55 u from the wall's foot, so a fade before the wall's onset `rin` (150–172 u, run H0) put a steep
    rise right behind the crack, and 5.4% of the floor was too steep to walk. The NE wall therefore stands ~30 u
    taller over the lowered floor (call 3). The far ridge (r ≥ 300) is untouched.
- **At the crack the hollow is uniform.** Only the hollow's uniform part acts within the crack's apron: its depth
  and the crack-centred dish. Its detail is faded out toward the lip: the levelling, her flat, and the outcrops.
  The apron and the throat compensate exactly that uniform part, so the crack just drops: the lips keep today's
  1.17 u difference (Q0 1.18), and the throat floor keeps today's depth (§6).
- **The apron target becomes relative** (`18 + hollow(x, z)`). With the shipped absolute target the crack would
  stand on a ~21 u berm (V6).
- **A target, not a requirement: the raft column (mean over r ≤ 15 u) sinks ≤ 12 u**, and the floor falls
  ≥ 20 u from it to her bed. That fall is the "floor falls toward her crack" read from where Sal lands.
  - A radial hollow puts the raft column ~24 u down (V9c), which kills that read.
  - The bearing-varying V10b holds it to 6.6 u, with a 31.4 u fall to her bed. Q0 gives 11.4 u and 24.9 u.
  - If this target and the walkability bars (§4) conflict, **walkability wins**. It was his explicit pick.

### 4. Terraces, outcrops, and her ground

- **Two or three terraces.** They are broad treads built into the hollow's own profile. The global `terrace()`
  quantiser would step the whole floor, so it is not used. Q0 has three treads.
  - Each riser takes 85% of its band, so the risers are walkable slopes rather than walls.
  - Tread lines wander with bearing and break.
  - No riser is a continuous ring: each one has walkable ramps through it on several bearings. Q0 has three
    sectors where the profile stays smooth.
- **The bottom is not flat.** Outside her fight ground it gets gentle swells and a few rock outcrops, so the
  levelling is partial, not V3c's 85%. Primfix's seabed debris still lands there by its own rules.
  - Q0 levels the bottom 70%.
  - Its outcrops are soft knolls on a ~28 u scale, up to ~10 u tall. Their threshold is smoothed, because a hard
    `max(0, ·)` kink is a crease the mesh cannot draw.
- **Drawn ground = stood-on ground.** Collision reads `terrainH` exactly, but the basin mesh pitch is ~1.7–2.3 u.
  - Any riser, outcrop face or step steeper than ~35° spans at least two mesh cells, a run of ≥ ~4 u.
  - Nothing sharp lives between vertices, or Sal's boots float or sink at every riser. The fissure needed its
    own 0.5 u patch for exactly this, and this design does not add another one.
- **Her fight ground stays gentle.** The rite assumes level ground: a bank under one side once lifted her wards
  to 10–17 u. Today's NW-bed values are the bars.
  - Relief under her body (R 15.4) ≤ 3 u.
  - Relief under her bed footprint (23.9 u) ≤ 6.5 u.
  - Relief across her 45 u arena ≤ 11.5 u.
  - V10b gave 5 / 6.3 / 11. Q0 adds her flat and gives 1.6 / 2.2 / 9.0: the ground within 30–46 u of her station
    is levelled 92%, and it sits 4 u lower than the rest of the bottom, so her ground is the deepest.

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
  - The skiff still lands on the flattest ground in its ring. On the ring alone, though, it wandered between
    variants: (−51, 48), (−32, 171), (24, −55), (168, 34). It holds the sonar, so its spot decides where Sal picks
    that tool up.
  - The `wrecks.band` row therefore gains an optional bearing window. Home's window puts the skiff on the
    raft-side terraces, within 130 u of the raft and outside her arena. In Q0 the window is 30–75° from the
    rift-to-raft bearing, with a 100–140 u ring. The skiff lands at (115, −52): 126 u from the raft and 95 u
    from her lip, on the upper flank (−248.5).
  - The result is sensitive to the window: 25–70° put it 63 u from the raft. So the window is a tuned knob, and
    a gate checks the outcome.
  - The skiff's final position is recorded, and Michael sees it in the stills.
  - Zones 1 and 2 keep their shipped bands.
- **What follows her as today:** the harpoon, which is seated on her near flank, and the brood trail.
- **"The deepest part" is a gate, not a key** (§7, S2). The hollow is centred on the crack. Her flat (§4) is keyed
  to her station as a frozen literal, (89.7, 39.1), which is safe now that the station cannot move. A gate checks
  that `velkathLair` still puts her there.

### 6. The throat

- **Its floor keeps today's absolute depth.** At home, zone 0's carve is shortened by the hollow's uniform part
  (depth plus dish), weighted by how far down the throat wall the point lies (full from 60% of the wall's depth
  down). Q0: the floor at `riftPos(0)` is −315.3, exactly today's.
  - The upper walls drop with the lip, so the throat's walls are compressed rather than cut off.
  - It stays 5.8 u under the descent trigger `zoneBottom(0) − ZONE_GAP·0.55` (= −309.5) at `riftPos(0)`.
  - It stays clear of the −336 latent silt crossing (CLAUDE.md, "Far field").
  - The shaft hold, the throat lens and the ending's under-floor lens all keep the geometry they were tuned
    and probed on.
- **What follows the carve:** the strata walls (drawn-only) and the wall light.
- **Zones 1 and 2 and the remote sites are untouched.**
- **The cost is ~33 u less throat below the lip.** The alternative is §"Three calls", item 1.

### 7. Hard limits

| Limit | Bar | Today | Q0 (replica) |
|---|---|---|---|
| Lowest walkable ground outside the throat (zone gates verified over −211..−285) | ≥ −285 | −257.8 | −280.1 |
| Descent-trigger margin (follows) | ≥ 24.5 u | 51.7 | 29.4 |
| Jam top above the trigger plane | ≥ 25 u | 63.9 | 33.2 |
| Hose: farthest walkable home point vs the give (375 of HOSE_START 380) | ≥ 10 u spare | 25.0 | 19.8 |
| Crack lips' height difference (the jam cap engages at 1.6) | ≤ 1.2 u | 1.17 | 1.18 |
| Berm round the crack | ≤ 5.4 u | 5.4 | 0.9 |
| Ending ascent: zone-0 dip to zone-1 clear | ≥ 150 u | 198.6 | 198.6 |
| Cost: `heightAt` at home zone 0 (node micro-bench, ns per call) | ≤ 1.5× today's | measured first | measured in the port |

## Acceptance gates

**Shape.** Tuned on the replica first, then confirmed on the game's own 1 u grids.

- **S1, relief.** Over the open floor: sd ≥ 12 u (today 5.55); median relief in a 50 u window ≥ 17 u (10.6);
  in a 100 u window ≥ 30 u (17).
- **S2, her lair is the deepest part.**
  - Mean ground under her body ≤ the 5th percentile of the open floor (today 73rd; Q0 1.2nd).
  - The open floor's minimum lies within 40 u of her bed centre (today 84; Q0 29.6).
  - `velkathLair` puts her at her raft-side station, (89.7, 39.1) ± 0.5.
- **S3, the raft-side fall.** This is the §3 target (Q0: sinks 11.4 u, falls 24.9 u).
- **S4, not a lathe.**
  - The hollow's flat-bottom and outer radii vary ≥ 20% peak-to-peak with bearing.
  - Along each tread line the radius from `riftPos(0)` varies ≥ 15 u.
  - The hillshade passes the eye.
- **S5, mostly walkable.**
  - ≤ 1.5% of the open floor is steeper than Sal's 52° limit (Q0 0.7%).
  - ≥ 97% of the open floor is reachable on foot from the raft column, with steps ≤ 2 u allowed.
  - Raft → trail → harpoon anchor → her bed → crack lip → skiff is reachable without a single hop.
- **S6, drawn = stood on, as the change adds it.** The test runs over the hollow's footprint, outside the fissure
  patch (fd ≥ 17), on a 0.5 u grid. At each point it compares the drawn mesh's error against `terrainH` with
  today's error at the same point; the added error must stay ≤ 0.3 u.
  - Today's floor already reaches 1.9 u of error at (134.5, 209.9), a canyon crease near the rim, and 1.13 u at
    p99 in zone 1. An absolute bar would fail on the shipped world.
  - Q0 adds 0.296 u at most (p99 0.127). The margin is thin, so the port re-measures it and tunes for headroom
    (≤ 0.25 u).
- **S7, her fight ground.** The §4 bars.

**Play.** In the game, from fresh loads.

- **G1, the hard limits.** Every row of §7. The hose row is checked by a real walk to the binding point.
- **G2, fissure probes.** Every `tools/bench/fissure-probe.mjs` mode passes, on bounds re-derived for the new
  ground, each with a case that fails: `clearance`, `velkath-crack`, `jam-stand`, `throat-edges`, `climb-out`,
  `fall-lens`, `rise`, `reascend`, `ending`, `wave-minors`, `floor-readers`, `opening`. Loosening a bound until it
  passes is not re-deriving it.
- **G3, the crack throat keeps its floor.** Along the crack's centre line, wherever today's floor lies below the
  descent trigger (−309.5), the new floor is within ±1 u of today's (Q0: 0). Nearer the lip the walls drop with
  it by design (§6).
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
  - `heightAt` costs ≤ 1.5× today's ns per call at home zone 0 (§7), and `fillTerrain` wall time is reported.

**Look.** Michael's eye.

- **L1.** Replica hillshade map and three sections, before/after.
- **L2.** In-game stills with the post chain settled (`capture({ settle: 90 })`):
  - the raft-column landing, looking toward the crack;
  - her bed, looking north-east at the taller wall (call 3);
  - an upland ridge, looking back over the hollow;
  - her bed;
  - the skiff on its new ground;
  - the lip, looking down into the open throat (before/after).
- **L3.** Exposure stays inside its depth clamp. Velhard's ward-glare check holds at the new depth: the light-up
  flash is ≤ 50% of the frame.
- **L4.** A new full take, raft → rift → zone 1, as an MP4.

## Process

1. **Move the replica into the repo** (`tools/relief/`): the verbatim slice of `heightAt`, `findSite` and
   `velkathLair`; `validate.mjs`; and the stats, gates and hillshade renderer.
   - It slices `terrain.js` at run time by markers, not line numbers, so it cannot drift from the game.
   - It gates on the real code once the code is ported. The hooks were for exploration only.
2. **Fix the `velfix-gate` crack-route flake on main.**
3. **Port to the game**, starting from Q0's values.
   - The changes: the home `shape` / `wrecks` rows, the additive uplands, the hollow term, the relative apron and
     the throat carve.
   - First test: with home's rows absent, the sliced code reproduces 3b526986.
   - Then re-tune S1–S7 on the sliced real code (the port drifts from the hooks, for example in how `fd` is
     known outside `apronR2`).
4. **Then run G1–G8, record the fingerprints, and produce L1–L4.**

## Out of scope

- **Breaking up the ring wall** with rim spurs and benches (the audit's lever C). The uplands soften the
  floor-to-wall contrast. If the "pit" read survives this pass, that is the next lever.
- The remote anchorages, and zones 1 and 2.
- Retuning the silt layer (`NEPH_YF`) or the exposure clamps. The darker hollow is judged first (§"Three calls").
- Camera changes. The claw wind-up look-up is separate work.
