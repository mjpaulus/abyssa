---
title: Screen-derivative surface relief
status: done
tags: materials, reference
updated: 2026-10-03
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: S.

## Detail
Study: UnderwaterMaterial.js surfaceNormal() with the resolved = 1-smoothstep(fwidth) guard.

CHANGE: Cheap scales/pores/strata on flora, rocks and fish from a procedural height, guarded so it never sparkles at distance — where triplanar isn't used.

## Log
- 2026-10-03 — moved to done in a board cleanup: superseded by baked sculpt normals + microDetail footprint fade.
