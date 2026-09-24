// Shared machinery for every sleeper kind (roadmap/three-sleepers.md, spec §4): the
// live-sleeper pointer and the sonar/keeper rules keyed on it, the fixed ward light
// pool, the carved rune, ward construction and the touch rule, ember bursts, dispose.
// Each creature file (serpent.js, brooder.js) builds its own body and motion on this.
import * as THREE from 'three';
import { scene, envTexDeep as envTex } from '../../core.js';
import { clamp } from '../../lib/math.js';
import { makeGlow, glowTex, canvas2d, maxAniso } from '../../lib/textures.js';
import { setWardTargets, wardGuardCount } from '../../world/predators.js';

const _b = new THREE.Vector3();

// ---- A TOOL-SHAPED REASON PER ZONE (eval-zone-tool-reasons) --------------------------
// The three rites used to be the same touch-N-wards fight with a bigger N. Now:
//   ZONE 1 — ORUNE's wards sit DARK: no rune glow, no light, no halo, no hide-light, and
//     a touch does nothing. A sonar ping within SONAR reach (tools.js calls revealWards)
//     rings them for REVEAL_T seconds: they come up to the normal idle and take a touch.
//     Outside the window they are iron on hide, and the player walks past them.
//   ZONE 2 — MHOR's wards are KEPT: predators.js stations 2-3 squid on each unlit ward
//     (fed the ward positions through setWardTargets every frame) and a ward is
//     untouchable while wardGuardCount(i) > 0. Spear or knife clears the keepers.
// Both are keyed on the zone index, so a remote site's Orune/Mhor row inherits them.
// Messages are handed up as ev.msg (one-shot, per leviathan); game.js shows them.
const REVEAL_T = 8;
export { REVEAL_T };
export const MSG_WARDS_ANSWER = 'THE WARDS OF ORUNE ANSWER THE PING.';
export const MSG_WARDS_DARK = 'THE WARDS OF ORUNE ARE DARK. SOUND FOR THEM.';
export const MSG_WARDS_KEPT = "MHOR'S WARDS ARE KEPT. CUT THE KEEPERS LOOSE.";
// The live sleeper (game.js owns `lev`; this is the same object, for the tools hook).
let live = null;
export function setLive(L) { live = L; }

// tools.js's sonar hook: a ping from `origin` rings every dark ward of the live zone-1
// sleeper whose body passes within `range` of it. Returns true if anything answered.
export function revealWards(origin, range = 120) {
  const L = live;
  if (!L || !L.sonarWards || L.calmed) return false;
  const r2 = range * range;
  let hit = L.head.distanceToSquared(origin) < r2;
  if (!hit) for (let i = 0; i < L.spine.length && !hit; i++) hit = L.spine[i].distanceToSquared(origin) < r2;
  if (!hit) return false;
  L.reveal = REVEAL_T;
  if (!L.rang) { L.rang = true; L.pendingMsg = MSG_WARDS_ANSWER; }
  return true;
}
// Seconds left on the ring (0 when dark); dev/probe read.
export function wardRevealLeft() { return live && live.sonarWards ? Math.max(0, live.reveal) : 0; }

// A carved ward: ring, ticks and a mirrored angular glyph. White mask, tinted by the material.
export function runeTex(seed) {
  const { canvas, ctx } = canvas2d(128);
  let s = Math.abs(seed * 9301 + 49297) % 233280;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  ctx.translate(64, 64);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
  ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, 0, 41, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, r1 = i % 4 ? 56 : 61;
    ctx.lineWidth = i % 4 ? 1.6 : 4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 50, Math.sin(a) * 50);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.lineWidth = 5.5;
  for (let k = 0; k < 4; k++) {
    const a0 = rnd() * 6.28, r0 = 7 + rnd() * 22, a1 = a0 + (rnd() - 0.5) * 2.4, r1 = 9 + rnd() * 28;
    for (const mr of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * r0 * mr, Math.sin(a0) * r0);
      ctx.lineTo(Math.cos(a1) * r1 * mr, Math.sin(a1) * r1);
      ctx.stroke();
    }
  }
  ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
  const tx = new THREE.CanvasTexture(canvas);
  tx.anisotropy = maxAniso();
  return tx;
}


// ---- SIGIL LIGHT POOL --------------------------------------------------------
// enterZone disposes and remakes the leviathan LIVE mid-dive. When each ward owned
// its own PointLight the scene's LIGHT COUNT changed at that moment (3/4/5 per zone)
// and three recompiled every lit material in the game at the worst possible time —
// the exact hazard the vents' single shared PointLight exists to avoid. The wards now
// borrow from a fixed pool of 5 (the largest authored nSigils), created on the first
// build, added to the scene ONCE and NEVER removed; disposeLeviathan parks them at
// intensity 0. Decay is 2.0 (physical): the calming flash used to run decay 1.8,
// which splashed light across the whole zone; 2.0 keeps the close-range punch and
// shrinks the far spill (peak retuned in updateSigilFX to match by eye up close).
export const SIGIL_POOL_N = 5;
export const sigilPool = [];
export function ensureSigilPool() {
  if (sigilPool.length) return;
  for (let k = 0; k < SIGIL_POOL_N; k++) {
    const pl = new THREE.PointLight(0xffe8a8, 0, 50, 2.0);
    sigilPool.push(pl);
    scene.add(pl);
  }
}


// Distance from p to the segment a->b: a swept touch test, so a frame hitch or a
// fast swim-by can never tunnel the player straight through a sigil.
export function segDist(p, a, b) {
  _b.subVectors(b, a);
  const l2 = _b.lengthSq();
  if (l2 < 1e-8) return p.distanceTo(a);
  const s = clamp(((p.x - a.x) * _b.x + (p.y - a.y) * _b.y + (p.z - a.z) * _b.z) / l2, 0, 1);
  return Math.hypot(a.x + _b.x * s - p.x, a.y + _b.y * s - p.y, a.z + _b.z * s - p.z);
}


// One ember burst from a freshly lit ward. Ring buffer, so a burst never allocates.
export function burstEmbers(L, at, n = 40) {
  const E = L.em;
  for (let k = 0; k < n; k++) {
    const i = E.head; E.head = (E.head + 1) % E.cap;
    if (E.life[i] <= 0) E.alive++;
    const o = i * 3;
    E.pos[o] = at.x; E.pos[o + 1] = at.y; E.pos[o + 2] = at.z;
    const th = Math.random() * 6.2832, ph = Math.acos(1 - 2 * Math.random());
    const sp = L.size * (1.1 + Math.random() * 3.0);
    E.vel[o] = Math.sin(ph) * Math.cos(th) * sp;
    E.vel[o + 1] = Math.cos(ph) * sp * 0.6;
    E.vel[o + 2] = Math.sin(ph) * Math.sin(th) * sp;
    E.life[i] = 1;
    E.sz[i] = 0.45 + Math.random() * 1.05;
  }
  L.embers.visible = true;
}

export function updateEmbers(L, dt) {
  const E = L.em;
  if (!E.alive) { L.embers.visible = false; return; }
  const dr = Math.pow(0.26, dt), rise = L.size * 1.1 * dt;
  let alive = 0;
  for (let i = 0; i < E.cap; i++) {
    if (E.life[i] <= 0) continue;
    E.life[i] -= dt * 0.42;                                   // ~2.4s tails
    if (E.life[i] <= 0) { E.life[i] = 0; continue; }
    alive++;
    const o = i * 3;
    E.vel[o] *= dr; E.vel[o + 1] = E.vel[o + 1] * dr + rise; E.vel[o + 2] *= dr;
    E.pos[o] += E.vel[o] * dt;
    E.pos[o + 1] += E.vel[o + 1] * dt;
    E.pos[o + 2] += E.vel[o + 2] * dt;
  }
  E.alive = alive;
  L.embers.geometry.attributes.position.needsUpdate = true;
  L.embers.geometry.attributes.aLife.needsUpdate = true;
  L.embers.geometry.attributes.aSize.needsUpdate = true;
}

// Generic teardown: park the borrowed ward lights (never remove them — the pool exists
// to keep the scene's light count constant), drop the group, let the creature release
// anything outside it (L.onDispose), then free every geometry/material/texture under
// grp except the shared glow/env maps and anything the creature caches (L.keepTex).
export function disposeSleeper(L) {
  if (!L) return;
  if (live === L) { live = null; setWardTargets(-1, null); }
  for (const g of L.sigils) g.light.intensity = 0;
  scene.remove(L.grp);
  if (L.onDispose) L.onDispose();
  L.grp.traverse(o => {
    if (o.geometry && !o.isSprite) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) {
        const v = m[k];
        if (v && v.isTexture && v !== glowTex && v !== envTex && !(L.keepTex && L.keepTex.has(v))) v.dispose();
      }
      m.dispose();
    }
  });
}

// ---- wards, for kinds that place them in their own frame ---------------------------
// (The serpent keeps its original inline ward code; these are the same visuals and the
// same touch rule, factored for the kinds that followed.)
const _wq = new THREE.Vector3();
export function makeWard(L, i, scale) {
  const ringGeo = new THREE.TorusGeometry(0.62, 0.11, 6, 18);
  const boltGeo = new THREE.ConeGeometry(0.10, 0.42, 5);
  boltGeo.translate(0, 0.21, 0);
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x241d16, roughness: 0.42, metalness: 0.85, envMap: envTex, envMapIntensity: 1.1 });
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.9, metalness: 0.2 });
  const sg = new THREE.Group();
  sg.scale.setScalar(scale);
  sg.add(new THREE.Mesh(ringGeo, ironMat));
  const socket = new THREE.Mesh(new THREE.CircleGeometry(0.60, 16), socketMat);
  socket.position.z = -0.05;
  sg.add(socket);
  const bolts = new THREE.InstancedMesh(boltGeo, ironMat, 6);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (let b = 0; b < 6; b++) {
    const a = b / 6 * 6.2832;
    p.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.04);
    q.setFromUnitVectors(_wq.set(0, 1, 0), p.clone().setZ(0).normalize().multiplyScalar(0.45).setZ(1).normalize());
    bolts.setMatrixAt(b, m.compose(p, q, s));
  }
  bolts.instanceMatrix.needsUpdate = true;
  sg.add(bolts);
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), new THREE.MeshBasicMaterial({
    map: runeTex(L.idx * 17 + i * 7), color: 0xffe8a8, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  rune.position.z = 0.08;
  sg.add(rune);
  const light = sigilPool[i - 1];
  light.intensity = 0;
  const halo = makeGlow(0xffe8a8, 0);
  L.grp.add(halo, sg);
  return { lit: false, grp: sg, mesh: sg, rune, light, halo, pulse: Math.random() * 7, flashT: 9, rev: 1, note: 352 + i * 40, scale };
}
export function wardIdle(g, dt, haloK) {
  g.pulse += dt;
  const rv = g.rev;
  g.rune.material.opacity = (0.22 + 0.16 * Math.sin(g.pulse * 2)) * rv;
  g.light.intensity = (8 + 5 * Math.sin(g.pulse * 2)) * rv;
  g.halo.scale.setScalar(Math.max(0.001, (haloK * 1.2 + Math.sin(g.pulse * 2) * 0.6) * rv));
  g.light.position.copy(g.grp.position);
  g.halo.position.copy(g.grp.position);
}
export function wardLitPose(g, dt, haloK) {
  g.pulse += dt;
  g.rune.material.opacity = 1;
  g.grp.scale.setScalar(g.scale * (1 + 0.04 * Math.sin(g.pulse * 3)));
  g.light.intensity = 140 + 40 * Math.sin(g.pulse * 3);
  g.halo.scale.setScalar(haloK * 3);
  g.light.position.copy(g.grp.position);
  g.halo.position.copy(g.grp.position);
}
// The touch: a swept test from last frame's diver position, so a hitch or a fast pass
// can't tunnel through a ward. The zone-1 dark rule and zone-2 keeper rule apply to any
// kind that sets sonarWards / guardWards. Returns true on the frame the ward lights.
export function wardTouch(L, i, g, player, ev) {
  if (segDist(g.grp.position, L.pPrev, player.pos) >= L.reach) return false;
  const dark = L.sonarWards && g.rev < 0.5;
  const kept = L.guardWards && wardGuardCount(i) > 0;
  if (dark || kept) {
    if (!L.hinted) { L.hinted = true; ev.msg = ev.msg || (dark ? MSG_WARDS_DARK : MSG_WARDS_KEPT); }
    return false;
  }
  g.lit = true; g.rev = 1; g.flashT = 0;
  L.flare = 1;
  burstEmbers(L, g.grp.position);
  ev.sigilLit = g.note;
  L.agitation = 1;
  return true;
}
// The ward-lighting flash: ~1.5 s of extra light on the borrowed PointLight (and the
// hide ring, for kinds with a uniform array to drive).
export function wardFlashes(L, dt, fx) {
  for (let i = 0; i < L.sigils.length; i++) {
    const g = L.sigils[i], f = fx ? fx[i] : null;
    if (g.flashT >= 1.5) { if (f) f.y = 0; continue; }
    g.flashT += dt;
    const k = Math.min(1, g.flashT / 1.5);
    if (f) { f.x = 0.62 * Math.pow(k, 0.65); f.y = 3.4 * (1 - k) * (1 - k) * THREE.MathUtils.smoothstep(k, 0, 0.06); }
    g.light.intensity += 360 * (1 - k) * (1 - k) * (1 - k);
  }
  updateEmbers(L, dt);
}
// The ember burst pool, idle at zero cost (mesh hidden, no integration).
export function makeEmbers(L, size) {
  const EM = 96;
  const emPos = new Float32Array(EM * 3), emLife = new Float32Array(EM), emSz = new Float32Array(EM);
  const emVel = new Float32Array(EM * 3);
  const emGeo = new THREE.BufferGeometry();
  emGeo.setAttribute('position', new THREE.BufferAttribute(emPos, 3));
  emGeo.setAttribute('aLife', new THREE.BufferAttribute(emLife, 1));
  emGeo.setAttribute('aSize', new THREE.BufferAttribute(emSz, 1));
  emGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const emMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: glowTex }, uPS: { value: size * 170 } },
    vertexShader: /* glsl */`
      attribute float aLife, aSize;
      uniform float uPS;
      varying float vL;
      void main(){
        vL = aLife;
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = aSize*uPS/max(-mv.z, 0.5);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      varying float vL;
      void main(){
        if (vL <= 0.0) discard;
        float a = texture2D(uTex, gl_PointCoord).a;
        vec3 col = mix(vec3(1.0,0.42,0.12), vec3(1.0,0.94,0.78), vL);
        gl_FragColor = vec4(col, a*vL*(0.35+0.65*vL)*1.25);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  L.embers = new THREE.Points(emGeo, emMat);
  L.embers.frustumCulled = false;
  L.embers.visible = false;
  L.em = { pos: emPos, vel: emVel, life: emLife, sz: emSz, cap: EM, head: 0, alive: 0 };
  L.grp.add(L.embers);
}
