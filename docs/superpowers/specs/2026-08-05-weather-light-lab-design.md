# THE GLASS — weather & light lab (design)

Approved by Michael 2026-08-05 ("A and build missing machinery" / "gtg").

## Problem

Surface and subsurface weather don't match and aren't dynamic. Mechanically: the sun
never moves (`SUN_ELEV_DEG = 58` fixed), day/night is a brightness scalar over a
two-point color lerp, and storm mostly dims rather than changing character. The five
weather couplings in game.js are hand-tuned scalars with no shared envelope.

## Decision

Build the missing machinery (movable sun, palette keyframes, one storm envelope) AND
an in-game lab (`?lab`) to judge and tune it live. The sandbox is the game itself —
option A from the brainstorm; a standalone page would lie about interactions.

## Machinery

1. **Movable sun.** The shared sun vector becomes a function of time-of-day:
   elevation swings low→high→low, azimuth drifts ~120° across the day. Source-level
   change; consumers (lighting key + shadow cam, sky disc, glitter path, god-ray
   offset, terrain caustics) already share one vector. Underwater incidence stays
   clamped at Snell's 41.4° so depth never breaks.
2. **Palette keyframes.** Five authored stops — night, dawn, noon, dusk, storm —
   each: sky color, SURF_LIGHT, fog/ambient tint, desaturation. Blend picked by
   `day` + sun azimuth; storm cross-fades to its stop. Pure data.
3. **Storm envelope.** All couplings read one eased envelope (`wx.sky`, `wx.sea`,
   `wx.below`) so surface and subsurface provably move together.

## The lab

`?lab` URL flag, zero cost when absent. Panel over the running game:
- time-of-day scrub (full circle), pause/play/4× on `window.weather.set/advance`
- storm slider with real easing + lightning test
- knobs grouped surface/subsurface: sun elevation range + azimuth sweep, 5 palette
  stops (color wells), murk gain, swell, desaturation
- "copy constants" prints the exact config block + downloads a JSON snapshot
- never touches the save; closing returns the real clock

## Out of scope

Wind direction / anisotropic waves, per-site weather, rain rework, HUD changes.

## Verification

- Regression anchor: lab closed + default constants reproduce today's noon within
  tolerance (screenshot A/B + ambient probe).
- Scrub soak: no per-frame allocation, no program recompiles (palette blending is
  uniform writes only).
- Storm parity probe: at storm 1.0, surface and subsurface envelope values move on
  the same eased curve.

## Amendment — SKY & WIND, the west-coast round (approved 2026-08-05)

Michael's lab verdict: range flat — no blue sky, no clouds, storms subtle, no wind.
Target: west-coast marine days ("early morning fog, sun burns the fog off, pop up
ocean storm, clearing weather into a big beautiful sunset, big night time moon.
This is not a rinse and repeat every day.")

Four work items (roadmap cards): day hands + wind (weather.js, orchestrator);
clouds/marine fog/moon (water.js sky + air fog regime, agent); wind on the water
(anisotropic waves, whitecaps, depth-decaying current, agent, serialized behind the
sky card); lab v2 (day-hand readout + reroll + knobs, cheap agent last).
Regression: calm noon anchored EXCEPT a sanctioned bluer zenith; underwater deep
untouched; determinism (pure function of t + day index) everywhere.
