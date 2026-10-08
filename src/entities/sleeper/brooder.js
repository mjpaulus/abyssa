// THE BROODER — Velkath, zone 0's sleeper (roadmap/three-sleepers.md, spec §2).
// A plated crab-colossus: a domed carapace ~28 u across, eight rigid-jointed walking
// legs on planted-foot IK, a crusher and a cutter claw, eyes on stalks that fold into
// their orbits while she sleeps. Her wards are on the UNDERSIDE. Settled, the belly is
// in the sand and the wards sit below the terrain, so nothing needs a rule to keep them
// out of reach: standing up is what exposes them.
//
// Frames: the body group (L.body) is in shell units (carapace half-width = 1) and scaled
// by L.R; every rig computation below is in that local space. The wards, their halos
// and the embers live on L.grp at the world origin (the ward light pool is placed in
// world coordinates, exactly as the serpent does).
//
// This file is the body and its motion; the clutch and its rite are brood.js.
import * as THREE from 'three';
import { scene, envTexDeep as envTex } from '../../core.js';
import { V3, clamp, lerp, fbm } from '../../lib/math.js';
import { makeGlow, seededRand } from '../../lib/textures.js';
import { registerPaint } from '../../lib/paint.js';
import { terrainH, terrainMeshes } from '../../world/terrain.js';
import { setWardTargets } from '../../world/predators.js';
import {
  setLive, SIGIL_POOL_N, ensureSigilPool, makeWard, wardIdle, wardLitPose, wardTouch, wardFlashes, makeEmbers, lightWard,
  rememberWard, wardMemPose, wardsRecall, wardRefuse, MSG_BROOD_COLD
} from './common.js';
import * as G from './brooderGeo.js';
import { makeBrood } from './brood.js';
import { riftPos, WORLD_R } from '../../config.js';
import { wreckSites } from '../../world/wrecks.js';
import { emitDust } from '../../world/footfx.js';
import { loadSculpted, assetTextures, assetGeos } from '../../lib/assets.js';
import { applyMicroDetail, patchNormalRG, microTexture } from '../../lib/microDetail.js';
import { buildNear, groundAt, placeFoot, pushOut, steer, overTall, soleFromGeos, hullSamples, penetration } from './brooderGround.js';
import { spawnPlume, updatePlumes, plumeTau, clearPlumes } from './plume.js';
import { beginBodyCols, addCapsule, markLimbs, setShell, endBodyCols, clearBodyCols, fitCapsules, shellProxy } from './bodyCols.js';

// THE SCULPT (tools/blender pipeline, roadmap: sculpt): her shell, limbs, eyes and mouth as
// baked game meshes (DC-meshed SDF high poly -> Blender decimate/unwrap -> Cycles bakes).
// The fetch starts HERE, at import, off the boot's critical path; makeBrooder installs the
// sculpt if it has landed and otherwise builds the procedural body below and upgrades it
// in place when it does. A failed load leaves the procedural Brooder — nothing else changes.
const SCULPT = loadSculpted('assets/sleepers/brooder/', 'brooder');
let SC = null;
SCULPT.then(a => { SC = a; });

const UP = V3(0, 1, 0);
const smooth = THREE.MathUtils.smoothstep;
const R_OF_SIZE = 2.8;                     // carapace half-width in cfg.size units (5.5 -> 15.4 u)
// Walking legs, per side front to back: hip on the lip, rest-foot bearing off the side
// (+ toward the front), length scale (the middle pairs are the longest, as in crabs).
const LEGS = [
  { hip: [0.80, -0.07, 0.36], splay: 0.42, k: 0.92 },
  { hip: [0.86, -0.07, 0.10], splay: 0.12, k: 1.00 },
  { hip: [0.84, -0.07, -0.16], splay: -0.16, k: 1.00 },
  { hip: [0.74, -0.07, -0.42], splay: -0.46, k: 0.88 }
];
// Tall and spiked (Michael 2026-09-24: "crab like, menacing", not a literal crab): the
// knees ride above her back and the body towers over the diver. The first squat cut
// read as a friendly Cancer crab.
// Round 3 (Michael's reference painting, 2026-09-24): she is LOW and massive; short, dark,
// spined legs mostly hidden under the shingles. Round 2's tall spider legs are gone.
const SEG = { coxa: 0.14, femur: 0.48, tibia: 0.42, dactyl: 0.28 };
// Ward sockets on the underside, local position and outward normal. The first nSigils
// are used: mouth, both hips, then two more for chart rows that ask for them.
const SOCKETS = [
  { p: [0, -0.125, 0.56], n: [0, -0.94, 0.34] },
  { p: [0.52, -0.105, -0.06], n: [0.18, -0.98, 0] },
  { p: [-0.52, -0.105, -0.06], n: [-0.18, -0.98, 0] },
  { p: [0, -0.135, -0.36], n: [0, -1, 0] },
  { p: [0, -0.118, 0.18], n: [0, -1, 0] }
];
// Collision centres: the crown and a ring of eight over the shell, sized so the spheres
// stop at the belly and a diver can pass UNDER her when she stands.
const COLL = [[0, 0.17, 0]];
for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; COLL.push([Math.cos(a) * 0.55, 0.15, Math.sin(a) * 0.50]); }
const STRIDE = 0.30, SWING_T = 0.80, RISE_T = 6, SETTLE_T = 4;   // a colossus's step is slow (was 0.55)
// ASLEEP SHE IS A RIDGE (polish-followups). Every term below is scaled by (1 - standE), so
// the standing pose is bit-identical: x - k * 0 === x. `tuck` pulls each rest foot in under
// the shell, `fold` lays the leg plane flat (knee sideways, not up, so no knee stands
// above the rim), `drop` lowers the shell so the plate skirts sit in the silt, and the
// claws fold back under the prow (targets per joint, x/y/z Euler in the YZX order the arm
// uses; y is mirrored by side). Exported so the lab can tune it live.
export const DORM = {
  tuck: 0.76, fold: 1.0, drop: 0.0,        // brooder2: 0.035 -> 0 (the sculpt sat flush with the silt; her brow and keel crest now break it)
  // (searched: every joint inside 0.86 of the rim, nothing past the prow, below the shell)
  major: { root: [0, 1.0, -0.08], cj: [0, 1.2, 0.05], pj: [0, 1.6, -0.10], dj: -0.3 },
  minor: { root: [0, 1.0, -0.08], cj: [0, 1.2, 0.05], pj: [0, 1.0, -0.10], dj: -0.3 }
};

// ---- MOTION (anim-sleepers) ----------------------------------------------------------
// Nothing she does moves at constant velocity. Every visual degree of freedom that used
// to be a ramp or a sine is a damped spring (implicit integration: stable at any dt) fed
// by what her feet and claws are actually doing:
//   * the body rides its planted feet: height and pitch/roll off the foot plane, a dip on
//     every footfall and while a tetrapod is in the air, a sway toward the supporting side
//     phase-lagged behind the gait, and a translational lag (she surges and checks)
//   * the wake is a SEQUENCE on the rise clock, not a scale: she shudders, the silt pours,
//     her legs unfold one at a time in a crab's order, she sinks into them and HEAVES,
//     overshoots and settles; the claws come out last
//   * the hammer is anticipation - rear, cock, hold (trembling) - then the slam and a
//     recoil that bounces; the impact kicks dust, a body dip and a quake
//   * eyes saccade onto the diver; claws idle open/close with the weight on the crusher
// ev.quake (0..1, distance-weighted) is published for the game's camera shake.
const WAKE_ORDER = [0, 5, 2, 7, 1, 4, 3, 6];         // leg unfold order (li), alternating sides
const PH_COCK0 = 0.40, PH_COCK1 = 0.72, PH_SLAM0 = 0.84, PH_SLAM1 = 0.90;   // hammer cycle phases
const HAMMER_T = 2.6;
// THE HUNT (brooderfix): speeds are fractions of cfg.speed (9: Sal walks 2.15 u/s, 2.8 with
// Shift, hauls ~6.6 off the bottom). chase 0.42 = 3.8 u/s after a thief (she runs a walker
// down; a swimmer gets away), stalk 0.26 = 2.3 u/s otherwise. She closes to `hold` R from
// her centre (the hammer's hinge lands ~2.3 R out, measured; the hit takes 0.42 R round it), keeps an unburdened
// diver off `guard` R round her lair, and turns at up to `turn` rad/s while hunting.
// knock: the hammer's throw (u/s). It was 38 when she never moved: measured, it carried him
// ~35 u and out of her sight in the murk, so the chase that follows a blow never read; 26
// still throws him clear of her front (~20 u) and keeps her in his view as she comes on.
// guardUp: how far (rad) the minor claw's guard rises off her mouth when a diver is close
// under her face.
export const HUNT = { chase: 0.42, stalk: 0.26, hold: 2.05, guard: 7, turn: 0.5, lunge: 0.35, knock: 26, guardUp: 0.6 };
// implicit damped spring on a {x, v} pair: stable for any w*dt, overshoots for z < 1
function spr(o, target, w, z, dt) {
  o.v = (o.v + w * w * dt * (target - o.x)) / (1 + 2 * z * w * dt + w * w * dt * dt);
  o.x += o.v * dt;
  return o.x;
}
const S = () => ({ x: 0, v: 0 });
// cheap smooth 1D value noise in [-1, 1] (two incommensurate sines per octave)
const nz = (t, s) => 0.6 * Math.sin(t * 1.13 + s * 1.7) * Math.sin(t * 0.71 + s * 3.1) + 0.4 * Math.sin(t * 2.37 + s * 5.3);
const ease = x => x * x * (3 - 2 * x);
const win = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const EV = { sigilLit: 0, calmed: false, lightDrain: 0, slam: false, remaining: 0, msg: null, woke: false, quake: 0, plume: 0, plumeX: 0, plumeY: 0, plumeZ: 0 };

// Scratch (never allocated per frame).
const _hip = V3(), _d = V3(), _pn = V3(), _j1 = V3(), _ank = V3(), _ank2 = V3(), _knee = V3(), _ft = V3(), _v = V3();
const _x = V3(), _y = V3(), _z = V3(), _sc = V3(), _r = V3(), _rw = V3(), _lp = V3(), _pl = V3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qs = new THREE.Quaternion();
const _col = new THREE.Color();
const _u = V3(), _hz = V3();

// CHITIN SHEEN (polish-brooder): a pale, subsurface-ish rim on the arms, legs and mouth.
// A view-grazing Fresnel of the PERTURBED normal, scaled by the diffuse light the surface
// actually receives — so it lifts the silhouette of a lit limb like light through the
// edge of a shell, and is nothing at all in the dark (never a glow). One program for
// every material that carries it: they differ only in uniforms.
function chitinSheen(m) {
  m.customProgramCacheKey = () => 'abyssa-brooder-chitin';
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
        float chF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        chF = chF * chF * chF;
        vec3 chLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
        outgoingLight += chF * chLit * vec3(1.10, 1.22, 1.18) * 1.4;
      }
      #include <opaque_fragment>`);
  };
  return m;
}

// OWN WATER: where she sleeps at a remote anchorage (site.js row `lair`, read only when
// present — home never enters here). The rift itself never moves (THE CHART's frozen
// frame), so her ridge swings ROUND ITS LIP instead: `bear` (degrees) turns the shipped
// raft-side lip point about the rift centre; `arc` with the row's IDLE split [a, b]
// searches that arc and takes the lip point whose ground sits at a/(a+b) of the arc's
// height range (Pallid's [62, 38]: the HIGH lip — THE SLEEPERS SIT SHALLOW). Either way a
// point whose ridge or nest would sit on the zone's wreck is passed over, so the skiff
// never lies under her. Returns the lip and the rift-ward `out` the shipped code faces by.
// Pure function of the terrain and the row: a reseed lands her in the same place.
function lairOf(idx, R, c) {
  const rp = riftPos(idx), rad = 16 * 2.7 + R * 0.55, lr = c.lair;
  const in0 = Math.atan2(-rp.z, -rp.x);                 // the shipped bearing: rift -> raft side
  const W = idx < 3 ? wreckSites()[idx] : null;
  const at = th => {
    const dx = Math.cos(th), dz = Math.sin(th);
    const lip = V3(rp.x + dx * rad, 0, rp.z + dz * rad), out = V3(-dx, 0, -dz);
    const nest = lip.clone().addScaledVector(V3(-out.z, 0, out.x), R * 2.8);
    const clear = !W || (Math.hypot(lip.x - W.x, lip.z - W.z) > R * 2 + 16 && Math.hypot(nest.x - W.x, nest.z - W.z) > 22);
    const inBasin = Math.hypot(lip.x, lip.z) < WORLD_R * 0.66 && Math.hypot(nest.x, nest.z) < WORLD_R * 0.66;
    let g = 0;
    for (let k = 0; k < 5; k++) g += terrainH(lip.x + Math.cos(k * 1.2566) * R * 0.6, lip.z + Math.sin(k * 1.2566) * R * 0.6, idx);
    return { lip, out, ok: clear && inBasin, g: g / 5 };
  };
  const d2r = Math.PI / 180;
  if (lr.arc && c.idle) {
    const C = [];
    for (let a = lr.arc[0]; a <= lr.arc[1] + 1e-6; a += 10) { const q = at(in0 + a * d2r); if (q.ok) C.push(q); }
    if (C.length) {
      let lo = 1e9, hi = -1e9;
      for (const q of C) { lo = Math.min(lo, q.g); hi = Math.max(hi, q.g); }
      const want = lo + (hi - lo) * c.idle[0] / (c.idle[0] + c.idle[1]);
      let best = C[0];
      for (const q of C) if (Math.abs(q.g - want) < Math.abs(best.g - want)) best = q;
      return best;
    }
  }
  const b = (lr.bear || 0) * d2r;
  for (let k = 0; k < 24; k++) {
    const q = at(in0 + b + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * 15 * d2r);
    if (q.ok) return q;
  }
  return at(in0 + b);
}

export function makeBrooder(idx, cfg) {
  let c = cfg;
  if (c.nSigils > SIGIL_POOL_N) c = Object.assign({}, c, { nSigils: SIGIL_POOL_N });
  ensureSigilPool();
  const R = c.size * R_OF_SIZE;
  const grp = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(R);
  body.rotation.order = 'YXZ';
  grp.add(body);

  const L = {
    ...c, idx, R, size: c.size, grp, body, t: 0, agitation: 0, calmed: false, calmT: 0,
    sonarWards: false, guardWards: false, reveal: 0, rang: false, hinted: false, pendingMsg: null,
    reach: 5, collR: 0.33 * R, flare: 0,
    pos: V3(), yaw: 0, vel: V3(), stand: 0, standE: 0, standTarget: 0, threat: 0, threatE: 0, threatTarget: 0,
    walkTo: null, bodyY: 0, head: V3(), spine: COLL.map(() => V3()), sigils: [], feet: [], _pd: 1e9,
    uni: { uTime: { value: 0 } },
    // motion state (anim-sleepers): springs, per-leg unfold, the hammer, the flinch
    legSt: new Float32Array(8), clawSt: 0, heave: S(), bY: S(), bP: S(), bR: S(), offX: S(), offZ: S(),
    yawV: 0, velPrev: V3(), cock: 0, swing: 0, impT: 9, hamPh: 0, hurt: S(), shuffleT: 3, quake: 0,
    mPh: 0, segL0: { coxa: 1, femur: 1, tibia: 1, dactyl: 1 }, sculpted: false, eyeSt: null,
    // ground + sight (brooder-ground-plume): sole lift, collider push, what she can see
    soleLift: 0, pushed: 0, seen: true, lastSeen: V3(), blindT: 0, clearT: 0, tau: 0, aim: V3()
  };

  // ---- materials ----
  const maps = G.carapaceMaps(), chit = G.chitinMaps(), bmaps = G.bladeMaps();
  const grain = G.limbGrain(), paleAlb = G.limbAlbedo(true);
  L.keepTex = new Set([maps.map, maps.normalMap, maps.roughnessMap, grain, paleAlb,
    chit.map, chit.normalMap, chit.roughnessMap, bmaps.map, bmaps.normalMap, bmaps.roughnessMap]);
  const shellMat = registerPaint(new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 0, vertexColors: true,
    envMap: envTex, envMapIntensity: 0.35
  }));
  // Legs: the arms' chitin atlas (membranes, cuffs, stipple, horn tips) under a charcoal
  // tint — the painting's legs are near-black. Same program as the arms (chitinSheen).
  const limbMat = registerPaint(chitinSheen(new THREE.MeshStandardMaterial({
    color: 0x5e6463, map: chit.map, normalMap: chit.normalMap, roughnessMap: chit.roughnessMap,
    normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 0, vertexColors: true, envMap: envTex, envMapIntensity: 0.45
  })));
  // The underside is where the ward fight happens, looked at from below at arm's length:
  // it gets the limb mottle and grain at a fine repeat of its own (planar UV spans the
  // whole belly, so the shared repeats would read as a few blurry blotches).
  const bellyAlb = paleAlb.clone(), bellyGrain = grain.clone();
  bellyAlb.repeat.set(7, 7); bellyGrain.repeat.set(14, 14);
  bellyAlb.needsUpdate = bellyGrain.needsUpdate = true;
  const bellyMat = registerPaint(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: bellyAlb, roughness: 0.82, metalness: 0, vertexColors: true,
    normalMap: bellyGrain, normalScale: new THREE.Vector2(0.9, 0.9), envMap: envTex, envMapIntensity: 0.25
  }));

  // ---- shell ----
  G.setShellHeight(null);
  const shell = new THREE.Mesh(G.carapaceGeo(), shellMat);
  shell.castShadow = shell.receiveShadow = true;
  body.add(shell);
  const belly = new THREE.Mesh(G.bellyGeo(), bellyMat);
  belly.castShadow = belly.receiveShadow = true;
  body.add(belly);
  L.parts = { shell, belly };
  L.sole = soleFromGeos([shell.geometry, belly.geometry]);    // ground contact (brooderGround.js)
  L.shellProx = shellProxy([shell.geometry, belly.geometry]);  // her outer volume, solid to Sal (bodyCols.js)

  // ---- crust: barnacles and weed ----
  const bar = G.barnacleMatrices(36, 0xBA2AC1E5 + idx);
  const barnMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 0.86, normalMap: grain, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0, side: THREE.DoubleSide, envMap: envTex, envMapIntensity: 0.25 }));
  const barn = new THREE.InstancedMesh(G.barnacleGeo(), barnMat, bar.m.length);
  bar.m.forEach((m, i) => { barn.setMatrixAt(i, m); barn.setColorAt(i, bar.c[i]); });
  barn.instanceMatrix.needsUpdate = true;
  if (barn.instanceColor) barn.instanceColor.needsUpdate = true;
  barn.castShadow = true;
  body.add(barn);
  L.parts.barn = barn;

  // a frond, not a paper strip: tapered to a point, folded along its midrib, curling
  const weedGeo = new THREE.PlaneGeometry(0.014, 0.14, 2, 5);
  weedGeo.translate(0, 0.07, 0);
  {
    const p = weedGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), t = y / 0.14;
      p.setX(i, x * (1 - 0.85 * t) * (1 + 0.4 * Math.sin(t * 9)));
      p.setZ(i, Math.abs(x) * 0.9 + 0.02 * t * t);
    }
    weedGeo.computeVertexNormals();
  }
  const weedMat = new THREE.MeshStandardMaterial({ color: 0x4a5634, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  weedMat.customProgramCacheKey = () => 'abyssa-brooder-weed';
  weedMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = L.uni.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        float wh = clamp(position.y / 0.14, 0.0, 1.0);
        float wi = float(gl_InstanceID);
        transformed.x += sin(uTime * 1.4 + wi * 1.7 + wh * 2.0) * 0.030 * wh * wh;
        transformed.z += cos(uTime * 1.1 + wi * 2.3) * 0.020 * wh * wh;`);
  };
  const wm = G.weedMatrices(150, 0x77EED + idx);
  const weed = new THREE.InstancedMesh(weedGeo, weedMat, wm.length);
  wm.forEach((m, i) => weed.setMatrixAt(i, m));
  weed.instanceMatrix.needsUpdate = true;
  body.add(weed);
  L.parts.weed = weed;

  // ---- walking legs: one InstancedMesh per segment type, eight instances each ----
  const legs = {
    coxa: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.125, r1: 0.118, rows: 16, radial: 16 }), limbMat, 8),
    femur: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.122, r1: 0.092, spines: 8, rows: 30 }), limbMat, 8),
    tibia: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.090, r1: 0.060, spines: 6 }), limbMat, 8),
    dactyl: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.060, r1: 0, tip: true, curl: 0.16, rows: 22, radial: 12 }), limbMat, 8)
  };
  for (const k in legs) {
    legs[k].frustumCulled = false;                 // instance bounds go stale as she walks
    legs[k].castShadow = true;
    legs[k].instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    body.add(legs[k]);
  }
  L.legs = legs;
  L.legFit = fitLegs(legs);
  for (let li = 0; li < 8; li++) {
    const sd = li < 4 ? 1 : -1, k = li & 3;
    L.feet.push({ planted: V3(), from: V3(), to: V3(), cur: V3(), t: -1, h: 0.30, group: (k + (sd > 0 ? 0 : 1)) & 1 });
  }

  // Round 3 arms, after the reference: two huge armoured arms held forward like a guard,
  // grey-teal chitin with a wet sheen, set with pale knobs, ending in long hooked
  // pincers that run to rust at the tips. The right (+X) arm is the major.
  // AAA pass: a generated chitin atlas (G.chitinMaps) — fine stipple normal, teal and pale
  // flecks, pale wrinkled membranes at every joint, rust on the pincers as a MAP running to
  // dark horn at the points — plus a pale subsurface-ish rim (chitinSheen).
  const armMat = registerPaint(chitinSheen(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: chit.map, normalMap: chit.normalMap, roughnessMap: chit.roughnessMap,
    normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 0.08, vertexColors: true, envMap: envTex, envMapIntensity: 0.7
  })));
  // Lopsided on purpose (the coconut crab / fiddler read): the major claw is nearly
  // twice the minor. The asymmetry is the first thing the silhouette says.
  L.claws = [buildClaw(body, armMat, -1, 0.72), buildClaw(body, armMat, 1, 1.35)];
  for (const cl of L.claws) clawSamples(cl);

  // ---- the shingles: layered blade-plates down the flanks, the silhouette ----
  // AAA pass: four broken-edge plate variants (bevelled rim, thick root, growth shelves in
  // their own atlas strip), one InstancedMesh each, every plate tinted a little its own way.
  const bladeMatl = registerPaint(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: bmaps.map, normalMap: bmaps.normalMap, roughnessMap: bmaps.roughnessMap,
    normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 0.0, vertexColors: true, envMap: envTex, envMapIntensity: 0.4
  }));
  const bm = G.bladeMatrices(0xB1ADE5 + idx), brnd = seededRand(0xB1AD7 + idx), byV = [[], [], [], []];
  for (const m of bm) byV[Math.floor(brnd() * G.BLADE_VARIANTS) % G.BLADE_VARIANTS].push(m);
  L.blades = [];
  for (let v = 0; v < G.BLADE_VARIANTS; v++) {
    if (!byV[v].length) continue;
    const blades = new THREE.InstancedMesh(G.bladeGeo(v), bladeMatl, byV[v].length);
    byV[v].forEach((m, i) => {
      blades.setMatrixAt(i, m);
      const a = brnd(), b = brnd(), k = 0.86 + 0.26 * brnd();
      _col.setRGB(k * (0.94 + 0.14 * a), k * (0.96 + 0.06 * b), k * (0.92 + 0.12 * (1 - a)));
      blades.setColorAt(i, _col);
    });
    blades.instanceMatrix.needsUpdate = true;
    blades.instanceColor.needsUpdate = true;
    blades.castShadow = blades.receiveShadow = true;
    body.add(blades);
    L.blades.push(blades);
  }

  // ---- the reef on her back ----
  // one merged mesh: tube sponges with oscula, lattice fans, encrusting mats (vertex colour)
  {
    const reefGrain = grain.clone();
    reefGrain.repeat.set(3, 3); reefGrain.needsUpdate = true;
    const m = new THREE.Mesh(G.reefGeo(0x4EEF + idx), registerPaint(new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide,
      normalMap: reefGrain, normalScale: new THREE.Vector2(0.8, 0.8), envMap: envTex, envMapIntensity: 0.25
    })));
    m.castShadow = true;
    body.add(m);
    L.parts.reef = m;
  }

  // ---- the face: a cluster of eight black eyes under the brow, no glow — only
  // cold catchlights — and a cage of hooked mouthparts that never stops working ----
  // AAA pass: wet black domes with a gold ring at the rim, sunk in cupped sockets (one
  // merged eye geometry); the eyeshine emissive is masked to the dome by vertex colour.
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.05, metalness: 0.25, envMap: envTex, envMapIntensity: 1.4,
    emissive: 0xcfe9d6, emissiveIntensity: 0.0 });
  eyeMat.customProgramCacheKey = () => 'abyssa-brooder-eye';
  eyeMat.onBeforeCompile = sh => {
    // vColor.r < 0.004 is the black dome: only it glows, and only it is mirror-wet; the
    // gold ring and the mounds are satin
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float eyeK = 1.0 - smoothstep(0.004, 0.01, vColor.r);
      roughnessFactor = mix(0.55, roughnessFactor, eyeK);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 1.0 - smoothstep(0.004, 0.01, vColor.r);`);
  };
  L.eyeMat = eyeMat;
  // pinpoints deep in the shadow under the prow (the reference's white eyes)
  const EYES = G.EYES;
  const eyes = new THREE.InstancedMesh(G.eyeGeo(), eyeMat, EYES.length * 2);
  let ei = 0;
  for (const [x, y, z, r] of EYES) for (const sd of [-1, 1]) {
    _q.setFromUnitVectors(_x.set(0, 0, 1), _y.set(x * sd * 3.8, 0, 1).normalize());   // square to the face plate
    eyes.setMatrixAt(ei++, _m.compose(_v.set(x * sd, y, z), _q, _sc.set(r, r, r)));
  }
  eyes.instanceMatrix.needsUpdate = true;
  body.add(eyes);
  L.parts.eyes = eyes;
  // mouthparts: the chitin, but wetter (one program with the arms: only uniforms differ)
  const mouthMat = registerPaint(chitinSheen(new THREE.MeshStandardMaterial({
    color: 0x8c8580, map: chit.map, normalMap: chit.normalMap, roughnessMap: chit.roughnessMap,
    normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.55, metalness: 0.08, vertexColors: true, envMap: envTex, envMapIntensity: 1.1
  })));
  L.mouth = [];
  for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(0.035 * sd + 0.022 * k * sd, -0.20 - 0.012 * k, 0.84 - 0.025 * k);
    hinge.rotation.order = 'YZX';
    const hook = new THREE.Mesh(G.hornGeo({ len: 0.16 - 0.018 * k, r0: 0.026, curve: -0.35, bite: -1, teeth: 'saw', rows: 12, radial: 8, fringe: 12 }), mouthMat);
    hinge.add(hook);
    body.add(hinge);
    L.mouth.push({ hinge, sd, k, hook });
  }
  L.chitMats = { limbMat, armMat, mouthMat };
  // HARDER WATER (site.js sleeper row `hard`; absent = shipped): a quicker hammer and a
  // longer reach before she rears. The cycle's shape (guard, cock, trembling hold, fall)
  // is unchanged, so every blow still telegraphs; there is just less time between them.
  L.hammerT = c.hard && c.hard.hammerT || HAMMER_T;
  L.threatR = c.hard && c.hard.threatR || 2.4;

  // ---- wards ----
  const wardScale = 4.2;
  for (let i = 1; i <= c.nSigils; i++) {
    const w = makeWard(L, i, wardScale);
    const s = SOCKETS[i - 1];
    w.local = V3(s.p[0], s.p[1], s.p[2]);
    w.q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(s.n[0], s.n[1], s.n[2]).normalize());
    L.sigils.push(w);
  }
  // RITUAL, REMEMBERED: the ward the old calm keeps is the FRONT socket, under her prow
  // between the claws. Two reasons. (1) THE BROOD RULE must survive the memory: it is not
  // a fixed ward but "the last DARK ward will not light while the clutch is robbed". Pre-counting
  // a ward that is lit from the boot means it can never BE the last dark one, so the rule
  // still lands on a ward the diver has to reach (the second flank ward): one touch, then
  // the clutch decides. Had the memory been "the last ward lights itself", the brood rule
  // would have been the free ward and the clutch would no longer matter. (2) The front ward
  // is the one inside the lunge and the hammer cycle; the flank wards are the ones her
  // sideways stalk offers. The memory spares the cruellest approach and keeps the walk
  // round her, the stand and the clutch: the rite is shorter, not different.
  rememberWard(L, 0);
  L.memLine = 'SHE KNOWS YOUR HAND. ONE WARD STILL REMEMBERS.';
  makeEmbers(L, c.size);

  // THE RIDGE: she sleeps at this zone's rift, facing the open seabed the diver comes
  // from, a reef-crusted mound in the silt. Her clutch bulges from under her rim, and a trail of
  // tracks runs in from the open ground past a shed shell and spent egg skins. Prying a
  // clump wakes her (brood.onTake); calmed, she walks back and settles over her clutch,
  // which clears the way.
  {
    const rp = riftPos(idx);
    let out = V3(rp.x, 0, rp.z).normalize(), lip;
    // on the rift's LIP (its bowl is a deep funnel — sat in it she was a hole, not a
    // ridge), between the rift and the open ground, facing the way a diver comes
    if (!c.lair) lip = V3(rp.x, 0, rp.z).addScaledVector(out, -(16 * 2.7 + R * 0.55));   // shipped, exactly
    else ({ lip, out } = lairOf(idx, R, c));
    const perp = V3(-out.z, 0, out.x);
    placeAt(L, lip, Math.atan2(-out.x, -out.z));
    L.lairPos = lip.clone();
    // (the old nest's spot, kept only as the start of her trail: the tracks run in from 95 u
    // out past it, exactly where they always began)
    const nest = lip.clone().addScaledVector(perp, R * 2.8);
    L.brood = makeBrood(L, idx, nest.clone().addScaledVector(out, -95));
    L.rite = L.brood;                                 // the game's generic [E] / prompt hook
    L.lairWhere = 'BY THE RIFT';
    L.dormant = true;
    L.brood.onTake = () => { if (L.dormant) wakeBrooder(L); };
  }

  L.cmd = (name, arg) => {
    if (name === 'wake') { if (L.dormant) wakeBrooder(L); }
    else if (name === 'stand') L.standTarget = 1;
    else if (name === 'settle') { L.standTarget = 0; L.walkTo = null; }
    else if (name === 'walk') { L.walkTo = arg ? arg.clone() : null; L.standTarget = 1; }
    else if (name === 'rear') L.threatTarget = L.threatTarget > 0.5 ? 0 : 1;
    else if (name === 'hold') L.hold = !L.hold;         // lab framing: stop tracking the diver
    else if (name === 'place') { placeAt(L, arg.pos, arg.yaw); if (L.dormant && L.skirt) { poseAll(L, 0, null); if (L.brood) L.brood.seat(); fitSkirt(L); } }
    return L.probe();
  };
  L.probe = () => ({
    kind: 'brooder', dormant: !!L.dormant, clutchOut: L.brood ? L.brood.out() : 0, held: L.brood ? L.brood.held : -1, stand: L.stand, threat: L.threat, yaw: L.yaw, pos: L.pos.toArray(), bodyY: L.bodyY,
    swinging: L.feet.filter(f => f.t >= 0).length, walking: !!L.walkTo, calmed: L.calmed,
    remembered: !!L.remembered, memWard: L.memWard >= 0 ? L.memWard : -1,
    wards: L.sigils.map(g => ({ lit: g.lit, mem: !!g.mem, y: +(g.grp.position.y - terrainH(g.grp.position.x, g.grp.position.z, L.idx)).toFixed(2) })),
    tris: countTris(L.body), sculpted: L.sculpted,
    eyes: L.eyeSt ? L.eyeSt.map(e => ({ errDeg: +(e.err * 57.3).toFixed(1), saccades: e.n })) : null,
    sight: { seen: L.seen, tau: +L.tau.toFixed(2), blindT: +L.blindT.toFixed(2), aim: L.aim.toArray().map(v => +v.toFixed(1)), lost: L.lostN || 0 },
    ground: { soleLift: +L.soleLift.toFixed(2), pushed: +L.pushed.toFixed(3), climb: +(L.climbT > 0 ? L.climbT : 0).toFixed(1), clawLift: L.claws.map(c => +(c.liftNow || 0).toFixed(3)), elbow: L.claws.map(c => +(c.elbow || 0).toFixed(3)) }
  });

  if (typeof window !== 'undefined') window.__sl = L;        // dev: the live sleeper object (motion probes)
  scene.add(grp);
  setLive(L);
  setWardTargets(-1, null);
  poseAll(L, 0, null);
  if (L.brood) L.brood.seat();                       // the clutch rests on her bed (brood.js): before the drift, which leaves its side open
  buildSkirt(L);
  if (SC) installSculpt(L, SC);
  else SCULPT.then(a => { if (a && !L.gone) { installSculpt(L, a); poseAll(L, 0, null); if (L.brood && L.dormant) { L.brood.seat(); fitSkirt(L); } } });
  const pd = L.onDispose;
  L.onDispose = () => { L.gone = true; clearPlumes(); clearBodyCols(); if (pd) pd(); };
  return L;
}

// ---- THE SILT DRIFT (polish-followups) ----
// Asleep on the rift lip she sits over hollow ground: the floor falls away under her flanks
// and tail by up to a third of her width, and through that gap she read as a crab on its
// legs. A bank of silt now drifts up against her all round, from the floor to the underside
// of her rim, as years of settling sediment would. It is drawn in the SEABED'S OWN
// MATERIAL (world-space triplanar, same zone palette, same program) with the seabed's own
// vertex channels resampled from the terrain mesh, so the drift is continuous with the
// floor it grows out of; only the AO channel darkens toward her, where silt meets shell.
// Its outer edge is buried a hair under the floor (the heightfield mesh is a linear
// sampling of terrainH; the edge must never float). Built at placement (not per frame);
// as she rises it sinks away under the silt pouring off her back, and once she has stood
// it is gone for good. The seabed material is SHARED: it is lifted out of L.grp before
// disposeSleeper can free it.
const SK_COLS = 128, SK_RINGS = 9;
function buildSkirt(L) {
  const tm = terrainMeshes[L.idx];
  if (!tm) return;
  const n = SK_COLS * SK_RINGS, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const idx = [];
  for (let i = 0; i < SK_RINGS - 1; i++) for (let j = 0; j < SK_COLS; j++) {
    const a = i * SK_COLS + j, b = i * SK_COLS + (j + 1) % SK_COLS, c = a + SK_COLS, d = b + SK_COLS;
    idx.push(a, b, c, b, d, c);
  }
  g.setIndex(idx);
  const m = new THREE.Mesh(g, tm.material);
  m.receiveShadow = true;
  m.frustumCulled = true;
  L.grp.add(m);
  L.skirt = m;
  fitSkirt(L);
  const prev = L.onDispose;
  L.onDispose = () => { if (m.parent) m.parent.remove(m); g.dispose(); if (prev) prev(); };
}

// bilinear sample of the seabed mesh's vertex colour at world x,z (its grid is separable)
function seabedColor(tm, x, z, out) {
  const P = tm.geometry.attributes.position.array, C = tm.geometry.attributes.color.array;
  const n = Math.round(Math.sqrt(P.length / 3));
  const find = (v, stride, off) => {                  // largest k with axis[k] <= v
    let lo = 0, hi = n - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (P[mid * stride + off] <= v) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const k = find(x, 3, 0), j = find(z, n * 3, 2);
  const x0 = P[k * 3], x1 = P[(k + 1) * 3], z0 = P[j * n * 3 + 2], z1 = P[(j + 1) * n * 3 + 2];
  const u = clamp((x - x0) / (x1 - x0), 0, 1), v = clamp((z - z0) / (z1 - z0), 0, 1);
  for (let c = 0; c < 3; c++) {
    const a = C[(j * n + k) * 3 + c], b = C[(j * n + k + 1) * 3 + c], e = C[((j + 1) * n + k) * 3 + c], f = C[((j + 1) * n + k + 1) * 3 + c];
    out[c] = (a * (1 - u) + b * u) * (1 - v) + (e * (1 - u) + f * u) * v;
  }
  return out;
}

function fitSkirt(L) {
  const m = L.skirt;
  if (!m) return;
  const tm = terrainMeshes[L.idx], g = m.geometry, P = g.attributes.position, C = g.attributes.color;
  const mw = L.body.matrixWorld, R = L.R, rgb = [0, 0, 0];
  // the gap under the rim, per bearing, smoothed round the ring (a drift has no corners)
  const gap = new Float32Array(SK_COLS), gs = new Float32Array(SK_COLS);
  for (let j = 0; j < SK_COLS; j++) {
    const th = j / SK_COLS * Math.PI * 2, rr = G.rimR(th);
    _v.set(Math.cos(th) * rr * 0.97, -0.02, Math.sin(th) * rr * 0.97).applyMatrix4(mw);
    gap[j] = _v.y - terrainH(_v.x, _v.z, L.idx);
  }
  for (let j = 0; j < SK_COLS; j++) {
    let a = 0;
    for (let q = -3; q <= 3; q++) a += gap[(j + q + SK_COLS) % SK_COLS];
    gs[j] = Math.min(gap[j], a / 7);
  }
  // THE CLUTCH'S SIDE (brooder-clutch): her fanning keeps the silt off the eggs that bulge out
  // from under her rim there, so the drift opens over that arc (brood.js seat picks it)
  const nB = L.brood && L.brood.seated ? L.brood.bear : null, nW = L.brood ? L.brood.notch : 0;
  const notchK = j => {
    if (nB === null) return 0;
    let d = j / SK_COLS * Math.PI * 2 - nB;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return 1 - smooth(Math.abs(d), nW * 0.55, nW);
  };
  for (let j = 0; j < SK_COLS; j++) {
    const th = j / SK_COLS * Math.PI * 2, rr = G.rimR(th), c = Math.cos(th), sn = Math.sin(th);
    const nk = notchK(j), gp = gs[j] * (1 - nk), w = clamp(gp * 1.7, 1.6, 9.5) / R;        // repose: ~30 degrees, wider for a deeper hollow
    for (let i = 0; i < SK_RINGS; i++) {
      let rho, ly = -0.02, s = 0;
      if (i === 0) { rho = 0.80; ly = -0.10; }
      else if (i === 1) rho = 0.97;
      else { s = (i - 1) / (SK_RINGS - 2); rho = 0.97 + w * s; }
      _v.set(c * rr * rho, ly, sn * rr * rho).applyMatrix4(mw);
      const th0 = terrainH(_v.x, _v.z, L.idx);
      let y = _v.y;
      if (i >= 2) {
        const prof = Math.pow(1 - s, 1.6) * (1 + 0.5 * s);
        const rip = (fbm(_v.x * 0.35, _v.z * 0.35) - 0.5) * 0.9 * s * (1 - s) * Math.min(1, gp / 2);
        y = th0 + Math.max(0, gp) * prof + rip - 0.08 * s * s;
        if (i === SK_RINGS - 1) y = th0 - 0.10;
      }
      if (i < 2 && nk > 0) y += (th0 - 0.12 - y) * nk;          // the open side: no curtain of silt under the rim
      if (y < th0 - 0.12 && i >= 1) y = th0 - 0.12;             // where the floor stands over her rim, the drift is under it
      P.setXYZ(i * SK_COLS + j, _v.x, y, _v.z);
      seabedColor(tm, _v.x, _v.z, rgb);
      const dk = i < 2 ? 0.42 : 0.42 + 0.58 * Math.pow(s, 0.6);  // darker where silt meets shell
      C.setXYZ(i * SK_COLS + j, rgb[0] * dk, rgb[1], rgb[2]);
    }
  }
  P.needsUpdate = C.needsUpdate = true;
  g.computeVertexNormals();
  // the seabed material is FrontSide: make sure the drift faces up
  const N = g.attributes.normal;
  let ny = 0;
  for (let i = 0; i < N.count; i++) ny += N.getY(i);
  if (ny < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  m.position.y = 0;
  m.visible = true;
}

function countTris(root) {
  let n = 0;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry.index) return;
    n += o.geometry.index.count / 3 * (o.isInstancedMesh ? o.count : 1);
  });
  return n;
}

// A cheliped as a joint chain: root (merus) -> carpus -> palm -> moving finger. Each
// joint is a Group so posing is plain Euler writes (no allocation). `k` scales the minor arm.
function buildClaw(body, mat, sd, k) {
  const root = new THREE.Group();
  root.position.set(0.30 * sd, -0.10, 0.66);
  root.rotation.order = 'YZX';
  root.scale.setScalar(k);
  body.add(root);
  const ML = 0.40;
  const merus = new THREE.Mesh(G.segmentGeo({ r0: 0.130, r1: 0.118, spines: 3, knobs: 5, rows: 34, radial: 22, x0: -0.35, capF: 0.22 }), mat);   // its root buried under the lip
  merus.scale.x = ML;
  merus.castShadow = true;
  root.add(merus);
  const cj = new THREE.Group();
  cj.position.x = ML;
  cj.rotation.order = 'YZX';
  root.add(cj);
  const carpus = new THREE.Mesh(G.segmentGeo({ r0: 0.118, r1: 0.128, knobs: 2, rows: 24, radial: 22, capF: 0.3 }), mat);
  carpus.scale.x = 0.24;
  carpus.castShadow = true;
  cj.add(carpus);
  const pj = new THREE.Group();
  pj.position.x = 0.24;
  pj.rotation.order = 'YZX';
  cj.add(pj);
  const pg = G.palmGeo('hook');
  const palm = new THREE.Mesh(pg, mat);
  palm.castShadow = true;
  pj.add(palm);
  const dj = new THREE.Group();
  dj.position.fromArray(pg.userData.hinge);
  pj.add(dj);
  const dact = new THREE.Mesh(G.hornGeo({ len: 0.66, r0: 0.105, curve: -0.34, bite: -1, teeth: 'fang', knobs: 4 }), mat);
  dact.castShadow = true;
  dj.add(dact);
  return { root, cj, pj, dj, sd, major: k >= 1, merus, carpus, palm, dact };
}
// the claw's hull samples for the floor clamp (re-run when the sculpt swaps the meshes)
function clawSamples(c) {
  c.samp = [c.merus, c.carpus, c.palm, c.dact].map(mesh => ({ mesh, pts: hullSamples(mesh.geometry, 7, mesh === c.merus ? 0.04 : -1e9) }));
  // ...and its collision capsules (bodyCols.js), one per piece in the piece's own frame
  // (the hooked palm and finger follow their curve in short pieces)
  c.fit = [];
  for (const [mesh, n] of [[c.merus, 1], [c.carpus, 1], [c.palm, 3], [c.dact, 3]]) for (const f of fitCapsules(mesh.geometry, n)) c.fit.push({ mesh, f });
  if (!c.lift) { c.lift = { x: 0, v: 0 }; c.need = 0; c.need0 = 0; c.liftNow = 0; }
}

// ---- THE SCULPT, installed ---------------------------------------------------------------
// Swaps the procedural body for the pipeline's baked meshes, in place (at build, or later
// if the load lands after she was built). Rig, gameplay anchors, wards and collision are
// untouched: every piece was sculpted in the frame of the joint it rides.
const _eyeZ = V3(0, 0, 1);
function sculptMat(maps, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.ormMap, aoMap: maps.ormMap, aoMapIntensity: 1,
    normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 0, envMap: envTex, envMapIntensity: 0.4
  }, extra || {}));
}
// brooder2: the last wraps on a sculpt material, in this order (lib/microDetail.js): the
// shared micro-detail layer (masked by ORM.B cavity when the bake carries it), then the Z
// rebuild for two-channel KTX2 normals
function finishSculpt(m, maps, set, micro) {
  if (micro) applyMicroDetail(m, Object.assign({ cav: !!(set && set.ormB === 'cavity') }, micro));
  if (maps.normalMap && maps.normalMap.userData.rg) patchNormalRG(m);
  return m;
}
// retire a procedural part: its geometry, its material, and any texture it owned that
// nothing else keeps (the belly's cloned mottle), so a swap leaks nothing
function drop(L, o) {
  if (!o) return;
  if (o.parent) o.parent.remove(o);
  o.geometry.dispose();
  const m = o.material;
  for (const k in m) { const v = m[k]; if (v && v.isTexture && v !== envTex && !L.keepTex.has(v)) v.dispose(); }
  m.dispose();
}
function installSculpt(L, A) {
  const g = A.geos, meta = A.meta.meta || {};
  if (!g.body || !A.maps.body || !A.maps.limbs || L.sculpted) return;
  L.sculpted = true;
  L.keepTex = new Set([...L.keepTex, ...assetTextures(A), microTexture()]);   // the micro layer is shared by every creature
  L.keepGeo = assetGeos(A);
  const P = L.parts, body = L.body;
  // the fused shell replaces the scute shell, the belly, the barnacles and the shingles
  const sets = (A.meta && A.meta.sets) || {};
  // the shell's micro layer: a 0.77 u tile (20 per shell unit), crevice grit, polished edges;
  // her AO no longer doubles up on the paint's (the bores read deep, not punched to black)
  const bodyMat = finishSculpt(registerPaint(sculptMat(A.maps.body, { envMapIntensity: 0.35, aoMapIntensity: 0.8 })), A.maps.body, sets.body,
    { scale: 20, normal: 0.9, cavity: 0.45, rough: 0.3 });
  P.shell.geometry.dispose(); P.shell.material.dispose();
  P.shell.geometry = g.body; P.shell.material = bodyMat;
  L.sole = soleFromGeos([g.body]);                   // the baked shell's own underside
  L.shellProx = shellProxy([g.body]);
  drop(L, P.belly); drop(L, P.barn);
  for (const b of L.blades) drop(L, b);
  L.blades = [];
  // the reef and the weed re-seat on the sculpted top surface (probe from the pipeline)
  const top = A.meta.probes && A.meta.probes.top;
  if (top) {
    const { x0, x1, z0, z1, n, h } = top;
    G.setShellHeight((x, z) => {
      const fx = (x - x0) / (x1 - x0) * (n - 1), fz = (z - z0) / (z1 - z0) * (n - 1);
      if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return null;
      const i = Math.min(n - 2, fx | 0), j = Math.min(n - 2, fz | 0), tx = fx - i, tz = fz - j;
      const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
      if (a == null || b == null || c == null || d == null) return a != null ? a : b != null ? b : c != null ? c : d;
      return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    });
    const rg = G.reefGeo(0x4EEF + L.idx);
    P.reef.geometry.dispose(); P.reef.geometry = rg;
    const wm = G.weedMatrices(Math.min(P.weed.count, 60), 0x77EED + L.idx);
    wm.forEach((m, i) => P.weed.setMatrixAt(i, m));
    P.weed.count = wm.length;
    P.weed.instanceMatrix.needsUpdate = true;
    G.setShellHeight(null);
  }
  // limbs: one shared atlas, the chitin sheen program the procedural limbs used
  const lm = A.maps.limbs;
  const lset = sets.limbs, limbMicro = { scale: 30, normal: 0.6, cavity: 0.35, rough: 0.22 };
  const legMat = finishSculpt(registerPaint(chitinSheen(sculptMat(lm, { envMapIntensity: 0.45 }))), lm, lset, limbMicro);
  const armMat = finishSculpt(registerPaint(chitinSheen(sculptMat(lm, { envMapIntensity: 0.7, metalness: 0.06 }))), lm, lset, limbMicro);
  const SEG_L = meta.segL || { coxa: 0.14, femur: 0.48, tibia: 0.42, dactyl: 0.28 };
  for (const k of ['coxa', 'femur', 'tibia', 'dactyl']) {
    const im = L.legs[k];
    im.geometry.dispose();
    im.geometry = g['leg_' + k]; im.material = legMat;
    L.segL0[k] = SEG_L[k];
  }
  L.legFit = fitLegs(L.legs);
  L.chitMats.limbMat.dispose();
  for (const c of L.claws) {
    const side = c.major ? 'major' : 'minor', H = (meta.hand || {})[side];
    for (const [mesh, piece] of [[c.merus, 'merus'], [c.carpus, 'carpus'], [c.palm, 'palm'], [c.dact, 'dactyl']]) {
      mesh.geometry.dispose();
      mesh.geometry = g[side + '_' + piece];
      mesh.material = armMat;
      mesh.scale.set(1, 1, 1);
    }
    if (H) c.dj.position.fromArray(H.hinge);
    clawSamples(c);
  }
  L.chitMats.armMat.dispose();
  // THE MOUTH (brooder2): layered maxillipeds and mandibles (meta.mouth maps the rig's five
  // pairs onto the pieces and re-seats their hinges); the motion is the rig's own. The left
  // side is the right MIRRORED (scale.z = -1): three flips the winding for a negative
  // determinant, and the mirrored material's normalScale.y = -1 keeps the baked normals'
  // bitangent right. Older assets (one 'mouthpart' palp) keep the old path.
  const mouthMat = finishSculpt(registerPaint(chitinSheen(sculptMat(lm, { envMapIntensity: 1.1, roughness: 0.9 }))), lm, lset, { scale: 60, normal: 0.35, cavity: 0.25, rough: 0.2 });
  const MOUTH = meta.mouth;
  if (MOUTH && MOUTH.every(q => g[q.piece])) {
    const mouthMatM = finishSculpt(registerPaint(chitinSheen(sculptMat(lm, { envMapIntensity: 1.1, roughness: 0.9, normalScale: new THREE.Vector2(1, -1) }))), lm, lset, { scale: 60, normal: 0.35, cavity: 0.25, rough: 0.2 });
    for (const m of L.mouth) {
      const q = MOUTH[m.k];
      m.hook.geometry.dispose();
      m.hook.geometry = g[q.piece];
      m.hook.material = m.sd > 0 ? mouthMat : mouthMatM;
      m.hook.scale.set(q.s, q.s, q.s * m.sd);
      m.hinge.position.set(q.hinge[0] * m.sd, q.hinge[1], q.hinge[2]);
    }
  } else {
    const ML = meta.mouthL || 0.16;
    for (const m of L.mouth) {
      m.hook.geometry.dispose();
      m.hook.geometry = g.mouthpart;
      m.hook.material = mouthMat;
      m.hook.scale.setScalar((0.16 - 0.018 * m.k) / ML);
    }
  }
  L.chitMats.mouthMat.dispose();
  // THE EYES: two stalked compound eyes that track the diver in saccades; the pinpoint
  // ocelli stay in their pits in the brow (the old eye cluster, down to four)
  const oc = meta.ocelli || [];
  const eyes = P.eyes;
  let ei = 0;
  for (const [x, y, z, r] of oc) for (const sd of [-1, 1]) {
    _q.setFromUnitVectors(_x.set(0, 0, 1), _y.set(x * sd * 2.5, 0.1, 1).normalize());
    eyes.setMatrixAt(ei++, _m.compose(_v.set(x * sd, y, z), _q, _sc.set(r, r, r)));
  }
  eyes.count = ei;
  eyes.instanceMatrix.needsUpdate = true;
  // brooder2, THE EYES READ WITHOUT GOING NEON. The eyeshine is a PSEUDOPUPIL: a small
  // spot on the cornea where its facets look straight back down the viewer's ray (so it
  // slides across the eye as she turns, like a real crustacean's), not the whole cornea lit.
  // The cornea is found by its baked ROUGHNESS (glassy), not by darkness (the pigment band
  // is dark too). A cold rim scaled by the light the eye actually receives lifts its form
  // off the dark face at game distance, and is nothing in the dark. Intensity is scaled down
  // (L.stalkK, L.ocK) because the spot now carries it.
  const stalkMat = registerPaint(sculptMat(lm, { envMapIntensity: 1.4, emissive: 0xd9e6c4, emissiveIntensity: 0 }));
  stalkMat.customProgramCacheKey = () => 'abyssa-brooder-stalk2';
  const eyeRim = { value: 0.45 };
  stalkMat.onBeforeCompile = sh => {
    sh.uniforms.uEyeRim = eyeRim;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uEyeRim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float eyC = 1.0 - smoothstep(0.12, 0.22, roughnessFactor);
      float eyV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      totalEmissiveRadiance *= eyC * pow(eyV, 36.0) * 1.4;`)
      .replace('#include <opaque_fragment>', `{
        float eyF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        eyF = eyF * eyF * eyF * eyF * eyF;
        vec3 eyIrr = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(diffuseColor.rgb, vec3(0.12));
        outgoingLight += eyF * eyIrr * uEyeRim * vec3(0.80, 0.92, 1.0);
      }
      #include <opaque_fragment>`);
  };
  L.eyeRim = eyeRim;
  L.stalkK = meta.mouth ? 0.6 : 1;
  L.ocK = meta.mouth ? 0.1 : 1;
  const stalks = new THREE.InstancedMesh(g.eyestalk, stalkMat, 2);
  stalks.frustumCulled = false;
  stalks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.add(stalks);
  P.stalks = stalks;
  L.stalkMat = stalkMat;
  const piv = meta.eyestalk || [0.155, -0.075, 0.905];
  L.eyeSt = [-1, 1].map(sd => ({ sd, piv: V3(piv[0] * sd, piv[1], piv[2]), cur: V3(sd * 0.9, 0.1, -0.4).normalize(), from: V3(), to: V3(), t: 1, dur: 0.1, hold: 0.3, want: V3(0, 0, 1), err: 0, n: 0 }));
  L.stalkL = meta.stalkL || 0.12;
}

// Stalked eyes (called from poseAll, body-local). Asleep they lie folded along the brow
// in their orbits; waking they rise; awake they FIXATE on the diver and move in saccades:
// hold still while the error is small, then snap to the new target in a short eased jump
// whose duration grows with its amplitude (the main-sequence of real eyes), with a small
// undershoot corrected by a follow-up. No target (calmed, far, asleep): they scan.
const _et = V3(), _ew = V3(), _eq = new THREE.Quaternion();
function poseEyes(L, dt, player) {
  const E = L.eyeSt;
  if (!E) return;
  const up = win(L.stand, 0.18, 0.55);                       // they come up early in the wake
  // blind in the silt she SEARCHES: quick, wide saccades round the spot she lost him
  const search = player && !L.dormant && !L.calmed && !L.seen;
  const track = player && !L.dormant && !L.calmed && L.seen && L._pd < 70;
  if (track || search) { _et.copy(L.aim); _et.y += 1.2; _et.applyMatrix4(_inv); }
  for (const e of E) {
    // what this eye wants
    if (track) e.want.copy(_et).sub(e.piv).normalize();
    else if (search) {
      if ((e.scanT = (e.scanT || 0) - dt) <= 0) {
        e.scanT = 0.28 + Math.random() * 0.45;
        e.want.copy(_et).sub(e.piv).normalize();
        e.want.x += (Math.random() - 0.5) * 1.3; e.want.y += (Math.random() - 0.4) * 0.6;
        e.want.normalize();
      }
    }
    else if ((e.scanT = (e.scanT || 0) - dt) <= 0) {
      e.scanT = 1.2 + Math.random() * 2.5;
      e.want.set(e.sd * (0.2 + 0.6 * Math.random()), -0.1 + 0.4 * Math.random(), 0.6 + 0.4 * Math.random()).normalize();
    }
    // the stalk's reach: forward half-space, a little past the midline
    if (e.want.z < 0.05) { e.want.z = 0.05; e.want.normalize(); }
    if (e.want.x * e.sd < -0.35) { e.want.x = -0.35 * e.sd; e.want.normalize(); }
    const err = Math.acos(clamp(e.cur.dot(e.want), -1, 1));
    e.err = err;
    if (e.t < 1) {
      e.t = Math.min(1, e.t + dt / e.dur);
      const k = 1 - Math.pow(1 - e.t, 3);                     // fast out, soft landing
      e.cur.copy(e.from).lerp(e.to, k).normalize();
    } else {
      e.hold -= dt;
      const thr = track ? 0.05 : 0.02;
      if ((err > thr && e.hold <= 0) || err > 0.5) {
        e.from.copy(e.cur);
        // land 90% of the way on big jumps (the follow-up corrects it), exactly on small
        const land = err > 0.2 ? 0.9 : 1;
        e.to.copy(e.cur).lerp(e.want, land).normalize();
        e.dur = (0.05 + 0.12 * Math.min(1, err / 1.2)) * (1.4 - 0.4 * L.standE);
        e.t = 0; e.n++;
        e.hold = err > 0.2 ? 0.06 : 0.25 + Math.random() * (track ? 0.6 : 1.2);
      } else if (track) {
        // fixational tremor: the tiniest drift while it holds
        e.cur.x += 0.0015 * Math.sin(L.t * 23 + e.sd); e.cur.y += 0.0015 * Math.sin(L.t * 19 + 2 * e.sd); e.cur.normalize();
      }
    }
    // folded: lying back along the brow groove
    _ew.set(e.sd * 0.96, 0.05, -0.28).normalize().lerp(e.cur, up).normalize();
    _eq.setFromUnitVectors(_eyeZ, _ew);
    L.parts.stalks.setMatrixAt(e.sd < 0 ? 0 : 1, _m.compose(e.piv, _eq, _sc.set(1, 1, 1)));
  }
  L.parts.stalks.instanceMatrix.needsUpdate = true;
}

// She wakes: the name, the rise, the silt pouring off her back for as long as it takes.
function wakeBrooder(L) {
  L.dormant = false;
  L.standTarget = 1;
  L.woke = true;
  L.riseDust = RISE_T;
}

// Teleport: body to pos (on the ground), heading yaw, feet reset to their rest spots.
function placeAt(L, pos, yaw) {
  L.pos.set(pos.x, 0, pos.z);
  L.yaw = yaw;
  L.vel.set(0, 0, 0);
  buildNear(L, L.R * 2.6);
  for (let li = 0; li < 8; li++) {
    const f = L.feet[li];
    restWorld(L, li, f.planted);
    f.cur.copy(f.planted); f.t = -1;
  }
}

// A step target the leg can actually stand on: out of any hull, grounded on the floor or
// a rock top, and pulled in toward the hip until the leg reaches it (an out-of-reach foot
// used to slide: the IK kept the leg whole and the foot hung in the water above the floor).
const _hw = V3();
function reachFoot(L, li, out) {
  const lg = LEGS[li & 3], sd = li < 4 ? 1 : -1, k = lg.k, R = L.R;
  _hw.set(lg.hip[0] * sd, lg.hip[1], lg.hip[2]).applyMatrix4(L.body.matrixWorld);
  const maxR = (SEG.coxa + (SEG.femur + SEG.tibia) * k * 0.97 + SEG.dactyl * k * 0.5) * R * 0.95;
  for (let it = 0; it < 3; it++) {
    placeFoot(L, out);
    const dx = out.x - _hw.x, dz = out.z - _hw.z, dy = out.y - _hw.y, hz = Math.hypot(dx, dz);
    if (Math.hypot(hz, dy) <= maxR || hz < 1e-3) break;
    const hmax = Math.sqrt(Math.max(0.04 * maxR * maxR, maxR * maxR - dy * dy));
    const sc = Math.max(0.3, hmax / hz);
    out.x = _hw.x + dx * sc; out.z = _hw.z + dz * sc;
  }
  return out;
}

// floor gradient magnitude (rise per unit run) at x, z
function slopeAt(L, x, z) {
  const gx = terrainH(x + 1, z, L.idx) - terrainH(x - 1, z, L.idx), gz = terrainH(x, z + 1, L.idx) - terrainH(x, z - 1, L.idx);
  return 0.5 * Math.hypot(gx, gz);
}

// Rest spot of foot li: local (yaw only) -> world, on the terrain.
function restWorld(L, li, out) {
  const lg = LEGS[li & 3], sd = li < 4 ? 1 : -1, st = L.legSt[li];      // each leg unfolds on its own beat
  // asleep the legs fold UNDER the shell: a ridge, not a crab
  const reach = lerp(0.80, 1.02, st) * lg.k - DORM.tuck * lg.k * (1 - st), a = lg.splay * lerp(1.15, 0.85, st);
  const lx = lg.hip[0] * sd + Math.cos(a) * reach * sd, lz = lg.hip[2] + Math.sin(a) * reach;
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
  out.set(L.pos.x + (lx * cy + lz * sy) * L.R, 0, L.pos.z + (-lx * sy + lz * cy) * L.R);
  out.y = groundAt(L, out.x, out.z, true);           // a rock's top is ground too
  return out;
}

// Rigid segment a->b in body-local space as an instance matrix: X along the bone, Z the
// leg-plane normal (so the flattened section faces fore-aft), Y the in-plane up.
// L0 is the geometry's rest length along X (1 for the procedural unit segments, the true
// bone length for the sculpted ones, which then stretch only by k and the IK's slack).
function segMat(im, i, a, b, pn, L0 = 1) {
  _x.subVectors(b, a);
  const len = _x.length() || 1e-4;
  _x.divideScalar(len);
  _z.copy(pn);
  _y.crossVectors(_z, _x).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _m.scale(_sc.set(len / L0, 1, 1));
  _m.setPosition(a);
  im.setMatrixAt(i, _m);
}

// Two-bone IK in the leg's vertical plane, knee UP (the crab silhouette). footL is the
// planted foot in body-local space. If the target is out of reach the tibia still
// points at the ankle and the dactyl at the foot: the foot slides, the leg never tears.
function poseLeg(L, li, footL) {
  const lg = LEGS[li & 3], sd = li < 4 ? 1 : -1, k = lg.k;
  _hip.set(lg.hip[0] * sd, lg.hip[1], lg.hip[2]);
  _d.set(footL.x - _hip.x, 0, footL.z - _hip.z);
  if (_d.lengthSq() < 1e-6) _d.set(sd, 0, 0);
  _d.normalize();
  // the knee plane: vertical standing (U is UP itself, so that path is untouched); asleep it
  // lies down toward the horizontal, the knee turned toward the middle of the flank
  let U = UP;
  const f = (1 - L.legSt[li]) * DORM.fold;
  if (f > 0) {
    _hz.crossVectors(UP, _d);
    if (_hz.z * lg.hip[2] > 0) _hz.negate();
    U = _u.copy(UP).multiplyScalar(1 - f).addScaledVector(_hz, f).normalize();
  }
  _pn.crossVectors(_d, U).normalize();
  _j1.copy(_hip).addScaledVector(_d, SEG.coxa * 0.98).addScaledVector(UP, -SEG.coxa * 0.2);
  _ank.copy(footL).addScaledVector(U, SEG.dactyl * k * 0.93).addScaledVector(_d, -SEG.dactyl * k * 0.36);
  const l1 = SEG.femur * k, l2 = SEG.tibia * k;
  _v.subVectors(_ank, _j1);
  const qx = _v.x * _d.x + _v.z * _d.z, qy = U === UP ? _v.y : _v.dot(U);
  const D = clamp(Math.hypot(qx, qy), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const base = Math.atan2(qy, qx);
  const th1 = base + Math.acos(clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1));
  _knee.copy(_j1).addScaledVector(_d, Math.cos(th1) * l1).addScaledVector(U, Math.sin(th1) * l1);
  const S0 = L.segL0;
  segMat(L.legs.coxa, li, _hip, _j1, _pn, S0.coxa);
  segMat(L.legs.femur, li, _j1, _knee, _pn, S0.femur);
  _ank2.copy(_knee).addScaledVector(_v.subVectors(_ank, _knee).normalize(), l2);
  segMat(L.legs.tibia, li, _knee, _ank2, _pn, S0.tibia);
  _ft.copy(_ank2).addScaledVector(_v.subVectors(footL, _ank2).normalize(), SEG.dactyl * k);
  segMat(L.legs.dactyl, li, _ank2, _ft, _pn, S0.dactyl);
}

// Arm pose, after the reference: a forward guard — upper arms reaching ahead under the
// prow, forearms turned in, the hooked pincers hanging open-mouthed before her face.
// Threat lifts both hands to the height of her brow and gapes them wide.
function poseClaws(L) {
  const th = L.threatE, t = L.t, st = L.clawSt, h = L.hurt.x;
  // the hammer's anticipation: cocked high and back, holding with a tremble, then the fall
  const ck = L.cock * th, hold = ck > 0.98 ? 1 : 0;
  const trem = hold * 0.022 * Math.sin(t * 71) * Math.sin(t * 13.3);
  for (const c of L.claws) {
    const sd = c.sd;
    // never quite still: slow drift in two axes (noise, not a metronome), a heavier and
    // slower sway on the crusher, and a slow open/close of the pincers
    const kM = c.major ? 0.7 : 1.25;
    // secondary motion: the heavy claws lag the shell's bob and pitch (they rise as it
    // drops onto a footfall, dip as it rears), the crusher more than the cutter
    const lagK = c.major ? 1.3 : 0.8;
    const lag = (0.6 * L.bP.x - 0.3 * L.bY.v / L.R) * lagK * st;
    const dz = (0.035 * nz(t * 0.37 * kM, sd * 3) + 0.012 * nz(t * 1.9 * kM, sd * 7)) * st + lag;
    const dy = 0.03 * nz(t * 0.29 * kM, sd * 5 + 1) * st;
    const gape = (0.5 + 0.5 * nz(t * 0.23 * kM, sd * 11)) * st;
    const snap = Math.pow(Math.max(0, Math.sin(t * 0.7 + sd * 1.3)), 8) * 0.12 * st;
    if (c.major) {
      // the strike: the great claw comes up to head height and gapes; then it COCKS -
      // up and back, the pincer wide - holds trembling, and comes DOWN across her front
      const sw = L.swing * th;
      c.root.rotation.set(0, -Math.PI / 2 + sd * lerp(0.22, 0.45, th) - sd * 0.25 * sw + sd * 0.30 * ck + dy - sd * 0.2 * h,
        lerp(-0.34 - 0.25 * (1 - st), 0.40, th) - 0.85 * sw + 0.55 * ck + dz + trem + 0.25 * h);
      c.cj.rotation.set(0, -sd * lerp(0.95, 0.40, th), 0.30 - 0.25 * sw + 0.25 * ck);
      c.pj.rotation.set(0, -sd * lerp(0.45, 0.15, th), lerp(-0.55, -0.30, th) + 0.2 * sw - 0.25 * ck + 0.6 * dz);
      c.dj.rotation.z = (0.08 + 0.20 * gape + snap + 1.00 * th * (1 - 0.9 * sw) + 0.35 * ck) * (1 - 0.8 * Math.min(1, Math.max(0, h)));
    } else {
      // the minor stays low and close, a guard across the mouth, working; it spreads
      // wide as the crusher cocks (the body opens up behind the blow)
      // (brooderfix) a diver close under her face: the guard comes UP off her mouth, raised to
      // strike (L.guardUp). Solid now, held low across the mouth it walled off the one way in
      // under her front, the plume rush (measured: 0 of 3 rushes got under her, 3 of 3 on main)
      c.root.rotation.set(0, -Math.PI / 2 + sd * lerp(0.22, 0.12, th) + sd * 0.28 * ck + dy - sd * 0.2 * h,
        lerp(-0.30 - 0.25 * (1 - st), -0.25, th) + 0.18 * ck + dz + 0.25 * h + HUNT.guardUp * (L.guardUp ? L.guardUp.x : 0));
      c.cj.rotation.set(0, -sd * lerp(0.95, 1.20, th) + sd * 0.3 * ck, 0.30);
      c.pj.rotation.set(0, -sd * 0.45, -0.55 + 0.6 * dz);
      c.dj.rotation.z = (0.08 + 0.28 * gape + snap + 0.35 * th + 0.25 * Math.max(0, Math.sin(t * 3.1)) * th + 0.3 * ck) * (1 - 0.8 * Math.min(1, Math.max(0, h)));
    }
    // asleep: folded back flat under the prow, pincers shut
    const d = 1 - st;
    if (d > 0) {
      const T = c.major ? DORM.major : DORM.minor;
      tuckJoint(c.root, T.root, -Math.PI / 2, sd, d); tuckJoint(c.cj, T.cj, 0, sd, d); tuckJoint(c.pj, T.pj, 0, sd, d);
      c.dj.rotation.z += (T.dj - c.dj.rotation.z) * d;
    }
  }
}
// x + (target - x) * d: at d = 0 nothing moves. y is mirrored by side (-sd turns inward)
// about the joint's own base heading (the root's is -PI/2: the arm aims forward).
function tuckJoint(j, T, base, sd, d) {
  const r = j.rotation;
  r.set(r.x + (T[0] - r.x) * d, r.y + (base - sd * T[1] - r.y) * d, r.z + (T[2] - r.z) * d);
}

// THE GROUND UNDER HER (brooder-ground-plume). The shell's SOLE (lowest vertex per cell of
// an 11x11 plan grid, plus the outermost low vertex on 48 bearings) may never go under the
// ground (floor or rock top) once she is up: standing she keeps 0.35 u of clearance. Asleep
// she is bedded (the ridge); the floor comes on through the heave, so rising lifts her out.
// The support estimate below is unchanged in spirit; this is a hard floor applied after it.
const SOLE_CLR = 0.35, SOLE_BED_DEEP = 0.6, CLAW_M = 0.12;
// the folded dactyl lies flat on its thick base: lift its tip by its own radius
const FOOT_LIFT0 = 0.019, FOOT_LIFTF = 0.05;
// (pieces whose samples all stand > 4 u clear at the unclamped pose sit out the search)
function clawPen(L, c, all) {
  let w = -1e9;
  for (const s of c.samp) {
    if (!all && s.clear) continue;
    const p = penetration(L, s.pts, s.mesh.matrixWorld, CLAW_M);
    if (all) s.clear = p < -4;
    if (p > w) w = p;
  }
  return w;
}
// The claw's floor: if any hull sample is under the ground, find (bisection) the smallest
// lift that clears it: first at the SHOULDER (up to 0.45 rad: more swings the merus root,
// buried under her lip, down out of her belly), then the rest at the ELBOW (its sign found
// by trial: the joint's frame is turned inward). A blow that ARRIVES at the surface kicks
// back (a spring on the shoulder lift, underdamped): it slams onto the sand and rebounds,
// never through.
const ROOT_MAX = 0.45, ELBOW_MAX = 1.3, LIFT_RES = 0.01;
// Smallest lift in [0, max] (joint j, sign sg) that clears the floor, to LIFT_RES. Frame
// coherent: last frame's answer brackets the search, so a held contact costs ~3-5 probes
// instead of a full bisection (each probe is ~0.02 ms: a joint-chain matrix update and
// ~50 hull samples against the ground).
let _uL = null, _uC = null, _uR = null, _uZ0 = 0, _uSg = 1;     // the probe's target (no closure per call)
function under(a) { _uR.z = _uZ0 + _uSg * a; _uC.root.updateMatrixWorld(true); return clawPen(_uL, _uC, false) > 0; }
function liftAt(L, c, j, max, sg, prev) {
  const r = j.rotation, z0 = r.z;
  _uL = L; _uC = c; _uR = r; _uZ0 = z0; _uSg = sg;
  let lo = 0, hi = max;
  if (prev > 0 && prev < max) {
    if (under(prev)) lo = prev;
    else { hi = prev; const p2 = prev - 0.05; if (p2 > 0) { if (under(p2)) lo = p2; else hi = p2; } }
  }
  if (hi === max && under(max)) return max;
  while (hi - lo > LIFT_RES) { const mid = (lo + hi) * 0.5; if (under(mid)) lo = mid; else hi = mid; }
  r.z = z0 + sg * hi; c.root.updateMatrixWorld(true);
  return hi;
}
function clampClaw(L, c, dt) {
  const z0 = c.root.rotation.z, e0 = c.cj.rotation.z;
  c.root.updateMatrixWorld(true);
  let need = 0, el = 0;
  if (clawPen(L, c, true) > 0) {
    need = liftAt(L, c, c.root, ROOT_MAX, 1, c.need || 0);
    if (need >= ROOT_MAX && clawPen(L, c, false) > 0) {
      // the elbow's lifting sign, found by trial now and then (its frame is turned inward)
      if (!c.elSg || (c.elSgT = (c.elSgT || 0) - dt) <= 0) {
        const r = c.cj.rotation;
        r.z = e0 + 0.25; c.root.updateMatrixWorld(true); const pp = clawPen(L, c, false);
        r.z = e0 - 0.25; c.root.updateMatrixWorld(true); const pm = clawPen(L, c, false);
        r.z = e0; c.elSg = pp <= pm ? 1 : -1; c.elSgT = 0.5;
      }
      el = c.elSg * liftAt(L, c, c.cj, ELBOW_MAX, c.elSg, Math.abs(c.elbow || 0));
      // still under with both joints spent (the floor rises in front of her): what is left
      // goes to her FRONT, which she lifts (L.frontUp, next frame), as a crab facing a bank does
      if (Math.abs(el) >= ELBOW_MAX) { const res = clawPen(L, c, false); if (res > L.clawRes) L.clawRes = res; }
    }
  }
  if (dt > 0) {
    if (c.major && need > 0.03 && c.need0 <= 0.03 && L.swing > 0.4) c.lift.v += 2.6 * Math.max(0.3, L.threatE);
    spr(c.lift, need, 15, 0.28, dt);
  } else { c.lift.x = need; c.lift.v = 0; }
  c.need0 = need;
  const lift = Math.max(need, Math.min(c.lift.x, ROOT_MAX + 0.25));
  c.root.rotation.z = z0 + lift;
  c.cj.rotation.z = e0 + el;
  c.root.updateMatrixWorld(true);
  c.need = need; c.liftNow = lift; c.elbow = el;
}

function poseAll(L, dt, player) {
  buildNear(L, L.R * 2.6);
  const b = L.body, R = L.R, st = L.standE, hv = L.heave.x, hc = clamp(hv, 0, 1), h = L.hurt.x, ck = L.cock * L.threatE;
  // body on the ground. ASLEEP she is the ridge Michael approved: bedded in the silt on
  // the old five-sample estimate (her flank and prow deep in the dune, the drift banked
  // against her), and the sole floor below does not apply. As she HEAVES up the estimate
  // moves to a least-squares plane through the ground (floor or rock tops) over her whole
  // footprint, 5 x 5 (brooder-ground-plume: the five samples at +-0.7 R read the rift-rim
  // crest behind her as a slope and drove her prow into the floor)...
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), o = 0.7 * R;
  const gF = terrainH(L.pos.x + sy * o, L.pos.z + cy * o, L.idx), gB = terrainH(L.pos.x - sy * o, L.pos.z - cy * o, L.idx);
  const gL = terrainH(L.pos.x + cy * o, L.pos.z - sy * o, L.idx), gR = terrainH(L.pos.x - cy * o, L.pos.z + sy * o, L.idx);
  const gC = terrainH(L.pos.x, L.pos.z, L.idx);
  let sh = 0, sx = 0, sz = 0, sxh = 0, szh = 0, sxx = 0, szz = 0, nG = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const lx = (-0.8 + 0.4 * i) * R, lz = (-0.84 + 0.425 * j) * R;
    const hg = groundAt(L, L.pos.x + lx * cy + lz * sy, L.pos.z - lx * sy + lz * cy, true);
    sh += hg; sx += lx; sz += lz; sxh += lx * hg; szh += lz * hg; sxx += lx * lx; szz += lz * lz; nG++;
  }
  // a rectangular grid: x and z are uncorrelated, so the two slopes solve independently
  const mh = sh / nG, mx = sx / nG, mz = sz / nG;
  const bx = (sxh / nG - mx * mh) / (sxx / nG - mx * mx), bz = (szh / nG - mz * mh) / (szz / nG - mz * mz);
  let gy = lerp((gF + gB + gL + gR + gC) / 5, mh - bx * mx - bz * mz, hc);
  let pit = lerp(-Math.atan2(gF - gB, 2 * o), -Math.atan(bz), hc), rol = lerp(Math.atan2(gL - gR, 2 * o), Math.atan(bx), hc);
  // ...and standing, she rides her PLANTED FEET instead: height off their mean, pitch and
  // roll off the plane they make (a foot in the air carries no weight)
  if (hc > 0) {
    let fy = 0, ff = 0, fb = 0, fl = 0, fr = 0;
    for (let li = 0; li < 8; li++) {
      const y = L.feet[li].planted.y, k = li & 3;
      fy += y; if (k < 2) ff += y; else fb += y;
      if (li < 4) fl += y; else fr += y;
    }
    const span = 1.3 * R;
    gy = lerp(gy, fy / 8, hc);
    pit = lerp(pit, -Math.atan2((ff - fb) / 4, span * 0.55), hc);
    rol = lerp(rol, Math.atan2((fl - fr) / 4, span * 1.6), hc);
  }
  // the support estimate changes in jumps (a foot lands on higher ground): the shell
  // takes it up through a critically damped follower, never a snap
  if (!(dt > 0) || !L.gG) { L.gG = { x: gy, v: 0 }; L.gP = { x: pit, v: 0 }; L.gRl = { x: rol, v: 0 }; }
  else { gy = spr(L.gG, gy, 4.5, 1, dt); pit = spr(L.gP, pit, 4.5, 1, dt); rol = spr(L.gRl, rol, 4.5, 1, dt); }
  const breath = (0.012 * Math.sin(L.t * 0.45) + 0.004 * Math.sin(L.t * 1.07 + 1)) * (1 - hc);
  L.bodyY = gy + R * (lerp(0.06, 0.44, hv) + 0.10 * L.threatE + breath - DORM.drop * (1 - hv) + 0.06 * ck + 0.05 * h) + L.bY.x;
  b.position.set(L.pos.x + L.offX.x, L.bodyY, L.pos.z + L.offZ.x);
  // hunched: standing, the front drops over the diver; threat lifts it to show the face.
  // Cocking the hammer she rears (front up); a flinch throws her back; she lists a little
  // toward the crusher (+X), its weight
  b.rotation.set(pit + 0.06 * hc + 0.12 * L.threatE - 0.10 * ck - 0.14 * h - (L.lookP || 0) - (L.frontUp || 0) + L.bP.x, L.yaw, rol - 0.025 * hc + L.bR.x);
  // the sole stays on the ground (L.grp sits at the origin, so body.matrix IS its world)
  b.updateMatrix();
  // (asleep the floor is off; it comes on through the heave, so the rise lifts her OUT)
  const bed = lerp(SOLE_BED_DEEP * R, -SOLE_CLR, smooth(hc, 0, 0.7));
  const pen = hc > 0.001 ? penetration(L, L.sole, b.matrix, -bed) : 0;
  L.soleLift = pen > 0 ? pen : 0;
  if (pen > 0) { b.position.y += pen; L.bodyY += pen; }
  b.updateMatrixWorld(true);
  _inv.copy(b.matrixWorld).invert();

  for (let li = 0; li < 8; li++) {
    _lp.copy(L.feet[li].cur);
    // (+ on a steep bank the dactyl's shaft meets the uphill side before its tip: measured
    // pen ~0.5 x slope; lifted by the slope found when the foot was planted)
    _lp.y += R * (FOOT_LIFT0 + FOOT_LIFTF * (1 - L.legSt[li])) + 0.45 * Math.max(0, (L.feet[li].sl || 0) - 0.3) * L.legSt[li];
    poseLeg(L, li, _lp.applyMatrix4(_inv));
  }
  for (const k in L.legs) L.legs[k].instanceMatrix.needsUpdate = true;
  poseClaws(L);
  L.clawRes = 0;
  if (L.clawSt > 0.02) for (const c of L.claws) clampClaw(L, c, dt);
  // the front lifts by what the arms could not (lever ~ the crusher's length), and sinks
  // back slowly when they can again
  if (dt > 0) L.frontUp = clamp((L.frontUp || 0) + (L.clawRes > 0 ? Math.min(L.clawRes / (1.6 * R), 0.8 * dt) : -0.15 * dt), 0, 0.35);   // folded asleep they lie bedded with the shell
  else for (const c of L.claws) { c.liftNow = c.need = 0; c.lift.x = c.lift.v = 0; }
  poseEyes(L, dt, player);

  // EYESHINE: the eyes are dark until the diver's lantern finds them, then they throw it
  // back — pale green-white pinpoints, the one moment you see her looking at you.
  let shine = 0;
  if (player) {
    _v.copy(player.pos).sub(L.head);
    const dist = _v.length() || 1;
    b.getWorldDirection(_x);                                   // body +Z in world
    const facing = Math.max(0, _x.dot(_v) / dist);
    shine = Math.pow(facing, 3) * (1 - smooth(dist, 25, 90)) * Math.max(0, player.light == null ? 1 : player.light);
  }
  L.eyeMat.emissiveIntensity = (0.08 * st + 2.2 * shine * (0.35 + 0.65 * st)) * (L.ocK ?? 1);
  if (L.stalkMat) {
    // the stalked eyes throw it back by where THEY point, not the body
    let s2 = 0;
    if (player && L.eyeSt) {
      const e = L.eyeSt[0];
      _x.copy(e.cur).transformDirection(b.matrixWorld);
      _v.copy(player.pos).sub(L.head);
      const dist = _v.length() || 1;
      s2 = Math.pow(Math.max(0, _x.dot(_v) / dist), 4) * (1 - smooth(dist, 25, 90)) * Math.max(0, player.light == null ? 1 : player.light);
    }
    L.stalkMat.emissiveIntensity = (0.05 * st + 2.6 * s2 * (0.35 + 0.65 * st)) * (L.stalkK ?? 1);
  }
  // the mouthparts: five pairs working out of phase, faster when roused
  // (a sawtooth-ish stroke: a quick pull in, a slower open; the rhythm stutters and
  // pauses on a slow noise, and the outer pairs sweep wider)
  const mAct = (0.3 + 0.7 * st) * (0.55 + 0.45 * Math.max(0, nz(L.t * 0.31, 17)) + 0.5 * L.agitation);
  for (const m of L.mouth) {
    const w = L.mPh + m.k * 2.1 + (m.sd > 0 ? 0 : Math.PI);
    const stroke = Math.sin(w) + 0.32 * Math.sin(2 * w + 0.6);
    m.hinge.rotation.set(0.05 * m.sd * Math.sin(w * 0.5 + m.k), -Math.PI / 2 - m.sd * (0.35 + 0.04 * m.k * Math.sin(w)), -0.9 + 0.20 * stroke * mAct);
  }

  // wards, collision centres, head
  for (const g of L.sigils) {
    g.grp.position.copy(g.local).applyMatrix4(b.matrixWorld);
    b.getWorldQuaternion(_q);
    g.grp.quaternion.copy(_q).multiply(g.q);
  }
  for (let k = 0; k < COLL.length; k++) L.spine[k].set(COLL[k][0], COLL[k][1], COLL[k][2]).applyMatrix4(b.matrixWorld);
  L.head.set(0, 0.10, 0.80).applyMatrix4(b.matrixWorld);
  publishCols(L);
}

// HER BODY IS SOLID (brooderfix): the live pose as collision volumes (bodyCols.js) — every
// leg segment and claw piece a tapered capsule carried by its own matrix, and the shell's
// height-band proxy carried by the body's. game.js pushes Sal out of them right after this
// frame's update and walks the camera's boom against them.
const LEG_KEYS = ['coxa', 'femur', 'tibia', 'dactyl'];
// (the dactyl curls to its point: two capsules follow it; one chord left 0.7 u of claw outside)
const LEG_N = { coxa: 1, femur: 1, tibia: 1, dactyl: 2 };
function fitLegs(legs) { const o = {}; for (const k of LEG_KEYS) o[k] = fitCapsules(legs[k].geometry, LEG_N[k]); return o; }
const _cm = new THREE.Matrix4(), _ca = V3(), _cb = V3();
function publishCols(L) {
  if (!L.legFit || L.gone) return;
  beginBodyCols();
  const bw = L.body.matrixWorld, R = L.R;
  for (let q = 0; q < 4; q++) {
    const k = LEG_KEYS[q], im = L.legs[k], FF = L.legFit[k];
    for (let i = 0; i < 8; i++) {
      im.getMatrixAt(i, _cm); _cm.premultiply(bw);
      for (let j = 0; j < FF.length; j++) {
        const F = FF[j];
        _ca.fromArray(F.a).applyMatrix4(_cm); _cb.fromArray(F.b).applyMatrix4(_cm);
        addCapsule(_ca.x, _ca.y, _ca.z, _cb.x, _cb.y, _cb.z, F.ra * R, F.rb * R);
      }
    }
  }
  markLimbs();                                       // (the probe's leg/claw boundary)
  for (let ci = 0; ci < L.claws.length; ci++) {
    const fit = L.claws[ci].fit;
    for (let j = 0; j < fit.length; j++) {
      const mw = fit[j].mesh.matrixWorld, e = mw.elements, F = fit[j].f;
      const sc = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);     // its radial scale (R x the arm's k)
      _ca.fromArray(F.a).applyMatrix4(mw); _cb.fromArray(F.b).applyMatrix4(mw);
      addCapsule(_ca.x, _ca.y, _ca.z, _cb.x, _cb.y, _cb.z, F.ra * sc, F.rb * sc);
    }
  }
  setShell(L.shellProx, bw.elements, R);
  endBodyCols(L.pos.x, L.bodyY, L.pos.z, 2.9 * R);
}

function resetEv() {
  EV.sigilLit = 0; EV.calmed = false; EV.lightDrain = 0; EV.slam = false; EV.remaining = 0; EV.msg = null; EV.woke = false; EV.quake = 0; EV.plume = 0;
  return EV;
}
// a ground shock at world x,z of strength k (0..1): the game's camera shake, by distance
function quake(L, ev, x, z, k, player) {
  const d = Math.hypot(player.pos.x - x, player.pos.z - z);
  const q = k * (1 - smooth(d, 8, 70));
  if (q > ev.quake) ev.quake = q;
}
// Silt on HER scale: the shared puff pool (footfx, 420 particles, also the diver's boots)
// spawns every burst within ~0.3 u, so a colossus's impact is a ring of k small bursts
// spread over radius r, big particles, few of them (a budget, not a firehose).
function silt(x, y, z, k, n, str, r) {
  for (let i = 0; i < k; i++) {
    const a = (i + Math.random() * 0.6) / k * Math.PI * 2, rr = r * (0.4 + 0.6 * Math.random());
    emitDust(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, n, str);
  }
}
const LEG_DELAY = new Float32Array(8);
WAKE_ORDER.forEach((li, o) => { LEG_DELAY[li] = 0.08 + o * 0.055; });
const _busy = new Int8Array(2);

// ---- SIGHT (brooder-ground-plume) ------------------------------------------------------
// She sees Sal along the line from her head to his chest. The sand plume (plume.js) has an
// optical depth on that line; past SIGHT_LOSE she loses him: her face and her blows stay on
// the spot she last saw him, the stalk stops, her eyes search in quick wide saccades. She
// finds him again when the line has been clear (below SIGHT_FIND) for SIGHT_REACQ s, when he
// bumps her shell, or when a ward is lit (a wound tells her where he is). After
// SIGHT_GIVEUP s blind she stops striking the empty spot and sweeps the cloud with her front.
export const SIGHT = { lose: 1.0, find: 0.55, reacq: 0.6, giveUp: 7 };
let SIGHT_LOSE = SIGHT.lose, SIGHT_FIND = SIGHT.find, SIGHT_REACQ = SIGHT.reacq, SIGHT_GIVEUP = SIGHT.giveUp;
const PLUME_MSG = 'SAND HANGS IN THE WATER. SHE CANNOT SEE YOU.';
let plumeHinted = false;
function sight(L, dt, player, ev) {
  SIGHT_LOSE = SIGHT.lose; SIGHT_FIND = SIGHT.find; SIGHT_REACQ = SIGHT.reacq; SIGHT_GIVEUP = SIGHT.giveUp;
  const awake = !L.dormant && !L.calmed;
  const px = player.pos.x, py = player.pos.y + 1.0, pz = player.pos.z;
  L.tau = awake && L.standE > 0.3 ? plumeTau(L.head.x, L.head.y, L.head.z, px, py, pz) : 0;
  if (!awake || L.hold) { L.seen = true; L.blindT = 0; L.clearT = 0; }
  else if (L.seen) {
    if (L.tau > SIGHT_LOSE && L.standE > 0.5) {
      L.seen = false; L.blindT = 0; L.clearT = 0; L.searchYaw = L.yaw; L.lostN = (L.lostN || 0) + 1;
      if (!plumeHinted && L._pd < 90) { plumeHinted = true; L.pendingMsg = L.pendingMsg || PLUME_MSG; }
    }
  } else {
    L.blindT += dt;
    L.clearT = L.tau < SIGHT_FIND ? L.clearT + dt : 0;
    if (L.clearT > SIGHT_REACQ || L._pd < L.collR * 1.05 || L.touchT > 0) { L.seen = true; L.blindT = 0; }
  }
  if (L.seen) L.lastSeen.copy(player.pos);
  L.aim.copy(L.lastSeen);
  let d = 1e9;
  for (const s of L.spine) { const q = s.distanceTo(L.aim); if (q < d) d = q; }
  L._pdT = d;
}

export function updateBrooder(L, dt, t, player) {
  const ev = resetEv();
  if (L.pendingMsg) { ev.msg = L.pendingMsg; L.pendingMsg = null; }
  if (L.woke) { L.woke = false; ev.woke = true; L.bY.v -= L.R * 0.25; }    // the first jolt: she tenses into the silt
  if (L.brood) {
    L.brood.update(dt, player, ev);
    if (L.dormant && !ev.msg && !L.brood.found.ridge && L._pd < L.R * 1.3) { L.brood.found.ridge = true; ev.msg = 'THE RIDGE IS WARM UNDER YOUR HAND.'; }
  }
  if (!L.pPrev) L.pPrev = player.pos.clone();
  sight(L, dt, player, ev);
  L.t += dt;
  L.uni.uTime.value = L.t;
  const R = L.R;
  // the mouthparts' own clock: rate varies without phase jumps
  L.mPh = L.mPh + dt * (3.0 + 3.2 * L.agitation) * (0.8 + 0.3 * nz(L.t * 0.2, 23));

  // ---- stand / threat easing: she takes ~6 s to rise and ~4 s to settle ----
  const rising = L.standTarget > L.stand;
  L.rising = rising && !L.calmed;                     // (game.js: limbs unfolding past him are a shove, not a slam)
  const rate = rising ? 1 / RISE_T : 1 / SETTLE_T;
  L.stand += clamp(L.standTarget - L.stand, -rate * dt, rate * dt);
  L.standE = smooth(L.stand, 0, 1);
  // THE WAKE, as a sequence on the rise clock: legs unfold one at a time (a crab's
  // alternating order), she sinks into them, then HEAVES (an underdamped spring: she
  // overshoots and settles), and the claws come out last. Settling runs it backwards.
  const u = L.stand;
  for (let li = 0; li < 8; li++) {
    const was = L.legSt[li];
    L.legSt[li] = win(u, LEG_DELAY[li], LEG_DELAY[li] + 0.30);
    // a leg dragging itself out of the silt throws a puff at the foot
    if (rising && was < 0.12 && L.legSt[li] >= 0.12) { const f = L.feet[li].cur; silt(f.x, f.y + 0.3, f.z, 3, 3, 2.6, 1.2); }
  }
  L.clawSt = win(u, 0.55, 0.95);
  const heaveT = win(u, 0.45, 0.88) - (rising ? 0.12 * Math.sin(Math.PI * win(u, 0.22, 0.50)) : 0);
  const hv0 = L.heave.x;
  spr(L.heave, heaveT, 2.6, rising ? 0.42 : 0.55, dt);
  // settling, the shell lands: the moment the fall stops it thumps the floor
  if (!rising && hv0 > 0.02 && L.heave.x <= 0.02 && L.heave.v < -0.05) { quake(L, ev, L.pos.x, L.pos.z, 0.5, player); silt(L.pos.x, L.bodyY - R * 0.1, L.pos.z, 8, 3, 3.4, R * 0.9); }
  // the shudder as she wakes: the whole shell trembles while the silt pours
  const shud = rising ? Math.sin(Math.PI * win(u, 0.0, 0.40)) : 0;
  if (shud > 0.05) {
    L.bR.v += nz(L.t * 9, 1) * 0.9 * shud * dt * 60 * 0.02;
    L.bP.v += nz(L.t * 8, 2) * 0.6 * shud * dt * 60 * 0.02;
    if (!ev.quake) quake(L, ev, L.pos.x, L.pos.z, 0.12 * shud, player);
  }
  // silt pours off her back as she rises: from the rim, faster while the shell is moving
  if (!L.dormant && u < 1 && rising) {
    L.dustT = (L.dustT || 0) - dt * (1 + 6 * Math.abs(L.heave.v) + 2 * shud);
    if (L.dustT <= 0) {
      L.dustT = 0.09;
      const a = Math.random() * Math.PI * 2, r = R * (0.75 + 0.3 * Math.random());
      const x = L.pos.x + Math.cos(a) * r, z = L.pos.z + Math.sin(a) * r;
      emitDust(x, L.bodyY + R * 0.05 * Math.random(), z, 6, 3.4);
    }
  }
  // the drift sinks away as she rises out of it, and is gone once she has stood
  if (L.skirt && L.skirt.visible) {
    L.skirt.position.y = -L.standE * L.R * 0.3;
    if (!L.dormant && L.standE > 0.97) L.skirt.visible = false;
  }
  // she rears on her own when the diver comes close (the lab's hold/rear override it)
  // blind, she keeps striking where she last saw him, until she gives the spot up
  if (!L.hold && !L.calmed && !L.dormant) L.threatTarget = L.standE > 0.9 && L._pdT < L.R * L.threatR && L.blindT < SIGHT_GIVEUP ? 1 : 0;
  // a fresh threat starts the hammer at the top of its guard, so the first blow is
  // always preceded by the full wind-up
  if (L.threatTarget > 0.5 && L.threat < 0.02) L.swingT = 0;
  L.threat += clamp(L.threatTarget - L.threat, -1.5 * dt, 1.5 * dt);
  L.threatE = smooth(L.threat, 0, 1) * L.standE;
  // THE HAMMER (2.6 s, as before; the blow lands at the same point of the cycle):
  // guard -> COCK (up and back, the body rears) -> HOLD (trembling) -> the FALL (accelerating)
  // -> impact -> a recoil that bounces and settles
  L.swingT = (L.swingT || 0) + dt;
  {
    const ph = (L.swingT % L.hammerT) / L.hammerT, prev = L.hamPh;
    L.hamPh = ph;
    L.cock = ph < PH_COCK0 ? 0 : ph < PH_COCK1 ? ease((ph - PH_COCK0) / (PH_COCK1 - PH_COCK0)) : ph < PH_SLAM0 ? 1
      : ph < PH_SLAM1 ? 1 - Math.pow((ph - PH_SLAM0) / (PH_SLAM1 - PH_SLAM0), 1.6) : 0;
    // (the landing is flagged: the recoil branch below advances impT in this same frame, so
    // the old `impT === 0` test never fired and the blow's dust/drop/quake were dead code)
    const landed = ph >= PH_SLAM1 && prev < PH_SLAM1;
    // THE LUNGE (brooderfix): the fall throws her whole front at him, a surge of the shell
    // along the line to her target that the offset springs carry back
    if (ph >= PH_SLAM0 && prev < PH_SLAM0 && L.threatE > 0.5 && !L.hold) {
      const lx = L.aim.x - L.pos.x, lz = L.aim.z - L.pos.z, ld = Math.hypot(lx, lz) || 1;
      L.offX.v += lx / ld * R * HUNT.lunge * L.threatE; L.offZ.v += lz / ld * R * HUNT.lunge * L.threatE;
    }
    if (landed) L.impT = 0;
    if (ph >= PH_SLAM0 && ph < PH_SLAM1) L.swing = Math.pow((ph - PH_SLAM0) / (PH_SLAM1 - PH_SLAM0), 2.2);
    else if (L.impT < 3) {
      L.impT += dt;
      const k = Math.max(0, L.impT - 0.10);                // pinned on the floor, then the bounce
      L.swing = L.impT < 0.10 ? 1 : Math.exp(-4.5 * k) * Math.cos(7 * k);
    } else L.swing = 0;
    // the blow lands: dust under the fingers, the body drops onto it, the ground jumps
    if (landed && L.threatE > 0.5) {
      const c = L.claws[1].major ? L.claws[1] : L.claws[0];
      c.dj.getWorldPosition(_ft);
      const gy = groundAt(L, _ft.x, _ft.z, false);
      silt(_ft.x, gy + 0.3, _ft.z, 5, 5, 3.6, 2.2);
      // THE PLUME: the seabed comes up off the blow (plume.js); game.js startles the reef from it
      spawnPlume(_ft.x, gy, _ft.z, 'big', L.threatE, L.idx);
      ev.plume = L.threatE; ev.plumeX = _ft.x; ev.plumeY = gy; ev.plumeZ = _ft.z;
      L.bY.v -= R * 0.10 * L.threatE;
      L.bP.v += 0.9 * L.threatE;
      quake(L, ev, _ft.x, _ft.z, 0.7 * L.threatE, player);
    }
  }

  // ---- heading and locomotion ----
  let pd = 1e9;
  for (const s of L.spine) { const d = s.distanceTo(player.pos); if (d < pd) pd = d; }
  L._pd = pd;
  let want = null, speed = 0;
  // THE HUNT (brooderfix, Michael 2026-10-08: "Crab does not follow sal at all when he gets
  // the egg"). Measured on main: awake she only ever TURNED and sidled (the stalk below is
  // purely tangential, so it drifted her outward), from her first commit on; no step toward
  // him was ever written, and the nest sits just outside her 2.4 R threat ring, so a thief
  // at the clutch was never even struck. Now, once she is up, she COMES FOR HIM: her body
  // moves in WORLD space toward what she is after (Sal, or blind, the spot she lost him),
  // crab-fashion, independent of where her face has got to; she stalks sideways as she
  // closes, plants for every blow and lunges into it. While he carries an egg she is
  // relentless; unburdened she keeps him off her ground (HUNT.guard round her lair) and lets
  // him go past it.
  const thief = !!(L.brood && L.brood.held >= 0);
  const hunt = !L.walkTo && !L.calmed && !L.hold && !L.dormant && L.standE > 0.5;
  const tx = L.aim.x - L.pos.x, tz = L.aim.z - L.pos.z, dh = Math.hypot(tx, tz) || 1e-3;
  L.huntD = dh;
  if (L.walkTo && L.standE > 0.9) {
    const dx = L.walkTo.x - L.pos.x, dz = L.walkTo.z - L.pos.z, dist = Math.hypot(dx, dz);
    if (dist < (L.toNest ? 3 : L.R * 1.9)) {            // stop with the claws short of the target
      L.walkTo = null;
      if (L.toNest) { L.toNest = false; L.standTarget = 0; }  // home: settle over the brood
    }
    else { want = Math.atan2(dx, dz); speed = L.speed * 0.30; }
  } else if (hunt && L._pdT < (thief ? 400 : 90)) {
    // her face follows what she SEES: Sal, or (lost in the silt) where she last saw him;
    // given up, she sweeps her front slowly across the cloud, searching. A thief she never
    // stops facing, however far he gets.
    // (under her, the bearing to him swings wildly with every step he takes: she holds)
    want = L.blindT < SIGHT_GIVEUP ? (dh > 0.5 * R ? Math.atan2(tx, tz) : L.yaw)
      : L.searchYaw + 0.7 * Math.sin((L.blindT - SIGHT_GIVEUP) * 0.45);
  }
  // the hunt's closing speed and heading (world space)
  let vC = 0, cAng = Math.atan2(tx, tz);
  if (hunt && L.standE > 0.9 && want !== null) {
    const N = L.lairPos || L.pos;                       // her ground: the lair she sleeps on (not the clutch, which may move)
    const terr = thief ? 1 : 1 - smooth(Math.hypot(L.aim.x - N.x, L.aim.z - N.z), HUNT.guard * 0.75 * R, HUNT.guard * R);
    const closeK = smooth(dh, HUNT.hold * R, (HUNT.hold + 0.6) * R) * terr * (L.blindT >= SIGHT_GIVEUP ? 0 : 1);
    // planted for the blow: from the fall to the end of the recoil
    const planted = L.threatE > 0.3 && (L.hamPh >= PH_SLAM0 || L.impT < 0.45);
    vC = planted ? 0 : L.speed * (thief ? HUNT.chase : HUNT.stalk) * closeK * (1 - 0.45 * L.threatE);
  }
  const goal = want !== null && speed > 0 ? L.walkTo : vC > 0.3 ? L.aim : null;
  if (goal) {
    // round the rocks and hulls ahead; no headway for 3 s (a pocket between two of them)
    // and she commits to going round the other way
    const dGo = Math.hypot(goal.x - L.pos.x, goal.z - L.pos.z);
    if (!(dGo < (L.goBest ?? 1e9) - 1.5)) L.goStall = (L.goStall || 0) + dt; else { L.goBest = dGo; L.goStall = 0; L.goFlips = 0; }
    if (L.goStall > 3) {
      L.goSide = L.goSide > 0 ? -1 : 1; L.goStall = 0; L.goBest = dGo;
      // boxed in twice over: she climbs (rocks stop blocking; her sole and feet ride their tops)
      if ((L.goFlips = (L.goFlips || 0) + 1) >= 2) { L.climbT = 8; L.goFlips = 0; }
    }
    if (goal === L.walkTo) want = steer(L, want, L.goSide || 0);
    else cAng = steer(L, cAng, L.goSide || 0);
  } else { L.goBest = undefined; L.goStall = 0; L.goSide = 0; L.goFlips = 0; }
  if (L.climbT > 0) { L.climbT -= dt; if (L.climbT < 0.5 && overTall(L)) L.climbT = 0.5; }
  // the turn has inertia: angular velocity eases toward what the error asks for (same
  // 0.35 rad/s ceiling), so she swings into a turn and out of it instead of pivoting
  let yawWant = 0;
  if (want !== null) {
    let dA = want - L.yaw;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    const wr = hunt ? HUNT.turn : 0.35;
    yawWant = clamp(dA * 1.4, -wr, wr);
    if (Math.abs(dA) > 0.6) speed *= 0.2;                // turn on the spot before striding off
  }
  L.yawV += (yawWant - L.yawV) * Math.min(1, 1.6 * dt);
  L.yaw += L.yawV * dt;
  let vx = Math.sin(L.yaw) * speed, vz = Math.cos(L.yaw) * speed;
  // the hunt: straight for him, whatever her face is doing
  vx += Math.sin(cAng) * vC; vz += Math.cos(cAng) * vC;
  // STALK: awake and not yet striking, she circles the diver crab-fashion — sideways,
  // face locked on him — and changes direction every few seconds. (Sideways across the line
  // to him, not across her own heading, so a thief behind her is not circled away from.)
  if (hunt && L.standE > 0.9 && L.threatE < 0.5 && L.seen && dh > L.R * 1.4 && dh < L.R * 6) {
    L.strafeT = (L.strafeT || 0) - dt;
    if (L.strafeT <= 0) { L.strafeT = 4 + Math.random() * 4; L.strafeDir = Math.random() < 0.5 ? -1 : 1; }
    const ss = L.speed * 0.22 * L.strafeDir * (thief ? 0.55 : 1);
    vx += tz / dh * ss; vz -= tx / dh * ss;
  }
  L.velPrev.copy(L.vel);
  L.vel.x = lerp(L.vel.x, vx, Math.min(1, 1.5 * dt));
  L.vel.z = lerp(L.vel.z, vz, Math.min(1, 1.5 * dt));
  L.pos.x += L.vel.x * dt;
  L.pos.z += L.vel.z * dt;
  // the world is solid to her: out of every hull and big rock, sliding along it
  L.pushed = L.standE > 0.3 ? pushOut(L, dt) : 0;

  // ---- feet: alternating tetrapod gait on planted feet ----
  // The swing is a real arc: the foot peels up fast, carries forward, and STABS down
  // (the lift peaks early, so the descent is steep); a landing kicks silt, drops the
  // body onto it and shakes the ground. Standing still she shifts her weight now and then.
  _busy[0] = _busy[1] = 0;
  for (const f of L.feet) if (f.t >= 0) _busy[f.group]++;
  // a quicker step when she runs (the stride is fixed: at 3.8 u/s a 0.8 s swing left her
  // feet trailing out of reach); unchanged at a walk
  const swT = SWING_T * clamp(1.25 - 0.13 * Math.hypot(L.vel.x, L.vel.z), 0.6, 1);
  let rollT = 0, pitchT = 0, yT = 0;
  L.shuffleT -= dt;
  let shuffle = -1;
  if (L.shuffleT <= 0 && L.standE > 0.9 && !_busy[0] && !_busy[1] && Math.hypot(L.vel.x, L.vel.z) < 0.3) {
    L.shuffleT = 2.5 + Math.random() * 4;
    shuffle = (Math.random() * 8) | 0;
  }
  for (let li = 0; li < 8; li++) {
    const f = L.feet[li], sd = li < 4 ? 1 : -1, k = li & 3;
    restWorld(L, li, _rw);
    if (L.standE > 0.35 && f.t < 0) reachFoot(L, li, _rw);   // the rest spot she can really stand on
    if (f.t >= 0) {
      f.t = Math.min(1, f.t + dt / swT);
      const e = win(f.t, 0.12, 0.92), lift = Math.sin(Math.PI * Math.pow(f.t, 0.72));
      f.cur.lerpVectors(f.from, f.to, e);
      f.cur.y += lift * f.h * L.R * L.standE;
      // a swing over a hump never cuts through it: the arc rides over the ground under it
      { const gc = groundAt(L, f.cur.x, f.cur.z, true) + 0.25 * lift; if (f.cur.y < gc) f.cur.y = gc; }
      // weight comes off this corner: the body lists toward it and away from the step
      rollT -= sd * 0.016 * lift; pitchT += (k < 2 ? 0.011 : -0.008) * lift; yT += 0.006 * lift;
      if (f.t >= 1) {
        f.t = -1; f.planted.copy(f.to); f.cur.copy(f.to);
        f.sl = slopeAt(L, f.to.x, f.to.z);
        silt(f.cur.x, f.cur.y + 0.2, f.cur.z, f.h > 0.2 ? 3 : 1, 3, 1.4 + 1.4 * f.h / 0.30, 0.9);
        if (f.h > 0.2) spawnPlume(f.cur.x, f.cur.y, f.cur.z, 'small', 1, L.idx);   // a heavy foot throws its own small cloud
        L.bY.v -= R * 0.10 * f.h / 0.30;
        L.bR.v += sd * 0.10 * f.h / 0.30;
        quake(L, ev, f.cur.x, f.cur.z, 0.16 * f.h / 0.30, player);
      }
    } else if (L.standE > 0.35) {
      const d = f.planted.distanceTo(_rw);
      if (!_busy[f.group ^ 1] && (d > STRIDE * L.R || li === shuffle)) {
        f.from.copy(f.planted);
        f.to.copy(_rw).addScaledVector(L.vel, swT * 0.6);
        if (li === shuffle) { f.to.x += (Math.random() - 0.5) * 0.06 * R; f.to.z += (Math.random() - 0.5) * 0.06 * R; }
        reachFoot(L, li, f.to);                        // on the ground or a rock top, beside a hull, inside the leg's reach
        // a shuffle is a small, low step; a stride lifts high
        f.h = li === shuffle && d < STRIDE * L.R ? 0.09 : 0.30;
        f.t = 0;
        _busy[f.group]++;
      }
    } else {
      f.planted.lerp(_rw, 1 - Math.pow(0.05, dt));      // the sprawl slides with the settle
      f.cur.copy(f.planted);
    }
  }
  // the body's springs: bob, list and pitch lag the gait (underdamped: it sways), and the
  // shell trails the legs when she starts and surges past them when she stops
  const idt = dt > 0 ? 1 / dt : 0;
  const ax = (L.vel.x - L.velPrev.x) * idt, az = (L.vel.z - L.velPrev.z) * idt, lim = 0.06 * R;
  spr(L.offX, clamp(-ax * 0.9, -lim, lim), 2.4, 0.55, dt);
  spr(L.offZ, clamp(-az * 0.9, -lim, lim), 2.4, 0.55, dt);
  spr(L.bY, yT * R, 6.5, 0.45, dt);
  spr(L.bP, pitchT, 4.2, 0.40, dt);
  spr(L.bR, rollT, 4.2, 0.40, dt);
  spr(L.hurt, 0, 6.5, 0.32, dt);
  // she LOOKS at him with her whole front: a diver above her brow makes her rear to keep
  // him in her eyes, one below makes her crouch (awake, not calmed; a slow follower)
  {
    let lk = 0;
    if (!L.dormant && !L.calmed && !L.hold && L.standE > 0.8 && pd < 60) {
      const el = Math.atan2(L.aim.y - L.head.y, Math.max(4, Math.hypot(L.aim.x - L.head.x, L.aim.z - L.head.z)));
      lk = clamp(el * 0.35, -0.06, 0.16);
    }
    L.lookP = (L.lookP || 0) + (lk - (L.lookP || 0)) * Math.min(1, 1.2 * dt);
    // the guard rises when he is close under her face (in front, inside 1.6 R): see poseClaws
    let gu = 0;
    if (!L.dormant && !L.calmed && L.standE > 0.8) {
      const px = player.pos.x - L.pos.x, pz = player.pos.z - L.pos.z, fw = px * Math.sin(L.yaw) + pz * Math.cos(L.yaw);
      if (fw > 0 && Math.hypot(px, pz) < 1.6 * R) gu = 1;
    }
    if (!L.guardUp) L.guardUp = S();
    spr(L.guardUp, gu, 3.2, 0.9, dt);
  }

  poseAll(L, dt, player);

  // (contact: her body is solid now — bodyCols.js, resolved by game.js after this update,
  // which also raises the slam when a part of her comes INTO him. The old shove here was a
  // velocity kick off nine shell spheres: 12 u/s a frame, it bounced him off the ridge.)
  L.touchT = Math.max(0, (L.touchT || 0) - dt);
  // the hammer: at the bottom of the swing, anything under the great claw's fingers
  L.strikeCd = Math.max(0, (L.strikeCd || 0) - dt);
  if (!L.calmed && L.threatE > 0.8 && L.swing > 0.85 && L.strikeCd <= 0) {
    const c = L.claws[1].major ? L.claws[1] : L.claws[0];
    c.dj.getWorldPosition(_ft);
    if (_ft.distanceTo(player.pos) < L.R * 0.42) {
      _v.copy(player.pos).sub(_ft).setY(0.4).normalize();
      player.vel.addScaledVector(_v, HUNT.knock);
      ev.lightDrain += 0.12;
      ev.slam = true;
      L.strikeCd = 2.0;
    }
  }
  if (!L.calmed && L.standE > 0.5 && pd < L.R * 2) L.agitation = Math.min(1, L.agitation + dt * 0.8);
  L.agitation = Math.max(0, L.agitation - dt * 0.2);

  // ---- wards ----
  const haloK = L.size;
  if (!L.calmed) {
    let allLit = true;
    for (let i = 0; i < L.sigils.length; i++) {
      const g = L.sigils[i];
      // (a remembered ward is buried with the rest while she sleeps: it rises with her)
      if (g.lit) { if (g.mem) wardMemPose(g, dt, haloK, L.standE); else wardLitPose(g, dt, haloK); }
      else {
        allLit = false;
        // a sleeping Brooder's wards are in the sand: no glow, no light until she rises
        g.rev = L.standE;
        wardIdle(g, dt, haloK);
        // buried wards can sit within reach of her face through the sand: only a
        // standing Brooder offers them
        if (L.standE > 0.6) {
          // THE BROOD RULE: her last ward will not light while a clump of her clutch is
          // out; pressed back into her, it lights on its own.
          let dark = 0;
          for (const q of L.sigils) if (!q.lit) dark++;
          const last = dark === 1;
          if (last && L.brood && L.brood.out() > 0) {
            // (fifth-ward) every touch answers: a cold spark, a dead knock, the line (common.js)
            wardRefuse(L, g, player, ev, MSG_BROOD_COLD);
          } else if (last && L.brood && L.sigils.length > 1 && !ev.sigilLit) {
            lightWard(L, g, ev);
          } else wardTouch(L, i, g, player, ev);
        }
      }
    }
    let rem = 0;
    for (const q of L.sigils) if (!q.lit) rem++;
    ev.remaining = rem;
    if (allLit) {
      L.calmed = true; L.calmT = 0; ev.calmed = true; L.threatTarget = 0;
      if (L.memWard >= 0) wardsRecall(L, haloK);
      // she goes home: back to her bed on the lip, to settle over her clutch
      if (L.brood) { L.walkTo = L.lairPos.clone(); L.toNest = true; L.standTarget = 1; }
      else { L.standTarget = 0; L.walkTo = null; }
    }
  } else {
    L.calmT += dt;
    for (const g of L.sigils) {
      g.pulse += dt;
      g.light.intensity = Math.max(0, 120 - L.calmT * 8);
      g.light.position.copy(g.grp.position);
      g.halo.position.copy(g.grp.position);
    }
  }
  // a ward lit is a wound: she flinches - rears back, claws snatched in - and it rings out
  if (ev.sigilLit) { L.seen = true; L.blindT = 0; L.lastSeen.copy(player.pos); L.hurt.v += 5.5; L.bY.v += R * 0.12; quake(L, ev, L.pos.x, L.pos.z, 0.3, player); }
  wardFlashes(L, dt, null);
  updatePlumes(dt);
  L.pPrev.copy(player.pos);
  return ev;
}
