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
//   thrusterFX(on, player)            — visual state for the air thruster (bubble exhaust
//     off the backpack); physics + air drain stay in game.js/player.js.
//
// Discipline: every pool is allocated once at init, every hot-path vector is a module
// temp, and each subsystem early-outs to zero work when idle.
import * as THREE from 'three';
import { scene } from '../core.js';
import { ZONE_GAP, RIFT_R, riftPos, zoneBottom } from '../config.js';
import { rng, clamp } from '../lib/math.js';
import { glowTex } from '../lib/textures.js';
import { terrainH } from '../world/terrain.js';
import { motes } from '../world/rifts.js';
import { nodes } from '../world/resources.js';
import { slash } from '../world/predators.js';
import { RAFT_POS } from './raft.js';
import { airInletWorldPos } from '../entities/diver.js';
import { player } from '../player.js';

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
// A hard stream out of the backpack inlet, thrown opposite the direction of travel, plus
// a faint turbulence cone. Off means genuinely off: the pool stops updating once the last
// bubble dies.
const TH_MAX = 80;
const thPos = new Float32Array(TH_MAX * 3);
const thVel = new Float32Array(TH_MAX * 3);
const thLife = new Float32Array(TH_MAX);
const thMax = new Float32Array(TH_MAX);
const thAttr = new Float32Array(TH_MAX * 2);    // (alpha, size)
let thHead = 0, thLive = 0, thInt = 0, thEmit = 0, thOn = false;
let thPts = null, thCone = null;
const thOrigin = new THREE.Vector3(), thDir = new THREE.Vector3(0, -1, 0);

function buildThruster() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(thPos, 3));
  g.setAttribute('aLife', new THREE.BufferAttribute(thAttr, 2));
  const m = new THREE.ShaderMaterial({
    uniforms: {},
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec2 aLife; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aLife.y * (240.0 / max(-mv.z, 0.4)), 1.0, 40.0);
        vA = aLife.x;
        gl_Position = projectionMatrix * mv;
      }`,
    // vented air: a bright meniscus with a hollow middle, not a glowing dot
    fragmentShader: `
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;
        float rim = smoothstep(0.42, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
        float body = (1.0 - r * r) * 0.16;
        float a = (rim * 0.85 + body) * vA;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(vec3(0.74, 0.85, 0.88), a);
      }`
  });
  thPts = new THREE.Points(g, m);
  thPts.frustumCulled = false;
  thPts.visible = false;
  scene.add(thPts);

  const cg = new THREE.ConeGeometry(0.42, 2.0, 14, 1, true);
  cg.rotateX(Math.PI / 2);      // opens along +Z
  cg.translate(0, 0, 1.0);
  thCone = new THREE.Mesh(cg, new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false,
    vertexShader: `varying vec2 vUv; varying vec3 vN, vW;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uA; varying vec2 vUv; varying vec3 vN, vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float chord = pow(1.0 - abs(dot(normalize(vN), V)), 1.6);
        float a = chord * (1.0 - vUv.y) * uA;
        if (a <= 0.003) discard;
        gl_FragColor = vec4(vec3(0.60, 0.72, 0.76), a);
      }`
  }));
  thCone.frustumCulled = false;
  thCone.visible = false;
  scene.add(thCone);
}

// game.js owns the authoritative on/off (physics + air drain); we only render it.
export function thrusterFX(on, p) {
  thOn = !!on;
  if (on) {
    airInletWorldPos(thOrigin);
    // exhaust goes out the back: opposite the direction the diver is actually moving
    if (p.vel.lengthSq() > 0.25) thDir.copy(p.vel).normalize().negate();
    else thDir.set(-Math.sin(player.yaw), 0.1, -Math.cos(player.yaw)).normalize();
  }
}

function emitThrust(n) {
  for (let i = 0; i < n; i++) {
    const k = thHead; thHead = (thHead + 1) % TH_MAX;
    if (thLife[k] <= 0) thLive++;
    thPos[k * 3] = thOrigin.x + rng(-0.07, 0.07);
    thPos[k * 3 + 1] = thOrigin.y + rng(-0.07, 0.07);
    thPos[k * 3 + 2] = thOrigin.z + rng(-0.07, 0.07);
    const sp = rng(4.5, 8.5);
    thVel[k * 3] = thDir.x * sp + rng(-0.9, 0.9);
    thVel[k * 3 + 1] = thDir.y * sp + rng(-0.9, 0.9);
    thVel[k * 3 + 2] = thDir.z * sp + rng(-0.9, 0.9);
    thMax[k] = thLife[k] = rng(0.55, 1.05);
    thAttr[k * 2 + 1] = rng(0.55, 1.5);
  }
}

function updateThruster(dt) {
  thInt = thOn ? 1 : Math.max(0, thInt - dt / 0.4);
  if (thInt <= 0 && thLive === 0) {
    if (thPts.visible) { thPts.visible = false; thCone.visible = false; }
    return;
  }

  if (thInt > 0) {
    thEmit += dt * 58 * thInt;
    const n = thEmit | 0;
    if (n > 0) { thEmit -= n; emitThrust(Math.min(n, 12)); }
    thCone.visible = true;
    thCone.position.copy(thOrigin);
    thCone.quaternion.setFromUnitVectors(FWD_Z, thDir);
    thCone.material.uniforms.uA.value = 0.10 * thInt;
  } else if (thCone.visible) {
    thCone.visible = false;
  }

  thPts.visible = true;
  let live = 0;
  for (let k = 0; k < TH_MAX; k++) {
    if (thLife[k] <= 0) { thAttr[k * 2] = 0; continue; }
    live++;
    thLife[k] -= dt;
    if (thLife[k] <= 0) { thAttr[k * 2] = 0; live--; continue; }
    const drag = Math.pow(0.06, dt);
    thVel[k * 3] *= drag;
    thVel[k * 3 + 2] *= drag;
    // once the jet dies the air simply rises, the way vented air does
    thVel[k * 3 + 1] = thVel[k * 3 + 1] * drag + 2.6 * dt;
    thPos[k * 3] += thVel[k * 3] * dt;
    thPos[k * 3 + 1] += thVel[k * 3 + 1] * dt;
    thPos[k * 3 + 2] += thVel[k * 3 + 2] * dt;
    const t01 = thLife[k] / thMax[k];
    thAttr[k * 2] = Math.min(1, t01 * 2.2) * 0.85;
  }
  thLive = live;
  thPts.geometry.attributes.position.needsUpdate = true;
  thPts.geometry.attributes.aLife.needsUpdate = true;
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
  updateThruster(dt);
  return ev;
}

// Debug/automation surface, mirroring the other systems'.
window.tools = {
  spears,
  sonar: () => ({ cool: +sonarCool.toFixed(2), age: +sonarAge.toFixed(2), echoes: echoN, live: echoLive }),
  drop: () => spears.map(s => s.state)
};
