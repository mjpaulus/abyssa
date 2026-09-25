---
title: Lightning as a scene light
status: wip
tags: weather, lighting, reference
updated: 2026-09-25
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: S.

## Detail
Study: Lightning.js _grow (recursive midpoint bolts, return-stroke train) and ShadingGLSL lightningContribution (two-slot inverse-square).

CHANGE: Inject the two strongest bolts as uniforms into sea/raft/terrain through our fog-chunk-style global patch; bolt ribbons as one InstancedBufferGeometry. Today lightning is a flash scalar + underside sheet.

SHIPPED (branch ref-lightning, not merged):
- `world/lightning.js` — each MAIN stroke of the weather's schedule grows a channel: 64-segment
  midpoint-displaced trunk from just under the cloud deck down TOWARD the sea (ends 4-14 u up),
  2-4 branches; ONE InstancedBufferGeometry of camera-facing additive ribbons (fog:false),
  pool of 4 channels (512 quads), zero per-frame allocation. Pulses = the weather's own
  echo timings/amplitudes (instant rise, 25 ms hold, 35 ms decay), then a wider, fainter
  afterimage (250 ms decay). Position/shape = pure function of (deal seed, stroke index).
- `water.js` fog chunk — `abyssaBolt0/1` (xyz + intensity), `abyssaBoltCol`, `abyssaBoltK`
  installed exactly like `abyssaAir`; `vFogP` world-position varying; `ABYSSA_LIT` planted
  at the head of `lights_fragment_begin` so lit materials use their real normal and
  everything else a screen-derivative flat normal; inverse-square with a floor distance;
  the water leg extinguished by the clear column (KMOL, storm-scaled, gain `depthK`);
  added BEFORE the eye leg's extinction. The sea takes 0.15 of the diffuse term (`gBoltK`,
  the gSunK pattern). Sheet terms (sea + rain layer) at `sheet` = 0.5, `setWeatherLight`'s
  flash boost at `coarseK` = 0.45 — the coarse fallback still works under the degrade
  ladder; only the ribbon mesh sheds (perf stage >= 3).
- `weather.js` — `flMain`, deal gen/seed, `lightningSchedule()`, `st.clock`,
  `weather.strokes()`. Lab: 'lightning' knob group (GLASS.lightning). Probe:
  `__bolt.state()/fire(x,z,strength)/last()/hold(x,y,z,I)/ribbons(on)`. `__bolt.last()` is
  the audio hook: {x,y,z,t,amp,top,tx,tz}.

OPEN (needs Michael's eye): peak 8 / floor 45 / temp 0.35 are numeric picks; the flat 0.36
reflectance (the chunk never sees albedo) desaturates a flash, which is defensible but is
taste. Clouds are fog:false so their lit side is NOT reached (per-material work, declined).
The ribbons are hidden from the refraction pass (refrHide), so a bolt is not seen THROUGH
the surface from below — the sheet covers it. Bolt amplitude carries `storm` at the fire
frame (±1e-4 across reloads); position and time are exact.

## Log
- 2026-09-25 wip — shipped on ref-lightning (31a050a + follow-up). Verified in-browser:
  (a) forced night storm, strike frame + 200 ms + 500 ms captured (deck lit from the
  bolt's side, afterimage fainter); (b) underwater hold light I=8 at 60 u out: Sal's
  mid-region +6.5 luma at 15 u, +1.4 at 35 u, 0 (within noise) at 60 u; (c) fire/hold from
  +x/-x/+z — left/right deck readback follows the bearing (nx: L+39 R+33; px: L+10 R+17;
  pz: symmetric); (d) day-5 hand, two reloads: first bolt (-120.776, 40.974, 124.422) at
  t 3687.5635 both times; (e) lights 9 before/after in the same state; programs play 239
  vs main 238 (+1 ribbon material), 245 after 6 P toggles on BOTH; 40 strikes + held
  light: 351 -> 351; GL errors 0 across 6 P toggles + 2 resizes; (f) __gpu.median()
  uncapped, 20 s each: storm no bolts 13.3 ms vs held light + a strike every 500 ms
  15.6 ms (worst case — a real strike is live ~1 s per 8-25 s); (g) sleeper fps
  15ce888c/c938fe6e/652d0412 unchanged; (h) console clean.
