# Prop assets — sources and licenses

All files in this directory are **CC0 1.0 Universal (public domain)**.
No attribution is legally required; it is recorded here anyway.

| File | Source pack | Author | License | Tris |
|---|---|---|---|---|
| `rock_largeC.glb` | [Nature Kit](https://kenney.nl/assets/nature-kit) | Kenney | CC0 1.0 | 72 |
| `rock_tallE.glb` | [Nature Kit](https://kenney.nl/assets/nature-kit) | Kenney | CC0 1.0 | 38 |
| `rock_smallC.glb` | [Nature Kit](https://kenney.nl/assets/nature-kit) | Kenney | CC0 1.0 | 16 |
| `log.glb` | [Nature Kit](https://kenney.nl/assets/nature-kit) | Kenney | CC0 1.0 | 200 |
| `stump_old.glb` | [Nature Kit](https://kenney.nl/assets/nature-kit) | Kenney | CC0 1.0 | 120 |
| `barrel.glb` | [Pirate Kit](https://kenney.nl/assets/pirate-kit) | Kenney | CC0 1.0 | 148 |

Download URLs used:

- `https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip` → `Models/GLTF format/*.glb`
- `https://kenney.nl/media/pages/assets/pirate-kit/e6d4bb1525-1771333093/kenney_pirate-kit.zip` → `Models/GLB format/*.glb`

`barrel.glb` references an **external** texture; `Textures/colormap.png` (same Pirate Kit,
CC0) is shipped next to it and must stay at that relative path.

License text: <https://creativecommons.org/publicdomain/zero/1.0/>

## Adding or replacing props

1. Drop a `.glb` into this directory (binary glTF 2.0; `glTF` magic bytes, version 2).
   Keep it under ~10k triangles — props are instanced hundreds of times per zone.
2. Add an entry to `MANIFEST` at the top of `src/world/props.js`:
   `{ file, n, size: [minH, maxH], zones: [0,1,2], slope, stand, tint, sway?, collide?, shadow? }`
   - `size` is in **world units of height**; `loadProp()` normalises every asset so its
     largest extent is 1 unit, XZ-centred with its base at y=0.
   - `tint` picks a colour from the per-zone `PAL` table (`rock` / `wood` / `wreck`).
3. Nothing else is required. A file that is missing or fails to parse is skipped with a
   `console.warn` — `buildProps()` always resolves and the game never breaks.

Only genuinely CC0 (or otherwise redistributable) assets belong here.
Record source URL, author, and license in the table above.
