// SCULPTED SAL — installs the pipeline-built Mark V (entities/salSculpt.js, baked by
// `node tools/blender/build.mjs sal` into assets/sal/) onto the procedural rig in diver.js.
// OWNED BY: the sculpt pipeline (branch salsculpt). diver.js calls installSalSculpt(diver,
// salShared) once, at the end of its module; nothing else in diver.js knows about this.
//
// THE CONTRACT: the rig is untouched. Every sculpted piece was authored in the frame of
// the group it rides (neck, spine, hips, pack, each limb's root/mid/end), so the swap is
// "retire the procedural meshes on that group, add the sculpted one". Gait, breath, knife
// and lantern timings, stepCount, LIFT/SOLE_Y, airInletWorldPos, the tether dock, the
// ladder pose and the lantern light all keep running on the same groups, bit-identical.
// The procedural build is the FALLBACK: loadSculpted never throws; a missing/bad asset
// (or ?salproc, the A/B switch) leaves the procedural man exactly as he was.
//
// KEPT PROCEDURAL (they ride the same groups and already do their job): the port glass
// and its dark recess (salGlass1), the braided feed hose and its brass ferrules, the knife
// and scabbard, the lantern, the slash's water-drag arc, the exhaust bubbles.
//
// (salreal: the rigid build below is now the SECOND choice — the skinned dress, further down,
// answers the two objections: skinned movers get motion vectors in postfx.taa.js, and the
// inside of a closing joint takes its gathers from the wrinkle map + a corrective push.)
// DEFORMATION — WHY RIGID SEGMENTS (evidence, not taste):
//  - The walk is the procedural rig's segment hierarchy driven by IK (driveLegs) and
//    curves; a SkinnedMesh would need a Skeleton of THREE.Bones mirroring those groups,
//    a bone-palette upload per frame and a second shadow/velocity path (postfx.taa.js's
//    velocity proxies SKIP skinned meshes: `o.isSkinnedMesh` returns early, so a skinned
//    dress would ghost under TAA). Rigid meshes keep exact motion vectors for free.
//  - Linear-blend skinning of canvas at the swim kick's knee (1.45 rad) and the elbow
//    (up to ~1.6 rad) collapses volume on the inner side — precisely where real canvas
//    GATHERS into folds. Sculpted rigid segments put the gathers there as geometry.
//  - Continuity: each lower segment carries a JOINT BALL centred on its pivot with the
//    upper segment's end radius, and the upper segment's cap is buried in it, so the
//    silhouette is closed at every angle the rig reaches (rotation about the pivot maps
//    the ball onto itself) — closed by construction, and checked live through the walk
//    cycle and the swim kick's 1.45 rad knee (look-dev captures, no gaps, no popping).
//
// MATERIALS: one MeshStandardMaterial per texture set (helm / torso / limbs; limbs has a
// mirrored twin for the right side, normalScale.y = -1 because a mirrored tangent frame
// flips the bitangent). ORM: R = AO, G = roughness, B = METALNESS (the bake's emit channel;
// meta sets.<s>.ormB === 'metal'), so one draw carries brass, copper, lead, canvas and
// leather. On top (one injected block, salSculpt1):
//  - WET: the dress soaks and dries on diver.js's uSalWet clock, helmet first (uSalRootY):
//    non-metals darken and gloss, metals gloss a little — the procedural suit's look;
//  - WEAVE: the procedural dress's own generated twill / heavy duck (lib/textures twillSet,
//    canvasSet, shared, no new textures) TRIPLANAR in the bone's space on the cloth texels
//    (non-metal, and canvas-tan or duck-blue by the baked albedo: leather and rubber are
//    left alone), faded out by screen footprint so it never shimmers at game distance.
// Cost: helm 2048 set ~13.6 MB GPU + body/limbs 1024 sets ~3.2 MB each = ~20 MB; download
// 8.3 MB on the KTX2 path (3.7 MB WebP fallback).
import * as THREE from 'three';
import { envTex } from '../core.js';
import { registerPaint, styleUniforms } from '../lib/paint.js';
import { loadSculpted, assetTextures } from '../lib/assets.js';
import { patchNormalRG } from '../lib/microDetail.js';
import { twillSet, canvasSet } from '../lib/textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ON = typeof location === 'undefined' || !/[?&]salproc\b/.test(location.search);
const LAB = typeof location !== 'undefined' && /[?&]lab\b/.test(location.search);
// THREE BUILDS, best first (salreal): the SKINNED Sal (assets/salskin, salSkinSculpt.js) —
// a continuous dress that bends and creases with the pose; if it is missing, incomplete or
// baked to a different rig, the RIGID sculpt (assets/sal, salSculpt.js; fetched only then);
// if that fails too, the procedural man. ?salrigid = A/B the rigid sculpt, ?salproc = the
// procedural one.
const RIGID_ONLY = typeof location !== 'undefined' && /[?&]salrigid\b/.test(location.search);
const SKIN = ON && !RIGID_ONLY ? loadSculpted('assets/salskin/', 'salSkin') : Promise.resolve(null);
let RIGID = null;
const rigidAsset = () => RIGID || (RIGID = ON ? loadSculpted('assets/sal/', 'sal') : Promise.resolve(null));
if (RIGID_ONLY) rigidAsset();

const SS_VS = `
varying vec3 vSsP; varying vec3 vSsN; varying float vSsY;
uniform float uSalRootY;`;
const SS_FS = `
uniform sampler2D tSsTw; uniform sampler2D tSsTwN; uniform sampler2D tSsDk; uniform sampler2D tSsDkN;
uniform float uSalWet; uniform float uPaintK; uniform vec4 uSsK;
varying vec3 vSsP; varying vec3 vSsN; varying float vSsY;
vec4 ssTri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
vec3 ssTriN(sampler2D t, vec3 p, vec3 w) {
  vec2 a = texture2D(t, p.zy).xy * 2.0 - 1.0, b = texture2D(t, p.xz).xy * 2.0 - 1.0, c = texture2D(t, p.xy).xy * 2.0 - 1.0;
  return w.x * vec3(0.0, a.y, a.x) + w.y * vec3(b.x, 0.0, b.y) + w.z * vec3(c.x, c.y, 0.0);
}
float ssCloth; float ssDuck; float ssFade; float ssWet; vec3 ssW; vec3 ssPt; vec3 ssPd;`;
// after metalnessmap_fragment: diffuseColor, roughnessFactor, metalnessFactor all final
const SS_FS_MAT = `
{
  float met = clamp(metalnessFactor, 0.0, 1.0);
  float nonMet = 1.0 - smoothstep(0.25, 0.55, met);
  vec3 alb = diffuseColor.rgb;
  float lum = dot(alb, vec3(0.2126, 0.7152, 0.0722));
  ssDuck = nonMet * smoothstep(0.015, 0.05, alb.b - alb.r);
  float tan = nonMet * smoothstep(0.045, 0.09, lum) * (1.0 - smoothstep(0.0, 0.03, alb.b - alb.r)) * smoothstep(0.01, 0.04, alb.r - alb.b);
  ssCloth = max(tan, ssDuck);
  vec3 no = normalize(vSsN);
  ssW = pow(abs(no), vec3(4.0)); ssW /= (ssW.x + ssW.y + ssW.z);
  ssPt = vSsP * uSsK.x; ssPd = vSsP * uSsK.y;
  vec3 fw = fwidth(ssPt);
  ssFade = (1.0 - smoothstep(0.35, 0.9, max(max(fw.x, fw.y), fw.z))) * ssCloth;
  if (ssFade > 0.002) {
    vec4 tw = ssTri(tSsTw, ssPt, ssW), dk = ssTri(tSsDk, ssPd, ssW);
    vec4 pk = mix(tw, dk, ssDuck);
    diffuseColor.rgb *= mix(1.0, mix(0.86, 1.14, pk.r * 0.55 + pk.b * 0.45), ssFade * uSsK.z);
    roughnessFactor *= mix(1.0, 0.86 + 0.28 * pk.b, ssFade);
  }
  ssWet = clamp(uSalWet * 1.6 - vSsY * 0.22, 0.0, 1.0);
  diffuseColor.rgb *= 1.0 - 0.40 * ssWet * nonMet;
  roughnessFactor = mix(roughnessFactor, 0.30, ssWet * 0.8 * nonMet);
  roughnessFactor *= 1.0 - 0.25 * ssWet * (1.0 - nonMet);
  roughnessFactor = clamp(roughnessFactor, 0.06, 1.0);
}`;
const SS_FS_NRM = `
if (ssFade > 0.002) {
  vec3 d = mix(ssTriN(tSsTwN, ssPt, ssW), ssTriN(tSsDkN, ssPd, ssW), ssDuck);
  normal = normalize(normal + normalMatrix * d * (uSsK.w * ssFade * (1.0 - 0.65 * uPaintK) * (1.0 - 0.5 * ssWet)));
}`;

function sculptMat(maps, shared, o = {}) {
  const tw = twillSet(), dk = canvasSet();
  const m = new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.ormMap, aoMap: maps.ormMap, metalnessMap: maps.ormMap,
    aoMapIntensity: o.ao != null ? o.ao : 0.85, normalScale: new THREE.Vector2(o.ns || 1, (o.ns || 1) * (o.mirror ? -1 : 1)),
    roughness: 1, metalness: 1, envMap: envTex, envMapIntensity: o.env != null ? o.env : 0.5
  });
  const U = {
    tSsTw: { value: tw.pack }, tSsTwN: { value: tw.nrm }, tSsDk: { value: dk.pack }, tSsDkN: { value: dk.nrm },
    // x twill tiles/unit (~2 mm thread, the procedural dress's 13), y duck (11), z albedo k, w normal k
    uSsK: { value: new THREE.Vector4(13, 11, 0.9, 0.55) },
    uSalWet: shared.uSalWet, uSalRootY: shared.uSalRootY, uPaintK: styleUniforms.uPaintK
  };
  m.userData.salSculpt = U;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SS_VS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSsP = position; vSsN = normal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSsY = (modelMatrix * vec4(transformed, 1.0)).y - uSalRootY;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform mat3 normalMatrix;\n' + SS_FS)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + SS_FS_MAT)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SS_FS_NRM);
  };
  m.customProgramCacheKey = () => 'salSculpt1';
  if (maps.normalMap && maps.normalMap.userData.rg) patchNormalRG(m);
  return m;
}

// the procedural meshes on a rig group that the sculpt replaces (direct children only:
// sub-groups — the knife rig, the lantern, the exhaust marker — are never touched)
function retireable(o, keep) {
  if (!o.isMesh || o.isInstancedMesh) return false;
  const m = o.material, key = m && m.customProgramCacheKey && m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey() : '';
  if (key === 'salGlass1' || key === 'salHose1') return false;            // port glass, feed hose
  if (m && m.blending === THREE.AdditiveBlending) return false;           // the slash's drag arc
  return !(keep && keep(o));
}

const STATE = { installed: false, mode: 'procedural', reason: ON ? 'loading' : 'off (?salproc)', skinReason: '', ms: 0, meshes: [], stash: [], tris: 0, warn: [], skinned: [] };

export function installSalSculpt(diver, shared) {
  portGlass(diver);                 // the glass is kept procedural: fixed whether or not the sculpt lands
  SKIN.then(A => {
    if (A) {
      try { if (installSkinned(diver, shared, A)) return; } catch (e) {
        console.warn('ABYSSA: skinned Sal failed to install, falling back to the rigid sculpt', e);
        STATE.skinReason = 'install threw: ' + e.message;
        undoSkinned();
      }
    } else if (ON && !RIGID_ONLY) STATE.skinReason = 'skinned asset unavailable';
    return rigidAsset().then(R => {
      if (!R) { STATE.reason = ON ? 'asset unavailable — procedural Sal kept' : STATE.reason; return; }
      try { install(diver, shared, R); } catch (e) { console.warn('ABYSSA: sculpted Sal failed to install, keeping the procedural build', e); STATE.reason = 'install threw: ' + e.message; }
    });
  });
}

function install(diver, shared, A) {
  const g = A.geos, meta = A.meta.meta || {}, sets = A.meta.sets || {};
  const need = ['helmet', 'corselet', 'hips', 'pack', 'upperArm', 'foreArm', 'gloveL', 'gloveR', 'thighL', 'thighR', 'shin', 'boot'];
  const miss = need.filter(k => !g[k]);
  if (miss.length || !A.maps.helm || !A.maps.body || !A.maps.limbs) { STATE.reason = 'asset incomplete: ' + miss.join(','); return; }
  if (Object.values(sets).some(s => s.ormB !== 'metal')) { STATE.reason = 'asset ORM.B is not metalness'; return; }
  // ---- the rig check: the bake recorded the rig it was sculpted to ----
  const R = meta.rig || {}, dL = diver.legL, dA = diver.armL;
  const live = { armUp: -dA.mid.position.y, armLo: -dA.end.position.y, legUp: -dL.mid.position.y, legLo: -dL.end.position.y };
  const baked = { armUp: R.armL && R.armL.up, armLo: R.armL && R.armL.lo, legUp: R.legL && R.legL.up, legLo: R.legL && R.legL.lo };
  const stretch = {};
  for (const k in live) {
    if (baked[k] == null) continue;
    stretch[k] = live[k] / baked[k];
    if (Math.abs(live[k] - baked[k]) > 1e-4) STATE.warn.push(k + ' baked ' + baked[k] + ' live ' + +live[k].toFixed(4) + ' — stretched; re-bake: node tools/blender/build.mjs sal');
  }
  if (Math.abs((R.helmS != null ? R.helmS : 1) - diver.helmGroup.scale.x) > 1e-3) STATE.warn.push('helmet scale baked ' + (R.helmS != null ? R.helmS : 1) + ' live ' + diver.helmGroup.scale.x);
  if (STATE.warn.length) console.warn('ABYSSA: sculpted Sal was baked to a different rig:\n' + STATE.warn.join('\n'));
  if (Object.values(stretch).some(s => s < 0.85 || s > 1.15)) { STATE.reason = 'rig changed too far from the bake (' + JSON.stringify(stretch) + ') — procedural kept; re-bake'; console.warn('ABYSSA: ' + STATE.reason); return; }

  // HERO under the paint law (review round 2): the dial's matte floor and its 0.61 normal
  // scale flattened the sculpted folds at 9 u on the dry deck; Sal is the hero character
  // and his relief is geometry, not a texture to be stylised away (the brass and copper
  // were already hero on the procedural Sal)
  const helmMat = registerPaint(sculptMat(A.maps.helm, shared, { env: 0.55, ao: 0.9 }), { hero: true });
  const torsoMat = registerPaint(sculptMat(A.maps.body, shared, { env: 0.45 }), { hero: true });
  const limbMat = registerPaint(sculptMat(A.maps.limbs, shared, { env: 0.4, ns: 1.15 }), { hero: true });
  const limbMatM = registerPaint(sculptMat(A.maps.limbs, shared, { env: 0.4, ns: 1.15, mirror: true }), { hero: true });

  const swap = (node, geo, mat, o = {}) => {
    for (const c of node.children.slice()) if (retireable(c, o.keep)) {
      node.remove(c);
      if (LAB) STATE.stash.push([node, c]); else c.geometry.dispose();       // materials are shared module-level: never disposed here
    }
    const m = new THREE.Mesh(geo, mat);
    m.name = 'salSculpt:' + o.name;
    m.castShadow = true; m.receiveShadow = true;
    if (o.mirror) m.scale.x = -1;
    if (o.sy) m.scale.y = o.sy;
    node.add(m);
    STATE.meshes.push(m);
    STATE.tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    return m;
  };
  swap(diver.helmGroup, g.helmet, helmMat, { name: 'helmet' });
  swap(diver.cors, g.corselet, helmMat, { name: 'corselet' });
  swap(diver.hips, g.hips, torsoMat, { name: 'hips' });
  swap(diver.pack, g.pack, torsoMat, { name: 'pack' });
  for (const [arm, R2] of [[diver.armL, false], [diver.armR, true]]) {
    const mat = R2 ? limbMatM : limbMat;
    swap(arm.root, g.upperArm, mat, { name: 'upperArm', mirror: R2, sy: stretch.armUp });
    swap(arm.mid, g.foreArm, mat, { name: 'foreArm', mirror: R2, sy: stretch.armLo });
    swap(arm.end, R2 ? g.gloveR : g.gloveL, mat, { name: R2 ? 'gloveR' : 'gloveL', mirror: R2 });
  }
  for (const [leg, R2] of [[diver.legL, false], [diver.legR, true]]) {
    const mat = R2 ? limbMatM : limbMat;
    swap(leg.root, R2 ? g.thighR : g.thighL, mat, { name: R2 ? 'thighR' : 'thighL', mirror: R2, sy: stretch.legUp });
    swap(leg.mid, g.shin, mat, { name: 'shin', mirror: R2, sy: stretch.legLo });
    swap(leg.end, g.boot, mat, { name: 'boot', mirror: R2 });
  }
  STATE.mats = [helmMat, torsoMat, limbMat, limbMatM];
  STATE.installed = true; STATE.mode = 'rigid'; STATE.reason = 'installed'; STATE.ms = +A.ms.toFixed(1); STATE.ktx2 = !!A.ktx2;
  STATE.tex = assetTextures(A).size;
}

// =============================================================================================
// THE SKINNED SAL (salreal). One continuous dress (trunk + trouser legs, and a sleeve each
// side) as THREE.SkinnedMesh bound to diver.js's OWN rig groups — the Skeleton's "bones" are
// the hips, spine and limb root/mid/end Groups the gait already drives, so no bone hierarchy
// is duplicated and not one line of animation changes. The dress was authored and weighted
// (Blender bone heat, cleaned) in the HIPS frame in the rig's rest pose (every rotation zero),
// so each joint's bind inverse is just the inverse of its rest translation from the hips;
// bindMatrix is identity and the mesh rides the hips group (AttachedBindMode turns the
// skinned world positions back into hips space). Hard parts stay rigid on their group:
// helmet, corselet, belt (hips), pack, hands (wrist), boots (ankle).
//
// POSE-RESPONSIVE CREASING: the dress set carries a second normal map, the WRINKLE map (the
// same dress with deep compression gathers sculpted into the inside of every joint, baked
// through the same low). Per vertex the shader finds which joint it belongs to from its own
// skin weights (the bone indices are remapped to one fixed order, SKIN_BONES) and its rest
// position; per frame each joint's bend is read off the rig (8 floats, onBeforeRender, no
// allocation). The INSIDE of a closing joint blends to the wrinkle map and takes a little
// occlusion in its folds; the OUTSIDE is stretched — its folds flatten toward the smooth
// normal; and a small corrective push along the rest normal on the inside of the knee and
// elbow keeps linear-blend skinning from collapsing the volume there.
// TAA: postfx.taa.js renders skinned movers with last frame's bone palette (exact motion
// vectors; the corrective push is not in the velocity — it is mm and changes slowly).
// =============================================================================================
const SKIN_BONES = ['hips', 'spine', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'upArmL', 'foreArmL', 'handL', 'upArmR', 'foreArmR', 'handR'];
const SK = { U: null, meshes: [], added: [], stash: [], skeleton: null, frame: -1 };
const SK_VS = `
uniform vec4 uSkB0; uniform vec4 uSkB1; uniform vec4 uSkG; uniform vec4 uSkG2; uniform vec4 uSkK;
varying float vSkWrk; varying float vSkStr;
float skW(float k) { return dot(skinWeight, vec4(equal(skinIndex, vec4(k)))); }
float skG(float d, float w) { return exp(-d * d / (w * w)); }`;
// before skinning: rest position/normal are the authored hips-frame ones
const SK_VS_MAIN = `
{
  vec3 rp = position, rn = normal;
  float fr = smoothstep(-0.25, 0.55, rn.z), bk = smoothstep(-0.25, 0.55, -rn.z);
  // knees (bones thigh+shin), elbows (upper arm+forearm): u.x knee y, u.y elbow y
  float kL = (skW(2.0) + skW(3.0)) * skG(rp.y - uSkG.x, 0.13), kR = (skW(5.0) + skW(6.0)) * skG(rp.y - uSkG.x, 0.13);
  float eL = (skW(8.0) + skW(9.0)) * skG(rp.y - uSkG.y, 0.12), eR = (skW(11.0) + skW(12.0)) * skG(rp.y - uSkG.y, 0.12);
  // hip crease: thigh + pelvis near the hip joint (uSkG.z hip x), one side each
  float hL = (skW(2.0) + 0.6 * skW(0.0)) * skG(rp.y + 0.04, 0.14) * smoothstep(-0.06, 0.08, rp.x);
  float hR = (skW(5.0) + 0.6 * skW(0.0)) * skG(rp.y + 0.04, 0.14) * smoothstep(-0.06, 0.08, -rp.x);
  // the belly: spine + pelvis between the belt and the breastplate (uSkG.w its centre y)
  float wa = (skW(1.0) + skW(0.0)) * skG(rp.y - uSkG.w, 0.17);
  vec4 b0 = uSkB0, b1 = uSkB1;
  // knee and elbow close one way only: knees fold the back, elbows the front
  float c = kL * b0.x * bk + kR * b0.y * bk + eL * b0.z * fr + eR * b0.w * fr;
  float t = kL * b0.x * fr + kR * b0.y * fr + eL * b0.z * bk + eR * b0.w * bk;
  // hips and waist: flexion folds the front, extension the back
  c += hL * (max(b1.x, 0.0) * fr + max(-b1.x, 0.0) * bk) + hR * (max(b1.y, 0.0) * fr + max(-b1.y, 0.0) * bk) + wa * (max(b1.z, 0.0) * fr + max(-b1.z, 0.0) * bk);
  t += hL * (max(b1.x, 0.0) * bk) + hR * (max(b1.y, 0.0) * bk) + wa * max(b1.z, 0.0) * bk;
  vSkWrk = clamp(c * uSkK.x, 0.0, 1.0); vSkStr = clamp(t * uSkK.x, 0.0, 1.0);
  // corrective volume on the inside of the knee and elbow (LBS collapses it)
  transformed += rn * uSkK.y * (0.016 * (kL * b0.x + kR * b0.y) * bk + 0.012 * (eL * b0.z + eR * b0.w) * fr);
  // UNDERWATER the dress balloons a little (the air in it): everywhere the canvas is free,
  // not where the belt cinches it or the boots and cuffs hold it (uSkK.z: 0 dry .. 1 sunk)
  float loose = (1.0 - skW(10.0) - skW(13.0)) * (1.0 - skG(rp.y - uSkG2.x, 0.10)) * smoothstep(uSkG2.y - 0.02, uSkG2.y + 0.16, rp.y);
  transformed += rn * uSkK.z * 0.013 * loose;
}`;
const SK_FS = `
uniform sampler2D tSkWrk; uniform vec4 uSkK;
varying float vSkWrk; varying float vSkStr;`;
const SK_FS_NRM = `
// ballooned underwater, the canvas is pulled taut: its folds soften
normal = normalize(mix(normal, nonPerturbedNormal, uSkK.z * 0.38));
#ifdef SAL_WRK
if (vSkWrk > 0.002 || vSkStr > 0.002) {
  vec3 wN = texture2D(tSkWrk, vNormalMapUv).xyz * 2.0 - 1.0;
  wN.z = sqrt(max(0.0, 1.0 - dot(wN.xy, wN.xy)));
  wN.xy *= normalScale;
  normal = normalize(mix(normal, normalize(tbn * wN), vSkWrk));
  normal = normalize(mix(normal, nonPerturbedNormal, vSkStr * 0.5));
  diffuseColor.rgb *= 1.0 - 0.45 * vSkWrk * clamp(1.0 - wN.z, 0.0, 1.0) * 4.0;
}
#endif
`;
// the per-frame drive: each joint's bend off the rig, normalised to 0..1 of "fully closed"
const _rs = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function skDrive(diver) {
  const U = SK.U; if (!U) return;
  const b0 = U.uSkB0.value, b1 = U.uSkB1.value;
  // ranges from the live gait: a walking knee peaks ~0.65 rad in swing, the swim kick 1.45;
  // the arms carry ~0.2 rad of rest bend (REST_RE/LE), so the elbow counts from there
  b0.set(_rs(0.10, 0.85, diver.legL.mid.rotation.x), _rs(0.10, 0.85, diver.legR.mid.rotation.x),
    _rs(0.22, 1.10, -diver.armL.mid.rotation.x), _rs(0.22, 1.10, -diver.armR.mid.rotation.x));
  // hip flexion: the thigh swings forward = root.rotation.x negative
  const hl = -diver.legL.root.rotation.x, hr = -diver.legR.root.rotation.x, w = diver.spine.rotation.x;
  b1.set(Math.sign(hl) * _rs(0.10, 0.95, Math.abs(hl)), Math.sign(hr) * _rs(0.10, 0.95, Math.abs(hr)), Math.sign(w) * _rs(0.04, 0.45, Math.abs(w)), 0);
  // the balloon: eases in over a couple of seconds after he goes under, out as he climbs out
  const k = U.uSkK.value, sub = diver.matrixWorld.elements[13] < -1.2 ? 1 : 0;
  k.z += (sub - k.z) * 0.02;
}
function dressMaterial(maps, shared, P) {
  const m = sculptMat(maps, shared, { env: 0.35, ns: 1.2 });
  const U = {
    tSkWrk: { value: maps.wrinkleMap || maps.normalMap },
    uSkB0: { value: new THREE.Vector4() }, uSkB1: { value: new THREE.Vector4() },
    uSkG: { value: new THREE.Vector4(P.kneeY, P.elbowY, P.hipX, P.waistY) }, uSkG2: { value: new THREE.Vector4(P.beltY, P.inBootY, 0, 0) },
    uSkK: { value: new THREE.Vector4(1, 1, 0, 0) }
  };
  if (maps.wrinkleMap) m.defines = Object.assign(m.defines || {}, { SAL_WRK: '' });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SK_VS)
      .replace('#include <skinning_vertex>', SK_VS_MAIN + '\n#include <skinning_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SK_FS)
      .replace('if (ssFade > 0.002) {\n  vec3 d = mix(ssTriN', SK_FS_NRM + 'if (ssFade > 0.002) {\n  vec3 d = mix(ssTriN')
      // wet rubberised canvas has a sheen, not a vinyl gloss (the rigid build's 0.30 read as
      // plastic on the ballooned dress)
      .replace('roughnessFactor = mix(roughnessFactor, 0.30, ssWet * 0.8 * nonMet);', 'roughnessFactor = mix(roughnessFactor, 0.48, ssWet * 0.8 * nonMet);');
  };
  const pk = m.customProgramCacheKey;
  m.customProgramCacheKey = () => pk.call(m) + '|salSkin1' + (maps.wrinkleMap ? 'w' : '');
  SK.U = U;
  return m;
}

function undoSkinned() {
  for (const [node, c] of SK.stash) node.add(c);
  HANDS.sides.length = 0; FACE.eyeU = null;
  if (FACE.recess) { FACE.recess.o.geometry = FACE.recess.geo || FACE.recess.o.geometry; FACE.recess = null; }
  for (const m of SK.added) if (m.parent) m.parent.remove(m);
  SK.stash.length = 0; SK.added.length = 0; SK.meshes.length = 0; SK.U = null;
}

function installSkinned(diver, shared, A) {
  const g = A.geos, meta = A.meta.meta || {}, sets = A.meta.sets || {};
  const need = ['helmet', 'corselet', 'trunk', 'sleeveL', 'sleeveR', 'belt', 'pack', 'handL', 'handR', 'boot'];
  const miss = need.filter(k => !g[k]);
  if (miss.length || !A.maps.helm || !A.maps.dress || !A.maps.gear) { STATE.skinReason = 'asset incomplete: ' + miss.join(','); return false; }
  for (const k of ['trunk', 'sleeveL', 'sleeveR']) if (!A.skins[k] || !g[k].attributes.skinIndex) { STATE.skinReason = k + ' carries no skin'; return false; }
  // ---- the rig check: a skinned dress cannot be stretched to a different rig — a moved
  // joint would bend the canvas in the wrong place. Any drift -> the rigid sculpt.
  const R = meta.rig || {}, dL = diver.legL, dA = diver.armL;
  const live = { armUp: -dA.mid.position.y, armLo: -dA.end.position.y, legUp: -dL.mid.position.y, legLo: -dL.end.position.y,
    hipX: dL.root.position.x, shX: dA.root.position.x, shY: dA.root.position.y, spineY: diver.spine.position.y,
    helmS: diver.helmGroup.scale.x, neckY: diver.neck.position.y };
  const baked = { armUp: R.armL && R.armL.up, armLo: R.armL && R.armL.lo, legUp: R.legL && R.legL.up, legLo: R.legL && R.legL.lo,
    hipX: R.legL && R.legL.x, shX: R.armL && R.armL.x, shY: R.armL && R.armL.y, spineY: R.spineY,
    helmS: R.helmS != null ? R.helmS : 1, neckY: R.neckY };
  const off = [];
  for (const k in live) if (baked[k] == null || Math.abs(live[k] - baked[k]) > 2e-3) off.push(k + ' baked ' + baked[k] + ' live ' + +live[k].toFixed(4));
  if (off.length) { STATE.skinReason = 'rig differs from the skinned bake (' + off.join('; ') + ') — re-bake: node tools/blender/build.mjs salSkin'; console.warn('ABYSSA: ' + STATE.skinReason); return false; }

  // ---- the skeleton: diver.js's own groups, rest translations relative to the hips
  const node = { hips: diver.hips, spine: diver.spine,
    thighL: dL.root, shinL: dL.mid, footL: dL.end, thighR: diver.legR.root, shinR: diver.legR.mid, footR: diver.legR.end,
    upArmL: dA.root, foreArmL: dA.mid, handL: dA.end, upArmR: diver.armR.root, foreArmR: diver.armR.mid, handR: diver.armR.end };
  const restOf = o => { const v = new THREE.Vector3(); for (let n = o; n && n !== diver.hips; n = n.parent) v.add(n.position); return v; };
  const bonesArr = SKIN_BONES.map(n => node[n]), inv = SKIN_BONES.map(n => new THREE.Matrix4().makeTranslation(restOf(node[n]).negate()));
  const skeleton = new THREE.Skeleton(bonesArr, inv);
  SK.skeleton = skeleton;
  // every skinned geometry's joint indices -> SKIN_BONES order (the shader keys joints off them)
  for (const k of ['trunk', 'sleeveL', 'sleeveR']) {
    // (GLTFLoader de-duplicates node names: the bone 'handL' beside the mesh 'handL' loads as 'handL_1')
    const names = A.skins[k].bones, map = names.map(n => SKIN_BONES.indexOf(SKIN_BONES.includes(n) ? n : n.replace(/_\d+$/, '')));
    const si = g[k].attributes.skinIndex, sw = g[k].attributes.skinWeight;
    // (salprop) the armature also carries the hands' finger bones: a joint the dress never
    // weights may be unknown; one it does weight may not
    {
      let bad = '';
      for (let i = 0; i < si.count && !bad && !g[k].userData.skRemapped; i++) for (let c = 0; c < 4; c++) if (sw.getComponent(i, c) > 0 && map[si.getComponent(i, c)] < 0) { bad = names[si.getComponent(i, c)]; break; }
      if (bad) { STATE.skinReason = k + ': weighted to an unknown joint ' + bad; return false; }
    }
    if (!g[k].userData.skRemapped) {
      for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) {
        const j = si.getComponent(i, c), w = sw.getComponent(i, c);
        si.setComponent(i, c, w > 0 ? map[j] : 0);
      }
      si.needsUpdate = true; g[k].userData.skRemapped = true;
    }
  }
  const P = { kneeY: -live.legUp, elbowY: diver.spine.position.y + live.shY - live.armUp, hipX: live.hipX, waistY: diver.spine.position.y + 0.28, beltY: meta.beltY != null ? meta.beltY : diver.spine.position.y + 0.07, inBootY: meta.inBootY != null ? meta.inBootY : -live.legUp - live.legLo + 0.25 };

  const helmMat = registerPaint(sculptMat(A.maps.helm, shared, { env: 0.55, ao: 0.9 }), { hero: true });
  const dressMat = registerPaint(dressMaterial(A.maps.dress, shared, P), { hero: true });
  const gearMat = registerPaint(sculptMat(A.maps.gear, shared, { env: 0.45 }), { hero: true });
  const gearMatM = registerPaint(sculptMat(A.maps.gear, shared, { env: 0.45, mirror: true }), { hero: true });

  const retire = (n, keep) => {
    for (const c of n.children.slice()) if (retireable(c, keep)) { n.remove(c); SK.stash.push([n, c]); }
  };
  const add = (n, geo, mat, name, mirror) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = 'salSkin:' + name; m.castShadow = m.receiveShadow = true;
    if (mirror) m.scale.x = -1;
    n.add(m); SK.added.push(m); STATE.meshes.push(m);
    STATE.tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    return m;
  };
  retire(diver.helmGroup); retire(diver.cors); retire(diver.hips); retire(diver.pack);
  for (const L of [diver.armL, diver.armR, diver.legL, diver.legR]) { retire(L.root); retire(L.mid); retire(L.end); }
  add(diver.helmGroup, g.helmet, helmMat, 'helmet');
  add(diver.cors, g.corselet, helmMat, 'corselet');
  add(diver.hips, g.belt, gearMat, 'belt');
  add(diver.pack, g.pack, gearMat, 'pack');
  // (salprop) rigged hands when the bake carries them; the old rigid fists otherwise
  if (!installHands(diver, A, gearMat, gearMatM)) {
    add(dA.end, g.handL, gearMat, 'handL');
    add(diver.armR.end, g.handR, gearMatM, 'handR', true);
  }
  const face = installFace(diver, shared, A);
  shared.tick = dt => { if (HANDS.sides.length) handsTick(shared); if (face) faceTick(diver, shared, dt); };
  add(dL.end, g.boot, gearMat, 'bootL');
  add(diver.legR.end, g.boot, gearMatM, 'bootR', true);
  const ident = new THREE.Matrix4();
  for (const k of ['trunk', 'sleeveL', 'sleeveR']) {
    const m = new THREE.SkinnedMesh(g[k], dressMat);
    m.name = 'salSkin:' + k; m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;                  // the bind-pose bounds don't follow the pose; he is always near the camera
    m.bind(skeleton, ident);
    diver.hips.add(m); SK.added.push(m); SK.meshes.push(m); STATE.meshes.push(m); STATE.skinned.push(m);
    STATE.tris += g[k].index.count / 3;
  }
  // one drive per rendered frame (the first skinned draw of the frame reads the rig)
  SK.meshes[0].onBeforeRender = (r) => { const f = r.info.render.frame; if (f !== SK.frame) { SK.frame = f; skDrive(diver); } };
  SK.meshes[1].onBeforeRender = SK.meshes[2].onBeforeRender = SK.meshes[0].onBeforeRender;
  if (!LAB) for (const [, c] of SK.stash) if (c.geometry) c.geometry.dispose();
  STATE.stash = LAB ? SK.stash.slice() : [];
  STATE.mats = [helmMat, dressMat, gearMat, gearMatM];
  STATE.installed = true; STATE.mode = 'skinned'; STATE.reason = 'installed'; STATE.skinReason = 'installed';
  STATE.ms = +A.ms.toFixed(1); STATE.ktx2 = !!A.ktx2; STATE.tex = assetTextures(A).size;
  return true;
}

// THE PORT GLASS (review round 2). The kept procedural glass (and the dark recess merged
// into its draw) reflected the SURFACE sky env at 0.8 through two clearcoated layers:
// measured face-on on the deck at noon, the faceplate centre went 180/255 (64 with the env
// off) — a white disc on the procedural Sal too, and in zone 2, whose water is black, a
// headlamp, because the env map is the one global sky at every depth. Now: a dim base
// (0.10)
// reflection, scaled every frame by the water's own radiance at the camera with the same
// normalisation diver.js gives the bubble rims (background luminance over the zone-0
// floor's, so the shallows keep their sky and the abyss loses it), floored low so the
// lantern's own highlight and a trace of reflection always remain. One float a frame.
// 0.10 measured: faceplate centre (30 px mean) on the deck at noon 180 -> 96, zone 0 64-74,
// zone 2 ~35 — dark glass with the sky / lantern in it. (0.28 still read 119, white.)
const GLASS_ENV = 0.10;
function portGlass(diver) {
  for (const o of diver.helmGroup.children) {
    const m = o.material;
    if (!o.isMesh || !m || !m.customProgramCacheKey || m.customProgramCacheKey() !== 'salGlass1') continue;
    m.envMapIntensity = GLASS_ENV;
    o.onBeforeRender = (r, scene) => {
      const bg = scene.background;
      const k = bg && bg.isColor ? Math.min(1, Math.max(0.06, (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 0.029)) : 1;
      m.envMapIntensity = GLASS_ENV * k;
    };
    STATE.glass = m;
  }
}

// ---- dev surface ----
if (typeof window !== 'undefined') {
  window.__salSculpt = {
    state: () => ({ installed: STATE.installed, mode: STATE.mode, reason: STATE.reason, skinReason: STATE.skinReason, ms: STATE.ms, ktx2: STATE.ktx2, meshes: STATE.meshes.length, tris: STATE.tris, warn: STATE.warn, tex: STATE.tex }),
    // the skinned dress's live joint bends (rad, signed) and the wrinkle/stretch drive
    bends: () => SK.U ? { b0: SK.U.uSkB0.value.toArray().map(v => +v.toFixed(3)), b1: SK.U.uSkB1.value.toArray().map(v => +v.toFixed(3)), K: SK.U.uSkK.value.toArray() } : null,
    wrinkle: k => { if (SK.U) SK.U.uSkK.value.x = k; return k; },        // wrinkle gain (1)
    bulge: k => { if (SK.U) SK.U.uSkK.value.y = k; return k; },          // corrective volume gain (1)
    balloon: () => SK.U ? +SK.U.uSkK.value.z.toFixed(3) : null,          // 0 dry .. 1 under
    // ?lab only: put the procedural meshes back / take them away again (A/B in one tab)
    procedural(on) {
      if (!LAB) return 'needs ?lab';
      for (const [node, c] of STATE.stash) { if (on) node.add(c); else node.remove(c); }
      for (const m of STATE.meshes) m.visible = !on;
      return on ? 'procedural' : 'sculpted';
    },
    weave(k) { for (const m of STATE.mats || []) m.userData.salSculpt.uSsK.value.z = k; return k; }
  };
}

// =============================================================================================
// (salprop) THE RIGGED HANDS. Each hand is a SkinnedMesh on its own 16-bone skeleton (palm +
// three per finger + the thumb), the bones plain THREE.Bones under a root on the wrist group
// (the right root is mirrored, scale.x = -1, so the left-authored hand and its bones mirror
// together and three flips the winding). The sculpt is the OPEN rest pose; four solved poses
// (meta.hand.poses: per bone [swing, flex] offsets from rest) are blended by diver.js's weights
// (salShared.hand.L / .R: relax, grip, knife, spread) once per frame in salShared.tick — before
// the scene's matrix update, so the skeleton the renderer uploads is this frame's.
// =============================================================================================
const HANDS = { sides: [], poses: null, nb: 0 };
const _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion();
function installHands(diver, A, matL, matR) {
  const H = A.meta.meta && A.meta.meta.hand, g = A.geos;
  if (!H || !A.skins.handL || !A.skins.handR || !g.handL.attributes.skinIndex) return false;
  const P = H.poses, nb = H.bones.length;
  HANDS.poses = [P.relax, P.grip, P.knife, P.spread]; HANDS.nb = nb;
  for (const [end, geo, skin, mat, mirror, side] of [[diver.armL.end, g.handL, A.skins.handL, matL, false, 'L'], [diver.armR.end, g.handR, A.skins.handR, matR, true, 'R']]) {
    const root = new THREE.Object3D();
    root.name = 'salHand' + side;
    if (mirror) root.scale.x = -1;
    end.add(root); SK.added.push(root);
    const by = {}, list = [], inv = [], ax = [], sw = [];
    for (const b of H.bones) {
      const o = new THREE.Bone(); o.name = b.name;
      const ph = b.parent ? H.bones.find(q => q.name === b.parent).head : [0, 0, 0];
      o.position.set(b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2]);
      (b.parent ? by[b.parent] : root).add(o);
      by[b.name] = o; list.push(o);
      inv.push(new THREE.Matrix4().makeTranslation(-b.head[0], -b.head[1], -b.head[2]));
      ax.push(new THREE.Vector3().fromArray(b.ax).normalize()); sw.push(new THREE.Vector3().fromArray(b.sw).normalize());
    }
    const skeleton = new THREE.Skeleton(list, inv);
    // joint names (GLTFLoader may suffix a duplicate '_1') -> our bone order; a joint the hand
    // never weights (the body's bones ride in the same armature) maps to 0 at weight 0
    const names = skin.bones.map(n => n.replace(/_\d+$/, '')), map = names.map(n => H.bones.findIndex(b => b.name === n));
    const si = geo.attributes.skinIndex, swt = geo.attributes.skinWeight;
    if (!geo.userData.skRemapped) {
      for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) {
        const j = si.getComponent(i, c), w = swt.getComponent(i, c);
        if (w > 0 && map[j] < 0) throw new Error('hand: weight on an unknown joint ' + names[j]);
        si.setComponent(i, c, w > 0 ? map[j] : 0);
      }
      si.needsUpdate = true; geo.userData.skRemapped = true;
    }
    const m = new THREE.SkinnedMesh(geo, mat);
    m.name = 'salSkin:hand' + side; m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
    root.add(m); m.bind(skeleton, new THREE.Matrix4());
    SK.added.push(m); STATE.meshes.push(m); STATE.skinned.push(m);
    STATE.tris += geo.index.count / 3;
    HANDS.sides.push({ side, list, ax, sw, w: null });
  }
  return true;
}
function handsTick(shared) {
  const P = HANDS.poses;
  for (let s = 0; s < HANDS.sides.length; s++) {
    const S = HANDS.sides[s], w = S.side === 'L' ? shared.hand.L : shared.hand.R;
    for (let j = 1; j < HANDS.nb; j++) {
      let swg = 0, flx = 0;
      for (let p = 0; p < 4; p++) { const q = P[p][j]; swg += w[p] * q[0]; flx += w[p] * q[1]; }
      _hq.setFromAxisAngle(S.sw[j], swg);
      _hq2.setFromAxisAngle(S.ax[j], flx);
      S.list[j].quaternion.multiplyQuaternions(_hq, _hq2);
    }
  }
}

// =============================================================================================
// (salprop) THE FACE. A sculpted head (assets/salskin 'head', its own 1024 set) behind the front
// light, a dark tinned-copper LINER over the helmet's front cavity, and two procedural EYES —
// the liner and the eyes are one mesh and one draw (attribute salEye: 0 liner, 1/2 the eyes;
// the vertex shader turns each eye about its centre, the fragment shader paints sclera, iris,
// pupil and the LIDS, which close over the eyeball in the head's frame).
// LIGHT INSIDE A HELMET: the scene's lights do not know about the copper, so every material in
// here takes its direct light through THE APERTURE — a light reaches a fragment only along a
// ray that leaves the helmet through one of its four lights (the front bore and the three
// glazed ports, analytic discs in view space, uSalPc/uSalPn) — and its ambient/environment
// scaled down to what four small windows let in (uSalIn.x). The lantern held up in front lights
// his face; the cyan fill at his waist and the camera's rim light never do. Dim by physics,
// not by a fudge, and it can never glow.
// =============================================================================================
const SAL_AP_PARS = `
uniform vec4 uSalPc[4]; uniform vec3 uSalPn[4]; uniform vec2 uSalIn;
float salAperture(vec3 p, vec3 l) {
  float v = 0.0;
  for (int i = 0; i < 4; i++) {
    float dn = dot(l, uSalPn[i]);
    if (dn > 0.02) {
      float t = dot(uSalPc[i].xyz - p, uSalPn[i]) / dn;
      vec3 q = p + l * t - uSalPc[i].xyz;
      v += (1.0 - smoothstep(uSalPc[i].w * 0.75, uSalPc[i].w * 1.1, length(q))) * step(0.0, t);
    }
  }
  return min(v, 1.0);
}
void salDirect(IncidentLight dl, const in vec3 gp, const in vec3 gn, const in vec3 gv, const in vec3 gc, const in PhysicalMaterial mt, inout ReflectedLight rl) {
  dl.color *= salAperture(gp, dl.direction) * uSalIn.y;
  RE_Direct_Physical(dl, gp, gn, gv, gc, mt, rl);
}
#undef RE_Direct
#define RE_Direct( a, b, c, d, e, f, g ) salDirect( a, b, c, d, e, f, g )
`;
const SAL_AP_IND = `
reflectedLight.indirectDiffuse *= uSalIn.x; reflectedLight.indirectSpecular *= uSalIn.x;
#include <aomap_fragment>`;
const FACE = { U: null, eyeU: null, mesh: null, eyes: null, C: [new THREE.Vector3(), new THREE.Vector3()], r: 0,
  P: [], N: [], R: [], yaw: [0, 0], pit: [0, 0], sacc: [0, 0], saccT: 0, saccN: 0, blinkT: 2.5, blink: -1, dbl: false, lid: 0, t: 0 };
function apertureUniforms() {
  const pc = [], pn = [];
  for (let i = 0; i < 4; i++) { pc.push(new THREE.Vector4()); pn.push(new THREE.Vector3()); }
  return { uSalPc: { value: pc }, uSalPn: { value: pn }, uSalIn: { value: new THREE.Vector2(0.16, 1.0) } };
}
function withAperture(m, U, key) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + SAL_AP_PARS)
      .replace('#include <aomap_fragment>', SAL_AP_IND);
  };
  const pk = m.customProgramCacheKey;
  m.customProgramCacheKey = () => (pk ? pk.call(m) : '') + '|' + key;
  return m;
}
// the eyes + liner shader
const EYE_VS = `
attribute float salEye;
uniform mat3 uEyeR[2]; uniform vec3 uEyeC[2]; uniform float uEyeRad;
varying float vEye; varying vec3 vEyeL; varying vec3 vEyeH;`;
const EYE_VS_N = `
vEye = salEye; vEyeL = vec3(0.0); vEyeH = vec3(0.0);
mat3 eyeR = salEye > 1.5 ? uEyeR[1] : uEyeR[0];
if (salEye > 0.5) objectNormal = eyeR * objectNormal;`;
const EYE_VS_P = `
if (salEye > 0.5) {
  vec3 ec = salEye > 1.5 ? uEyeC[1] : uEyeC[0];
  vec3 lp = position - ec;
  vEyeL = lp / uEyeRad;
  vec3 rp = eyeR * lp;
  vEyeH = rp / uEyeRad;
  transformed = ec + rp;
}`;
const EYE_FS = `
uniform float uLidY; uniform float uLidLo;
varying float vEye; varying vec3 vEyeL; varying vec3 vEyeH;
float eyeLid;`;
const EYE_FS_COL = `
eyeLid = 1.0;
if (vEye > 0.5) {
  vec3 e = normalize(vEyeL);
  float a = acos(clamp(e.z, -1.0, 1.0)), ang = atan(e.y, e.x);
  float iris = 1.0 - smoothstep(0.38, 0.43, a), pupil = 1.0 - smoothstep(0.13, 0.16, a);
  vec3 ir = vec3(0.075, 0.105, 0.11) * (0.75 + 0.45 * (0.5 + 0.5 * sin(ang * 23.0) * sin(ang * 9.0 + 1.3)));
  ir *= mix(1.0, 0.45, smoothstep(0.30, 0.41, a));                       // limbal ring
  ir = mix(ir, vec3(0.16, 0.12, 0.06), (1.0 - smoothstep(0.16, 0.26, a)) * 0.6);   // a hazel collar
  vec3 sc = mix(vec3(0.42, 0.37, 0.32), vec3(0.40, 0.20, 0.17), smoothstep(0.7, 1.4, a) * 0.6);   // old, a little bloodshot
  vec3 col = mix(sc, ir, iris);
  col = mix(col, vec3(0.004), pupil);
  // the lids, in the head's frame (they do not turn with the eye); the upper lid's edge arcs
  float x2 = vEyeH.x * vEyeH.x;
  float up = uLidY - 0.22 * x2, lo = uLidLo + 0.25 * x2;
  float lid = clamp(smoothstep(up - 0.04, up + 0.04, vEyeH.y) + 1.0 - smoothstep(lo - 0.04, lo + 0.04, vEyeH.y), 0.0, 1.0);
  float lash = (1.0 - smoothstep(0.0, 0.10, abs(vEyeH.y - up))) * smoothstep(0.0, 0.3, vEyeH.z);
  col = mix(col, vec3(0.21, 0.12, 0.09), lid);
  col *= 1.0 - 0.75 * lash;
  diffuseColor.rgb = col;
  eyeLid = lid;
} else {
  diffuseColor.rgb = vec3(0.020, 0.018, 0.016);                        // tinned copper, dark with use
}`;
const EYE_FS_ROUGH = `
roughnessFactor = vEye > 0.5 ? mix(0.10, 0.55, eyeLid) : 0.62;`;
const EYE_FS_MET = `
metalnessFactor = vEye > 0.5 ? 0.0 : 0.35;`;

function installFace(diver, shared, A) {
  const meta = A.meta.meta || {}, Fm = meta.face, g = A.geos;
  if (!Fm || !g.head || !A.maps.face) return false;
  const k = Fm.k, at = Fm.at, E = Fm.eye;
  // the head: its own sculpt material, no weave, no wet, aperture-lit
  const hm = sculptMat(A.maps.face, shared, { env: 0.35, ao: 1 });
  hm.userData.salSculpt.uSsK.value.set(13, 11, 0, 0);
  hm.userData.salSculpt.uSalWet = { value: 0 };
  const U = apertureUniforms();
  withAperture(hm, U, 'salFace1');
  registerPaint(hm, { hero: true });
  const head = new THREE.Mesh(g.head, hm);
  head.name = 'salSkin:head'; head.castShadow = false; head.receiveShadow = false;
  diver.helmGroup.add(head); SK.added.push(head); STATE.meshes.push(head);
  STATE.tris += g.head.index.count / 3;
  // the liner + the eyes, one geometry
  const geos = [];
  {
    const c = Fm.cav.c, r = Fm.cav.r, pc = new THREE.Vector3().fromArray(Fm.port.c), pn = new THREE.Vector3().fromArray(Fm.port.n).normalize();
    const sp = new THREE.SphereGeometry(1, 44, 26), pos = sp.attributes.position, nrm = sp.attributes.normal, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i) * r[0] * 0.985 + c[0], pos.getY(i) * r[1] * 0.985 + c[1], pos.getZ(i) * r[2] * 0.985 + c[2]);
      pos.setXYZ(i, v.x, v.y, v.z);
      v.set(nrm.getX(i) / r[0], nrm.getY(i) / r[1], nrm.getZ(i) / r[2]).normalize().negate();   // facing in
      nrm.setXYZ(i, v.x, v.y, v.z);
    }
    // drop the triangles in the faceplate's bore (the window looks in through there), flip the rest
    const ix = sp.index.array, keep = [], a = new THREE.Vector3(), d = new THREE.Vector3();
    for (let t = 0; t < ix.length; t += 3) {
      a.set(0, 0, 0);
      for (let q = 0; q < 3; q++) a.x += pos.getX(ix[t + q]) / 3, a.y += pos.getY(ix[t + q]) / 3, a.z += pos.getZ(ix[t + q]) / 3;
      d.subVectors(a, pc); const al = d.dot(pn), rad = d.addScaledVector(pn, -al).length();
      if (rad < Fm.cav.bore * 1.04 && al > -0.3) continue;
      keep.push(ix[t], ix[t + 2], ix[t + 1]);
    }
    sp.setIndex(keep);
    sp.setAttribute('salEye', new THREE.Float32BufferAttribute(new Float32Array(pos.count), 1));
    sp.deleteAttribute('uv');
    geos.push(sp);
  }
  FACE.r = E.r * k;
  for (let s = 0; s < 2; s++) {
    const sx = s ? -1 : 1;     // eye 1 = his left (+x), eye 2 = his right
    FACE.C[s].set(at[0] + sx * E.x * k, at[1] + E.y * k, at[2] + E.z * k);
    const eg = new THREE.SphereGeometry(FACE.r, 28, 18).rotateX(Math.PI / 2);   // poles front/back: the iris on a pole
    eg.translate(FACE.C[s].x, FACE.C[s].y, FACE.C[s].z);
    eg.deleteAttribute('uv');
    eg.setAttribute('salEye', new THREE.Float32BufferAttribute(new Float32Array(eg.attributes.position.count).fill(s + 1), 1));
    geos.push(eg);
  }
  const eyeGeo = mergeGeometries(geos);
  const EU = { uEyeR: { value: [new THREE.Matrix3(), new THREE.Matrix3()] }, uEyeC: { value: FACE.C }, uEyeRad: { value: FACE.r },
    uLidY: { value: 0.55 }, uLidLo: { value: -0.62 } };
  const em = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, envMap: envTex, envMapIntensity: 0.6 });
  em.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, EU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + EYE_VS)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + EYE_VS_N)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + EYE_VS_P);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + EYE_FS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + EYE_FS_COL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + EYE_FS_ROUGH)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + EYE_FS_MET);
  };
  em.customProgramCacheKey = () => 'salEyes1';
  withAperture(em, U, 'salFace1');
  const eyes = new THREE.Mesh(eyeGeo, em);
  eyes.name = 'salSkin:eyes'; eyes.castShadow = false; eyes.receiveShadow = false;
  diver.helmGroup.add(eyes); SK.added.push(eyes); STATE.meshes.push(eyes);
  STATE.tris += eyeGeo.index.count / 3;
  FACE.U = U; FACE.eyeU = EU; FACE.mesh = head; FACE.eyes = eyes;
  // the four lights, helmet frame: centre (at the copper), axis out, radius
  const P0 = Fm.port, ports = [[add3(P0.c, P0.n, 0.045), P0.n, Fm.cav.bore],
    [[0.376, 0.470, 0.128], [Math.sin(1.245), 0, Math.cos(1.245)], 0.104],
    [[-0.376, 0.470, 0.128], [-Math.sin(1.245), 0, Math.cos(1.245)], 0.104],
    [[0, 0.818, 0.172], [0, Math.sin(1.16), Math.cos(1.16)], 0.100]];
  FACE.P = ports.map(p => new THREE.Vector4(p[0][0], p[0][1], p[0][2], p[2]));
  FACE.N = ports.map(p => new THREE.Vector3().fromArray(p[1]).normalize());
  head.onBeforeRender = (r, sc, cam) => faceView(diver, cam);
  // the front light's dark recess disc goes: the window looks into the helmet now
  dropFrontRecess(diver);
  return true;
}
const add3 = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const _fm = new THREE.Matrix4(), _fn3 = new THREE.Matrix3(), _fv = new THREE.Vector3();
function faceView(diver, cam) {
  _fm.multiplyMatrices(cam.matrixWorldInverse, diver.helmGroup.matrixWorld);
  _fn3.setFromMatrix4(_fm);
  const s = diver.helmGroup.matrixWorld.getMaxScaleOnAxis(), U = FACE.U;
  for (let i = 0; i < 4; i++) {
    const p = FACE.P[i];
    _fv.set(p.x, p.y, p.z).applyMatrix4(_fm);
    U.uSalPc.value[i].set(_fv.x, _fv.y, _fv.z, p.w * s);
    U.uSalPn.value[i].copy(FACE.N[i]).applyMatrix3(_fn3).normalize();
  }
}
function dropFrontRecess(diver) {
  for (const o of diver.helmGroup.children) {
    const m = o.material;
    if (!o.isMesh || !m || !m.customProgramCacheKey || m.customProgramCacheKey() !== 'salGlass1') continue;
    const geo = o.geometry, pos = geo.attributes.position, col = geo.attributes.color;
    if (!col) continue;
    const drop = i => col.getX(i) < 0.5 && pos.getZ(i) > 0.3;
    if (geo.index) {
      const ix = geo.index.array, keep = [];
      for (let t = 0; t < ix.length; t += 3) if (!(drop(ix[t]) && drop(ix[t + 1]) && drop(ix[t + 2]))) keep.push(ix[t], ix[t + 1], ix[t + 2]);
      FACE.recess = { o, geo };
      const g2 = geo.clone(); g2.setIndex(keep); o.geometry = g2;
    } else {
      const n = pos.count, keepV = [];
      for (let t = 0; t < n; t += 3) if (!(drop(t) && drop(t + 1) && drop(t + 2))) keepV.push(t, t + 1, t + 2);
      const g2 = geo.clone(); g2.setIndex(keepV); FACE.recess = { o, geo }; o.geometry = g2;
    }
  }
}
// once per frame (diver.js salShared.tick): where the eyes look, when they blink
const _ft = new THREE.Vector3(), _fi = new THREE.Matrix4(), _fe = new THREE.Euler();
const fh = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
function faceTick(diver, shared, dt) {
  if (!FACE.eyeU) return;
  const F = FACE, S = shared.face;
  F.t += dt;
  // saccades: a new small fixation offset every 0.4-2.5 s (more often under stress)
  F.saccT -= dt;
  if (F.saccT <= 0) {
    F.saccN++;
    F.saccT = (0.4 + 2.1 * fh(F.saccN * 3.1)) * (1 - 0.5 * S.stress);
    const amp = S.have ? 0.05 : 0.16;
    F.sacc[0] = (fh(F.saccN * 7.3) - 0.5) * 2 * amp; F.sacc[1] = (fh(F.saccN * 5.9) - 0.5) * 1.4 * amp - (S.have ? 0 : 0.05);
  }
  diver.helmGroup.updateWorldMatrix(true, false);
  _fi.copy(diver.helmGroup.matrixWorld).invert();
  if (S.have) _ft.set(S.x, S.y, S.z).applyMatrix4(_fi);
  for (let i = 0; i < 2; i++) {
    let yaw = 0, pit = -0.06 - 0.10 * S.swim;
    if (S.have) {
      const dx = _ft.x - F.C[i].x, dy = _ft.y - F.C[i].y, dz = _ft.z - F.C[i].z;
      yaw = Math.atan2(dx, Math.max(dz, 0.05)); pit = Math.atan2(dy, Math.hypot(dx, dz));
    }
    yaw = Math.max(-0.55, Math.min(0.55, yaw + F.sacc[0])); pit = Math.max(-0.38, Math.min(0.32, pit + F.sacc[1]));
    // an eye jumps (saccade), it does not drift: fast spring
    const r = Math.min(1, 26 * dt);
    F.yaw[i] += (yaw - F.yaw[i]) * r; F.pit[i] += (pit - F.pit[i]) * r;
    _fe.set(-F.pit[i], F.yaw[i], 0, 'YXZ');
    _fi.makeRotationFromEuler(_fe);
    F.eyeU.uEyeR.value[i].setFromMatrix4(_fi);
  }
  // blinks: every 2-6 s (half that when he is labouring), now and then a double
  F.blinkT -= dt;
  if (F.blink < 0 && F.blinkT <= 0) { F.blink = 0; F.saccN++; F.dbl = fh(F.saccN * 11.7) < 0.15; }
  let c = 0;
  if (F.blink >= 0) {
    F.blink += dt;
    const u = F.blink;
    c = u < 0.06 ? u / 0.06 : u < 0.09 ? 1 : Math.max(0, 1 - (u - 0.09) / 0.11);
    if (u > 0.20) {
      if (F.dbl) { F.dbl = false; F.blink = 0; } else { F.blink = -1; F.blinkT = (2.0 + 4.0 * fh(F.saccN * 2.3)) * (1 - 0.5 * S.stress); }
    }
  }
  const pd = Math.max(0, -(F.pit[0] + F.pit[1]) * 0.5);      // the upper lid follows the eye down
  F.eyeU.uLidY.value = 0.52 - 0.9 * pd + (-0.62 - (0.52 - 0.9 * pd)) * c;
  F.eyeU.uLidLo.value = -0.62 + 0.0 * c;
}
