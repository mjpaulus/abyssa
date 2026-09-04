---
title: The snowfield sea (bright-day milk)
status: wip
tags: water, bug, quality
updated: 2026-09-04
---
Michael's screenshot: on a bright overcast day from the deck, the sea read as a snowfield — pale cyan-white, glassy, BRIGHTER than the grey sky it reflected. "Maybe it's the transparency of the water from the surface."

## Detail
Reproduced (day-4 hand, storm ~0.5, sun 41°) and shown to predate the surface-filtering round (identical on the pre-round build). Elimination: detail normals, glitter, foam accumulator, refraction, SSS each off → still icy; opacity off → paler/see-through; not the storm stack (settled storm 0 also milky under a lid).

ROOT CAUSE (decomposition with a new uDbg term isolator, __sky.dbg(n)): from deck height the sea mirrors only the lowest ~10° of sky, and that band was ALWAYS the clear-day horizon ring — every palette stop authors hor at 2.4-6x zenith, the cloud deck dissolves into that ring at the horizon ("THE MILKY BAND"), and the fog chunk's airlight was the noon ring baked as a literal. Under an overcast the lid overhead was dark while the sea mirrored a bright ring the lid had hidden, then had the same ring stacked on as haze. Measured: horizon sky 0.36, sea just under it 0.41 (brighter than the sky). Fresnel, body, transmission, roughness, SSS were all ≤0.03 — innocent. (Also: "clouds 0.86" in my repro was the hand's FOG; and weather.set eases over ~8s — an unsettled storm 0 fooled one toggle.)

## Log
2026-09-04: Fixed, merged 4582be0. uSkyHor (what the dome draws AND the sea mirrors) is pulled toward the lid's own underside by lidK = max(ms(cov, lidCov), ms(storm, lidStorm)); the fog chunk got its first uniform (abyssaAir — one shared Float32Array installed on every fogged ShaderLib entry; flag 0 = old bake bit-for-bit) so fog airlight, sea rim, and dome horizon are ONE number = the ring under the lid. Numbers (scene-linear, post bypassed): bright overcast horizon sky/sea-under-horizon 0.36/0.41 → 0.20/0.22 — sea ≤ sky everywhere but the 0-2° slit it mirrors. Calm-noon anchor bit-identical (lidCov starts above day-0 cover). Gale keeps walls/foam, reads darker at the horizon than the shipped bright gale — GLASS.cloud.lidRing (0.10) is Michael's lever (0.15 restores more haze). Awaiting Michael's eye on the SAME bright day.
