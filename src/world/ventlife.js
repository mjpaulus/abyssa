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
import { SKIN_COMMON, SKIN_LIGHTS } from './fauna.js';

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

// polish-fauna: every vertex carries uv = (surface kind, along) for the skin shader —
// shrimp: 0 carapace/abdomen, 1 eye, 2 fan/antenna/rostrum; crab: 0 shell, 1 leg,
// 2 claw, 3 eye. Built from plain arrays (no merge step), one indexed mesh each.
function vlMesh(P, U, I) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3) if (n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2] < 1e-12) n[i + 1] = 1;
  return g;
}
// Tube along a polyline with per-ring radii (ry, rz) and `sides` round; open ends.
function vlTube(P, U, I, spine, ry, rz, sides, kind, rot = 0) {
  const base = P.length / 3, n = spine.length;
  for (let i = 0; i < n; i++) {
    const a = spine[Math.max(0, i - 1)], b = spine[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // frame: side = t x up, up' = side x t
    let sx = ty * 0 - tz * 1, sy = tz * 0 - tx * 0, sz = tx * 1 - ty * 0;
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-4) { sx = 0; sy = 0; sz = 1; sl = 1; }
    sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * tz - sz * ty, uy = sz * tx - sx * tz, uz = sx * ty - sy * tx;
    for (let j = 0; j < sides; j++) {
      const ang = j / sides * Math.PI * 2 + rot, c = Math.cos(ang), s = Math.sin(ang);
      const p = spine[i];
      P.push(p[0] + ux * c * ry[i] + sx * s * rz[i], p[1] + uy * c * ry[i] + sy * s * rz[i], p[2] + uz * c * ry[i] + sz * s * rz[i]);
      U.push(kind, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) {
    const a = base + i * sides + j, b = base + i * sides + (j + 1) % sides;
    I.push(a, a + sides, b, b, a + sides, b + sides);
  }
}
function vlTri(P, U, I, a, b, c, kind) {
  const base = P.length / 3;
  P.push(...a, ...b, ...c); U.push(kind, 0, kind, 0.5, kind, 1);
  I.push(base, base + 1, base + 2);
}
function vlBead(P, U, I, c, r, kind) {        // octahedron: 8 tris
  const base = P.length / 3;
  const v = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]];
  for (const d of v) { P.push(c[0] + d[0], c[1] + d[1], c[2] + d[2]); U.push(kind, 0); }
  const f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  for (const t of f) I.push(base + t[0], base + t[1], base + t[2]);
}

// A caridean shrimp, ~56 tris: a hunched, laterally-compressed body (5 segments x 4
// sides, diamond section), rostrum, eyes on the carapace, two antennae, a split
// tail fan. The pleopod flick in the shader still keys off position.x < 0.15.
function shrimpGeometry() {
  const P = [], U = [], I = [];
  const spine = [[0.44, 0.02, 0], [0.24, 0.07, 0], [0.02, 0.08, 0], [-0.16, 0.05, 0], [-0.32, -0.01, 0], [-0.44, -0.07, 0]];
  vlTube(P, U, I, spine, [0.12, 0.17, 0.17, 0.14, 0.10, 0.06], [0.08, 0.12, 0.11, 0.09, 0.065, 0.04], 4, 0, Math.PI / 4 * 0);
  vlTri(P, U, I, [0.44, 0.07, 0.03], [0.44, 0.07, -0.03], [0.70, 0.13, 0], 2);                 // rostrum
  vlTri(P, U, I, [0.44, 0.07, -0.03], [0.44, 0.07, 0.03], [0.70, 0.13, 0], 2);
  for (const s of [-1, 1]) vlBead(P, U, I, [0.42, 0.10, s * 0.085], 0.045, 1);             // eyes
  for (const s of [-1, 1]) vlTri(P, U, I, [0.46, 0.0, s * 0.03], [0.46, 0.03, s * 0.035], [0.95, 0.22, s * 0.28], 2); // antennae
  vlTri(P, U, I, [-0.44, -0.05, 0.02], [-0.62, -0.02, 0.12], [-0.60, -0.11, 0.02], 2);    // uropods + telson
  vlTri(P, U, I, [-0.44, -0.05, -0.02], [-0.60, -0.11, -0.02], [-0.62, -0.02, -0.12], 2);
  vlTri(P, U, I, [-0.44, -0.04, 0.0], [-0.64, -0.06, 0.05], [-0.64, -0.06, -0.05], 2);
  vlTri(P, U, I, [-0.44, -0.04, 0.0], [-0.64, -0.06, -0.05], [-0.64, -0.06, 0.05], 2);
  return vlMesh(P, U, I);
}

// A vent crab, ~380 tris: a domed carapace with a front ridge, stalked eyes, two
// chelae held forward, four jointed walking legs a side. Legs are the only
// vertices below y = 0 (the shuffle keys off that), claws the only ones at x > 0.15.
function crabGeometry() {
  const P = [], U = [], I = [];
  // carapace: squashed dome, front edge a touch squarer
  const R = 7, S = 14, base = P.length / 3;
  for (let i = 0; i <= R; i++) {
    const v = i / R, phi = v * Math.PI * 0.5;
    for (let j = 0; j < S; j++) {
      const a = j / S * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const sq = 1 + 0.12 * Math.max(0, c) ** 4;
      P.push(c * Math.cos(phi) * 0.13 * sq, 0.035 + Math.sin(phi) * 0.075 * (1 - 0.25 * v * v), s * Math.cos(phi) * 0.22);
      U.push(0, v);
    }
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) {
    const a = base + i * S + j, b = base + i * S + (j + 1) % S;
    I.push(a, b, a + S, b, b + S, a + S);
  }
  // underside plate (sternum)
  const cb = P.length / 3; P.push(0, 0.03, 0); U.push(0, 1);
  for (let j = 0; j < S; j++) I.push(cb, base + (j + 1) % S, base + j);
  for (const s of [-1, 1]) {
    // eye stalks + eyes
    vlTube(P, U, I, [[0.12, 0.08, s * 0.05], [0.145, 0.12, s * 0.065]], [0.012, 0.01], [0.012, 0.01], 4, 3);
    vlBead(P, U, I, [0.148, 0.125, s * 0.068], 0.016, 3);
    // cheliped: merus -> carpus -> hand, then two fingers
    vlTube(P, U, I, [[0.06, 0.05, s * 0.15], [0.17, 0.07, s * 0.2], [0.24, 0.06, s * 0.15]], [0.02, 0.022, 0.02], [0.02, 0.022, 0.02], 5, 2);
    vlTube(P, U, I, [[0.24, 0.06, s * 0.15], [0.29, 0.065, s * 0.12], [0.33, 0.06, s * 0.1]], [0.03, 0.036, 0.022], [0.022, 0.026, 0.016], 6, 2);
    vlTube(P, U, I, [[0.33, 0.06, s * 0.1], [0.38, 0.055, s * 0.085]], [0.012, 0.003], [0.01, 0.003], 4, 2);
    vlTube(P, U, I, [[0.325, 0.045, s * 0.105], [0.37, 0.035, s * 0.095]], [0.01, 0.003], [0.008, 0.003], 4, 2);
    // four walking legs: coxa out from the shell edge, knee up, dactyl down to the crust
    for (let k = 0; k < 4; k++) {
      const x = 0.06 - k * 0.055, z = 0.17 - Math.abs(k - 1.5) * 0.012;
      const sp = 0.1 + k * 0.03;
      vlTube(P, U, I, [[x, 0.04, s * z], [x - 0.02, 0.09, s * (z + 0.1)], [x - 0.05 - sp * 0.2, -0.02, s * (z + 0.19)], [x - 0.07 - sp * 0.3, -0.07, s * (z + 0.23)]],
        [0.016, 0.014, 0.011, 0.003], [0.013, 0.011, 0.009, 0.003], 4, 1);
    }
  }
  return vlMesh(P, U, I);
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
        varying float vShade; varying vec2 vVl; varying vec3 vVlP;
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
        vShade = 0.74 + 0.34 * fract(aSwirl.x * 3.7);
        vVl = uv; vVlP = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vShade; varying vec2 vVl; varying vec3 vVlP;
        ${SKIN_COMMON}`)
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
        ${SKIN_LIGHTS}`)
      // polish-fauna: a glassy caridean. Pale translucent carapace with the segment
      // overlaps drawn in, the gut showing dark through the back, a scatter of red
      // chromatophores, black wet eyes. Still no glow: the only added term is light
      // the scene already has, TRANSMITTED through the body (the vent fire behind a
      // shrimp shows through it) — zero where there is no light.
      .replace('#include <color_fragment>', `#include <color_fragment>
        float vlK = floor(vVl.x + 0.5);
        vec3 vp = vVlP;
        vec3 vlC = vec3(1.0);
        float abd = 1.0 - smoothstep(0.05, 0.15, vp.x);
        float seg = (1.0 - smoothstep(0.0, 0.08, abs(fract((0.12 - vp.x) * 7.5) - 0.5) * 2.0 - 0.86)) * abd;
        vlC *= 1.0 - 0.28 * seg;
        float gut = (1.0 - smoothstep(0.012, 0.03, abs(vp.z))) * step(0.03, vp.y) * (1.0 - smoothstep(0.3, 0.4, vp.x));
        vlC = mix(vlC, vec3(0.42, 0.30, 0.22), gut * 0.7);
        vec3 cv = skVor(vp.xy * 26.0 + vp.z * 13.0);
        float chrom = (1.0 - smoothstep(0.08, 0.14, cv.x)) * step(0.55, cv.z);
        vlC = mix(vlC, vec3(0.95, 0.42, 0.30), chrom * 0.8 * step(vlK, 0.5));
        float vlEye = step(0.5, vlK) * step(vlK, 1.5);
        vlC = mix(vlC, vec3(0.02, 0.018, 0.016), vlEye);
        vlC *= mix(1.0, 1.12, step(1.5, vlK));
        diffuseColor.rgb *= vShade * vlC;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.42, 0.06, vlEye);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * skTransmit(normal, vViewPosition) * (1.0 - vlEye) * 0.55;
        totalEmissiveRadiance += skCatch(normal, normalize(vViewPosition), vViewPosition) * vlEye * 0.8;`);
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
        varying float vShade; varying vec2 vVl; varying vec3 vVlP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vVl = uv; vVlP = position;
        // Mostly still. A slow rock on the carapace and a leg shuffle that only
        // touches the vertices below the body — a crab holding station in the
        // warm water, not a crab walking somewhere.
        float vlP = uTime * aCrab.y + aCrab.x;
        float vlLeg = step(position.y, 0.0);
        transformed.x += sin(vlP * 3.1) * 0.035 * vlLeg;
        transformed.z += cos(vlP * 2.3) * 0.025 * vlLeg;
        transformed.y += sin(vlP * 0.9) * 0.012;
        // occasional claw lift: only the claw verts (x > 0.15), on a slow beat —
        // a threat display held for a breath, then lowered
        transformed.y += max(0.0, sin(vlP * 0.5)) * 0.06 * step(0.15, position.x);
        transformed *= uVis;
        vShade = 0.80 + 0.28 * fract(aCrab.x * 2.9);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vShade; varying vec2 vVl; varying vec3 vVlP;
        ${SKIN_COMMON}`)
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
        ${SKIN_LIGHTS}`)
      // polish-fauna: the reef crab's skin (fauna.js, skin 4) on the vent palette —
      // granular carapace with a darker frontal ridge, pale jointed legs with
      // arthrodial cuffs and dark dactyls, dark-tipped chelae, wet black eyes.
      .replace('#include <color_fragment>', `#include <color_fragment>
        float vlK = floor(vVl.x + 0.5);
        vec3 vp = vVlP;
        vec3 vlC = vec3(1.0);
        float vlH = 0.0;
        if (vlK < 0.5) {
          vec3 vr = skVor(vp.xz * 70.0);
          float gran = 1.0 - smoothstep(0.0, 0.34, vr.x);
          float ridge = 1.0 - smoothstep(0.0, 0.03, abs(vp.x - 0.1 - 0.02 * vp.z * vp.z * 20.0));
          vlC *= (0.92 + 0.16 * vr.z) * (1.0 + gran * 0.08) * (1.0 - 0.25 * ridge);
          vlC *= mix(1.0, 1.25, 1.0 - smoothstep(0.02, 0.05, vp.y));   // pale underside
          vlH = gran * 0.8 + ridge * 0.4;
        } else if (vlK < 1.5) {
          float t = vVl.y;
          float cuff = max(1.0 - smoothstep(0.02, 0.06, abs(t - 0.333)), 1.0 - smoothstep(0.02, 0.06, abs(t - 0.667)));
          vlC = mix(vlC * 0.95, vec3(1.35, 1.3, 1.2), cuff);
          vlC *= 1.0 - 0.6 * smoothstep(0.82, 0.97, t);
          vlH = -cuff * 0.6;
        } else if (vlK < 2.5) {
          vlC *= 1.0 - 0.65 * smoothstep(0.33, 0.38, vp.x);
          vlH = skN2(vp.xz * 160.0) * 0.4;
        } else {
          vlC = vec3(0.02, 0.018, 0.016);
        }
        float vlEye = step(2.5, vlK);
        diffuseColor.rgb *= vShade * vlC;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = skBump(-vViewPosition, normal, vlH * 0.0025, faceDirection);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.06, vlEye);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += skCatch(normal, normalize(vViewPosition), vViewPosition) * vlEye * 0.8;`);
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
