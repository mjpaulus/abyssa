---
title: Cloud self-shadow + silhouette erosion
status: done
tags: sky, clouds, reference
updated: 2026-10-03
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: M.

## Detail
Study: Clouds.js heightProfile, powder term, sampleLight octaves, CLOUD_DETAIL_FRAG. NOT a raymarch.

CHANGE: Per-puff terms for our 480 instanced puffs: shadow each puff by the puffs between it and the sun (CPU), erode edges with a baked 2D worley alpha, height-profile density. Quiet palette compatible.

## Log
- 2026-10-03 — moved to done in a board cleanup: superseded by the volumetric clouds (light-marched self-shadow, powder).
