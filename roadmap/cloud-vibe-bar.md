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
- 2026-08-06 — shaping pass landed in `world/water.js` skyRadiance + `config.js` GLASS.cloud.
  Four techniques, one per property. (1) CLUMPS: a second, much lower-frequency value-noise
  blob field gates where cloud may exist, swinging the coverage threshold +/-`islAmp`
  two-sided (a one-sided penalty just empties the sky — measured 12.9% cover -> 0.7%), plus a
  high-frequency vn tearing the silhouette. At hand.clouds 0.4 the field went 30 components ->
  15, mean clump 0.45% -> 0.93% of the sky, isoperimetric ratio 1.76 -> 2.02, at the SAME total
  cover. (2) HORIZON GATHERING: a view-elevation term on the threshold plus a lowered horizon
  fade. Cover by band (2-10/10-25/25-45/45-90 deg) inverted from 0.1/8.4/13.1/23.3% to
  9.1/13.3/17.1/7.7%; zenith cap 24.4% -> 7.5%. The uv clamp became `up + 0.10` — the old
  `max(up, 0.10)` froze the projection below 5.7 deg and stood pale curtains on the waterline.
  (3) DARK BASES: `uCloudBak` rises as the sun sinks and pushes the lighting term through
  pow(k, 2.2)*0.88. Mean cloud radiance / sky radiance at 20 deg: noon 1.07 (inert, lit tops
  dominate), dusk 1.03 -> 0.90, dawn 0.98 -> 0.86. Bases sit at 0.74x the sky behind them.
  (4) MILKY BAND: cloud AMOUNT (not colour) is attenuated over the lowest 10.4 deg, so it
  cannot double-apply with the marine layer's airFog. Rendered cloud/sky contrast falls 18.2
  -> 5.5 code values from the cloud band to the waterline, i.e. to the dither floor.
  Storm is untouched by construction — every shaping term is storm-scaled to zero (verified
  live: islAmp 0.20 -> 0.010, rag -> 0.008, zenBias -> 0.013, bak 0) and the deck still
  flattens dark (sky SD 13.8 at storm 0.91 vs 21.1 fair). Wind drift, ember undersides and
  the bloom cap all intact. Cost: 2 extra value-noise samples per above-horizon fragment
  against the 8 already there; below the measurement floor in the pane (28.66 vs 28.60 ms mean).
  Still needs Michael's eye against the photo — that is the acceptance test.
- 2026-08-06 — shaping shipped: clump-isolating blob mask (30→15 components at equal cover, clumps 2x bigger, raggedness 1.76→2.02), horizon gathering (zenith 24.4%→7.5%, low band 0.1%→9.1%), dark bases at the day's edges (0.86-0.90x the sky, exactly 0 at noon), 10.4° milky merge (contrast 18.2→5.5 into the glint floor). Storm deck and wind drift untouched; cost unresolvable above pane noise. AWAITING MICHAEL'S EYE vs the photo
