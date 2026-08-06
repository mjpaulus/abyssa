---
title: THE GLASS — weather & light lab
status: done
tags: weather, water, lighting, lab
updated: 2026-08-05
---
A movable sun, authored dawn/noon/dusk/night/storm palettes, one storm envelope tying surface to subsurface — plus an in-game lab to scrub time and tune it all live.

## Detail
Spec: docs/superpowers/specs/2026-08-05-weather-light-lab-design.md (approved).
Michael's finding: surface and subsurface don't match and aren't dynamic — mechanically the sun never moved (`config.js` `SUN_ELEV_DEG` was a fixed constant) and day/storm were brightness scalars.
- Sun authority: `config.js` `SUN` + `setSun` (air dir, Snell-clamped water dir, god-ray proj). Consumers read per frame — `lighting.js` key/shadow cam, `water.js` sky/glitter/shafts, `terrain.js` caustics.
- Palette: five authored stops (night/dawn/noon/dusk/storm); noon at storm 0 must stay bit-identical to the shipped look (regression anchor).
- Envelope: weather emits `env` {sky, sea, below}, below lags ~8s, converges at steady state.
- Lab: `?lab` flag, scrub/pause/speed on `window.weather`, knobs, copy-constants block.
- Acceptance: Michael scrubs a full day and a storm in the lab, surface and subsurface read as one weather, and either keeps the authored stops or tunes them to taste in the panel.

## Log
- 2026-08-05 — spec approved ("gtg"); sun authority landed in config.js; machinery agent on weather/lighting/water/terrain
- 2026-08-05 — machinery shipped: live sun (dawn 12°/-3.4° → noon 58°/26.6° → dusk 12°/56.6°, night floor 8°), five palette stops in config.js GLASS (noon bit-identical to shipped — regression anchor held to 6dp), env {sky,sea,below} storm envelope (parity 0.966 at steady state), god-ray proj + caustics sun now uniforms. game.js wired: swell reads env.sea, storm current reads env.below
- 2026-08-05 — lab shipped: ?lab panel (time ring scrubber with pause/1x/4x/16x, storm slider riding the real envelope, GLASS.sun + five-stop color wells, copy-the-constants + reset). Verified: gated load, scrub moves the sun, dawn horizon well round-trips within 8-bit, input containment proven. Michael judges with his own eyes at http://localhost:8777/?lab
