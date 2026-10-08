---
title: Sal has no swim stroke moving forward or back
status: wip
tags: player, animation, bug
updated: 2026-10-08
---
Michael (60 fps playtest, 2026-10-08): "Sal has no swimming animation when moving forward or backward."

## Detail
- Off the bottom Sal HAULS: a head-up, two-handed, weighted-suit stroke (docs/superpowers/specs/sal-weighted-suit-motion.md). diver.js publishes player.swimP (stroke phase); player.js shapes the forward thrust on it (kickThrust).
- Suspects: the air pack (haul 16 -> ~6.9 u/s, cadence slowed to match, burst/float states), sea legs, salfix leg IK, the sweep's burst-lean layer and the post-burst float pose.
- Method: bisect a64468f (before the air pack) against main with the same real-input script (CDP keydown/keyup; W 6 s then S 6 s; open mid-water, just off the bottom, after a burst+release, after a C vent), entered via ?playtest Alt+3.
- Acceptance: a visible, weighty two-handed haul whenever he is driven forward or backward in the water (backward a reverse pull, not a mirrored forward stroke); cadence and amplitude read at ~7 u/s; blends with float, burst lean, post-burst float; frame strips forward/backward + the before strip.

## Log
- 2026-10-08 — Started on branch `swimfix`.
- 2026-10-04 — FIXED on branch `swimfix`. ROOT CAUSE (bisect a64468f vs main, same real-key CDP script, Alt+3 entry on main): the haul's pose was sized and paced by SPEED (drive = flat x 0.09, saturating at ~11 u/s; cadence 0.17 + 0.012 x speed), and the air pack (f10e0a8/8a91316) cut the haul 16 -> ~7 u/s without re-keying the pose. Forward: stroke 0.40 -> 0.25 Hz, shoulder swing 1.29 -> 0.81 rad p2p (only 2x the idle hang's 0.4), one sweep every 4 s. Backward (~2.5 u/s): drive ~0.15-0.26, i.e. the idle scull plus a static arm bias, arms hanging. Single-variable proof: scaling only the pose's speed input by 16/6.9 on main restored the old stroke exactly (1.28 rad, 0.39 Hz) at the same 6.2 u/s. Sea legs, salfix IK, burst lean and the post-burst float were cleared (burstW/lean back to 0 within the hold; nothing else touches the swim arms). FIX: player.js publishes player.haulZ (+1 W / -1 S, x ctrl, 0 grounded); diver.js sizes and paces the stroke on an effort envelope of it (full sweep at 0.38 Hz hauling, a time-keyed first-stroke commitment), and backing is its own stroke, the BACK-PULL (gather at the chest, push forward and out, both arms scull out wide, recover; lantern hand pushing too), with the back thrust shaped on its push. Cruise unchanged (paired with main, same spot, whole strokes: haul 7.22 vs 7.20 u/s, backing 3.14 vs 3.08). See it: ?playtest, Alt+3, Space-burst off the bottom (or hang), hold W, then S. Proof strips: .abyssa-wt/shots/swimfix-{before-main,after}-{forward,backward,floatW,floatS}.png. Probe: tools/bench/swim-probe (README in drive.mjs header), window.__swimState / __haul.
