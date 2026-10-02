// ABYSSA — gardens.js. OWNED BY: gardens agent (contract fixed by orchestrator).
//
// The second plant vocabulary: eleven generated benthic forms placed by zone, on top
// of flora.js's kelp / reef / rock world (which this file never touches).
//
//   ZONE 0 (sunlit reef)   sea fans, seagrass beds, staghorn thickets, barrel sponges,
//                          anemones
//   ZONE 1 (THE BOILER ROOM)  tube-worm colonies at the chimney feet (white tubes, red
//                          plumes that retract on a slow cycle), bacterial mats,
//                          stalked crinoids on the crust
//   ZONE 2 (lightless abyss)  sea pens (with faint additive tips — house fog law:
//                          additive fades to BLACK off scene.fog.density), glass
//                          sponges, whip corals
//
// TECHNIQUE (the abyssal reference, not its code): recursive TubeGeometry on
// Catmull-Rom paths with per-row taper for every branching form; lathe profiles with
// angular wobble for the barrels; rooted blade ribbons whose flex is zero at the
// rhizome and grows as height^1.4; every part tagged per-vertex (aVA / aFlut, the
// flora.js idiom) so all sway happens in ONE vertex shader off a shared uTime/uCur.
//
// CONTRACT
//   buildGardens()        once. Materials + geometry are created HERE and never again.
//                         Every InstancedMesh is allocated at its MAX capacity (sized
//                         for 20 vents / the densest authored site) so a reseed never
//                         grows a buffer. Must run AFTER buildFlora (reads its rock
//                         colliders as reef anchors) and AFTER buildVents (activeVents).
//   reseedGardens()       relayout in place from a fresh siteParams('gardens').rng —
//                         a stream of its own; flora's stream is never consumed, so
//                         flora/rock fingerprints are untouched by this module.
//                         Must run after reseedFlora AND reseedVents in reseedWorld.
//   updateGardens(dt, t)  ~4 uniform writes + 3 visibility compares. Zero allocation.
//
// Budget: 12 draw calls (11 lit instanced + 1 additive tip pass), ~150k tris on screen
// worst case, dithered range fade per type (no transparency, no sorting), fog ON on
// every lit material. Distinct customProgramCacheKey per material (the creatures.js
// shared-program hazard). Materials are site-invariant; only layout re-rolls.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { WORLD_R, RIFT_R, riftPos, zoneTop, zoneBottom } from '../config.js';
import { registerPaint, injectStrokes } from '../lib/paint.js';
import { clamp, fbm } from '../lib/math.js';
import { terrainH, terrainNormal } from './terrain.js';
import { wreckSites } from './wrecks.js';
import { siteParams, stream } from './site.js';
import { activeVents } from './vents.js';
import { rockColliders, F_TRANS } from './flora.js';
import { bladeMapSet } from '../lib/textures.js';
import { windState } from './water.js';
import { uPush, uPushV, uJolt, PUSH_GLSL, PUSH_N, tickStir } from './stir.js';
import { plantAdopt, plantTick, setPlantMaterial } from './plants/plantKit.js';

const TAU = Math.PI * 2;

// Two streams, deliberately separate:
//   GEO_RNG — a FIXED seed for the shapes themselves (built once, ever), so boot and
//             arrive-back draw the same geometry and a reseed never regrows a buffer.
//   _gr     — the site's own 'gardens' stream, installed at the top of every layout().
//             Placement is a pure function of the site; nothing here reads Math.random.
let _gr = Math.random;
const rr = (a, b) => a + _gr() * (b - a);
let _ge = stream(0x6A4DE5);
const gr = (a, b) => a + _ge() * (b - a);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), IDQ = new THREE.Quaternion();
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- shaders ----
// One family. Same vertex program body for every type (the defines only add), so the
// whole garden sways to a single uTime / uCur write per frame.
const uni = { uTime: { value: 0 }, uCur: { value: new THREE.Vector2(1, 0) }, uFogD: { value: 0.02 }, uPush, uPushV, uJolt };

const V_HEAD = `
attribute vec4 aVA;     // flex, normalised height, part mask, part phase
attribute float aFlut;  // local flutter weight
attribute vec4 aInst;   // phase, sway amp, arc-shorten k, per-instance weight
uniform float uTime; uniform vec2 uCur; uniform vec2 uCull;
uniform float uSway; uniform float uFreq; uniform float uFogD;
varying vec4 vGd; varying vec3 vGl;
attribute vec2 aBU;     // blade uv (across, along + 1); (0,0) off-blade
varying vec3 vBl;
uniform vec4 uJolt;
#ifdef GD_RUFFLE
  uniform float uRuffle;
#endif
#if defined(GD_BIOLUM) || defined(GD_BIOTIP)
  varying float vGfl;
#endif
// (plants) a BatchedMesh of sculpted species (plants/plantKit.js) runs this same program:
// its instance matrix comes from three's batching texture and its aInst from uInstTex
#ifdef USE_BATCHING
  uniform highp sampler2D uInstTex;
  #define GD_IM batchingMatrix
#else
  #define GD_IM instanceMatrix
#endif
${PUSH_GLSL}`;

const V_BODY = `
#ifdef USE_BATCHING
  vec4 gdInst;
  {
    int gdi = int(getIndirectIndex(gl_DrawID)), gdw = textureSize(uInstTex, 0).x;
    gdInst = texelFetch(uInstTex, ivec2(gdi % gdw, gdi / gdw), 0);
  }
#else
  vec4 gdInst = aInst;
#endif
// THE CURRENT FIELD (anim-fauna). One slowly-varying world-space flow drives every
// plant, so a meadow moves TOGETHER: the surge (the back-and-forth of the swell) is a
// wave travelling DOWNSTREAM through the beds at ~4 u/s, so neighbours sway in phase and
// a stand ripples from its upstream edge; gusts are a longer, faster envelope (~12 u/s)
// that leans a whole stand over and lets it recover; tips lag their base. The instance
// phase is only a small stiffness/phase jitter now, never the whole motion.
vec3 cfIw = (modelMatrix * GD_IM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float cfMag = length(uCur);
vec2 cfD = cfMag > 1e-5 ? uCur / cfMag : vec2(1.0, 0.0);
vec2 cfP = vec2(-cfD.y, cfD.x);
float cfAl = dot(cfIw.xz, cfD), cfAc = dot(cfIw.xz, cfP);
float cfNat = uFreq * (0.92 + 0.16 * fract(gdInst.x * 0.159));
float cfPh = uTime * cfNat - cfAl * 0.16 + sin(cfAc * 0.05) * 0.8 + gdInst.x * 0.12;
float cfG = 0.5 + 0.5 * sin(cfAl * 0.035 - uTime * 0.42 + sin(cfAc * 0.021 + uTime * 0.05) * 2.0);
cfG = cfG * cfG * (3.0 - 2.0 * cfG);
float cfS1 = sin(cfPh - aVA.y * 1.6), cfS2 = sin(cfPh * 1.71 - aVA.y * 3.2 + 1.3 + cfAc * 0.09);
vec2 cfDisp = (cfD * cfMag * (0.30 + 0.45 * cfG + (0.25 + 0.30 * cfG) * cfS1) + cfP * cfMag * (0.3 * cfS2 * (0.5 + 0.5 * cfG))) * (gdInst.y * uSway * aVA.x);
// The flow is a WORLD direction: take it into this instance's frame (each plant is
// yawed at random, and a local-space lean would point every one a different way).
// M^T w over each column's length squared is exact for rotation x per-axis scale; the
// length(M[0]) factor keeps the authored local amplitude.
mat3 cfM = mat3(modelMatrix * GD_IM);
vec3 cfC2 = max(vec3(dot(cfM[0], cfM[0]), dot(cfM[1], cfM[1]), dot(cfM[2], cfM[2])), vec3(1e-6));
vec3 cfL = (transpose(cfM) * vec3(cfDisp.x, 0.0, cfDisp.y)) / cfC2 * sqrt(cfC2.x);
float gw = cfPh;
vec2 gd = cfL.xz;
transformed += cfL;
transformed.y -= dot(gd, gd) * gdInst.z;
if (aFlut > 0.0) {
  float gf = gw * 2.2 + aVA.w;
  transformed += vec3(sin(gf) * 0.7, cos(gf * 1.31) * 0.5, sin(gf * 0.73 + 2.1) * 0.7) * aFlut;
}
#ifdef GD_RUFFLE
  // (plants2) a sculpted blade's margins ruffle faster than the blade sways, on the blade's own
  // phase, growing toward the tip (aBU: across 0..1, along + 1) — the midrib holds
  if (aBU.y > 0.5) {
    float gea = abs(aBU.x - 0.5) * 2.0, gal = aBU.y - 1.0;
    transformed += objectNormal * (sin(uTime * 2.4 + gal * 14.0 + aVA.w * 5.0) * gea * gea * (0.25 + gal) * uRuffle);
  }
#endif
// FLINCH (anim-fauna): the nearest push sphere (Sal, a big animal) and the last jolt
// (sonar front, footfall, slam: stir.js uJolt) make the animal-plants withdraw.
// 0 = open, 1 = fully withdrawn. Snap-in is the approach itself; the slow re-emergence
// is the jolt's own decay, so a ping empties a whole field of plumes and they bloom back.
float gFl = 0.0;
#if defined(GD_WORM) || defined(GD_FLINCH) || defined(GD_BIOLUM) || defined(GD_BIOTIP)
  for (int i = 0; i < ${PUSH_N}; i++) {
    vec4 ps = uPush[i];
    if (ps.w <= 0.0) continue;
    float dd = distance(cfIw, ps.xyz);
    gFl = max(gFl, 1.0 - smoothstep(ps.w * 2.0, ps.w * 4.5, dd));
  }
  gFl = max(gFl, uJolt.w * (1.0 - smoothstep(uJolt.z * 0.85, uJolt.z + 2.0, distance(cfIw.xz, uJolt.xy))));
#endif
#ifdef GD_WORM
  // Plume retraction: each tube (aVA.w) pulls its red crown down into the white tube
  // for a short stretch of a slow cycle, then it blooms back — and ALL of them snap in
  // when something big comes near or the ground jolts. aVA.z = plume weight.
  float grc = max(smoothstep(0.62, 0.92, sin(uTime * 0.17 + aVA.w)), gFl * (0.85 + 0.15 * fract(aVA.w * 3.7)));
  #ifdef GD_SCULPT
    // (plants) a sculpted colony: each plume folds toward ITS OWN mouth (aBU = the mouth's
    // xz) and sinks into its tube
    transformed.xz = aBU + (transformed.xz - aBU) * (1.0 - 0.7 * aVA.z * grc);
    transformed.y -= aVA.z * grc * 0.17;
  #else
  transformed.xz *= 1.0 - 0.85 * aVA.z * grc;
  transformed.y -= aVA.z * grc * 0.42;
  #endif
#endif
#ifdef GD_FLINCH
  // anemone tentacles / crinoid arms: curl in toward the axis and down
  transformed.xz *= 1.0 - 0.45 * gFl * aVA.x;
  transformed.y -= 0.25 * gFl * aVA.x * aVA.y;
#endif
// PARTING: pushed aside by whatever brushes through (stir.js spheres).
if (uSway > 0.0) {
  vec3 gWp = stirPush((modelMatrix * GD_IM * vec4(transformed, 1.0)).xyz, aVA.x);
  transformed += (transpose(cfM) * gWp) / cfC2;
}
vBl = vec3(aBU, aVA.w);
#ifdef GD_BLADE
  if (aBU.y > 0.5) {   // margin ripple on the blade's own phase (flora.js idiom)
    float gea = abs(aBU.x - 0.5) * 2.0, gal = aBU.y - 1.0;
    transformed += objectNormal * (sin(uTime * 2.6 + gal * 15.0 + aVA.w * 5.0) * gea * gea * (0.3 + gal) * 0.006);
  }
#endif
vec3 giw = cfIw;
float gdd = distance(giw, cameraPosition);
float gfade = 1.0 - smoothstep(uCull.x, uCull.y, gdd);
// Fully faded instances collapse to a point: no fragments at all past the band.
transformed *= step(0.002, gfade);
vGd = vec4(aVA.z, aVA.y, gfade, gdInst.w);
#if defined(GD_BIOLUM) || defined(GD_BIOTIP)
  vGfl = gFl;
#endif
vGl = position;
#ifdef GD_TIP
  // House law for additive glow: fade to black by the LOCAL fog density, never toward
  // the fog colour (creatures.js / vents.js idiom).
  vGl.x = exp(-uFogD * uFogD * gdd * gdd);
#endif`;

const F_HEAD = `
uniform float uTime; uniform float uSSS; uniform vec3 uPale; uniform vec3 uPale2;
#ifdef GD_GLOWZ
  uniform vec3 uGlowZ0, uGlowZ1, uGlowZ2;
#endif
#if defined(GD_BIOLUM) || defined(GD_BIOTIP)
  varying float vGfl; uniform vec3 uBioCol; uniform float uBioFrac;
#endif
varying vec4 vGd; varying vec3 vGl; varying vec3 vBl;
#ifdef GD_BLADE
  uniform sampler2D uBladePack, uBladeNrm; uniform float uTrans;
#endif
#if defined(GD_THIN) && !defined(GD_BLADE)
  uniform float uTrans;
#endif
#ifdef GD_PIT
  float gPit(vec3 p) {
    vec3 i = floor(p), f = fract(p); float d = 9.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 h = fract(sin(vec3(dot(i + g, vec3(127.1, 311.7, 74.7)), dot(i + g, vec3(269.5, 183.3, 246.1)), dot(i + g, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
      vec3 r = g + h - f; d = min(d, dot(r, r));
    }
    return sqrt(d);
  }
#endif`;

// Dithered range fade: interleaved-gradient noise against the per-instance fade.
// Opaque, no sorting, no transparency; the far edge of every type dissolves into
// grain and then into the fog wall.
const F_DITHER = `
{
  float gdt = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (gdt > vGd.z) discard;
}`;

const F_BODY = `
#ifdef GD_ALPHA
  // (plants) an alpha card: ORM.B is the baked coverage (1 where the high exists — a fan's
  // net, a glass sponge's lattice, a crinoid's pinnules). Alpha-HASHED, not blended: opaque,
  // unsorted, and at range the mip-averaged coverage turns into a stochastic screen-door
  // the TAA resolves, instead of the lattice vanishing under a fixed threshold.
  {
    float gcv = smoothstep(0.3, 0.7, texture2D(aoMap, vAoMapUv).b);   // a partly covered mip stays a strand, not a haze
    float ghs = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (gcv < 0.04 + 0.92 * ghs) discard;
    floraThin = 1.0;
  }
#endif
#ifdef GD_BLADE
  // THIN BLADE (polish-world, flora.js's idiom): rib + veins from bladeMapSet, a
  // derivative-frame normal, paler/yellower rib and tip, per-blade hue, a ruffled
  // margin; the lace membrane of the fans counts as thin too (translucency only).
  {
    float isB = step(0.5, vBl.y);
    vec2 bu = vec2(vBl.x, clamp(vBl.y - 1.0, 0.0, 1.0));
    vec4 bp = texture2D(uBladePack, bu);
    vec3 bn = texture2D(uBladeNrm, bu).xyz * 2.0 - 1.0;
    vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
    vec2 st0 = dFdx(bu), st1 = dFdy(bu);
    vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
    vec3 T = q1p * st0.x + q0p * st1.x, Bt = q1p * st0.y + q0p * st1.y;
    float dm = max(dot(T, T), dot(Bt, Bt));
    float sc = dm > 0.0 ? inversesqrt(dm) : 0.0;
    vec3 pn = normalize(T * (bn.x * sc * 0.3) + Bt * (bn.y * sc * 0.3) + normal * max(bn.z, 0.2));
    normal = normalize(mix(normal, pn, isB));
    float tip = smoothstep(0.6, 1.0, bu.y);
    float hueK = fract(sin(vBl.z * 12.9898) * 43758.5453);
    vec3 bc = diffuseColor.rgb * mix(vec3(0.94, 1.05, 0.88), vec3(1.10, 1.0, 0.76), hueK) * mix(0.92, 1.10, bp.r);
    bc = mix(bc, bc * vec3(1.22, 1.08, 0.66), tip * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, bc, isB);
    #ifdef GD_COMB
      // sea-pen pinna: a comb of pinnules along its leading edge, not a solid vane
      if (isB > 0.5 && bu.x > 0.30 && fract(bu.y * 11.0) > 0.52) discard;
    #else
      float ea = abs(bu.x - 0.5) * 2.0;
      float edge = 0.95 - 0.14 * tip - 0.04 * sin(bu.y * 63.0 + vBl.z * 3.0);
      if (isB > 0.5 && ea > edge) discard;
    #endif
    floraThin = max(isB * (1.0 - bp.g * 0.75), vGd.x * 0.9);
  }
#endif
#ifdef GD_GLOWZ
  // (plants) flora's bioluminescent instances (aInst.w = 4 (zone + 1) + glow on a sculpted
  // batch): a dim pulse at the tips and rims, in the zone's glow colour — half flora's old
  // strength, so it reads as life in the dark, not neon
  if (vGd.w >= 4.0) {
    float gz = floor(vGd.w / 4.0) - 1.0, gg = vGd.w - 4.0 * (gz + 1.0);
    vec3 gc = gz < 0.5 ? uGlowZ0 : (gz < 1.5 ? uGlowZ1 : uGlowZ2);
    float gm = max(vGd.x, smoothstep(0.7, 1.0, vGd.y));
    totalEmissiveRadiance += gc * gg * gm * 0.45 * (0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * 0.9 + vGd.w * 3.0)));
  }
#endif
#if defined(GD_BIOLUM) || defined(GD_BIOTIP)
  // (plants2) BIOLUMINESCENCE, physically motivated and quiet: the baked polyp mask (ORM.B)
  // carries a dim resting glow and a slow wave that runs DOWN the colony (pennatulids
  // conduct their flash along the rachis); a touch — Sal's push sphere, a sonar jolt,
  // a sleeper's footfall — sets the whole colony alight for the length of the flinch.
  // Only uBioFrac of the instances are luminous (vGd.w is the instance's own draw).
  if (vGd.w < uBioFrac) {
    #ifdef GD_BIOTIP
      float gbm = smoothstep(0.6, 1.0, vGd.x);   // the arm tips (a crinoid's sway mask)
    #else
      float gbm = smoothstep(0.08, 0.5, texture2D(aoMap, vAoMapUv).b);
    #endif
    float gbw = 0.5 + 0.5 * sin(uTime * 0.65 + vGd.w * 40.0 + (1.0 - vGd.y) * 6.0);
    totalEmissiveRadiance += uBioCol * gbm * (0.22 + 0.5 * gbw * gbw * gbw * gbw + 1.4 * vGfl);
  }
#endif
#ifdef GD_PIT
  {
    float cd = gPit(vGl * 22.0);
    float pore = 1.0 - smoothstep(0.10, 0.27, cd);
    diffuseColor.rgb *= (1.0 - 0.5 * pore) * (0.93 + 0.14 * smoothstep(0.3, 0.7, cd));
    roughnessFactor = mix(roughnessFactor, 1.0, pore);
  }
#endif
#ifdef GD_LACE
  // Sea-fan lace: the membrane between branches is a mesh, not a sheet — a two-axis
  // sine grid punches the holes. Only lace vertices carry the mask.
  if (vGd.x > 0.5) {
    float gl1 = sin(vGl.x * 95.0) * sin(vGl.y * 95.0 + 1.3);
    if (gl1 > 0.22) discard;
    diffuseColor.rgb *= 0.72;
  }
#endif
#ifdef GD_PALE
  diffuseColor.rgb = mix(diffuseColor.rgb, uPale, vGd.x);
#endif
#ifdef GD_MAT
  // Bacterial crust: concentric rings (white centre, sulphur, rust rim) with a
  // mottled, cracked surface. Radius is the local distance from the disc centre.
  float gmr = clamp(length(vGl.xz) * 2.0, 0.0, 1.0);
  float gmn = sin(vGl.x * 31.0 + sin(vGl.z * 27.0 + 1.7) * 2.2) * sin(vGl.z * 29.0 + vGl.x * 7.0);
  float gcr = 1.0 - smoothstep(0.0, 0.18, abs(gmn - 0.55));
  vec3 gring = mix(uPale, uPale2, smoothstep(0.35, 0.85, gmr + gmn * 0.12));
  diffuseColor.rgb = mix(diffuseColor.rgb, gring, 0.85) * (1.0 - 0.45 * gcr) * (0.88 + 0.16 * gmn);
  roughnessFactor = mix(roughnessFactor, 1.0, gcr);
#endif
#ifdef GD_INNER
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.35;
#endif
#ifdef GD_SSS
  float gfr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSSS * (0.18 + 0.82 * vGd.y) * (0.3 + 0.7 * gfr);
#endif`;

// (plants) LIT subsurface for the sculpted species: flora.js's FLORA_SSSL idea (the scatter a
// living tissue adds is light it RECEIVED, re-emitted softly) instead of GD_SSS's emissive,
// which glows in a lightless zone. vGd.y = normalised height, so tips scatter more.
const F_SSSL = `
#ifdef GD_SSSL
{
  vec3 sIrr = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(diffuseColor.rgb, vec3(0.04));
  float sFr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.0);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * sIrr * uSSS * (0.25 + 0.75 * vGd.y) * (0.3 + 0.7 * sFr) * (0.5 + 0.5 * floraThin);
}
#endif`;

function gardenMat(o) {
  const SC = o.sculpt;   // (plants) baked maps for a sculpted species: plants/plantKit.js
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: !SC, roughness: SC ? 1 : (o.rough ?? 0.85), metalness: o.metal ?? 0,
    side: o.side ?? THREE.FrontSide
  });
  if (SC) {
    m.map = SC.map; m.normalMap = SC.normalMap; m.roughnessMap = SC.orm; m.aoMap = SC.orm;
    m.aoMapIntensity = o.ao ?? 1; m.normalScale.set(1, 1);
  }
  m.defines = {};
  for (const d of o.def || []) m.defines['GD_' + d] = 1;
  if (SC) m.defines.GD_SCULPT = 1;
  if (o.glowZ) m.defines.GD_GLOWZ = 1;
  if (m.defines.GD_BLADE) m.forceSinglePass = true;
  const cull = o.cull ?? 90;
  m.onBeforeCompile = sh => {
    if (m.defines.GD_BLADE) {
      const BS = bladeMapSet();
      Object.assign(sh.uniforms, { uBladePack: { value: BS.pack }, uBladeNrm: { value: BS.nrm }, uTrans: { value: o.trans ?? 1 } });
    }
    if (m.userData.uInstTex) sh.uniforms.uInstTex = m.userData.uInstTex;
    if (m.defines.GD_THIN && !m.defines.GD_BLADE) sh.uniforms.uTrans = { value: o.trans ?? 1 };
    if (m.defines.GD_RUFFLE) sh.uniforms.uRuffle = { value: o.ruffle ?? 0.012 };
    if (m.defines.GD_BIOLUM || m.defines.GD_BIOTIP) { sh.uniforms.uBioCol = { value: new THREE.Color(o.bioCol ?? 0x2f8f86) }; sh.uniforms.uBioFrac = { value: o.bioFrac ?? 1 }; }
    if (o.glowZ) for (let k = 0; k < 3; k++) sh.uniforms['uGlowZ' + k] = { value: new THREE.Color(o.glowZ[k]) };
    Object.assign(sh.uniforms, uni, {
      uCull: { value: new THREE.Vector2(cull * 0.72, cull) },
      uSway: { value: o.sway ?? 0 }, uFreq: { value: o.freq ?? 0.85 },
      uSSS: { value: o.sss ?? 0 },
      uPale: { value: new THREE.Color(o.pale ?? 0xe8e2d2) },
      uPale2: { value: new THREE.Color(o.pale2 ?? 0x8a4a2a) }
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + V_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + V_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + F_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + F_DITHER)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat floraThin = 0.0;\n{' + F_BODY + '\n}')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + F_TRANS + F_SSSL);
    injectStrokes(sh);   // SILHOUETTE STROKES (lib/paint.js): the plants are organic
  };
  m.customProgramCacheKey = () => 'gardens|' + o.key;
  return registerPaint(m);
}

// The one additive material: sea-pen tips. fog:false + manual extinction (vGl.x),
// unlit, dim, pulsing on the pen's own phase. Same vertex body so tips ride the sway.
function tipMat(o) {
  const m = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  m.forceSinglePass = true;
  m.defines = { GD_TIP: 1 };
  const cull = o.cull ?? 90;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni, {
      uCull: { value: new THREE.Vector2(cull * 0.72, cull) },
      uSway: { value: o.sway ?? 0 }, uFreq: { value: o.freq ?? 0.85 }
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + V_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + V_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + F_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + F_DITHER)
      .replace('#include <opaque_fragment>', `
        float gpl = 0.55 + 0.45 * sin(uTime * 0.7 + vGd.w * 6.2831 + vGd.y * 4.0);
        // a soft round point of light, not the quad (vBl.xy is the quad's uv, v + 1)
        float gtr = length(vBl.xy - vec2(0.5, 1.5)) * 2.0;
        float gtd = 1.0 - smoothstep(0.0, 1.0, gtr);
        outgoingLight *= vGl.x * gpl * gtd * gtd * ${(o.gain ?? 0.5).toFixed(3)};
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'gardens|tip';
  return m;
}

// ------------------------------------------------------------- geometry ------
// Accumulates transformed primitives into one indexed buffer, tagging every vertex
// with the per-part data the sway shader reads (flora.js's Build idiom).
class Build {
  constructor() { this.p = []; this.n = []; this.i = []; this.meta = []; this.bu = []; this.v = 0; }
  add(geo, m, o = {}) {
    const g = geo.clone().applyMatrix4(m);
    const pos = g.attributes.position, nor = g.attributes.normal, c = pos.count;
    const uv = o.bu ? g.attributes.uv : null;   // blades carry their uv as aBU (v + 1)
    for (let k = 0; k < c; k++) {
      this.p.push(pos.getX(k), pos.getY(k), pos.getZ(k));
      this.n.push(nor.getX(k), nor.getY(k), nor.getZ(k));
      this.meta.push(o);
      if (uv) this.bu.push(uv.getX(k), uv.getY(k) + 1); else this.bu.push(0, 0);
    }
    if (g.index) for (const k of g.index.array) this.i.push(k + this.v);
    else for (let k = 0; k < c; k++) this.i.push(k + this.v);
    this.v += c;
    g.dispose();
    return this;
  }
  // span: an optional { lo, hi } height frame to normalise h against, so a part built as
  // its own geometry (the sea-pen tips) sways on its parent's frame, not its own.
  done(fn, span0 = null) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 1; k < this.p.length; k += 3) { if (this.p[k] < lo) lo = this.p[k]; if (this.p[k] > hi) hi = this.p[k]; }
    this.lo = lo; this.hi = hi;
    if (span0) { lo = span0.lo; hi = span0.hi; }
    const span = Math.max(1e-4, hi - lo);
    const col = new Float32Array(this.v * 3), va = new Float32Array(this.v * 4), fl = new Float32Array(this.v);
    const o = { c: [1, 1, 1], flex: 0, mask: 0, flut: 0, ph: 0 };
    for (let k = 0; k < this.v; k++) {
      const x = this.p[k * 3], y = this.p[k * 3 + 1], z = this.p[k * 3 + 2], h = (y - lo) / span;
      o.c[0] = o.c[1] = o.c[2] = 1; o.flex = h * h; o.mask = 0; o.flut = 0; o.ph = this.meta[k].ph || 0;
      fn(x, y, z, h, this.meta[k], o);
      col[k * 3] = o.c[0]; col[k * 3 + 1] = o.c[1]; col[k * 3 + 2] = o.c[2];
      va[k * 4] = o.flex; va[k * 4 + 1] = h; va[k * 4 + 2] = o.mask; va[k * 4 + 3] = o.ph;
      fl[k] = o.flut;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aVA', new THREE.BufferAttribute(va, 4));
    g.setAttribute('aFlut', new THREE.BufferAttribute(fl, 1));
    g.setAttribute('aBU', new THREE.Float32BufferAttribute(this.bu, 2));
    g.setIndex(this.i);
    return g;
  }
}

const ID = new THREE.Matrix4();
function xf(px, py, pz, ry = 0, rz = 0, rx = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4().makeRotationY(ry);
  if (rz) m.multiply(new THREE.Matrix4().makeRotationZ(rz));
  if (rx) m.multiply(new THREE.Matrix4().makeRotationX(rx));
  m.scale(_s.set(sx, sy, sz));
  m.setPosition(px, py, pz);
  return m;
}

// Tapered tube on a Catmull-Rom path: every ring is scaled about its own centre by
// (r0 -> r1), which is what makes a branch read as grown rather than extruded.
function tubeGeo(pts, segs, r0, r1, sides) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, segs, r0, sides, false);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const row = Math.floor(k / (sides + 1)), t = row / segs;
    curve.getPointAt(t, _v);
    const tp = 1 + (r1 / r0 - 1) * t;
    p.setXYZ(k, _v.x + (p.getX(k) - _v.x) * tp, _v.y + (p.getY(k) - _v.y) * tp, _v.z + (p.getZ(k) - _v.z) * tp);
  }
  g.computeVertexNormals();
  return g;
}

// Rooted blade: zero flex at the rhizome, leaning with t^2, width tapering to a tip.
function bladeGeo(h, w, lean, rows = 5) {
  const p = [], idx = [], uv = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, bend = lean * t * t, side = w * (1 - 0.85 * t * t), y = h * (t - 0.19 * t * t * t);
    p.push(-side, y, bend, side, y, bend);
    uv.push(0, t, 1, t);
    if (j < rows) { const n = j * 2; idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Flat triangle (lace membrane between two fan branches).
function triGeo(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], 3));
  g.setIndex([0, 1, 2]);
  g.computeVertexNormals();
  return g;
}

// ---- ZONE 0 ------------------------------------------------------------------
// Sea fan: a gorgonian grown in the XY plane by recursive tapered tubes, with lace
// stretched between each pair of sister branches (mesh-punched in the fragment).
function seaFanGeo() {
  const B = new Build();
  const grow = (s, ang, len, w, d) => {
    const e = new THREE.Vector3(s.x - Math.sin(ang) * len, s.y + Math.cos(ang) * len, 0);
    const mid = s.clone().lerp(e, 0.5); mid.x += gr(-0.06, 0.06) * len; mid.z += gr(-0.02, 0.02) * len;
    const g = tubeGeo([s, mid, e], 2, w, w * 0.7, 3);
    B.add(g, ID, { t: 'b', d });
    g.dispose();
    if (d >= 4) return;
    const n = d === 0 ? 3 : 2, tips = [];
    for (let i = 0; i < n; i++) {
      const a2 = ang + (i - (n - 1) / 2) * gr(0.36, 0.64) + gr(-0.08, 0.08);
      const l2 = len * gr(0.66, 0.82);
      tips.push(new THREE.Vector3(e.x - Math.sin(a2) * l2 * 0.72, e.y + Math.cos(a2) * l2 * 0.72, 0));
      grow(e, a2, l2, w * 0.74, d + 1);
    }
    for (let i = 0; i + 1 < tips.length; i++) {
      const g2 = triGeo(e, tips[i], tips[i + 1]);
      B.add(g2, ID, { t: 'l', d });
      g2.dispose();
    }
  };
  grow(new THREE.Vector3(0, 0, 0), 0, 0.34, 0.03, 0);
  return B.done((x, y, z, h, m, o) => {
    const s = 0.34 + 0.66 * h;
    o.c[0] = s; o.c[1] = s * 0.9; o.c[2] = s * 0.92;
    o.flex = h * h; o.mask = m.t === 'l' ? 1 : 0;
    if (m.t === 'l') { o.c[0] *= 0.8; o.c[1] *= 0.8; o.c[2] *= 0.8; }
  });
}

// Seagrass clump: ten rooted blades leaning off one rhizome.
function seagrassGeo() {
  const B = new Build();
  const lean = gr(0, TAU);
  for (let i = 0; i < 10; i++) {
    const a = gr(0, TAU), r = Math.sqrt(_ge()) * 0.14, h = gr(0.45, 1);
    const g = bladeGeo(h, gr(0.012, 0.036), h * gr(0.2, 0.7));
    B.add(g, xf(Math.cos(a) * r, 0, Math.sin(a) * r, lean + gr(-0.8, 0.8)), { ph: gr(0, TAU), h, bu: true });
    g.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    const u = clamp(y / m.h, 0, 1), s = 0.32 + 0.68 * u, tp = sstep(0.6, 1, u);
    // older, paler, yellowing tips — the blade grows from the base
    o.c[0] = s * (0.72 + 0.4 * tp); o.c[1] = s * (1 + 0.06 * tp); o.c[2] = s * (0.66 - 0.1 * tp);
    o.flex = Math.pow(u, 1.4); o.flut = 0.02 * u * u;
  });
}

// Staghorn thicket: three trunks of recursive tapered tubes; tips finished paler.
function staghornGeo() {
  const B = new Build();
  const rec = (s, dir, len, rad, lv) => {
    const e = s.clone().addScaledVector(dir, len);
    const mid = s.clone().lerp(e, 0.52).add(new THREE.Vector3(gr(-0.5, 0.5) * len * 0.12, 0, gr(-0.5, 0.5) * len * 0.12));
    const g = tubeGeo([s, mid, e], 2, rad, rad * 0.62, lv >= 2 ? 4 : 3);
    B.add(g, ID, { t: 'b' });
    g.dispose();
    if (lv <= 0) {
      const tip = e.clone().addScaledVector(dir, len * 0.22);
      const g2 = tubeGeo([e, tip], 1, rad * 0.6, rad * 0.18, 3);
      B.add(g2, ID, { t: 't' });
      g2.dispose();
      return;
    }
    const forks = lv > 1 ? 3 : 2;
    for (let j = 0; j < forks; j++) {
      const nd = new THREE.Vector3(gr(-0.75, 0.75), 0.5 + gr(0, 0.7), gr(-0.75, 0.75)).addScaledVector(dir, 0.5).normalize();
      rec(e, nd, len * gr(0.63, 0.73), rad * 0.69, lv - 1);
    }
  };
  const ang = gr(0, TAU);
  for (let j = 0; j < 3; j++) {
    const a = ang + j / 3 * TAU;
    rec(new THREE.Vector3(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03),
      new THREE.Vector3(Math.cos(a) * 0.55, 0.7 + gr(0, 0.35), Math.sin(a) * 0.55).normalize(), 0.3, 0.045, 2);
  }
  return B.done((x, y, z, h, m, o) => {
    const s = 0.36 + 0.64 * h;
    o.c[0] = s; o.c[1] = s * 0.9; o.c[2] = s * 0.86;
    o.flex = h * h * 0.5; o.mask = m.t === 't' ? 1 : sstep(0.75, 1, h) * 0.5;
  });
}

// Barrel sponge: a lathe whose profile climbs the outside and returns down the
// inside (hollow), ribbed by angular wobble.
function barrelGeo() {
  const prof = [[0.30, 0], [0.46, 0.22], [0.58, 0.62], [0.64, 1.1], [0.62, 1.5], [0.56, 1.68], [0.44, 1.72], [0.38, 1.5], [0.36, 1.0], [0.30, 0.5], [0.16, 0.3]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  const p = g.attributes.position, wob = gr(0, 9);
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k), a = Math.atan2(z, x);
    const f = 1 + Math.sin(a * 9 + y * 2.5 + wob) * 0.07 + Math.cos(a * 4 - y * 1.7) * 0.05 + Math.sin(y * 6.1 + wob) * 0.03;
    p.setXYZ(k, x * f, y, z * f);
  }
  g.computeVertexNormals();
  const B = new Build();
  B.add(g, ID);
  g.dispose();
  return B.done((x, y, z, h, m, o) => {
    const rad = Math.hypot(x, z), inner = y > 0.28 && rad < 0.42 ? 1 : 0;
    const rim = y > 1.62 ? 1 : 0;            // the osculum's lip: paler, sun-bleached
    const s = (0.42 + 0.58 * h) * (1 - 0.5 * inner) * (1 + 0.25 * rim);
    o.c[0] = s; o.c[1] = s * 0.78; o.c[2] = s * 0.72;
    o.flex = h * h * 0.25;
  });
}

// Anemone: an open stalk, an oral disc, and 20 tapered tentacles in two rings
// curving outward — the crown waves, the stalk holds.
function anemoneGeo() {
  const B = new Build();
  const col = new THREE.CylinderGeometry(0.16, 0.12, 0.28, 8, 1, true);
  col.translate(0, 0.14, 0);
  B.add(col, ID, { t: 'c' });
  const disc = new THREE.SphereGeometry(0.17, 8, 3, 0, TAU, 0, Math.PI * 0.5);
  B.add(disc, xf(0, 0.25, 0, 0, 0, 0, 0.85, 0.3, 0.85), { t: 'c' });
  // POLISH-WORLD: 22 tentacles (14 outer + 8 inner) on 3-segment tubes with a
  // bulbed tip, and a MOUTH: a raised oral lip round a dark slit (below)
  for (let i = 0; i < 22; i++) {
    const ring = i < 14 ? 0 : 1, a = (i - (ring ? 14 : 0)) / (ring ? 8 : 14) * TAU + ring * 0.3;
    const r = ring ? 0.07 : 0.145, len = gr(0.28, 0.46), up = ring ? gr(0.75, 1.0) : gr(0.35, 0.65);
    const b = new THREE.Vector3(Math.sin(a) * r, 0.29, Math.cos(a) * r);
    const d = new THREE.Vector3(Math.sin(a) * (1 - up), up, Math.cos(a) * (1 - up)).normalize();
    const mid = b.clone().addScaledVector(d, len * 0.5); mid.y += len * 0.18;
    const e = b.clone().addScaledVector(d, len); e.y -= len * gr(0.0, 0.2);
    const g = tubeGeo([b, mid, e], 3, 0.024, 0.010, 3);
    B.add(g, ID, { t: 't', ph: gr(0, TAU), bx: b.x, by: b.y, bz: b.z, len });
    g.dispose();
  }
  const lip = new THREE.TorusGeometry(0.05, 0.015, 3, 6).rotateX(Math.PI / 2);
  B.add(lip, xf(0, 0.30, 0, 0, 0, 0, 1, 1, 0.72), { t: 'm' });
  const slit = new THREE.SphereGeometry(0.045, 5, 2, 0, TAU, 0, Math.PI * 0.5);
  B.add(slit, xf(0, 0.292, 0, 0, 0, 0, 0.9, 0.25, 0.42), { t: 's' });
  lip.dispose(); slit.dispose();
  col.dispose(); disc.dispose();
  return B.done((x, y, z, h, m, o) => {
    if (m.t === 't') {
      const u = clamp(Math.hypot(x - m.bx, y - m.by, z - m.bz) / m.len, 0, 1), s = 0.5 + 0.5 * u;
      o.c[0] = s; o.c[1] = s * 0.94; o.c[2] = s * 0.9;
      o.flex = u * u; o.flut = 0.04 * u * u; o.mask = sstep(0.6, 1, u);
    } else if (m.t === 'm') {
      o.c[0] = 0.62; o.c[1] = 0.52; o.c[2] = 0.52; o.flex = 0;
    } else if (m.t === 's') {
      o.c[0] = 0.09; o.c[1] = 0.06; o.c[2] = 0.07; o.flex = 0;
    } else {
      const s = 0.32 + 0.3 * h;
      o.c[0] = s * 0.9; o.c[1] = s * 0.78; o.c[2] = s * 0.8;
      o.flex = 0;
    }
  });
}

// ---- ZONE 1 ------------------------------------------------------------------
// Tube-worm colony: 16 white chitin tubes leaning off one clump, each crowned by
// a red branchial plume. The plume vertices carry mask=1 (retract weight) and the
// tube's own phase so the crowns retract one at a time.
function tubewormGeo() {
  const B = new Build();
  for (let i = 0; i < 16; i++) {
    const a = gr(0, TAU), r = Math.sqrt(_ge()) * 0.42, ph = gr(0, TAU);
    const b = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const lean = new THREE.Vector3(gr(-0.3, 0.3), 1, gr(-0.3, 0.3)).normalize();
    const H = gr(0.45, 1.05);
    const top = b.clone().addScaledVector(lean, H);
    const mid = b.clone().addScaledVector(lean, H * 0.5); mid.x += gr(-0.04, 0.04); mid.z += gr(-0.04, 0.04);
    const tube = tubeGeo([b, mid, top], 2, 0.03, 0.026, 5);
    B.add(tube, ID, { t: 'w', ph, H });
    tube.dispose();
    const pt = top.clone().addScaledVector(lean, 0.13);
    const plume = tubeGeo([top, pt], 2, 0.019, 0.05, 5);
    B.add(plume, ID, { t: 'p', ph, H });
    plume.dispose();
    const cap = new THREE.ConeGeometry(0.05, 0.05, 5, 1, true);
    cap.translate(0, 0.025, 0);
    B.add(cap, xf(pt.x, pt.y, pt.z, 0, 0, 0, 1, 1, 1), { t: 'p', ph, H });
    cap.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    if (m.t === 'p') {
      o.c[0] = 0.72; o.c[1] = 0.1; o.c[2] = 0.08;
      o.flex = h * h * 0.4; o.mask = 1; o.flut = 0.006;
    } else {
      const s = 0.55 + 0.45 * clamp(y / m.H, 0, 1);
      o.c[0] = s; o.c[1] = s * 0.98; o.c[2] = s * 0.92;
      o.flex = h * h * 0.15; o.mask = 0;
    }
  });
}

// Bacterial mat: a shallow dome disc with a wobbling rim; crust detail is per-pixel.
function matGeo() {
  const p = [0, 0.03, 0], idx = [], N = 14, w = gr(0, 9);
  for (let ring = 1; ring <= 2; ring++) {
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU, rw = ring === 2 ? 1 + 0.12 * Math.sin(a * 5 + w) + 0.06 * Math.sin(a * 9 - w) : 0.5;
      p.push(Math.cos(a) * 0.5 * rw, ring === 1 ? 0.02 : 0.004, Math.sin(a) * 0.5 * rw);
    }
  }
  for (let i = 0; i < N; i++) {
    const a = 1 + i, b = 1 + (i + 1) % N;
    idx.push(0, b, a);
    const c = 1 + N + i, d = 1 + N + (i + 1) % N;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const B = new Build();
  B.add(g, ID);
  g.dispose();
  return B.done((x, y, z, h, m, o) => { o.c[0] = 0.9; o.c[1] = 0.86; o.c[2] = 0.7; o.flex = 0; });
}

// Stalked crinoid: a curved stalk, a small calyx, ten feathered arms opening upward.
function crinoidGeo() {
  const B = new Build();
  const H = gr(0.6, 1.0), sw = gr(-0.12, 0.12);
  const stalk = tubeGeo([new THREE.Vector3(0, 0, 0), new THREE.Vector3(sw, H * 0.5, sw * 0.5), new THREE.Vector3(sw * 1.4, H, 0)], 3, 0.02, 0.014, 4);
  B.add(stalk, ID, { t: 's' });
  stalk.dispose();
  const calyx = new THREE.IcosahedronGeometry(0.045, 0);
  const top = new THREE.Vector3(sw * 1.4, H, 0);
  B.add(calyx, xf(top.x, top.y, top.z), { t: 's' });
  calyx.dispose();
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU + gr(-0.15, 0.15), len = gr(0.28, 0.4), ph = gr(0, TAU);
    const d = new THREE.Vector3(Math.cos(a) * 0.55, 0.8, Math.sin(a) * 0.55).normalize();
    const mid = top.clone().addScaledVector(d, len * 0.5); mid.y += len * 0.08;
    const e = top.clone().addScaledVector(d, len); e.y += len * 0.05;
    const g = tubeGeo([top, mid, e], 3, 0.011, 0.004, 3);
    B.add(g, ID, { t: 'a', ph, len });
    g.dispose();
    // pinnules: a thin ribbon either side of the arm, the feather read
    const f = bladeGeo(len * 0.9, 0.035, 0, 2);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    m.setPosition(top.x, top.y, top.z);
    B.add(f, m, { t: 'f', ph, len });
    f.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    if (m.t === 's') {
      const s = 0.4 + 0.3 * h;
      o.c[0] = s * 0.9; o.c[1] = s * 0.86; o.c[2] = s * 0.78;
      o.flex = h * h * 0.2;
    } else {
      const u = clamp(Math.hypot(x - top.x, y - top.y, z - top.z) / m.len, 0, 1), s = 0.5 + 0.5 * u;
      o.c[0] = s * 0.95; o.c[1] = s * 0.8; o.c[2] = s * 0.55;
      if (m.t === 'f') { o.c[0] *= 0.85; o.c[1] *= 0.85; o.c[2] *= 0.85; }
      o.flex = 0.2 + Math.pow(u, 1.4) * 0.8; o.flut = 0.025 * u;
    }
  });
}

// ---- ZONE 2 ------------------------------------------------------------------
// Sea pen: a quill (tapered tube) with two rows of pinnae; the pinna tips are also
// emitted separately (penTipGeo) for the additive pass.
const PEN_N = 11;
function penSpec() {
  const spec = [], H = 1;
  for (let i = 0; i < PEN_N; i++) {
    const t = 0.3 + 0.62 * (i / (PEN_N - 1));
    const len = 0.22 * Math.sin(Math.PI * (0.2 + 0.8 * (i / (PEN_N - 1)))) + 0.06;
    spec.push({ y: t * H, len, ph: gr(0, TAU) });
  }
  return spec;
}
let PEN_SPEC = null;
function seaPenGeo() {
  const B = new Build();
  const quill = tubeGeo([new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0.02, 0.5, 0), new THREE.Vector3(0.04, 1.05, 0)], 4, 0.022, 0.006, 4);
  B.add(quill, ID, { t: 'q' });
  quill.dispose();
  for (const s of PEN_SPEC) for (const sd of [-1, 1]) {
    const f = bladeGeo(s.len, 0.028, s.len * 0.25, 2);
    // pinna: rooted on the rachis, growing sideways (+/-X) and a little up
    B.add(f, xf(0.02 * s.y, s.y, 0, 0, sd * 1.25, 0), { t: 'p', ph: s.ph, len: s.len, by: s.y, bu: true });
    f.dispose();
  }
  const g = B.done((x, y, z, h, m, o) => {
    if (m.t === 'q') {
      const s = 0.45 + 0.4 * h;
      o.c[0] = s * 0.9; o.c[1] = s * 0.7; o.c[2] = s * 0.62;
      o.flex = Math.pow(h, 1.4) * 0.8;
    } else {
      const u = clamp(Math.hypot(x, y - m.by) / m.len, 0, 1), s = 0.5 + 0.5 * u;
      o.c[0] = s * 0.92; o.c[1] = s * 0.72; o.c[2] = s * 0.66;
      o.flex = Math.pow(h, 1.4) * 0.8 + u * 0.15; o.flut = 0.012 * u; o.mask = u;
    }
  });
  PEN_Y = { lo: B.lo, hi: B.hi };
  return g;
}
// The pinna tips' glow. These used to be placed on a guessed arc (x mirrored, no lean,
// the wrong angle) that missed every pinna, and drawn as hard additive SQUARES — the
// staircase of pale blue blocks hanging beside each pen in zone 2. Now each dot sits on
// its pinna's real tip (the same bladeGeo end point through the same xf), sways on the
// pen's own height frame with the pinna's own flex/flutter at that point, and is a soft
// round falloff (tipMat reads the quad's uv).
let PEN_Y = null;
const _penTip = new THREE.Vector3();
function penTipGeo() {
  const B = new Build();
  const q = new THREE.PlaneGeometry(0.05, 0.05);
  for (const s of PEN_SPEC) for (const sd of [-1, 1]) {
    // bladeGeo(h, w, lean): tip at (0, h (1 - 0.19), lean); the pen builds it with
    // h = len, lean = 0.25 len, rotated sd * 1.25 about Z and set on the rachis
    _penTip.set(0, s.len * 0.81, s.len * 0.25).applyMatrix4(xf(0.02 * s.y, s.y, 0, 0, sd * 1.25, 0));
    B.add(q, xf(_penTip.x, _penTip.y, _penTip.z, 0, 0, 0, 1, 1, 1), { ph: s.ph, by: s.y, len: s.len, bu: true });
  }
  q.dispose();
  return B.done((x, y, z, h, m, o) => {
    o.c[0] = 0.55; o.c[1] = 0.85; o.c[2] = 1.0;
    const u = clamp(Math.hypot(x, y - m.by) / m.len, 0, 1);
    o.flex = Math.pow(h, 1.4) * 0.8 + u * 0.15; o.flut = 0.012 * u; o.mask = 1;
  }, PEN_Y);
}

// Glass sponge: a lattice basket — vertical ribs on a vase profile, horizontal hoops.
function glassGeo() {
  const B = new Build();
  const prof = t => 0.18 + 0.3 * Math.sin(t * Math.PI * 0.85 + 0.25) - 0.1 * t;
  const RIBS = 7, HOOPS = 5;
  for (let i = 0; i < RIBS; i++) {
    const a = i / RIBS * TAU + gr(-0.1, 0.1), pts = [];
    for (let j = 0; j <= 4; j++) { const t = j / 4, r = prof(t); pts.push(new THREE.Vector3(Math.cos(a) * r, t, Math.sin(a) * r)); }
    const g = tubeGeo(pts, 5, 0.014, 0.01, 3);
    B.add(g, ID, {});
    g.dispose();
  }
  for (let j = 0; j < HOOPS; j++) {
    const t = 0.1 + 0.85 * (j / (HOOPS - 1)), r = prof(t);
    const g = new THREE.TorusGeometry(r, 0.01, 3, 12);
    B.add(g, xf(0, t, 0, 0, 0, Math.PI / 2), {});
    g.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    const s = 0.55 + 0.45 * h;
    o.c[0] = s * 0.86; o.c[1] = s * 0.94; o.c[2] = s;
    o.flex = h * h * 0.05;
  });
}

// Whip coral: one long tapered tube on a gentle S, bending in the deep current.
function whipGeo() {
  const H = gr(0.85, 1.15), a = gr(0, TAU);
  const pts = [new THREE.Vector3(0, 0, 0)];
  for (let j = 1; j <= 3; j++) {
    const t = j / 3, sw = Math.sin(t * 3.2 + a) * 0.06 * t;
    pts.push(new THREE.Vector3(Math.cos(a) * sw, H * t, Math.sin(a) * sw));
  }
  const g = tubeGeo(pts, 8, 0.016, 0.005, 4);
  const B = new Build();
  B.add(g, ID);
  g.dispose();
  return B.done((x, y, z, h, m, o) => {
    const s = 0.5 + 0.5 * h;
    o.c[0] = s * 0.95; o.c[1] = s * 0.86; o.c[2] = s * 0.7;
    o.flex = Math.pow(h, 1.4);
  });
}

// -------------------------------------------------------------- placement ----
const WRECK_MARGIN = 4;
function nearWreck(zi, x, z) {
  const w = wreckSites()[zi];
  const d = w.clear + WRECK_MARGIN;
  return (x - w.x) * (x - w.x) + (z - w.z) * (z - w.z) < d * d;
}

function inZoneBand(y, zi) { return y < zoneTop(zi) + 10 && y > zoneBottom(zi) - 60; }

// Reef anchors: flora's boulders in this zone (colliders carry world y) — the gardens
// grow where the reef already is. Plus a few fbm-gated clusters of its own so open
// sand gets the occasional stand.
function reefSeeds(zi, own, radLo, radHi, thresh, seed) {
  const out = [];
  for (const c of rockColliders) if (inZoneBand(c.y, zi)) out.push([c.x, c.z, c.r * rr(1.6, 2.6)]);
  const rp = riftPos(zi), want = out.length + own;
  let guard = 0;
  while (out.length < want && guard++ < own * 60) {
    const a = _gr() * TAU, r = rr(16, WORLD_R * 0.92);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 3) continue;
    if (fbm(x * 0.011 + seed, z * 0.011 - seed) < thresh) continue;
    out.push([x, z, rr(radLo, radHi)]);
  }
  return out;
}

function fieldSeeds(zi, n, radLo, radHi, thresh, seed) {
  const out = [], rp = riftPos(zi);
  let guard = 0;
  while (out.length < n && guard++ < n * 70) {
    const a = _gr() * TAU, r = rr(14, WORLD_R * 0.97);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 3) continue;
    if (guard < n * 35 && fbm(x * 0.011 + seed, z * 0.011 - seed) < thresh) continue;
    out.push([x, z, rr(radLo, radHi)]);
  }
  return out;
}

// Clumped sampling with slope gating (flora.js's place()), against this module's own
// stream. Same exclusions: rift funnel, wreck site, the raft's water, the rim.
const _pts = [];
function place(zi, count, seeds, minSlope, maxSlope = 1.01) {
  _pts.length = 0;
  if (!seeds.length) return _pts;
  const rp = riftPos(zi);
  let lo = minSlope, guard = 0, relaxed = false;
  while (_pts.length < count && guard++ < count * 40) {
    if (!relaxed && guard > count * 18) { relaxed = true; lo = 1 - (1 - lo) * 2.4; }
    const s = seeds[(_gr() * seeds.length) | 0];
    const a = _gr() * TAU, u = Math.pow(_gr(), 0.8);
    if (_gr() < u * 0.5) continue;
    const x = s[0] + Math.cos(a) * s[2] * u, z = s[1] + Math.sin(a) * s[2] * u;
    const r = Math.hypot(x, z);
    if (r > WORLD_R * 0.98 || r < 10) continue;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 2.4) continue;
    if (nearWreck(zi, x, z)) continue;
    const n = terrainNormal(x, z, zi);
    if (n.y < lo || n.y > maxSlope) continue;
    _pts.push({ x, z, y: terrainH(x, z, zi), n });
  }
  return _pts;
}

// ------------------------------------------------------------------ build ----
// Capacities: fixed at build, never grown. Vent-anchored types are sized for 20 vents.
const CAP = {
  fan: 60, grass: 320, stag: 80, barrel: 70, anem: 64,
  worm: 100, mat: 140, crin: 120,
  pen: 180, glass: 50, whip: 180
};
// Range fade per type (the far edge of the band is where the dither has finished).
const CULL = {
  fan: 95, grass: 62, stag: 95, barrel: 105, anem: 80,
  worm: 80, mat: 70, crin: 85,
  pen: 90, glass: 110, whip: 100
};

const PAL = {
  fan: [0xb8666e, 0xc48a5a, 0x8f6a9e, 0xc4a25a],
  stag: [0xd7a46a, 0xc8846e, 0xa9b96e, 0xd8c08a],
  barrel: [0xb85a3e, 0xa14a52, 0xc0763a],
  anem: [0xc8907e, 0x8fb09a, 0xcaa870, 0xa88ab8],
  grass: [0x5f8a4a, 0x6f9a3e, 0x4e7f52],
  worm: [0xe8e2d2, 0xd9d1bc],
  mat: [0xf0e6c8, 0xd8c88a, 0xe8d8a0],
  crin: [0xc9a15a, 0xa87a4e, 0xd6b96e],
  pen: [0xc98a72, 0xb87862, 0xd8a08a],
  glass: [0xd6e4ee, 0xc4d6e4],
  whip: [0xc9b58a, 0xb59a6a, 0xd8c8a0]
};

let built = false;
const zones = [null, null, null];
const IM = {};           // name -> InstancedMesh
let penTips = null;
let mats = null;

function makeMats() {
  return {
    fan: gardenMat({ key: 'fan', side: THREE.DoubleSide, rough: 0.72, sway: 1, freq: 0.8, cull: CULL.fan, sss: 0.4, def: ['SSS', 'LACE', 'BLADE'], trans: 1.0 }),
    grass: gardenMat({ key: 'grass', side: THREE.DoubleSide, rough: 0.8, sway: 1, freq: 1.2, cull: CULL.grass, sss: 0.45, def: ['SSS', 'BLADE'], trans: 0.9 }),
    stag: gardenMat({ key: 'stag', rough: 0.62, sway: 1, freq: 0.5, cull: CULL.stag, pale: 0xf2ece0, def: ['PALE'] }),
    barrel: gardenMat({ key: 'barrel', side: THREE.DoubleSide, rough: 0.82, sway: 1, freq: 0.5, cull: CULL.barrel, def: ['INNER', 'PIT'] }),
    anem: gardenMat({ key: 'anem', side: THREE.DoubleSide, rough: 0.55, sway: 1, freq: 1.0, cull: CULL.anem, sss: 0.35, pale: 0xfff0e0, def: ['SSS', 'PALE', 'FLINCH'] }),
    worm: gardenMat({ key: 'worm', side: THREE.DoubleSide, rough: 0.7, sway: 1, freq: 0.6, cull: CULL.worm, def: ['WORM', 'INNER'] }),
    mat: gardenMat({ key: 'mat', rough: 0.95, sway: 0, cull: CULL.mat, pale: 0xf3ecd8, pale2: 0x9a4e28, def: ['MAT'] }),
    crin: gardenMat({ key: 'crin', side: THREE.DoubleSide, rough: 0.7, sway: 1, freq: 0.7, cull: CULL.crin, sss: 0.3, def: ['SSS', 'FLINCH'] }),
    pen: gardenMat({ key: 'pen', side: THREE.DoubleSide, rough: 0.75, sway: 1, freq: 0.55, cull: CULL.pen, sss: 0.3, def: ['SSS', 'BLADE', 'COMB'], trans: 0.6 }),
    glass: gardenMat({ key: 'glass', side: THREE.DoubleSide, rough: 0.35, metal: 0.05, sway: 1, freq: 0.4, cull: CULL.glass, sss: 0.6, def: ['SSS'] }),
    whip: gardenMat({ key: 'whip', rough: 0.7, sway: 1, freq: 0.45, cull: CULL.whip }),
    tip: tipMat({ sway: 1, freq: 0.55, cull: CULL.pen, gain: 0.42 })
  };
}

function mount(zi, name, geo, mat, cap) {
  const g = geo;
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
  const im = new THREE.InstancedMesh(g, mat, cap);
  // Preallocate the colour buffer too: setColorAt would otherwise allocate on first use.
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  im.castShadow = false; im.receiveShadow = false;
  im.frustumCulled = false;   // the field spans the zone; the depth band + range fade cull
  im.count = 0;
  zones[zi].add(im);
  IM[name] = im;
  return im;
}

function put(im, i, q, sx, sy, x, y, z, col, ph, amp, shrink, w) {
  _m.compose(_p.set(x, y, z), q, _s.set(sx, sy, sx));
  im.setMatrixAt(i, _m);
  im.setColorAt(i, col);
  const a = im.geometry.attributes.aInst.array;
  a[i * 4] = ph; a[i * 4 + 1] = amp; a[i * 4 + 2] = shrink; a[i * 4 + 3] = w;
}

function seal(im, n) {
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
  im.instanceColor.needsUpdate = true;
  im.geometry.attributes.aInst.needsUpdate = true;
}

function stand(n, blend, yaw) {
  _q2.setFromUnitVectors(UP, n);
  if (blend < 1) _q2.slerp(IDQ, 1 - blend);
  return _q2.multiply(_q.setFromAxisAngle(UP, yaw));
}

const CUR0 = 0.9;
const pick = (list, i, lo, hi) => _c.set(list[i % list.length]).multiplyScalar(rr(lo, hi));

export function buildGardens() {
  if (built) return;
  built = true;
  // (plants) the sculpted species sway in this program family: plantKit builds its batch
  // materials through gardenMat (one per adopted key, once, at asset arrival)
  setPlantMaterial(o => gardenMat(o));
  _ge = stream(0x6A4DE5);
  mats = makeMats();
  for (let zi = 0; zi < 3; zi++) { zones[zi] = new THREE.Group(); zones[zi].name = 'gardens' + zi; scene.add(zones[zi]); }
  PEN_SPEC = penSpec();

  mount(0, 'fan', seaFanGeo(), mats.fan, CAP.fan);
  mount(0, 'grass', seagrassGeo(), mats.grass, CAP.grass);
  mount(0, 'stag', staghornGeo(), mats.stag, CAP.stag);
  mount(0, 'barrel', barrelGeo(), mats.barrel, CAP.barrel);
  mount(0, 'anem', anemoneGeo(), mats.anem, CAP.anem);
  mount(1, 'worm', tubewormGeo(), mats.worm, CAP.worm);
  mount(1, 'mat', matGeo(), mats.mat, CAP.mat);
  mount(1, 'crin', crinoidGeo(), mats.crin, CAP.crin);
  mount(2, 'pen', seaPenGeo(), mats.pen, CAP.pen);
  mount(2, 'glass', glassGeo(), mats.glass, CAP.glass);
  mount(2, 'whip', whipGeo(), mats.whip, CAP.whip);
  penTips = mount(2, 'tip', penTipGeo(), mats.tip, CAP.pen);
  penTips.renderOrder = 2;

  layout();
}

export function reseedGardens() {
  if (!built) { buildGardens(); return; }
  layout();
}

// Layout: pure function of siteParams('gardens').rng + the current activeVents and
// flora colliders (themselves pure functions of the site). Writes in place.
function layout() {
  _gr = siteParams('gardens').rng;

  // ---- ZONE 0: the reef gardens -------------------------------------------
  {
    const zi = 0;
    const reef = reefSeeds(zi, 14, 5, 12, 0.42, 17.3);
    const field = fieldSeeds(zi, 22, 12, 30, 0.30, 44.1);
    const yaw = Math.atan2(Math.cos(CUR0), Math.sin(CUR0));
    let L = place(zi, CAP.fan, reef, 0.5, 0.97);
    let im = IM.fan;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.2, 3.2);
      put(im, i, stand(p.n, 0.4, yaw + rr(-0.5, 0.5) + (_gr() < 0.5 ? Math.PI : 0)), S * rr(0.85, 1.2), S,
        p.x, p.y - S * 0.04, p.z, pick(PAL.fan, i, 0.6, 1.1), _gr() * TAU, 0.3 / S, 0.3, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.grass, field.concat(reef), 0.8);
    im = IM.grass;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.6, 3.2), H = rr(1.2, 2.4);
      put(im, i, stand(p.n, 0.6, rr(0, TAU)), S, H, p.x, p.y - 0.04, p.z,
        pick(PAL.grass, i, 0.5, 1.0), _gr() * TAU, 0.22 / S, 0.25, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.stag, reef, 0.7);
    im = IM.stag;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.4, 3.6);
      put(im, i, stand(p.n, 0.5, rr(0, TAU)), S, S * rr(0.8, 1.3), p.x, p.y - S * 0.03, p.z,
        pick(PAL.stag, i, 0.6, 1.05), _gr() * TAU, 0.45 / S, 0.35, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.barrel, reef, 0.72);
    im = IM.barrel;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(0.7, 1.9);
      put(im, i, stand(p.n, 0.7, rr(0, TAU)), S, S * rr(0.9, 1.5), p.x, p.y - S * 0.05, p.z,
        pick(PAL.barrel, i, 0.6, 1.1), _gr() * TAU, 0.12 / S, 0.3, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.anem, reef, 0.72);
    im = IM.anem;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(0.9, 2.4);
      put(im, i, stand(p.n, 0.7, rr(0, TAU)), S, S * rr(0.85, 1.2), p.x, p.y - S * 0.05, p.z,
        pick(PAL.anem, i, 0.6, 1.1), _gr() * TAU, 0.22 / S, 0.3, _gr());
    }
    seal(im, L.length);
  }

  // ---- ZONE 1: the vent fields ---------------------------------------------
  {
    const zi = 1;
    const nV = Math.min(activeVents.length, 20);
    let wi = 0, mi = 0;
    const imW = IM.worm, imM = IM.mat;
    for (let v = 0; v < nV; v++) {
      const vt = activeVents[v], bR = Math.max(vt.baseR, 0.6);
      const nW = 3 + ((_gr() * 3) | 0);
      for (let k = 0; k < nW && wi < CAP.worm; k++) {
        const a = _gr() * TAU, r = bR + rr(0.3, 2.4);
        const x = vt.x + Math.cos(a) * r, z = vt.z + Math.sin(a) * r;
        if (nearWreck(zi, x, z)) continue;
        const y = terrainH(x, z, zi), S = rr(1.1, 2.2);
        put(imW, wi++, stand(terrainNormal(x, z, zi), 0.8, _gr() * TAU), S, S * rr(0.9, 1.3), x, y - 0.03, z,
          pick(PAL.worm, k, 0.85, 1.05), _gr() * TAU, 0.15 / S, 0.3, _gr());
      }
      const nM = 4 + ((_gr() * 4) | 0);
      for (let k = 0; k < nM && mi < CAP.mat; k++) {
        const a = _gr() * TAU, r = bR + rr(0.4, 6.5);
        const x = vt.x + Math.cos(a) * r, z = vt.z + Math.sin(a) * r;
        if (nearWreck(zi, x, z)) continue;
        const y = terrainH(x, z, zi), S = rr(1.2, 4.2);
        put(imM, mi++, stand(terrainNormal(x, z, zi), 1.0, _gr() * TAU), S, S * 0.6, x, y + 0.02, z,
          pick(PAL.mat, k, 0.8, 1.05), _gr() * TAU, 0, 0, _gr());
      }
    }
    seal(imW, wi);
    seal(imM, mi);

    // crinoids: on the crust around the vent clusters, a few out on the open floor
    const seeds = [];
    for (let v = 0; v < nV; v++) seeds.push([activeVents[v].x, activeVents[v].z, rr(6, 14)]);
    const fld = fieldSeeds(zi, 10, 10, 22, 0.32, 71.7);
    const L = place(zi, CAP.crin, seeds.concat(fld), 0.6);
    const im = IM.crin;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.0, 2.2);
      put(im, i, stand(p.n, 0.6, rr(0, TAU)), S, S * rr(0.9, 1.4), p.x, p.y - 0.02, p.z,
        pick(PAL.crin, i, 0.6, 1.05), _gr() * TAU, 0.2 / S, 0.3, _gr());
    }
    seal(im, L.length);
  }

  // ---- ZONE 2: the abyssal plain --------------------------------------------
  {
    const zi = 2;
    const reef = reefSeeds(zi, 6, 6, 14, 0.45, 91.3);
    const field = fieldSeeds(zi, 18, 14, 34, 0.30, 23.9);
    let L = place(zi, CAP.pen, field, 0.85);
    let im = IM.pen;
    const yaw = Math.atan2(Math.cos(CUR0), Math.sin(CUR0));
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(0.9, 2.2), H = S * rr(1.0, 1.6);
      const q = stand(p.n, 0.3, yaw + rr(-0.6, 0.6) + (_gr() < 0.5 ? Math.PI : 0)), ph = _gr() * TAU, w = _gr();
      const col = pick(PAL.pen, i, 0.55, 1.0);
      put(im, i, q, S, H, p.x, p.y - 0.02, p.z, col, ph, 0.28 / S, 0.3, w);
      put(penTips, i, q, S, H, p.x, p.y - 0.02, p.z, col, ph, 0.28 / S, 0.3, w);
    }
    seal(im, L.length);
    seal(penTips, L.length);

    L = place(zi, CAP.glass, reef.concat(field), 0.6);
    im = IM.glass;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.2, 2.6);
      put(im, i, stand(p.n, 0.6, rr(0, TAU)), S, S * rr(1.0, 1.7), p.x, p.y - 0.05, p.z,
        pick(PAL.glass, i, 0.7, 1.05), _gr() * TAU, 0.04 / S, 0.3, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.whip, reef.concat(field), 0.55);
    im = IM.whip;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(0.8, 1.6), H = rr(3.5, 8);
      put(im, i, stand(p.n, 0.5, rr(0, TAU)), S, H, p.x, p.y - 0.05, p.z,
        pick(PAL.whip, i, 0.6, 1.05), _gr() * TAU, 0.9 / S, H * 0.04, _gr());
    }
    seal(im, L.length);
  }

  // (plants) the sculpted species take these layouts over once their asset is in. Pure
  // bookkeeping: no stream draw, nothing about the layout above changes. The material
  // options mirror makeMats() (same sway / range / flinch); GD_SSS's emissive becomes the
  // lit SSSL, and the alpha / sculpt defines are added by plantKit.
  // (plants2) the deep and vent species: pens glow (all of them, quietly), a third of the whips
  plantAdopt('g_pen', 'pen', IM.pen, { cap: CAP.pen, bio: true, also: [penTips], mat: { sway: 1, freq: 0.55, cull: CULL.pen, sss: 0.3, def: ['SSSL', 'FLINCH'], bioCol: 0x2c9a8a, bioFrac: 1.01 } });
  plantAdopt('g_whip', 'whip', IM.whip, { cap: CAP.whip, bio: true, mat: { sway: 1, freq: 0.45, cull: CULL.whip, bioCol: 0x2a6fa0, bioFrac: 0.35 } });
  plantAdopt('g_mat', 'mat', IM.mat, { cap: CAP.mat, mat: { sway: 0, cull: CULL.mat } });
  plantAdopt('g_grass', 'grass', IM.grass, { cap: CAP.grass, mat: { sway: 1, freq: 1.2, cull: CULL.grass, sss: 0.4, def: ['SSSL', 'THIN'], trans: 0.9 } });
  plantAdopt('g_fan', 'fan', IM.fan, { cap: CAP.fan, mat: { sway: 1, freq: 0.8, cull: CULL.fan, sss: 0.4, def: ['SSSL'] } });
  plantAdopt('g_stag', 'stag', IM.stag, { cap: CAP.stag, mat: { sway: 1, freq: 0.5, cull: CULL.stag } });
  plantAdopt('g_barrel', 'barrel', IM.barrel, { cap: CAP.barrel, mat: { sway: 1, freq: 0.5, cull: CULL.barrel } });
  plantAdopt('g_anem', 'anem', IM.anem, { cap: CAP.anem, mat: { sway: 1, freq: 1.0, cull: CULL.anem, sss: 0.3, def: ['SSSL', 'FLINCH'] } });
  plantAdopt('g_worm', 'worm', IM.worm, { cap: CAP.worm, mat: { sway: 1, freq: 0.6, cull: CULL.worm, def: ['WORM'] } });
  plantAdopt('g_crin', 'crin', IM.crin, { cap: CAP.crin, bio: true, mat: { sway: 1, freq: 0.7, cull: CULL.crin, sss: 0.3, def: ['SSSL', 'FLINCH', 'BIOTIP'], bioCol: 0x3b8fb0, bioFrac: 0.3 } });
  plantAdopt('g_glass', 'glass', IM.glass, { cap: CAP.glass, mat: { sway: 1, freq: 0.4, cull: CULL.glass, sss: 0.4, def: ['SSSL'] } });
}

// ------------------------------------------------------------------ frame ----
export function updateGardens(dt, t) {
  if (!built) return;
  tickStir(dt, t);
  uni.uTime.value = t;
  // Base current (flora's slow-veering CUR0) plus the eased wind published by water.js,
  // so the gardens lean the way the undercurrent pushes Sal.
  const w = windState();
  const a = CUR0 + 0.5 * Math.sin(t * 0.055);
  const wk = clamp(w.speed * 0.6, 0, 0.6);
  uni.uCur.value.set(Math.cos(a) + w.dx * wk, Math.sin(a) + w.dz * wk);
  if (scene.fog) uni.uFogD.value = scene.fog.density;
  // Depth bands: flora.js:780's law — the zone(s) around the camera only.
  const y = camera.position.y, off = !!window.__noGardens;   // __noGardens = A/B kill switch
  for (let zi = 0; zi < 3; zi++)
    zones[zi].visible = !off && y < zoneTop(zi) + 120 && y > zoneBottom(zi) - 150;
  plantTick();   // (plants) after the gates: the batches mirror their hosts' visibility
}

// Debug surface: instance counts, tri counts per type, the meshes themselves.
window.__gardens = {
  counts: () => Object.fromEntries(Object.entries(IM).map(([k, m]) => [k, m.count])),
  tris: () => Object.fromEntries(Object.entries(IM).map(([k, m]) => [k, (m.geometry.index.count / 3) | 0])),
  meshes: IM
};
