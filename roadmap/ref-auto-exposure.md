---
title: Auto-exposure (EV100)
status: backlog
tags: postfx, reference
updated: 2026-09-01
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: M.

## Detail
Study: PostFX.js EXPOSURE_FRAG (log-luminance mip chain, asymmetric adaptation speed, -0.5 EV compensation). The single biggest reason their screenshots look composed.

CHANGE: A 1x1 ping-pong float RT feeding renderer.toneMappingExposure; asymmetric speed; clamp range so the abyss stays dark by design (never brighten the deep past its authored stop). AdaptationPass history: do it as a tiny RT, not a Pass.
