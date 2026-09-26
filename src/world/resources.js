// Collectible craft materials: polymer nodules (hose) and bitumen seeps (pump fuel).
// OWNED BY: orchestrator. Deliberately self-contained — it does its own placement rather
// than importing flora's scatter, so concurrent flora work can't destabilise progression.
import * as THREE from 'three';
import { scene, envTexDeep as envTex } from '../core.js';
import { WORLD_R, RIFT_R, riftPos } from '../config.js';
import { V3 } from '../lib/math.js';
import { makeGlow } from '../lib/textures.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainH } from './terrain.js';
import { collect } from '../systems/survival.js';
import { siteParams } from './site.js';

// RESPAWN: 55 s meant a lump came back before the diver had left its sight, so salvage
// was never scarce and the hose was ground out in one sitting. Four minutes is longer
// than a round trip to the raft, so a floor picked clean STAYS clean for the dive that
// picked it, and comes back for the next. Scaled per-kind by the site's scarcity dial.
const RESPAWN = 240;
const N_POLYMER = 11, N_BITUMEN = 9;   // site-0 base counts — verbatim shipped values
export const nodes = [];

// ---------------------------------------------------------------------------
// Deterministic PRNG — mulberry32 via siteParams('resources').rng, drawn fresh on every
// build/reseed (site.js's own stream() factory). `rnd` is a `let` reassigned per build,
// never a counter this module owns, so a reseed can never resume mid-stream from a stale
// cursor. Site 0's seed is 0xC0FFEE01 and every draw below happens in the exact order the
// shipped Math.random()-driven version did, so site 0 grows the SHIPPED field.
// ---------------------------------------------------------------------------
let rnd = null;
const rr = (a, b) => a + rnd() * (b - a);

// Scarcity-scaled per-kind respawn seconds — recomputed on every build/reseed from the
// current site's scarcity dial. Site 0's dial is 1/1, so this equals RESPAWN exactly.
let respawnPolymer = RESPAWN, respawnBitumen = RESPAWN;

function place(zi, count, minR, maxR) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const a = rnd() * Math.PI * 2, r = rr(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rp = riftPos(zi);
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 2.6) continue;
    out.push(V3(x, terrainH(x, z, zi), z));
  }
  return out;
}

// ---------------------------------------------------------------------------
// POLISH-PROPS (2026-09-25): the nodes are GENERATED forms, not stacked primitives.
// Every node's shape is a pure function of the exact draws the shipped spheres spent
// (polymer 16, bitumen 12, same order), so the resource stream — and every position,
// phase and respawn it seeds — is unchanged. Each node owns one merged geometry (built
// from those draws, disposed on reseed as before); the two materials are created once,
// ever, so a reseed is still zero recompiles. Node layout: children[0] the mesh, the
// LAST child the glow sprite (updateResources reads it).
// ---------------------------------------------------------------------------
let polymerMat = null, bitumenMat = null;

// Tiny deterministic helpers for the shape detail below — seeded from the node's own
// draws, never from the stream (the stream spends exactly what it always spent).
function _mix32(a) {
  let s = a | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function _h3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function _n3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const s = t => t * t * (3 - 2 * t), u = s(x - X), v = s(y - Y), w = s(z - Z);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(_h3(X, Y, Z), _h3(X + 1, Y, Z), u), L(_h3(X, Y + 1, Z), _h3(X + 1, Y + 1, Z), u), v),
    L(L(_h3(X, Y, Z + 1), _h3(X + 1, Y, Z + 1), u), L(_h3(X, Y + 1, Z + 1), _h3(X + 1, Y + 1, Z + 1), u), v), w);
}

// Shared GLSL: value noise and a 2D/3D cell field on the node's LOCAL position (a node
// never rotates, so local == world minus an offset and the detail is stable).
const RES_GLSL = `
varying vec3 vResP; varying vec3 vResA;
float resH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float resN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(resH(i), resH(i + vec3(1,0,0)), f.x), mix(resH(i + vec3(0,1,0)), resH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(resH(i + vec3(0,0,1)), resH(i + vec3(1,0,1)), f.x), mix(resH(i + vec3(0,1,1)), resH(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 resCell(vec3 p) {
  vec3 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(resH(i + g), resH(i + g + 17.1), resH(i + g + 31.7));
    vec3 r = g + o - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = resH(i + g + 5.3); } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
// surface-gradient bump from a fragment height (screen derivatives, no tangents)
vec3 resBump(vec3 n, float h, float k) {
  vec3 p = -vViewPosition, dx = dFdx(p), dy = dFdy(p), r1 = cross(dy, n), r2 = cross(n, dx);
  float det = dot(dx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g * k);
}`;

function resMat(kind, o) {
  const m = new THREE.MeshStandardMaterial(o);
  m.defines = { [kind]: 1 };
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRes;\nvarying vec3 vResP; varying vec3 vResA;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvResP = position; vResA = aRes;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + RES_GLSL)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + RES_FS_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + RES_FS_SURF);
  };
  m.customProgramCacheKey = () => 'res|' + kind;
  return m;
}

// Fragment body. Order matters: the normal chunk runs BEFORE the emissive chunk in the
// standard shader, so the bump written here is what the surface terms below read.
const RES_FS_NORMAL = `
float resFine = 1.0 - smoothstep(0.004, 0.02, length(fwidth(vResP)));
#ifdef POLY
  // RIND: a thin cured skin crazed into polygons (cell edges), lifted where it curls;
  // the waxy flesh between reads smooth. Relief fades out with range.
  // the crazing lives in patches (old cured skin), never as an even tile over the lobe
  vec3 rq = vResP * 13.0 + (vec3(resN(vResP * 4.0), resN(vResP * 4.0 + 9.1), resN(vResP * 4.0 + 3.3)) - 0.5) * 2.2;
  vec3 rc = resCell(rq);
  float cm = smoothstep(0.48, 0.72, resN(vResP * 2.6 + 7.0));
  float craze = (1.0 - smoothstep(0.015, 0.06, rc.y - rc.x)) * cm;
  float blist = smoothstep(0.62, 0.9, resN(vResP * 17.0 + 2.0));
  float rindH = (resN(vResP * 23.0) - 0.5) * 0.004 + blist * 0.0025 - craze * 0.0025 * (1.0 - vResA.x);
  normal = resBump(normal, rindH * resFine, 1.0);
#endif
#ifdef TAR
  // CRUST: plates broken by a crack net (cells in the plane), each plate domed and
  // tilted, its edges curled down into the cracks. The pool (vResA.x = 0) is glass
  // smooth but carries the frozen gas bubbles as domes, and one pops open as a crater.
  vec2 tq = vResP.xz * 6.5 + (vec2(resN(vResP * 4.0), resN(vResP * 4.0 + 5.5)) - 0.5) * 0.7;
  vec3 tc = resCell(vec3(tq, 0.5));
  float crackW = 1.0 - smoothstep(0.008, 0.04, tc.y - tc.x);
  float plate = (1.0 - tc.x * 0.9) * 0.012 + (resN(vResP * 31.0) - 0.5) * 0.004;
  vec3 bc = resCell(vec3(vResP.xz * 11.0, 3.7));
  float bub = (1.0 - smoothstep(0.0, 0.34, bc.x)) * step(0.55, bc.z);
  float crustK = vResA.x;
  float tarH = mix(bub * bub * 0.012, plate - crackW * 0.02, crustK);
  normal = resBump(normal, tarH * resFine, 1.0);
#endif`;

const RES_FS_SURF = `
{
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  float NdV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
#ifdef POLY
  // wax: the flesh is pale jade and translucent-looking (a view-facing depth term plus a
  // bright waxy rim), the rind a darker cured skin in the crazing, silt in the crevices
  float lobe = vResA.y, crev = vResA.x;
  vec3 flesh = mix(vec3(0.10, 0.30, 0.22), vec3(0.22, 0.36, 0.16), lobe) * (0.8 + 0.4 * resN(vResP * 5.0 + 1.7));
  vec3 rind = flesh * vec3(0.45, 0.42, 0.34);
  float skin = cm * 0.55 + 0.3 * smoothstep(0.5, 0.9, resN(vResP * 6.0));
  vec3 alb = mix(flesh, rind, clamp(craze * 0.9 + skin * 0.5, 0.0, 1.0));
  float dust = clamp(crev * 1.4 + smoothstep(0.55, 0.95, wN.y) * 0.25, 0.0, 1.0);
  alb = mix(alb, vec3(0.16, 0.19, 0.18), dust * 0.85);
  diffuseColor.rgb = alb;
  roughnessFactor = mix(mix(0.28, 0.62, max(craze, skin * 0.6)), 0.95, dust);
  // inner glow: strongest where the eye looks INTO the thick of a lobe, dying in the
  // crevices and under the dust; the rim adds the wax's bright translucent edge
  float thick = pow(NdV, 1.6);
  float rim = pow(1.0 - NdV, 3.0);
  totalEmissiveRadiance = emissive * (0.25 + 0.75 * thick) * (1.0 - 0.8 * dust) * (1.0 - 0.45 * craze)
    + flesh * rim * 0.35 * (1.0 - dust);
#endif
#ifdef TAR
  float sul = vResA.z;
  vec3 tar = vec3(0.0035, 0.0030, 0.0027);
  vec3 crust = mix(vec3(0.008, 0.007, 0.006), vec3(0.018, 0.015, 0.012), resN(vResP * 13.0)) * (0.7 + 0.6 * tc.z);
  float silt = smoothstep(0.6, 0.95, wN.y) * smoothstep(0.4, 0.8, resN(vResP * 7.0 + 4.0));
  crust = mix(crust, vec3(0.030, 0.032, 0.030), silt * 0.4);                            // silt on the plate tops
  vec3 alb = mix(tar, crust, crustK * (1.0 - crackW));
  // sulphur: a crystalline yellow bloom on the rim, patchy, pooled in the cracks' lips
  float sp = sul * smoothstep(0.45, 0.8, resN(vResP * 9.0 + 3.0) * 0.8 + resN(vResP * 23.0) * 0.3 + crackW * 0.3);
  alb = mix(alb, vec3(0.13, 0.10, 0.012), sp * 0.85);
  alb = mix(alb, vec3(0.05, 0.022, 0.006), sul * 0.35 * (1.0 - sp));                   // iron-orange halo
  diffuseColor.rgb = alb;
  // glossy wet tar in the pool and down every crack, dry dusty crust on the plates
  roughnessFactor = mix(0.07, mix(0.86, 0.95, sp), crustK * (1.0 - crackW));
  roughnessFactor = mix(roughnessFactor, 0.03, (1.0 - crustK) * bub);
  // bubbles: a faint trapped-gas sheen under the glaze
  diffuseColor.rgb += vec3(0.015, 0.012, 0.008) * bub * (1.0 - crustK);
  totalEmissiveRadiance = emissive * (0.3 + 0.7 * crackW * crustK) * (1.0 - sp);
#endif
}`;

// ---- POLYMER: a smooth union of the four shipped bladders plus budding sub-lobes -----
// The four (s, sy, x, z) draws are the four lobes, exactly as the spheres used them.
// Each vertex of a geodesic sphere is pushed out along its ray to the smooth-union
// surface (log-sum-exp of the lobes' normalised field), so lobes flow together with
// fillets and CREVICES; the crevice depth (how contested the vertex is between lobes)
// is written to aRes.x for the silt, the owning lobe's tone to aRes.y.
function polymerGeo(L) {
  const r = _mix32(Math.floor(L[0].s * 1e6) ^ Math.floor(L[1].x * 1e6 + 7e5));
  const lobes = L.map(o => ({ cx: o.x * 1.05, cy: o.s * 0.62 * o.sy, cz: o.z * 1.05, rx: o.s, ry: o.s * o.sy, rz: o.s * (0.85 + 0.3 * r()), t: r() }));
  // two or three small buds riding the bigger lobes (a nodule grows by budding)
  for (let k = 0, n = 2 + (r() * 2 | 0); k < n; k++) {
    const p = lobes[r() * 4 | 0], a = r() * Math.PI * 2, e = 0.2 + r() * 0.9, br = p.rx * (0.3 + 0.2 * r());
    lobes.push({ cx: p.cx + Math.cos(a) * Math.cos(e) * p.rx * 0.85, cy: p.cy + Math.sin(e) * p.ry * 0.8, cz: p.cz + Math.sin(a) * Math.cos(e) * p.rz * 0.85, rx: br, ry: br * 0.9, rz: br, t: r() });
  }
  const K = 15;  // union sharpness: larger = tighter crevices
  const field = (x, y, z, out) => {
    let sum = 0, best = -1, bi = 0, second = -1;
    for (let k = 0; k < lobes.length; k++) {
      const l = lobes[k];
      const dx = (x - l.cx) / l.rx, dy = (y - l.cy) / l.ry, dz = (z - l.cz) / l.rz;
      const f = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz);          // >0 inside
      sum += Math.exp(K * f);
      if (f > best) { second = best; best = f; bi = k; } else if (f > second) second = f;
    }
    if (out) { out[0] = bi; out[1] = best - second; }
    return Math.log(sum) / K;
  };
  // Rays are cast from the lobes' mean centre; if the lobes sprawl so far apart that the
  // mean falls outside the union, from the biggest lobe's centre instead.
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < 4; k++) { cx += lobes[k].cx / 4; cy += lobes[k].cy / 4; cz += lobes[k].cz / 4; }
  if (field(cx, cy, cz) < 0.08) {
    let big = lobes[0];
    for (let k = 1; k < 4; k++) if (lobes[k].rx * lobes[k].ry > big.rx * big.ry) big = lobes[k];
    cx = big.cx; cy = big.cy; cz = big.cz;
  }
  // weld FIRST (three's icosahedron is non-indexed: 6x the vertices) so every surface
  // point is solved once
  const g0 = new THREE.IcosahedronGeometry(1, 5);
  g0.deleteAttribute('normal'); g0.deleteAttribute('uv');
  const g = mergeVertices(g0, 1e-5);
  g0.dispose();
  const p = g.attributes.position, nV = p.count;
  const aRes = new Float32Array(nV * 3), tmp = [0, 0];
  for (let i = 0; i < nV; i++) {
    const dx = p.getX(i), dy = p.getY(i), dz = p.getZ(i);
    // march in from outside to the outermost crossing, then bisect
    let hi = 2.0, lo = 0;
    for (let t = 2.0; t > 0; t -= 0.12) if (field(cx + dx * t, cy + dy * t, cz + dz * t) > 0) { lo = t; hi = t + 0.12; break; }
    for (let it = 0; it < 10; it++) { const m = (lo + hi) / 2; if (field(cx + dx * m, cy + dy * m, cz + dz * m) > 0) lo = m; else hi = m; }
    let x = cx + dx * lo, y = cy + dy * lo, z = cz + dz * lo;
    field(x, y, z, tmp);
    // a little lumpy growth over the whole skin (cheap, low octave)
    const bump = 1 + 0.05 * (_n3(x * 5 + 3, y * 5, z * 5) - 0.5);
    x = cx + (x - cx) * bump; y = cy + (y - cy) * bump; z = cz + (z - cz) * bump;
    y = Math.max(y, -0.06 + 0.04 * _n3(x * 6, 1, z * 6));   // bedded: the base presses flat into the silt
    p.setXYZ(i, x, y, z);
    aRes[i * 3] = Math.max(0, 1 - tmp[1] / 0.12) * (y < 0.05 ? 1 : 0.8) + (y < 0.03 ? 0.6 : 0);
    aRes[i * 3 + 1] = lobes[tmp[0]].t;
    aRes[i * 3 + 2] = 0;
  }
  g.setAttribute('aRes', new THREE.BufferAttribute(aRes, 3));
  g.computeVertexNormals();
  return g;
}

// Drape a node onto the seabed it sits on: each vertex follows the terrain's offset
// from the node's own origin, fully at the base and fading out by `fade` units up (0 =
// everywhere: the seep is a skin on the silt). Build-time only.
function drape(g, at, zi, fade) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = fade > 0 ? Math.max(0, 1 - Math.max(0, y) / fade) : 1;
    p.setY(i, y + (terrainH(at.x + x, at.z + z, zi) - at.y) * k);
  }
  g.computeVertexNormals();
  return g;
}

function polymerMesh(at, zi) {
  if (!polymerMat) polymerMat = resMat('POLY', {
    color: 0xffffff, roughness: 0.45, metalness: 0.0,
    emissive: 0x1a5f4a, emissiveIntensity: 0.7, envMap: envTex, envMapIntensity: 0.35
  });
  const g = new THREE.Group();
  // The shipped draws, in the shipped order: s, scale.y, x, z per bladder.
  const L = [];
  for (let i = 0; i < 4; i++) { const s = rr(0.35, 0.62), sy = rr(0.7, 1.3), x = rr(-0.5, 0.5), z = rr(-0.5, 0.5); L.push({ s, sy, x, z }); }
  g.add(new THREE.Mesh(drape(polymerGeo(L), at, zi, 0.55), polymerMat));
  g.add(makeGlow(0x5fffcf, 3.2));
  return g;
}

// ---- BITUMEN: a seep as ONE draped height field on a polar grid ----------------------
// Radius ~1.35: a glossy pool in the middle, a rim of cracked crust plates lifted round
// it (the crust's lip curls up over the pool's edge), the outer skirt feathering into
// the silt with a sulphur bloom. The three shipped blob draws (r, x, y, z) become the
// three big frozen gas blisters in the pool (x,z = where, r = how big, y = how proud).
// aRes: x = crust (0 pool .. 1 plate), y = unused, z = sulphur.
function bitumenGeo(B) {
  const r = _mix32(Math.floor(B[0].r * 1e7) ^ Math.floor(B[2].x * 1e6 + 3e5));
  const R = 1.35, RINGS = 8, SEG = 32;
  const poolR = 0.55 + 0.12 * r(), lip = 0.06 + 0.04 * r(), sd = r() * 50;
  const pos = [], ares = [], idx = [];
  const H = (x, z) => {
    const rr0 = Math.hypot(x, z), a = Math.atan2(z, x);
    const edge = poolR * (1 + 0.16 * (_n3(Math.cos(a) * 1.7 + sd, Math.sin(a) * 1.7, 0.5) - 0.5) * 2);
    const u = (rr0 - edge) / (R - edge);                 // 0 at the pool edge, 1 at the rim
    let h, crust;
    if (u < 0) {
      h = 0.035;
      for (const b of B) {                               // the three blisters
        const d = Math.hypot(x - b.x * 0.7, z - b.z * 0.7) / (b.r * 0.9);
        if (d < 1) h += (1 - d * d) * (1 - d * d) * b.r * (0.18 + 0.22 * b.y);
      }
      crust = 0;
    } else {
      // crust: lifted lip at the pool edge, a plateau of plates, a feathered skirt
      const lipK = Math.exp(-u * 7);
      const plates = 0.10 + 0.07 * (_n3(x * 3.1 + sd, 0.3, z * 3.1) - 0.5) * 2;
      h = (lipK * lip + plates) * (1 - Math.pow(Math.max(0, u - 0.55) / 0.45, 1.6)) + 0.035 * (1 - u);
      crust = Math.min(1, u * 12);
    }
    return [Math.max(-0.02, h), crust, Math.max(0, Math.min(1, (u - 0.72) / 0.2)) * Math.max(0, _n3(x * 2.3 + 9, 0, z * 2.3) * 1.8 - 0.5)];
  };
  pos.push(0, H(0, 0)[0], 0); ares.push(0, 0, 0);
  for (let i = 1; i <= RINGS; i++) {
    const rad = R * Math.pow(i / RINGS, 0.85);
    for (let j = 0; j < SEG; j++) {
      const a = j / SEG * Math.PI * 2 + (i & 1) * Math.PI / SEG;
      const wob = i === RINGS ? 1 + 0.08 * (_n3(Math.cos(a) * 2 + sd, Math.sin(a) * 2, 2) - 0.5) * 2 : 1;
      const x = Math.cos(a) * rad * wob, z = Math.sin(a) * rad * wob;
      const [h, c, s] = H(x, z);
      pos.push(x, i === RINGS ? -0.03 : h, z); ares.push(c, 0, Math.min(1, s));
    }
  }
  for (let j = 0; j < SEG; j++) idx.push(0, 1 + (j + 1) % SEG, 1 + j);
  for (let i = 1; i < RINGS; i++) {
    const a0 = 1 + (i - 1) * SEG, a1 = 1 + i * SEG;
    for (let j = 0; j < SEG; j++) {
      const j1 = (j + 1) % SEG;
      idx.push(a0 + j, a0 + j1, a1 + j1, a0 + j, a1 + j1, a1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRes', new THREE.Float32BufferAttribute(ares, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function bitumenMesh(at, zi) {
  if (!bitumenMat) bitumenMat = resMat('TAR', {
    color: 0xffffff, roughness: 0.25, metalness: 0.0,
    emissive: 0x3a1c06, emissiveIntensity: 0.35, envMap: envTex, envMapIntensity: 0.7
  });
  const g = new THREE.Group();
  // The shipped draws, in the shipped order: radius, x, y, z per blob.
  const B = [];
  for (let i = 0; i < 3; i++) { const r = rr(0.14, 0.26), x = rr(-0.5, 0.5), y = rr(0.2, 0.7), z = rr(-0.5, 0.5); B.push({ r, x, y: (y - 0.2) / 0.5, z }); }
  g.add(new THREE.Mesh(drape(bitumenGeo(B), at, zi, 0), bitumenMat));
  g.add(makeGlow(0xffa64d, 1.8));
  return g;
}

// The shared placement pipeline both buildResources() and reseedResources() run. No
// `built`/state guard here — callers own that — and it never touches polymerMat/
// bitumenMat beyond lazily creating them once.
function growResources(scarcity) {
  const nPolymer = Math.max(1, Math.round(N_POLYMER * scarcity.polymer));
  const nBitumen = Math.max(1, Math.round(N_BITUMEN * scarcity.bitumen));
  respawnPolymer = RESPAWN / scarcity.polymer;
  respawnBitumen = RESPAWN / scarcity.bitumen;

  for (let zi = 0; zi < 3; zi++) {
    for (const p of place(zi, nPolymer, 25, WORLD_R * 0.85)) {
      const m = polymerMesh(p, zi);
      m.position.copy(p);
      scene.add(m);
      nodes.push({ grp: m, kind: 'polymer', alive: true, respawn: 0, ph: rnd() * 7, zi });
    }
    for (const p of place(zi, nBitumen, 25, WORLD_R * 0.8)) {
      const m = bitumenMesh(p, zi);
      m.position.copy(p);
      scene.add(m);
      nodes.push({ grp: m, kind: 'bitumen', alive: true, respawn: 0, ph: rnd() * 7, zi });
    }
  }
}

let built = false;

export function buildResources() {
  if (built) return;
  built = true;
  const sp = siteParams('resources');
  rnd = sp.rng;
  growResources(sp.scarcity);
}

// Tear down every accumulator this module owns and regrow against the current site +
// current terrain. polymerMat/bitumenMat are the two things that must survive untouched
// (zero recompiles); everything else here is a build product.
export function reseedResources() {
  if (!built) { buildResources(); return; }

  for (const n of nodes) {
    scene.remove(n.grp);
    n.grp.traverse(o => {
      if (o.isMesh) o.geometry.dispose();          // unique per-node sphere geo; material is polymerMat/bitumenMat — reused, not touched
      else if (o.isSprite) o.material.dispose();    // per-node SpriteMaterial; its map is lib/textures.js's shared glowTex — never touched
    });
  }
  nodes.length = 0;   // in place — nothing outside this module holds the array reference, but keep the idiom consistent

  const sp = siteParams('resources');   // fresh stream per brief: never reuse one across rebuilds
  rnd = sp.rng;
  growResources(sp.scarcity);
}

// Returns the kind collected this frame, or null.
export function updateResources(dt, t, playerPos) {
  let got = null;
  for (const n of nodes) {
    if (!n.alive) {
      n.respawn -= dt;
      if (n.respawn <= 0) { n.alive = true; n.grp.visible = true; }
      continue;
    }
    const glow = n.grp.children[n.grp.children.length - 1];
    glow.scale.setScalar((n.kind === 'polymer' ? 3.2 : 1.8) * (0.85 + 0.15 * Math.sin(t * 2 + n.ph)));
    if (n.grp.position.distanceTo(playerPos) < 3.2) {
      n.alive = false; n.respawn = n.kind === 'polymer' ? respawnPolymer : respawnBitumen; n.grp.visible = false;
      collect(n.kind);
      got = n.kind;
    }
  }
  return got;
}
