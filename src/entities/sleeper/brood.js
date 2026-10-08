// THE CLUTCH — Velkath carries her eggs (roadmap/brooder-clutch.md; Michael 2026-10-08:
// "Clutch under her body"). Owned by the Brooder: built into her L.body / L.grp, so a zone
// change, voyage or reseed disposes it with her (disposeSleeper's traversal).
//
// REFERENCE (a berried female crab): tens of thousands of ~0.5 mm eggs held as a spongy mass
// under the folded abdomen, glued to the setae (hairs) of the pleopods; bright orange when
// fresh, darkening to brown/grey with dark EYESPOTS as the embryos develop; she aerates the
// mass by fanning the abdomen. Velkath is a colossus, so the mass is ~9 u across and its
// beads are scaled up past true scale (true scale would be ~0.04 u; these are ~0.08 u, about
// a fist to a helmet's quarter): thousands of translucent amber-to-brown beads, each with an
// eyespot, clinging to hairs, the whole mass breathing as she fans it.
//
// The rite, in the world's own grammar:
//   * she sleeps on the rift lip, a reef-crusted ridge bedded in the silt;
//   * asleep, the clutch BULGES out from under her rim on one side (the side the silt drift
//     leaves open: her fanning keeps the silt off it), resting on the seabed;
//   * a trail of many-legged tracks runs in to her past a shed shell and spent casings;
//   * [E] near the clutch PRIES A CLUMP off her (carried at Sal's free hand, shedding a few
//     beads); that take wakes her (brooder.js hears it through brood.onTake);
//   * standing, the mass hangs under her apron: her last ward will not light while the
//     clump is out; [E] within reach of the clutch under her belly presses it back.
//
// RENDER: one program (CLUTCH material, two LOD variants by define) draws every bead, the
// mass's core, the carried clump, the shed beads and the spent casings: instanced unit
// spheres whose centre/radius come from instance attributes (asleep + standing positions,
// lerped by uStand in the vertex shader). Near the lens the beads are an 80-tri sphere, out
// to 55 u a 20-tri one, past that only the core (whose surface draws deeper beads as 3D
// cells). The hairs are one more instanced draw (SETAE). Nothing casts shadows. Translucency
// without a light: the lantern's in-scatter slot (abyssaLampA, the fog chunk's uniform) lights
// the bead from inside, wrapped round the terminator; the eyespot darkens what shows through.
import * as THREE from 'three';
import { V3, clamp } from '../../lib/math.js';
import { seededRand } from '../../lib/textures.js';
import { registerPaint } from '../../lib/paint.js';
import { envTexDeep as envTex } from '../../core.js';
import { terrainH, terrainNormal } from '../../world/terrain.js';
import { riftPos, RIFT_R } from '../../config.js';
import { emitDust } from '../../world/footfx.js';
import { lanternWorldPos } from '../diver.js';
import * as G from './brooderGeo.js';

const TAU = Math.PI * 2;
const TAKE_R = 2.6, RET_R = 3.4;        // reach from his hands/helmet to the mass's surface (world u): pry / press back (up, arm raised)
const RB = 0.0052;                      // bead radius, shell units (x R 15.4 = 0.08 u)
const MAXB = 14000;                     // bead budget (the clutch); the build thins to it
const LOD_N = 12, LOD_F = 55;           // near (80-tri) / far (20-tri) / core-only ranges, world u
const SHED_N = 32, CLUMP_B = 110, CASE_N = 420, SETAE_N = 360;
const _v = V3(), _w = V3(), _n = V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _up = V3(0, 1, 0);
const _a = V3(), _b = V3(), _lant = V3();

// ---- the mass: lobes (shell units, body-local) ------------------------------------------
// STANDING ("H"): hanging under the brood apron (the sculpt's apron is an ellipsoid at
// (0, -0.103, -0.24), radii (0.36, 0.022, 0.34)), heavy and sagging: bottom ~ -0.40 (6 u
// under her body origin), 8.6 u across. ASLEEP ("S"): seat() rests every lobe on the seabed
// under her and pushes a tongue of lobes out past the rim on the open side.
const MAIN = [
  [0, -0.215, -0.26, 0.16], [0.15, -0.20, -0.18, 0.13], [-0.15, -0.20, -0.18, 0.13],
  [0.13, -0.21, -0.38, 0.13], [-0.13, -0.21, -0.38, 0.13], [0, -0.20, -0.05, 0.12],
  [0, -0.21, -0.48, 0.11], [0.06, -0.30, -0.30, 0.10], [-0.06, -0.30, -0.24, 0.10],
  // the sag: the heaviest of it hangs lowest (the reach test counts these, so the return is
  // ~1.3 u nearer the floor than the apron's own bead line)
  [0.03, -0.39, -0.29, 0.085], [-0.04, -0.40, -0.21, 0.075]
];
const SPILL_MAX = 8;
const MASS_C = [0, -0.23, -0.27];

// A lobe is not a ball: its radius wanders with direction (the same function in the core's
// vertex shader, so the beads sit on the surface the core draws). d: unit direction, s: seed.
function lump(dx, dy, dz, s) {
  return 1 + 0.13 * Math.sin(dx * 3.1 + s) * Math.sin(dy * 2.7 + s * 1.7) * Math.sin(dz * 3.3 + s * 2.3)
    + 0.06 * Math.sin(dx * 7.3 + s * 3.1) * Math.sin(dy * 6.1 + s * 0.7) * Math.sin(dz * 6.9 + s * 1.3);
}
const LUMP_GLSL = `
float clLump(vec3 d, float s) {
  return 1.0 + 0.13 * sin(d.x * 3.1 + s) * sin(d.y * 2.7 + s * 1.7) * sin(d.z * 3.3 + s * 2.3)
    + 0.06 * sin(d.x * 7.3 + s * 3.1) * sin(d.y * 6.1 + s * 0.7) * sin(d.z * 6.9 + s * 1.3);
}`;

// ---- the program ----------------------------------------------------------------------------
// aP0 / aP1: centre (xyz) + radius (w), asleep / standing (mesh-local units). aSd: x random,
// y development stage (0 fresh orange .. 1 brown-grey, eyed), z eyespot azimuth (beads) or
// the cell size (cores), w MODE: 0 clutch bead, 1 clutch core, 2 spent casing, 3 loose bead,
// 4 loose core (the clump's).
const CL_VS_HEAD = `
attribute vec4 aP0, aP1, aSd;
uniform float uStand, uTime, uBreath;
uniform vec3 uMassC;
varying vec4 vBSd; varying vec3 vBDir, vBLoc, vBW; varying float vBR, vBK;` + LUMP_GLSL;
const CL_VS_BEGIN = `
vec4 bcl = mix(aP0, aP1, uStand);
vec3 bc = bcl.xyz; float brr = bcl.w;
float bmode = floor(aSd.w + 0.5);
if (bmode < 1.5) {
  // she fans the apron: a slow wave runs front to back through the mass, swelling it
  vec3 brad = bc - uMassC; float brl = length(brad) + 1e-4;
  float bw = 0.5 + 0.5 * sin(uTime * 1.25 + bc.z * 11.0 + bc.x * 4.0);
  bc += brad / brl * (0.0065 * bw * bw * uBreath);
}
vec3 bsc = vec3(1.0);
if (bmode > 1.5 && bmode < 2.5) {
  bsc = vec3(1.0, 0.42, 1.0);      // a spent casing: collapsed, a flat wrinkled skin
  bc.y += 0.03 * brr * sin(uTime * 0.7 + aSd.x * 40.0);
}
if (bmode > 0.5 && bmode < 1.5 || bmode > 3.5) bsc *= clLump(position, aSd.x * 10.0);
vec3 transformed = bc + position * bsc * brr;
{
  vec3 bwc = (modelMatrix * vec4(bc, 1.0)).xyz;
  float bdc = distance(bwc, cameraPosition);
#ifdef CLUTCH_FAR
  // the far set draws only clutch beads between the near and far ranges
  if (bmode > 0.5 || bdc <= ${LOD_N.toFixed(1)} || bdc > ${LOD_F.toFixed(1)}) transformed = bc;
#else
  if ((bmode < 0.5 && bdc > ${LOD_N.toFixed(1)}) || (bmode > 1.5 && bmode < 2.5 && bdc > 45.0) || (bmode > 2.5 && bmode < 3.5 && bdc > 30.0)) transformed = bc;
#endif
  if (brr <= 0.0) transformed = bc;
}
vBSd = aSd; vBDir = position; vBLoc = transformed; vBR = brr; vBK = length(modelMatrix[0].xyz);
vBW = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const CL_FS_HEAD = `
uniform float uSssK; uniform vec4 uDbg;
varying vec4 vBSd; varying vec3 vBDir, vBLoc, vBW; varying float vBR, vBK;
float clH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
// nearest 3D cell (a bead deeper in the mass): returns its distance, writes its id
float clCell(vec3 p, out vec3 cid) {
  vec3 ip = floor(p), fp = fract(p); float d1 = 9.0; cid = ip;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 o = vec3(clH(ip + g), clH(ip + g + 17.3), clH(ip + g + 41.9)) * 0.7 + 0.15;
    vec3 r = g + o - fp; float d = dot(r, r);
    if (d < d1) { d1 = d; cid = ip + g; }
  }
  return sqrt(d1);
}
vec3 clAlb(float st, float rnd) {
  // fresh orange -> amber -> brown -> brown-grey (linear albedo)
  vec3 a = mix(vec3(0.46, 0.14, 0.018), vec3(0.27, 0.10, 0.022), smoothstep(0.0, 0.45, st));
  a = mix(a, vec3(0.115, 0.055, 0.026), smoothstep(0.40, 0.80, st));
  a = mix(a, vec3(0.085, 0.07, 0.058), smoothstep(0.80, 1.0, st));
  return a * (0.8 + 0.4 * rnd);
}`;
// diffuse: the bead's colour, its eyespot, and (cores) the cell it shows
const CL_FS_COLOR = `
float bMode = floor(vBSd.w + 0.5);
float bSpot = 0.0, bCore = 0.0, bCellD = 0.0;
vec3 bAlb;
if (bMode > 0.5 && bMode < 1.5 || bMode > 3.5) {
  vec3 cid; bCellD = clCell(vBLoc / max(vBSd.z, 1e-5), cid);
  float cr = clH(cid + 3.1), cs = clamp(vBSd.y + (clH(cid + 7.7) - 0.5) * 0.35, 0.0, 1.0);
  bAlb = clAlb(cs, cr) * (0.55 + 0.45 * smoothstep(0.75, 0.2, bCellD));
  bSpot = (1.0 - smoothstep(0.16, 0.26, length(vec2(bCellD - 0.18, clH(cid + 5.5) - 0.5)))) * smoothstep(0.3, 0.6, cs) * 0.7;
  bCore = 1.0;
} else if (bMode > 1.5 && bMode < 2.5) {
  bAlb = vec3(0.30, 0.27, 0.22) * (0.8 + 0.4 * vBSd.x);
} else {
  bAlb = clAlb(vBSd.y, vBSd.x);
  // the eyespot: a dark kidney inside the shell, on its own bearing per egg; eyed eggs only
  float az = vBSd.z, el = (vBSd.x - 0.5) * 1.2;
  vec3 ed = vec3(cos(az) * cos(el), sin(el), sin(az) * cos(el));
  vec3 nd = normalize(vBDir);
  float de = dot(nd, ed);
  float kid = de + 0.08 * dot(nd, normalize(cross(ed, vec3(0.0, 1.0, 0.0)) + 1e-4));
  bSpot = smoothstep(0.70, 0.82, kid) * smoothstep(0.28, 0.55, vBSd.y);
  // the yolk: a darker mass filling the old egg's far half
  bAlb *= 1.0 - 0.35 * smoothstep(0.0, -0.7, de) * smoothstep(0.5, 0.9, vBSd.y);
}
bSpot = max(bSpot, uDbg.x);
diffuseColor.rgb = bAlb * (1.0 - 0.88 * bSpot);`;
const CL_FS_ROUGH = `
roughnessFactor = bMode > 1.5 && bMode < 2.5 ? 0.62 : mix(mix(0.32, 0.55, bSpot), 0.5, bCore);`;
// cores: each cell bulges like a bead (screen-derivative bump off the cell distance)
const CL_FS_NORMAL = `
if (bCore > 0.5) {
  float hgt = -bCellD * bCellD * vBSd.z * vBK * 0.5 * (1.0 - smoothstep(0.25, 0.8, length(fwidth(vBLoc)) / max(vBSd.z, 1e-5)));
  vec3 pv = -vViewPosition, dx = dFdx(pv), dy = dFdy(pv), r1 = cross(dy, normal), r2 = cross(normal, dx);
  float det = dot(dx, r1);
  vec3 grd = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
  normal = normalize(abs(det) * normal - grd);
}`;
// translucency: the lantern lights the bead from INSIDE (its own in-scatter slot), wrapped
// round the terminator, brightest through its thickness, shadowed by the eyespot
const CL_FS_SSS = `
#ifdef USE_FOG
if (abyssaLampA.w > 0.0 && !(bMode > 1.5 && bMode < 2.5)) {
  vec3 bdl = abyssaLampA.xyz - vBW; float bd2 = dot(bdl, bdl);
  float bq = bd2 / max(abyssaLampAC.w * abyssaLampAC.w, 1.0), bwn = clamp(1.0 - bq * bq, 0.0, 1.0);
  vec3 bE = abyssaLampAC.rgb * (abyssaLampA.w * bwn * bwn / max(bd2, 6.0) * 0.3183);
  vec3 bL = bdl * inversesqrt(max(bd2, 1e-6));
  vec3 bN = (vec4(normal, 0.0) * viewMatrix).xyz;
  float bWrap = clamp((dot(bN, bL) + 0.75) / 1.75, 0.0, 1.0);
  float bNV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  vec3 bIn = bAlb * vec3(1.6, 1.2, 0.85);
  totalEmissiveRadiance += bIn * bE * bWrap * (0.30 + 0.70 * pow(bNV, 1.6)) * (1.0 - 0.9 * bSpot) * uSssK * (1.0 - 0.55 * bCore);
}
#endif`;
function clutchMat(far) {
  const k = far ? 'far' : 'near';
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, envMap: envTex, envMapIntensity: 0.22 });
  const u = { uStand: { value: 0 }, uTime: { value: 0 }, uBreath: { value: 1 }, uMassC: { value: new THREE.Vector3().fromArray(MASS_C) }, uSssK: { value: 0.55 }, uDbg: { value: new THREE.Vector4() } };
  m.userData.u = u;
  if (far) m.defines = { CLUTCH_FAR: 1 };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + CL_VS_HEAD)
      .replace('#include <begin_vertex>', CL_VS_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CL_FS_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + CL_FS_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + CL_FS_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + CL_FS_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + CL_FS_SSS);
  };
  m.customProgramCacheKey = () => 'brood|clutch|' + k;
  return registerPaint(m);
}

// THE SETAE: the hairs the eggs hang on. A thin 3-sided strand along +Y, bent and laid
// between a root and a tip given per instance for both states.
const ST_VS_HEAD = `
attribute vec4 aR0, aR1, aT0, aT1;
uniform float uStand, uTime;
varying float vSt;`;
const ST_VS_BEGIN = `
vec3 sr = mix(aR0.xyz, aR1.xyz, uStand), stp = mix(aT0.xyz, aT1.xyz, uStand);
vec3 sd = stp - sr; float sl = length(sd) + 1e-5; vec3 su = sd / sl;
vec3 sp = normalize(abs(su.y) < 0.9 ? cross(su, vec3(0.0, 1.0, 0.0)) : cross(su, vec3(1.0, 0.0, 0.0)));
vec3 sq = cross(su, sp);
float st = position.y;
vec3 sb = sp * sin(st * 3.1 + aR0.w * 9.0) * 0.12 * sl * st + sq * (0.18 * sl * st * st) + vec3(0.0, -0.06 * sl * sin(3.1416 * st), 0.0);
sb += sp * 0.02 * sl * sin(uTime * 0.9 + aR0.w * 30.0) * st;
float sw = aR1.w * (1.0 - 0.75 * st);
vec3 transformed = sr + sd * st + sb + (sp * position.x + sq * position.z) * sw;
if (aR1.w <= 0.0) transformed = sr;
vSt = st;`;
function setaeMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0x8c7a5c, roughness: 0.5, metalness: 0, envMap: envTex, envMapIntensity: 0.3 });
  const u = { uStand: { value: 0 }, uTime: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + ST_VS_HEAD)
      .replace('#include <begin_vertex>', ST_VS_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSt;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.55, 1.15, vSt);');
  };
  m.customProgramCacheKey = () => 'brood|setae';
  return registerPaint(m);
}

// unit spheres: an 80-tri (near), a 20-tri (far, smooth normals = round enough at range),
// the core's lathe-smooth 1280-tri sphere
let _geoN = null, _geoF = null, _geoC = null, _geoS = null;
function sphere(detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).normalize(); n.setXYZ(i, _v.x, _v.y, _v.z); }
  return g;
}
function strandGeo() {
  const S = 6, pos = [], idx = [];
  for (let i = 0; i <= S; i++) for (let j = 0; j < 3; j++) { const a = j / 3 * TAU; pos.push(Math.cos(a), i / S, Math.sin(a)); }
  for (let i = 0; i < S; i++) for (let j = 0; j < 3; j++) {
    const a = i * 3 + j, b = i * 3 + (j + 1) % 3, c = a + 3, d = b + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// an instanced set over a base geometry: n instances of aP0/aP1/aSd (all zero = hidden)
function beadSet(base, n, dynamic) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('normal', base.attributes.normal);
  for (const k of ['aP0', 'aP1', 'aSd']) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(k, a);
  }
  g.instanceCount = n;
  return g;
}
function shareSet(src, base) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('normal', base.attributes.normal);
  for (const k of ['aP0', 'aP1', 'aSd']) g.setAttribute(k, src.attributes[k]);
  g.instanceCount = src.instanceCount;
  return g;
}

export function makeBrood(L, idx, trailFrom) {
  const grp = L.grp, R = L.R;
  const rnd = seededRand(0xB700D + idx * 131 + Math.round(trailFrom.x * 7 + trailFrom.z * 13));
  if (!_geoN) { _geoN = sphere(1); _geoF = sphere(0); _geoC = sphere(3); _geoS = strandGeo(); }
  const B = {
    held: -1, taken: 0, t: 0, seated: false, st: 0, carryT: 0, shedT: 2, fanT: 4, locked: false,
    found: { tracks: false, shells: false, nest: false, ridge: false },
    trailA: trailFrom.clone(), shellsAt: V3(), takeAt: V3(), clumpAt: V3(), bear: 0, notch: 0.5,
    lobes: [], nL: 0
  };
  B.trailA.y = terrainH(B.trailA.x, B.trailA.z, idx);
  const matN = clutchMat(false), matF = clutchMat(true), sMat = setaeMat();
  B.mats = [matN, matF, sMat];

  // ---- the lobes (filled for real by seat(); standing positions are fixed) ----
  for (const [x, y, z, r] of MAIN) B.lobes.push({ h: [x, y, z, r], s: [x, y, z, r], spill: false, seed: rnd() });
  for (let k = 0; k < SPILL_MAX; k++) {
    // a spill lobe standing is folded back inside the big centre lobe (it hides there)
    B.lobes.push({ h: [MAIN[0][0], MAIN[0][1] - 0.01, MAIN[0][2], 0.09], s: [0, -0.2, -0.26, 0.09], spill: true, seed: rnd() });
  }
  B.nL = B.lobes.length;
  // the live lobe set (lerped by B.st), for reach tests: x y z r per lobe
  B.live = new Float32Array(B.nL * 4);

  // ---- meshes (geometry sized at seat) ----
  B.core = new THREE.Mesh(beadSet(_geoC, B.nL, false), matN);
  B.beadsN = null; B.beadsF = null; B.setae = null;
  B.core.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.2, -0.2), 1.45);
  for (const o of [B.core]) { o.castShadow = false; o.receiveShadow = true; L.body.add(o); }

  // ---- the clump (carried) and the shed beads: world space, same program ----
  {
    const g = beadSet(_geoN, CLUMP_B + 1, false), P0 = g.attributes.aP0.array, P1 = g.attributes.aP1.array, Sd = g.attributes.aSd.array;
    const cr = seededRand(0xC1A9);
    const rw = RB * R;
    // a core and a lumpy crust of beads round it (radius ~0.3 u)
    P0[0] = P1[0] = 0; P0[1] = P1[1] = 0; P0[2] = P1[2] = 0; P0[3] = P1[3] = 0.24;
    Sd[0] = 0.5; Sd[1] = 0.55; Sd[2] = 2 * rw; Sd[3] = 4;
    for (let i = 1; i <= CLUMP_B; i++) {
      const y = 1 - 2 * (i - 0.5) / CLUMP_B, rr = Math.sqrt(1 - y * y), ph = i * 2.39996 + cr() * 0.3;
      const lump = 0.24 + rw * (0.6 + 0.6 * cr()) + 0.05 * Math.sin(ph * 2.0 + y * 3.0);
      const o = i * 4;
      P0[o] = P1[o] = Math.cos(ph) * rr * lump; P0[o + 1] = P1[o + 1] = y * lump * 0.85; P0[o + 2] = P1[o + 2] = Math.sin(ph) * rr * lump;
      P0[o + 3] = P1[o + 3] = rw * (0.8 + 0.4 * cr());
      Sd[o] = cr(); Sd[o + 1] = 0.45 + 0.4 * cr(); Sd[o + 2] = cr() * TAU; Sd[o + 3] = 3;
    }
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    B.clump = new THREE.Mesh(g, matN);
    B.clump.castShadow = false;
    B.clump.visible = false;
    grp.add(B.clump);
    const sg = beadSet(_geoN, SHED_N, true);
    B.shed = new THREE.Mesh(sg, matN);
    B.shed.frustumCulled = false; B.shed.castShadow = false;
    B.shed.visible = false;
    grp.add(B.shed);
    B.shedSt = new Float32Array(SHED_N * 8);   // x y z vx vy vz age life
    B.shedHead = 0; B.shedLive = 0;
  }

  // ---- behaviour ----
  B.out = () => (B.held >= 0 ? 1 : 0);
  // live lobes (shell units) for the current stand, and the inverse body matrix
  const liveLobes = () => {
    const s = B.st;
    for (let k = 0; k < B.nL; k++) {
      const lb = B.lobes[k], o = k * 4;
      for (let c = 0; c < 4; c++) B.live[o + c] = lb.s[c] + (lb.h[c] - lb.s[c]) * s;
    }
  };
  // Reach from Sal to the mass's surface (world u; < 0 inside). Asleep only the lobes that
  // lie OUT in the open count (the rest are bedded under her); standing, every lobe.
  // Tested from his helmet, his chest and his hands' height (he reaches; he does not have to
  // put his head in it). Returns the lobe index through B.nearK.
  B.reach = pos => {
    if (!B.seated) return 1e9;
    L.body.updateMatrixWorld();
    _inv.copy(L.body.matrixWorld).invert();
    liveLobes();
    const openOnly = B.st < 0.5;
    let best = 1e9; B.nearK = -1;
    for (let h = 0; h < 3; h++) {
      _v.set(pos.x, pos.y + (h === 0 ? 0.25 : h === 1 ? -0.45 : -0.95), pos.z).applyMatrix4(_inv);
      for (let k = 0; k < B.nL; k++) {
        if (openOnly && !B.lobes[k].open) continue;
        const o = k * 4, r = B.live[o + 3];
        if (r <= 0.002) continue;
        const d = (Math.hypot(_v.x - B.live[o], _v.y - B.live[o + 1], _v.z - B.live[o + 2]) - r) * R;
        if (d < best) { best = d; B.nearK = k; }
      }
    }
    return best;
  };
  // the lowest point of the mass over body-local (x, z), shell units (or `none`): the
  // crouch keeps it off the diver's helmet (brooder.js)
  B.underY = (x, z, none) => {
    let y = none;
    for (let k = 0; k < B.nL; k++) {
      const o = k * 4, r = B.live[o + 3], dx = x - B.live[o], dz = z - B.live[o + 2], q = r * r - dx * dx - dz * dz;
      if (q > 0) { const b = B.live[o + 1] - Math.sqrt(q); if (b < y) y = b; }
    }
    return y;
  };
  B.canTake = pos => !B.locked && B.held < 0 && B.reach(pos) < TAKE_R;
  B.canReturn = pos => B.held >= 0 && B.reach(pos) < RET_R;
  // (playtest / probes: the old names)
  B.nearEgg = pos => (B.canTake(pos) ? 0 : -1);
  B.nearNest = pos => B.canReturn(pos);
  B.prompt = pos => {
    if (B.held >= 0) return B.canReturn(pos) ? '[E] PRESS THE CLUMP BACK INTO HER CLUTCH' : null;
    return B.canTake(pos) ? '[E] PRY A CLUMP FROM HER CLUTCH' : null;
  };
  // [E]: returns { took, returned } or null. brooder.js wakes on the first take.
  B.interact = pos => {
    if (B.held >= 0) {
      if (!B.canReturn(pos)) return null;
      B.held = -1;
      B.clump.visible = false;
      scar(false);
      return { returned: true, out: 0, msg: 'PRESSED BACK INTO HER. THE CLUTCH IS WHOLE.' };
    }
    if (!B.canTake(pos)) return null;
    // the clump comes away from the lobe he reached, at the point nearest him
    const k = B.nearK, o = k * 4;
    _v.set(B.live[o], B.live[o + 1], B.live[o + 2]);
    _w.set(pos.x, pos.y - 0.45, pos.z).applyMatrix4(_inv).sub(_v).normalize().multiplyScalar(B.live[o + 3]).add(_v);
    B.scarAt = _w.clone();
    B.clumpAt.copy(_w).applyMatrix4(L.body.matrixWorld);
    scar(true);
    B.held = 0; B.taken++; B.carryT = 0;
    B.clump.visible = true;
    B.clump.position.copy(B.clumpAt);
    if (B.onTake) B.onTake(B.taken);
    // (a few beads fall as it tears free)
    for (let i = 0; i < 5; i++) shedOne(B.clumpAt, 0.6);
    return { took: true, first: B.taken === 1, msg: B.taken === 1 ? null : 'ANOTHER CLUMP. SHE KNOWS.' };
  };
  // the tear: beads within ~0.55 u of the take point go (radius 0), and come back pressed in
  const scar = on => {
    if (!B.beadsN || !B.scarAt) return;
    const g = B.beadsN.geometry, P0 = g.attributes.aP0.array, P1 = g.attributes.aP1.array, S = B.scarSave, n = g.instanceCount;
    const r2 = (0.6 / R) * (0.6 / R), sx = B.scarAt.x, sy = B.scarAt.y, sz = B.scarAt.z, s = B.st;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (on) {
        const x = P0[o] + (P1[o] - P0[o]) * s - sx, y = P0[o + 1] + (P1[o + 1] - P0[o + 1]) * s - sy, z = P0[o + 2] + (P1[o + 2] - P0[o + 2]) * s - sz;
        if (x * x + y * y + z * z < r2) { S[i * 2] = P0[o + 3]; S[i * 2 + 1] = P1[o + 3]; P0[o + 3] = P1[o + 3] = 0; B.scarN = (B.scarN || 0) + 1; }
        else S[i * 2] = S[i * 2 + 1] = -1;
      } else if (S[i * 2] >= 0) { P0[o + 3] = S[i * 2]; P1[o + 3] = S[i * 2 + 1]; }
    }
    if (!on) B.scarN = 0;
    g.attributes.aP0.needsUpdate = g.attributes.aP1.needsUpdate = true;
  };
  // a bead falls loose at world p (sinks, drifts, settles on the silt)
  const shedOne = (p, kick) => {
    const i = B.shedHead, o = i * 8;
    B.shedHead = (B.shedHead + 1) % SHED_N;
    const St = B.shedSt;
    St[o] = p.x + (Math.random() - 0.5) * 0.3; St[o + 1] = p.y + (Math.random() - 0.5) * 0.3; St[o + 2] = p.z + (Math.random() - 0.5) * 0.3;
    St[o + 3] = (Math.random() - 0.5) * kick; St[o + 4] = Math.random() * 0.3 * kick; St[o + 5] = (Math.random() - 0.5) * kick;
    St[o + 6] = 0; St[o + 7] = 18 + 10 * Math.random();
    const Sd = B.shed.geometry.attributes.aSd.array;
    Sd[i * 4] = Math.random(); Sd[i * 4 + 1] = 0.4 + 0.4 * Math.random(); Sd[i * 4 + 2] = Math.random() * TAU; Sd[i * 4 + 3] = 3;
    B.shed.geometry.attributes.aSd.needsUpdate = true;
    B.shed.visible = true;
  };

  // SEAT: shape the asleep clutch to her bed (called after her dormant pose is written, and
  // again whenever she is placed or her sculpt lands). Picks the side the clutch spills out
  // on, rests every lobe on the seabed, builds the beads/hairs once, and lays the trail.
  B.seat = () => {
    const bw = L.body.matrixWorld;
    L.body.updateMatrixWorld();
    _inv.copy(bw).invert();
    // floor height in shell units under local (x, z) (two passes: she is tilted a little)
    const floorL = (x, z) => {
      let y = -0.2;
      for (let it = 0; it < 3; it++) {
        _a.set(x, y, z).applyMatrix4(bw);
        const h = terrainH(_a.x, _a.z, idx);
        _b.set(x, y + 1, z).applyMatrix4(bw);
        const dy = _b.y - _a.y;
        y += (h - _a.y) / (Math.abs(dy) > 1e-4 ? dy : 1e-4);
      }
      return y;
    };
    // the spill side: round her rear half, the bearing whose rim stands clear of the floor
    // (room to see under it), whose ground beyond is walkable and out of the rift's bowl
    const rp = riftPos(idx);
    let bestS = -1e9, bestTh = -Math.PI / 2;
    for (let j = -13; j <= 13; j++) {
      const th = -Math.PI / 2 + j * 0.1;
      const c = Math.cos(th), s = Math.sin(th), rr = G.rimR(th);
      const gap = -0.02 - floorL(c * rr * 0.97, s * rr * 0.97);         // rim underside over the floor (shell units)
      _a.set(c * rr * 1.25, 0, s * rr * 1.25).applyMatrix4(bw);
      const ny = terrainNormal(_a.x, _a.z, idx).y;
      const dRift = Math.hypot(_a.x - rp.x, _a.z - rp.z) / (RIFT_R * 3.2);
      const ground = floorL(c * rr * 1.25, s * rr * 1.25) - floorL(c * rr * 0.97, s * rr * 0.97);   // does the ground rise beyond?
      let sc = -Math.abs(j) * 0.04;                                    // the rear is the natural place
      sc += clamp(gap * R, -3, 4) * 0.6;                               // headroom under the rim
      sc -= Math.max(0, ground * R - 1.5) * 0.5;                       // a bank beyond buries it
      sc += ny > 0.85 ? 1.5 : ny > 0.7 ? 0.5 : -2;                     // he can stand there
      sc += dRift > 1.05 ? 1.2 : dRift > 0.9 ? 0 : -1.5;               // not down in the bowl
      if (sc > bestS) { bestS = sc; bestTh = th; }
    }
    B.bear = bestTh;
    const bc = Math.cos(bestTh), bs = Math.sin(bestTh), rim = G.rimR(bestTh);
    // the main lobes, asleep: bedded, resting on the floor, never above the belly
    for (let k = 0; k < MAIN.length; k++) {
      const lb = B.lobes[k], [x, , z, r0] = MAIN[k];
      const fl = floorL(x, z);
      let r = r0, y = fl + 0.75 * r;
      if (y > -0.118 - 0.55 * r) { y = -0.118 - 0.55 * r; }
      lb.s = [x, y, z, r];
      lb.open = false;
    }
    // the spill: a tongue of lobes from under the apron out past the rim, on the floor
    const r0s = Math.hypot(MAIN[0][0], MAIN[0][2] + 0.0);
    const start = 0.30, end = rim * 1.12, nS = SPILL_MAX;
    for (let k = 0; k < nS; k++) {
      const lb = B.lobes[MAIN.length + k], f = k / (nS - 1);
      const rho = start + (end - start) * f;
      // two staggered rows, so the tongue is a broad heap and not a string of balls
      const sw = (k & 1 ? -1 : 1) * 0.055 * (0.5 + f);
      const x = bc * rho - bs * sw, z = bs * rho + bc * sw, fl = floorL(x, z);
      let r = 0.12 - 0.035 * f;
      let y = fl + 0.32 * r;
      const under = rho < rim * 0.98;
      if (under && y > -0.12 - 0.5 * r) { y = -0.12 - 0.5 * r; }
      lb.s = [x, y, z, r];
      // open: its top stands above the floor out where he can reach it
      lb.open = rho > rim * 0.78 && (y + r - fl) * R > 0.4;
      // standing it folds back into the hanging mass
      lb.h = [MAIN[0][0] + bc * 0.035 * f, MAIN[0][1] - 0.01, MAIN[0][2] + bs * 0.035 * f, 0.10];
    }
    if (!B.lobes.some(l => l.open)) B.lobes[B.nL - 1].open = B.lobes[B.nL - 2].open = true;
    void r0s;
    // the take point: the outermost open lobe's top, in world space
    {
      const lb = B.lobes[B.nL - 1];
      _a.set(lb.s[0], lb.s[1] + lb.s[3] * 0.6, lb.s[2]).applyMatrix4(bw);
      B.takeAt.copy(_a);
      B.notch = 0.42;                                     // the drift stays off +-0.42 rad round the bearing
    }
    // core lobes
    {
      const g = B.core.geometry, P0 = g.attributes.aP0.array, P1 = g.attributes.aP1.array, Sd = g.attributes.aSd.array;
      for (let k = 0; k < B.nL; k++) {
        const lb = B.lobes[k], o = k * 4;
        for (let c = 0; c < 3; c++) { P0[o + c] = lb.s[c]; P1[o + c] = lb.h[c]; }
        P0[o + 3] = lb.s[3] - RB * 0.35; P1[o + 3] = lb.h[3] - RB * 0.35;
        Sd[o] = lb.seed; Sd[o + 1] = 0.55 + 0.2 * rnd(); Sd[o + 2] = RB * 2.1; Sd[o + 3] = 1;
      }
      g.attributes.aP0.needsUpdate = g.attributes.aP1.needsUpdate = g.attributes.aSd.needsUpdate = true;
    }
    buildBeads();
    if (!B.trailBuilt) { B.trailBuilt = true; buildTrail(); }
    B.seated = true;
    return B;
  };

  // the beads on the lobes' union surface, kept where they show in either state
  const buildBeads = () => {
    const br = seededRand(0xBEAD5 + idx * 7);
    const bw = L.body.matrixWorld;
    const lobes = B.lobes, nL = B.nL;
    const inside = (x, y, z, st, self) => {
      for (let j = 0; j < nL; j++) {
        if (j === self) continue;
        const c = st ? lobes[j].h : lobes[j].s;
        const dx = x - c[0], dy = y - c[1], dz = z - c[2];
        if (dx * dx + dy * dy + dz * dz < c[3] * c[3] * 0.94) return true;
      }
      // in her (under the shell plan, above the belly plane)
      const rho = Math.hypot(x, z), th = Math.atan2(z, x);
      if (rho < G.rimR(th) * 0.93 && y > -0.112) return true;
      return false;
    };
    const buried = (x, y, z) => { _a.set(x, y, z).applyMatrix4(bw); return _a.y < terrainH(_a.x, _a.z, idx) - RB * R * 0.5; };
    const P0 = [], P1 = [], SD = [];
    for (let k = 0; k < nL; k++) {
      const s = lobes[k].s, h = lobes[k].h, sd = lobes[k].seed * 10;
      const rMax = Math.max(s[3], h[3]) * 1.1;
      const N = Math.round(3.4 * (rMax / RB) * (rMax / RB));
      const ga = br() * TAU;
      for (let i = 0; i < N; i++) {
        const y = 1 - 2 * (i + 0.5) / N, rr = Math.sqrt(Math.max(0, 1 - y * y)), ph = i * 2.399963 + ga;
        const dx = Math.cos(ph) * rr, dy = y, dz = Math.sin(ph) * rr, lf = lump(dx, dy, dz, sd);
        const jr = 0.85 + 0.35 * br();
        const sx = s[0] + dx * s[3] * lf, sy = s[1] + dy * s[3] * lf, sz = s[2] + dz * s[3] * lf;
        const hx = h[0] + dx * h[3] * lf, hy = h[1] + dy * h[3] * lf, hz = h[2] + dz * h[3] * lf;
        const showS = !inside(sx, sy, sz, 0, k) && !buried(sx, sy, sz);
        const showH = !inside(hx, hy, hz, 1, k);
        if (!showS && !showH) { br(); br(); continue; }
        const rb = RB * jr;
        P0.push(sx, sy, sz, showS ? rb : 0); P1.push(hx, hy, hz, showH ? rb : 0);
        // development: mostly eyed amber-brown, a fresher patch on the front lobes
        const stg = clamp(0.66 + 0.2 * Math.sin(hx * 9 + hz * 7) - (hz > -0.1 && hx > 0 ? 0.3 : 0) + (br() - 0.5) * 0.3, 0.05, 0.98);
        SD.push(br(), stg, br() * TAU, 0);
      }
    }
    // the hairs, and the beads that hang on the ones poking out of the mass
    const ST = { r0: [], r1: [], t0: [], t1: [] };
    for (let i = 0; i < SETAE_N; i++) {
      // weighted toward the big lobes; a third run from the apron down into the mass
      let k = Math.floor(br() * nL);
      if (lobes[k].spill && br() < 0.4) k = Math.floor(br() * MAIN.length);
      const s = lobes[k].s, h = lobes[k].h;
      const a = br() * TAU, y = -0.15 - 0.85 * br(), rr = Math.sqrt(1 - y * y);
      const dx = Math.cos(a) * rr, dy = y, dz = Math.sin(a) * rr;
      const fromApron = !lobes[k].spill && br() < 0.33;
      const f = 1.02 + 0.32 * br();
      const r0x = fromApron ? h[0] + dx * h[3] * 0.6 : 0, r0z = fromApron ? h[2] + dz * h[3] * 0.6 : 0;
      for (const [st, c, R0, T] of [[0, s, ST.r0, ST.t0], [1, h, ST.r1, ST.t1]]) {
        if (fromApron && st === 1) R0.push(r0x, -0.112, r0z, br());
        else R0.push(c[0] + dx * c[3] * 0.45, c[1] + dy * c[3] * 0.45, c[2] + dz * c[3] * 0.45, st ? 0.0011 : br());
        T.push(c[0] + dx * c[3] * f, c[1] + dy * c[3] * f, c[2] + dz * c[3] * f, 0);
      }
      ST.r1[ST.r1.length - 1] = 0.0011 * (0.7 + 0.6 * br());
      if (fromApron) { ST.r0[ST.r0.length - 4] = r0x; ST.r0[ST.r0.length - 3] = -0.112; ST.r0[ST.r0.length - 2] = r0z; }
      // a bunch of beads near the free tip (eggs on their stalks, like grapes)
      if (f > 1.12) {
        const nb = 2 + Math.floor(br() * 4);
        for (let b = 0; b < nb; b++) {
          const tt = 0.75 + 0.25 * br(), off = RB * 1.6;
          const ox = (br() - 0.5) * off, oy = (br() - 0.5) * off, oz = (br() - 0.5) * off;
          const sx = s[0] + dx * s[3] * f * tt + ox, sy = s[1] + dy * s[3] * f * tt + oy, sz = s[2] + dz * s[3] * f * tt + oz;
          const hx = h[0] + dx * h[3] * f * tt + ox, hy = h[1] + dy * h[3] * f * tt + oy, hz = h[2] + dz * h[3] * f * tt + oz;
          const showS = !buried(sx, sy, sz) && !inside(sx, sy, sz, 0, -1), showH = !inside(hx, hy, hz, 1, -1);
          const rb = RB * (0.8 + 0.3 * br());
          P0.push(sx, sy, sz, showS ? rb : 0); P1.push(hx, hy, hz, showH ? rb : 0);
          SD.push(br(), 0.5 + 0.3 * br(), br() * TAU, 0);
        }
      }
    }
    // thin to the budget (deterministic: every k-th dropped)
    let n = P0.length / 4;
    const keep = n > MAXB ? MAXB / n : 1;
    const g = beadSet(_geoN, Math.min(n, MAXB), false);
    const A0 = g.attributes.aP0.array, A1 = g.attributes.aP1.array, AS = g.attributes.aSd.array;
    let m = 0, acc = 0;
    for (let i = 0; i < n && m < MAXB; i++) {
      acc += keep; if (acc < 1) continue; acc -= 1;
      for (let c = 0; c < 4; c++) { A0[m * 4 + c] = P0[i * 4 + c]; A1[m * 4 + c] = P1[i * 4 + c]; AS[m * 4 + c] = SD[i * 4 + c]; }
      m++;
    }
    g.instanceCount = m;
    B.nBeads = m;
    if (B.beadsN) { B.beadsN.geometry.dispose(); B.beadsF.geometry.dispose(); L.body.remove(B.beadsN, B.beadsF); }
    B.beadsN = new THREE.Mesh(g, matN);
    B.beadsF = new THREE.Mesh(shareSet(g, _geoF), matF);
    B.scarSave = new Float32Array(m * 2);
    g.boundingSphere = B.beadsF.geometry.boundingSphere = B.core.geometry.boundingSphere;
    for (const o of [B.beadsN, B.beadsF]) { o.castShadow = false; o.receiveShadow = true; L.body.add(o); }
    // setae
    const sg = new THREE.InstancedBufferGeometry();
    sg.index = _geoS.index; sg.setAttribute('position', _geoS.attributes.position); sg.setAttribute('normal', _geoS.attributes.normal);
    const ns = ST.r0.length / 4;
    sg.setAttribute('aR0', new THREE.InstancedBufferAttribute(new Float32Array(ST.r0), 4));
    sg.setAttribute('aR1', new THREE.InstancedBufferAttribute(new Float32Array(ST.r1), 4));
    sg.setAttribute('aT0', new THREE.InstancedBufferAttribute(new Float32Array(ST.t0), 4));
    sg.setAttribute('aT1', new THREE.InstancedBufferAttribute(new Float32Array(ST.t1), 4));
    sg.instanceCount = ns;
    if (B.setae) { B.setae.geometry.dispose(); L.body.remove(B.setae); }
    sg.boundingSphere = B.core.geometry.boundingSphere;
    B.setae = new THREE.Mesh(sg, sMat);
    B.setae.castShadow = false;
    L.body.add(B.setae);
  };

  // ---- the old ground she came over: tracks, a shed shell, spent casings ----
  const buildTrail = () => {
    const to = V3(L.pos.x, 0, L.pos.z);
    // the shed shell lies on the trail ~34 u out from her, the casings drift round it
    _v.subVectors(trailFrom, to).setY(0).normalize();
    B.shellsAt.copy(to).addScaledVector(_v, 34);
    B.shellsAt.y = terrainH(B.shellsAt.x, B.shellsAt.z, idx);
    // THE SHED SHELL: a younger Velkath's carapace (her own lathe at low resolution), pale
    // as a lantern glass, split along the back, half in the silt
    {
      const mg = G.carapaceGeo(72, 22, 6);
      const mat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xb9b19c, vertexColors: true, roughness: 0.7, metalness: 0, envMap: envTex, envMapIntensity: 0.3, side: THREE.DoubleSide }));
      mat.customProgramCacheKey = () => 'brood|molt';
      const molt = new THREE.Mesh(mg, mat);
      const s = R * 0.42;
      molt.scale.set(s, s * 0.8, s);
      const yaw = rnd() * TAU;
      molt.rotation.set(0.18 * (rnd() - 0.5), yaw, 0.32 + 0.1 * rnd());
      molt.position.set(B.shellsAt.x, B.shellsAt.y - s * 0.05, B.shellsAt.z);
      molt.castShadow = molt.receiveShadow = true;
      grp.add(molt);
      B.molt = molt;
    }
    // SPENT CASINGS: the hatched eggs' skins, collapsed, drifting on the silt round the shell
    // and thinning out along the trail in toward her
    {
      const g = beadSet(_geoN, CASE_N, false), P0 = g.attributes.aP0.array, P1 = g.attributes.aP1.array, Sd = g.attributes.aSd.array;
      const rw = RB * R * 1.1;
      for (let i = 0; i < CASE_N; i++) {
        let x, z;
        if (i < CASE_N * 0.6) { const a = rnd() * TAU, r = Math.pow(rnd(), 0.6) * 9; x = B.shellsAt.x + Math.cos(a) * r; z = B.shellsAt.z + Math.sin(a) * r; }
        else { const f = rnd(); x = B.shellsAt.x + (to.x - B.shellsAt.x) * f * 0.8 + (rnd() - 0.5) * 6; z = B.shellsAt.z + (to.z - B.shellsAt.z) * f * 0.8 + (rnd() - 0.5) * 6; }
        const y = terrainH(x, z, idx) + rw * 0.35 + (rnd() < 0.1 ? 0.3 + rnd() * 0.8 : 0);
        const o = i * 4;
        P0[o] = P1[o] = x; P0[o + 1] = P1[o + 1] = y; P0[o + 2] = P1[o + 2] = z; P0[o + 3] = P1[o + 3] = rw * (0.7 + 0.5 * rnd());
        Sd[o] = rnd(); Sd[o + 1] = 1; Sd[o + 2] = rnd() * TAU; Sd[o + 3] = 2;
      }
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(B.shellsAt.x, B.shellsAt.y, B.shellsAt.z), Math.hypot(to.x - B.shellsAt.x, to.z - B.shellsAt.z) + 12);
      const cs = new THREE.Mesh(g, matN);
      cs.castShadow = false;
      grp.add(cs);
      B.casings = cs;
    }
    // the trail: rows of paired pits, many legs, from the open seabed in to her
    const pitGeo = new THREE.CircleGeometry(0.55, 10);
    pitGeo.rotateX(-Math.PI / 2);
    pitGeo.scale(1, 1, 1.6);
    const pits = new THREE.InstancedMesh(pitGeo, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false
    }), 160);
    pits.renderOrder = -1;
    let n = 0;
    const steps = 40;
    const dx = to.x - trailFrom.x, dz = to.z - trailFrom.z, dl = Math.hypot(dx, dz) || 1;
    const px = -dz / dl, pz = dx / dl, yaw = Math.atan2(dx, dz);
    for (let k = 0; k < steps && n < 160; k++) {
      const f = k / (steps - 1);
      const bend = Math.sin(f * Math.PI) * 14;
      _v.lerpVectors(trailFrom, to, f);
      if (Math.hypot(_v.x - to.x, _v.z - to.z) < R * 1.25) break;     // up to her
      const cx = _v.x + px * bend, cz = _v.z + pz * bend;
      for (const sd of [-1, 1]) for (const off of [11, 15]) {
        if (n >= 160) break;
        const x = cx + px * sd * off + (rnd() - 0.5) * 1.2, z = cz + pz * sd * off + (rnd() - 0.5) * 1.2;
        _n.copy(terrainNormal(x, z, idx));
        _q.setFromUnitVectors(_up, _n).multiply(new THREE.Quaternion().setFromAxisAngle(_up, yaw + (rnd() - 0.5) * 0.5));
        pits.setMatrixAt(n++, _m.compose(_v.set(x, terrainH(x, z, idx) + 0.04, z), _q, _w.setScalar(0.8 + 0.5 * rnd())));
      }
    }
    pits.count = n;
    pits.instanceMatrix.needsUpdate = true;
    grp.add(pits);
  };

  // Per frame: the clutch breathes and rises with her; the clump rides at his free hand and
  // sheds; loose beads sink and settle; the trail announces itself once each as it is found.
  B.update = (dt, player, ev) => {
    B.t += dt;
    // calmed she keeps it clamped under her (it does not spill again where she settles)
    B.st = L.calmed ? 1 : L.standE;
    liveLobes();
    const uN = matN.userData.u, uF = matF.userData.u, uS = sMat.userData.u;
    uN.uStand.value = uF.uStand.value = uS.uStand.value = B.st;
    uN.uTime.value = uF.uTime.value = uS.uTime.value = B.t;
    // asleep she fans it slowly; awake she clamps the apron down (it barely moves)
    uN.uBreath.value = uF.uBreath.value = L.dormant ? 1 : 0.35;
    // the fanning lifts a breath of silt off the open lobes now and then
    if (L.dormant && B.seated && (B.fanT -= dt) <= 0) {
      B.fanT = 5 + 4 * Math.random();
      emitDust(B.takeAt.x + (Math.random() - 0.5) * 2, B.takeAt.y - 0.3, B.takeAt.z + (Math.random() - 0.5) * 2, 4, 0.8);
    }
    if (B.held >= 0) {
      // the other hand: the lantern's, mirrored across his heading
      lanternWorldPos(_lant);
      const yaw = player.yaw || 0, rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const vx = _lant.x - player.pos.x, vz = _lant.z - player.pos.z, side = vx * rx + vz * rz;
      _a.set(_lant.x - 2 * side * rx, _lant.y - 0.28, _lant.z - 2 * side * rz);
      if (Math.abs(side) < 0.2) _a.set(player.pos.x - rx * 0.55, player.pos.y - 0.85, player.pos.z - rz * 0.55);
      B.carryT += dt;
      const k = Math.min(1, B.carryT / 0.35);
      B.clump.position.lerpVectors(B.clumpAt, _a, k * k * (3 - 2 * k));
      B.clump.rotation.set(0.25 * Math.sin(B.t * 1.1), yaw + 0.3 * Math.sin(B.t * 0.7), 0.2 * Math.sin(B.t * 0.9));
      // it sheds: a bead every second or two, more when he hurries
      const sp = Math.hypot(player.vel.x, player.vel.z, player.vel.y);
      if ((B.shedT -= dt * (1 + sp * 0.6)) <= 0) { B.shedT = 1.4 + 1.6 * Math.random(); shedOne(B.clump.position, 0.4); }
    }
    if (B.shed.visible) {
      const St = B.shedSt, g = B.shed.geometry, P0 = g.attributes.aP0.array, P1 = g.attributes.aP1.array, rw = RB * R;
      let live = 0;
      for (let i = 0; i < SHED_N; i++) {
        const o = i * 8;
        if (St[o + 7] <= 0) { P0[i * 4 + 3] = P1[i * 4 + 3] = 0; continue; }
        St[o + 6] += dt;
        if (St[o + 6] > St[o + 7]) { St[o + 7] = 0; P0[i * 4 + 3] = P1[i * 4 + 3] = 0; continue; }
        live++;
        const fl = terrainH(St[o], St[o + 2], idx) + rw * 0.8;
        if (St[o + 1] > fl) {
          St[o + 4] += (-0.32 - St[o + 4]) * Math.min(1, 1.5 * dt);   // sinks to a slow terminal fall
          St[o + 3] *= 1 - Math.min(1, 0.8 * dt); St[o + 5] *= 1 - Math.min(1, 0.8 * dt);
          St[o] += St[o + 3] * dt; St[o + 1] += St[o + 4] * dt; St[o + 2] += St[o + 5] * dt;
          if (St[o + 1] < fl) St[o + 1] = fl;
        }
        const fade = Math.min(1, (St[o + 7] - St[o + 6]) / 3);
        P0[i * 4] = P1[i * 4] = St[o]; P0[i * 4 + 1] = P1[i * 4 + 1] = St[o + 1]; P0[i * 4 + 2] = P1[i * 4 + 2] = St[o + 2];
        P0[i * 4 + 3] = P1[i * 4 + 3] = rw * 0.95 * fade;
      }
      g.attributes.aP0.needsUpdate = g.attributes.aP1.needsUpdate = true;
      B.shedLive = live;
      if (!live && B.held < 0) B.shed.visible = false;
    }
    if (ev.msg) return;
    const F = B.found, p = player.pos;
    const near = (q, r) => Math.hypot(p.x - q.x, p.z - q.z) < r && Math.abs(p.y - q.y) < 10;
    if (!F.tracks && near(B.trailA, 30)) { F.tracks = true; ev.msg = 'TRACKS IN THE SILT. MANY LEGS, AND HEAVY.'; }
    else if (!F.shells && near(B.shellsAt, 12)) { F.shells = true; ev.msg = 'A SHED SHELL, SPLIT DOWN THE BACK. EMPTY EGG SKINS ROUND IT.'; }
    else if (!F.nest && L.dormant && B.seated && near(B.takeAt, 11)) { F.nest = true; ev.msg = 'A CLUTCH UNDER HER. EGGS BY THE THOUSAND, AND EVERY ONE HAS AN EYE.'; }
  };
  return B;
}
