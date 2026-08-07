---
title: three.js upgrade (r160 → current)
status: decision
tags: infra, risk
updated: 2026-08-07
---
We ship on r160 (Dec 2023); three.js is at r184+ with production WebGPU since r171 and a node-based post pipeline since r183. An upgrade is its own careful round, not a version bump.

## Detail
Why it's risky here: the per-channel Beer-Lambert fog is patched into `THREE.ShaderChunk` globally (`world/water.js`), and most materials do `onBeforeCompile` surgery keyed to r160's exact chunk names — routine upstream chunk renames break the game's look silently. The CDN `postprocessing` + `n8ao` libs must stay compatible with the chosen core.
Approach when taken: bump one importmap entry on a branch, run the existing anchors (terrain fingerprints, calm-noon ambient probe, program-count soak, refraction A/B via P key), grep three's migration guide r160→target for every chunk name we patch.
WebGPU is a separate decision from the version bump — do not conflate.
- Acceptance: game visually identical on the new core (anchors green), or a written list of what changed and Michael's sign-off on each.

## What r184 actually cost us
The feared break did NOT happen: every chunk name we patch (`common`, `begin_vertex`,
`beginnormal_vertex`, `color_fragment`, `emissivemap_fragment`, `roughnessmap_fragment`,
`normal_fragment_begin`, `normal_fragment_maps`, `project_vertex`, `worldpos_vertex`,
`tonemapping_fragment`, `colorspace_fragment`) and all four fog chunks survive r161→r184
unrenamed. A boot-time assertion pass (temporary `String.prototype.replace` wrapper that
logs any `#include <...>` search string absent from its subject) reported **zero misses**
across every material in the game. That wrapper is dev scaffolding and was removed before
commit — recreate it in one paste for the next bump; it is the only way to see a failed
`.replace`, which is otherwise silent.

Three forced changes, all mechanical:
- `PCFSoftShadowMap` was deprecated for `WebGLRenderer` in r182 and three now silently
  substitutes `PCFShadowMap`. `core.js` names the real one. **This is the one thing that
  is not bit-identical** — the raft's sun shadow (the only shadow in the game, an 18-unit
  ortho box at the origin) has a harder edge. Nothing else in the frame casts.
- `postprocessing` 6.35.3 → 6.39.4 (its peer range excluded three ≥ 0.181 until 6.39.1).
  `n8ao` stays at 1.9.4 — its peer range is `three >= 0.137` and it loaded clean.
- The DRACO decoder URLs in `lib/assets.js` and `entities/helmetSwap.js` were hard-pinned
  to `three@0.160.0` outside the importmap. Bumped to match.

Watch-items that are noise so far but should meet Michael's eye:
- r183 moved `RoomEnvironment`'s geometry, so the IBL baked in `core.js` differs. It only
  feeds specular reflection on brass/metal; nothing measurable showed, but it is the one
  path where "identical numbers" cannot prove "identical look".
- `THREE.Clock` is deprecated in favour of `Timer` (warning only; `Timer` has different
  page-visibility semantics, and `samplePerf` already distrusts the clamped delta — leave
  it alone until it actually breaks).
- `DRACOLoader.setDecoderConfig({type:'js'})` is deprecated; three will be WASM-only.

## Log
- 2026-08-06 — captured from Michael's note that a new version exists; parked while SKY & WIND is in flight
- 2026-08-06 — Michael: "upgrade threejs first then tackle A" (puff-cluster clouds wait on this). Upgrade agent launched on a branch
- 2026-08-07 — branch `three-upgrade`: r160 → r184 done and anchored. Terrain fingerprints
  bit-identical (home `8a5688da`, Pallid `64d9c4a5` on this session's probe), calm-noon fog
  `[0.055,0.135,0.112]` / density `0.00764925` and every light intensity+colour identical to
  4 decimals, boot programs 191 / geometries 146 identical, reseed soak FLATTER than main
  (353/164 constant vs main's 356→360 / 164→168), zero GL errors with refraction on and off,
  P-bypass clean, volumetrics present, full quality after 5 min, frame time 20.4 ms vs main's
  23.1 ms. **Needs Michael:** the deprecated soft shadow map (above) is a real if small look
  change, and the merge is his call. NOT merged.
