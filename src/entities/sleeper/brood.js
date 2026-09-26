// THE BROOD — Velkath's nest, eggs and the trail to them (roadmap/three-sleepers.md,
// spec §2 zone 0 and §3). Owned by the Brooder: built into her L.grp, so a zone change,
// voyage or reseed disposes it with her (disposeSleeper's traversal).
//
// The rite, in the world's own grammar:
//   * she sleeps over the zone-0 rift, a reef-crusted ridge in the silt;
//   * a trail of many-legged tracks runs from the open seabed toward her nest in her
//     lee, past the broken shells of an old clutch — found, not signposted;
//   * the nest holds three eggs, each the size of Sal's helmet, faintly warm;
//   * taking one wakes her (brooder.js hears it through brood.onTake);
//   * her last ward will not light while any egg is out of the nest; with all three
//     back it lights on its own.
// Eggs are carried one at a time, held at Sal's side, taken/returned with [E].
import * as THREE from 'three';
import { V3, clamp } from '../../lib/math.js';
import { seededRand, rockMapSet, eggSkinSet } from '../../lib/textures.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerPaint } from '../../lib/paint.js';
import { envTexDeep as envTex } from '../../core.js';
import { terrainH, terrainNormal, terrainMeshes } from '../../world/terrain.js';

const TAU = Math.PI * 2;
const TAKE_R = 3.2, NEST_R = 5.5;
const _v = V3(), _n = V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = V3(), _up = V3(0, 1, 0);

// POLISH-PROPS (2026-09-25): the eggs, shards and nest stones are generated forms with
// their own skins. Rite contract untouched: egg homes, take/return radii, the B.*
// interface and every rnd() draw (count and order) are exactly the shipped ones.

// The egg's shape: a blunt ovoid, narrow end up (unit sphere in, egg units out).
function eggShape(x, y, z) {
  const k = y > 0 ? 1 - 0.18 * y : 1;
  return [x * 0.52 * k, y * 0.70, z * 0.52 * k];
}

// One egg: the ovoid at a resolution that holds its silhouette at arm's length. The
// skin (veins, pebbling, warmth) is all in the material; the vertex colour keeps a
// faint large mottle, aShell = 0 (a living egg: it glows).
function eggGeo() {
  const g = new THREE.SphereGeometry(1, 36, 26);
  const p = g.attributes.position, c = new Float32Array(p.count * 3), rnd = seededRand(0xE665);
  const spots = Array.from({ length: 22 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = eggShape(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, x, y, z);
    let d = 1;
    for (const [a, b, e] of spots) d = Math.min(d, Math.hypot(x / 0.52 - a, y / 0.7 - b, z / 0.52 - e));
    const m = 0.86 + 0.14 * Math.min(1, d * 3.2);
    c[i * 3] = m; c[i * 3 + 1] = m * 0.97; c[i * 3 + 2] = m * 0.92;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aShell', new THREE.BufferAttribute(new Float32Array(p.count), 1));
  g.computeVertexNormals();
  return g;
}

// A shell shard: a curved piece of the same ovoid with a BROKEN rim — a jagged outline
// (a noisy radius in the patch's own angular frame), real thickness (inner skin +
// rim wall), the inside a pale dried membrane, the rim bone-white where it snapped.
// aShell = 1: dead shell, no warmth in it. ONE geometry for all twelve instances.
function shardGeo() {
  const rnd = seededRand(0x5AADD);
  const RR = 9, SS = 28, TH = 0.035;                       // rings, rim samples, thickness
  // a broken outline: a wandering radius with a few deep notches, never a regular crown
  const jag0 = Array.from({ length: SS }, () => rnd());
  const jag = jag0.map((v, j) => { const a = jag0[(j + SS - 1) % SS], b = jag0[(j + 1) % SS]; const w = (a + 2 * v + b) / 4; return 0.55 + 0.4 * w + (v > 0.86 ? -0.22 : 0) + (v < 0.08 ? 0.12 : 0); });
  const pos = [], col = [], idx = [];
  const onEgg = (r, a) => {                                // patch param -> unit sphere
    const th = r * 1.05;                                   // a cap about the narrow pole (+y)
    return [Math.sin(th) * Math.cos(a), Math.cos(th), Math.sin(th) * Math.sin(a)];
  };
  const put = (u, w, inset, c) => {
    let [x, y, z] = eggShape(...u);
    const l = Math.hypot(x, y, z);
    x -= x / l * inset; y -= y / l * inset; z -= z / l * inset;
    pos.push(x, y, z); col.push(...c);
  };
  const OUT = [0.72, 0.69, 0.63], INN = [0.95, 0.92, 0.84], RIM = [1.15, 1.12, 1.02];
  for (const side of [0, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= RR; i++) for (let j = 0; j < SS; j++) {
      const r = i / RR * jag[j], a = j / SS * Math.PI * 2;
      put(onEgg(r, a), 0, side ? TH : 0, side ? INN : OUT);
    }
    for (let i = 0; i < RR; i++) for (let j = 0; j < SS; j++) {
      const j1 = (j + 1) % SS, a0 = base + i * SS + j, a1 = base + i * SS + j1, b0 = a0 + SS, b1 = a1 + SS;
      if (side) idx.push(a0, b0, a1, a1, b0, b1); else idx.push(a0, a1, b0, a1, b1, b0);
    }
  }
  // the rim wall: outer edge ring to inner edge ring, bone-white
  const base = pos.length / 3;
  for (let j = 0; j < SS; j++) {
    const a = j / SS * Math.PI * 2, u = onEgg(jag[j], a);
    put(u, 0, 0, RIM); put(u, 0, TH, RIM);
  }
  for (let j = 0; j < SS; j++) {
    const j1 = (j + 1) % SS, o0 = base + j * 2, i0 = o0 + 1, o1 = base + j1 * 2, i1 = o1 + 1;
    idx.push(o0, i0, o1, o1, i0, i1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aShell', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(1), 1));
  g.setIndex(idx);
  // apex at the origin: placed flipped (as shipped, Euler x ~ PI) it lies as a bowl on
  // its crown, broken rim up
  g.translate(0, -0.66, 0);
  g.computeVertexNormals();
  return g;
}

// THE EGG SKIN: leathery, pebbled, veined (lib/textures.js eggSkinSet), projected
// triplanar in the egg's OWN space (it is carried about, so world space would swim).
// Translucency without a new light: the clutch's warmth (the material's pulsing
// emissive) shows THROUGH the skin — strongest where the eye looks into the egg's
// thickness, blocked as dark branching shadows by the veins — plus a warm wrap of the
// key light round the terminator. Shards (aShell = 1) are dead shell: no warmth.
const EGG_VS = `
attribute float aShell;
varying vec3 vEggP; varying vec3 vEggN; varying float vShell;`;
const EGG_FS_HEAD = `
uniform sampler2D uEggPack, uEggNrm;
varying vec3 vEggP; varying vec3 vEggN; varying float vShell;
vec4 eggTri(sampler2D t, vec3 p, vec3 w) {
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}`;
const EGG_FS_NORMAL = `
vec3 eggW = pow(abs(normalize(vEggN)), vec3(4.0)); eggW /= (eggW.x + eggW.y + eggW.z);
vec3 eggQ = vEggP * 0.95 + 0.37;
vec4 eggPk = eggTri(uEggPack, eggQ, eggW);
{
  // skin relief: the baked height's screen gradient (surface-gradient bump), faded
  // with range so the pebbling never sparkles at nine units
  float hgt = (eggPk.b - 0.3) * 0.006 * (1.0 - smoothstep(0.004, 0.03, length(fwidth(vEggP))));
  vec3 pv = -vViewPosition, dx = dFdx(pv), dy = dFdy(pv), r1 = cross(dy, normal), r2 = cross(normal, dx);
  float det = dot(dx, r1);
  vec3 grd = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
  normal = normalize(abs(det) * normal - grd);
}`;
const EGG_FS_SURF = `
{
  float vein = eggPk.r, mot = eggPk.a;
  // albedo: a warm ivory-grey leather, mottled, veins faintly rose under the skin
  vec3 skin = diffuseColor.rgb * mix(0.82, 1.08, mot);
  skin = mix(skin, vec3(0.16, 0.05, 0.035), smoothstep(0.1, 0.9, vein) * 0.6 * (1.0 - vShell));
  skin = mix(skin, skin * vec3(0.95, 0.9, 0.8), vShell * 0.3);
  diffuseColor.rgb = skin;
  roughnessFactor = mix(eggPk.g * 0.8 + 0.2, 0.9, vShell * 0.5);
  float NdV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float thick = 0.35 + 0.65 * pow(NdV, 1.4);
  // the vessels stand in the glow as deep red shadows (blood lit from behind)
  vec3 veinTint = mix(vec3(1.0), vec3(0.42, 0.10, 0.06), smoothstep(0.1, 0.8, vein));
  vec3 warm = totalEmissiveRadiance * vec3(1.15, 0.72, 0.45);
  totalEmissiveRadiance = warm * thick * veinTint * (1.0 - vShell) * 2.4;
}`;
const EGG_FS_WRAP = `
#if NUM_DIR_LIGHTS > 0
{
  // translucent wrap: the key light bleeds past the terminator as a warm rim
  vec3 L0 = directionalLights[ 0 ].direction;
  float wrapK = clamp((dot(normal, L0) + 0.45) / 1.45, 0.0, 1.0) - clamp(dot(normal, L0), 0.0, 1.0);
  reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.75, 0.6) * directionalLights[ 0 ].color * max(wrapK, 0.0) * 0.45 * (1.0 - vShell);
}
#endif`;
function eggMaterial() {
  const E = eggSkinSet();
  const m = new THREE.MeshStandardMaterial({
    color: 0x9c907a, roughness: 0.5, metalness: 0, vertexColors: true, envMap: envTex, envMapIntensity: 0.45,
    emissive: 0x9a6428, emissiveIntensity: 0.25
  });
  m.onBeforeCompile = sh => {
    sh.uniforms.uEggPack = { value: E.pack }; sh.uniforms.uEggNrm = { value: E.nrm };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + EGG_VS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEggP = position; vEggN = normal; vShell = aShell;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + EGG_FS_HEAD)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + EGG_FS_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + EGG_FS_SURF)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + EGG_FS_WRAP);
  };
  m.customProgramCacheKey = () => 'brood|egg';
  return m;
}

// THE NEST STONES: water-rounded cobbles, each its own noise-displaced sphere (a
// squashed, slightly asymmetric pebble — no cleavage: these were rolled, not broken),
// merged into ONE mesh, half-buried. Surface = flora's rock grammar (lib/textures.js
// rockMapSet(0), triplanar in WORLD space by the geometric normal, whiteout-blended
// normals, silt on the up faces, a wet sheen under the lantern) in one small program.
// Vertex colour: per-stone tone, darkened toward the buried foot (the damp contact).
const STONE_VS = `
varying vec3 vStW; varying vec3 vStN;`;
const STONE_FS_HEAD = `
uniform sampler2D uRockPack, uRockNrm; uniform vec3 uSilt;
varying vec3 vStW; varying vec3 vStN;
vec4 stTri(sampler2D t, vec3 p, vec3 w, float f) {
  return texture2D(t, p.zy * f) * w.x + texture2D(t, p.xz * f) * w.y + texture2D(t, p.xy * f) * w.z;
}
vec3 stNrm(vec3 p, vec3 n, vec3 w, float f, float k) {
  vec3 tx = texture2D(uRockNrm, p.zy * f).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(uRockNrm, p.xz * f).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(uRockNrm, p.xy * f).xyz * 2.0 - 1.0;
  vec3 wx = vec3(tx.xy * k + n.zy, abs(tx.z) * n.x);
  vec3 wy = vec3(ty.xy * k + n.xz, abs(ty.z) * n.y);
  vec3 wz = vec3(tz.xy * k + n.xy, abs(tz.z) * n.z);
  return normalize(wx.zyx * w.x + wy.xzy * w.y + wz.xyz * w.z);
}`;
const STONE_FS = `
{
  vec3 wN = normalize(vStN);
  vec3 bw = pow(abs(wN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  vec4 pd = stTri(uRockPack, vStW, bw, 0.55);
  vec4 pc = stTri(uRockPack, vStW + vec3(3.1, 7.7, 1.3), bw, 0.13);
  diffuseColor.rgb *= (pd.r * 1.6) * mix(1.0, pc.r * 1.6, 0.5);
  vec3 wN2 = stNrm(vStW, wN, bw, 0.55, 0.45);
  normal = normalize((viewMatrix * vec4(wN2, 0.0)).xyz);
  float up = wN.y;
  float silt = smoothstep(0.45, 0.95, up) * smoothstep(0.35, 0.75, pc.b + 0.25);
  diffuseColor.rgb = mix(diffuseColor.rgb, uSilt, silt * 0.55);
  diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(-0.8, 0.2, up));
  float wet = 1.0 - smoothstep(4.0, 18.0, length(vViewPosition));
  roughnessFactor = clamp(mix(0.72, 1.0, pd.g) - wet * 0.22 * (1.0 - silt), 0.5, 1.0);
}`;
function stoneMaterial() {
  const RS = rockMapSet(0);
  // flora's zone-0 rock albedo (dark on purpose: wet stone reads by its highlight)
  const m = new THREE.MeshStandardMaterial({ color: 0x3a4448, vertexColors: true, roughness: 0.9, metalness: 0, envMap: envTex, envMapIntensity: 0.12 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uRockPack: { value: RS.pack }, uRockNrm: { value: RS.nrm }, uSilt: { value: new THREE.Color(0x2c4152) } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + STONE_VS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvStW = (modelMatrix * vec4(transformed, 1.0)).xyz; vStN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + STONE_FS_HEAD)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + STONE_FS);
  };
  m.customProgramCacheKey = () => 'brood|stone';
  return m;
}

// Value noise for the stone shapes (seeded per stone from its own draws).
function _sh(x, y, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function _sn(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const f = t => t * t * (3 - 2 * t), u = f(x - X), v = f(y - Y), w = f(z - Z), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(_sh(X, Y, Z), _sh(X + 1, Y, Z), u), L(_sh(X, Y + 1, Z), _sh(X + 1, Y + 1, Z), u), v),
    L(L(_sh(X, Y, Z + 1), _sh(X + 1, Y, Z + 1), u), L(_sh(X, Y + 1, Z + 1), _sh(X + 1, Y + 1, Z + 1), u), v), w);
}
// One cobble in world space: a unit icosphere pushed by two octaves of noise, squashed
// (sq) and stretched along its own long axis, then yawed, tilted and seated.
function cobbleGeo(seed, s, yaw, tilt, pos, tone) {
  const g0 = new THREE.IcosahedronGeometry(1, 4);
  g0.deleteAttribute('normal'); g0.deleteAttribute('uv');
  const g = mergeVertices(g0); g0.dispose();
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
  const sq = 0.68 + 0.2 * _sn(seed, 1.5, 2.5), el = 1.05 + 0.3 * _sn(2.5, seed, 1.5);
  const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, tilt * 0.6)), new THREE.Vector3(s, s, s));
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.16 * (_sn(x * 1.3 + seed, y * 1.3, z * 1.3) - 0.5) + 0.05 * (_sn(x * 4 + seed, y * 4, z * 4 + 7) - 0.5);
    x *= d * el; y *= d * sq; z *= d;
    v.set(x, y, z).applyMatrix4(m);
    p.setXYZ(i, v.x, v.y, v.z);
    const foot = Math.max(0, Math.min(1, (y / sq + 0.2) * 1.6));        // damp, darker toward the bed
    const k = tone * (0.6 + 0.4 * foot);
    col[i * 3] = k * 0.98; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 1.03;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// THE BERM: the ring of silt she scraped up round the clutch, built as TERRAIN — the
// terrain mesh's own material with its own vertex colour, sampled at the exact
// rendered height (same idiom as wrecks.js's drift skirts), so it is seabed: same
// program, palette, caustics and ripples. An annulus whose cross-section is a soft
// bell that wanders in radius and heaps unevenly round the ring; both edges dip just
// under the mesh so the seams are buried.
let _AX = null, _AN = 0;
function _axFind(ax, x) {
  let lo = 0, hi = ax.length - 2;
  if (x <= ax[0]) return 0;
  if (x >= ax[hi + 1]) return hi;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ax[m] <= x) lo = m; else hi = m - 1; }
  return lo;
}
function terrainSample(zi, x, z, col) {
  const g = terrainMeshes[zi].geometry, P = g.attributes.position.array, C = g.attributes.color.array;
  if (!_AX) {
    _AN = Math.round(Math.sqrt(g.attributes.position.count));
    _AX = new Float32Array(_AN);
    for (let k = 0; k < _AN; k++) _AX[k] = P[k * 3];
  }
  const ax = _AX, n = _AN, k = _axFind(ax, x), j = _axFind(ax, z);
  const fx = clamp((x - ax[k]) / (ax[k + 1] - ax[k]), 0, 1), fz = clamp((z - ax[j]) / (ax[j + 1] - ax[j]), 0, 1);
  const ia = j * n + k, ib = (j + 1) * n + k, ic = (j + 1) * n + k + 1, id = j * n + k + 1;
  let wa, wb, wc, wd;
  if (fx + fz <= 1) { wa = 1 - fx - fz; wb = fz; wc = 0; wd = fx; } else { wa = 0; wb = 1 - fx; wc = fx + fz - 1; wd = 1 - fz; }
  for (let c = 0; c < 3; c++) col[c] = C[ia * 3 + c] * wa + C[ib * 3 + c] * wb + C[ic * 3 + c] * wc + C[id * 3 + c] * wd;
  return P[ia * 3 + 1] * wa + P[ib * 3 + 1] * wb + P[ic * 3 + 1] * wc + P[id * 3 + 1] * wd;
}
function bermGeo(zi, cx, cz, R) {
  const NA = 96, NR = 9, W = 1.9, col = [0, 0, 0];
  const pos = new Float32Array(NA * (NR + 1) * 3), cc = new Float32Array(NA * (NR + 1) * 3), idx = [];
  for (let a = 0; a < NA; a++) {
    const th = a / NA * TAU, cs = Math.cos(th), sn = Math.sin(th);
    const rc = R * (1 + 0.08 * (_sn(cs * 1.6 + 7, sn * 1.6, 4.5) - 0.5) * 2);
    const H = 0.22 + 0.45 * _sn(cs * 2.2 + 3, sn * 2.2, 0.5);
    for (let r = 0; r <= NR; r++) {
      const q = r / NR * 2 - 1;                              // -1 inner edge .. 1 outer edge
      const rad = rc + q * W * (q < 0 ? 0.8 : 1.1);          // a steeper inner face
      const x = cx + cs * rad, z = cz + sn * rad;
      const hm = terrainSample(zi, x, z, col);
      const bell = Math.pow(Math.cos(q * Math.PI / 2), 1.6) * (1 + 0.1 * Math.sin(th * 7 + q * 3));
      const edge = r === 0 || r === NR;
      const i = a * (NR + 1) + r;
      pos[i * 3] = x; pos[i * 3 + 1] = edge ? hm - 0.03 : hm + Math.max(0.01, H * bell); pos[i * 3 + 2] = z;
      cc[i * 3] = col[0] * (0.7 + 0.3 * bell); cc[i * 3 + 1] = col[1]; cc[i * 3 + 2] = col[2];
    }
  }
  for (let a = 0; a < NA; a++) {
    const a2 = (a + 1) % NA;
    for (let r = 0; r < NR; r++) {
      const i0 = a * (NR + 1) + r, i1 = a2 * (NR + 1) + r;
      idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(NR >> 1) < 0) {             // must face UP (terrain material is FrontSide)
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx); g.computeVertexNormals();
  }
  return g;
}

export function makeBrood(L, idx, nestPos, trailFrom) {
  const grp = L.grp;
  const rnd = seededRand(0xB700D + idx * 131 + Math.round(nestPos.x * 7 + nestPos.z * 13));
  const B = {
    nest: nestPos.clone(), eggs: [], held: -1, taken: 0, woke: false,
    found: { tracks: false, shells: false, nest: false, ridge: false },
    trailA: trailFrom.clone(), shellsAt: V3(), t: 0
  };
  B.nest.y = terrainH(B.nest.x, B.nest.z, idx);

  // ---- the nest: a shallow ring of heaped silt and stones, darker in the bowl ----
  // The nest ring was a lathe torus in a flat sand material. The berm is seabed (terrain material, see bermGeo). The material is the TERRAIN's:
  // it must never be disposed with her, so the berm leaves the group before
  // disposeSleeper's traversal (L.onDispose runs first) and frees only its geometry.
  const ring = new THREE.Mesh(bermGeo(idx, B.nest.x, B.nest.z, NEST_R * 0.9), terrainMeshes[idx].material);
  ring.receiveShadow = true;
  grp.add(ring);
  {
    const prev = L.onDispose;
    L.onDispose = () => { if (ring.parent) ring.parent.remove(ring); ring.geometry.dispose(); if (prev) prev(); };
  }
  const bowl = new THREE.Mesh(new THREE.CircleGeometry(NEST_R * 0.8, 32), new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false
  }));
  bowl.rotation.x = -Math.PI / 2;
  bowl.position.copy(B.nest).y += 0.06;
  bowl.renderOrder = -1;
  grp.add(bowl);
  // Stones: the shipped draws (a, r, s, then three euler draws) in the shipped order;
  // the euler triple now picks a yaw, a tilt and the cobble's shape seed.
  const cob = [];
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * TAU + rnd() * 0.3, r = NEST_R * (0.85 + 0.25 * rnd());
    const x = B.nest.x + Math.cos(a) * r, z = B.nest.z + Math.sin(a) * r, s = 0.5 + 0.7 * rnd();
    const e1 = rnd(), e2 = rnd(), e3 = rnd();
    // half-buried: the cobble's centre sits a little under the bed, its long axis roughly
    // along the ring (stones heaped round a nest lie along it, not across)
    cob.push(cobbleGeo(k * 13.7 + e3 * 50, s, -a + (e1 - 0.5) * 0.9, (e2 - 0.5) * 0.35,
      _v.set(x, terrainH(x, z, idx) + s * 0.08, z).clone(), 0.75 + 0.5 * e3));
  }
  const stoneGeo = mergeGeometries(cob);
  for (const g of cob) g.dispose();
  stoneGeo.computeVertexNormals();
  const stones = new THREE.Mesh(stoneGeo, registerPaint(stoneMaterial()));
  stones.castShadow = stones.receiveShadow = true;
  grp.add(stones);

  // ---- the clutch ----
  const eggMat = registerPaint(eggMaterial(), { hero: true });
  B.eggMat = eggMat;
  const eg = eggGeo();
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * TAU + 0.4, home = V3(B.nest.x + Math.cos(a) * 1.3, 0, B.nest.z + Math.sin(a) * 1.3);
    home.y = terrainH(home.x, home.z, idx) + 0.55;
    const mesh = new THREE.Mesh(eg, eggMat);
    mesh.position.copy(home);
    mesh.rotation.set(rnd() * 0.3, rnd() * TAU, rnd() * 0.3);
    mesh.castShadow = true;
    grp.add(mesh);
    B.eggs.push({ mesh, home, inNest: true, tilt: mesh.rotation.clone() });
  }

  // ---- the old clutch: broken shells on the approach ----
  _v.subVectors(trailFrom, B.nest).setY(0).normalize();
  B.shellsAt.copy(B.nest).addScaledVector(_v, 16);
  const shards = new THREE.InstancedMesh(shardGeo(), eggMat, 12);
  for (let k = 0; k < 12; k++) {
    const x = B.shellsAt.x + (rnd() - 0.5) * 7, z = B.shellsAt.z + (rnd() - 0.5) * 7;
    shards.setMatrixAt(k, _m.compose(_v.set(x, terrainH(x, z, idx) + 0.05, z),
      _q.setFromEuler(new THREE.Euler(Math.PI + (rnd() - 0.5) * 1.2, rnd() * TAU, (rnd() - 0.5) * 1.2)), _s.setScalar(0.5 + 0.5 * rnd())));
  }
  shards.instanceMatrix.needsUpdate = true;
  grp.add(shards);
  B.shellsAt.y = terrainH(B.shellsAt.x, B.shellsAt.z, idx);

  // ---- the trail: rows of paired pits, many legs, from the open seabed to the nest ----
  const pitGeo = new THREE.CircleGeometry(0.55, 10);
  pitGeo.rotateX(-Math.PI / 2);
  pitGeo.scale(1, 1, 1.6);
  const pits = new THREE.InstancedMesh(pitGeo, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false
  }), 160);
  pits.renderOrder = -1;
  let n = 0;
  const steps = 40;
  for (let k = 0; k < steps && n < 160; k++) {
    const f = k / (steps - 1);
    // a gentle curve, not a ruler line
    const bend = Math.sin(f * Math.PI) * 14;
    _v.lerpVectors(trailFrom, B.nest, f * 0.93);
    const dx = B.nest.x - trailFrom.x, dz = B.nest.z - trailFrom.z, dl = Math.hypot(dx, dz) || 1;
    const px = -dz / dl, pz = dx / dl, yaw = Math.atan2(dx, dz);
    const cx = _v.x + px * bend, cz = _v.z + pz * bend;
    for (const sd of [-1, 1]) for (const off of [11, 15]) {
      if (n >= 160) break;
      const x = cx + px * sd * off + (rnd() - 0.5) * 1.2, z = cz + pz * sd * off + (rnd() - 0.5) * 1.2;
      _n.copy(terrainNormal(x, z, idx));
      _q.setFromUnitVectors(_up, _n).multiply(new THREE.Quaternion().setFromAxisAngle(_up, yaw + (rnd() - 0.5) * 0.5));
      pits.setMatrixAt(n++, _m.compose(_v.set(x, terrainH(x, z, idx) + 0.04, z), _q, _s.setScalar(0.8 + 0.5 * rnd())));
    }
  }
  pits.count = n;
  pits.instanceMatrix.needsUpdate = true;
  grp.add(pits);
  B.trailA.y = terrainH(B.trailA.x, B.trailA.z, idx);

  // ---- behaviour ----
  B.out = () => B.eggs.filter(e => !e.inNest).length;
  B.nearEgg = pos => {
    if (B.held >= 0) return -1;
    let best = -1, bd = TAKE_R;
    for (let k = 0; k < B.eggs.length; k++) {
      const e = B.eggs[k];
      if (!e.inNest) continue;
      const d = e.mesh.position.distanceTo(pos);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  B.nearNest = pos => Math.hypot(pos.x - B.nest.x, pos.z - B.nest.z) < NEST_R + 1.5 && Math.abs(pos.y - B.nest.y) < 6;
  // The HUD prompt for the E key, or null.
  B.prompt = pos => {
    if (B.held >= 0) return B.nearNest(pos) ? '[E] SET THE EGG BACK' : null;
    return B.nearEgg(pos) >= 0 ? '[E] TAKE THE EGG' : null;
  };
  // [E]: returns { took, returned } or null. brooder.js wakes on the first take.
  B.interact = pos => {
    if (B.held >= 0) {
      if (!B.nearNest(pos)) return null;
      const e = B.eggs[B.held];
      e.inNest = true;
      e.mesh.position.copy(e.home);
      e.mesh.rotation.copy(e.tilt);
      B.held = -1;
      const out = B.out();
      return { returned: true, out, msg: out ? (out === 1 ? 'ONE EGG STILL OUT OF THE NEST.' : out + ' EGGS STILL OUT OF THE NEST.') : 'THE CLUTCH IS WHOLE.' };
    }
    const k = B.nearEgg(pos);
    if (k < 0) return null;
    B.eggs[k].inNest = false;
    B.held = k;
    B.taken++;
    if (B.onTake) B.onTake(B.taken);
    return { took: true, first: B.taken === 1, msg: B.taken === 1 ? null : 'ANOTHER EGG. SHE KNOWS.' };
  };
  // Per frame: the held egg rides at Sal's side; the clutch breathes its slow warmth;
  // the trail announces itself once each as it is found.
  B.update = (dt, player, ev) => {
    B.t += dt;
    B.eggMat.emissiveIntensity = 0.20 + 0.10 * Math.sin(B.t * 0.9);
    if (B.held >= 0) {
      const e = B.eggs[B.held], yaw = player.yaw || 0;
      e.mesh.position.set(player.pos.x + Math.sin(yaw) * 0.9 + Math.cos(yaw) * 0.6, player.pos.y + 0.9, player.pos.z + Math.cos(yaw) * 0.9 - Math.sin(yaw) * 0.6);
      e.mesh.rotation.set(0.2 * Math.sin(B.t * 1.3), yaw, 0.15 * Math.sin(B.t * 0.9));
    }
    if (ev.msg) return;
    const F = B.found, p = player.pos;
    const near = (q, r) => Math.hypot(p.x - q.x, p.z - q.z) < r && Math.abs(p.y - q.y) < 10;
    if (!F.tracks && near(B.trailA, 30)) { F.tracks = true; ev.msg = 'TRACKS IN THE SILT. MANY LEGS, AND HEAVY.'; }
    else if (!F.shells && near(B.shellsAt, 10)) { F.shells = true; ev.msg = 'SHELL, BROKEN FROM THE INSIDE. AN OLD CLUTCH.'; }
    else if (!F.nest && near(B.nest, 12)) { F.nest = true; ev.msg = 'A NEST. EGGS THE SIZE OF YOUR HELMET, WARM IN THE COLD.'; }
  };
  return B;
}
