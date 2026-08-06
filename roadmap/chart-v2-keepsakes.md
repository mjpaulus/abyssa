---
title: Chart V2: keepsakes shelf
status: done
tags: chart, v2
updated: 2026-08-05
---
Physical keepsake props on the raft; each remote wreck carries one line of the previous owner.

## Detail
V1 shipped keepsakes as collect-flags only. V2: a shelf prop near the chart table, one object per keepsake, one line of story each.

- Acceptance: Each remote wreck yields a physical keepsake on the raft shelf with one line of the previous owner's story.

## Log
- 2026-08-05 — from the design panel's V2 list
- 2026-08-05 — V2 round started; orchestrator wired contracts (site.js 4th hidden site, game.js found/keeps persistence), agents on keepsakes + creatures
- 2026-08-05 — shipped: keepsake props at every remote wreck (lib/keepsakes.js shapes, wrecks.js placement/pickup, 9 authored lines), shelf on the port bulwark by the chart table (raft/shelf.js, +0 static draw calls, one dynamic mesh). Real E-path pickup verified, persists, gaps in the row are the record
