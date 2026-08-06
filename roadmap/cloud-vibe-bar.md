---
title: Clouds to the photo bar
status: wip
tags: sky, taste
updated: 2026-08-06
---
Michael set the cloud quality bar with a reference photo: dusk marine sky, ragged individual cloud clumps gathered low near the horizon with dark flat undersides, a milky haze band at the waterline, ruthlessly quiet grey-lavender palette.

## Detail
The bar ("the vibe of the clouds. this is the bar"): a dock at dusk — sparse torn cumulus CLUMPS each with its own silhouette (not a modulated field), perspective-compressed into a band low in the sky, zenith nearly empty, bases darker than the sky behind them (backlit), merging into a hazy horizon band, calm mirror water. Measurable properties: clump isolation, horizon gathering, dark-base dominance at dawn/dusk ring stops, low chroma.
Levers: `world/water.js` `skyRadiance` cloud block (fbm2 shaping, coverage threshold curve, uCloudDrift), `config.js` `GLASS.cloud`.
- Acceptance: side-by-side against the photo's four properties at a fair-cumulus dusk; Michael says it hits the vibe.

## Log
- 2026-08-06 — bar set by photo; shaping pass launched
