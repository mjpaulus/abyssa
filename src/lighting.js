// Scene lighting rig. OWNED BY: lighting/post agent.
import * as THREE from 'three';
import { scene, camera } from './core.js';
import { V3, clamp } from './lib/math.js';

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

export const ambient = new THREE.AmbientLight(0x1b4a54, 0.30);
scene.add(ambient);

// Downwelling sunlight. Dies off by the time the first zone floor is reached.
export const sun = new THREE.DirectionalLight(0xcdeeff, 1.8);
sun.position.set(0.2, 1, 0.1);
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

// The hand lantern: the one shadow-casting light in the scene.
export const lanternLight = new THREE.PointLight(0xffdca4, 25, 40, 1.9);
lanternLight.castShadow = true;
lanternLight.shadow.mapSize.set(1024, 1024);
lanternLight.shadow.camera.near = 0.35;
lanternLight.shadow.camera.far = 34;
lanternLight.shadow.bias = -0.0015;
lanternLight.shadow.normalBias = 0.035;
scene.add(lanternLight);

// Read by postfx for depth-driven grading; kept here so there is one source of truth.
export const rig = { depth01: 0 };

const fwd = V3(), right = V3(), rimPos = V3();
let reduced = false;

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
let wDay = 1, wStorm = 0, wFlash = 0;
export function setWeatherLight(day, storm, flash) { wDay = day; wStorm = storm; wFlash = flash; }

// Called each frame with normalized depth 0..1 so lighting can respond to descent.
export function updateLighting(depth01) {
  rig.depth01 = depth01;
  const { a, b, t } = blend(depth01);
  const mix = (k) => a[k] + (b[k] - a[k]) * t;

  const surf = 1 - clamp(depth01 * 2.4, 0, 1);       // weather influence, gone by ~40% depth
  const dayK = 0.20 + 0.80 * wDay;                   // deep night keeps a moonlit 20%
  const stormK = 1 - 0.45 * wStorm;
  const wk = 1 - surf * (1 - dayK * stormK);
  const flashBoost = surf * wFlash;

  mixInto(ambient.color, a, b, 'amb', t);
  ambient.intensity = mix('ambI') * wk;
  mixInto(hemi.color, a, b, 'sky', t);
  mixInto(hemi.groundColor, a, b, 'gnd', t);
  hemi.intensity = mix('hemiI') * (reduced ? 1.5 : 1) * wk + flashBoost * 0.8;
  mixInto(sun.color, a, b, 'sun', t);
  sun.intensity = mix('sunI') * wk + flashBoost * 2.2;
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
  rim.position.copy(rimPos);
}

// Adaptive-quality fallback: drop the shadow map (6 cube faces) and the rim light,
// then lean on the hemisphere term so the scene stays readable without them.
export function degradeLighting() {
  if (reduced) return;
  reduced = true;
  lanternLight.castShadow = false;
  rim.visible = false;
}
