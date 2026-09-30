# The sculpt pipeline (tools/blender)

Every creature asset is **generated**: shapes are signed-distance-field specs written in
code, meshed and painted by `src/lib/sculpt.js`, then baked high-to-low by headless
Blender. Nothing is hand-modelled; everything rebuilds from source with fixed seeds.

```
node tools/blender/build.mjs <creature> [--sets body,limbs] [--pieces a,b] [--skip-export]
```

`<creature>` names `src/entities/sleeper/<creature>Sculpt.js`, which exports
`pipeline()`. Outputs land in its `out` dir (e.g. `assets/sleepers/brooder/`):
`<name>.glb` (every low mesh: position, normal, uv, MikkTSpace tangent; no materials),
`<set>_albedo.webp` (sRGB), `<set>_normal.webp` (tangent space, OpenGL +Y),
`<set>_orm.webp` (R = AO, G = roughness, half res), `<name>.json` (meta, probes, stats).
The game loads them with `src/lib/assets.js` `loadSculpted(base, name)`, which never
throws — a missing asset leaves the caller's procedural build in place.

Blender: `/Applications/Blender.app/Contents/MacOS/Blender` (5.2 LTS; `BLENDER=` overrides).

## Stages, and who does what (each choice measured)

1. **export_hi.mjs (node, sculpt.js)** — per piece:
   - HIGH: the full-detail SDF (every displacement layer) meshed by dual contouring at
     `hi.h` (the body: ~2M tris), every vertex painted by the spec's `paint` (albedo in
     RGB, roughness in alpha, SDF-marched AO and curvature folded in) → `<piece>_hi.ply`.
   - LOW: the mesh field (layers flagged `bake: true` left out), DC at `lo.h`, QEM-
     decimated to `lo.tris`, then every piece of a texture SET charted together
     (axis charts on smoothed normals, fold/overlap eviction, crumb merging) →
     `<piece>_lo.ply` with UVs.
   - Why JS and not Blender for the low's UVs: Smart UV Project on the bumpy decimated
     shell produced thousands of islands at **0.20** atlas coverage; the JS charts are
     large and fold-free.
2. **bake.py (Blender, Cycles on the GPU)** — per set:
   - repacks the JS charts with Blender's concave island packer (**0.27 → 0.50**
     coverage on the shell; 0.39 → 0.50 on the limbs);
   - bakes each piece selected-to-active through a cage: NORMAL (tangent), albedo and
     roughness (EMIT of the painted high poly's vertex colour/alpha), AO (64 spp);
   - composes ORM, writes WebP, exports the .glb with tangents.
   Measured on an M5 Max: body 2M→70k + limbs (14 pieces) in ~75 s.

Why the SDF stays in JS: it is the reusable part (the same specs preview in-browser in
`sculptlab.html?lab&job=...#preview`, run in node offline, and can run at runtime in a
worker for cheap things), dual contouring there is fast (a 2M-tri high in seconds), and
DC measured better than surface nets for crisp plate edges at equal cost (mean vertex
distance error 0.015h vs 0.029h, p95 normal error 13.1 vs 22.9 degrees at h = 0.02).

## Writing a creature (`<name>Sculpt.js`)

```js
export function pipeline() {
  return {
    name, out: 'assets/sleepers/<name>',
    sets: { body: { size: 2048, gutter: 6, aoDist: 0.1, aoSamples: 64 }, ... },
    pieces: [{ name, set, sdf, hi: { h }, lo: { h, tris, err? }, paint, kEps?, ao?, cage?, ray? }],
    meta: { ...anything the runtime rig needs (hinges, rest lengths) },
    probes: [{ name, part, x0, x1, z0, z1, n }]   // top-surface heights for seating props
  };
}
```

- Sculpt each piece in the frame of the joint it rides (pivot at the origin), at true
  size, so the runtime rig swaps geometry without new transforms.
- `hi.h` sets the detail the bake can see; `lo.h`/`lo.tris` the game mesh. Put fine
  displacement (`barn`, `pits`, grain, strata) on `bake: true` layers: it costs texels,
  not triangles, and keeps the low's charts clean.
- `cage` should exceed the largest high/low gap (the bake-only amplitude); `ray` a few
  times that.
- Coordinates: game frame (+Y up, +Z front). The PLY writer swizzles to Blender's and
  the glTF exporter's +Y-up conversion returns them exactly.
- Look-dev: `sculptlab.html?lab&job=./src/entities/sleeper/<name>Sculpt.js%23preview&p=<pieces>`
  (in-browser preview bake, seconds) and `sculptlab.html?lab&asset=<name>` (the shipped
  Blender output under neutral light).

Build scratch (`.build/`) is gitignored; the outputs under `assets/` are committed.
