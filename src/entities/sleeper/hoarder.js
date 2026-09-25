// ORUNE, THE HOARDER — zone 1's sleeper (roadmap/three-sleepers.md, spec §2).
// An octopus-like colossus: a warty chromatophore mantle-sac behind a head with raised
// eye turrets (gold irises, horizontal slit pupils, eyeshine when the lantern finds
// them), and eight arms of ~37 u, pale-suckered underneath, rebuilt on the CPU as
// world-space tubes every frame (8 x 40 x 14 verts).
//
// Asleep she lies wrapped round the broken trawler she hoards her lights in, arms draped
// over the wreck and out across the silt like cargo chain, eyes shut to slits. Taking the
// ship's lamp from the hoard wakes her (hoard.onTake): the mantle lifts, the arms come
// up writhing, and the hoard's lanterns go out one by one.
//
// Awake: she turns to the diver and LASHES — an arm's tip goes for him; a hit GRABS and
// drags him toward her beak until he cuts free (game.js calls L.onSlash) or it tires.
// She hates light: an arm the lit lantern comes near flinches and rolls, baring its
// sucker face — and the wards ride on the sucker faces of four arms, dark until the
// sonar rings them (the zone-1 rule, sonarWards). Calmed, she coils back round the wreck
// and her wards stay burning: a lighthouse in the dark zone.
import * as THREE from 'three';
import { scene, envTexDeep as envTex } from '../../core.js';
import { V3, clamp, lerp } from '../../lib/math.js';
import { registerPaint } from '../../lib/paint.js';
import { terrainH } from '../../world/terrain.js';
import { setWardTargets } from '../../world/predators.js';
import { wreckSites } from '../../world/wrecks.js';
import {
  setLive, SIGIL_POOL_N, ensureSigilPool, makeWard, wardIdle, wardLitPose, wardTouch, wardFlashes, makeEmbers
} from './common.js';
import * as G from './hoarderGeo.js';
import { makeHoard } from './hoard.js';

const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;
const RM_OF_SIZE = 0.95, ARM_OF_SIZE = 5.0, NA = 8, RINGS = 40, RADIAL = 14, SUCK = 14;
const WARD_ARMS = [0, 2, 4, 6], WARD_S = 0.22;
const UP = V3(0, 1, 0);

const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _t = V3(), _u = V3(), _w = V3(), _p = V3(), _q = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _s = V3(), _zp = V3(0, 0, 1), _yp = V3(0, 1, 0);

export function makeHoarder(idx, cfg) {
  let c = cfg;
  if (c.nSigils > SIGIL_POOL_N) c = Object.assign({}, c, { nSigils: SIGIL_POOL_N });
  ensureSigilPool();
  const Rm = c.size * RM_OF_SIZE, AL = c.size * ARM_OF_SIZE;
  const grp = new THREE.Group(), body = new THREE.Group();
  body.scale.setScalar(Rm);
  body.rotation.order = 'YXZ';
  grp.add(body);
  const L = {
    ...c, idx, R: Rm, AL, size: c.size, grp, body, t: 0, agitation: 0, calmed: false, calmT: 0,
    sonarWards: true, guardWards: false, reveal: 0, rang: false, hinted: false, pendingMsg: null,
    reach: 5, collR: Rm * 0.85, flare: 0, dormant: true, rise: 0, riseE: 0, riseTarget: 0,
    pos: V3(), yaw: 0, bodyY: 0, head: V3(), spine: [V3(), V3(), V3(), V3()], sigils: [], arms: [],
    grab: null, lashCd: 3, _pd: 1e9
  };

  // ---- skin ----
  const sk = G.skinMaps();
  L.keepTex = new Set([sk.map, sk.normalMap, sk.emissiveMap, G.eyeTex()]);
  const skin = registerPaint(new THREE.MeshStandardMaterial({
    map: sk.map, normalMap: sk.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), vertexColors: true,
    roughness: 0.42, metalness: 0, envMap: envTex, envMapIntensity: 0.55,
    // faint violet photophores: in the dark zone the only way to see the size of her
    emissive: 0x6b58d8, emissiveMap: sk.emissiveMap, emissiveIntensity: 0.25
  }));
  L.skin = skin;
  const mantle = new THREE.Mesh(G.mantleGeo(), skin);
  mantle.castShadow = mantle.receiveShadow = true;
  body.add(mantle);
  L.mantle = mantle;

  // ---- eyes: gold, slit-pupilled, shut to slits asleep; eyeshine when the lantern finds them ----
  const eyeMat = new THREE.MeshStandardMaterial({ map: G.eyeTex(), roughness: 0.06, metalness: 0.1, envMap: envTex, envMapIntensity: 1.8,
    emissive: 0xd9b24a, emissiveMap: G.eyeTex(), emissiveIntensity: 0 });
  L.eyeMat = eyeMat;
  const lidMat = skin;
  L.eyes = [];
  for (const sd of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(G.EYE_AT[0] * sd, G.EYE_AT[1] + 0.02, G.EYE_AT[2]);
    e.rotation.y = sd * 0.75;                                     // look out and forward
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 18), eyeMat);
    e.add(ball);
    const lidT = new THREE.Mesh(new THREE.SphereGeometry(0.175, 20, 10, 0, TAU, 0, Math.PI / 2), lidMat);
    const lidB = new THREE.Mesh(new THREE.SphereGeometry(0.175, 20, 10, 0, TAU, Math.PI / 2, Math.PI / 2), lidMat);
    e.add(lidT, lidB);
    body.add(e);
    L.eyes.push({ e, lidT, lidB });
  }

  // ---- arms ----
  const suckMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xcdb8b0, roughness: 0.55, metalness: 0, envMap: envTex, envMapIntensity: 0.4 }));
  L.suckers = new THREE.InstancedMesh(G.suckerGeo(), suckMat, NA * SUCK);
  L.suckers.frustumCulled = false;
  L.suckers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grp.add(L.suckers);
  for (let a = 0; a < NA; a++) {
    const geo = G.armTubeGeo(RINGS, RADIAL);
    const mesh = new THREE.Mesh(geo, skin);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    grp.add(mesh);
    const ang = (a + 0.5) / NA * TAU;
    L.arms.push({
      mesh, geo, ang, pts: Array.from({ length: RINGS + 1 }, () => V3()),
      U: Array.from({ length: RINGS + 1 }, () => V3()), B: Array.from({ length: RINGS + 1 }, () => V3()),
      base: V3(), drape: V3(), tip: V3(), tipGoal: V3(), lift: 0, recoil: 0, lash: 0, phase: a * 1.37,
      r0: Rm * 0.26, len: AL * (0.85 + 0.25 * ((a * 0.618) % 1))
    });
  }

  // ---- wards on the sucker faces of four arms ----
  for (let i = 1; i <= c.nSigils; i++) {
    const w = makeWard(L, i, 3.4);
    w.arm = WARD_ARMS[(i - 1) % WARD_ARMS.length];
    w.s = WARD_S + 0.06 * Math.floor((i - 1) / WARD_ARMS.length);
    w.rev = 0;                                                    // dark until the sonar rings them
    L.sigils.push(w);
  }
  makeEmbers(L, c.size);

  // ---- the lair: wrapped round the broken trawler, the hoard at its heart ----
  const W = wreckSites()[Math.min(idx, 2)];
  const out = V3(W.x, 0, W.z).normalize(), perp = V3(-out.z, 0, out.x);
  L.wreck = V3(W.x, W.y, W.z);
  const lair = V3(W.x, 0, W.z).addScaledVector(out, Rm * 1.4 + 9);
  L.pos.copy(lair);
  L.yaw = Math.atan2(-out.x, -out.z);                             // face the way a diver comes
  const hoardAt = V3(W.x, 0, W.z).addScaledVector(out, -12).addScaledVector(perp, 6);
  L.hoard = makeHoard(L, idx, hoardAt, hoardAt.clone().addScaledVector(out, -110).addScaledVector(perp, 25));
  L.rite = L.hoard;
  L.lairWhere = 'IN THE WRECK';
  L.hoard.onTake = () => { if (L.dormant) wakeHoarder(L); };
  // draped tips: three over and through the wreck, the rest fanned across the silt
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a], wreckArm = a === 1 || a === 3 || a === 5;
    if (wreckArm) {
      A.drape.set(W.x + (Math.random() - 0.5) * 14, 0, W.z + (Math.random() - 0.5) * 14);
    } else {
      const ang = L.yaw + A.ang;
      A.drape.set(lair.x + Math.sin(ang) * A.len * 0.72, 0, lair.z + Math.cos(ang) * A.len * 0.72);
    }
    A.drape.y = terrainH(A.drape.x, A.drape.z, idx) + 0.6;
    A.tip.copy(A.drape);
  }

  L.onSlash = (pos, fwd) => {
    if (!L.grab) return;
    const A = L.arms[L.grab.arm];
    // the cut lands if the blade is anywhere near the arm that holds him
    for (let i = 8; i <= RINGS; i += 4) if (A.pts[i].distanceTo(pos) < A.r0 * 1.2 + 3) {
      L.grab = null; A.recoil = 1; A.lash = 0; L.pendingMsg = L.pendingMsg || 'THE ARM LETS GO.';
      return;
    }
  };
  L.cmd = (name, arg) => {
    if (name === 'stand' || name === 'wake') { if (L.dormant) wakeHoarder(L); }
    else if (name === 'settle') L.riseTarget = 0;
    else if (name === 'place') { L.pos.set(arg.pos.x, 0, arg.pos.z); L.yaw = arg.yaw; }
    else if (name === 'rear') L.lashCd = 0;
    return L.probe();
  };
  L.probe = () => ({
    kind: 'hoarder', dormant: L.dormant, rise: +L.rise.toFixed(2), calmed: L.calmed, grab: L.grab ? L.grab.arm : -1,
    lamp: L.hoard.lampTaken, pos: L.pos.toArray(), bodyY: L.bodyY, reveal: L.reveal,
    wards: L.sigils.map(g => ({ lit: g.lit, rev: +g.rev.toFixed(2) }))
  });

  scene.add(grp);
  setLive(L);
  setWardTargets(-1, null);
  poseHoarder(L, 0, null);
  return L;
}

function wakeHoarder(L) {
  L.dormant = false;
  L.riseTarget = 1;
  L.woke = true;
  L.hoard.darken();
}

// Per-arm shape: a cubic from the crown out to the tip, arched off the body, writhing,
// never through the seabed. Then parallel-transported frames (U = dorsal, B = side) and
// the tube written into the arm's buffer. The sucker face is -U.
function buildArm(L, A, dt) {
  const n = RINGS, P = A.pts;
  // control points: out of the crown, arching up, down to the tip
  _a.copy(A.base);
  _d.copy(A.tip);
  _t.subVectors(_d, _a); const span = _t.length() || 1;
  _b.copy(_a).addScaledVector(_t, 0.30).addScaledVector(UP, L.R * (0.9 + 1.4 * A.lift) + span * 0.10 * (1 - A.lift));
  _c.copy(_a).addScaledVector(_t, 0.72).addScaledVector(UP, L.R * 1.1 * A.lift + span * 0.05);
  const writhe = (0.04 + 0.10 * A.lift) * A.len, wt = L.t * (0.7 + 0.9 * A.lift) + A.phase;
  _w.set(-_t.z, 0, _t.x).normalize();                             // side-to-side
  for (let i = 0; i <= n; i++) {
    const s = i / n, m = 1 - s;
    P[i].set(0, 0, 0)
      .addScaledVector(_a, m * m * m).addScaledVector(_b, 3 * m * m * s)
      .addScaledVector(_c, 3 * m * s * s).addScaledVector(_d, s * s * s);
    const wv = Math.sin(wt - s * 5.5) * writhe * s * s;
    P[i].addScaledVector(_w, wv);
    P[i].y += Math.sin(wt * 0.8 - s * 4.1) * writhe * 0.5 * s * s * A.lift;
    // the tip curls on itself when she is idle
    if (s > 0.8) { const k = (s - 0.8) / 0.2; P[i].y += Math.sin(k * Math.PI) * A.r0 * 0.8 * (0.3 + A.lift); }
    const r = A.r0 * Math.pow(1 - s, 0.85) + 0.12;
    const gy = terrainH(P[i].x, P[i].z, L.idx) + r * 0.85;
    if (P[i].y < gy) P[i].y = gy;
  }
  // frames: dorsal U starts as world up, rolled by the recoil (the flinch bares the suckers)
  for (let i = 0; i <= n; i++) {
    _t.subVectors(P[Math.min(n, i + 1)], P[Math.max(0, i - 1)]).normalize();
    const Ui = A.U[i];
    if (i === 0) Ui.copy(UP); else Ui.copy(A.U[i - 1]);
    Ui.addScaledVector(_t, -Ui.dot(_t)).normalize();
    A.B[i].crossVectors(_t, Ui).normalize();
  }
  const roll = A.recoil * Math.PI * 0.85;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const pos = A.geo.attributes.position.array, nor = A.geo.attributes.normal.array, row = RADIAL + 1;
  for (let i = 0; i <= n; i++) {
    const s = i / n, r = A.r0 * Math.pow(1 - s, 0.85) + 0.12, U = A.U[i], B = A.B[i];
    // apply the roll to this ring's frame
    const ux = U.x * cr + B.x * sr, uy = U.y * cr + B.y * sr, uz = U.z * cr + B.z * sr;
    const bx = B.x * cr - U.x * sr, by = B.y * cr - U.y * sr, bz = B.z * cr - U.z * sr;
    for (let j = 0; j <= RADIAL; j++) {
      const ang = (j % RADIAL) / RADIAL * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
      const flat = ca < 0 ? 0.78 : 1;                              // the sucker face is flatter
      const nx = ux * ca * flat + bx * sa, ny = uy * ca * flat + by * sa, nz = uz * ca * flat + bz * sa;
      const k = (i * row + j) * 3;
      pos[k] = P[i].x + nx * r; pos[k + 1] = P[i].y + ny * r; pos[k + 2] = P[i].z + nz * r;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
    }
    // stash the rolled frame for suckers and wards
    U.set(ux, uy, uz); B.set(bx, by, bz);
  }
  A.geo.attributes.position.needsUpdate = true;
  A.geo.attributes.normal.needsUpdate = true;
}

function poseHoarder(L, dt, player) {
  const b = L.body, R = L.R;
  const gy = terrainH(L.pos.x, L.pos.z, L.idx);
  L.bodyY = gy + R * (0.35 + 0.75 * L.riseE) + R * 0.04 * Math.sin(L.t * 0.35) ;
  b.position.set(L.pos.x, L.bodyY, L.pos.z);
  b.rotation.set(-0.10 * L.riseE + 0.03 * Math.sin(L.t * 0.35), L.yaw, 0);
  // breathing: the sac swells and falls
  const br = 1 + 0.035 * Math.sin(L.t * (L.dormant ? 0.35 : 0.9));
  L.mantle.scale.set(br, 1 + (br - 1) * 1.4, br);
  b.updateMatrixWorld(true);

  // arms
  let si = 0;
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a];
    _p.set(Math.sin(A.ang) * 0.52, -0.42, Math.cos(A.ang) * 0.52 + 0.10).applyMatrix4(b.matrixWorld);
    A.base.copy(_p);
    buildArm(L, A, dt);
    // suckers: two staggered rows on the sucker face (-U) from s 0.12 to 0.9
    for (let k = 0; k < SUCK; k++) {
      const s = 0.12 + 0.78 * k / (SUCK - 1), i = Math.round(s * RINGS);
      const r = A.r0 * Math.pow(1 - s, 0.85) + 0.12, side = (k & 1) ? 0.35 : -0.35;
      _u.copy(A.U[i]).multiplyScalar(-1);
      _p.copy(A.pts[i]).addScaledVector(_u, r * 0.80).addScaledVector(A.B[i], side * r);
      _q.setFromUnitVectors(_yp, _u);
      const sz = r * 0.30;
      L.suckers.setMatrixAt(si++, _m.compose(_p, _q, _s.set(sz, sz, sz)));
    }
  }
  L.suckers.instanceMatrix.needsUpdate = true;

  // wards ride the sucker faces
  for (const g of L.sigils) {
    const A = L.arms[g.arm], i = Math.round(g.s * RINGS), r = A.r0 * Math.pow(1 - g.s, 0.85) + 0.12;
    _u.copy(A.U[i]).multiplyScalar(-1);
    g.grp.position.copy(A.pts[i]).addScaledVector(_u, r * 0.98);
    g.grp.quaternion.setFromUnitVectors(_zp, _u);
  }

  // eyes: lids shut to a slit asleep; open awake. Eyeshine when the lantern faces them.
  const open = L.riseE;
  for (const e of L.eyes) {
    e.lidT.rotation.x = -0.1 - 1.25 * open;
    e.lidB.rotation.x = 0.1 + 1.25 * open;
  }
  let shine = 0;
  if (player) {
    _p.copy(player.pos).sub(L.head);
    const dist = _p.length() || 1;
    b.getWorldDirection(_t);
    shine = Math.pow(Math.max(0, _t.dot(_p) / dist), 3) * (1 - smooth(dist, 25, 100)) * Math.max(0, player.light == null ? 1 : player.light);
  }
  L.eyeMat.emissiveIntensity = (0.05 + 2.0 * shine) * open;
  // the freckles breathe slowly asleep, run brighter and quicker when she is roused
  L.skin.emissiveIntensity = L.calmed ? 0.18 : (0.16 + 0.10 * Math.sin(L.t * (L.dormant ? 0.4 : 1.6))) * (1 + 1.2 * L.riseE);

  // collision centres (the mantle) and the head
  L.spine[0].set(0, 0.35, -0.55).applyMatrix4(b.matrixWorld);
  L.spine[1].set(0, 0.0, 0.2).applyMatrix4(b.matrixWorld);
  L.spine[2].set(0.45, 0.25, -0.35).applyMatrix4(b.matrixWorld);
  L.spine[3].set(-0.45, 0.25, -0.35).applyMatrix4(b.matrixWorld);
  L.head.set(0, 0.25, 0.45).applyMatrix4(b.matrixWorld);
}

export function updateHoarder(L, dt, t, player) {
  const ev = { sigilLit: 0, calmed: false, lightDrain: 0, slam: false, remaining: 0, msg: null };
  if (L.pendingMsg) { ev.msg = L.pendingMsg; L.pendingMsg = null; }
  if (L.woke) { L.woke = false; ev.woke = true; }
  if (!L.pPrev) L.pPrev = player.pos.clone();
  L.t += dt;
  L.hoard.update(dt, player, ev);

  // rise / settle
  const rate = L.riseTarget > L.rise ? 1 / 4 : 1 / 6;
  L.rise += clamp(L.riseTarget - L.rise, -rate * dt, rate * dt);
  L.riseE = smooth(L.rise, 0, 1);

  let pd = 1e9;
  for (const s of L.spine) { const d = s.distanceTo(player.pos); if (d < pd) pd = d; }
  L._pd = pd;
  if (L.dormant && !ev.msg && !L.hoard.found.arms) {
    for (const A of L.arms) if (A.pts[RINGS >> 1].distanceTo(player.pos) < A.r0 + 4) {
      L.hoard.found.arms = true; ev.msg = 'THE CARGO CHAIN IS WARM. IT IS NOT CHAIN.'; break;
    }
  }

  // ---- heading: awake, she turns to him ----
  if (!L.dormant && !L.calmed) {
    const want = Math.atan2(player.pos.x - L.pos.x, player.pos.z - L.pos.z);
    let dA = want - L.yaw;
    while (dA > Math.PI) dA -= TAU;
    while (dA < -Math.PI) dA += TAU;
    L.yaw += clamp(dA, -0.3 * dt, 0.3 * dt);
    // she pours toward him over the silt when he keeps his distance
    if (pd > L.AL * 0.7) {
      const sp = L.speed * 0.18 * dt;
      L.pos.x += Math.sin(L.yaw) * sp; L.pos.z += Math.cos(L.yaw) * sp;
    }
  }

  // ---- arms: drape, writhe, lash, grab, flinch ----
  const lit = player.light > 0.25;
  L.lashCd -= dt;
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a];
    const liftGoal = L.calmed ? 0.15 : L.dormant ? 0 : 1;
    A.lift += clamp(liftGoal - A.lift, -dt * 0.35, dt * (0.25 + 0.05 * a));   // staggered
    // flinch: the lit lantern near the arm's inner third
    const near = A.pts[RINGS >> 2].distanceTo(player.pos);
    const flinch = !L.dormant && !L.calmed && lit && near < 11 ? 1 : 0;
    A.recoil += clamp(flinch - A.recoil, -dt * 0.6, dt * 2.5);
    // tip goal
    if (L.grab && L.grab.arm === a) {
      A.tipGoal.copy(player.pos);
    } else if (A.lash > 0) {
      A.lash -= dt;
      A.tipGoal.copy(player.pos);
      if (A.tip.distanceTo(player.pos) < 3.2 && !L.grab && A.recoil < 0.4) {
        // a grab is the DRAG, not a slam: no dress tear, the line is the teaching
        L.grab = { arm: a, t: 0 };
        ev.grabbed = true;
        ev.msg = ev.msg || 'IT HAS YOU. CUT IT.';
      }
    } else if (L.dormant || L.calmed) {
      A.tipGoal.copy(A.drape);
    } else {
      // awake idle: tips raised and hunting round her, higher when she is roused
      const ang = L.yaw + A.ang + Math.sin(L.t * 0.3 + A.phase) * 0.3;
      const rr = A.len * (0.55 + 0.1 * Math.sin(L.t * 0.5 + A.phase));
      A.tipGoal.set(L.pos.x + Math.sin(ang) * rr, L.bodyY + L.R * (0.8 + 0.8 * Math.sin(L.t * 0.7 + A.phase)) + A.recoil * L.R * 2, L.pos.z + Math.cos(ang) * rr);
    }
    const tipK = (A.lash > 0 || (L.grab && L.grab.arm === a)) ? 5 : 1.2;
    A.tip.lerp(A.tipGoal, Math.min(1, tipK * dt));
  }
  // a new lash: the nearest arm that is not flinching, when he is inside her reach
  if (!L.dormant && !L.calmed && !L.grab && L.lashCd <= 0 && pd < L.AL * 0.85) {
    let best = -1, bd = 1e9;
    for (let a = 0; a < NA; a++) {
      const A = L.arms[a];
      if (A.recoil > 0.4) continue;
      const d = A.tip.distanceTo(player.pos);
      if (d < bd) { bd = d; best = a; }
    }
    if (best >= 0) { L.arms[best].lash = 1.4; L.lashCd = 3 + Math.random() * 2.5; }
  }
  // the grab: dragged toward the beak, light going, until cut or she tires of him
  if (L.grab) {
    L.grab.t += dt;
    _p.copy(L.head).sub(player.pos);
    const d = _p.length() || 1;
    if (d > L.R * 0.9) player.vel.addScaledVector(_p.divideScalar(d), 14 * dt);
    ev.lightDrain += dt * 0.12;
    if (L.grab.t > 5 || L.calmed) { L.arms[L.grab.arm].recoil = 1; L.grab = null; }
  }

  poseHoarder(L, dt, player);

  // contact: the mantle shoves
  if (pd < L.collR) {
    let ni = 0, nd = 1e9;
    for (let k = 0; k < L.spine.length; k++) { const d = L.spine[k].distanceTo(player.pos); if (d < nd) { nd = d; ni = k; } }
    _p.copy(player.pos).sub(L.spine[ni]).normalize();
    player.vel.addScaledVector(_p, 90 * dt * 8);
    ev.slam = true;
  }

  // ---- wards: dark until the sonar rings them (sonarWards), touch when rung ----
  const haloK = L.size * 0.8;
  if (!L.calmed) {
    L.reveal = Math.max(0, L.reveal - dt);
    const revTarget = L.reveal > 0 ? 1 : 0;
    let allLit = true;
    for (let i = 0; i < L.sigils.length; i++) {
      const g = L.sigils[i];
      if (g.lit) { wardLitPose(g, dt, haloK); continue; }
      allLit = false;
      g.rev += clamp(revTarget - g.rev, -dt * 1.2, dt * 5);
      wardIdle(g, dt, haloK);
      if (!L.dormant) wardTouch(L, i, g, player, ev);
    }
    ev.remaining = L.sigils.filter(q => !q.lit).length;
    if (allLit) {
      L.calmed = true; L.calmT = 0; ev.calmed = true; L.grab = null;
      L.riseTarget = 0.25;                                           // she coils back round the wreck
    }
  } else {
    L.calmT += dt;
    // THE LIGHTHOUSE: her wards stay burning in the dark zone
    for (const g of L.sigils) {
      g.pulse += dt;
      g.light.intensity = Math.max(55, 120 - L.calmT * 8) + 6 * Math.sin(g.pulse * 1.3);
      g.light.position.copy(g.grp.position);
      g.halo.position.copy(g.grp.position);
      g.halo.scale.setScalar(haloK * 2.4);
      g.rune.material.opacity = 0.9;
    }
  }
  wardFlashes(L, dt, null);
  L.pPrev.copy(player.pos);
  return ev;
}
