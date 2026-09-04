---
title: Wave-slope caustics + seabed sun shadow
status: backlog
tags: water, lighting, reference
updated: 2026-09-01
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: M.

## Detail
Study: UnderwaterMaterial.js caustic() with uCausticSlope displacing the uv; UnderwaterWorld.renderShadow (ortho map re-rendered on move/sun change, 9-tap PCF).

CHANGE: Feed our Gerstner gradient into the caustic uv so caustics move with the actual waves; one 1024 ortho sun map over the zone-0 floor refreshed every ~18 frames so reef and wrecks cast shadows on sand.
