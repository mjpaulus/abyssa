---
title: Vents + corals polish — chimneys, staghorn, brain, table coral, prop rocks
status: done
tags: quality, vents, flora, props, textures
updated: 2026-09-25
---
Michael after the quality audit: "lots of things just look like primitives no polish. AAA is the bar and we are far from it." The world pass left three primitives: flora staghorn and brain coral (4-sided sticks, a lumpy sphere), the zone-1 black smokers (lathed lumps with a flat crust), and the downloaded 16-tri Kenney rock in props.js (the audit's "dark hexagon", and a generated-only rule violation).

## Detail
Branch `polish-vents` (not merged). Files: src/world/props.js, src/world/flora.js (coral builders + their shader blocks only), src/world/vents.js, and a marked block appended to the end of src/lib/textures.js (`coralMazeSet`, `sulphideSet`).

**Props.** The `rock_smallC.glb` MANIFEST row is cut. Flora's pebble and boulder tiers fill the role. `propColliders` was empty and stays empty. The shorter props stream re-rolls log and barrel placement, which is still a pure function of `siteParams('props')`. Downloaded models still in props.js: `log.glb` and `barrel.glb` (Kenney CC0). Those two are Michael's open props-glTF decision. `rock_largeC.glb`, `rock_tallE.glb`, `rock_smallC.glb` and `stump_old.glb` are still on disk and in CREDITS.md, but nothing references them now.

**Corals.**
- Staghorn: grown as recursive, knobbled, tapered tubes on an encrusting base plate: four antler primaries, forking secondaries and some tertiaries, with rounded bleached tips (per-vertex tip mask in aBU.x). Corallite cups are a fragment normal feature (an F2-F1 cell field) and fade out before they can alias.
- Brain coral: a generated Turing labyrinth (activator/inhibitor iteration on a torus, 256^2) wrapped over the dome with an azimuthal-equidistant map about its pole, so there is no seam and no UVs are needed. Normal and albedo, a dark valley-floor line and a pale crest furrow.
- New table coral: a stalk, a lobed dish and a pale growing rim, with radial branch rows and growth bands. It shares the staghorn material and program.
- Hues are muted per instance: ochre, rose, bone, olive, mauve and sand, leaning 20% toward the zone mood.
- Stream contract: the new builders burn exactly the draws the old ones spent (36 and 1), and every placement slot makes its old draws. `rockColliders` stays bit-identical (597:88033c49). Staghorn now uses every 4th reef slot and table coral every 8th: fewer colonies, far better ones.

**Vent chimneys.**
- Each stem is ONE continuous knobbled tube along the shipped spine. The site-stream draws and the spine arithmetic are replayed exactly, so throats, colliders, marine-snow columns, plumes, shimmer and ventlife anchors are identical to main (signature e72f7950, plume hash equal).
- Structure: shelf flanges with drooping undersides (dense rings round each), lobed nodular walls, and a flared foot. The throat is fluted and its lip turns in and drops into a bore. Active bores carry a dim ember emissive (vertex heat, not a light). Dead stacks have jagged snapped tops.
- Around each stack: secondary beehive spires, a talus apron draped on the seabed, and fallen rubble (snapped sections plus lumpy crust blocks, strewn mostly down one fall side). Fumaroles are now little beehives and crust patches are draped plates.
- All new detail comes from a local per-chimney mulberry32.
- Zoning (baked vertex colour + aVent): a sooty grey-black body with iron-oxide drip streaks and rust patches only where the wall has cooled, faint growth rings and anhydrite flecks, blackening with heat toward the throat. Bacterial mats sit on lee faces and flange undersides. Dead stacks rust through.
- Material: generated sulphide crust set (crystal grain, pores, cooling cracks), triplanar at two scales. Mats swallow the relief. Brassy near-mirror glitter facets near the throat are sparse, from map A, and fade with range.
- Still ONE merged draw. No light added: the shared PointLight and the fog:false ember rules are untouched.

**Water-line props:** props.js has nothing that floats (only seabed logs and barrels), and no buoy or floats exist anywhere in src. The raft's mooring chain (hull.js) is already weathered by the raft pass. Nothing to do here.

## Log
2026-09-25: Built and verified on branch polish-vents. Commits: abbcdcc (props), ffa2884 (corals), 125290d (vents). Numbers against main 026203f, same probe sequence in fresh tabs:
- Coral tris: 190.1k → 254.2k (+64.1k), counting all three zones' instance buffers. Per colony: staghorn 160 → 798 (55 per zone, was 220), brain 256 → 270 (110 per zone), table 398 (28 per zone, new).
- Vent field: 9,444 → 40,858 tris (+31.4k).
- Draw calls: zone-0 reef view 134 → 134 (table +1 per zone, prop rock −1). Zone-1 vent view 80 → 77.
- Programs: +1 program source (`vents|chimney`; the chimney no longer shares the stock standard program), compiled in about 3 light-state variants like every lit material. The table coral shares `flora|stag`, so +0. Totals are 283 vs 285 after one full visit.
- Textures: +2 (maze pack/nrm and sulphide pack/nrm added; surfacePair's pair is no longer bound by vents).
- Bakes: coralMazeSet 42 ms and sulphideSet 12 ms at boot. Vent build 21 ms vs 3 ms, flora reseed about 37 ms vs 53 ms (fewer staghorn instances). Total added under 80 ms.
- Reseed soak: boot plus 6× `__chart.arrive` (1,2,0,1,2,0), visiting every zone each time. Textures flat at 160 after the first cycle. Programs stay flat once warm (435 → 433 → 428 → 429; main does the same, 392 → 405 → 403 → 403). Geometry is per-site stable within the same ±10 main shows. Site 0 returns to identical rock-collider and vent signatures.
- Fingerprints: `__lev.fp` = 15ce888c / c938fe6e / 652d0412. terrain.js is untouched. Console clean on a fresh tab.

Captures are in the session scratchpad, pv/caps/:
- Corals: final_stag_2u.jpg, final_stag_5u.jpg, final_brain_2u.jpg, final_table_4u.jpg.
- Vents: final_chimney_6u_lantern.jpg (throat, ember, shrimp swarm), final_chimney_6u_flank.jpg (Sal's lantern on the flank), final_rubble_apron_3u.jpg.
- Seabed: final_z0_seabed_rocks_gone.jpg.
- Before shots: 00_base_z0_proprock.jpg, 00_base_stag.jpg, 00_base_brain.jpg, 00_base_chimney_6u.jpg.
- Form under an evaluation-only white light, never shipped: evallight_chimney_full.jpg, evallight_throat_close.jpg, evallight_dead_chimney.jpg. These predate the final albedo and mat retune.

Open items and taste calls:
- Zone 1 is lightless by design, so in play the chimneys read mostly as silhouettes with the ember throat. Their crust only shows within the lantern's few metres. The sulphide albedos were raised to about 0.02–0.1 linear so the lantern finds them at all.
- The dark plume is invisible against the dark water in every capture. Plumes were out of scope.
- Rubble crust blocks are still slightly faceted at 3 u (icosahedron detail 1).
- Staghorn corallites read as a rasp at 2 u but can look scaly on the brightest lit faces.
- The table coral's upper face is subtle beyond about 6 u.

Awaiting Michael's eye.
