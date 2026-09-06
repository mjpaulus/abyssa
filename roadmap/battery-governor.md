---
title: Battery governor (frame cap)
status: done
tags: perf, engine
updated: 2026-09-06
---
Michael: sessions are eating CPU and battery; "need to be able to work on stuff without being plugged in." Measured: the Claude/agent processes themselves are negligible (~5 CPU-minutes over 12 h). The cost is the GAME — an uncapped requestAnimationFrame loop rendering the full HalfFloat chain at the display's 120 Hz, including on the title screen, in every agent's verification tab and in the lab. Several live WebGL surfaces at once during parallel rounds is what pins WindowServer and the GPU.

## Detail
A frame governor in game.js frame(): `GLASS.power.cap` fps (60) while the sea has the helm; `GLASS.power.idle` (30) on the title, when the window is unfocused, or paused-unlocked; no frame at all while document.hidden. Skipped frames don't call clock.getDelta, so the skipped time accumulates into the next dt (still clamped 50 ms) — physics and weather see the same seconds. Phase carried so a 60 cap on 120 Hz is a steady every-other frame. The perf judge (34 fps bar, degrade ladder) is only fed when the loop runs ≥45 fps or uncapped, so a low cap can never shed volumetrics/AO. Lab group "power"; `__power.state()/set(cap, idle)`. 0 = uncapped for profiling. Agent workflow rule alongside it: close verification tabs when idle; fewer parallel browser rounds on battery.

## Log
2026-09-06: Shipped. Measured live (rendered frames, not rAF ticks): title 30 fps, play unfocused 30, play focused 60, hidden 0, `__power.set(0,0)` restores the old 120. Perf judge untouched (stage 0), console clean. Note for agents: the in-app browser pane never reports document.hasFocus(), so a verification tab runs at the idle rate — set `__power.set(0,0)` before any GPU timing, and close tabs when done. Awaiting Michael's feel on battery.
