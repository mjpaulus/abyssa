// Ambient sea life: boid fish schools, pulse-propelled jellyfish, and abyssal
// bioluminescent drifters. OWNED BY: creatures agent.
//
// Everything here is instanced and shader-animated: the CPU only steers a few
// hundred boids and ~21 jellyfish bodies; undulation, tentacle lag, ribbon
// motion and glow all live in vertex shaders so the frame cost stays flat.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { WORLD_R, zoneTop, zoneBottom } from '../config.js';
import { clamp, V3 } from '../lib/math.js';
import { glowTex } from '../lib/textures.js';
import { terrainH } from './terrain.js';
import { siteParams, stream } from './site.js';
import { player } from '../player.js';

// Build/reseed-scoped random stream (THE CHART's reseed path), same idiom as flora.js:
// buildCreatures()/reseedCreatures() install a FRESH `siteParams('creatures').rng` here
// before any placement, so every school centre, boid offset, jelly, drifter and spark
// is a pure function of the site seed instead of the latent Math.random() this ran on.
// A fresh stream every time is the contract — reusing one would make layout depend on
// rebuild COUNT. Species tables, counts and Y-band logic are untouched: the same water,
// differently peopled.
let _cr = Math.random;
const rr = (a, b) => a + _cr() * (b - a);
// Trailer/strand GEOMETRY is built once and never reseeded, so it draws from its own
// fixed stream — otherwise it would offset the site stream and make the first build's
// layout differ from an arrive() back to the same site.
const GEO_RNG = stream(0x7A11ED00);

// One uniform object shared by every creature shader — one write per frame.
const uTime = { value: 0 };
const uFogD = { value: 0.016 };

// Nothing is drawn past the fog wall; culling here is invisible and cheap — but the
// wall MOVES now. 205 was exactly zone 0's green 2% visibility under the old uniform
// water (3.912 / (0.01337 * 1.45) = 202), which is why it read as invisible. The
// column is stratified since THE SILT LINE, so rising out of the silt takes that to
// ~380 in zone 0 and ~480 in zone 2, and a fixed radius popped whole schools in and
// out at half the distance the player could see them — at exactly the payoff altitude.
// Track the wall off the density updateCreatures already reads. K_EXT green is 1.45.
const CULL_MAX = 420;              // above any reachable clear-band sightline
let cullR = 205;

const tmpV = V3(), tmpV2 = V3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
const spinQ = new THREE.Quaternion();
const AXIS_Y = V3(0, 1, 0);

// ---------------------------------------------------------------------------
// shared shader fragments
// ---------------------------------------------------------------------------

// Jellyfish pulse: fast contraction, slow relaxation. Mirrored in JS below so
// thrust is derived from exactly the curve the vertex shader deforms with.
const PULSE_GLSL = `
float contractAt(float x){
  x = fract(x);
  return x < 0.28 ? 0.5 - 0.5*cos(x*11.2199) : 0.5 + 0.5*cos((x-0.28)*4.3633);
}`;

function contractAt(x) {
  x -= Math.floor(x);
  return x < 0.28 ? 0.5 - 0.5 * Math.cos(x * 11.2199) : 0.5 + 0.5 * Math.cos((x - 0.28) * 4.3633);
}

// Additive materials must fade to black with distance, not toward the fog color.
const FOG_GLSL = `
uniform float uFogD;
float fogVis(vec3 wp){ float d = length(wp - cameraPosition); return exp(-uFogD*uFogD*d*d); }`;

// r160 already puts tonemapping_pars/colorspace_pars in the program prefix, so
// only the one-line application chunks may be included here.
const TONE_OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

// ---------------------------------------------------------------------------
// fish
// ---------------------------------------------------------------------------

// Body runs along +Z (head at z=+0.5). uv.x = 0 nose .. 1 caudal peduncle and
// slightly past on the tail fin; uv.y = 0 belly, 0.5 lateral line, 1 back, and
// 2.0 to flag fin geometry.
function fishGeometry(o) {
  const rings = o.rings, sides = o.sides;
  const pos = [], uv = [], idx = [];
  const rAt = t => Math.max(0.04, Math.sin(Math.pow(t, 0.55) * Math.PI * 0.98) * (1 - o.taper * t * t));
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, r = rAt(t), z = 0.5 - t;
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      pos.push(Math.cos(a) * r * o.w, Math.sin(a) * r * o.h, z);
      uv.push(t, 0.5 + 0.5 * Math.sin(a));
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    idx.push(a, a + sides, b, b, a + sides, b + sides);
  }
  const fin = (verts, tris) => {
    const base = pos.length / 3;
    for (const v of verts) { pos.push(v[0], v[1], v[2]); uv.push(v[3], 2.0); }
    for (const tri of tris) idx.push(base + tri[0], base + tri[1], base + tri[2]);
  };
  // caudal fin — uv.x runs past 1 so the shader whips it harder than the peduncle
  const tl = o.tail, ty = tl * 0.78;
  fin([[0, 0, -0.5, 1.0], [0, ty, -0.5 - tl, 1.16], [0, ty * 0.14, -0.5 - tl * 0.42, 1.06], [0, -ty, -0.5 - tl, 1.16]],
    [[0, 1, 2], [0, 2, 3]]);
  // dorsal — low, swept back so it hugs the spine instead of standing up like a sail
  fin([[0, rAt(0.30) * o.h * 0.98, 0.20, 0.30], [0, rAt(0.74) * o.h * 0.98, -0.24, 0.74],
  [0, rAt(0.5) * o.h + o.dorsal, -0.14, 0.60]], [[0, 2, 1]]);
  // anal fin — small, tucked near the peduncle
  fin([[0, -rAt(0.60) * o.h * 0.95, -0.10, 0.60], [0, -rAt(0.86) * o.h * 0.95, -0.36, 0.86],
  [0, -rAt(0.72) * o.h - o.dorsal * 0.45, -0.30, 0.74]], [[0, 1, 2]]);
  // pectorals — short and swept back/down
  const pr = rAt(0.32) * o.w;
  for (const s of [-1, 1]) fin(
    [[s * pr * 0.9, -0.02, 0.16, 0.32],
    [s * (pr + o.pect), -0.08, -0.03, 0.46],
    [s * pr * 0.85, -0.03, -0.01, 0.44]],
    [[0, 1, 2]]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function fishMaterial(sp) {
  const u = {
    uPhase: { value: 0 }, uAmp: { value: sp.amp }, uTime,
    uGlow: { value: new THREE.Color(sp.glow).multiplyScalar(sp.glowI) },
    uCount: { value: sp.dots }, uBase: { value: sp.base }
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: sp.rough, metalness: sp.metal,
    side: THREE.DoubleSide, emissive: 0x000000
  });
  mat.userData.u = u;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aTint; attribute vec2 aFish;
        uniform float uPhase; uniform float uAmp;
        varying vec2 vFuv; varying vec3 vTint; varying float vPh;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float bT = uv.x;
        float amp = uAmp * (bT*bT*0.94 + 0.05);
        float ph = uPhase * aFish.y + aFish.x;
        float slope = cos(bT*5.0 - ph) * amp * 5.0;
        objectNormal = normalize(vec3(objectNormal.x, objectNormal.y, objectNormal.z + slope*objectNormal.x));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sin(bT*5.0 - ph) * amp;
        transformed.y += sin(ph*0.5 + aFish.x)*0.012;
        vFuv = uv; vTint = aTint; vPh = aFish.x;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uGlow; uniform float uCount; uniform float uTime; uniform float uBase;
        varying vec2 vFuv; varying vec3 vTint; varying float vPh;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float body = step(vFuv.y, 1.5);
        // countershading: dark back, pale belly — reads instantly as a fish
        float shade = mix(1.35, 0.30, clamp(vFuv.y,0.0,1.0));
        diffuseColor.rgb *= vTint * mix(0.5, shade, body);
        // Reversed-edge smoothstep is UNDEFINED (GLSL spec) and returns 0.0 on this
        // driver — both photophore rows were dead. 1.0 - smoothstep(lo, hi, x) is the
        // same decreasing ramp, defined everywhere (see water.js foldK).
        float lat  = (1.0 - smoothstep(0.010, 0.075, abs(vFuv.y-0.50))) * body;
        float bel  = (1.0 - smoothstep(0.020, 0.110, abs(vFuv.y-0.13))) * body;
        float dots = smoothstep(0.30, 0.95, sin(vFuv.x*uCount + vPh));
        float beat = 0.5 + 0.5*sin(uTime*2.2 + vPh*3.0);
        // photophore rows along the flank and belly, plus a body-wide ghost glow
        totalEmissiveRadiance += uGlow * ((lat + bel*0.85) * (dots*beat + 0.18) + uBase);
        // faint wash on the fins so silhouettes stay legible in the murk
        totalEmissiveRadiance += uGlow * (1.0-body) * (0.05 + uBase);`);
  };
  return mat;
}

const SPECIES = [
  // zone 0 — recognisable reef life, silver and warm
  {
    zi: 0, copies: 2, n: 46, sz: [0.62, 1.05], speed: 6.6, radius: 6.5, local: 2.6, fear: 16,
    rings: 6, sides: 6, w: 0.24, h: 0.42, taper: 0.62, tail: 0.34, dorsal: 0.07, pect: 0.06,
    col: 0x9dbdd4, jit: 0.10, glow: 0x9fe8ff, glowI: 0.5, dots: 30, base: 0.0, rough: 0.18, metal: 0.62,
    amp: 0.115, beat: 10, floorBias: 0.2
  },
  {
    zi: 0, copies: 1, n: 22, sz: [1.1, 1.8], speed: 4.2, radius: 8, local: 2.0, fear: 18,
    rings: 7, sides: 7, w: 0.30, h: 0.62, taper: 0.5, tail: 0.42, dorsal: 0.12, pect: 0.09,
    col: 0xc9793c, jit: 0.24, glow: 0x54e6c8, glowI: 0.7, dots: 18, base: 0.0, rough: 0.42, metal: 0.16,
    amp: 0.135, beat: 6.5, floorBias: 0.2
  },
  // zone 0 — deep-bodied reef grazer (disc silhouette, hugs the seagrass/kelp reef)
  {
    zi: 0, copies: 2, n: 40, sz: [0.5, 0.85], speed: 5.4, radius: 6, local: 2.4, fear: 15,
    rings: 7, sides: 8, w: 0.20, h: 0.70, taper: 0.78, tail: 0.28, dorsal: 0.16, pect: 0.08,
    col: 0xf2b134, jit: 0.16, glow: 0xffd9a0, glowI: 0.6, dots: 24, base: 0.0, rough: 0.3, metal: 0.3,
    amp: 0.1, beat: 8, floorBias: 0.65
  },
  // zone 0 — thin darter (needle silhouette, quick and low, weaving through the reef)
  {
    zi: 0, copies: 1, n: 36, sz: [0.35, 0.6], speed: 8.5, radius: 5.5, local: 2.9, fear: 14,
    rings: 6, sides: 5, w: 0.14, h: 0.24, taper: 0.85, tail: 0.5, dorsal: 0.05, pect: 0.04,
    col: 0x6fae8c, jit: 0.14, glow: 0x8dffcf, glowI: 0.45, dots: 14, base: 0.0, rough: 0.22, metal: 0.4,
    amp: 0.16, beat: 13, floorBias: 0.7
  },
  // zone 1 — colder, dimmer, first real bioluminescence
  {
    zi: 1, copies: 2, n: 55, sz: [0.62, 1.1], speed: 7.4, radius: 7, local: 2.9, fear: 19,
    rings: 6, sides: 6, w: 0.22, h: 0.46, taper: 0.66, tail: 0.38, dorsal: 0.08, pect: 0.06,
    col: 0x3d5478, jit: 0.12, glow: 0x5fd8ff, glowI: 2.8, dots: 62, base: 0.005, rough: 0.24, metal: 0.5,
    amp: 0.125, beat: 11
  },
  {
    zi: 1, copies: 1, n: 23, sz: [1.5, 2.4], speed: 3.6, radius: 9, local: 1.8, fear: 22,
    rings: 7, sides: 7, w: 0.26, h: 0.74, taper: 0.44, tail: 0.46, dorsal: 0.16, pect: 0.1,
    col: 0x6a3d86, jit: 0.2, glow: 0xff7ad8, glowI: 3.4, dots: 34, base: 0.008, rough: 0.5, metal: 0.1,
    amp: 0.1, beat: 5.2
  },
  // zone 2 — abyssal: near-transparent bodies, photophore rows doing the work
  {
    zi: 2, copies: 2, n: 40, sz: [0.62, 1.1], speed: 5.4, radius: 6.5, local: 2.2, fear: 20,
    rings: 6, sides: 6, w: 0.2, h: 0.42, taper: 0.68, tail: 0.4, dorsal: 0.07, pect: 0.05,
    col: 0x22333d, jit: 0.06, glow: 0x8dffe4, glowI: 7.5, dots: 96, base: 0.016, rough: 0.3, metal: 0.3,
    amp: 0.14, beat: 9
  },
  {
    zi: 2, copies: 1, n: 16, sz: [1.3, 2.1], speed: 2.8, radius: 10, local: 1.5, fear: 24,
    rings: 6, sides: 7, w: 0.24, h: 0.92, taper: 0.4, tail: 0.32, dorsal: 0.18, pect: 0.12,
    col: 0x2c4250, jit: 0.08, glow: 0xbfe8ff, glowI: 6.5, dots: 54, base: 0.018, rough: 0.22, metal: 0.55,
    amp: 0.08, beat: 4.2
  }
];

export const schools = [];
export const fish = schools; // convenience alias

// Fixed topological neighbourhood — real flocks track ~7 neighbours, and fixed
// index offsets keep the whole thing O(n) instead of O(n^2).
const NB = [1, 2, 3, 5, 8, 13];

function pickGoal(S) {
  const a = _cr() * Math.PI * 2, r = rr(18, WORLD_R * 0.64);
  S.goal.x = Math.cos(a) * r; S.goal.z = Math.sin(a) * r;
  const lo = terrainH(S.goal.x, S.goal.z, S.zi) + S.radius + 14;
  const hi = zoneTop(S.zi) - 14 - S.radius;
  const loC = Math.min(lo, hi - 1);
  // reef-hugging species (floorBias > 0) pick goals weighted toward the seafloor
  // layer instead of the full water column, so density reads where the player is
  const hiEff = S.floorBias > 0 ? loC + (hi - loC) * (1 - S.floorBias * 0.75) : hi;
  S.goal.y = clamp(rr(zoneBottom(S.zi) + 22, hiEff), loC, hi);
  S.goalT = rr(6, 15);
}

function buildSchool(sp, seed) {
  const geo = fishGeometry(sp);
  const mat = fishMaterial(sp);
  const n = sp.n;
  const inst = new THREE.InstancedMesh(geo, mat, n);
  inst.frustumCulled = true;
  inst.boundingSphere = new THREE.Sphere(V3(), sp.radius * 2.2);
  inst.castShadow = false;
  inst.receiveShadow = false;

  const tint = new Float32Array(n * 3), fdat = new Float32Array(n * 2);
  const sz = new Float32Array(n);
  const P = new Float32Array(n * 3), V = new Float32Array(n * 3), F = new Float32Array(n * 3);
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  geo.setAttribute('aFish', new THREE.InstancedBufferAttribute(fdat, 2));
  scene.add(inst);

  const S = {
    inst, mat, n, zi: sp.zi, sp, P, V, F, sz, seed,
    tint: geo.attributes.aTint, fdat: geo.attributes.aFish,
    bank: new Float32Array(n), phs: new Float32Array(n),
    center: V3(), cvel: V3(), goal: V3(), goalT: 0,
    radius: sp.radius, speed: sp.speed, local: sp.local, fear: sp.fear,
    floorBias: sp.floorBias || 0,
    beatPh: 0, roll: 0, panic: 0, lay: null
  };
  layoutSchool(S);
  schools.push(S);
}

// Everything a school's LAYOUT is: per-fish tint/phase/size, boid offsets inside the
// shoal, the shoal's centre and its first goal. Buffers are the ones allocated at
// build; capacities never change (n is the species' authored count).
function layoutSchool(S) {
  const sp = S.sp, n = S.n;
  const tint = S.tint.array, fdat = S.fdat.array;
  const base = new THREE.Color(sp.col), c = new THREE.Color();
  const P = S.P, V = S.V, F = S.F, sz = S.sz;
  for (let i = 0; i < n; i++) {
    c.copy(base).offsetHSL(rr(-0.03, 0.03), rr(-0.12, 0.12), rr(-sp.jit, sp.jit));
    tint[i * 3] = c.r; tint[i * 3 + 1] = c.g; tint[i * 3 + 2] = c.b;
    fdat[i * 2] = _cr() * 6.283;
    fdat[i * 2 + 1] = rr(0.85, 1.2);
    sz[i] = rr(sp.sz[0], sp.sz[1]);
    P[i * 3] = rr(-sp.radius, sp.radius);
    P[i * 3 + 1] = rr(-sp.radius, sp.radius) * 0.4;
    P[i * 3 + 2] = rr(-sp.radius, sp.radius);
    V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0;
    F[i * 3] = F[i * 3 + 1] = 0; F[i * 3 + 2] = 1;
    S.bank[i] = 0;
    S.phs[i] = _cr() * 6.283;
  }
  S.tint.needsUpdate = true; S.fdat.needsUpdate = true;

  // Shoal centre: the authored spiral of the shipped world, but the bearing and the
  // radius now come off the site stream, so each anchorage is peopled differently.
  const a = S.seed * 2.3 + sp.zi * 1.7 + rr(-0.9, 0.9), r = rr(30, WORLD_R * 0.55);
  S.center.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  S.center.y = sp.floorBias
    ? zoneBottom(sp.zi) + (zoneTop(sp.zi) - zoneBottom(sp.zi)) * (0.5 - 0.3 * sp.floorBias)
    : (zoneTop(sp.zi) + zoneBottom(sp.zi)) * 0.5;
  S.cvel.set(0, 0, 0);
  S.beatPh = _cr() * 40;
  S.panic = 0; S.roll = 0;
  pickGoal(S);
  // Layout fingerprint, frozen at lay-down time: the centre wanders every frame, so a
  // determinism probe needs the value BEFORE the sim touches it.
  S.lay = [S.center.x, S.center.y, S.center.z, S.goal.x, S.goal.y, S.goal.z];
  S.inst.boundingSphere.center.copy(S.center);
}

function updateSchool(S, dt, t) {
  const c = S.center, cv = S.cvel, sp = S.sp;

  // ---- school centre: wander goal + terrain/zone containment + panic ----
  S.goalT -= dt;
  if (S.goalT <= 0 || tmpV.copy(S.goal).sub(c).lengthSq() < 64) pickGoal(S);
  tmpV.copy(S.goal).sub(c);
  const gd = tmpV.length() || 1;
  cv.addScaledVector(tmpV.divideScalar(gd), S.speed * 0.7 * dt);

  const pd = c.distanceTo(player.pos);
  const panicR = S.fear * 2.4;
  if (pd < panicR) {
    tmpV2.copy(c).sub(player.pos);
    if (tmpV2.lengthSq() < 1e-4) tmpV2.set(1, 0, 0);
    cv.addScaledVector(tmpV2.normalize(), (1 - pd / panicR) * S.speed * 3.2 * dt);
  }
  cv.multiplyScalar(Math.pow(0.45, dt));
  const cs = cv.length();
  if (cs > S.speed) cv.multiplyScalar(S.speed / cs);
  c.addScaledVector(cv, dt);

  const hr = Math.hypot(c.x, c.z);
  if (hr > WORLD_R * 0.72) {
    const k = WORLD_R * 0.72 / hr;
    c.x *= k; c.z *= k; cv.x *= -0.35; cv.z *= -0.35; S.goalT = 0;
  }
  const floor = terrainH(c.x, c.z, S.zi);
  const yLo = Math.max(zoneBottom(S.zi) + 8, floor + S.radius + 5);
  const yHi = Math.max(yLo + 2, zoneTop(S.zi) - 10 - S.radius);
  if (c.y < yLo) { c.y = yLo; cv.y = Math.abs(cv.y) * 0.5; }
  else if (c.y > yHi) { c.y = yHi; cv.y = -Math.abs(cv.y) * 0.5; }

  S.inst.boundingSphere.center.copy(c);

  // ---- distance cull: past the fog wall nothing is visible ----
  if (pd > cullR + S.radius) {
    if (S.inst.visible) S.inst.visible = false;
    return;
  }
  S.inst.visible = true;

  // ---- boids, in school-local space so the whole flock translates for free ----
  const P = S.P, V = S.V, F = S.F, BK = S.bank, PH = S.phs, n = S.n;
  const arr = S.inst.instanceMatrix.array;
  const px = player.pos.x - c.x, py = player.pos.y - c.y, pz = player.pos.z - c.z;
  const fear = S.fear, fear2 = fear * fear;
  const sepR2 = (sp.sz[1] * 3.2) ** 2, nbR2 = (sp.sz[1] * 12) ** 2;
  const roll = S.roll = (S.roll + 5) % n;
  const floorLocal = floor + 2.5 - c.y;
  let panic = 0;

  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    const x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
    let ax = 0, ay = 0, az = 0;

    for (let k = 0; k < 6; k++) {
      const j3 = ((i + NB[k] + roll) % n) * 3;
      const dx = P[j3] - x, dy = P[j3 + 1] - y, dz = P[j3 + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz + 1e-4;
      if (d2 > nbR2) continue;
      if (d2 < sepR2) {
        const inv = 2.6 / d2;
        ax -= dx * inv; ay -= dy * inv; az -= dz * inv;
      } else {
        ax += (V[j3] - V[i3]) * 0.9 + dx * 0.05;
        ay += (V[j3 + 1] - V[i3 + 1]) * 0.9 + dy * 0.05;
        az += (V[j3 + 2] - V[i3 + 2]) * 0.9 + dz * 0.05;
      }
    }

    // cohesion toward the school centre, flattened vertically (schools are discs)
    const rr = Math.sqrt(x * x + y * y + z * z) + 1e-4;
    const pull = 0.55 + Math.max(0, rr - S.radius) * 0.8;
    ax -= x / rr * pull; ay -= y / rr * pull * 2.4; az -= z / rr * pull;

    // wander
    const ph = PH[i];
    ax += Math.sin(t * 0.9 + ph) * 1.1;
    ay += Math.sin(t * 0.63 + ph * 1.7) * 0.5;
    az += Math.cos(t * 1.13 + ph * 0.6) * 1.1;

    // scatter from the diver
    const fx = x - px, fy = y - py, fz = z - pz;
    const fd2 = fx * fx + fy * fy + fz * fz;
    if (fd2 < fear2) {
      const fd = Math.sqrt(fd2) + 0.01;
      const s = 1 - fd / fear;
      if (s > panic) panic = s;
      const k = s * s * 60 / fd;
      ax += fx * k; ay += fy * k; az += fz * k;
    }

    let vx = V[i3] + ax * dt, vy = V[i3 + 1] + ay * dt, vz = V[i3 + 2] + az * dt;
    const spd = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-5;
    const maxS = S.local * (1 + panic * 3.5), minS = S.local * 0.3;
    const cl = spd > maxS ? maxS / spd : (spd < minS ? minS / spd : 1);
    vx *= cl; vy *= cl; vz *= cl;

    let ny = y + vy * dt;
    if (ny < floorLocal) { ny = floorLocal; vy = Math.abs(vy); }
    P[i3] = x + vx * dt; P[i3 + 1] = ny; P[i3 + 2] = z + vz * dt;
    V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;

    // heading includes the school's travel: fish visually lead the shoal
    const wx = vx + cv.x, wy = vy + cv.y, wz = vz + cv.z;
    const wl = Math.sqrt(wx * wx + wy * wy + wz * wz) + 1e-5;
    const hx = wx / wl, hy = wy / wl, hz = wz / wl;

    // bank into the turn: roll so "up" tilts toward the turn centre
    const turn = F[i3 + 2] * hx - F[i3] * hz;
    F[i3] = hx; F[i3 + 1] = hy; F[i3 + 2] = hz;
    const bt = clamp(turn / Math.max(dt, 1e-3) * 0.42, -1.0, 1.0);
    const b = BK[i] += (bt - BK[i]) * Math.min(1, dt * 8);

    // right = up x fwd, up = fwd x right, then rolled by b about fwd
    let rx = hz, rz = -hx, rl = Math.hypot(rx, rz);
    if (rl < 1e-4) { rx = 1; rz = 0; rl = 1; }   // fish swimming straight up/down
    rx /= rl; rz /= rl;
    const ux = hy * rz, uy = hz * rx - hx * rz, uz = -hy * rx;
    const cb = Math.cos(b), sb = Math.sin(b), s = S.sz[i];
    const o = i * 16;
    arr[o] = (rx * cb + ux * sb) * s; arr[o + 1] = uy * sb * s; arr[o + 2] = (rz * cb + uz * sb) * s; arr[o + 3] = 0;
    arr[o + 4] = (ux * cb - rx * sb) * s; arr[o + 5] = uy * cb * s; arr[o + 6] = (uz * cb - rz * sb) * s; arr[o + 7] = 0;
    arr[o + 8] = hx * s; arr[o + 9] = hy * s; arr[o + 10] = hz * s; arr[o + 11] = 0;
    arr[o + 12] = c.x + P[i3]; arr[o + 13] = c.y + P[i3 + 1]; arr[o + 14] = c.z + P[i3 + 2]; arr[o + 15] = 1;
  }
  S.inst.instanceMatrix.needsUpdate = true;

  // tail beat accelerates with alarm; integrate phase so the rate change never pops
  S.panic += (panic - S.panic) * Math.min(1, dt * 4);
  S.beatPh += dt * sp.beat * (1 + S.panic * 1.6);
  if (S.beatPh > 6283.18) S.beatPh -= 6283.18;   // keep float32 phase precision
  S.mat.userData.u.uPhase.value = S.beatPh;
  S.mat.userData.u.uAmp.value = sp.amp * (1 + S.panic * 0.7);
}

// ---------------------------------------------------------------------------
// jellyfish
// ---------------------------------------------------------------------------

export const jellies = [];
let bellIn = null, bellOut = null, trailers = null, jellyGlow = null;

// One tentacle mesh serves all three zones; `trail` stretches it per instance so
// the abyssal jellies drag far longer arms without a second geometry.
const JELLY_ZONE = [
  { hue: [0.48, 0.60], sat: 0.55, lum: 0.55, scale: [1.1, 2.3], glow: 5.0, ribs: 14, trail: 0.7 },
  { hue: [0.72, 0.90], sat: 0.65, lum: 0.55, scale: [1.4, 3.0], glow: 7.5, ribs: 16, trail: 1.0 },
  { hue: [0.36, 0.52], sat: 0.78, lum: 0.60, scale: [1.6, 3.6], glow: 11.0, ribs: 20, trail: 2.0 }
];
const TRAIL_CFG = { tent: 18, arms: 4, tlen: [3.2, 5.0], alen: [5.0, 7.6] };

function bellGeometry() {
  const pts = [], DOME = 8;
  for (let i = 0; i <= DOME; i++) {
    const u = i / DOME, a = u * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.max(0.002, Math.pow(Math.sin(a), 0.72)), Math.pow(Math.cos(a), 1.35) * 0.9));
  }
  // flared margin curling under the bell
  pts.push(new THREE.Vector2(1.06, -0.09), new THREE.Vector2(1.03, -0.19), new THREE.Vector2(0.93, -0.26));
  return new THREE.LatheGeometry(pts, 24);
}

const BELL_VERT = `
attribute float aPhase; attribute float aRate; attribute float aSeed;
attribute vec3 aTint; attribute float aRibs;
uniform float uTime;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vTint;
varying float vC; varying float vFog; varying float vRibs;
${PULSE_GLSL}
${FOG_GLSL}
void main(){
  float ph = uTime*aRate + aPhase;
  float c = contractAt(ph - uv.y*0.11);
  float k = smoothstep(0.03, 1.0, uv.y);
  vec3 p = position;
  float wob = 1.0 + sin(uv.x*18.85 + uTime*0.7 + aSeed)*0.035*k;
  p.xz *= (1.0 - 0.33*c*k) * wob;
  p.y = p.y*(1.0 + 0.44*c) - 0.22*c*k;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * normal));
  vV = normalize(cameraPosition - wp.xyz);
  vUv = uv; vTint = aTint; vC = contractAt(ph); vRibs = aRibs;
  vFog = fogVis(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Outer shell: fresnel rim, radial ribs, a hot ring at the margin on each pulse.
const BELL_OUT_FRAG = `
uniform float uInt;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vTint;
varying float vC; varying float vFog; varying float vRibs;
void main(){
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
  float ribs = pow(0.5 + 0.5*cos(vUv.x*6.28318*vRibs), 9.0) * smoothstep(0.12, 0.95, vUv.y);
  float margin = smoothstep(0.80, 1.0, vUv.y);
  vec3 col = vTint * (fres*1.15 + ribs*0.55 + 0.05);
  col += vTint * margin * (0.35 + 1.25*vC);
  // reversed-edge smoothstep = UB (0.0 on this driver): the apex/crown glow never drew.
  col += vTint * (1.0 - smoothstep(0.0, 0.4, vUv.y)) * (0.12 + 0.5*vC);
  gl_FragColor = vec4(col * vFog * uInt, 1.0);
  ${TONE_OUT}
}`;

// Inner surface seen through the bell: milky volume plus the four-lobed core.
const BELL_IN_FRAG = `
uniform float uInt;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vTint;
varying float vC; varying float vFog; varying float vRibs;
void main(){
  float thick = 1.0 - smoothstep(0.0, 0.85, vUv.y);
  // reversed-edge smoothstep = UB (0.0 here): the four-lobed core never drew, which
  // also zeroed its alpha term below.
  float lobes = pow(abs(cos(vUv.x*12.566)), 4.0) * (1.0 - smoothstep(0.06, 0.55, vUv.y));
  vec3 milk = mix(vTint, vec3(0.78, 0.90, 1.0), 0.55);
  vec3 col = milk * (0.16 + 0.30*vC) + vTint * lobes * (0.5 + 1.6*vC);
  float a = (0.09 + 0.26*thick + lobes*0.35) * vFog;
  gl_FragColor = vec4(col * uInt, a);
  ${TONE_OUT}
}`;

// Rim tentacles + oral arms, both billboarded ribbons whose curl lags the bell.
function trailerGeometry(cfg) {
  const pos = [], A = [], B = [], idx = [];
  let base = 0;
  const strand = (segs, ang, len, r0, w, kind, si) => {
    for (let i = 0; i <= segs; i++) {
      const T = i / segs;
      for (const side of [-1, 1]) {
        pos.push(Math.cos(ang) * r0, -T * len, Math.sin(ang) * r0);
        A.push(T, ang, side, kind);
        B.push(len, r0, w, si);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    base += (segs + 1) * 2;
  };
  const gr = (a, b) => a + GEO_RNG() * (b - a);
  for (let s = 0; s < cfg.tent; s++) {
    const ang = (s + 0.5) / cfg.tent * Math.PI * 2;
    strand(9, ang, gr(cfg.tlen[0], cfg.tlen[1]), 0.99, gr(0.04, 0.075), 0, s * 1.37);
  }
  for (let s = 0; s < cfg.arms; s++) {
    const ang = (s + 0.25) / cfg.arms * Math.PI * 2;
    strand(12, ang, gr(cfg.alen[0], cfg.alen[1]), 0.20, gr(0.16, 0.24), 1, s * 2.1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(A, 4));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 4));
  g.setIndex(idx);
  return g;
}

const TRAIL_VERT = `
attribute vec4 aA; attribute vec4 aB;
attribute float aPhase; attribute float aRate; attribute float aSeed; attribute vec3 aTint;
attribute float aLenMul;
uniform float uTime;
varying float vT; varying float vSide; varying float vKind;
varying vec3 vTint; varying float vC; varying float vFog; varying float vSeed;
${PULSE_GLSL}
${FOG_GLSL}
void main(){
  float T = aA.x, ang = aA.y, side = aA.z, kind = aA.w;
  float len = aB.x * aLenMul, r0 = aB.y, w0 = aB.z, si = aB.w;
  float ph = uTime*aRate + aPhase;
  float c  = contractAt(ph - T*0.45);
  float cb = contractAt(ph);
  float rad = r0 * (1.0 - 0.34*c) - kind*0.06*cb;
  float y = -T*len*(1.0 + 0.20*c) + 0.12*cb;
  float wave = sin(T*4.4 - uTime*aRate*5.4 + si*1.7 + aSeed)
             + 0.42*sin(T*9.1 + uTime*aRate*3.1 + si*2.3);
  float sway = wave * T * len * (kind > 0.5 ? 0.10 : 0.06);
  vec3 dir = vec3(cos(ang), 0.0, sin(ang));
  vec3 tg  = vec3(-sin(ang), 0.0, cos(ang));
  vec3 p = dir*rad + vec3(0.0, y, 0.0) + tg*sway + dir*T*T*(kind>0.5 ? 0.25 : 0.10)*len*0.15;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  float sc = length(instanceMatrix[0].xyz);
  vec3 axis = normalize((mat3(modelMatrix) * (mat3(instanceMatrix) * vec3(0.0,1.0,0.0))));
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vec3 wdir = cross(axis, toCam);
  float wl = length(wdir);
  wdir = wl > 1e-4 ? wdir/wl : vec3(1.0,0.0,0.0);
  float ruffle = kind > 0.5 ? (1.0 + 0.45*sin(T*22.0 + si + uTime*0.9)) : 1.0;
  wp.xyz += wdir * side * w0 * (1.0 - pow(T, 0.75)*0.88) * ruffle * sc;
  vT = T; vSide = side; vKind = kind; vTint = aTint; vC = c; vSeed = aSeed + si;
  vFog = fogVis(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const TRAIL_FRAG = `
uniform float uInt;
varying float vT; varying float vSide; varying float vKind;
varying vec3 vTint; varying float vC; varying float vFog; varying float vSeed;
void main(){
  float core = 1.0 - abs(vSide);
  float fade = pow(1.0 - vT, 1.15) * smoothstep(0.0, 0.05, vT);
  float glow = mix(0.22, 1.0, core*core);
  float knots = vKind < 0.5 ? pow(0.5 + 0.5*sin(vT*26.0 - vSeed), 6.0) : 0.0;
  vec3 col = vTint * (glow*(0.55 + 0.9*vC) + knots*0.8);
  gl_FragColor = vec4(col * fade * vFog * uInt * (vKind > 0.5 ? 0.55 : 1.0), 1.0);
  ${TONE_OUT}
}`;

// Camera-facing additive quads used for every soft halo in the scene.
function glowMaterial(extraVert = '', extraVary = '') {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: glowTex }, uTime, uFogD },
    vertexShader: `
      attribute vec3 aPos; attribute float aSize; attribute vec3 aCol; attribute vec3 aExtra;
      uniform float uTime;
      varying vec2 vUv; varying vec3 vC; varying float vFog; ${extraVary}
      ${FOG_GLSL}
      void main(){
        vec3 wp = aPos;
        ${extraVert}
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vFog = fogVis(wp);
        mv.xy += position.xy * aSize;
        gl_Position = projectionMatrix * mv;
        vUv = uv; vC = aCol;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec2 vUv; varying vec3 vC; varying float vFog; ${extraVary}
      void main(){
        float a = texture2D(uMap, vUv).a;
        gl_FragColor = vec4(vC * vFog, a);
        ${TONE_OUT}
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
}

function glowField(n, mat) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(quad.index);
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aExtra', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  g.instanceCount = n;
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

function instAttr(geo, src) {
  for (const k in src) geo.setAttribute(k, src[k]);
}

// Per-instance jelly buffers, allocated once at build and rewritten in place on reseed.
// aPhase/aRate/aSeed/aTint/aRibs/aLenMul are ONE set of Float32Arrays wrapped by two
// InstancedBufferAttribute pairs (bell + trailer geometry), so a reseed writes the
// arrays once and flags both wrappers.
let JB = null;

function buildJellies() {
  const N = 7 * 3;
  const bellGeo = bellGeometry();
  const trailGeo = trailerGeometry(TRAIL_CFG);

  const aPhase = new Float32Array(N), aRate = new Float32Array(N), aSeed = new Float32Array(N);
  const aTint = new Float32Array(N * 3), aRibs = new Float32Array(N), aLenMul = new Float32Array(N);
  const gCol = new Float32Array(N * 3);
  JB = { N, aPhase, aRate, aSeed, aTint, aRibs, aLenMul, gCol, attrs: [] };

  for (let zi = 0; zi < 3; zi++) for (let k = 0; k < 7; k++) {
    jellies.push({
      i: zi * 7 + k, zi, pos: V3(), vel: V3(), axis: V3(0, 1, 0), wob: V3(1, 0, 0),
      scale: 1, spin: 0, spinA: 0, phase: 0, rate: 0.25, baseRate: 0.25, thrust: 12,
      glow: JELLY_ZONE[zi].glow, alarm: 0, grp: null
    });
  }
  layoutJellies();

  const shared = () => {
    const set = {
      aPhase: new THREE.InstancedBufferAttribute(aPhase, 1),
      aRate: new THREE.InstancedBufferAttribute(aRate, 1),
      aSeed: new THREE.InstancedBufferAttribute(aSeed, 1),
      aTint: new THREE.InstancedBufferAttribute(aTint, 3),
      aRibs: new THREE.InstancedBufferAttribute(aRibs, 1),
      aLenMul: new THREE.InstancedBufferAttribute(aLenMul, 1)
    };
    for (const k in set) JB.attrs.push(set[k]);
    return set;
  };
  instAttr(bellGeo, shared());
  instAttr(trailGeo, shared());

  const mkBell = (frag, side, blending, order) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime, uFogD, uInt: { value: 1 } },
      vertexShader: BELL_VERT, fragmentShader: frag,
      transparent: true, depthWrite: false, side, blending
    });
    const im = new THREE.InstancedMesh(bellGeo, m, N);
    im.frustumCulled = false;
    im.renderOrder = order;
    scene.add(im);
    return im;
  };
  bellIn = mkBell(BELL_IN_FRAG, THREE.BackSide, THREE.NormalBlending, 1);
  bellOut = mkBell(BELL_OUT_FRAG, THREE.FrontSide, THREE.AdditiveBlending, 3);

  const trailMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uFogD, uInt: { value: 1 } },
    vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    // r163+ splits transparent DoubleSide into a back-face + front-face pass; for a
    // depthWrite:false additive ribbon that is two draw calls for the same fragments.
    forceSinglePass: true
  });
  trailers = new THREE.InstancedMesh(trailGeo, trailMat, N);
  trailers.frustumCulled = false;
  trailers.renderOrder = 2;
  scene.add(trailers);

  // All three bodies share one transform buffer: write once, upload once.
  bellOut.instanceMatrix = bellIn.instanceMatrix;
  trailers.instanceMatrix = bellIn.instanceMatrix;

  jellyGlow = glowField(N, glowMaterial());
  jellyGlow.renderOrder = 4;
  jellyGlow.geometry.attributes.aCol.array.set(gCol);
  jellyGlow.geometry.attributes.aCol.needsUpdate = true;
  scene.add(jellyGlow);
}

// Jelly LAYOUT: hue inside the zone's authored band, pulse phase/rate, bell scale,
// trail length and where in the column it floats. Zone identity (JELLY_ZONE) is fixed;
// only the individuals change. Reused objects, reused buffers, no allocation.
function layoutJellies() {
  const { aPhase, aRate, aSeed, aTint, aRibs, aLenMul, gCol } = JB;
  const c = new THREE.Color();
  for (const J of jellies) {
    const zi = J.zi, Z = JELLY_ZONE[zi], i = J.i;
    c.setHSL(rr(Z.hue[0], Z.hue[1]), Z.sat, Z.lum);
    aTint[i * 3] = c.r; aTint[i * 3 + 1] = c.g; aTint[i * 3 + 2] = c.b;
    const gk = Z.glow * 0.13;
    gCol[i * 3] = c.r * gk; gCol[i * 3 + 1] = c.g * gk; gCol[i * 3 + 2] = c.b * gk;
    aPhase[i] = _cr();
    aRate[i] = rr(0.20, 0.34) * (1 - zi * 0.15);
    aSeed[i] = _cr() * 6.283;
    aRibs[i] = Z.ribs;
    aLenMul[i] = rr(0.8, 1.2) * Z.trail;
    const a = _cr() * Math.PI * 2, r = rr(16, WORLD_R * 0.7);
    J.pos.set(Math.cos(a) * r, rr(zoneBottom(zi) + 45, zoneTop(zi) - 25), Math.sin(a) * r);
    J.vel.set(rr(-.3, .3), 0, rr(-.3, .3));
    J.axis.set(rr(-.25, .25), 1, rr(-.25, .25)).normalize();
    J.wob.set(rr(-1, 1), 0, rr(-1, 1)).normalize();
    J.scale = rr(Z.scale[0], Z.scale[1]);
    J.spin = rr(-0.12, 0.12);
    J.spinA = _cr() * 6.283;
    J.phase = aPhase[i];
    J.rate = J.baseRate = aRate[i];
    J.thrust = rr(9, 15);
    J.glow = Z.glow;
    J.alarm = 0;
  }
  for (const at of JB.attrs) at.needsUpdate = true;
  if (jellyGlow) {
    jellyGlow.geometry.attributes.aCol.array.set(gCol);
    jellyGlow.geometry.attributes.aCol.needsUpdate = true;
  }
}

function updateJellies(dt, t) {
  const bm = bellIn.instanceMatrix.array;
  const gp = jellyGlow.geometry.attributes.aPos.array;
  const gs = jellyGlow.geometry.attributes.aSize.array;
  for (const J of jellies) {
    // Distance cull past the fog wall (jellies were the one population never culled:
    // 21 bodies x 4 layers always drawn AND steered). Per-instance scale-to-zero —
    // the instanced meshes stay one draw call, degenerate instances cost nothing.
    if (J.pos.distanceTo(player.pos) > cullR + J.scale * 10) {
      J.phase += dt * J.rate;              // keep the gait clock coherent
      const oz = J.i * 16;
      for (let k = 0; k < 15; k++) bm[oz + k] = 0;
      bm[oz + 15] = 1;
      gs[J.i] = 0;
      continue;
    }
    const step = dt * J.rate;
    J.phase += step;
    const c = contractAt(J.phase), c0 = contractAt(J.phase - step);
    const dc = (c - c0) / Math.max(dt, 1e-4);

    // the bell only pushes while it is contracting — that is the whole gait
    if (dc > 0) J.vel.addScaledVector(J.axis, dc * J.thrust * dt);
    J.vel.y -= 0.35 * dt;
    J.vel.multiplyScalar(Math.pow(0.30, dt));

    // slow tumble: the bell axis wanders, so jellies never track straight
    tmpV.set(J.wob.x * Math.sin(t * 0.13 + J.i) * 0.5, 1, J.wob.z * Math.cos(t * 0.11 + J.i) * 0.5).normalize();
    J.axis.lerp(tmpV, Math.min(1, dt * 0.35)).normalize();

    // drift away from the diver, and flash-pulse when startled
    const d = J.pos.distanceTo(player.pos);
    const R = 26 * J.scale * 0.5 + 14;
    if (d < R) {
      const s = 1 - d / R;
      tmpV2.copy(J.pos).sub(player.pos);
      if (tmpV2.lengthSq() < 1e-4) tmpV2.set(0, 1, 0);
      J.vel.addScaledVector(tmpV2.normalize(), s * 9 * dt);
      J.axis.lerp(tmpV2, Math.min(1, dt * s * 1.4)).normalize();
      J.alarm = Math.max(J.alarm, s);
    }
    J.alarm = Math.max(0, J.alarm - dt * 0.35);
    J.rate = J.baseRate * (1 + J.alarm * 1.9);

    J.pos.addScaledVector(J.vel, dt);
    const hr = Math.hypot(J.pos.x, J.pos.z);
    if (hr > WORLD_R * 0.85) {
      const k = WORLD_R * 0.85 / hr;
      J.pos.x *= k; J.pos.z *= k; J.vel.x *= -0.5; J.vel.z *= -0.5;
    }
    const lo = Math.max(zoneBottom(J.zi) + 22, terrainH(J.pos.x, J.pos.z, J.zi) + J.scale * 6 + 6);
    const hi = Math.max(lo + 4, zoneTop(J.zi) - 14);
    if (J.pos.y < lo) { J.pos.y = lo; J.vel.y = Math.abs(J.vel.y) * 0.4 + 0.6; }
    else if (J.pos.y > hi) { J.pos.y = hi; J.vel.y = -Math.abs(J.vel.y) * 0.4 - 0.4; }

    J.spinA += J.spin * dt;
    tmpQ.setFromUnitVectors(AXIS_Y, J.axis).multiply(spinQ.setFromAxisAngle(AXIS_Y, J.spinA));
    tmpM.compose(J.pos, tmpQ, tmpV2.setScalar(J.scale));
    const e = tmpM.elements, o = J.i * 16;
    for (let k = 0; k < 16; k++) bm[o + k] = e[k];

    const i3 = J.i * 3;
    gp[i3] = J.pos.x; gp[i3 + 1] = J.pos.y - J.scale * 0.2; gp[i3 + 2] = J.pos.z;
    gs[J.i] = J.scale * (2.6 + 2.4 * c) * (1 + J.alarm * 0.5);
  }
  bellIn.instanceMatrix.needsUpdate = true;
  jellyGlow.geometry.attributes.aPos.needsUpdate = true;
  jellyGlow.geometry.attributes.aSize.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// abyssal drifters: siphonophore bead-chains and ghost ribbons
// ---------------------------------------------------------------------------

let drifters = null, sparksZ = null;

const DRIFT_VERT = `
attribute vec4 aD; attribute vec4 aE; attribute vec3 aCol;
uniform float uTime;
varying float vT; varying float vSide; varying float vKind;
varying vec3 vCol; varying float vFog; varying float vSeed;
${FOG_GLSL}
void main(){
  float T = aD.x, side = aD.y, kind = aD.z, seed = aD.w;
  float len = aE.x, wid = aE.y, amp = aE.z, rate = aE.w;
  float ph = uTime*rate + seed;
  vec3 p = position;
  p.y -= T*len;
  p.y += sin(ph*0.8)*2.5;
  float f = pow(T, 0.7);
  p.x += (sin(T*5.0 + ph*1.9)*0.8 + sin(T*12.0 - ph*2.7 + seed)*0.28) * amp * f;
  p.z += (cos(T*4.2 + ph*1.5)*0.8 + cos(T*9.0 + ph*2.2 + seed)*0.25) * amp * f;
  p.x += sin(ph*0.26 + seed)*7.0;
  p.z += cos(ph*0.22 + seed*1.7)*7.0;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 wdir = cross(vec3(0.0,1.0,0.0), toCam);
  float wl = length(wdir);
  wdir = wl > 1e-4 ? wdir/wl : vec3(1.0,0.0,0.0);
  float taper = kind > 0.5 ? (1.0 - T*0.35)*(0.55 + 0.45*sin(T*7.0 + ph)) : (1.0 - T*0.6);
  p += wdir * side * wid * taper;
  vT = T; vSide = side; vKind = kind; vCol = aCol; vSeed = seed; vFog = fogVis(p);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const DRIFT_FRAG = `
uniform float uTime;
varying float vT; varying float vSide; varying float vKind;
varying vec3 vCol; varying float vFog; varying float vSeed;
void main(){
  float core = 1.0 - abs(vSide);
  float fade = pow(1.0 - vT, 0.8) * smoothstep(0.0, 0.05, vT);
  float beads = vKind < 0.5
    ? pow(0.5 + 0.5*sin(vT*72.0 - uTime*1.1 + vSeed), 14.0) * (0.6 + 0.4*sin(uTime*2.0 + vSeed))
    : 0.0;
  vec3 col = vCol * (core*core*0.55 + 0.10) + vCol * beads * 3.2 * core;
  gl_FragColor = vec4(col * fade * vFog, 1.0);
  ${TONE_OUT}
}`;

// Drifter placement is BAKED into the vertex arrays (one static mesh, all motion in the
// shader), so a reseed re-runs the same strand walk and copies the results back over the
// same buffers. Strand count and segment count are fixed, so the arrays are always the
// same length — geometry and material are never touched.
function driftArrays() {
  const pos = [], D = [], E = [], C = [], idx = [];
  let base = 0;
  const col = new THREE.Color();
  const strand = (o, segs, len, wid, amp, kind, hue, rate) => {
    col.setHSL(hue, 0.7, 0.55);
    const seed = _cr() * 6.283;
    for (let i = 0; i <= segs; i++) {
      const T = i / segs;
      for (const side of [-1, 1]) {
        pos.push(o.x, o.y, o.z);
        D.push(T, side, kind, seed);
        E.push(len, wid, amp, rate);
        C.push(col.r, col.g, col.b);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    base += (segs + 1) * 2;
  };
  const place = zi => {
    const a = _cr() * Math.PI * 2, r = rr(20, WORLD_R * 0.72);
    return V3(Math.cos(a) * r, rr(zoneBottom(zi) + 60, zoneTop(zi) - 20), Math.sin(a) * r);
  };
  // siphonophores: long bead chains
  for (let k = 0; k < 10; k++) strand(place(2), 24, rr(26, 48), 0.28, rr(2.5, 5), 0, rr(0.42, 0.52), rr(0.25, 0.4));
  for (let k = 0; k < 4; k++) strand(place(1), 20, rr(18, 32), 0.24, rr(2, 4), 0, rr(0.72, 0.86), rr(0.3, 0.45));
  // ghost ribbons
  for (let k = 0; k < 7; k++) strand(place(2), 20, rr(16, 30), rr(0.7, 1.6), rr(3, 6), 1, rr(0.5, 0.62), rr(0.2, 0.34));
  for (let k = 0; k < 3; k++) strand(place(1), 18, rr(14, 24), rr(0.6, 1.2), rr(2.5, 5), 1, rr(0.76, 0.9), rr(0.22, 0.36));
  return { pos, D, E, C, idx };
}

function buildDrifters() {
  const { pos, D, E, C, idx } = driftArrays();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aD', new THREE.Float32BufferAttribute(D, 4));
  g.setAttribute('aE', new THREE.Float32BufferAttribute(E, 4));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(idx);
  drifters = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { uTime, uFogD },
    vertexShader: DRIFT_VERT, fragmentShader: DRIFT_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    forceSinglePass: true       // see trailMat — same r163+ double-pass note
  }));
  drifters.frustumCulled = false;
  drifters.renderOrder = 2;
  scene.add(drifters);
}

function layoutDrifters() {
  const a = driftArrays(), at = drifters.geometry.attributes;
  at.position.array.set(a.pos); at.position.needsUpdate = true;
  at.aD.array.set(a.D); at.aD.needsUpdate = true;
  at.aE.array.set(a.E); at.aE.needsUpdate = true;
  at.aCol.array.set(a.C); at.aCol.needsUpdate = true;
  // index is topology only — identical every time, so it is never re-uploaded
}

// Twinkling plankton — pure vertex-shader motion, zero CPU per frame.
// One mesh PER ZONE (same material, so still one program) so updateCreatures can gate
// them off camera-Y bands like flora.js does — they used to draw in all three zones
// no matter where the camera was.
function buildSparks() {
  // zone counts as explicit buckets (not percentages) so zone 0 can be boosted
  // independently: +40% over the original ~58 there, zones 1/2 unchanged.
  const mat = glowMaterial(`
    float s = aExtra.x;
    wp.x += sin(uTime*aExtra.y + s)*3.0;
    wp.y += sin(uTime*aExtra.y*0.7 + s*1.7)*2.0;
    wp.z += cos(uTime*aExtra.y*0.85 + s*0.6)*3.0;
    vTw = 0.35 + 0.65*pow(0.5+0.5*sin(uTime*aExtra.z + s*3.0), 3.0);`, 'varying float vTw;');
  mat.fragmentShader = mat.fragmentShader.replace('vec4(vC * vFog, a)', 'vec4(vC * vFog * vTw, a)');
  SPARK_N = [81, 102, 160];
  sparksZ = SPARK_N.map(n => glowField(n, mat));
  layoutSparks();
  for (const m of sparksZ) { m.renderOrder = 4; scene.add(m); }
}

let SPARK_N = null;

function layoutSparks() {
  const col = new THREE.Color();
  // zone-major loop = identical _cr consumption order to the old single-mesh layout
  for (let zi = 0; zi < 3; zi++) {
    const at = sparksZ[zi].geometry.attributes;
    const p = at.aPos.array, s = at.aSize.array, c = at.aCol.array, e = at.aExtra.array;
    for (let i = 0; i < SPARK_N[zi]; i++) {
      const a = _cr() * Math.PI * 2, r = rr(10, WORLD_R * 0.85);
      p[i * 3] = Math.cos(a) * r;
      p[i * 3 + 1] = rr(zoneBottom(zi) + 10, zoneTop(zi) - 6);
      p[i * 3 + 2] = Math.sin(a) * r;
      s[i] = rr(0.5, 1.8) * (1 + zi * 0.35);
      col.setHSL(zi === 2 ? rr(0.38, 0.52) : (zi === 1 ? rr(0.68, 0.86) : rr(0.5, 0.6)), 0.8, 0.6);
      const k = 0.5 + zi * 0.5;
      c[i * 3] = col.r * k; c[i * 3 + 1] = col.g * k; c[i * 3 + 2] = col.b * k;
      e[i * 3] = _cr() * 6.283;
      e[i * 3 + 1] = rr(0.08, 0.22);
      e[i * 3 + 2] = rr(0.5, 2.2);
    }
    at.aPos.needsUpdate = at.aSize.needsUpdate = at.aCol.needsUpdate = at.aExtra.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export function buildCreatures() {
  _cr = siteParams('creatures').rng;
  let seed = 0;
  for (const sp of SPECIES) for (let k = 0; k < sp.copies; k++) buildSchool(sp, seed++);
  buildJellies();
  buildDrifters();
  buildSparks();
}

// Re-lay schools/jellies/drifters/sparks for the current site (CHART V2 contract:
// pure function of siteParams('creatures').rng, buffers rewritten in place, materials
// and programs never recreated). The stream order matches buildCreatures() exactly, so
// a boot at a site and an arrive() back to it produce the identical layout.
export function reseedCreatures() {
  _cr = siteParams('creatures').rng;
  for (const S of schools) layoutSchool(S);
  layoutJellies();
  layoutDrifters();
  layoutSparks();
}

export function updateCreatures(dt, t) {
  uTime.value = t;
  if (scene.fog) {
    uFogD.value = scene.fog.density;
    cullR = Math.min(CULL_MAX, 3.912 / Math.max(scene.fog.density * 1.45, 1e-4));
  }
  for (const S of schools) updateSchool(S, dt, t);
  updateJellies(dt, t);
  // Camera-Y band gating (flora.js pattern): sparks/drifters used to draw in all
  // three zones every frame regardless of where the camera was.
  const cy = camera.position.y;
  for (let zi = 0; zi < 3; zi++)
    sparksZ[zi].visible = cy < zoneTop(zi) + 120 && cy > zoneBottom(zi) - 150;
  // drifters live in zones 1-2 only (see driftArrays placement)
  drifters.visible = cy < zoneTop(1) + 120;
}
