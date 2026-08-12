---
title: Water ideas from inkwell
status: backlog
tags: water, reference
updated: 2026-08-07
---
Harvest the ideas (not the code) that make the inkwell WebGPU ocean read so well, as bounded passes on our own WebGL surface: physically-derived foam, wind-shaped glitter, capillary detail, backlit crests.

## Detail
Reference: https://github.com/siliconjungle/inkwell-webgpu-water (MIT). Michael's read: "the result was amazing" — full adoption declined (raw WebGPU, no three.js, ~6.8ms GPU, standalone app; would require the WebGPU optics rewrite we ruled out at the r184 upgrade). What actually makes it look right, in rough order of payoff for us:
- **Jacobian foam**: foam where the surface COMPRESSES (the Jacobian of the horizontal displacement), not where it is tall. Our `water.js` `waveSum` is analytic so its derivatives are too — true compression is a few extra ops in the fragment shader. Replaces/augments the height-led whitecap gate; foam would track breaking crests through their whole life instead of flashing on peaks.
- **Cox-Munk glitter**: the sun/moon glitter path widens across-wind and tightens along-wind as wind rises (closed-form slope-distribution BRDF, small change in the existing glitter term). One more place the wind becomes visible.
- **Capillary cascade**: a third, very high-frequency normal-only detail layer scaled by wind — the fine "skin" texture that sells their close-ups. Normal perturbation only, no displacement, so localSurfaceY/tether/refraction are untouched.
- **Backlit crest translucency** ("low-energy volume scattering"): when the sun is low and behind a wave, thin crest tops glow green-through. A cheap view/sun/crest-height term; biggest payoff at dawn/dusk, which is where our new days live.
Constraints as always: no new render targets, bloom discipline, calm-noon anchor, CPU height mirror agreement for anything that displaces.
- Acceptance: each idea lands as its own small verified pass; Michael judges against the inkwell demo's feel, knowing ours is a different (quieter) sea.

## Log
- 2026-08-07 — evaluated the repo at Michael's ask; adoption declined, ideas harvested ("add to backlog... if you have some ideas to push closer to it")
