---
title: Surface filtering (footprint roughness, aniso detail, GGX glitter)
status: wip
tags: water, quality, reference
updated: 2026-09-01
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: M.

## Detail
Study: abyssal-living-deep OceanMesh.js FRAG (fpMajor/fpMinor, mssTotal/lost/alpha, the 3-rotation uRippleTex block), ShadingGLSL ggxD/smithGGXCorrelated, ProceduralTextures RIPPLE_FRAG.

CHANGE: Baked 1024 ripple normal (fbm+worley, mips+aniso) sampled with textureGrad at three rotated incommensurate scales, faded on pixel FOOTPRINT not distance; GGX roughness = Cox-Munk slope variance (0.003+0.00512U) minus the resolved share; sun glitter as disc-widened GGX with correlated Smith replacing pow(sd,uSunSize). Keeps every piece of our Gerstner/foam/SSS/refraction machinery.
