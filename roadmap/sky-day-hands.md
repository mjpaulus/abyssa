---
title: SKY & WIND — day hands
status: done
tags: weather, sky
updated: 2026-08-05
---
Each 12-minute day draws a seeded hand — fog morning or clear, storm dice, cloud regime, sunset drama, moon — so no two days repeat. Wind becomes a first-class weather output.

## Detail
Michael's target: west-coast marine days — "Early morning fog, sun burns the fog off. pop up ocean storm, clearing weather into a big beautiful sunset, big night time moon. This is not a rinse and repeat every day."
- `systems/weather.js` — per-day hand from a day-index-seeded mulberry32 stream (pure function of t; replays identically, day 3 differs from day 4): fogDense/fogBurnHour, cloudRegime, storm dice (most days NONE — the squall is an event), sunsetDrama (fed by post-storm clearing), moonK/phase.
- Wind: `wind {speed, dir}` in the state — leads storms, gusts, calms overnight, direction drifts; a storm locks it.
- Consumers read the hand via the state object + GLASS; contract lands before the sky/water agents build on it.
- Acceptance: state exposes hand + wind; two consecutive days provably differ; storm days are a minority; deterministic replay holds.

## Log
- 2026-08-05 — round approved after Michael's lab verdict (flat range); cards cut, contract first
- 2026-08-06 — shipped: hand {fog, fogBurn, clouds, cloudTex, stormDay/At/Len/Peak, sunsetDrama, moonK, moonPhase, windBase, windDir0, windLead} dealt per dayIndex; wind {speed, dir} leads storms by 60-90s and locks dir mid-storm; storms 33.00f 200 sampled days, post-storm sunsets average drama 0.772 vs 0.360; deterministic across reloads; env parity 1.0000. Dev: weather.day(n)/peek(n)/hand()/wind()
