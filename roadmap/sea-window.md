---
title: The sea became a window
status: ship
tags: water
updated: 2026-08-05
---
Screen-space refraction both ways; Beer-Lambert absorption free via the global fog; temporal half-rate pass.

## Detail
No depth texture needed — the height-integrated fog pre-attenuates the far-side render. Hysteresis on side selection (swell flip-flop showed the wrong world). Hard-clamped distortion. Half-rate temporal (draw-call submission was the real cost, not pixels).

## Log
- 2026-08-05 — shipped (53376e8 + 87c5dbb + c70151e)
