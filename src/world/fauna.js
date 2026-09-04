// ABYSSA — fauna.js
// OWNED BY: fauna agent (contract fixed by orchestrator; see game.js wiring)
//
// The second population: named animals with mouths, wings, legs and eyes, grown
// from a small geometry VOCABULARY and animated by ONE vertex shader that keys its
// motion off a per-vertex part id. creatures.js keeps the schools/jellies/sparks;
// predators.js keeps the shark/octopus/squid. This module adds the rest of the
// sea — the indifferent giant over the reef, the turtle, the eel in its crevice,
// the crabs and stars underfoot, the blind fish of the boiler room, the flapjack,
// the isopods on the crust, and the lantern-bearers of the abyss.
//
// Contract:
//   buildFauna()       — one-time build. Materials/geometry created ONCE, ever.
//   reseedFauna()      — re-lay every animal for the current site IN PLACE. Pure
//                        function of siteParams('fauna').rng (a NEW stream — the
//                        creatures/predators streams are untouched, so their layouts
//                        are bit-identical with or without this module). Must run
//                        AFTER reseedFlora (moray crevices + crab rocks come from
//                        rockColliders) and AFTER reseedVents (isopods + vent fish
//                        anchor on activeVents). Wired after reseedCreatures.
//   updateFauna(dt, t) — per-frame, zero allocation. A fixed 30 Hz steering step
//                        with interpolation; only the camera's zone band is stepped.
//   hideFauna()        — the ending: everything invisible until the next reseed.
//   faunaNearby()      — names of animals within 25u of the diver (reused array).
//
// VOCABULARY (build time, all merged per animal, vertex colours):
//   loft(profile)   Catmull-Rom cross-section profile with skin noise — bodies,
//                   shells, mantles.
//   blade(outline)  fin surface with a bulge — wings, fins, ear-flaps, tails.
//   limb(points)    tapered tube along Frenet frames — flippers, legs, arms, lure.
//   web(surface)    parametric skirt — the flapjack's umbrella.
//   gape(...)       a real mouth: cavity loft + lip ring + teeth, the lower half
//                   tagged as the JAW part so the shader opens it on a hinge.
//   eyes / photophores — beads; photophores carry aGlow.
//
// ONE VERTEX SHADER animates by part id (aPart):
//   0 body  1 tail  2 wave-wing  3 leg  4 jaw  5 lure  6 umbrella  7 rigid flipper
// Per-instance aInst = (stroke phase, effort, gape 0..1, glow k). Per-material
// uMot/uHinge/uBody tune amplitudes. Every material shares the SAME shader source
// and the same customProgramCacheKey, so the whole module is ONE program.
//
// Display law: matte lit MeshStandardMaterial, fog ON. Range fade is an alpha-hash
// DITHER off the same fog-density cull formula creatures.js uses (no blending, no
// sorting). The only light these animals emit — the angler's lure, the lantern-
// fish's ventral rows — is a dim emissive term multiplied by fogVis, so it fades
// to BLACK with range, never toward the fog colour. No lights are added, ever.
//
// Budget (measured at build, window.__fauna.stats): 12 draw calls across all
// zones (6 / 3 / 3); 65.4k / 31.8k / 45.7k tris per zone, ~97k worst case where
// the zone 0 and zone 1 bands overlap, 0 B/frame. At the reef: +6 draw calls,
// +65,436 tris per frame against main (measured with window.__noFauna).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, camera } from '../core.js';
import { WORLD_R, zoneTop, zoneBottom } from '../config.js';
import { clamp } from '../lib/math.js';
import { terrainH } from './terrain.js';
import { rockColliders } from './flora.js';
import { activeVents } from './vents.js';
import { siteParams, stream } from './site.js';
import { player } from '../player.js';

const TAU = Math.PI * 2;

// Layout stream: installed fresh from siteParams('fauna') by build and reseed.
let _fr = Math.random;
const rr = (a, b) => a + _fr() * (b - a);
// Geometry is built once and never reseeded, so it draws from its own fixed stream —
// otherwise the first build's layout would differ from an arrive() back to the site.
const GEO = stream(0xFA0BA5E1);
const gr = (a, b) => a + GEO() * (b - a);

// Shared uniforms — written once per frame.
const uTime = { value: 0 };
const uFogD = { value: 0.016 };
const uCull = { value: 205 };
const CULL_MAX = 420;

// Fixed-step steering.
const STEP = 1 / 30;
let acc = 0;

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------
const _c = new THREE.Color();

// Assemble a BufferGeometry with the full fauna attribute set. `part` may be a
// number or a function (x, y, z) -> part id, so a helper can split itself across
// parts (the gape's lower jaw, a leg's foot).
function finish(pos, idx, uv, color, part, phase, glow, noise) {
  const n = pos.length / 3;
  const col = new Float32Array(n * 3), pa = new Float32Array(n), ph = new Float32Array(n), gl = new Float32Array(n);
  const base = _c.set(color);
  const r0 = base.r, g0 = base.g, b0 = base.b;
  for (let i = 0; i < n; i++) {
    const k = 1 + (gr(-1, 1)) * noise;
    col[i * 3] = r0 * k; col[i * 3 + 1] = g0 * k; col[i * 3 + 2] = b0 * k;
    pa[i] = typeof part === 'function' ? part(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) : part;
    ph[i] = phase;
    gl[i] = glow;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(pa, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function grid(rows, sides, closedSides, at) {
  const pos = [], uv = [], idx = [];
  const cols = closedSides ? sides : sides + 1;
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) {
    const p = at(j / rows, i / sides);
    pos.push(p[0], p[1], p[2]); uv.push(i / sides, j / rows);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < sides; i++) {
    const a = j * cols + i, b = j * cols + (i + 1) % cols;
    idx.push(a, a + cols, b, b, a + cols, b + cols);
  }
  return { pos, uv, idx };
}

// Body along +X: profile rows are [x, ry, rz, cy]. Catmull-Rom between rows; a
// soft two-frequency ripple on the radius is the skin.
function loft(profile, color, o = {}) {
  const rows = o.rows || 24, sides = o.sides || 12, skin = o.skin === undefined ? 0.012 : o.skin;
  const P = profile, N = P.length;
  const cat = (i, t, k) => {
    const a = P[Math.max(0, i - 1)][k] || 0, b = P[i][k] || 0, c = P[Math.min(i + 1, N - 1)][k] || 0, d = P[Math.min(i + 2, N - 1)][k] || 0;
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  };
  const g = grid(rows, sides, true, (u, v) => {
    const f = u * (N - 1), i = Math.min(N - 2, Math.floor(f)), t = f - i;
    const x = cat(i, t, 0), ry = Math.max(0.002, cat(i, t, 1)), rz = Math.max(0.002, cat(i, t, 2)), cy = cat(i, t, 3);
    const a = v * TAU, soft = 1 + Math.sin(x * 8.2 + a * 3) * Math.sin(a * 5 + x * 3.7) * skin;
    return [x, cy + Math.cos(a) * ry * soft, Math.sin(a) * rz * soft];
  });
  return finish(g.pos, g.idx, g.uv, color, o.part || 0, o.phase || 0, o.glow || 0, o.noise === undefined ? 0.06 : o.noise);
}

// Fin/wing surface from a closed outline: rings from the centroid out to the edge,
// bulged along the outline's normal so a fin has thickness in its shading.
function blade(points, color, o = {}) {
  const outline = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(outline, true, 'centripetal');
  const center = new THREE.Vector3();
  for (const p of outline) center.add(p);
  center.multiplyScalar(1 / outline.length);
  const nrm = new THREE.Vector3().crossVectors(
    outline[1].clone().sub(outline[0]), outline[outline.length - 1].clone().sub(outline[0])).normalize();
  let span = 0;
  for (const p of outline) span = Math.max(span, p.distanceTo(center));
  const rows = o.rows || 4, sides = o.sides || Math.max(18, points.length * 6), bulge = o.bulge === undefined ? 0.045 : o.bulge;
  const tmp = new THREE.Vector3();
  const g = grid(rows, sides, true, (t, u) => {
    const e = curve.getPoint(u);
    tmp.copy(center).lerp(e, t).addScaledVector(nrm, Math.sin(t * Math.PI) * span * bulge);
    return [tmp.x, tmp.y, tmp.z];
  });
  return finish(g.pos, g.idx, g.uv, color, o.part === undefined ? 2 : o.part, o.phase || 0, o.glow || 0, o.noise === undefined ? 0.05 : o.noise);
}

// Tapered tube along a Catmull-Rom spine using its Frenet frames.
function limb(points, radius, color, o = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
  const rows = o.rows || 10, sides = o.sides || 6, tip = o.tip === undefined ? 0.12 : o.tip, rootTaper = o.root === undefined ? 1 : o.root;
  const fr = curve.computeFrenetFrames(rows, false);
  const tmp = new THREE.Vector3();
  const g = grid(rows, sides, true, (t, v) => {
    const i = Math.round(t * rows);
    const c = curve.getPointAt(t);
    const r = radius * (tip + (1 - tip) * Math.pow(1 - t, 0.7)) * (rootTaper + (1 - rootTaper) * Math.sin(t * Math.PI));
    const a = v * TAU;
    tmp.copy(c).addScaledVector(fr.normals[i], Math.cos(a) * r).addScaledVector(fr.binormals[i], Math.sin(a) * r);
    return [tmp.x, tmp.y, tmp.z];
  });
  return finish(g.pos, g.idx, g.uv, color, o.part === undefined ? 3 : o.part, o.phase || 0, o.glow || 0, o.noise === undefined ? 0.05 : o.noise);
}

// Parametric skirt: surface(angle, t) -> [x, y, z].
function web(surface, color, o = {}) {
  const g = grid(o.rows || 6, o.sides || 32, true, (t, u) => surface(u * TAU, t));
  return finish(g.pos, g.idx, g.uv, color, o.part === undefined ? 6 : o.part, o.phase || 0, o.glow || 0, o.noise === undefined ? 0.05 : o.noise);
}

// Ellipsoid bead.
function ell(pos, scale, color, o = {}) {
  const d = o.detail || 8;
  const s = new THREE.SphereGeometry(1, d, Math.max(4, Math.round(d * 0.65)));
  s.scale(scale[0], scale[1], scale[2]);
  s.translate(pos[0], pos[1], pos[2]);
  const g = finish(Array.from(s.attributes.position.array), Array.from(s.index.array), Array.from(s.attributes.uv.array),
    color, o.part || 0, o.phase || 0, o.glow || 0, o.noise === undefined ? 0.04 : o.noise);
  s.dispose();
  return g;
}

function eyes(parts, x, y, z, r, o = {}) {
  for (const s of [-1, 1]) {
    parts.push(ell([x, y, z * s], [r, r * 0.95, r * 0.5], o.rim || 0x4a4132, { detail: 8, part: o.part || 0 }));
    parts.push(ell([x + r * 0.1, y, z * s + s * r * 0.3], [r * 0.7, r * 0.72, r * 0.35], 0x07090a, { detail: 7, part: o.part || 0, noise: 0 }));
  }
}

// Paired running lights along the flank/belly. Dim beads with aGlow = 1; the
// fragment shader adds the material's glow colour scaled by aInst.w and fogVis.
function photophores(parts, count, x0, x1, y, z, r, color) {
  for (let i = 0; i < count; i++) for (const s of [-1, 1]) {
    const x = x0 + (x1 - x0) * (count > 1 ? i / (count - 1) : 0.5);
    parts.push(ell([x, y, z * s], [r, r, r * 0.7], color, { detail: 5, glow: 1, noise: 0 }));
  }
}

// A mouth. Cavity (dark loft, back to front), lip ring, teeth. Everything below
// the hinge line (y < hy) is the JAW (part 4); the hinge sits at the cavity's back.
function gape(parts, x, y, ry, rz, depth, color, teeth, hy = y) {
  const jaw = (px, py) => (py < hy ? 4 : 0);
  parts.push(loft([[x - depth, 0.02, 0.02, y], [x - depth * 0.75, ry * 0.35, rz * 0.4, y], [x - depth * 0.3, ry * 0.78, rz * 0.83, y], [x, ry, rz, y]],
    0x0b0908, { rows: 6, sides: 10, part: jaw, skin: 0, noise: 0.02 }));
  const lip = [];
  for (let i = 0; i < 25; i++) { const a = i / 24 * TAU; lip.push([x + 0.008 * Math.sin(a * 5), y + Math.cos(a) * ry, Math.sin(a) * rz]); }
  parts.push(limb(lip, ry * 0.11, color, { rows: 24, sides: 5, tip: 1, part: jaw }));
  for (let i = 0; i < teeth; i++) {
    const a = (i + 0.1 + gr(0, 0.35)) / teeth * TAU, cy = Math.cos(a), sz = Math.sin(a), len = 0.22 + gr(0, 0.27);
    parts.push(limb([[x + 0.012, y + cy * ry, sz * rz], [x + 0.07, y + cy * ry * (1 - len * 0.5), sz * rz * (1 - len * 0.35)], [x + 0.10, y + cy * ry * (1 - len), sz * rz * (1 - len * 0.7)]],
      ry * 0.035 + gr(0, 0.01), 0xc5bca7, { rows: 3, sides: 4, tip: 0.05, part: jaw, noise: 0.02 }));
  }
}

function merge(parts, scale) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (scale) g.scale(scale, scale, scale);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// the animals — authored around the origin, +X forward, +Y up, Z lateral
// ---------------------------------------------------------------------------
function rayGeometry() {
  const P = [];
  const back = 0x3a4441, belly = 0xb3ad9a;
  // disc body: flat, wide, tapering to a tail root
  P.push(loft([[-1.0, 0.04, 0.10, 0], [-0.55, 0.16, 0.42, 0.02], [-0.1, 0.24, 0.62, 0.03], [0.4, 0.22, 0.60, 0.02], [0.85, 0.12, 0.40, 0], [1.1, 0.03, 0.14, -0.03]], back, { rows: 20, sides: 14 }));
  // wings: two blades, the travelling wave lives in the shader off |z|
  for (const s of [-1, 1]) P.push(blade([[0.9, 0.02, s * 0.30], [0.45, 0.0, s * 1.9], [-0.35, -0.02, s * 2.35], [-0.85, -0.02, s * 1.1], [-0.7, 0.0, s * 0.35]], back, { rows: 6, sides: 40, bulge: 0.02 }));
  // cephalic lobes
  for (const s of [-1, 1]) P.push(limb([[1.0, -0.02, s * 0.28], [1.25, -0.05, s * 0.34], [1.45, -0.1, s * 0.36]], 0.07, back, { rows: 5, sides: 5, tip: 0.3, part: 0 }));
  // tail whip
  P.push(limb([[-1.0, 0.0, 0], [-1.9, 0.02, 0], [-2.9, 0.06, 0], [-3.6, 0.1, 0]], 0.06, back, { rows: 10, sides: 5, tip: 0.1, part: 1 }));
  // pale belly plate under the disc
  P.push(loft([[-0.8, 0.02, 0.10, -0.03], [-0.3, 0.06, 0.52, -0.16], [0.35, 0.06, 0.52, -0.15], [0.9, 0.02, 0.22, -0.06]], belly, { rows: 8, sides: 10, skin: 0.004 }));
  eyes(P, 0.95, 0.12, 0.30, 0.06);
  return merge(P, 3.1);
}

function turtleGeometry() {
  const P = [];
  const shell = 0x5c5a3a, skin = 0x7c7856, plastron = 0xa39c78;
  P.push(loft([[-0.95, 0.02, 0.1, 0.1], [-0.6, 0.28, 0.62, 0.15], [-0.1, 0.42, 0.78, 0.16], [0.45, 0.36, 0.7, 0.15], [0.85, 0.16, 0.42, 0.1], [1.0, 0.02, 0.1, 0.08]], shell, { rows: 18, sides: 14, skin: 0.035 }));
  P.push(loft([[-0.8, 0.02, 0.08, -0.05], [-0.4, 0.10, 0.52, -0.14], [0.3, 0.10, 0.55, -0.14], [0.8, 0.03, 0.2, -0.07]], plastron, { rows: 6, sides: 10, skin: 0 }));
  // head + neck
  P.push(loft([[0.85, 0.08, 0.10, 0.06], [1.15, 0.13, 0.15, 0.08], [1.45, 0.14, 0.16, 0.1], [1.7, 0.08, 0.1, 0.06], [1.8, 0.02, 0.02, 0.04]], skin, { rows: 10, sides: 8 }));
  eyes(P, 1.5, 0.18, 0.15, 0.045);
  // flippers: part 7 (rigid stroke about the root), fore pair phase 0, hind pair pi
  for (const s of [-1, 1]) {
    P.push(blade([[0.55, 0.02, s * 0.6], [0.35, -0.02, s * 1.35], [-0.15, -0.06, s * 1.85], [-0.4, -0.02, s * 1.2], [-0.05, 0.02, s * 0.62]], skin, { rows: 4, sides: 26, bulge: 0.03, part: 7, phase: 0 }));
    P.push(blade([[-0.55, 0.02, s * 0.5], [-0.75, -0.02, s * 0.95], [-1.15, -0.03, s * 1.05], [-1.05, 0.02, s * 0.5]], skin, { rows: 3, sides: 20, bulge: 0.03, part: 7, phase: Math.PI }));
  }
  return merge(P, 1.35);
}

function morayGeometry() {
  const P = [];
  const c = 0x6b6a4c;
  // head forward, body running back into the rock (x < 0). Head widens, mouth at x=1.
  P.push(loft([[-3.2, 0.10, 0.09, 0], [-2.2, 0.16, 0.14, 0.02], [-1.2, 0.2, 0.17, 0.04], [-0.3, 0.24, 0.2, 0.05], [0.35, 0.26, 0.23, 0.05], [0.8, 0.22, 0.2, 0.03], [1.0, 0.16, 0.16, 0.0], [1.06, 0.02, 0.02, -0.02]], c, { rows: 34, sides: 12 }));
  // dorsal ribbon fin
  P.push(blade([[-3.1, 0.1, 0], [-2.2, 0.32, 0], [-1.0, 0.4, 0], [0.2, 0.36, 0], [0.5, 0.26, 0], [-1.2, 0.2, 0]], c, { rows: 3, sides: 30, bulge: 0.01, part: 0 }));
  gape(P, 1.0, -0.02, 0.15, 0.15, 0.55, c, 14, -0.02);
  eyes(P, 0.62, 0.16, 0.19, 0.045);
  return merge(P, 1.0);
}

function crabGeometry() {
  const P = [];
  const c = 0x8a6a4a, claw = 0x9a7a58;
  P.push(loft([[-0.55, 0.02, 0.4, 0.3], [-0.3, 0.16, 0.66, 0.34], [0.1, 0.2, 0.7, 0.36], [0.45, 0.14, 0.58, 0.34], [0.62, 0.02, 0.3, 0.3]], c, { rows: 8, sides: 12, skin: 0.03 }));
  for (const s of [-1, 1]) {
    // claw arm + pincer
    P.push(limb([[0.4, 0.3, s * 0.45], [0.85, 0.42, s * 0.75], [1.15, 0.36, s * 0.7]], 0.09, claw, { rows: 5, sides: 5, tip: 0.6, part: 3, phase: s * 1.3 }));
    P.push(ell([1.2, 0.36, s * 0.68], [0.22, 0.13, 0.17], claw, { detail: 7, part: 3, phase: s * 1.3 }));
    P.push(limb([[1.3, 0.4, s * 0.62], [1.5, 0.42, s * 0.56], [1.58, 0.38, s * 0.66]], 0.05, claw, { rows: 3, sides: 4, part: 3, phase: s * 1.3 }));
    // four walking legs a side, alternating phase
    for (let i = 0; i < 4; i++) {
      const x = (i / 3 - 0.5) * 0.9, z = 0.5;
      P.push(limb([[x, 0.3, s * z], [x - 0.12, 0.55, s * (z + 0.4)], [x - 0.2, 0.06, s * (z + 0.78)]], 0.055, c, { rows: 6, sides: 5, tip: 0.2, part: 3, phase: (i % 2) * Math.PI + s * 0.5 }));
    }
  }
  eyes(P, 0.58, 0.42, 0.22, 0.05);
  return merge(P, 0.55);
}

function starGeometry() {
  const P = [];
  const c = 0x9a6248;
  P.push(ell([0, 0.12, 0], [0.36, 0.14, 0.36], c, { detail: 10 }));
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU, cx = Math.cos(a), sz = Math.sin(a);
    P.push(limb([[cx * 0.05, 0.12, sz * 0.05], [cx * 0.5, 0.15, sz * 0.5], [cx * 1.0, 0.07, sz * 1.0]], 0.22, c, { rows: 6, sides: 6, tip: 0.1, part: 0 }));
  }
  return merge(P, 0.7);
}

function urchinGeometry() {
  const P = [];
  P.push(ell([0, 0.3, 0], [0.38, 0.3, 0.38], 0x3d3a4a, { detail: 10 }));
  for (let i = 0; i < 44; i++) {
    const y = i / 43 * 1.3 - 0.3, a = i * 2.399963, r = Math.sqrt(Math.max(0, 1 - y * y));
    const d = [Math.cos(a) * r, y, Math.sin(a) * r], len = 0.35 + gr(0, 0.28);
    P.push(limb([[d[0] * 0.34, 0.3 + d[1] * 0.27, d[2] * 0.34], [d[0] * (0.34 + len), 0.3 + d[1] * (0.27 + len), d[2] * (0.34 + len)]],
      0.03, i % 3 ? 0x6b6478 : 0x9a8f96, { rows: 1, sides: 3, tip: 0.02, part: 0, noise: 0.03 }));
  }
  return merge(P, 0.75);
}

// Zone 1 — pale, eyeless. The body is the whole animal.
function ventfishGeometry() {
  const P = [];
  const c = 0xc9c2b0;
  P.push(loft([[-1.0, 0.03, 0.03, 0], [-0.7, 0.12, 0.10, 0.01], [-0.2, 0.24, 0.18, 0.02], [0.3, 0.26, 0.2, 0.02], [0.75, 0.18, 0.15, 0.0], [1.0, 0.04, 0.04, -0.02]], c, { rows: 12, sides: 8 }));
  P.push(blade([[-0.95, 0, 0], [-1.35, 0.36, 0], [-1.2, 0, 0], [-1.35, -0.34, 0]], c, { rows: 3, sides: 16, bulge: 0.02, part: 1 }));
  P.push(blade([[-0.5, 0.22, 0], [-0.1, 0.44, 0], [0.35, 0.26, 0]], c, { rows: 2, sides: 12, bulge: 0.02, part: 0 }));
  for (const s of [-1, 1]) P.push(blade([[0.35, -0.04, s * 0.18], [0.0, -0.18, s * 0.5], [-0.15, -0.06, s * 0.2]], c, { rows: 2, sides: 12, bulge: 0.02, part: 2, phase: s }));
  return merge(P, 0.62);
}

// Zone 1 — the flapjack: a low mantle over an umbrella of webbed arms and a pair
// of ear-fins. Distinct from the predator octopus on purpose: no reach, no den.
function flapjackGeometry() {
  const P = [];
  const c = 0x8f5a44, webc = 0x9a6650;
  P.push(loft([[-0.66, 0.03, 0.04, 0.26], [-0.5, 0.21, 0.38, 0.3], [-0.24, 0.31, 0.58, 0.33], [0.06, 0.29, 0.59, 0.32], [0.31, 0.22, 0.49, 0.29], [0.49, 0.13, 0.3, 0.25], [0.57, 0.03, 0.04, 0.2]], c, { rows: 12, sides: 14, skin: 0.02 }));
  eyes(P, 0.34, 0.36, 0.44, 0.09, { rim: 0x6a4a34 });
  P.push(web((a, t) => { const r = 0.24 + t * (0.74 + Math.cos(a * 8) * 0.09); return [Math.cos(a) * r, 0.2 * (1 - t) * (1 - t) + 0.07 + Math.cos(a * 8) * t * 0.014, Math.sin(a) * r]; }, webc, { rows: 6, sides: 40 }));
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU, reach = 1.1;
    const tip = [Math.cos(a) * reach, 0.05, Math.sin(a) * reach];
    P.push(limb([[Math.cos(a) * 0.29, 0.19, Math.sin(a) * 0.29], [Math.cos(a + 0.025) * reach * 0.59, 0.1, Math.sin(a + 0.025) * reach * 0.59], tip, [tip[0] * 1.015, 0.073, tip[2] * 1.015]],
      0.062, c, { rows: 8, sides: 5, tip: 0.1, part: 6, phase: a }));
  }
  for (const s of [-1, 1]) P.push(blade([[-0.35, 0.46, s * 0.34], [-0.52, 0.57, s * 0.62], [-0.49, 0.68, s * 0.83], [-0.25, 0.7, s * 0.91], [-0.08, 0.61, s * 0.71], [-0.06, 0.43, s * 0.42]], 0xa06a52, { rows: 3, sides: 24, bulge: 0.03, part: 2, phase: s }));
  return merge(P, 1.1);
}

function isopodGeometry() {
  const P = [];
  const c = 0xa9a596, plate = 0x969589;
  P.push(loft([[-1.04, 0.05, 0.1, 0.24], [-0.78, 0.21, 0.39, 0.26], [-0.23, 0.27, 0.49, 0.27], [0.38, 0.25, 0.48, 0.27], [0.88, 0.15, 0.35, 0.29], [1.15, 0.035, 0.1, 0.31]], c, { rows: 12, sides: 12, skin: 0.02 }));
  for (let i = 0; i < 7; i++) {
    const x = -0.84 + i * 0.27, rad = 0.42 + Math.sin(i / 6 * Math.PI) * 0.12;
    P.push(ell([x, 0.43, 0], [0.2, 0.12, rad], i % 2 ? c : plate, { detail: 8, noise: 0.03 }));
  }
  P.push(ell([1.03, 0.35, 0], [0.29, 0.24, 0.39], c, { detail: 9 }));
  eyes(P, 1.1, 0.46, 0.34, 0.06, { rim: 0x3a3a34 });
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) {
    const x = (i / 6 - 0.5) * 1.6, z = 0.42;
    P.push(limb([[x, 0.27, s * z], [x - 0.18, 0.21, s * (z + 0.18)], [x - 0.32, 0.035, s * (z + 0.38)]], 0.034, c, { rows: 4, sides: 4, tip: 0.2, part: 3, phase: i * Math.PI * 0.8 + s }));
  }
  for (const s of [-1, 1]) P.push(limb([[1.1, 0.43, s * 0.19], [1.64, 0.5, s * 0.32], [2.0, 0.28, s * 0.64]], 0.022, 0xc8c8b0, { rows: 4, sides: 4, part: 0 }));
  return merge(P, 0.62);
}

// Zone 2 — angler: a bulk of a head, a real jaw, a lure on a stalk.
function anglerGeometry() {
  const P = [];
  const c = 0x38332d;
  P.push(loft([[-1.0, 0.04, 0.035, 0.04], [-0.73, 0.14, 0.12, 0.07], [-0.4, 0.41, 0.36, 0.12], [-0.02, 0.59, 0.48, 0.14], [0.3, 0.66, 0.51, 0.13], [0.58, 0.58, 0.46, 0.075], [0.74, 0.49, 0.41, 0.025]], c, { rows: 18, sides: 14, skin: 0.03 }));
  gape(P, 0.748, 0.025, 0.48, 0.4, 0.48, c, 23, 0.0);
  eyes(P, 0.52, 0.48, 0.41, 0.067, { rim: 0x6b5940 });
  P.push(blade([[-0.9, 0, 0], [-1.3, 0.3, 0], [-1.15, 0, 0], [-1.3, -0.3, 0]], 0x4b443b, { rows: 3, sides: 16, bulge: 0.02, part: 1 }));
  for (const s of [-1, 1]) P.push(blade([[-0.2, -0.08, s * 0.38], [-0.41, -0.4, s * 0.69], [-0.78, -0.28, s * 0.46], [-0.62, -0.1, s * 0.26]], 0x574e43, { rows: 3, sides: 18, bulge: 0.03, part: 2, phase: s }));
  P.push(blade([[-0.72, 0.2, 0], [-0.57, 0.58, 0], [-0.36, 0.47, 0], [-0.3, 0.36, 0]], 0x4c443a, { rows: 2, sides: 14, bulge: 0.02, part: 0 }));
  // lure: illicium stalk + esca bead (aGlow)
  P.push(limb([[0.18, 0.76, 0], [0.28, 1.38, 0.02], [0.79, 1.46, 0.035], [1.04, 1.08, 0]], 0.013, 0x6d6654, { rows: 10, sides: 4, tip: 0.6, part: 5 }));
  P.push(ell([1.04, 1.08, 0], [0.075, 0.085, 0.07], 0xd8e9d0, { detail: 7, part: 5, glow: 1, noise: 0 }));
  return merge(P, 1.6);
}

function gulperGeometry() {
  const P = [];
  const c = 0x2e2c2a;
  P.push(loft([[-4.7, 0.004, 0.004, -0.15], [-3.4, 0.025, 0.02, -0.17], [-2.1, 0.06, 0.05, -0.09], [-0.9, 0.11, 0.095, -0.06], [-0.1, 0.19, 0.18, -0.05], [0.5, 0.32, 0.32, -0.13], [1.06, 0.37, 0.35, -0.16], [1.49, 0.32, 0.31, -0.1]], c, { rows: 40, sides: 12, part: (x) => (x < -1.5 ? 1 : 0) }));
  gape(P, 1.49, -0.1, 0.315, 0.3, 0.67, 0x4b4438, 11, -0.16);
  P.push(blade([[-0.2, 0.11, 0], [-1.1, 0.22, 0], [-3.7, -0.04, 0], [-4.2, -0.17, 0], [-1.9, -0.1, 0]], 0x494640, { rows: 3, sides: 30, bulge: 0.01, part: 1 }));
  eyes(P, 1.02, 0.21, 0.23, 0.044);
  P.push(ell([-4.67, -0.15, 0], [0.03, 0.03, 0.03], 0xb9d9be, { detail: 5, part: 1, glow: 1, noise: 0 }));
  return merge(P, 1.5);
}

function lanternfishGeometry() {
  const P = [];
  const c = 0x556a76;
  P.push(loft([[-1.0, 0.03, 0.03, 0], [-0.72, 0.12, 0.1, 0.01], [-0.25, 0.25, 0.19, 0.02], [0.25, 0.27, 0.2, 0.02], [0.72, 0.19, 0.15, 0.0], [1.0, 0.04, 0.04, -0.02]], c, { rows: 12, sides: 8 }));
  P.push(blade([[-0.95, 0, 0], [-1.38, 0.38, 0], [-1.2, 0, 0], [-1.38, -0.36, 0]], 0x6a8290, { rows: 3, sides: 16, bulge: 0.02, part: 1 }));
  P.push(blade([[-0.5, 0.24, 0], [-0.2, 0.46, 0], [0.3, 0.27, 0]], 0x6a8290, { rows: 2, sides: 12, bulge: 0.02, part: 0 }));
  for (const s of [-1, 1]) P.push(blade([[0.35, -0.04, s * 0.18], [0.0, -0.2, s * 0.52], [-0.15, -0.06, s * 0.2]], 0x6a8290, { rows: 2, sides: 12, bulge: 0.02, part: 2, phase: s }));
  eyes(P, 0.62, 0.06, 0.17, 0.09, { rim: 0x8fa9a0 });
  photophores(P, 7, -0.7, 0.55, -0.2, 0.15, 0.045, 0x9fc8c4);
  const g = merge(P, 0.7);
  // a faint ventral sheen on the body so the shoal has presence between the rows
  const pos = g.attributes.position.array, gl = g.attributes.aGlow.array, pa = g.attributes.aPart.array;
  for (let i = 0; i < gl.length; i++) if (gl[i] === 0 && pa[i] < 0.5 && pos[i * 3 + 1] < 0) gl[i] = 0.10;
  return g;
}

// ---------------------------------------------------------------------------
// the one shader
// ---------------------------------------------------------------------------
const VERT_COMMON = `#include <common>
attribute float aPart; attribute float aPhase; attribute float aGlow; attribute vec4 aInst;
uniform float uTime; uniform float uCull; uniform float uFogD;
uniform vec4 uMot; uniform vec4 uHinge; uniform vec4 uBody;
varying float vGlow; varying float vFade;
float fnContract(float x){ x = fract(x); return x < 0.28 ? 0.5 - 0.5*cos(x*11.2199) : 0.5 + 0.5*cos((x-0.28)*4.3633); }`;

// Runs in beginnormal_vertex (first chunk), leaving fnP/fnN for begin_vertex.
const VERT_MOTION = `#include <beginnormal_vertex>
vec3 fnP = position; vec3 fnN = objectNormal;
float fnPart = aPart; float fnStroke = aInst.x; float fnEff = aInst.y;
if (fnPart < 1.5) {
  // body/tail: lateral wave growing toward the tail (x negative), tail whips harder
  float fnT = clamp((uBody.y - fnP.x) / uBody.x, 0.0, 1.0);
  float fnAmp = uMot.x * (fnT*fnT*0.9 + 0.04) * (0.3 + 0.7*fnEff) * (fnPart > 0.5 ? 1.7 : 1.0);
  float fnArg = fnStroke - fnP.x * uBody.z;
  fnP.z += sin(fnArg) * fnAmp;
  fnN.x -= cos(fnArg) * fnAmp * uBody.z * fnN.z;
} else if (fnPart < 2.5) {
  // wave-wing: a travelling wave out along the span, root still, tip loose
  float fnS = abs(fnP.z) / uBody.w;
  float fnK = smoothstep(0.05, 1.0, fnS);
  float fnArg = fnStroke - fnS * uMot.z + fnP.x * 0.4 + aPhase;
  float fnA = uMot.y * fnK * fnK * (0.35 + 0.65*fnEff);
  fnP.y += sin(fnArg) * fnA;
  fnN.z -= cos(fnArg) * fnA * uMot.z * sign(fnP.z) * 0.6;
} else if (fnPart < 3.5) {
  // legs: a shuffle keyed per leg by aPhase, only while walking (effort)
  float fnL = clamp(1.0 - fnP.y / 0.35, 0.0, 1.0);
  float fnArg = fnStroke + aPhase;
  fnP.x += sin(fnArg) * uMot.w * fnEff * fnL;
  fnP.y += max(0.0, cos(fnArg)) * uMot.w * 0.6 * fnEff * fnL;
} else if (fnPart < 4.5) {
  // jaw: hinge about a line parallel to z through uHinge.xy, opening downward
  float fnAng = -aInst.z * uHinge.w;
  float fnC = cos(fnAng), fnS2 = sin(fnAng);
  vec2 fnD = fnP.xy - uHinge.xy;
  fnP.xy = uHinge.xy + vec2(fnD.x*fnC - fnD.y*fnS2, fnD.x*fnS2 + fnD.y*fnC);
  fnN.xy = vec2(fnN.x*fnC - fnN.y*fnS2, fnN.x*fnS2 + fnN.y*fnC);
} else if (fnPart < 5.5) {
  // lure: the stalk sways, more toward the tip
  float fnH = clamp((fnP.y - uHinge.z) * 0.8, 0.0, 1.5);
  fnP.z += sin(uTime * 0.9 + aInst.x * 0.2) * 0.07 * fnH;
  fnP.x += sin(uTime * 0.6 + 1.3) * 0.04 * fnH;
} else if (fnPart < 6.5) {
  // umbrella: radial contraction rolling from the mantle to the rim
  float fnR = length(fnP.xz);
  float fnT = smoothstep(0.2, 1.1, fnR);
  float fnCt = fnContract(fnStroke / 6.2831853 - fnT * 0.12);
  fnP.xz *= 1.0 - uMot.y * fnCt * fnT;
  fnP.y += fnCt * uMot.z * fnT - fnCt * 0.06 * (1.0 - fnT);
} else {
  // rigid flipper: rotate about the root line (|z| = uHinge.z) through the stroke
  float fnS = max(0.0, abs(fnP.z) - uHinge.z);
  float fnArg = fnStroke + aPhase;
  fnP.y += sin(fnArg) * uMot.w * fnEff * fnS;
  fnP.x -= max(0.0, cos(fnArg)) * uMot.w * 0.25 * fnEff * fnS;
  fnN.z -= sin(fnArg) * uMot.w * fnEff * 0.4 * sign(fnP.z);
}
objectNormal = normalize(fnN);`;

const VERT_BEGIN = `#include <begin_vertex>
transformed = fnP;
#ifdef USE_INSTANCING
vec4 fnW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
vec4 fnW = modelMatrix * vec4(transformed, 1.0);
#endif
float fnDist = length(fnW.xyz - cameraPosition);
vFade = 1.0 - smoothstep(uCull * 0.72, uCull, fnDist);
vGlow = aGlow * aInst.w * exp(-uFogD * uFogD * fnDist * fnDist);`;

const FRAG_COMMON = `#include <common>
uniform vec3 uGlowCol;
varying float vGlow; varying float vFade;`;
const FRAG_COLOR = `#include <color_fragment>
diffuseColor.a *= vFade;`;
const FRAG_EMIT = `#include <emissivemap_fragment>
totalEmissiveRadiance += uGlowCol * vGlow;`;

// o: { rough, metal, mot:[undAmp, wingAmp, wingK, legAmp], hinge:[x,y,z,openAng],
//      body:[len, headX, waveK, span], glow:0x..., glowI }
function faunaMaterial(o) {
  const u = {
    uMot: { value: new THREE.Vector4(...(o.mot || [0, 0, 0, 0])) },
    uHinge: { value: new THREE.Vector4(...(o.hinge || [0, 0, 0, 0])) },
    uBody: { value: new THREE.Vector4(...(o.body || [1, 0.5, 2, 1])) },
    uGlowCol: { value: new THREE.Color(o.glow || 0).multiplyScalar(o.glowI || 0) },
    uTime, uCull, uFogD
  };
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: o.rough === undefined ? 0.72 : o.rough, metalness: o.metal || 0,
    side: THREE.DoubleSide, emissive: 0x000000, alphaHash: true
  });
  m.userData.u = u;
  // Every fauna material carries the identical injected source, so sharing one
  // key is CORRECT here — one program for the whole module. (The creatures.js
  // hazard is DIFFERENT sources under one key.)
  m.customProgramCacheKey = () => 'abyssa-fauna';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', VERT_COMMON)
      .replace('#include <beginnormal_vertex>', VERT_MOTION)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', FRAG_COMMON)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', FRAG_EMIT);
  };
  return m;
}

// ---------------------------------------------------------------------------
// groups — one InstancedMesh each; state in typed arrays, stepped at 30 Hz
// ---------------------------------------------------------------------------
// st layout per instance (STN floats): x y z heading pitch roll stroke effort gape glow
const STN = 10;
const groups = [];
const byName = {};

function makeGroup(name, zi, n, geo, mat, extra) {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const aInst = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  aInst.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aInst', aInst);
  scene.add(mesh);
  const G = {
    name, zi, n, mesh, aInst, mat,
    st: new Float32Array(n * STN), stp: new Float32Array(n * STN),
    sc: new Float32Array(n),            // per-instance scale
    tris: geo.index.count / 3 * n,
    active: false, stat: false,
    ...extra
  };
  groups.push(G);
  byName[name] = G;
  return G;
}

// ---- pose write: interpolate prev->cur and build the instance matrices --------
function lerpAng(a, b, k) {
  let d = b - a;
  d -= Math.floor((d + Math.PI) / TAU) * TAU;
  return a + d * k;
}
function pose(G, k) {
  const st = G.st, sp = G.stp, arr = G.mesh.instanceMatrix.array, ai = G.aInst.array, sc = G.sc, n = G.n;
  for (let i = 0; i < n; i++) {
    const o = i * STN, m = i * 16, q = i * 4;
    const x = sp[o] + (st[o] - sp[o]) * k, y = sp[o + 1] + (st[o + 1] - sp[o + 1]) * k, z = sp[o + 2] + (st[o + 2] - sp[o + 2]) * k;
    const h = lerpAng(sp[o + 3], st[o + 3], k), pt = sp[o + 4] + (st[o + 4] - sp[o + 4]) * k, rl = sp[o + 5] + (st[o + 5] - sp[o + 5]) * k;
    const s = sc[i];
    const ch = Math.cos(h), sh = Math.sin(h), cp = Math.cos(pt), spt = Math.sin(pt), cr = Math.cos(rl), sr = Math.sin(rl);
    // forward = yaw(+X), right = yaw(+Z), then pitch about right, then roll about forward
    const fx0 = ch, fz0 = -sh, rx = sh, rz = ch;
    const fx = fx0 * cp, fy = spt, fz = fz0 * cp;
    const ux0 = -fx0 * spt, uy0 = cp, uz0 = -fz0 * spt;
    const Rx = rx * cr + ux0 * sr, Ry = uy0 * sr, Rz = rz * cr + uz0 * sr;
    const Ux = ux0 * cr - rx * sr, Uy = uy0 * cr, Uz = uz0 * cr - rz * sr;
    arr[m] = fx * s; arr[m + 1] = fy * s; arr[m + 2] = fz * s; arr[m + 3] = 0;
    arr[m + 4] = Ux * s; arr[m + 5] = Uy * s; arr[m + 6] = Uz * s; arr[m + 7] = 0;
    arr[m + 8] = Rx * s; arr[m + 9] = Ry * s; arr[m + 10] = Rz * s; arr[m + 11] = 0;
    arr[m + 12] = x; arr[m + 13] = y; arr[m + 14] = z; arr[m + 15] = 1;
    ai[q] = sp[o + 6] + (st[o + 6] - sp[o + 6]) * k;
    ai[q + 1] = sp[o + 7] + (st[o + 7] - sp[o + 7]) * k;
    ai[q + 2] = sp[o + 8] + (st[o + 8] - sp[o + 8]) * k;
    ai[q + 3] = sp[o + 9] + (st[o + 9] - sp[o + 9]) * k;
  }
  G.mesh.instanceMatrix.needsUpdate = true;
  G.aInst.needsUpdate = true;
}

// ---- steering helpers (no allocation) ---------------------------------------
const _v = { x: 0, y: 0, z: 0 };

// Push-out from every rock near (x,y,z), summed into _v. Returns the deepest
// PENETRATION (0 = clear of every rock); _prox carries the softer proximity term
// (> 0 within 1.6 radii) for steering. rockColliders spans all three zones, so
// the height test keeps a zone-2 boulder from steering a zone-0 crab.
let _prox = 0;
function rockPush(x, y, z, pad, vertical) {
  _v.x = 0; _v.y = 0; _v.z = 0;
  let worst = 0; _prox = 0;
  for (let i = 0; i < rockColliders.length; i++) {
    const c = rockColliders[i];
    const R = c.r + pad;
    const dy0 = y - c.y;
    if (dy0 > R + 4 || dy0 < -R - 4) continue;
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz > R * R * 2.6) continue;
    const dy = vertical ? dy0 : 0;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
    if (d > R * 1.6) continue;
    const k = Math.max(0, 1.6 - d / R) / d;
    _v.x += dx * k; _v.y += dy * k; _v.z += dz * k;
    _prox = Math.max(_prox, 1.6 - d / R);
    worst = Math.max(worst, 1 - d / R);
  }
  return worst;
}

// The highest rock crown under a horizontal disc — a swimmer keeps its belly above it.
function rockRoof(x, y, z, reach) {
  let top = -1e9;
  for (let i = 0; i < rockColliders.length; i++) {
    const c = rockColliders[i];
    const dy = y - c.y;
    if (dy > 40 || dy < -40) continue;
    const dx = x - c.x, dz = z - c.z, R = c.r + reach;
    if (dx * dx + dz * dz < R * R) top = Math.max(top, c.y + c.r);
  }
  return top;
}

const _pp = { x: 0, y: 0, z: 0 };   // the diver, cached per step

// Turn h toward want by at most rate; the signed step is left in _turn (no allocation).
let _turn = 0;
function turnTo(h, want, rate) {
  let d = want - h;
  d -= Math.floor((d + Math.PI) / TAU) * TAU;
  _turn = clamp(d, -rate, rate);
  return h + _turn;
}

// ---------------------------------------------------------------------------
// per-group behaviours. Each has layout(G) (site stream) and step(G) (30 Hz).
// ---------------------------------------------------------------------------

// ---- RAY: the indifferent giant. Slow glides over the reef, banking turns. ----
function rayLayout(G) {
  const st = G.st;
  const a = rr(0, TAU), r = rr(30, 110);
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  st[0] = x; st[1] = terrainH(x, z, 0) + 9; st[2] = z;
  st[3] = rr(0, TAU); st[4] = 0; st[5] = 0; st[6] = rr(0, TAU); st[7] = 0.5; st[8] = 0; st[9] = 0;
  G.sc[0] = rr(0.92, 1.1);
  rayGoal(G);
}
function rayGoal(G) {
  const a = rr(0, TAU), r = rr(22, 120);
  G.gx = Math.cos(a) * r; G.gz = Math.sin(a) * r;
  G.gh = rr(5, 13);
  G.gt = rr(14, 26);
}
function rayStep(G) {
  const st = G.st, dt = STEP;
  let x = st[0], y = st[1], z = st[2], h = st[3];
  G.gt -= dt;
  const gdx = G.gx - x, gdz = G.gz - z;
  if (G.gt <= 0 || gdx * gdx + gdz * gdz < 100) rayGoal(G);
  let want = Math.atan2(-gdz, gdx);
  // keep a giant's distance from the diver, unhurried
  const px = x - _pp.x, pz = z - _pp.z, pd = Math.hypot(px, pz);
  if (pd < 9) want = Math.atan2(-pz, px);
  h = turnTo(h, want, 0.32 * dt);
  const turnRate = _turn / dt;
  const speed = 2.7;
  x += Math.cos(h) * speed * dt; z += -Math.sin(h) * speed * dt;
  // altitude: goal height over the floor, never under a rock's crown
  const floor = terrainH(x, z, 0);
  const roof = rockRoof(x, y, z, 4);
  let ty = Math.max(floor + G.gh, roof + 2.5);
  ty = Math.min(ty, zoneTop(0) - 20);
  const vy = clamp((ty - y) * 0.6, -1.4, 1.4);
  y += vy * dt;
  st[0] = x; st[1] = y; st[2] = z; st[3] = h;
  st[4] += (clamp(vy * 0.35, -0.4, 0.4) - st[4]) * Math.min(1, dt * 2);
  st[5] += (clamp(turnRate * 2.2, -0.55, 0.55) - st[5]) * Math.min(1, dt * 1.6);
  // effort: climbing and turning cost strokes; a level glide is a slow beat
  const eff = clamp(0.35 + Math.max(0, vy) * 0.5 + Math.abs(turnRate) * 1.5, 0.3, 1);
  st[7] += (eff - st[7]) * Math.min(1, dt * 1.5);
  st[6] += dt * (0.9 + st[7] * 1.6);
  if (st[6] > 6283) st[6] -= 6283;
}

// ---- TURTLE: stroke / glide, flees a close diver ----
function turtleLayout(G) {
  const st = G.st;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN, a = rr(0, TAU), r = rr(25, 120);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    st[o] = x; st[o + 1] = terrainH(x, z, 0) + rr(3, 7); st[o + 2] = z;
    st[o + 3] = rr(0, TAU); st[o + 4] = 0; st[o + 5] = 0; st[o + 6] = rr(0, TAU); st[o + 7] = 0.5; st[o + 8] = 0; st[o + 9] = 0;
    G.sc[i] = rr(0.85, 1.15);
    G.cyc[i] = rr(0, 6);
    turtleGoal(G, i);
  }
}
function turtleGoal(G, i) {
  const a = rr(0, TAU), r = rr(18, 125);
  G.gx[i] = Math.cos(a) * r; G.gz[i] = Math.sin(a) * r; G.gh[i] = rr(2.5, 8); G.gt[i] = rr(12, 24);
}
function turtleStep(G) {
  const st = G.st, dt = STEP;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    let x = st[o], y = st[o + 1], z = st[o + 2], h = st[o + 3];
    G.gt[i] -= dt;
    const gdx = G.gx[i] - x, gdz = G.gz[i] - z;
    if (G.gt[i] <= 0 || gdx * gdx + gdz * gdz < 36) turtleGoal(G, i);
    let want = Math.atan2(-gdz, gdx);
    const px = x - _pp.x, py = y - _pp.y, pz = z - _pp.z, pd = Math.sqrt(px * px + py * py + pz * pz);
    const scared = pd < 7;
    if (scared) want = Math.atan2(-pz, px);
    // rocks: steer out of them
    rockPush(x, y, z, 1.2, true); if (_prox > 0.25) want = Math.atan2(-_v.z, _v.x);
    h = turnTo(h, want, (scared ? 0.9 : 0.5) * dt);
    const turnRate = _turn / dt;
    // stroke / glide: a 6 s cycle, strokes for the first 2.4 s, then coasts
    G.cyc[i] += dt; if (G.cyc[i] > 6) G.cyc[i] -= 6;
    const stroking = scared || G.cyc[i] < 2.4;
    const effT = stroking ? 1 : 0;
    st[o + 7] += (effT - st[o + 7]) * Math.min(1, dt * (stroking ? 4 : 1.2));
    const speed = (0.5 + st[o + 7] * 1.3) * (scared ? 1.8 : 1);
    x += Math.cos(h) * speed * dt; z += -Math.sin(h) * speed * dt;
    const floor = terrainH(x, z, 0);
    const ty = Math.max(floor + G.gh[i], rockRoof(x, y, z, 1.5) + 1.2);
    const vy = clamp((ty - y) * 0.5, -0.8, 0.8);
    y += vy * dt;
    st[o] = x; st[o + 1] = y; st[o + 2] = z; st[o + 3] = h;
    st[o + 4] += (clamp(vy * 0.5, -0.4, 0.4) - st[o + 4]) * Math.min(1, dt * 2);
    st[o + 5] += (clamp(turnRate * 1.4, -0.4, 0.4) - st[o + 5]) * Math.min(1, dt * 2);
    st[o + 6] += dt * (1.2 + st[o + 7] * 4.2 + (scared ? 3 : 0));
    if (st[o + 6] > 6283) st[o + 6] -= 6283;
  }
}

// ---- MORAY: in a crevice. Head out, mouth working; withdraws when Sal nears. ----
function morayLayout(G) {
  const st = G.st;
  // candidate rocks: zone-0 boulders big enough to hold a body
  let cnt = 0;
  for (let i = 0; i < rockColliders.length; i++) {
    const c = rockColliders[i];
    if (cnt < G.cand.length && c.r >= 1.9 && c.y > zoneBottom(0) - 6 && c.y < zoneTop(0)) G.cand[cnt++] = i;
  }
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    let c = null;
    if (cnt > 0) c = rockColliders[G.cand[Math.floor(rr(0, cnt)) % cnt]];
    const a = rr(0, TAU);
    const dx = Math.cos(a), dz = Math.sin(a);
    if (c) {
      G.bx[i] = c.x + dx * c.r * 0.55; G.bz[i] = c.z + dz * c.r * 0.55;
      // the collider centre can sit under the floor for a squat boulder: the head
      // comes out of the rock's mid-flank, never below the sand
      G.by[i] = Math.max(c.y + c.r * 0.2, terrainH(G.bx[i], G.bz[i], 0) + 0.7);
      G.dx[i] = dx; G.dz[i] = dz; G.rr[i] = c.r;
    } else {
      // no boulders at this site: lie in a floor hollow instead
      const r = rr(20, 90);
      G.bx[i] = Math.cos(a) * r; G.bz[i] = Math.sin(a) * r; G.by[i] = terrainH(G.bx[i], G.bz[i], 0) + 0.3;
      G.dx[i] = dx; G.dz[i] = dz; G.rr[i] = 1.2;
    }
    G.out[i] = 1;
    st[o + 3] = Math.atan2(-dz, dx); st[o + 4] = rr(0.05, 0.2); st[o + 5] = 0;
    st[o + 6] = rr(0, TAU); st[o + 7] = 0.2; st[o + 8] = 0.2; st[o + 9] = 0;
    G.sc[i] = rr(0.9, 1.25);
    G.cyc[i] = rr(0, 8);
    morayPlace(G, i);
  }
}
function morayPlace(G, i) {
  const o = i * STN, r = G.rr[i], s = G.sc[i];
  // out = 1: the head ~0.5u proud of the rock's flank; out = 0: withdrawn inside it
  const reach = r * 0.45 + 0.5 * s - (1 - G.out[i]) * 1.6 * s;
  G.st[o] = G.bx[i] + G.dx[i] * reach; G.st[o + 2] = G.bz[i] + G.dz[i] * reach;
  G.st[o + 1] = G.by[i];
}
function morayStep(G) {
  const st = G.st, dt = STEP;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    const px = st[o] - _pp.x, py = st[o + 1] - _pp.y, pz = st[o + 2] - _pp.z;
    const near = px * px + py * py + pz * pz < 81;
    G.out[i] += ((near ? 0 : 1) - G.out[i]) * Math.min(1, dt * (near ? 3.2 : 0.5));
    morayPlace(G, i);
    // the mouth: a slow open-close rhythm (respiration), shut when withdrawn
    G.cyc[i] += dt; if (G.cyc[i] > 8) G.cyc[i] -= 8;
    const g = (0.35 + 0.65 * Math.max(0, Math.sin(G.cyc[i] * 0.9))) * (0.15 + 0.85 * G.out[i]);
    st[o + 8] += (g - st[o + 8]) * Math.min(1, dt * 3);
    st[o + 7] = 0.25 + (near ? 0.5 : 0);
    st[o + 6] += dt * 1.6;
    if (st[o + 6] > 6283) st[o + 6] -= 6283;
  }
}

// ---- CRAB: on the floor by the rocks; sideways bouts, rests, scuttles from Sal. ----
function crabLayout(G) {
  const st = G.st;
  let cnt = 0;
  for (let i = 0; i < rockColliders.length; i++) {
    const c = rockColliders[i];
    if (cnt < G.cand.length && c.y > zoneBottom(0) - 6 && c.y < zoneTop(0)) G.cand[cnt++] = i;
  }
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    let x, z;
    if (cnt > 0) {
      const c = rockColliders[G.cand[Math.floor(rr(0, cnt)) % cnt]];
      const a = rr(0, TAU), d = c.r + rr(0.4, 2.2);
      x = c.x + Math.cos(a) * d; z = c.z + Math.sin(a) * d;
    } else { const a = rr(0, TAU), r = rr(15, 100); x = Math.cos(a) * r; z = Math.sin(a) * r; }
    st[o] = x; st[o + 2] = z; st[o + 1] = terrainH(x, z, 0) + 0.02;
    st[o + 3] = rr(0, TAU); st[o + 4] = 0; st[o + 5] = 0; st[o + 6] = rr(0, TAU); st[o + 7] = 0; st[o + 8] = 0; st[o + 9] = 0;
    G.sc[i] = rr(0.7, 1.3);
    G.mode[i] = 0; G.mt[i] = rr(1, 8); G.side[i] = rr(0, 1) < 0.5 ? -1 : 1;
  }
}
function crabStep(G) {
  const st = G.st, dt = STEP;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    let x = st[o], y = st[o + 1], z = st[o + 2], h = st[o + 3];
    const px = x - _pp.x, pz = z - _pp.z, pd2 = px * px + pz * pz;
    const scared = pd2 < 25;
    G.mt[i] -= dt;
    if (G.mt[i] <= 0) {
      if (G.mode[i] === 0) { G.mode[i] = 1; G.mt[i] = rr(1.2, 3); G.side[i] = rr(0, 1) < 0.5 ? -1 : 1; }
      else { G.mode[i] = 0; G.mt[i] = rr(3, 9); }
    }
    let walking = G.mode[i] === 1;
    // sideways travel: along the body's +Z (right) axis times side
    let tx = Math.sin(h) * G.side[i], tz = Math.cos(h) * G.side[i];
    if (scared) {
      walking = true;
      // pick the side that carries it away from the diver
      const away = tx * px + tz * pz;
      if (away < 0) { G.side[i] = -G.side[i]; tx = -tx; tz = -tz; }
    }
    const speed = walking ? (scared ? 1.6 : 0.55) : 0;
    if (walking) {
      const nx = x + tx * speed * dt, nz = z + tz * speed * dt;
      if (rockPush(nx, y, nz, 0.3, false) > 0) { G.side[i] = -G.side[i]; }
      else { x = nx; z = nz; }
      if (x * x + z * z > 150 * 150) G.side[i] = -G.side[i];
      // slow drift of the facing so bouts are not perfectly straight
      h += Math.sin(st[o + 6] * 0.11 + i) * 0.25 * dt;
    }
    y = terrainH(x, z, 0) + 0.02;
    st[o] = x; st[o + 1] = y; st[o + 2] = z; st[o + 3] = h;
    st[o + 7] += ((walking ? 1 : 0) - st[o + 7]) * Math.min(1, dt * 6);
    st[o + 6] += dt * (walking ? (scared ? 16 : 8) : 0.6);
    if (st[o + 6] > 6283) st[o + 6] -= 6283;
  }
}

// ---- STATIC floor life: stars, urchins. Layout only. ----
function floorLayout(G, zi, rMin, rMax, lift) {
  const st = G.st;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN, a = rr(0, TAU), r = rr(rMin, rMax);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    st[o] = x; st[o + 2] = z; st[o + 1] = terrainH(x, z, zi) + lift;
    st[o + 3] = rr(0, TAU); st[o + 4] = 0; st[o + 5] = 0; st[o + 6] = 0; st[o + 7] = 0; st[o + 8] = 0; st[o + 9] = 0;
    G.sc[i] = rr(0.7, 1.35);
    // never inside a boulder
    if (rockPush(x, st[o + 1], z, 0.3, false) > 0.02) { st[o] += _v.x * 3; st[o + 2] += _v.z * 3; st[o + 1] = terrainH(st[o], st[o + 2], zi) + lift; }
  }
}

// ---- SHOAL: small boid group (vent fish, lanternfish). Fixed-neighbour boids in
// shoal-local space, the centre wanders on its own goal. ----
const NB = [1, 2, 3, 5, 8];
function shoalLayout(G, cx, cz, cy, zi) {
  const st = G.st;
  G.cx = cx; G.cy = cy; G.cz = cz; G.cvx = 0; G.cvy = 0; G.cvz = 0;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    G.P[i * 3] = rr(-G.radius, G.radius); G.P[i * 3 + 1] = rr(-G.radius, G.radius) * 0.4; G.P[i * 3 + 2] = rr(-G.radius, G.radius);
    G.V[i * 3] = 0; G.V[i * 3 + 1] = 0; G.V[i * 3 + 2] = 0;
    st[o] = cx + G.P[i * 3]; st[o + 1] = cy + G.P[i * 3 + 1]; st[o + 2] = cz + G.P[i * 3 + 2];
    st[o + 3] = rr(0, TAU); st[o + 4] = 0; st[o + 5] = 0; st[o + 6] = rr(0, TAU); st[o + 7] = 0.5; st[o + 8] = 0; st[o + 9] = 1;
    G.sc[i] = rr(0.8, 1.2);
    G.ph[i] = rr(0, TAU);
  }
  shoalGoal(G, zi);
}
function shoalGoal(G, zi) {
  const a = rr(0, TAU), r = rr(G.home, G.home + G.roam);
  G.gx = G.ax + Math.cos(a) * r; G.gz = G.az + Math.sin(a) * r;
  G.gx = clamp(G.gx, -WORLD_R * 0.7, WORLD_R * 0.7); G.gz = clamp(G.gz, -WORLD_R * 0.7, WORLD_R * 0.7);
  G.gy = terrainH(G.gx, G.gz, zi) + rr(G.hLo, G.hHi);
  G.gt = rr(8, 18);
}
function shoalStep(G, zi) {
  const st = G.st, dt = STEP, n = G.n, P = G.P, V = G.V;
  G.gt -= dt;
  let gx = G.gx - G.cx, gy = G.gy - G.cy, gz = G.gz - G.cz;
  let gd = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-4;
  if (G.gt <= 0 || gd < 5) { shoalGoal(G, zi); gx = G.gx - G.cx; gy = G.gy - G.cy; gz = G.gz - G.cz; gd = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-4; }
  G.cvx += gx / gd * G.speed * 0.7 * dt; G.cvy += gy / gd * G.speed * 0.7 * dt; G.cvz += gz / gd * G.speed * 0.7 * dt;
  // the whole shoal shies off the diver
  const px = G.cx - _pp.x, py = G.cy - _pp.y, pz = G.cz - _pp.z, pd = Math.sqrt(px * px + py * py + pz * pz) + 1e-4;
  const panicR = G.fear * 2;
  if (pd < panicR) { const k = (1 - pd / panicR) * G.speed * 3 * dt / pd; G.cvx += px * k; G.cvy += py * k; G.cvz += pz * k; }
  const damp = Math.pow(0.45, dt);
  G.cvx *= damp; G.cvy *= damp; G.cvz *= damp;
  const cs = Math.sqrt(G.cvx * G.cvx + G.cvy * G.cvy + G.cvz * G.cvz);
  if (cs > G.speed) { const k = G.speed / cs; G.cvx *= k; G.cvy *= k; G.cvz *= k; }
  G.cx += G.cvx * dt; G.cy += G.cvy * dt; G.cz += G.cvz * dt;
  const floor = terrainH(G.cx, G.cz, zi);
  const yLo = floor + G.hLo, yHi = Math.min(floor + G.hHi + 10, zoneTop(zi) - 12);
  if (G.cy < yLo) { G.cy = yLo; G.cvy = Math.abs(G.cvy) * 0.5; } else if (G.cy > yHi) { G.cy = yHi; G.cvy = -Math.abs(G.cvy) * 0.5; }
  const lpx = _pp.x - G.cx, lpy = _pp.y - G.cy, lpz = _pp.z - G.cz;
  const fear2 = G.fear * G.fear, sepR2 = 1.2, nbR2 = 40;
  const roll = G.roll = (G.roll + 3) % n;
  const floorLocal = floor + 1.2 - G.cy;
  let panic = 0;
  for (let i = 0; i < n; i++) {
    const i3 = i * 3, o = i * STN;
    const x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
    let ax = 0, ay = 0, az = 0;
    for (let k = 0; k < 5; k++) {
      const j3 = ((i + NB[k] + roll) % n) * 3;
      const dx = P[j3] - x, dy = P[j3 + 1] - y, dz = P[j3 + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz + 1e-4;
      if (d2 > nbR2) continue;
      if (d2 < sepR2) { const inv = 2.2 / d2; ax -= dx * inv; ay -= dy * inv; az -= dz * inv; }
      else { ax += (V[j3] - V[i3]) * 0.9 + dx * 0.05; ay += (V[j3 + 1] - V[i3 + 1]) * 0.9 + dy * 0.05; az += (V[j3 + 2] - V[i3 + 2]) * 0.9 + dz * 0.05; }
    }
    const rl = Math.sqrt(x * x + y * y + z * z) + 1e-4;
    const pull = 0.5 + Math.max(0, rl - G.radius) * 0.8;
    ax -= x / rl * pull; ay -= y / rl * pull * 2.2; az -= z / rl * pull;
    const ph = G.ph[i];
    ax += Math.sin(uTime.value * 0.9 + ph) * 0.9; ay += Math.sin(uTime.value * 0.63 + ph * 1.7) * 0.4; az += Math.cos(uTime.value * 1.13 + ph * 0.6) * 0.9;
    const fx = x - lpx, fy = y - lpy, fz = z - lpz, fd2 = fx * fx + fy * fy + fz * fz;
    if (fd2 < fear2) { const fd = Math.sqrt(fd2) + 0.01, s = 1 - fd / G.fear; if (s > panic) panic = s; const k = s * s * 40 / fd; ax += fx * k; ay += fy * k; az += fz * k; }
    let vx = V[i3] + ax * dt, vy = V[i3 + 1] + ay * dt, vz = V[i3 + 2] + az * dt;
    const spd = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-5;
    const maxS = G.local * (1 + panic * 3), minS = G.local * 0.3;
    const cl = spd > maxS ? maxS / spd : (spd < minS ? minS / spd : 1);
    vx *= cl; vy *= cl; vz *= cl;
    let ny = y + vy * dt;
    if (ny < floorLocal) { ny = floorLocal; vy = Math.abs(vy); }
    P[i3] = x + vx * dt; P[i3 + 1] = ny; P[i3 + 2] = z + vz * dt;
    V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
    const wx = vx + G.cvx, wy = vy + G.cvy, wz = vz + G.cvz;
    const wl = Math.sqrt(wx * wx + wy * wy + wz * wz) + 1e-5;
    const want = Math.atan2(-wz, wx);
    const h = turnTo(st[o + 3], want, 4.5 * dt);
    st[o] = G.cx + P[i3]; st[o + 1] = G.cy + P[i3 + 1]; st[o + 2] = G.cz + P[i3 + 2]; st[o + 3] = h;
    st[o + 4] += (clamp(Math.asin(clamp(wy / wl, -1, 1)) * 0.7, -0.6, 0.6) - st[o + 4]) * Math.min(1, dt * 4);
    st[o + 5] += (clamp(_turn / dt * 0.25, -0.7, 0.7) - st[o + 5]) * Math.min(1, dt * 5);
    const eff = clamp(wl / (G.local * 1.6), 0.25, 1);
    st[o + 7] += (eff - st[o + 7]) * Math.min(1, dt * 3);
    st[o + 6] += dt * G.beat * (0.4 + st[o + 7] * 0.8 + panic * 1.2);
    if (st[o + 6] > 6283) st[o + 6] -= 6283;
    // lanternfish: the rows breathe slowly, out of phase across the shoal
    st[o + 9] = 0.55 + 0.45 * Math.sin(uTime.value * 0.7 + ph * 2.0);
  }
  G.panic = panic;
}

// ---- FLAPJACK: hovers over the crust, umbrella pulses carry it. ----
function flapjackLayout(G) {
  const st = G.st;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    const v = activeVents.length ? activeVents[Math.floor(rr(0, activeVents.length)) % activeVents.length] : null;
    const a = rr(0, TAU), r = v ? rr(6, 16) : rr(20, 90);
    const x = (v ? v.x : 0) + Math.cos(a) * r, z = (v ? v.z : 0) + Math.sin(a) * r;
    st[o] = x; st[o + 2] = z; st[o + 1] = terrainH(x, z, 1) + rr(1.5, 4);
    st[o + 3] = rr(0, TAU); st[o + 4] = 0; st[o + 5] = 0; st[o + 6] = rr(0, TAU); st[o + 7] = 0.3; st[o + 8] = 0; st[o + 9] = 0;
    G.sc[i] = rr(0.8, 1.1);
    G.ax[i] = x; G.az[i] = z;
    flapjackGoal(G, i);
  }
}
function flapjackGoal(G, i) {
  const a = rr(0, TAU), r = rr(3, 12);
  G.gx[i] = G.ax[i] + Math.cos(a) * r; G.gz[i] = G.az[i] + Math.sin(a) * r; G.gh[i] = rr(1.2, 4.5); G.gt[i] = rr(10, 20);
}
function flapjackStep(G) {
  const st = G.st, dt = STEP;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    let x = st[o], y = st[o + 1], z = st[o + 2], h = st[o + 3];
    G.gt[i] -= dt;
    const gdx = G.gx[i] - x, gdz = G.gz[i] - z;
    if (G.gt[i] <= 0 || gdx * gdx + gdz * gdz < 2) flapjackGoal(G, i);
    const px = x - _pp.x, py = y - _pp.y, pz = z - _pp.z, pd = Math.sqrt(px * px + py * py + pz * pz);
    const scared = pd < 6;
    let want = scared ? Math.atan2(-pz, px) : Math.atan2(-gdz, gdx);
    rockPush(x, y, z, 1.0, true); if (_prox > 0.25) want = Math.atan2(-_v.z, _v.x);
    h = turnTo(h, want, 0.8 * dt);
    // thrust rides the umbrella's contraction: fast squeeze, slow relax
    const rate = scared ? 1.4 : 0.55;
    st[o + 6] += dt * rate * TAU;
    if (st[o + 6] > 6283) st[o + 6] -= 6283;
    const ph = (st[o + 6] / TAU) % 1;
    const c = ph < 0.28 ? 0.5 - 0.5 * Math.cos(ph * 11.2199) : 0.5 + 0.5 * Math.cos((ph - 0.28) * 4.3633);
    const speed = (0.15 + c * 0.9) * (scared ? 2 : 1);
    x += Math.cos(h) * speed * dt; z += -Math.sin(h) * speed * dt;
    const floor = terrainH(x, z, 1);
    const ty = Math.max(floor + G.gh[i], rockRoof(x, y, z, 1) + 1);
    const vy = clamp((ty - y) * 0.5, -0.6, 0.6);
    y += vy * dt;
    st[o] = x; st[o + 1] = y; st[o + 2] = z; st[o + 3] = h;
    st[o + 4] += (clamp(vy * 0.4 - 0.15, -0.5, 0.3) - st[o + 4]) * Math.min(1, dt * 2);
    st[o + 5] += (clamp(_turn / dt * 1.2, -0.3, 0.3) - st[o + 5]) * Math.min(1, dt * 2);
    st[o + 7] = scared ? 1 : 0.4;
  }
}

// ---- ISOPOD: walks the crust at the chimney feet in bouts; freezes near Sal. ----
function isopodLayout(G) {
  const st = G.st;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    const v = activeVents.length ? activeVents[Math.floor(rr(0, activeVents.length)) % activeVents.length] : null;
    const a = rr(0, TAU), r = v ? v.baseR + rr(1.0, 5.0) : rr(20, 90);
    const x = (v ? v.x : 0) + Math.cos(a) * r, z = (v ? v.z : 0) + Math.sin(a) * r;
    st[o] = x; st[o + 2] = z; st[o + 1] = terrainH(x, z, 1) + 0.02;
    st[o + 3] = rr(0, TAU); st[o + 4] = 0; st[o + 5] = 0; st[o + 6] = rr(0, TAU); st[o + 7] = 0; st[o + 8] = 0; st[o + 9] = 0;
    G.sc[i] = rr(0.9, 1.5);
    G.ax[i] = v ? v.x : x; G.az[i] = v ? v.z : z; G.ar[i] = v ? v.baseR : 0;
    G.mode[i] = 0; G.mt[i] = rr(1, 9);
  }
}
function isopodStep(G) {
  const st = G.st, dt = STEP;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    let x = st[o], y = st[o + 1], z = st[o + 2], h = st[o + 3];
    const px = x - _pp.x, py = y - _pp.y, pz = z - _pp.z;
    const frozen = px * px + py * py + pz * pz < 16;
    G.mt[i] -= dt;
    if (G.mt[i] <= 0) {
      if (G.mode[i] === 0) { G.mode[i] = 1; G.mt[i] = rr(3, 7); G.gh[i] = h + rr(-1.2, 1.2); }
      else { G.mode[i] = 0; G.mt[i] = rr(5, 12); }
    }
    const walking = G.mode[i] === 1 && !frozen;
    if (walking) {
      h = turnTo(h, G.gh[i], 0.6 * dt);
      const speed = 0.32;
      const nx = x + Math.cos(h) * speed * dt, nz = z + -Math.sin(h) * speed * dt;
      // stay on the crust ring around the chimney, out of its base
      const vx = nx - G.ax[i], vz = nz - G.az[i], vd = Math.sqrt(vx * vx + vz * vz);
      if (vd < G.ar[i] + 0.8 || vd > G.ar[i] + 9 || rockPush(nx, y, nz, 0.2, false) > 0) { G.gh[i] = h + Math.PI + rr(-0.6, 0.6); }
      else { x = nx; z = nz; }
    }
    y = terrainH(x, z, 1) + 0.02;
    st[o] = x; st[o + 1] = y; st[o + 2] = z; st[o + 3] = h;
    st[o + 7] += ((walking ? 1 : 0) - st[o + 7]) * Math.min(1, dt * 5);
    st[o + 6] += dt * (walking ? 5.5 : 0);
    if (st[o + 6] > 6283) st[o + 6] -= 6283;
  }
}

// ---- ANGLER: hangs in the dark. Turns to face the diver, keeps its distance,
// the mouth yawns now and then, the lure breathes. ----
function anglerLayout(G) {
  const st = G.st;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN, a = rr(0, TAU), r = rr(25, 110);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    st[o] = x; st[o + 2] = z; st[o + 1] = terrainH(x, z, 2) + rr(4, 14);
    st[o + 3] = rr(0, TAU); st[o + 4] = 0; st[o + 5] = 0; st[o + 6] = rr(0, TAU); st[o + 7] = 0.2; st[o + 8] = 0.05; st[o + 9] = 1;
    G.sc[i] = rr(0.9, 1.2);
    G.mt[i] = rr(6, 14); G.mode[i] = 0; G.ph[i] = rr(0, TAU);
    anglerGoal(G, i, x, z);
  }
}
function anglerGoal(G, i, x, z) {
  const a = rr(0, TAU), r = rr(6, 22);
  G.gx[i] = clamp(x + Math.cos(a) * r, -WORLD_R * 0.7, WORLD_R * 0.7); G.gz[i] = clamp(z + Math.sin(a) * r, -WORLD_R * 0.7, WORLD_R * 0.7); G.gh[i] = rr(3, 16); G.gt[i] = rr(16, 30);
}
function anglerStep(G) {
  const st = G.st, dt = STEP;
  for (let i = 0; i < G.n; i++) {
    const o = i * STN;
    let x = st[o], y = st[o + 1], z = st[o + 2], h = st[o + 3];
    G.gt[i] -= dt;
    const gdx = G.gx[i] - x, gdz = G.gz[i] - z;
    if (G.gt[i] <= 0 || gdx * gdx + gdz * gdz < 4) anglerGoal(G, i, x, z);
    const px = x - _pp.x, py = y - _pp.y, pz = z - _pp.z, pd = Math.sqrt(px * px + py * py + pz * pz);
    let want = Math.atan2(-gdz, gdx), speed = 0.45;
    if (pd < 22) {
      // face the light; hold ~9 units off; back away from a diver who closes
      want = Math.atan2(pz, -px);
      speed = pd < 8 ? -0.5 : (pd > 11 ? 0.25 : 0.0);
    }
    rockPush(x, y, z, 1.2, true); if (_prox > 0.25) { want = Math.atan2(-_v.z, _v.x); speed = 0.6; }
    h = turnTo(h, want, 0.5 * dt);
    x += Math.cos(h) * speed * dt; z += -Math.sin(h) * speed * dt;
    const floor = terrainH(x, z, 2);
    const ty = clamp(Math.max(floor + G.gh[i], rockRoof(x, y, z, 1.5) + 1.5), floor + 2, zoneTop(2) - 15);
    const vy = clamp((ty - y) * 0.3, -0.4, 0.4);
    y += vy * dt;
    // the yawn
    G.mt[i] -= dt;
    if (G.mt[i] <= 0) { if (G.mode[i] === 0) { G.mode[i] = 1; G.mt[i] = rr(1.0, 2.2); } else { G.mode[i] = 0; G.mt[i] = rr(7, 16); } }
    const gT = G.mode[i] === 1 ? 1 : 0.06;
    st[o + 8] += (gT - st[o + 8]) * Math.min(1, dt * (G.mode[i] === 1 ? 2.5 : 1.2));
    st[o] = x; st[o + 1] = y; st[o + 2] = z; st[o + 3] = h;
    st[o + 4] += (clamp(vy * 0.6, -0.4, 0.4) - st[o + 4]) * Math.min(1, dt * 2);
    st[o + 5] += (clamp(_turn / dt * 0.8, -0.25, 0.25) - st[o + 5]) * Math.min(1, dt * 2);
    st[o + 7] += (clamp(Math.abs(speed) * 1.2 + 0.15, 0.15, 1) - st[o + 7]) * Math.min(1, dt * 2);
    st[o + 6] += dt * (1.5 + st[o + 7] * 3);
    if (st[o + 6] > 6283) st[o + 6] -= 6283;
    // the lure: a slow breath, dimmer while the diver is close (it is not for him)
    st[o + 9] = (0.55 + 0.45 * Math.sin(uTime.value * 0.5 + G.ph[i])) * (pd < 6 ? 0.35 : 1);
  }
}

// ---- GULPER: a long slow ribbon of a thing; the mouth opens over seconds. ----
function gulperLayout(G) {
  const st = G.st, a = rr(0, TAU), r = rr(30, 100);
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  st[0] = x; st[2] = z; st[1] = terrainH(x, z, 2) + rr(10, 30);
  st[3] = rr(0, TAU); st[4] = 0; st[5] = 0; st[6] = rr(0, TAU); st[7] = 0.5; st[8] = 0.1; st[9] = 1;
  G.sc[0] = rr(0.95, 1.15);
  G.mt[0] = rr(4, 12); G.mode[0] = 0;
  gulperGoal(G);
}
function gulperGoal(G) {
  const a = rr(0, TAU), r = rr(25, 120);
  G.gx = Math.cos(a) * r; G.gz = Math.sin(a) * r; G.gh = rr(8, 34); G.gt = rr(20, 40);
}
function gulperStep(G) {
  const st = G.st, dt = STEP;
  let x = st[0], y = st[1], z = st[2], h = st[3];
  G.gt -= dt;
  const gdx = G.gx - x, gdz = G.gz - z;
  if (G.gt <= 0 || gdx * gdx + gdz * gdz < 36) gulperGoal(G);
  let want = Math.atan2(-gdz, gdx);
  const px = x - _pp.x, pz = z - _pp.z, pd = Math.hypot(px, pz);
  if (pd < 7) want = Math.atan2(-pz, px);
  rockPush(x, y, z, 2, true); if (_prox > 0.25) want = Math.atan2(-_v.z, _v.x);
  h = turnTo(h, want, 0.22 * dt);
  const speed = 1.1;
  x += Math.cos(h) * speed * dt; z += -Math.sin(h) * speed * dt;
  const floor = terrainH(x, z, 2);
  const ty = clamp(Math.max(floor + G.gh, rockRoof(x, y, z, 3) + 3), floor + 4, zoneTop(2) - 15);
  const vy = clamp((ty - y) * 0.3, -0.5, 0.5);
  y += vy * dt;
  G.mt[0] -= dt;
  if (G.mt[0] <= 0) { if (G.mode[0] === 0) { G.mode[0] = 1; G.mt[0] = rr(3, 5); } else { G.mode[0] = 0; G.mt[0] = rr(9, 18); } }
  st[8] += ((G.mode[0] === 1 ? 1 : 0.08) - st[8]) * Math.min(1, dt * 0.9);
  st[0] = x; st[1] = y; st[2] = z; st[3] = h;
  st[4] += (clamp(vy * 0.5, -0.3, 0.3) - st[4]) * Math.min(1, dt * 1.5);
  st[5] += (clamp(_turn / dt * 1.5, -0.35, 0.35) - st[5]) * Math.min(1, dt * 1.2);
  st[7] = 0.55;
  st[6] += dt * 1.9;
  if (st[6] > 6283) st[6] -= 6283;
  st[9] = 0.5 + 0.5 * Math.sin(uTime.value * 0.4);
}

// ---------------------------------------------------------------------------
// build — once, ever
// ---------------------------------------------------------------------------
let built = false, hidden = false, hold = false;   // hold: dev freeze of the steering (screenshots)
const nearNames = [];

function arrs(n, keys) { const o = {}; for (const k of keys) o[k] = new Float32Array(n); return o; }

export function buildFauna() {
  if (built) return;
  built = true;

  // zone 0
  makeGroup('RAY', 0, 1, rayGeometry(), faunaMaterial({
    rough: 0.62, mot: [0.06, 0.55, 2.6, 0], body: [4, 3, 0.35, 7.3], hinge: [0, 0, 0, 0]
  }), { gx: 0, gz: 0, gh: 8, gt: 0, step: rayStep, layout: rayLayout });

  makeGroup('TURTLE', 0, 2, turtleGeometry(), faunaMaterial({
    rough: 0.8, mot: [0.02, 0, 0, 0.55], body: [2, 1.2, 0.5, 2], hinge: [0, 0, 0.85, 0]
  }), { ...arrs(2, ['gx', 'gz', 'gh', 'gt', 'cyc']), step: turtleStep, layout: turtleLayout });

  makeGroup('MORAY', 0, 3, morayGeometry(), faunaMaterial({
    rough: 0.55, metal: 0.05, mot: [0.10, 0, 0, 0], body: [4.2, 0.6, 1.3, 1], hinge: [0.45, -0.02, 0, 0.55]
  }), { ...arrs(3, ['bx', 'by', 'bz', 'dx', 'dz', 'rr', 'out', 'cyc']), cand: new Int32Array(2048), step: morayStep, layout: morayLayout });

  makeGroup('CRAB', 0, 20, crabGeometry(), faunaMaterial({
    rough: 0.7, mot: [0, 0, 0, 0.09], body: [1, 0, 0, 1], hinge: [0, 0, 0, 0]
  }), { ...arrs(20, ['mt', 'side']), mode: new Int8Array(20), cand: new Int32Array(2048), step: crabStep, layout: crabLayout });

  makeGroup('SEA STAR', 0, 40, starGeometry(), faunaMaterial({ rough: 0.85 }), { stat: true, layout: G => floorLayout(G, 0, 12, 150, 0.0) });
  makeGroup('URCHIN', 0, 30, urchinGeometry(), faunaMaterial({ rough: 0.6, metal: 0.1 }), { stat: true, layout: G => floorLayout(G, 0, 12, 150, 0.0) });

  // zone 1
  makeGroup('VENT FISH', 1, 28, ventfishGeometry(), faunaMaterial({
    rough: 0.5, metal: 0.05, mot: [0.11, 0.18, 3, 0], body: [1.3, 0.5, 4.5, 0.55], hinge: [0, 0, 0, 0]
  }), {
    ...arrs(28, ['ph']), P: new Float32Array(28 * 3), V: new Float32Array(28 * 3), roll: 0, panic: 0,
    radius: 3.2, speed: 2.4, local: 1.6, fear: 9, beat: 9, home: 4, roam: 14, hLo: 2, hHi: 7, ax: 0, az: 0,
    cx: 0, cy: 0, cz: 0, cvx: 0, cvy: 0, cvz: 0, gx: 0, gy: 0, gz: 0, gt: 0,
    step: G => shoalStep(G, 1),
    layout: G => {
      const v = activeVents.length ? activeVents[Math.floor(rr(0, activeVents.length)) % activeVents.length] : null;
      const a = rr(0, TAU);
      G.ax = (v ? v.x : Math.cos(a) * 50); G.az = (v ? v.z : Math.sin(a) * 50);
      const cx = G.ax + Math.cos(a) * 6, cz = G.az + Math.sin(a) * 6;
      shoalLayout(G, cx, cz, terrainH(cx, cz, 1) + 4, 1);
    }
  });

  makeGroup('FLAPJACK', 1, 2, flapjackGeometry(), faunaMaterial({
    rough: 0.62, mot: [0, 0.26, 0.22, 0], body: [1, 0, 0, 1.0], hinge: [0, 0, 0, 0]
  }), { ...arrs(2, ['gx', 'gz', 'gh', 'gt', 'ax', 'az']), step: flapjackStep, layout: flapjackLayout });

  makeGroup('ISOPOD', 1, 10, isopodGeometry(), faunaMaterial({
    rough: 0.55, metal: 0.08, mot: [0, 0, 0, 0.07], body: [1, 0, 0, 1], hinge: [0, 0, 0, 0]
  }), { ...arrs(10, ['mt', 'gh', 'ax', 'az', 'ar']), mode: new Int8Array(10), step: isopodStep, layout: isopodLayout });

  // zone 2
  makeGroup('ANGLER', 2, 2, anglerGeometry(), faunaMaterial({
    rough: 0.75, mot: [0.04, 0.12, 2.5, 0], body: [2.5, 1.0, 1.2, 1.1], hinge: [0.43, 0.0, 1.2, 0.62], glow: 0xd6e6c8, glowI: 1.6
  }), { ...arrs(2, ['gx', 'gz', 'gh', 'gt', 'mt', 'ph']), mode: new Int8Array(2), step: anglerStep, layout: anglerLayout });

  makeGroup('GULPER', 2, 1, gulperGeometry(), faunaMaterial({
    rough: 0.7, mot: [0.28, 0, 0, 0], body: [8.5, 2, 0.9, 1], hinge: [1.23, -0.24, 0, 0.7], glow: 0xa8c8b0, glowI: 0.8
  }), { gx: 0, gz: 0, gh: 10, gt: 0, mt: new Float32Array(1), mode: new Int8Array(1), step: gulperStep, layout: gulperLayout });

  makeGroup('LANTERNFISH', 2, 36, lanternfishGeometry(), faunaMaterial({
    rough: 0.45, metal: 0.15, mot: [0.11, 0.18, 3, 0], body: [1.4, 0.5, 4.5, 0.55], hinge: [0, 0, 0, 0], glow: 0x9fc8c4, glowI: 1.2
  }), {
    ...arrs(36, ['ph']), P: new Float32Array(36 * 3), V: new Float32Array(36 * 3), roll: 0, panic: 0,
    radius: 4, speed: 2.6, local: 1.7, fear: 10, beat: 9, home: 10, roam: 60, hLo: 6, hHi: 30, ax: 0, az: 0,
    cx: 0, cy: 0, cz: 0, cvx: 0, cvy: 0, cvz: 0, gx: 0, gy: 0, gz: 0, gt: 0,
    step: G => shoalStep(G, 2),
    layout: G => {
      const a = rr(0, TAU), r = rr(30, 100);
      G.ax = Math.cos(a) * r; G.az = Math.sin(a) * r;
      shoalLayout(G, G.ax, G.az, terrainH(G.ax, G.az, 2) + rr(8, 20), 2);
    }
  });

  layoutAll();

  // dev surface
  window.__fauna = {
    groups,
    stats: () => groups.map(G => ({ name: G.name, zi: G.zi, n: G.n, tris: G.tris, active: G.active, visible: G.mesh.visible })),
    tris: () => groups.reduce((s, G) => s + G.tris, 0),
    fp: () => {
      // layout fingerprint: FNV-1a over the first instance state of every group
      let h = 0x811c9dc5;
      for (const G of groups) for (let i = 0; i < Math.min(G.n, 4) * STN; i++) {
        const v = Math.round(G.st[i] * 100) | 0;
        h ^= v & 255; h = Math.imul(h, 0x01000193); h ^= (v >>> 8) & 255; h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(16);
    },
    near: faunaNearby,
    hold: v => { hold = !!v; return hold; },
    goto: name => { const G = byName[name]; if (!G) return 'no such animal'; player.pos.set(G.st[0] - 4, G.st[1] + 1, G.st[2]); return G.name; },
    pos: name => { const G = byName[name]; return G ? [G.st[0], G.st[1], G.st[2]] : null; }
  };
}

function layoutAll() {
  _fr = siteParams('fauna').rng;
  for (const G of groups) {
    G.layout(G);
    G.stp.set(G.st);
    pose(G, 1);
  }
  hidden = false;
  acc = 0;
}

// ---------------------------------------------------------------------------
// reseed — in place. No new materials, geometry or growth.
// ---------------------------------------------------------------------------
export function reseedFauna() {
  if (!built) { buildFauna(); return; }
  layoutAll();
}

export function hideFauna() {
  hidden = true;
  for (const G of groups) { G.mesh.visible = false; G.active = false; }
}

// Names of the animals within 25u of the diver (array reused — copy if you keep it).
export function faunaNearby() {
  nearNames.length = 0;
  const px = player.pos.x, py = player.pos.y, pz = player.pos.z;
  for (const G of groups) {
    if (!G.mesh.visible) continue;
    const st = G.st;
    for (let i = 0; i < G.n; i++) {
      const o = i * STN, dx = st[o] - px, dy = st[o + 1] - py, dz = st[o + 2] - pz;
      if (dx * dx + dy * dy + dz * dz < 625) { nearNames.push(G.name); break; }
    }
  }
  return nearNames;
}

// ---------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------
export function updateFauna(dt, t) {
  if (!built || hidden) return;
  // window.__noFauna = A/B kill switch (draw-call / tri / fps deltas): everything hidden, nothing stepped.
  if (window.__noFauna) { for (const G of groups) { if (G.mesh.visible) G.mesh.visible = false; G.active = false; } return; }
  uTime.value = t;
  if (scene.fog) {
    uFogD.value = scene.fog.density;
    uCull.value = Math.min(CULL_MAX, 3.912 / Math.max(scene.fog.density * 1.45, 1e-4));
  }
  const cy = camera.position.y;
  const cull = uCull.value;
  _pp.x = player.pos.x; _pp.y = player.pos.y; _pp.z = player.pos.z;

  // Zone band gate (terrain's rule), then a range gate on the group's centre.
  for (const G of groups) {
    const band = cy < zoneTop(G.zi) + 120 && cy > zoneBottom(G.zi) - 150;
    let vis = band;
    if (band && !G.stat) {
      const st = G.st;
      let cx, cz, r;
      if (G.P) { cx = G.cx; cz = G.cz; r = G.radius * 2 + 20; }
      else { cx = st[0]; cz = st[2]; r = G.n > 1 ? 200 : 10; }
      const dx = cx - camera.position.x, dz = cz - camera.position.z;
      vis = dx * dx + dz * dz < (cull + r) * (cull + r);
    }
    G.active = vis && !G.stat;
    if (G.mesh.visible !== vis) G.mesh.visible = vis;
  }

  // fixed 30 Hz steering, capped so a throttled tab never spirals
  acc = Math.min(acc + dt, STEP * 4);
  while (acc >= STEP) {
    for (const G of groups) if (G.active && !hold) { G.stp.set(G.st); G.step(G); }
    acc -= STEP;
  }
  const k = acc / STEP;
  for (const G of groups) if (G.active) pose(G, k);
}
