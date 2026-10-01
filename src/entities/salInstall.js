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
//    the ball onto itself). Measured by salInstall.gapProbe() — see __salSculpt.gaps().
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
// Cost: 3 sets x (BC1 albedo + BC5 normal + RGBA8 ORM half-res) ~ 3 x 13.3 MB GPU.
import * as THREE from 'three';
import { envTex } from '../core.js';
import { registerPaint, styleUniforms } from '../lib/paint.js';
import { loadSculpted, assetTextures } from '../lib/assets.js';
import { patchNormalRG } from '../lib/microDetail.js';
import { twillSet, canvasSet } from '../lib/textures.js';

const ON = typeof location === 'undefined' || !/[?&]salproc\b/.test(location.search);
const LAB = typeof location !== 'undefined' && /[?&]lab\b/.test(location.search);
const ASSET = ON ? loadSculpted('assets/sal/', 'sal') : Promise.resolve(null);

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
    aoMapIntensity: o.ao != null ? o.ao : 0.85, normalScale: new THREE.Vector2(1, o.mirror ? -1 : 1),
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

const STATE = { installed: false, reason: ON ? 'loading' : 'off (?salproc)', ms: 0, meshes: [], stash: [], tris: 0, warn: [] };

export function installSalSculpt(diver, shared) {
  ASSET.then(A => {
    if (!A) { STATE.reason = ON ? 'asset unavailable — procedural Sal kept' : STATE.reason; return; }
    try { install(diver, shared, A); } catch (e) { console.warn('ABYSSA: sculpted Sal failed to install, keeping the procedural build', e); STATE.reason = 'install threw: ' + e.message; }
  });
}

function install(diver, shared, A) {
  const g = A.geos, meta = A.meta.meta || {}, sets = A.meta.sets || {};
  const need = ['helmet', 'corselet', 'hips', 'pack', 'upperArm', 'foreArm', 'glove', 'thighL', 'thighR', 'shin', 'boot'];
  const miss = need.filter(k => !g[k]);
  if (miss.length || !A.maps.helm || !A.maps.torso || !A.maps.limbs) { STATE.reason = 'asset incomplete: ' + miss.join(','); return; }
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

  const helmMat = registerPaint(sculptMat(A.maps.helm, shared, { env: 0.6, ao: 0.9 }), { hero: true });
  const torsoMat = registerPaint(sculptMat(A.maps.torso, shared, { env: 0.45 }));
  const limbMat = registerPaint(sculptMat(A.maps.limbs, shared, { env: 0.4 }));
  const limbMatM = registerPaint(sculptMat(A.maps.limbs, shared, { env: 0.4, mirror: true }));

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
  swap(diver.spine, g.corselet, torsoMat, { name: 'corselet', keep: ferrule });
  swap(diver.hips, g.hips, torsoMat, { name: 'hips' });
  swap(diver.pack, g.pack, torsoMat, { name: 'pack' });
  for (const [arm, R2] of [[diver.armL, false], [diver.armR, true]]) {
    const mat = R2 ? limbMatM : limbMat;
    swap(arm.root, g.upperArm, mat, { name: 'upperArm', mirror: R2, sy: stretch.armUp });
    swap(arm.mid, g.foreArm, mat, { name: 'foreArm', mirror: R2, sy: stretch.armLo });
    swap(arm.end, g.glove, mat, { name: 'glove', mirror: R2 });
  }
  for (const [leg, R2] of [[diver.legL, false], [diver.legR, true]]) {
    const mat = R2 ? limbMatM : limbMat;
    swap(leg.root, R2 ? g.thighR : g.thighL, mat, { name: R2 ? 'thighR' : 'thighL', mirror: R2, sy: stretch.legUp });
    swap(leg.mid, g.shin, mat, { name: 'shin', mirror: R2, sy: stretch.legLo });
    swap(leg.end, g.boot, mat, { name: 'boot', mirror: R2 });
  }
  STATE.mats = [helmMat, torsoMat, limbMat, limbMatM];
  STATE.installed = true; STATE.reason = 'installed'; STATE.ms = +A.ms.toFixed(1); STATE.ktx2 = !!A.ktx2;
  STATE.tex = assetTextures(A).size;
}

// ---- dev surface ----
if (typeof window !== 'undefined') {
  window.__salSculpt = {
    state: () => ({ installed: STATE.installed, reason: STATE.reason, ms: STATE.ms, ktx2: STATE.ktx2, meshes: STATE.meshes.length, tris: STATE.tris, warn: STATE.warn }),
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
