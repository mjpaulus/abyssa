---
title: Honest floor light
status: ship
tags: light
updated: 2026-08-05
---
Caustics coloured by albedo and shaded by the normal; the volumetric march gained its missing density term.

## Detail
Caustics: partially-normalised albedo (raw albedo killed them on 0.05 rock — 'only sand has that effect'). Chroma split cut from 0.35u to cm. Sun/storm gated.
Volumetrics: source term had no sigma_s — linear blowup along the silt line's clear paths; density factor + squared shared depth curve (march and billboards together).

## Log
- 2026-08-05 — shipped (87ccea5, 9c80a23)
