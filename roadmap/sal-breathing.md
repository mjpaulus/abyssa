---
title: Sal's breath (bubbles + rhythm)
status: wip
tags: quality, sal, fx
updated: 2026-08-26
---
Michael: "sals air bubbles and breathing need more realism. Feel to standard." Period-correct Mark V breathing made visible.

## Detail
Round on branch sal-breath: exhaust BURSTS from the helmet's actual valve position on a breath cycle (~4s at rest), not a stream — 1-2 lead bubbles + a small trail per exhale. Cycle rate driven by context: exertion shortens it, low air shallows it toward a panic read near drowning; phase exported for audio to hook later (no sounds added — audio audit is its own eared round). Bubble physics: size-dependent rise, helical wobble, visible expansion on long rises, death INTO the wave surface. More exhaust while ascending fast (expanding air); nothing in air. A subtle shoulder-rise breath motion on the same phase (rigid suit — it reads at the shoulders, not the chest). Budget: ≤1 new draw call, zero per-frame allocation, no new programs. Gait untouched.

## Log
2026-08-26: Shipped, merged b4d465a, pushed. Scout found THREE unsynchronized breath clocks (shoulder oscillator, bubble timer, audio regulator setTimeout) — unified onto one phase driving shoulders, bubbles, AND the regulator sound. Bursts: 1-2 lead bubbles + 7-14 trail per exhale from the real valve anchor; stray leak rare. Cadence law measured live: rest 4.05-4.45s, sustained swim winds down to 2.25s and RECOVERS SLOWLY after (a sprint costs breaths after it ends); low air shortens toward 1.7s and shallows. Physics: size-dependent rise (leads outrun trail), 1/r helical corkscrew, 1.5x expansion over 30u, death into the actual swell. Fast ascents vent extra. Zero new draw calls (reused the instanced mesh, pool 60→96), zero per-frame alloc. window.__breath probe. Awaiting Michael's feel check.

2026-08-26 (feedback round): Michael: "too subtle, no variability, dont disrupt the water surface." All three fixed, merged 98ddfe2. Presence: leads 2x+ bigger (r 0.11-0.17) with a silvery fresnel rim (emissive-injected — still fogs with depth), pool 200. Character: burst classes (1/4 thin sip, 1/5 heavy dump), ±60% lead size, gulp bubbles with hard wobble (1/8), valve-chatter double spits (1/5), head-yaw column drift, rest cadence 3.2-5.2s with held breaths (~6s then a big release, 1/10); variance collapses to metered under panic. Surface: new surfaceBoil(x,z,strength) hook — ripple rings folded into the wave normals + churning foam lace at the breach, both sides of the interface, ~1.5s decay; zero new draw calls. window.__boil probe. Note for the eye: in daylight air the white lace is partly eaten by near-field haze — the rings carry the read from the deck.
