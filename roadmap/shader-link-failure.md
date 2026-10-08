---
title: Shader link failure on Metal
status: wip
tags: rendering, bug
updated: 2026-10-08
---
One material's shader sometimes fails to compile on Mac (Metal), so that object silently disappears. Seen after sailing to Pallid Bank and entering zone 1. The game's own checks don't catch shader failures yet.

## Detail
- Error (ANGLE MSL): `no matching function for call to '_uV_GGX_SmithCorrelated'` — ANGLE declared three's `V_GGX_SmithCorrelated(const in float alpha, ...)` with `constant float & _ualpha` (a uniform reference) but a call passes a non-uniform. Material: MeshStandardMaterial, map + emissiveMap, 2 directional / 10 point / 1 hemi lights, 1 dir shadow + 1 point shadow, 1 clipping plane (the refraction pass variant), water fog uniforms; name empty.
- Seen 2026-10-08 on main ca3c4a0 in the pane (fresh load -> play -> __chart.arrive(1) -> gotoZone(1)); the sweep agent saw a sea-pen variant fail similarly once. Not reproduced on every load.
- Acceptance: (1) a shader-failure hook (renderer.debug.onShaderError or checkShaderErrors path) records failures into a debug surface and they become part of the standard invariants; (2) the trigger is identified and worked around so the failing variants link on every load and route; (3) a soak (all zones x all sites, both refraction states) shows zero link failures.

## Log
- 2026-10-08 — created from the sweep merge check.
