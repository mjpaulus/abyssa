// VOLUMETRIC SKY — raymarched clouds over a physically motivated atmosphere.
// OWNED BY: clouds/sky agent (branch `clouds`).
//
// Michael, 2026-10-01: "clouds look fake". The painted dome layer was a coverage map on a
// hemisphere and the instanced puffs were soft discs; neither has an interior, so neither
// can do what a cloud does with light. This file replaces both with the technique the AAA
// bar uses (Schneider/Nubis, Hillaire): a real participating medium marched per pixel.
//
// WHAT IS HERE
//   NOISE        generated on the GPU at boot into WebGL2 3D textures — no image files.
//                SHAPE 128^3 RGBA8: R Perlin-Worley, GBA Worley fbm at 3 frequencies.
//                DETAIL 32^3 RGBA8: Worley fbm at 3 frequencies (erosion).
//                NOISE2 256^2: R tileable 2D fbm, GB curl of it (erosion distortion, cirrus).
//   WEATHER MAP  512^2, regenerated every frame from the day hand (coverage / type /
//                density) in a 48k-unit window around the camera. Fields are PURE
//                FUNCTIONS of the hand and the weather clock, so the same hand at the same
//                hour is the same sky. The day boundary cross-fades the two days' fields.
//   ATMOSPHERE   single scattering Rayleigh + Mie + ozone, plus a multiple-scattering
//                lift, integrated on the CPU into a 48x40 sky-view LUT (azimuth relative
//                to the sun x elevation, horizon-dense) and recomputed only when the
//                sun's atmospheric elevation or the haze moves. The Mie phase is applied
//                per pixel so the aureole stays sharp. The whole LUT is normalised to the
//                authored palette's luminance (GLASS.stops) so the game's exposure regime,
//                the underwater Snell's window and the night floor keep their tuned energy
//                — the physics decides the SHAPE and the COLOUR, the palette the LEVEL.
//                The CPU copy is also what feeds the airlight (abyssaAir) the fog chunk and
//                the far sea converge on, so the horizon is ONE number and it is weather.
//   CLOUDS       spherical-shell layer, Beer-Lambert + powder, dual-lobe HG phase,
//                Wrenninge multiple-scattering octaves, 6-step light march, ambient from
//                the sky LUT, curl-distorted Worley erosion, per-type height gradients,
//                lightning lighting the inside of the deck, cirrus plane above.
//                Marched into a target held at a PIXEL BUDGET (VSKY.marchPx, ~360k: about
//                third-res at a 3 MP internal frame), IGN-jittered, temporally accumulated in a
//                low-res history (direction reprojection: the layer is hundreds of units
//                away, so camera rotation is the only motion that matters).
//   COMPOSITE    the background dome samples the history by projecting its own view
//                direction (so it is right under TAA jitter, in the refraction pass and
//                at any target size), and draws sky*T + S. The dome is the last opaque
//                draw and depth-tested, so the raft, Sal and the sea occlude correctly
//                with no depth work here at all.
//   PANORAMA     256x64 upper-hemisphere sky+cloud radiance (rgb) + cloud transmittance
//                (a), refreshed in strips. getSkyEnv() exports it for reflections, and
//                the sky env cube capture renders from it.
//   SHADOWS      256^2 top-down sun transmittance through the deck over 4096 units round
//                the camera. getCloudShadow() exports it; the deck key light reads the raft
//                texel back through a fence-free PBO ring (airAmbience.sunVis).
//
// Discipline: zero per-frame allocation (all temps module scope), no THREE light, every
// program compiled at boot (warmUp), no backticks in GLSL comments, no reversed
// smoothstep edges. window.__vsky is the debug surface.
import * as THREE from 'three';
import { camera, renderer } from '../core.js';
import { SUN, SKY, GLASS } from '../config.js';
import * as W from './water.js';

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------------------------------------------------------------------------------------
// TUNING. Live through window.__vsky.V.
// ---------------------------------------------------------------------------------------
export const VSKY = {
  on: 1,               // 0 = the shipped painted sky + puffs path (A/B)
  div: 2,              // minimum march resolution divisor
  marchPx: 360000,     // pixel budget of the march target: the divisor rises to hold it (degrade lowers it)
  steps: 52,           // view steps through the shell
  lsteps: 6,           // light-march steps
  base: 230,           // cloud base altitude (world units, 1 u = 3 m) in fair weather
  baseStorm: 130,      // ... under a full storm (the bolts leave the deck at ~95)
  thick: 560,          // shell thickness
  planetR: 2.12e6,     // earth radius in units: the shell curves away at the horizon
  maxDist: 26000,      // march cap
  shapeTile: 1500,     // world units per shape-noise tile
  detailTile: 150,      // world units per detail-noise tile
  detailK: 0.6,       // erosion strength
  curlK: 0.25,         // curl distortion of the erosion (in detail texels)
  dens: 0.13,          // extinction per unit at density 1
  gain: 1.7,           // lit-cloud level relative to the palette horizon
  horK: 0.72,          // physical horizon set to this share of the palette's horizon
  ambK: 0.4,           // sky-ambient gain on clouds
  powder: 0.8,        // powder darkening of thin edges away from the sun
  g1: 0.66, g2: -0.20, gMix: 0.25,     // dual-lobe Henyey-Greenstein
  msA: 0.42, msB: 0.40, msC: 0.45,      // multiple-scattering octave attenuation
  haze: 11000,         // aerial perspective length for the cloud field (fair, dry air)
  drift: 5.0,          // cloud drift units/s at wind 1
  cirrus: 0.6,         // cirrus gain (hand.sunsetDrama sets the amount)
  history: 0.12,       // temporal blend (new sample weight)
  stars: 1.0,
  edgeLo: 0.05, edgeHi: 0.45,   // cloud edge ramp (crisper silhouettes)
  knee: 0.12,          // soft knee on scattered light (silver lining energy)
  duskDesat: 0.48,     // sky saturation taken out at a low sun (brass-age, not neon)
  rain: 1.0,           // rain-shaft gain under storm cores
  scud: 1.0,           // torn scud under a storm base
  stormHor: 0.4,       // how much the gale darkens the horizon airlight
  stormHaze: 0.55,     // how much darker the air in front of a gale's deck is than its horizon
  stormDim: 0.75,      // share of the deck's light a gale takes away
  boltK: 0.35,         // lightning glow inside the deck per unit of bolt light
  lightSat: 0.42,      // saturation kept in the low sun's colour on the clouds
  discR: 0.0085,       // sun disc angular radius, rad (a touch over the real 0.0047)
  discI: 9.0           // disc radiance relative to the normalised sky
};

// ---------------------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------------------
let built = false;
let shapeRT = null, detailRT = null, noise2RT = null, weatherRT = null;
let curRT = null, histRT = [null, null], hist = 0, panoRT = null, shadowRT = null, probeRT = null;
let skyRTex = null, skyMTex = null;
let fsGeo = null, fsCam = null;
let genScene = null, genMesh = null;
let matShapeGen, matDetailGen, matNoise2Gen, matWeather, matMarch, matResolve, matShadow, matProbe;
let qWeather, qMarch, qResolve, qShadow, qProbe;
let histValid = false, frameN = 0, panoStrip = 0, lastW = 0, lastH = 0;
let bootMs = 0, genMs = 0;
const hand = { ref: null };
let wxClock = 0, wxStorm = 0, wxDay = 1;
const _v3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4();
const _size = new THREE.Vector2();
const stats = { lutMs: 0, lutN: 0, cov: 0, sunVis: 1, physElev: 0, K: 1, hazeMul: 1, skipped: '' };

// ---------------------------------------------------------------------------------------
// GLSL: shared helpers
// ---------------------------------------------------------------------------------------
const GLSL_HASH = `
vec3 vhash33( vec3 p ){
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
vec2 vhash22( vec2 p ){
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}
float vhash12( vec2 p ){
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float vremap( float x, float a, float b, float c, float d ){ return c + ( x - a ) / ( b - a ) * ( d - c ); }
`;

const VERT_FS = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

// --- noise generation (boot only) ---
const GEN_COMMON = `
precision highp float;
${GLSL_HASH}
varying vec2 vUv;
uniform float uZ;
// Tileable gradient noise: the lattice wraps at per.
float gnoise( vec3 p, float per ){
  vec3 i = floor( p ), f = fract( p );
  vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float n[8];
  for ( int k = 0; k < 8; k++ ) {
    vec3 o = vec3( float( k & 1 ), float( ( k >> 1 ) & 1 ), float( ( k >> 2 ) & 1 ) );
    vec3 g = normalize( vhash33( mod( i + o, per ) ) * 2.0 - 1.0 );
    n[k] = dot( g, f - o );
  }
  return mix( mix( mix( n[0], n[1], u.x ), mix( n[2], n[3], u.x ), u.y ),
              mix( mix( n[4], n[5], u.x ), mix( n[6], n[7], u.x ), u.y ), u.z );
}
// Inverted F1 Worley, tileable, one feature point per cell.
float worley( vec3 p, float per ){
  vec3 i = floor( p ), f = fract( p );
  float d = 1.0e9;
  for ( int z = -1; z <= 1; z++ ) for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    vec3 o = vec3( float( x ), float( y ), float( z ) );
    vec3 r = o + vhash33( mod( i + o, per ) ) - f;
    d = min( d, dot( r, r ) );
  }
  return 1.0 - clamp( sqrt( d ), 0.0, 1.0 );
}
float wfbm( vec3 p, float f ){
  return worley( p * f, f ) * 0.625 + worley( p * f * 2.0, f * 2.0 ) * 0.25 + worley( p * f * 4.0, f * 4.0 ) * 0.125;
}
float pfbm( vec3 p, float f ){
  float s = 0.0, a = 1.0, n = 0.0;
  for ( int o = 0; o < 5; o++ ) { s += a * gnoise( p * f, f ); n += a; a *= 0.5; f *= 2.0; }
  return s / n;
}`;

const SHAPE_FRAG = `${GEN_COMMON}
void main(){
  vec3 p = vec3( vUv, uZ );
  // Perlin fbm sharpened toward 0..1, then dilated by the Worley fbm (Schneider's
  // Perlin-Worley): billowy connected cells instead of the Perlin's tubes.
  float pn = clamp( pfbm( p, 4.0 ) * 1.35 + 0.5, 0.0, 1.0 );
  float w4 = wfbm( p, 4.0 );
  float pw = clamp( vremap( pn, w4 - 1.0, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
  gl_FragColor = vec4( pw, w4, wfbm( p, 8.0 ), wfbm( p, 16.0 ) );
}`;

const DETAIL_FRAG = `${GEN_COMMON}
void main(){
  vec3 p = vec3( vUv, uZ );
  gl_FragColor = vec4( wfbm( p, 2.0 ), wfbm( p, 4.0 ), wfbm( p, 8.0 ), 1.0 );
}`;

const NOISE2_FRAG = `${GEN_COMMON}
float n2( vec2 q ){ return pfbm( vec3( q, 0.37 ), 4.0 ); }
void main(){
  // R: tileable fbm (period 1). GB: its curl, packed to 0..1. A: a stretched copy for cirrus.
  float e = 1.0 / 256.0;
  float c = n2( vUv );
  float dx = ( n2( vUv + vec2( e, 0.0 ) ) - n2( vUv - vec2( e, 0.0 ) ) ) / ( 2.0 * e );
  float dy = ( n2( vUv + vec2( 0.0, e ) ) - n2( vUv - vec2( 0.0, e ) ) ) / ( 2.0 * e );
  vec2 curl = vec2( dy, -dx ) * 0.08;
  float w = worley( vec3( vUv * vec2( 6.0, 6.0 ), 0.5 ), 6.0 );
  gl_FragColor = vec4( c * 0.5 + 0.5, clamp( curl * 0.5 + 0.5, 0.0, 1.0 ), w );
}`;

// --- weather map (every frame) ---
// R coverage 0..1, G type (0 stratus .. 0.5 cumulus .. 1 cumulonimbus), B density scale.
const WEATHER_FRAG = `
precision highp float;
${GLSL_HASH}
varying vec2 vUv;
uniform vec4 uWin;       // centre x, centre z, window size, day blend (0 = yesterday, 1 = today)
uniform vec4 uA, uB;     // per day: cover, type, layers, seed
uniform vec4 uAo, uBo;   // per day: drift offset xz, seed offset xz
uniform vec4 uSt;        // storm, density gain, fog, -
float vn2( vec2 p ){
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( vhash12( i ), vhash12( i + vec2( 1, 0 ) ), u.x ),
              mix( vhash12( i + vec2( 0, 1 ) ), vhash12( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float fbm2w( vec2 p ){
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 4; i++ ) { s += a * vn2( p ); p = p * 2.03 + vec2( 17.1, 9.3 ); a *= 0.5; }
  return s / 0.9375;
}
// One cumulus "cell" field: soft islands at the scale of single clouds.
float cells( vec2 p ){
  vec2 i = floor( p ), f = fract( p );
  float d = 9.0;
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    vec2 o = vec2( float( x ), float( y ) );
    vec2 r = o + vhash22( i + o ) * 0.85 - f;
    d = min( d, dot( r, r ) );
  }
  return 1.0 - clamp( sqrt( d ), 0.0, 1.0 );
}
vec3 field( vec2 xz, vec4 P, vec4 O ){
  vec2 q = xz + O.xy + O.zw;
  float big = fbm2w( q / 9500.0 );                 // weather systems
  float cl = cells( q / 1350.0 ) * 0.65 + fbm2w( q / 2400.0 + 3.7 ) * 0.35;   // clouds
  float cover = P.x;
  // Coverage: a threshold on the combined field that walks from a few isolated clumps
  // (cover 0.1) to an unbroken deck (cover 1). The big field biases WHERE.
  float m = cl * 0.62 + big * 0.38;
  float thr = 0.655 - cover * 0.43;
  // a high-frequency tear so no cloud is a smooth ellipse in plan
  m += ( fbm2w( q / 520.0 + 7.1 ) - 0.5 ) * 0.22;
  // a RAMP, not a plateau: coverage keeps climbing toward a cloud's middle, which (with
  // the coverage-scaled height in the march) is what domes the crowns instead of
  // cutting every cumulus off at one flat lid height
  float c = smoothstep( thr - 0.08, thr + 0.30, m );
  // Coverage INSIDE a cloud stays under 1 on fair days, so the 3D noise carves it into
  // towers and bites; only an overcast deck runs solid.
  c *= mix( 0.74, 1.0, smoothstep( 0.55, 0.95, cover ) );
  // OVERCAST is a closed deck but not a sheet: thick rolls and thin troughs at the
  // kilometre scale, which the lid light reads as grey structure.
  float ov = smoothstep( 0.60, 0.90, cover );
  c *= mix( 1.0, mix( 0.55, 1.0, smoothstep( 0.30, 0.75, fbm2w( q / 1300.0 + 51.0 ) ) ), ov );
  // Type: cumulus by default, stratus where the day carries a low deck (layers), more
  // towering on the humid days (P.y), a little spatial variety.
  float tv = fbm2w( q / 7000.0 + 11.0 );
  float ty = clamp( P.y + ( tv - 0.5 ) * 0.5, 0.0, 1.0 );
  float lowDeck = P.z * smoothstep( 0.45, 0.70, fbm2w( q / 5200.0 + 23.0 ) );
  ty = mix( ty, 0.08, lowDeck );
  c = max( c, lowDeck * 0.85 * smoothstep( 0.35, 0.75, cl ) );
  return vec3( c, ty, 1.0 );
}
void main(){
  vec2 xz = uWin.xy + ( vUv - 0.5 ) * uWin.z;
  vec3 a = field( xz, uA, uAo );
  vec3 b = uWin.w < 0.999 ? field( xz, uB, uBo ) : a;
  vec3 f = mix( b, a, uWin.w );
  // THE LID. The storm envelope closes the deck, lowers it (in the march), towers it and
  // thickens it; the gale is one dark unbroken nimbostratus with cumulonimbus cores.
  float s = uSt.x;
  float core = smoothstep( 0.45, 0.8, fbm2w( ( xz + uAo.xy ) / 3800.0 + 41.0 ) );
  // The lid is closed but NOT uniform: coverage under 1 between the cores lets the 3D
  // noise carve the base into rolls and the top into domes, so the underside has the
  // thick/thin structure that light from above reads through.
  float roll = fbm2w( ( xz + uAo.xy ) / 1100.0 + 13.0 );
  f.r = mix( f.r, mix( 0.52, 1.0, max( core, smoothstep( 0.35, 0.75, roll ) * 0.7 ) ), smoothstep( 0.15, 0.85, s ) );
  f.g = mix( f.g, mix( 0.50, 1.0, core ), smoothstep( 0.2, 0.9, s ) );
  f.b = 1.0 + s * ( 0.25 + 0.9 * core );
  // Marine fog days: a flat low stratus sheet takes the place of the cumulus.
  f.g = mix( f.g, 0.0, uSt.z );
  // A: BASE LIFT, the share of the shell the cloud base is raised by. A fair deck's bases
  // are nearly level (the condensation level is one height); a storm's underside hangs in
  // rolls and scud, which is most of what reads as weather from beneath it.
  float lift = fbm2w( ( xz + uAo.xy ) / 900.0 + 31.0 );
  float bl = mix( 0.03, 0.22, max( smoothstep( 0.2, 0.9, s ), 0.6 * smoothstep( 0.6, 0.9, uA.x ) ) ) * lift;
  gl_FragColor = vec4( f, bl );
}`;

// --- atmosphere (shared: dome + pano) ---
export const GLSL_VOL_ATMO = `
uniform sampler2D tSkyR, tSkyM;
uniform vec4 uAtmo;       // K, LUT cols, LUT rows, mie g
uniform vec3 uAtmoSunXZ;  // physical sun azimuth (x, z) and its elevation sine
uniform vec3 uVolSun;     // displayed sun direction (SUN.dir)
uniform vec3 uPalHor, uPalZen;   // the authored palette's ring, for the night hand-over
uniform float uNightMix;         // 0 = physical sky, 1 = the palette's night gradient
uniform float uSkySat;           // sky saturation (dusk restraint)
float vMiePhase( float mu, float g ){
  float g2 = g * g;
  return 3.0 / ( 8.0 * 3.14159265 ) * ( ( 1.0 - g2 ) * ( 1.0 + mu * mu ) )
       / ( ( 2.0 + g2 ) * pow( max( 1.0 + g2 - 2.0 * g * mu, 1.0e-4 ), 1.5 ) );
}
vec2 vSkyUv( vec3 d ){
  float el = asin( clamp( d.y, -1.0, 1.0 ) );
  float v = sqrt( clamp( ( el + 0.0349 ) / ( 1.5708 + 0.0349 ), 0.0, 1.0 ) );
  vec2 h = d.xz; float hl = length( h );
  float ca = hl > 1.0e-5 ? dot( h / hl, uAtmoSunXZ.xy ) : 1.0;
  float a = acos( clamp( ca, -1.0, 1.0 ) ) / 3.14159265;
  return vec2( ( a * ( uAtmo.y - 1.0 ) + 0.5 ) / uAtmo.y, ( v * ( uAtmo.z - 1.0 ) + 0.5 ) / uAtmo.z );
}
vec3 vAtmo( vec3 d ){
  vec2 uv = vSkyUv( d );
  vec3 R = texture2D( tSkyR, uv ).rgb, M = texture2D( tSkyM, uv ).rgb;
  float mu = dot( d, uVolSun );
  vec3 c = ( R + M * vMiePhase( mu, uAtmo.w ) ) * uAtmo.x;
  c = mix( vec3( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ), c, uSkySat );
  if ( uNightMix > 0.001 ) {
    // NIGHT: with the sun far under the horizon the single-scatter model has nothing left
    // but numerical residue; the sky is moonlight and airglow, which the palette authors.
    float up = clamp( d.y, 0.0, 1.0 );
    float hz = 1.0 - up; hz *= hz; hz *= hz * ( 1.0 - up );
    c = mix( c, mix( uPalHor, uPalZen, 1.0 - hz ), uNightMix );
  }
  return c;
}`;

// --- the march ---
const MARCH_FRAG = `
precision highp float;
precision highp sampler3D;
${GLSL_HASH}
${GLSL_VOL_ATMO}
varying vec2 vUv;
uniform sampler3D tShape, tDetail;
uniform sampler2D tWeather, tNoise2;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform vec3 uCamPos;
uniform vec4 uLayer;     // base, thickness, planet R, max distance
uniform vec4 uWin;       // weather window centre x, z, 1/size, frame
uniform vec4 uScale;     // 1/shapeTile, 1/detailTile, detailK, density
uniform vec4 uWind;      // shape offset xz, detail offset xz
uniform vec4 uEvo;       // evolve, curlK, powder, pixel angle
uniform vec3 uLightDir, uLightCol, uAmbTop, uAmbBot;
uniform vec4 uPhase;     // g1, g2, mix, haze length
uniform vec4 uMS;        // a, b, c, ambient gain
uniform vec4 uSteps;     // view steps, light steps, pano mode, -
uniform vec4 uBolt0, uBolt1;
uniform vec3 uBoltCol;
uniform vec4 uCirrus;    // amount, altitude, -, -
uniform vec2 uCirrusOff;
uniform vec4 uStorm;     // storm, rain amount, scud amount, lid amount
uniform vec2 uSharp;
uniform vec4 uEvo2;      // scatter knee, -, -, -     // edge ramp: density below x is cut, full body by y
uniform vec3 uHazeCol;   // the air between the eye and a closed deck (lid aerial perspective)

float hgrad( float h, float ty ){
  float st = smoothstep( 0.0, 0.05, h ) * ( 1.0 - smoothstep( 0.09, 0.22, h ) );
  float cu = smoothstep( 0.0, 0.08, h ) * ( 1.0 - smoothstep( 0.32, 0.72, h ) );
  float cb = smoothstep( 0.0, 0.07, h ) * ( 1.0 - smoothstep( 0.66, 0.98, h ) );
  return ty < 0.5 ? mix( st, cu, ty * 2.0 ) : mix( cu, cb, ty * 2.0 - 1.0 );
}
vec4 wAt( vec2 xz ){ return textureLod( tWeather, ( xz - uWin.xy ) * uWin.z + 0.5, 0.0 ); }
float altOf( vec3 p ){
  vec2 r = p.xz - uCamPos.xz;
  return p.y + dot( r, r ) / ( 2.0 * uLayer.z );
}
float density( vec3 p, float h, vec4 w, float lod, bool full ){
  float cov = w.r;
  if ( cov < 0.01 || h < 0.0 || h > 1.0 ) return 0.0;
  vec3 q = p * uScale.x + vec3( uWind.x, uEvo.x, uWind.y );
  vec4 s = textureLod( tShape, q, lod );
  float lf = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  float base = vremap( s.r, lf - 1.0, 1.0, 0.0, 1.0 );
  base *= hgrad( ( h - w.a ) / ( ( 1.0 - w.a ) * mix( 0.35, 1.0, clamp( cov * 1.4, 0.0, 1.0 ) ) ), w.g );
  base = clamp( vremap( base, 1.0 - cov, 1.0, 0.0, 1.0 ), 0.0, 1.0 ) * cov;
  if ( base <= 0.0 ) return 0.0;
  if ( full ) {
    // curl distortion: sampled on a slanted plane so it varies in y too, and NOT scaled by
    // height (a height-scaled shift shears the noise into vertical streaks)
    vec2 cu = texture2D( tNoise2, ( p.xz + p.y * vec2( 0.61, -0.47 ) ) * uScale.y * 0.2 ).gb * 2.0 - 1.0;
    vec3 dq = p * uScale.y + vec3( uWind.z, uEvo.x * 3.0, uWind.w ) + vec3( cu.x, cu.x * cu.y, cu.y ) * uEvo.y;
    vec3 dn = textureLod( tDetail, dq, max( 0.0, lod - 1.0 ) ).rgb;
    float hf = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    // SECOND DETAIL OCTAVE at 2.9x (rotated so the two lattices never align): the
    // small cauliflower lobes on the lobes. Faded out with distance, where it would only
    // alias.
    float o2 = textureLod( tDetail, dq.zxy * 2.9 + 0.37, max( 0.0, lod ) ).r;
    hf = mix( hf, hf * 0.68 + o2 * 0.32, clamp( 1.5 - lod * 0.5, 0.0, 1.0 ) );
    // wispy at the base, billowy on the crown
    float hfm = mix( hf, 1.0 - hf, clamp( h * 6.0, 0.0, 1.0 ) );
    base = clamp( vremap( base, hfm * uScale.z, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
    // EDGE: a steeper ramp from nothing to body, so silhouettes are cut, not fogged
    base = clamp( ( base - uSharp.x ) / ( uSharp.y - uSharp.x ), 0.0, 1.0 );
  }
  return base * w.b;
}
float hg( float mu, float g ){
  float g2 = g * g;
  return ( 1.0 - g2 ) / pow( max( 1.0 + g2 - 2.0 * g * mu, 1.0e-4 ), 1.5 );   // times 4 pi
}
// Stable inside-out ray / sphere distance: R^2 - rc^2 is formed as a product of
// differences, never as a difference of two 4e12 squares (float32 would lose it all).
float shellT( float b, float rc, float altR ){
  float k = ( altR - ( rc - uLayer.z ) ) * ( altR + rc + uLayer.z );   // R^2 - rc^2 with R = planet + altR
  return k / ( b + sqrt( max( b * b + k, 0.0 ) ) );
}
float ign( vec2 px ){ return fract( 52.9829189 * fract( dot( px, vec2( 0.06711056, 0.00583715 ) ) ) ); }

vec3 rayDir(){
  if ( uSteps.z > 0.5 ) {
    // PANORAMA: upper hemisphere, v = sqrt( elevation sine ) packs rows at the horizon.
    float ph = ( vUv.x - 0.5 ) * 6.28318531;
    float y = vUv.y * vUv.y;
    float r = sqrt( max( 0.0, 1.0 - y * y ) );
    return vec3( cos( ph ) * r, y, sin( ph ) * r );
  }
  vec4 v = uInvProj * vec4( vUv * 2.0 - 1.0, 1.0, 1.0 );
  return normalize( uCamRot * ( v.xyz / v.w ) );
}

void main(){
  vec3 dir = rayDir();
  vec4 res = vec4( 0.0, 0.0, 0.0, 1.0 );
  float cy = uCamPos.y;
  if ( dir.y > -0.015 && cy < uLayer.x ) {
    // UNDER THE DECK (storm only): rain shafts hanging from the base where the weather
    // map carries the storm's cores, and torn scud a little under the base. Front of
    // the shell, so it is integrated first; nothing here runs on a fair day.
    if ( uStorm.y > 0.01 || uStorm.z > 0.01 ) {
      float tb = dir.y > 0.002 ? ( uLayer.x - cy ) / dir.y : 1.0e9;
      float tEnd = min( tb, 5000.0 );
      float N2 = 12.0;
      float dt2 = ( tEnd - 30.0 ) / N2;
      float t2 = 30.0 + dt2 * fract( ign( gl_FragCoord.yx ) + uWin.w * 0.75487767 );
      vec3 rainCol = uHazeCol * 0.72;   // a curtain reads DARKER than the lit air behind it
      for ( int i = 0; i < 12; i++ ) {
        vec3 p = uCamPos + dir * t2;
        float alt = altOf( p );
        vec4 w = wAt( p.xz );
        float core = clamp( ( w.b - 1.0 - 0.25 * uStorm.x ) / ( 0.9 * uStorm.x + 1.0e-3 ), 0.0, 1.0 );
        // curtains: a streak field in plan, constant in height, so it hangs as sheets
        vec2 sp = ( p.xz + uWind.xy * 900.0 ) / 260.0;
        float streak = texture2D( tNoise2, sp * vec2( 2.6, 0.45 ) ).r * 0.7 + texture2D( tNoise2, sp * 0.31 ).r * 0.3;
        // fine striation, constant in height: averaged by distance it is the vertical
        // grain of a curtain rather than a smudge
        float fine = texture2D( tNoise2, sp * vec2( 11.0, 7.0 ) ).r;
        float rain = uStorm.y * smoothstep( 0.30, 0.75, core ) * smoothstep( 0.50, 0.62, streak ) * smoothstep( 0.35, 0.65, fine ) * 0.6
             * ( 1.0 - smoothstep( uLayer.x - 90.0, uLayer.x + 10.0, alt ) ) * 0.0045;
        // scud: torn low fragments in a band under the base, dark, wind-torn
        float band = smoothstep( uLayer.x - 75.0, uLayer.x - 45.0, alt ) * ( 1.0 - smoothstep( uLayer.x - 25.0, uLayer.x - 5.0, alt ) );
        float scud = 0.0;
        if ( band > 0.0 && uStorm.z > 0.01 ) {
          vec3 dq = p / 190.0 + vec3( uWind.z, 0.0, uWind.w ) * 0.4;
          vec3 dn3 = textureLod( tDetail, dq, 0.0 ).rgb;
          float sh = textureLod( tShape, p / 1100.0 + vec3( uWind.x, 0.3, uWind.y ), 0.0 ).g;
          scud = uStorm.z * band * smoothstep( 0.62, 0.82, sh * 0.6 + dn3.r * 0.4 ) * 0.03;
        }
        float sig = rain + scud;
        if ( sig > 1.0e-5 ) {
          vec3 Lr = mix( rainCol, uAmbBot * 0.7 + uLightCol * 0.08, scud / max( sig, 1.0e-6 ) );
          float Ts = exp( -sig * dt2 );
          res.rgb += res.a * Lr * ( 1.0 - Ts );
          res.a *= Ts;
        }
        t2 += dt2;
      }
    }
    float rc = uLayer.z + cy;
    float b = dir.y * rc;
    float t0 = shellT( b, rc, uLayer.x );
    float t1 = min( shellT( b, rc, uLayer.x + uLayer.y ), uLayer.w );
    if ( t1 > t0 ) {
      float N = uSteps.x;
      float dt = ( t1 - t0 ) / N;
      float j = fract( ign( gl_FragCoord.xy ) + uWin.w * 0.61803399 );
      float t = t0 + dt * j;
      float mu = dot( dir, uLightDir );
      float lStep = uLayer.y * 0.055;
      float dsum = 0.0;
      for ( int i = 0; i < 128; i++ ) {
        if ( float( i ) >= N ) break;
        vec3 p = uCamPos + dir * t;
        float h = ( altOf( p ) - uLayer.x ) / uLayer.y;
        vec4 w = wAt( p.xz );
        if ( w.r > 0.01 && h >= 0.0 && h <= 1.0 ) {
          float lod = max( 0.0, log2( t * uEvo.w * uScale.x * 128.0 ) );
          float dn = density( p, h, w, lod, true );
          if ( dn > 0.002 ) {
            // LIGHT MARCH: geometric steps toward the light, shape only.
            float od = 0.0, ls = lStep, lt = ls * 0.5;
            for ( int k = 0; k < 8; k++ ) {
              if ( float( k ) >= uSteps.y ) break;
              vec3 q = p + uLightDir * lt;
              float hq = ( altOf( q ) - uLayer.x ) / uLayer.y;
              // the first two steps carry the eroded detail: small-scale self-shadow is
              // what puts the crevices between the cauliflower lobes
              od += density( q, hq, wAt( q.xz ), k < 2 ? lod : lod + 1.0, k < 2 ) * ls;
              ls *= 1.6; lt += ls;
            }
            od *= uScale.w;
            // MULTIPLE SCATTERING (Wrenninge): each octave sees less extinction and a
            // softer phase, which is what turns a lit cloud from a ball of soot with a
            // white rim into a bright body.
            float sc = 0.0, a = 1.0, bb = 1.0, cc = 1.0;
            for ( int o = 0; o < 4; o++ ) {
              float pho = mix( hg( mu, uPhase.x * cc ), hg( mu, uPhase.y * cc ), uPhase.z );
              sc += a * pho * exp( -od * bb );
              a *= uMS.x; bb *= uMS.y; cc *= uMS.z;
            }
            // ENERGY: the forward lobe is a 30x spike in 4 pi units; through thin edges
            // stacked over many steps it clipped the low sun's hole to a flat white. A soft
            // knee keeps the lining bright and the hole shaped.
            sc = sc / ( 1.0 + sc * uEvo2.x );
            // POWDER: thin cloud seen away from the sun lacks the in-scatter that
            // builds up inside a thick body, so its sunlit faces read darker at the edge.
            float pw = 1.0 - uEvo.z * exp( -dn * uScale.w * 90.0 );
            pw = mix( pw, 1.0, smoothstep( 0.2, 0.95, mu ) );
            float sigma = dn * uScale.w;
            // AMBIENT: sky light from above, dimmed by how much cloud stands over this
            // point (the light march is a fair proxy while the light is high), plus the
            // sea's dull mirror from below. This is what gives a closed lid its rolls.
            // one cheap probe a fifth of the shell straight up: the cloud standing over
            // this point, which is what darkens a hanging roll against the thin lid round it
            vec3 qa = p + vec3( 0.0, uLayer.y * 0.2, 0.0 );
            float da = density( qa, h + 0.2, w, lod + 1.0, false );
            float above = exp( -od * 0.006 ) * exp( -da * uScale.w * uLayer.y * 0.35 );
            vec3 amb = ( uAmbTop * clamp( h * 1.2 + 0.25, 0.0, 1.0 ) * ( 0.25 + 0.75 * above )
                       + uAmbBot * ( 1.0 - h ) ) * uMS.w;
            // diffuse transmission through a thick body (1 / (1 + 0.75 tau (1 - g)))
            sc += 0.25 / ( 1.0 + 0.09 * od );
            vec3 Ls = uLightCol * sc * pw + amb;
            // UNDER A LID the sun is everywhere above and nowhere direct: light diffuses
            // DOWN through the deck and arrives in proportion to how thin the column
            // overhead is (diffuse transmission, not Beer). That is the rolling bright /
            // dark structure of a storm's underside. uSteps.w is the lid amount.
            // The response is steep on purpose: a thin patch glows, a hanging core goes near
            // black, and that contrast is the menace (a diffusion 1/(1+k tau) curve is too
            // flat and read as a pale sheet).
            if ( uStorm.w > 0.01 ) {
              float odUp = da * uScale.w * uLayer.y * 0.9 * ( 1.0 - h ) + dn * uScale.w * uLayer.y * 0.25;
              // brighter toward the hidden sun: the dark-to-lit gradient across a gale's lid
              float sunSide = 0.55 + 0.9 * smoothstep( -0.2, 0.9, mu );
              Ls += ( uLightCol * 1.2 * sunSide + uAmbTop * 1.1 ) * ( uStorm.w * exp( -odUp * 0.028 ) );
            }
            // LIGHTNING from inside the deck: the two live bolt slots, inverse-square
            // with a floor, as isotropic in-scatter.
            // One occlusion tap a third of the way back toward the channel: cloud between
            // the stroke and this sample shades it, so the flash lights LOBES, not a ball.
            if ( uBolt0.w > 0.0 ) {
              vec3 r = p - uBolt0.xyz; float rl = length( r );
              vec3 q = mix( p, uBolt0.xyz, 0.35 );
              float dq = density( q, ( altOf( q ) - uLayer.x ) / uLayer.y, wAt( q.xz ), lod, true );
              Ls += uBoltCol * uBolt0.w * exp( -dq * uScale.w * min( rl, 500.0 ) * 0.9 ) / ( 1.0 + rl * rl / 30000.0 );
            }
            if ( uBolt1.w > 0.0 ) {
              vec3 r = p - uBolt1.xyz; float rl = length( r );
              vec3 q = mix( p, uBolt1.xyz, 0.35 );
              float dq = density( q, ( altOf( q ) - uLayer.x ) / uLayer.y, wAt( q.xz ), lod + 1.0, false );
              Ls += uBoltCol * uBolt1.w * exp( -dq * uScale.w * min( rl, 500.0 ) * 0.9 ) / ( 1.0 + rl * rl / 30000.0 );
            }
            float Ts = exp( -sigma * dt );
            res.rgb += res.a * Ls * ( 1.0 - Ts );
            dsum += res.a * ( 1.0 - Ts ) * t;
            res.a *= Ts;
            if ( res.a < 0.012 ) break;
          }
        }
        t += dt;
      }
      // AERIAL PERSPECTIVE: far cloud dissolves into the sky behind it (which already
      // carries the atmosphere's own haze), so S fades and T rises toward 1.
      float op = 1.0 - res.a;
      if ( op > 1.0e-3 ) {
        float dm = dsum / op;
        float hz = 1.0 - exp( -dm / uPhase.w );
        // Fair sky: far cloud dissolves into the sky behind it. Under a LID there is no sky
        // behind it: the far deck sinks into the dark air in front of it instead, and
        // stays opaque (revealing the bright storm horizon is what made the gale pale).
        float k = uStorm.w;
        res.rgb = res.rgb * ( 1.0 - hz ) + uHazeCol * ( op * hz * k );
        res.a = 1.0 - op * ( 1.0 - hz * ( 1.0 - k ) );
      }
      if ( res.a < 0.02 ) res.a = 0.0;
    }
    // CIRRUS: a thin sheet far above, streaked along the wind, catching the low sun.
    if ( uCirrus.x > 0.002 && dir.y > 0.012 && res.a > 0.0 ) {
      float tc = ( uCirrus.y - cy ) / dir.y;
      vec2 pc = ( uCamPos.xz + dir.xz * tc + uCirrusOff ) / 9000.0;
      vec4 nz = texture2D( tNoise2, pc * vec2( 1.0, 0.22 ) );
      float c2 = texture2D( tNoise2, pc * vec2( 7.0, 1.2 ) + nz.gb * 0.6 ).r;
      float cd = smoothstep( 0.55, 0.80, nz.r * 0.55 + c2 * 0.45 ) * smoothstep( 0.35, 0.7, c2 ) * uCirrus.x;
      cd *= smoothstep( 0.012, 0.12, dir.y ) * exp( -tc / 60000.0 );
      vec3 cs = uLightCol * ( 0.35 + 0.65 * hg( dot( dir, uLightDir ), 0.6 ) * 0.25 ) + uAmbTop * 0.6;
      res.rgb += res.a * cs * cd;
      res.a *= 1.0 - cd;
    }
  }
  if ( uSteps.z > 0.5 ) {
    // The pano carries the whole sky: atmosphere behind the clouds, alpha = cloud T.
    gl_FragColor = vec4( vAtmo( dir ) * res.a + res.rgb, res.a );
  } else {
    gl_FragColor = res;
  }
}`;

// --- temporal resolve (low res) ---
const RESOLVE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tCur, tHist;
uniform mat4 uInvProj, uPrevVP;
uniform mat3 uCamRot;
uniform vec4 uRes;       // 1/w, 1/h, blend, history valid
void main(){
  vec4 c = texture2D( tCur, vUv );
  vec4 mn = c, mx = c;
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    if ( x == 0 && y == 0 ) continue;
    vec4 s = texture2D( tCur, vUv + vec2( float( x ), float( y ) ) * uRes.xy );
    mn = min( mn, s ); mx = max( mx, s );
  }
  vec4 v = uInvProj * vec4( vUv * 2.0 - 1.0, 1.0, 1.0 );
  vec3 d = normalize( uCamRot * ( v.xyz / v.w ) );
  vec4 pc = uPrevVP * vec4( d, 0.0 );
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  float ok = uRes.w * step( 0.0, pc.w ) * step( 0.0, puv.x ) * step( puv.x, 1.0 ) * step( 0.0, puv.y ) * step( puv.y, 1.0 );
  vec4 h = texture2D( tHist, puv );
  // widen the box a touch: the march is noisy by design, the clamp is for disocclusion
  vec4 e = ( mx - mn ) * 0.25;
  h = clamp( h, mn - e, mx + e );
  gl_FragColor = mix( c, h, ok * ( 1.0 - uRes.z ) );
}`;

// --- cloud shadow map: sun transmittance through the shell, top-down ---
const SHADOW_FRAG = `
precision highp float;
precision highp sampler3D;
${GLSL_HASH}
varying vec2 vUv;
uniform sampler3D tShape, tDetail;
uniform sampler2D tWeather, tNoise2;
uniform vec3 uCamPos;
uniform vec4 uLayer, uWin, uScale, uWind, uEvo;
uniform vec3 uLightDir;
uniform vec4 uShWin;     // centre x, z, size, -
float hgrad( float h, float ty ){
  float st = smoothstep( 0.0, 0.05, h ) * ( 1.0 - smoothstep( 0.09, 0.22, h ) );
  float cu = smoothstep( 0.0, 0.08, h ) * ( 1.0 - smoothstep( 0.32, 0.72, h ) );
  float cb = smoothstep( 0.0, 0.07, h ) * ( 1.0 - smoothstep( 0.66, 0.98, h ) );
  return ty < 0.5 ? mix( st, cu, ty * 2.0 ) : mix( cu, cb, ty * 2.0 - 1.0 );
}
vec4 wAt( vec2 xz ){ return textureLod( tWeather, ( xz - uWin.xy ) * uWin.z + 0.5, 0.0 ); }
float density( vec3 p, float h, vec4 w ){
  float cov = w.r;
  if ( cov < 0.01 || h < 0.0 || h > 1.0 ) return 0.0;
  vec3 q = p * uScale.x + vec3( uWind.x, uEvo.x, uWind.y );
  vec4 s = textureLod( tShape, q, 1.0 );
  float lf = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  float base = vremap( s.r, lf - 1.0, 1.0, 0.0, 1.0 ) * hgrad( ( h - w.a ) / ( ( 1.0 - w.a ) * mix( 0.35, 1.0, clamp( cov * 1.4, 0.0, 1.0 ) ) ), w.g );
  return clamp( vremap( base, 1.0 - cov, 1.0, 0.0, 1.0 ), 0.0, 1.0 ) * cov * w.b;
}
void main(){
  vec2 xz = uShWin.xy + ( vUv - 0.5 ) * uShWin.z;
  vec3 L = uLightDir;
  float od = 0.0;
  // walk the sun ray through the shell from the base to the top, 10 samples
  float t0 = uLayer.x / max( L.y, 0.05 ), t1 = ( uLayer.x + uLayer.y ) / max( L.y, 0.05 );
  float dt = ( t1 - t0 ) / 10.0;
  for ( int i = 0; i < 10; i++ ) {
    vec3 p = vec3( xz.x, 0.0, xz.y ) + L * ( t0 + dt * ( float( i ) + 0.5 ) );
    float h = ( p.y - uLayer.x ) / uLayer.y;
    od += density( p, h, wAt( p.xz ) ) * dt;
  }
  // 0.6: forward scattering refills a cloud's shadow; Beer alone makes it a black hole
  float T = exp( -od * uScale.w * 0.6 );
  gl_FragColor = vec4( T, T, T, 1.0 );
}`;

// --- probe: the raft's (origin) and the camera's sun visibility, for the PBO ring ---
const PROBE_FRAG = `
precision highp float;
uniform sampler2D tShadow;
uniform vec4 uShWin;
uniform vec3 uCamPos;
vec2 suv( vec2 xz ){ return ( xz - uShWin.xy ) / uShWin.z + 0.5; }
void main(){
  float a = 0.0;
  // a small kernel: a cloud edge passing over the raft should be a soft fade, not a pop
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ )
    a += texture2D( tShadow, suv( vec2( float( x ), float( y ) ) * 6.0 ) ).r;
  float b = texture2D( tShadow, suv( uCamPos.xz ) ).r;
  gl_FragColor = vec4( a / 9.0, b, 0.0, 1.0 );
}`;

// --- the dome side: everything the background dome needs ---
export const GLSL_VOL_DOME = `
uniform sampler2D tVolCloud, tVolPano;
uniform mat4 uVolVP;
uniform vec4 uVolK;      // on, mode (0 screen, 1 pano), star gain, physical sun elevation (rad)
uniform vec4 uVolDisc;   // disc rgb (transmitted, normalised), angular radius
${GLSL_VOL_ATMO}
float vStarHash( vec3 p ){ p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
// Catmull-Rom upsample of the low-res cloud target in 5 bilinear taps (the corners of
// the 4x4 kernel are dropped): keeps the edges of a third-res march crisp where a plain
// bilinear lookup reads as a soft blur.
vec4 volCR( sampler2D t, vec2 uv ){
  vec2 ts = vec2( textureSize( t, 0 ) );
  vec2 p = uv * ts - 0.5, f = fract( p ), c0 = floor( p );
  vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) );
  vec2 w1 = 1.0 + f * f * ( -2.5 + 1.5 * f );
  vec2 w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) );
  vec2 w3 = f * f * ( -0.5 + 0.5 * f );
  vec2 w12 = w1 + w2;
  vec2 tc0 = ( c0 - 0.5 ) / ts, tc3 = ( c0 + 2.5 ) / ts, tc12 = ( c0 + 0.5 + w2 / w12 ) / ts;
  vec4 r = texture2D( t, vec2( tc12.x, tc0.y ) ) * ( w12.x * w0.y )
         + texture2D( t, vec2( tc0.x, tc12.y ) ) * ( w0.x * w12.y )
         + texture2D( t, tc12 ) * ( w12.x * w12.y )
         + texture2D( t, vec2( tc3.x, tc12.y ) ) * ( w3.x * w12.y )
         + texture2D( t, vec2( tc12.x, tc3.y ) ) * ( w12.x * w3.y );
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max( r / ws, vec4( 0.0 ) );
}
vec4 volCloudAt( vec3 d ){
  if ( uVolK.y < 0.5 ) {
    vec4 c = uVolVP * vec4( d, 0.0 );
    if ( c.w <= 0.0 ) return vec4( 0.0, 0.0, 0.0, 1.0 );
    vec4 v = volCR( tVolCloud, c.xy / c.w * 0.5 + 0.5 );
    v.a = min( v.a, 1.0 );
    return v;
  }
  float u = atan( d.z, d.x ) / 6.28318531 + 0.5;
  float v = sqrt( clamp( d.y, 0.0, 1.0 ) );
  vec4 p = texture2D( tVolPano, vec2( u, v ) );
  // the pano already composited the atmosphere: hand back its cloud part only
  return vec4( p.rgb - vAtmo( d ) * p.a, p.a );
}
vec3 volSky( vec3 d ){
  vec3 dd = vec3( d.x, max( d.y, 0.0005 ), d.z );
  dd = normalize( dd );
  vec3 c = vAtmo( dd );
  vec4 cl = volCloudAt( dd );
  // NIGHT: stars, faded by the physical sun and by the marine layer.
  if ( uVolK.z > 0.001 ) {
    vec3 sp = dd * 340.0;
    vec3 ci = floor( sp );
    float h = vStarHash( ci );
    if ( h > 0.9965 ) {
      vec3 f = fract( sp ) - 0.5;
      float r = length( f );
      float m = ( h - 0.9965 ) / 0.0035;
      float tw = 0.75 + 0.25 * sin( uTime * ( 1.3 + 4.0 * m ) + h * 40.0 );
      c += vec3( 0.85 + 0.15 * m, 0.9, 1.0 ) * ( 1.0 - smoothstep( 0.05, 0.32, r ) ) * m * m * uVolK.z * tw
         * smoothstep( 0.02, 0.25, dd.y );
    }
  }
  // THE SUN DISC: a real disc, limb-darkened, anti-aliased, the colour the atmosphere
  // leaves it. No pow() lobe: the aureole is the Mie phase in vAtmo, which is why the
  // old soft blob round the sun is gone.
  float ang = acos( clamp( dot( dd, uVolSun ), -1.0, 1.0 ) );
  if ( ang < uVolDisc.w * 2.0 ) {
    float r = ang / uVolDisc.w;
    float disc = 1.0 - smoothstep( 0.86, 1.0, r );
    float limb = 1.0 - 0.55 * ( 1.0 - sqrt( max( 0.0, 1.0 - r * r ) ) );
    c += uVolDisc.rgb * disc * limb * uDiscK;
  }
  // THE MOON (same model as skyRadiance's: disc, terminator, earthshine, halo).
  if ( uMoonCol.b > 0.001 ) {
    float md = dot( dd, uMoonDir );
    if ( md > 0.0 ) {
      vec3 tv = dd - uMoonDir * md;
      float ma = length( tv );
      float body = 1.0 - smoothstep( uMoonR * 0.88, uMoonR, ma );
      float xn = dot( tv, uMoonRight ) / uMoonR;
      float lit = smoothstep( uMoonPh.y - 0.12, uMoonPh.y + 0.12, xn * uMoonPh.x );
      c += uMoonCol * ( body * ( uMoonPh.z + ( 1.0 - uMoonPh.z ) * lit ) + uMoonPh.w * pow( md, 240.0 ) );
    }
  }
  return c * cl.a + cl.rgb;
}`;

// ---------------------------------------------------------------------------------------
// CPU ATMOSPHERE (units: km). Hillaire/Bruneton coefficients, single scattering with a
// multiple-scattering lift. Tables sized once.
// ---------------------------------------------------------------------------------------
const RG = 6360, RT = 6420;
const BR = [5.802e-3, 13.558e-3, 33.1e-3];
const BMS = 3.996e-3, BME = 4.40e-3;
const BO = [0.650e-3, 1.881e-3, 0.085e-3];
const TN_H = 48, TN_MU = 96;
const transTab = new Float32Array(TN_H * TN_MU * 3);
let transHaze = -1;
const LUT_W = 48, LUT_H = 40;
const lutR = new Float32Array(LUT_W * LUT_H * 4), lutM = new Float32Array(LUT_W * LUT_H * 4);
const lutR16 = new Uint16Array(LUT_W * LUT_H * 4), lutM16 = new Uint16Array(LUT_W * LUT_H * 4);
let lutElev = 999, lutHaze = -1, lutAge = 99;
const _t3 = [0, 0, 0], _t3b = [0, 0, 0], _wb = [1, 1, 1];
const atm = {
  hor: [0, 0, 0], zen: [0, 0, 0], mean: [0, 0, 0],   // raw (unnormalised)
  sunT: [1, 1, 1]                                    // sun transmittance at the deck
};
const MIE_G = 0.78;

function densities(h, haze, out) {
  out[0] = Math.exp(-h / 8);
  out[1] = Math.exp(-h / 1.2) * haze;
  out[2] = Math.max(0, 1 - Math.abs(h - 25) / 15);
}
const _dn = [0, 0, 0];
// Transmittance from altitude h along mu to the top (0 if the ray meets the ground).
function buildTrans(haze) {
  for (let ih = 0; ih < TN_H; ih++) {
    const u = ih / (TN_H - 1);
    const h = u * u * (RT - RG);
    const r = RG + h;
    for (let im = 0; im < TN_MU; im++) {
      const mu = -1 + 2 * im / (TN_MU - 1);
      const o = (ih * TN_MU + im) * 3;
      // ground?
      const disc = r * r * (mu * mu - 1) + RG * RG;
      if (mu < 0 && disc >= 0) { transTab[o] = transTab[o + 1] = transTab[o + 2] = 0; continue; }
      const tTop = -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + RT * RT));
      const N = 40, dt = tTop / N;
      let odR = 0, odM = 0, odO = 0;
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) * dt;
        const hh = Math.sqrt(r * r + t * t + 2 * r * mu * t) - RG;
        densities(Math.max(0, hh), haze, _dn);
        odR += _dn[0] * dt; odM += _dn[1] * dt; odO += _dn[2] * dt;
      }
      for (let c = 0; c < 3; c++) transTab[o + c] = Math.exp(-(BR[c] * odR + BME * odM + BO[c] * odO));
    }
  }
  transHaze = haze;
}
function transAt(h, mu, out) {
  const u = Math.sqrt(clamp(h / (RT - RG), 0, 1)) * (TN_H - 1);
  const m = (clamp(mu, -1, 1) + 1) * 0.5 * (TN_MU - 1);
  const i0 = Math.min(TN_H - 2, Math.floor(u)), j0 = Math.min(TN_MU - 2, Math.floor(m));
  const fu = u - i0, fm = m - j0;
  for (let c = 0; c < 3; c++) {
    const a = transTab[(i0 * TN_MU + j0) * 3 + c], b = transTab[(i0 * TN_MU + j0 + 1) * 3 + c];
    const d = transTab[((i0 + 1) * TN_MU + j0) * 3 + c], e = transTab[((i0 + 1) * TN_MU + j0 + 1) * 3 + c];
    out[c] = (a + (b - a) * fm) * (1 - fu) + (d + (e - d) * fm) * fu;
  }
  return out;
}
const rayPhase = mu => 3 / (16 * Math.PI) * (1 + mu * mu);
const H0 = 0.002;   // the deck, km
function buildLUT(elevDeg, haze) {
  const t0 = performance.now();
  if (Math.abs(haze - transHaze) > 1e-4) buildTrans(haze);
  const es = elevDeg * D2R;
  const sx = Math.cos(es), sy = Math.sin(es);   // sun in the (x = toward sun azimuth, y) plane
  const r0 = RG + H0;
  let mr = 0, mg = 0, mb = 0, mw = 0;
  for (let j = 0; j < LUT_H; j++) {
    const v = j / (LUT_H - 1);
    const el = Math.max(v * v * (Math.PI / 2 + 0.0349) - 0.0349, 0.0015);
    const ce = Math.cos(el), se = Math.sin(el);
    // distance to the top of the atmosphere from the deck
    const tTop = -r0 * se + Math.sqrt(r0 * r0 * (se * se - 1) + RT * RT);
    for (let i = 0; i < LUT_W; i++) {
      const az = i / (LUT_W - 1) * Math.PI;
      const dx = ce * Math.cos(az), dz = ce * Math.sin(az), dy = se;
      const mu = dx * sx + dy * sy;
      const N = 30;
      let odR = 0, odM = 0, odO = 0;
      let rR = 0, rG = 0, rB = 0, mR = 0, mG = 0, mB = 0, sR = 0, sG = 0, sB = 0;
      let tPrev = 0;
      for (let k = 0; k < N; k++) {
        // quadratic step distribution: fine near the eye, coarse in the thin air
        const ta = (k / N) * (k / N) * tTop, tb = ((k + 1) / N) * ((k + 1) / N) * tTop;
        const dt = tb - ta, t = 0.5 * (ta + tb);
        tPrev = tb;
        const px = dx * t, py = r0 + dy * t, pz = dz * t;
        const r = Math.sqrt(px * px + py * py + pz * pz);
        const h = r - RG;
        densities(Math.max(0, h), haze, _dn);
        odR += _dn[0] * dt * 0.5; odM += _dn[1] * dt * 0.5; odO += _dn[2] * dt * 0.5;
        const muS = (px * sx + py * sy) / r;
        transAt(h, muS, _t3);
        // the multiple-scattering lift: a softened sun that keeps lighting the high air
        // for a while after the geometric shadow arrives (the blue hour)
        transAt(h, muS + 0.10, _t3b);
        const tvR = Math.exp(-(BR[0] * odR + BME * odM + BO[0] * odO));
        const tvG = Math.exp(-(BR[1] * odR + BME * odM + BO[1] * odO));
        const tvB = Math.exp(-(BR[2] * odR + BME * odM + BO[2] * odO));
        rR += tvR * _dn[0] * _t3[0] * dt; rG += tvG * _dn[0] * _t3[1] * dt; rB += tvB * _dn[0] * _t3[2] * dt;
        mR += tvR * _dn[1] * _t3[0] * dt; mG += tvG * _dn[1] * _t3[1] * dt; mB += tvB * _dn[1] * _t3[2] * dt;
        const ms = 0.06 / (4 * Math.PI);
        sR += tvR * (BR[0] * _dn[0] + BMS * _dn[1]) * _t3b[0] * ms * dt;
        sG += tvG * (BR[1] * _dn[0] + BMS * _dn[1]) * _t3b[1] * ms * dt;
        sB += tvB * (BR[2] * _dn[0] + BMS * _dn[1]) * _t3b[2] * ms * dt;
        odR += _dn[0] * dt * 0.5; odM += _dn[1] * dt * 0.5; odO += _dn[2] * dt * 0.5;
      }
      const pr = rayPhase(mu);
      const o = (j * LUT_W + i) * 4;
      lutR[o] = BR[0] * rR * pr + sR; lutR[o + 1] = BR[1] * rG * pr + sG; lutR[o + 2] = BR[2] * rB * pr + sB; lutR[o + 3] = 1;
      lutM[o] = BMS * mR; lutM[o + 1] = BMS * mG; lutM[o + 2] = BMS * mB; lutM[o + 3] = 1;
      // hemisphere mean (cos-weighted, with an isotropic Mie share) for the normaliser
      const wgt = se * ce;
      const iso = 1 / (4 * Math.PI);
      mr += (lutR[o] + lutM[o] * iso) * wgt; mg += (lutR[o + 1] + lutM[o + 1] * iso) * wgt;
      mb += (lutR[o + 2] + lutM[o + 2] * iso) * wgt; mw += wgt;
    }
  }
  atm.mean[0] = mr / mw; atm.mean[1] = mg / mw; atm.mean[2] = mb / mw;
  // horizon (row 1, ~0.5 deg) and zenith, azimuth-averaged, isotropic Mie share
  const avgRow = (j, out) => {
    out[0] = out[1] = out[2] = 0;
    for (let i = 0; i < LUT_W; i++) {
      const o = (j * LUT_W + i) * 4, iso = 1 / (4 * Math.PI);
      out[0] += lutR[o] + lutM[o] * iso; out[1] += lutR[o + 1] + lutM[o + 1] * iso; out[2] += lutR[o + 2] + lutM[o + 2] * iso;
    }
    out[0] /= LUT_W; out[1] /= LUT_W; out[2] /= LUT_W;
  };
  avgRow(7, atm.hor);   // ~1 degree: the sky the eye calls the horizon
  avgRow(LUT_H - 1, atm.zen);
  // at the cloud deck (~1 km): the deck sees the sun ~1.2 degrees longer than the sea
  // does, which is why clouds keep their colour after the sun has gone from the water
  transAt(1.0, Math.sin(es), atm.sunT);
  // WHITE BALANCE: the eye (and every AAA grade) calls the high sun white. The sky and the
  // sun are divided by the zenith sun's own transmittance, so noon is a white sun in a
  // blue sky and the warmth of a low sun is only what the extra air adds.
  transAt(1.0, 1.0, _wb);
  for (let c = 0; c < 3; c++) atm.sunT[c] /= _wb[c];
  for (let k = 0; k < lutR.length; k += 4) for (let c = 0; c < 3; c++) { lutR[k + c] /= _wb[c]; lutM[k + c] /= _wb[c]; }
  for (let c = 0; c < 3; c++) { atm.hor[c] /= _wb[c]; atm.zen[c] /= _wb[c]; atm.mean[c] /= _wb[c]; }
  const toH = THREE.DataUtils.toHalfFloat;
  for (let k = 0; k < lutR.length; k++) { lutR16[k] = toH(lutR[k]); lutM16[k] = toH(lutM[k]); }
  if (skyRTex) { skyRTex.needsUpdate = true; skyMTex.needsUpdate = true; }
  lutElev = elevDeg; lutHaze = haze; lutAge = 0;
  stats.lutMs = performance.now() - t0; stats.lutN++;
}

// ---------------------------------------------------------------------------------------
// BUILD
// ---------------------------------------------------------------------------------------
function mkMat(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT_FS, fragmentShader: frag,
    depthTest: false, depthWrite: false, toneMapped: false
  });
}
function mkQuad(mat) {
  const s = new THREE.Scene();
  const m = new THREE.Mesh(fsGeo, mat);
  m.frustumCulled = false;
  s.add(m);
  return s;
}
function rt2(w, h, type, filter) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: type || THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
    minFilter: filter || THREE.LinearFilter, magFilter: filter || THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false
  });
}
function rt3(n) {
  const t = new THREE.WebGL3DRenderTarget(n, n, n, {
    type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false
  });
  t.texture.wrapS = t.texture.wrapT = t.texture.wrapR = THREE.RepeatWrapping;
  return t;
}
function genVolume(rt, n, mat) {
  genMesh.material = mat;
  for (let z = 0; z < n; z++) {
    mat.uniforms.uZ.value = (z + 0.5) / n;
    // the last slice turns the mip build on, so the chain is generated exactly once
    if (z === n - 1) rt.texture.generateMipmaps = true;
    renderer.setRenderTarget(rt, z);
    renderer.render(genScene, fsCam);
  }
  rt.texture.generateMipmaps = false;
}

export function buildSky() {
  if (built) return;
  const t0 = performance.now();
  fsGeo = new THREE.BufferGeometry();
  fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  fsGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // --- noise volumes ---
  shapeRT = rt3(128); detailRT = rt3(32);
  noise2RT = rt2(256, 256, THREE.UnsignedByteType);
  noise2RT.texture.wrapS = noise2RT.texture.wrapT = THREE.RepeatWrapping;
  matShapeGen = mkMat(SHAPE_FRAG, { uZ: { value: 0 } });
  matDetailGen = mkMat(DETAIL_FRAG, { uZ: { value: 0 } });
  matNoise2Gen = mkMat(NOISE2_FRAG, { uZ: { value: 0 } });
  genMesh = new THREE.Mesh(fsGeo, matShapeGen); genMesh.frustumCulled = false;
  genScene = new THREE.Scene(); genScene.add(genMesh);
  const prev = renderer.getRenderTarget();
  const tg0 = performance.now();
  genVolume(shapeRT, 128, matShapeGen);
  genVolume(detailRT, 32, matDetailGen);
  genMesh.material = matNoise2Gen;
  renderer.setRenderTarget(noise2RT); renderer.render(genScene, fsCam);
  renderer.setRenderTarget(prev);
  // One finish, behind the loader: it turns the queued generation into a measured number
  // (genMs, GPU + compile of the three generators) instead of a hitch on frame one.
  renderer.getContext().finish();
  genMs = performance.now() - tg0;
  // the generators are boot-only: free their programs
  matShapeGen.dispose(); matDetailGen.dispose(); matNoise2Gen.dispose();

  // --- atmosphere LUT textures ---
  buildLUT(30, 1);
  skyRTex = new THREE.DataTexture(lutR16, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
  skyMTex = new THREE.DataTexture(lutM16, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
  for (const t of [skyRTex, skyMTex]) {
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
  }

  // --- weather / march / resolve / shadow / probe ---
  weatherRT = rt2(512, 512, THREE.HalfFloatType);
  shadowRT = rt2(256, 256, THREE.HalfFloatType);
  panoRT = rt2(256, 64, THREE.HalfFloatType);
  panoRT.texture.wrapS = THREE.RepeatWrapping;
  probeRT = rt2(1, 1, THREE.FloatType, THREE.NearestFilter);
  curRT = rt2(4, 4); histRT[0] = rt2(4, 4); histRT[1] = rt2(4, 4);

  matWeather = mkMat(WEATHER_FRAG, {
    uWin: { value: new THREE.Vector4(0, 0, 48000, 1) },
    uA: { value: new THREE.Vector4() }, uB: { value: new THREE.Vector4() },
    uAo: { value: new THREE.Vector4() }, uBo: { value: new THREE.Vector4() },
    uSt: { value: new THREE.Vector4() }
  });
  qWeather = mkQuad(matWeather);

  ATMO_U.tSkyR.value = skyRTex; ATMO_U.tSkyM.value = skyMTex;
  const shared = {
    tShape: { value: shapeRT.texture }, tDetail: { value: detailRT.texture },
    tWeather: { value: weatherRT.texture }, tNoise2: { value: noise2RT.texture },
    uCamPos: { value: new THREE.Vector3() },
    uLayer: { value: new THREE.Vector4() }, uWin: { value: new THREE.Vector4() },
    uScale: { value: new THREE.Vector4() }, uWind: { value: new THREE.Vector4() },
    uEvo: { value: new THREE.Vector4() }, uLightDir: { value: new THREE.Vector3(0, 1, 0) }
  };
  matMarch = mkMat(MARCH_FRAG, {
    ...shared, ...ATMO_U,
    uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() },
    uLightCol: { value: new THREE.Vector3() }, uAmbTop: { value: new THREE.Vector3() },
    uAmbBot: { value: new THREE.Vector3() }, uPhase: { value: new THREE.Vector4() },
    uMS: { value: new THREE.Vector4() }, uSteps: { value: new THREE.Vector4() },
    uBolt0: { value: new THREE.Vector4() }, uBolt1: { value: new THREE.Vector4() },
    uBoltCol: { value: new THREE.Vector3() },
    uCirrus: { value: new THREE.Vector4() }, uCirrusOff: { value: new THREE.Vector2() },
    uStorm: { value: new THREE.Vector4() }, uHazeCol: { value: new THREE.Vector3() },
    uSharp: { value: new THREE.Vector2(0.02, 0.7) }, uEvo2: { value: new THREE.Vector4(0.12, 0, 0, 0) }
  });
  qMarch = mkQuad(matMarch);
  matResolve = mkMat(RESOLVE_FRAG, {
    tCur: { value: null }, tHist: { value: null },
    uInvProj: matMarch.uniforms.uInvProj, uCamRot: matMarch.uniforms.uCamRot,
    uPrevVP: { value: prevVP }, uRes: { value: new THREE.Vector4() }
  });
  qResolve = mkQuad(matResolve);
  matShadow = mkMat(SHADOW_FRAG, { ...shared, uShWin: { value: new THREE.Vector4(0, 0, 4096, 0) } });
  qShadow = mkQuad(matShadow);
  matProbe = mkMat(PROBE_FRAG, {
    tShadow: { value: shadowRT.texture }, uShWin: matShadow.uniforms.uShWin, uCamPos: shared.uCamPos
  });
  qProbe = mkQuad(matProbe);

  DOME_U.tVolCloud.value = histRT[0].texture;
  DOME_U.tVolPano.value = panoRT.texture;
  built = true;
  bootMs = performance.now() - t0;
}

// Uniforms the dome (water.js buildDome) spreads into its material. Values are live.
const ATMO_U = {
  tSkyR: { value: null }, tSkyM: { value: null },
  uAtmo: { value: new THREE.Vector4(1, LUT_W, LUT_H, MIE_G) },
  uAtmoSunXZ: { value: new THREE.Vector3(1, 0, 0.5) },
  uVolSun: { value: new THREE.Vector3(0, 1, 0) },
  uPalHor: { value: new THREE.Vector3() }, uPalZen: { value: new THREE.Vector3() },
  uNightMix: { value: 0 }, uSkySat: { value: 1 }
};
export const DOME_U = {
  ...ATMO_U,
  tVolCloud: { value: null }, tVolPano: { value: null },
  uVolVP: { value: new THREE.Matrix4() },
  uVolK: { value: new THREE.Vector4(0, 0, 0, 0) },
  uVolDisc: { value: new THREE.Vector4(1, 1, 1, VSKY.discR) }
};
// The dome's own cube capture renders from the pano (a screen-space lookup is wrong in
// a cube face). water.js's captureSkyEnv brackets itself with this.
export function volCaptureMode(on) { DOME_U.uVolK.value.y = on ? 1 : 0; }

// ---------------------------------------------------------------------------------------
// PUBLIC HOOKS
// ---------------------------------------------------------------------------------------
// getSkyEnv(): the low-res sky + cloud environment for reflections (the ocean agent).
//   texture   256x64 RGBA HalfFloat, upper hemisphere only, refreshed in 4 strips (every
//             frame a quarter): rgb = sky radiance INCLUDING clouds and the Mie aureole but
//             NOT the sun disc (draw your own glint, times alpha); a = cloud transmittance
//             toward that direction (multiply your sun/glint by it).
//   glsl      a GLSL function `vec4 abyssaSkyEnv( sampler2D t, vec3 dir )` to paste into
//             your shader; dir is a world direction with +y up; dir.y < 0 is clamped to
//             the horizon row (the sea never mirrors below the horizon anyway).
//   valid     false until the first full refresh; null is returned when the volumetric
//             sky is off (VSKY.on 0, degraded to the terminal rung) — keep the analytic
//             skyRadiance path for that case.
//   version   increments on every strip update.
// Units: the same scene-linear units skyRadiance returns (it is normalised to the palette).
const SKY_ENV = {
  texture: null, valid: false, version: 0, width: 256, height: 64,
  glsl: `vec4 abyssaSkyEnv( sampler2D t, vec3 dir ){
  vec3 d = normalize( vec3( dir.x, max( dir.y, 0.0 ), dir.z ) );
  return texture2D( t, vec2( atan( d.z, d.x ) / 6.28318531 + 0.5, sqrt( d.y ) ) );
}`
};
export function getSkyEnv() { return VSKY.on && built ? SKY_ENV : null; }
// getCloudShadow(): sun transmittance through the cloud deck, top-down.
//   texture   256x256 HalfFloat, r = transmittance 0..1 (1 = clear sun)
//   window    Float32Array [centreX, centreZ, size] in world units: uv = (xz - c) / size + 0.5
//   Outside the window assume the window's mean; the raft is always at its centre.
const SHADOW = { texture: null, window: new Float32Array([0, 0, 4096]) };
export function getCloudShadow() { return VSKY.on && built ? SHADOW : null; }
export function volSkyOn() { return !!(VSKY.on && built); }

// ---------------------------------------------------------------------------------------
// PER FRAME (CPU): weather, atmosphere, lighting numbers. Called after updateWater.
// ---------------------------------------------------------------------------------------
let wxRef = null;
export function setSkyWeather(wx) { wxRef = wx; }

// The day hand's fields for day n, pure functions of n (used for the midnight cross-fade
// and the deterministic drift). prevHand is captured once per day change.
const dayA = { idx: -999, cover: 0, type: 0, layers: 0, wdir: 0, wsp: 0, ox: 0, oz: 0 };
const dayB = { idx: -999, cover: 0, type: 0, layers: 0, wdir: 0, wsp: 0, ox: 0, oz: 0 };
function mulberry(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function fillDay(D, h, seed) {
  D.idx = h.dayIndex;
  D.cover = clamp(0.08 + 0.80 * h.clouds, 0, 1);
  D.type = clamp(0.40 + 0.45 * h.cloudTex, 0, 1);
  D.layers = clamp(h.layers || 0, 0, 1);
  D.wdir = h.windDir0 || 0; D.wsp = h.windBase === undefined ? 0.4 : h.windBase;
  if (!seed) return;   // the per-frame refresh allocates nothing
  const r = mulberry((0x5C1E5 ^ Math.imul(h.dayIndex | 0, 2654435761)) >>> 0);
  D.ox = (r() - 0.5) * 2e5; D.oz = (r() - 0.5) * 2e5;
}
const CYCLE = 720;

let physElev = 30, hazeMul = 1, Ksm = 0;
const _hor2 = [0, 0, 0];
const lightCol = [0, 0, 0], ambTop = [0, 0, 0], ambBot = [0, 0, 0], horN = [0, 0, 0], zenN = [0, 0, 0];
const _pal = { zen: null, hor: null, disc: null };
let shadowSunVis = 1, camSunVis = 1;

// PBO ring for the probe (the exposure.js pattern: no fence, read 3 issues later)
const PBO_RING = 4, PBO_LAG = 3;
let pbo = null, pboIssued = 0, pboRead = 0, pboFailed = false;
const pboOut = new Float32Array(4);

function physicalElevation() {
  // weather.js holds the drawn sun at >= 8 degrees (night is the moon regime there). The
  // ATMOSPHERE needs the sun's real height, so it is rebuilt from the same solar proxy:
  // e = -cos(2 pi phase); the dusk ring stop (e = 0) is a sun on the horizon, deep night
  // is 17 degrees under it, and by e = 0.39 (full day) it rejoins the drawn sun.
  const e = -Math.cos(TAU * SKY.phase01);
  if (e >= 0) return 1 + (SUN.elevDeg - 1) * sm(0, 0.393, e);
  return Math.max(-20, 1 + e * (18 / 0.393));
}

export function updateSky(dt, t) {
  if (!built) return;
  const V = VSKY;
  DOME_U.uVolK.value.x = V.on ? 1 : 0;
  if (!V.on) { W.airAmbience.sunVis = 1; return; }
  const h = wxRef ? wxRef.hand : null;
  wxClock = wxRef ? wxRef.clock : t;
  wxStorm = wxRef ? wxRef.env.sky : 0;
  wxDay = wxRef ? wxRef.day : 1;
  const storm = wxStorm;

  // --- the hand -> two day records (today, yesterday) ---
  if (h && h.dayIndex !== dayA.idx) {
    fillDay(dayA, h, true);
    const pv = window.weather && window.weather.peek ? window.weather.peek(h.dayIndex - 1) : null;
    if (pv) fillDay(dayB, pv, true); else Object.assign(dayB, dayA);
  } else if (h) fillDay(dayA, h);   // the live hand can be forced (lab presets): track it
  const tin = SKY.phase01 * CYCLE;                 // seconds into this day, a pure function of the clock
  const blend = sm(0, 40, tin);                    // the midnight cross-fade
  const fog = W.airAmbience.fog || 0;

  // --- atmosphere ---
  physElev = physicalElevation();
  stats.physElev = physElev;
  hazeMul = 0.55 + 0.9 * (h ? h.cloudTex : 0.3) + 2.6 * storm + 4.0 * fog;
  stats.hazeMul = hazeMul;
  lutAge++;
  if ((Math.abs(physElev - lutElev) > 0.12 || Math.abs(hazeMul - lutHaze) > 0.03 * lutHaze) && lutAge > 5) buildLUT(physElev, hazeMul);

  // NORMALISER: the physical horizon (1 degree up) is scaled to the palette's own horizon
  // luminance this frame, so the authored energy at every hour survives and the airlight
  // the far sea settles on keeps its tuned level. The zenith falls where physics puts it.
  const P = W.skyPalette();
  const palLum = lum(P.hor[0], P.hor[1], P.hor[2]) * V.horK;
  const physLum = Math.max(1e-9, lum(atm.hor[0], atm.hor[1], atm.hor[2]));
  const Kt = Math.min(palLum / physLum, 400);
  const nightMix = 1 - sm(-8, -1.5, physElev);
  ATMO_U.uNightMix.value = nightMix;
  ATMO_U.uPalHor.value.set(P.hor[0], P.hor[1], P.hor[2]);
  ATMO_U.uPalZen.value.set(P.zen[0], P.zen[1], P.zen[2]);
  Ksm = Ksm <= 0 ? Kt : Ksm + (Kt - Ksm) * Math.min(1, dt * 2);
  const K = Ksm;
  stats.K = K;
  ATMO_U.uAtmo.value.x = K;
  const az = SUN.azimDeg * D2R;
  ATMO_U.uAtmoSunXZ.value.set(Math.cos(az), Math.sin(az), Math.sin(physElev * D2R));
  ATMO_U.uVolSun.value.set(SUN.dir.x, SUN.dir.y, SUN.dir.z);
  // DUSK RESTRAINT: a sun near the horizon drives the single-scatter sky to a saturated
  // amber that reads as a filter; the house bar is brass-age and quiet.
  const skySat = 1 - V.duskDesat * (1 - sm(4, 22, physElev)) * sm(-8, -1, physElev);
  ATMO_U.uSkySat.value = skySat;
  for (let c = 0; c < 3; c++) {
    horN[c] = atm.hor[c] * K + (P.hor[c] - atm.hor[c] * K) * nightMix;
    zenN[c] = atm.zen[c] * K + (P.zen[c] - atm.zen[c] * K) * nightMix;
  }
  {
    const lh = lum(horN[0], horN[1], horN[2]), lz = lum(zenN[0], zenN[1], zenN[2]);
    for (let c = 0; c < 3; c++) { horN[c] = lh + (horN[c] - lh) * skySat; zenN[c] = lz + (zenN[c] - lz) * skySat; }
  }

  // --- the light that lights the clouds: the sun, handing over to the moon ---
  const sunUp = sm(-5, 1, physElev);
  // The disc and the clouds see the sun through the atmosphere at its PHYSICAL height.
  const sT = atm.sunT;
  const mc = W.SKY_UNIFORMS.uMoonCol.value, md = W.SKY_UNIFORMS.uMoonDir.value;
  const moonL = lum(mc.x, mc.y, mc.z);
  const L = matMarch.uniforms.uLightDir.value;
  if (sunUp > 0.02 || moonL < 1e-4) {
    L.set(SUN.dir.x, SUN.dir.y, SUN.dir.z);
    // a fully lit cloud face lands near the horizon's own luminance times gain: the
    // physics sets its COLOUR (the sun through the air at its real height), the palette
    // its level, the same contract as the sky
    const sl = Math.max(1e-4, lum(sT[0], sT[1], sT[2]));
    const k = palLum / V.horK * V.gain * sunUp / sl;
    for (let c = 0; c < 3; c++) lightCol[c] = sT[c] * k;
    // the house palette is quiet: a horizon sun keeps its hue, not its full saturation
    const ll = lum(lightCol[0], lightCol[1], lightCol[2]);
    for (let c = 0; c < 3; c++) lightCol[c] = ll + (lightCol[c] - ll) * V.lightSat;
  } else {
    L.set(md.x, Math.max(0.05, md.y), md.z).normalize();
    const k = 0.10 * (1 - sunUp);
    lightCol[0] = mc.x * k; lightCol[1] = mc.y * k; lightCol[2] = mc.z * k;
  }
  // storm: the lid is lit from above through itself; the base sees a fraction
  const sk = 1 - V.stormDim * storm;
  matMarch.uniforms.uLightCol.value.set(lightCol[0] * sk, lightCol[1] * sk, lightCol[2] * sk);
  // ambient: the zenith half of the sky from above, the sea's dull mirror from below
  for (let c = 0; c < 3; c++) {
    ambTop[c] = (0.55 * zenN[c] + 0.45 * horN[c]) * 1.6 * V.ambK * (1 - 0.45 * storm);
    ambBot[c] = horN[c] * 0.35 * V.ambK * (1 - 0.5 * storm);
  }
  matMarch.uniforms.uAmbTop.value.set(ambTop[0], ambTop[1], ambTop[2]);
  matMarch.uniforms.uAmbBot.value.set(ambBot[0], ambBot[1], ambBot[2]);

  // --- the disc ---
  {
    const d = P.disc, dl = Math.max(1e-4, lum(d[0], d[1], d[2]));
    const sl = Math.max(1e-4, lum(sT[0], sT[1], sT[2]));
    const vis = sm(-0.8, 0.6, physElev);
    const k = V.discI * dl / 3.0 * vis * (1 - storm * 0.9);
    DOME_U.uVolDisc.value.set(sT[0] / sl * k, sT[1] / sl * k, sT[2] / sl * k, V.discR);
  }
  DOME_U.uVolK.value.z = V.stars * (1 - sm(-9, -1, physElev)) * (1 - fog) * 0.16;
  DOME_U.uVolK.value.w = physElev * D2R;

  // --- the shell and the noise frame ---
  const u = matMarch.uniforms;
  const base = V.base + (V.baseStorm - V.base) * sm(0.1, 0.9, storm) - 60 * fog;
  u.uLayer.value.set(base, V.thick * (1 - 0.15 * fog), V.planetR, V.maxDist);
  u.uCamPos.value.copy(camera.position);
  // DRIFT is a pure function of the hand and the clock: wind of the day x time of day.
  const dx = Math.cos(dayA.wdir) * (0.3 + dayA.wsp) * V.drift * tin;
  const dz = Math.sin(dayA.wdir) * (0.3 + dayA.wsp) * V.drift * tin;
  u.uScale.value.set(1 / V.shapeTile, 1 / V.detailTile, V.detailK, V.dens * (1 - 0.35 * storm));
  u.uWind.value.set(-dx / V.shapeTile, -dz / V.shapeTile, -dx * 1.25 / V.detailTile, -dz * 1.25 / V.detailTile);
  const tanH = Math.tan(camera.fov * D2R * 0.5);
  renderer.getSize(_size);
  const hres = Math.max(1, Math.floor(_size.y / curDiv));
  u.uEvo.value.set(tin * 0.00012, V.curlK, V.powder, 2 * tanH / hres);
  u.uPhase.value.set(V.g1, V.g2, V.gMix, V.haze / (0.5 + 0.5 * hazeMul - 1.0 * storm) * (1 - 0.7 * fog));
  u.uMS.value.set(V.msA, V.msB, V.msC, 1);
  u.uSharp.value.set(V.edgeLo, V.edgeHi);
  u.uEvo2.value.set(V.knee, 0, 0, 0);
  const lidK = Math.max(sm(0.2, 0.8, storm), sm(0.75, 0.98, dayA.cover));
  u.uSteps.value.set(V.steps, V.lsteps, 0, lidK);
  u.uStorm.value.set(storm, V.rain * sm(0.35, 0.9, storm), V.scud * sm(0.3, 0.85, storm), lidK);
  // the air in front of a closed deck: the horizon airlight, darkened by the storm
  const hd = 1 - V.stormHaze * storm;
  u.uHazeCol.value.set(horN[0] * hd, horN[1] * hd, horN[2] * hd);
  u.uWin.value.set(camera.position.x, camera.position.z, 1 / 48000, frameN);
  // cirrus: the sunset-drama days carry it
  u.uCirrus.value.set(V.cirrus * clamp((h ? h.sunsetDrama : 0.3) * 0.9 + 0.1, 0, 1) * (1 - storm) * (1 - fog), 2600, 0, 0);
  u.uCirrusOff.value.set(-dx * 1.6, -dz * 1.6);
  // lightning: the same two slots the fog chunk lights the world with
  const b0 = W.SKY_UNIFORMS.abyssaBolt0.value, b1 = W.SKY_UNIFORMS.abyssaBolt1.value;   // no per-frame object
  // The fog chunk's light sits on the channel; the deck's glow is where the channel
  // leaves the cloud, so the same xz is lifted into the base and given a wider reach.
  u.uBolt0.value.set(b0[0], base + 45, b0[2], b0[3] * V.boltK);
  u.uBolt1.value.set(b1[0], base + 45, b1[2], b1[3] * V.boltK);
  u.uBoltCol.value.set(0.75, 0.8, 1.0);

  // --- weather map uniforms ---
  const wu = matWeather.uniforms;
  wu.uWin.value.set(camera.position.x, camera.position.z, 48000, blend);
  wu.uA.value.set(dayA.cover, dayA.type, dayA.layers, 0);
  wu.uB.value.set(dayB.cover, dayB.type, dayB.layers, 0);
  // yesterday's field keeps drifting past its own midnight
  const dxB = Math.cos(dayB.wdir) * (0.3 + dayB.wsp) * V.drift * (tin + CYCLE);
  const dzB = Math.sin(dayB.wdir) * (0.3 + dayB.wsp) * V.drift * (tin + CYCLE);
  wu.uAo.value.set(-dx, -dz, dayA.ox, dayA.oz);
  wu.uBo.value.set(-dxB, -dzB, dayB.ox, dayB.oz);
  wu.uSt.value.set(storm, 1, sm(0.25, 0.8, fog), 0);
  stats.cov = dayA.cover;

  // --- the shadow window and the deck key light ---
  const sw = matShadow.uniforms.uShWin.value;
  sw.set(Math.round(camera.position.x / 16) * 16, Math.round(camera.position.z / 16) * 16, 4096, 0);
  SHADOW.window[0] = sw.x; SHADOW.window[1] = sw.y; SHADOW.window[2] = sw.z;
  // airAmbience.sunVis: lighting.js multiplies the in-air key by it (cloud shadow on deck)
  W.airAmbience.sunVis = sunUp > 0.02 ? 0.22 + 0.78 * shadowSunVis : 1;

  // --- hand the water.js palette our horizon/zenith (one horizon number for everyone) ---
  // Under a gale the horizon slit darkens too: the airlight the far sea settles on is
  // the light that got under the deck, not the clear-day horizon.
  const hk = 1 - V.stormHor * storm;
  _hor2[0] = horN[0] * hk; _hor2[1] = horN[1] * hk; _hor2[2] = horN[2] * hk;
  W.setSkyRing(_hor2, zenN, coverMean());
}
function coverMean() { return clamp(dayA.cover * 0.8 + wxStorm, 0, 1); }

// ---------------------------------------------------------------------------------------
// PER FRAME (GPU): call before renderRefraction / the composer.
// ---------------------------------------------------------------------------------------
// GPU PROFILER (dev): a TIME_ELAPSED query around renderSky only. The frame-level
// timer (__gpu) must be parked first, one query per context: __rays.profile(true) does
// that. __vsky.profile(true) then __vsky.cost().
const prof = { on: false, ext: null, q: [], ms: [] };
function profPoll(gl) {
  while (prof.q.length) {
    const q = prof.q[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
    const dis = gl.getParameter(prof.ext.GPU_DISJOINT_EXT);
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
    gl.deleteQuery(q); prof.q.shift();
    if (!dis) { prof.ms.push(ns / 1e6); if (prof.ms.length > 240) prof.ms.shift(); }
  }
}
export function renderSky() {
  if (!built || !VSKY.on) return;
  if (prof.on && prof.ext) {
    const gl = renderer.getContext();
    profPoll(gl);
    const q = gl.createQuery();
    gl.beginQuery(prof.ext.TIME_ELAPSED_EXT, q);
    try { renderSkyInner(); } finally { gl.endQuery(prof.ext.TIME_ELAPSED_EXT); prof.q.push(q); }
    return;
  }
  renderSkyInner();
  // dev: __vsky.bench(k) re-runs the passes k extra times a frame, so a paired A/B of
  // the frame timer can resolve a cost smaller than the noise of a shared machine
  for (let i = 0; i < benchK; i++) renderSkyInner();
}
let benchK = 0, skipMask = 0, curDiv = 2;
function renderSkyInner() {
  const V = VSKY;
  frameN++;
  const prevT = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  const deep = camera.position.y < -60;
  // weather map + shadow (shadow only matters in the top of the column)
  if (!(skipMask & 1)) { renderer.setRenderTarget(weatherRT); renderer.render(qWeather, fsCam); }
  if (!deep && !(skipMask & 2)) {
    renderer.setRenderTarget(shadowRT); renderer.render(qShadow, fsCam);
    probeIssue();
  }

  const mu = matMarch.uniforms;
  if (camera.position.y > -40) {
    // --- screen march ---
    renderer.getSize(_size);
    // THE DIVISOR holds a pixel budget, not a ratio: the march costs per pixel, and the
    // internal resolution moves with the window, the DPR and DRS.
    const dv = Math.max(V.div, Math.sqrt(_size.x * _size.y / V.marchPx));
    curDiv = dv;
    const w = Math.max(8, Math.ceil(_size.x / dv)), hh = Math.max(8, Math.ceil(_size.y / dv));
    if (w !== lastW || hh !== lastH) {
      curRT.setSize(w, hh); histRT[0].setSize(w, hh); histRT[1].setSize(w, hh);
      lastW = w; lastH = hh; histValid = false;
    }
    camera.updateMatrixWorld();
    mu.uInvProj.value.copy(camera.projectionMatrixInverse);
    mu.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    mu.uSteps.value.z = 0;
    mu.uSteps.value.x = V.steps;
    if (!(skipMask & 4)) { renderer.setRenderTarget(curRT); renderer.render(qMarch, fsCam); }
    // --- resolve into the other history ---
    const src = histRT[hist], dst = histRT[hist ^ 1];
    const ru = matResolve.uniforms;
    ru.tCur.value = curRT.texture; ru.tHist.value = src.texture;
    ru.uRes.value.set(1 / w, 1 / hh, V.history, histValid ? 1 : 0);
    renderer.setRenderTarget(dst); renderer.render(qResolve, fsCam);
    hist ^= 1; histValid = true;
    DOME_U.tVolCloud.value = dst.texture;
    // view-projection with the rotation only (the dome's lookup is by direction)
    _m4.copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
    curVP.multiplyMatrices(camera.projectionMatrix, _m4);
    prevVP.copy(curVP);
    DOME_U.uVolVP.value.copy(curVP);
  } else {
    histValid = false;
  }

  // --- pano strip (a quarter of the rows per frame) ---
  if ((!deep || !SKY_ENV.valid) && !(skipMask & 16)) {
    mu.uSteps.value.z = 1;
    mu.uSteps.value.x = Math.max(24, V.steps >> 1);
    const s = panoStrip & 3;
    panoRT.scissor.set(0, s * 16, 256, 16);
    panoRT.scissorTest = true;
    renderer.setRenderTarget(panoRT); renderer.render(qMarch, fsCam);
    panoRT.scissorTest = false;
    mu.uSteps.value.z = 0; mu.uSteps.value.x = V.steps;
    panoStrip++;
    SKY_ENV.texture = panoRT.texture; SKY_ENV.version++;
    if (panoStrip >= 4) SKY_ENV.valid = true;
  }
  SHADOW.texture = shadowRT.texture;
  renderer.setRenderTarget(prevT);
  renderer.autoClear = prevAuto;
}

function probeIssue() {
  if (pboFailed) return;
  const gl = renderer.getContext();
  if (!pbo) {
    if (!gl.PIXEL_PACK_BUFFER || !gl.getBufferSubData) { pboFailed = true; return; }
    pbo = [];
    for (let i = 0; i < PBO_RING; i++) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ);
      pbo.push(b);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }
  while (pboIssued - pboRead > PBO_LAG) {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo[pboRead % PBO_RING]);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pboOut);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    pboRead++;
    if (isFinite(pboOut[0])) { shadowSunVis = clamp(pboOut[0], 0, 1); camSunVis = clamp(pboOut[1], 0, 1); }
  }
  stats.sunVis = shadowSunVis;
  if ((frameN & 1) || pboIssued - pboRead >= PBO_RING) return;
  renderer.setRenderTarget(probeRT); renderer.render(qProbe, fsCam);
  try {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo[pboIssued % PBO_RING]);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    pboIssued++;
  } catch (e) {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    pboFailed = true;
  }
}

// Boot compile of every program this file draws with (postfx.js warm-up calls it after
// the world is built). Each is compiled against a render target, which is the variant
// it is drawn with.
export function warmUpSky() {
  if (!built) return 0;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(curRT);
  for (const s of [qWeather, qMarch, qResolve, qShadow, qProbe]) renderer.compile(s, fsCam);
  renderer.setRenderTarget(prev);
  return 5;
}

// The degrade rung: coarser march, fewer steps. Terminal: off (painted sky returns).
let rung = 0;
export function degradeSky() {
  rung++;
  if (rung === 1) { VSKY.marchPx = 240000; VSKY.steps = 44; VSKY.lsteps = 5; }
  else if (rung === 2) { VSKY.marchPx = 150000; VSKY.steps = 36; VSKY.lsteps = 4; }
  else { rung = 3; }
  return rung;
}
export function restoreSky() {
  rung = Math.max(0, rung - 1);
  if (rung === 0) { VSKY.marchPx = 360000; VSKY.steps = 52; VSKY.lsteps = 6; }
  else if (rung === 1) { VSKY.marchPx = 240000; VSKY.steps = 44; VSKY.lsteps = 5; }
  return rung;
}

if (typeof window !== 'undefined') {
  window.__vsky = {
    V: VSKY, stats, atm, lutR, lutM,
    on(b) { VSKY.on = b === undefined ? 1 : (b ? 1 : 0); DOME_U.uVolK.value.x = VSKY.on; return VSKY.on; },
    state() {
      return { built, bootMs: +bootMs.toFixed(1), genMs: +genMs.toFixed(1), div: +curDiv.toFixed(2), steps: VSKY.steps, w: lastW, h: lastH,
        physElev: +physElev.toFixed(2), K: +Ksm.toExponential(3), hazeMul: +hazeMul.toFixed(2),
        sunVis: +shadowSunVis.toFixed(3), camSunVis: +camSunVis.toFixed(3),
        light: lightCol.map(v => +v.toFixed(4)), ambTop: ambTop.map(v => +v.toFixed(4)),
        hor: horN.map(v => +v.toFixed(4)), zen: zenN.map(v => +v.toFixed(4)),
        lutMs: +stats.lutMs.toFixed(2), lutN: stats.lutN, cover: dayA.cover, type: dayA.type, layers: dayA.layers,
        env: SKY_ENV.valid, envVer: SKY_ENV.version, rung };
    },
    degrade: degradeSky, restore: restoreSky,
    bench(k) { benchK = Math.max(0, k | 0); return benchK; },
    // dev: synchronous GPU time of the passes, gl.finish-bracketed, median of `reps`
    // batches of n (stalls the pipeline: never in a shipped path)
    time(n, reps, mask) {
      const gl = renderer.getContext();
      n = n || 10; reps = reps || 7; skipMask = mask | 0;
      const out = [];
      for (let r = 0; r < reps; r++) {
        gl.finish();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) renderSkyInner();
        gl.finish();
        out.push((performance.now() - t0) / n);
      }
      skipMask = 0;
      out.sort((x, y) => x - y);
      return { median: +out[reps >> 1].toFixed(3), min: +out[0].toFixed(3), w: lastW, h: lastH };
    },
    skip(m) { skipMask = m | 0; return skipMask; },
    profile(on) {
      prof.on = on === undefined ? true : !!on;
      if (prof.on && !prof.ext) prof.ext = renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2');
      prof.ms.length = 0;
      return !!prof.ext;
    },
    cost() {
      if (!prof.ms.length) return null;
      const a = prof.ms.slice().sort((x, y) => x - y);
      return { n: a.length, median: +a[a.length >> 1].toFixed(3), p90: +a[Math.floor(a.length * 0.9)].toFixed(3) };
    },
    // read back a few pano texels / the march target (dev only: stalls the GPU)
    // fraction of the upper sky (above 5 degrees) with cloud transmittance under 0.5,
    // from the pano (dev only: a full readback)
    coverage() {
      const b = new Uint16Array(256 * 64 * 4);
      renderer.readRenderTargetPixels(panoRT, 0, 0, 256, 64, b);
      let n = 0, c = 0;
      for (let y = 15; y < 64; y++) for (let x = 0; x < 256; x++) { n++; if (THREE.DataUtils.fromHalfFloat(b[(y * 256 + x) * 4 + 3]) < 0.5) c++; }
      return +(c / n).toFixed(3);
    },
    readPano(x, y) {
      const b = new Uint16Array(4);
      renderer.readRenderTargetPixels(panoRT, x, y, 1, 1, b);
      return Array.from(b, THREE.DataUtils.fromHalfFloat);
    }
  };
}
