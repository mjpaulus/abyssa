---
title: Foam accumulator with windrows
status: wip
tags: water, quality, reference
updated: 2026-09-01
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: M.

## Detail
Study: OceanFFT.js ASSEMBLE_FRAG (rate injection, decay, bubble channel) and the windFrame/stretch vec2(0.22,1) foam lookup in OceanMesh.js.

CHANGE: A small world-tiled ping-pong RT (256²) fed by our existing Jacobian/lag fold source at a RATE with exponential decay (equilibrium coverage), advected by wind; mask stretched 0.22:1 along wind for Langmuir streaks; separate slow bubble channel. Ours persists ~4s via lags but never streaks.

## Log
2026-09-01: Shipped inside the surface-filtering round (b32eaee). 2×256² HalfFloat ping-pong (own attachments), fed by our fold source at a RATE with exponential decay, wind-advected, bubble channel; surface sums it onto the instant lag foam, mask stretched 0.22:1 along wind. Measured: gale 12s → 11.6% cover; decays 0.48@3s → 0.02@21s after calm. Windrows read as faint pale streaks 3s after a gust — foamAccK is the lever if too subtle. Awaiting Michael's eye.
