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
