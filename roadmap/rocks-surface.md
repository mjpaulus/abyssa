---
title: Rocks read as stone
status: wip
tags: flora, textures, quality
updated: 2026-09-04
---
Michael: 'rocks have zero texture.' Boulders/pebbles/hero landmarks are vertexColor-only MeshStandardMaterial blobs.

## Detail
Generated rock map set (strata fbm + worley fissures + grit; a darker fissured deep variant), triplanar via onBeforeCompile (instanced rocks have no usable UVs), screen-derivative relief for walk-up read (reference surfaceNormal with the fwidth-resolved guard), cleavage faces/ledges in rockGeo, wet-sheen roughness. Zone palettes still multiply through. Placement stream untouched — site-0 rock fingerprint must match.

## Log
2026-09-04: Shipped, merged 8af8bc5. Two generated 512² map sets (strata + fissures + grit; darker deep variant; 100 ms boot), triplanar via onBeforeCompile, screen-derivative relief resolved by fwidth, three cleavage planes + bedding terraces in rockGeo (tri counts unchanged), wet Fresnel sheen per zone (0.9/0.4/0.12). Rock placement fingerprint bit-identical; programs flat; fps unchanged. TASTE: zone-2 strata read as regular ribbing at 2u — BANDS/weight in textures.js are the levers. Awaiting Michael's eye.
