---
title: Vent ember strength
status: next
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
- 2026-10-04 — RULED by Michael from the capture page: "Visible from 90, dimmer than the hoard". Capture: far term exactly zero at 90 u, faint point first at ~70, ember 0.09 at 44 u vs hoard lanterns 0.12-0.20. Build: a faint ember findable from ~90 u, always clearly weaker than the hoard lanterns. Moved decision -> next.
