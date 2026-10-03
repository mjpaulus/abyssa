---
title: Zone 2 reads at play distance
status: done
tags: lighting, atmosphere, zone2
updated: 2026-10-03
---
The abyss is so dark at normal play distance that the new sculpted plants, animals and Mhor barely show outside Sal's lantern. Make it readable without breaking the quiet-dread mood or going neon.

## Detail
- Already tried and kept: Mhor's own cold light and slot-B lamp glow (aaa-pass-3), sea-pen glow waves (sea-life-sculpted). They help only up close.
- Rejected: a flat ambient lift (it greys the blacks); neon emissives.
- Levers: `lighting.js` relight zone stops, `postfx.js` film finish (`__film`), `water.js` lamp in-scatter, `world/particulate.js`, the deep plants' glow, auto-exposure clamps in `postfx.exposure.js`.
- Acceptance: at 9 u game distance in zone 2, the seabed shapes, plants and nearby animals read in silhouette and value; blacks stay coloured and deep; no neon; GPU parity.

## Log
- 2026-10-03 — created from the open items on sea-life-sculpted and aaa-pass-3; work started.
- 2026-10-03 — branch `zone2` (e8d2d03, 0cf111c): GLASS.abyss + world/abyss.js, all eased in by `abyssK(camY)` below -640 (`__abyss.on(0)` = shipped frame; zones 0/1 untouched by construction). Floor palette pale volcanic ash over dark basalt (uniform writes); Mhor's five idle pool lights ride the nearest bioluminescent colonies 9–42 u from Sal (cold teal, decay 2, breathe + flare on stir pulses; out of lamp slot B; light count 14); zone-2 exposure fence [0.90, 1.30] key -4.4, film pivot 0.14 / indigo toe, lamp in-scatter x1.6, camera-riding cool rim x0.4 (no fill from nowhere). At 9 u over four spots: mean luminance x1.2–2.2, p50 x1.2–1.9, pixels under code 24 0.47–0.63 → 0.29–0.55; p05 0.0019 → 0.0026 (blacks stay near code 9, violet-indigo). GPU paired A/B inconclusive on a shared machine (pair medians +0.5..+1.8 ms with ±6 ms noise) — needs a quiet re-measure. Open: the cold furnace and the open plain beyond ~10 u still read black; colony light is subtle by design.
- 2026-10-03 — merged to main and verified in a fresh tab (zone tour clean, 14 lights, fingerprints unchanged). Kelp and reef views read at 9 u; the cold furnace and the open plain past about 10 u are still black. GPU cost is unproven on a shared machine (pair median +1.8 ms, overall medians equal); re-measure with `__z2.gpuAB` on a quiet machine. Kill switch `__abyss.on(0)`; colony lights alone via `bioI`.
