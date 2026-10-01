// THE SPECTRAL OCEAN — a Tessendorf FFT sea, generated every frame on the GPU.
// OWNED BY: water/atmosphere agent (ocean track). water.js owns the surface material
// and every optic; this module owns the WAVE FIELD and nothing else:
//   * the spectrum (JONSWAP wind sea + a narrow-band swell, directional spreading),
//     evaluated per bin per frame on the GPU from weather-driven uniforms, so wind and
//     storm re-shape the sea continuously with no CPU regeneration and no pop (the
//     Gaussian draws are fixed per bin; only the envelope moves);
//   * three cascades (287 / 67 / 17 world units, non-integer ratios so their tilings
//     never line up) each owning a disjoint band of wavenumbers;
//   * one inverse FFT for all three at once: the cascades are stacked in a 256 x 768
//     atlas and every butterfly pass transforms all of them (8 horizontal + 8 vertical
//     Stockham radix-2 passes, each MRT x2 = four complex fields = eight real ones);
//   * a merge pass per cascade writing three mip-mapped half-float textures the surface
//     samples: displacement (+ Jacobian), chop-corrected slope (+ slope squared, which
//     after mip filtering IS the unresolved slope variance -> the specular roughness),
//     and the Jacobian terms + PERSISTENT foam (ping-ponged, so whitecaps linger and
//     decay where the parcel broke);
//   * a CPU height query that agrees with what is DRAWN: a tiny probe pass evaluates the
//     exact vertex displacement (same textures, same mip LOD law, inverse-displacement
//     fixed point) on two windows (around the player and around the raft) and reads
//     them back through a fence-free PBO ring; the CPU interpolates in space and
//     extrapolates the two-frame latency in time. Outside the windows (or before the
//     first readback lands) an analytic sum of the dominant spectral components of the
//     same spectrum answers instead.
// Units: one world unit is 3 m (the project's long-standing convention: omega =
// sqrt(g k / 3) with k per unit). The spectrum is evaluated in METRES and converted.
// Zero per-frame allocation: every target, buffer and scratch array is built once.
import * as THREE from 'three';
import { renderer, camera } from '../core.js';
import { GLASS } from '../config.js';

export const OCEAN_N = 256;
const N = OCEAN_N, LOGN = 8;
export const CASCADE_L = [287.0, 67.0, 17.0];
// Band edges in rad per world unit. A cascade keeps the waves its patch resolves with
// at least six wavelengths across the NEXT patch; everything shorter belongs to the
// next one. Disjoint, so no wavenumber is ever counted twice.
const K_EDGE = [0.0, 6 * 2 * Math.PI / CASCADE_L[1], 6 * 2 * Math.PI / CASCADE_L[2], 1e9];
const GRAV = 9.81;
// Frequency quantisation: every omega is snapped to a multiple of 2 pi / T_REP, so the
// whole field repeats every T_REP seconds and the shader's phase argument stays small
// no matter how long the game has run (fp32 phase at t = 1e5 s would jitter).
const T_REP = 400.0, W0 = 2 * Math.PI / T_REP;

// Clipmap geometry constants, shared with water.js's surface material.
export const GRID_S0 = 0.25;      // finest cell, world units (power of two: snapping is exact)
export const GRID_M = 40;         // half-width of every level in its own cells
export const GRID_LEVELS = 8;     // R = 10 * 2^l -> 1280 u at the last level (camera.far = 700)

// ---------------------------------------------------------------------------
// Uniforms the surface material shares (water.js spreads OCEAN_UNIFORMS into it).
// ---------------------------------------------------------------------------
export const uOcL = { value: new THREE.Vector3(...CASCADE_L) };
// (s0, M, lodBias, enabled)
export const uOcGrid = { value: new THREE.Vector4(GRID_S0, GRID_M, 1.0, 1) };
export const uOcLevC = { value: Array.from({ length: GRID_LEVELS }, () => new THREE.Vector2()) };
export const uOcDisp = [{ value: null }, { value: null }, { value: null }];
export const uOcSlope = [{ value: null }, { value: null }, { value: null }];
export const uOcFoam = [{ value: null }, { value: null }, { value: null }];
// (foamThr, foamSoft, chop lambda, residual mss) — the surface's foam/roughness numbers.
export const uOcK = { value: new THREE.Vector4(0.45, 0.35, 1.0, 0.002) };
// (Hs units, total mss, peak wavelength units, sea state 0..1) for the shader's
// "how tall / how steep is this sea" questions and the far-field BRDF.
export const uOcSea = { value: new THREE.Vector4(0.4, 0.01, 60, 0) };

export const OCEAN_UNIFORMS = {
  uOcL, uOcGrid, uOcLevC, uOcK, uOcSea,
  uOcDisp0: uOcDisp[0], uOcDisp1: uOcDisp[1], uOcDisp2: uOcDisp[2],
  uOcSlope0: uOcSlope[0], uOcSlope1: uOcSlope[1], uOcSlope2: uOcSlope[2],
  uOcFoam0: uOcFoam[0], uOcFoam1: uOcFoam[1], uOcFoam2: uOcFoam[2]
};

// Displacement at a parameter point, with the LOD law the mesh uses. A PURE FUNCTION
// of (p, camera xz): that is what makes the clipmap crack-free (a vertex shared by two
// levels evaluates the identical number) and what lets the CPU probe reproduce the
// drawn height exactly. The LOD answers the grid spacing at that distance: a level-l
// ring spans [R/2, R] with cells of R/M, so 2d/M bounds the local spacing from above;
// one extra mip keeps every surviving wavelength at >= 4 vertices.
export const OCEAN_GLSL_DISP = `
uniform vec3 uOcL;
uniform vec4 uOcGrid;
uniform sampler2D uOcDisp0, uOcDisp1, uOcDisp2;
float ocLod( float spacing, float L ){
  return max( log2( spacing * ${(N).toFixed(1)} / L ) + uOcGrid.z, 0.0 );
}
vec3 ocDisp( vec2 p, vec2 camXZ ){
  float d = length( p - camXZ );
  float sp = max( uOcGrid.x, 2.0 * d / uOcGrid.y );
  vec3 D = textureLod( uOcDisp0, p / uOcL.x, ocLod( sp, uOcL.x ) ).xyz;
  float l1 = ocLod( sp, uOcL.y );
  if ( l1 < 7.5 ) D += textureLod( uOcDisp1, p / uOcL.y, l1 ).xyz;
  float l2 = ocLod( sp, uOcL.z );
  if ( l2 < 7.5 ) D += textureLod( uOcDisp2, p / uOcL.z, l2 ).xyz;
  return D;
}`;

// ---------------------------------------------------------------------------
// The spectrum. ONE definition, written twice (GLSL for the GPU, JS for the CPU
// fallback / stats) and kept line-for-line parallel. Parameters:
//   A = (U m/s, fetch m, gamma, ampK)            the wind sea
//   B = (wind dir x, z, swell dir x, z)
//   C = (swell Hs m, swell omega_p, swell gamma, swell spread s)
//   D = (wind spread scale, short-wave cut m, 0, 0)
// ---------------------------------------------------------------------------
const GLSL_SPECTRUM = `
const float GRAV = ${GRAV.toFixed(2)};
const float PI = 3.14159265359;
uniform vec4 uSpA, uSpB, uSpC, uSpD;
float lgammaS( float x ){
  return ( x - 0.5 ) * log( x ) - x + 0.91893853 + 1.0 / ( 12.0 * x ) - 1.0 / ( 360.0 * x * x * x );
}
// cos^2s(theta/2) spreading, normalised over the full circle.
float spreadD( float cosT, float s ){
  float c2 = clamp( 0.5 + 0.5 * cosT, 0.0, 1.0 );
  float lq = 2.0 * lgammaS( s + 1.0 ) - lgammaS( 2.0 * s + 1.0 ) + ( 2.0 * s - 1.0 ) * 0.69314718 - 1.14472989;
  return exp( lq + s * log( max( c2, 1e-12 ) ) );
}
float peakR( float w, float wp ){
  float sg = w <= wp ? 0.07 : 0.09;
  float x = ( w - wp ) / ( sg * wp );
  return exp( -0.5 * x * x );
}
// Directional variance density in (k_x, k_z) space, METRES: E(k) = S(w) dw/dk D / k.
float specDensity( vec2 km ){
  float k = length( km );
  if ( k < 1e-6 ) return 0.0;
  float w = sqrt( GRAV * k );
  float U = max( uSpA.x, 0.5 ), F = uSpA.y;
  // JONSWAP wind sea, fetch-limited (Hasselmann 1973).
  float alpha = 0.076 * pow( U * U / ( F * GRAV ), 0.22 );
  float wp = 22.0 * pow( GRAV * GRAV / ( U * F ), 1.0 / 3.0 );
  float r = wp / w, r2 = r * r;
  float Sw = alpha * GRAV * GRAV / ( w * w * w * w * w ) * exp( -1.25 * r2 * r2 ) * pow( uSpA.z, peakR( w, wp ) );
  // Mitsuyasu-shaped spread: narrow at the peak, opening either side of it.
  float wr = w / wp;
  float sW = ( wr < 1.0 ? 9.0 * pow( wr, 4.0 ) : 9.0 * pow( wr, -2.5 ) ) * uSpD.x;
  sW = clamp( sW, 0.6, 40.0 );
  vec2 kd = km / k;
  float Dw = spreadD( dot( kd, uSpB.xy ), sW );
  // The swell: a narrow-band Pierson-Moskowitz/JONSWAP of given Hs and peak (Goda's
  // normalisation), from its own bearing, tightly spread.
  float Ss = 0.0;
  if ( uSpC.x > 1e-3 ) {
    float sp = uSpC.y / w, sp2 = sp * sp;
    Ss = 0.3125 * uSpC.x * uSpC.x * uSpC.y * uSpC.y * uSpC.y * uSpC.y / ( w * w * w * w * w )
       * exp( -1.25 * sp2 * sp2 ) * pow( uSpC.z, peakR( w, uSpC.y ) ) * ( 1.0 - 0.287 * log( uSpC.z ) );
    Ss *= spreadD( dot( kd, uSpB.zw ), uSpC.w );
  }
  float dwdk = GRAV / ( 2.0 * w );
  float E = ( Sw * Dw + Ss ) * dwdk / k;
  // Capillary roll-off past the short cut (the far end of cascade 2 is ~0.4 m).
  E *= exp( -k * k * uSpD.y * uSpD.y );
  return E * uSpA.w;
}`;

// JS twin of specDensity (same maths, same order).
function lgammaS(x) {
  return (x - 0.5) * Math.log(x) - x + 0.91893853 + 1 / (12 * x) - 1 / (360 * x * x * x);
}
function spreadD(cosT, s) {
  const c2 = Math.min(1, Math.max(0, 0.5 + 0.5 * cosT));
  const lq = 2 * lgammaS(s + 1) - lgammaS(2 * s + 1) + (2 * s - 1) * 0.69314718 - 1.14472989;
  return Math.exp(lq + s * Math.log(Math.max(c2, 1e-12)));
}
function peakR(w, wp) {
  const sg = w <= wp ? 0.07 : 0.09, x = (w - wp) / (sg * wp);
  return Math.exp(-0.5 * x * x);
}
const SP = { A: [8, 1e5, 3.3, 1], B: [1, 0, 1, 0], C: [0.4, 0.57, 4, 24], D: [1, 0.02, 0, 0] };
// Omnidirectional S(w) in m^2 s (for stats), wind + swell.
function specW(w) {
  const [U0, F, gam] = SP.A, U = Math.max(U0, 0.5);
  const alpha = 0.076 * Math.pow(U * U / (F * GRAV), 0.22);
  const wp = 22 * Math.pow(GRAV * GRAV / (U * F), 1 / 3);
  const r = wp / w, r2 = r * r;
  let S = alpha * GRAV * GRAV / w ** 5 * Math.exp(-1.25 * r2 * r2) * Math.pow(gam, peakR(w, wp));
  const [Hs, wps, gs] = SP.C;
  if (Hs > 1e-3) {
    const sp = wps / w, sp2 = sp * sp;
    S += 0.3125 * Hs * Hs * wps ** 4 / w ** 5 * Math.exp(-1.25 * sp2 * sp2) * Math.pow(gs, peakR(w, wps)) * (1 - 0.287 * Math.log(gs));
  }
  const k = w * w / GRAV;
  return S * Math.exp(-k * k * SP.D[1] * SP.D[1]) * SP.A[3];
}
function specDensity(kx, kz) {
  const k = Math.hypot(kx, kz);
  if (k < 1e-6) return 0;
  const w = Math.sqrt(GRAV * k);
  const [U0, F, gam, ampK] = SP.A, U = Math.max(U0, 0.5);
  const alpha = 0.076 * Math.pow(U * U / (F * GRAV), 0.22);
  const wp = 22 * Math.pow(GRAV * GRAV / (U * F), 1 / 3);
  const r = wp / w, r2 = r * r;
  const Sw = alpha * GRAV * GRAV / w ** 5 * Math.exp(-1.25 * r2 * r2) * Math.pow(gam, peakR(w, wp));
  const wr = w / wp;
  let sW = (wr < 1 ? 9 * wr ** 4 : 9 * wr ** -2.5) * SP.D[0];
  sW = Math.min(40, Math.max(0.6, sW));
  const dx = kx / k, dz = kz / k;
  const Dw = spreadD(dx * SP.B[0] + dz * SP.B[1], sW);
  let Ss = 0;
  const [Hs, wps, gs, ss] = SP.C;
  if (Hs > 1e-3) {
    const sp = wps / w, sp2 = sp * sp;
    Ss = 0.3125 * Hs * Hs * wps ** 4 / w ** 5 * Math.exp(-1.25 * sp2 * sp2) * Math.pow(gs, peakR(w, wps)) * (1 - 0.287 * Math.log(gs));
    Ss *= spreadD(dx * SP.B[2] + dz * SP.B[3], ss);
  }
  const E = (Sw * Dw + Ss) * (GRAV / (2 * w)) / k;
  return E * Math.exp(-k * k * SP.D[1] * SP.D[1]) * ampK;
}

// ---------------------------------------------------------------------------
// GPU passes
// ---------------------------------------------------------------------------
const HEAD = `precision highp float; precision highp int; precision highp sampler2D;`;
const VERT = `${HEAD}
in vec3 position;
void main(){ gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

// Time evolution: h(k,t) = h0(k) e^{-iwt} + conj(h0(-k)) e^{+iwt}, so each component
// travels ALONG its k (the spectrum's energy is downwind, so the sea runs downwind).
const EVOLVE_FRAG = `${HEAD}
${GLSL_SPECTRUM}
uniform sampler2D uNoise;
uniform vec3 uL, uKlo, uKhi;
uniform float uT;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
vec2 cmul( vec2 a, vec2 b ){ return vec2( a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x ); }
vec2 ci( vec2 a ){ return vec2( -a.y, a.x ); }
void main(){
  ivec2 px = ivec2( gl_FragCoord.xy );
  int c = px.y / ${N};
  int n = px.x, m = px.y - c * ${N};
  float L = uL[ c ];
  int nn = n < ${N / 2} ? n : n - ${N};
  int mm = m < ${N / 2} ? m : m - ${N};
  vec2 k = vec2( float( nn ), float( mm ) ) * ( 2.0 * PI / L );
  float kl = length( k );
  o0 = vec4( 0.0 ); o1 = vec4( 0.0 );
  if ( kl < uKlo[ c ] || kl >= uKhi[ c ] || kl < 1e-6 || n == ${N / 2} || m == ${N / 2} ) return;
  // Bin area in (rad/m)^2 and the metres -> units conversion (1 u = 3 m).
  float dk = 2.0 * PI / ( L * 3.0 );
  vec2 km = k / 3.0;
  float aP = sqrt( 0.5 * specDensity( km ) ) * dk / 3.0;
  float aM = sqrt( 0.5 * specDensity( -km ) ) * dk / 3.0;
  vec2 xiP = texelFetch( uNoise, px, 0 ).xy;
  ivec2 pm = ivec2( ( ${N} - n ) % ${N}, c * ${N} + ( ${N} - m ) % ${N} );
  vec2 xiM = texelFetch( uNoise, pm, 0 ).xy;
  vec2 h0P = xiP * aP, h0M = xiM * aM;
  float w = sqrt( GRAV * kl / 3.0 );
  w = floor( w / ${W0.toFixed(8)} ) * ${W0.toFixed(8)};
  float ph = w * uT;
  vec2 e = vec2( cos( ph ), -sin( ph ) );
  vec2 h = cmul( h0P, e ) + cmul( vec2( h0M.x, -h0M.y ), vec2( e.x, -e.y ) );
  vec2 kh = k / kl;
  vec2 Dx = ci( h ) * kh.x, Dz = ci( h ) * kh.y;
  vec2 Dxz = -h * ( k.x * k.y / kl );
  vec2 hx = ci( h ) * k.x, hz = ci( h ) * k.y;
  vec2 Dxx = -h * ( k.x * k.x / kl ), Dzz = -h * ( k.y * k.y / kl );
  // Two real fields per complex IFFT: A + iB transforms to a + ib.
  o0 = vec4( h + ci( Dx ), Dz + ci( Dxz ) );
  o1 = vec4( hx + ci( hz ), Dxx + ci( Dzz ) );
}`;

// Stockham radix-2 inverse FFT stage (natural order in, natural order out; verified
// against a brute-force DFT in node before it was ever compiled). uDir 0 = rows,
// 1 = columns; columns stay inside each cascade's 256-row block of the atlas.
const FFT_FRAG = `${HEAD}
uniform sampler2D uS0, uS1;
uniform int uStage, uDir;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
vec2 cmul( vec2 a, vec2 b ){ return vec2( a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x ); }
void main(){
  ivec2 px = ivec2( gl_FragCoord.xy );
  int i = uDir == 0 ? px.x : px.y % ${N};
  int S = 1 << ( uStage + 1 ), H = S >> 1;
  int e = ( i / S ) * H + ( i % H ), o = e + ${N / 2};
  ivec2 pe = uDir == 0 ? ivec2( e, px.y ) : ivec2( px.x, px.y - i + e );
  ivec2 po = uDir == 0 ? ivec2( o, px.y ) : ivec2( px.x, px.y - i + o );
  float a = 6.28318530718 * float( i ) / float( S );
  vec2 tw = vec2( cos( a ), sin( a ) );
  vec4 e0 = texelFetch( uS0, pe, 0 ), q0 = texelFetch( uS0, po, 0 );
  vec4 e1 = texelFetch( uS1, pe, 0 ), q1 = texelFetch( uS1, po, 0 );
  o0 = vec4( e0.xy + cmul( tw, q0.xy ), e0.zw + cmul( tw, q0.zw ) );
  o1 = vec4( e1.xy + cmul( tw, q1.xy ), e1.zw + cmul( tw, q1.zw ) );
}`;

// Merge: the eight real fields of one cascade -> the three textures the sea samples.
const MERGE_FRAG = `${HEAD}
uniform sampler2D uS0, uS1, uPrev;
uniform int uC;
uniform vec4 uM;   // (lambda, foamThr, foam birth gain, decay factor this frame)
uniform float uFoamOn;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
void main(){
  ivec2 px = ivec2( gl_FragCoord.xy );
  ivec2 q = ivec2( px.x, px.y + uC * ${N} );
  vec4 a = texelFetch( uS0, q, 0 ), b = texelFetch( uS1, q, 0 );
  float lam = uM.x;
  float jxx = 1.0 + lam * b.z, jzz = 1.0 + lam * b.w, jxz = lam * a.w;
  float J = jxx * jzz - jxz * jxz;
  // The world-space slope of the displaced surface is (I + dD/dp)^-1 grad_p h. The
  // floor keeps a folding parcel from throwing an infinite normal.
  float Js = max( J, 0.25 );
  float sx = ( jzz * b.x - jxz * b.y ) / Js;
  float sz = ( jxx * b.y - jxz * b.x ) / Js;
  o0 = vec4( lam * a.y, a.x, lam * a.z, J );
  o1 = vec4( sx, sz, sx * sx, sz * sz );
  // PERSISTENT FOAM, in parameter space. A parcel is a Lagrangian label, so foam left
  // at a texel is foam the crest left behind as it moved on: trails and streaks come
  // out of the bookkeeping, not out of a texture.
  float prev = texelFetch( uPrev, px, 0 ).w;
  float birth = clamp( ( uM.y - J ) * uM.z, 0.0, 1.0 );
  float f = max( prev * uM.w, birth );
  o2 = vec4( lam * b.z, lam * b.w, lam * a.w, f * uFoamOn );
}`;

// Probe: the drawn height at world points, for the CPU. Two windows packed 4 heights
// per texel along x: A (player) 64x64 samples -> texels x 0..15, y 0..63; B (raft)
// 32x32 -> texels x 16..23, y 0..31.
const PROBE_W = 24, PROBE_H = 64;
const PROBE_FRAG = `${HEAD}
${OCEAN_GLSL_DISP}
uniform vec4 uWA, uWB;   // (origin x, origin z, spacing, 0)
uniform vec2 uCamXZ;
out vec4 o0;
float hAt( vec2 q ){
  vec2 p = q;
  for ( int it = 0; it < 5; it++ ) { vec3 D = ocDisp( p, uCamXZ ); p = q - D.xz; }
  return ocDisp( p, uCamXZ ).y;
}
void main(){
  ivec2 px = ivec2( gl_FragCoord.xy );
  vec4 W = px.x < 16 ? uWA : uWB;
  int bx = px.x < 16 ? px.x * 4 : ( px.x - 16 ) * 4;
  if ( px.x >= 16 && px.y >= 32 ) { o0 = vec4( 0.0 ); return; }
  vec4 r;
  for ( int j = 0; j < 4; j++ ) {
    vec2 q = W.xy + vec2( float( bx + j ), float( px.y ) ) * W.z;
    r[ j ] = hAt( q );
  }
  o0 = r;
}`;

let ok = false, fftType = THREE.FloatType;
let quad = null, quadCam = null, passScene = null, passMesh = null;
let matEvolve = null, matFFT = null, matMerge = null, matProbe = null;
let rtA = null, rtB = null;                  // FFT ping-pong (MRT x2)
const rtMerge = [[null, null], [null, null], [null, null]];
let mergeCur = 0;
let rtProbe = null, noiseTex = null;
let lastT = 0, frame = 0;

// Fixed Gaussian draws per bin, generated in code (mulberry32 + Box-Muller).
const NOISE = new Float32Array(N * 3 * N * 4);
function buildNoise() {
  let s = 0x0CEA11 >>> 0;
  const rnd = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < N * 3 * N; i++) {
    const u1 = Math.max(rnd(), 1e-9), u2 = rnd(), u3 = Math.max(rnd(), 1e-9), u4 = rnd();
    const r1 = Math.sqrt(-2 * Math.log(u1)), r2 = Math.sqrt(-2 * Math.log(u3));
    NOISE[i * 4] = r1 * Math.cos(2 * Math.PI * u2);
    NOISE[i * 4 + 1] = r1 * Math.sin(2 * Math.PI * u2);
    NOISE[i * 4 + 2] = r2 * Math.cos(2 * Math.PI * u4);
    NOISE[i * 4 + 3] = r2 * Math.sin(2 * Math.PI * u4);
  }
  const t = new THREE.DataTexture(NOISE, N, 3 * N, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

const spU = {
  uSpA: { value: new THREE.Vector4() }, uSpB: { value: new THREE.Vector4() },
  uSpC: { value: new THREE.Vector4() }, uSpD: { value: new THREE.Vector4() }
};

function mkRT(w, h, count, type, mip) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    count, type, format: THREE.RGBAFormat,
    minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter,
    magFilter: mip ? THREE.LinearFilter : THREE.NearestFilter,
    wrapS: mip ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
    wrapT: mip ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: !!mip
  });
  if (mip) {
    const an = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    for (const t of rt.textures) {
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = an;
    }
  }
  return rt;
}

export function oceanReady() { return ok; }

export function buildOcean() {
  const ext = renderer.extensions;
  if (!renderer.capabilities.isWebGL2) { console.warn('ABYSSA ocean: WebGL2 required'); return false; }
  if (ext.has('EXT_color_buffer_float')) fftType = THREE.FloatType;
  else if (ext.has('EXT_color_buffer_half_float')) fftType = THREE.HalfFloatType;
  else { console.warn('ABYSSA ocean: no float render targets'); return false; }
  noiseTex = buildNoise();
  rtA = mkRT(N, 3 * N, 2, fftType, false);
  rtB = mkRT(N, 3 * N, 2, fftType, false);
  for (let c = 0; c < 3; c++) for (let i = 0; i < 2; i++) rtMerge[c][i] = mkRT(N, N, 3, THREE.HalfFloatType, true);
  rtProbe = mkRT(PROBE_W, PROBE_H, 1, fftType === THREE.FloatType ? THREE.FloatType : THREE.HalfFloatType, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const raw = (frag, uniforms) => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false
  });
  matEvolve = raw(EVOLVE_FRAG, {
    ...spU, uNoise: { value: noiseTex }, uT: { value: 0 },
    uL: { value: new THREE.Vector3(...CASCADE_L) },
    uKlo: { value: new THREE.Vector3(K_EDGE[0], K_EDGE[1], K_EDGE[2]) },
    uKhi: { value: new THREE.Vector3(K_EDGE[1], K_EDGE[2], K_EDGE[3]) }
  });
  matFFT = raw(FFT_FRAG, { uS0: { value: null }, uS1: { value: null }, uStage: { value: 0 }, uDir: { value: 0 } });
  matMerge = raw(MERGE_FRAG, {
    uS0: { value: null }, uS1: { value: null }, uPrev: { value: null }, uC: { value: 0 },
    uM: { value: new THREE.Vector4(1, 0.4, 2, 0.98) }, uFoamOn: { value: 1 }
  });
  matProbe = raw(PROBE_FRAG, {
    uOcL, uOcGrid, uOcDisp0: uOcDisp[0], uOcDisp1: uOcDisp[1], uOcDisp2: uOcDisp[2],
    uWA: { value: new THREE.Vector4() }, uWB: { value: new THREE.Vector4() },
    uCamXZ: { value: new THREE.Vector2() }
  });
  passMesh = new THREE.Mesh(geo, matEvolve);
  passMesh.frustumCulled = false;
  passScene = new THREE.Scene();
  passScene.add(passMesh);
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  ok = true;
  setSeaState(0, 0, 1, 0, 0);
  bindMerged();
  return true;
}

function bindMerged() {
  for (let c = 0; c < 3; c++) {
    const rt = rtMerge[c][mergeCur];
    uOcDisp[c].value = rt.textures[0];
    uOcSlope[c].value = rt.textures[1];
    uOcFoam[c].value = rt.textures[2];
  }
}

// ---------------------------------------------------------------------------
// WEATHER -> SPECTRUM. windS 0..1 (eased), storm 0..1, wind bearing (x,z).
// ---------------------------------------------------------------------------
export const OCEAN = {
  windLo: 3.5, windHi: 13.0, stormU: 8.0,      // m/s: U = lo + (hi-lo)*wind + storm*stormU
  fetch: 1.2e5, fetchStorm: 6e5,               // m, fetch-limited JONSWAP
  gamma: 3.3,
  swellHs: 1.5, swellHsStorm: 2.5,             // m
  swellTp: 11.0, swellTpStorm: 13.0,           // s
  swellDeg: 20, swellSpread: 22, swellGamma: 4.0,
  spread: 1.0, ampK: 1.0,
  chop: 1.05, chopStorm: 1.25,
  foamThr: 0.55, foamThrStorm: 0.80, foamGain: 2.2, foamDecay: 2.6, foamDecayStorm: 6.0,
  lodBias: 1.0
};
const _sea = { U: 0, Hs: 0, mss: 0, lamP: 0, state: 0 };
let _chop = 1;
export function setSeaState(windS, storm, wdx, wdz, t) {
  const O = OCEAN;
  const U = O.windLo + (O.windHi - O.windLo) * windS + O.stormU * storm;
  const F = O.fetch + (O.fetchStorm - O.fetch) * storm;
  SP.A[0] = U; SP.A[1] = F; SP.A[2] = O.gamma; SP.A[3] = O.ampK;
  const L = Math.hypot(wdx, wdz) || 1;
  SP.B[0] = wdx / L; SP.B[1] = wdz / L;
  const sa = O.swellDeg * Math.PI / 180;
  SP.B[2] = Math.cos(sa); SP.B[3] = Math.sin(sa);
  const Tp = O.swellTp + (O.swellTpStorm - O.swellTp) * storm;
  SP.C[0] = O.swellHs + (O.swellHsStorm - O.swellHs) * storm;
  SP.C[1] = 2 * Math.PI / Tp; SP.C[2] = O.swellGamma; SP.C[3] = O.swellSpread;
  SP.D[0] = O.spread; SP.D[1] = 0.02;
  spU.uSpA.value.fromArray(SP.A); spU.uSpB.value.fromArray(SP.B);
  spU.uSpC.value.fromArray(SP.C); spU.uSpD.value.fromArray(SP.D);
  _chop = O.chop + (O.chopStorm - O.chop) * storm;
  // 1-D moments for the shader's sea-state scale and the far BRDF: m0 (Hs), and the
  // slope variance of everything the cascades carry (k up to cascade 2's Nyquist).
  let m0 = 0, m2s = 0, wPk = 0, sPk = 0;
  const wMax = Math.sqrt(GRAV * (Math.PI * N / CASCADE_L[2]) / 3);
  const wMin = 0.12, NS = 160;
  const lr = Math.log(wMax / wMin) / NS;
  for (let i = 0; i < NS; i++) {
    const w = wMin * Math.exp((i + 0.5) * lr), dw = w * lr;
    const S = specW(w);
    m0 += S * dw;
    const k = w * w / GRAV;
    m2s += k * k * S * dw;
    if (S > sPk) { sPk = S; wPk = w; }
  }
  _sea.U = U; _sea.Hs = 4 * Math.sqrt(m0) / 3; _sea.mss = m2s;
  _sea.lamP = wPk > 0 ? 2 * Math.PI * GRAV / (wPk * wPk) / 3 : 60;
  _sea.state = Math.min(1, Math.max(0, (U - O.windLo) / (O.windHi + O.stormU - O.windLo)));
  uOcSea.value.set(_sea.Hs, _sea.mss, _sea.lamP, _sea.state);
  const thr = O.foamThr + (O.foamThrStorm - O.foamThr) * storm;
  uOcK.value.set(thr, 0.35, _chop, 0.0015 + 0.0006 * U);
}
export function seaStats() { return _sea; }

// ---------------------------------------------------------------------------
// Per-frame simulation.
// ---------------------------------------------------------------------------
let simOn = true;
export function setOceanSim(on) { simOn = on; }
const _prevVp = new THREE.Vector4();
export function updateOcean(dt, t) {
  if (!ok || !simOn) return;
  const prevRT = renderer.getRenderTarget();
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  const tw = t % T_REP;
  // 1. spectrum + time evolution
  matEvolve.uniforms.uT.value = tw;
  passMesh.material = matEvolve;
  renderer.setRenderTarget(rtA);
  renderer.render(passScene, quadCam);
  // 2. inverse FFT, rows then columns, all three cascades at once
  let src = rtA, dst = rtB;
  passMesh.material = matFFT;
  const fu = matFFT.uniforms;
  for (let dir = 0; dir < 2; dir++) {
    for (let s = 0; s < LOGN; s++) {
      fu.uS0.value = src.textures[0]; fu.uS1.value = src.textures[1];
      fu.uStage.value = s; fu.uDir.value = dir;
      renderer.setRenderTarget(dst);
      renderer.render(passScene, quadCam);
      const tmp = src; src = dst; dst = tmp;
    }
  }
  // 3. merge per cascade (ping-pong for foam memory), mips generated by three
  const O = OCEAN;
  const storm = uOcSea.value.w;
  const tau = O.foamDecay + (O.foamDecayStorm - O.foamDecay) * storm;
  const mu = matMerge.uniforms;
  mu.uM.value.set(_chop, uOcK.value.x, O.foamGain, Math.exp(-Math.min(dt, 0.1) / Math.max(0.1, tau)));
  mu.uS0.value = src.textures[0]; mu.uS1.value = src.textures[1];
  passMesh.material = matMerge;
  const next = mergeCur ^ 1;
  for (let c = 0; c < 3; c++) {
    mu.uC.value = c;
    mu.uPrev.value = rtMerge[c][mergeCur].textures[2];
    renderer.setRenderTarget(rtMerge[c][next]);
    renderer.render(passScene, quadCam);
  }
  mergeCur = next;
  bindMerged();
  uOcGrid.value.z = O.lodBias;
  renderer.setRenderTarget(prevRT);
  renderer.shadowMap.autoUpdate = prevShadow;
  lastT = t; frame++;
}

// Clipmap level centres for this camera. Level l snaps to twice its own cell so the
// next level's grid lines pass through its boundary; the surface draws with these.
export function updateOceanGrid(cx, cz) {
  for (let l = 0; l < GRID_LEVELS; l++) {
    const s2 = GRID_S0 * (1 << l) * 2;
    uOcLevC.value[l].set(Math.round(cx / s2) * s2, Math.round(cz / s2) * s2);
  }
}

// Clipmap mesh: GRID_LEVELS square rings merged into one draw. position = (i, level, j)
// in the level's own cells about its centre. Level 0 is a full square; level l > 0 has
// a static hole of (M/2 - 1) cells (always inside the finer level, whose snapped centre
// sits within one coarse cell of this one); the overlap band is discarded per fragment
// against the finer level's true extent. Diagonals point away from the centre in every
// quadrant (radially symmetric), so the discarded band never leaves a sliver.
export function buildOceanGeometry() {
  const M = GRID_M, H = M / 2 - 1;
  const pos = [], idx = [];
  for (let l = 0; l < GRID_LEVELS; l++) {
    const base = pos.length / 3, W = 2 * M + 1;
    for (let j = -M; j <= M; j++) for (let i = -M; i <= M; i++) pos.push(i, l, j);
    for (let j = -M; j < M; j++) for (let i = -M; i < M; i++) {
      if (l > 0 && i >= -H && i < H && j >= -H && j < H) continue;
      const a = base + (j + M) * W + (i + M), b = a + 1, c = a + W, d = c + 1;
      const q = (i + 0.5 >= 0) === (j + 0.5 >= 0);
      if (q) { idx.push(a, c, d, a, d, b); } else { idx.push(a, c, b, b, c, d); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

// ---------------------------------------------------------------------------
// CPU HEIGHT QUERY
// ---------------------------------------------------------------------------
const PBO_RING = 4, PBO_LAG = 2;
let gl = null, pbo = null, issued = 0, readN = 0, probeFailed = false;
const pboMeta = Array.from({ length: PBO_RING }, () => new Float64Array(7));   // t, ax, az, as, bx, bz, bs
const res = [new Float32Array(PROBE_W * PROBE_H * 4), new Float32Array(PROBE_W * PROBE_H * 4)];
const resMeta = [new Float64Array(7), new Float64Array(7)];
let resN = 0;   // number of results landed (res[(resN-1)&1] is newest)
const A_N = 64, B_N = 32;
const WIN_SP = 0.5;
let probeEvery = 1;
function probeSetup() {
  gl = renderer.getContext();
  if (!gl.PIXEL_PACK_BUFFER || !gl.getBufferSubData) { probeFailed = true; return; }
  pbo = [];
  for (let i = 0; i < PBO_RING; i++) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, PROBE_W * PROBE_H * 16, gl.STREAM_READ);
    pbo.push(b);
  }
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
}
// Called once a frame after updateOcean. ax/az: the point the player window centres on.
export function probeOcean(ax, az, bx, bz, t) {
  if (!ok || probeFailed) return;
  if (!pbo) { probeSetup(); if (probeFailed) return; }
  // Map back everything old enough, oldest first.
  while (issued - readN > PBO_LAG) {
    const slot = readN % PBO_RING, dst = resN & 1;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo[slot]);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, res[dst]);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    resMeta[dst].set(pboMeta[slot]);
    resN++; readN++;
  }
  if (issued - readN >= PBO_RING) return;
  if (frame % probeEvery) return;
  const half = A_N * WIN_SP * 0.5, halfB = B_N * WIN_SP * 0.5;
  const oax = Math.round((ax - half) / WIN_SP) * WIN_SP, oaz = Math.round((az - half) / WIN_SP) * WIN_SP;
  const obx = Math.round((bx - halfB) / WIN_SP) * WIN_SP, obz = Math.round((bz - halfB) / WIN_SP) * WIN_SP;
  const u = matProbe.uniforms;
  u.uWA.value.set(oax, oaz, WIN_SP, 0);
  u.uWB.value.set(obx, obz, WIN_SP, 0);
  u.uCamXZ.value.set(camera.position.x, camera.position.z);
  const prevRT = renderer.getRenderTarget();
  passMesh.material = matProbe;
  renderer.setRenderTarget(rtProbe);
  renderer.render(passScene, quadCam);
  const slot = issued % PBO_RING;
  try {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo[slot]);
    gl.readPixels(0, 0, PROBE_W, PROBE_H, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const m = pboMeta[slot];
    m[0] = t; m[1] = oax; m[2] = oaz; m[3] = WIN_SP; m[4] = obx; m[5] = obz; m[6] = WIN_SP;
    issued++;
  } catch (e) {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    probeFailed = true;
  }
  renderer.setRenderTarget(prevRT);
}
// Bilinear lookup in one landed result; NaN when (x, z) is outside both windows.
function lookup(r, m, x, z) {
  // window A
  let fx = (x - m[1]) / m[3], fz = (z - m[2]) / m[3];
  if (fx >= 0 && fz >= 0 && fx <= A_N - 1.001 && fz <= A_N - 1.001) return bil(r, 0, fx, fz);
  fx = (x - m[4]) / m[6]; fz = (z - m[5]) / m[6];
  if (fx >= 0 && fz >= 0 && fx <= B_N - 1.001 && fz <= B_N - 1.001) return bil(r, 64, fx, fz);
  return NaN;
}
function bil(r, xo, fx, fz) {
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const at = (ii, jj) => r[jj * PROBE_W * 4 + xo + ii];
  return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
}
export const probeStats = { hits: 0, misses: 0 };
// THE ONE CPU ANSWER: surface height (relative to SURFACE_Y) at world (x, z), time t.
export function oceanHeightAt(x, z, t) {
  if (resN > 0) {
    const n1 = (resN - 1) & 1;
    const h1 = lookup(res[n1], resMeta[n1], x, z);
    if (h1 === h1) {
      probeStats.hits++;
      if (resN > 1) {
        const n0 = resN & 1, t1 = resMeta[n1][0], t0 = resMeta[n0][0];
        const h0 = lookup(res[n0], resMeta[n0], x, z);
        const span = t1 - t0;
        if (h0 === h0 && span > 1e-3 && span < 0.25) {
          const dtE = Math.min(Math.max(t - t1, 0), 0.15);
          return h1 + (h1 - h0) * (dtE / span);
        }
      }
      return h1;
    }
  }
  probeStats.misses++;
  return analyticHeight(x, z, t);
}

// ---------------------------------------------------------------------------
// ANALYTIC FALLBACK + waveLow: the dominant components of the same spectrum.
// ---------------------------------------------------------------------------
const TOPK = 40;
const comp = new Float64Array(TOPK * 6);   // kx, kz, Re, Im (of the +k term net), w, |a|
let compN = 0, compAge = 1e9;
const _cand = new Float64Array(TOPK * 6);
function refreshComponents() {
  // Scan cascade 0's low half-plane band (where the swell and the wind-sea peak live)
  // and keep the TOPK strongest. Each half-plane bin stands for its +k/-k pair:
  // h(x,t) = 2 Re[ (h0(k) e^{-iwt} + conj(h0(-k)) e^{iwt}) e^{ik.x} ].
  const L = CASCADE_L[0], dk = 2 * Math.PI / (L * 3), R = 40;
  compN = 0;
  let minA = 0, minI = 0;
  for (let mm = 0; mm <= R; mm++) for (let nn = -R; nn <= R; nn++) {
    if (mm === 0 && nn <= 0) continue;
    const kx = nn * 2 * Math.PI / L, kz = mm * 2 * Math.PI / L, kl = Math.hypot(kx, kz);
    if (kl >= K_EDGE[1]) continue;
    const aP = Math.sqrt(0.5 * specDensity(kx / 3, kz / 3)) * dk / 3;
    const aM = Math.sqrt(0.5 * specDensity(-kx / 3, -kz / 3)) * dk / 3;
    const tot = aP + aM;
    if (compN < TOPK || tot > minA) {
      const n = (nn + N) % N, m = mm % N, ni = (N - n) % N, mi = (N - m) % N;
      const iP = (m * N + n) * 4, iM = (mi * N + ni) * 4;
      let w = Math.sqrt(GRAV * kl / 3); w = Math.floor(w / W0) * W0;
      const slot = compN < TOPK ? compN++ : minI;
      const o = slot * 6;
      _cand[o] = kx; _cand[o + 1] = kz;
      // store h0P (re, im) and h0M (re, im) packed: we keep P in 2,3 and M in 4..: use comp arrays
      _cand[o + 2] = NOISE[iP] * aP; _cand[o + 3] = NOISE[iP + 1] * aP;
      _cand[o + 4] = w; _cand[o + 5] = tot;
      compM[slot * 2] = NOISE[iM] * aM; compM[slot * 2 + 1] = NOISE[iM + 1] * aM;
      if (compN === TOPK) {
        minA = Infinity;
        for (let q = 0; q < TOPK; q++) if (_cand[q * 6 + 5] < minA) { minA = _cand[q * 6 + 5]; minI = q; }
      }
    }
  }
  comp.set(_cand);
}
const compM = new Float64Array(TOPK * 2);
// Height (and horizontal displacement into _dOut) of the component set at (x, z, t).
const _dOut = [0, 0];
function compEval(x, z, t) {
  const tw = t % T_REP;
  let h = 0, dx = 0, dz = 0;
  for (let q = 0; q < compN; q++) {
    const o = q * 6, kx = comp[o], kz = comp[o + 1], w = comp[o + 4];
    const c = Math.cos(w * tw), s = Math.sin(w * tw);
    // h0P e^{-iwt} + conj(h0M) e^{iwt}
    const pr = comp[o + 2], pi = comp[o + 3], mr = compM[q * 2], mi = -compM[q * 2 + 1];
    const hr = pr * c + pi * s + (mr * c - mi * s);
    const hi = pi * c - pr * s + (mi * c + mr * s);
    const ph = kx * x + kz * z, ec = Math.cos(ph), es = Math.sin(ph);
    const re = hr * ec - hi * es, im = hr * es + hi * ec;
    h += 2 * re;
    const kl = Math.hypot(kx, kz);
    // D = Re[i khat h e^{ikx}] * 2 = -2 im khat
    dx += -2 * im * kx / kl; dz += -2 * im * kz / kl;
  }
  _dOut[0] = dx * _chop; _dOut[1] = dz * _chop;
  return h;
}
export function analyticHeight(x, z, t) {
  if (compAge > 0.5) { refreshComponents(); compAge = 0; }
  let px = x, pz = z;
  for (let it = 0; it < 3; it++) { compEval(px, pz, t); px = x - _dOut[0]; pz = z - _dOut[1]; }
  return compEval(px, pz, t);
}
export function oceanTick(dt) { compAge += dt; }
// The two strongest components in terrain.js's (dir, k, amp, omega) caustic form:
// h = amp sin((p.d) k + w t) travels toward -d, so d is the NEGATED bearing.
export function dominantComponents(out) {
  if (compAge > 0.5 || compN === 0) { refreshComponents(); compAge = 0; }
  let i0 = -1, i1 = -1;
  for (let q = 0; q < compN; q++) {
    const a = comp[q * 6 + 5];
    if (i0 < 0 || a > comp[i0 * 6 + 5]) { i1 = i0; i0 = q; }
    else if (i1 < 0 || a > comp[i1 * 6 + 5]) i1 = q;
  }
  const put = (q, o) => {
    if (q < 0) { out[o] = 1; out[o + 1] = 0; out[o + 2] = 0.1; out[o + 3] = 0; out[o + 4] = 0; return; }
    const kx = comp[q * 6], kz = comp[q * 6 + 1], kl = Math.hypot(kx, kz);
    out[o] = -kx / kl; out[o + 1] = -kz / kl; out[o + 2] = kl;
    out[o + 3] = 2 * comp[q * 6 + 5]; out[o + 4] = comp[q * 6 + 4];
  };
  put(i0, 0); put(i1, 5);
}

// Dev surface.
if (typeof window !== 'undefined') {
  window.__ocean = {
    OCEAN, SP, stats: () => ({ ..._sea, chop: _chop, resN, issued, readN, probeFailed, fftType, ...probeStats }),
    sim: setOceanSim,
    // Compare CPU answer vs the analytic fallback at a point.
    h: (x, z, t) => ({ probe: oceanHeightAt(x, z, t), analytic: analyticHeight(x, z, t) }),
    // Dev readback of one merged texture's mean/max (allocates; never per frame).
    read(c = 0, which = 0) {
      const rt = rtMerge[c][mergeCur];
      const buf = new Uint16Array(N * N * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, N, N, buf, undefined, which);
      const h = THREE.DataUtils.fromHalfFloat;
      const s = [0, 0, 0, 0], mx = [-1e9, -1e9, -1e9, -1e9], mn = [1e9, 1e9, 1e9, 1e9];
      for (let i = 0; i < N * N; i++) for (let k = 0; k < 4; k++) {
        const v = h(buf[i * 4 + k]); s[k] += v; if (v > mx[k]) mx[k] = v; if (v < mn[k]) mn[k] = v;
      }
      return { mean: s.map(v => v / (N * N)), max: mx, min: mn };
    }
  };
}
