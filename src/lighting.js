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
const STOPS = [
  { d: 0.00, amb: 0x1b4a54, ambI: 0.55, sky: 0x3f9a8f, gnd: 0x11302a, hemiI: 1.00, sun: 0xcdeeff, sunI: 2.60, rim: 0x9fe8ff, rimI: 0.85, fill: 0xa6ecff, key: 0xffdca4 },
  { d: 0.42, amb: 0x152447, ambI: 0.24, sky: 0x1b3a72, gnd: 0x05080f, hemiI: 0.45, sun: 0x9fc8ff, sunI: 0.55, rim: 0x7fc0ff, rimI: 0.60, fill: 0x9fdcff, key: 0xffd294 },
  { d: 1.00, amb: 0x0a0e26, ambI: 0.075, sky: 0x0c1436, gnd: 0x02030a, hemiI: 0.14, sun: 0x6f8cff, sunI: 0.00, rim: 0x6f9cff, rimI: 0.42, fill: 0x93cbff, key: 0xffbe72 }
];
const C = (o, k) => (o['_' + k] || (o['_' + k] = new THREE.Color(o[k])));

// What the hemisphere's two ends become once the camera is out of the water.
const AIR_SKY = new THREE.Color(0xa8bcc8), AIR_SEA = new THREE.Color(0x2a3a3c);
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
// A/B'd 1024 vs 512 at a wreck wall and a vent chimney with the lantern ~2u out:
// 512 shows visible stair-stepping on the long raking shadows the murk makes
// unmissable, so the cube stays at 1024. (Verdict recorded per lighting round.)
lanternLight.shadow.mapSize.set(1024, 1024);
lanternLight.shadow.camera.near = 0.35;
lanternLight.shadow.camera.far = 34;
lanternLight.shadow.bias = -0.0015;
lanternLight.shadow.normalBias = 0.035;
scene.add(lanternLight);

// Read by postfx for depth-driven grading; kept here so there is one source of truth.
export const rig = { depth01: 0 };

const fwd = V3(), right = V3(), rimPos = V3();
let reduced = false, sunParked = false;

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
  ambient.intensity = mix('ambI') * wk * (1 - 0.74 * air);
  mixInto(hemi.color, a, b, 'sky', t);
  mixInto(hemi.groundColor, a, b, 'gnd', t);
  // Same mistake as the fill, in colour instead of level: the hemisphere's shallow stop
  // is teal over dark green because that is what a diver in the shallows sees above and
  // below him. In air it dyed the raft's timber sage, and no amount of weathering makes
  // green-grey planks look like wood. Above the interface the dome is sky and the floor
  // is the sea, so the two ends travel to those instead.
  hemi.color.lerp(AIR_SKY, air * 0.85);
  hemi.groundColor.lerp(AIR_SEA, air * 0.85);
  hemi.intensity = (mix('hemiI') * (reduced ? 1.5 : 1) * wk + flashBoost * 0.8) * (1 - 0.42 * air);
  mixInto(sun.color, a, b, 'sun', t);
  sun.intensity = mix('sunI') * wk + flashBoost * 2.2;

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
