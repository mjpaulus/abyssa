// THE FAR ISLANDS: basalt stacks where the zone-0 rampart breaks the surface.
// OWNED BY: horizon agent (roadmap/far-ridgeline-read.md, Michael 2026-10-04: "Build a few
// far islands" — two or three low, dark breaches far off; lonely, dread, brass-age; never
// coastline, never inviting).
//
// WHAT THEY ARE. terrain.js lays the crowns per site (ISLES: a seeded stream of bearings
// >= 95 degrees apart, 392-428 u off the raft) and lifts a drowned SHOAL under each one in
// terrainH, soft-capped at -6.5 so the seabed itself never reaches a gale trough. Everything
// that stands in the air is here: ONE merged mesh of polygonal columns (5-7 facets, flat
// shaded, jointed into stacked blocks, leaning, snapped tops), every column's foot sunk 8 u
// into that shoal so no gap can open between rock and seabed. Three kinds — a broken
// CROWN (a ring of stacks with a gap, one tall), a NEEDLE (one tall stack and a few
// stumps), TEETH (a low ragged line) — so each bearing is its own landmark.
//
// WHY A SEPARATE MESH. The terrain grid is ~6.6 u per quad out at r = 410: a heightfield
// there draws a stack as a cone. A few thousand triangles of real columns cost one draw.
//
// ABOVE WATER IS A DIFFERENT MATERIAL. The seabed shader is built for light that has
// crossed the interface; this one is rock in air: dry basalt above a dark wet splash band
// that rises with the storm, a black weed band at the waterline, salt and lime streaks
// running down the faces under the ledges, and the sea breaking white at the foot — a
// foam band that rides the LOCAL sea height (a plane fitted to three surfaceHeightAt taps
// per island per frame, the CPU twin of the drawn swell) and surges with it. The cloud
// deck's shadow (sky.js getCloudShadow) dims the direct light. The air haze is the global
// fog chunk's air leg (water.js), which already fades a far ridge into the sky behind it.
//
// THE SEA MEETS THEM BY DEPTH. The rock is opaque and drawn first; the sea surface is a
// transparent pass that depth-tests against it (and writes depth above water), so the
// waterline is exactly where the displaced sea crosses the rock — no sea through them,
// no gap. The dome draws last behind everything. The far-sea band starts at 0.7 x
// camera.far = 490 u, past every crown.
//
// GATING. Visible exactly when the zone-0 terrain is (zoneBand), so they can never pop
// against their own shoal. From the deck they stand on the horizon; from below they are
// dark columns rising to the surface out of the rampart.
//
// BUDGET. <= 48 columns, ~16k triangles at capacity, one draw (+ the refraction pass's
// one). Per frame: 9 sea-height queries (~4 us each) only while the camera is near the
// surface, and a handful of uniform writes. Zero allocation: buffers are allocated once
// at capacity and refilled in place on a voyage (drawRange carries the live count).
import * as THREE from 'three';
import { scene } from '../core.js';
import { terrainH, ISLES, terrainMeshes } from './terrain.js';
import { stream } from './site.js';
import { surfaceHeightAt, stormLevel } from './water.js';
import { getCloudShadow } from './sky.js';
import { SUN } from '../config.js';

const MAX_COLS = 48, MAX_SIDES = 7, ROWS = 15;
const VPC = MAX_SIDES * ROWS + 1;                                  // verts per column
const IPC = (MAX_SIDES * (ROWS - 1) * 2 + MAX_SIDES) * 3;          // indices per column
const MAX_ISLES = 4;
const FOOT_SINK = 8;

const uIsle = {
  uIsT: { value: 0 },
  uIsAir: { value: 1 },
  // per island: (cx, cz, sea height at centre, 0) and (dh/dx, dh/dz, 0, 0)
  uSeaC: { value: Array.from({ length: MAX_ISLES }, () => new THREE.Vector4()) },
  uSeaG: { value: Array.from({ length: MAX_ISLES }, () => new THREE.Vector4()) },
  // x: splash band height, y: its noisy range, z: surf band height
  uSplash: { value: new THREE.Vector3(1.4, 1.0, 0.8) },
  uCloudT: { value: null },
  uCloudW: { value: new THREE.Vector4(0, 0, 4096, 0) },
  uSunW: { value: new THREE.Vector3(SUN.dir.x, SUN.dir.y, SUN.dir.z) },
  uRockC: { value: new THREE.Color(0x4b4c4e) },
  uSaltC: { value: new THREE.Color(0x9a9b94) },
  uWeedC: { value: new THREE.Color(0x1b211c) }
};

const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true });
mat.customProgramCacheKey = () => 'abyssa-isles-1';
mat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, uIsle);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
attribute float aIsle;
uniform vec4 uSeaC[${MAX_ISLES}], uSeaG[${MAX_ISLES}];
varying vec3 vIW;
varying float vWL;`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vIW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  {
    int ii = int( aIsle + 0.5 );
    vec4 c = uSeaC[ ii ], g = uSeaG[ ii ];
    vWL = c.z + g.x * ( vIW.x - c.x ) + g.y * ( vIW.z - c.y );
  }`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uIsT, uIsAir;
uniform vec3 uSplash, uSunW, uRockC, uSaltC, uWeedC;
uniform sampler2D uCloudT;
uniform vec4 uCloudW;
varying vec3 vIW;
varying float vWL;
float isH( vec2 p ){ return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float isN( vec2 p ){
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( isH( i ), isH( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( isH( i + vec2( 0.0, 1.0 ) ), isH( i + vec2( 1.0, 1.0 ) ), u.x ), u.y ) * 2.0 - 1.0;
}`)
    .replace('#include <color_fragment>', `
  vec3 iwp = vIW;
  float hW = iwp.y - vWL;
  vec3 iN = normalize( cross( dFdx( iwp ), dFdy( iwp ) ) );
  float iUp = iN.y;
  float n1 = isN( iwp.xz * 0.11 + iwp.y * 0.07 ) * 0.65 + isN( iwp.xz * 0.37 - iwp.y * 0.21 ) * 0.35;
  float n2 = isN( vec2( ( iwp.x + iwp.z ) * 0.8, iwp.y * 0.085 ) + 13.1 );
  vec3 alb = uRockC * ( 0.80 + 0.32 * n1 );
  // Salt and lime run down the faces from the ledges: high on the stack, never on the caps.
  float streak = smoothstep( 0.30, 0.85, n2 ) * smoothstep( 2.5, 9.0, hW ) * ( 1.0 - iUp * iUp );
  alb = mix( alb, uSaltC, streak * 0.42 );
  // Crusted tops where the birds and the salt settle.
  alb = mix( alb, uSaltC * 0.85, smoothstep( 0.55, 0.92, iUp ) * smoothstep( 1.5, 4.0, hW ) * 0.55 );
  // The splash zone: dark and glossy, a ragged top edge, taller in a gale.
  float splashTop = uSplash.x + uSplash.y * ( 0.5 + 0.5 * isN( iwp.xz * 0.33 + iwp.y * 0.15 ) );
  float wet = 1.0 - smoothstep( splashTop - 0.5, splashTop + 0.7, hW );
  alb *= 1.0 - 0.58 * wet;
  // Black weed at and just under the waterline.
  float weed = ( 1.0 - smoothstep( -0.3, 0.9, hW ) ) * smoothstep( -7.0, -1.2, hW );
  alb = mix( alb, uWeedC, weed * 0.75 );
  // The sea breaking at the foot: a white wash that surges up the rock with the swell.
  float surge = 0.5 + 0.5 * sin( uIsT * 1.25 + dot( iwp.xz, vec2( 0.21, 0.17 ) ) + n1 * 2.2 );
  float fTop = uSplash.z * ( 0.45 + 0.80 * surge );
  float band = ( 1.0 - smoothstep( fTop * 0.55, fTop, hW ) ) * smoothstep( -0.9, -0.2, hW );
  float lace = isN( iwp.xz * 0.9 + iwp.y * 0.6 + vec2( uIsT * 0.45, -uIsT * 0.32 ) ) * 0.5 + 0.5;
  float foam = clamp( band * smoothstep( 0.05, 0.45, lace * 0.6 + surge * 0.5 ), 0.0, 0.88 );
  alb = mix( alb, vec3( 0.60, 0.64, 0.64 ), foam );
  diffuseColor.rgb = alb;
  float iRough = mix( 0.93, 0.36, wet * ( 1.0 - foam ) );
  // Cloud shadow on the direct light: the deck's top-down transmittance, looked up where
  // this fragment's sun ray leaves the cloud layer's footprint.
  float iCloud = 1.0;
  if ( uCloudW.w > 0.5 ) {
    vec2 cxz = iwp.xz;
    iCloud = texture2D( uCloudT, clamp( ( cxz - uCloudW.xy ) / uCloudW.z + 0.5, 0.002, 0.998 ) ).r;
  }`)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = iRough;')
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  reflectedLight.directDiffuse *= iCloud;
  reflectedLight.directSpecular *= iCloud;`);
  // STORM HAZE. The fog chunk's airlight is the painted ring's horizon, which water.js
  // documents as reading brighter than the sky it meets in a gale — and under the
  // volumetric lid the sky behind a crown is darker still. A black stack at 400 u then
  // converged on that brighter value and stood out as a pale glowing spire (measured: a
  // black-albedo needle at ~100 codes against a 60-66 cloud base and a 65-70 sea at its
  // foot). Only this material scales its airlight down with the storm; the global chunk,
  // and everything else it fogs, is untouched. Falls back to the plain chunk if the line
  // it keys on ever changes.
  const FOG = THREE.ShaderChunk.fog_fragment, KEY = 'vec3 A   = airLight( fogColor );';
  if (FOG.includes(KEY)) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>',
      FOG.replace(KEY, 'vec3 A   = airLight( fogColor ) * uIsAir;'));
  }
};

let mesh = null, geo = null;
let liveCols = 0;

export function buildIslands() {
  if (mesh) return;
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_COLS * VPC * 3), 3));
  // Flat shaded: the facet normal comes from screen derivatives. The attribute is a
  // constant up vector so nothing downstream ever normalises a zero.
  const nrm = new Float32Array(MAX_COLS * VPC * 3);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aIsle', new THREE.BufferAttribute(new Float32Array(MAX_COLS * VPC), 1));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(MAX_COLS * IPC), 1));
  mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'farIslands';
  mesh.frustumCulled = true;
  mesh.castShadow = false; mesh.receiveShadow = false;
  scene.add(mesh);
  if (typeof window !== 'undefined') window.__islandMesh = mesh;
}

// ---- generation --------------------------------------------------------------------
const h01p = (y, top) => (y <= 0 ? 0 : y >= top ? 1 : y / top);

// Column writer. All buffers are module-owned; this only runs at fill (boot / voyage).
const _ang = new Float32Array(MAX_SIDES), _rad = new Float32Array(MAX_SIDES);
const _rowY = new Float32Array(ROWS), _rowR = new Float32Array(ROWS), _prevY = new Float32Array(MAX_SIDES);
let _v = 0, _i = 0;

function column(isle, c, rnd) {
  if (liveCols >= MAX_COLS) return;
  const P = geo.attributes.position.array, A = geo.attributes.aIsle.array, I = geo.index.array;
  const n = c.n, base = _v;
  const rot = rnd() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    _ang[k] = rot + (k + (rnd() - 0.5) * 0.45) * Math.PI * 2 / n;
    _rad[k] = 0.80 + rnd() * 0.36;
  }
  // Rows: the foot (sunk into the shoal, filled per corner below), three under water,
  // then the rest spread to the top with jitter — joints, so the stack reads as blocks.
  const top = c.top, above = ROWS - 5;
  _rowY[0] = -40; _rowY[1] = -9; _rowY[2] = -4; _rowY[3] = -1.6; _rowY[4] = -0.2;
  for (let j = 0; j < above; j++) {
    const t = (j + 1) / above;
    const y = top <= 0.5 ? -0.2 + (top + 0.2) * t : 0.25 + (top - 0.25) * Math.pow(t, 0.92);
    _rowY[5 + j] = j === above - 1 ? top : y + (rnd() - 0.5) * Math.min(0.9, (top / above) * 0.5);
  }
  for (let j = 0; j < ROWS; j++) {
    const y = _rowY[j];
    const h01 = top > 0 ? Math.max(0, Math.min(1, y / top)) : 0;
    let r = c.r * (1 - c.taper * Math.pow(h01, 1.6));
    if (y < 0) r *= 1 + c.foot * Math.min(1, -y / 9);              // the talus foot flares
    if (j >= 5 && j < ROWS - 1) r *= 0.86 + rnd() * 0.20;          // jointed blocks
    if (j >= ROWS - 2 && top > 3) r *= 0.84;                       // the crumbled crown of it
    _rowR[j] = r;
  }
  for (let j = 0; j < ROWS; j++) {
    const y = _rowY[j], r = _rowR[j];
    const ly = Math.max(0, y);
    const ox = c.x + c.lx * ly, oz = c.z + c.lz * ly;
    for (let k = 0; k < n; k++) {
      const jr = j >= 4 && j < ROWS - 1 ? 1 + (rnd() - 0.5) * c.rough : 1;   // weathered, not machined
      const px = ox + Math.cos(_ang[k]) * r * _rad[k] * jr, pz = oz + Math.sin(_ang[k]) * r * _rad[k] * jr;
      let py = y;
      if (j === 0) py = Math.min(-12, terrainH(px, pz, 0) - FOOT_SINK);
      else {
        // Snapped, tilted top: the break plane leans into the upper blocks, weighted up
        // the stack, and every corner stays above the row below it (no folded facets).
        if (j >= 5 && top > 0) { const w = h01p(y, top); py = y + ((px - ox) * c.tx + (pz - oz) * c.tz) * w * w * w; }
        if (py < _prevY[k] + 0.15) py = _prevY[k] + 0.15;
      }
      _prevY[k] = py;
      const o = (_v + k) * 3;
      P[o] = px; P[o + 1] = py; P[o + 2] = pz; A[_v + k] = isle;
    }
    _v += n;
  }
  // cap centre
  const tx = c.x + c.lx * Math.max(0, top), tz = c.z + c.lz * Math.max(0, top);
  let capY = 0; for (let k = 0; k < n; k++) capY += _prevY[k];
  P[_v * 3] = tx; P[_v * 3 + 2] = tz;
  P[_v * 3 + 1] = capY / n + (c.spire ? c.r * (0.5 + rnd() * 0.6) : (rnd() - 0.35) * Math.min(1.2, 0.2 + c.r * 0.2));
  A[_v] = isle;
  const cap = _v; _v++;
  for (let j = 0; j < ROWS - 1; j++) {
    const a0 = base + j * n, b0 = base + (j + 1) * n;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      // outward faces, counter-clockwise seen from outside (angles increase with k)
      I[_i++] = a0 + k; I[_i++] = b0 + k; I[_i++] = a0 + k1;
      I[_i++] = a0 + k1; I[_i++] = b0 + k; I[_i++] = b0 + k1;
    }
  }
  const t0 = base + (ROWS - 1) * n;
  for (let k = 0; k < n; k++) { I[_i++] = t0 + k; I[_i++] = cap; I[_i++] = t0 + (k + 1) % n; }
  liveCols++;
}

// One stack. o (optional): { n, taper, lean, ldx, ldz (unit lean bearing, else random),
// tilt (break-plane slope, else rolled), rough, foot, spire }. Fill-time only.
const _c = { x: 0, z: 0, r: 0, n: 6, top: 0, taper: 0, lx: 0, lz: 0, tx: 0, tz: 0, rough: 0.12, foot: 0.3, spire: false };
const NO = {};
function stack(isle, rnd, x, z, r, top, o = NO) {
  _c.x = x; _c.z = z; _c.r = r; _c.top = top;
  _c.n = o.n || 5 + Math.floor(rnd() * 3);
  _c.taper = o.taper != null ? o.taper : 0.15 + rnd() * 0.30;
  _c.rough = o.rough != null ? o.rough : 0.10 + rnd() * 0.10;
  _c.foot = o.foot != null ? o.foot : 0.30;
  _c.spire = !!o.spire;
  let la = rnd() * Math.PI * 2;
  if (o.ldx != null) la = Math.atan2(o.ldz, o.ldx) + (rnd() - 0.5) * 0.7;
  const lean = o.lean != null ? o.lean : 0.015 + rnd() * 0.05;
  _c.lx = Math.cos(la) * lean; _c.lz = Math.sin(la) * lean;
  const ta = rnd() * Math.PI * 2;
  const tilt = o.tilt != null ? o.tilt : (rnd() < 0.4 ? 0.35 + rnd() * 0.5 : 0.08 + rnd() * 0.2);
  _c.tx = Math.cos(ta) * tilt; _c.tz = Math.sin(ta) * tilt;
  column(isle, _c, rnd);
}

function rubble(isle, rnd, s, count, rMin, rMax) {
  for (let q = 0; q < count; q++) {
    const a = rnd() * Math.PI * 2, d = rMin + rnd() * (rMax - rMin);
    stack(isle, rnd, s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, 1.6 + rnd() * 2.4, 0.1 + rnd() * 2.0, { tilt: 0.2 + rnd() * 0.3 });
  }
}

// A low awash platform the stacks rise out of, so a crown reads as one broken mass of
// rock and not a scatter of posts.
function plinth(isle, rnd, x, z, r) {
  stack(isle, rnd, x, z, r, 0.05 + rnd() * 0.55, { n: 7, taper: 0.05, rough: 0.22, foot: 0.45, tilt: 0.03 + rnd() * 0.05, lean: 0 });
}

function buildIsle(ii, s) {
  const rnd = stream(s.seed);
  const ux = s.x / s.r, uz = s.z / s.r;            // outward from the raft
  if (s.kind === 'crown') {
    // A broken crown: a splayed ring of stacks with one wide gap, one standing tall, on
    // a drowned platform.
    plinth(ii, rnd, s.x, s.z, s.rc * 0.78);
    const m = 8 + Math.floor(rnd() * 3), a0 = rnd() * Math.PI * 2, span = (285 + rnd() * 30) * Math.PI / 180;
    const tall = Math.floor(rnd() * m), T = 17 + rnd() * 6;
    for (let q = 0; q < m; q++) {
      const a = a0 + span * q / (m - 1) + (rnd() - 0.5) * 0.14, d = s.rc * (0.80 + rnd() * 0.32);
      const ca = Math.cos(a), sa = Math.sin(a);
      let top = q === tall ? T : T * (0.20 + rnd() * 0.62);
      if (q !== tall && rnd() < 0.25) top = 0.8 + rnd() * 2.6;     // snapped to a stump
      stack(ii, rnd, s.x + ca * d, s.z + sa * d, 2.9 + rnd() * 2.3, top,
        { ldx: ca, ldz: sa, lean: 0.03 + rnd() * 0.08, spire: q === tall || rnd() < 0.3 });
    }
    rubble(ii, rnd, s, 4, s.rc * 0.3, s.rc * 1.5);
  } else if (s.kind === 'needle') {
    // One tall stack leaning off a ledge, a few stumps round its foot.
    plinth(ii, rnd, s.x + (rnd() - 0.5) * 4, s.z + (rnd() - 0.5) * 4, 9 + rnd() * 3);
    stack(ii, rnd, s.x, s.z, 5.6 + rnd() * 1.2, 25 + rnd() * 6,
      { taper: 0.40 + rnd() * 0.15, lean: 0.03 + rnd() * 0.03, spire: true, tilt: 0.25 + rnd() * 0.2 });
    const m = 2 + Math.floor(rnd() * 2);
    for (let q = 0; q < m; q++) {
      const a = rnd() * Math.PI * 2, d = 7 + rnd() * 7;
      stack(ii, rnd, s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, 2.8 + rnd() * 1.8, 4 + rnd() * 8);
    }
    rubble(ii, rnd, s, 5, 4, s.rc * 1.7);
  } else {
    // Teeth: a low ragged line athwart the raft's line of sight — the stumps of a wall
    // the sea took.
    const a = Math.atan2(uz, ux) + Math.PI / 2 + (rnd() - 0.5) * 0.8, ca = Math.cos(a), sa = Math.sin(a);
    const m = 5 + Math.floor(rnd() * 3), hi = 1 + Math.floor(rnd() * (m - 2));
    plinth(ii, rnd, s.x + ca * s.rc * 0.45, s.z + sa * s.rc * 0.45, s.rc * 0.55);
    plinth(ii, rnd, s.x - ca * s.rc * 0.45, s.z - sa * s.rc * 0.45, s.rc * 0.5);
    for (let q = 0; q < m; q++) {
      const u = (q / (m - 1) - 0.5) * s.rc * 2.2, w = (rnd() - 0.5) * 5 + Math.sin(q * 1.3) * 2.5;
      const top = q === hi ? 12 + rnd() * 4 : 2.5 + rnd() * 8.5;
      stack(ii, rnd, s.x + ca * u - sa * w, s.z + sa * u + ca * w, 2.6 + rnd() * 2.0, top,
        { tilt: 0.3 + rnd() * 0.5, spire: rnd() < 0.35 });
    }
    rubble(ii, rnd, s, 4, 3, s.rc * 1.4);
  }
}

// Called by terrain.js fillTerrain, after syncSite has laid this site's ISLES.
export function fillIslands() {
  if (!mesh) return;
  _v = 0; _i = 0; liveCols = 0;
  for (let i = 0; i < ISLES.length && i < MAX_ISLES; i++) {
    buildIsle(i, ISLES[i]);
    const c = uIsle.uSeaC.value[i];
    c.set(ISLES[i].x, ISLES[i].z, 0, 0);
    uIsle.uSeaG.value[i].set(0, 0, 0, 0);
  }
  geo.index.needsUpdate = true;
  geo.attributes.position.needsUpdate = true;
  geo.attributes.aIsle.needsUpdate = true;
  geo.setDrawRange(0, _i);
  // Conservative bound: every crown sits inside r <= 470 and below y = +40.
  if (!geo.boundingSphere) geo.boundingSphere = new THREE.Sphere();
  geo.boundingSphere.center.set(0, 0, 0); geo.boundingSphere.radius = 480;
}

// Per frame from terrain.js updateTerrain, after the zone gate.
const SEA_TAP = 9;
export function updateIslands(camY, t) {
  if (!mesh) return;
  const vis = terrainMeshes[0].visible && liveCols > 0;
  mesh.visible = vis;
  if (!vis) return;
  uIsle.uIsT.value = t;
  const storm = stormLevel();
  uIsle.uIsAir.value = 1 - 0.42 * storm;
  uIsle.uSplash.value.set(1.6 + 2.6 * storm, 1.1 + 1.6 * storm, 1.3 + 2.8 * storm);
  uIsle.uSunW.value.set(SUN.dir.x, SUN.dir.y, SUN.dir.z);
  // The waterline: only worth the taps while the surf can be seen (eye near the surface).
  if (camY > -45) {
    for (let i = 0; i < ISLES.length && i < MAX_ISLES; i++) {
      const s = ISLES[i];
      const h0 = surfaceHeightAt(s.x, s.z, t, storm);
      const hx = surfaceHeightAt(s.x + SEA_TAP, s.z, t, storm);
      const hz = surfaceHeightAt(s.x, s.z + SEA_TAP, t, storm);
      uIsle.uSeaC.value[i].z = h0;
      uIsle.uSeaG.value[i].set((hx - h0) / SEA_TAP, (hz - h0) / SEA_TAP, 0, 0);
    }
  }
  const cs = getCloudShadow();
  if (cs && cs.texture) { uIsle.uCloudT.value = cs.texture; uIsle.uCloudW.value.set(cs.window[0], cs.window[1], cs.window[2], 1); }
  else uIsle.uCloudW.value.w = 0;
}

// Dev surface (lab): window.__isles.state() — layout, column count, triangle count.
if (typeof window !== 'undefined') {
  window.__isles = {
    state() {
      return {
        isles: ISLES.map(s => ({ kind: s.kind, x: +s.x.toFixed(1), z: +s.z.toFixed(1), r: +s.r.toFixed(1),
          bearingDeg: +((Math.atan2(s.z, s.x) * 180 / Math.PI + 360) % 360).toFixed(1),
          shoal: +terrainH(s.x, s.z, 0).toFixed(2) })),
        cols: liveCols, tris: _i / 3, visible: !!(mesh && mesh.visible), uniforms: uIsle
      };
    }
  };
}
