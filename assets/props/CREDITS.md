# Prop assets — sources and licenses

**None.** Every seafloor prop is GENERATED in code (`src/world/props.js`: the
waterlogged log and the stove barrel, with their map sets in `src/lib/textures.js`),
per the project's hard rule that all assets are authored procedurally.

The Kenney CC0 models that used to live here (`rock_largeC.glb`, `rock_tallE.glb`,
`rock_smallC.glb`, `log.glb`, `stump_old.glb`, `barrel.glb`, and the Pirate Kit's
`Textures/colormap.png`) were removed on 2026-09-25 (branch `polish-props`) once no
code path referenced them. Do not add downloaded models back.
