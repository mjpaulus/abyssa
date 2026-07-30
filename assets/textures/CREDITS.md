# Terrain texture assets — sources and licenses

All files in this directory are **CC0 1.0 Universal (public domain)**.
No attribution is legally required; it is recorded here anyway.

| File | Source set | Author | License |
|---|---|---|---|
| `albedo_pack.jpg` (R) · `rough_pack.jpg` (R) · `normal_silt.jpg` | [Ground054](https://ambientcg.com/view?id=Ground054) — wet mud / fine silt | AmbientCG (Lennart Demes) | CC0 1.0 |
| `albedo_pack.jpg` (G) · `rough_pack.jpg` (G) · `normal_sediment.jpg` | [Gravel023](https://ambientcg.com/view?id=Gravel023) — gritty pebble sediment | AmbientCG (Lennart Demes) | CC0 1.0 |
| `albedo_pack.jpg` (B) · `rough_pack.jpg` (B) · `normal_rock.jpg` | [Rock035](https://ambientcg.com/view?id=Rock035) — rough fractured rock | AmbientCG (Lennart Demes) | CC0 1.0 |

Download URLs used (2K-JPG variants, no auth):

- `https://ambientcg.com/get?file=Ground054_2K-JPG.zip`
- `https://ambientcg.com/get?file=Gravel023_2K-JPG.zip`
- `https://ambientcg.com/get?file=Rock035_2K-JPG.zip`

License text: <https://creativecommons.org/publicdomain/zero/1.0/>

Everything here is served from this directory by the local dev server. Nothing is
hotlinked — the game must run with no outbound requests for terrain art.

## What was changed from the source packs

The 2K sets total ~95 MB, most of it in the normal maps; the shipped set is 3.3 MB.

1. **Downscaled to 1024².** The terrain samples these at roughly one repeat per 8
   world units, so 1K already gives ~128 texels/metre — well past what survives the
   fog and the mip chain at play distances.
2. **Albedo and roughness reduced to greyscale and channel-packed.** The zone palette
   in `src/world/terrain.js` owns every hue; these maps only ever supply structure, so
   silt/sediment/rock ride in R/G/B of one map each. Nine texture units become three.
3. **Level-normalised to a 0.5 mean** (autocontrast, then a per-map gamma). Rock035 is
   a very dark stone — at source levels the shader's divide-by-mean would have
   amplified its JPEG noise ~10x. With every channel centred the shader can use one
   constant and the three sets contribute equal contrast.
4. **NormalGL kept** (three.js uses the OpenGL green convention); NormalDX,
   Displacement, AO, and the .blend/.usdc/.mtlx files were dropped.

## Replacing a set

Bake a new pack the same way — greyscale, autocontrast, gamma to a 0.5 mean, packed
into the matching channel — or the shader's contrast will not match the other two.
