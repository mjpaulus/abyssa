// Predators: shark (zones 0-1), octopus (floor dens, all zones), squid (zone 2).
// OWNED BY: predator agent.
//
// Contract with game.js:
//   buildPredators()            — called once at world build.
//   switchPredatorZone(zi)      — called from enterZone(zi).
//   updatePredators(dt, t, player, lanternPos) — every play frame. Returns an event
//     object (allocate once, reuse): {
//       threat: 0..1     — proximity/aggression scalar for audio dread
//       bite: 0|force    — a strike landed this frame (oxygen leak + shake + msg)
//       lightSteal: 0..1 — light being drained this frame (octopus grab / squid nibble)
//       inkPickup: 0|n   — ink sacs collected this frame (adds to survival.ink)
//     }
//   slash(pos, fwd, range)      — the knife arc landed; kills a squid or spooks a hunter.
//   deployInk(pos)              — vents a carried sac as a shark-breaking cloud.
//   reseedDens()                 — call after flora rebuilds (new dive site): every
//     boulder moved, so octopus dens (picked once at build from flora's rockColliders)
//     are re-picked against the live pool. Safe to call mid-chase; fires no event.
//
// Cost model, mirroring creatures.js: the CPU steers a handful of bodies (1 shark,
// 3 octopuses, 4 squid in the active zone) and everything expensive — spine
// undulation, eight-arm curl chains, tentacle sway, photophore strobing — lives in
// vertex/fragment shaders. Only the active zone is stepped; the rest are
// visible=false and skipped entirely. Nothing is allocated per frame.
import * as THREE from 'three';
import { scene } from '../core.js';
import { WORLD_R, zoneTop, zoneBottom } from '../config.js';
import { rng, clamp, lerp, V3 } from '../lib/math.js';
import { glowTex, makeGlow } from '../lib/textures.js';
import { terrainH } from './terrain.js';
import { rockColliders } from './flora.js';

// ---------------------------------------------------------------------------
// shared plumbing
// ---------------------------------------------------------------------------

const ev = { threat: 0, bite: 0, lightSteal: 0, inkPickup: 0 };

const uTime = { value: 0 };
const uFogD = { value: 0.016 };

const TAU = Math.PI * 2;
const CULL = 205;                       // nothing is visible past the fog wall

// hot-path temps — module-owned, never allocated per frame
const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _lp = V3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _sc = V3(1, 1, 1);
// combat temps — slash/deployInk/pickups run outside the steering loops, but keeping
// them separate means a future reorder can never alias the hot-path scratch above.
const _k1 = V3(), _k2 = V3(), _k3 = V3();
const UP = V3(0, 1, 0);

// Additive/alpha billboards must fade to black with distance rather than toward the
// fog colour — same trick creatures.js uses for its glow fields.
const FOG_GLSL = `
uniform float uFogD;
float fogVis(vec3 wp){ float d = length(wp - cameraPosition); return exp(-uFogD*uFogD*d*d); }`;
const TONE_OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

function zoneMidY(zi) { return (zoneTop(zi) + zoneBottom(zi)) * 0.5; }

// Turn `fwd` toward `want` by at most `rate` radians, keeping it unit length. This is
// what makes every predator arc rather than snap — the whole read of a hunter.
function steer(fwd, want, rate, dt) {
  const wl = want.length();
  if (wl < 1e-5) return;
  want.divideScalar(wl);
  const dot = clamp(fwd.dot(want), -1, 1);
  const ang = Math.acos(dot);
  if (ang < 1e-4) { fwd.copy(want); return; }
  const step = Math.min(ang, rate * dt);
  // rotate fwd toward want about their common perpendicular
  _d.crossVectors(fwd, want);
  if (_d.lengthSq() < 1e-8) _d.set(0, 1, 0); else _d.normalize();
  _q.setFromAxisAngle(_d, step);
  fwd.applyQuaternion(_q).normalize();
}

// Billboarded quad field, shared shape for ink puffs and squid photophores.
function billboardField(n, mat) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(quad.index);
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  g.instanceCount = n;
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  quad.dispose();
  return m;
}

function billboardMaterial(blending, alphaExpr) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: glowTex }, uFogD },
    vertexShader: `
      attribute vec3 aPos; attribute float aSize; attribute vec4 aCol;
      varying vec2 vUv; varying vec4 vC; varying float vFog;
      ${FOG_GLSL}
      void main(){
        vFog = fogVis(aPos);
        vec4 mv = viewMatrix * vec4(aPos, 1.0);
        mv.xy += position.xy * aSize;
        gl_Position = projectionMatrix * mv;
        vUv = uv; vC = aCol;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec2 vUv; varying vec4 vC; varying float vFog;
      void main(){
        float a = texture2D(uMap, vUv).a;
        ${alphaExpr}
        ${TONE_OUT}
      }`,
    transparent: true, depthWrite: false, blending
  });
}

// ---------------------------------------------------------------------------
// SHARK — geometry
// ---------------------------------------------------------------------------

// Radius profile, keyed by hand: blunt-conical snout, thickest just behind the first
// dorsal, then a long taper into a narrow peduncle. Interpolated with smoothstep so
// the silhouette has no visible facets at 40u.
const SHARK_R = [
  [0.000, 0.020], [0.040, 0.130], [0.100, 0.265], [0.175, 0.385],
  [0.280, 0.455], [0.380, 0.470], [0.500, 0.442], [0.640, 0.338],
  [0.780, 0.212], [0.890, 0.120], [1.000, 0.062]
];

function sharkR(t) {
  for (let i = 1; i < SHARK_R.length; i++) {
    if (t <= SHARK_R[i][0]) {
      const a = SHARK_R[i - 1], b = SHARK_R[i];
      let u = (t - a[0]) / (b[0] - a[0]);
      u = u * u * (3 - 2 * u);
      return lerp(a[1], b[1], u);
    }
  }
  return SHARK_R[SHARK_R.length - 1][1];
}

// Body runs along +Z, snout at z=+0.5. uv.x = 0 snout .. 1 peduncle (and past 1 on the
// caudal fin, so the shader whips it harder); uv.y = 0 belly, 1 dorsal ridge, 2.0 flags
// fin geometry. Same convention as creatures.js fish, so the shading code rhymes.
function sharkGeometry() {
  const RINGS = 26, SIDES = 12;
  const pos = [], uv = [], idx = [];
  // Fineness ratio matters more than any other number here: a pelagic shark is about
  // 5.5 body lengths long for its depth. Anything fatter reads as a tuna.
  const W = 0.158, H = 0.205;           // sharks are taller than wide
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS, r = sharkR(t), z = 0.5 - t;
    for (let j = 0; j < SIDES; j++) {
      const ang = j / SIDES * TAU;
      const s = Math.sin(ang), c = Math.cos(ang);
      // flatten the belly and the top of the head — reads as a shark, not a tube
      const flat = s < 0 ? 0.86 : 1.0;
      const headSquash = 1 - 0.22 * Math.max(0, 1 - t * 6) * Math.max(0, s);
      pos.push(c * r * W, s * r * H * flat * headSquash, z);
      uv.push(t, 0.5 + 0.5 * s);
    }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SIDES; j++) {
    const a = i * SIDES + j, b = i * SIDES + (j + 1) % SIDES;
    idx.push(a, a + SIDES, b, b, a + SIDES, b + SIDES);
  }

  const fin = (verts, tris) => {
    const base = pos.length / 3;
    for (const v of verts) { pos.push(v[0], v[1], v[2]); uv.push(v[3], 2.0); }
    for (const tri of tris) idx.push(base + tri[0], base + tri[1], base + tri[2]);
  };

  // heterocercal caudal: long swept upper lobe, short lower lobe, deep notch
  const zT = -0.5;
  fin([
    [0, 0.016, zT + 0.015, 1.00],      // 0 peduncle top
    [0, -0.014, zT + 0.015, 1.00],     // 1 peduncle bottom
    [0, 0.185, zT - 0.315, 1.22],      // 2 upper lobe tip
    [0, 0.028, zT - 0.130, 1.10],      // 3 notch
    [0, -0.098, zT - 0.145, 1.15]      // 4 lower lobe tip
  ], [[0, 3, 2], [0, 1, 3], [1, 4, 3]]);

  // first dorsal — tall, raked back; the read at range
  const d0 = sharkR(0.36) * H, d1 = sharkR(0.55) * H;
  fin([[0, d0 * 0.96, 0.5 - 0.36, 0.36], [0, d1 * 0.96, 0.5 - 0.56, 0.56],
  [0, d0 + 0.118, 0.5 - 0.495, 0.46]], [[0, 2, 1]]);
  // second dorsal — small
  const e0 = sharkR(0.76) * H;
  fin([[0, e0 * 0.96, 0.5 - 0.76, 0.76], [0, sharkR(0.855) * H * 0.96, 0.5 - 0.855, 0.855],
  [0, e0 + 0.034, 0.5 - 0.825, 0.80]], [[0, 2, 1]]);
  // pectorals — long and swept, angled down; the widest thing on the animal
  const pr = sharkR(0.28) * W;
  for (const s of [-1, 1]) fin([
    [s * pr * 0.92, -0.014, 0.5 - 0.235, 0.235],
    [s * pr * 0.92, -0.030, 0.5 - 0.330, 0.330],
    [s * (pr + 0.152), -0.082, 0.5 - 0.400, 0.40]
  ], [[0, 1, 2], [0, 2, 1]]);
  // pelvics
  const vr = sharkR(0.62) * W;
  for (const s of [-1, 1]) fin([
    [s * vr * 0.9, -sharkR(0.62) * H * 0.72, 0.5 - 0.60, 0.60],
    [s * vr * 0.9, -sharkR(0.68) * H * 0.72, 0.5 - 0.68, 0.68],
    [s * (vr + 0.048), -sharkR(0.65) * H * 0.72 - 0.040, 0.5 - 0.665, 0.66]
  ], [[0, 1, 2], [0, 2, 1]]);
  // anal fin
  fin([[0, -sharkR(0.80) * H * 0.82, 0.5 - 0.80, 0.80],
  [0, -sharkR(0.875) * H * 0.82, 0.5 - 0.875, 0.875],
  [0, -sharkR(0.83) * H * 0.82 - 0.030, 0.5 - 0.855, 0.84]], [[0, 1, 2], [0, 2, 1]]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(V3(0, 0, -0.15), 1.1);
  return g;
}

// Undulation is a travelling wave whose amplitude is near zero at the skull and peaks
// at the tail — carangiform, i.e. tighter and stiffer than the leviathan's ribbon.
function sharkMaterial(cfg) {
  const u = {
    uPhase: { value: 0 }, uAmp: { value: 0.045 }, uArch: { value: 0 }, uTime,
    uDark: { value: new THREE.Color(cfg.dark) },
    uPale: { value: new THREE.Color(cfg.pale) },
    uSheen: { value: cfg.sheen }
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.46, metalness: 0.16,
    side: THREE.DoubleSide, emissive: 0x000000
  });
  mat.userData.u = u;
  // Three caches compiled programs by material type + parameters, NOT by the source
  // onBeforeCompile produced. Without a distinct key the shark, octopus and squid — all
  // MeshStandardMaterial — collide and get whichever program compiled first.
  mat.customProgramCacheKey = () => 'abyssa-shark';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uPhase; uniform float uAmp; uniform float uArch;
        varying vec2 vSuv;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float bT = uv.x;
        float env = 0.02 + 0.98 * pow(clamp(bT, 0.0, 1.3), 2.35);
        float amp = uAmp * env;
        float slope = cos(bT*4.6 - uPhase) * amp * 4.6;
        objectNormal = normalize(vec3(objectNormal.x, objectNormal.y, objectNormal.z + slope*objectNormal.x));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sin(bT*4.6 - uPhase) * amp;
        // strike arch: the whole body bows, so the turn-in reads before it happens
        transformed.x += uArch * env * 0.16;
        transformed.y += sin(uPhase*0.37) * 0.006;
        vSuv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uDark; uniform vec3 uPale; uniform float uSheen;
        varying vec2 vSuv;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float body = step(vSuv.y, 1.5);
        float yy = clamp(vSuv.y, 0.0, 1.0);
        // crisp counter-shade line: dark dorsal above, near-white ventral below
        float cs = smoothstep(0.26, 0.44, yy);
        vec3 hide = mix(uPale, uDark, cs);
        // dermal mottle so the flank is not a flat gradient
        hide *= 0.90 + 0.14*sin(vSuv.x*46.0)*sin(yy*23.0);
        // five gill slits behind the head
        float gx = smoothstep(0.30, 0.20, vSuv.x) * smoothstep(0.135, 0.175, vSuv.x);
        float gs = pow(0.5 + 0.5*sin((vSuv.x-0.15)*190.0), 8.0) * gx * step(yy, 0.72) * step(0.18, yy);
        hide *= 1.0 - 0.55*gs;
        // eye: a black bead, present on both flanks because uv.y is side-symmetric
        float eye = smoothstep(0.038, 0.012, length(vec2((vSuv.x-0.088)*1.9, yy-0.775)));
        hide = mix(hide, vec3(0.012, 0.014, 0.018), eye);
        // fins take a mid tone, a touch darker than the flank
        vec3 finc = mix(uPale, uDark, 0.72);
        diffuseColor.rgb *= mix(finc, hide, body);
        // faint wet sheen along the lateral line keeps the silhouette legible in murk
        float lat = smoothstep(0.075, 0.012, abs(yy - 0.46)) * body;
        totalEmissiveRadiance += uDark * lat * uSheen;`);
  };
  return mat;
}

// ---------------------------------------------------------------------------
// SHARK — behaviour
// ---------------------------------------------------------------------------

const SHARK_CFG = [
  { zi: 0, size: 6.6, dark: 0x35474f, pale: 0xd6e0dc, sheen: 0.10, patrolR: 62 },
  { zi: 1, size: 8.6, dark: 0x262c46, pale: 0x9fa9c4, sheen: 0.30, patrolR: 56 }
];

// Tuning, all in one place.
const SH = {
  patrolSpeed: 5.2, interestSpeed: 7.6, windupSpeed: 9.5, strikeSpeed: 22, fleeSpeed: 19,
  patrolTurn: 0.42, interestTurn: 0.75, windupTurn: 1.5, strikeTurn: 2.1, fleeTurn: 0.8,
  senseR: 90,                 // beyond this the diver simply isn't noticed
  interestIn: 0.55, interestOut: 0.28, strikeAt: 0.95,
  interestR: 25, windupR: 12,
  minInterest: 10,            // seconds of circling before a strike is even possible
  windupT: 1.6, strikeT: 3.0, fleeT: 3.5,
  biteR: 3.0, coolMin: 30, coolMax: 60
};

const sharks = [];

function buildShark(cfg) {
  const geo = sharkGeometry();
  const mat = sharkMaterial(cfg);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(cfg.size / 1.34);   // geometry is 1.34 long nose-to-tail-tip
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.castShadow = false;
  scene.add(mesh);

  const a = rng(0, TAU), r = cfg.patrolR;
  const S = {
    cfg, mesh, mat, u: mat.userData.u,
    pos: V3(Math.cos(a) * r, zoneMidY(cfg.zi), Math.sin(a) * r),
    fwd: V3(Math.cos(a + 1.57), 0, Math.sin(a + 1.57)).normalize(),
    center: V3(0, zoneMidY(cfg.zi), 0),
    state: 'patrol', tState: 0, arousal: 0, cool: 0, cruised: 0,
    orbitPh: a, orbitR: cfg.patrolR, speed: SH.patrolSpeed,
    beat: Math.random() * 30, arch: 0, roll: 0, bit: false, blinded: 0
  };
  sharks.push(S);
  return S;
}

function sharkSetState(S, s) { S.state = s; S.tState = 0; }

function updateShark(S, dt, t, p) {
  const cfg = S.cfg;
  const dx = p.pos.x - S.pos.x, dy = p.pos.y - S.pos.y, dz = p.pos.z - S.pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-5;
  S.tState += dt;
  S.cool = Math.max(0, S.cool - dt);

  // ---- arousal: what makes a shark curious, and what makes it lose interest ----
  let excite = 0;
  if (dist < SH.senseR) {
    const prox = 1 - dist / SH.senseR;
    const spd = p.vel.length();
    excite = prox * (0.25 + clamp(spd / 14, 0, 1) * 0.80 + p.light * 0.50);
    // counterplay: stand still on the floor, and/or let the lantern burn low
    if (p.grounded && spd < 1.6) excite *= 0.25;
    if (p.light < 0.25) excite *= 0.40;
  }
  S.arousal = clamp(S.arousal + (excite - 0.42) * dt * 0.5, 0, 1.2);
  if (S.cool > 0) S.arousal = Math.min(S.arousal, 0.45);

  // ---- ink: the counterplay. A hunting shark that eats a cloud loses the diver ----
  // Checked before the FSM so the abort lands on the same frame the snout enters the
  // murk — a charge that continues for even a tenth of a second reads as a hit.
  const hunting = S.state === 'interest' || S.state === 'windup' || S.state === 'strike';
  if (hunting && cloudBreaksLock(S, p)) {
    sharkSetState(S, 'flee');
    S.arousal = 0;
    S.cool = Math.max(S.cool, CL.cool);
    S.bit = true;                 // no bite can land out of an aborted run
    S.blinded = 1;
  }
  S.blinded = Math.max(0, S.blinded - dt * 0.5);

  // ---- state machine ----
  switch (S.state) {
    case 'patrol':
      if (S.arousal > SH.interestIn && dist < SH.senseR * 0.8) { sharkSetState(S, 'interest'); S.orbitR = Math.min(dist, 55); }
      break;
    case 'interest':
      if (S.arousal < SH.interestOut) sharkSetState(S, 'patrol');
      else if (S.arousal > SH.strikeAt && S.tState > SH.minInterest && S.cool <= 0 && dist < 42) {
        sharkSetState(S, 'windup'); S.bit = false;
      }
      break;
    case 'windup':
      if (S.tState > SH.windupT) sharkSetState(S, 'strike');
      break;
    case 'strike':
      if (!S.bit && dist < SH.biteR) {
        S.bit = true; ev.bite = 1;
        sharkSetState(S, 'flee');
      } else if (S.tState > SH.strikeT) sharkSetState(S, 'flee');
      break;
    case 'flee':
      if (S.tState > SH.fleeT) {
        sharkSetState(S, 'patrol');
        S.arousal = 0; S.cool = rng(SH.coolMin, SH.coolMax);
        S.orbitR = cfg.patrolR;
      }
      break;
  }

  // ---- steering target per state ----
  let speed = SH.patrolSpeed, turn = SH.patrolTurn, wantArch = 0;
  const st = S.state;
  if (st === 'patrol') {
    // wide lazy circuits about a slowly drifting centre
    S.center.x = Math.sin(t * 0.021) * WORLD_R * 0.22;
    S.center.z = Math.cos(t * 0.017) * WORLD_R * 0.22;
    S.center.y = zoneMidY(cfg.zi) + Math.sin(t * 0.05) * 34;
    S.orbitPh += dt * 0.10;
    S.orbitR += (cfg.patrolR - S.orbitR) * Math.min(1, dt * 0.4);
    _a.set(S.center.x + Math.cos(S.orbitPh) * S.orbitR, S.center.y, S.center.z + Math.sin(S.orbitPh) * S.orbitR);
  } else if (st === 'flee') {
    speed = SH.fleeSpeed; turn = SH.fleeTurn;
    // a shark that just ate a cloud of ink does not leave on a lazy arc: it throws the
    // whole body into the turn, which is the read that makes the sac feel like a tool
    if (S.blinded > 0) { turn = SH.fleeTurn * (1 + S.blinded * 2.2); wantArch = -0.45 * S.blinded; }
    _a.set(S.pos.x - dx / dist * 120, S.pos.y - dy / dist * 30 + 8, S.pos.z - dz / dist * 120);
  } else {
    // interest / windup: circle the diver, tightening
    const wantR = st === 'windup' ? SH.windupR : SH.interestR;
    speed = st === 'windup' ? SH.windupSpeed : SH.interestSpeed;
    turn = st === 'windup' ? SH.windupTurn : SH.interestTurn;
    if (st === 'strike') {
      speed = SH.strikeSpeed; turn = SH.strikeTurn; wantArch = 0.25;
      // lead the diver slightly so the pass looks committed, not homing
      _a.copy(p.pos).addScaledVector(p.vel, 0.30);
    } else {
      const k = st === 'windup' ? Math.min(1, S.tState / SH.windupT) : 0;
      if (st === 'windup') wantArch = k;
      S.orbitR += (wantR - S.orbitR) * Math.min(1, dt * 0.9);
      S.orbitPh += dt * speed / Math.max(6, S.orbitR);
      _a.set(p.pos.x + Math.cos(S.orbitPh) * S.orbitR, p.pos.y + Math.sin(t * 0.31) * 3.5,
        p.pos.z + Math.sin(S.orbitPh) * S.orbitR);
      // The telegraph: over the wind-up the circling target slides onto the diver, so
      // the shark is already lined up when it commits. Without this it enters the run
      // travelling tangentially and the pass sails harmlessly by.
      if (k > 0) _a.lerp(p.pos, k * 0.85);
    }
  }

  // keep the circuit inside the world and off the seabed
  const hr = Math.hypot(_a.x, _a.z);
  if (hr > WORLD_R * 0.82) { const k = WORLD_R * 0.82 / hr; _a.x *= k; _a.z *= k; }
  const aFloor = terrainH(_a.x, _a.z, cfg.zi) + cfg.size * 0.55 + 3;
  _a.y = clamp(_a.y, aFloor, zoneTop(cfg.zi) - 8);

  _b.copy(_a).sub(S.pos);
  steer(S.fwd, _b, turn, dt);
  S.speed += (speed - S.speed) * Math.min(1, dt * (st === 'strike' ? 5.0 : 2.2));
  S.pos.addScaledVector(S.fwd, S.speed * dt);

  // hard terrain floor — nothing swims through the seabed
  const floor = terrainH(S.pos.x, S.pos.z, cfg.zi) + cfg.size * 0.42 + 1.2;
  if (S.pos.y < floor) { S.pos.y = floor; if (S.fwd.y < 0) { S.fwd.y *= -0.3; S.fwd.normalize(); } }
  const ceil = zoneTop(cfg.zi) - 5;
  if (S.pos.y > ceil) { S.pos.y = ceil; if (S.fwd.y > 0) { S.fwd.y *= -0.3; S.fwd.normalize(); } }
  const phr = Math.hypot(S.pos.x, S.pos.z);
  if (phr > WORLD_R * 0.95) { const k = WORLD_R * 0.95 / phr; S.pos.x *= k; S.pos.z *= k; }

  // ---- pose: heading + bank into the turn ----
  const bankWant = clamp(-(S.fwd.z * _b.x - S.fwd.x * _b.z) / Math.max(1, _b.length()) * 1.5, -0.7, 0.7);
  S.roll += (bankWant - S.roll) * Math.min(1, dt * 3);
  _m.lookAt(_c.set(0, 0, 0), _d.copy(S.fwd).negate(), UP);
  _q.setFromRotationMatrix(_m);
  S.mesh.position.copy(S.pos);
  S.mesh.quaternion.copy(_q);
  S.mesh.rotateZ(S.roll);

  // tail beat accelerates with intent; integrate phase so rate changes never pop
  const beatRate = 2.6 + S.speed * 0.55;
  S.beat += dt * beatRate;
  if (S.beat > 6283.18) S.beat -= 6283.18;
  S.arch += (wantArch - S.arch) * Math.min(1, dt * 4);
  S.u.uPhase.value = S.beat;
  S.u.uAmp.value = 0.030 + 0.032 * clamp(S.speed / SH.strikeSpeed, 0, 1) + S.arch * 0.020;
  S.u.uArch.value = S.arch;

  S.mesh.visible = dist < CULL;

  // ---- threat feed ----
  const prox = clamp(1 - dist / 70, 0, 1);
  const base = st === 'strike' ? 1.0 : st === 'windup' ? 0.85 : st === 'interest' ? 0.55
    : st === 'flee' ? 0.30 : 0.10;
  const th = base * (0.35 + 0.65 * prox);
  if (th > ev.threat) ev.threat = th;
}

// ---------------------------------------------------------------------------
// OCTOPUS — geometry
// ---------------------------------------------------------------------------

// One merged geometry: a lathed mantle plus eight arm tubes. aOct packs
// (T along arm, arm angle, ring angle, kind) — kind 0 = mantle, 1 = arm. Everything
// about the pose is evaluated in the vertex shader from three uniforms, so eight
// liquid arms cost the CPU exactly nothing.
function octopusGeometry() {
  const pos = [], nrm = [], oct = [], idx = [];

  // ---- mantle: a closed egg-shaped sack, widest low, with two eye knobs ----
  // v = 0 at the underside pole, 1 at the crown. Closed at both ends so the animal
  // reads as a solid body rather than a hood or a bell.
  const MR = 16, MS = 16;
  const mProfile = v => 0.475 * Math.pow(Math.sin(Math.pow(v, 0.80) * Math.PI), 0.78);
  const mHeight = v => -0.30 + Math.pow(v, 0.92) * 1.02;
  const mBase = pos.length / 3;
  for (let i = 0; i <= MR; i++) {
    const v = i / MR, r = mProfile(v), y = mHeight(v);
    for (let j = 0; j < MS; j++) {
      const ang = j / MS * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      // eye knobs: two bumps low on the sides, where an octopus actually carries them
      const eyeB = Math.pow(Math.max(0, Math.abs(c)), 10.0) * Math.max(0, 1 - Math.abs(v - 0.30) * 7.0) * 0.15;
      const rr = r + eyeB;
      // slightly wider than deep, so the sack lies rather than stands
      pos.push(c * rr * 1.06, y + eyeB * 0.25, s * rr * 0.90);
      const dr = (mProfile(Math.min(1, v + 0.03)) - mProfile(Math.max(0, v - 0.03)));
      const dy = (mHeight(Math.min(1, v + 0.03)) - mHeight(Math.max(0, v - 0.03)));
      nrm.push(c * dy, -dr, s * dy);
      oct.push(v, ang, 0, 0);
    }
  }
  for (let i = 0; i < MR; i++) for (let j = 0; j < MS; j++) {
    const a = mBase + i * MS + j, b = mBase + i * MS + (j + 1) % MS;
    idx.push(a, a + MS, b, b, a + MS, b + MS);
  }

  // ---- arms: eight tapering tubes, 5-sided ----
  const ARMS = 8, SEG = 9, SID = 5;
  for (let k = 0; k < ARMS; k++) {
    const ang = (k + 0.5) / ARMS * TAU;
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const T = i / SEG;
      for (let j = 0; j < SID; j++) {
        const r = j / SID * TAU;
        pos.push(0, 0, 0);        // fully generated in the vertex shader
        nrm.push(0, 1, 0);
        oct.push(T, ang, r, 1);
      }
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < SID; j++) {
      const a = base + i * SID + j, b = base + i * SID + (j + 1) % SID;
      idx.push(a, a + SID, b, b, a + SID, b + SID);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aOct', new THREE.Float32BufferAttribute(oct, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(V3(), 3);
  return g;
}

// Arm kinematics, mirrored nowhere on the CPU because nothing on the CPU needs it:
//   rest   — arms splayed down and tucked against the rock, coiled short
//   active — arms lift and splay, and the ones facing the light reach for it
// Staggered phase per arm plus a T^2 drag term gives the liquid, lagging motion.
const OCT_DEFORM = /* glsl */`
  attribute vec4 aOct;
  uniform float uReach; uniform float uSeed; uniform float uActive; uniform float uGrab;
  uniform vec3 uDir;
  varying float vOctT; varying float vOctK; varying float vOctA;
  void octDeform(out vec3 P, out vec3 N){
    float kind = aOct.w;
    if (kind < 0.5) {
      // mantle: breathes, and swells upright as the animal rouses. At rest it is
      // squashed against the rock — half the read of the camouflage is the silhouette.
      float br = sin(uTime*0.9 + uSeed)*0.020;
      float flatten = 1.0 - uReach;
      P = position * vec3(1.0 + br + flatten*0.16, (1.0 - br) * (1.0 - flatten*0.34), 1.0 + br + flatten*0.16);
      P.y += uReach*0.22 + 0.34;
      N = normalize(normal);
    } else {
      float T = aOct.x, A = aOct.y, R = aOct.z;
      vec3 ca = vec3(cos(A), 0.0, sin(A));
      vec3 flatD = vec3(uDir.x, 0.0, uDir.z);
      flatD = length(flatD) > 1e-4 ? normalize(flatD) : ca;
      // only the arms facing the light commit to it; the rest hold station
      float w = pow(max(0.0, dot(ca, flatD)), 3.0) * uReach;
      // at rest the arms fold down and inward against the rock; roused, they splay,
      // and the ones facing the light stretch toward it
      vec3 restD = normalize(vec3(ca.x*1.15, -0.50, ca.z*1.15));
      vec3 openD = normalize(vec3(ca.x, -0.18, ca.z));
      vec3 actD  = normalize(mix(openD, normalize(uDir), w * 0.92));
      vec3 D = normalize(mix(restD, actD, uReach));
      float jitter = fract(sin(A*12.9898 + uSeed)*43758.5453);
      float len = mix(0.66, 1.72, uReach) * (0.84 + 0.32*jitter);
      vec3 rt = normalize(cross(D, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
      vec3 up2 = cross(rt, D);
      float ph = uTime*(1.15 + 0.55*uReach) + A*2.3 + uSeed;
      // T^1.6 drag, two harmonics out of phase: a chain that lags itself, i.e. liquid
      float drag = pow(T, 1.6);
      float amp = (0.20 + 0.34*uReach) * (1.0 + uGrab*0.55);
      float s1 = sin(T*4.4 - ph) * amp;
      float s2 = cos(T*2.9 - ph*0.68 + jitter*6.28) * amp * 0.85;
      vec3 c = D*(T*len) + rt*(s1*drag*len) + up2*(s2*drag*len);
      // curl: arm tips coil under, hard when idle, loosely when reaching
      c += up2 * (T*T*len * mix(-0.42, 0.16, uReach));
      c.y -= drag * 0.62 * (1.0 - uReach);   // at rest the arms drape flat on the silt
      float rad = (0.172 - 0.158*T) * mix(0.94, 1.08, uReach);
      vec3 rn = rt*cos(R) + up2*sin(R);
      P = c + rn*rad;
      P.xz += ca.xz * 0.24;                          // arms leave from the skirt
      P.y += 0.14;
      N = normalize(rn + D*0.12);
    }
    vOctT = aOct.x; vOctK = kind; vOctA = aOct.y;
  }`;

function octopusMaterial(zi) {
  const P = OCT_PAL[zi];
  const u = {
    uTime, uReach: { value: 0 }, uSeed: { value: Math.random() * 6.283 },
    uActive: { value: 0 }, uGrab: { value: 0 }, uDir: { value: V3(1, 0, 0) },
    uSkin: { value: new THREE.Color(P.skin) },
    uHot: { value: new THREE.Color(P.hot) },
    uGlow: { value: new THREE.Color(P.glow) }
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.93, metalness: 0.0,
    side: THREE.DoubleSide, emissive: 0x000000
  });
  mat.userData.u = u;
  mat.customProgramCacheKey = () => 'abyssa-octopus';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        ${OCT_DEFORM}`)
      .replace('#include <beginnormal_vertex>', `
        vec3 _oP; vec3 _oN; octDeform(_oP, _oN);
        vec3 objectNormal = _oN;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = _oP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSkin; uniform vec3 uHot; uniform vec3 uGlow;
        uniform float uActive; uniform float uGrab; uniform float uTime;
        varying float vOctT; varying float vOctK; varying float vOctA;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // at rest the skin sits on the silt palette; rousing flushes it warmer and
        // raises papillae contrast, which is what sells the reveal
        vec3 skin = mix(uSkin, uHot, uActive*0.75);
        float papilla = 0.5 + 0.5*sin(vOctA*9.0 + vOctT*38.0 + uTime*0.4);
        skin *= 0.40 + 0.26*papilla*(0.45 + 0.55*uActive);
        // suckers: a bright dotted line down the underside of each arm
        float suck = pow(0.5 + 0.5*sin(vOctT*54.0), 10.0) * step(0.5, vOctK);
        skin = mix(skin, uHot*1.10, suck*0.5*(0.3 + 0.7*uActive));
        // arm tips pale out
        skin *= mix(1.0, 1.14, step(0.5, vOctK) * pow(vOctT, 2.0));
        diffuseColor.rgb *= skin;
        // dim bioluminescent ring around the eyes / along reaching arms
        // a whisper of bioluminescence at the arm tips only — enough to catch the eye
        // in the dark, never enough to overwhelm the skin it sits on
        float tipGlow = step(0.5, vOctK) * pow(vOctT, 4.0);
        totalEmissiveRadiance += uGlow * (uActive*0.015 + uGrab*0.075) * (0.10 + tipGlow*0.90);`);
  };
  return mat;
}

const OCT_PAL = [
  { skin: 0x33444c, hot: 0xc25c2e, glow: 0x5cffc4 },   // zone 0 — silt grey-teal
  { skin: 0x342c47, hot: 0x9d47b4, glow: 0xa878ff },   // zone 1 — indigo
  { skin: 0x2c221e, hot: 0xb04a1c, glow: 0xff9455 }    // zone 2 — near-black rust
];

// Tuning.
const OC = {
  wakeR: 8, breakR: 13, wakeT: 0.9, reachT: 1.1, grabT: 2.6, fleeT: 3.2, backT: 3.0,
  steal: 0.25, coolMin: 22, coolMax: 36, perZone: 3
};

const octos = [];

// A den is a boulder big enough to hide behind; the animal sits tucked at its base.
function pickDens(zi, n) {
  const top = zoneTop(zi), bot = zoneBottom(zi);
  const pool = [];
  for (let i = 0; i < rockColliders.length; i++) {
    const c = rockColliders[i];
    if (c.y > top + 40 || c.y < bot - 60) continue;
    if (c.r < 2.4) continue;
    pool.push(c);
  }
  const out = [];
  for (let k = 0; k < n && pool.length; k++) {
    const idx = (Math.random() * pool.length) | 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function buildOctopuses() {
  const geo = octopusGeometry();
  for (let zi = 0; zi < 3; zi++) {
    const dens = pickDens(zi, OC.perZone);
    for (const rock of dens) {
      const mat = octopusMaterial(zi);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      // Tucked against the outside of the boulder, not inside it: the rock is cover to
      // hide behind, and the silhouette has to break against it rather than vanish.
      const scale = rng(1.5, 2.2);
      const a = rng(0, TAU), r = rock.r + scale * 0.75;
      const x = rock.x + Math.cos(a) * r, z = rock.z + Math.sin(a) * r;
      const y = terrainH(x, z, zi) + 0.2;
      mesh.scale.setScalar(scale);
      scene.add(mesh);
      octos.push({
        zi, mesh, mat, u: mat.userData.u,
        den: V3(x, y, z), pos: V3(x, y, z), jet: V3(),
        state: 'den', tState: 0, cool: rng(0, 10), reach: 0, active: 0, grab: 0
      });
    }
  }
}

function octSet(O, s) { O.state = s; O.tState = 0; }

function updateOctopus(O, dt, t, p, lp) {
  O.tState += dt;
  O.cool = Math.max(0, O.cool - dt);
  const lit = p.light > 0.15;
  const ld = O.pos.distanceTo(lp);
  const pd = O.pos.distanceTo(p.pos);

  let wantReach = 0, wantActive = 0, wantGrab = 0;

  switch (O.state) {
    case 'den':
      if (O.cool <= 0 && lit && ld < OC.wakeR) octSet(O, 'wake');
      break;
    case 'wake':
      wantActive = 1; wantReach = 0.5;
      if (!lit || ld > OC.breakR) { octSet(O, 'settle'); }
      else if (O.tState > OC.wakeT) octSet(O, 'reach');
      break;
    case 'reach':
      wantActive = 1; wantReach = 1;
      _a.copy(lp).sub(O.pos);
      if (_a.lengthSq() > 1e-4) O.u.uDir.value.copy(_a).normalize();
      if (!lit || ld > OC.breakR) octSet(O, 'settle');
      else if (O.tState > OC.reachT) octSet(O, 'grab');
      break;
    case 'grab': {
      wantActive = 1; wantReach = 1; wantGrab = 1;
      _a.copy(lp).sub(O.pos);
      if (_a.lengthSq() > 1e-4) O.u.uDir.value.copy(_a).normalize();
      ev.lightSteal = Math.max(ev.lightSteal, OC.steal);
      if (ev.threat < 0.20) ev.threat = 0.20;
      if (!lit || ld > OC.breakR || O.tState > OC.grabT) {
        // ink and go: the puff covers the escape, exactly as it should
        _b.copy(O.pos).sub(p.pos);
        if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0.3);
        _b.normalize();
        spawnInk(O.pos, _b, 30, O.zi);
        O.jet.copy(_b).multiplyScalar(11).setY(3.2);
        octSet(O, 'flee');
      }
      break;
    }
    case 'flee':
      wantActive = 0.6; wantReach = 0.18;
      O.pos.addScaledVector(O.jet, dt);
      O.jet.multiplyScalar(Math.pow(0.35, dt));
      O.jet.y -= 3.0 * dt;
      if (O.tState > OC.fleeT) octSet(O, 'return');
      break;
    case 'return': {
      wantActive = 0.25; wantReach = 0.10;
      const k = Math.min(1, dt * 1.1);
      O.pos.lerp(O.den, k);
      if (O.tState > OC.backT || O.pos.distanceToSquared(O.den) < 0.05) {
        O.pos.copy(O.den);
        octSet(O, 'den'); O.cool = rng(OC.coolMin, OC.coolMax);
      }
      break;
    }
    case 'settle':
      wantActive = 0.3; wantReach = 0.12;
      if (O.tState > 1.2) { octSet(O, 'den'); O.cool = rng(6, 12); }
      break;
  }

  // never sink into the seabed
  const floor = terrainH(O.pos.x, O.pos.z, O.zi) + 0.2;
  if (O.pos.y < floor) { O.pos.y = floor; if (O.jet.y < 0) O.jet.y = 0; }
  O.mesh.position.copy(O.pos);

  O.reach += (wantReach - O.reach) * Math.min(1, dt * 2.6);
  O.active += (wantActive - O.active) * Math.min(1, dt * 2.0);
  O.grab += (wantGrab - O.grab) * Math.min(1, dt * 4.0);
  O.u.uReach.value = O.reach;
  O.u.uActive.value = O.active;
  O.u.uGrab.value = O.grab;

  O.mesh.visible = pd < 130;
}

// ---------------------------------------------------------------------------
// ink puffs — shared pool, alpha-blended dark so it actually occludes
// ---------------------------------------------------------------------------

// 176 rather than 112: a vented sac is 60 billboards, and the mechanic only works if a
// second sac can be thrown while the first still hangs in the water. Two clouds plus an
// octopus puff is the worst realistic case, and the pool has to cover it or the older
// cloud visibly evaporates mid-fight.
const INK_N = 176;
let inkMesh = null;
const inkP = new Float32Array(INK_N * 3), inkV = new Float32Array(INK_N * 3);
const inkLife = new Float32Array(INK_N), inkMax = new Float32Array(INK_N);
const inkSize = new Float32Array(INK_N), inkTint = new Float32Array(INK_N * 3);
let inkHead = 0, inkAlive = 0;

const INK_COL = [[0.012, 0.020, 0.026], [0.014, 0.012, 0.026], [0.018, 0.013, 0.011]];

function buildInk() {
  const mat = billboardMaterial(THREE.NormalBlending,
    'gl_FragColor = vec4(vC.rgb, a * vC.a * mix(0.15, 1.0, vFog));');
  inkMesh = billboardField(INK_N, mat);
  inkMesh.renderOrder = 3;
  inkMesh.visible = false;
  scene.add(inkMesh);
}

// Scalar knobs rather than an options object: this is called from three places and an
// object literal per call would be an allocation on a gameplay beat.
//   spread  — radius of the initial cluster (how big the puff starts)
//   push    — how hard the particles are thrown against `dir`
//   lifeK   — life multiplier: 1 = octopus escape puff, ~1.4 = a vented sac
//   sizeK   — per-billboard size multiplier
function spawnInk(at, dir, n, zi, spread = 0.8, push = 1, lifeK = 1, sizeK = 1) {
  const col = INK_COL[zi];
  for (let k = 0; k < n; k++) {
    const i = inkHead; inkHead = (inkHead + 1) % INK_N;
    if (inkLife[i] <= 0) inkAlive++;
    const i3 = i * 3;
    inkP[i3] = at.x + rng(-spread, spread);
    inkP[i3 + 1] = at.y + rng(-spread * 0.6, spread * 1.2);
    inkP[i3 + 2] = at.z + rng(-spread, spread);
    // the puff hangs where it was released and slowly billows; the animal is what moves
    inkV[i3] = (rng(-0.7, 0.7) - dir.x * rng(0.8, 2.4)) * push;
    inkV[i3 + 1] = rng(-0.15, 0.7) * push;
    inkV[i3 + 2] = (rng(-0.7, 0.7) - dir.z * rng(0.8, 2.4)) * push;
    inkMax[i] = inkLife[i] = rng(4.5, 7.5) * lifeK;
    inkSize[i] = rng(2.4, 4.8) * sizeK;
    inkTint[i3] = col[0]; inkTint[i3 + 1] = col[1]; inkTint[i3 + 2] = col[2];
  }
}

// ---------------------------------------------------------------------------
// vented ink clouds — the *volume* a shark loses its target inside
// ---------------------------------------------------------------------------

// The billboards above are only the look. Behaviour needs a coarse volume to test
// against, so a vented sac also registers a sphere here: a handful of records, preallocated.
const CLOUD_N = 3;
const CL = { r0: 5.0, r1: 9.5, life: 8.0, headR: 14, cool: 20, n: 60 };
const clouds = [];
for (let i = 0; i < CLOUD_N; i++) clouds.push({ pos: V3(), r: CL.r0, life: 0 });

function spawnCloud(at) {
  let C = null;
  for (let i = 0; i < CLOUD_N; i++) if (clouds[i].life <= 0) { C = clouds[i]; break; }
  // all three already hanging in the water: pick the oldest rather than refuse
  if (!C) { C = clouds[0]; for (let i = 1; i < CLOUD_N; i++) if (clouds[i].life < C.life) C = clouds[i]; }
  C.pos.copy(at); C.r = CL.r0; C.life = CL.life;
  return C;
}

function updateClouds(dt) {
  for (let i = 0; i < CLOUD_N; i++) {
    const C = clouds[i];
    if (C.life <= 0) continue;
    C.life -= dt;
    // matches the billboards, which grow as they thin
    const u = 1 - Math.max(0, C.life) / CL.life;
    C.r = CL.r0 + (CL.r1 - CL.r0) * u;
    C.pos.y += 0.22 * dt;                 // ink is buoyant; it creeps upward
  }
}

// True when this shark should lose the diver: either it has driven its own head into
// the murk, or the diver is standing inside it and simply cannot be seen.
function cloudBreaksLock(S, p) {
  for (let i = 0; i < CLOUD_N; i++) {
    const C = clouds[i];
    if (C.life <= 0) continue;
    // the head, not the centroid — a shark aborts when its snout hits the wall of ink
    _k1.copy(S.pos).addScaledVector(S.fwd, S.cfg.size * 0.45);
    if (_k1.distanceToSquared(C.pos) < CL.headR * CL.headR) return true;
    const pr = C.r + 1.5;
    if (p.pos.distanceToSquared(C.pos) < pr * pr) return true;
  }
  return false;
}

function updateInk(dt) {
  if (!inkAlive) { if (inkMesh.visible) inkMesh.visible = false; return; }
  inkMesh.visible = true;
  const ap = inkMesh.geometry.attributes.aPos.array;
  const as = inkMesh.geometry.attributes.aSize.array;
  const ac = inkMesh.geometry.attributes.aCol.array;
  let alive = 0;
  for (let i = 0; i < INK_N; i++) {
    if (inkLife[i] <= 0) { as[i] = 0; ac[i * 4 + 3] = 0; continue; }
    inkLife[i] -= dt;
    if (inkLife[i] <= 0) { as[i] = 0; ac[i * 4 + 3] = 0; continue; }
    alive++;
    const i3 = i * 3;
    inkP[i3] += inkV[i3] * dt;
    inkP[i3 + 1] += inkV[i3 + 1] * dt;
    inkP[i3 + 2] += inkV[i3 + 2] * dt;
    const damp = Math.pow(0.25, dt);
    inkV[i3] *= damp; inkV[i3 + 1] = inkV[i3 + 1] * damp + 0.25 * dt; inkV[i3 + 2] *= damp;
    const u = 1 - inkLife[i] / inkMax[i];
    ap[i3] = inkP[i3]; ap[i3 + 1] = inkP[i3 + 1]; ap[i3 + 2] = inkP[i3 + 2];
    as[i] = inkSize[i] * (0.55 + u * 2.3);           // the cloud spreads as it thins
    const o = i * 4;
    ac[o] = inkTint[i3]; ac[o + 1] = inkTint[i3 + 1]; ac[o + 2] = inkTint[i3 + 2];
    ac[o + 3] = 0.98 * Math.min(1, (1 - u) * 2.6) * Math.min(1, u * 16);
  }
  inkAlive = alive;
  inkMesh.geometry.attributes.aPos.needsUpdate = true;
  inkMesh.geometry.attributes.aSize.needsUpdate = true;
  inkMesh.geometry.attributes.aCol.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// ink sacs — the pickup a dead squid leaves behind
// ---------------------------------------------------------------------------

// Deliberately the same pickup language as the light motes in rifts.js: a small faceted
// body, a tight glow, a wide halo, and a homing radius the player learns once and
// applies everywhere. The read is the palette — motes are green-white and weightless,
// sacs are near-black with a violet sheen and hang heavier in the water.
const SAC_N = 4;
const SAC = { life: 90, homeR: 11, takeR: 3.4, dissolve: 2.5 };
const sacs = [];
let sacGeo = null, sacMat = null;

function buildSacs() {
  sacGeo = new THREE.IcosahedronGeometry(0.46, 1);
  // wet and dark: low roughness so the lantern picks out two or three facets at a time,
  // which is all it takes for the thing to read as glistening rather than matte
  sacMat = new THREE.MeshStandardMaterial({
    color: 0x0e0a14, roughness: 0.17, metalness: 0.55,
    emissive: new THREE.Color(0x2a1046)
  });
  for (let i = 0; i < SAC_N; i++) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(sacGeo, sacMat));
    grp.add(makeGlow(0x9a5cff, 3.2));
    const halo = makeGlow(0x6b2ad6, 7);
    halo.material.opacity = 0.20;
    grp.add(halo);
    grp.visible = false;
    scene.add(grp);
    sacs.push({ grp, alive: false, life: 0, ph: Math.random() * 7, baseY: 0, spin: Math.random() * 7 });
  }
}

function spawnSac(at) {
  let S = null;
  for (let i = 0; i < SAC_N; i++) if (!sacs[i].alive) { S = sacs[i]; break; }
  // four already in the water is plenty; recycle the one closest to dissolving
  if (!S) { S = sacs[0]; for (let i = 1; i < SAC_N; i++) if (sacs[i].life < S.life) S = sacs[i]; }
  S.grp.position.copy(at);
  S.baseY = at.y;
  S.alive = true; S.life = SAC.life;
  S.grp.visible = true;
  S.grp.scale.setScalar(1);
  return S;
}

function updateSacs(dt, t, p) {
  for (let i = 0; i < SAC_N; i++) {
    const S = sacs[i];
    if (!S.alive) continue;
    S.life -= dt;
    if (S.life <= 0) { S.alive = false; S.grp.visible = false; continue; }
    const g = S.grp;
    S.spin += dt * 0.8;
    g.rotation.y = S.spin;
    g.rotation.x = S.spin * 0.4;
    const d = g.position.distanceTo(p.pos);
    // hangs where it fell, lolling on the current, until the diver is close enough
    g.position.y = S.baseY + Math.sin(t * 1.15 + S.ph) * 0.55;
    if (d < SAC.homeR) {
      g.position.lerp(p.pos, Math.min(1, dt * clamp((SAC.homeR - d) / 8, 0, 1) * 2.2));
      S.baseY = g.position.y;
    }
    const pulse = 3.0 + 1.1 * Math.sin(t * 2.1 + S.ph);
    g.children[1].scale.setScalar(pulse);
    g.children[2].scale.setScalar(6.5 + 2.2 * Math.sin(t * 1.3 + S.ph * 1.7));
    // the last couple of seconds: it thins out and goes, rather than blinking off
    if (S.life < SAC.dissolve) g.scale.setScalar(Math.max(0.02, S.life / SAC.dissolve));
    if (d < SAC.takeR) {
      S.alive = false; S.grp.visible = false;
      ev.inkPickup++;
    }
  }
}

// ---------------------------------------------------------------------------
// SQUID — geometry (instanced: one shoal, one draw)
// ---------------------------------------------------------------------------

// Mantle along +Z with the pointed tail at -Z and the arm crown trailing forward, so
// the shoal reads as arms-first hovering. aSq packs (T, crownAngle, kind) — kind 0
// mantle, 1 fin, 2 arm, 3 tentacle. Arms sway entirely in the vertex shader.
function squidGeometry() {
  const pos = [], nrm = [], sq = [], idx = [];

  const MR = 12, MS = 10;
  const prof = v => {                          // v: 0 tail tip .. 1 head
    const s = Math.sin(Math.pow(v, 0.62) * Math.PI * 0.94);
    return Math.max(0.012, s * 0.20 * (1 - 0.30 * v * v));
  };
  for (let i = 0; i <= MR; i++) {
    const v = i / MR, r = prof(v), z = -0.5 + v * 0.68;
    for (let j = 0; j < MS; j++) {
      const ang = j / MS * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      pos.push(c * r, s * r, z);
      nrm.push(c, s, 0.15);
      sq.push(v, ang, 0, 0);
    }
  }
  for (let i = 0; i < MR; i++) for (let j = 0; j < MS; j++) {
    const a = i * MS + j, b = i * MS + (j + 1) % MS;
    idx.push(a, a + MS, b, b, a + MS, b + MS);
  }

  // caudal fins: two triangular flags either side of the tail
  const flag = (verts, tris, kind) => {
    const base = pos.length / 3;
    for (const v of verts) { pos.push(v[0], v[1], v[2]); nrm.push(0, 1, 0); sq.push(v[3], v[4], 0, kind); }
    for (const tri of tris) idx.push(base + tri[0], base + tri[1], base + tri[2]);
  };
  for (const s of [-1, 1]) flag([
    [0, 0, -0.50, 0.0, 0], [0, 0, -0.20, 0.4, 0], [s * 0.26, 0, -0.365, 1.0, 0]
  ], [[0, 1, 2], [0, 2, 1]], 1);

  // arm crown: 8 short arms + 2 long feeding tentacles, 3-sided tubes
  const mk = (n, kind, segs, off) => {
    for (let k = 0; k < n; k++) {
      const ang = (k + off) / n * TAU;
      const base = pos.length / 3;
      for (let i = 0; i <= segs; i++) {
        const T = i / segs;
        for (let j = 0; j < 3; j++) { pos.push(0, 0, 0); nrm.push(0, 1, 0); sq.push(T, ang, j / 3 * TAU, kind); }
      }
      for (let i = 0; i < segs; i++) for (let j = 0; j < 3; j++) {
        const a = base + i * 3 + j, b = base + i * 3 + (j + 1) % 3;
        idx.push(a, a + 3, b, b, a + 3, b + 3);
      }
    }
  };
  mk(8, 2, 5, 0.5);
  mk(2, 3, 7, 0.25);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aSq', new THREE.Float32BufferAttribute(sq, 4));
  g.setIndex(idx);
  return g;
}

const SQ_DEFORM = /* glsl */`
  attribute vec4 aSq;
  attribute vec3 aSqI;         // per-instance: phase, jet 0..1, death 0..1
  uniform float uTime;
  varying float vSqT; varying float vSqK; varying float vSqA; varying float vSqP;
  varying float vSqD;
  void sqDeform(out vec3 P, out vec3 N){
    float kind = aSq.w;
    float ph = uTime*2.1 + aSqI.x;
    float die = aSqI.z;
    if (kind < 1.5) {
      // mantle + fins: the funnel squeeze that drives the jet
      float squeeze = aSqI.y;
      P = position;
      P.xy *= 1.0 - 0.26*squeeze;
      P.z *= 1.0 + 0.10*squeeze;
      // dying: the mantle clenches once and then goes slack and slightly wrinkled
      P.xy *= 1.0 - 0.30*die;
      P.z *= 1.0 + 0.16*die;
      if (kind > 0.5) {
        // fin undulation, a slow travelling ripple
        float T = aSq.x;
        P.y += sin(T*4.0 + ph*0.8)*0.055*T;
      }
      N = normalize(normal);
    } else {
      float T = aSq.x, A = aSq.y, R = aSq.z;
      float longArm = step(2.5, kind);
      float len = mix(0.30, 0.62, longArm) * (1.0 + 0.22*aSqI.y);
      vec3 ca = vec3(cos(A), sin(A), 0.0);
      // arms fan out when hovering, clamp into a spear when jetting, and curl hard
      // inward and back over the crown in death — the single clearest signal of a kill
      float fan = mix(0.34, 0.10, aSqI.y);
      fan = mix(fan, 0.95, die);
      vec3 D = normalize(vec3(ca.xy*fan, 1.0 - 1.55*die));
      vec3 rt = normalize(cross(D, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
      vec3 up2 = cross(rt, D);
      float drag = T*T;
      float s1 = sin(T*4.2 - ph*1.5 + A*1.9) * (0.09 + 0.05*longArm) * (1.0 - 0.7*die);
      float s2 = cos(T*3.1 - ph*1.1 + A*2.7) * 0.07 * (1.0 - 0.7*die);
      vec3 c = vec3(0.0, 0.0, 0.18) + D*(T*len) + rt*(s1*drag*len*2.0) + up2*(s2*drag*len*2.0);
      float rad = (0.028 - 0.024*T) * mix(1.0, 0.7, longArm);
      vec3 rn = rt*cos(R) + up2*sin(R);
      P = c + rn*rad;
      N = normalize(rn + D*0.2);
    }
    vSqT = aSq.x; vSqK = kind; vSqA = aSq.y; vSqP = aSqI.x; vSqD = die;
  }`;

function squidMaterial() {
  const u = {
    uTime,
    uSkin: { value: new THREE.Color(0x3a2f3e) },
    uGlow: { value: new THREE.Color(0x7fe6ff) },
    uPulse: { value: 0 }
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.34, metalness: 0.30,
    side: THREE.DoubleSide, emissive: 0x000000
  });
  mat.userData.u = u;
  mat.customProgramCacheKey = () => 'abyssa-squid';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${SQ_DEFORM}`)
      .replace('#include <beginnormal_vertex>', `
        vec3 _sP; vec3 _sN; sqDeform(_sP, _sN);
        vec3 objectNormal = _sN;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = _sP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSkin; uniform vec3 uGlow; uniform float uPulse; uniform float uTime;
        varying float vSqT; varying float vSqK; varying float vSqA; varying float vSqP;
        varying float vSqD;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 skin = uSkin * (0.55 + 0.30*sin(vSqA*5.0 + vSqT*11.0));
        // chromatophores relax in death: the colour drains out to a pale slack grey
        skin = mix(skin, vec3(0.20, 0.19, 0.21), vSqD*0.75);
        // chromatophore speckle
        skin *= 0.8 + 0.5*pow(0.5+0.5*sin(vSqT*70.0 + vSqA*17.0), 3.0);
        skin *= mix(1.0, 1.5, step(1.5, vSqK));       // arms paler than the mantle
        diffuseColor.rgb *= skin;
        // photophore rows: a strobe that travels tail-to-head along the mantle
        float row = pow(0.5 + 0.5*sin(vSqA*4.0), 6.0) * step(vSqK, 0.5);
        float wave = pow(0.5 + 0.5*sin(vSqT*7.0 - uTime*5.5 + vSqP*3.0), 7.0);
        float tip  = step(1.5, vSqK) * pow(vSqT, 4.0);
        // dying photophores stutter for a moment at double rate, then go out for good
        float stut = mix(1.0, pow(0.5 + 0.5*sin(uTime*17.0 + vSqP*4.0), 2.0), step(0.02, vSqD));
        float lampsOut = (1.0 - vSqD) * (1.0 - vSqD);
        totalEmissiveRadiance += uGlow * uPulse * lampsOut * stut * (row*wave*1.5 + tip*0.8 + 0.025);`);
  };
  return mat;
}

// Tuning.
const SQ = {
  n: 4, sense: 130, orbitLo: 6, orbitHi: 12, jetImpulse: 10,
  nibbleEveryMin: 4.5, nibbleEveryMax: 9, nibbleT: 2.2, nibbleR: 3.6, steal: 0.10,
  outLight: 0.12,
  // death + the resource loop
  spasmT: 0.42,               // the curl snaps closed this fast
  deadT: 4.0,                 // total time from kill to despawn
  sinkV: 1.9,                 // how fast the slack body drifts down
  scatterT: 3.4,              // the whole shoal bolts for this long
  scatterImp: 26,             // impulse away from the kill
  respawnMin: 60, respawnMax: 120
};

let squidMesh = null, squidMat = null, squidU = null, squidI = null;
const squids = [];
let squidGlow = null, squidNibbleT = 0, squidPulse = 0;
const GLOW_PER = 5;

function buildSquid() {
  const geo = squidGeometry();
  squidMat = squidMaterial();
  squidU = squidMat.userData.u;
  const inst = new Float32Array(SQ.n * 3);
  for (let i = 0; i < SQ.n; i++) inst[i * 3] = Math.random() * 6.283;
  squidI = new THREE.InstancedBufferAttribute(inst, 3);
  geo.setAttribute('aSqI', squidI);
  squidMesh = new THREE.InstancedMesh(geo, squidMat, SQ.n);
  squidMesh.frustumCulled = false;
  squidMesh.visible = false;
  scene.add(squidMesh);

  const midY = zoneMidY(2);
  for (let i = 0; i < SQ.n; i++) {
    const a = rng(0, TAU), r = rng(40, 90);
    squids.push({
      i, pos: V3(Math.cos(a) * r, midY + rng(-30, 30), Math.sin(a) * r),
      vel: V3(), fwd: V3(0, 0, 1), size: rng(2.0, 3.0),
      jetT: rng(0, 1), jet: 0, orbitPh: rng(0, TAU), orbitR: rng(SQ.orbitLo, SQ.orbitHi),
      state: 'far', tState: 0, glow: 0,
      // combat: dead 0 = alive, 1 = corpse drifting, 2 = despawned and waiting
      dead: 0, deadT: 0, die: 0, respawn: 0, spin: 0, spinAx: V3(0, 1, 0)
    });
  }

  const mat = billboardMaterial(THREE.AdditiveBlending, 'gl_FragColor = vec4(vC.rgb * vC.a * vFog, a);');
  squidGlow = billboardField(SQ.n * GLOW_PER, mat);
  squidGlow.renderOrder = 4;
  squidGlow.visible = false;
  scene.add(squidGlow);
}

// ---- squid death: the whole kill beat, spread over four seconds ----------------
// Honest rather than showy: one spasm, the lamps stutter out, then a slack body that
// tumbles down into the dark. Nothing here allocates; the flourish is a curve on `die`.
function killSquidAt(Q, at) {
  Q.dead = 1; Q.deadT = 0; Q.die = 0; Q.state = 'dead';
  // a little kick along the blade's line, then it goes limp
  Q.vel.multiplyScalar(0.25);
  Q.spin = 0;
  Q.spinAx.set(rng(-1, 1), rng(-0.4, 0.4), rng(-1, 1));
  if (Q.spinAx.lengthSq() < 1e-4) Q.spinAx.set(0, 1, 0);
  Q.spinAx.normalize();

  // small dark burst from the mantle — the animal's own ink, not a vented sac
  _k3.set(rng(-0.4, 0.4), -0.6, rng(-0.4, 0.4)).normalize();
  spawnInk(at || Q.pos, _k3, 14, 2, 0.5, 0.7, 0.45, 0.55);

  // the shoal bolts: every survivor takes an impulse straight away from the kill
  for (const R of squids) {
    if (R === Q || R.dead) continue;
    R.state = 'scatter'; R.tState = 0;
    _k3.copy(R.pos).sub(Q.pos);
    if (_k3.lengthSq() < 1e-4) _k3.set(rng(-1, 1), rng(-1, 1), rng(-1, 1));
    _k3.normalize();
    R.vel.addScaledVector(_k3, SQ.scatterImp);
    R.jet = 1; R.jetT = rng(0.25, 0.5);
    R.orbitR = rng(SQ.orbitLo, SQ.orbitHi);
  }
}

function stepDeadSquid(Q, dt, p, im, ia, gp, gs, gc) {
  if (Q.dead === 2) {
    // gone: drifting back in from the dark on a long timer, so the loop is never finite
    Q.respawn -= dt;
    if (Q.respawn <= 0) {
      const a = rng(0, TAU), r = rng(72, 96);
      Q.pos.set(Math.cos(a) * r, zoneMidY(2) + rng(-26, 26), Math.sin(a) * r);
      Q.vel.set(0, 0, 0); Q.fwd.set(0, 0, 1);
      Q.dead = 0; Q.die = 0; Q.deadT = 0; Q.glow = 0; Q.jet = 0; Q.jetT = rng(0, 1);
      Q.state = 'far'; Q.tState = 0;
      // hand it straight back to the living path this frame — falling through to the
      // corpse code below would see the old deadT and bury it again on the spot
      return false;
    } else {
      const o = Q.i * 16;
      for (let k = 0; k < 16; k++) im[o + k] = 0;
      ia[Q.i * 3 + 1] = 0; ia[Q.i * 3 + 2] = 0;
      for (let k = 0; k < GLOW_PER; k++) {
        const gi = Q.i * GLOW_PER + k;
        gs[gi] = 0; gc[gi * 4 + 3] = 0;
      }
      return false;
    }
  }

  Q.deadT += dt;
  const s = Math.min(1, Q.deadT / SQ.spasmT);
  // the curl overshoots on the way closed — that snap is what reads as a spasm
  Q.die = s < 1 ? s * (1.18 - 0.18 * s) : 1;
  const flourish = 1 + 0.24 * Math.sin(Math.PI * s) * (1 - s * 0.35);
  const fade = clamp((SQ.deadT - Q.deadT) / 1.1, 0, 1);

  // limp: whatever momentum was left bleeds off, and it sinks
  Q.pos.addScaledVector(Q.vel, dt);
  Q.vel.multiplyScalar(Math.pow(0.30, dt));
  Q.vel.y -= SQ.sinkV * dt;
  if (Q.vel.y < -SQ.sinkV) Q.vel.y = -SQ.sinkV;
  const floor = terrainH(Q.pos.x, Q.pos.z, 2) + Q.size * 0.3 + 0.4;
  if (Q.pos.y < floor) { Q.pos.y = floor; Q.vel.y = 0; }
  Q.spin += dt * 0.9;

  _m.lookAt(_k1.set(0, 0, 0), _k2.copy(Q.fwd).negate(), UP);
  _q.setFromRotationMatrix(_m);
  _q2.setFromAxisAngle(Q.spinAx, Q.spin);
  _q.premultiply(_q2);
  _m.compose(Q.pos, _q, _sc.setScalar(Q.size * flourish * fade));
  const e = _m.elements, o = Q.i * 16;
  for (let k = 0; k < 16; k++) im[o + k] = e[k];
  ia[Q.i * 3 + 1] = 0;
  ia[Q.i * 3 + 2] = Q.die;

  // photophores gutter out with the body
  for (let k = 0; k < GLOW_PER; k++) {
    const gi = Q.i * GLOW_PER + k, g3 = gi * 3, g4 = gi * 4;
    const tt = k / (GLOW_PER - 1), zz = -0.42 + tt * 0.58;
    gp[g3] = Q.pos.x + Q.fwd.x * zz * Q.size;
    gp[g3 + 1] = Q.pos.y + Q.fwd.y * zz * Q.size + 0.12 * Q.size;
    gp[g3 + 2] = Q.pos.z + Q.fwd.z * zz * Q.size;
    const dying = (1 - Q.die) * (1 - Q.die) * fade;
    const flick = Math.pow(0.5 + 0.5 * Math.sin(Q.deadT * 26 - tt * 5 + Q.i * 2.1), 2);
    const amp = dying * (0.15 + 0.85 * flick);
    gs[gi] = Q.size * (0.09 + 0.17 * amp);
    gc[g4] = 0.34 * amp; gc[g4 + 1] = 0.72 * amp; gc[g4 + 2] = 0.86 * amp; gc[g4 + 3] = 1;
  }

  if (Q.deadT >= SQ.deadT) { Q.dead = 2; Q.respawn = rng(SQ.respawnMin, SQ.respawnMax); }
  return Q.pos.distanceToSquared(p.pos) < CULL * CULL;
}

function updateSquid(dt, t, p, lp) {
  const lit = p.light > SQ.outLight;
  squidNibbleT -= dt;

  // one nibbler at a time, and only when there is a light worth nibbling
  if (lit && squidNibbleT <= 0) {
    squidNibbleT = rng(SQ.nibbleEveryMin, SQ.nibbleEveryMax);
    let best = null, bd = 1e9;
    for (const Q of squids) {
      if (Q.state !== 'circle') continue;
      const d = Q.pos.distanceToSquared(lp);
      if (d < bd) { bd = d; best = Q; }
    }
    if (best && bd < 400) { best.state = 'nibble'; best.tState = 0; }
  }

  const gp = squidGlow.geometry.attributes.aPos.array;
  const gs = squidGlow.geometry.attributes.aSize.array;
  const gc = squidGlow.geometry.attributes.aCol.array;
  const im = squidMesh.instanceMatrix.array;
  const ia = squidI.array;
  let anyNear = false, maxProx = 0;

  for (const Q of squids) {
    if (Q.dead) {
      if (stepDeadSquid(Q, dt, p, im, ia, gp, gs, gc)) anyNear = true;
      continue;
    }
    Q.tState += dt;
    const dLight = Q.pos.distanceTo(lp);
    const dPlayer = Q.pos.distanceTo(p.pos);

    // ---- state ----
    // A kill outranks everything: the shoal will not come back to the light until the
    // panic has burned off, which is what makes one squid cost you the next few.
    if (Q.state === 'scatter') {
      if (Q.tState > SQ.scatterT) { Q.state = lit ? 'approach' : 'flee'; Q.tState = 0; }
    }
    else if (!lit) { if (Q.state !== 'flee') { Q.state = 'flee'; Q.tState = 0; } }
    else if (Q.state === 'far' || Q.state === 'flee') {
      if (dLight < SQ.sense) { Q.state = 'approach'; Q.tState = 0; }
    } else if (Q.state === 'approach') {
      if (dLight < SQ.orbitHi + 4) { Q.state = 'circle'; Q.tState = 0; }
    } else if (Q.state === 'nibble') {
      if (dLight < SQ.nibbleR) ev.lightSteal = Math.max(ev.lightSteal, SQ.steal);
      if (Q.tState > SQ.nibbleT) { Q.state = 'circle'; Q.tState = 0; Q.orbitR = rng(SQ.orbitLo, SQ.orbitHi); }
    }

    // ---- target ----
    let wantGlow = 0.15;
    if (Q.state === 'scatter') {
      // straight out and away from the lantern, lamps dumped to nearly nothing
      _a.copy(Q.pos).sub(lp);
      if (_a.lengthSq() < 1e-4) _a.set(1, 0.2, 0);
      _a.normalize().multiplyScalar(90).add(Q.pos);
      wantGlow = 0.02;
    } else if (Q.state === 'flee') {
      _a.copy(Q.pos).sub(lp);
      if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0);
      _a.normalize().multiplyScalar(150).add(Q.pos);
      wantGlow = 0.03;
    } else if (Q.state === 'approach') {
      _a.copy(lp);
      wantGlow = 0.55;
    } else if (Q.state === 'nibble') {
      _a.copy(lp);
      wantGlow = 1.25;
    } else if (Q.state === 'circle') {
      Q.orbitPh += dt * 0.55;
      _a.set(lp.x + Math.cos(Q.orbitPh) * Q.orbitR, lp.y + Math.sin(t * 0.6 + Q.i) * 2.2,
        lp.z + Math.sin(Q.orbitPh) * Q.orbitR);
      wantGlow = 0.85;
    } else {
      // 'far' — drift the abyss on a slow loop
      Q.orbitPh += dt * 0.06;
      _a.set(Math.cos(Q.orbitPh) * 80, zoneMidY(2) + Math.sin(t * 0.07 + Q.i) * 30, Math.sin(Q.orbitPh) * 80);
      wantGlow = 0.10;
    }
    const aFloor = terrainH(_a.x, _a.z, 2) + 3;
    _a.y = clamp(_a.y, aFloor, zoneTop(2) - 6);

    // ---- jet propulsion: impulses, not thrust; drift between them ----
    Q.jetT -= dt;
    _b.copy(_a).sub(Q.pos);
    const td = _b.length() + 1e-5;
    if (Q.jetT <= 0) {
      const urgency = Q.state === 'scatter' ? 2.1 : Q.state === 'nibble' ? 1.7
        : Q.state === 'flee' ? 1.5 : Q.state === 'approach' ? 1.15 : 0.8;
      Q.jetT = rng(0.55, 1.05) / urgency;
      Q.jet = 1;
      // Scale the impulse to the distance left, or a squid aiming at the lantern sails
      // straight past it and the nibble never lands.
      const gain = 0.30 + 0.70 * Math.min(1, td / 7);
      Q.vel.addScaledVector(_b.divideScalar(td), SQ.jetImpulse * urgency * gain);
      _b.multiplyScalar(td);           // restore for the heading code below
    }
    Q.jet = Math.max(0, Q.jet - dt * 3.2);
    Q.vel.multiplyScalar(Math.pow(0.16, dt));
    Q.pos.addScaledVector(Q.vel, dt);
    const floor = terrainH(Q.pos.x, Q.pos.z, 2) + Q.size * 0.4 + 0.8;
    if (Q.pos.y < floor) { Q.pos.y = floor; Q.vel.y = Math.abs(Q.vel.y) * 0.4; }
    const ceil = zoneTop(2) - 4;
    if (Q.pos.y > ceil) { Q.pos.y = ceil; Q.vel.y = -Math.abs(Q.vel.y) * 0.4; }
    const hr = Math.hypot(Q.pos.x, Q.pos.z);
    if (hr > WORLD_R * 0.9) { const k = WORLD_R * 0.9 / hr; Q.pos.x *= k; Q.pos.z *= k; }

    // heading follows travel; when nearly stopped, keep facing the light
    _c.copy(Q.vel);
    if (_c.lengthSq() < 0.35) _c.copy(_b);
    steer(Q.fwd, _c, 3.2, dt);

    _m.lookAt(_d.set(0, 0, 0), _c.copy(Q.fwd).negate(), UP);
    _q.setFromRotationMatrix(_m);
    _m.compose(Q.pos, _q, _sc.setScalar(Q.size));
    const e = _m.elements, o = Q.i * 16;
    for (let k = 0; k < 16; k++) im[o + k] = e[k];
    ia[Q.i * 3 + 1] = Q.jet;
    ia[Q.i * 3 + 2] = 0;

    Q.glow += (wantGlow - Q.glow) * Math.min(1, dt * 2.5);

    // ---- photophore halos: a row down the mantle, flickering in a travelling pulse ----
    for (let k = 0; k < GLOW_PER; k++) {
      const gi = Q.i * GLOW_PER + k, g3 = gi * 3, g4 = gi * 4;
      const tt = k / (GLOW_PER - 1);
      const zz = -0.42 + tt * 0.58;
      gp[g3] = Q.pos.x + Q.fwd.x * zz * Q.size;
      gp[g3 + 1] = Q.pos.y + Q.fwd.y * zz * Q.size + 0.12 * Q.size;
      gp[g3 + 2] = Q.pos.z + Q.fwd.z * zz * Q.size;
      const flick = Math.pow(0.5 + 0.5 * Math.sin(t * 5.5 - tt * 7 + Q.i * 2.1), 6);
      const amp = Q.glow * (0.25 + 0.95 * flick) * 0.9;
      gs[gi] = Q.size * (0.09 + 0.17 * amp);
      gc[g4] = 0.34 * amp; gc[g4 + 1] = 0.72 * amp; gc[g4 + 2] = 0.86 * amp; gc[g4 + 3] = 1;
    }

    if (dPlayer < CULL) anyNear = true;
    const prox = clamp(1 - dPlayer / 40, 0, 1) * (Q.state === 'nibble' ? 1 : 0.7);
    if (prox > maxProx) maxProx = prox;
    if (dLight < 60) squidPulse = Math.max(squidPulse, Q.glow);
  }

  squidMesh.instanceMatrix.needsUpdate = true;
  squidI.needsUpdate = true;
  squidGlow.geometry.attributes.aPos.needsUpdate = true;
  squidGlow.geometry.attributes.aSize.needsUpdate = true;
  squidGlow.geometry.attributes.aCol.needsUpdate = true;
  squidMesh.visible = anyNear;
  squidGlow.visible = anyNear;
  squidU.uPulse.value = squidPulse;
  squidPulse *= 0.9;

  const th = 0.26 * maxProx;
  if (th > ev.threat) ev.threat = th;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

let activeZone = -1;
let profN = 0, profSum = 0, profMax = 0;

export function buildPredators() {
  for (const cfg of SHARK_CFG) buildShark(cfg);
  buildOctopuses();
  buildInk();
  buildSquid();
  buildSacs();

  // Namespaced dev surface: teleport to each predator, read state, read cost.
  window.pred = {
    sharks, octos, squids,
    cost: () => ({
      frames: profN,
      avgMs: +(profSum / Math.max(1, profN)).toFixed(4),
      maxMs: +profMax.toFixed(4)
    }),
    resetCost: () => { profN = 0; profSum = 0; profMax = 0; },
    zone: zi => { switchPredatorZone(zi); return activeZone; },
    ev: () => ({
      threat: +ev.threat.toFixed(3), bite: ev.bite,
      lightSteal: +ev.lightSteal.toFixed(3), inkPickup: ev.inkPickup
    }),
    // Steady-state cost, measured off the render loop so a throttled rAF can't skew it.
    bench: (n = 1000, pl = null, lp = null) => {
      const p = pl || window.player;
      const t0 = performance.now();
      let t = 0;
      for (let i = 0; i < n; i++) { t += 1 / 60; updatePredators(1 / 60, t, p, lp || _lp); }
      const total = performance.now() - t0;
      return { frames: n, msPerFrame: +(total / n).toFixed(4), totalMs: +total.toFixed(1) };
    },
    state: () => ({
      zone: activeZone,
      shark: sharks.filter(s => s.cfg.zi === activeZone)
        .map(s => ({ state: s.state, arousal: +s.arousal.toFixed(2), cool: +s.cool.toFixed(1), d: 0 })),
      octo: octos.filter(o => o.zi === activeZone).map(o => ({ state: o.state, reach: +o.reach.toFixed(2) })),
      squid: activeZone === 2
        ? squids.map(q => q.dead === 2 ? `gone(${q.respawn.toFixed(0)}s)`
          : q.dead ? `dead(${q.deadT.toFixed(1)}s)` : q.state)
        : [],
      ink: inkAlive,
      clouds: clouds.filter(c => c.life > 0).map(c => ({ life: +c.life.toFixed(1), r: +c.r.toFixed(1) })),
      sacs: sacs.filter(s => s.alive).length
    }),
    // Debug teleports. Pass a player object in (game.js exposes window.player).
    goShark: pl => {
      const S = sharks.find(s => s.cfg.zi === activeZone);
      if (!S) return 'no shark in this zone';
      pl.pos.set(S.pos.x + 18, S.pos.y, S.pos.z + 18); pl.vel.set(0, 0, 0);
      return S.state;
    },
    goOcto: pl => {
      const O = octos.find(o => o.zi === activeZone);
      if (!O) return 'no octopus in this zone';
      pl.pos.set(O.den.x + 4, O.den.y + 2.5, O.den.z + 4); pl.vel.set(0, 0, 0);
      return O.state;
    },
    goSquid: pl => {
      if (activeZone !== 2) return 'squid live in zone 2';
      const Q = squids[0];
      pl.pos.copy(Q.pos).y += 4; pl.vel.set(0, 0, 0);
      return Q.state;
    },
    // Force behaviours so each beat can be screenshotted on demand.
    arouse: (v = 1.0) => { for (const s of sharks) if (s.cfg.zi === activeZone) { s.arousal = v; s.cool = 0; } return 'ok'; },
    strike: () => {
      const S = sharks.find(s => s.cfg.zi === activeZone);
      if (!S) return 'none';
      S.arousal = 1.2; S.cool = 0; S.bit = false; sharkSetState(S, 'windup');
      return 'windup';
    },
    ink: () => {
      const O = octos.find(o => o.zi === activeZone && o.state === 'grab') ||
        octos.find(o => o.zi === activeZone);
      if (!O) return 'none';
      _b.set(1, 0.2, 0.4).normalize();
      spawnInk(O.pos, _b, 30, O.zi);
      O.jet.copy(_b).multiplyScalar(11).setY(3.2);
      octSet(O, 'flee');
      return 'inked';
    },
    // ---- combat dev helpers ----
    // The real entry points, so a swing can be tested from the console with the
    // diver's own position and heading rather than a synthesised one.
    slash: (pos, fwd, range = 3.4) => slash(pos, fwd, range),
    vent: pos => deployInk(pos),
    // Kill the nearest living squid to the player (or index i) without needing to aim.
    killSquid: (pl = window.player) => {
      if (activeZone !== 2) return 'squid live in zone 2';
      let best = null, bd = 1e9;
      for (const Q of squids) {
        if (Q.dead) continue;
        const d = pl ? Q.pos.distanceToSquared(pl.pos) : 0;
        if (d < bd) { bd = d; best = Q; }
      }
      if (!best) return 'no living squid';
      killSquidAt(best, best.pos);
      spawnSac(best.pos);
      return { killed: best.i, at: best.pos.toArray().map(v => +v.toFixed(1)) };
    },
    // Drop a sac in front of the diver so the pickup can be inspected in any zone.
    spawnSac: (pl = window.player) => {
      const at = pl ? _k1.copy(pl.pos).add(_k2.set(0, -1.2, 0)) : _k1.set(0, 0, 0);
      spawnSac(at);
      return sacs.filter(s => s.alive).length;
    },
    // Vent a cloud at the diver and report every hunting shark's reaction.
    testInk: (pl = window.player) => {
      const before = sharks.filter(s => s.cfg.zi === activeZone).map(s => s.state);
      const ok = deployInk(pl ? pl.pos : V3());
      return { spawned: ok, sharkBefore: before, clouds: clouds.filter(c => c.life > 0).length };
    },
    // Fast-forward the slow timers (squid respawn, sac dissolve) instead of waiting.
    warp: (sec = 60) => {
      for (const Q of squids) if (Q.dead === 2) Q.respawn -= sec;
      for (const S of sacs) if (S.alive) S.life -= sec;
      return `warped ${sec}s`;
    },
    lure: () => {
      squidNibbleT = 0;
      for (const q of squids) { if (q.dead) continue; q.state = 'approach'; q.tState = 0; }
      return 'lured';
    },
    dens: zi => octos.filter(o => o.zi === zi).map(o => ({ x: +o.den.x.toFixed(1), y: +o.den.y.toFixed(1), z: +o.den.z.toFixed(1) }))
  };
}

export function switchPredatorZone(zi) {
  activeZone = zi;
  for (const S of sharks) {
    const on = S.cfg.zi === zi;
    if (!on) { S.mesh.visible = false; continue; }
    // reset the hunter so the zone opens on a distant patrol, never mid-strike
    sharkSetState(S, 'patrol');
    S.arousal = 0; S.cool = rng(12, 22); S.orbitR = S.cfg.patrolR; S.bit = false; S.blinded = 0;
    S.pos.set(Math.cos(S.orbitPh) * S.cfg.patrolR, zoneMidY(zi), Math.sin(S.orbitPh) * S.cfg.patrolR);
  }
  for (const O of octos) {
    if (O.zi !== zi) { O.mesh.visible = false; continue; }
    O.pos.copy(O.den); O.mesh.position.copy(O.den);
    octSet(O, 'den'); O.cool = rng(3, 12); O.reach = 0; O.active = 0; O.grab = 0;
  }
  if (zi !== 2) {
    squidMesh.visible = false; squidGlow.visible = false;
  } else {
    for (const Q of squids) {
      if (Q.dead === 1) { Q.dead = 2; Q.respawn = rng(SQ.respawnMin, SQ.respawnMax); continue; }
      if (Q.dead) continue;             // still out there waiting to drift back in
      Q.state = 'far'; Q.tState = 0;
    }
  }
  // Any ink hanging in the old zone would otherwise float in the new one.
  for (let i = 0; i < INK_N; i++) inkLife[i] = 0;
  inkAlive = 0;
  if (inkMesh) inkMesh.visible = false;
  for (let i = 0; i < CLOUD_N; i++) clouds[i].life = 0;
  for (let i = 0; i < SAC_N; i++) { sacs[i].alive = false; sacs[i].grp.visible = false; }
}

// The one stale-state fix a new dive site needs: octopus dens are the only predator
// state permanently cached against a build-time world position. `pickDens` reads
// `rockColliders` live (flora refills the same array reference on rebuild, never
// swaps it), so calling it again here re-picks real, currently-standing boulders.
//
// Everything else self-corrects without help: sharks and squid re-sample `terrainH`
// every frame (see the `floor`/`aFloor`/`ceil` clamps in updateShark/updateSquid), so
// a shark or squid whose cached `pos` now sits inside or above new terrain is pushed
// back onto it on the very next tick — no explicit reset needed. Shark patrol centres
// are a function of live `t`, not a cached point. Ink sacs and vented clouds are
// runtime pickups spawned at kill/vent positions, not flora-anchored, and are already
// cleared by switchPredatorZone; reseedDens leaves them alone.
//
// Mid-chase safety: this rewrites `den`/`pos`/`mesh.position` and forces the FSM back
// to 'den' with reach/active/grab decayed to 0 — an octopus that was mid-reach or
// mid-grab simply lets go and reappears camouflaged at its (new) den, same as a normal
// cooldown return. `ev` is not touched: it is fully rebuilt every frame at the top of
// updatePredators, so this reset cannot leak a stale threat/lightSteal tick.
export function reseedDens() {
  for (let zi = 0; zi < 3; zi++) {
    const group = octos.filter(o => o.zi === zi);
    if (!group.length) continue;
    const dens = pickDens(zi, group.length);
    for (let i = 0; i < group.length; i++) {
      const rock = dens[i];
      // Pool came up short (fewer big rocks at this site than octopuses built for it) —
      // same tolerance buildOctopuses already has; leaving this one at its last den is
      // no worse than the shipped shortfall behaviour.
      if (!rock) continue;
      const O = group[i];
      const scale = O.mesh.scale.x;
      const a = rng(0, TAU), r = rock.r + scale * 0.75;
      const x = rock.x + Math.cos(a) * r, z = rock.z + Math.sin(a) * r;
      const y = terrainH(x, z, zi) + 0.2;
      O.den.set(x, y, z);
      O.pos.copy(O.den);
      O.jet.set(0, 0, 0);
      O.mesh.position.copy(O.den);
      octSet(O, 'den');
      O.cool = rng(3, 12);
      O.reach = 0; O.active = 0; O.grab = 0;
      O.u.uReach.value = 0; O.u.uActive.value = 0; O.u.uGrab.value = 0;
    }
  }
}

export function updatePredators(dt, t, p, lanternPos) {
  const t0 = performance.now();
  ev.threat = 0; ev.bite = 0; ev.lightSteal = 0; ev.inkPickup = 0;
  uTime.value = t;
  if (scene.fog) uFogD.value = scene.fog.density;

  // lanternPos is written at the end of game.js's frame, so on frame one it is still
  // the origin — fall back to the diver himself rather than luring everything to (0,0,0).
  if (lanternPos && lanternPos.lengthSq() > 1) _lp.copy(lanternPos);
  else _lp.copy(p.pos);

  for (let i = 0; i < sharks.length; i++) {
    const S = sharks[i];
    if (S.cfg.zi !== activeZone) continue;
    updateShark(S, dt, t, p);
  }
  for (let i = 0; i < octos.length; i++) {
    const O = octos[i];
    if (O.zi !== activeZone) continue;
    updateOctopus(O, dt, t, p, _lp);
  }
  if (activeZone === 2) updateSquid(dt, t, p, _lp);
  updateInk(dt);
  updateClouds(dt);
  updateSacs(dt, t, p);

  const ms = performance.now() - t0;
  profN++; profSum += ms; if (ms > profMax) profMax = ms;
  return ev;
}

// ---------------------------------------------------------------------------
// combat
// ---------------------------------------------------------------------------

// A cone, not a sphere: within `range` and inside ~70 degrees of where the diver is
// actually looking. cos(70 deg) = 0.342. Nearest valid target wins, so a slash into a
// cluster kills the one the blade would have reached first.
const SLASH_COS = 0.342;
const slashResult = { killed: '', at: V3() };

// Sharks and octopuses are not killable with a diving knife, and pretending otherwise
// would cheapen both. They react instead — the swing registers as a threat, not damage.
export function slash(pos, fwd, range = 3.4) {
  const r2 = range * range;

  let best = null, bd = 1e9;
  if (activeZone === 2) {
    for (let i = 0; i < squids.length; i++) {
      const Q = squids[i];
      if (Q.dead) continue;
      _k1.copy(Q.pos).sub(pos);
      const d2 = _k1.lengthSq();
      // generous by the squid's own radius: the blade hits the animal, not its origin
      const reach = range + Q.size * 0.35;
      if (d2 > reach * reach) continue;
      const d = Math.sqrt(d2) + 1e-5;
      if (_k1.dot(fwd) / d < SLASH_COS) continue;
      if (d2 < bd) { bd = d2; best = Q; }
    }
  }

  if (best) {
    slashResult.killed = 'squid';
    slashResult.at.copy(best.pos);
    killSquidAt(best, best.pos);
    spawnSac(slashResult.at);
    return slashResult;
  }

  // ---- misses that still mean something ----
  let spooked = false;
  for (let i = 0; i < sharks.length; i++) {
    const S = sharks[i];
    if (S.cfg.zi !== activeZone) continue;
    // measured against the flank, generously: a blade anywhere near this much animal
    const reach = range + S.cfg.size * 0.5;
    _k1.copy(S.pos).sub(pos);
    if (_k1.lengthSq() > reach * reach) continue;
    if (S.state !== 'flee') {
      sharkSetState(S, 'flee');
      S.arousal = 0; S.cool = rng(SH.coolMax, SH.coolMax * 1.5);
      S.bit = true; S.blinded = 0.7;    // borrow the hard peel-away read
      spooked = true;
    }
  }
  for (let i = 0; i < octos.length; i++) {
    const O = octos[i];
    if (O.zi !== activeZone) continue;
    if (O.pos.distanceToSquared(pos) > (range + 2.2) * (range + 2.2)) continue;
    if (O.state === 'flee' || O.state === 'return') continue;
    // emergency jet: ink first, then gone. Same escape the grab ends on, only faster.
    _k2.copy(O.pos).sub(pos);
    if (_k2.lengthSq() < 1e-4) _k2.set(1, 0, 0.3);
    _k2.normalize();
    spawnInk(O.pos, _k2, 34, O.zi, 0.9, 1.25, 0.9, 1.05);
    O.jet.copy(_k2).multiplyScalar(15).setY(4.5);
    octSet(O, 'flee');
    spooked = true;
  }
  // A spook is not a kill: game.js only reacts to a returned object, and the animal
  // getting out of the way is the whole feedback the player needs.
  void spooked;
  return null;
}

// Vents a carried sac: a diver-sized cloud, roughly double the octopus puff and
// lasting about twice as long, plus the behaviour volume the shark tests against.
export function deployInk(pos) {
  if (!pos) return false;
  const zi = activeZone < 0 ? 0 : activeZone;
  _k3.set(0, -0.25, 0);      // vented downward-ish and left to billow in place
  spawnInk(pos, _k3, CL.n, zi, 1.6, 0.55, 1.4, 1.25);
  spawnCloud(pos);
  return true;
}
