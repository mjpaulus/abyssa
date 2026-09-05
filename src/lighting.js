// Scene lighting rig. OWNED BY: lighting/post agent.
import * as THREE from 'three';
import { scene, camera } from './core.js';
import { SUN, SURFACE_Y, GLASS } from './config.js';
import { V3, clamp } from './lib/math.js';
// SKY DRAMA ambience, published by water.js's updateWater: {fog, moon}, both 0..1.
// Imported rather than wired through game.js because it is a READ of a value water.js
// already resolves each frame — there is no state here and nothing to keep in sync.
// The import is one-way (water.js does not import lighting.js) so there is no cycle.
// A BRIGHT MOON IS NOT A LIGHT. Adding a Light object would change the scene's light
// count, which recompiles every lit material in the game mid-frame — the same hazard
// the vents' single shared PointLight exists to avoid. The moon lifts the hemisphere and
// the ambient, and nothing else.
import { airAmbience } from './world/water.js';

// THE SUN IS LIVE. This used to be baked from SUN_ELEV_DEG at module load; it is now a
// mirror of config.js's SUN.dir, rewritten IN PLACE by updateLighting every frame the
// sun actually moves. The object identity never changes, so anything holding a
// reference keeps working — but nothing may assume the numbers are constant.
export const SUN_VEC = new THREE.Vector3(SUN.dir.x, SUN.dir.y, SUN.dir.z);

// Depth palette. World albedos are extremely dark (terrain ~0x14222e), so ambient terms
// stay low on purpose: contrast comes from the lantern key and the cool rim, not from fill.
// teal-green shallows -> indigo mid -> near-black abyss with warm lantern contrast.
// Luminous green shallows -> twilight -> untouched near-black abyss: the descent arc is
// brightness the player gives up. Tuned against the NMS reference frame.
// THE FLOW LEAN (roadmap/flow-lean-style.md, item 11): every stop also carries an
// explicit TEMPERATURE PAIR — `kw`, the warm the key (lantern, and the sun when it is
// the key) is pushed toward, and `cf`, the cool the fill/haze side is pushed toward.
// Neither is read at styleK 0; the shipped columns are untouched and stay the
// authorship. Flow's law is hue separation with compressed values: the pair gets
// warmer/cooler with depth rather than brighter/darker, so the abyss stays near-black
// but a lit ward down there is apricot against indigo, not white against black.
const STOPS = [
  { d: 0.00, amb: 0x1b4a54, ambI: 0.55, sky: 0x3f9a8f, gnd: 0x11302a, hemiI: 1.00, sun: 0xcdeeff, sunI: 2.60, rim: 0x9fe8ff, rimI: 0.85, fill: 0xa6ecff, key: 0xffdca4, kw: 0xffc98a, cf: 0x7fd8ff },
  { d: 0.42, amb: 0x152447, ambI: 0.24, sky: 0x1b3a72, gnd: 0x05080f, hemiI: 0.45, sun: 0x9fc8ff, sunI: 0.55, rim: 0x7fc0ff, rimI: 0.60, fill: 0x9fdcff, key: 0xffd294, kw: 0xffbf7c, cf: 0x6fb4ff },
  { d: 1.00, amb: 0x0a0e26, ambI: 0.075, sky: 0x0c1436, gnd: 0x02030a, hemiI: 0.14, sun: 0x6f8cff, sunI: 0.00, rim: 0x6f9cff, rimI: 0.42, fill: 0x93cbff, key: 0xffbe72, kw: 0xffa85c, cf: 0x5f86ff }
];
const C = (o, k) => (o['_' + k] || (o['_' + k] = new THREE.Color(o[k])));

// What the hemisphere's two ends become once the camera is out of the water.
const AIR_SKY = new THREE.Color(0xa8bcc8), AIR_SEA = new THREE.Color(0x2a3a3c);
// The air regime's temperature pair (item 11): the sun is the warm key above water and
// the sky dome is the cool fill. AIR_SUN_W is where the sun's colour travels when it is
// low (dusk/dawn apricot); AIR_SKY_C is the cooler dome the shadow side is filled from;
// AIR_SEA_L is the lifted, slightly cool sea floor of the hemisphere so deck shadows
// feather instead of pitching (item 10). All three are only reached through styleK.
const AIR_SUN_W = new THREE.Color(0xffcf9a), AIR_SKY_C = new THREE.Color(0x98b4d2), AIR_SEA_L = new THREE.Color(0x3a4c54);

// THE DIAL. GLASS.style.flowLean is the master (0 = shipped, 1 = full lean); the
// `light` sub-knob overrides it when >= 0. Read every frame — GLASS is live data and
// nothing may cache out of it. At styleK() = 0 every path below is either skipped or
// multiplies by exactly 1 / lerps by exactly 0, so the shipped frame is bit-identical.
function styleK(sub = 'light') {
  const s = GLASS.style;
  if (!s) return 0;
  const m = clamp(+s.flowLean || 0, 0, 1);
  const v = s[sub];
  return (v === undefined || v === null || v < 0) ? m : clamp(+v, 0, 1);
}
// A fog morning has ONE light in it: a bright shadowless lid, the same value in every
// direction. So both ends of the hemisphere travel to the same near-white and the key
// light goes away — the flatness IS the effect, and it is why a fog frame reads as fog
// and not as an overcast one. Cool-neutral, never blue: fog is grey.
const FOG_LIGHT = new THREE.Color(0xc3c9cc);
// The moon's colour on the deck. Cool and desaturated — moonlight looks blue because the
// eye is dark-adapted, not because it is blue.
const MOON_SKY = new THREE.Color(0x8fa6c8);

export const ambient = new THREE.AmbientLight(0x1b4a54, 0.30);
scene.add(ambient);

// Downwelling sunlight. Dies off by the time the first zone floor is reached.
export const sun = new THREE.DirectionalLight(0xcdeeff, 1.8);
// Pushed out to 40 units. Direction is position-minus-target, so this does not change a
// single shading result — but a shadow camera sits AT the light, and from 1 unit up the
// raft's own davit was behind its near plane.
sun.position.copy(SUN_VEC).multiplyScalar(40);
// THE SUN CASTS SHADOWS OVER THE RAFT AND NOWHERE ELSE. Above water is the only place
// in this game with a hard light and a man-made object for it to rake across, and
// without contact shadows a detailed deck reads as flat decals. The ortho box is 18
// units around the origin, which is exactly where the raft is moored, so the map costs
// the raft and nothing else — every other object in the world is outside the frustum
// and culled before it is drawn. postfx reads sun.position normalized, so the move is
// invisible to the god rays too.
// light.layers scoping (excluding the sun from underwater materials) was evaluated and
// DECLINED: three gathers lights per-render, so layers can't exclude one light per-
// material without changing the effective light count — i.e. recompile risk, the exact
// hazard this file exists to avoid — and the sun already blends to intensity 0
// underwater, so there is nothing to save. Do not re-suggest.
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
sun.shadow.camera.near = 28; sun.shadow.camera.far = 72;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.045;
// F4 hysteresis timer for the castShadow gate in updateLighting: wall-clock ms since
// the raw condition first disagreed with the current state; 0 = in agreement.
let shadowFlipSince = 0;
scene.add(sun);

// Sky/seabed gradient — gives up-facing surfaces a different colour to down-facing ones,
// which is most of what sells "underwater" before any post runs.
export const hemi = new THREE.HemisphereLight(0x2e7d88, 0x081a1e, 0.6);
scene.add(hemi);

// Cool backlight that rides the camera so the diver never dissolves into the murk.
export const rim = new THREE.DirectionalLight(0x9fe8ff, 0.85);
scene.add(rim, rim.target);

// Soft fill that travels with the diver so he never silhouettes to pure black.
export const playerLightSrc = new THREE.PointLight(0x9fe8ff, 60, 60, 1.8);
scene.add(playerLightSrc);

// The hand lantern: the one shadow-casting light in the scene. distance matches
// shadow.camera.far (34) — light past the shadow camera's reach cast no shadows and
// just paid falloff for nothing.
export const lanternLight = new THREE.PointLight(0xffdca4, 25, 34, 1.9);
lanternLight.castShadow = true;
// A/B'd 1024 vs 512 live at the skiff wreck (lantern ~2u from the hull and the crate
// sled): no visible stair-stepping at 512 on either the hull planking or the crate
// contact shadow — the murk and the short 34u range soften the edge before the texel
// grid can read. 512 ships: 6x fewer texels on the game's one recurring cube shadow.
lanternLight.shadow.mapSize.set(512, 512);
lanternLight.shadow.camera.near = 0.35;
lanternLight.shadow.camera.far = 34;
lanternLight.shadow.bias = -0.0015;
lanternLight.shadow.normalBias = 0.035;
scene.add(lanternLight);

// THE LANTERN'S GUTTER. A hit (shark bite, a sleeper's slam) knocks the flame: for
// ~1.2 s the lantern gutters — deep, irregular dips that ride on top of the everyday
// sine flicker game.js already applies — and then it steadies. An envelope, not a
// state: kickLantern() arms it, lanternGutter() decays it and returns the multiplier.
// The dips are shaped by two incommensurate sines so no two gutters repeat, and the
// floor is 0.08 rather than 0: the flame is knocked, never out.
let gutterT = 0, gutterDur = 1.2;
export function kickLantern(dur = 1.2) { gutterDur = dur; gutterT = Math.max(gutterT, dur); }
export function lanternGutter(dt, t) {
  if (gutterT <= 0) return 1;
  gutterT = Math.max(0, gutterT - dt);
  const env = gutterT / gutterDur;                       // 1 at the hit, 0 as it steadies
  const g = 0.5 + 0.5 * Math.sin(t * 43) * Math.sin(t * 71 + 1.3);   // 0..1, jittery
  const dip = env * (0.35 + 0.57 * g);                   // deepest right after the hit
  return Math.max(0.08, 1 - dip);
}

// Read by postfx for depth-driven grading; kept here so there is one source of truth.
// `steer` is the rim-steering probe (item 9): which source won this frame and how sure.
export const rig = { depth01: 0, steer: { src: 'none', score: 0, sunS: 0, lampS: 0, lantS: 0, conf: 0, dir: [0, 0, 0] } };

const fwd = V3(), right = V3(), rimPos = V3();
let reduced = false, sunParked = false;

// ---- RIM STEERING (item 9) ----------------------------------------------------------
// Flow's key is BEHIND the subject. The rim used to ride the camera (up, forward, kicked
// left); at styleK it is steered toward the brightest source on the far side of Sal —
// the sun (above water, or the Snell-clamped sun below), the nearest lit ward, the vent
// throat, the raft's lamps, or his own lantern when he faces away from it — and takes
// that source's colour. The choice is eased so a ward passing behind him swings the edge
// light over ~0.4 s rather than snapping it. NO LIGHT IS ADDED: the same DirectionalLight
// is re-aimed, which is a position write. Point sources are gathered by a scene walk
// every 2 s (the pool is fixed for the game's life — see the light-count law — so the
// walk only ever finds the same 8 lights; it exists so this file needs no import from
// leviathan.js / vents.js / raft.js).
const steerDir = V3(0, 1, 0), steerCol = new THREE.Color(1, 1, 1);
const candDir = V3(), bestDir = V3(), tmpV = V3(), steerPos = V3();
const bestCol = new THREE.Color(), tmpCol = new THREE.Color();
let steerConf = 0, lastSteerT = 0, lastScanT = -1e9;
// The incumbent source keeps a 30% edge. The lantern's everyday sine flicker and a
// setting sun cross each other's score many times a second otherwise, and the rim
// would shuttle between two directions instead of easing to one.
let steerSrc = null;
const HOLD = 1.3;
let srcLights = [];
function scanSources() {
  const out = [];
  scene.traverse(o => {
    if (o.isPointLight && o !== playerLightSrc && o !== lanternLight) out.push(o);
  });
  srcLights = out;
}
// Behind-ness: 1 when the source is straight ahead of the CAMERA (i.e. beyond Sal), 0
// when it is behind the camera (a front light, which the rim must never become).
const behindW = (d) => { const c = d.dot(fwd); return c <= 0 ? 0 : c * c; };
function steerRim(k, air, dt) {
  const subj = playerLightSrc.position;
  let best = 0;
  // 1. The sun. Above the interface it is the real sun; below, the Snell-clamped one so
  //    the backlight can never come from an angle the sea cannot produce.
  const sd = SUN.dirWater;
  candDir.set(SUN_VEC.x + (sd.x - SUN_VEC.x) * (1 - air), SUN_VEC.y + (sd.y - SUN_VEC.y) * (1 - air), SUN_VEC.z + (sd.z - SUN_VEC.z) * (1 - air)).normalize();
  //    In air the sun is the shot's key and gets a 50% edge over point sources: a lamp
  //    1 u away always wins on irradiance, and Flow's deck at dusk is lit by the sun.
  const sunS = clamp(sun.intensity / 2.6, 0, 1) * behindW(candDir) * (1 + 0.5 * air) * (steerSrc === sun ? HOLD : 1);
  const st = rig.steer; st.sunS = sunS; st.lampS = 0; st.lantS = 0;
  let win = null;
  if (sunS > best) { best = sunS; bestDir.copy(candDir); bestCol.copy(sun.color); win = sun; }
  // 2. Point sources: wards, vent throat, raft lamps. Irradiance at Sal with three's
  //    physical falloff, normalised so a lit ward (140) saturates at ~14 u and the vent
  //    throat (6.5) reads at ~5 u; a dark ward (intensity 0) is never a candidate.
  const now = performance.now();
  if (now - lastScanT > 2000) { lastScanT = now; scanSources(); }
  for (let i = 0; i < srcLights.length; i++) {
    const L = srcLights[i];
    if (!(L.intensity > 0.01) || !L.visible) continue;
    L.getWorldPosition(tmpV);
    candDir.subVectors(tmpV, subj);
    const d = candDir.length();
    if (d < 0.6 || (L.distance > 0 && d > L.distance)) continue;
    candDir.multiplyScalar(1 / d);
    let irr = L.intensity / (d * d);
    if (L.distance > 0) { const q = d / L.distance, q4 = q * q * q * q; irr *= (1 - q4) * (1 - q4); }
    const s = clamp(irr / 0.7, 0, 1) * behindW(candDir) * (steerSrc === L ? HOLD : 1);
    if (s > st.lampS) st.lampS = s;
    if (s > best) { best = s; bestDir.copy(candDir); bestCol.copy(L.color); win = L; }
  }
  // 3. His own lantern, when he faces away from it: the hand is beyond him from the
  //    camera, so the flame rims his helmet and shoulders. Gated hard on behind-ness
  //    and weighted at 0.45 (it is 0.8 u away and would otherwise always win on
  //    irradiance): it is the rim when nothing else is behind him, and a ward or a
  //    throat he walks toward takes over.
  candDir.subVectors(lanternLight.position, subj);
  if (candDir.lengthSq() > 0.04) {
    candDir.normalize();
    const c = candDir.dot(fwd);
    const gate = clamp((c - 0.15) / 0.45, 0, 1);
    const s = clamp(lanternLight.intensity / 12, 0, 1) * 0.45 * gate * gate * (steerSrc === lanternLight ? HOLD : 1);
    st.lantS = s;
    if (s > best) { best = s; bestDir.copy(candDir); bestCol.copy(lanternLight.color); win = lanternLight; }
  }
  // Ease: direction, colour and confidence all on the same ~0.4 s time constant.
  const e = 1 - Math.exp(-dt * 2.5);
  const conf = clamp(best / 0.25, 0, 1);
  steerConf += (conf - steerConf) * e;
  if (conf > 0.001) {
    steerDir.lerp(bestDir, e).normalize();
    steerCol.lerp(bestCol, e);
  }
  steerSrc = win;
  st.src = win === null ? 'none' : win === sun ? 'sun' : win === lanternLight ? 'lantern' : 'point';
  st.score = best; st.conf = steerConf; st.dir[0] = steerDir.x; st.dir[1] = steerDir.y; st.dir[2] = steerDir.z;
  return steerConf;
}

// Perf tier 2 (postfx.js): the sun's shadow pass is raft-only cosmetics — ~35 casters
// re-rendered every frame the camera is near the surface — and it goes before the
// lantern shadow ever would. A flag rather than sun.castShadow directly, because
// updateLighting recomputes that property every frame and would switch it back on.
export function parkSunShadow() { sunParked = true; }

function blend(depth01) {
  let i = 0;
  while (i < STOPS.length - 2 && depth01 > STOPS[i + 1].d) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  return { a, b, t: clamp((depth01 - a.d) / (b.d - a.d), 0, 1) };
}

function mixInto(target, a, b, k, t) {
  target.copy(C(a, k)).lerp(C(b, k), t);
}

// Weather modulation (set by game.js from the weather system). Day/storm only bite
// near the surface — by mid zone 0 the water column has eaten the difference, which
// keeps the abyss identical day or night.
let wDay = 1, wStorm = 0, wFlash = 0, wDeep = 0;
// `env` is weather.js's single storm envelope {sky, sea, below}. When it is passed, the
// near-surface bite reads env.sky and the deeper bite reads env.below, so the light and
// the water are provably on the same eased curve. Omitted (or absent), both fall back to
// raw storm — which is exactly what shipped, so the anchor is untouched.
export function setWeatherLight(day, storm, flash, env) {
  wDay = day; wFlash = flash;
  wStorm = env ? env.sky : storm;
  wDeep = env ? env.below : storm;
}

// The key light and its raft-only shadow camera ride SUN.dir. Both are pure
// position writes, and they are skipped entirely on the frames the sun has not moved
// (which is most of them at 12 real minutes per day) — a moved directional light makes
// three rebuild the shadow matrices, and there is no reason to pay for that at 0 delta.
let lastElev = -1e9, lastAzim = -1e9;
function trackSun() {
  if (SUN.elevDeg === lastElev && SUN.azimDeg === lastAzim) return;
  lastElev = SUN.elevDeg; lastAzim = SUN.azimDeg;
  SUN_VEC.set(SUN.dir.x, SUN.dir.y, SUN.dir.z);
  // 40 units out: the shadow camera sits AT the light and near/far are tuned for that
  // stand-off. Direction is position-minus-target, so the distance is cosmetic to
  // shading and load-bearing to the shadow frustum. See the note on sun.position.
  sun.position.copy(SUN_VEC).multiplyScalar(40);
  sun.updateMatrixWorld();
}

// Called each frame with normalized depth 0..1 so lighting can respond to descent.
export function updateLighting(depth01) {
  rig.depth01 = depth01;
  trackSun();
  const { a, b, t } = blend(depth01);
  const mix = (k) => a[k] + (b[k] - a[k]) * t;
  // The Flow lean, read once per frame. Every use below is a multiply-by-1 or lerp-by-0
  // at sk = 0; the steering and shadow-radius writes are skipped outright.
  const sk = styleK('light');

  const surf = 1 - clamp(depth01 * 2.4, 0, 1);       // weather influence, gone by ~40% depth
  const dayK = 0.20 + 0.80 * wDay;                   // deep night keeps a moonlit 20%
  // The gale reaches the top of the column before it reaches the water under it, so the
  // storm term travels from env.sky at the interface to env.below by the bottom of the
  // weather band. Identical to the old single-scalar form whenever the two agree — i.e.
  // at every steady state, and always when game.js passes no envelope.
  // THE SUNLIT-STORM GATE, and it is the SAME expression game.js applies to the surface
  // irradiance and palette() applies to the storm stop — one principle, three places, so
  // a noon gale cannot end up bright in the water and black on the deck. Michael's
  // poseidon reference is a BRIGHT storm; the 45% cut here was describing DARKNESS while
  // keying off STORM, and with everything else fixed the deck stayed near-black in a noon
  // gale. At day 1 the cut is 15.75%, at day 0 it is the shipped 45% exactly — so a night
  // gale is bit-identical and the dread is untouched.
  const stormBite = wDeep + (wStorm - wDeep) * surf;
  const stormK = 1 - 0.45 * stormBite * (1 - 0.65 * wDay);
  const wk = 1 - surf * (1 - dayK * stormK);
  const flashBoost = surf * wFlash;

  // ABOVE THE WATERLINE THE FILL HAS TO GO. Every stop in this table describes being IN
  // the water, where the column scatters light into every shadow from every direction —
  // which is why the shallow stop carries amb 0.55 and hemi 1.00. Applied in air those
  // same terms flood the raft's deck until the sun's own shadows are barely a tint, and
  // a deck with no shadows on it renders flat however much detail is carpentered into
  // it. Out of the water there is only sky: keep most of the hemisphere, lose the omni.
  // Blended over 1.6 units across the surface, so nothing pops as Sal steps off; below
  // the interface every frame is bit-identical to before.
  const air = clamp((camera.position.y - SURFACE_Y + 0.6) / 1.6, 0, 1);
  mixInto(ambient.color, a, b, 'amb', t);
  // Item 10, shadow-side lift: in air the omni fade eases from 74% to 54% and the
  // hemisphere's from 42% to 28% at full lean, so the deck's shadows are filled by sky
  // instead of pitching; underwater the hemisphere carries what the fill gives up
  // (item 9) — +22% at full lean — and the omni ambient a hair.
  ambient.intensity = mix('ambI') * wk * (1 - (0.74 - 0.20 * sk) * air) * (1 + 0.10 * sk * (1 - air));
  mixInto(hemi.color, a, b, 'sky', t);
  mixInto(hemi.groundColor, a, b, 'gnd', t);
  // Same mistake as the fill, in colour instead of level: the hemisphere's shallow stop
  // is teal over dark green because that is what a diver in the shallows sees above and
  // below him. In air it dyed the raft's timber sage, and no amount of weathering makes
  // green-grey planks look like wood. Above the interface the dome is sky and the floor
  // is the sea, so the two ends travel to those instead.
  hemi.color.lerp(AIR_SKY, air * 0.85);
  hemi.groundColor.lerp(AIR_SEA, air * 0.85);
  hemi.intensity = (mix('hemiI') * (reduced ? 1.5 : 1) * wk + flashBoost * 0.8) * (1 - (0.42 - 0.14 * sk) * air) * (1 + 0.22 * sk * (1 - air));
  mixInto(sun.color, a, b, 'sun', t);
  sun.intensity = mix('sunI') * wk + flashBoost * 2.2;
  if (sk > 0) {
    // Item 11, the temperature split. The sun is the warm key: in air it travels to
    // apricot, the more the lower it sits (30% at noon, 85% at the horizon — Flow's noon
    // is still warm-vs-cool); under water the column has already filtered it, so the
    // push is the stop's own kw at 30% and dies with the sun itself. The dome is the
    // cool fill: the sky end of the hemisphere goes cooler in air, the shallow-stop teal
    // toward the stop's cf below. The sea end lifts (item 10) so shadows have a floor.
    const lowSun = 1 - clamp((SUN.elevDeg - 8) / 37, 0, 1);
    const lowS = lowSun * lowSun * (3 - 2 * lowSun);
    sun.color.lerp(AIR_SUN_W, sk * air * (0.30 + 0.55 * lowS));
    mixInto(tmpCol, a, b, 'kw', t);
    sun.color.lerp(tmpCol, sk * (1 - air) * 0.30);
    hemi.color.lerp(AIR_SKY_C, sk * air * 0.55);
    hemi.color.lerp(C(t < 0.5 ? a : b, 'cf'), sk * (1 - air) * 0.22);
    hemi.groundColor.lerp(AIR_SEA_L, sk * air * 0.55);
    // Values compressed, not contrast: the key comes down 15% in air as the fill rises.
    sun.intensity *= 1 - 0.15 * sk * air;
  }

  // --- SKY DRAMA ambience (air only) ---------------------------------------
  // Both terms are scaled by `air`, so BELOW THE INTERFACE EVERY FRAME IS UNCHANGED —
  // the same discipline the AIR_SKY/AIR_SEA travel above follows, and the reason the
  // underwater regression anchors through this card.
  const fogK = airAmbience.fog * air;
  if (fogK > 0.004) {
    hemi.color.lerp(FOG_LIGHT, fogK * 0.88);
    hemi.groundColor.lerp(FOG_LIGHT, fogK * 0.62);
    hemi.intensity *= 1 + 0.38 * fogK;
    ambient.intensity *= 1 + 0.30 * fogK;
    // The key is the first casualty of a marine layer: there is no direction left in the
    // light. This also retires the raft's shadow map on its own through the gate below,
    // which is correct — a fog morning casts no shadows.
    sun.intensity *= 1 - 0.86 * fogK;
  }
  // A bright moon lifts the night, it does not light it: hemisphere and ambient only,
  // and only in the top of the column (surf), so the abyss is moon-blind exactly the way
  // it is weather-blind.
  const moonK = airAmbience.moon * surf;
  if (moonK > 0.004) {
    const lift = 1 + GLASS.moon.hemiLift * moonK;
    hemi.color.lerp(MOON_SKY, moonK * 0.45 * air);
    hemi.intensity *= lift;
    ambient.intensity *= lift;
  }
  // The shadow map only ever contains the raft, so stop rendering it the moment the
  // camera is deep enough that the raft is a dot, or dark enough that it casts nothing.
  // HYSTERESIS: flipping castShadow changes the scene's shadow-map count, which forces
  // a full-scene shader program switch — so a flicker of the raw condition (a diver
  // bobbing across y = -26, a flash grazing the 0.15 intensity gate) must not thrash
  // it every frame. The raw condition has to HOLD for ~1s continuously before the
  // flip lands. Module-scoped timer, zero allocation.
  const wantShadow = !reduced && !sunParked && camera.position.y > -26 && sun.intensity > 0.15;
  if (wantShadow === sun.castShadow) {
    shadowFlipSince = 0;
  } else {
    const now = performance.now();
    if (shadowFlipSince === 0) shadowFlipSince = now;
    else if (now - shadowFlipSince > 1000) { sun.castShadow = wantShadow; shadowFlipSince = 0; }
  }
  mixInto(rim.color, a, b, 'rim', t);
  rim.intensity = reduced ? 0 : mix('rimI');
  mixInto(playerLightSrc.color, a, b, 'fill', t);
  mixInto(lanternLight.color, a, b, 'key', t);

  // Rim sits behind and above whatever the camera is framing (the diver rides playerLightSrc),
  // kicked to one side so the edge light is asymmetric rather than a flat halo.
  camera.getWorldDirection(fwd);
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  rim.target.position.copy(playerLightSrc.position);
  rimPos.copy(rim.target.position).addScaledVector(fwd, 14).addScaledVector(right, -6);
  rimPos.y += 9;
  // Facing straight down on a descent puts +14 fwd BELOW the diver — the rim ends up
  // under the seabed and Sal loses his edge light exactly when the frame is darkest.
  // Clamp: never let the rim sink more than 2u below the diver's own fill light.
  // (playerLightSrc.y is already resolved this frame and cheaper than a terrainH call.)
  if (rimPos.y < playerLightSrc.position.y + 2) rimPos.y = playerLightSrc.position.y + 2;

  if (sk > 0) {
    // ---- THE FLOW LEAN, Sal's rig (items 9, 10, 11) --------------------------------
    const now = performance.now();
    const dt = lastSteerT ? Math.min(0.1, (now - lastSteerT) * 0.001) : 0.016;
    lastSteerT = now;
    // Item 9: BACKLIGHT FIRST. The rim is steered toward the brightest source beyond Sal
    // and takes its colour; where nothing is behind him it keeps the camera-riding
    // default, pushed toward the stop's cool. Intensity rises 90% at full lean, plus a
    // further 50% x confidence when a real source is found (it is that source's rim).
    const conf = steerRim(sk, air, dt);
    steerPos.copy(rim.target.position).addScaledVector(steerDir, 17);
    if (steerPos.y < playerLightSrc.position.y + 2) steerPos.y = playerLightSrc.position.y + 2;
    rimPos.lerp(steerPos, sk * conf);
    rim.color.lerp(C(t < 0.5 ? a : b, 'cf'), sk * 0.35);
    rim.color.lerp(steerCol, sk * 0.70 * conf);
    rim.intensity *= 1 + sk * (0.90 + 0.50 * conf);
    // Item 9: THE FILL GOES TO HAZE. The omni that rides Sal drops 55% and its colour
    // travels to the hue of the water the camera sits in (scene.fog.color is surface
    // irradiance, normalised to a hue here so the value is unchanged) — his front is
    // filled by the medium's own scatter, never by a hard fill. Above water there is no
    // haze fill; the shipped air fade already retires the omni. game.js writes the
    // intensity every frame before this runs, so the scale never compounds.
    playerLightSrc.intensity *= 1 - 0.55 * sk;
    const fc = scene.fog && scene.fog.color;
    if (fc) {
      const m = Math.max(fc.r, fc.g, fc.b);
      if (m > 1e-6) { tmpCol.set(fc.r / m, fc.g / m, fc.b / m); playerLightSrc.color.lerp(tmpCol, sk * 0.70 * (1 - air)); }
    }
    // Item 9/11: the key is softened and warmed — the lantern loses 12% and travels
    // 55% of the way to the stop's warm. The shipped lantern is already warm; kw is a
    // deeper apricot so it separates from the cool fill by hue, not by level.
    lanternLight.intensity *= 1 - 0.12 * sk;
    mixInto(tmpCol, a, b, 'kw', t);
    lanternLight.color.lerp(tmpCol, sk * 0.55);
    // Item 10: SHADOW SOFTNESS. Three r184's PCF path scales its 5-tap Vogel disk by
    // shadow.radius (a uniform — no recompile, and the map itself is unchanged), so the
    // raft map's kernel widens from 1 texel to 7 (0.12 u on the 18-unit box) and the
    // lantern's cube map from 1 to 3. Broad, feathered, still attached at the contact.
    sun.shadow.radius = 1 + 6 * sk;
    lanternLight.shadow.radius = 1 + 2 * sk;
  } else if (sun.shadow.radius !== 1) {
    // The dial came back to 0 mid-session: restore the shipped kernel exactly.
    sun.shadow.radius = 1; lanternLight.shadow.radius = 1;
  }
  rim.position.copy(rimPos);
}

// Adaptive-quality fallback: drop the shadow map (6 cube faces) and the rim light,
// then lean on the hemisphere term so the scene stays readable without them.
export function degradeLighting() {
  if (reduced) return;
  reduced = true;
  lanternLight.castShadow = false;
  sun.castShadow = false;
  rim.visible = false;
}
