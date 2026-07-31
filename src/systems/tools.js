// Relic tools: sonar pulse, spear gun, air thruster. OWNED BY: tools agent.
//
// Contract with game.js (inputs live in game.js; this module owns effects + logic):
//   initTools()                       — once at world build.
//   updateTools(dt, t, player)        — every play frame. Returns event object (reused):
//     { spearKill: null|{killed, at}, spearRecovered: 0|1 }
//   sonarPing(pos, zi)                — T key (only if survival.hasSonar). Expanding
//     ring + world-space echo glints on motes/resources/sigils/rift, fading over ~4s.
//     Returns false while on cooldown (~6s) so game.js can gate audio.
//   fireSpear(pos, fwd)               — right-click (only if survival.hasSpear). Launches
//     a visible spear; on squid contact reuse predators.slash at the impact point for the
//     kill (ranged version of the knife). Spent spears lie in the world and can be
//     recovered by proximity (spearRecovered event). Returns false if none are loaded.
//   fireThruster(dx, dy, dz, power)   — ONE-SHOT: the diver cracked the bottle. (dx,dy,dz)
//     is the unit THRUST direction; the exhaust vents opposite it. power < 0.25 is a dud
//     wheeze (cloud only). Physics + air cost stay in player.js/game.js.
//   setToolsLanternPos(v)             — the plume catches the lantern, same as the dust.
//
// Discipline: every pool is allocated once at init, every hot-path vector is a module
// temp, and each subsystem early-outs to zero work when idle.
//
// NOTE the deliberate duplication of predators.js's FOG_GLSL / TONE_OUT / billboard
// pattern below. Exporting them would make two agent-owned modules share a shader
// program cache key, which this project has already been bitten by (see CLAUDE.md on
// creatures.js). The per-frame `uFogD` write is part of the pattern, not optional —
// without it the plume keeps core.js's boot density and stops sitting in the water.
import * as THREE from 'three';
import { scene } from '../core.js';
import { ZONE_GAP, RIFT_R, riftPos, zoneBottom } from '../config.js';
import { rng, clamp } from '../lib/math.js';
import { glowTex, canvas2d, noiseCanvas } from '../lib/textures.js';
import { terrainH } from '../world/terrain.js';
import { motes } from '../world/rifts.js';
import { nodes } from '../world/resources.js';
import { slash } from '../world/predators.js';
import { RAFT_POS } from './raft.js';
import { airInletWorldPos } from '../entities/diver.js';
import { player, burstEnv, BURST_DUR } from '../player.js';

const ev = { spearKill: null, spearRecovered: 0 };

// ---------------------------------------------------------------- shared temps
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const FWD_Z = new THREE.Vector3(0, 0, 1);

// The zone the diver is standing in; game.js owns the authoritative value, we only need
// it to sample terrain height, so a defensive read is enough.
function curZone() {
  const z = window.zone;
  if (typeof z === 'number' && z >= 0 && z < 3) return z;
  // fall back to a height test so a spear never lands on the wrong heightfield
  const y = player.pos.y;
  for (let i = 0; i < 3; i++) if (y > zoneBottom(i) - ZONE_GAP * 0.5) return i;
  return 2;
}

// =================================================================== 1. SONAR
// A pulse front leaves the diver at 36 u/s and reaches ~90u in 2.5s. Points of interest
// inside 120u are latched at ping time; each lights up on the frame the front crosses
// its distance, so the reveal staggers outward from the diver.
const SONAR_R = 90, SONAR_T = 2.5, SONAR_CD = 6, SONAR_REACH = 120;
const ECHO_MAX = 48, ECHO_LIFE = 4;

let sonarAge = SONAR_T + 1, sonarCool = 0;
const sonarOrigin = new THREE.Vector3();
let shell = null, sweep = null, echoPts = null;

// echo pool: state 0 idle, 1 pending (front has not reached it), 2 ringing
const eState = new Uint8Array(ECHO_MAX);
const ePos = new Float32Array(ECHO_MAX * 3);
const eCol = new Float32Array(ECHO_MAX * 3);
const eLife = new Float32Array(ECHO_MAX * 2);   // (alpha, size)
const eDist = new Float32Array(ECHO_MAX);
const eAge = new Float32Array(ECHO_MAX);
let echoLive = 0, echoN = 0;

// brass-age palette: nothing saturated, nothing neon
const C_MOTE = [0.46, 0.86, 0.82];
const C_RES = [0.92, 0.68, 0.34];
const C_SIGIL = [1.00, 0.55, 0.22];
const C_RIFT = [0.58, 0.95, 1.00];
const C_RAFT = [0.95, 0.86, 0.66];

function buildSonar() {
  // expanding shell: a sphere shaded on its silhouette, so it reads as a pressure front
  // passing through the water rather than a solid bubble.
  const sg = new THREE.SphereGeometry(1, 36, 18);
  const sm = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 }, uC: { value: new THREE.Vector3(0.62, 0.88, 0.92) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false,
    vertexShader: `
      varying vec3 vN, vW;
      void main(){
        vN = normalize(mat3(modelMatrix) * normal);
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uA; uniform vec3 uC;
      varying vec3 vN, vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - abs(dot(normalize(vN), V)), 6.0);
        float a = (0.02 + 0.98 * rim) * uA;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uC, a);
      }`
  });
  shell = new THREE.Mesh(sg, sm);
  shell.frustumCulled = false;
  shell.visible = false;
  scene.add(shell);

  // ground sweep: the same front read off the seabed, which is what makes the expansion
  // legible when the diver is looking down a slope.
  const rg = new THREE.RingGeometry(0.90, 1.0, 128, 1);
  rg.rotateX(-Math.PI / 2);
  const rm = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 }, uC: { value: new THREE.Vector3(0.66, 0.90, 0.94) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false,
    vertexShader: `varying vec2 vUv;
      void main(){ vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uA; uniform vec3 uC; varying vec2 vUv;
      void main(){
        float a = (1.0 - abs(vUv.y - 0.5) * 2.0) * uA;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uC, a);
      }`
  });
  sweep = new THREE.Mesh(rg, rm);
  sweep.frustumCulled = false;
  sweep.visible = false;
  scene.add(sweep);

  // echo glints: billboarded points, colour-coded by what answered
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  eg.setAttribute('aCol', new THREE.BufferAttribute(eCol, 3));
  eg.setAttribute('aLife', new THREE.BufferAttribute(eLife, 2));
  const em = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: glowTex } },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `
      attribute vec3 aCol; attribute vec2 aLife;
      varying vec3 vC; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aLife.y * (600.0 / max(-mv.z, 1.0)), 2.0, 60.0);
        vC = aCol; vA = aLife.x;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uTex; varying vec3 vC; varying float vA;
      void main(){
        float a = texture2D(uTex, gl_PointCoord).a * vA;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(vC, a);
      }`
  });
  echoPts = new THREE.Points(eg, em);
  echoPts.frustumCulled = false;
  echoPts.renderOrder = 6;
  echoPts.visible = false;
  scene.add(echoPts);
}

function addEcho(x, y, z, col, size) {
  if (echoN >= ECHO_MAX) return;
  const k = echoN++;
  ePos[k * 3] = x; ePos[k * 3 + 1] = y; ePos[k * 3 + 2] = z;
  eCol[k * 3] = col[0]; eCol[k * 3 + 1] = col[1]; eCol[k * 3 + 2] = col[2];
  eDist[k] = Math.hypot(x - sonarOrigin.x, y - sonarOrigin.y, z - sonarOrigin.z);
  eState[k] = 1; eAge[k] = 0;
  eLife[k * 2] = 0; eLife[k * 2 + 1] = size;
}

export function sonarPing(pos, zi) {
  if (sonarCool > 0) return false;
  sonarCool = SONAR_CD;
  sonarAge = 0;
  sonarOrigin.copy(pos);
  for (let i = 0; i < ECHO_MAX; i++) { eState[i] = 0; eLife[i * 2] = 0; }
  echoN = 0; echoLive = 0;

  const R2 = SONAR_REACH * SONAR_REACH;

  // light motes
  for (let i = 0; i < motes.length; i++) {
    const m = motes[i];
    if (!m.alive) continue;
    if (m.grp.position.distanceToSquared(sonarOrigin) > R2) continue;
    addEcho(m.grp.position.x, m.grp.position.y, m.grp.position.z, C_MOTE, 5.0);
  }
  // polymer / bitumen nodes in this zone
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n.alive || n.zi !== zi) continue;
    if (n.grp.position.distanceToSquared(sonarOrigin) > R2) continue;
    addEcho(n.grp.position.x, n.grp.position.y + 1.2, n.grp.position.z, C_RES, 4.2);
  }
  // the sleeper's unlit wards — only while it still needs calming
  const L = window.lev;
  if (L && !L.calmed && L.sigils) {
    for (let i = 0; i < L.sigils.length; i++) {
      const s = L.sigils[i];
      if (s.lit) continue;
      s.grp.getWorldPosition(_a);
      if (_a.distanceToSquared(sonarOrigin) > R2) continue;
      addEcho(_a.x, _a.y, _a.z, C_SIGIL, 7.0);
    }
  }
  // the way down, once it has opened
  if (L && L.calmed) {
    const rp = riftPos(zi);
    _a.set(rp.x, terrainH(rp.x, rp.z, zi) + RIFT_R * 0.5, rp.z);
    if (_a.distanceToSquared(sonarOrigin) <= R2) addEcho(_a.x, _a.y, _a.z, C_RIFT, 9.0);
  }
  // the way home, from the shallows
  if (zi === 0) {
    _a.copy(RAFT_POS).sub(sonarOrigin);
    const d = _a.length();
    _a.multiplyScalar(Math.min(d, SONAR_REACH * 0.8) / Math.max(d, 1e-3)).add(sonarOrigin);
    addEcho(_a.x, _a.y, _a.z, C_RAFT, 7.5);
  }
  echoPts.geometry.attributes.position.needsUpdate = true;
  echoPts.geometry.attributes.aCol.needsUpdate = true;
  echoLive = echoN;
  echoPts.visible = echoN > 0;
  return true;
}

function updateSonar(dt) {
  if (sonarCool > 0) sonarCool -= dt;
  if (sonarAge > SONAR_T && echoLive === 0) return;

  if (sonarAge <= SONAR_T) {
    sonarAge += dt;
    const k = clamp(sonarAge / SONAR_T, 0, 1);
    const r = k * SONAR_R;
    const fade = (1 - k) * (1 - k);
    if (k < 1) {
      shell.visible = sweep.visible = true;
      shell.position.copy(sonarOrigin);
      shell.scale.setScalar(Math.max(0.01, r));
      shell.material.uniforms.uA.value = 0.85 * fade;
      sweep.position.set(sonarOrigin.x, 0, sonarOrigin.z);
      sweep.position.y = terrainH(sonarOrigin.x, sonarOrigin.z, curZone()) + 0.35;
      sweep.scale.set(Math.max(0.01, r), 1, Math.max(0.01, r));
      sweep.material.uniforms.uA.value = 0.55 * fade;
    } else {
      shell.visible = sweep.visible = false;
    }

    // latch: anything the front has just passed starts ringing
    const front = r;
    for (let i = 0; i < echoN; i++) {
      if (eState[i] === 1 && eDist[i] <= front) { eState[i] = 2; eAge[i] = 0; }
    }
  }

  if (echoLive === 0) return;
  let live = 0;
  for (let i = 0; i < echoN; i++) {
    if (eState[i] === 0) continue;
    live++;
    if (eState[i] === 1) { eLife[i * 2] = 0; continue; }
    eAge[i] += dt;
    if (eAge[i] >= ECHO_LIFE) { eState[i] = 0; eLife[i * 2] = 0; live--; continue; }
    const a = eAge[i] / ECHO_LIFE;
    // hard strike, long decay: the glint announces itself then bleeds away
    const attack = Math.min(1, eAge[i] / 0.12);
    eLife[i * 2] = attack * (1 - a) * (1 - a) * 0.95;
  }
  echoLive = live;
  echoPts.geometry.attributes.aLife.needsUpdate = true;
  echoPts.visible = live > 0;
}

// =================================================================== 2. SPEAR GUN
// Three spears exist, full stop: the ones in the air plus the ones lying in the mud are
// the whole economy, so the pool size and the ammo count are the same number.
const SPEAR_N = 3;
const SPEAR_V = 28, SPEAR_DROP = 3.4, SPEAR_RANGE = 40, SPEAR_HIT_R = 2.2;
const PICKUP_R = 3, GLINT_R = 15;
const spears = [];

function buildSpear() {
  // shaft along +Z so the whole spear can be aimed with one setFromUnitVectors
  const shaftG = new THREE.CylinderGeometry(0.020, 0.016, 1.35, 6);
  shaftG.rotateX(Math.PI / 2);
  const headG = new THREE.ConeGeometry(0.050, 0.26, 8);
  headG.rotateX(Math.PI / 2);
  headG.translate(0, 0, 0.80);
  const collarG = new THREE.CylinderGeometry(0.038, 0.038, 0.07, 8);
  collarG.rotateX(Math.PI / 2);
  collarG.translate(0, 0, -0.60);
  const trailG = new THREE.CylinderGeometry(0.006, 0.030, 1.9, 5, 1, true);
  trailG.rotateX(Math.PI / 2);
  trailG.translate(0, 0, -1.6);

  const steel = new THREE.MeshStandardMaterial({ color: 0x8d949a, roughness: 0.38, metalness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xa8813a, roughness: 0.34, metalness: 0.9, emissive: 0x2a1c06, emissiveIntensity: 0.6
  });

  for (let i = 0; i < SPEAR_N; i++) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(shaftG, steel));
    grp.add(new THREE.Mesh(headG, brass));
    grp.add(new THREE.Mesh(collarG, brass));
    const trail = new THREE.Mesh(trailG, new THREE.MeshBasicMaterial({
      color: 0xbfd6dc, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false
    }));
    grp.add(trail);
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffd9a0, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending
    }));
    glint.scale.setScalar(1.4);
    grp.add(glint);
    grp.visible = false;
    scene.add(grp);
    spears.push({
      grp, trail, glint,
      state: 0,                       // 0 idle · 1 flying · 2 stuck in a kill · 3 lying recoverable
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1),
      flown: 0, stuckT: 0, ph: Math.random() * 7
    });
  }
}

export function fireSpear(pos, fwd) {
  let S = null;
  for (let i = 0; i < SPEAR_N; i++) if (spears[i].state === 0) { S = spears[i]; break; }
  if (!S) return false;
  S.dir.copy(fwd).normalize();
  // out of the gun at the diver's right hip, not out of his forehead
  _a.set(Math.sin(player.yaw - Math.PI / 2), 0, Math.cos(player.yaw - Math.PI / 2));
  S.pos.copy(pos).addScaledVector(_a, 0.34).addScaledVector(S.dir, 0.9);
  S.pos.y -= 0.25;
  S.vel.copy(S.dir).multiplyScalar(SPEAR_V);
  S.flown = 0; S.stuckT = 0; S.state = 1;
  S.grp.visible = true;
  S.glint.material.opacity = 0;
  S.trail.material.opacity = 0.5;
  S.grp.position.copy(S.pos);
  S.grp.quaternion.setFromUnitVectors(FWD_Z, S.dir);
  return true;
}

function layDown(S, zi) {
  // settle flat on the mud, still pointing the way it was travelling
  _b.set(S.dir.x, 0, S.dir.z);
  if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1);
  _b.normalize();
  S.grp.quaternion.setFromUnitVectors(FWD_Z, _b);
  S.pos.y = terrainH(S.pos.x, S.pos.z, zi) + 0.09;
  S.grp.position.copy(S.pos);
  S.vel.set(0, 0, 0);
  S.trail.material.opacity = 0;
  S.state = 3;
}

function updateSpears(dt, t, p) {
  const zi = curZone();
  for (let i = 0; i < SPEAR_N; i++) {
    const S = spears[i];
    if (S.state === 0) continue;

    if (S.state === 1) {
      S.vel.y -= SPEAR_DROP * dt;
      const step = S.vel.length() * dt;
      S.dir.copy(S.vel).normalize();
      S.pos.addScaledVector(S.vel, dt);
      S.flown += step;
      S.grp.position.copy(S.pos);
      S.grp.quaternion.setFromUnitVectors(FWD_Z, S.dir);
      S.trail.material.opacity = 0.5 * clamp(S.vel.length() / SPEAR_V, 0, 1);

      // the head is what bites, so test from the tip
      _c.copy(S.pos).addScaledVector(S.dir, 0.8);
      const kill = slash(_c, S.dir, SPEAR_HIT_R);
      if (kill && kill.killed) {
        ev.spearKill = kill;
        S.pos.copy(kill.at);
        S.grp.position.copy(S.pos);
        S.state = 2; S.stuckT = 0.7;
        S.vel.set(0, 0, 0);
        S.trail.material.opacity = 0;
        continue;
      }

      const th = terrainH(S.pos.x, S.pos.z, zi);
      if (S.pos.y <= th + 0.12) { layDown(S, zi); continue; }
      if (S.flown >= SPEAR_RANGE) {
        // spent: it stops driving forward and sinks the rest of the way
        S.vel.multiplyScalar(0.12);
        S.vel.y = -1.6;
        S.flown = 0;
        S.state = 4;
      }
    } else if (S.state === 4) {
      // sinking, either spent or shaken loose from a kill
      S.pos.addScaledVector(S.vel, dt);
      S.vel.multiplyScalar(Math.pow(0.35, dt));
      S.vel.y = Math.max(-5.0, S.vel.y - 3.0 * dt);
      S.grp.position.copy(S.pos);
      S.grp.quaternion.slerp(_q.setFromUnitVectors(FWD_Z, _b.set(S.dir.x, -0.35, S.dir.z).normalize()),
        Math.min(1, dt * 2.5));
      S.trail.material.opacity = 0;
      if (S.pos.y <= terrainH(S.pos.x, S.pos.z, zi) + 0.12) layDown(S, zi);
    } else if (S.state === 2) {
      S.stuckT -= dt;
      if (S.stuckT <= 0) { S.vel.set(0, -1.2, 0); S.state = 4; }
    }

    if (S.state === 2 || S.state === 3 || S.state === 4) {
      const d = S.pos.distanceTo(p.pos);
      const near = clamp(1 - d / GLINT_R, 0, 1);
      S.glint.material.opacity = near * (0.32 + 0.30 * Math.sin(t * 3.1 + S.ph));
      S.glint.scale.setScalar(1.1 + 0.5 * near);
      S.grp.visible = d < 90;
      if (!ev.spearRecovered && d < PICKUP_R) {
        S.state = 0;
        S.grp.visible = false;
        S.glint.material.opacity = 0;
        ev.spearRecovered = 1;
      }
    }
  }
}

// =================================================================== 3. AIR THRUSTER
// One press = one shove. The bottle blows down in 0.26 s and the water does the rest,
// so this is an EVENT with an onset, a peak and a recovery, not a movement mode.
//
// The plume is built in three phases because a gas jet in water genuinely has three:
// a short coherent white core, an expanding turbulent cloud, then a rising bubble wake.
// The cloud and wake are NORMAL-blended with a bright rim and a core darker than the
// water behind it — a bubble is a mirror with a refracting middle. A purely additive
// particle can only ADD light, which is why the old plume vanished in the shallows.
//
// Both nozzles are canted outward. The exhaust must vent opposite the thrust (recoil is
// not optional) and the chase camera sits on exactly that axis, so a single cone
// foreshortens onto a point — measured at 0.03 NDC on the build this replaces.
const JET_MAX = 160, BUB_MAX = 260;
const JET_IGNITE = 34, BUB_IGNITE = 40;      // per nozzle, on the frame the valve cracks
const JET_RATE = 900, BUB_RATE = 800;        // per second, modulated by the blowdown
const RING_DUR = 0.30;

// Additive/alpha billboards must fade to black with distance rather than toward the fog
// colour — the same trick predators.js and creatures.js use for their glow fields.
const FOG_GLSL = `
uniform float uFogD;
float fogVis(vec3 wp){ float d = length(wp - cameraPosition); return exp(-uFogD*uFogD*d*d); }`;
const TONE_OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';
const uFogD = { value: 0.016 };
const uLant = { value: new THREE.Vector3(0, 0, 0) };

export function setToolsLanternPos(v) { uLant.value.copy(v); }

// ---- bubble atlas: rim in R, body in G, so one texture drives both meshes ----------
const bubbleTex = (() => {
  const S = 256, C = S / 2;
  const { canvas, ctx } = canvas2d(S);
  const nz = noiseCanvas(128, 4, 1.1).getContext('2d').getImageData(0, 0, 128, 128).data;
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = ((cell / 2) | 0) * C;
    const img = ctx.createImageData(C, C);
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const dx = (x - C / 2) / (C / 2), dy = (y - C / 2) / (C / 2);
      const r = Math.hypot(dx, dy);
      // one consistent light direction across all four cells: a cluster then reads as a
      // handful of spheres lit from the same place rather than as a bag of marbles
      const lit = clamp(0.45 + 0.55 * (-dx * 0.6 - dy * 0.8), 0, 1);
      const ring = Math.max(0, 1 - Math.abs(r - 0.80) / 0.26);
      const n = nz[(((y * 517 + cell * 31) % 128) * 128 + ((x * 731 + cell * 57) % 128)) * 4] / 255;
      const edge = Math.max(0, 1 - r) * (0.55 + 0.45 * n);
      let rim = ring * ring * lit * (0.5 + 0.5 * n);
      // one small specular dot where the light hits
      rim = Math.max(rim, Math.max(0, 1 - Math.hypot(dx + 0.34, dy + 0.40) / 0.20) * 0.9);
      const body = r < 1 ? edge * 0.85 : 0;
      const i = (y * C + x) * 4;
      img.data[i] = Math.min(255, rim * 255);
      img.data[i + 1] = Math.min(255, body * 255);
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, ox, oy);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;   // this is data, not colour
  return tex;
})();

// ---- pools -------------------------------------------------------------------------
// Positions live directly in the instanced attribute arrays; only velocity/life/phase
// need a shadow copy. Nothing here is allocated after init.
function makeField(n) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(quad.index);
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const cell = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  g.setAttribute('aPos', pos); g.setAttribute('aSize', size);
  g.setAttribute('aCol', col); g.setAttribute('aCell', cell);
  g.instanceCount = n;
  quad.dispose();
  return { g, pos: pos.array, size: size.array, col: col.array, cell: cell.array, attr: [pos, size, col] };
}

const VS = `
  attribute vec3 aPos; attribute float aSize; attribute vec4 aCol; attribute float aCell;
  varying vec2 vUv; varying vec4 vC; varying float vFog; varying vec3 vW;
  ${FOG_GLSL}
  void main(){
    vFog = fogVis(aPos); vW = aPos; vC = aCol;
    vec4 mv = viewMatrix * vec4(aPos, 1.0);
    mv.xy += position.xy * aSize;
    // The plume passes through the lens at 40+ u/s of closing speed. Without this the
    // frame washes white and overdraw spikes; it is a requirement, not a polish pass.
    vC.a *= smoothstep(0.6, 2.4, -mv.z);
    vUv = uv * 0.5 + vec2(mod(aCell, 2.0), floor(aCell * 0.5)) * 0.5;
    gl_Position = projectionMatrix * mv;
  }`;

function fieldMaterial(blending, frag) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: bubbleTex }, uFogD, uLant },
    vertexShader: VS,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uLant;
      varying vec2 vUv; varying vec4 vC; varying float vFog; varying vec3 vW;
      void main(){
        vec2 tx = texture2D(uMap, vUv).rg;
        ${frag}
        ${TONE_OUT}
      }`,
    transparent: true, depthWrite: false, blending
  });
}

let jet = null, bub = null, ringA = null, ringB = null, pShell = null;
const jVel = new Float32Array(JET_MAX * 3), jLife = new Float32Array(JET_MAX), jMax = new Float32Array(JET_MAX);
const bVel = new Float32Array(BUB_MAX * 3), bLife = new Float32Array(BUB_MAX), bMax = new Float32Array(BUB_MAX);
const bPh = new Float32Array(BUB_MAX), bBuoy = new Float32Array(BUB_MAX), bS0 = new Float32Array(BUB_MAX);
let jHead = 0, jAlive = 0, bHead = 0, bAlive = 0;
let burstT = 0, burstPow = 0, jFrac = 0, bFrac = 0, ringT = 0, burstCount = 0;

const _origin = new THREE.Vector3(), _ex = new THREE.Vector3(), _rt = new THREE.Vector3();
const _up2 = new THREE.Vector3(), _noz = new THREE.Vector3(), _axis = new THREE.Vector3();
const _thrust = new THREE.Vector3(0, 0, 1);

function buildThruster() {
  jet = makeField(JET_MAX);
  bub = makeField(BUB_MAX);
  // Jet core: this phase genuinely IS specular, so additive is right here and only here.
  jet.mesh = new THREE.Mesh(jet.g, fieldMaterial(THREE.AdditiveBlending, `
        float a = (tx.r * 0.95 + tx.g * 0.85) * vC.a * mix(0.06, 1.0, vFog);
        if (a < 0.004) discard;
        gl_FragColor = vec4(vC.rgb, a);`));
  bub.mesh = new THREE.Mesh(bub.g, fieldMaterial(THREE.NormalBlending, `
        float rim = tx.r, body = tx.g;
        float a = (rim * 0.92 + body * 0.5) * vC.a * mix(0.10, 1.0, vFog);
        if (a < 0.004) discard;
        // Bright rim, core DARKER than the water behind it. That single fact is what
        // makes the plume read against the bright shallows AND against the abyss.
        vec3 col = mix(vec3(0.030, 0.062, 0.082), vec3(0.90, 0.96, 1.00), rim / max(rim + body, 1e-3));
        col *= 0.34 + 1.15 * clamp(1.0 - distance(vW, uLant) / 13.0, 0.0, 1.0);
        gl_FragColor = vec4(col, a);`));
  for (const m of [jet.mesh, bub.mesh]) {
    m.frustumCulled = false; m.visible = false; m.renderOrder = 5;
    scene.add(m);
  }

  // Pressure front: venting a bottle shoves water radially. Two rings, the second
  // delayed, is the honest cheap read — a screen-space refraction would need a post
  // pass and postfx.js has a documented history with those.
  const rg = new THREE.RingGeometry(0.86, 1.0, 40);
  const ringMat = () => new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 }, uFogD },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying float vFog;
      ${FOG_GLSL}
      void main(){ vUv = uv;
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        vFog = fogVis(wp);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uA; varying vec2 vUv; varying float vFog;
      void main(){
        float a = (1.0 - abs(vUv.y - 0.5) * 2.0) * uA * mix(0.05, 1.0, vFog);
        if (a <= 0.004) discard;
        gl_FragColor = vec4(vec3(0.80, 0.92, 0.97), a);
        ${TONE_OUT}
      }`
  });
  ringA = new THREE.Mesh(rg, ringMat());
  ringB = new THREE.Mesh(rg, ringMat());
  // Compression shell: a fresnel bubble standing in for the refraction we cannot afford.
  pShell = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    vertexShader: `varying vec3 vN, vW;
      void main(){ vN = normalize(mat3(modelMatrix) * normal);
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uA; varying vec3 vN, vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float a = pow(1.0 - abs(dot(normalize(vN), V)), 3.0) * uA;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(vec3(0.66, 0.80, 0.88), a);
        ${TONE_OUT}
      }`
  }));
  for (const m of [ringA, ringB, pShell]) { m.frustumCulled = false; m.visible = false; scene.add(m); }
}

function emitJet(n) {
  for (let i = 0; i < n; i++) {
    const k = jHead; jHead = (jHead + 1) % JET_MAX;
    if (jLife[k] <= 0) jAlive++;
    const p = k * 3;
    jet.pos[p] = _noz.x + rng(-0.05, 0.05);
    jet.pos[p + 1] = _noz.y + rng(-0.05, 0.05);
    jet.pos[p + 2] = _noz.z + rng(-0.05, 0.05);
    const sp = rng(22, 30);
    // 14 degree half-angle cone about the nozzle axis
    jVel[p] = _axis.x * sp + _rt.x * rng(-5.5, 5.5) + _up2.x * rng(-5.5, 5.5);
    jVel[p + 1] = _axis.y * sp + _rt.y * rng(-5.5, 5.5) + _up2.y * rng(-5.5, 5.5);
    jVel[p + 2] = _axis.z * sp + _rt.z * rng(-5.5, 5.5) + _up2.z * rng(-5.5, 5.5);
    // Exhaust is fired into still water; it barely inherits his motion, so at 40 u/s he
    // visibly outruns his own bubbles. That is correct and it is half the read.
    jVel[p] += player.vel.x * 0.15; jVel[p + 1] += player.vel.y * 0.15; jVel[p + 2] += player.vel.z * 0.15;
    jMax[k] = jLife[k] = rng(0.18, 0.42);
    jet.cell[k] = (Math.random() * 4) | 0;
    jet.size[k] = 0.10;
  }
}

function emitBub(n) {
  for (let i = 0; i < n; i++) {
    const k = bHead; bHead = (bHead + 1) % BUB_MAX;
    if (bLife[k] <= 0) bAlive++;
    const p = k * 3;
    bub.pos[p] = _noz.x + rng(-0.09, 0.09);
    bub.pos[p + 1] = _noz.y + rng(-0.09, 0.09);
    bub.pos[p + 2] = _noz.z + rng(-0.09, 0.09);
    const sp = rng(6, 14);
    bVel[p] = _axis.x * sp + _rt.x * rng(-6, 6) + _up2.x * rng(-6, 6);
    bVel[p + 1] = _axis.y * sp + _rt.y * rng(-6, 6) + _up2.y * rng(-6, 6);
    bVel[p + 2] = _axis.z * sp + _rt.z * rng(-6, 6) + _up2.z * rng(-6, 6);
    bVel[p] += player.vel.x * 0.15; bVel[p + 1] += player.vel.y * 0.15; bVel[p + 2] += player.vel.z * 0.15;
    // Capped at 1.8 s: the pool is a ring buffer with no depth sort, and a long spatial
    // wake makes the wrap-order compositing errors visible. A localized cloud hides them.
    bMax[k] = bLife[k] = rng(0.9, 1.8);
    bPh[k] = Math.random() * 7;
    bBuoy[k] = rng(1.4, 2.4);
    bS0[k] = rng(0.06, 0.19);
    bub.cell[k] = (Math.random() * 4) | 0;
    bub.size[k] = bS0[k];
  }
}

// Re-derive the twin nozzle frame from the LIVE inlet position. Sampling it once at
// ignition would leave the sustain spawning in open water 3-7 u behind his backpack.
function nozzleFrame(n) {
  airInletWorldPos(_origin);
  _rt.crossVectors(_ex, UP);
  if (_rt.lengthSq() < 1e-4) _rt.set(1, 0, 0);
  _rt.normalize();
  _up2.crossVectors(_rt, _ex).normalize();
  const s = n ? 1 : -1;
  _noz.copy(_origin).addScaledVector(_rt, s * 0.26).addScaledVector(_up2, -0.08);
  // ~14 degrees out and 6 down: from directly behind, a diverging V instead of a point
  _axis.copy(_ex).addScaledVector(_rt, s * 0.25).addScaledVector(_up2, -0.10).normalize();
}

export function fireThruster(dx, dy, dz, power = 1) {
  _thrust.set(dx, dy, dz);
  if (_thrust.lengthSq() < 1e-6) _thrust.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  _thrust.normalize();
  _ex.copy(_thrust).negate();
  burstT = BURST_DUR; burstPow = power; burstCount++;
  const live = power >= 0.25;
  for (let n = 0; n < 2; n++) {
    nozzleFrame(n);
    if (live) emitJet(JET_IGNITE);
    emitBub(Math.round(BUB_IGNITE * (live ? 1 : 0.30)));
  }
  if (live) {
    ringT = RING_DUR;
    ringA.quaternion.setFromUnitVectors(FWD_Z, _thrust);
    ringB.quaternion.copy(ringA.quaternion);
  }
}

function updateThruster(dt, t) {
  if (burstT <= 0 && jAlive === 0 && bAlive === 0 && ringT <= 0) {
    if (jet.mesh.visible) {
      jet.mesh.visible = bub.mesh.visible = false;
      ringA.visible = ringB.visible = pShell.visible = false;
    }
    return;
  }
  if (scene.fog) uFogD.value = scene.fog.density;

  // ---- sustain emission, still tracking his backpack --------------------------------
  if (burstT > 0) {
    const e = burstEnv(BURST_DUR - burstT) * burstPow;
    burstT = Math.max(0, burstT - dt);
    jFrac += JET_RATE * e * dt;
    bFrac += BUB_RATE * e * dt;
    const nj = jFrac | 0, nb = bFrac | 0;
    jFrac -= nj; bFrac -= nb;
    if (nj > 0 || nb > 0) {
      for (let n = 0; n < 2; n++) {
        nozzleFrame(n);
        if (nj > 0 && burstPow >= 0.25) emitJet(Math.min(nj, 12) >> 1 || 1);
        if (nb > 0) emitBub(Math.min(nb, 12) >> 1 || 1);
      }
    }
  } else { jFrac = bFrac = 0; }

  // ---- jet core: hard drag, short life ---------------------------------------------
  jet.mesh.visible = true;
  let live = 0;
  const jd = Math.exp(-3.2 * dt);
  for (let k = 0; k < JET_MAX; k++) {
    const c = k * 4;
    if (jLife[k] <= 0) { jet.col[c + 3] = 0; continue; }
    jLife[k] -= dt;
    if (jLife[k] <= 0) { jet.col[c + 3] = 0; continue; }
    live++;
    const p = k * 3;
    jVel[p] *= jd; jVel[p + 1] *= jd; jVel[p + 2] *= jd;
    jet.pos[p] += jVel[p] * dt; jet.pos[p + 1] += jVel[p + 1] * dt; jet.pos[p + 2] += jVel[p + 2] * dt;
    const u = 1 - jLife[k] / jMax[k];
    jet.size[k] = 0.10 + 0.45 * u;
    jet.col[c] = 0.95; jet.col[c + 1] = 0.99; jet.col[c + 2] = 1.0;
    jet.col[c + 3] = Math.min(1, u * 30) * Math.pow(1 - u, 1.2) * 0.85;
  }
  jAlive = live;

  // ---- cloud + wake: coalesce, boil, then rise wobbling -----------------------------
  bub.mesh.visible = true;
  live = 0;
  const bd = Math.exp(-2.2 * dt);
  for (let k = 0; k < BUB_MAX; k++) {
    const c = k * 4;
    if (bLife[k] <= 0) { bub.col[c + 3] = 0; continue; }
    bLife[k] -= dt;
    if (bLife[k] <= 0) { bub.col[c + 3] = 0; continue; }
    live++;
    const p = k * 3;
    bVel[p] *= bd; bVel[p + 1] *= bd; bVel[p + 2] *= bd;
    // Analytic curl so the plume boils rather than expanding cleanly. Three sin/cos —
    // two fbm samples would be 24 Math.sin and 74% of this module's whole frame budget.
    const px = bub.pos[p], py = bub.pos[p + 1], pz = bub.pos[p + 2];
    bVel[p] += Math.sin(py * 0.7 + t * 1.9) * 1.6 * dt;
    bVel[p + 1] += Math.sin(pz * 0.6 - t * 1.6) * 1.0 * dt;
    bVel[p + 2] += Math.sin(px * 0.8 + t * 2.2) * 1.6 * dt;
    const sp2 = bVel[p] * bVel[p] + bVel[p + 1] * bVel[p + 1] + bVel[p + 2] * bVel[p + 2];
    if (sp2 < 1.44) {
      // the jet is spent: it is just air now, and air goes up — wobbling, the way real
      // millimetre bubbles zig-zag rather than climbing straight
      bVel[p + 1] += (bBuoy[k] - bVel[p + 1]) * 2.0 * dt;
      bVel[p] += Math.sin(t * 3.4 + bPh[k]) * 1.8 * dt;
      bVel[p + 2] += Math.cos(t * 2.9 + bPh[k] * 1.7) * 1.8 * dt;
    }
    bub.pos[p] = px + bVel[p] * dt;
    bub.pos[p + 1] = py + bVel[p + 1] * dt;
    bub.pos[p + 2] = pz + bVel[p + 2] * dt;
    const u = 1 - bLife[k] / bMax[k];
    // bubbles coalesce and expand as they slow
    bub.size[k] = bS0[k] * (0.35 + 1.9 * Math.pow(u, 0.6));
    bub.col[c] = bub.col[c + 1] = bub.col[c + 2] = 1;
    bub.col[c + 3] = Math.min(1, u * 14) * Math.pow(1 - u, 0.9);
  }
  bAlive = live;

  // no array literal here: this runs every frame of a burst and the pools are hot
  for (let a = 0; a < jet.attr.length; a++) { jet.attr[a].needsUpdate = true; bub.attr[a].needsUpdate = true; }

  // ---- shock rings + compression shell ---------------------------------------------
  if (ringT > 0) {
    ringT = Math.max(0, ringT - dt);
    const u = 1 - ringT / RING_DUR, f = (1 - u) * (1 - u);
    airInletWorldPos(_origin);
    ringA.visible = true;
    ringA.position.copy(_origin);
    ringA.scale.setScalar(0.45 + 4.15 * u);
    ringA.material.uniforms.uA.value = 0.55 * f * burstPow;
    const u2 = clamp((u * RING_DUR - 0.07) / (RING_DUR - 0.07), 0, 1);
    ringB.visible = u2 > 0;
    ringB.position.copy(_origin);
    ringB.scale.setScalar(0.45 + 5.75 * u2);
    ringB.material.uniforms.uA.value = 0.30 * (1 - u2) * (1 - u2) * burstPow;
    pShell.visible = true;
    pShell.position.copy(_origin);
    pShell.scale.setScalar(0.6 + 2.8 * u);
    pShell.material.uniforms.uA.value = 0.30 * f * burstPow;
  } else if (ringA.visible) {
    ringA.visible = ringB.visible = pShell.visible = false;
  }
}

// =================================================================== lifecycle
export function initTools() {
  buildSonar();
  buildSpear();
  buildThruster();
}

export function updateTools(dt, t, p) {
  ev.spearKill = null;
  ev.spearRecovered = 0;
  updateSonar(dt);
  updateSpears(dt, t, p);
  updateThruster(dt, t);
  return ev;
}

// Debug/automation surface, mirroring the other systems'.
window.tools = {
  spears,
  sonar: () => ({ cool: +sonarCool.toFixed(2), age: +sonarAge.toFixed(2), echoes: echoN, live: echoLive }),
  thruster: () => ({ jet: jAlive, bub: bAlive, ring: +ringT.toFixed(2), burstT: +burstT.toFixed(3), bursts: burstCount }),
  jetPos: () => jet.pos, jetCol: () => jet.col, bubPos: () => bub.pos, bubCol: () => bub.col,
  drop: () => spears.map(s => s.state)
};
