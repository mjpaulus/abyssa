---
title: Rocks read as stone
status: wip
tags: flora, textures, quality
updated: 2026-09-04
---
Michael: 'rocks have zero texture.' Boulders/pebbles/hero landmarks are vertexColor-only MeshStandardMaterial blobs.

## Detail
Generated rock map set (strata fbm + worley fissures + grit; a darker fissured deep variant), triplanar via onBeforeCompile (instanced rocks have no usable UVs), screen-derivative relief for walk-up read (reference surfaceNormal with the fwidth-resolved guard), cleavage faces/ledges in rockGeo, wet-sheen roughness. Zone palettes still multiply through. Placement stream untouched — site-0 rock fingerprint must match.
