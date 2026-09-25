// Sunken wrecks: one per zone, each cradling a relic tool. OWNED BY: wreck agent.
//
// Three landmarks from the hard-hat era, all procedural: a capsized fishing skiff in
// the shallows, an iron trawler broken in two in the twilight, and a crushed
// submersible in the abyss. Every wreck is built once at load and baked down to a
// handful of merged meshes (one per material, diver.js's Part idiom), so a wreck
// costs ~6 draw calls no matter how many rivets, planks and net strands it carries.
//
// Motion is shader-side: silt dust drifting through the hulls and the net's sway read
// off one shared uTime uniform, so updateWrecks() only writes a few floats and pulses
// three relic sprites. No allocation happens after build.
//
// Contract with game.js:
//   buildWrecks()             — once at world build.
//   reseedWrecks(toolsOwned)  — THE CHART: dispose + rebuild against the site current at
//                               call time. toolsOwned = {sonar,spear,thruster} booleans;
//                               a relic whose tool is already owned builds pre-taken.
//                               wreckColliders is emptied and repushed IN PLACE (game.js/
//                               player.js hold the array reference, not a copy).
//   updateWrecks(dt, t)       — ambient animation (sway, dust, glow).
//   wreckColliders            — array of {x,y,z,r} spheres, same shape as rockColliders;
//                               game.js adds them to the camera probe and player push-out.
//   wreckSites()              — the 3 site records (flora's exclusion read); returns the
//                               NEW sites once reseedWrecks has run.
//   nearRelic(pos)            — {zi, tool} if the player is within reach of an untaken
//                               relic ('sonar'|'spear'|'thruster'), else null.
//   takeRelic(zi)             — claims it (hides the relic prop, plays local VFX); returns
//                               the tool name or null if already taken.
//   setKeepsakeState(taken3)  — CHART V2: this site's per-wreck keepsake taken flags.
//                               At remote sites builds/hides one small unbeaconed prop per
//                               wreck beside the relic berth. At the HOME MOORING (site 0)
//                               the skiff carries the one thing of HIS that is still
//                               aboard (taken3[0]); taken3[1..2] are ignored there.
//                               taken3 may be null/short (a save from before site 0 had
//                               a keepsake): a missing flag means untaken.
//   nearKeepsake(pos)         — {zi} within RELIC_REACH of a present, untaken keepsake,
//                               else {zi, mark:true} within reach of an unread MARK — the
//                               home mooring's three lines in his own hand (below).
//   takeKeepsake(zi)          — hides the keepsake and returns { line }; or, if the
//                               keepsake at zi is gone/absent and the mark is unread,
//                               reads the mark: returns { line, mark:true }. Marks are
//                               never consumed (the scratch stays on the hull) and never
//                               persisted — a reading, not a taking; once per build.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, camera, envTexDeep as envTex } from '../core.js';
import { WORLD_R, riftPos, zoneTop, zoneBottom } from '../config.js';
import { registerPaint } from '../lib/paint.js';
import { rng, clamp, fbm, V3 } from '../lib/math.js';
import { makeGlow, canvas2d, toTexture, noiseCanvas, normalFromHeight, seededRand, ironPlateSet } from '../lib/textures.js';
import { terrainH, terrainNormal, terrainMeshes } from './terrain.js';
import { player } from '../player.js';
import { siteParams, currentSiteIndex } from './site.js';
import { keepsakeKind, keepsakeGeo } from '../lib/keepsakes.js';

const TAU = Math.PI * 2;
const UP = V3(0, 1, 0);
const _o = new THREE.Object3D();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const IDQ = new THREE.Quaternion();
const _v = V3();

export const wreckColliders = [];

// Reach for the [E] prompt, and how far the relic's halo carries.
const RELIC_REACH = 4.2;

// One shared uniform block: the whole ambient layer animates off two writes per frame.
const uni = { uTime: { value: 0 }, uFogD: { value: 0.016 } };

// ---------------------------------------------------------------- textures ---
// One height field per material drives albedo, roughness and normal together, so wear
// lands in the crevices the normal map actually shows (same approach as diver.js).

function shade(ctx, S, hd, lo, hi, contrast) {
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const h = Math.pow(hd[i * 4] / 255, contrast);
    img.data[i * 4] = (lo[0] + (hi[0] - lo[0]) * h) * 255;
    img.data[i * 4 + 1] = (lo[1] + (hi[1] - lo[1]) * h) * 255;
    img.data[i * 4 + 2] = (lo[2] + (hi[2] - lo[2]) * h) * 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// Waterlogged planking: long grain, split seams, a scatter of worm bore.
function woodMaps(S = 256) {
  const hc = noiseCanvas(S, 4, 1.0);
  const h = hc.getContext('2d');
  h.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 260; i++) {           // grain runs along the plank (x)
    const y = Math.random() * S, l = rng(30, S);
    h.strokeStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.20)' : 'rgba(255,255,255,.13)';
    h.lineWidth = rng(0.6, 2.6);
    h.beginPath();
    const x0 = Math.random() * S;
    h.moveTo(x0, y);
    h.bezierCurveTo(x0 + l * 0.33, y + rng(-3, 3), x0 + l * 0.66, y + rng(-3, 3), x0 + l, y + rng(-2, 2));
    h.stroke();
  }
  for (let i = 0; i < 40; i++) {            // worm bore / rot pits
    const x = Math.random() * S, y = Math.random() * S, r = rng(1.5, 5);
    const gr = h.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
    h.fillStyle = gr; h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const { canvas, ctx } = canvas2d(S);
  shade(ctx, S, hd, [0.26, 0.205, 0.145], [0.78, 0.63, 0.42], 1.15);
  return {
    map: toTexture(canvas, 3, true),
    normalMap: toTexture(normalFromHeight(hc, 1.6), 3),
    // multiplier over the material's 0.96: bores and rot pits sit slick, raised grain dry
    roughnessMap: toTexture(roughFrom(hd, S, 0.80, 1.0), 3)
  };
}

// Roughness multiplier canvas from a height field: lo at the cavities, hi on the crests.
// The diver.js pattern — one height drives albedo, normal AND roughness, so the wet
// sheen lands in the same recesses the normal map actually shows.
function roughFrom(hd, S, lo, hi) {
  const { canvas, ctx } = canvas2d(S);
  const im = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = hd[i * 4] / 255;
    const g = Math.max(0, Math.min(255, (lo + (hi - lo) * v) * 255));
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = g;
    im.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return canvas;
}

// Sheet iron is lib/textures.js ironPlateSet() now (riveted plating, rust sources).

// Tarnished brass: fine turning marks with verdigris settled into the lows.
function brassMaps(S = 128) {
  const hc = noiseCanvas(S, 4, 1.0);
  const h = hc.getContext('2d');
  for (let i = 0; i < 120; i++) {
    const y = Math.random() * S;
    h.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.2)';
    h.lineWidth = rng(0.5, 1.4);
    h.beginPath(); h.moveTo(0, y); h.lineTo(S, y + rng(-2, 2)); h.stroke();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const { canvas, ctx } = canvas2d(S);
  shade(ctx, S, hd, [0.30, 0.31, 0.20], [1.0, 0.79, 0.36], 1.0);
  return {
    map: toTexture(canvas, 2, true), normalMap: toTexture(normalFromHeight(hc, 1.2), 2),
    // verdigris lows go matte-ish, polished turning crests keep the 0.42 shine
    roughnessMap: toTexture(roughFrom(hd, S, 1.0, 0.70), 2)
  };
}

// ---------------------------------------------------------------- materials --
// Silt settles on upward faces and downward faces fall away — the same trick props.js
// and flora.js use, so wrecks sit in the identical lantern-lit material family.
//
// POLISH-WORLD (2026-09): the one wreck shader now also carries
//   * GROWTH — an encrusting albedo mask (pale calcareous crust going to a brown-green
//     film) on every surface facing the light, plus a per-vertex band (aGrow) at each
//     hull's old waterline. Broken by two octaves of world-space value noise so it
//     reads as colonies, not paint. The barnacle geometry (buildGrowth) is scattered by
//     the same two terms, so the shells sit where the crust is.
//   * RUST STREAKS (iron only) — the plate set's alpha is a rust SOURCE mask (rivet
//     blooms, seam weep). The fragment finds world DOWN in the map's uv space from the
//     screen derivatives of world position and uv (a cotangent frame, no tangents
//     needed), then gathers that mask up-slope in six taps: every streak runs down the
//     hull along real gravity AFTER the wreck's roll and settle tilt, however the plate
//     happens to be mapped. textureGrad with the pre-branch derivatives, so there is no
//     implicit-derivative hazard anywhere in the gather.
//   * interior faces of the double-sided skins go dark (a hull is a cave).
// Geometric (non-perturbed) normal drives silt and growth: dusting every up-facing pit
// of a normal map turns iron to chalk (the flora rock lesson).
const V_WRECK_HEAD = `
attribute float aGrow;
varying float vGrow; varying vec3 vWPosW;`;
const V_WRECK_BODY = `
vGrow = aGrow;
vWPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const F_WRECK_HEAD = `
uniform vec3 uSilt, uGrowA, uGrowB; uniform float uGrowK, uStreakK;
varying float vGrow; varying vec3 vWPosW;
float wkHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wkNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wkHash(i), wkHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(wkHash(i + vec3(0.0, 1.0, 0.0)), wkHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(wkHash(i + vec3(0.0, 0.0, 1.0)), wkHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(wkHash(i + vec3(0.0, 1.0, 1.0)), wkHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}`;
const F_WRECK = `
vec3 wkN = normalize(inverseTransformDirection(nonPerturbedNormal, viewMatrix));
float up = wkN.y;
#ifdef WRECK_INNER
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.42;
#endif
#if defined( WRECK_STREAK ) && defined( USE_MAP )
{
  vec3 dpx = dFdx(vWPosW), dpy = dFdy(vWPosW);
  vec2 dux = dFdx(vMapUv), duy = dFdy(vMapUv);
  vec3 gN = cross(dpx, dpy);
  vec3 r1 = cross(dpy, gN), r2 = cross(gN, dpx);
  float det = dot(dpx, r1);
  det = sign(det) * max(abs(det), 1e-14) + (det == 0.0 ? 1e-14 : 0.0);
  vec3 gu = (r1 * dux.x + r2 * duy.x) / det;
  vec3 gv = (r1 * dux.y + r2 * duy.y) / det;
  // uv step per world unit of DESCENT (world down = -Y), projected onto the surface
  vec2 dn = -vec2(gu.y, gv.y);
  float L = length(dn);
  dn *= min(1.0, 3.0 / max(L, 1e-5));
  vec2 pr = vec2(-dn.y, dn.x) / max(length(dn), 1e-5);
  float lx = dot(vMapUv, pr);
  float lane = 0.5 + 0.5 * sin(lx * 173.0 + sin(lx * 41.0) * 2.3);
  float st = 0.0;
  for (int k = 1; k <= 6; k++) {
    float fk = float(k);
    st += textureGrad(map, vMapUv - dn * (0.17 * fk), dux, duy).a * (1.0 - fk / 7.5);
  }
  st = clamp(st * 0.40 * (0.35 + 0.65 * lane), 0.0, 1.0) * uStreakK * (1.0 - smoothstep(0.55, 0.95, abs(up)));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.30, 0.74, 0.52) + vec3(0.030, 0.010, 0.003), st);
  roughnessFactor = mix(roughnessFactor, 1.0, st * 0.5);
}
#endif
#ifdef WRECK_GROW
{
  float gn1 = wkNoise(vWPosW * 0.9), gn2 = wkNoise(vWPosW * 3.7 + 7.1), gn3 = wkNoise(vWPosW * 13.0 + 3.3);
  float upM = smoothstep(0.28, 0.85, up);
  float gw = max(vGrow, upM * 0.9) * uGrowK;
  // algal film: broad and soft, a TINT over the timber/iron, never a paint
  float film = smoothstep(0.25, 0.65, gw * (0.5 + 0.8 * gn1));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55 + uGrowB * 0.45, film * 0.55);
  // calcareous crust: colonies at a metre scale with speckled, eaten edges
  float crust = smoothstep(0.56, 0.70, gw * (0.25 + 0.70 * gn2 + 0.25 * gn1) + (gn3 - 0.5) * 0.14);
  vec3 cc = uGrowA * (0.70 + 0.55 * gn3);
  diffuseColor.rgb = mix(diffuseColor.rgb, cc, crust * 0.9);
  roughnessFactor = mix(roughnessFactor, 0.97, max(crust, film * 0.5));
  metalnessFactor = mix(metalnessFactor, 0.0, max(crust, film * 0.7));
}
#endif
diffuseColor.rgb = mix(diffuseColor.rgb, uSilt, smoothstep(0.30, 0.95, up) * 0.42);
diffuseColor.rgb *= mix(0.40, 1.0, smoothstep(-0.85, 0.25, up));`;

const SILT = [new THREE.Color(0x1d2a35), new THREE.Color(0x241e33), new THREE.Color(0x2b1e19)];
// Growth crust per zone: calcareous white-grey going to a brown-green film in the
// shallows; the deep zones get a paler, sparser mineral/bacterial crust.
const GROW_A = [new THREE.Color(0x7a766a), new THREE.Color(0x77727e), new THREE.Color(0x807466)];
const GROW_B = [new THREE.Color(0x2f3a24), new THREE.Color(0x3a3346), new THREE.Color(0x4a3a2e)];
const GROW_K = [1.0, 0.7, 0.55];

// kind: 'wood' | 'iron' | 'brass' | 'rope' | 'glass' | 'grow'. The program key is the
// KIND (never the zone): the three zones run identical source with different uniform
// values, so one program per kind is shared by all three (flora's rock idiom).
function siltify(m, zi, sway, kind = 'x', o = {}) {
  m.defines = m.defines || {};
  if (o.grow) m.defines.WRECK_GROW = 1;
  if (o.streak) m.defines.WRECK_STREAK = 1;
  if (o.inner) m.defines.WRECK_INNER = 1;
  m.onBeforeCompile = sh => {
    sh.uniforms.uSilt = { value: SILT[zi] };
    sh.uniforms.uGrowA = { value: GROW_A[zi] };
    sh.uniforms.uGrowB = { value: GROW_B[zi] };
    sh.uniforms.uGrowK = { value: GROW_K[zi] * (o.growK ?? 1) };
    sh.uniforms.uStreakK = { value: o.streakK ?? 1 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + V_WRECK_HEAD);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + F_WRECK_HEAD)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{' + F_WRECK + '\n}');
    if (sway) {
      sh.uniforms.uTime = uni.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Net strands hang from their anchors, so sway grows with how far a vertex sagged.
        float sag = max(-transformed.y, 0.0);
        float w = sag * sag * 0.055;
        transformed.x += sin(uTime * 0.55 + transformed.z * 0.7 + transformed.y) * w;
        transformed.z += cos(uTime * 0.41 + transformed.x * 0.6) * w * 0.8;`);
    }
    // Just before projection, so vWPosW is the final (swayed) position.
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', V_WRECK_BODY + '\n#include <project_vertex>');
  };
  m.customProgramCacheKey = () => 'wreck|' + kind + '|' + (sway ? 1 : 0);
  return m;
}

// The lit porthole glass/ember: emissive modulated by the vertex colour, so the grime
// baked into the disc's vertices darkens the light itself, not only the surface.
function litify(m) {
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif');
  };
  m.customProgramCacheKey = () => 'wreck|lit';
  return m;
}

// Height maps AND the material sets built from them are site-invariant — a reseed
// changes the floor and the decorative rng, never the hull's paint. Cache both per zone
// so reseedWrecks rebuilds geometry only: zero texture regeneration, zero shader
// recompiles (customProgramCacheKey would dedupe the compile anyway, but reusing the
// instances outright means there is never a second material to key against).
let MAPS = null;
const PALETTES = new Map();
// Plate repeat per zone: hull uvs run u*4 along, v*2 around, so this sets the tile to
// roughly 2.5 u of hull per plate pair (trawler) and a tighter weave on the sphere.
const PLATE_REP = [2.0, 2.5, 3.2];
function plateMaps(zi) {
  const P = ironPlateSet();
  const rep = t => { const c = t.clone(); c.repeat.set(PLATE_REP[zi], PLATE_REP[zi]); c.needsUpdate = true; return c; };
  return { map: rep(P.map), normalMap: rep(P.nrm), roughnessMap: rep(P.pack) };
}
function palette(zi) {
  if (PALETTES.has(zi)) return PALETTES.get(zi);
  if (!MAPS) MAPS = { wood: woodMaps(), brass: brassMaps() };
  const std = o => new THREE.MeshStandardMaterial(o);
  const P = {
    wood: siltify(std({
      color: zi === 0 ? 0xffffff : 0xd8cec0, roughness: 0.96, metalness: 0.02,
      vertexColors: true, side: THREE.DoubleSide, ...MAPS.wood
    }), zi, false, 'wood', { grow: true, inner: true }),
    iron: siltify(std({
      color: zi === 2 ? 0xf2e6da : 0xffffff, roughness: 0.92, metalness: 0.34,
      vertexColors: true, side: THREE.DoubleSide, envMap: envTex, envMapIntensity: 0.18,
      normalScale: new THREE.Vector2(0.95, 0.95),
      ...plateMaps(zi)
    }), zi, false, 'iron', { grow: true, streak: true, inner: true }),
    brass: siltify(std({
      color: 0xfff0d0, roughness: 0.42, metalness: 0.88, vertexColors: true,
      envMap: envTex, envMapIntensity: 0.9, ...MAPS.brass
    }), zi, false, 'brass', { grow: true, growK: 0.45 }),
    rope: siltify(std({
      color: 0xb4a888, roughness: 1.0, metalness: 0.0, vertexColors: true
    }), zi, true, 'rope', { grow: true, growK: 0.6 }),
    glass: siltify(std({
      // dark, grimed glass: a faint cold sheen, not a lit blue disc
      color: 0x6f8a90, roughness: 0.18, metalness: 0.1, vertexColors: true,
      emissive: 0x1c3a44, emissiveIntensity: 0.14, transparent: true, opacity: 0.62,
      depthWrite: false,   // transparent glass must not occlude what sorts behind it
      envMap: envTex, envMapIntensity: 0.7
    }), zi, false, 'glass'),
    // The barnacle shells and crust knobs (buildGrowth): matte calcite, vertex-coloured.
    grow: siltify(std({
      color: 0xffffff, roughness: 0.93, metalness: 0.0, vertexColors: true
    }), zi, false, 'grow'),
    lit: litify(new THREE.MeshStandardMaterial({
      color: 0x2a2418, roughness: 0.3, metalness: 0.2, vertexColors: true,
      emissive: 0xffbe6a, emissiveIntensity: 1.5
    }))
  };
  for (const k of ['wood', 'iron', 'brass', 'rope', 'glass', 'grow', 'lit']) P[k].userData.persist = true;
  // PAINT LAW (lib/paint.js): timber, iron and rope go matte with the dial; brass, the
  // glass and the lit lamps are authored hero surfaces and keep their sharpness.
  for (const k of ['wood', 'iron', 'rope', 'grow']) registerPaint(P[k]);
  for (const k of ['brass', 'glass', 'lit']) registerPaint(P[k], { hero: true });
  PALETTES.set(zi, P);
  return P;
}

// ------------------------------------------------------------- geo helpers ---
function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.setScalar(1); _o.updateMatrix();
  return geo.applyMatrix4(_o.matrix);
}

// Bucket primitives by material and emit one merged mesh each. Every geometry is padded
// with a colour attribute so mixed vertex-coloured and plain parts can merge.
function Part(node) {
  const b = new Map();
  return {
    node,
    add(geo, mat) { let a = b.get(mat); if (!a) b.set(mat, a = []); a.push(geo); return geo; },
    bake() {
      for (const [mat, list] of b) {
        for (const g of list) {
          if (!g.attributes.color)
            g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
          if (!g.attributes.uv)
            g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
          if (!g.attributes.aGrow)
            g.setAttribute('aGrow', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
          if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
        }
        const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list, false) : list[0], mat);
        // Wrecks cast into the seabed sun shadow (lighting.js) and receive it and the lantern's.
        m.castShadow = true; m.receiveShadow = true;
        node.add(m);
      }
      b.clear();
      return node;
    }
  };
}

// Grime baked into vertex colours: fbm blotches, darker the lower a vertex sits.
function grime(geo, tone = 1, freq = 0.5, floorY = -99) {
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = fbm(x * freq + 3.1, z * freq - 7.7) - 0.5;
    const b = fbm(y * freq * 2.3 + 11, (x + z) * freq * 2.3) - 0.5;
    let g = tone * (0.86 + a * 0.55 + b * 0.30);
    g *= clamp(0.55 + (y - floorY) * 0.10, 0.55, 1.0);   // buried ends go dark
    g = clamp(g, 0.24, 1.35);
    col[i * 3] = g; col[i * 3 + 1] = g * (0.97 - a * 0.06); col[i * 3 + 2] = g * (0.90 - b * 0.10);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Planking read at range: every strake gets its own tone and is cut into planks of
// random length (a darker butt joint and a tone step at each), the lap VALLEY (where
// one strake tucks under the next) is darkened as cavity and the proud lap edge is
// worn lighter. Written over grime()'s colours on a grid() skin (vertex order i*(nv+1)+j).
function plankTone(geo, nu, nv, STR, rnd) {
  const col = geo.attributes.color.array;
  const butts = [];
  for (let k = 0; k < STR; k++) {
    const b = [0]; let u = 0;
    while (u < 1) { u += 0.18 + rnd() * 0.30; b.push(u); }
    butts.push({ b, tones: b.map(() => 0.78 + rnd() * 0.42) });
  }
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv, sv = v * STR, k = Math.min(STR - 1, Math.floor(sv)), f = sv - k;
    const P = butts[k];
    let seg = 0; while (seg < P.b.length - 1 && u > P.b[seg + 1]) seg++;
    const du = Math.min(Math.abs(u - P.b[seg]), Math.abs((P.b[seg + 1] ?? 9) - u));
    let t = P.tones[seg];
    t *= 1 - 0.45 * Math.exp(-du * du / 0.00003);                  // butt joint
    const lap = f < 0.5 ? f * 2 : 2 - f * 2;                         // tri(v*STR)
    t *= 0.62 + 0.38 * Math.min(1, lap / 0.35);                      // lap valley cavity
    t *= 1 + 0.18 * Math.max(0, (lap - 0.85) / 0.15);                // worn proud edge
    const o = (i * (nv + 1) + j) * 3;
    col[o] *= t; col[o + 1] *= t; col[o + 2] *= t * 0.97;
  }
  return geo;
}

// The old waterline, as a per-vertex growth weight (aGrow) read by the wreck shader
// and by buildGrowth: a band centred on local y = wl, plus a softer fouling skirt below
// it (the part that was always wet). Must run in the hull's own frame, before any roll.
function band(geo, wl, width = 0.3, below = 0.55) {
  const pos = geo.attributes.position, n = pos.count, a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i), x = pos.getX(i), z = pos.getZ(i);
    const d = (y - wl) / width;
    const wob = 0.12 * Math.sin(x * 1.3 + z * 0.7);
    a[i] = Math.min(1, Math.exp(-d * d) + below * clamp((wl - y) / 0.6 + wob, 0, 1));
  }
  geo.setAttribute('aGrow', new THREE.BufferAttribute(a, 1));
  return geo;
}

// Parametric quad-grid surface. fn(u,v) -> [x,y,z]. This is what makes the hulls hulls:
// one continuous skin with plank/strake ribbing folded into the radius.
function grid(nu, nv, fn, hole = null) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const uvs = new Float32Array((nu + 1) * (nv + 1) * 2);
  const idx = [];
  let k = 0;
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv, p = fn(u, v);
    pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
    uvs[k * 2] = u * 4; uvs[k * 2 + 1] = v * 2;
    k++;
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    // hole(u, v) at the quad centre: a stove-in plank run is simply not skinned
    if (hole && hole((i + 0.5) / nu, (j + 0.5) / nv)) continue;
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Matrix placing local +Y along `y` and local +Z as close to `z` as orthogonality
// allows, origin at `o` (splinters, petals, shells: things that lie in a surface).
const _bx = V3(), _by = V3(), _bz = V3();
function basisAt(o, y, z) {
  _by.copy(y).normalize();
  _bz.copy(z).addScaledVector(_by, -_bz.copy(z).dot(_by)).normalize();
  if (_bz.lengthSq() < 1e-8) _bz.set(0, 0, 1);
  _bx.crossVectors(_by, _bz).normalize();
  return new THREE.Matrix4().makeBasis(_bx, _by, _bz).setPosition(o);
}

// Triangle wave in [0,1] — the plank/strake seam profile.
const tri = x => { const f = x - Math.floor(x); return f < 0.5 ? f * 2 : 2 - f * 2; };

// A sagging line between two points: real catenary droop, which is what sells netting
// and hanging rigging far more than any texture does.
function strand(a, b, sag, rad, seg = 12) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const s = Math.sin(Math.PI * t);
    pts.push(V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * s, a.z + (b.z - a.z) * t));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, rad, 4, false);
}

function rivetRing(p, mat, n, r, y, rad = 0.09, axis = 'y', zs = 1) {
  const g = new THREE.SphereGeometry(rad, 5, 4);
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, c = Math.cos(a) * r, s = Math.sin(a) * r * zs;
    p.add(axis === 'y' ? xf(g.clone(), c, y, s) : xf(g.clone(), y, c, s), mat);
  }
}

// A brass porthole ring facing +Z in its local frame; `lit` swaps the glass for a
// dim ember so a hull can still show one light after everything else has died.
function porthole(p, M, R, x, y, z, ry, lit) {
  const put = g => xf(g, x, y, z, 0, ry, 0);
  p.add(put(new THREE.TorusGeometry(R, R * 0.20, 6, 14)), M.brass);
  p.add(put(new THREE.CylinderGeometry(R * 1.05, R * 1.05, R * 0.3, 14, 1, true).rotateX(Math.PI / 2)), M.brass);
  // The pane: a disc with grime baked into its vertex colours — silt settled in the
  // lower lip, a crust of growth round the rim, a wiped-clear middle that is not quite
  // clear. On the lit material the colour modulates the EMISSION (litify), so the
  // grime dims the light itself.
  const pane = new THREE.RingGeometry(0, R * 0.95, 24, 5).translate(0, 0, 0.02);
  {
    const pp = pane.attributes.position, col = new Float32Array(pp.count * 3);
    for (let i = 0; i < pp.count; i++) {
      const px = pp.getX(i) / R, py = pp.getY(i) / R, r = Math.hypot(px, py);
      let g = 0.40 + 0.95 * Math.pow(fbm(px * 4.3 + x, py * 4.3 + z), 1.6) + 0.25 * fbm(px * 11 + 7, py * 11) - 0.55 * Math.pow(r, 3.0);
      g -= 0.35 * clamp(-py - 0.25, 0, 1) * (0.6 + 0.4 * fbm(px * 7 + 3, 1.3));   // silt in the lower lip
      g = clamp(g, lit ? 0.18 : 0.30, 1.1);
      col[i * 3] = g; col[i * 3 + 1] = g * 0.96; col[i * 3 + 2] = g * 0.88;
    }
    pane.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  p.add(put(pane), lit ? M.lit : M.glass);
  // a proud glass dome over every pane, so the rim catches a highlight
  const dome = new THREE.SphereGeometry(R * 0.97, 16, 5, 0, TAU, 0, 0.55).rotateX(Math.PI / 2);
  dome.scale(1, 1, 0.38).translate(0, 0, 0.03);
  p.add(put(dome), M.glass);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    p.add(put(new THREE.SphereGeometry(R * 0.13, 5, 4).translate(Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15, 0.03)), M.brass);
  }
  if (lit) {
    // LIGHT SPILL: a soft additive frustum out of the pane and down into the silt, and
    // a small warm halo at the glass. Fog is applied by hand (the house rule for
    // additive light: fade to black by the local density, never toward fog colour).
    const Lc = R * 9, Rb = R * 3.4;
    const cone = new THREE.CylinderGeometry(R * 0.82, Rb, Lc, 18, 5, true).translate(0, -Lc / 2, 0);
    const cp = cone.attributes.position, at = new Float32Array(cp.count);
    for (let i = 0; i < cp.count; i++) at[i] = -cp.getY(i) / Lc;
    cone.setAttribute('aT', new THREE.BufferAttribute(at, 1));
    cone.rotateX(-Math.PI / 2).rotateX(0.32).translate(0, 0, 0.04);
    const spill = new THREE.Mesh(put(cone), spillMat());
    spill.renderOrder = 3;
    p.node.add(spill);
    const halo = makeGlow(0xffb468, R * 5.5);
    halo.material.opacity = 0.28;
    _v.set(0, 0, R * 0.5).applyAxisAngle(UP, ry);
    halo.position.set(x + _v.x, y + _v.y, z + _v.z);
    p.node.add(halo);
  }
}

// One additive program for every porthole spill (trawler + submersible).
let SPILL_MAT = null;
function spillMat() {
  if (SPILL_MAT) return SPILL_MAT;
  SPILL_MAT = new THREE.ShaderMaterial({
    uniforms: { uFogD: uni.uFogD, uTime: uni.uTime, uCol: { value: new THREE.Color(0xffae62) } },
    vertexShader: `attribute float aT; varying float vT; varying vec3 vN, vV; varying float vD;
      void main(){
        vT = aT;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uFogD, uTime; uniform vec3 uCol; varying float vT; varying vec3 vN, vV; varying float vD;
      void main(){
        // bright down the axis, gone at the grazing silhouette; falls off along the beam
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.8);
        float along = (1.0 - vT); along *= along;
        float a = edge * along * smoothstep(0.0, 0.06, vT) * exp(-vD * uFogD) * (0.93 + 0.07 * sin(uTime * 1.3));
        gl_FragColor = vec4(uCol * a * 0.20, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false
  });
  SPILL_MAT.forceSinglePass = true;
  SPILL_MAT.userData.persist = true;
  return SPILL_MAT;
}

// ------------------------------------------------------------------ dust -----
// Silt hanging in the hull: a static point cloud whose drift is entirely in the vertex
// shader, so the CPU never touches it after build.
function dustCloud(n, sx, sy, sz, color) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), par = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rng(-sx, sx); pos[i * 3 + 1] = rng(0, sy); pos[i * 3 + 2] = rng(-sz, sz);
    par[i * 3] = rng(0.2, 0.75);        // rise rate
    par[i * 3 + 1] = rng(0, TAU);       // phase
    par[i * 3 + 2] = rng(0.4, 1.0);     // size
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.BufferAttribute(par, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: uni.uTime, uFogD: uni.uFogD, uH: { value: sy }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `uniform float uTime, uH, uFogD; attribute vec3 aP; varying float vA;
      void main(){
        vec3 p = position;
        p.y = mod(p.y + uTime * aP.x * 0.20, uH);
        p.x += sin(uTime * 0.23 + aP.y) * 0.55;
        p.z += cos(uTime * 0.19 + aP.y * 1.7) * 0.45;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = clamp(aP.z * 34.0 / max(d, 0.6), 1.0, 7.0);
        // fade at both ends of the wrap so recycling never pops
        // uFogD tracks scene.fog.density per frame (house rule for fog:false additive
        // sprites) instead of a hardcoded boot-time density.
        vA = smoothstep(0.0, 0.18, p.y / uH) * (1.0 - smoothstep(0.72, 1.0, p.y / uH)) * exp(-d * uFogD);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float a = exp(-dot(q, q) * 9.0) * vA * 0.55;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

// ------------------------------------------------------------- relic + VFX ---
const relicGeo = new THREE.IcosahedronGeometry(0.34, 1);

// The pickup burst: 40 sprites shot outward on a fixed direction attribute, driven by
// one uniform. Built once per wreck, never allocated again.
function burstFX(color) {
  const N = 40, g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), dir = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * TAU, c = rng(-1, 1), s = Math.sqrt(1 - c * c), sp = rng(0.5, 1.6);
    dir[i * 3] = Math.cos(a) * s * sp; dir[i * 3 + 1] = (c * 0.6 + 0.5) * sp; dir[i * 3 + 2] = Math.sin(a) * s * sp;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `uniform float uT; attribute vec3 aDir; varying float vA;
      void main(){
        float e = uT * (2.0 - uT);                 // ease-out spread
        vec3 p = aDir * e * 4.0 + vec3(0.0, -uT * uT * 1.2, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(30.0 / max(-mv.z, 0.6), 1.0, 26.0) * (1.0 - uT * 0.6);
        vA = 1.0 - uT;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float a = exp(-dot(q, q) * 8.0) * vA;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.visible = false;
  return p;
}

// Warm mechanical counterpart to the rifts' cold motes: a slow-turning brass shard with
// two haloes, readable well past the 25u the brief asks for.
function relicMarker(color) {
  const grp = new THREE.Group();
  const core = new THREE.Mesh(relicGeo, new THREE.MeshBasicMaterial({ color: 0xffe6b8, fog: false }));
  grp.add(core);
  const g1 = makeGlow(color, 2.4);
  const g2 = makeGlow(color, 5.0);
  g2.material.opacity = 0.30;
  grp.add(g1, g2);
  grp.userData = { core, g1, g2 };
  return grp;
}

// ------------------------------------------------------------------ hulls ----

// Zone 0 — a capsized clinker-built skiff. The hull is one parametric skin with the
// lapstrake seams folded into its radius, so the planking is real geometry, not a map.
function skiff(M) {
  const grp = new THREE.Group();
  const p = Part(grp);
  const L = 16, B = 3.0, D = 2.1;

  const hullFn = (u, v) => {
    // u: stern(0) -> bow(1); v: port gunwale(0) -> keel(0.5) -> starboard(1)
    const beam = B * Math.pow(Math.sin(Math.PI * (0.10 + u * 0.86)), 0.55) * (1 - 0.10 * u);
    const dep = D * (0.62 + 0.38 * Math.sin(Math.PI * Math.pow(u, 0.75)));
    const phi = (v - 0.5) * Math.PI;
    const cw = Math.sin(phi), ch = -Math.cos(phi);
    // lapstrake: 9 overlapping strakes, each stepping proud of the one below
    const lap = (tri(v * 9) - 0.5) * 0.13;
    const rot = fbm(u * 3.1, v * 3.0) * 0.10;   // waterlogged warp
    const k = 1 + lap + rot;
    return [L * (u - 0.5), ch * dep * k, cw * beam * k];
  };
  // 46x45, up from 46x30: 5 samples per lapstrake (tri(v*9)) so the clinker steps
  // survive smooth shading up close. Same hullFn — proportions (and the hand-baked
  // LOC colliders keyed to them) are untouched, this is tessellation only.
  // STOVE-IN: a run of planks broken through on the port bilge (the side the
  // capsize left facing the light). Each strake broke at its own length along the
  // grain, so the hole is a staircase of plank ends, not a clean cut; every broken end
  // is dressed with a fan of splinters (below). Colliders are spheres on the old hull
  // and do not change — the hole is a window, not a door.
  const sr = seededRand(0x5C1FF00D + currentSiteIndex() * 7919);
  const HOLE_U = 0.43, HOLE_V = 0.27, HOLE_DV = 0.15, STR = 9;
  const holeSpan = [];
  for (let k = 0; k < STR; k++) {
    const vc = (k + 0.5) / STR, dv = (vc - HOLE_V) / HOLE_DV;
    const w = dv * dv < 1 ? Math.sqrt(1 - dv * dv) : 0;
    // [lo, hi, skewLo, skewHi]: each plank end breaks on a slant along its width
    holeSpan.push(w > 0 ? [HOLE_U - w * (0.04 + 0.09 * sr()), HOLE_U + w * (0.035 + 0.09 * sr()),
      (sr() - 0.5) * 0.05, (sr() - 0.5) * 0.05] : null);
  }
  const holeLo = (k, vf) => holeSpan[k][0] + holeSpan[k][2] * (vf - 0.5) + 0.006 * Math.sin(vf * 19 + k);
  const holeHi = (k, vf) => holeSpan[k][1] + holeSpan[k][3] * (vf - 0.5) - 0.006 * Math.sin(vf * 23 + k * 2);
  const inHole = (u, v) => {
    const k = Math.min(STR - 1, Math.floor(v * STR)), sp = holeSpan[k];
    if (!sp) return false;
    const vf = v * STR - k;
    return u > holeLo(k, vf) && u < holeHi(k, vf);
  };
  // 92 stations along (was 46): the plank ends at the hole break on a fine enough
  // stride that the staircase reads as broken timber, not as a missing panel.
  const hull = plankTone(grime(grid(92, 45, hullFn, inHole), 1.0, 0.35, -2.4), 92, 45, STR, sr);
  // old waterline: she floated about 45% of her depth down (hull-local, before the roll)
  band(hull, -D * 0.46, 0.28, 0.6);
  p.add(hull, M.wood);

  // hull frame helpers: point, grain tangent (along u) and outward normal at (u, v)
  const hp = (u, v) => V3(...hullFn(u, v));
  const frame = (u, v) => {
    const o = hp(u, v), du = hp(Math.min(1, u + 0.004), v).sub(hp(Math.max(0, u - 0.004), v)).normalize();
    const dv = hp(u, Math.min(1, v + 0.004)).sub(hp(u, Math.max(0, v - 0.004))).normalize();
    const n = du.clone().cross(dv).normalize();
    if (n.dot(V3(0, o.y, o.z)) < 0) n.negate();          // outward, away from the keel line
    return { o, du, dv, n };
  };
  // SPLINTER FANS: at both broken ends of every holed strake, 3-5 flat slivers along
  // the grain, jutting into the hole and bent inward where the blow drove them.
  {
    const sliver = new THREE.ConeGeometry(1, 1, 3, 1).translate(0, 0.5, 0);
    for (let k = 0; k < STR; k++) {
      const sp = holeSpan[k];
      if (!sp) continue;
      for (const end of [0, 1]) {
        const dir = end === 0 ? 1 : -1;
        const nS = 4 + ((sr() * 3) | 0);
        for (let q = 0; q < nS; q++) {
          const vf = 0.10 + 0.80 * (q + sr() * 0.6) / nS, v = (k + vf) / STR;
          const u0 = end === 0 ? holeLo(k, vf) : holeHi(k, vf);
          const f = frame(u0, v);
          const len = 0.25 + sr() * 0.85, wid = 0.04 + sr() * 0.06, bend = 0.25 + sr() * 0.9;
          // grain direction into the hole, pitched inward (toward -n) by the bend
          const d = f.du.clone().multiplyScalar(dir).multiplyScalar(Math.cos(bend)).addScaledVector(f.n, -Math.sin(bend)).normalize();
          const g = sliver.clone();
          g.scale(wid, len, wid * 0.28);
          // basis: Y along the sliver, Z (its thin axis) along the plank normal, so the
          // sliver lies flat in the plank's own plane
          g.applyMatrix4(basisAt(f.o.clone().addScaledVector(f.n, -0.03), d, f.n));
          p.add(grime(g, 0.75 + sr() * 0.3, 0.9, -2.4), M.wood);
        }
      }
      // a torn stub of the strake's lap edge hanging into the hole
      const f = frame((sp[0] + sp[1]) * 0.5, (k + 0.95) / STR);
      if (sr() < 0.6) {
        const g = new THREE.BoxGeometry(0.05, (sp[1] - sp[0]) * L * (0.25 + sr() * 0.3), 0.012);
        g.applyMatrix4(basisAt(f.o, f.du.clone().addScaledVector(f.n, -0.6).normalize(), f.n));
        p.add(grime(g, 0.7, 0.9, -2.4), M.wood);
      }
    }
    sliver.dispose();
  }
  { const f = frame(HOLE_U, HOLE_V); grp.userData.hole = { o: f.o, n: f.n }; }
  // CLINKER RIVETS: copper clench nails down every lap, the detail that says 'built',
  // not 'moulded'. Skipped inside the hole.
  {
    const nail = new THREE.OctahedronGeometry(0.045, 0).scale(1, 1, 0.45);
    for (let k = 1; k < STR; k++) {
      const v = (k - 0.06) / STR;
      for (let u = 0.035; u < 0.975; u += 0.021) {
        if (inHole(u, v) || inHole(u, v + 0.5 / STR) || inHole(u, v - 0.5 / STR)) continue;
        const f = frame(u, v);
        const g = nail.clone();
        {   // verdigrised copper: dull green-brown, never bright brass
          const t = 0.30 + 0.16 * sr(), c = new Float32Array(g.attributes.position.count * 3);
          for (let i = 0; i < c.length; i += 3) { c[i] = t * 0.85; c[i + 1] = t * 1.05; c[i + 2] = t * 0.80; }
          g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        }
        _q.setFromUnitVectors(V3(0, 0, 1), f.n);
        g.applyMatrix4(new THREE.Matrix4().compose(f.o.clone().addScaledVector(f.n, 0.012), _q, V3(1, 1, 1)));
        p.add(g, M.brass);
      }
    }
    nail.dispose();
  }

  // frames (ribs) showing through the open, upturned belly
  for (let i = 1; i < 9; i++) {
    const u = i / 9;
    const pts = [];
    for (let j = 0; j <= 14; j++) {
      const a = hullFn(u, j / 14);
      pts.push(V3(a[0], a[1] * 0.94, a[2] * 0.94));
    }
    p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.10, 4, false), 0.8, 0.6, -2.4), M.wood);
  }
  // keel plus gunwale rails
  {
    const kp = [], gp = [], gs = [];
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      const a = hullFn(u, 0.5), b = hullFn(u, 0.0), c = hullFn(u, 1.0);
      kp.push(V3(a[0], a[1] - 0.06, a[2]));
      gp.push(V3(b[0], b[1], b[2])); gs.push(V3(c[0], c[1], c[2]));
    }
    p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(kp), 22, 0.16, 5, false), 1.05, 0.4, -2.4), M.wood);
    p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(gp), 22, 0.13, 5, false), 0.9, 0.4, -2.4), M.wood);
    p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(gs), 22, 0.13, 5, false), 0.9, 0.4, -2.4), M.wood);
  }
  // transom
  p.add(grime(xf(new THREE.BoxGeometry(0.22, 2.0, 2.0), -L * 0.5 + 0.1, -0.6, 0), 0.8, 0.5, -2.4), M.wood);

  // capsize: rolled onto her port side and heeled over, the way she'd settle
  grp.rotation.x = Math.PI * 0.62;   // roll about her own length
  grp.rotation.z = 0.09;             // slight bow-down trim
  grp.position.y = 2.2;

  // ---- everything below is upright on the seabed, so it lives outside the roll ----
  const deck = new THREE.Group();
  const q = Part(deck);

  // snapped mast: the stump still stepped, the broken length lying across the silt
  {
    const stump = new THREE.CylinderGeometry(0.24, 0.30, 3.2, 9);
    q.add(grime(xf(stump, 5.0, 1.3, 1.6, 0.20, 0, 0.42), 0.9, 0.5, 0), M.wood);
    // jagged break: three splinters
    for (let i = 0; i < 4; i++)
      q.add(grime(xf(new THREE.ConeGeometry(rng(0.05, 0.11), rng(0.5, 1.2), 4), 5.0 + rng(-0.2, 0.2) + 1.2, 2.9, 1.6 + rng(-0.2, 0.2), 0.2, rng(0, 3), 0.42), 0.8, 0.6, 0), M.wood);
    const fallen = new THREE.CylinderGeometry(0.20, 0.26, 9.5, 9);
    q.add(grime(xf(fallen, -3.0, 0.30, 5.4, 0, 0.42, Math.PI / 2 - 0.06), 0.85, 0.4, 0), M.wood);
    for (let i = 0; i < 4; i++)   // mast hoops
      q.add(xf(new THREE.TorusGeometry(0.28, 0.045, 4, 10).rotateY(Math.PI / 2), -6 + i * 2.3, 0.30, 5.4 + (i - 1.5) * 0.0, 0, 0.42, 0), M.brass);
  }

  // scattered crates, plus the one holding the sounding set
  const CRATES = [[-7.4, 0.55, -2.6, 0.6], [-5.9, 0.5, -4.2, 0.5], [6.2, 0.5, -3.0, 0.9], [8.0, 0.45, 0.6, 2.4], [-8.6, 0.5, 1.4, 1.1]];
  for (const [cx, cy, cz, ry] of CRATES) {
    const s = rng(0.85, 1.25);
    q.add(grime(xf(new THREE.BoxGeometry(1.5 * s, 1.05 * s, 1.15 * s), cx, cy * s, cz, rng(-0.12, 0.12), ry, rng(-0.14, 0.14)), 0.95, 0.7, 0), M.wood);
    for (let i = -1; i <= 1; i += 2)   // batten strips
      q.add(grime(xf(new THREE.BoxGeometry(1.55 * s, 0.14, 0.10), cx, cy * s + i * 0.34 * s, cz + 0.60 * s, rng(-0.12, 0.12), ry, rng(-0.14, 0.14)), 0.8, 0.7, 0), M.wood);
  }

  // the relic crate: lid pried off and leaning, the brass sounding set inside
  const RC = V3(3.4, 0, -5.0);
  q.add(grime(xf(new THREE.BoxGeometry(2.2, 1.3, 1.7), RC.x, 0.65, RC.z, 0, -0.35, 0), 1.0, 0.7, 0), M.wood);
  q.add(grime(xf(new THREE.BoxGeometry(2.3, 0.14, 1.8), RC.x + 1.2, 0.9, RC.z - 0.9, 0.5, -0.35, 0.25), 0.9, 0.7, 0), M.wood);

  // sounding set: a brass instrument box with a listening horn and a lead-line reel
  const rel = new THREE.Group();
  rel.position.set(RC.x, 1.42, RC.z);
  rel.rotation.y = -0.35;
  const r = Part(rel);
  r.add(new THREE.BoxGeometry(1.05, 0.62, 0.72), M.brass);
  r.add(xf(new THREE.BoxGeometry(1.10, 0.07, 0.77), 0, 0.33, 0), M.brass);
  rivetRing(r, M.brass, 8, 0.42, 0.30, 0.045);
  // horn
  r.add(xf(new THREE.CylinderGeometry(0.40, 0.12, 0.85, 12, 1, true), 0.15, 0.72, 0.30, -0.5, 0, 0.45), M.brass);
  r.add(xf(new THREE.TorusGeometry(0.40, 0.04, 4, 12), 0.15 + 0.33, 1.06, 0.48, -0.5 + Math.PI / 2, 0, 0.45), M.brass);
  // dial face, faintly alight
  r.add(xf(new THREE.CircleGeometry(0.20, 14), 0, 0.05, 0.37), M.lit);
  r.add(xf(new THREE.TorusGeometry(0.21, 0.035, 4, 14), 0, 0.05, 0.37), M.brass);
  // lead-line reel on the side
  r.add(xf(new THREE.CylinderGeometry(0.24, 0.24, 0.26, 12), -0.62, -0.05, 0, 0, 0, Math.PI / 2), M.brass);
  r.bake();

  q.bake();
  p.bake();

  // ---- the trawl net, still made fast to her, draped off the high gunwale ----
  // A REAL net: diamond mesh (the bars run on the bias, never a square grid), a knot at
  // every crossing, cork floats on the head rope and lead sinkers on the foot rope, a
  // torn hole with frayed bar ends hanging loose. The sheet is a parametric surface
  // between the head rope and the foot rope with the catenary belly the old strands
  // had; the rope material still sways it in the vertex shader.
  const net = new THREE.Group();
  {
    const nn = Part(net);
    const N = 24, top = [], bot = [];
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      top.push(V3(-5.4 + u * 11.4, 4.55 + Math.sin(u * 3.1) * 0.25, 1.35));
      bot.push(V3(-6.6 + u * 13.6, 0.25 + fbm(u * 4, 1.7) * 0.5, 6.4 + Math.sin(u * 2.2) * 0.9));
    }
    const lerpArr = (arr, u) => {
      const f = clamp(u, 0, 1) * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(f)), t = f - i;
      return arr[i].clone().lerp(arr[i + 1], t);
    };
    // sheet(u, t): u across (0..1), t down from head rope (0) to foot rope (1)
    const sheet = (u, t) => {
      const a = lerpArr(top, u), b = lerpArr(bot, u);
      const p = a.lerp(b, t);
      p.y -= 0.95 * Math.sin(Math.PI * t) + 0.18 * Math.sin(u * 17.0 + t * 5.0) * Math.sin(Math.PI * t);
      p.z += 0.22 * Math.sin(u * 9.0 + 1.3) * Math.sin(Math.PI * t);    // billow
      return p;
    };
    const NU = 30, NT = 14;
    // the tear: an elliptical run of meshes missing, low on the sheet
    const torn = (u, t) => ((u - 0.63) / 0.10) ** 2 + ((t - 0.62) / 0.16) ** 2 < 1;
    const nodeOk = (i, j) => !torn(i / NU, j / NT);
    const knot = new THREE.IcosahedronGeometry(0.052, 0);
    const bar = (A, B, sag, frayed) => {
      if (frayed) {             // a snapped bar: half its length, hanging slack
        const mid = A.clone().lerp(B, 0.45);
        mid.y -= 0.18 + 0.1 * Math.sin(A.x * 7.1);
        nn.add(grime(strand(A, mid, 0.04, 0.020, 3), 0.5, 1.6, -1), M.rope);
      } else nn.add(grime(strand(A, B, sag, 0.022, 3), 0.55, 1.6, -1), M.rope);
    };
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NT; j++) {
      if ((i + j) & 1) continue;                        // diamond lattice
      const ok = nodeOk(i, j);
      const P0 = sheet(i / NU, j / NT);
      if (ok && j > 0 && j < NT) nn.add(grime(xf(knot.clone(), P0.x, P0.y, P0.z), 0.45, 1.6, -1), M.rope);
      for (const dj of [-1, 1]) {
        const i2 = i + 1, j2 = j + dj;
        if (i2 > NU || j2 < 0 || j2 > NT) continue;
        const ok2 = nodeOk(i2, j2);
        if (!ok && !ok2) continue;
        const P1 = sheet(i2 / NU, j2 / NT);
        if (ok && ok2) bar(P0, P1, 0.035, false);
        else if (ok) bar(P0, P1, 0, true);
        else bar(P1, P0, 0, true);
      }
    }
    knot.dispose();
    // head rope (with its cork floats, still trying to lift) and foot rope (with leads)
    for (let i = 0; i < N - 1; i++) nn.add(grime(strand(top[i], top[i + 1], 0.10, 0.055, 4), 0.6, 1.2, -1), M.rope);
    for (let i = 0; i < N; i += 5)
      nn.add(xf(new THREE.CylinderGeometry(0.17, 0.17, 0.30, 8), top[i].x, top[i].y + 0.22, top[i].z, Math.PI / 2, 0, 0), M.rope);
    const foot = [];
    for (let i = 0; i <= NU; i++) foot.push(sheet(i / NU, 1));
    for (let i = 0; i < NU; i++) nn.add(grime(strand(foot[i], foot[i + 1], 0.05, 0.05, 3), 0.5, 1.2, -1), M.rope);
    for (let i = 1; i < NU; i += 3) {
      const a = foot[i], b = foot[i + 1];
      const lead = new THREE.CylinderGeometry(0.085, 0.085, 0.24, 7).rotateZ(Math.PI / 2);
      lead.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
      nn.add(grime(xf(lead, a.x, a.y, a.z), 0.55, 1.2, -1), M.iron);
    }
    nn.bake();
  }

  const root = new THREE.Group();
  root.add(grp, deck, rel, net);
  root.add(dustCloud(70, 8, 6, 4, 0x9ec8d8));
  return { root, relic: rel, hulls: [grp] };
}

// Peeled plating along a tear at hull station u0. Each petal is a strip of the skin
// (a grid patch following the hull's own surface for its first stretch) that then
// curls outward and away from the break, tearing narrower toward its tip. dir is the
// direction along the hull the petal extends into the gap (+1 toward bow).
function tornPetals(p, M, hullFn, u0, dir) {
  const NP = 13;
  for (let i = 0; i < NP; i++) {
    const v0 = (i + rng(0.0, 0.25)) / NP, v1 = (i + 1 - rng(0.05, 0.3)) / NP;
    if (rng(0, 1) < 0.18) continue;                      // some plates are simply gone
    const len = rng(0.5, 1.8), curl = rng(0.4, 1.4), twist = rng(-0.5, 0.5);
    const g = grid(4, 3, (s, t) => {
      const v = v0 + (v1 - v0) * (0.5 + (t - 0.5) * (1 - 0.55 * s));   // tapers to the tip
      const a = hullFn(u0, v), c = hullFn(u0, 0.5);
      // outward (away from the hull centreline) in the cross-section plane
      let ox = 0, oy = a[1] - c[1] * 0.2, oz = a[2];
      const ol = Math.hypot(oy, oz) || 1; oy /= ol; oz /= ol;
      const run = s * len, bendA = curl * s * s;
      return [
        a[0] + dir * run * Math.cos(bendA),
        a[1] + oy * run * Math.sin(bendA) + twist * s * s * 0.3,
        a[2] + oz * run * Math.sin(bendA) + (t - 0.5) * s * twist * 0.2
      ];
    });
    p.add(grime(g, 0.7, 0.5, -4.5), M.iron);
  }
}

// Zone 1 — an iron trawler torn in half amidships. The gap is a real swimmable
// corridor: the colliders stop at the plating, not at the bounding box.
function trawler(M) {
  const root = new THREE.Group();
  const L = 26, B = 4.6, D = 4.2;

  // Fuller, harder cross-section than the skiff: near-vertical topsides over a
  // slack bilge, which is what makes an iron ship read as iron.
  const hullFn = (u, v) => {
    const beam = B * Math.pow(Math.sin(Math.PI * (0.06 + u * 0.90)), 0.36);
    const dep = D * (0.70 + 0.30 * Math.sin(Math.PI * Math.pow(u, 0.6)));
    const phi = (v - 0.5) * Math.PI;
    const cw = Math.sign(Math.sin(phi)) * Math.pow(Math.abs(Math.sin(phi)), 0.62);
    const ch = -Math.pow(Math.abs(Math.cos(phi)), 1.5) * Math.sign(Math.cos(phi));
    const strake = (tri(v * 7) - 0.5) * 0.05;   // riveted strake laps
    const buckle = fbm(u * 4.0 + 2, v * 2.4) * 0.09;
    const k = 1 + strake + buckle;
    return [L * (u - 0.5), ch * dep * k, cw * beam * k];
  };

  // --- bow half, listing to starboard ---
  const bow = new THREE.Group();
  {
    const p = Part(bow);
    // 40x42, up from 26x26: the 7-lap strake profile (tri(v*7)) gets 6 samples per
    // lap so the riveted plating reads as steps at lantern range, not aliased noise.
    const g = grime(grid(40, 42, (u, v) => hullFn(0.54 + u * 0.46, v)), 1.0, 0.3, -4.5);
    band(g, -D * 0.42, 0.34, 0.5);
    p.add(g, M.iron);
    // torn plating at the break: steel fails in PETALS — plates peeled back from the
    // tear and curled outward, each a strip of the hull skin itself
    tornPetals(p, M, hullFn, 0.54, -1);
    // deck plate + bulwark rail with stanchions
    p.add(grime(xf(new THREE.BoxGeometry(11.5, 0.18, B * 1.6), 7.2, 0.05, 0), 0.9, 0.3, -4.5), M.iron);
    for (let i = 0; i < 9; i++) {
      const u = 0.58 + i * 0.045, e = hullFn(u, 0.02);
      for (const s of [1, -1]) {
        p.add(grime(xf(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), e[0], 0.55, s * Math.abs(e[2])), 0.8, 0.4, -4.5), M.iron);
      }
    }
    for (const s of [1, -1]) {
      const rp = [];
      for (let i = 0; i <= 10; i++) { const e = hullFn(0.56 + i * 0.044, 0.02); rp.push(V3(e[0], 1.05, s * Math.abs(e[2]))); }
      p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp), 12, 0.075, 4, false), 0.85, 0.4, -4.5), M.iron);
    }
    // anchor hawse + windlass
    p.add(grime(xf(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 10), 9.0, 0.6, 0, 0, 0, Math.PI / 2), 0.9, 0.4, -4.5), M.iron);
    // Route the portholes through the SAME Part that gets baked below — a throwaway
    // Part(bow) here filled buckets whose bake() never ran, so none of them rendered.
    for (const s of [1, -1]) porthole(p, M, 0.42, 8.2, -1.2, s * 2.6, s > 0 ? 0.3 : Math.PI - 0.3, false);
    p.bake();
    bow.rotation.x = 0.30;    // heeled to starboard
    bow.rotation.z = -0.12;   // bow lifted where the break holds her up
    bow.rotation.y = 0.10;
    bow.position.set(2.6, 4.3, -0.9);
  }
  root.add(bow);

  // --- stern half, heeled the other way, with the deckhouse and funnel ---
  const stern = new THREE.Group();
  {
    const p = Part(stern);
    p.add(band(grime(grid(40, 42, (u, v) => hullFn(u * 0.44, v)), 1.0, 0.3, -4.5), -D * 0.42, 0.34, 0.5), M.iron);
    tornPetals(p, M, hullFn, 0.44, 1);
    p.add(grime(xf(new THREE.BoxGeometry(11.0, 0.18, B * 1.5), -5.8, 0.05, 0), 0.9, 0.3, -4.5), M.iron);

    // deckhouse
    p.add(grime(xf(new THREE.BoxGeometry(4.6, 2.6, 4.0), -6.0, 1.35, 0), 1.0, 0.5, -4.5), M.iron);
    p.add(grime(xf(new THREE.BoxGeometry(5.0, 0.20, 4.4), -6.0, 2.72, 0), 0.85, 0.5, -4.5), M.iron);
    p.add(grime(xf(new THREE.BoxGeometry(0.9, 1.7, 0.14), -3.72, 0.90, 0.9), 0.8, 0.6, -4.5), M.iron);   // door
    // Baked with the stern's own Part (the old `const ph = Part(stern)` was never
    // baked, which silently dropped all four — including the one light still burning).
    porthole(p, M, 0.40, -6.9, 1.7, 2.02, 0, true);
    porthole(p, M, 0.40, -5.2, 1.7, 2.02, 0, false);
    porthole(p, M, 0.40, -6.9, 1.7, -2.02, Math.PI, false);
    porthole(p, M, 0.40, -8.32, 1.5, 0, -Math.PI / 2, false);

    // funnel, tilted where the stays let go
    p.add(grime(xf(new THREE.CylinderGeometry(0.85, 1.0, 4.4, 14, 1, true), -8.6, 4.2, 0.3, 0.16, 0, 0.42), 1.0, 0.4, -4.5), M.iron);
    p.add(grime(xf(new THREE.TorusGeometry(0.86, 0.12, 5, 14), -9.5, 6.2, 0.6, Math.PI / 2 + 0.16, 0, 0.42), 0.9, 0.4, -4.5), M.iron);
    rivetRing(p, M.iron, 14, 1.0, -0.0, 0.07);

    // davits over the side — the boats are long gone
    for (const s of [1, -1]) {
      const c = new THREE.CatmullRomCurve3([
        V3(-3.0, 0.1, s * 3.0), V3(-3.0, 2.0, s * 3.2), V3(-3.1, 2.9, s * 4.2), V3(-3.2, 2.6, s * 5.2)
      ]);
      p.add(grime(new THREE.TubeGeometry(c, 12, 0.11, 5, false), 0.85, 0.5, -4.5), M.iron);
    }
    // railings aft
    for (const s of [1, -1]) {
      const rp = [];
      for (let i = 0; i <= 8; i++) { const e = hullFn(0.05 + i * 0.045, 0.02); rp.push(V3(e[0], 1.05, s * Math.abs(e[2]))); }
      p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp), 10, 0.075, 4, false), 0.85, 0.4, -4.5), M.iron);
      for (let i = 0; i <= 7; i++) {
        const e = hullFn(0.06 + i * 0.05, 0.02);
        p.add(grime(xf(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), e[0], 0.55, s * Math.abs(e[2])), 0.8, 0.4, -4.5), M.iron);
      }
    }
    // rudder + screw
    p.add(grime(xf(new THREE.BoxGeometry(0.25, 2.2, 1.6), -12.6, -1.6, 0, 0, 0, 0.1), 0.85, 0.5, -4.5), M.iron);
    for (let i = 0; i < 3; i++)
      p.add(grime(xf(new THREE.BoxGeometry(0.10, 1.3, 0.55).translate(0, 0.65, 0), -11.6, -2.0, 0, i * 2.09, 0, 0), 0.9, 0.5, -4.5), M.brass);

    // ---- the spear-gun rack against the deckhouse ----
    p.add(grime(xf(new THREE.BoxGeometry(0.16, 1.5, 2.2), -3.60, 0.85, -1.2), 0.9, 0.6, -4.5), M.iron);
    p.add(grime(xf(new THREE.BoxGeometry(0.5, 0.12, 2.3), -3.45, 1.45, -1.2), 0.9, 0.6, -4.5), M.iron);
    p.bake();

    stern.rotation.x = -0.34;  // she went over the other way
    stern.rotation.z = 0.10;
    stern.rotation.y = -0.16;
    stern.position.set(-4.0, 4.6, 1.1);
  }
  root.add(stern);

  // relic: a whaling-pattern spear gun racked butt-down
  const rel = new THREE.Group();
  rel.position.set(-3.30, 1.60, -1.20);   // in the stern's frame, propped in its rack
  rel.rotation.set(0.10, 0, 0.38);
  {
    const r = Part(rel);
    r.add(xf(new THREE.CylinderGeometry(0.075, 0.075, 1.9, 10), 0, 0, 0), M.brass);            // barrel
    r.add(xf(new THREE.BoxGeometry(0.22, 0.55, 0.14), 0, -0.75, 0.14), M.brass);               // stock
    r.add(xf(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 8), 0, -1.0, 0.30, 0.5, 0, 0), M.brass); // grip
    r.add(xf(new THREE.TorusGeometry(0.12, 0.026, 4, 12), 0, -0.86, 0.24, Math.PI / 2, 0, 0), M.brass); // trigger guard
    r.add(xf(new THREE.CylinderGeometry(0.028, 0.028, 2.3, 6), 0.0, 0.15, -0.09), M.iron);     // the spear itself
    r.add(xf(new THREE.ConeGeometry(0.07, 0.30, 6), 0.0, 1.45, -0.09), M.iron);
    for (const s of [1, -1]) r.add(xf(new THREE.ConeGeometry(0.045, 0.22, 4), s * 0.045, 1.30, -0.09, 0, 0, s * 0.9), M.iron);  // barbs
    r.add(xf(new THREE.TorusGeometry(0.115, 0.02, 4, 10), 0, 0.55, 0, Math.PI / 2, 0, 0), M.brass);  // muzzle band
    r.add(xf(new THREE.CircleGeometry(0.06, 10), 0, -0.62, 0.215), M.lit);                     // maker's plate, alight
    r.bake();
  }
  stern.add(rel);
  root.add(dustCloud(90, 12, 9, 5, 0xa89ad0));

  return { root, relic: rel, hulls: [bow, stern] };
}

// Zone 2 — a crushed one-atmosphere submersible. The intact half still holds its
// sphere; the other half is folded inward. Everything about the read is pressure.
function submersible(M) {
  const root = new THREE.Group();
  const p = Part(root);
  const R = 2.9;

  // pressure sphere, imploded on the port-forward quarter: vertices inside a crush
  // cone are pulled toward the centre and creased, which is how real steel fails.
  // CRUSH CREASES: a shell failing under external pressure buckles into a diamond
  // (Yoshimura) pattern — two families of fold lines spiralling out of the dent, each a
  // sharp triangle-wave ridge, deepest at the centre and dying out at the dent's rim,
  // plus a ring of hoop folds where the intact shell holds. Tessellated finely enough
  // (72x54) that the ridges land on vertices and survive smooth shading.
  {
    const g = new THREE.SphereGeometry(R, 72, 54);
    const pos = g.attributes.position;
    const dent = V3(-0.55, 0.25, -0.79).normalize();
    const e1 = V3(0, 1, 0).cross(dent).normalize(), e2 = dent.clone().cross(e1).normalize();
    const tw = x => { const f = x - Math.floor(x); return Math.abs(f - 0.5) * 2; };   // 1 at ridges
    const nH = V3();
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      nH.copy(_v).normalize();
      const d = nH.dot(dent);
      const k = clamp((d - 0.22) / 0.78, 0, 1), ks = k * k * (3 - 2 * k);
      const phi = Math.atan2(nH.dot(e2), nH.dot(e1)), rho = Math.acos(clamp(d, -1, 1));
      const a = phi * 7 / TAU;
      const yosh = (tw(a + rho * 2.2) + tw(a - rho * 2.2)) * 0.5;       // diamond facets
      const hoop = tw(rho * 3.1 + 0.3);                                    // ring folds
      const rim = Math.exp(-(((k - 0.18) / 0.10) ** 2));                    // buckle at the edge
      const depth = ks * (0.40 + 0.20 * (0.5 - yosh)) + rim * 0.05 * (hoop - 0.5) + ks * 0.05 * (hoop - 0.5);
      const s = 1 - depth + fbm(_v.x * 1.4, _v.z * 1.4) * 0.05;
      pos.setXYZ(i, _v.x * s, _v.y * s, _v.z * s);
    }
    g.computeVertexNormals();
    p.add(grime(g, 1.0, 0.5, -3.2), M.iron);
  }
  // riveted meridian and equator straps
  for (const yy of [-1.55, 0, 1.55]) {
    const rr = Math.sqrt(Math.max(0.2, R * R - yy * yy));
    p.add(grime(xf(new THREE.TorusGeometry(rr, 0.12, 6, 26), 0, yy, 0, Math.PI / 2), 0.9, 0.5, -3.2), M.iron);
    rivetRing(p, M.iron, 20, rr * 1.03, yy, 0.085);
  }
  p.add(grime(xf(new THREE.TorusGeometry(R * 0.99, 0.11, 6, 26), 0, 0, 0, 0, Math.PI / 2), 0.9, 0.5, -3.2), M.iron);

  // ballast/instrument cylinder running aft, half torn open
  p.add(grime(xf(new THREE.CylinderGeometry(1.5, 1.7, 6.4, 16, 1, true), 0, -0.35, -5.4, Math.PI / 2 + 0.10, 0, 0), 1.0, 0.4, -3.2), M.iron);
  p.add(grime(xf(new THREE.CylinderGeometry(1.72, 1.72, 0.24, 16), 0, -0.95, -8.5, Math.PI / 2, 0, 0), 0.9, 0.4, -3.2), M.iron);
  for (let i = 0; i < 4; i++)
    rivetRing(p, M.iron, 16, 1.62, -1.5 + i * 1.7, 0.085, 'x');
  // split seam peeled back along the cylinder
  for (let i = 0; i < 10; i++) {
    const z = -3.0 - i * 0.55;
    p.add(grime(xf(new THREE.BoxGeometry(0.10, rng(0.5, 1.3), 0.6), rng(1.3, 1.9), rng(0.4, 1.2), z, rng(-0.5, 0.5), 0, rng(-0.8, 0.8)), 0.7, 0.7, -3.2), M.iron);
  }

  // conning tower + hatch, with the dogs still thrown
  p.add(grime(xf(new THREE.CylinderGeometry(0.95, 1.10, 1.5, 14, 1, true), 0, R * 0.86, 0.2), 1.0, 0.5, -3.2), M.iron);
  p.add(grime(xf(new THREE.CylinderGeometry(1.0, 1.0, 0.16, 14), 0, R * 0.86 + 0.78, 0.2), 0.9, 0.5, -3.2), M.iron);
  rivetRing(p, M.iron, 12, 1.03, R * 0.86 + 0.6, 0.075);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    p.add(xf(new THREE.BoxGeometry(0.42, 0.09, 0.13), Math.cos(a) * 1.0, R * 0.86 + 0.88, 0.2 + Math.sin(a) * 1.0, 0, -a, 0), M.brass);
  }

  // one porthole still lit — the whole point of the silhouette
  porthole(p, M, 0.62, 0.2, 0.45, R * 0.94, 0, true);
  porthole(p, M, 0.55, 2.30, 0.10, R * 0.60, 0.9, false);
  porthole(p, M, 0.55, -2.05, -0.35, R * 0.62, -0.9, false);

  // stabiliser fins and a bent skid, so she reads as a vehicle not a boiler
  for (const s of [1, -1]) {
    p.add(grime(xf(new THREE.BoxGeometry(0.14, 1.9, 2.6), s * 1.5, 0.4, -7.2, 0, 0, s * 0.25), 0.9, 0.5, -3.2), M.iron);
    p.add(grime(xf(new THREE.BoxGeometry(0.20, 0.28, 8.6), s * 2.0, -2.6, -3.0, 0.06, 0, s * 0.06), 0.85, 0.5, -3.2), M.iron);
    p.add(grime(xf(new THREE.CylinderGeometry(0.13, 0.13, 1.9, 6), s * 2.0, -1.7, 0.6, 0, 0, s * 0.35), 0.85, 0.5, -3.2), M.iron);
  }
  // severed lifting cable trailing off into the dark
  p.add(strand(V3(0.4, 4.6, 0.2), V3(6.5, 0.4, 4.2), 1.6, 0.055, 14), M.rope);

  p.bake();

  // relic: the finned brass air thruster, a backpack unit lying against the skid
  const rel = new THREE.Group();
  rel.position.set(2.55, 2.25, 1.95);   // propped against the sphere, clear of the silt
  rel.rotation.set(-0.22, 0.7, 0.95);
  {
    const r = Part(rel);
    for (const s of [-1, 1])
      r.add(xf(new THREE.CylinderGeometry(0.36, 0.36, 1.5, 12), s * 0.38, 0, 0), M.brass);   // twin bottles
    for (const s of [-1, 1]) {
      r.add(xf(new THREE.SphereGeometry(0.36, 12, 8, 0, TAU, 0, Math.PI / 2), s * 0.38, 0.75, 0), M.brass);
      r.add(xf(new THREE.SphereGeometry(0.36, 12, 8, 0, TAU, Math.PI / 2, Math.PI / 2), s * 0.38, -0.75, 0), M.brass);
      rivetRing(r, M.brass, 9, 0.38, 0.62, 0.04);
    }
    r.add(xf(new THREE.BoxGeometry(1.20, 0.14, 0.30), 0, 0.52, 0), M.brass);                 // yoke
    r.add(xf(new THREE.CylinderGeometry(0.10, 0.10, 1.05, 8), 0, 0.60, 0, 0, 0, Math.PI / 2), M.brass);
    // the nozzle and its fins
    r.add(xf(new THREE.CylinderGeometry(0.20, 0.34, 0.70, 12, 1, true), 0, -1.05, 0), M.brass);
    for (let i = 0; i < 5; i++)
      r.add(xf(new THREE.BoxGeometry(0.06, 0.55, 0.34).translate(0, 0, 0.24), 0, -1.05, 0, 0, i / 5 * TAU, 0), M.brass);
    r.add(xf(new THREE.TorusGeometry(0.34, 0.045, 4, 14), 0, -1.38, 0, Math.PI / 2), M.brass);
    // regulator dial, faintly alight
    r.add(xf(new THREE.CircleGeometry(0.13, 12), 0, 0.28, 0.40), M.lit);
    r.add(xf(new THREE.TorusGeometry(0.14, 0.03, 4, 12), 0, 0.28, 0.40), M.brass);
    r.add(xf(new THREE.BoxGeometry(0.30, 0.30, 0.16), 0, 0.28, 0.32), M.brass);
    r.bake();
  }
  root.add(rel);
  root.add(dustCloud(60, 6, 7, 6, 0xd0a080));

  return { root, relic: rel, hulls: [root] };
}

// ------------------------------------------------------- terrain sampling ----
// The EXACT rendered height of the terrain mesh (its own two-triangle split of each
// grid cell), plus its vertex colour (r = cavity AO, g = macro rock bias, b = height
// above the basin floor — terrain.js's encoding). A skirt that uses the terrain's own
// material with these colours IS terrain: same program, same palette, same caustics,
// same ripples; only its shape is ours. Read-only use of terrain.js exports.
let _AX = null, _AN = 0;
function axis() {
  if (_AX) return _AX;
  const P = terrainMeshes[0].geometry.attributes.position.array;
  _AN = Math.round(Math.sqrt(terrainMeshes[0].geometry.attributes.position.count));
  _AX = new Float32Array(_AN);
  for (let k = 0; k < _AN; k++) _AX[k] = P[k * 3];      // XZ topology never moves (terrain.js)
  return _AX;
}
function axFind(ax, x) {
  let lo = 0, hi = ax.length - 2;
  if (x <= ax[0]) return 0;
  if (x >= ax[hi + 1]) return hi;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ax[m] <= x) lo = m; else hi = m - 1; }
  return lo;
}
export function terrainSample(zi, x, z, col) {
  const ax = axis(), n = _AN, g = terrainMeshes[zi].geometry;
  const P = g.attributes.position.array, C = g.attributes.color.array;
  const k = axFind(ax, x), j = axFind(ax, z);
  const fx = clamp((x - ax[k]) / (ax[k + 1] - ax[k]), 0, 1), fz = clamp((z - ax[j]) / (ax[j + 1] - ax[j]), 0, 1);
  const ia = j * n + k, ib = (j + 1) * n + k, ic = (j + 1) * n + k + 1, id = j * n + k + 1;
  let wa, wb, wc, wd;
  if (fx + fz <= 1) { wa = 1 - fx - fz; wb = fz; wc = 0; wd = fx; }
  else { wa = 0; wb = 1 - fx; wc = fx + fz - 1; wd = 1 - fz; }
  if (col) for (let c = 0; c < 3; c++)
    col[c] = C[ia * 3 + c] * wa + C[ib * 3 + c] * wb + C[ic * 3 + c] * wc + C[id * 3 + c] * wd;
  return P[ia * 3 + 1] * wa + P[ib * 3 + 1] * wb + P[ic * 3 + 1] * wc + P[id * 3 + 1] * wd;
}

// A drift skirt around a footprint: NA bearings x NR rings, WORLD coordinates. fp[a] is
// the footprint radius on bearing a (a/NA of a turn); hFn(a)/wFn(a) the bank's height
// and width there. The inner ring sits inside the object at full bank height, the
// outer ring dips 3 cm under the exact mesh so the seam is buried; between them a
// concave drift profile. AO is darkened toward the contact line in the vertex colour.
const _tc = [0, 0, 0];
export function driftSkirt(zi, cx, cz, fp, hFn, wFn, innerK = 0.78, NR = 6) {
  const NA = fp.length, nv = NA * (NR + 1);
  const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = [];
  for (let a = 0; a < NA; a++) {
    const th = a / NA * TAU, cs = Math.cos(th), sn = Math.sin(th);
    const R0 = fp[a], H = hFn(a), W = wFn(a);
    const span = R0 * (1 - innerK) + W, s0 = R0 * (1 - innerK) / span;
    for (let r = 0; r <= NR; r++) {
      const sr = r / NR, s = sr * sr * 0.35 + sr * 0.65;           // rings bunch at the hull
      const rad = R0 * innerK + s * span;
      const x = cx + cs * rad, z = cz + sn * rad;
      const q = clamp((s - s0) / (1 - s0), 0, 1);
      const prof = (1 - q) * (1 - q) * (1 - 0.35 * q) * (1 + 0.12 * Math.sin(th * 5 + rad));
      const hm = terrainSample(zi, x, z, _tc);
      const y = r === NR ? hm - 0.03 : hm + Math.max(0.015, H * prof);
      const i = a * (NR + 1) + r;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col[i * 3] = _tc[0] * (0.52 + 0.48 * Math.min(1, q * 2.2 + 0.1 * (r === NR))); col[i * 3 + 1] = _tc[1]; col[i * 3 + 2] = _tc[2];
    }
  }
  for (let a = 0; a < NA; a++) {
    const a2 = (a + 1) % NA;
    for (let r = 0; r < NR; r++) {
      const i0 = a * (NR + 1) + r, i1 = a2 * (NR + 1) + r;
      idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // winding sanity: the skirt must face UP (terrain material is FrontSide)
  const nr = g.attributes.normal;
  if (nr.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

// The flow direction on the seabed (flora.js CUR0, the mean of its slow veer): the
// drift banks up on the downstream (lee) side of anything lying on the floor.
const CUR_A = 0.9;
export const leeOf = th => Math.max(0, Math.cos(th - CUR_A));

// Footprint of a wreck from its own hull vertices: every vertex within 1.2 u of the
// floor, binned by bearing around their centroid, the farthest per bin, gaps filled
// and blurred. So the skirt hugs a rolled skiff, a split trawler and a sphere alike.
const _fv = V3();
function wreckFootprint(zi, M, hulls, NA) {
  const xs = [], zs = [];
  for (const node of hulls) node.traverse(o => {
    if (!o.isMesh || (o.material !== M.wood && o.material !== M.iron)) return;
    const pa = o.geometry.attributes.position;
    for (let i = 0; i < pa.count; i += 2) {
      _fv.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
      if (_fv.y < terrainSample(zi, _fv.x, _fv.z) + 1.2) { xs.push(_fv.x); zs.push(_fv.z); }
    }
  });
  if (xs.length < 8) return null;
  let cx = 0, cz = 0;
  for (let i = 0; i < xs.length; i++) { cx += xs[i]; cz += zs[i]; }
  cx /= xs.length; cz /= xs.length;
  const fp = new Float32Array(NA);
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - cx, dz = zs[i] - cz;
    let th = Math.atan2(dz, dx); if (th < 0) th += TAU;
    const b = Math.min(NA - 1, Math.floor(th / TAU * NA)), d = Math.hypot(dx, dz);
    if (d > fp[b]) fp[b] = d;
  }
  // fill empty bins from their nearest filled neighbours, then two circular blurs
  for (let pass = 0; pass < NA; pass++) {
    let any = false;
    for (let a = 0; a < NA; a++) if (fp[a] === 0) {
      const l = fp[(a + NA - 1) % NA], r = fp[(a + 1) % NA];
      if (l || r) { fp[a] = l && r ? (l + r) / 2 : (l || r); } else any = true;
    }
    if (!any) break;
  }
  const tmp = new Float32Array(NA);
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < NA; a++) tmp[a] = (fp[(a + NA - 1) % NA] + 2 * fp[a] + fp[(a + 1) % NA]) / 4;
    fp.set(tmp);
  }
  for (let a = 0; a < NA; a++) fp[a] = Math.max(0.9, fp[a]);
  return { cx, cz, fp };
}

const SKIRT = [
  { h: 0.55, w: 2.4 },     // skiff: fine shelf sand, a soft bank
  { h: 0.85, w: 3.2 },     // trawler: the big hull piles the most
  { h: 0.45, w: 2.0 }      // submersible: ash drifts thin
];
const _gi = new THREE.Matrix4();
function buildSkirt(zi, M, hulls, g) {
  if (!terrainMeshes[zi]) return null;
  const F = wreckFootprint(zi, M, hulls, 40);
  if (!F) return null;
  const S = SKIRT[zi], NA = F.fp.length;
  const geo = driftSkirt(zi, F.cx, F.cz, F.fp,
    a => S.h * (0.35 + 0.65 * leeOf(a / NA * TAU)) * (0.85 + 0.3 * fbm(a * 0.37 + zi, 2.1)),
    a => S.w * (0.45 + 0.95 * leeOf(a / NA * TAU)) + 0.6 * fbm(a * 0.29, 5.3 + zi));
  _gi.copy(g.matrixWorld).invert();
  geo.applyMatrix4(_gi);                 // into the wreck's frame, so it rides with g
  const m = new THREE.Mesh(geo, terrainMeshes[zi].material);
  m.receiveShadow = true;
  m.userData.sharedMat = true;           // the TERRAIN's material: never dispose it
  g.add(m);
  return m;
}

// BARNACLES: calcite volcanoes scattered over the hull by the shader's own growth terms
// (up-facing + the waterline band) and clustered by a low noise, so shells crowd where
// the crust is thick and thin out at its edges. Written straight into one merged
// buffer in the wreck's frame (one draw, the 'grow' material). Deterministic from its
// own stream: the site's decorative stream is never consumed.
const SHELL = (() => {
  // profile (radius, height): foot, shoulder, rim, into the crater
  const prof = [[1.0, 0.0], [0.64, 0.58], [0.40, 0.70], [0.22, 0.34]];
  const SEG = 6, P = [], N = [], C = [], I = [];
  for (let s = 0; s <= SEG; s++) {
    const a = s / SEG * TAU, plate = s % 2 ? 0.86 : 1.0;
    for (let k = 0; k < prof.length; k++) {
      const r = prof[k][0] * (k < 2 ? plate : 1), y = prof[k][1];
      P.push(Math.cos(a) * r, y, Math.sin(a) * r);
      const ny = k === 3 ? -0.2 : 0.55, nl = Math.hypot(ny, 1);
      N.push(Math.cos(a) / nl * (k === 3 ? -1 : 1), ny / nl, Math.sin(a) / nl * (k === 3 ? -1 : 1));
      C.push(k === 3 ? 0.22 : (k === 2 ? 1.0 : 0.82));
    }
  }
  const np = prof.length;
  for (let s = 0; s < SEG; s++) for (let k = 0; k < np - 1; k++) {
    const a = s * np + k, b = (s + 1) * np + k;
    I.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return { P, N, C, I, nv: P.length / 3 };
})();
const SHELL_MAX = [600, 900, 600];
const SHELL_DENS = [9, 6, 6];            // candidate sites per square unit of hull
const _pa = V3(), _pb = V3(), _pc = V3(), _na = V3(), _nb = V3(), _nc = V3(), _pp = V3(), _pn = V3();
const _nm3 = new THREE.Matrix3(), _sm = new THREE.Matrix4(), _t1 = V3(), _t2 = V3();
const _qa = V3(), _qb = V3(), _qc = V3(), _qt1 = V3(), _qt2 = V3(), _pq = V3(), _qnm = new THREE.Matrix3();
function buildGrowth(zi, M, hulls, g, rnd) {
  _gi.copy(g.matrixWorld).invert();
  const outP = [], outN = [], outC = [], outI = [];
  let count = 0;
  const MAX = SHELL_MAX[zi];
  const place = (P, N, size, tone) => {
    // basis: Y along N, a random yaw about it (own temporaries: the caller's triangle
    // corners live in the module temps)
    _qt1.set(N.y * 0.3 + 0.1, -N.x, 0.2).cross(N).normalize();
    if (_qt1.lengthSq() < 0.1) _qt1.set(1, 0, 0);
    _qt2.crossVectors(N, _qt1).normalize();
    const yaw = rnd() * TAU, c = Math.cos(yaw), s = Math.sin(yaw);
    _qa.copy(_qt1).multiplyScalar(c).addScaledVector(_qt2, s).multiplyScalar(size);
    _qb.copy(_qt2).multiplyScalar(c).addScaledVector(_qt1, -s).multiplyScalar(size);
    const hy = size * (0.55 + 0.6 * rnd());
    _sm.makeBasis(_qa, _qc.copy(N).multiplyScalar(hy), _qb).setPosition(P);
    _sm.premultiply(_gi);
    _qnm.getNormalMatrix(_sm);
    const base = outP.length / 3;
    for (let v = 0; v < SHELL.nv; v++) {
      _qa.set(SHELL.P[v * 3], SHELL.P[v * 3 + 1], SHELL.P[v * 3 + 2]).applyMatrix4(_sm);
      _qb.set(SHELL.N[v * 3], SHELL.N[v * 3 + 1], SHELL.N[v * 3 + 2]).applyMatrix3(_qnm).normalize();
      outP.push(_qa.x, _qa.y, _qa.z); outN.push(_qb.x, _qb.y, _qb.z);
      const k = SHELL.C[v] * tone;
      outC.push(k * 0.97, k, k * 0.93);
    }
    for (const i of SHELL.I) outI.push(base + i);
    count++;
  };
  for (const node of hulls) node.traverse(o => {
    if (!o.isMesh || (o.material !== M.wood && o.material !== M.iron)) return;
    const geo = o.geometry, pos = geo.attributes.position, nor = geo.attributes.normal;
    const gro = geo.attributes.aGrow, idx = geo.index;
    _nm3.getNormalMatrix(o.matrixWorld);
    const nm = _nm3.clone();
    const tri = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < tri && count < MAX; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      _pa.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      _pb.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      _pc.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      const area = _t1.subVectors(_pb, _pa).cross(_t2.subVectors(_pc, _pa)).length() * 0.5;
      const want = area * SHELL_DENS[zi];
      let n = Math.floor(want) + (rnd() < want - Math.floor(want) ? 1 : 0);
      if (!n) continue;
      _na.fromBufferAttribute(nor, ia); _nb.fromBufferAttribute(nor, ib); _nc.fromBufferAttribute(nor, ic);
      const ga = gro ? gro.getX(ia) : 0, gb = gro ? gro.getX(ib) : 0, gc = gro ? gro.getX(ic) : 0;
      while (n-- > 0 && count < MAX) {
        let r1 = rnd(), r2 = rnd();
        if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
        const r0 = 1 - r1 - r2;
        _pp.set(_pa.x * r0 + _pb.x * r1 + _pc.x * r2, _pa.y * r0 + _pb.y * r1 + _pc.y * r2, _pa.z * r0 + _pb.z * r1 + _pc.z * r2);
        _pn.set(_na.x * r0 + _nb.x * r1 + _nc.x * r2, _na.y * r0 + _nb.y * r1 + _nc.y * r2, _na.z * r0 + _nb.z * r1 + _nc.z * r2).applyMatrix3(nm).normalize();
        const up = _pn.y, gw = Math.max(ga * r0 + gb * r1 + gc * r2, clamp((up - 0.28) / 0.57, 0, 1) * 0.9) * GROW_K[zi];
        const cl = fbm(_pp.x * 0.95 + zi * 3.1, _pp.z * 0.95 - _pp.y * 0.8);
        const p = clamp((gw * (0.4 + 0.9 * cl) - 0.32) / 0.3, 0, 1);
        if (rnd() > p) continue;
        if (_pp.y < terrainSample(zi, _pp.x, _pp.z) + 0.04) continue;      // buried
        // a small colony: 1-3 shells jittered in the tangent plane, one big one
        const nc = 1 + ((rnd() * 2.6) | 0);
        for (let q = 0; q < nc && count < MAX; q++) {
          const big = q === 0 ? 1 : 0.6;
          const sz = (0.04 + 0.10 * rnd() * rnd() + 0.04 * p) * big * [1.0, 1.25, 0.85][zi];
          _t1.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.22 * (q ? 1 : 0));
          _t1.addScaledVector(_pn, -_t1.dot(_pn));
          place(_pq.copy(_pp).add(_t1).addScaledVector(_pn, -0.01), _pn, sz, 0.62 + 0.4 * rnd());
        }
      }
    }
  });
  if (!count) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(outC, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(outP.length / 3 * 2), 2));
  geo.setAttribute('aGrow', new THREE.BufferAttribute(new Float32Array(outP.length / 3), 1));
  geo.setIndex(outI);
  const m = new THREE.Mesh(geo, M.grow);
  m.castShadow = false; m.receiveShadow = true;
  g.add(m);
  return count;
}

// ------------------------------------------------------------- placement -----
// Deterministic sweep for the flattest spot in the ring the brief allows, so wreck
// coordinates are stable between runs and can be quoted in a bug report.
function findSite(zi, minR, maxR, footprint) {
  const rp = riftPos(zi);
  let best = null;
  for (let ai = 0; ai < 48; ai++) {
    const a = ai / 48 * TAU;
    for (let ri = 0; ri < 9; ri++) {
      const rad = minR + (maxR - minR) * (ri / 8);
      const x = rp.x + Math.cos(a) * rad, z = rp.z + Math.sin(a) * rad;
      if (Math.hypot(x, z) > WORLD_R * 0.72) continue;         // stay off the basin rim
      if (zi === 0 && Math.hypot(x, z) < 55) continue;         // clear of the raft column
      const h0 = terrainH(x, z, zi);
      // Flatness decides where; the highest ground under the footprint decides how deep.
      // Bedding on the mean instead would let a mound swallow the hull whole.
      let dev = 0, hmax = h0;
      for (let k = 0; k < 8; k++) {
        const b = k / 8 * TAU;
        const h = terrainH(x + Math.cos(b) * footprint, z + Math.sin(b) * footprint, zi);
        dev = Math.max(dev, Math.abs(h - h0));
        hmax = Math.max(hmax, h);
      }
      if (!best || dev < best.dev) best = { x, z, y: hmax, dev };
    }
  }
  return best;
}

// ------------------------------------------------------------------ sites ----
// Where each wreck sits and how much ground it claims. `foot` feeds findSite's
// flatness sweep; `clear` is the keep-out radius flora honours (hull + deck
// clutter + net, measured from the authored geometry above).
const SITE_SPEC = [
  { minR: 70, maxR: 135, foot: 9, clear: 12 },
  { minR: 65, maxR: 138, foot: 13, clear: 17 },
  { minR: 62, maxR: 130, foot: 8, clear: 11 }
];

// Deterministic (findSite touches only the terrain field), so flora.js can ask for
// the sites before buildWrecks() has run without forcing a build order.
let SITES = null;
export function wreckSites() {
  if (!SITES) SITES = SITE_SPEC.map((s, zi) => {
    const site = findSite(zi, s.minR, s.maxR, s.foot);
    return { zi, x: site.x, y: site.y, z: site.z, clear: s.clear, site };
  });
  return SITES;
}

// ------------------------------------------------------------------ state ----
const WRECKS = [];
let built = false;

const WRECK_SPEC = [
  { make: skiff, tool: 'sonar', sink: 1.5, tilt: 0.55, glow: 0xffc472, cols: 6 },
  { make: trawler, tool: 'spear', sink: 2.2, tilt: 0.45, glow: 0xffb060, cols: 8 },
  { make: submersible, tool: 'thruster', sink: 1.0, tilt: 0.60, glow: 0xff9a52, cols: 5 }
];

export function buildWrecks() {
  if (built) return;
  built = true;

  // One fresh stream per build, keyed to the current site — layout (which decorative
  // rng call lands where: crates, worm bore, torn plating, splinters, dust) is a pure
  // function of the site, never of how many times this has run before. Every rng() and
  // Math.random() call under the hull builders below already funnels through global
  // Math.random, so redirecting it for the length of this synchronous build seeds the
  // whole tree without touching a single call site. Nothing yields inside this call
  // (no await, no rAF), so no other code can observe the swap.
  const siteRng = siteParams('wrecks').rng;
  const origRandom = Math.random;
  Math.random = siteRng;
  try {
    for (let zi = 0; zi < 3; zi++) {
      const S = WRECK_SPEC[zi];
      const site = wreckSites()[zi].site;
      const tB0 = performance.now();
      const M = palette(zi);
      const tB1 = performance.now();
      const W = S.make(M);
      const tB2 = performance.now();

      const g = new THREE.Group();
      g.add(W.root);
      g.position.set(site.x, site.y - S.sink, site.z);
      // settle into the silt: partially align with the ground so she lies with the slope
      const n = terrainNormal(site.x, site.z, zi);
      _q.setFromUnitVectors(UP, n).slerp(IDQ, 1 - S.tilt);
      g.quaternion.copy(_q.multiply(_q2.setFromAxisAngle(UP, zi * 2.1 + 0.6)));
      g.visible = false;
      scene.add(g);

      // relic marker + burst, parented to the wreck so they inherit the settle transform
      // Marker and burst share the relic's own parent frame, so they follow whatever
      // transform the hull section they sit on already carries.
      const host = W.relic.parent;
      const marker = relicMarker(S.glow);
      marker.position.copy(W.relic.position).y += 0.5;
      host.add(marker);
      const burst = burstFX(S.glow);
      burst.position.copy(W.relic.position);
      host.add(burst);

      // world-space relic position, for the cheap per-frame proximity test
      g.updateMatrixWorld(true);
      const wp = W.relic.getWorldPosition(new THREE.Vector3());

      // POLISH-WORLD: growth shells over the hull and the drift skirt banked against
      // its lee. Both are pure functions of the placed hull + site (own stream), both
      // parented to g (they ride its transform and die with it on reseed). Neither
      // touches colliders or the relic/keepsake frames.
      const gr = seededRand(0x6A0B7E5 + zi * 104729 + currentSiteIndex() * 7919);
      const tB3 = performance.now();
      const shells = buildGrowth(zi, M, W.hulls, g, gr);
      const tB4 = performance.now();
      const skirt = buildSkirt(zi, M, W.hulls, g);
      const tB5 = performance.now();
      g.userData.polish = { shells, skirt: !!skirt,
        ms: { palette: +(tB1 - tB0).toFixed(1), hull: +(tB2 - tB1).toFixed(1), growth: +(tB4 - tB3).toFixed(1), skirt: +(tB5 - tB4).toFixed(1) } };

      // hull colliders, authored in the wreck's local frame then baked to world
      const LOC = [
        [[-6, 2.6, 0, 3.4], [-1.5, 2.4, 0, 3.2], [3, 2.2, 0, 3.0], [7, 1.8, 0, 2.4], [-3.0, 0.4, 5.4, 1.2], [5.0, 1.4, 1.6, 1.6]],
        [[8.6, 3.6, -0.8, 3.6], [4.0, 3.4, -0.6, 3.6], [0.4, 3.2, 0.4, 2.6], [-4.4, 3.6, 0.9, 3.8], [-9.0, 3.8, 1.4, 3.6],
         [-6.0, 6.0, 1.1, 2.4], [-9.3, 8.4, 1.5, 1.6], [-12.6, 2.6, 1.1, 2.0]],
        [[0, 0.4, 0.3, 3.1], [0, 0.1, -3.2, 1.9], [0, -0.3, -6.4, 1.8], [0, 3.7, 0.2, 1.2], [0, -0.6, -8.6, 1.5]]
      ][zi];
      for (const [lx, ly, lz, lr] of LOC) {
        _v.set(lx, ly, lz).applyMatrix4(g.matrixWorld);
        wreckColliders.push({ x: _v.x, y: _v.y, z: _v.z, r: lr });
      }

      WRECKS.push({
        zi, grp: g, tool: S.tool, marker, burst, relic: W.relic,
        pos: wp, taken: false, burstT: 2, ph: zi * 2.1,
        // CHART V2: filled in by setKeepsakeState, which game.js calls after every reseed.
        keep: null, keepPos: null, keepLine: null, keepTaken: true,
        // the home mooring's line in his hand (setKeepsakeState builds it at site 0 only)
        mark: null, markPos: null, markLine: null, markRead: false
      });
    }
  } finally {
    Math.random = origRandom;
  }
}

// Disposes everything a rebuild would otherwise leak: geometries (every hull is re-carved
// per site) and per-instance materials (marker sprites, burst/dust shaders — none of them
// tagged `persist`). The palette materials (wood/iron/brass/rope/glass/lit) and relicGeo
// carry `persist`/are the shared module-scope primitive, so they survive untouched —
// disposing a material still in use by the next build would blank every future wreck.
function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry && o.geometry !== relicGeo) o.geometry.dispose();
    if (o.material && !o.userData.sharedMat) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (!m.userData || !m.userData.persist) m.dispose();
    }
  });
}

// THE CHART's reseed path: sail to a new site, the wrecks rebuild on the new floor.
// toolsOwned = {sonar, spear, thruster} — a relic whose tool is already in hand builds
// pre-taken (prop hidden from the start, no pickup burst; that burst is reserved for the
// moment of taking, not for a relic the diver walked in already holding).
export function reseedWrecks(toolsOwned) {
  for (const W of WRECKS) {
    scene.remove(W.grp);
    disposeGroup(W.grp);
  }
  WRECKS.length = 0;
  wreckColliders.length = 0;   // game.js/player.js hold this array's reference, not a copy
  SITES = null;                 // wreckSites() must recompute against the new terrain
  built = false;                 // let buildWrecks() run again through its normal gate

  buildWrecks();

  if (toolsOwned) {
    for (const W of WRECKS) {
      if (toolsOwned[W.tool]) {
        // Reuse takeRelic's hide statements, not the whole function — takeRelic() also
        // arms the pickup burst, which would fire on a relic nobody just picked up.
        W.taken = true;
        W.relic.visible = false;
        W.marker.visible = false;
      }
    }
  }
}

// ------------------------------------------------------------------ frame ----
export function updateWrecks(dt, t) {
  if (!built) return;
  uni.uTime.value = t;
  if (scene.fog) uni.uFogD.value = scene.fog.density;
  const cy = camera.position.y;
  for (let i = 0; i < WRECKS.length; i++) {
    const W = WRECKS[i];
    // Zone gating: nothing is visible from the neighbouring zone anyway, and this keeps
    // three wrecks' worth of geometry out of the culler for most of the game.
    const vis = cy < zoneTop(W.zi) + 110 && cy > zoneBottom(W.zi) - 130;
    W.grp.visible = vis;
    if (!vis) continue;
    if (!W.taken) {
      const u = W.marker.userData;
      const s = 1 + 0.16 * Math.sin(t * 1.7 + W.ph);
      u.core.rotation.y += dt * 0.8;
      u.core.rotation.x += dt * 0.31;
      u.g1.scale.setScalar(2.4 * s);
      u.g2.scale.setScalar(5.0 * (1.9 - s * 0.85));
      u.g2.material.opacity = 0.22 + 0.10 * Math.sin(t * 1.15 + W.ph);
    }
    // The keepsake's only motion: a turn so slow it is barely a tell, and no light at all.
    if (W.keep && !W.keepTaken) W.keep.rotation.y += dt * 0.16;
    if (W.burstT < 1) {
      W.burstT += dt * 0.9;
      W.burst.material.uniforms.uT.value = W.burstT;
      if (W.burstT >= 1) W.burst.visible = false;
    }
  }
}

// --------------------------------------------------------------- gameplay ----

// ---------------------------------------------------------------- keepsakes ---
// CHART V2. At the home mooring the relics are still in their berths and there is nothing
// else to find. At every REMOTE site the berth was emptied long before Sal got there — the
// tools are already in his hands — and what is left beside it is the small thing the
// previous chart-owner carried and did not take home. One per wreck, one line each.
//
// Deliberately UNBEACONED: no marker sprite, no halo, no glow of any kind, unlike the
// relics. A relic is a landmark the chart promises you; a keepsake is only found by being
// at the wreck and looking down. It reads at ~6 units off silhouette alone, which is why
// the shapes are taken at 2.2x their true size at the berth (1.0x on the raft shelf, where
// the eye is half a metre away).
const KEEP_SCALE = 2.2;
// Where the keepsake sits relative to the relic berth: a stride off it, laid down rather
// than stowed. Parented to the relic's own host, so it inherits the wreck's settle tilt.
const KEEP_OFF = [0.46, 0.10, 0.42];

// The lines. Sites 1 and 2 are one man, the owner whose chart Sal is now inking, told in
// nine words at a time and never in the first person — he does not get to speak, he only
// gets to have left things.
//
// SITE 3 IS NOT HIS. THE UNSOUNDED SHELF reads 'NO SOUNDINGS. THE OWNER NEVER CAME.' — so
// its berths carry things that were down there before any chart was drawn, and the lines
// have to say so without ever explaining it.
const KEEP_LINE = [
  // THE HOME MOORING. The skiff in the shallows is HIS boat. The relics are still in
  // their berths because he never came back up for them; the one thing of his that is
  // still aboard is the instrument a man keeps on his person, not in a locker.
  [
    'A POCKET SEXTANT, THE ARM STILL SET. HE KNEW WHERE HE WAS. HE WENT DOWN ANYWAY.',
    null,
    null
  ],
  [
    'A PIPE, BITTEN THROUGH. HE WAITED BADLY.',
    'A WATCH, STOPPED AT SLACK WATER. HE NEVER WOUND IT AGAIN.',
    'A TIN CUP, SCOURED THIN. HE TOOK HIS RATION COLD, AND ALONE.'
  ],
  [
    'A CLASP KNIFE, FOLDED SHUT. HE CUT HIMSELF FREE ONCE, AND KEPT IT.',
    'A BRASS BUTTON OFF A COAT HE DID NOT COME BACK FOR.',
    'A TOBACCO TIN OF ASH. HE WAS KEEPING SOMETHING BURNT.'
  ],
  [
    "A DOLL'S HEAD, SALT-WHITE. NO BOAT IN THIS REGISTER CARRIED CHILDREN.",
    'A COIN STRUCK WITH NO FACE AND NO YEAR. IT IS NOT WORN. IT WAS MADE SO.',
    'A KEY OF BLACK GLASS. THE OWNER NEVER CAME. SOMETHING ELSE DID.'
  ]
];

// ---- THE MARKS: three lines in his own hand, home mooring only ---------------------
// The keepsake lines above are told ABOUT him. These three are HIS: scored with a knife
// point into a scrap of plating and left propped at each home wreck on the way down —
// the skiff he dived from, the trawler he passed, the submersible he read the odds off.
// Together they are the only place the game says it plainly: he dove here, he did not
// come back, and whoever reads the last one is the one who does. Sal reads them the way
// he takes a keepsake ([E] in reach), but a scratch on iron is not a thing you pocket:
// the plate stays, the line shows once per build, nothing is saved.
const MARK_LINE = [
  'SHE WENT OVER IN A FLAT CALM. I HAVE GONE DOWN TO SEE WHAT DID IT.',
  'THE TRAWLER IS IN TWO PIECES. NOTHING ON ANY CHART DOES THAT. LOWER, THEN.',
  'THEY HAD IRON. I HAVE CANVAS AND A LINE. WHOEVER READS THIS IS THE ONE WHO COMES BACK.'
];
// Where each plate leans, in the relic host's frame: a few strides off the berth, so the
// keepsake beside the sounding set and the plate on the skiff are two separate walks.
const MARK_OFF = [[-2.8, 0.05, 1.9], [2.6, 0.05, 1.7], [-2.3, 0.05, -2.2]];
const MARK_SCALE = 2.2;

// A scrap of plating with three ragged rows of knife-scored strokes — legible as
// WRITING at six units, as nothing in particular at twenty. Seeded off the zone so the
// three hands are the same hand every boot. True-size like the keepsakes (a 0.19 m
// plate), taken at the berth scale.
function markGeo(zi, scale) {
  const rand = seededRand(0x5C0AED + zi * 131);
  const out = [];
  const W = 0.19, Hh = 0.13, T = 0.006;
  // the plate, leaning back a little on its bottom edge
  const lean = -0.22;
  const place = (g, x, y, z) => {
    _o.position.set(x, y, z); _o.rotation.set(lean, 0, 0); _o.scale.setScalar(1); _o.updateMatrix();
    return g.applyMatrix4(_o.matrix);
  };
  const plate = new THREE.BoxGeometry(W, Hh, T);
  out.push({ g: place(plate, 0, Hh * 0.5, 0), m: 'iron' });
  // the strokes: three rows, words as runs of short raised nicks with gaps between them
  for (let row = 0; row < 3; row++) {
    const y = Hh * (0.80 - row * 0.27);
    let x = -W * 0.42;
    const xEnd = W * (0.30 + rand() * 0.14);
    while (x < xEnd) {
      const len = 0.006 + rand() * 0.016;
      const tilt = (rand() - 0.5) * 0.5;
      const g = new THREE.BoxGeometry(len, 0.0045, 0.004);
      _o.position.set(x + len * 0.5, y + (rand() - 0.5) * 0.006, T * 0.5 + 0.001);
      _o.rotation.set(0, 0, tilt); _o.scale.setScalar(1); _o.updateMatrix();
      g.applyMatrix4(_o.matrix);
      out.push({ g: place(g, 0, Hh * 0.5, 0), m: 'brass' });
      x += len + (rand() < 0.28 ? 0.012 : 0.003);
    }
  }
  if (scale !== 1) for (const o of out) o.g.scale(scale, scale, scale);
  return out;
}

function buildMark(W) {
  const grp = new THREE.Group();
  const P = Part(grp);
  const M = palette(W.zi);
  for (const o of markGeo(W.zi, MARK_SCALE)) P.add(o.g, M[o.m]);
  P.bake();
  const host = W.relic.parent;
  const off = MARK_OFF[W.zi];
  grp.position.copy(W.relic.position).add(_v.set(off[0], off[1], off[2]));
  // face the plate roughly back toward the berth, so it reads from the relic's side
  grp.rotation.y = Math.atan2(-off[0], -off[2]) + 0.35;
  host.add(grp);
  W.grp.updateMatrixWorld(true);
  W.mark = grp;
  W.markPos = grp.getWorldPosition(new THREE.Vector3());
  W.markLine = MARK_LINE[W.zi];
  W.markRead = false;
}

// Called by game.js after every reseedWrecks, with this site's per-wreck taken flags.
// Idempotent: builds the prop once per wreck build, then only toggles visibility.
export function setKeepsakeState(taken3) {
  if (!built) return;
  const si = currentSiteIndex();
  const lines = KEEP_LINE[si];
  for (const W of WRECKS) {
    const kind = lines ? keepsakeKind(si, W.zi) : null;
    // A save from before the home mooring had a keepsake carries no site-0 row (or a
    // short one): read defensively, a missing flag is 'still there'.
    const taken = !!(taken3 && taken3.length > W.zi && taken3[W.zi]);
    const want = !!kind && !taken;
    // his three marks exist at the home mooring only; built once per wreck build
    if (si === 0 && !W.mark) buildMark(W);
    if (W.mark) W.mark.visible = si === 0;
    if (want && !W.keep) {
      const grp = new THREE.Group();
      const P = Part(grp);
      const M = palette(W.zi);
      // ONE material, so the whole keepsake is one draw call. Brass is the right read for
      // a thing a man kept in a pocket for years, and the odd one out (the doll, the glass
      // key) gains from being the same dull metal as everything else down here.
      for (const g of keepsakeGeo(kind, KEEP_SCALE)) P.add(g, M.brass);
      P.bake();
      const host = W.relic.parent;
      grp.position.copy(W.relic.position)
        .add(_v.set(KEEP_OFF[0], KEEP_OFF[1], KEEP_OFF[2]));
      grp.rotation.y = W.zi * 1.9 + 0.4;
      host.add(grp);
      W.grp.updateMatrixWorld(true);
      W.keep = grp;
      W.keepPos = grp.getWorldPosition(new THREE.Vector3());
      W.keepLine = lines[W.zi];
    }
    if (W.keep) { W.keep.visible = want; W.keepTaken = !want; }
  }
}

const within = (pos, q) => {
  const dx = pos.x - q.x, dy = pos.y - q.y, dz = pos.z - q.z;
  return dx * dx + dy * dy + dz * dz < RELIC_REACH * RELIC_REACH;
};
const keepNear = (W, pos) => !!W.keep && !W.keepTaken && W.keep.visible && within(pos, W.keepPos);
const markNear = (W, pos) => !!W.mark && W.mark.visible && !W.markRead && within(pos, W.markPos);

// Reach test, the relic's own pattern and the relic's own reach. The keepsake outranks
// the mark at the same wreck: on the skiff the sextant and his plate are both within a
// stride of the berth, and the thing you can pocket is the thing [E] takes first.
export function nearKeepsake(pos) {
  if (!built) return null;
  for (let i = 0; i < WRECKS.length; i++) {
    const W = WRECKS[i];
    if (keepNear(W, pos)) return { zi: W.zi };
  }
  for (let i = 0; i < WRECKS.length; i++) {
    const W = WRECKS[i];
    if (markNear(W, pos)) return { zi: W.zi, mark: true };
  }
  return null;
}

export function takeKeepsake(zi) {
  const W = WRECKS.find(w => w.zi === zi);
  if (!W) return null;
  if (W.keep && !W.keepTaken && W.keep.visible) {
    W.keepTaken = true;
    W.keep.visible = false;
    return { line: W.keepLine };
  }
  if (markNear(W, player.pos)) {
    W.markRead = true;
    return { line: W.markLine, mark: true };
  }
  return null;
}

export function nearRelic(pos) {
  if (!built) return null;
  for (let i = 0; i < WRECKS.length; i++) {
    const W = WRECKS[i];
    if (W.taken) continue;
    const dx = pos.x - W.pos.x, dy = pos.y - W.pos.y, dz = pos.z - W.pos.z;
    if (dx * dx + dy * dy + dz * dz < RELIC_REACH * RELIC_REACH) return { zi: W.zi, tool: W.tool };
  }
  return null;
}

export function takeRelic(zi) {
  const W = WRECKS.find(w => w.zi === zi);
  if (!W || W.taken) return null;
  W.taken = true;
  W.relic.visible = false;
  W.marker.visible = false;
  W.burst.visible = true;
  W.burstT = 0;
  W.burst.material.uniforms.uT.value = 0;
  return W.tool;
}

// Dev/automation surface, namespaced so it can't collide with the harness globals.
window.wrecks = {
  goto(zi) {
    const W = WRECKS[zi];
    if (!W) return 'no wreck ' + zi;
    player.pos.set(W.pos.x + 1.4, W.pos.y + 1.6, W.pos.z + 1.4);
    player.vel.set(0, 0, 0);
    return `wreck ${zi} @ ${W.pos.x.toFixed(1)}, ${W.pos.y.toFixed(1)}, ${W.pos.z.toFixed(1)}`;
  },
  // Park the diver at discovery range, looking at the silhouette through the fog.
  view(zi, dist = 45) {
    const W = WRECKS[zi];
    if (!W) return 'no wreck ' + zi;
    player.pos.set(W.pos.x + dist * 0.8, W.pos.y + 9, W.pos.z + dist * 0.6);
    player.vel.set(0, 0, 0);
    return 'viewing ' + zi;
  },
  list: () => WRECKS.map(W => ({
    zi: W.zi, tool: W.tool, taken: W.taken,
    x: +W.pos.x.toFixed(1), y: +W.pos.y.toFixed(1), z: +W.pos.z.toFixed(1)
  })),
  near: p => nearRelic(p || player.pos),
  // CHART V2: what the keepsake layer thinks is out there, for the same reason `list` exists.
  keeps: () => WRECKS.map(W => ({
    zi: W.zi, has: !!W.keep, taken: W.keepTaken, shown: !!W.keep && W.keep.visible,
    line: W.keepLine,
    x: W.keepPos && +W.keepPos.x.toFixed(1), y: W.keepPos && +W.keepPos.y.toFixed(1),
    z: W.keepPos && +W.keepPos.z.toFixed(1)
  })),
  nearKeep: p => nearKeepsake(p || player.pos),
  // The home mooring's marks: his three lines, and where each plate leans.
  marks: () => WRECKS.map(W => ({
    zi: W.zi, has: !!W.mark, shown: !!W.mark && W.mark.visible, read: W.markRead, line: W.markLine,
    x: W.markPos && +W.markPos.x.toFixed(1), y: W.markPos && +W.markPos.y.toFixed(1),
    z: W.markPos && +W.markPos.z.toFixed(1)
  })),
  gotoMark(zi) {
    const W = WRECKS[zi];
    if (!W || !W.markPos) return 'no mark ' + zi;
    player.pos.set(W.markPos.x + 0.8, W.markPos.y + 0.9, W.markPos.z + 0.8);
    player.vel.set(0, 0, 0);
    return `mark ${zi} @ ${W.markPos.x.toFixed(1)}, ${W.markPos.y.toFixed(1)}, ${W.markPos.z.toFixed(1)}`;
  },
  // Park the diver right on a keepsake, the way goto() parks him on a relic.
  gotoKeep(zi) {
    const W = WRECKS[zi];
    if (!W || !W.keepPos) return 'no keepsake ' + zi;
    player.pos.set(W.keepPos.x + 0.8, W.keepPos.y + 0.9, W.keepPos.z + 0.8);
    player.vel.set(0, 0, 0);
    return `keepsake ${zi} @ ${W.keepPos.x.toFixed(1)}, ${W.keepPos.y.toFixed(1)}, ${W.keepPos.z.toFixed(1)}`;
  },
  colliders: () => wreckColliders.slice(),
  // POLISH-WORLD probe: shells/skirt per wreck, and the skiff's stove-in hole in world
  // space (centre + outward normal) so a capture can be aimed at it.
  polish: () => WRECKS.map(W => {
    const o = { zi: W.zi, ...W.grp.userData.polish };
    W.grp.traverse(n => {
      if (n.userData && n.userData.hole) {
        const h = n.userData.hole;
        const p = h.o.clone().applyMatrix4(n.matrixWorld);
        const q = h.n.clone().transformDirection(n.matrixWorld);
        o.hole = [p.x, p.y, p.z, q.x, q.y, q.z].map(v => +v.toFixed(2));
      }
    });
    return o;
  })
};
