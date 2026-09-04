---
title: Lightning as a scene light
status: backlog
tags: weather, lighting, reference
updated: 2026-09-01
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: S.

## Detail
Study: Lightning.js _grow (recursive midpoint bolts, return-stroke train) and ShadingGLSL lightningContribution (two-slot inverse-square).

CHANGE: Inject the two strongest bolts as uniforms into sea/raft/terrain through our fog-chunk-style global patch; bolt ribbons as one InstancedBufferGeometry. Today lightning is a flash scalar + underside sheet.
