---
title: Win back the frame budget
status: wip
tags: perf
updated: 2026-10-03
---
After the sea-life, Orune, zone-2 and Brooder work, frames got heavier: about 17–22 ms in zone 0 and 21 ms in zone 2, against 12–14.5 ms earlier in the week. Find the real costs and bring every zone back under budget without losing the look.

## Detail
- Orchestrator readings (2026-10-03, hidden pane, driven loop, `__gpu.median`, noisy ±3 ms): zone 0 17.0 ms at 1.0x and 22.0 ms at 1.5x; zone 1 13.3 / 12.9; zone 2 21.0 / 21.3. Zone 2 doesn't scale with resolution, so suspect vertex or draw cost, not fill. In zone 2, `__plants.proc(true)` gave 14.1 ms and `__abyss.on(0)` gave 15.8 ms against a 17–21 ms base.
- Earlier baseline (aaa-pass-3, 2026-09-30, same method): zone 0 12.4, zone 1 10.6, zone 2 14.5 ms at 1.5x.
- Suspects: BatchedMesh sub-draws (168–433 per view) and their vertex cost; near kelp (6–18k tris per plant); far plant LODs that stalled at seams; Orune's arm coverage and papillae (`L.noPap`); the zone-2 colony pool lights; the Brooder plume and claw search; the sea motion-vector pass; sculpted fauna.
- Acceptance: a trustworthy measurement method (fronted, visible tab or a fixed-step offscreen harness with per-pass timer queries), a cost table per system per zone, and every zone at or under about 13 ms at 1.0x internal on this machine (so DRS can hold 1.25–1.5x), with no visible look regression (before/after frames).

## Log
- 2026-10-03 — created after the post-merge budget check; work started.
