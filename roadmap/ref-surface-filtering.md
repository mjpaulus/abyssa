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

## Log
2026-09-01: Shipped, merged b32eaee. Baked 1024² ripple normal (fbm+worley, seeded, zero files); three rotated textureGrad detail layers faded by pixel FOOTPRINT (no distance term — texture now holds to the horizon); Cox-Munk roughness minus the resolved share → GGX α; sun glitter is a disc-widened GGX × correlated Smith × Fresnel behind GLASS.chop.glitterLegacy (0/1 live A/B) with a soft cap so noon never exceeds today. Finding: the literal reference lobe was invisible at our sun/disc ratio — glitterK 14 + the cap made it read. Verdict: GGX = soft path lengthening toward the horizon; legacy = tighter sparkle column. SKIPPED (honest): crosswind narrowing (needs anisotropic GGX); sky-reflection roughness (our sky is analytic, no env lobe to widen). Awaiting Michael's eye — the glitterLegacy knob is his A/B.
