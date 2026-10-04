# ABYSSA — project guide for Claude sessions

3D Three.js browser game. Quality bar: **recent No Man's Sky underwater** — the user
holds reference screenshots and judges against them. Tone: quiet dread, brass-age,
dignified; never neon, never fireworks. The diver is named **Sal**.

**HARD RULE (Michael, 2026-08-07): ALL assets are GENERATED — geometry, textures,
sprites, audio, everything — authored procedurally in code by Claude. No downloaded
models, no image files, no sample libraries. The bar does not drop because of this
rule; it rises: procedural is the craft, not the excuse. (This retired the external
Mark V helmet .glb plan — the helmet is generated now like everything else.)**
**Blender clarification (2026-09-30): headless Blender driven by Claude-written scripts
is a GENERATOR, not a source — `tools/blender/` bakes the sculpt pipeline's SDF creatures
(src/lib/sculpt.js) high-to-low into assets/sleepers/*. Allowed because every byte
rebuilds from committed code with fixed seeds (`node tools/blender/build.mjs <creature>`).
Never hand-model, never import downloaded meshes/textures, and every loaded asset keeps a
procedural fallback (lib/assets.js loadSculpted never throws).**

## Run / verify

- Dev server: `python3 serve.py [port]` (no-store headers — plain http.server lets the
  browser cache ES modules and silently serve stale code). Launch config name
  `abyssa` (port 8777) and `abyssa-alt` (8790) in `.claude/launch.json`.
- No build step. Three.js r184 + postprocessing 6.39 + n8ao 1.9 via CDN importmap in
  `index.html`. `node --check` is the only offline gate; **the browser is the only
  trusted loader** (node once accepted a file the browser rejected — concrete cause
  found later: a BACKTICK inside a GLSL comment inside a template literal terminates
  the string; node --check passed it, the browser threw. Never use backticks in
  comments inside the GLSL template strings).
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
- PAUSE: play pauses whenever pointer lock is off (Esc/blur). Probes/agents without
  pointer lock must set `window.__helm = true` (strictly true; helmetSwap.js hangs a debug
  OBJECT on the same name, which until 2026-10-04 silently disabled pause for everyone).
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
- `player.js` — locomotion. Walking is deliberately PONDEROUS and now WEIGHTED-SUIT
  (Michael 2026-10-02, reference-built: docs/superpowers/specs/sal-weighted-suit-motion.md):
  deck ~1.5 u/s, seabed top 2.15, Shift walk x1.3, per-ground gait (lean 9/15 deg, stance
  0.61-0.70), off-bottom is a head-up two-handed haul (~16 u/s, Shift x2.2), never a kick.
  The user rejected faster/snappier; motion targets come from Mark V reference, not human gait. Swim is HEAVY (Michael,
  2026-10-01, "make the swimming feel heavier"): added mass AM_H 2.40 / AM_V 1.90 (was
  1.55 / 1.26) — same cruise speed, longer ramps and carry; the bottle burst is computed
  against the shipped added mass so it keeps its punch and carries further; an unworked
  diver settles (A_SETTLE -0.11, small beside the dress's -1.83..+2.61). diver.js: a
  0.52 Hz kick (was 0.73), slower body yaw in water, a body pendulum under the helmet.
  Air thruster is a BURST model, not a drain: one shove per Shift press (`player.burstDir`
  / `player.burstT`, set by game.js's `tryBurst`), costing AIR_PER_BURST of the tank and
  a 5 s bottle recharge (`survival.thrustCharge`). Holding Shift never repeats it.
- Camera (`game.js` updateCamera) is GROUNDED (Michael, 2026-10-01, "floaty underwater"):
  the follow spring damps velocity relative to Sal (zero steady-state lag), no idle drift,
  the Flow handheld noise layers / stroke roll / interest drift are zeroed (knobs kept on
  `__hh`), FEEL.surgeK 0, FOV on smoothed speed. Weight cues are EVENTS only: heel-strike
  nudge/dip, landing sag, burst punch, shake + flinch. Don't re-add continuous wander.
- `postfx.js` — RenderPass → N8AO → VolumetricLightPass → EffectPass(DoF, Bloom,
  Chroma, Grade, Finite) → EffectPass(SMAA, Vignette, Grain — grain lands AFTER the
  AA; the library runs effects order-as-given, no auto-sort). Composer is HalfFloat
  end-to-end. Tiered fallbacks; `degradeQuality()` sheds passes below 34 fps (a cheap-
  volumetrics rung precedes full removal). Boot warm-up is `compileAsync`.
  **P key = full post bypass** — the canonical A/B for any rendering artifact.
  AUTO-EXPOSURE (`postfx.exposure.js`, branch ref-exposure): a Pass shell round three
  tiny own RTs (32x32 -> 4x4 -> 1x1, one program, no depth attachments) meters the
  scene colour after DepthCopy, INVERTING the ACES fit per tap (three bakes tone
  mapping + exposure into every material, so the buffer is display-referred; metered
  as-is the loop gain was ~0.1 and the exposure walked to its fence) and taking depth-
  1.0 taps raw (dome, far sea: unexposed shaders). The 1x1 is read through a 4-deep
  PBO ring three issues later with NO fence (a fence makes ANGLE/Metal commit mid-
  frame). The CPU adapts `renderer.toneMappingExposure` = 1.32 x 2^ev, fast down
  (0.6 s) slow up (3 s), inside a HARD per-depth clamp on lighting's depth01 (deck
  [0.7,1.4], seabeds [0.85,1.15] / [0.85,1.12] / [0.90,1.05]) so the deep never
  brightens past its authored look; `GLASS.exposure`, lab group 'exposure',
  `__exposure.state()`. P bypass snaps to 1.32. Cost ~0.05-0.2 ms by PAIRED frame A/B;
  a per-pass timer query on this TBDR GPU absorbs the scene pass and lies (2 ms).
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
- `world/ocean.js` (+ `ocean.spectrum.js`, `ocean.worker.js`) — THE SPECTRAL SEA (branch
  ocean). GPU Tessendorf FFT: JONSWAP wind sea + narrow swell, generated per bin per frame
  from weather uniforms (wind/storm reshape it with no CPU regen); 3 cascades 287/67/17 u,
  disjoint k-bands, stacked 256x768 atlas, 16 Stockham passes MRT; merge per cascade ->
  mip-mapped HalfFloat (disp+J, chop-corrected slope + slope^2 = unresolved variance ->
  GGX roughness, Jacobian + PERSISTENT foam ping-pong). Surface = 8-level geomorphed
  clipmap (`buildOceanGeometry`, one draw), displacement a pure function of (p, cam) so
  levels meet crack-free; interface side = `gl_FrontFacing` (NOT dot(V,N)). Below the
  horizon the dome draws `farSea()` (the same BRDF the mesh eases into) to the true
  horizon. CPU HEIGHT = a module worker IFFTs the identical cascade 0+1 bins ahead of the
  clock; main thread time-interpolates + Catmull-Roms + inverts the chop (4 us/query).
  NEVER read back the GPU per frame: getBufferSubData of a fence-signalled PBO measured
  7.5 ms main-thread stall on ANGLE/Metal. Accuracy vs drawn: `__ocean.verify()` /
  `verifyExact()` (gale 0.024 u rms on 1.23 u rms sea). Half-texel rule: the GPU samples
  uv = p/L, so the drawn field is the FFT shifted by half a texel. `__ocean` dev surface;
  `OCEAN` knobs (windLo/Hi, stormU, swell*, chop*, foamThr*). Quality rung 2 = half-rate
  sim (`setOceanRate`). Sky: reflects `getSkyEnv()` when the volumetric sky is up
  (glint x env alpha toward the sun, cloud shadow on the sea), else analytic/PMREM.
  Clear air K_AIR lowered ~3.5x (the 2.9 km haze hid the old 460 u disc rim); storm haze
  rides STYLE_U[0] (AIR_STORM_K).
- `world/terrain.js` + `lib/triplanar.js` — 3 heightfield meshes, ZONE-GATED by
  camera Y with flora's bands (−332k tris/frame; verified 0 visibility violations
  across the ending ascent and voyages). Rifts are flattened bowls, NOT holes;
  fall-through is a player.js special case. Site-0 fingerprint probe (FNV-1a over
  float32 terrainH, 32x32x3, x,z −248..248 step 16) must stay 35acc2d0.
  Triplanar CC0 PBR (channel-packed, 3.3 MB) multiplies ON TOP of zone palettes:
  texture = structure, palette = hue. ROCKS (flora.js) use a GENERATED rock map set
  (lib/textures.js rockMapSet, two variants) triplanar via onBeforeCompile + screen-
  derivative relief; cleavage faces are pure functions of existing stream draws.
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
  The helmet is generated (44-seg spun bonnet, Mark V hasp); `helmetSwap.js` loader
  is RETIRED under the hard rule. Sal breathes on ONE clock (`breathPhase()`):
  shoulders, exhaust bursts from the real valve, and the audio regulator share it;
  bursts have character classes and the column boils the surface (`surfaceBoil`).
  SCULPTED SAL (branch salsculpt): `salSculpt.js` sculpts every rigid part in its bone
  space through tools/blender (`node tools/blender/build.mjs sal` -> assets/sal); diver.js
  calls `installSalSculpt` (salInstall.js) which swaps meshes onto the UNTOUCHED rig and
  keeps the procedural build as the fallback (`?salproc` = A/B; `__salSculpt.state()`,
  `.procedural(on)` under ?lab). The bake reads limb lengths/profiles out of diver.js:
  CHANGE PROPORTIONS -> RE-BAKE.
- `entities/leviathan.js` — FACADE: dispatches on `cfg.kind` (config LEVIATHAN_CFG rows;
  a chart row or `__lev.swap(kind)` can override). Shared machinery in
  `entities/sleeper/common.js` (ward light pool of 5, rune, ward build/touch/flash,
  embers, sonar/keeper gates, generic dispose with `L.onDispose`/`L.keepTex`).
  Kinds: `sleeper/serpent.js` (the original: CPU-rebuilt body, alpha-hashed fins,
  flyby steering fade — don't regress the pirouette fix; zone-0 idles shallow 62/38)
  and `sleeper/brooder.js` + `brooderGeo.js` (VELKATH THE BROODER, roadmap/three-
  sleepers.md: crab colossus, planted-foot tetrapod gait on 2-bone IK, instanced
  legs, underside wards buried and dark while she sleeps, touchable only standing).
  `__lev.fp(i)` is the serpent's regression hash (z0 15ce888c, z1 c938fe6e, z2
  652d0412); `__lev.swap/cmd/state` and the lab "sleeper" group drive the kinds.
  Zone 0 SHIPS the Brooder (her rite: `sleeper/brood.js` — asleep as a ridge on the
  rift lip, nest + 3 eggs + tracks; taking an egg wakes her; the last ward won't light
  while an egg is out; `lev.dormant` hides name/bearing/dread until she wakes).
  Zone 1 SHIPS ORUNE THE HOARDER (`sleeper/hoarder.js`, `hoarderGeo.js`, `hoard.js`):
  wrapped round the trawler, the hoard of drowned lanterns; taking the ship's lamp
  wakes her; arms lash/grab (knife frees: `lev.onSlash`), flinch from light; wards on
  the sucker faces answer the sonar; calmed, a lighthouse. `lev.rite` is the generic
  [E]/prompt hook all three use. Zone 2 SHIPS MHOR THE HUNTER (`sleeper/hunter.js`):
  absent until THE LAST FURNACE is fed 2 bitumen (warm pocket refills air); arrives
  from the deep, circles, strikes; a strike through the flare stuns him (keepers
  scatter, wards open). The serpent kind remains for chart rows / `__lev.fp`.
- `world/gardens.js` — the plant vocabulary (12 instanced types by zone: fans/seagrass/
  staghorn/sponges/anemones; tube worms with retracting plumes on activeVents, mats,
  crinoids; sea pens/glass sponges/whips). Own siteParams('gardens') stream (site.js has
  no authored seed yet — falls back to a per-site stream). window.__noGardens = A/B.
  SCULPTED PLANTS (branch plants): `world/plants/plantKit.js` swaps baked species
  (`plantsSculpt.js` -> `node tools/blender/build.mjs plants` -> assets/plants) UNDER flora.js's and
  gardens.js's own layouts: hosts call `plantAdopt(key, species, im, opts)` after every layout (no
  stream draw — fingerprints untouched), the kit mirrors each host mesh into ONE BatchedMesh per
  species (variants by index hash, near/far LOD + range cull on the CPU) running gardens.js's sway
  program (batching-aware: aInst from a float texture). Host meshes are hidden, never disposed:
  `?plantproc` / `__plants.proc(true)` = the procedural A/B; `__plants.state()`.
  PLANTS2: kelp + seagrass are BLADE CARDS (`plants/bladesSculpt.js` -> assets/blades, baked flat,
  assembled at load into Macrocystis fronds with floats / bull kelp / Alaria / Laminaria and
  seagrass patches, three LODs, kelp re-proportioned per instance by `kelpRemap`); sea pens
  (+ Umbellula), whip corals (aspect-matched `whipRemap`), bacterial mats are new 3D species;
  brain + table are EXPLICIT parametric lows (maze in geometry, real plate underside) with
  explicit far LODs; every 3D species' far field is crossed-card IMPOSTORS (`plants/impSculpt.js`
  -> assets/imp, one batch for all; `?noimp` A/B). Quiet bioluminescence: gardens.js GD_BIOLUM
  (baked polyp mask, a wave down the colony, flash on stir push/jolt) on pens, a third of the
  whips, GD_BIOTIP on crinoid arm tips. The build runs as a job queue under 4 ms/frame.
- `world/fauna.js` — the animal vocabulary (loft/blade/limb/gape/eyes/photophores,
  part-id vertex animation, 30 Hz steering): ray, turtle, moray, crabs, stars/urchins;
  vent fish, flapjack, isopods; anglerfish, gulper, lanternfish. Own 'fauna' stream;
  hidden during the rite (hideFauna).
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
- `world/lightning.js` — LIGHTNING IS A LIGHT (roadmap/ref-lightning-light.md): each main
  stroke grows a midpoint-displaced channel (one instanced additive ribbon draw, fog:false)
  and the two strongest live bolts are `abyssaBolt0/1` uniforms in the fog chunk — every
  fogged material is lit from the bolt's side, inverse-square with a floor, water leg
  extinguished. NOT a THREE light (the count is sacred). `ABYSSA_LIT` is planted on
  `lights_fragment_begin` so lit programs use their real normal; the rest take a
  screen-derivative one. Bolt positions are seeded from the deal, so a hand repeats.
  `__bolt.last()` is where audio will place the thunder.
- `systems/survival.js` — air economy (campaign set: FUEL_BURN 1/420, O2_REFILL
  0.10, HOSE 120/craft, HOSE_REQ [0,640,920], rescue refuel 0.5). TORN DRESS: bites
  and sleeper slams halve refill for 20 s (stacks extend). Storm sputter cuts supply.
  HOSE_REQ gates descent. THE LEASH (ruled by Michael 2026-10-04, roadmap/hose-leash-
  decision.md: "stop with stretch but like pulls him a bit so he might go off balance.
  This should be speed based so the faster he is moving the more exagerated the pull"):
  tether.js `leashStep` — over the last 5 u the line gives (a spring off the bottom, an
  outward-speed drag on the ground so a walk never deadlocks), then a firm HOLD at full
  stretch resolved on velocity at the time of impact (no position snap, no tunnelling,
  no jitter), and ARRIVING at the hold is a YANK scaled on his closing speed (strength
  = (v/7)^0.8): restitution back toward the raft, a stagger (diver.js `diverYank` own
  channels ykP/ykR — a rock back on the boots, a tumble up to ~55 deg in open water,
  never horizontal), player.stagger (hands off the drive 0.3-1.5 s), a camera jolt
  (game.js camYank, centimetres), a twang running up the drawn hose, and a creak-thump
  + bonnet knock (audio/sal.js hoseYank). AIR is cut only while he STRAINS against the
  hold (`survival.strain`, eased both ways), never because the line is merely taut. The
  leash anchors to the pump eased over 1.5 s (the live hose head heaves 1.5-2.5 u/s).
  `window.__leash` (state, last yank, maxIn/maxEnd, reset()), `__noLeash` bypasses it.
- `systems/tether.js` — verlet hose, anchors to live `pumpPos` (raft bobs), docks at
  `airInletWorldPos`. `setTetherVisible` used by the ending. A zero-dt frame no longer
  integrates (it NaN-poisoned every node: the hose vanished for the session).
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
    linear halo to 130 units (Michael 2026-10-04: "Visible from 90, dimmer than the hoard") swelling
    with distance (murk grows halos), plus a near bore-fire term.
  - ONE shared PointLight rides the nearest hot throat — never per-vent lights,
    because changing the scene's LIGHT COUNT recompiles every lit material mid-game.
    Its gate is linear over 34 units: the camera trails the diver ~10, so squared
    gates put the light at 6% while Sal stood beside the fire.
  - `world/ventlife.js` — vent fauna: two InstancedMeshes (pale shrimp swirling at
    each active throat, crabs on the crust at the chimney feet), anchored on
    `activeVents`, ALL motion in the vertex shader off uTime (CPU writes two floats
    a frame). No glow, fog ON (fog:false is for the ember SPRITES only). Buffers
    sized for 20 vents at build, reseed rewrites them in place; everything hides
    above y=-340 for a one-compare early-out. Distinct customProgramCacheKey per
    material (the creatures.js shared-program hazard).
  - `window.gotoZone(i)` (game.js debug) switches zones without calming a sleeper —
    without it a teleported probe gets floored back to the OLD zone's seabed and
    reads as a broken teleport.
- THE CHART (multi-site ocean) — `world/site.js` is the registry (3 authored
  anchorages; site 0 = shipped world BIT-IDENTICAL, the regression anchor; terrain
  fingerprints: home 5e6cfe45, Pallid Bank ef14da09 on the 32x32x3 probe). The world
  reseeds IN PLACE around the raft: `reseedWorld(i)` in game.js runs
  fillTerrain -> reseedWrecks(tools) -> reseedFlora -> reseedResources ->
  reseedProps -> reseedVents -> reseedVentLife -> reseedGardens -> reseatRifts ->
  reseedDens -> reseedCreatures -> reseedFauna -> enterZone(0) — ORDER IS
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
  { sail, arrive, rec, found, keeps }, window.gotoZone.
  CHART V2 shipped on top: (1) SONAR SOUNDINGS — site 3 THE UNSOUNDED SHELF is
  `hidden: true` in site.js; a sonar ping FROM ZONE 2 discovers it once-ever
  (game.js KeyT handler), persisted as `found[]` in the save; the chart shows a
  pencil "?" until then and renders a discovered anchorage entirely in PENCIL
  (the owner's three stay ink — the title stays THE THREE ANCHORAGES on purpose).
  (2) KEEPSAKES — every remote wreck carries a small brass keepsake (shapes in
  lib/keepsakes.js, placement/pickup/9 authored lines in wrecks.js, real E path);
  taken ones appear on the shelf by the chart table (systems/raft/shelf.js, +0
  static draw calls, one dynamic merged mesh, site-major slot order — gaps are
  the record); state is `keeps[][]` in the save, pushed via setKeepsakeState /
  setKeepsakes after every reseed. (3) CREATURES RESEED — creatures.js layout is
  a pure function of siteParams('creatures').rng (build AND reseed install a
  fresh stream; trailer geometry draws from its own fixed GEO_RNG so boot ==
  arrive-back). Soak: 12 voyages flat at 353 programs / 148 geometries.
  OWN WATER (2026-10-04, roadmap/fly-remote-sites.md, Michael: "Give each its own water"):
  site rows now carry water / light / grade / floor / shape / vents / wrecks and the
  sleeper rows' idle / lair / hard are LIVE (they were dead data). All null at home.
  Water rides three shared fog-chunk vec4s (abyssaSite/SiteT/SiteK, DELTAS from the shipped
  constants, installed like abyssaStyle) + SITE_SURF on the CPU palette, so a voyage moves
  fog, dome, far sea and shafts together with zero recompiles. Sleepers: Velkath swings
  round her rift's lip (lair.bear, or lair.arc + idle picks the lip height), Orune turns
  about her trawler (lair.bear / idle), Mhor's furnace moves (lair.bear/r); `hard` =
  hammerT/threatR, pull/hold/lashCd/grabR, circleT/stunT/hitR/speed. Never more lights.
  Probe `__chart.fp()` (terrain.js terrainFingerprint: FNV-1a of f32 terrainH, 32x32 grid
  over +-260 x 3 zones): home 8ff7cdbd (UNCHANGED), Pallid c265183a, Burned
  e7dbcb88. (The old 5e6cfe45/ef14da09 recipe is not in the repo and could not be
  reproduced.) sleeperFingerprint(i) home: 49a7a176 ac04921e ce3eaf9d.
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
    ~56k tris (chamfered planks, lathed drums, hex bolts — the geometry pass).
  - THE FRAME, raft-local: deck top **y = +0.11**, footprint **x,z ∈ [-4.7, +4.7]** —
    player.js hard-codes both. Waterline y = -0.55. **+X is the dive side** (moved off +Z
    2026-10-02, Michael: "move the ladder to the left side. The air hose rig is in the
    way" — left = screen-left from the old deck camera facing +Z, which is +X). The walk
    lane (x ∈ [1.7,4.7], z ∈ [-1.1,1.1]) and the bulwark gap on the +X rail at
    |z| < 1.2 (`LADDER_Z` 0, `GAP_HZ` 1.2 in raft/colliders.js) are the dive ritual; the
    ladder hangs at x 4.78 in that gap, between the flotation drums (|z| >= 2.35 — a gap
    elsewhere on a side rail would hang the ladder into a drum). Sal spawns at (2.6, 0)
    facing +X (`DECK_SPAWN_YAW` in game.js; every camera snap follows his yaw). Ladder
    grab: x 4.2..5.9, |z| < 1.2, facing -X. The GALLOWS stands BESIDE the gap, not over
    it: davit.js still authors in its old frame (x athwart, +z outboard) and turns it
    +PI/2 onto the +X rail at `RIG_Z` 2.9 (feet (3.75, 1.6)/(3.75, 4.2), sheave
    (5.6, 3.3, 2.9) — 0.36 clear of the forward drum's end), tackle/shot line swung away
    from the gap, anchor lantern toward it. The hose reel is built in the same rig frame
    (raft (0.6, 2.9)), so its lead runs straight to the block. The +Z rail is whole now:
    the lashed cargo moved there (centre (-1.12, 3.72)), the boat hook lies along it,
    the hose stock moved aft of the gap (3.95, -1.95).
  - DECK COLLISION IS REAL (raft/colliders.js, 2026-10-02): every solid thing on the
    planks is a 2D box or capsule in raft-local x/z (bulwark runs with the gap, gallows
    legs + tie rods, reel, pump, servants, barrels, butt, hose stock, cargo, bench,
    stool, boots, helmet stand, slate rail, shelf, chart table, cleats). player.js takes
    his waist into the raft frame (pitch/roll/heave), pushes the 0.32 body circle out by
    closest point (two passes), removes only the inward velocity, carries the push back
    out through the raft's axes. Probed by walking (real W keydown) into every shape:
    penetration <= 0.02 (sampling noise from the raft moving between frames), no
    oscillation. NO-SLOT RULE: any gap narrower than a body (0.64) between two shapes is
    a slot he presses into while two push-outs fight (= jitter) — so gaps are FILLED
    (gear near a bulwark runs its shape to the timber, clusters are bridged), which is
    why some shapes are larger than their object. MOVE AN OBJECT, MOVE ITS COLLIDER LINE,
    then re-check for slots. Low things a boot steps over are
    deliberately absent. The camera does NOT collide with deck gear (it sits ~9 back,
    off the boat).
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
  gameState, setState, playEnding, pred, wrecks, weather, __helm, __sky, __audio,
  __breath, __boil, __grade, __hit, __rm, __feel, __gait, __chart.
- Message discipline: `showMsg(text, dur, prio)` is a two-slot priority queue —
  never clobber; sleeper-name lines are prio 0. Esc/blur is a real pause.
- Reversed-edge `smoothstep(a,b,x)` with a>=b is GLSL UB and returns 0 on this
  driver — it silently killed eleven art systems for months. Always `1.0 -
  smoothstep(lo, hi, x)`. Transparent DoubleSide materials need `forceSinglePass`.
- Licenses: every borrowed asset gets a CREDITS.md line (props, textures, models).

## THE WORKING CHART (feature board — keep it inked)

`roadmap/` is the feature board: ONE MARKDOWN FILE PER CARD, git is the revision
history, `ROADMAP.html` is GENERATED (never hand-edit it). The roadmap mod
(~/.claude/mods/roadmap) owns it: use its tools, `mcp__roadmap__list/read/add/move/
log/update/publish`, and its `roadmap` skill for the card conventions. Cards are
CONTEXT: read a feature's card (`mcp__roadmap__read`) before working on it; parallel
sessions check `status` before claiming work.

- Artifact URL (stable, never mint another): in `roadmap/config.json` artifactUrl.
- WHEN feature state changes: `mcp__roadmap__move` / `log` / `update` the card (the
  tools append the dated `## Log` line and bump `updated` — put the why + commit hash
  in the note), then `mcp__roadmap__publish` (regenerates ROADMAP.html and republishes
  to artifactUrl), and commit roadmap/ + ROADMAP.html with the code.
- Cards with `status: decision` are decisions ONLY the user can make — never resolve one
  without his explicit call; record his words in the log line when he rules.

## Working model (multi-agent)

The orchestrator keeps taste work, integration, game.js/player.js/postfx.js, and
final review; Opus agents get bounded craft briefs (one file, explicit contract,
verify-in-browser mandate, hazards list); Sonnet for crisp mechanical specs. Stub
the contract + wire game.js BEFORE launching agents so the game never breaks while
they work. On return: node --check, contract grep, fresh-tab load, live probe of the
feature through REAL input paths, then report. User rejection of agent work =
orchestrator redoes it, not the agent.

## Known issues / open threads

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
  transmitted scene into ghosts (a phantom davit leg, measured). RAFT CREST (2026-10-04,
  roadmap/gale-crests-deck.md): air-side sea fragments test the eye ray against the raft's
  dry slab (`setRaftFrame(raft.matrixWorld)`, raft-local box) and, where it lands, drop the
  refraction sample and let the already-drawn raft through by exp(-sigma*d) — water over
  the deck reads as a wash over the planks, never a window into other water. Covers the
  deck slab only (not the ladder/sheave/helmet). `__raftCrest(false)` = A/B.
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

The judge is now a MEDIAN over a rolling 90-frame window of those wall times, graded
against the frame governor's BUDGET (1000/cap ms; uncapped means 60), never an fps
number: the governor paces a healthy frame to exactly the slot, so "fps vs 34" stopped
meaning anything the day it shipped. The bar is 1.5 x budget + 1 ms (a frame that
misses its slot by a display tick, every frame), held for 3 s before a shed; the shed
is log2(overshoot) rungs at once but never reaches the terminal rung in one go, and
the terminal rung also needs the GPU median (`__gpu`, EXT_disjoint_timer_query ring,
async) over half the budget — it is permanent, and a CPU-bound frame gains nothing
from losing its shadows. The other half exists: `restoreQuality()` climbs one rung
after 10 s of sustained headroom (keeps pace AND GPU median under 65% of budget), and
each shed that follows an upgrade doubles that rung's wait, so an edge machine settles.
Hidden or driven (`__power.drive`) frames never enter the window. `__perf.state()` /
`__perf.log()` show the judge's reading and every transition; `?lab` adds
`__perf.load` (ms busy-wait per frame) and `__perf.judgeHidden` for testing.

### Perf harness — MEASURE THIS WAY (roadmap/perf-budget-oct.md, 2026-10-03)

Every frame number taken before October 2026 was noise (+-3-6 ms) for three measured reasons:
1. **The hidden Browser pane runs on the efficiency cores.** macOS gives a hidden renderer
   background QoS: the same JS ran 3-4x slower (a fixed scalar kernel: 8-13 ms vs 2.1 ms in
   node). Every CPU cost - update, three's submission - inflated with it, for minutes at a
   time, with no other sign.
2. **The GPU timer query is not a cost on this platform.** EXT_disjoint_timer_query on
   ANGLE/Metal (Apple TBDR) sums command buffers that overlap each other and the previous
   frame: it read 15-17 ms for frames whose whole serialised CPU+GPU cost was 6-11 ms, 22-31
   ms with frames queued, ~17 ms under vsync whatever the load. `__gpu.median()` is kept but
   means nothing as milliseconds; per-pass timer queries are worse.
3. **Other GPU clients.** The iOS Simulator, a visible pane tab still running the game, a
   user's Chrome tab: they share the GPU. `gcal` (below) shows it.

THE HOST: a private headless Chrome over CDP, visible to itself (rAF live), normal QoS,
dpr 2, vsync OFF so rAF is unthrottled and the frame interval IS the frame cost:
`node tools/bench/cdp.mjs start 9021` (own --user-data-dir under $TMPDIR, debug port 9333;
`BENCH_VSYNC=1` keeps a 60 Hz vsync for DRS/judge checks), then `eval "<expr>"`,
`run file.js` (an async function body), `png out.png "<expr -> dataURL>"`, `reload`,
`goto <url>`, `console`, `stop`. Serve with `python3 serve.py <port>` and load `?bench`
(or `?lab`): game.js then imports `src/lib/bench.js` -> `window.__bench`. Kill both when done.

THE HARNESS (`__bench`, src/lib/bench.js; the frame hooks are in game.js, owner tags in
core.js):
- `await __bench.setup('z0')` - a STANDARD VIEW: Sal stood on a fixed seabed spot, camera
  settled, canvas CSS fixed at 1512x982 (`size(w,h)`), DRS pinned 1.0. Views: z0 (under the
  raft), z0r (dense reef/kelp), z0b (Velkath's ridge), z1 (under rift 0), z1b (Orune, 21 u),
  z2 (under rift 1), z2r (zone-2 reef). Site 0 only.
- `await __bench.live(ms)` - the REAL rAF loop, governor uncapped: mean frame interval =
  the pipelined frame cost. **The number to report.** `liveAB({a, b})` = ABBA paired;
  noise floor +-0.1-0.3 ms on a quiet machine.
- `await __bench.run({frames, mode, split, freeze, prof})` - the FIXED-STEP offscreen loop:
  the game loop is held and the real update + sky + refraction + composer step back to back
  (dt 1/60, a MessageChannel hop between frames). `mode 'sync'` (default) ends each frame
  with a 1-px readPixels: `wall` = CPU + GPU serialised; `cpuUpdate` / `cpuSubmit` split
  the CPU; `stages` = per composer pass ms / calls / tris (renderer.info accumulated across
  the composer); `split: true` syncs after every stage (ranking only); `prof` books
  update() wall time per system (game.js `pm()` marks); `cal` / `gcal` = CPU / GPU
  calibration kernels (~2.1 / ~1.2 ms here; `slowCpu` / `busyGpu` flag a contaminated run).
  `mode 'pipe'` = throughput without per-frame sync.
- `ab({a, b})` / `noise()` - paired A/B on the stepped loop (wall deltas). Coarser than
  liveAB under load; prefer liveAB.
- `hide(/owner/)` - takes a system out of the camera by owning module (layers; a module
  writing .visible each frame cannot undo it). Owners containing LIGHTS change the light
  count (programs recompile, fewer lights) - their A/B is not the system's cost.
- `draws()` - calls/triangles per owner and stage, INCLUDING the lantern's cube-shadow
  draws (`@0:RenderPass shadow`), plus the top objects.
- `capture()` / `diff(a,b)` / `png(cap)` - frozen-frame look checks (grain off). Post chain
  is not deterministic frame to frame (A/A mean ~3-5 codes); for scene-content changes
  compare under P bypass (`setPostBypass(true)`: A/A ~0.2-0.7). Compile-time changes
  (shader patches): two loads, compare against an A/A pair of loads.
- Cross-load ABBA (a branch against main): two worktrees served on two ports, alternate
  `goto` A B B A, `setup` + `live` in each (see roadmap/perf-budget-oct.md Log).
- Hazards: ANGLE/Metal DROPS a render pass whose target is cleared again before anything
  reads it (a synthetic GPU load needs additive draws, no clears); any getBufferSubData /
  readPixels / getError is a synchronous round trip that first drains Chrome's GPU-process
  queue (the auto-exposure read cost 1.8 ms of main thread per call); under vsync a GPU
  over its slot does NOT slow rAF (frames queue/drop) - the wall-time judge cannot see it,
  `__gpu.lag()` (frames from a query's issue to readable: 1 = headroom, 2 = saturated) can.

Measured 2026-10-03 (after perf-budget-oct; live, uncapped, 1512x982 CSS, M5 Max): every
standard view 3.7-6.3 ms at 1.0x and 6.1-8.3 ms at 1.5x (main: 4.0-7.4 / 7.1-9.1, same
session, cross-load ABBA); DRS (pace) holds 1.5x in every standard view under a 60 Hz vsync.

### AAA pass 2 (2026-09-28, roadmap/aaa-motion-atmos.md)
- DYNAMIC RESOLUTION: `core.js` RES_SCALE is the CEILING now; `setRenderScale` moves the
  live scale (floor 0.85) through the same coalesced applySize/flushSize path as a window
  resize. `postfx.js` `updateResScale` (inside samplePerf, so hidden/driven/idle-cap frames
  never steer it) steers on PACE + GPU BACKLOG since perf-budget-oct (the GPU timer it
  used to hold at 55-78% of the slot is not a cost on ANGLE/Metal and parked DRS at its
  floor; see "Perf harness" below). Acts before the quality ladder. `__drs.state()`,
  `__drs.pin(x)` (pins and turns it off), `__drs.sig = 'timer'` = the old signal.
- TEMPORAL AA + UPSCALING (`postfx.taa.js`, branch `taa`): the composer's LAST pass. The
  renderer's size (every composer target, `getSize`, `getDrawingBufferSize`, every uPix)
  is the INTERNAL resolution; the canvas drawing buffer is the OUTPUT resolution
  (css x RES_SCALE) and `postfx.syncCanvas` owns it per frame (internal dims on the SMAA
  path and under P bypass). Halton(2,3) x16 jitter on the projection for the whole chain,
  removed after it (`begin`/`end`); resolve = 3x3 Blackman-Harris reconstruction, closest-
  depth CAMERA reprojection, Catmull-Rom history, disocclusion by the view distance kept
  in history ALPHA, YCoCg variance clip, Karis blend; then RCAS + vignette + grain to the
  canvas. SAL AND THE RAFT get exact motion vectors (rigid hierarchies; proxies in a
  private scene, scissored colour-only velocity target, occluded against the depth copy)
  -- `addTemporalMover(root)`. Fish/creatures are vertex-animated: variance clip + clip-
  distance anti-ghost only. DRS moves only the INTERNAL res (floor 0.5 x RES_SCALE while
  TAAU runs); history lives at output res and survives every DRS step. Texture LOD bias
  = log2(internal/output) via `abyssaTaa` (water.js patchFog) + `ABYSSA_TEX` in the map
  chunks and triplanar. Resets: camera cut (>5 u/frame or >45 deg), reseed, P, resize.
  Kill switch / A-B: `__taa.on(false)` (the old SMAA tail), `__taa.state()`, `__taa.K`,
  `__taa.vel(false)`, `__taa.floor(f)`. Never shed by degradeQuality: with DRS it SAVES GPU.
- `lib/surface.js` is a GLOBAL patch on the lights chunks (path extinction, wrap, rim, wet
  film, thin-sheet transmission, medium env, horizon occlusion, specular AA). Zero
  variants; every term gated by a shared uniform. `abyssaPath.w` = specular-AA gain.
- `world/stir.js` is the shared disturbance bus (movers + startle pulses) every animal and
  plant reads; game.js pushes sleeper blows into it with `stirPulse`.
- `world/particulate.js` (bokeh, plankton, spray) and the lamp in-scatter in water.js's fog
  chunk (`syncLamps()` after updateLighting) belong to the atmosphere.
- Sleepers publish `ev.quake` (camera shake). Sal takes `diverImpulse`/`diverGrab`/
  `diverLookAt` from game.js.

### 2026-09 campaign (see roadmap/everything-better.md)
Skill-pack sweeps (shaders/textures/lighting/geometry/postfx/animation), a design
evaluation (roadmap/eval-*.md, all shipped), and two campaign waves. New systems:
wards must be LIT (verb settled), Orune's wards answer the sonar, Mhor's are squid-
kept, the octopus can steal the lantern (retrieve at the den), the mariner's story is
seeded at home (sextant + three marks in his hand), the sea receives the raft's shadow
(sampler2DShadow — never a plain sampler2D on a compare depth texture), context-loss
and frame-throw are handled visibly, reduced-motion/mute/gamepad exist. Open on
Michael: eye pass, ear pass (audio-audit), three decisions (props glTF, skyline
fingerprint, hose leash — the leash was ruled 2026-10-04, see systems/survival.js above).
