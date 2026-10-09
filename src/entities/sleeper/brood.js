// THE CLUTCH — Velkath carries her eggs (roadmap/brooder-clutch.md; Michael 2026-10-08:
// "Clutch under her body"). Owned by the Brooder: built into her L.body / L.grp, so a zone
// change, voyage or reseed disposes it with her (disposeSleeper's traversal).
//
// REFERENCE (a berried female crab): tens of thousands of ~0.5 mm eggs held as a spongy mass
// under the folded abdomen, glued to the setae (hairs) of the pleopods; bright orange when
// fresh, darkening to brown/grey with dark EYESPOTS as the embryos develop; she aerates the
// mass by fanning the abdomen. Velkath is a colossus, so the mass is ~9 u across and its eggs
// are ~0.08 u across (true to her scale): far too many to draw one by one, so the mass is a
// GRANULAR SURFACE. Each lobe's skin carries a generated BEAD FIELD (beadField(): two tiling
// textures of packed egg domes over a deeper layer, with each egg's own normal, height, id,
// eyespot and yolk), projected triplanar in the lobe's rest frame, so the beads ride the lobe
// and never swim as it moves. Over it, a SPARSE layer of instanced beads (~3k, near range
// only) stands proud in small clusters and grape-bunches on the setae tips, breaking the
// silhouette the way loose eggs do. Fresh orange through amber and brown to grey across the
// mass, eyespots on the eyed ones, lit from inside by the lantern.
//
// The rite, in the world's own grammar:
//   * she sleeps on the rift lip, a reef-crusted ridge bedded in the silt;
//   * asleep, the clutch BULGES out from under her rim on one side (the side the silt drift
//     leaves open: her fanning keeps the silt off it), resting on the seabed;
//   * a trail of many-legged tracks runs in to her past a shed shell and spent casings;
//   * [E] near the clutch PRIES A CLUMP off her (carried at Sal's free hand, shedding a few
//     eggs; a torn patch is left in the lobe); that take wakes her (brood.onTake);
//   * standing, the mass hangs under her apron: her last ward will not light while the
//     clump is out; [E] within reach of the clutch under her belly presses it back.
// The mass is SOFT-SOLID (bodyCols.js setClutch): Sal stops at the drawn surface and slides
// round it, and the camera's boom treats it like the rest of her.
//
// RENDER: one program (CLUTCH material) draws the lobes' skins, the sparse beads, the carried
// clump, the shed eggs and the spent casings: instanced unit spheres whose centre/radius come
// from instance attributes (asleep + standing positions, lerped by uStand in the vertex
// shader). The hairs are one more instanced draw (SETAE). Nothing casts shadows. Translucency
// without a light: the lantern's in-scatter slot (abyssaLampA, the fog chunk's uniform)
// lights the egg from inside, wrapped round the terminator; the eyespot darkens what shows.
import * as THREE from 'three';
import { V3, clamp } from '../../lib/math.js';
import { seededRand, maxAniso } from '../../lib/textures.js';
import { registerPaint } from '../../lib/paint.js';
import { envTexDeep as envTex, camera } from '../../core.js';
import { terrainH, terrainNormal } from '../../world/terrain.js';
import { riftPos, RIFT_R } from '../../config.js';
import { emitDust } from '../../world/footfx.js';
import { lanternWorldPos } from '../diver.js';
import * as G from './brooderGeo.js';

const TAU = Math.PI * 2;
// (ritefair: RET_R 3.4 -> 5.0, the return is a press, not a precision hover under a moving colossus)
const TAKE_R = 2.6, RET_R = 5.0;        // reach from his hands/helmet to the mass's surface (world u): pry / press back (up, arm raised)
const RB = 0.0025;                      // a sparse (proud) bead's radius, shell units (x R 15.4 = 0.039 u: her eggs, true to her scale)
const MAXB = 3200;                      // sparse bead budget; the build thins to it
const LOD_N = 12;                       // sparse beads draw inside this range (world u); the skin carries the read past it
const BF_N = 44, BF_TILE = 3.5;         // bead field: eggs across one tile, the tile's world size (0.08 u eggs)
const SHED_N = 32, CLUMP_B = 70, CASE_N = 420, SETAE_N = 420;
const _v = V3(), _w = V3(), _n = V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _up = V3(0, 1, 0);
const _a = V3(), _b = V3(), _lant = V3();

// ---- the mass: lobes (shell units, body-local) ------------------------------------------
// STANDING ("H"): hanging under the brood apron (the sculpt's apron is an ellipsoid at
// (0, -0.103, -0.24), radii (0.36, 0.022, 0.34)), heavy and sagging: bottom ~ -0.40 (6 u
// under her body origin), 8.6 u across. ASLEEP ("S"): seat() rests every lobe on the seabed
// under her and pushes a tongue of lobes out past the rim on the open side.
// (ritefair, 2026-10-09) TUCKED: a berried crab carries her mass pressed up under the
// abdomen flap, not slung beneath her. Standing, every lobe rides TUCK higher (shell units,
// 0.18 = 2.8 u): with her standing height (brooder.js STAND.h) the mass's underside sits ~3.5 u
// over flat ground (over his helmet: he walks in under her rear without meeting it) and in
// his reach standing (RET_R). Slung, it lay ON the floor whenever she stood off the rim crest
// (measured 0.1 u, -2.2 u) and walled off the walk in under her; on the crest it hung 6-10 u
// up, out of reach. The lobes' tops stay inside her shell. Asleep (seat) is unchanged.
const TUCK = 0.18;
const MAIN = [
  [0, -0.215, -0.26, 0.16], [0.15, -0.20, -0.18, 0.13], [-0.15, -0.20, -0.18, 0.13],
  [0.13, -0.21, -0.38, 0.13], [-0.13, -0.21, -0.38, 0.13], [0, -0.20, -0.05, 0.12],
  [0, -0.21, -0.48, 0.11], [0.06, -0.30, -0.30, 0.10], [-0.06, -0.30, -0.24, 0.10],
  // the sag: the heaviest of it hangs lowest (the reach test counts these, so the return is
  // ~1.3 u nearer the floor than the apron's own bead line)
  [0.03, -0.39, -0.29, 0.085], [-0.04, -0.40, -0.21, 0.075]
].map(l => [l[0], l[1] + TUCK, l[2], l[3]]);
const SPILL_MAX = 8;
const MASS_C = [0, -0.23 + TUCK, -0.27];

// A lobe is not a ball: its radius wanders with direction (the same function in the core's
// vertex shader, so the beads sit on the surface the core draws, and in bodyCols.js, so the
// collider is that surface). The third octave is the spongy bunching of the mass (~1 u).
// d: unit direction, s: seed.
export function lump(dx, dy, dz, s) {
  return 1 + 0.13 * Math.sin(dx * 3.1 + s) * Math.sin(dy * 2.7 + s * 1.7) * Math.sin(dz * 3.3 + s * 2.3)
    + 0.06 * Math.sin(dx * 7.3 + s * 3.1) * Math.sin(dy * 6.1 + s * 0.7) * Math.sin(dz * 6.9 + s * 1.3)
    + 0.04 * Math.sin(dx * 15.1 + s * 2.1) * Math.sin(dy * 13.7 + s * 1.1) * Math.sin(dz * 14.3 + s * 0.3);
}
const LUMP_GLSL = `
float clLump(vec3 d, float s) {
  return 1.0 + 0.13 * sin(d.x * 3.1 + s) * sin(d.y * 2.7 + s * 1.7) * sin(d.z * 3.3 + s * 2.3)
    + 0.06 * sin(d.x * 7.3 + s * 3.1) * sin(d.y * 6.1 + s * 0.7) * sin(d.z * 6.9 + s * 1.3)
    + 0.04 * sin(d.x * 15.1 + s * 2.1) * sin(d.y * 13.7 + s * 1.1) * sin(d.z * 14.3 + s * 0.3);
}`;

// ---- THE BEAD FIELD (generated once; ~30 ms) ------------------------------------------------
// One tile of packed eggs, BF_N across on a jittered hex lattice, over a second, deeper layer
// offset by half a cell (it shows in the gaps and where an outer egg is missing). Each pixel
// belongs to the egg whose dome is highest there.
//   A: rg = the dome's normal (tangent xy), b = height (0 crevice .. 1 crown), a = egg id
//   B: r = eyespot (a dark kidney inside the shell, on its own bearing), g = yolk (the far
//      half, darker), b = a second random (development jitter), a = outer layer
// Linear data, mip-mapped: far off the domes average flat and the eyespots to a speckle.
let _bf = null;
function beadField() {
  if (_bf) return _bf;
  const t0 = performance.now();
  const S = 1024, COLS = BF_N, ROWS = 50, cw = S / COLS, rh = S / ROWS;
  const Hh = new Float32Array(S * S).fill(-1e9);
  const A = new Uint8Array(S * S * 4), Bd = new Uint8Array(S * S * 4);
  const rnd = seededRand(0xE6650);
  const top = cw * 0.5 * 1.1, bot = -cw * 0.42;
  const egg = (x, y, rad, base, outer) => {
    const id = rnd(), r2 = rnd(), ea = rnd() * TAU, ex = Math.cos(ea) * 0.26, ey = Math.sin(ea) * 0.26;
    const ka = ea + 1.2 + rnd() * 0.6, kc = Math.cos(ka), ks = Math.sin(ka);
    const x0 = Math.floor(x - rad), x1 = Math.ceil(x + rad), y0 = Math.floor(y - rad), y1 = Math.ceil(y + rad);
    for (let py = y0; py <= y1; py++) {
      const dy = (py + 0.5 - y) / rad, wy = ((py % S) + S) % S;
      for (let px = x0; px <= x1; px++) {
        const dx = (px + 0.5 - x) / rad, q = 1 - dx * dx - dy * dy;
        if (q <= 0) continue;
        const sq = Math.sqrt(q), z = base + sq * rad, i = wy * S + (((px % S) + S) % S);
        if (z <= Hh[i]) continue;
        Hh[i] = z;
        const o = i * 4;
        A[o] = (dx * 0.5 + 0.5) * 255; A[o + 1] = (dy * 0.5 + 0.5) * 255;
        A[o + 2] = clamp((z - bot) / (top - bot), 0, 1) * 255; A[o + 3] = id * 255;
        // the eyespot: an ellipse 0.3 x 0.19 of the egg, turned on its own axis, with a notch
        const ux = dx - ex, uy = dy - ey, a1 = (ux * kc + uy * ks) / 0.42, a2 = (-ux * ks + uy * kc) / 0.29;
        const e = Math.sqrt(a1 * a1 + a2 * a2);
        const notch = Math.max(0, 1 - Math.hypot(a1 - 0.0, a2 - 1.05) / 0.55);
        Bd[o] = clamp((1.05 - e) / 0.2, 0, 1) * (1 - 0.8 * notch) * 255;
        Bd[o + 1] = clamp(0.5 - 0.7 * (dx * ex + dy * ey) / 0.26, 0, 1) * clamp(sq * 1.6, 0, 1) * 255;
        Bd[o + 2] = r2 * 255; Bd[o + 3] = outer ? 255 : 0;
      }
    }
  };
  // the deeper layer first, then the outer (6% of outer cells empty: the deeper egg shows)
  for (let layer = 1; layer >= 0; layer--) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const jx = (rnd() - 0.5) * 0.4 * cw, jy = (rnd() - 0.5) * 0.4 * rh;
      const x = (c + (r & 1) * 0.5 + layer * 0.5) * cw + jx, y = (r + layer * 0.5) * rh + jy;
      if (layer === 0 && rnd() < 0.09) { rnd(); continue; }
      const rad = cw * 0.5 * (layer ? 0.72 + 0.22 * rnd() : 0.8 + 0.3 * rnd());
      egg(x, y, rad, layer ? bot : 0, !layer);
    }
  }
  for (let i = 0; i < S * S; i++) if (Hh[i] < -1e8) { const o = i * 4; A[o] = A[o + 1] = 128; A[o + 2] = 0; A[o + 3] = 0; Bd[o] = Bd[o + 1] = Bd[o + 2] = Bd[o + 3] = 0; }
  const tex = d => {
    const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = Math.min(8, maxAniso());
    t.needsUpdate = true;
    return t;
  };
  _bf = { a: tex(A), b: tex(Bd), ms: performance.now() - t0 };
  return _bf;
}

// ---- the program ----------------------------------------------------------------------------
// aP0 / aP1: centre (xyz) + radius (w), asleep / standing (mesh-local units). aSd: x random
// (the lobe's lump seed / 10 for skins), y development stage (0 fresh orange .. 1 brown-grey,
// eyed), z eyespot azimuth (beads) or the skin's rest radius (mesh units), w MODE: 0 bead,
// 1 lobe skin, 2 spent casing, 3 loose bead, 4 loose skin (the clump's).
const NLOB = MAIN.length + SPILL_MAX, FIL = 0.08;   // lobes in the uniform; the fillet's width (shell units, ~1.2 u)
const CL_VS_HEAD = `
attribute vec4 aP0, aP1, aSd;
uniform float uStand, uTime, uBreath, uScarL;
uniform vec3 uMassC;
uniform vec4 uScar;
uniform vec4 uLobes[${NLOB}];
uniform float uLobeS[${NLOB}];
varying vec4 vBSd; varying vec3 vBDir, vBLoc, vBW, vBTex, vBN; varying float vBR, vBK, vBScar, vBAO;` + LUMP_GLSL + `
// THE MASS IS ONE SPONGE, NOT A BAG OF BALLS: where two lobes meet, the skin swells into a
// smooth fillet (a polynomial smooth-union of the lobes' lumped surfaces), and the nearest
// other lobe is remembered for the crevice's shade
float clNear;
float clFillet(vec3 bp, int self) {
  float fil = 0.0;
  for (int j = 0; j < ${NLOB}; j++) {
    if (j == self) continue;
    vec4 lj = uLobes[j];
    vec3 dv = bp - lj.xyz; float dl = length(dv);
    if (lj.w <= 0.002 || dl > lj.w * 1.25 + ${FIL.toFixed(3)}) continue;
    float dj = dl - lj.w * clLump(dv / max(dl, 1e-5), uLobeS[j]);
    clNear = min(clNear, dj);
    float h = max(${FIL.toFixed(3)} - abs(dj), 0.0) / ${FIL.toFixed(3)};
    fil = max(fil, h * h * ${(FIL * 0.25).toFixed(4)});
  }
  return fil;
}`;
// the centre, the breath, and the skin's lumped (and filleted) surface and its normal
const CL_VS_NORMAL = `
vec3 objectNormal = vec3(normal);
float bmode = floor(aSd.w + 0.5);
bool bskin = (bmode > 0.5 && bmode < 1.5) || bmode > 3.5;
vec4 bcl = mix(aP0, aP1, uStand);
vec3 bc = bcl.xyz; float brr = bcl.w;
if (bmode < 1.5) {
  // she fans the apron: a slow wave runs front to back through the mass, swelling it
  vec3 brad = bc - uMassC; float brl = length(brad) + 1e-4;
  float bw = 0.5 + 0.5 * sin(uTime * 1.25 + bc.z * 11.0 + bc.x * 4.0);
  bc += brad / brl * (0.0065 * bw * bw * uBreath);
}
vec3 bSkinP = vec3(0.0);
vBAO = 1.0;
if (bskin) {
  float bls = aSd.x * 10.0;
  vec3 bd0 = normalize(position);
  vec3 bt1 = normalize(cross(bd0, abs(bd0.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 bt2 = cross(bd0, bt1);
  vec3 bd1 = normalize(bd0 + bt1 * 0.012), bd2 = normalize(bd0 + bt2 * 0.012);
  vec3 bq0 = bd0 * clLump(bd0, bls) * brr, bq1 = bd1 * clLump(bd1, bls) * brr, bq2 = bd2 * clLump(bd2, bls) * brr;
  if (bmode < 1.5 && brr > 0.002) {
    clNear = 1e3;
    bq0 += bd0 * clFillet(bc + bq0, gl_InstanceID);
    vBAO = clNear;
    bq1 += bd1 * clFillet(bc + bq1, gl_InstanceID);
    bq2 += bd2 * clFillet(bc + bq2, gl_InstanceID);
  }
  vec3 bnn = normalize(cross(bq1 - bq0, bq2 - bq0));
  objectNormal = dot(bnn, bd0) < 0.0 ? -bnn : bnn;
  bSkinP = bq0;
}
vBN = objectNormal;`;
const CL_VS_BEGIN = `
vec3 bsc = vec3(1.0);
if (bmode > 1.5 && bmode < 2.5) {
  bsc = vec3(1.0, 0.42, 1.0);      // a spent casing: collapsed, a flat wrinkled skin
  bc.y += 0.03 * brr * sin(uTime * 0.7 + aSd.x * 40.0);
}
// the tear a pried clump leaves: a dent in that lobe's skin, on its own bearing
vBScar = 0.0;
if (bmode > 0.5 && bmode < 1.5 && abs(float(gl_InstanceID) - uScarL) < 0.5) {
  vBScar = smoothstep(uScar.w, mix(uScar.w, 1.0, 0.55), dot(normalize(position), uScar.xyz));
  bSkinP *= 1.0 - 0.05 * vBScar;
}
vec3 transformed = bskin ? bc + bSkinP : bc + position * bsc * brr;
{
  vec3 bwc = (modelMatrix * vec4(bc, 1.0)).xyz;
  float bdc = distance(bwc, cameraPosition);
  if ((bmode < 0.5 && bdc > ${LOD_N.toFixed(1)}) || (bmode > 1.5 && bmode < 2.5 && bdc > 45.0) || (bmode > 2.5 && bmode < 3.5 && bdc > 30.0)) transformed = bc;
  if (brr <= 0.0) transformed = bc;
}
vBSd = aSd; vBDir = position; vBLoc = transformed; vBR = brr; vBK = length(modelMatrix[0].xyz);
// the skin's bead field lives in the lobe's REST frame (its own unit sphere at a fixed radius,
// world-scaled, in tiles), so the eggs ride the lobe as it breathes, rises and folds
vBTex = position * (bskin ? clLump(position, aSd.x * 10.0) : 1.0) * aSd.z * vBK * ${(1 / BF_TILE).toFixed(5)} + vec3(aSd.x * 7.31, aSd.x * 3.17, aSd.x * 5.53);
vBW = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const CL_FS_HEAD = `
uniform float uSssK; uniform vec4 uDbg;
uniform sampler2D uBeadA, uBeadB;
uniform mat3 normalMatrix;
varying vec4 vBSd; varying vec3 vBDir, vBLoc, vBW, vBTex, vBN; varying float vBR, vBK, vBScar, vBAO;
vec3 clAlb(float st, float rnd) {
  // fresh orange -> amber -> brown -> brown-grey (linear albedo)
  vec3 a = mix(vec3(0.46, 0.14, 0.018), vec3(0.27, 0.10, 0.022), smoothstep(0.0, 0.45, st));
  a = mix(a, vec3(0.105, 0.05, 0.024), smoothstep(0.40, 0.78, st));
  a = mix(a, vec3(0.095, 0.088, 0.078), smoothstep(0.78, 0.98, st));
  return a * (0.72 + 0.56 * rnd);
}`;
// diffuse: the egg's colour, its eyespot; on a skin, the bead field (triplanar, rest frame)
const CL_FS_COLOR = `
float bMode = floor(vBSd.w + 0.5);
float bSpot = 0.0, bSkin = 0.0, bH = 1.0;
vec3 bAlb, bLN = vec3(0.0, 0.0, 1.0);
if (bMode > 0.5 && bMode < 1.5 || bMode > 3.5) {
  bSkin = 1.0;
  vec3 n0 = normalize(vBN);
  vec3 bw3 = pow(abs(n0), vec3(4.0)); bw3 /= bw3.x + bw3.y + bw3.z;
  vec3 axs = vec3(n0.x < 0.0 ? -1.0 : 1.0, n0.y < 0.0 ? -1.0 : 1.0, n0.z < 0.0 ? -1.0 : 1.0);
  // (each lobe turns the field its own way, or the rows line up across the whole mass)
  float bra = vBSd.x * 6.2832; mat2 bRot = mat2(cos(bra), sin(bra), -sin(bra), cos(bra));
  vec2 uvX = bRot * vec2(vBTex.z * axs.x, vBTex.y), uvY = bRot * vec2(vBTex.x * axs.y, vBTex.z), uvZ = bRot * vec2(-vBTex.x * axs.z, vBTex.y);
  vec4 aX = texture2D(uBeadA, uvX), aY = texture2D(uBeadA, uvY), aZ = texture2D(uBeadA, uvZ);
  vec4 cX = texture2D(uBeadB, uvX), cY = texture2D(uBeadB, uvY), cZ = texture2D(uBeadB, uvZ);
  vec4 bA = aX * bw3.x + aY * bw3.y + aZ * bw3.z, bB = cX * bw3.x + cY * bw3.y + cZ * bw3.z;
  // the domes (UDN-blended, signs re-applied per axis); they fade as an egg falls under a pixel
  float bFoot = length(fwidth(vBTex)) * ${BF_N.toFixed(1)};
  float bump = 0.9 * (1.0 - smoothstep(0.6, 1.6, bFoot));
  mat2 bRotT = mat2(cos(bra), -sin(bra), sin(bra), cos(bra));
  vec2 tX = bRotT * (aX.xy * 2.0 - 1.0) * bump, tY = bRotT * (aY.xy * 2.0 - 1.0) * bump, tZ = bRotT * (aZ.xy * 2.0 - 1.0) * bump;
  tX.x *= axs.x; tY.x *= axs.y; tZ.x *= -axs.z;
  vec3 nX = vec3(tX + n0.zy, abs(n0.x) * axs.x), nY = vec3(tY + n0.xz, abs(n0.y) * axs.y), nZ = vec3(tZ + n0.xy, abs(n0.z) * axs.z);
  bLN = normalize(nX.zyx * bw3.x + nY.xzy * bw3.y + nZ.xyz * bw3.z);
  bH = bA.z;
  // development: the lobe's own stage, broad patches across the mass, each egg's jitter
  float st = clamp(vBSd.y + 0.28 * sin(vBTex.x * 2.1 + vBTex.z * 1.7 + vBSd.x * 9.0) * sin(vBTex.y * 1.9 - vBTex.x * 1.3)
    + 0.1 * sin(vBTex.y * 6.3 + vBTex.z * 5.1) + (bB.z - 0.5) * 0.3, 0.0, 1.0);
  bAlb = clAlb(st, bA.w);
  // the crevices and the deeper layer are in each other's shade; so is a fold between lobes
  bAlb *= mix(0.26, 1.0, smoothstep(0.08, 0.62, bH)) * mix(0.42, 1.0, smoothstep(-0.01, ${(FIL * 1.6).toFixed(3)}, vBAO));
  float bSee = 1.0 - smoothstep(0.9, 2.2, bFoot) * 0.6;          // far off, the eyes are a speckle
  bSpot = bB.x * smoothstep(0.26, 0.5, st) * bSee;
  bAlb *= 1.0 - 0.35 * bB.y * smoothstep(0.5, 0.9, st);           // the yolk
  // the tear: the deeper, darker mass and the stubs of the hairs show
  bAlb = mix(bAlb, bAlb * vec3(0.5, 0.36, 0.3), vBScar);
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
  bAlb *= 1.0 - 0.35 * (1.0 - smoothstep(-0.7, 0.0, de)) * smoothstep(0.5, 0.9, vBSd.y);
}
bSpot = max(bSpot, uDbg.x);
diffuseColor.rgb = bAlb * (1.0 - 0.93 * bSpot);`;
const CL_FS_ROUGH = `
roughnessFactor = bMode > 1.5 && bMode < 2.5 ? 0.62 : bSkin > 0.5 ? mix(0.66, 0.36, smoothstep(0.25, 0.75, bH)) + 0.2 * vBScar + 0.25 * bSpot : mix(0.14, 0.6, bSpot);`;
const CL_FS_NORMAL = `
if (bSkin > 0.5) normal = normalize(normalMatrix * bLN);`;
// translucency: the lantern lights the egg from INSIDE (its own in-scatter slot), wrapped
// round the terminator, brightest through its thickness, shadowed by the eyespot; on a skin
// the crowns carry it and the crevices do not
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
  float bThk = bSkin > 0.5 ? mix(0.2, 1.0, smoothstep(0.15, 0.7, bH)) * (1.0 - 0.7 * vBScar) * mix(0.35, 1.0, smoothstep(0.0, ${(FIL * 1.6).toFixed(3)}, vBAO)) : 1.0;
  totalEmissiveRadiance += bIn * bE * bWrap * (0.30 + 0.70 * pow(bNV, 1.6)) * (1.0 - 0.9 * bSpot) * uSssK * bThk;
}
#endif`;
function clutchMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, envMap: envTex, envMapIntensity: 0.08 });
  const bf = beadField();
  const u = {
    uStand: { value: 0 }, uTime: { value: 0 }, uBreath: { value: 1 }, uMassC: { value: new THREE.Vector3().fromArray(MASS_C) }, uSssK: { value: 0.32 }, uDbg: { value: new THREE.Vector4() },
    uScar: { value: new THREE.Vector4(0, 1, 0, 2) }, uScarL: { value: -1 }, uBeadA: { value: bf.a }, uBeadB: { value: bf.b },
    uLobes: { value: Array.from({ length: NLOB }, () => new THREE.Vector4()) }, uLobeS: { value: new Float32Array(NLOB) }
  };
  m.userData.u = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + CL_VS_HEAD)
      .replace('#include <beginnormal_vertex>', CL_VS_NORMAL)
      .replace('#include <begin_vertex>', CL_VS_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CL_FS_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + CL_FS_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + CL_FS_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + CL_FS_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + CL_FS_SSS);
  };
  m.customProgramCacheKey = () => 'brood|clutch|field';
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

// unit spheres: an 80-tri bead, the skin's 5120-tri sphere (its silhouette carries the lumps)
let _geoN = null, _geoC = null, _geoS = null;
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

export function makeBrood(L, idx, trailFrom) {
  const grp = L.grp, R = L.R;
  const rnd = seededRand(0xB700D + idx * 131 + Math.round(trailFrom.x * 7 + trailFrom.z * 13));
  if (!_geoN) { _geoN = sphere(1); _geoC = sphere(4); _geoS = strandGeo(); }
  const B = {
    held: -1, taken: 0, t: 0, seated: false, st: 0, carryT: 0, shedT: 2, fanT: 4, locked: false,
    found: { tracks: false, shells: false, clutch: false, ridge: false },
    trailA: trailFrom.clone(), shellsAt: V3(), takeAt: V3(), clumpAt: V3(), bear: 0, notch: 0.5,
    lobes: [], nL: 0
  };
  B.trailA.y = terrainH(B.trailA.x, B.trailA.z, idx);
  const matN = clutchMat(), sMat = setaeMat();
  B.mats = [matN, sMat];

  // ---- the lobes (filled for real by seat(); standing positions are fixed) ----
  for (const [x, y, z, r] of MAIN) B.lobes.push({ h: [x, y, z, r], s: [x, y, z, r], spill: false, seed: rnd() });
  for (let k = 0; k < SPILL_MAX; k++) {
    // a spill lobe standing is folded back inside the big centre lobe (it hides there)
    B.lobes.push({ h: [MAIN[0][0], MAIN[0][1] - 0.01, MAIN[0][2], 0.09], s: [0, -0.2, -0.26, 0.09], spill: true, seed: rnd() });
  }
  B.nL = B.lobes.length;
  // the live lobe set (lerped by B.st), for reach tests: x y z r per lobe
  B.live = new Float32Array(B.nL * 4);
  B.seeds = Float32Array.from(B.lobes, l => l.seed * 10);    // lump seeds (the shader's aSd.x * 10)
  matN.userData.u.uLobeS.value = B.seeds;

  // ---- meshes (geometry sized at seat) ----
  B.core = new THREE.Mesh(beadSet(_geoC, B.nL, false), matN);
  B.beadsN = null; B.setae = null;
  B.core.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.2, -0.2), 1.45);
  for (const o of [B.core]) { o.castShadow = false; o.receiveShadow = true; L.body.add(o); }

  // ---- the clump (carried) and the shed beads: world space, same program ----
  {
    const g = beadSet(_geoN, CLUMP_B + 1, false), P0 = g.attributes.aP0.array, P1 = g.attributes.aP1.array, Sd = g.attributes.aSd.array;
    const cr = seededRand(0xC1A9);
    const rw = RB * R;
    // a skin of the bead field (radius ~0.3 u, the lump making it a torn clod) and a few
    // eggs standing proud of it
    P0[0] = P1[0] = 0; P0[1] = P1[1] = 0; P0[2] = P1[2] = 0; P0[3] = P1[3] = 0.26;
    Sd[0] = 0.5; Sd[1] = 0.55; Sd[2] = 0.26; Sd[3] = 4;
    for (let i = 1; i <= CLUMP_B; i++) {
      const y = 1 - 2 * (i - 0.5) / CLUMP_B, rr = Math.sqrt(1 - y * y), ph = i * 2.39996 + cr() * 0.3;
      const lump = 0.26 * (1 + 0.13 * Math.sin(Math.cos(ph) * rr * 3.1 + 5) * Math.sin(y * 2.7 + 8.5) * Math.sin(Math.sin(ph) * rr * 3.3 + 11.5)) + rw * 0.5;
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
        // to the drawn (lumped) surface, the one the collider stops him at
        const dx = _v.x - B.live[o], dy = _v.y - B.live[o + 1], dz = _v.z - B.live[o + 2], dl = Math.hypot(dx, dy, dz);
        const d = (dl - (dl > 1e-6 ? r * lump(dx / dl, dy / dl, dz / dl, B.seeds[k]) : r)) * R;
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
  // Is he standing where her tongue of eggs lies when she sleeps? (calmed, she will not settle
  // it onto him: brooder.js homeTurn). Plan distance to the spill lobes as they lay when seated.
  B.onBed = pos => {
    if (!B.seated) return false;
    const bw = B.bedM;                                   // her body as it lay when the clutch was seated
    for (let k = MAIN.length; k < B.nL; k++) {
      const sl = B.lobes[k].s;
      _a.set(sl[0], sl[1], sl[2]).applyMatrix4(bw);
      if (Math.hypot(pos.x - _a.x, pos.z - _a.z) < sl[3] * R * 1.25 + 1.2) return true;   // (his body + a step)
    }
    return false;
  };
  B.canTake = pos => !B.locked && B.held < 0 && B.reach(pos) < TAKE_R;
  B.canReturn = pos => B.held >= 0 && B.reach(pos) < RET_R;
  // (bench probes: the old names, from the nest's days)
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
    B.scarAt = _w.clone(); B.scarK = k;
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
    // the skin: a dent on that lobe, on the bearing he tore from (the lobe's rest frame)
    const su = matN.userData.u;
    if (on && B.scarK >= 0) {
      const o = B.scarK * 4, r = Math.max(1e-4, B.live[o + 3]);
      su.uScar.value.set(B.scarAt.x - B.live[o], B.scarAt.y - B.live[o + 1], B.scarAt.z - B.live[o + 2], 0).normalize();
      su.uScar.value.w = Math.cos(Math.min(1.2, 0.62 / (r * R)));
      su.uScarL.value = B.scarK;
    } else if (!on) su.uScarL.value = -1;
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
    (B.bedM || (B.bedM = new THREE.Matrix4())).copy(bw);
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
        P0[o + 3] = lb.s[3]; P1[o + 3] = lb.h[3];
        // development by lobe: mostly eyed amber-brown, a fresher (orange) patch on the front
        // lobes, the oldest (grey) at the back; the shader breaks it up per patch and per egg
        const [hx, , hz] = lb.h;
        const stg = lb.spill ? clamp(0.56 + 0.34 * Math.sin(k * 2.3 + lb.seed * 6), 0.12, 0.95)
          : clamp(0.6 + 0.2 * Math.sin(hx * 9 + hz * 7) + 0.2 * Math.sin(k * 2.3 + lb.seed * 6) - (hz > -0.12 && hx > -0.02 ? 0.36 : 0) + (hz < -0.42 ? 0.2 : 0), 0.06, 0.95);
        Sd[o] = lb.seed; Sd[o + 1] = lb.stage = stg; Sd[o + 2] = (lb.s[3] + lb.h[3]) * 0.5; Sd[o + 3] = 1;
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
    // the proud eggs: small clusters standing half out of the skin (3-8 each, ~14 clusters on
    // a big lobe), the ones that catch the lantern singly and break the lobe's outline
    for (let k = 0; k < nL; k++) {
      const s = lobes[k].s, h = lobes[k].h, sd = lobes[k].seed * 10, stg0 = lobes[k].stage ?? 0.6;
      const rMax = Math.max(s[3], h[3]);
      const nCl = Math.max(3, Math.round(15 * (rMax / 0.13) * (rMax / 0.13)));
      for (let c = 0; c < nCl; c++) {
        const cy = 1 - 2 * br(), cr = Math.sqrt(Math.max(0, 1 - cy * cy)), ca = br() * TAU;
        const cx = Math.cos(ca) * cr, cz = Math.sin(ca) * cr;
        // a tangent frame at the cluster's centre
        _a.set(cx, cy, cz); _b.set(0, 1, 0); if (Math.abs(cy) > 0.9) _b.set(1, 0, 0);
        _b.crossVectors(_a, _b).normalize(); _n.crossVectors(_a, _b);
        const nb = 3 + Math.floor(br() * 6), spread = RB * 2.6 / rMax;
        for (let b = 0; b < nb; b++) {
          const u = (br() - 0.5) * 2 * spread * Math.sqrt(nb), v = (br() - 0.5) * 2 * spread * Math.sqrt(nb);
          const dx0 = cx + _b.x * u + _n.x * v, dy0 = cy + _b.y * u + _n.y * v, dz0 = cz + _b.z * u + _n.z * v, dl = Math.hypot(dx0, dy0, dz0);
          const dx = dx0 / dl, dy = dy0 / dl, dz = dz0 / dl, lf = lump(dx, dy, dz, sd);
          const rb = RB * (0.8 + 0.35 * br()), proud = rb * (0.15 + 0.5 * br());
          const sx = s[0] + dx * (s[3] * lf + proud), sy = s[1] + dy * (s[3] * lf + proud), sz = s[2] + dz * (s[3] * lf + proud);
          const hx = h[0] + dx * (h[3] * lf + proud), hy = h[1] + dy * (h[3] * lf + proud), hz = h[2] + dz * (h[3] * lf + proud);
          const showS = !inside(sx, sy, sz, 0, k) && !buried(sx, sy, sz);
          const showH = !inside(hx, hy, hz, 1, k);
          const j0 = br(), j1 = br(), j2 = br();
          if (!showS && !showH) continue;
          P0.push(sx, sy, sz, showS ? rb : 0); P1.push(hx, hy, hz, showH ? rb : 0);
          SD.push(j0, clamp(stg0 + (j1 - 0.5) * 0.4, 0.05, 0.98), j2 * TAU, 0);
        }
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
      // a bunch of eggs near the free tip (eggs on their stalks, like grapes)
      if (f > 1.08) {
        const nb = 4 + Math.floor(br() * 7);
        for (let b = 0; b < nb; b++) {
          const tt = 0.72 + 0.28 * br(), off = RB * 3.2;
          const ox = (br() - 0.5) * off, oy = (br() - 0.5) * off, oz = (br() - 0.5) * off;
          const sx = s[0] + dx * s[3] * f * tt + ox, sy = s[1] + dy * s[3] * f * tt + oy, sz = s[2] + dz * s[3] * f * tt + oz;
          const hx = h[0] + dx * h[3] * f * tt + ox, hy = h[1] + dy * h[3] * f * tt + oy, hz = h[2] + dz * h[3] * f * tt + oz;
          const showS = !buried(sx, sy, sz) && !inside(sx, sy, sz, 0, -1), showH = !inside(hx, hy, hz, 1, -1);
          const rb = RB * (0.8 + 0.3 * br());
          P0.push(sx, sy, sz, showS ? rb : 0); P1.push(hx, hy, hz, showH ? rb : 0);
          SD.push(br(), clamp((lobes[k].stage ?? 0.6) + (br() - 0.5) * 0.35, 0.05, 0.98), br() * TAU, 0);
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
    if (B.beadsN) { B.beadsN.geometry.dispose(); L.body.remove(B.beadsN); }
    B.beadsN = new THREE.Mesh(g, matN);
    B.scarSave = new Float32Array(m * 2);
    g.boundingSphere = B.core.geometry.boundingSphere;
    B.beadsN.castShadow = false; B.beadsN.receiveShadow = true; L.body.add(B.beadsN);
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
      const rw = RB * R * 1.7;            // (collapsed skins lie wider than the eggs were)
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
    B.locked = !!L.calmed;                     // stilled, her clutch is hers: no more takes
    // calmed she keeps it clamped under her (it does not spill again where she settles)
    // (home on her bed, at the heading she was seated on, it spills again as she settles)
    B.st = L.calmed && (L.homeTurn || L.walkTo || Math.abs(Math.atan2(Math.sin(L.yaw - (L.lairYaw ?? L.yaw)), Math.cos(L.yaw - (L.lairYaw ?? L.yaw)))) > 0.2) ? 1 : L.standE;
    liveLobes();
    const uN = matN.userData.u, uS = sMat.userData.u;
    uN.uStand.value = uS.uStand.value = B.st;
    uN.uTime.value = uS.uTime.value = B.t;
    uN.uBreath.value = L.dormant ? 1 : 0.35;
    // the live lobes (breathing as the shader breathes them) for the skin's fillets
    {
      const UL = uN.uLobes.value, br = uN.uBreath.value, Lv = B.live;
      for (let k = 0; k < B.nL; k++) {
        const o = k * 4, x = Lv[o], y = Lv[o + 1], z = Lv[o + 2];
        const dx = x - MASS_C[0], dy = y - MASS_C[1], dz = z - MASS_C[2], dl = Math.hypot(dx, dy, dz) + 1e-4;
        const bw = 0.5 + 0.5 * Math.sin(B.t * 1.25 + z * 11 + x * 4), f = 0.0065 * bw * bw * br / dl;
        UL[k].set(x + dx * f, y + dy * f, z + dz * f, Lv[o + 3]);
      }
    }
    // the bead sets are only submitted where a bead of theirs can be drawn (the shader
    // collapses the rest, but a collapsed vertex still runs): the clutch spans ~12 u
    if (B.beadsN) {
      _a.fromArray(MASS_C).applyMatrix4(L.body.matrixWorld);
      // (the gate holds off for the first 12 s of her clock: the boot's precompile and warm
      // frames must see every set, or its program builds on first sight, mid-dive)
      const dc = B.t < 12 ? 0 : _a.distanceTo(camera.position), on = !B.off;     // (B.off: the dev A/B, the whole clutch out)
      B.beadsN.visible = on && dc < LOD_N + 14;
      B.setae.visible = on && dc < 40;
      B.core.visible = on;
    }
    // (asleep she fans it slowly; awake she clamps the apron down: uBreath above)
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
      const St = B.shedSt, g = B.shed.geometry, P0 = g.attributes.aP0.array, P1 = g.attributes.aP1.array, rw = RB * R * 1.1;
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
    else if (!F.clutch && L.dormant && B.seated && near(B.takeAt, 11)) { F.clutch = true; ev.msg = 'A CLUTCH UNDER HER. EGGS BY THE THOUSAND, AND EVERY ONE HAS AN EYE.'; }
  };
  return B;
}
