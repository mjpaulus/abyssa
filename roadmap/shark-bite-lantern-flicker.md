---
title: Shark Bite Lantern Flicker + HUD Dip
status: backlog
tags: predators, lantern, hud
updated: 2026-08-05
---
When the shark bites Sal, the lantern should flicker and the HUD light meter should visibly dip, so a hit reads as a hit beyond the oxygen loss and camera shake.

## Detail
Currently a bite only drains oxygen and shakes the camera — see `src/world/predators.js` where the strike FSM raises `ev.bite`, consumed in `src/game.js`'s `updatePredators` event block (`pev.bite`), which currently only reduces `survival.oxygen`. There is no lantern or HUD reaction to a bite specifically.

Levers in `src/game.js`:
- `player.light` is the light meter value (0–1), read by `setLight(player.light)` and by `$lightfill.style.transform = scaleX(...)` for the HUD bar.
- `lanternLight.intensity` is already flicker-driven each frame from `player.light` and sine terms — a bite could add a transient extra dip/flicker term keyed off a timestamp or a decaying multiplier.
- `pev.lightSteal` already shows the precedent for a predator event draining `player.light` over time (`player.light = Math.max(0, player.light - pev.lightSteal * dt)`), so a bite-triggered dip can follow the same pattern: on `pev.bite`, apply an immediate partial drop to `player.light` (and/or a short flicker envelope on `lanternLight.intensity`) that decays back over ~0.5-1s.

Rejected/undecided: exact magnitude and decay curve not yet designed — needs a quick pass to avoid it reading as a second oxygen penalty rather than a lighting effect.

Acceptance criteria: on `ev.bite`/`pev.bite`, the lantern visibly flickers (extra intensity dip beyond the ambient sine flicker) and `$lightfill` HUD bar visibly dips and recovers, distinct from and in addition to the existing oxygen-loss and camera-shake feedback.

## Log
- 2026-08-05 — created
