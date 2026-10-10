// src/world/fissure.js — THE FISSURE's jam, its seep and the opening (spec 2026-10-10 §1).
// OWNS each zone's OPEN LEVEL k (0 shut .. 1 open): riftOpen (k > 0.5), the shut floor's flag
// (fissureShape.js setFissureShut, read by terrain.js jamAt / shutFloorY) and, from Task 4, the
// open light all read fissureOpenK. game.js pushes the chart's calm record in (setFissureOpen on
// every zone entry / reseed) and starts the opening (openFissure); nothing else writes k.
//
// SHUT, what is drawn over the crack IS what Sal stands on (fix round 1, controller ruling I1):
//   - THE RUBBLE: <= 160 blocks per zone in FOUR rock shapes (flora.js jamRockKit: flora's own
//     'rock' program and generated rock map set, triplanar; a fresh-broken block, a rounded boulder,
//     a slab, a shard), one InstancedMesh each, all one program. Laid in CLUMPS, not a Poisson disk:
//     a few big blocks wedged against the walls and a pile round each anchor, every block SETTLED on
//     whatever is already there (the rubble grid below), so they overlap, lean and stack; random
//     tilts; a wide size range (0.6-4.5 u across). Kept out of the overhang slabs' footprints, off
//     the tips, and over >= 20 u of throat (they all go when it opens).
//   - THE FLOOR GRID: per zone a (u, v) height grid at 0.25 u (fissureShape.js setJamGrid / jamFloorAt,
//     read by terrain.js jamAt): the max of the drifted silt and the block tops (each block's triangles
//     rasterised), with silt banked round every block to within a step (JAM_STEP_OK) of its top at a
//     drift slope, so Sal walks ON the rocks and up their banks, never through them.
//   - THE SILT: the grid itself drawn in the TERRAIN's own zone material and vertex encoding (r cavity
//     AO, g rock bias, b height over the basin floor: seabed, same program), displaced: drifted against
//     the walls, banked round the blocks, scoured and rippled between. It covers the buried slab tops
//     and tucks under wall faces it would lie flush with (no z-fight).
//   - THE SEEP (ruling I2): cold light leaking up BETWEEN the blocks: an additive layer over the silt
//     (the silt's own vertices, so it sags and drains with it) masked by the gap field (bright in the
//     crevices at the blocks' feet, dark under them and over open silt), breathing on an 8 s period,
//     plus a few faint wisps rising out of the brightest gaps, soft at the root so the ground never
//     cuts them flat. Pale blue-white, fog off with its own distance fade, never a lamp. No THREE light.
// THE OPENING (openFissure, COLLAPSE + SWELL = 6.6 s; k climbs linearly over it):
//   0.0  the seabed shudders (quake: the lens shakes as for her blows); the blocks jostle.
//   0.4  THE BREAK: the crack coughs silt (three of the Brooder's sand-plume clouds, plume.js:
//        fogged and lit like seabed, never additive) and a stir pulse startles the reef; the seep
//        flares as the cold light finds the cracks, then fades with the collapse.
//   0.4-3.3 THE SLUMP: the middle sags 2 u into the throat. The sag is part of the FLOOR
//        (fissureShape.js setJamSag -> terrain.js jamAt), so a man stood on it rides it down.
//   3.3  k > 0.5: the floor goes (setFissureShut false); the silt drains into the throat, the middle
//        fastest, and is gone 14 u down; the crack exhales its cloud (six more plumes, from down in the throat, small enough to see the pour through).
//   3.3-5.0 THE POUR: the blocks go, the middle first and the wall blocks last, tumbling, sinking as
//        stone does in water (9 u/s^2 to 10 u/s), drawn in toward the throat as they drop. They do
//        not stop: each sinks on through the throat floor (>= 20 u down) and out of sight, one by one.
//   3.6-6.6 THE SWELL: Task 4's open light reads k. The pour keeps its own clock past 6.6 until the
//        last block has sunk out (<= 14 s), then the rubble is hidden.
// Built at boot (game.js after buildRifts, inside the loader: the warm frames draw every mesh, so
// first sight builds nothing), refilled in place on a reseed (reseatFissures after resetJam).
// Per frame: zero allocation (module scratch); the CPU writes only during an opening, plus a few
// uniforms while the seep is in sight.
import * as THREE from 'three';
import { scene, renderer } from '../core.js';
import { zoneBottom } from '../config.js';
import { FISSURE, jamYAt, jamTopY, fissureWorld, fissureLocal, slabProbe, _widths, setFissureShut, setJamSag, jamSagProfile, lipMeanY, fissureShut, setJamGrid, jamFloorAt } from './fissureShape.js';
import { terrainH, terrainUnderH, terrainMeshes, jamAt, shutFloorY } from './terrain.js';
import { stirPulse, P_STRIKE, P_SLAM } from './stir.js';
import { jamRockKit } from './flora.js';
import { seededRand } from '../lib/textures.js';
import { spawnPlume, updatePlumes, plumeTicks, buildPlumes } from '../entities/sleeper/plume.js';
import { currentSiteIndex } from './site.js';

const N_BOULDER = 160, COLLAPSE = 3.6, SWELL = 3.0;
const T_BREAK = 0.4, T_OPEN = 0.5 * (COLLAPSE + SWELL);        // the break; k passes 0.5 (the floor goes)
const SAG_MAX = 2.0, A_SILT = 10, SILT_GONE = 14;               // u, u/s^2, u
const A_ROCK = 9, V_ROCK = 10, ROCK_T = 14, DROP_MIN = 20;      // u/s^2, terminal u/s, the pour's longest clock (s), u of throat under every block
const GD = 0.25, FD = GD / 2;          // the silt mesh's spacing; the floor grid's (twice as fine: block edges), u
const JAM_STEP_OK = 0.45, DRIFT = 0.9; // a block stands at most this proud of the silt banked round it; the bank's slope (rise / run)
// the four rock shapes: [detail, squash, amp, facet] for flora's rockGeo
const SHAPES = [[4, 0.95, 0.5, 2.4], [4, 0.85, 0.75, 1.0], [4, 0.55, 0.55, 2.0], [3, 1.0, 0.9, 3.0]];
// pale blue-white as it lands on screen: zone 1's water grade warms, zone 2's cools toward violet, so
// each zone's own source colour is leaned against its grade
const SEEP_COL = [[0.66, 0.84, 1.0], [0.50, 0.80, 1.0], [0.40, 0.95, 1.0]], SEEP_PERIOD = 8;
const SEEP_K = [2.3, 0.6, 0.32];
const SEEP_TUNE = { k: 1, layer: 0.16, wisp: 0.13 };   // dev: __fissure.seep       // per zone: the same faint breath read from ~20 u in each water
const N_WISP = 6;
const BS = 22;   // block record: u v restY sx sy sz qx qy qz qw start floorY targetV ax ay az rate p top ph kind slot
const Z = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _ax = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color(), _w = { x: 0, z: 0 }, _l = { u: 0, v: 0 };
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _out = { quake: 0, opening: false };
const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const sstep = (a, b, x) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// value noise (hash lattice, smooth), 0..1: the silt's undulation and ripples
const hh = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j, sa = a * a * (3 - 2 * a), sb = b * b * (3 - 2 * b);
  return (hh(i, j) * (1 - sa) + hh(i + 1, j) * sa) * (1 - sb) + (hh(i, j + 1) * (1 - sa) + hh(i + 1, j + 1) * sa) * sb;
}

// ---- the seep's two forms (one program each, every zone) ---------------------------------
// House law for additive light under water: fog OFF, its own fade to black with range (never toward
// the fog colour), so it reads the same cold pale at 5 u and at 40.
// DEPTH-STABLE ON THE SILT (fix round 2): the layer lies on the silt's own vertices, so its clip
// position is computed EXACTLY as the silt's standard material computes it (projection * (modelView *
// p), the same rounding), and the material pulls it toward the lens (polygonOffset) with depth writes
// off: it can never lose the depth test to the surface it lies on. (Computed as projection * view *
// model it differed by float rounding and passed LEQUAL in patches: flat camouflage blotches that
// crawled with the TAA jitter.)
const SEEP_VS = `
  attribute float aLeak; varying float vLeak; varying vec3 vW;
  void main(){ vLeak = aLeak; vW = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition; }`;
const NOISE = `
  float sh21(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float svn(vec2 p){ vec2 i = floor(p), g = fract(p); g = g * g * (3.0 - 2.0 * g);
    return mix(mix(sh21(i), sh21(i + vec2(1, 0)), g.x), mix(sh21(i + vec2(0, 1)), sh21(i + vec2(1, 1)), g.x), g.y); }`;
const SEEP_FS = `
  uniform vec3 uCol; uniform float uK, uTime, uFar; varying float vLeak; varying vec3 vW;
  ${NOISE}
  void main(){
    // slow-drifting patches: the cold light finds some cracks and not others, and moves between them
    float n = svn(vW.xz * 0.55 + vec2(uTime * 0.05, -uTime * 0.035)) * 0.65 + svn(vW.xz * 1.7 - uTime * 0.09) * 0.35;
    float d = distance(vW, cameraPosition);
    // up close it is a breath, not paint on the silt: it reads from range, and thins as you come to it
    float a = vLeak * uK * (0.3 + 0.95 * n) * clamp(1.0 - d / uFar, 0.0, 1.0) * (0.3 + 0.7 * smoothstep(3.0, 16.0, d));
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uCol * a, 1.0);
  }`;
// the wisps: crossed vertical cards, a rising scroll of noise, soft at the root and the crown and
// at both edges, so no geometry ever cuts one flat
const WISP_VS = `
  attribute float aPh; attribute float aSide; varying vec2 vUv; varying float vPh; varying vec3 vW;
  void main(){ vUv = uv; vPh = aPh; vec4 w = modelMatrix * vec4(position, 1.0);
    // turned about the vertical to face the lens (never seen edge-on as a line)
    vec3 tc = cameraPosition - w.xyz; vec3 r = normalize(vec3(tc.z, 0.0, -tc.x) + vec3(1e-4, 0.0, 0.0));
    w.xyz += r * aSide; vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w; }`;
const WISP_FS = `
  uniform vec3 uCol; uniform float uK, uTime, uFar; varying vec2 vUv; varying float vPh; varying vec3 vW;
  ${NOISE}
  void main(){
    float x = vUv.x * 2.0 - 1.0;
    float n = svn(vec2(vUv.x * 2.2 + vPh * 7.0, vUv.y * 2.4 - uTime * 0.32 - vPh));
    float edge = (1.0 - smoothstep(0.15, 1.0, abs(x + 0.35 * (n - 0.5)))) ;
    float vert = smoothstep(0.0, 0.32, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
    vec3 tc = cameraPosition - vW; float d = length(tc);
    float side = 1.0 - smoothstep(0.55, 0.92, abs(tc.y) / max(d, 1e-3));   // a strand seen from above is no strand
    float a = uK * edge * vert * side * (0.2 + n * n * 1.3) * clamp(1.0 - d / uFar, 0.0, 1.0);
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uCol * a, 1.0);
  }`;
function seepMat(zi, vs, fs, key) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Vector3(...SEEP_COL[zi]) }, uK: { value: 0 }, uTime: { value: 0 }, uFar: { value: 75 } },
    vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true, fog: false
  });
  if (key === 'fissureSeep') { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; }
  m.customProgramCacheKey = () => key;
  return m;
}

// ---- build (boot) ----------------------------------------------------------------------
export function buildFissures() {
  buildPlumes();   // the opening's silt clouds (the Brooder's sand-plume system): built now, warmed with the rest
  for (let zi = 0; zi < 3; zi++) Z.push(buildZone(zi));
  for (let zi = 0; zi < 3; zi++) { layout(zi); setFissureOpen(zi, 0); }
}
function buildZone(zi) {
  const F = FISSURE[zi];
  // the rubble: four rock shapes (flora's generator on our own stream), one InstancedMesh each
  const rand = seededRand(0xF1550 + zi * 7919);
  const kinds = SHAPES.map((S, k) => {
    const kit = jamRockKit(zi, rand, S[0], S[1], S[2], S[3]);
    const g = kit.geo;
    g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(N_BOULDER * 4), 4));
    const im = new THREE.InstancedMesh(g, kit.mat, N_BOULDER);
    im.name = 'fissureJam' + zi + '_' + k;
    im.receiveShadow = true;           // as flora's boulders (part of the program key)
    im.castShadow = false;
    for (let i = 0; i < N_BOULDER; i++) im.setColorAt(i, _c.set(kit.rock));
    scene.add(im);
    // the shape's own vertices and triangles (its true top, its footprint on the floor grid)
    const rp = g.attributes.position, rv = new Float32Array(rp.count * 3);
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < rp.count; i++) { rv[i * 3] = rp.getX(i); rv[i * 3 + 1] = rp.getY(i); rv[i * 3 + 2] = rp.getZ(i); }
    for (let i = 0; i < rp.count; i++) { lo = Math.min(lo, rv[i * 3 + 1]); hi = Math.max(hi, rv[i * 3 + 1]); }
    return { im, rv, tri: g.index.array, rock: kit.rock, n: 0 };
  });
  // the floor grid / the silt: one vertex per grid cell; topology is site-invariant (the outline never moves)
  const VMAX = F.halfW * 1.36 + 0.75;
  const nu = Math.round(2 * F.halfLen / GD) + 1, nv = 2 * Math.ceil(VMAX / GD) + 1, v0 = -(nv - 1) / 2 * GD;
  const NVX = nu * nv, nuF = 2 * nu - 1, nvF = 2 * nv - 1, NF = nuF * nvF;   // mesh vertex (i, j) = floor cell (2i, 2j)
  const inside = new Uint8Array(NVX);
  for (let i = 0; i < nu; i++) {
    const u = -F.halfLen + i * GD, wd = _widths(F, u), w0 = wd.w0, w1 = wd.w1;
    for (let j = 0; j < nv; j++) { const v = v0 + j * GD; inside[i * nv + j] = (Math.abs(u) < F.halfLen && v <= w1 + 0.3 && v >= -w0 - 0.3) ? 1 : 0; }
  }
  const quads = [];
  for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nv - 1; j++) {
    const A = i * nv + j, B = A + nv, C = B + 1, D = A + 1;
    if (inside[A] | inside[B] | inside[C] | inside[D]) quads.push(A, D, B, B, D, C);   // wound up (+y), as the terrain
  }
  const idx = new Uint32Array(quads);
  const pos = new THREE.BufferAttribute(new Float32Array(NVX * 3), 3);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', pos);
  sg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NVX * 3), 3));
  sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NVX * 3), 3));
  sg.setIndex(new THREE.BufferAttribute(idx, 1));
  const silt = new THREE.Mesh(sg, terrainMeshes[zi].material);   // the seabed's own material
  silt.name = 'fissureSilt' + zi;
  silt.receiveShadow = true;          // as the terrain and its fissure patch (program key)
  scene.add(silt);
  // the seep layer: the silt's own vertices (it sags and drains with them), its own leak mask; the
  // index is refilled per layout with the quads that leak at all
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', pos);
  lg.setAttribute('aLeak', new THREE.BufferAttribute(new Float32Array(NVX), 1));
  lg.setIndex(new THREE.BufferAttribute(new Uint32Array(idx.length), 1));
  const leak = new THREE.Mesh(lg, seepMat(zi, SEEP_VS, SEEP_FS, 'fissureSeep'));
  leak.name = 'fissureSeep' + zi; leak.frustumCulled = false; leak.renderOrder = 3;
  scene.add(leak);
  // the wisps: N_WISP crossed cards, one draw; placed per layout
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_WISP * 4 * 3), 3));
  wg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N_WISP * 4 * 2), 2));
  wg.setAttribute('aPh', new THREE.BufferAttribute(new Float32Array(N_WISP * 4), 1));
  wg.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(N_WISP * 4), 1));
  const wi = new Uint16Array(N_WISP * 6);
  for (let k = 0; k < N_WISP; k++) { const b = k * 4; wi.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], k * 6); }
  wg.setIndex(new THREE.BufferAttribute(wi, 1));
  const wisp = new THREE.Mesh(wg, seepMat(zi, WISP_VS, WISP_FS, 'fissureWisp'));
  wisp.name = 'fissureWisp' + zi; wisp.frustumCulled = false; wisp.renderOrder = 3;
  scene.add(wisp);
  const g = { u0: -F.halfLen, v0, d: FD, nu: nuF, nv: nvF, h: new Float32Array(NF) };
  return { zi, kinds, grid: g, inside, silt, leak, wisp, nverts: NVX, mu: nu, mv: nv, quadIdx: idx,
    S0: new Float32Array(NF), D: new Float32Array(NF), FL: new Float32Array(NF), dist: new Float32Array(NF), SL: new Float32Array(NF),
    sY: new Float32Array(NVX), sP: new Float32Array(NVX), wispY: new Float32Array(N_WISP), wispP: new Float32Array(N_WISP),
    n: 0, B: new Float32Array(N_BOULDER * BS),
    k: 0, t: -1, rt: -1, q: 0, sag: 0, drop: 0, topMax: -1e9, siltOn: true, rockOn: true };
}

// ---- layout (boot + every reseed): pure function of (site, zone) and the terrain -------------
function inSlab(x, z, zi, r) {
  if (slabProbe(x, z, zi).q >= 0) return true;
  for (let k = 0; k < 6; k++) {
    const a = k * 1.0472;
    if (slabProbe(x + Math.cos(a) * r, z + Math.sin(a) * r, zi).q >= 0) return true;
  }
  return false;
}
// grid cell of world (x, z): writes _l.u/_l.v and returns the flat index (-1 off the grid)
function cellOf(Fz, x, z) {
  fissureLocal(x, z, Fz.zi, _l);
  const g = Fz.grid, i = Math.round((_l.u - g.u0) / g.d), j = Math.round((_l.v - g.v0) / g.d);
  return i < 0 || j < 0 || i >= g.nu || j >= g.nv ? -1 : i * g.nv + j;
}
const _tv = new Float32Array(3 * 1024);   // one block's vertices in world space (largest shape: 642 verts)
const _tg = new Float32Array(2 * 1024);   // ...and in grid coordinates
function layout(zi) {
  const Fz = Z[zi], F = FISSURE[zi], B = Fz.B, g = Fz.grid, nu = g.nu, nv = g.nv;
  const rand = seededRand(0x6A3C5 ^ (currentSiteIndex() * 92821) ^ (zi * 104729));
  const rr = (a, b) => a + (b - a) * rand();
  const kThroat = F.throatHalfW / F.halfW, ZB = zoneBottom(zi);
  const S0 = Fz.S0, D = Fz.D;
  // per station: the base profile, the widths, the lower lip on each side (the bound nothing may top)
  const lipLo = new Float32Array(nu), wS0 = new Float32Array(nu), wS1 = new Float32Array(nu);
  for (let i = 0; i < nu; i++) {
    const u = g.u0 + i * g.d, wd = _widths(F, u); wS0[i] = wd.w0; wS1[i] = wd.w1;
    let lo = 1e9;
    for (let sd = 0; sd < 2; sd++) { fissureWorld(u, sd ? wd.w1 : -wd.w0, zi, _w); lo = Math.min(lo, terrainH(_w.x, _w.z, zi)); }
    lipLo[i] = lo;
  }
  // 1. THE SILT'S BED: the jam's profile, drifted up against the walls, undulating, ripple-scoured
  for (let i = 0; i < nu; i++) {
    const u = g.u0 + i * g.d, jy = jamYAt(u, zi, terrainH), cap = lipLo[i] - 0.4;
    for (let j = 0; j < nv; j++) {
      const v = g.v0 + j * g.d, f = v >= 0 ? v / Math.max(0.05, wS1[i]) : -v / Math.max(0.05, wS0[i]);
      const bank = 0.6 * sstep(0.5, 1.0, f) * (0.7 + 0.6 * vnoise(u * 0.3 + 11, v * 0.3));
      const und = 0.22 * (vnoise(u * 0.28 + zi * 7, v * 0.4) - 0.5) + 0.07 * (vnoise(u * 1.3, v * 1.3 + 5) - 0.5);
      S0[i * nv + j] = Math.min(cap, jy + Math.max(0, bank + und));
      D[i * nv + j] = -1e9;
    }
  }
  const surf = c => Math.max(S0[c], D[c]);
  // 2. THE RUBBLE: clumps (an anchor and its pile), big blocks wedged at the walls, a few strays
  for (const K of Fz.kinds) K.n = 0;
  let n = 0;
  const clumpU = [], clumpV = [], clumpR = [];
  const nClumps = Math.round(F.halfLen / 2.0);
  for (let c = 0; c < nClumps; c++) {
    const wall = c % 3 === 0;
    const u = (rand() * 2 - 1) * F.halfLen * 0.82, wd = _widths(F, u), side = rand() < 0.5 ? 1 : 0, w = side ? wd.w1 : wd.w0;
    clumpU.push(u); clumpV.push((side ? 1 : -1) * w * (wall ? rr(0.6, 0.85) : rr(0, 0.45))); clumpR.push(wall ? rr(1.6, 2.25) : rr(1.0, 1.6));
  }
  const tryBlock = (u, v, R, wall, anchor) => {
    if (n >= N_BOULDER || Math.abs(u) > F.halfLen * 0.86) return false;
    const wd = _widths(F, u), w = v >= 0 ? wd.w1 : wd.w0;
    if (Math.abs(v) > w * 0.98 || w < 1.0) return false;
    fissureWorld(u, v, zi, _w);
    const x = _w.x, z = _w.z;
    if (inSlab(x, z, zi, R)) return false;
    // over >= DROP_MIN of throat (the block must have somewhere to go when it opens)
    const tv = v * kThroat * 0.7; fissureWorld(u, tv, zi, _w);
    const floorY = terrainUnderH(_w.x, _w.z, zi);
    const jy = jamYAt(u, zi, terrainH);
    if (floorY > jy - DROP_MIN) return false;
    const k = anchor && wall ? (rand() < 0.6 ? 0 : 2) : (rand() * SHAPES.length) | 0, K = Fz.kinds[k];
    const sx = R * rr(0.8, 1.3), sy = R * (k === 2 ? rr(0.5, 0.8) : rr(0.65, 1.05)), sz = R * rr(0.8, 1.2);
    const tl = anchor ? 0.55 : 0.95;
    _e.set(rr(-tl, tl), rr(0, 6.2832), rr(-tl, tl)); _q.setFromEuler(_e);
    // settle it on what is already there: lift until no vertex is under the surface, then bed it in
    const rv = K.rv, nvv = rv.length / 3;
    let lift = -1e9, lo = 1e9, hi = -1e9;
    for (let a = 0; a < nvv; a++) {
      _p.set(rv[a * 3] * sx, rv[a * 3 + 1] * sy, rv[a * 3 + 2] * sz).applyQuaternion(_q);
      _tv[a * 3] = _p.x; _tv[a * 3 + 1] = _p.y; _tv[a * 3 + 2] = _p.z;
      lo = Math.min(lo, _p.y); hi = Math.max(hi, _p.y);
      const cc = cellOf(Fz, x + _p.x, z + _p.z);
      if (cc >= 0) lift = Math.max(lift, surf(cc) - _p.y);
    }
    if (lift < -1e8) return false;
    let y = lift - (hi - lo) * (anchor ? rr(0.35, 0.55) : rr(0.25, 0.5));
    // never taller than its place allows: a step-and-a-bit over the bed in the middle, up to the
    // lower lip (+0.3) at the walls; a pile may stand a little higher than a lone block
    const c0 = cellOf(Fz, x, z), i0 = Math.round((_l.u - g.u0) / g.d);
    let lipMin = 1e9;   // the lowest lip anywhere along the block's length (it may reach the outline there)
    for (let ii = Math.max(0, i0 - Math.ceil(1.5 * R / g.d)); ii <= Math.min(nu - 1, i0 + Math.ceil(1.5 * R / g.d)); ii++) lipMin = Math.min(lipMin, lipLo[ii]);
    const bed = c0 >= 0 ? S0[c0] : jy, lim = Math.min(lipMin + 0.3, bed + (wall ? 2.4 : 1.5));
    if (y + hi > lim) y -= y + hi - lim;
    if (y - floorY < DROP_MIN) return false;    // (settled low, over a shallow stretch: it would have nowhere to go)
    // rasterise: every vertex, then every triangle's cell centres, into the block-top grid
    for (let a = 0; a < nvv; a++) {
      const wx = x + _tv[a * 3], wy = y + _tv[a * 3 + 1], wz = z + _tv[a * 3 + 2];
      const cc = cellOf(Fz, wx, wz);
      _tg[a * 2] = (_l.u - g.u0) / g.d; _tg[a * 2 + 1] = (_l.v - g.v0) / g.d;
      if (cc >= 0 && wy > D[cc]) D[cc] = wy;
    }
    const T = K.tri;
    for (let t = 0; t < T.length; t += 3) {
      const ia = T[t], ib = T[t + 1], ic = T[t + 2];
      const ax = _tg[ia * 2], ay = _tg[ia * 2 + 1], bx = _tg[ib * 2], by = _tg[ib * 2 + 1], cx = _tg[ic * 2], cy = _tg[ic * 2 + 1];
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-9) continue;
      const i0t = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1t = Math.min(nu - 1, Math.floor(Math.max(ax, bx, cx)));
      const j0t = Math.max(0, Math.ceil(Math.min(ay, by, cy))), j1t = Math.min(nv - 1, Math.floor(Math.max(ay, by, cy)));
      for (let ii = i0t; ii <= i1t; ii++) for (let jj = j0t; jj <= j1t; jj++) {
        const l1 = ((by - cy) * (ii - cx) + (cx - bx) * (jj - cy)) / den, l2 = ((cy - ay) * (ii - cx) + (ax - cx) * (jj - cy)) / den, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const h = y + l1 * _tv[ia * 3 + 1] + l2 * _tv[ib * 3 + 1] + l3 * _tv[ic * 3 + 1], cc = ii * nv + jj;
        if (h > D[cc]) D[cc] = h;
      }
    }
    // the record
    const o = n * BS, p = jamSagProfile(u, v, zi);
    B[o] = u; B[o + 1] = v; B[o + 2] = y; B[o + 3] = sx; B[o + 4] = sy; B[o + 5] = sz;
    B[o + 6] = _q.x; B[o + 7] = _q.y; B[o + 8] = _q.z; B[o + 9] = _q.w;
    // the pour: as the floor goes, the middle first; the wall blocks last
    B[o + 10] = T_OPEN + 1.3 * Math.pow(1 - p, 0.7) + 0.35 * rand();
    B[o + 11] = floorY; B[o + 12] = tv;
    _ax.set(rr(-1, 1), rr(-0.4, 0.4), rr(-1, 1)).normalize();
    B[o + 13] = _ax.x; B[o + 14] = _ax.y; B[o + 15] = _ax.z; B[o + 16] = rr(0.6, 2.2) * (rand() < 0.5 ? 1 : -1) / Math.max(0.6, R);
    B[o + 17] = p; B[o + 18] = hi; B[o + 19] = rr(0, 6.2832); B[o + 20] = k; B[o + 21] = K.n;
    _c.set(K.rock).multiplyScalar(rr(0.65, 1.2) * (k === 3 ? 0.85 : 1));
    K.im.setColorAt(K.n, _c);
    K.n++; n++;
    return true;
  };
  // anchors first (the big ones, wall anchors wedged in hard), then each pile, then strays
  for (let c = 0; c < nClumps; c++) tryBlock(clumpU[c], clumpV[c], clumpR[c], c % 3 === 0, true);
  for (let pass = 0; pass < 16 && n < N_BOULDER - 18; pass++) {
    for (let c = 0; c < nClumps && n < N_BOULDER - 18; c++) {
      const a = rand() * 6.2832, rad = clumpR[c] * rr(0.5, 1.9) + pass * 0.12;
      const R = 0.35 + 0.95 * Math.pow(rand(), 1.4) * (1.2 - pass / 24);
      tryBlock(clumpU[c] + Math.cos(a) * rad, clumpV[c] + Math.sin(a) * rad * 0.8, R, c % 3 === 0, false);
    }
  }
  for (let tr = 0; tr < 400 && n < N_BOULDER; tr++) {
    const u = (rand() * 2 - 1) * F.halfLen * 0.86, wd = _widths(F, u), v = (rand() * 2 - 1) * 0.8 * (rand() < 0.5 ? wd.w1 : wd.w0);
    tryBlock(u, v, rr(0.45, 0.9), false, false);
  }
  Fz.n = n;
  for (const K of Fz.kinds) { K.im.count = K.n; K.im.instanceColor.needsUpdate = true; }
  const jt = jamTopY(zi, terrainH);
  for (const K of Fz.kinds) K.im.boundingSphere = new THREE.Sphere(new THREE.Vector3(F.cx, jt - 30, F.cz), F.halfLen + 45);

  // 3. THE FLOOR: silt banked round every block to within JAM_STEP_OK of its top at the DRIFT slope
  //    (a chamfer dilation of the block tops), so every rise underfoot is a step or a bank
  const FL = Fz.FL, dist = Fz.dist, dd = g.d * DRIFT, ddg = g.d * Math.SQRT2 * DRIFT;
  for (let c = 0; c < FL.length; c++) { FL[c] = D[c] > -1e8 ? D[c] - JAM_STEP_OK : -1e9; dist[c] = D[c] > -1e8 ? 0 : 1e9; }
  const relax = (c, o, dh, dl) => { if (FL[o] - dh > FL[c]) FL[c] = FL[o] - dh; if (dist[o] + dl < dist[c]) dist[c] = dist[o] + dl; };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const c = i * nv + j;
    if (i > 0) { relax(c, c - nv, dd, g.d); if (j > 0) relax(c, c - nv - 1, ddg, g.d * 1.414); if (j < nv - 1) relax(c, c - nv + 1, ddg, g.d * 1.414); }
    if (j > 0) relax(c, c - 1, dd, g.d);
  }
  for (let i = nu - 1; i >= 0; i--) for (let j = nv - 1; j >= 0; j--) {
    const c = i * nv + j;
    if (i < nu - 1) { relax(c, c + nv, dd, g.d); if (j < nv - 1) relax(c, c + nv + 1, ddg, g.d * 1.414); if (j > 0) relax(c, c + nv - 1, ddg, g.d * 1.414); }
    if (j < nv - 1) relax(c, c + 1, dd, g.d);
  }
  const H = g.h, SL = Fz.SL, sY = Fz.sY, sP = Fz.sP;
  for (let i = 0; i < nu; i++) {
    const u = g.u0 + i * g.d, cap = lipLo[i] + 0.3;
    for (let j = 0; j < nv; j++) {
      const c = i * nv + j;
      let silt = Math.max(S0[c], Math.min(FL[c], cap));   // the silt: its bed, or the bank round a block
      fissureWorld(u, g.v0 + j * g.d, zi, _w);
      if (slabProbe(_w.x, _w.z, zi).q >= 0) { const h = terrainH(_w.x, _w.z, zi); if (h > silt - 0.08 && h < silt + 0.08) silt = h + 0.08; }   // a buried / low slab: cover its top
      SL[c] = silt;
      H[c] = Math.max(silt, D[c]);
    }
  }
  // the drawn silt: the floor's silt at every other cell, tucked 0.06 under a wall face it would lie flush with
  const mu = Fz.mu, mv = Fz.mv;
  const P = Fz.silt.geometry.attributes.position.array, CC = Fz.silt.geometry.attributes.color.array, LK = Fz.leak.geometry.attributes.aLeak.array;
  for (let i = 0; i < mu; i++) {
    const u = g.u0 + i * GD, iF = 2 * i;
    for (let j = 0; j < mv; j++) {
      const m = i * mv + j, c = iF * nv + 2 * j, v = g.v0 + j * GD;
      const f = v >= 0 ? v / Math.max(0.05, wS1[iF]) : -v / Math.max(0.05, wS0[iF]);
      fissureWorld(u, v, zi, _w);
      let y = SL[c];
      const h = terrainH(_w.x, _w.z, zi);
      if (slabProbe(_w.x, _w.z, zi).q < 0 && h > y - 0.06 && h < y + 0.06) y = h - 0.06;
      P[m * 3] = _w.x; P[m * 3 + 1] = y; P[m * 3 + 2] = _w.z;
      sY[m] = y; sP[m] = jamSagProfile(u, v, zi);
      // colour, in the terrain's encoding: dark into the walls and in the blocks' feet, gravel where
      // the rubble pokes through, height over the basin floor
      const dm = dist[c], ao = (1 - 0.45 * sstep(0.6, 1.0, f)) * (0.55 + 0.45 * sstep(0, 1.1, dm));
      CC[m * 3] = 0.18 + 0.82 * ao * ao;
      CC[m * 3 + 1] = 0.55 + 0.35 * (1 - sstep(0, 1.4, dm));   // packed and gritty, gravel at the blocks' feet
      CC[m * 3 + 2] = c01((y - ZB - 2) / 220);
      // the seep's mask: the cold light comes up through the crevices at the blocks' feet (brightest
      // a hand's width out from a block), NOT through packed open silt (no base: open silt stays dark
      // sediment), never under a block, fading into the walls
      const under = D[c] > SL[c] + 0.02 ? 1 : 0;
      LK[m] = (1 - under) * sstep(0.0, 0.45, dm) * Math.exp(-dm / 0.8) * (1 - sstep(0.7, 0.98, f)) * (f <= 1 ? 1 : 0);
    }
  }
  setJamGrid(zi, g);
  const sg = Fz.silt.geometry;
  sg.attributes.position.needsUpdate = true; sg.attributes.color.needsUpdate = true;
  sg.computeVertexNormals();
  sg.computeBoundingSphere(); sg.boundingSphere.radius += SILT_GONE + 2;
  // the seep layer's quads: those that leak at all
  const qi = Fz.quadIdx, li = Fz.leak.geometry.index.array;
  let nl = 0;
  for (let t = 0; t < qi.length; t += 6) {
    if (LK[qi[t]] + LK[qi[t + 1]] + LK[qi[t + 2]] + LK[qi[t + 5]] < 0.02) continue;
    for (let q = 0; q < 6; q++) li[nl++] = qi[t + q];
  }
  Fz.leak.geometry.setDrawRange(0, nl);
  Fz.leak.geometry.index.needsUpdate = true;
  Fz.leak.geometry.attributes.aLeak.needsUpdate = true;
  // the wisps: over the brightest crevices, spread out
  const WG = Fz.wisp.geometry, WP = WG.attributes.position.array, WU = WG.attributes.uv.array, WA = WG.attributes.aPh.array, WS = WG.attributes.aSide.array;
  const wx = [], wz = [];
  for (let k = 0; k < N_WISP; k++) {
    let best = -1, bc = 0;
    for (let tr = 0; tr < 400; tr++) {
      const i = (rand() * mu * 0.7 + mu * 0.15) | 0, j = (rand() * mv) | 0, c = i * mv + j;
      let s = LK[c] * (0.5 + rand());
      for (let q = 0; q < wx.length; q++) if (Math.hypot(P[c * 3] - wx[q], P[c * 3 + 2] - wz[q]) < 6) s = -1;
      if (s > best) { best = s; bc = c; }
    }
    const x = P[bc * 3], y = sY[bc] - 0.3, z = P[bc * 3 + 2], hgt = rr(3.2, 5.5), wdt = rr(0.9, 1.5), ph = rand();
    wx.push(x); wz.push(z); Fz.wispY[k] = y; Fz.wispP[k] = sP[bc];
    for (let q = 0; q < 4; q++) {
      const b = k * 4 + q, top = q >> 1;
      WP[b * 3] = x; WP[b * 3 + 1] = y + top * hgt; WP[b * 3 + 2] = z;
      WS[b] = ((q & 1) ? 1 : -1) * wdt * (top ? 1.5 : 1); WU[b * 2] = q & 1; WU[b * 2 + 1] = top; WA[b] = ph;
    }
  }
  for (const a of ['position', 'uv', 'aPh', 'aSide']) WG.attributes[a].needsUpdate = true;
  Fz.wispBase = new Float32Array(WP);   // rest positions (the slump moves them)
}

// On a reseed (game.js reseedWorldNow, after resetJam): the jam hangs under the new site's lips.
export function reseatFissures() {
  for (let zi = 0; zi < Z.length; zi++) { const k = Z[zi].k; layout(zi); setFissureOpen(zi, k); }
}

// ---- state --------------------------------------------------------------------------------
// Instant state (load, reseed, zone entry from the chart's record, probes): stops an opening.
export function setFissureOpen(zi, k) {
  const F = Z[zi]; if (!F) return;
  F.k = Math.max(0, Math.min(1, k)); F.t = -1; F.rt = -1; F.q = 0;
  setJamSag(zi, 0); setFissureShut(zi, F.k <= 0.5);
  F.sag = 0; F.drop = 0;
  F.siltOn = F.rockOn = F.k <= 0.5;
  if (F.k <= 0.5) pose(zi, -1);
}
// The calm's opening: starts the collapse + swell from shut; returns its duration in seconds.
export function openFissure(zi) {
  const F = Z[zi]; if (!F) return 0;
  if (F.t < 0 && F.k >= 1) return 0;
  if (F.t < 0) { setFissureOpen(zi, 0); F.t = 0; F.rt = 0; }
  return COLLAPSE + SWELL;
}
export function fissureOpenK(zi) { return Z[zi] ? Z[zi].k : 0; }
export function fissureOpening(zi) { return !!Z[zi] && Z[zi].t >= 0; }

// ---- per frame ---------------------------------------------------------------------------
const sagAt = t => t < T_BREAK ? 0 : SAG_MAX * Math.pow(c01((t - T_BREAK) / (T_OPEN - T_BREAK)), 1.7);
// a block sinking through water: it gathers way, then falls at its terminal speed
const TC = V_ROCK / A_ROCK, DC = 0.5 * A_ROCK * TC * TC;
const fallAt = tau => tau < TC ? 0.5 * A_ROCK * tau * tau : DC + V_ROCK * (tau - TC);
let plumeSeen = -1, plumeOwn = 0;
export function updateFissure(dt, t, activeZone) {
  let quake = 0, opening = false;
  // the clouds' clock: the zone-0 Brooder ticks it every frame she lives; where nobody did since our
  // last look (zones 1 and 2, or her gone), and a cloud of ours may still be hanging, we tick it
  const pt = plumeTicks();
  if (pt === plumeSeen && plumeOwn > 0) { updatePlumes(dt); plumeOwn -= dt; }
  plumeSeen = plumeTicks();
  for (let zi = 0; zi < Z.length; zi++) {
    const F = Z[zi];
    const inSight = terrainMeshes[zi].visible;
    if (F.t >= 0) {
      opening = true;
      const t0 = F.t;
      F.t += dt;
      const T = F.t, c = Math.min(1, T / COLLAPSE);
      F.k = Math.min(1, T / (COLLAPSE + SWELL));
      setFissureShut(zi, F.k <= 0.5);
      // the slump is the floor until the floor goes
      F.sag = sagAt(Math.min(T, T_OPEN));
      setJamSag(zi, F.k <= 0.5 ? F.sag : 0);
      F.drop = T > T_OPEN ? 0.5 * A_SILT * (T - T_OPEN) * (T - T_OPEN) : 0;
      // the seabed shudders: a held tremor easing out over the collapse, a jolt at the break and
      // another as the floor goes
      F.q = T < COLLAPSE + 0.6 ? Math.min(1, T / 0.15) * 0.6 * (1 - c)
        + 0.25 * Math.exp(-(((T - T_BREAK) / 0.25) ** 2)) + 0.2 * Math.exp(-(((T - T_OPEN) / 0.3) ** 2)) : 0;
      if (zi === activeZone) {
        quake = Math.max(quake, F.q);
        // the silt plume: a cough at the break, then the pour's cloud heaving up out of the crack
        if (t0 < T_BREAK && T >= T_BREAK) burst(zi, 1.0, 0.55, 3, 0);
        if (t0 < T_OPEN && T >= T_OPEN) burst(zi, 0.8, 0.7, 3, 1);
        if (t0 < T_OPEN + 0.7 && T >= T_OPEN + 0.7) burst(zi, 0, 0.45, 3, 2);
      }
      if (T >= COLLAPSE + SWELL) { F.t = -1; F.k = 1; F.q = 0; setJamSag(zi, 0); setFissureShut(zi, false); }
    }
    // the pour runs on its own clock: the last blocks are still going down when k reaches 1
    if (F.rt >= 0) { F.rt += dt; pose(zi, F.rt); if (!F.rockOn) F.rt = -1; }
    // in sight only while there is something to see
    for (let k = 0; k < F.kinds.length; k++) F.kinds[k].im.visible = inSight && F.rockOn;
    F.silt.visible = inSight && F.siltOn;
    // the seep: breathing shut; at the break it flares as the cold light finds the cracks, then it is gone
    let a = 0;
    if (inSight && F.k < 1 && F.siltOn) {
      const T = F.t >= 0 ? F.t : -1, c = T >= 0 ? Math.min(1, T / COLLAPSE) : 0;
      a = SEEP_K[zi] * (1 - c) * (T >= 0 ? 1 + 0.7 * Math.exp(-(((T - 1.0) / 0.6) ** 2)) : 1)
        * (0.62 + 0.38 * Math.sin(t * (6.2832 / SEEP_PERIOD) + zi * 1.7));
    }
    F.leak.visible = F.wisp.visible = a > 0.002;
    if (a > 0.002) {
      const L = F.leak.material.uniforms, W = F.wisp.material.uniforms;
      L.uK.value = SEEP_TUNE.layer * SEEP_TUNE.k * a; L.uTime.value = t;
      W.uK.value = SEEP_TUNE.wisp * SEEP_TUNE.k * a; W.uTime.value = t;
    }
  }
  _out.quake = quake; _out.opening = opening;
  return _out;
}
// a silt plume out of the crack: the stir pulse (k > 0) and n clouds of seabed (plume.js 'big', the
// hammer's: they burst low and out, climb, hang and settle over ~6 s, lit and fogged like silt)
// spread along the middle of the crack
function burst(zi, k, size, n, salt) {
  const F = FISSURE[zi], Fz = Z[zi];
  if (k > 0) stirPulse(F.cx, jamYAt(0, zi, terrainH), F.cz, 40, 0, k, k >= 1 ? P_STRIKE : P_SLAM);
  for (let j = 0; j < n; j++) {
    const h = ((j + salt * 3.7) * 0.618 + 0.31) % 1;
    const u = (-0.6 + 1.2 * (j + 0.3 + 0.4 * h) / n) * F.halfLen, wd = _widths(F, u);
    const v = (h * 2 - 1) * 0.35 * (j & 1 ? wd.w1 : wd.w0);
    fissureWorld(u, v, zi, _w);
    spawnPlume(_w.x, jamFloorAt(u, v, zi, terrainH) - Fz.sag * jamSagProfile(u, v, zi) - (salt ? 1.5 : 0), _w.z, 'big', size, zi);   // the pour's rise from down in the crack
  }
  plumeOwn = 8;
}
// Write the jam's pose at opening time T (< 0: at rest). The silt goes once it has drained out of
// sight; each block once it has sunk through the throat floor; the rubble once every block has.
function pose(zi, T) {
  const Fz = Z[zi], B = Fz.B, n = Fz.n;
  const rest = T < 0, sagV = rest ? 0 : sagAt(Math.min(T, T_OPEN));
  const jostle = rest ? 0 : 0.03 * Fz.q;
  let topMax = -1e9, left = 0;
  for (let i = 0; i < n; i++) {
    const o = i * BS, p = B[o + 17], im = Fz.kinds[B[o + 20]].im, slot = B[o + 21];
    let v = B[o + 1], y = B[o + 2] - sagV * p, ang = 0;
    _q.set(B[o + 6], B[o + 7], B[o + 8], B[o + 9]);
    if (!rest && T >= B[o + 10]) {
      const tau = T - B[o + 10], fall = fallAt(tau);
      y -= fall;
      v += (B[o + 12] - v) * Math.min(1, fall / 6);
      ang = B[o + 16] * tau;
      _ax.set(B[o + 13], B[o + 14], B[o + 15]);
      _q.multiply(_qa.setFromAxisAngle(_ax, ang));
      // sunk on through the throat floor, wholly: gone (one by one, never all at once)
      if (y + Math.max(B[o + 3], B[o + 4], B[o + 5]) * 1.4 < B[o + 11]) { im.setMatrixAt(slot, _zero); continue; }
    } else if (jostle > 0) y += jostle * Math.sin(T * 41 + B[o + 19]);
    left++;
    fissureWorld(B[o], v, zi, _w);
    _m.compose(_p.set(_w.x, y, _w.z), _q, _s.set(B[o + 3], B[o + 4], B[o + 5]));
    im.setMatrixAt(slot, _m);
    const top = y + (ang === 0 ? B[o + 18] : Math.max(B[o + 3], B[o + 4], B[o + 5]) * 1.4);
    if (top > topMax) topMax = top;
  }
  Fz.topMax = topMax;
  for (let k = 0; k < Fz.kinds.length; k++) Fz.kinds[k].im.instanceMatrix.needsUpdate = true;
  Fz.rockOn = rest || (left > 0 && T < ROCK_T); Fz.left = left;
  // the silt: sags with the floor, then drains into the throat (the middle fastest); the wisps ride it
  const drop = rest ? 0 : Fz.drop;
  Fz.siltOn = drop < SILT_GONE;
  if (Fz.siltOn) {
    const P = Fz.silt.geometry.attributes.position.array, sY = Fz.sY, sP = Fz.sP;
    for (let i = 0; i < Fz.nverts; i++) { const p = sP[i]; P[i * 3 + 1] = sY[i] - sagV * p - drop * (0.35 + 0.65 * p); }
    Fz.silt.geometry.attributes.position.needsUpdate = true;
    const WP = Fz.wisp.geometry.attributes.position.array, WB = Fz.wispBase;
    for (let k = 0; k < N_WISP; k++) {
      const dy = -sagV * Fz.wispP[k] - drop * (0.35 + 0.65 * Fz.wispP[k]);
      for (let q = 0; q < 4; q++) { const o = (k * 4 + q) * 3 + 1; WP[o] = WB[o] + dy; }
    }
    Fz.wisp.geometry.attributes.position.needsUpdate = true;
  }
}

// ---- dev surface (probes) -------------------------------------------------------------
// state(zi): the opening's live numbers; drawnAt(x, z): the top of what is DRAWN there now (silt or
// block, by a ray down through them). audit(zi): the shut jam against the floor, the slabs, the lips.
const _ray = new THREE.Raycaster(), _ro = new THREE.Vector3(), _rd = new THREE.Vector3(0, -1, 0);
function drawnAt(zi, x, y0, z) {
  const F = Z[zi], objs = [F.silt]; for (const K of F.kinds) if (K.n) objs.push(K.im);
  for (const o of objs) o.updateMatrixWorld();
  _ro.set(x, y0 + 12, z); _ray.set(_ro, _rd); _ray.far = 40;
  const hit = _ray.intersectObjects(objs, false)[0];
  return hit ? hit.point.y : NaN;
}
function state(zi) {
  const F = Z[zi];
  return { k: F.k, t: F.t, quake: F.q, opening: F.t >= 0, bouldersVisible: F.rockOn, left: F.rockOn ? F.left : 0, siltVisible: F.siltOn, boulderTopMax: F.topMax, n: F.n,
    drawnAt: (x, y, z) => drawnAt(zi, x, y, z) };
}
function audit(zi, samples = 1500) {
  const F = Z[zi], B = F.B, FS = FISSURE[zi], P = F.silt.geometry.attributes.position.array, g = F.grid;
  const rand = seededRand(0xA0D17 + zi);
  // the floor Sal stands on against what is drawn there (ray down through the silt and the blocks)
  const errs = []; let clip = 0, hover = 0, n = 0;
  for (let s = 0; s < samples; s++) {
    const u = (rand() * 2 - 1) * FS.halfLen * 0.9, wd = _widths(FS, u), side = rand() < 0.5, w = side ? wd.w1 : wd.w0;
    const v = (side ? 1 : -1) * rand() * (w - 0.5);
    if (w < 1) continue;
    fissureWorld(u, v, zi, _w);
    const fl = shutFloorY(_w.x, _w.z, zi), th = terrainH(_w.x, _w.z, zi);
    if (!(jamAt(_w.x, _w.z, zi) > th + 0.1)) continue;    // the wall or a slab is the ground there
    const dr = drawnAt(zi, _w.x, fl, _w.z);
    if (isNaN(dr)) continue;
    const e = dr - fl; errs.push(Math.abs(e)); n++;
    if (e > 0.3) clip++;          // drawn rock over his boots
    if (e < -0.3) hover++;        // his boots over the drawn ground
  }
  errs.sort((a, b) => a - b);
  let slabGap = 1e9;
  for (let c = 0; c < F.nverts; c++) {
    if (!F.inside[c]) continue;
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    if (slabProbe(x, z, zi).q >= 0) slabGap = Math.min(slabGap, Math.abs(y - terrainH(x, z, zi)));
  }
  // blocks: shapes used, slab footprints, the drop under each, how clumped (nearest-neighbour CV)
  let inSlabN = 0, dropMin = 1e9; const kinds = new Set(), nn = [], sz = [];
  for (let i = 0; i < F.n; i++) {
    const o = i * BS; fissureWorld(B[o], B[o + 1], zi, _w);
    if (slabProbe(_w.x, _w.z, zi).q >= 0) inSlabN++;
    dropMin = Math.min(dropMin, B[o + 2] - B[o + 11]); kinds.add(B[o + 20]); sz.push(2 * Math.max(B[o + 3], B[o + 5]));
    const x0 = _w.x, z0 = _w.z; let best = 1e9;
    for (let j = 0; j < F.n; j++) if (j !== i) { fissureWorld(B[j * BS], B[j * BS + 1], zi, _w); best = Math.min(best, Math.hypot(_w.x - x0, _w.z - z0)); }
    nn.push(best);
  }
  const cv = a => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) / m; };
  // Task 2's 'not a trap' bound: the lower lip a tap-hop over the walkable floor beside it; stepping in
  // is never more than a step up
  let lipOver = 0, stepIn = -1e9;
  for (let u = -FS.halfLen * 0.8; u <= FS.halfLen * 0.8; u += 1) {
    const wd = _widths(FS, u);
    let lo = 1e9, sd = 0;
    for (let s = 0; s < 2; s++) { fissureWorld(u, s ? wd.w1 : -wd.w0, zi, _w); const h = terrainH(_w.x, _w.z, zi); if (h < lo) { lo = h; sd = s; } }
    const w = sd ? wd.w1 : wd.w0, sg = sd ? 1 : -1;
    fissureWorld(u, sg * (w - 0.8), zi, _w); const fl = shutFloorY(_w.x, _w.z, zi);
    lipOver = Math.max(lipOver, lo - fl);
    fissureWorld(u, sg * (w - 0.15), zi, _w); stepIn = Math.max(stepIn, shutFloorY(_w.x, _w.z, zi) - lo);
  }
  sz.sort((a, b) => a - b);
  return { samples: n, p50: +errs[Math.floor(n * 0.5)].toFixed(3), p95: +errs[Math.floor(n * 0.95)].toFixed(3), max: +errs[n - 1].toFixed(2),
    clipPct: +(100 * clip / n).toFixed(2), hoverPct: +(100 * hover / n).toFixed(2), slabGap: +slabGap.toFixed(3),
    boulders: F.n, shapes: kinds.size, inSlab: inSlabN, dropMin: +dropMin.toFixed(1), nnCV: +cv(nn).toFixed(2), sizeCV: +cv(sz).toFixed(2),
    size10: +sz[Math.floor(sz.length * 0.1)].toFixed(2), size90: +sz[Math.floor(sz.length * 0.9)].toFixed(2),
    lowerLipOver: +lipOver.toFixed(2), stepIn: +stepIn.toFixed(2), seepFogOff: F.leak.material.fog === false && F.wisp.material.fog === false,
    lip: +lipMeanY(zi, terrainH).toFixed(2), shut: fissureShut(zi), gridCells: g.nu * g.nv };
}
export const __fissure = { seep: SEEP_TUNE, seepK: SEEP_K, setOpen: setFissureOpen, open: openFissure, k: fissureOpenK, state, audit, programs: () => renderer.info.programs.length,
  progList: () => renderer.info.programs.map(p => p.id + '|' + p.name + '|' + p.cacheKey.length),
  // which drawables use program id (dev: first-sight audits)
  progUsers: id => { const out = []; scene.traverse(o => { const m = o.material; if (!m || Array.isArray(m)) return; const pr = renderer.properties.get(m).currentProgram;
    if (pr && pr.id === id) { let q = o, path = ''; for (let d = 0; d < 4 && q; d++, q = q.parent) path += (q.name || q.type) + '<'; out.push(path + ' ' + m.type); } }); return out; },
  // the program ids the rubble, silt, seep and wisps draw with (each must exist before first sight)
  ownProgs: () => { const out = []; for (const F of Z) for (const o of [...F.kinds.map(K => K.im), F.silt, F.leak, F.wisp]) { const pr = renderer.properties.get(o.material).currentProgram; out.push(o.name + ':' + (pr ? pr.id : 'none')); } return out; } };
if (typeof window !== 'undefined') window.__fissure = __fissure;
