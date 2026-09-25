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
import { makeGlow, seededRand } from '../../lib/textures.js';
import { registerPaint } from '../../lib/paint.js';
import { terrainH } from '../../world/terrain.js';
import { setWardTargets } from '../../world/predators.js';
import {
  setLive, SIGIL_POOL_N, ensureSigilPool, makeWard, wardIdle, wardLitPose, wardTouch, wardFlashes, makeEmbers, lightWard
} from './common.js';
import * as G from './brooderGeo.js';
import { makeBrood } from './brood.js';
import { riftPos } from '../../config.js';
import { emitDust } from '../../world/footfx.js';

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
const STRIDE = 0.30, SWING_T = 0.55, RISE_T = 6, SETTLE_T = 4;

// Scratch (never allocated per frame).
const _hip = V3(), _d = V3(), _pn = V3(), _j1 = V3(), _ank = V3(), _ank2 = V3(), _knee = V3(), _ft = V3(), _v = V3();
const _x = V3(), _y = V3(), _z = V3(), _sc = V3(), _r = V3(), _rw = V3(), _lp = V3(), _pl = V3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qs = new THREE.Quaternion();
const _col = new THREE.Color();

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
  const shell = new THREE.Mesh(G.carapaceGeo(), shellMat);
  shell.castShadow = shell.receiveShadow = true;
  body.add(shell);
  const belly = new THREE.Mesh(G.bellyGeo(), bellyMat);
  belly.castShadow = belly.receiveShadow = true;
  body.add(belly);

  // ---- crust: barnacles and weed ----
  const bar = G.barnacleMatrices(36, 0xBA2AC1E5 + idx);
  const barnMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 0.86, normalMap: grain, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0, side: THREE.DoubleSide, envMap: envTex, envMapIntensity: 0.25 }));
  const barn = new THREE.InstancedMesh(G.barnacleGeo(), barnMat, bar.m.length);
  bar.m.forEach((m, i) => { barn.setMatrixAt(i, m); barn.setColorAt(i, bar.c[i]); });
  barn.instanceMatrix.needsUpdate = true;
  if (barn.instanceColor) barn.instanceColor.needsUpdate = true;
  barn.castShadow = true;
  body.add(barn);

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
  for (let li = 0; li < 8; li++) {
    const sd = li < 4 ? 1 : -1, k = li & 3;
    L.feet.push({ planted: V3(), from: V3(), to: V3(), cur: V3(), t: -1, group: (k + (sd > 0 ? 0 : 1)) & 1 });
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

  // THE RIDGE: she sleeps at this zone's rift, facing the open seabed the diver comes
  // from, a reef-crusted mound in the silt. Her nest lies in her lee, and a trail of
  // tracks runs to it from the open ground past the shells of an old clutch. Taking an
  // egg wakes her (brood.onTake); calmed, she walks back and settles over her brood,
  // which clears the way.
  {
    const rp = riftPos(idx), out = V3(rp.x, 0, rp.z).normalize(), perp = V3(-out.z, 0, out.x);
    // on the rift's LIP (its bowl is a deep funnel — sat in it she was a hole, not a
    // ridge), between the rift and the open ground, facing the way a diver comes
    const lip = V3(rp.x, 0, rp.z).addScaledVector(out, -(16 * 2.7 + R * 0.55));
    placeAt(L, lip, Math.atan2(-out.x, -out.z));
    const nest = lip.clone().addScaledVector(perp, R * 2.8);
    L.brood = makeBrood(L, idx, nest, nest.clone().addScaledVector(out, -95));
    L.rite = L.brood;                                 // the game's generic [E] / prompt hook
    L.lairWhere = 'BY THE RIFT';
    L.dormant = true;
    L.brood.onTake = () => { if (L.dormant) wakeBrooder(L); };
  }

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
    kind: 'brooder', dormant: !!L.dormant, eggsOut: L.brood ? L.brood.out() : 0, held: L.brood ? L.brood.held : -1, stand: L.stand, threat: L.threat, yaw: L.yaw, pos: L.pos.toArray(), bodyY: L.bodyY,
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
  return { root, cj, pj, dj, sd, major: k >= 1 };
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
  for (let li = 0; li < 8; li++) {
    const f = L.feet[li];
    restWorld(L, li, f.planted);
    f.cur.copy(f.planted); f.t = -1;
  }
}

// Rest spot of foot li: local (yaw only) -> world, on the terrain.
function restWorld(L, li, out) {
  const lg = LEGS[li & 3], sd = li < 4 ? 1 : -1, st = L.standE;
  // asleep the legs fold UNDER the shell: a ridge, not a crab
  const reach = lerp(0.80, 1.02, st) * lg.k, a = lg.splay * lerp(1.15, 0.85, st);
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

// Arm pose, after the reference: a forward guard — upper arms reaching ahead under the
// prow, forearms turned in, the hooked pincers hanging open-mouthed before her face.
// Threat lifts both hands to the height of her brow and gapes them wide.
function poseClaws(L) {
  const th = L.threatE, t = L.t, st = L.standE;
  for (const c of L.claws) {
    const sd = c.sd;
    const tr = 0.025 * Math.sin(t * 2.3 + sd * 2.1) * Math.sin(t * 0.61) * st;     // never quite still
    const snap = Math.pow(Math.max(0, Math.sin(t * 0.7 + sd * 1.3)), 8) * 0.12 * st;
    if (c.major) {
      // the strike: the great claw comes up to head height and gapes, cocked to swing
      // ...and every couple of seconds it comes DOWN: a hammer blow across her front
      const sw = L.swing * th;
      c.root.rotation.set(0, -Math.PI / 2 + sd * lerp(0.22, 0.45, th) - sd * 0.25 * sw, lerp(-0.30 - 0.25 * (1 - st), 0.40, th) - 0.85 * sw + tr);
      c.cj.rotation.set(0, -sd * lerp(0.95, 0.40, th), lerp(0.30, 0.30, th) - 0.25 * sw);
      c.pj.rotation.set(0, -sd * lerp(0.45, 0.15, th), lerp(-0.55, -0.30, th) + 0.2 * sw + tr);
      c.dj.rotation.z = 0.10 + snap + 1.00 * th * (1 - 0.9 * sw);
    } else {
      // the minor stays low and close, a guard across the mouth, working
      c.root.rotation.set(0, -Math.PI / 2 + sd * lerp(0.22, 0.12, th), lerp(-0.30 - 0.25 * (1 - st), -0.25, th) + tr);
      c.cj.rotation.set(0, -sd * lerp(0.95, 1.20, th), 0.30);
      c.pj.rotation.set(0, -sd * 0.45, -0.55 + tr);
      c.dj.rotation.z = 0.10 + snap + 0.35 * th + 0.25 * Math.max(0, Math.sin(t * 3.1)) * th;
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
  L.bodyY = gy + R * (lerp(0.06, 0.44, st) + 0.10 * L.threatE + 0.012 * Math.sin(L.t * 0.45) * (1 - st));
  b.position.set(L.pos.x, L.bodyY, L.pos.z);
  // hunched: standing, the front drops over the diver; threat lifts it to show the face
  b.rotation.set(-Math.atan2(gF - gB, 2 * o) + 0.06 * st + 0.12 * L.threatE, L.yaw, Math.atan2(gL - gR, 2 * o));
  b.updateMatrixWorld(true);
  _inv.copy(b.matrixWorld).invert();

  for (let li = 0; li < 8; li++) poseLeg(L, li, _lp.copy(L.feet[li].cur).applyMatrix4(_inv));
  for (const k in L.legs) L.legs[k].instanceMatrix.needsUpdate = true;
  poseClaws(L);

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
  L.eyeMat.emissiveIntensity = 0.08 * st + 2.2 * shine * (0.35 + 0.65 * st);
  // the mouthparts: five pairs working out of phase, faster when roused
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
  if (L.woke) { L.woke = false; ev.woke = true; }
  if (L.riseDust > 0) {
    // silt pours off her back as she rises
    L.riseDust -= dt;
    L.dustT = (L.dustT || 0) - dt;
    if (L.dustT <= 0) {
      L.dustT = 0.08;
      const a = Math.random() * Math.PI * 2, r = L.R * (0.7 + 0.4 * Math.random());
      const x = L.pos.x + Math.cos(a) * r, z = L.pos.z + Math.sin(a) * r;
      emitDust(x, L.bodyY - L.R * 0.05, z, 16, 2.5);
    }
  }
  if (L.brood) {
    L.brood.update(dt, player, ev);
    if (L.dormant && !ev.msg && !L.brood.found.ridge && L._pd < L.R * 1.3) { L.brood.found.ridge = true; ev.msg = 'THE RIDGE IS WARM UNDER YOUR HAND.'; }
  }
  if (!L.pPrev) L.pPrev = player.pos.clone();
  L.t += dt;
  L.uni.uTime.value = L.t;

  // ---- stand / threat easing: she takes ~6 s to rise and ~4 s to settle ----
  const rate = L.standTarget > L.stand ? 1 / RISE_T : 1 / SETTLE_T;
  L.stand += clamp(L.standTarget - L.stand, -rate * dt, rate * dt);
  L.standE = smooth(L.stand, 0, 1);
  // she rears on her own when the diver comes close (the lab's hold/rear override it)
  if (!L.hold && !L.calmed && !L.dormant) L.threatTarget = L.standE > 0.9 && L._pd < L.R * 2.4 ? 1 : 0;
  // the hammer cycle: a slow wind-up, a fast fall (only means anything in threat)
  L.swingT = (L.swingT || 0) + dt;
  { const ph = (L.swingT % 2.6) / 2.6; L.swing = ph < 0.8 ? 0 : Math.sin((ph - 0.8) / 0.2 * Math.PI); }
  L.threat += clamp(L.threatTarget - L.threat, -1.5 * dt, 1.5 * dt);
  L.threatE = smooth(L.threat, 0, 1) * L.standE;

  // ---- heading and locomotion ----
  let pd = 1e9;
  for (const s of L.spine) { const d = s.distanceTo(player.pos); if (d < pd) pd = d; }
  L._pd = pd;
  let want = null, speed = 0;
  if (L.walkTo && L.standE > 0.9) {
    const dx = L.walkTo.x - L.pos.x, dz = L.walkTo.z - L.pos.z, dist = Math.hypot(dx, dz);
    if (dist < (L.toNest ? 3 : L.R * 1.9)) {            // stop with the claws short of the target
      L.walkTo = null;
      if (L.toNest) { L.toNest = false; L.standTarget = 0; }  // home: settle over the brood
    }
    else { want = Math.atan2(dx, dz); speed = L.speed * 0.30; }
  } else if (!L.calmed && !L.hold && !L.dormant && L.standE > 0.5 && pd < 90) {
    want = Math.atan2(player.pos.x - L.pos.x, player.pos.z - L.pos.z);
  }
  if (want !== null) {
    let dA = want - L.yaw;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    L.yaw += clamp(dA, -0.35 * dt, 0.35 * dt);
    if (Math.abs(dA) > 0.6) speed *= 0.2;                // turn on the spot before striding off
  }
  let vx = Math.sin(L.yaw) * speed, vz = Math.cos(L.yaw) * speed;
  // STALK: awake and not yet striking, she circles the diver crab-fashion — sideways,
  // face locked on him — and changes direction every few seconds.
  if (!L.walkTo && !L.calmed && !L.hold && !L.dormant && L.standE > 0.9 && L.threatE < 0.5 && pd > L.R * 1.4 && pd < L.R * 5) {
    L.strafeT = (L.strafeT || 0) - dt;
    if (L.strafeT <= 0) { L.strafeT = 4 + Math.random() * 4; L.strafeDir = Math.random() < 0.5 ? -1 : 1; }
    const ss = L.speed * 0.22 * L.strafeDir;
    vx += Math.cos(L.yaw) * ss; vz -= Math.sin(L.yaw) * ss;
  }
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
      if (f.t >= 1) { f.t = -1; f.planted.copy(f.to); f.cur.copy(f.to); emitDust(f.cur.x, f.cur.y, f.cur.z, 10, 1.6); }
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
  // the hammer: at the bottom of the swing, anything under the great claw's fingers
  L.strikeCd = Math.max(0, (L.strikeCd || 0) - dt);
  if (!L.calmed && L.threatE > 0.8 && L.swing > 0.85 && L.strikeCd <= 0) {
    const c = L.claws[1].major ? L.claws[1] : L.claws[0];
    c.dj.getWorldPosition(_ft);
    if (_ft.distanceTo(player.pos) < L.R * 0.42) {
      _v.copy(player.pos).sub(_ft).setY(0.4).normalize();
      player.vel.addScaledVector(_v, 38);
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
      if (g.lit) wardLitPose(g, dt, haloK);
      else {
        allLit = false;
        // a sleeping Brooder's wards are in the sand: no glow, no light until she rises
        g.rev = L.standE;
        wardIdle(g, dt, haloK);
        // buried wards can sit within reach of her face through the sand: only a
        // standing Brooder offers them
        if (L.standE > 0.6) {
          // THE BROOD RULE: her last ward will not light while any egg is out of the
          // nest; with the clutch whole again it lights on its own.
          const last = L.sigils.filter(q => !q.lit).length === 1;
          if (last && L.brood && L.brood.out() > 0) {
            if (g.grp.position.distanceTo(player.pos) < L.reach * 1.2 && !L.broodHint) {
              L.broodHint = true;
              ev.msg = ev.msg || 'THE LAST WARD IS COLD. SHE WILL NOT STILL WHILE HER BROOD IS OUT.';
            }
          } else if (last && L.brood && L.sigils.length > 1 && !ev.sigilLit) {
            lightWard(L, g, ev);
          } else wardTouch(L, i, g, player, ev);
        }
      }
    }
    ev.remaining = L.sigils.filter(q => !q.lit).length;
    if (allLit) {
      L.calmed = true; L.calmT = 0; ev.calmed = true; L.threatTarget = 0;
      // she goes home: back to the nest to settle over her brood, off the rift
      if (L.brood) { L.walkTo = L.brood.nest.clone(); L.toNest = true; L.standTarget = 1; }
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
  wardFlashes(L, dt, null);
  L.pPrev.copy(player.pos);
  return ev;
}
