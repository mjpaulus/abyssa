---
title: Surface water bar (inkwell + poseidon)
status: wip
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
- 2026-08-07 — second reference: https://github.com/owenyuwono/poseidon ("This is amazing" — Michael, with a storm screenshot). Same wall: WebGPU-only Tessendorf FFT, TSL, no WebGL fallback. NEW harvest from his screenshot: (1) CHOPPY horizontal displacement — steep-fronted waves from crowding vertices toward crests (Gerstner-style term on our analytic field; the CPU height mirror in water.js surfaceHeightAt MUST mirror it or the raft/camera/refraction part ways with the mesh); (2) TEXTURED foam with build/decay off the Jacobian (fold-born, lingering, streaking — upgrades the flat whitecap term); (3) foam texture procedural per the all-generated rule. Plan when Michael returns to surface water: the WebGL "poseidon look" pass first (~70% of the screenshot), then, if his eye wants the true spectrum motion, the WebGPU migration becomes a named project-defining decision.
- 2026-08-07 — round started (Michael: "go ahead and start surface water bar while I test sal changes"); agent in an isolated worktree so his live test tree stays stable
