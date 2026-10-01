---
title: Sea and sky rebuilt: spectral ocean, volumetric clouds
status: done
tags: water, sky, clouds, quality, rendering
updated: 2026-10-01
---
Michael, 2026-10-01: "surface water still looks way off clouds look fake".
Two Opus agents in parallel, then a follow-up pass on the clouds. Merged serially and verified on main.

## Detail
- **Clouds** (`src/world/sky.js`): Nubis-style raymarched clouds. Noise volumes are generated on the GPU at load: a 128³ Perlin-Worley shape volume and a 32³ Worley detail volume. The weather map comes from the weather system's daily hand, so the same hand gives the same sky. Lighting is Beer–Lambert with a powder term, two-lobe Henyey-Greenstein phase, multiple scattering and a light march. The march runs at about third resolution with temporal reprojection. The sky is physical (Rayleigh, Mie and ozone, baked to a lookup texture), with a limb-darkened sun and procedural stars. The cloud shadow map dims the deck's key light. The crepuscular rays use the cloud transmittance. Follow-up: a dark, structured storm lid with rain curtains, scud and lightning that lights separate lobes; overcast rolls; a second detail octave for crisper cumulus; silver-lining energy fixed; dusk pulled toward brass and sepia. `getSkyEnv()` and `getCloudShadow()` are the exported hooks. `__vsky`.
- **Ocean** (`src/world/ocean.js`, `ocean.spectrum.js`, `ocean.worker.js`): a GPU FFT ocean with three cascades (287, 67 and 17 u) and the spectrum rebuilt on the GPU from wind and storm every frame. Displacement, slope variance and Jacobian foam with persistence. An 8-level clipmap drawn in one call reaches the true horizon. Shading: reflection of the real sky through `getSkyEnv`, GGX glitter with slope-variance roughness, subsurface glow through crests, lit foam, the cloud shadow, a foam collar round the raft, and the raft's shadow. Snell's window and total internal reflection from below are kept. Physics heights come from a worker that recomputes the two long cascades (about 4 µs per query; about 2 cm RMS error against the drawn surface). Clear-air haze is about 3.5x lower; storms bring it back. `__ocean`.
- `serve.py`: listen backlog raised to 256. The default of 5 reset some of the boot's 140 module requests and failed a boot.

## Log
- 2026-10-01 — merged clouds, clouds2, ocean. Verified on main: console clean, 14 lights, `__safeFailed` empty, sleeper fingerprints 15ce888c / c938fe6e / 652d0412, `__ocean.verify` 0.020 u RMS against a 0.22 u RMS sea.
- Open for Michael's eye: the sea and sky with real input and a moving camera (all captures used debug pins); the dusk palette; rain shafts read as dark smudges; cumulus is still a little soft; the lightning flash turns the sea a flat pale grey; foam in a gale is softer under TAA; the gale-crests-over-deck decision card needs a fresh look now that the raft rides the swell. Cleanup: dead `GLASS.chop` and `windwater` knobs in water.js; skyrays still uses the old haze constant.
