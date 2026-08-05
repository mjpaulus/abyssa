// THE BOILER ROOM — zone 1's hydrothermal vent field. OWNED BY: vents agent.
//
// A cluster of black-smoker chimneys grown on the zone-1 seabed, passed twice on every
// dive. Geology, not a light show: gnarled lathe-turned stone, stained by its own
// mineral runoff, venting slow dark plumes. The only warmth is a dim ember tint deep in
// a handful of active throats and a faint shimmer over the hottest three — never a
// beacon.
//
// Everything solid (chimneys, forked branches, fumarole cones, crust patches) bakes into
// ONE merged MeshStandardMaterial + vertexColors mesh, the diver.js/wrecks.js Part idiom
// copied locally (not imported — raft/kit.js and wrecks.js own their own copies too).
// Plumes and shimmer are GPU-side Points streams keyed off a shared uTime/uVis uniform,
// exactly water.js's buildBubbles pattern: all motion in the vertex shader, the CPU only
// ever writes two floats a frame for them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, camera } from '../core.js';
import { riftPos } from '../config.js';
import { clamp, vnoise } from '../lib/math.js';
import { makeGlow } from '../lib/textures.js';
import { terrainH, terrainNormal } from './terrain.js';
import { siteParams } from './site.js';

const TAU = Math.PI * 2;
const ZI = 1;   // zone 1 only, per brief
const UP = new THREE.Vector3(0, 1, 0);
const IDQ = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Deterministic PRNG — mulberry32, drawn fresh per build from siteParams('vents').rng
// (site.js's own stream() factory, the same mulberry32 body this file used to keep
// inline). Site 0's seed constant is 0xB01Ec0DE — byte-identical to the fixed seed
// this module shipped with — and every draw below happens in the exact order it did
// before this file took a stream instead of owning its own counter, so site 0 grows
// the SHIPPED field. `rnd` is a `let` reassigned per build/reseed, never the counter
// itself, so a reseed can never resume mid-stream from a stale cursor.
// ---------------------------------------------------------------------------
let rnd = null;
const rng = (a, b) => a + rnd() * (b - a);

// ---------------------------------------------------------------------------
// Placement rules (brief, hard constraints).
// ---------------------------------------------------------------------------
const FIELD_R = 240;          // stay inside radius 240 of the world origin
const RIFT1_CLEAR = 45;       // clear of riftPos(1) — the zone's own exit funnel
const RIFT0_CLEAR = 30;       // clear of riftPos(0) — divers descend that line
const SLOPE_MAX_DEG = 35;
const SLOPE_MIN_NY = Math.cos(SLOPE_MAX_DEG * Math.PI / 180);   // 0.8192
const RC1 = riftPos(1), RC0 = riftPos(0);

const N_CLUSTERS = 4;
const PER_CLUSTER = [4, 4, 4, 5];   // 17 chimneys total
const CLUSTER_R = 16;               // chimney scatter radius around each cluster centre

// ------------------------------------------------------------- palette / color --
const C_OLIVE = new THREE.Color(0x4b4a36);   // grows out of zoneMats[1]'s sediment
const C_RUST = new THREE.Color(0x6e3f27);
const C_DARK = new THREE.Color(0x232019);
const C_PALE = new THREE.Color(0xb9ac86);    // sulfide crust near the throat
const C_COLD = new THREE.Color(0x2c2e28);    // dead/collapsed base tone
const C_EMBER = new THREE.Color(0xd8703a);   // dim warmth, vertex colour only — never a light

// ------------------------------------------------------------------- Part/bake --
// Local copy of the merged-geometry idiom (diver.js / wrecks.js / raft/kit.js): bucket
// by material, merge each bucket once. Everything here shares ONE material, so this
// collapses the whole field to a single draw call.
function Part(node) {
  const b = new Map();
  return {
    add(geo, mat) { let a = b.get(mat); if (!a) b.set(mat, a = []); a.push(geo); return geo; },
    bake() {
      for (const [mat, list] of b) {
        for (const g of list) {
          if (!g.attributes.color)
            g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
          if (!g.attributes.uv)
            g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
          if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
        }
        const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list, false) : list[0], mat);
        m.castShadow = false; m.receiveShadow = true;
        node.add(m);
      }
      b.clear();
      return node;
    }
  };
}

const _o = new THREE.Object3D(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.setScalar(1); _o.updateMatrix();
  return geo.applyMatrix4(_o.matrix);
}

function standQuat(n, blend, yaw) {
  _q2.setFromUnitVectors(UP, n);
  if (blend < 1) _q2.slerp(IDQ, 1 - blend);
  return _q2.clone().multiply(_q.setFromAxisAngle(UP, yaw));
}

// ------------------------------------------------------------------- geometry ---
// A gnarled lathe ring: per-vertex radius jitter driven by angle+height noise, so no
// two segments read as a lathe-perfect cylinder.
function segGeo(rTop, rBot, h, sides, jitter, seed) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, sides, 3, false);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const ang = Math.atan2(z, x);
    const n = vnoise(ang * 1.35 + seed, y * 0.5 + seed * 2.3) - 0.5;
    const k = 1 + n * jitter;
    pos.setX(i, x * k); pos.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// Mineral staining, baked to vertex colour: olive sediment at the base, rust streaks
// up the flanks, pale sulfide crust near an active throat, and — only for actively
// venting chimneys, only in the top tenth — a dim ember warmth. This is the "small
// emissive-ish vertex-colour warmth" option from the brief; the 2-3 hottest vents also
// get a real (very faint) glow sprite in the bore, below.
function paintSegment(geo, segH, t0, t1, dead, active) {
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i);
    const lt = clamp(ly / segH + 0.5, 0, 1);
    const gt = t0 + (t1 - t0) * lt;
    const ang = Math.atan2(lz, lx);
    const streak = vnoise(ang * 1.6 + gt * 5.3, gt * 3.1);
    c.copy(C_DARK).lerp(dead ? C_COLD : C_OLIVE, clamp(1 - gt * 2.1, 0, 1));
    c.lerp(C_RUST, clamp((streak - 0.34) * 1.8, 0, 1) * 0.55);
    if (active && gt > 0.70) c.lerp(C_PALE, clamp((gt - 0.70) / 0.30, 0, 1) * 0.6);
    if (active && gt > 0.90) c.lerp(C_EMBER, clamp((gt - 0.90) / 0.10, 0, 1) * 0.22);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function paintFlat(geo, dead) {
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const streak = vnoise(pos.getX(i) * 0.4 + 11, pos.getZ(i) * 0.4 - 7);
    c.copy(dead ? C_COLD : C_OLIVE).lerp(C_RUST, clamp((streak - 0.4) * 1.6, 0, 1) * 0.4);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// A stacked, slightly off-axis lathe: base wide, tapering, each ring nudged by a small
// cumulative lean so the whole thing reads as grown rather than extruded. Returns the
// world-space throat position (top of the stack) for plume/shimmer/ember placement.
function buildChimney(part, mat, baseX, baseY, baseZ, height, dead, forked, active, seed) {
  const segs = dead ? 3 + ((rnd() * 2) | 0) : 5 + ((rnd() * 3) | 0);
  const baseR = dead ? rng(0.9, 1.5) : rng(1.3, 2.4);
  let x = baseX, y = baseY, z = baseZ, tiltX = 0, tiltZ = 0;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const segH = (height / segs) * rng(0.82, 1.24);
    const r0 = Math.max(baseR * (1 - t0 * 0.80) + 0.10, 0.06);
    const r1 = Math.max(baseR * (1 - t1 * 0.80) + 0.08, 0.05);
    const jitter = 0.09 + rnd() * 0.10;
    const g = segGeo(r1, r0, segH, 7, jitter, seed + i * 7.31);
    // Colour while the geometry is still local (Y centred on 0, +-segH/2): xf() below
    // bakes in the world translate + lean, which would otherwise scramble the local
    // height axis paintSegment reads.
    paintSegment(g, segH, t0, t1, dead, active);
    tiltX += rng(-0.10, 0.10) + (dead ? rng(0, 0.16) : 0);
    tiltZ += rng(-0.10, 0.10) + (dead ? rng(-0.08, 0.08) : 0);
    xf(g, x, y + segH / 2, z, tiltX, rng(0, TAU), tiltZ);
    part.add(g, mat);
    x += Math.sin(tiltZ) * segH * 0.5;
    z -= Math.sin(tiltX) * segH * 0.5;
    y += segH * Math.cos((Math.abs(tiltX) + Math.abs(tiltZ)) * 0.5);
  }
  // A shorter secondary stem branching off around mid-height — "some forked".
  if (forked) {
    let fx = baseX + (x - baseX) * 0.55, fy = baseY + (y - baseY) * 0.55, fz = baseZ + (z - baseZ) * 0.55;
    let ftx = tiltX * 0.55 + rng(0.25, 0.5), ftz = tiltZ * 0.55 + rng(-0.35, 0.35);
    const fsegs = 3, fBaseR = baseR * 0.55;
    for (let i = 0; i < fsegs; i++) {
      const t0f = 0.55 + (i / fsegs) * 0.35, t1f = 0.55 + ((i + 1) / fsegs) * 0.35;
      const segH = (height * 0.35 / fsegs) * rng(0.85, 1.2);
      const r0 = Math.max(fBaseR * (1 - (i / fsegs) * 0.7) + 0.08, 0.05);
      const r1 = Math.max(fBaseR * (1 - ((i + 1) / fsegs) * 0.7) + 0.06, 0.04);
      const g = segGeo(r1, r0, segH, 6, 0.10 + rnd() * 0.08, seed + 51 + i * 5.1);
      paintSegment(g, segH, t0f, t1f, false, active);
      ftx += rng(-0.06, 0.06); ftz += rng(-0.06, 0.06);
      xf(g, fx, fy + segH / 2, fz, ftx, rng(0, TAU), ftz);
      part.add(g, mat);
      fx += Math.sin(ftz) * segH * 0.5;
      fz -= Math.sin(ftx) * segH * 0.5;
      fy += segH * 0.94;
    }
  }
  return { x, y, z, baseR };
}

function buildFumarole(part, mat, x, z, zi) {
  const y = terrainH(x, z, zi), n = terrainNormal(x, z, zi);
  const h = rng(0.35, 0.85), r = h * rng(0.5, 0.9);
  const g = new THREE.ConeGeometry(r, h, 6);
  const q = standQuat(n, 0.8, rnd() * TAU);
  _o.position.set(x, y + h * 0.42, z); _o.quaternion.copy(q); _o.scale.setScalar(1); _o.updateMatrix();
  g.applyMatrix4(_o.matrix);
  paintFlat(g, false);
  part.add(g, mat);
}

function buildCrust(part, mat, x, z, zi) {
  const y = terrainH(x, z, zi), n = terrainNormal(x, z, zi);
  const r = rng(1.2, 2.8);
  const g = new THREE.CircleGeometry(r, 8);
  g.rotateX(-Math.PI / 2);
  const q = standQuat(n, 1, rnd() * TAU);
  _o.position.set(x, y + 0.03, z); _o.quaternion.copy(q); _o.scale.setScalar(1); _o.updateMatrix();
  g.applyMatrix4(_o.matrix);
  paintFlat(g, rnd() < 0.5);
  part.add(g, mat);
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
export const ventColliders = [];
let built = false;

const uni = { uTime: { value: 0 }, uVis: { value: 0 }, uFogD: { value: 0.01 } };
let plumePts = null, shimmerPts = null, ventLight = null;
let root = null;          // the merged chimney/fumarole/crust group — disposed+regrown on reseed
let chimneyMat = null;    // the ONE MeshStandardMaterial every solid piece shares — REUSED across reseeds, never recreated (zero recompiles)
export const activeVents = [];   // {x,y,z,baseR} throat positions, non-dead — ventlife.js anchors its swarms here (array keeps identity across reseeds)
const hotVents = [];      // {x,y,z,sprite} the 2-3 hottest — shimmer + ember glow

// ---------------------------------------------------------------------------
export function buildVents() {
  if (built) return;
  built = true;
  rnd = siteParams('vents').rng;
  growField();
}

// Tear down every accumulator this module owns and regrow against the current site +
// current terrain. The chimney material and the shared PointLight are the two things
// that must survive untouched (material: zero recompiles; light: scene light-count is
// fixed for the game's whole life, see the buildVents comment below on ventLight).
export function reseedVents() {
  if (!built) { buildVents(); return; }

  if (root) {
    root.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); // material is chimneyMat — reused, not touched
    scene.remove(root);
    root = null;
  }
  if (plumePts) {
    plumePts.geometry.dispose();
    plumePts.material.dispose();  // cheap ShaderMaterial, no shared textures — safe to recreate
    scene.remove(plumePts);
    plumePts = null;
  }
  if (shimmerPts) {
    shimmerPts.geometry.dispose();
    shimmerPts.material.dispose();
    scene.remove(shimmerPts);
    shimmerPts = null;
  }
  for (const v of hotVents) {
    scene.remove(v.sprite);
    // NEVER dispose v.sprite.material.map: makeGlow() hands out lib/textures.js's
    // module-level shared glowTex, used by every glow sprite in the game. Only the
    // per-sprite SpriteMaterial instance is ours to free.
    v.sprite.material.dispose();
  }
  hotVents.length = 0;
  activeVents.length = 0;
  ventColliders.length = 0;   // in place — player.js/game.js hold this exact array reference

  rnd = siteParams('vents').rng;   // fresh stream per brief: never reuse one across rebuilds
  growField();
}

// The shared placement/plume/shimmer pipeline both buildVents() and reseedVents() run.
// No `built` guard here — callers own that — and it never touches ventLight, which
// lives for the whole game.
function growField() {
  // --- pass 1: cluster centres, deterministic rejection sampling -------------
  const clusters = [];
  for (let ci = 0; ci < N_CLUSTERS; ci++) {
    let found = null;
    for (let tries = 0; tries < 400 && !found; tries++) {
      const a = rnd() * TAU, r = rng(40, 200);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const margin = CLUSTER_R + 6;
      if (Math.hypot(x - RC1.x, z - RC1.z) < RIFT1_CLEAR + margin) continue;
      if (Math.hypot(x - RC0.x, z - RC0.z) < RIFT0_CLEAR + margin) continue;
      if (Math.hypot(x, z) > FIELD_R - margin) continue;
      if (clusters.some(o => Math.hypot(o.x - x, o.z - z) < 55)) continue;
      found = { x, z };
    }
    // Guaranteed to succeed at the shipped seed (verified offline); a null center
    // would just mean one fewer cluster this session, never a rift violation.
    if (found) clusters.push(found);
  }

  // --- pass 2: chimney positions, same rejection rules as the clusters -------
  const chimneys = [];
  for (let ci = 0; ci < clusters.length; ci++) {
    const c = clusters[ci];
    const want = PER_CLUSTER[ci] ?? 4;
    let placed = 0, guard = 0;
    while (placed < want && guard++ < want * 60) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * CLUSTER_R;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (Math.hypot(x - RC1.x, z - RC1.z) < RIFT1_CLEAR) continue;
      if (Math.hypot(x - RC0.x, z - RC0.z) < RIFT0_CLEAR) continue;
      if (Math.hypot(x, z) > FIELD_R) continue;
      const n = terrainNormal(x, z, ZI);
      if (n.y < SLOPE_MIN_NY) continue;
      chimneys.push({ ci, x, y: terrainH(x, z, ZI), z });
      placed++;
    }
  }

  // --- pass 3: per-chimney attributes (height/dead/forked), then rank "hot" --
  const attrs = chimneys.map(() => {
    const dead = rnd() < 0.28;
    const height = dead ? rng(3, 6) : rng(4, 14);
    const forked = !dead && rnd() < 0.30;
    return { dead, height, forked };
  });
  const activeIdx = attrs.map((a, i) => i).filter(i => !attrs[i].dead)
    .sort((i, j) => attrs[j].height - attrs[i].height);
  const hotSet = new Set(activeIdx.slice(0, 3));

  // --- pass 4: build geometry + FX ------------------------------------------
  // chimneyMat is created once, ever, and reused on every reseed — a fresh material
  // instance would recompile every mesh that binds it, and reseedVents()'s whole point
  // is zero recompiles.
  if (!chimneyMat) chimneyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0.02 });
  const mat = chimneyMat;
  root = new THREE.Group();
  const part = Part(root);

  for (let i = 0; i < chimneys.length; i++) {
    const ch = chimneys[i], A = attrs[i];
    const throat = buildChimney(part, mat, ch.x, ch.y, ch.z, A.height, A.dead, A.forked, !A.dead, i * 97.7 + 3.1);
    if (A.height >= 4) ventColliders.push({ x: ch.x, y: ch.y + A.height * 0.5, z: ch.z, r: Math.max(throat.baseR * 0.85, 0.6) });
    if (!A.dead) {
      activeVents.push(throat);
      if (hotSet.has(i)) {
        const sprite = makeGlow(0xff8248, 0.9);
        sprite.material.opacity = 0;
        // fog OFF, same reasoning as the raft's lantern: the per-channel Beer-Lambert
        // chunk kills red in metres at vent-floor murk, so a warm ember arrived on
        // screen TEAL — the one hue this zone must never glow. Its own 25-unit
        // quadratic distance gate already does the fade honestly.
        sprite.material.fog = false;
        // ABOVE the rim, not inside the bore: recessed 0.4 down, the chimney's own lip
        // depth-tested the glow away the moment you stood close enough to care — the
        // fire was visible at 40 units and gone at 10. Licking just clear of the mouth
        // it reads from every side, which is also just what a vent flame does.
        sprite.position.set(throat.x, throat.y + 0.35, throat.z);
        scene.add(sprite);
        hotVents.push({ x: throat.x, y: throat.y, z: throat.z, sprite });
      }
    }
  }

  // Vent mouths: fumarole cones + cracked crust so the chimneys don't stand on clean sand.
  for (const c of clusters) {
    const nCones = 3 + ((rnd() * 2) | 0), nCrust = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < nCones; i++) {
      const a = rnd() * TAU, r = rng(3, 15);
      buildFumarole(part, mat, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, ZI);
    }
    for (let i = 0; i < nCrust; i++) {
      const a = rnd() * TAU, r = rng(2, 15);
      buildCrust(part, mat, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, ZI);
    }
  }

  part.bake();
  scene.add(root);

  // ONE shared throat light, never three: three.js recompiles every lit material in
  // the scene when the LIGHT COUNT changes, so per-vent lights toggled by zone would
  // hitch the whole game mid-dive. This one is always in the scene (count constant)
  // and rides whichever hot vent is nearest the camera; the vents are ~100+ units
  // apart, so no frame can ever see two lit throats missing their light. It is what
  // makes the ember read as FIRE INSIDE ROCK — warm light on the chimney's own flank
  // and the seabed at its foot — instead of a sticker floating on the bore.
  // Created once and NEVER touched again by a reseed: removing/re-adding it would
  // change the scene's light count for a frame, which recompiles every lit material
  // in the game — exactly what this module exists to avoid.
  if (!ventLight) { ventLight = new THREE.PointLight(0xff7a3c, 0, 13, 2.0); scene.add(ventLight); }

  buildPlumes();
  buildShimmer();
}

// ---------------------------------------------------------------------------
// Plumes: dark, slow-rising smoke off every active chimney. One shared Points
// stream, cycle-recycled entirely in the vertex shader (water.js buildBubbles
// idiom) — the CPU touches nothing here after this build call.
// ---------------------------------------------------------------------------
const PLUME_PER_VENT = 26;

function buildPlumes() {
  if (!activeVents.length) return;
  const N = activeVents.length * PLUME_PER_VENT;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), par = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const v = activeVents[i % activeVents.length];
    pos[i * 3] = v.x + rng(-0.5, 0.5);
    pos[i * 3 + 1] = v.y + rng(0, 0.4);
    pos[i * 3 + 2] = v.z + rng(-0.5, 0.5);
    par[i * 4] = Math.random();          // phase
    par[i * 4 + 1] = rng(0.55, 1.15);    // cycle-rate variance
    par[i * 4 + 2] = rng(0.55, 1.15);    // size variance
    par[i * 4 + 3] = rng(0, TAU);        // wobble seed
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(par, 4));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uTime: uni.uTime, uVis: uni.uVis, uColor: { value: new THREE.Color(0x231e19) }
    }),
    vertexShader: `
      uniform float uTime, uVis;
      attribute vec4 aParam;
      varying float vA;
      #include <fog_pars_vertex>
      void main(){
        float k = fract(aParam.x + uTime * aParam.y * 0.045);
        float h = k * (2.0 - k);
        vec3 p = position;
        p.y += h * 20.0;
        float wob = (0.5 + h * 2.4) * aParam.y;
        p.x += sin(uTime * 0.42 + aParam.w + h * 5.4) * wob;
        p.z += cos(uTime * 0.35 + aParam.w * 1.6 + h * 4.7) * wob;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float dist = -mvPosition.z;
        gl_PointSize = clamp(aParam.z * (9.0 + h * 32.0) / max(dist, 0.6), 2.0, 90.0);
        vA = smoothstep(0.0, 0.10, k) * (1.0 - smoothstep(0.72, 1.0, k)) * uVis;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vA;
      #include <fog_pars_fragment>
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = dot(q, q);
        if (d > 0.25) discard;
        float a = exp(-d * 6.0) * vA * 0.55;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uColor, a);
        #include <fog_fragment>
      }`
  });
  plumePts = new THREE.Points(g, mat);
  plumePts.frustumCulled = false;
  plumePts.visible = false;
  scene.add(plumePts);
}

// ---------------------------------------------------------------------------
// Shimmer: sparse, faint refractive-looking sprites over the 2-3 hottest vents.
// Additive but deliberately dim (creatures.js sparks idiom) and manually faded by
// scene.fog.density — additive materials must fade to black with range, never
// toward the fog colour, or they read as neon at distance.
// ---------------------------------------------------------------------------
const SHIMMER_PER_VENT = 24;

function buildShimmer() {
  if (!hotVents.length) return;
  const N = hotVents.length * SHIMMER_PER_VENT;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), par = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const v = hotVents[i % hotVents.length];
    pos[i * 3] = v.x + rng(-0.25, 0.25);
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z + rng(-0.25, 0.25);
    par[i * 4] = Math.random();
    par[i * 4 + 1] = rng(0.7, 1.3);
    par[i * 4 + 2] = rng(0.5, 1.0);
    par[i * 4 + 3] = rng(0, TAU);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(par, 4));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: uni.uTime, uVis: uni.uVis, uFogD: uni.uFogD, uColor: { value: new THREE.Color(0xbfe0ea) } },
    vertexShader: `
      uniform float uTime, uVis, uFogD;
      attribute vec4 aParam;
      varying float vA;
      float fogVis(vec3 wp){ float d = length(wp - cameraPosition); return exp(-uFogD*uFogD*d*d); }
      void main(){
        float k = fract(aParam.x + uTime * aParam.y * 0.14);
        vec3 p = position;
        p.y += k * 22.0;
        float wob = 0.15 + k * 0.5;
        p.x += sin(uTime * 1.3 + aParam.w + k * 8.0) * wob;
        p.z += cos(uTime * 1.1 + aParam.w * 1.3 + k * 7.0) * wob;
        vec4 wp4 = modelMatrix * vec4(p, 1.0);
        vec4 mvPosition = viewMatrix * wp4;
        float dist = -mvPosition.z;
        gl_PointSize = clamp(aParam.z * 60.0 / max(dist, 0.6), 1.0, 14.0);
        vA = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.65, 1.0, k)) * uVis * fogVis(wp4.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vA;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = dot(q, q);
        if (d > 0.25) discard;
        float a = exp(-d * 9.0) * vA * 0.10;
        if (a <= 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }`
  });
  shimmerPts = new THREE.Points(g, mat);
  shimmerPts.frustumCulled = false;
  shimmerPts.visible = false;
  scene.add(shimmerPts);
}

// ---------------------------------------------------------------------------
// frame: two shared floats (uTime, uVis) plus a per-hot-vent distance test (at
// most 3 sqrts). No allocation — every temp below is a bare number.
// ---------------------------------------------------------------------------
const FADE_IN0 = -280, FADE_IN1 = -350, FADE_OUT0 = -570, FADE_OUT1 = -620;

export function updateVents(dt, t) {
  if (!built) return;
  uni.uTime.value = t;
  if (scene.fog) uni.uFogD.value = scene.fog.density;

  const camY = camera.position.y;
  const inK = clamp((FADE_IN0 - camY) / (FADE_IN0 - FADE_IN1), 0, 1);
  const outK = clamp((camY - FADE_OUT1) / (FADE_OUT0 - FADE_OUT1), 0, 1);
  const vis = Math.min(inK, outK);
  uni.uVis.value = vis;

  const awake = camY < FADE_IN0 && camY > FADE_OUT1;
  if (plumePts) plumePts.visible = awake;
  if (shimmerPts) shimmerPts.visible = awake;

  let bestD = 1e9, best = -1;
  for (let i = 0; i < hotVents.length; i++) {
    const v = hotVents[i];
    const dx = camera.position.x - v.x, dy = camera.position.y - v.y, dz = camera.position.z - v.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < bestD) { bestD = dist; best = i; }
    // Two ranges, one ember. Out to ~90 units it is a faint warm point in the murk —
    // zone 1's only wayfinding, the way the raft lamp is the surface's — and inside
    // 25 it swells into the fire in the bore. Measured before this: at 12 units from
    // a chimney the frame was EMPTY; unlit rock in vent-floor murk is invisible, so
    // a 25-unit gate meant the field could only be discovered by collision.
    const far = clamp(1 - dist / 90, 0, 1);
    const near = clamp(1 - dist / 25, 0, 1);
    // far is LINEAR, not squared: squared put a 50-unit ember at alpha 0.03, which is
    // below the film grain's own noise floor — measured invisible. 0.10-0.12 at that
    // range is a presence the eye finds without the frame ever calling attention to it.
    v.sprite.material.opacity = (far * 0.22 + near * near * 0.30) * vis
      * (0.85 + 0.15 * Math.sin(t * 1.7 + i * 2.1));
    // A light in murk grows a scattering halo with range — that is what fog does to a
    // lamp — so the sprite swells as the fire itself shrinks below resolvability. At
    // 0.9 fixed it was two invisible pixels from 45 units out.
    v.sprite.scale.setScalar(0.9 + dist * 0.075);
  }
  // The shared light follows the nearest hot throat. Slow uneven flicker — a vent
  // breathes, it does not strobe — and the same 25-unit approach curve as the sprite,
  // so light and glow arrive together.
  if (ventLight && best >= 0) {
    const v = hotVents[best];
    ventLight.position.set(v.x, v.y + 0.3, v.z);
    // Linear over 34 units, not squared over 25: the camera trails the diver by ~10,
    // so the squared curve had the throat at 6% intensity while Sal stood right beside
    // it. The light should arrive with the man, not with the lens.
    const near = clamp(1 - bestD / 34, 0, 1);
    ventLight.intensity = 6.5 * near * vis *
      (0.80 + 0.14 * Math.sin(t * 1.7 + best * 2.1) + 0.06 * Math.sin(t * 5.3));
  }
}
