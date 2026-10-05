---
title: The air pack — tap to hop, hold to burst, the pump refills the reserve
status: wip
tags: player, feel, suit, survival
updated: 2026-10-04
---
Michael: "I also want to change his suit mechanics a bit. Rising takes to long, so lets use the air like a jet pack. Where a tap of the space bar does a short burst and allows him to jump off the surface a bit. If the space bar is held it uses a big burst of air to travel quicker but that air burst is short lived, so we need the pump to catch up his reserve tank so it can be used again. Since his suit is filled he can continue to float to the surface. Swimming forward or back is still too fast and should need the air pack to push him forward faster."

## Detail
Design decisions (orchestrator; Michael can overrule any of these):
- THE AIR PACK is Sal's base ability from the first dive. The crushed submersible's AIR THRUSTER pickup becomes an UPGRADE: a bigger reserve and faster refill. Shift no longer bursts; on the seabed it is still the hurried plod.
- RESERVE TANK: separate from his breathing air. The pump refills it through the hose only while the pump runs (fuel) and the line is not strained; empty = no thrust. HUD: the bottom-left brass RESERVE gauge (was BOTTLE).
- TAP SPACE: a short sharp burst. Off the seabed it is a real hop; in open water a short upward/forward shove.
- HOLD SPACE: a big burst that ramps in, drives him fast where he is steering (camera-relative WASD + look pitch; no WASD = straight up), lasts ~1.2 s from a full reserve, ends on empty or release. The burst blows his dress up, so he keeps floating toward the surface until he dumps air (C/Ctrl).
- SWIMMING SLOWER: the unassisted haul (W/S) is cut to a ponderous pace; real speed needs the pack.

## Log
- 2026-10-04 — Started on branch `jetpack`.
