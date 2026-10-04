---
title: Vent ember strength
status: decision
tags: zone 1
updated: 2026-10-04
---
The ember halo reads to 90 units — zone 1's wayfinding. Too shy or too loud on a real monitor?

## Detail
`src/world/vents.js` update loop: far term `far * 0.22`, near bore-fire `near^2 * 0.30`, halo swell `0.9 + dist * 0.075`.
The vent light gate is linear over 34 units (camera trails the diver by ~10).

- Acceptance: Michael approaches a hot vent from 90 units out at night and rules on the far and near coefficients.

## Log
- 2026-08-05 — created at boiler-room ship (cf0b51e)
- 2026-10-04 — Michael chose to judge from the side-by-side capture page: a zone-1 vent approach at 90 / 45 / 15 u alongside Orune's hoard glow (now zone 1's far beacon). Stays in decision until he rules from it.
- 2026-10-04 — Michael ruled: "Visible from 90, dimmer than the hoard". Shipped on branch octfix (src/world/vents.js): the far term runs to 130 u instead of ending AT 90 (opacity ~0.05 at 90, ~0.08 at 70, ~0.11 at 45, measured live), the halo swell is tighter past 25 u (a 4.4-unit point at 90, was a 7.6-unit smear), colour 0xff6a2c amber-red ember (fog-off, so that is what reaches the screen); near bore-fire term and the shared vent light unchanged. Always well under the hoard lanterns (0.18-0.33 at 30-55 u, brighter amber). See it: dive to zone 1 at night and walk at a hot vent from 90 u; frames scratchpad/wt/shots/octfix-SHEET-5-vent-ember.png and -SHEET-2-hoard-glow.png.
