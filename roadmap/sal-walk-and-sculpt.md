---
title: Sal: walk, heavy swim, grounded camera, sculpted model
status: done
tags: diver, animation, camera, quality
updated: 2026-10-01
---
Michael, 2026-10-01: "ok focus on Sal's walking...its really weird." / "also make the swimming feel heavier" / "also the camera feels floaty underwater and maybe sals model needs updated with blender".

## Detail
- **Walk** (`diver.js`): the pelvis rode at the bottom of an authored bob the whole stride, so he crouched. A solver now keeps it as high as the loaded boots allow, with the knee near straight (`kCap` 4°, `kMid` 13°). Heel and ball pivots hold still: boot slide on contact went from 37.6 u to 1.2 u over a steady walk, worst penetration from 0.41 m to 3 cm. Toe-off hand-back happens in the air; walk start picks its phase from the real boot. Slope anchors use the flat-foot point and steps shorten on a grade. Arm swing reworked. Mid-stance knee 54° → 23°, cadence 146 → 126–130/min, step / leg length 0.70 → 0.79. `__gait`.
- **Swim** (`player.js`, `diver.js`): added mass `AM_H` 1.55 → 2.40, `AM_V` 1.26 → 1.90. He settles at −0.11 when no key is held, and the burst is computed against the old mass. Kick 0.52 Hz, boots hang, pendulum under the helmet. Time to 90% of cruise 0.9 → 1.4 s, 90° turn 1.0 → 1.9 s.
- **Camera** (`game.js` updateCamera): the follow spring tracks Sal's velocity. The continuous handheld wobble, roll and interest drift are removed; event cues are kept. Distance wobble while swimming 1.12 → 0.15 u, yaw wander while floating 1.9° → 0.06°. `__hh`.
- **Model** (`salSculpt.js`, `salInstall.js`, `assets/sal/`): rigid sculpted segments with overlapping joint gathers, built parametrically from the rig and baked in Blender. Helmet and corselet share a 2048 set; hips and pack, and the limbs, each a 1024 set. Brass is aged; gloves wear differently left and right. Port glass env is 0.10, which fixes a white faceplate that was also present on the procedural Sal. 31 draw calls (was 75), 89k tris, about 20 MB GPU texture memory, 8.3 MB download (KTX2), loads in about 1.4 s off the critical path. `?salproc` A/B, `__salSculpt.state()`. Re-bake with `node tools/blender/build.mjs sal`.

## Log
- 2026-10-01 — merged walk and salsculpt. Verified on main: console clean, 14 lights, sculpt installed with no rig warnings, step counter advances, sleeper fingerprints unchanged.
- Open: cadence is still above target. The ankle pivot sits 0.37 u above the sole (28% of leg length); a lower ankle needs a rig change (longer shin, lower `SOLE_Y`) plus a small boot sculpt change. The left stance knee loads about 10° more than the right. Lantern and knife are still procedural. The swim pendulum and the locked camera need Michael's feel pass at 60 fps.
