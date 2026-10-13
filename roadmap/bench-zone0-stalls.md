---
title: Zone-0 frame stalls and an unculled trail set (found by the primfix bench)
status: backlog
tags: perf, zone 0
updated: 2026-10-13
---
The primfix bench found two perf leads. In zone 0 roughly every 8th frame stalls for 11-38 ms, probably the auto-exposure readback. Velkath's trail set is drawn at every zone-0 spot (58-62k tris), even 127 u away.

## Detail
- Found by the primfix cost bench (2026-10-13; ~/sc/.abyssa-wt/reviews/primfix-bench.md, raw logs primfix-bench.runs.jsonl / .diag.jsonl beside it).
- Conditions: a headless host with vsync off and an uncapped rAF, so the GPU queue is deep. Under vsync in Michael's window the stall may be shorter or absent: measure there first.
- The 8th-frame stall: 60 / 7.5 Hz = 8, which matches the auto-exposure meter rate (CLAUDE.md "Perf harness": "auto-exposure metered at 7.5 Hz ... each getBufferSubData is a 1.8 ms main-thread round trip"). It dominates zone-0 frame variance in the bench.
  - Levers: `postfx.exposure.js` (the PBO ring's read cadence and depth), CLAUDE.md "AUTO-EXPOSURE".
- The trail set: it is not distance-culled. It costs nothing measurable today, but those triangles reach every zone-0 view's colour pass.
  - Lever: `sleeper/brood.js` (the trail's mesh visibility).
- Acceptance: under a 60 Hz vsync in a visible window, the frame-time p99 in zone 0 shows no periodic stall, OR the stall is explained and judged harmless. The trail set is culled beyond its visible range, with no pop.

## Log
- 2026-10-13 — Captured from the primfix bench's concerns.
