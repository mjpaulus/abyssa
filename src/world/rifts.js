// Zone-exit rifts: THE DEEP'S OWN LIGHT over each open fissure, and the light motes that refuel
// the lantern.
// OWNED BY: water/atmosphere agent (rift VFX) — motes logic is shared, coordinate before changing.
//
// THE DEEP'S OWN LIGHT (spec 2026-10-10 §1 "Open"): cold pale blue-white breathing up out of the
// fissure, like a portal, never neon, with no visible source. It reads ONLY the fissure's open
// level k (world/fissure.js fissureOpenK; game.js passes the three zones' k in): nothing while the
// jam holds (the jam's seep is the shut light), welling up over the swell as the jam pours (k from
// 0.545, the moment the seep's last breath has gone, to 1: one light hands to the other, never
// both), full when open. Open = calmed THIS VISIT (game.js visitCalm). No THREE light (count 14).
//   - THE CURTAIN: a continuous, uneven veil of light along the whole middle of the crack: a lattice
//     of soft camera-facing blobs (a station every 1.2 u along the kinked centreline, nine rising
//     blobs each) that rise slowly out of the throat floor, swelling as they climb and dissolving
//     over the lip. Soft every way: a gaussian disc that is zero before the quad's edge, its radius
//     held inside the MEASURED open half-width of the crack at its height (marched against the rock
//     and the overhang slabs' bodies at every reseat), so no quad plane ever reaches rock with any
//     light on it. Brighter in places: one slow noise along the crack (shared with the walls, so a
//     bright reach of the veil lights the rock beside it). Stacking is weighed off by view: end-on
//     along the crack and straight down, where the lattice piles up on itself.
//   - THE WALLS: light on the rock of the crack and its lips, laid on the fissure patch's OWN
//     triangles (terrain.js fissurePatchGeo: the same vertices and transform, pulled toward the lens:
//     the seep's depth-stable rule), FrontSide: the faces turned to the throat's axis catch the light
//     rising out of it (the old crater caustic carried onto them: rings rising, streaks along the
//     crack), and the lips, the slabs and the apron tops catch the glow spilling out over the crack.
//     No even floor wash: the throat's floor is not a lit tray, the light is in the water.
//   - THE DRIFT: a column of motes rising out of the crack along its middle, each from the floor
//     under it.
//   - THE HALO: a flat glow lying just over the lips, the light spilling out into the water.
//   - THE SURFACE GLOW (zone 0, the one fissure under open sea): a low, wide warmGlow sprite stood on
//     the sea over the crack, seen from the air only (the sea hides its lower half: from the deck a
//     pale mound of light on the swell marks the place); alpha <= 0.16, faded out by 320 u.
// FROM BELOW NOTHING: every part fades out as the camera goes below that zone's deepest throat floor
// (16 u), so the zone underneath (where the descent lands and the ending rises) never sees it.
// All additive, fog OFF, each with its own fade to black with range (never fogged additive: fog
// turns an additive glow into a disc of water colour). Breath 0.75 + 0.25 sin(2 pi t / 7.5).
// PER SITE: each anchorage's water and grade cast the light (Pallid's turned it cream); reseatRifts
// leans every part's colour per site and zone (SITE_LEAN, calibrated on frames) so it lands cold
// pale blue-white at every anchorage; fissure.js leans the seep with the same table.
// Built at boot (buildRifts, before the loader's warm frames: forceAllDrawn draws them, so the first
// opening builds nothing); reseatRifts re-seats them in place on a voyage (no geometry growth).
// Per frame: uniforms, one sea-height tap while the surface glow is up; zero allocation.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { WORLD_R, zoneTop, zoneBottom } from '../config.js';
import { rng, clamp } from '../lib/math.js';
import { makeGlow, makeWarmGlow } from '../lib/textures.js';
import { terrainH, terrainUnderH, terrainMeshes, fissurePatchGeo } from './terrain.js';
import { FISSURE, fissureWorld, fissureLocal, fissureDist, slabProbe, lipMeanY, _widths } from './fissureShape.js';
import { surfaceHeightAt, localSurfaceY, stormLevel } from './water.js';
import { currentSiteIndex } from './site.js';

export const rifts = [];

// Rift light reads as a beacon, so it survives murk better than the general fog.
const BEACON_EXT = 0.010;
const TAU = Math.PI * 2;
// pale blue-white (the brief's 0.62, 0.78, 1.0) as it lands on screen at home: zone 1's water grade
// warms and zone 2's leans violet, so each zone's source is leaned against its grade
const COLS = [[0.62, 0.78, 1.0], [0.56, 0.80, 1.0], [0.50, 0.86, 1.0]];
// per site (index = site.js row), per zone: a multiplier on COLS so the light lands the same cold
// pale blue-white in that anchorage's own water and grade (calibrated: open-minus-shut mean colour
// over the light's pixels against home's; fissure.js leans the seep with it)
// target: the ABSOLUTE colour of the BRIGHT lit pixels (open against gain 0: the upper quarter by
// luma of the pixels the light changes, where the eye reads its hue), R:G:B = 0.80 : 0.90 : 1.0,
// over four views per site and zone (40 u side, 60 u above, across the crack from its lip, inside the
// throat), iterated (review N2: the added light alone read blue while the lit highlights stayed cream
// in zone 1's warm grade and lavender in zone 2's); luma kept
export const SITE_LEAN = [
  [[1.060, 0.972, 1.024], [1.027, 0.999, 0.937], [1.108, 1.015, 0.601]],   // home
  [[0.993, 0.996, 1.057], [0.993, 0.986, 1.094], [1.258, 0.931, 0.657]],   // Pallid Bank
  [[0.915, 1.031, 1.078], [0.826, 1.037, 1.279], [0.944, 1.028, 0.974]],   // the Burned Ground
  [[1.586, 0.735, 0.833], [0.741, 1.034, 1.537], [0.976, 1.096, 0.540]],   // the Unsounded Shelf
];
export function siteLean(zi, out) {
  const L = (SITE_LEAN[currentSiteIndex()] || SITE_LEAN[0])[zi];
  out[0] = L[0]; out[1] = L[1]; out[2] = L[2]; return out;
}
const BREATH = 7.5;                      // s
const K0 = 0.545;                        // k at which the seep's last breath is gone (fissure.js: T = COLLAPSE)
// per zone gain (dev: __rifts.K), and the parts' shares (dev: __rifts.tune)
const LIGHT_K = [1.7, 1, 0.8];
const TUNE = { curtain: 0.16, endOn: 0.05, wall: 1.3, drift: 0.85, halo: 0.16, surf: 0.14, surfH: 22, inside: 0.75, noGate: false };
const SURF_MAX = 0.16;                   // the surface glow's alpha never passes this
const N_DRIFT = 320;
const ST_DU = 1.2, NB = 9, LEV = 12, LEV_UP = 6;  // curtain: station spacing (u), blobs per station, measured levels (floor .. lip + LEV_UP, closer near the top: f = 1 - (1 - l/11)^2)
const R_MAX = 5.0, HW_FILL = 0.85, STRETCH = 1.8;      // a blob's natural radius cap; the share of the measured open half-width it may fill
const UP_TOP = 26, FOOT = 3;                       // the curtain climbs this far over the lip
const GATE = 16;                         // the fade (u) as the camera goes below the deepest throat floor
const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

const NOISE = `
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),g=fract(p);g=g*g*(3.0-2.0*g);
return mix(mix(h21(i),h21(i+vec2(1,0)),g.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),g.x),g.y);}
float fbm3(vec2 p){float v=0.0,a=0.5;for(int i=0;i<3;i++){v+=a*vn(p);p*=2.11;a*=0.5;}return v;}`;
const EXT = BEACON_EXT.toFixed(4);
// the one slow noise along the crack: where the veil is bright the walls beside it are too
const PATCH = `float patchK(float u, float t, float seed){ float n = vn(vec2(u * 0.09 + t * 0.012 + seed, seed * 1.7)); return 0.3 + 1.3 * n * n; }`;

// ---- THE CURTAIN ---------------------------------------------------------------------------
// Per blob vertex: aS (station x, z in the group's frame, floor and lip heights relative to the
// group), aH0/aH1 (the measured open half-width at the LEV levels from the floor to lip + LEV_UP),
// aB (corner x, corner y, rise phase, seed), aU (the crack's tangent x, z there, u, rise rate).
const CURTAIN_VS = `
  uniform float uTime, uK, uEndOn, uSeed;
  attribute vec4 aS, aH0, aH1, aH2, aB, aU;
  varying vec2 vQ; varying float vA, vSeed;
  ${NOISE}
  ${PATCH}
  float lev(int i){ vec4 v = i < 4 ? aH0 : i < 8 ? aH1 : aH2; int j = i - (i / 4) * 4; return j == 0 ? v.x : j == 1 ? v.y : j == 2 ? v.z : v.w; }
  float hwAt(float y){
    float top = aS.w + ${LEV_UP.toFixed(1)};
    if (y >= top) return aH2.w + (y - top) * 0.5;
    float t = clamp((y - aS.z) / max(1.0, top - aS.z), 0.0, 1.0);
    float f = (1.0 - sqrt(1.0 - t)) * ${(LEV - 1).toFixed(1)};
    int i = int(min(floor(f), ${(LEV - 2).toFixed(1)}));
    return mix(lev(i), lev(i + 1), f - float(i));
  }
  void main(){
    vQ = aB.xy; vSeed = aB.w;
    // it rises out of the floor and dissolves over the lip, swelling as it climbs
    float k = fract(aB.z + uTime * aU.w);
    float y = mix(aS.z + ${FOOT.toFixed(1)}, aS.w + ${UP_TOP.toFixed(1)}, k);   // born a little up off the throat's lumpy floor
    float R = min(min(${R_MAX.toFixed(1)}, 0.9 + 0.06 * (y - aS.z)), ${HW_FILL.toFixed(2)} * hwAt(y));
    // drawn out up the vertical, its upper and lower flanks reach heights where the crack is narrower
    // (a slab's body, the V): held inside the open width there too (review N6)
    float Sy = ${STRETCH.toFixed(1)} * R;
    R = min(R, ${HW_FILL.toFixed(2)} * min(hwAt(y + 0.62 * Sy), hwAt(y - 0.62 * Sy)) / 0.76);
    R = min(R, ${HW_FILL.toFixed(2)} * min(hwAt(y + 0.94 * Sy), hwAt(y - 0.94 * Sy)) / 0.17);
    R = max(R, 0.05);
    vec4 wc = modelMatrix * vec4(aS.x, y, aS.y, 1.0);
    vec3 vd = cameraPosition - wc.xyz; float d = length(vd); vd /= max(d, 1e-3);
    // a tall veil, not a puff: drawn out up the world's vertical (seen from the side), turning to a
    // plain camera-facing disc as the view comes overhead (where a vertical card would be edge-on)
    float over = smoothstep(0.5, 0.95, abs(vd.y));
    vec3 rt = normalize(vec3(-vd.z, 0.0, vd.x) + vec3(1e-4, 0.0, 0.0));
    vec3 upv = normalize(mix(vec3(0.0, 1.0, 0.0), cross(rt, vd), over));
    float sy = mix(${STRETCH.toFixed(1)}, 1.0, over);
    float lift = max(0.0, aS.z + 0.95 * R * sy - y);   // never down into the throat floor
    wc.y += lift; y += lift;
    // in the crack it is the light; over the lip it thins away into the water
    float g = y < aS.w ? 1.0 : exp(-(y - aS.w) / 7.0);
    float life = smoothstep(0.0, 0.10, k) * (1.0 - smoothstep(0.72, 1.0, k));
    // where the lattice stacks on itself on screen: end-on along the crack, and from straight above
    float ct = abs(dot(vd.xz, aU.xy)), cy = abs(vd.y);
    float w = mix(1.0, uEndOn, smoothstep(0.4, 1.0, ct)) * mix(1.0, 0.3, smoothstep(0.45, 1.0, cy));
    float a = uK * g * life * w * patchK(aU.z, uTime, uSeed) * (0.6 + 0.6 * fract(aB.w * 7.13))
            * exp(-d * ${EXT}) * smoothstep(4.0, 20.0, d);   // inside the veil there is no veil: it thins away as you come into it
    vA = a;
    if (a < 0.0008) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // nothing to draw: off the screen
    gl_Position = projectionMatrix * viewMatrix * vec4(wc.xyz + rt * (aB.x * R) + upv * (aB.y * R * sy), 1.0);
  }`;
const CURTAIN_FS = `
  uniform vec3 uColor; uniform float uTime;
  varying vec2 vQ; varying float vA, vSeed;
  ${NOISE}
  void main(){
    float r2 = dot(vQ, vQ);
    // a soft disc, zero well before the quad's edge, a little uneven inside
    float a = vA * exp(-r2 * 2.6) * (1.0 - smoothstep(0.55, 1.0, r2)) * (0.7 + 0.6 * vn(vQ * 1.6 + vSeed * 31.0 + vec2(0.0, -uTime * 0.05)));
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }`;
function curtain(zi, rand) {
  const F = FISSURE[zi], lim = 0.82 * F.halfLen, us = [];
  for (let u = -lim; u <= lim + 1e-6; u += ST_DU) us.push(u + (rand() - 0.5) * 0.3);
  const ns = us.length, nb = ns * NB, nv = nb * 4;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  const aS = new THREE.BufferAttribute(new Float32Array(nv * 4), 4), aH0 = new THREE.BufferAttribute(new Float32Array(nv * 4), 4), aH1 = new THREE.BufferAttribute(new Float32Array(nv * 4), 4), aH2 = new THREE.BufferAttribute(new Float32Array(nv * 4), 4);
  const aB = new Float32Array(nv * 4), aU = new Float32Array(nv * 4), idx = new Uint32Array(nb * 6);
  const st = [], _a = { x: 0, z: 0 }, _b = { x: 0, z: 0 };
  for (let s = 0; s < ns; s++) {
    const u = us[s];
    fissureWorld(u - 0.5, 0, zi, _a); fissureWorld(u + 0.5, 0, zi, _b);
    const tl = Math.hypot(_b.x - _a.x, _b.z - _a.z), tx = (_b.x - _a.x) / tl, tz = (_b.z - _a.z) / tl;
    const wd = _widths(F, u); fissureWorld(u, (wd.w1 - wd.w0) * 0.5, zi, _a);
    st.push({ u, x: _a.x, z: _a.z, tx, tz, floor: 0, lip: 0, hw: new Float32Array(LEV) });
    for (let j = 0; j < NB; j++) {
      const b = s * NB + j, ph = (j + rand() * 0.8) / NB, seed = rand(), rate = 1 / (55 + 45 * rand());
      for (let c = 0; c < 4; c++) {
        const v = b * 4 + c, o = v * 4;
        aB[o] = c & 1 ? 1 : -1; aB[o + 1] = c & 2 ? 1 : -1; aB[o + 2] = ph; aB[o + 3] = seed;
        aU[o] = tx; aU[o + 1] = tz; aU[o + 2] = u; aU[o + 3] = rate;
      }
      idx.set([b * 4, b * 4 + 1, b * 4 + 3, b * 4, b * 4 + 3, b * 4 + 2], b * 6);
    }
  }
  g.setAttribute('aS', aS); g.setAttribute('aH0', aH0); g.setAttribute('aH1', aH1); g.setAttribute('aH2', aH2);
  g.setAttribute('aB', new THREE.BufferAttribute(aB, 4)); g.setAttribute('aU', new THREE.BufferAttribute(aU, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...COLS[zi]) }, uTime: { value: 0 }, uK: { value: 0 }, uEndOn: { value: TUNE.endOn }, uSeed: { value: zi * 3.7 } },
    vertexShader: CURTAIN_VS, fragmentShader: CURTAIN_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true, fog: false
  });
  m.customProgramCacheKey = () => 'riftCurtain';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'riftCurtain' + zi;
  mesh.frustumCulled = false;
  return { mesh, st, nb };
}
// SOLID at (x, z, y): under the carved rock, or inside an overhang slab's body (its top is terrainH,
// its underside ~th below), or under the ground over the lip
const _sp = { q: -1, th: 0 };
function solid(x, z, y, zi) {
  if (terrainUnderH(x, z, zi) > y) return true;
  const sp = slabProbe(x, z, zi);
  if (sp.q >= 0) { const top = terrainH(x, z, zi); if (y < top + 0.3 && y > top - sp.th - 0.6) return true; }
  return false;
}
// the open half-width at (station, height): the nearest rock along 16 horizontal directions from the
// station's centre, marched at 0.4 u then refined, capped at 12 u
function openHW(s, y, zi) {
  let best = 12;
  if (solid(s.x, s.z, y, zi)) return 0;
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * TAU, dx = Math.cos(a), dz = Math.sin(a);
    let lo = 0;
    for (let r = 0.4; r <= best; r += 0.4) {
      if (solid(s.x + dx * r, s.z + dz * r, y, zi)) {
        let a0 = lo, a1 = r;
        for (let i = 0; i < 4; i++) { const m = (a0 + a1) * 0.5; if (solid(s.x + dx * m, s.z + dz * m, y, zi)) a1 = m; else a0 = m; }
        best = Math.min(best, a0); break;
      }
      lo = r;
    }
  }
  return best;
}
// the measured levels: from the floor to lip + LEV_UP, closer together near the top (where the open
// width changes fastest: the lip, its heave, the slabs)
const _ow = new Float32Array(LEV);
const levY = (fl, lip, l) => { const q = 1 - l / (LEV - 1); return fl + (lip + LEV_UP - fl) * (1 - q * q); };
function seatCurtain(R, zi, lip) {
  const C = R.curtain, F = FISSURE[zi], g = C.mesh.geometry;
  const S = g.attributes.aS.array, HA = [g.attributes.aH0.array, g.attributes.aH1.array, g.attributes.aH2.array];
  let floorMin = 1e9;
  for (let s = 0; s < C.st.length; s++) {
    const t = C.st[s];
    // the throat's floor under this station: the lowest ground across the crack here
    let fl = terrainUnderH(t.x, t.z, zi);
    for (let q = -3; q <= 3; q++) fl = Math.min(fl, terrainUnderH(t.x - t.tz * q * 0.6, t.z + t.tx * q * 0.6, zi));
    t.floor = fl; t.lip = lip; floorMin = Math.min(floorMin, fl);
    // stored CONSERVATIVELY: each level holds the least of its own and its neighbours' open widths, so
    // the shader's interpolation between two levels never exceeds the open width anywhere between
    // them (the crack widens upward; a slab's body is a band, caught by the window)
    for (let l = 0; l < LEV; l++) _ow[l] = openHW(t, levY(fl, lip, l), zi);
    for (let l = 0; l < LEV; l++) t.hw[l] = Math.min(_ow[Math.max(0, l - 1)], _ow[l], _ow[Math.min(LEV - 1, l + 1)]);
    for (let j = 0; j < NB; j++) for (let c = 0; c < 4; c++) {
      const o = ((s * NB + j) * 4 + c) * 4;
      S[o] = t.x - F.cx; S[o + 1] = t.z - F.cz; S[o + 2] = fl - lip; S[o + 3] = 0;
      for (let l = 0; l < LEV; l++) HA[l >> 2][o + (l & 3)] = t.hw[l];
    }
  }
  g.attributes.aS.needsUpdate = g.attributes.aH0.needsUpdate = g.attributes.aH1.needsUpdate = g.attributes.aH2.needsUpdate = true;
  return floorMin;
}

// ---- THE WALLS -----------------------------------------------------------------------------
// Clip position computed exactly as the terrain's standard material does (projection * (modelView
// * p)), polygon offset toward the lens, no depth writes: it never loses the depth test to the rock
// it lies on (the seep's camouflage lesson). FrontSide: the rock's own faces only (from below, from
// inside the rock, nothing). aF: (fissureDist, v from the kinked centreline) per patch vertex.
const WALL_VS = `
  attribute vec2 aF; varying vec3 vW, vN; varying vec2 vF;
  void main(){ vW = ( modelMatrix * vec4( position, 1.0 ) ).xyz; vN = normal; vF = aF;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mvPosition; }`;
const WALL_FS = `
  uniform vec3 uColor; uniform float uTime, uK, uLip, uHalf, uSeed; uniform vec4 uAx;
  varying vec3 vW, vN; varying vec2 vF;
  ${NOISE}
  ${PATCH}
  void main(){
    float depth = uLip - vW.y;
    float u = dot( vW.xz - uAx.xy, uAx.zw );
    vec2 nrm = vec2( -uAx.w, uAx.z ), toAx = -sign( vF.y + 1e-4 ) * nrm;
    vec3 N = normalize( vN );
    // the faces turned to the throat's axis catch the light rising out of it; the lips, the slabs'
    // tops and the apron catch the glow spilling out over the crack
    float lam = max( dot( N, normalize( vec3( toAx.x * 0.8, -0.6, toAx.y * 0.8 ) ) ), 0.0 );
    float top = max( dot( N, normalize( vec3( toAx.x * 0.55, 0.85, toAx.y * 0.55 ) ) ), 0.0 );
    // the crater floor's caustic carried onto the faces: rings rising up the wall, streaks along the crack
    float ripple = sin( depth * 0.55 + uTime * 1.6 );
    float spokes = 0.5 + 0.5 * sin( u * 0.85 + uTime * 0.75 + ripple * 2.2 );
    float n = fbm3( vec2( u * 0.16, vW.y * 0.16 ) + vec2( uTime * 0.09, -uTime * 0.06 ) );
    float caus = ( pow( spokes, 3.0 ) * 0.9 + 0.25 ) * ( 0.35 + 1.1 * n );
    // broken up at a shorter scale too, along the crack and down the face (no even enamel)
    float n2 = fbm3( vec2( u * 0.45 + uSeed, vW.y * 0.32 ) + vec2( uTime * 0.03, -uTime * 0.05 ) );
    float brk = 0.2 + 1.6 * n2 * n2;
    float inside = 1.0 - smoothstep( -0.3, 0.6, vF.x );
    // the light is the throat's: strongest near its axis and down in it, thinning up the wall toward
    // the lip over its last ~14 u and outward from the axis, so the lip is not a painted line
    float axisK = exp( -max( abs( vF.y ) - 1.5, 0.0 ) / 3.0 );
    float rise = 0.1 + 0.9 * smoothstep( 0.0, 14.0, depth );
    float deepDim = 1.0 - 0.55 * smoothstep( 28.0, 75.0, depth );          // the light is in the water, not a lit floor
    float walls = inside * lam * rise * axisK * deepDim * ( 0.3 + 0.5 * caus ) * brk;
    // and what reaches the lip carries on over it, fading out onto the apron (no edge where it stops)
    float spill = exp( -max( vF.x, 0.0 ) / 2.2 ) * top * ( 1.0 - smoothstep( 0.0, 9.0, depth ) ) * 0.07 * brk;
    float tip = 1.0 - smoothstep( uHalf * 0.6, uHalf * 0.97, abs( u ) );
    float d = distance( vW, cameraPosition );
    float near = 0.2 + 0.8 * smoothstep( 3.0, 24.0, d );                  // up close: light ON the rock, not paint
    float a = uK * tip * near * patchK( u, uTime, uSeed ) * ( walls + spill ) * exp( -d * ${EXT} );
    if ( a <= 0.002 ) discard;
    gl_FragColor = vec4( uColor, a );
  }`;
function wallMesh(zi) {
  const P = fissurePatchGeo(zi), F = FISSURE[zi], A = P.pos.array, cnt = P.pos.count;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', P.pos); g.setAttribute('normal', P.nor);
  // per patch vertex (slab vertices too: the buffer's whole count): its distance to the lip outline
  // and its side of the crack (site-invariant: the patch's x, z never move)
  const aF = new Float32Array(cnt * 2), _l = { u: 0, v: 0 };
  for (let i = 0; i < cnt; i++) {
    const x = A[i * 3], z = A[i * 3 + 2];
    aF[i * 2] = fissureDist(x, z, zi); fissureLocal(x, z, zi, _l); aF[i * 2 + 1] = _l.v;
  }
  g.setAttribute('aF', new THREE.BufferAttribute(aF, 2));
  // the patch's triangles in and just round the crack (the lips and the apron's first 3 u), and
  // every overhang slab triangle (top, front, underside)
  const keep = [];
  for (const I of P.index) for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (a >= P.nv && b >= P.nv && c >= P.nv) { keep.push(a, b, c); continue; }
    if (a >= P.nv || b >= P.nv || c >= P.nv) continue;
    if ((aF[a * 2] + aF[b * 2] + aF[c * 2]) / 3 < 3) keep.push(a, b, c);
  }
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(F.cx, 0, F.cz), Math.hypot(F.halfLen + 8, 50));
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...COLS[zi]) }, uTime: { value: 0 }, uK: { value: 0 }, uLip: { value: 0 },
      uHalf: { value: F.halfLen }, uAx: { value: new THREE.Vector4(F.cx, F.cz, F.dx, F.dz) }, uSeed: { value: zi * 3.7 } },
    vertexShader: WALL_VS, fragmentShader: WALL_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4
  });
  m.customProgramCacheKey = () => 'riftWall';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'riftWall' + zi;
  mesh.visible = false;
  return mesh;
}

// ---- THE DRIFT -----------------------------------------------------------------------------
// aP: (x, z) in the group's frame on the crack, phase, climb rate (fraction of the column / s);
// aF: the floor under it, relative to the group (reseat)
const DRIFT_VS = `
  uniform float uTime, uK, uPix, uTop; attribute vec4 aP; attribute float aF;
  varying float vA;
  void main(){
    float k = fract( aP.z + uTime * aP.w );
    vec3 p = vec3( aP.x + sin( uTime * 0.31 + aP.z * 17.0 ) * 0.5, mix( aF + 2.0, uTop, k ),
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
    fissureWorld(u, (wd.w1 - wd.w0) * 0.5 + (rand() * 2 - 1) * 0.3 * w, zi, _w);
    par[i * 4] = _w.x - F.cx; par[i * 4 + 1] = _w.z - F.cz; par[i * 4 + 2] = rand(); par[i * 4 + 3] = 1 / (70 + 70 * rand());
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.BufferAttribute(par, 4));
  g.setAttribute('aF', new THREE.BufferAttribute(new Float32Array(N_DRIFT), 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...COLS[zi]) }, uTime: { value: 0 }, uK: { value: 0 }, uPix: { value: 900 }, uTop: { value: 30 } },
    vertexShader: DRIFT_VS, fragmentShader: DRIFT_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  m.customProgramCacheKey = () => 'riftDrift';
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

// ---- THE HALO ------------------------------------------------------------------------------
const HALO_VS = `
  varying vec2 vQ; varying vec3 vW;
  void main(){ vQ = uv * 2.0 - 1.0; vW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
const HALO_FS = `
  uniform vec3 uColor; uniform float uK, uTime, uFar, uMax; varying vec2 vQ; varying vec3 vW;
  ${NOISE}
  void main(){
    float r2 = dot( vQ, vQ );
    float n = vn( vQ * 3.0 + vec2( uTime * 0.05, -uTime * 0.04 ) );
    float a = uK * exp( -r2 * 3.2 ) * ( 0.75 + 0.5 * n ) * ( 1.0 - smoothstep( 0.7, 1.0, r2 ) );
    // its own fade with range (fog off), and never past the cap; gone edge-on (a grazing view of a
    // flat glow is a hard band across the crack)
    vec3 tc = cameraPosition - vW; float dd = length(tc);
    a = min( a * clamp( 1.0 - dd / uFar, 0.0, 1.0 ) * smoothstep( 0.18, 0.55, abs( tc.y ) / max( dd, 1e-3 ) ) * smoothstep( 4.0, 18.0, dd ), uMax );   // (and thinning as you come into it)
    if ( a <= 0.001 ) discard;
    gl_FragColor = vec4( uColor, a );
  }`;
// a flat glow drawn out along the crack, lying just over its lips (seen from above it softens the
// gash's edge; edge-on it is nothing)
function halo(zi) {
  const F = FISSURE[zi], g = new THREE.PlaneGeometry(2, 2, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...COLS[zi]) }, uK: { value: 0 }, uTime: { value: 0 }, uFar: { value: 140 }, uMax: { value: 0.3 } },
    vertexShader: HALO_VS, fragmentShader: HALO_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true, fog: false
  });
  m.customProgramCacheKey = () => 'riftHalo';
  const s = new THREE.Mesh(g, m);
  s.name = 'riftHalo' + zi;
  s.rotation.y = Math.atan2(-F.dz, F.dx);           // local x -> the crack's bearing
  s.scale.set(F.halfLen * 1.12, 1, F.halfW * 1.9);
  s.position.set(0, 1.5, 0);
  return s;
}

// ---- build / seat --------------------------------------------------------------------------
export function buildRifts() {
  const _s = new THREE.Vector2();
  let seed = 0x5a17;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let zi = 0; zi < 3; zi++) {
    const F = FISSURE[zi];
    const grp = new THREE.Group();
    grp.name = 'riftLight' + zi;
    grp.visible = false;
    const cur = curtain(zi, rand);
    const dr = drift(zi, rand);
    const ha = halo(zi);
    grp.add(cur.mesh, dr, ha);
    scene.add(grp);
    const wall = wallMesh(zi);
    scene.add(wall);
    // the surface glow (zone 0): a low, wide breath of pale light where the sea lies over the crack,
    // a sprite stood on the water (warmGlow's house program: fog off, its own linear fade to 320 u)
    let surf = null;
    if (zi === 0) {
      surf = makeWarmGlow(new THREE.Color(...COLS[0]), 1, { near: 40, far: 320, nearW: 0 });
      surf.name = 'riftSurf0';
      surf.scale.set(F.halfLen * 1.9, TUNE.surfH, 1);
      surf.position.set(F.cx, 0, F.cz);
      surf.material.opacity = 0; surf.visible = false;
      scene.add(surf);
    }
    rifts.push({ grp, curtain: cur, wall, drift: dr, halo: ha, surf, light: 0, gate: 1, floorMin: -1e9, lip: 0 });
    dr.onBeforeRender = (r, s, cam) => {
      r.getSize(_s);
      dr.material.uniforms.uPix.value = _s.y * r.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360));
    };
  }
  reseatRifts();
}

// The fissure never moves (riftPos and FISSURE are frozen), but a site swap regrows terrain under
// it: re-seat the light on the current lip and throat floor, in place (attributes rewritten, no new
// geometry, no material), and lean its colour for this anchorage's water. The group sits at the
// crack's centre on its mean lip height.
const _lean = [1, 1, 1];
export function reseatRifts() {
  for (let zi = 0; zi < rifts.length; zi++) {
    const R = rifts[zi], F = FISSURE[zi], lip = lipMeanY(zi, terrainH);
    R.grp.position.set(F.cx, lip, F.cz); R.lip = lip;
    R.floorMin = seatCurtain(R, zi, lip);
    const DP = R.drift.geometry.attributes.aP.array, DF = R.drift.geometry.attributes.aF;
    for (let i = 0; i < N_DRIFT; i++) DF.array[i] = terrainUnderH(F.cx + DP[i * 4], F.cz + DP[i * 4 + 1], zi) - lip;
    DF.needsUpdate = true;
    R.wall.material.uniforms.uLip.value = lip;
    R.wall.geometry.boundingSphere.center.y = lip - 30;
    siteLean(zi, _lean);
    const c = COLS[zi];
    for (const m of [R.curtain.mesh.material, R.wall.material, R.drift.material, R.halo.material])
      m.uniforms.uColor.value.set(c[0] * _lean[0], c[1] * _lean[1], c[2] * _lean[2]);
    if (R.surf) R.surf.material.color.setRGB(c[0] * _lean[0], c[1] * _lean[1], c[2] * _lean[2]);
  }
}

export function updateRifts(dt, t, openK) {
  const breath = 0.75 + 0.25 * Math.sin(t * TAU / BREATH), camY = camera.position.y;
  for (let zi = 0; zi < rifts.length; zi++) {
    const R = rifts[zi], o = c01((openK[zi] - K0) / (1 - K0)), L = o * o * (3 - 2 * o);
    // from below nothing: it fades as the camera goes under this zone's deepest throat floor
    const gate = TUNE.noGate ? 1 : c01((camY - (R.floorMin - GATE)) / GATE);   // (noGate: dev A/B only)
    R.light = L; R.gate = gate;
    const see = L * gate > 0.003 && terrainMeshes[zi].visible;
    R.grp.visible = see; R.wall.visible = see;
    if (see) {
      const k = L * gate * LIGHT_K[zi];
      // with the lens INSIDE the crack the veil all round it would fill the screen: it thins to a quarter
      const ins = c01(-fissureDist(camera.position.x, camera.position.z, zi) / 2) * c01((R.lip + 3 - camY) / 4);
      const C = R.curtain.mesh.material.uniforms; C.uK.value = TUNE.curtain * k * breath * (1 - TUNE.inside * ins); C.uTime.value = t; C.uEndOn.value = TUNE.endOn;
      const W = R.wall.material.uniforms; W.uK.value = TUNE.wall * k * breath; W.uTime.value = t;
      const D = R.drift.material.uniforms; D.uK.value = TUNE.drift * k * (0.85 + 0.15 * breath); D.uTime.value = t;
      const H = R.halo.material.uniforms; H.uK.value = TUNE.halo * k * breath; H.uTime.value = t;
    }
    if (R.surf) {
      // seen from the air only (under the water it would be a fog-free light through 240 u of sea)
      const air = c01((camY - localSurfaceY() + 0.3) / 0.9), s = L * air * LIGHT_K[zi];
      R.surf.visible = s > 0.003;
      if (R.surf.visible) {
        const F = FISSURE[zi];
        R.surf.position.y = surfaceHeightAt(F.cx, F.cz, t, stormLevel());
        R.surf.scale.y = TUNE.surfH;
        R.surf.material.opacity = Math.min(SURF_MAX, TUNE.surf * s * breath);
      }
    }
  }
}

// dev surface (probes): the light each zone shows now, the curtain's stations, the parts' gains
const __rifts = {
  K: LIGHT_K, tune: TUNE, lean: SITE_LEAN, reseat: reseatRifts, surfMax: SURF_MAX,
  state(zi) { const R = rifts[zi]; return R ? { light: R.light, gate: R.gate, visible: R.grp.visible, floorMin: R.floorMin, stations: R.curtain.st.length, blobs: R.curtain.nb,
    wallTris: R.wall.geometry.index.count / 3, surf: R.surf ? R.surf.visible : null } : null; },
  // the curtain's stations as seated: u, x, z, floor, lip, the measured open half-width per level
  stations(zi) { const R = rifts[zi]; return R ? R.curtain.st.map(s => ({ u: s.u, x: s.x, z: s.z, tx: s.tx, tz: s.tz, floor: s.floor, lip: s.lip, hw: Array.from(s.hw) })) : []; },
  // the blob radius the shader gives at height y (absolute) over station s (the same formula)
  radiusAt(zi, si, y) {
    const s = rifts[zi].curtain.st[si], top = s.lip + LEV_UP, ytop = s.lip + UP_TOP;
    const hwAt = yy => { if (yy >= top) return s.hw[LEV - 1] + (yy - top) * 0.5; const t = c01((yy - s.floor) / Math.max(1, top - s.floor)), f = (1 - Math.sqrt(1 - t)) * (LEV - 1), i = Math.min(Math.floor(f), LEV - 2); return s.hw[i] + (s.hw[i + 1] - s.hw[i]) * (f - i); };
    y = Math.max(y, s.floor + FOOT);
    let R = Math.min(Math.min(R_MAX, 0.9 + 0.06 * (y - s.floor)), HW_FILL * hwAt(y));
    const Sy = STRETCH * R;
    R = Math.min(R, HW_FILL * Math.min(hwAt(y + 0.62 * Sy), hwAt(y - 0.62 * Sy)) / 0.76);
    R = Math.min(R, HW_FILL * Math.min(hwAt(y + 0.94 * Sy), hwAt(y - 0.94 * Sy)) / 0.17);
    R = Math.max(0.05, R);
    // (the shader lifts it by up to 0.95 R STRETCH off the floor; the side view's tall veil)
    return { y: Math.max(y, s.floor + 0.95 * R * STRETCH), R, sy: STRETCH, ytop };
  },
  materials(zi) { const R = rifts[zi]; return R ? [R.curtain.mesh.material, R.wall.material, R.drift.material, R.halo.material].concat(R.surf ? [R.surf.material] : []) : []; }
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
