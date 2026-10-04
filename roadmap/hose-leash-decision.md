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

- 2026-10-04 — SHIPPED on branch `leash` (tether.js leashStep; diver.js diverYank; player.js stagger; game.js camYank; audio/sal.js hoseYank; survival.strain). The dead wall is gone: the last 5 u of hose give (a spring off the bottom, a speed drag on the boots), full stretch is a firm hold resolved on velocity at time of impact (end-of-frame overshoot measured 0.000 in every run, no jitter), and arriving at the hold yanks him by his closing speed — str = (v/7)^0.8. Measured: a lean 0.09 u/s -> str 0.03, a 3 deg tug, no stagger; a walk 0.65-1.0 u/s -> str 0.15-0.22, 7 deg rock back, 0.5 s recovery; a swim/burst/flung/dragged arrival 7-17 u/s -> str 1, a ~53 deg tumble righting over 1.5 s, 1.6-1.8 u pulled back. The hose twangs (a wave running up it), the lens jolts 3-19 cm, a rubber creak-thump plus a bonnet knock on hard ones. Air pinches off only while he presses on the hold (~0.3 s in), returns ~0.5 s after he stops — never when the line merely comes taut. See it: give Sal a short line from the console (`survival.hose = __leash.r + 6` at the seabed), walk into it, then swim/burst into it; `__leash.last` reads the snap.
