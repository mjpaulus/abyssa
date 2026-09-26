// Seafloor props: sunken timber and cargo. OWNED BY: asset-pipeline agent.
// POLISH-PROPS (2026-09-25): every prop is GENERATED in this file (the hard rule) — the
// two downloaded Kenney glTFs (log.glb, barrel.glb) are gone, and so is the loader.
//
// EXPORTS
//   buildProps() -> Promise<{ loaded, placed }>
//     Awaitable. Generates every entry in MANIFEST (once — cached forever after, see
//     loadAssets()), scatters it per zone with the same idioms flora.js uses
//     (terrainH/terrainNormal sampled at placement, rift funnel kept clear, slope
//     gating), and adds one InstancedMesh per prop per zone.
//   reseedProps() -> Promise<{ loaded, placed }>
//     Same contract, for a site change: never regenerates the props (loadAssets()'s
//     cache), disposes only the placement products (InstancedMeshes + their per-build
//     geometry clones; the per-zone materials are cached forever, so a reseed compiles
//     nothing) and re-places from siteParams('props').rng against the
//     terrain as it now stands. See run()'s gen token for the load-race guard.
//   updateProps(dt, t) — per-zone visibility gating plus one uniform write for sway.
//   propMeshes — the InstancedMeshes created, for diagnostics.
//   propColliders — [{x,y,z,r}] collider list, same shape as flora.js rockColliders.
//     game.js/player.js hold this exact array reference in their collider loops, so the
//     export (and its object identity) must stay — but by curation NO current manifest
//     prop is big enough to block the camera, so nothing pushes into it and it stays
//     empty. If a large prop is ever added, register its colliders here at placement.
//
// ORCHESTRATOR WIRING (game.js):
//   import { buildProps, updateProps } from './world/props.js';
//   buildProps();                 // fire-and-forget: never blocks first frame
//   updateProps(dt, t);           // next to updateFlora(dt, t) in the frame loop
import * as THREE from 'three';
import { scene, camera, envTexDeep as envTex } from '../core.js';
import { WORLD_R, riftPos, zoneTop, zoneBottom } from '../config.js';
import { clamp, fbm } from '../lib/math.js';
import { terrainH, terrainNormal } from './terrain.js';
import { barkSet, staveSet } from '../lib/textures.js';
import { siteParams } from './site.js';

const TAU = Math.PI * 2;
// Rift clearance required by the brief, in world units.
const RIFT_CLEAR = 45;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0), IDQ = new THREE.Quaternion();

// ------------------------------------------------------------------ manifest --
// size = world-unit height range (geometry arrives normalised to 1 unit).
// zones = which zones get it; n = instances per zone; gap = min spacing between them.
// sway  = shader sway amplitude (0 for stone).
// Curation: the two big Kenney rocks are CUT — their hard-faceted style reads worse than
// our smoothed procedural boulders and they kept dominating shots. Logs stay as
// half-buried sunken timber; stumps are cut (they read as land clearance, not seabed).
// Barrels are sunken cargo and fit the fiction.
// POLISH-VENTS (2026-09-25): the last downloaded rock, rock_smallC.glb (16 tris,
// flat-shaded, no maps, 110 per zone), is CUT too. It was the untextured dark hexagon
// in the quality audit and a violation of the generated-only rule; flora.js's pebble
// and boulder tiers (generated rock map set, crust, fillets) already fill the role.
// Removing it shortens the props stream, so the log/barrel scatter re-rolls (still a
// pure function of siteParams('props')); propColliders was empty and stays empty.
// POLISH-PROPS: `file` became `gen` (the builder below); n, gap, size, zones, slope,
// stand and tint are the shipped values, so the stream spends exactly what it did and
// every prop lands where the glTF did. `sink` 0.45 -> 0: the log is 0.24 of its height
// thick, so beding it 0.57 x height put every log's top ~1 u UNDER the silt (none was
// ever visible, measured). At 0 the axis sits on the bed: half-buried timber, as meant.
const MANIFEST = [
  { gen: 'log', n: 32, gap: 9, size: [1.6, 3.4], zones: [0, 1], slope: 0.78, stand: 0.9, tint: 'wood', sway: 0, sink: 0.0 },
  { gen: 'barrel', n: 26, gap: 7, size: [1.1, 2.0], zones: [0, 1, 2], slope: 0.8, stand: 0.65, tint: 'wreck' }
];

// Zone moods lifted from flora.js PAL so props sit in the same muted, lantern-lit palette.
const PAL = [
  { rock: 0x1a2730, wood: 0x2b2a22, wreck: 0x243038, silt: 0x1d2a35 },
  { rock: 0x211b2b, wood: 0x272031, wreck: 0x2a2438, silt: 0x241e33 },
  { rock: 0x2a1f1c, wood: 0x2f231a, wreck: 0x33241f, silt: 0x2b1e19 }
];

// ------------------------------------------------------------------ material --
// One shared uniform block: updateProps() costs two writes regardless of instance count.
const uni = { uTime: { value: 0 }, uCur: { value: new THREE.Vector2(1, 0) } };

const V_HEAD = `
uniform float uTime; uniform vec2 uCur; uniform vec2 uCull; uniform float uSway;
attribute vec2 aInst;   // phase, sway weight
attribute vec2 aUv; attribute vec4 aPM;
varying vec2 vPUv; varying vec4 vPM; varying vec3 vPLoc;`;

const V_BODY = `
#ifdef PROP_SWAY
if (uSway > 0.0) {
  float h = max(transformed.y, 0.0);
  transformed.xz += uCur * (sin(uTime * 0.6 + aInst.x) * 0.5 + 0.5) * uSway * aInst.y * h * h * 0.06;
}
#endif
// weed on the generated log: the tips stream in the current on the prop clock
if (aPM.x > 2.5 && aPM.x < 3.5) {
  float wk = aPM.w * aPM.w;
  transformed.xz += (uCur * (0.6 + 0.4 * sin(uTime * 1.3 + aInst.x + position.x * 37.0)) + vec2(0.3, -0.2) * sin(uTime * 2.1 + position.z * 51.0)) * wk * 0.03;
}
vPUv = aUv; vPM = aPM; vPLoc = position;
vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
transformed *= 1.0 - smoothstep(uCull.x, uCull.y, distance(iw, cameraPosition));`;

// Generated-prop surface (both props, ONE program: the per-kind map set is a sampler
// uniform, the part id per vertex picks the grammar). Normal first (normal chunk),
// colour/roughness after (emissive chunk), then the shipped silt pass.
const F_HEAD = `
uniform vec3 uSilt; uniform sampler2D uPPack, uPNrm; uniform float uTime;
varying vec2 vPUv; varying vec4 vPM; varying vec3 vPLoc;
float ppH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float ppN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ppH(i), ppH(i + vec3(1,0,0)), f.x), mix(ppH(i + vec3(0,1,0)), ppH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ppH(i + vec3(0,0,1)), ppH(i + vec3(1,0,1)), f.x), mix(ppH(i + vec3(0,1,1)), ppH(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 ppBump(vec3 n, float h) {
  vec3 p = -vViewPosition, dx = dFdx(p), dy = dFdy(p), r1 = cross(dy, n), r2 = cross(n, dx);
  float det = dot(dx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}`;

const F_NORMAL = `
float ppPart = floor(vPM.x + 0.5);
bool ppHead = ppPart > 5.5;
vec2 ppUv = ppHead ? vec2(vPUv.y * 3.2, vPUv.x * 0.8) : vPUv;
vec4 ppK = texture2D(uPPack, ppUv);
float ppFine = 1.0 - smoothstep(0.004, 0.03, length(fwidth(vPLoc)));
float ppRing = 0.0;
{
  // map relief in a cotangent frame built from the map's own screen derivatives
  vec3 nm = texture2D(uPNrm, ppUv).xyz * 2.0 - 1.0;
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec2 st0 = dFdx(ppUv), st1 = dFdy(ppUv);
  vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
  vec3 T = q1p * st0.x + q0p * st1.x, Bt = q1p * st0.y + q0p * st1.y;
  float dm = max(dot(T, T), dot(Bt, Bt));
  float sc = dm > 0.0 ? inversesqrt(dm) : 0.0;
  float useMap = (ppPart < 0.5 || (ppPart > 3.5 && ppPart < 4.5) || ppHead) ? 1.0 : 0.0;
  vec3 pn = normalize(T * (nm.x * sc) + Bt * (nm.y * sc) + normal * max(nm.z, 0.2));
  normal = normalize(mix(normal, pn, useMap * 0.9));
  // END GRAIN: growth rings round an off-centre pith, radial drying checks, eroded soft
  if (ppPart > 0.5 && ppPart < 1.5) {
    vec2 c = vPM.yz - vec2(0.08, -0.05);
    float r = length(c), a = atan(c.y, c.x);
    ppRing = sin(r * 58.0 + ppN(vec3(c * 5.0, 1.0)) * 5.0);
    float chk = 1.0 - smoothstep(0.0, 0.05, abs(sin(a * 3.0 + ppN(vec3(c * 3.0, 4.0)) * 2.0)) * (1.2 - r));
    normal = ppBump(normal, (ppRing * 0.0015 - chk * 0.004 * smoothstep(0.15, 0.6, r)) * ppFine);
    ppRing = ppRing * 0.5 + 0.5 - chk * 0.8;
  }
  // RAW WOOD at the snap: fibres along the length
  if (ppPart > 1.5 && ppPart < 2.5) {
    float fib = ppN(vec3(vPLoc.x * 260.0, vPLoc.y * 260.0, vPLoc.z * 12.0));
    normal = ppBump(normal, (fib - 0.5) * 0.003 * ppFine);
    ppRing = fib;
  }
  // IRON: rust pits and scale
  if (ppPart > 4.5 && ppPart < 5.5) {
    float pit = ppN(vPLoc * 90.0) * 0.6 + ppN(vPLoc * 260.0) * 0.4;
    normal = ppBump(normal, (pit - 0.5) * 0.002 * ppFine);
    ppRing = pit;
  }
}`;

const F_BODY = `
{
  vec3 dc = diffuseColor.rgb;                       // the zone tint (instance colour)
  vec3 wN0 = inverseTransformDirection(normal, viewMatrix);
  float alb = ppK.r * 1.4 * (ppPart > 3.5 ? 1.3 : 1.0);
  vec3 col = dc;
  float rgh = 0.9, met = 0.02;
  if (ppPart < 0.5) {
    // bark over sloughed patches of bare, grey, grain-lined wood; an algal film on top
    vec3 bark = dc * alb * vec3(0.95, 0.82, 0.68);
    vec3 bare = dc * alb * vec3(1.55, 1.50, 1.38);
    col = mix(bare, bark, ppK.a);
    float film = smoothstep(0.25, 0.85, wN0.y) * smoothstep(0.35, 0.7, ppN(vPLoc * 9.0));
    col = mix(col, dc * vec3(0.75, 1.35, 0.55) * (0.7 + 0.6 * ppN(vPLoc * 31.0)), film * 0.6);
    rgh = mix(0.6, ppK.g, ppK.a);
  } else if (ppPart < 1.5) {
    col = dc * vec3(1.75, 1.6, 1.32) * (0.72 + 0.4 * ppRing);
    rgh = 0.85;
  } else if (ppPart < 2.5) {
    col = dc * vec3(2.1, 1.85, 1.45) * (0.75 + 0.35 * ppRing) * (0.75 + 0.25 * vPM.w);
    rgh = 0.8;
  } else if (ppPart < 3.5) {
    col = mix(vec3(0.030, 0.050, 0.016), vec3(0.075, 0.068, 0.022), vPM.w) * (0.8 + 0.4 * ppN(vPLoc * 80.0));
    rgh = 0.6;
  } else if (ppPart < 4.5) {
    // staves: grain, seams, per-stave tone; the stove-in staves show raw wood at the break
    // waterlogged oak: the zone hue carried on a warm grey-brown, darkened in the seams
    vec3 oak = mix(dc, vec3(dot(dc, vec3(0.3333))) * vec3(1.45, 1.0, 0.6), 0.7) * 1.0;
    col = oak * alb * (1.0 - 0.55 * ppK.a);
    col = mix(col, dc * vec3(2.0, 1.75, 1.35) * alb, smoothstep(0.3, 0.9, vPM.w) * 0.55);
    rgh = ppK.g;
  } else if (ppPart < 5.5) {
    // hoop iron: flaking rust over a black scale
    float rust = smoothstep(0.35, 0.65, ppN(vPLoc * 40.0) * 0.7 + ppRing * 0.5);
    col = mix(vec3(0.014, 0.013, 0.012), vec3(0.065, 0.030, 0.013) * (0.7 + 0.6 * ppRing), rust);
    rgh = mix(0.55, 0.92, rust); met = mix(0.45, 0.05, rust);
  } else if (ppPart < 6.5) {
    col = mix(dc, vec3(dot(dc, vec3(0.3333))) * vec3(1.25, 1.0, 0.72), 0.6) * 1.3 * alb * (1.0 - 0.5 * ppK.a);
    rgh = ppK.g;
  } else {
    col = dc * 0.35 * (0.4 + 0.6 * vPM.w);          // the inside: silted dark
    rgh = 1.0;
  }
  diffuseColor.rgb = col;
  float wet = 1.0 - smoothstep(4.0, 16.0, length(vViewPosition));
  roughnessFactor = clamp(rgh - wet * 0.18, 0.3, 1.0);
  metalnessFactor = met;
  // Silt settles on upward faces; downward faces fall away into the dark. Same trick
  // flora.js uses on its boulders, so props and procedural rock read as one material.
  float up = inverseTransformDirection(normal, viewMatrix).y;
  diffuseColor.rgb = mix(diffuseColor.rgb, uSilt, smoothstep(0.35, 0.96, up) * 0.45 * (ppPart > 2.5 && ppPart < 3.5 ? 0.0 : 1.0));
  diffuseColor.rgb *= mix(0.42, 1.0, smoothstep(-0.85, 0.2, up));
}`;

// Materials: one per (kind, zone), created once and kept forever (a reseed only
// re-places instances). The two kinds and three zones share ONE program ('prop|gen'):
// only sampler and colour uniforms differ.
const _mats = {};
function propMat(kind, zi, sway) {
  const key = kind + zi;
  if (_mats[key]) return _mats[key];
  const set = kind === 'log' ? barkSet() : staveSet();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.02, envMap: envTex, envMapIntensity: 0.1 });
  m.defines = sway ? { PROP_SWAY: 1 } : {};
  const cull = 175;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni, {
      uCull: { value: new THREE.Vector2(cull * 0.82, cull) },
      uSway: { value: sway || 0 },
      uSilt: { value: new THREE.Color(PAL[zi].silt) },
      uPPack: { value: set.pack }, uPNrm: { value: set.nrm }
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + V_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + V_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + F_HEAD)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + F_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + F_BODY);
  };
  m.customProgramCacheKey = () => 'prop|gen|' + (sway ? 1 : 0);
  _mats[key] = m;
  return m;
}

// ------------------------------------------------------------ generated props --
// POLISH-PROPS (2026-09-25): both props are GENERATED here (the hard rule) — no glTF,
// no image. Each is authored under loadProp()'s old contract (XZ-centred, base at y = 0,
// largest extent = 1 world unit) so the placement code below scales and seats it
// exactly as it did the downloaded file. Attributes: position, normal, aUv (metric-ish
// texture coordinates for the prop's map set) and aPM (x = part id, yz = part-local
// coordinates, w = a part-specific weight). Parts:
//   0 bark   1 end grain   2 raw splintered wood   3 weed   4 stave   5 iron hoop   6 barrel head
//   7 the barrel's dark inside (seen through the burst)
const P_BARK = 0, P_END = 1, P_RAW = 2, P_WEED = 3, P_STAVE = 4, P_HOOP = 5, P_HEAD = 6, P_INNER = 7;

// Deterministic value noise for the shapes (fixed seeds: the props are site-invariant
// shapes; only their PLACEMENT is a function of the site stream).
function _gh(x, y, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function _gn(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const f = t => t * t * (3 - 2 * t), u = f(x - X), v = f(y - Y), w = f(z - Z), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(_gh(X, Y, Z), _gh(X + 1, Y, Z), u), L(_gh(X, Y + 1, Z), _gh(X + 1, Y + 1, Z), u), v),
    L(L(_gh(X, Y, Z + 1), _gh(X + 1, Y, Z + 1), u), L(_gh(X, Y + 1, Z + 1), _gh(X + 1, Y + 1, Z + 1), u), v), w);
}

// A small mesh accumulator: vertices with (pos, uv, pm), triangles by index.
function Acc() {
  const P = [], U = [], M = [], I = [];
  return {
    v(x, y, z, u, v, part, a = 0, b = 0, w = 0) { P.push(x, y, z); U.push(u, v); M.push(part, a, b, w); return P.length / 3 - 1; },
    t(a, b, c) { I.push(a, b, c); },
    q(a, b, c, d) { I.push(a, b, c, a, c, d); },
    qf(a, b, c, d) { I.push(a, d, c, a, c, b); },   // the same quad, wound the other way
    get n() { return P.length / 3; },
    P, U, M, I,
    done(seams) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('aUv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('aPM', new THREE.Float32BufferAttribute(M, 4));
      g.setIndex(I);
      g.computeVertexNormals();
      // UV seams are duplicated vertices: give each pair one shared normal
      const nr = g.attributes.normal;
      for (const [a, b] of seams || []) {
        const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b), l = Math.hypot(x, y, z) || 1;
        nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l);
      }
      return g;
    }
  };
}

// THE WATERLOGGED LOG. Lies along Z (length 1), radius 0.118, base at y = 0. A slow
// banana bend and a taper toward the BROKEN end; the bark surface knobbled by low noise.
// The near end is an old weathered cut (end grain, a rounded arris); the far end snapped
// — a jagged crown of splinters round a torn, recessed crater of raw wood. A branch
// stub, and three tufts of weed on the upper face (their tips sway on the prop clock).
// ~420 triangles.
function logGeo() {
  const A = Acc(), seams = [];
  const NA = 16, NZ = 8, R0 = 0.118, Z0 = -0.5, Z1 = 0.44;
  const axisX = z => 0.022 * Math.sin(Math.PI * (z - Z0));
  const rad = (z, th) => R0 * (1 - 0.13 * (z - Z0)) * (1 + 0.06 * (_gn(Math.cos(th) * 1.3 + 4, Math.sin(th) * 1.3, z * 5) - 0.5) * 2 + 0.03 * (_gn(Math.cos(th) * 3 + 9, Math.sin(th) * 3, z * 11) - 0.5) * 2);
  const ringAt = (z, k, part, w) => {
    const row = [];
    for (let j = 0; j <= NA; j++) {
      const th = (j % NA) / NA * Math.PI * 2, r = rad(z, th) * k;
      row.push(A.v(axisX(z) + Math.cos(th) * r, R0 + Math.sin(th) * r, z, j / NA * 3, (z - Z0) * 2, part, 0, 0, w));
    }
    seams.push([row[0], row[NA]]);
    return row;
  };
  // body
  let prev = null;
  const rows = [];
  for (let i = 0; i <= NZ; i++) {
    const z = Z0 + 0.012 + (Z1 - Z0 - 0.012) * i / NZ;
    const row = ringAt(z, 1, P_BARK, 0);
    if (prev) for (let j = 0; j < NA; j++) A.q(prev[j], prev[j + 1], row[j + 1], row[j]);
    prev = row; rows.push(row);
  }
  // near end: a rounded arris then the end-grain face (own vertices: a hard edge)
  {
    const z = Z0, ar = [], face = [];
    for (let j = 0; j <= NA; j++) {
      const th = (j % NA) / NA * Math.PI * 2, r = rad(z, th) * 0.93;
      ar.push(A.v(axisX(z) + Math.cos(th) * r, R0 + Math.sin(th) * r, z + 0.004, j / NA * 3, 0, P_END, Math.cos(th) * 0.93, Math.sin(th) * 0.93, 1));
    }
    seams.push([ar[0], ar[NA]]);
    for (let j = 0; j < NA; j++) A.qf(rows[0][j], rows[0][j + 1], ar[j + 1], ar[j]);
    const c = A.v(axisX(z), R0, z - 0.004, 0.5, 0, P_END, 0, 0, 1);
    for (let j = 0; j < NA; j++) {
      const th = j / NA * Math.PI * 2, r = rad(z, th) * 0.9;
      face.push(A.v(axisX(z) + Math.cos(th) * r, R0 + Math.sin(th) * r, z, 0, 0, P_END, Math.cos(th) * 0.9, Math.sin(th) * 0.9, 1));
    }
    for (let j = 0; j < NA; j++) {
      A.t(c, face[(j + 1) % NA], face[j]);
      A.q(face[j], face[(j + 1) % NA], ar[j + 1], ar[j]);
    }
  }
  // far end: snapped. A crown of splinters — isolated long spikes between short
  // stubs, so each splinter is a narrow tooth, not a tent — then a torn crater of raw
  // wood that follows the crown partway out, so every splinter has body.
  {
    const crown = [], crater = [], L = [];
    for (let j = 0; j < NA; j++) {
      const h = _gh(j, 7, 3), spike = h > 0.45 && (j === 0 || L[j - 1] < 0.02);
      L.push(spike ? 0.022 + 0.03 * _gh(j, 2, 6) : 0.003 + 0.01 * _gh(j, 9, 1));
    }
    for (let j = 0; j <= NA; j++) {
      const jj = j % NA, th = jj / NA * Math.PI * 2, len = L[jj];
      const r = rad(Z1, th) * (0.97 - (len > 0.02 ? 0.1 * _gh(jj, 1, 9) : 0));
      crown.push(A.v(axisX(Z1) + Math.cos(th) * r, R0 + Math.sin(th) * r, Z1 + len, j / NA * 3, (Z1 + len - Z0) * 2, P_RAW, 0, 0, len / 0.12));
    }
    seams.push([crown[0], crown[NA]]);
    for (let j = 0; j < NA; j++) A.qf(rows[NZ][j], rows[NZ][j + 1], crown[j + 1], crown[j]);
    for (let j = 0; j <= NA; j++) {
      const jj = j % NA, th = jj / NA * Math.PI * 2, r = rad(Z1, th) * (L[jj] > 0.02 ? 0.78 : 0.66);
      crater.push(A.v(axisX(Z1) + Math.cos(th) * r, R0 + Math.sin(th) * r, Z1 + L[jj] * 0.55 + 0.004, j / NA * 3, 0, P_RAW, 0, 0, 0.3));
    }
    for (let j = 0; j < NA; j++) A.qf(crown[j], crown[j + 1], crater[j + 1], crater[j]);
    const c = A.v(axisX(Z1), R0, Z1 - 0.012, 0, 0, P_RAW, 0, 0, 0);
    for (let j = 0; j < NA; j++) A.t(c, crater[j + 1], crater[j]);
  }
  // branch stub on the upper flank
  {
    const z = -0.12, th = 1.1, n = new THREE.Vector3(Math.cos(th), Math.sin(th), 0.35).normalize();
    const base = new THREE.Vector3(axisX(z) + Math.cos(th) * rad(z, th) * 0.8, R0 + Math.sin(th) * rad(z, th) * 0.8, z);
    const t1 = new THREE.Vector3(0, 0, 1).cross(n).normalize(), t2 = n.clone().cross(t1).normalize();
    const S = 6, rings = [];
    for (let k = 0; k < 3; k++) {
      const d = [0, 0.04, 0.07][k], r = [0.036, 0.03, 0.026][k], row = [];
      for (let j = 0; j <= S; j++) {
        const a = (j % S) / S * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * r;
        row.push(A.v(base.x + n.x * d + t1.x * x + t2.x * y, base.y + n.y * d + t1.y * x + t2.y * y, base.z + n.z * d + t1.z * x + t2.z * y,
          j / S, k * 0.2, k < 2 ? P_BARK : P_END, k < 2 ? 0 : Math.cos(a), k < 2 ? 0 : Math.sin(a), 1));
      }
      seams.push([row[0], row[S]]);
      if (rings.length) for (let j = 0; j < S; j++) A.q(rings[rings.length - 1][j], rings[rings.length - 1][j + 1], row[j + 1], row[j]);
      rings.push(row);
    }
    const tip = base.clone().addScaledVector(n, 0.075);
    const c = A.v(tip.x, tip.y, tip.z, 0, 0, P_END, 0, 0, 1);
    for (let j = 0; j < S; j++) A.t(c, rings[2][j], rings[2][j + 1]);
  }
  // weed: three tufts of thin triangular-prism blades on the upper face
  for (const [z, th, nb] of [[-0.32, 1.45, 5], [0.02, 1.75, 6], [0.28, 1.3, 5]]) {
    const r = rad(z, th) * 0.96, bx = axisX(z) + Math.cos(th) * r, by = R0 + Math.sin(th) * r;
    for (let b = 0; b < nb; b++) {
      const s1 = _gh(b, z * 100, 1), s2 = _gh(b, z * 100, 2), len = 0.03 + 0.045 * s1, lean = 1.2 + (s2 - 0.5) * 1.2, wd = 0.005;
      const ox = bx + (s2 - 0.5) * 0.03, oz = z + (s1 - 0.5) * 0.04;
      const seg = [];
      for (let k = 0; k <= 2; k++) {
        const f = k / 2, h = len * f, bend = lean * f * f * len, w = wd * (1 - 0.7 * f);
        const cx = ox + bend + Math.cos(th) * h * 0.3, cy = by + h, cz = oz + bend * 0.6;
        const tri = [];
        for (let e = 0; e < 3; e++) {
          const a = e / 3 * Math.PI * 2 + b;
          tri.push(A.v(cx + Math.cos(a) * w, cy, cz + Math.sin(a) * w, 0, f, P_WEED, 0, 0, f));
        }
        seg.push(tri);
      }
      for (let k = 0; k < 2; k++) for (let e = 0; e < 3; e++) A.qf(seg[k][e], seg[k][(e + 1) % 3], seg[k + 1][(e + 1) % 3], seg[k + 1][e]);
    }
  }
  const g = A.done(seams);
  return norm(g);
}

// THE STOVE BARREL. Upright, height 1, bilge radius 0.38 (so the height is the largest
// extent, as the contract wants). 16 staves bulge to the bilge (sin profile); the head
// sits recessed inside a chime; three rusted iron hoops stand proud. One side is BURST:
// three staves caved in below a jagged break, their tops snapped short and splayed,
// raw wood showing. ~430 triangles.
function barrelGeo() {
  const A = Acc(), seams = [];
  const NA = 16, NY = 5, RH = 0.30, RB = 0.38, HEAD = 0.955;
  const R = y => RH + (RB - RH) * Math.sin(Math.PI * Math.min(1, Math.max(0, y)));
  // burst: vertices 3..6 (staves 3-5), cave depth and break height per vertex
  const cave = j => [0, 0, 0, 0.45, 1, 1, 0.45][j] || 0;
  const brk = j => 0.34 + 0.14 * _gh(j, 11, 4);
  // broken stave tops: the two stove-in staves snapped low and ragged, their neighbours cracked
  const top = j => cave(j) > 0.5 ? 0.5 + 0.14 * _gh(j, 5, 8) : cave(j) > 0 ? 0.78 + 0.1 * _gh(j, 3, 2) : 1.0;
  const rows = [];
  for (let i = 0; i <= NY; i++) {
    const row = [];
    for (let j = 0; j <= NA; j++) {
      const jj = j % NA, th = jj / NA * Math.PI * 2;
      let y = i / NY;
      if (i === NY) y = top(jj);
      let r = R(y), w = 0;
      const c = cave(jj), b = brk(jj);
      if (c > 0 && y > b) { const k = Math.min(1, (y - b) / 0.12); r *= 1 - 0.3 * c * k; w = c * k; }
      row.push(A.v(Math.cos(th) * r, y, Math.sin(th) * r, j / NA * 2, y, P_STAVE, 0, 0, w));
    }
    seams.push([row[0], row[NA]]);
    if (rows.length) { const pr = rows[rows.length - 1]; for (let j = 0; j < NA; j++) A.qf(pr[j], pr[j + 1], row[j + 1], row[j]); }
    rows.push(row);
  }
  // the chime: stave tops (thickness) down the inside to the recessed head
  {
    const lip = [], inner = [];
    for (let j = 0; j <= NA; j++) {
      const jj = j % NA, th = jj / NA * Math.PI * 2, y = top(jj), c = cave(jj), r = R(y) * (1 - 0.3 * c * Math.min(1, Math.max(0, (y - brk(jj)) / 0.12))) - 0.028;
      lip.push(A.v(Math.cos(th) * r, y, Math.sin(th) * r, j / NA * 2, y + 0.02, P_STAVE, 0, 0, cave(jj)));
      const yi = cave(jj) > 0.5 ? y - 0.02 : HEAD;
      inner.push(A.v(Math.cos(th) * r * 0.99, yi, Math.sin(th) * r * 0.99, j / NA * 2, yi, P_RAW, 0, 0, 0.3));
    }
    seams.push([lip[0], lip[NA]], [inner[0], inner[NA]]);
    const tp = rows[NY];
    for (let j = 0; j < NA; j++) { A.qf(tp[j], tp[j + 1], lip[j + 1], lip[j]); A.qf(lip[j], lip[j + 1], inner[j + 1], inner[j]); }
    // the head: planks across (the stave set turned 90 degrees in the shader)
    const c = A.v(0, HEAD, 0, 0.5, 0.5, P_HEAD, 0, 0, 0), hd = [];
    for (let j = 0; j < NA; j++) {
      const th = j / NA * Math.PI * 2, r = R(HEAD) - 0.03;
      hd.push(A.v(Math.cos(th) * r, HEAD, Math.sin(th) * r, 0.5 + Math.cos(th) * r, 0.5 + Math.sin(th) * r, P_HEAD, Math.cos(th), Math.sin(th), 0));
    }
    for (let j = 0; j < NA; j++) A.t(c, hd[(j + 1) % NA], hd[j]);
  }
  // hoops: bands 0.045 tall standing 0.012 proud, three rows. They ride the staves
  // (caved in with them over the burst); the top hoop SNAPPED there — a gap with its
  // two ends sprung outward.
  // the dark inside: a coarse inner wall and a bottom head, seen only through the burst
  {
    const IN = 12, rowsI = [];
    for (const y of [0.05, 0.5, HEAD]) {
      const row = [];
      for (let j = 0; j <= IN; j++) { const th = (j % IN) / IN * Math.PI * 2, r = R(y) - 0.035; row.push(A.v(Math.cos(th) * r, y, Math.sin(th) * r, 0, y, P_INNER, 0, 0, y)); }
      seams.push([row[0], row[IN]]);
      if (rowsI.length) { const pr = rowsI[rowsI.length - 1]; for (let j = 0; j < IN; j++) A.q(pr[j], pr[j + 1], row[j + 1], row[j]); }
      rowsI.push(row);
    }
    const c = A.v(0, 0.05, 0, 0.5, 0.5, P_INNER, 0, 0, 0);
    for (let j = 0; j < IN; j++) A.t(c, rowsI[0][j + 1], rowsI[0][j]);
  }
  const HN = NA;
  for (const [yc, hw, top] of [[0.24, 0.022, 0], [0.7, 0.022, 0], [0.9, 0.024, 1]]) {
    const hr = j => {
      const c = cave(j), b = brk(j);
      let r = R(yc);
      if (c > 0 && yc > b) r *= 1 - 0.3 * c * Math.min(1, (yc - b) / 0.12);
      return r;
    };
    const gap = j => top && cave(j) > 0.5;
    const ring = (y, dr) => {
      const row = [];
      for (let j = 0; j <= HN; j++) {
        const jj = j % HN, th = jj / HN * Math.PI * 2;
        const sprung = top && !gap(jj) && (gap((jj + 1) % HN) || gap((jj + HN - 1) % HN)) ? 0.035 : 0;
        const r = hr(jj) + dr + sprung;
        row.push(A.v(Math.cos(th) * r, y + sprung * 0.6, Math.sin(th) * r, j / HN * 3, y * 4, P_HOOP, 0, 0, 0));
      }
      seams.push([row[0], row[HN]]);
      return row;
    };
    const r0 = ring(yc - hw, 0.001), r1 = ring(yc - hw, 0.013), r2 = ring(yc + hw, 0.013), r3 = ring(yc + hw, 0.001);
    for (let j = 0; j < HN; j++) {
      if (gap(j) || gap((j + 1) % HN)) continue;
      A.qf(r0[j], r0[j + 1], r1[j + 1], r1[j]); A.qf(r1[j], r1[j + 1], r2[j + 1], r2[j]); A.qf(r2[j], r2[j + 1], r3[j + 1], r3[j]);
    }
  }
  return norm(A.done(seams));
}

// loadProp()'s normalisation contract: XZ-centred, base at y = 0, largest extent = 1.
function norm(g) {
  g.computeBoundingBox();
  const b = g.boundingBox, s = 1 / Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(s, s, s);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG — mulberry32 via siteParams('props').rng, drawn fresh on every
// build/reseed (site.js's own stream() factory). `rnd` is a `let` reassigned per
// build/reseed inside run(), never a counter this module owns, so a reseed can never
// resume mid-stream from a stale cursor. Site 0's seed is 0x9A11A5E1 and every draw
// below happens in the exact order the shipped Math.random()-driven version did, so
// site 0 scatters the SHIPPED field.
// ---------------------------------------------------------------------------
let rnd = null;
const rr = (a, b) => a + rnd() * (b - a);

// ----------------------------------------------------------------- placement --
function seedClusters(zi, n, minR, maxR, seed) {
  const out = [], rp = riftPos(zi);
  let guard = 0;
  while (out.length < n && guard++ < n * 70) {
    const a = rnd() * TAU, r = rr(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_CLEAR) continue;
    if (guard < n * 35 && fbm(x * 0.011 + seed, z * 0.011 - seed) < 0.34) continue;
    out.push([x, z, rr(24, 58)]);
  }
  return out;
}

// Clumped sampling with slope gating; relaxes the limit rather than starving a prop.
// minGap keeps same-type props from piling into one unreadable blob.
function place(zi, count, seeds, minSlope, minGap) {
  const out = [], rp = riftPos(zi);
  if (!seeds.length) return out;
  let lo = minSlope, gap = minGap, guard = 0, relaxed = false;
  while (out.length < count && guard++ < count * 40) {
    if (!relaxed && guard > count * 18) { relaxed = true; lo = 1 - (1 - lo) * 2.4; gap *= 0.5; }
    const s = seeds[(rnd() * seeds.length) | 0];
    const a = rnd() * TAU, u = Math.pow(rnd(), 0.8);
    const x = s[0] + Math.cos(a) * s[2] * u, z = s[1] + Math.sin(a) * s[2] * u;
    const r = Math.hypot(x, z);
    if (r > WORLD_R * 0.98 || r < 10) continue;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_CLEAR) continue;
    const n = terrainNormal(x, z, zi);
    if (n.y < lo) continue;
    if (gap > 0 && out.some(o => Math.hypot(o.x - x, o.z - z) < gap)) continue;
    out.push({ x, z, y: terrainH(x, z, zi), n });
  }
  return out;
}

function stand(n, blend, yaw) {
  _q2.setFromUnitVectors(UP, n);
  if (blend < 1) _q2.slerp(IDQ, 1 - blend);
  return _q2.multiply(_q.setFromAxisAngle(UP, yaw));
}

// -------------------------------------------------------------------- build ---
export const propColliders = [];
const zones = [];
export const propMeshes = [];

// The generation, cached forever: buildProps() and every later reseedProps() share this
// one promise/result, so a site change never rebuilds the shapes — only their PLACEMENT
// (instancing, world positions) is per-build. Kept a promise so run()'s shape (and its
// gen-token race guard) is unchanged.
const GEN = { log: logGeo, barrel: barrelGeo };
let loadPromise = null;
function loadAssets() {
  if (!loadPromise) {
    const t0 = performance.now();
    const entries = MANIFEST.map(cfg => ({ cfg, prop: { geometry: GEN[cfg.gen]() } }));
    genMs = performance.now() - t0;
    loadPromise = Promise.resolve(entries);
  }
  return loadPromise;
}
let genMs = 0;

// Dispose only what a build itself produced: the per-node InstancedMesh and its cloned
// (per-build) geometry. The cached prop.geometry it clones from and the per-zone
// materials (propMat's cache) are never touched — reseedProps() compiles nothing.
function clearPlaced() {
  for (const im of propMeshes) {
    if (im.parent) im.parent.remove(im);
    im.geometry.dispose();
  }
  propMeshes.length = 0;
  propColliders.length = 0;   // in place — game.js/player.js hold this exact array reference
}

// The shared load-then-place pipeline both buildProps() and reseedProps() run. `gen` is
// a monotonic token: if a reseed is requested while the very first buildProps() is still
// awaiting the glTF fetch, both calls await the SAME cached loadAssets() promise and both
// resume — but only the call whose gen is still current when it resumes actually places;
// the superseded one no-ops (returns placed: 0) rather than racing to scatter twice or
// clearing what the other just placed. In the ordinary case (assets already cached, no
// concurrent call) this resolves same-tick and behaves like a plain synchronous rebuild.
let gen = 0;

async function run() {
  const myGen = ++gen;
  const entries = await loadAssets();
  if (myGen !== gen) return { loaded: entries.length, placed: 0 };
  if (!entries.length) return { loaded: 0, placed: 0 };

  rnd = siteParams('props').rng;   // fresh stream per brief: never reuse one across rebuilds
  clearPlaced();

  let placed = 0;
  for (let zi = 0; zi < 3; zi++) {
    const use = entries.filter(e => e.cfg.zones.includes(zi));
    if (!use.length) continue;
    if (!zones[zi]) { zones[zi] = new THREE.Group(); scene.add(zones[zi]); }
    const seeds = seedClusters(zi, 26, 20, WORLD_R * 0.94, zi * 13.7 + 5);

    for (const { cfg, prop } of use) {
      const L = place(zi, cfg.n, seeds, cfg.slope, cfg.gap || 0);
      if (!L.length) continue;
      const g = prop.geometry.clone();
      g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(L.length * 2), 2));
      const mat = propMat(cfg.gen, zi, cfg.sway || 0);
      const im = new THREE.InstancedMesh(g, mat, L.length);
      // Shadows: the sun's one shadow map covers only the raft's 18-unit ortho box;
      // seafloor props can never receive it, so both flags are simply off.
      im.receiveShadow = false;
      im.castShadow = false;
      im.frustumCulled = false;
      const a = g.attributes.aInst.array;
      const base = PAL[zi][cfg.tint];
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        const H = rr(cfg.size[0], cfg.size[1]) * (0.75 + 0.6 * fbm(p.x * 0.05 + 3, p.z * 0.05));
        const W = H * rr(0.8, 1.3);
        // Bed every prop slightly into the terrain so none ever reads as floating.
        // cfg.sink beds the prop into the silt (0 = base on the surface)
        _m.compose(_p.set(p.x, p.y - H * (0.12 + (cfg.sink || 0)), p.z), stand(p.n, cfg.stand, rr(0, TAU)), _s.set(W, H, W));
        im.setMatrixAt(i, _m);
        // The zone mood as the instance colour: the generated surface multiplies its own
        // structure and part tints INTO it (bark, end grain, staves), so hue stays zonal.
        _c.set(base).multiplyScalar(rr(0.85, 1.6));
        im.setColorAt(i, _c);
        a[i * 2] = rnd() * TAU;
        a[i * 2 + 1] = clamp(rr(0.5, 1), 0, 1);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      g.attributes.aInst.needsUpdate = true;
      zones[zi].add(im);
      propMeshes.push(im);
      placed += L.length;
    }
  }
  return { loaded: entries.length, placed };
}

export function buildProps() { return run(); }
export function reseedProps() { return run(); }

export function updateProps(dt, t) {
  uni.uTime.value = t;
  const a = 0.9 + 0.5 * Math.sin(t * 0.055);
  uni.uCur.value.set(Math.cos(a), Math.sin(a));
  const y = camera.position.y;
  for (let zi = 0; zi < 3; zi++)
    if (zones[zi]) zones[zi].visible = y < zoneTop(zi) + 120 && y > zoneBottom(zi) - 150;
}

// Dev surface: the one-time generation cost (shapes) and the two map-set bakes.
if (typeof window !== 'undefined') window.__propsGen = () => ({ genMs: +genMs.toFixed(1), bark: +barkSet().ms.toFixed(1), stave: +staveSet().ms.toFixed(1) });
