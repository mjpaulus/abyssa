// ABYSSA — ventlife.js
// OWNED BY: craft agent (contract fixed by orchestrator; see game.js wiring)
//
// Vent fauna for zone 1: pale shrimp swarms and crabs at the active chimney
// throats — the boiler room inhabited, not just built. Anchors come from
// vents.js `activeVents` ({x,y,z,baseR}, array identity stable across reseeds,
// repopulated by reseedVents BEFORE reseedVentLife runs).
//
// Contract:
//   buildVentLife()        — one-time build (materials/geometry created ONCE, ever)
//   reseedVentLife()       — re-anchor to the current activeVents in place;
//                            never recreate materials or grow geometry
//   updateVentLife(dt, t)  — per-frame; zero allocation; must early-out cheaply
//                            when the camera is far from zone 1
//
// TECHNIQUE — two InstancedMeshes, two draw calls, ZERO per-frame CPU work per
// instance. Both are MeshStandardMaterial (matte, lit by the scene exactly like
// the chimneys, fog ON — the per-channel Beer-Lambert chunk is CORRECT for
// fauna, it is only the ember SPRITES in vents.js that need fog:false) with all
// motion moved into the vertex shader off a single shared uTime/uVis uniform.
// The CPU writes two floats a frame and nothing else.
//
// NO GLOW. No emissive term, no additive blending, no fog:false. These animals
// are visible only where the vent's ember light or the scene's ambient reaches
// them, which is the whole point: life you find by getting close to the fire.
//
// Buffers are sized for MAX_VENTS at build time and never grow; a reseed
// recomputes matrices/attributes IN PLACE into the same typed arrays and drives
// how much is drawn with `inst.count`.
//
// Budget (measured, see report): 2 draw calls, ~1440 shrimp (~14 tris each) +
// ~16 crabs (~44 tris each), ~21k tris, 0 B/frame allocation, and everything is
// `visible = false` above y = -340 so a zone-0 or zone-2 frame pays one compare.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, camera } from '../core.js';
import { clamp } from '../lib/math.js';
import { terrainH } from './terrain.js';
import { activeVents } from './vents.js';

const TAU = Math.PI * 2;
const ZI = 1;

// Capacity: activeVents runs ~12 at the shipped site; 20 leaves headroom for any
// authored anchorage without ever regrowing a buffer.
const MAX_VENTS = 20;
const SHRIMP_PER_VENT = 160;
const CRABS_PER_VENT = 2;
const MAX_SHRIMP = MAX_VENTS * SHRIMP_PER_VENT;
const MAX_CRABS = MAX_VENTS * CRABS_PER_VENT;

// Depth band. Zone 1's floor sits near y = -570 and the tallest chimney tops out
// ~14 above it, so -340 is a generous gate: everything is invisible and the
// update does no work at all above it. The deep edge hands over to zone 2.
const FADE_IN0 = -340, FADE_IN1 = -400;
const FADE_OUT0 = -580, FADE_OUT1 = -630;

// Sulfide-crust pale, one step paler and more desaturated than vents.js C_PALE
// (0xb9ac86) — bone, not bleach. Flat material colour, shaded per instance in
// the fragment shader off the instance's own phase (no extra attribute).
// Measured brighter first (0xd6cfbc): under the diver's own lantern at 3 units
// the swarm blew out to paper-white and read as falling snow, not animals.
const C_SHRIMP = 0xa79f8b;
const C_CRAB = 0x9c9280;

// ---------------------------------------------------------------------------
// deterministic layout stream — mulberry32. Re-seeded from the same constant at
// the top of every layout() call, so the fauna is a PURE FUNCTION of the current
// activeVents contents: same vents in, same shrimp out, no cursor carried over.
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(0x5EA11FE);
const rng = (a, b) => a + rnd() * (b - a);

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
let built = false;
const uni = { uTime: { value: 0 }, uVis: { value: 0 } };
let shrimp = null, crabs = null;
let shrimpMat = null, crabMat = null;
let aShrimpA = null, aShrimpB = null, aCrab = null;

// ---------------------------------------------------------------------------
// geometry — built ONCE, ever. Both bodies are authored around the origin with
// +X forward so the vertex shader's yaw is a plain 2x2 on (x, z).
// ---------------------------------------------------------------------------

// A caridean fleck: open-ended tapered barrel + a snout cone + a two-triangle
// tail fan. 4-sided and open-ended on purpose — at the size these read on screen
// (a few pixels at arm's length) caps and extra rings are pure triangle tax.
function shrimpGeometry() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.16, 0.30, 0.62, 4, 1, true);
  body.rotateZ(Math.PI / 2);           // +Y -> +X
  body.translate(0.05, 0, 0);
  parts.push(body);

  const head = new THREE.ConeGeometry(0.30, 0.30, 4, 1, true);
  head.rotateZ(-Math.PI / 2);
  head.translate(0.51, 0, 0);
  parts.push(head);

  // tail fan — a flat wedge, two triangles, doubled by the material's DoubleSide
  const fan = new THREE.BufferGeometry();
  fan.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.26, 0, 0, -0.50, 0.09, 0.09, -0.50, 0.09, -0.09,
    -0.26, 0, 0, -0.50, -0.07, 0.09, -0.50, -0.07, -0.09
  ], 3));
  fan.computeVertexNormals();
  parts.push(fan);

  const g = mergeGeometries(parts.map(p => {
    if (!p.attributes.uv) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
    return p.index ? p.toNonIndexed() : p;
  }), false);
  for (const p of parts) p.dispose();
  return g;
}

// A crab: low carapace, two claws held forward, four stub legs per side folded
// into two blocks. Legs are the only vertices below y = 0 — the shader keys the
// shuffle off that sign test, so no extra attribute is needed.
function crabGeometry() {
  const parts = [];
  const shell = new THREE.BoxGeometry(0.34, 0.16, 0.46);
  shell.translate(0, 0.10, 0);
  parts.push(shell);

  for (const s of [-1, 1]) {
    const claw = new THREE.BoxGeometry(0.22, 0.09, 0.09);
    claw.translate(0.24, 0.06, s * 0.17);
    claw.rotateY(s * 0.30);
    parts.push(claw);
    const legs = new THREE.BoxGeometry(0.30, 0.05, 0.07);
    legs.translate(0, -0.04, s * 0.27);
    parts.push(legs);
  }

  const g = mergeGeometries(parts.map(p => p.toNonIndexed()), false);
  for (const p of parts) p.dispose();
  return g;
}

// ---------------------------------------------------------------------------
// materials — created ONCE, ever, and NEVER recreated by a reseed (a fresh
// instance recompiles). Two MeshStandardMaterial variants share the standard
// program source, so each carries a distinct customProgramCacheKey or three
// silently hands the second one the first one's compiled program (the
// creatures.js hazard).
// ---------------------------------------------------------------------------
function shrimpMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: C_SHRIMP, roughness: 0.78, metalness: 0.0,
    side: THREE.DoubleSide, emissive: 0x000000
  });
  m.customProgramCacheKey = () => 'abyssa-ventlife-shrimp';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSwirl;   // x: phase  y: angular speed (signed)  z: orbit radius  w: height offset
        attribute vec4 aBody;    // x: size   y: bob rate  z: bob phase  w: radial wobble
        uniform float uTime; uniform float uVis;
        varying float vShade;
        mat2 vlYaw(float s, float c){ return mat2(c, -s, s, c); }`)
      // beginnormal_vertex runs first and its locals stay in scope for
      // begin_vertex below — one swirl evaluation serves both.
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float vlAng = aSwirl.x + uTime * aSwirl.y;
        float vlR = aSwirl.z + sin(uTime * aBody.y * 0.7 + aSwirl.x * 3.1) * aBody.w;
        float vlSa = sin(vlAng), vlCa = cos(vlAng);
        // heading is tangential to the orbit, flipped for the counter-swimmers
        float vlDir = aSwirl.y < 0.0 ? -1.0 : 1.0;
        float vlH = atan(vlCa * vlDir, -vlSa * vlDir);
        float vlHs = sin(vlH), vlHc = cos(vlH);
        mat2 vlRot = vlYaw(vlHs, vlHc);
        objectNormal.xz = vlRot * objectNormal.xz;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float vlSz = aBody.x * uVis;
        // pleopod flick — the tail end sweeps, the head barely moves
        // Reversed-edge smoothstep is UB (0.0 on this driver) — the flick never moved
        // a vertex. 1.0 - smoothstep(lo, hi, x) is the defined form (water.js foldK).
        float vlFlex = 1.0 - smoothstep(-0.6, 0.15, position.x);
        transformed.z += sin(uTime * 9.0 * aBody.y + aBody.z) * 0.10 * vlFlex;
        transformed *= vlSz;
        transformed.xz = vlRot * transformed.xz;
        transformed.x += vlCa * vlR;
        transformed.z += vlSa * vlR;
        transformed.y += aSwirl.w + sin(uTime * aBody.y + aBody.z) * 0.22;
        vShade = 0.74 + 0.34 * fract(aSwirl.x * 3.7);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vShade;`)
      // Tint only — no emissive, no added light. These are matte animals.
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= vShade;`);
  };
  return m;
}

function crabMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: C_CRAB, roughness: 0.88, metalness: 0.0, emissive: 0x000000
  });
  m.customProgramCacheKey = () => 'abyssa-ventlife-crab';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aCrab;    // x: phase  y: rate
        uniform float uTime; uniform float uVis;
        varying float vShade;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Mostly still. A slow rock on the carapace and a leg shuffle that only
        // touches the vertices below the body — a crab holding station in the
        // warm water, not a crab walking somewhere.
        float vlP = uTime * aCrab.y + aCrab.x;
        float vlLeg = step(position.y, 0.0);
        transformed.x += sin(vlP * 3.1) * 0.035 * vlLeg;
        transformed.z += cos(vlP * 2.3) * 0.025 * vlLeg;
        transformed.y += sin(vlP * 0.9) * 0.012;
        transformed *= uVis;
        vShade = 0.80 + 0.28 * fract(aCrab.x * 2.9);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vShade;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= vShade;`);
  };
  return m;
}

// ---------------------------------------------------------------------------
// build — once, ever.
// ---------------------------------------------------------------------------
export function buildVentLife() {
  if (built) return;
  built = true;

  shrimpMat = shrimpMaterial();
  crabMat = crabMaterial();

  shrimp = new THREE.InstancedMesh(shrimpGeometry(), shrimpMat, MAX_SHRIMP);
  crabs = new THREE.InstancedMesh(crabGeometry(), crabMat, MAX_CRABS);
  for (const m of [shrimp, crabs]) {
    m.castShadow = false;
    m.receiveShadow = false;
    // The field spans ~240 units; a bounding sphere would have to cover all of
    // it anyway, and the depth gate below is a far cheaper cull than three's.
    m.frustumCulled = false;
    m.visible = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    scene.add(m);
  }

  aShrimpA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHRIMP * 4), 4);
  aShrimpB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHRIMP * 4), 4);
  aCrab = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CRABS * 2), 2);
  aShrimpA.setUsage(THREE.DynamicDrawUsage);
  aShrimpB.setUsage(THREE.DynamicDrawUsage);
  aCrab.setUsage(THREE.DynamicDrawUsage);
  shrimp.geometry.setAttribute('aSwirl', aShrimpA);
  shrimp.geometry.setAttribute('aBody', aShrimpB);
  crabs.geometry.setAttribute('aCrab', aCrab);

  // Shrimp instance matrices are TRANSLATION ONLY (the anchor throat). Size and
  // heading live in the vertex shader, so the identity terms below are written
  // once here and never touched again — a reseed rewrites three floats each.
  const sm = shrimp.instanceMatrix.array;
  for (let i = 0; i < MAX_SHRIMP; i++) {
    const o = i * 16;
    sm[o] = 1; sm[o + 5] = 1; sm[o + 10] = 1; sm[o + 15] = 1;
  }

  layout();
}

// ---------------------------------------------------------------------------
// reseed — re-anchor in place. No new materials, no new geometry, no growth.
// ---------------------------------------------------------------------------
export function reseedVentLife() {
  if (!built) { buildVentLife(); return; }
  layout();
}

// ---------------------------------------------------------------------------
// layout — pure function of the current activeVents contents, written straight
// into the existing typed arrays.
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

function layout() {
  rnd = mulberry32(0x5EA11FE);

  const nV = Math.min(activeVents.length, MAX_VENTS);
  const sm = shrimp.instanceMatrix.array;
  const A = aShrimpA.array, B = aShrimpB.array, C = aCrab.array;

  let si = 0, ci = 0;
  for (let v = 0; v < nV; v++) {
    const vent = activeVents[v];
    const baseY = terrainH(vent.x, vent.z, ZI);
    const H = Math.max(vent.y - baseY, 1.2);     // chimney height
    const bR = Math.max(vent.baseR, 0.6);

    // ---- shrimp: the warm column over the top third of the stack ------------
    // Both the radius and the height are drawn with a power bias toward the
    // throat, so the swarm packs at the mouth and thins outward — density is the
    // whole read here, an even shell around the chimney looks like confetti.
    for (let k = 0; k < SHRIMP_PER_VENT; k++, si++) {
      const u = rnd();
      const r = bR * 0.30 + Math.pow(u, 3.0) * (bR * 0.85 + 0.55);
      const hu = Math.pow(rnd(), 1.9);
      // Down the top of the flank to just over the mouth, packed at the throat.
      // Measured wider first (radius to ~5, an 8-metre column) and it read as
      // drifting debris across half the frame instead of a swarm ON something.
      const yOff = -Math.min(H * 0.30, 3.0) + hu * (Math.min(H * 0.30, 3.0) + 2.2);

      const o = si * 16;
      sm[o + 12] = vent.x; sm[o + 13] = vent.y; sm[o + 14] = vent.z;

      const o4 = si * 4;
      A[o4] = rnd() * TAU;                                   // phase
      A[o4 + 1] = rng(0.25, 0.85) * (rnd() < 0.5 ? -1 : 1);  // angular speed, both ways
      A[o4 + 2] = r;
      A[o4 + 3] = yOff;
      B[o4] = rng(0.070, 0.135);                             // body length (~7-14 cm)
      B[o4 + 1] = rng(0.8, 1.5);                             // bob / flick rate
      B[o4 + 2] = rnd() * TAU;
      B[o4 + 3] = rng(0.08, 0.26);                           // radial wobble
    }

    // ---- crabs: on the crust at the chimney's foot -------------------------
    // Placed on the seabed rather than pinned to the flank on purpose: the
    // chimneys lean as they grow and ventlife only knows the throat, so a
    // flank-clung crab would float off the rock on the leaned ones. terrainH
    // puts these exactly on the ground, every time.
    for (let k = 0; k < CRABS_PER_VENT; k++, ci++) {
      const a = rnd() * TAU, rr = bR + rng(0.5, 3.0);
      const cx = vent.x + Math.cos(a) * rr, cz = vent.z + Math.sin(a) * rr;
      const cy = terrainH(cx, cz, ZI) + 0.06;
      _p.set(cx, cy, cz);
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * TAU);
      _s.setScalar(rng(0.85, 1.35));
      _m.compose(_p, _q, _s);
      crabs.setMatrixAt(ci, _m);
      C[ci * 2] = rnd() * TAU;
      C[ci * 2 + 1] = rng(0.4, 0.9);
    }
  }

  shrimp.count = si;
  crabs.count = ci;
  shrimp.instanceMatrix.needsUpdate = true;
  crabs.instanceMatrix.needsUpdate = true;
  aShrimpA.needsUpdate = true;
  aShrimpB.needsUpdate = true;
  aCrab.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// frame — two shared floats and a depth compare. No allocation, no per-instance
// work, ever. Above the zone-1 band this is one branch and a return.
// ---------------------------------------------------------------------------
export function updateVentLife(dt, t) {
  if (!built) return;
  const camY = camera.position.y;

  if (camY > FADE_IN0 || camY < FADE_OUT1) {
    // Cheap early-out: everything off, no uniform writes, nothing drawn.
    if (shrimp.visible) { shrimp.visible = false; crabs.visible = false; }
    return;
  }

  const inK = clamp((FADE_IN0 - camY) / (FADE_IN0 - FADE_IN1), 0, 1);
  const outK = clamp((camY - FADE_OUT1) / (FADE_OUT0 - FADE_OUT1), 0, 1);
  const vis = Math.min(inK, outK);

  uni.uTime.value = t;
  // uVis scales the model itself in the vertex shader, so the band edges shrink
  // the animals away instead of fading them — no transparency, no sorting, and
  // the material stays a plain opaque lit surface.
  uni.uVis.value = vis;

  const on = vis > 0.001;
  if (shrimp.visible !== on) { shrimp.visible = on; crabs.visible = on; }
}
