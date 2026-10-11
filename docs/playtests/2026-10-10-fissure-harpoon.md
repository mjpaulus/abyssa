# The fissure and the harpoon — played and recorded (2026-10-11)

Branch `fissure` (spec docs/superpowers/specs/2026-10-10-fissure-and-harpoon-design.md, plan
docs/superpowers/plans/2026-10-10-fissure-and-harpoon.md). Played by the orchestrator through the
game's own input paths: `tools/bench/riteplay.mjs` (Velkath's rite, freeze-step, real keys) and
`tools/bench/play.mjs` (`rec` = in-page MediaRecorder video).

## Videos (/Users/michaelpaulus/sc/.abyssa-wt/video/)

| file | what | result |
|---|---|---|
| fh-velkath-home-rite.webm | home, perfect player: pull the harpoon, she rises, 3 wards from under her | calm 19.5 s, 0 hits, fissure open after |
| fh-velkath-home-opening-descent.webm | from the zone-0 lip: last ward, the jam pours, the light swells, "A RIFT OPENS BELOW.", walk in, sink through the throat into zone 1 | zone 1 entered at y -326 |
| fh-velkath-pallid-rite.webm | Pallid Bank first visit, average player (late reads, aim +-20 deg) | calm 17.9 s, 0 hits, min reserve 0.36 |
| fh-velkath-home-revisit.webm | home revisit: "[E] PRESS THE OLD WOUND", one ward remembered | calm 20.8 s, 0 hits |
| fh-orune-harpoon-grab.webm | Orune woken, grabs at 21 u: "IT HAS YOU. CUT IT — CLICK TO THRUST." -> one thrust | "THE ARM LETS GO." |
| fh-mhor-fissure-opens.webm | zone 2 from 20 u: all wards lit, the last fissure opens | "...THE RIFT WAITS." |

## Fresh-load invariants (HEAD 915f180 + docs)
14 lights; `__lev.fp(0/1/2)` 15ce888c / c938fe6e / 652d0412; `__ridge.fp()` home 3b526986,
zones 1+2 d49d451d; `__safeFailed()` []; `__shaderFailed()` []. Every task's probes green
(fissure-probe 21 modes, harpoon-probe 9 modes, blade-invariants voyage soak flat at ~723 programs).

## Cost (cross-load ABBA vs main 33ab700, cdp host, uncapped, 1512x982, M5 Max, after killing a stale headless Chrome)
| view | main | fissure | delta |
|---|---|---|---|
| z0 (under the raft) | 5.25 ms | 5.46 ms | +0.21 |
| z0b (Velkath's ridge) | 5.21 ms | 5.31 ms | +0.10 |
| z1 (under rift 0) | 4.10 ms | 4.15 ms | +0.05 |
Within the harness's noise floor on a quiet machine (+-0.1-0.3 ms). Two earlier rounds with a
leftover headless Chrome alive read +-1 ms either way and were discarded.

## Observations for Michael (feel / eye)
- Velkath may now be TOO SOFT: perfect and average players both calmed her in under 21 s with 0
  hits (the ritefair pass + the harpoon start under her flank). Ruling is yours.
- From a low lens at the home lip the open fissure's wall light leans faintly pink-lavender
  (it passes B >= R; green is low there). Zone 0 at home and the Shelf lean slightly teal in other views.
- The day surface glow over zone 0 reads as a fleck by day, a soft mound at dusk.
- Zone 1's throat walls are scorched black-grey and plain; how much scorch is your call (WALL_LOOK[1]).
- The thrust reads mostly through the turn, the lantern swing, the lean, a silt puff and a 2 cm lens
  punch from the follow camera; the iron points away from it.
- After Mhor's calm a queued onboarding tip ("FIVE IRON WARDS RIDE ITS HIDE...") can still play.
