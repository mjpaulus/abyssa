// Curated CC0 glTF props scattered on the seafloor. OWNED BY: asset-pipeline agent.
//
// EXPORTS
//   buildProps() -> Promise<{ loaded, placed }>
//     Awaitable. Loads every entry in MANIFEST, scatters it per zone with the same
//     idioms flora.js uses (terrainH/terrainNormal sampled at placement, rift funnel
//     kept clear, slope gating), and adds one InstancedMesh per prop per zone.
//     Missing/failed downloads are skipped silently — an empty assets/props/ yields
//     an empty world and zero errors.
//   updateProps(dt, t) — per-zone visibility gating plus one uniform write for sway.
//   propMeshes — the InstancedMeshes created, for diagnostics.
//   propColliders — [{x,y,z,r}] for props big enough to block the camera (same shape
//     as flora.js rockColliders); the orchestrator may concat it if it wants.
//
// ORCHESTRATOR WIRING (game.js):
//   import { buildProps, updateProps } from './world/props.js';
//   buildProps();                 // fire-and-forget: never blocks first frame
//   updateProps(dt, t);           // next to updateFlora(dt, t) in the frame loop
import * as THREE from 'three';
import { scene, camera, envTex } from '../core.js';
import { WORLD_R, riftPos, zoneTop, zoneBottom } from '../config.js';
import { rng, clamp, fbm } from '../lib/math.js';
import { terrainH, terrainNormal } from './terrain.js';
import { loadProp } from '../lib/assets.js';

const TAU = Math.PI * 2;
const BASE = 'assets/props/';
// Rift clearance required by the brief, in world units.
const RIFT_CLEAR = 45;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0), IDQ = new THREE.Quaternion();

// ------------------------------------------------------------------ manifest --
// size = world-unit height range (geometry arrives normalised to 1 unit).
// zones = which zones get it; n = instances per zone; gap = min spacing between them.
// sway  = shader sway amplitude (0 for stone); collide = register a camera collider.
// Curation: the two big Kenney rocks are CUT — their hard-faceted style reads worse than
// our smoothed procedural boulders and they kept dominating shots. Small rocks pass as
// pebbles at their scale. Logs stay as half-buried sunken timber; stumps are cut (they
// read as land clearance, not seabed). Barrels are sunken cargo and fit the fiction.
const MANIFEST = [
  { file: 'rock_smallC.glb', n: 110, gap: 5, size: [0.7, 2.0], zones: [0, 1, 2], slope: 0.6, stand: 0.95, tint: 'rock' },
  { file: 'log.glb', n: 32, gap: 9, size: [1.6, 3.4], zones: [0, 1], slope: 0.78, stand: 0.9, tint: 'wood', sway: 0, sink: 0.45 },
  { file: 'barrel.glb', n: 26, gap: 7, size: [1.1, 2.0], zones: [0, 1, 2], slope: 0.8, stand: 0.65, tint: 'wreck' }
];

// Zone moods lifted from flora.js PAL so props sit in the same muted, lantern-lit palette.
const PAL = [
  { rock: 0x1a2730, wood: 0x2b2a22, wreck: 0x243038, silt: 0x1d2a35 },
  { rock: 0x211b2b, wood: 0x272031, wreck: 0x2a2438, silt: 0x241e33 },
  { rock: 0x2a1f1c, wood: 0x2f231a, wreck: 0x33241f, silt: 0x2b1e19 }
];

// ------------------------------------------------------------------ material --
// One shared uniform block: updateProps() costs two writes regardless of instance count.
const uni = { uTime: { value: 0 }, uCur: { value: new THREE.Vector2(1, 0) } };

const V_HEAD = `
uniform float uTime; uniform vec2 uCur; uniform vec2 uCull; uniform float uSway;
attribute vec2 aInst;   // phase, sway weight`;

const V_BODY = `
#ifdef PROP_SWAY
if (uSway > 0.0) {
  float h = max(transformed.y, 0.0);
  transformed.xz += uCur * (sin(uTime * 0.6 + aInst.x) * 0.5 + 0.5) * uSway * aInst.y * h * h * 0.06;
}
#endif
vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
transformed *= 1.0 - smoothstep(uCull.x, uCull.y, distance(iw, cameraPosition));`;

const F_BODY = `
// Silt settles on upward faces; downward faces fall away into the dark. Same trick
// flora.js uses on its boulders, so props and procedural rock read as one material.
float up = inverseTransformDirection(normal, viewMatrix).y;
diffuseColor.rgb = mix(diffuseColor.rgb, uSilt, smoothstep(0.35, 0.96, up) * 0.45);
diffuseColor.rgb *= mix(0.42, 1.0, smoothstep(-0.85, 0.2, up));`;

function propMat(src, zi, sway) {
  const m = src.clone();
  m.color.copy(src.color);
  m.roughness = 0.92;
  m.metalness = 0.02;
  m.envMap = envTex;
  m.envMapIntensity = 0.1;   // low: this IBL is a reflection source only
  m.defines = sway ? { PROP_SWAY: 1 } : {};
  const cull = 175;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni, {
      uCull: { value: new THREE.Vector2(cull * 0.82, cull) },
      uSway: { value: sway || 0 },
      uSilt: { value: new THREE.Color(PAL[zi].silt) }
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + V_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + V_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSilt;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{' + F_BODY + '\n}');
  };
  m.customProgramCacheKey = () => 'prop|' + zi + '|' + (sway ? 1 : 0) + '|' + (m.map ? 1 : 0);
  return m;
}

// ----------------------------------------------------------------- placement --
function seedClusters(zi, n, minR, maxR, seed) {
  const out = [], rp = riftPos(zi);
  let guard = 0;
  while (out.length < n && guard++ < n * 70) {
    const a = Math.random() * TAU, r = rng(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_CLEAR) continue;
    if (guard < n * 35 && fbm(x * 0.011 + seed, z * 0.011 - seed) < 0.34) continue;
    out.push([x, z, rng(24, 58)]);
  }
  return out;
}

// Clumped sampling with slope gating; relaxes the limit rather than starving a prop.
// minGap keeps same-type props from piling into one unreadable blob.
function place(zi, count, seeds, minSlope, minGap) {
  const out = [], rp = riftPos(zi);
  if (!seeds.length) return out;
  let lo = minSlope, gap = minGap, guard = 0, relaxed = false;
  while (out.length < count && guard++ < count * 40) {
    if (!relaxed && guard > count * 18) { relaxed = true; lo = 1 - (1 - lo) * 2.4; gap *= 0.5; }
    const s = seeds[(Math.random() * seeds.length) | 0];
    const a = Math.random() * TAU, u = Math.pow(Math.random(), 0.8);
    const x = s[0] + Math.cos(a) * s[2] * u, z = s[1] + Math.sin(a) * s[2] * u;
    const r = Math.hypot(x, z);
    if (r > WORLD_R * 0.98 || r < 10) continue;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_CLEAR) continue;
    const n = terrainNormal(x, z, zi);
    if (n.y < lo) continue;
    if (gap > 0 && out.some(o => Math.hypot(o.x - x, o.z - z) < gap)) continue;
    out.push({ x, z, y: terrainH(x, z, zi), n });
  }
  return out;
}

function stand(n, blend, yaw) {
  _q2.setFromUnitVectors(UP, n);
  if (blend < 1) _q2.slerp(IDQ, 1 - blend);
  return _q2.multiply(_q.setFromAxisAngle(UP, yaw));
}

// -------------------------------------------------------------------- build ---
export const propColliders = [];
const zones = [];
export const propMeshes = [];

export async function buildProps() {
  const results = await Promise.all(MANIFEST.map(e => loadProp(BASE + e.file).catch(() => null)));
  const entries = [];
  for (let i = 0; i < MANIFEST.length; i++) if (results[i]) entries.push({ cfg: MANIFEST[i], prop: results[i] });
  if (!entries.length) return { loaded: 0, placed: 0 };

  let placed = 0;
  for (let zi = 0; zi < 3; zi++) {
    const use = entries.filter(e => e.cfg.zones.includes(zi));
    if (!use.length) continue;
    if (!zones[zi]) { zones[zi] = new THREE.Group(); scene.add(zones[zi]); }
    const seeds = seedClusters(zi, 26, 20, WORLD_R * 0.94, zi * 13.7 + 5);

    for (const { cfg, prop } of use) {
      const L = place(zi, cfg.n, seeds, cfg.slope, cfg.gap || 0);
      if (!L.length) continue;
      const g = prop.geometry.clone();
      g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(L.length * 2), 2));
      const mat = propMat(prop.material, zi, cfg.sway || 0);
      const im = new THREE.InstancedMesh(g, mat, L.length);
      im.receiveShadow = !!cfg.shadow;
      im.castShadow = false;
      im.frustumCulled = false;
      const a = g.attributes.aInst.array;
      const base = PAL[zi][cfg.tint];
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        const H = rng(cfg.size[0], cfg.size[1]) * (0.75 + 0.6 * fbm(p.x * 0.05 + 3, p.z * 0.05));
        const W = H * rng(0.8, 1.3);
        // Bed every prop slightly into the terrain so none ever reads as floating.
        // cfg.sink beds the prop into the silt (0 = base on the surface)
        _m.compose(_p.set(p.x, p.y - H * (0.12 + (cfg.sink || 0)), p.z), stand(p.n, cfg.stand, rng(0, TAU)), _s.set(W, H, W));
        im.setMatrixAt(i, _m);
        // Multiply toward the zone mood rather than replacing: keeps the source's
        // own value variation while dropping it into the muted palette.
        _c.set(base).multiplyScalar(rng(0.85, 1.6));
        im.setColorAt(i, _c);
        a[i * 2] = Math.random() * TAU;
        a[i * 2 + 1] = clamp(rng(0.5, 1), 0, 1);
        if (cfg.collide && H >= cfg.collide) propColliders.push({ x: p.x, y: p.y + H * 0.45, z: p.z, r: Math.max(W, H) * 0.45 });
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      g.attributes.aInst.needsUpdate = true;
      zones[zi].add(im);
      propMeshes.push(im);
      placed += L.length;
    }
  }
  return { loaded: entries.length, placed };
}

export function updateProps(dt, t) {
  uni.uTime.value = t;
  const a = 0.9 + 0.5 * Math.sin(t * 0.055);
  uni.uCur.value.set(Math.cos(a), Math.sin(a));
  const y = camera.position.y;
  for (let zi = 0; zi < 3; zi++)
    if (zones[zi]) zones[zi].visible = y < zoneTop(zi) + 120 && y > zoneBottom(zi) - 150;
}
