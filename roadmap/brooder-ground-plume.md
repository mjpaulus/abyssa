---
title: Velkath on the ground, and the sand plume
status: done
tags: creatures, gameplay, brooder, particles
updated: 2026-10-03
---
Michael, 2026-10-03: "so it seems like the crab creature is sinking into the sand and passes through other objects, when its claw smacks down it goes beyond the floor. also when it smacks down we should plume the sand, this could be used to sals advantage to rush to get under the crab."
Velkath now stands on the seabed, walks round rocks and wrecks, and slams her claw onto the surface instead of through it. Every hammer blow throws up a heavy cloud of silt. While Sal is inside or behind that cloud she loses him: she keeps striking where she last saw him and her eyes search. That is his chance to rush in under her to the wards. Branch brooder3, not merged.

## Detail
Files: `src/entities/sleeper/brooderGround.js` (new), `plume.js` (new), `brooder.js`, and one wiring line in `game.js` (the plume's `stirPulse`).

Root causes, measured before the fix (main, zone 0, standing and hammering):
- Her body sank up to 5.4 u into the floor. Her height came from the mean of her planted feet, so a hump between them came up through her belly.
- The crusher went up to 15.6 u under the floor. The arm pose is pure joint angles and had no notion of where the floor is.
- On steep ground her feet floated up to 3.6 u off the floor: steps were placed out of the leg's reach and the IK let the foot slide.
- She ignored every collider in the world.
- A dead branch: the hammer's impact test `impT === 0` never fired, because the recoil branch advanced `impT` in the same frame. The blow's dust, body drop and quake had never run.

Levers:
- Ground contact (`brooderGround.js`):
  - A per-frame near list over rockColliders, wreckColliders, ventColliders and propColliders.
  - The SOLE: the lowest shell vertex per cell of an 11x11 grid, plus the outermost low vertex on 48 bearings. It is a hard floor once she rises (`SOLE_CLR` 0.35 u). Asleep she keeps the approved bedded ridge; the floor comes on through the heave.
  - Her support is a least-squares ground plane over her footprint.
  - Feet land on rock tops, beside hulls, and inside the leg's reach (`reachFoot`). A swing arc rides over humps.
  - Planted dactyls lift by `0.45 x (slope - 0.3)`.
- Collision: rocks taller than `BLOCK_H` (0.42 R) and all wrecks are pushed out (the body is a circle of radius `BODY_RH` 0.86 R) and steered round with tangent steering. If she is boxed in (two side flips with no headway) she climbs, and stays climbing until she is off the rock.
- Claw: hull samples (7 bins x 8 extremes per piece; the merus root behind the joint is excluded). The shoulder lifts first (up to `ROOT_MAX` 0.45 rad), then the elbow (up to 1.3 rad, with its sign found by trial). What is left lifts her front (`frontUp`, up to 0.35 rad). A blow that arrives at the surface kicks back through an underdamped spring on the shoulder (+2.6 rad/s): it slams and rebounds. The search is frame-coherent.
- Plume (`plume.js`):
  - Drawn as one instanced draw of 448 camera-facing quads. Motion is analytic in the vertex shader; the CPU writes a quad only when it is born.
  - A hammer cloud is 38 quads with a 4.6-6.0 s life and grows to 9-13 u. It bursts out to about 13 u and climbs about 7 u, then sinks at 0.3 u/s.
  - A footfall cloud is 7 quads with a 2.4-3.4 s life.
  - It is lit by the scene's own ambient, hemisphere and key lights divided by PI, plus the lantern slot. The water's optics (the patched fog chunk) run per vertex, as c*T+S.
  - A full-screen veil takes over when the lens is inside a cloud.
  - Debug: `__plume.state()` and `__plume.tune` (`off` is the render A/B).
- Sight (`brooder.js` `SIGHT`): her optical depth is measured along the line from her head to Sal's chest. The density model is one ellipsoid per plume (the radius grows from 2 to 12.5 u, it thins over time, and its envelope matches the quads).
  - She loses Sal above 1.0 and finds him again after 0.6 s below 0.55, or on shell contact, or when a ward is lit.
  - While blind she faces and strikes at his last seen spot, stops stalking, and searches with quick, wide eye saccades. After 7 s she gives the spot up and sweeps her front across the cloud.
  - A one-time line: SAND HANGS IN THE WATER. SHE CANNOT SEE YOU.
- `ev.plume` / `plumeX/Y/Z` feed `stirPulse` in `game.js`. The existing `ev.quake` (now firing at impact) drives camera shake, and audio's hammer edge is unchanged.

Acceptance and numbers (zone 0, same protocol before and after: wake with Sal 28 u ahead, sample every 0.2 s):
- Standing and hammering, main → branch:
  - Body under the floor: 5.39 → -0.29 u (it never touches).
  - Claws under the floor: 15.61 → 0.13 u.
  - Planted feet under the floor: 0.57 → 0.27 u (the dactyl tip in the silt).
- Facing up the rift-rim crest: claws ≤ 0.28 and planted feet ≤ 0.91 (≤ 0.4 after the slope lift).
- Walking through a boulder field: body ≤ -0.24, claws ≤ 0.31, planted feet ≤ 0.32, and her feet landed on rock tops. She kept ≥ 9 u clear of the zone-0 skiff while walking past it.
- Asleep and mid-rise she is bedded by design. Her body is still up to 8 u in the dune during the rise, as she climbs out of it.
- End-to-end with real input, on the merged tree:
  1. KeyE takes an egg and she wakes.
  2. Her hammer lands at 2.15 R ahead and the cloud rises. With Sal at 2.6 R, tau rises to 1.3-2.5 and she loses him; the line shows.
  3. Sal rushes in with W and Shift (plus Space/C to stay low). She stays blind for ~1.9 s while her aim error grows to 19 u.
  4. She finds him again at about 1.3 R, and he is under her within 1 s, unhit.
  5. A ward lights 2.4 s later.
- Plume cost: plume-only draw, timer query, no depth rejection, 3-4 live clouds filling the view: 0.195 ms per internal megapixel (about 0.9 ms worst case at 1080p x1.5 internal). A paired whole-frame `__gpu` A/B (6 pairs) gave a median of +0.5 ms, but the noise was ±2 ms: the machine was shared with other agents and the pane was hidden at about 4 fps.
- Her CPU update is 0.18 ms median standing (claw clamp 0.11, sole 0.03).
- Serpent fingerprints are unchanged at 15ce888c / c938fe6e / 652d0412, and the console is clean in a fresh tab.

Open:
- Tune the plume window with Michael's hands: the lose/find thresholds, the 7 s give-up, and the cloud size.
- On the knife-edge rift-rim crest, a leg's shaft can cross the crest face. One run showed a planted dactyl up to ~6 u into the crest for about 2 s while her body was propped 6.8 u.
- The veil shows the post-fx edge line through the murk.
- Her mid-rise burial is by design.

## Log
2026-10-03: Built on branch brooder3 (8612a2a, 6a6a47e, 114cf54, dbb3c45, merge of main 75e3745), verified live as above. Captures are in scratchpad/brooder3cap/: S_side_strip.jpg (hammer from the side: claw on the surface, cloud billowing), G_game_strip.jpg (game distance), g_game_pinned_n38.jpg, h_pair.jpg (inside / edge of the cloud), main_sleep_side.jpg vs a_sleep_side.jpg.
- 2026-10-03 — merged to main; verified in a fresh tab (woke her, zone tour clean, 14 lights, fingerprints unchanged). Deviation to confirm with Michael: asleep and mid-rise she is still bedded in the dune on purpose (the approved ridge look); every awake state sits on the floor. Open: a leg can cut the knife-edge rift-rim crest; her steering climbs over boulders rather than pathfinding; plume tuning (blind threshold 1.0, regain 0.55 for 0.6 s, gives up after 7 s) needs a human hand.
