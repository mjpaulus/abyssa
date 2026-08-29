---
title: AAA postfx pass (HDR pipeline)
status: wip
tags: quality, postfx
updated: 2026-08-26
---
Fresh audit of the post-rework chain against the threejs-postprocessing pack. Engineering came back consistent (no primary/degrade drift, depth discipline upheld, effects merge as intended) — but the headline is structural: the whole chain runs in 8-bit.

## Detail
Findings: (1) composer never requests HalfFloat — bloom blooms tone-mapped 8-bit values instead of HDR energy, the depth grade double-quantizes (banding on the deep gradients), volumetrics hard-clip; (2) shafts added with no tone-map shoulder — clip to flat cyan-white, the "milky" failure the retune was fighting; (3) DoF air-blend breathes at wave frequency in swells; (4) no dither anywhere + grain dies above 0.75 luminance — mid-tone gradients borderline for banding; plus grain 1Hz re-roll tick, FiniteEffect false-safety comment, wrong auto-sort comment, per-frame string building, grade ramp saturating at −650 of −900, unused cheap-volumetrics degrade rung, screen-axis-locked chroma, vent-ember bloom shimmer watch.

Fix round on branch aaa-postfx2: all twelve, HalfFloat + shaft shoulder judged together by eye, dither invisible-as-texture gate, DoF verified from the deck in a gale, full GL-error regression (P-bypass, resize, degrade ladder).
