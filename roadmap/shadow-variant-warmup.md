---
title: First-jet shadow compile (three's draw-order shadow variants)
status: backlog
tags: perf, hitches, boot
updated: 2026-10-13
---
On some seabed spots, Sal's first air-pack jet compiles one shadow program the boot never warmed. That causes a one-time hitch. Main shows it too, at a different spot: three r184 picks a shared shadow material's variant by draw order.

## Detail
- Found by the sea-floor relief's Task 5, with `tools/bench/hitch.mjs` `jet`. The relief branch compiles +1 program at (4, 4); main compiles none there, but the identical program (same key) on the first jet at (−40, 30). Over an 8-spot place-and-jet scan both builds compile the same two distance programs. Report: the relief branch's `.superpowers/sdd/.../task-5-report.md`, "The jet compile, traced"; its findings are copied into docs/reports/2026-10-13-seafloor-relief.md at Task 14.
- The program: a MeshDistanceMaterial for the lantern's cube shadow, with `map` (mapUv), `instancing`, `flipSided` and `numDirLightShadows` 1.
- The cause: r184's `WebGLShadowMap.getDepthMaterial` writes the caster's `map` onto one shared distance material and re-picks its program only on a version change. The variant a draw uses therefore depends on which caster came first.
- Fix options:
  - (a) boot warm-up: build every shadow caster's distance and depth variants for both `map` states at both sun-shadow states (CLAUDE.md "Boot / loading", hazards 2 and 6);
  - (b) a shadow-path patch that makes the variant independent of draw order (it changes the shadow program set, so measure it).
- Also seen: some casters with `castShadow` are drawn into all six lantern cube faces every frame wherever Sal is in zone 0 (24 draws per frame). They could be culled by distance in the shadow pass.
- Acceptance: `hitch.mjs` `SCEN=jet` at (4, 4) and at (−40, 30) shows 0 first-sight compiles on both main and the branch.

## Log
- 2026-10-13 — Captured from the relief Task 5 hitch trace (Ruling 18: not the relief's defect).
