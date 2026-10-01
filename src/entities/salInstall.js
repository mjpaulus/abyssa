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
  const ferrule = o => o.material && o.material.userData.salMetal && (o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox)).getCenter(new THREE.Vector3()).y > 0.9;
  swap(diver.helmGroup, g.helmet, helmMat, { name: 'helmet' });
  swap(diver.spine, g.corselet, helmMat, { name: 'corselet', keep: ferrule });
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
uniform sampler2D tSkWrk;
varying float vSkWrk; varying float vSkStr;`;
const SK_FS_NRM = `
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
    hipX: dL.root.position.x, shX: dA.root.position.x, shY: dA.root.position.y, spineY: diver.spine.position.y };
  const baked = { armUp: R.armL && R.armL.up, armLo: R.armL && R.armL.lo, legUp: R.legL && R.legL.up, legLo: R.legL && R.legL.lo,
    hipX: R.legL && R.legL.x, shX: R.armL && R.armL.x, shY: R.armL && R.armL.y, spineY: R.spineY };
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
    if (map.some((v, i) => v < 0 && names[i])) { STATE.skinReason = k + ': unknown joint ' + names.filter((n, i) => map[i] < 0); return false; }
    const si = g[k].attributes.skinIndex, sw = g[k].attributes.skinWeight;
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
  const ferrule = o => o.material && o.material.userData.salMetal && (o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox)).getCenter(new THREE.Vector3()).y > 0.9;
  retire(diver.helmGroup); retire(diver.spine, ferrule); retire(diver.hips); retire(diver.pack);
  for (const L of [diver.armL, diver.armR, diver.legL, diver.legR]) { retire(L.root); retire(L.mid); retire(L.end); }
  add(diver.helmGroup, g.helmet, helmMat, 'helmet');
  add(diver.spine, g.corselet, helmMat, 'corselet');
  add(diver.hips, g.belt, gearMat, 'belt');
  add(diver.pack, g.pack, gearMat, 'pack');
  add(dA.end, g.handL, gearMat, 'handL');
  add(diver.armR.end, g.handR, gearMatM, 'handR', true);
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
