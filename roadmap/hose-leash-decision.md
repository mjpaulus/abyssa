---
title: The hard hose leash — keep or cut?
status: decision
tags: design, survival, decision
updated: 2026-09-01
---
The audit found a hard leash: tether.js clamps player.pos at survival.hose. CLAUDE.md records that you REJECTED leash-clamping ("never leash-clamp the player"). Either the doc is stale or the clamp regressed in.

## Detail
As shipped: at full hose the diver is HELD and (tautness 1 → unsupplied) DRAINS at the same moment. Options: (a) keep the clamp — physical, but contradicts the recorded ruling; (b) soft leash — no clamp, taut line just cuts supply and the drag pulls back (the rejected-clamp version); (c) clamp with give — a 4-6u elastic band then hold. The new HOSE_REQ set (640/920) was chosen to equal floor-diagonal reach so the leash never fires against a sleeper's wander regardless. Your ruling; the code is untouched until then.
