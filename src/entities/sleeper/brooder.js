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
// This file is the body and its motion. The ridge/nest/egg reveal, the fight and the
// payoff come in the next plan; until then the lab drives her through L.cmd().
import * as THREE from 'three';
import { scene, envTexDeep as envTex } from '../../core.js';
import { V3, clamp, lerp } from '../../lib/math.js';
import { makeGlow } from '../../lib/textures.js';
import { registerPaint } from '../../lib/paint.js';
import { terrainH } from '../../world/terrain.js';
import { setWardTargets } from '../../world/predators.js';
import {
  setLive, SIGIL_POOL_N, ensureSigilPool, makeWard, wardIdle, wardLitPose, wardTouch, wardFlashes, makeEmbers
} from './common.js';
import * as G from './brooderGeo.js';

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
const SEG = { coxa: 0.14, femur: 0.90, tibia: 0.86, dactyl: 0.46 };
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
const STRIDE = 0.30, SWING_T = 0.55, RISE_T = 6, SETTLE_T = 4;

// Scratch (never allocated per frame).
const _hip = V3(), _d = V3(), _pn = V3(), _j1 = V3(), _ank = V3(), _ank2 = V3(), _knee = V3(), _ft = V3(), _v = V3();
const _x = V3(), _y = V3(), _z = V3(), _sc = V3(), _r = V3(), _rw = V3(), _lp = V3(), _pl = V3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qs = new THREE.Quaternion();

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
    uni: { uTime: { value: 0 } }
  };

  // ---- materials ----
  const maps = G.carapaceMaps();
  const grain = G.limbGrain(), limbAlb = G.limbAlbedo(false), paleAlb = G.limbAlbedo(true);
  L.keepTex = new Set([maps.map, maps.normalMap, maps.roughnessMap, grain, limbAlb, paleAlb]);
  const shellMat = registerPaint(new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 0, vertexColors: true,
    envMap: envTex, envMapIntensity: 0.35
  }));
  const limbMat = registerPaint(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: limbAlb, roughness: 0.55, metalness: 0, vertexColors: true,
    normalMap: grain, normalScale: new THREE.Vector2(0.6, 0.6), envMap: envTex, envMapIntensity: 0.3
  }));
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
  const shell = new THREE.Mesh(G.carapaceGeo(), shellMat);
  shell.castShadow = shell.receiveShadow = true;
  body.add(shell);
  const belly = new THREE.Mesh(G.bellyGeo(), bellyMat);
  belly.castShadow = belly.receiveShadow = true;
  body.add(belly);

  // ---- crust: barnacles and weed ----
  const bar = G.barnacleMatrices(110, 0xBA2AC1E5 + idx);
  const barnMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xdcd6c8, roughness: 0.86, metalness: 0, side: THREE.DoubleSide, envMap: envTex, envMapIntensity: 0.25 }));
  const barn = new THREE.InstancedMesh(G.barnacleGeo(), barnMat, bar.m.length);
  bar.m.forEach((m, i) => { barn.setMatrixAt(i, m); barn.setColorAt(i, bar.c[i]); });
  barn.instanceMatrix.needsUpdate = true;
  if (barn.instanceColor) barn.instanceColor.needsUpdate = true;
  barn.castShadow = true;
  body.add(barn);

  const weedGeo = new THREE.PlaneGeometry(0.014, 0.14, 1, 6);
  weedGeo.translate(0, 0.07, 0);
  const weedMat = new THREE.MeshStandardMaterial({ color: 0x55603c, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
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

  // ---- walking legs: one InstancedMesh per segment type, eight instances each ----
  const legs = {
    coxa: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.115, r1: 0.108, rows: 8, radial: 16 }), limbMat, 8),
    femur: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.112, r1: 0.070, spines: 9, rows: 30 }), limbMat, 8),
    tibia: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.068, r1: 0.040, spines: 6 }), limbMat, 8),
    dactyl: new THREE.InstancedMesh(G.segmentGeo({ r0: 0.046, r1: 0, tip: true, curl: 0.16, rows: 22, radial: 12 }), limbMat, 8)
  };
  for (const k in legs) {
    legs[k].frustumCulled = false;                 // instance bounds go stale as she walks
    legs[k].castShadow = true;
    legs[k].instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    body.add(legs[k]);
  }
  L.legs = legs;
  for (let li = 0; li < 8; li++) {
    const sd = li < 4 ? 1 : -1, k = li & 3;
    L.feet.push({ planted: V3(), from: V3(), to: V3(), cur: V3(), t: -1, group: (k + (sd > 0 ? 0 : 1)) & 1 });
  }

  // ---- arms: a massive crusher on -X, a mantis scythe on +X ----
  // Bone-pale arms: dark limbs vanished against her own dark face (look-dev 2026-09-24).
  const armMat = registerPaint(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: paleAlb, roughness: 0.5, metalness: 0, vertexColors: true,
    normalMap: grain, normalScale: new THREE.Vector2(0.7, 0.7), envMap: envTex, envMapIntensity: 0.35
  }));
  L.claws = [buildClaw(body, armMat, -1, 'crusher'), buildClaw(body, armMat, 1, 'scythe')];

  // ---- thorns: the silhouette ----
  const thornMat = registerPaint(new THREE.MeshStandardMaterial({
    color: 0xcfc4ae, roughness: 0.5, metalness: 0, vertexColors: true, envMap: envTex, envMapIntensity: 0.35
  }));
  const tm = G.thornMatrices(0x7A0A5 + idx);
  const thorns = new THREE.InstancedMesh(G.thornGeo(), thornMat, tm.length);
  tm.forEach((m, i) => thorns.setMatrixAt(i, m));
  thorns.instanceMatrix.needsUpdate = true;
  thorns.castShadow = true;
  body.add(thorns);

  // ---- the face: a cluster of eight black eyes under the brow, no glow — only
  // cold catchlights — and a cage of hooked mouthparts that never stops working ----
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x030405, roughness: 0.04, metalness: 0.4, envMap: envTex, envMapIntensity: 2.2 });
  const EYES = [[0.075, -0.075, 0.895, 0.040], [0.165, -0.085, 0.870, 0.032], [0.245, -0.105, 0.835, 0.024], [0.040, -0.135, 0.905, 0.022]];
  const eyes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), eyeMat, EYES.length * 2);
  let ei = 0;
  for (const [x, y, z, r] of EYES) for (const sd of [-1, 1]) {
    eyes.setMatrixAt(ei++, _m.compose(_v.set(x * sd, y, z), _q.identity(), _sc.set(r, r * 0.85, r)));
  }
  eyes.instanceMatrix.needsUpdate = true;
  body.add(eyes);
  L.mouth = [];
  for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(0.05 * sd + 0.035 * k * sd, -0.12 - 0.02 * k, 0.86 - 0.03 * k);
    hinge.rotation.order = 'YZX';
    const hook = new THREE.Mesh(G.hornGeo({ len: 0.20 - 0.03 * k, r0: 0.030, curve: -0.35, bite: -1, teeth: 'saw', rows: 14, radial: 8 }), limbMat);
    hinge.add(hook);
    body.add(hinge);
    L.mouth.push({ hinge, sd, k });
  }

  // ---- wards ----
  const wardScale = 4.2;
  for (let i = 1; i <= c.nSigils; i++) {
    const w = makeWard(L, i, wardScale);
    const s = SOCKETS[i - 1];
    w.local = V3(s.p[0], s.p[1], s.p[2]);
    w.q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(s.n[0], s.n[1], s.n[2]).normalize());
    L.sigils.push(w);
  }
  makeEmbers(L, c.size);

  // Set down somewhere in the zone, asleep. The lab and (later) the ridge move her.
  placeAt(L, V3((Math.random() - 0.5) * 120, 0, (Math.random() - 0.5) * 120), Math.random() * Math.PI * 2);

  L.cmd = (name, arg) => {
    if (name === 'stand') L.standTarget = 1;
    else if (name === 'settle') { L.standTarget = 0; L.walkTo = null; }
    else if (name === 'walk') { L.walkTo = arg ? arg.clone() : null; L.standTarget = 1; }
    else if (name === 'rear') L.threatTarget = L.threatTarget > 0.5 ? 0 : 1;
    else if (name === 'hold') L.hold = !L.hold;         // lab framing: stop tracking the diver
    else if (name === 'place') placeAt(L, arg.pos, arg.yaw);
    return L.probe();
  };
  L.probe = () => ({
    kind: 'brooder', stand: L.stand, threat: L.threat, yaw: L.yaw, pos: L.pos.toArray(), bodyY: L.bodyY,
    swinging: L.feet.filter(f => f.t >= 0).length, walking: !!L.walkTo, calmed: L.calmed,
    wards: L.sigils.map(g => ({ lit: g.lit, y: +(g.grp.position.y - terrainH(g.grp.position.x, g.grp.position.z, L.idx)).toFixed(2) })),
    tris: countTris(L.body)
  });

  scene.add(grp);
  setLive(L);
  setWardTargets(-1, null);
  poseAll(L, 0, null);
  return L;
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
// joint is a Group so posing is plain Euler writes (no allocation).
function buildClaw(body, mat, sd, kind) {
  const root = new THREE.Group();
  root.position.set(0.40 * sd, -0.05, 0.62);
  root.rotation.order = 'YZX';
  body.add(root);
  const scythe = kind === 'scythe', ML = scythe ? 0.80 : 0.62;
  const merus = new THREE.Mesh(G.segmentGeo({ r0: scythe ? 0.075 : 0.092, r1: scythe ? 0.060 : 0.080, spines: scythe ? 7 : 5 }), mat);
  merus.scale.x = ML;
  merus.castShadow = true;
  root.add(merus);
  const cj = new THREE.Group();
  cj.position.x = ML;
  cj.rotation.order = 'YZX';
  root.add(cj);
  const carpus = new THREE.Mesh(G.segmentGeo({ r0: 0.082, r1: 0.090, spines: 2 }), mat);
  carpus.scale.x = 0.26;
  carpus.castShadow = true;
  cj.add(carpus);
  const pj = new THREE.Group();
  pj.position.x = 0.26;
  pj.rotation.order = 'YZX';
  cj.add(pj);
  const pg = G.palmGeo(kind);
  const palm = new THREE.Mesh(pg, mat);
  palm.castShadow = true;
  pj.add(palm);
  const dj = new THREE.Group();
  dj.position.fromArray(pg.userData.hinge);
  pj.add(dj);
  const crusher = kind === 'crusher';
  const dact = new THREE.Mesh(G.hornGeo(scythe
    ? { len: 0.85, r0: 0.060, curve: -0.26, bite: -1, teeth: 'saw' }
    : { len: 0.32, r0: 0.085, curve: -0.12, bite: -1, teeth: 'molar' }), mat);
  dact.castShadow = true;
  dj.add(dact);
  return { root, cj, pj, dj, sd, crusher, scythe };
}

// Teleport: body to pos (on the ground), heading yaw, feet reset to their rest spots.
function placeAt(L, pos, yaw) {
  L.pos.set(pos.x, 0, pos.z);
  L.yaw = yaw;
  L.vel.set(0, 0, 0);
  for (let li = 0; li < 8; li++) {
    const f = L.feet[li];
    restWorld(L, li, f.planted);
    f.cur.copy(f.planted); f.t = -1;
  }
}

// Rest spot of foot li: local (yaw only) -> world, on the terrain.
function restWorld(L, li, out) {
  const lg = LEGS[li & 3], sd = li < 4 ? 1 : -1, st = L.standE;
  const reach = lerp(1.62, 1.28, st) * lg.k, a = lg.splay * lerp(1.15, 0.85, st);
  const lx = lg.hip[0] * sd + Math.cos(a) * reach * sd, lz = lg.hip[2] + Math.sin(a) * reach;
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
  out.set(L.pos.x + (lx * cy + lz * sy) * L.R, 0, L.pos.z + (-lx * sy + lz * cy) * L.R);
  out.y = terrainH(out.x, out.z, L.idx);
  return out;
}

// Rigid segment a->b in body-local space as an instance matrix: X along the bone, Z the
// leg-plane normal (so the flattened section faces fore-aft), Y the in-plane up.
function segMat(im, i, a, b, pn) {
  _x.subVectors(b, a);
  const len = _x.length() || 1e-4;
  _x.divideScalar(len);
  _z.copy(pn);
  _y.crossVectors(_z, _x).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _m.scale(_sc.set(len, 1, 1));
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
  _pn.crossVectors(_d, UP).normalize();
  _j1.copy(_hip).addScaledVector(_d, SEG.coxa * 0.98).addScaledVector(UP, -SEG.coxa * 0.2);
  _ank.copy(footL).addScaledVector(UP, SEG.dactyl * k * 0.93).addScaledVector(_d, -SEG.dactyl * k * 0.36);
  const l1 = SEG.femur * k, l2 = SEG.tibia * k;
  _v.subVectors(_ank, _j1);
  const qx = _v.x * _d.x + _v.z * _d.z, qy = _v.y;
  const D = clamp(Math.hypot(qx, qy), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const base = Math.atan2(qy, qx);
  const th1 = base + Math.acos(clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1));
  _knee.copy(_j1).addScaledVector(_d, Math.cos(th1) * l1).addScaledVector(UP, Math.sin(th1) * l1);
  segMat(L.legs.coxa, li, _hip, _j1, _pn);
  segMat(L.legs.femur, li, _j1, _knee, _pn);
  _ank2.copy(_knee).addScaledVector(_v.subVectors(_ank, _knee).normalize(), l2);
  segMat(L.legs.tibia, li, _knee, _ank2, _pn);
  _ft.copy(_ank2).addScaledVector(_v.subVectors(footL, _ank2).normalize(), SEG.dactyl * k);
  segMat(L.legs.dactyl, li, _ank2, _ft, _pn);
}

// Arm pose. At rest both are folded up before the face like a mantis at prayer, the
// scythe's blade closed back along its hand. In threat the scythe lifts high over her
// back with the blade half open and the crusher comes forward, gaping.
function poseClaws(L) {
  const th = L.threatE, t = L.t, st = L.standE;
  for (const c of L.claws) {
    const sd = c.sd;
    // a slow tremor that never quite stops: the menace is that she is never still
    const tr = 0.03 * Math.sin(t * 2.3 + sd * 2.1) * Math.sin(t * 0.61) * st;
    if (c.scythe) {
      // strike-ready, not a crane: upper arm raised forward, forearm folded down toward
      // the diver, blade cocked half open
      c.root.rotation.set(0, -Math.PI / 2 + sd * lerp(0.30, 0.45, th), lerp(0.25 - 0.55 * (1 - st), 0.95, th) + tr);
      c.cj.rotation.set(0, -sd * lerp(1.35, 0.30, th), lerp(-0.60, -1.55, th));
      c.pj.rotation.set(0, -sd * lerp(0.35, 0.10, th), lerp(-1.10, -0.35, th) + tr);
      c.dj.rotation.z = lerp(-2.75, -1.10, th);                 // folded back <-> half open
    } else {
      c.root.rotation.set(0, -Math.PI / 2 + sd * lerp(0.35, 0.55, th), lerp(-0.10 - 0.45 * (1 - st), 0.30, th) + tr);
      c.cj.rotation.set(0, -sd * lerp(1.45, 0.55, th), lerp(0.10, -0.25, th));
      c.pj.rotation.set(0, -sd * lerp(0.45, 0.05, th), lerp(-0.20, 0.05, th));
      const snap = Math.pow(Math.max(0, Math.sin(t * 0.7 + sd * 1.3)), 8) * 0.10 * st;
      c.dj.rotation.z = 0.04 + snap + 0.60 * th;
    }
  }
}

function poseAll(L, dt, player) {
  const b = L.body, R = L.R, st = L.standE;
  // body on the ground: mean of five samples, pitch/roll from the fore-aft/side slopes
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), o = 0.7 * R;
  const gF = terrainH(L.pos.x + sy * o, L.pos.z + cy * o, L.idx), gB = terrainH(L.pos.x - sy * o, L.pos.z - cy * o, L.idx);
  const gL = terrainH(L.pos.x + cy * o, L.pos.z - sy * o, L.idx), gR = terrainH(L.pos.x - cy * o, L.pos.z + sy * o, L.idx);
  const gC = terrainH(L.pos.x, L.pos.z, L.idx);
  const gy = (gF + gB + gL + gR + gC) / 5;
  L.bodyY = gy + R * (lerp(0.06, 0.92, st) + 0.10 * L.threatE + 0.012 * Math.sin(L.t * 0.45) * (1 - st));
  b.position.set(L.pos.x, L.bodyY, L.pos.z);
  // hunched: standing, the front drops over the diver; threat lifts it to show the face
  b.rotation.set(-Math.atan2(gF - gB, 2 * o) + 0.16 * st - 0.36 * L.threatE, L.yaw, Math.atan2(gL - gR, 2 * o));
  b.updateMatrixWorld(true);
  _inv.copy(b.matrixWorld).invert();

  for (let li = 0; li < 8; li++) poseLeg(L, li, _lp.copy(L.feet[li].cur).applyMatrix4(_inv));
  for (const k in L.legs) L.legs[k].instanceMatrix.needsUpdate = true;
  poseClaws(L);

  // the mouthparts: three pairs working out of phase, faster when roused
  for (const m of L.mouth) {
    const w = L.t * (3.4 + 3 * L.agitation) + m.k * 2.1 + (m.sd > 0 ? 0 : Math.PI);
    m.hinge.rotation.set(0, -Math.PI / 2 - m.sd * 0.35, -0.9 + 0.22 * Math.sin(w) * (0.3 + 0.7 * st));
  }

  // wards, collision centres, head
  for (const g of L.sigils) {
    g.grp.position.copy(g.local).applyMatrix4(b.matrixWorld);
    b.getWorldQuaternion(_q);
    g.grp.quaternion.copy(_q).multiply(g.q);
  }
  for (let k = 0; k < COLL.length; k++) L.spine[k].set(COLL[k][0], COLL[k][1], COLL[k][2]).applyMatrix4(b.matrixWorld);
  L.head.set(0, 0.10, 0.80).applyMatrix4(b.matrixWorld);
}

export function updateBrooder(L, dt, t, player) {
  const ev = { sigilLit: 0, calmed: false, lightDrain: 0, slam: false, remaining: 0, msg: null };
  if (L.pendingMsg) { ev.msg = L.pendingMsg; L.pendingMsg = null; }
  if (!L.pPrev) L.pPrev = player.pos.clone();
  L.t += dt;
  L.uni.uTime.value = L.t;

  // ---- stand / threat easing: she takes ~6 s to rise and ~4 s to settle ----
  const rate = L.standTarget > L.stand ? 1 / RISE_T : 1 / SETTLE_T;
  L.stand += clamp(L.standTarget - L.stand, -rate * dt, rate * dt);
  L.standE = smooth(L.stand, 0, 1);
  // she rears on her own when the diver comes close (the lab's hold/rear override it)
  if (!L.hold && !L.calmed) L.threatTarget = L.standE > 0.9 && L._pd < L.R * 2.4 ? 1 : 0;
  L.threat += clamp(L.threatTarget - L.threat, -1.5 * dt, 1.5 * dt);
  L.threatE = smooth(L.threat, 0, 1) * L.standE;

  // ---- heading and locomotion ----
  let pd = 1e9;
  for (const s of L.spine) { const d = s.distanceTo(player.pos); if (d < pd) pd = d; }
  L._pd = pd;
  let want = null, speed = 0;
  if (L.walkTo && L.standE > 0.9) {
    const dx = L.walkTo.x - L.pos.x, dz = L.walkTo.z - L.pos.z, dist = Math.hypot(dx, dz);
    if (dist < L.R * 1.9) L.walkTo = null;              // stop with the claws short of the target
    else { want = Math.atan2(dx, dz); speed = L.speed * 0.30; }
  } else if (!L.calmed && !L.hold && L.standE > 0.5 && pd < 90) {
    want = Math.atan2(player.pos.x - L.pos.x, player.pos.z - L.pos.z);
  }
  if (want !== null) {
    let dA = want - L.yaw;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    L.yaw += clamp(dA, -0.35 * dt, 0.35 * dt);
    if (Math.abs(dA) > 0.6) speed *= 0.2;                // turn on the spot before striding off
  }
  const vx = Math.sin(L.yaw) * speed, vz = Math.cos(L.yaw) * speed;
  L.vel.x = lerp(L.vel.x, vx, Math.min(1, 2 * dt));
  L.vel.z = lerp(L.vel.z, vz, Math.min(1, 2 * dt));
  L.pos.x += L.vel.x * dt;
  L.pos.z += L.vel.z * dt;

  // ---- feet: alternating tetrapod gait on planted feet ----
  const busy = [0, 0];
  for (const f of L.feet) if (f.t >= 0) busy[f.group]++;
  for (let li = 0; li < 8; li++) {
    const f = L.feet[li];
    restWorld(L, li, _rw);
    if (f.t >= 0) {
      f.t = Math.min(1, f.t + dt / SWING_T);
      const e = smooth(f.t, 0, 1);
      f.cur.lerpVectors(f.from, f.to, e);
      f.cur.y += Math.sin(Math.PI * f.t) * 0.30 * L.R * L.standE;
      if (f.t >= 1) { f.t = -1; f.planted.copy(f.to); f.cur.copy(f.to); }
    } else if (L.standE > 0.35) {
      if (busy[f.group ^ 1] === 0 && f.planted.distanceTo(_rw) > STRIDE * L.R) {
        f.from.copy(f.planted);
        f.to.copy(_rw).addScaledVector(L.vel, SWING_T * 0.6);
        f.to.y = terrainH(f.to.x, f.to.z, L.idx);
        f.t = 0;
        busy[f.group]++;
      }
    } else {
      f.planted.lerp(_rw, 1 - Math.pow(0.05, dt));      // the sprawl slides with the settle
      f.cur.copy(f.planted);
    }
  }

  poseAll(L, dt, player);

  // ---- contact: the shell shoves ----
  if (pd < L.collR) {
    let ni = 0, nd = 1e9;
    for (let k = 0; k < L.spine.length; k++) { const d = L.spine[k].distanceTo(player.pos); if (d < nd) { nd = d; ni = k; } }
    _v.copy(player.pos).sub(L.spine[ni]).normalize();
    player.vel.addScaledVector(_v, 90 * dt * 8);
    ev.lightDrain += dt * 0.5;
    ev.slam = true;
  }
  if (!L.calmed && L.standE > 0.5 && pd < L.R * 2) L.agitation = Math.min(1, L.agitation + dt * 0.8);
  L.agitation = Math.max(0, L.agitation - dt * 0.2);

  // ---- wards ----
  const haloK = L.size;
  if (!L.calmed) {
    let allLit = true;
    for (let i = 0; i < L.sigils.length; i++) {
      const g = L.sigils[i];
      if (g.lit) wardLitPose(g, dt, haloK);
      else {
        allLit = false;
        // a sleeping Brooder's wards are in the sand: no glow, no light until she rises
        g.rev = L.standE;
        wardIdle(g, dt, haloK);
        // buried wards can sit within reach of her face through the sand: only a
        // standing Brooder offers them
        if (L.standE > 0.6) wardTouch(L, i, g, player, ev);
      }
    }
    ev.remaining = L.sigils.filter(q => !q.lit).length;
    if (allLit) { L.calmed = true; L.calmT = 0; ev.calmed = true; L.standTarget = 0; L.threatTarget = 0; L.walkTo = null; }
  } else {
    L.calmT += dt;
    for (const g of L.sigils) {
      g.pulse += dt;
      g.light.intensity = Math.max(0, 120 - L.calmT * 8);
      g.light.position.copy(g.grp.position);
      g.halo.position.copy(g.grp.position);
    }
  }
  wardFlashes(L, dt, null);
  L.pPrev.copy(player.pos);
  return ev;
}
