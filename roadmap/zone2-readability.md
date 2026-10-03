---
title: Zone 2 reads at play distance
status: wip
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
