---
title: Wave-slope caustics + seabed sun shadow
status: wip
tags: water, lighting, reference
updated: 2026-09-25
---
From the abyssal-living-deep reference analysis (emollick, fully procedural — a peer under the hard rule). Technique, not code. Effort: M.

## Detail
Study: UnderwaterMaterial.js caustic() with uCausticSlope displacing the uv; UnderwaterWorld.renderShadow (ortho map re-rendered on move/sun change, 9-tap PCF).

CHANGE: Feed our Gerstner gradient into the caustic uv so caustics move with the actual waves; one 1024 ortho sun map over the zone-0 floor refreshed every ~18 frames so reef and wrecks cast shadows on sand.

## Log
- 2026-09-25 (branch ref-caustics, WIP e772ecb + follow-up): SHIPPED both halves. (1) Wave-slope caustics: water.js publishes `waveLow` (the two longest Gerstner components as resolved this frame, storm+wind folded in); terrain.js evaluates the surface gradient per fragment at each fragment's sun crossing (uSunW) and displaces the caustic uv by 0.33 x slope x depth — measured on the zone-0 floor: gradient (0.021,0.002) -> (0.005,-0.010) over 2 s, offset 1.7 u -> 0.4 u, and under a 0.9 wind the height amplitudes rise 0.37 -> 0.53 with the offset stretching to ~2.3 u. Depth/sunK gating untouched (storm: uSunK 0.15 as before; zones 1-2: fade 0). The lace is also shadowed (`seabedSh`). (2) Seabed sun shadow: lighting.js `floorShadow` re-aims the SAME DirectionalLight shadow camera (asymmetric ortho box, GLASS.seabed.shadowSize 180 u, texel-snapped, near/far +-120 u) at the diver below y=-26 in zone 0's band, refreshed every 18 frames via per-shadow autoUpdate/needsUpdate; above -26 the raft box, bias, normalBias, radius and autoUpdate are written back (verified on deck: box [-9,9,-9,9,28,72], bias -0.0004, nb 0.045, radius 6.4 from the Flow lean, autoUpdate true). Casters: terrain (shadowSide FrontSide — three draws BACK faces into PCF maps and a heightfield has none, measured: map coverage 18% -> 100% after the fix), boulders + hero rocks, wrecks, the Brooder (already cast). The floor's indirect light is shaded by `shadowAmbient` (0.45) or the shadow was a 15% tint. Cost (EXT_disjoint_timer_query, 1279 samples each): GPU median 6.09 ms on vs 5.78 off = +0.30 ms (mean +0.38), CPU +0.1 ms. Lights 14 both sides; programs not increased (branch 399 vs main 443 at the same zone-0 path); site-0 terrainH hash bit-identical to main; console clean. Knobs: GLASS.seabed + lab group 'seabed'; probe `__caust.state()/set()`. Not verified by eye at full quality: acne on steep sand at low sun (defaults bias -0.0003 / normalBias 0.35 looked clean at 32-58 deg).
