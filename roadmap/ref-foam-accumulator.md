---
title: Foam accumulator with windrows
status: next
tags: water, quality, reference
updated: 2026-09-01
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: M.

## Detail
Study: OceanFFT.js ASSEMBLE_FRAG (rate injection, decay, bubble channel) and the windFrame/stretch vec2(0.22,1) foam lookup in OceanMesh.js.

CHANGE: A small world-tiled ping-pong RT (256²) fed by our existing Jacobian/lag fold source at a RATE with exponential decay (equilibrium coverage), advected by wind; mask stretched 0.22:1 along wind for Langmuir streaks; separate slow bubble channel. Ours persists ~4s via lags but never streaks.
