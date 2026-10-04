---
title: The hard hose leash — keep or cut?
status: next
tags: design, survival, decision
updated: 2026-10-04
---
The audit found a hard leash: tether.js clamps player.pos at survival.hose. CLAUDE.md records that you REJECTED leash-clamping ("never leash-clamp the player"). Either the doc is stale or the clamp regressed in.

## Detail
As shipped: at full hose the diver is HELD and (tautness 1 → unsupplied) DRAINS at the same moment. Options: (a) keep the clamp — physical, but contradicts the recorded ruling; (b) soft leash — no clamp, taut line just cuts supply and the drag pulls back (the rejected-clamp version); (c) clamp with give — a 4-6u elastic band then hold. The new HOSE_REQ set (640/920) was chosen to equal floor-diagonal reach so the leash never fires against a sleeper's wander regardless. Your ruling; the code is untouched until then.

## Log
- 2026-10-04 — RULED by Michael: "stop with stretch but like pulls him a bit so he might go off balance. This should be speed based so the faster he is moving the more exagerated the pull". Build: elastic give over the last ~5 u, then hold; the snap pulls Sal back and can stagger him off balance; pull strength scales with his speed into the line (a slow lean barely tugs, a sprint or swim burst yanks hard). Air cuts only while he strains at full stretch, not the instant the line goes taut. Update the CLAUDE.md leash note to match. Moved decision -> next.

