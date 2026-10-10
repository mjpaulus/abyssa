// Zone-exit rifts: THE DEEP'S OWN LIGHT over each open fissure, and the light motes that refuel
// the lantern.
// OWNED BY: water/atmosphere agent (rift VFX) — motes logic is shared, coordinate before changing.
//
// THE DEEP'S OWN LIGHT (spec 2026-10-10 §1 "Open"): cold pale blue-white breathing up out of the
// fissure, like a portal, never neon. It reads ONLY the fissure's open level k (world/fissure.js
// fissureOpenK; game.js passes the three zones' k in): nothing while the jam holds (the jam's seep
// is the shut light), welling up over the swell as the jam pours (k from 0.545, the moment the
// seep's last breath has gone, to 1: one light hands to the other, never both), full when open.
// No source is drawn and no THREE light is added (the count is 14).
//   - THE SHAFTS: 3-5 thin shells stood ALONG the crack's kinked centreline (fissureWorld), drawn
//     out along it, rooted on the throat floor, bright down in the crack, dissolving some tens of
//     units over the lip. Their stations keep clear of the overhang slabs, wide shells never reach
//     one (no blade of light under or through a roof).
//   - THE WALLS: light on the two wall faces, laid on the fissure patch's OWN triangles (terrain.js
//     fissurePatchGeo: the same vertices and transform, pulled toward the lens: the seep's
//     depth-stable rule), so it follows every stratum and broken block of both lips. The old
//     crater-floor caustic carried onto the faces (rings rising up the wall, streaks along the
//     crack) over a pale wash that deepens into the throat: the deep is where the light is.
//   - THE DRIFT: a column of motes rising out of the crack along its middle.
//   - THE HALO: a flat glow lying just over the lips, the light spilling out into the water (from
//     above it softens the gash's edge; edge-on it is nothing).
//   - THE SURFACE GLOW (zone 0, the one fissure under open sea): a faint, low, wide warmGlow sprite
//     stood on the sea over the crack, seen from the air only (the sea hides its lower half: from the
//     deck a pale mound of light on the swell marks the place); alpha <= 0.08, faded out by 320 u.
// All additive, fog OFF, each with its own fade to black with range (never fogged additive: fog
// turns an additive glow into a disc of water colour). Breath 0.75 + 0.25 sin(2 pi t / 7.5).
// Built at boot (buildRifts, before the loader's warm frames: forceAllDrawn draws them OPEN-shaped,
// so the first opening builds nothing); reseatRifts re-seats them on a voyage (no geometry growth).
// Per frame: uniforms, one sea-height tap while the surface glow is up; zero allocation.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { WORLD_R, zoneTop, zoneBottom } from '../config.js';
import { rng, clamp } from '../lib/math.js';
import { makeGlow, makeWarmGlow } from '../lib/textures.js';
import { terrainH, terrainUnderH, terrainMeshes, fissurePatchGeo } from './terrain.js';
import { FISSURE, SLABS, fissureWorld, fissureDist, lipMeanY, _widths } from './fissureShape.js';
import { surfaceHeightAt, localSurfaceY, stormLevel } from './water.js';

export const rifts = [];

// Rift light reads as a beacon, so it survives murk better than the general fog.
const BEACON_EXT = 0.010;
const TAU = Math.PI * 2;
// pale blue-white (the brief's 0.62, 0.78, 1.0) as it lands on screen: zone 1's water grade warms
// and zone 2's leans violet, so each zone's source is leaned against its grade (as the seep's is)
const COLS = [[0.62, 0.78, 1.0], [0.56, 0.80, 1.0], [0.50, 0.86, 1.0]];
const BREATH = 7.5;                      // s
const K0 = 0.545;                        // k at which the seep's last breath is gone (fissure.js: T = COLLAPSE)
// per zone gain (dev: __rifts.K), and the parts' shares (dev: __rifts.tune)
const LIGHT_K = [1.7, 1, 0.8];
const TUNE = { shaft: 0.09, wall: 0.85, drift: 0.85, halo: 0.16, surf: 0.08 };
const SURF_MAX = 0.08;                   // the surface glow's alpha never passes this
const N_DRIFT = 320;
const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

const NOISE = `
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),g=fract(p);g=g*g*(3.0-2.0*g);
return mix(mix(h21(i),h21(i+vec2(1,0)),g.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),g.x),g.y);}
float fbm3(vec2 p){float v=0.0,a=0.5;for(int i=0;i<3;i++){v+=a*vn(p);p*=2.11;a*=0.5;}return v;}`;
const EXT = BEACON_EXT.toFixed(4);

// ---- THE SHAFTS ----------------------------------------------------------------------------
// Shells shaded so alpha tracks |N.V|, the chord length through the enclosed volume: a lit
// column of water, not a cardboard tube. uLipV: the fraction of the shell's height at the lip;
// below it the shell is the throat's light, above it the light dissolves into the water.
const SHAFT_VS = `
  varying vec3 vN, vW; varying vec2 vUv;
  void main(){
    vN = normalMatrix * normal;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    vW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }`;
const SHAFT_FS = `
  uniform vec3 uColor; uniform float uTime, uK, uPh, uLipV;
  varying vec3 vN, vW; varying vec2 vUv;
  ${NOISE}
  void main(){
    vec3 N = normalize( vN );
    vec3 Vv = normalize( -( viewMatrix * vec4( vW, 1.0 ) ).xyz );
    // soft at the shell's silhouette, fullest through its middle: a lit column of water
    float chord = pow( abs( dot( N, Vv ) ), 2.2 );
    // streaks rising slowly up the column: noise sampled on a circle (the wrap has no seam),
    // stretched along the height
    float a = vUv.x * 6.28318;
    vec2 cir = vec2( cos( a ), sin( a ) ) * 3.4;
    float n = fbm3( cir + vec2( vUv.y * 1.2 - uTime * 0.05 + uPh, vUv.y * 0.6 + uTime * 0.02 ) );
    n = n * n * 1.8;
    // soft at its root on the throat floor, full in the crack, dissolving over the lip
    float up = 1.0 - smoothstep( uLipV - 0.06, 1.0, vUv.y );
    float vert = smoothstep( 0.0, 0.10, vUv.y ) * up * up;
    float dist = distance( vW, cameraPosition );
    float al = chord * vert * ( 0.25 + n ) * uK * exp( -dist * ${EXT} );
    if ( al <= 0.002 ) discard;
    gl_FragColor = vec4( uColor, al );
  }`;
function shaftMat(zi) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...COLS[zi]) }, uTime: { value: 0 }, uK: { value: 0 }, uPh: { value: 0 }, uLipV: { value: 0.7 } },
    vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    // DoubleSide is load-bearing (the chord shading reads both walls of the shell);
    // forceSinglePass keeps it one draw
    side: THREE.DoubleSide, forceSinglePass: true, fog: false
  });
  m.customProgramCacheKey = () => 'riftShaft';
  return m;
}
// The stations: along the middle 62% of the crack, clear of every overhang slab by >= 2.2 u
// (clearance = how far along the crack to the nearest slab's end), the widest clearances first,
// >= 5 u apart, at most five. A shell's reach along the crack is held under its clearance.
function stations(zi) {
  const F = FISSURE[zi], L = SLABS[zi], lim = 0.62 * F.halfLen, cand = [];
  for (let u = -lim; u <= lim + 1e-6; u += 0.5) {
    let c = 1e9;
    for (const sl of L) c = Math.min(c, Math.abs(u - sl.u0) - sl.hu);
    if (c >= 2.2) cand.push({ u, c });
  }
  cand.sort((a, b) => b.c - a.c || Math.abs(a.u) - Math.abs(b.u));
  const out = [];
  for (const q of cand) { if (out.length >= 5) break; if (out.every(o => Math.abs(o.u - q.u) >= 5)) out.push(q); }
  return out.sort((a, b) => a.u - b.u);
}

// ---- THE WALLS -----------------------------------------------------------------------------
// Clip position computed exactly as the terrain's standard material does (projection * (modelView
// * p)), polygon offset toward the lens, no depth writes: it never loses the depth test to the wall
// it lies on (the seep's camouflage lesson, fix round 2).
const WALL_VS = `
  varying vec3 vW, vN;
  void main(){ vW = ( modelMatrix * vec4( position, 1.0 ) ).xyz; vN = normal;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mvPosition; }`;
const WALL_FS = `
  uniform vec3 uColor; uniform float uTime, uK, uLip, uHalf; uniform vec4 uAx; uniform vec2 uM;
  varying vec3 vW, vN;
  ${NOISE}
  float tri( float t ){ return 4.0 * abs( t - floor( t + 0.5 ) ) - 1.0; }
  void main(){
    float depth = uLip - vW.y;
    vec2 r = vW.xz - uAx.xy, nrm = vec2( -uAx.w, uAx.z );
    float u = dot( r, uAx.zw );
    // across the crack from its KINKED centreline (fissureShape.js midAt, the same triangle waves)
    float mid = 2.2 * ( tri( u / 24.0 + uM.x ) - tri( uM.x ) ) + 0.8 * ( tri( u / 9.0 + uM.y ) - tri( uM.y ) );
    float v = dot( r, nrm ) - mid;
    vec3 N = normalize( vN );
    // the light comes up out of the throat, from its axis below: Lambert toward it, so the faces
    // turned to the crack and the undersides of the strata catch it and a ledge's top does not
    vec2 toAx = -sign( v ) * nrm;
    float lam = max( dot( N, normalize( vec3( toAx.x * 0.8, -0.6, toAx.y * 0.8 ) ) ), 0.0 );
    // the crater floor's caustic carried onto the faces: rings rising up the wall, streaks along the crack
    float ripple = sin( depth * 0.55 + uTime * 1.6 );
    float spokes = 0.5 + 0.5 * sin( u * 0.85 + uTime * 0.75 + ripple * 2.2 );
    float n = fbm3( vec2( u * 0.16, vW.y * 0.16 ) + vec2( uTime * 0.09, -uTime * 0.06 ) );
    float caus = ( pow( spokes, 3.0 ) * 0.9 + 0.25 ) * ( 0.35 + 1.1 * n );
    // nothing on the lip, the caustic down the faces, a wash deepening into the throat, and the
    // throat's floor is the light itself
    float band = smoothstep( 0.5, 8.0, depth );
    float wash = smoothstep( 14.0, 60.0, depth );
    float deep = smoothstep( 45.0, 78.0, depth );
    // the throat's light: it thins toward the pinched tips
    float tip = 1.0 - smoothstep( uHalf * 0.55, uHalf * 0.95, abs( u ) );
    float d = distance( vW, cameraPosition );
    // up close it is light ON the rock, not paint over it: it thins as you come to it
    float near = 0.3 + 0.7 * smoothstep( 2.0, 18.0, d );
    float a = uK * tip * near * ( lam * ( band * ( 0.08 + 0.3 * caus ) + wash * 0.45 ) + deep * 0.55 ) * exp( -d * ${EXT} );
    if ( a <= 0.002 ) discard;
    gl_FragColor = vec4( uColor, a );
  }`;
function wallMesh(zi) {
  const P = fissurePatchGeo(zi), F = FISSURE[zi];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', P.pos); g.setAttribute('normal', P.nor);
  // the patch's triangles inside the lip outline (its slab triangles, >= nv, are not wall)
  const keep = [], A = P.pos.array;
  for (const I of P.index) for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (a >= P.nv || b >= P.nv || c >= P.nv) continue;
    const x = (A[a * 3] + A[b * 3] + A[c * 3]) / 3, z = (A[a * 3 + 2] + A[b * 3 + 2] + A[c * 3 + 2]) / 3;
    if (fissureDist(x, z, zi) < 0.25) keep.push(a, b, c);
  }
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(F.cx, 0, F.cz), Math.hypot(F.halfLen + 4, 48));
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...COLS[zi]) }, uTime: { value: 0 }, uK: { value: 0 }, uLip: { value: 0 },
      uHalf: { value: F.halfLen }, uAx: { value: new THREE.Vector4(F.cx, F.cz, F.dx, F.dz) }, uM: { value: new THREE.Vector2(F.ph.m[0], F.ph.m[1]) } },
    vertexShader: WALL_VS, fragmentShader: WALL_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true, fog: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4
  });
  m.customProgramCacheKey = () => 'riftWall';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'riftWall' + zi;
  mesh.visible = false;
  return mesh;
}

// ---- THE DRIFT -----------------------------------------------------------------------------
// aP: (x, z) in the group's frame on the crack, phase, climb rate (fraction of the column / s)
const DRIFT_VS = `
  uniform float uTime, uK, uPix, uBot, uTop; attribute vec4 aP;
  varying float vA;
  void main(){
    float k = fract( aP.z + uTime * aP.w );
    vec3 p = vec3( aP.x + sin( uTime * 0.31 + aP.z * 17.0 ) * 0.5, mix( uBot, uTop, k ),
                   aP.y + cos( uTime * 0.27 + aP.z * 23.0 ) * 0.5 );
    vec4 mv = modelViewMatrix * vec4( p, 1.0 );
    float dist = -mv.z;
    gl_PointSize = clamp( ( 0.05 + 0.08 * fract( aP.z * 7.3 ) ) * uPix / max( dist, 0.5 ), 1.0, 10.0 );
    // born down in the throat, gone a little over the lip
    vA = uK * smoothstep( 0.0, 0.12, k ) * ( 1.0 - smoothstep( 0.55, 1.0, k ) ) * exp( -dist * ${EXT} );
    gl_Position = projectionMatrix * mv;
  }`;
const DRIFT_FS = `
  uniform vec3 uColor; varying float vA;
  void main(){
    vec2 q = gl_PointCoord - 0.5;
    float a = exp( -dot( q, q ) * 11.0 ) * vA;
    if ( a <= 0.004 ) discard;
    gl_FragColor = vec4( uColor, a );
  }`;
function drift(zi, rand) {
  const F = FISSURE[zi], g = new THREE.BufferGeometry(), _w = { x: 0, z: 0 };
  const pos = new Float32Array(N_DRIFT * 3), par = new Float32Array(N_DRIFT * 4);
  for (let i = 0; i < N_DRIFT; i++) {
    const u = (rand() + rand() - 1) * 0.72 * F.halfLen, wd = _widths(F, u), w = Math.min(wd.w0, wd.w1);
    fissureWorld(u, (wd.w1 - wd.w0) * 0.5 + (rand() * 2 - 1) * 0.35 * w, zi, _w);
    par[i * 4] = _w.x - F.cx; par[i * 4 + 1] = _w.z - F.cz; par[i * 4 + 2] = rand(); par[i * 4 + 3] = 1 / (70 + 70 * rand());
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.BufferAttribute(par, 4));
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...COLS[zi]) }, uTime: { value: 0 }, uK: { value: 0 }, uPix: { value: 900 }, uBot: { value: -60 }, uTop: { value: 30 } },
    vertexShader: DRIFT_VS, fragmentShader: DRIFT_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  m.customProgramCacheKey = () => 'riftDrift';
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

// ---- THE HALO ------------------------------------------------------------------------------
const SURF_VS = `
  varying vec2 vQ; varying vec3 vW;
  void main(){ vQ = uv * 2.0 - 1.0; vW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
const SURF_FS = `
  uniform vec3 uColor; uniform float uK, uTime, uFar, uMax; varying vec2 vQ; varying vec3 vW;
  ${NOISE}
  void main(){
    float r2 = dot( vQ, vQ );
    float n = vn( vQ * 3.0 + vec2( uTime * 0.05, -uTime * 0.04 ) );
    float a = uK * exp( -r2 * 3.2 ) * ( 0.75 + 0.5 * n ) * ( 1.0 - smoothstep( 0.7, 1.0, r2 ) );
    // its own fade with range (fog off), and never past the cap
    a = min( a * clamp( 1.0 - distance( vW, cameraPosition ) / uFar, 0.0, 1.0 ), uMax );
    if ( a <= 0.001 ) discard;
    gl_FragColor = vec4( uColor, a );
  }`;
// THE HALO: a flat glow drawn out along the crack, lying just over its lips, where the light spills
// out of it into the water (seen from above it softens the gash's edge; edge-on it is nothing).
function glowPlane(zi, along, across, far, max, name) {
  const F = FISSURE[zi], g = new THREE.PlaneGeometry(2, 2, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...COLS[zi]) }, uK: { value: 0 }, uTime: { value: 0 }, uFar: { value: far }, uMax: { value: max } },
    vertexShader: SURF_VS, fragmentShader: SURF_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true, fog: false
  });
  m.customProgramCacheKey = () => 'riftHalo';
  const s = new THREE.Mesh(g, m);
  s.name = name + zi;
  // drawn out along the crack's bearing: local x -> (dx, dz)
  s.rotation.y = Math.atan2(-F.dz, F.dx);
  s.scale.set(along, 1, across);
  s.position.set(F.cx, 0.25, F.cz);
  s.visible = false;
  return s;
}

// ---- build / seat --------------------------------------------------------------------------
export function buildRifts() {
  const _s = new THREE.Vector2(), _a = { x: 0, z: 0 }, _b = { x: 0, z: 0 };
  let seed = 0x5a17;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let zi = 0; zi < 3; zi++) {
    const F = FISSURE[zi];
    const grp = new THREE.Group();
    grp.name = 'riftLight' + zi;
    grp.visible = false;
    const shells = [];
    for (const [i, st] of stations(zi).entries()) {
      const wd = _widths(F, st.u);
      // the thinnest the crack gets over the shell's reach along it: the shell keeps well inside
      let wmin = Math.min(wd.w0, wd.w1);
      for (let du = -3; du <= 3; du += 1) { const q = _widths(F, st.u + du); wmin = Math.min(wmin, q.w0, q.w1); }
      const rBot = 0.6, rLip = 0.38 * wmin, up = [30, 38, 26, 34, 28][i];
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 8, true), shaftMat(zi));
      sh.name = 'riftShaft' + zi + '_' + i;
      // local x along the crack's local tangent (the kinked centreline), drawn out along it
      fissureWorld(st.u - 0.5, 0, zi, _a); fissureWorld(st.u + 0.5, 0, zi, _b);
      sh.rotation.y = Math.atan2(-(_b.z - _a.z), _b.x - _a.x);
      fissureWorld(st.u, (wd.w1 - wd.w0) * 0.5, zi, _a);
      sh.userData = { u: st.u, c: st.c, x: _a.x, z: _a.z, rBot, rLip, up, rTop: 0, along: 1 };
      sh.material.uniforms.uPh.value = rand() * 10;
      shells.push(sh); grp.add(sh);
    }
    const dr = drift(zi, rand);
    grp.add(dr);
    scene.add(grp);
    const wall = wallMesh(zi);
    scene.add(wall);
    // the surface glow: a low, wide breath of pale light where the sea lies over the crack. A sprite
    // stood on the water: the sea (which writes depth above the waterline) hides its lower half, so
    // from the deck it is a faint mound of light on the swell, crests passing in front of it.
    // warmGlow's house program (fog off, its own linear fade to 320 u).
    let surf = null;
    if (zi === 0) {
      surf = makeWarmGlow(new THREE.Color(...COLS[0]), 1, { near: 40, far: 320, nearW: 0 });
      surf.name = 'riftSurf0';
      surf.scale.set(F.halfLen * 1.9, 22, 1);
      surf.position.set(F.cx, 0, F.cz);
      surf.material.opacity = 0; surf.visible = false;
      scene.add(surf);
    }
    const halo = glowPlane(zi, F.halfLen * 1.12, F.halfW * 1.9, 140, 0.3, 'riftHalo');
    halo.position.set(0, 1.5, 0);
    grp.add(halo);
    rifts.push({ grp, shells, wall, drift: dr, surf, halo, light: 0, ph: shells.map((_, i) => i * 0.55) });
    dr.onBeforeRender = (r, s, cam) => {
      r.getSize(_s);
      dr.material.uniforms.uPix.value = _s.y * r.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360));
    };
  }
  reseatRifts();
}

// The fissure never moves (riftPos and FISSURE are frozen), but a site swap regrows terrain under
// it: re-seat the light on the current lip and throat floor, in place (no geometry, no material).
// The group sits at the crack's centre on its mean lip height.
export function reseatRifts() {
  for (let zi = 0; zi < rifts.length; zi++) {
    const R = rifts[zi], F = FISSURE[zi], lip = lipMeanY(zi, terrainH);
    R.grp.position.set(F.cx, lip, F.cz);
    for (const sh of R.shells) {
      const d = sh.userData, floor = terrainUnderH(d.x, d.z, zi) - 1, top = lip + d.up, H = top - floor;
      // radius r(y) linear from rBot at the floor to rLip at the lip, on up to the top
      // (its top held inside its clearance along the crack: no shell reaches a slab at any height)
      const fl = (lip - floor) / H, reach = d.c - 0.6;
      d.rTop = Math.min(reach, d.rBot + (d.rLip - d.rBot) / Math.max(0.2, fl));
      d.along = Math.max(1, Math.min(2.2, reach / d.rTop));     // drawn out along the crack
      shellRadii(sh, d.rBot, d.rTop);                           // unit height; the scale stands it
      sh.position.set(d.x - F.cx, (floor + top) * 0.5 - lip, d.z - F.cz);
      sh.scale.set(d.along, H, 1);
      sh.material.uniforms.uLipV.value = fl;
    }
    const D = R.drift.material.uniforms, fc = terrainUnderH(F.cx, F.cz, zi);
    D.uBot.value = fc - lip + 2; D.uTop.value = 30;
    R.wall.material.uniforms.uLip.value = lip;
    R.wall.geometry.boundingSphere.center.y = lip - 30;
  }
}
// The unit cylinder's two radii, written in place in three's own CylinderGeometry layout (open,
// 24 x 8; uv untouched): a reseat rewrites positions and normals, never a new geometry.
function shellRadii(sh, rBot, rTop) {
  const g = sh.geometry, P = g.attributes.position, N = g.attributes.normal;
  const radial = 24, hs = 8, slope = rBot - rTop;
  let i = 0;
  for (let y = 0; y <= hs; y++) {
    const v = y / hs, r = v * (rBot - rTop) + rTop;
    for (let x = 0; x <= radial; x++) {
      const th = x / radial * TAU, s = Math.sin(th), c = Math.cos(th);
      P.setXYZ(i, r * s, -v + 0.5, r * c);
      const nl = Math.hypot(1, slope); N.setXYZ(i, s / nl, slope / nl, c / nl);
      i++;
    }
  }
  P.needsUpdate = true; N.needsUpdate = true;
  g.computeBoundingSphere();
}

export function updateRifts(dt, t, activeZone, openK) {
  const breath = 0.75 + 0.25 * Math.sin(t * TAU / BREATH);
  for (let zi = 0; zi < rifts.length; zi++) {
    const R = rifts[zi], o = c01((openK[zi] - K0) / (1 - K0)), L = o * o * (3 - 2 * o);
    R.light = L;
    const see = L > 0.003 && terrainMeshes[zi].visible;
    R.grp.visible = see; R.wall.visible = see;
    if (see) {
      const k = L * LIGHT_K[zi];
      for (let i = 0; i < R.shells.length; i++) {
        const U = R.shells[i].material.uniforms;
        // one breath, walking a little along the crack shell to shell
        U.uK.value = TUNE.shaft * k * (0.75 + 0.25 * Math.sin(t * TAU / BREATH - R.ph[i])); U.uTime.value = t;
      }
      const W = R.wall.material.uniforms; W.uK.value = TUNE.wall * k * breath; W.uTime.value = t;
      const D = R.drift.material.uniforms; D.uK.value = TUNE.drift * k * (0.85 + 0.15 * breath); D.uTime.value = t;
      const Hh = R.halo.material.uniforms; Hh.uK.value = TUNE.halo * k * breath; Hh.uTime.value = t;
    }
    if (R.surf) {
      // seen from the air only (under the water it would be a fog-free light through 240 u of sea)
      const air = c01((camera.position.y - localSurfaceY() + 0.3) / 0.9), s = L * air * LIGHT_K[zi];
      R.surf.visible = s > 0.003;
      if (R.surf.visible) {
        const F = FISSURE[zi];
        R.surf.position.y = surfaceHeightAt(F.cx, F.cz, t, stormLevel());
        R.surf.material.opacity = Math.min(SURF_MAX, TUNE.surf * s * breath);
      }
    }
  }
}

// dev surface (probes): the light each zone shows now, the parts' gains
const __rifts = {
  K: LIGHT_K, tune: TUNE,
  state(zi) { const R = rifts[zi]; return R ? { light: R.light, visible: R.grp.visible, shells: R.shells.length, wallTris: R.wall.geometry.index.count / 3,
    surf: R.surf ? R.surf.visible : null, stations: R.shells.map(s => ({ u: s.userData.u, clear: s.userData.c, rLip: +s.userData.rLip.toFixed(2), rTop: +s.userData.rTop.toFixed(2), along: +s.userData.along.toFixed(2), reachAlong: +(s.userData.rTop * s.userData.along).toFixed(2) })) } : null; },
  materials(zi) { const R = rifts[zi]; return R ? [...R.shells.map(s => s.material), R.wall.material, R.drift.material, R.halo.material].concat(R.surf ? [R.surf.material] : []) : []; }
};
if (typeof window !== 'undefined') window.__rifts = __rifts;

// ---- motes ----
const moteGeo = new THREE.IcosahedronGeometry(0.75, 1);
// Template only: each mote clones this so its core can fade with distance (below).
const moteMat = new THREE.MeshBasicMaterial({ color: 0xdffff0, fog: false, transparent: true });
export let motes = [];

export function seedMotes(zi) {
  for (const m of motes) {
    scene.remove(m.grp);
    m.coreMat.dispose();
    m.grp.children[1].material.dispose();
    m.grp.children[2].material.dispose();
  }
  motes = [];
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, r = rng(15, WORLD_R * 0.85);
    const grp = new THREE.Group();
    grp.position.set(Math.cos(a) * r, rng(zoneBottom(zi) + 18, zoneTop(zi) - 15), Math.sin(a) * r);
    const coreMat = moteMat.clone();
    grp.add(new THREE.Mesh(moteGeo, coreMat));
    grp.add(makeGlow(0x9fffcf, 10));
    const halo = makeGlow(0x4fffb0, 22);
    halo.material.opacity = 0.28;
    grp.add(halo);
    scene.add(grp);
    motes.push({ grp, coreMat, alive: true, respawn: 0, ph: Math.random() * 7, home: grp.position.clone() });
  }
}

// Returns the number collected this frame so the caller can award light and play audio.
export function updateMotes(dt, t, playerPos) {
  let collected = 0;
  for (const m of motes) {
    if (!m.alive) {
      m.respawn -= dt;
      if (m.respawn <= 0) { m.alive = true; m.grp.visible = true; m.grp.position.copy(m.home); }
      continue;
    }
    m.grp.rotation.y += dt * 0.9;
    m.grp.rotation.x += dt * 0.35;
    const d = m.grp.position.distanceTo(playerPos);
    // drift home, then swim toward the diver once he is close enough to notice
    m.grp.position.y = m.home.y + Math.sin(t * 1.5 + m.ph) * 0.9;
    if (d < 11) m.grp.position.lerp(playerPos, Math.min(1, dt * clamp((11 - d) / 8, 0, 1) * 2.2));
    const p = 8 + 3 * Math.sin(t * 2 + m.ph);
    m.grp.children[1].scale.setScalar(p);
    m.grp.children[2].scale.setScalar(18 + 7 * Math.sin(t * 1.3 + m.ph * 1.7));
    // Beacon extinction (same law as the rift shafts): additive glow with fog:false
    // must fade to black with range or it reads as neon across the basin. No allocation:
    // distanceTo on module-held vectors, scalar math only.
    const fade = Math.exp(-m.grp.position.distanceTo(camera.position) * BEACON_EXT);
    m.coreMat.opacity = fade;
    m.grp.children[1].material.opacity = 0.8 * fade;
    m.grp.children[2].material.opacity = 0.28 * fade;
    if (d < 3.4) {
      m.alive = false; m.respawn = 14; m.grp.visible = false;
      collected++;
    }
  }
  return collected;
}
