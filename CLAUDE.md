# ABYSSA — project guide for Claude sessions

3D Three.js browser game. Quality bar: **recent No Man's Sky underwater** — the user
holds reference screenshots and judges against them. Tone: quiet dread, brass-age,
dignified; never neon, never fireworks. The diver is named **Sal**.

## Run / verify

- Dev server: `python3 serve.py [port]` (no-store headers — plain http.server lets the
  browser cache ES modules and silently serve stale code). Launch config name
  `abyssa` (port 8777) and `abyssa-alt` (8790) in `.claude/launch.json`.
- No build step. Three.js r160 + postprocessing + n8ao via CDN importmap in
  `index.html`. `node --check` is the only offline gate; **the browser is the only
  trusted loader** (node once accepted a file the browser rejected).
- Verification discipline: every change is verified live in the browser before it is
  reported done. Numeric probes (console JS against the debug surface) beat
  screenshots for state; screenshots for look. Report failures plainly.

### Environment hazards (these WILL bite you)
- The Browser pane throttles rAF to ~0 when `document.hidden` — a "frozen sim" or
  non-firing timer is almost never a code bug. Check `document.hidden` FIRST, front
  your tab (`tabs_select`), and re-front after any navigate.
- The pane's **console buffer persists across reloads**. Old errors replay and look
  current. Trust only a brand-new tab, or verify the served file via `fetch`.
- Agents share the pane: they steal the fronted tab and each other's screenshots.
  Create your own tab; assert `gameState === 'play'` before reading gameplay state.
- Screenshot-based FPS/motion readings in the pane are unreliable under load; the
  user's own focused window is the ground truth for feel.

## Architecture (src/)

Module ownership headers ("OWNED BY:") are real: the orchestrator owns `game.js`,
`player.js`, `postfx.js`, wiring and integration; craft modules are built by agents
against explicit contracts and reviewed on return.

- `game.js` — state machine (title/play/won/dead), frame loop, HUD, ALL input, ALL
  cross-module wiring. Weather/predator/tool events flow through here.
- `core.js` — renderer (pixelRatio pinned to 1, integer buffer dims — fractional
  ratios caused artifacts), resize path (CSS → ResizeObserver → applySize →
  composer.setSize). Canvas z-index 0 / #ui z-index 1 is load-bearing.
- `player.js` — locomotion. Walking is deliberately PONDEROUS (top ~2.6 u/s, slow
  ramp, momentum carry) — the user rejected faster/snappier. Swim untouched.
  Thruster boost via `player.thrustOn` (set in game.js; drain beats the 0.28/s hose
  refill or thrust is free — currently 0.33/s).
- `postfx.js` — RenderPass → N8AO → VolumetricLightPass → EffectPass(DoF, Bloom,
  Chroma, Vignette, Grain) → EffectPass(SMAA; convolution effects can't share a
  pass). Tiered fallbacks; `degradeQuality()` sheds passes below 34 fps.
  **P key = full post bypass** — the canonical A/B for any rendering artifact.
- `postfx.volumetrics.js` — half-res raymarched god rays, screen-space occlusion.
  Soak-tested (10k frames, 620 P-toggles, 155 resizes, zero artifacts) against this
  project's flashing-black-rectangle history. `postfx.cinematic.js.off` is the old
  5-pass chain that CAUSED those artifacts — benched, rehab pass-by-pass only.
- `world/water.js` — per-channel Beer–Lambert optics patched into
  `THREE.ShaderChunk` fog globally. fog.color means *surface irradiance*.
  `setWeatherWater`, `setRayDim` are game.js-driven.
- `world/terrain.js` + `lib/triplanar.js` — 3 always-present heightfield meshes
  (rifts are flattened bowls, NOT holes; fall-through is a player.js special case).
  Triplanar CC0 PBR (channel-packed, 3.3 MB) multiplies ON TOP of zone palettes:
  texture = structure, palette = hue.
- `lighting.js` — STOPS depth blend; `setWeatherLight(day, storm, flash)`; weather
  bite fades out by ~40% depth so the abyss never changes.
- `entities/diver.js` — procedural Mark V Sal (~40k tris): Part/bake merged
  geometry, spring secondary motion, curve-keyed gait, heel-strike `stepCount()`
  drives footsteps+dust+prints on the same frame. Knife slash contact at t=0.22s
  (game.js `pendingSlash` matches — keep in sync). `airInletWorldPos` = tether dock.
  `helmGroup` is swappable — see `helmetSwap.js`.
- `entities/helmetSwap.js` — mounts `assets/models/markv_helmet/helmet.glb`
  (CC-BY BeaVex Mark V; USER STILL NEEDS TO DOWNLOAD IT from Sketchfab — needs a
  login) over the procedural helmet; silently absent otherwise. `window.__helm`
  adjusts fit.
- `entities/leviathan.js` — CPU-rebuilt body (GPU deform produced degenerate geometry
  once), alpha-hashed fin cutout (blending can't mis-sort), sigil flash/calming-wave
  events, contact blobs. Zone-0 sleeper idles shallow (62/38) to cross the god rays.
  Chase steering fades inside ~3 body-radii (`flyby`) or it pirouettes around the
  player — user-reported bug, don't regress.
- `world/creatures.js` — boid schools (floorBias reef layering), jellies, drifters,
  sparks. NOTE: shared MeshStandardMaterial variants need distinct
  `customProgramCacheKey` or three silently shares compiled programs.
- `world/predators.js` — shark FSM (patrol→interest→windup→strike→flee; counterplay:
  still+dim de-escalates, ink cloud aborts), octopus dens (GPU arms, light-steal,
  ink), squid shoal (killable → ink sacs). Exports `slash`, `deployInk`; events:
  threat/bite/lightSteal/inkPickup. `window.pred` dev surface.
- `world/wrecks.js` — skiff (sonar), split trawler (spear gun), crushed submersible
  (thruster). `wreckColliders` feed camera probe + player push-out (3-list loops in
  game.js and player.js). `window.wrecks.goto(zi)`.
- `systems/tools.js` — sonar staggered-echo ping, spear projectile (reuses
  predators.slash at the tip), thruster bubble FX.
- `systems/weather.js` — deterministic 12-min day cycle + storm/lightning schedule
  (pure function of t, mulberry32 const seed). `window.weather.set/advance`.
- `systems/survival.js` — air economy. Drowning respawn refuels pump to 0.3 (soft-
  lock fix). HOSE_REQ gates descent (never leash-clamp the player — user rejected).
- `systems/tether.js` — verlet hose, anchors to live `pumpPos` (raft bobs), docks at
  `airInletWorldPos`. `setTetherVisible` used by the ending.
- `ending.js` — 75s cinematic: stillness → rift-threaded ascent (spline through all
  three rift openings; terrain is always present, a straight ascent pops through
  floors) → three sleeper silhouette passes keyed to DEPTH → surface → title card.
  `playEnding()` on window = debug jump.
- `systems/physics.js` — Rapier WASM via CDN, degrades to no-ops if the CDN fails.

## Conventions that are enforced

- Zero per-frame allocation in hot paths: module-scoped temps, typed-array pools,
  reused event objects. Every craft module benches itself (budgets in headers).
- Only the active zone's expensive systems are awake (predators, leviathan).
- One-shot diegetic onboarding via `showMsg`, never over another message. ALL-CAPS
  short lines, period voice ("BITUMEN — FOOD FOR THE PUMP").
- Debug surfaces are namespaced on window and kept: player, survival, lev, zone,
  gameState, setState, playEnding, pred, wrecks, weather, __helm.
- Licenses: every borrowed asset gets a CREDITS.md line (props, textures, models).

## Working model (multi-agent)

The orchestrator keeps taste work, integration, game.js/player.js/postfx.js, and
final review; Opus agents get bounded craft briefs (one file, explicit contract,
verify-in-browser mandate, hazards list); Sonnet for crisp mechanical specs. Stub
the contract + wire game.js BEFORE launching agents so the game never breaks while
they work. On return: node --check, contract grep, fresh-tab load, live probe of the
feature through REAL input paths, then report. User rejection of agent work =
orchestrator redoes it, not the agent.

## Known issues / open threads

- Helmet glb not yet downloaded (user action; everything else is wired).
- One-time `GL_INVALID_OPERATION` on some fresh loads — suspected depth-attachment
  sharing in the composer (pre-volumetrics; background task may have fixed it).
- Flora can crowd wreck sites (background task in flight to add exclusion radii).
- `2d.html`, `_probe.html` are early prototype leftovers.
- Audio audit (needs the user's ears) and a zone-1 art-identity pass (twilight
  thermal-vent concept) are the two remaining ideas from the original punch list.
- User keeps a feedback doc; expect a batch of notes rather than single items.
