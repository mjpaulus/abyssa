---
title: Polish Orune and Mhor (AAA materials and geometry)
status: wip
tags: quality
updated: 2026-09-25
---
Michael, after the quality audit: "lots of things just look like primitives no polish. AAA is the bar and we are far from it." The audit found ORUNE a silhouette at 22 u (smooth sac, flat mottle, flat-disc suckers, clean tube arms, plain eyes, 5-primitive lanterns) and MHOR a faint orange blob at 74 u and a smooth hex-sectioned torpedo at 26 u (tube arms, sphere clubs, plain fins and eyes). The bar is Subnautica's leviathans and real cephalopod photography. Only geometry, materials and per-frame vertex placement changed. Behaviour, rites, timings, ward placement, collision (L.spine / L.collR), the dormant/wake contract and arm counts are untouched. Branch polish-sleepers2, not merged.

## Detail
Files: src/entities/sleeper/hoarder.js, hoarderGeo.js, hoard.js, hunter.js. common.js, brooder*, game.js and lib/textures.js are unchanged.
- BAKE KIT (hoarderGeo.js, exported for hunter.js): tileable fbm tables, a jittered-grid voronoi that tiles, and own-cell point features. Heights stay float until the normal is taken, and textures are mipmapped DataTextures (the Brooder idiom).
- ORUNE SKIN (1024², ~6 mm/texel): a 96x96 chromatophore field of small pigment sacs in brown-black, rust and ochre, expanded by the mottle and a coarse reticulate net. It adds polygonal relief grooves, papillae with paler tips, wrinkles in the dark patches, lensed photophores (a clear dome, a dark rim, a bright core and a halo in the emissive map) and iridophore flecks packed into roughness R. wetSkin() is one program that adds a lit Fresnel sheen and a teal-to-violet iridophore term, which shows only at grazing angles and scales with the light received. The skin is BIPLANAR by attribute: the mantle carries a second spherical UV about X plus a weight that hands the two Y-pole caps to it, which kills the sphere pinch. Arms and lids set that weight to 0, so the whole body stays one program.
- ORUNE MANTLE: 128x96. 260 seeded warts are real bumps displaced along the normal. Slack creases (sharp valleys, soft ridges) turn round the sac, which sags along its spine. Wrinkles ring the eye turrets. A lipped SIPHON with a dark mouth sits under the left eye, merged into the mantle geometry.
- ORUNE ARMS: the 41-point logic spine (pts/U/B, read by lash, grab, the knife, wards and the flinch) is unchanged. The RENDER tube is 129 rings x 28 sides, Catmull-Rom'd off that spine, with frames lerped from the rolled logic frames. The cross-section has a softly flattened oral face with a central furrow, a dorsal ridge, and longitudinal folds. Transverse wrinkles bunch only on the inside of each bend, with depth = curvature x radius. Normals come from the grid. Zero allocation, 0.58 ms per updateHoarder (200-call bench).
- ORUNE SUCKERS: stalked cups (stalk, outer wall, a pale rolled rim, a pink infundibulum, a dark acetabulum), 36 per arm in two staggered rows, spaced by the local radius so they crowd and shrink toward the tip. They are seated on the render tube's face, and any sucker whose seat is inside the mantle is hidden.
- ORUNE EYES: the ball has a cornea dome and a planar-mapped gold iris (radial fibrils, a collarette, a limbal ring, the octopus bar pupil) with a wetEye Fresnel rim. The lathed lids have folds parallel to the edge and a fleshy rolled lip, and the lathe seam is at the back.
- THE HOARD: each lantern is built from a stepped foot, four chamfered posts, guard hoops, a hinged door frame (knuckles and a latch), a burner and wick, a vented cap with a chimney and a bail, and a bellied glass chimney. Brass carries patina (verdigris low, tarnish) in vertex colour. On the glass, grime dims its own glow (grimeGlow) and the flame is its core. The 17 lanterns are 2 instanced draws where they were 34 meshes. The crate is planked on every face with gaps, battens, iron angle corners and nail heads over a generated wood map, all in 1 draw. The ship's lamp is the hero piece: a riveted drum, a stacked-prism Fresnel lens band, stays, a crown and cowl, vents, a bail, a gimbal yoke and a porthole door. It is a 1-instance InstancedMesh so it shares the lanterns' programs. lampPos is numerically unchanged.
- MHOR BODY: a 160x72 lathe (round at any range) with eye-orbit rims. The hide is baked at 1024² on an anisotropic grid so cells come out square on the body. It has chromatophore sacs, relief grooves, a LATERAL LINE with its pores, and LENSED photophores in two staggered rows down each flank plus a ventral scatter (core, halo, dome, dark rim). wetSkin has no iridophores here.
- MHOR GLOW: 24 fog-off additive POINTS in the body frame (two rows per flank plus the belly), with an over-unity colour, driven from the existing pulse. They follow their own distance curve that swells with range and is gone past 200 u. This is 1 draw and 2 float writes per frame, with no lights.
- MHOR FINS: a membrane grid over the old outline. A vein map has radiating ribs that sweep back and taper, finer branches past mid-fin, a darker muscular root and a paler edge. The membrane() shader scatters received light through the thin outer fin and passes the photophore pulse through the edge. DoubleSide with forceSinglePass. The existing edge ripple is kept.
- MHOR ARMS AND CLUBS: tubes are 57 rings x 20 sides, and each frame is aimed so the oral face looks in at the crown's axis. That face is flattened and pale. 28 suckers per arm sit in two rows (instanced, 1 draw). The clubs are spindles with a ring of ten curved horn HOOKS and a palm of 14 suckers.
- MHOR EYES: huge wet domes with a black pupil, a thin gold ring and a silvered iris. They face sideways, and the eyeshine emissive is masked to the pupil and ring. The existing driver is kept.
- THE FURNACE: a 44x43 lathe with nodular lumps and three flanges. It uses vents.js's palette in vertex colour (olive low, sulfide dark, rust streaks, pale crust near the throat) and has a recessed bore. A crust normal map is shared with the cold stumps. The fire is an emissive MASK (the throat, plus cracks webbed through the top third) where it used to light the whole chimney. A heat-shimmer sprite above the throat scrolls rising streaks.

## Log
2026-09-25: Built and verified on branch polish-sleepers2 (commits 10a3cfc, a1d5cb9, 16e1337). Numbers are from a fresh tab, 1600x900 viewport (2400x1350 buffer), hidden pane, driven frames. Base is the branch point 72c5caa, served from its own worktree and measured the same way.

**Triangles.** Orune (with the hoard) went 59,228 → 228,188 (budget 240k). Mhor (with the furnace, stunned, all visible) went 17,266 → 144,446 (budget 200k).

**Draw objects.** Orune went from 69 meshes to 37, because the lanterns went from 34 meshes to 2 instanced draws. Measured calls per 2 frames with her in view: 1068 base vs 743 now, so about −160 calls per frame counting every pass. Mhor went from 43 meshes + 4 sprites to 44 meshes + 1 points + 5 sprites (+3).

**Programs.** Scene totals in zone 1 went 317 → 321. Programs exclusive to the sleeper: Orune 11 → 15, Mhor 7 → 11. Most variants are doubled across the shadow-on/off switch, which is not ours.

**Lights.** None added.

**Bakes.** Orune skin 203 ms, eye 37 ms and wood 7 ms replace the old canvas skin (247 ms) and eye (5 ms). Mhor's hide, fin and eye together take 196 ms, replacing the old hide (271 ms). Net added bake time is about −70 ms, i.e. faster than before.

**GPU median** (__gpu.median, with the sleeper in view vs hidden, noisy on this shared machine): Orune 8.26 vs 7.42 ms (base 9.60 vs 9.55); Mhor 13.81 vs 13.90 ms (base 13.38 vs 12.82).

**Regression checks.**
- Fingerprints [__lev.fp(0),(1),(2)] = 15ce888c, c938fe6e, 652d0412.
- Orune rite: the prompt reads "[E] TAKE THE SHIP'S LAMP". lev.hoard.interact takes the lamp and she wakes (dormant false, rise 1 at 6 s, lamp parts hidden, hoard lights going out 17 → 5).
- Mhor rite: the real [E] feed with 2 bitumen lights the furnace. He arrives and reaches circle, lev.cmd('stun') gives stunned, and standing on a ward lights it (wards 0 and 4 lit).
- Memory is flat across 6 swaps each: hoarder 223 geometries / 131 textures / 309 programs; hunter 210 / 131 / 304.
- Console clean in a fresh tab.

**Captures** are in scratchpad/sleepers2/caps/. In-game: f1_asleep.png (Orune asleep at the wreck by lantern, 20 u), f1_awake.png (awake, 25 u), f1_arm.png / f1_armside.png (arm and suckers at 4 u), f1_eye_a.png (eye at 3 u), f1_lamp.png (ship's lamp at 2.6 u), final2_circle60.png (Mhor circling at ~60 u, the photophore rows read), final2_stun.png (stunned, 20 u), final2_fin.png (fin at 6 u), final2_eye.png (eye at 4 u), f2_throat.png / f2_furnace.png. Studio look-dev set: s5w_*.png and m3_s*.png. Before: base1_*.png and base2_*.png.

**Not verified.**
- The real-window frame rate, because the pane was hidden throughout.
- Per-frame heap allocation was checked by code inspection only (the new paths allocate nothing; the pre-existing ev object and the .filter in the ward loop were left alone as behaviour).
- The studio renders before 2026-09-25 late (s2 and s3) were drawn to a canvas with no depth buffer, so their lids and eye overlaps are artefacts; the studio now renders into a depth render target.

**Open.**
- Orune's raised arms arch up through her face, so from the front the eyes sit in a well of arm roots. That is the arm pose, which is behaviour.
- Mhor at 60 u is still a body-less row of lights in the murk, which is by design (brightness cannot buy distance).
- The in-game shots are dark by the zone's design; the studio set is where the materials can be judged.
