---
title: World polish — wrecks, rocks, gardens
status: wip
tags: quality, wrecks, flora, gardens, textures
updated: 2026-09-25
---
Michael after the quality audit: "lots of things just look like primitives no polish. AAA is the bar and we are far from it." Zone-0 seabed audit: the skiff a flat dark slab under a floating net lattice, a boulder an untextured dark hexagon, kelp single-colour flat cards, anemones/sponges flat-shaded.

## Detail
Branch `polish-world` (not merged). Files: src/world/wrecks.js, src/world/flora.js, src/world/gardens.js, and an appended, marked block at the end of src/lib/textures.js.

**Wrecks.** New generated iron plate set, `ironPlateSet()`: 512² riveted plating with lap seams, staggered butts, rivet rows, dents, rust bloom, and a rust SOURCE alpha. Rust streaks run down the hull along real world gravity: a derivative cotangent frame finds "down" in the map's uv after the wreck's roll and settle tilt, then textureGrad gathers the source mask up-slope in six taps. A growth mask covers up-facing surfaces, plus a per-vertex old-waterline band (aGrow). Barnacle shells are scattered by the same terms, merged into one draw per wreck from their own stream. Skiff: a stove-in plank run on the up-facing bilge (a staircase of broken plank ends with splinter fans), clinker nails down every lap, per-plank tone and lap cavity. Net: diamond mesh with knots, lead sinkers, and a tear with frayed bars. Trawler: torn plates peel as curled petals. Portholes: grimy panes (on the lit one the grime dims the emission), glass domes, and a lit spill cone plus halo. Submersible: Yoshimura crush creases. A drift skirt around every hull is banked on the lee and drawn with the TERRAIN's own material, using the terrain mesh's exact height and colour (it IS seabed: same program, caustics and ripples). Wreck program keys are now per kind, not per zone. Colliders, relic, keepsake and mark positions are identical to main.

**Rocks.** The audited "dark hexagon" is not a flora rock. It is props.js `rock_smallC.glb`, a downloaded Kenney CC0 prop: 16 tris, flatShading, no maps, 110 per zone. Fixing it needs props.js (not this branch). The recommendation is to drop that manifest row, since flora's pebble tier covers the role. This row sits inside Michael's open "props glTF" decision. Flora rocks gained a fresh-break albedo on cleavage faces (vertex colour, no stream draws), matte coralline/lichen crust on up-faces (geometric slope × bake height), fissure moss in zone 0 only, and sand fillets for hero rocks and boulders with S ≥ 4 (one merged terrain-material mesh per zone).

**Gardens.** A thin-blade material serves kelp, flora/gardens seagrass, fans and sea-pen pinnae, with one program per plant type. It uses the generated `bladeMapSet()` (midrib + herringbone veins + bullate lamina) as a derivative-frame normal, with a paler/yellower rib and tip, a per-blade hue on the blade's phase, and a ruffled/tattered margin (discard). A vertex edge ripple runs on a per-blade phase. The back-light transmission term is injected after the light loop and rides the key light (no new light). Kelp gets curled, twisted tips and a two-hapteron holdfast. Anemones get a tube-tentacle crown and an oral lip/mouth. Sponges get cellular pores and pale osculum rims. Sea pens get pinnule combs. The flora placement stream is untouched: rock colliders are bit-identical.

## Log
2026-09-25: Built and verified on branch polish-world (5b53978 wrecks; second commit rocks+gardens). Numbers vs main f7a1c9c, same probe sequence:
- Wreck geometry: skiff 15.4k→51.8k tris (+36.4k), trawler 12.0k→47.8k (+35.8k), sub 10.2k→23.4k (+13.2k).
- Plants: +106k scene-wide, counting every zone's instance buffers (kelp +48.3k, flora anemone +44.5k, gardens anemone +13.2k). Rock fillets: 24.2k.
- Draw calls in view: +5 skiff, +5 trawler, +5..8 sub. Structural additions: shells + skirt per wreck, spill + halo on the lit portholes, 1 fillet mesh per zone.
- Programs: at or below main (wreck keys per kind saved 8+).
- Boot bake: ~+90 ms (iron plate set 67 ms, blade set 4 ms, wreck geometry +22 ms). Flora/gardens reseed unchanged (41 ms / 3 ms).
- Reseed soak: 6× __chart.arrive(1,2,0,1,2,0) with every zone visited each time. Programs 245 flat, textures 116 flat, geometries 176/180 by site.
- Fingerprints: __lev.fp = 15ce888c / c938fe6e / 652d0412; wreck/relic/keepsake/mark/rock-collider contracts identical. terrain.js untouched (paired terrain probe equal to main). Console clean on a fresh tab.

Captures in the session scratchpad, wa/caps/: final_skiff_8u_a.jpg, final_skiff_hole.jpg, final_skiff_net.jpg, final_trawler_lantern.jpg, final_trawler_porthole.jpg, final_hero_rock_3u.jpg, final_kelp_backlit_6u.jpg, final_anemone_flora_2u.jpg, final_anemone_gardens_2u.jpg. Before shots: 00_skiff_before.jpg, 03_proprock_before.jpg.

Open items and taste calls:
- The skiff still reads low-contrast in the teal murk at 8 u.
- Plate rust can read as camo at range.
- Flora staghorn and brain coral are still primitive: not in this brief, and the next obvious pass.

Awaiting Michael's eye.
