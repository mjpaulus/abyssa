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

3. **ktx2.mjs (node, optional)** — when the creature's `pipeline()` sets
   `compress: { tex: 'ktx2' }`, bake.py leaves raw RGBA8 dumps in the build dir and this
   writes `<set>_albedo.ktx2` (BC1, sRGB) and `<set>_normal.ktx2` (BC5: normal XY, the
   shader rebuilds Z) with full mip chains (albedo filtered in linear light, normals
   renormalised), zstd-supercompressed. Encoders are ours (principal-axis BC1 + two
   least-squares passes; min/max BC4/BC5): no basisu/toktx. ORM stays WebP (BC1 on three
   independent channels measured RMSE 10-16/255). The WebP maps are always written too:
   `assets.js` uses the KTX2 only where the GPU has S3TC(+sRGB)+RGTC, and falls back per
   map (and under `?noktx`).
   Measured on Velkath: GPU texture memory 96 MB -> ~27 MB; the first-render upload stall
   (WebP decode + mip generation on the main thread) 350-660 ms -> ~20 ms; download
   4.7 MB of WebP -> 10.9 MB of KTX2+ORM WebP (the BC5 normals are high-entropy).

Additive outputs (brooder2), all backward compatible — a runtime that ignores them sees
exactly the old asset:
- **ORM.B = cavity** (0.5 flat, > 0.5 concave, < 0.5 convex), from the baked normal map's
  divergence at two scales; the .json marks it `sets.<s>.ormB = 'cavity'`.
  `src/lib/microDetail.js` masks its detail layer with it.
- `compress: { mesh: 'draco' }` exports the .glb Draco-compressed (positions 14 bits,
  UVs 14, normals 10); `assets.js` decodes it with three's DRACOLoader (decoder from the
  importmap's three/addons). Velkath: 5.4 MB -> 1.16 MB.

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

## Additive extensions (sculpt2: Orune + Mhor)

All optional; a creature that uses none of them builds exactly as before.

- **Emissive** — a piece may carry `emit: S => 0..1` (S: x, y, z, nx, ny, nz of each high
  vertex). export_hi writes a second painted high (`<piece>_hiE.ply`); bake.py bakes it
  (EMIT, through the same cage) into the **ORM's blue** channel, which used to be 0. The
  game reads it by patching `emissivemap_fragment` to `emissiveColor.bbb` with the ORM as
  the emissive map (gated `smoothstep(0.08, 0.3, b)` so half-res chart edges never glow).
- **Paint mask `['fn', S => 0..1]`** (sculpt.js) — a creature's own analytic placement
  (photophore stations, lens rims) usable in any paint layer.
- **Strips** (`strip.mjs`) — `pipeline().strips: [{ name, W, H, Lu, Lv, field, paint, ao }]`:
  tileable heightfield bakes for geometry that must stay procedural (verlet arm tubes).
  u along the tube, v once round it; exactly periodic by construction. Normals are in the
  frame three derives from the mesh uv (tangent x = +u, y = +v; no tangent attribute),
  maps load flipY = false, ORM as above. Written as `<strip>_albedo/normal/orm.webp` and
  listed in the meta's `sets` with `strip: true` (the game sets RepeatWrapping).
  Orune's arm strip keys u to the sucker stations (one tile = 4 pairs), Mhor's arm strip
  to his (7 pairs), his tentacles are conformal (du = ds len / (Lu r)).
- `meta` values may be getters (JSON.stringify evaluates them at export): Orune's caught
  lanterns are seated there by marching the full SDF, so the game does no raycasts.

## Sal (salsculpt): the hero diver through the same pipeline

`node tools/blender/build.mjs sal` — `src/entities/salSculpt.js` (export_hi looks in
`src/entities/` when there is no sleeper of that name). Outputs `assets/sal/` (3 sets at
2048: helm / torso / limbs; Draco + KTX2). Additive pieces it uses:
- `{ t: 'fn', bb, f }` leaf node and `{ type: 'fn', fn, amp }` displacement layer in sculpt.js
  (analytic lathes, fold-modulated limb segments, bake-only creases);
- `shadeVertices(..., { state: true })` returns each vertex's paint state, so the emit mask
  sees material ids/curvature/AO; Sal's emit is METALNESS (`sets.<s>.ormB = 'metal'` via the
  set config) — one draw carries brass, copper, lead, canvas and leather;
- the rig (limb lengths, offsets, radii, profiles, SOLE_Y) is PARSED out of diver.js at bake
  time, recorded in `sal.json` meta.rig, and checked by `salInstall.js` against the live rig
  (small drift: segments stretched + a console warning; >15%: procedural Sal kept). After
  any proportion change in diver.js, re-run the one command.
Bake: ~3.5 min on an M5 Max (hi meshes 0.16-1.5 M tris per piece). Reproducible: two runs give a
byte-identical .glb and most maps; Cycles-GPU AO noise moves <0.1% of ORM texels by <= 7/255.

## Skinned Sal (salreal): skin, wrinkle maps, gutter fill, welded normals

`node tools/blender/build.mjs salSkin` — `src/entities/salSkinSculpt.js` -> `assets/salskin/`.
The dress (trunk + trouser legs + boot shafts, two sleeves) is ONE garment authored in the
hips frame in the rig's rest pose; salInstall.js binds it to diver.js's own groups (rigid
`assets/sal` stays as the second fallback, the procedural man the third). All additive — a
creature that uses none of these builds exactly as before:
- **`pipeline().skin = { bones: [{ name, head, tail, parent? }] }`** (game frame) and a piece
  `skin: { allow: [bone names], smooth? }`: bake.py builds the armature, weights each skinned
  low by BONE HEAT on a welded copy (the low is split along its UV seams and heat cannot
  cross a cut; solved at x10 — at 1x Blender's solve failed on every vertex), carries the
  weights back by position, then cleans them in numpy (Laplacian smoothing over the welded
  edges, 4 influences, normalised; empties -> nearest allowed bone). The .glb gets
  JOINTS_0/WEIGHTS_0 + a skin; `assets.js` reports `skins[piece].bones` (joint names in
  skinIndex order; GLTFLoader may suffix a duplicate name `_1`).
- **piece `wrk`** (a second full-detail field: compression gathers in the insides of the
  joints) -> `<piece>_hiW.ply` -> bake.py bakes its normals through the same low into
  `<set>_wrinkle` (WebP + BC5 KTX2; set `wrinkleHalf: true` writes it at half size);
  meta `sets.<s>.wrinkle = true`; `assets.js` loads `maps.<s>.wrinkleMap`.
- **set `fill: true`**: push-pull fill of every map's background from the charts (no black
  or roughness-0 gutters averaging into chart edges in the mips).
- **set `weldNormals: true`**: one normal per position across UV seams, set as custom normals
  before the bake (the tangent frame the maps are baked in is the game's) — no seam lines,
  no cracks when a shader pushes along the normal.

## Proportions, rigged hands, the face (salprop)

- **Helmet + corselet scale**: diver.js `HELM_S` (0.85) shrinks the helmet group and the corselet
  group about the shoulder line `CORS_Y`; the sculpts are authored at the old size and ride those
  groups. readRig parses both; meta.rig.helmS is checked by salInstall (skinned: any drift refuses).
- **Hands** (salSkinSculpt): sculpted OPEN and skinned to 16 finger bones in the WRIST frame (they
  share the armature with the body's hips-frame bones — harmless: each piece only allows its own).
  `handPoses()` solves GRIP / KNIFE (fingers fitted to wrap a bar at the lantern bail / the hilt) and
  keys RELAX / SPREAD; meta.hand carries bones + poses, the game blends them (salInstall handsTick).
- **Face**: `head` piece, its own 1024 `face` set, sculpted in centimetres and placed by one scaled
  `xf` (meta.face). helmetSpec hollows the bonnet's front and bores the faceplate through to it; the
  installer adds the liner + procedural eyes and drops the front recess disc. Look-dev:
  `sculptlab.html?lab&job=./src/entities/salSkinSculpt.js%23preview&p=head,eyes` (or `p=handL`).
