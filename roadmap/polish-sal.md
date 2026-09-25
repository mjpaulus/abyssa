---
title: Polish Sal — AAA dress, hardware, helmet
status: wip
tags: quality, diver
updated: 2026-09-25
---
Michael's audit: "lots of things just look like primitives no polish. AAA is the bar." Sal read as a smooth balloon.
This pass turns him into a photographed Mark V rig, with every asset still generated in code.

## Detail
Files: `src/entities/diver.js`. `src/lib/textures.js` gets a new block at the END (`twillSet`, `castSet`, `dropletSet`, `braidSet`).
- **Dress shader** (`suitify`, one program): generated 2/1 twill sampled triplanar in bone space (the same thread pitch on every part); baked `salAux` per vertex = wear (knees, elbows, seat, shoulders), taped seams with stitch rows, reinforcing patches; `uSalWet` soaks him under water and he dries top-down on deck over about 75 s.
- **Metal shader** (`metalize`, one program for copper, brass, steel and lead): triplanar maps; baked `salCav` crevice tarnish and verdigris; screen-space concave tarnish and convex edge polish; spun rings on the bonnet.
- **Hardware**: brass corselet (skirt, 4 brails, 12 chamfered wing nuts), a cast-lead front weight on brass hooks with a webbing strap, a belt with frame buckle, prong, keeper and back lacing, and boots with brass toe caps, a lead sole cast to the foot outline at SOLE_Y, a welt with nails, and instep and ankle straps.
- **Helmet**: transparent Fresnel port glass with beads while in air, a dark recess in the same draw, seated bezels with hex bolts, an exhaust valve with a knurled cap and spitcock, a gooseneck air inlet with couplings, and 12 neck-ring bolts.
- **Hose and lantern**: braided feed hose that gets wet, with brass ferrules. The lantern has posts and guard wires, a vented crown, fount and wick, and a blown globe (flame, core and halo unchanged).
- Acceptance: macro captures at 1 u, the 9 u game view on deck and in zones 0 and 2, gait/breath/knife bit-identical, Sal ≤ 70k tris, draw calls not above baseline, zero per-frame allocation.

## Log
- 2026-09-25 — started on branch `polish-sal`. Baseline: 87 meshes, 47,954 tris, 9 diver programs.
- 2026-09-25 — step 1 dress shader (f8b90d1), step 2 hardware (df85f1b), step 3 helmet (a5f2615), step 4 hose and lantern (494a459). Result: **78 meshes (−9 draw calls), 65,156 tris, 12 diver programs (+3: suit, metal, hose; the glass program is replaced)**, 241 programs total (base 234). Generated textures: twill 9.8 ms, cast 8.7, droplets 1.8, braid 4.9 (25 ms). Diver module evaluation measures faster than base (~100 ms vs ~680 ms), because the metals no longer build 512² canvas sets for steel/port. Only uniform writes per frame (uSalWet, uSalRootY, uSalDrop).
- 2026-09-25 — motion unchanged: a deterministic 2400-frame harness (idle, walk, slash at frame 1000, swim, ladder) hashes 14 joints and gives identical segment hashes on base and branch (idle f1832004, walk 652a3446, slash 25560f80, swim 7c3d4012, ladder 509d6ce5; 35 steps, 10 breaths, breathPhase 3.708314). Sleeper fingerprints unchanged (15ce888c / c938fe6e / 652d0412). Console clean.
- 2026-09-25 — captures in `/private/tmp/claude-501/-Users-michaelpaulus-sc/1337e504-cb3f-480c-af71-61059fe1df61/scratchpad/caps`: baseline b0_*, then s1*/s2*/s3*/s4*, finals f_game9u_deck_noon, f_helmet1u, f_chest1u, f_game9u_z0, f_z0_3u, f_z0_boots1u, f_game9u_z2, f_z2_3u.
- Open for Michael's eye: the blue underlayer still shows as flat panels between corselet and belt; the arm gathers and white trim bands still read as primitives at 3 u; the tether (tether.js, not mine) is still the old corrugated look beside the braided feed hose; no back weight (the backpack takes that space); no dangling strap spring.
