// ORUNE, THE HOARDER — zone 1's sleeper (roadmap/three-sleepers.md, spec §2).
// An octopus-like colossus: a warty chromatophore mantle-sac behind a head with raised
// eye turrets (gold irises, horizontal slit pupils, eyeshine when the lantern finds
// them), and eight arms of ~37 u, pale-suckered underneath, rebuilt on the CPU as
// world-space tubes every frame. The arm's LOGIC spine is 41 points (pts/U/B: lash, grab,
// the knife, wards and suckers all read it, unchanged); the RENDER tube is 129 rings x 28
// sides Catmull-Rom'd off it, with a flattened oral face, a dorsal ridge, longitudinal
// skin folds and transverse wrinkles that bunch on the inside of every bend
// (polish-sleepers2).
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
import { scene, camera, envTexDeep as envTex } from '../../core.js';
import { V3, clamp, lerp } from '../../lib/math.js';
import { registerPaint } from '../../lib/paint.js';
import { terrainH } from '../../world/terrain.js';
import { setWardTargets, deployInk } from '../../world/predators.js';
import { wreckSites } from '../../world/wrecks.js';
import {
  setLive, SIGIL_POOL_N, ensureSigilPool, sigilPool, makeWard, wardIdle, wardLitPose, wardTouch, wardFlashes, makeEmbers
} from './common.js';
import * as G from './hoarderGeo.js';
import { makeHoard } from './hoard.js';
import { emitDust } from '../../world/footfx.js';
import { loadSculpted, assetTextures, assetGeos } from '../../lib/assets.js';

// THE SCULPT (tools/blender pipeline; hoarderSculpt.js has the design). THE SPLIT, and why:
//   RIGID or SHADER-MOVED -> sculpted, baked high-to-low: the mantle + head + web + beak +
//     siphon (breath is a uniform scale of the mesh; the siphon pulse is a vertex bump keyed
//     on SIPHON, which the sculpt keeps), both lids (rigid rotations), and ONE sucker,
//     instanced 288x. Measured: the mantle was a 24.6k-tri deformed sphere + a 1024^2
//     runtime JS skin bake; it is now a 60k-tri decimated sculpt with a 2048 Cycles bake.
//   DEFORMING -> stays procedural: the eight arms are 41-point verlet chains with a curl
//     wave, a wrap helix and a base-first flinch roll, rebuilt as 129 x 28 tubes per frame.
//     No rigid or skinned mesh survives that (a curl rolls the section through 180 degrees
//     in a few rings). Their sculpt is a TILEABLE STRIP (strip.mjs: a heightfield over the
//     tube's own (u, v)), whose u is keyed to the sucker stations so every baked socket sits
//     under its instanced sucker whatever the chain does. The motion code is untouched.
// Loaded off the boot's critical path (a short idle delay after import); makeHoarder
// installs it if it has landed and otherwise upgrades the procedural Orune in place when it
// does. A failed load leaves the procedural build — nothing else changes.
let SCULPT = null, SC = null, LANTERN_GEO = null;
function sculpt() {
  if (!SCULPT) { SCULPT = loadSculpted('assets/sleepers/hoarder/', 'hoarder'); SCULPT.then(a => { SC = a; }); }
  return SCULPT;
}
if (typeof window !== 'undefined') setTimeout(sculpt, 2500);

const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;
const RM_OF_SIZE = 0.95, ARM_OF_SIZE = 5.0, NA = 8, RINGS = 40, RR = 128, RAD = 28, SUCK = 36;
const WARD_ARMS = [0, 2, 4, 6], WARD_S = 0.22;
// Her own light: a cold, pale, sea-green phosphor (period-correct foxfire, never violet),
// and the hoard's warm lamp-flame she lies among.
const ORUNE_PHOTO = 0x8fb49a, FLAME = 0xff8e3c, WARD_COL = 0xffe8a8;
const UP = V3(0, 1, 0);

const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _t = V3(), _u = V3(), _w = V3(), _p = V3(), _q = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _s = V3(), _zp = V3(0, 0, 1), _yp = V3(0, 1, 0), _mi = new THREE.Matrix4(), _l = V3();
// ---- MOTION (anim-sleepers) ----------------------------------------------------------
// An octopus arm is a muscular hydrostat, not a rope on a spline. Each arm is now:
//   the old cubic toward its tip goal (the intent), then a CURL integrated down the distal
//   half toward the sucker face, its curvature a wave travelling base to tip (so the tips
//   coil, uncoil and are never still), then a verlet chain pulled toward that shape, stiff
//   at the root and loose at the tip (so the arm has follow-through and drag).
//   The tip goal is a damped spring: idle it drifts, a LASH cocks back and coils first
//   (0.35 s of the old 1.4 s window, a telegraph) then strikes; a GRAB wraps the distal
//   arm round the diver in a tightening helix; a FLINCH rolls the arm base-first (the roll
//   runs down it) and coils it away from the light.
// Her eyes track the diver in saccades, the mantle breathes on an exhale/inhale curve with
// the siphon puffing silt when she lies on the floor, and the skin carries PASSING CLOUDS
// (dark chromatophore bands sweeping the body, the photophores flaring in their wake)
// whose speed and depth are her mood.
const EVO = { sigilLit: 0, calmed: false, lightDrain: 0, slam: false, remaining: 0, msg: null, woke: false, grabbed: false, quake: 0, inkDim: 0 };
const LASH_T = 1.4, COCK_T = 0.35;
const nzO = (t, s) => 0.6 * Math.sin(t * 1.13 + s * 1.7) * Math.sin(t * 0.71 + s * 3.1) + 0.4 * Math.sin(t * 2.37 + s * 5.3);
function sprO(o, target, w, z, dt) {
  o.v = (o.v + w * w * dt * (target - o.x)) / (1 + 2 * z * w * dt + w * w * dt * dt);
  o.x += o.v * dt;
  return o.x;
}
const _e1 = V3(), _e2 = V3(), _tg = V3(), _dv = V3();
// the body's geometries carry aArmP = 0 explicitly (never trust a driver's default for a
// missing attribute)
function bodyArmP(g) { if (g && !g.attributes.aArmP) g.setAttribute('aArmP', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1)); return g; }
const SIPHON = V3(-0.80, -0.36, 0.44);

// ---- the arm's cross-section (unit), per side vertex: dorsal U at a = 0, the oral face
// at a = PI flattened to ~0.76 with a shallow furrow down its middle, a dorsal ridge, and
// a little width toward the face. Static tables; the per-frame work is folds + wrinkles.
function section(a, out) {
  const ca = Math.cos(a), sa = Math.sin(a);
  let y = ca, x = sa * 1.03;
  // a soft flattening (no crease at the flanks): the oral face sits at ~0.85
  const fl = G.sst(-0.1, -0.9, ca);
  y = ca * (1 - 0.15 * fl);
  x *= 1 + 0.04 * fl;
  if (ca > 0) y += 0.07 * Math.exp(-(sa / 0.28) * (sa / 0.28));
  if (ca < -0.5) y += 0.035 * Math.exp(-(sa / 0.10) * (sa / 0.10));
  out[0] = x; out[1] = y;
  return out;
}
const SEC_X = new Float32Array(RAD + 1), SEC_Y = new Float32Array(RAD + 1), SEC_PALE = new Float32Array(RAD + 1);
(() => { const o = [0, 0]; for (let j = 0; j <= RAD; j++) { const a = (j % RAD) / RAD * TAU; section(a, o); SEC_X[j] = o[0]; SEC_Y[j] = o[1]; SEC_PALE[j] = G.sst(-0.2, -0.7, Math.cos(a)); } })();
const SUCK_SIDE = 0.35, SUCK_DEPTH = (() => { const o = section(Math.PI - Math.asin(SUCK_SIDE), [0, 0]); return -o[1]; })();
// Catmull-Rom weights from the 41-point logic spine to the render rings (static)
const CR_I = new Int16Array(RR + 1), CR_W = new Float32Array((RR + 1) * 4);
(() => {
  for (let f = 0; f <= RR; f++) {
    const x = f / RR * RINGS, i0 = Math.min(RINGS - 1, Math.floor(x)), t = x - i0, t2 = t * t, t3 = t2 * t;
    CR_I[f] = i0;
    CR_W[f * 4] = 0.5 * (-t + 2 * t2 - t3); CR_W[f * 4 + 1] = 0.5 * (2 - 5 * t2 + 3 * t3);
    CR_W[f * 4 + 2] = 0.5 * (t + 4 * t2 - 3 * t3); CR_W[f * 4 + 3] = 0.5 * (-t2 + t3);
  }
})();
// transverse wrinkle phase per render ring: soft ridges between sharp creases
const WRINK = new Float32Array(RR + 1);
for (let f = 0; f <= RR; f++) WRINK[f] = Math.pow(0.5 + 0.5 * Math.cos(f * Math.PI * 0.46), 2);

// THE BEAK (menace): the sculpt's beak is small and buried in the web; this one is the
// working beak a grabbed diver is dragged toward. Two hooked mandibles of dark horn, swept
// along curves (taper to a point, flattened side to side), hinged at the buccal ring. In
// the body's unit frame, mouth at (0, -0.44, 0.12); it everts down and out when she feeds.
function hookGeo(pts, r0, r1, flat, n = 20, rad = 10) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  const P = c.getSpacedPoints(n), pos = [], col = [], idx = [];
  const t = new THREE.Vector3(), u = new THREE.Vector3(), b = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    c.getTangentAt(Math.min(0.999, s), t);
    b.crossVectors(t, X).normalize(); u.crossVectors(b, t).normalize();
    // u is ~x (side), b is in the y-z plane; the keel (the cutting edge) is sharp on -b
    const r = r0 + (r1 - r0) * Math.pow(s, 0.8);
    for (let j = 0; j <= rad; j++) {
      const a = j / rad * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const keel = sa < 0 ? 1 + 0.6 * (-sa) * (-sa) : 1;
      const p = P[i];
      pos.push(p.x + u.x * ca * r * flat + b.x * sa * r * keel, p.y + u.y * ca * r * flat + b.y * sa * r * keel, p.z + u.z * ca * r * flat + b.z * sa * r * keel);
      // horn: near-black at the root, paling to a worn amber at the edges and the point
      const e = Math.min(1, s * s * 1.2 + (sa < -0.6 ? 0.35 : 0));
      col.push(0.08 + 0.30 * e, 0.06 + 0.20 * e, 0.05 + 0.10 * e);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, d = a + rad + 1;
    idx.push(a, d, a + 1, a + 1, d, d + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function makeBeak(L) {
  const m = registerPaint(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.28, metalness: 0, envMap: envTex, envMapIntensity: 0.9 }));
  const grp = new THREE.Group();
  grp.position.set(0, -0.44, 0.14);
  // upper mandible: deep, hooked down and forward to a point (the rostrum)
  const up = new THREE.Mesh(hookGeo([[0, 0.06, -0.10], [0, 0.04, 0.05], [0, -0.06, 0.14], [0, -0.17, 0.12], [0, -0.21, 0.05]], 0.085, 0.004, 0.62), m);
  // lower mandible: shorter, set behind, its edge rising to meet the hook
  const lo = new THREE.Mesh(hookGeo([[0, 0.02, -0.12], [0, -0.07, -0.08], [0, -0.13, 0.00], [0, -0.12, 0.06]], 0.07, 0.006, 0.7), m);
  const hu = new THREE.Group(), hl = new THREE.Group();
  hu.add(up); hl.add(lo);
  grp.add(hu, hl);
  grp.scale.setScalar(1.25);
  L.body.add(grp);
  L.beak = { grp, hu, hl, open: 0, ev: 0, ph: 0, snapN: 0 };
}

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
    yawV: 0, crawl: 0, blinkT: 9, blinkN: 3, look: { y: { x: 0, v: 0 }, p: { x: 0, v: 0 }, ty: 0, tp: 0, next: 0 }, brPh: 0, cloudPh: 0, mood: 0, armsInit: false,
    pos: V3(), yaw: 0, bodyY: 0, head: V3(), spine: [V3(), V3(), V3(), V3()], sigils: [], arms: [],
    grab: null, lashCd: 3, _pd: 1e9, suckK: 0.27, suckSink: 0, hideK: 1, lidK: 1.25, lidKb: 1.25, sculpted: false,
    sigilStyle: true, webK: 0.35, webSeats: null, clutch: [], stage: null,
    // menace (orune-menace): display state, the reveal, the freeze, circling, ink, probes,
    // and edge counters the audio watches (creepN, popN, stillN, cockN, inkN, beak.snapN)
    aware: 0, pap: 0, dark: 0, web: 0, pupil: 0, puff: 0, loomE: 0, rearE: 0, deimT: 9, deimK: 0, shine: 0,
    revealT: -1, still: 0, writheK: 1, circleT: 0, circleCd: 0, circleDir: 1, behindNext: false,
    inkT: -1, inkCd: 0, inkedT: 0, glareT: 0, inkSaid: false, peekCd: 0,
    probeT: 0, probeArm: [-1, -1], probeAng: [0, 0], probeRot: 0, moveK: 0,
    creepN: 0, creepAt: V3(), popN: 0, popAt: V3(), stillN: 0, cockN: 0, inkN: 0
  };

  // ---- skin ----
  const sk = G.skinMaps(), em = G.eyeMaps();
  L.keepTex = new Set([sk.map, sk.normalMap, sk.roughnessMap, sk.emissiveMap, em.map, em.emissiveMap]);
  // wet chromatophore skin: roughness from the map (glossy seams, drier papilla tips),
  // a lit Fresnel sheen and iridophore flecks at grazing angles (G.wetSkin, one program)
  const skin = registerPaint(G.wetSkin(new THREE.MeshStandardMaterial({
    map: sk.map, normalMap: sk.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: sk.roughnessMap, vertexColors: true,
    roughness: 1.55, metalness: 0, envMap: envTex, envMapIntensity: 0.28,
    // her photophores: a cold pale sea-green, faint (encounter pass: they were violet-blue
    // 0x6b58d8 at 0.25-0.57 and read as neon specks; the hoard's lanterns now show her size)
    emissive: ORUNE_PHOTO, emissiveMap: sk.emissiveMap, emissiveIntensity: 0.08
  }), 'abyssa-orune-skin', 1, true));
  L.skin = skin;
  // passing clouds (chromatophores) and the siphon's pulse, patched over wetSkin
  L.cloudU = { uCloud: { value: new THREE.Vector4(0, 0.25, 0.4, 0.5) }, uSiph: { value: 0 },
    uMen: { value: new THREE.Vector4(0, 0, 0, 0) }, uTell: { value: [0, 0, 0, 0, 0, 0, 0, 0, 0] }, uRm: { value: Rm } };
  cloudPatch(skin, L, 'abyssa-orune-skin-m', false);
  // one program for all of her skin: the mantle's biplanar blend is carried by attributes
  // (uvB, wB) that every other skin geometry sets to its own UV with weight 0
  L.skinM = skin;
  const mantle = new THREE.Mesh(bodyArmP(G.mantleGeo()), skin);
  mantle.castShadow = mantle.receiveShadow = true;
  body.add(mantle);
  L.mantle = mantle;

  // ---- eyes: gold, slit-pupilled, shut to slits asleep; eyeshine when the lantern finds them ----
  const eyeMat = G.wetEye(new THREE.MeshStandardMaterial({ map: em.map, roughness: 0.04, metalness: 0.1, envMap: envTex, envMapIntensity: 1.8,
    emissive: 0xd9b24a, emissiveMap: em.emissiveMap, emissiveIntensity: 0 }));
  const ballG = G.eyeBallGeo(0.16), lidTG = bodyArmP(G.lidGeo(0.178, false)), lidBG = bodyArmP(G.lidGeo(0.178, true));
  L.eyeMat = eyeMat;
  // THE PUPIL (menace): the bar holds level and narrow while she watches; in the deimatic
  // display and the hunt it BLOWS near round (a dilated pupil reads as a bigger animal).
  L.pupU = { value: 0 };
  {
    const ob = eyeMat.onBeforeCompile;
    eyeMat.customProgramCacheKey = () => 'abyssa-orune-eye';
    eyeMat.onBeforeCompile = (sh, r) => {
      ob(sh, r);
      sh.uniforms.uPup = L.pupU;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uPup;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec2 oPq = vMapUv * 2.0 - 1.0;
          float oHw = mix(0.46, 0.60, uPup), oHh = mix(0.085, 0.50, uPup) * (1.0 - 0.5 * min(1.0, (oPq.x / oHw) * (oPq.x / oHw)));
          float oPin = 1.0 - smoothstep(-0.03, 0.0, max(abs(oPq.x) - oHw, abs(oPq.y) - oHh));
          oPin *= step(0.002, uPup);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.006), oPin);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 - oPin;');
    };
  }
  const lidMat = skin;
  L.eyes = [];
  for (const sd of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(G.EYE_AT[0] * sd, G.EYE_AT[1] + 0.02, G.EYE_AT[2]);
    e.rotation.y = sd * 0.75;                                     // look out and forward
    const ball = new THREE.Mesh(ballG, eyeMat);
    e.add(ball);
    const lidT = new THREE.Mesh(lidTG, lidMat);
    const lidB = new THREE.Mesh(lidBG, lidMat);
    e.add(lidT, lidB);
    body.add(e);
    L.eyes.push({ e, lidT, lidB, ball, sd, yaw0: sd * 0.75, peek: 0, eo: 0 });
  }

  makeBeak(L);

  // ---- arms ----
  // stalked cups: pale rolled rim, pink cup, dark centre (vertex colour), wet
  const suckMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xd8b4a8, vertexColors: true, roughness: 0.42, metalness: 0, envMap: envTex, envMapIntensity: 0.35 }));
  L.suckers = new THREE.InstancedMesh(G.suckerGeo(), suckMat, NA * SUCK);
  L.suckBase = suckMat.color.clone();
  L.suckers.frustumCulled = false;
  L.suckers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grp.add(L.suckers);
  for (let a = 0; a < NA; a++) {
    const geo = G.armTubeGeo(RR, RAD);
    {
      // which arm, and how far along it (the menace patch's per-arm tell and tip mask)
      const ap = new Float32Array((RR + 1) * (RAD + 1));
      for (let f = 0; f <= RR; f++) for (let j = 0; j <= RAD; j++) ap[f * (RAD + 1) + j] = a + 1 + 0.98 * f / RR;
      geo.setAttribute('aArmP', new THREE.BufferAttribute(ap, 1));
    }
    const mesh = new THREE.Mesh(geo, skin);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    grp.add(mesh);
    const ang = (a + 0.5) / NA * TAU;
    L.arms.push({
      mesh, geo, ang, pts: Array.from({ length: RINGS + 1 }, () => V3()),
      U: Array.from({ length: RINGS + 1 }, () => V3()), B: Array.from({ length: RINGS + 1 }, () => V3()),
      base: V3(), drape: V3(), tip: V3(), tipGoal: V3(), lift: 0, recoil: 0, lash: 0, phase: a * 1.37,
      tipV: V3(), tgt: Array.from({ length: RINGS + 1 }, () => V3()), prv: Array.from({ length: RINGS + 1 }, () => V3()), wrap: 0, curl: 10,
      r0: Rm * 0.26, len: AL * (0.85 + 0.25 * ((a * 0.618) % 1)),
      // render-tube state (polish-sleepers2)
      Pf: new Float32Array((RR + 1) * 3), Uf: new Float32Array((RR + 1) * 3), Bf: new Float32Array((RR + 1) * 3),
      Ka: new Float32Array(RR + 1), Kd: new Float32Array((RR + 1) * 3), rf: new Float32Array(RR + 1), fold: new Float32Array((RR + 1) * (RAD + 1)),
      suckS: new Float32Array(SUCK),
      // menace: the asleep resettle, the probe's silt, the lash's tell
      creep: V3(), creepT: 2 + a * 0.7, creepMove: 0, dustT: 0, tell: 0, cockT: COCK_T, fast: false, strikeN: 0
    });
    const A = L.arms[a];
    for (let f = 0; f <= RR; f++) {
      const s = f / RR;
      A.rf[f] = A.r0 * Math.pow(1 - s, 0.85) + 0.12;
      for (let j = 0; j <= RAD; j++) {
        const an = (j % RAD) / RAD * TAU;
        A.fold[f * (RAD + 1) + j] = 0.024 * Math.sin(an * 7 + s * 9 + A.phase * 2.3) * (1 - SEC_PALE[j]) * (0.6 + 0.4 * Math.sin(s * 23 + an * 2));
      }
    }
    // sucker stations: spaced by the local radius, so they crowd and shrink to the tip.
    // (sculpt pass: the search used to overshoot s = 1, where pow() of a negative base is
    // NaN, and NaN > 0.95 is false — so it ran up to its bound of 4 radii a step: 11 of the
    // 36 suckers landed on the arm and the other 25 were NaN matrices. Clamped, it finds the
    // intended ~1.04 and all 36 sit between s = 0.05 and 0.95.)
    const rs = s => (A.r0 * Math.pow(Math.max(0, 1 - s), 0.85) + 0.12);
    let lo = 0, hi = 4;
    for (let it = 0; it < 30; it++) {
      const c2 = (lo + hi) / 2; let s = 0.05;
      for (let k = 1; k < SUCK; k++) s += c2 * rs(s) / A.len;
      if (!(s <= 0.95)) hi = c2; else lo = c2;
    }
    let s = 0.05;
    for (let k = 0; k < SUCK; k++) { A.suckS[k] = s; s += lo * rs(s) / A.len; }
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
  // draped tips: three over and through the wreck, the rest fanned across the silt.
  // A sleeping arm lies DOWNHILL of nothing: it is a hundred-weight of muscle at rest,
  // so it goes where the ground lets it lie. The fan bearing is searched (its own
  // bearing first, then swung either way) for the longest reach whose ground never
  // climbs faster than a sprawled arm could lie on (rise <= 0.30 x run, 17 degrees, and
  // never more than 6 u over the lair floor). The old fixed 0.72 x len put one tip 38 u
  // up a 55-degree bank beside the trawler: an arm standing on end. Deterministic now
  // too (the wreck arms were Math.random): a pure function of the lair, so a reseed
  // or a zone re-entry lays her down the same way every time.
  const floor0 = terrainH(lair.x, lair.z, idx);
  const lies = (ang, d) => {
    for (let k = 1; k <= 8; k++) {
      const r = d * k / 8, h = terrainH(lair.x + Math.sin(ang) * r, lair.z + Math.cos(ang) * r, idx) - floor0;
      if (h > Math.min(6, 0.30 * r + 1.0)) return false;
    }
    return true;
  };
  const SWING = [0, 0.22, -0.22, 0.44, -0.44, 0.66, -0.66];
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a], wreckArm = a === 1 || a === 3 || a === 5;
    if (wreckArm) {
      const h1 = ((Math.sin(a * 12.9898 + idx * 78.233) * 43758.5453) % 1 + 1) % 1;
      const h2 = ((Math.sin(a * 39.3468 + idx * 11.135) * 24634.6345) % 1 + 1) % 1;
      A.drape.set(W.x + (h1 - 0.5) * 14, 0, W.z + (h2 - 0.5) * 14);
    } else {
      let bestA = L.yaw + A.ang, bestD = 0;
      for (const sw of SWING) {
        const ang = L.yaw + A.ang + sw;
        for (let f = 0.72; f >= 0.34; f -= 0.06) {
          if (f * A.len <= bestD + 1e-3) break;
          if (lies(ang, f * A.len)) { bestA = ang; bestD = f * A.len; break; }
        }
      }
      // Walled in on this side (a bank right against her): the arm folds back along the
      // lowest ground in a wider arc, short, rather than climbing.
      if (bestD === 0) {
        let lo = 1e9;
        for (let k = -8; k <= 8; k++) {
          const ang = L.yaw + A.ang + k * 0.18, d = A.len * 0.36;
          const h = terrainH(lair.x + Math.sin(ang) * d, lair.z + Math.cos(ang) * d, idx);
          if (h < lo) { lo = h; bestA = ang; bestD = d; }
        }
      }
      A.drape.set(lair.x + Math.sin(bestA) * bestD, 0, lair.z + Math.cos(bestA) * bestD);
    }
    A.drape.y = terrainH(A.drape.x, A.drape.z, idx) + 0.6;
    A.tip.copy(A.drape);
  }

  // ---- THE LAMPS SHE LIES AMONG (encounter pass) ------------------------------------
  // The hoard used to sit 30 u off her lair, so in a lightless zone she was a black ridge
  // beside a pool of light. Now four drowned lanterns lie IN her coils, one beside each
  // sprawled ward arm, on the silt, burning low: each is a real light (a borrowed ward-pool
  // light while that ward sleeps dark), so her arms are lit from below along their length
  // and her mass is read against the pools. When she wakes they are the first to go out.
  {
    const H = L.hoard, dm = new THREE.Object3D(), mats = [];
    for (let k = 0; k < WARD_ARMS.length; k++) {
      const A = L.arms[WARD_ARMS[k]];
      const dx = A.drape.x - lair.x, dz = A.drape.z - lair.z, dl = Math.hypot(dx, dz) || 1;
      const f = 0.42 + 0.08 * k, sd = (k & 1) ? 1 : -1, off = 3.1 + 0.5 * k;
      const x = lair.x + dx * f - dz / dl * off * sd, z = lair.z + dz * f + dx / dl * off * sd;
      const y = terrainH(x, z, idx), sc = 1.15;
      dm.position.set(x, y - 0.05 * sc, z);
      dm.scale.setScalar(sc);
      dm.rotation.set(k === 2 ? 1.25 : 0.12 * sd, k * 1.9, 0.08);            // one lies on its side
      dm.updateMatrix();
      mats.push(dm.matrix.clone());
      L.clutch.push({ pos: V3(x, y + (k === 2 ? 0.5 : 0.95) * sc, z), on: 1, k });
    }
    // THE HEAP: her oldest lanterns, piled BEHIND her in the lee of her mantle. A diver
    // comes in from the raft's side, and she lies facing him with the trawler and the
    // hoard in front of her — so this is the one light that can sit behind her from where
    // he looks. It is the lamp-B source: a wide amber haze in the water past her, and she
    // reads first as a black mass against it (silhouette, then scale, then detail). It
    // is the last light to go out when she rises.
    {
      // (the lowest ground in an arc behind her: on a bank the heap stood ABOVE her mantle,
      // a lamp in the sky, instead of in her lee where her body can eclipse it)
      let hx = 0, hz = 0, lo = 1e9;
      for (let k = -4; k <= 4; k++) {
        const a = k * 0.22, ca = Math.cos(a), sa = Math.sin(a), d = Rm * 1.3 + 3;
        const dx = out.x * ca + perp.x * sa, dz = out.z * ca + perp.z * sa;
        const x = lair.x + dx * d, z = lair.z + dz * d, h = terrainH(x, z, idx) + Math.abs(k) * 0.4;
        if (h < lo) { lo = h; hx = x; hz = z; }
      }
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * TAU + 0.4, r = k === 0 ? 0 : 1.2 + 0.5 * (k & 1);
        const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r, y = terrainH(x, z, idx), sc = 0.95 + 0.12 * (k % 3);
        dm.position.set(x, y - 0.05 + (k === 0 ? 0.5 : 0), z);
        dm.scale.setScalar(sc);
        dm.rotation.set(k % 2 ? 1.3 : 0.2, k * 2.3, k % 3 ? 0.3 : -1.1);
        dm.updateMatrix();
        mats.push(dm.matrix.clone());
      }
      // the light rides at her mantle's height where the ground allows: her body eclipses
      // its core and the haze round it rims her
      L.heap = { pos: V3(hx, Math.max(terrainH(hx, hz, idx) + 2.4, floor0 + Rm * 0.45), hz), on: 1 };
    }
    const cb = new THREE.InstancedMesh(H.LP.brass, H.brass, mats.length), cg = new THREE.InstancedMesh(H.LP.glass, H.glass, mats.length);
    for (let k = 0; k < mats.length; k++) { cb.setMatrixAt(k, mats[k]); cg.setMatrixAt(k, mats[k]); }
    cb.castShadow = true;
    grp.add(cb, cg);
    // the pool, staged: slot -> which source it serves, and its eased intensity
    L.stage = sigilPool.map(() => ({ src: -1, cur: 0 }));
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
    else if (name === 'place') { L.pos.set(arg.pos.x, 0, arg.pos.z); L.yaw = arg.yaw; L.armsInit = false; }
    else if (name === 'rear') L.lashCd = 0;
    return L.probe();
  };
  L.probe = () => ({
    kind: 'hoarder', dormant: L.dormant, rise: +L.rise.toFixed(2), calmed: L.calmed, grab: L.grab ? L.grab.arm : -1,
    lamp: L.hoard.lampTaken, pos: L.pos.toArray(), bodyY: L.bodyY, reveal: L.reveal,
    wards: L.sigils.map(g => ({ lit: g.lit, rev: +g.rev.toFixed(2) }))
  });

  if (typeof window !== 'undefined') window.__sl = L;        // dev: the live sleeper object (motion probes)
  scene.add(grp);
  setLive(L);
  setWardTargets(-1, null);
  poseHoarder(L, 0, null);
  // (window.__noSculpt: dev A/B — build the procedural body and leave it)
  const want = !(typeof window !== 'undefined' && window.__noSculpt);
  if (SC && want) installSculpt(L, SC);
  else if (want) sculpt().then(a => { if (a && !L.gone) { installSculpt(L, a); poseHoarder(L, 0, null); } });
  const pd = L.onDispose;
  L.onDispose = () => { L.gone = true; if (pd) pd(); };
  return L;
}

// PASSING CLOUDS (chromatophores) and the siphon's pulse over a wetSkin program: dark bands
// sweep the body in world space (their speed, depth and photophore flare are her mood), and
// the siphon swells on the exhale. `orm`: the emissive mask is the sculpt's ORM blue (the
// pipeline's layout: R = AO, G = roughness, B = emissive), not an emissive colour map.
// MENACE (orune-menace, docs/superpowers/specs/orune-menace.md), same program:
//   uMen.x PAPILLAE — a sparse field of coarse horns (vertex-displaced: they break the
//     silhouette) over a dense fine papilla field (shaded only, derivative normals), plus
//     the supraocular horn over each eye; raised as she becomes aware of him, full in threat.
//   uMen.y DARK — the aggressor darkens (Scheel 2016): near-black dorsum, counter-shaded
//     paler underside.
//   uMen.z DEIMATIC — the startle flash: a blanch to bone with the eye rings left black.
//   uMen.w WEB — the web skirt flares out and up.
//   uTell[1 + arm] — that arm's TELL: it blanches in bands racing down it while it cocks.
// The arm tubes carry aArmP = arm + 1 + s (s along the arm); the mantle has no such
// attribute and reads 0, which is how one program tells the body from an arm.
const MENACE_GLSL = /* glsl */`
  float oruH3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  vec3 oruJ3(vec3 c) { return vec3(oruH3(c), oruH3(c + 17.3), oruH3(c + 41.9)); }
  // cellular bumps on a 2x2x2 search (feature points jittered inside the middle half of
  // their cell, so the nearest one is always in the 2x2x2 neighbourhood)
  float oruCell(vec3 p, float keep) {
    vec3 b = floor(p - 0.5);
    float h = 0.0;
    for (int i = 0; i < 8; i++) {
      vec3 c = b + vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
      vec3 j = oruJ3(c);
      float on = step(1.0 - keep, j.x * 0.7 + j.y * 0.3);
      vec3 q = c + 0.25 + 0.5 * j;
      float d = length(p - q) / (0.30 + 0.12 * j.z);
      h = max(h, on * pow(max(0.0, 1.0 - d), 1.6));
    }
    return h;
  }
`;
function cloudPatch(m, L, key, orm) {
  const ob = m.onBeforeCompile;
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (sh, r) => {
    ob(sh, r);
    sh.uniforms.uCloud = L.cloudU.uCloud;
    sh.uniforms.uSiph = L.cloudU.uSiph;
    sh.uniforms.uMen = L.cloudU.uMen;
    sh.uniforms.uTell = L.cloudU.uTell;
    sh.uniforms.uRm = L.cloudU.uRm;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uSiph;
        uniform vec4 uMen;
        uniform float uTell[9];
        uniform float uRm;
        attribute float aArmP;
        varying vec3 vCloudW;
        varying vec3 vOruP;
        varying vec3 vOruN;
        varying vec3 vOruA;
        ${MENACE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float isArm = step(0.5, aArmP);
          vec3 sq = position - vec3(-0.80, -0.36, 0.44);
          transformed += normal * uSiph * exp(-dot(sq, sq) / 0.035) * (1.0 - isArm);
          // the body's own unit frame (the arms are built in world space: / Rm)
          vec3 op = mix(position, position / uRm, isArm);
          vOruP = op;
          // the web flares out and up (the skirt band under the crown only)
          float wb = (1.0 - isArm) * (1.0 - smoothstep(-0.62, -0.24, position.y)) * smoothstep(0.30, 0.60, length(position.xz - vec2(0.0, 0.10)));
          vec2 wd = normalize(position.xz - vec2(0.0, 0.10) + 1e-4);
          transformed.xz += wd * uMen.w * wb * 0.30;
          transformed.y += uMen.w * wb * 0.10;
          // horns: sparse coarse papillae on the upper surfaces, and one over each eye
          vec3 wn = normalize(mat3(modelMatrix) * normal);
          float hc = oruCell(op * 3.2, 0.32) * smoothstep(-0.2, 0.5, wn.y);
          vec3 e1 = op - vec3(0.50, 0.55, 0.30), e2 = op - vec3(-0.50, 0.55, 0.30);
          float brow = (1.0 - isArm) * max(pow(max(0.0, 1.0 - length(e1) / 0.20), 1.4), pow(max(0.0, 1.0 - length(e2) / 0.20), 1.4));
          float amp = mix(0.045, 0.02 * uRm, isArm);
          transformed += normal * uMen.x * (hc * amp + brow * 0.20 * (1.0 - isArm));
          vOruN = wn;
          vOruA = vec3(isArm, fract(aArmP), uTell[int(aArmP)]);
        }`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCloudW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    // (encounter pass: the mask's soft skirts lit too, so every photophore read as a fat
    // speck; only the lens cores glow now)
    if (orm) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', THREE.ShaderChunk.emissivemap_fragment.replace('emissiveColor.rgb', 'emissiveColor.bbb * smoothstep(0.3, 0.7, emissiveColor.b)'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uCloud;
        uniform vec4 uMen;
        uniform float uRm;
        varying vec3 vCloudW;
        varying vec3 vOruP;
        varying vec3 vOruN;
        varying vec3 vOruA;
        ${MENACE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float ocA = dot(vCloudW, vec3(0.071, 0.043, 0.052)) * uCloud.w;
        float ocB = sin(ocA - uCloud.x) + 0.35 * sin(ocA * 2.3 + 1.7 - uCloud.x * 1.3);
        float ocBand = smoothstep(0.55, 1.2, ocB);
        diffuseColor.rgb *= 1.0 - uCloud.y * ocBand;
        // MENACE: the papilla field (shared with the normal below), darkness, the flash
        float oHf = oruCell(vOruP * 10.0, 0.75);
        float oHc = oruCell(vOruP * 3.2, 0.32) * smoothstep(-0.2, 0.5, vOruN.y);
        float oPap = uMen.x * max(oHf * 0.55, oHc);
        float oLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        // dark: the dorsum toward black-violet-brown, the underside held paler (counter-shade)
        float oUp = smoothstep(-0.35, 0.65, vOruN.y);
        // (the arms' pale oral faces darken too: a hunting arm is a dark arm)
        diffuseColor.rgb *= 1.0 - uMen.y * mix(0.30 + 0.45 * oUp, 0.82 + 0.10 * oUp, vOruA.x);
        // papilla crowns: a worn bone tip on each raised horn
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.21, 0.17), clamp(oPap * oPap * 0.9, 0.0, 0.6));
        // the deimatic flash: bone-pale, the eye rings and arm tips left black
        float oEye = (1.0 - vOruA.x) * max(1.0 - smoothstep(0.17, 0.30, length(vOruP - vec3(0.52, 0.32, 0.34))), 1.0 - smoothstep(0.17, 0.30, length(vOruP - vec3(-0.52, 0.32, 0.34))));
        float oTip = vOruA.x * smoothstep(0.62, 0.85, vOruA.y);
        // (bone that keeps her pattern: the reticulate net and the mottle stay dark in it)
        vec3 oBone = vec3(0.50, 0.45, 0.40) * (0.35 + 1.6 * oLum);
        diffuseColor.rgb = mix(diffuseColor.rgb, oBone, uMen.z * (1.0 - max(oEye, oTip)) * 0.7);
        diffuseColor.rgb *= 1.0 - uMen.z * max(oEye, oTip) * 0.85;
        // an arm's tell: pale bands racing down it from the root
        float oTell = vOruA.z * (0.55 + 0.45 * sin(vOruA.y * 46.0 - uCloud.x * 9.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, oBone * 1.2, clamp(oTell, 0.0, 1.0) * 0.75);`)
      .replace('#include <clearcoat_normal_fragment_maps>', `{
          // the papillae in the normal (derivative bump; world units)
          float oHw = oPap * mix(0.045, 0.02, vOruA.x) * uRm;
          vec3 oSx = dFdx(-vViewPosition), oSy = dFdy(-vViewPosition);
          float oDx = dFdx(oHw), oDy = dFdy(oHw);
          vec3 oR1 = cross(oSy, normal), oR2 = cross(normal, oSx);
          float oDet = dot(oSx, oR1) * faceDirection;
          vec3 oG = sign(oDet) * (oDx * oR1 + oDy * oR2);
          normal = normalize(abs(oDet) * normal - oG);
        }
        #include <clearcoat_normal_fragment_maps>`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        totalEmissiveRadiance *= 1.0 + uCloud.z * smoothstep(0.3, 1.1, sin(ocA - uCloud.x + 0.9));`);
  };
  return m;
}

// ---- THE SCULPT, installed in place ------------------------------------------------------
function sculptSkin(maps, key, L, extra) {
  const m = registerPaint(G.wetSkin(new THREE.MeshStandardMaterial(Object.assign({
    map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: maps.ormMap, aoMap: maps.ormMap, aoMapIntensity: 1,
    roughness: 1, metalness: 0, envMap: envTex, envMapIntensity: 0.28,
    emissive: ORUNE_PHOTO, emissiveMap: maps.ormMap, emissiveIntensity: 0.08
  }, extra || {})), key, 0, false));
  return cloudPatch(m, L, key + '-m', true);
}
function installSculpt(L, A) {
  const g = A.geos, meta = A.meta.meta || {};
  if (!g.mantle || !g.sucker || !A.maps.body || !A.maps.sucker || !A.maps.arm || L.sculpted) return;
  L.sculpted = true;
  L.keepTex = new Set([...L.keepTex, ...assetTextures(A)]);
  L.keepGeo = assetGeos(A);
  // the strip tiles along the arm and round it
  for (const t of Object.values(A.maps.arm)) if (t.wrapS !== THREE.RepeatWrapping) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
  const old = L.skin;
  const bodyMat = sculptSkin(A.maps.body, 'abyssa-orune-sculpt', L);
  const armMat = sculptSkin(A.maps.arm, 'abyssa-orune-sculpt', L, { envMapIntensity: 0.3 });
  // the mantle, head, web, beak and siphon: one mesh (breath still scales it; the siphon
  // pulse still keys on SIPHON — the sculpt keeps the funnel there)
  L.mantle.geometry.dispose();
  L.mantle.geometry = bodyArmP(g.mantle);
  bodyArmP(g.lid_top); bodyArmP(g.lid_bot);
  L.mantle.material = bodyMat;
  // the lids: thick, rolled, rotating as before (heavier: they never quite clear the iris)
  const oldLids = new Set();
  for (const e of L.eyes) {
    oldLids.add(e.lidT.geometry); oldLids.add(e.lidB.geometry);
    e.lidT.geometry = g.lid_top; e.lidB.geometry = g.lid_bot;
    e.lidT.material = e.lidB.material = bodyMat;
  }
  for (const q of oldLids) q.dispose();
  L.lidK = 1.02; L.lidKb = 1.1;
  // arms: the strip, its u keyed to the sucker stations (tile = armPairs pairs; each arm
  // starts on its own whole pair, so the eight never show the same stretch side by side)
  const pairs = meta.armPairs || 4;
  for (let a = 0; a < L.arms.length; a++) {
    const Ar = L.arms[a], S = Ar.suckS, n = S.length, row = RAD + 1;
    const uv = new Float32Array((RR + 1) * row * 2), off = (a * 3) % pairs;
    for (let f = 0; f <= RR; f++) {
      const s = f / RR;
      let k;
      if (s <= S[0]) k = (s - S[0]) / (S[1] - S[0]);
      else if (s >= S[n - 1]) k = n - 1 + (s - S[n - 1]) / (S[n - 1] - S[n - 2]);
      else { let i = 0; while (S[i + 1] < s) i++; k = i + (s - S[i]) / (S[i + 1] - S[i]); }
      const u = (k + 2 * off) / (2 * pairs);
      for (let j = 0; j <= RAD; j++) { const q = (f * row + j) * 2; uv[q] = u; uv[q + 1] = j / RAD; }
    }
    Ar.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    Ar.mesh.material = armMat;
  }
  // the sucker: the sculpted cup with its worn chitin ring, sized to the strip's sockets
  const sm = registerPaint(new THREE.MeshStandardMaterial({
    map: A.maps.sucker.map, normalMap: A.maps.sucker.normalMap, roughnessMap: A.maps.sucker.ormMap, aoMap: A.maps.sucker.ormMap,
    roughness: 1, metalness: 0, envMap: envTex, envMapIntensity: 0.4
  }));
  L.suckers.geometry.dispose();
  L.suckers.material.dispose();
  L.suckers.geometry = g.sucker;
  L.suckers.material = sm;
  L.suckBase = sm.color.clone();
  L.suckK = meta.suckK || 0.34;
  L.suckSink = 0.09;                       // the stalk sits down in its collar
  // the strip bakes a socket under every station, so a hidden sucker leaves an empty socket:
  // hide only those truly inside the sculpt (the old test was a generous ellipsoid)
  L.hideK = 0.62;
  old.dispose();
  L.skin = bodyMat; L.skinM = armMat;
  // THE HOARD SHE WEARS: drowned lanterns tangled in her — two caught in the web between
  // her arm roots, one snagged where the trawler's chain is grown into her shoulder. Dead
  // (sooted glass, no flame): the lit ones are in the hoard. Seated by a ray onto the sculpt.
  // (seats are computed offline on the full SDF: hoarderSculpt LANTERN_SEATS -> meta)
  if (!LANTERN_GEO) LANTERN_GEO = G.lanternParts();
  const lp = LANTERN_GEO;
  L.keepGeo.add(lp.brass); L.keepGeo.add(lp.glass);
  const S = (meta.lanterns || []).map(h => ({ p: new THREE.Vector3(...h.p), n: new THREE.Vector3(...h.n) }));
  const brassM = registerPaint(new THREE.MeshStandardMaterial({ color: 0x8a6a3a, vertexColors: true, roughness: 0.6, metalness: 0.65, envMap: envTex, envMapIntensity: 0.45 }));
  // (encounter pass: not quite dead — the ones in her web KINDLE as the hoard goes out, the
  // light she drew in; emissive driven by L.webK, and a borrowed pool light rides seat 0)
  const glassM = registerPaint(new THREE.MeshStandardMaterial({ color: 0x3a342a, vertexColors: true, roughness: 0.12, metalness: 0, envMap: envTex, envMapIntensity: 1.0,
    emissive: FLAME, emissiveIntensity: 0 }));
  L.webGlass = glassM;
  L.webSeats = S.map(h => h.p.clone().addScaledVector(h.n, 0.55 / L.R));
  // (the flame lathe rides in the glass geometry: dead lanterns show it as a dark stub)
  const lb = new THREE.InstancedMesh(lp.brass, brassM, S.length), lg = new THREE.InstancedMesh(lp.glass, glassM, S.length);
  const q = new THREE.Quaternion(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), mm = new THREE.Matrix4();
  S.forEach((h, i) => {
    q.setFromUnitVectors(_yp, h.n);
    qt.setFromAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), 0.6 + 0.4 * i);           // fallen over, askew
    q.multiply(qt);
    const k = (0.75 + 0.15 * i) / L.R;
    mm.compose(h.p.clone().addScaledVector(h.n, -0.25 * k), q, sc.set(k, k, k));
    lb.setMatrixAt(i, mm); lg.setMatrixAt(i, mm);
  });
  lb.castShadow = true;
  L.body.add(lb, lg);
  L.caught = S.length;
}

function wakeHoarder(L) {
  L.dormant = false;
  L.riseTarget = 1;
  L.woke = true;
  L.hoard.darken();
}

// Per-arm shape: a cubic from the crown out to the tip, arched off the body, writhing,
// then CURLED down its distal half toward the sucker face (a curvature wave running base
// to tip), wrapped round the diver when it holds him, and followed by a verlet chain
// (stiff root, loose tip). Never through the seabed. Then parallel-transported frames
// (U = dorsal, B = side), rolled BASE-FIRST by a flinch, and the tube written into the
// arm's buffer. The sucker face is -U.
function buildArm(L, A, dt, player) {
  const n = RINGS, T = A.tgt, P = A.pts;
  // control points: out of the crown, arching up, down to the tip
  _a.copy(A.base);
  _d.copy(A.tip);
  _t.subVectors(_d, _a); const span = _t.length() || 1;
  _b.copy(_a).addScaledVector(_t, 0.30).addScaledVector(UP, L.R * (0.9 + 1.4 * A.lift) + span * 0.10 * (1 - A.lift));
  _c.copy(_a).addScaledVector(_t, 0.72).addScaledVector(UP, L.R * 1.1 * A.lift + span * 0.05);
  const writhe = (0.04 + 0.10 * A.lift) * A.len * L.writheK, wt = L.t * (0.7 + 0.9 * A.lift) + A.phase;
  _w.set(-_t.z, 0, _t.x).normalize();                             // side-to-side
  for (let i = 0; i <= n; i++) {
    const s = i / n, m = 1 - s;
    T[i].set(0, 0, 0)
      .addScaledVector(_a, m * m * m).addScaledVector(_b, 3 * m * m * s)
      .addScaledVector(_c, 3 * m * s * s).addScaledVector(_d, s * s * s);
    const wv = Math.sin(wt - s * 5.5) * writhe * s * s;
    T[i].addScaledVector(_w, wv);
    T[i].y += Math.sin(wt * 0.8 - s * 4.1) * writhe * 0.5 * s * s * A.lift;
  }
  // frames along the intent (parallel transport; U starts as world up)
  for (let i = 0; i <= n; i++) {
    _t.subVectors(T[Math.min(n, i + 1)], T[Math.max(0, i - 1)]).normalize();
    const Ui = A.U[i];
    if (i === 0) Ui.copy(UP); else Ui.copy(A.U[i - 1]);
    Ui.addScaledVector(_t, -Ui.dot(_t)).normalize();
    A.B[i].crossVectors(_t, Ui).normalize();
  }
  // THE CURL: rebuild the distal half by integrating a bend toward the sucker face (-U)
  // with a little sideways (B) twist; curvature is a wave travelling down the arm
  const i0 = (n * 0.40) | 0;
  let phi = 0, psi = 0;
  _e1.copy(T[i0]);                                                  // the curled cursor
  _l.copy(T[i0]);                                                   // the previous intent point
  for (let i = i0 + 1; i <= n; i++) {
    const s = i / n, w = Math.pow(THREE.MathUtils.smoothstep(s, 0.40, 1.0), 1.4);
    const wave = 0.65 + 0.45 * Math.sin(L.t * 1.1 + A.phase * 1.7 - s * 7.5);
    phi += A.curl * w * wave / n;
    psi += 3.0 * w * Math.sin(L.t * 0.7 + A.phase - s * 5) / n;
    _t.subVectors(T[i], _l);
    const seg = _t.length() || 1e-4;
    _t.divideScalar(seg);
    const cf = Math.cos(phi), sf = Math.sin(phi), cp = Math.cos(psi), sp = Math.sin(psi);
    _dv.copy(_t).multiplyScalar(cf * cp).addScaledVector(A.U[i], -sf * cp).addScaledVector(A.B[i], sp).normalize();
    _l.copy(T[i]);
    _e1.addScaledVector(_dv, seg);
    T[i].copy(_e1);
  }
  // THE WRAP: the distal arm coils round the diver in a tightening helix
  if (A.wrap > 0.001 && player) {
    _e1.set(1, 0, 0); _e2.set(0, 0, 1);
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      if (s < 0.50) continue;
      const u = (s - 0.50) / 0.50, k = A.wrap * THREE.MathUtils.smoothstep(s, 0.50, 0.66);
      // (encounter pass: the coil radius now clears the arm's own girth. At 1.25 u a 2 u
      // thick arm swallowed him whole: the camera saw a pale cup of sucker-face with his
      // lantern burning inside it — the "glowing block with dark holes" in front of her.)
      const rs = A.r0 * Math.pow(1 - s, 0.85) + 0.12;
      const th = u * 2.4 * TAU + L.t * 0.8 + A.phase, rr = 1.0 + 0.4 * (1 - u) - 0.2 * A.wrap + rs * 1.05;
      _tg.copy(player.pos).addScaledVector(_e1, Math.cos(th) * rr).addScaledVector(_e2, Math.sin(th) * rr);
      _tg.y += 1.1 - 2.4 * u;
      T[i].lerp(_tg, k);
    }
  }
  // the arm never goes through the floor — and a RESTING arm lies on it. The cubic
  // arches out of the crown by the body's radius (right for the root, which has to clear
  // her), but past the first third a sleeping arm has nothing holding it up: it used to
  // ride the arch 5-10 u over the silt all the way to the tip. Weighted by how far she
  // is from lifting (A.lift 0 = asleep, calmed rests at 0.15) and ramped in along the arm,
  // the shape settles onto the ground it crosses, so the curl lies as a coil on the
  // silt. Same terrain sample the floor clamp already paid for: no extra cost.
  const rest = (1 - A.lift) * (1 - A.wrap);
  for (let i = 0; i <= n; i++) {
    const s = i / n, r = A.r0 * Math.pow(1 - s, 0.85) + 0.12;
    const gy = terrainH(T[i].x, T[i].z, L.idx) + r * 0.85;
    const lay = rest * THREE.MathUtils.smoothstep(s, 0.22, 0.50);
    if (lay > 0 && T[i].y > gy) T[i].y += (gy - T[i].y) * lay;
    if (T[i].y < gy) T[i].y = gy;
  }
  // the verlet chain: carry momentum, pull toward the shape (stiff root, loose tip),
  // inextensible by follow-the-leader (corrections also move the previous point: no jitter)
  const k60 = Math.min(3, dt * 60), init = !L.armsInit || !(dt > 0);
  const damp = Math.pow(0.9, k60), hold = A.wrap > 0.5;
  for (let i = 0; i <= n; i++) {
    if (i === 0 || init) { P[i].copy(T[i]); A.prv[i].copy(T[i]); continue; }
    const s = i / n;
    _dv.subVectors(P[i], A.prv[i]).multiplyScalar(damp);
    A.prv[i].copy(P[i]);
    P[i].add(_dv);
    const k = hold ? 0.6 : lerp(0.55, 0.14, Math.pow(s, 0.8));
    P[i].lerp(T[i], 1 - Math.pow(1 - k, k60));
  }
  if (!init) for (let i = 1; i <= n; i++) {
    const seg = T[i].distanceTo(T[i - 1]) || 1e-3;
    _dv.subVectors(P[i], P[i - 1]);
    const l = _dv.length() || 1e-4;
    _tg.copy(P[i]);
    P[i].copy(P[i - 1]).addScaledVector(_dv, seg / l);
    A.prv[i].add(_tg.subVectors(P[i], _tg).multiplyScalar(0.9));
    const r = A.r0 * Math.pow(1 - i / n, 0.85) + 0.12;
    const gy = terrainH(P[i].x, P[i].z, L.idx) + r * 0.8;
    if (P[i].y < gy) { P[i].y = gy; }
  }
  // frames on the live chain; the flinch roll runs down the arm from the root
  for (let i = 0; i <= n; i++) {
    _t.subVectors(P[Math.min(n, i + 1)], P[Math.max(0, i - 1)]).normalize();
    const Ui = A.U[i];
    if (i === 0) Ui.copy(UP); else Ui.copy(A.U[i - 1]);
    Ui.addScaledVector(_t, -Ui.dot(_t)).normalize();
    A.B[i].crossVectors(_t, Ui).normalize();
  }
  for (let i = 0; i <= n; i++) {
    const s = i / n, rk = Math.min(1, Math.max(0, A.recoil * 1.6 - s * 0.6));
    const roll = rk * Math.PI * 0.85;
    if (roll === 0) continue;
    const U = A.U[i], B = A.B[i], cr = Math.cos(roll), sr = Math.sin(roll);
    const ux = U.x * cr + B.x * sr, uy = U.y * cr + B.y * sr, uz = U.z * cr + B.z * sr;
    const bx = B.x * cr - U.x * sr, by = B.y * cr - U.y * sr, bz = B.z * cr - U.z * sr;
    U.set(ux, uy, uz); B.set(bx, by, bz);
  }
  buildTube(A);
}
// The render tube off the logic spine: Catmull-Rom rings, frames lerped from the rolled
// logic frames and re-orthogonalised, the section scaled by the static folds and by
// transverse WRINKLES whose depth is the local bend strain (curvature x radius) and which
// only bunch on the inside of the bend. Normals from the grid itself. Zero allocation.
function buildTube(A) {
  const P = A.pts, Pf = A.Pf, Uf = A.Uf, Bf = A.Bf, Ka = A.Ka, Kd = A.Kd;
  for (let f = 0; f <= RR; f++) {
    const i0 = CR_I[f], im = Math.max(0, i0 - 1), i1 = i0 + 1, i2 = Math.min(RINGS, i0 + 2), w = f * 4, o = f * 3;
    const wa = CR_W[w], wb = CR_W[w + 1], wc = CR_W[w + 2], wd = CR_W[w + 3];
    Pf[o] = P[im].x * wa + P[i0].x * wb + P[i1].x * wc + P[i2].x * wd;
    Pf[o + 1] = P[im].y * wa + P[i0].y * wb + P[i1].y * wc + P[i2].y * wd;
    Pf[o + 2] = P[im].z * wa + P[i0].z * wb + P[i1].z * wc + P[i2].z * wd;
  }
  for (let f = 0; f <= RR; f++) {
    const o = f * 3, fa = Math.max(0, f - 1) * 3, fb = Math.min(RR, f + 1) * 3;
    let tx = Pf[fb] - Pf[fa], ty = Pf[fb + 1] - Pf[fa + 1], tz = Pf[fb + 2] - Pf[fa + 2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const i0 = CR_I[f], t = f / RR * RINGS - i0, U0 = A.U[i0], U1 = A.U[i0 + 1];
    let ux = U0.x + (U1.x - U0.x) * t, uy = U0.y + (U1.y - U0.y) * t, uz = U0.z + (U1.z - U0.z) * t;
    const d = ux * tx + uy * ty + uz * tz; ux -= d * tx; uy -= d * ty; uz -= d * tz;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    Uf[o] = ux; Uf[o + 1] = uy; Uf[o + 2] = uz;
    Bf[o] = ty * uz - tz * uy; Bf[o + 1] = tz * ux - tx * uz; Bf[o + 2] = tx * uy - ty * ux;
    // bend: second difference over the chord (points to the centre of curvature)
    if (f > 0 && f < RR) {
      const h = tl * 0.5;
      let kx = (Pf[fb] - 2 * Pf[o] + Pf[fa]) / (h * h), ky = (Pf[fb + 1] - 2 * Pf[o + 1] + Pf[fa + 1]) / (h * h), kz = (Pf[fb + 2] - 2 * Pf[o + 2] + Pf[fa + 2]) / (h * h);
      const kl = Math.hypot(kx, ky, kz);
      Ka[f] = Math.min(0.22, kl * A.rf[f] * 1.4);
      if (kl > 1e-6) { Kd[o] = kx / kl; Kd[o + 1] = ky / kl; Kd[o + 2] = kz / kl; } else { Kd[o] = Kd[o + 1] = Kd[o + 2] = 0; }
    } else Ka[f] = 0;
  }
  const pos = A.geo.attributes.position.array, nor = A.geo.attributes.normal.array, row = RAD + 1, fold = A.fold;
  for (let f = 0; f <= RR; f++) {
    const o = f * 3, r = A.rf[f], ka = Ka[f], wk = WRINK[f] - 0.35;
    const ux = Uf[o], uy = Uf[o + 1], uz = Uf[o + 2], bx = Bf[o], by = Bf[o + 1], bz = Bf[o + 2];
    const kx = Kd[o], ky = Kd[o + 1], kz = Kd[o + 2], px = Pf[o], py = Pf[o + 1], pz = Pf[o + 2];
    for (let j = 0; j <= RAD; j++) {
      const sx = SEC_X[j], sy = SEC_Y[j];
      const nx = ux * sy + bx * sx, ny = uy * sy + by * sx, nz = uz * sy + bz * sx;
      const comp = nx * kx + ny * ky + nz * kz;
      const k = 1 + fold[f * row + j] + 0.014 * wk + (comp > 0 ? ka * comp * wk : 0);
      const q = (f * row + j) * 3;
      pos[q] = px + nx * r * k; pos[q + 1] = py + ny * r * k; pos[q + 2] = pz + nz * r * k;
    }
  }
  // normals: cross of the around and along differences (around x along is outward)
  for (let f = 0; f <= RR; f++) {
    const fa = Math.max(0, f - 1), fb = Math.min(RR, f + 1);
    for (let j = 0; j <= RAD; j++) {
      const jm = j === 0 ? RAD - 1 : j - 1, jp = j === RAD ? 1 : j + 1;
      const a = (f * row + jp) * 3, b = (f * row + jm) * 3, c = (fb * row + j) * 3, d = (fa * row + j) * 3;
      const ax = pos[a] - pos[b], ay = pos[a + 1] - pos[b + 1], az = pos[a + 2] - pos[b + 2];
      const tx = pos[c] - pos[d], ty = pos[c + 1] - pos[d + 1], tz = pos[c + 2] - pos[d + 2];
      let nx = ay * tz - az * ty, ny = az * tx - ax * tz, nz = ax * ty - ay * tx;
      const l = 1 / (Math.hypot(nx, ny, nz) || 1), q = (f * row + j) * 3;
      nor[q] = nx * l; nor[q + 1] = ny * l; nor[q + 2] = nz * l;
    }
  }
  A.geo.attributes.position.needsUpdate = true;
  A.geo.attributes.normal.needsUpdate = true;
}

function poseHoarder(L, dt, player) {
  const b = L.body, R = L.R;
  const gy = terrainH(L.pos.x, L.pos.z, L.idx);
  // BREATHING: a slow swell (inhale, eased) and a quicker squeeze out through the siphon;
  // the siphon flares on the exhale and the whole head rides the breath
  const ph = L.brPh, bv = ph < 0.7 ? THREE.MathUtils.smootherstep(ph, 0, 0.7) : 1 - THREE.MathUtils.smootherstep(ph, 0.7, 1.0);
  L.cloudU.uSiph.value = ph > 0.68 ? 0.035 * Math.sin(Math.PI * Math.min(1, (ph - 0.68) / 0.32)) : 0;
  // (menace) she LOOMS: awake and close she stands tall over him with the mantle reared,
  // and a held diver is lifted to a beak she bares by rearing further
  const loom = L.loomE, rear = L.rearE;
  L.bodyY = gy + R * (0.35 + 0.75 * L.riseE + 0.32 * loom + 0.12 * rear) + R * 0.04 * Math.sin(L.t * 0.35) + R * 0.025 * bv;
  b.position.set(L.pos.x, L.bodyY, L.pos.z);
  b.rotation.set(-0.10 * L.riseE - 0.16 * loom - 0.40 * rear + 0.03 * Math.sin(L.t * 0.35) - 0.02 * bv, L.yaw, 0.015 * nzO(L.t * 0.3, 2));
  const br = (1 + 0.05 * (bv - 0.5)) * (1 + 0.07 * L.puff);
  L.mantle.scale.set(br, 1 + (br - 1) * 1.4, br);
  // the working beak: everted toward a held diver, snapping
  if (L.beak) {
    const Bk = L.beak, ev = Bk.ev;
    Bk.grp.position.set(0, -0.44 - 0.14 * ev, 0.14 + 0.24 * ev);
    Bk.grp.rotation.x = -0.35 * ev;
    Bk.grp.scale.setScalar(1.25 * (1 + 0.35 * ev));
    Bk.hu.rotation.x = -0.60 * Bk.open;
    Bk.hl.rotation.x = 0.45 * Bk.open;
  }
  b.updateMatrixWorld(true);

  // arms
  let si = 0;
  _mi.copy(b.matrixWorld).invert();
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a];
    const wf = 0.52 * (1 + 0.28 * L.cloudU.uMen.value.w);           // the roots ride the flared web
    _p.set(Math.sin(A.ang) * wf, -0.42, Math.cos(A.ang) * wf + 0.10).applyMatrix4(b.matrixWorld);
    A.base.copy(_p);
    buildArm(L, A, dt, player);
    // suckers: two staggered rows on the oral face (-U), crowding and shrinking to the tip,
    // seated on the render tube's face
    for (let k = 0; k < SUCK; k++) {
      const s = A.suckS[k], x = s * RR, f0 = Math.min(RR - 1, x | 0), t = x - f0, o0 = f0 * 3, o1 = o0 + 3;
      const r = A.r0 * Math.pow(1 - s, 0.85) + 0.12, side = (k & 1) ? SUCK_SIDE : -SUCK_SIDE;
      _u.set(-(A.Uf[o0] + (A.Uf[o1] - A.Uf[o0]) * t), -(A.Uf[o0 + 1] + (A.Uf[o1 + 1] - A.Uf[o0 + 1]) * t), -(A.Uf[o0 + 2] + (A.Uf[o1 + 2] - A.Uf[o0 + 2]) * t)).normalize();
      _w.set(A.Bf[o0] + (A.Bf[o1] - A.Bf[o0]) * t, A.Bf[o0 + 1] + (A.Bf[o1 + 1] - A.Bf[o0 + 1]) * t, A.Bf[o0 + 2] + (A.Bf[o1 + 2] - A.Bf[o0 + 2]) * t);
      _p.set(A.Pf[o0] + (A.Pf[o1] - A.Pf[o0]) * t, A.Pf[o0 + 1] + (A.Pf[o1 + 1] - A.Pf[o0 + 1]) * t, A.Pf[o0 + 2] + (A.Pf[o1 + 2] - A.Pf[o0 + 2]) * t)
        .addScaledVector(_u, r * (SUCK_DEPTH - 0.02 - L.suckSink)).addScaledVector(_w, side * 1.04 * r);
      _q.setFromUnitVectors(_yp, _u);
      // a sucker whose seat is inside the mantle (the arm roots arch up through it) is hidden
      _l.copy(_p).applyMatrix4(_mi);
      const inside = (_l.x / 0.86) ** 2 + ((_l.y - 0.1) / 0.75) ** 2 + ((_l.z + 0.15) / 1.05) ** 2 < L.hideK;
      const sz = inside ? 0 : r * L.suckK;
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
  // (a blink every few seconds awake: the lids close fast and open slower)
  const bl = L.blinkT < 0.28 ? Math.sin(Math.PI * Math.pow(L.blinkT / 0.28, 0.6)) : 0;
  // (menace) asleep, ONE lid cracks and that eye follows him (e.peek, set in update)
  let eoMax = 0;
  for (const e of L.eyes) {
    const eo = Math.max(open * (1 - 0.9 * bl), e.peek);
    e.eo = eo; if (eo > eoMax) eoMax = eo;
    e.lidT.rotation.x = -0.1 - L.lidK * eo;
    e.lidB.rotation.x = 0.1 + L.lidKb * eo;
  }
  // THE LOOK: each eyeball turns in its socket toward the diver, in saccades - it holds,
  // then JUMPS (a stiff spring) when the error grows or a moment has passed
  if (player && dt > 0) {
    const Lk = L.look;
    Lk.next -= dt;
    for (const e of L.eyes) {
      _l.copy(player.pos);
      e.e.worldToLocal(_l);
      const ty = clamp(Math.atan2(_l.x, _l.z), -0.45, 0.45) * e.eo, tp = clamp(Math.atan2(_l.y, Math.hypot(_l.x, _l.z)), -0.3, 0.3) * e.eo;
      if (e.ly === undefined) { e.ly = { x: 0, v: 0 }; e.lp = { x: 0, v: 0 }; e.ty = 0; e.tp = 0; }
      if (Lk.next <= 0 || Math.abs(ty - e.ty) > 0.18 || Math.abs(tp - e.tp) > 0.15) { e.ty = ty + 0.03 * nzO(L.t * 3, e.sd); e.tp = tp + 0.02 * nzO(L.t * 2.7, e.sd + 4); }
      sprO(e.ly, e.ty, 26, 0.9, dt); sprO(e.lp, e.tp, 26, 0.9, dt);
      e.ball.rotation.set(-e.lp.x, e.ly.x, 0);
    }
    if (Lk.next <= 0) Lk.next = 0.5 + Math.random() * 1.6;
  }
  let shine = 0;
  if (player) {
    _p.copy(player.pos).sub(L.head);
    const dist = _p.length() || 1;
    b.getWorldDirection(_t);
    shine = Math.pow(Math.max(0, _t.dot(_p) / dist), 3) * (1 - smooth(dist, 25, 100)) * Math.max(0, player.light == null ? 1 : player.light);
  }
  L.shine = shine;
  L.eyeMat.emissiveIntensity = (0.05 + 2.0 * shine) * Math.max(open, eoMax * 1.6);
  // the freckles breathe slowly asleep, run brighter and quicker when she is roused
  // (encounter pass: a breath of cold phosphor, not a starfield; the passing clouds'
  // flare, uCloud.z, still carries her mood across them)
  L.skin.emissiveIntensity = L.calmed ? 0.10 : (0.07 + 0.04 * Math.sin(L.t * (L.dormant ? 0.4 : 1.6))) * (1 + 0.8 * L.riseE);
  // passing clouds: their speed, depth and flare are her mood
  const md = L.mood;
  L.cloudU.uCloud.value.set(L.cloudPh, 0.14 + 0.36 * md, 0.25 + 1.3 * md, 0.45 + 0.45 * md);
  L.skinM.emissiveIntensity = L.skin.emissiveIntensity;

  // collision centres (the mantle) and the head
  L.spine[0].set(0, 0.35, -0.55).applyMatrix4(b.matrixWorld);
  L.spine[1].set(0, 0.0, 0.2).applyMatrix4(b.matrixWorld);
  L.spine[2].set(0.45, 0.25, -0.35).applyMatrix4(b.matrixWorld);
  L.spine[3].set(-0.45, 0.25, -0.35).applyMatrix4(b.matrixWorld);
  L.head.set(0, 0.25, 0.45).applyMatrix4(b.matrixWorld);
}

// ---- MENACE: behaviour (orune-menace; every threat has its tell, see the spec's table) ----
// The lash is COCK then STRIKE. The cock is the tell: 0.45 s from the front, 0.6 s when the
// arm comes from out of his view (after she has circled his light); the arm blanches in
// bands for its whole length while it cocks. The strike window is the old one (1.05 s).
const STRIKE_T = LASH_T - COCK_T, REVEAL_DUR = 8.5, INK_WIND = 0.9;
const _cf = V3(), _cv = V3();
// is a world point inside the middle of the camera's view (and near enough to read)?
function inView(p, cosK = 0.6, far = 90) {
  _cv.subVectors(p, camera.position);
  const d = _cv.length() || 1;
  if (d > far) return false;
  camera.getWorldDirection(_cf);
  return _cf.dot(_cv) / d > cosK;
}
// the deimatic flash: attack 0.08 s, hold 0.3 s, release 0.45 s
function flash(L, k) { if (L.deimT > 0.5 || k > L.deimK) { L.deimT = 0; L.deimK = k; } }
function deimEnv(t) { return t < 0.08 ? t / 0.08 : t < 0.38 ? 1 : Math.max(0, 1 - (t - 0.38) / 0.45); }
function startLash(L, player, ambush) {
  // from behind after circling the light, else the nearest arm that is not flinching
  let best = -1, bd = 1e9;
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a];
    if (A.recoil > 0.4 || A.lash > 0) continue;
    let d = A.tip.distanceTo(player.pos);
    if (L.behindNext) d += inView(A.tip, 0.35, 200) ? 60 : 0;
    if (d < bd) { bd = d; best = a; }
  }
  if (best < 0) return;
  const A = L.arms[best];
  A.cockT = (!inView(A.tip, 0.5, 200) || L.behindNext) ? 0.6 : 0.45;
  A.lash = A.cockT + STRIKE_T;
  A.fast = ambush;
  L.behindNext = false;
  L.lashCd = 3 + Math.random() * 2.5;
  L.mood = Math.min(1, L.mood + 0.25);
  L.cockN++;
  if (ambush) flash(L, 0.7);
}

export function updateHoarder(L, dt, t, player) {
  const ev = EVO;
  ev.sigilLit = 0; ev.calmed = false; ev.lightDrain = 0; ev.slam = false; ev.remaining = 0; ev.msg = null; ev.woke = false; ev.grabbed = false; ev.quake = 0; ev.inkDim = 0;
  if (L.pendingMsg) { ev.msg = L.pendingMsg; L.pendingMsg = null; }
  if (L.woke) {
    L.woke = false; ev.woke = true; L.mood = 1; ev.quake = 0.35;
    L.revealT = 0; L.lashCd = Math.max(L.lashCd, REVEAL_DUR + 1.5);
    for (const A of L.arms) A.creep.set(0, 0, 0);
    for (const e of L.eyes) e.peek = 0;
  }
  if (!L.pPrev) L.pPrev = player.pos.clone();
  L.t += dt;
  // THE HUSH: asleep, the hoard's lanterns sink as he nears the lamp and breathe with her —
  // she is drawing on them before she ever moves (hoard.js eases toward it)
  const lp = L.hoard.lampPos, dLamp = Math.hypot(player.pos.x - lp.x, player.pos.z - lp.z);
  L.hoard.hush = L.hoard.lampTaken ? 1 : (1 - 0.55 * (1 - smooth(dLamp, 6, 30))) * (0.86 + 0.14 * Math.cos(L.brPh * TAU));
  L.hoard.update(dt, player, ev);

  // rise / settle (the waking rise is slow now: an overwhelming reveal, not a stand-up)
  const rate = L.riseTarget > L.rise ? 1 / 6.5 : 1 / 6;
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
  const hunting = !L.dormant && !L.calmed;
  const near = hunting ? 1 - smooth(pd, L.R * 1.5, L.AL * 0.9) : 0;
  // AWARENESS (asleep): she knows he is there long before she moves
  const dHead = L.head.distanceTo(player.pos);
  const awareT = L.dormant ? 1 - smooth(Math.min(dHead, dLamp + 10), 14, 60) : L.calmed ? 0 : 1;
  L.aware += (awareT - L.aware) * Math.min(1, dt * 0.6);
  if (L.revealT >= 0) {
    const was = L.revealT;
    L.revealT += dt;
    if (was < 4.2 && L.revealT >= 4.2) flash(L, 1);              // the eyes come fully open
    if (L.revealT > REVEAL_DUR) L.revealT = -1;
  }
  const reveal = L.revealT >= 0;
  // breath, blink, mood (anim-sleepers). THE FREEZE holds her breath.
  const brRate = L.dormant ? 1 / 11 : L.calmed ? 1 / 8 : 1 / (5.5 - 2.5 * L.mood);
  const brWas = L.brPh;
  if (L.still <= 0) L.brPh = (L.brPh + dt * brRate) % 1;
  if (brWas < 0.7 && L.brPh >= 0.7) {
    // the exhale: when she lies on the floor it blows the silt out from under the siphon
    _p.copy(SIPHON).applyMatrix4(L.body.matrixWorld);
    const gy = terrainH(_p.x, _p.z, L.idx);
    if (_p.y - gy < L.R * 0.6) emitDust(_p.x, gy + 0.3, _p.z, 5 + (L.dormant ? 0 : 3), 1.4 + 0.8 * L.riseE);
  }
  L.blinkT += dt;
  if (L.blinkT > L.blinkN) { L.blinkT = 0; L.blinkN = 2.5 + Math.random() * 5; }
  let moodT = L.dormant ? 0.05 : L.calmed ? 0.12 : 0.45 + 0.35 * (1 - smooth(pd, L.R, L.AL * 0.9));
  if (L.grab || L.still > 0) moodT = 1;
  L.mood += (moodT - L.mood) * Math.min(1, (moodT > L.mood ? 2.5 : 0.35) * dt);
  // the freeze stills the passing clouds too: the skin goes dark and holds
  L.cloudPh += dt * (0.35 + 2.8 * L.mood) * (L.still > 0 ? 0.08 : 1);

  // ---- the eye that watches (asleep): the near lid cracks and the bar pupil follows
  // him; it snaps shut when he looks straight at it, and opens again when he looks away
  L.peekCd -= dt;
  if (L.dormant) {
    _l.copy(player.pos); L.body.worldToLocal(_l);
    const side = _l.x >= 0 ? 1 : -1;
    for (const e of L.eyes) {
      e.e.getWorldPosition(_c);
      const watched = inView(_c, 0.97, 45);
      if (watched && e.peek > 0.1) L.peekCd = 4 + Math.random() * 3;
      const want = e.sd === side && L.aware > 0.45 && L.peekCd <= 0 && !watched ? 0.34 : 0;
      e.peek += clamp(want - e.peek, -dt * 3, dt * 0.12);
    }
  } else for (const e of L.eyes) e.peek = Math.max(0, e.peek - dt);

  // ---- heading: awake, she turns to him (the turn eases in and out) ----
  let yawWant = 0, crawlT = 0;
  if (hunting && L.still <= 0) {
    const want = Math.atan2(player.pos.x - L.pos.x, player.pos.z - L.pos.z);
    let dA = want - L.yaw;
    while (dA > Math.PI) dA -= TAU;
    while (dA < -Math.PI) dA += TAU;
    yawWant = clamp(dA * 1.2, -0.3, 0.3);
    // she pours toward him over the silt when he keeps his distance
    if (pd > L.AL * 0.7) crawlT = L.speed * 0.18;
  }
  L.yawV += (yawWant - L.yawV) * Math.min(1, (L.still > 0 ? 6 : 1.5) * dt);
  L.yaw += L.yawV * dt;
  // (the pour surges with the breath: a mantle-driven crawl, not a conveyor)
  L.crawl += (crawlT - L.crawl) * Math.min(1, 0.8 * dt);
  if (L.crawl > 1e-3 && L.still <= 0) {
    const sp = L.crawl * (0.55 + 0.9 * (L.brPh > 0.7 ? 1 : 0.4)) * dt;
    L.pos.x += Math.sin(L.yaw) * sp; L.pos.z += Math.cos(L.yaw) * sp;
  }
  // CIRCLING THE LIGHT: an arm burned by the lantern does not make her back off — she
  // slides round it, sideways over the silt, and the next arm comes from where he is not
  // looking (with the longer cock as its tell)
  L.circleT -= dt; L.circleCd -= dt;
  if (hunting && L.circleT > 0 && L.still <= 0 && !L.grab) {
    _p.set(player.pos.x - L.pos.x, 0, player.pos.z - L.pos.z);
    const dl = _p.length() || 1;
    const sp = L.speed * 0.2 * dt * smooth(L.circleT, 0, 0.6);
    L.pos.x += -_p.z / dl * sp * L.circleDir; L.pos.z += _p.x / dl * sp * L.circleDir;
  }

  // ---- INK: the lantern held into her arms (three or more burning at once for a second)
  // is answered with ink. Tell: the siphon swells on a deep exhale (0.9 s). After: the
  // light cannot find her arms for 3 s, and no lash comes for 2.5 s.
  L.inkCd -= dt; L.inkedT -= dt;
  let burned = 0;
  for (const A of L.arms) if (A.recoil > 0.5) burned++;
  L.glareT = hunting && burned >= 3 ? L.glareT + dt : Math.max(0, L.glareT - dt);
  if (L.inkT < 0 && L.glareT > 1.0 && L.inkCd <= 0 && !L.grab && !reveal) { L.inkT = 0; L.inkN++; L.lashCd = Math.max(L.lashCd, INK_WIND + 2.5); }
  if (L.inkT >= 0) {
    L.inkT += dt;
    if (L.inkT >= INK_WIND) {
      L.inkT = -1; L.inkCd = 22; L.inkedT = 3; L.glareT = 0;
      _p.copy(SIPHON).applyMatrix4(L.body.matrixWorld);
      deployInk(_p);
      _c.lerpVectors(_p, player.pos, 0.65);
      deployInk(_c);
      if (_c.distanceTo(player.pos) < 14) ev.inkDim = 1;
      if (!L.inkSaid) { L.inkSaid = true; L.pendingMsg = L.pendingMsg || 'SHE CLOUDS THE WATER. THE LIGHT CANNOT FIND HER.'; }
    }
  }

  // ---- arms: drape, creep, probe, freeze, lash, grab, flinch ----
  const lit = player.light > 0.25 && L.inkedT <= 0;
  L.lashCd -= dt;
  // probers: two arms that test the silt toward him, re-chosen every ~7 s; one comes from
  // behind him (where the camera is not looking)
  L.probeT -= dt;
  if (hunting && !reveal && L.probeT <= 0) {
    L.probeT = 6 + Math.random() * 3;
    camera.getWorldDirection(_cf);
    L.probeAng[0] = Math.atan2(-_cf.x, -_cf.z) + (Math.random() - 0.5) * 0.9;     // behind him
    L.probeAng[1] = Math.atan2(_cf.x, _cf.z) + (Math.random() < 0.5 ? 1 : -1) * (0.9 + Math.random() * 0.6);
    let k = 0;
    for (let a = 0; a < NA && k < 2; a++) {
      const q = (a + L.probeRot) % NA, A = L.arms[q];
      if (A.lash > 0 || A.recoil > 0.3 || (L.grab && L.grab.arm === q)) continue;
      L.probeArm[k++] = q;
    }
    L.probeRot = (L.probeRot + 3) % NA;
  }
  if (!hunting || reveal) L.probeArm[0] = L.probeArm[1] = -1;
  if (L.still > 0) {
    L.still -= dt;
    if (L.still <= 0) { L.lashCd = 1.5; if (hunting && !L.grab) startLash(L, player, true); }
  }
  L.writheK += ((L.still > 0 ? 0 : 1) - L.writheK) * Math.min(1, dt * 5);
  let spd = 0;
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a];
    const liftGoal = L.calmed ? 0.15 : L.dormant ? 0 : 1;
    A.lift += clamp(liftGoal - A.lift, -dt * 0.35, dt * (0.18 + 0.04 * a));   // staggered
    // flinch: the lit lantern near the arm's inner third
    const nr = A.pts[RINGS >> 2].distanceTo(player.pos);
    const flinch = hunting && lit && nr < 11 ? 1 : 0;
    if (flinch && A.recoil < 0.1) {
      L.mood = Math.min(1, L.mood + 0.3);
      // the burned arm flashes; and she starts round the light
      flash(L, 0.55);
      if (L.circleCd <= 0) { L.circleT = 3.2; L.circleCd = 7; L.circleDir = Math.random() < 0.5 ? 1 : -1; L.behindNext = true; }
    }
    A.recoil += clamp(flinch - A.recoil, -dt * 0.6, dt * 2.5);
    // tip goal, and how the tip chases it (w, z of its spring) and how tightly it coils
    const held = L.grab && L.grab.arm === a;
    const probe = L.probeArm[0] === a || L.probeArm[1] === a;
    let w = 1.6, z = 1, curlT = L.dormant ? 7 : L.calmed ? 9 : 10;
    let tellT = 0;
    if (held) {
      A.tipGoal.copy(player.pos);
      w = 7; curlT = 3;
    } else if (A.lash > 0) {
      const was = A.lash;
      A.lash -= dt;
      if (A.lash > STRIKE_T) {
        // THE COCK: the arm draws back and up over her, coiling — and blanches: the tell
        _p.copy(A.base).sub(player.pos).setY(0).normalize();
        A.tipGoal.copy(A.base).addScaledVector(_p, L.R * 1.4);
        A.tipGoal.y += L.R * 2.4;
        w = 5; z = 0.8; curlT = 24; tellT = 1;
      } else {
        if (was > STRIKE_T) A.strikeN++;
        // THE STRIKE: the coil throws open at him (faster out of the freeze: the ambush)
        A.tipGoal.copy(player.pos);
        w = A.fast ? 9 : 7; z = 0.8; curlT = 1.5; tellT = 0.35;
        if (A.tip.distanceTo(player.pos) < 3.2 && !L.grab && A.recoil < 0.4) {
          // a grab is the DRAG, not a slam: no dress tear, the line is the teaching
          L.grab = { arm: a, t: 0 };
          ev.grabbed = true;
          ev.msg = ev.msg || 'IT HAS YOU. CUT IT.';
        }
      }
    } else if (L.still > 0) {
      // THE FREEZE: every arm stops where it is; she is a held breath
      A.tipGoal.copy(A.tip);
      w = 6;
    } else if (L.dormant || L.calmed) {
      // asleep the tips still creep a little over the silt — and, out of his sight, an arm
      // RESETTLES nearer him: silt hangs where it moved (the tell; it never touches him)
      if (L.dormant) {
        A.creepT -= dt; A.creepMove -= dt;
        if (L.aware > 0.35 && A.creepT <= 0 && A.tip.distanceTo(player.pos) > 7 && A.tip.distanceTo(player.pos) < 70 && !inView(A.tip, 0.55, 120)) {
          _p.set(player.pos.x - A.tip.x, 0, player.pos.z - A.tip.z).normalize();
          A.creep.addScaledVector(_p, 1.8 + Math.random() * 2.2);
          if (A.creep.length() > 8) A.creep.setLength(8);
          A.creepT = 3.5 + Math.random() * 5; A.creepMove = 1.8;
          L.creepN++; L.creepAt.copy(A.tip);
          emitDust(A.tip.x, terrainH(A.tip.x, A.tip.z, L.idx) + 0.2, A.tip.z, 10, 1.6);
        }
        if (A.creepMove > 0) {
          A.dustT -= dt;
          if (A.dustT <= 0) { A.dustT = 0.4; emitDust(A.tip.x, terrainH(A.tip.x, A.tip.z, L.idx) + 0.2, A.tip.z, 5, 1.1); }
        }
      }
      A.tipGoal.copy(A.drape);
      if (L.dormant) A.tipGoal.add(A.creep);
      A.tipGoal.x += nzO(L.t * 0.13, a * 3) * 0.8; A.tipGoal.z += nzO(L.t * 0.11, a * 5 + 1) * 0.8;
      w = A.creepMove > 0 ? 1.3 : 0.8;
    } else if (reveal && L.revealT > 2.2) {
      // THE WEB-OVER: the arms come up over him and down round him — a cage of her, and
      // no lash for its length (it is the reveal, not an attack)
      const k = smooth(L.revealT, 2.2, 6.5) * (1 - smooth(L.revealT, 7.2, REVEAL_DUR));
      _p.set(player.pos.x - L.pos.x, 0, player.pos.z - L.pos.z);
      const dl = Math.min(_p.length(), A.len * 0.7) || 1;
      _p.setLength(dl);
      const ang = a / NA * TAU + L.yaw, rr = 11 - 3 * k;
      _c.set(L.pos.x + _p.x + Math.sin(ang) * rr, 0, L.pos.z + _p.z + Math.cos(ang) * rr);
      _c.y = terrainH(_c.x, _c.z, L.idx) + 1.5 + 4 * (1 - k);
      A.tipGoal.copy(_c);
      w = 1.1; curlT = 6;
    } else if (probe && pd < L.AL * 1.1) {
      // PROBING: the tip tests the seabed toward him, closing in (silt puffs, sucker pops)
      const pi = L.probeArm[0] === a ? 0 : 1;
      const pr = 5 + 7 * smooth(L.probeT, 0, 6);
      _c.set(player.pos.x + Math.sin(L.probeAng[pi]) * pr, 0, player.pos.z + Math.cos(L.probeAng[pi]) * pr);
      _c.y = terrainH(_c.x, _c.z, L.idx) + 0.7;
      A.tipGoal.copy(_c);
      w = 1.3; curlT = 5;
      A.dustT -= dt;
      const sp = A.tipV.length();
      if (A.dustT <= 0 && sp > 0.6 && A.tip.y - _c.y < 2) {
        A.dustT = 0.45; emitDust(A.tip.x, _c.y - 0.5, A.tip.z, 4, 1.0);
        if (A.tip.distanceTo(player.pos) < 12) { L.popN++; L.popAt.copy(A.tip); }
      }
    } else {
      // awake idle: low and wide, reaching across the lair, tips just off the silt
      const ang = L.yaw + A.ang + Math.sin(L.t * 0.3 + A.phase) * 0.3;
      const rr = A.len * (0.66 + 0.1 * Math.sin(L.t * 0.5 + A.phase));
      const gx = L.pos.x + Math.sin(ang) * rr, gz = L.pos.z + Math.cos(ang) * rr;
      A.tipGoal.set(gx, terrainH(gx, gz, L.idx) + L.R * (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(L.t * 0.7 + A.phase))) + A.recoil * L.R * 2, gz);
    }
    // a flinching arm coils away from the light
    curlT += 10 * A.recoil;
    A.curl += (curlT - A.curl) * Math.min(1, 4 * dt);
    A.wrap += clamp((held ? 1 : 0) - A.wrap, -dt * 1.5, dt * 2.2);
    A.tell += clamp(tellT - A.tell, -dt * 2, dt * 6);
    L.cloudU.uTell.value[a + 1] = A.tell;
    // the tip: a damped spring toward its goal (was a constant-rate lerp)
    for (let c = 0; c < 3; c++) {
      const x = A.tip.getComponent(c), v = A.tipV.getComponent(c), g = A.tipGoal.getComponent(c);
      const nv = (v + w * w * dt * (g - x)) / (1 + 2 * z * w * dt + w * w * dt * dt);
      A.tipV.setComponent(c, nv); A.tip.setComponent(c, x + nv * dt);
    }
    spd += A.tipV.length();
  }
  L.moveK = Math.min(1, spd / NA / 8);
  // a new lash: inside her reach, never in the reveal or the ink wind-up. Half the time
  // she FREEZES first (1.2-2.2 s: breath held, skin dark, pupils blown, the bed silent)
  // and then comes the ambush — still through the cock.
  if (hunting && !reveal && !L.grab && L.still <= 0 && L.inkT < 0 && L.lashCd <= 0 && pd < L.AL * 0.85) {
    if (Math.random() < 0.5) { L.still = 1.2 + Math.random(); L.stillN++; L.lashCd = 99; }
    else startLash(L, player, false);
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
  // ---- the display: papillae, darkness, the flash, the web, the pupil, the beak ----
  L.deimT += dt;
  const deim = L.deimK * deimEnv(L.deimT);
  const stillK = L.still > 0 ? 1 : 0, grabK = L.grab ? 1 : 0;
  const papT = L.calmed ? 0.1 : L.dormant ? 0.12 + 0.6 * L.aware : Math.max(0.55 + 0.45 * near, stillK, grabK);
  const darkT = L.calmed ? 0 : L.dormant ? 0.15 * L.aware : Math.max(0.7 + 0.3 * near, stillK, grabK);
  const webT = L.calmed ? 0.1 : L.dormant ? 0 : reveal ? smooth(L.revealT, 1.5, 6) : 0.5 + 0.5 * near;
  const M = L.cloudU.uMen.value;
  L.pap += (papT - L.pap) * Math.min(1, dt * (papT > L.pap ? 1.6 : 0.5));
  L.dark += (darkT - L.dark) * Math.min(1, dt * (darkT > L.dark ? 2.5 : 0.6));
  L.web += (webT - L.web) * Math.min(1, dt * 1.2);
  M.set(L.pap, L.dark * (1 - deim), deim, L.web);
  const pupT = L.calmed || L.dormant ? 0 : Math.max(0.2, stillK, grabK, 0.6 * near);
  L.pupil += (Math.max(pupT, deim) - L.pupil) * Math.min(1, dt * (pupT > L.pupil ? 5 : 1.2));
  L.pupU.value = L.pupil;
  L.suckers.material.color.copy(L.suckBase).multiplyScalar(1 - 0.22 * L.dark * (1 - deim));
  L.puff += ((hunting ? near : 0) - L.puff) * Math.min(1, dt);
  L.loomE += ((hunting ? 1 - smooth(pd, L.AL * 0.35, L.AL * 0.9) : 0) - L.loomE) * Math.min(1, dt * 0.7);
  L.rearE += (grabK - L.rearE) * Math.min(1, dt * 1.5);
  {
    const Bk = L.beak;
    Bk.ev += ((grabK ? 1 : hunting ? 0.2 * L.loomE : 0) - Bk.ev) * Math.min(1, dt * 2);
    const was = Bk.open;
    if (grabK) { Bk.ph += dt * 1.9; Bk.open = Math.pow(0.5 + 0.5 * Math.sin(Bk.ph * TAU * 0.5), 1.6); }
    else Bk.open += ((hunting ? 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(L.t * 1.3)) : 0) - Bk.open) * Math.min(1, dt * 3);
    if (was > 0.3 && Bk.open < 0.08) Bk.snapN++;
  }

  poseHoarder(L, dt, player);
  // the ink wind-up: the siphon swells (after poseHoarder's breath write)
  if (L.inkT >= 0) L.cloudU.uSiph.value = 0.12 * smooth(L.inkT, 0, INK_WIND * 0.8);
  L.armsInit = true;

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
    let rem = 0;
    for (const q of L.sigils) if (!q.lit) rem++;
    ev.remaining = rem;
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
      g.halo.scale.setScalar(haloK * 0.55);
      g.halo.material.opacity = 0.4;
      g.rune.material.opacity = 0.9;
      g.light.userData.scatter = 0.05;
    }
  }
  wardFlashes(L, dt, null);
  stageHoard(L, dt);
  L.pPrev.copy(player.pos);
  return ev;
}

// ---- THE STAGING (encounter pass) ---------------------------------------------------
// No light is ever added (the count is sacred). The ward pool's five lights are STAGED:
// a ward that needs its light (rung by the sonar, lit, flashing, calmed) owns it; while it
// sleeps dark its light serves the hoard instead. Slot 5 (she has four wards) is always
// hers: the lantern cradled in her web.
//   ASLEEP: four lanterns burn low in her coils (slots 1-4) and one in her web under her
//     face (slot 5): she is a sleeping mass lit from below by the lights she keeps.
//   WAKING (the rite): the coil lanterns go out first, one by one, then the hoard; as they
//     die the lanterns caught in her web KINDLE — she has drawn the light in. Awake she
//     carries it: uplit from inside her web, her arms black against her own glow.
//   CALMED: the web settles to an ember and the wards take the lighthouse.
// A slot changing source fades out where it is, jumps, and fades in: never a pop.
const _sw = V3();
// the rig's numbers in one place (window.__stageO for look-dev)
const SO = { heapI: 90, heapR: 32, heapS: 1.0, webI: 110, webS: 0.25, cradleI: 40, coilI: 42, coilR: 26, coilS: 0.1, seatI: 40 };
if (typeof window !== 'undefined') window.__stageO = SO;
function stageHoard(L, dt) {
  const H = L.hoard, st = L.stage;
  if (!st) return;
  // the web: its kindling follows the hoard going out
  const dark = H.dark < 0 ? 0 : smooth(H.dark, 6.0, 11.0);
  // the heap behind her holds out longest: it gutters while she rises and dies as she stands
  if (L.heap && H.dark > 7.5) L.heap.on = Math.max(0, L.heap.on - dt * 0.7);
  const webT = L.calmed ? 0.3 : L.dormant ? 0.35 : 0.35 + 0.65 * dark;
  L.webK += (webT - L.webK) * Math.min(1, dt * 0.8);
  const flick = 0.86 + 0.08 * Math.sin(L.t * 7.1) * Math.sin(L.t * 2.3) + 0.06 * Math.sin(L.t * 13.7);
  if (L.webGlass) L.webGlass.emissiveIntensity = 2.2 * L.webK * flick;
  // the coil lanterns: out first, a beat apart, as she stirs
  for (let k = 0; k < L.clutch.length; k++) {
    const c = L.clutch[k];
    if (H.dark >= 0 && H.dark > 0.2 + k * 0.55) c.on = Math.max(0, c.on - dt * 1.4);
  }
  for (let i = 0; i < st.length; i++) {
    const pl = sigilPool[i], s = st[i], g = i < L.sigils.length ? L.sigils[i] : null;
    if (g && (g.lit || g.rev > 0.01 || g.flashT < 1.5 || L.calmed)) {
      // the ward has it (its own code set intensity and position this frame)
      if (s.src !== -2) { s.src = -2; s.cur = 0; pl.color.setHex(WARD_COL); pl.distance = 50; pl.userData.lampBias = undefined; }
      // lifted off the sucker face (a light on the skin only grazes it)
      pl.position.copy(g.grp.position).addScaledVector(_sw.set(0, 0, 1).applyQuaternion(g.grp.quaternion), 1.6);
      continue;
    }
    // what this slot should be serving: 0-3 the coil lantern k, 10-12 a web seat (11 is the
    // one in the web at her front: the key), 13 the cradle under her beak, 30 the heap
    let want = -1, I = 0;
    if (i === 4) {
      // THE HEAP behind her (the backlight, lamp-B's source) until it gutters out in the
      // rite; then this slot moves into her web, the light she drew in.
      if (L.heap && L.heap.on > 0.02 && !L.calmed) { want = 30; I = SO.heapI * L.heap.on * (0.93 + 0.07 * Math.sin(L.t * 3.1)); }
      else { want = 11; I = SO.webI * L.webK * flick; }     // the lantern caught in the web at her front
    } else if (i === 3 && L.dormant) { want = 13; I = SO.cradleI * L.webK * flick; }       // the cradled lantern under her face
    else if (L.dormant || (L.clutch[i] && L.clutch[i].on > 0.02)) { want = i; I = SO.coilI * H.hushE * (L.clutch[i] ? L.clutch[i].on : 0) * (0.9 + 0.1 * Math.sin(L.t * 6.3 + i * 2.1)); }
    else if (i < 2 && L.webSeats && L.webSeats.length > 2) { want = i === 0 ? 10 : 12; I = SO.seatI * L.webK * flick * (L.calmed ? 0.5 : 1); }
    if (s.src !== want) {
      s.cur = Math.max(0, s.cur - dt * 60);
      if (s.cur <= 0) { s.src = want; }
    } else s.cur += clamp(I - s.cur, -dt * 60, dt * 40);
    pl.intensity = s.cur;
    if (s.src < 0) continue;
    pl.color.setHex(FLAME);
    pl.decay = 2.0;
    if (s.src === 30) {
      pl.position.copy(L.heap.pos);
      pl.distance = SO.heapR;
      pl.userData.scatter = SO.heapS; pl.userData.lampBias = 4;
    } else if (s.src < 10) {
      pl.position.copy(L.clutch[s.src].pos);
      pl.distance = SO.coilR;
      pl.userData.scatter = SO.coilS; pl.userData.lampBias = undefined;
    } else {
      const seat = s.src < 13 && L.webSeats && L.webSeats[s.src - 10];
      if (seat) pl.position.copy(_sw.copy(seat).applyMatrix4(L.body.matrixWorld));
      else pl.position.copy(_sw.set(0, -0.5, 0.84).applyMatrix4(L.body.matrixWorld));
      pl.distance = 30;
      // the web lantern is the encounter's key: it holds the in-scatter slot while she is up
      pl.userData.scatter = SO.webS; pl.userData.lampBias = s.src === 11 ? 3 : undefined;
    }
  }
}
