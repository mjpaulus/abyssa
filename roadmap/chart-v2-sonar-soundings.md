---
title: Chart V2: sonar soundings
status: done
tags: chart, v2
updated: 2026-08-05
---
The sounding set reveals new anchorages on the paper — the flagship V2 hook.

## Detail
New site rows stay hidden until sonar-discovered; the chart gains blank water with a pencil question mark.
Needs: hidden flag per site row, discovery event from sonarPing, chart redraw.

- Acceptance: A hidden site discovered by sonar appears on the paper and is sailable; undiscovered sites unreachable.

## Log
- 2026-08-05 — from the design panel's V2 list
- 2026-08-05 — V2 round started; orchestrator wired contracts (site.js 4th hidden site, game.js found/keeps persistence), agents on keepsakes + creatures
- 2026-08-05 — shipped: 4th hidden site THE UNSOUNDED SHELF in site.js; sonar ping from zone 2 discovers it once-ever ("A FAR RETURN..."); chart shows a pencil "?" until then, and the discovered anchorage renders in Sal's pencil, not ink. Persisted in the save (found[]). Verified: real T-path discovery, terrain hash differs at site 3, site-0 round trip identical
