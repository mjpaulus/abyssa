---
title: Crepuscular rays (the sky pokes through)
status: wip
tags: sky, clouds, weather, postfx, reference
updated: 2026-09-05
---
Michael's photo (2026-09-05, a road under a broken overcast): a dark, layered cloud deck with a bright hole behind it, and a FAN of pale rays spreading down and outward from the hidden sun — silver-lined cloud edges where the light leaks around them, the rays reading as light IN the air, converging on a point behind the cloud. Our sky has no atmospheric rays; the volumetric pass is underwater-only.

## Detail
What the frame is made of: (1) a sun BEHIND cloud, not visible — the rays start from a bright rift, not a disc; (2) TWO cloud layers: a dark, low, lumpy deck (values compressed, grey-blue) and a brighter, higher, torn layer catching the light; (3) silver lining — backlit cloud EDGES glow (forward-scatter transmittance thins at the edge); (4) the rays themselves: soft, wide, many, slightly warm, fading with distance from the hole, visible because the AIR is hazy (they need haze to exist — our Flow-lean haze is the medium).

BUILD (all generated, WebGL, fits our puff clusters + painted dome):
A. SKY OCCLUSION MASK: a cheap half-res pass rendering ONLY the cloud puffs + dome coverage as an occluder against the sun's screen position (we already have the sun projection for the underwater shafts). The dome's fbm coverage gives a soft mask; the puff billboards a hard one.
B. RADIAL SHAFTS (Sousa-style): a screen-space radial blur of (1 − occlusion) × sun visibility from the sun's screen point, 2 passes × ~24 taps, weighted by decay; composited ADDITIVELY into the sky and onto the sea's air side, scaled by AIR HAZE (no haze → no rays, physically honest) and by the cloud-coverage window: rays are strongest when coverage is 0.55–0.85 (broken deck), zero at clear and at full lid. Warm tint from the sun disc palette. Works with the sun OFF-SCREEN too (rays fan in from the edge) by clamping the projected point and fading.
C. SILVER LINING on the puff clusters: a backlit transmittance term on each puff — when the sun is behind a puff relative to the camera, its EDGE (alpha 0.1–0.5 band) gains a bright warm rim (forward scatter), its body stays dark. Ties to the existing per-puff self-shadow idea (ref-cloud-selfshadow) — do both in one round.
D. TWO-LAYER DECK: the day hand gets a `layers` field: a low dark stratus deck (puffs flattened, larger, darker base, drifting slower) under a high torn cumulus layer (existing puffs, lit). The hole the rays come from is where the low deck's coverage noise dips — bias the shaft mask to the low layer's gaps.
E. LAB: knobs for ray strength, decay, hole bias, lining strength; a "MICHAEL'S ROAD" preset (coverage 0.72, low deck 0.6, sun 25° behind the deck, haze 0.6).

GATES: never neon (rays are haze-lit, values compressed like the photo — the brightest ray is dimmer than the hole); the storm lid stays a lid (rays die at cov > 0.9); performance: the occlusion pass is half-res and skipped when the camera is below the surface or the sun is > 40° off-screen; zero new programs at runtime. Judge against the photo: the fan should read as light in the air, converging behind the cloud, silver at the edges.

## Log
- 2026-09-05 — BUILT on branch `crepuscular` (agent round, not merged): `src/postfx.skyrays.js` (half-res sun-visibility mask = dome coverage chunk + puff occluders + depth gate, 2x radial blur toward the clamped sun point, additive composite read against the mask's mean, haze-weighted by depth, soft-capped at 0.6x the hole); clouds.js two-layer deck off the new hand field `layers` (last draw of the hand, pool split, one draw call), silver-lining rim + CPU self-shadow; GLASS.rays knobs + MICHAEL'S ROAD preset in the lab. Measured: 1.1 ms GPU at 1788x1812, zero programs on first fan, gates (clear/lid/night/underwater/off-screen) verified. Orchestrator to review + merge.
