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
  **THE SILT LINE**: the column is STRATIFIED — a nepheloid layer pools on each
  seabed under clearer water, so rising is the reveal (1.9x/3.4x/4.8x green
  visibility by zone; the payoff grows with depth). `rho(y) = rhoClear(y) + amp *
  min(1, exp(-(y-yf)/hs))`, exact antiderivative `G(s) = min(s,0) + 1 -
  exp(-max(s,0))`. The SATURATION is load-bearing (the unsaturated form amplifies
  below its datum and collapsed the inter-zone gaps to 22 units); every `exp()`
  argument is <= 0 so overflow is structurally impossible. `amp` is solved at the
  STANDING CAMERA (floor + EYE_H + CAM_UP = 3.75), not the eye — `updateAtmosphere`
  is keyed on `camera.position.y`. `scene.fog.density` KEEPS its old meaning (true
  local total at the eye) because creatures/predators/tools read it for additive-glow
  range; redefining it makes every jelly visible 4.6x further = floating neon.
  The warm near field is an A/B kill switch: three adjacent constants at ~line 44.
  Physics that constrains everything here: brightness cannot buy distance — range
  scales with the LOG of it (1e6x brighter = +1088 units). A far field at r=3600
  renders at e^-100 no matter what you spend.
- `world/terrain.js` + `lib/triplanar.js` — 3 always-present heightfield meshes
  (rifts are flattened bowls, NOT holes; fall-through is a player.js special case).
  Triplanar CC0 PBR (channel-packed, 3.3 MB) multiplies ON TOP of zone palettes:
  texture = structure, palette = hue.
- `lighting.js` — STOPS depth blend; `setWeatherLight(day, storm, flash)`; weather
  bite fades out by ~40% depth so the abyss never changes.
  **ABOVE THE WATERLINE IS A SEPARATE REGIME.** Every STOPS entry describes being IN
  the water, where the column scatters light into every shadow — so the shallow stop
  carries amb 0.55 / hemi 1.00 in teal-over-green. Applied in air that floods the
  raft's deck flat and dyes its timber sage. `updateLighting` therefore fades the omni
  fill and travels the hemisphere's two ends to sky/sea colours as the CAMERA rises,
  blended over 1.6 units. Below the interface every frame is unchanged.
  The sun also casts shadows, but ONLY over the raft: an 18-unit ortho box at the
  origin, which is exactly where the raft is moored, so the map costs the raft and
  nothing else. It switches off below y = -26 and under the quality fallback.
- `config.js` `SUN_ELEV_DEG` — ONE sun direction, shared. lighting.js aims the key
  light and its shadow camera down it; water.js draws the sky disc, the sea's glitter
  path and the god-ray shaft offset off it. They used to be two hand-written copies of
  the same vector. Elevation was 77 degrees — nobody chose that, it was "roughly
  downward" from when the camera never came above water, and at that angle every
  shadow falls directly under its caster. The floor is physics: refraction compresses
  the whole sky into Snell's window, so sunlight arrives underwater at no shallower
  than 41.4 degrees. 58 rakes the deck and slants the shafts.
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
- `world/vents.js` — ZONE 1's identity: THE BOILER ROOM. 17 black smoker chimneys in
  4 clusters on the zone-1 seabed (deterministic seed 0xB01Ec0DE, rejection-sampled
  clear of both rifts), merged to ~6 draw calls; dark plume/shimmer particle streams,
  GPU-side motion. `ventColliders` is list 4 in the camera-probe/push-out loops
  (game.js + player.js). Hard-won display rules for a lightless zone:
  - the ember sprites are `fog:false` (per-channel fog turned warm amber TEAL in
    metres — same lesson as the raft lantern), sit ABOVE the bore rim (recessed, the
    chimney's own lip depth-tests them away up close), and carry a two-range curve:
    linear halo to 90 units (zone 1's only wayfinding, like the raft lamp) swelling
    with distance (murk grows halos), plus a near bore-fire term.
  - ONE shared PointLight rides the nearest hot throat — never per-vent lights,
    because changing the scene's LIGHT COUNT recompiles every lit material mid-game.
    Its gate is linear over 34 units: the camera trails the diver ~10, so squared
    gates put the light at 6% while Sal stood beside the fire.
  - `window.gotoZone(i)` (game.js debug) switches zones without calming a sleeper —
    without it a teleported probe gets floored back to the OLD zone's seabed and
    reads as a broken teleport.
- THE CHART (multi-site ocean) — `world/site.js` is the registry (3 authored
  anchorages; site 0 = shipped world BIT-IDENTICAL, the regression anchor; terrain
  fingerprints: home 5e6cfe45, Pallid Bank ef14da09 on the 32x32x3 probe). The world
  reseeds IN PLACE around the raft: `reseedWorld(i)` in game.js runs
  fillTerrain -> reseedWrecks(tools) -> reseedFlora -> reseedResources ->
  reseedProps -> reseedVents -> reseatRifts -> reseedDens -> enterZone(0) — ORDER IS
  CONTRACT (flora excludes around wreckSites(), dens re-pick from flora's colliders).
  Discipline held everywhere: materials/programs never recreated, collider arrays
  keep object identity, layouts are pure functions of site seed streams (20x soak:
  programs constant, zero geometry/texture growth, zero scene drift).
  The paper chart: `ui/chartOverlay.js` (canvas-drawn, deterministic), opened by [E]
  at the chart table (`systems/raft/chart.js`, anchor exported from raft.js).
  Voyage = 'voyage' state in game.js: fade to black, reseed at full black, arrive.
  Persistence = localStorage 'abyssa.chart.v1' loaded BEFORE the world builds (saved
  site builds directly, no boot reseed): site, pencil record, tools, hose,
  endingSeen. The full rite plays ONCE ever; later triple-calms get the quiet
  chart-inking beat. Sleeper overlays (sigils/hue/epithet) merge over LEVIATHAN_CFG
  in makeLeviathan(idx, over) and flow via the ...c spread. Debug: window.__chart
  { sail, arrive, rec }, window.gotoZone.
- `systems/raft.js` + `systems/raft/` — the dive tender. It is a PLACE now (Sal stands
  on it, walks it, steps off it), not a prop seen from below. `raft.js` owns the
  material palette, the hose reel, the lantern and all wiring; five builders own
  regions: `hull.js` (planking, bulwark, drums, mooring), `station.js` (port wing —
  the dressing station, whose hero object is an EMPTY helmet stand), `gear.js`
  (starboard + aft — the bitumen the pump eats, made physical), `davit.js` (the
  gallows the umbilical rides + boarding ladder + anchor lantern), `pump.js` (oil
  engine belt-driving a compressor).
  - `raft/kit.js` — `Part`/`bake` merged-geometry idiom, `weather()` (grime + a
    waterline slime band into VERTEX COLOURS), and fittings. **Transform THEN weather**:
    `weather()` reads raw vertex Y to place the waterline, so a piece must already be
    in raft-local space. Materials are PASSED IN, never built by a builder.
  - Each builder bakes per material, then `consolidate()` in raft.js merges again
    ACROSS builders (meshes flagged `userData.rmerge`, direct children of `raft`
    only, so animated sub-groups are untouched). Whole raft: ~10 static draw calls,
    ~36k tris.
  - THE FRAME, raft-local: deck top **y = +0.11**, footprint **x,z ∈ [-4.7, +4.7]** —
    player.js hard-codes both. Waterline y = -0.55. +Z is the dive side. The walk lane
    (x ∈ [-1.1,1.1], z ∈ [1.7,4.7]) and the bulwark gap at z = +4.7 are the dive
    ritual; the boarding ladder hangs in that gap. There is NO per-object collision on
    deck — the deck is one flat platform — so tall gear lives against the bulwarks
    where nobody treads.
  - Board width is the whole deck read: at 8 boards across the span they were metre-
    wide slabs and the deck rendered as facets. 44 rows, each `weather()`ed as a whole
    board (boards weather as boards, not as one sheet of noise).
  - Pump tells running/dead SIX ways at once (flywheel coasts, belt-driven pulley,
    governor, receiver gauge needle that bleeds down after the wheel stops, vibration,
    exhaust). `pumpSpeed()` is published so audio's `setPump` hears the same coast-down
    the eye sees.

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
- **SCREEN-SPACE REFRACTION SHIPPED** (`renderRefraction` in water.js, called by
  game.js after updateWater, before the composer). The sea's TRANSMISSION term samples
  a half-res clip-plane render of the far side of the interface; reflection stays
  analytic. Key insight: the globally-patched height-integrated fog does the
  Beer-Lambert absorption for free in that render, so there is NO depth texture and no
  path reconstruction. Gated to camera.y > -35, fades over its last 10 units, first
  thing shed by degradeQuality, `window.__noRefr` = A/B kill switch. Own depth
  RENDERBUFFER (never share attachments — GL_INVALID_OPERATION history).
  shadowMap.autoUpdate is parked during the pass or every caster draws twice.
  The uv offset is HARD-CLAMPED at 0.035 NDC: in a gale the wave gradient smeared the
  transmitted scene into ghosts (a phantom davit leg, measured). Known limit of
  screen-space: storm crests overlapping the raft show refracted water, not the deck
  behind them — physically defensible, watch it with the user's eye.
- The raft casts no shadow onto the sea, so from below there is no dark patch marking
  where it floats. Wants the water surface to receive the sun's shadow map.
- The third-person camera is 9 units back and the raft is 9.4 across, so the camera is
  always OFF the boat while Sal is on deck. Every deck detail is only ever read from
  ~9 units. Pulling the camera in on deck would change movement feel, which is the
  user's call, not the orchestrator's.

### Far field / world scale — SILT LINE + W2 both shipped

- **The warm near field is UNRESOLVED and needs the user's eye.** Red 2% reach
  84 -> 105 units in zone 0. Kill switch: `K_PART = K_EXT` and
  `SILT_MIX/SILT_GAIN = 0.00/1.00` in water.js (three adjacent lines, ~line 44).
  Worth re-judging NOW: until the samplePerf fix the game silently ran with
  volumetrics/AO/shadows off every session, so the user has never seen full quality.
- **Does the far ridgeline read?** W2's rampart sits at 4.5% transmittance against
  the rim's 13.1% — a measured 2.9x separation, but subtle. `RAM_H` is the lever if
  it is too faint on a real monitor. Only the user can settle this.
- Streaming/chunked LOD is DECLINED with arithmetic, not taste: utilisation is 4.6%
  at r=2236 and 1.8% at r=3600, because scale is (resolvable feature)/(mean free
  path) and both terms are set by the water, not the triangle budget. The procedural
  answer given instead was killing the lathe (azimuthal rim onset).
- `WORLD_R` stays 260 forever — riftPos and bubble vents key off it, and the ending's
  rift-threaded spline breaks. `HALF` (mesh extent, now 560) is the knob that moves.
- Latent, currently invisible: `nephParams` keys off CAMERA height and `yf(y)` crosses
  `y` itself near -336 and -649, making phantom nepheloid layers in the open water
  BETWEEN zones (murkier there than on the zone-0 seabed). Harmless while those gaps
  are unlit; put light or geometry there and it becomes real.
- The dome/fog seam is NOT analytically zero (the spec claimed it was). Measured 0-2
  code values in the clear bands, up to ~10 at extreme elevation from a floor. Within
  tolerance; the source comments say so accurately. Do NOT "fix" it with a path
  integral in the dome — that was evaluated and killed.
- The spec's "the basin can never shrink" is overstated: the wall foot moves in up to
  9u on ~10% of bearings (a second-order effect of the crest-height warp, not the
  onset). Scatter-band steepness got BETTER, so the concern it guarded is closed.

### Perf sampling — read this before touching samplePerf

`game.js` passes `Math.min(0.05, clock.getDelta())`. That clamp is CORRECT for
physics and FATAL for any perf judge: a 500 ms frame is indistinguishable from a
50 ms one, and a throttled stretch reads as a steady 20 fps. `samplePerf` therefore
measures its own `performance.now()` wall time and discards frames over 250 ms.
Two separate false-degrade bugs came from getting this wrong; both shipped a game
that silently ran without volumetrics, AO or shadows on hardware doing 54-60 fps.
