---
title: AAA lighting pass
status: wip
tags: quality, lighting, perf
updated: 2026-08-25
---
Full lighting pass against the threejs-lighting skill pack. Audit verdict: the rig's architecture is genuinely strong (three-point on Sal, STOPS depth grading, disciplined per-frame writes) with ONE real contradiction: the leviathan's per-sigil PointLights break the light-count-stability law the vents module treats as sacred — every zone change recompiles every lit material mid-dive.

## Detail
Fix round on branch aaa-light: (1) boot-time pool of 5 sigil lights, borrowed/returned, light count constant forever; (2) calming-flash spike (+900 at decay 1.8) tamed to physical decay with same close-range read; (3) lantern cube shadow 1024→512 A/B; (4) N8AO radius 2.2→~1.0 A/B — contact grounding, gear seats onto planks; (5) procedural deep-water env for underwater metals (RoomEnvironment softboxes → oceanic gradient; raft keeps sky probe); (6) beacon lamp dims in air; (7) rim light clamped above terrain on vertical descent; (8) sun light.layers idea evaluated and DECLINED (per-render light gathering — layers can't scope per-material without recompile risk), documented in-code.
Backlog seed: LightProbe from the sky PMREM could replace the hand-tuned AIR_SKY/AIR_SEA ambient with sunset-correct SH for the deck at dusk (+1 permanent light, added at boot only).

## Log
2026-08-25: Shipped, merged to main 3e4f12e. Sigil pool: light count probe-constant at 14 across two zone cycles AND a full voyage; program count flat after first visits (the mid-dive recompile hitch is gone). Flash 900→360 at decay 2.0 (close-up blaze intact, scene splash gone). Lantern shadow 512 won the A/B (no stair-stepping in murk at 34u). N8AO 2.2/2.6→1.0/3.0 — gear seats onto the planks. New envTexDeep (procedural teal-to-black PMREM) for wrecks/props/flora/tools/tether/leviathan; raft+diver keep the sky path. Beacon dims in air; rim clamped on descent; layers idea declined in-code. TASTE CALL for Michael: lit wards read slightly tighter at long range under physical decay — judge on next dive. Integrated build console clean.
