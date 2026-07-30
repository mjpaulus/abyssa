# ABYSSA

*Three sleepers bar the deep. Your air comes down a hose. Do not outrun it.*

A 3D browser game in the spirit of Shadow of the Colossus, transposed to the bottom
of the sea. You are Sal, a hard-hat diver in a Mark V suit, descending a three-zone
ocean trench to calm three colossal leviathans — not by killing them, but by lighting
the ancient wards that stud their bodies. Your only lifeline is an air hose running
up to a pump on a raft at the surface. Everything below wants your light, your air,
or both.

Built entirely in **Three.js**, no build step, no bundler — one `index.html`, ES
modules, and a static file server.

## Play

```bash
python3 serve.py
```

Open http://localhost:8777 and click to descend.

| Input | Action |
|---|---|
| Mouse | Look |
| WASD | Move (walking is heavy — you're in lead boots) |
| Space / Ctrl | Rise / sink |
| Shift | Boost swim — or fire the **air thruster** once found (it burns your air) |
| Left click | Knife slash |
| Right click | Spear gun (once found; spent spears can be recovered) |
| Q | Vent an ink sac — breaks a hunting shark's charge |
| T | Sonar ping (once found) |
| E / F | Take relics · craft hose / refuel pump at the raft |
| P | Diagnostic: bypass all post-processing |

## The loop

- **Air is everything.** It comes down the line from the raft's pump. The pump burns
  bitumen; the hose is extended with polymer — both are gathered from the seafloor.
  Descend past your hose length and you'll learn what the taut-line warning means.
- **Three zones, three sleepers.** Luminous shallows → twilight → near-black abyss.
  Touch every ward on a sleeper's body and it calms, opening a rift deeper.
- **The trench is inhabited.** Fish school and flee, jellies drift, a shark circles
  what moves too fast and shines too bright, an octopus will reach out of its den and
  steal your lantern light, and squid stalk the abyss drawn to your flame. Squid can
  be killed — their ink is your shark counterplay.
- **Three wrecks hide three tools.** A sounding set (sonar), a spear gun, and an air
  thruster, each aboard a period wreck worth finding for its own sake.
- **Weather is real.** A 12-minute day cycle, storms that heave the raft, churn the
  shallows, and make the pump gasp — while the deep stays indifferent.
- Calm the last sleeper, pass the final rift, and the trench lets you go.

## Tech notes

- Three.js r160 via CDN importmap; `postprocessing` + `n8ao` for the post stack
  (N8AO ambient occlusion, SMAA, bloom, DoF, film grade) plus a custom half-res
  raymarched volumetric-light pass with screen-space occlusion.
- Custom per-channel Beer–Lambert water optics patched into every material's fog path.
- Rapier physics (WASM) for seafloor debris; verlet rope for the air hose.
- Almost everything is procedural: the diver, the leviathans, wrecks, terrain,
  creatures, and all their animation (GPU vertex work wherever possible). Terrain
  detail uses CC0 photographed PBR sets, triplanar-mapped.
- Deterministic weather and storm schedule — a session replays identically.

## Credits

- Prop models: Kenney (CC0) — see `assets/props/CREDITS.md`
- Terrain textures: AmbientCG (CC0) — see `assets/textures/CREDITS.md`
- Optional Mark V helmet model: Egor Gulyushkin / BeaVex (CC-BY) — see
  `assets/models/CREDITS.md`
- Built with [Claude Code](https://claude.com/claude-code)

License: GPL-3.0 (see LICENSE).
