---
title: Props polish — resource nodes, the Brooder's nest, the umbilical, generated log + barrel
status: wip
tags: quality, props, resources, brooder, tether, textures
updated: 2026-09-26
---
Michael: "lots of things just look like primitives no polish. AAA is the bar." After the seven polish passes the zone-0 after-shots still had primitives beside a now-AAA Sal: stacked-sphere polymer nodules and half-sphere bitumen pools, 14 raw dodecahedron nest stones in flat sand, smooth eggs, a flat corrugated tether that clashed with Sal's braided feed hose at his inlet, and two downloaded Kenney glTFs (log, barrel) in props.js, which broke the generated-only rule.

## Detail
Branch `polish-props` (not merged). Files: src/world/resources.js, src/world/props.js, src/entities/sleeper/brood.js (geometry and materials only), src/systems/tether.js (mesh material and a fitting only), assets/props/, and a marked block appended to the end of src/lib/textures.js (`eggSkinSet`, `barkSet`, `staveSet`).

**Resource nodes.** Each node's form is built from exactly the draws the shipped spheres spent (polymer 16, bitumen 12, same order), so the stream, positions and phases are unchanged. Each node is one mesh plus the glow sprite (still the last child), draped on the seabed. There are two materials, each created once.
- Polymer: a smooth union (log-sum-exp) of the four shipped lobes plus 2–3 buds, solved along rays on a welded icosphere. Crevice depth goes into a vertex attribute for silt. Waxy jade flesh with patchy crazed rind, blisters, a view-depth inner glow and a translucent rim.
- Bitumen: one polar height field. A glossy near-black pool with the three shipped blobs as frozen gas blisters, a lifted crust lip, cracked crust plates with silt on their tops, and a sulphur and iron-orange bloom at the rim.

**The nest.** The rite contract is untouched: every `rnd()` draw, egg home, take/return radius and `B.*` member.
- Eggs: `eggSkinSet` has grown vessels (tapering, forking random walks) with a blurred subsurface halo over pebbled leather. It is projected triplanar in the egg's own space, because eggs are carried. The clutch's pulsing warmth shows through the skin, with the vessels as deep red shadows, plus a warm wrap of the key light. No light was added.
- Shards: a jagged broken outline with real thickness, a pale membrane inside and a bone rim.
- Stones: 14 noise-displaced, water-rounded cobbles merged into one mesh and half-buried, using `rockMapSet(0)` triplanar in flora's rock grammar (one program).
- Nest ring: the torus is now a berm drawn with the terrain's own material at the exact rendered height (the wrecks' drift-skirt idiom), so it is seabed. It is removed before `disposeSleeper` can dispose the terrain material.

**Tether.** The material samples the very `braidSet` textures diver.js binds, through its own uniforms (no second bake, and diver.js's repeat is untouched), at Sal's braid pitch. Along the hose it uses world arc length. Around it uses a view-locked azimuth, because the instance roll swims; the atan seam sits on the unseen far side. The corrugation remains as a soft normal ripple. The hose is wet under the sea and damp above the waterline.
- A lathed brass hose-tail ferrule and hex union nut sit 0.22 m down from node 0, under the davit sheave. The fitting is a child of chunk 0, so ending.js's shape-match hide takes it too. Its matrix is written in place: zero allocation.
- Unchanged: vertex count, CylinderGeometry type, 63-instance chunks, verlet, anchors, leash clamp, tautness.

**Log and barrel (generated).** The MANIFEST rows, counts, gap, slope, stand, tint and placement code are the same, and so are the stream draws: prop XZ signature 08efee94 equals main. Shapes are authored to loadProp's old normalisation contract. One program serves both ('prop|gen|0'), and per-zone materials are cached forever, so a reseed compiles nothing.
- Log: a bent, tapering, knobbled trunk. `barkSet` gives furrowed plates over sloughed bare wood, with an algal film. One end is an old weathered cut with procedural end-grain rings and checks. The other is snapped: splinter teeth round a torn crater. There is a branch stub and three swaying weed tufts.
- Barrel: 16 bulged staves (`staveSet`), a recessed head in a chime, and three rusted hoops. On the burst side two staves are stove in and snapped low, the top hoop is broken and sprung, and the inside is dark and silted.
- **Found bug:** `sink` 0.45 buried every shipped log about 1 u under the silt, because the log is only 0.24 of its height thick (measured: top of log 0 at −1.0 u). It is now 0, so the logs lie half-buried.

**assets/props cleanup.** Deleted, since no code path references them: `log.glb`, `barrel.glb`, `rock_largeC.glb`, `rock_smallC.glb`, `rock_tallE.glb`, `stump_old.glb` and `Textures/colormap.png`. CREDITS.md now records that every prop is generated. Left for the orchestrator (not this branch's files): `src/lib/assets.js` (loadProp) now has no caller; README.md line 67 still credits Kenney prop models.

## Log
2026-09-26: Built and verified on branch polish-props. Commits: dad03ce (resources), d7aa713 (nest + textures block), 3a5ede6 (tether), e65c76c (log/barrel), 702eb7b (budget pass + assets cleanup). Paired against d35ceec (the branch point, served side by side), same probes:
- Triangles: +58.7k, counting all three zones' instance buffers.
  - Props: 24.3k → 64.4k. Log 200 → 460 per instance, barrel 148 → 448.
  - Resources: 29.8k → 36.7k.
  - Nest (stones, eggs, shards, berm): 5.5k → 16.6k.
  - Ferrule: +580.
- Draw calls at fixed poses: nest view 357 → 358, bitumen view 331 → 327, barrel view 349 → 343. Structurally: +1 (ferrule), and 3 fewer per resource node in view (5 draws per node became 2).
- Programs after a full visit: 486 → 474 (−12). New sources: res|POLY, res|TAR, brood|egg, brood|stone, abyssa-tether2 (replaces abyssa-tether), prop|gen|0 (replaces five prop|z|… keys).
- Textures: 172/173 → 175/176 (+3: egg, bark and stave pairs in, the Kenney colormap and prop roughness out). Geometries: 556–590 → 378–391, per-node spheres gone.
- Bakes:
  - At boot: barkSet 25 ms, staveSet 12 ms, eggSkinSet 13 ms, prop shapes 1 ms.
  - reseedResources: +43 ms per build (45 vs 2 ms).
  - makeBrood: about +10 ms per zone-0 entry.
  - Total under 110 ms.
- Reseed soak, boot plus 6× `__chart.arrive` (1,2,0,1,2,0), every zone visited each time: programs 462 → 474 flat from the first cycle; geometries 391/386/380/378 per site, flat; textures 175/176 flat.
- Signatures (this session's FNV probe, identical to d35ceec): rock colliders 597:008c8aef, vents 17:08f511dc:9dc7dd72, resources 60:f648e791, prop XZ 08efee94. The polish-vents card's 597:88033c49 came from a different hash method; the collider data is unchanged.
- Fingerprints: `__lev.fp` = 15ce888c / c938fe6e / 652d0412.
- Rite: taking an egg with `lev.brood.interact` wakes her (dormant true → false); setting it back gives "THE CLUTCH IS WHOLE."
- Pickups: walking onto a polymer node gives polymer 1 → 2, a bitumen node gives 0 → 1.
- Console clean on a fresh tab. terrain.js, diver.js and game.js are untouched.

Captures are in the session scratchpad, pp/caps/:
- Resources: final_polymer_1p5u.jpg, final_polymer_game9u.jpg, final_bitumen_1p5u.jpg, final_bitumen_game9u.jpg.
- Nest: final_nest_3u.jpg, final_nest_egg_1u.jpg, final_nest_game9u.jpg, final_shards_2u.jpg.
- Tether: final_tether_inlet_1u.jpg, final_tether_run_9u.jpg, final_tether_game9u.jpg, final_tether_raftend_1u.jpg.
- Props: final_log_2u.jpg, final_barrel_2u.jpg (burst side), plus 35_barrel_game9u.jpg and 34_barrel_back_2u.jpg.
- Before shots: 00_base_polymer_1p5u.jpg, 00_base_bitumen_1p5u.jpg, 00_base_nest_3u.jpg, 00_base_log_2u.jpg (the log is invisible, buried), 00_base_barrel_2u.jpg, 00_base_tether_inlet_1u.jpg, 00_base_tether_game9u.jpg.

Open items and taste calls:
- The log's bark reads as longitudinal furrows at 2 u and still leans a little toward "contour lines". The weed tufts are thin and sparse.
- Under Sal's lantern the barrel's oak reads grey-teal (the zone's 'wreck' tint carries into the staves). The burst is clean-edged rather than splintered.
- The bitumen crack net is a fairly even cell pattern from straight above.
- The tether braid's roll is view-locked: correct on screen, but it will not "rotate" if the camera orbits a stationary hose (invisible at hose scale in every capture).
- The raft-end ferrule is small next to the davit sheave and mostly seen in silhouette against the sky.

Awaiting Michael's eye.
