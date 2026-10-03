// Ambient sea life: boid fish schools, pulse-propelled jellyfish, and abyssal
// bioluminescent drifters. OWNED BY: creatures agent.
//
// Everything here is instanced and shader-animated: the CPU only steers a few
// hundred boids and ~21 jellyfish bodies; undulation, tentacle lag, ribbon
// motion and glow all live in vertex shaders so the frame cost stays flat.
import * as THREE from 'three';
import { scene, camera, renderer } from '../core.js';
import { WORLD_R, zoneTop, zoneBottom, zoneBand, ZONE_SEEN } from '../config.js';
import { registerPaint, injectStrokes } from '../lib/paint.js';
import { clamp, V3 } from '../lib/math.js';
import { glowTex } from '../lib/textures.js';
import { terrainH } from './terrain.js';
import { siteParams, stream } from './site.js';
import { SKIN_COMMON, SKIN_LIGHTS } from './fauna.js';
import { MV, MOVER_N, moverLive, pulseAt, PULSE_DIR, LANT, tickStir } from './stir.js';
import { player } from '../player.js';
import { loadSculpted } from '../lib/assets.js';
import { patchNormalRG } from '../lib/microDetail.js';
import { makeFish, labelVertex } from '../entities/fishKit.js';
import { FISH } from '../entities/schoolSculpt.js';

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
const TAU = Math.PI * 2;

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
// polish-fauna: aSurf = (body t, around 0..1, 0) on the body and (root->edge s,
// across q, 1) on every fin, so the fragment can lay scales round the body and rays
// across a fin without touching uv (the undulation keys off uv and stays exactly as
// it was). The body carries ~2.3x the rings and +4 sides so it rounds instead of
// faceting at 5 u.
function fishGeometry(o) {
  const rings = o.rings * 2 + 2, sides = o.sides + 4;
  const pos = [], uv = [], idx = [], surf = [];
  // Profile: a sine fore-body (tapered snout, full shoulder at m) into a
  // cosine after-body that pinches to a real caudal peduncle. The old sin(t^0.55)
  // profile peaked at the head and ran straight to the tail — a cone from the side.
  const m = 0.30, ped = 0.11 - o.taper * 0.05;
  const rAt = t => {
    if (t < m) return Math.max(0.05, Math.pow(Math.sin(Math.PI * 0.5 * t / m), 0.9));
    const u = Math.min(1, (t - m) / (1 - m));
    return ped + (1 - ped) * Math.pow(Math.cos(u * Math.PI * 0.5), 1.15 + o.taper * 0.5);
  };
  // one duplicated seam column (j = sides) so the scale grid's around-coordinate
  // never interpolates backwards across a strip; its normals are welded after.
  const cols = sides + 1;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, r = rAt(t), z = 0.5 - t;
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      // the back arches higher than the belly hangs: centre line lifts mid-body
      const arch = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.10 * o.h * r;
      pos.push(Math.cos(a) * r * o.w, Math.sin(a) * r * o.h * (Math.sin(a) > 0 ? 1.04 : 0.96) + arch, z);
      uv.push(t, 0.5 + 0.5 * Math.sin(a));
      surf.push(t, j / sides, 0);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = i * cols + j, b = a + 1;
    idx.push(a, a + cols, b, b, a + cols, b + cols);
  }
  // v = [x, y, z, uv.x, s, q]: s runs root 0 -> free edge 1, q across the rays
  const fin = (verts, tris) => {
    const base = pos.length / 3;
    for (const v of verts) { pos.push(v[0], v[1], v[2]); uv.push(v[3], 2.0); surf.push(v[4], v[5], 1); }
    for (const tri of tris) idx.push(base + tri[0], base + tri[1], base + tri[2]);
  };
  // caudal fan — uv.x runs past 1 so the shader whips it harder than the peduncle.
  // Interior column at the fork midline plus a trailing-edge pair at uv.x≈1.3: the
  // existing >1 whip term then S-curls the fan through its depth, and the notch
  // between the trailing tips gives the forked silhouette.
  const tl = o.tail, ty = tl * 0.78;
  fin([
    [0, 0, -0.5, 1.0, 0, 0.5],                              // 0 peduncle
    [0, ty * 0.62, -0.5 - tl * 0.55, 1.12, 0.55, 0.82],     // 1 upper interior
    [0, ty * 1.02, -0.5 - tl * 1.10, 1.30, 1, 1],           // 2 upper trailing tip
    [0, ty * 0.10, -0.5 - tl * 0.40, 1.06, 0.62, 0.5],      // 3 fork notch
    [0, -ty * 0.62, -0.5 - tl * 0.55, 1.12, 0.55, 0.18],    // 4 lower interior
    [0, -ty * 1.02, -0.5 - tl * 1.10, 1.30, 1, 0]           // 5 lower trailing tip
  ], [[0, 1, 3], [1, 2, 3], [0, 3, 4], [3, 5, 4]]);
  // dorsal — low, swept back, with a soft-rayed trailing edge (2 tris)
  fin([[0, rAt(0.30) * o.h * 0.98, 0.20, 0.30, 0, 0], [0, rAt(0.74) * o.h * 0.98, -0.24, 0.74, 0, 1],
  [0, rAt(0.5) * o.h + o.dorsal, -0.14, 0.60, 1, 0.3],
  [0, rAt(0.68) * o.h + o.dorsal * 0.45, -0.22, 0.70, 0.9, 0.75]], [[0, 2, 3], [0, 3, 1]]);
  // anal fin — small, tucked near the peduncle
  fin([[0, -rAt(0.60) * o.h * 0.95, -0.10, 0.60, 0, 0], [0, -rAt(0.86) * o.h * 0.95, -0.36, 0.86, 0, 1],
  [0, -rAt(0.72) * o.h - o.dorsal * 0.45, -0.30, 0.74, 1, 0.55]], [[0, 1, 2]]);
  // pectorals — short and swept back/down, cambered quad (2 tris)
  const pr = rAt(0.32) * o.w;
  for (const s of [-1, 1]) fin(
    [[s * pr * 0.9, -0.02, 0.16, 0.32, 0, 0.1],
    [s * (pr + o.pect * 0.6), -0.055, 0.06, 0.40, 0.6, 0.3],  // cambered mid-span, bowed down
    [s * (pr + o.pect), -0.08, -0.03, 0.46, 1, 0.55],
    [s * pr * 0.85, -0.03, -0.01, 0.44, 0.05, 0.95]],
    [[0, 1, 3], [1, 2, 3]]);
  // pelvics — paired small tris under the belly, large-bodied species only
  if (o.pelvic) {
    const vr = rAt(0.48) * o.w;
    for (const s of [-1, 1]) fin(
      [[s * vr * 0.7, -rAt(0.48) * o.h * 0.9, 0.02, 0.48, 0, 0],
      [s * vr * 0.7, -rAt(0.58) * o.h * 0.9, -0.08, 0.58, 0, 1],
      [s * (vr * 0.7 + o.pect * 0.55), -rAt(0.53) * o.h * 0.9 - o.pect * 0.7, -0.05, 0.55, 1, 0.5]],
      [[0, 1, 2]]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSurf', new THREE.Float32BufferAttribute(surf, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nr = g.attributes.normal.array;
  for (let i = 0; i <= rings; i++) {
    const a = i * cols * 3, b = (i * cols + sides) * 3;
    for (let k = 0; k < 3; k++) { const m = (nr[a + k] + nr[b + k]) * 0.5; nr[a + k] = m; nr[b + k] = m; }
  }
  // a vertex only in collapsed triangles gets a zero normal; normalize(0) is NaN
  for (let i = 0; i < nr.length; i += 3) if (nr[i] * nr[i] + nr[i + 1] * nr[i + 1] + nr[i + 2] * nr[i + 2] < 1e-12) nr[i + 1] = 1;
  return g;
}

// polish-fauna: every school species shares ONE program (identical injected source,
// one explicit key); what differs per species is uniforms only — scale grid, relief,
// iridescence, fin-ray count. uSkinA = (scales along, rows around, relief u, iri k),
// uSkinB = (iri hue offset, fin rays, eye iris tint 0 silver .. 1 gold, dorsal saddle),
// uSilver = how much of the bright water above the flank mirrors (guanine plates).
const FISH_SKIN = [
  [44, 20, 0.008, 0.55, 0.00, 11, 0.15, 0.0, 0.95],   // z0 silver schooler: herring sheen
  [26, 14, 0.018, 0.22, 0.30, 13, 0.85, 0.5, 0.35],   // z0 amber reef fish
  [24, 16, 0.015, 0.30, 0.12, 15, 0.95, 0.9, 0.45],   // z0 deep-bodied grazer: saddle bands
  [48, 14, 0.006, 0.45, 0.62, 9, 0.30, 0.0, 0.8],     // z0 darter
  [44, 20, 0.008, 0.40, 0.55, 11, 0.20, 0.0, 0.8],    // z1 slate schooler
  [26, 14, 0.016, 0.30, 0.78, 13, 0.60, 0.3, 0.4],    // z1 violet
  [32, 14, 0.010, 0.25, 0.45, 11, 0.10, 0.0, 0.5],    // z2 glass bodies
  [26, 14, 0.013, 0.35, 0.25, 13, 0.20, 0.0, 0.9]     // z2 hatchet
];
// The school fish's vertex motion (anim-fauna), shared verbatim by the procedural and the
// sculpted (fauna2) materials: it keys off uv (body t, fin flag) and aSurf, which the
// sculpted meshes carry too (labelled from fishKit.js at install), so the motion is identical.
// fauna3 PROPOSAL (default OFF; Michael's call): FAR-SCHOOL VISIBILITY. Past ~45 u true-size
// school fish fall under a few pixels and the water takes their contrast, so a school dissolves
// into faint specks. uFarVis = 1 (a) holds each fish to >= ~3 px of body length past 45 u (the
// fish grows in place, at most x4 — the school keeps its shape and count, TAA keeps the dots
// steady), and (b) lifts the silver flank flash with distance, the cue a real diver gets from
// a far school (sculpt materials). window.__school.farVis(1|0) = the A/B.
const FARVIS = { value: (typeof location !== 'undefined' && location.search.includes('schoolvis')) ? 1 : 0 };
function fishVertex(sh) {
    sh.uniforms.uFarVis = FARVIS; sh.uniforms.uJRes = uJRes;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aTint; attribute vec4 aFish; attribute float aFishK; attribute vec3 aSurf;
        uniform float uPhase; uniform float uAmp; uniform float uTime; uniform float uFarVis; uniform float uJRes;
        varying vec2 vFuv; varying vec3 vTint; varying float vPh; varying vec3 vSurf;`)
      // anim-fauna: EVERY FISH ITS OWN ANIMAL. aFish = (beat phase, beat amplitude,
      // turn bend, pectoral scull), integrated per fish on the CPU from its own speed,
      // effort, turn rate and startle state; aFishK is the fish's fixed seed. The wave
      // still travels head to tail (carangiform: the fore-body nearly still, the
      // amplitude growing as bT^2) but its rate and height now follow the animal —
      // bursts, glides, a C-start that throws the whole body into a curl.
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float bT = uv.x;
        float amp = aFish.y * (bT*bT*0.94 + 0.05);
        float ph = aFish.x;
        float bc = bT - 0.30;
        float slope = cos(bT*5.0 - ph) * amp * 5.0 + aFish.z * 2.0 * bc;
        objectNormal = normalize(vec3(objectNormal.x, objectNormal.y, objectNormal.z + slope*objectNormal.x));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // travelling wave + the turn bend: a parabola about the shoulder, so the head
        // leads into the turn and the tail swings wide (the C of a startle at full k)
        transformed.x += sin(bT*5.0 - ph) * amp + aFish.z * (bc*bc - 0.04);
        // pectorals: fins off the midline in the shoulder band. aSurf.x runs root -> edge,
        // so the scull is a hinge: sculling when the fish hovers, tucked flat at speed.
        if (uv.y > 1.5 && abs(position.x) > 0.05 && bT > 0.28 && bT < 0.5) {
          float fs = aSurf.x, sd = sign(position.x);
          float sc = sin(uTime * 7.0 + aFishK * 3.0 + sd * 0.9);
          transformed.y += sc * aFish.w * fs * 0.11;
          transformed.z += cos(uTime * 7.0 + aFishK * 3.0 + sd * 0.9) * aFish.w * fs * 0.05;
          transformed.x -= sd * fs * (1.0 - aFish.w) * 0.035;
        }
        transformed.y += sin(ph*0.5 + aFishK)*0.012;
        if (uFarVis > 0.0) {
          vec3 fW = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float fD = max(distance(fW, cameraPosition), 1.0);
          float fPx = length(instanceMatrix[0].xyz) * projectionMatrix[1][1] * uJRes * 0.5 / fD;
          float fK = 1.0 + uFarVis * smoothstep(40.0, 55.0, fD) * max(0.0, 3.0 / max(fPx, 0.75) - 1.0);
          transformed *= min(fK, 4.0);
        }
        vFuv = uv; vTint = aTint; vPh = aFishK; vSurf = aSurf;`);
}

function fishMaterial(sp) {
  const sk = FISH_SKIN[Math.max(0, SPECIES.indexOf(sp))];
  const sz = (sp.sz[0] + sp.sz[1]) * 0.5;
  const u = {
    uPhase: { value: 0 }, uAmp: { value: sp.amp }, uTime,
    // polish-fauna: sunlit reef fish carry no photophores — zone 0's rows read as LED
    // dashes by day, so there they fall to a faint reflective lateral stripe.
    uGlow: { value: new THREE.Color(sp.glow).multiplyScalar(sp.glowI * (sp.zi === 0 ? 0.14 : 1)) },
    uCount: { value: sp.dots }, uBase: { value: sp.base },
    uSkinA: { value: new THREE.Vector4(sk[0], sk[1], sk[2] * sz, sk[3]) },
    uSkinB: { value: new THREE.Vector4(sk[4], sk[5], sk[6], sk[7]) },
    uSilver: { value: sk[8] }
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: sp.rough, metalness: sp.metal,
    side: THREE.DoubleSide, emissive: 0x000000
  });
  mat.userData.u = u;
  mat.customProgramCacheKey = () => 'abyssa-fish-skin';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    fishVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uGlow; uniform float uCount; uniform float uTime; uniform float uBase;
        uniform vec4 uSkinA; uniform vec4 uSkinB; uniform float uSilver;
        varying vec2 vFuv; varying vec3 vTint; varying float vPh; varying vec3 vSurf;
        ${SKIN_COMMON}`)
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
        ${SKIN_LIGHTS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float body = step(vFuv.y, 1.5);
        float fy = clamp(vFuv.y, 0.0, 1.0);          // 0 belly .. 1 back, both flanks
        vec3 fV = normalize(vViewPosition);
        vec3 alb = vTint;
        float fh = 0.0, wet = 0.0, pupil = 0.0, rays = 0.0, scId = 0.5;
        if (body > 0.5) {
          // ---- scales: roof-tiled, head-ward on top, fading out over the head ----
          vec2 sp = vec2(vSurf.x * uSkinA.x, vSurf.y * uSkinA.y);
          vec3 sc = skScales(sp);
          scId = sc.z;
          float scK = smoothstep(0.17, 0.25, vSurf.x) * (1.0 - smoothstep(0.93, 1.0, vSurf.x)) * skAA(sp);
          fh = sc.x * scK;
          // countershading with a soft waterline, and a darker dorsal saddle on the reef grazers
          float shade = mix(1.30, 0.34, smoothstep(0.18, 0.92, fy));
          float saddle = uSkinB.w * smoothstep(0.55, 0.8, fy) * smoothstep(0.35, 0.9, sin(vSurf.x * 18.0 + 1.2));
          alb *= shade * (1.0 - 0.45 * saddle);
          // per-scale value jitter and the dark crescent where each scale ends
          alb *= 1.0 + ((sc.z - 0.5) * 0.16 + sc.x * 0.14 - sc.y * 0.22) * scK;
          // operculum: the gill cover's curved edge, a groove and a dark line
          float opx = vSurf.x - 0.2 - 0.05 * (fy - 0.5) * (fy - 0.5) * 4.0;
          float op = (1.0 - smoothstep(0.0, 0.010, abs(opx))) * step(0.12, fy) * (1.0 - step(0.9, fy));
          alb *= 1.0 - 0.32 * op; fh -= op * 0.8;
          // head: fine skin grain instead of scales
          fh += (1.0 - scK) * skN2(vSurf.xy * vec2(160.0, 60.0)) * 0.25 * step(vSurf.x, 0.25);
          // lateral line: a row of pores along the flank
          float lat = (1.0 - smoothstep(0.004, 0.016, abs(fy - 0.56 + 0.06 * vSurf.x))) * step(0.22, vSurf.x) * step(vSurf.x, 0.92);
          alb *= 1.0 - 0.18 * lat * step(0.5, fract(vSurf.x * uSkinA.x));
          // ---- eye: a wet dome, iris ring, black pupil, catchlight ----
          float eyeD = length(vec2((vSurf.x - 0.085) * 1.9, fy - 0.72));
          float eyeIn = 1.0 - smoothstep(0.036, 0.044, eyeD);
          float dome = sqrt(max(0.0, 1.0 - (eyeD / 0.044) * (eyeD / 0.044)));
          fh = mix(fh, 2.2 * dome, eyeIn);
          vec3 iris = mix(vec3(0.62, 0.64, 0.66), vec3(0.72, 0.52, 0.16), uSkinB.z);
          iris *= 0.75 + 0.35 * skN2(vec2(atan(fy - 0.72, vSurf.x - 0.085) * 6.0, eyeD * 80.0));
          pupil = 1.0 - smoothstep(0.017, 0.022, eyeD);
          alb = mix(alb, mix(iris, vec3(0.008, 0.009, 0.012), pupil), eyeIn);
          wet = eyeIn;
          // a thin dark orbit ring seats the eye in the head
          alb *= 1.0 - 0.45 * (smoothstep(0.036, 0.044, eyeD) * (1.0 - smoothstep(0.044, 0.056, eyeD)));
        } else {
          // ---- fin membrane: rays fanning from the root, jointed, a paler free edge ----
          float q = vSurf.y * uSkinB.y;
          float rq = abs(fract(q) - 0.5) * 2.0;
          float rAA = 1.0 - smoothstep(0.3, 0.8, fwidth(q));
          rays = (1.0 - smoothstep(0.0, 0.34, 1.0 - rq)) * rAA;
          float joint = step(0.82, fract(vSurf.x * 7.0 + q * 0.13)) * rays;
          // the free edge is scalloped between the rays: membrane recedes, ray tips lead
          float edgeS = 1.0 - 0.16 * (1.0 - rq) * (1.0 - rq);
          if (vSurf.x > edgeS && vSurf.z > 0.5) discard;
          alb *= mix(0.78, 0.42, rays) * (1.0 + 0.25 * joint);
          alb = mix(alb, alb * 0.7, smoothstep(0.7, 1.0, vSurf.x / edgeS));
          fh = rays * 0.9 - joint * 0.3;
        }
        normal = skBump(-vViewPosition, normal, fh * uSkinA.z, faceDirection);
        // ---- iridescence: a fresnel-weighted hue walk, strongest at grazing ----
        float fr = pow(1.0 - clamp(abs(dot(normal, fV)), 0.0, 1.0), 2.2);
        vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + fr * 0.85 + scId * 0.12 + uSkinB.x));
        alb = mix(alb, alb * (0.6 + 0.8 * irid), uSkinA.w * body * (1.0 - wet) * (0.2 + 0.8 * fr));
        diffuseColor.rgb *= alb * mix(0.46, 1.0, body);
        roughnessFactor = mix(roughnessFactor, 0.07, wet);
        // no env map on these materials: raw metalness only blackens the flank, so the
        // mirror is carried by skEnv below and the lit layer stays mostly dielectric
        metalnessFactor = mix(metalnessFactor * 0.3, 0.0, wet);
        // thin membrane: light from behind comes through between the rays
        totalEmissiveRadiance += diffuseColor.rgb * skTransmit(normal, vViewPosition) * (1.0 - body) * (1.0 - 0.7 * rays) * 0.38;
        // silver flank: the guanine layer mirrors the bright water above as the fish turns
        totalEmissiveRadiance += skEnv(normal, fV) * (alb * 0.7 + 0.3) * uSilver * 1.8 * body * (1.0 - wet) * (0.55 + 0.45 * (1.0 - smoothstep(0.55, 0.95, fy)));
        // catchlight on the wet dome
        totalEmissiveRadiance += skCatch(normal, fV, vViewPosition) * wet * (0.35 + 0.65 * pupil);
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
    injectStrokes(sh);   // SILHOUETTE STROKES (lib/paint.js)
  };
  return registerPaint(mat);
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
    amp: 0.135, beat: 6.5, floorBias: 0.2, pelvic: 1
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
  // RETUNE after the dead-smoothstep fix: glowI values below were balanced while the
  // photophore rows returned 0.0 (only glowI*base ever drew). With the rows live the
  // old numbers read as LEDs. glowI is cut toward faint paired running lights and
  // `base` is raised so glowI*base — the ghost-body glow that WAS the shipped look —
  // stays at its authored product. Verified live at close range and at distance.
  {
    zi: 1, copies: 2, n: 55, sz: [0.62, 1.1], speed: 7.4, radius: 7, local: 2.9, fear: 19,
    rings: 6, sides: 6, w: 0.22, h: 0.46, taper: 0.66, tail: 0.38, dorsal: 0.08, pect: 0.06,
    col: 0x3d5478, jit: 0.12, glow: 0x5fd8ff, glowI: 1.2, dots: 62, base: 0.012, rough: 0.24, metal: 0.5,   // glowI 2.8->1.2, base 0.005->0.012
    amp: 0.125, beat: 11
  },
  {
    zi: 1, copies: 1, n: 23, sz: [1.5, 2.4], speed: 3.6, radius: 9, local: 1.8, fear: 22,
    rings: 7, sides: 7, w: 0.26, h: 0.74, taper: 0.44, tail: 0.46, dorsal: 0.16, pect: 0.1,
    col: 0x6a3d86, jit: 0.2, glow: 0xff7ad8, glowI: 1.4, dots: 34, base: 0.019, rough: 0.5, metal: 0.1,     // glowI 3.4->1.4, base 0.008->0.019
    amp: 0.1, beat: 5.2, pelvic: 1
  },
  // zone 2 — abyssal: near-transparent bodies, photophore rows doing the work
  {
    zi: 2, copies: 2, n: 40, sz: [0.62, 1.1], speed: 5.4, radius: 6.5, local: 2.2, fear: 20,
    rings: 6, sides: 6, w: 0.2, h: 0.42, taper: 0.68, tail: 0.4, dorsal: 0.07, pect: 0.05,
    col: 0x22333d, jit: 0.06, glow: 0x8dffe4, glowI: 1.5, dots: 96, base: 0.08, rough: 0.3, metal: 0.3,     // glowI 7.5->1.5 (blew out to white at 4u), base 0.016->0.08
    amp: 0.14, beat: 9
  },
  {
    zi: 2, copies: 1, n: 16, sz: [1.3, 2.1], speed: 2.8, radius: 10, local: 1.5, fear: 24,
    rings: 6, sides: 7, w: 0.24, h: 0.92, taper: 0.4, tail: 0.32, dorsal: 0.18, pect: 0.12,
    col: 0x2c4250, jit: 0.08, glow: 0xbfe8ff, glowI: 1.4, dots: 54, base: 0.084, rough: 0.22, metal: 0.55,  // glowI 6.5->1.4, base 0.018->0.084
    amp: 0.08, beat: 4.2, pelvic: 1
  }
];

export const schools = [];
export const fish = schools; // convenience alias

// ---------------------------------------------------------------------------
// SCULPTED SCHOOLS (fauna2). Every species' body is a baked sculpt (entities/schoolSculpt.js
// through tools/blender -> assets/fauna/school/: one atlas, so a school is still ONE draw).
// The procedural fish above stays: it is the boot-time build, the fallback when the asset
// is missing (loadSculpted never throws), and the FAR LOD (a school past SCULPT_LOD_R
// swaps back to it; the instanced attributes are the SAME objects on both geometries, so
// a swap moves no data). Motion is untouched: the sculpted vertices carry the attributes
// the vertex shader reads (uv = body t + fin flag, aSurf = root->edge), labelled from the
// same analytic anatomy the bake was cut from (fishKit labelVertex). Atlas uvs ride uv1.
// ?fishproc = the procedural A/B. window.__school.state().
// ---------------------------------------------------------------------------
const SCULPT_NAME = ['herring', 'snapper', 'butterfly', 'needlefish', 'scad', 'pomfret', 'bristlemouth', 'hatchet'];
const SCULPT_LOD_R = 50;
const sculpt = { asset: null, geos: {}, ms: 0, on: true, n: 0 };

function labelFishGeometry(src, fish) {
  const g = new THREE.BufferGeometry();
  const pos = src.attributes.position, n = pos.count;
  g.setAttribute('position', pos);
  g.setAttribute('normal', src.attributes.normal);
  g.setAttribute('uv1', src.attributes.uv);
  if (src.index) g.setIndex(src.index);
  const uv = new Float32Array(n * 2), surf = new Float32Array(n * 3), L = { fin: -1, s: 0, q: 0, eye: 0 };
  const P = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    labelVertex(fish, x, y, z, L);
    uv[i * 2] = 0.5 - z;
    if (L.fin < 0) {
      fish.profAt(Math.min(1, Math.max(0, 0.5 - z)), P);
      const cy = (P[0] - P[1]) * 0.5;
      const a = Math.atan2(y - cy, x);
      uv[i * 2 + 1] = 0.5 + 0.5 * Math.sin(a);
      surf[i * 3] = 0.5 - z; surf[i * 3 + 1] = (a / (Math.PI * 2) + 1) % 1; surf[i * 3 + 2] = L.eye ? 0.5 : 0;
    } else {
      const F = fish.fins[L.fin];
      uv[i * 2 + 1] = 2.0;
      // aSurf.x drives the pectoral scull hinge (vertex shader): pectorals only
      surf[i * 3] = F.name === 'pectoral' ? L.s : 0; surf[i * 3 + 1] = L.s; surf[i * 3 + 2] = 1;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3));
  g.computeBoundingSphere();
  return g;
}

function fishSculptMaterial(sp, u, maps) {
  // the atlas rides uv1 (uv is the motion's body coordinate)
  for (const t of [maps.map, maps.normalMap, maps.ormMap]) if (t.channel !== 1) { t.channel = 1; t.needsUpdate = true; }
  const mat = new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.ormMap, aoMap: maps.ormMap,
    roughness: 1, metalness: 0, side: THREE.DoubleSide, emissive: 0x000000, aoMapIntensity: 0.9
  });
  mat.userData.u = u;
  const uS = { uBaseCol: { value: new THREE.Color(sp.col) }, uOrm: { value: maps.ormMap } };
  mat.customProgramCacheKey = () => 'abyssa-fish-sculpt';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u, uS);
    fishVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uGlow; uniform float uTime; uniform float uBase; uniform vec3 uBaseCol; uniform sampler2D uOrm;
        uniform vec4 uSkinA; uniform vec4 uSkinB; uniform float uSilver; uniform float uFarVis;
        varying vec2 vFuv; varying vec3 vTint; varying float vPh; varying vec3 vSurf;
        ${SKIN_COMMON}`)
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
        ${SKIN_LIGHTS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float farFlash = 1.0 + uFarVis * 2.0 * smoothstep(40.0, 90.0, length(vViewPosition));
        // the sculpt carries the anatomy and the pattern; this adds what light does to it
        float body = step(vFuv.y, 1.5);
        float fy = clamp(vFuv.y, 0.0, 1.0);
        vec3 fV = normalize(vViewPosition);
        vec4 ormS = texture2D(uOrm, vRoughnessMapUv);
        // each fish its own: the layout's per-fish tint as a ratio to the species colour
        diffuseColor.rgb *= clamp(mix(vec3(1.0), vTint / max(uBaseCol, vec3(0.02)), 0.55), 0.6, 1.5);
        // the wet eye (baked mirror-smooth) and the cornea's catchlight
        float wet = (1.0 - smoothstep(0.06, 0.12, roughnessFactor)) * step(0.25, vSurf.z) * body;
        float fr = pow(1.0 - clamp(abs(dot(normal, fV)), 0.0, 1.0), 2.2);
        vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + fr * 0.85 + vPh * 0.05 + uSkinB.x));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.7 + 0.6 * irid), uSkinA.w * body * (1.0 - wet) * (0.1 + 0.4 * fr));
        metalnessFactor = 0.0;
        // fin membrane: light from behind comes through, more toward the free edge
        totalEmissiveRadiance += diffuseColor.rgb * skTransmit(normal, vViewPosition) * (1.0 - body) * (0.25 + 0.35 * vSurf.y) * 0.5;
        // silver flank: the guanine mirror of the bright water above
        totalEmissiveRadiance += skEnv(normal, fV) * (vec3(dot(diffuseColor.rgb, vec3(0.3333))) * 0.8 + 0.2) * uSilver * 1.1 * farFlash * body * (1.0 - wet) * (0.5 + 0.5 * (1.0 - smoothstep(0.55, 0.95, fy)));
        totalEmissiveRadiance += skCatch(normal, fV, vViewPosition) * wet;
        // baked photophores (ORM.B): dim, breathing; zone 0 species bake none
        float beat = 0.6 + 0.4 * sin(uTime * 2.2 + vPh * 3.0);
        totalEmissiveRadiance += uGlow * smoothstep(0.08, 0.3, ormS.b) * ormS.b * beat * 1.6;
        totalEmissiveRadiance += uGlow * uBase * body;`);
    injectStrokes(sh);
  };
  if (maps.normalMap.userData.rg) patchNormalRG(mat);   // BC5 (KTX2): rebuild the normal's Z
  return registerPaint(mat);
}

function installSchoolSculpt(a) {
  const t0 = performance.now();
  if (!a || !a.geos) return;
  sculpt.asset = a;
  const fishes = {};
  for (const S of schools) {
    const k = SCULPT_NAME[SPECIES.indexOf(S.sp)];
    const src = k && a.geos[k];
    if (!src || !FISH[k]) continue;
    if (!sculpt.geos[k]) { fishes[k] = fishes[k] || makeFish(FISH[k]); sculpt.geos[k] = labelFishGeometry(src, fishes[k]); }
    // a geometry per school (its own instanced attributes), sharing the labelled buffers
    const g = new THREE.BufferGeometry(), base = sculpt.geos[k];
    for (const nm in base.attributes) g.setAttribute(nm, base.attributes[nm]);
    g.setIndex(base.index);
    g.boundingSphere = base.boundingSphere;
    const pg = S.inst.geometry;
    for (const nm of ['aTint', 'aFish', 'aFishK']) g.setAttribute(nm, pg.attributes[nm]);
    S.procGeo = pg; S.procMat = S.inst.material;
    S.sculptGeo = g; S.sculptMat = fishSculptMaterial(S.sp, S.mat.userData.u, a.maps.school);
    // the far LOD: the same animal at ~260 tris from its own small atlas
    const fk = k + '_far';
    if (a.geos[fk] && a.maps.schoolFar) {
      if (!sculpt.geos[fk]) sculpt.geos[fk] = labelFishGeometry(a.geos[fk], fishes[k] || (fishes[k] = makeFish(FISH[k])));
      const fg = new THREE.BufferGeometry(), fb = sculpt.geos[fk];
      for (const nm in fb.attributes) fg.setAttribute(nm, fb.attributes[nm]);
      fg.setIndex(fb.index); fg.boundingSphere = fb.boundingSphere;
      for (const nm of ['aTint', 'aFish', 'aFishK']) fg.setAttribute(nm, pg.attributes[nm]);
      S.farGeo = fg; S.farMat = fishSculptMaterial(S.sp, S.mat.userData.u, a.maps.schoolFar);
    }
    sculpt.n++;
  }
  sculpt.ms = performance.now() - t0;
}
// per frame, per visible school: near = sculpt, far (or ?fishproc) = the procedural build
function schoolLod(S) {
  if (!S.sculptGeo) return;
  // the LENS's distance, not the diver's: what decides the read is the pixels
  const near = S.center.distanceTo(camera.position) < SCULPT_LOD_R + S.radius;
  let g = S.procGeo, m = S.procMat;
  if (sculpt.on) { if (near || !S.farGeo) { g = S.sculptGeo; m = S.sculptMat; } else { g = S.farGeo; m = S.farMat; } }
  if (S.inst.geometry !== g) { S.inst.geometry = g; S.inst.material = m; }
}
if (typeof window !== 'undefined') window.__school = {
  state: () => ({ installed: sculpt.n, ms: +sculpt.ms.toFixed(1), on: sculpt.on, lodR: SCULPT_LOD_R,
    near: schools.filter(S => S.sculptGeo && S.inst.geometry === S.sculptGeo && S.inst.visible).length,
    far: schools.filter(S => S.farGeo && S.inst.geometry === S.farGeo && S.inst.visible).length,
    tris: schools.reduce((t, S) => t + (S.inst.visible ? S.inst.geometry.index.count / 3 * S.n : 0), 0) }),
  on: v => { sculpt.on = !!v; for (const S of schools) schoolLod(S); return sculpt.on; },
  farVis: v => { FARVIS.value = v ? 1 : 0; return FARVIS.value; }
};

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

  const tint = new Float32Array(n * 3), fdat = new Float32Array(n * 4), fkey = new Float32Array(n);
  const sz = new Float32Array(n);
  const P = new Float32Array(n * 3), V = new Float32Array(n * 3), F = new Float32Array(n * 3);
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  const aFish = new THREE.InstancedBufferAttribute(fdat, 4);
  aFish.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFish', aFish);
  geo.setAttribute('aFishK', new THREE.InstancedBufferAttribute(fkey, 1));
  scene.add(inst);

  const S = {
    inst, mat, n, zi: sp.zi, sp, P, V, F, sz, seed,
    tint: geo.attributes.aTint, fdat: geo.attributes.aFish, fkey: geo.attributes.aFishK,
    bank: new Float32Array(n), phs: new Float32Array(n),
    // anim-fauna per-fish motion state: beat phase, beat-rate multiplier, smoothed
    // effort, turn bend, startle clock (+ its direction), glide clock, scull
    bp: new Float32Array(n), rate: new Float32Array(n), eff: new Float32Array(n), bend: new Float32Array(n),
    stl: new Float32Array(n), sdir: new Float32Array(n * 3), glide: new Float32Array(n), gcnt: new Uint16Array(n),
    scull: new Float32Array(n), yawR: new Float32Array(n),
    // the school's threat list this frame, in school-local space: x y z R vx vy vz fear
    th: new Float32Array(10 * 8), thN: 0,
    mill: 0, millT: 0, millDir: seed % 2 ? 1 : -1, alarm: 0,
    // per-fish proportion variety: depth (up-basis) and length (heading) multipliers
    szY: new Float32Array(n), szL: new Float32Array(n),
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
  const tint = S.tint.array, fdat = S.fdat.array, fkey = S.fkey.array;
  const base = new THREE.Color(sp.col), c = new THREE.Color();
  const P = S.P, V = S.V, F = S.F, sz = S.sz;
  for (let i = 0; i < n; i++) {
    c.copy(base).offsetHSL(rr(-0.03, 0.03), rr(-0.12, 0.12), rr(-sp.jit, sp.jit));
    tint[i * 3] = c.r; tint[i * 3 + 1] = c.g; tint[i * 3 + 2] = c.b;
    // same two draws as ever (the layout stream order is contract): the seed, the rate
    fkey[i] = _cr() * 6.283;
    S.rate[i] = rr(0.85, 1.2);
    S.bp[i] = fkey[i]; S.eff[i] = 0.5; S.bend[i] = 0; S.stl[i] = 0; S.scull[i] = 0; S.yawR[i] = 0;
    S.glide[i] = hash01(i, S.seed) * 2 - 1; S.gcnt[i] = 0;
    fdat[i * 4] = fkey[i]; fdat[i * 4 + 1] = sp.amp; fdat[i * 4 + 2] = 0; fdat[i * 4 + 3] = 0;
    sz[i] = rr(sp.sz[0], sp.sz[1]);
    // free silhouette variety: deep-bodied vs slender, stubby vs elongate
    S.szY[i] = rr(0.88, 1.18);
    S.szL[i] = rr(0.92, 1.08);
    P[i * 3] = rr(-sp.radius, sp.radius);
    P[i * 3 + 1] = rr(-sp.radius, sp.radius) * 0.4;
    P[i * 3 + 2] = rr(-sp.radius, sp.radius);
    V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0;
    F[i * 3] = F[i * 3 + 1] = 0; F[i * 3 + 2] = 1;
    S.bank[i] = 0;
    S.phs[i] = _cr() * 6.283;
  }
  S.tint.needsUpdate = true; S.fdat.needsUpdate = true; S.fkey.needsUpdate = true;
  S.mill = 0; S.millT = 0; S.alarm = 0;

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

// Behavioural randomness that must NOT touch the layout stream: a hash of (fish, count).
function hash01(a, b) { const s = Math.sin(a * 127.1 + b * 311.7 + 17.13) * 43758.5453; return s - Math.floor(s); }

// ---------------------------------------------------------------------------
// THE SCHOOL (anim-fauna). What real schools do, and what this now does:
//   POLARISED TRAVEL — on the move every fish points the school's way; the scatter is
//     a few degrees, and fish still shuffle inside the shoal (no lockstep).
//   MILLING — at a goal the school stops travelling and TURNS: a slow torus about the
//     vertical, each school its own hand. Fish scull on their pectorals as they slow.
//   SPLIT AND REJOIN — a big body (Sal, a shark, the sleeper, the ray) inside the
//     school opens a HOLE in it: fish dodge sideways off the intruder's line of travel
//     (the fountain effect) and cohesion to the centre is relaxed near it, so the
//     school parts round him and closes behind.
//   STARTLE — a C-start: the body snaps into a curl, then a burst of fast tail beats
//     away. Triggered by a sonar front crossing the fish, a strike or slam nearby, or
//     an intruder closing fast; it SPREADS to topological neighbours ~70 ms later, so a
//     flash-expansion ripples through the school instead of every fish flinching at once.
//   DENSITY/AGITATION WAVE — with a predator about, a roll wave runs across the school
//     (the silver flanks flash in a travelling band, the shimmer of a baitball).
//   BURST AND GLIDE — each fish beats in bouts and coasts between them on its own clock;
//     beat rate and amplitude follow ITS speed and effort, not a school-wide phase.
//   TURNING — heading is rate-limited (no snapping); the body bends into the turn and
//     banks, the bend feeding the vertex wave.
// ---------------------------------------------------------------------------
function schoolThreats(S) {
  const c = S.center;
  S.thN = 0;
  const th = S.th, reach = S.fear * 2.6;
  for (let s = 0; s < MOVER_N; s++) {
    if (!moverLive(s)) continue;
    const o = s * 9;
    const x = MV[o] - c.x, y = MV[o + 1] - c.y, z = MV[o + 2] - c.z;
    const R = S.fear * (0.12 + 0.62 * MV[o + 7] * MV[o + 7]) + MV[o + 3] * 2.2;
    if (x * x + y * y + z * z > (reach + R) * (reach + R)) continue;
    const k = S.thN++ * 8;
    th[k] = x; th[k + 1] = y; th[k + 2] = z; th[k + 3] = R;
    th[k + 4] = MV[o + 4]; th[k + 5] = MV[o + 5]; th[k + 6] = MV[o + 6]; th[k + 7] = MV[o + 7];
    if (S.thN >= 9) break;
  }
  // the lantern: zones 1-2 are light-shy. A soft sphere, never a panic.
  if (S.zi > 0 && LANT.k > 0.2 && S.thN < 10) {
    const x = LANT.x - c.x, y = LANT.y - c.y, z = LANT.z - c.z;
    if (x * x + y * y + z * z < (reach + 8) * (reach + 8)) {
      const k = S.thN++ * 8;
      th[k] = x; th[k + 1] = y; th[k + 2] = z; th[k + 3] = 5 + 3 * LANT.k; th[k + 4] = th[k + 5] = th[k + 6] = 0; th[k + 7] = 0.15;
    }
  }
}

function updateSchool(S, dt, t) {
  const c = S.center, cv = S.cvel, sp = S.sp;

  // ---- school centre: travel to a goal, then MILL there a while ----
  S.goalT -= dt;
  const atGoal = tmpV.copy(S.goal).sub(c).lengthSq() < 64;
  if (S.millT > 0) {
    S.millT -= dt;
    if (S.millT <= 0) pickGoal(S);
  } else if (atGoal || S.goalT <= 0) {
    // about half the arrivals turn into a mill; the rest press straight on
    if (hash01(S.seed * 31 + (t | 0), 7.7) < 0.55) S.millT = 8 + hash01(S.seed, t) * 14;
    else pickGoal(S);
  }
  S.mill += ((S.millT > 0 ? 1 : 0) - S.mill) * Math.min(1, dt * 0.5);
  if (S.millT <= 0) {
    tmpV.copy(S.goal).sub(c);
    const gd = tmpV.length() || 1;
    cv.addScaledVector(tmpV.divideScalar(gd), S.speed * 0.7 * dt);
  }

  schoolThreats(S);
  // a threat that sits inside the school's reach pushes the whole shoal off (and
  // raises the alarm that drives the agitation wave)
  let alarmT = 0;
  const th = S.th;
  for (let k = 0; k < S.thN; k++) {
    const o = k * 8;
    const d = Math.sqrt(th[o] * th[o] + th[o + 1] * th[o + 1] + th[o + 2] * th[o + 2]) + 1e-3;
    // the SHOAL moves off only for real danger (the fear term squared: a shark or a
    // sleeper shifts the whole school, a drifting diver is met fish by fish and the
    // school opens round him instead of sliding away as a block)
    const R = th[o + 3] * 1.5;
    if (d < R) {
      const s = (1 - d / R) * th[o + 7] * th[o + 7];
      cv.x -= th[o] / d * s * S.speed * 3.2 * dt; cv.y -= th[o + 1] / d * s * S.speed * 1.2 * dt; cv.z -= th[o + 2] / d * s * S.speed * 3.2 * dt;
      if (th[o + 7] > 0.6 && s > alarmT) alarmT = s;
    }
  }
  cv.multiplyScalar(Math.pow(S.millT > 0 ? 0.25 : 0.45, dt));
  const cs = cv.length();
  if (cs > S.speed) cv.multiplyScalar(S.speed / cs);
  c.addScaledVector(cv, dt);

  const hr = Math.hypot(c.x, c.z);
  if (hr > WORLD_R * 0.72) {
    const k = WORLD_R * 0.72 / hr;
    c.x *= k; c.z *= k; cv.x *= -0.35; cv.z *= -0.35; S.goalT = 0; S.millT = 0;
  }
  const floor = terrainH(c.x, c.z, S.zi);
  const yLo = Math.max(zoneBottom(S.zi) + 8, floor + S.radius + 5);
  const yHi = Math.max(yLo + 2, zoneTop(S.zi) - 10 - S.radius);
  if (c.y < yLo) { c.y = yLo; cv.y = Math.abs(cv.y) * 0.5; }
  else if (c.y > yHi) { c.y = yHi; cv.y = -Math.abs(cv.y) * 0.5; }

  S.inst.boundingSphere.center.copy(c);

  // ---- distance cull: past the fog wall nothing is visible ----
  const pd = c.distanceTo(player.pos);
  if (pd > cullR + S.radius) {
    if (S.inst.visible) S.inst.visible = false;
    return;
  }
  S.inst.visible = true;
  schoolLod(S);

  // ---- boids, in school-local space so the whole flock translates for free ----
  const P = S.P, V = S.V, F = S.F, BK = S.bank, PH = S.phs, n = S.n;
  const BP = S.bp, EF = S.eff, BD = S.bend, ST = S.stl, SD = S.sdir, GL = S.glide, SC = S.scull, YR = S.yawR;
  const arr = S.inst.instanceMatrix.array, fd = S.fdat.array;
  const sepR2 = (sp.sz[1] * 3.2) ** 2, nbR2 = (sp.sz[1] * 12) ** 2;
  const roll = S.roll = (S.roll + 5) % n;
  const floorLocal = floor + 2.5 - c.y;
  const mill = S.mill, travel = 1 - mill;
  const cvl = Math.sqrt(cv.x * cv.x + cv.y * cv.y + cv.z * cv.z);
  const topSpeed = S.speed + S.local * 2;
  let panic = 0;
  S.alarm = Math.max(S.alarm - dt * 0.33, alarmT);
  const wave = S.alarm;

  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    const x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
    let ax = 0, ay = 0, az = 0;
    let nbStartle = 0;

    for (let k = 0; k < 6; k++) {
      const j = (i + NB[k] + roll) % n, j3 = j * 3;
      const dx = P[j3] - x, dy = P[j3 + 1] - y, dz = P[j3 + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz + 1e-4;
      if (d2 > nbR2) continue;
      // a neighbour that bolted ~70 ms ago: the startle travels (flash expansion)
      if (ST[j] > 0.30 && ST[j] < 0.40 && ST[i] <= 0) nbStartle = Math.max(nbStartle, 1);
      if (d2 < sepR2) {
        const inv = 2.6 / d2;
        ax -= dx * inv; ay -= dy * inv; az -= dz * inv;
      } else {
        const al = 0.9 * (1 - 0.8 * mill);
        ax += (V[j3] - V[i3]) * al + dx * 0.05;
        ay += (V[j3 + 1] - V[i3 + 1]) * al + dy * 0.05;
        az += (V[j3 + 2] - V[i3 + 2]) * al + dz * 0.05;
      }
    }

    // intruders: dodge SIDEWAYS off their line (fountain), and let go of the centre
    // near them so the school opens round the body instead of re-forming inside it
    let hole = 0, qx = 0, qy = 0, qz = 0, sk = 0;
    for (let k = 0; k < S.thN; k++) {
      const o = k * 8;
      const fx = x - th[o], fy = y - th[o + 1], fz = z - th[o + 2];
      const R = th[o + 3], fd2 = fx * fx + fy * fy + fz * fz;
      if (fd2 > R * R) continue;
      const fdd = Math.sqrt(fd2) + 0.01, s = 1 - fdd / R;
      const vx = th[o + 4], vy = th[o + 5], vz = th[o + 6];
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
      let ux = fx / fdd, uy = fy / fdd, uz = fz / fdd;
      if (vl > 0.5) {
        // remove most of the along-track component: fish peel off to the sides
        const along = (ux * vx + uy * vy + uz * vz) / vl;
        ux -= vx / vl * along * 0.7; uy -= vy / vl * along * 0.7; uz -= vz / vl * along * 0.7;
        const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) + 1e-4; ux /= ul; uy /= ul; uz /= ul;
      }
      const k2 = s * s * 60 * th[o + 7] + s * 6;
      ax += ux * k2; ay += uy * k2 * 0.6; az += uz * k2;
      if (s > hole) hole = s;
      const pn = s * th[o + 7];
      if (pn > panic) panic = pn;
      // an intruder CLOSING on this fish fast, well inside its bubble, makes it bolt
      const close = -(fx * vx + fy * vy + fz * vz) / fdd;
      const trig = s * th[o + 7] * Math.min(1, Math.max(0, close) / 4);
      if (trig > sk) { sk = trig; qx = ux; qy = uy; qz = uz; }
    }

    // world-space startle sources (sonar front, strike, slam, footfall)
    const wx0 = c.x + x, wy0 = c.y + y, wz0 = c.z + z;
    const pk = pulseAt(wx0, wy0, wz0);
    if (pk > sk) { sk = pk; qx = PULSE_DIR.x; qy = PULSE_DIR.y; qz = PULSE_DIR.z; }
    if (ST[i] <= 0) {
      let go = sk > 0.35;
      if (!go && nbStartle > 0 && hash01(i + S.gcnt[i] * 13, t * 7.3) < 0.7) {
        go = true;
        // a relayed startle follows the neighbour's bolt, jittered
        const j = (i + NB[0] + roll) % n;
        qx = SD[j * 3] + (hash01(i, 1.1) - 0.5) * 0.8; qy = SD[j * 3 + 1] * 0.5; qz = SD[j * 3 + 2] + (hash01(i, 2.3) - 0.5) * 0.8;
      }
      if (go) {
        const ql = Math.sqrt(qx * qx + qy * qy + qz * qz) + 1e-4;
        SD[i3] = qx / ql; SD[i3 + 1] = qy / ql; SD[i3 + 2] = qz / ql;
        ST[i] = 0.42;
        S.gcnt[i]++;
        // stage 1 of the C-start: curl AWAY from the heading we are about to take
        const side = F[i3 + 2] * SD[i3] - F[i3] * SD[i3 + 2];
        BD[i] = side >= 0 ? -0.9 : 0.9;
        V[i3] += SD[i3] * S.local * 3.2; V[i3 + 1] += SD[i3 + 1] * S.local * 1.6; V[i3 + 2] += SD[i3 + 2] * S.local * 3.2;
      }
    }
    const startled = ST[i] > 0;
    if (startled) {
      ST[i] -= dt;
      const k2 = 18 * ST[i];
      ax += SD[i3] * k2; ay += SD[i3 + 1] * k2 * 0.5; az += SD[i3 + 2] * k2;
      if (ST[i] <= 0) ST[i] = -0.8;   // refractory: a fish cannot bolt again at once
    } else if (ST[i] < 0) ST[i] = Math.min(0, ST[i] + dt);

    // cohesion toward the school centre, flattened vertically (schools are discs); in a
    // mill the pull is to a RING (the torus), with the swirl tangent about the vertical
    const rl = Math.sqrt(x * x + y * y + z * z) + 1e-4;
    const let_go = 1 - hole * 0.85;
    if (mill > 0.02) {
      // each fish pursues its own slot on the torus: slots spread evenly round the ring
      // (so the mill is a ring, never a clump orbiting the centre), each on its own
      // radius and height band, all turning together at the school's hand
      const ring = S.radius * 0.7;
      const ri = ring * (0.6 + 0.6 * hash01(i, 5.5)), yi = (hash01(i, 9.1) - 0.5) * S.radius * 0.5;
      const om = S.local * 1.1 / ring * S.millDir;
      const th0 = i / n * TAU + t * om;
      const cx0 = Math.cos(th0) * ri, cz0 = Math.sin(th0) * ri;
      const dvx = (cx0 - x) * 0.9 - Math.sin(th0) * ri * om, dvy = (yi - y) * 0.6, dvz = (cz0 - z) * 0.9 + Math.cos(th0) * ri * om;
      const mk = 1.6 * mill * let_go;
      ax += (dvx - V[i3]) * mk; ay += (dvy - V[i3 + 1]) * mk; az += (dvz - V[i3 + 2]) * mk;
    }
    const pull = (0.55 + Math.max(0, rl - S.radius) * 0.8) * let_go * (0.35 + 0.65 * travel);
    ax -= x / rl * pull; ay -= y / rl * pull * 2.4; az -= z / rl * pull;

    // wander: smaller while polarised, so a travelling school points one way
    const ph = PH[i], wk = 0.7 + 0.5 * mill;
    ax += Math.sin(t * 0.9 + ph) * 1.1 * wk;
    ay += Math.sin(t * 0.63 + ph * 1.7) * 0.5 * wk;
    az += Math.cos(t * 1.13 + ph * 0.6) * 1.1 * wk;

    // burst and glide: the glide clock runs negative while coasting
    GL[i] += dt;
    if (GL[i] > 0 && GL[i] > 0.5 + hash01(i, S.gcnt[i] + 0.5) * 0.9) { GL[i] = -(0.35 + hash01(i, S.gcnt[i] + 3.1) * 1.0); S.gcnt[i]++; }
    const gliding = GL[i] < 0 && !startled && panic < 0.2;

    let vx = V[i3] + ax * dt, vy = V[i3 + 1] + ay * dt, vz = V[i3 + 2] + az * dt;
    if (gliding) { const g = Math.pow(0.7, dt); vx *= g; vy *= g; vz *= g; }
    const spd = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-5;
    const maxS = S.local * (1 + panic * 3.5 + (startled ? 3 : 0)), minS = S.local * 0.2;
    const cl = spd > maxS ? maxS / spd : (spd < minS ? minS / spd : 1);
    vx *= cl; vy *= cl; vz *= cl;

    let ny = y + vy * dt;
    if (ny < floorLocal) { ny = floorLocal; vy = Math.abs(vy); }
    P[i3] = x + vx * dt; P[i3 + 1] = ny; P[i3 + 2] = z + vz * dt;
    // panic can fling fringe fish past the 2.2x bounding sphere and the frustum
    // cull pops them — clamp local offsets inside 2.1x so the sphere always holds
    const lr = S.radius * 2.1;
    const ld2 = P[i3] * P[i3] + P[i3 + 1] * P[i3 + 1] + P[i3 + 2] * P[i3 + 2];
    if (ld2 > lr * lr) {
      const kk = lr / Math.sqrt(ld2);
      P[i3] *= kk; P[i3 + 1] *= kk; P[i3 + 2] *= kk;
    }
    const dvx = vx - V[i3], dvy = vy - V[i3 + 1], dvz = vz - V[i3 + 2];
    V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;

    // world velocity: in a mill the school's own drift is small and the swirl leads
    const wx = vx + cv.x, wy = vy + cv.y, wz = vz + cv.z;
    const wl = Math.sqrt(wx * wx + wy * wy + wz * wz) + 1e-5;
    let dx = wx / wl, dy = wy / wl, dz = wz / wl;
    dy = clamp(dy, -0.6, 0.6);

    // rate-limited turn toward the travel direction (slerp by at most maxA)
    const fx0 = F[i3], fy0 = F[i3 + 1], fz0 = F[i3 + 2];
    const cosA = clamp(fx0 * dx + fy0 * dy + fz0 * dz, -1, 1), ang = Math.acos(cosA);
    const maxA = (2.6 + (startled ? 14 : 0) + panic * 5) * dt;
    let hx, hy, hz;
    if (ang > maxA && ang > 1e-4) {
      const sA = Math.sin(ang), k0 = Math.sin(ang - maxA) / sA, k1 = Math.sin(maxA) / sA;
      hx = fx0 * k0 + dx * k1; hy = fy0 * k0 + dy * k1; hz = fz0 * k0 + dz * k1;
    } else { hx = dx; hy = dy; hz = dz; }
    const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) + 1e-6; hx /= hl; hy /= hl; hz /= hl;
    // signed yaw rate (rad/s), + = turning left seen from above
    const turn = (fz0 * hx - fx0 * hz) / Math.max(dt, 1e-3);
    F[i3] = hx; F[i3 + 1] = hy; F[i3 + 2] = hz;
    YR[i] += (turn - YR[i]) * Math.min(1, dt * 10);

    // bank into the turn, plus the agitation wave rolling across the school
    const waveR = wave > 0.02 ? wave * 0.55 * Math.sin((x * 0.55 + z * 0.35) - t * 7.0) : 0;
    const bt = clamp(YR[i] * 0.3, -1.0, 1.0) + waveR;
    const b = BK[i] += (bt - BK[i]) * Math.min(1, dt * 8);

    // ---- the swimming body: effort from the thrust the fish is actually making ----
    const fwdAcc = (dvx * hx + dvy * hy + dvz * hz) / Math.max(dt, 1e-3);
    const sn = clamp(wl / topSpeed, 0, 1.5);
    let effT = 0.35 + sn * 0.75 + clamp(fwdAcc / 10, 0, 0.8) + Math.abs(YR[i]) * 0.12;
    if (gliding) effT *= 0.18;
    if (startled) effT = 2.2;
    EF[i] += (effT - EF[i]) * Math.min(1, dt * (startled ? 20 : 5));
    BP[i] += dt * sp.beat * S.rate[i] * (0.35 + 0.75 * Math.min(EF[i], 2.4));
    if (BP[i] > 6283.18) BP[i] -= 6283.18;
    // the bend: the C-start curl relaxes into the turn bend
    const bendT = clamp(-YR[i] * 0.06, -0.35, 0.35);
    BD[i] += (bendT - BD[i]) * Math.min(1, dt * (startled && ST[i] < 0.34 ? 14 : 6));
    // pectorals scull when the fish is slow or holding station
    const scT = clamp(1 - sn * 3.2, 0, 1) * (startled ? 0 : 1);
    SC[i] += (scT - SC[i]) * Math.min(1, dt * 3);
    const q = i * 4;
    fd[q] = BP[i];
    fd[q + 1] = sp.amp * clamp(0.25 + 0.7 * EF[i], 0.08, 1.9);
    fd[q + 2] = BD[i];
    fd[q + 3] = SC[i];

    // right = up x fwd, up = fwd x right, then rolled by b about fwd
    let rx = hz, rz = -hx, rlen = Math.hypot(rx, rz);
    if (rlen < 1e-4) { rx = 1; rz = 0; rlen = 1; }   // fish swimming straight up/down
    rx /= rlen; rz /= rlen;
    const ux = hy * rz, uy = hz * rx - hx * rz, uz = -hy * rx;
    const cb = Math.cos(b), sb = Math.sin(b), s = S.sz[i];
    const sy = s * S.szY[i], sl = s * S.szL[i];   // per-fish depth / length variety
    const o = i * 16;
    arr[o] = (rx * cb + ux * sb) * s; arr[o + 1] = uy * sb * s; arr[o + 2] = (rz * cb + uz * sb) * s; arr[o + 3] = 0;
    arr[o + 4] = (ux * cb - rx * sb) * sy; arr[o + 5] = uy * cb * sy; arr[o + 6] = (uz * cb - rz * sb) * sy; arr[o + 7] = 0;
    arr[o + 8] = hx * sl; arr[o + 9] = hy * sl; arr[o + 10] = hz * sl; arr[o + 11] = 0;
    arr[o + 12] = c.x + P[i3]; arr[o + 13] = c.y + P[i3 + 1]; arr[o + 14] = c.z + P[i3 + 2]; arr[o + 15] = 1;
  }
  S.inst.instanceMatrix.needsUpdate = true;
  S.fdat.needsUpdate = true;
  S.panic += (panic - S.panic) * Math.min(1, dt * 4);
}

// ---------------------------------------------------------------------------
// jellyfish
// ---------------------------------------------------------------------------

export const jellies = [];
// fauna3: REAL JELLIES. The old jelly was an additive lathe with a halo sprite: it glowed in
// sunlit water, which is exactly "neon". Now every jelly is a LIT translucent animal — the sun,
// the hemisphere and the lantern light it, light coming through it from behind shows (thin-sheet
// transmission, the scene's own lights), a fresnel rim thickens it at the silhouette and a wet
// specular glints on the bell — and only the deep species carry light of their own, where real
// ones do: Atolla's "burglar alarm" ring along its coronal groove and Periphylla's flashes, faint
// at rest and flaring only when startled. One species per zone:
//   zone 0  MOON JELLY (Aurelia aurita): a flat clear saucer, 16 branching radial canals and the
//           ring canal, eight rhopalia, four violet horseshoe gonads seen through it, a fringe of
//           very short fine tentacles, four short frilled oral arms.
//   zone 1  SEA NETTLE / COMPASS JELLY (Chrysaora): a rounded cream bell with sixteen brown
//           compass V-bands and an apex ring, 32 lappets, long red-brown marginal tentacles and
//           four long spiralling frilled oral arms that trail far behind.
//   zone 2  ATOLLA (crimson crowned disc, coronal groove, thick pedalia, one long hypertrophied
//           tentacle) and PERIPHYLLA (the tall purple-red helmet), variant per individual.
// Geometry: ONE instanced mesh carries the subumbrella, the manubrium, the oral arms and the
// exumbrella IN THAT INDEX ORDER (an instanced draw rasterises instance by instance, primitive
// by primitive, so each jelly composites inside-out without any per-triangle sort), all
// generated in the vertex shader from (part, u, v, w) and the species; a second instanced mesh
// carries the tentacles as camera-facing ribbons held to >= 1 px with their alpha scaled by the
// coverage they lost (thin lines that shimmer under TAA jitter are the classic flicker source).
// The 21 instance SLOTS are re-sorted far-to-near whenever the order changes (a few hundred
// floats, no allocation), so overlapping jellies composite correctly too.
let bellMesh = null, tentMesh = null;
const JELLY_ZONE = [
  { hue: [0.55, 0.62], scale: [1.0, 2.0], trail: 1.0 },     // moon
  { hue: [0.05, 0.10], scale: [1.2, 2.4], trail: 1.0 },     // sea nettle
  { hue: [0.97, 1.02], scale: [1.0, 2.2], trail: 1.0 }      // atolla / periphylla
];
const JU = 48, JV = 18;                     // bell resolution (around, apex -> margin)
const ARM_T = 40, ARM_S = 4;                // oral arm ribbon (along, across)
const TENT_N = 48, TENT_SEG = 14;           // tentacle strands per jelly (species use a prefix)

function bellGeometry() {
  const J = [], idx = [];
  const grid = (part, nu, nv, uFn) => {
    const base = J.length / 4, cols = nu + 1;
    for (let i = 0; i <= nv; i++) for (let j = 0; j <= nu; j++) { const q = uFn(j / nu, i / nv); J.push(part, q[0], q[1], q[2]); }
    for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++) {
      const a = base + i * cols + j, b = a + 1;
      idx.push(a, a + cols, b, b, a + cols, b + cols);
    }
  };
  // 0 subumbrella (drawn first), 2 manubrium, 3 oral arms, 1 exumbrella (drawn last)
  grid(0, JU, JV, (u, v) => [u, v, 0]);
  grid(2, 16, 4, (u, v) => [u, v, 0]);
  for (let k = 0; k < 4; k++) grid(3, ARM_S, ARM_T, (s, T) => [(k + 0.5) / 4, T, s * 2 - 1]);
  grid(1, JU, JV, (u, v) => [u, v, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(J.length / 4 * 3), 3));
  g.setAttribute('aJ', new THREE.Float32BufferAttribute(J, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(V3(), 1e4);
  return g;
}
function tentacleGeometry() {
  const T = [], idx = [];
  for (let s = 0; s < TENT_N; s++) {
    const base = T.length / 4;
    for (let i = 0; i <= TENT_SEG; i++) for (const side of [-1, 1]) T.push(i / TENT_SEG, s, side, 0);
    for (let i = 0; i < TENT_SEG; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(T.length / 4 * 3), 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(T, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(V3(), 1e4);
  return g;
}

// The bell surface, shared by both materials (the tentacles hang from its live margin).
// sp: 0 moon, 1 nettle, 2 deep (var < 0.5 Atolla, >= 0.5 Periphylla). Local units: the bell
// radius is 1 (the instance scale is the jelly's size).
const JELLY_SURF = `
${PULSE_GLSL}
vec2 jProf(float v, float sp, float vr){
  float a = v * 1.5707963, s = sin(a), c = cos(a);
  vec2 p;
  if (sp < 0.5) p = vec2(pow(s, 0.85), 0.28 * pow(c, 1.3));
  else if (sp < 1.5) p = vec2(pow(s, 0.80), 0.64 * pow(c, 1.15));
  else if (vr < 0.5) p = vec2(pow(s, 0.92), 0.30 * pow(c, 1.7) + 0.06 - 0.055 * exp(-pow((v - 0.50) / 0.05, 2.0)));
  else p = vec2(0.80 * pow(s, 1.30), 1.30 * pow(c, 0.85) - 0.07 * exp(-pow((v - 0.64) / 0.05, 2.0)));
  float m = smoothstep(0.86, 1.0, v);
  p.x -= 0.05 * m; p.y -= 0.10 * m * m;
  return p;
}
float jLobes(float sp, float vr){ return sp < 0.5 ? 16.0 : (sp < 1.5 ? 32.0 : (vr < 0.5 ? 22.0 : 16.0)); }
// a point on the bell (outer surface; inner = 1 adds the mesoglea thickness) at the pulse phase
vec3 jBell(float u, float v, float inner, float ph, float sp, float vr){
  vec2 p = jProf(v, sp, vr);
  float c = contractAt(ph - v * 0.11);
  float k = smoothstep(0.03, 1.0, v);
  float r = p.x * (1.0 - 0.30 * c * k);
  float y = p.y * (1.0 + 0.40 * c) - 0.18 * c * k;
  float lip = smoothstep(0.80, 1.0, v);
  float cLag = contractAt(ph - v * 0.11 - 0.16);
  float sc = cos(u * 6.2831853 * jLobes(sp, vr));
  r *= 1.0 + 0.045 * sc * lip * (0.45 + 0.9 * cLag);
  y -= (0.5 + 0.5 * sc) * lip * 0.05 * cLag;
  // Atolla's crown: thick radial pedalia between the coronal groove and the margin
  if (sp > 1.5 && vr < 0.5) y += 0.03 * max(0.0, sc) * smoothstep(0.52, 0.6, v) * (1.0 - smoothstep(0.86, 0.96, v));
  // the mesoglea: thick at the apex, thin at the margin (Periphylla is all jelly)
  float th = mix(sp > 1.5 && vr >= 0.5 ? 0.30 : 0.16, 0.02, pow(v, 0.8));
  y -= inner * th; r *= 1.0 - inner * 0.06 * (1.0 - v);
  float a = u * 6.2831853;
  return vec3(cos(a) * r, y, sin(a) * r);
}`;

const BELL_VERT_COMMON = `#include <common>
attribute vec4 aJ;       // part (0 sub, 1 ex, 2 manubrium, 3 oral arm), u, v (or T), w (arm across)
attribute vec4 aJA;      // pulse phase (CPU-integrated: the same curve the thrust uses), seed, alarm, length
attribute vec4 aJB;      // species, variant, hue (0..1), spare
attribute vec3 aJV;      // world velocity (the drag the arms stream into)
uniform float uTime;
varying vec4 vJ; varying vec2 vJCS; varying vec4 vJB; varying float vJAl; varying vec3 vJL; varying float vJC;
${JELLY_SURF}`;
const BELL_VERT_MAIN = `
vec3 jP; vec3 jN;
{
  float part = aJ.x, u = aJ.y, v = aJ.z, w = aJ.w;
  float ph = aJA.x, sp = aJB.x, vr = aJB.y;
  if (part < 1.5) {
    float inner = 1.0 - part;
    jP = jBell(u, v, inner, ph, sp, vr);
    float e = 0.012;
    vec3 du = jBell(u + e, v, inner, ph, sp, vr) - jBell(u - e, v, inner, ph, sp, vr);
    vec3 dv = jBell(u, min(1.0, v + e), inner, ph, sp, vr) - jBell(u, max(0.0, v - e), inner, ph, sp, vr);
    if (v < 0.02) dv = vec3(cos(u * 6.2831853), 0.0, sin(u * 6.2831853)) * 0.01;
    jN = normalize(cross(du, dv) + vec3(0.0, 1e-5, 0.0));
    if (inner > 0.5) jN = -jN;
  } else {
    vec3 apex = jBell(0.0, 0.0, 1.0, ph, sp, vr);
    float c = contractAt(ph);
    if (part < 2.5) {
      // the manubrium: a short four-cornered mouth tube under the apex
      float a = u * 6.2831853, rr = (0.085 + 0.025 * cos(a * 4.0)) * (1.0 - 0.35 * v) * (1.0 + 0.25 * c);
      float lm = sp > 1.5 ? 0.20 : 0.28;
      jP = apex + vec3(cos(a) * rr, -v * lm * (1.0 - 0.2 * c), sin(a) * rr);
      jN = normalize(vec3(cos(a), 0.15, sin(a)));
    } else {
      // an oral arm: a frilled ribbon from the manubrium, lagging the bell, streaming in its wake
      float T = v, k = floor(u * 4.0), ak = (k + 0.5) * 1.5707963;
      float L = (sp < 0.5 ? 0.75 : (sp < 1.5 ? 3.4 : (vr < 0.5 ? 0.45 : 0.30))) * aJA.w;
      float W = sp < 0.5 ? 0.14 : (sp < 1.5 ? 0.17 : 0.07);
      float twist = sp < 0.5 ? 1.0 : (sp < 1.5 ? 3.2 : 0.5);
      float cl = contractAt(ph - T * 0.5);
      vec3 radial = vec3(cos(ak), 0.0, sin(ak));
      vec3 cpt = apex + radial * (0.06 + 0.10 * T * min(L, 1.0)) + vec3(0.0, -0.22 - T * L * (1.0 + 0.12 * cl), 0.0);
      float sw = T * T * L;
      cpt.x += (sin(T * 3.1 - uTime * 0.85 + aJA.y + k * 1.7) * 0.16 + sin(T * 7.3 + uTime * 0.6 + k) * 0.05) * sw;
      cpt.z += (cos(T * 2.7 - uTime * 0.75 + aJA.y * 1.3 + k) * 0.16) * sw;
      mat3 im = mat3(instanceMatrix);
      vec3 velL = transpose(im) * aJV / max(dot(im[0], im[0]), 1e-6);
      float vl = length(velL);
      if (vl > 1e-4) cpt += -velL / vl * min(vl * 0.55, 1.2) * pow(T, 1.4) * L * 0.45;
      float th = ak + 1.5707963 + T * twist;
      vec3 acr = vec3(cos(th), 0.0, sin(th));
      vec3 nrm = normalize(cross(acr, vec3(0.0, -1.0, 0.0)));
      float wd = W * (1.0 - 0.55 * T) * (0.85 + 0.15 * sin(T * 19.0 + k));
      // the frill: the ribbon's edges ruffle out of its plane
      float fr = sin(T * L * 14.0 + w * 1.5 + uTime * 1.1 + k) * w * w * wd * 0.45;
      jP = cpt + acr * w * wd + nrm * fr;
      jN = normalize(nrm + acr * w * 0.35 * cos(T * L * 14.0 + w * 1.5));
    }
  }
  vJ = aJ; vJB = aJB; vJAl = aJA.z; vJL = jP; vJC = contractAt(ph);
  vJCS = vec2(cos(aJ.y * 6.2831853), sin(aJ.y * 6.2831853));
}`;
const BELL_FRAG_COMMON = `#include <common>
varying vec4 vJ; varying vec2 vJCS; varying vec4 vJB; varying float vJAl; varying vec3 vJL; varying float vJC;
uniform float uTime;
${SKIN_COMMON}`;
// colour/alpha per part and species; the bell is a thin clear sheet, so alpha carries most of
// the read: thicker (more opaque) toward the silhouette, the canals/gonads/pigment denser
const BELL_FRAG_COLOR = `#include <color_fragment>
float jPart = floor(vJ.x + 0.5), jSp = vJB.x, jVr = vJB.y;
float jv = vJ.z, ju = atan(vJCS.y, vJCS.x) / 6.2831853 + 0.5;
vec3 jV = normalize(vViewPosition);
vec3 jCol = vec3(0.8); float jA = 0.1; float jLum = 0.0; float jWet = 1.0;
float rr = length(vJL.xz);
if (jPart > 2.5) {
  // oral arms: frilled, denser at the edges
  float edge = abs(vJ.w);
  jCol = jSp < 0.5 ? vec3(0.80, 0.74, 0.86) : (jSp < 1.5 ? vec3(0.92, 0.78, 0.66) : vec3(0.42, 0.07, 0.08));
  jA = (jSp < 1.5 ? 0.22 : 0.45) + 0.30 * smoothstep(0.55, 1.0, edge);
  jA *= 1.0 - 0.95 * smoothstep(0.7, 1.0, jv);
} else if (jPart > 1.5) {
  jCol = jSp < 0.5 ? vec3(0.78, 0.72, 0.84) : (jSp < 1.5 ? vec3(0.86, 0.70, 0.58) : vec3(0.22, 0.03, 0.04));
  jA = jSp > 1.5 ? 0.7 : 0.3;
} else if (jSp < 0.5) {
  // MOON JELLY
  jCol = vec3(0.80, 0.85, 0.92);
  jA = 0.05;
  if (jPart > 0.5) {
    float q = ju * 16.0, b = 0.33 * smoothstep(0.45, 1.0, jv);
    float d = min(abs(fract(q + 0.5) - 0.5), min(abs(fract(q + 0.5 + b) - 0.5), abs(fract(q + 0.5 - b) - 0.5)));
    float dist = d * 6.2831853 / 16.0 * max(rr, 0.05);
    float canal = (1.0 - smoothstep(0.007, 0.016, dist)) * smoothstep(0.08, 0.2, jv) * skAA(vec2(q, jv * 30.0));
    float ring = 1.0 - smoothstep(0.006, 0.014, abs(jv - 0.955) * 1.0);
    vec2 rh = vec2((fract(ju * 8.0 + 0.5) - 0.5) * 6.2831853 / 8.0, jv - 0.985);
    float rho = 1.0 - smoothstep(0.012, 0.02, length(rh * vec2(1.0, 1.4)));
    jCol = mix(jCol, vec3(0.92, 0.88, 0.94), max(canal, ring));
    jA += 0.20 * canal + 0.30 * ring + 0.55 * rho;
    jCol = mix(jCol, vec3(0.62, 0.48, 0.30), rho);
  } else {
    // four violet horseshoe gonads, interradial, and the coronal muscle's fine rings
    float gn = 0.0;
    for (int k = 0; k < 4; k++) {
      float ga = float(k) * 1.5707963;
      vec2 c = vec2(cos(ga), sin(ga)) * 0.30;
      vec2 dl = vJL.xz - c;
      float ring = 1.0 - smoothstep(0.03, 0.055, abs(length(dl) - 0.15));
      float open = smoothstep(0.35, 0.65, -dot(normalize(dl + 1e-4), normalize(c)) + 0.2);
      gn = max(gn, ring * open);
    }
    float mus = 0.5 + 0.5 * sin(jv * 140.0);
    jCol = mix(jCol, vec3(0.58, 0.30, 0.68), gn);
    jA += 0.80 * gn + 0.025 * mus * smoothstep(0.4, 0.9, jv);
  }
} else if (jSp < 1.5) {
  // SEA NETTLE
  jCol = vec3(0.90, 0.82, 0.70);
  jA = 0.10;
  if (jPart > 0.5) {
    float q = fract(ju * 16.0) - 0.5;
    float vb = 1.0 - smoothstep(0.06, 0.11, abs(abs(q) - 0.30 * smoothstep(0.08, 1.0, jv)));
    vb *= smoothstep(0.10, 0.2, jv) * (1.0 - smoothstep(0.88, 0.97, jv)) * skAA(vec2(ju * 16.0, jv * 8.0));
    float apexR = 1.0 - smoothstep(0.02, 0.04, abs(jv - 0.12));
    float lap = smoothstep(0.92, 0.99, jv);
    vec3 cv = skVor(vec2(ju * 90.0, jv * 22.0));
    float wart = (1.0 - smoothstep(0.08, 0.16, cv.x)) * step(0.6, cv.z) * skAA(vec2(ju * 90.0, jv * 22.0));
    jCol = mix(jCol, vec3(0.46, 0.20, 0.10), max(vb, apexR) * 0.9);
    jCol = mix(jCol, vec3(0.55, 0.26, 0.15), lap * 0.7);
    jCol = mix(jCol, vec3(1.0, 0.96, 0.9), wart * 0.6);
    jA += 0.35 * max(vb, apexR) + 0.25 * lap + 0.1 * wart;
  } else {
    float sect = pow(abs(cos(ju * 6.2831853 * 2.0)), 6.0) * smoothstep(0.1, 0.25, jv) * (1.0 - smoothstep(0.45, 0.6, jv));
    jCol = mix(jCol, vec3(0.94, 0.86, 0.74), sect);
    jA += 0.22 * sect;
  }
} else if (jVr < 0.5) {
  // ATOLLA: a crimson crowned disc; the subumbrella's dark red stomach hides what it ate
  jCol = vec3(0.52, 0.07, 0.08);
  jA = 0.30;
  if (jPart > 0.5) {
    float groove = 1.0 - smoothstep(0.015, 0.035, abs(jv - 0.50));
    float ped = pow(max(0.0, cos(ju * 6.2831853 * 22.0)), 3.0) * smoothstep(0.55, 0.62, jv) * (1.0 - smoothstep(0.86, 0.95, jv));
    float dome = 1.0 - smoothstep(0.30, 0.48, jv);
    jCol *= 0.75 + 0.35 * ped + 0.25 * dome;
    jCol = mix(jCol, vec3(0.20, 0.02, 0.03), groove * 0.8);
    jA += 0.15 * ped + 0.3 * groove;
    // THE BURGLAR ALARM: discrete photophores along the groove; a ring of light that races
    // round when the animal is startled, a barely-there ember otherwise
    float spot = 1.0 - smoothstep(0.25, 0.45, length(vec2((fract(ju * 22.0 + 0.5) - 0.5) * 2.0, (jv - 0.50) / 0.025)));
    float wave = pow(0.5 + 0.5 * sin(ju * 6.2831853 * 2.0 - uTime * 9.0), 6.0);
    jLum = spot * (0.006 + vJAl * (0.05 + 0.16 * wave));
  } else {
    jCol = vec3(0.16, 0.02, 0.03);
    jA = 0.55 + 0.2 * (1.0 - smoothstep(0.3, 0.6, jv));
  }
} else {
  // PERIPHYLLA: the tall helmet, purple-red, the dark stomach a column inside it
  jCol = vec3(0.40, 0.10, 0.22);
  jA = 0.16;
  if (jPart > 0.5) {
    float groove = 1.0 - smoothstep(0.015, 0.03, abs(jv - 0.64));
    jCol = mix(jCol, vec3(0.18, 0.03, 0.08), groove);
    jA += 0.25 * groove;
    vec3 cv = skVor(vec2(ju * 40.0, jv * 14.0));
    float ph = (1.0 - smoothstep(0.05, 0.12, cv.x)) * step(0.72, cv.z) * smoothstep(0.2, 0.6, jv);
    float flick = pow(0.5 + 0.5 * sin(uTime * 13.0 + cv.z * 40.0), 8.0);
    jLum = ph * (0.004 + vJAl * 0.12 * flick);
  } else {
    jCol = vec3(0.20, 0.03, 0.06);
    jA = 0.18 + 0.45 * (1.0 - smoothstep(0.35, 0.7, jv));
  }
}
// hue jitter per individual
jCol *= 0.92 + 0.16 * vJB.z;
diffuseColor.rgb = jCol;
diffuseColor.a = clamp(jA, 0.0, 0.92);`;
const BELL_FRAG_EMIT = `#include <emissivemap_fragment>
// light arriving through the sheet from behind it (sun, hemisphere, lantern), never its own
totalEmissiveRadiance += diffuseColor.rgb * skTransmit(normal, vViewPosition) * 0.22;
totalEmissiveRadiance += vec3(0.30, 0.55, 1.0) * jLum;`;
// the wet glint keeps its brightness on a clear sheet: specular lifts the alpha it is drawn at
const BELL_FRAG_SPEC = `#include <aomap_fragment>
{
  // the bell reads thicker at its silhouette (the sheet seen edge-on)
  float jFres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.2);
  diffuseColor.a += (jPart > 2.5 ? 0.10 : 0.22) * jFres;
  float jSp = dot(reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3(0.3333));
  diffuseColor.a = clamp(diffuseColor.a + jSp * (jPart > 2.5 ? 0.3 : 0.9) + dot(totalEmissiveRadiance, vec3(0.3333)) * 0.35, 0.0, 0.92);
}`;

function jellyMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.2, metalness: 0.0, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, forceSinglePass: true, emissive: 0x000000
  });
  m.customProgramCacheKey = () => 'abyssa-jelly-bell';
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', BELL_VERT_COMMON)
      .replace('#include <beginnormal_vertex>', BELL_VERT_MAIN + '\nvec3 objectNormal = jN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = jP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', BELL_FRAG_COMMON)
      .replace('#include <lights_pars_begin>', '#include <lights_pars_begin>\n' + SKIN_LIGHTS)
      .replace('#include <color_fragment>', BELL_FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', BELL_FRAG_EMIT)
      .replace('#include <aomap_fragment>', BELL_FRAG_SPEC);
  };
  return m;
}

// TENTACLES: camera-facing ribbons from the live margin, built in the instance's own space (the
// camera taken into it), so the standard lit pipeline (fog, lights, TAA texture bias) applies.
// Width is held to >= ~1.1 px with alpha scaled by the coverage that cost (no sub-pixel shimmer).
const uJRes = { value: 1080 };
const uJMinPx = { value: 0.55 };   // half-width floor in pixels (1.1 px wide); __jelly.minPx(0) = the A/B
const TENT_VERT_COMMON = `#include <common>
attribute vec4 aT;       // T along, strand index, side, spare
attribute vec4 aJA; attribute vec4 aJB; attribute vec3 aJV;
uniform float uTime; uniform float uJRes; uniform float uJMinPx;
varying float vTT; varying float vTCov; varying float vTSide; varying vec4 vTB;
${JELLY_SURF}`;
const TENT_VERT_MAIN = `
vec3 jP; vec3 jN;
{
  float T = aT.x, si = aT.y, side = aT.z;
  float ph = aJA.x, sp = aJB.x, vr = aJB.y;
  // species: how many strands, how long (bell radii), how thick
  float n = sp < 0.5 ? 48.0 : (sp < 1.5 ? 24.0 : (vr < 0.5 ? 22.0 : 12.0));
  float len = sp < 0.5 ? 0.22 : (sp < 1.5 ? 4.6 : (vr < 0.5 ? 1.3 : 2.2));
  float wid = sp < 0.5 ? 0.0035 : (sp < 1.5 ? 0.006 : 0.007);
  if (sp > 1.5 && vr < 0.5 && si < 0.5) { len = 6.0; wid = 0.010; }     // Atolla's long tentacle
  len *= aJA.w * (0.85 + 0.3 * fract(si * 0.618 + aJA.y));
  vec3 root = jBell((si + 0.5) / n, 1.0, 0.0, ph, sp, vr);
  float c = contractAt(ph - T * 0.45);
  float a = (si + 0.5) / n * 6.2831853;
  vec3 dir = vec3(cos(a), 0.0, sin(a)), tg = vec3(-sin(a), 0.0, cos(a));
  float wave = sin(T * 4.4 - uTime * 1.6 + si * 1.7 + aJA.y) + 0.42 * sin(T * 9.1 + uTime * 1.0 + si * 2.3);
  float wave2 = cos(T * 3.3 - uTime * 1.2 + si * 2.9 + aJA.y) + 0.35 * cos(T * 8.0 + uTime * 0.8 + si);
  vec3 p = root + vec3(0.0, -T * len * (1.0 + 0.18 * c), 0.0) + tg * wave * T * len * 0.09 + dir * (T * T * len * 0.05 + wave2 * T * len * 0.06);
  mat3 im = mat3(instanceMatrix);
  float s2 = max(dot(im[0], im[0]), 1e-6);
  vec3 velL = transpose(im) * aJV / s2;
  float vl = length(velL);
  if (vl > 1e-4) p += -velL / vl * min(vl * 0.55, 1.1) * pow(T, 1.5) * len * 0.42 * (0.85 + 0.15 * sin(si * 2.1 + uTime * 2.0));
  // collapse the strands this species does not have
  if (si >= n) p = root;
  // camera-facing, in instance space
  vec3 camL = (inverse(modelMatrix * instanceMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vec3 toC = normalize(camL - p);
  vec3 ax = vec3(0.0, 1.0, 0.0);
  vec3 wd = cross(ax, toC); float wl = length(wd); wd = wl > 1e-4 ? wd / wl : vec3(1.0, 0.0, 0.0);
  float w = wid * (1.0 - 0.75 * pow(T, 0.8));
  // one pixel at this distance, in instance units
  float dist = length((modelMatrix * instanceMatrix * vec4(p, 1.0)).xyz - cameraPosition);
  float px = 2.0 * dist / (projectionMatrix[1][1] * uJRes) / sqrt(s2);
  float wUse = max(w, px * uJMinPx);
  vTCov = w / wUse;
  jP = p + wd * side * wUse;
  jN = toC;
  vTT = T; vTSide = side; vTB = aJB;
}`;
const TENT_FRAG_COLOR = `#include <color_fragment>
{
  float sp = vTB.x;
  vec3 tc = sp < 0.5 ? vec3(0.86, 0.86, 0.90) : (sp < 1.5 ? vec3(0.50, 0.20, 0.13) : vec3(0.40, 0.06, 0.07));
  float core = 1.0 - abs(vTSide);
  float a = (0.22 + 0.40 * core) * vTCov * (1.0 - smoothstep(0.7, 1.0, vTT)) * smoothstep(0.0, 0.04, vTT);
  // nematocyst batteries: faint knots along the strand
  a *= 0.85 + 0.3 * pow(0.5 + 0.5 * sin(vTT * 90.0), 6.0);
  diffuseColor.rgb = tc;
  diffuseColor.a = clamp(a, 0.0, 0.9);
}`;
function tentacleMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.35, metalness: 0.0, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, forceSinglePass: true, emissive: 0x000000
  });
  m.customProgramCacheKey = () => 'abyssa-jelly-tentacle';
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime; sh.uniforms.uJRes = uJRes; sh.uniforms.uJMinPx = uJMinPx;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', TENT_VERT_COMMON)
      .replace('#include <beginnormal_vertex>', TENT_VERT_MAIN + '\nvec3 objectNormal = jN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = jP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vTT; varying float vTCov; varying float vTSide; varying vec4 vTB;
        ${SKIN_COMMON}`)
      .replace('#include <lights_pars_begin>', '#include <lights_pars_begin>\n' + SKIN_LIGHTS)
      .replace('#include <color_fragment>', TENT_FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * skTransmit(normal, vViewPosition) * 0.6;`);
  };
  return m;
}

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

// Per-jelly canonical data (layout) + per-SLOT instance buffers (rewritten in sorted order).
let JB = null;
function buildJellies() {
  const N = 7 * 3;
  const mk = n => new THREE.InstancedBufferAttribute(new Float32Array(N * n), n).setUsage(THREE.DynamicDrawUsage);
  JB = { N, aJA: mk(4), aJB: mk(4), aJV: mk(3), ord: new Int32Array(N), key: new Float32Array(N), seed: new Float32Array(N), lenMul: new Float32Array(N), hue: new Float32Array(N), vr: new Float32Array(N), vel: new Float32Array(N * 3), dirty: true };
  for (let i = 0; i < N; i++) JB.ord[i] = i;
  for (let zi = 0; zi < 3; zi++) for (let k = 0; k < 7; k++) {
    jellies.push({
      i: zi * 7 + k, zi, pos: V3(), vel: V3(), axis: V3(0, 1, 0), wob: V3(1, 0, 0),
      scale: 1, spin: 0, spinA: 0, phase: 0, rate: 0.25, baseRate: 0.25, thrust: 12,
      alarm: 0, culled: false
    });
  }
  layoutJellies();
  const bg = bellGeometry(), tg = tentacleGeometry();
  for (const g of [bg, tg]) { g.setAttribute('aJA', JB.aJA); g.setAttribute('aJB', JB.aJB); g.setAttribute('aJV', JB.aJV); }
  tentMesh = new THREE.InstancedMesh(tg, tentacleMaterial(), N);
  bellMesh = new THREE.InstancedMesh(bg, jellyMaterial(), N);
  tentMesh.instanceMatrix = bellMesh.instanceMatrix;
  bellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (const m of [tentMesh, bellMesh]) { m.frustumCulled = false; scene.add(m); }
  tentMesh.renderOrder = 2; bellMesh.renderOrder = 3;
}

// Jelly LAYOUT: the SAME stream draws, in the same order, as before fauna3 (the site's layout
// is a pure function of the stream; only their meaning per species changed).
function layoutJellies() {
  for (const J of jellies) {
    const zi = J.zi, Z = JELLY_ZONE[zi], i = J.i;
    JB.hue[i] = (rr(Z.hue[0], Z.hue[1]) - Z.hue[0]) / Math.max(1e-6, Z.hue[1] - Z.hue[0]);
    J.phase = _cr();
    J.rate = J.baseRate = rr(0.20, 0.34) * (1 - zi * 0.15);
    JB.seed[i] = _cr() * 6.283;
    JB.lenMul[i] = rr(0.8, 1.2) * Z.trail;
    JB.vr[i] = zi === 2 ? (fract01(JB.seed[i] * 7.31) < 0.6 ? 0 : 1) : 0;   // deep: Atolla 3 in 5
    const a = _cr() * Math.PI * 2, r = rr(16, WORLD_R * 0.7);
    J.pos.set(Math.cos(a) * r, rr(zoneBottom(zi) + 45, zoneTop(zi) - 25), Math.sin(a) * r);
    J.vel.set(rr(-.3, .3), 0, rr(-.3, .3));
    J.axis.set(rr(-.25, .25), 1, rr(-.25, .25)).normalize();
    J.wob.set(rr(-1, 1), 0, rr(-1, 1)).normalize();
    J.scale = rr(Z.scale[0], Z.scale[1]);
    J.spin = rr(-0.12, 0.12);
    J.spinA = _cr() * 6.283;
    J.thrust = rr(9, 15);
    J.alarm = 0;
    JB.vel[i * 3] = JB.vel[i * 3 + 1] = JB.vel[i * 3 + 2] = 0;
  }
  JB.dirty = true;
}
function fract01(x) { return x - Math.floor(x); }

const _jm = new THREE.Matrix4();
function updateJellies(dt, t) {
  const cy = camera.position.y;
  for (const J of jellies) {
    // zone band (terrain/fauna's rule) + the fog wall, with hysteresis
    const band = zoneBand(J.zi, cy);
    const jd = J.pos.distanceTo(camera.position) - J.scale * 8;
    J.culled = !band || (J.culled ? jd > cullR - 10 : jd > cullR + 10);
    const step = dt * J.rate;
    J.phase += step;
    if (J.culled) continue;
    const c = contractAt(J.phase), c0 = contractAt(J.phase - step);
    const dc = (c - c0) / Math.max(dt, 1e-4);
    // the bell only pushes while it is contracting — that is the whole gait
    if (dc > 0) J.vel.addScaledVector(J.axis, dc * J.thrust * dt);
    J.vel.y -= 0.35 * dt;
    J.vel.multiplyScalar(Math.pow(0.30, dt));
    // slow tumble: the bell axis wanders, so jellies never track straight
    tmpV.set(J.wob.x * Math.sin(t * 0.13 + J.i) * 0.5, 1, J.wob.z * Math.cos(t * 0.11 + J.i) * 0.5).normalize();
    J.axis.lerp(tmpV, Math.min(1, dt * 0.35)).normalize();
    // drift away from the diver, and pulse hard when startled
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
    // a sonar front or a strike nearby: the bell clamps into a run of hard pulses
    const pj = pulseAt(J.pos.x, J.pos.y, J.pos.z);
    if (pj > 0.2) J.alarm = Math.max(J.alarm, pj);
    J.alarm = Math.max(0, J.alarm - dt * 0.35);
    J.rate = J.baseRate * (1 + J.alarm * 1.9);
    J.pos.addScaledVector(J.vel, dt);
    const hr = Math.hypot(J.pos.x, J.pos.z);
    if (hr > WORLD_R * 0.85) { const k = WORLD_R * 0.85 / hr; J.pos.x *= k; J.pos.z *= k; J.vel.x *= -0.5; J.vel.z *= -0.5; }
    const lo = Math.max(zoneBottom(J.zi) + 22, terrainH(J.pos.x, J.pos.z, J.zi) + J.scale * 6 + 6);
    const hi = Math.max(lo + 4, zoneTop(J.zi) - 14);
    if (J.pos.y < lo) { J.pos.y = lo; J.vel.y = Math.abs(J.vel.y) * 0.4 + 0.6; }
    else if (J.pos.y > hi) { J.pos.y = hi; J.vel.y = -Math.abs(J.vel.y) * 0.4 - 0.4; }
    J.spinA += J.spin * dt;
    // the wake the arms and tentacles stream into (smoothed: they answer the bell late)
    const v3 = JB.vel, i3 = J.i * 3, kv = Math.min(1, dt * 1.6);
    v3[i3] += (J.vel.x - v3[i3]) * kv; v3[i3 + 1] += (J.vel.y - v3[i3 + 1]) * kv; v3[i3 + 2] += (J.vel.z - v3[i3 + 2]) * kv;
  }
  // slot order: far to near (insertion sort on a persistent permutation: no allocation, and
  // nearly-sorted input from the last frame costs ~N compares)
  const ord = JB.ord, key = JB.key, N = JB.N;
  for (const J of jellies) key[J.i] = J.culled ? -1 : J.pos.distanceToSquared(camera.position);
  for (let a = 1; a < N; a++) { const x = ord[a]; let b = a - 1; while (b >= 0 && key[ord[b]] < key[x]) { ord[b + 1] = ord[b]; b--; } ord[b + 1] = x; }
  const bm = bellMesh.instanceMatrix.array, A = JB.aJA.array, B = JB.aJB.array, V = JB.aJV.array;
  for (let s = 0; s < N; s++) {
    const J = jellies[ord[s]], i = J.i, o = s * 16;
    if (J.culled) { for (let k = 0; k < 15; k++) bm[o + k] = 0; bm[o + 15] = 1; continue; }
    tmpQ.setFromUnitVectors(AXIS_Y, J.axis).multiply(spinQ.setFromAxisAngle(AXIS_Y, J.spinA));
    _jm.compose(J.pos, tmpQ, tmpV2.setScalar(J.scale));
    const e = _jm.elements;
    for (let k = 0; k < 16; k++) bm[o + k] = e[k];
    A[s * 4] = J.phase; A[s * 4 + 1] = JB.seed[i]; A[s * 4 + 2] = J.alarm; A[s * 4 + 3] = JB.lenMul[i];
    B[s * 4] = J.zi; B[s * 4 + 1] = JB.vr[i]; B[s * 4 + 2] = JB.hue[i]; B[s * 4 + 3] = 0;
    V[s * 3] = JB.vel[i * 3]; V[s * 3 + 1] = JB.vel[i * 3 + 1]; V[s * 3 + 2] = JB.vel[i * 3 + 2];
  }
  bellMesh.instanceMatrix.needsUpdate = true;
  JB.aJA.needsUpdate = JB.aJB.needsUpdate = JB.aJV.needsUpdate = true;
  renderer.getDrawingBufferSize(_jRes); uJRes.value = Math.max(1, _jRes.y);
}
const _jRes = new THREE.Vector2();
if (typeof window !== 'undefined') window.__jelly = {
  list: () => jellies.map(J => ({ i: J.i, zi: J.zi, pos: J.pos.toArray().map(v => +v.toFixed(1)), scale: +J.scale.toFixed(2), culled: J.culled, sp: J.zi === 2 ? (JB.vr[J.i] ? 'periphylla' : 'atolla') : J.zi ? 'nettle' : 'moon' })),
  get: i => jellies[i],
  minPx: v => { uJMinPx.value = v; return v; }
};

//

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
  // fauna2: the sculpted bodies stream in after boot; until then (and forever, if the
  // asset is missing or ?fishproc) the procedural schools swim
  if (!(typeof location !== 'undefined' && location.search.includes('fishproc')))
    loadSculpted('assets/fauna/school/', 'school').then(installSchoolSculpt);
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
  tickStir(dt, t);
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
    sparksZ[zi].visible = zoneBand(zi, cy);
  // drifters live in zones 1-2 only (see driftArrays placement)
  drifters.visible = cy < zoneTop(1) + 120 && ZONE_SEEN[1] === 1;
}
