# tools/relief: the offline relief toolkit (node only; spec docs/superpowers/specs/2026-10-13-seafloor-relief-design.md)
- `node tools/relief/slice.mjs` first, and again after any edit to terrain.js, wrecks.js, lair.js or brooderGeo.js: it slices them by marker lines into the git-ignored `terrain.gen.mjs` / `pins.gen.mjs` the others load.
- `node tools/relief/validate.mjs`: the terrain fingerprints (every site; home with its relief rows removed must be 3b526986) and the frozen wreck sites against `expect.json`; exit 1 on a mismatch. `--record` rewrites it (main, or Task 4's new home anchor only).
- `node tools/relief/gates.mjs [--json out.json]`: S1-S7, the §7 limits, G3 and the skiff at home zone 0, one line each; exit 1 if a hard gate fails (S3 is a target). `stats.mjs` holds the masks and statistics, `mesh.mjs` the drawn coarse mesh (S6).
- `node tools/relief/cost.mjs`: heightAt ns per call at home zone 0, home's rows on vs off (best of 5); exit 1 if on/off > 1.5.
