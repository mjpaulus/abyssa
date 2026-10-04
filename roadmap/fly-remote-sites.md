---
title: Fly Pallid Bank + Burned Ground
status: decision
tags: chart, phase 5
updated: 2026-10-04
---
Phase 5 of THE CHART: judge both remote skylines, vent clusters, wreck placement with your own eye.

## Detail
Sail via the chart table, or console: `__chart.arrive(1)` (Pallid) / `__chart.arrive(2)` (Burned).
Tuning is one row per site in `src/world/site.js`: `terra.off` moves skylines, `scarcity` moves the economy, `sleepers` rows carry sigils/hue/epithets.
Terrain fingerprints if a probe is needed: home 5e6cfe45, Pallid ef14da09 (32x32x3 grid).
- Acceptance: both sites feel like different water, not palette swaps; sleeper rows read harder without being unfair.

## Log
- 2026-08-05 — created at THE CHART v1 ship (de2aacc); awaiting flyover
- 2026-10-04 — Michael chose to judge from a side-by-side page: Claude captures matched views (floor skyline, a vent cluster, the wreck, the sleeper) at home / Pallid / Burned and publishes one comparison page. Stays in decision until he rules from it.
- 2026-10-04 — capture-pass bugs fixed on branch octfix: (1) the anchor lantern's flame drew 7 u off the raft at (0.55, 2.9, 9.4) since the ladder move — davit.js flatten() baked the rig turn into its geometry but left its .position in the old frame; transformed nodes now move as nodes and the halo/deck light read their anchor off the moved flame. (2) The lime 'relic marker' glow by Orune is really the heap light's lamp-B in-scatter (hoarder.js: scatter 1.0 -> 0.4, colour 0xff6e22 so the haze arrives amber); all warm additive glow sprites (relic markers, porthole halos, bitumen, zone-2 polyp halos, spear glint, raft beacon) are fog-off with their own fade (lib/textures.js warmGlow) so none go teal-green with range. (3) Sal's exhaust bubbles no longer reflect the studio envMap at full strength in the dark (diver.js: IBL scaled and tinted by the light the bubble receives, matte body fades in the deep; shallows unchanged). (4) Pallid Bank's 'sheet of paper' was a bacterial mat on a 58-degree vent flank: mats now shrink to nothing past ~49 degrees (gardens.js, stream untouched). Frames: scratchpad/wt/shots/octfix-SHEET-*.png.
