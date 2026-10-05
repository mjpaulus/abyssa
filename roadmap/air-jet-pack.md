---
title: The air pack — tap to hop, hold to burst, the pump refills the reserve
status: done
tags: player, feel, suit, survival
updated: 2026-10-05
---
Michael: "I also want to change his suit mechanics a bit. Rising takes to long, so lets use the air like a jet pack. Where a tap of the space bar does a short burst and allows him to jump off the surface a bit. If the space bar is held it uses a big burst of air to travel quicker but that air burst is short lived, so we need the pump to catch up his reserve tank so it can be used again. Since his suit is filled he can continue to float to the surface. Swimming forward or back is still too fast and should need the air pack to push him forward faster."

## Detail
Design decisions (orchestrator; Michael can overrule any of these):
- THE AIR PACK is Sal's base ability from the first dive. The crushed submersible's AIR THRUSTER pickup becomes an UPGRADE: a bigger reserve and faster refill. Shift no longer bursts; on the seabed it is still the hurried plod.
- RESERVE TANK: separate from his breathing air. The pump refills it through the hose only while the pump runs (fuel) and the line is not strained; empty = no thrust. HUD: the bottom-left brass RESERVE gauge (was BOTTLE).
- TAP SPACE: a short sharp burst. Off the seabed it is a real hop; in open water a short upward/forward shove.
- HOLD SPACE: a big burst that ramps in, drives him fast where he is steering (camera-relative WASD + look pitch; no WASD = straight up), lasts ~1.2 s from a full reserve, ends on empty or release. The burst blows his dress up, so he keeps floating toward the surface until he dumps air (C/Ctrl).
- SWIMMING SLOWER: the unassisted haul (W/S) is cut to a ponderous pace; real speed needs the pack. Shift no longer boosts off the bottom.
- The pack fires its TAP on the press (no input lag); held past 0.18 s the tap becomes the big burst. A tap pointing up (or a hop) spills a little air into the dress — that is his fine trim now that Space is no longer the inlet valve. Level bursts spill none (no Boyle runaway after a dash).
- Rising: vertical water drag x0.60, so a blown-up dress floats ~9 u/s (was 6.4) and venting with C sinks ~13 u/s.
- Refilling the reserve costs the pump half again its normal fuel burn while it charges (~1.3% of a tank per full refill).
- No pack on the deck, on the ladder or with his helmet out of the water.

## Log
- 2026-10-04 — Started on branch `jetpack`.
- 2026-10-04 — SHIPPED on branch `jetpack` (player.js swim/buoyancy, game.js updateAirPack + HUD, survival.js reserve, tools.js setThrusterJet, audio/sal.js jet roar, diver.js additive burst pose + haul cadence). Measured in a headless Chrome with real CDP key events: seabed tap = a 2.5 u hop (lands ~4.5 s later on a vented trim); held burst straight up peaks ~30 u/s and covers ~37 u while it runs (~1.4 s from a full tank), level bursts ~17-19 u/s and ~25 u; unassisted haul 6.9 u/s mean (was 16.1); zone-0 seabed (-239) to surface 16.9 s with 2 bursts + float, 22.8 s with 1 burst (was 25.4 s holding Space); reserve empty->full 11.1 s on a running pump, no refill with the pump dry; a burst into the end of the hose yanks (str 0.94 at 6.4 u/s closing). See it: dive, tap Space on the seabed to hop, hold Space to burst (WASD steers, none = up), watch the brass RESERVE gauge bottom-left (sheen = the pump charging it, dull red rim = dry), C to vent and drop.
- 2026-10-05 — Merged to main (5b70342), fresh-tab verified. Feel at 60 fps unjudged by Michael; shark escape now harder (swim ~7 u/s, level burst ~19 vs strike 22). Moved wip -> done.
