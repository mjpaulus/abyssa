// Kelp forests, reef communities, eroded boulders. OWNED BY: flora agent.
// All motion happens in the vertex shader (instanced attributes), so updateFlora()
// costs only a handful of uniform writes regardless of instance count.
import * as THREE from 'three';
import { scene, camera, envTexDeep as envTex } from '../core.js';
import { WORLD_R, RIFT_R, riftPos, zoneTop, zoneBottom } from '../config.js';
import { rng, V3, clamp, fbm } from '../lib/math.js';
import { makeGlow, rockMapSet, bladeMapSet } from '../lib/textures.js';
import { registerPaint, styleTick, styleUniforms, injectStrokes, EDGE_GLSL } from '../lib/paint.js';
import { terrainH, terrainNormal, terrainMeshes } from './terrain.js';
import { wreckSites, driftSkirt, leeOf } from './wrecks.js';
import { siteParams } from './site.js';

const TAU = Math.PI * 2;

// Build-scoped random stream (THE CHART's reseed path). buildFlora()/reseedFlora()
// install a fresh `siteParams('flora').rng` here before touching anything else, so
// every placement/orientation/scale/shape call below becomes a pure function of the
// site instead of the latent Math.random() nondeterminism this used to run on.
// `scatter()` is the one exemption (see its own comment): it keeps lib/math.js's
// Math.random-backed `rng`, unchanged, for water.js's bubble vents.
let _fr = Math.random;
const rr = (a, b) => a + _fr() * (b - a);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = V3(0, 1, 0), IDQ = new THREE.Quaternion();
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Keep-out test against the zone's wreck site, so scatter never crowds the hulls.
// The sites are deterministic, so this works whether or not wrecks have built yet.
const WRECK_MARGIN = 4;
function nearWreck(zi, x, z) {
  const w = wreckSites()[zi];
  const d = w.clear + WRECK_MARGIN;
  return (x - w.x) * (x - w.x) + (z - w.z) * (z - w.z) < d * d;
}

// Rejection-sampled placement on the terrain, keeping clear of the rift funnel.
export function scatter(count, zi, minR, maxR) {
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 30) {
    const a = Math.random() * Math.PI * 2, r = rng(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rp = riftPos(zi);
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 2.6) continue;
    if (nearWreck(zi, x, z)) continue;
    pts.push(V3(x, terrainH(x, z, zi), z));
  }
  return pts;
}

// ---- 3D value noise, for eroding rock silhouettes ----
const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function n3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const u = (t => t * t * (3 - 2 * t))(x - X), v = (t => t * t * (3 - 2 * t))(y - Y), w = (t => t * t * (3 - 2 * t))(z - Z);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(h3(X, Y, Z), h3(X + 1, Y, Z), u), L(h3(X, Y + 1, Z), h3(X + 1, Y + 1, Z), u), v),
    L(L(h3(X, Y, Z + 1), h3(X + 1, Y, Z + 1), u), L(h3(X, Y + 1, Z + 1), h3(X + 1, Y + 1, Z + 1), u), v), w);
}

// ---------------------------------------------------------------- shaders ----
// Shared across every flora material so one write per frame animates the world.
const uni = { uTime: { value: 0 }, uCur: { value: new THREE.Vector2(1, 0) } };

const V_HEAD = `
attribute vec4 aVA;     // flex, normalised height, glow mask, part phase
attribute float aFlut;  // local flutter weight (blades, tentacles)
attribute vec4 aInst;   // phase, sway amp, arc-shorten k, glow
uniform float uTime; uniform vec2 uCur; uniform vec2 uCull;
uniform float uSway; uniform float uFreq;
varying vec3 vFlora; varying vec3 vLocal;
attribute vec2 aBU;     // blade uv (across, along + 1); (0,0) on every non-blade part
varying vec3 vBl;       // blade uv + the part's own phase
#ifdef FLORA_BLADE
  uniform float uRipple;
#endif
#ifdef FLORA_ROCK
  varying vec3 vWPos;
#endif`;

const V_BODY = `
vBl = vec3(aBU, aVA.w);
#ifdef FLORA_BLADE
  // EDGE RIPPLE: the margins of a blade flutter faster than the blade sways, on the
  // blade's own phase, growing toward the tip — the midrib holds, the lamina ruffles.
  if (aBU.y > 0.5) {
    float ea = abs(aBU.x - 0.5) * 2.0, al = aBU.y - 1.0;
    transformed += objectNormal * (sin(uTime * 2.3 + al * 17.0 + aVA.w * 5.0) * ea * ea * (0.3 + al) * uRipple);
  }
#endif
float w = uTime * uFreq + aInst.x;
float s1 = sin(w - aVA.y * 3.1), s2 = sin(w * 1.71 - aVA.y * 5.7 + 1.3);
vec2 d = (uCur * (0.34 + 0.66 * s1) + vec2(-uCur.y, uCur.x) * (0.4 * s2)) * (aInst.y * uSway * aVA.x);
transformed.xz += d;
transformed.y -= dot(d, d) * aInst.z;
#ifdef FLORA_FAN
  transformed.z += sin(uTime * 1.5 + transformed.x * 7.0 + aInst.x) * aVA.x * 0.1;
#endif
if (aFlut > 0.0) {
  float f = w * 2.2 + aVA.w;
  transformed += vec3(sin(f) * 0.7, cos(f * 1.31) * 0.5, sin(f * 0.73 + 2.1) * 0.7) * aFlut;
}
// Distance LOD: collapse the instance to a degenerate point well inside the fog wall.
vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
transformed *= 1.0 - smoothstep(uCull.x, uCull.y, distance(iw, cameraPosition));
vFlora = vec3(aVA.z * aInst.w, aVA.y, aInst.x);
vLocal = position;
#ifdef FLORA_ROCK
  vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif`;

const F_HEAD = `
uniform float uTime; uniform vec3 uGlowCol; uniform float uSSS; uniform vec3 uSilt;
varying vec3 vFlora; varying vec3 vLocal; varying vec3 vBl;
#ifdef FLORA_BLADE
  uniform sampler2D uBladePack, uBladeNrm; uniform float uTrans, uCut;
#endif
#ifdef FLORA_PIT
  // sponge skin: a cell field whose F1 minima are the pores (ostia)
  float pitCell(vec3 p) {
    vec3 i = floor(p), f = fract(p); float d = 9.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 h = fract(sin(vec3(dot(i + g, vec3(127.1, 311.7, 74.7)), dot(i + g, vec3(269.5, 183.3, 246.1)), dot(i + g, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
      vec3 r = g + h - f; d = min(d, dot(r, r));
    }
    return sqrt(d);
  }
#endif
#ifdef FLORA_ROCK
  varying vec3 vWPos;
  uniform sampler2D uRockPack, uRockNrm; uniform float uWet; uniform float uPaintK;
  uniform vec3 uCrustA, uCrustB; uniform float uMoss;
  ` + EDGE_GLSL + `
  // Coarse weathering field, no fetch: two bands of interfering sines.
  float rockDet(vec3 w, float f) {
    return sin(w.x * f) * sin(w.z * f * 1.13 + 1.7) + sin(w.y * f * 0.87 + 4.1) * 0.7;
  }
  // Triplanar (world-normal projected, sharpness 4) sample of the packed structure map.
  // Rocks are instanced with arbitrary rotations, so UVs cannot carry a tile; the
  // world position can, and it also makes neighbouring rocks share one stratum grain.
  vec4 rockTri(sampler2D t, vec3 p, vec3 bw, float f) {
    return texture2D(t, p.zy * f) * bw.x + texture2D(t, p.xz * f) * bw.y + texture2D(t, p.xy * f) * bw.z;
  }
  // Whiteout-blended tangent normals, same convention as lib/triplanar.js.
  vec3 rockNrm(vec3 p, vec3 n, vec3 bw, float f, float str) {
    vec3 tx = texture2D(uRockNrm, p.zy * f).xyz * 2.0 - 1.0;
    vec3 ty = texture2D(uRockNrm, p.xz * f).xyz * 2.0 - 1.0;
    vec3 tz = texture2D(uRockNrm, p.xy * f).xyz * 2.0 - 1.0;
    vec3 wx = vec3(tx.xy * str + n.zy, abs(tx.z) * n.x);
    vec3 wy = vec3(ty.xy * str + n.xz, abs(ty.z) * n.y);
    vec3 wz = vec3(tz.xy * str + n.xy, abs(tz.z) * n.z);
    return normalize(wx.zyx * bw.x + wy.xzy * bw.y + wz.xyz * bw.z);
  }
  // Screen-derivative relief: a procedural height evaluated in the fragment is turned
  // into a normal by its screen-space gradient against the surface's own dFdx/dFdy
  // frame. Costs no texture, needs no tangents. The caller fades height by a
  // fwidth-resolved guard so under-sampled detail never turns to sparkle at range.
  vec3 rockRelief(vec3 n, float height, float strength) {
    vec3 dx = dFdx(vWPos), dy = dFdy(vWPos), r1 = cross(dy, n), r2 = cross(n, dx);
    float det = dot(dx, r1);
    vec3 grad = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
    return normalize(max(abs(det), 0.0000001) * n - grad * strength);
  }
#endif`;

const F_BODY = `
float gmask = vFlora.x;
#ifdef FLORA_BLADE
  // THIN BLADE (polish-world): midrib + herringbone veins + bullate lamina from the
  // generated blade map (lib/textures.js bladeMapSet), applied as a derivative-frame
  // normal perturbation; the rib reads paler and yellower, the tip older and browner,
  // each blade shifts hue on its own phase, and the margin is cut into a ruffled,
  // tattered outline instead of a straight card edge. floraThin feeds the back-light
  // transmission term injected after the light loop. All taps and derivatives are
  // unconditional (non-blade parts mix back by isB).
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
    vec3 pn = normalize(T * (bn.x * sc * 0.35) + Bt * (bn.y * sc * 0.35) + normal * max(bn.z, 0.2));
    normal = normalize(mix(normal, pn, isB));
    float tip = smoothstep(0.62, 1.0, bu.y);
    float hueK = fract(sin(vBl.z * 12.9898) * 43758.5453);
    vec3 tint = mix(vec3(1.0), mix(vec3(0.92, 1.06, 0.86), vec3(1.14, 1.0, 0.72), hueK), 0.8);
    vec3 bc = diffuseColor.rgb * tint * mix(0.92, 1.10, bp.r);
    bc = mix(bc, bc * vec3(1.18, 1.06, 0.66), bp.r * 0.45 + tip * 0.55);
    bc *= 1.0 - 0.18 * bp.b;
    diffuseColor.rgb = mix(diffuseColor.rgb, bc, isB);
    float ea = abs(bu.x - 0.5) * 2.0;
    float edge = 0.95 - 0.16 * tip - 0.035 * sin(bu.y * 71.0 + vBl.z * 3.0) - 0.03 * sin(bu.y * 29.0 + vBl.z) - 0.05 * tip * sin(bu.y * 140.0);
    if (isB > 0.5 && uCut > 0.5 && ea > edge) discard;
    floraThin = isB * (1.0 - bp.g * 0.75);
  }
#endif
#ifdef FLORA_PIT
  {
    // pores: dark pits in a cell field on the local surface, the skin between them
    // slightly paler and rougher
    float cd = pitCell(vLocal * 38.0);
    float pore = 1.0 - smoothstep(0.10, 0.26, cd);
    diffuseColor.rgb *= 1.0 - 0.55 * pore;
    diffuseColor.rgb *= 0.92 + 0.16 * smoothstep(0.3, 0.7, cd);
    roughnessFactor = mix(roughnessFactor, 1.0, pore);
  }
#endif

#ifdef FLORA_ROCK
  // Silt (below) settles by the GEOMETRIC up, not the micro-normal: dusting every
  // up-facing pit of the relief turned wet stone into chalk.
  vec3 rockGeoN = normal;
  float rockCrust = 0.0;
  {
    // World normal for the projection; the perturbed result goes back to view space.
    vec3 wN = normalize(inverseTransformDirection(normal, viewMatrix));
    vec3 bw = pow(abs(wN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
    // Two incommensurate scales: grain/fissures at 1 tile per ~3.1 u, bedding at 1 per
    // ~13.7 u (offset so the coarse tile never lines up with the fine one).
    const float R_DET = 0.32, R_MAC = 0.073;
    vec4 pd = rockTri(uRockPack, vWPos, bw, R_DET);
    vec4 pc = rockTri(uRockPack, vWPos + vec3(7.3, 2.9, 5.1), bw, R_MAC);
    // Texture is STRUCTURE (mean 1.0), vertex/instance colour stays the hue authority.
    float albM = (pd.r * 1.6) * mix(1.0, pc.r * 1.6, 0.55);
    float rc = rockDet(vWPos, 0.42);
    float mott = 0.5 + 0.5 * sin(rc * 1.9);
    diffuseColor.rgb *= albM * mix(0.90, 1.08, mott);
    // POLISH-WORLD: CRUST on the faces that look up — coralline and lichen in the
    // shallows, a pale mineral/bacterial film in the deep — gated by the GEOMETRIC
    // slope and broken by the bake's own height and macro albedo, so it pools on the
    // ledges and bedding tops and never paints a face flat. MOSS (zone 0 only, uMoss)
    // lives down in the fissures: the bake's low height is the crack network itself.
    {
      float cn = pd.b * 0.65 + pc.r * 0.55 + 0.22 * sin(rc * 2.3);
      rockCrust = smoothstep(0.34, 0.78, wN.y) * smoothstep(0.50, 0.70, cn);
      vec3 crustC = mix(uCrustA, uCrustB, smoothstep(0.25, 0.85, mott)) * 1.35;
      diffuseColor.rgb = mix(diffuseColor.rgb, crustC * (0.7 + 0.6 * pd.r), rockCrust * 0.85);
      float crack = 1.0 - smoothstep(0.24, 0.40, pd.b);
      float mossM = uMoss * crack * smoothstep(-0.25, 0.35, wN.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.040, 0.066, 0.026) * (0.8 + 0.4 * mott), mossM * 0.75);
    }
    // Baked normal (whiteout triplanar) at both scales, then the derivative relief for
    // the last octave the texture cannot hold at walk-up: fine grit in the fragment.
    // EDGE-NOT-MIDDLE (lib/paint.js): every detail octave scales by the mid-tone
    // flattening of the GEOMETRIC normal, so grain lives at the shadow edge and
    // dissolves on the lit flank. ef == 1.0 at uEdgeK 0 (bit-identical).
    float ef = edgeFlat(wN);
    vec3 wN2 = rockNrm(vWPos, wN, bw, R_DET, 0.9 * ef);
    wN2 = normalize(mix(wN2, rockNrm(vWPos + vec3(7.3, 2.9, 5.1), wN, bw, R_MAC, 0.7 * ef), 0.35));
    float resolved = 1.0 - smoothstep(0.6, 3.0, length(fwidth(vWPos)) * 130.0);
    float fine = rockDet(vWPos, 9.5) * 0.5 + rockDet(vWPos, 23.0) * 0.25;
    wN2 = rockRelief(wN2, (fine * 0.012 + (pd.b - 0.5) * 0.02) * resolved, ef);
    normal = normalize((viewMatrix * vec4(wN2, 0.0)).xyz);
    // Roughness from the bake; wet sheen = a Fresnel-shaped roughness drop that only
    // exists near the camera (stone under the lantern is wet, stone at 20 u is fog).
    float rgh = mix(pd.g, pc.g, 0.4);
    float fr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
    float wet = uWet * (1.0 - smoothstep(5.0, 22.0, length(vViewPosition)));
    roughnessFactor = clamp(roughnessFactor * mix(0.72, 1.22, rgh) - wet * (0.16 + 0.22 * fr), 0.32, 1.0);
    // PAINT LAW floor for the shader-driven roughness (the material's own roughness is
    // already lifted by lib/paint.js; this keeps the wet sheen from undercutting it).
    roughnessFactor = max(roughnessFactor, 0.75 * uPaintK);
    // crust is dry lime and lichen: matte, it never takes the wet sheen
    roughnessFactor = mix(roughnessFactor, 0.97, rockCrust);
    diffuseColor.rgb *= 1.0 - 0.10 * wet;
  }
#endif
#ifdef FLORA_GROOVE
  float mn = sin(vLocal.x * 27.0 + sin(vLocal.z * 21.0 + vLocal.y * 15.0) * 2.4);
  // Reversed-edge smoothstep is UB (0.0 on this driver): the grooves never drew, and
  // gmask *= gr below silently killed ALL brain-coral bioluminescence with them.
  // 1.0 - smoothstep(lo, hi, x) is the defined form (see water.js foldK).
  float gr = 1.0 - smoothstep(0.0, 0.3, abs(mn));
  diffuseColor.rgb *= mix(1.0, 0.3, gr);
  roughnessFactor = mix(roughnessFactor, 1.0, gr * 0.7);
  gmask *= gr;
#endif
#ifdef FLORA_INNER
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.28;
#endif
#ifdef FLORA_SILT
  #ifdef FLORA_ROCK
    float up = inverseTransformDirection(rockGeoN, viewMatrix).y;
  #else
    float up = inverseTransformDirection(normal, viewMatrix).y;
  #endif
  diffuseColor.rgb = mix(diffuseColor.rgb, uSilt, smoothstep(0.4, 0.97, up) * 0.5);
  diffuseColor.rgb *= mix(0.4, 1.0, smoothstep(-0.85, 0.15, up));
#endif
#ifdef FLORA_SSS
  float fr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSSS * (0.18 + 0.82 * vFlora.y) * (0.3 + 0.7 * fr);
#endif
totalEmissiveRadiance += uGlowCol * gmask * (0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * 0.9 + vFlora.z * 3.0)));`;

// BACK-LIGHT TRANSMISSION for thin blades: sunlight arriving on the far side of the
// visible face comes THROUGH it, tinted by the blade and strongest when the eye looks
// toward the sun through the blade (forward scatter), thinner at the margins and
// between the veins than on the rib. Added to the direct diffuse after the light loop
// so it rides the key light's own colour and intensity (depth fade, day cycle, storm
// dim — lighting.js owns all of that); no new light. gardens.js injects the same term.
export const F_TRANS = `
#if defined( FLORA_BLADE ) || defined( GD_BLADE )
#if NUM_DIR_LIGHTS > 0
{
  vec3 tL = directionalLights[ 0 ].direction;
  vec3 tV = normalize(vViewPosition);
  float back = clamp(-dot(normal, tL), 0.0, 1.0);
  float fwd = pow(clamp(dot(tV, -tL), 0.0, 1.0), 3.0);
  float tk = back * (0.30 + 0.70 * fwd) * (0.35 + 0.65 * floraThin) * uTrans;
  reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 1.04, 0.80) * directionalLights[ 0 ].color * tk;
}
#endif
#endif`;

function floraMat(o) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0,
    side: o.side ?? THREE.FrontSide, flatShading: !!o.flat
  });
  if (o.env) { m.envMap = envTex; m.envMapIntensity = o.env; }
  m.defines = {};
  for (const d of o.def || []) m.defines['FLORA_' + d] = 1;
  if (o.blade) { m.defines.FLORA_BLADE = 1; m.forceSinglePass = true; }
  const cull = o.cull ?? 105;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni, {
      uCull: { value: new THREE.Vector2(cull * 0.8, cull) },
      uSway: { value: o.sway ?? 0 }, uFreq: { value: o.freq ?? 0.85 },
      uGlowCol: { value: new THREE.Color(o.glow ?? 0x000000) },
      uSSS: { value: o.sss ?? 0 },
      uSilt: { value: new THREE.Color(o.silt ?? 0x2c4152) }
    });
    if (o.blade) {
      const BS = bladeMapSet();
      Object.assign(sh.uniforms, { uBladePack: { value: BS.pack }, uBladeNrm: { value: BS.nrm },
        uTrans: { value: o.trans ?? 1 }, uRipple: { value: o.ripple ?? 0.02 }, uCut: { value: o.cut ?? 1 } });
    }
    if (o.rockSet) Object.assign(sh.uniforms, {
      uRockPack: { value: o.rockSet.pack }, uRockNrm: { value: o.rockSet.nrm }, uWet: { value: o.wet ?? 0 },
      uCrustA: { value: new THREE.Color(o.crustA ?? 0x000000) }, uCrustB: { value: new THREE.Color(o.crustB ?? 0x000000) },
      uMoss: { value: o.moss ?? 0 }
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + V_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + V_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + F_HEAD)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat floraThin = 0.0;\n{' + F_BODY + '\n}')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + F_TRANS);
    if (o.rockSet) Object.assign(sh.uniforms, { uEdgeK: styleUniforms.uEdgeK, uEdgeSun: styleUniforms.uEdgeSun, uPaintK: styleUniforms.uPaintK });
    else injectStrokes(sh);   // SILHOUETTE STROKES (lib/paint.js): organic flora only — never the rocks.
  };
  m.customProgramCacheKey = () => 'flora|' + o.key;
  return registerPaint(m);
}

// ------------------------------------------------------------- geometry ------
// Accumulates transformed primitives into one indexed buffer, tagging every vertex
// with the per-part data the sway/glow shaders read.
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
  done(fn) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 1; k < this.p.length; k += 3) { if (this.p[k] < lo) lo = this.p[k]; if (this.p[k] > hi) hi = this.p[k]; }
    const span = Math.max(1e-4, hi - lo);
    const col = new Float32Array(this.v * 3), va = new Float32Array(this.v * 4), fl = new Float32Array(this.v);
    const o = { c: [1, 1, 1], flex: 0, glow: 0, flut: 0, ph: 0 };
    for (let k = 0; k < this.v; k++) {
      const x = this.p[k * 3], y = this.p[k * 3 + 1], z = this.p[k * 3 + 2], h = (y - lo) / span;
      o.c[0] = o.c[1] = o.c[2] = 1; o.flex = h * h; o.glow = 0; o.flut = 0; o.ph = this.meta[k].ph || 0;
      fn(x, y, z, h, this.meta[k], o);
      col[k * 3] = o.c[0]; col[k * 3 + 1] = o.c[1]; col[k * 3 + 2] = o.c[2];
      va[k * 4] = o.flex; va[k * 4 + 1] = h; va[k * 4 + 2] = o.glow; va[k * 4 + 3] = o.ph;
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

function xf(px, py, pz, ry = 0, rz = 0, rx = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4().makeRotationY(ry);
  if (rz) m.multiply(new THREE.Matrix4().makeRotationZ(rz));
  if (rx) m.multiply(new THREE.Matrix4().makeRotationX(rx));
  m.scale(_s.set(sx, sy, sz));
  m.setPosition(px, py, pz);
  return m;
}

// Tapered tube on a Catmull-Rom path (gardens.js's idiom): each ring is scaled about
// its own centre from r0 to r1, so a tentacle reads grown, not extruded.
const _tv = new THREE.Vector3();
function taperTube(pts, segs, r0, r1, sides) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, segs, r0, sides, false);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const t = Math.floor(k / (sides + 1)) / segs;
    curve.getPointAt(t, _tv);
    const tp = 1 + (r1 / r0 - 1) * t;
    p.setXYZ(k, _tv.x + (p.getX(k) - _tv.x) * tp, _tv.y + (p.getY(k) - _tv.y) * tp, _tv.z + (p.getZ(k) - _tv.z) * tp);
  }
  g.computeVertexNormals();
  return g;
}

// Ribbon along +Y, tapering, curving toward +Z.
function strapGeo(h, w0, w1, curve, segs = 3) {
  const g = new THREE.PlaneGeometry(1, 1, 1, segs), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const u = p.getY(k) + 0.5, v = p.getX(k);
    p.setXYZ(k, v * (w0 + (w1 - w0) * u), u * h, curve * u * u);
  }
  g.computeVertexNormals();
  return g;
}

// Kelp blade: extends along +X, droops, ruffled edges (the twist reads as growth).
// POLISH-WORLD: 5 rows (was 4) and the last quarter CURLS — the tip rolls down and the
// lamina twists about the rib, the way an old blade's end frays and cups.
function bladeGeo(len, w0, w1, droop, segs = 5) {
  const g = new THREE.PlaneGeometry(1, 1, 1, segs), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const u = p.getY(k) + 0.5, v = p.getX(k);
    const w = w0 + (w1 - w0) * Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.72);
    const c = u > 0.7 ? (u - 0.7) / 0.3 : 0, tw = c * c * 0.9;
    const vw = v * w;
    p.setXYZ(k, u * len - c * c * len * 0.05, -droop * u * u + Math.sin(u * 13) * 0.02 * v - c * c * len * 0.10 + vw * Math.sin(tw), vw * Math.cos(tw));
  }
  g.computeVertexNormals();
  return g;
}

function kelpGeo() {
  const B = new Build();
  const stipe = new THREE.CylinderGeometry(0.035, 0.085, 1, 4, 9, true);
  B.add(stipe, xf(0, 0.5, 0), { t: 's' });
  B.add(new THREE.IcosahedronGeometry(0.17, 0), xf(0, 0.035, 0, 0, 0, 0, 1, 0.4, 1), { t: 'h' });
  // HOLDFAST: two haptera splayed out and down from the bulb, gripping
  // the rock or sand (deterministic angles: no stream draws, flora's layout holds)
  {
    const hap = new THREE.ConeGeometry(0.045, 0.30, 3, 1, true).translate(0, -0.15, 0);
    for (let k = 0; k < 2; k++) {
      const a = k * 3.1416 + 0.45;
      B.add(hap, xf(Math.cos(a) * 0.06, 0.05, Math.sin(a) * 0.06, -a, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(-1.05)), { t: 'h' });
    }
    hap.dispose();
  }
  const NB = 14;
  for (let i = 0; i < NB; i++) {
    const f = 0.1 + (i / NB) * 0.89, a = i * 2.399;
    // canopy bunching: blades lengthen toward the top, as giant kelp does at the surface
    const len = 0.85 * (0.45 + 0.75 * f) * rr(0.8, 1.15);
    const g = bladeGeo(len, 0.07, 0.17, len * 0.34);
    B.add(g, xf(Math.cos(a) * 0.05, f, Math.sin(a) * 0.05, -a, -0.42 + f * 0.75), { t: 'b', ph: _fr() * TAU, len, bu: true });
    g.dispose();
  }
  stipe.dispose();
  return B.done((x, y, z, h, m, o) => {
    const s = m.t === 'b' ? 0.42 + 0.58 * sstep(0.15, 1, h) : (m.t === 'h' ? 0.2 : 0.24 + 0.38 * h);
    o.c[0] = s * 0.86; o.c[1] = s; o.c[2] = s * 0.6;
    o.flex = m.t === 'h' ? 0 : h * h;
    o.flut = m.t === 'b' ? 0.09 * clamp((Math.hypot(x, z) - 0.06) / m.len, 0, 1) : 0;
    o.glow = m.t === 'b' ? sstep(0.5, 1, h) : 0;
  });
}

function grassGeo() {
  const B = new Build();
  for (let i = 0; i < 7; i++) {
    // width varies blade to blade (a golden-ratio walk, not a stream draw)
    const wk = 0.55 + 0.9 * ((i * 0.618 + 0.3) % 1);
    const a = rr(0, TAU), g = strapGeo(rr(0.6, 1), 0.03 * wk, 0.012 * wk, rr(0.1, 0.34), 3);
    B.add(g, xf(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, a, rr(-0.22, 0.22)), { ph: _fr() * TAU, bu: true });
    g.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    const s = 0.35 + 0.65 * h, tp = sstep(0.62, 1, h);
    // the tip is older growth: paler and yellowed
    o.c[0] = s * (0.7 + 0.45 * tp); o.c[1] = s * (1 + 0.08 * tp); o.c[2] = s * (0.74 - 0.12 * tp);
    o.flut = 0.03 * h; o.glow = sstep(0.65, 1, h);
  });
}

function staghornGeo() {
  const B = new Build();
  const seg = new THREE.CylinderGeometry(0.62, 1, 1, 4, 1, false);
  seg.translate(0, 0.5, 0);
  const grow = (base, len, rad, d) => {
    B.add(seg, base.clone().multiply(new THREE.Matrix4().makeScale(rad, len, rad)), { d });
    if (d >= 2) return;
    const n = d === 0 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const b = base.clone()
        .multiply(new THREE.Matrix4().makeTranslation(0, len * rr(0.7, 0.97), 0))
        .multiply(new THREE.Matrix4().makeRotationY(i / n * TAU + rr(0, 1.3)))
        .multiply(new THREE.Matrix4().makeRotationX(rr(0.35, 0.8)));
      grow(b, len * rr(0.6, 0.8), rad * 0.68, d + 1);
    }
  };
  grow(new THREE.Matrix4(), 0.42, 0.07, 0);
  seg.dispose();
  return B.done((x, y, z, h, m, o) => {
    const t = clamp(m.d * 0.3 + h * 0.55, 0, 1), s = 0.3 + 0.7 * t;
    o.c[0] = s; o.c[1] = s * 0.9; o.c[2] = s * 0.93;
    o.flex = h * h * 0.6; o.glow = sstep(0.7, 1, t);
  });
}

// Flat gorgonian lattice in the XY plane; ripples along local Z (see FLORA_FAN).
function fanGeo() {
  const B = new Build();
  const grow = (x, y, ang, len, w, d) => {
    const g = strapGeo(len, w, w * 0.66, 0, 2);
    const m = new THREE.Matrix4().makeRotationZ(ang);
    m.setPosition(x, y, 0);
    B.add(g, m, { d, bu: true });
    g.dispose();
    if (d >= 3) return;
    const tx = x - Math.sin(ang) * len, ty = y + Math.cos(ang) * len, n = d === 0 ? 3 : 2;
    for (let i = 0; i < n; i++)
      grow(tx, ty, ang + (i - (n - 1) / 2) * rr(0.34, 0.62), len * rr(0.62, 0.8), w * 0.78, d + 1);
  };
  grow(0, 0, 0, 0.38, 0.03, 0);
  return B.done((x, y, z, h, m, o) => {
    const s = 0.32 + 0.68 * h;
    o.c[0] = s; o.c[1] = s * 0.86; o.c[2] = s * 0.88;
    o.glow = sstep(0.55, 1, h);
  });
}

function brainGeo() {
  const g = new THREE.SphereGeometry(0.5, 16, 9), p = g.attributes.position, sd = rr(0, 90);
  for (let k = 0; k < p.count; k++) {
    let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const d = 1 + 0.24 * (n3(x * 5 + sd, y * 5, z * 5 + sd) - 0.5) + 0.1 * (n3(x * 11, y * 11, z * 11) - 0.5);
    p.setXYZ(k, x * d, Math.max(y * d * 0.62, -0.2), z * d);
  }
  g.computeVertexNormals();
  const B = new Build().add(g, xf(0, 0.2, 0));
  g.dispose();
  return B.done((x, y, z, h, m, o) => {
    const s = 0.5 + 0.5 * h;
    o.c[0] = s; o.c[1] = s * 0.95; o.c[2] = s * 0.86;
    o.flex = 0; o.glow = 1;
  });
}

function spongeGeo() {
  const B = new Build();
  for (let i = 0; i < 5; i++) {
    const a = rr(0, TAU), r = rr(0.02, 0.15), hh = rr(0.45, 1), rad = rr(0.055, 0.1);
    const t = new THREE.CylinderGeometry(rad * 0.92, rad * 0.66, hh, 7, 2, true);
    t.translate(0, hh / 2, 0);
    B.add(t, xf(Math.cos(a) * r, 0, Math.sin(a) * r, 0, rr(-0.2, 0.2)), { top: hh });
    t.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    const s = 0.4 + 0.6 * h;
    o.c[0] = s; o.c[1] = s * 0.82; o.c[2] = s * 0.9;
    o.flex = h * h; o.glow = sstep(0.82, 1, y / m.top);
    // OSCULUM: the exhalant opening's rim is paler (bleached lip); pores are per-pixel
    const rim = sstep(0.93, 1, y / m.top);
    o.c[0] *= 1 + 0.3 * rim; o.c[1] *= 1 + 0.22 * rim; o.c[2] *= 1 + 0.18 * rim;
  });
}

function anemoneGeo() {
  const B = new Build();
  const col = new THREE.CylinderGeometry(0.17, 0.13, 0.3, 8, 1, true);
  col.translate(0, 0.15, 0);
  B.add(col, xf(0, 0, 0), { t: 'c' });
  const disc = new THREE.SphereGeometry(0.17, 8, 3, 0, TAU, 0, Math.PI * 0.5);
  B.add(disc, xf(0, 0.28, 0, 0, 0, 0, 1, 0.4, 1), { t: 'c' });
  for (let i = 0; i < 14; i++) {
    const ring = i < 8 ? 0 : 1, a = (i - (ring ? 8 : 0)) / (ring ? 6 : 8) * TAU + ring * 0.4;
    const r = ring ? 0.08 : 0.15, len = rr(0.3, 0.5);
    // POLISH-WORLD: a real TUBE along the strap's old centreline (same draws, same
    // order: len, curve, tilt, phase), tapering to a blunt tip
    const cv = rr(0.04, 0.18);
    // outer ring as tubes (the silhouette), inner ring stays ribbons (budget)
    const g = ring ? strapGeo(len, 0.026, 0.006, cv, 3) : taperTube([V3(0, 0, 0), V3(0, len * 0.5, cv * 0.3), V3(0, len * 0.95, cv * 1.0)], 2, 0.030, 0.011, 3);
    // same draw, remapped: a CROWN (tentacles rise then curl out), not an urchin's spines
    const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(0.12 + (rr(0.45, 1.15) - 0.45) * 0.55));
    m.setPosition(Math.sin(a) * r, 0.3, Math.cos(a) * r);
    B.add(g, m, { t: 't', ph: _fr() * TAU, bx: Math.sin(a) * r, by: 0.3, bz: Math.cos(a) * r, len });
    g.dispose();
  }
  // MOUTH: a raised oral lip round a dark slit, at the centre of the disc
  const lip = new THREE.TorusGeometry(0.05, 0.014, 3, 7).rotateX(Math.PI / 2);
  B.add(lip, xf(0, 0.335, 0, 0, 0, 0, 1, 1, 0.7), { t: 'm' });
  lip.dispose();
  col.dispose(); disc.dispose();
  return B.done((x, y, z, h, m, o) => {
    if (m.t === 't') {
      const u = clamp(Math.hypot(x - m.bx, y - m.by, z - m.bz) / m.len, 0, 1);
      const s = 0.45 + 0.55 * u;
      o.c[0] = s; o.c[1] = s * 0.95; o.c[2] = s;
      o.flex = u * u; o.flut = 0.05 * u; o.glow = sstep(0.35, 1, u);
    } else if (m.t === 'm') {
      o.c[0] = 0.72; o.c[1] = 0.62; o.c[2] = 0.62; o.flex = 0; o.glow = 0.3;
    } else if (m.t === 's') {
      o.c[0] = 0.10; o.c[1] = 0.07; o.c[2] = 0.08; o.flex = 0;
    } else {
      const s = 0.3 + 0.3 * h;
      o.c[0] = s * 0.9; o.c[1] = s * 0.8; o.c[2] = s * 0.85;
      // the oral disc darkens into the mouth at its centre
      if (y > 0.28 && Math.hypot(x, z) < 0.05) { o.c[0] *= 0.3; o.c[1] *= 0.25; o.c[2] *= 0.28; }
      o.flex = 0;
    }
  });
}

// IcosahedronGeometry is non-indexed, so computeVertexNormals() on it yields FLAT
// normals no matter how fine the tessellation. Welding coincident vertices into an
// index buffer is what lets a rock read as smooth weathered stone instead of a gem.
function weld(g) {
  const p = g.attributes.position, map = new Map(), pos = [], idx = [];
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const key = `${Math.round(x * 8192)},${Math.round(y * 8192)},${Math.round(z * 8192)}`;
    let i = map.get(key);
    if (i === undefined) { i = pos.length / 3; map.set(key, i); pos.push(x, y, z); }
    idx.push(i);
  }
  const w = new THREE.BufferGeometry();
  w.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  w.setIndex(idx);
  return w;
}

// Eroded stone. `detail` sets the icosphere subdivision — PolyhedronGeometry emits
// 20*(detail+1)^2 triangles, so the tri budget is quadratic, not exponential.
// Displacement is four octaves: a low-frequency shape warp that breaks the sphere,
// mid-frequency erosion lobes, then two fine grains that survive smooth shading.
function rockGeo(detail, squash, amp, facet = 1) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const g = weld(ico);
  ico.dispose();
  const p = g.attributes.position, sd = rr(0, 90), sd2 = rr(0, 90);
  // Cleavage: three flat faces whose orientation and depth are pure functions of the
  // two seeds already drawn above (NO extra stream draws — the site fingerprint
  // downstream of this call must not move). Each is a plane at distance c from the
  // centre; anything the erosion pushes past it is pressed back onto the plane, so
  // boulders carry a few faceted faces and ledges instead of reading as pure blobs.
  const planes = [];
  for (let k = 0; k < 3; k++) {
    const th = n3(sd * 0.37 + k * 5.1, 0.5, k * 2.3) * TAU;
    const ph = (n3(k * 3.3, sd2 * 0.29, 0.5) - 0.5) * 1.5;
    const c = 0.80 + 0.16 * n3(k * 7.7, sd * 0.11, sd2 * 0.13);
    planes.push({ x: Math.cos(ph) * Math.cos(th), y: Math.sin(ph), z: Math.cos(ph) * Math.sin(th), c });
  }
  const bedF = 3.4 + 1.6 * n3(sd * 0.5, sd2 * 0.5, 1.5), bedPh = sd * 0.1;
  // FRESH BREAK (polish-world): how hard each vertex was pressed onto a cleavage plane.
  // A cleaved face is younger stone than the weathered rind — darker, cooler, less
  // stained — so it is written into the vertex colour below (no stream draws).
  const brk = new Float32Array(p.count);
  for (let k = 0; k < p.count; k++) {
    let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    // Shape warp: bend the sphere off-axis before eroding, so no two rocks share a silhouette.
    const wx = x + amp * 0.55 * (n3(x * 0.7 + sd2, y * 0.7, z * 0.7) - 0.5);
    const wz = z + amp * 0.55 * (n3(x * 0.7, y * 0.7, z * 0.7 + sd2) - 0.5);
    // Bedding: a soft square wave in local Y terraces the radius into ledges.
    const bed = Math.tanh(Math.sin(y * bedF + bedPh) * 2.6) * amp * 0.075 * facet * (1 - Math.abs(y) * 0.6);
    const d = 1
      + amp * 0.62 * (n3(wx * 1.15 + sd, y * 1.15, wz * 1.15 + sd) - 0.5)
      + amp * 0.40 * (n3(x * 2.6, y * 2.6 + sd, z * 2.6) - 0.5)
      + amp * 0.17 * (n3(x * 6.3 + sd2, y * 6.3, z * 6.3) - 0.5)
      + amp * 0.07 * (n3(x * 14.7, y * 14.7, z * 14.7 + sd) - 0.5)
      + bed;
    x = wx * d; z = wz * d; y = y * d;
    for (const pl of planes) {
      const dp = x * pl.x + y * pl.y + z * pl.z;
      if (dp > pl.c) {
        const t = (dp - pl.c) * facet; x -= pl.x * t; y -= pl.y * t; z -= pl.z * t;
        brk[k] = Math.max(brk[k], Math.min(1, t * 9));
      }
    }
    y *= squash;
    // Flatten the underside on a smooth ramp (no crease) so the rock beds into the silt.
    y *= 1 - 0.78 * sstep(-0.42, -0.95, y);
    p.setXYZ(k, x, y, z);
  }
  g.computeVertexNormals();
  const B = new Build().add(g, xf(0, 0, 0));
  g.dispose();
  const out = B.done((x, y, z, h, m, o) => {
    // Broad mineral banding only — fine mottling is done per-pixel in FLORA_ROCK.
    const mot = 0.86 + 0.2 * n3(x * 1.3 + 11, y * 1.3, z * 1.3);
    const s = mot * (0.62 + 0.38 * h);
    o.c[0] = s * 0.96; o.c[1] = s; o.c[2] = s * 1.04;
    o.flex = 0;
  });
  // Single add, so the vertex order is the icosphere's: brk[k] lines up with colour k.
  const col = out.attributes.color.array;
  for (let k = 0; k < brk.length; k++) {
    const b = brk[k], d = 1 - 0.34 * b;
    col[k * 3] *= d * (1 - 0.04 * b); col[k * 3 + 1] *= d; col[k * 3 + 2] *= d * (1 + 0.05 * b);
  }
  return out;
}

// -------------------------------------------------------------- placement ----
function seedClusters(zi, n, minR, maxR, seed, thresh, radLo, radHi) {
  const out = [], rp = riftPos(zi);
  let guard = 0;
  while (out.length < n && guard++ < n * 70) {
    const a = _fr() * TAU, r = rr(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 3) continue;
    if (guard < n * 35 && fbm(x * 0.011 + seed, z * 0.011 - seed) < thresh) continue;
    if (out.some(s => Math.hypot(s[0] - x, s[1] - z) < radLo * 1.05)) continue;
    out.push([x, z, rr(radLo, radHi)]);
  }
  return out;
}

// Clumped sampling with slope gating; relaxes the slope limit if the terrain
// shape starves a species, so a terrain rewrite can never empty the world.
function place(zi, count, seeds, minSlope, maxSlope = 1.01) {
  const out = [], rp = riftPos(zi);
  if (!seeds.length) return out;
  let lo = minSlope, guard = 0, relaxed = false;
  while (out.length < count && guard++ < count * 40) {
    if (!relaxed && guard > count * 18) { relaxed = true; lo = 1 - (1 - lo) * 2.4; }
    const s = seeds[(_fr() * seeds.length) | 0];
    const a = _fr() * TAU, u = Math.pow(_fr(), 0.8);
    if (_fr() < u * 0.5) continue;
    const x = s[0] + Math.cos(a) * s[2] * u, z = s[1] + Math.sin(a) * s[2] * u;
    const r = Math.hypot(x, z);
    if (r > WORLD_R * 0.98 || r < 10) continue;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 2.4) continue;
    if (nearWreck(zi, x, z)) continue;
    const n = terrainNormal(x, z, zi);
    if (n.y < lo || n.y > maxSlope) continue;
    out.push({ x, z, y: terrainH(x, z, zi), n });
  }
  return out;
}

// ------------------------------------------------------------------ build ----
const PAL = [
  // Rock albedo is deliberately dark: wet stone under a lantern reads by specular
  // highlight, not by brightness. Lighter values made boulders look like pale ice.
  { kelp: [0x3f7a4e, 0x6b7a35, 0x2f6b52, 0x53703f], reef: [0xd8705a, 0xdba055, 0x7fb8c8, 0xc85f7a], glow: 0x5cffc4, silt: 0x2c3d4a, rock: 0x30444d, turfWarm: [0xa8894a, 0x8f7a3a, 0x9a6b35, 0x6b7a35] },
  { kelp: [0x6b4f8c, 0x8a5f96, 0x4a4480, 0x7a4a6e], reef: [0xc060c8, 0x9a5ad8, 0xe07ab0, 0x60c8d8], glow: 0xa878ff, silt: 0x342c47, rock: 0x3a3048, turfWarm: [0x6e5d4a, 0x5a5f45, 0x715a3f, 0x4a4480] },
  { kelp: [0x8c5039, 0x9c6136, 0x7a4030, 0x8a3f45], reef: [0xe0603a, 0xd8a03a, 0xc83a5a, 0xe08a4a], glow: 0xff9455, silt: 0x3e2d26, rock: 0x473633, turfWarm: [0x8a5c35, 0x7a4a30, 0x6b503a, 0x8c5039] }
];

export const kelp = { inst: null, data: [], meshes: [] };

// Sphere colliders for boulders big enough to swallow the camera. The camera probe in
// game.js tests these; pebbles and debris are deliberately excluded to keep it cheap.
export const rockColliders = [];
const zones = [];

function mount(zi, geo, mat, n, shadow, cast) {
  n = Math.max(1, n);
  const g = geo.clone();
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  const im = new THREE.InstancedMesh(g, mat, n);
  im.receiveShadow = !!shadow;
  // Boulders and hero rocks cast into the seabed sun shadow (lighting.js re-aims the
  // sun's box over the zone-0 floor). Rocks have no sway (aInst.y = 0), so three's
  // instanced depth material draws them exactly where the lit pass does; the far cull
  // scale is the only term it lacks, and that only ever affects rocks past 420 u.
  im.castShadow = !!cast;
  im.frustumCulled = false;
  zones[zi].add(im);
  return im;
}

function put(im, i, q, sx, sy, x, y, z, col, ph, amp, shrink, glow) {
  _m.compose(_p.set(x, y, z), q, _s.set(sx, sy, sx));
  im.setMatrixAt(i, _m);
  im.setColorAt(i, col);
  const a = im.geometry.attributes.aInst.array;
  a[i * 4] = ph; a[i * 4 + 1] = amp; a[i * 4 + 2] = shrink; a[i * 4 + 3] = glow;
}

function seal(im, n) {
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.geometry.attributes.aInst.needsUpdate = true;
}

// Rotation that stands a prop up on the local slope, blended toward vertical.
function stand(n, blend, yaw) {
  _q2.setFromUnitVectors(UP, n);
  if (blend < 1) _q2.slerp(IDQ, 1 - blend);
  return _q2.multiply(_q.setFromAxisAngle(UP, yaw));
}

const CUR0 = 0.9;

// Per-zone material sets, built ONCE and reused across every reseed. Materials (and
// the texture/env-map refs they hold) are site-INVARIANT — only geometry/placement is
// re-rolled per site — so keeping them alive is what buys zero shader recompiles on
// reseed; three.js recompiles a program the first time a NEW material/defines combo
// hits the GPU, not on repeated use of an existing one.
let zoneMats = null;
function buildZoneMats() {
  return PAL.map((P, zi) => {
    const RS = rockMapSet(zi === 0 ? 0 : 1), WET = [0.9, 0.4, 0.12][zi];
    // crust A/B (linear-ish, in the rocks' own dark albedo range) and fissure moss
    const CR = [[0x5a3a46, 0x55523a, 1], [0x4a4452, 0x3c3c46, 0], [0x5a3e2c, 0x463a30, 0]][zi];
    const RX = { crustA: CR[0], crustB: CR[1], moss: CR[2] };
    return {
    kelp: floraMat({ key: 'kelp', side: THREE.DoubleSide, rough: 0.72, sway: 1, freq: 0.7, cull: 130, sss: 0.38, glow: P.glow, def: ['SSS'], blade: true, trans: 1.3, ripple: 0.018 }),
    grass: floraMat({ key: 'grass', side: THREE.DoubleSide, rough: 0.8, sway: 1, freq: 1.15, cull: 85, sss: 0.4, glow: P.glow, def: ['SSS'], blade: true, trans: 0.9, ripple: 0.006 }),
    stag: floraMat({ key: 'stag', rough: 0.62, sway: 1, freq: 0.55, cull: 105, glow: P.glow, env: 0.14 }),
    fan: floraMat({ key: 'fan', side: THREE.DoubleSide, rough: 0.7, sway: 1, freq: 0.8, cull: 105, sss: 0.55, glow: P.glow, def: ['SSS', 'FAN'], blade: true, trans: 1.0, ripple: 0, cut: 0 }),
    brain: floraMat({ key: 'brain', rough: 0.66, sway: 0, cull: 105, glow: P.glow, env: 0.16, def: ['GROOVE'] }),
    sponge: floraMat({ key: 'sponge', side: THREE.DoubleSide, rough: 0.78, sway: 1, freq: 0.65, cull: 100, glow: P.glow, def: ['INNER', 'PIT'] }),
    anem: floraMat({ key: 'anem', side: THREE.DoubleSide, rough: 0.55, sway: 1, freq: 1.0, cull: 90, sss: 0.35, glow: P.glow, def: ['SSS'] }),
    // Rock structure: a generated map set (lib/textures.js rockMapSet) projected
    // triplanar by world normal, multiplied INTO the zone hue below. Zone 0 gets the
    // weathered basalt/limestone bake and a wet sheen; the two deep zones share the
    // darker, more fissured, mineral-crusted variant and go matte.
    rock: floraMat({ key: 'rock', flat: false, rough: 0.88, metal: 0.03, sway: 0, cull: 175, env: 0.12, silt: P.silt, def: ['SILT', 'ROCK'], rockSet: RS, wet: WET , ...RX }),
    // Boulder / hero-landmark tiers keep the same 'rock' program cache key — three.js
    // compiles ONE program for all three and only the uCull uniform differs. Bigger
    // silhouettes earn longer sightlines: culling a 20-unit landmark at 175 left the
    // clear-band seabed (456/477-unit sightlines in zones 1/2) reading as empty sand.
    // The deep variant is a different TEXTURE on the same shader source, so the three
    // zones share that program too (sampler uniforms are per material, never per
    // program) — distinct keys are only needed when the compiled source differs.
    rockB: floraMat({ key: 'rock', flat: false, rough: 0.88, metal: 0.03, sway: 0, cull: 300, env: 0.12, silt: P.silt, def: ['SILT', 'ROCK'], rockSet: RS, wet: WET , ...RX }),
    rockH: floraMat({ key: 'rock', flat: false, rough: 0.88, metal: 0.03, sway: 0, cull: 420, env: 0.12, silt: P.silt, def: ['SILT', 'ROCK'], rockSet: RS, wet: WET , ...RX })
  }; });
}

// Tears down everything the previous build put in the scene/accumulators, WITHOUT
// touching zoneMats (site-invariant, see above) or the shared `uni` uniforms object.
function disposeFlora() {
  for (let zi = 0; zi < 3; zi++) {
    const grp = zones[zi];
    if (!grp) continue;
    for (const child of grp.children) {
      // Halo sprites (the bioluminescent-cluster glow) carry a UNIQUE SpriteMaterial
      // per build (their scale/opacity is placement-derived) — dispose it. Their
      // geometry is three.js's shared Sprite._geometry singleton; never dispose that.
      if (child.isSprite) child.material.dispose();
      // InstancedMesh geometry is `mount()`'s per-zone clone (see mount() below) —
      // always unique to this build, never shared, always safe/necessary to dispose.
      else if (child.geometry) child.geometry.dispose();
    }
    scene.remove(grp);
    zones[zi] = null;
  }
  // rockColliders' array IDENTITY is a contract with game.js/player.js/predators.js/
  // physics.js — they hold this reference forever, so truncate in place, never reassign.
  rockColliders.length = 0;
  // kelp{} is the other cross-build accumulator this file owns: data/meshes arrays
  // and the `inst` pointer all describe the build that disposeFlora() just tore down.
  kelp.data.length = 0;
  kelp.meshes.length = 0;
  kelp.inst = null;
}

function buildOnce() {
  // Fresh deterministic stream per build (THE CHART's contract): layout, orientation,
  // scale AND the procedural shapes below (kelp blades, rock erosion, ...) all read
  // through this one source, so the same site reseeds to the same forest, rock for
  // rock, bud for bud.
  const rng = siteParams('flora').rng;
  _fr = rng;
  if (!zoneMats) zoneMats = buildZoneMats();

  const G = {
    kelp: kelpGeo(), grass: grassGeo(), stag: staghornGeo(), fan: fanGeo(),
    brain: brainGeo(), sponge: spongeGeo(), anem: anemoneGeo(),
    // Tri counts are 20*(detail+1)^2: pebbles 320, boulders 980, heroes 3920 —
    // all per-geometry, shared across every instance of the tier.
    r0: rockGeo(3, 0.72, 0.70, 0.45), r1: rockGeo(6, 0.95, 0.78, 0.8), r2: rockGeo(13, 1.05, 0.64, 1.0)
  };

  for (let zi = 0; zi < 3; zi++) {
    const P = PAL[zi];
    zones[zi] = new THREE.Group();
    scene.add(zones[zi]);
    const M = zoneMats[zi];

    const forest = seedClusters(zi, 26, 22, WORLD_R * 0.9, zi * 11.3 + 3, 0.40, 11, 24);
    const reef = seedClusters(zi, 24, 16, WORLD_R * 0.92, zi * 7.7 + 31, 0.42, 6, 15);
    const field = seedClusters(zi, 30, 12, WORLD_R * 0.99, zi * 5.1 + 61, 0.28, 15, 36);
    const turf = forest.concat(reef, field);

    // ---- giant kelp: canopy giants plus a bushy understory ----
    {
      const L = place(zi, zi === 0 ? 560 : 430, forest, 0.84);
      const im = mount(zi, G.kelp, M.kelp, L.length);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], under = _fr() < 0.34;
        const H = under ? rr(2.6, 6.5) : rr(8, 21) * (0.8 + 0.4 * fbm(p.x * 0.03, p.z * 0.03));
        const W = under ? rr(1.9, 3.4) : rr(1.1, 2.3);
        const glow = _fr() < 0.12 ? rr(0.3, 0.85) : 0;
        _c.set(P.kelp[i % P.kelp.length]).multiplyScalar(rr(0.55, 1.15));
        put(im, i, stand(p.n, 0.35, rr(0, TAU)), W, H, p.x, p.y - 0.25, p.z,
          _c, _fr() * TAU, H * 0.1 / W, W * W / (2 * H * H) * 0.8, glow);
        kelp.data.push({ p: V3(p.x, p.y, p.z), h: H, zi });
      }
      seal(im, L.length);
      kelp.meshes.push(im);
      if (!kelp.inst) kelp.inst = im;
    }
    // ---- seagrass turf ----
    {
      const L = place(zi, [2600, 1500, 900][zi], turf, 0.72);
      const im = mount(zi, G.grass, M.grass, L.length);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], H = rr(0.9, 2.8), W = rr(0.9, 1.8);
        _c.set((_fr() < 0.5 ? P.turfWarm : P.kelp)[(i + 1) % 4]).multiplyScalar(rr(0.45, 0.95));
        put(im, i, stand(p.n, 0.6, rr(0, TAU)), W, H, p.x, p.y - 0.1, p.z,
          _c, _fr() * TAU, H * 0.16 / W, 0.2, _fr() < 0.07 ? rr(0.2, 0.6) : 0);
      }
      seal(im, L.length);
    }
    // ---- reef: staghorn / fans / brain / sponges / anemones ----
    const reefCol = i => _c.set(P.reef[i % P.reef.length]).multiplyScalar(rr(0.55, 1.1));
    {
      const L = place(zi, 220, reef, 0.7);
      const im = mount(zi, G.stag, M.stag, L.length, true);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(1.1, 4.2);
        put(im, i, stand(p.n, 0.5, rr(0, TAU)), S, S * rr(0.8, 1.4), p.x, p.y - S * 0.12, p.z,
          reefCol(i), _fr() * TAU, 0.6 / S, 0.35, _fr() < 0.14 ? rr(0.3, 0.8) : 0);
      }
      seal(im, L.length);
    }
    {
      const L = place(zi, 150, reef, 0.5, 0.95);
      const im = mount(zi, G.fan, M.fan, L.length);
      const yaw = Math.atan2(Math.cos(CUR0), Math.sin(CUR0));
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(1.4, 5);
        put(im, i, stand(p.n, 0.4, yaw + rr(-0.45, 0.45) + (_fr() < 0.5 ? Math.PI : 0)),
          S * rr(0.85, 1.25), S, p.x, p.y - S * 0.06, p.z,
          reefCol(i + 2), _fr() * TAU, 0.35 / S, 0.3, _fr() < 0.12 ? rr(0.25, 0.7) : 0);
      }
      seal(im, L.length);
    }
    {
      const L = place(zi, 110, reef, 0.72);
      const im = mount(zi, G.brain, M.brain, L.length, true);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(1.3, 4.6);
        put(im, i, stand(p.n, 0.75, rr(0, TAU)), S, S * rr(0.75, 1.1), p.x, p.y - S * 0.16, p.z,
          reefCol(i + 1), _fr() * TAU, 0, 0, _fr() < 0.3 ? rr(0.1, 0.45) : 0);
      }
      seal(im, L.length);
    }
    {
      const L = place(zi, 110, reef, 0.72);
      const im = mount(zi, G.sponge, M.sponge, L.length);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(1.2, 3.6);
        put(im, i, stand(p.n, 0.55, rr(0, TAU)), S, S * rr(1, 2), p.x, p.y - S * 0.08, p.z,
          reefCol(i + 3), _fr() * TAU, 0.3 / S, 0.3, _fr() < 0.18 ? rr(0.3, 0.9) : 0);
      }
      seal(im, L.length);
    }
    const lit = [];
    {
      const L = place(zi, 190, reef, 0.74);
      const im = mount(zi, G.anem, M.anem, L.length);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(0.7, 2.4);
        const glow = _fr() < 0.35 ? rr(0.4, 1.2) : 0;
        if (glow > 0.9 && lit.length < 6) lit.push([p, S]);
        put(im, i, stand(p.n, 0.7, rr(0, TAU)), S, S * rr(0.85, 1.2), p.x, p.y - S * 0.1, p.z,
          reefCol(i + 2), _fr() * TAU, 0.25 / S, 0.3, glow);
      }
      seal(im, L.length);
    }
    // Soft halos on the brightest polyp clusters — sells the bioluminescence at range.
    for (const [p, S] of lit) {
      const g = makeGlow(P.glow, S * 4.5);
      g.material.opacity = 0.16;
      g.position.set(p.x, p.y + S * 0.5, p.z);
      zones[zi].add(g);
    }
    // ---- rocks: pebbles, boulders, hero landmarks ----
    const fillets = [];   // x, z, footprint radius, size — for the sand fillets below
    for (const [geo, mat, cnt, sLo, sHi, sq] of [[G.r0, M.rock, 300, 0.5, 2.2, 0.34], [G.r1, M.rockB, 110, 2, 7, 0.3]]) {
      const L = place(zi, cnt, field.concat(reef), 0.42);
      const im = mount(zi, geo, mat, L.length, true, geo === G.r1);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(sLo, sHi) * (0.7 + 0.9 * fbm(p.x * 0.05 + 9, p.z * 0.05));
        _c.set(P.rock).multiplyScalar(rr(0.7, 1.25));
        put(im, i, stand(p.n, 0.85, rr(0, TAU)), S * rr(0.85, 1.3), S * rr(0.7, 1.1),
          p.x, p.y - S * sq, p.z, _c, 0, 0, 0, 0);
        if (S >= 2) rockColliders.push({ x: p.x, y: p.y - S * sq + S * 0.45, z: p.z, r: S * 0.95 });
        if (S >= 4 && geo === G.r1) fillets.push(p.x, p.z, _s.x * 0.9, S);   // _s = put()'s scale
      }
      seal(im, L.length);
    }
    {
      const L = place(zi, 10, field, 0.62);
      const im = mount(zi, G.r2, M.rockH, L.length + 60, true, true);
      let i = 0;
      for (const p of L) {
        const S = rr(8, 20);
        _c.set(P.rock).multiplyScalar(rr(0.75, 1.1));
        put(im, i++, stand(p.n, 0.6, rr(0, TAU)), S * rr(0.8, 1.25), S * rr(0.55, 0.95),
          p.x, p.y - S * 0.36, p.z, _c, 0, 0, 0, 0);
        rockColliders.push({ x: p.x, y: p.y - S * 0.36 + S * 0.4, z: p.z, r: S * 0.9 });
        fillets.push(p.x, p.z, _s.x * 0.86, S);
        // bed the landmark in with debris so it never reads as a floating prop
        for (let k = 0; k < 6 && i < L.length + 60; k++) {
          const a = rr(0, TAU), r = S * rr(0.7, 1.35), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
          if (nearWreck(zi, x, z)) continue;
          const s2 = S * rr(0.08, 0.22);
          _c.set(P.rock).multiplyScalar(rr(0.6, 1.1));
          put(im, i++, stand(terrainNormal(x, z, zi), 0.85, rr(0, TAU)), s2 * 1.2, s2,
            x, terrainH(x, z, zi) - s2 * 0.4, z, _c, 0, 0, 0, 0);
        }
      }
      seal(im, i);
    }
    mountFillets(zi, fillets);
  }
  for (const g of Object.values(G)) g.dispose();
}

// SAND FILLETS (polish-world): where a hero rock or a big boulder meets the floor the
// silt banks up against it — deeper on the lee of the current — instead of the stone
// simply intersecting a flat plane. One merged mesh per zone in WORLD space using the
// TERRAIN's own material and its exact mesh height/colour (wrecks.js driftSkirt), so
// the fillet IS seabed: same program, same caustics, same ripples, +1 draw per zone.
// Footprint wobble is a hash of position, never a stream draw (the flora stream and
// every fingerprint downstream of it are untouched).
function mountFillets(zi, F) {
  if (!terrainMeshes[zi] || !F.length) return;
  const NA = 16, NR = 3, parts = [];
  let nv = 0, ni = 0;
  for (let k = 0; k < F.length; k += 4) {
    const x = F[k], z = F[k + 1], R = F[k + 2], S = F[k + 3];
    const fp = new Float32Array(NA);
    for (let a = 0; a < NA; a++) fp[a] = R * (0.86 + 0.28 * n3(x * 0.37 + a * 0.61, z * 0.37, S));
    const H = Math.min(1.1, 0.07 * S + 0.12), Wd = 0.9 + 0.30 * S;
    const g = driftSkirt(zi, x, z, fp,
      a => H * (0.45 + 0.55 * leeOf(a / NA * TAU)),
      a => Wd * (0.55 + 0.75 * leeOf(a / NA * TAU)), 0.74, NR);
    parts.push(g); nv += g.attributes.position.count; ni += g.index.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    col.set(g.attributes.color.array, vo * 3);
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + vo;
    vo += g.attributes.position.count; io += ix.length;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.Mesh(geo, terrainMeshes[zi].material);
  m.receiveShadow = true;
  m.name = 'fillets' + zi;
  zones[zi].add(m);
}

// First boot: identical path to every prior version of this file (buildZoneMats()
// runs once here since zoneMats starts null; there is nothing yet to dispose).
export function buildFlora() {
  buildOnce();
}

// THE CHART's reseed hook: called when the player sails to another dive site, under
// the black screen, after terrain has already re-sampled. Tear down this build's
// geometry/instances/accumulators, keep the site-invariant materials, roll a fresh
// site-seeded stream, rebuild. Terrain reseeds itself (fillTerrain() in terrain.js);
// this is flora's half of the same contract.
export function reseedFlora() {
  disposeFlora();
  buildOnce();
}

export function updateFlora(dt, t) {
  uni.uTime.value = t;
  styleTick();   // the ONE per-frame poll of the style dial (lib/paint.js)
  const a = CUR0 + 0.5 * Math.sin(t * 0.055);
  uni.uCur.value.set(Math.cos(a), Math.sin(a));
  // Only the zone(s) around the camera are submitted; the rest cost nothing.
  const y = camera.position.y;
  for (let zi = 0; zi < 3; zi++)
    if (zones[zi]) zones[zi].visible = y < zoneTop(zi) + 120 && y > zoneBottom(zi) - 150;
}
